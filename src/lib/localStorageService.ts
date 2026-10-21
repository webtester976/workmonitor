export interface LocalStorageResult {
  fileId: string;
  filePath: string;
  localUrl: string;
  employeeId?: string;
  employeeName?: string;
  folderKey?: string;
  dateKey?: string;
}

export interface LocalScreenshotItem {
  fileName: string;
  employeeId: string;
  employeeName: string;
  folderKey: string;
  dateKey: string;
  localUrl: string;
}

interface QueuedScreenshot {
  id: string;
  blob: Blob;
  fileName: string;
  employeeId: string;
  employeeName: string;
  dateKey: string;
  queuedAt: number;
  attempts: number;
}

/* ========================================================================== 
   BACKEND URL
========================================================================== */

const getBackendUrl = (): string => {
  const configured = import.meta.env.VITE_BACKEND_URL?.trim();

  if (configured) {
    return configured.replace(/\/$/, '');
  }

  return 'https://codesdot-workmonitor.work-nest.workers.dev';
};

/* ========================================================================== 
   CLOUD UPLOAD WINDOW / QUEUE POLICY
========================================================================== */

const INDIA_TIME_ZONE = 'Asia/Kolkata';
const TRACKING_START_MINUTES = 8 * 60 + 30;
const TRACKING_END_MINUTES = 20 * 60 + 30;
const HOURLY_UPLOAD_MS = 60 * 60 * 1000;
// Small batches keep every request inside Cloudflare Worker memory and
// subrequest limits (a 50-file / 80 MB batch crashed the Worker and left the
// whole queue stuck forever).
const UPLOAD_BATCH_SIZE = 10;
const MAX_BATCH_BYTES = 8 * 1024 * 1024;
const QUEUE_DB_NAME = 'workmonitor_screenshot_queue_v4';
const QUEUE_STORE_NAME = 'queue';
const LOCAL_SCREENSHOT_STORE_NAME = 'screenshots';

interface PersistedScreenshot {
  id: string;
  blob: Blob;
  fileName: string;
  employeeId: string;
  employeeName: string;
  dateKey: string;
  capturedAt: number;
}

export interface LocalScreenshotPreview {
  localId: string;
  fileName: string;
  employeeId: string;
  employeeName: string;
  dateKey: string;
  capturedAt: number;
  blob: Blob;
}
const LAST_UPLOAD_KEY = 'workmonitor:lastScreenshotCloudUploadAt';
const KV_QUOTA_RETRY_AFTER_KEY = 'workmonitor:kvQuotaRetryAfter';
const FLUSH_LOCK_KEY = 'workmonitor:screenshotQueueFlushLock';

const getIndiaMinutes = (date = new Date()): number => {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return hour * 60 + minute;
};

const isCloudUploadWindowOpen = (date = new Date()): boolean => {
  const minutes = getIndiaMinutes(date);
  return minutes >= TRACKING_START_MINUTES && minutes <= TRACKING_END_MINUTES;
};

// One shared connection. Opening a new IDBDatabase handle on every call (and
// never closing it) leaks connections during a long working day.
let queueDbPromise: Promise<IDBDatabase | null> | null = null;

const getQueueDb = (): Promise<IDBDatabase | null> => {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  if (queueDbPromise) {
    return queueDbPromise;
  }

  queueDbPromise = new Promise((resolve) => {
    const request = indexedDB.open(QUEUE_DB_NAME, 2);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE_NAME)) {
        const store = db.createObjectStore(QUEUE_STORE_NAME, { keyPath: 'id' });
        store.createIndex('queuedAt', 'queuedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(LOCAL_SCREENSHOT_STORE_NAME)) {
        const store = db.createObjectStore(LOCAL_SCREENSHOT_STORE_NAME, { keyPath: 'id' });
        store.createIndex('employeeDate', ['employeeId', 'dateKey'], { unique: false });
        store.createIndex('fileName', 'fileName', { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        queueDbPromise = null;
      };
      db.onclose = () => {
        queueDbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      queueDbPromise = null;
      resolve(null);
    };
  });

  return queueDbPromise;
};

const getQueuedScreenshots = async (): Promise<QueuedScreenshot[]> => {
  const db = await getQueueDb();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(QUEUE_STORE_NAME, 'readonly');
      const request = tx.objectStore(QUEUE_STORE_NAME).getAll();
      request.onsuccess = () => {
        const items = Array.isArray(request.result)
          ? (request.result as QueuedScreenshot[])
          : [];
        items.sort((a, b) => a.queuedAt - b.queuedAt);
        resolve(items);
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
};

const putQueuedScreenshot = async (item: QueuedScreenshot): Promise<void> => {
  const db = await getQueueDb();
  if (!db) throw new Error('Browser local storage is unavailable.');

  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction(QUEUE_STORE_NAME, 'readwrite');
      tx.objectStore(QUEUE_STORE_NAME).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Unable to save screenshot locally.'));
      tx.onabort = () => reject(tx.error || new Error('Unable to save screenshot locally.'));
    } catch (error) {
      reject(error);
    }
  });
};

const putLocalPersistedScreenshot = async (item: PersistedScreenshot): Promise<void> => {
  const db = await getQueueDb();
  if (!db) throw new Error('Browser local storage is unavailable.');

  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction(LOCAL_SCREENSHOT_STORE_NAME, 'readwrite');
      tx.objectStore(LOCAL_SCREENSHOT_STORE_NAME).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Unable to save permanent local screenshot.'));
      tx.onabort = () => reject(tx.error || new Error('Unable to save permanent local screenshot.'));
    } catch (error) {
      reject(error);
    }
  });
};

export async function getLocalScreenshotPreviews(
  employeeId: string,
  dateKey: string
): Promise<LocalScreenshotPreview[]> {
  const db = await getQueueDb();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(LOCAL_SCREENSHOT_STORE_NAME, 'readonly');
      const store = tx.objectStore(LOCAL_SCREENSHOT_STORE_NAME);
      const request = store.index('employeeDate').getAll([employeeId, dateKey]);
      request.onsuccess = () => {
        const items = Array.isArray(request.result)
          ? (request.result as PersistedScreenshot[])
          : [];
        items.sort((a, b) => b.capturedAt - a.capturedAt);
        resolve(items.map((item) => ({
          localId: item.id,
          fileName: item.fileName,
          employeeId: item.employeeId,
          employeeName: item.employeeName,
          dateKey: item.dateKey,
          capturedAt: item.capturedAt,
          blob: item.blob,
        })));
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
};

const deleteQueuedScreenshots = async (ids: string[]): Promise<void> => {
  if (!ids.length) return;
  const db = await getQueueDb();
  if (!db) return;

  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction(QUEUE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(QUEUE_STORE_NAME);
      ids.forEach((id) => store.delete(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Unable to clear uploaded screenshots.'));
      tx.onabort = () => reject(tx.error || new Error('Unable to clear uploaded screenshots.'));
    } catch (error) {
      reject(error);
    }
  });
};

/* ==========================================================================
   QUEUED (NOT YET UPLOADED) SCREENSHOTS - used to restore the employee's
   screenshot list after a page refresh.
========================================================================== */

export interface QueuedScreenshotPreview {
  queueId: string;
  fileName: string;
  dateKey: string;
  queuedAt: number;
  blob: Blob;
}

export async function getQueuedScreenshotPreviews(
  employeeId: string,
  dateKey: string
): Promise<QueuedScreenshotPreview[]> {
  const items = await getQueuedScreenshots();
  return items
    .filter((item) => item.employeeId === employeeId && item.dateKey === dateKey)
    .map((item) => ({
      queueId: item.id,
      fileName: item.fileName,
      dateKey: item.dateKey,
      queuedAt: item.queuedAt,
      blob: item.blob,
    }));
}

// Permanent browser copies are only a convenience for the employee's own
// history. Remove old ones so the browser storage quota never fills up and
// blocks new screenshots.
const LOCAL_COPY_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

export async function pruneOldLocalScreenshots(keepMs = LOCAL_COPY_KEEP_MS): Promise<number> {
  const db = await getQueueDb();
  if (!db) return 0;

  return new Promise((resolve) => {
    try {
      const cutoff = Date.now() - keepMs;
      let removed = 0;
      const tx = db.transaction(LOCAL_SCREENSHOT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(LOCAL_SCREENSHOT_STORE_NAME);
      const cursorRequest = store.openCursor();

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const value = cursor.value as PersistedScreenshot;
        if (Number(value?.capturedAt || 0) < cutoff) {
          cursor.delete();
          removed += 1;
        }
        cursor.continue();
      };

      tx.oncomplete = () => resolve(removed);
      tx.onerror = () => resolve(removed);
      tx.onabort = () => resolve(removed);
    } catch {
      resolve(0);
    }
  });
}

const setLastUploadAt = (timestamp: number): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LAST_UPLOAD_KEY, String(timestamp));
};

// A batch is due once the OLDEST queued screenshot has waited one full hour.
// (Previously this was measured from the last upload. That made the first
// screenshot of a session upload alone after a minute - resetting the clock -
// and then every later screenshot waited a full hour, so Admin saw just 1.)
const canStartHourlyFlush = (items: QueuedScreenshot[], now: number): boolean => {
  if (!items.length) return false;
  return now - items[0].queuedAt >= HOURLY_UPLOAD_MS;
};

const acquireFlushLock = (): boolean => {
  if (typeof window === 'undefined') return false;

  const now = Date.now();
  const existing = Number(window.localStorage.getItem(FLUSH_LOCK_KEY) || 0) || 0;

  if (existing && now - existing < 10 * 60 * 1000) {
    return false;
  }

  window.localStorage.setItem(FLUSH_LOCK_KEY, String(now));
  return true;
};

const releaseFlushLock = (): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(FLUSH_LOCK_KEY);
};

/* ========================================================================== 
   SAVE SCREENSHOT LOCALLY

   IMPORTANT: This function intentionally DOES NOT call Cloudflare.
   It stores the full screenshot Blob in IndexedDB. A separate hourly
   scheduler uploads queued screenshots in batches.
========================================================================== */

export async function uploadScreenshotLocally(
  imageBlob: Blob,
  fileName: string,
  employeeId: string,
  employeeName: string,
  dateKey: string
): Promise<LocalStorageResult> {
  const id = `queue-${Date.now()}-${crypto.randomUUID()}`;

  const queueItem: QueuedScreenshot = {
    id,
    blob: imageBlob,
    fileName,
    employeeId,
    employeeName,
    dateKey,
    queuedAt: Date.now(),
    attempts: 0,
  };

  try {
    await putQueuedScreenshot(queueItem);
  } catch (error) {
    // Most likely the browser storage quota is full: free space and retry once.
    console.warn('Queue save failed, pruning old local copies and retrying:', error);
    await pruneOldLocalScreenshots(24 * 60 * 60 * 1000);
    await putQueuedScreenshot(queueItem);
  }

  // Optional permanent browser copy (used for the employee's own history).
  // It must NEVER make the capture fail - the queued copy above is what gets
  // uploaded to the cloud.
  try {
    await putLocalPersistedScreenshot({
      id: `local-${id}`,
      blob: imageBlob,
      fileName,
      employeeId,
      employeeName,
      dateKey,
      capturedAt: Date.now(),
    });
  } catch (error) {
    console.warn('Permanent local copy skipped:', error);
    void pruneOldLocalScreenshots();
  }

  return {
    fileId: `local-queue:${id}`,
    filePath: `local-queue/${fileName}`,
    localUrl: '',
    employeeId,
    employeeName,
    folderKey: `${employeeId}/${dateKey}`,
    dateKey,
  };
}

/* ========================================================================== 
   HOURLY BATCH CLOUD UPLOAD
========================================================================== */

export async function flushScreenshotUploadQueue(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  if (!isCloudUploadWindowOpen()) return 0;

  // Stop repeated Worker/D1 requests after Cloudflare reports the daily KV quota is exhausted.
  // Queue items remain in IndexedDB and retry after the next midnight UTC reset (05:30 IST).
  const quotaRetryAfter = Number(window.localStorage.getItem(KV_QUOTA_RETRY_AFTER_KEY) || 0);
  if (quotaRetryAfter > Date.now()) return 0;
  if (quotaRetryAfter) window.localStorage.removeItem(KV_QUOTA_RETRY_AFTER_KEY);

  const items = await getQueuedScreenshots();
  const now = Date.now();

  if (!canStartHourlyFlush(items, now)) return 0;
  if (!acquireFlushLock()) return 0;

  let uploadedCount = 0;
  let uploadedAnyInThisRun = false;
  let drainedAll = true;
  let offset = 0;

  try {
    const backendUrl = getBackendUrl();

    for (; offset < items.length; ) {
      if (!isCloudUploadWindowOpen()) break;

      const batch: QueuedScreenshot[] = [];
      let batchBytes = 0;
      for (let index = offset; index < items.length && batch.length < UPLOAD_BATCH_SIZE; index += 1) {
        const candidate = items[index];
        const candidateBytes = Number(candidate.blob?.size || 0);
        if (batch.length > 0 && batchBytes + candidateBytes > MAX_BATCH_BYTES) break;
        batch.push(candidate);
        batchBytes += candidateBytes;
      }
      if (!batch.length) break;

      const formData = new FormData();
      const metadata = batch.map((item) => ({
        queueId: item.id,
        employeeId: item.employeeId,
        employeeName: item.employeeName,
        dateKey: item.dateKey,
        fileName: item.fileName,
      }));

      formData.append('metadata', JSON.stringify(metadata));
      batch.forEach((item) => {
        formData.append('files', item.blob, item.fileName);
      });

      let response: Response;
      try {
        response = await fetch(`${backendUrl}/api/upload-screenshot-batch`, {
          method: 'POST',
          body: formData,
        });
      } catch (error) {
        console.warn('Screenshot batch upload network error:', error);
        break;
      }

      let data: any = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      const uploadedIds = Array.isArray(data?.uploadedIds)
        ? data.uploadedIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];

      const failedText = Array.isArray(data?.failed)
        ? data.failed.map((item: any) => String(item?.error || '')).join(' ')
        : '';
      const quotaExceeded = Boolean(data?.quotaExceeded) || /KV put\(\) limit exceeded|daily write limit is exhausted/i.test(failedText);
      if (quotaExceeded) {
        const now = new Date();
        const nextUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
        window.localStorage.setItem(KV_QUOTA_RETRY_AFTER_KEY, String(nextUtcMidnight));
        console.warn('Cloudflare KV daily write quota exhausted. Queue retained; retry after 00:00 UTC / 05:30 IST.');
      }

      // Always remove whatever the Worker confirmed, even on a partial failure.
      if (uploadedIds.length) {
        await deleteQueuedScreenshots(uploadedIds);
        uploadedCount += uploadedIds.length;
        uploadedAnyInThisRun = true;
      }

      // HTTP/server failure with nothing stored: stop and retry later.
      if (!response.ok && !uploadedIds.length) {
        console.warn('Screenshot batch upload deferred:', response.status, data);
        break;
      }

      // Partial failure: keep the failed ones in the queue but continue with
      // the next batches so one bad item can never block everything behind it.
      if (data?.failedCount > 0) {
        console.warn('Some screenshots failed and stay queued:', data.failed);
      }

      offset += batch.length;
      if (data?.failedCount > 0) {
        drainedAll = false;
      }
    }

    // Only start the one-hour wait when the whole queue was uploaded.
    // If something is left (failure / partial), the next minute-tick retries.
    if (uploadedAnyInThisRun && drainedAll && offset >= items.length) {
      setLastUploadAt(Date.now());
    }

    return uploadedCount;
  } finally {
    releaseFlushLock();
  }
}

export function startScreenshotUploadScheduler(): () => void {
  if (typeof window === 'undefined') return () => {};

  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await flushScreenshotUploadQueue();
    } finally {
      running = false;
    }
  };

  // Check once when the dashboard starts, then every minute so the queue
  // uploads as soon as its hourly slot and the 08:30–20:30 IST window allow it.
  void pruneOldLocalScreenshots();
  void tick();
  const timer = window.setInterval(() => void tick(), 60 * 1000);

  return () => window.clearInterval(timer);
}

/* ========================================================================== 
   GET SCREENSHOTS
========================================================================== */

export async function getLocalScreenshots(
  employeeId: string,
  dateKey: string
): Promise<LocalScreenshotItem[]> {
  const backendUrl = getBackendUrl();

  const response = await fetch(
    `${backendUrl}/api/screenshots/${encodeURIComponent(employeeId)}/${encodeURIComponent(dateKey)}`,
    {
      method: 'GET',
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Unable to load screenshots: ${response.status} - ${errorText}`
    );
  }

  const data = await response.json();
  return Array.isArray(data?.items) ? data.items : [];
}

/* ========================================================================== 
   DELETE SCREENSHOT
========================================================================== */

export async function deleteLocalScreenshot(filePath: string): Promise<void> {
  const backendUrl = getBackendUrl();

  const response = await fetch(`${backendUrl}/api/screenshot`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filePath }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Delete failed: ${response.status} - ${errorText}`);
  }
}

export function getLocalBackendUrl(): string {
  return getBackendUrl();
}

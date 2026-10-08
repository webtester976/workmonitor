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
const UPLOAD_BATCH_SIZE = 50;
const MAX_BATCH_BYTES = 80 * 1024 * 1024;
const QUEUE_DB_NAME = 'workmonitor_screenshot_queue_v2';
const QUEUE_STORE_NAME = 'queue';
const LAST_UPLOAD_KEY = 'workmonitor:lastScreenshotCloudUploadAt';
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

const getQueueDb = (): Promise<IDBDatabase | null> => {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(QUEUE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE_NAME)) {
        const store = db.createObjectStore(QUEUE_STORE_NAME, { keyPath: 'id' });
        store.createIndex('queuedAt', 'queuedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
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

const getLastUploadAt = (): number => {
  if (typeof window === 'undefined') return 0;
  return Number(window.localStorage.getItem(LAST_UPLOAD_KEY) || 0) || 0;
};

const setLastUploadAt = (timestamp: number): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LAST_UPLOAD_KEY, String(timestamp));
};

const canStartHourlyFlush = (items: QueuedScreenshot[], now: number): boolean => {
  if (!items.length) return false;

  const lastUploadAt = getLastUploadAt();
  if (lastUploadAt > 0) {
    return now - lastUploadAt >= HOURLY_UPLOAD_MS;
  }

  // First cloud batch is also delayed until the oldest queued screenshot
  // has been waiting for one hour.
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

  await putQueuedScreenshot({
    id,
    blob: imageBlob,
    fileName,
    employeeId,
    employeeName,
    dateKey,
    queuedAt: Date.now(),
    attempts: 0,
  });

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

  const items = await getQueuedScreenshots();
  const now = Date.now();

  if (!canStartHourlyFlush(items, now)) return 0;
  if (!acquireFlushLock()) return 0;

  let uploadedCount = 0;

  try {
    const backendUrl = getBackendUrl();

    for (let offset = 0; offset < items.length; ) {
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

      const response = await fetch(`${backendUrl}/api/upload-screenshot-batch`, {
        method: 'POST',
        headers: {
        },
        body: formData,
      });

      let data: any = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok || !data?.success) {
        console.warn('Screenshot batch upload deferred:', response.status, data);
        break;
      }

      const uploadedIds = Array.isArray(data.uploadedIds)
        ? data.uploadedIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];

      if (uploadedIds.length) {
        await deleteQueuedScreenshots(uploadedIds);
        uploadedCount += uploadedIds.length;
      }

      // If the worker reports partial failure, keep failed screenshots locally.
      if (data.failedCount > 0) {
        break;
      }

      offset += batch.length;
    }

    if (uploadedCount > 0) {
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
      headers: {
      },
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



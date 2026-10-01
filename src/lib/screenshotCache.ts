/**
 * Local screenshot memory and persistence cache.
 * Ensures that locally captured screenshots are stored at full quality
 * and never lost or corrupted by cloud payload optimizations.
 */

const memoryCache = new Map<string, string>();
const DB_NAME = 'workmonitor_screens_v1';
const STORE_NAME = 'previews';

// Open lightweight IndexedDB for reliable local preview caching
function getDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export function setCachedScreenshot(id: string, dataUrl: string) {
  if (!id || !dataUrl) return;
  memoryCache.set(id, dataUrl);
  // Also save to IndexedDB asynchronously
  getDB().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ id, dataUrl, savedAt: Date.now() });
    } catch {}
  });
}

export function getCachedScreenshot(id: string): string | null {
  if (!id) return null;
  return memoryCache.get(id) || null;
}

export async function loadCachedScreenshotAsync(id: string): Promise<string | null> {
  if (!id) return null;
  const inMem = memoryCache.get(id);
  if (inMem) return inMem;

  const db = await getDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => {
        if (req.result?.dataUrl) {
          memoryCache.set(id, req.result.dataUrl);
          resolve(req.result.dataUrl);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Validates whether a previewDataUrl string is a healthy, un-truncated data URL or image link.
 */
export function isValidImageSrc(src?: string): boolean {
  if (!src) return false;
  if (src.startsWith('http://') || src.startsWith('https://')) return true;
  if (!src.startsWith('data:image/')) return false;

  // If it was truncated by the 50,000 char slice bug, it will be exactly 50,000 characters and end abruptly
  if (src.length === 50000) return false;

  // Basic check: must have header and comma
  const commaIdx = src.indexOf(',');
  if (commaIdx === -1) return false;

  // Base64 section must be multiple of 4 roughly and not end abruptly
  const base64Data = src.slice(commaIdx + 1);
  if (base64Data.length < 50) return false;

  return true;
}

/**
 * Returns the best available image URL for a screenshot:
 * 1. Local pristine full-resolution cache
 * 2. Screenshot previewDataUrl (if valid and not truncated)
 * 3. Drive thumbnail link / direct Google CDN link
 * 4. Fallback Google Drive thumbnail URL
 */
export function resolveScreenshotImageSrc(
  screen: {
    id: string;
    previewDataUrl?: string;
    driveFileId?: string;
    driveThumbnailLink?: string;
  }
): { primarySrc: string; fallbackSrc?: string } {
  const cached = getCachedScreenshot(screen.id);
  if (cached && isValidImageSrc(cached)) {
    return {
      primarySrc: cached,
      fallbackSrc: screen.driveThumbnailLink || (screen.driveFileId ? `https://lh3.googleusercontent.com/d/${screen.driveFileId}` : undefined),
    };
  }

  if (screen.previewDataUrl && isValidImageSrc(screen.previewDataUrl)) {
    return {
      primarySrc: screen.previewDataUrl,
      fallbackSrc: screen.driveThumbnailLink || (screen.driveFileId ? `https://lh3.googleusercontent.com/d/${screen.driveFileId}` : undefined),
    };
  }

  // If previewDataUrl is invalid or missing, prioritize Google Drive
  if (screen.driveThumbnailLink) {
    return {
      primarySrc: screen.driveThumbnailLink,
      fallbackSrc: screen.driveFileId ? `https://drive.google.com/thumbnail?id=${screen.driveFileId}&sz=w1000` : undefined,
    };
  }

  if (screen.driveFileId) {
    return {
      primarySrc: `https://lh3.googleusercontent.com/d/${screen.driveFileId}`,
      fallbackSrc: `https://drive.google.com/thumbnail?id=${screen.driveFileId}&sz=w1000`,
    };
  }

  return { primarySrc: screen.previewDataUrl || '' };
}

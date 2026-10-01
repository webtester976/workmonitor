/**
 * Helper to format seconds into standard readable hours and decimal values
 * Prevents any "NaN" issues by strictly defaulting to 0 numbers.
 */
export function formatSecondsToHoursMinutes(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  return `${minutes}m ${secs}s`;
}

export function secondsToDecimalHours(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Number((seconds / 3600).toFixed(2));
}

export function formatTimeString(date: Date = new Date()): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function getTodayDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getHourSlotKey(date: Date = new Date()): string {
  const hour = date.getHours();
  const startHour12 = (hour % 12 === 0 ? 12 : hour % 12);
  const startAmPm = hour >= 12 ? 'PM' : 'AM';
  const endHour = (hour + 1) % 24;
  const endHour12 = (endHour % 12 === 0 ? 12 : endHour % 12);
  const endAmPm = endHour >= 12 ? 'PM' : 'AM';

  const padStart = String(startHour12).padStart(2, '0');
  const padEnd = String(endHour12).padStart(2, '0');

  return `${padStart}:00 ${startAmPm} - ${padEnd}:00 ${endAmPm}`;
}

export function generateConfirmationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Convert an HTML Canvas or MediaStream frame to a Blob with selected format
 */
export async function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: 'webp' | 'png' | 'jpg',
  quality = 0.85
): Promise<{ blob: Blob; mimeType: string; extension: string }> {
  let mimeType = 'image/webp';
  let extension = 'webp';

  if (format === 'png') {
    mimeType = 'image/png';
    extension = 'png';
  } else if (format === 'jpg') {
    mimeType = 'image/jpeg';
    extension = 'jpg';
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`Failed to capture canvas as ${mimeType}`));
          return;
        }
        resolve({ blob, mimeType, extension });
      },
      mimeType,
      quality
    );
  });
}

/**
 * Generates a crisp, lightweight downscaled thumbnail Data URL (~15-25KB)
 * for instant UI preview and cloud synchronization with high visibility.
 * Prevents payload bloat and prevents string truncation issues.
 */
export function generateThumbnailDataUrl(
  sourceCanvas: HTMLCanvasElement,
  maxWidth = 640,
  maxHeight = 360,
  quality = 0.75
): string {
  const srcWidth = sourceCanvas.width || 1920;
  const srcHeight = sourceCanvas.height || 1080;

  let targetWidth = maxWidth;
  let targetHeight = Math.round((srcHeight / srcWidth) * maxWidth);

  if (targetHeight > maxHeight) {
    targetHeight = maxHeight;
    targetWidth = Math.round((srcWidth / srcHeight) * maxHeight);
  }

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = targetWidth;
  thumbCanvas.height = targetHeight;
  const ctx = thumbCanvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
  }

  try {
    return thumbCanvas.toDataURL('image/webp', quality);
  } catch {
    return thumbCanvas.toDataURL('image/jpeg', quality);
  }
}


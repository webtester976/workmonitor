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

/* ========================================================================== 
   BACKEND URL
========================================================================== */

const getBackendUrl = () => {
  const configured = import.meta.env.VITE_BACKEND_URL?.trim();

  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }

  return 'https://localhost:3001';
};

/* ========================================================================== 
   NGROK HEADERS
========================================================================== */

const getNgrokHeaders = (): Record<string, string> => {
  return {
    'ngrok-skip-browser-warning': 'true',
  };
};

/* ========================================================================== 
   UPLOAD SCREENSHOT
========================================================================== */

export async function uploadScreenshotLocally(
  imageBlob: Blob,
  fileName: string,
  employeeId: string,
  employeeName: string,
  dateKey: string
): Promise<LocalStorageResult> {
  const backendUrl = getBackendUrl();
  const formData = new FormData();

  // Fields must be appended BEFORE the file because Multer reads them first.
  formData.append('employeeId', employeeId);
  formData.append('employeeName', employeeName);
  formData.append('dateKey', dateKey);
  formData.append('fileName', fileName);
  formData.append('file', imageBlob, fileName);

  const response = await fetch(`${backendUrl}/api/upload-screenshot`, {
    method: 'POST',
    headers: {
      ...getNgrokHeaders(),
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload failed: ${response.status} - ${errorText}`);
  }

  return response.json();
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
        ...getNgrokHeaders(),
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
      ...getNgrokHeaders(),
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

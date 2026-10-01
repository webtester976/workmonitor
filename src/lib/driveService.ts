/**
 * Google Drive API Client
 * Creates user folders and nested date folders:
 * Root -> User_Name (or email) -> Date (YYYY-MM-DD) -> screenshot_time.webp/png/jpg
 * Ensuring screenshots are properly nested inside the date folder!
 */

export interface DriveFolderInfo {
  id: string;
  name: string;
}

export interface DriveUploadResult {
  fileId: string;
  fileName: string;
  webViewLink?: string;
  thumbnailLink?: string;
}

/**
 * Searches for an existing folder with given name and optional parent.
 * If not found, creates it.
 */
export async function getOrCreateFolder(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<string> {
  let query = `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }

  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)&spaces=drive`;
  const searchRes = await fetch(searchUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(`Failed to search Drive folder: ${errText}`);
  }

  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Create folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create Drive folder '${folderName}': ${errText}`);
  }

  const createData = await createRes.json();
  return createData.id;
}

/**
 * Uploads a binary screenshot file (WebP / PNG / JPG) to Google Drive
 * into the designated parent folder (the Date folder inside User folder).
 */
export async function uploadScreenshotToDrive(
  accessToken: string,
  imageBlob: Blob,
  fileName: string,
  mimeType: string,
  parentFolderId: string
): Promise<DriveUploadResult> {
  const metadata = {
    name: fileName,
    parents: [parentFolderId],
    mimeType: mimeType,
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', imageBlob);

  const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,thumbnailLink';
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to upload screenshot to Drive: ${errorBody}`);
  }

  const data = await res.json();

  // Ensure file is readable so Drive thumbnail link displays seamlessly in the dashboard
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
  } catch (permErr) {
    console.warn('Drive permission share note:', permErr);
  }

  return {
    fileId: data.id,
    fileName: data.name,
    webViewLink: data.webViewLink,
    thumbnailLink: data.thumbnailLink || `https://lh3.googleusercontent.com/d/${data.id}`,
  };
}

/**
 * Resolves the nested folder hierarchy for an employee screenshot:
 * Main App Folder (e.g. "WorkMonitor_Captures") -> Employee Folder (e.g. "John_Doe") -> Date Folder (e.g. "2026-09-08")
 * Returns the Date folder ID so screenshots strictly save INSIDE the date folder.
 */
export async function resolveEmployeeDateFolder(
  accessToken: string,
  rootParentId: string | undefined,
  userName: string,
  dateKey: string
): Promise<{ rootFolderId: string; userFolderId: string; dateFolderId: string }> {
  // 1. Root main directory
  const rootFolderId = rootParentId || await getOrCreateFolder(accessToken, 'WorkMonitor_Records');

  // 2. User specific folder
  const sanitizedUserName = userName.trim().replace(/[/\\?%*:|"<>]/g, '_') || 'Employee';
  const userFolderId = await getOrCreateFolder(accessToken, sanitizedUserName, rootFolderId);

  // 3. Date specific folder INSIDE the user folder
  const dateFolderId = await getOrCreateFolder(accessToken, dateKey, userFolderId);

  return { rootFolderId, userFolderId, dateFolderId };
}

/**
 * Permanently deletes a file or folder from Google Drive
 */
export async function deleteDriveFileOrFolder(accessToken: string, fileId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.ok || res.status === 404;
  } catch (err) {
    console.warn(`Failed to delete Drive file/folder ${fileId}:`, err);
    return false;
  }
}

/**
 * Finds and deletes the employee's main folder and all contained screenshots from Google Drive
 */
export async function deleteEmployeeDriveFolder(
  accessToken: string,
  rootParentId: string | undefined,
  userName: string
): Promise<boolean> {
  try {
    const sanitizedUserName = userName.trim().replace(/[/\\?%*:|"<>]/g, '_') || 'Employee';
    let query = `name = '${sanitizedUserName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    if (rootParentId) {
      query += ` and '${rootParentId}' in parents`;
    }

    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)&spaces=drive`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!searchRes.ok) return false;
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      for (const folder of searchData.files) {
        await deleteDriveFileOrFolder(accessToken, folder.id);
      }
      return true;
    }
    return false;
  } catch (e) {
    console.warn(`Error deleting employee Drive folder for ${userName}:`, e);
    return false;
  }
}


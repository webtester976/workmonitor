/**
 * Google Workspace Provisioner
 * Automatically provisions:
 * 1. Root Drive Folder: WorkMonitor_Records
 * 2. Employee-wise Drive Folder: WorkMonitor_Records / [Employee Name]
 * 3. Daily Date Drive Folder: WorkMonitor_Records / [Employee Name] / [YYYY-MM-DD]
 * 4. Master Google Spreadsheet: Employee_Time_Tracking_Master
 * 5. Registered_Staff tab with employee's profile
 * 6. Employee-specific Tab: [Employee Name] with all tracking header columns
 */

import { getOrCreateFolder, deleteEmployeeDriveFolder } from './driveService';
import {
  getOrCreateSpreadsheet,
  ensureSheetTab,
  logEmployeeRegistrationToSheet,
  updateUserPasswordInSheet,
  deleteEmployeeSheetTab,
} from './sheetService';
import { getTodayDateKey } from './utils';
import { AppUser } from '../types';

export interface ProvisioningResult {
  success: boolean;
  message: string;
  rootFolderId?: string;
  employeeFolderId?: string;
  dateFolderId?: string;
  spreadsheetId?: string;
  employeeTab?: string;
  error?: string;
}

export interface GoogleAccountInfo {
  name: string;
  email: string;
  photoUrl?: string;
}

/**
 * Validates Google OAuth Access Token and retrieves account profile
 */
export async function verifyGoogleAccessToken(accessToken: string): Promise<{ valid: boolean; user?: GoogleAccountInfo; error?: string }> {
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const errText = await res.text();
      return { valid: false, error: `Invalid or expired token (${res.status}): ${errText}` };
    }

    const data = await res.json();
    return {
      valid: true,
      user: {
        name: data.user?.displayName || 'Google User',
        email: data.user?.emailAddress || '',
        photoUrl: data.user?.photoLink,
      },
    };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Network error verifying token' };
  }
}

/**
 * Provision folders in Google Drive and tabs in Google Sheets for a specific employee
 */
export async function provisionEmployeeWorkspace(
  accessToken: string,
  employee: AppUser,
  spreadsheetTitle: string = 'Employee_Time_Tracking_Master',
  rootFolderName: string = 'WorkMonitor_Records'
): Promise<ProvisioningResult> {
  if (!accessToken) {
    return {
      success: false,
      message: 'No Google OAuth access token provided.',
      error: 'Access token missing',
    };
  }

  try {
    const todayKey = getTodayDateKey();
    const sanitizedName = employee.name.trim().replace(/[/\\?%*:|"<>]/g, '_') || 'Employee';

    // 1. Google Drive: Root Main Folder
    const rootFolderId = await getOrCreateFolder(accessToken, rootFolderName);

    // 2. Google Drive: Employee Folder
    const employeeFolderId = await getOrCreateFolder(accessToken, sanitizedName, rootFolderId);

    // 3. Google Drive: Date Folder
    const dateFolderId = await getOrCreateFolder(accessToken, todayKey, employeeFolderId);

    // 4. Google Sheets: Get or Create Master Spreadsheet
    const spreadsheetId = await getOrCreateSpreadsheet(accessToken, spreadsheetTitle);

    // 5. Google Sheets: Ensure Registered_Staff tab and record user
    await logEmployeeRegistrationToSheet(accessToken, spreadsheetId, employee);

    // 6. Google Sheets: Ensure Employee's dedicated Tab exists with formatted tracking headers
    await ensureSheetTab(accessToken, spreadsheetId, sanitizedName);

    // 7. Google Sheets: Ensure credentials tab contains the employee's active password
    try {
      await updateUserPasswordInSheet(accessToken, spreadsheetId, employee);
    } catch (passErr) {
      console.warn('Password sheet sync note:', passErr);
    }

    return {
      success: true,
      message: `Successfully provisioned Google Drive folder and Sheet tab for ${employee.name}!`,
      rootFolderId,
      employeeFolderId,
      dateFolderId,
      spreadsheetId,
      employeeTab: sanitizedName,
    };
  } catch (err: any) {
    console.error('Workspace provisioning error:', err);
    return {
      success: false,
      message: `Failed to provision workspace: ${err.message}`,
      error: err.message,
    };
  }
}

/**
 * Deprovisions / deletes an employee's folder in Google Drive and tab in Google Sheets
 */
export async function deprovisionEmployeeWorkspace(
  accessToken: string,
  employee: AppUser,
  spreadsheetTitle: string = 'Employee_Time_Tracking_Master',
  rootFolderName: string = 'WorkMonitor_Records'
): Promise<{ driveDeleted: boolean; sheetDeleted: boolean }> {
  let driveDeleted = false;
  let sheetDeleted = false;

  if (!accessToken) return { driveDeleted, sheetDeleted };

  try {
    // 1. Delete Google Drive Folder for the user
    driveDeleted = await deleteEmployeeDriveFolder(accessToken, undefined, employee.name);
  } catch (err) {
    console.warn(`Drive folder deprovisioning error for ${employee.name}:`, err);
  }

  try {
    // 2. Delete employee tab in Google Sheets
    const spreadsheetId = await getOrCreateSpreadsheet(accessToken, spreadsheetTitle);
    sheetDeleted = await deleteEmployeeSheetTab(accessToken, spreadsheetId, employee.name);
  } catch (err) {
    console.warn(`Sheet tab deprovisioning error for ${employee.name}:`, err);
  }

  return { driveDeleted, sheetDeleted };
}


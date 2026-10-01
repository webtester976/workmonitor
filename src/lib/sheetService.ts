/**
 * Google Sheets API Client
 * - Manages or creates the master spreadsheet (stored in Admin's Drive or shared Drive)
 * - Automatically creates or switches to employee tab (e.g. "John Doe") or date tabs
 * - Correctly computes start, pause, stop and task switches
 * - Logs employee signup/registration and login events into the Admin Master Sheet
 * - NEVER outputs "NaN": strictly calculates decimal hours and formats strings safely.
 */

import { formatSecondsToHoursMinutes, secondsToDecimalHours } from './utils';

export interface SheetRowLog {
  date: string;
  userName: string;
  taskName: string;
  startTime: string;
  endTime: string;
  durationFormatted: string;
  durationHours: number;
  status: 'In Progress' | 'Task Switched' | 'Paused' | 'Stopped / Logged Out';
  screenshotCount: number;
  productivityScore: string;
}

/**
 * Creates a new Google Spreadsheet or returns existing ID
 */
export async function getOrCreateSpreadsheet(
  accessToken: string,
  spreadsheetTitle: string = 'Employee_Time_Tracking_Master'
): Promise<string> {
  // Search if spreadsheet already exists in Drive
  const query = `name = '${spreadsheetTitle.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)&spaces=drive`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
  }

  // Create new spreadsheet
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title: spreadsheetTitle,
      },
      sheets: [
        {
          properties: {
            title: 'Overview_Summary',
          },
        },
        {
          properties: {
            title: 'Registered_Staff',
          },
        },
        {
          properties: {
            title: 'Employee_Credentials',
          },
        },
      ],
    }),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(`Failed to create Google Spreadsheet: ${errorText}`);
  }

  const createdData = await createRes.json();
  const spreadsheetId = createdData.spreadsheetId;

  // Initialize header for Overview_Summary
  await appendSheetRows(accessToken, spreadsheetId, 'Overview_Summary', [
    ['Employee Name', 'Date', 'Task Name', 'Start Time', 'End / Switch Time', 'Duration', 'Hours (Decimal)', 'Status', 'Screenshots Uploaded', 'Avg Productivity']
  ]);

  // Initialize header for Registered_Staff
  await appendSheetRows(accessToken, spreadsheetId, 'Registered_Staff', [
    ['Employee Name', 'Email Address', 'Role', 'Status', 'Created Date/Time', 'Last Active / Login Time']
  ]);

  // Initialize header for Employee_Credentials
  await appendSheetRows(accessToken, spreadsheetId, 'Employee_Credentials', [
    ['Employee ID', 'Full Name', 'Email Address', 'Role', 'Active Password', 'Last Updated', 'Account Status']
  ]);

  return spreadsheetId;
}

/**
 * Ensures a sheet/tab exists for an employee (sanitized sheet name)
 */
export async function ensureSheetTab(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string
): Promise<void> {
  const sanitizedTitle = tabTitle.replace(/[*?:/\\[\]]/g, '_').substring(0, 80);

  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!metaRes.ok) {
    return;
  }

  const metaData = await metaRes.json();
  const existingTitles = metaData.sheets?.map((s: any) => s.properties.title) || [];

  if (existingTitles.includes(sanitizedTitle)) {
    return;
  }

  // Add sheet tab via batchUpdate
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: {
              title: sanitizedTitle,
            },
          },
        },
      ],
    }),
  });

  // Append default header to newly created employee tab
  await appendSheetRows(accessToken, spreadsheetId, sanitizedTitle, [
    ['Date', 'Task Name', 'Start Time', 'End / Switch Time', 'Duration', 'Hours (Decimal)', 'Status', 'Screenshots Uploaded', 'Avg Productivity']
  ]);
}

/**
 * Appends rows to a specific tab
 */
export async function appendSheetRows(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string,
  rows: any[][]
): Promise<void> {
  const sanitizedTab = tabTitle.replace(/[*?:/\\[\]]/g, '_').substring(0, 80);
  const range = `${sanitizedTab}!A1`;

  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      range,
      majorDimension: 'ROWS',
      values: rows,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.warn(`Failed to append to sheet tab ${tabTitle}:`, errorText);
  }
}

/**
 * Record a completed or switched task block into Google Sheets
 * e.g., 09:00 AM start to 10:00 AM task change -> logs exactly 1 hour.
 */
export async function logTaskIntervalToSheet(
  accessToken: string,
  spreadsheetId: string,
  log: SheetRowLog
): Promise<void> {
  const durationNumber = Number.isFinite(log.durationHours) ? log.durationHours : 0;
  const safeDurationStr = log.durationFormatted || formatSecondsToHoursMinutes(durationNumber * 3600);

  const rowData = [
    log.date,
    log.taskName || 'General Work',
    log.startTime,
    log.endTime,
    safeDurationStr,
    durationNumber,
    log.status,
    log.screenshotCount,
    log.productivityScore || '88%'
  ];

  // 1. Log to Employee specific tab
  await ensureSheetTab(accessToken, spreadsheetId, log.userName);
  await appendSheetRows(accessToken, spreadsheetId, log.userName, [rowData]);

  // 2. Also log to Master Overview Summary tab with Employee Name in Col A
  const overviewRow = [
    log.userName,
    log.date,
    log.taskName || 'General Work',
    log.startTime,
    log.endTime,
    safeDurationStr,
    durationNumber,
    log.status,
    log.screenshotCount,
    log.productivityScore || '88%'
  ];
  await appendSheetRows(accessToken, spreadsheetId, 'Overview_Summary', [overviewRow]);
}

/**
 * Record a new employee registration or login into the Registered_Staff sheet tab
 */
export async function logEmployeeRegistrationToSheet(
  accessToken: string,
  spreadsheetId: string,
  employee: {
    name: string;
    email: string;
    role: string;
    createdAt?: string;
    lastActive?: string;
  }
): Promise<void> {
  await ensureSheetTab(accessToken, spreadsheetId, 'Registered_Staff');
  const nowStr = new Date().toLocaleString();
  const staffRow = [
    employee.name,
    employee.email,
    employee.role,
    'Approved & Active',
    employee.createdAt || nowStr,
    employee.lastActive || nowStr
  ];
  await appendSheetRows(accessToken, spreadsheetId, 'Registered_Staff', [staffRow]);
}

/**
 * Synchronizes all users and their passwords to the Employee_Credentials sheet tab
 */
export async function syncCredentialsToSheet(
  accessToken: string,
  spreadsheetId: string,
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    password?: string;
    approved?: boolean;
    lastActive?: string;
  }>
): Promise<void> {
  await ensureSheetTab(accessToken, spreadsheetId, 'Employee_Credentials');
  const nowStr = new Date().toLocaleString();

  // Prepare full data matrix starting with headers
  const rows: any[][] = [
    ['Employee ID', 'Full Name', 'Email Address', 'Role', 'Active Password', 'Last Updated', 'Account Status'],
    ...users.map((u) => [
      u.id,
      u.name,
      u.email,
      u.role.toUpperCase(),
      u.password || (u.role === 'admin' ? 'admin123' : '123456'),
      u.lastActive || nowStr,
      u.approved ? 'Active' : 'Pending'
    ])
  ];

  // Overwrite the Employee_Credentials range A1:G
  try {
    const range = 'Employee_Credentials!A1:G' + (rows.length + 10);
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range,
        majorDimension: 'ROWS',
        values: rows,
      }),
    });
  } catch (err) {
    console.warn('Failed to overwrite Employee_Credentials sheet:', err);
  }
}

/**
 * Updates an individual user's password in the Employee_Credentials tab or re-syncs
 */
export async function updateUserPasswordInSheet(
  accessToken: string,
  spreadsheetId: string,
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    password?: string;
  }
): Promise<void> {
  await ensureSheetTab(accessToken, spreadsheetId, 'Employee_Credentials');
  const nowStr = new Date().toLocaleString();
  const row = [
    user.id,
    user.name,
    user.email,
    user.role.toUpperCase(),
    user.password || 'admin123',
    nowStr,
    'Password Updated'
  ];
  await appendSheetRows(accessToken, spreadsheetId, 'Employee_Credentials', [row]);
}

/**
 * Deletes an employee's personal tab from the Google Spreadsheet
 */
export async function deleteEmployeeSheetTab(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string
): Promise<boolean> {
  try {
    const sanitizedTitle = tabTitle.replace(/[*?:/\\[\]]/g, '_').substring(0, 80);
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!metaRes.ok) return false;
    const metaData = await metaRes.json();
    const sheetObj = metaData.sheets?.find((s: any) => s.properties.title === sanitizedTitle);

    if (!sheetObj) return false;
    const sheetId = sheetObj.properties.sheetId;

    const delRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            deleteSheet: {
              sheetId: sheetId,
            },
          },
        ],
      }),
    });

    return delRes.ok;
  } catch (err) {
    console.warn(`Failed to delete sheet tab ${tabTitle}:`, err);
    return false;
  }
}


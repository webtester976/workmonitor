import { AppUser, PendingSignup, StorageSettings } from '../types';

const USERS_KEY = 'wm_app_users_v2';
const PENDING_SIGNUPS_KEY = 'wm_pending_signups_v2';
const SETTINGS_KEY = 'wm_storage_settings_v2';
const CURRENT_USER_KEY = 'wm_active_session_v2';

export const DEFAULT_ADMIN: AppUser = {
  id: 'admin-master',
  name: 'Henish (Main Admin)',
  email: 'henish@codesdot.com',
  password: 'Henish$@9090',
  role: 'admin',
  approved: true,
  createdAt: '2026-09-01T08:00:00.000Z',
  lastActive: new Date().toISOString(),
};

// No demo employee accounts are seeded anymore.
export const DEFAULT_EMPLOYEES: AppUser[] = [];

export const DEFAULT_STORAGE_SETTINGS: StorageSettings = {
  destinationMode: 'central_admin_drive',
  centralAdminEmail: 'henish@codesdot.com',
  centralFolderName: 'WorkMonitor_Records',
  screenshotFormat: 'webp',
  autoCaptureIntervalMinutes: 10,
  captureIntervalSeconds: 600,
  captureMode: 'random_count_window' as any,
  allowedIntervals: [10, 60, 120, 300, 600, 900],
  lockIntervalForEmployees: true,
  spreadsheetName: 'Employee_Time_Tracking_Master',
  showWorkspaceDiagnostics: false,
};

const normalizeAdmin = (users: AppUser[]): AppUser[] => {
  const employees = users.filter((user) => user.role !== 'admin');
  return [
    {
      ...DEFAULT_ADMIN,
      lastActive: DEFAULT_ADMIN.lastActive,
    },
    ...employees,
  ];
};

export function getStoredUsers(): AppUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);

    if (!raw) {
      const initial = [DEFAULT_ADMIN];
      localStorage.setItem(USERS_KEY, JSON.stringify(initial));
      return initial;
    }

    const parsed: AppUser[] = JSON.parse(raw);
    const normalized = normalizeAdmin(parsed);

    // Persist migration from old admin email/password automatically.
    localStorage.setItem(USERS_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return [DEFAULT_ADMIN];
  }
}

export function saveStoredUsers(users: AppUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(normalizeAdmin(users)));
}

export function getPendingSignups(): PendingSignup[] {
  try {
    const raw = localStorage.getItem(PENDING_SIGNUPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePendingSignups(signups: PendingSignup[]) {
  localStorage.setItem(PENDING_SIGNUPS_KEY, JSON.stringify(signups));
}

export function getStorageSettings(): StorageSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : {};

    return {
      ...DEFAULT_STORAGE_SETTINGS,
      ...saved,
      centralAdminEmail: 'henish@codesdot.com',
    };
  } catch {
    return DEFAULT_STORAGE_SETTINGS;
  }
}

export function saveStorageSettings(settings: StorageSettings) {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      ...settings,
      centralAdminEmail: 'henish@codesdot.com',
    })
  );
}

export function getActiveSessionUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    if (!raw) return null;

    const user: AppUser = JSON.parse(raw);

    // Invalidate any stale old-admin session so the new credentials are used.
    if (user.role === 'admin') {
      if (user.email.toLowerCase() !== DEFAULT_ADMIN.email.toLowerCase()) {
        localStorage.removeItem(CURRENT_USER_KEY);
        return null;
      }

      return {
        ...DEFAULT_ADMIN,
        lastActive: user.lastActive || DEFAULT_ADMIN.lastActive,
      };
    }

    return user;
  } catch {
    return null;
  }
}

export function setActiveSessionUser(user: AppUser | null) {
  if (user) {
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(CURRENT_USER_KEY);
  }
}

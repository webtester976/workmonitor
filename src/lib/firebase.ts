import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
  Auth,
} from 'firebase/auth';
import {
  getFirestore,
  Firestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  deleteDoc,
  getDocFromServer,
  where,
  getDocs,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { AppUser, PendingSignup, StorageSettings, ScreenshotLog } from '../types';

let auth: Auth | null = null;
let db: Firestore | null = null;
let provider: GoogleAuthProvider | null = null;

try {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  
  // Connect to the specific Firestore database ID configured for this project
  const dbId = (firebaseConfig as any).firestoreDatabaseId;
  db = dbId ? getFirestore(app, dbId) : getFirestore(app);

  provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.file');
  provider.addScope('https://www.googleapis.com/auth/spreadsheets');
  provider.setCustomParameters({ prompt: 'select_account' });
} catch (e) {
  console.warn('Firebase initialization notice:', e);
}

export { auth, db };

// Helper to prevent any Firestore call from hanging indefinitely
function withTimeout<T>(promise: Promise<T>, ms: number = 4000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Firestore request timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

let cachedAccessToken: string | null = null;
let isSigningIn = false;

// Test server connection to Firestore as mandated by skill
export async function testFirestoreConnection() {
  if (!db) return false;
  try {
    await getDocFromServer(doc(db, 'settings', 'storage'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore offline or pending connection.');
    }
    return false;
  }
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  if (!auth) {
    if (onAuthFailure) onAuthFailure();
    return () => {};
  }

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const requestGoogleTokenViaGSI = (): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Browser environment required.'));
      return;
    }

    const gsi = (window as any).google?.accounts?.oauth2;
    const clientId = firebaseConfig.oAuthClientId;

    if (!gsi) {
      reject(new Error('Google Identity Services is initializing. Please try again in 2 seconds.'));
      return;
    }

    if (!clientId) {
      reject(new Error('OAuth Client ID is missing in configuration.'));
      return;
    }

    try {
      const tokenClient = gsi.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets',
        prompt: 'consent',
        callback: (resp: any) => {
          if (resp.error) {
            reject(new Error(`OAuth error: ${resp.error_description || resp.error}`));
            return;
          }
          if (resp.access_token) {
            setCachedToken(resp.access_token);
            resolve(resp.access_token);
          } else {
            reject(new Error('No access token returned by Google.'));
          }
        },
        error_callback: (err: any) => {
          reject(new Error(err.message || 'Google OAuth prompt closed or blocked.'));
        },
      });

      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (err: any) {
      reject(err);
    }
  });
};

export const googleSignIn = async (): Promise<{ user?: User; accessToken: string } | null> => {
  // 1. First attempt Google Identity Services (fast, modern popup, avoids iframe domain blocks)
  try {
    const gsiToken = await requestGoogleTokenViaGSI();
    if (gsiToken) {
      return { accessToken: gsiToken };
    }
  } catch (gsiErr: any) {
    console.warn('GSI token attempt note, trying Firebase popup fallback:', gsiErr.message);
  }

  // 2. Fallback to Firebase GoogleAuthProvider popup
  if (!auth || !provider) {
    throw new Error('Google Authentication is not configured or initialized.');
  }

  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google access token with requested scopes.');
    }

    cachedAccessToken = credential.accessToken;
    // Persist to session storage so refresh retains Google Sheets/Drive connectivity
    try {
      sessionStorage.setItem('wm_google_access_token', cachedAccessToken);
    } catch {}

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (!cachedAccessToken) {
    try {
      cachedAccessToken = sessionStorage.getItem('wm_google_access_token');
    } catch {}
  }
  return cachedAccessToken;
};

export const setCachedToken = (token: string) => {
  cachedAccessToken = token;
  try {
    sessionStorage.setItem('wm_google_access_token', token);
  } catch {}
};

export const logoutGoogle = async () => {
  if (auth) {
    await signOut(auth);
  }
  cachedAccessToken = null;
  try {
    sessionStorage.removeItem('wm_google_access_token');
  } catch {}
};

// ==========================================
// REAL-TIME FIRESTORE DATA SYNC HELPERS
// Enables shared links where employees register,
// admin gets real-time alerts, logs sync to Sheets & Drive
// ==========================================

export function subscribeToUsers(callback: (users: AppUser[]) => void) {
  if (!db) return () => {};
  const q = collection(db, 'users');
  return onSnapshot(q, (snapshot) => {
    const users: AppUser[] = [];
    snapshot.forEach((docSnap) => {
      users.push(docSnap.data() as AppUser);
    });
    callback(users);
  }, (err) => {
    console.warn('Users sync note:', err.message);
  });
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  if (!db) return null;
  try {
    const q = query(collection(db, 'users'), where('email', '==', email.trim().toLowerCase()), limit(1));
    const snap = await withTimeout(getDocs(q), 5000);
    if (snap.empty) return null;
    return snap.docs[0].data() as AppUser;
  } catch (e) {
    console.warn('Failed to load user from Firestore:', e);
    return null;
  }
}

export async function syncUserToFirestore(user: AppUser) {
  if (!db) return;
  try {
    await withTimeout(setDoc(doc(db, 'users', user.id), user, { merge: true }), 3500);
  } catch (e) {
    console.warn('Failed to sync user to Firestore:', e);
  }
}

export function subscribeToPendingSignups(callback: (signups: PendingSignup[]) => void) {
  if (!db) return () => {};
  const q = collection(db, 'pendingSignups');
  return onSnapshot(q, (snapshot) => {
    const list: PendingSignup[] = [];
    snapshot.forEach((docSnap) => {
      list.push(docSnap.data() as PendingSignup);
    });
    callback(list);
  }, (err) => {
    console.warn('Pending signups sync note:', err.message);
  });
}

export async function addPendingSignupToFirestore(signup: PendingSignup) {
  if (!db) return;
  try {
    await withTimeout(setDoc(doc(db, 'pendingSignups', signup.id), signup), 3500);
  } catch (e) {
    console.warn('Failed to add pending signup to Firestore:', e);
  }
}

export async function removePendingSignupFromFirestore(signupId: string) {
  if (!db) return;
  try {
    await withTimeout(deleteDoc(doc(db, 'pendingSignups', signupId)), 3500);
  } catch (e) {
    console.warn('Failed to remove pending signup:', e);
  }
}

export function subscribeToStorageSettings(callback: (settings: StorageSettings) => void) {
  if (!db) return () => {};
  const ref = doc(db, 'settings', 'storage');
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      callback(snap.data() as StorageSettings);
    }
  }, (err) => {
    console.warn('Storage settings sync note:', err.message);
  });
}

export async function saveStorageSettingsToFirestore(settings: StorageSettings) {
  if (!db) return;
  try {
    await withTimeout(setDoc(doc(db, 'settings', 'storage'), settings, { merge: true }), 3500);
  } catch (e) {
    console.warn('Failed to save storage settings to Firestore:', e);
  }
}

export function subscribeToScreenshots(callback: (screenshots: ScreenshotLog[]) => void) {
  if (!db) return () => {};
  const q = query(collection(db, 'screenshots'), orderBy('timestamp', 'desc'), limit(100));
  return onSnapshot(q, (snapshot) => {
    const list: ScreenshotLog[] = [];
    snapshot.forEach((docSnap) => {
      list.push(docSnap.data() as ScreenshotLog);
    });
    callback(list);
  }, (err) => {
    console.warn('Screenshots sync note:', err.message);
  });
}

export async function logScreenshotToFirestore(screen: ScreenshotLog) {
  if (!db) return;
  try {
    const record = { ...screen };
    // Never slice base64 strings! Slicing cuts off image bytes and corrupts rendering into broken black boxes.
    // The screen's previewDataUrl is generated via generateThumbnailDataUrl (~15-25KB), which safely fits Firestore.
    // If an oversized string (>350KB) is passed, clear it only if Drive link exists, rather than corrupting the data.
    if (record.previewDataUrl && record.previewDataUrl.length > 350000) {
      if (record.driveThumbnailLink || record.driveFileId) {
        record.previewDataUrl = '';
      }
    }
    await withTimeout(setDoc(doc(db, 'screenshots', screen.id), record), 3500);
  } catch (e) {
    console.warn('Failed to log screenshot to Firestore:', e);
    throw e;
  }
}

export async function deleteUserFromFirestore(userId: string) {
  if (!db) return;
  try {
    await withTimeout(deleteDoc(doc(db, 'users', userId)), 4000);
  } catch (e) {
    console.warn('Failed to delete user from Firestore:', e);
  }
}

export async function deleteScreenshotsForUserFromFirestore(userId: string) {
  if (!db) return;
  try {
    const q = query(collection(db, 'screenshots'), where('userId', '==', userId));
    const snap = await withTimeout(getDocs(q), 5000);
    const deletePromises = snap.docs.map((d) => deleteDoc(d.ref));
    await Promise.all(deletePromises);
  } catch (e) {
    console.warn('Failed to delete user screenshots from Firestore:', e);
  }
}


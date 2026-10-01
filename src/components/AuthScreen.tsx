import React, { useState } from 'react';
import { AppUser } from '../types';
import {
  getStoredUsers,
  saveStoredUsers,
  setActiveSessionUser,
} from '../lib/userStore';
import {
  ShieldCheck,
  User,
  Lock,
  Eye,
  EyeOff,
  KeyRound,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  Sparkles,
  FolderPlus,
  RotateCcw,
  Clock
} from 'lucide-react';

interface AuthScreenProps {
  onLoginSuccess: (user: AppUser) => void;
  onAdminConfirmationDispatched?: (code: string) => void;
  allUsers?: AppUser[];
}

const getBackendUrl = () => {
  const configured = import.meta.env.VITE_BACKEND_URL?.trim();

  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (import.meta.env.DEV) {
    return 'https://localhost:3001';
  }

  throw new Error(
    'Admin backend URL is not configured. Please set VITE_BACKEND_URL.'
  );
};

const ADMIN_EMAIL = 'henish@codesdot.com';
const ADMIN_PASSWORD = 'Henish$@9090';

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onLoginSuccess,
}) => {
  const [mode, setMode] = useState<
    'admin_login' | 'employee_login' | 'employee_signup' | 'reset_password' | 'change_password'
  >('employee_login');

  // Form states
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [statusNotice, setStatusNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signupWaiting, setSignupWaiting] = useState(false);

  // Switch mode
  const handleSwitchMode = (
    newMode: 'admin_login' | 'employee_login' | 'employee_signup' | 'reset_password' | 'change_password'
  ) => {
    setMode(newMode);
    setErrorMsg('');
    setStatusNotice('');
    setPassword('');
    setConfirmPassword('');
    setOldPassword('');
    setNewPassword('');
    setShowPassword(false);
    setAdminPassword('');
    if (newMode !== 'employee_signup') setSignupWaiting(false);
  };

  // ADMIN LOGIN
  const handleAdminLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    setErrorMsg('');
    setStatusNotice('');

    const targetEmail = email.trim().toLowerCase();

    if (!targetEmail) {
      setErrorMsg('Please enter your admin email address.');
      return;
    }

    if (!adminPassword) {
      setErrorMsg('Please enter your admin password.');
      return;
    }

    if (
      targetEmail !== ADMIN_EMAIL.toLowerCase() ||
      adminPassword !== ADMIN_PASSWORD
    ) {
      setErrorMsg('Incorrect admin email or password.');
      return;
    }

    const users = getStoredUsers();
    const existingAdmin = users.find((u) => u.role === 'admin');

    const admin: AppUser = {
      ...(existingAdmin || {}),
      id: 'admin-master',
      name: 'Henish (Main Admin)',
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: 'admin',
      approved: true,
      createdAt:
        existingAdmin?.createdAt || new Date().toISOString(),
      lastActive: new Date().toISOString(),
    };

    const employees = users.filter((u) => u.role !== 'admin');
    saveStoredUsers([admin, ...employees]);
    setActiveSessionUser(admin);
    onLoginSuccess(admin);
  };

  // EMPLOYEE LOGIN - CENTRAL ADMIN BACKEND
  const handleEmployeeLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    setErrorMsg('');
    setStatusNotice('');

    const targetEmail = email.trim().toLowerCase();

    if (!targetEmail) {
      setErrorMsg('Please enter your employee email address.');
      return;
    }

    if (!password) {
      setErrorMsg('Password is required. Please enter your password to log in.');
      return;
    }

    setIsSubmitting(true);
    setStatusNotice('Authenticating with the central Admin PC...');

    try {
      const backendUrl = getBackendUrl();

      const response = await fetch(`${backendUrl}/api/login-employee`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: targetEmail,
          password,
        }),
      });

      let data: any = null;

      try {
        data = await response.json();
      } catch {
        // Keep a friendly fallback message below if backend did not return JSON.
      }

      if (!response.ok || !data?.success || !data?.employee) {
        throw new Error(
          data?.error ||
          (response.status === 401
            ? 'Invalid email or password.'
            : `Central login failed (${response.status}).`)
        );
      }

      const centralEmployee = data.employee;

      const employee: AppUser = {
        id: centralEmployee.id,
        name: centralEmployee.name,
        email: String(centralEmployee.email || targetEmail).trim().toLowerCase(),
        password: centralEmployee.password || password,
        role: 'employee',
        approved: true,
        createdAt: centralEmployee.createdAt || new Date().toISOString(),
        lastActive: new Date().toISOString(),
      };

      // Cache the central employee account for this workstation session.
      const localUsers = getStoredUsers();
      const withoutOldCopy = localUsers.filter(
        (u) =>
          u.id !== employee.id &&
          u.email.toLowerCase() !== employee.email.toLowerCase()
      );

      saveStoredUsers([...withoutOldCopy, employee]);
      setActiveSessionUser(employee);

      setStatusNotice(`✅ Welcome back, ${employee.name}!`);
      onLoginSuccess(employee);
    } catch (err: any) {
      console.error('Central employee login error:', err);

      const message = String(err?.message || '');

      if (
        message.includes('Failed to fetch') ||
        message.includes('NetworkError') ||
        message.includes('fetch')
      ) {
        setErrorMsg(
          'Cannot reach the central Admin PC login server. Please confirm the Admin PC frontend/backend are running and this PC trusts the HTTPS certificate.'
        );
      } else {
        setErrorMsg(message || 'Unable to log in. Please verify your email and password.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // EMPLOYEE SIGN UP - SEND REQUEST AND WAIT FOR ADMIN APPROVAL
  const handleDirectEmployeeSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    setErrorMsg('');
    setStatusNotice('');

    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();
    const trimmedName = `${trimmedFirstName} ${trimmedLastName}`.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (!trimmedFirstName || !trimmedLastName || !normalizedEmail) {
      setErrorMsg('Please enter your first name, last name and email address.');
      return;
    }

    if (!password) {
      setErrorMsg('Please create a password for your account.');
      return;
    }

    if (password.length < 4) {
      setErrorMsg('Password must be at least 4 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match. Please verify your password confirmation.');
      return;
    }

    setIsSubmitting(true);
    setStatusNotice('Sending your signup request to the Admin PC...');

    try {
      const backendUrl = getBackendUrl();
      const proposedId = `pending-${Date.now()}`;

      const response = await fetch(`${backendUrl}/api/request-signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: proposedId,
          firstName: trimmedFirstName,
          lastName: trimmedLastName,
          name: trimmedName,
          email: normalizedEmail,
          password,
        }),
      });

      let data: any = null;
      try {
        data = await response.json();
      } catch {
        // Friendly fallback below.
      }

      if (!response.ok || !data?.success) {
        if (data?.pending) {
          setSignupWaiting(true);
          setStatusNotice('');
          return;
        }

        throw new Error(
          data?.error || `Signup request failed (${response.status}).`
        );
      }

      // IMPORTANT: do not create local account, do not login, and do not create folders here.
      // The Admin must approve this request first.
      setSignupWaiting(true);
      setStatusNotice('');
      setPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      console.error('Central signup request error:', err);

      const message = String(err?.message || '');
      if (
        message.includes('Failed to fetch') ||
        message.includes('NetworkError') ||
        message.includes('fetch')
      ) {
        setErrorMsg(
          'Cannot reach the central Admin PC signup server. Please confirm the Admin PC frontend/backend are running and this PC trusts the HTTPS certificate.'
        );
      } else {
        setErrorMsg(message || 'Failed to send signup request.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // PASSWORD RESET
  // Central employee passwords are managed by the Admin/backend.
  // We do not expose or apply a default password in the UI.
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusNotice(
      'Please contact the administrator to reset your account password.'
    );
  };

  // PASSWORD CHANGE: local account password update
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusNotice('');

    const targetEmail = email.trim().toLowerCase();
    if (!targetEmail) {
      setErrorMsg('Please enter your account email address.');
      return;
    }

    if (!oldPassword) {
      setErrorMsg('Please enter your current (old) password.');
      return;
    }

    if (!newPassword || newPassword.length < 4) {
      setErrorMsg('New password must be at least 4 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('New password and confirmation do not match.');
      return;
    }

    const users = getStoredUsers();
    let targetUser = users.find((u) => u.email.toLowerCase() === targetEmail);

    if (!targetUser) {
      setErrorMsg('No account found with this email address.');
      return;
    }

    // Verify old password
    const currentExpectedPassword = targetUser.password || (targetUser.role === 'admin' ? ADMIN_PASSWORD : '');
    if (oldPassword !== currentExpectedPassword) {
      setErrorMsg('Old password is incorrect. Please verify your current password.');
      return;
    }

    setIsSubmitting(true);
    try {
      targetUser.password = newPassword;
      targetUser.lastActive = new Date().toISOString();
      saveStoredUsers(users);

      setStatusNotice('✅ Password changed successfully on this workstation.');
      setPassword(newPassword);
    } catch (err: any) {
      setErrorMsg(`Failed to update password: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <div className="w-full max-w-lg mx-auto py-8 px-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-600 text-white shadow-lg font-black text-xl mb-1">
            WM
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Employee WorkStation
          </h1>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Central LAN employee time tracking and screenshot monitoring.
          </p>
        </div>

        {/* Role & Mode Switcher */}
        <div className="grid grid-cols-3 gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => handleSwitchMode('employee_login')}
            className={`py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
              mode === 'employee_login'
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Staff Login
          </button>
          <button
            type="button"
            onClick={() => handleSwitchMode('employee_signup')}
            className={`py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
              mode === 'employee_signup'
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            New Staff Sign-Up
          </button>
          <button
            type="button"
            onClick={() => handleSwitchMode('admin_login')}
            className={`py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
              mode === 'admin_login'
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Admin Portal
          </button>
        </div>

        {/* Notifications & Error alerts */}
        {errorMsg && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 text-xs rounded-xl flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {statusNotice && (
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-300 text-xs rounded-xl flex items-center gap-2">
            <RefreshCw className="w-4 h-4 shrink-0 animate-spin text-indigo-600" />
            <span>{statusNotice}</span>
          </div>
        )}

        {/* MODE 1: EMPLOYEE LOGIN (Requires Email and Password) */}
        {mode === 'employee_login' && (
          <form onSubmit={handleEmployeeLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Staff Email Address
              </label>
              <div className="relative">
                <input
                  id="employee-login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. david.miller@company.com"
                  required
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Password
                </label>
                <span className="text-[11px] text-slate-400">Required for access</span>
              </div>
              <div className="relative">
                <input
                  id="employee-login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your personal account password"
                  required
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex items-center justify-between pt-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => handleSwitchMode('reset_password')}
                  className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium cursor-pointer"
                >
                  Forgot / Reset to default?
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchMode('change_password')}
                  className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-medium cursor-pointer"
                >
                  Change password
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Logging in...</span>
                </>
              ) : (
                <>
                  <span>Log In & Start Tracking</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => handleSwitchMode('employee_signup')}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                New employee on this PC? Create your account & password →
              </button>
            </div>
          </form>
        )}

        {/* MODE 2: EMPLOYEE SIGN-UP (Name, Email, Password, Confirm Password) */}
        {mode === 'employee_signup' && (
          signupWaiting ? (
            <div className="space-y-4">
              <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-5 rounded-2xl text-center space-y-3">
                <Clock className="w-9 h-9 mx-auto text-amber-600" />
                <div>
                  <h3 className="text-base font-bold text-amber-950 dark:text-amber-200">Waiting for Admin Approval</h3>
                  <p className="text-xs text-amber-800 dark:text-amber-300 mt-2 leading-relaxed">
                    Your signup request has been sent successfully. Your account is not active yet and no employee folder has been created.
                    Please wait for the administrator to approve your request. After approval, you can use the same email and password from any trusted employee PC.
                  </p>
                </div>
                <div className="text-xs bg-white/70 dark:bg-slate-900/60 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">{`${firstName} ${lastName}`.trim() || 'Employee'}</div>
                  <div className="text-slate-500">{email}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleSwitchMode('employee_login')}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-md cursor-pointer"
              >
                Back to Staff Login
              </button>
            </div>
          ) : (
          <form onSubmit={handleDirectEmployeeSignup} className="space-y-4">
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-3 rounded-xl text-emerald-900 dark:text-emerald-200 text-xs flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <strong>Approval Required:</strong> Submit your details to the administrator. Your account and employee folder will be created only after approval.
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  First Name
                </label>
                <input
                  id="signup-first-name-input"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="e.g. David"
                  required
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Last Name
                </label>
                <input
                  id="signup-last-name-input"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="e.g. Miller"
                  required
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Email Address
              </label>
              <input
                id="signup-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. david.miller@company.com"
                required
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Create Account Password
              </label>
              <div className="relative">
                <input
                  id="signup-password-input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 4 characters"
                  required
                  minLength={4}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Confirm Password
              </label>
              <input
                id="signup-confirm-password-input"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                required
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Sending Request...</span>
                </>
              ) : (
                <>
                  <FolderPlus className="w-4 h-4" />
                  <span>Submit Sign-Up Request</span>
                </>
              )}
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => handleSwitchMode('employee_login')}
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
              >
                Already have an account? Sign in here →
              </button>
            </div>
          </form>
          )
        )}

        {/* MODE 3: ADMIN LOGIN */}
        {mode === 'admin_login' && (
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 p-3.5 rounded-xl text-indigo-900 dark:text-indigo-200 text-xs space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
                <span>Primary Administrator Portal</span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 text-[11px]">
                Secure administrator access for managing employee monitoring and capture policies.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Admin Email Address
              </label>
              <input
                id="admin-login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter admin email"
                required
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Admin Master Password
              </label>
              <div className="relative">
                <input
                  id="admin-login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Enter admin password"
                  required
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Enter Admin Dashboard</span>
            </button>
          </form>
        )}

        {/* MODE 4: RESET PASSWORD */}
        {mode === 'reset_password' && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3.5 rounded-xl text-amber-900 dark:text-amber-200 text-xs space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <RotateCcw className="w-4 h-4 text-amber-600" />
                <span>Password Reset</span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 text-[11px]">
                For security, no default password is shown or applied from this screen. Please contact the administrator to reset your account password.
              </p>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl transition shadow-md cursor-pointer"
            >
              Contact Administrator for Reset
            </button>

            <button
              type="button"
              onClick={() => handleSwitchMode('employee_login')}
              className="w-full text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
            >
              ← Back to Staff Login
            </button>
          </form>
        )}

        {/* MODE 5: CHANGE PASSWORD */}
        {mode === 'change_password' && (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 p-3.5 rounded-xl text-indigo-900 dark:text-indigo-200 text-xs space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-indigo-600" />
                <span>Change Your Password</span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 text-[11px]">
                Enter your existing old password and set a new password. The new password will update for the account stored on this workstation.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Account Email Address
              </label>
              <input
                id="change-password-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. employee@company.com"
                required
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Current (Old) Password
              </label>
              <input
                id="change-password-old"
                type={showPassword ? 'text' : 'password'}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="Enter your current password"
                required
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                New Password
              </label>
              <input
                id="change-password-new"
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 4 characters"
                required
                minLength={4}
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Confirm New Password
              </label>
              <input
                id="change-password-confirm"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your new password"
                required
                className="w-full text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Updating Password...</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>Update Password</span>
                </>
              )}
            </button>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => handleSwitchMode('employee_login')}
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
              >
                ← Back to Staff Login
              </button>
              <button
                type="button"
                onClick={() => handleSwitchMode('reset_password')}
                className="text-xs text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
              >
                Forgot old password? Request reset →
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
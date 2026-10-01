import React, { useEffect, useState } from 'react';
import { AppUser, PendingSignup, ScreenshotLog, StorageSettings } from './types';

import {
  getStoredUsers,
  saveStoredUsers,
  getPendingSignups,
  savePendingSignups,
  getStorageSettings,
  saveStorageSettings,
  getActiveSessionUser,
  setActiveSessionUser,
} from './lib/userStore';

import { apiFetch } from './lib/api';

import { AdminDashboard } from './components/AdminDashboard';
import { EmployeeDashboard } from './components/EmployeeDashboard';
import { AuthScreen } from './components/AuthScreen';

import {
  LogOut,
  Bell,
  Cloud,
} from 'lucide-react';


/* ==========================================================================
   CENTRAL CAPTURE SETTINGS MERGE
========================================================================== */

const mergeCentralCaptureSettings = (
  current: StorageSettings,
  central: any
): StorageSettings => ({
  ...current,

  captureMode:
    central?.captureMode ??
    current.captureMode,

  captureIntervalSeconds:
    central?.captureIntervalSeconds ??
    current.captureIntervalSeconds,

  autoCaptureIntervalMinutes:
    central?.autoCaptureIntervalMinutes ??
    current.autoCaptureIntervalMinutes,

  allowedIntervals:
    central?.allowedIntervals ??
    current.allowedIntervals,

  lockIntervalForEmployees:
    central?.lockIntervalForEmployees ??
    current.lockIntervalForEmployees,
});


/* ==========================================================================
   APP
========================================================================== */

export default function App() {
  const [currentUser, setCurrentUser] =
    useState<AppUser | null>(null);

  const [allUsers, setAllUsers] =
    useState<AppUser[]>([]);

  const [pendingSignups, setPendingSignups] =
    useState<PendingSignup[]>([]);

  const [storageSettings, setStorageSettings] =
    useState<StorageSettings>(
      getStorageSettings()
    );

  const [notificationMsg, setNotificationMsg] =
    useState('');

  const [screenshots, setScreenshots] =
    useState<ScreenshotLog[]>([]);


  /* ==========================================================================
     REFRESH CENTRAL EMPLOYEES + PENDING SIGNUPS
  ========================================================================== */

  const refreshCentralPeople = async () => {
    try {
      const [employeesRes, pendingRes] =
        await Promise.all([
          apiFetch(
            '/api/employees',
            {
              method: 'GET',
              cache: 'no-store',
            }
          ),

          apiFetch(
            '/api/pending-employees',
            {
              method: 'GET',
              cache: 'no-store',
            }
          ),
        ]);


      /* ----------------------------------------------------------------------
         EMPLOYEES
      ---------------------------------------------------------------------- */

      if (employeesRes.ok) {
        const data =
          await employeesRes.json();

        const centralEmployees: AppUser[] =
          Array.isArray(data?.employees)
            ? data.employees
            : [];

        setAllUsers((previous) => {
          const localAdmins =
            previous.filter(
              (user) =>
                user.role === 'admin'
            );

          const storedAdmins =
            getStoredUsers().filter(
              (user) =>
                user.role === 'admin'
            );

          const map =
            new Map<string, AppUser>();


          [
            ...storedAdmins,
            ...localAdmins,
          ].forEach((user) => {
            map.set(
              user.id,
              user
            );
          });


          centralEmployees.forEach(
            (user) => {
              map.set(
                user.id,
                {
                  ...user,

                  role: 'employee',

                  approved:
                    user.approved !== false,
                }
              );
            }
          );


          const merged =
            Array.from(
              map.values()
            );

          saveStoredUsers(
            merged
          );

          return merged;
        });
      }


      /* ----------------------------------------------------------------------
         PENDING SIGNUPS
      ---------------------------------------------------------------------- */

      if (pendingRes.ok) {
        const data =
          await pendingRes.json();

        const centralPending:
          PendingSignup[] =
          Array.isArray(data?.pending)
            ? data.pending
            : [];

        setPendingSignups(
          centralPending
        );

        savePendingSignups(
          centralPending
        );
      }

    } catch (error) {
      console.warn(
        'Central employee refresh failed:',
        error
      );
    }
  };


  /* ==========================================================================
     REFRESH CENTRAL CAPTURE SETTINGS
  ========================================================================== */

  const refreshCentralCaptureSettings =
    async () => {

      try {
        const response =
          await apiFetch(
            '/api/capture-settings',
            {
              method: 'GET',
              cache: 'no-store',
            }
          );


        if (!response.ok) {
          return;
        }


        const data =
          await response.json();


        if (!data?.settings) {
          return;
        }


        setStorageSettings(
          (previous) => {

            const merged =
              mergeCentralCaptureSettings(
                previous,
                data.settings
              );

            saveStorageSettings(
              merged
            );

            return merged;
          }
        );

      } catch (error) {
        console.warn(
          'Central capture settings refresh failed:',
          error
        );
      }
    };


  /* ==========================================================================
     INITIAL LOAD
  ========================================================================== */

  useEffect(() => {
    const loadedUsers =
      getStoredUsers();

    const loadedPending =
      getPendingSignups();


    setAllUsers(
      loadedUsers
    );

    setPendingSignups(
      loadedPending
    );

    setScreenshots([]);


    const sessionUser =
      getActiveSessionUser();


    if (sessionUser) {
      const freshUser =
        loadedUsers.find(
          (user) =>
            user.id ===
            sessionUser.id
        ) ||
        sessionUser;


      setCurrentUser(
        freshUser
      );
    }


    void refreshCentralPeople();

    void refreshCentralCaptureSettings();


    const peopleTimer =
      window.setInterval(
        refreshCentralPeople,
        5000
      );


    const settingsTimer =
      window.setInterval(
        refreshCentralCaptureSettings,
        5000
      );


    return () => {
      window.clearInterval(
        peopleTimer
      );

      window.clearInterval(
        settingsTimer
      );
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  /* ==========================================================================
     LOGOUT
  ========================================================================== */

  const handleLogout = () => {
    setActiveSessionUser(null);

    setCurrentUser(null);
  };


  /* ==========================================================================
     NEW SCREENSHOT
  ========================================================================== */

  const handleNewScreenshot = (
    log: ScreenshotLog
  ) => {

    setScreenshots(
      (previous) => {

        const withoutDuplicate =
          previous.filter(
            (item) =>
              item.id !== log.id
          );


        return [
          log,
          ...withoutDuplicate,
        ];
      }
    );
  };


  /* ==========================================================================
     ADMIN NOTIFICATION
  ========================================================================== */

  const handleAdminCodeDispatched =
    (_code: string) => {

      setNotificationMsg(
        'Admin Alert: A new employee signup request is waiting for approval.'
      );


      window.setTimeout(
        () =>
          setNotificationMsg(''),
        10000
      );


      void refreshCentralPeople();
    };


  /* ==========================================================================
     STORAGE SETTINGS UPDATE
  ========================================================================== */

  const handleStorageSettingsUpdate = (
    settings: StorageSettings
  ) => {

    setStorageSettings(
      settings
    );

    saveStorageSettings(
      settings
    );
  };


  /* ==========================================================================
     UI
  ========================================================================== */

  return (
    <div className="
      min-h-screen
      bg-slate-100
      dark:bg-slate-950
      text-slate-900
      dark:text-slate-100
      flex
      flex-col
    ">

      {/* ================================================================
          HEADER
      ================================================================= */}

      <header className="
        bg-white
        dark:bg-slate-900
        border-b
        border-slate-200
        dark:border-slate-800
        sticky
        top-0
        z-40
      ">

        <div className="
          max-w-7xl
          mx-auto
          px-4
          h-16
          flex
          items-center
          justify-between
        ">

          <div className="
            flex
            items-center
            gap-3
          ">

            <div className="
              w-10
              h-10
              rounded-xl
              bg-indigo-600
              text-white
              flex
              items-center
              justify-center
              font-black
              shadow
            ">
              WM
            </div>


            <div>

              <div className="
                text-sm
                font-bold
                tracking-tight
                text-slate-900
                dark:text-white
                flex
                items-center
                gap-2
              ">

                <span>
                  WorkMonitor Desktop
                </span>


                <span className="
                  bg-emerald-100
                  dark:bg-emerald-950/60
                  text-emerald-800
                  dark:text-emerald-300
                  text-[10px]
                  font-semibold
                  px-2
                  py-0.5
                  rounded
                  flex
                  items-center
                  gap-1
                ">

                  <Cloud className="
                    w-3
                    h-3
                  " />

                  Central LAN Server

                </span>

              </div>


              <div className="
                text-[11px]
                text-slate-500
              ">
                Central time tracking,
                screenshots & admin
                capture policy
              </div>

            </div>

          </div>


          {currentUser && (

            <div className="
              flex
              items-center
              gap-2
            ">

              <div className="
                text-right
                hidden
                sm:block
              ">

                <div className="
                  text-xs
                  font-bold
                  text-slate-800
                  dark:text-slate-200
                ">
                  {currentUser.name}
                </div>


                <div className="
                  text-[10px]
                  uppercase
                  font-semibold
                  text-indigo-600
                  dark:text-indigo-400
                ">
                  {currentUser.role}
                </div>

              </div>


              <button
                id="btn-logout"
                type="button"
                onClick={handleLogout}
                title="Sign Out"
                className="
                  p-2
                  text-slate-500
                  hover:text-rose-600
                  hover:bg-slate-100
                  dark:hover:bg-slate-800
                  rounded-lg
                  transition
                  cursor-pointer
                "
              >

                <LogOut className="
                  w-4
                  h-4
                " />

              </button>

            </div>

          )}

        </div>

      </header>


      {/* ================================================================
          NOTIFICATION
      ================================================================= */}

      {notificationMsg && (

        <div className="
          bg-indigo-600
          text-white
          text-xs
          py-2
          px-4
          text-center
          font-medium
          shadow
          flex
          items-center
          justify-center
          gap-2
        ">

          <Bell className="
            w-4
            h-4
            animate-bounce
            shrink-0
          " />

          <span>
            {notificationMsg}
          </span>

        </div>

      )}


      {/* ================================================================
          MAIN
      ================================================================= */}

      <main className="
        flex-1
        p-4
        sm:p-6
        lg:p-8
      ">

        {!currentUser ? (

          <AuthScreen

            allUsers={
              allUsers
            }

            onLoginSuccess={(
              user
            ) => {

              setCurrentUser(
                user
              );


              setActiveSessionUser(
                user
              );


              setAllUsers(
                (previous) => {

                  const exists =
                    previous.some(
                      (item) =>
                        item.id ===
                        user.id
                    );


                  const updated =
                    exists

                      ? previous.map(
                          (item) =>
                            item.id ===
                            user.id
                              ? user
                              : item
                        )

                      : [
                          ...previous,
                          user,
                        ];


                  saveStoredUsers(
                    updated
                  );


                  return updated;
                }
              );


              void refreshCentralPeople();
            }}

            onAdminConfirmationDispatched={
              handleAdminCodeDispatched
            }

          />

        ) : currentUser.role ===
          'admin' ? (

          <AdminDashboard

            adminUser={
              currentUser
            }

            allUsers={
              allUsers
            }

            onUpdateUsers={(
              users
            ) => {

              setAllUsers(
                users
              );

              saveStoredUsers(
                users
              );


              window.setTimeout(
                refreshCentralPeople,
                300
              );
            }}

            pendingSignups={
              pendingSignups
            }

            onUpdatePendingSignups={(
              signups
            ) => {

              setPendingSignups(
                signups
              );

              savePendingSignups(
                signups
              );


              window.setTimeout(
                refreshCentralPeople,
                300
              );
            }}

            storageSettings={
              storageSettings
            }

            onUpdateStorageSettings={
              handleStorageSettingsUpdate
            }

            allScreenshots={
              screenshots
            }

            onUpdateScreenshots={
              setScreenshots
            }

            accessToken={
              null
            }

            onConnectDrive={
              () => {}
            }

          />

        ) : (

          <EmployeeDashboard

            currentUser={
              currentUser
            }

            storageSettings={
              storageSettings
            }

            accessToken={
              null
            }

            onConnectDrive={
              () => {}
            }

            onNewScreenshot={
              handleNewScreenshot
            }

            userScreenshots={
              screenshots.filter(
                (screenshot) =>
                  screenshot.userId ===
                  currentUser.id
              )
            }

            onLogout={
              handleLogout
            }

          />

        )}

      </main>

    </div>
  );
}
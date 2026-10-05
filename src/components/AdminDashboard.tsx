import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  AppUser,
  PendingSignup,
  StorageSettings,
  ScreenshotLog,
} from '../types';

import {
  RefreshCw,
  FileImage,
  ShieldCheck,
  Trash2,
  Calendar,
  Save,
  X,
} from 'lucide-react';

import { apiFetch } from '../lib/api';


interface AdminDashboardProps {
  adminUser: AppUser;

  allUsers: AppUser[];

  onUpdateUsers:
    (users: AppUser[]) => void;

  pendingSignups:
    PendingSignup[];

  onUpdatePendingSignups:
    (signups: PendingSignup[]) => void;

  storageSettings:
    StorageSettings;

  onUpdateStorageSettings:
    (settings: StorageSettings) => void;

  allScreenshots:
    ScreenshotLog[];

  onUpdateScreenshots?:
    (screens: ScreenshotLog[]) => void;

  accessToken:
    string | null;

  onConnectDrive:
    () => void;
}


type AdminTab =
  | 'employees'
  | 'approvals'
  | 'activity'
  | 'storage';


type ActivitySummaryRow = {
  employeeId: string;
  employeeName: string;
  email: string;
  today: string;
  monthKey: string;
  todaySeconds: number;
  monthlySeconds: number;
  todayScreenshots: number;
};


type ActivityHistoryRow = {
  dateKey: string;
  totalSeconds: number;
  screenshotCount: number;
};


type ScreenshotItem = {
  id?: string;
  fileName: string;
  dateKey: string;
  employeeName?: string;
  localUrl: string;
};


/* ==========================================================================
   FORMAT TIME
========================================================================== */

const formatSeconds = (
  totalSeconds = 0
) => {

  const safe =
    Math.max(
      0,
      Math.floor(
        Number(totalSeconds) || 0
      )
    );


  const hours =
    Math.floor(
      safe / 3600
    );


  const minutes =
    Math.floor(
      (safe % 3600) / 60
    );


  const seconds =
    safe % 60;


  return (
    `${String(hours).padStart(2, '0')}h ` +
    `${String(minutes).padStart(2, '0')}m ` +
    `${String(seconds).padStart(2, '0')}s`
  );
};


/* ==========================================================================
   READ API JSON
========================================================================== */

const readApiJson = async (
  response: Response
) => {

  const contentType =
    response.headers.get(
      'content-type'
    ) || '';


  const raw =
    await response.text();


  if (
    !contentType.includes(
      'application/json'
    )
  ) {

    const preview =
      raw
        .replace(/\s+/g, ' ')
        .slice(0, 120);


    throw new Error(
      `Backend returned non-JSON response (${response.status}). ` +
      `${
        preview
          ? `Response: ${preview}`
          : ''
      }`
    );
  }


  try {

    return raw
      ? JSON.parse(raw)
      : {};

  } catch {

    throw new Error(
      `Backend returned invalid JSON (${response.status}).`
    );

  }
};


const readAdminBootstrap = () => {
  try {
    const raw = localStorage.getItem('workmonitor_admin_bootstrap');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/* ==========================================================================
   ADMIN DASHBOARD
========================================================================== */

export const AdminDashboard:
React.FC<AdminDashboardProps> = ({

  adminUser,

  allUsers,

  onUpdateUsers,

  pendingSignups,

  onUpdatePendingSignups,

  storageSettings,

  onUpdateStorageSettings,

}) => {

  const captureEditingRef =
    useRef(false);

  const activityRequestRef =
    useRef(0);


  const [
    activeTab,
    setActiveTab,
  ] =
    useState<AdminTab>(
      'employees'
    );


  const bootstrap = readAdminBootstrap();

  const [
    centralUsers,
    setCentralUsers,
  ] =
    useState<AppUser[]>(
      Array.isArray(bootstrap?.employees)
        ? bootstrap.employees.map((employee: any) => ({ ...employee, role: 'employee', approved: employee.approved !== false }))
        : allUsers.filter((u) => u.role === 'employee')
    );


  const [
    centralPending,
    setCentralPending,
  ] =
    useState<any[]>(
      Array.isArray(bootstrap?.pending) ? bootstrap.pending : (pendingSignups || [])
    );


  const [
    summaryRows,
    setSummaryRows,
  ] =
    useState<ActivitySummaryRow[]>(
      Array.isArray(bootstrap?.summary) ? bootstrap.summary : []
    );


  const [
    selectedEmployeeId,
    setSelectedEmployeeId,
  ] =
    useState<string>('');


  const [
    historyRows,
    setHistoryRows,
  ] =
    useState<ActivityHistoryRow[]>(
      []
    );


  const [
    selectedDate,
    setSelectedDate,
  ] =
    useState<string>('');


  const [
    selectedHistoryYear,
    setSelectedHistoryYear
  ] =
    useState<string>(
      new Date()
        .getFullYear()
        .toString()
    );


  const [
    selectedHistoryMonth,
    setSelectedHistoryMonth
  ] =
    useState<string>(
      new Date()
        .toISOString()
        .slice(0, 7)
    );


  const [
    selectedActivity,
    setSelectedActivity,
  ] =
    useState<any>(null);


  const [
    previewImage,
    setPreviewImage,
  ] =
    useState<ScreenshotItem | null>(
      null
    );


  const [
    loading,
    setLoading,
  ] =
    useState(false);


  const [
    message,
    setMessage,
  ] =
    useState('');


  /* ==========================================================================
     CAPTURE SETTINGS STATE
  ========================================================================== */

  const [
    captureMode,
    setCaptureMode,
  ] =
    useState<string>(
      'random_count_window'
    );


  const [
    captureIntervalSeconds,
    setCaptureIntervalSeconds,
  ] =
    useState<number>(
      storageSettings
        .captureIntervalSeconds ||
        600
    );


  const [
    allowedIntervals,
    setAllowedIntervals,
  ] =
    useState<number[]>(
      storageSettings
        .allowedIntervals?.length

        ? storageSettings
            .allowedIntervals

        : [
            10,
            60,
            120,
            300,
            600,
            900,
          ]
    );


  const [
    lockIntervalForEmployees,
    setLockIntervalForEmployees,
  ] =
    useState<boolean>(
      storageSettings
        .lockIntervalForEmployees !==
        false
    );


  const [
    captureWindowSeconds,
    setCaptureWindowSeconds,
  ] =
    useState<number>(600);


  const [
    screenshotsPerWindow,
    setScreenshotsPerWindow,
  ] =
    useState<number>(5);


  const [
    presetId,
    setPresetId,
  ] =
    useState<string>(
      '10m-5'
    );


  const [
    customMinutes,
    setCustomMinutes,
  ] =
    useState<number>(10);


  const [
    customScreenshots,
    setCustomScreenshots,
  ] =
    useState<number>(20);


  // Login already provided the initial admin data. Do not start polling.
  useEffect(() => {
    const cached = readAdminBootstrap();
    if (!cached) return;

    if (Array.isArray(cached.employees)) {
      const employees = cached.employees.map((employee: any) => ({
        ...employee,
        role: 'employee',
        approved: employee.approved !== false,
      }));
      setCentralUsers(employees);
      const nonEmployees = allUsers.filter((u) => u.role !== 'employee');
      onUpdateUsers([...nonEmployees, ...employees]);
    }

    if (Array.isArray(cached.pending)) {
      setCentralPending(cached.pending);
      onUpdatePendingSignups(cached.pending);
    }

    if (cached.captureSettings) {
      const settings = cached.captureSettings;
      setCaptureMode(settings.captureMode || 'random_count_window');
      setCaptureIntervalSeconds(Number(settings.captureIntervalSeconds || settings.captureWindowSeconds || 600));
      setAllowedIntervals(settings.allowedIntervals || []);
      setLockIntervalForEmployees(settings.lockIntervalForEmployees !== false);
      setCaptureWindowSeconds(Math.max(5, Number(settings.captureWindowSeconds || 600)));
      setScreenshotsPerWindow(Math.max(1, Number(settings.screenshotsPerWindow || 5)));
      setPresetId(String(settings.presetId || 'custom'));
    }
  }, []);

  /* ==========================================================================
     FLASH MESSAGE
  ========================================================================== */

  const flash = (
    text: string
  ) => {

    setMessage(text);


    window.setTimeout(
      () =>
        setMessage(''),
      30000
    );
  };


  /* ==========================================================================
     LOAD EMPLOYEES
  ========================================================================== */

  const loadEmployees =
    async () => {

      const response =
        await apiFetch(
          '/api/employees',
          {
            method: 'GET',
            cache: 'no-store',
          }
        );


      const data =
        await readApiJson(
          response
        );


      if (
        !response.ok ||
        !data?.success
      ) {

        throw new Error(
          data?.error ||
          'Failed to load employees'
        );
      }


      const employees:
        AppUser[] =
        (data.employees || [])
          .map(
            (emp: any) => ({
              ...emp,

              role:
                'employee',

              approved:
                emp.approved !==
                false,
            })
          );


      setCentralUsers(
        employees
      );


      const nonEmployees =
        allUsers.filter(
          (u) =>
            u.role !==
            'employee'
        );


      onUpdateUsers([
        ...nonEmployees,
        ...employees,
      ]);


      setSelectedEmployeeId(
        (
          previousEmployeeId
        ) => {

          if (
            previousEmployeeId &&
            employees.some(
              (employee) =>
                employee.id ===
                previousEmployeeId
            )
          ) {

            return previousEmployeeId;

          }


          return employees.length > 0
            ? employees[0].id
            : '';
        }
      );
    };


  /* ==========================================================================
     LOAD PENDING
  ========================================================================== */

  const loadPending =
    async () => {

      const response =
        await apiFetch(
          '/api/pending-employees',
          {
            method: 'GET',
            cache: 'no-store',
          }
        );


      const data =
        await readApiJson(
          response
        );


      if (
        !response.ok ||
        !data?.success
      ) {

        throw new Error(
          data?.error ||
          'Failed to load pending requests'
        );
      }


      const pending =
        data.pending || [];


      setCentralPending(
        pending
      );


      onUpdatePendingSignups(
        pending
      );
    };


  /* ==========================================================================
     LOAD SUMMARY
  ========================================================================== */

  const loadSummary =
    async () => {

      const monthKey =
        new Date()
          .toISOString()
          .slice(0, 7);


      const response =
        await apiFetch(
          `/api/admin/activity-summary?month=${encodeURIComponent(
            monthKey
          )}`,
          {
            method: 'GET',
            cache: 'no-store',
          }
        );


      const data =
        await readApiJson(
          response
        );


      if (
        !response.ok ||
        !data?.success
      ) {

        throw new Error(
          data?.error ||
          'Failed to load activity summary'
        );
      }


      setSummaryRows(
        data.employees || []
      );
    };


  /* ==========================================================================
     LOAD CAPTURE SETTINGS
  ========================================================================== */

  const loadCaptureSettings =
    async (
      force = false
    ) => {

      if (
        captureEditingRef.current &&
        !force
      ) {
        return;
      }


      const response =
        await apiFetch(
          '/api/capture-settings',
          {
            method: 'GET',
            cache: 'no-store',
          }
        );


      const data =
        await readApiJson(
          response
        );


      if (
        !response.ok ||
        !data?.success
      ) {

        throw new Error(
          data?.error ||
          'Failed to load capture settings'
        );
      }


      const settings =
        data.settings || {};


      setCaptureMode(
        settings.captureMode ||
        'random_count_window'
      );


      setCaptureIntervalSeconds(
        Number(
          settings
            .captureIntervalSeconds ||
          settings
            .captureWindowSeconds ||
          600
        )
      );


      setAllowedIntervals(
        settings.allowedIntervals ||
        []
      );


      setLockIntervalForEmployees(
        settings
          .lockIntervalForEmployees !==
          false
      );


      setCaptureWindowSeconds(
        Math.max(
          5,
          Number(
            settings
              .captureWindowSeconds ||
            600
          )
        )
      );


      setScreenshotsPerWindow(
        Math.max(
          1,
          Number(
            settings
              .screenshotsPerWindow ||
            5
          )
        )
      );


      setPresetId(
        String(
          settings.presetId ||
          'custom'
        )
      );


      if (
        settings.presetId ===
        'custom'
      ) {

        setCustomMinutes(
          Math.max(
            1,
            Math.round(
              Number(
                settings
                  .captureWindowSeconds ||
                600
              ) / 60
            )
          )
        );


        setCustomScreenshots(
          Math.max(
            1,
            Number(
              settings
                .screenshotsPerWindow ||
              5
            )
          )
        );
      }
    };


  /* ==========================================================================
     REFRESH CENTRAL DATA
  ========================================================================== */

  const refreshCentralData =
    async (
      silent = false
    ) => {

      if (!silent) {
        setLoading(true);
      }


      try {

        await Promise.all([
          loadEmployees(),
          loadPending(),
          loadSummary(),
          loadCaptureSettings(),
        ]);

      } catch (err: any) {

        if (!silent) {
          flash(
            `❌ ${err.message}`
          );
        }

      } finally {

        if (!silent) {
          setLoading(false);
        }

      }
    };


  /* ==========================================================================
     INITIAL ADMIN LOAD
  ========================================================================== */

  // No automatic admin polling. Fresh data is requested only after explicit
  // admin actions or when the admin manually refreshes a section.


  /* ==========================================================================
     LOAD EMPLOYEE HISTORY
  ========================================================================== */

  const loadEmployeeHistory =
    async (
      employeeId: string
    ) => {

      if (!employeeId) {

        setHistoryRows([]);

        setSelectedDate('');

        setSelectedActivity(
          null
        );

        return;
      }


      const requestId =
        ++activityRequestRef.current;


      try {

        const response =
          await apiFetch(
            `/api/activity-history/${encodeURIComponent(
              employeeId
            )}`,
            {
              method: 'GET',
              cache: 'no-store',
            }
          );


        const data =
          await readApiJson(
            response
          );


        if (
          !response.ok ||
          !data?.success
        ) {

          throw new Error(
            data?.error ||
            'Failed to load activity history'
          );
        }


        if (
          requestId !==
          activityRequestRef.current
        ) {
          return;
        }


        const records:
          ActivityHistoryRow[] =
          Array.isArray(
            data.records
          )
            ? data.records
            : [];


        setHistoryRows(
          records
        );


        setSelectedDate(
          ''
        );


        setSelectedActivity(
          null
        );

      } catch (err: any) {

        if (
          requestId ===
          activityRequestRef.current
        ) {

          flash(
            `❌ ${err.message}`
          );
        }

      }
    };


  /* ==========================================================================
     LOAD SELECTED ACTIVITY
  ========================================================================== */

  const loadSelectedActivity =
    async (
      employeeId: string,
      dateKey: string
    ) => {

      if (
        !employeeId ||
        !dateKey
      ) {

        setSelectedActivity(
          null
        );

        return;
      }


      const requestId =
        ++activityRequestRef.current;


      setSelectedActivity(
        null
      );


      try {

        const response =
          await apiFetch(
            `/api/activity/${encodeURIComponent(
              employeeId
            )}/${encodeURIComponent(
              dateKey
            )}`,
            {
              method: 'GET',
              cache: 'no-store',
            }
          );


        const data =
          await readApiJson(
            response
          );


        if (
          !response.ok ||
          !data?.success
        ) {

          throw new Error(
            data?.error ||
            'Failed to load selected date activity'
          );
        }


        if (
          requestId !==
          activityRequestRef.current
        ) {
          return;
        }


        setSelectedActivity(
          data
        );

      } catch (err: any) {

        if (
          requestId ===
          activityRequestRef.current
        ) {

          flash(
            `❌ ${err.message}`
          );
        }

      }
    };


  useEffect(() => {

    activityRequestRef.current +=
      1;

    setHistoryRows([]);

    setSelectedDate('');

    setSelectedActivity(
      null
    );

    setPreviewImage(
      null
    );


    if (
      selectedEmployeeId
    ) {

      void loadEmployeeHistory(
        selectedEmployeeId
      );
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedEmployeeId,
  ]);


  useEffect(() => {

    if (
      selectedEmployeeId &&
      selectedDate
    ) {

      void loadSelectedActivity(
        selectedEmployeeId,
        selectedDate
      );

    } else {

      setSelectedActivity(
        null
      );
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedEmployeeId,
    selectedDate,
  ]);


  /* ==========================================================================
     APPROVE SIGNUP
  ========================================================================== */

  const approveSignup =
    async (
      signup: any
    ) => {

      try {

        setLoading(true);


        const response =
          await apiFetch(
            `/api/approve-employee/${encodeURIComponent(
              signup.id
            )}`,
            {
              method: 'POST',
            }
          );


        const data =
          await readApiJson(
            response
          );


        if (
          !response.ok ||
          !data?.success
        ) {

          throw new Error(
            data?.error ||
            'Approval failed'
          );
        }


        flash(
          `✅ ${signup.name} approved and activated.`
        );


        await refreshCentralData(
          true
        );

      } catch (err: any) {

        flash(
          `❌ ${err.message}`
        );

      } finally {

        setLoading(false);

      }
    };


  /* ==========================================================================
     REJECT SIGNUP
  ========================================================================== */

  const rejectSignup =
    async (
      signup: any
    ) => {

      try {

        setLoading(true);


        const response =
          await apiFetch(
            `/api/reject-employee/${encodeURIComponent(
              signup.id
            )}`,
            {
              method: 'DELETE',
            }
          );


        const data =
          await readApiJson(
            response
          );


        if (
          !response.ok ||
          !data?.success
        ) {

          throw new Error(
            data?.error ||
            'Reject failed'
          );
        }


        flash(
          `✅ ${signup.name} request rejected.`
        );


        await refreshCentralData(
          true
        );

      } catch (err: any) {

        flash(
          `❌ ${err.message}`
        );

      } finally {

        setLoading(false);

      }
    };


  /* ==========================================================================
     DELETE EMPLOYEE
  ========================================================================== */

  const deleteEmployee =
    async (
      employee: AppUser
    ) => {

      if (
        !window.confirm(
          `Delete ${employee.name} account? Existing screenshot folders/data will be kept.`
        )
      ) {
        return;
      }


      try {

        setLoading(true);


        const response =
          await apiFetch(
            `/api/employees/${encodeURIComponent(
              employee.id
            )}`,
            {
              method: 'DELETE',
            }
          );


        const data =
          await readApiJson(
            response
          );


        if (
          !response.ok ||
          !data?.success
        ) {

          throw new Error(
            data?.error ||
            'Delete failed'
          );
        }


        flash(
          `✅ ${employee.name} deleted.`
        );


        if (
          selectedEmployeeId ===
          employee.id
        ) {

          setSelectedEmployeeId('');

          setHistoryRows([]);

          setSelectedActivity(
            null
          );

          setPreviewImage(
            null
          );
        }


        await refreshCentralData(
          true
        );

      } catch (err: any) {

        flash(
          `❌ ${err.message}`
        );

      } finally {

        setLoading(false);

      }
    };


  /* ==========================================================================
     SAVE GLOBAL CAPTURE SETTINGS
  ========================================================================== */

  const saveGlobalCaptureSettings =
    async () => {

      try {

        setLoading(true);


        const response =
          await apiFetch(
            '/api/capture-settings',
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'application/json',
              },

              body:
                JSON.stringify({

                  captureMode:
                    'random_count_window',

                  captureWindowSeconds,

                  screenshotsPerWindow,

                  presetId,

                  captureIntervalSeconds:
                    captureWindowSeconds,

                  allowedIntervals,

                  lockIntervalForEmployees,
                }),
            }
          );


        const data =
          await readApiJson(
            response
          );


        if (
          !response.ok ||
          !data?.success
        ) {

          throw new Error(
            data?.error ||
            'Failed to save global capture settings'
          );
        }


        captureEditingRef.current =
          false;


        const updatedSettings:
          StorageSettings = {

          ...storageSettings,

          captureMode:
            data.settings
              .captureMode as any,

          captureIntervalSeconds:
            data.settings
              .captureIntervalSeconds,

          autoCaptureIntervalMinutes:
            data.settings
              .autoCaptureIntervalMinutes,

          allowedIntervals:
            data.settings
              .allowedIntervals,

          lockIntervalForEmployees:
            data.settings
              .lockIntervalForEmployees,
        };


        onUpdateStorageSettings(
          updatedSettings
        );


        flash(
          '✅ Global screenshot interval saved. All open employee PCs will receive this setting automatically.'
        );

      } catch (err: any) {

        flash(
          `❌ ${err.message}`
        );

      } finally {

        setLoading(false);

      }
    };


  /* ==========================================================================
     PRESETS
  ========================================================================== */

  const applyPreset = (
    id: string,
    windowSeconds: number,
    screenshots: number
  ) => {

    captureEditingRef.current =
      true;

    setPresetId(id);

    setCaptureMode(
      'random_count_window'
    );

    setCaptureWindowSeconds(
      windowSeconds
    );

    setCaptureIntervalSeconds(
      windowSeconds
    );

    setScreenshotsPerWindow(
      screenshots
    );
  };


  const applyCustomPolicy =
    () => {

      const seconds =
        Math.max(
          60,
          Math.floor(
            Number(
              customMinutes
            ) || 1
          ) * 60
        );


      const count =
        Math.max(
          1,
          Math.floor(
            Number(
              customScreenshots
            ) || 1
          )
        );


      applyPreset(
        'custom',
        seconds,
        count
      );
    };


  const selectedEmployee =
    centralUsers.find(
      (u) =>
        u.id ===
        selectedEmployeeId
    );


  const selectedSummary =
    summaryRows.find(
      (r) =>
        r.employeeId ===
        selectedEmployeeId
    );


  /* ==========================================================================
     ACTIVITY HISTORY FILTERS
  ========================================================================== */

  const availableHistoryYears:
    string[] =
    Array.from(
      new Set(
        historyRows
          .map(
            (row) =>
              row.dateKey
                ?.slice(
                  0,
                  4
                )
          )
          .filter(
            (
              year
            ): year is string =>
              Boolean(
                year
              )
          )
      )
    )
      .sort(
        (
          a,
          b
        ) =>
          b.localeCompare(
            a
          )
      );


  const effectiveHistoryYear =
    selectedHistoryYear &&
    availableHistoryYears.includes(
      selectedHistoryYear
    )
      ? selectedHistoryYear
      : availableHistoryYears[0] ||
        '';


  const availableHistoryMonths:
    string[] =
    effectiveHistoryYear

      ? Array.from(
          new Set(
            historyRows

              .filter(
                (
                  row
                ) =>
                  row.dateKey
                    ?.startsWith(
                      `${effectiveHistoryYear}-`
                    )
              )

              .map(
                (
                  row
                ) =>
                  row.dateKey.slice(
                    0,
                    7
                  )
              )
          )
        )
          .sort(
            (
              a,
              b
            ) =>
              b.localeCompare(
                a
              )
          )

      : [];


  const effectiveHistoryMonth =
    selectedHistoryMonth &&
    availableHistoryMonths.includes(
      selectedHistoryMonth
    )

      ? selectedHistoryMonth

      : availableHistoryMonths[0] ||
        '';


  const filteredActivityDates:
    ActivityHistoryRow[] =
    effectiveHistoryMonth

      ? historyRows

          .filter(
            (
              row
            ) =>
              row.dateKey
                ?.startsWith(
                  `${effectiveHistoryMonth}-`
                )
          )

          .sort(
            (
              a,
              b
            ) =>
              b.dateKey.localeCompare(
                a.dateKey
              )
          )

      : [];


  const getHistoryMonthLabel =
    (
      monthValue: string
    ) => {

      const [
        year,
        month,
      ] =
        monthValue.split(
          '-'
        );


      const monthNumber =
        Number(
          month
        );


      if (
        !year ||
        !monthNumber
      ) {

        return monthValue;
      }


      return new Date(
        Number(
          year
        ),
        monthNumber - 1,
        1
      )
        .toLocaleDateString(
          undefined,
          {
            month:
              'long',

            year:
              'numeric',
          }
        );
    };


  /* ==========================================================================
     UI
  ========================================================================== */

  return (

    <div className="
      w-full
      max-w-7xl
      mx-auto
      space-y-6
    ">

      {/* HEADER */}

      <div className="
        bg-slate-900
        text-white
        rounded-2xl
        p-6
        shadow-sm
        border
        border-slate-800
        flex
        flex-col
        md:flex-row
        items-start
        md:items-center
        justify-between
        gap-4
      ">

        <div>

          <div className="
            flex
            items-center
            gap-2
            text-indigo-400
            text-xs
            font-semibold
            uppercase
            tracking-wider
            mb-1
          ">

            <ShieldCheck className="
              w-4
              h-4
            " />

            Central Admin Console

          </div>


          <h1 className="
            text-2xl
            font-bold
          ">
            Team Activity &
            Central Tracking
          </h1>


          <p className="
            text-sm
            text-slate-400
            mt-1
          ">

            Logged in as{' '}

            <span className="
              text-white
              font-semibold
            ">
              {adminUser.name}
            </span>

          </p>

        </div>


        <button
          onClick={() => {
            captureEditingRef.current =
              false;

            void refreshCentralData();
          }}
          disabled={loading}
          className="
            inline-flex
            items-center
            gap-2
            px-4
            py-2
            rounded-xl
            bg-slate-800
            hover:bg-slate-700
            text-xs
            font-semibold
            border
            border-slate-700
          "
        >

          <RefreshCw
            className={`w-4 h-4 ${
              loading
                ? 'animate-spin'
                : ''
            }`}
          />

          Refresh

        </button>

      </div>


      {/* MESSAGE */}

      {message && (

        <div className="
          p-3.5
          rounded-xl
          border
          border-indigo-200
          dark:border-indigo-800
          bg-indigo-50
          dark:bg-indigo-950/50
          text-indigo-900
          dark:text-indigo-200
          text-xs
          font-medium
        ">
          {message}
        </div>

      )}


      {/* TABS */}

      <div className="
        flex
        gap-2
        border-b
        border-slate-200
        dark:border-slate-800
        overflow-x-auto
      ">

        {[
          [
            'employees',
            `Employees (${centralUsers.length})`,
          ],

          [
            'approvals',
            `Pending Approvals (${centralPending.length})`,
          ],

          [
            'activity',
            'Date-wise Activity',
          ],

          [
            'storage',
            'Global Capture Settings',
          ],

        ].map(
          ([key, label]) => (

            <button
              key={key}
              onClick={() =>
                setActiveTab(
                  key as AdminTab
                )
              }
              className={`
                px-4
                py-2.5
                text-sm
                font-semibold
                border-b-2
                whitespace-nowrap

                ${
                  activeTab === key

                    ? 'border-indigo-600 text-indigo-600'

                    : 'border-transparent text-slate-500'
                }
              `}
            >
              {label}
            </button>

          )
        )}

      </div>


      {/* ================================================================
          EMPLOYEES
      ================================================================= */}

      {activeTab ===
        'employees' && (

        <div className="
          bg-white
          dark:bg-slate-900
          border
          border-slate-200
          dark:border-slate-800
          rounded-2xl
          overflow-hidden
        ">

          <table className="
            w-full
            text-sm
          ">

            <thead className="
              bg-slate-50
              dark:bg-slate-800
              text-slate-600
              dark:text-slate-300
            ">

              <tr>

                <th className="
                  text-left
                  p-4
                ">
                  Employee
                </th>

                <th className="
                  text-left
                  p-4
                ">
                  Today
                </th>

                <th className="
                  text-left
                  p-4
                ">
                  Today Screenshots
                </th>

                <th className="
                  text-left
                  p-4
                ">
                  Month Total
                </th>

                <th className="
                  text-right
                  p-4
                ">
                  Actions
                </th>

              </tr>

            </thead>


            <tbody className="
              divide-y
              divide-slate-100
              dark:divide-slate-800
            ">

              {centralUsers.map(
                (emp) => {

                  const summary =
                    summaryRows.find(
                      (r) =>
                        r.employeeId ===
                        emp.id
                    );


                  return (

                    <tr key={emp.id}>

                      <td className="p-4">

                        <div className="
                          font-bold
                          text-slate-900
                          dark:text-white
                        ">
                          {emp.name}
                        </div>

                        <div className="
                          text-xs
                          text-slate-400
                        ">
                          {emp.email}
                        </div>
                        <div className="
                            text-xs
                            text-slate-500
                            mt-1
                          ">
                            <span className="font-semibold">
                              Password:
                            </span>{' '}

                            {emp.password || '-'}
                          </div>
                      </td>


                      <td className="
                        p-4
                        font-mono
                      ">
                        {formatSeconds(
                          summary
                            ?.todaySeconds ||
                          0
                        )}
                      </td>


                      <td className="
                        p-4
                        font-semibold
                        text-indigo-600
                      ">
                        {summary
                          ?.todayScreenshots ||
                          0}
                      </td>


                      <td className="
                        p-4
                        font-mono
                        font-bold
                      ">
                        {formatSeconds(
                          summary
                            ?.monthlySeconds ||
                          0
                        )}
                      </td>


                      <td className="p-4">

                        <div className="
                          flex
                          justify-end
                          gap-2
                        ">

                          <button
                            onClick={() => {

                              activityRequestRef.current +=
                                1;

                              setHistoryRows(
                                []
                              );

                              setSelectedDate(
                                ''
                              );

                              setSelectedActivity(
                                null
                              );

                              setPreviewImage(
                                null
                              );

                              setSelectedHistoryYear(
                                ''
                              );

                              setSelectedHistoryMonth(
                                ''
                              );

                              setSelectedEmployeeId(
                                emp.id
                              );

                              setActiveTab(
                                'activity'
                              );
                            }}
                            className="
                              px-3
                              py-1.5
                              rounded-lg
                              border
                              border-indigo-200
                              text-indigo-600
                              text-xs
                              font-semibold
                            "
                          >
                            View Activity
                          </button>


                          <button
                            onClick={() =>
                              void deleteEmployee(
                                emp
                              )
                            }
                            className="
                              px-3
                              py-1.5
                              rounded-lg
                              border
                              border-rose-200
                              text-rose-600
                              text-xs
                              font-semibold
                              inline-flex
                              items-center
                              gap-1
                            "
                          >

                            <Trash2 className="
                              w-3
                              h-3
                            " />

                            Delete

                          </button>

                        </div>

                      </td>

                    </tr>

                  );
                }
              )}


              {centralUsers.length ===
                0 && (

                <tr>

                  <td
                    colSpan={5}
                    className="
                      p-10
                      text-center
                      text-sm
                      text-slate-500
                    "
                  >
                    No central employees
                    found yet.
                  </td>

                </tr>

              )}

            </tbody>

          </table>

        </div>

      )}


      {/* ================================================================
          APPROVALS
      ================================================================= */}

      {activeTab ===
        'approvals' && (

        <div className="
          space-y-4
        ">

          {centralPending.length ===
            0 ? (

            <div className="
              p-12
              text-center
              bg-white
              dark:bg-slate-900
              border
              border-slate-200
              dark:border-slate-800
              rounded-2xl
            ">

              <div className="
                font-semibold
              ">
                No pending signup
                requests
              </div>

            </div>

          ) : (

            <div className="
              grid
              grid-cols-1
              md:grid-cols-2
              gap-4
            ">

              {centralPending.map(
                (signup) => (

                <div
                  key={signup.id}
                  className="
                    p-5
                    bg-white
                    dark:bg-slate-900
                    border
                    border-amber-200
                    dark:border-amber-800
                    rounded-2xl
                    space-y-4
                  "
                >

                  <div>

                    <div className="
                      font-bold
                      text-slate-900
                      dark:text-white
                    ">
                      {signup.name}
                    </div>

                    <div className="
                      text-xs
                      text-slate-500
                    ">
                      {signup.email}
                    </div>

                    <div className="
                      text-[11px]
                      text-slate-400
                      mt-1
                    ">

                      Requested:{' '}

                      {signup.requestedAt

                        ? new Date(
                            signup
                              .requestedAt
                          )
                            .toLocaleString()

                        : '-'
                      }

                    </div>

                  </div>


                  <div className="
                    flex
                    gap-2
                  ">

                    <button
                      onClick={() =>
                        void approveSignup(
                          signup
                        )
                      }
                      className="
                        flex-1
                        py-2
                        rounded-lg
                        bg-emerald-600
                        hover:bg-emerald-500
                        text-white
                        text-xs
                        font-bold
                      "
                    >
                      Approve & Activate
                    </button>


                    <button
                      onClick={() =>
                        void rejectSignup(
                          signup
                        )
                      }
                      className="
                        px-4
                        py-2
                        rounded-lg
                        border
                        border-slate-300
                        dark:border-slate-700
                        text-xs
                        font-semibold
                      "
                    >
                      Reject
                    </button>

                  </div>

                </div>

              ))}

            </div>

          )}

        </div>

      )}


      {/* ================================================================
          ACTIVITY
      ================================================================= */}

      {activeTab ===
        'activity' && (

        <div className="space-y-5">

          <div className="
            grid
            grid-cols-1
            lg:grid-cols-[minmax(260px,25%)_minmax(0,75%)]
            gap-5
            items-start
          ">

            {/* LEFT 25% */}

            <div className="
              bg-white
              dark:bg-slate-900
              border
              border-slate-200
              dark:border-slate-800
              rounded-2xl
              overflow-hidden
            ">

              <div className="
                p-4
                border-b
                border-slate-200
                dark:border-slate-800
              ">

                <div className="
                  flex
                  items-center
                  gap-2
                  font-bold
                ">

                  <Calendar className="
                    w-4
                    h-4
                  " />

                  Activity History

                </div>

              </div>


              <div className="
                p-4
                space-y-4
              ">

                <div>

                  <label className="
                    text-[11px]
                    font-bold
                    text-slate-500
                    uppercase
                  ">
                    Employee
                  </label>


                  <select
                    value={
                      selectedEmployeeId
                    }
                    onChange={(e) => {

                      activityRequestRef.current +=
                        1;

                      setHistoryRows(
                        []
                      );

                      setSelectedDate(
                        ''
                      );

                      setSelectedActivity(
                        null
                      );

                      setPreviewImage(
                        null
                      );

                      setSelectedHistoryYear(
                        ''
                      );

                      setSelectedHistoryMonth(
                        ''
                      );

                      setSelectedEmployeeId(
                        e.target.value
                      );
                    }}
                    className="
                      mt-1
                      w-full
                      border
                      border-slate-300
                      dark:border-slate-700
                      bg-white
                      dark:bg-slate-800
                      rounded-xl
                      px-3
                      py-2.5
                      text-sm
                    "
                  >

                    <option value="">
                      Select employee
                    </option>

                    {centralUsers.map(
                      (
                        emp
                      ) => (

                      <option
                        key={emp.id}
                        value={emp.id}
                      >
                        {emp.name}
                        {' — '}
                        {emp.email}
                      </option>

                    ))}

                  </select>

                </div>


                <div>

                  <label className="
                    text-[11px]
                    font-bold
                    text-slate-500
                    uppercase
                  ">
                    Year
                  </label>


                  <select
                    value={
                      effectiveHistoryYear
                    }
                    disabled={
                      !selectedEmployeeId ||
                      !availableHistoryYears.length
                    }
                    onChange={(e) => {

                      const year =
                        e.target.value;


                      setSelectedHistoryYear(
                        year
                      );


                      const firstMonth =
                        Array.from(
                          new Set(
                            historyRows

                              .filter(
                                (
                                  row
                                ) =>
                                  row.dateKey
                                    .startsWith(
                                      `${year}-`
                                    )
                              )

                              .map(
                                (
                                  row
                                ) =>
                                  row.dateKey.slice(
                                    0,
                                    7
                                  )
                              )
                          )
                        )
                          .sort(
                            (
                              a,
                              b
                            ) =>
                              b.localeCompare(
                                a
                              )
                          )[0] ||
                        '';


                      setSelectedHistoryMonth(
                        firstMonth
                      );

                      setSelectedDate(
                        ''
                      );

                      setSelectedActivity(
                        null
                      );

                      setPreviewImage(
                        null
                      );
                    }}
                    className="
                      mt-1
                      w-full
                      border
                      border-slate-300
                      dark:border-slate-700
                      bg-white
                      dark:bg-slate-800
                      rounded-xl
                      px-3
                      py-2.5
                      text-sm
                      disabled:opacity-50
                    "
                  >

                    {!availableHistoryYears.length && (

                      <option value="">
                        No year available
                      </option>

                    )}


                    {availableHistoryYears.map(
                      (
                        year
                      ) => (

                      <option
                        key={year}
                        value={year}
                      >
                        {year}
                      </option>

                    ))}

                  </select>

                </div>


                <div>

                  <label className="
                    text-[11px]
                    font-bold
                    text-slate-500
                    uppercase
                  ">
                    Month
                  </label>


                  <select
                    value={
                      effectiveHistoryMonth
                    }
                    disabled={
                      !effectiveHistoryYear ||
                      !availableHistoryMonths.length
                    }
                    onChange={(e) => {

                      setSelectedHistoryMonth(
                        e.target.value
                      );

                      setSelectedDate(
                        ''
                      );

                      setSelectedActivity(
                        null
                      );

                      setPreviewImage(
                        null
                      );
                    }}
                    className="
                      mt-1
                      w-full
                      border
                      border-slate-300
                      dark:border-slate-700
                      bg-white
                      dark:bg-slate-800
                      rounded-xl
                      px-3
                      py-2.5
                      text-sm
                      disabled:opacity-50
                    "
                  >

                    {!availableHistoryMonths.length && (

                      <option value="">
                        No month available
                      </option>

                    )}


                    {availableHistoryMonths.map(
                      (
                        currentMonth
                      ) => (

                      <option
                        key={
                          currentMonth
                        }
                        value={
                          currentMonth
                        }
                      >
                        {getHistoryMonthLabel(
                          currentMonth
                        )}
                      </option>

                    ))}

                  </select>

                </div>

              </div>


              <div className="
                border-t
                border-slate-200
                dark:border-slate-800
              ">

                <div className="
                  px-4
                  py-3
                  text-[11px]
                  uppercase
                  font-bold
                  text-slate-500
                ">
                  Dates
                </div>


                <div className="
                  max-h-[560px]
                  overflow-y-auto
                  divide-y
                  divide-slate-100
                  dark:divide-slate-800
                ">

                  {filteredActivityDates.map(
                    (
                      row
                    ) => (

                    <button
                      key={
                        row.dateKey
                      }
                      type="button"
                      onClick={() => {

                        activityRequestRef.current +=
                          1;

                        setSelectedActivity(
                          null
                        );

                        setPreviewImage(
                          null
                        );

                        setSelectedDate(
                          row.dateKey
                        );
                      }}
                      className={`
                        w-full
                        text-left
                        p-4
                        transition

                        ${
                          selectedDate ===
                          row.dateKey

                            ? 'bg-indigo-50 dark:bg-indigo-950/40'

                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                        }
                      `}
                    >

                      <div className="
                        font-bold
                        text-sm
                      ">

                        {new Date(
                          `${row.dateKey}T00:00:00`
                        )
                          .toLocaleDateString(
                            undefined,
                            {
                              day:
                                '2-digit',

                              month:
                                'short',

                              year:
                                'numeric',
                            }
                          )}

                      </div>


                      <div className="
                        text-[11px]
                        text-slate-500
                        mt-1
                      ">

                        {formatSeconds(
                          row.totalSeconds
                        )}

                        {' • '}

                        {row.screenshotCount}

                        {' screenshot'}

                        {row.screenshotCount ===
                        1
                          ? ''
                          : 's'}

                      </div>

                    </button>

                  ))}


                  {selectedEmployeeId &&
                    effectiveHistoryMonth &&
                    filteredActivityDates.length ===
                      0 && (

                    <div className="
                      p-6
                      text-center
                      text-xs
                      text-slate-500
                    ">
                      No activity found for this month.
                    </div>

                  )}


                  {!selectedEmployeeId && (

                    <div className="
                      p-6
                      text-center
                      text-xs
                      text-slate-500
                    ">
                      Select an employee first.
                    </div>

                  )}

                </div>

              </div>

            </div>


            {/* RIGHT 75% */}

            <div className="
              space-y-4
              min-w-0
            ">

              <div className="
                grid
                grid-cols-1
                sm:grid-cols-3
                gap-4
              ">

                <div className="
                  p-5
                  bg-white
                  dark:bg-slate-900
                  border
                  border-slate-200
                  dark:border-slate-800
                  rounded-2xl
                ">

                  <div className="
                    text-xs
                    text-slate-500
                  ">
                    Selected Date
                  </div>

                  <div className="
                    text-base
                    font-black
                    mt-1
                  ">
                    {selectedDate ||
                      'Select a date'}
                  </div>

                </div>


                <div className="
                  p-5
                  bg-white
                  dark:bg-slate-900
                  border
                  border-slate-200
                  dark:border-slate-800
                  rounded-2xl
                ">

                  <div className="
                    text-xs
                    text-slate-500
                  ">
                    Tracked Time
                  </div>

                  <div className="
                    text-xl
                    font-black
                    mt-1
                  ">
                    {formatSeconds(
                      selectedActivity
                        ?.totalSeconds ||
                      0
                    )}
                  </div>

                </div>


                <div className="
                  p-5
                  bg-white
                  dark:bg-slate-900
                  border
                  border-slate-200
                  dark:border-slate-800
                  rounded-2xl
                ">

                  <div className="
                    text-xs
                    text-slate-500
                  ">
                    Screenshots
                  </div>

                  <div className="
                    text-xl
                    font-black
                    mt-1
                    text-indigo-600
                  ">
                    {selectedActivity
                      ?.screenshotCount ||
                      0}
                  </div>

                </div>

              </div>


              <div className="
                bg-white
                dark:bg-slate-900
                border
                border-slate-200
                dark:border-slate-800
                rounded-2xl
                overflow-hidden
                min-h-[560px]
              ">

                <div className="
                  p-4
                  border-b
                  border-slate-200
                  dark:border-slate-800
                  flex
                  items-center
                  justify-between
                  gap-3
                ">

                  <div>

                    <div className="
                      font-bold
                      text-sm
                    ">
                      Screenshots
                    </div>


                    <div className="
                      text-[11px]
                      text-slate-500
                      mt-0.5
                    ">

                      {selectedEmployee
                        ?.name ||
                        'Select employee'}

                      {' • '}

                      {selectedDate ||
                        'Select date'}

                    </div>

                  </div>


                  <div className="
                    text-xs
                    font-bold
                    text-indigo-600
                  ">
                    {selectedActivity
                      ?.screenshotCount ||
                      0}{' '}
                    captures
                  </div>

                </div>


                <div className="p-4">

                  {selectedActivity
                    ?.screenshots
                    ?.length ? (

                    <div className="
                      grid
                      grid-cols-1
                      md:grid-cols-2
                      xl:grid-cols-3
                      gap-4
                    ">

                      {selectedActivity
                        .screenshots
                        .map(
                          (
                            screen:
                              ScreenshotItem
                          ) => (

                        <button
                          key={
                            screen.id ||
                            screen.localUrl
                          }
                          type="button"
                          onClick={() =>
                            setPreviewImage(
                              screen
                            )
                          }
                          className="
                            text-left
                            rounded-xl
                            overflow-hidden
                            border
                            border-slate-200
                            dark:border-slate-800
                            hover:border-indigo-400
                            bg-slate-950
                          "
                        >

                          <img
                            src={
                              screen.localUrl
                            }
                            alt={
                              screen.fileName
                            }
                            loading="lazy"
                            className="
                              w-full
                              aspect-video
                              object-cover
                            "
                            onError={(
                              event
                            ) => {

                              console.error(
                                'Screenshot image failed:',
                                screen.fileName,
                                screen.localUrl
                              );

                              event
                                .currentTarget
                                .style
                                .display =
                                'none';
                            }}
                          />


                          <div className="
                            p-2
                            bg-white
                            dark:bg-slate-900
                            text-[11px]
                            truncate
                          ">
                            {screen.fileName}
                          </div>

                        </button>

                      ))}

                    </div>

                  ) : (

                    <div className="
                      min-h-[470px]
                      flex
                      flex-col
                      items-center
                      justify-center
                      text-center
                      text-slate-500
                    ">

                      <FileImage className="
                        w-9
                        h-9
                        mb-3
                      " />


                      <div className="
                        text-sm
                        font-semibold
                      ">

                        {selectedDate

                          ? 'No screenshots for this date'

                          : 'Select a date to view screenshots'
                        }

                      </div>

                    </div>

                  )}

                </div>

              </div>

            </div>

          </div>

        </div>

      )}


      {/* ================================================================
          GLOBAL CAPTURE SETTINGS
      ================================================================= */}

      {activeTab ===
        'storage' && (

        <div className="
          bg-white
          dark:bg-slate-900
          border
          border-slate-200
          dark:border-slate-800
          rounded-2xl
          p-6
          space-y-6
        ">

          <div>

            <h2 className="
              text-lg
              font-bold
            ">
              Global Screenshot
              Capture Policy
            </h2>

            <p className="
              text-xs
              text-slate-500
              mt-1
            ">
              Saving here updates
              the central server.
              All open employee PCs
              poll the setting and
              switch automatically.
            </p>

          </div>


          <div className="
            space-y-3
          ">

            <label className="
              text-xs
              font-bold
              uppercase
              text-slate-500
            ">
              Random Screenshot
              Presets
            </label>


            <div className="
              grid
              grid-cols-2
              sm:grid-cols-3
              lg:grid-cols-6
              gap-2
            ">

              {[
                {
                  id:
                    '10s-1',

                  label:
                    '10 sec / 1 SS',

                  window:
                    10,

                  shots:
                    1,
                },

                {
                  id:
                    '1m-3',

                  label:
                    '1 min / 3 SS',

                  window:
                    60,

                  shots:
                    3,
                },

                {
                  id:
                    '2m-3',

                  label:
                    '2 min / 3 SS',

                  window:
                    120,

                  shots:
                    3,
                },

                {
                  id:
                    '5m-5',

                  label:
                    '5 min / 5 SS',

                  window:
                    300,

                  shots:
                    5,
                },

                {
                  id:
                    '10m-5',

                  label:
                    '10 min / 5 SS',

                  window:
                    600,

                  shots:
                    5,
                },

                {
                  id:
                    '15m-5',

                  label:
                    '15 min / 5 SS',

                  window:
                    900,

                  shots:
                    5,
                },

              ].map(
                (
                  opt
                ) => (

                <button
                  key={
                    opt.id
                  }
                  type="button"
                  onClick={() =>
                    applyPreset(
                      opt.id,
                      opt.window,
                      opt.shots
                    )
                  }
                  className={`
                    p-3
                    rounded-xl
                    border
                    text-xs
                    font-bold

                    ${
                      presetId ===
                      opt.id

                        ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'

                        : 'border-slate-200 dark:border-slate-700'
                    }
                  `}
                >
                  {opt.label}
                </button>

              ))}

            </div>


            {/* CUSTOM */}

            <div className="
              rounded-xl
              border
              border-slate-200
              dark:border-slate-700
              p-4
              space-y-3
            ">

              <div>

                <div className="
                  text-xs
                  font-bold
                ">
                  Custom Random Policy
                </div>

                <div className="
                  text-[11px]
                  text-slate-500
                  mt-1
                ">
                  Example: 10 minutes +
                  20 screenshots =
                  exactly 20 screenshots
                  at fresh random times
                  within every
                  10-minute window.
                </div>

              </div>


              <div className="
                grid
                sm:grid-cols-2
                gap-3
              ">

                <label className="
                  space-y-1
                ">

                  <span className="
                    text-[11px]
                    font-bold
                    uppercase
                    text-slate-500
                  ">
                    Duration (minutes)
                  </span>


                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={
                      customMinutes
                    }
                    onChange={(e) => {

                      captureEditingRef.current =
                        true;

                      setCustomMinutes(
                        Math.max(
                          1,
                          Number(
                            e.target
                              .value
                          ) || 1
                        )
                      );
                    }}
                    className="
                      w-full
                      rounded-lg
                      border
                      border-slate-300
                      dark:border-slate-700
                      bg-transparent
                      px-3
                      py-2
                      text-sm
                    "
                  />

                </label>


                <label className="
                  space-y-1
                ">

                  <span className="
                    text-[11px]
                    font-bold
                    uppercase
                    text-slate-500
                  ">
                    Screenshots
                  </span>


                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={
                      customScreenshots
                    }
                    onChange={(e) => {

                      captureEditingRef.current =
                        true;

                      setCustomScreenshots(
                        Math.max(
                          1,
                          Number(
                            e.target
                              .value
                          ) || 1
                        )
                      );
                    }}
                    className="
                      w-full
                      rounded-lg
                      border
                      border-slate-300
                      dark:border-slate-700
                      bg-transparent
                      px-3
                      py-2
                      text-sm
                    "
                  />

                </label>

              </div>


              <button
                type="button"
                onClick={
                  applyCustomPolicy
                }
                className="
                  px-4
                  py-2
                  rounded-lg
                  bg-indigo-600
                  hover:bg-indigo-500
                  text-white
                  text-xs
                  font-bold
                "
              >
                Apply Custom
              </button>

            </div>

          </div>


          <div className="
            grid
            md:grid-cols-2
            gap-4
          ">

            <div className="
              rounded-xl
              border
              border-slate-200
              dark:border-slate-700
              p-4
            ">

              <div className="
                text-xs
                text-slate-500
              ">
                Selected Window
              </div>

              <div className="
                mt-1
                text-lg
                font-black
              ">

                {captureWindowSeconds <
                60

                  ? `${captureWindowSeconds} sec`

                  : `${Math.round(
                      captureWindowSeconds /
                        60
                    )} min`
                }

              </div>

            </div>


            <div className="
              rounded-xl
              border
              border-slate-200
              dark:border-slate-700
              p-4
            ">

              <div className="
                text-xs
                text-slate-500
              ">
                Screenshots per Window
              </div>

              <div className="
                mt-1
                text-lg
                font-black
              ">
                {screenshotsPerWindow}
              </div>

            </div>

          </div>


          <label className="
            flex
            items-center
            gap-3
            rounded-xl
            border
            border-slate-200
            dark:border-slate-700
            p-4
          ">

            <input
              type="checkbox"
              checked={
                lockIntervalForEmployees
              }
              onChange={(e) => {

                captureEditingRef.current =
                  true;

                setLockIntervalForEmployees(
                  e.target
                    .checked
                );
              }}
            />


            <div>

              <div className="
                text-sm
                font-bold
              ">
                Lock capture policy
                for employees
              </div>

              <div className="
                text-[11px]
                text-slate-500
              ">
                Employees will use
                the global capture
                policy configured
                here.
              </div>

            </div>

          </label>


          <button
            type="button"
            onClick={() =>
              void saveGlobalCaptureSettings()
            }
            disabled={loading}
            className="
              inline-flex
              items-center
              gap-2
              px-5
              py-2.5
              rounded-xl
              bg-indigo-600
              hover:bg-indigo-500
              disabled:opacity-50
              text-white
              text-sm
              font-bold
            "
          >

            <Save className="
              w-4
              h-4
            " />

            Save Global Settings

          </button>


          <div className="
            text-[11px]
            text-slate-500
          ">
            Capture mode:{' '}
            {captureMode}

            {' • '}

            Interval:{' '}
            {captureIntervalSeconds}
            s

            {' • '}

            Employee lock:{' '}

            {lockIntervalForEmployees
              ? 'On'
              : 'Off'
            }

          </div>

        </div>

      )}


      {/* ================================================================
          SCREENSHOT PREVIEW MODAL
      ================================================================= */}

      {previewImage && (

        <div
          className="
            fixed
            inset-0
            z-[100]
            bg-black/90
            p-4
            flex
            items-center
            justify-center
          "
          onClick={() =>
            setPreviewImage(
              null
            )
          }
        >

          <div
            className="
              relative
              max-w-7xl
              w-full
            "
            onClick={(
              event
            ) =>
              event
                .stopPropagation()
            }
          >

            <div className="
              flex
              justify-end
              mb-2
            ">

              <button
                onClick={() =>
                  setPreviewImage(
                    null
                  )
                }
                className="
                  text-white
                  p-2
                "
              >

                <X className="
                  w-6
                  h-6
                " />

              </button>

            </div>


            <img
              src={
                previewImage.localUrl
              }
              alt={
                previewImage.fileName
              }
              className="
                max-h-[85vh]
                w-auto
                mx-auto
                rounded-xl
                shadow-2xl
              "
              onError={(event) => {

                console.error(
                  'Preview screenshot failed:',
                  previewImage.fileName,
                  previewImage.localUrl
                );

                event
                  .currentTarget
                  .style
                  .display =
                  'none';
              }}
            />

          </div>

        </div>

      )}

    </div>
  );
};
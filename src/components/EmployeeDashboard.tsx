import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AppUser,
  ScreenshotLog,
  StorageSettings,
} from '../types';

import {
  Play,
  Pause,
  Square,
  Camera,
  Calendar,
  Clock,
  Monitor,
  RefreshCw,
  AlertCircle,
  X,
  CheckCircle2,
} from 'lucide-react';

import {
  canvasToBlob,
  formatSecondsToHoursMinutes,
  formatTimeString,
  generateThumbnailDataUrl,
  getHourSlotKey,
  getTodayDateKey,
} from '../lib/utils';

import {
  getLocalScreenshots,
  uploadScreenshotLocally,
} from '../lib/localStorageService';

import {
  setCachedScreenshot,
} from '../lib/screenshotCache';

import {
  ScreenshotViewerImage,
} from './ScreenshotViewerImage';

// ======================================================
// BACKEND
// ======================================================

const getBackendUrl = (): string => {
  const configured =
    import.meta.env.VITE_BACKEND_URL?.trim();

  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return '';
};

// ======================================================
// SAFE JSON
// ======================================================

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
    console.warn(
      'Backend returned non-JSON:',
      raw.slice(0, 150)
    );

    throw new Error(
      `Backend returned non-JSON response (${response.status}). Restart node server.js.`
    );
  }

  try {
    return raw
      ? JSON.parse(raw)
      : {};
  } catch {
    throw new Error(
      'Backend returned invalid JSON.'
    );
  }
};

// ======================================================
// TYPES
// ======================================================

interface ActivityHistoryRecord {
  dateKey: string;
  totalSeconds: number;
  screenshotCount: number;
}

interface EmployeeDashboardProps {
  currentUser: AppUser;

  storageSettings:
    StorageSettings;

  accessToken:
    string | null;

  onConnectDrive:
    () => void;

  onNewScreenshot:
    (
      log: ScreenshotLog
    ) => void;

  userScreenshots:
    ScreenshotLog[];

  onLogout?:
    () => void;
}

// ======================================================
// COMPONENT
// ======================================================

export const EmployeeDashboard:
  React.FC<
    EmployeeDashboardProps
  > = ({
    currentUser,
    storageSettings,
    onNewScreenshot,
    userScreenshots,
    onLogout,
  }) => {

  const backendUrl =
    useMemo(
      () =>
        getBackendUrl(),
      []
    );

  const backendHeaders =
    useMemo(
      () => ({
        'ngrok-skip-browser-warning':
          'true',
      }),
      []
    );

  // ====================================================
  // TRACKER
  // ====================================================

  const [
    taskName,
    setTaskName,
  ] =
    useState(
      'Product Design & Implementation'
    );

  const [
    isTracking,
    setIsTracking,
  ] =
    useState(false);

  const [
    isPaused,
    setIsPaused,
  ] =
    useState(false);

  const [
    sessionSeconds,
    setSessionSeconds,
  ] =
    useState(0);

  const [
    dayTotalSeconds,
    setDayTotalSeconds,
  ] =
    useState(0);

  const [
    lastStatus,
    setLastStatus,
  ] =
    useState(
      'Ready to start tracking'
    );

  const [
    nextCaptureInSec,
    setNextCaptureInSec,
  ] =
    useState<
      number | null
    >(null);

  const [
    lastCapturedTime,
    setLastCapturedTime,
  ] =
    useState('');

  // ====================================================
  // GLOBAL ADMIN POLICY
  // ====================================================

  const [
    captureWindowSeconds,
    setCaptureWindowSeconds,
  ] =
    useState(
      Math.max(
        5,
        Number(
          storageSettings
            .captureIntervalSeconds ||
            600
        )
      )
    );

  const [
    screenshotsPerWindow,
    setScreenshotsPerWindow,
  ] =
    useState(5);

  const [
    capturePresetId,
    setCapturePresetId,
  ] =
    useState('10m-5');

  const [
    centralPolicyUpdatedAt,
    setCentralPolicyUpdatedAt,
  ] =
    useState('');

  // ====================================================
  // HISTORY
  // ====================================================

  const [
    selectedDate,
    setSelectedDate,
  ] =
    useState(
      getTodayDateKey()
    );

  const [
    activityHistory,
    setActivityHistory,
  ] =
    useState<
      ActivityHistoryRecord[]
    >([]);

  const [
    selectedDateSeconds,
    setSelectedDateSeconds,
  ] =
    useState(0);

  const [
    selectedDateScreenshotCount,
    setSelectedDateScreenshotCount,
  ] =
    useState(0);

  const [
    restoredScreenshots,
    setRestoredScreenshots,
  ] =
    useState<
      ScreenshotLog[]
    >([]);

  const [
    loadingHistory,
    setLoadingHistory,
  ] =
    useState(false);

  const [
    previewModal,
    setPreviewModal,
  ] =
    useState<
      ScreenshotLog | null
    >(null);


  // ====================================================
  // YEAR / MONTH HISTORY NAVIGATION
  // ====================================================

  const [selectedHistoryYear, setSelectedHistoryYear] =
    useState<string>(getTodayDateKey().slice(0, 4));

  const [selectedHistoryMonth, setSelectedHistoryMonth] =
    useState<string>(getTodayDateKey().slice(0, 7));

  // Blob URLs allow ngrok-protected screenshots to render in <img>.
  const [employeeScreenshotUrls, setEmployeeScreenshotUrls] =
    useState<Record<string, string>>({});

  // ====================================================
  // SCREEN CAPTURE
  // ====================================================

  const screenVideoRef =
    useRef<
      HTMLVideoElement | null
    >(null);

  const screenStreamRef =
    useRef<
      MediaStream | null
    >(null);

  const captureTimerRef =
    useRef<
      number | null
    >(null);

  const countdownRef =
    useRef<
      number | null
    >(null);

  const trackerTimerRef =
    useRef<
      number | null
    >(null);

  const trackingRef =
    useRef(false);

  const pausedRef =
    useRef(false);

  const daySecondsRef =
    useRef(0);

  const captureWindowRef =
    useRef(
      captureWindowSeconds
    );

  const screenshotCountRef =
    useRef(
      screenshotsPerWindow
    );

  // ====================================================
  // KEEP REFS CURRENT
  // ====================================================

  useEffect(() => {
    trackingRef.current =
      isTracking;
  }, [
    isTracking,
  ]);

  useEffect(() => {
    pausedRef.current =
      isPaused;
  }, [
    isPaused,
  ]);

  useEffect(() => {
    daySecondsRef.current =
      dayTotalSeconds;
  }, [
    dayTotalSeconds,
  ]);

  useEffect(() => {
    captureWindowRef.current =
      captureWindowSeconds;
  }, [
    captureWindowSeconds,
  ]);

  useEffect(() => {
    screenshotCountRef.current =
      screenshotsPerWindow;
  }, [
    screenshotsPerWindow,
  ]);

  // ====================================================
  // LOCAL TIMER STORAGE
  // ====================================================

  const timerStorageKey =
    `wm_emp_timer_` +
    `${currentUser.id}_` +
    `${getTodayDateKey()}`;

  // Restore browser timer
  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(
          timerStorageKey
        );

      if (!raw) {
        return;
      }

      const saved =
        JSON.parse(raw);

      if (
        typeof saved
          ?.dayTotalSeconds ===
        'number'
      ) {
        setDayTotalSeconds(
          Math.max(
            0,
            saved
              .dayTotalSeconds
          )
        );
      }

      if (
        typeof saved
          ?.sessionSeconds ===
        'number'
      ) {
        setSessionSeconds(
          Math.max(
            0,
            saved
              .sessionSeconds
          )
        );
      }

      if (
        saved?.taskName
      ) {
        setTaskName(
          saved.taskName
        );
      }
    } catch (
      error
    ) {
      console.warn(
        'Timer restore warning:',
        error
      );
    }
  }, [
    timerStorageKey,
  ]);

  // Save timer
  useEffect(() => {
    try {
      localStorage.setItem(
        timerStorageKey,

        JSON.stringify({
          dayTotalSeconds,
          sessionSeconds,
          taskName,
          isTracking,
          isPaused,
          updatedAt:
            Date.now(),
        })
      );
    } catch {
      // ignore
    }
  }, [
    timerStorageKey,
    dayTotalSeconds,
    sessionSeconds,
    taskName,
    isTracking,
    isPaused,
  ]);

  // ====================================================
  // CENTRAL TRACKER SYNC
  // ====================================================

  const syncTrackerTime =
    async (
      seconds =
        daySecondsRef.current
    ) => {
      try {
        const response =
          await fetch(
            `${backendUrl}/api/tracker-time`,
            {
              method:
                'POST',

              headers: {
                ...backendHeaders,
                'Content-Type':
                  'application/json',
              },

              body:
                JSON.stringify({
                  employeeId:
                    currentUser.id,

                  employeeName:
                    currentUser.name,

                  dateKey:
                    getTodayDateKey(),

                  totalSeconds:
                    Math.max(
                      0,
                      Math.floor(
                        seconds
                      )
                    ),
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
              'Tracker sync failed'
          );
        }

        return Number(
          data.totalSeconds ||
            seconds
        );
      } catch (
        error
      ) {
        console.warn(
          'Tracker sync warning:',
          error
        );

        return seconds;
      }
    };

  // ====================================================
  // LOAD CENTRAL TODAY TIME
  // ====================================================

  useEffect(() => {
    let cancelled =
      false;

    const load =
      async () => {
        try {
          const response =
            await fetch(
              `${backendUrl}/api/tracker-time/` +
                `${encodeURIComponent(
                  currentUser.id
                )}/` +
                `${getTodayDateKey()}`,
              {
                cache:
                  'no-store',
                headers:
                  backendHeaders,
              }
            );

          const data =
            await readApiJson(
              response
            );

          if (
            cancelled ||
            !response.ok ||
            !data?.success
          ) {
            return;
          }

          const centralSeconds =
            Math.max(
              0,
              Number(
                data.totalSeconds ||
                  0
              )
            );

          setDayTotalSeconds(
            (
              previous
            ) =>
              Math.max(
                previous,
                centralSeconds
              )
          );
        } catch (
          error
        ) {
          console.warn(
            'Central tracker load warning:',
            error
          );
        }
      };

    load();

    return () => {
      cancelled =
        true;
    };
  }, [
    backendUrl,
    currentUser.id,
  ]);

  // ====================================================
  // TIMER
  // ====================================================

  useEffect(() => {
    if (
      isTracking &&
      !isPaused
    ) {
      trackerTimerRef.current =
        window.setInterval(
          () => {
            setSessionSeconds(
              (
                previous
              ) =>
                previous +
                1
            );

            setDayTotalSeconds(
              (
                previous
              ) =>
                previous +
                1
            );
          },
          60000
        );
    } else {
      if (
        trackerTimerRef.current
      ) {
        clearInterval(
          trackerTimerRef.current
        );

        trackerTimerRef.current =
          null;
      }
    }

    return () => {
      if (
        trackerTimerRef.current
      ) {
        clearInterval(
          trackerTimerRef.current
        );
      }
    };
  }, [
    isTracking,
    isPaused,
  ]);

  // Sync every 10 sec
  useEffect(() => {
    if (
      !isTracking ||
      isPaused
    ) {
      return;
    }

    const id =
      window.setInterval(
        () => {
          void syncTrackerTime();
        },
        60000
      );

    return () =>
      window.clearInterval(
        id
      );
  }, [
    isTracking,
    isPaused,
  ]);

  // ====================================================
  // SCREEN SHARE
  // ====================================================

  const initScreenStream =
    async () => {
      try {
        if (
          !window.isSecureContext ||
          !navigator
            .mediaDevices ||
          typeof navigator
            .mediaDevices
            .getDisplayMedia !==
            'function'
        ) {
          throw new Error(
            'Screen capture requires HTTPS.'
          );
        }

        if (
          screenStreamRef
            .current
            ?.active
        ) {
          return (
            screenStreamRef
              .current
          );
        }

        let stream:
          MediaStream;

        try {
          stream =
            await navigator
              .mediaDevices
              .getDisplayMedia({
                video: {
                  displaySurface:
                    'monitor',

                  frameRate: {
                    ideal:
                      5,

                    max:
                      15,
                  },
                },

                audio:
                  false,

                monitorTypeSurfaces:
                  'include',

                selfBrowserSurface:
                  'exclude',

                surfaceSwitching:
                  'exclude',

                preferCurrentTab:
                  false,
              } as any);
        } catch {
          stream =
            await navigator
              .mediaDevices
              .getDisplayMedia({
                video:
                  true,

                audio:
                  false,
              });
        }

        const videoTrack =
          stream.getVideoTracks()[
            0
          ];

        if (
          videoTrack
        ) {
          videoTrack.onended =
            () => {
              screenStreamRef.current =
                null;

              if (
                screenVideoRef.current
              ) {
                screenVideoRef.current.srcObject =
                  null;
              }

              setLastStatus(
                'Screen sharing stopped. Start tracking again to continue.'
              );

              setIsTracking(
                false
              );

              setIsPaused(
                false
              );
            };
        }

        screenStreamRef.current =
          stream;

        if (
          screenVideoRef.current
        ) {
          screenVideoRef.current.srcObject =
            stream;

          await screenVideoRef.current
            .play()
            .catch(
              () => {}
            );
        }

        return stream;
      } catch (
        error: any
      ) {
        console.error(
          'Screen permission error:',
          error
        );

        setLastStatus(
          `Screen capture permission required: ${
            error?.message ||
            'Cancelled'
          }`
        );

        return null;
      }
    };

  // ====================================================
  // CAPTURE CANVAS
  // ====================================================

  const captureCurrentScreen =
    async (
      stream:
        MediaStream
    ) => {

      let video =
        screenVideoRef.current;

      if (!video) {
        return null;
      }

      if (
        video.srcObject !==
        stream
      ) {
        video.srcObject =
          stream;
      }

      await video
        .play()
        .catch(
          () => {}
        );

      let attempts =
        0;

      while (
        (!video.videoWidth ||
          !video.videoHeight) &&
        attempts <
          30
      ) {
        await new Promise(
          (
            resolve
          ) =>
            setTimeout(
              resolve,
              100
            )
        );

        attempts++;
      }

      if (
        !video.videoWidth ||
        !video.videoHeight
      ) {
        throw new Error(
          'Screen frame is not ready.'
        );
      }

      const canvas =
        document.createElement(
          'canvas'
        );

      canvas.width =
        video.videoWidth;

      canvas.height =
        video.videoHeight;

      const ctx =
        canvas.getContext(
          '2d',
          {
            alpha:
              false,
          }
        );

      if (!ctx) {
        throw new Error(
          'Canvas unavailable.'
        );
      }

      ctx.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      return canvas;
    };

  // ====================================================
  // SCREENSHOT UPLOAD
  // ====================================================

  const captureAndUpload =
    async () => {
      if (
        !trackingRef.current ||
        pausedRef.current
      ) {
        return;
      }

      try {
        setLastStatus(
          'Capturing screenshot...'
        );

        const stream =
          await initScreenStream();

        if (!stream) {
          return;
        }

        const canvas =
          await captureCurrentScreen(
            stream
          );

        if (!canvas) {
          return;
        }

        const format =
          storageSettings
            .screenshotFormat ||
          'webp';

        const {
          blob,
          mimeType,
          extension,
        } =
          await canvasToBlob(
            canvas,
            format
          );

        const now =
          new Date();

        const dateKey =
          getTodayDateKey(
            now
          );

        const timeFormatted =
          formatTimeString(
            now
          );

        const hourKey =
          getHourSlotKey(
            now
          );

        const safeTime =
          now
            .toTimeString()
            .split(' ')[0]
            .replace(
              /:/g,
              '-'
            );

        const fileName =
          `Screen_${dateKey}_${safeTime}.${extension}`;

        // Ensure folder
        try {
          await fetch(
            `${backendUrl}/api/provision-employee`,
            {
              method:
                'POST',

              headers: {
                ...backendHeaders,
                'Content-Type':
                  'application/json',
              },

              body:
                JSON.stringify({
                  employeeId:
                    currentUser.id,

                  employeeName:
                    currentUser.name,

                  dateKey,
                }),
            }
          );
        } catch {
          // continue upload
        }

        const result =
          await uploadScreenshotLocally(
            blob,
            fileName,
            currentUser.id,
            currentUser.name,
            dateKey
          );

        const thumbnail =
          generateThumbnailDataUrl(
            canvas,
            640,
            360,
            0.75
          );

        const fullDataUrl =
          canvas.toDataURL(
            mimeType,
            0.9
          );

        const id =
          `scr-${Date.now()}`;

        setCachedScreenshot(
          id,
          fullDataUrl
        );

        const log:
          ScreenshotLog = {
            id,

            userId:
              currentUser.id,

            userName:
              currentUser.name,

            userEmail:
              currentUser.email,

            taskName,

            timestamp:
              now.toISOString(),

            timeFormatted,

            hourKey,

            dateKey,

            fileFormat:
              format,

            driveFileId:
              result.fileId,

            driveThumbnailLink:
              result.localUrl,

            previewDataUrl:
              thumbnail,

            productivityScore:
              92,

            productivityLabel:
              'High',
          };

        onNewScreenshot(
          log
        );

        setLastCapturedTime(
          timeFormatted
        );

        setLastStatus(
          `✅ Screenshot saved: ${result.filePath}`
        );

        // Refresh selected date after upload
        if (
          selectedDate ===
          dateKey
        ) {
          await loadDateHistory();
        }
      } catch (
        error: any
      ) {
        console.error(
          'Capture error:',
          error
        );

        setLastStatus(
          `Capture warning: ${
            error?.message ||
            'Unknown error'
          }`
        );
      }
    };

  // ====================================================
  // RANDOM SCREENSHOT WINDOW
  // ====================================================

  const clearCaptureTimers =
    () => {
      if (
        captureTimerRef.current
      ) {
        clearTimeout(
          captureTimerRef.current
        );

        captureTimerRef.current =
          null;
      }

      if (
        countdownRef.current
      ) {
        clearInterval(
          countdownRef.current
        );

        countdownRef.current =
          null;
      }
    };

  const scheduleRandomWindow =
    (
      windowSeconds =
        captureWindowRef.current,

      screenshotCount =
        screenshotCountRef.current
    ) => {

      clearCaptureTimers();

      if (
        !trackingRef.current ||
        pausedRef.current
      ) {
        return;
      }

      const safeWindow =
        Math.max(
          5,
          Math.floor(
            Number(
              windowSeconds
            ) || 600
          )
        );

      const safeCount =
        Math.max(
          1,
          Math.floor(
            Number(
              screenshotCount
            ) || 1
          )
        );

      const windowMs =
        safeWindow *
        1000;

      // Divide full window into random zones.
      // This keeps shots random but prevents them
      // all coming at exactly the same second.
      const randomPositions =
        Array.from(
          {
            length:
              safeCount,
          },

          (
            _,
            index
          ) => {

            const zoneStart =
              (
                windowMs *
                index
              ) /
              safeCount;

            const zoneEnd =
              (
                windowMs *
                (
                  index +
                  1
                )
              ) /
              safeCount;

            const padding =
              Math.min(
                500,
                Math.max(
                  50,
                  (
                    zoneEnd -
                    zoneStart
                  ) *
                    0.05
                )
              );

            const start =
              zoneStart +
              padding;

            const end =
              Math.max(
                start +
                  25,
                zoneEnd -
                  padding
              );

            return Math.floor(
              start +
                Math.random() *
                  (
                    end -
                    start
                  )
            );
          }
        ).sort(
          (
            a,
            b
          ) =>
            a - b
        );

      let index =
        0;

      let elapsedPosition =
        0;

      const scheduleNext =
        () => {

          if (
            !trackingRef.current ||
            pausedRef.current
          ) {
            clearCaptureTimers();
            return;
          }

          // All screenshots done.
          // Wait until current window finishes,
          // then generate a fresh random window.
          if (
            index >=
            randomPositions.length
          ) {
            const remaining =
              Math.max(
                100,
                windowMs -
                  elapsedPosition
              );

            setNextCaptureInSec(
              Math.ceil(
                remaining /
                  1000
              )
            );

            countdownRef.current =
              window.setInterval(
                () => {
                  setNextCaptureInSec(
                    (
                      previous
                    ) =>
                      previous ===
                        null ||
                      previous <=
                        1
                        ? 0
                        : previous -
                          1
                  );
                },
                1000
              );

            captureTimerRef.current =
              window.setTimeout(
                () => {
                  clearCaptureTimers();

                  scheduleRandomWindow(
                    safeWindow,
                    safeCount
                  );
                },
                remaining
              );

            return;
          }

          const position =
            randomPositions[
              index
            ];

          const delay =
            Math.max(
              50,
              position -
                elapsedPosition
            );

          setNextCaptureInSec(
            Math.max(
              1,
              Math.ceil(
                delay /
                  1000
              )
            )
          );

          countdownRef.current =
            window.setInterval(
              () => {
                setNextCaptureInSec(
                  (
                    previous
                  ) =>
                    previous ===
                      null ||
                    previous <=
                      1
                      ? 0
                      : previous -
                        1
                );
              },
              1000
            );

          captureTimerRef.current =
            window.setTimeout(
              async () => {

                if (
                  countdownRef.current
                ) {
                  clearInterval(
                    countdownRef.current
                  );

                  countdownRef.current =
                    null;
                }

                await captureAndUpload();

                elapsedPosition =
                  position;

                index++;

                scheduleNext();
              },
              delay
            );
        };

      scheduleNext();
    };

  // ====================================================
  // GLOBAL POLICY POLLING
  // ====================================================

  useEffect(() => {
    let cancelled =
      false;

    let previousSignature =
      '';

    const loadPolicy =
      async () => {
        try {
          const response =
            await fetch(
              `${backendUrl}/api/capture-settings`,
              {
                cache:
                  'no-store',
                headers:
                  backendHeaders,
              }
            );

          const data =
            await readApiJson(
              response
            );

          if (
            cancelled ||
            !response.ok ||
            !data?.success ||
            !data?.settings
          ) {
            return;
          }

          const settings =
            data.settings;

          const newWindow =
            Math.max(
              5,
              Number(
                settings
                  .captureWindowSeconds ||
                  settings
                    .captureIntervalSeconds ||
                  600
              )
            );

          const newCount =
            Math.max(
              1,
              Number(
                settings
                  .screenshotsPerWindow ||
                  1
              )
            );

          const newPreset =
            String(
              settings
                .presetId ||
                'custom'
            );

          const signature =
            `${newWindow}:` +
            `${newCount}:` +
            `${newPreset}:` +
            `${
              settings
                .updatedAt ||
              ''
            }`;

          setCentralPolicyUpdatedAt(
            String(
              settings
                .updatedAt ||
                ''
            )
          );

          if (
            previousSignature !==
            signature
          ) {
            previousSignature =
              signature;

            setCaptureWindowSeconds(
              newWindow
            );

            setScreenshotsPerWindow(
              newCount
            );

            setCapturePresetId(
              newPreset
            );

            captureWindowRef.current =
              newWindow;

            screenshotCountRef.current =
              newCount;

            // Admin changed settings while employee
            // is actively tracking.
            if (
              trackingRef.current &&
              !pausedRef.current
            ) {
              scheduleRandomWindow(
                newWindow,
                newCount
              );

              setLastStatus(
                `✅ New Admin policy applied: ${newCount} screenshot(s) / ${
                  newWindow <
                  60
                    ? `${newWindow} sec`
                    : `${Math.round(
                        newWindow /
                          60
                      )} min`
                }`
              );
            }
          }
        } catch (
          error
        ) {
          console.warn(
            'Capture policy warning:',
            error
          );
        }
      };

    loadPolicy();

    const id =
      window.setInterval(
        loadPolicy,
        5000
      );

    return () => {
      cancelled =
        true;

      window.clearInterval(
        id
      );
    };
  }, [
    backendUrl,
  ]);

  // ====================================================
  // HISTORY
  // ====================================================

  const loadDateHistory =
    async () => {
      setLoadingHistory(
        true
      );

      try {
        const [
          historyResponse,
          activityResponse,
        ] =
          await Promise.all([
            fetch(
              `${backendUrl}/api/activity-history/${encodeURIComponent(
                currentUser.id
              )}`,
              {
                cache:
                  'no-store',
                headers:
                  backendHeaders,
              }
            ),

            fetch(
              `${backendUrl}/api/activity/${encodeURIComponent(
                currentUser.id
              )}/${encodeURIComponent(
                selectedDate
              )}`,
              {
                cache:
                  'no-store',
                headers:
                  backendHeaders,
              }
            ),
          ]);

        const historyData =
          await readApiJson(
            historyResponse
          );

        const activityData =
          await readApiJson(
            activityResponse
          );

        if (
          historyResponse.ok &&
          historyData
            ?.success
        ) {
          setActivityHistory(
            Array.isArray(
              historyData.records
            )
              ? historyData.records
              : []
          );
        }

        if (
          activityResponse.ok &&
          activityData
            ?.success
        ) {
          setSelectedDateSeconds(
            Math.max(
              0,
              Number(
                activityData
                  .totalSeconds ||
                  0
              )
            )
          );

          setSelectedDateScreenshotCount(
            Math.max(
              0,
              Number(
                activityData
                  .screenshotCount ||
                  0
              )
            )
          );
        } else {
          setSelectedDateSeconds(
            0
          );

          setSelectedDateScreenshotCount(
            0
          );
        }

        // Central files
        const files =
          await getLocalScreenshots(
            currentUser.id,
            selectedDate
          );

        const restored:
          ScreenshotLog[] =
          files.map(
            (
              item,
              index
            ) => {

              const fileName =
                item.fileName;

              const url =
                item.localUrl;

              const match =
                fileName.match(
                  /Screen_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})\.(webp|png|jpg|jpeg)$/i
                );

              let timestamp =
                `${selectedDate}T00:00:00`;

              let timeFormatted =
                '';

              let hourKey =
                '';

              if (match) {
                const [
                  ,
                  date,
                  hh,
                  mm,
                  ss,
                ] =
                  match;

                const dateObject =
                  new Date(
                    `${date}T${hh}:${mm}:${ss}`
                  );

                timestamp =
                  dateObject.toISOString();

                timeFormatted =
                  formatTimeString(
                    dateObject
                  );

                hourKey =
                  getHourSlotKey(
                    dateObject
                  );
              }

              const extension =
                fileName
                  .toLowerCase()
                  .endsWith(
                    '.png'
                  )
                  ? 'png'
                  : fileName
                      .toLowerCase()
                      .match(
                        /\.jpe?g$/
                      )
                    ? 'jpg'
                    : 'webp';

              return {
                id:
                  `saved-${selectedDate}-${fileName}-${index}`,

                userId:
                  currentUser.id,

                userName:
                  currentUser.name,

                userEmail:
                  currentUser.email,

                taskName:
                  'Saved Screenshot',

                timestamp,

                timeFormatted,

                hourKey,

                dateKey:
                  selectedDate,

                fileFormat:
                  extension,

                driveFileId:
                  fileName,

                driveThumbnailLink:
                  url,

                previewDataUrl:
                  url,
              };
            }
          );

        restored.sort(
          (
            a,
            b
          ) =>
            new Date(
              b.timestamp
            ).getTime() -
            new Date(
              a.timestamp
            ).getTime()
        );

        setRestoredScreenshots(
          restored
        );
      } catch (
        error
      ) {
        console.warn(
          'History warning:',
          error
        );
      } finally {
        setLoadingHistory(
          false
        );
      }
    };

  useEffect(() => {
    loadDateHistory();

    const id =
      window.setInterval(
        loadDateHistory,
        10 * 60 * 1000
      );

    return () =>
      window.clearInterval(
        id
      );
  }, [
    selectedDate,
    currentUser.id,
    currentUser.name,
  ]);

  // ====================================================
  // MERGE SCREENSHOTS
  // ====================================================

  const mergedScreenshots =
    useMemo(() => {

      const map =
        new Map<
          string,
          ScreenshotLog
        >();

      restoredScreenshots.forEach(
        (
          screenshot
        ) => {

          const key =
            screenshot
              .driveThumbnailLink ||
            screenshot
              .driveFileId ||
            screenshot.id;

          map.set(
            key,
            screenshot
          );
        }
      );

      userScreenshots.forEach(
        (
          screenshot
        ) => {

          if (
            screenshot.dateKey !==
            selectedDate
          ) {
            return;
          }

          const key =
            screenshot
              .driveThumbnailLink ||
            screenshot
              .driveFileId ||
            screenshot.id;

          map.set(
            key,
            screenshot
          );
        }
      );

      return Array.from(
        map.values()
      ).sort(
        (
          a,
          b
        ) =>
          new Date(
            b.timestamp
          ).getTime() -
          new Date(
            a.timestamp
          ).getTime()
      );
    }, [
      restoredScreenshots,
      userScreenshots,
      selectedDate,
    ]);

  // ====================================================
  // YEAR / MONTH HISTORY GROUPS
  // ====================================================

  const historyYears = useMemo(() => {
    return Array.from(
      new Set(
        activityHistory
          .map((record) => record.dateKey.slice(0, 4))
          .filter(Boolean)
      )
    ).sort((a, b) => b.localeCompare(a));
  }, [activityHistory]);

  const historyMonths = useMemo(() => {
    return Array.from(
      new Set(
        activityHistory
          .filter((record) => record.dateKey.startsWith(`${selectedHistoryYear}-`))
          .map((record) => record.dateKey.slice(0, 7))
      )
    ).sort((a, b) => b.localeCompare(a));
  }, [activityHistory, selectedHistoryYear]);

  const filteredHistoryDates = useMemo(() => {
    return activityHistory
      .filter((record) => record.dateKey.startsWith(`${selectedHistoryMonth}-`))
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [activityHistory, selectedHistoryMonth]);

  useEffect(() => {
    if (!activityHistory.length) return;

    const preferredYear =
      historyYears.includes(selectedDate.slice(0, 4))
        ? selectedDate.slice(0, 4)
        : historyYears[0];

    if (preferredYear && preferredYear !== selectedHistoryYear) {
      setSelectedHistoryYear(preferredYear);
    }
  }, [activityHistory, historyYears, selectedDate, selectedHistoryYear]);

  useEffect(() => {
    if (!historyMonths.length) return;

    const dateMonth = selectedDate.slice(0, 7);
    const preferredMonth =
      historyMonths.includes(dateMonth)
        ? dateMonth
        : historyMonths[0];

    if (preferredMonth && preferredMonth !== selectedHistoryMonth) {
      setSelectedHistoryMonth(preferredMonth);
    }
  }, [historyMonths, selectedDate, selectedHistoryMonth]);

  const monthLabel = (monthKey: string) => {
    const [year, month] = monthKey.split('-').map(Number);
    return new Date(year, Math.max(0, month - 1), 1).toLocaleString(
      undefined,
      { month: 'long' }
    );
  };

  // ====================================================
  // NGROK-SAFE EMPLOYEE SCREENSHOT BLOBS
  // ====================================================

  useEffect(() => {
    let cancelled = false;

    setEmployeeScreenshotUrls((previous) => {
      Object.values(previous).forEach((url) => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      });
      return {};
    });

    if (!mergedScreenshots.length) {
      return () => {
        cancelled = true;
      };
    }

    const loadImages = async () => {
      const loaded: Record<string, string> = {};

      for (const screenshot of mergedScreenshots) {
        const source =
          screenshot.driveThumbnailLink ||
          screenshot.previewDataUrl ||
          '';

        if (!source || cancelled) continue;

        // Fresh in-browser captures are already data URLs.
        if (source.startsWith('data:') || source.startsWith('blob:')) {
          loaded[source] = source;
          continue;
        }

        try {
          const response = await fetch(source, {
            method: 'GET',
            cache: 'no-store',
            headers: {
              'ngrok-skip-browser-warning': 'true',
            },
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const blob = await response.blob();
          if (cancelled) return;

          loaded[source] = URL.createObjectURL(blob);
        } catch (error) {
          console.error(
            'Employee screenshot load failed:',
            screenshot.driveFileId,
            error
          );
        }
      }

      if (!cancelled) {
        setEmployeeScreenshotUrls(loaded);
      } else {
        Object.values(loaded).forEach((url) => {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        });
      }
    };

    void loadImages();

    return () => {
      cancelled = true;
    };
  }, [mergedScreenshots]);

  // ====================================================
  // START
  // ====================================================

  const startTracking =
    async () => {

      const stream =
        await initScreenStream();

      if (!stream) {
        return;
      }

      trackingRef.current =
        true;

      pausedRef.current =
        false;

      setIsTracking(
        true
      );

      setIsPaused(
        false
      );

      setSessionSeconds(
        0
      );

      setLastStatus(
        '✅ Tracking started'
      );

      await syncTrackerTime();

      scheduleRandomWindow(
        captureWindowRef.current,
        screenshotCountRef.current
      );
    };

  // ====================================================
  // PAUSE
  // ====================================================

  const pauseTracking =
    async () => {

      pausedRef.current =
        true;

      setIsPaused(
        true
      );

      clearCaptureTimers();

      setNextCaptureInSec(
        null
      );

      await syncTrackerTime();

      setLastStatus(
        'Tracking paused'
      );
    };

  // ====================================================
  // RESUME
  // ====================================================

  const resumeTracking =
    () => {

      pausedRef.current =
        false;

      setIsPaused(
        false
      );

      scheduleRandomWindow(
        captureWindowRef.current,
        screenshotCountRef.current
      );

      setLastStatus(
        'Tracking resumed'
      );
    };

  // ====================================================
  // STOP
  // ====================================================

  const stopTracking =
    async () => {

      await syncTrackerTime();

      trackingRef.current =
        false;

      pausedRef.current =
        false;

      setIsTracking(
        false
      );

      setIsPaused(
        false
      );

      clearCaptureTimers();

      setNextCaptureInSec(
        null
      );

      if (
        screenStreamRef.current
      ) {
        screenStreamRef.current
          .getTracks()
          .forEach(
            (
              track
            ) =>
              track.stop()
          );

        screenStreamRef.current =
          null;
      }

      if (
        screenVideoRef.current
      ) {
        screenVideoRef.current.srcObject =
          null;
      }

      setSessionSeconds(
        0
      );

      setLastStatus(
        `Tracking stopped. Today: ${formatSecondsToHoursMinutes(
          daySecondsRef.current
        )}`
      );

      await loadDateHistory();
    };

  // ====================================================
  // CLEANUP
  // ====================================================

  useEffect(() => {
    return () => {

      clearCaptureTimers();

      if (
        trackerTimerRef.current
      ) {
        clearInterval(
          trackerTimerRef.current
        );
      }

      if (
        screenStreamRef.current
      ) {
        screenStreamRef.current
          .getTracks()
          .forEach(
            (
              track
            ) =>
              track.stop()
          );
      }
    };
  }, []);

  // ====================================================
  // UI HELPERS
  // ====================================================

  const policyText =
    `${screenshotsPerWindow} screenshot${
      screenshotsPerWindow ===
      1
        ? ''
        : 's'
    } randomly / ${
      captureWindowSeconds <
      60
        ? `${captureWindowSeconds} sec`
        : `${Math.round(
            captureWindowSeconds /
              60
          )} min`
    }`;

  const today =
    getTodayDateKey();

  // ====================================================
  // RENDER
  // ====================================================

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">

      {/* HEADER */}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">

        <div className="flex items-center gap-3">

          <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
            <Monitor className="w-6 h-6" />
          </div>

          <div>

            <h1 className="text-2xl font-bold">
              Employee Dashboard
            </h1>

            <div className="text-sm text-slate-500">
              {currentUser.name}
              {' • '}
              {currentUser.email}
            </div>

          </div>

        </div>

        {onLogout && (
          <button
            type="button"
            onClick={
              onLogout
            }
            className="cursor-pointer px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold"
          >
            Logout
          </button>
        )}

      </div>

      {/* TRACKING CARD */}

      <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/20 p-6 space-y-5">

        <div>

          <label className="text-xs uppercase font-bold text-slate-500">
            Currently Working On
          </label>

          <input
            type="text"
            value={
              taskName
            }
            onChange={(
              event
            ) =>
              setTaskName(
                event.target
                  .value
              )
            }
            className="mt-2 w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          />

        </div>

        {/* POLICY */}

        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">

          <div className="flex flex-wrap items-center gap-2">

            <Camera className="w-4 h-4 text-indigo-600" />

            <span className="text-xs font-bold">
              Live Admin Capture Policy:
            </span>

            <span className="text-sm font-black text-indigo-600">
              {policyText}
            </span>

            <span className="px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
              AUTO SYNC
            </span>

          </div>

          <div className="mt-2 text-[11px] text-slate-500">

            {capturePresetId ===
            'custom'
              ? 'Custom policy selected by Admin.'
              : 'Preset policy selected by Admin.'}

            {centralPolicyUpdatedAt
              ? ` Last updated: ${new Date(
                  centralPolicyUpdatedAt
                ).toLocaleTimeString()}`
              : ''}

          </div>

        </div>

        {/* BUTTONS */}

        <div className="flex flex-col sm:flex-row gap-3">

          {!isTracking ? (
            <button
              type="button"
              onClick={
                startTracking
              }
              className="cursor-pointer flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
            >
              <Play className="w-4 h-4" />

              Start Tracking
            </button>
          ) : (
            <>
              {!isPaused ? (
                <button
                  type="button"
                  onClick={
                    pauseTracking
                  }
                  className="cursor-pointer flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-bold"
                >
                  <Pause className="w-4 h-4" />

                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  onClick={
                    resumeTracking
                  }
                  className="cursor-pointer flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold"
                >
                  <Play className="w-4 h-4" />

                  Resume
                </button>
              )}

              <button
                type="button"
                onClick={
                  stopTracking
                }
                className="cursor-pointer flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold"
              >
                <Square className="w-4 h-4" />

                Stop
              </button>
            </>
          )}

        </div>

        {/* CAPTURE COUNTDOWN */}

        {isTracking &&
          !isPaused &&
          nextCaptureInSec !==
            null && (
          <div className="text-xs text-center font-semibold text-slate-600 dark:text-slate-300">

            Next random screenshot in approximately{' '}

            <span className="font-mono text-indigo-600">
              {nextCaptureInSec}s
            </span>

          </div>
        )}

      </div>

      {/* SUMMARY */}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">

          <div className="text-[11px] uppercase font-bold text-slate-500">
            Current Task Duration
          </div>

          <div className="text-2xl font-black mt-2">
            {formatSecondsToHoursMinutes(
              sessionSeconds
            )}
          </div>

        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">

          <div className="text-[11px] uppercase font-bold text-slate-500">
            Today Total Tracked
          </div>

          <div className="text-2xl font-black mt-2 text-emerald-600">
            {formatSecondsToHoursMinutes(
              dayTotalSeconds
            )}
          </div>

        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">

          <div className="text-[11px] uppercase font-bold text-slate-500">
            Selected Date Screenshots
          </div>

          <div className="text-2xl font-black mt-2 text-indigo-600">
            {selectedDateScreenshotCount}
          </div>

        </div>

      </div>

      {/* STATUS */}

      <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 p-4 flex items-start gap-2">

        {lastStatus.startsWith(
          '✅'
        ) ? (
          <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
        ) : (
          <AlertCircle className="w-4 h-4 mt-0.5 text-indigo-600 shrink-0" />
        )}

        <div className="text-xs">

          {lastStatus}

          {lastCapturedTime && (
            <div className="text-slate-500 mt-1">
              Last screenshot:{' '}
              {lastCapturedTime}
            </div>
          )}

        </div>

      </div>

      {/* DATE HISTORY */}

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">

        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">

          <div>

            <h2 className="font-bold flex items-center gap-2">

              <Calendar className="w-5 h-5 text-indigo-600" />

              My Date-wise Work History

            </h2>

            <p className="text-xs text-slate-500 mt-1">
              Select a date to view actual tracked time and central screenshots.
            </p>

          </div>

          <div className="flex items-center gap-2">

            <input
              type="date"
              value={
                selectedDate
              }
              max={
                today
              }
              onChange={(
                event
              ) =>
                setSelectedDate(
                  event.target
                    .value ||
                    today
                )
              }
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />

            <button
              type="button"
              onClick={
                loadDateHistory
              }
              className="cursor-pointer p-2 rounded-lg border border-slate-300 dark:border-slate-700"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

          </div>

        </div>

        <div className="p-5 space-y-5">

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

            <div className="rounded-xl p-4 bg-slate-50 dark:bg-slate-800">

              <div className="text-[11px] uppercase font-bold text-slate-500">
                Selected Date
              </div>

              <div className="font-bold mt-1">
                {selectedDate}
              </div>

            </div>

            <div className="rounded-xl p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">

              <div className="text-[11px] uppercase font-bold text-slate-500">
                Actual Tracked Time
              </div>

              <div className="text-xl font-black mt-1 text-emerald-600">
                {loadingHistory
                  ? 'Loading...'
                  : formatSecondsToHoursMinutes(
                      selectedDateSeconds
                    )}
              </div>

            </div>

            <div className="rounded-xl p-4 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800">

              <div className="text-[11px] uppercase font-bold text-slate-500">
                Screenshots
              </div>

              <div className="text-xl font-black mt-1 text-indigo-600">
                {loadingHistory
                  ? '...'
                  : selectedDateScreenshotCount}
              </div>

            </div>

          </div>

          {/* YEAR > MONTH > DATE HISTORY */}

          {activityHistory.length > 0 && (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">

              <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                <div className="text-[11px] uppercase font-bold text-slate-500 mb-2">
                  Year
                </div>

                <div className="flex flex-wrap gap-2">
                  {historyYears.map((year) => (
                    <button
                      key={year}
                      type="button"
                      onClick={() => {
                        setSelectedHistoryYear(year);

                        const firstMonth = activityHistory
                          .filter((record) => record.dateKey.startsWith(`${year}-`))
                          .map((record) => record.dateKey.slice(0, 7))
                          .sort((a, b) => b.localeCompare(a))[0];

                        if (firstMonth) {
                          setSelectedHistoryMonth(firstMonth);
                        }
                      }}
                      className={`px-4 py-2 rounded-lg text-xs font-bold border transition ${
                        selectedHistoryYear === year
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 hover:border-indigo-400'
                      }`}
                    >
                      {year}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                <div className="text-[11px] uppercase font-bold text-slate-500 mb-2">
                  Month
                </div>

                <div className="flex flex-wrap gap-2">
                  {historyMonths.map((month) => (
                    <button
                      key={month}
                      type="button"
                      onClick={() => setSelectedHistoryMonth(month)}
                      className={`px-4 py-2 rounded-lg text-xs font-bold border transition ${
                        selectedHistoryMonth === month
                          ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-400'
                          : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 hover:border-indigo-400'
                      }`}
                    >
                      {monthLabel(month)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4">
                <div className="text-[11px] uppercase font-bold text-slate-500 mb-2">
                  Dates
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {filteredHistoryDates.map((record) => (
                    <button
                      key={record.dateKey}
                      type="button"
                      onClick={() => setSelectedDate(record.dateKey)}
                      className={`text-left rounded-xl border p-3 transition ${
                        selectedDate === record.dateKey
                          ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-400'
                          : 'border-slate-200 dark:border-slate-800 hover:border-indigo-400'
                      }`}
                    >
                      <div className="font-bold text-sm">
                        {new Date(`${record.dateKey}T00:00:00`).toLocaleDateString(
                          undefined,
                          { day: '2-digit', month: 'short', year: 'numeric' }
                        )}
                      </div>

                      <div className="text-[11px] text-slate-500 mt-1">
                        {formatSecondsToHoursMinutes(record.totalSeconds)}
                        {' • '}
                        {record.screenshotCount} screenshot{record.screenshotCount === 1 ? '' : 's'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

            </div>
          )}

          {/* SCREENSHOTS */}

          <div>

            <div className="flex items-center justify-between gap-3 mb-4">

              <div>

                <h3 className="font-bold flex items-center gap-2">

                  <Camera className="w-4 h-4 text-indigo-600" />

                  Screenshot History

                </h3>

                <div className="text-xs text-slate-500 mt-1">
                  {selectedDate}
                </div>

              </div>

              <div className="text-xs font-bold text-indigo-600">
                {
                  mergedScreenshots.length
                }{' '}
                captures
              </div>

            </div>

            {mergedScreenshots.length ===
            0 ? (
              <div className="py-14 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-xl">

                <Camera className="w-10 h-10 mx-auto text-slate-400 mb-2" />

                <div className="text-sm font-semibold">
                  No screenshots found
                </div>

                <div className="text-xs text-slate-500 mt-1">
                  No central screenshots are available for {selectedDate}.
                </div>

              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

                {mergedScreenshots.map(
                  (
                    screenshot
                  ) => (
                    <button
                      key={
                        screenshot.id
                      }
                      type="button"
                      onClick={() =>
                        setPreviewModal(
                          screenshot
                        )
                      }
                      className="cursor-pointer text-left rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 hover:border-indigo-400 transition"
                    >

                      {(() => {
                        const source =
                          screenshot.driveThumbnailLink ||
                          screenshot.previewDataUrl ||
                          '';

                        const displayUrl =
                          employeeScreenshotUrls[source] ||
                          (source.startsWith('data:') || source.startsWith('blob:')
                            ? source
                            : '');

                        return displayUrl ? (
                          <img
                            src={displayUrl}
                            alt="Screenshot"
                            className="w-full aspect-video object-cover bg-slate-950"
                          />
                        ) : (
                          <div className="w-full aspect-video bg-slate-950 flex items-center justify-center text-xs text-slate-400">
                            Loading screenshot...
                          </div>
                        );
                      })()}

                      <div className="p-3">

                        <div className="text-xs font-bold">
                          {
                            screenshot.taskName
                          }
                        </div>

                        <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">

                          <Clock className="w-3 h-3" />

                          {screenshot.timeFormatted ||
                            'Saved capture'}

                        </div>

                      </div>

                    </button>
                  )
                )}

              </div>
            )}

          </div>

        </div>

      </div>

      {/* PREVIEW */}

      {previewModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() =>
            setPreviewModal(
              null
            )
          }
        >

          <div
            className="w-full max-w-6xl"
            onClick={(
              event
            ) =>
              event.stopPropagation()
            }
          >

            <div className="flex justify-end mb-2">

              <button
                type="button"
                onClick={() =>
                  setPreviewModal(
                    null
                  )
                }
                className="cursor-pointer p-2 text-white"
              >
                <X className="w-6 h-6" />
              </button>

            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl overflow-hidden">

              {(() => {
                const source =
                  previewModal.driveThumbnailLink ||
                  previewModal.previewDataUrl ||
                  '';

                const displayUrl =
                  employeeScreenshotUrls[source] ||
                  (source.startsWith('data:') || source.startsWith('blob:')
                    ? source
                    : '');

                return displayUrl ? (
                  <img
                    src={displayUrl}
                    alt="Screenshot preview"
                    className="w-full max-h-[80vh] object-contain bg-slate-950"
                  />
                ) : (
                  <div className="min-h-[320px] flex items-center justify-center bg-slate-950 text-slate-400">
                    Loading screenshot...
                  </div>
                );
              })()}

              <div className="p-4">

                <div className="font-bold">
                  {
                    previewModal.taskName
                  }
                </div>

                <div className="text-xs text-slate-500 mt-1">
                  {
                    previewModal.timeFormatted
                  }
                </div>

              </div>

            </div>

          </div>

        </div>
      )}

      {/* HIDDEN VIDEO */}

      <video
        ref={
          screenVideoRef
        }
        autoPlay
        muted
        playsInline
        className="fixed -top-[9999px] -left-[9999px] w-[320px] h-[180px] opacity-[0.001] pointer-events-none"
      />

    </div>
  );
};

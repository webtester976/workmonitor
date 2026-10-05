import fs from 'node:fs/promises';
import path from 'node:path';

// ======================================================
// CONFIG
// ======================================================

const WORKER_URL =
  (process.env.WORKER_URL ||
    'https://codesdot-workmonitor.work-nest.workers.dev').replace(/\/$/, '');

const SCREENSHOT_ROOT =
  'C:\\screenshots';

const SYNC_INTERVAL_MS =
  60 * 60 * 1000;

// Cloud screenshot sync is allowed only during the employee
// tracking window in India Standard Time.
const INDIA_TIME_ZONE = 'Asia/Kolkata';
const TRACKING_START_MINUTES = 8 * 60 + 30;
const TRACKING_END_MINUTES = 20 * 60 + 30;

const getIndiaMinutes = () => {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());

  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return hour * 60 + minute;
};

const isCloudSyncWindowOpen = () => {
  const minutes = getIndiaMinutes();
  return minutes >= TRACKING_START_MINUTES && minutes <= TRACKING_END_MINUTES;
};


// ======================================================
// HELPERS
// ======================================================

const sleep = (ms) =>
  new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );


const safeFolderName = (
  value,
  fallback = 'unknown'
) => {

  const cleaned =
    String(
      value || ''
    )
      .trim()
      .replace(
        /[<>:"/\\|?*\x00-\x1F]/g,
        '_'
      )
      .replace(
        /\.+$/g,
        ''
      );

  return (
    cleaned ||
    fallback
  );
};


const ensureDirectory =
  async (
    directoryPath
  ) => {

    await fs.mkdir(
      directoryPath,
      {
        recursive: true,
      }
    );
  };


const fileExists =
  async (
    filePath
  ) => {

    try {

      await fs.access(
        filePath
      );

      return true;

    } catch {

      return false;
    }
  };


const apiGet =
  async (
    endpoint
  ) => {

    const response =
      await fetch(
        `${WORKER_URL}${endpoint}`,
        {
          method: 'GET',

          headers: {
            Accept:
              'application/json',
          },

          cache:
            'no-store',
        }
      );


    const raw =
      await response.text();


    let data;


    try {

      data =
        raw
          ? JSON.parse(
              raw
            )
          : {};

    } catch {

      throw new Error(
        `Invalid JSON from ${endpoint}`
      );
    }


    if (
      !response.ok ||
      !data?.success
    ) {

      throw new Error(
        data?.error ||
        `Request failed: ${response.status}`
      );
    }


    return data;
  };


// ======================================================
// DOWNLOAD SCREENSHOT
// ======================================================

const downloadScreenshot =
  async ({
    screenshot,
    destinationPath,
  }) => {

    if (
      await fileExists(
        destinationPath
      )
    ) {

      return {
        downloaded: false,
        skipped: true,
      };
    }


    const response =
      await fetch(
        screenshot.localUrl,
        {
          method: 'GET',

          cache:
            'no-store',
        }
      );


    if (
      !response.ok
    ) {

      throw new Error(
        `Screenshot download failed (${response.status})`
      );
    }


    const arrayBuffer =
      await response
        .arrayBuffer();


    const buffer =
      Buffer.from(
        arrayBuffer
      );


    await fs.writeFile(
      destinationPath,
      buffer
    );


    return {
      downloaded: true,
      skipped: false,
    };
  };


// ======================================================
// CREATE EMPLOYEE ROOT FOLDER
// ======================================================

const getEmployeeRoot =
  (
    employee
  ) => {

    const emailFolder =
      safeFolderName(
        employee.email,
        employee.id
      );


    const nameFolder =
      safeFolderName(
        employee.name,
        'Employee'
      );


    return path.join(
      SCREENSHOT_ROOT,
      emailFolder,
      nameFolder
    );
  };


// ======================================================
// SYNC ONE EMPLOYEE
// ======================================================

const syncEmployee =
  async (
    employee
  ) => {

    const employeeRoot =
      getEmployeeRoot(
        employee
      );


    // --------------------------------------------------
    // Create folder even when user has no screenshots
    // --------------------------------------------------

    await ensureDirectory(
      employeeRoot
    );


    console.log(
      `👤 Employee: ${employee.name}`
    );


    console.log(
      `📁 Folder: ${employeeRoot}`
    );


    // --------------------------------------------------
    // Get activity history
    // --------------------------------------------------

    const historyData =
      await apiGet(
        `/api/activity-history/${encodeURIComponent(
          employee.id
        )}`
      );


    const records =
      Array.isArray(
        historyData.records
      )
        ? historyData.records
        : [];


    if (
      records.length === 0
    ) {

      console.log(
        '   No activity yet.'
      );

      return;
    }


    // --------------------------------------------------
    // Loop activity dates
    // --------------------------------------------------

    for (
      const record of
        records
    ) {

      const dateKey =
        record.dateKey;


      if (
        !dateKey
      ) {

        continue;
      }


      const monthKey =
        dateKey.slice(
          0,
          7
        );


      const dateFolder =
        path.join(
          employeeRoot,
          safeFolderName(
            monthKey
          ),
          safeFolderName(
            dateKey
          )
        );


      await ensureDirectory(
        dateFolder
      );


      // -----------------------------------------------
      // Fetch screenshot list for selected date
      // -----------------------------------------------

      const screenshotData =
        await apiGet(
          `/api/screenshots/${encodeURIComponent(
            employee.id
          )}/${encodeURIComponent(
            dateKey
          )}`
        );


      const screenshots =
        Array.isArray(
          screenshotData.items
        )
          ? screenshotData.items
          : [];


      if (
        screenshots.length ===
        0
      ) {

        continue;
      }


      // -----------------------------------------------
      // Download screenshots
      // -----------------------------------------------

      for (
        const screenshot of
          screenshots
      ) {

        if (
          !screenshot?.fileName ||
          !screenshot?.localUrl
        ) {

          continue;
        }


        const fileName =
          safeFolderName(
            screenshot.fileName,
            `screenshot-${Date.now()}.webp`
          );


        const destinationPath =
          path.join(
            dateFolder,
            fileName
          );


        try {

          const result =
            await downloadScreenshot({
              screenshot,
              destinationPath,
            });


          if (
            result.downloaded
          ) {

            console.log(
              `   ✅ Saved: ${fileName}`
            );

          } else {

            console.log(
              `   ⏭ Already exists: ${fileName}`
            );
          }

        } catch (error) {

          console.error(
            `   ❌ Failed: ${fileName}`,
            error.message
          );
        }
      }
    }
  };


// ======================================================
// SYNC ALL EMPLOYEES
// ======================================================

const syncAll =
  async () => {

    console.log('');
    console.log(
      '=========================================='
    );

    console.log(
      `🔄 WorkMonitor local sync`
    );

    console.log(
      `🕒 ${new Date().toLocaleString()}`
    );

    console.log(
      '=========================================='
    );


    // --------------------------------------------------
    // Ensure main screenshots folder
    // --------------------------------------------------

    await ensureDirectory(
      SCREENSHOT_ROOT
    );


    // --------------------------------------------------
    // Fetch employees
    // --------------------------------------------------

    const employeesData =
      await apiGet(
        '/api/employees'
      );


    const employees =
      Array.isArray(
        employeesData.employees
      )
        ? employeesData.employees
        : [];


    console.log(
      `👥 Employees found: ${employees.length}`
    );


    for (
      const employee of
        employees
    ) {

      try {

        await syncEmployee(
          employee
        );

      } catch (error) {

        console.error(
          `❌ Employee sync failed: ${employee.name}`,
          error.message
        );
      }
    }


    console.log(
      '✅ Sync completed.'
    );
  };


// ======================================================
// MAIN LOOP
// ======================================================

const start =
  async () => {

    console.log('');
    console.log(
      '🚀 WorkMonitor Local Screenshot Sync'
    );

    console.log(
      `☁️ Cloud: ${WORKER_URL}`
    );

    console.log(
      `💾 Local folder: ${SCREENSHOT_ROOT}`
    );

    console.log(
      `⏱ Sync every ${SYNC_INTERVAL_MS / 1000} seconds`
    );


    while (
      true
    ) {

      try {

        if (!isCloudSyncWindowOpen()) {
          console.log('⏸ Cloud sync paused: outside 08:30 AM–08:30 PM IST.');
        } else {
          await syncAll();
        }

      } catch (error) {

        console.error(
          '❌ Sync error:',
          error.message
        );
      }


      console.log(
        `⏳ Next sync in ${SYNC_INTERVAL_MS / 1000} seconds...`
      );


      await sleep(
        SYNC_INTERVAL_MS
      );
    }
  };


// ======================================================
// START
// ======================================================

start().catch(
  (
    error
  ) => {

    console.error(
      '❌ Fatal sync error:',
      error
    );

    process.exit(
      1
    );
  }
);
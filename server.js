import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Railway/Render/etc. terminate HTTPS before forwarding to Express.
app.set('trust proxy', 1);

// ======================================================
// CORS
// ======================================================

const extraAllowedOrigins = String(
  process.env.ALLOWED_ORIGINS || ''
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const allowedOrigins = [
  'https://workmonitor-desktop.pages.dev',
  'http://localhost:3000',
  'http://localhost:3001',
  'https://localhost:3000',
  'https://localhost:3001',
  'https://192.168.29.228:3000',
  'https://192.168.29.228:3001',
  ...extraAllowedOrigins,
];

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    if (
      /^https:\/\/[a-zA-Z0-9-]+\.workmonitor-desktop\.pages\.dev$/.test(
        origin
      )
    ) {
      return callback(null, true);
    }

    if (
      /^https:\/\/[a-zA-Z0-9.-]+\.up\.railway\.app$/.test(
        origin
      )
    ) {
      return callback(null, true);
    }

    console.warn(
      '🚫 Blocked CORS origin:',
      origin
    );

    return callback(
      new Error(
        `CORS origin not allowed: ${origin}`
      )
    );
  },

  methods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ],

  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'ngrok-skip-browser-warning',
  ],

  exposedHeaders: [
    'Content-Type',
  ],

  credentials: false,

  optionsSuccessStatus: 204,
};

app.use(
  cors(corsOptions)
);

app.use(
  express.json({
    limit: '20mb',
  })
);

// ======================================================
// STORAGE
// ======================================================

const UPLOAD_DIR =
  process.env.SCREENSHOT_DIR ||
  path.join(
    __dirname,
    'data'
  );

const EMPLOYEE_DB =
  path.join(
    UPLOAD_DIR,
    'employees.json'
  );

const PENDING_DB =
  path.join(
    UPLOAD_DIR,
    'pending-signups.json'
  );

const TRACKER_DB =
  path.join(
    UPLOAD_DIR,
    'tracker-time.json'
  );

const CAPTURE_SETTINGS_DB =
  path.join(
    UPLOAD_DIR,
    'capture-settings.json'
  );

// ======================================================
// DEFAULT CAPTURE SETTINGS
// ======================================================

const DEFAULT_CAPTURE_SETTINGS = {
  captureMode:
    'random_count_window',

  captureWindowSeconds:
    600,

  screenshotsPerWindow:
    5,

  presetId:
    '10m-5',

  lockIntervalForEmployees:
    true,

  captureIntervalSeconds:
    600,

  autoCaptureIntervalMinutes:
    10,

  allowedIntervals: [
    10,
    60,
    120,
    300,
    600,
    900,
  ],

  updatedAt:
    new Date().toISOString(),
};

// ======================================================
// ROOT STORAGE
// ======================================================

if (
  !fs.existsSync(
    UPLOAD_DIR
  )
) {
  fs.mkdirSync(
    UPLOAD_DIR,
    {
      recursive: true,
    }
  );
}

// ======================================================
// JSON HELPERS
// ======================================================

function ensureArrayFile(
  filePath
) {
  if (
    !fs.existsSync(
      filePath
    )
  ) {
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        [],
        null,
        2
      )
    );
  }
}

function ensureObjectFile(
  filePath,
  defaultValue = {}
) {
  if (
    !fs.existsSync(
      filePath
    )
  ) {
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        defaultValue,
        null,
        2
      )
    );
  }
}

ensureArrayFile(
  EMPLOYEE_DB
);

ensureArrayFile(
  PENDING_DB
);

ensureObjectFile(
  TRACKER_DB,
  {}
);

ensureObjectFile(
  CAPTURE_SETTINGS_DB,
  DEFAULT_CAPTURE_SETTINGS
);

function readArray(
  filePath,
  label
) {
  try {
    ensureArrayFile(
      filePath
    );

    const raw =
      fs.readFileSync(
        filePath,
        'utf8'
      );

    if (
      !raw.trim()
    ) {
      return [];
    }

    const parsed =
      JSON.parse(
        raw
      );

    return Array.isArray(
      parsed
    )
      ? parsed
      : [];
  } catch (error) {
    console.error(
      `Read ${label} failed:`,
      error
    );

    return [];
  }
}

function readObject(
  filePath,
  label,
  fallback = {}
) {
  try {
    ensureObjectFile(
      filePath,
      fallback
    );

    const raw =
      fs.readFileSync(
        filePath,
        'utf8'
      );

    if (
      !raw.trim()
    ) {
      return fallback;
    }

    const parsed =
      JSON.parse(
        raw
      );

    if (
      parsed &&
      typeof parsed ===
        'object' &&
      !Array.isArray(
        parsed
      )
    ) {
      return parsed;
    }

    return fallback;
  } catch (error) {
    console.error(
      `Read ${label} failed:`,
      error
    );

    return fallback;
  }
}

function writeJson(
  filePath,
  data
) {
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      data,
      null,
      2
    )
  );
}

// ======================================================
// BASIC HELPERS
// ======================================================

function safeSegment(
  value,
  fallback = 'unknown'
) {
  return (
    String(
      value ||
        fallback
    )
      .trim()
      .replace(
        /[<>:"/\\|?*]/g,
        '_'
      )
      .replace(
        /\.+$/g,
        ''
      )
      .slice(
        0,
        150
      ) ||
    fallback
  );
}

function normalizeEmail(
  email
) {
  return String(
    email ||
      ''
  )
    .trim()
    .toLowerCase();
}

function dateKeyNow() {
  const date =
    new Date();

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() +
        1
    ).padStart(
      2,
      '0'
    );

  const day =
    String(
      date.getDate()
    ).padStart(
      2,
      '0'
    );

  return (
    `${year}-` +
    `${month}-` +
    `${day}`
  );
}

function monthKeyNow() {
  return dateKeyNow()
    .slice(
      0,
      7
    );
}

function isValidDateKey(
  value
) {
  return /^\d{4}-\d{2}-\d{2}$/.test(
    String(
      value ||
        ''
    )
  );
}

function getMonthFolderName(
  dateKey
) {
  const match =
    String(
      dateKey ||
        ''
    ).match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  let date;

  if (
    match
  ) {
    date =
      new Date(
        Number(
          match[1]
        ),
        Number(
          match[2]
        ) - 1,
        Number(
          match[3]
        )
      );
  } else {
    date =
      new Date();
  }

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  return (
    `${monthNames[
      date.getMonth()
    ]} ` +
    `${date.getFullYear()}`
  );
}

function getEmployeeFullName(
  employee
) {
  const fromParts =
    `${employee?.firstName || ''} ${employee?.lastName || ''}`
      .trim();

  return (
    fromParts ||
    String(
      employee?.name ||
        ''
    ).trim() ||
    'Employee'
  );
}

// ======================================================
// DATABASE HELPERS
// ======================================================

function readEmployees() {
  return readArray(
    EMPLOYEE_DB,
    'employees'
  );
}

function saveEmployees(
  data
) {
  writeJson(
    EMPLOYEE_DB,
    data
  );
}

function readPending() {
  return readArray(
    PENDING_DB,
    'pending signups'
  );
}

function savePending(
  data
) {
  writeJson(
    PENDING_DB,
    data
  );
}

function readTracker() {
  return readObject(
    TRACKER_DB,
    'tracker',
    {}
  );
}

function saveTracker(
  data
) {
  writeJson(
    TRACKER_DB,
    data
  );
}

function readCaptureSettings() {
  const saved =
    readObject(
      CAPTURE_SETTINGS_DB,
      'capture settings',
      DEFAULT_CAPTURE_SETTINGS
    );

  return {
    ...DEFAULT_CAPTURE_SETTINGS,
    ...saved,
  };
}

function saveCaptureSettings(
  data
) {
  writeJson(
    CAPTURE_SETTINGS_DB,
    data
  );
}

function findEmployeeById(
  employeeId
) {
  return readEmployees()
    .find(
      (employee) =>
        employee.id ===
        employeeId
    );
}

// ======================================================
// SCREENSHOT FOLDER STRUCTURE
// ======================================================

function employeeEmailFolderPath(
  employee
) {
  const email =
    normalizeEmail(
      employee?.email
    );

  return path.join(
    UPLOAD_DIR,
    safeSegment(
      email,
      employee?.id ||
        'unknown-employee'
    )
  );
}

function employeeNameFolderPath(
  employee
) {
  return path.join(
    employeeEmailFolderPath(
      employee
    ),
    safeSegment(
      getEmployeeFullName(
        employee
      ),
      'Employee'
    )
  );
}

function employeeMonthFolderPath(
  employee,
  dateKey
) {
  return path.join(
    employeeNameFolderPath(
      employee
    ),
    safeSegment(
      getMonthFolderName(
        dateKey
      )
    )
  );
}

function employeeDateFolder(
  employee,
  dateKey
) {
  return path.join(
    employeeMonthFolderPath(
      employee,
      dateKey
    ),
    safeSegment(
      dateKey
    )
  );
}

// ======================================================
// FILE HELPERS
// ======================================================

function getImageFiles(
  folderPath
) {
  if (
    !fs.existsSync(
      folderPath
    )
  ) {
    return [];
  }

  return fs
    .readdirSync(
      folderPath
    )
    .filter(
      (file) =>
        /\.(webp|png|jpg|jpeg)$/i.test(
          file
        )
    )
    .sort()
    .reverse();
}

function getScreenshotCount(
  employee,
  dateKey
) {
  return getImageFiles(
    employeeDateFolder(
      employee,
      dateKey
    )
  ).length;
}

// ======================================================
// FIND ALL DATES FOR EMPLOYEE
// ======================================================

function getEmployeeDateFolders(
  employee
) {
  const employeeRoot =
    employeeNameFolderPath(
      employee
    );

  if (
    !fs.existsSync(
      employeeRoot
    )
  ) {
    return [];
  }

  const dates =
    new Set();

  const monthEntries =
    fs.readdirSync(
      employeeRoot,
      {
        withFileTypes:
          true,
      }
    );

  for (
    const monthEntry of
    monthEntries
  ) {
    if (
      !monthEntry.isDirectory()
    ) {
      continue;
    }

    const monthPath =
      path.join(
        employeeRoot,
        monthEntry.name
      );

    const dateEntries =
      fs.readdirSync(
        monthPath,
        {
          withFileTypes:
            true,
        }
      );

    for (
      const dateEntry of
      dateEntries
    ) {
      if (
        dateEntry.isDirectory() &&
        isValidDateKey(
          dateEntry.name
        )
      ) {
        dates.add(
          dateEntry.name
        );
      }
    }
  }

  return Array.from(
    dates
  )
    .sort()
    .reverse();
}

// ======================================================
// PUBLIC SCREENSHOT URL
// ======================================================

function buildScreenshotUrl(
  req,
  employee,
  dateKey,
  fileName
) {
  const host =
    req.get(
      'host'
    );

  const protocol =
    req.protocol;

  const emailFolder =
    safeSegment(
      normalizeEmail(
        employee.email
      )
    );

  const nameFolder =
    safeSegment(
      getEmployeeFullName(
        employee
      )
    );

  const monthFolder =
    safeSegment(
      getMonthFolderName(
        dateKey
      )
    );

  return (
    `${protocol}://${host}/screenshots/` +
    `${encodeURIComponent(
      emailFolder
    )}/` +
    `${encodeURIComponent(
      nameFolder
    )}/` +
    `${encodeURIComponent(
      monthFolder
    )}/` +
    `${encodeURIComponent(
      dateKey
    )}/` +
    `${encodeURIComponent(
      fileName
    )}`
  );
}

// ======================================================
// EMPLOYEE META / FOLDER
// ======================================================

function ensureEmployeeFolder(
  employee,
  customDate =
    dateKeyNow()
) {
  const selectedDate =
    isValidDateKey(
      customDate
    )
      ? customDate
      : dateKeyNow();

  const folder =
    employeeDateFolder(
      employee,
      selectedDate
    );

  fs.mkdirSync(
    folder,
    {
      recursive: true,
    }
  );

  const employeeRoot =
    employeeNameFolderPath(
      employee
    );

  const metaPath =
    path.join(
      employeeRoot,
      'employee.json'
    );

  writeJson(
    metaPath,
    {
      employeeId:
        employee.id,

      firstName:
        employee.firstName ||
        '',

      lastName:
        employee.lastName ||
        '',

      employeeName:
        getEmployeeFullName(
          employee
        ),

      email:
        normalizeEmail(
          employee.email
        ),

      approved:
        employee.approved !==
        false,

      createdAt:
        employee.createdAt,

      updatedAt:
        new Date().toISOString(),
    }
  );

  return folder;
}

function publicPending(
  signup
) {
  return {
    id:
      signup.id,

    firstName:
      signup.firstName ||
      '',

    lastName:
      signup.lastName ||
      '',

    name:
      signup.name,

    email:
      signup.email,

    requestedAt:
      signup.requestedAt,

    timestamp:
      signup.requestedAt,

    status:
      'pending',
  };
}

// ======================================================
// HEALTH
// ======================================================

app.get(
  '/api/health',
  (
    req,
    res
  ) => {
    res.json({
      success:
        true,

      ok:
        true,

      storage:
        UPLOAD_DIR,

      screenshotStorageMode:
        'email-name-month-date',

      screenshotPathExample:
        path.join(
          UPLOAD_DIR,
          'email@example.com',
          'First Last',
          'September 2026',
          '2026-09-14',
          'image.webp'
        ),

      employeeDatabase:
        EMPLOYEE_DB,

      pendingSignupDatabase:
        PENDING_DB,

      trackerDatabase:
        TRACKER_DB,

      captureSettingsDatabase:
        CAPTURE_SETTINGS_DB,

      serverTime:
        new Date().toISOString(),
    });
  }
);

// ======================================================
// EMPLOYEES
// ======================================================

app.get(
  '/api/employees',
  (
    req,
    res
  ) => {
    try {
      res.json({
        success:
          true,

        employees:
          readEmployees(),
      });
    } catch (
      error
    ) {
      res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// REQUEST SIGNUP
// ======================================================

app.post(
  '/api/request-signup',
  (
    req,
    res
  ) => {
    try {
      const {
        id,
        firstName,
        lastName,
        name,
        email,
        password,
      } =
        req.body ||
        {};

      const cleanFirstName =
        String(
          firstName ||
            ''
        ).trim();

      const cleanLastName =
        String(
          lastName ||
            ''
        ).trim();

      const suppliedName =
        String(
          name ||
            ''
        ).trim();

      const fullName =
        cleanFirstName ||
        cleanLastName
          ? `${cleanFirstName} ${cleanLastName}`
              .trim()
          : suppliedName;

      if (
        !fullName ||
        !email ||
        !password
      ) {
        return res
          .status(
            400
          )
          .json({
            success:
              false,

            error:
              'First name, last name, email and password are required.',
          });
      }

      const normalizedEmail =
        normalizeEmail(
          email
        );

      const employees =
        readEmployees();

      const pending =
        readPending();

      const activeExists =
        employees.some(
          (employee) =>
            normalizeEmail(
              employee.email
            ) ===
            normalizedEmail
        );

      if (
        activeExists
      ) {
        return res
          .status(
            409
          )
          .json({
            success:
              false,

            error:
              'An active employee account already exists with this email.',
          });
      }

      const pendingExists =
        pending.some(
          (signup) =>
            normalizeEmail(
              signup.email
            ) ===
            normalizedEmail
        );

      if (
        pendingExists
      ) {
        return res
          .status(
            409
          )
          .json({
            success:
              false,

            pending:
              true,

            error:
              'Your signup request is already waiting for administrator approval.',
          });
      }

      const signup = {
        id:
          id ||
          `pending-${Date.now()}`,

        firstName:
          cleanFirstName,

        lastName:
          cleanLastName,

        name:
          fullName,

        email:
          normalizedEmail,

        password,

        requestedAt:
          new Date().toISOString(),

        status:
          'pending',
      };

      pending.push(
        signup
      );

      savePending(
        pending
      );

      console.log(
        '🕒 Pending signup:',
        signup.name,
        signup.email
      );

      return res
        .status(
          202
        )
        .json({
          success:
            true,

          pending:
            true,

          signup:
            publicPending(
              signup
            ),

          message:
            'Signup request sent. Please wait for administrator approval.',
        });
    } catch (
      error
    ) {
      console.error(
        'Signup error:',
        error
      );

      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// PENDING EMPLOYEES
// ======================================================

app.get(
  '/api/pending-employees',
  (
    req,
    res
  ) => {
    try {
      res.json({
        success:
          true,

        pending:
          readPending().map(
            publicPending
          ),
      });
    } catch (
      error
    ) {
      res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// APPROVE EMPLOYEE
// ======================================================

app.post(
  '/api/approve-employee/:id',
  (
    req,
    res
  ) => {
    try {
      const pending =
        readPending();

      const index =
        pending.findIndex(
          (
            signup
          ) =>
            signup.id ===
            req.params.id
        );

      if (
        index ===
        -1
      ) {
        return res
          .status(
            404
          )
          .json({
            success:
              false,

            error:
              'Pending signup not found.',
          });
      }

      const signup =
        pending[
          index
        ];

      const employees =
        readEmployees();

      const normalizedEmail =
        normalizeEmail(
          signup.email
        );

      const duplicate =
        employees.some(
          (
            employee
          ) =>
            normalizeEmail(
              employee.email
            ) ===
            normalizedEmail
        );

      if (
        duplicate
      ) {
        pending.splice(
          index,
          1
        );

        savePending(
          pending
        );

        return res
          .status(
            409
          )
          .json({
            success:
              false,

            error:
              'Employee is already active.',
          });
      }

      const employee = {
        id:
          `emp-${Date.now()}-${Math.random()
            .toString(
              36
            )
            .slice(
              2,
              8
            )}`,

        firstName:
          signup.firstName ||
          '',

        lastName:
          signup.lastName ||
          '',

        name:
          signup.name,

        email:
          normalizedEmail,

        password:
          signup.password,

        role:
          'employee',

        approved:
          true,

        createdAt:
          new Date().toISOString(),

        approvedAt:
          new Date().toISOString(),
      };

      employees.push(
        employee
      );

      saveEmployees(
        employees
      );

      pending.splice(
        index,
        1
      );

      savePending(
        pending
      );

      const folder =
        ensureEmployeeFolder(
          employee
        );

      console.log(
        '✅ Employee approved:',
        employee.name,
        employee.email
      );

      console.log(
        '📁 Workspace created:',
        folder
      );

      return res.json({
        success:
          true,

        employee,

        folderPath:
          path.relative(
            UPLOAD_DIR,
            folder
          ),
      });
    } catch (
      error
    ) {
      console.error(
        'Approve employee error:',
        error
      );

      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// REJECT EMPLOYEE
// ======================================================

app.delete(
  '/api/reject-employee/:id',
  (
    req,
    res
  ) => {
    try {
      const pending =
        readPending();

      const index =
        pending.findIndex(
          (
            signup
          ) =>
            signup.id ===
            req.params.id
        );

      if (
        index ===
        -1
      ) {
        return res
          .status(
            404
          )
          .json({
            success:
              false,

            error:
              'Pending signup not found.',
          });
      }

      pending.splice(
        index,
        1
      );

      savePending(
        pending
      );

      return res.json({
        success:
          true,
      });
    } catch (
      error
    ) {
      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// OLD DIRECT REGISTRATION DISABLED
// ======================================================

app.post(
  '/api/register-employee',
  (
    req,
    res
  ) => {
    return res
      .status(
        410
      )
      .json({
        success:
          false,

        error:
          'Direct registration is disabled. Use /api/request-signup.',
      });
  }
);

// ======================================================
// EMPLOYEE LOGIN
// ======================================================

app.post(
  '/api/login-employee',
  (
    req,
    res
  ) => {
    try {
      const {
        email,
        password,
      } =
        req.body ||
        {};

      if (
        !email ||
        !password
      ) {
        return res
          .status(
            400
          )
          .json({
            success:
              false,

            error:
              'Email and password are required.',
          });
      }

      const normalizedEmail =
        normalizeEmail(
          email
        );

      const employees =
        readEmployees();

      const employee =
        employees.find(
          (
            item
          ) =>
            normalizeEmail(
              item.email
            ) ===
              normalizedEmail &&
            item.password ===
              password &&
            item.approved !==
              false
        );

      if (
        !employee
      ) {
        const pending =
          readPending()
            .find(
              (
                signup
              ) =>
                normalizeEmail(
                  signup.email
                ) ===
                normalizedEmail
            );

        if (
          pending
        ) {
          return res
            .status(
              403
            )
            .json({
              success:
                false,

              pending:
                true,

              error:
                'Your account is waiting for administrator approval.',
            });
        }

        return res
          .status(
            401
          )
          .json({
            success:
              false,

            error:
              'Invalid email or password.',
          });
      }

      const folder =
        ensureEmployeeFolder(
          employee
        );

      console.log(
        '🔐 Employee login:',
        employee.email
      );

      console.log(
        '📁 Current workspace:',
        folder
      );

      return res.json({
        success:
          true,

        employee,
      });
    } catch (
      error
    ) {
      console.error(
        'Employee login error:',
        error
      );

      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// DELETE EMPLOYEE
// ======================================================

app.delete(
  '/api/employees/:id',
  (
    req,
    res
  ) => {
    try {
      const employees =
        readEmployees();

      const exists =
        employees.some(
          (
            employee
          ) =>
            employee.id ===
            req.params.id
        );

      if (
        !exists
      ) {
        return res
          .status(
            404
          )
          .json({
            success:
              false,

            error:
              'Employee not found.',
          });
      }

      saveEmployees(
        employees.filter(
          (
            employee
          ) =>
            employee.id !==
            req.params.id
        )
      );

      return res.json({
        success:
          true,

        message:
          'Employee account removed. Screenshot history was preserved.',
      });
    } catch (
      error
    ) {
      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// PROVISION EMPLOYEE WORKSPACE
// ======================================================

app.post(
  '/api/provision-employee',
  (
    req,
    res
  ) => {
    try {
      const {
        employeeId,
        dateKey,
      } =
        req.body ||
        {};

      if (
        !employeeId
      ) {
        return res
          .status(
            400
          )
          .json({
            success:
              false,

            error:
              'employeeId is required.',
          });
      }

      const employee =
        findEmployeeById(
          employeeId
        );

      if (
        !employee
      ) {
        return res
          .status(
            404
          )
          .json({
            success:
              false,

            error:
              'Employee not found.',
          });
      }

      const selectedDate =
        isValidDateKey(
          dateKey
        )
          ? dateKey
          : dateKeyNow();

      const folder =
        ensureEmployeeFolder(
          employee,
          selectedDate
        );

      return res.json({
        success:
          true,

        employeeId:
          employee.id,

        firstName:
          employee.firstName ||
          '',

        lastName:
          employee.lastName ||
          '',

        employeeName:
          getEmployeeFullName(
            employee
          ),

        email:
          employee.email,

        dateKey:
          selectedDate,

        monthFolder:
          getMonthFolderName(
            selectedDate
          ),

        folderPath:
          path.relative(
            UPLOAD_DIR,
            folder
          ),
      });
    } catch (
      error
    ) {
      console.error(
        'Provision employee error:',
        error
      );

      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// TRACKER TIME SAVE
// ======================================================

app.post(
  '/api/tracker-time',
  (
    req,
    res
  ) => {
    try {
      const {
        employeeId,
        employeeName,
        dateKey,
        totalSeconds,
      } =
        req.body ||
        {};

      if (
        !employeeId
      ) {
        return res
          .status(
            400
          )
          .json({
            success:
              false,

            error:
              'employeeId is required.',
          });
      }

      const selectedDate =
        isValidDateKey(
          dateKey
        )
          ? String(
              dateKey
            )
          : dateKeyNow();

      const incomingSeconds =
        Math.max(
          0,
          Math.floor(
            Number(
              totalSeconds
            ) ||
              0
          )
        );

      const tracker =
        readTracker();

      if (
        !tracker[
          employeeId
        ]
      ) {
        tracker[
          employeeId
        ] = {
          employeeId,

          employeeName:
            employeeName ||
            'Employee',

          dates:
            {},
        };
      }

      if (
        !tracker[
          employeeId
        ].dates
      ) {
        tracker[
          employeeId
        ].dates =
          {};
      }

      const oldSeconds =
        Number(
          tracker[
            employeeId
          ].dates[
            selectedDate
          ]?.totalSeconds ||
            0
        );

      const finalSeconds =
        Math.max(
          oldSeconds,
          incomingSeconds
        );

      tracker[
        employeeId
      ].employeeName =
        employeeName ||
        tracker[
          employeeId
        ].employeeName;

      tracker[
        employeeId
      ].dates[
        selectedDate
      ] = {
        totalSeconds:
          finalSeconds,

        updatedAt:
          new Date().toISOString(),
      };

      saveTracker(
        tracker
      );

      return res.json({
        success:
          true,

        employeeId,

        dateKey:
          selectedDate,

        totalSeconds:
          finalSeconds,
      });
    } catch (
      error
    ) {
      console.error(
        'Tracker save error:',
        error
      );

      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// TRACKER BY DATE
// ======================================================

app.get(
  '/api/tracker-time/:employeeId/:dateKey',
  (
    req,
    res
  ) => {
    try {
      const tracker =
        readTracker();

      const record =
        tracker[
          req.params.employeeId
        ]?.dates?.[
          req.params.dateKey
        ];

      return res.json({
        success:
          true,

        employeeId:
          req.params.employeeId,

        dateKey:
          req.params.dateKey,

        totalSeconds:
          Number(
            record?.totalSeconds ||
              0
          ),

        updatedAt:
          record?.updatedAt ||
          null,
      });
    } catch (
      error
    ) {
      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// TRACKER HISTORY
// ======================================================

app.get(
  '/api/tracker-time/:employeeId',
  (
    req,
    res
  ) => {
    try {
      const tracker =
        readTracker();

      const employeeData =
        tracker[
          req.params.employeeId
        ];

      const records =
        Object.entries(
          employeeData?.dates ||
            {}
        )
          .map(
            ([
              dateKey,
              value,
            ]) => ({
              dateKey,

              totalSeconds:
                Number(
                  value?.totalSeconds ||
                    0
                ),

              updatedAt:
                value?.updatedAt ||
                null,
            })
          )
          .sort(
            (
              a,
              b
            ) =>
              b.dateKey.localeCompare(
                a.dateKey
              )
          );

      const totalSeconds =
        records.reduce(
          (
            total,
            record
          ) =>
            total +
            record.totalSeconds,
          0
        );

      return res.json({
        success:
          true,

        employeeId:
          req.params.employeeId,

        employeeName:
          employeeData?.employeeName ||
          '',

        records,

        totalSeconds,
      });
    } catch (
      error
    ) {
      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// MONTH TRACKER
// ======================================================

app.get(
  '/api/tracker-month/:employeeId/:monthKey',
  (
    req,
    res
  ) => {
    try {
      const tracker =
        readTracker();

      const dates =
        tracker[
          req.params.employeeId
        ]?.dates ||
        {};

      const records =
        Object.entries(
          dates
        )
          .filter(
            ([
              dateKey,
            ]) =>
              dateKey.startsWith(
                req.params.monthKey
              )
          )
          .map(
            ([
              dateKey,
              value,
            ]) => ({
              dateKey,

              totalSeconds:
                Number(
                  value?.totalSeconds ||
                    0
                ),
            })
          );

      const totalSeconds =
        records.reduce(
          (
            total,
            record
          ) =>
            total +
            record.totalSeconds,
          0
        );

      return res.json({
        success:
          true,

        employeeId:
          req.params.employeeId,

        monthKey:
          req.params.monthKey,

        totalSeconds,

        records,
      });
    } catch (
      error
    ) {
      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// GET GLOBAL CAPTURE SETTINGS
// ======================================================

app.get(
  '/api/capture-settings',
  (
    req,
    res
  ) => {
    try {
      return res.json({
        success:
          true,

        settings:
          readCaptureSettings(),
      });
    } catch (
      error
    ) {
      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// SAVE GLOBAL CAPTURE SETTINGS
// ======================================================

app.post(
  '/api/capture-settings',
  (
    req,
    res
  ) => {
    try {
      const current =
        readCaptureSettings();

      let windowSeconds =
        Math.floor(
          Number(
            req.body
              ?.captureWindowSeconds
          )
        );

      let screenshots =
        Math.floor(
          Number(
            req.body
              ?.screenshotsPerWindow
          )
        );

      if (
        !Number.isFinite(
          windowSeconds
        ) ||
        windowSeconds <=
          0
      ) {
        windowSeconds =
          Math.floor(
            Number(
              req.body
                ?.captureIntervalSeconds ||
                current.captureWindowSeconds ||
                600
            )
          );
      }

      if (
        !Number.isFinite(
          screenshots
        ) ||
        screenshots <=
          0
      ) {
        screenshots =
          Math.floor(
            Number(
              current.screenshotsPerWindow ||
                5
            )
          );
      }

      windowSeconds =
        Math.max(
          5,
          Math.min(
            windowSeconds,
            86400
          )
        );

      screenshots =
        Math.max(
          1,
          Math.min(
            screenshots,
            500
          )
        );

      const updated = {
        ...current,

        captureMode:
          'random_count_window',

        captureWindowSeconds:
          windowSeconds,

        screenshotsPerWindow:
          screenshots,

        presetId:
          String(
            req.body
              ?.presetId ||
              'custom'
          ),

        lockIntervalForEmployees:
          req.body
            ?.lockIntervalForEmployees !==
          undefined
            ? Boolean(
                req.body
                  .lockIntervalForEmployees
              )
            : current.lockIntervalForEmployees !==
              false,

        captureIntervalSeconds:
          windowSeconds,

        autoCaptureIntervalMinutes:
          Math.max(
            1,
            Math.round(
              windowSeconds /
                60
            )
          ),

        updatedAt:
          new Date().toISOString(),
      };

      saveCaptureSettings(
        updated
      );

      console.log(
        `⚙️ Capture Policy: ${screenshots} screenshot(s) randomly within ${windowSeconds} seconds`
      );

      return res.json({
        success:
          true,

        settings:
          updated,
      });
    } catch (
      error
    ) {
      console.error(
        'Capture settings error:',
        error
      );

      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// ACTIVITY FOR DATE
// ======================================================

app.get(
  '/api/activity/:employeeId/:dateKey',
  (
    req,
    res
  ) => {
    try {
      const employee =
        findEmployeeById(
          req.params.employeeId
        );

      if (
        !employee
      ) {
        return res
          .status(
            404
          )
          .json({
            success:
              false,

            error:
              'Employee not found.',
          });
      }

      const selectedDate =
        req.params.dateKey;

      const tracker =
        readTracker();

      const totalSeconds =
        Number(
          tracker[
            employee.id
          ]?.dates?.[
            selectedDate
          ]?.totalSeconds ||
            0
        );

      const folder =
        employeeDateFolder(
          employee,
          selectedDate
        );

      const files =
        getImageFiles(
          folder
        );

      const screenshots =
        files.map(
          (
            fileName
          ) => ({
            id:
              `${employee.id}-${selectedDate}-${fileName}`,

            userId:
              employee.id,

            userName:
              getEmployeeFullName(
                employee
              ),

            employeeId:
              employee.id,

            employeeName:
              getEmployeeFullName(
                employee
              ),

            email:
              employee.email,

            dateKey:
              selectedDate,

            fileName,

            localUrl:
              buildScreenshotUrl(
                req,
                employee,
                selectedDate,
                fileName
              ),
          })
        );

      return res.json({
        success:
          true,

        employee: {
          id:
            employee.id,

          firstName:
            employee.firstName ||
            '',

          lastName:
            employee.lastName ||
            '',

          name:
            getEmployeeFullName(
              employee
            ),

          email:
            employee.email,
        },

        dateKey:
          selectedDate,

        totalSeconds,

        screenshotCount:
          screenshots.length,

        screenshots,
      });
    } catch (
      error
    ) {
      console.error(
        'Activity error:',
        error
      );

      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// ACTIVITY HISTORY
// ======================================================

app.get(
  '/api/activity-history/:employeeId',
  (
    req,
    res
  ) => {
    try {
      const employee =
        findEmployeeById(
          req.params.employeeId
        );

      if (
        !employee
      ) {
        return res
          .status(
            404
          )
          .json({
            success:
              false,

            error:
              'Employee not found.',
          });
      }

      const tracker =
        readTracker();

      const trackerDates =
        Object.keys(
          tracker[
            employee.id
          ]?.dates ||
            {}
        );

      const screenshotDates =
        getEmployeeDateFolders(
          employee
        );

      const dates =
        Array.from(
          new Set([
            ...trackerDates,
            ...screenshotDates,
          ])
        )
          .sort()
          .reverse();

      const records =
        dates.map(
          (
            dateKey
          ) => ({
            dateKey,

            totalSeconds:
              Number(
                tracker[
                  employee.id
                ]?.dates?.[
                  dateKey
                ]?.totalSeconds ||
                  0
              ),

            screenshotCount:
              getScreenshotCount(
                employee,
                dateKey
              ),
          })
        );

      return res.json({
        success:
          true,

        employee: {
          id:
            employee.id,

          firstName:
            employee.firstName ||
            '',

          lastName:
            employee.lastName ||
            '',

          name:
            getEmployeeFullName(
              employee
            ),

          email:
            employee.email,
        },

        records,
      });
    } catch (
      error
    ) {
      console.error(
        'History error:',
        error
      );

      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// ADMIN SUMMARY
// ======================================================

app.get(
  '/api/admin/activity-summary',
  (
    req,
    res
  ) => {
    try {
      const employees =
        readEmployees();

      const tracker =
        readTracker();

      const today =
        dateKeyNow();

      const month =
        /^\d{4}-\d{2}$/.test(
          String(
            req.query.month ||
              ''
          )
        )
          ? String(
              req.query.month
            )
          : monthKeyNow();

      const summaries =
        employees.map(
          (
            employee
          ) => {
            const dates =
              tracker[
                employee.id
              ]?.dates ||
              {};

            const todaySeconds =
              Number(
                dates[
                  today
                ]?.totalSeconds ||
                  0
              );

            const monthlySeconds =
              Object.entries(
                dates
              )
                .filter(
                  ([
                    dateKey,
                  ]) =>
                    dateKey.startsWith(
                      month
                    )
                )
                .reduce(
                  (
                    total,
                    [
                      ,
                      record,
                    ]
                  ) =>
                    total +
                    Number(
                      record
                        ?.totalSeconds ||
                        0
                    ),
                  0
                );

            return {
              employeeId:
                employee.id,

              employeeName:
                getEmployeeFullName(
                  employee
                ),

              firstName:
                employee.firstName ||
                '',

              lastName:
                employee.lastName ||
                '',

              email:
                employee.email,

              today,

              monthKey:
                month,

              todaySeconds,

              monthlySeconds,

              todayScreenshots:
                getScreenshotCount(
                  employee,
                  today
                ),
            };
          }
        );

      return res.json({
        success:
          true,

        today,

        monthKey:
          month,

        employees:
          summaries,
      });
    } catch (
      error
    ) {
      console.error(
        'Admin summary error:',
        error
      );

      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// MULTER SCREENSHOT STORAGE
// ======================================================

const storage =
  multer.diskStorage({
    destination: (
      req,
      file,
      callback
    ) => {
      try {
        const employeeId =
          String(
            req.body
              ?.employeeId ||
              ''
          ).trim();

        if (
          !employeeId
        ) {
          return callback(
            new Error(
              'employeeId is required before screenshot file.'
            )
          );
        }

        const employee =
          findEmployeeById(
            employeeId
          );

        if (
          !employee
        ) {
          return callback(
            new Error(
              `Employee not found for ID: ${employeeId}`
            )
          );
        }

        const selectedDate =
          isValidDateKey(
            req.body
              ?.dateKey
          )
            ? req.body.dateKey
            : dateKeyNow();

        const folder =
          employeeDateFolder(
            employee,
            selectedDate
          );

        fs.mkdirSync(
          folder,
          {
            recursive:
              true,
          }
        );

        console.log(
          '📸 Screenshot destination:'
        );

        console.log(
          folder
        );

        callback(
          null,
          folder
        );
      } catch (
        error
      ) {
        callback(
          error
        );
      }
    },

    filename: (
      req,
      file,
      callback
    ) => {
      const extension =
        path.extname(
          file.originalname ||
            ''
        ) ||
        '.webp';

      const fallback =
        `Screen_${Date.now()}${extension}`;

      const requested =
        safeSegment(
          req.body
            ?.fileName,
          fallback
        );

      callback(
        null,
        requested
      );
    },
  });

const upload =
  multer({
    storage,
  });

// ======================================================
// UPLOAD SCREENSHOT
// ======================================================

app.post(
  '/api/upload-screenshot',
  upload.single(
    'file'
  ),
  (
    req,
    res
  ) => {
    try {
      if (
        !req.file
      ) {
        return res
          .status(
            400
          )
          .json({
            success:
              false,

            error:
              'Screenshot file is required.',
          });
      }

      const employeeId =
        String(
          req.body
            ?.employeeId ||
            ''
        ).trim();

      const employee =
        findEmployeeById(
          employeeId
        );

      if (
        !employee
      ) {
        return res
          .status(
            404
          )
          .json({
            success:
              false,

            error:
              'Employee not found.',
          });
      }

      const selectedDate =
        isValidDateKey(
          req.body
            ?.dateKey
        )
          ? req.body.dateKey
          : dateKeyNow();

      const fileName =
        req.file.filename;

      const emailFolder =
        safeSegment(
          normalizeEmail(
            employee.email
          )
        );

      const nameFolder =
        safeSegment(
          getEmployeeFullName(
            employee
          )
        );

      const monthFolder =
        safeSegment(
          getMonthFolderName(
            selectedDate
          )
        );

      const relativePath =
        path.join(
          emailFolder,
          nameFolder,
          monthFolder,
          selectedDate,
          fileName
        );

      const localUrl =
        buildScreenshotUrl(
          req,
          employee,
          selectedDate,
          fileName
        );

      console.log(
        '✅ Screenshot saved:'
      );

      console.log(
        relativePath
      );

      return res.json({
        success:
          true,

        fileId:
          fileName,

        fileName,

        filePath:
          relativePath,

        employeeId:
          employee.id,

        firstName:
          employee.firstName ||
          '',

        lastName:
          employee.lastName ||
          '',

        employeeName:
          getEmployeeFullName(
            employee
          ),

        email:
          employee.email,

        monthFolder,

        dateKey:
          selectedDate,

        localUrl,
      });
    } catch (
      error
    ) {
      console.error(
        'Upload screenshot error:',
        error
      );

      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// STATIC SCREENSHOT FILES
// ======================================================

app.use(
  '/screenshots',
  express.static(
    UPLOAD_DIR
  )
);

// ======================================================
// LIST SCREENSHOTS BY EMPLOYEE ID
// ======================================================

app.get(
  '/api/screenshots/:employeeId/:dateKey',
  (
    req,
    res
  ) => {
    try {
      const employee =
        findEmployeeById(
          req.params.employeeId
        );

      if (
        !employee
      ) {
        return res
          .status(
            404
          )
          .json({
            success:
              false,

            error:
              'Employee not found.',
          });
      }

      const selectedDate =
        req.params.dateKey;

      if (
        !isValidDateKey(
          selectedDate
        )
      ) {
        return res
          .status(
            400
          )
          .json({
            success:
              false,

            error:
              'Invalid dateKey. Expected YYYY-MM-DD.',
          });
      }

      const folder =
        employeeDateFolder(
          employee,
          selectedDate
        );

      const files =
        getImageFiles(
          folder
        );

      const items =
        files.map(
          (
            fileName
          ) => ({
            fileName,

            employeeId:
              employee.id,

            employeeName:
              getEmployeeFullName(
                employee
              ),

            email:
              employee.email,

            monthFolder:
              getMonthFolderName(
                selectedDate
              ),

            dateKey:
              selectedDate,

            localUrl:
              buildScreenshotUrl(
                req,
                employee,
                selectedDate,
                fileName
              ),
          })
        );

      return res.json({
        success:
          true,

        employeeId:
          employee.id,

        employeeName:
          getEmployeeFullName(
            employee
          ),

        email:
          employee.email,

        monthFolder:
          getMonthFolderName(
            selectedDate
          ),

        dateKey:
          selectedDate,

        screenshotCount:
          files.length,

        files,

        items,
      });
    } catch (
      error
    ) {
      console.error(
        'Screenshot list error:',
        error
      );

      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// DELETE SCREENSHOT
// ======================================================

app.delete(
  '/api/screenshot',
  (
    req,
    res
  ) => {
    try {
      const {
        filePath,
      } =
        req.body ||
        {};

      if (
        !filePath
      ) {
        return res
          .status(
            400
          )
          .json({
            success:
              false,

            error:
              'filePath is required.',
          });
      }

      const root =
        path.resolve(
          UPLOAD_DIR
        );

      const target =
        path.resolve(
          UPLOAD_DIR,
          filePath
        );

      const relative =
        path.relative(
          root,
          target
        );

      if (
        relative.startsWith(
          '..'
        ) ||
        path.isAbsolute(
          relative
        )
      ) {
        return res
          .status(
            400
          )
          .json({
            success:
              false,

            error:
              'Invalid screenshot path.',
          });
      }

      if (
        fs.existsSync(
          target
        )
      ) {
        fs.unlinkSync(
          target
        );
      }

      return res.json({
        success:
          true,
      });
    } catch (
      error
    ) {
      console.error(
        'Delete screenshot error:',
        error
      );

      return res
        .status(
          500
        )
        .json({
          success:
            false,

          error:
            error.message,
        });
    }
  }
);

// ======================================================
// UNKNOWN API ROUTES
// ======================================================

app.use(
  '/api',
  (
    req,
    res
  ) => {
    return res
      .status(
        404
      )
      .json({
        success:
          false,

        error:
          `API endpoint not found: ${req.method} ${req.originalUrl}`,
      });
  }
);

// ======================================================
// FRONTEND - SERVE VITE BUILD
// ======================================================

const distPath =
  path.join(
    __dirname,
    'dist'
  );

if (
  fs.existsSync(
    distPath
  )
) {
  app.use(
    express.static(
      distPath
    )
  );

  app.get(
    /^(?!\/api(?:\/|$)|\/screenshots(?:\/|$)).*/,
    (
      req,
      res
    ) => {
      res.sendFile(
        path.join(
          distPath,
          'index.html'
        )
      );
    }
  );
}

// ======================================================
// ERROR HANDLER
// ======================================================

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      'Backend error:',
      error
    );

    if (
      res.headersSent
    ) {
      return next(
        error
      );
    }

    return res
      .status(
        500
      )
      .json({
        success:
          false,

        error:
          error?.message ||
          'Internal server error.',
      });
  }
);

// ======================================================
// SERVER
// ======================================================

const PORT =
  Number(
    process.env.PORT
  ) ||
  3001;

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log('');

    console.log(
      '=============================================='
    );

    console.log(
      `✅ WorkMonitor server running on port ${PORT}`
    );

    console.log(
      `📁 Screenshot root: ${UPLOAD_DIR}`
    );

    console.log(
      '📂 Screenshot structure:'
    );

    console.log(
      '   EMAIL > FIRST LAST > MONTH YEAR > YYYY-MM-DD'
    );

    console.log(
      `👥 Employees: ${EMPLOYEE_DB}`
    );

    console.log(
      `🕒 Pending: ${PENDING_DB}`
    );

    console.log(
      `⏱ Tracker: ${TRACKER_DB}`
    );

    console.log(
      `⚙️ Capture Settings: ${CAPTURE_SETTINGS_DB}`
    );

    console.log(
      '🌐 Production-ready HTTP server (hosting platform provides HTTPS)'
    );

    console.log(
      '=============================================='
    );

    console.log('');
  }
);
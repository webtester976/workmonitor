function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    },
  });
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getFullName(firstName, lastName, name) {
  const combined = `${firstName || ''} ${lastName || ''}`.trim();
  return combined || String(name || '').trim();
}

function employeeToPublic(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    name: row.name,
    email: row.email,

    password:
      row.password || '',

    role: row.role,
    approved: Boolean(row.approved),
    createdAt: row.created_at,
    approvedAt: row.approved_at,
  };
}

function pendingToPublic(row) {
  return {
    id: row.id,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    name: row.name,
    email: row.email,
    requestedAt: row.requested_at,
    timestamp: row.requested_at,
    status: row.status || 'pending',
  };
}

async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function monthKey() {
  return new Date().toISOString().slice(0, 7);
}

function safeFileName(
  value,
  fallback = `Screen_${Date.now()}.webp`
) {
  const clean = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim();

  return clean || fallback;
}

function screenshotPrefix(
  employeeId,
  dateKey = ''
) {
  return `shot:${employeeId}:${dateKey}`;
}


const INDIA_TIME_ZONE = 'Asia/Kolkata';
const TRACKING_START_MINUTES = 8 * 60 + 30;
const TRACKING_END_MINUTES = 20 * 60 + 30;

function isScreenshotUploadWindowOpen(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  const minutes = hour * 60 + minute;

  return minutes >= TRACKING_START_MINUTES && minutes <= TRACKING_END_MINUTES;
}

async function storeScreenshot(env, employee, file, requestedFileName, requestedDateKey, origin) {
  const dateKey = isDateKey(requestedDateKey) ? requestedDateKey : todayKey();
  const fileName = safeFileName(requestedFileName || file.name, `Screen_${Date.now()}.webp`);
  const uniqueId = crypto.randomUUID();
  const storageKey = `shot:${employee.id}:${dateKey}:${Date.now()}:${uniqueId}:${fileName}`;
  const arrayBuffer = await file.arrayBuffer();
  const uploadedAt = new Date().toISOString();
  const contentType = file.type || 'image/webp';

  await env.SCREENSHOTS.put(storageKey, arrayBuffer, {
    metadata: {
      fileName,
      employeeId: employee.id,
      employeeName: employee.name,
      email: employee.email,
      dateKey,
      contentType,
      uploadedAt,
    },
  });

  try {
    await env.DB.prepare(`
      INSERT INTO screenshot_index (
        id, employee_id, employee_name, email, date_key,
        file_name, storage_key, content_type, uploaded_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(storage_key)
      DO UPDATE SET
        employee_id = excluded.employee_id,
        employee_name = excluded.employee_name,
        email = excluded.email,
        date_key = excluded.date_key,
        file_name = excluded.file_name,
        content_type = excluded.content_type,
        uploaded_at = excluded.uploaded_at
    `).bind(
      storageKey,
      employee.id,
      employee.name,
      employee.email,
      dateKey,
      fileName,
      storageKey,
      contentType,
      uploadedAt
    ).run();
  } catch (error) {
    await env.SCREENSHOTS.delete(storageKey);
    throw error;
  }

  return {
    fileId: storageKey,
    fileName,
    filePath: storageKey,
    employeeId: employee.id,
    firstName: employee.first_name || '',
    lastName: employee.last_name || '',
    employeeName: employee.name,
    email: employee.email,
    monthFolder: dateKey.slice(0, 7),
    dateKey,
    localUrl: `${origin}/api/screenshot-file?key=${encodeURIComponent(storageKey)}`,
  };
}


// ====================================================
// SCREENSHOT COUNT - D1
// ====================================================

async function countScreenshots(
  env,
  employeeId,
  dateKey
) {
  const row = await env.DB
    .prepare(`
      SELECT COUNT(*) AS total
      FROM screenshot_index
      WHERE employee_id = ?
        AND date_key = ?
    `)
    .bind(
      employeeId,
      dateKey
    )
    .first();

  return Number(
    row?.total || 0
  );
}


// ====================================================
// GET SCREENSHOT KEYS FOR EMPLOYEE - D1
// Used when deleting an employee.
// No KV list() call.
// ====================================================

async function listAllScreenshotKeys(
  env,
  employeeId
) {
  const result = await env.DB
    .prepare(`
      SELECT storage_key AS name
      FROM screenshot_index
      WHERE employee_id = ?
      ORDER BY uploaded_at DESC
    `)
    .bind(
      employeeId
    )
    .all();

  return (
    result.results ||
    []
  );
}


// ====================================================
// API
// ====================================================

async function handleApi(
  request,
  env
) {
  const url =
    new URL(
      request.url
    );

  const pathname =
    url.pathname;

  const method =
    request.method;


  // ====================================================
  // OPTIONS / CORS
  // ====================================================

  if (
    method ===
    'OPTIONS'
  ) {
    return new Response(
      null,
      {
        status: 204,

        headers: {
          'Access-Control-Allow-Origin':
            '*',

          'Access-Control-Allow-Headers':
            'Content-Type, Authorization',

          'Access-Control-Allow-Methods':
            'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        },
      }
    );
  }


  // ====================================================
  // HEALTH
  // ====================================================

  if (
    method === 'GET' &&
    pathname === '/api/health'
  ) {
    return json({
      success: true,

      ok: true,

      storage:
        'Cloudflare D1',

      screenshotStorageMode:
        env.SCREENSHOTS
          ? 'Cloudflare KV'
          : 'disabled',

      screenshotUploadEnabled:
        Boolean(
          env.SCREENSHOTS
        ),

      database:
        'codesdot-workmonitor-db',

      serverTime:
        new Date()
          .toISOString(),
    });
  }


  // ====================================================
  // EMPLOYEES
  // ====================================================

  if (
    method === 'GET' &&
    pathname ===
      '/api/employees'
  ) {
    const result =
      await env.DB
        .prepare(`
          SELECT *
          FROM employees
          ORDER BY created_at DESC
        `)
        .all();

    return json({
      success: true,

      employees:
        result.results.map(
          employeeToPublic
        ),
    });
  }


  // ====================================================
  // REQUEST SIGNUP
  // ====================================================

  if (
    method === 'POST' &&
    pathname ===
      '/api/request-signup'
  ) {
    const body =
      await parseBody(
        request
      );

    const firstName =
      String(
        body.firstName ||
        ''
      ).trim();

    const lastName =
      String(
        body.lastName ||
        ''
      ).trim();

    const name =
      getFullName(
        firstName,
        lastName,
        body.name
      );

    const email =
      normalizeEmail(
        body.email
      );

    const password =
      String(
        body.password ||
        ''
      );


    if (
      !name ||
      !email ||
      !password
    ) {
      return json(
        {
          success: false,

          error:
            'First name, last name, email and password are required.',
        },
        400
      );
    }


    const active =
      await env.DB
        .prepare(`
          SELECT id
          FROM employees
          WHERE email = ?
          LIMIT 1
        `)
        .bind(
          email
        )
        .first();


    if (active) {
      return json(
        {
          success: false,

          error:
            'An active employee account already exists with this email.',
        },
        409
      );
    }


    const pending =
      await env.DB
        .prepare(`
          SELECT id
          FROM pending_signups
          WHERE email = ?
          LIMIT 1
        `)
        .bind(
          email
        )
        .first();


    if (pending) {
      return json(
        {
          success: false,

          pending: true,

          error:
            'Your signup request is already waiting for administrator approval.',
        },
        409
      );
    }


    const id =
      body.id ||
      `pending-${Date.now()}`;

    const requestedAt =
      new Date()
        .toISOString();


    await env.DB
      .prepare(`
        INSERT INTO pending_signups (
          id,
          first_name,
          last_name,
          name,
          email,
          password,
          requested_at,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      `)
      .bind(
        id,
        firstName,
        lastName,
        name,
        email,
        password,
        requestedAt
      )
      .run();


    return json(
      {
        success: true,

        pending: true,

        signup: {
          id,
          firstName,
          lastName,
          name,
          email,
          requestedAt,

          timestamp:
            requestedAt,

          status:
            'pending',
        },

        message:
          'Signup request sent. Please wait for administrator approval.',
      },
      202
    );
  }


  // ====================================================
  // PENDING EMPLOYEES
  // ====================================================

  if (
    method === 'GET' &&
    pathname ===
      '/api/pending-employees'
  ) {
    const result =
      await env.DB
        .prepare(`
          SELECT *
          FROM pending_signups
          ORDER BY requested_at DESC
        `)
        .all();

    return json({
      success: true,

      pending:
        result.results.map(
          pendingToPublic
        ),
    });
  }


  // ====================================================
  // APPROVE EMPLOYEE
  // ====================================================

  const approveMatch =
    pathname.match(
      /^\/api\/approve-employee\/([^/]+)$/
    );


  if (
    method === 'POST' &&
    approveMatch
  ) {
    const pendingId =
      decodeURIComponent(
        approveMatch[1]
      );


    const pending =
      await env.DB
        .prepare(`
          SELECT *
          FROM pending_signups
          WHERE id = ?
          LIMIT 1
        `)
        .bind(
          pendingId
        )
        .first();


    if (!pending) {
      return json(
        {
          success: false,

          error:
            'Pending signup not found.',
        },
        404
      );
    }


    const existing =
      await env.DB
        .prepare(`
          SELECT id
          FROM employees
          WHERE email = ?
          LIMIT 1
        `)
        .bind(
          pending.email
        )
        .first();


    if (existing) {
      await env.DB
        .prepare(`
          DELETE FROM pending_signups
          WHERE id = ?
        `)
        .bind(
          pendingId
        )
        .run();


      return json(
        {
          success: false,

          error:
            'Employee is already active.',
        },
        409
      );
    }


    const employeeId =
      `emp-${Date.now()}-${crypto
        .randomUUID()
        .slice(
          0,
          6
        )}`;


    const now =
      new Date()
        .toISOString();


    await env.DB.batch([
      env.DB
        .prepare(`
          INSERT INTO employees (
            id,
            first_name,
            last_name,
            name,
            email,
            password,
            role,
            approved,
            created_at,
            approved_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 'employee', 1, ?, ?)
        `)
        .bind(
          employeeId,
          pending.first_name ||
            '',
          pending.last_name ||
            '',
          pending.name,
          pending.email,
          pending.password,
          now,
          now
        ),

      env.DB
        .prepare(`
          DELETE FROM pending_signups
          WHERE id = ?
        `)
        .bind(
          pendingId
        ),
    ]);


    const employee =
      await env.DB
        .prepare(`
          SELECT *
          FROM employees
          WHERE id = ?
        `)
        .bind(
          employeeId
        )
        .first();


    return json({
      success: true,

      employee:
        employeeToPublic(
          employee
        ),

      folderPath:
        null,
    });
  }


  // ====================================================
  // REJECT EMPLOYEE
  // ====================================================

  const rejectMatch =
    pathname.match(
      /^\/api\/reject-employee\/([^/]+)$/
    );


  if (
    method === 'DELETE' &&
    rejectMatch
  ) {
    const id =
      decodeURIComponent(
        rejectMatch[1]
      );


    const pending =
      await env.DB
        .prepare(`
          SELECT id
          FROM pending_signups
          WHERE id = ?
        `)
        .bind(
          id
        )
        .first();


    if (!pending) {
      return json(
        {
          success: false,

          error:
            'Pending signup not found.',
        },
        404
      );
    }


    await env.DB
      .prepare(`
        DELETE FROM pending_signups
        WHERE id = ?
      `)
      .bind(
        id
      )
      .run();


    return json({
      success: true,
    });
  }


  // ====================================================
  // DIRECT REGISTRATION DISABLED
  // ====================================================

  if (
    method === 'POST' &&
    pathname ===
      '/api/register-employee'
  ) {
    return json(
      {
        success: false,

        error:
          'Direct registration is disabled. Use /api/request-signup.',
      },
      410
    );
  }


  // ====================================================
  // LOGIN BOOTSTRAP DATA
  // ====================================================

  async function getCaptureSettingsRow() {
    const row = await env.DB
      .prepare(`
        SELECT *
        FROM capture_settings
        WHERE id = 1
      `)
      .first();

    return {
      captureMode: row?.capture_mode || 'random_count_window',
      captureWindowSeconds: Number(row?.capture_window_seconds || 600),
      screenshotsPerWindow: Number(row?.screenshots_per_window || 5),
      presetId: row?.preset_id || '10m-5',
      lockIntervalForEmployees: Boolean(row?.lock_interval_for_employees ?? 1),
      captureIntervalSeconds: Number(row?.capture_window_seconds || 600),
      autoCaptureIntervalMinutes: Math.max(1, Math.round(Number(row?.capture_window_seconds || 600) / 60)),
      allowedIntervals: [10, 60, 120, 300, 600, 900],
      updatedAt: row?.updated_at || null,
    };
  }

  // ====================================================
  // ADMIN LOGIN
  // ====================================================

  if (
    method === 'POST' &&
    pathname ===
      '/api/login-admin'
  ) {
    const body =
      await parseBody(
        request
      );


    const email =
      normalizeEmail(
        body.email
      );


    const password =
      String(
        body.password ||
        ''
      );


    if (
      !email ||
      !password
    ) {
      return json(
        {
          success: false,

          error:
            'Email and password are required.',
        },
        400
      );
    }


    const admin =
      await env.DB
        .prepare(`
          SELECT *
          FROM admins
          WHERE email = ?
            AND active = 1
          LIMIT 1
        `)
        .bind(
          email
        )
        .first();


    if (!admin) {
      return json(
        {
          success: false,

          error:
            'Invalid admin email or password.',
        },
        401
      );
    }


    const encoder =
      new TextEncoder();


    const passwordKey =
      await crypto.subtle.importKey(
        'raw',

        encoder.encode(
          password
        ),

        {
          name:
            'PBKDF2',
        },

        false,

        [
          'deriveBits',
        ]
      );


    const saltBytes =
      encoder.encode(
        String(
          admin.password_salt
        )
      );


    const derivedBits =
      await crypto.subtle.deriveBits(
        {
          name:
            'PBKDF2',

          hash:
            'SHA-256',

          salt:
            saltBytes,

          iterations:
            Number(
              admin.iterations ||
              100000
            ),
        },

        passwordKey,

        256
      );


    const derivedHash =
      Array.from(
        new Uint8Array(
          derivedBits
        )
      )
        .map(
          (byte) =>
            byte
              .toString(16)
              .padStart(
                2,
                '0'
              )
        )
        .join('');


    if (
      derivedHash !==
      String(
        admin.password_hash
      )
    ) {
      return json(
        {
          success: false,

          error:
            'Invalid admin email or password.',
        },
        401
      );
    }


    const now =
      new Date()
        .toISOString();


    // ----------------------------------------------------
    // Update last login
    // ----------------------------------------------------

    await env.DB
      .prepare(`
        UPDATE admins
        SET last_login_at = ?
        WHERE id = ?
      `)
      .bind(
        now,
        admin.id
      )
      .run();


    // ----------------------------------------------------
    // Generate secure session token
    // ----------------------------------------------------

    const tokenBytes =
      crypto.getRandomValues(
        new Uint8Array(
          32
        )
      );


    const sessionToken =
      Array.from(
        tokenBytes
      )
        .map(
          (byte) =>
            byte
              .toString(16)
              .padStart(
                2,
                '0'
              )
        )
        .join('');


    const tokenHashBuffer =
      await crypto.subtle.digest(
        'SHA-256',

        new TextEncoder()
          .encode(
            sessionToken
          )
      );


    const tokenHash =
      Array.from(
        new Uint8Array(
          tokenHashBuffer
        )
      )
        .map(
          (byte) =>
            byte
              .toString(16)
              .padStart(
                2,
                '0'
              )
        )
        .join('');


    const expiresAt =
      new Date(
        Date.now() +
        7 *
          24 *
          60 *
          60 *
          1000
      )
        .toISOString();


    const sessionId =
      `session-${crypto.randomUUID()}`;


    // Remove expired sessions

    await env.DB
      .prepare(`
        DELETE FROM admin_sessions
        WHERE expires_at <= ?
      `)
      .bind(
        now
      )
      .run();


    // Save hashed session token

    await env.DB
      .prepare(`
        INSERT INTO admin_sessions (
          id,
          admin_id,
          token_hash,
          created_at,
          expires_at,
          last_used_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        sessionId,
        admin.id,
        tokenHash,
        now,
        expiresAt,
        now
      )
      .run();


    const [employeesResult, pendingResult, captureSettings] = await Promise.all([
      env.DB.prepare(`SELECT * FROM employees WHERE approved = 1 ORDER BY created_at DESC`).all(),
      env.DB.prepare(`SELECT * FROM pending_signups ORDER BY requested_at DESC`).all(),
      getCaptureSettingsRow(),
    ]);

    const bootstrapSummary = [];
    const bootstrapToday = todayKey();
    const bootstrapMonth = monthKey();
    for (const employee of employeesResult.results) {
      const [todayRecord, monthResult, todayScreenshots] = await Promise.all([
        env.DB.prepare(`SELECT total_seconds FROM tracker_time WHERE employee_id = ? AND date_key = ? LIMIT 1`).bind(employee.id, bootstrapToday).first(),
        env.DB.prepare(`SELECT COALESCE(SUM(total_seconds), 0) AS total FROM tracker_time WHERE employee_id = ? AND date_key LIKE ?`).bind(employee.id, `${bootstrapMonth}%`).first(),
        countScreenshots(env, employee.id, bootstrapToday),
      ]);
      bootstrapSummary.push({
        employeeId: employee.id,
        employeeName: employee.name,
        firstName: employee.first_name || '',
        lastName: employee.last_name || '',
        email: employee.email,
        today: bootstrapToday,
        monthKey: bootstrapMonth,
        todaySeconds: Number(todayRecord?.total_seconds || 0),
        monthlySeconds: Number(monthResult?.total || 0),
        todayScreenshots,
      });
    }

    return json({
      success: true,
      token: sessionToken,
      expiresAt,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: 'admin',
        approved: true,
        createdAt: admin.created_at,
        lastActive: now,
      },
      bootstrap: {
        employees: employeesResult.results.map(employeeToPublic),
        pending: pendingResult.results.map(pendingToPublic),
        captureSettings,
        summary: bootstrapSummary,
      },
    });
  }


  // ====================================================
  // EMPLOYEE LOGIN
  // ====================================================

  if (
    method === 'POST' &&
    pathname ===
      '/api/login-employee'
  ) {
    const body =
      await parseBody(
        request
      );


    const email =
      normalizeEmail(
        body.email
      );


    const password =
      String(
        body.password ||
        ''
      );


    if (
      !email ||
      !password
    ) {
      return json(
        {
          success: false,

          error:
            'Email and password are required.',
        },
        400
      );
    }


    const employee =
      await env.DB
        .prepare(`
          SELECT *
          FROM employees
          WHERE email = ?
            AND password = ?
            AND approved = 1
          LIMIT 1
        `)
        .bind(
          email,
          password
        )
        .first();


    if (!employee) {
      const pending =
        await env.DB
          .prepare(`
            SELECT id
            FROM pending_signups
            WHERE email = ?
            LIMIT 1
          `)
          .bind(
            email
          )
          .first();


      if (pending) {
        return json(
          {
            success: false,

            pending: true,

            error:
              'Your account is waiting for administrator approval.',
          },
          403
        );
      }


      return json(
        {
          success: false,

          error:
            'Invalid email or password.',
        },
        401
      );
    }


    const captureSettings = await getCaptureSettingsRow();

    return json({
      success: true,
      employee: employeeToPublic(employee),
      bootstrap: {
        captureSettings,
      },
    });
  }


  // ====================================================
  // DELETE EMPLOYEE
  // ====================================================

  const employeeDeleteMatch =
    pathname.match(
      /^\/api\/employees\/([^/]+)$/
    );


  if (
    method === 'DELETE' &&
    employeeDeleteMatch
  ) {
    const id =
      decodeURIComponent(
        employeeDeleteMatch[1]
      );


    const employee =
      await env.DB
        .prepare(`
          SELECT id
          FROM employees
          WHERE id = ?
        `)
        .bind(
          id
        )
        .first();


    if (!employee) {
      return json(
        {
          success: false,

          error:
            'Employee not found.',
        },
        404
      );
    }


    if (
      env.SCREENSHOTS
    ) {
      const keys =
        await listAllScreenshotKeys(
          env,
          id
        );


      for (
        const item of
        keys
      ) {
        await env.SCREENSHOTS.delete(
          item.name
        );
      }
    }


    await env.DB.batch([
      env.DB
        .prepare(`
          DELETE FROM screenshot_index
          WHERE employee_id = ?
        `)
        .bind(
          id
        ),

      env.DB
        .prepare(`
          DELETE FROM tracker_time
          WHERE employee_id = ?
        `)
        .bind(
          id
        ),

      env.DB
        .prepare(`
          DELETE FROM employees
          WHERE id = ?
        `)
        .bind(
          id
        ),
    ]);


    return json({
      success: true,

      message:
        'Employee account removed.',
    });
  }


  // ====================================================
  // PROVISION EMPLOYEE
  // ====================================================

  if (
    method === 'POST' &&
    pathname ===
      '/api/provision-employee'
  ) {
    const body =
      await parseBody(
        request
      );


    const employeeId =
      String(
        body.employeeId ||
        ''
      );


    const employee =
      await env.DB
        .prepare(`
          SELECT *
          FROM employees
          WHERE id = ?
        `)
        .bind(
          employeeId
        )
        .first();


    if (!employee) {
      return json(
        {
          success: false,

          error:
            'Employee not found.',
        },
        404
      );
    }


    return json({
      success: true,

      employeeId:
        employee.id,

      firstName:
        employee.first_name ||
        '',

      lastName:
        employee.last_name ||
        '',

      employeeName:
        employee.name,

      email:
        employee.email,

      dateKey:
        body.dateKey ||
        todayKey(),

      folderPath:
        null,
    });
  }


  // ====================================================
  // TRACKER SAVE
  // ====================================================

  if (
    method === 'POST' &&
    pathname ===
      '/api/tracker-time'
  ) {
    const body =
      await parseBody(
        request
      );


    const employeeId =
      String(
        body.employeeId ||
        ''
      );


    if (!employeeId) {
      return json(
        {
          success: false,

          error:
            'employeeId is required.',
        },
        400
      );
    }


    const dateKey =
      isDateKey(
        body.dateKey
      )
        ? String(
            body.dateKey
          )
        : todayKey();


    const incoming =
      Math.max(
        0,

        Math.floor(
          Number(
            body.totalSeconds
          ) ||
          0
        )
      );


    const existing =
      await env.DB
        .prepare(`
          SELECT total_seconds
          FROM tracker_time
          WHERE employee_id = ?
            AND date_key = ?
        `)
        .bind(
          employeeId,
          dateKey
        )
        .first();


    const finalSeconds =
      Math.max(
        Number(
          existing
            ?.total_seconds ||
          0
        ),

        incoming
      );


    const updatedAt =
      new Date()
        .toISOString();


    await env.DB
      .prepare(`
        INSERT INTO tracker_time (
          employee_id,
          date_key,
          employee_name,
          total_seconds,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(employee_id, date_key)
        DO UPDATE SET
          employee_name = excluded.employee_name,
          total_seconds = excluded.total_seconds,
          updated_at = excluded.updated_at
      `)
      .bind(
        employeeId,
        dateKey,
        body.employeeName ||
          'Employee',
        finalSeconds,
        updatedAt
      )
      .run();


    return json({
      success: true,

      employeeId,

      dateKey,

      totalSeconds:
        finalSeconds,
    });
  }


  // ====================================================
  // TRACKER BY DATE
  // ====================================================

  const trackerDateMatch =
    pathname.match(
      /^\/api\/tracker-time\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/
    );


  if (
    method === 'GET' &&
    trackerDateMatch
  ) {
    const employeeId =
      decodeURIComponent(
        trackerDateMatch[1]
      );


    const dateKey =
      trackerDateMatch[2];


    const record =
      await env.DB
        .prepare(`
          SELECT *
          FROM tracker_time
          WHERE employee_id = ?
            AND date_key = ?
        `)
        .bind(
          employeeId,
          dateKey
        )
        .first();


    return json({
      success: true,

      employeeId,

      dateKey,

      totalSeconds:
        Number(
          record
            ?.total_seconds ||
          0
        ),

      updatedAt:
        record
          ?.updated_at ||
        null,
    });
  }


  // ====================================================
  // TRACKER HISTORY
  // ====================================================

  const trackerHistoryMatch =
    pathname.match(
      /^\/api\/tracker-time\/([^/]+)$/
    );


  if (
    method === 'GET' &&
    trackerHistoryMatch
  ) {
    const employeeId =
      decodeURIComponent(
        trackerHistoryMatch[1]
      );


    const result =
      await env.DB
        .prepare(`
          SELECT *
          FROM tracker_time
          WHERE employee_id = ?
          ORDER BY date_key DESC
        `)
        .bind(
          employeeId
        )
        .all();


    const records =
      result.results.map(
        (row) => ({
          dateKey:
            row.date_key,

          totalSeconds:
            Number(
              row.total_seconds ||
              0
            ),

          updatedAt:
            row.updated_at,
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


    return json({
      success: true,

      employeeId,

      employeeName:
        result.results[0]
          ?.employee_name ||
        '',

      records,

      totalSeconds,
    });
  }


  // ====================================================
  // MONTH TRACKER
  // ====================================================

  const monthMatch =
    pathname.match(
      /^\/api\/tracker-month\/([^/]+)\/(\d{4}-\d{2})$/
    );


  if (
    method === 'GET' &&
    monthMatch
  ) {
    const employeeId =
      decodeURIComponent(
        monthMatch[1]
      );


    const selectedMonth =
      monthMatch[2];


    const result =
      await env.DB
        .prepare(`
          SELECT *
          FROM tracker_time
          WHERE employee_id = ?
            AND date_key LIKE ?
          ORDER BY date_key
        `)
        .bind(
          employeeId,
          `${selectedMonth}%`
        )
        .all();


    const records =
      result.results.map(
        (row) => ({
          dateKey:
            row.date_key,

          totalSeconds:
            Number(
              row.total_seconds ||
              0
            ),
        })
      );


    return json({
      success: true,

      employeeId,

      monthKey:
        selectedMonth,

      totalSeconds:
        records.reduce(
          (
            total,
            item
          ) =>
            total +
            item.totalSeconds,

          0
        ),

      records,
    });
  }


  // ====================================================
  // ACTIVITY HISTORY
  // ====================================================

  const activityHistoryMatch =
    pathname.match(
      /^\/api\/activity-history\/([^/]+)$/
    );


  if (
    method === 'GET' &&
    activityHistoryMatch
  ) {
    const employeeId =
      decodeURIComponent(
        activityHistoryMatch[1]
      );


    const employee =
      await env.DB
        .prepare(`
          SELECT *
          FROM employees
          WHERE id = ?
          LIMIT 1
        `)
        .bind(
          employeeId
        )
        .first();


    if (!employee) {
      return json(
        {
          success: false,

          error:
            'Employee not found.',
        },
        404
      );
    }


    const trackerResult =
      await env.DB
        .prepare(`
          SELECT
            date_key,
            total_seconds
          FROM tracker_time
          WHERE employee_id = ?
          ORDER BY date_key DESC
        `)
        .bind(
          employeeId
        )
        .all();


    const byDate =
      new Map();


    for (
      const row of
      trackerResult.results
    ) {
      byDate.set(
        row.date_key,
        {
          dateKey:
            row.date_key,

          totalSeconds:
            Number(
              row.total_seconds ||
              0
            ),

          screenshotCount:
            0,
        }
      );
    }


    // Screenshot count comes from D1.
    // No KV list() call.

    const screenshotCounts =
      await env.DB
        .prepare(`
          SELECT
            date_key,
            COUNT(*) AS screenshot_count
          FROM screenshot_index
          WHERE employee_id = ?
          GROUP BY date_key
        `)
        .bind(
          employeeId
        )
        .all();


    for (
      const row of
      screenshotCounts.results ||
      []
    ) {
      const dateKey =
        row.date_key;


      if (
        !isDateKey(
          dateKey
        )
      ) {
        continue;
      }


      if (
        !byDate.has(
          dateKey
        )
      ) {
        byDate.set(
          dateKey,
          {
            dateKey,

            totalSeconds:
              0,

            screenshotCount:
              0,
          }
        );
      }


      byDate.get(
        dateKey
      ).screenshotCount =
        Number(
          row.screenshot_count ||
          0
        );
    }


    const records =
      Array.from(
        byDate.values()
      )
        .sort(
          (
            a,
            b
          ) =>
            b.dateKey
              .localeCompare(
                a.dateKey
              )
        );


    return json({
      success: true,

      employee:
        employeeToPublic(
          employee
        ),

      records,
    });
  }


  // ====================================================
  // ACTIVITY FOR DATE
  // ====================================================

  const activityMatch =
    pathname.match(
      /^\/api\/activity\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/
    );


  if (
    method === 'GET' &&
    activityMatch
  ) {
    const employeeId =
      decodeURIComponent(
        activityMatch[1]
      );


    const dateKey =
      activityMatch[2];


    const employee =
      await env.DB
        .prepare(`
          SELECT *
          FROM employees
          WHERE id = ?
          LIMIT 1
        `)
        .bind(
          employeeId
        )
        .first();


    if (!employee) {
      return json(
        {
          success: false,

          error:
            'Employee not found.',
        },
        404
      );
    }


    const record =
      await env.DB
        .prepare(`
          SELECT total_seconds
          FROM tracker_time
          WHERE employee_id = ?
            AND date_key = ?
          LIMIT 1
        `)
        .bind(
          employeeId,
          dateKey
        )
        .first();


    const screenshotRows =
      await env.DB
        .prepare(`
          SELECT *
          FROM screenshot_index
          WHERE employee_id = ?
            AND date_key = ?
          ORDER BY uploaded_at DESC
        `)
        .bind(
          employeeId,
          dateKey
        )
        .all();


    const items =
      (
        screenshotRows.results ||
        []
      )
        .map(
          (row) => ({
            id:
              row.storage_key,

            fileName:
              row.file_name,

            userId:
              employee.id,

            userName:
              employee.name,

            employeeId:
              employee.id,

            employeeName:
              employee.name,

            email:
              employee.email,

            dateKey,

            uploadedAt:
              row.uploaded_at,

            localUrl:
              `${url.origin}/api/screenshot-file?key=${encodeURIComponent(
                row.storage_key
              )}`,

            filePath:
              row.storage_key,
          })
        );


    return json({
      success: true,

      employee:
        employeeToPublic(
          employee
        ),

      dateKey,

      totalSeconds:
        Number(
          record
            ?.total_seconds ||
          0
        ),

      screenshotCount:
        items.length,

      screenshots:
        items,
    });
  }


  // ====================================================
  // ADMIN ACTIVITY SUMMARY
  // ====================================================

  if (
    method === 'GET' &&
    pathname ===
      '/api/admin/activity-summary'
  ) {
    const today =
      todayKey();


    const requestedMonth =
      String(
        url.searchParams.get(
          'month'
        ) ||
        ''
      );


    const selectedMonth =
      /^\d{4}-\d{2}$/.test(
        requestedMonth
      )
        ? requestedMonth
        : monthKey();


    const employeesResult =
      await env.DB
        .prepare(`
          SELECT *
          FROM employees
          WHERE approved = 1
          ORDER BY created_at DESC
        `)
        .all();


    const summaries =
      [];


    for (
      const employee of
      employeesResult.results
    ) {
      const todayRecord =
        await env.DB
          .prepare(`
            SELECT total_seconds
            FROM tracker_time
            WHERE employee_id = ?
              AND date_key = ?
            LIMIT 1
          `)
          .bind(
            employee.id,
            today
          )
          .first();


      const monthResult =
        await env.DB
          .prepare(`
            SELECT
              COALESCE(
                SUM(total_seconds),
                0
              ) AS total
            FROM tracker_time
            WHERE employee_id = ?
              AND date_key LIKE ?
          `)
          .bind(
            employee.id,
            `${selectedMonth}%`
          )
          .first();


      const todayScreenshots =
        await countScreenshots(
          env,
          employee.id,
          today
        );


      summaries.push({
        employeeId:
          employee.id,

        employeeName:
          employee.name,

        firstName:
          employee.first_name ||
          '',

        lastName:
          employee.last_name ||
          '',

        email:
          employee.email,

        today,

        monthKey:
          selectedMonth,

        todaySeconds:
          Number(
            todayRecord
              ?.total_seconds ||
            0
          ),

        monthlySeconds:
          Number(
            monthResult
              ?.total ||
            0
          ),

        todayScreenshots,
      });
    }


    return json({
      success: true,

      today,

      monthKey:
        selectedMonth,

      employees:
        summaries,
    });
  }


  // ====================================================
  // CAPTURE SETTINGS GET
  // ====================================================

  if (
    method === 'GET' &&
    pathname ===
      '/api/capture-settings'
  ) {
    const row =
      await env.DB
        .prepare(`
          SELECT *
          FROM capture_settings
          WHERE id = 1
        `)
        .first();


    return json({
      success: true,

      settings: {
        captureMode:
          row?.capture_mode ||
          'random_count_window',

        captureWindowSeconds:
          Number(
            row
              ?.capture_window_seconds ||
            600
          ),

        screenshotsPerWindow:
          Number(
            row
              ?.screenshots_per_window ||
            5
          ),

        presetId:
          row?.preset_id ||
          '10m-5',

        lockIntervalForEmployees:
          Boolean(
            row
              ?.lock_interval_for_employees ??
            1
          ),

        captureIntervalSeconds:
          Number(
            row
              ?.capture_window_seconds ||
            600
          ),

        autoCaptureIntervalMinutes:
          Math.max(
            1,

            Math.round(
              Number(
                row
                  ?.capture_window_seconds ||
                600
              ) /
              60
            )
          ),

        allowedIntervals: [
          10,
          60,
          120,
          300,
          600,
          900,
        ],

        updatedAt:
          row
            ?.updated_at ||
          null,
      },
    });
  }


  // ====================================================
  // CAPTURE SETTINGS SAVE
  // ====================================================

  if (
    method === 'POST' &&
    pathname ===
      '/api/capture-settings'
  ) {
    const body =
      await parseBody(
        request
      );


    let windowSeconds =
      Math.floor(
        Number(
          body.captureWindowSeconds ||
          body.captureIntervalSeconds ||
          600
        )
      );


    let screenshots =
      Math.floor(
        Number(
          body.screenshotsPerWindow ||
          5
        )
      );


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


    const presetId =
      String(
        body.presetId ||
        'custom'
      );


    const locked =
      body.lockIntervalForEmployees ===
      false
        ? 0
        : 1;


    const updatedAt =
      new Date()
        .toISOString();


    await env.DB
      .prepare(`
        INSERT INTO capture_settings (
          id,
          capture_mode,
          capture_window_seconds,
          screenshots_per_window,
          preset_id,
          lock_interval_for_employees,
          updated_at
        )
        VALUES (1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
          capture_mode = excluded.capture_mode,
          capture_window_seconds = excluded.capture_window_seconds,
          screenshots_per_window = excluded.screenshots_per_window,
          preset_id = excluded.preset_id,
          lock_interval_for_employees = excluded.lock_interval_for_employees,
          updated_at = excluded.updated_at
      `)
      .bind(
        'random_count_window',
        windowSeconds,
        screenshots,
        presetId,
        locked,
        updatedAt
      )
      .run();


    return json({
      success: true,

      settings: {
        captureMode:
          'random_count_window',

        captureWindowSeconds:
          windowSeconds,

        screenshotsPerWindow:
          screenshots,

        presetId,

        lockIntervalForEmployees:
          Boolean(
            locked
          ),

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

        allowedIntervals: [
          10,
          60,
          120,
          300,
          600,
          900,
        ],

        updatedAt,
      },
    });
  }


  // ====================================================
  // SCREENSHOT UPLOAD - KV + D1 INDEX
  // ====================================================

  if (
    method === 'POST' &&
    pathname ===
      '/api/upload-screenshot'
  ) {
    if (!isScreenshotUploadWindowOpen()) {
      return json({
        success: false,
        paused: true,
        error: 'Screenshot sharing is paused outside 08:30 AM–08:30 PM IST.',
      }, 429);
    }

    if (
      !env.SCREENSHOTS
    ) {
      return json(
        {
          success: false,

          screenshotStorageDisabled:
            true,

          error:
            'Screenshot KV binding is missing. Add the SCREENSHOTS KV namespace binding in wrangler.jsonc.',
        },
        501
      );
    }


    const form =
      await request.formData();


    const file =
      form.get(
        'file'
      );


    const employeeId =
      String(
        form.get(
          'employeeId'
        ) ||
        ''
      ).trim();


    const requestedFileName =
      String(
        form.get(
          'fileName'
        ) ||
        ''
      ).trim();


    const requestedDateKey =
      String(
        form.get(
          'dateKey'
        ) ||
        ''
      ).trim();


    if (!employeeId) {
      return json(
        {
          success: false,

          error:
            'employeeId is required.',
        },
        400
      );
    }


    if (
      !(
        file instanceof
        File
      )
    ) {
      return json(
        {
          success: false,

          error:
            'Screenshot file is required.',
        },
        400
      );
    }


    const employee =
      await env.DB
        .prepare(`
          SELECT *
          FROM employees
          WHERE id = ?
          LIMIT 1
        `)
        .bind(
          employeeId
        )
        .first();


    if (!employee) {
      return json(
        {
          success: false,

          error:
            'Employee not found.',
        },
        404
      );
    }


    const stored = await storeScreenshot(
      env,
      employee,
      file,
      requestedFileName,
      requestedDateKey,
      url.origin
    );

    return json({
      success: true,
      ...stored,
    });
  }

  // ====================================================
  // SCREENSHOT BATCH UPLOAD - HOURLY QUEUE
  // ====================================================

  if (
    method === 'POST' &&
    pathname === '/api/upload-screenshot-batch'
  ) {
    if (!isScreenshotUploadWindowOpen()) {
      return json({
        success: false,
        paused: true,
        error: 'Screenshot sharing is paused outside 08:30 AM–08:30 PM IST.',
      }, 429);
    }

    if (!env.SCREENSHOTS) {
      return json({
        success: false,
        screenshotStorageDisabled: true,
        error: 'Screenshot KV binding is missing. Add the SCREENSHOTS KV namespace binding in wrangler.jsonc.',
      }, 501);
    }

    const form = await request.formData();
    const files = form.getAll('files').filter((value) => value instanceof File);
    let metadata = [];

    try {
      const parsed = JSON.parse(String(form.get('metadata') || '[]'));
      metadata = Array.isArray(parsed) ? parsed : [];
    } catch {
      return json({ success: false, error: 'Invalid screenshot batch metadata.' }, 400);
    }

    if (!files.length || !metadata.length || files.length !== metadata.length) {
      return json({
        success: false,
        error: 'Screenshot batch is empty or metadata does not match the file count.',
      }, 400);
    }

    const uploadedIds = [];
    const failed = [];

    for (let index = 0; index < files.length; index += 1) {
      const item = metadata[index] || {};
      const employeeId = String(item.employeeId || '').trim();
      const queueId = String(item.queueId || '').trim();

      if (!employeeId || !queueId) {
        failed.push({ queueId, error: 'employeeId and queueId are required.' });
        continue;
      }

      const employee = await env.DB
        .prepare(`SELECT * FROM employees WHERE id = ? LIMIT 1`)
        .bind(employeeId)
        .first();

      if (!employee) {
        failed.push({ queueId, error: 'Employee not found.' });
        continue;
      }

      try {
        await storeScreenshot(
          env,
          employee,
          files[index],
          String(item.fileName || files[index].name || ''),
          String(item.dateKey || ''),
          url.origin
        );
        uploadedIds.push(queueId);
      } catch (error) {
        failed.push({ queueId, error: error?.message || 'Screenshot upload failed.' });
      }
    }

    return json({
      success: uploadedIds.length > 0 || failed.length === 0,
      uploadedIds,
      uploadedCount: uploadedIds.length,
      failedCount: failed.length,
      failed,
    }, uploadedIds.length || failed.length === 0 ? 200 : 500);
  }


  // ====================================================
  // SCREENSHOT BINARY FILE
  // ====================================================

  if (
    method === 'GET' &&
    pathname ===
      '/api/screenshot-file'
  ) {
    if (
      !env.SCREENSHOTS
    ) {
      return new Response(
        'Screenshot storage is disabled.',
        {
          status: 404,
        }
      );
    }


    const key =
      url.searchParams.get(
        'key'
      );


    if (!key) {
      return new Response(
        'Missing screenshot key.',
        {
          status: 400,
        }
      );
    }


    const result =
      await env.SCREENSHOTS
        .getWithMetadata(
          key,
          'arrayBuffer'
        );


    if (!result.value) {
      return new Response(
        'Screenshot not found.',
        {
          status: 404,
        }
      );
    }


    return new Response(
      result.value,
      {
        status: 200,

        headers: {
          'Content-Type':
            result.metadata
              ?.contentType ||
            'image/webp',

          'Cache-Control':
            'private, max-age=300',

          'Access-Control-Allow-Origin':
            '*',
        },
      }
    );
  }


  // ====================================================
  // SCREENSHOT LIST - D1
  // ====================================================

  const screenshotsMatch =
    pathname.match(
      /^\/api\/screenshots\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/
    );


  if (
    method === 'GET' &&
    screenshotsMatch
  ) {
    const employeeId =
      decodeURIComponent(
        screenshotsMatch[1]
      );


    const dateKey =
      screenshotsMatch[2];


    const employee =
      await env.DB
        .prepare(`
          SELECT *
          FROM employees
          WHERE id = ?
          LIMIT 1
        `)
        .bind(
          employeeId
        )
        .first();


    if (!employee) {
      return json(
        {
          success: false,

          error:
            'Employee not found.',
        },
        404
      );
    }


    const result =
      await env.DB
        .prepare(`
          SELECT *
          FROM screenshot_index
          WHERE employee_id = ?
            AND date_key = ?
          ORDER BY uploaded_at DESC
        `)
        .bind(
          employeeId,
          dateKey
        )
        .all();


    const items =
      (
        result.results ||
        []
      )
        .map(
          (row) => ({
            fileName:
              row.file_name,

            filePath:
              row.storage_key,

            employeeId,

            employeeName:
              employee.name,

            email:
              employee.email,

            monthFolder:
              dateKey.slice(
                0,
                7
              ),

            dateKey,

            localUrl:
              `${url.origin}/api/screenshot-file?key=${encodeURIComponent(
                row.storage_key
              )}`,

            uploadedAt:
              row.uploaded_at,
          })
        );


    return json({
      success: true,

      employeeId,

      employeeName:
        employee.name,

      email:
        employee.email,

      monthFolder:
        dateKey.slice(
          0,
          7
        ),

      dateKey,

      screenshotCount:
        items.length,

      files:
        items.map(
          (item) =>
            item.fileName
        ),

      items,
    });
  }


  // ====================================================
  // DELETE SCREENSHOT
  // ====================================================

  if (
    method === 'DELETE' &&
    pathname ===
      '/api/screenshot'
  ) {
    if (
      !env.SCREENSHOTS
    ) {
      return json(
        {
          success: false,

          error:
            'Screenshot storage is disabled.',
        },
        501
      );
    }


    const body =
      await parseBody(
        request
      );


    const filePath =
      String(
        body.filePath ||
        body.fileId ||
        ''
      ).trim();


    if (!filePath) {
      return json(
        {
          success: false,

          error:
            'filePath is required.',
        },
        400
      );
    }


    await env.SCREENSHOTS.delete(
      filePath
    );


    await env.DB
      .prepare(`
        DELETE FROM screenshot_index
        WHERE storage_key = ?
      `)
      .bind(
        filePath
      )
      .run();


    return json({
      success: true,

      message:
        'Screenshot deleted.',
    });
  }


  // ====================================================
  // API NOT FOUND
  // ====================================================

  return json(
    {
      success: false,

      error:
        `API endpoint not found: ${method} ${pathname}`,
    },
    404
  );
}


// ====================================================
// WORKER
// ====================================================

export default {
  async fetch(
    request,
    env
  ) {
    const url =
      new URL(
        request.url
      );


    if (
      url.pathname.startsWith(
        '/api/'
      )
    ) {
      try {
        return await handleApi(
          request,
          env
        );

      } catch (
        error
      ) {
        console.error(
          'Worker API error:',
          error
        );


        return json(
          {
            success: false,

            error:
              error
                ?.message ||
              'Internal server error.',
          },
          500
        );
      }
    }


    return env.ASSETS.fetch(
      request
    );
  },
};
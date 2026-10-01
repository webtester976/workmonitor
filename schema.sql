CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  approved INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS pending_signups (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS tracker_time (
  employee_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  employee_name TEXT,
  total_seconds INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (employee_id, date_key)
);

CREATE TABLE IF NOT EXISTS capture_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  capture_mode TEXT NOT NULL DEFAULT 'random_count_window',
  capture_window_seconds INTEGER NOT NULL DEFAULT 600,
  screenshots_per_window INTEGER NOT NULL DEFAULT 5,
  preset_id TEXT NOT NULL DEFAULT '10m-5',
  lock_interval_for_employees INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO capture_settings (
  id,
  capture_mode,
  capture_window_seconds,
  screenshots_per_window,
  preset_id,
  lock_interval_for_employees,
  updated_at
)
VALUES (
  1,
  'random_count_window',
  600,
  5,
  '10m-5',
  1,
  datetime('now')
);
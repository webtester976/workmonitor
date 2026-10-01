import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import {
  stdin as input,
  stdout as output,
} from 'node:process';

const ITERATIONS = 100000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

const rl = readline.createInterface({
  input,
  output,
});

const normalizeEmail = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const escapeSql = (value) =>
  String(value ?? '')
    .replace(/'/g, "''");

const hashPassword = (
  password,
  salt
) =>
  crypto
    .pbkdf2Sync(
      password,
      salt,
      ITERATIONS,
      KEY_LENGTH,
      DIGEST
    )
    .toString('hex');

try {
  console.log('');
  console.log('==========================================');
  console.log('🔐 WorkMonitor Secure Admin Creator');
  console.log('==========================================');
  console.log('');

  const name = String(
    await rl.question('Admin name: ')
  ).trim();

  const email = normalizeEmail(
    await rl.question('Admin email: ')
  );

  const password = String(
    await rl.question('Admin password: ')
  );

  const confirmPassword = String(
    await rl.question('Confirm password: ')
  );

  if (!name || !email || !password) {
    throw new Error(
      'Name, email and password are required.'
    );
  }

  if (password !== confirmPassword) {
    throw new Error(
      'Passwords do not match.'
    );
  }

  if (password.length < 8) {
    throw new Error(
      'Password must be at least 8 characters.'
    );
  }

  const id =
    `admin-${Date.now()}-${crypto
      .randomUUID()
      .slice(0, 8)}`;

  const salt =
    crypto
      .randomBytes(16)
      .toString('hex');

  const passwordHash =
    hashPassword(
      password,
      salt
    );

  const createdAt =
    new Date().toISOString();

  const sql = `
INSERT INTO admins (
  id,
  name,
  email,
  password_hash,
  password_salt,
  iterations,
  active,
  created_at,
  last_login_at
)
VALUES (
  '${escapeSql(id)}',
  '${escapeSql(name)}',
  '${escapeSql(email)}',
  '${escapeSql(passwordHash)}',
  '${escapeSql(salt)}',
  ${ITERATIONS},
  1,
  '${escapeSql(createdAt)}',
  NULL
)
ON CONFLICT(email)
DO UPDATE SET
  name = excluded.name,
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt,
  iterations = excluded.iterations,
  active = 1;
`;

  const sqlFile =
    path.join(
      process.cwd(),
      'create-admin.sql'
    );

  fs.writeFileSync(
    sqlFile,
    sql,
    'utf8'
  );

  console.log('');
  console.log(
    '✅ Secure SQL file created successfully.'
  );

  console.log(
    `📧 Admin: ${email}`
  );

  console.log(
    '🔒 Plain password is NOT written into the SQL file.'
  );

  console.log('');
  console.log(
    'Now run this command:'
  );

  console.log('');
  console.log(
    'npx wrangler d1 execute codesdot-workmonitor-db --remote --file=./create-admin.sql'
  );

  console.log('');

} catch (error) {
  console.error('');
  console.error(
    '❌',
    error?.message || error
  );
} finally {
  rl.close();
}
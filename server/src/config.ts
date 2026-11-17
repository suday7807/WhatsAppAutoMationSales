import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PORT = Number(process.env.PORT ?? 4000);
export const HOST = process.env.HOST ?? '127.0.0.1';
export const TZ = process.env.APP_TZ ?? 'Asia/Kolkata';
// Optional: use an installed Chrome/Edge instead of puppeteer's bundled one.
export const CHROME_PATH = process.env.CHROME_PATH || undefined;

// Kept outside OneDrive on purpose: syncing locks the Chrome session + SQLite files.
export const DATA_DIR = process.env.DATA_DIR ?? path.join(os.homedir(), '.wa-sales-data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const SESSION_DIR = path.resolve(process.env.WA_SESSION_DIR ?? path.join(DATA_DIR, 'wa-session'));
export const DB_PATH = path.join(DATA_DIR, 'db.sqlite');

for (const dir of [DATA_DIR, UPLOAD_DIR, SESSION_DIR]) fs.mkdirSync(dir, { recursive: true });

// Chrome's WhatsApp database files sit ~130 characters deep inside the session folder. On Windows a
// long session path breaks them (WhatsApp shows "A database error occurred… relink your device").
if (process.platform === 'win32' && SESSION_DIR.length > 90) {
  console.warn(
    `\n  WARNING: the WhatsApp session folder path is long (${SESSION_DIR.length} characters):\n  ${SESSION_DIR}\n` +
      '  WhatsApp Web may fail to log in. Use a shorter folder, e.g. set WA_SESSION_DIR=C:\\wa-session\n',
  );
}

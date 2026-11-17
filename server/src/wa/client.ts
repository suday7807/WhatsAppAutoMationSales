import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import pkg from 'whatsapp-web.js';
import type { Client as WAClient, Message } from 'whatsapp-web.js';
import { CHROME_PATH, SESSION_DIR } from '../config.js';
import { toWaDigits } from '../engine/phone.js';

const { Client, LocalAuth, MessageMedia } = pkg;

export type WaState = 'disconnected' | 'initializing' | 'qr' | 'authenticated' | 'ready';

export interface WaStatus {
  state: WaState;
  qr: string | null; // data URL
  me: { phone: string; name: string } | null;
  error: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Kills Chrome/Edge processes still using our session folder (left behind when the app was
 * force-closed) and waits for them to exit, so the profile lock is free. Returns how many it killed.
 */
function killOrphanBrowsers(): number {
  try {
    if (process.platform === 'win32') {
      const needle = SESSION_DIR.replace(/\//g, '\\').toLowerCase().replace(/'/g, "''");
      const ps =
        `$p = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe' OR Name='chrome-headless-shell.exe'" | ` +
        `Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/', '\\').ToLower().Contains('${needle}') }); ` +
        `foreach ($x in $p) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue }; ` +
        `foreach ($x in $p) { Wait-Process -Id $x.ProcessId -Timeout 5 -ErrorAction SilentlyContinue }; ` +
        `Write-Output $p.Count`;
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 30000 });
      return Number(out.trim()) || 0;
    }
    execFileSync('pkill', ['-f', SESSION_DIR], { stdio: 'ignore' });
    return 1;
  } catch {
    return 0; // nothing to kill
  }
}

function removeSessionDir() {
  try {
    fs.rmSync(path.join(SESSION_DIR, 'session'), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (e) {
    console.error('[wa] could not delete old session:', (e as Error).message);
  }
}

/**
 * Wraps one whatsapp-web.js client (one WhatsApp number).
 * Events: 'status' (WaStatus), 'ack' (waId, ack), 'incoming' (Message)
 */
class WaManager extends EventEmitter {
  private client: WAClient | null = null;
  private status: WaStatus = { state: 'disconnected', qr: null, me: null, error: null };

  getStatus(): WaStatus {
    return { ...this.status };
  }

  isReady() {
    return this.status.state === 'ready' && this.client !== null;
  }

  hasSavedSession() {
    return fs.existsSync(path.join(SESSION_DIR, 'session'));
  }

  private setStatus(patch: Partial<WaStatus>) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.getStatus());
  }

  private connecting = false;

  async connect() {
    if (this.client || this.connecting) return;
    this.connecting = true;
    this.setStatus({ state: 'initializing', qr: null, error: null });
    try {
      // A Chrome left over from a crash/force-close keeps the session locked; close it first.
      if (killOrphanBrowsers() > 0) {
        console.log('[wa] closed a leftover Chrome that was holding the WhatsApp session');
        await sleep(1500);
      }
    } finally {
      this.connecting = false;
    }

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
      puppeteer: {
        headless: true,
        executablePath: CHROME_PATH,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          // whatsapp-web.js polls the page with requestAnimationFrame; if Chrome throttles a
          // background/headless page those polls stop and startup fails with "auth timeout"
          // (wwebjs issue #201940). Keep rendering and timers running.
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
        ],
      },
    });
    this.client = client;

    client.on('qr', async (qr: string) => {
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
      this.setStatus({ state: 'qr', qr: dataUrl });
    });
    client.on('authenticated', () => {
      this.setStatus({ state: 'authenticated', qr: null });
      this.armReadyWatchdog(client);
    });
    client.on('auth_failure', (msg: string) => {
      this.setStatus({ error: `Login failed: ${msg}` });
      void this.teardown('disconnected');
    });
    client.on('ready', () => {
      this.clearReadyWatchdog();
      this.readyRetries = 0;
      const info = client.info;
      this.setStatus({
        state: 'ready',
        qr: null,
        error: null,
        me: info ? { phone: '+' + info.wid.user, name: info.pushname ?? '' } : null,
      });
    });
    client.on('disconnected', (reason: string) => {
      if (this.client !== client) return;
      if (reason === 'LOGOUT') {
        // The library tries to wipe the session while Chrome still holds it open, which fails on
        // Windows (EBUSY). Do a clean restart ourselves instead: close Chrome, wipe, new QR.
        const wasReady = this.status.state === 'ready';
        this.setStatus({
          state: 'initializing',
          qr: null,
          me: null,
          error: wasReady ? 'This device was logged out from the phone. Scan the new QR code to link again.' : null,
        });
        void this.restartFresh();
        return;
      }
      // Any other reason: the library destroys the client on its own; just drop our reference.
      this.setStatus({ error: `Disconnected: ${reason}` });
      void this.teardown('disconnected');
    });
    client.on('message_ack', (msg: Message, ack: number) => {
      this.emit('ack', msg.id._serialized, ack);
    });
    client.on('message', (msg: Message) => {
      this.emit('incoming', msg);
    });

    try {
      await client.initialize();
    } catch (e) {
      if (this.client !== client) return; // superseded by a restart
      console.error('[wa] initialize failed:', e);
      const reason = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
      this.setStatus({ error: `Could not start WhatsApp: ${reason || 'unknown error (see terminal)'}` });
      await this.teardown('disconnected');
    }
  }

  private restarts: number[] = [];

  /** Closes the browser, deletes the saved session and starts again with a new QR code. */
  private async restartFresh() {
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < 5 * 60_000);
    this.restarts.push(now);
    await this.teardown('initializing');
    killOrphanBrowsers();
    removeSessionDir();
    if (this.restarts.length > 3) {
      this.setStatus({ state: 'disconnected', error: 'WhatsApp keeps logging out. Wait a few minutes, then click Connect again.' });
      return;
    }
    await sleep(1500);
    await this.connect();
  }

  private readyTimer: NodeJS.Timeout | null = null;
  private readyRetries = 0;

  private clearReadyWatchdog() {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }

  /**
   * whatsapp-web.js sometimes logs in ("authenticated") but never fires "ready" (wwebjs issue
   * #201946). If that happens, restart the browser with the same saved session (no new QR).
   */
  private armReadyWatchdog(client: WAClient) {
    this.clearReadyWatchdog();
    this.readyTimer = setTimeout(async () => {
      if (this.client !== client || this.status.state === 'ready') return;
      this.readyRetries++;
      if (this.readyRetries > 3) {
        this.readyRetries = 0;
        await this.teardown('disconnected');
        this.setStatus({
          error: 'WhatsApp logged in but never finished loading. Open WhatsApp on your phone, check its internet, then click Connect again.',
        });
        return;
      }
      console.log(`[wa] logged in but not ready after 2 min, restarting browser (attempt ${this.readyRetries}/3)`);
      await this.teardown('initializing');
      killOrphanBrowsers();
      await sleep(2000);
      await this.connect();
    }, 120_000);
  }

  private async teardown(state: WaState) {
    this.clearReadyWatchdog();
    const c = this.client;
    this.client = null;
    this.setStatus({ state, qr: null, me: state === 'disconnected' ? null : this.status.me });
    if (c) {
      try {
        await c.destroy();
      } catch {
        /* browser may already be gone */
      }
    }
  }

  /** Unlinks the device (next connect needs a fresh QR scan). */
  async logout() {
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        /* ignore */
      }
    }
    await this.teardown('disconnected');
    killOrphanBrowsers();
    removeSessionDir();
  }

  /** Closes the browser but keeps the session (used on shutdown). */
  async shutdown() {
    await this.teardown('disconnected');
  }

  private requireClient(): WAClient {
    if (!this.client || !this.isReady()) throw new Error('WhatsApp is not connected');
    return this.client;
  }

  /** Returns the WhatsApp chat id for a phone, or null if the number is not on WhatsApp. */
  async resolveChatId(phoneE164: string): Promise<string | null> {
    const wid = await this.requireClient().getNumberId(toWaDigits(phoneE164));
    return wid ? wid._serialized : null;
  }

  /** Shows "typing…" for a moment, then sends the text. Returns the WhatsApp message id. */
  async sendText(chatId: string, text: string, typingMs = 0): Promise<string> {
    const client = this.requireClient();
    if (typingMs > 0) {
      try {
        const chat = await client.getChatById(chatId);
        await chat.sendStateTyping();
        await sleep(typingMs);
        await chat.clearState();
      } catch {
        /* typing indicator is cosmetic */
      }
    }
    const msg = await client.sendMessage(chatId, text, { linkPreview: true });
    return msg.id._serialized;
  }

  async sendImage(chatId: string, filePath: string, caption?: string): Promise<string> {
    const client = this.requireClient();
    const media = MessageMedia.fromFilePath(filePath);
    const msg = await client.sendMessage(chatId, media, caption ? { caption } : {});
    return msg.id._serialized;
  }

  /** Best-effort phone number for an incoming message sender (handles @c.us and @lid ids). */
  async senderPhone(msg: Message): Promise<string | null> {
    if (msg.from.endsWith('@c.us')) return '+' + msg.from.split('@')[0];
    try {
      const contact = await msg.getContact();
      if (contact?.number) return '+' + contact.number.replace(/\D/g, '');
    } catch {
      /* ignore */
    }
    return null;
  }
}

export const wa = new WaManager();

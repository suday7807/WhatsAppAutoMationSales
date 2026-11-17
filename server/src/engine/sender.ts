import { TZ } from '../config.js';
import { all, get, getSetting, run, setSetting } from '../db/db.js';
import { notifyCampaign, notifyStats } from '../events.js';
import { wa } from '../wa/client.js';
import {
  type CampaignRow,
  type RecipientRow,
  getCampaign,
  getKit,
  kitImagePaths,
  parseJsonArray,
} from './campaignRow.js';
import { pickVariation, renderTemplate } from './spintax.js';
import { isWithinWindow, nextWindowOpen, startOfDay } from './window.js';

const TICK_MS = 3000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randInt = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));

export const DEFAULT_GLOBAL_CAP = 40;
export const globalDailyCap = () => Number(getSetting('global_daily_cap', String(DEFAULT_GLOBAL_CAP)));
const globalNextSendAt = () => Number(getSetting('global_next_send_at', '0'));

export function sentToday(campaignId?: number): number {
  const since = startOfDay(Date.now(), TZ);
  const row =
    campaignId == null
      ? get<{ n: number }>('SELECT COUNT(*) n FROM recipients WHERE sent_at >= ?', since)
      : get<{ n: number }>('SELECT COUNT(*) n FROM recipients WHERE sent_at >= ? AND campaign_id = ?', since, campaignId);
  return row?.n ?? 0;
}

const isOptedOut = (phone: string) => !!get('SELECT 1 FROM optouts WHERE phone = ?', phone);

export type WaitReason =
  | 'not_running'
  | 'whatsapp_disconnected'
  | 'outside_window'
  | 'daily_limit'
  | 'global_daily_limit'
  | 'gap'
  | 'ready';

/** Why a running campaign is (not) sending right now, and when it will next try. */
export function campaignWaitInfo(c: CampaignRow, now = Date.now()): { reason: WaitReason; until: number | null } {
  if (c.status !== 'running') return { reason: 'not_running', until: null };
  if (!wa.isReady()) return { reason: 'whatsapp_disconnected', until: null };
  const win = { start_time: c.start_time, stop_time: c.stop_time, days: parseJsonArray<number>(c.days), start_date: c.start_date };
  if (!isWithinWindow(now, win, TZ)) return { reason: 'outside_window', until: nextWindowOpen(now, win, TZ) };
  const tomorrow = startOfDay(now, TZ) + 24 * 3600 * 1000 + 60 * 1000;
  if (sentToday() >= globalDailyCap()) return { reason: 'global_daily_limit', until: nextWindowOpen(tomorrow, win, TZ) };
  if (sentToday(c.id) >= c.max_per_day) return { reason: 'daily_limit', until: nextWindowOpen(tomorrow, win, TZ) };
  const next = Math.max(c.next_send_at, globalNextSendAt());
  if (next > now) return { reason: 'gap', until: next };
  return { reason: 'ready', until: now };
}

function scheduleNext(c: CampaignRow, countedSend: boolean, overrideMs?: number) {
  const now = Date.now();
  let delay: number;
  let sinceBreak = c.sent_since_break;
  if (overrideMs != null) {
    delay = overrideMs;
  } else {
    delay = randInt(c.min_gap_s, c.max_gap_s) * 1000;
    if (countedSend) {
      sinceBreak += 1;
      if (c.break_every > 0 && sinceBreak >= c.break_every) {
        delay += c.break_len_s * 1000;
        sinceBreak = 0;
      }
    }
  }
  const next = now + delay;
  run('UPDATE campaigns SET next_send_at = ?, sent_since_break = ? WHERE id = ?', next, sinceBreak, c.id);
  // One WhatsApp number = one pace, shared by every running campaign.
  setSetting('global_next_send_at', Math.max(next, globalNextSendAt()));
}

function finishIfDone(c: CampaignRow) {
  const left = get<{ n: number }>(
    "SELECT COUNT(*) n FROM recipients WHERE campaign_id = ? AND status IN ('pending','sending')",
    c.id,
  );
  if ((left?.n ?? 0) === 0) {
    run("UPDATE campaigns SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'running'", Date.now(), c.id);
    notifyCampaign(c.id);
    return true;
  }
  return false;
}

function setRecipient(id: number, fields: Partial<RecipientRow>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  run(
    `UPDATE recipients SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    ...keys.map((k) => (fields as any)[k]),
    id,
  );
}

class Sender {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Runs a single tick immediately (used by tests). */
  async runOnce() {
    await this.tick();
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.step();
    } catch (e) {
      console.error('[sender] tick error:', e);
    } finally {
      this.busy = false;
    }
  }

  private async step() {
    if (!wa.isReady()) return;
    const now = Date.now();
    if (globalNextSendAt() > now) return;

    const running = all<CampaignRow>("SELECT * FROM campaigns WHERE status = 'running' ORDER BY next_send_at ASC, id ASC");
    for (const c of running) {
      if (campaignWaitInfo(c, now).reason !== 'ready') continue;

      const r = get<RecipientRow>(
        `SELECT * FROM recipients WHERE campaign_id = ? AND status IN ('sending','pending')
         ORDER BY CASE status WHEN 'sending' THEN 0 ELSE 1 END, position ASC LIMIT 1`,
        c.id,
      );
      if (!r) {
        finishIfDone(c);
        continue;
      }
      await this.process(c, r);
      return; // at most one recipient per tick
    }
  }

  private async process(c: CampaignRow, r: RecipientRow) {
    // Skip checks (cheap, no WhatsApp traffic).
    if (r.parts_done === 0) {
      if (isOptedOut(r.phone)) {
        setRecipient(r.id, { status: 'skipped_optout' });
        notifyCampaign(c.id);
        return;
      }
      if (
        c.dedupe === 'skip_ever_messaged' &&
        get('SELECT 1 FROM recipients WHERE phone = ? AND id != ? AND sent_at IS NOT NULL', r.phone, r.id)
      ) {
        setRecipient(r.id, { status: 'skipped_duplicate' });
        notifyCampaign(c.id);
        return;
      }
    }

    const kit = getKit(c.demo_kit_id);
    setRecipient(r.id, { status: 'sending', started_at: r.started_at ?? Date.now() });

    try {
      // 1. Is the number on WhatsApp?
      let chatId = r.chat_id;
      if (!chatId) {
        chatId = await wa.resolveChatId(r.phone);
        if (!chatId) {
          setRecipient(r.id, { status: 'not_on_wa' });
          scheduleNext(c, false, randInt(5, 15) * 1000);
          notifyCampaign(c.id);
          finishIfDone(c);
          return;
        }
        setRecipient(r.id, { chat_id: chatId });
      }

      // 2. Render texts once and store them, so a resume sends exactly the same words.
      let intro = r.intro_text;
      let linkText = r.link_text;
      if (intro == null) {
        const intros = parseJsonArray<string>(c.intro_variations);
        const links = parseJsonArray<string>(c.link_variations);
        const idx = pickVariation(intros.length, c.rotation, c.rotation_cursor);
        const vars = { name: r.name, business: r.business, city: r.city, category: r.category ?? kit?.category, link: kit?.demo_url };
        intro = idx >= 0 ? renderTemplate(intros[idx], vars) : '';
        if (c.message_mode === 'combined') {
          // The full message (intro + pitch + {{link}}) is one text; no separate link message.
          linkText = '';
        } else {
          const linkTpl = links.length ? links[Math.floor(Math.random() * links.length)] : kit ? '{{link}}' : '';
          linkText = linkTpl ? renderTemplate(linkTpl, vars) : '';
        }
        setRecipient(r.id, { intro_text: intro, link_text: linkText, variation_idx: idx });
        run('UPDATE campaigns SET rotation_cursor = rotation_cursor + 1 WHERE id = ?', c.id);
      }

      // 3. Build the part list. Separate: intro → link → image 1 → image 2. Combined: full text → image 1 → image 2.
      const parts: { part: string; send: () => Promise<string> }[] = [];
      // Longer texts "type" a bit longer so it looks natural.
      const typing = Math.min(9000, randInt(2000, 4000) + (intro?.length ?? 0) * 10);
      if (intro) parts.push({ part: 'intro', send: () => wa.sendText(chatId!, intro!, typing) });
      if (linkText) parts.push({ part: 'link', send: () => wa.sendText(chatId!, linkText!, randInt(1500, 3500)) });
      if (c.send_images) {
        kitImagePaths(kit).forEach((p, i) => parts.push({ part: `img${i + 1}`, send: () => wa.sendImage(chatId!, p) }));
      }

      for (let i = r.parts_done; i < parts.length; i++) {
        if (i > 0) await sleep(randInt(c.part_gap_min_s, c.part_gap_max_s) * 1000);
        const fresh = getCampaign(c.id);
        if (!fresh || fresh.status !== 'running' || !wa.isReady()) return; // paused/stopped/disconnected: resume later

        const waId = await parts[i].send();
        const now = Date.now();
        run('INSERT OR IGNORE INTO wa_messages (recipient_id, part, wa_id, ack, sent_at) VALUES (?, ?, ?, 1, ?)', r.id, parts[i].part, waId, now);
        setRecipient(r.id, i === 0 && !r.sent_at ? { parts_done: i + 1, sent_at: now } : { parts_done: i + 1 });
        notifyCampaign(c.id);
      }

      setRecipient(r.id, { status: 'sent', error: null });
      scheduleNext(c, true);
    } catch (e) {
      if (!wa.isReady()) return; // connection dropped mid-send; the recipient stays 'sending' and resumes
      const msg = (e as Error).message ?? String(e);
      console.error(`[sender] ${r.phone} failed:`, msg);
      setRecipient(r.id, { status: 'failed', error: msg.slice(0, 500) });
      scheduleNext(c, true);
    } finally {
      notifyCampaign(c.id);
      notifyStats();
      const latest = getCampaign(c.id);
      if (latest) finishIfDone(latest);
    }
  }
}

export const sender = new Sender();

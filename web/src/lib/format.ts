import type { Campaign, WaitReason } from './api';

const TZ = 'Asia/Kolkata';

export function fmtDateTime(ts: number | null | undefined) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function fmtDate(ts: number | null | undefined) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtClock(ts: number) {
  return new Date(ts).toLocaleString('en-IN', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** 45 → "45 sec", 420 → "7 min", 5400 → "1 hr 30 min" */
export function fmtDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m} min ${rem} sec` : `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h} hr ${mm} min` : `${h} hr`;
}

export function fmtIn(ts: number, now = Date.now()) {
  const diff = Math.round((ts - now) / 1000);
  if (diff <= 0) return 'now';
  if (diff < 24 * 3600) return `in ${fmtDuration(diff)}`;
  return `on ${fmtClock(ts)}`;
}

export const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '0%');

/** "14:30" → "2:30 PM" */
export function fmtHHMM(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap}`;
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function waitText(c: Pick<Campaign, 'status' | 'wait'>, now = Date.now()): string {
  const { reason, until } = c.wait;
  const map: Record<WaitReason, string> = {
    not_running: '',
    whatsapp_disconnected: 'Waiting for WhatsApp to connect',
    outside_window: until ? `Outside sending hours, resumes ${fmtIn(until, now)}` : 'Outside sending hours',
    daily_limit: until ? `Daily limit reached, resumes ${fmtIn(until, now)}` : 'Daily limit reached',
    global_daily_limit: until ? `Overall daily cap reached, resumes ${fmtIn(until, now)}` : 'Overall daily cap reached',
    gap: until ? `Next message ${fmtIn(until, now)}` : 'Waiting',
    ready: 'Sending…',
  };
  return map[reason];
}

export const RECIPIENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'gray' },
  sending: { label: 'Sending', tone: 'blue' },
  sent: { label: 'Sent', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  not_on_wa: { label: 'Not on WhatsApp', tone: 'amber' },
  skipped_optout: { label: 'Opted out', tone: 'gray' },
  skipped_duplicate: { label: 'Already messaged', tone: 'gray' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
};

export const CAMPAIGN_STATUS: Record<Campaign['status'], { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'gray' },
  running: { label: 'Running', tone: 'green' },
  paused: { label: 'Paused', tone: 'amber' },
  completed: { label: 'Completed', tone: 'blue' },
  stopped: { label: 'Stopped', tone: 'red' },
};

export type Tone = 'gray' | 'green' | 'red' | 'amber' | 'blue';

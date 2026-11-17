export interface ScheduleWindow {
  start_time: string; // HH:MM
  stop_time: string; // HH:MM
  days: number[]; // 0=Sun .. 6=Sat
  start_date?: string | null; // YYYY-MM-DD
}

export interface ZonedParts {
  date: string; // YYYY-MM-DD
  minutes: number; // minutes since local midnight
  dow: number; // 0=Sun
  hour: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(ts: number, tz: string): ZonedParts & { second: number } {
  const p: Record<string, string> = {};
  for (const part of fmt(tz).formatToParts(new Date(ts))) p[part.type] = part.value;
  const hour = Number(p.hour) % 24;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour,
    minutes: hour * 60 + Number(p.minute),
    second: Number(p.second),
    dow: DOW[p.weekday] ?? 0,
  };
}

/** Offset of tz from UTC in seconds at ts (IST → 19800). Used for date grouping in SQL. */
export function tzOffsetSeconds(ts: number, tz: string): number {
  const z = zonedParts(ts, tz);
  const [y, m, d] = z.date.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, z.hour, z.minutes % 60, z.second);
  return Math.round((asUtc - (ts - (ts % 1000))) / 1000);
}

/** Epoch ms of local midnight for the day containing ts. */
export function startOfDay(ts: number, tz: string): number {
  const z = zonedParts(ts, tz);
  return ts - (z.minutes * 60 + z.second) * 1000 - (ts % 1000);
}

export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Invalid time "${s}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid time "${s}"`);
  return h * 60 + min;
}

function prevDate(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Is `ts` inside the campaign's allowed sending window? Handles overnight windows (e.g. 22:00 → 02:00). */
export function isWithinWindow(ts: number, w: ScheduleWindow, tz: string): boolean {
  const z = zonedParts(ts, tz);
  const start = parseHHMM(w.start_time);
  const stop = parseHHMM(w.stop_time);
  if (start === stop) return false;

  let windowDay = z.dow;
  let windowDate = z.date;
  if (start < stop) {
    if (z.minutes < start || z.minutes >= stop) return false;
  } else {
    // Overnight: after start today, or before stop (belongs to yesterday's window).
    if (z.minutes >= start) {
      // today's window
    } else if (z.minutes < stop) {
      windowDay = (z.dow + 6) % 7;
      windowDate = prevDate(z.date);
    } else {
      return false;
    }
  }
  if (!w.days.includes(windowDay)) return false;
  if (w.start_date && windowDate < w.start_date) return false;
  return true;
}

/** Next moment (≥ ts) the window is open, scanning minute by minute up to ~15 days. Null if never. */
export function nextWindowOpen(ts: number, w: ScheduleWindow, tz: string): number | null {
  if (isWithinWindow(ts, w, tz)) return ts;
  let t = ts - (ts % 60000) + 60000;
  const limit = ts + 15 * 24 * 60 * 60000;
  for (; t <= limit; t += 60000) {
    if (isWithinWindow(t, w, tz)) return t;
  }
  return null;
}

/** Length of the daily window in minutes. */
export function windowMinutes(w: Pick<ScheduleWindow, 'start_time' | 'stop_time'>): number {
  const start = parseHHMM(w.start_time);
  const stop = parseHHMM(w.stop_time);
  return stop > start ? stop - start : stop === start ? 0 : 24 * 60 - start + stop;
}

import { parseHHMM, windowMinutes } from './window.js';

export interface TimingInput {
  min_gap_s: number;
  max_gap_s: number;
  break_every: number;
  break_len_s: number;
  max_per_day: number;
  part_gap_min_s: number;
  part_gap_max_s: number;
  start_time: string;
  stop_time: string;
  days: number[];
}

const fmtDur = (s: number) => (s % 60 === 0 && s >= 60 ? `${s / 60} minute${s === 60 ? '' : 's'}` : `${s} seconds`);

export function validateTiming(t: TimingInput): string[] {
  const errors: string[] = [];
  const nums: [keyof TimingInput, string][] = [
    ['min_gap_s', 'Minimum gap'],
    ['max_gap_s', 'Maximum gap'],
    ['break_every', 'Break after'],
    ['break_len_s', 'Break length'],
    ['max_per_day', 'Maximum per day'],
    ['part_gap_min_s', 'Gap between parts (min)'],
    ['part_gap_max_s', 'Gap between parts (max)'],
  ];
  for (const [k, label] of nums) {
    const v = t[k] as number;
    if (!Number.isFinite(v) || v < 0) errors.push(`${label} must be 0 or more.`);
  }
  if (t.min_gap_s > t.max_gap_s)
    errors.push(
      `The minimum gap (${fmtDur(t.min_gap_s)}) is longer than the maximum gap (${fmtDur(t.max_gap_s)}). Make the maximum bigger or the minimum smaller.`,
    );
  if (t.min_gap_s < 20) errors.push('Minimum gap should be at least 20 seconds, otherwise the number gets flagged fast.');
  if (t.part_gap_min_s > t.part_gap_max_s) errors.push('Gap between parts: minimum is bigger than maximum.');
  if (t.max_per_day < 1) errors.push('Maximum messages per day must be at least 1.');
  if (t.break_every > 0 && t.break_len_s <= 0) errors.push('Break length must be more than 0 when breaks are on.');
  if (!t.days?.length) errors.push('Pick at least one day of the week.');
  try {
    parseHHMM(t.start_time);
    parseHHMM(t.stop_time);
    if (t.start_time === t.stop_time) errors.push('Start and stop time cannot be the same.');
  } catch {
    errors.push('Start/stop time is invalid.');
  }
  return errors;
}

/**
 * Rough throughput: one "cycle" = average gap + time to send all parts of one lead
 * (typing + part gaps) + the break spread across the messages before it.
 */
export function estimateThroughput(t: TimingInput, partsPerLead = 4) {
  const avgGap = (t.min_gap_s + t.max_gap_s) / 2;
  const avgPartGap = (t.part_gap_min_s + t.part_gap_max_s) / 2;
  const sendTime = 3.5 + 2 * partsPerLead + Math.max(0, partsPerLead - 1) * avgPartGap;
  const breakShare = t.break_every > 0 ? t.break_len_s / t.break_every : 0;
  const cycle = Math.max(1, avgGap + sendTime + breakShare);
  const perHour = 3600 / cycle;
  let windowMin = 0;
  try {
    windowMin = windowMinutes(t);
  } catch {
    windowMin = 0;
  }
  const perDayByWindow = Math.floor((perHour * windowMin) / 60);
  const perDay = Math.min(t.max_per_day, perDayByWindow);
  return {
    perHour: Math.round(perHour * 10) / 10,
    perDay,
    limitedBy: perDay === t.max_per_day ? ('daily_cap' as const) : ('window' as const),
    windowHours: Math.round((windowMin / 60) * 10) / 10,
  };
}

/** Approx days needed for `leads` recipients given perDay and allowed weekdays. */
export function estimateDays(leads: number, perDay: number) {
  if (perDay <= 0) return null;
  return Math.ceil(leads / perDay);
}

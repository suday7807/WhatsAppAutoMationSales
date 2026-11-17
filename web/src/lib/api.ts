export class ApiError extends Error {
  constructor(message: string, public status: number, public data: any) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET') };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(`/api${path}`, init);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data);
  return data as T;
}

// ---- Shared types (mirror the server) ----

export interface Counts {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  not_delivered: number;
  failed: number;
  not_on_wa: number;
  skipped: number;
  replied: number;
}

export type WaitReason =
  | 'not_running'
  | 'whatsapp_disconnected'
  | 'outside_window'
  | 'daily_limit'
  | 'global_daily_limit'
  | 'gap'
  | 'ready';

export interface Campaign {
  id: number;
  name: string;
  status: 'draft' | 'running' | 'paused' | 'completed' | 'stopped';
  demo_kit_id: number | null;
  message_mode: 'combined' | 'separate';
  intro_variations: string[];
  link_variations: string[];
  rotation: 'order' | 'random';
  send_images: boolean;
  min_gap_s: number;
  max_gap_s: number;
  break_every: number;
  break_len_s: number;
  max_per_day: number;
  part_gap_min_s: number;
  part_gap_max_s: number;
  start_time: string;
  stop_time: string;
  start_date: string | null;
  days: number[];
  dedupe: 'all' | 'skip_ever_messaged';
  next_send_at: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  counts: Counts;
  wait: { reason: WaitReason; until: number | null };
}

export interface DemoKit {
  id: number;
  category: string;
  demo_url: string;
  image1: string | null;
  image2: string | null;
  campaigns?: number;
}

export interface ContactList {
  id: number;
  name: string;
  size: number;
}

export interface WaStatus {
  state: 'disconnected' | 'initializing' | 'qr' | 'authenticated' | 'ready';
  qr: string | null;
  me: { phone: string; name: string } | null;
  error: string | null;
}

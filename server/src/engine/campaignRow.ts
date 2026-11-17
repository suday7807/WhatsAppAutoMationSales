import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from '../config.js';
import { get } from '../db/db.js';

export interface CampaignRow {
  id: number;
  name: string;
  status: 'draft' | 'running' | 'paused' | 'completed' | 'stopped';
  demo_kit_id: number | null;
  intro_variations: string;
  link_variations: string;
  rotation: 'order' | 'random';
  /** combined = one text (intro + pitch + link) then images; separate = intro, link, images */
  message_mode: 'combined' | 'separate';
  send_images: number;
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
  days: string;
  dedupe: 'all' | 'skip_ever_messaged';
  next_send_at: number;
  sent_since_break: number;
  rotation_cursor: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export interface DemoKitRow {
  id: number;
  category: string;
  demo_url: string;
  image1: string | null;
  image2: string | null;
  created_at: number;
}

export interface RecipientRow {
  id: number;
  campaign_id: number;
  contact_id: number | null;
  phone: string;
  name: string | null;
  business: string | null;
  category: string | null;
  city: string | null;
  position: number;
  status: string;
  chat_id: string | null;
  variation_idx: number | null;
  intro_text: string | null;
  link_text: string | null;
  parts_done: number;
  error: string | null;
  started_at: number | null;
  sent_at: number | null;
  replied_at: number | null;
}

export const parseJsonArray = <T>(s: string | null | undefined): T[] => {
  try {
    const v = JSON.parse(s ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export const getCampaign = (id: number) => get<CampaignRow>('SELECT * FROM campaigns WHERE id = ?', id);
export const getKit = (id: number | null) =>
  id == null ? undefined : get<DemoKitRow>('SELECT * FROM demo_kits WHERE id = ?', id);

/** Absolute paths of the kit's screenshots that actually exist on disk. */
export function kitImagePaths(kit: DemoKitRow | undefined): string[] {
  if (!kit) return [];
  return [kit.image1, kit.image2]
    .filter((f): f is string => !!f)
    .map((f) => path.join(UPLOAD_DIR, f))
    .filter((p) => fs.existsSync(p));
}

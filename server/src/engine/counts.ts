import { all, get } from '../db/db.js';

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

const SELECT = `
  COUNT(*) AS total,
  COALESCE(SUM(r.status IN ('pending','sending')), 0) AS pending,
  COALESCE(SUM(r.sent_at IS NOT NULL), 0) AS sent,
  COALESCE(SUM(m.max_ack >= 2), 0) AS delivered,
  COALESCE(SUM(m.max_ack >= 3), 0) AS read,
  COALESCE(SUM(r.sent_at IS NOT NULL AND COALESCE(m.max_ack, 0) < 2 AND r.status != 'failed'), 0) AS not_delivered,
  COALESCE(SUM(r.status = 'failed'), 0) AS failed,
  COALESCE(SUM(r.status = 'not_on_wa'), 0) AS not_on_wa,
  COALESCE(SUM(r.status IN ('skipped_optout','skipped_duplicate','cancelled')), 0) AS skipped,
  COALESCE(SUM(r.replied_at IS NOT NULL), 0) AS replied`;

const FROM = `
  FROM recipients r
  LEFT JOIN (SELECT recipient_id, MAX(ack) AS max_ack FROM wa_messages GROUP BY recipient_id) m ON m.recipient_id = r.id`;

const ZERO: Counts = {
  total: 0, pending: 0, sent: 0, delivered: 0, read: 0, not_delivered: 0, failed: 0, not_on_wa: 0, skipped: 0, replied: 0,
};

export function countRecipients(where = '', ...params: (string | number)[]): Counts {
  return { ...ZERO, ...(get<Counts>(`SELECT ${SELECT} ${FROM} ${where}`, ...params) ?? {}) };
}

export function countsByCampaign(): Map<number, Counts> {
  const rows = all<Counts & { campaign_id: number }>(`SELECT r.campaign_id, ${SELECT} ${FROM} GROUP BY r.campaign_id`);
  return new Map(rows.map((r) => [r.campaign_id, { ...ZERO, ...r }]));
}

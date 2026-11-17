import type { Message } from 'whatsapp-web.js';
import { get, run, tx } from '../db/db.js';
import { notifyCampaign, notifyStats } from '../events.js';
import { wa } from '../wa/client.js';
import { isOptOutText } from './optout.js';

/** Adds an opt-out and cancels that number's queued sends in every campaign. */
export function addOptOut(phone: string, reason: 'stop' | 'manual', note?: string | null) {
  const affected: number[] = [];
  tx(() => {
    run(
      'INSERT INTO optouts (phone, reason, note, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(phone) DO NOTHING',
      phone, reason, note ?? null, Date.now(),
    );
    const rows = get<{ ids: string | null }>(
      "SELECT GROUP_CONCAT(DISTINCT campaign_id) ids FROM recipients WHERE phone = ? AND status = 'pending'",
      phone,
    );
    run("UPDATE recipients SET status = 'skipped_optout' WHERE phone = ? AND status = 'pending'", phone);
    for (const id of rows?.ids?.split(',') ?? []) affected.push(Number(id));
  });
  affected.forEach(notifyCampaign);
  notifyStats();
}

export async function handleIncoming(msg: Message) {
  if (msg.fromMe) return;
  if (msg.from === 'status@broadcast' || msg.from.endsWith('@g.us') || msg.from.endsWith('@newsletter')) return;

  // Match by chat id first (works for @lid senders), then by phone.
  let recipient = get<{ id: number; campaign_id: number; phone: string; replied_at: number | null }>(
    'SELECT id, campaign_id, phone, replied_at FROM recipients WHERE chat_id = ? AND sent_at IS NOT NULL ORDER BY sent_at DESC LIMIT 1',
    msg.from,
  );
  let phone = recipient?.phone ?? null;
  if (!recipient) {
    phone = await wa.senderPhone(msg);
    if (phone) {
      recipient = get(
        'SELECT id, campaign_id, phone, replied_at FROM recipients WHERE phone = ? AND sent_at IS NOT NULL ORDER BY sent_at DESC LIMIT 1',
        phone,
      );
    }
  }
  if (!recipient || !phone) return; // not someone we messaged: ignore

  const body = msg.body || (msg.hasMedia ? `[${msg.type}]` : '');
  const optout = isOptOutText(msg.body);
  const now = Date.now();
  run(
    'INSERT OR IGNORE INTO replies (phone, recipient_id, campaign_id, body, wa_id, is_optout, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    phone, recipient.id, recipient.campaign_id, body, msg.id._serialized, optout, now,
  );
  if (!recipient.replied_at) run('UPDATE recipients SET replied_at = ? WHERE id = ?', now, recipient.id);
  if (optout) addOptOut(phone, 'stop', body.slice(0, 200));

  notifyCampaign(recipient.campaign_id);
  notifyStats();
}

export function handleAck(waId: string, ack: number) {
  const now = Date.now();
  const row = get<{ id: number; recipient_id: number; ack: number }>('SELECT id, recipient_id, ack FROM wa_messages WHERE wa_id = ?', waId);
  if (!row) return;
  if (ack < 0) {
    run('UPDATE wa_messages SET ack = -1 WHERE id = ?', row.id);
  } else if (ack > row.ack) {
    run(
      `UPDATE wa_messages SET ack = ?,
         delivered_at = CASE WHEN ? >= 2 AND delivered_at IS NULL THEN ? ELSE delivered_at END,
         read_at      = CASE WHEN ? >= 3 AND read_at IS NULL THEN ? ELSE read_at END
       WHERE id = ?`,
      ack, ack, now, ack, now, row.id,
    );
  } else {
    return;
  }
  const r = get<{ campaign_id: number }>('SELECT campaign_id FROM recipients WHERE id = ?', row.recipient_id);
  if (r) notifyCampaign(r.campaign_id);
  notifyStats();
}

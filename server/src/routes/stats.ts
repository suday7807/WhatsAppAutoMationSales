import { Router } from 'express';
import ExcelJS from 'exceljs';
import { TZ } from '../config.js';
import { all, get, run, setSetting } from '../db/db.js';
import { notifyStats } from '../events.js';
import { countRecipients, countsByCampaign } from '../engine/counts.js';
import { normalizePhone, parsePasted } from '../engine/phone.js';
import { addOptOut } from '../engine/replies.js';
import { globalDailyCap, sentToday } from '../engine/sender.js';
import { startOfDay, tzOffsetSeconds, zonedParts } from '../engine/window.js';
import { wa } from '../wa/client.js';

const DAY = 24 * 3600 * 1000;

function rangeSince(range: unknown): number | null {
  const days = Number(range);
  if (!Number.isFinite(days) || days <= 0) return null; // "all"
  return startOfDay(Date.now(), TZ) - (days - 1) * DAY;
}

export const statsRouter = Router();

statsRouter.get('/overview', (req, res) => {
  const since = rangeSince(req.query.range ?? 30);
  const off = tzOffsetSeconds(Date.now(), TZ);
  const rangeWhere =
    since == null
      ? ''
      : 'WHERE (r.sent_at >= ? OR (r.sent_at IS NULL AND r.campaign_id IN (SELECT id FROM campaigns WHERE created_at >= ?)))';
  const rangeParams = since == null ? [] : [since, since];
  const sinceMs = since ?? 0;

  const summary = {
    sent_today: sentToday(),
    daily_cap: globalDailyCap(),
    running: get<{ n: number }>("SELECT COUNT(*) n FROM campaigns WHERE status = 'running'")?.n ?? 0,
    campaigns: get<{ n: number }>('SELECT COUNT(*) n FROM campaigns')?.n ?? 0,
    contacts: get<{ n: number }>('SELECT COUNT(*) n FROM contacts')?.n ?? 0,
    optouts: get<{ n: number }>('SELECT COUNT(*) n FROM optouts')?.n ?? 0,
    wa_state: wa.getStatus().state,
  };

  const results = countRecipients(rangeWhere, ...rangeParams);

  // Daily series (local dates).
  const dayExpr = (col: string) => `date(${col} / 1000 + ${off}, 'unixepoch')`;
  const series = new Map<string, { date: string; sent: number; delivered: number; read: number; failed: number }>();
  const bump = (date: string, key: 'sent' | 'delivered' | 'read' | 'failed', n: number) => {
    const row = series.get(date) ?? { date, sent: 0, delivered: 0, read: 0, failed: 0 };
    row[key] += n;
    series.set(date, row);
  };
  all<{ d: string; n: number }>(`SELECT ${dayExpr('sent_at')} d, COUNT(*) n FROM recipients WHERE sent_at >= ? GROUP BY d`, sinceMs).forEach((r) => bump(r.d, 'sent', r.n));
  all<{ d: string; n: number }>(`SELECT ${dayExpr('delivered_at')} d, COUNT(*) n FROM wa_messages WHERE part = 'intro' AND delivered_at >= ? GROUP BY d`, sinceMs).forEach((r) => bump(r.d, 'delivered', r.n));
  all<{ d: string; n: number }>(`SELECT ${dayExpr('read_at')} d, COUNT(*) n FROM wa_messages WHERE part = 'intro' AND read_at >= ? GROUP BY d`, sinceMs).forEach((r) => bump(r.d, 'read', r.n));
  all<{ d: string; n: number }>(`SELECT ${dayExpr('started_at')} d, COUNT(*) n FROM recipients WHERE status = 'failed' AND started_at >= ? GROUP BY d`, sinceMs).forEach((r) => bump(r.d, 'failed', r.n));

  // Fill gaps so the chart has every day.
  const firstDay = since ?? Math.min(Date.now(), ...[...series.keys()].map((d) => Date.parse(`${d}T12:00:00Z`)));
  const daily: { date: string; sent: number; delivered: number; read: number; failed: number }[] = [];
  for (let t = startOfDay(firstDay, TZ) + DAY / 2; t <= Date.now() + DAY / 2; t += DAY) {
    const date = zonedParts(t, TZ).date;
    if (!daily.length || daily[daily.length - 1].date !== date)
      daily.push(series.get(date) ?? { date, sent: 0, delivered: 0, read: 0, failed: 0 });
  }

  // Best time to send: reply rate by local hour the intro went out.
  const hours = all<{ h: string; sent: number; replied: number }>(
    `SELECT strftime('%H', sent_at / 1000 + ${off}, 'unixepoch') h, COUNT(*) sent, SUM(replied_at IS NOT NULL) replied
     FROM recipients WHERE sent_at >= ? GROUP BY h ORDER BY h`,
    sinceMs,
  ).map((r) => ({ hour: Number(r.h), sent: r.sent, replied: r.replied, rate: r.sent ? r.replied / r.sent : 0 }));

  // Why messages did not go.
  const reasons = [
    ...all<{ reason: string; n: number }>(
      `SELECT COALESCE(error, 'Unknown error') reason, COUNT(*) n FROM recipients r ${rangeWhere ? rangeWhere + " AND r.status = 'failed'" : "WHERE r.status = 'failed'"} GROUP BY reason ORDER BY n DESC LIMIT 5`,
      ...rangeParams,
    ),
    ...all<{ reason: string; n: number }>(
      `SELECT CASE status WHEN 'not_on_wa' THEN 'Not on WhatsApp' WHEN 'skipped_optout' THEN 'Opted out' WHEN 'skipped_duplicate' THEN 'Already messaged before' ELSE 'Cancelled (campaign stopped)' END reason,
         COUNT(*) n FROM recipients r ${rangeWhere ? rangeWhere + ' AND' : 'WHERE'} r.status IN ('not_on_wa','skipped_optout','skipped_duplicate','cancelled') GROUP BY status`,
      ...rangeParams,
    ),
  ].sort((a, b) => b.n - a.n);

  const counts = countsByCampaign();
  const campaigns = all<{ id: number; name: string; status: string; created_at: number }>(
    'SELECT id, name, status, created_at FROM campaigns ORDER BY id DESC LIMIT 10',
  ).map((c) => ({ ...c, counts: counts.get(c.id) ?? null }));

  res.json({ summary, results, daily, hours, reasons, campaigns });
});

statsRouter.get('/settings', (_req, res) => {
  res.json({ global_daily_cap: globalDailyCap() });
});

statsRouter.put('/settings', (req, res) => {
  const cap = Math.round(Number(req.body?.global_daily_cap));
  if (!Number.isFinite(cap) || cap < 1 || cap > 1000) return void res.status(400).json({ error: 'Daily cap must be 1–1000' });
  setSetting('global_daily_cap', cap);
  notifyStats();
  res.json({ ok: true });
});

export const repliesRouter = Router();

repliesRouter.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200), 1000);
  res.json(
    all(
      `SELECT rp.*, r.name, r.business, r.category, c.name AS campaign_name
       FROM replies rp LEFT JOIN recipients r ON r.id = rp.recipient_id LEFT JOIN campaigns c ON c.id = rp.campaign_id
       ORDER BY rp.received_at DESC LIMIT ?`,
      limit,
    ),
  );
});

export const optoutsRouter = Router();

optoutsRouter.get('/', (_req, res) => {
  res.json(
    all(
      `SELECT o.*, (SELECT name FROM contacts c WHERE c.phone = o.phone) AS name,
              (SELECT business FROM contacts c WHERE c.phone = o.phone) AS business
       FROM optouts o ORDER BY o.created_at DESC`,
    ),
  );
});

/** Body: { text } with one number per line, plus optional note. */
optoutsRouter.post('/', (req, res) => {
  const { valid, invalid } = parsePasted(String(req.body?.text ?? req.body?.phone ?? ''));
  valid.forEach((v) => addOptOut(v.phone, 'manual', req.body?.note ?? null));
  res.json({ added: valid.length, invalid });
});

optoutsRouter.delete('/:phone', (req, res) => {
  const phone = normalizePhone(decodeURIComponent(req.params.phone));
  if (!phone) return void res.status(400).json({ error: 'Invalid phone' });
  run('DELETE FROM optouts WHERE phone = ?', phone);
  notifyStats();
  res.json({ ok: true });
});

export const exportRouter = Router();

const fmtTime = (ts: number | null) => (ts ? new Date(ts).toLocaleString('en-IN', { timeZone: TZ }) : '');
const ACK = ['Pending', 'Sent', 'Delivered', 'Read', 'Played'];

/** Excel export. ?from=YYYY-MM-DD&to=YYYY-MM-DD (local dates); empty = everything. */
exportRouter.get('/export.xlsx', async (req, res) => {
  const off = tzOffsetSeconds(Date.now(), TZ) * 1000;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from ?? '')) ? Date.parse(`${req.query.from}T00:00:00Z`) - off : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to ?? '')) ? Date.parse(`${req.query.to}T00:00:00Z`) - off + DAY : null;
  const where: string[] = [];
  const params: number[] = [];
  if (from != null) {
    where.push('COALESCE(r.sent_at, r.started_at, c.created_at) >= ?');
    params.push(from);
  }
  if (to != null) {
    where.push('COALESCE(r.sent_at, r.started_at, c.created_at) < ?');
    params.push(to);
  }
  const rows = all<any>(
    `SELECT r.*, c.name AS campaign_name, (SELECT MAX(ack) FROM wa_messages m WHERE m.recipient_id = r.id) AS max_ack,
            (SELECT MIN(delivered_at) FROM wa_messages m WHERE m.recipient_id = r.id) AS delivered_at,
            (SELECT MIN(read_at) FROM wa_messages m WHERE m.recipient_id = r.id) AS read_at,
            (SELECT body FROM replies rp WHERE rp.recipient_id = r.id ORDER BY received_at ASC LIMIT 1) AS first_reply
     FROM recipients r JOIN campaigns c ON c.id = r.campaign_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY c.id, r.position`,
    ...params,
  );

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Messages');
  ws.columns = [
    { header: 'Campaign', key: 'campaign', width: 22 },
    { header: 'Name', key: 'name', width: 20 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Business', key: 'business', width: 24 },
    { header: 'Category', key: 'category', width: 14 },
    { header: 'City', key: 'city', width: 12 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Ticks', key: 'ticks', width: 11 },
    { header: 'Variation #', key: 'variation', width: 11 },
    { header: 'Intro message', key: 'intro', width: 50 },
    { header: 'Sent at', key: 'sent_at', width: 20 },
    { header: 'Delivered at', key: 'delivered_at', width: 20 },
    { header: 'Read at', key: 'read_at', width: 20 },
    { header: 'Replied at', key: 'replied_at', width: 20 },
    { header: 'First reply', key: 'reply', width: 40 },
    { header: 'Error', key: 'error', width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow({
      campaign: r.campaign_name,
      name: r.name ?? '',
      phone: r.phone,
      business: r.business ?? '',
      category: r.category ?? '',
      city: r.city ?? '',
      status: r.status,
      ticks: r.max_ack == null ? '' : r.max_ack < 0 ? 'Error' : ACK[r.max_ack] ?? '',
      variation: r.variation_idx == null || r.variation_idx < 0 ? '' : r.variation_idx + 1,
      intro: r.intro_text ?? '',
      sent_at: fmtTime(r.sent_at),
      delivered_at: fmtTime(r.delivered_at),
      read_at: fmtTime(r.read_at),
      replied_at: fmtTime(r.replied_at),
      reply: r.first_reply ?? '',
      error: r.error ?? '',
    });
  }

  const sum = wb.addWorksheet('Campaigns');
  sum.columns = [
    { header: 'Campaign', key: 'name', width: 24 },
    { header: 'Status', key: 'status', width: 12 },
    ...['total', 'sent', 'delivered', 'read', 'replied', 'failed', 'not_on_wa', 'pending', 'skipped'].map((k) => ({ header: k.replace(/_/g, ' '), key: k, width: 11 })),
  ];
  sum.getRow(1).font = { bold: true };
  const counts = countsByCampaign();
  for (const c of all<{ id: number; name: string; status: string }>('SELECT id, name, status FROM campaigns ORDER BY id')) {
    sum.addRow({ name: c.name, status: c.status, ...(counts.get(c.id) ?? {}) });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="whatsapp-report-${stamp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

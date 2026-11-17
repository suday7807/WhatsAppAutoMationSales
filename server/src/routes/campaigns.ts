import { Router } from 'express';
import { all, get, run, tx } from '../db/db.js';
import { notifyCampaign, notifyStats } from '../events.js';
import { type CampaignRow, getCampaign, getKit, kitImagePaths, parseJsonArray } from '../engine/campaignRow.js';
import { countRecipients, countsByCampaign } from '../engine/counts.js';
import { estimateDays, estimateThroughput, type TimingInput, validateTiming } from '../engine/estimate.js';
import { parsePasted } from '../engine/phone.js';
import { campaignWaitInfo, sentToday } from '../engine/sender.js';
import { lintIntro, renderTemplate } from '../engine/spintax.js';
import { upsertContacts } from './contacts.js';

const int = (v: unknown, d = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : d;
};
const strList = (v: unknown) =>
  (Array.isArray(v) ? v : []).map((s) => String(s ?? '').trim()).filter(Boolean);

const HAS_LINK = /\{\{\s*(link|url)\s*\}\}/i;

/**
 * Accepts the common ways people write the link and turns them into {{link}}:
 * the demo kit's actual URL, {link}, [link], (link) or {{ Link }}.
 */
export function normalizeLink(text: string, demoUrl?: string | null): string {
  let t = text.replace(/\{\{\s*(link|url)\s*\}\}/gi, '{{link}}');
  t = t.replace(/(?<!\{)\{\s*(link|url)\s*\}(?!\})|\[\s*(link|url)\s*\]|\(\s*(link|url)\s*\)/gi, '{{link}}');
  if (demoUrl) {
    const bare = demoUrl.replace(/\/+$/, '');
    // Longest form first, so "https://x.app/" never leaves a stray "/" behind.
    for (const u of [bare + '/', bare]) if (bare && t.includes(u)) t = t.split(u).join('{{link}}');
  }
  return t;
}

/** Reads + validates the editable campaign settings from a request body. */
function readSettings(body: any) {
  const timing: TimingInput = {
    min_gap_s: int(body.min_gap_s, 180),
    max_gap_s: int(body.max_gap_s, 420),
    break_every: int(body.break_every, 10),
    break_len_s: int(body.break_len_s, 1800),
    max_per_day: int(body.max_per_day, 40),
    part_gap_min_s: int(body.part_gap_min_s, 5),
    part_gap_max_s: int(body.part_gap_max_s, 20),
    start_time: String(body.start_time ?? '10:00'),
    stop_time: String(body.stop_time ?? '19:00'),
    days: (Array.isArray(body.days) ? body.days : [1, 2, 3, 4, 5, 6]).map(Number).filter((d: number) => d >= 0 && d <= 6),
  };
  const message_mode: 'combined' | 'separate' = body.message_mode === 'separate' ? 'separate' : 'combined';
  const settings = {
    name: String(body.name ?? '').trim(),
    demo_kit_id: body.demo_kit_id ? int(body.demo_kit_id) : null,
    message_mode,
    intro_variations: strList(body.intro_variations),
    // In combined mode the link lives inside the full message, so there are no separate link texts.
    link_variations: message_mode === 'combined' ? [] : strList(body.link_variations),
    rotation: body.rotation === 'random' ? 'random' : 'order',
    send_images: body.send_images === false || body.send_images === 0 ? 0 : 1,
    start_date: /^\d{4}-\d{2}-\d{2}$/.test(String(body.start_date ?? '')) ? String(body.start_date) : null,
    dedupe: body.dedupe === 'all' ? 'all' : 'skip_ever_messaged',
    ...timing,
  };
  const errors = validateTiming(timing);
  if (!settings.name) errors.unshift('Campaign name is required.');
  if (!settings.intro_variations.length) errors.push('Add at least one intro message.');
  if (message_mode === 'combined' && settings.demo_kit_id) {
    const kit = getKit(settings.demo_kit_id);
    settings.intro_variations = settings.intro_variations.map((t) => normalizeLink(t, kit?.demo_url));
    const missing = settings.intro_variations.map((t, i) => (HAS_LINK.test(t) ? 0 : i + 1)).filter(Boolean);
    if (missing.length)
      errors.push(
        `Message ${missing.join(', ')} has no {{link}}. Add {{link}} where the demo website link should appear ` +
          `(or delete that variation).`,
      );
  }
  if (settings.demo_kit_id && !getKit(settings.demo_kit_id)) errors.push('Selected demo kit does not exist.');
  if (settings.link_variations.length) {
    const kit = settings.demo_kit_id ? getKit(settings.demo_kit_id) : null;
    settings.link_variations = settings.link_variations.map((t) => normalizeLink(t, kit?.demo_url));
    const missing = settings.link_variations.map((t, i) => (HAS_LINK.test(t) ? 0 : i + 1)).filter(Boolean);
    if (missing.length) errors.push(`Link message ${missing.join(', ')} has no {{link}}. Add {{link}} or delete that variation.`);
  }
  if (settings.link_variations.length && !settings.demo_kit_id) errors.push('Link messages need a demo kit (the {{link}} comes from it).');
  return { settings, timing, errors };
}

function serialize(c: CampaignRow) {
  return {
    ...c,
    intro_variations: parseJsonArray<string>(c.intro_variations),
    link_variations: parseJsonArray<string>(c.link_variations),
    days: parseJsonArray<number>(c.days),
    send_images: !!c.send_images,
  };
}

export const campaignsRouter = Router();

campaignsRouter.get('/', (_req, res) => {
  const counts = countsByCampaign();
  const rows = all<CampaignRow>('SELECT * FROM campaigns ORDER BY id DESC').map((c) => ({
    ...serialize(c),
    counts: counts.get(c.id) ?? countRecipients('WHERE 0'),
    wait: campaignWaitInfo(c),
  }));
  res.json(rows);
});

campaignsRouter.get('/:id', (req, res) => {
  const c = getCampaign(Number(req.params.id));
  if (!c) return void res.status(404).json({ error: 'Not found' });
  const kit = getKit(c.demo_kit_id);
  const counts = countRecipients('WHERE r.campaign_id = ?', c.id);
  const textParts = c.message_mode === 'combined' ? 1 : 2;
  const est = estimateThroughput(serialize(c) as TimingInput, textParts + (c.send_images ? kitImagePaths(kit).length : 0));
  res.json({
    ...serialize(c),
    kit: kit ?? null,
    counts,
    sent_today: sentToday(c.id),
    wait: campaignWaitInfo(c),
    estimate: { ...est, days_left: estimateDays(counts.pending, est.perDay) },
  });
});

campaignsRouter.get('/:id/recipients', (req, res) => {
  const id = Number(req.params.id);
  const where = ['r.campaign_id = ?'];
  const params: (string | number)[] = [id];
  if (req.query.status) {
    const s = String(req.query.status);
    if (s === 'replied') where.push('r.replied_at IS NOT NULL');
    else if (s === 'skipped') where.push("r.status IN ('skipped_optout','skipped_duplicate','cancelled')");
    else if (s === 'pending') where.push("r.status IN ('pending','sending')");
    else {
      where.push('r.status = ?');
      params.push(s);
    }
  }
  if (req.query.q) {
    where.push('(r.phone LIKE ? OR r.name LIKE ? OR r.business LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like, like);
  }
  const limit = Math.min(int(req.query.limit, 100), 500);
  const offset = int(req.query.offset, 0);
  const rows = all(
    `SELECT r.*, (SELECT MAX(ack) FROM wa_messages m WHERE m.recipient_id = r.id) AS max_ack
     FROM recipients r WHERE ${where.join(' AND ')}
     ORDER BY CASE WHEN r.sent_at IS NULL THEN 1 ELSE 0 END, r.sent_at DESC, r.position ASC
     LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  const total = get<{ n: number }>(`SELECT COUNT(*) n FROM recipients r WHERE ${where.join(' AND ')}`, ...params)?.n ?? 0;
  res.json({ rows, total });
});

/** Live preview for the builder: rendered samples, content warnings, timing errors and estimate. */
campaignsRouter.post('/preview', (req, res) => {
  const { settings, timing, errors } = readSettings({ name: 'preview', ...req.body });
  const kit = getKit(settings.demo_kit_id);
  const sample = req.body?.sample ?? {};
  const vars = {
    name: sample.name ?? 'Priya Sharma',
    business: sample.business ?? 'Sharma Dental Clinic',
    city: sample.city ?? 'Pune',
    category: sample.category ?? kit?.category ?? 'dentist',
    link: kit?.demo_url ?? 'https://your-demo-site.com',
  };
  const combined = settings.message_mode === 'combined';
  const intros = settings.intro_variations.map((tpl) => ({
    sample: renderTemplate(tpl, vars),
    warnings: lintIntro(tpl, settings.message_mode, !!kit),
  }));
  const links = settings.link_variations.map((tpl) => renderTemplate(tpl, vars));
  const linkPart = !combined && (links.length || kit) ? 1 : 0;
  const parts = (settings.intro_variations.length ? 1 : 0) + linkPart + (settings.send_images ? kitImagePaths(kit).length : 0);
  const est = estimateThroughput(timing, Math.max(1, parts));
  const leads = int(req.body?.recipients_count, 0);
  res.json({
    intros,
    links,
    images: settings.send_images && kit ? [kit.image1, kit.image2].filter(Boolean) : [],
    errors: errors.filter((e) => !e.startsWith('Campaign name') && !e.startsWith('Add at least')),
    estimate: { ...est, days: leads ? estimateDays(leads, est.perDay) : null },
  });
});

campaignsRouter.post('/', (req, res) => {
  const { settings, errors } = readSettings(req.body ?? {});
  if (errors.length) return void res.status(400).json({ error: errors[0], errors });

  // Collect recipients from the list + pasted numbers.
  type Rec = { contact_id: number | null; phone: string; name: string | null; business: string | null; category: string | null; city: string | null };
  const recs: Rec[] = [];
  const seen = new Set<string>();
  const push = (r: Rec) => {
    if (seen.has(r.phone)) return;
    seen.add(r.phone);
    recs.push(r);
  };
  const contactRow = (id: number) =>
    get<Rec & { id: number }>('SELECT id AS contact_id, phone, name, business, category, city FROM contacts WHERE id = ?', id);

  if (req.body?.list_id) {
    all<Rec>(
      `SELECT c.id AS contact_id, c.phone, c.name, c.business, c.category, c.city
       FROM contacts c JOIN list_contacts lc ON lc.contact_id = c.id WHERE lc.list_id = ? ORDER BY c.id`,
      int(req.body.list_id),
    ).forEach(push);
  }
  let invalid: string[] = [];
  if (typeof req.body?.pasted === 'string' && req.body.pasted.trim()) {
    const parsed = parsePasted(req.body.pasted);
    invalid = parsed.invalid;
    const up = upsertContacts(parsed.valid, 'campaign');
    up.ids.forEach((id) => {
      const row = contactRow(id);
      if (row) push(row);
    });
  }
  if (!recs.length) return void res.status(400).json({ error: 'No valid numbers. Pick a list or paste numbers.', invalid });

  let skippedOptout = 0;
  let skippedDuplicate = 0;
  const final = recs.filter((r) => {
    if (get('SELECT 1 FROM optouts WHERE phone = ?', r.phone)) {
      skippedOptout++;
      return false;
    }
    if (settings.dedupe === 'skip_ever_messaged' && get('SELECT 1 FROM recipients WHERE phone = ? AND sent_at IS NOT NULL', r.phone)) {
      skippedDuplicate++;
      return false;
    }
    return true;
  });
  if (!final.length)
    return void res.status(400).json({ error: 'Every number was removed (opted out or already messaged).', skippedOptout, skippedDuplicate });

  const start = !!req.body?.start;
  const id = tx(() => {
    const now = Date.now();
    const c = run(
      `INSERT INTO campaigns (name, status, demo_kit_id, message_mode, intro_variations, link_variations, rotation, send_images,
         min_gap_s, max_gap_s, break_every, break_len_s, max_per_day, part_gap_min_s, part_gap_max_s,
         start_time, stop_time, start_date, days, dedupe, created_at, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      settings.name, start ? 'running' : 'draft', settings.demo_kit_id, settings.message_mode,
      JSON.stringify(settings.intro_variations), JSON.stringify(settings.link_variations),
      settings.rotation, settings.send_images,
      settings.min_gap_s, settings.max_gap_s, settings.break_every, settings.break_len_s, settings.max_per_day,
      settings.part_gap_min_s, settings.part_gap_max_s, settings.start_time, settings.stop_time,
      settings.start_date, JSON.stringify(settings.days), settings.dedupe, now, start ? now : null,
    );
    final.forEach((r, i) =>
      run(
        `INSERT INTO recipients (campaign_id, contact_id, phone, name, business, category, city, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        c.lastId, r.contact_id, r.phone, r.name, r.business, r.category, r.city, i,
      ),
    );
    return c.lastId;
  });
  notifyCampaign(id);
  notifyStats();
  res.json({ id, recipients: final.length, skippedOptout, skippedDuplicate, invalid });
});

campaignsRouter.put('/:id', (req, res) => {
  const c = getCampaign(Number(req.params.id));
  if (!c) return void res.status(404).json({ error: 'Not found' });
  if (!['draft', 'paused'].includes(c.status)) return void res.status(409).json({ error: 'Pause the campaign before editing it.' });
  const { settings, errors } = readSettings({ ...serialize(c), ...req.body });
  if (errors.length) return void res.status(400).json({ error: errors[0], errors });
  run(
    `UPDATE campaigns SET name = ?, demo_kit_id = ?, message_mode = ?, intro_variations = ?, link_variations = ?, rotation = ?, send_images = ?,
       min_gap_s = ?, max_gap_s = ?, break_every = ?, break_len_s = ?, max_per_day = ?, part_gap_min_s = ?, part_gap_max_s = ?,
       start_time = ?, stop_time = ?, start_date = ?, days = ?, dedupe = ? WHERE id = ?`,
    settings.name, settings.demo_kit_id, settings.message_mode, JSON.stringify(settings.intro_variations), JSON.stringify(settings.link_variations),
    settings.rotation, settings.send_images, settings.min_gap_s, settings.max_gap_s, settings.break_every, settings.break_len_s,
    settings.max_per_day, settings.part_gap_min_s, settings.part_gap_max_s, settings.start_time, settings.stop_time,
    settings.start_date, JSON.stringify(settings.days), settings.dedupe, c.id,
  );
  notifyCampaign(c.id);
  res.json({ ok: true });
});

function transition(id: number, from: string[], to: string, extra = '') {
  const r = run(`UPDATE campaigns SET status = ? ${extra} WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`, to, id, ...from);
  return r.changes > 0;
}

campaignsRouter.post('/:id/start', (req, res) => {
  const id = Number(req.params.id);
  const ok = transition(id, ['draft', 'paused'], 'running', ', started_at = COALESCE(started_at, ' + Date.now() + ')');
  if (!ok) return void res.status(409).json({ error: 'Only draft or paused campaigns can be started.' });
  notifyCampaign(id);
  res.json({ ok: true });
});

campaignsRouter.post('/:id/pause', (req, res) => {
  const id = Number(req.params.id);
  if (!transition(id, ['running'], 'paused')) return void res.status(409).json({ error: 'Campaign is not running.' });
  notifyCampaign(id);
  res.json({ ok: true });
});

campaignsRouter.post('/:id/stop', (req, res) => {
  const id = Number(req.params.id);
  const c = getCampaign(id);
  if (!c || !['draft', 'running', 'paused'].includes(c.status))
    return void res.status(409).json({ error: 'Campaign is already finished.' });
  tx(() => {
    transition(id, ['draft', 'running', 'paused'], 'stopped', ', completed_at = ' + Date.now());
    run("UPDATE recipients SET status = 'cancelled' WHERE campaign_id = ? AND status = 'pending'", id);
    run("UPDATE recipients SET status = CASE WHEN parts_done > 0 THEN 'sent' ELSE 'cancelled' END WHERE campaign_id = ? AND status = 'sending'", id);
  });
  notifyCampaign(id);
  notifyStats();
  res.json({ ok: true });
});

campaignsRouter.delete('/:id', (req, res) => {
  const c = getCampaign(Number(req.params.id));
  if (!c) return void res.status(404).json({ error: 'Not found' });
  if (c.status === 'running') return void res.status(409).json({ error: 'Pause or stop the campaign first.' });
  run('DELETE FROM campaigns WHERE id = ?', c.id);
  notifyStats();
  res.json({ ok: true });
});

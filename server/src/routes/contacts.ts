import { Router } from 'express';
import { all, get, run, tx } from '../db/db.js';
import { normalizePhone, parsePasted } from '../engine/phone.js';

export interface ContactInput {
  phone: string;
  name?: string | null;
  business?: string | null;
  category?: string | null;
  city?: string | null;
}

const clean = (v: unknown) => {
  const s = v == null ? '' : String(v).trim();
  return s ? s.slice(0, 200) : null;
};

/** Normalises + upserts contacts. Existing contacts keep old values unless the new row has one. */
export function upsertContacts(rows: ContactInput[], source: string, listId?: number | null) {
  const ids: number[] = [];
  const invalid: string[] = [];
  let created = 0;
  let updated = 0;
  const seen = new Set<string>();
  tx(() => {
    for (const row of rows) {
      const phone = normalizePhone(row.phone);
      if (!phone) {
        if (String(row.phone ?? '').trim()) invalid.push(String(row.phone));
        continue;
      }
      if (seen.has(phone)) continue;
      seen.add(phone);
      const existing = get<{ id: number }>('SELECT id FROM contacts WHERE phone = ?', phone);
      if (existing) {
        run(
          `UPDATE contacts SET name = COALESCE(?, name), business = COALESCE(?, business),
             category = COALESCE(?, category), city = COALESCE(?, city) WHERE id = ?`,
          clean(row.name), clean(row.business), clean(row.category), clean(row.city), existing.id,
        );
        ids.push(existing.id);
        updated++;
      } else {
        const r = run(
          'INSERT INTO contacts (phone, name, business, category, city, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          phone, clean(row.name), clean(row.business), clean(row.category), clean(row.city), source, Date.now(),
        );
        ids.push(r.lastId);
        created++;
      }
      if (listId) run('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)', listId, ids[ids.length - 1]);
    }
  });
  return { ids, created, updated, invalid };
}

function resolveListId(body: any): number | null {
  if (body?.list_id) return Number(body.list_id);
  const name = clean(body?.new_list_name);
  if (!name) return null;
  const existing = get<{ id: number }>('SELECT id FROM lists WHERE name = ?', name);
  return existing?.id ?? run('INSERT INTO lists (name, created_at) VALUES (?, ?)', name, Date.now()).lastId;
}

function filterSql(q: any) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q.q) {
    where.push('(c.phone LIKE ? OR c.name LIKE ? OR c.business LIKE ?)');
    const like = `%${q.q}%`;
    params.push(like, like, like);
  }
  if (q.category) {
    where.push('c.category = ?');
    params.push(String(q.category));
  }
  if (q.city) {
    where.push('c.city = ?');
    params.push(String(q.city));
  }
  if (q.list_id) {
    where.push('c.id IN (SELECT contact_id FROM list_contacts WHERE list_id = ?)');
    params.push(Number(q.list_id));
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export const contactsRouter = Router();

contactsRouter.get('/', (req, res) => {
  const { sql, params } = filterSql(req.query);
  const limit = Math.min(Number(req.query.limit ?? 100), 1000);
  const offset = Number(req.query.offset ?? 0);
  const rows = all(
    `SELECT c.*,
       EXISTS(SELECT 1 FROM optouts o WHERE o.phone = c.phone) AS opted_out,
       (SELECT MAX(sent_at) FROM recipients r WHERE r.phone = c.phone) AS last_messaged_at
     FROM contacts c ${sql} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  const total = get<{ n: number }>(`SELECT COUNT(*) n FROM contacts c ${sql}`, ...params)?.n ?? 0;
  res.json({ rows, total });
});

contactsRouter.get('/facets', (_req, res) => {
  res.json({
    categories: all<{ v: string }>("SELECT DISTINCT category v FROM contacts WHERE category IS NOT NULL AND category != '' ORDER BY 1").map((r) => r.v),
    cities: all<{ v: string }>("SELECT DISTINCT city v FROM contacts WHERE city IS NOT NULL AND city != '' ORDER BY 1").map((r) => r.v),
  });
});

/** Body: { rows: ContactInput[] } (CSV, mapped in the browser) or { text } (pasted), plus list_id / new_list_name. */
contactsRouter.post('/import', (req, res) => {
  const listId = resolveListId(req.body);
  let rows: ContactInput[] = [];
  let invalid: string[] = [];
  if (typeof req.body?.text === 'string') {
    const parsed = parsePasted(req.body.text);
    rows = parsed.valid.map((v) => ({ ...v, category: req.body.category, city: req.body.city }));
    invalid = parsed.invalid;
  } else if (Array.isArray(req.body?.rows)) {
    rows = req.body.rows;
  }
  const result = upsertContacts(rows, req.body?.source ?? 'import', listId);
  res.json({ created: result.created, updated: result.updated, invalid: [...invalid, ...result.invalid], list_id: listId });
});

contactsRouter.post('/delete', (req, res) => {
  const ids: number[] = (req.body?.ids ?? []).map(Number).filter(Boolean);
  tx(() => ids.forEach((id) => run('DELETE FROM contacts WHERE id = ?', id)));
  res.json({ deleted: ids.length });
});

export const listsRouter = Router();

listsRouter.get('/', (_req, res) => {
  res.json(
    all(`SELECT l.*, (SELECT COUNT(*) FROM list_contacts lc WHERE lc.list_id = l.id) AS size FROM lists l ORDER BY l.name`),
  );
});

listsRouter.post('/', (req, res) => {
  const name = clean(req.body?.name);
  if (!name) return void res.status(400).json({ error: 'Name is required' });
  if (get('SELECT 1 FROM lists WHERE name = ?', name)) return void res.status(409).json({ error: 'A list with this name exists' });
  res.json({ id: run('INSERT INTO lists (name, created_at) VALUES (?, ?)', name, Date.now()).lastId });
});

listsRouter.delete('/:id', (req, res) => {
  run('DELETE FROM lists WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

/** Adds contacts to a list, either by ids or by the same filters the Contacts page uses. */
listsRouter.post('/:id/add', (req, res) => {
  const listId = Number(req.params.id);
  let ids: number[] = (req.body?.ids ?? []).map(Number).filter(Boolean);
  if (!ids.length && req.body?.filter) {
    const { sql, params } = filterSql(req.body.filter);
    ids = all<{ id: number }>(`SELECT c.id FROM contacts c ${sql}`, ...params).map((r) => r.id);
  }
  tx(() => ids.forEach((id) => run('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)', listId, id)));
  res.json({ added: ids.length });
});

listsRouter.post('/:id/remove', (req, res) => {
  const listId = Number(req.params.id);
  const ids: number[] = (req.body?.ids ?? []).map(Number).filter(Boolean);
  tx(() => ids.forEach((id) => run('DELETE FROM list_contacts WHERE list_id = ? AND contact_id = ?', listId, id)));
  res.json({ removed: ids.length });
});

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { UPLOAD_DIR } from '../config.js';
import { all, get, run } from '../db/db.js';
import type { DemoKitRow } from '../engine/campaignRow.js';

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpe?g|webp)$/.test(file.mimetype)),
});

const fields = upload.fields([
  { name: 'image1', maxCount: 1 },
  { name: 'image2', maxCount: 1 },
]);

const removeFile = (f: string | null) => {
  if (f) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
};

const isUrl = (s: string) => /^https?:\/\/\S+\.\S+/i.test(s);

export const demoKitsRouter = Router();

demoKitsRouter.get('/', (_req, res) => {
  res.json(
    all(`SELECT k.*, (SELECT COUNT(*) FROM campaigns c WHERE c.demo_kit_id = k.id) AS campaigns FROM demo_kits k ORDER BY k.category`),
  );
});

demoKitsRouter.post('/', fields, (req, res) => {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const category = String(req.body?.category ?? '').trim();
  const url = String(req.body?.demo_url ?? '').trim();
  const img1 = files.image1?.[0]?.filename ?? null;
  const img2 = files.image2?.[0]?.filename ?? null;
  if (!category || !isUrl(url)) {
    removeFile(img1);
    removeFile(img2);
    return void res.status(400).json({ error: 'Category and a full demo URL (https://...) are required' });
  }
  if (get('SELECT 1 FROM demo_kits WHERE category = ?', category)) {
    removeFile(img1);
    removeFile(img2);
    return void res.status(409).json({ error: 'A demo kit for this category already exists' });
  }
  const r = run(
    'INSERT INTO demo_kits (category, demo_url, image1, image2, created_at) VALUES (?, ?, ?, ?, ?)',
    category, url, img1, img2, Date.now(),
  );
  res.json({ id: r.lastId });
});

demoKitsRouter.put('/:id', fields, (req, res) => {
  const id = Number(req.params.id);
  const kit = get<DemoKitRow>('SELECT * FROM demo_kits WHERE id = ?', id);
  if (!kit) return void res.status(404).json({ error: 'Not found' });
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const category = String(req.body?.category ?? kit.category).trim();
  const url = String(req.body?.demo_url ?? kit.demo_url).trim();
  if (!category || !isUrl(url)) return void res.status(400).json({ error: 'Category and a full demo URL are required' });

  let image1 = kit.image1;
  let image2 = kit.image2;
  if (files.image1?.[0]) {
    removeFile(kit.image1);
    image1 = files.image1[0].filename;
  } else if (req.body?.remove_image1 === '1') {
    removeFile(kit.image1);
    image1 = null;
  }
  if (files.image2?.[0]) {
    removeFile(kit.image2);
    image2 = files.image2[0].filename;
  } else if (req.body?.remove_image2 === '1') {
    removeFile(kit.image2);
    image2 = null;
  }
  run('UPDATE demo_kits SET category = ?, demo_url = ?, image1 = ?, image2 = ? WHERE id = ?', category, url, image1, image2, id);
  res.json({ ok: true });
});

demoKitsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const kit = get<DemoKitRow>('SELECT * FROM demo_kits WHERE id = ?', id);
  if (!kit) return void res.status(404).json({ error: 'Not found' });
  if (get("SELECT 1 FROM campaigns WHERE demo_kit_id = ? AND status IN ('running','paused')", id))
    return void res.status(409).json({ error: 'A running or paused campaign uses this kit' });
  run('DELETE FROM demo_kits WHERE id = ?', id);
  removeFile(kit.image1);
  removeFile(kit.image2);
  res.json({ ok: true });
});

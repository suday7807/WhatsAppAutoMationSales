import { Router } from 'express';
import { normalizePhone } from '../engine/phone.js';
import { wa } from '../wa/client.js';

export const waRouter = Router();

waRouter.get('/status', (_req, res) => {
  res.json({ ...wa.getStatus(), hasSavedSession: wa.hasSavedSession() });
});

waRouter.post('/connect', (_req, res) => {
  void wa.connect(); // QR / ready arrive over Socket.IO
  res.json({ ok: true });
});

waRouter.post('/logout', async (_req, res) => {
  await wa.logout();
  res.json({ ok: true });
});

/** Sends one test message, e.g. to your own number, to check the connection. */
waRouter.post('/test', async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const text = String(req.body?.text ?? '').trim();
  if (!phone) return void res.status(400).json({ error: 'Invalid phone number' });
  if (!text) return void res.status(400).json({ error: 'Message is empty' });
  if (!wa.isReady()) return void res.status(409).json({ error: 'WhatsApp is not connected' });
  const chatId = await wa.resolveChatId(phone);
  if (!chatId) return void res.status(404).json({ error: 'This number is not on WhatsApp' });
  const id = await wa.sendText(chatId, text);
  res.json({ ok: true, id });
});

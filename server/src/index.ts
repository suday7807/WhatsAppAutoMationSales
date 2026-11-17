import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Server } from 'socket.io';
import { DATA_DIR, HOST, PORT, UPLOAD_DIR } from './config.js';
import './db/db.js';
import { handleAck, handleIncoming } from './engine/replies.js';
import { sender } from './engine/sender.js';
import { bus } from './events.js';
import { campaignsRouter } from './routes/campaigns.js';
import { contactsRouter, listsRouter } from './routes/contacts.js';
import { demoKitsRouter } from './routes/demoKits.js';
import { exportRouter, optoutsRouter, repliesRouter, statsRouter } from './routes/stats.js';
import { waRouter } from './routes/wa.js';
import { wa } from './wa/client.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use('/api/wa', waRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/lists', listsRouter);
app.use('/api/demo-kits', demoKitsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/replies', repliesRouter);
app.use('/api/optouts', optoutsRouter);
app.use('/api', exportRouter);
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1h' }));

// Serve the built dashboard (npm run build) from the same port.
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api]', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => socket.emit('wa:status', wa.getStatus()));
wa.on('status', (s) => io.emit('wa:status', s));
wa.on('ack', (id: string, ack: number) => handleAck(id, ack));
wa.on('incoming', (msg) => void handleIncoming(msg).catch((e) => console.error('[incoming]', e)));
bus.on('campaign', (p) => io.emit('campaign', p));
bus.on('stats', () => io.emit('stats', {}));

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Is WA Outreach already running in another terminal?`);
    console.error('  Close it first, or start with a different port: set PORT=4001\n');
  } else {
    console.error('[server]', err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  WA Outreach running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Data folder: ${DATA_DIR}\n`);
  sender.start();
  // Re-open the saved WhatsApp session automatically after a restart.
  if (wa.hasSavedSession()) void wa.connect();
});

// Puppeteer/WhatsApp Web can throw from inside the library (e.g. "detached Frame" while WhatsApp
// reloads). Log it instead of letting it kill the server mid-campaign.
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down (WhatsApp session is kept)...');
  sender.stop();
  await wa.shutdown();
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

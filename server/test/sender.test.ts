import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Isolated data folder for this test run (must be set before the app modules load).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-test-'));
process.env.DATA_DIR = tmp;

// Fake WhatsApp: records every send instead of talking to WhatsApp Web.
const sent: { chatId: string; kind: 'text' | 'image'; body: string }[] = [];
let ready = true;
let counter = 0;
vi.mock('../src/wa/client.js', () => ({
  wa: {
    isReady: () => ready,
    resolveChatId: async (phone: string) => (phone.endsWith('0000') ? null : phone.replace(/\D/g, '') + '@c.us'),
    sendText: async (chatId: string, text: string) => {
      sent.push({ chatId, kind: 'text', body: text });
      return `msg-${++counter}`;
    },
    sendImage: async (chatId: string, file: string) => {
      sent.push({ chatId, kind: 'image', body: path.basename(file) });
      return `msg-${++counter}`;
    },
    getStatus: () => ({ state: ready ? 'ready' : 'disconnected' }),
  },
}));

type Db = typeof import('../src/db/db.js');
type Sender = typeof import('../src/engine/sender.js');
let db: Db;
let S: Sender;

beforeAll(async () => {
  db = await import('../src/db/db.js');
  S = await import('../src/engine/sender.js');
  const { UPLOAD_DIR } = await import('../src/config.js');
  fs.writeFileSync(path.join(UPLOAD_DIR, 'a.png'), 'x');
  fs.writeFileSync(path.join(UPLOAD_DIR, 'b.png'), 'x');
  db.run("INSERT INTO demo_kits (id, category, demo_url, image1, image2, created_at) VALUES (1, 'dentist', 'https://demo.test', 'a.png', 'b.png', 0)");
});

function makeCampaign(over: Record<string, unknown> = {}) {
  const c = {
    name: 'T', status: 'running', demo_kit_id: 1,
    intro_variations: JSON.stringify(['Hi {{first_name|there}}', 'Hello {{first_name|there}}']),
    link_variations: JSON.stringify(['See {{link}}']),
    rotation: 'order', send_images: 1, min_gap_s: 30, max_gap_s: 30, break_every: 2, break_len_s: 600,
    max_per_day: 100, part_gap_min_s: 0, part_gap_max_s: 0, start_time: '00:00', stop_time: '23:59',
    days: JSON.stringify([0, 1, 2, 3, 4, 5, 6]), dedupe: 'all', created_at: Date.now(),
    ...over,
  };
  const keys = Object.keys(c);
  const id = db.run(`INSERT INTO campaigns (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...(Object.values(c) as any[])).lastId;
  return id;
}

function addRecipient(campaignId: number, phone: string, name: string | null, position: number) {
  return db.run('INSERT INTO recipients (campaign_id, phone, name, position) VALUES (?, ?, ?, ?)', campaignId, phone, name, position).lastId;
}

const rec = (id: number) => db.get<any>('SELECT * FROM recipients WHERE id = ?', id);
const camp = (id: number) => db.get<any>('SELECT * FROM campaigns WHERE id = ?', id);
/** Skip the waiting gap so the next tick may send. */
function clearGap(id: number) {
  db.run('UPDATE campaigns SET next_send_at = 0 WHERE id = ?', id);
  db.setSetting('global_next_send_at', 0);
}

beforeEach(() => {
  sent.length = 0;
  ready = true;
  db.run("UPDATE campaigns SET status = 'completed'"); // isolate each test
  db.setSetting('global_next_send_at', 0);
});

describe('sender engine', () => {
  it('sends intro → link → image 1 → image 2, in order, with rendered text', async () => {
    const c = makeCampaign();
    const r = addRecipient(c, '+919876500001', 'Priya Sharma', 0);
    await S.sender.runOnce();

    expect(sent.map((s) => s.kind + ':' + s.body)).toEqual(['text:Hi Priya', 'text:See https://demo.test', 'image:a.png', 'image:b.png']);
    expect(rec(r)).toMatchObject({ status: 'sent', parts_done: 4, intro_text: 'Hi Priya', variation_idx: 0 });
    expect(rec(r).sent_at).toBeGreaterThan(0);
    expect(db.get<any>('SELECT COUNT(*) n FROM wa_messages WHERE recipient_id = ?', r).n).toBe(4);
  });

  it('combined mode: one full text with the link, then the 2 screenshots', async () => {
    const c = makeCampaign({
      message_mode: 'combined',
      intro_variations: JSON.stringify([
        'Hi {{first_name|there}}, sample site for {{category}}: {{link}}\nWe can customize it with your brand colours, logo and photos.',
      ]),
    });
    const r = addRecipient(c, '+919876500071', 'Rahul Shah', 0);
    db.run("UPDATE recipients SET category = 'cafe' WHERE id = ?", r);
    await S.sender.runOnce();

    expect(sent.map((s) => s.kind + ':' + s.body)).toEqual([
      'text:Hi Rahul, sample site for cafe: https://demo.test\nWe can customize it with your brand colours, logo and photos.',
      'image:a.png',
      'image:b.png',
    ]);
    expect(rec(r)).toMatchObject({ status: 'sent', parts_done: 3, link_text: '' });
  });

  it('combined mode: resumes after the text and sends only the screenshots', async () => {
    const c = makeCampaign({ message_mode: 'combined' });
    const r = addRecipient(c, '+919876500072', 'Asha', 0);
    db.run(
      "UPDATE recipients SET status = 'sending', chat_id = '919876500072@c.us', intro_text = 'Hi Asha https://demo.test', link_text = '', variation_idx = 0, parts_done = 1, sent_at = ? WHERE id = ?",
      Date.now(), r,
    );
    await S.sender.runOnce();
    expect(sent.map((s) => s.body)).toEqual(['a.png', 'b.png']);
    expect(rec(r)).toMatchObject({ status: 'sent', parts_done: 3 });
  });

  it('waits for the gap, rotates variations and adds the break after N people', async () => {
    const c = makeCampaign();
    addRecipient(c, '+919876500011', 'Amit', 0);
    const r2 = addRecipient(c, '+919876500012', null, 1);
    addRecipient(c, '+919876500013', 'Neha', 2);

    await S.sender.runOnce();
    const afterFirst = camp(c).next_send_at - Date.now();
    expect(afterFirst).toBeGreaterThan(25_000);
    expect(afterFirst).toBeLessThanOrEqual(30_000);

    sent.length = 0;
    await S.sender.runOnce(); // still inside the gap: nothing happens
    expect(sent).toHaveLength(0);

    clearGap(c);
    await S.sender.runOnce();
    expect(rec(r2)).toMatchObject({ status: 'sent', intro_text: 'Hello there', variation_idx: 1 }); // fallback + rotation
    const afterSecond = camp(c).next_send_at - Date.now();
    expect(afterSecond).toBeGreaterThan(600_000); // 30 s gap + 10 min break after 2 people
  });

  it('skips opted-out numbers and marks numbers that are not on WhatsApp', async () => {
    const c = makeCampaign();
    db.run("INSERT INTO optouts (phone, reason, created_at) VALUES ('+919876500021', 'stop', 0)");
    const opted = addRecipient(c, '+919876500021', 'X', 0);
    const missing = addRecipient(c, '+919876500000', 'Y', 1);

    await S.sender.runOnce();
    expect(rec(opted).status).toBe('skipped_optout');
    await S.sender.runOnce();
    expect(rec(missing).status).toBe('not_on_wa');
    expect(sent).toHaveLength(0);

    clearGap(c);
    await S.sender.runOnce();
    expect(camp(c).status).toBe('completed');
  });

  it('resumes a half-sent person from the next part without repeating', async () => {
    const c = makeCampaign();
    const r = addRecipient(c, '+919876500031', 'Ravi', 0);
    db.run(
      "UPDATE recipients SET status = 'sending', chat_id = '919876500031@c.us', intro_text = 'Hi Ravi', link_text = 'See https://demo.test', variation_idx = 0, parts_done = 2, sent_at = ? WHERE id = ?",
      Date.now(), r,
    );
    await S.sender.runOnce();
    expect(sent.map((s) => s.body)).toEqual(['a.png', 'b.png']);
    expect(rec(r)).toMatchObject({ status: 'sent', parts_done: 4 });
  });

  it('does nothing while WhatsApp is disconnected', async () => {
    const c = makeCampaign();
    const r = addRecipient(c, '+919876500041', 'Z', 0);
    ready = false;
    await S.sender.runOnce();
    expect(rec(r).status).toBe('pending');
    expect(S.campaignWaitInfo(camp(c)).reason).toBe('whatsapp_disconnected');
  });

  it('stops at the per-campaign daily limit', async () => {
    const c = makeCampaign({ max_per_day: 1 });
    addRecipient(c, '+919876500051', 'A', 0);
    const second = addRecipient(c, '+919876500052', 'B', 1);
    await S.sender.runOnce();
    clearGap(c);
    await S.sender.runOnce();
    expect(rec(second).status).toBe('pending');
    expect(S.campaignWaitInfo(camp(c)).reason).toBe('daily_limit');
  });

  it('skips people already messaged by another campaign when dedupe is on', async () => {
    const c1 = makeCampaign();
    addRecipient(c1, '+919876500061', 'A', 0);
    await S.sender.runOnce();
    db.run("UPDATE campaigns SET status = 'completed' WHERE id = ?", c1);

    const c2 = makeCampaign({ dedupe: 'skip_ever_messaged' });
    const again = addRecipient(c2, '+919876500061', 'A', 0);
    clearGap(c2);
    sent.length = 0;
    await S.sender.runOnce();
    expect(rec(again).status).toBe('skipped_duplicate');
    expect(sent).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { estimateThroughput, validateTiming } from '../src/engine/estimate.js';
import { normalizePhone, parsePasted } from '../src/engine/phone.js';
import { isOptOutText } from '../src/engine/optout.js';
import { lintIntro, pickVariation, renderTemplate } from '../src/engine/spintax.js';
import { isWithinWindow, nextWindowOpen, startOfDay, tzOffsetSeconds, windowMinutes, zonedParts } from '../src/engine/window.js';

const TZ = 'Asia/Kolkata';
// 2026-11-16 is a Monday. 10:30 IST = 05:00 UTC.
const ist = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+05:30`);

describe('renderTemplate', () => {
  it('fills placeholders and fallbacks', () => {
    expect(renderTemplate('Hi {{first_name}}, {{business}}', { name: 'Priya Sharma', business: 'Sharma Dental' })).toBe(
      'Hi Priya, Sharma Dental',
    );
    expect(renderTemplate('Hi {{name|friend}}!', { name: null })).toBe('Hi friend!');
    expect(renderTemplate('Hi {{name}}, how are you', {})).toBe('Hi, how are you');
  });

  it('picks spintax options, including nested ones', () => {
    const seq = [0, 0.99];
    let i = 0;
    const rand = () => seq[i++ % seq.length];
    expect(renderTemplate('{Hi|Hello|Hey} there', {}, () => 0)).toBe('Hi there');
    expect(renderTemplate('{Hi|Hello|Hey} there', {}, () => 0.99)).toBe('Hey there');
    expect(renderTemplate('{Google {Maps|My Business}|GMB}', {}, rand)).toMatch(/^(Google Maps|Google My Business|GMB)$/);
  });

  it('does not treat braces inside values as spintax', () => {
    expect(renderTemplate('Hi {{business}}', { business: 'A{b|c}' }, () => 0)).toBe('Hi Ab|c');
  });

  it('inserts the link', () => {
    expect(renderTemplate('See {{link}}', { link: 'https://x.com' })).toBe('See https://x.com');
  });
});

describe('pickVariation', () => {
  it('rotates in order', () => {
    expect([0, 1, 2, 3, 4].map((c) => pickVariation(3, 'order', c))).toEqual([0, 1, 2, 0, 1]);
  });
  it('returns -1 with no variations', () => expect(pickVariation(0, 'order', 0)).toBe(-1));
});

describe('lintIntro', () => {
  it('warns about links and em dashes', () => {
    expect(lintIntro('Hi, see https://x.com')).toHaveLength(1);
    expect(lintIntro('Hi — there')).toHaveLength(1);
    expect(lintIntro('Hi, I got your number from Google Maps')).toHaveLength(0);
  });

  it('in combined mode wants {{link}} and allows it in the first message', () => {
    expect(lintIntro('Hi, see my sample: {{link}}', 'combined', true)).toHaveLength(0);
    expect(lintIntro('Hi there', 'combined', true)[0]).toContain('{{link}}');
    expect(lintIntro('Hi, see https://x.com', 'combined', true).length).toBeGreaterThan(0);
  });
});

describe('phone parsing', () => {
  it('normalises Indian numbers', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
    expect(normalizePhone('+91 99001 12233')).toBe('+919900112233');
    expect(normalizePhone('919876543210')).toBe('+919876543210');
    expect(normalizePhone('09876543210')).toBe('+919876543210');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('parses pasted lines with optional names and removes duplicates', () => {
    const { valid, invalid } = parsePasted('9876543210\n9812345678\n+91 99001 12233, Priya\n98765 43210\nabc\n');
    expect(valid).toEqual([
      { phone: '+919876543210', name: null },
      { phone: '+919812345678', name: null },
      { phone: '+919900112233', name: 'Priya' },
    ]);
    expect(invalid).toEqual(['abc']);
  });

  it('splits many numbers on one line (comma, semicolon or space separated)', () => {
    const { valid, invalid } = parsePasted('9892807545,9076455490,8454811021; 8108809151\n9594652404 9987088959, Ravi');
    expect(valid.map((v) => v.phone)).toEqual([
      '+919892807545', '+919076455490', '+918454811021', '+918108809151', '+919594652404', '+919987088959',
    ]);
    expect(valid.every((v) => v.phone !== '+919987088959' || v.name === 'Ravi')).toBe(true);
    expect(valid.filter((v) => v.name).length).toBe(1);
    expect(invalid).toEqual([]);
  });

  it('never uses phone numbers as a name in messages', () => {
    expect(renderTemplate('Hello {{first_name|there}}', { name: '9076455490,8454811021' })).toBe('Hello there');
  });
});

describe('send window', () => {
  const w = { start_time: '10:00', stop_time: '19:00', days: [1, 2, 3, 4, 5, 6] };

  it('reads local time parts', () => {
    const z = zonedParts(ist('2026-11-16', '10:30'), TZ);
    expect(z).toMatchObject({ date: '2026-11-16', hour: 10, minutes: 630, dow: 1 });
    expect(tzOffsetSeconds(Date.now(), TZ)).toBe(19800);
    expect(startOfDay(ist('2026-11-16', '10:30'), TZ)).toBe(ist('2026-11-16', '00:00'));
  });

  it('respects hours and days', () => {
    expect(isWithinWindow(ist('2026-11-16', '10:30'), w, TZ)).toBe(true);
    expect(isWithinWindow(ist('2026-11-16', '09:59'), w, TZ)).toBe(false);
    expect(isWithinWindow(ist('2026-11-16', '19:00'), w, TZ)).toBe(false);
    expect(isWithinWindow(ist('2026-11-15', '12:00'), w, TZ)).toBe(false); // Sunday
  });

  it('respects the first day', () => {
    expect(isWithinWindow(ist('2026-11-16', '12:00'), { ...w, start_date: '2026-11-17' }, TZ)).toBe(false);
    expect(isWithinWindow(ist('2026-11-17', '12:00'), { ...w, start_date: '2026-11-17' }, TZ)).toBe(true);
  });

  it('handles overnight windows', () => {
    const night = { start_time: '22:00', stop_time: '02:00', days: [1] }; // Monday night only
    expect(isWithinWindow(ist('2026-11-16', '23:00'), night, TZ)).toBe(true);
    expect(isWithinWindow(ist('2026-11-17', '01:00'), night, TZ)).toBe(true); // still Monday's window
    expect(isWithinWindow(ist('2026-11-18', '01:00'), night, TZ)).toBe(false); // Tuesday's window: not allowed
    expect(windowMinutes(night)).toBe(240);
  });

  it('finds the next opening', () => {
    // Saturday 20:00 → next is Monday 10:00 (Sunday is off).
    expect(nextWindowOpen(ist('2026-11-21', '20:00'), w, TZ)).toBe(ist('2026-11-23', '10:00'));
  });
});

describe('timing', () => {
  const base = {
    min_gap_s: 420, max_gap_s: 600, break_every: 10, break_len_s: 1800, max_per_day: 100,
    part_gap_min_s: 0, part_gap_max_s: 0, start_time: '10:00', stop_time: '19:00', days: [1, 2, 3, 4, 5, 6],
  };

  it('flags min > max like the reference UI', () => {
    const errors = validateTiming({ ...base, min_gap_s: 600, max_gap_s: 420 });
    expect(errors[0]).toContain('The minimum gap (10 minutes) is longer than the maximum gap (7 minutes)');
  });

  it('estimates about 5 messages per hour for 7–10 min gaps with 30 min breaks', () => {
    const est = estimateThroughput(base, 1);
    expect(Math.round(est.perHour)).toBe(5);
    expect(est.perDay).toBeLessThanOrEqual(100);
  });
});

describe('normalizeLink', async () => {
  // Imported lazily: campaigns.ts pulls in the DB, so point it at a temp folder first.
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-norm-'));
  const { normalizeLink } = await import('../src/routes/campaigns.js');
  const url = 'https://copper-kettle-cafe-nine.vercel.app/';

  it('turns a pasted demo URL (with or without slash) into {{link}}', () => {
    expect(normalizeLink('See https://copper-kettle-cafe-nine.vercel.app/ now', url)).toBe('See {{link}} now');
    expect(normalizeLink('See https://copper-kettle-cafe-nine.vercel.app now', url)).toBe('See {{link}} now');
  });

  it('fixes common typos', () => {
    expect(normalizeLink('See {link}', url)).toBe('See {{link}}');
    expect(normalizeLink('See [link] and (Link)', url)).toBe('See {{link}} and {{link}}');
    expect(normalizeLink('See {{ Link }}', url)).toBe('See {{link}}');
  });

  it('leaves spintax and other text alone', () => {
    expect(normalizeLink('{Hi|Hello} {{name|friend}}, no link here', url)).toBe('{Hi|Hello} {{name|friend}}, no link here');
  });
});

describe('opt-out detection', () => {
  it('detects clear opt-outs only', () => {
    expect(isOptOutText('STOP')).toBe(true);
    expect(isOptOutText('Not interested, thanks')).toBe(true);
    expect(isOptOutText('please band karo')).toBe(true);
    expect(isOptOutText('No')).toBe(false); // could be "no, we don't have a website"
    expect(isOptOutText('Yes interested, price?')).toBe(false);
  });
});

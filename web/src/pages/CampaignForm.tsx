import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Field, PageHeader, cx, inputCls } from '../components/ui';
import { api, type Campaign, type ContactList, type DemoKit } from '../lib/api';
import { DAY_NAMES } from '../lib/format';
import { useApi } from '../lib/hooks';

type Unit = 'seconds' | 'minutes' | 'hours';
const MULT: Record<Unit, number> = { seconds: 1, minutes: 60, hours: 3600 };
interface Dur {
  value: string;
  unit: Unit;
}
const toSec = (d: Dur) => Math.round(Number(d.value || 0) * MULT[d.unit]);
const fromSec = (s: number): Dur =>
  s % 3600 === 0 && s >= 3600 ? { value: String(s / 3600), unit: 'hours' } : s % 60 === 0 && s >= 60 ? { value: String(s / 60), unit: 'minutes' } : { value: String(s), unit: 'seconds' };
const durText = (d: Dur) => `${d.value || 0} ${Number(d.value) === 1 ? d.unit.slice(0, -1) : d.unit}`;

// "Separate" format: a short intro first, then the link message (link + customization pitch + a question).
const DEFAULT_INTROS = [
  '{Hi|Hello} {{first_name|there}}, I found {{business|your business}} on {Google Maps|Google My Business}.',
  '{Hi|Hello}, I got your number from {Google Maps|Google My Business}. Is this {{business|the right number for the business}}?',
  '{Hello|Hi}, I came across {{business|your business}} on Google Maps and {really liked|liked} your {listing|reviews}.',
  '{Hi|Hello}! I was looking at {local businesses|businesses in your area} on Google Maps and found {{business|yours}}.',
  '{Hello|Hi}, I {help|work with} local businesses like {{business|yours}} to get a proper website.',
  '{Hi|Hello}, quick message about {{business|your business}} on {Google Maps|Google My Business}.',
];
const DEFAULT_LINKS = [
  'I {made|designed} a sample website for businesses like yours:\n{{link}}\n\n' +
    'We can customize it with your brand colours, logo and photos, so it looks like your own website.\n\n' +
    'Would you like one for {{business|your business}}?',
  'Here is a demo website I {made|put together}:\n{{link}}\n\n' +
    'It can be fully customized with your logo, brand colours and your own photos.\n\n' +
    'Shall I make one for you?',
  'Have a look at this sample website:\n{{link}}\n\n' +
    'We will change it to match your brand colours, logo and images.\n\n' +
    'What do you think?',
  'Here is one example of my work:\n{{link}}\n\n' +
    'We can set it up for {{business|your business}} with your own logo, colours and photos.\n\n' +
    'Would you be interested?',
  'This is a sample website I {made|designed} for a business like yours:\n{{link}}\n\n' +
    'Everything can be customized: your brand colours, logo, photos and details.\n\n' +
    'Should I make a version for {{business|you}}?',
  'You can see a demo here:\n{{link}}\n\n' +
    'We will customize it with your brand colours, logo and images so it feels like your own website.\n\n' +
    'Can I show you how it would look for {{business|your business}}?',
];

// "One message" format: intro + demo link + customization pitch + a question, all in one text.
// No {{first_name}} here on purpose: Google Maps leads usually have a business name, not an owner name.
// Blank lines between paragraphs (\n\n) so the WhatsApp bubble doesn't look like one block of text.
const DEFAULT_FULL = [
  '{Hi|Hello}, I came across {{business|your business}} on {Google Maps|Google My Business}.\n\n' +
    'I {made|designed} a sample website for businesses like yours:\n{{link}}\n\n' +
    'We can customize it with your brand colours, logo and photos, so it looks like your own website.\n\n' +
    'Would you like one for {{business|your business}}?',
  '{Hi|Hello}, I saw {{business|your business}} on {Google Maps|Google My Business} and {made|put together} a demo website for you.\n\n' +
    'You can check it here:\n{{link}}\n\n' +
    'It can be fully customized with your logo, brand colours and your own photos.\n\n' +
    'Shall I make one for you?',
  '{Hello|Hi}! I {build|design} websites for local businesses.\n\n' +
    'Here is a sample one:\n{{link}}\n\n' +
    'I can set it up for {{business|your business}} with your brand colours, logo and images.\n\n' +
    'What do you think?',
  '{Hi|Hello}, I {found|noticed} {{business|your business}} on Google Maps.\n\n' +
    'I {build|design} websites for local businesses, here is one example:\n{{link}}\n\n' +
    'We can set it up with your own logo, brand colours and photos.\n\n' +
    'Would you be interested?',
  '{Hello|Hi}, I was looking at {local businesses|businesses in your area} on {Google Maps|Google} and found {{business|yours}}.\n\n' +
    'This is a sample website I {made|designed} for a business like yours:\n{{link}}\n\n' +
    'Everything can be customized: your brand colours, logo, photos and details.\n\n' +
    'Should I make a version for you?',
  '{Hi|Hello}, quick message about {{business|your business}} on {Google Maps|Google My Business}.\n\n' +
    'You can see a demo website here:\n{{link}}\n\n' +
    'We will customize it with your brand colours, logo and images so it feels like your own website.\n\n' +
    'Can I show you how it would look for {{business|your business}}?',
];

interface Preview {
  intros: { sample: string; warnings: string[] }[];
  links: string[];
  images: string[];
  errors: string[];
  estimate: { perHour: number; perDay: number; limitedBy: 'daily_cap' | 'window'; windowHours: number; days: number | null };
}

/** 12-hour time picker → "HH:MM" */
function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [h, m] = value.split(':').map(Number);
  const pm = h >= 12;
  const h12 = h % 12 || 12;
  const set = (nh12: number, nm: number, npm: boolean) => {
    const hh = (nh12 % 12) + (npm ? 12 : 0);
    onChange(`${String(hh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`);
  };
  return (
    <div className="flex gap-2">
      <select className={inputCls} value={h12} onChange={(e) => set(Number(e.target.value), m, pm)}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((x) => <option key={x}>{x}</option>)}
      </select>
      <select className={inputCls} value={m} onChange={(e) => set(h12, Number(e.target.value), pm)}>
        {Array.from({ length: 12 }, (_, i) => i * 5).map((x) => <option key={x} value={x}>{String(x).padStart(2, '0')}</option>)}
      </select>
      <div className="flex shrink-0 overflow-hidden rounded-lg border border-zinc-300 text-sm">
        {['AM', 'PM'].map((ap) => (
          <button key={ap} type="button" onClick={() => set(h12, m, ap === 'PM')} className={cx('px-3', (ap === 'PM') === pm ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600')}>
            {ap}
          </button>
        ))}
      </div>
    </div>
  );
}

function DurationInput({ value, onChange, units = ['seconds', 'minutes', 'hours'] }: { value: Dur; onChange: (d: Dur) => void; units?: Unit[] }) {
  return (
    <div className="flex">
      <input type="number" min={0} className={cx(inputCls, 'rounded-r-none')} value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })} />
      <select className="rounded-r-lg border border-l-0 border-zinc-300 bg-zinc-50 px-2 text-sm" value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as Unit })}>
        {units.map((u) => <option key={u}>{u}</option>)}
      </select>
    </div>
  );
}

function VariationList({ items, onChange, placeholder, rows = 2 }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; rows?: number }) {
  return (
    <div className="space-y-2">
      {items.map((v, i) => (
        <div key={i} className="flex gap-2">
          <span className="mt-2 w-5 shrink-0 text-right text-xs text-zinc-400">{i + 1}</span>
          <textarea
            rows={rows}
            className={inputCls}
            placeholder={placeholder}
            value={v}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button type="button" className="mt-2 text-zinc-400 hover:text-red-600 disabled:opacity-30" disabled={items.length <= 1} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <X size={16} />
          </button>
        </div>
      ))}
      <Button size="sm" type="button" onClick={() => onChange([...items, ''])}>
        <Plus size={13} /> Add variation
      </Button>
    </div>
  );
}

export function CampaignForm() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const navigate = useNavigate();
  const lists = useApi<ContactList[]>('/lists');
  const kits = useApi<DemoKit[]>('/demo-kits');
  const existing = useApi<Campaign>(editId ? `/campaigns/${editId}` : null);

  // 1. Basics
  const [name, setName] = useState('');
  const [listId, setListId] = useState('');
  const [pasted, setPasted] = useState('');
  const [dedupe, setDedupe] = useState<'skip_ever_messaged' | 'all'>('skip_ever_messaged');
  // 2. Messages
  const [mode, setMode] = useState<'combined' | 'separate'>('combined');
  const [fullTexts, setFullTexts] = useState<string[]>(DEFAULT_FULL);
  const [intros, setIntros] = useState<string[]>(DEFAULT_INTROS);
  const [links, setLinks] = useState<string[]>(DEFAULT_LINKS);
  const [rotation, setRotation] = useState<'order' | 'random'>('order');
  const [kitId, setKitId] = useState('');
  const [sendImages, setSendImages] = useState(true);
  // 3. Timer & safety
  const [minGap, setMinGap] = useState<Dur>({ value: '3', unit: 'minutes' });
  const [maxGap, setMaxGap] = useState<Dur>({ value: '7', unit: 'minutes' });
  const [breakEvery, setBreakEvery] = useState('10');
  const [breakLen, setBreakLen] = useState<Dur>({ value: '30', unit: 'minutes' });
  const [maxPerDay, setMaxPerDay] = useState('40');
  const [partMin, setPartMin] = useState<Dur>({ value: '5', unit: 'seconds' });
  const [partMax, setPartMax] = useState<Dur>({ value: '20', unit: 'seconds' });
  // 4. Schedule
  const [startTime, setStartTime] = useState('10:00');
  const [stopTime, setStopTime] = useState('19:00');
  const [startDate, setStartDate] = useState('');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);

  // Load an existing campaign into the form (edit mode).
  useEffect(() => {
    const c = existing.data;
    if (!c || loaded.current) return;
    loaded.current = true;
    setName(c.name);
    setDedupe(c.dedupe);
    setMode(c.message_mode);
    if (c.message_mode === 'combined') setFullTexts(c.intro_variations.length ? c.intro_variations : ['']);
    else setIntros(c.intro_variations.length ? c.intro_variations : ['']);
    setLinks(c.link_variations);
    setRotation(c.rotation);
    setKitId(c.demo_kit_id ? String(c.demo_kit_id) : '');
    setSendImages(c.send_images);
    setMinGap(fromSec(c.min_gap_s));
    setMaxGap(fromSec(c.max_gap_s));
    setBreakEvery(String(c.break_every));
    setBreakLen(fromSec(c.break_len_s));
    setMaxPerDay(String(c.max_per_day));
    setPartMin(fromSec(c.part_gap_min_s));
    setPartMax(fromSec(c.part_gap_max_s));
    setStartTime(c.start_time);
    setStopTime(c.stop_time);
    setStartDate(c.start_date ?? '');
    setDays(c.days);
  }, [existing.data]);

  // Pick the kit matching the selected list's name, if there is just one kit.
  useEffect(() => {
    if (!editId && !kitId && kits.data?.length === 1) setKitId(String(kits.data[0].id));
  }, [kits.data, kitId, editId]);

  // Rough count, same splitting as the server: one per line or comma/semicolon/tab separated;
  // a chunk with too many digits for one number ("9076455490 8454811021") counts its space-separated parts.
  const digits = (s: string) => s.replace(/\D/g, '').length;
  const pastedCount = useMemo(
    () =>
      pasted
        .split(/[\n,;\t|]/)
        .filter((t) => digits(t) >= 7)
        .reduce((n, t) => n + (digits(t) > 13 ? t.trim().split(/\s+/).filter((p) => digits(p) >= 7).length : 1), 0),
    [pasted],
  );
  const listSize = lists.data?.find((l) => String(l.id) === listId)?.size ?? 0;
  const recipientsApprox = editId ? existing.data?.counts.pending ?? 0 : listSize + pastedCount;

  const body = {
    name,
    list_id: listId ? Number(listId) : null,
    pasted,
    dedupe,
    message_mode: mode,
    intro_variations: (mode === 'combined' ? fullTexts : intros).filter((s) => s.trim()),
    link_variations: mode === 'separate' && kitId ? links.filter((s) => s.trim()) : [],
    rotation,
    demo_kit_id: kitId ? Number(kitId) : null,
    send_images: sendImages,
    min_gap_s: toSec(minGap),
    max_gap_s: toSec(maxGap),
    break_every: Number(breakEvery || 0),
    break_len_s: toSec(breakLen),
    max_per_day: Number(maxPerDay || 0),
    part_gap_min_s: toSec(partMin),
    part_gap_max_s: toSec(partMax),
    start_time: startTime,
    stop_time: stopTime,
    start_date: startDate || null,
    days,
  };
  const bodyKey = JSON.stringify({ ...body, pasted: undefined, name: undefined, recipients_count: recipientsApprox });

  // Live preview + validation (debounced).
  useEffect(() => {
    const t = setTimeout(() => {
      api<Preview>('/campaigns/preview', { body: { ...body, recipients_count: recipientsApprox } })
        .then(setPreview)
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey]);

  async function submit(start: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (editId) {
        await api(`/campaigns/${editId}`, { method: 'PUT', body });
        navigate(`/campaigns/${editId}`);
      } else {
        const r = await api<{ id: number; recipients: number; skippedOptout: number; skippedDuplicate: number; invalid: string[] }>('/campaigns', {
          body: { ...body, start },
        });
        const notes = [
          r.skippedOptout && `${r.skippedOptout} opted-out removed`,
          r.skippedDuplicate && `${r.skippedDuplicate} already-messaged removed`,
          r.invalid.length && `${r.invalid.length} invalid numbers skipped`,
        ].filter(Boolean);
        if (notes.length) alert(`Campaign created with ${r.recipients} numbers.\n${notes.join('\n')}`);
        navigate(`/campaigns/${r.id}`);
      }
    } catch (e) {
      setError((e as Error).message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  }

  const kit = kits.data?.find((k) => String(k.id) === kitId);
  const timingErrors = preview?.errors ?? [];
  const est = preview?.estimate;

  return (
    <>
      <PageHeader title={editId ? 'Edit campaign' : 'New campaign'} subtitle="Numbers, messages, timer and schedule, all in one place." />
      {error && <div className="mb-4"><Alert tone="red">{error}</Alert></div>}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="1. Basics">
            <div className="space-y-4">
              <Field label="Campaign name">
                <input className={inputCls} placeholder="Dentists Pune – Nov" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              {!editId && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Contact list" hint={<>Manage lists on the <Link to="/contacts" className="underline">Contacts</Link> page. Opted-out numbers are removed automatically.</>}>
                    <select className={inputCls} value={listId} onChange={(e) => setListId(e.target.value)}>
                      <option value="">None</option>
                      {lists.data?.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.size})</option>)}
                    </select>
                  </Field>
                  <Field label="…and/or paste numbers" hint="One number per line. Names optional. No need to add +91.">
                    <textarea className={cx(inputCls, 'h-24 font-mono')} placeholder={'9876543210\n9812345678\n+91 99001 12233, Priya\nor: 9876543210, 9812345678, 9900112233'} value={pasted} onChange={(e) => setPasted(e.target.value)} />
                  </Field>
                </div>
              )}
              <Field label="Already messaged people" hint="Duplicates and opted-out numbers are always removed. This also avoids messaging the same person again from another campaign.">
                <select className={inputCls} value={dedupe} onChange={(e) => setDedupe(e.target.value as typeof dedupe)}>
                  <option value="skip_ever_messaged">Skip anyone messaged before (recommended)</option>
                  <option value="all">Send to everyone on the list</option>
                </select>
              </Field>
            </div>
          </Card>

          <Card
            title="2. Messages"
            subtitle={<>Each person gets one intro variation. Use <code>{'{{name}}'}</code>, <code>{'{{first_name}}'}</code>, <code>{'{{business}}'}</code>, <code>{'{{city}}'}</code>, <code>{'{{name|friend}}'}</code> (fallback) and <code>{'{Hi|Hello|Hey}'}</code> to randomly pick a word. More variations = safer for your number.</>}
            actions={
              <select className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm" value={rotation} onChange={(e) => setRotation(e.target.value as typeof rotation)}>
                <option value="order">Rotate in order (1 → 2 → 3 → 1…)</option>
                <option value="random">Random</option>
              </select>
            }
          >
            <div className="space-y-5">
              <div>
                <div className="mb-1.5 text-sm font-medium">Message style</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    { v: 'combined', title: 'One message', desc: 'Intro + demo link + customization pitch in one text, then the 2 screenshots. 3 messages per person.' },
                    { v: 'separate', title: 'Separate messages', desc: 'Intro first, then the link, then the 2 screenshots. 4 messages per person.' },
                  ] as const).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setMode(o.v)}
                      className={cx('rounded-lg border p-3 text-left', mode === o.v ? 'border-zinc-900 ring-1 ring-zinc-900' : 'border-zinc-300 hover:bg-zinc-50')}
                    >
                      <div className="text-sm font-medium">{o.title}</div>
                      <div className="mt-0.5 text-xs text-zinc-500">{o.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <Field label="Demo kit" hint={<>The link and screenshots come from the kit. Add kits on the <Link to="/demo-kits" className="underline">Demo kits</Link> page.</>}>
                <select className={inputCls} value={kitId} onChange={(e) => setKitId(e.target.value)}>
                  <option value="">No demo kit (text only)</option>
                  {kits.data?.map((k) => <option key={k.id} value={k.id}>{k.category} — {k.demo_url}</option>)}
                </select>
              </Field>

              {mode === 'combined' ? (
                <div>
                  <div className="mb-2 text-sm font-medium">
                    Full message {kitId && <span className="font-normal text-zinc-500">(must contain <code>{'{{link}}'}</code>, it becomes the demo website link)</span>}
                  </div>
                  <VariationList
                    items={fullTexts}
                    onChange={setFullTexts}
                    rows={11}
                    placeholder={'Hi, I came across {{business|your business}} on Google Maps.\n\nI made a sample website for businesses like yours:\n{{link}}\n\nWe can customize it with your brand colours, logo and photos.\n\nWould you like one?'}
                  />
                  <div className="mt-1 text-xs text-zinc-500">Tip: paragraphs ke beech ek khali line chhodo (Enter do baar), WhatsApp mein message saaf dikhega.</div>
                </div>
              ) : (
                <>
                  <div>
                    <div className="mb-2 text-sm font-medium">Intro message (sent first)</div>
                    <VariationList items={intros} onChange={setIntros} placeholder="Hi {{first_name|there}}, I got your number from Google Maps…" />
                  </div>
                  {kitId && (
                    <div>
                      <div className="mb-2 text-sm font-medium">Link message (sent second, must contain <code>{'{{link}}'}</code>)</div>
                      <VariationList items={links.length ? links : ['']} onChange={setLinks} rows={8} placeholder={'Here is a sample website I made:\n{{link}}\n\nWe can customize it with your brand colours, logo and photos.\n\nWould you like one?'} />
                    </div>
                  )}
                </>
              )}

              {kitId && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={sendImages} onChange={(e) => setSendImages(e.target.checked)} />
                  Send the 2 screenshots after the {mode === 'combined' ? 'message' : 'link'}{' '}
                  {kit && !kit.image1 && !kit.image2 && <span className="text-amber-700">(this kit has no screenshots yet)</span>}
                </label>
              )}
            </div>
          </Card>

          <Card title="3. Timer & safety" subtitle="After each person we wait a random time between the minimum and maximum gap, so sending looks natural.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Minimum gap between people" hint="Shortest wait before the next person.">
                <DurationInput value={minGap} onChange={setMinGap} />
              </Field>
              <Field label="Maximum gap between people" hint="Longest wait before the next person.">
                <DurationInput value={maxGap} onChange={setMaxGap} />
              </Field>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field label="Take a break after every" hint="0 = no breaks">
                <div className="flex">
                  <input type="number" min={0} className={cx(inputCls, 'rounded-r-none')} value={breakEvery} onChange={(e) => setBreakEvery(e.target.value)} />
                  <span className="flex items-center rounded-r-lg border border-l-0 border-zinc-300 bg-zinc-50 px-2 text-sm text-zinc-500">people</span>
                </div>
              </Field>
              <Field label="Break length">
                <DurationInput value={breakLen} onChange={setBreakLen} units={['minutes', 'hours']} />
              </Field>
              <Field label="Maximum people per day">
                <input type="number" min={1} className={inputCls} value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} />
              </Field>
            </div>
            {kitId && (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="Gap between intro, link and screenshots (min)">
                  <DurationInput value={partMin} onChange={setPartMin} units={['seconds', 'minutes']} />
                </Field>
                <Field label="Gap between intro, link and screenshots (max)">
                  <DurationInput value={partMax} onChange={setPartMax} units={['seconds', 'minutes']} />
                </Field>
              </div>
            )}

            {timingErrors.length > 0 && (
              <div className="mt-4 space-y-2">
                {timingErrors.map((e) => <Alert key={e} tone="red">{e}</Alert>)}
              </div>
            )}
            {est && (
              <div className="mt-4 rounded-lg bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                Each person waits a random <b>{durText(minGap)} to {durText(maxGap)}</b>.
                {Number(breakEvery) > 0 && <> After every <b>{breakEvery} people</b> it rests for <b>{durText(breakLen)}</b>.</>} That is about{' '}
                <b>{est.perHour} people per hour</b>, up to <b>{est.perDay} per day</b>
                {est.limitedBy === 'window' ? ` (limited by your ${est.windowHours}-hour sending window)` : ''}.
                {est.days != null && recipientsApprox > 0 && <> {recipientsApprox} numbers will take about <b>{est.days} sending day{est.days === 1 ? '' : 's'}</b>.</>}
              </div>
            )}
          </Card>

          <Card title="4. Schedule">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Start sending at">
                <TimePicker value={startTime} onChange={setStartTime} />
              </Field>
              <Field label="Stop sending at">
                <TimePicker value={stopTime} onChange={setStopTime} />
              </Field>
              <Field label="Timezone">
                <input className={inputCls} value="Asia/Kolkata (IST)" disabled />
              </Field>
              <Field label="First day to send (optional)" hint="Leave empty to start as soon as you press Start.">
                <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
            </div>
            <div className="mt-4">
              <div className="mb-1.5 text-sm font-medium">Days</div>
              <div className="flex flex-wrap gap-2">
                {DAY_NAMES.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}
                    className={cx('rounded-full border px-3 py-1 text-sm', days.includes(i) ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-600')}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <div className="flex flex-wrap gap-2 pb-8">
            {editId ? (
              <Button variant="primary" onClick={() => submit(false)} disabled={busy}>Save changes</Button>
            ) : (
              <>
                <Button variant="primary" onClick={() => submit(true)} disabled={busy}>Start campaign</Button>
                <Button onClick={() => submit(false)} disabled={busy}>Save as draft</Button>
              </>
            )}
            <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
          </div>
        </div>

        {/* Live preview, shaped like a WhatsApp chat */}
        <div className="xl:sticky xl:top-6 xl:self-start">
          <Card title="Preview" subtitle="How one person will see it (sample contact: Priya Sharma, Sharma Dental Clinic).">
            <div className="space-y-2 rounded-lg bg-[#efeae2] p-3">
              {preview?.intros[0] && <Bubble text={preview.intros[0].sample} />}
              {preview?.links[0] && <Bubble text={preview.links[0]} />}
              {preview?.images.map((img) => (
                <div key={img} className="ml-auto w-40 rounded-lg bg-[#d9fdd3] p-1 shadow-sm">
                  <img src={`/uploads/${img}`} alt="" className="aspect-[3/4] w-full rounded object-cover object-top" />
                </div>
              ))}
              {!preview?.intros.length && <div className="py-6 text-center text-xs text-zinc-500">Write an intro to see the preview.</div>}
            </div>
            {preview && preview.intros.length > 1 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-zinc-600">All {preview.intros.length} intro variations</summary>
                <ol className="mt-2 list-decimal space-y-2 pl-5 text-zinc-700">
                  {preview.intros.map((x, i) => <li key={i}>{x.sample}</li>)}
                </ol>
              </details>
            )}
            {preview?.intros.some((x) => x.warnings.length) && (
              <div className="mt-3 space-y-2">
                {preview.intros.flatMap((x, i) =>
                  x.warnings.map((w) => (
                    <Alert key={`${i}-${w}`}>
                      <b>Message {i + 1}:</b> {w}
                    </Alert>
                  )),
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Bubble({ text }: { text: string }) {
  return <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-[#d9fdd3] px-3 py-2 text-sm shadow-sm">{text}</div>;
}

import { Pause, Pencil, Play, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Empty, PageHeader, Progress, Stat, Ticks, inputCls } from '../components/ui';
import { api, type Campaign, type DemoKit } from '../lib/api';
import { CAMPAIGN_STATUS, DAY_NAMES, RECIPIENT_STATUS, fmtDateTime, fmtDuration, fmtHHMM, pct, waitText } from '../lib/format';
import { useApi, useNow } from '../lib/hooks';

interface Detail extends Campaign {
  kit: DemoKit | null;
  sent_today: number;
  estimate: { perHour: number; perDay: number; days_left: number | null };
}

interface Recipient {
  id: number;
  phone: string;
  name: string | null;
  business: string | null;
  status: string;
  intro_text: string | null;
  variation_idx: number | null;
  sent_at: number | null;
  replied_at: number | null;
  error: string | null;
  max_ack: number | null;
}

const FILTERS = [
  { v: '', label: 'All' },
  { v: 'pending', label: 'Pending' },
  { v: 'sent', label: 'Sent' },
  { v: 'replied', label: 'Replied' },
  { v: 'failed', label: 'Failed' },
  { v: 'not_on_wa', label: 'Not on WhatsApp' },
  { v: 'skipped', label: 'Skipped' },
];
const PAGE = 100;

export function CampaignDetail() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const now = useNow(5000);
  const { data: c, error } = useApi<Detail>(`/campaigns/${id}`, ['campaign', 'stats', 'wa:status']);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const recips = useApi<{ rows: Recipient[]; total: number }>(
    `/campaigns/${id}/recipients?${new URLSearchParams({ status: filter, q, limit: String(limit) })}`,
    ['campaign'],
  );
  const [busy, setBusy] = useState(false);

  async function act(action: 'start' | 'pause' | 'stop' | 'delete') {
    if (action === 'stop' && !confirm('Stop this campaign for good? Remaining numbers will be cancelled. (Use Pause if you want to continue later.)')) return;
    if (action === 'delete' && !confirm('Delete this campaign and its history?')) return;
    setBusy(true);
    try {
      if (action === 'delete') {
        await api(`/campaigns/${id}`, { method: 'DELETE' });
        navigate('/campaigns');
      } else {
        await api(`/campaigns/${id}/${action}`, { method: 'POST' });
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert tone="red">{error}</Alert>;
  if (!c) return <div className="text-sm text-zinc-500">Loading…</div>;

  const k = c.counts;
  const done = k.total - k.pending;
  const st = CAMPAIGN_STATUS[c.status];

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={`Created ${fmtDateTime(c.created_at)}`}
        actions={
          <>
            <Badge tone={st.tone} dot>{st.label}</Badge>
            {(c.status === 'draft' || c.status === 'paused') && (
              <Button variant="primary" disabled={busy} onClick={() => act('start')}><Play size={14} /> {c.status === 'draft' ? 'Start' : 'Resume'}</Button>
            )}
            {c.status === 'running' && <Button disabled={busy} onClick={() => act('pause')}><Pause size={14} /> Pause</Button>}
            {(c.status === 'draft' || c.status === 'paused') && (
              <Button disabled={busy} onClick={() => navigate(`/campaigns/${id}/edit`)}><Pencil size={14} /> Edit</Button>
            )}
            {['draft', 'running', 'paused'].includes(c.status) && (
              <Button variant="danger" disabled={busy} onClick={() => act('stop')}><Square size={14} /> Stop</Button>
            )}
            {c.status !== 'running' && <Button variant="ghost" disabled={busy} onClick={() => act('delete')}><Trash2 size={14} /></Button>}
          </>
        }
      />

      {c.status === 'running' && (
        <div className="mb-4">
          <Alert tone={c.wait.reason === 'whatsapp_disconnected' ? 'red' : c.wait.reason === 'ready' || c.wait.reason === 'gap' ? 'green' : 'amber'}>
            {waitText(c, now)}
            {c.wait.reason === 'whatsapp_disconnected' && <> — <Link to="/whatsapp" className="font-medium underline">connect WhatsApp</Link></>}
          </Alert>
        </div>
      )}

      <Card className="mb-4">
        <div className="mb-2 flex justify-between text-sm">
          <span className="font-medium">{done} of {k.total} done</span>
          <span className="text-zinc-500">
            {c.sent_today}/{c.max_per_day} today · ~{c.estimate.perHour}/hour
            {c.estimate.days_left != null && k.pending > 0 && <> · ~{c.estimate.days_left} sending day{c.estimate.days_left === 1 ? '' : 's'} left</>}
          </span>
        </div>
        <Progress value={done} max={k.total} />
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Stat label="Pending" value={k.pending} />
        <Stat label="Sent" value={k.sent} />
        <Stat label="Delivered" tone="green" value={k.delivered} hint={pct(k.delivered, k.sent)} />
        <Stat label="Read" tone="blue" value={k.read} hint={pct(k.read, k.sent)} />
        <Stat label="Replied" tone="green" value={k.replied} hint={pct(k.replied, k.sent)} />
        <Stat label="Failed" tone="red" value={k.failed} />
        <Stat label="Not on WhatsApp" tone="amber" value={k.not_on_wa} />
      </div>

      <Card className="mt-4" title="Recipients">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.v}
                onClick={() => { setFilter(f.v); setLimit(PAGE); }}
                className={`rounded-full px-3 py-1 text-xs ${filter === f.v ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input className={`${inputCls} ml-auto max-w-56 !py-1.5`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {recips.data?.rows.length ? (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr className="border-b border-zinc-100">
                  {['Name', 'Phone', 'Status', 'Ticks', 'Message', 'Sent', 'Reply'].map((h) => <th key={h} className="px-4 py-2 font-medium first:pl-5">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {recips.data.rows.map((r) => {
                  const s = RECIPIENT_STATUS[r.status] ?? { label: r.status, tone: 'gray' as const };
                  return (
                    <tr key={r.id} className="border-b border-zinc-50 align-top hover:bg-zinc-50">
                      <td className="py-2 pl-5 pr-4">
                        <div>{r.name ?? '—'}</div>
                        {r.business && <div className="text-xs text-zinc-500">{r.business}</div>}
                      </td>
                      <td className="px-4 py-2 tabular-nums">{r.phone}</td>
                      <td className="px-4 py-2">
                        <Badge tone={s.tone}>{s.label}</Badge>
                        {r.error && <div className="mt-1 max-w-48 text-xs text-red-600">{r.error}</div>}
                      </td>
                      <td className="px-4 py-2"><Ticks ack={r.max_ack} /></td>
                      <td className="max-w-xs px-4 py-2 text-xs text-zinc-600">
                        {r.intro_text ? <span title={r.intro_text}>{r.variation_idx != null && r.variation_idx >= 0 && <b className="text-zinc-400">#{r.variation_idx + 1} </b>}{r.intro_text.length > 90 ? r.intro_text.slice(0, 90) + '…' : r.intro_text}</span> : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-500">{fmtDateTime(r.sent_at)}</td>
                      <td className="px-4 py-2">{r.replied_at ? <Link to="/replies" className="text-xs font-medium text-green-700 underline">Replied</Link> : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No recipients match.</Empty>
        )}
        {recips.data && recips.data.total > recips.data.rows.length && (
          <div className="mt-3 text-center">
            <Button size="sm" onClick={() => setLimit(limit + PAGE)}>Load more ({recips.data.total - recips.data.rows.length} left)</Button>
          </div>
        )}
      </Card>

      <Card className="mt-4" title="Settings">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <Row k="Gap between people" v={`${fmtDuration(c.min_gap_s)} – ${fmtDuration(c.max_gap_s)}`} />
          <Row k="Breaks" v={c.break_every ? `${fmtDuration(c.break_len_s)} after every ${c.break_every}` : 'None'} />
          <Row k="Max per day" v={String(c.max_per_day)} />
          <Row k="Sending hours" v={`${fmtHHMM(c.start_time)} – ${fmtHHMM(c.stop_time)} IST`} />
          <Row k="Days" v={c.days.map((d) => DAY_NAMES[d]).join(', ')} />
          <Row k="First day" v={c.start_date ?? 'Immediately'} />
          <Row k="Demo kit" v={c.kit ? `${c.kit.category} (${c.kit.demo_url})` : 'None'} />
          <Row k="Message style" v={c.message_mode === 'combined' ? 'One message, then screenshots' : 'Intro → link → screenshots'} />
          <Row
            k="Variations"
            v={
              c.message_mode === 'combined'
                ? `${c.intro_variations.length} full-message · ${c.rotation === 'order' ? 'in order' : 'random'}`
                : `${c.intro_variations.length} intro · ${c.link_variations.length} link · ${c.rotation === 'order' ? 'in order' : 'random'}`
            }
          />
        </dl>
      </Card>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-zinc-50 py-1">
      <dt className="text-zinc-500">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}

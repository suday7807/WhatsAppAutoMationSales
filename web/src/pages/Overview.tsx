import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Alert, Badge, Button, Card, Empty, PageHeader, Stat, inputCls } from '../components/ui';
import { api, type Counts } from '../lib/api';
import { CAMPAIGN_STATUS, pct } from '../lib/format';
import { useApi } from '../lib/hooks';

interface OverviewData {
  summary: { sent_today: number; daily_cap: number; running: number; campaigns: number; contacts: number; optouts: number; wa_state: string };
  results: Counts;
  daily: { date: string; sent: number; delivered: number; read: number; failed: number }[];
  hours: { hour: number; sent: number; replied: number; rate: number }[];
  reasons: { reason: string; n: number }[];
  campaigns: { id: number; name: string; status: keyof typeof CAMPAIGN_STATUS; created_at: number; counts: Counts | null }[];
}

// Validated categorical slots 1–3 (dataviz reference palette, light).
const SERIES = [
  { key: 'sent', label: 'Sent', color: '#2a78d6' },
  { key: 'delivered', label: 'Delivered', color: '#eb6834' },
  { key: 'read', label: 'Read', color: '#1baf7a' },
] as const;
const AXIS = { stroke: '#c3c2b7', tick: { fill: '#898781', fontSize: 11 }, tickLine: false };
const RANGES = [
  { v: '7', label: '7d' },
  { v: '14', label: '14d' },
  { v: '30', label: '30d' },
  { v: '90', label: '90d' },
  { v: 'all', label: 'All time' },
];
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;

function ChartTooltip({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-medium text-zinc-900">{fmt ? fmt(label) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-zinc-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium text-zinc-900 tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Overview() {
  const [range, setRange] = useState('30');
  const { data } = useApi<OverviewData>(`/stats/overview?range=${range}`, ['stats', 'campaign', 'wa:status']);
  const navigate = useNavigate();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const r = data?.results;
  const s = data?.summary;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Your messaging at a glance"
        actions={
          <Button variant="primary" onClick={() => navigate('/campaigns/new')}>
            <Plus size={16} /> New campaign
          </Button>
        }
      />

      {s && s.wa_state !== 'ready' && (
        <div className="mb-5">
          <Alert tone="gray">
            WhatsApp is not connected.{' '}
            <Link to="/whatsapp" className="font-medium underline">
              Connect now
            </Link>{' '}
            to start sending.
          </Alert>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sent today" tone="green" value={s ? `${s.sent_today} / ${s.daily_cap}` : '–'} hint={<DailyCapEditor cap={s?.daily_cap} />} />
        <Stat label="Running campaigns" value={s?.running ?? '–'} hint={`${s?.campaigns ?? 0} total`} />
        <Stat label="Contacts" value={s?.contacts ?? '–'} hint={<Link to="/contacts" className="underline">Manage</Link>} />
        <Stat label="Opted out" tone="red" value={s?.optouts ?? '–'} hint="Replied STOP or added by you" />
      </div>

      <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Results, {range === 'all' ? 'all time' : `last ${range} days`}</h2>
        <div className="flex rounded-full border border-zinc-200 bg-white p-0.5">
          {RANGES.map((x) => (
            <button
              key={x.v}
              onClick={() => setRange(x.v)}
              className={`rounded-full px-3 py-1 text-xs ${range === x.v ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total numbers" value={r?.total ?? 0} hint={`${r?.pending ?? 0} pending`} />
        <Stat label="Sent" value={r?.sent ?? 0} hint="Single tick or better" />
        <Stat label="Delivered" tone="green" value={r?.delivered ?? 0} hint={`${pct(r?.delivered ?? 0, r?.sent ?? 0)} of sent`} />
        <Stat label="Read" tone="blue" value={r?.read ?? 0} hint={`${pct(r?.read ?? 0, r?.sent ?? 0)} of sent`} />
        <Stat label="Not delivered yet" tone="amber" value={r?.not_delivered ?? 0} hint="Sent, still single tick" />
        <Stat label="Failed" tone="red" value={r?.failed ?? 0} />
        <Stat label="Not on WhatsApp" tone="red" value={r?.not_on_wa ?? 0} />
        <Stat label="Replied" tone="green" value={r?.replied ?? 0} hint={`${pct(r?.replied ?? 0, r?.sent ?? 0)} of sent`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Funnel" subtitle="Out of every message sent, how many reached each step.">
          {r && r.sent > 0 ? (
            <div className="space-y-3">
              {[
                { label: 'Sent', n: r.sent },
                { label: 'Delivered', n: r.delivered },
                { label: 'Read', n: r.read },
                { label: 'Replied', n: r.replied },
              ].map((step) => (
                <div key={step.label}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-zinc-600">{step.label}</span>
                    <span className="font-medium tabular-nums text-zinc-900">
                      {step.n} <span className="text-zinc-500">({pct(step.n, r.sent)})</span>
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded bg-zinc-100">
                    <div className="h-full rounded bg-[#2a78d6]" style={{ width: `${(step.n / r.sent) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Send a campaign to see the funnel.</Empty>
          )}
        </Card>
        <Card title="Why messages did not go" subtitle="Top reasons in this period.">
          {data?.reasons.length ? (
            <ul className="divide-y divide-zinc-100 text-sm">
              {data.reasons.map((x) => (
                <li key={x.reason} className="flex justify-between gap-4 py-2">
                  <span className="text-zinc-700">{x.reason}</span>
                  <span className="font-medium tabular-nums">{x.n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing failed. 🎉</Empty>
          )}
        </Card>
      </div>

      <Card className="mt-4" title="Daily activity" subtitle="Intro messages sent, delivered and read per day (IST).">
        {data && data.daily.some((d) => d.sent || d.delivered || d.read) ? (
          <>
            <div className="mb-2 flex flex-wrap gap-4 text-xs text-zinc-600">
              {SERIES.map((x) => (
                <span key={x.key} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: x.color }} />
                  {x.label} <span className="font-medium text-zinc-900">{data.daily.reduce((a, d) => a + d[x.key], 0)}</span>
                </span>
              ))}
            </div>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={data.daily} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="#e1e0d9" vertical={false} />
                  <XAxis dataKey="date" {...AXIS} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
                  <YAxis {...AXIS} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#c3c2b7' }} />
                  {SERIES.map((x) => (
                    <Line key={x.key} type="linear" dataKey={x.key} name={x.label} stroke={x.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <Empty>No messages in this period yet.</Empty>
        )}
      </Card>

      <Card className="mt-4" title="Best time to send" subtitle="Reply rate by the hour the intro went out (IST).">
        {data?.hours.length ? (
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={data.hours.map((h) => ({ ...h, ratePct: Math.round(h.rate * 1000) / 10 }))} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#e1e0d9" vertical={false} />
                <XAxis dataKey="hour" {...AXIS} tickFormatter={hourLabel} />
                <YAxis {...AXIS} axisLine={false} unit="%" />
                <Tooltip
                  cursor={{ fill: '#f4f4f5' }}
                  content={({ active, payload }: any) =>
                    active && payload?.length ? (
                      <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm">
                        <div className="font-medium">{hourLabel(payload[0].payload.hour)}</div>
                        <div className="text-zinc-600">
                          {payload[0].payload.replied} replies / {payload[0].payload.sent} sent ({payload[0].payload.ratePct}%)
                        </div>
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="ratePct" name="Reply rate" fill="#2a78d6" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty>Send a few campaigns to see which hours work best.</Empty>
        )}
      </Card>

      <Card className="mt-4" title="Campaigns compared" subtitle="All-time results for your latest campaigns.">
        {data?.campaigns.length ? (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr className="border-b border-zinc-100">
                  {['Campaign', 'Status', 'Sent', 'Delivered', 'Read', 'Replied', 'Failed'].map((h) => (
                    <th key={h} className="px-5 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-zinc-50 hover:bg-zinc-50">
                    <td className="px-5 py-2.5">
                      <Link to={`/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    </td>
                    <td className="px-5 py-2.5"><Badge tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Badge></td>
                    <td className="px-5 py-2.5 tabular-nums">{c.counts?.sent ?? 0} / {c.counts?.total ?? 0}</td>
                    <td className="px-5 py-2.5 tabular-nums">{c.counts?.delivered ?? 0}</td>
                    <td className="px-5 py-2.5 tabular-nums">{c.counts?.read ?? 0}</td>
                    <td className="px-5 py-2.5 tabular-nums">{c.counts?.replied ?? 0}</td>
                    <td className="px-5 py-2.5 tabular-nums">{(c.counts?.failed ?? 0) + (c.counts?.not_on_wa ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No campaigns yet.</Empty>
        )}
      </Card>

      <Card className="mt-4" title="Export report (Excel)" subtitle="Every number with status, message text, ticks and replies.">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-zinc-600">From</span>
            <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-600">To</span>
            <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <a href={`/api/export.xlsx?from=${from}&to=${to}`} className="rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-zinc-50">
            Download .xlsx
          </a>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Leave dates empty to export everything.</p>
      </Card>
    </>
  );
}

function DailyCapEditor({ cap }: { cap?: number }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  if (!editing)
    return (
      <button className="underline" onClick={() => { setValue(String(cap ?? 40)); setEditing(true); }}>
        Overall daily cap: {cap ?? '–'} (edit)
      </button>
    );
  return (
    <span className="flex items-center gap-1">
      <input className="w-16 rounded border border-zinc-300 px-1 py-0.5 text-xs" value={value} onChange={(e) => setValue(e.target.value)} />
      <button
        className="font-medium text-zinc-900 underline"
        onClick={async () => {
          try {
            await api('/stats/settings', { method: 'PUT', body: { global_daily_cap: Number(value) } });
            setEditing(false);
          } catch (e) {
            alert((e as Error).message);
          }
        }}
      >
        Save
      </button>
    </span>
  );
}

import { Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Empty, PageHeader, Progress } from '../components/ui';
import type { Campaign } from '../lib/api';
import { CAMPAIGN_STATUS, fmtDate, waitText } from '../lib/format';
import { useApi, useNow } from '../lib/hooks';

export function Campaigns() {
  const { data, loading } = useApi<Campaign[]>('/campaigns', ['campaign', 'wa:status']);
  const navigate = useNavigate();
  const now = useNow();

  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle="Each campaign sends intro → link → 2 screenshots to every number, slowly and safely."
        actions={
          <Button variant="primary" onClick={() => navigate('/campaigns/new')}>
            <Plus size={16} /> New campaign
          </Button>
        }
      />
      <Card>
        {data?.length ? (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr className="border-b border-zinc-100">
                  {['Campaign', 'Status', 'Progress', 'Delivered', 'Read', 'Replied', 'Created'].map((h) => (
                    <th key={h} className="px-5 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((c) => {
                  const done = c.counts.total - c.counts.pending;
                  return (
                    <tr key={c.id} className="cursor-pointer border-b border-zinc-50 hover:bg-zinc-50" onClick={() => navigate(`/campaigns/${c.id}`)}>
                      <td className="px-5 py-3">
                        <Link to={`/campaigns/${c.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                          {c.name}
                        </Link>
                        {c.status === 'running' && <div className="mt-0.5 text-xs text-zinc-500">{waitText(c, now)}</div>}
                      </td>
                      <td className="px-5 py-3"><Badge tone={CAMPAIGN_STATUS[c.status].tone} dot>{CAMPAIGN_STATUS[c.status].label}</Badge></td>
                      <td className="w-48 px-5 py-3">
                        <div className="mb-1 text-xs tabular-nums text-zinc-600">{done} / {c.counts.total}</div>
                        <Progress value={done} max={c.counts.total} />
                      </td>
                      <td className="px-5 py-3 tabular-nums">{c.counts.delivered}</td>
                      <td className="px-5 py-3 tabular-nums">{c.counts.read}</td>
                      <td className="px-5 py-3 tabular-nums">{c.counts.replied}</td>
                      <td className="px-5 py-3 text-zinc-500">{fmtDate(c.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{loading ? 'Loading…' : 'No campaigns yet. Create your first one.'}</Empty>
        )}
      </Card>
    </>
  );
}

import { Link } from 'react-router-dom';
import { Badge, Card, Empty, PageHeader } from '../components/ui';
import { fmtDateTime } from '../lib/format';
import { useApi } from '../lib/hooks';

interface Reply {
  id: number;
  phone: string;
  name: string | null;
  business: string | null;
  campaign_id: number | null;
  campaign_name: string | null;
  body: string | null;
  is_optout: number;
  received_at: number;
}

export function Replies() {
  const { data, loading } = useApi<Reply[]>('/replies', ['stats']);

  return (
    <>
      <PageHeader title="Replies" subtitle="People who answered your campaigns. Follow up from your phone. Interested leads are your sales!" />
      <Card>
        {data?.length ? (
          <ul className="divide-y divide-zinc-100">
            {data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{r.name || r.business || r.phone}</span>
                    {(r.name || r.business) && <span className="text-zinc-500">{r.phone}</span>}
                    {r.is_optout ? <Badge tone="red">Opted out</Badge> : null}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">{r.body}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {fmtDateTime(r.received_at)}
                    {r.campaign_id && (
                      <>
                        {' · '}
                        <Link to={`/campaigns/${r.campaign_id}`} className="underline">{r.campaign_name}</Link>
                      </>
                    )}
                  </div>
                </div>
                <a
                  href={`https://wa.me/${r.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
                >
                  Open chat
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{loading ? 'Loading…' : 'No replies yet. They will show up here as soon as someone answers.'}</Empty>
        )}
      </Card>
    </>
  );
}

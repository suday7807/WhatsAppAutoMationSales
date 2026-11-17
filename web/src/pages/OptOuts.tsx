import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Field, PageHeader, inputCls } from '../components/ui';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useApi } from '../lib/hooks';

interface OptOut {
  phone: string;
  reason: 'stop' | 'manual';
  note: string | null;
  name: string | null;
  business: string | null;
  created_at: number;
}

export function OptOuts() {
  const { data, reload } = useApi<OptOut[]>('/optouts', ['stats']);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  async function add() {
    const r = await api<{ added: number; invalid: string[] }>('/optouts', { body: { text } });
    setMsg(`${r.added} number(s) added.${r.invalid.length ? ` Invalid: ${r.invalid.join(', ')}` : ''}`);
    setText('');
    void reload();
  }

  return (
    <>
      <PageHeader title="Opt-outs" subtitle="These numbers are never messaged. People who reply STOP or “not interested” are added automatically." />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card>
          {data?.length ? (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-zinc-500">
                  <tr className="border-b border-zinc-100">
                    {['Phone', 'Name', 'Reason', 'When', ''].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.map((o) => (
                    <tr key={o.phone} className="border-b border-zinc-50">
                      <td className="px-5 py-2 tabular-nums">{o.phone}</td>
                      <td className="px-5 py-2">{o.name || o.business || '—'}</td>
                      <td className="px-5 py-2">
                        <Badge tone={o.reason === 'stop' ? 'red' : 'gray'}>{o.reason === 'stop' ? 'Replied' : 'Added by you'}</Badge>
                        {o.note && <div className="mt-1 max-w-56 truncate text-xs text-zinc-500" title={o.note}>“{o.note}”</div>}
                      </td>
                      <td className="px-5 py-2 text-xs text-zinc-500">{fmtDateTime(o.created_at)}</td>
                      <td className="px-5 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            if (!confirm(`Allow messaging ${o.phone} again?`)) return;
                            await api(`/optouts/${encodeURIComponent(o.phone)}`, { method: 'DELETE' });
                            void reload();
                          }}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No opt-outs yet.</Empty>
          )}
        </Card>
        <Card title="Add numbers">
          <Field hint="One number per line.">
            <textarea className={`${inputCls} h-28 font-mono`} value={text} onChange={(e) => setText(e.target.value)} placeholder="9876543210" />
          </Field>
          <Button className="mt-3" variant="primary" disabled={!text.trim()} onClick={add}>Add to opt-outs</Button>
          {msg && <div className="mt-3"><Alert tone="green">{msg}</Alert></div>}
        </Card>
      </div>
    </>
  );
}

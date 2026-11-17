import Papa from 'papaparse';
import { Trash2, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Field, PageHeader, inputCls } from '../components/ui';
import { api, type ContactList } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useApi } from '../lib/hooks';

interface Contact {
  id: number;
  phone: string;
  name: string | null;
  business: string | null;
  category: string | null;
  city: string | null;
  opted_out: number;
  last_messaged_at: number | null;
}

const PAGE = 100;

export function Contacts() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [city, setCity] = useState('');
  const [listId, setListId] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showImport, setShowImport] = useState(false);

  const params = new URLSearchParams({ q, category, city, list_id: listId, limit: String(PAGE), offset: String(page * PAGE) });
  const contacts = useApi<{ rows: Contact[]; total: number }>(`/contacts?${params}`, ['stats']);
  const facets = useApi<{ categories: string[]; cities: string[] }>('/contacts/facets');
  const lists = useApi<ContactList[]>('/lists');

  const reloadAll = () => {
    void contacts.reload();
    void facets.reload();
    void lists.reload();
    setSelected(new Set());
  };

  const rows = contacts.data?.rows ?? [];
  const total = contacts.data?.total ?? 0;
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  async function deleteSelected() {
    if (!confirm(`Delete ${selected.size} contact(s)? Campaign history is kept.`)) return;
    await api('/contacts/delete', { body: { ids: [...selected] } });
    reloadAll();
  }

  async function addToList(target: string, useFilter: boolean) {
    let id = Number(target);
    if (target === '__new') {
      const name = prompt('New list name (e.g. "Dentists Pune")');
      if (!name) return;
      try {
        id = (await api<{ id: number }>('/lists', { body: { name } })).id;
      } catch (e) {
        return alert((e as Error).message);
      }
    }
    const body = useFilter ? { filter: { q, category, city, list_id: listId } } : { ids: [...selected] };
    const r = await api<{ added: number }>(`/lists/${id}/add`, { body });
    alert(`${r.added} contact(s) added to the list.`);
    reloadAll();
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="Leads from Google Maps. Upload a CSV or paste numbers, then group them into lists."
        actions={
          <Button variant="primary" onClick={() => setShowImport((v) => !v)}>
            <Upload size={16} /> Import
          </Button>
        }
      />

      {showImport && (
        <ImportPanel
          lists={lists.data ?? []}
          onClose={() => setShowImport(false)}
          onDone={() => {
            reloadAll();
          }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <Card>
          <div className="mb-4 grid gap-2 sm:grid-cols-4">
            <input className={inputCls} placeholder="Search name, phone, business" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
            <select className={inputCls} value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }}>
              <option value="">All categories</option>
              {facets.data?.categories.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className={inputCls} value={city} onChange={(e) => { setCity(e.target.value); setPage(0); }}>
              <option value="">All cities</option>
              {facets.data?.cities.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className={inputCls} value={listId} onChange={(e) => { setListId(e.target.value); setPage(0); }}>
              <option value="">All lists</option>
              {lists.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-zinc-500">{total} contact(s){selected.size ? ` · ${selected.size} selected` : ''}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <select
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs"
                value=""
                onChange={(e) => e.target.value && void addToList(e.target.value, selected.size === 0)}
              >
                <option value="">{selected.size ? 'Add selected to list…' : `Add all ${total} filtered to list…`}</option>
                {lists.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                <option value="__new">+ New list…</option>
              </select>
              {selected.size > 0 && (
                <Button size="sm" variant="danger" onClick={deleteSelected}>
                  <Trash2 size={13} /> Delete
                </Button>
              )}
            </div>
          </div>

          {rows.length ? (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-xs text-zinc-500">
                  <tr className="border-b border-zinc-100">
                    <th className="w-8 px-5 py-2">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))}
                      />
                    </th>
                    {['Name', 'Phone', 'Business', 'Category', 'City', 'Status'].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className="border-b border-zinc-50 hover:bg-zinc-50">
                      <td className="px-5 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => {
                            const s = new Set(selected);
                            s.has(c.id) ? s.delete(c.id) : s.add(c.id);
                            setSelected(s);
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">{c.name ?? <span className="text-zinc-400">—</span>}</td>
                      <td className="px-3 py-2 tabular-nums">{c.phone}</td>
                      <td className="px-3 py-2">{c.business ?? ''}</td>
                      <td className="px-3 py-2">{c.category ?? ''}</td>
                      <td className="px-3 py-2">{c.city ?? ''}</td>
                      <td className="px-3 py-2">
                        {c.opted_out ? (
                          <Badge tone="red">Opted out</Badge>
                        ) : c.last_messaged_at ? (
                          <Badge tone="green">Messaged {fmtDate(c.last_messaged_at)}</Badge>
                        ) : (
                          <Badge>New</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{contacts.loading ? 'Loading…' : 'No contacts yet. Click Import to add your Google Maps leads.'}</Empty>
          )}

          {total > PAGE && (
            <div className="mt-4 flex items-center justify-end gap-2 text-sm">
              <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-zinc-500">Page {page + 1} of {Math.ceil(total / PAGE)}</span>
              <Button size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </Card>

        <ListsCard lists={lists.data ?? []} onChange={reloadAll} activeId={listId} onPick={(id) => { setListId(id); setPage(0); }} />
      </div>
    </>
  );
}

function ListsCard({ lists, onChange, activeId, onPick }: { lists: ContactList[]; onChange: () => void; activeId: string; onPick: (id: string) => void }) {
  const [name, setName] = useState('');
  return (
    <Card title="Lists" subtitle="Pick a list when creating a campaign.">
      <ul className="mb-4 space-y-1 text-sm">
        {lists.map((l) => (
          <li key={l.id} className={`group flex items-center justify-between rounded-md px-2 py-1.5 ${activeId === String(l.id) ? 'bg-zinc-100' : 'hover:bg-zinc-50'}`}>
            <button className="min-w-0 truncate text-left" onClick={() => onPick(activeId === String(l.id) ? '' : String(l.id))}>
              {l.name} <span className="text-zinc-400">({l.size})</span>
            </button>
            <button
              className="text-zinc-400 opacity-0 hover:text-red-600 group-hover:opacity-100"
              title="Delete list (contacts are kept)"
              onClick={async () => {
                if (!confirm(`Delete list "${l.name}"? Contacts stay.`)) return;
                await api(`/lists/${l.id}`, { method: 'DELETE' });
                if (activeId === String(l.id)) onPick('');
                onChange();
              }}
            >
              <X size={14} />
            </button>
          </li>
        ))}
        {!lists.length && <li className="text-zinc-500">No lists yet.</li>}
      </ul>
      <div className="flex gap-2">
        <input className={inputCls} placeholder="New list name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          disabled={!name.trim()}
          onClick={async () => {
            try {
              await api('/lists', { body: { name } });
              setName('');
              onChange();
            } catch (e) {
              alert((e as Error).message);
            }
          }}
        >
          Add
        </Button>
      </div>
    </Card>
  );
}

const TARGETS = ['phone', 'name', 'business', 'category', 'city'] as const;
type Target = (typeof TARGETS)[number];
const GUESS: Record<Target, RegExp> = {
  phone: /phone|mobile|number|contact|whatsapp|tel/i,
  name: /^(owner|contact person|person|name)$/i,
  business: /business|company|title|shop|store|place|name/i,
  category: /categor|type|industry/i,
  city: /city|town|location|area/i,
};

function ImportPanel({ lists, onClose, onDone }: { lists: ContactList[]; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'paste' | 'csv'>('paste');
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [city, setCity] = useState('');
  const [listChoice, setListChoice] = useState('');
  const [newList, setNewList] = useState('');
  const [csv, setCsv] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [mapping, setMapping] = useState<Record<Target, string>>({ phone: '', name: '', business: '', category: '', city: '' });
  const [result, setResult] = useState<{ tone: 'green' | 'red'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function onFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const headers = res.meta.fields ?? [];
        const used = new Set<string>();
        const m = { phone: '', name: '', business: '', category: '', city: '' } as Record<Target, string>;
        for (const t of TARGETS) {
          const h = headers.find((x) => !used.has(x) && GUESS[t].test(x));
          if (h) {
            m[t] = h;
            used.add(h);
          }
        }
        setMapping(m);
        setCsv({ headers, rows: res.data });
      },
    });
  }

  const mappedRows = useMemo(
    () =>
      csv?.rows.map((r) => ({
        phone: mapping.phone ? r[mapping.phone] : '',
        name: mapping.name ? r[mapping.name] : null,
        business: mapping.business ? r[mapping.business] : null,
        category: (mapping.category ? r[mapping.category] : null) || category || null,
        city: (mapping.city ? r[mapping.city] : null) || city || null,
      })) ?? [],
    [csv, mapping, category, city],
  );

  async function submit() {
    setBusy(true);
    setResult(null);
    const listPart = listChoice === '__new' ? { new_list_name: newList } : listChoice ? { list_id: Number(listChoice) } : {};
    try {
      const body =
        mode === 'paste'
          ? { text, category: category || null, city: city || null, source: 'paste', ...listPart }
          : { rows: mappedRows, source: 'csv', ...listPart };
      const r = await api<{ created: number; updated: number; invalid: string[] }>('/contacts/import', { body });
      setResult({
        tone: 'green',
        msg: `${r.created} new, ${r.updated} updated.${r.invalid.length ? ` ${r.invalid.length} invalid skipped: ${r.invalid.slice(0, 5).join(', ')}${r.invalid.length > 5 ? '…' : ''}` : ''}`,
      });
      setText('');
      setCsv(null);
      onDone();
    } catch (e) {
      setResult({ tone: 'red', msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4" title="Import contacts" actions={<Button variant="ghost" size="sm" onClick={onClose}><X size={14} /></Button>}>
      <div className="mb-4 flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm sm:w-fit">
        {(['paste', 'csv'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`rounded-md px-3 py-1 ${mode === m ? 'bg-white font-medium shadow-sm' : 'text-zinc-600'}`}>
            {m === 'paste' ? 'Paste numbers' : 'Upload CSV'}
          </button>
        ))}
      </div>

      {mode === 'paste' ? (
        <Field label="Numbers" hint="One number per line. Name optional after a comma. No need to add +91.">
          <textarea
            className={`${inputCls} h-36 font-mono`}
            placeholder={'9876543210\n9812345678\n+91 99001 12233, Priya'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
      ) : (
        <div className="space-y-4">
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="text-sm" />
          {csv && (
            <>
              <div className="grid gap-3 sm:grid-cols-5">
                {TARGETS.map((t) => (
                  <Field key={t} label={<span className="capitalize">{t}{t === 'phone' && ' *'}</span>}>
                    <select className={inputCls} value={mapping[t]} onChange={(e) => setMapping({ ...mapping, [t]: e.target.value })}>
                      <option value="">— not in file —</option>
                      {csv.headers.map((h) => <option key={h}>{h}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
              <div className="overflow-x-auto rounded-lg border border-zinc-200">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 text-left text-zinc-500">
                    <tr>{TARGETS.map((t) => <th key={t} className="px-3 py-1.5 font-medium capitalize">{t}</th>)}</tr>
                  </thead>
                  <tbody>
                    {mappedRows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t border-zinc-100">
                        {TARGETS.map((t) => <td key={t} className="px-3 py-1.5">{r[t] ?? ''}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-zinc-500">{csv.rows.length} rows in file. Preview shows the first 5.</p>
            </>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="Category" hint={mode === 'csv' ? 'Used when the file has no category' : 'e.g. dentist, gym, salon'}>
          <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="dentist" />
        </Field>
        <Field label="City" hint={mode === 'csv' ? 'Used when the file has no city' : undefined}>
          <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Pune" />
        </Field>
        <Field label="Add to list (optional)">
          <select className={inputCls} value={listChoice} onChange={(e) => setListChoice(e.target.value)}>
            <option value="">No list</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            <option value="__new">+ New list…</option>
          </select>
          {listChoice === '__new' && (
            <input className={`${inputCls} mt-2`} placeholder="List name" value={newList} onChange={(e) => setNewList(e.target.value)} />
          )}
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="primary"
          onClick={submit}
          disabled={busy || (mode === 'paste' ? !text.trim() : !csv || !mapping.phone) || (listChoice === '__new' && !newList.trim())}
        >
          Import
        </Button>
        {result && <div className="flex-1"><Alert tone={result.tone}>{result.msg}</Alert></div>}
      </div>
    </Card>
  );
}

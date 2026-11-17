import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Card, Empty, Field, PageHeader, inputCls } from '../components/ui';
import { api, type DemoKit } from '../lib/api';
import { useApi } from '../lib/hooks';

export function DemoKits() {
  const kits = useApi<DemoKit[]>('/demo-kits');
  const [editing, setEditing] = useState<DemoKit | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Demo kits"
        subtitle="One demo website + 2 homepage screenshots per business category. Campaigns send these after the intro."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> New demo kit
          </Button>
        }
      />

      {editing && (
        <KitForm
          kit={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void kits.reload();
          }}
        />
      )}

      {kits.data?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {kits.data.map((k) => (
            <Card key={k.id} className="!p-0 overflow-hidden">
              <div className="grid grid-cols-2 gap-0.5 bg-zinc-100">
                {[k.image1, k.image2].map((img, i) =>
                  img ? (
                    <img key={i} src={`/uploads/${img}`} alt={`${k.category} screenshot ${i + 1}`} className="aspect-[3/4] w-full object-cover object-top" />
                  ) : (
                    <div key={i} className="flex aspect-[3/4] items-center justify-center text-xs text-zinc-400">No image {i + 1}</div>
                  ),
                )}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold capitalize">{k.category}</div>
                    <a href={k.demo_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-xs text-blue-600 hover:underline">
                      {k.demo_url} <ExternalLink size={11} />
                    </a>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(k)}><Pencil size={13} /></Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (!confirm(`Delete the "${k.category}" demo kit?`)) return;
                        try {
                          await api(`/demo-kits/${k.id}`, { method: 'DELETE' });
                          void kits.reload();
                        } catch (e) {
                          alert((e as Error).message);
                        }
                      }}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 text-xs text-zinc-500">Used in {k.campaigns ?? 0} campaign(s)</div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        !editing && (
          <Card>
            <Empty>No demo kits yet. Add one per category, e.g. “dentist” with your dental demo site and 2 screenshots.</Empty>
          </Card>
        )
      )}
    </>
  );
}

function KitForm({ kit, onClose, onSaved }: { kit: DemoKit | null; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState(kit?.category ?? '');
  const [url, setUrl] = useState(kit?.demo_url ?? '');
  const [files, setFiles] = useState<{ image1?: File; image2?: File }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = (n: 1 | 2) => {
    const f = files[`image${n}`];
    if (f) return URL.createObjectURL(f);
    const existing = kit?.[`image${n}`];
    return existing ? `/uploads/${existing}` : null;
  };

  async function save() {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set('category', category.trim());
    form.set('demo_url', url.trim());
    if (files.image1) form.set('image1', files.image1);
    if (files.image2) form.set('image2', files.image2);
    try {
      await api(kit ? `/demo-kits/${kit.id}` : '/demo-kits', { method: kit ? 'PUT' : 'POST', form });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4" title={kit ? `Edit “${kit.category}”` : 'New demo kit'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" hint="Should match the category on your contacts, e.g. dentist">
          <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="dentist" />
        </Field>
        <Field label="Demo website URL">
          <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://dental-demo.yoursite.com" />
        </Field>
        {([1, 2] as const).map((n) => (
          <Field key={n} label={`Screenshot ${n}`} hint="PNG/JPG, under 8 MB. A homepage screenshot from a phone works best.">
            <div className="flex items-start gap-3">
              {preview(n) ? (
                <img src={preview(n)!} alt="" className="h-28 w-20 rounded border border-zinc-200 object-cover object-top" />
              ) : (
                <div className="flex h-28 w-20 items-center justify-center rounded border border-dashed border-zinc-300 text-xs text-zinc-400">none</div>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="text-sm"
                onChange={(e) => e.target.files?.[0] && setFiles({ ...files, [`image${n}`]: e.target.files[0] })}
              />
            </div>
          </Field>
        ))}
      </div>
      {error && <div className="mt-4"><Alert tone="red">{error}</Alert></div>}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" onClick={save} disabled={busy || !category.trim() || !url.trim()}>Save</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Card>
  );
}

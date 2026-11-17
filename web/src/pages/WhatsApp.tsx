import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, PageHeader, Spinner, inputCls } from '../components/ui';
import { api } from '../lib/api';
import { useWaStatus } from '../lib/hooks';

export function WhatsApp() {
  const wa = useWaStatus();
  const [busy, setBusy] = useState(false);

  const badge =
    wa.state === 'ready' ? (
      <Badge tone="green" dot>Connected</Badge>
    ) : wa.state === 'disconnected' ? (
      <Badge tone="red" dot>Disconnected</Badge>
    ) : (
      <Badge tone="amber" dot>{wa.state === 'qr' ? 'Waiting for scan' : 'Connecting…'}</Badge>
    );

  async function connect() {
    setBusy(true);
    try {
      await api('/wa/connect', { method: 'POST' });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (!confirm('Unlink this WhatsApp number? Running campaigns will wait until you connect again.')) return;
    setBusy(true);
    try {
      await api('/wa/logout', { method: 'POST' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="WhatsApp connection" subtitle="WhatsApp Web runs in a hidden Chrome window on this laptop." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Status" actions={badge}>
          {wa.state === 'ready' && wa.me && (
            <div className="space-y-4">
              <div className="rounded-lg bg-zinc-50 px-4 py-3 text-sm">
                <div className="font-medium">{wa.me.name || 'Your WhatsApp'}</div>
                <div className="text-zinc-500">{wa.me.phone}</div>
              </div>
              <Button variant="danger" onClick={logout} disabled={busy}>Log out / unlink</Button>
            </div>
          )}

          {wa.state === 'disconnected' && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-600">Click connect to open WhatsApp Web and get a QR code.</p>
              <Button variant="primary" onClick={connect} disabled={busy}>Connect WhatsApp</Button>
            </div>
          )}

          {(wa.state === 'initializing' || wa.state === 'authenticated') && (
            <div className="flex items-center gap-3 text-sm text-zinc-600">
              <Spinner /> {wa.state === 'authenticated' ? 'Logged in, loading chats…' : 'Starting WhatsApp Web… (first time can take 30–60 sec)'}
            </div>
          )}

          {wa.state === 'qr' && wa.qr && (
            <div className="space-y-3">
              <img src={wa.qr} alt="WhatsApp QR code" className="h-64 w-64 rounded-lg border border-zinc-200" />
              <p className="text-xs text-zinc-500">The code refreshes every ~20 seconds. Scan it with the phone that has the sending SIM.</p>
            </div>
          )}

          {wa.error && wa.state !== 'ready' && (
            <div className="mt-4">
              <Alert tone="red">{wa.error}</Alert>
            </div>
          )}
        </Card>

        <Card title="How to scan">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-zinc-700">
            <li>Open WhatsApp on your phone</li>
            <li>Tap <b>⋮ Menu</b> (Android) or <b>Settings</b> (iPhone)</li>
            <li>Tap <b>Linked devices → Link a device</b></li>
            <li>Point your phone at the QR code shown here</li>
          </ol>
          <p className="mt-4 text-xs text-zinc-500">
            After linking, sending continues as long as this laptop is on, awake and online. Your phone only needs to come online at least
            once every 14 days so WhatsApp keeps the link active.
          </p>
        </Card>
      </div>

      {wa.state === 'ready' && <TestMessage />}

      <Card className="mt-4" title="Keep your number safe">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-700">
          <li>This uses WhatsApp Web automation, which is unofficial and against WhatsApp’s terms. The number <b>can get banned</b>.</li>
          <li>Use a <b>separate SIM</b> for outreach. Never use your main personal or business number.</li>
          <li>Warm up a new number: about 20 messages/day in week 1, then increase slowly.</li>
          <li>Keep the first message short and personal. Send the link and screenshots after it, never a bare link alone.</li>
          <li>Anyone who replies STOP / not interested is added to Opt-outs automatically and never messaged again.</li>
        </ul>
      </Card>
    </>
  );
}

function TestMessage() {
  const [phone, setPhone] = useState('');
  const [text, setText] = useState('Test message from WA Outreach ✅');
  const [result, setResult] = useState<{ tone: 'green' | 'red'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      await api('/wa/test', { body: { phone, text } });
      setResult({ tone: 'green', msg: 'Sent! Check the phone.' });
    } catch (e) {
      setResult({ tone: 'red', msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4" title="Send a test message" subtitle="Send one message to your own number to check everything works.">
      <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
        <Field label="Phone">
          <input className={inputCls} placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Message">
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Button variant="primary" onClick={send} disabled={busy || !phone || !text}>Send test</Button>
      </div>
      {result && <div className="mt-3"><Alert tone={result.tone}>{result.msg}</Alert></div>}
    </Card>
  );
}

import { Ban, Inbox, LayoutGrid, Megaphone, MonitorSmartphone, Send, Smartphone, Users } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useWaStatus } from '../lib/hooks';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/whatsapp', label: 'WhatsApp', icon: Smartphone },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/demo-kits', label: 'Demo kits', icon: MonitorSmartphone },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/replies', label: 'Replies', icon: Inbox },
  { to: '/opt-outs', label: 'Opt-outs', icon: Ban },
];

export function Layout() {
  const wa = useWaStatus();
  const [open, setOpen] = useState(false);
  const connected = wa.state === 'ready';

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600 text-white">
          <Send size={16} />
        </div>
        <span className="text-[15px] font-semibold">WA Outreach</span>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive ? 'bg-zinc-100 font-medium text-zinc-900' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900',
              )
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>
      <NavLink to="/whatsapp" className="m-3 flex items-center gap-2.5 rounded-lg border border-zinc-200 px-3 py-2.5 text-xs hover:bg-zinc-50">
        <span className={cx('h-2 w-2 shrink-0 rounded-full', connected ? 'bg-green-500' : wa.state === 'disconnected' ? 'bg-red-500' : 'bg-amber-500')} />
        <span className="min-w-0">
          <span className="block font-medium text-zinc-800">{connected ? 'WhatsApp connected' : wa.state === 'disconnected' ? 'Not connected' : wa.state === 'qr' ? 'Scan the QR code' : 'Connecting…'}</span>
          {wa.me && <span className="block truncate text-zinc-500">{wa.me.phone}</span>}
        </span>
      </NavLink>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-white md:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md border border-zinc-300 px-2 py-1 text-sm">
            Menu
          </button>
          <span className="font-semibold">WA Outreach</span>
        </div>
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

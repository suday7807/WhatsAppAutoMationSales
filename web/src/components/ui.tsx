import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Tone } from '../lib/format';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-zinc-200 bg-white p-5', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  const styles: Record<BtnVariant, string> = {
    primary: 'bg-zinc-900 text-white hover:bg-zinc-700 border-zinc-900',
    secondary: 'bg-white text-zinc-800 hover:bg-zinc-50 border-zinc-300',
    danger: 'bg-white text-red-600 hover:bg-red-50 border-red-200',
    ghost: 'bg-transparent text-zinc-600 hover:bg-zinc-100 border-transparent',
  };
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        styles[variant],
        className,
      )}
    />
  );
}

const TONES: Record<Tone, string> = {
  gray: 'bg-zinc-100 text-zinc-700',
  green: 'bg-green-50 text-green-700',
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-800',
  blue: 'bg-blue-50 text-blue-700',
};
const DOTS: Record<Tone, string> = {
  gray: 'bg-zinc-400',
  green: 'bg-green-500',
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  blue: 'bg-blue-500',
};

export function Badge({ tone = 'gray', children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone])}>
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', DOTS[tone])} />}
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, tone = 'gray' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <span className={cx('h-1.5 w-1.5 rounded-full', DOTS[tone])} />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="mb-1.5 block text-sm font-medium text-zinc-800">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:bg-zinc-50';

export function Alert({ tone = 'amber', children }: { tone?: Tone; children: ReactNode }) {
  const styles: Record<Tone, string> = {
    gray: 'border-zinc-200 bg-zinc-50 text-zinc-700',
    green: 'border-green-200 bg-green-50 text-green-800',
    red: 'border-red-200 bg-red-50 text-red-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
  };
  return <div className={cx('rounded-lg border px-4 py-3 text-sm', styles[tone])}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-sm text-zinc-500">{children}</div>;
}

export function Spinner() {
  return <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-800" />;
}

export function Progress({ value, max }: { value: number; max: number }) {
  const p = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
      <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${p}%` }} />
    </div>
  );
}

/** WhatsApp-style ticks: 1 = ✓, 2 = ✓✓ gray, 3+ = ✓✓ blue. */
export function Ticks({ ack }: { ack: number | null | undefined }) {
  if (ack == null) return <span className="text-zinc-300">—</span>;
  if (ack < 0) return <span className="text-xs text-red-600">error</span>;
  if (ack === 0) return <span className="text-xs text-zinc-400">🕓</span>;
  const color = ack >= 3 ? 'text-sky-500' : 'text-zinc-400';
  return <span className={cx('font-semibold tracking-[-0.2em]', color)}>{ack >= 2 ? '✓✓' : '✓'}</span>;
}

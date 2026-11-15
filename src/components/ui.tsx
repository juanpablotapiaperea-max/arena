import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';

export function cn(...args: Parameters<typeof clsx>) {
  return clsx(...args);
}

type Variant = 'primary' | 'ghost' | 'outline' | 'danger';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }>(
  function Button({ variant = 'primary', size = 'md', className, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          'focus-ring inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
          size === 'md' ? 'min-h-11 px-4 text-sm' : 'min-h-9 px-3 text-xs',
          variant === 'primary' && 'bg-primary text-bg hover:brightness-110',
          variant === 'ghost' && 'text-fg hover:bg-surface-2',
          variant === 'outline' && 'border border-line text-fg hover:bg-surface-2',
          variant === 'danger' && 'bg-loss/90 text-white hover:bg-loss',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'focus-ring min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm text-fg placeholder:text-muted',
        className,
      )}
      {...props}
    />
  );
});

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
      {children}
    </label>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('card p-4', className)}>{children}</div>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="font-display text-2xl font-bold uppercase tracking-wide">{children}</h2>
      {right}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'primary' | 'live' | 'win' | 'loss' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
        tone === 'neutral' && 'bg-surface-2 text-muted',
        tone === 'primary' && 'bg-primary/15 text-primary',
        tone === 'live' && 'bg-live/15 text-live',
        tone === 'win' && 'bg-win/15 text-win',
        tone === 'loss' && 'bg-loss/15 text-loss',
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 p-8 text-sm text-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-primary" />
      {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div role="alert" className="rounded-xl border border-loss/40 bg-loss/10 p-4 text-sm text-loss">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="font-display text-2xl font-bold tabular">{value}</div>
    </div>
  );
}

/** Barra de atributo 0-100. */
export function RatingBar({ value, max = 100 }: { value: number; max?: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
    </div>
  );
}

export const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : `$${Math.round(n / 1000)}K`;

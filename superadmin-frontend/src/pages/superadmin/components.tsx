import { useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

export function Card({ title, meta, children, className = '' }: {
  title?: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-sa-panel border border-sa-line rounded-2xl p-5 ${className}`}
    >
      {(title || meta) && (
        <div className="flex items-center justify-between mb-4">
          {title && (
            <h3 className="text-[13px] font-semibold text-sa-ink">{title}</h3>
          )}
          {meta && <span className="text-xs text-sa-ink-faint">{meta}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function KpiTile({ label, value, sub, tone = 'default' }: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: 'default' | 'good' | 'warn' | 'critical';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-sa-good'
      : tone === 'warn'
      ? 'text-sa-warn'
      : tone === 'critical'
      ? 'text-sa-critical'
      : 'text-sa-ink-faint';

  return (
    <div className="bg-sa-panel border border-sa-line rounded-xl px-4 py-4">
      <div className="text-[13px] text-sa-ink-dim">{label}</div>
      <div className="text-2xl font-semibold mt-1.5 tabular-nums text-sa-ink">{value}</div>
      {sub && <div className={`text-[12.5px] mt-1.5 truncate ${toneClass}`}>{sub}</div>}
    </div>
  );
}

export function StatCard({ label, value, sub, tone = 'default', icon: Icon }: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: 'default' | 'good' | 'warn' | 'critical' | 'accent' | 'teal';
  icon?: LucideIcon;
}) {
  const bgClass = {
    default: 'bg-sa-tile-blue',
    good: 'bg-sa-tile-green',
    warn: 'bg-sa-tile-amber',
    critical: 'bg-sa-tile-red',
    accent: 'bg-sa-tile-purple',
    teal: 'bg-sa-tile-teal',
  }[tone];

  return (
    <div className={`rounded-2xl px-5 py-4 ${bgClass}`}>
      {Icon && (
        <span className="inline-flex h-9 w-9 rounded-full bg-white/15 items-center justify-center mb-3">
          <Icon size={18} className="text-white" />
        </span>
      )}
      <div className="text-white/80 text-[13px]">{label}</div>
      <div className="text-white text-2xl font-bold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-white/70 text-[12px] mt-1 truncate">{sub}</div>}
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: 'good' | 'warn' | 'critical' | 'dim'; children: ReactNode }) {
  const toneClass = {
    good: 'text-sa-good bg-sa-good-soft',
    warn: 'text-sa-warn bg-sa-warn-soft',
    critical: 'text-sa-critical bg-sa-critical-soft',
    dim: 'text-sa-ink-dim bg-sa-panel-inset',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${toneClass}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="text-center py-10 text-sm text-sa-ink-faint">
      {children}
    </div>
  );
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-sa-ink tracking-tight">
        {title}
      </h1>
      {description && <p className="text-sm text-sa-ink-dim mt-1.5 max-w-2xl">{description}</p>}
    </div>
  );
}

export function Toggle({ on, onClick, disabled, label }: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      aria-label={label}
      className={`relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
        on ? 'bg-sa-accent' : 'bg-sa-line-bright'
      }`}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 h-[18px] w-[18px] rounded-full bg-white shadow transition-all duration-200 ${
          on ? 'left-[20px]' : 'left-[3px]'
        }`}
      />
    </button>
  );
}

export function Select<T extends string>({ value, options, onChange, placeholder }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 bg-sa-panel-inset border border-sa-line rounded-lg px-3 py-2 text-sm text-sa-ink min-w-[200px] justify-between hover:border-sa-line-bright transition-colors"
      >
        <span className="truncate">{current?.label ?? placeholder ?? 'Select…'}</span>
        <ChevronDown size={14} className="text-sa-ink-faint shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 z-30 min-w-[220px] max-h-72 overflow-y-auto bg-sa-panel-raised border border-sa-line rounded-lg shadow-xl p-1">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={`block w-full text-left px-3 py-2 text-sm rounded-md truncate hover:bg-sa-panel-inset transition-colors ${
                  option.value === value ? 'text-sa-accent' : 'text-sa-ink-dim'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function Card({ title, meta, children, className = '' }: {
  title?: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative bg-sa-panel-raised border border-sa-line rounded-sm p-4 before:content-[''] before:absolute before:top-0 before:left-0 before:right-0 before:h-px before:bg-gradient-to-r before:from-sa-accent/70 before:via-sa-accent/10 before:to-transparent ${className}`}
    >
      {(title || meta) && (
        <div className="flex items-center justify-between mb-3">
          {title && (
            <h3 className="text-[13px] font-semibold text-sa-ink tracking-wide uppercase font-mono">{title}</h3>
          )}
          {meta && <span className="font-mono text-[11px] text-sa-ink-faint">{meta}</span>}
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
      : 'text-sa-ink-dim';
  const valueGlow =
    tone === 'good'
      ? 'drop-shadow-[0_0_10px_rgba(57,255,136,0.35)]'
      : tone === 'warn'
      ? 'drop-shadow-[0_0_10px_rgba(255,212,38,0.3)]'
      : tone === 'critical'
      ? 'drop-shadow-[0_0_10px_rgba(255,46,99,0.35)]'
      : 'drop-shadow-[0_0_10px_rgba(0,240,255,0.25)]';

  return (
    <div className="relative bg-sa-panel-raised border border-sa-line rounded-sm px-4 py-3.5 overflow-hidden">
      <span className="absolute -top-6 -right-6 h-16 w-16 rounded-full bg-sa-accent/10 blur-2xl pointer-events-none" />
      <div className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-sa-ink-faint">{label}</div>
      <div className={`font-mono text-2xl font-semibold mt-1.5 tabular-nums text-sa-ink ${valueGlow}`}>{value}</div>
      {sub && <div className={`text-[11.5px] mt-1 font-mono ${toneClass}`}>{sub}</div>}
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: 'good' | 'warn' | 'critical' | 'dim'; children: ReactNode }) {
  const toneClass = {
    good: 'text-sa-good bg-sa-good-soft shadow-glow-green',
    warn: 'text-sa-warn bg-sa-warn-soft',
    critical: 'text-sa-critical bg-sa-critical-soft shadow-glow-red',
    dim: 'text-sa-ink-faint bg-sa-panel-inset',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] px-2 py-0.5 rounded-full border border-current/20 ${toneClass}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="text-center py-10 text-sm text-sa-ink-faint font-mono">
      <span className="text-sa-accent/40">//</span> {children}
    </div>
  );
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 bg-sa-accent shadow-glow-cyan-sm rotate-45" />
        <h1 className="text-2xl font-bold text-sa-ink tracking-tight uppercase [text-shadow:0_0_18px_rgba(0,240,255,0.25)]">
          {title}
        </h1>
      </div>
      {description && <p className="text-sm text-sa-ink-dim mt-2 max-w-2xl ml-[18px]">{description}</p>}
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
      className={`relative shrink-0 w-12 h-[26px] rounded-full border-[1.5px] transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
        on ? 'bg-sa-accent/15 border-sa-accent' : 'bg-sa-critical/10 border-sa-critical/50'
      }`}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 h-[18px] w-[18px] rounded-full ring-2 ring-sa-void transition-all duration-200 ${
          on
            ? 'left-[26px] bg-sa-accent shadow-[0_0_7px_1px_rgba(0,240,255,0.85)]'
            : 'left-[3px] bg-sa-critical shadow-[0_0_6px_1px_rgba(255,46,99,0.55)]'
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
        className="flex items-center gap-2 bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-[12.5px] text-sa-ink font-mono min-w-[200px] justify-between hover:border-sa-accent/50 transition-colors"
      >
        <span className="truncate">{current?.label ?? placeholder ?? 'Select…'}</span>
        <ChevronDown size={14} className="text-sa-ink-faint shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 z-30 min-w-[220px] max-h-72 overflow-y-auto bg-sa-panel-raised border border-sa-line rounded-sm shadow-lg">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={`block w-full text-left px-3 py-2 text-[12.5px] font-mono truncate hover:bg-sa-panel-inset transition-colors ${
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

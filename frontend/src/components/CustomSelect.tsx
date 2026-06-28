import { useEffect, useMemo, useState } from 'react';

interface Option { value: string; label: string }

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  style?: React.CSSProperties;
  className?: string;
}

export default function CustomSelect({ value, onChange, options, style, className }: Props) {
  const [open, setOpen] = useState(false);
  const optionSignature = useMemo(() => options.map(o => `${o.value}:${o.label}`).join('|'), [options]);
  const selected = options.find(o => o.value === value) ?? options[0];
  const longestLabelLength = Math.max(0, ...options.map(o => o.label.length), selected?.label.length ?? 0);
  const stableWidth = `max(12rem, ${longestLabelLength + 5}ch)`;
  const wrapperStyle: React.CSSProperties = {
    display: 'inline-block',
    width: style?.width ?? stableWidth,
    minWidth: style?.minWidth ?? stableWidth,
    maxWidth: style?.maxWidth ?? '100%',
    flexShrink: 0,
    ...style,
  };

  useEffect(() => {
    setOpen(false);
  }, [optionSignature, value]);

  return (
    <>
      {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />}
      <div className={`relative ${open ? 'z-50' : 'z-10'} ${className ?? ''}`} style={wrapperStyle}>
        <button
          type="button"
          className="ui-field ui-select-trigger"
          onClick={() => setOpen(v => !v)}
          data-open={open ? 'true' : undefined}>
          <span>{selected?.label}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, color: 'var(--admin-text-subtle)' }}>
            <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {open && (
          <div className="ui-popover">
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className="ui-menu-item"
                data-active={opt.value === value ? 'true' : undefined}>
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

import { useState } from 'react';

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
  const selected = options.find(o => o.value === value) ?? options[0];

  return (
    <>
      {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />}
      <div className={`relative z-40 ${className ?? ''}`} style={{ display: 'inline-block', ...style }}>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
            width: '100%', padding: '10px 14px', borderRadius: '10px',
            border: `1px solid ${open ? '#FDE68A' : '#E5E7EB'}`,
            backgroundColor: 'white', fontSize: '14px', color: '#11162A',
            cursor: 'pointer', outline: 'none', whiteSpace: 'nowrap',
          }}>
          <span>{selected?.label}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
            <path d="M2 4L6 8L10 4" stroke="#98A2B5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, minWidth: '100%',
            backgroundColor: 'white', borderRadius: '10px', border: '1px solid #FDE68A',
            boxShadow: '0 4px 16px rgba(0,0,0,0.10)', overflow: 'hidden', zIndex: 50,
          }}>
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '9px 14px', fontSize: '14px',
                  backgroundColor: opt.value === value ? '#FEF3C7' : 'white',
                  color: '#11162A', border: 'none', cursor: 'pointer', display: 'block',
                }}
                onMouseEnter={e => { if (opt.value !== value) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#FFFBEB'; }}
                onMouseLeave={e => { if (opt.value !== value) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'white'; }}>
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

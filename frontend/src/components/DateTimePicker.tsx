import { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';

interface Props {
  value: string;           // "YYYY-MM-DDTHH:MM" or ""
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function pad(n: number) { return String(n).padStart(2, '0'); }

function toLocalStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseValue(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/* ── scrollable time column ── */
function TimeCol({ label, items, selected, onSelect }: {
  label: string; items: string[]; selected: string; onSelect: (v: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', minWidth:0 }}>
      {/* selected chip */}
      <div style={{
        width:'52px', padding:'6px 0', borderRadius:'6px', textAlign:'center',
        backgroundColor:'#F59E0B', color:'white', fontSize:'14px', fontWeight:700,
        marginBottom:'4px', flexShrink:0,
      }}>{selected}</div>
      <p style={{ fontSize:'9px', fontWeight:600, color:'#98A2B5', margin:'0 0 4px', textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</p>
      {/* scrollable rest */}
      <div ref={listRef} style={{ overflowY:'auto', maxHeight:'130px', width:'52px' }}>
        {items.filter(v => v !== selected).map(v => (
          <div key={v} onClick={() => onSelect(v)}
            style={{ padding:'4px 0', textAlign:'center', fontSize:'12px', color:'#434B5E', cursor:'pointer', borderRadius:'4px' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor='rgba(245,158,11,0.1)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor='transparent')}>
            {v}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DateTimePicker({ value, onChange, placeholder, style }: Props) {
  const [open, setOpen]           = useState(false);
  const [viewYear, setViewYear]   = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [editYear, setEditYear]   = useState(false);
  const [yearInput, setYearInput] = useState('');
  const containerRef              = useRef<HTMLDivElement>(null);

  const selDate = parseValue(value);

  /* sync calendar view when value changes externally */
  useEffect(() => {
    if (selDate) { setViewYear(selDate.getFullYear()); setViewMonth(selDate.getMonth()); }
  }, [value]);

  /* close on outside click */
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  /* derived time values */
  const hour24  = selDate ? selDate.getHours()   : 0;
  const minute  = selDate ? selDate.getMinutes() : 0;
  const period  = hour24 >= 12 ? 'PM' : 'AM';
  const hour12  = hour24 % 12 || 12;

  /* mutators */
  const applyDate = (d: Date) => onChange(toLocalStr(d));

  const selectDay = (day: number) => {
    const base = selDate ? new Date(selDate) : new Date();
    base.setFullYear(viewYear, viewMonth, day);
    applyDate(base);
  };

  const selectHour = (hStr: string) => {
    const h = parseInt(hStr);
    const base = selDate ? new Date(selDate) : new Date();
    const isPM = base.getHours() >= 12;
    base.setHours(isPM ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h));
    applyDate(base);
  };

  const selectMinute = (mStr: string) => {
    const base = selDate ? new Date(selDate) : new Date();
    base.setMinutes(parseInt(mStr));
    applyDate(base);
  };

  const selectPeriod = (p: string) => {
    const base = selDate ? new Date(selDate) : new Date();
    const h = base.getHours();
    if (p === 'AM' && h >= 12) base.setHours(h - 12);
    if (p === 'PM' && h <  12) base.setHours(h + 12);
    applyDate(base);
  };

  /* calendar grid */
  const firstDay      = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth   = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevDays      = new Date(viewYear, viewMonth, 0).getDate();
  const cells: { day: number; type: 'prev'|'curr'|'next' }[] = [];
  for (let i = 0; i < firstDay; i++)
    cells.push({ day: prevDays - firstDay + i + 1, type: 'prev' });
  for (let i = 1; i <= daysInMonth; i++)
    cells.push({ day: i, type: 'curr' });
  while (cells.length < 42)
    cells.push({ day: cells.length - firstDay - daysInMonth + 1, type: 'next' });

  const today       = new Date();
  const prevMonth   = () => viewMonth === 0  ? (setViewYear(y=>y-1), setViewMonth(11)) : setViewMonth(m=>m-1);
  const nextMonth   = () => viewMonth === 11 ? (setViewYear(y=>y+1), setViewMonth(0))  : setViewMonth(m=>m+1);

  /* display text in the trigger input */
  const displayText = selDate
    ? `${pad(selDate.getDate())}-${pad(selDate.getMonth()+1)}-${selDate.getFullYear()}  ${pad(hour12)}:${pad(minute)} ${period}`
    : '';

  const hours   = Array.from({length:12}, (_,i) => pad(i+1));
  const minutes = Array.from({length:60}, (_,i) => pad(i));

  return (
    <div ref={containerRef} style={{ position:'relative', ...style }}>
      {/* trigger */}
      <div onClick={() => setOpen(p=>!p)} style={{
        width:'100%', padding:'10px 14px', borderRadius:'8px',
        border:'1.5px solid #E5E7EB', fontSize:'13px',
        color: displayText ? '#11162A' : '#98A2B5',
        backgroundColor:'white', cursor:'pointer', userSelect:'none',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        boxSizing:'border-box',
      }}>
        <span>{displayText || (placeholder ?? 'Select date & time')}</span>
        <Calendar width={14} height={14} stroke="#98A2B5" strokeWidth={1.5} style={{ flexShrink:0, marginLeft:'8px' }} />
      </div>

      {/* picker dropdown */}
      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 4px)', left:0, zIndex:200,
          backgroundColor:'white', borderRadius:'10px',
          border:'1.5px solid #FDE68A',
          boxShadow:'0 8px 24px rgba(0,0,0,0.12)',
          display:'flex', overflow:'hidden',
        }}>
          {/* ── CALENDAR ── */}
          <div style={{ padding:'12px 10px', width:'220px', flexShrink:0 }}>
            {/* month/year header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
              <span style={{ fontWeight:700, fontSize:'12px', color:'#11162A', display:'flex', alignItems:'center', gap:'3px' }}>
                {MONTHS[viewMonth]},{' '}
                {editYear ? (
                  <input
                    type="number"
                    value={yearInput}
                    autoFocus
                    onChange={e => setYearInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { const y = parseInt(yearInput); if (!isNaN(y) && y > 1900 && y < 2200) setViewYear(y); setEditYear(false); }
                      if (e.key === 'Escape') setEditYear(false);
                    }}
                    onBlur={() => { const y = parseInt(yearInput); if (!isNaN(y) && y > 1900 && y < 2200) setViewYear(y); setEditYear(false); }}
                    style={{ width:'54px', fontSize:'12px', fontWeight:700, border:'1.5px solid #FDE68A', borderRadius:'4px', padding:'1px 4px', color:'#11162A', outline:'none', backgroundColor:'#FFFBEB' }}
                  />
                ) : (
                  <span
                    onClick={() => { setYearInput(String(viewYear)); setEditYear(true); }}
                    title="Click to change year"
                    style={{ cursor:'pointer', borderBottom:'1.5px dashed #F59E0B', color:'#D97706' }}
                  >
                    {viewYear}
                  </span>
                )}
                {' '}▾
              </span>
              <div style={{ display:'flex', gap:'2px' }}>
                {[{ label:'↑', fn: prevMonth }, { label:'↓', fn: nextMonth }].map(btn => (
                  <button key={btn.label} onClick={btn.fn} style={{
                    background:'none', border:'none', cursor:'pointer',
                    fontSize:'13px', color:'#434B5E', padding:'1px 4px', borderRadius:'3px',
                  }}
                    onMouseEnter={e=>(e.currentTarget.style.backgroundColor='rgba(245,158,11,0.1)')}
                    onMouseLeave={e=>(e.currentTarget.style.backgroundColor='transparent')}>
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {/* weekday row */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', marginBottom:'3px' }}>
              {WEEKDAYS.map(d => (
                <div key={d} style={{ textAlign:'center', fontSize:'10px', fontWeight:700, color:'#434B5E', padding:'2px 0' }}>{d}</div>
              ))}
            </div>

            {/* date cells */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:'1px' }}>
              {cells.map((cell, i) => {
                const isSelected = cell.type==='curr' && selDate &&
                  selDate.getDate()===cell.day && selDate.getMonth()===viewMonth && selDate.getFullYear()===viewYear;
                const isToday = cell.type==='curr' &&
                  today.getDate()===cell.day && today.getMonth()===viewMonth && today.getFullYear()===viewYear;
                return (
                  <button key={i}
                    onClick={() => cell.type==='curr' && selectDay(cell.day)}
                    style={{
                      textAlign:'center', fontSize:'11px', padding:'4px 0', border:'none',
                      borderRadius:'4px', cursor: cell.type==='curr' ? 'pointer' : 'default',
                      backgroundColor: isSelected ? '#F59E0B' : 'transparent',
                      color: isSelected ? 'white'
                           : cell.type!=='curr' ? '#D1D5DB'
                           : isToday ? '#D97706'
                           : '#11162A',
                      fontWeight: isSelected ? 700 : 400,
                    }}
                    onMouseEnter={e=>{ if (cell.type==='curr' && !isSelected) e.currentTarget.style.backgroundColor='#F3F4F6'; }}
                    onMouseLeave={e=>{ if (!isSelected) e.currentTarget.style.backgroundColor='transparent'; }}>
                    {cell.day}
                  </button>
                );
              })}
            </div>

            {/* clear / today */}
            <div style={{ display:'flex', justifyContent:'space-between', marginTop:'8px', paddingTop:'6px', borderTop:'1px solid #F3F4F6' }}>
              <button onClick={() => { onChange(''); setOpen(false); }}
                style={{ background:'none', border:'none', fontSize:'11px', color:'#D97706', cursor:'pointer', fontWeight:500 }}>
                Clear
              </button>
              <button onClick={() => { setViewMonth(today.getMonth()); setViewYear(today.getFullYear()); }}
                style={{ background:'none', border:'none', fontSize:'11px', color:'#D97706', cursor:'pointer', fontWeight:500 }}>
                Today
              </button>
            </div>
          </div>

          {/* divider */}
          <div style={{ width:'1px', backgroundColor:'#E5E7EB', flexShrink:0 }} />

          {/* ── TIME ── */}
          <div style={{ padding:'12px 8px', display:'flex', gap:'4px', alignItems:'flex-start' }}>
            <TimeCol label="Hours"   items={hours}            selected={pad(hour12)} onSelect={selectHour}   />
            <TimeCol label="Minutes" items={minutes}          selected={pad(minute)} onSelect={selectMinute} />
            <TimeCol label="AM/PM"   items={['AM','PM']}      selected={period}      onSelect={selectPeriod} />
          </div>
        </div>
      )}
    </div>
  );
}

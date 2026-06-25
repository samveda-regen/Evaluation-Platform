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
    <div className="time-column">
      <div className="time-chip">{selected}</div>
      <p className="time-label">{label}</p>
      <div ref={listRef} className="time-list">
        {items.filter(v => v !== selected).map(v => (
          <div key={v} onClick={() => onSelect(v)}
            className="time-option">
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
    <div ref={containerRef} className="date-time-picker" style={style}>
      {/* trigger */}
      <div
        onClick={() => setOpen(p=>!p)}
        className="ui-field date-time-trigger"
        data-open={open ? 'true' : undefined}
        data-placeholder={!displayText ? 'true' : undefined}
      >
        <span>{displayText || (placeholder ?? 'Select date & time')}</span>
        <Calendar width={14} height={14} stroke="currentColor" strokeWidth={1.5} style={{ flexShrink:0, marginLeft:'8px', color:'var(--admin-text-subtle)' }} />
      </div>

      {/* picker dropdown */}
      {open && (
        <div className="date-time-popover">
          {/* ── CALENDAR ── */}
          <div className="date-time-calendar">
            {/* month/year header */}
            <div className="date-time-calendar-head">
              <span className="date-time-month-label">
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
                    className="date-time-year-input"
                  />
                ) : (
                  <span
                    onClick={() => { setYearInput(String(viewYear)); setEditYear(true); }}
                    title="Click to change year"
                    className="date-time-year"
                  >
                    {viewYear}
                  </span>
                )}
                {' '}▾
              </span>
              <div className="date-time-nav">
                {[{ label:'↑', fn: prevMonth }, { label:'↓', fn: nextMonth }].map(btn => (
                  <button key={btn.label} onClick={btn.fn}>
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {/* weekday row */}
            <div className="weekday-grid">
              {WEEKDAYS.map(d => (
                <div key={d} className="weekday-cell">{d}</div>
              ))}
            </div>

            {/* date cells */}
            <div className="date-grid">
              {cells.map((cell, i) => {
                const isSelected = cell.type==='curr' && selDate &&
                  selDate.getDate()===cell.day && selDate.getMonth()===viewMonth && selDate.getFullYear()===viewYear;
                const isToday = cell.type==='curr' &&
                  today.getDate()===cell.day && today.getMonth()===viewMonth && today.getFullYear()===viewYear;
                return (
                  <button key={i}
                    onClick={() => cell.type==='curr' && selectDay(cell.day)}
                    className="date-cell"
                    data-muted={cell.type !== 'curr' ? 'true' : undefined}
                    data-today={isToday ? 'true' : undefined}
                    data-selected={isSelected ? 'true' : undefined}>
                    {cell.day}
                  </button>
                );
              })}
            </div>

            {/* clear / today */}
            <div className="date-time-footer">
              <button onClick={() => { onChange(''); setOpen(false); }}
                className="date-time-link">
                Clear
              </button>
              <button onClick={() => { setViewMonth(today.getMonth()); setViewYear(today.getFullYear()); }}
                className="date-time-link">
                Today
              </button>
            </div>
          </div>

          {/* divider */}
          <div className="date-time-divider" />

          {/* ── TIME ── */}
          <div className="time-pane">
            <TimeCol label="Hours"   items={hours}            selected={pad(hour12)} onSelect={selectHour}   />
            <TimeCol label="Minutes" items={minutes}          selected={pad(minute)} onSelect={selectMinute} />
            <TimeCol label="AM/PM"   items={['AM','PM']}      selected={period}      onSelect={selectPeriod} />
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, Clock } from 'lucide-react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minDateTime?: string;
  style?: React.CSSProperties;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

const WHEEL_ITEM_H = 40;
const WHEEL_PAD = 80; // 2 items of padding so first/last item can center
const WHEEL_REPS = 3; // copies rendered for continuous looping
const HOURS = Array.from({ length: 12 }, (_, i) => pad(i + 1));
const MINS = Array.from({ length: 60 }, (_, i) => pad(i));
const PERIODS = ['AM', 'PM'];

interface WheelColProps { items: string[]; selected: string; onSelect: (v: string) => void; loop?: boolean; }

function WheelCol({ items, selected, onSelect, loop = true }: WheelColProps) {
  const ref = useRef<HTMLDivElement>(null);
  const settling = useRef(false);
  const progRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reps = loop ? WHEEL_REPS : 1;
  const midStart = loop ? Math.floor(reps / 2) * items.length : 0;
  const rendered = Array.from({ length: reps }, () => items).flat();

  const toScrollTop = (idx: number) => (midStart + idx) * WHEEL_ITEM_H;

  useEffect(() => {
    if (settling.current || progRef.current || !ref.current) return;
    const idx = items.indexOf(selected);
    if (idx < 0) return;
    progRef.current = true;
    ref.current.scrollTop = toScrollTop(idx);
    setTimeout(() => { progRef.current = false; }, 50);
  }, [selected, items]);

  const handleScroll = () => {
    if (progRef.current) return;
    settling.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      settling.current = false;
      if (!ref.current) return;
      const rawIdx = Math.round(ref.current.scrollTop / WHEEL_ITEM_H);
      if (loop) {
        const normalized = ((rawIdx % items.length) + items.length) % items.length;
        const target = toScrollTop(normalized);
        if (ref.current.scrollTop !== target) {
          progRef.current = true;
          ref.current.scrollTop = target;
          setTimeout(() => { progRef.current = false; }, 50);
        }
        if (items[normalized] !== selected) onSelect(items[normalized]);
      } else {
        const clamped = Math.max(0, Math.min(items.length - 1, rawIdx));
        if (items[clamped] !== selected) onSelect(items[clamped]);
      }
    }, 150);
  };

  return (
    <div className="time-wheel-col" ref={ref} onScroll={handleScroll}>
      <div style={{ height: WHEEL_PAD, flexShrink: 0 }} />
      {rendered.map((item, i) => (
        <div
          key={i}
          className="time-wheel-item"
          data-selected={item === selected ? 'true' : undefined}
          onClick={() => {
            const normalized = loop ? i % items.length : i;
            progRef.current = true;
            if (ref.current) ref.current.scrollTo({ top: toScrollTop(normalized), behavior: 'smooth' });
            onSelect(items[normalized]);
            setTimeout(() => { progRef.current = false; }, 500);
          }}
        >
          {item}
        </div>
      ))}
      <div style={{ height: WHEEL_PAD, flexShrink: 0 }} />
    </div>
  );
}

function pad(n: number) { return String(n).padStart(2, '0'); }

function toLocalStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseValue(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export default function DateTimePicker({ value, onChange, placeholder, minDateTime, style }: Props) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [activePanel, setActivePanel] = useState<'date' | 'time'>('date');
  const [yearOpen, setYearOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const selDate = parseValue(value);
  const minDate = parseValue(minDateTime || '');
  const effectiveDate = selDate ?? new Date();

  useEffect(() => {
    if (!selDate) return;
    setViewYear(selDate.getFullYear());
    setViewMonth(selDate.getMonth());
  }, [value]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
      setYearOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  const hour24 = effectiveDate.getHours();
  const minute = effectiveDate.getMinutes();
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;

  const isBeforeMinDateTime = (d: Date) => Boolean(minDate && d.getTime() < minDate.getTime());
  const isBeforeMinCalendarDate = (year: number, month: number, day: number) => {
    if (!minDate) return false;
    const candidate = new Date(year, month, day);
    const minCalendarDate = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
    return candidate.getTime() < minCalendarDate.getTime();
  };

  const applyDate = (d: Date) => {
    if (isBeforeMinDateTime(d)) return;
    onChange(toLocalStr(d));
  };

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
    if (p === 'PM' && h < 12) base.setHours(h + 12);
    applyDate(base);
  };

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevDays = new Date(viewYear, viewMonth, 0).getDate();
  const cells: { day: number; type: 'prev'|'curr'|'next' }[] = [];
  for (let i = 0; i < firstDay; i++) cells.push({ day: prevDays - firstDay + i + 1, type: 'prev' });
  for (let i = 1; i <= daysInMonth; i++) cells.push({ day: i, type: 'curr' });
  while (cells.length < 42) cells.push({ day: cells.length - firstDay - daysInMonth + 1, type: 'next' });

  const today = new Date();
  const prevMonth = () => viewMonth === 0 ? (setViewYear(y => y - 1), setViewMonth(11)) : setViewMonth(m => m - 1);
  const nextMonth = () => viewMonth === 11 ? (setViewYear(y => y + 1), setViewMonth(0)) : setViewMonth(m => m + 1);

  const displayText = selDate
    ? `${pad(selDate.getDate())}-${pad(selDate.getMonth()+1)}-${selDate.getFullYear()}  ${pad(hour12)}:${pad(minute)} ${period}`
    : '';

  const years = Array.from({ length: 31 }, (_, i) => today.getFullYear() - 10 + i);

  const popover = (
    <div
      ref={popoverRef}
      className="date-time-popover"
    >
      <div className="date-time-tabs" role="tablist" aria-label="Date and time picker">
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === 'date'}
          className="date-time-tab"
          data-active={activePanel === 'date' ? 'true' : undefined}
          onClick={() => setActivePanel('date')}
        >
          <Calendar size={16} />
          Date
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === 'time'}
          className="date-time-tab"
          data-active={activePanel === 'time' ? 'true' : undefined}
          onClick={() => setActivePanel('time')}
        >
          <Clock size={16} />
          Time
        </button>
      </div>

      <div className="date-time-content">
      {activePanel === 'date' ? (
        <div className="date-time-calendar">
          <div className="date-time-calendar-head">
            <button type="button" onClick={prevMonth} aria-label="Previous month" className="date-time-month-nav">
              <ChevronLeft size={18} />
            </button>
            <div className="date-time-month-center">
              <span className="date-time-month-label">{MONTHS[viewMonth]}</span>
              <div className="date-time-year-dropdown">
                <button
                  type="button"
                  className="date-time-year-trigger"
                  data-open={yearOpen ? 'true' : undefined}
                  onClick={() => setYearOpen(v => !v)}
                >
                  {viewYear}
                  <ChevronDown size={13} />
                </button>
                {yearOpen && (
                  <div className="date-time-year-menu">
                    {years.map(year => (
                      <button
                        key={year}
                        type="button"
                        className="date-time-year-option"
                        data-active={year === viewYear ? 'true' : undefined}
                        onClick={() => {
                          setViewYear(year);
                          setYearOpen(false);
                        }}
                      >
                        {year}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button type="button" onClick={nextMonth} aria-label="Next month" className="date-time-month-nav">
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="weekday-grid">
            {WEEKDAYS.map(d => <div key={d} className="weekday-cell">{d}</div>)}
          </div>

          <div className="date-grid">
            {cells.map((cell, i) => {
              const isSelected = cell.type === 'curr' && selDate &&
                selDate.getDate() === cell.day && selDate.getMonth() === viewMonth && selDate.getFullYear() === viewYear;
              const isToday = cell.type === 'curr' &&
                today.getDate() === cell.day && today.getMonth() === viewMonth && today.getFullYear() === viewYear;
              const isDisabled = cell.type !== 'curr' || isBeforeMinCalendarDate(viewYear, viewMonth, cell.day);
              return (
                <button
                  key={`${cell.type}-${cell.day}-${i}`}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => !isDisabled && selectDay(cell.day)}
                  className="date-cell"
                  data-muted={cell.type !== 'curr' ? 'true' : undefined}
                  data-disabled={isDisabled ? 'true' : undefined}
                  data-today={isToday ? 'true' : undefined}
                  data-selected={isSelected ? 'true' : undefined}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="time-pane">
          <div className="time-wheel-wrapper">
            <div className="time-wheel-band" />
            <WheelCol items={HOURS} selected={pad(hour12)} onSelect={selectHour} />
            <WheelCol items={MINS} selected={pad(minute)} onSelect={selectMinute} />
            <WheelCol items={PERIODS} selected={period} onSelect={selectPeriod} loop={false} />
          </div>
        </div>
      )}
      </div>

      <div className="date-time-footer">
        <button
          type="button"
          onClick={() => {
            const now = new Date();
            setViewMonth(now.getMonth());
            setViewYear(now.getFullYear());
            applyDate(now);
          }}
          className="date-time-footer-secondary"
        >
          {activePanel === 'date' ? 'Today' : 'Now'}
        </button>
        <button
          type="button"
          className="date-time-footer-primary"
          onClick={() => activePanel === 'date' ? setActivePanel('time') : setOpen(false)}
        >
          {activePanel === 'date' ? (
            <>
              Continue
              <ChevronRight size={17} />
            </>
          ) : (
            <>
              <Check size={17} />
              Done
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div ref={containerRef} className="date-time-picker" style={style}>
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); setOpen(prev => !prev); }}
        className="ui-field date-time-trigger"
        data-open={open ? 'true' : undefined}
        data-placeholder={!displayText ? 'true' : undefined}
      >
        <span>{displayText || (placeholder ?? 'Select date & time')}</span>
        <Calendar width={15} height={15} stroke="currentColor" strokeWidth={1.8} style={{ flexShrink: 0, marginLeft: '8px', color: 'var(--admin-text-subtle)' }} />
      </button>

      {open && popover}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';

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
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const optionSignature = useMemo(() => options.map(o => `${o.value}:${o.label}`).join('|'), [options]);
  const selected = options.find(o => o.value === value) ?? options[0];
  const selectedIndex = Math.max(0, options.findIndex(o => o.value === selected?.value));
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

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open || !options.length) return;
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const direction = e.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex(i => (i + direction + options.length) % options.length);
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        setActiveIndex(options.length - 1);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        commitOption(activeIndex);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [activeIndex, open, options.length]);

  const commitOption = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!options.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex);
        return;
      }
      const direction = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex(i => (i + direction + options.length) % options.length);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
      setActiveIndex(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
      setActiveIndex(options.length - 1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex);
        return;
      }
      commitOption(activeIndex);
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />}
      <div className={`relative ${open ? 'z-50' : 'z-10'} ${className ?? ''}`} style={wrapperStyle}>
        <button
          type="button"
          className="ui-field ui-select-trigger"
          onClick={() => setOpen(v => !v)}
          onKeyDown={handleKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-activedescendant={open ? `custom-select-option-${activeIndex}` : undefined}
          data-open={open ? 'true' : undefined}>
          <span>{selected?.label}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, color: 'var(--admin-text-subtle)' }}>
            <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {open && (
          <div className="ui-popover" role="listbox">
            {options.map((opt, index) => (
              <button
                key={opt.value}
                id={`custom-select-option-${index}`}
                ref={el => { itemRefs.current[index] = el; }}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commitOption(index)}
                className="ui-menu-item"
                data-active={opt.value === value ? 'true' : undefined}
                data-highlighted={index === activeIndex ? 'true' : undefined}>
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

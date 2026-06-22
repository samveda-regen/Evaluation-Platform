import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ChevronRight, ChevronDown, Search, X } from 'lucide-react';
import { adminApi } from '../../services/api';
import BackButton from '../../components/BackButton';

/* ── Types ── */
interface Attempt {
  id: string;
  startTime: string;
  status: string;
  score: number | null;
  candidate: { id: string; name: string; email: string };
  test: { id: string; name: string };
}
interface TestOption { id: string; name: string }

/* ── Avatar helpers (same as AdminDashboard) ── */
const AVATAR_COLORS = [
  '#8B5CF6','#7C3AED','#EF4444','#3B82F6','#F97316',
  '#F59E0B','#EC4899','#0EA5E9','#84CC16','#F59E0B',
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(name: string) {
  return name.trim().split(/\s+/)
    .map(p => p.replace(/[^a-zA-Z]/g, ''))
    .filter(Boolean)
    .map(p => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/* ── Status badge (same logic as AdminDashboard's StatusBadge) ── */
function StatusBadge({ status }: { status: string }) {
  const MAP: Record<string, { label: string; dot: string; text: string; bg: string }> = {
    submitted:      { label: 'Submitted',      dot: '#F59E0B', text: '#D97706', bg: '#FFFBEB' },
    auto_submitted: { label: 'Auto-submitted', dot: '#F59E0B', text: '#D97706', bg: '#FFFBEB' },
    in_progress:    { label: 'Inprogress',     dot: '#FBBF24', text: '#92400E', bg: '#FEF3C7' },
    inprogress:     { label: 'Inprogress',     dot: '#FBBF24', text: '#92400E', bg: '#FEF3C7' },
  };
  const cfg = MAP[status] ?? { label: status, dot: '#98A2B5', text: '#6A7387', bg: '#F3F4F6' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '4px 12px', borderRadius: '20px',
      backgroundColor: cfg.bg, fontSize: '12px', fontWeight: 500, color: cfg.text,
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: cfg.dot, flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

const STATUS_OPTIONS = [
  { value: '',               label: 'All statuses' },
  { value: 'submitted',      label: 'Submitted' },
  { value: 'auto_submitted', label: 'Auto-submitted' },
  { value: 'in_progress',    label: 'Inprogress' },
];

/* ── Custom amber-themed dropdown ── */
function CustomSelect({ value, onChange, options, placeholder, style }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const selected = options.find(o => o.value === value);
  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <div
        onClick={() => setOpen(p => !p)}
        style={{
          padding: '8px 12px', borderRadius: '8px',
          border: `1px solid ${open ? '#F59E0B' : '#FDE68A'}`,
          backgroundColor: 'white', fontSize: '13px', color: value ? '#D97706' : '#6A7387',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '8px', userSelect: 'none', transition: 'border-color 0.15s',
        }}
      >
        <span style={{ fontWeight: value ? 500 : 400 }}>{selected?.label || placeholder}</span>
        <ChevronDown size={12} color={open ? '#F59E0B' : '#98A2B5'} style={{ transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100,
          backgroundColor: 'white', borderRadius: '9px',
          border: '1px solid #FDE68A', boxShadow: '0 8px 24px rgba(245,158,11,0.12)',
          minWidth: '100%', overflow: 'hidden',
        }}>
          {options.map(opt => (
            <div
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                padding: '9px 14px', fontSize: '13px',
                backgroundColor: opt.value === value ? 'rgba(245,158,11,0.1)' : 'transparent',
                color: opt.value === value ? '#D97706' : '#434B5E',
                cursor: 'pointer', fontWeight: opt.value === value ? 600 : 400,
                transition: 'background-color 0.1s',
              }}
              onMouseEnter={e => { if (opt.value !== value) e.currentTarget.style.backgroundColor = 'rgba(245,158,11,0.06)'; }}
              onMouseLeave={e => { if (opt.value !== value) e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AllAttempts() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [attempts,    setAttempts]    = useState<Attempt[]>([]);
  const [tests,       setTests]       = useState<TestOption[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [total,       setTotal]       = useState(0);
  const [page,        setPage]        = useState(1);
  const PAGE_SIZE = 50;

  const [testId,      setTestId]      = useState(searchParams.get('testId')  || '');
  const [status,      setStatus]      = useState(searchParams.get('status')  || '');
  const [searchInput, setSearchInput] = useState(searchParams.get('search')  || '');
  const [search,      setSearch]      = useState(searchParams.get('search')  || '');

  const load = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const { data } = await adminApi.getAllAttempts({
        testId: testId || undefined,
        status: status || undefined,
        search: search || undefined,
        page:   pg,
        limit:  PAGE_SIZE,
      });
      setAttempts(data.attempts ?? []);
      if (data.tests?.length) setTests(data.tests);
      setTotal(data.pagination?.total ?? 0);
      setPage(pg);
    } catch {
      setAttempts([]);
    } finally {
      setLoading(false);
    }
  }, [testId, status, search]);

  useEffect(() => { void load(1); }, [load]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (testId) next.set('testId', testId);
    if (status) next.set('status', status);
    if (search) next.set('search', search);
    setSearchParams(next, { replace: true });
  }, [testId, status, search, setSearchParams]);

  function applySearch() { setSearch(searchInput.trim()); }
  function clearFilters() { setTestId(''); setStatus(''); setSearch(''); setSearchInput(''); }
  const hasFilters = testId || status || search;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div style={{ padding: '0', backgroundColor: '#F9FAFB', minHeight: '100%' }}>

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#98A2B5', marginBottom: '8px' }}>
        <span style={{ cursor: 'pointer', color: '#6A7387' }} onClick={() => navigate('/admin/dashboard')}>
          Workspace
        </span>
        <span>›</span>
        <span>All Attempts</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <BackButton />
          <div>
            <h1 style={{ fontSize: "32px", fontWeight: 700, letterSpacing: "-0.02em", color: "#11162A", margin: "0 0 4px", lineHeight: 1.2 }}>All Attempts</h1>
            <p style={{ fontSize: '13px', color: '#98A2B5', margin: 0 }}>
              {loading ? 'Loading…' : `${total} attempt${total !== 1 ? 's' : ''} across all tests`}
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        backgroundColor: 'white', borderRadius: '14px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
        padding: '14px 18px', marginBottom: '16px',
        display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
      }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: '180px' }}>
          <Search size={13} color="#98A2B5" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applySearch()}
            placeholder="Search candidate or test…"
            style={{
              width: '100%', padding: '8px 12px 8px 30px', borderRadius: '8px',
              border: '1px solid #E5E7EB', fontSize: '13px', color: '#434B5E',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Test dropdown */}
        <CustomSelect
          value={testId}
          onChange={setTestId}
          options={[{ value: '', label: 'All tests' }, ...tests.map(t => ({ value: t.id, label: t.name }))]}
          placeholder="All tests"
          style={{ flex: '1 1 180px', minWidth: '150px' }}
        />

        {/* Status dropdown */}
        <CustomSelect
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
          placeholder="All statuses"
        />

        {/* Search btn */}
        <button
          onClick={applySearch}
          style={{
            padding: '8px 18px', borderRadius: '8px', border: 'none',
            backgroundColor: '#F59E0B', color: 'white',
            fontSize: '13px', fontWeight: 600, cursor: 'pointer', flexShrink: 0,
          }}
        >
          Search
        </button>

        {hasFilters && (
          <button
            onClick={clearFilters}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '8px 12px', borderRadius: '8px',
              border: '1px solid #E5E7EB', backgroundColor: 'white',
              color: '#6A7387', fontSize: '13px', cursor: 'pointer', flexShrink: 0,
            }}
          >
            <X size={13} />
            Clear
          </button>
        )}
      </div>

      {/* Table card */}
      <div style={{ backgroundColor: 'white', borderRadius: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#F59E0B' }} />
          </div>
        ) : attempts.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '64px 0', color: '#98A2B5', fontSize: '14px' }}>
            No attempts found{hasFilters ? ' — try adjusting your filters' : ''}
          </p>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                  {['CANDIDATE', 'TEST', 'WHEN', 'STATUS', 'SCORE', ''].map((h, i) => (
                    <th key={i} style={{
                      padding: '14px 16px', textAlign: 'left',
                      fontSize: '11px', fontWeight: 600,
                      letterSpacing: '0.07em', color: '#98A2B5',
                      whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attempts.map(attempt => (
                  <tr
                    key={attempt.id}
                    onClick={() => navigate(`/admin/attempts/${attempt.id}`)}
                    style={{ borderBottom: '1px solid #F9FAFB', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(245,158,11,0.09)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'white')}
                  >
                    {/* Candidate */}
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                          backgroundColor: avatarColor(attempt.candidate.name || attempt.candidate.email),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '12px', fontWeight: 700, color: 'white',
                        }}>
                          {initials(attempt.candidate.name || attempt.candidate.email)}
                        </div>
                        <p style={{ fontSize: '13px', fontWeight: 500, color: '#11162A', margin: 0, whiteSpace: 'nowrap' }}>
                          {attempt.candidate.name || attempt.candidate.email}
                        </p>
                      </div>
                    </td>

                    {/* Test */}
                    <td style={{ padding: '14px 16px' }}>
                      <p style={{
                        fontSize: '13px', color: '#434B5E', margin: 0,
                        maxWidth: '300px', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {attempt.test.name}
                      </p>
                    </td>

                    {/* When */}
                    <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                      <p style={{ fontSize: '13px', color: '#6A7387', margin: 0 }}>
                        {format(new Date(attempt.startTime), 'MMM d, h:mm a')}
                      </p>
                    </td>

                    {/* Status */}
                    <td style={{ padding: '14px 16px' }}>
                      <StatusBadge status={attempt.status} />
                    </td>

                    {/* Score */}
                    <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                      <p style={{ fontSize: '13px', fontWeight: 600, color: '#11162A', margin: 0 }}>
                        {attempt.score != null ? `${attempt.score}%` : '—'}
                      </p>
                    </td>

                    {/* Arrow */}
                    <td style={{ padding: '14px 12px 14px 0', textAlign: 'right' }}>
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: '28px', height: '28px', borderRadius: '50%',
                        backgroundColor: '#F9FAFB',
                      }}>
                        <ChevronRight size={13} color="#98A2B5" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 16px', borderTop: '1px solid #F3F4F6',
              }}>
                <p style={{ fontSize: '13px', color: '#6A7387', margin: 0 }}>
                  Page {page} of {totalPages} · {total} total
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    disabled={page <= 1}
                    onClick={() => void load(page - 1)}
                    style={{
                      padding: '6px 14px', borderRadius: '8px',
                      border: '1px solid #E5E7EB', backgroundColor: 'white',
                      fontSize: '13px', color: '#434B5E',
                      cursor: page <= 1 ? 'not-allowed' : 'pointer',
                      opacity: page <= 1 ? 0.4 : 1,
                    }}
                  >
                    Previous
                  </button>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => void load(page + 1)}
                    style={{
                      padding: '6px 14px', borderRadius: '8px', border: 'none',
                      backgroundColor: '#F59E0B', color: 'white',
                      fontSize: '13px', fontWeight: 600,
                      cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                      opacity: page >= totalPages ? 0.4 : 1,
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

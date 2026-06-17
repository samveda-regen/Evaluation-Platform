import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ChevronRight, Search, X } from 'lucide-react';
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
  '#10B981','#EC4899','#0EA5E9','#84CC16','#F59E0B',
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(name: string) {
  return name.trim().split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

/* ── Status badge (same logic as AdminDashboard's StatusBadge) ── */
function StatusBadge({ status }: { status: string }) {
  const MAP: Record<string, { label: string; dot: string; text: string; bg: string }> = {
    submitted:      { label: 'Submitted',      dot: '#10B981', text: '#059669', bg: '#ECFDF5' },
    auto_submitted: { label: 'Auto-submitted', dot: '#F59E0B', text: '#D97706', bg: '#FFFBEB' },
    in_progress:    { label: 'Inprogress',     dot: '#3B82F6', text: '#2563EB', bg: '#EFF6FF' },
    inprogress:     { label: 'Inprogress',     dot: '#3B82F6', text: '#2563EB', bg: '#EFF6FF' },
  };
  const cfg = MAP[status] ?? { label: status, dot: '#9CA3AF', text: '#6B7280', bg: '#F3F4F6' };
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#9CA3AF', marginBottom: '8px' }}>
        <span style={{ cursor: 'pointer', color: '#6B7280' }} onClick={() => navigate('/admin/dashboard')}>
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
            <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>All Attempts</h1>
            <p style={{ fontSize: '13px', color: '#9CA3AF', margin: 0 }}>
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
          <Search size={13} color="#9CA3AF" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applySearch()}
            placeholder="Search candidate or test…"
            style={{
              width: '100%', padding: '8px 12px 8px 30px', borderRadius: '8px',
              border: '1px solid #E5E7EB', fontSize: '13px', color: '#374151',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Test dropdown */}
        <select
          value={testId}
          onChange={e => setTestId(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: '8px', border: '1px solid #E5E7EB',
            backgroundColor: 'white', fontSize: '13px', color: '#374151',
            cursor: 'pointer', flex: '1 1 180px', minWidth: '150px',
          }}
        >
          <option value="">All tests</option>
          {tests.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        {/* Status dropdown */}
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: '8px', border: '1px solid #E5E7EB',
            backgroundColor: 'white', fontSize: '13px', color: '#374151', cursor: 'pointer',
          }}
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Search btn */}
        <button
          onClick={applySearch}
          style={{
            padding: '8px 18px', borderRadius: '8px', border: 'none',
            backgroundColor: '#10B981', color: 'white',
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
              color: '#6B7280', fontSize: '13px', cursor: 'pointer', flexShrink: 0,
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
            <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#10B981' }} />
          </div>
        ) : attempts.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '64px 0', color: '#9CA3AF', fontSize: '14px' }}>
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
                      letterSpacing: '0.07em', color: '#9CA3AF',
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
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#EDF0F7')}
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
                        <p style={{ fontSize: '13px', fontWeight: 500, color: '#111827', margin: 0, whiteSpace: 'nowrap' }}>
                          {attempt.candidate.name || attempt.candidate.email}
                        </p>
                      </div>
                    </td>

                    {/* Test */}
                    <td style={{ padding: '14px 16px' }}>
                      <p style={{
                        fontSize: '13px', color: '#374151', margin: 0,
                        maxWidth: '300px', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {attempt.test.name}
                      </p>
                    </td>

                    {/* When */}
                    <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                      <p style={{ fontSize: '13px', color: '#6B7280', margin: 0 }}>
                        {format(new Date(attempt.startTime), 'MMM d, h:mm a')}
                      </p>
                    </td>

                    {/* Status */}
                    <td style={{ padding: '14px 16px' }}>
                      <StatusBadge status={attempt.status} />
                    </td>

                    {/* Score */}
                    <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                      <p style={{ fontSize: '13px', fontWeight: 600, color: '#111827', margin: 0 }}>
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
                        <ChevronRight size={13} color="#9CA3AF" />
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
                <p style={{ fontSize: '13px', color: '#6B7280', margin: 0 }}>
                  Page {page} of {totalPages} · {total} total
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    disabled={page <= 1}
                    onClick={() => void load(page - 1)}
                    style={{
                      padding: '6px 14px', borderRadius: '8px',
                      border: '1px solid #E5E7EB', backgroundColor: 'white',
                      fontSize: '13px', color: '#374151',
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
                      backgroundColor: '#10B981', color: 'white',
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

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { TestAttempt } from '../../types';
import { FileDown, Mail, ChevronLeft, ChevronRight, XCircle, CheckCircle2, AlertTriangle, Trash2, Send, Clock, RotateCcw } from 'lucide-react';
import Icon from '../../components/Icon';
import CustomSelect from '../../components/CustomSelect';
import { violationLabel } from '../../utils/violationLabels';

interface ActivityLogEntry {
  id: string;
  eventType: string;
  eventData?: string | null;
  timestamp: string;
}

/* --- Interfaces --- */
interface InvitationRow {
  id: string;
  name: string;
  email: string;
  inviteStatus: 'PENDING' | 'SENT' | 'FAILED';
  lifecycleStatus: 'Started' | 'Completed' | 'Not Started' | 'Expired';
  sentAt?: string | null;
  createdAt: string;
  consumedAt?: string | null;
}
interface InvitationDashboardResponse {
  test: { id: string; name: string };
  stats: { invited: number; started: number; completed: number; notStarted: number; expired: number };
  invitations: InvitationRow[];
}
interface TestInfo { id: string; name: string; testCode: string; totalMarks: number; passingMarks?: number }

interface TestCandidatesPanelProps {
  testId: string;
  onInvite?: () => void;
  refreshKey?: number;
}

/* --- Helpers --- */
const AVATAR_COLORS = ['var(--admin-data-blue)','var(--admin-data-blue-soft)','var(--admin-accent)','var(--admin-accent)','var(--admin-accent)','#EF4444','#EC4899','#F97316'];
function avatarBg(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(name: string) {
  const p = name.trim().split(/\s+/).map(w => w.replace(/[^a-zA-Z]/g, '')).filter(Boolean);
  return p.length >= 2 ? (p[0][0]+p[1][0]).toUpperCase() : (p[0]?.[0] ?? name.replace(/[^a-zA-Z]/g,'')[0] ?? '?').toUpperCase();
}
function fmtDuration(start?: string | null, end?: string | null) {
  if (!start) return '—';
  const mins = Math.floor(((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 60000);
  if (mins <= 0) return '—';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,'0')}m`;
}
function fmtAttemptDate(start?: string | null) {
  if (!start) return '—';
  return format(new Date(start), 'MMM d, yyyy');
}

type CandStatus = 'Submitted' | 'Started' | 'Permission' | 'In progress' | 'Invited' | 'Expired' | 'Failed';
function getCandStatus(invite: InvitationRow, attempt?: TestAttempt): CandStatus {
  if (attempt?.status === 'submitted' || attempt?.status === 'auto_submitted' || attempt?.status === 'flagged') return 'Submitted';
  if (attempt?.status === 'permission') return 'Permission';
  if (attempt?.status === 'in_progress') return 'In progress';
  if (invite.lifecycleStatus === 'Completed') return 'Submitted';
  if (invite.lifecycleStatus === 'Started') return 'Started';
  if (invite.lifecycleStatus === 'Expired') return 'Expired';
  if (invite.inviteStatus === 'FAILED') return 'Failed';
  return 'Invited';
}
function statusFilterValue(status: CandStatus): string {
  return status.toLowerCase().replace(/\s+/g, '_');
}
const STATUS_CFG: Record<CandStatus, { bg: string; color: string; dot: string; label: string }> = {
  'Submitted':   { bg:'var(--admin-accent-soft)', color:'var(--admin-accent-hover)', dot:'var(--admin-accent)', label:'Submitted' },
  'Started':     { bg:'var(--admin-accent-soft)', color:'var(--admin-accent-link)', dot:'var(--admin-accent)', label:'Started' },
  'Permission':  { bg:'#EFF6FF', color:'#1D4ED8', dot:'#3B82F6', label:'Permission' },
  'In progress': { bg:'var(--admin-accent-soft)', color:'var(--admin-accent-link)', dot:'var(--admin-accent)', label:'In progress' },
  'Invited':     { bg:'var(--admin-border)', color:'var(--admin-text-muted)', dot:'var(--admin-text-subtle)', label:'Invited' },
  'Expired':     { bg:'#FEF2F2', color:'#DC2626', dot:'#EF4444', label:'Expired' },
  'Failed':      { bg:'#FEF2F2', color:'#DC2626', dot:'#EF4444', label:'Failed' },
};

export default function TestCandidatesPanel({ testId, onInvite, refreshKey = 0 }: TestCandidatesPanelProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const CANDIDATES_PAGE_SIZE = 10;

  const [invData, setInvData] = useState<InvitationDashboardResponse | null>(null);
  const [invLoading, setInvLoading] = useState(true);
  const [test, setTest] = useState<TestInfo | null>(null);
  const [attempts, setAttempts] = useState<TestAttempt[]>([]);
  const [resLoading, setResLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [forceSubmittingId, setForceSubmittingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => { load(); }, [testId, refreshKey]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const load = async () => {
    setInvLoading(true); setResLoading(true);
    try {
      const [invRes, resRes] = await Promise.allSettled([
        adminApi.getTestInvitations(testId),
        adminApi.getTestResults(testId, 1, 100, '', false),
      ]);
      if (invRes.status === 'fulfilled') setInvData(invRes.value.data);
      else toast.error('Failed to load candidates');
      if (resRes.status === 'fulfilled') {
        setTest(resRes.value.data.test);
        setAttempts(resRes.value.data.attempts || []);
      }
    } finally { setInvLoading(false); setResLoading(false); }
  };

  const handleDeleteCandidate = async (invitationId: string, name: string) => {
    if (!window.confirm(`Remove ${name} from this assessment? This cannot be undone.`)) return;
    setDeletingId(invitationId);
    try {
      await adminApi.deleteTestInvitation(testId, invitationId);
      toast.success(`${name} removed`);
      setSelectedId(null);
      await load();
    } catch { toast.error('Failed to remove candidate'); }
    finally { setDeletingId(null); }
  };

  const handleForceSubmit = async (attemptId: string, name: string) => {
    if (!window.confirm(`Force-submit ${name}'s attempt now? Whatever they've answered so far will be graded, and they won't be able to continue the test.`)) return;
    setForceSubmittingId(attemptId);
    try {
      await adminApi.forceSubmitAttempt(attemptId);
      toast.success(`${name}'s attempt submitted`);
      await load();
    } catch { toast.error('Failed to force-submit attempt'); }
    finally { setForceSubmittingId(null); }
  };

  const handleResendInvitation = async (invitationId: string, name: string, hasAttempt: boolean) => {
    const confirmMsg = hasAttempt
      ? `Resend the invitation to ${name}? Their current attempt (answers, score) will be reset so the new link starts a clean retake.`
      : `Resend the invitation to ${name}? A new link and access code will be emailed to them.`;
    if (!window.confirm(confirmMsg)) return;
    setResendingId(invitationId);
    try {
      const { data } = await adminApi.resendTestInvitation(testId, invitationId);
      toast.success(data?.message || `Invitation resent to ${name}`);
      await load();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Failed to resend invitation'); }
    finally { setResendingId(null); }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await adminApi.exportResults(testId, 'csv');
      const blob = new Blob([response.data as BlobPart], { type:'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${test?.name ?? 'test'}_results.csv`; a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV exported');
    } catch { toast.error('Export failed'); } finally { setExporting(false); }
  };

  /* -- Build attempt lookup by email -- */
  const attemptByEmail = new Map<string, TestAttempt>();
  attempts.forEach(a => { const e = a.candidate?.email?.toLowerCase(); if (e) attemptByEmail.set(e, a); });

  /* -- Merge invitations + attempts -- */
  const rows = (invData?.invitations || []).map(inv => ({
    inv,
    attempt: attemptByEmail.get(inv.email.toLowerCase()),
  }));

  /* -- Stat counts -- */
  const invitedCount  = rows.length;
  const inProgCount   = rows.filter(r => getCandStatus(r.inv, r.attempt) === 'In progress').length;
  const submittedCount= rows.filter(r => getCandStatus(r.inv, r.attempt) === 'Submitted').length;
  const flaggedCount  = rows.filter(r => (r.attempt?.violations ?? 0) > 0).length;

  /* -- Filter -- */
  const q = search.trim().toLowerCase();
  const filtered = rows.filter(({ inv, attempt }) => {
    const matchSearch = !q || inv.name.toLowerCase().includes(q) || inv.email.toLowerCase().includes(q);
    if (!matchSearch) return false;
    if (statusFilter === 'all') return true;
    return statusFilterValue(getCandStatus(inv, attempt)) === statusFilter;
  });

  /* -- Pagination -- */
  const totalPages = Math.max(1, Math.ceil(filtered.length / CANDIDATES_PAGE_SIZE));
  const pagedRows = filtered.slice((page - 1) * CANDIDATES_PAGE_SIZE, page * CANDIDATES_PAGE_SIZE);

  /* -- Selected candidate -- */
  const selectedRow = selectedId ? rows.find(r => r.inv.id === selectedId) : null;
  const selInv  = selectedRow?.inv;
  const selAttempt = selectedRow?.attempt;
  const selScorePct = selAttempt?.score != null && test?.totalMarks
    ? Math.round((selAttempt.score / test.totalMarks) * 100) : null;

  /* -- Integrity flags (derive from violation count) -- */
  const viol = selAttempt?.violations ?? 0;
  const integrityFlags: string[] = viol > 0 ? [
    `Tab switch ×${Math.ceil(viol / 2)}`,
    viol >= 2 ? 'Face not detected (8s)' : '',
    viol >= 4 ? `Multiple persons detected ×${viol - 2}` : '',
  ].filter(Boolean) : [];

  useEffect(() => {
    if (!selAttempt?.id) { setActivityLogs([]); return; }
    let cancelled = false;
    setLogsLoading(true);
    adminApi.getAttemptDetails(selAttempt.id)
      .then(({ data }) => { if (!cancelled) setActivityLogs(data.activityLogs || []); })
      .catch(() => { if (!cancelled) setActivityLogs([]); })
      .finally(() => { if (!cancelled) setLogsLoading(false); });
    return () => { cancelled = true; };
  }, [selAttempt?.id]);

  const isLoading = invLoading || resLoading;

  /* -- Stat card component -- */
  const StatCard = ({ label, count, borderColor }: { label: string; count: number; borderColor: string }) => (
    <div className="rounded-2xl px-6 py-5 flex items-start gap-3"
      style={{ backgroundColor:'white', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', borderLeft:`4px solid ${borderColor}` }}>
      <div>
        <p className="text-3xl font-bold" style={{ color:'var(--admin-text)' }}>{count}</p>
        <p className="text-sm mt-0.5" style={{ color:'var(--admin-text-muted)' }}>{label}</p>
      </div>
    </div>
  );

  return (
    <div style={{ position:'relative' }}>

      {/* -- 4 Stat cards -- */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <StatCard label="Invited"     count={invitedCount}   borderColor="var(--admin-accent)" />
        <StatCard label="In progress" count={inProgCount}    borderColor="var(--admin-accent)" />
        <StatCard label="Submitted"   count={submittedCount} borderColor="var(--admin-accent)" />
        <StatCard label="Flagged"     count={flaggedCount}   borderColor="#EF4444" />
      </div>

      {/* -- Toolbar -- */}
      <div className="flex items-center gap-3 mb-4" style={{ overflow: 'visible' }}>
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-md"
            style={{ width:22, height:22, backgroundColor:'var(--admin-accent-soft)' }}>
            <Icon name="search" size={13} />
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search candidates..."
            className="admin-filter-input w-full pr-4 py-2 rounded-xl border text-sm outline-none"
            style={{ paddingLeft:'36px' }}
          />
        </div>
        {/* Status filter */}
        <CustomSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value:'all',         label:'All status' },
            { value:'submitted',   label:'Submitted' },
            { value:'started',     label:'Started' },
            { value:'in_progress', label:'In progress' },
            { value:'invited',     label:'Invited' },
            { value:'expired',     label:'Expired' },
          ]}
          style={{ width:'150px', minWidth:'150px' }}
        />

        <div className="flex-1 min-w-0" />

        {/* Export CSV */}
        <button onClick={handleExport} disabled={exporting}
          className="btn btn-secondary">
          <FileDown width={14} height={14} color="var(--admin-accent)" />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>

        {/* Invite candidates */}
        <button onClick={onInvite}
          className="btn btn-primary">
          <Mail width={14} height={14} stroke="white" />
          Invite candidates
        </button>
      </div>

      {/* -- Table -- */}
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor:'white', boxShadow:'0 1px 4px rgba(0,0,0,0.07)' }}>
        {/* Table header */}
        <div className="grid px-5 py-3" style={{
          gridTemplateColumns:'minmax(220px,1fr) 140px 130px 90px 90px 100px 130px 36px',
          borderBottom:'1px solid var(--admin-border)',
        }}>
          {['CANDIDATE','STATUS','ATTEMPTED ON','SCORE','TRUST','TIME','INTEGRITY',''].map(col => (
            <span key={col} className="text-xs font-semibold uppercase tracking-wide" style={{ color:'var(--admin-text-subtle)' }}>{col}</span>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor:'var(--admin-accent)' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium" style={{ color:'var(--admin-text-muted)' }}>No candidates found</p>
            <p className="text-xs mt-1" style={{ color:'var(--admin-text-subtle)' }}>
              {invData?.invitations.length ? 'Try adjusting your filters.' : 'Invite candidates to get started.'}
            </p>
          </div>
        ) : (
          <div>
            {pagedRows.map(({ inv, attempt }) => {
              const status = getCandStatus(inv, attempt);
              const sc = STATUS_CFG[status];
              const scorePct = attempt?.score != null && test?.totalMarks
                ? Math.round((attempt.score / test.totalMarks) * 100) : null;
              const trust = attempt?.trustScore != null ? Math.round(attempt.trustScore) : null;
              const trustDot = trust != null ? (trust >= 80 ? 'var(--admin-accent)' : trust >= 60 ? 'var(--admin-accent)' : '#EF4444') : 'var(--admin-border)';
              const scoreCol = scorePct != null ? (scorePct >= 70 ? 'var(--admin-accent)' : scorePct >= 50 ? 'var(--admin-accent)' : '#EF4444') : 'var(--admin-text-muted)';
              const time = fmtDuration(attempt?.startTime, attempt?.endTime);
              const viol = attempt?.violations ?? 0;
              const integrity = status === 'In progress' || status === 'Started' ? 'Live'
                : status === 'Invited' || status === 'Expired' ? 'Not started'
                : viol === 0 ? 'Clean' : `${viol} flag${viol > 1 ? 's' : ''}`;
              const integrityCl = integrity === 'Live' ? '#0891B2'
                : integrity === 'Clean' ? 'var(--admin-accent-hover)'
                : integrity === 'Not started' ? 'var(--admin-text-subtle)' : '#DC2626';
              const isSelected = selectedId === inv.id;

              return (
                <div key={inv.id}
                  className="grid px-5 py-4 cursor-pointer transition-colors hover:bg-gray-50"
                  style={{
                    gridTemplateColumns:'minmax(220px,1fr) 140px 130px 90px 90px 100px 130px 36px',
                    borderBottom:'1px solid #F9FAFB',
                    alignItems:'center',
                    backgroundColor: isSelected ? 'var(--admin-accent-soft)' : undefined,
                  }}
                  onClick={() => setSelectedId(prev => prev === inv.id ? null : inv.id)}>

                  {/* Candidate */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white"
                      style={{ backgroundColor: avatarBg(inv.name) }}>
                      {initials(inv.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color:'var(--admin-text)' }}>{inv.name}</p>
                      <p className="text-xs truncate" style={{ color:'var(--admin-text-muted)' }}>{inv.email}</p>
                    </div>
                  </div>

                  {/* Status */}
                  <div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                      style={{ backgroundColor: sc.bg, color: sc.color }}>
                      <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: sc.dot }} />
                      {sc.label}
                    </span>
                  </div>

                  {/* Date */}
                  <span className="text-sm" style={{ color:'var(--admin-text-muted)' }}>
                    {fmtAttemptDate(attempt?.startTime)}
                  </span>

                  {/* Score */}
                  <span className="text-sm font-semibold" style={{ color: scoreCol }}>
                    {scorePct != null ? `${scorePct}%` : '—'}
                  </span>

                  {/* Trust */}
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: trustDot }} />
                    <span className="text-sm font-semibold" style={{ color:'var(--admin-text-muted)' }}>
                      {trust != null ? trust : '—'}
                    </span>
                  </div>

                  {/* Time */}
                  <span className="text-sm" style={{ color:'var(--admin-text-muted)' }}>{time}</span>

                  {/* Integrity */}
                  <span className="text-sm font-semibold" style={{ color: integrityCl }}>{integrity}</span>

                  {/* Delete */}
                  <div className="flex items-center justify-center">
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteCandidate(inv.id, inv.name); }}
                      disabled={deletingId === inv.id}
                      className="p-1.5 rounded-lg transition-colors hover:bg-red-50"
                      style={{ color: '#DC2626', opacity: deletingId === inv.id ? 0.4 : 1 }}
                      title="Remove candidate"
                    >
                      <Trash2 width={13} height={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination footer */}
        {!isLoading && filtered.length > 0 && (
          <div className="flex items-center justify-between px-5 py-4" style={{ borderTop:'1px solid var(--admin-border)' }}>
            <p className="text-sm" style={{ color:'var(--admin-text-muted)' }}>
              Showing {(page - 1) * CANDIDATES_PAGE_SIZE + 1}–{Math.min(page * CANDIDATES_PAGE_SIZE, filtered.length)} of {filtered.length} candidates
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition-colors">
                  <ChevronLeft size={14} color="var(--admin-text-muted)" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setPage(p)}
                    className="h-8 w-8 rounded-lg text-sm font-medium transition-colors"
                    style={{ backgroundColor: page === p ? 'var(--admin-accent)' : 'transparent', color: page === p ? 'white' : 'var(--admin-text-muted)' }}>
                    {p}
                  </button>
                ))}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition-colors">
                  <ChevronRight size={14} color="var(--admin-text-muted)" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* -- Right slide-over panel -- */}
      {selectedId && selInv && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setSelectedId(null)} />

          {/* Panel */}
          <div className="fixed right-0 top-0 h-full z-50 overflow-y-auto"
            style={{ width:'380px', backgroundColor:'white', boxShadow:'-4px 0 24px rgba(0,0,0,0.12)' }}>

            {/* Header */}
            <div className="px-6 pt-6 pb-4" style={{ borderBottom:'1px solid var(--admin-border)' }}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold text-white"
                    style={{ backgroundColor: avatarBg(selInv.name) }}>
                    {initials(selInv.name)}
                  </div>
                  <div>
                    <p className="text-sm font-bold" style={{ color:'var(--admin-text)' }}>{selInv.name}</p>
                    <p className="text-xs" style={{ color:'var(--admin-text-muted)' }}>{selInv.email}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedId(null)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                  style={{ color:'var(--admin-text-subtle)' }}>
                  <XCircle width={16} height={16} />
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">

              {/* Score / Trust / Time cards */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label:'Score', value: selScorePct != null ? `${selScorePct}%` : '—' },
                  { label:'Trust', value: selAttempt?.trustScore != null ? Math.round(selAttempt.trustScore).toString() : '—' },
                  { label:'Time',  value: fmtDuration(selAttempt?.startTime, selAttempt?.endTime) },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl p-3 text-center"
                    style={{ backgroundColor:'#F9FAFB', border:'1px solid var(--admin-border)' }}>
                    <p className="text-base font-bold" style={{ color:'var(--admin-text)' }}>{value}</p>
                    <p className="text-xs mt-0.5" style={{ color:'var(--admin-text-muted)' }}>{label}</p>
                  </div>
                ))}
              </div>

              {/* Integrity flags */}
              <div>
                <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color:'var(--admin-text-subtle)' }}>
                  Integrity Flags
                </p>
                {integrityFlags.length === 0 ? (
                  <div className="flex items-center gap-2 py-2">
                    <div className="h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor:'var(--admin-accent-soft)' }}>
                      <CheckCircle2 width={10} height={10} style={{ color:'var(--admin-accent)' }} />
                    </div>
                    <span className="text-sm" style={{ color:'var(--admin-accent-hover)' }}>No integrity issues</span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {integrityFlags.map((flag, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                        style={{ backgroundColor:'#FFF7ED', border:'1px solid #FED7AA' }}>
                        <AlertTriangle width={15} height={15} style={{ flexShrink:0, color:'#F97316' }} />
                        <span className="text-sm font-medium" style={{ color:'#92400E' }}>{flag}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Activity log */}
              <div>
                <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color:'var(--admin-text-subtle)' }}>
                  Activity Log
                </p>
                {logsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2" style={{ borderColor:'var(--admin-accent)' }} />
                  </div>
                ) : activityLogs.length === 0 ? (
                  <p className="text-sm py-2" style={{ color:'var(--admin-text-subtle)' }}>No activity recorded yet.</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {activityLogs.map(log => (
                      <div key={log.id} className="flex items-start gap-2.5 px-3 py-2 rounded-xl"
                        style={{ backgroundColor:'#F9FAFB', border:'1px solid var(--admin-border)' }}>
                        <Clock width={13} height={13} style={{ flexShrink:0, marginTop:2, color:'var(--admin-text-subtle)' }} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color:'var(--admin-text)' }}>{violationLabel(log.eventType)}</p>
                          <p className="text-xs" style={{ color:'var(--admin-text-muted)' }}>{format(new Date(log.timestamp), 'MMM d, yyyy, h:mm:ss a')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => selAttempt?.id && navigate(`/admin/attempts/${selAttempt.id}`)}
                  disabled={!selAttempt?.id}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold text-white transition-colors"
                  style={{ backgroundColor: selAttempt?.id ? 'var(--admin-accent)' : 'var(--admin-accent-disabled)', cursor: selAttempt?.id ? 'pointer' : 'not-allowed' }}>
                  View full attempt
                </button>
                {selAttempt?.status === 'in_progress' && (
                  <button
                    onClick={() => handleForceSubmit(selAttempt.id, selInv.name)}
                    disabled={forceSubmittingId === selAttempt.id}
                    className="p-3 rounded-xl border flex items-center justify-center hover:bg-orange-50 transition-colors"
                    style={{ borderColor:'#FDBA74', backgroundColor:'white', cursor:'pointer' }}
                    title="Force submit — grade whatever they've answered so far">
                    <Send width={16} height={16} style={{ color:'#EA580C' }} />
                  </button>
                )}
                <button
                  onClick={() => selAttempt?.id && (async () => {
                    try {
                      const r = await adminApi.exportResults(testId, 'csv');
                      const blob = new Blob([r.data as BlobPart], { type:'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href=url;
                      a.download=`${selInv.name}_result.csv`; a.click();
                      URL.revokeObjectURL(url);
                    } catch { toast.error('Download failed'); }
                  })()}
                  disabled={!selAttempt?.id}
                  className="p-3 rounded-xl border flex items-center justify-center"
                  style={{ borderColor:'var(--admin-border)', backgroundColor:'white', cursor: selAttempt?.id ? 'pointer' : 'not-allowed' }}>
                  <FileDown width={16} height={16} style={{ color:'var(--admin-text-muted)' }} />
                </button>
                <button
                  onClick={() => handleResendInvitation(selInv.id, selInv.name, !!selAttempt)}
                  disabled={resendingId === selInv.id}
                  className="p-3 rounded-xl border flex items-center justify-center hover:bg-blue-50 transition-colors"
                  style={{ borderColor:'var(--admin-border)', backgroundColor:'white', cursor:'pointer', opacity: resendingId === selInv.id ? 0.5 : 1 }}
                  title="Resend invitation — new link, resets their attempt for a clean retake">
                  <RotateCcw width={16} height={16} style={{ color:'var(--admin-accent-link)' }} />
                </button>
                <button
                  onClick={() => handleDeleteCandidate(selInv.id, selInv.name)}
                  disabled={deletingId === selInv.id}
                  className="p-3 rounded-xl border flex items-center justify-center hover:bg-red-50 transition-colors"
                  style={{ borderColor:'#FCA5A5', backgroundColor:'white', cursor:'pointer' }}
                  title="Remove candidate">
                  <Trash2 width={16} height={16} style={{ color:'#DC2626' }} />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

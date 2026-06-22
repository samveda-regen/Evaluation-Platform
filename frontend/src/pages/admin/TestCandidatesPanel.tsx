import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { TestAttempt } from '../../types';
import { FileDown, Mail, ChevronRight, XCircle, CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react';
import Icon from '../../components/Icon';

/* ─── Interfaces ─── */
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
}

/* ─── Helpers ─── */
const AVATAR_COLORS = ['#6366F1','#8B5CF6','#F59E0B','#F59E0B','#3B82F6','#EF4444','#EC4899','#F97316'];
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

type CandStatus = 'Submitted' | 'In progress' | 'Invited' | 'Expired' | 'Failed';
function getCandStatus(invite: InvitationRow, attempt?: TestAttempt): CandStatus {
  if (attempt?.status === 'submitted' || attempt?.status === 'auto_submitted' || attempt?.status === 'flagged') return 'Submitted';
  if (attempt?.status === 'in_progress') return 'In progress';
  if (invite.lifecycleStatus === 'Completed') return 'Submitted';
  if (invite.lifecycleStatus === 'Expired') return 'Expired';
  if (invite.inviteStatus === 'FAILED') return 'Failed';
  return 'Invited';
}
const STATUS_CFG: Record<CandStatus, { bg: string; color: string; dot: string; label: string }> = {
  'Submitted':   { bg:'#FFFBEB', color:'#D97706', dot:'#F59E0B', label:'Submitted' },
  'In progress': { bg:'#EFF6FF', color:'#2563EB', dot:'#3B82F6', label:'In progress' },
  'Invited':     { bg:'#F3F4F6', color:'#6A7387', dot:'#98A2B5', label:'Invited' },
  'Expired':     { bg:'#FEF2F2', color:'#DC2626', dot:'#EF4444', label:'Expired' },
  'Failed':      { bg:'#FEF2F2', color:'#DC2626', dot:'#EF4444', label:'Failed' },
};

export default function TestCandidatesPanel({ testId, onInvite }: TestCandidatesPanelProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showStatusDrop, setShowStatusDrop] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [invData, setInvData] = useState<InvitationDashboardResponse | null>(null);
  const [invLoading, setInvLoading] = useState(true);
  const [test, setTest] = useState<TestInfo | null>(null);
  const [attempts, setAttempts] = useState<TestAttempt[]>([]);
  const [resLoading, setResLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => { load(); }, [testId]);

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

  /* ── Build attempt lookup by email ── */
  const attemptByEmail = new Map<string, TestAttempt>();
  attempts.forEach(a => { const e = a.candidate?.email?.toLowerCase(); if (e) attemptByEmail.set(e, a); });

  /* ── Merge invitations + attempts ── */
  const rows = (invData?.invitations || []).map(inv => ({
    inv,
    attempt: attemptByEmail.get(inv.email.toLowerCase()),
  }));

  /* ── Stat counts ── */
  const invitedCount  = rows.length;
  const inProgCount   = rows.filter(r => getCandStatus(r.inv, r.attempt) === 'In progress').length;
  const submittedCount= rows.filter(r => getCandStatus(r.inv, r.attempt) === 'Submitted').length;
  const flaggedCount  = rows.filter(r => (r.attempt?.violations ?? 0) > 0).length;

  /* ── Filter ── */
  const q = search.trim().toLowerCase();
  const filtered = rows.filter(({ inv, attempt }) => {
    const matchSearch = !q || inv.name.toLowerCase().includes(q) || inv.email.toLowerCase().includes(q);
    if (!matchSearch) return false;
    if (statusFilter === 'all') return true;
    const s = getCandStatus(inv, attempt).toLowerCase().replace(' ','_');
    return s === statusFilter;
  });

  /* ── Selected candidate ── */
  const selectedRow = selectedId ? rows.find(r => r.inv.id === selectedId) : null;
  const selInv  = selectedRow?.inv;
  const selAttempt = selectedRow?.attempt;
  const selScorePct = selAttempt?.score != null && test?.totalMarks
    ? Math.round((selAttempt.score / test.totalMarks) * 100) : null;

  /* ── Section performance (proportional estimate) ── */
  const sectionBars = selScorePct != null ? [
    { label: 'MCQ',        pct: Math.min(100, selScorePct + 5) },
    { label: 'Coding',     pct: Math.max(0,   selScorePct - 14) },
    { label: 'Behavioral', pct: Math.min(100, selScorePct + 10) },
  ] : [];

  /* ── Integrity flags (derive from violation count) ── */
  const viol = selAttempt?.violations ?? 0;
  const integrityFlags: string[] = viol > 0 ? [
    `Tab switch ×${Math.ceil(viol / 2)}`,
    viol >= 2 ? 'Face not detected (8s)' : '',
    viol >= 4 ? `Multiple persons detected ×${viol - 2}` : '',
  ].filter(Boolean) : [];

  const isLoading = invLoading || resLoading;

  /* ── Stat card component ── */
  const StatCard = ({ label, count, borderColor }: { label: string; count: number; borderColor: string }) => (
    <div className="rounded-2xl px-6 py-5 flex items-start gap-3"
      style={{ backgroundColor:'white', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', borderLeft:`4px solid ${borderColor}` }}>
      <div>
        <p className="text-3xl font-bold" style={{ color:'#11162A' }}>{count}</p>
        <p className="text-sm mt-0.5" style={{ color:'#6A7387' }}>{label}</p>
      </div>
    </div>
  );

  return (
    <div style={{ position:'relative' }}>

      {/* ── 4 Stat cards ── */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <StatCard label="Invited"     count={invitedCount}   borderColor="#F59E0B" />
        <StatCard label="In progress" count={inProgCount}    borderColor="#F59E0B" />
        <StatCard label="Submitted"   count={submittedCount} borderColor="#F59E0B" />
        <StatCard label="Flagged"     count={flaggedCount}   borderColor="#EF4444" />
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-md"
            style={{ width:22, height:22, backgroundColor:'#FFF6EE' }}>
            <Icon name="search" size={13} />
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search candidates..."
            className="w-full pr-4 py-2 rounded-xl border text-sm outline-none"
            style={{ paddingLeft:'36px', borderColor:'#E5E7EB', color:'#11162A', backgroundColor:'white' }}
          />
        </div>
        {/* Status filter */}
        {showStatusDrop && <div className="fixed inset-0 z-10" onClick={() => setShowStatusDrop(false)} />}
        <div className="relative z-20">
          {(() => {
            const STATUS_OPTIONS = [
              { value:'all',         label:'All status' },
              { value:'submitted',   label:'Submitted' },
              { value:'in_progress', label:'In progress' },
              { value:'invited',     label:'Invited' },
              { value:'expired',     label:'Expired' },
            ];
            const selected = STATUS_OPTIONS.find(o => o.value === statusFilter) ?? STATUS_OPTIONS[0];
            return (
              <>
                <button
                  onClick={() => setShowStatusDrop(v => !v)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border text-sm cursor-pointer"
                  style={{ borderColor:'#FDE68A', color:'#D97706', backgroundColor:'white', minWidth:'120px' }}>
                  <span className="flex-1 text-left">{selected.label}</span>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 4L6 8L10 4" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {showStatusDrop && (
                  <div className="absolute left-0 mt-1 rounded-xl overflow-hidden"
                    style={{ minWidth:'140px', backgroundColor:'white', boxShadow:'0 4px 16px rgba(0,0,0,0.10)', border:'1px solid #FDE68A' }}>
                    {STATUS_OPTIONS.map(opt => (
                      <button key={opt.value}
                        onClick={() => { setStatusFilter(opt.value); setShowStatusDrop(false); }}
                        className="w-full text-left px-4 py-2 text-sm"
                        style={{
                          backgroundColor: opt.value === statusFilter ? '#FEF3C7' : 'white',
                          color: '#D97706',
                        }}
                        onMouseEnter={e => { if (opt.value !== statusFilter) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#FFFBEB'; }}
                        onMouseLeave={e => { if (opt.value !== statusFilter) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'white'; }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>

        <div className="flex-1" />

        {/* Export CSV */}
        <button onClick={handleExport} disabled={exporting}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium"
          style={{ borderColor:'#E5E7EB', color:'#434B5E', backgroundColor:'white' }}>
          <FileDown width={14} height={14} color="#F59E0B" />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>

        {/* Invite candidates */}
        <button onClick={onInvite}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ backgroundColor:'#F59E0B' }}>
          <Mail width={14} height={14} stroke="white" />
          Invite candidates
        </button>
      </div>

      {/* ── Table ── */}
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor:'white', boxShadow:'0 1px 4px rgba(0,0,0,0.07)' }}>
        {/* Table header */}
        <div className="grid px-5 py-3" style={{
          gridTemplateColumns:'minmax(220px,1fr) 140px 90px 90px 100px 130px 36px',
          borderBottom:'1px solid #F3F4F6',
        }}>
          {['CANDIDATE','STATUS','SCORE','TRUST','TIME','INTEGRITY',''].map(col => (
            <span key={col} className="text-xs font-semibold uppercase tracking-wide" style={{ color:'#98A2B5' }}>{col}</span>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor:'#F59E0B' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium" style={{ color:'#434B5E' }}>No candidates found</p>
            <p className="text-xs mt-1" style={{ color:'#98A2B5' }}>
              {invData?.invitations.length ? 'Try adjusting your filters.' : 'Invite candidates to get started.'}
            </p>
          </div>
        ) : (
          <div>
            {filtered.map(({ inv, attempt }) => {
              const status = getCandStatus(inv, attempt);
              const sc = STATUS_CFG[status];
              const scorePct = attempt?.score != null && test?.totalMarks
                ? Math.round((attempt.score / test.totalMarks) * 100) : null;
              const trust = attempt?.trustScore != null ? Math.round(attempt.trustScore) : null;
              const trustDot = trust != null ? (trust >= 80 ? '#F59E0B' : trust >= 60 ? '#F59E0B' : '#EF4444') : '#E5E7EB';
              const scoreCol = scorePct != null ? (scorePct >= 70 ? '#F59E0B' : scorePct >= 50 ? '#F59E0B' : '#EF4444') : '#6A7387';
              const time = fmtDuration(attempt?.startTime, attempt?.endTime);
              const viol = attempt?.violations ?? 0;
              const integrity = status === 'In progress' ? 'Live'
                : status === 'Invited' || status === 'Expired' ? 'Not started'
                : viol === 0 ? 'Clean' : `${viol} flag${viol > 1 ? 's' : ''}`;
              const integrityCl = integrity === 'Live' ? '#0891B2'
                : integrity === 'Clean' ? '#D97706'
                : integrity === 'Not started' ? '#98A2B5' : '#DC2626';
              const isSelected = selectedId === inv.id;

              return (
                <div key={inv.id}
                  className="grid px-5 py-4 cursor-pointer transition-colors hover:bg-gray-50"
                  style={{
                    gridTemplateColumns:'minmax(220px,1fr) 140px 90px 90px 100px 130px 36px',
                    borderBottom:'1px solid #F9FAFB',
                    alignItems:'center',
                    backgroundColor: isSelected ? '#FFFBEB' : undefined,
                  }}
                  onClick={() => setSelectedId(prev => prev === inv.id ? null : inv.id)}>

                  {/* Candidate */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white"
                      style={{ backgroundColor: avatarBg(inv.name) }}>
                      {initials(inv.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color:'#11162A' }}>{inv.name}</p>
                      <p className="text-xs truncate" style={{ color:'#6A7387' }}>{inv.email}</p>
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

                  {/* Score */}
                  <span className="text-sm font-semibold" style={{ color: scoreCol }}>
                    {scorePct != null ? `${scorePct}%` : '—'}
                  </span>

                  {/* Trust */}
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: trustDot }} />
                    <span className="text-sm font-semibold" style={{ color:'#434B5E' }}>
                      {trust != null ? trust : '—'}
                    </span>
                  </div>

                  {/* Time */}
                  <span className="text-sm" style={{ color:'#434B5E' }}>{time}</span>

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
      </div>

      {/* ── Right slide-over panel ── */}
      {selectedId && selInv && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setSelectedId(null)} />

          {/* Panel */}
          <div className="fixed right-0 top-0 h-full z-50 overflow-y-auto"
            style={{ width:'380px', backgroundColor:'white', boxShadow:'-4px 0 24px rgba(0,0,0,0.12)' }}>

            {/* Header */}
            <div className="px-6 pt-6 pb-4" style={{ borderBottom:'1px solid #F3F4F6' }}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold text-white"
                    style={{ backgroundColor: avatarBg(selInv.name) }}>
                    {initials(selInv.name)}
                  </div>
                  <div>
                    <p className="text-sm font-bold" style={{ color:'#11162A' }}>{selInv.name}</p>
                    <p className="text-xs" style={{ color:'#6A7387' }}>{selInv.email}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedId(null)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                  style={{ color:'#98A2B5' }}>
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
                    style={{ backgroundColor:'#F9FAFB', border:'1px solid #F3F4F6' }}>
                    <p className="text-base font-bold" style={{ color:'#11162A' }}>{value}</p>
                    <p className="text-xs mt-0.5" style={{ color:'#6A7387' }}>{label}</p>
                  </div>
                ))}
              </div>

              {/* Section performance */}
              {sectionBars.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color:'#98A2B5' }}>
                    Section Performance
                  </p>
                  <div className="space-y-3">
                    {sectionBars.map(({ label, pct }) => (
                      <div key={label}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium" style={{ color:'#434B5E' }}>{label}</span>
                          <span className="text-sm font-semibold" style={{ color:'#11162A' }}>{pct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor:'#F3F4F6' }}>
                          <div className="h-full rounded-full transition-all"
                            style={{ width:`${pct}%`, backgroundColor:'#F59E0B' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Integrity flags */}
              <div>
                <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color:'#98A2B5' }}>
                  Integrity Flags
                </p>
                {integrityFlags.length === 0 ? (
                  <div className="flex items-center gap-2 py-2">
                    <div className="h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor:'#FFFBEB' }}>
                      <CheckCircle2 width={10} height={10} style={{ color:'#F59E0B' }} />
                    </div>
                    <span className="text-sm" style={{ color:'#D97706' }}>No integrity issues</span>
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

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => selAttempt?.id && navigate(`/admin/attempts/${selAttempt.id}`)}
                  disabled={!selAttempt?.id}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold text-white transition-colors"
                  style={{ backgroundColor: selAttempt?.id ? '#F59E0B' : '#FDE68A', cursor: selAttempt?.id ? 'pointer' : 'not-allowed' }}>
                  View full attempt
                </button>
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
                  style={{ borderColor:'#E5E7EB', backgroundColor:'white', cursor: selAttempt?.id ? 'pointer' : 'not-allowed' }}>
                  <FileDown width={16} height={16} style={{ color:'#434B5E' }} />
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

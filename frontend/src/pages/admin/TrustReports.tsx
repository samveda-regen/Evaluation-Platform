import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';
import { AxiosError } from 'axios';
import { adminApi } from '../../services/api';
import {
  ChevronDown,
  FileDown,
  Search,
  ExternalLink,
  Flag,
  Camera,
} from 'lucide-react';
import Icon from '../../components/Icon';
import CustomSelect from '../../components/CustomSelect';

/* -- Types -- */
type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface TrustReportRow {
  attemptId: string;
  testId: string;
  testName: string;
  testCode: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  status: string;
  isFlagged: boolean;
  startTime: string;
  endTime: string | null;
  trustScore: number;
  riskLevel: RiskLevel;
  totalViolations: number;
  violations: {
    tabSwitch: number;
    focusLoss: number;
    fullscreenExit: number;
    copyPaste: number;
    devtoolsOpen: number;
    cameraBlocked: number;
    secondaryMonitor: number;
    screenshotEvidence: number;
    phone?: number;
    multipleFaces?: number;
    faceAbsent?: number;
    lookingAway?: number;
    voice?: number;
    suspiciousAudio?: number;
    unauthorizedObject?: number;
  };
  latestViolationAt: string | null;
  latestSnapshotUrl: string | null;
  screenshotCount?: number;
  snapshotUrls?: string[];
  violationProofs?: Array<{
    eventId: string | null;
    eventType: string;
    severity: string;
    timestamp: string | null;
    snapshotUrl: string;
    isAiEvent: boolean;
    source: string;
  }>;
  llmSummary: string | null;
}

interface TestTreeNode { id: string; name: string; testCode: string; attempts: number }

/* -- Helpers -- */
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

function riskCfg(row: TrustReportRow) {
  if (row.isFlagged || row.riskLevel === 'high' || row.riskLevel === 'critical')
    return { label:'High risk', color:'#DC2626', dot:'#EF4444', bar:'#EF4444', ring:'#EF4444', bg:'#FEF2F2' };
  if (row.riskLevel === 'medium')
    return { label:'Review', color:'var(--admin-accent-hover)', dot:'var(--admin-accent)', bar:'var(--admin-accent)', ring:'var(--admin-accent)', bg:'var(--admin-accent-soft)' };
  return { label:'Trusted', color:'var(--admin-accent-hover)', dot:'var(--admin-accent)', bar:'var(--admin-accent)', ring:'var(--admin-accent)', bg:'var(--admin-accent-soft)' };
}

function fmtEventType(eventType: string): string {
  return eventType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function relTime(ts: string | null, start: string): string {
  if (!ts) return '';
  const diff = Math.max(0, new Date(ts).getTime() - new Date(start).getTime()) / 1000;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = Math.floor(diff % 60);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

interface TimelineItem { label: string; timeStr: string; snapshotUrl: string | null }
function buildTimeline(row: TrustReportRow): TimelineItem[] {
  if (row.violationProofs && row.violationProofs.length > 0) {
    const groups: Record<string, typeof row.violationProofs> = {};
    row.violationProofs.forEach(p => { (groups[p.eventType] = groups[p.eventType] || []).push(p); });
    return Object.entries(groups).slice(0,5).map(([et, proofs]) => ({
      label: fmtEventType(et) + (proofs.length > 1 ? ` ×${proofs.length}` : ''),
      timeStr: relTime(proofs[0].timestamp, row.startTime),
      snapshotUrl: proofs[0].snapshotUrl,
    }));
  }
  const V = row.violations;
  const items: TimelineItem[] = [];
  if (V.tabSwitch > 0)         items.push({ label:`Tab switch${V.tabSwitch>1?` ×${V.tabSwitch}`:''}`, timeStr:'', snapshotUrl:null });
  if ((V.phone||0) > 0)        items.push({ label:'Phone detected', timeStr:'', snapshotUrl:null });
  if ((V.multipleFaces||0) > 0) items.push({ label:'Multiple faces', timeStr:'', snapshotUrl:null });
  if (V.focusLoss > 0)         items.push({ label:`Focus loss${V.focusLoss>1?` ×${V.focusLoss}`:''}`, timeStr:'', snapshotUrl:null });
  if (V.fullscreenExit > 0)    items.push({ label:'Fullscreen exit', timeStr:'', snapshotUrl:null });
  if (V.cameraBlocked > 0)     items.push({ label:'Camera blocked', timeStr:'', snapshotUrl:null });
  if ((V.faceAbsent||0) > 0)   items.push({ label:'Face absent', timeStr:'', snapshotUrl:null });
  return items.slice(0,5);
}

/* -- SVG Donut -- */
function DonutRing({ pct, size=100, sw=10, color='var(--admin-accent)' }: { pct:number; size?:number; sw?:number; color?:string }) {
  const r    = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const off  = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--admin-border)" strokeWidth={sw}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="butt"
        transform={`rotate(-90 ${size/2} ${size/2})`}/>
    </svg>
  );
}

/* -- KPI Card -- */
function KPICard({ icon, iconBg, value, label }: { icon:React.ReactNode; iconBg:string; value:string|number; label:string }) {
  return (
    <div className="stat-card" style={{
      backgroundColor:'white', borderRadius:'14px', padding:'20px 22px',
      boxShadow:'0 1px 6px rgba(0,0,0,0.06)',
    }}>
      <div style={{
        width:'36px', height:'36px', borderRadius:'10px', backgroundColor:iconBg,
        display:'flex', alignItems:'center', justifyContent:'center', marginBottom:'12px',
      }}>{icon}</div>
      <p style={{ fontSize:'28px', fontWeight:700, color:'var(--admin-text)', margin:'0 0 4px', lineHeight:1.1 }}>{value}</p>
      <p style={{ fontSize:'13px', color:'var(--admin-text-muted)', margin:0 }}>{label}</p>
    </div>
  );
}

/* -- Camera icon (dark square) -- */
function CameraIcon() {
  return (
    <div style={{
      width:'36px', height:'36px', borderRadius:'8px', backgroundColor:'#252B3B',
      display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
    }}>
      <Camera size={16} color="var(--admin-text-subtle)" />
    </div>
  );
}

export default function TrustReports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const testIdParam = searchParams.get('testId') || '';

  const [reports,            setReports]            = useState<TrustReportRow[]>([]);
  const [testTree,           setTestTree]           = useState<TestTreeNode[]>([]);
  const [loading,            setLoading]            = useState(true);
  const [loadError,          setLoadError]          = useState('');
  const [search,             setSearch]             = useState(searchParams.get('search') || '');
  const [risk,               setRisk]               = useState(searchParams.get('risk') || '');
  const [flaggedOnly,        setFlaggedOnly]        = useState(searchParams.get('flagged') === 'true');
  const [selectedRow,        setSelectedRow]        = useState<TrustReportRow | null>(null);
  const [markTrustedLoading, setMarkTrustedLoading] = useState(false);
  const [disqualifyLoading,  setDisqualifyLoading]  = useState(false);
  const [showTestDropdown,   setShowTestDropdown]   = useState(false);
  const [reEvalLoading,      setReEvalLoading]      = useState<string | null>(null);
  const [bulkReEvalLoading,  setBulkReEvalLoading]  = useState(false);
  const [selectedIds,        setSelectedIds]        = useState<Set<string>>(new Set());
  const [bulkDeleting,       setBulkDeleting]       = useState(false);
  const [activeProofRow,     setActiveProofRow]     = useState<TrustReportRow | null>(null);

  /* -- auto-select lowest trust candidate -- */
  useEffect(() => {
    if (reports.length > 0) {
      const sorted = [...reports].sort((a, b) => a.trustScore - b.trustScore);
      setSelectedRow(prev => {
        if (!prev) return sorted[0];
        const stillExists = reports.find(r => r.attemptId === prev.attemptId);
        return stillExists ?? sorted[0];
      });
    } else {
      setSelectedRow(null);
    }
  }, [reports]);

  useEffect(() => { void loadReports(); }, [testIdParam, risk, flaggedOnly]);

  const loadReports = async () => {
    setLoading(true); setLoadError('');
    try {
      const { data } = await adminApi.getTrustReports({
        testId: testIdParam || undefined,
        risk: (risk || undefined) as RiskLevel | undefined,
        flagged: flaggedOnly || undefined,
        search: search || undefined,
        limit: 100,
      });
      setReports(data.reports || []);
      setTestTree(data.testTree || []);
      setSelectedIds(new Set());
    } catch (error) {
      const msg = (error as AxiosError<{ error?: string }>)?.response?.data?.error || 'Failed to load trust reports';
      setLoadError(msg);
      toast.error(msg, { id:'trust-load-error' });
    } finally { setLoading(false); }
  };

  const applySearch = async () => {
    const next = new URLSearchParams(searchParams);
    if (search) next.set('search', search); else next.delete('search');
    setSearchParams(next);
    await loadReports();
  };

  const handleTestSelect = (tid: string) => {
    const next = new URLSearchParams(searchParams);
    if (tid) next.set('testId', tid); else next.delete('testId');
    setSearchParams(next);
    setShowTestDropdown(false);
  };

  const handleReEvaluate = async (attemptId: string) => {
    setReEvalLoading(attemptId);
    try {
      await adminApi.reEvaluateTrustReport(attemptId);
      toast.success('Trust report re-evaluated');
      await loadReports();
    } catch { toast.error('Failed to re-evaluate'); }
    finally { setReEvalLoading(null); }
  };

  const handleReEvaluateAll = async () => {
    if (!reports.length) return;
    setBulkReEvalLoading(true);
    try {
      for (const row of reports) await adminApi.reEvaluateTrustReport(row.attemptId);
      toast.success(`Re-evaluated ${reports.length} trust reports`);
      await loadReports();
    } catch { toast.error('Bulk re-evaluate failed'); }
    finally { setBulkReEvalLoading(false); }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Delete ${selectedIds.size} attempt${selectedIds.size>1?'s':''}?`)) return;
    setBulkDeleting(true);
    let ok = 0, fail = 0;
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      try { await adminApi.deleteAttempt(id); ok++; } catch { fail++; }
    }
    setReports(prev => prev.filter(r => !ids.includes(r.attemptId)));
    setSelectedIds(new Set());
    setBulkDeleting(false);
    if (!fail) toast.success(`Deleted ${ok} attempt${ok>1?'s':''}`);
    else toast.error(`Deleted ${ok}, failed ${fail}`);
  };

  const handleMarkTrusted = async () => {
    if (!selectedRow) return;
    setMarkTrustedLoading(true);
    try {
      await adminApi.flagAttempt(selectedRow.attemptId, { isFlagged: false });
      toast.success('Marked as trusted');
      await loadReports();
    } catch { toast.error('Failed to update'); }
    finally { setMarkTrustedLoading(false); }
  };

  const handleDisqualify = async () => {
    if (!selectedRow) return;
    if (!confirm('Disqualify this candidate? This will flag their attempt.')) return;
    setDisqualifyLoading(true);
    try {
      await adminApi.flagAttempt(selectedRow.attemptId, { isFlagged: true, reason: 'Disqualified by admin' });
      toast.success('Candidate disqualified');
      await loadReports();
    } catch { toast.error('Failed to disqualify'); }
    finally { setDisqualifyLoading(false); }
  };

  const exportCSV = () => {
    if (!reports.length) { toast.error('No report rows to export'); return; }
    const header = ['Candidate','Email','Test','TestCode','TrustScore','Risk','Flagged','TabSwitch','WindowBlur','FullscreenExit','CopyPaste','DevtoolsOpen','CameraBlocked','SecondaryMonitor','Phone','MultiFace','NoFace','OffScreenGaze','Voice','ScreenshotEvidence','TotalViolations','StartTime','EndTime'];
    const rows = reports.map(row => [
      row.candidateName, row.candidateEmail, row.testName, row.testCode,
      row.trustScore.toFixed(1), row.riskLevel, row.isFlagged?'Yes':'No',
      row.violations.tabSwitch, row.violations.focusLoss, row.violations.fullscreenExit,
      row.violations.copyPaste, row.violations.devtoolsOpen, row.violations.cameraBlocked,
      row.violations.secondaryMonitor, row.violations.phone||0, row.violations.multipleFaces||0,
      row.violations.faceAbsent||0, row.violations.lookingAway||0, row.violations.voice||0,
      row.violations.screenshotEvidence||row.screenshotCount||0, row.totalViolations, row.startTime, row.endTime||'',
    ].map(String));
    const csv = [header,...rows].map(r=>r.map(c=>`"${c.replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv' });
    const url  = window.URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href=url; a.download=`trust-reports-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    window.URL.revokeObjectURL(url);
  };

  /* -- Computed stats -- */
  const stats = useMemo(() => {
    const trusted    = reports.filter(r => !r.isFlagged && r.riskLevel === 'low').length;
    const needsReview= reports.filter(r => !r.isFlagged && r.riskLevel === 'medium').length;
    const highRisk   = reports.filter(r => r.isFlagged || r.riskLevel === 'high' || r.riskLevel === 'critical').length;
    const avgTrust   = reports.length > 0 ? Math.round(reports.reduce((s,r)=>s+r.trustScore,0)/reports.length) : 0;
    return { trusted, needsReview, highRisk, avgTrust };
  }, [reports]);

  /* -- Sorted list -- */
  const sortedReports = useMemo(() => [...reports].sort((a,b) => a.trustScore - b.trustScore), [reports]);

const selectedTestLabel = useMemo(() => {
    if (!testIdParam) return 'All tests';
    return testTree.find(t => t.id === testIdParam)?.name || 'All tests';
  }, [testIdParam, testTree]);

  /* -- RENDER -- */
  return (
    <div style={{ padding:'0', backgroundColor:'#F9FAFB', minHeight:'100%' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'16px', flexWrap:'wrap', marginBottom:'24px' }}>
        <div>
          <h1 className="text-2xl font-bold" style={{ color:"var(--admin-text)", margin:0 }}>Trust &amp; Integrity Reports</h1>
          <p className="text-sm mt-0.5" style={{ color:'var(--admin-text-muted)' }}>AI-detected violations and trust scoring across all attempts.</p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'10px', flexShrink:0 }}>
          {/* Test filter dropdown */}
          {showTestDropdown && <div className="fixed inset-0 z-10" onClick={() => setShowTestDropdown(false)} />}
          <div style={{ position:'relative', zIndex:20, width:'200px', flexShrink:0 }}>
            <button onClick={() => setShowTestDropdown(p=>!p)}
              style={{
                width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'6px', padding:'7px 14px',
                border:'1px solid var(--admin-border)', borderRadius:'8px', backgroundColor:'white',
                fontSize:'13px', color:'var(--admin-text-muted)', cursor:'pointer',
              }}>
              <span style={{ minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{selectedTestLabel}</span>
              <ChevronDown size={12} color="var(--admin-text-muted)" />
            </button>
            {showTestDropdown && (
              <div style={{
                position:'absolute', top:'100%', right:0, marginTop:'4px', zIndex:20,
                backgroundColor:'white', borderRadius:'10px', boxShadow:'0 8px 24px rgba(0,0,0,0.12)',
                border:'1px solid var(--admin-border)', minWidth:'200px', maxHeight:'280px', overflowY:'auto',
              }}>
                <button onClick={() => handleTestSelect('')}
                  style={{
                    width:'100%', textAlign:'left', padding:'10px 14px', border:'none',
                    backgroundColor: !testIdParam ? 'var(--admin-accent-soft)' : 'white',
                    color: !testIdParam ? 'var(--admin-accent-hover)' : 'var(--admin-text-muted)',
                    fontSize:'13px', cursor:'pointer', borderBottom:'1px solid var(--admin-border)',
                  }}>All tests</button>
                {testTree.map(t => (
                  <button key={t.id} onClick={() => handleTestSelect(t.id)}
                    style={{
                      width:'100%', textAlign:'left', padding:'10px 14px', border:'none',
                      backgroundColor: testIdParam===t.id ? 'var(--admin-accent-soft)' : 'white',
                      color: testIdParam===t.id ? 'var(--admin-accent-hover)' : 'var(--admin-text-muted)',
                      fontSize:'13px', cursor:'pointer', borderBottom:'1px solid var(--admin-border)',
                    }}>
                    <p style={{ margin:'0 0 2px', fontWeight:500 }}>{t.name}</p>
                    <p style={{ margin:0, fontSize:'11px', color:'var(--admin-text-subtle)' }}>{t.testCode} · {t.attempts} attempts</p>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Export */}
          <button onClick={exportCSV}
            style={{
              display:'flex', alignItems:'center', gap:'6px', padding:'7px 16px',
              border:'1.5px solid var(--admin-border)', borderRadius:'8px', backgroundColor:'white',
              fontSize:'13px', fontWeight:500, color:'var(--admin-text-muted)', cursor:'pointer',
            }}>
            <FileDown size={14} />
            Export
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'16px', marginBottom:'20px' }}>
        <KPICard
          iconBg="var(--admin-accent-soft)"
          icon={<Icon name="trusted" size={26} />}
          value={loading ? '—' : stats.trusted}
          label="Trusted"
        />
        <KPICard
          iconBg="var(--admin-accent-soft)"
          icon={<Icon name="needs-review" size={26} />}
          value={loading ? '—' : stats.needsReview}
          label="Needs review"
        />
        <KPICard
          iconBg="var(--admin-accent-soft)"
          icon={<Icon name="high-risk" size={26} />}
          value={loading ? '—' : stats.highRisk}
          label="High risk"
        />
        <KPICard
          iconBg="var(--admin-accent-soft)"
          icon={<Icon name="average-trust" size={26} />}
          value={loading ? '—' : stats.avgTrust}
          label="Avg trust"
        />
      </div>

      {/* Main 2-column */}
      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:'80px 0' }}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor:'var(--admin-accent)' }} />
        </div>
      ) : loadError ? (
        <div style={{ textAlign:'center', padding:'60px 0', color:'#DC2626' }}>
          <p style={{ fontWeight:600 }}>{loadError}</p>
          <button onClick={() => void loadReports()}
            style={{ marginTop:'12px', padding:'8px 20px', borderRadius:'8px', border:'1px solid var(--admin-border)', backgroundColor:'white', cursor:'pointer', fontSize:'13px' }}>
            Retry
          </button>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 360px', gap:'16px', alignItems:'start' }}>

          {/* -- LEFT: Flagged attempts list -- */}
          <div style={{ backgroundColor:'white', borderRadius:'14px', boxShadow:'0 1px 6px rgba(0,0,0,0.06)' }}>
            {/* List header + search */}
            <div style={{ padding:'20px 22px 0' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
                <p style={{ fontSize:'15px', fontWeight:600, color:'var(--admin-text)', margin:0 }}>Flagged attempts</p>
                <div style={{ display:'flex', gap:'6px' }}>
                  {selectedIds.size > 0 && (
                    <button onClick={() => void handleBulkDelete()} disabled={bulkDeleting}
                      style={{ padding:'5px 12px', borderRadius:'7px', border:'none', backgroundColor:'#EF4444', color:'white', fontSize:'12px', cursor:'pointer' }}>
                      {bulkDeleting ? 'Deleting…' : `Delete (${selectedIds.size})`}
                    </button>
                  )}
                  <button onClick={() => void handleReEvaluateAll()} disabled={bulkReEvalLoading || !reports.length}
                    style={{ padding:'5px 12px', borderRadius:'7px', border:'1px solid var(--admin-border)', backgroundColor:'white', fontSize:'12px', color:'var(--admin-text-muted)', cursor:'pointer' }}>
                    {bulkReEvalLoading ? 'Re-evaluating…' : 'Re-evaluate all'}
                  </button>
                </div>
              </div>
              {/* Search bar */}
              <div style={{ display:'flex', gap:'8px', marginBottom:'16px' }}>
                <div style={{ position:'relative', flex:1 }}>
                  <Search size={14} color="var(--admin-text-subtle)" style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }} />
                  <input value={search} onChange={e=>setSearch(e.target.value)}
                    onKeyDown={e => e.key==='Enter' && void applySearch()}
                    placeholder="Search candidate, test…"
                    className="admin-filter-input"
                    style={{ width:'100%', padding:'8px 12px 8px 32px', borderRadius:'8px', border:'1px solid var(--admin-border)', fontSize:'13px', outline:'none', boxSizing:'border-box' }}
                  />
                </div>
                <CustomSelect
                  value={risk}
                  onChange={v => setRisk(v)}
                  options={[
                    { value:'',         label:'All risk' },
                    { value:'low',      label:'Low' },
                    { value:'medium',   label:'Medium' },
                    { value:'high',     label:'High' },
                    { value:'critical', label:'Critical' },
                  ]}
                />
                <button onClick={()=>void applySearch()}
                  className="btn btn-primary"
                  style={{ fontSize:'12px' }}>
                  Search
                </button>
              </div>
              {/* Flagged only toggle */}
              <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'12px' }}>
                <label style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'var(--admin-text-muted)', cursor:'pointer' }}>
                  <input type="checkbox" checked={flaggedOnly} onChange={e=>setFlaggedOnly(e.target.checked)} />
                  Flagged only
                </label>
                <span style={{ fontSize:'12px', color:'var(--admin-text-subtle)', marginLeft:'auto' }}>{sortedReports.length} reports</span>
              </div>
            </div>

            {/* -- Candidate rows -- */}
            {sortedReports.length === 0 ? (
              <p style={{ textAlign:'center', padding:'48px 0', color:'var(--admin-text-subtle)', fontSize:'13px' }}>No trust reports found</p>
            ) : (
              <div style={{ maxHeight:'520px', overflowY:'auto' }}>
                {sortedReports.map(row => {
                  const rc   = riskCfg(row);
                  const isSel = selectedRow?.attemptId === row.attemptId;
                  return (
                    <div key={row.attemptId}
                      onClick={() => setSelectedRow(row)}
                      style={{
                        display:'flex', alignItems:'center', gap:'12px',
                        padding:'14px 22px', cursor:'pointer', borderBottom:'1px solid #F9FAFB',
                        backgroundColor: isSel ? 'var(--admin-accent-soft)' : 'white',
                        transition:'background-color 0.15s',
                      }}>
                      {/* checkbox */}
                      <input type="checkbox" checked={selectedIds.has(row.attemptId)}
                        onClick={e=>e.stopPropagation()}
                        onChange={()=>setSelectedIds(prev=>{const n=new Set(prev); n.has(row.attemptId)?n.delete(row.attemptId):n.add(row.attemptId); return n;})}
                        style={{ flexShrink:0 }}
                      />
                      {/* avatar */}
                      <div style={{
                        width:'38px', height:'38px', borderRadius:'50%', flexShrink:0,
                        backgroundColor: avatarBg(row.candidateName || row.candidateEmail),
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:'12px', fontWeight:700, color:'white',
                      }}>
                        {initials(row.candidateName || row.candidateEmail)}
                      </div>
                      {/* name + test */}
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ fontSize:'13px', fontWeight:600, color:'var(--admin-text)', margin:'0 0 2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {row.candidateName || row.candidateEmail}
                        </p>
                        <p style={{ fontSize:'11px', color:'var(--admin-text-subtle)', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {row.testName}
                        </p>
                      </div>
                      {/* risk badge */}
                      <div style={{ display:'flex', alignItems:'center', gap:'4px', flexShrink:0 }}>
                        <span style={{ width:'6px', height:'6px', borderRadius:'50%', backgroundColor: rc.dot, flexShrink:0 }} />
                        <span style={{ fontSize:'11px', fontWeight:500, color: rc.color }}>{rc.label}</span>
                      </div>
                      {/* color bar + trust score */}
                      <div style={{ display:'flex', alignItems:'center', gap:'6px', flexShrink:0 }}>
                        <div style={{ width:'3px', height:'36px', borderRadius:'2px', backgroundColor: rc.bar }} />
                        <span style={{ fontSize:'15px', fontWeight:700, color:'var(--admin-text)', minWidth:'28px', textAlign:'right' }}>
                          {Math.round(row.trustScore)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* -- RIGHT: Detail panel -- */}
          <div style={{ backgroundColor:'white', borderRadius:'14px', boxShadow:'0 1px 6px rgba(0,0,0,0.06)', overflow:'hidden' }}>
            {!selectedRow ? (
              <div style={{ padding:'48px 20px', textAlign:'center', color:'var(--admin-text-subtle)', fontSize:'13px' }}>
                Select a candidate to view details
              </div>
            ) : (() => {
              const rc      = riskCfg(selectedRow);
              const timeline= buildTimeline(selectedRow);
              return (
                <>
                  {/* Candidate header */}
                  <div style={{ padding:'20px 22px', borderBottom:'1px solid var(--admin-border)' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                      <div style={{
                        width:'44px', height:'44px', borderRadius:'50%', flexShrink:0,
                        backgroundColor: avatarBg(selectedRow.candidateName || selectedRow.candidateEmail),
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:'14px', fontWeight:700, color:'white',
                      }}>
                        {initials(selectedRow.candidateName || selectedRow.candidateEmail)}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ fontSize:'15px', fontWeight:600, color:'var(--admin-text)', margin:'0 0 2px' }}>
                          {selectedRow.candidateName}
                        </p>
                        <p style={{ fontSize:'12px', color:'var(--admin-text-subtle)', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {selectedRow.testName}
                        </p>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'4px', flexShrink:0 }}>
                        <span style={{ width:'7px', height:'7px', borderRadius:'50%', backgroundColor: rc.dot }} />
                        <span style={{ fontSize:'12px', fontWeight:600, color: rc.color }}>{rc.label}</span>
                      </div>
                    </div>
                  </div>

                  {/* Trust donut + violations */}
                  <div style={{ padding:'20px 22px', display:'flex', alignItems:'center', gap:'24px', borderBottom:'1px solid var(--admin-border)' }}>
                    {/* Donut ring */}
                    <div style={{ position:'relative', flexShrink:0 }}>
                      <DonutRing pct={selectedRow.trustScore} size={100} sw={10} color={rc.ring} />
                      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
                        <span style={{ fontSize:'18px', fontWeight:700, color:'var(--admin-text)', lineHeight:1 }}>{Math.round(selectedRow.trustScore)}</span>
                        <span style={{ fontSize:'9px', color:'var(--admin-text-subtle)', letterSpacing:'0.06em', marginTop:'2px' }}>TRUST</span>
                      </div>
                    </div>
                    {/* Violations + session link */}
                    <div style={{ flex:1 }}>
                      <p style={{ fontSize:'12px', color:'var(--admin-text-subtle)', margin:'0 0 4px' }}>Detected violations</p>
                      <p style={{ fontSize:'32px', fontWeight:700, color:'var(--admin-text)', margin:'0 0 10px', lineHeight:1 }}>
                        {selectedRow.totalViolations}
                      </p>
                      <button
                        onClick={() => navigate(`/admin/attempts/${selectedRow!.attemptId}/proctoring`)}
                        style={{
                          display:'flex', alignItems:'center', gap:'4px',
                          background:'none', border:'none', padding:0, cursor:'pointer',
                          fontSize:'12px', color:'var(--admin-accent)', fontWeight:500,
                        }}>
                        Trust score report
                        <ExternalLink size={13} color="var(--admin-accent)" />
                      </button>
                    </div>
                  </div>

                  {/* Evidence timeline */}
                  <div style={{ padding:'16px 22px', borderBottom:'1px solid var(--admin-border)' }}>
                    <p style={{ fontSize:'10px', fontWeight:700, color:'var(--admin-text-subtle)', letterSpacing:'0.08em', margin:'0 0 12px' }}>
                      EVIDENCE TIMELINE
                    </p>
                    {timeline.length === 0 ? (
                      <p style={{ fontSize:'12px', color:'var(--admin-text-subtle)' }}>No violation events recorded</p>
                    ) : (
                      <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                        {timeline.map((item, i) => (
                          <div key={i} style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                            <CameraIcon />
                            <div style={{ flex:1, minWidth:0 }}>
                              <p style={{ fontSize:'13px', fontWeight:500, color:'var(--admin-text)', margin:'0 0 1px' }}>{item.label}</p>
                              {item.timeStr && (
                                <p style={{ fontSize:'11px', color:'var(--admin-text-subtle)', margin:0 }}>{item.timeStr} · evidence captured</p>
                              )}
                            </div>
                            {/* snapshot circle */}
                            <button
                              onClick={() => setActiveProofRow(selectedRow!)}
                              style={{
                                width:'28px', height:'28px', borderRadius:'50%', flexShrink:0,
                                border:'1.5px solid var(--admin-border)', backgroundColor: item.snapshotUrl ? 'var(--admin-border)' : 'transparent',
                                cursor:'pointer', overflow:'hidden', padding:0,
                              }}>
                              {item.snapshotUrl ? (
                                <img src={item.snapshotUrl} alt="evidence" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                              ) : (
                                <span style={{ fontSize:'8px', color:'var(--admin-text-subtle)' }}>?</span>
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Re-evaluate row */}
                  <div style={{ padding:'10px 22px', borderBottom:'1px solid var(--admin-border)', display:'flex', justifyContent:'flex-end' }}>
                    <button onClick={()=>void handleReEvaluate(selectedRow!.attemptId)}
                      disabled={reEvalLoading === selectedRow.attemptId}
                      style={{ padding:'6px 14px', borderRadius:'7px', border:'1px solid var(--admin-border)', backgroundColor:'white', fontSize:'12px', color:'var(--admin-text-muted)', cursor:'pointer' }}>
                      {reEvalLoading === selectedRow.attemptId ? 'Re-evaluating…' : 'Re-evaluate'}
                    </button>
                  </div>

                  {/* Action buttons */}
                  <div style={{ padding:'16px 22px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
                    <button onClick={()=>void handleMarkTrusted()} disabled={markTrustedLoading}
                      style={{
                        padding:'11px', borderRadius:'10px', border:'1.5px solid var(--admin-border)',
                        backgroundColor:'white', fontSize:'13px', fontWeight:500, color:'var(--admin-text-muted)',
                        cursor: markTrustedLoading ? 'not-allowed' : 'pointer',
                      }}>
                      {markTrustedLoading ? 'Saving…' : 'Mark trusted'}
                    </button>
                    <button onClick={()=>void handleDisqualify()} disabled={disqualifyLoading}
                      style={{
                        padding:'11px', borderRadius:'10px', border:'none',
                        backgroundColor: disqualifyLoading ? '#FCA5A5' : '#FF1414',
                        fontSize:'13px', fontWeight:600, color:'white',
                        cursor: disqualifyLoading ? 'not-allowed' : 'pointer',
                        display:'flex', alignItems:'center', justifyContent:'center', gap:'6px',
                      }}>
                      <Flag size={13} color="white" />
                      {disqualifyLoading ? 'Saving…' : 'Disqualify'}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>

        </div>
      )}

      {/* -- Proof image modal -- */}
      {activeProofRow && (
        <div style={{
          position:'fixed', inset:0, backgroundColor:'rgba(0,0,0,0.6)', zIndex:50,
          display:'flex', alignItems:'center', justifyContent:'center', padding:'16px',
        }}>
          <div style={{ backgroundColor:'white', borderRadius:'16px', width:'100%', maxWidth:'900px', maxHeight:'90vh', overflow:'hidden', display:'flex', flexDirection:'column' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:'1px solid var(--admin-border)' }}>
              <div>
                <p style={{ fontSize:'16px', fontWeight:600, color:'var(--admin-text)', margin:'0 0 2px' }}>
                  Violation Proofs: {activeProofRow.candidateName}
                </p>
                <p style={{ fontSize:'12px', color:'var(--admin-text-muted)', margin:0 }}>
                  {activeProofRow.testName} · {(activeProofRow.violationProofs||[]).length} evidence items
                </p>
              </div>
              <button onClick={()=>setActiveProofRow(null)}
                style={{ padding:'6px 14px', borderRadius:'8px', border:'1px solid var(--admin-border)', backgroundColor:'white', cursor:'pointer', fontSize:'13px' }}>
                Close
              </button>
            </div>
            <div style={{ padding:'16px', overflowY:'auto', flex:1 }}>
              {(activeProofRow.violationProofs||[]).length === 0 ? (
                <p style={{ textAlign:'center', color:'var(--admin-text-subtle)', fontSize:'13px', padding:'40px 0' }}>No evidence images available.</p>
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'12px' }}>
                  {(activeProofRow.violationProofs||[]).map((proof, idx) => (
                    <div key={idx} style={{ borderRadius:'10px', border:'1px solid var(--admin-border)', overflow:'hidden' }}>
                      <img src={proof.snapshotUrl} alt={proof.eventType} style={{ width:'100%', height:'160px', objectFit:'cover', backgroundColor:'var(--admin-border)' }} />
                      <div style={{ padding:'10px 12px' }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'4px' }}>
                          <p style={{ fontSize:'13px', fontWeight:500, color:'var(--admin-text)', margin:0 }}>
                            {fmtEventType(proof.eventType)}
                          </p>
                          <span style={{ fontSize:'10px', padding:'2px 8px', borderRadius:'20px', backgroundColor: proof.isAiEvent?'var(--admin-accent-soft)':'var(--admin-border)', color: proof.isAiEvent?'#92400E':'#6B7280' }}>
                            {proof.isAiEvent?'AI':'Non-AI'}
                          </span>
                        </div>
                        <p style={{ fontSize:'11px', color:'var(--admin-text-subtle)', margin:'2px 0' }}>Severity: {proof.severity}</p>
                        {proof.timestamp && <p style={{ fontSize:'11px', color:'var(--admin-text-subtle)', margin:'2px 0' }}>{format(new Date(proof.timestamp),'MMM d, h:mm:ss a')}</p>}
                        <a href={proof.snapshotUrl} target="_blank" rel="noreferrer"
                          style={{ fontSize:'11px', color:'var(--admin-accent)', textDecoration:'none' }}>
                          Open full image ?
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

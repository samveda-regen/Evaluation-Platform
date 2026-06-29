import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api, { adminApi } from '../../services/api';
import BackButton from '../../components/BackButton';
import CustomSelect from '../../components/CustomSelect';
import {
  FileDown,
  Users,
  PieChart,
  ClipboardCheck,
  Timer,
  ShieldCheck,
} from 'lucide-react';

/* -- Types -- */
interface DifficultyAnalysis {
  easy:   { totalCorrect: number; totalQuestions: number; avgAccuracy: number };
  medium: { totalCorrect: number; totalQuestions: number; avgAccuracy: number };
  hard:   { totalCorrect: number; totalQuestions: number; avgAccuracy: number };
  totalAttempts: number;
}
interface SkillAnalysis {
  skill: string; totalCorrect: number; totalQuestions: number; avgAccuracy: number; candidateCount: number;
}
interface CandidateComparison {
  candidateId: string; candidateName: string; candidateEmail: string;
  score: number; percentage: number; percentile: number; grade: string;
  trustScore: number; violations: number; isFlagged: boolean;
  difficultyAccuracy: { easy: number; medium: number; hard: number } | null;
}
interface TestAnalytics {
  totalAttempts: number; completedAttempts: number; averageScore: number;
  medianScore: number; highestScore: number; lowestScore: number;
  passRate: number; flaggedAttempts: number; averageTrustScore: number;
  scoreDistribution: Record<string, number>;
}
interface AdminOverview {
  stats: {
    totalAttempts: number; avgScore: number; passRate: number; avgTimeMinutes: number;
    changes: { attempts: number | null; avgScore: number | null; passRate: number | null };
  } | null;
  scoreTrend:  { label: string; avgScore: number; count: number }[];
  skillCoverage: { skill: string; avgAccuracy: number }[];
  difficultyBreakdown: {
    easy:   { avgAccuracy: number; count: number };
    medium: { avgAccuracy: number; count: number };
    hard:   { avgAccuracy: number; count: number };
  } | null;
  topCandidates: {
    rank: number; candidateId: string; candidateName: string;
    score: number; trustScore: number; attemptId: string;
  }[];
}
interface TestOption { id: string; name: string }

/* -- Helpers -- */
const AVATAR_COLORS = ['var(--admin-data-blue)','var(--admin-data-blue-soft)','var(--admin-accent)','var(--admin-accent)','var(--admin-accent)','#EF4444','#EC4899','#F97316'];
function avatarBg(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(name: string) {
  const p = name.trim().split(/\s+/).map(w => w.replace(/[^a-zA-Z]/g, '')).filter(Boolean);
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : (p[0]?.[0] ?? name.replace(/[^a-zA-Z]/g,'')[0] ?? '?').toUpperCase();
}
function skillColor(pct: number) {
  if (pct >= 70) return 'var(--admin-accent)';
  if (pct >= 50) return 'var(--admin-accent)';
  return '#EF4444';
}
function fmtTime(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}
function fmtChange(val: number | null | undefined): string | undefined {
  if (val === null || val === undefined) return undefined;
  return val >= 0 ? `+${val}%` : `${val}%`;
}

/* -- SVG Donut -- */
function DonutRing({ pct, size = 88, sw = 9, color = 'var(--admin-accent)' }: {
  pct: number; size?: number; sw?: number; color?: string;
}) {
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const clampedPct = Math.min(100, Math.max(0, pct));
  const off = circ - (clampedPct / 100) * circ;
  // track is a light tint of the ring color so the identity is visible even at 0%
  const trackColor = `${color}28`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={trackColor} strokeWidth={sw} />
      {clampedPct > 0 && (
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} />
      )}
    </svg>
  );
}

/* -- KPI Card -- */
function KPICard({ icon, iconBg, value, label, change, changeUp }: {
  icon: React.ReactNode; iconBg: string; value: string; label: string;
  change?: string; changeUp?: boolean;
}) {
  return (
    <div className="stat-card" style={{
      backgroundColor: 'white', borderRadius: '14px', padding: '20px 22px',
      boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '10px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          width: '36px', height: '36px', borderRadius: '10px', backgroundColor: iconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
        {change !== undefined && (
          <span style={{
            fontSize: '12px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px',
            backgroundColor: changeUp ? 'var(--admin-accent-soft)' : '#FEF2F2',
            color: changeUp ? 'var(--admin-accent-hover)' : '#DC2626',
          }}>{change}</span>
        )}
      </div>
      <div>
        <p style={{ fontSize: '28px', fontWeight: 700, color: 'var(--admin-text)', margin: 0, lineHeight: 1.1 }}>{value}</p>
        <p style={{ fontSize: '13px', color: 'var(--admin-text-muted)', margin: '4px 0 0' }}>{label}</p>
      </div>
    </div>
  );
}

/* -- Score trend bar (relative heights) -- */
function TrendBar({ label, value, sublabel, maxValue }: {
  label: string; value: number; sublabel: string; maxValue: number;
}) {
  const heightPx = maxValue > 0 ? Math.max(4, Math.round((value / maxValue) * 160)) : 4;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', height: '160px', width: '100%', justifyContent: 'center' }}>
        <div style={{
          width: '100%', maxWidth: '52px', height: `${heightPx}px`,
          backgroundColor: value > 0 ? 'var(--admin-accent)' : 'var(--admin-border)',
          borderRadius: '6px 6px 0 0', transition: 'height 0.4s',
        }} />
      </div>
      <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--admin-text-muted)', margin: 0 }}>{label}</p>
      <p style={{ fontSize: '11px', color: 'var(--admin-text-subtle)', margin: 0 }}>{sublabel}</p>
    </div>
  );
}

export default function PerformanceAnalytics() {
  const { testId: routeTestId } = useParams<{ testId: string }>();
  const navigate = useNavigate();

  /* If arrived via /admin/tests/:testId/analytics, start with that test selected */
  const [selectedTestId, setSelectedTestId] = useState(routeTestId || '');
  const [tests,          setTests]          = useState<TestOption[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [trendWin,       setTrendWin]       = useState<'7d'|'30d'|'90d'>('30d');

  /* per-test state */
  const [testAnalytics,      setTestAnalytics]      = useState<TestAnalytics | null>(null);
  const [difficultyAnalysis, setDifficultyAnalysis] = useState<DifficultyAnalysis | null>(null);
  const [skillAnalysis,      setSkillAnalysis]      = useState<SkillAnalysis[]>([]);
  const [comparison,         setComparison]         = useState<CandidateComparison[]>([]);
  const [candidateAttemptMap,setCandidateAttemptMap]= useState<Record<string,string>>({});
  const [testTotalMarks,     setTestTotalMarks]     = useState(100);

  /* admin-wide state */
  const [overview, setOverview] = useState<AdminOverview | null>(null);

  const isTestMode = !!selectedTestId;

  /* Load test list for dropdown */
  useEffect(() => {
    adminApi.getTests(1, 100, '').then(({ data }) => {
      const list: TestOption[] = (data.tests || []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }));
      setTests(list);
    }).catch(() => {});
  }, []);

  const fetchAdminOverview = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.getAdminAnalyticsOverview(trendWin);
      setOverview(data.data as AdminOverview);
    } catch { toast.error('Failed to load analytics'); }
    finally { setLoading(false); }
  }, [trendWin]);

  const fetchTestData = useCallback(async (testId: string) => {
    setLoading(true);
    try {
      const [testRes, diffRes, skillRes, compRes, resultsRes] = await Promise.all([
        api.get(`/analytics/test/${testId}`),
        api.get(`/analytics/test/${testId}/difficulty`),
        api.get(`/analytics/test/${testId}/skills`),
        api.get(`/analytics/test/${testId}/comparison`),
        adminApi.getTestResults(testId, 1, 100),
      ]);
      setTestAnalytics(testRes.data.analytics);
      setDifficultyAnalysis(diffRes.data.analysis);
      setSkillAnalysis(skillRes.data.skills || []);
      setComparison(compRes.data.comparison || []);

      const tm = resultsRes.data?.test?.totalMarks;
      if (tm) setTestTotalMarks(tm);

      const results: Array<{ id: string; candidateId?: string; candidate?: { id: string } }> =
        resultsRes.data?.results || resultsRes.data?.attempts || [];
      const map: Record<string,string> = {};
      results.forEach(r => {
        const cid = r.candidateId ?? r.candidate?.id;
        if (cid && r.id) map[cid] = r.id;
      });
      setCandidateAttemptMap(map);
    } catch { toast.error('Failed to load analytics'); }
    finally { setLoading(false); }
  }, []);

  /* Re-fetch when selectedTestId or trendWin changes */
  useEffect(() => {
    if (selectedTestId) {
      void fetchTestData(selectedTestId);
    } else {
      void fetchAdminOverview();
    }
  }, [selectedTestId, fetchAdminOverview, fetchTestData]);

  const handleExport = async () => {
    const tid = selectedTestId;
    if (!tid) return;
    try {
      const res = await adminApi.exportResults(tid, 'csv');
      const url = window.URL.createObjectURL(new Blob([res.data as BlobPart]));
      const a = document.createElement('a'); a.href = url; a.download = 'results.csv'; a.click();
      window.URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
  };

  const handleCandidateClick = (cid: string, attemptId?: string) => {
    const aid = attemptId ?? candidateAttemptMap[cid];
    if (aid) navigate(`/admin/attempts/${aid}`);
    else toast.error('No attempt found');
  };

  /* -- Derived display values -- */
  let kpiAttempts = '—', kpiAvgScore = '—', kpiPassRate = '—', kpiFourth = '—';
  let kpiFourthLabel = isTestMode ? 'Avg trust' : 'Avg time';
  let changeAttempts: string|undefined, changeAvgScore: string|undefined, changePassRate: string|undefined;
  let changeUpAttempts = true, changeUpAvgScore = true, changeUpPassRate = true;

  if (!isTestMode && overview?.stats) {
    const s = overview.stats;
    kpiAttempts  = String(s.totalAttempts);
    kpiAvgScore  = `${s.avgScore}%`;
    kpiPassRate  = `${s.passRate}%`;
    kpiFourth    = fmtTime(s.avgTimeMinutes);
    changeAttempts  = fmtChange(s.changes.attempts);  changeUpAttempts  = (s.changes.attempts  ?? 0) >= 0;
    changeAvgScore  = fmtChange(s.changes.avgScore);  changeUpAvgScore  = (s.changes.avgScore  ?? 0) >= 0;
    changePassRate  = fmtChange(s.changes.passRate);  changeUpPassRate  = (s.changes.passRate  ?? 0) >= 0;
  } else if (isTestMode && testAnalytics) {
    const ta = testAnalytics;
    kpiAttempts = String(ta.totalAttempts);
    kpiAvgScore = `${Math.round((ta.averageScore / testTotalMarks) * 100)}%`;
    kpiPassRate = `${Math.round(ta.passRate)}%`;
    kpiFourth   = ta.averageTrustScore != null ? `${Math.round(ta.averageTrustScore)}%` : '—';
  }

  /* Score trend */
  let trendBars: { label: string; value: number; sublabel: string }[] = [];
  if (!isTestMode && overview) {
    trendBars = overview.scoreTrend.map(b => ({
      label: b.label,
      value: b.avgScore,
      sublabel: b.count > 0 ? `${b.avgScore}%` : '—',
    }));
  } else if (isTestMode) {
    const sorted = [...comparison].sort((a, b) => b.percentage - a.percentage).slice(0, 6);
    trendBars = sorted.map((c, i) => ({
      label: `W${i+1}`,
      value: Math.round(c.percentage),
      sublabel: `${Math.round(c.percentage)}%`,
    }));
  }
  while (trendBars.length < 6) trendBars.push({ label: `W${trendBars.length+1}`, value: 0, sublabel: '—' });
  const maxTrend = Math.max(...trendBars.map(b => b.value), 1);

  /* Skill coverage */
  const displaySkills = isTestMode
    ? skillAnalysis.slice(0, 7).map(s => ({ skill: s.skill, pct: Math.round(s.avgAccuracy) }))
    : (overview?.skillCoverage || []).map(s => ({ skill: s.skill, pct: s.avgAccuracy }));

  /* Difficulty */
  type DiffBreak = { easy:{avgAccuracy:number;count:number}; medium:{avgAccuracy:number;count:number}; hard:{avgAccuracy:number;count:number} } | null;
  const displayDiff: DiffBreak = isTestMode
    ? (difficultyAnalysis
        ? {
            easy:   { avgAccuracy: difficultyAnalysis.easy.avgAccuracy,   count: difficultyAnalysis.easy.totalQuestions   },
            medium: { avgAccuracy: difficultyAnalysis.medium.avgAccuracy, count: difficultyAnalysis.medium.totalQuestions },
            hard:   { avgAccuracy: difficultyAnalysis.hard.avgAccuracy,   count: difficultyAnalysis.hard.totalQuestions   },
          }
        : null)
    : (overview?.difficultyBreakdown ?? null);

  /* Top candidates */
  interface TopEntry { id:string; name:string; pct:number; trust:number; attemptId?:string }
  const topCandidates: TopEntry[] = isTestMode
    ? [...comparison].sort((a,b)=>b.percentage-a.percentage).slice(0,4)
        .map(c=>({ id:c.candidateId, name:c.candidateName||c.candidateEmail, pct:Math.round(c.percentage), trust:Math.round(c.trustScore) }))
    : (overview?.topCandidates||[]).map(c=>({ id:c.candidateId, name:c.candidateName, pct:c.score, trust:c.trustScore, attemptId:c.attemptId }));

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', padding:'80px 0' }}>
      <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor:'var(--admin-accent)' }} />
    </div>
  );

  return (
    <div style={{ padding:'0', backgroundColor:'#F9FAFB', minHeight:'100%' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'24px' }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:'12px' }}>
          <BackButton />
          <div>
            <h1 style={{ fontSize:'32px', fontWeight:700, letterSpacing:'-0.02em', color:'var(--admin-text)', margin:'0 0 4px', lineHeight:1.2 }}>Performance Analytics</h1>
            <p style={{ fontSize:'13px', color:'var(--admin-text-muted)', margin:0 }}>Cross-test outcomes, skill coverage and candidate comparison.</p>
          </div>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:'10px', flexShrink:0 }}>
          {/* Test selector dropdown */}
          <CustomSelect
            value={selectedTestId}
            onChange={setSelectedTestId}
            options={[
              { value:'', label:'All tests' },
              ...tests.map(t => ({ value:t.id, label:t.name })),
            ]}
            style={{ width:'220px', minWidth:'220px' }}
          />

          {/* Export (only when a test is selected) */}
          {isTestMode && (
            <button onClick={handleExport}
              style={{
                display:'flex', alignItems:'center', gap:'6px', padding:'8px 16px',
                border:'1.5px solid var(--admin-border)', borderRadius:'8px', backgroundColor:'white',
                fontSize:'13px', fontWeight:500, color:'var(--admin-text-muted)', cursor:'pointer',
              }}>
              <FileDown size={14} />
              Export
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'16px', marginBottom:'20px' }}>
        <KPICard iconBg="#EDE9FE" icon={<Users size={18} color="#7C3AED" />}
          value={kpiAttempts} label="Attempts" change={changeAttempts} changeUp={changeUpAttempts} />
        <KPICard iconBg="#EDE9FE" icon={<PieChart size={18} color="#7C3AED" />}
          value={kpiAvgScore} label="Avg score" change={changeAvgScore} changeUp={changeUpAvgScore} />
        <KPICard iconBg="var(--admin-accent-disabled)" icon={<ClipboardCheck size={18} color="var(--admin-accent-link)" />}
          value={kpiPassRate} label="Pass rate" change={changePassRate} changeUp={changeUpPassRate} />
        <KPICard iconBg="var(--admin-accent-disabled)"
          icon={isTestMode ? <ShieldCheck size={18} color="var(--admin-accent-hover)" /> : <Timer size={18} color="var(--admin-accent-hover)" />}
          value={kpiFourth} label={kpiFourthLabel} />
      </div>

      {/* Score Statistics (per-test only) */}
      {isTestMode && testAnalytics && testAnalytics.completedAttempts > 0 && (
        <div style={{ backgroundColor:'white', borderRadius:'14px', padding:'22px 24px', boxShadow:'0 1px 6px rgba(0,0,0,0.06)', marginBottom:'16px' }}>
          <p style={{ fontSize:'16px', fontWeight:600, color:'var(--admin-text)', margin:'0 0 20px' }}>Score Statistics</p>
          <div style={{ display:'flex', justifyContent:'space-around', textAlign:'center' }}>
            {[
              { label:'Highest', value: testAnalytics.highestScore != null ? `${Math.round((testAnalytics.highestScore/testTotalMarks)*100)}%` : '—', color:'var(--admin-accent)' },
              { label:'Median',  value: testAnalytics.medianScore  != null ? `${Math.round((testAnalytics.medianScore/testTotalMarks)*100)}%`  : '—', color:'var(--admin-text)' },
              { label:'Average', value: testAnalytics.averageScore != null ? `${Math.round((testAnalytics.averageScore/testTotalMarks)*100)}%` : '—', color:'var(--admin-accent)' },
              { label:'Lowest',  value: testAnalytics.lowestScore  != null ? `${Math.round((testAnalytics.lowestScore/testTotalMarks)*100)}%`  : '—', color:'#EF4444' },
              { label:'Flagged', value: String(testAnalytics.flaggedAttempts ?? 0), color:'#F97316' },
            ].map(stat => (
              <div key={stat.label}>
                <p style={{ fontSize:'13px', color:'var(--admin-text-muted)', margin:'0 0 6px' }}>{stat.label}</p>
                <p style={{ fontSize:'24px', fontWeight:700, color:stat.color, margin:0 }}>{stat.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Score Trend + Skill Coverage */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:'16px', marginBottom:'16px' }}>

        {/* Score trend */}
        <div style={{ backgroundColor:'white', borderRadius:'14px', padding:'22px 24px', boxShadow:'0 1px 6px rgba(0,0,0,0.06)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px' }}>
            <p style={{ fontSize:'16px', fontWeight:600, color:'var(--admin-text)', margin:0 }}>Score trend</p>
            <div style={{ display:'flex', gap:'2px', backgroundColor:'var(--admin-border)', borderRadius:'8px', padding:'3px' }}>
              {(['7d','30d','90d'] as const).map(w => (
                <button key={w} onClick={() => setTrendWin(w)}
                  style={{
                    padding:'4px 10px', borderRadius:'6px', border:'none', cursor:'pointer',
                    fontSize:'12px', fontWeight:500,
                    backgroundColor: trendWin === w ? 'var(--admin-text)' : 'transparent',
                    color: trendWin === w ? 'white' : 'var(--admin-text-muted)',
                  }}>{w}</button>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', gap:'8px', alignItems:'flex-end' }}>
            {trendBars.map(b => (
              <TrendBar key={b.label} label={b.label} value={b.value} sublabel={b.sublabel} maxValue={maxTrend} />
            ))}
          </div>
        </div>

        {/* Skill coverage */}
        <div style={{ backgroundColor:'white', borderRadius:'14px', padding:'22px 24px', boxShadow:'0 1px 6px rgba(0,0,0,0.06)' }}>
          <p style={{ fontSize:'16px', fontWeight:600, color:'var(--admin-text)', margin:'0 0 16px' }}>Skill coverage</p>
          {displaySkills.length === 0 ? (
            <p style={{ fontSize:'13px', color:'var(--admin-text-subtle)' }}>No skill data</p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
              {displaySkills.map(s => {
                const col = skillColor(s.pct);
                return (
                  <div key={s.skill}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                      <span style={{ fontSize:'12px', color:'var(--admin-text-muted)' }}>{s.skill}</span>
                      <span style={{ fontSize:'12px', fontWeight:600, color:'var(--admin-text)' }}>{s.pct}%</span>
                    </div>
                    <div style={{ height:'5px', backgroundColor:'var(--admin-border)', borderRadius:'3px' }}>
                      <div style={{ height:'5px', width:`${s.pct}%`, backgroundColor:col, borderRadius:'3px' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Difficulty Breakdown + Top Candidates */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>

        {/* Difficulty breakdown */}
        <div style={{ backgroundColor:'white', borderRadius:'14px', padding:'22px 24px', boxShadow:'0 1px 6px rgba(0,0,0,0.06)' }}>
          <p style={{ fontSize:'16px', fontWeight:600, color:'var(--admin-text)', margin:'0 0 4px' }}>Difficulty breakdown</p>
          <p style={{ fontSize:'12px', color:'var(--admin-text-subtle)', margin:'0 0 20px' }}>Avg correctness by difficulty</p>
          <div style={{ display:'flex', justifyContent:'space-around', alignItems:'center' }}>
            {displayDiff ? (
              (['easy','medium','hard'] as const).map(lv => {
                const pct = Math.round(displayDiff[lv].avgAccuracy);
                const count = displayDiff[lv].count;
                const col = lv === 'easy' ? 'var(--admin-accent)' : lv === 'medium' ? 'var(--admin-accent)' : '#EF4444';
                return (
                  <div key={lv} style={{ textAlign:'center' }}>
                    <div style={{ position:'relative', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                      <DonutRing pct={pct} size={88} sw={9} color={col} />
                      <span style={{ position:'absolute', fontSize:'16px', fontWeight:700, color:'var(--admin-text)' }}>{pct}%</span>
                    </div>
                    <p style={{ fontSize:'13px', color:'var(--admin-text-muted)', fontWeight:500, margin:'8px 0 2px', textTransform:'capitalize' }}>{lv}</p>
                    {count > 0 && (
                      <p style={{ fontSize:'11px', color:'var(--admin-text-subtle)', margin:0 }}>{count} question{count !== 1 ? 's' : ''}</p>
                    )}
                  </div>
                );
              })
            ) : (
              <p style={{ color:'var(--admin-text-subtle)', fontSize:'13px' }}>No difficulty data</p>
            )}
          </div>
        </div>

        {/* Top candidates */}
        <div style={{ backgroundColor:'white', borderRadius:'14px', padding:'22px 24px', boxShadow:'0 1px 6px rgba(0,0,0,0.06)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
            <p style={{ fontSize:'16px', fontWeight:600, color:'var(--admin-text)', margin:0 }}>Top candidates</p>
            {isTestMode ? (
              <span style={{ fontSize:'12px', color:'var(--admin-accent)', cursor:'pointer', fontWeight:500 }}
                onClick={() => navigate(`/admin/tests/${selectedTestId}?tab=candidates`)}>
                View leaderboard
              </span>
            ) : (
              <span style={{ fontSize:'12px', color:'var(--admin-accent)', cursor:'pointer', fontWeight:500 }}
                onClick={() => navigate('/admin/tests')}>
                View all tests
              </span>
            )}
          </div>
          {topCandidates.length === 0 ? (
            <p style={{ color:'var(--admin-text-subtle)', fontSize:'13px' }}>No candidate data</p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
              {topCandidates.map((c, i) => (
                <div key={c.id}
                  onClick={() => handleCandidateClick(c.id, c.attemptId)}
                  style={{
                    display:'flex', alignItems:'center', gap:'10px', cursor:'pointer',
                    padding:'8px 10px', borderRadius:'10px', transition:'background-color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(31, 53, 86, 0.09)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <span style={{ fontSize:'13px', color:'var(--admin-text-subtle)', width:'16px', textAlign:'center', flexShrink:0 }}>{i+1}</span>
                  <div style={{
                    width:'34px', height:'34px', borderRadius:'50%', flexShrink:0,
                    backgroundColor: avatarBg(c.name),
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:'11px', fontWeight:700, color:'white',
                  }}>{initials(c.name)}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:'13px', fontWeight:500, color:'var(--admin-text)', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {c.name}
                    </p>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'10px', flexShrink:0 }}>
                    {c.trust > 0 && (
                      <span style={{ fontSize:'11px', color:'var(--admin-text-subtle)' }}>
                        Trust <span style={{ color:'var(--admin-text-muted)', fontWeight:600 }}>{c.trust}</span>
                      </span>
                    )}
                    <span style={{
                      fontSize:'13px', fontWeight:700,
                      color: c.pct >= 70 ? 'var(--admin-accent)' : c.pct >= 40 ? 'var(--admin-accent)' : '#EF4444',
                    }}>{c.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

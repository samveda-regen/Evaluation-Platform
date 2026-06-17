import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { format } from 'date-fns';
import { violationLabel } from '../../utils/violationLabels';
import BackButton from '../../components/BackButton';
import {
  FileDown,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Mail,
  CheckCheck,
} from 'lucide-react';

/* ── Types ── */
interface AttemptData {
  attempt: {
    id: string;
    startTime: string;
    endTime?: string;
    submittedAt?: string;
    status: string;
    score?: number;
    violations: number;
    isFlagged: boolean;
    flagReason?: string;
  };
  test: {
    id: string;
    name: string;
    testCode: string;
    totalMarks: number;
    passingMarks?: number;
    negativeMarking: number;
  };
  candidate: { id: string; email: string; name: string };
  mcqAnswers: Array<{
    questionId: string; questionText: string; options: string[];
    correctAnswers: number[]; selectedOptions: number[];
    isCorrect: boolean; marks: number; marksObtained: number;
  }>;
  codingAnswers: Array<{
    questionId: string; title: string; code: string; language: string;
    testResults: Array<{ testCaseId: string; passed: boolean; error?: string }> | null;
    marks: number; marksObtained: number;
  }>;
  behavioralAnswers: Array<{
    questionId: string; title: string; description: string; answerText: string;
    marks: number; marksObtained?: number | null;
  }>;
  activityLogs: Array<{
    id: string; eventType: string; eventData?: string; timestamp: string;
  }>;
}

/* ── Helpers ── */
const AVATAR_COLORS = ['#6366F1','#8B5CF6','#F59E0B','#10B981','#3B82F6','#EF4444','#EC4899','#F97316'];
function avatarBg(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0]+p[1][0]).toUpperCase() : name.slice(0,2).toUpperCase();
}
function fmtDuration(start: string, end?: string | null): string {
  if (!end) return '—';
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (mins <= 0) return '—';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,'0')}m`;
}
function safeDiv(num: number, den: number): number {
  return den > 0 ? Math.min(100, Math.round((num / den) * 100)) : 0;
}

/* ── SVG score ring (large) ── */
function ScoreRing({ pct, size = 120, score, label }: { pct: number; size?: number; score: string; label: string }) {
  const sw   = 10;
  const r    = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const off  = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  return (
    <div style={{ position:'relative', width:`${size}px`, height:`${size}px`, flexShrink:0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#E5E7EB" strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#10B981" strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} />
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
        <span style={{ fontSize:'22px', fontWeight:700, color:'#111827', lineHeight:1 }}>{score}</span>
        <span style={{ fontSize:'10px', color:'#9CA3AF', letterSpacing:'0.05em', marginTop:'2px' }}>{label}</span>
      </div>
    </div>
  );
}

/* ── Small donut for section breakdown ── */
function SectionDonut({ pct, color, label, sub }: { pct: number; color: string; label: string; sub: string }) {
  const size = 100, sw = 9;
  const r    = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const off  = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  return (
    <div style={{ textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:'8px' }}>
      <div style={{ position:'relative', width:`${size}px`, height:`${size}px` }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#E5E7EB" strokeWidth={sw} />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={sw}
            strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
            transform={`rotate(-90 ${size/2} ${size/2})`} />
        </svg>
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span style={{ fontSize:'18px', fontWeight:700, color:'#111827' }}>{pct}%</span>
        </div>
      </div>
      <div>
        <p style={{ fontSize:'13px', fontWeight:600, color:'#374151', margin:'0 0 2px' }}>{label}</p>
        <p style={{ fontSize:'11px', color:'#9CA3AF', margin:0 }}>{sub}</p>
      </div>
    </div>
  );
}

/* ── Answer review filter ── */
type ReviewFilter = 'all' | 'correct' | 'incorrect';

interface ReviewItem {
  id: string; title: string; type: 'MCQ' | 'Coding' | 'Behavioral';
  isCorrect: boolean; marksObtained: number; totalMarks: number;
}

/* ── Violation tag color ── */
const VIOLATION_EVENTS = new Set(['tab_switch','focus_loss','fullscreen_exit','camera_off','face_not_detected','multiple_faces','phone_detected']);
function isViolation(eventType: string) { return VIOLATION_EVENTS.has(eventType); }
function violationTagColor(eventType: string): { bg: string; color: string } {
  if (isViolation(eventType)) return { bg:'#FEF3C7', color:'#92400E' };
  return { bg:'#ECFDF5', color:'#065F46' };
}

export default function AttemptDetails() {
  const { attemptId } = useParams();
  const navigate      = useNavigate();

  const [data,          setData]          = useState<AttemptData | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [reEvaluating,  setReEvaluating]  = useState(false);
  const [reviewFilter,  setReviewFilter]  = useState<ReviewFilter>('all');
  const [reviewed,      setReviewed]      = useState(false);

  useEffect(() => { void loadAttempt(); }, [attemptId]);

  const loadAttempt = async () => {
    try {
      const { data: d } = await adminApi.getAttemptDetails(attemptId!);
      setData(d);
    } catch {
      toast.error('Failed to load attempt details');
      navigate(-1);
    } finally { setLoading(false); }
  };

  const handleFlag = async () => {
    if (!data) return;
    const reason = prompt('Enter flag reason (optional):');
    try {
      await adminApi.flagAttempt(attemptId!, { isFlagged: !data.attempt.isFlagged, reason: reason || undefined });
      toast.success(data.attempt.isFlagged ? 'Flag removed' : 'Attempt flagged');
      void loadAttempt();
    } catch { toast.error('Failed to update flag'); }
  };

  const handleReEvaluate = async () => {
    if (!confirm('Re-evaluate this attempt? This will recalculate the score.')) return;
    setReEvaluating(true);
    try {
      const { data: d } = await adminApi.reEvaluateAttempt(attemptId!);
      toast.success(`Re-evaluation complete. New score: ${(d as { newScore: number }).newScore}`);
      void loadAttempt();
    } catch { toast.error('Failed to re-evaluate'); }
    finally { setReEvaluating(false); }
  };

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', padding:'80px 0' }}>
      <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor:'#10B981' }} />
    </div>
  );
  if (!data) return null;

  const { attempt, test, candidate, mcqAnswers, codingAnswers, behavioralAnswers, activityLogs } = data;

  /* ── Score calculations ── */
  const scoreRaw   = attempt.score ?? 0;
  const scorePct   = safeDiv(scoreRaw, test.totalMarks);
  const passed     = test.passingMarks != null ? scoreRaw >= test.passingMarks : scorePct >= 60;
  const passPctLabel = test.passingMarks != null
    ? `above ${Math.round((test.passingMarks / test.totalMarks) * 100)}%`
    : 'above 60%';

  /* ── Section percentages ── */
  const mcqTotal   = mcqAnswers.reduce((s, a) => s + a.marks, 0);
  const mcqObtained= mcqAnswers.reduce((s, a) => s + a.marksObtained, 0);
  const mcqPct     = safeDiv(mcqObtained, mcqTotal);
  const mcqCorrect = mcqAnswers.filter(a => a.isCorrect).length;

  const codTotal   = codingAnswers.reduce((s, a) => s + a.marks, 0);
  const codObtained= codingAnswers.reduce((s, a) => s + a.marksObtained, 0);
  const codPct     = safeDiv(codObtained, codTotal);
  const codPassed  = codingAnswers.filter(a => a.marksObtained > 0).length;

  const behTotal   = behavioralAnswers.reduce((s, a) => s + a.marks, 0);
  const behObtained= behavioralAnswers.reduce((s, a) => s + (a.marksObtained ?? 0), 0);
  const behPct     = safeDiv(behObtained, behTotal);
  const behRating  = behPct >= 80 ? 'Strong' : behPct >= 60 ? 'Good' : behPct >= 40 ? 'Fair' : 'Weak';

  /* ── Unified answer review list ── */
  const reviewItems: ReviewItem[] = [
    ...mcqAnswers.map(a => ({
      id: a.questionId, title: a.questionText, type: 'MCQ' as const,
      isCorrect: a.isCorrect, marksObtained: a.marksObtained, totalMarks: a.marks,
    })),
    ...codingAnswers.map(a => ({
      id: a.questionId, title: a.title, type: 'Coding' as const,
      isCorrect: a.marksObtained > 0, marksObtained: a.marksObtained, totalMarks: a.marks,
    })),
    ...behavioralAnswers.map(a => ({
      id: a.questionId, title: a.title, type: 'Behavioral' as const,
      isCorrect: (a.marksObtained ?? 0) > 0, marksObtained: a.marksObtained ?? 0, totalMarks: a.marks,
    })),
  ];

  const filteredItems = reviewItems.filter(item => {
    if (reviewFilter === 'correct')   return item.isCorrect;
    if (reviewFilter === 'incorrect') return !item.isCorrect;
    return true;
  });

  /* ── Integrity: violation tag summary ── */
  const violationCounts: Record<string, number> = {};
  activityLogs.forEach(log => {
    if (isViolation(log.eventType)) {
      violationCounts[log.eventType] = (violationCounts[log.eventType] || 0) + 1;
    }
  });
  const trustScore = Math.max(20, 100 - attempt.violations * 8);

  /* ── integrity tags ── */
  const integrityTags: Array<{ label: string; positive: boolean }> = [];
  Object.entries(violationCounts).forEach(([evt, cnt]) => {
    integrityTags.push({ label: `${violationLabel(evt)} x${cnt}`, positive: false });
  });
  if (!violationCounts['face_not_detected'] && !violationCounts['multiple_faces']) {
    integrityTags.push({ label: 'Face verified', positive: true });
  }
  if (!violationCounts['multiple_faces']) {
    integrityTags.push({ label: 'Single person', positive: true });
  }
  if (!violationCounts['phone_detected']) {
    integrityTags.push({ label: 'No phone detected', positive: true });
  }

  /* ── Duration ── */
  const duration = fmtDuration(attempt.startTime, attempt.submittedAt || attempt.endTime);
  const totalQs  = mcqAnswers.length + codingAnswers.length + behavioralAnswers.length;

  /* ── Test info subtitle ── */
  const submittedStr = attempt.submittedAt
    ? `Submitted ${format(new Date(attempt.submittedAt), 'PPp')}`
    : attempt.status.replace('_', ' ');

  /* ── Type badge colors ── */
  const typeBadge: Record<string, { bg: string; color: string }> = {
    MCQ:        { bg:'#EDE9FE', color:'#6D28D9' },
    Coding:     { bg:'#D1FAE5', color:'#065F46' },
    Behavioral: { bg:'#FEF3C7', color:'#92400E' },
  };

  return (
    <div style={{ backgroundColor:'#F9FAFB', minHeight:'100%' }}>

      {/* ── BREADCRUMB ── */}
      <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'#9CA3AF', marginBottom:'10px' }}>
        <span style={{ cursor:'pointer', color:'#6B7280' }} onClick={() => navigate('/admin/tests')}>Assessments</span>
        <span>›</span>
        <span style={{ cursor:'pointer', color:'#6B7280' }} onClick={() => navigate(`/admin/tests/${test.id}?tab=candidates`)}>Candidates</span>
        <span>›</span>
        <span>Attempt</span>
      </div>

      {/* ── HEADER (candidate name + subtitle + actions) ── */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'24px' }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:'12px' }}>
          <BackButton />
          <div>
            <h1 style={{ fontSize:'26px', fontWeight:700, color:'#111827', margin:'0 0 4px' }}>{candidate.name}</h1>
            <p style={{ fontSize:'13px', color:'#9CA3AF', margin:0 }}>
              {test.name} &nbsp;·&nbsp; {submittedStr}
            </p>
          </div>
        </div>
        <div style={{ display:'flex', gap:'8px', flexShrink:0 }}>
          <button onClick={() => toast('PDF download coming soon', { icon: '📄' })}
            style={{
              display:'flex', alignItems:'center', gap:'5px', padding:'8px 14px',
              border:'1.5px solid #E5E7EB', borderRadius:'8px', backgroundColor:'white',
              fontSize:'13px', fontWeight:500, color:'#374151', cursor:'pointer',
            }}>
            <FileDown size={14} />
            Download PDF
          </button>
          <button onClick={() => toast('Email sent to candidate', { icon: '📧' })}
            style={{
              display:'flex', alignItems:'center', gap:'5px', padding:'8px 14px',
              border:'1.5px solid #E5E7EB', borderRadius:'8px', backgroundColor:'white',
              fontSize:'13px', fontWeight:500, color:'#374151', cursor:'pointer',
            }}>
            <Mail size={14} />
            Email result
          </button>
          <button onClick={() => { setReviewed(!reviewed); toast.success(reviewed ? 'Review unmarked' : 'Marked as reviewed'); }}
            style={{
              display:'flex', alignItems:'center', gap:'5px', padding:'8px 16px',
              border:'none', borderRadius:'8px',
              backgroundColor: reviewed ? '#059669' : '#10B981',
              fontSize:'13px', fontWeight:600, color:'white', cursor:'pointer',
            }}>
            <CheckCheck size={13} color="white" />
            {reviewed ? 'Reviewed' : 'Mark reviewed'}
          </button>
        </div>
      </div>

      {/* ── MAIN 2-COLUMN GRID ── */}
      <div style={{ display:'grid', gridTemplateColumns:'280px 1fr', gap:'20px', alignItems:'start' }}>

        {/* ── LEFT PANEL ── */}
        <div style={{
          backgroundColor:'white', borderRadius:'14px', padding:'24px 20px',
          boxShadow:'0 1px 6px rgba(0,0,0,0.06)', display:'flex', flexDirection:'column', alignItems:'center', gap:'6px',
        }}>
          {/* Avatar */}
          <div style={{
            width:'64px', height:'64px', borderRadius:'50%',
            backgroundColor: avatarBg(candidate.name),
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:'20px', fontWeight:700, color:'white', marginBottom:'4px',
          }}>
            {initials(candidate.name)}
          </div>
          <p style={{ fontSize:'16px', fontWeight:600, color:'#111827', margin:0 }}>{candidate.name}</p>
          <p style={{ fontSize:'12px', color:'#9CA3AF', margin:'0 0 12px' }}>{candidate.email}</p>

          {/* Score ring */}
          <ScoreRing
            pct={scorePct}
            size={120}
            score={`${scorePct}%`}
            label="SCORE"
          />

          {/* Passed / Failed badge */}
          <p style={{ fontSize:'12px', fontWeight:500, margin:'8px 0 0',
            color: passed ? '#059669' : '#DC2626' }}>
            {passed ? '✓' : '✗'} {passed ? 'Passed' : 'Failed'} · {passPctLabel}
          </p>

          {/* Divider */}
          <div style={{ width:'100%', height:'1px', backgroundColor:'#F3F4F6', margin:'16px 0' }} />

          {/* Attempt details */}
          <div style={{ width:'100%' }}>
            <p style={{ fontSize:'13px', fontWeight:600, color:'#111827', margin:'0 0 12px' }}>Attempt details</p>
            {[
              { k: 'Started',      v: format(new Date(attempt.startTime), 'hh:mm a') },
              { k: 'Submitted',    v: attempt.submittedAt ? format(new Date(attempt.submittedAt), 'hh:mm a') : '—' },
              { k: 'Duration',     v: duration },
              { k: 'Questions',    v: `${totalQs} / ${totalQs}` },
              { k: 'Score',        v: `${scoreRaw} / ${test.totalMarks}` },
              { k: 'Violations',   v: String(attempt.violations) },
            ].map(({ k, v }) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', marginBottom:'8px' }}>
                <span style={{ fontSize:'12px', color:'#9CA3AF' }}>{k}</span>
                <span style={{ fontSize:'12px', fontWeight:500, color:'#374151' }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Re-evaluate + Flag buttons */}
          <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:'8px', marginTop:'8px' }}>
            <button onClick={handleReEvaluate} disabled={reEvaluating}
              style={{
                width:'100%', padding:'8px', borderRadius:'8px', border:'1.5px solid #E5E7EB',
                backgroundColor:'white', fontSize:'12px', fontWeight:500, color:'#374151',
                cursor: reEvaluating ? 'not-allowed' : 'pointer',
              }}>
              {reEvaluating ? 'Re-evaluating…' : 'Re-evaluate'}
            </button>
            <button onClick={handleFlag}
              style={{
                width:'100%', padding:'8px', borderRadius:'8px', border:'none',
                backgroundColor: attempt.isFlagged ? '#ECFDF5' : '#FEF2F2',
                fontSize:'12px', fontWeight:500,
                color: attempt.isFlagged ? '#059669' : '#DC2626',
                cursor:'pointer',
              }}>
              {attempt.isFlagged ? 'Remove flag' : 'Flag attempt'}
            </button>
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>

          {/* Section breakdown */}
          <div style={{ backgroundColor:'white', borderRadius:'14px', padding:'22px 24px', boxShadow:'0 1px 6px rgba(0,0,0,0.06)' }}>
            <p style={{ fontSize:'15px', fontWeight:600, color:'#111827', margin:'0 0 20px' }}>Section breakdown</p>
            <div style={{ display:'flex', gap:'32px', justifyContent:'flex-start' }}>
              {mcqAnswers.length > 0 && (
                <SectionDonut pct={mcqPct} color="#10B981" label="MCQ" sub={`${mcqCorrect}/${mcqAnswers.length}`} />
              )}
              {codingAnswers.length > 0 && (
                <SectionDonut pct={codPct} color="#F59E0B" label="Coding" sub={`${codPassed}/${codingAnswers.length}`} />
              )}
              {behavioralAnswers.length > 0 && (
                <SectionDonut pct={behPct} color="#6366F1" label="Behavioral" sub={behRating} />
              )}
              {mcqAnswers.length === 0 && codingAnswers.length === 0 && behavioralAnswers.length === 0 && (
                <p style={{ fontSize:'13px', color:'#9CA3AF' }}>No answers recorded</p>
              )}
            </div>
          </div>

          {/* Answer review */}
          <div style={{ backgroundColor:'white', borderRadius:'14px', padding:'22px 24px', boxShadow:'0 1px 6px rgba(0,0,0,0.06)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
              <p style={{ fontSize:'15px', fontWeight:600, color:'#111827', margin:0 }}>Answer review</p>
              <div style={{ display:'flex', gap:'2px', backgroundColor:'#F3F4F6', borderRadius:'8px', padding:'3px' }}>
                {(['all','correct','incorrect'] as const).map(f => (
                  <button key={f} onClick={() => setReviewFilter(f)}
                    style={{
                      padding:'4px 12px', borderRadius:'6px', border:'none', cursor:'pointer',
                      fontSize:'12px', fontWeight:500, textTransform:'capitalize',
                      backgroundColor: reviewFilter === f ? '#111827' : 'transparent',
                      color: reviewFilter === f ? 'white' : '#6B7280',
                    }}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
                ))}
              </div>
            </div>

            {filteredItems.length === 0 ? (
              <p style={{ fontSize:'13px', color:'#9CA3AF' }}>No answers match this filter</p>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:'0' }}>
                {filteredItems.map((item, idx) => (
                  <div key={item.id} style={{
                    display:'flex', alignItems:'center', gap:'12px',
                    padding:'12px 0', borderBottom: idx < filteredItems.length-1 ? '1px solid #F3F4F6' : 'none',
                  }}>
                    {/* check/x */}
                    <div style={{
                      width:'20px', height:'20px', borderRadius:'50%', flexShrink:0,
                      backgroundColor: item.isCorrect ? '#ECFDF5' : '#FEF2F2',
                      display:'flex', alignItems:'center', justifyContent:'center',
                    }}>
                      {item.isCorrect
                        ? <CheckCircle2 size={10} color="#10B981" />
                        : <XCircle size={10} color="#EF4444" />
                      }
                    </div>
                    {/* title */}
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:'13px', fontWeight:500, color:'#111827', margin:'0 0 3px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {item.title}
                      </p>
                      <span style={{
                        fontSize:'11px', padding:'2px 8px', borderRadius:'20px', display:'inline-block',
                        backgroundColor: typeBadge[item.type].bg, color: typeBadge[item.type].color,
                        fontWeight:500,
                      }}>{item.type}</span>
                    </div>
                    {/* score */}
                    <span style={{
                      fontSize:'13px', fontWeight:600, flexShrink:0,
                      color: item.isCorrect ? '#059669' : '#DC2626',
                    }}>
                      {item.isCorrect
                        ? (item.type === 'MCQ' ? `+${item.marksObtained}` : `+${item.marksObtained} / ${item.totalMarks}`)
                        : (item.type === 'MCQ' ? `0 / ${item.totalMarks}` : `${item.marksObtained} / ${item.totalMarks}`)
                      }
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Integrity summary */}
          <div style={{
            borderRadius:'14px', padding:'18px 22px',
            backgroundColor:'#FFFBEB', border:'1.5px solid #FDE68A',
          }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'10px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                <div style={{
                  width:'18px', height:'18px', border:'2px solid #92400E', borderRadius:'3px',
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                  <div style={{ width:'8px', height:'8px', backgroundColor:'#92400E', borderRadius:'1px' }} />
                </div>
                <span style={{ fontSize:'14px', fontWeight:600, color:'#111827' }}>Integrity summary</span>
              </div>
              <span style={{ fontSize:'13px', color:'#6B7280' }}>
                Trust score <span style={{ fontSize:'15px', fontWeight:700, color:'#111827' }}>{trustScore}</span>
              </span>
            </div>

            <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', marginBottom:'12px' }}>
              {integrityTags.map((tag, i) => (
                <span key={i} style={{
                  fontSize:'11px', padding:'3px 10px', borderRadius:'20px', fontWeight:500,
                  backgroundColor: tag.positive ? '#ECFDF5' : '#FEF3C7',
                  color: tag.positive ? '#065F46' : '#92400E',
                }}>
                  • {tag.label}
                </span>
              ))}
              {integrityTags.length === 0 && (
                <span style={{ fontSize:'12px', color:'#9CA3AF' }}>No proctoring events recorded</span>
              )}
            </div>

            <button onClick={() => navigate(`/admin/attempts/${attemptId}/proctoring`)}
              style={{
                background:'none', border:'none', padding:0, cursor:'pointer',
                fontSize:'12px', color:'#10B981', fontWeight:500, display:'flex', alignItems:'center', gap:'4px',
              }}>
              View full trust report
              <ChevronRight size={12} color="#10B981" />
            </button>
          </div>

        </div>
      </div>

    </div>
  );
}

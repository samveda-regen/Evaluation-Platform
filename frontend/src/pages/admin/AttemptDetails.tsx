import { useState, useEffect, useRef } from 'react';
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
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

/* -- Types -- */
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
    trustScore?: number;
    reviewed?: boolean;
    reviewedAt?: string | null;
    reviewNotes?: string | null;
    resultReleased?: boolean;
    releasedAt?: string | null;
    resultEmailSentAt?: string | null;
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
  communicationAnswers: Array<{
    questionId: string; subType: string; title: string; description?: string | null; answerText: string | null;
    selectedOptions: number[] | null; options: string[] | null; correctAnswers: number[] | null; isCorrect: boolean | null;
    transcript: string | null; audioAssetId: string | null;
    gradingDetail: {
      wordsPerMinute?: number; pauseCount?: number; longestPauseSec?: number;
      contentScore?: number; fluencyScore?: number; reasoning?: string;
      pronunciationAvailable?: boolean; phoneErrorRate?: number | null; cefrLevel?: string | null;
    } | null;
    marks: number; marksObtained?: number | null;
  }>;
  activityLogs: Array<{
    id: string; eventType: string; eventData?: string; timestamp: string;
  }>;
  violationCounts?: Record<string, number>;
}

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
function fmtDuration(start: string, end?: string | null): string {
  if (!end) return '-';
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (mins <= 0) return '-';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,'0')}m`;
}
function safeDiv(num: number, den: number): number {
  return den > 0 ? Math.min(100, Math.round((num / den) * 100)) : 0;
}

/* -- SVG score ring (large) -- */
function ScoreRing({ pct, size = 120, score, label }: { pct: number; size?: number; score: string; label: string }) {
  const sw   = 10;
  const r    = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const off  = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  return (
    <div style={{ position:'relative', width:`${size}px`, height:`${size}px`, flexShrink:0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--admin-border)" strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--admin-accent)" strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} />
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
        <span style={{ fontSize:'22px', fontWeight:700, color:'var(--admin-text)', lineHeight:1 }}>{score}</span>
        <span style={{ fontSize:'10px', color:'var(--admin-text-subtle)', letterSpacing:'0.05em', marginTop:'2px' }}>{label}</span>
      </div>
    </div>
  );
}

/* -- Small donut for question-type breakdown -- */
function QuestionDonut({ pct, color, label, sub }: { pct: number; color: string; label: string; sub: string }) {
  const size = 100, sw = 9;
  const r    = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const off  = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  return (
    <div style={{ textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:'8px' }}>
      <div style={{ position:'relative', width:`${size}px`, height:`${size}px` }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--admin-border)" strokeWidth={sw} />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={sw}
            strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
            transform={`rotate(-90 ${size/2} ${size/2})`} />
        </svg>
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span style={{ fontSize:'18px', fontWeight:700, color:'var(--admin-text)' }}>{pct}%</span>
        </div>
      </div>
      <div>
        <p style={{ fontSize:'13px', fontWeight:600, color:'var(--admin-text-muted)', margin:'0 0 2px' }}>{label}</p>
        <p style={{ fontSize:'11px', color:'var(--admin-text-subtle)', margin:0 }}>{sub}</p>
      </div>
    </div>
  );
}

/* -- Answer review filter -- */
type ReviewFilter = 'all' | 'correct' | 'incorrect';


export default function AttemptDetails() {
  const { attemptId } = useParams();
  const navigate      = useNavigate();

  const [data,          setData]          = useState<AttemptData | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [reEvaluating,  setReEvaluating]  = useState(false);
  const [reviewSaving,  setReviewSaving]  = useState(false);
  const [reviewFilter,  setReviewFilter]  = useState<ReviewFilter>('all');
  const [reviewed,      setReviewed]      = useState(false);
  const [releasing,     setReleasing]     = useState(false);
  const [emailingResult,setEmailingResult]= useState(false);
  const [behavioralDrafts, setBehavioralDrafts] = useState<Record<string, string>>({});
  const [communicationDrafts, setCommunicationDrafts] = useState<Record<string, string>>({});
  const [gradingQuestionId, setGradingQuestionId] = useState<string | null>(null);
  const [aiScoringQuestionIds, setAiScoringQuestionIds] = useState<Set<string>>(new Set());
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, { marksObtained: number; reasoning: string }>>({});
  const autoGradedRef = useRef<Set<string>>(new Set());
  const autoGradedCommRef = useRef<Set<string>>(new Set());

  useEffect(() => { void loadAttempt(); }, [attemptId]);

  // AI scoring is the default: as soon as an attempt's behavioral answers load, any answer that
  // hasn't been graded yet (marksObtained is null) and actually has candidate text gets auto-scored
  // and saved automatically — no button click needed. Manual "Save marks" remains available to
  // correct/override any answer afterwards.
  useEffect(() => {
    if (!data) return;
    data.behavioralAnswers.forEach(a => {
      const needsScore = (a.marksObtained === null || a.marksObtained === undefined) && a.answerText?.trim();
      if (needsScore && !autoGradedRef.current.has(a.questionId)) {
        autoGradedRef.current.add(a.questionId);
        void handleAutoGradeBehavioral(a.questionId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.attempt.id, data?.behavioralAnswers]);

  // Same auto-scoring behavior as behavioral, for Written (typed text) and Speaking (transcript) —
  // Listening/Reading are auto-scored server-side at submission time instead.
  useEffect(() => {
    if (!data) return;
    data.communicationAnswers.forEach(a => {
      const hasGradableContent = a.subType === 'WRITTEN' ? Boolean(a.answerText?.trim()) : a.subType === 'SPEAKING' ? Boolean(a.transcript?.trim()) : false;
      const needsScore = (a.subType === 'WRITTEN' || a.subType === 'SPEAKING') && (a.marksObtained === null || a.marksObtained === undefined) && hasGradableContent;
      if (needsScore && !autoGradedCommRef.current.has(a.questionId)) {
        autoGradedCommRef.current.add(a.questionId);
        void handleAutoGradeCommunication(a.questionId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.attempt.id, data?.communicationAnswers]);

  const loadAttempt = async () => {
    try {
      const { data: d } = await adminApi.getAttemptDetails(attemptId!);
      setData(d);
      setReviewed(Boolean(d.attempt?.reviewed));
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

  const handleReleaseResults = async () => {
    if (!data || data.attempt.resultReleased) return;
    setReleasing(true);
    try {
      const { data: releaseData } = await adminApi.releaseAttemptResult(attemptId!);
      setData(prev => prev ? {
        ...prev,
        attempt: {
          ...prev.attempt,
          resultReleased: releaseData.attempt?.resultReleased ?? true,
          releasedAt: releaseData.attempt?.releasedAt ?? null,
        },
      } : prev);
      toast.success('Results released to candidate');
    } catch {
      toast.error('Failed to release results');
    } finally {
      setReleasing(false);
    }
  };

  const handleEmailResult = async () => {
    if (!data) return;
    setEmailingResult(true);
    try {
      const { data: emailData } = await adminApi.sendAttemptResultEmail(attemptId!);
      setData(prev => prev ? {
        ...prev,
        attempt: { ...prev.attempt, resultEmailSentAt: emailData.attempt?.resultEmailSentAt ?? new Date().toISOString() },
      } : prev);
      toast.success('Result email sent to candidate');
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(message || 'Failed to send result email');
    } finally {
      setEmailingResult(false);
    }
  };

  const handleGradeBehavioral = async (questionId: string, maxMarks: number) => {
    if (!data) return;
    const raw = behavioralDrafts[questionId];
    const parsed = Number(raw);
    if (raw === undefined || raw.trim() === '' || Number.isNaN(parsed)) {
      toast.error('Enter a valid number');
      return;
    }
    const clamped = Math.min(maxMarks, Math.max(0, parsed));
    setGradingQuestionId(questionId);
    try {
      const { data: gradeData } = await adminApi.gradeBehavioralAnswer(attemptId!, questionId, clamped);
      setData(prev => prev ? {
        ...prev,
        attempt: { ...prev.attempt, score: gradeData.score },
        behavioralAnswers: prev.behavioralAnswers.map(a =>
          a.questionId === questionId ? { ...a, marksObtained: gradeData.marksObtained } : a
        ),
      } : prev);
      setBehavioralDrafts(prev => { const next = { ...prev }; delete next[questionId]; return next; });
      setAiSuggestions(prev => { const next = { ...prev }; delete next[questionId]; return next; });
      toast.success('Marks saved');
    } catch {
      toast.error('Failed to save marks');
    } finally {
      setGradingQuestionId(null);
    }
  };

  // Auto-grades and saves a behavioral answer's score via AI. Runs by default (see effect above)
  // so admins see marks immediately without clicking anything; can also be re-run manually (e.g.
  // after a failure) via the "Re-score with AI" link. The saved score can always be overridden
  // through the manual "Grade this answer" input + Save marks, which stays the source of truth.
  const handleAutoGradeBehavioral = async (questionId: string) => {
    setAiScoringQuestionIds(prev => new Set(prev).add(questionId));
    try {
      const { data: aiData } = await adminApi.autoGradeBehavioralAnswer(attemptId!, questionId);
      setData(prev => prev ? {
        ...prev,
        attempt: { ...prev.attempt, score: aiData.score },
        behavioralAnswers: prev.behavioralAnswers.map(a =>
          a.questionId === questionId ? { ...a, marksObtained: aiData.marksObtained } : a
        ),
      } : prev);
      setAiSuggestions(prev => ({ ...prev, [questionId]: { marksObtained: aiData.marksObtained, reasoning: aiData.reasoning } }));
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(message || 'AI scoring failed for a behavioral answer. Please grade it manually.');
    } finally {
      setAiScoringQuestionIds(prev => { const next = new Set(prev); next.delete(questionId); return next; });
    }
  };

  const handleGradeCommunication = async (questionId: string, maxMarks: number) => {
    if (!data) return;
    const raw = communicationDrafts[questionId];
    const parsed = Number(raw);
    if (raw === undefined || raw.trim() === '' || Number.isNaN(parsed)) {
      toast.error('Enter a valid number');
      return;
    }
    const clamped = Math.min(maxMarks, Math.max(0, parsed));
    setGradingQuestionId(questionId);
    try {
      const { data: gradeData } = await adminApi.gradeCommunicationAnswer(attemptId!, questionId, clamped);
      setData(prev => prev ? {
        ...prev,
        attempt: { ...prev.attempt, score: gradeData.score },
        communicationAnswers: prev.communicationAnswers.map(a =>
          a.questionId === questionId ? { ...a, marksObtained: gradeData.marksObtained } : a
        ),
      } : prev);
      setCommunicationDrafts(prev => { const next = { ...prev }; delete next[questionId]; return next; });
      setAiSuggestions(prev => { const next = { ...prev }; delete next[questionId]; return next; });
      toast.success('Marks saved');
    } catch {
      toast.error('Failed to save marks');
    } finally {
      setGradingQuestionId(null);
    }
  };

  const handleAutoGradeCommunication = async (questionId: string) => {
    setAiScoringQuestionIds(prev => new Set(prev).add(questionId));
    try {
      const { data: aiData } = await adminApi.autoGradeCommunicationAnswer(attemptId!, questionId);
      setData(prev => prev ? {
        ...prev,
        attempt: { ...prev.attempt, score: aiData.score },
        communicationAnswers: prev.communicationAnswers.map(a =>
          a.questionId === questionId ? { ...a, marksObtained: aiData.marksObtained } : a
        ),
      } : prev);
      setAiSuggestions(prev => ({ ...prev, [questionId]: { marksObtained: aiData.marksObtained, reasoning: aiData.reasoning } }));
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(message || 'AI scoring failed for a written answer. Please grade it manually.');
    } finally {
      setAiScoringQuestionIds(prev => { const next = new Set(prev); next.delete(questionId); return next; });
    }
  };

  const handleReviewToggle = async () => {
    const nextReviewed = !reviewed;
    setReviewSaving(true);
    try {
      const { data: reviewData } = await adminApi.reviewAttempt(attemptId!, { reviewed: nextReviewed });
      const persistedReviewed = Boolean(reviewData.attempt?.reviewed);
      setReviewed(persistedReviewed);
      setData(prev => prev ? {
        ...prev,
        attempt: {
          ...prev.attempt,
          reviewed: persistedReviewed,
          reviewedAt: reviewData.attempt?.reviewedAt ?? null,
          reviewNotes: reviewData.attempt?.reviewNotes ?? null,
        },
      } : prev);
      toast.success(persistedReviewed ? 'Marked as reviewed' : 'Review unmarked');
    } catch {
      toast.error('Failed to update review status');
    } finally {
      setReviewSaving(false);
    }
  };

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', padding:'80px 0' }}>
      <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor:'var(--admin-accent)' }} />
    </div>
  );
  if (!data) return null;

  const { attempt, test, candidate, mcqAnswers, codingAnswers, behavioralAnswers, communicationAnswers, activityLogs } = data;

  /* -- Score calculations -- */
  const scoreRaw   = attempt.score ?? 0;
  const scorePct   = safeDiv(scoreRaw, test.totalMarks);
  const passed     = test.passingMarks != null ? scoreRaw >= test.passingMarks : scorePct >= 60;
  const passPctLabel = test.passingMarks != null
    ? `above ${Math.round((test.passingMarks / test.totalMarks) * 100)}%`
    : 'above 60%';

  /* -- Question-type percentages -- */
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

  const commTotal   = communicationAnswers.reduce((s, a) => s + a.marks, 0);
  const commObtained= communicationAnswers.reduce((s, a) => s + (a.marksObtained ?? 0), 0);
  const commPct     = safeDiv(commObtained, commTotal);
  const commRating  = commPct >= 80 ? 'Strong' : commPct >= 60 ? 'Good' : commPct >= 40 ? 'Fair' : 'Weak';

  /* -- Per-type filtered answer lists -- */
  const filteredMCQ = mcqAnswers.filter(a => {
    if (reviewFilter === 'correct')   return a.isCorrect;
    if (reviewFilter === 'incorrect') return !a.isCorrect;
    return true;
  });
  const filteredCoding = codingAnswers.filter(a => {
    if (reviewFilter === 'correct')   return a.marksObtained > 0;
    if (reviewFilter === 'incorrect') return a.marksObtained === 0;
    return true;
  });
  const filteredBehavioral = behavioralAnswers.filter(a => {
    if (reviewFilter === 'correct')   return (a.marksObtained ?? 0) > 0;
    if (reviewFilter === 'incorrect') return (a.marksObtained ?? 0) === 0;
    return true;
  });
  const filteredCommunication = communicationAnswers.filter(a => {
    if (reviewFilter === 'correct')   return (a.marksObtained ?? 0) > 0;
    if (reviewFilter === 'incorrect') return (a.marksObtained ?? 0) === 0;
    return true;
  });
  const totalFiltered = filteredMCQ.length + filteredCoding.length + filteredBehavioral.length + filteredCommunication.length;

  /* -- Integrity: violation tag summary --
     Backend-computed from the same merged event source (ActivityLog +
     ProctorEvent, i.e. browser-side AND AI-detected violations alike) as
     the candidates panel and Trust & Integrity report. Deriving this from
     activityLogs alone used to silently miss AI-detected violations
     (face_not_detected, multiple_faces, phone_detected), since those are
     written only to ProctorEvent, never to ActivityLog. */
  const violationCounts: Record<string, number> = data.violationCounts || {};
  const trustScore = typeof attempt.trustScore === 'number' ? Math.round(attempt.trustScore) : 100;

  /* -- integrity tags -- */
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

  /* -- Duration -- */
  const duration = fmtDuration(attempt.startTime, attempt.submittedAt || attempt.endTime);
  const totalQs  = mcqAnswers.length + codingAnswers.length + behavioralAnswers.length + communicationAnswers.length;

  /* -- Test info subtitle -- */
  const submittedStr = attempt.submittedAt
    ? `Submitted ${format(new Date(attempt.submittedAt), 'PPp')}`
    : attempt.status.replace('_', ' ');


  return (
    <div style={{ backgroundColor:'#F9FAFB', minHeight:'100%' }}>

      {/* -- HEADER (candidate name + subtitle + actions) -- */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'16px', marginBottom:'24px' }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:'12px', minWidth:0 }}>
          <BackButton />
          <div style={{ minWidth:0 }}>
            <h1 style={{ fontSize:"32px", fontWeight:700, letterSpacing:"-0.02em", color:"var(--admin-text)", margin:"0 0 4px", lineHeight:1.2 }}>{candidate.name}</h1>
            <div style={{ display:'flex', flexDirection:'column', gap:'2px', fontSize:'13px', color:'var(--admin-text-subtle)', lineHeight:1.4 }}>
              <span style={{ overflowWrap:'anywhere' }}>{test.name}</span>
              <span>{submittedStr}</span>
            </div>
          </div>
        </div>
        <div style={{ display:'flex', gap:'8px', flexShrink:0 }}>
          <button onClick={() => toast('PDF download coming soon')}
            style={{
              display:'flex', alignItems:'center', gap:'5px', padding:'8px 14px',
              border:'1.5px solid var(--admin-border)', borderRadius:'8px', backgroundColor:'white',
              fontSize:'13px', fontWeight:500, color:'var(--admin-text-muted)', cursor:'pointer',
            }}>
            <FileDown size={16} />
            Download PDF
          </button>
          <button onClick={handleEmailResult}
            disabled={emailingResult}
            style={{
              display:'flex', alignItems:'center', gap:'5px', padding:'8px 14px',
              border:'1.5px solid var(--admin-border)', borderRadius:'8px', backgroundColor:'white',
              fontSize:'13px', fontWeight:500, color:'var(--admin-text-muted)',
              cursor: emailingResult ? 'not-allowed' : 'pointer', opacity: emailingResult ? 0.7 : 1,
            }}>
            <Mail size={16} />
            {emailingResult ? 'Sending...' : 'Email result'}
          </button>
          {attempt.resultReleased === false && (
            <button onClick={handleReleaseResults}
              disabled={releasing}
              style={{
                display:'flex', alignItems:'center', gap:'5px', padding:'8px 14px',
                border:'none', borderRadius:'8px', backgroundColor:'var(--admin-accent)',
                fontSize:'13px', fontWeight:600, color:'white',
                cursor: releasing ? 'not-allowed' : 'pointer', opacity: releasing ? 0.7 : 1,
              }}>
              <CheckCircle2 size={16} />
              {releasing ? 'Releasing...' : 'Release results'}
            </button>
          )}
          <button onClick={handleReviewToggle}
            disabled={reviewSaving}
            style={{
              display:'flex', alignItems:'center', gap:'5px', padding:'8px 16px',
              border:'none', borderRadius:'8px',
              backgroundColor: reviewed ? 'var(--admin-accent-hover)' : 'var(--admin-accent)',
              fontSize:'13px', fontWeight:600, color:'white', cursor: reviewSaving ? 'not-allowed' : 'pointer',
              opacity: reviewSaving ? 0.7 : 1,
            }}>
            <CheckCheck size={15} color="white" />
            {reviewSaving ? 'Saving...' : reviewed ? 'Reviewed' : 'Mark reviewed'}
          </button>
        </div>
      </div>

      {/* -- MAIN 2-COLUMN GRID -- */}
      <div style={{ display:'grid', gridTemplateColumns:'280px 1fr', gap:'20px', alignItems:'start' }}>

        {/* -- LEFT PANEL -- */}
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
          <p style={{ fontSize:'16px', fontWeight:600, color:'var(--admin-text)', margin:0 }}>{candidate.name}</p>
          <p style={{ fontSize:'12px', color:'var(--admin-text-subtle)', margin:'0 0 12px' }}>{candidate.email}</p>

          {/* Score ring */}
          <ScoreRing
            pct={scorePct}
            size={120}
            score={`${scorePct}%`}
            label="SCORE"
          />

          {/* Passed / Failed badge */}
          <p style={{ fontSize:'12px', fontWeight:500, margin:'8px 0 0',
            color: passed ? 'var(--admin-accent-hover)' : '#DC2626' }}>
            {passed ? 'Passed' : 'Failed'} | {passPctLabel}
          </p>

          {/* Divider */}
          <div style={{ width:'100%', height:'1px', backgroundColor:'var(--admin-border)', margin:'16px 0' }} />

          {/* Attempt details */}
          <div style={{ width:'100%' }}>
            <p style={{ fontSize:'13px', fontWeight:600, color:'var(--admin-text)', margin:'0 0 12px' }}>Attempt details</p>
            {[
              { k: 'Date',         v: format(new Date(attempt.startTime), 'MMM d, yyyy') },
              { k: 'Started',      v: format(new Date(attempt.startTime), 'hh:mm a') },
              { k: 'Submitted',    v: attempt.submittedAt ? format(new Date(attempt.submittedAt), 'hh:mm a') : '-' },
              { k: 'Duration',     v: duration },
              { k: 'Questions',    v: `${totalQs} / ${totalQs}` },
              { k: 'Score',        v: `${scorePct}%` },
              { k: 'Violations',   v: String(attempt.violations) },
            ].map(({ k, v }) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', marginBottom:'8px' }}>
                <span style={{ fontSize:'12px', color:'var(--admin-text-subtle)' }}>{k}</span>
                <span style={{ fontSize:'12px', fontWeight:500, color:'var(--admin-text-muted)' }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Re-evaluate + Flag buttons */}
          <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:'8px', marginTop:'8px' }}>
            <button onClick={handleReEvaluate} disabled={reEvaluating}
              style={{
                width:'100%', padding:'8px', borderRadius:'8px', border:'1.5px solid var(--admin-border)',
                backgroundColor:'white', fontSize:'12px', fontWeight:500, color:'var(--admin-text-muted)',
                cursor: reEvaluating ? 'not-allowed' : 'pointer',
              }}>
              {reEvaluating ? 'Re-evaluating...' : 'Re-evaluate'}
            </button>
            <button onClick={handleFlag}
              style={{
                width:'100%', padding:'8px', borderRadius:'8px', border:'none',
                backgroundColor: attempt.isFlagged ? 'var(--admin-accent-soft)' : '#FEF2F2',
                fontSize:'12px', fontWeight:500,
                color: attempt.isFlagged ? 'var(--admin-accent-hover)' : '#DC2626',
                cursor:'pointer',
              }}>
              {attempt.isFlagged ? 'Remove flag' : 'Flag attempt'}
            </button>
          </div>
        </div>

        {/* -- RIGHT PANEL -- */}
        <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>

          {/* Question breakdown */}
          <div style={{ backgroundColor:'white', borderRadius:'14px', padding:'22px 24px', boxShadow:'0 1px 6px rgba(0,0,0,0.06)' }}>
            <p style={{ fontSize:'15px', fontWeight:600, color:'var(--admin-text)', margin:'0 0 20px' }}>Question breakdown</p>
            <div style={{ display:'flex', gap:'32px', justifyContent:'flex-start' }}>
              {mcqAnswers.length > 0 && (
                <QuestionDonut pct={mcqPct} color="var(--admin-accent)" label="MCQ" sub={`${mcqCorrect}/${mcqAnswers.length}`} />
              )}
              {codingAnswers.length > 0 && (
                <QuestionDonut pct={codPct} color="var(--admin-accent)" label="Coding" sub={`${codPassed}/${codingAnswers.length}`} />
              )}
              {behavioralAnswers.length > 0 && (
                <QuestionDonut pct={behPct} color="var(--admin-data-blue)" label="Behavioral" sub={behRating} />
              )}
              {communicationAnswers.length > 0 && (
                <QuestionDonut pct={commPct} color="var(--admin-data-blue)" label="Communication" sub={commRating} />
              )}
              {mcqAnswers.length === 0 && codingAnswers.length === 0 && behavioralAnswers.length === 0 && communicationAnswers.length === 0 && (
                <p style={{ fontSize:'13px', color:'var(--admin-text-subtle)' }}>No answers recorded</p>
              )}
            </div>
          </div>

          {/* Answer review */}
          <div style={{ backgroundColor:'white', borderRadius:'14px', padding:'22px 24px', boxShadow:'0 1px 6px rgba(0,0,0,0.06)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px' }}>
              <p style={{ fontSize:'15px', fontWeight:600, color:'var(--admin-text)', margin:0 }}>Answer review</p>
              <div style={{ display:'flex', gap:'2px', backgroundColor:'var(--admin-border)', borderRadius:'8px', padding:'3px' }}>
                {(['all','correct','incorrect'] as const).map(f => (
                  <button key={f} onClick={() => setReviewFilter(f)}
                    style={{
                      padding:'4px 12px', borderRadius:'6px', border:'none', cursor:'pointer',
                      fontSize:'12px', fontWeight:500, textTransform:'capitalize',
                      backgroundColor: reviewFilter === f ? 'var(--admin-accent)' : 'transparent',
                      color: reviewFilter === f ? 'white' : 'var(--admin-text-muted)',
                    }}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
                ))}
              </div>
            </div>

            {totalFiltered === 0 ? (
              <p style={{ fontSize:'13px', color:'var(--admin-text-subtle)', textAlign:'center', padding:'20px 0' }}>No answers match this filter</p>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>

                {/* -- MCQ cards -- */}
                {filteredMCQ.map((ans, i) => (
                  <div key={ans.questionId} style={{ borderRadius:'12px', border:`1.5px solid ${ans.isCorrect ? 'var(--admin-accent-disabled)' : '#FECACA'}`, overflow:'hidden' }}>
                    {/* MCQ header */}
                    <div style={{ padding:'13px 16px', backgroundColor: ans.isCorrect ? 'var(--admin-accent-soft)' : '#FFF1F2', display:'flex', alignItems:'flex-start', gap:'10px' }}>
                      <span style={{ fontSize:'11px', fontWeight:700, padding:'3px 8px', borderRadius:'20px', backgroundColor:'#EDE9FE', color:'#6D28D9', flexShrink:0, whiteSpace:'nowrap' }}>
                        MCQ {i + 1}
                      </span>
                      <p style={{ fontSize:'13px', fontWeight:600, color:'var(--admin-text)', margin:0, flex:1, lineHeight:'1.5' }}>{ans.questionText}</p>
                      <div style={{ flexShrink:0, textAlign:'right' }}>
                        <span style={{ fontSize:'13px', fontWeight:700, color: ans.isCorrect ? 'var(--admin-accent-hover)' : '#DC2626' }}>
                          {ans.marksObtained} / {ans.marks}
                        </span>
                        <p style={{ fontSize:'10px', color:'var(--admin-text-subtle)', margin:'1px 0 0' }}>marks</p>
                      </div>
                    </div>
                    {/* Options */}
                    <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:'7px' }}>
                      {ans.options.map((opt, oi) => {
                        const isSelected = ans.selectedOptions.includes(oi);
                        const isCorrect  = ans.correctAnswers.includes(oi);
                        let bg = '#F9FAFB', border = '1px solid var(--admin-border)', textColor = 'var(--admin-text-muted)';
                        if (isCorrect && isSelected)  { bg = 'var(--admin-accent-disabled)'; border = '1.5px solid var(--admin-accent)'; textColor = '#92400E'; }
                        else if (isCorrect)            { bg = 'var(--admin-accent-soft)'; border = '1.5px dashed #FCD34D'; textColor = 'var(--admin-accent-hover)'; }
                        else if (isSelected)           { bg = '#FEF2F2'; border = '1.5px solid #FCA5A5'; textColor = '#DC2626'; }
                        return (
                          <div key={oi} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'9px 12px', borderRadius:'8px', backgroundColor:bg, border }}>
                            <span style={{
                              width:'22px', height:'22px', borderRadius:'50%', flexShrink:0,
                              display:'flex', alignItems:'center', justifyContent:'center',
                              fontSize:'11px', fontWeight:700,
                              backgroundColor: isCorrect ? 'var(--admin-accent)' : isSelected ? '#FCA5A5' : 'var(--admin-border)',
                              color: isCorrect ? 'white' : isSelected ? 'white' : 'var(--admin-text-muted)',
                            }}>
                              {String.fromCharCode(65 + oi)}
                            </span>
                            <span style={{ fontSize:'13px', color:textColor, flex:1 }}>{opt}</span>
                            {isCorrect && isSelected  && <CheckCircle2 size={14} color="var(--admin-accent)" />}
                            {isCorrect && !isSelected && <span style={{ fontSize:'10px', color:'var(--admin-accent-hover)', fontWeight:600 }}>Correct</span>}
                            {isSelected && !isCorrect && <XCircle size={14} color="#EF4444" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* -- Coding cards -- */}
                {filteredCoding.map((ans, i) => {
                  const passedTc = ans.testResults?.filter(t => t.passed).length ?? 0;
                  const totalTc  = ans.testResults?.length ?? 0;
                  const isGood   = ans.marksObtained > 0;
                  return (
                    <div key={ans.questionId} style={{ borderRadius:'12px', border:`1.5px solid ${isGood ? 'var(--admin-accent-disabled)' : '#FECACA'}`, overflow:'hidden' }}>
                      {/* Coding header */}
                      <div style={{ padding:'13px 16px', backgroundColor: isGood ? 'var(--admin-accent-soft)' : '#FFF1F2', display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
                        <span style={{ fontSize:'11px', fontWeight:700, padding:'3px 8px', borderRadius:'20px', backgroundColor:'var(--admin-accent-disabled)', color:'#92400E', flexShrink:0 }}>
                          Coding {i + 1}
                        </span>
                        <p style={{ fontSize:'13px', fontWeight:600, color:'var(--admin-text)', margin:0, flex:1 }}>{ans.title}</p>
                        <span style={{ fontSize:'11px', padding:'2px 10px', borderRadius:'20px', backgroundColor:'var(--admin-border)', color:'var(--admin-text-muted)', fontWeight:500 }}>
                          {ans.language}
                        </span>
                        <div style={{ flexShrink:0, textAlign:'right' }}>
                          <span style={{ fontSize:'13px', fontWeight:700, color: isGood ? 'var(--admin-accent-hover)' : '#DC2626' }}>
                            {ans.marksObtained} / {ans.marks}
                          </span>
                          <p style={{ fontSize:'10px', color:'var(--admin-text-subtle)', margin:'1px 0 0' }}>marks</p>
                        </div>
                      </div>

                      {/* Code block */}
                      <div style={{ backgroundColor:'#1A1A2E', padding:'0' }}>
                        <div style={{ padding:'8px 14px', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', alignItems:'center', gap:'6px' }}>
                          <span style={{ width:'10px', height:'10px', borderRadius:'50%', backgroundColor:'#FF5F57', display:'inline-block' }} />
                          <span style={{ width:'10px', height:'10px', borderRadius:'50%', backgroundColor:'#FEBC2E', display:'inline-block' }} />
                          <span style={{ width:'10px', height:'10px', borderRadius:'50%', backgroundColor:'#28C840', display:'inline-block' }} />
                          <span style={{ fontSize:'11px', color:'var(--admin-text-muted)', marginLeft:'6px' }}>{ans.language}</span>
                        </div>
                        <div style={{ padding:'14px 16px', maxHeight:'380px', overflowY:'auto' }}>
                          <pre style={{ margin:0, fontSize:'12.5px', color:'#E2E8F0', fontFamily:'"Fira Code", "Cascadia Code", "Consolas", monospace', whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:'1.7' }}>
                            {ans.code || '(No code submitted)'}
                          </pre>
                        </div>
                      </div>

                      {/* Test cases */}
                      {ans.testResults && ans.testResults.length > 0 && (
                        <div style={{ padding:'14px 16px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'10px' }}>
                            <p style={{ fontSize:'12px', fontWeight:600, color:'var(--admin-text)', margin:0 }}>Test cases</p>
                            <span style={{
                              fontSize:'11px', padding:'2px 10px', borderRadius:'20px', fontWeight:600,
                              backgroundColor: passedTc === totalTc ? 'var(--admin-accent-soft)' : '#FEF2F2',
                              color: passedTc === totalTc ? 'var(--admin-accent-hover)' : '#DC2626',
                            }}>
                              {passedTc} / {totalTc} passed
                            </span>
                          </div>
                          <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                            {ans.testResults.map((tc, ti) => (
                              <div key={ti} style={{
                                display:'flex', alignItems:'flex-start', gap:'8px', padding:'9px 12px',
                                borderRadius:'8px',
                                backgroundColor: tc.passed ? 'var(--admin-accent-soft)' : '#FEF2F2',
                                border: `1px solid ${tc.passed ? 'var(--admin-accent-disabled)' : '#FECACA'}`,
                              }}>
                                {tc.passed
                                  ? <CheckCircle2 size={14} color="var(--admin-accent)" style={{ flexShrink:0, marginTop:'1px' }} />
                                  : <XCircle size={14} color="#EF4444" style={{ flexShrink:0, marginTop:'1px' }} />
                                }
                                <div style={{ flex:1 }}>
                                  <span style={{ fontSize:'12px', fontWeight:600, color: tc.passed ? 'var(--admin-accent-hover)' : '#DC2626' }}>
                                    Test case {ti + 1}: {tc.passed ? 'Passed' : 'Failed'}
                                  </span>
                                  {!tc.passed && tc.error && (
                                    <p style={{ fontSize:'11px', color:'var(--admin-text-muted)', margin:'3px 0 0', fontFamily:'monospace', whiteSpace:'pre-wrap' }}>{tc.error}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* -- Behavioral cards -- */}
                {filteredBehavioral.map((ans, i) => {
                  const score = ans.marksObtained ?? 0;
                  const draft = behavioralDrafts[ans.questionId];
                  const isGrading = gradingQuestionId === ans.questionId;
                  const isAiScoring = aiScoringQuestionIds.has(ans.questionId);
                  const aiSuggestion = aiSuggestions[ans.questionId];
                  const isUngraded = ans.marksObtained === null || ans.marksObtained === undefined;
                  return (
                    <div key={ans.questionId} style={{ borderRadius:'12px', border:'1.5px solid var(--admin-accent-disabled)', overflow:'hidden' }}>
                      {/* Behavioral header */}
                      <div style={{ padding:'13px 16px', backgroundColor:'var(--admin-accent-soft)', display:'flex', alignItems:'flex-start', gap:'10px' }}>
                        <span style={{ fontSize:'11px', fontWeight:700, padding:'3px 8px', borderRadius:'20px', backgroundColor:'var(--admin-accent-disabled)', color:'#92400E', flexShrink:0, whiteSpace:'nowrap' }}>
                          Behavioral {i + 1}
                        </span>
                        <div style={{ flex:1 }}>
                          <p style={{ fontSize:'13px', fontWeight:600, color:'var(--admin-text)', margin:'0 0 2px' }}>{ans.title}</p>
                          {ans.description && <p style={{ fontSize:'12px', color:'var(--admin-text-muted)', margin:0 }}>{ans.description}</p>}
                        </div>
                        <div style={{ flexShrink:0, textAlign:'right' }}>
                          {isAiScoring && isUngraded ? (
                            <span style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'12px', fontWeight:600, color:'var(--admin-accent-hover)' }}>
                              <Sparkles size={13} /> AI scoring…
                            </span>
                          ) : isUngraded ? (
                            <span style={{ fontSize:'12px', fontWeight:600, color:'var(--admin-text-subtle)', fontStyle:'italic' }}>
                              Not graded yet
                            </span>
                          ) : (
                            <>
                              <span style={{ fontSize:'13px', fontWeight:700, color: score > 0 ? 'var(--admin-accent-hover)' : '#DC2626' }}>
                                {score} / {ans.marks}
                              </span>
                              <p style={{ fontSize:'10px', color:'var(--admin-text-subtle)', margin:'1px 0 0' }}>marks</p>
                            </>
                          )}
                        </div>
                      </div>
                      {/* Answer text */}
                      <div style={{ padding:'14px 16px' }}>
                        <p style={{ fontSize:'11px', fontWeight:600, color:'var(--admin-text-subtle)', textTransform:'uppercase', letterSpacing:'0.05em', margin:'0 0 8px' }}>
                          Candidate's answer
                        </p>
                        <p style={{ fontSize:'13px', color:'var(--admin-text-muted)', margin:'0 0 14px', lineHeight:'1.7', whiteSpace:'pre-wrap' }}>
                          {ans.answerText || '(No answer provided)'}
                        </p>
                        {aiSuggestion && (
                          <div style={{ display:'flex', gap:'8px', padding:'10px 12px', marginBottom:'12px', borderRadius:'8px', backgroundColor:'var(--admin-accent-soft)', border:'1px solid var(--admin-accent-disabled)' }}>
                            <Sparkles size={14} color="var(--admin-accent-hover)" style={{ flexShrink:0, marginTop:'2px' }} />
                            <div>
                              <p style={{ fontSize:'11px', fontWeight:700, color:'var(--admin-accent-hover)', margin:'0 0 3px' }}>
                                AI scored {aiSuggestion.marksObtained} / {ans.marks} — override below if needed
                              </p>
                              <p style={{ fontSize:'12px', color:'var(--admin-text-muted)', margin:0, lineHeight:'1.5' }}>{aiSuggestion.reasoning}</p>
                            </div>
                          </div>
                        )}
                        <div style={{ display:'flex', alignItems:'center', gap:'8px', paddingTop:'12px', borderTop:'1px solid var(--admin-border)', flexWrap:'wrap' }}>
                          <p style={{ fontSize:'11px', fontWeight:600, color:'var(--admin-text-subtle)', margin:0 }}>Grade this answer:</p>
                          <input
                            type="number"
                            min={0}
                            max={ans.marks}
                            step="0.1"
                            placeholder={String(score)}
                            value={draft ?? ''}
                            onChange={e => setBehavioralDrafts(prev => ({ ...prev, [ans.questionId]: e.target.value }))}
                            style={{ width:'70px', padding:'6px 8px', borderRadius:'6px', border:'1px solid var(--admin-border)', fontSize:'12px', color:'var(--admin-text)' }}
                          />
                          <span style={{ fontSize:'12px', color:'var(--admin-text-subtle)' }}>/ {ans.marks}</span>
                          <button
                            onClick={() => handleGradeBehavioral(ans.questionId, ans.marks)}
                            disabled={isGrading || draft === undefined}
                            style={{ padding:'6px 12px', borderRadius:'6px', border:'none', backgroundColor:'var(--admin-accent)', color:'#fff', fontSize:'12px', fontWeight:600, cursor: isGrading || draft === undefined ? 'not-allowed' : 'pointer', opacity: isGrading || draft === undefined ? 0.6 : 1 }}
                          >
                            {isGrading ? 'Saving…' : 'Save marks'}
                          </button>
                          <button
                            onClick={() => handleAutoGradeBehavioral(ans.questionId)}
                            disabled={isAiScoring || !ans.answerText}
                            title={!ans.answerText ? 'No candidate answer to score' : 'Re-run AI scoring for this answer'}
                            style={{ display:'flex', alignItems:'center', gap:'4px', padding:'6px 10px', borderRadius:'6px', border:'none', backgroundColor:'transparent', color:'var(--admin-text-subtle)', fontSize:'11px', fontWeight:600, cursor: isAiScoring || !ans.answerText ? 'not-allowed' : 'pointer', opacity: isAiScoring || !ans.answerText ? 0.5 : 1, textDecoration: 'underline' }}
                          >
                            <Sparkles size={12} />
                            {isAiScoring ? 'Scoring…' : aiSuggestion ? 'Re-score with AI' : 'Score with AI'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* -- Communication (Written) cards -- */}
                {filteredCommunication.map((ans, i) => {
                  const score = ans.marksObtained ?? 0;
                  const draft = communicationDrafts[ans.questionId];
                  const isGrading = gradingQuestionId === ans.questionId;
                  const isAiScoring = aiScoringQuestionIds.has(ans.questionId);
                  const aiSuggestion = aiSuggestions[ans.questionId];
                  const isUngraded = ans.marksObtained === null || ans.marksObtained === undefined;
                  return (
                    <div key={ans.questionId} style={{ borderRadius:'12px', border:'1.5px solid var(--admin-accent-disabled)', overflow:'hidden' }}>
                      {/* Communication header */}
                      <div style={{ padding:'13px 16px', backgroundColor:'var(--admin-accent-soft)', display:'flex', alignItems:'flex-start', gap:'10px' }}>
                        <span style={{ fontSize:'11px', fontWeight:700, padding:'3px 8px', borderRadius:'20px', backgroundColor:'var(--admin-accent-disabled)', color:'#92400E', flexShrink:0, whiteSpace:'nowrap' }}>
                          {ans.subType.charAt(0) + ans.subType.slice(1).toLowerCase()} {i + 1}
                        </span>
                        <div style={{ flex:1 }}>
                          <p style={{ fontSize:'13px', fontWeight:600, color:'var(--admin-text)', margin:'0 0 2px' }}>{ans.title}</p>
                          {ans.description && <p style={{ fontSize:'12px', color:'var(--admin-text-muted)', margin:0 }}>{ans.description}</p>}
                        </div>
                        <div style={{ flexShrink:0, textAlign:'right' }}>
                          {isAiScoring && isUngraded ? (
                            <span style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'12px', fontWeight:600, color:'var(--admin-accent-hover)' }}>
                              <Sparkles size={13} /> AI scoring…
                            </span>
                          ) : isUngraded ? (
                            <span style={{ fontSize:'12px', fontWeight:600, color:'var(--admin-text-subtle)', fontStyle:'italic' }}>
                              Not graded yet
                            </span>
                          ) : (
                            <>
                              <span style={{ fontSize:'13px', fontWeight:700, color: score > 0 ? 'var(--admin-accent-hover)' : '#DC2626' }}>
                                {score} / {ans.marks}
                              </span>
                              <p style={{ fontSize:'10px', color:'var(--admin-text-subtle)', margin:'1px 0 0' }}>marks</p>
                            </>
                          )}
                        </div>
                      </div>
                      {/* Answer */}
                      <div style={{ padding:'14px 16px' }}>
                        <p style={{ fontSize:'11px', fontWeight:600, color:'var(--admin-text-subtle)', textTransform:'uppercase', letterSpacing:'0.05em', margin:'0 0 8px' }}>
                          Candidate's answer
                        </p>
                        {ans.options && ans.options.length > 0 ? (
                          <div style={{ display:'flex', flexDirection:'column', gap:'7px', marginBottom:'14px' }}>
                            {ans.options.map((opt, oi) => {
                              const isSelected = (ans.selectedOptions ?? []).includes(oi);
                              const isRight = (ans.correctAnswers ?? []).includes(oi);
                              let bg = '#F9FAFB', border = '1px solid var(--admin-border)', textColor = 'var(--admin-text-muted)';
                              if (isRight && isSelected)  { bg = 'var(--admin-accent-disabled)'; border = '1.5px solid var(--admin-accent)'; textColor = '#92400E'; }
                              else if (isRight)            { bg = 'var(--admin-accent-soft)'; border = '1.5px dashed #FCD34D'; textColor = 'var(--admin-accent-hover)'; }
                              else if (isSelected)         { bg = '#FEF2F2'; border = '1.5px solid #FCA5A5'; textColor = '#DC2626'; }
                              return (
                                <div key={oi} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'9px 12px', borderRadius:'8px', backgroundColor:bg, border }}>
                                  <span style={{
                                    width:'22px', height:'22px', borderRadius:'50%', flexShrink:0,
                                    display:'flex', alignItems:'center', justifyContent:'center',
                                    fontSize:'11px', fontWeight:700,
                                    backgroundColor: isRight ? 'var(--admin-accent)' : isSelected ? '#FCA5A5' : 'var(--admin-border)',
                                    color: isRight ? 'white' : isSelected ? 'white' : 'var(--admin-text-muted)',
                                  }}>
                                    {String.fromCharCode(65 + oi)}
                                  </span>
                                  <span style={{ fontSize:'13px', color:textColor, flex:1 }}>{opt}</span>
                                  {isRight && isSelected  && <CheckCircle2 size={14} color="var(--admin-accent)" />}
                                  {isRight && !isSelected && <span style={{ fontSize:'10px', color:'var(--admin-accent-hover)', fontWeight:600 }}>Correct</span>}
                                  {isSelected && !isRight && <XCircle size={14} color="#EF4444" />}
                                </div>
                              );
                            })}
                          </div>
                        ) : ans.subType === 'SPEAKING' ? (
                          <div style={{ marginBottom: '14px' }}>
                            {ans.audioAssetId ? (
                              <audio src={`/api/files/${ans.audioAssetId}`} controls className="w-full" style={{ marginBottom: '10px' }} />
                            ) : (
                              <p style={{ fontSize:'12px', color:'var(--admin-text-subtle)', fontStyle:'italic', margin:'0 0 10px' }}>No recording submitted.</p>
                            )}
                            <p style={{ fontSize:'13px', color:'var(--admin-text-muted)', margin:0, lineHeight:'1.7', whiteSpace:'pre-wrap' }}>
                              {ans.transcript || '(No speech detected)'}
                            </p>
                            {ans.gradingDetail && (ans.gradingDetail.wordsPerMinute !== undefined) && (
                              <p style={{ fontSize:'11px', color:'var(--admin-text-subtle)', margin:'8px 0 0' }}>
                                {ans.gradingDetail.wordsPerMinute} wpm · {ans.gradingDetail.pauseCount} long pause{ans.gradingDetail.pauseCount === 1 ? '' : 's'}
                                {ans.gradingDetail.contentScore !== undefined && ` · content ${ans.gradingDetail.contentScore}/10 · fluency ${ans.gradingDetail.fluencyScore}/10`}
                                {typeof ans.gradingDetail.phoneErrorRate === 'number' && ` · pronunciation match ${Math.round((1 - ans.gradingDetail.phoneErrorRate) * 100)}%`}
                              </p>
                            )}
                            {ans.gradingDetail?.cefrLevel && (
                              <span style={{ display:'inline-block', marginTop:'8px', fontSize:'11px', fontWeight:700, padding:'2px 9px', borderRadius:'20px', backgroundColor:'var(--admin-accent-disabled)', color:'#92400E' }}>
                                CEFR {ans.gradingDetail.cefrLevel}
                              </span>
                            )}
                            {ans.gradingDetail && ans.gradingDetail.pronunciationAvailable === false && (
                              <p style={{ fontSize:'10px', color:'var(--admin-text-subtle)', fontStyle:'italic', margin:'6px 0 0' }}>
                                Pronunciation scoring wasn't available for this answer.
                              </p>
                            )}
                          </div>
                        ) : (
                          <p style={{ fontSize:'13px', color:'var(--admin-text-muted)', margin:'0 0 14px', lineHeight:'1.7', whiteSpace:'pre-wrap' }}>
                            {ans.answerText || '(No answer provided)'}
                          </p>
                        )}
                        {aiSuggestion && (
                          <div style={{ display:'flex', gap:'8px', padding:'10px 12px', marginBottom:'12px', borderRadius:'8px', backgroundColor:'var(--admin-accent-soft)', border:'1px solid var(--admin-accent-disabled)' }}>
                            <Sparkles size={14} color="var(--admin-accent-hover)" style={{ flexShrink:0, marginTop:'2px' }} />
                            <div>
                              <p style={{ fontSize:'11px', fontWeight:700, color:'var(--admin-accent-hover)', margin:'0 0 3px' }}>
                                AI scored {aiSuggestion.marksObtained} / {ans.marks} — override below if needed
                              </p>
                              <p style={{ fontSize:'12px', color:'var(--admin-text-muted)', margin:0, lineHeight:'1.5' }}>{aiSuggestion.reasoning}</p>
                            </div>
                          </div>
                        )}
                        {ans.subType === 'WRITTEN' || ans.subType === 'SPEAKING' ? (
                          <div style={{ display:'flex', alignItems:'center', gap:'8px', paddingTop:'12px', borderTop:'1px solid var(--admin-border)', flexWrap:'wrap' }}>
                            <p style={{ fontSize:'11px', fontWeight:600, color:'var(--admin-text-subtle)', margin:0 }}>Grade this answer:</p>
                            <input
                              type="number"
                              min={0}
                              max={ans.marks}
                              step="0.1"
                              placeholder={String(score)}
                              value={draft ?? ''}
                              onChange={e => setCommunicationDrafts(prev => ({ ...prev, [ans.questionId]: e.target.value }))}
                              style={{ width:'70px', padding:'6px 8px', borderRadius:'6px', border:'1px solid var(--admin-border)', fontSize:'12px', color:'var(--admin-text)' }}
                            />
                            <span style={{ fontSize:'12px', color:'var(--admin-text-subtle)' }}>/ {ans.marks}</span>
                            <button
                              onClick={() => handleGradeCommunication(ans.questionId, ans.marks)}
                              disabled={isGrading || draft === undefined}
                              style={{ padding:'6px 12px', borderRadius:'6px', border:'none', backgroundColor:'var(--admin-accent)', color:'#fff', fontSize:'12px', fontWeight:600, cursor: isGrading || draft === undefined ? 'not-allowed' : 'pointer', opacity: isGrading || draft === undefined ? 0.6 : 1 }}
                            >
                              {isGrading ? 'Saving…' : 'Save marks'}
                            </button>
                            {(() => {
                              const gradableText = ans.subType === 'SPEAKING' ? ans.transcript : ans.answerText;
                              return (
                                <button
                                  onClick={() => handleAutoGradeCommunication(ans.questionId)}
                                  disabled={isAiScoring || !gradableText}
                                  title={!gradableText ? 'No candidate answer to score' : 'Re-run AI scoring for this answer'}
                                  style={{ display:'flex', alignItems:'center', gap:'4px', padding:'6px 10px', borderRadius:'6px', border:'none', backgroundColor:'transparent', color:'var(--admin-text-subtle)', fontSize:'11px', fontWeight:600, cursor: isAiScoring || !gradableText ? 'not-allowed' : 'pointer', opacity: isAiScoring || !gradableText ? 0.5 : 1, textDecoration: 'underline' }}
                                >
                                  <Sparkles size={12} />
                                  {isAiScoring ? 'Scoring…' : aiSuggestion ? 'Re-score with AI' : 'Score with AI'}
                                </button>
                              );
                            })()}
                          </div>
                        ) : (
                          <p style={{ fontSize:'11px', color:'var(--admin-text-subtle)', fontStyle:'italic', margin:0 }}>
                            {score} / {ans.marks} — scored automatically
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}

              </div>
            )}
          </div>

          {/* Integrity summary */}
          <div style={{
            borderRadius:'14px', padding:'18px 22px',
            backgroundColor:'var(--admin-accent-soft)', border:'1.5px solid var(--admin-accent-disabled)',
          }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'10px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                <ShieldCheck width={24} height={24} stroke="var(--admin-accent-hover)" strokeWidth={2} />
                <span style={{ fontSize:'14px', fontWeight:600, color:'var(--admin-text)' }}>Integrity summary</span>
              </div>
              <span style={{ fontSize:'13px', color:'var(--admin-text-muted)' }}>
                Trust score <span style={{ fontSize:'15px', fontWeight:700, color:'var(--admin-text)' }}>{trustScore}</span>
              </span>
            </div>

            <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', marginBottom:'12px' }}>
              {integrityTags.map((tag, i) => (
                <span key={i} style={{
                  fontSize:'11px', padding:'3px 10px', borderRadius:'20px', fontWeight:500,
                  backgroundColor: tag.positive ? 'var(--admin-accent-soft)' : 'var(--admin-accent-disabled)',
                  color: tag.positive ? '#065F46' : '#92400E',
                }}>
                  {tag.label}
                </span>
              ))}
              {integrityTags.length === 0 && (
                <span style={{ fontSize:'12px', color:'var(--admin-text-subtle)' }}>No proctoring events recorded</span>
              )}
            </div>

            <button onClick={() => navigate(`/admin/attempts/${attemptId}/proctoring`)}
              style={{
                background:'none', border:'none', padding:0, cursor:'pointer',
                fontSize:'12px', color:'var(--admin-accent)', fontWeight:500, display:'flex', alignItems:'center', gap:'4px',
              }}>
              View full trust report
              <ChevronRight size={12} color="var(--admin-accent)" />
            </button>
          </div>

        </div>
      </div>

    </div>
  );
}


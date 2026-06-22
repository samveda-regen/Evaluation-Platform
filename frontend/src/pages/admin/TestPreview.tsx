import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi, candidateApi } from '../../services/api';
import { useAuthStore } from '../../context/authStore';
import { useTestStore } from '../../context/testStore';
import { Test } from '../../types';
import {
  ArrowLeft,
  Eye,
  AlertTriangle,
  Timer,
  Shield,
  Lock,
  Video,
  Mic,
  Monitor,
  Globe,
  CheckSquare,
  Code2,
  MessageSquare,
  Check,
  Play,
} from 'lucide-react';

type TryTestResponse = {
  token: string;
  candidate: { id: string; email: string; name: string };
  attempt: { id: string };
};

interface TestQuestion {
  id: string;
  questionType: 'mcq' | 'coding' | 'behavioral' | string;
}

export default function TestPreview() {
  const { testId }  = useParams();
  const navigate    = useNavigate();
  const setCandidate = useAuthStore((state) => state.setCandidate);
  const setTestData  = useTestStore((state) => state.setTestData);
  const [test, setTest]           = useState<Test | null>(null);
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [accepted, setAccepted]   = useState(false);
  const [loading, setLoading]     = useState(true);
  const [starting, setStarting]   = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await adminApi.getTest(testId!);
        setTest(data.test);
        setQuestions(data.test.questions || []);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [testId]);

  const handleStartPreview = async () => {
    if (!accepted || starting || !testId) return;
    setStarting(true);
    try {
      // Step 1: create the preview candidate session
      const { data } = await adminApi.tryTest(testId);
      const payload = data as TryTestResponse;
      if (!payload?.candidate || !payload?.token) {
        toast.error('Preview session could not be created');
        return;
      }
      setCandidate(payload.candidate, payload.token);

      // Step 2: fetch test details + start the attempt (token is now set in localStorage)
      const detailsRes = await candidateApi.getTestDetails();
      const td = detailsRes.data;
      const { data: startData } = await candidateApi.startTest();
      const savedAnswersRes = await candidateApi.getSavedAnswers();

      // Step 3: parse violationPopupSettings safely
      let violationPopupSettings: { enabled: boolean; durationSeconds: number } = { enabled: false, durationSeconds: 3 };
      try {
        const raw = startData.test.violationPopupSettings;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed.enabled === 'boolean' && typeof parsed.durationSeconds === 'number') {
          violationPopupSettings = { enabled: parsed.enabled, durationSeconds: parsed.durationSeconds };
        }
      } catch { /* ignore */ }

      // Step 4: populate the test store
      setTestData({
        testId:             startData.test.id,
        testCode:           td.test.testCode || '',
        attemptId:          td.attempt.id,
        testName:           startData.test.name,
        duration:           startData.test.duration,
        totalMarks:         startData.test.totalMarks,
        negativeMarking:    startData.test.negativeMarking || 0,
        maxViolations:      startData.test.maxViolations || 3,
        proctorEnabled:     false,   // no proctoring in preview
        requireCamera:      false,
        requireMicrophone:  false,
        requireScreenShare: false,
        customAIViolations: startData.test.customAIViolations || [],
        violationPopupSettings,
        startTime:          new Date(startData.startTime),
        questions:          startData.questions,
        initialViolations:  0,
      });

      // Restore any already-saved answers
      const saved = savedAnswersRes?.data;
      if ((saved?.mcqAnswers?.length ?? 0) > 0 || (saved?.codingAnswers?.length ?? 0) > 0 || (saved?.behavioralAnswers?.length ?? 0) > 0) {
        useTestStore.getState().loadSavedAnswers(
          saved.mcqAnswers  || [],
          saved.codingAnswers || [],
          saved.behavioralAnswers || [],
        );
      }

      // Step 5: mark preview mode so TestInterface skips TestComplete, then go straight to test
      localStorage.setItem('previewMode', testId);
      toast.success('Preview started');
      navigate('/test/start');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to start preview. Make sure the test has at least one question.';
      toast.error(msg);
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f0f2f7' }}>
        <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: '#F59E0B' }} />
      </div>
    );
  }

  if (!test) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f0f2f7' }}>
        <p style={{ color: '#6A7387' }}>Test not found.</p>
      </div>
    );
  }

  const mcqCount        = questions.filter(q => q.questionType === 'mcq').length;
  const codingCount     = questions.filter(q => q.questionType === 'coding').length;
  const behavioralCount = questions.filter(q => q.questionType === 'behavioral').length;
  const totalQ          = questions.length || test._count?.questions || 0;

  const rules = [
    {
      icon: <Timer width={18} height={18} stroke="white" strokeWidth={1.5} />,
      title: 'Timed assessment',
      desc: `You have ${test.duration} minutes. The test auto-submits when time runs out.`,
    },
    {
      icon: <Shield width={18} height={18} stroke="white" strokeWidth={1.5} />,
      title: 'Proctored session',
      desc: 'Your camera, microphone and screen are monitored by AI throughout.',
    },
    {
      icon: <Lock width={18} height={18} stroke="white" strokeWidth={1.5} />,
      title: 'Full-screen required',
      desc: 'The test runs in full-screen. Leaving it is recorded as a violation.',
    },
    {
      icon: <AlertTriangle width={18} height={18} stroke="white" strokeWidth={1.5} />,
      title: 'No external help',
      desc: 'Switching tabs, copying, or a second person in frame will be flagged.',
    },
  ];

  const systemChecks = [
    { label: 'Webcam',       status: 'Connected',     icon: <Video       width={14} height={14} strokeWidth={1.5} /> },
    { label: 'Microphone',   status: 'Detected',      icon: <Mic         width={14} height={14} strokeWidth={1.5} /> },
    { label: 'Screen share', status: 'Granted',       icon: <Monitor     width={14} height={14} strokeWidth={1.5} /> },
    { label: 'Connection',   status: 'Stable · 48ms', icon: <Globe       width={14} height={14} strokeWidth={1.5} /> },
  ];

  const noQuestions = totalQ === 0;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f0f2f7' }}>

      {/* ── Preview banner ── */}
      <div className="flex items-center justify-between px-6 py-2 text-xs font-semibold text-white" style={{ backgroundColor: '#F59E0B' }}>
        <Link
          to={`/admin/tests/${testId}`}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '28px', height: '28px', borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)', border: '1.5px solid rgba(255,255,255,0.5)',
            textDecoration: 'none', flexShrink: 0,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.35)')}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.2)')}
        >
          <ArrowLeft width={13} height={13} stroke="white" strokeWidth={2.5} />
        </Link>
        <div className="flex items-center gap-2">
          <Eye width={12} height={12} stroke="white" strokeWidth={2} />
          PREVIEW MODE — Click "Start assessment" to experience the test exactly as a candidate would
        </div>
        <div style={{ width: '90px' }} />
      </div>

      {/* ── Nav bar ── */}
      <nav className="flex items-center justify-between px-8 py-4" style={{ backgroundColor: 'white' }}>
        <div className="flex items-center gap-3">
          <p className="font-bold text-sm" style={{ color: '#11162A' }}>TalentstaQ</p>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: '#F59E0B' }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#F59E0B' }} />
          Identity verified
        </div>
      </nav>

      {/* ── No-questions warning ── */}
      {noQuestions && (
        <div className="max-w-5xl mx-auto px-6 pt-4">
          <div className="flex items-start gap-3 rounded-xl px-4 py-3" style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
            <AlertTriangle width={16} height={16} stroke="#D97706" strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: '#92400E' }}>No questions added yet</p>
              <p className="text-xs mt-0.5" style={{ color: '#B45309' }}>
                Add questions to the test before previewing. The start button is disabled until questions are present.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <div className="max-w-5xl mx-auto px-6 py-8 grid lg:grid-cols-[1fr_320px] gap-6 items-start">

        {/* Left — Instructions */}
        <div className="space-y-4">
          {/* Before you begin */}
          <div className="rounded-2xl p-8" style={{ backgroundColor: 'white', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
            <h1 style={{ fontSize: "32px", fontWeight: 700, letterSpacing: "-0.02em", color: "#11162A", margin: "0 0 4px", lineHeight: 1.2 }}>Before you begin</h1>
            <p className="text-sm mb-6" style={{ color: '#F59E0B' }}>
              {test.name} · {test.duration} minutes · {totalQ} question{totalQ !== 1 ? 's' : ''}
            </p>

            <div className="space-y-3">
              {rules.map((rule, i) => (
                <div key={i} className="flex items-start gap-4 rounded-xl px-4 py-4" style={{ border: '1px solid #F3F4F6' }}>
                  <div className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#11162A' }}>
                    {rule.icon}
                  </div>
                  <div>
                    <p className="text-sm font-semibold mb-0.5" style={{ color: '#11162A' }}>{rule.title}</p>
                    <p className="text-sm leading-relaxed" style={{ color: '#6A7387' }}>
                      {rule.desc.split(/(full-screen|auto-submits|AI|flagged|violation)/gi).map((part, j) =>
                        /(full-screen|auto-submits|AI|flagged|violation)/i.test(part)
                          ? <span key={j} style={{ color: '#F59E0B' }}>{part}</span>
                          : part
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sections */}
          {(mcqCount > 0 || codingCount > 0 || behavioralCount > 0) && (
            <div className="rounded-2xl p-6" style={{ backgroundColor: 'white', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
              <h2 className="text-base font-semibold mb-4" style={{ color: '#11162A' }}>Sections</h2>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Multiple choice', count: mcqCount,        color: '#6366F1', icon: <CheckSquare  width={20} height={20} stroke="#6366F1" strokeWidth={1.5} /> },
                  { label: 'Coding',          count: codingCount,     color: '#F59E0B', icon: <Code2        width={20} height={20} stroke="#F59E0B" strokeWidth={1.5} /> },
                  { label: 'Behavioral',      count: behavioralCount, color: '#F59E0B', icon: <MessageSquare width={20} height={20} stroke="#F59E0B" strokeWidth={1.5} /> },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-4 flex flex-col items-center gap-2 text-center" style={{ border: '1px solid #F3F4F6' }}>
                    <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#F9FAFB' }}>
                      {s.icon}
                    </div>
                    <p className="text-sm font-semibold" style={{ color: '#434B5E' }}>{s.label}</p>
                    <p className="text-2xl font-bold" style={{ color: '#11162A' }}>{s.count}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right — System check + Start */}
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'white', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
          {/* Camera preview */}
          <div className="relative flex items-center justify-center" style={{ backgroundColor: '#0d1117', height: '180px' }}>
            <span className="absolute top-3 left-3 text-xs font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: '#F59E0B', color: 'white' }}>
              CAMERA OK
            </span>
            <div className="h-16 w-16 rounded-full flex items-center justify-center text-xl font-bold text-white" style={{ backgroundColor: '#434B5E' }}>
              AS
            </div>
          </div>

          {/* System check */}
          <div className="p-5">
            <p className="text-sm font-semibold mb-4" style={{ color: '#11162A' }}>System check</p>
            <div className="space-y-3">
              {systemChecks.map(check => (
                <div key={check.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2" style={{ color: '#6A7387' }}>
                    {check.icon}
                    <span className="text-sm">{check.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium" style={{ color: '#F59E0B' }}>{check.status}</span>
                    <div className="h-4 w-4 rounded-full flex items-center justify-center" style={{ backgroundColor: '#F59E0B' }}>
                      <Check width={8} height={8} stroke="white" strokeWidth={3} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Accept + Start */}
          <div className="px-5 pb-5 space-y-4">
            <div className="h-px" style={{ backgroundColor: '#F3F4F6' }} />
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={accepted}
                onChange={e => setAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded"
                style={{ accentColor: '#F59E0B' }}
              />
              <span className="text-sm leading-relaxed" style={{ color: '#434B5E' }}>
                I have read the instructions and I'm ready to start in{' '}
                <span style={{ color: '#F59E0B' }}>full-screen mode</span>.
              </span>
            </label>

            <button
              onClick={handleStartPreview}
              disabled={!accepted || starting || noQuestions}
              className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all"
              style={{
                backgroundColor: (!accepted || noQuestions) ? '#FEF3C7' : '#F59E0B',
                cursor: (!accepted || noQuestions) ? 'not-allowed' : 'pointer',
                opacity: starting ? 0.8 : 1,
              }}
            >
              {starting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Starting preview…
                </>
              ) : (
                <>
                  <Play width={14} height={14} fill="white" stroke="white" strokeWidth={1} />
                  Start assessment
                </>
              )}
            </button>

            <p className="text-center text-xs" style={{ color: '#98A2B5' }}>
              {noQuestions
                ? 'Add questions to the test first'
                : 'Runs the full candidate experience — timer starts immediately'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

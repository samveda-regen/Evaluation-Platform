import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Target, Shuffle, BarChart2, CheckCircle2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import DateTimePicker from '../../components/DateTimePicker';
import CustomSelect from '../../components/CustomSelect';

/* ── Types ── */
interface JobProfile {
  title: string;
  experience: string;
  description: string;
}
interface QuestionSelection {
  mcqQuestionIds: string[];
  codingQuestionIds: string[];
  reasoning: string;
  suggestedDuration: number;
  suggestedTestName: string;
  suggestedDescription: string;
  mcqPreviews?: Array<{ id: string; text: string; difficulty: string; topic?: string | null }>;
  codingPreviews?: Array<{ id: string; text: string; difficulty: string; topic?: string | null }>;
}
interface TestSettings {
  name: string;
  description: string;
  duration: number;
  startTime: string;
  endTime: string;
  passingMarks: number;
  negativeMarking: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  maxViolations: number;
}

/* ── Recognized skill list for autocomplete ── */
const SKILL_SUGGESTIONS = [
  'JavaScript','TypeScript','Python','Java','C++','C#','Go','Rust','Ruby','PHP','Swift','Kotlin','Scala',
  'React','Vue.js','Angular','Next.js','Nuxt.js','Svelte',
  'Node.js','Express.js','Django','Flask','FastAPI','Spring Boot','Laravel','Rails','ASP.NET',
  'HTML','CSS','Tailwind CSS','Bootstrap','SASS/SCSS',
  'SQL','MySQL','PostgreSQL','MongoDB','Redis','Elasticsearch','DynamoDB','SQLite','Cassandra','Firebase',
  'REST APIs','GraphQL','gRPC','WebSockets','Microservices',
  'AWS','Azure','GCP','Docker','Kubernetes','Terraform','CI/CD','Jenkins','GitHub Actions','Linux',
  'Machine Learning','Deep Learning','Data Science','NLP','Computer Vision','TensorFlow','PyTorch','scikit-learn',
  'Data Structures','Algorithms','System Design','Problem Solving','Object-Oriented Programming','Design Patterns',
  'React Native','Flutter','Android','iOS',
  'Apache Spark','Kafka','ETL','Data Engineering','Hadoop',
  'Networking','Cybersecurity','DevOps','Cloud Computing','Agile','Scrum','Git',
];

/* ── Frontend skill extraction (mirrors backend analyzeJobLocal) ── */
function extractSkillsLocally(title: string, description?: string): string[] {
  const text = `${title} ${description || ''}`;
  const patterns: [RegExp, string][] = [
    [/node\.?js/i, 'Node.js'], [/react\.?js|react\b/i, 'React'],
    [/typescript/i, 'TypeScript'], [/javascript/i, 'JavaScript'],
    [/python\b/i, 'Python'], [/\bjava\b/i, 'Java'],
    [/sql|mysql|postgres/i, 'SQL'], [/rest.?api|express/i, 'REST APIs'],
    [/mongodb|mongo\b/i, 'MongoDB'], [/docker|kubernetes/i, 'Docker'],
    [/aws|azure|gcp|cloud/i, 'Cloud/AWS'], [/vue\.?js/i, 'Vue.js'],
    [/angular\b/i, 'Angular'], [/django|flask/i, 'Django/Flask'],
    [/css|html/i, 'CSS/HTML'], [/graphql/i, 'GraphQL'], [/redis/i, 'Redis'],
  ];
  const skills: string[] = [];
  for (const [re, skill] of patterns) {
    if (re.test(text)) skills.push(skill);
  }
  if ((skills.includes('Node.js') || skills.includes('React')) && !skills.includes('JavaScript')) {
    skills.unshift('JavaScript');
  }
  if (skills.length === 0) skills.push('Problem Solving', 'Algorithms', 'Data Structures');
  return skills.slice(0, 8);
}

/* ── 4-step progress indicator (stretching connectors) ── */
function StepIndicator({ current }: { current: number }) {
  const steps = ['Job Profile', 'Skills & Settings', 'Review Selection', 'Finalize Settings'];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '32px', width: '100%' }}>
      {steps.flatMap((label, i) => {
        const n = i + 1;
        const active = n === current;
        const done = n < current;
        const items = [
          <div key={`step-${n}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '50%',
              backgroundColor: active || done ? '#F59E0B' : '#E5E7EB',
              color: active || done ? 'white' : '#98A2B5',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '14px', fontWeight: 700,
              boxShadow: active ? '0 0 0 4px rgba(245,158,11,0.18)' : 'none',
              transition: 'all 0.2s',
            }}>
              {done ? '✓' : n}
            </div>
            <span style={{
              fontSize: '11px',
              color: active ? '#D97706' : done ? '#6A7387' : '#98A2B5',
              fontWeight: active ? 700 : 400,
              whiteSpace: 'nowrap',
            }}>
              {label}
            </span>
          </div>,
        ];
        if (i < steps.length - 1) {
          items.push(
            <div key={`conn-${n}`} style={{
              flex: 1, height: '2px',
              backgroundColor: done ? '#F59E0B' : '#E5E7EB',
              marginTop: '20px', minWidth: '40px',
              transition: 'background-color 0.3s',
            }} />
          );
        }
        return items;
      })}
    </div>
  );
}

/* ── Right-side info panels ── */
const infoCard: React.CSSProperties = {
  backgroundColor: 'white', borderRadius: '12px', padding: '22px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.07)', position: 'sticky', top: '20px',
};
const infoHeading: React.CSSProperties = {
  fontSize: '10px', fontWeight: 700, color: '#98A2B5', letterSpacing: '0.08em',
  textTransform: 'uppercase', margin: '0 0 16px',
};

function HowItWorksPanel() {
  const items = [
    { n: 1, title: 'Describe the role', desc: 'Enter a job title and optional description to give the AI context about the position.' },
    { n: 2, title: 'Set skills & limits', desc: 'Review AI-suggested skills, set MCQ and coding question counts, and choose difficulty.' },
    { n: 3, title: 'Review AI selection', desc: 'The AI picks the best-matching questions from your library based on skills and difficulty.' },
    { n: 4, title: 'Finalize & publish', desc: 'Configure test dates, passing marks, and shuffle settings, then create and share.' },
  ];
  return (
    <div style={infoCard}>
      <p style={infoHeading}>How it works</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {items.map(item => (
          <div key={item.n} style={{ display: 'flex', gap: '12px' }}>
            <div style={{
              width: '26px', height: '26px', borderRadius: '50%',
              backgroundColor: '#FEF3C7', color: '#D97706',
              fontSize: '12px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {item.n}
            </div>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#11162A', margin: '0 0 3px' }}>{item.title}</p>
              <p style={{ fontSize: '12px', color: '#6A7387', margin: 0, lineHeight: '1.55' }}>{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: '20px', borderTop: '1px solid #F3F4F6', paddingTop: '16px' }}>
        <p style={{ fontSize: '12px', color: '#98A2B5', margin: 0, lineHeight: '1.6' }}>
          The AI analyzes your job requirements and selects the most relevant questions from your existing question library.
        </p>
      </div>
    </div>
  );
}

function SkillsTipsPanel({ skills, difficulty, mcqCount, codingCount }: {
  skills: string[]; difficulty: string; mcqCount: number; codingCount: number;
}) {
  const tips = [
    { Icon: Target,      grad: 'linear-gradient(135deg,#F59E0B,#D97706)', shadow: 'rgba(245,158,11,0.35)', title: 'Add 3–8 skills',       desc: 'More specific skills = better question matching from your library.' },
    { Icon: Shuffle,     grad: 'linear-gradient(135deg,#FB923C,#F59E0B)', shadow: 'rgba(251,146,60,0.35)',  title: 'Mix broad & specific', desc: 'e.g., "Python" + "Django" + "REST APIs" for better coverage.' },
    { Icon: BarChart2,   grad: 'linear-gradient(135deg,#FBBF24,#F59E0B)', shadow: 'rgba(251,191,36,0.35)',  title: 'Use Mixed difficulty', desc: 'Recommended for balanced assessments across all levels.' },
    { Icon: CheckCircle2,grad: 'linear-gradient(135deg,#F59E0B,#B45309)', shadow: 'rgba(180,83,9,0.3)',     title: 'MCQ + Coding combo',  desc: '10 MCQ + 2 coding is a solid starting point for most roles.' },
  ];
  return (
    <div style={infoCard}>
      <p style={infoHeading}>Tips for best results</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {tips.map(tip => (
          <div key={tip.title} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '9px', flexShrink: 0,
              background: tip.grad, boxShadow: `0 2px 8px ${tip.shadow}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <tip.Icon size={16} color="white" strokeWidth={2} />
            </div>
            <div>
              <p style={{ fontSize: '12px', fontWeight: 600, color: '#11162A', margin: '0 0 2px', marginTop: '2px' }}>{tip.title}</p>
              <p style={{ fontSize: '12px', color: '#6A7387', margin: 0, lineHeight: '1.5' }}>{tip.desc}</p>
            </div>
          </div>
        ))}
      </div>
      {skills.length > 0 && (
        <div style={{ marginTop: '18px', borderTop: '1px solid #F3F4F6', paddingTop: '14px' }}>
          <p style={{ fontSize: '11px', fontWeight: 600, color: '#98A2B5', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>Current config</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6A7387' }}>Skills</span>
              <span style={{ fontWeight: 600, color: '#11162A' }}>{skills.length}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6A7387' }}>MCQ</span>
              <span style={{ fontWeight: 600, color: '#11162A' }}>{mcqCount}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6A7387' }}>Coding</span>
              <span style={{ fontWeight: 600, color: '#11162A' }}>{codingCount}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6A7387' }}>Difficulty</span>
              <span style={{ fontWeight: 600, color: '#11162A', textTransform: 'capitalize' }}>{difficulty}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewPanel({ selection }: { selection: QuestionSelection }) {
  const total = selection.mcqQuestionIds.length + selection.codingQuestionIds.length;
  const previews = [
    ...(selection.mcqPreviews || []).slice(0, 3).map(p => ({ ...p, type: 'MCQ' })),
    ...(selection.codingPreviews || []).slice(0, 2).map(p => ({ ...p, type: 'Coding' })),
  ];
  return (
    <div style={infoCard}>
      <p style={infoHeading}>Selection summary</p>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
        <div style={{ flex: 1, borderRadius: '10px', padding: '14px', backgroundColor: '#FFFBEB', textAlign: 'center' }}>
          <p style={{ fontSize: '28px', fontWeight: 700, color: '#F59E0B', margin: 0, lineHeight: 1 }}>{selection.mcqQuestionIds.length}</p>
          <p style={{ fontSize: '11px', color: '#D97706', margin: '4px 0 0', fontWeight: 600 }}>MCQ</p>
        </div>
        <div style={{ flex: 1, borderRadius: '10px', padding: '14px', backgroundColor: '#FFF7ED', textAlign: 'center' }}>
          <p style={{ fontSize: '28px', fontWeight: 700, color: '#D97706', margin: 0, lineHeight: 1 }}>{selection.codingQuestionIds.length}</p>
          <p style={{ fontSize: '11px', color: '#C2410C', margin: '4px 0 0', fontWeight: 600 }}>Coding</p>
        </div>
        <div style={{ flex: 1, borderRadius: '10px', padding: '14px', backgroundColor: '#F9FAFB', textAlign: 'center' }}>
          <p style={{ fontSize: '28px', fontWeight: 700, color: '#434B5E', margin: 0, lineHeight: 1 }}>{total}</p>
          <p style={{ fontSize: '11px', color: '#6A7387', margin: '4px 0 0', fontWeight: 600 }}>Total</p>
        </div>
      </div>
      {previews.length > 0 && (
        <>
          <p style={{ fontSize: '11px', fontWeight: 600, color: '#98A2B5', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Question previews</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {previews.map((p, idx) => (
              <div key={idx} style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: '#F9FAFB', border: '1px solid #F3F4F6' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '999px', backgroundColor: p.type === 'MCQ' ? '#FFFBEB' : '#FFF7ED', color: p.type === 'MCQ' ? '#D97706' : '#C2410C' }}>{p.type}</span>
                  <span style={{ fontSize: '10px', color: '#98A2B5', textTransform: 'capitalize' }}>{p.difficulty}</span>
                </div>
                <p style={{ fontSize: '12px', color: '#434B5E', margin: 0, lineHeight: '1.45', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {p.text}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FinalizePanel({ selection, jobProfile }: { selection: QuestionSelection | null; jobProfile: JobProfile }) {
  if (!selection) return null;
  return (
    <div style={infoCard}>
      <p style={infoHeading}>Selected questions</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderRadius: '8px', backgroundColor: '#FFFBEB' }}>
          <span style={{ fontSize: '13px', color: '#D97706', fontWeight: 600 }}>MCQ Questions</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#F59E0B' }}>{selection.mcqQuestionIds.length}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderRadius: '8px', backgroundColor: '#FFF7ED' }}>
          <span style={{ fontSize: '13px', color: '#C2410C', fontWeight: 600 }}>Coding Questions</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#D97706' }}>{selection.codingQuestionIds.length}</span>
        </div>
      </div>
      <p style={{ fontSize: '11px', fontWeight: 600, color: '#98A2B5', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Job profile</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#6A7387' }}>Title</span>
          <span style={{ fontWeight: 600, color: '#11162A', textAlign: 'right', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{jobProfile.title || '—'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#6A7387' }}>Experience</span>
          <span style={{ fontWeight: 600, color: '#11162A' }}>{jobProfile.experience}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#6A7387' }}>Suggested duration</span>
          <span style={{ fontWeight: 600, color: '#11162A' }}>{selection.suggestedDuration} min</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════ */
export default function AgentTestForm() {
  const navigate = useNavigate();
  const [step,      setStep]      = useState(1);
  const [loading,   setLoading]   = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  /* Step 1 state */
  const [jobProfile, setJobProfile] = useState<JobProfile>({ title: '', experience: '0-2 years', description: '' });

  /* Step 2 state */
  const [skills,      setSkills]      = useState<string[]>([]);
  const [skillInput,  setSkillInput]  = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [difficulty,  setDifficulty]  = useState<'easy' | 'medium' | 'hard' | 'mixed'>('mixed');
  const [mcqCount,    setMcqCount]    = useState(10);
  const [codingCount, setCodingCount] = useState(2);

  /* Step 3 state */
  const [selection, setSelection] = useState<QuestionSelection | null>(null);

  /* Step 4 state */
  const [testSettings, setTestSettings] = useState<TestSettings>({
    name: '', description: '', duration: 60,
    startTime: '', endTime: '', passingMarks: 0,
    negativeMarking: 0, shuffleQuestions: true, shuffleOptions: true, maxViolations: 3,
  });

  /* ── skill helpers ── */
  const filteredSuggestions = skillInput.trim().length > 0
    ? SKILL_SUGGESTIONS.filter(s =>
        s.toLowerCase().includes(skillInput.trim().toLowerCase()) && !skills.includes(s)
      ).slice(0, 6)
    : [];

  const addSkill = (override?: string) => {
    const s = (override ?? skillInput).trim();
    if (!s) return;
    if (skills.includes(s)) { setSkillInput(''); setShowSuggestions(false); return; }
    if (!/^[a-zA-Z][a-zA-Z0-9\s.\+\#\/\-]{1,49}$/.test(s)) {
      toast.error('Enter a valid skill name (e.g., Python, React, Node.js)');
      return;
    }
    setSkills(prev => [...prev, s]);
    setSkillInput('');
    setShowSuggestions(false);
  };
  const removeSkill = (s: string) => setSkills(prev => prev.filter(x => x !== s));

  /* ── Step 1 → 2 ── */
  const handleAnalyzeJob = async () => {
    if (!jobProfile.title.trim()) { toast.error('Job title is required'); return; }
    setAnalyzing(true);
    try {
      const { data } = await adminApi.analyzeJob(jobProfile.title, jobProfile.description);
      if (data.success && data.data) {
        const d = data.data;
        setSkills(d.suggestedSkills || []);
        setDifficulty(d.suggestedDifficulty || 'mixed');
        setMcqCount(d.suggestedMcqCount || 10);
        setCodingCount(d.suggestedCodingCount || 2);
        setJobProfile(p => ({ ...p, experience: d.experienceLevel || p.experience }));
        toast.success('Role analyzed! Review skills and settings below');
      }
    } catch {
      const local = extractSkillsLocally(jobProfile.title, jobProfile.description);
      if (local.length) {
        setSkills(local);
        toast.success('Skills extracted from job title');
      }
    } finally {
      setAnalyzing(false);
      setStep(2);
    }
  };

  /* ── Step 2 → 3 ── */
  const handleGenerateTest = async () => {
    if (!skills.length)             { toast.error('At least one skill is required'); return; }
    if (!mcqCount && !codingCount)  { toast.error('At least one question type must be > 0'); return; }
    setLoading(true);
    try {
      const { data } = await adminApi.generateTest({ jobProfile, skills, difficulty, mcqCount, codingCount });
      if (data.success && data.data) {
        const sel: QuestionSelection = data.data;
        setSelection(sel);
        setTestSettings(p => ({
          ...p,
          name:        sel.suggestedTestName    || `${jobProfile.title} Assessment`,
          description: sel.suggestedDescription || '',
          duration:    sel.suggestedDuration    || 60,
          startTime:   p.startTime || new Date(Date.now() + 60_000).toISOString().slice(0, 16),
        }));
        const total = sel.mcqQuestionIds.length + sel.codingQuestionIds.length;
        if (total === 0) {
          toast.error('No matching questions found in the library. Add questions first.');
        } else {
          toast.success(`${total} questions selected!`);
        }
        setStep(3);
      } else {
        toast.error('Unexpected response from server');
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string } } };
      toast.error(e.response?.data?.message || e.response?.data?.error || 'Failed to generate test');
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 4 → create ── */
  const handleCreateTest = async () => {
    if (!selection)                  { toast.error('No test selection available'); return; }
    if (!testSettings.startTime)     { toast.error('Start time is required'); return; }
    if (!testSettings.name.trim())   { toast.error('Test name is required'); return; }
    setLoading(true);
    try {
      const { data } = await adminApi.createTestFromAgent({
        selection,
        testSettings: {
          ...testSettings,
          startTime: new Date(testSettings.startTime).toISOString(),
          endTime:   testSettings.endTime ? new Date(testSettings.endTime).toISOString() : undefined,
        },
      });
      if (data.success && data.data) {
        toast.success(`Test created! Code: ${data.data.testCode}`);
        navigate(`/admin/tests/${data.data.testId}`);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string } } };
      toast.error(e.response?.data?.message || e.response?.data?.error || 'Failed to create test');
    } finally {
      setLoading(false);
    }
  };

  /* ── shared styles ── */
  const card: React.CSSProperties = {
    backgroundColor: 'white', borderRadius: '12px', padding: '28px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  };
  const lbl: React.CSSProperties = {
    display: 'block', fontSize: '13px', fontWeight: 600, color: '#434B5E', marginBottom: '6px',
  };
  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: '8px',
    border: '1.5px solid #E5E7EB', fontSize: '13px', color: '#11162A',
    outline: 'none', boxSizing: 'border-box', backgroundColor: 'white',
  };
  const btnPrimary: React.CSSProperties = {
    padding: '10px 24px', borderRadius: '8px', border: 'none',
    backgroundColor: '#F59E0B', fontSize: '13px', fontWeight: 600,
    color: 'white', cursor: 'pointer',
  };
  const btnSecondary: React.CSSProperties = {
    padding: '10px 20px', borderRadius: '8px',
    border: '1.5px solid #E5E7EB', backgroundColor: 'white',
    fontSize: '13px', fontWeight: 500, color: '#434B5E', cursor: 'pointer',
  };
  const btnDisabled: React.CSSProperties = {
    ...btnPrimary, backgroundColor: '#FDE68A', cursor: 'not-allowed', opacity: 0.8,
  };
  const focus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    e.target.style.borderColor = '#F59E0B';
    if (e.target instanceof HTMLInputElement && e.target.type === 'number') e.target.select();
  };
  const blur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    (e.target.style.borderColor = '#E5E7EB');

  const parseNum = (val: string, fallback: number, min = 0) => {
    const n = val === '' ? fallback : Number(val);
    return isNaN(n) ? fallback : Math.max(min, Math.floor(n));
  };

  return (
    <div style={{ backgroundColor: '#F9FAFB', minHeight: '100%' }}>

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#98A2B5', marginBottom: '10px' }}>
        <Link to="/admin/tests" style={{ color: '#6A7387', textDecoration: 'none' }}>Assessments</Link>
        <span>›</span>
        <span>AI Generator</span>
      </div>

      <h1 style={{ fontSize: '32px', fontWeight: 700, letterSpacing: '-0.02em', color: '#11162A', margin: '0 0 4px', lineHeight: 1.2 }}>AI Test Generator</h1>
      <p style={{ fontSize: '13px', color: '#6A7387', margin: '0 0 28px' }}>
        Let AI help you create a test by analyzing job requirements and selecting appropriate questions
      </p>

      <StepIndicator current={step} />

      {/* Two-column layout: form left, info panel right */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 290px', gap: '20px', alignItems: 'start' }}>

        {/* ── LEFT: Form ── */}
        <div>

          {/* ════════════ STEP 1: Job Profile ════════════ */}
          {step === 1 && (
            <div style={card}>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#11162A', margin: '0 0 20px' }}>Step 1: Define Job Profile</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div>
                    <label style={lbl}>Job Title <span style={{ color: '#EF4444' }}>*</span></label>
                    <input type="text"
                      value={jobProfile.title}
                      onChange={e => setJobProfile(p => ({ ...p, title: e.target.value }))}
                      placeholder="e.g., Senior Software Engineer"
                      style={inp} onFocus={focus} onBlur={blur}
                    />
                  </div>
                  <div>
                    <label style={lbl}>Experience Level</label>
                    <CustomSelect
                      value={jobProfile.experience}
                      onChange={v => setJobProfile(p => ({ ...p, experience: v }))}
                      options={[
                        { value:'0-1 years', label:'0-1 years (Entry Level)' },
                        { value:'1-3 years', label:'1-3 years (Junior)' },
                        { value:'3-5 years', label:'3-5 years (Mid-Level)' },
                        { value:'5+ years',  label:'5+ years (Senior)' },
                      ]}
                      style={{ width:'100%' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={lbl}>Job Description <span style={{ fontSize: '12px', fontWeight: 400, color: '#98A2B5' }}>(Optional — helps AI pick better questions)</span></label>
                  <textarea
                    value={jobProfile.description}
                    onChange={e => setJobProfile(p => ({ ...p, description: e.target.value }))}
                    placeholder="Paste the job description to help AI understand requirements better..."
                    rows={6}
                    style={{ ...inp, lineHeight: '1.6', resize: 'vertical' }}
                    onFocus={focus} onBlur={blur}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', paddingTop: '4px' }}>
                  <button
                    onClick={handleAnalyzeJob}
                    disabled={analyzing || !jobProfile.title.trim()}
                    style={analyzing || !jobProfile.title.trim() ? btnDisabled : btnPrimary}
                  >
                    {analyzing ? 'Analyzing...' : 'Analyze & Continue'}
                  </button>
                  <button
                    onClick={() => {
                      const local = extractSkillsLocally(jobProfile.title, jobProfile.description);
                      if (local.length) setSkills(local);
                      setStep(2);
                    }}
                    style={btnSecondary}
                  >
                    Skip Analysis
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ════════════ STEP 2: Skills & Test Settings ════════════ */}
          {step === 2 && (
            <div style={card}>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#11162A', margin: '0 0 20px' }}>Step 2: Skills & Test Settings</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                {/* Skills */}
                <div>
                  <label style={lbl}>Required Skills <span style={{ color: '#EF4444' }}>*</span></label>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      {showSuggestions && <div className="fixed inset-0 z-20" onClick={() => setShowSuggestions(false)} />}
                      <input type="text"
                        value={skillInput}
                        onChange={e => { setSkillInput(e.target.value); setShowSuggestions(true); }}
                        onFocus={() => setShowSuggestions(true)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); if (filteredSuggestions.length) addSkill(filteredSuggestions[0]); else addSkill(); }
                          if (e.key === 'Escape') setShowSuggestions(false);
                        }}
                        placeholder="Type a skill and press Enter or click Add"
                        style={{ ...inp, width: '100%', boxSizing: 'border-box' }} onFocus={focus} onBlur={blur}
                        autoComplete="off"
                      />
                      {showSuggestions && filteredSuggestions.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: '2px', backgroundColor: 'white', border: '1.5px solid #FDE68A', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.10)', overflow: 'hidden' }}>
                          {filteredSuggestions.map(s => (
                            <button key={s} type="button"
                              onMouseDown={e => { e.preventDefault(); addSkill(s); }}
                              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: '#11162A' }}
                              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#FFFBEB')}
                              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => addSkill()} style={{ ...btnPrimary, padding: '10px 20px' }}>Add</button>
                  </div>
                  {skills.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px', borderRadius: '8px', backgroundColor: '#FAFAFA', border: '1px solid #F3F4F6' }}>
                      {skills.map(skill => (
                        <span key={skill} style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '5px 12px', borderRadius: '999px',
                          backgroundColor: '#FFFBEB', color: '#D97706',
                          fontSize: '13px', fontWeight: 500,
                          border: '1px solid #FDE68A',
                        }}>
                          {skill}
                          <button type="button" onClick={() => removeSkill(skill)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D97706', fontSize: '16px', lineHeight: 1, padding: '0 0 0 2px' }}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '12px', color: '#98A2B5', margin: 0 }}>No skills added yet. Add at least one skill to continue.</p>
                  )}
                </div>

                {/* Difficulty + counts in a grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                  <div>
                    <label style={lbl}>Difficulty Level</label>
                    <CustomSelect
                      value={difficulty}
                      onChange={v => setDifficulty(v as typeof difficulty)}
                      options={[
                        { value:'easy',   label:'Easy' },
                        { value:'medium', label:'Medium' },
                        { value:'hard',   label:'Hard' },
                        { value:'mixed',  label:'Mixed (All Levels)' },
                      ]}
                      style={{ width:'100%' }}
                    />
                  </div>
                  <div>
                    <label style={lbl}>MCQ Questions</label>
                    <input type="number"
                      value={mcqCount}
                      onChange={e => setMcqCount(parseNum(e.target.value, 0))}
                      min={0} max={50}
                      style={inp} onFocus={focus} onBlur={blur}
                    />
                  </div>
                  <div>
                    <label style={lbl}>Coding Questions</label>
                    <input type="number"
                      value={codingCount}
                      onChange={e => setCodingCount(parseNum(e.target.value, 0))}
                      min={0} max={10}
                      style={inp} onFocus={focus} onBlur={blur}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', paddingTop: '4px' }}>
                  <button onClick={() => setStep(1)} style={btnSecondary}>Back</button>
                  <button
                    onClick={handleGenerateTest}
                    disabled={loading || !skills.length}
                    style={loading || !skills.length ? btnDisabled : btnPrimary}
                  >
                    {loading ? 'Generating...' : 'Generate Test'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ════════════ STEP 3: Review AI Selection ════════════ */}
          {step === 3 && selection && (
            <div style={card}>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#11162A', margin: '0 0 20px' }}>Step 3: Review AI Selection</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                {/* MCQ / Coding counts */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div style={{ borderRadius: '10px', padding: '20px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: '#D97706', margin: '0 0 8px' }}>MCQ Questions</p>
                    <p style={{ fontSize: '44px', fontWeight: 700, color: '#F59E0B', margin: '0 0 2px', lineHeight: 1 }}>{selection.mcqQuestionIds.length}</p>
                    <p style={{ fontSize: '12px', color: '#92400E', margin: 0, fontWeight: 500 }}>selected from library</p>
                  </div>
                  <div style={{ borderRadius: '10px', padding: '20px', backgroundColor: '#FFF7ED', border: '1px solid #FED7AA' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: '#C2410C', margin: '0 0 8px' }}>Coding Questions</p>
                    <p style={{ fontSize: '44px', fontWeight: 700, color: '#D97706', margin: '0 0 2px', lineHeight: 1 }}>{selection.codingQuestionIds.length}</p>
                    <p style={{ fontSize: '12px', color: '#92400E', margin: 0, fontWeight: 500 }}>selected from library</p>
                  </div>
                </div>

                {/* AI Reasoning */}
                {selection.reasoning && (
                  <div style={{ borderRadius: '10px', padding: '16px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
                    <p style={{ fontSize: '12px', fontWeight: 700, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>AI Reasoning</p>
                    <p style={{ fontSize: '13px', color: '#92400E', margin: 0, lineHeight: '1.7' }}>{selection.reasoning}</p>
                  </div>
                )}

                {/* Suggested settings summary */}
                <div style={{ borderRadius: '10px', padding: '16px 18px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ fontSize: '11px', fontWeight: 600, color: '#98A2B5', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Suggested Duration</p>
                    <p style={{ fontSize: '20px', fontWeight: 700, color: '#D97706', margin: 0 }}>{selection.suggestedDuration} <span style={{ fontSize: '13px', fontWeight: 500 }}>min</span></p>
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '11px', fontWeight: 600, color: '#98A2B5', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Suggested Test Name</p>
                    <p style={{ fontSize: '14px', fontWeight: 600, color: '#D97706', margin: 0 }}>{selection.suggestedTestName}</p>
                  </div>
                </div>

                {/* Warnings */}
                {selection.mcqQuestionIds.length + selection.codingQuestionIds.length === 0 && (
                  <div style={{ borderRadius: '10px', padding: '14px 16px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
                    <p style={{ fontSize: '13px', color: '#92400E', margin: 0, lineHeight: '1.5' }}>
                      No matching questions found in the library. Please{' '}
                      <a href="/admin/mcq/new" style={{ color: '#D97706', fontWeight: 600 }}>add MCQ questions</a>
                      {' or '}
                      <a href="/admin/coding/new" style={{ color: '#D97706', fontWeight: 600 }}>coding questions</a>
                      {' '}first, then regenerate.
                    </p>
                  </div>
                )}
                {(selection.mcqQuestionIds.length < mcqCount || selection.codingQuestionIds.length < codingCount) &&
                 selection.mcqQuestionIds.length + selection.codingQuestionIds.length > 0 && (
                  <div style={{ borderRadius: '10px', padding: '14px 16px', backgroundColor: '#FFF7ED', border: '1px solid #FED7AA' }}>
                    <p style={{ fontSize: '13px', color: '#9A3412', margin: 0 }}>
                      Note: Fewer questions were selected than requested. Consider adding more questions with relevant tags to your library.
                    </p>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', paddingTop: '4px' }}>
                  <button onClick={() => setStep(2)} style={btnSecondary}>Back</button>
                  <button onClick={() => setStep(4)} style={btnPrimary}>Continue to Settings</button>
                </div>
              </div>
            </div>
          )}

          {/* ════════════ STEP 4: Finalize Test Settings ════════════ */}
          {step === 4 && (
            <div style={card}>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#11162A', margin: '0 0 20px' }}>Step 4: Finalize Test Settings</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={lbl}>Test Name <span style={{ color: '#EF4444' }}>*</span></label>
                    <input type="text"
                      value={testSettings.name}
                      onChange={e => setTestSettings(p => ({ ...p, name: e.target.value }))}
                      style={inp} onFocus={focus} onBlur={blur}
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={lbl}>Description</label>
                    <textarea
                      value={testSettings.description}
                      onChange={e => setTestSettings(p => ({ ...p, description: e.target.value }))}
                      rows={3}
                      style={{ ...inp, lineHeight: '1.6', resize: 'vertical' }}
                      onFocus={focus} onBlur={blur}
                    />
                  </div>
                  <div>
                    <label style={lbl}>Duration (minutes) <span style={{ color: '#EF4444' }}>*</span></label>
                    <input type="number"
                      value={testSettings.duration === 0 ? '' : testSettings.duration}
                      onChange={e => setTestSettings(p => ({ ...p, duration: e.target.value === '' ? 0 : parseNum(e.target.value, 0, 0) }))}
                      min={0} style={inp} onFocus={focus} onBlur={blur}
                      placeholder="e.g. 60"
                    />
                  </div>
                  <div>
                    <label style={lbl}>Passing Marks</label>
                    <input type="number"
                      value={testSettings.passingMarks}
                      onChange={e => setTestSettings(p => ({ ...p, passingMarks: parseNum(e.target.value, 0) }))}
                      min={0} style={inp} onFocus={focus} onBlur={blur}
                    />
                  </div>
                  <div>
                    <label style={lbl}>Start Time <span style={{ color: '#EF4444' }}>*</span></label>
                    <DateTimePicker
                      value={testSettings.startTime}
                      onChange={v => setTestSettings(p => ({ ...p, startTime: v }))}
                      placeholder="Select start date & time"
                    />
                  </div>
                  <div>
                    <label style={lbl}>End Time <span style={{ fontSize: '12px', fontWeight: 400, color: '#98A2B5' }}>(Optional)</span></label>
                    <DateTimePicker
                      value={testSettings.endTime}
                      onChange={v => setTestSettings(p => ({ ...p, endTime: v }))}
                      placeholder="Select end date & time"
                    />
                  </div>
                  <div>
                    <label style={lbl}>Negative Marking (per question)</label>
                    <input type="number"
                      value={testSettings.negativeMarking}
                      onChange={e => setTestSettings(p => ({ ...p, negativeMarking: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) }))}
                      min={0} step={0.25} style={inp} onFocus={focus} onBlur={blur}
                    />
                  </div>
                  <div>
                    <label style={lbl}>Max Violations</label>
                    <input type="number"
                      value={testSettings.maxViolations}
                      onChange={e => setTestSettings(p => ({ ...p, maxViolations: parseNum(e.target.value, 3, 1) }))}
                      min={1} style={inp} onFocus={focus} onBlur={blur}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '24px', padding: '14px 16px', borderRadius: '8px', backgroundColor: '#F9FAFB', border: '1px solid #F3F4F6' }}>
                  {(['shuffleQuestions', 'shuffleOptions'] as const).map(key => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#434B5E' }}>
                      <input type="checkbox"
                        checked={testSettings[key]}
                        onChange={e => setTestSettings(p => ({ ...p, [key]: e.target.checked }))}
                        style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#F59E0B' }}
                      />
                      {key === 'shuffleQuestions' ? 'Shuffle Questions' : 'Shuffle Options'}
                    </label>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '10px', paddingTop: '4px' }}>
                  <button onClick={() => setStep(3)} style={btnSecondary}>Back</button>
                  <button
                    onClick={handleCreateTest}
                    disabled={loading || !testSettings.startTime || !testSettings.name.trim()}
                    style={loading || !testSettings.startTime || !testSettings.name.trim() ? btnDisabled : btnPrimary}
                  >
                    {loading ? 'Creating...' : 'Create Test'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Info panel ── */}
        <div>
          {step === 1 && <HowItWorksPanel />}
          {step === 2 && <SkillsTipsPanel skills={skills} difficulty={difficulty} mcqCount={mcqCount} codingCount={codingCount} />}
          {step === 3 && selection && <ReviewPanel selection={selection} />}
          {step === 4 && <FinalizePanel selection={selection} jobProfile={jobProfile} />}
        </div>

      </div>
    </div>
  );
}

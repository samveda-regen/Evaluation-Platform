import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { BriefcaseBusiness, Check, ClipboardCheck, ListChecks, Settings2 } from 'lucide-react';
import { adminApi } from '../../services/api';
import DateTimePicker from '../../components/DateTimePicker';
import CustomSelect from '../../components/CustomSelect';

/* -- Types -- */
interface JobProfile {
  title: string;
  experience: string;
  description: string;
}
interface QuestionSelection {
  mcqQuestionIds: string[];
  codingQuestionIds: string[];
  behavioralQuestionIds: string[];
  reasoning: string;
  suggestedDuration: number;
  suggestedTestName: string;
  suggestedDescription: string;
  mcqPreviews?: Array<{ id: string; text: string; difficulty: string; topic?: string | null }>;
  codingPreviews?: Array<{ id: string; text: string; difficulty: string; topic?: string | null }>;
  behavioralPreviews?: Array<{ id: string; text: string; difficulty: string; topic?: string | null }>;
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

const MAX_TEST_VIOLATIONS = 150;

// Timed guesses shown while "Generate Test" is in flight — purely cosmetic, not tied to real
// backend progress (the request is a single blocking call), just to make the wait feel shorter.
const GENERATE_PROGRESS_STEPS = [
  'Matching questions to your required skills…',
  'Scoring relevance across the question library…',
  'Selecting the best fit for this role…',
  'Finalizing the test…',
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toLocalDateTimeValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addMinutesToLocalDateTime(value: string, minutes: number): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  parsed.setMinutes(parsed.getMinutes() + minutes);
  return toLocalDateTimeValue(parsed);
}

function toISOStringFromLocalDateTime(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function isAfterLocalDateTime(startTime: string, endTime: string): boolean {
  const start = new Date(startTime);
  const end = new Date(endTime);
  return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end.getTime() > start.getTime();
}

/* -- Baseline skill list for autocomplete (used as a seed before/if the library list loads) -- */
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

const EXPERIENCE_OPTIONS = [
  { value: '0-2 years', label: '0-2 years (Entry Level)' },
  { value: '2-5 years', label: '2-5 years (Mid-Level)' },
  { value: '5+ years',  label: '5+ years (Senior)' },
];

function normalizeExperienceLevel(value?: string): string {
  if (!value) return '0-2 years';
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('5+') || normalized.includes('senior') || normalized.includes('lead')) return '5+ years';
  if (normalized.includes('3-5') || normalized.includes('2-5') || normalized.includes('mid')) return '2-5 years';
  return '0-2 years';
}

/* -- Frontend skill extraction (mirrors backend analyzeJobLocal) -- */
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
  // No keyword match: don't invent generic CS skills for an unrecognized/non-technical title.
  return skills.slice(0, 8);
}

/* -- 4-step progress indicator (stretching connectors) -- */
function StepIndicator({ current }: { current: number }) {
  const steps = [
    { label: 'Job Profile', icon: BriefcaseBusiness },
    { label: 'Skills & Settings', icon: ListChecks },
    { label: 'Review Selection', icon: ClipboardCheck },
    { label: 'Finalize Settings', icon: Settings2 },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '32px', width: '100%' }}>
      {steps.flatMap((stepItem, i) => {
        const n = i + 1;
        const active = n === current;
        const done = n < current;
        const Icon = stepItem.icon;
        const items = [
          <div key={`step-${n}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '50%',
              backgroundColor: active || done ? 'var(--admin-accent)' : 'var(--admin-border)',
              color: active || done ? 'white' : 'var(--admin-text-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '14px', fontWeight: 700,
              boxShadow: active ? '0 0 0 4px var(--admin-focus-ring)' : 'none',
              transition: 'all 0.2s',
            }}>
              {done ? <Check size={16} strokeWidth={2.4} /> : <Icon size={16} strokeWidth={2.2} />}
            </div>
            <span style={{
              fontSize: '11px',
              color: active ? 'var(--admin-accent-hover)' : done ? 'var(--admin-text-muted)' : 'var(--admin-text-subtle)',
              fontWeight: active ? 700 : 400,
              whiteSpace: 'nowrap',
            }}>
              {stepItem.label}
            </span>
          </div>,
        ];
        if (i < steps.length - 1) {
          items.push(
            <div key={`conn-${n}`} style={{
              flex: 1, height: '2px',
              backgroundColor: done ? 'var(--admin-accent)' : 'var(--admin-border)',
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

/* ======================================================
   MAIN COMPONENT
====================================================== */
export default function AgentTestForm() {
  const navigate = useNavigate();
  const [step,      setStep]      = useState(1);
  const [loading,   setLoading]   = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  /* Step 1 state */
  const [jobProfile, setJobProfile] = useState<JobProfile>({ title: '', experience: '0-2 years', description: '' });
  const [jobTitleError, setJobTitleError] = useState(false);

  /* Step 2 state */
  const [skills,      setSkills]      = useState<string[]>([]);
  const [skillInput,  setSkillInput]  = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [difficulty,  setDifficulty]  = useState<'easy' | 'medium' | 'hard' | 'mixed'>('mixed');
  const [mcqCount,    setMcqCount]    = useState(10);
  const [codingCount, setCodingCount] = useState(2);
  const [behavioralCount, setBehavioralCount] = useState(2);
  const [librarySkills, setLibrarySkills] = useState<string[]>([]);

  /* Step 3 state */
  const [selection, setSelection] = useState<QuestionSelection | null>(null);
  const [progressStep, setProgressStep] = useState(0);

  // `loading` is shared with the Create Test action (step 4), so only cycle this text while
  // step 2's Generate Test call is actually the one in flight.
  const generatingTest = loading && step === 2;
  useEffect(() => {
    if (!generatingTest) { setProgressStep(0); return; }
    const id = setInterval(() => setProgressStep(i => (i + 1) % GENERATE_PROGRESS_STEPS.length), 1800);
    return () => clearInterval(id);
  }, [generatingTest]);

  /* Step 4 state */
  const [testSettings, setTestSettings] = useState<TestSettings>({
    name: '', description: '', duration: 60,
    startTime: '', endTime: '', passingMarks: 0,
    negativeMarking: 0, shuffleQuestions: true, shuffleOptions: true, maxViolations: 3,
  });

  /* -- pull live skill/topic tags from the question library so autocomplete isn't a fixed list -- */
  useEffect(() => {
    adminApi.getLibrarySkills()
      .then(({ data }) => { if (data.success && Array.isArray(data.data?.skills)) setLibrarySkills(data.data.skills); })
      .catch(() => { /* fall back to the static seed list below */ });
  }, []);

  /* -- skill helpers -- */
  const allSuggestions = Array.from(new Set([...librarySkills, ...SKILL_SUGGESTIONS]));
  const filteredSuggestions = skillInput.trim().length > 0
    ? allSuggestions.filter(s =>
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

  const handleSkillInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && filteredSuggestions.length) {
      e.preventDefault();
      setShowSuggestions(true);
      const direction = e.key === 'ArrowDown' ? 1 : -1;
      setActiveSuggestionIndex(i => (i + direction + filteredSuggestions.length) % filteredSuggestions.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showSuggestions && filteredSuggestions.length) addSkill(filteredSuggestions[activeSuggestionIndex] ?? filteredSuggestions[0]);
      else addSkill();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setShowSuggestions(false);
    }
  };

  /* -- Step 1 -> 2 -- */
  const handleAnalyzeJob = async () => {
    if (!jobProfile.title.trim()) { setJobTitleError(true); return; }
    setAnalyzing(true);
    try {
      const { data } = await adminApi.analyzeJob(jobProfile.title, jobProfile.description, jobProfile.experience);
      if (data.success && data.data) {
        const d = data.data;
        setSkills(d.suggestedSkills || []);
        setDifficulty(d.suggestedDifficulty || 'mixed');
        setMcqCount(d.suggestedMcqCount || 10);
        setCodingCount(d.suggestedCodingCount || 2);
        setBehavioralCount(typeof d.suggestedBehavioralCount === 'number' ? d.suggestedBehavioralCount : 2);
        setJobProfile(p => ({ ...p, experience: normalizeExperienceLevel(d.experienceLevel || p.experience) }));
        if (d.suggestedSkills?.length) {
          toast.success(
            d.roleClassification === 'semi-technical'
              ? 'Role analyzed! This role has partial technical overlap — review the suggested skills below'
              : 'Role analyzed! Review skills and settings below'
          );
        } else if (d.roleClassification === 'non-technical') {
          toast.error('This looks like a non-technical role — this generator only covers software/technical questions. Add skills manually if you want to continue anyway.');
        } else {
          toast.error('No relevant technical skills found for this title. Add skills manually to continue.');
        }
      }
    } catch {
      const local = extractSkillsLocally(jobProfile.title, jobProfile.description);
      setSkills(local);
      if (local.length) {
        toast.success('Skills extracted from job title');
      } else {
        toast.error('No relevant technical skills found for this title. Add skills manually to continue.');
      }
    } finally {
      setAnalyzing(false);
      setStep(2);
    }
  };

  /* -- Step 2 -> 3 -- */
  const handleGenerateTest = async () => {
    if (!skills.length)                              { toast.error('At least one skill is required'); return; }
    if (mcqCount < 0 || codingCount < 0 || behavioralCount < 0) { toast.error('Question counts cannot be negative'); return; }
    if (!mcqCount && !codingCount && !behavioralCount) { toast.error('At least one question type must be > 0'); return; }
    setLoading(true);
    try {
      const { data } = await adminApi.generateTest({ jobProfile, skills, difficulty, mcqCount, codingCount, behavioralCount });
      if (data.success && data.data) {
        const sel: QuestionSelection = data.data;
        setSelection(sel);
        setTestSettings(p => ({
          ...p,
          name:        sel.suggestedTestName    || `${jobProfile.title} Assessment`,
          description: sel.suggestedDescription || '',
          duration:    sel.suggestedDuration    || 60,
          startTime:   p.startTime || toLocalDateTimeValue(new Date(Date.now() + 60_000)),
        }));
        const total = sel.mcqQuestionIds.length + sel.codingQuestionIds.length + sel.behavioralQuestionIds.length;
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

  /* -- Step 4 -> create -- */
  const handleCreateTest = async () => {
    if (!selection)                  { toast.error('No test selection available'); return; }
    if (!testSettings.startTime)     { toast.error('Start time is required'); return; }
    if (!testSettings.name.trim())   { toast.error('Test name is required'); return; }
    const startTimeIso = toISOStringFromLocalDateTime(testSettings.startTime);
    if (!startTimeIso) { toast.error('Please select a valid start time'); return; }
    const endTimeIso = testSettings.endTime ? toISOStringFromLocalDateTime(testSettings.endTime) : null;
    if (testSettings.endTime && (!endTimeIso || !isAfterLocalDateTime(testSettings.startTime, testSettings.endTime))) {
      toast.error('End time must be after start time');
      return;
    }
    if (!Number.isFinite(testSettings.duration) || testSettings.duration <= 0) { toast.error('Duration must be greater than 0 minutes'); return; }
    if (!Number.isFinite(testSettings.passingMarks) || testSettings.passingMarks < 0) { toast.error('Passing marks cannot be negative'); return; }
    if (!Number.isFinite(testSettings.negativeMarking) || testSettings.negativeMarking < 0) { toast.error('Negative marking cannot be negative'); return; }
    if (!Number.isFinite(testSettings.maxViolations) || testSettings.maxViolations < 1 || testSettings.maxViolations > MAX_TEST_VIOLATIONS) {
      toast.error(`Max violations must be between 1 and ${MAX_TEST_VIOLATIONS}`);
      return;
    }
    setLoading(true);
    try {
      const { data } = await adminApi.createTestFromAgent({
        selection,
        testSettings: {
          ...testSettings,
          startTime: startTimeIso,
          endTime:   endTimeIso || undefined,
        },
      });
      if (data.success && data.data) {
        toast.success(`Test created! Code: ${data.data.testCode}`);
        navigate('/admin/tests');
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string } } };
      toast.error(e.response?.data?.message || e.response?.data?.error || 'Failed to create test');
    } finally {
      setLoading(false);
    }
  };

  /* -- shared styles -- */
  const card: React.CSSProperties = {
    backgroundColor: 'white', borderRadius: '12px', padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid var(--admin-border)',
    height: '100%', overflowY: 'auto', boxSizing: 'border-box',
  };
  const lbl: React.CSSProperties = {
    display: 'block', fontSize: 'var(--admin-control-font-size)', fontWeight: 600, color: 'var(--admin-text-muted)', marginBottom: '6px',
  };
  const inp: React.CSSProperties = {
    width: '100%', padding: 'var(--admin-field-padding-y) var(--admin-field-padding-x)', borderRadius: 'var(--admin-field-radius)',
    border: '1.5px solid var(--admin-border)', fontSize: 'var(--admin-control-font-size)', color: 'var(--admin-text)',
    outline: 'none', boxSizing: 'border-box', backgroundColor: 'white',
  };
  const btnPrimary: React.CSSProperties = {
    padding: 'var(--admin-control-padding-y) var(--admin-control-padding-x-primary)', borderRadius: 'var(--admin-control-radius)', border: '1px solid var(--admin-accent)',
    backgroundColor: 'var(--admin-accent)', fontSize: '14px', lineHeight: '1.25rem', fontWeight: 600,
    color: 'white', cursor: 'pointer',
  };
  const btnSecondary: React.CSSProperties = {
    padding: 'var(--admin-control-padding-y) var(--admin-control-padding-x)', borderRadius: 'var(--admin-control-radius)',
    border: '1px solid var(--admin-border)', backgroundColor: 'white',
    fontSize: '14px', lineHeight: '1.25rem', fontWeight: 500, color: 'var(--admin-text)', cursor: 'pointer',
  };
  const btnDisabled: React.CSSProperties = {
    ...btnPrimary, backgroundColor: 'var(--admin-accent-disabled)', cursor: 'not-allowed', opacity: 0.8,
  };
  const focus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    e.target.style.borderColor = 'var(--admin-border-focus)';
    if (e.target instanceof HTMLInputElement && e.target.type === 'number') e.target.select();
  };
  const blur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    (e.target.style.borderColor = 'var(--admin-border)');

  const parseNum = (val: string, fallback: number) => {
    const n = val === '' ? fallback : Number(val);
    return isNaN(n) ? fallback : Math.max(0, Math.floor(n));
  };

  const handleStartTimeChange = (startTime: string) => {
    setTestSettings(prev => {
      const endTimeStillValid = !prev.endTime || isAfterLocalDateTime(startTime, prev.endTime);
      if (!endTimeStillValid) toast.error('End time was cleared because it is before the start time');
      return {
        ...prev,
        startTime,
        endTime: endTimeStillValid ? prev.endTime : '',
      };
    });
  };

  const handleEndTimeChange = (endTime: string) => {
    if (testSettings.startTime && !isAfterLocalDateTime(testSettings.startTime, endTime)) {
      toast.error('End time must be after start time');
      return;
    }
    setTestSettings(prev => ({ ...prev, endTime }));
  };

  const minEndTime = testSettings.startTime ? addMinutesToLocalDateTime(testSettings.startTime, 1) : '';

  return (
    <div style={{
      backgroundColor: '#F9FAFB',
      height: 'calc(100vh - 100px)',
      minHeight: '560px',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '1360px',
        margin: '0 auto',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}>

      <h1 className="text-2xl font-bold" style={{ color: 'var(--admin-text)', margin: '0 0 4px', lineHeight: 1.2 }}>AI Test Generator</h1>
      <p className="text-sm" style={{ color: 'var(--admin-text-muted)', margin: '0 0 24px' }}>
        Let AI help you create a test by analyzing job requirements and selecting appropriate questions
      </p>

      <StepIndicator current={step} />

      <div style={{
        width: '100%',
        flex: 1,
        minHeight: 0,
      }}>

          {/* ============ STEP 1: Job Profile ============ */}
          {step === 1 && (
            <div style={card}>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--admin-text)', margin: '0 0 20px' }}>Step 1: Define Job Profile</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div>
                    <label style={lbl}>Job Title <span style={{ color: '#EF4444' }}>*</span></label>
                    <input type="text"
                      value={jobProfile.title}
                      onChange={e => { setJobProfile(p => ({ ...p, title: e.target.value })); if (e.target.value.trim()) setJobTitleError(false); }}
                      placeholder="e.g., Senior Software Engineer"
                      style={jobTitleError ? { ...inp, borderColor: '#EF4444' } : inp} onFocus={focus} onBlur={blur}
                    />
                    {jobTitleError && (
                      <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#EF4444' }}>Please fill this field</p>
                    )}
                  </div>
                  <div>
                    <label style={lbl}>Experience Level</label>
                    <CustomSelect
                      value={jobProfile.experience}
                      onChange={v => setJobProfile(p => ({ ...p, experience: v }))}
                      options={EXPERIENCE_OPTIONS}
                      style={{ width:'100%' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={lbl}>Job Description <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--admin-text-subtle)' }}>(Optional - helps AI pick better questions)</span></label>
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
                    disabled={analyzing}
                    style={analyzing ? btnDisabled : btnPrimary}
                  >
                    {analyzing ? 'Analyzing...' : 'Analyze & Continue'}
                  </button>
                  <button
                    onClick={() => {
                      if (!jobProfile.title.trim()) { setJobTitleError(true); return; }
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

          {/* ============ STEP 2: Skills & Test Settings ============ */}
          {step === 2 && (
            <div style={card}>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--admin-text)', margin: '0 0 20px' }}>Step 2: Skills & Test Settings</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                {/* Skills */}
                <div>
                  <label style={lbl}>Required Skills <span style={{ color: '#EF4444' }}>*</span></label>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      {showSuggestions && <div className="fixed inset-0 z-20" onClick={() => setShowSuggestions(false)} />}
                      <input type="text"
                        value={skillInput}
                        onChange={e => { setSkillInput(e.target.value); setShowSuggestions(true); setActiveSuggestionIndex(0); }}
                        onFocus={e => { setShowSuggestions(true); setActiveSuggestionIndex(0); focus(e); }}
                        onKeyDown={handleSkillInputKeyDown}
                        placeholder="Type a skill and press Enter or click Add"
                        style={{ ...inp, width: '100%', boxSizing: 'border-box' }} onBlur={blur}
                        autoComplete="off"
                      />
                      {showSuggestions && filteredSuggestions.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: '2px', backgroundColor: 'white', border: '1.5px solid var(--admin-accent-disabled)', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.10)', overflow: 'hidden' }}>
                          {filteredSuggestions.map((s, index) => (
                            <button key={s} type="button"
                              onMouseDown={e => { e.preventDefault(); addSkill(s); }}
                              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', background: index === activeSuggestionIndex ? 'var(--admin-accent-soft)' : 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: index === activeSuggestionIndex ? 'var(--admin-accent-hover)' : 'var(--admin-text)', fontWeight: index === activeSuggestionIndex ? 600 : 400 }}
                              onMouseEnter={() => setActiveSuggestionIndex(index)}
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
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '2px 0 0' }}>
                      {skills.map(skill => (
                        <span key={skill} style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '5px 12px', borderRadius: '999px',
                          backgroundColor: 'var(--admin-accent-soft)', color: 'var(--admin-accent-hover)',
                          fontSize: '13px', fontWeight: 500,
                          border: '1px solid var(--admin-accent-disabled)',
                        }}>
                          {skill}
                          <button type="button" onClick={() => removeSkill(skill)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--admin-accent-hover)', fontSize: '16px', lineHeight: 1, padding: '0 0 0 2px' }}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '12px', color: 'var(--admin-text-subtle)', margin: 0 }}>No skills added yet. Add at least one skill to continue.</p>
                  )}
                </div>

                {/* Difficulty + counts in a grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '14px' }}>
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
                      min={0}
                      style={inp} onFocus={focus} onBlur={blur}
                    />
                  </div>
                  <div>
                    <label style={lbl}>Coding Questions</label>
                    <input type="number"
                      value={codingCount}
                      onChange={e => setCodingCount(parseNum(e.target.value, 0))}
                      min={0}
                      style={inp} onFocus={focus} onBlur={blur}
                    />
                  </div>
                  <div>
                    <label style={lbl}>Behavioral Questions</label>
                    <input type="number"
                      value={behavioralCount}
                      onChange={e => setBehavioralCount(parseNum(e.target.value, 0))}
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
                {generatingTest && (
                  <p style={{ fontSize: '12px', color: 'var(--admin-text-subtle)', margin: '10px 0 0', textAlign: 'center' }}>
                    {GENERATE_PROGRESS_STEPS[progressStep]}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ============ STEP 3: Review AI Selection ============ */}
          {step === 3 && selection && (
            <div style={card}>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--admin-text)', margin: '0 0 20px' }}>Step 3: Review AI Selection</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                {/* MCQ / Coding / Behavioral counts */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                  <div style={{ borderRadius: '10px', padding: '20px', backgroundColor: 'var(--admin-accent-soft)', border: '1px solid var(--admin-accent-disabled)' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--admin-accent-hover)', margin: '0 0 8px' }}>MCQ Questions</p>
                    <p style={{ fontSize: '44px', fontWeight: 700, color: 'var(--admin-accent)', margin: '0 0 2px', lineHeight: 1 }}>{selection.mcqQuestionIds.length}</p>
                    <p style={{ fontSize: '12px', color: 'var(--admin-text-muted)', margin: 0, fontWeight: 500 }}>selected from library</p>
                  </div>
                  <div style={{ borderRadius: '10px', padding: '20px', backgroundColor: 'var(--admin-accent-soft)', border: '1px solid var(--admin-accent-disabled)' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--admin-accent-hover)', margin: '0 0 8px' }}>Coding Questions</p>
                    <p style={{ fontSize: '44px', fontWeight: 700, color: 'var(--admin-accent-hover)', margin: '0 0 2px', lineHeight: 1 }}>{selection.codingQuestionIds.length}</p>
                    <p style={{ fontSize: '12px', color: 'var(--admin-text-muted)', margin: 0, fontWeight: 500 }}>selected from library</p>
                  </div>
                  <div style={{ borderRadius: '10px', padding: '20px', backgroundColor: 'var(--admin-accent-soft)', border: '1px solid var(--admin-accent-disabled)' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--admin-accent-hover)', margin: '0 0 8px' }}>Behavioral Questions</p>
                    <p style={{ fontSize: '44px', fontWeight: 700, color: 'var(--admin-accent-hover)', margin: '0 0 2px', lineHeight: 1 }}>{selection.behavioralQuestionIds.length}</p>
                    <p style={{ fontSize: '12px', color: 'var(--admin-text-muted)', margin: 0, fontWeight: 500 }}>selected from library</p>
                  </div>
                </div>

                {/* AI Reasoning */}
                {selection.reasoning && (
                  <div style={{ borderRadius: '10px', padding: '16px', backgroundColor: 'var(--admin-accent-soft)', border: '1px solid var(--admin-accent-disabled)' }}>
                    <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--admin-accent-hover)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>AI Reasoning</p>
                    <p style={{ fontSize: '13px', color: 'var(--admin-text-muted)', margin: 0, lineHeight: '1.7' }}>{selection.reasoning}</p>
                  </div>
                )}

                {/* Suggested settings summary */}
                <div style={{ borderRadius: '10px', padding: '16px 18px', backgroundColor: 'var(--admin-accent-soft)', border: '1px solid var(--admin-accent-disabled)', display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--admin-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Suggested Duration</p>
                    <p style={{ fontSize: '20px', fontWeight: 700, color: 'var(--admin-accent-hover)', margin: 0 }}>{selection.suggestedDuration} <span style={{ fontSize: '13px', fontWeight: 500 }}>min</span></p>
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--admin-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Suggested Test Name</p>
                    <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--admin-accent-hover)', margin: 0 }}>{selection.suggestedTestName}</p>
                  </div>
                </div>

                {/* Warnings */}
                {selection.mcqQuestionIds.length + selection.codingQuestionIds.length + selection.behavioralQuestionIds.length === 0 && (
                  <div style={{ borderRadius: '10px', padding: '14px 16px', backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5' }}>
                    <p style={{ fontSize: '13px', color: '#991B1B', margin: 0, lineHeight: '1.5', fontWeight: 600 }}>
                      No questions selected.
                    </p>
                    <p style={{ fontSize: '13px', color: '#991B1B', margin: '4px 0 0', lineHeight: '1.5' }}>
                      No matching questions were found in the library for these skills. Please{' '}
                      <a href="/admin/mcq/new" style={{ color: '#991B1B', fontWeight: 600 }}>add MCQ questions</a>
                      {', '}
                      <a href="/admin/coding/new" style={{ color: '#991B1B', fontWeight: 600 }}>coding questions</a>
                      {', or '}
                      <a href="/admin/behavioral/new" style={{ color: '#991B1B', fontWeight: 600 }}>behavioral questions</a>
                      {' '}with relevant tags first, or go back and adjust the required skills, then regenerate.
                    </p>
                  </div>
                )}
                {(selection.mcqQuestionIds.length < mcqCount || selection.codingQuestionIds.length < codingCount || selection.behavioralQuestionIds.length < behavioralCount) &&
                 selection.mcqQuestionIds.length + selection.codingQuestionIds.length + selection.behavioralQuestionIds.length > 0 && (
                  <div style={{ borderRadius: '10px', padding: '14px 16px', backgroundColor: 'var(--admin-accent-soft)', border: '1px solid var(--admin-accent-disabled)' }}>
                    <p style={{ fontSize: '14px', color: '#991B1B', margin: 0 }}>
                      <strong>Note:</strong> Fewer questions were selected than requested. Consider adding more questions with relevant tags to your library.
                    </p>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', paddingTop: '4px' }}>
                  <button onClick={() => setStep(2)} style={btnSecondary}>Back</button>
                  {(() => {
                    const noQuestions = selection.mcqQuestionIds.length + selection.codingQuestionIds.length + selection.behavioralQuestionIds.length === 0;
                    return (
                      <button
                        onClick={() => setStep(4)}
                        disabled={noQuestions}
                        style={noQuestions ? btnDisabled : btnPrimary}
                      >
                        Continue to Settings
                      </button>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* ============ STEP 4: Finalize Test Settings ============ */}
          {step === 4 && (
            <div style={card}>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--admin-text)', margin: '0 0 20px' }}>Step 4: Finalize Test Settings</h2>
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
                    <input type="number" min={1}
                      value={testSettings.duration === 0 ? '' : testSettings.duration}
                      onChange={e => setTestSettings(p => ({ ...p, duration: e.target.value === '' ? 0 : parseNum(e.target.value, 0) }))}
                      style={inp} onFocus={focus} onBlur={blur}
                      placeholder="e.g. 60"
                    />
                  </div>
                  <div>
                    <label style={lbl}>Passing Marks</label>
                    <input type="number"
                      value={testSettings.passingMarks}
                      onChange={e => setTestSettings(p => ({ ...p, passingMarks: parseNum(e.target.value, 0) }))}
                      style={inp} onFocus={focus} onBlur={blur}
                    />
                  </div>
                  <div>
                    <label style={lbl}>Start Time <span style={{ color: '#EF4444' }}>*</span></label>
                    <DateTimePicker
                      value={testSettings.startTime}
                      onChange={handleStartTimeChange}
                      placeholder="Select start date & time"
                    />
                  </div>
                  <div>
                    <label style={lbl}>End Time <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--admin-text-subtle)' }}>(Optional)</span></label>
                    <DateTimePicker
                      value={testSettings.endTime}
                      onChange={handleEndTimeChange}
                      minDateTime={minEndTime}
                      placeholder="Select end date & time"
                    />
                  </div>
                  <div>
                    <label style={lbl}>Negative Marking (per question)</label>
                    <input type="number"
                      value={testSettings.negativeMarking}
                      onChange={e => setTestSettings(p => ({ ...p, negativeMarking: e.target.value === '' ? 0 : Number(e.target.value) }))}
                      style={inp} onFocus={focus} onBlur={blur}
                    />
                  </div>
                  <div>
                    <label style={lbl}>Max Violations</label>
                    <input type="number"
                      value={testSettings.maxViolations}
                      onChange={e => setTestSettings(p => ({ ...p, maxViolations: parseNum(e.target.value, 3) }))}
                      min={1} max={MAX_TEST_VIOLATIONS}
                      style={inp} onFocus={focus} onBlur={blur}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '24px', padding: '14px 16px', borderRadius: '8px', backgroundColor: '#F9FAFB', border: '1px solid var(--admin-border)' }}>
                  {(['shuffleQuestions', 'shuffleOptions'] as const).map(key => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--admin-text-muted)' }}>
                      <input type="checkbox"
                        checked={testSettings[key]}
                        onChange={e => setTestSettings(p => ({ ...p, [key]: e.target.checked }))}
                        style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--admin-button-primary)' }}
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
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import DateTimePicker from '../../components/DateTimePicker';

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

/* ── 4-step progress indicator ── */
function StepIndicator({ current }: { current: number }) {
  const steps = ['Job Profile', 'Skills & Settings', 'Review Selection', 'Finalize Settings'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '28px' }}>
      {steps.map((label, i) => {
        const n = i + 1;
        const active = n === current;
        const done   = n < current;
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
              <div style={{
                width: '38px', height: '38px', borderRadius: '50%',
                backgroundColor: active || done ? '#1D4ED8' : '#E5E7EB',
                color: active || done ? 'white' : '#9CA3AF',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '14px', fontWeight: 700, flexShrink: 0,
              }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontSize: '11px', color: active ? '#1D4ED8' : done ? '#6B7280' : '#9CA3AF', fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ width: '80px', height: '2px', backgroundColor: done ? '#1D4ED8' : '#E5E7EB', marginBottom: '22px', flexShrink: 0 }} />
            )}
          </div>
        );
      })}
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
  const addSkill = () => {
    const s = skillInput.trim();
    if (s && !skills.includes(s)) setSkills(prev => [...prev, s]);
    setSkillInput('');
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
      /* Backend unavailable — extract skills from title/description locally */
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
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)', maxWidth: '720px',
  };
  const lbl: React.CSSProperties = {
    display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px',
  };
  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: '8px',
    border: '1.5px solid #E5E7EB', fontSize: '13px', color: '#111827',
    outline: 'none', boxSizing: 'border-box', backgroundColor: 'white',
  };
  const btnPrimary: React.CSSProperties = {
    padding: '10px 24px', borderRadius: '8px', border: 'none',
    backgroundColor: '#1D4ED8', fontSize: '13px', fontWeight: 600,
    color: 'white', cursor: 'pointer',
  };
  const btnSecondary: React.CSSProperties = {
    padding: '10px 20px', borderRadius: '8px',
    border: '1.5px solid #E5E7EB', backgroundColor: 'white',
    fontSize: '13px', fontWeight: 500, color: '#374151', cursor: 'pointer',
  };
  const btnDisabled: React.CSSProperties = {
    ...btnPrimary, backgroundColor: '#93C5FD', cursor: 'not-allowed', opacity: 0.8,
  };
  const focus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    e.target.style.borderColor = '#1D4ED8';
    if (e.target instanceof HTMLInputElement && e.target.type === 'number') e.target.select();
  };
  const blur  = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    (e.target.style.borderColor = '#E5E7EB');

  const parseNum = (val: string, fallback: number, min = 0) => {
    const n = val === '' ? fallback : Number(val);
    return isNaN(n) ? fallback : Math.max(min, Math.floor(n));
  };

  return (
    <div style={{ backgroundColor: '#F9FAFB', minHeight: '100%' }}>

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#9CA3AF', marginBottom: '10px' }}>
        <Link to="/admin/tests" style={{ color: '#6B7280', textDecoration: 'none' }}>Assessments</Link>
        <span>›</span>
        <span>AI Generator</span>
      </div>

      <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>AI Test Generator</h1>
      <p style={{ fontSize: '13px', color: '#6B7280', margin: '0 0 28px' }}>
        Let AI help you create a test by analyzing job requirements and selecting appropriate questions
      </p>

      <StepIndicator current={step} />

      {/* ════════════ STEP 1: Job Profile ════════════ */}
      {step === 1 && (
        <div style={card}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#111827', margin: '0 0 20px' }}>Step 1: Define Job Profile</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

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
              <select
                value={jobProfile.experience}
                onChange={e => setJobProfile(p => ({ ...p, experience: e.target.value }))}
                style={inp} onFocus={focus} onBlur={blur}
              >
                <option value="0-1 years">0-1 years (Entry Level)</option>
                <option value="1-3 years">1-3 years (Junior)</option>
                <option value="3-5 years">3-5 years (Mid-Level)</option>
                <option value="5+ years">5+ years (Senior)</option>
              </select>
            </div>

            <div>
              <label style={lbl}>Job Description (Optional)</label>
              <textarea
                value={jobProfile.description}
                onChange={e => setJobProfile(p => ({ ...p, description: e.target.value }))}
                placeholder="Paste the job description to help AI understand requirements better..."
                rows={5}
                style={{ ...inp, lineHeight: '1.6' }}
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
                  /* Skip — extract skills locally so Step 2 isn't blank */
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
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#111827', margin: '0 0 20px' }}>Step 2: Skills & Test Settings</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

            {/* Skills */}
            <div>
              <label style={lbl}>Required Skills <span style={{ color: '#EF4444' }}>*</span></label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <input type="text"
                  value={skillInput}
                  onChange={e => setSkillInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                  placeholder="Type a skill and press Enter"
                  style={{ ...inp, flex: 1 }} onFocus={focus} onBlur={blur}
                />
                <button type="button" onClick={addSkill} style={btnPrimary}>Add</button>
              </div>
              {skills.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {skills.map(skill => (
                    <span key={skill} style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      padding: '5px 12px', borderRadius: '999px',
                      backgroundColor: '#EFF6FF', color: '#1D4ED8',
                      fontSize: '13px', fontWeight: 500,
                    }}>
                      {skill}
                      <button type="button" onClick={() => removeSkill(skill)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1D4ED8', fontSize: '16px', lineHeight: 1, padding: '0 0 0 2px' }}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Difficulty */}
            <div>
              <label style={lbl}>Difficulty Level</label>
              <select
                value={difficulty}
                onChange={e => setDifficulty(e.target.value as typeof difficulty)}
                style={inp} onFocus={focus} onBlur={blur}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="mixed">Mixed (All Levels)</option>
              </select>
            </div>

            {/* Question counts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={lbl}>Number of MCQ Questions</label>
                <input type="number"
                  value={mcqCount}
                  onChange={e => setMcqCount(parseNum(e.target.value, 0))}
                  min={0} max={50}
                  style={inp} onFocus={focus} onBlur={blur}
                />
              </div>
              <div>
                <label style={lbl}>Number of Coding Questions</label>
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
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#111827', margin: '0 0 20px' }}>Step 3: Review AI Selection</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* AI Reasoning */}
            {selection.reasoning && (
              <div style={{ borderRadius: '10px', padding: '16px', backgroundColor: '#F9FAFB', border: '1px solid #F3F4F6' }}>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#111827', margin: '0 0 8px' }}>AI Reasoning</p>
                <p style={{ fontSize: '13px', color: '#6B7280', margin: 0, lineHeight: '1.7' }}>{selection.reasoning}</p>
              </div>
            )}

            {/* MCQ / Coding counts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={{ borderRadius: '10px', padding: '18px', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#1E40AF', margin: '0 0 6px' }}>MCQ Questions</p>
                <p style={{ fontSize: '40px', fontWeight: 700, color: '#1D4ED8', margin: '0 0 2px', lineHeight: 1 }}>{selection.mcqQuestionIds.length}</p>
                <p style={{ fontSize: '12px', color: '#60A5FA', margin: 0 }}>selected</p>
              </div>
              <div style={{ borderRadius: '10px', padding: '18px', backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#166534', margin: '0 0 6px' }}>Coding Questions</p>
                <p style={{ fontSize: '40px', fontWeight: 700, color: '#16A34A', margin: '0 0 2px', lineHeight: 1 }}>{selection.codingQuestionIds.length}</p>
                <p style={{ fontSize: '12px', color: '#4ADE80', margin: 0 }}>selected</p>
              </div>
            </div>

            {/* 0-questions warning */}
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

            {/* Partial selection warning */}
            {(selection.mcqQuestionIds.length < mcqCount || selection.codingQuestionIds.length < codingCount) &&
             selection.mcqQuestionIds.length + selection.codingQuestionIds.length > 0 && (
              <div style={{ borderRadius: '10px', padding: '14px 16px', backgroundColor: '#FFF7ED', border: '1px solid #FED7AA' }}>
                <p style={{ fontSize: '13px', color: '#9A3412', margin: 0 }}>
                  Note: Fewer questions were selected than requested because not enough matching questions were found in the library. Consider adding more questions with relevant tags.
                </p>
              </div>
            )}

            {/* Suggested settings summary */}
            <div style={{ borderRadius: '10px', padding: '16px 18px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#92400E', margin: '0 0 10px' }}>Suggested Settings</p>
              <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap', fontSize: '13px' }}>
                <span><span style={{ color: '#D97706', fontWeight: 500 }}>Duration:</span>{' '}
                  <span style={{ color: '#374151' }}>{selection.suggestedDuration} min</span>
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ color: '#D97706', fontWeight: 500 }}>Test Name:</span>{' '}
                  <span style={{ color: '#374151' }}>{selection.suggestedTestName}</span>
                </span>
              </div>
            </div>

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
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#111827', margin: '0 0 20px' }}>Step 4: Finalize Test Settings</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            <div>
              <label style={lbl}>Test Name <span style={{ color: '#EF4444' }}>*</span></label>
              <input type="text"
                value={testSettings.name}
                onChange={e => setTestSettings(p => ({ ...p, name: e.target.value }))}
                style={inp} onFocus={focus} onBlur={blur}
              />
            </div>

            <div>
              <label style={lbl}>Description</label>
              <textarea
                value={testSettings.description}
                onChange={e => setTestSettings(p => ({ ...p, description: e.target.value }))}
                rows={3}
                style={{ ...inp, lineHeight: '1.6' }}
                onFocus={focus} onBlur={blur}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={lbl}>Duration (minutes) <span style={{ color: '#EF4444' }}>*</span></label>
                <input type="number"
                  value={testSettings.duration}
                  onChange={e => setTestSettings(p => ({ ...p, duration: parseNum(e.target.value, 60, 5) }))}
                  min={5} style={inp} onFocus={focus} onBlur={blur}
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
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={lbl}>Start Time <span style={{ color: '#EF4444' }}>*</span></label>
                <DateTimePicker
                  value={testSettings.startTime}
                  onChange={v => setTestSettings(p => ({ ...p, startTime: v }))}
                  placeholder="Select start date & time"
                />
              </div>
              <div>
                <label style={lbl}>End Time (Optional)</label>
                <DateTimePicker
                  value={testSettings.endTime}
                  onChange={v => setTestSettings(p => ({ ...p, endTime: v }))}
                  placeholder="Select end date & time"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
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

            <div style={{ display: 'flex', gap: '24px' }}>
              {(['shuffleQuestions', 'shuffleOptions'] as const).map(key => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#374151' }}>
                  <input type="checkbox"
                    checked={testSettings[key]}
                    onChange={e => setTestSettings(p => ({ ...p, [key]: e.target.checked }))}
                    style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#1D4ED8' }}
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
  );
}

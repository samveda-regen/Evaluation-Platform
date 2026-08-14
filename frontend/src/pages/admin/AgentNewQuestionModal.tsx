import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { X, Trash2 } from 'lucide-react';
import { adminApi } from '../../services/api';
import type { PreviewEntry, SuggestionType } from './agentTestForm.types';

interface Props {
  allowedTypes: SuggestionType[];
  onClose: () => void;
  onCreated: (type: SuggestionType, id: string, preview: PreviewEntry) => void;
}

const TYPE_LABELS: Record<SuggestionType, string> = { mcq: 'MCQ', coding: 'Coding', behavioral: 'Behavioral' };
const TAG_REGEX = /^[a-z0-9][a-z0-9_\- ]*$/;
const CODING_LANGUAGES = ['python', 'javascript', 'java', 'cpp', 'c'];
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const inp: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: '10px',
  border: '1.5px solid var(--admin-border)', fontSize: '13px', color: 'var(--admin-text)',
  outline: 'none', boxSizing: 'border-box', backgroundColor: 'white',
};
const lbl: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--admin-text-muted)', marginBottom: '6px' };

function DifficultyPicker({ value, onChange }: { value: 'easy' | 'medium' | 'hard'; onChange: (d: 'easy' | 'medium' | 'hard') => void }) {
  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      {(['easy', 'medium', 'hard'] as const).map(d => (
        <button key={d} type="button" onClick={() => onChange(d)}
          style={{
            flex: 1, padding: '9px 0', borderRadius: '10px', fontSize: '12px', fontWeight: 600, textAlign: 'center', cursor: 'pointer',
            border: `1.5px solid ${value === d ? 'var(--admin-accent)' : 'var(--admin-border)'}`,
            backgroundColor: value === d ? 'var(--admin-accent-soft)' : '#F9FAFB',
            color: value === d ? 'var(--admin-accent-hover)' : 'var(--admin-text-muted)',
          }}>
          {d.charAt(0).toUpperCase() + d.slice(1)}
        </button>
      ))}
    </div>
  );
}

function TagEditor({ tags, onAdd, onRemove }: { tags: string[]; onAdd: (t: string) => void; onRemove: (t: string) => void }) {
  const [input, setInput] = useState('');
  const [showInput, setShowInput] = useState(false);
  const commit = () => {
    const t = input.trim().toLowerCase();
    if (!t) { setShowInput(false); return; }
    if (!TAG_REGEX.test(t)) { toast.error('Tags: letters, numbers, hyphens only'); return; }
    onAdd(t);
    setInput(''); setShowInput(false);
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
      {tags.map(tag => (
        <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '999px', backgroundColor: 'var(--admin-border)', color: 'var(--admin-text-muted)', fontSize: '12px', fontWeight: 500 }}>
          {tag}
          <button type="button" onClick={() => onRemove(tag)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--admin-text-subtle)', lineHeight: 1 }}>×</button>
        </span>
      ))}
      {showInput ? (
        <input autoFocus type="text" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { setShowInput(false); setInput(''); } }}
          onBlur={commit}
          style={{ padding: '4px 10px', fontSize: '12px', borderRadius: '999px', border: '1.5px solid var(--admin-accent)', outline: 'none', width: '80px' }}
          placeholder="tag…"
        />
      ) : (
        <button type="button" onClick={() => setShowInput(true)}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', borderRadius: '999px', backgroundColor: 'var(--admin-border)', color: 'var(--admin-text-muted)', fontSize: '13px', fontWeight: 700, border: 'none', cursor: 'pointer' }}>
          +
        </button>
      )}
    </div>
  );
}

interface McqFormState {
  questionText: string; options: string[]; correctAnswers: number[]; marks: number;
  isMultipleChoice: boolean; explanation: string; difficulty: 'easy' | 'medium' | 'hard'; topic: string; tags: string[];
}
interface CodingTestCase { input: string; expectedOutput: string; isHidden: boolean; marks: number }
interface CodingFormState {
  title: string; description: string; inputFormat: string; outputFormat: string; constraints: string;
  sampleInput: string; sampleOutput: string; marks: number; timeLimit: number; memoryLimit: number;
  supportedLanguages: string[]; codeTemplates: Record<string, string>; partialScoring: boolean;
  testCases: CodingTestCase[]; difficulty: 'easy' | 'medium' | 'hard'; topic: string; tags: string[];
}
interface BehavioralFormState {
  title: string; description: string; expectedAnswer: string; marks: number;
  difficulty: 'easy' | 'medium' | 'hard'; topic: string; tags: string[];
}

export default function AgentNewQuestionModal({ allowedTypes, onClose, onCreated }: Props) {
  const [activeType, setActiveType] = useState<SuggestionType>(allowedTypes[0] ?? 'mcq');
  const [saving, setSaving] = useState(false);

  const [mcq, setMcq] = useState<McqFormState>({
    questionText: '', options: ['', '', '', ''], correctAnswers: [], marks: 5,
    isMultipleChoice: false, explanation: '', difficulty: 'easy', topic: '', tags: [],
  });
  const [coding, setCoding] = useState<CodingFormState>({
    title: '', description: '', inputFormat: '', outputFormat: '', constraints: '',
    sampleInput: '', sampleOutput: '', marks: 20, timeLimit: 2000, memoryLimit: 256,
    supportedLanguages: ['python', 'javascript'], codeTemplates: {}, partialScoring: false,
    testCases: [{ input: '', expectedOutput: '', isHidden: false, marks: 10 }],
    difficulty: 'medium', topic: '', tags: [],
  });
  const [behavioral, setBehavioral] = useState<BehavioralFormState>({
    title: '', description: '', expectedAnswer: '', marks: 5, difficulty: 'medium', topic: '', tags: [],
  });

  /* -- MCQ handlers -- */
  const setOpt = (i: number, v: string) => { const opts = [...mcq.options]; opts[i] = v; setMcq({ ...mcq, options: opts }); };
  const addOption = () => { if (mcq.options.length < 6) setMcq({ ...mcq, options: [...mcq.options, ''] }); };
  const removeOption = (i: number) => {
    if (mcq.options.length <= 2) return;
    const opts = mcq.options.filter((_, idx) => idx !== i);
    const correct = mcq.correctAnswers.filter(x => x !== i).map(x => x > i ? x - 1 : x);
    setMcq({ ...mcq, options: opts, correctAnswers: correct });
  };
  const toggleCorrect = (i: number) => {
    if (mcq.isMultipleChoice) {
      const next = mcq.correctAnswers.includes(i) ? mcq.correctAnswers.filter(x => x !== i) : [...mcq.correctAnswers, i];
      setMcq({ ...mcq, correctAnswers: next });
    } else {
      setMcq({ ...mcq, correctAnswers: [i] });
    }
  };

  const handleSubmitMcq = async () => {
    if (!mcq.questionText.trim()) { toast.error('Enter a question prompt'); return; }
    if (!Number.isFinite(mcq.marks) || mcq.marks <= 0) { toast.error('Marks must be greater than 0'); return; }
    const nonEmpty = mcq.options.filter(o => o.trim() !== '');
    if (nonEmpty.length < 2) { toast.error('At least 2 options required'); return; }
    const optionIsFilled = (index: number) => Boolean(mcq.options[index]?.trim());
    if (!mcq.correctAnswers.length || mcq.correctAnswers.some(index => !optionIsFilled(index))) {
      toast.error('Select a filled option as the correct answer');
      return;
    }
    setSaving(true);
    try {
      const { data } = await adminApi.createMCQ({ ...mcq, options: nonEmpty });
      const created = data.question;
      onCreated('mcq', created.id, { id: created.id, text: created.questionText, difficulty: created.difficulty, topic: created.topic });
      toast.success('MCQ question created');
      onClose();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create question');
    } finally { setSaving(false); }
  };

  /* -- Coding handlers -- */
  const toggleLanguage = (lang: string) => {
    if (coding.supportedLanguages.includes(lang)) {
      if (coding.supportedLanguages.length <= 1) { toast.error('At least one language is required'); return; }
      setCoding({ ...coding, supportedLanguages: coding.supportedLanguages.filter(l => l !== lang) });
    } else {
      setCoding({ ...coding, supportedLanguages: [...coding.supportedLanguages, lang] });
    }
  };
  const updateTemplate = (lang: string, template: string) => setCoding({ ...coding, codeTemplates: { ...coding.codeTemplates, [lang]: template } });
  const addTestCase = () => setCoding({ ...coding, testCases: [...coding.testCases, { input: '', expectedOutput: '', isHidden: true, marks: 10 }] });
  const removeTestCase = (i: number) => { if (coding.testCases.length > 1) setCoding({ ...coding, testCases: coding.testCases.filter((_, idx) => idx !== i) }); };
  const updateTestCase = (i: number, field: keyof CodingTestCase, value: string | boolean | number) => {
    const next = [...coding.testCases];
    next[i] = { ...next[i], [field]: value };
    setCoding({ ...coding, testCases: next });
  };

  const handleSubmitCoding = async () => {
    if (!coding.title.trim()) { toast.error('Title is required'); return; }
    if (!coding.description.trim()) { toast.error('Description is required'); return; }
    if (!coding.inputFormat.trim()) { toast.error('Input format is required'); return; }
    if (!coding.outputFormat.trim()) { toast.error('Output format is required'); return; }
    if (!coding.sampleInput.trim()) { toast.error('Sample input is required'); return; }
    if (!coding.sampleOutput.trim()) { toast.error('Sample output is required'); return; }
    if (!Number.isFinite(coding.marks) || coding.marks <= 0) { toast.error('Marks must be greater than 0'); return; }
    if (!Number.isFinite(coding.timeLimit) || coding.timeLimit <= 0) { toast.error('Time limit must be greater than 0'); return; }
    if (!Number.isFinite(coding.memoryLimit) || coding.memoryLimit <= 0) { toast.error('Memory limit must be greater than 0'); return; }
    if (!coding.supportedLanguages.length) { toast.error('At least one language is required'); return; }
    if (!coding.testCases.length) { toast.error('At least one test case is required'); return; }
    if (coding.testCases.some(tc => !tc.expectedOutput.trim() || !Number.isFinite(tc.marks) || tc.marks <= 0)) {
      toast.error('Each test case needs expected output and marks greater than 0');
      return;
    }
    setSaving(true);
    try {
      const { data } = await adminApi.createCoding({ ...coding });
      const created = data.question;
      onCreated('coding', created.id, { id: created.id, text: `${created.title}: ${created.description}`.slice(0, 200), difficulty: created.difficulty, topic: created.topic });
      toast.success('Coding question created');
      onClose();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create question');
    } finally { setSaving(false); }
  };

  /* -- Behavioral handlers -- */
  const handleSubmitBehavioral = async () => {
    if (!behavioral.title.trim()) { toast.error('Title is required'); return; }
    if (!behavioral.description.trim()) { toast.error('Description is required'); return; }
    if (!Number.isFinite(behavioral.marks) || behavioral.marks <= 0) { toast.error('Marks must be greater than 0'); return; }
    setSaving(true);
    try {
      const { data } = await adminApi.createCustomBehavioral(behavioral);
      const created = data.question;
      onCreated('behavioral', created.id, { id: created.id, text: `${created.title}: ${created.description}`.slice(0, 200), difficulty: created.difficulty, topic: created.topic });
      toast.success('Behavioral question created');
      onClose();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create question');
    } finally { setSaving(false); }
  };

  const handleSubmit = activeType === 'mcq' ? handleSubmitMcq : activeType === 'coding' ? handleSubmitCoding : handleSubmitBehavioral;

  return (
    <div className="ui-modal-backdrop" onClick={onClose}>
      <div className="ui-modal" style={{ maxWidth: '920px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--admin-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--admin-text)', margin: 0 }}>New Question</h3>
            <p style={{ fontSize: '12px', color: 'var(--admin-text-subtle)', margin: '2px 0 0' }}>Saved to your question library and added to this test, capped at the Step 2 limit.</p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--admin-text-subtle)', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        {allowedTypes.length > 1 && (
          <div style={{ padding: '14px 24px 0', display: 'flex', gap: '8px', flexShrink: 0 }}>
            {allowedTypes.map(type => (
              <button key={type} type="button" onClick={() => setActiveType(type)}
                style={{
                  padding: '7px 14px', borderRadius: '999px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  border: `1.5px solid ${activeType === type ? 'var(--admin-accent)' : 'var(--admin-border)'}`,
                  backgroundColor: activeType === type ? 'var(--admin-accent-soft)' : 'white',
                  color: activeType === type ? 'var(--admin-accent-hover)' : 'var(--admin-text-muted)',
                }}
              >
                {TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }}>

          {activeType === 'mcq' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={lbl}>Prompt <span style={{ color: '#EF4444' }}>*</span></label>
                <textarea value={mcq.questionText} onChange={e => setMcq({ ...mcq, questionText: e.target.value })} rows={3} style={{ ...inp, resize: 'vertical' }} placeholder="Type your question here…" />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--admin-text-muted)' }}>Answer options · select the correct one</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--admin-text-muted)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={mcq.isMultipleChoice}
                      onChange={e => setMcq({ ...mcq, isMultipleChoice: e.target.checked, correctAnswers: e.target.checked ? mcq.correctAnswers : mcq.correctAnswers.slice(0, 1) })}
                      style={{ accentColor: 'var(--admin-button-primary)' }} />
                    Multiple correct
                  </label>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {mcq.options.map((opt, i) => {
                    const isCorrect = mcq.correctAnswers.includes(i);
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '10px', border: `1.5px solid ${isCorrect ? 'var(--admin-accent)' : 'var(--admin-border)'}`, backgroundColor: isCorrect ? 'var(--admin-accent-soft)' : 'white' }}>
                        <button type="button" onClick={() => toggleCorrect(i)}
                          style={{ width: '18px', height: '18px', borderRadius: '999px', flexShrink: 0, border: `1.5px solid ${isCorrect ? 'var(--admin-accent)' : 'var(--admin-border)'}`, backgroundColor: isCorrect ? 'var(--admin-accent)' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          {isCorrect && <span style={{ width: '7px', height: '7px', borderRadius: '999px', backgroundColor: 'white' }} />}
                        </button>
                        <input type="text" value={opt} onChange={e => setOpt(i, e.target.value)} style={{ flex: 1, border: 'none', outline: 'none', fontSize: '13px', background: 'transparent' }} placeholder={`Option ${LETTERS[i]}`} />
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--admin-text-subtle)', flexShrink: 0 }}>{LETTERS[i]}</span>
                        {mcq.options.length > 2 && (
                          <button type="button" onClick={() => removeOption(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', flexShrink: 0 }}>
                            <Trash2 size={14} color="#D1D5DB" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {mcq.options.length < 6 && (
                  <button type="button" onClick={addOption} style={{ marginTop: '8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--admin-accent)', fontSize: '13px', fontWeight: 500 }}>+ Add option</button>
                )}
              </div>
              <div>
                <label style={lbl}>Explanation <span style={{ fontWeight: 400, color: 'var(--admin-text-subtle)' }}>(optional, shown in review)</span></label>
                <textarea value={mcq.explanation} onChange={e => setMcq({ ...mcq, explanation: e.target.value })} rows={2} style={{ ...inp, resize: 'vertical' }} placeholder="Explain why the correct answer is right…" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                <div><label style={lbl}>Category</label><input type="text" value={mcq.topic} onChange={e => setMcq({ ...mcq, topic: e.target.value })} style={inp} placeholder="e.g. APIs, Algorithms" /></div>
                <div><label style={lbl}>Points</label><input type="number" value={mcq.marks} onChange={e => setMcq({ ...mcq, marks: Number(e.target.value) })} style={inp} /></div>
                <div><label style={lbl}>Difficulty</label><DifficultyPicker value={mcq.difficulty} onChange={d => setMcq({ ...mcq, difficulty: d })} /></div>
              </div>
              <div><label style={lbl}>Tags</label><TagEditor tags={mcq.tags} onAdd={t => setMcq({ ...mcq, tags: [...mcq.tags, t] })} onRemove={t => setMcq({ ...mcq, tags: mcq.tags.filter(x => x !== t) })} /></div>
            </div>
          )}

          {activeType === 'coding' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div><label style={lbl}>Title <span style={{ color: '#EF4444' }}>*</span></label><input type="text" value={coding.title} onChange={e => setCoding({ ...coding, title: e.target.value })} style={inp} /></div>
              <div><label style={lbl}>Description <span style={{ color: '#EF4444' }}>*</span></label><textarea value={coding.description} onChange={e => setCoding({ ...coding, description: e.target.value })} rows={4} style={{ ...inp, resize: 'vertical' }} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div><label style={lbl}>Input Format <span style={{ color: '#EF4444' }}>*</span></label><textarea value={coding.inputFormat} onChange={e => setCoding({ ...coding, inputFormat: e.target.value })} rows={2} style={{ ...inp, resize: 'vertical' }} /></div>
                <div><label style={lbl}>Output Format <span style={{ color: '#EF4444' }}>*</span></label><textarea value={coding.outputFormat} onChange={e => setCoding({ ...coding, outputFormat: e.target.value })} rows={2} style={{ ...inp, resize: 'vertical' }} /></div>
              </div>
              <div><label style={lbl}>Constraints <span style={{ fontWeight: 400, color: 'var(--admin-text-subtle)' }}>(optional)</span></label><textarea value={coding.constraints} onChange={e => setCoding({ ...coding, constraints: e.target.value })} rows={2} style={{ ...inp, resize: 'vertical' }} placeholder="e.g., 1 <= N <= 1000" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div><label style={lbl}>Sample Input <span style={{ color: '#EF4444' }}>*</span></label><textarea value={coding.sampleInput} onChange={e => setCoding({ ...coding, sampleInput: e.target.value })} rows={2} style={{ ...inp, resize: 'vertical', fontFamily: 'monospace' }} /></div>
                <div><label style={lbl}>Sample Output <span style={{ color: '#EF4444' }}>*</span></label><textarea value={coding.sampleOutput} onChange={e => setCoding({ ...coding, sampleOutput: e.target.value })} rows={2} style={{ ...inp, resize: 'vertical', fontFamily: 'monospace' }} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '14px' }}>
                <div><label style={lbl}>Marks</label><input type="number" value={coding.marks} onChange={e => setCoding({ ...coding, marks: Number(e.target.value) })} style={inp} /></div>
                <div><label style={lbl}>Time Limit (ms)</label><input type="number" value={coding.timeLimit} onChange={e => setCoding({ ...coding, timeLimit: Number(e.target.value) })} style={inp} /></div>
                <div><label style={lbl}>Memory Limit (MB)</label><input type="number" value={coding.memoryLimit} onChange={e => setCoding({ ...coding, memoryLimit: Number(e.target.value) })} style={inp} /></div>
                <div><label style={lbl}>Difficulty</label><DifficultyPicker value={coding.difficulty} onChange={d => setCoding({ ...coding, difficulty: d })} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div><label style={lbl}>Topic <span style={{ fontWeight: 400, color: 'var(--admin-text-subtle)' }}>(optional)</span></label><input type="text" value={coding.topic} onChange={e => setCoding({ ...coding, topic: e.target.value })} style={inp} /></div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--admin-text-muted)', cursor: 'pointer', marginTop: '22px' }}>
                  <input type="checkbox" checked={coding.partialScoring} onChange={e => setCoding({ ...coding, partialScoring: e.target.checked })} style={{ accentColor: 'var(--admin-button-primary)' }} />
                  Enable partial scoring
                </label>
              </div>
              <div><label style={lbl}>Tags</label><TagEditor tags={coding.tags} onAdd={t => setCoding({ ...coding, tags: [...coding.tags, t] })} onRemove={t => setCoding({ ...coding, tags: coding.tags.filter(x => x !== t) })} /></div>
              <div>
                <label style={lbl}>Supported Languages</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {CODING_LANGUAGES.map(lang => {
                    const active = coding.supportedLanguages.includes(lang);
                    return (
                      <button key={lang} type="button" onClick={() => toggleLanguage(lang)}
                        style={{ padding: '6px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${active ? 'var(--admin-accent)' : 'var(--admin-border)'}`, backgroundColor: active ? 'var(--admin-accent-soft)' : 'white', color: active ? 'var(--admin-accent-hover)' : 'var(--admin-text-muted)' }}>
                        {lang}
                      </button>
                    );
                  })}
                </div>
              </div>
              {coding.supportedLanguages.length > 0 && (
                <div>
                  <label style={lbl}>Code Templates <span style={{ fontWeight: 400, color: 'var(--admin-text-subtle)' }}>(optional)</span></label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {coding.supportedLanguages.map(lang => (
                      <div key={lang}>
                        <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--admin-text-subtle)', margin: '0 0 4px', textTransform: 'uppercase' }}>{lang}</p>
                        <textarea value={coding.codeTemplates[lang] || ''} onChange={e => updateTemplate(lang, e.target.value)} rows={3} style={{ ...inp, resize: 'vertical', fontFamily: 'monospace' }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ ...lbl, marginBottom: 0 }}>Test Cases</label>
                  <button type="button" onClick={addTestCase} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--admin-accent)', fontSize: '13px', fontWeight: 500 }}>+ Add Test Case</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {coding.testCases.map((tc, i) => (
                    <div key={i} style={{ borderRadius: '10px', border: '1px solid var(--admin-border)', padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '8px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--admin-text-muted)', cursor: 'pointer' }}>
                          <input type="checkbox" checked={tc.isHidden} onChange={e => updateTestCase(i, 'isHidden', e.target.checked)} style={{ accentColor: 'var(--admin-button-primary)' }} />
                          Hidden
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>Marks</span>
                          <input type="number" value={tc.marks} onChange={e => updateTestCase(i, 'marks', Number(e.target.value))} style={{ ...inp, width: '70px', padding: '5px 8px' }} />
                        </div>
                        {coding.testCases.length > 1 && (
                          <button type="button" onClick={() => removeTestCase(i)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontSize: '12px', fontWeight: 500 }}>Remove</button>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <textarea value={tc.input} onChange={e => updateTestCase(i, 'input', e.target.value)} rows={2} style={{ ...inp, resize: 'vertical', fontFamily: 'monospace' }} placeholder="Input" />
                        <textarea value={tc.expectedOutput} onChange={e => updateTestCase(i, 'expectedOutput', e.target.value)} rows={2} style={{ ...inp, resize: 'vertical', fontFamily: 'monospace' }} placeholder="Expected output" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeType === 'behavioral' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div><label style={lbl}>Title <span style={{ color: '#EF4444' }}>*</span></label><input type="text" value={behavioral.title} onChange={e => setBehavioral({ ...behavioral, title: e.target.value })} style={inp} placeholder="Short scenario title" /></div>
              <div><label style={lbl}>Description <span style={{ color: '#EF4444' }}>*</span></label><textarea value={behavioral.description} onChange={e => setBehavioral({ ...behavioral, description: e.target.value })} rows={4} style={{ ...inp, resize: 'vertical' }} placeholder="The full question/prompt shown to the candidate" /></div>
              <div>
                <label style={lbl}>Expected Answer <span style={{ fontWeight: 400, color: 'var(--admin-text-subtle)' }}>(optional)</span></label>
                <textarea value={behavioral.expectedAnswer} onChange={e => setBehavioral({ ...behavioral, expectedAnswer: e.target.value })} rows={3} style={{ ...inp, resize: 'vertical' }} placeholder="Used as a benchmark during review. Not shown to candidates." />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                <div><label style={lbl}>Category</label><input type="text" value={behavioral.topic} onChange={e => setBehavioral({ ...behavioral, topic: e.target.value })} style={inp} /></div>
                <div><label style={lbl}>Points</label><input type="number" value={behavioral.marks} onChange={e => setBehavioral({ ...behavioral, marks: Number(e.target.value) })} style={inp} /></div>
                <div><label style={lbl}>Difficulty</label><DifficultyPicker value={behavioral.difficulty} onChange={d => setBehavioral({ ...behavioral, difficulty: d })} /></div>
              </div>
              <div><label style={lbl}>Tags</label><TagEditor tags={behavioral.tags} onAdd={t => setBehavioral({ ...behavioral, tags: [...behavioral.tags, t] })} onRemove={t => setBehavioral({ ...behavioral, tags: behavioral.tags.filter(x => x !== t) })} /></div>
            </div>
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--admin-border)', display: 'flex', gap: '10px', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button type="button" onClick={onClose} style={{ padding: '9px 18px', borderRadius: '8px', border: '1px solid var(--admin-border)', backgroundColor: 'white', fontSize: '14px', fontWeight: 500, color: 'var(--admin-text)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={saving}
            style={{ padding: '9px 20px', borderRadius: '8px', border: '1px solid var(--admin-accent)', backgroundColor: saving ? 'var(--admin-accent-disabled)' : 'var(--admin-accent)', color: 'white', fontSize: '14px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : 'Create question'}
          </button>
        </div>
      </div>
    </div>
  );
}

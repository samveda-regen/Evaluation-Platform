import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { Check, Info } from 'lucide-react';
import BackButton from '../../components/BackButton';

type Difficulty = 'easy' | 'medium' | 'hard';

export default function BehavioralForm() {
  const navigate = useNavigate();
  const { questionId } = useParams<{ questionId: string }>();
  const location = useLocation();
  const isEditing = Boolean(questionId);
  const routeState = location.state as {
    question?: Record<string, unknown>;
    returnTo?: string;
    activeCategory?: string;
    addToTestId?: string;
  } | null;
  const editQuestion = routeState?.question;
  const editSource = editQuestion?.source === 'QUESTION_BANK' ? 'QUESTION_BANK' : 'CUSTOM';
  const returnTo = routeState?.returnTo ?? '/admin/repository/question-bank';
  const returnCategory = routeState?.activeCategory ?? (editSource === 'CUSTOM' ? 'CUSTOM' : 'all');
  const addToTestId = routeState?.addToTestId;
  const finishNavigation = () => {
    navigate(returnTo, {
      state: returnTo.includes('/admin/repository/question-bank')
        ? { activeCategory: returnCategory }
        : undefined,
    });
  };

  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    expectedAnswer: '',
    marks: 5,
    difficulty: 'medium' as Difficulty,
    topic: '',
    tags: [] as string[],
  });
  const [tagInput, setTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);

  useEffect(() => {
    if (isEditing && editQuestion) {
      setFormData({
        title: typeof editQuestion.title === 'string' ? editQuestion.title : '',
        description: typeof editQuestion.description === 'string' ? editQuestion.description : '',
        expectedAnswer: typeof editQuestion.expectedAnswer === 'string' ? editQuestion.expectedAnswer : '',
        marks: typeof editQuestion.marks === 'number' ? editQuestion.marks : 5,
        difficulty: editQuestion.difficulty === 'easy' || editQuestion.difficulty === 'hard' ? editQuestion.difficulty : 'medium',
        topic: typeof editQuestion.topic === 'string' ? editQuestion.topic : '',
        tags: Array.isArray(editQuestion.tags) ? editQuestion.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t) { setShowTagInput(false); return; }
    if (!/^[a-z0-9][a-z0-9_\- ]*$/.test(t)) { toast.error('Tags: letters, numbers, hyphens only'); return; }
    if (!formData.tags.includes(t)) setFormData({ ...formData, tags: [...formData.tags, t] });
    setTagInput(''); setShowTagInput(false);
  };
  const removeTag = (tag: string) =>
    setFormData({ ...formData, tags: formData.tags.filter(t => t !== tag) });

  const handleSubmit = async () => {
    if (!formData.title.trim()) { toast.error('Title is required'); return; }
    if (addToTestId && !formData.description.trim()) { toast.error('Description is required'); return; }
    if (!Number.isFinite(formData.marks) || formData.marks <= 0) { toast.error('Marks must be greater than 0'); return; }
    setLoading(true);
    try {
      if (isEditing && questionId) {
        if (editSource === 'QUESTION_BANK') {
          await adminApi.updateQuestionBankBehavioral(questionId, formData);
        } else {
          await adminApi.updateCustomBehavioral(questionId, formData);
        }
        toast.success('Question updated');
        finishNavigation();
      } else {
        if (addToTestId) {
          await adminApi.addCustomQuestionToTest(addToTestId, {
            questionType: 'behavioral',
            ...formData,
          });
        } else {
          await adminApi.createCustomBehavioral(formData);
        }
        toast.success(addToTestId ? 'Question created and added to test' : 'Question created');
        finishNavigation();
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to save question');
    } finally { setLoading(false); }
  };

  const diffStyle = (d: Difficulty): React.CSSProperties => {
    const active = formData.difficulty === d;
    if (!active) return { backgroundColor: '#F9FAFB', color: 'var(--admin-text-muted)', border: '1.5px solid var(--admin-border)' };
    return { backgroundColor: 'var(--admin-accent-soft)', color: 'var(--admin-accent-hover)', border: '1.5px solid var(--admin-accent)' };
  };

  const inputSx: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: '10px',
    border: '1.5px solid var(--admin-border)', fontSize: '14px', color: 'var(--admin-text)',
    outline: 'none', boxSizing: 'border-box', backgroundColor: 'white',
    resize: 'none',
  };

  return (
    <div style={{ backgroundColor: '#F9FAFB', minHeight: '100%' }}>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <BackButton onClick={finishNavigation} />
            <div>
              <h1 style={{ fontSize: "32px", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--admin-text)", margin: 0, lineHeight: 1.2 }}>
                {isEditing ? 'Edit Behavioral Question' : 'New Behavioral Question'}
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--admin-text-muted)' }}>
                Open-ended · evaluates soft skills & culture fit
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              onClick={finishNavigation}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="btn btn-primary"
            >
              <Check width={13} height={13} stroke="white" strokeWidth={2.5} />
              {loading ? 'Saving…' : isEditing ? 'Save changes' : 'Save question'}
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div
        className="max-w-6xl mx-auto"
        style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '24px', alignItems: 'start' }}
      >
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Question card */}
          <div className="rounded-2xl p-6" style={{ backgroundColor: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: 'var(--admin-text-subtle)' }}>QUESTION</p>

            <div className="mb-5">
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--admin-text-muted)' }}>
                Title <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                style={{ ...inputSx, resize: undefined }}
                placeholder="e.g. Describe a time you handled conflict in a team"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--admin-text-muted)' }}>
                Description / Prompt <span style={{ color: 'var(--admin-text-subtle)', fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                rows={4}
                style={inputSx}
                placeholder="Add context or clarifying instructions for the candidate…"
              />
            </div>
          </div>

          {/* Expected answer card */}
          <div className="rounded-2xl p-6" style={{ backgroundColor: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--admin-text-subtle)' }}>EXPECTED ANSWER</p>
            <p className="text-xs mb-4" style={{ color: 'var(--admin-text-subtle)' }}>Used as a benchmark during review. Not shown to candidates.</p>
            <textarea
              value={formData.expectedAnswer}
              onChange={e => setFormData({ ...formData, expectedAnswer: e.target.value })}
              rows={5}
              style={inputSx}
              placeholder="Describe what a strong answer looks like…"
            />
          </div>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="rounded-2xl p-5" style={{ backgroundColor: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <p className="text-sm font-bold mb-5" style={{ color: 'var(--admin-text)' }}>Properties</p>

            {/* Category */}
            <div className="mb-4">
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--admin-text-muted)' }}>Category</label>
              <input
                type="text"
                value={formData.topic}
                onChange={e => setFormData({ ...formData, topic: e.target.value })}
                style={{ ...inputSx, resize: undefined }}
                placeholder="e.g. Leadership, Communication"
              />
            </div>

            {/* Difficulty */}
            <div className="mb-4">
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--admin-text-muted)' }}>Difficulty</label>
              <div className="flex gap-2">
                {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => (
                  <button
                    key={d} type="button"
                    onClick={() => setFormData({ ...formData, difficulty: d })}
                    className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all"
                    style={diffStyle(d)}
                  >
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Points */}
            <div className="mb-4">
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--admin-text-muted)' }}>Points</label>
              <input
                type="number"
                value={formData.marks}
                onChange={e => setFormData({ ...formData, marks: Number(e.target.value) })}
                style={{ ...inputSx, resize: undefined }}
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--admin-text-muted)' }}>Tags</label>
              <div className="flex flex-wrap gap-1.5">
                {formData.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: 'var(--admin-border)', color: 'var(--admin-text-muted)' }}>
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} style={{ color: 'var(--admin-text-subtle)', lineHeight: 1 }}>×</button>
                  </span>
                ))}
                {showTagInput ? (
                  <input
                    autoFocus type="text" value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); addTag(); }
                      if (e.key === 'Escape') { setShowTagInput(false); setTagInput(''); }
                    }}
                    onBlur={() => { addTag(); setShowTagInput(false); }}
                    className="px-2.5 py-1 text-xs rounded-full border outline-none"
                    style={{ borderColor: 'var(--admin-accent)', backgroundColor: 'white', width: '64px', color: 'var(--admin-text)' }}
                    placeholder="tag…"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowTagInput(true)}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-sm font-bold"
                    style={{ backgroundColor: 'var(--admin-border)', color: 'var(--admin-text-muted)' }}
                  >
                    +
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Tip panel */}
          <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--admin-accent-soft)', border: '1px solid var(--admin-accent-disabled)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Info width={14} height={14} stroke="var(--admin-accent)" strokeWidth={1.5} />
              <p className="text-sm font-bold" style={{ color: '#92400E' }}>Tip</p>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: '#78350F' }}>
              Use the STAR method (Situation, Task, Action, Result) to frame both the prompt and your expected answer benchmark.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

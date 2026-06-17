import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { ChevronRight, Check, Info } from 'lucide-react';
import BackButton from '../../components/BackButton';

type Difficulty = 'easy' | 'medium' | 'hard';

export default function BehavioralForm() {
  const navigate = useNavigate();
  const { questionId } = useParams<{ questionId: string }>();
  const location = useLocation();
  const isEditing = Boolean(questionId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editQuestion = (location.state as any)?.question;

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
        title: editQuestion.title ?? '',
        description: editQuestion.description ?? '',
        expectedAnswer: editQuestion.expectedAnswer ?? '',
        marks: editQuestion.marks ?? 5,
        difficulty: (editQuestion.difficulty as Difficulty) ?? 'medium',
        topic: editQuestion.topic ?? '',
        tags: Array.isArray(editQuestion.tags) ? editQuestion.tags : [],
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !formData.tags.includes(t)) {
      setFormData({ ...formData, tags: [...formData.tags, t] });
      setTagInput('');
      setShowTagInput(false);
    }
  };
  const removeTag = (tag: string) =>
    setFormData({ ...formData, tags: formData.tags.filter(t => t !== tag) });

  const handleSubmit = async () => {
    if (!formData.title.trim()) { toast.error('Title is required'); return; }
    setLoading(true);
    try {
      if (isEditing && questionId) {
        await adminApi.updateCustomBehavioral(questionId, formData);
        toast.success('Question updated');
        navigate(-1);
      } else {
        await adminApi.createCustomBehavioral(formData);
        toast.success('Question created');
        navigate('/admin/repository/custom');
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to save question');
    } finally { setLoading(false); }
  };

  const diffStyle = (d: Difficulty): React.CSSProperties => {
    const active = formData.difficulty === d;
    const colors: Record<Difficulty, { bg: string; color: string; border: string }> = {
      easy:   { bg: '#ECFDF5', color: '#059669', border: '#10B981' },
      medium: { bg: '#FEF3C7', color: '#D97706', border: '#F59E0B' },
      hard:   { bg: '#FEF2F2', color: '#DC2626', border: '#EF4444' },
    };
    if (!active) return { backgroundColor: '#F9FAFB', color: '#6B7280', border: '1.5px solid #E5E7EB' };
    return { backgroundColor: colors[d].bg, color: colors[d].color, border: `1.5px solid ${colors[d].border}` };
  };

  const inputSx: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: '10px',
    border: '1.5px solid #E5E7EB', fontSize: '14px', color: '#111827',
    outline: 'none', boxSizing: 'border-box', backgroundColor: 'white',
    resize: 'none',
  };

  return (
    <div style={{ backgroundColor: '#f4f6fb', margin: '-24px', minHeight: 'calc(100vh - 52px)' }}>

      {/* Header */}
      <div style={{ backgroundColor: 'white', borderBottom: '1px solid #F3F4F6' }} className="px-8 py-5">
        <div className="flex items-center gap-2 text-sm mb-4" style={{ color: '#9CA3AF' }}>
          <Link to="/admin/repository/question-bank" className="hover:underline" style={{ color: '#9CA3AF' }}>
            Question Library
          </Link>
          <ChevronRight width={12} height={12} stroke="#9CA3AF" strokeWidth={1.5} />
          <span style={{ color: '#374151' }}>Behavioral</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <BackButton />
            <div>
              <h1 className="text-2xl font-bold" style={{ color: '#111827' }}>
                {isEditing ? 'Edit Behavioral Question' : 'New Behavioral Question'}
              </h1>
              <p className="text-sm mt-1" style={{ color: '#6B7280' }}>
                Open-ended · evaluates soft skills & culture fit
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              onClick={() => navigate(-1)}
              className="px-5 py-2.5 rounded-xl border text-sm font-medium"
              style={{ borderColor: '#E5E7EB', color: '#374151', backgroundColor: 'white' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ backgroundColor: loading ? '#6EE7B7' : '#10B981' }}
            >
              <Check width={13} height={13} stroke="white" strokeWidth={2.5} />
              {loading ? 'Saving…' : isEditing ? 'Save changes' : 'Save question'}
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div
        className="max-w-6xl mx-auto px-8 py-6"
        style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '24px', alignItems: 'start' }}
      >
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Question card */}
          <div className="rounded-2xl p-6" style={{ backgroundColor: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: '#9CA3AF' }}>QUESTION</p>

            <div className="mb-5">
              <label className="block text-sm font-medium mb-2" style={{ color: '#374151' }}>
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
              <label className="block text-sm font-medium mb-2" style={{ color: '#374151' }}>
                Description / Prompt <span style={{ color: '#9CA3AF', fontWeight: 400 }}>(optional)</span>
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
            <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#9CA3AF' }}>EXPECTED ANSWER</p>
            <p className="text-xs mb-4" style={{ color: '#9CA3AF' }}>Used as a benchmark during review. Not shown to candidates.</p>
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
            <p className="text-sm font-bold mb-5" style={{ color: '#111827' }}>Properties</p>

            {/* Category */}
            <div className="mb-4">
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: '#6B7280' }}>Category</label>
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
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: '#6B7280' }}>Difficulty</label>
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
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: '#6B7280' }}>Points</label>
              <input
                type="number" min={1}
                value={formData.marks}
                onChange={e => setFormData({ ...formData, marks: Number(e.target.value) })}
                style={{ ...inputSx, resize: undefined }}
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: '#6B7280' }}>Tags</label>
              <div className="flex flex-wrap gap-1.5">
                {formData.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: '#F3F4F6', color: '#374151' }}>
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} style={{ color: '#9CA3AF', lineHeight: 1 }}>×</button>
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
                    style={{ borderColor: '#10B981', backgroundColor: 'white', width: '64px', color: '#111827' }}
                    placeholder="tag…"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowTagInput(true)}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-sm font-bold"
                    style={{ backgroundColor: '#F3F4F6', color: '#6B7280' }}
                  >
                    +
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Tip panel */}
          <div className="rounded-2xl p-5" style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
            <div className="flex items-center gap-2 mb-1">
              <Info width={14} height={14} stroke="#F59E0B" strokeWidth={1.5} />
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

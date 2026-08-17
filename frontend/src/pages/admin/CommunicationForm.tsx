import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { Check, Info, Upload } from 'lucide-react';
import BackButton from '../../components/BackButton';
import type { CommunicationSubType, WrittenStimulusType } from '../../types';

interface MediaAsset {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  storageUrl: string;
  mediaType: 'image' | 'video' | 'audio';
  width?: number;
  height?: number;
  duration?: number;
}

type Difficulty = 'easy' | 'medium' | 'hard';

const SUB_TYPES: { value: CommunicationSubType; label: string; blurb: string; ready: boolean }[] = [
  { value: 'WRITTEN', label: 'Written', blurb: 'Candidate types a response to a prompt — graded by AI on grammar, wording, and coherence.', ready: true },
  { value: 'LISTENING', label: 'Listening', blurb: 'Audio-based multiple choice — coming soon.', ready: false },
  { value: 'READING', label: 'Reading', blurb: 'Passage-based multiple choice — coming soon.', ready: false },
  { value: 'SPEAKING', label: 'Speaking', blurb: 'Recorded spoken response, AI-transcribed and graded — coming soon.', ready: false },
];

export default function CommunicationForm() {
  const navigate = useNavigate();
  const { questionId } = useParams<{ questionId: string }>();
  const location = useLocation();
  const isEditing = Boolean(questionId);
  const routeState = location.state as {
    question?: Record<string, unknown>;
    returnTo?: string;
    activeCategory?: string;
  } | null;
  const editQuestion = routeState?.question;
  const editSource = editQuestion?.source === 'QUESTION_BANK' ? 'QUESTION_BANK' : 'CUSTOM';
  const returnTo = routeState?.returnTo ?? '/admin/repository/question-bank';
  const returnCategory = routeState?.activeCategory ?? (editSource === 'CUSTOM' ? 'CUSTOM' : 'all');
  const finishNavigation = () => {
    navigate(returnTo, {
      state: returnTo.includes('/admin/repository/question-bank')
        ? { activeCategory: returnCategory }
        : undefined,
    });
  };

  const [loading, setLoading] = useState(false);
  const [subType, setSubType] = useState<CommunicationSubType>(
    (editQuestion?.subType as CommunicationSubType) || 'WRITTEN'
  );

  // Written-only fields
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    evaluationNotes: '',
    stimulusType: 'NONE' as WrittenStimulusType,
    marks: 10,
    difficulty: 'medium' as Difficulty,
    topic: '',
    tags: [] as string[],
  });
  const [tagInput, setTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && editQuestion) {
      setFormData({
        title: typeof editQuestion.title === 'string' ? editQuestion.title : '',
        description: typeof editQuestion.description === 'string' ? editQuestion.description : '',
        evaluationNotes: typeof editQuestion.evaluationNotes === 'string' ? editQuestion.evaluationNotes : '',
        stimulusType: editQuestion.stimulusType === 'IMAGE' || editQuestion.stimulusType === 'AUDIO' ? editQuestion.stimulusType : 'NONE',
        marks: typeof editQuestion.marks === 'number' ? editQuestion.marks : 10,
        difficulty: editQuestion.difficulty === 'easy' || editQuestion.difficulty === 'hard' ? editQuestion.difficulty : 'medium',
        topic: typeof editQuestion.topic === 'string' ? editQuestion.topic : '',
        tags: Array.isArray(editQuestion.tags) ? editQuestion.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --- Media helpers (mirrors MCQForm.tsx's pattern) --- */
  const loadImage = (file: File): Promise<HTMLImageElement> =>
    new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploadingMedia(true);
    try {
      const file = files[0];
      const allowedTypes = formData.stimulusType === 'AUDIO'
        ? ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm']
        : ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        toast.error(formData.stimulusType === 'AUDIO' ? 'Please upload an audio file' : 'Please upload an image file');
        return;
      }
      const maxSize = formData.stimulusType === 'AUDIO' ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
      if (file.size > maxSize) { toast.error(`Too large: ${file.name}`); return; }

      const reader = new FileReader();
      const b64 = await new Promise<string>((res, rej) => {
        reader.onload = () => res((reader.result as string).split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      let width: number | undefined, height: number | undefined;
      if (file.type.startsWith('image/')) { const img = await loadImage(file); width = img.width; height = img.height; }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const uploadPayload: any = { file: { data: b64, mimeType: file.type, originalName: file.name, width, height } };
      const { data } = await adminApi.uploadMedia(uploadPayload);
      if (data.success && data.asset) {
        setMediaAssets([data.asset]); // Written stimulus is a single asset
        toast.success(`Uploaded ${file.name}`);
      }
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Upload failed');
    } finally {
      setUploadingMedia(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteMedia = async (id: string) => {
    try { await adminApi.deleteMedia(id); setMediaAssets(p => p.filter(a => a.id !== id)); toast.success('Removed'); }
    catch { toast.error('Remove failed'); }
  };

  /* --- Tag handlers --- */
  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t) { setShowTagInput(false); return; }
    if (!/^[a-z0-9][a-z0-9_\- ]*$/.test(t)) { toast.error('Tags: letters, numbers, hyphens only'); return; }
    if (!formData.tags.includes(t)) setFormData({ ...formData, tags: [...formData.tags, t] });
    setTagInput(''); setShowTagInput(false);
  };
  const removeTag = (t: string) => setFormData({ ...formData, tags: formData.tags.filter(x => x !== t) });

  /* --- Submit (Written only for now) --- */
  const handleSubmit = async () => {
    if (subType !== 'WRITTEN') { toast.error('This question type is coming soon'); return; }
    if (!formData.title.trim()) { toast.error('Title is required'); return; }
    if (!formData.description.trim()) { toast.error('Description/prompt is required — the AI uses it to evaluate the candidate\'s answer'); return; }
    if (!Number.isFinite(formData.marks) || formData.marks <= 0) { toast.error('Marks must be greater than 0'); return; }

    setLoading(true);
    try {
      const payload = { subType, ...formData };
      if (isEditing && questionId) {
        if (editSource === 'QUESTION_BANK') {
          await adminApi.updateQuestionBankCommunication(questionId, payload);
        } else {
          await adminApi.updateCustomCommunication(questionId, payload);
        }
        if (mediaAssets.length) await adminApi.assignMediaToQuestion(questionId, mediaAssets.map(a => a.id), 'communication');
        toast.success('Question updated');
        finishNavigation();
      } else {
        const res = await adminApi.createCustomCommunication(payload);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const id: string | undefined = (res?.data as any)?.question?.id;
        if (id && mediaAssets.length) await adminApi.assignMediaToQuestion(id, mediaAssets.map(a => a.id), 'communication');
        toast.success('Question created');
        finishNavigation();
      }
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Save failed');
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
              <h1 style={{ fontSize: '32px', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--admin-text)', margin: 0, lineHeight: 1.2 }}>
                {isEditing ? 'Edit Communication Question' : 'New Communication Question'}
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--admin-text-muted)' }}>
                Written · Listening · Reading · Speaking
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button onClick={finishNavigation} className="btn btn-secondary">Cancel</button>
            <button onClick={handleSubmit} disabled={loading || subType !== 'WRITTEN'} className="btn btn-primary">
              <Check width={13} height={13} stroke="white" strokeWidth={2.5} />
              {loading ? 'Saving…' : isEditing ? 'Save changes' : 'Save question'}
            </button>
          </div>
        </div>
      </div>

      {/* Sub-type selector */}
      {!isEditing && (
        <div className="max-w-6xl mx-auto mb-6">
          <div className="rounded-2xl p-5" style={{ backgroundColor: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <p className="text-sm font-bold mb-3" style={{ color: 'var(--admin-text)' }}>Category</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
              {SUB_TYPES.map(st => {
                const active = subType === st.value;
                return (
                  <button
                    key={st.value} type="button"
                    onClick={() => setSubType(st.value)}
                    disabled={!st.ready}
                    className="text-left rounded-xl p-4 transition-all"
                    style={{
                      border: `1.5px solid ${active ? 'var(--admin-accent)' : 'var(--admin-border)'}`,
                      backgroundColor: active ? 'var(--admin-accent-soft)' : 'white',
                      opacity: st.ready ? 1 : 0.55,
                      cursor: st.ready ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <p className="text-sm font-bold" style={{ color: active ? 'var(--admin-accent-hover)' : 'var(--admin-text)' }}>
                      {st.label}{!st.ready && <span style={{ fontSize: '11px', fontWeight: 500, marginLeft: '6px', color: 'var(--admin-text-subtle)' }}>Soon</span>}
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--admin-text-subtle)', lineHeight: '1.4' }}>{st.blurb}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {subType !== 'WRITTEN' ? (
        <div className="max-w-6xl mx-auto">
          <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <p className="text-sm" style={{ color: 'var(--admin-text-muted)' }}>
              {SUB_TYPES.find(s => s.value === subType)?.label} questions aren't available to create yet — select Written above, or check back soon.
            </p>
          </div>
        </div>
      ) : (

      /* Body */
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
                placeholder="e.g. Describe your ideal work environment"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--admin-text-muted)' }}>
                Description / Prompt <span style={{ color: '#EF4444' }}>*</span>
                <span style={{ color: 'var(--admin-text-subtle)', fontWeight: 400 }}> — the AI evaluates the candidate's answer against this</span>
              </label>
              <textarea
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                rows={5}
                style={inputSx}
                placeholder="Write the full prompt shown to the candidate…"
              />
            </div>

            {/* Stimulus */}
            <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--admin-border)' }}>
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--admin-text-muted)' }}>
                Stimulus <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional — show the candidate an image or audio clip alongside the prompt)</span>
              </label>
              <div className="flex gap-2 mb-3">
                {(['NONE', 'IMAGE', 'AUDIO'] as WrittenStimulusType[]).map(st => (
                  <button
                    key={st} type="button"
                    onClick={() => { setFormData({ ...formData, stimulusType: st }); setMediaAssets([]); }}
                    className="px-4 py-2 rounded-xl text-xs font-semibold transition-all"
                    style={formData.stimulusType === st
                      ? { backgroundColor: 'var(--admin-accent-soft)', color: 'var(--admin-accent-hover)', border: '1.5px solid var(--admin-accent)' }
                      : { backgroundColor: '#F9FAFB', color: 'var(--admin-text-muted)', border: '1.5px solid var(--admin-border)' }}
                  >
                    {st === 'NONE' ? 'None' : st === 'IMAGE' ? 'Image' : 'Audio'}
                  </button>
                ))}
              </div>

              {formData.stimulusType !== 'NONE' && (
                <div>
                  <input ref={fileInputRef} type="file"
                    accept={formData.stimulusType === 'AUDIO' ? 'audio/*' : 'image/*'}
                    onChange={handleFileSelect} className="hidden" />
                  {uploadingMedia && <p className="text-xs mb-2" style={{ color: 'var(--admin-text-muted)' }}>Uploading…</p>}
                  {mediaAssets.length === 0 ? (
                    <div onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed rounded-xl p-5 text-center cursor-pointer"
                      style={{ borderColor: 'var(--admin-border)', backgroundColor: '#FAFAFA' }}>
                      <Upload width={16} height={16} strokeWidth={1.5} style={{ margin: '0 auto 6px', color: 'var(--admin-text-subtle)' }} />
                      <p className="text-sm" style={{ color: 'var(--admin-text-subtle)' }}>
                        Click to upload {formData.stimulusType === 'AUDIO' ? 'an audio file' : 'an image'}
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border" style={{ borderColor: 'var(--admin-border)', backgroundColor: 'white' }}>
                      <span className="text-sm flex-1 truncate" style={{ color: 'var(--admin-text-muted)' }}>{mediaAssets[0].originalName}</span>
                      <span className="text-xs" style={{ color: 'var(--admin-text-subtle)' }}>{(mediaAssets[0].fileSize / 1024 / 1024).toFixed(1)} MB</span>
                      <button type="button" onClick={() => handleDeleteMedia(mediaAssets[0].id)} className="text-sm font-medium" style={{ color: '#DC2626' }}>Remove</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Evaluation notes card */}
          <div className="rounded-2xl p-6" style={{ backgroundColor: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--admin-text-subtle)' }}>EVALUATION NOTES</p>
            <p className="text-xs mb-4" style={{ color: 'var(--admin-text-subtle)' }}>Optional extra grading guidance for the AI, beyond the prompt above. Not shown to candidates.</p>
            <textarea
              value={formData.evaluationNotes}
              onChange={e => setFormData({ ...formData, evaluationNotes: e.target.value })}
              rows={4}
              style={inputSx}
              placeholder="e.g. Focus on grammar and vocabulary range; length is not a factor…"
            />
          </div>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="rounded-2xl p-5" style={{ backgroundColor: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <p className="text-sm font-bold mb-5" style={{ color: 'var(--admin-text)' }}>Properties</p>

            <div className="mb-4">
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--admin-text-muted)' }}>Category</label>
              <input
                type="text"
                value={formData.topic}
                onChange={e => setFormData({ ...formData, topic: e.target.value })}
                style={{ ...inputSx, resize: undefined }}
                placeholder="e.g. Business Writing"
              />
            </div>

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

            <div className="mb-4">
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--admin-text-muted)' }}>Points</label>
              <input
                type="number"
                value={formData.marks}
                onChange={e => setFormData({ ...formData, marks: Number(e.target.value) })}
                style={{ ...inputSx, resize: undefined }}
              />
            </div>

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
              Title and description are compulsory — the AI grader only has these (plus your evaluation notes) as its reference when scoring the candidate's typed answer.
            </p>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

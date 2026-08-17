import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { Check, Info, Upload, Trash2 } from 'lucide-react';
import BackButton from '../../components/BackButton';
import GuardedAudioPlayer from '../../components/GuardedAudioPlayer';
import type { CommunicationSubType, WrittenStimulusType } from '../../types';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

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
  { value: 'LISTENING', label: 'Listening', blurb: 'Candidate listens to an audio clip and answers multiple choice — auto-scored, with playback guardrails.', ready: true },
  { value: 'READING', label: 'Reading', blurb: 'Candidate reads a shared passage and answers multiple choice — auto-scored.', ready: true },
  { value: 'SPEAKING', label: 'Speaking', blurb: 'Recorded spoken response, AI-transcribed and graded — coming soon.', ready: false },
];
const READY_SUB_TYPES: CommunicationSubType[] = ['WRITTEN', 'LISTENING', 'READING'];

interface ReadingPassage {
  id: string;
  title: string;
  passageText: string;
}

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
  // Listening-only fields
  const [listeningData, setListeningData] = useState({
    description: '',
    options: ['', '', '', ''],
    correctAnswers: [] as number[],
    isMultipleChoice: false,
    explanation: '',
    replayLimit: 1,
    allowRewind: true,
    allowSpeedChange: true,
    fixedPlaybackSpeed: 1,
  });
  // Reading-only fields
  const [readingData, setReadingData] = useState({
    description: '',
    passageId: '',
    options: ['', '', '', ''],
    correctAnswers: [] as number[],
    isMultipleChoice: false,
    explanation: '',
  });
  const [passages, setPassages] = useState<ReadingPassage[]>([]);
  const [loadingPassages, setLoadingPassages] = useState(false);
  const [showNewPassage, setShowNewPassage] = useState(false);
  const [newPassageTitle, setNewPassageTitle] = useState('');
  const [newPassageText, setNewPassageText] = useState('');
  const [savingPassage, setSavingPassage] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAudioUpload = subType === 'LISTENING' || (subType === 'WRITTEN' && formData.stimulusType === 'AUDIO');

  useEffect(() => {
    if (isEditing && editQuestion) {
      setFormData({
        title: typeof editQuestion.title === 'string' ? editQuestion.title : '',
        description: editQuestion.subType === 'WRITTEN' && typeof editQuestion.description === 'string' ? editQuestion.description : '',
        evaluationNotes: typeof editQuestion.evaluationNotes === 'string' ? editQuestion.evaluationNotes : '',
        stimulusType: editQuestion.stimulusType === 'IMAGE' || editQuestion.stimulusType === 'AUDIO' ? editQuestion.stimulusType : 'NONE',
        marks: typeof editQuestion.marks === 'number' ? editQuestion.marks : 10,
        difficulty: editQuestion.difficulty === 'easy' || editQuestion.difficulty === 'hard' ? editQuestion.difficulty : 'medium',
        topic: typeof editQuestion.topic === 'string' ? editQuestion.topic : '',
        tags: Array.isArray(editQuestion.tags) ? editQuestion.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      });
      if (editQuestion.subType === 'LISTENING') {
        setListeningData({
          description: typeof editQuestion.description === 'string' ? editQuestion.description : '',
          options: Array.isArray(editQuestion.options) && editQuestion.options.length >= 2
            ? editQuestion.options.filter((o): o is string => typeof o === 'string')
            : ['', '', '', ''],
          correctAnswers: Array.isArray(editQuestion.correctAnswers)
            ? editQuestion.correctAnswers.filter((a): a is number => typeof a === 'number')
            : [],
          isMultipleChoice: typeof editQuestion.isMultipleChoice === 'boolean' ? editQuestion.isMultipleChoice : false,
          explanation: typeof editQuestion.explanation === 'string' ? editQuestion.explanation : '',
          replayLimit: typeof editQuestion.replayLimit === 'number' ? editQuestion.replayLimit : 1,
          allowRewind: typeof editQuestion.allowRewind === 'boolean' ? editQuestion.allowRewind : true,
          allowSpeedChange: typeof editQuestion.allowSpeedChange === 'boolean' ? editQuestion.allowSpeedChange : true,
          fixedPlaybackSpeed: typeof editQuestion.fixedPlaybackSpeed === 'number' ? editQuestion.fixedPlaybackSpeed : 1,
        });
      }
      if (editQuestion.subType === 'READING') {
        const passage = editQuestion.passage as { id: string } | null | undefined;
        setReadingData({
          description: typeof editQuestion.description === 'string' ? editQuestion.description : '',
          passageId: passage?.id ?? (typeof editQuestion.passageId === 'string' ? editQuestion.passageId : ''),
          options: Array.isArray(editQuestion.options) && editQuestion.options.length >= 2
            ? editQuestion.options.filter((o): o is string => typeof o === 'string')
            : ['', '', '', ''],
          correctAnswers: Array.isArray(editQuestion.correctAnswers)
            ? editQuestion.correctAnswers.filter((a): a is number => typeof a === 'number')
            : [],
          isMultipleChoice: typeof editQuestion.isMultipleChoice === 'boolean' ? editQuestion.isMultipleChoice : false,
          explanation: typeof editQuestion.explanation === 'string' ? editQuestion.explanation : '',
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoadingPassages(true);
    adminApi.getReadingPassages()
      .then(({ data }) => setPassages(data.passages || []))
      .catch(() => toast.error('Failed to load reading passages'))
      .finally(() => setLoadingPassages(false));
  }, []);

  const handleCreatePassage = async () => {
    if (!newPassageTitle.trim() || !newPassageText.trim()) { toast.error('Title and passage text are required'); return; }
    setSavingPassage(true);
    try {
      const { data } = await adminApi.createReadingPassage({ title: newPassageTitle.trim(), passageText: newPassageText.trim() });
      setPassages(prev => [data.passage, ...prev]);
      setReadingData(prev => ({ ...prev, passageId: data.passage.id }));
      setShowNewPassage(false);
      setNewPassageTitle('');
      setNewPassageText('');
      toast.success('Passage created');
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create passage');
    } finally { setSavingPassage(false); }
  };

  /* --- Media helpers (mirrors MCQForm.tsx's pattern) --- */
  const loadImage = (file: File): Promise<HTMLImageElement> =>
    new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploadingMedia(true);
    try {
      const file = files[0];
      const allowedTypes = isAudioUpload
        ? ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm']
        : ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        toast.error(isAudioUpload ? 'Please upload an audio file' : 'Please upload an image file');
        return;
      }
      const maxSize = isAudioUpload ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
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

  /* --- Listening option handlers (mirrors MCQForm's pattern) --- */
  const setListeningOpt = (i: number, v: string) => {
    const opts = [...listeningData.options]; opts[i] = v; setListeningData({ ...listeningData, options: opts });
  };
  const addListeningOption = () => {
    if (listeningData.options.length < 6) setListeningData({ ...listeningData, options: [...listeningData.options, ''] });
  };
  const removeListeningOption = (i: number) => {
    if (listeningData.options.length <= 2) return;
    const opts = listeningData.options.filter((_, idx) => idx !== i);
    const correct = listeningData.correctAnswers.filter(x => x !== i).map(x => x > i ? x - 1 : x);
    setListeningData({ ...listeningData, options: opts, correctAnswers: correct });
  };
  const toggleListeningCorrect = (i: number) => {
    if (listeningData.isMultipleChoice) {
      const next = listeningData.correctAnswers.includes(i)
        ? listeningData.correctAnswers.filter(x => x !== i)
        : [...listeningData.correctAnswers, i];
      setListeningData({ ...listeningData, correctAnswers: next });
    } else {
      setListeningData({ ...listeningData, correctAnswers: [i] });
    }
  };

  /* --- Reading option handlers (mirrors MCQForm's pattern) --- */
  const setReadingOpt = (i: number, v: string) => {
    const opts = [...readingData.options]; opts[i] = v; setReadingData({ ...readingData, options: opts });
  };
  const addReadingOption = () => {
    if (readingData.options.length < 6) setReadingData({ ...readingData, options: [...readingData.options, ''] });
  };
  const removeReadingOption = (i: number) => {
    if (readingData.options.length <= 2) return;
    const opts = readingData.options.filter((_, idx) => idx !== i);
    const correct = readingData.correctAnswers.filter(x => x !== i).map(x => x > i ? x - 1 : x);
    setReadingData({ ...readingData, options: opts, correctAnswers: correct });
  };
  const toggleReadingCorrect = (i: number) => {
    if (readingData.isMultipleChoice) {
      const next = readingData.correctAnswers.includes(i)
        ? readingData.correctAnswers.filter(x => x !== i)
        : [...readingData.correctAnswers, i];
      setReadingData({ ...readingData, correctAnswers: next });
    } else {
      setReadingData({ ...readingData, correctAnswers: [i] });
    }
  };

  /* --- Submit --- */
  const handleSubmit = async () => {
    if (!READY_SUB_TYPES.includes(subType)) { toast.error('This question type is coming soon'); return; }
    if (!formData.title.trim()) { toast.error('Title is required'); return; }
    if (!Number.isFinite(formData.marks) || formData.marks <= 0) { toast.error('Marks must be greater than 0'); return; }

    let payload: Record<string, unknown>;
    if (subType === 'WRITTEN') {
      if (!formData.description.trim()) { toast.error('Description/prompt is required — the AI uses it to evaluate the candidate\'s answer'); return; }
      payload = { subType, ...formData };
    } else if (subType === 'LISTENING') {
      const nonEmpty = listeningData.options.filter(o => o.trim() !== '');
      if (nonEmpty.length < 2) { toast.error('At least 2 options required'); return; }
      const optionIsFilled = (index: number) => Boolean(listeningData.options[index]?.trim());
      if (!listeningData.correctAnswers.length || listeningData.correctAnswers.some(index => !optionIsFilled(index))) {
        toast.error('Select a filled option as the correct answer');
        return;
      }
      if (!mediaAssets.length) { toast.error('Upload an audio clip for the candidate to listen to'); return; }
      payload = {
        subType,
        title: formData.title,
        marks: formData.marks,
        difficulty: formData.difficulty,
        topic: formData.topic,
        tags: formData.tags,
        description: listeningData.description,
        options: nonEmpty,
        correctAnswers: listeningData.correctAnswers,
        explanation: listeningData.explanation,
        isMultipleChoice: listeningData.isMultipleChoice,
        replayLimit: listeningData.replayLimit,
        allowRewind: listeningData.allowRewind,
        allowSpeedChange: listeningData.allowSpeedChange,
        fixedPlaybackSpeed: listeningData.fixedPlaybackSpeed,
      };
    } else {
      // READING
      if (!readingData.passageId) { toast.error('Select or create a reading passage'); return; }
      const nonEmpty = readingData.options.filter(o => o.trim() !== '');
      if (nonEmpty.length < 2) { toast.error('At least 2 options required'); return; }
      const optionIsFilled = (index: number) => Boolean(readingData.options[index]?.trim());
      if (!readingData.correctAnswers.length || readingData.correctAnswers.some(index => !optionIsFilled(index))) {
        toast.error('Select a filled option as the correct answer');
        return;
      }
      payload = {
        subType,
        title: formData.title,
        marks: formData.marks,
        difficulty: formData.difficulty,
        topic: formData.topic,
        tags: formData.tags,
        description: readingData.description,
        passageId: readingData.passageId,
        options: nonEmpty,
        correctAnswers: readingData.correctAnswers,
        explanation: readingData.explanation,
        isMultipleChoice: readingData.isMultipleChoice,
      };
    }

    setLoading(true);
    try {
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
            <button onClick={handleSubmit} disabled={loading || !READY_SUB_TYPES.includes(subType)} className="btn btn-primary">
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

      {!READY_SUB_TYPES.includes(subType) ? (
        <div className="max-w-6xl mx-auto">
          <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <p className="text-sm" style={{ color: 'var(--admin-text-muted)' }}>
              {SUB_TYPES.find(s => s.value === subType)?.label} questions aren't available to create yet — select another category above, or check back soon.
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
                placeholder={subType === 'WRITTEN' ? 'e.g. Describe your ideal work environment' : 'e.g. Client call — scheduling conflict'}
              />
            </div>

            {subType === 'WRITTEN' ? (
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
            ) : subType === 'LISTENING' ? (
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--admin-text-muted)' }}>
                  Instructions <span style={{ color: 'var(--admin-text-subtle)', fontWeight: 400 }}>(optional — shown above the audio player)</span>
                </label>
                <textarea
                  value={listeningData.description}
                  onChange={e => setListeningData({ ...listeningData, description: e.target.value })}
                  rows={3}
                  style={inputSx}
                  placeholder="e.g. Listen to the recording and choose the best answer…"
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--admin-text-muted)' }}>
                  Instructions <span style={{ color: 'var(--admin-text-subtle)', fontWeight: 400 }}>(optional — shown above the passage)</span>
                </label>
                <textarea
                  value={readingData.description}
                  onChange={e => setReadingData({ ...readingData, description: e.target.value })}
                  rows={3}
                  style={inputSx}
                  placeholder="e.g. Read the passage and choose the best answer…"
                />
              </div>
            )}

            {subType === 'WRITTEN' ? (
              /* Stimulus */
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
            ) : subType === 'LISTENING' ? (
              /* Audio clip (mandatory for Listening) */
              <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--admin-border)' }}>
                <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--admin-text-muted)' }}>
                  Audio clip <span style={{ color: '#EF4444', textTransform: 'none' }}>*</span>
                </label>
                <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileSelect} className="hidden" />
                {uploadingMedia && <p className="text-xs mb-2" style={{ color: 'var(--admin-text-muted)' }}>Uploading…</p>}
                {mediaAssets.length === 0 ? (
                  <div onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed rounded-xl p-5 text-center cursor-pointer"
                    style={{ borderColor: 'var(--admin-border)', backgroundColor: '#FAFAFA' }}>
                    <Upload width={16} height={16} strokeWidth={1.5} style={{ margin: '0 auto 6px', color: 'var(--admin-text-subtle)' }} />
                    <p className="text-sm" style={{ color: 'var(--admin-text-subtle)' }}>Click to upload an audio file</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border" style={{ borderColor: 'var(--admin-border)', backgroundColor: 'white' }}>
                      <span className="text-sm flex-1 truncate" style={{ color: 'var(--admin-text-muted)' }}>{mediaAssets[0].originalName}</span>
                      <span className="text-xs" style={{ color: 'var(--admin-text-subtle)' }}>{(mediaAssets[0].fileSize / 1024 / 1024).toFixed(1)} MB</span>
                      <button type="button" onClick={() => handleDeleteMedia(mediaAssets[0].id)} className="text-sm font-medium" style={{ color: '#DC2626' }}>Remove</button>
                    </div>
                    <GuardedAudioPlayer
                      src={mediaAssets[0].storageUrl}
                      replayLimit={listeningData.replayLimit}
                      allowRewind={listeningData.allowRewind}
                      allowSpeedChange={listeningData.allowSpeedChange}
                      fixedPlaybackSpeed={listeningData.fixedPlaybackSpeed}
                    />
                  </div>
                )}
              </div>
            ) : (
              /* Passage picker (mandatory for Reading) */
              <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--admin-border)' }}>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--admin-text-muted)' }}>
                    Passage <span style={{ color: '#EF4444', textTransform: 'none' }}>*</span>
                  </label>
                  <button type="button" onClick={() => setShowNewPassage(v => !v)} className="text-xs font-semibold" style={{ color: 'var(--admin-accent)' }}>
                    {showNewPassage ? 'Cancel' : '+ New passage'}
                  </button>
                </div>

                {showNewPassage ? (
                  <div className="space-y-3 mb-3 p-4 rounded-xl" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--admin-border)' }}>
                    <input
                      type="text" value={newPassageTitle}
                      onChange={e => setNewPassageTitle(e.target.value)}
                      style={{ ...inputSx, resize: undefined }}
                      placeholder="Passage title"
                    />
                    <textarea
                      value={newPassageText}
                      onChange={e => setNewPassageText(e.target.value)}
                      rows={6}
                      style={inputSx}
                      placeholder="Paste or write the full passage text…"
                    />
                    <button type="button" onClick={handleCreatePassage} disabled={savingPassage} className="btn btn-primary" style={{ width: 'auto' }}>
                      {savingPassage ? 'Saving…' : 'Save passage'}
                    </button>
                  </div>
                ) : (
                  <select
                    value={readingData.passageId}
                    onChange={e => setReadingData({ ...readingData, passageId: e.target.value })}
                    style={{ ...inputSx, resize: undefined }}
                    disabled={loadingPassages}
                  >
                    <option value="">{loadingPassages ? 'Loading passages…' : 'Select a passage…'}</option>
                    {passages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                )}

                {!showNewPassage && readingData.passageId && (
                  <div className="mt-3 p-3 rounded-xl text-xs leading-relaxed max-h-40 overflow-y-auto" style={{ backgroundColor: '#F9FAFB', border: '1px solid var(--admin-border)', color: 'var(--admin-text-muted)', whiteSpace: 'pre-wrap' }}>
                    {passages.find(p => p.id === readingData.passageId)?.passageText}
                  </div>
                )}
              </div>
            )}
          </div>

          {subType === 'WRITTEN' ? (
            /* Evaluation notes card */
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
          ) : subType === 'READING' ? (
            /* Answer options (no guardrails — Reading has no audio) */
            <div className="rounded-2xl p-6" style={{ backgroundColor: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--admin-text-subtle)' }}>ANSWER OPTIONS</p>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--admin-text-muted)' }}>
                  <input type="checkbox" checked={readingData.isMultipleChoice}
                    onChange={e => setReadingData({
                      ...readingData,
                      isMultipleChoice: e.target.checked,
                      correctAnswers: e.target.checked ? readingData.correctAnswers : readingData.correctAnswers.slice(0, 1),
                    })}
                    className="h-3.5 w-3.5 rounded" style={{ accentColor: 'var(--admin-button-primary)' }} />
                  Multiple correct
                </label>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {readingData.options.map((opt, i) => {
                  const isCorrect = readingData.correctAnswers.includes(i);
                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl"
                      style={{
                        border: `1.5px solid ${isCorrect ? 'var(--admin-accent)' : 'var(--admin-border)'}`,
                        backgroundColor: isCorrect ? 'var(--admin-accent-soft)' : 'white',
                        transition: 'all 0.15s',
                      }}>
                      <button type="button" onClick={() => toggleReadingCorrect(i)} className="admin-circle-toggle" data-state={isCorrect ? 'on' : 'off'}>
                        {isCorrect && <Check width={9} height={9} stroke="white" strokeWidth={3} />}
                      </button>
                      <input type="text" value={opt}
                        onChange={e => setReadingOpt(i, e.target.value)}
                        className="flex-1 text-sm outline-none bg-transparent"
                        style={{ color: 'var(--admin-text)' }}
                        placeholder={`Option ${LETTERS[i]}`}
                      />
                      <span className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--admin-text-subtle)' }}>{LETTERS[i]}</span>
                      {readingData.options.length > 2 && (
                        <button type="button" onClick={() => removeReadingOption(i)} className="flex-shrink-0 p-1 rounded-lg hover:bg-red-50 transition-colors">
                          <Trash2 width={14} height={14} stroke="#D1D5DB" strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {readingData.options.length < 6 && (
                <button type="button" onClick={addReadingOption} className="mt-3 flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--admin-accent)' }}>
                  <span className="text-base font-bold">+</span> Add option
                </button>
              )}
              <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--admin-border)' }}>
                <p className="text-xs mb-2" style={{ color: 'var(--admin-text-subtle)' }}>Explanation (optional, shown in review)</p>
                <textarea
                  value={readingData.explanation}
                  onChange={e => setReadingData({ ...readingData, explanation: e.target.value })}
                  rows={3}
                  style={inputSx}
                  placeholder="Explain why the correct answer is right…"
                />
              </div>
            </div>
          ) : (
            <>
              {/* Answer options */}
              <div className="rounded-2xl p-6" style={{ backgroundColor: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--admin-text-subtle)' }}>ANSWER OPTIONS</p>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--admin-text-muted)' }}>
                    <input type="checkbox" checked={listeningData.isMultipleChoice}
                      onChange={e => setListeningData({
                        ...listeningData,
                        isMultipleChoice: e.target.checked,
                        correctAnswers: e.target.checked ? listeningData.correctAnswers : listeningData.correctAnswers.slice(0, 1),
                      })}
                      className="h-3.5 w-3.5 rounded" style={{ accentColor: 'var(--admin-button-primary)' }} />
                    Multiple correct
                  </label>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {listeningData.options.map((opt, i) => {
                    const isCorrect = listeningData.correctAnswers.includes(i);
                    return (
                      <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl"
                        style={{
                          border: `1.5px solid ${isCorrect ? 'var(--admin-accent)' : 'var(--admin-border)'}`,
                          backgroundColor: isCorrect ? 'var(--admin-accent-soft)' : 'white',
                          transition: 'all 0.15s',
                        }}>
                        <button type="button" onClick={() => toggleListeningCorrect(i)} className="admin-circle-toggle" data-state={isCorrect ? 'on' : 'off'}>
                          {isCorrect && <Check width={9} height={9} stroke="white" strokeWidth={3} />}
                        </button>
                        <input type="text" value={opt}
                          onChange={e => setListeningOpt(i, e.target.value)}
                          className="flex-1 text-sm outline-none bg-transparent"
                          style={{ color: 'var(--admin-text)' }}
                          placeholder={`Option ${LETTERS[i]}`}
                        />
                        <span className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--admin-text-subtle)' }}>{LETTERS[i]}</span>
                        {listeningData.options.length > 2 && (
                          <button type="button" onClick={() => removeListeningOption(i)} className="flex-shrink-0 p-1 rounded-lg hover:bg-red-50 transition-colors">
                            <Trash2 width={14} height={14} stroke="#D1D5DB" strokeWidth={1.5} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {listeningData.options.length < 6 && (
                  <button type="button" onClick={addListeningOption} className="mt-3 flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--admin-accent)' }}>
                    <span className="text-base font-bold">+</span> Add option
                  </button>
                )}
                <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--admin-border)' }}>
                  <p className="text-xs mb-2" style={{ color: 'var(--admin-text-subtle)' }}>Explanation (optional, shown in review)</p>
                  <textarea
                    value={listeningData.explanation}
                    onChange={e => setListeningData({ ...listeningData, explanation: e.target.value })}
                    rows={3}
                    style={inputSx}
                    placeholder="Explain why the correct answer is right…"
                  />
                </div>
              </div>

              {/* Player guardrails */}
              <div className="rounded-2xl p-6" style={{ backgroundColor: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--admin-text-subtle)' }}>PLAYER GUARDRAILS</p>
                <p className="text-xs mb-4" style={{ color: 'var(--admin-text-subtle)' }}>Control how the candidate can interact with the audio player.</p>

                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--admin-text-muted)' }}>Replay limit</label>
                  <input
                    type="number"
                    min={1}
                    value={listeningData.replayLimit}
                    onChange={e => setListeningData({ ...listeningData, replayLimit: Math.max(1, Number(e.target.value) || 1) })}
                    style={{ ...inputSx, resize: undefined, width: '120px' }}
                  />
                </div>

                <label className="flex items-center gap-2 mb-3 text-sm cursor-pointer" style={{ color: 'var(--admin-text)' }}>
                  <input type="checkbox" checked={listeningData.allowRewind}
                    onChange={e => setListeningData({ ...listeningData, allowRewind: e.target.checked })}
                    className="h-4 w-4 rounded" style={{ accentColor: 'var(--admin-button-primary)' }} />
                  Allow rewind / seeking
                </label>

                <label className="flex items-center gap-2 mb-3 text-sm cursor-pointer" style={{ color: 'var(--admin-text)' }}>
                  <input type="checkbox" checked={listeningData.allowSpeedChange}
                    onChange={e => setListeningData({ ...listeningData, allowSpeedChange: e.target.checked })}
                    className="h-4 w-4 rounded" style={{ accentColor: 'var(--admin-button-primary)' }} />
                  Allow playback speed change
                </label>

                {!listeningData.allowSpeedChange && (
                  <div>
                    <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--admin-text-muted)' }}>Fixed speed</label>
                    <select
                      value={listeningData.fixedPlaybackSpeed}
                      onChange={e => setListeningData({ ...listeningData, fixedPlaybackSpeed: Number(e.target.value) })}
                      style={{ ...inputSx, resize: undefined, width: '120px' }}
                    >
                      {[0.5, 0.75, 1, 1.25, 1.5].map(s => <option key={s} value={s}>{s}x</option>)}
                    </select>
                  </div>
                )}
              </div>
            </>
          )}
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
              {subType === 'WRITTEN'
                ? "Title and description are compulsory — the AI grader only has these (plus your evaluation notes) as its reference when scoring the candidate's typed answer."
                : subType === 'LISTENING'
                ? 'Listening answers are scored automatically by exact match, same as MCQ — no manual grading needed. The replay limit and rewind/speed locks are enforced live during the test.'
                : 'Reading answers are scored automatically by exact match, same as MCQ. Passages are shared across questions — pick an existing one or create a new one, then reuse it for multiple questions.'}
            </p>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

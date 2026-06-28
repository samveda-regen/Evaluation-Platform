import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { Trash2, Check, Upload } from 'lucide-react';
import BackButton from '../../components/BackButton';

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

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];


export default function MCQForm() {
  const navigate = useNavigate();
  const { questionId } = useParams<{ questionId: string }>();
  const location = useLocation();
  const isEditing = Boolean(questionId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editQuestion = (location.state as any)?.question;

  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    questionText: '',
    options: ['', '', '', ''],
    correctAnswers: [] as number[],
    marks: 5,
    isMultipleChoice: false,
    explanation: '',
    difficulty: 'easy' as 'easy' | 'medium' | 'hard',
    topic: '',
    tags: [] as string[],
  });
  const [tagInput, setTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && editQuestion) {
      setFormData({
        questionText: editQuestion.questionText ?? '',
        options: Array.isArray(editQuestion.options) && editQuestion.options.length >= 2
          ? editQuestion.options
          : ['', '', '', ''],
        correctAnswers: Array.isArray(editQuestion.correctAnswers) ? editQuestion.correctAnswers : [],
        marks: editQuestion.marks ?? 5,
        isMultipleChoice: editQuestion.isMultipleChoice ?? false,
        explanation: editQuestion.explanation ?? '',
        difficulty: editQuestion.difficulty ?? 'easy',
        topic: editQuestion.topic ?? '',
        tags: Array.isArray(editQuestion.tags) ? editQuestion.tags : [],
      });
    }
  // run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --- Media helpers (logic unchanged) --- */
  const loadImage = (file: File): Promise<HTMLImageElement> =>
    new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const loadVideo = (file: File): Promise<HTMLVideoElement> =>
    new Promise((res, rej) => { const v = document.createElement('video'); v.onloadedmetadata = () => res(v); v.onerror = rej; v.src = URL.createObjectURL(file); });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploadingMedia(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const validTypes = ['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm','audio/mpeg','audio/wav','audio/ogg'];
        if (!validTypes.includes(file.type)) { toast.error(`Invalid file: ${file.name}`); continue; }
        const maxSize = file.type.startsWith('image/') ? 10*1024*1024 : file.type.startsWith('video/') ? 100*1024*1024 : 50*1024*1024;
        if (file.size > maxSize) { toast.error(`Too large: ${file.name}`); continue; }
        const reader = new FileReader();
        const b64 = await new Promise<string>((res,rej) => { reader.onload=()=>res((reader.result as string).split(',')[1]); reader.onerror=rej; reader.readAsDataURL(file); });
        let width:number|undefined, height:number|undefined, duration:number|undefined;
        if (file.type.startsWith('image/')) { const img=await loadImage(file); width=img.width; height=img.height; }
        else if (file.type.startsWith('video/')) { const vid=await loadVideo(file); width=vid.videoWidth; height=vid.videoHeight; duration=Math.floor(vid.duration); }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const uploadPayload: any = { file: { data:b64, mimeType:file.type, originalName:file.name, width, height, duration } };
        const { data } = await adminApi.uploadMedia(uploadPayload);
        if (data.success && data.asset) { setMediaAssets(p=>[...p, data.asset]); toast.success(`Uploaded ${file.name}`); }
      }
    } catch (err: unknown) {
      toast.error((err as {response?:{data?:{error?:string}}})?.response?.data?.error || 'Upload failed');
    } finally { setUploadingMedia(false); if (fileInputRef.current) fileInputRef.current.value=''; }
  };

  const handleDeleteMedia = async (id: string) => {
    if (!confirm('Delete this media?')) return;
    try { await adminApi.deleteMedia(id); setMediaAssets(p=>p.filter(a=>a.id!==id)); toast.success('Deleted'); }
    catch { toast.error('Delete failed'); }
  };

  /* --- Option handlers --- */
  const setOpt = (i: number, v: string) => {
    const opts = [...formData.options]; opts[i]=v; setFormData({...formData, options: opts});
  };
  const addOption = () => {
    if (formData.options.length < 6) setFormData({...formData, options:[...formData.options,'']});
  };
  const removeOption = (i: number) => {
    if (formData.options.length <= 2) return;
    const opts = formData.options.filter((_,idx)=>idx!==i);
    const correct = formData.correctAnswers.filter(x=>x!==i).map(x=>x>i?x-1:x);
    setFormData({...formData, options:opts, correctAnswers:correct});
  };
  const toggleCorrect = (i: number) => {
    if (formData.isMultipleChoice) {
      const next = formData.correctAnswers.includes(i)
        ? formData.correctAnswers.filter(x=>x!==i)
        : [...formData.correctAnswers, i];
      setFormData({...formData, correctAnswers:next});
    } else {
      setFormData({...formData, correctAnswers:[i]});
    }
  };

  /* --- Tag handlers --- */
  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t) { setShowTagInput(false); return; }
    if (!/^[a-z0-9][a-z0-9_\- ]*$/.test(t)) { toast.error('Tags: letters, numbers, hyphens only'); return; }
    if (!formData.tags.includes(t)) setFormData({...formData, tags:[...formData.tags,t]});
    setTagInput(''); setShowTagInput(false);
  };
  const removeTag = (t: string) => setFormData({...formData, tags:formData.tags.filter(x=>x!==t)});

  /* --- Submit --- */
  const handleSubmit = async () => {
    const nonEmpty = formData.options.filter(o=>o.trim()!=='');
    if (nonEmpty.length < 2) { toast.error('At least 2 options required'); return; }
    if (!formData.correctAnswers.length) { toast.error('Select a correct answer'); return; }
    if (!formData.questionText.trim()) { toast.error('Enter a question prompt'); return; }
    setLoading(true);
    try {
      if (isEditing && questionId) {
        await adminApi.updateCustomMCQ(questionId, { ...formData, options: nonEmpty });
        toast.success('Question updated');
        navigate(-1);
      } else {
        const res = await adminApi.createMCQ({ ...formData, options: nonEmpty });
        const id: string | undefined = res?.data?.question?.id;
        if (id && mediaAssets.length) await adminApi.assignMediaToQuestion(id, mediaAssets.map(a=>a.id));
        toast.success('Question created');
        navigate('/admin/repository/custom');
      }
    } catch (err: unknown) {
      toast.error((err as {response?:{data?:{error?:string}}})?.response?.data?.error || 'Save failed');
    } finally { setLoading(false); }
  };

  /* --- Difficulty pill styles --- */
  const diffStyle = (d: string) => {
    const active = formData.difficulty === d;
    if (!active) return { backgroundColor:'#F9FAFB', color:'var(--admin-text-muted)', border:'1.5px solid var(--admin-border)' };
    return { backgroundColor:'var(--admin-accent-soft)', color:'var(--admin-accent-hover)', border:'1.5px solid var(--admin-accent)' };
  };

  /* --- Shared input style --- */
  const inputSx: React.CSSProperties = { backgroundColor:'white', color:'var(--admin-text)', borderColor:'var(--admin-border)' };

  return (
    <div style={{ backgroundColor:'#F9FAFB', minHeight:'100%' }}>

      {/* -- Header -- */}
      <div style={{ marginBottom:'24px' }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <BackButton />
            <div>
              <h1 style={{ fontSize: "32px", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--admin-text)", margin: 0, lineHeight: 1.2 }}>{isEditing ? 'Edit MCQ question' : 'New MCQ question'}</h1>
              <p className="text-sm mt-1" style={{ color:'var(--admin-text-muted)' }}>
                Multiple choice · {formData.isMultipleChoice ? 'multiple answers' : 'single answer'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button onClick={() => navigate(-1)}
              className="btn btn-secondary">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={loading}
              className="btn btn-primary">
              <Check width={13} height={13} stroke="white" strokeWidth={2.5} />
              {loading ? 'Saving…' : 'Save question'}
            </button>
          </div>
        </div>
      </div>

      {/* -- Body -- */}
      <div className="max-w-6xl mx-auto"
        style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:'24px', alignItems:'start' }}>

        {/* --- Left column --- */}
        <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>

          {/* QUESTION card */}
          <div className="rounded-2xl p-6" style={{ backgroundColor:'white', boxShadow:'0 1px 3px rgba(0,0,0,0.06)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color:'var(--admin-text-subtle)' }}>QUESTION</p>

            {/* Prompt */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2" style={{ color:'var(--admin-text-muted)' }}>
                Prompt <span style={{ color:'#EF4444' }}>*</span>
              </label>
              <textarea
                value={formData.questionText}
                onChange={e => setFormData({...formData, questionText:e.target.value})}
                rows={4}
                className="w-full rounded-xl border px-4 py-3 text-sm outline-none resize-none"
                style={inputSx}
                placeholder="Type your question here…"
              />
            </div>

            {/* Answer options */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm" style={{ color:'var(--admin-text-muted)' }}>
                  <span className="font-medium">Answer options</span>
                  <span style={{ color:'var(--admin-text-subtle)' }}> · select the correct one</span>
                </p>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color:'var(--admin-text-muted)' }}>
                  <input type="checkbox" checked={formData.isMultipleChoice}
                    onChange={e => setFormData({
                      ...formData,
                      isMultipleChoice: e.target.checked,
                      correctAnswers: e.target.checked ? formData.correctAnswers : formData.correctAnswers.slice(0,1),
                    })}
                    className="h-3.5 w-3.5 rounded" style={{ accentColor:'var(--admin-button-primary)' }} />
                  Multiple correct
                </label>
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                {formData.options.map((opt, i) => {
                  const isCorrect = formData.correctAnswers.includes(i);
                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl"
                      style={{
                        border: `1.5px solid ${isCorrect ? 'var(--admin-accent)' : 'var(--admin-border)'}`,
                        backgroundColor: isCorrect ? 'var(--admin-accent-soft)' : 'white',
                        transition: 'all 0.15s',
                      }}>
                      {/* Correct toggle */}
                      <button type="button" onClick={() => toggleCorrect(i)}
                        className="admin-circle-toggle"
                        data-state={isCorrect ? 'on' : 'off'}>
                        {isCorrect && (
                          <Check width={9} height={9} stroke="white" strokeWidth={3} />
                        )}
                      </button>
                      {/* Text */}
                      <input type="text" value={opt}
                        onChange={e => setOpt(i, e.target.value)}
                        className="flex-1 text-sm outline-none bg-transparent"
                        style={{ color:'var(--admin-text)' }}
                        placeholder={`Option ${LETTERS[i]}`}
                      />
                      {/* Letter badge */}
                      <span className="text-xs font-semibold flex-shrink-0" style={{ color:'var(--admin-text-subtle)' }}>
                        {LETTERS[i]}
                      </span>
                      {/* Trash icon */}
                      {formData.options.length > 2 && (
                        <button type="button" onClick={() => removeOption(i)}
                          className="flex-shrink-0 p-1 rounded-lg hover:bg-red-50 transition-colors">
                          <Trash2 width={14} height={14} stroke="#D1D5DB" strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {formData.options.length < 6 && (
                <button type="button" onClick={addOption}
                  className="mt-3 flex items-center gap-1.5 text-sm font-medium"
                  style={{ color:'var(--admin-accent)' }}>
                  <span className="text-base font-bold">+</span> Add option
                </button>
              )}
            </div>

            {/* Collapsible media */}
            <div className="mt-6 pt-4" style={{ borderTop:'1px solid var(--admin-border)' }}>
              <button type="button" onClick={() => setShowMedia(v=>!v)}
                className="flex items-center gap-2 text-sm" style={{ color:'var(--admin-text-subtle)' }}>
                <Upload width={13} height={13} strokeWidth={1.5} />
                {showMedia ? 'Hide media' : `Add media${mediaAssets.length ? ` (${mediaAssets.length})` : ''}`}
              </button>
              {showMedia && (
                <div className="mt-3">
                  <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,audio/*"
                    onChange={handleFileSelect} className="hidden" />
                  {uploadingMedia && <p className="text-xs mb-2" style={{ color:'var(--admin-text-muted)' }}>Uploading…</p>}
                  {mediaAssets.length === 0 ? (
                    <div onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed rounded-xl p-5 text-center cursor-pointer"
                      style={{ borderColor:'var(--admin-border)', backgroundColor:'#FAFAFA' }}>
                      <p className="text-sm" style={{ color:'var(--admin-text-subtle)' }}>Click to upload images, videos, or audio</p>
                    </div>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                      {mediaAssets.map(a => (
                        <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border"
                          style={{ borderColor:'var(--admin-border)', backgroundColor:'white' }}>
                          <span className="text-sm flex-1 truncate" style={{ color:'var(--admin-text-muted)' }}>{a.originalName}</span>
                          <span className="text-xs" style={{ color:'var(--admin-text-subtle)' }}>{(a.fileSize/1024/1024).toFixed(1)} MB</span>
                          <button type="button" onClick={() => handleDeleteMedia(a.id)}
                            className="text-sm font-medium" style={{ color:'#DC2626' }}>Remove</button>
                        </div>
                      ))}
                      <button type="button" onClick={() => fileInputRef.current?.click()}
                        className="text-sm font-medium" style={{ color:'var(--admin-accent)' }}>+ Upload more</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* EXPLANATION card */}
          <div className="rounded-2xl p-6" style={{ backgroundColor:'white', boxShadow:'0 1px 3px rgba(0,0,0,0.06)' }}>
            <p className="text-sm" style={{ color:'var(--admin-text-muted)' }}>
              <span className="font-bold uppercase text-xs tracking-widest" style={{ color:'var(--admin-text-subtle)' }}>EXPLANATION</span>
              <span className="ml-2 text-xs" style={{ color:'var(--admin-text-subtle)' }}>(optional, shown in review)</span>
            </p>
            <textarea
              value={formData.explanation}
              onChange={e => setFormData({...formData, explanation:e.target.value})}
              rows={4}
              className="w-full rounded-xl border px-4 py-3 text-sm outline-none resize-none mt-3"
              style={inputSx}
              placeholder="Explain why the correct answer is right…"
            />
          </div>
        </div>

        {/* --- Right column --- */}
        <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>

          {/* Properties panel */}
          <div className="rounded-2xl p-5" style={{ backgroundColor:'white', boxShadow:'0 1px 3px rgba(0,0,0,0.06)' }}>
            <p className="text-sm font-bold mb-5" style={{ color:'var(--admin-text)' }}>Properties</p>

            {/* Category */}
            <div className="mb-4">
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color:'var(--admin-text-muted)' }}>
                Category
              </label>
              <input type="text" value={formData.topic}
                onChange={e => setFormData({...formData, topic:e.target.value})}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={inputSx}
                placeholder="e.g. APIs, Algorithms"
              />
            </div>

            {/* Difficulty */}
            <div className="mb-4">
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color:'var(--admin-text-muted)' }}>
                Difficulty
              </label>
              <div className="flex gap-2">
                {(['easy','medium','hard'] as const).map(d => (
                  <button key={d} type="button"
                    onClick={() => setFormData({...formData, difficulty:d})}
                    className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all"
                    style={diffStyle(d)}>
                    {d.charAt(0).toUpperCase()+d.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Points */}
            <div className="mb-4">
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color:'var(--admin-text-muted)' }}>
                Points
              </label>
              <input type="number" min={1} value={formData.marks}
                onChange={e => setFormData({...formData, marks:Number(e.target.value)})}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={inputSx}
              />
            </div>

            {/* Time estimate */}
            <div className="mb-4">
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color:'var(--admin-text-muted)' }}>
                Time estimate (sec)
              </label>
              <input type="number" min={5} defaultValue={45}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
                style={inputSx}
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color:'var(--admin-text-muted)' }}>
                Tags
              </label>
              <div className="flex flex-wrap gap-1.5">
                {formData.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
                    style={{ backgroundColor:'var(--admin-border)', color:'var(--admin-text-muted)' }}>
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} style={{ color:'var(--admin-text-subtle)', lineHeight:1 }}>×</button>
                  </span>
                ))}
                {showTagInput ? (
                  <input autoFocus type="text" value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key==='Enter') { e.preventDefault(); addTag(); }
                      if (e.key==='Escape') { setShowTagInput(false); setTagInput(''); }
                    }}
                    onBlur={() => { addTag(); setShowTagInput(false); }}
                    className="px-2.5 py-1 text-xs rounded-full border outline-none"
                    style={{ borderColor:'var(--admin-accent)', backgroundColor:'white', width:'64px', color:'var(--admin-text)' }}
                    placeholder="tag…"
                  />
                ) : (
                  <button type="button" onClick={() => setShowTagInput(true)}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-sm font-bold"
                    style={{ backgroundColor:'var(--admin-border)', color:'var(--admin-text-muted)' }}>
                    +
                  </button>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

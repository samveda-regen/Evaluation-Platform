import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../../services/api';
import type {
  Pagination,
  RepositoryBehavioralQuestion,
  RepositoryCategory,
  RepositoryCodingQuestion,
  RepositoryMCQQuestion,
  RepositoryQuestion
} from '../../../types';

type EnabledFilter = 'all' | 'enabled' | 'disabled';

interface MediaAsset {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  storageUrl: string;
  mediaType: string;
  width?: number;
  height?: number;
  duration?: number;
  thumbnailUrl?: string;
}

const CATEGORY_OPTIONS: Array<{ value: RepositoryCategory; label: string }> = [
  { value: 'MCQ', label: 'MCQ (Aptitude / Technical)' },
  { value: 'CODING', label: 'Coding' },
  { value: 'BEHAVIORAL', label: 'Behavioral / Situational' }
];

function isMCQQuestion(question: RepositoryQuestion): question is RepositoryMCQQuestion {
  return question.repositoryCategory === 'MCQ';
}

function isCodingQuestion(question: RepositoryQuestion): question is RepositoryCodingQuestion {
  return question.repositoryCategory === 'CODING';
}

// ── Behavioral form ──────────────────────────────────────────────────────────

interface BehavioralFormState {
  title: string;
  description: string;
  expectedAnswer: string;
  marks: number;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  tags: string[];
}

const DEFAULT_BEHAVIORAL_FORM: BehavioralFormState = {
  title: '',
  description: '',
  expectedAnswer: '',
  marks: 10,
  difficulty: 'medium',
  topic: '',
  tags: []
};

// ── MCQ edit form ────────────────────────────────────────────────────────────

interface MCQEditFormState {
  questionText: string;
  options: string[];
  correctAnswers: number[];
  isMultipleChoice: boolean;
  marks: number;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  tags: string[];
  explanation: string;
}

// ── Coding edit form ─────────────────────────────────────────────────────────

interface CodingEditFormState {
  title: string;
  description: string;
  marks: number;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  tags: string[];
  supportedLanguages: string[];
  timeLimit: number;
  memoryLimit: number;
}

const ALL_LANGUAGES = ['javascript', 'python', 'java', 'cpp', 'c', 'typescript', 'go', 'rust'];

// ── Component ────────────────────────────────────────────────────────────────

export default function CustomQuestions() {
  const [category, setCategory] = useState<RepositoryCategory>('MCQ');
  const [questions, setQuestions] = useState<RepositoryQuestion[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [topic, setTopic] = useState('');
  const [tag, setTag] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>('all');

  // Behavioral modal (create + edit)
  const [isBehavioralModalOpen, setIsBehavioralModalOpen] = useState(false);
  const [editingBehavioralId, setEditingBehavioralId] = useState<string | null>(null);
  const [behavioralForm, setBehavioralForm] = useState<BehavioralFormState>(DEFAULT_BEHAVIORAL_FORM);
  const [behavioralTagInput, setBehavioralTagInput] = useState('');
  const [savingBehavioral, setSavingBehavioral] = useState(false);

  // MCQ edit modal
  const [editingMCQ, setEditingMCQ] = useState<RepositoryMCQQuestion | null>(null);
  const [mcqForm, setMcqForm] = useState<MCQEditFormState | null>(null);
  const [mcqTagInput, setMcqTagInput] = useState('');
  const [savingMCQ, setSavingMCQ] = useState(false);
  const [mcqMediaAssets, setMcqMediaAssets] = useState<MediaAsset[]>([]);
  const [mcqUploadingMedia, setMcqUploadingMedia] = useState(false);
  const mcqFileInputRef = useRef<HTMLInputElement>(null);

  // Coding edit modal
  const [editingCoding, setEditingCoding] = useState<RepositoryCodingQuestion | null>(null);
  const [codingForm, setCodingForm] = useState<CodingEditFormState | null>(null);
  const [codingTagInput, setCodingTagInput] = useState('');
  const [savingCoding, setSavingCoding] = useState(false);

  useEffect(() => {
    void loadQuestions();
  }, [category, page, search, difficulty, topic, tag, enabledFilter]);

  const loadQuestions = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.getCustomRepositoryQuestions({
        category,
        page,
        limit: 20,
        search,
        difficulty: difficulty as 'easy' | 'medium' | 'hard' | '',
        topic,
        tag,
        enabled:
          enabledFilter === 'enabled' ? true : enabledFilter === 'disabled' ? false : undefined
      });
      setQuestions(data.questions);
      setPagination(data.pagination);
    } catch {
      toast.error('Failed to load custom questions');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (question: RepositoryQuestion) => {
    if (!confirm('Are you sure you want to delete this question?')) return;
    try {
      await adminApi.deleteRepositoryQuestion(question.id, question.repositoryCategory);
      toast.success('Question deleted');
      await loadQuestions();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to delete question');
    }
  };

  const handleToggleQuestion = async (question: RepositoryQuestion) => {
    try {
      if (question.isEnabled) {
        await adminApi.disableCustomRepositoryQuestion(question.id, question.repositoryCategory);
        toast.success('Question disabled');
      } else {
        await adminApi.enableCustomRepositoryQuestion(question.id, question.repositoryCategory);
        toast.success('Question enabled');
      }
      await loadQuestions();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to update question status');
    }
  };

  // ── Behavioral modal ───────────────────────────────────────────────────────

  const openCreateBehavioralModal = () => {
    setEditingBehavioralId(null);
    setBehavioralForm(DEFAULT_BEHAVIORAL_FORM);
    setBehavioralTagInput('');
    setIsBehavioralModalOpen(true);
  };

  const openEditBehavioralModal = (question: RepositoryBehavioralQuestion) => {
    setEditingBehavioralId(question.id);
    setBehavioralForm({
      title: question.title,
      description: question.description,
      expectedAnswer: question.expectedAnswer ?? '',
      marks: question.marks,
      difficulty: question.difficulty as 'easy' | 'medium' | 'hard',
      topic: question.topic ?? '',
      tags: [...question.tags]
    });
    setBehavioralTagInput('');
    setIsBehavioralModalOpen(true);
  };

  const closeBehavioralModal = () => {
    setIsBehavioralModalOpen(false);
    setEditingBehavioralId(null);
    setBehavioralForm(DEFAULT_BEHAVIORAL_FORM);
    setBehavioralTagInput('');
  };

  const addBehavioralTag = () => {
    const newTag = behavioralTagInput.trim().toLowerCase();
    if (!newTag || behavioralForm.tags.includes(newTag)) return;
    setBehavioralForm((prev) => ({ ...prev, tags: [...prev.tags, newTag] }));
    setBehavioralTagInput('');
  };

  const removeBehavioralTag = (tagToRemove: string) => {
    setBehavioralForm((prev) => ({ ...prev, tags: prev.tags.filter((t) => t !== tagToRemove) }));
  };

  const saveBehavioralQuestion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!behavioralForm.title.trim()) { toast.error('Title is required'); return; }
    if (!behavioralForm.description.trim()) { toast.error('Description is required'); return; }
    if (behavioralForm.marks < 1) { toast.error('Marks must be greater than 0'); return; }

    setSavingBehavioral(true);
    try {
      if (editingBehavioralId) {
        await adminApi.updateCustomBehavioral(editingBehavioralId, {
          title: behavioralForm.title,
          description: behavioralForm.description,
          expectedAnswer: behavioralForm.expectedAnswer || undefined,
          marks: behavioralForm.marks,
          difficulty: behavioralForm.difficulty,
          topic: behavioralForm.topic || undefined,
          tags: behavioralForm.tags
        });
        toast.success('Behavioral question updated');
      } else {
        await adminApi.createCustomBehavioral({
          title: behavioralForm.title,
          description: behavioralForm.description,
          expectedAnswer: behavioralForm.expectedAnswer || undefined,
          marks: behavioralForm.marks,
          difficulty: behavioralForm.difficulty,
          topic: behavioralForm.topic || undefined,
          tags: behavioralForm.tags
        });
        toast.success('Behavioral question created');
      }
      closeBehavioralModal();
      await loadQuestions();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to save behavioral question');
    } finally {
      setSavingBehavioral(false);
    }
  };

  // ── MCQ edit modal ─────────────────────────────────────────────────────────

  const openEditMCQModal = (question: RepositoryMCQQuestion) => {
    setEditingMCQ(question);
    setMcqForm({
      questionText: question.questionText,
      options: [...question.options],
      correctAnswers: [...question.correctAnswers],
      isMultipleChoice: question.isMultipleChoice,
      marks: question.marks,
      difficulty: question.difficulty as 'easy' | 'medium' | 'hard',
      topic: question.topic ?? '',
      tags: [...question.tags],
      explanation: question.explanation ?? ''
    });
    setMcqTagInput('');
    setMcqMediaAssets([]);
    // Load existing media for this question
    adminApi.getQuestionMedia(question.id).then(({ data }) => {
      if (data.success) setMcqMediaAssets(data.assets as MediaAsset[]);
    }).catch(() => {});
  };

  const closeEditMCQModal = () => {
    setEditingMCQ(null);
    setMcqForm(null);
    setMcqTagInput('');
    setMcqMediaAssets([]);
  };

  const handleMCQMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setMcqUploadingMedia(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg'];
        if (!validTypes.includes(file.type)) { toast.error(`Invalid file type: ${file.name}`); continue; }

        const maxSize = file.type.startsWith('image/') ? 10 * 1024 * 1024 : file.type.startsWith('video/') ? 100 * 1024 * 1024 : 50 * 1024 * 1024;
        if (file.size > maxSize) { toast.error(`File too large: ${file.name}`); continue; }

        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const { data } = await adminApi.uploadMedia({ file: { data: base64Data, mimeType: file.type, originalName: file.name } });
        if (data.success && data.asset) {
          setMcqMediaAssets((prev) => [...prev, data.asset as MediaAsset]);
          toast.success(`Uploaded ${file.name}`);
        }
      }
    } catch {
      toast.error('Failed to upload media');
    } finally {
      setMcqUploadingMedia(false);
      if (mcqFileInputRef.current) mcqFileInputRef.current.value = '';
    }
  };

  const handleMCQMediaDelete = async (assetId: string) => {
    if (!confirm('Delete this media?')) return;
    try {
      await adminApi.deleteMedia(assetId);
      setMcqMediaAssets((prev) => prev.filter((a) => a.id !== assetId));
      toast.success('Media deleted');
    } catch {
      toast.error('Failed to delete media');
    }
  };

  const saveMCQQuestion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingMCQ || !mcqForm) return;

    const nonEmpty = mcqForm.options.filter((o) => o.trim() !== '');
    if (nonEmpty.length < 2) { toast.error('At least 2 options are required'); return; }
    if (mcqForm.correctAnswers.length === 0) { toast.error('Please select at least one correct answer'); return; }

    setSavingMCQ(true);
    try {
      await adminApi.updateCustomMCQ(editingMCQ.id, {
        questionText: mcqForm.questionText,
        options: nonEmpty,
        correctAnswers: mcqForm.correctAnswers,
        isMultipleChoice: mcqForm.isMultipleChoice,
        marks: mcqForm.marks,
        difficulty: mcqForm.difficulty,
        topic: mcqForm.topic || undefined,
        tags: mcqForm.tags,
        explanation: mcqForm.explanation || undefined
      });

      // Assign any newly uploaded media (those not yet linked to this question)
      const newAssetIds = mcqMediaAssets
        .filter((a) => !(a as MediaAsset & { mcqQuestionId?: string }).mcqQuestionId)
        .map((a) => a.id);
      if (newAssetIds.length > 0) {
        await adminApi.assignMediaToQuestion(editingMCQ.id, newAssetIds);
      }

      toast.success('MCQ question updated');
      closeEditMCQModal();
      await loadQuestions();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to update MCQ question');
    } finally {
      setSavingMCQ(false);
    }
  };

  const handleMCQOptionChange = (index: number, value: string) => {
    if (!mcqForm) return;
    const newOptions = [...mcqForm.options];
    newOptions[index] = value;
    setMcqForm({ ...mcqForm, options: newOptions });
  };

  const addMCQOption = () => {
    if (!mcqForm || mcqForm.options.length >= 6) return;
    setMcqForm({ ...mcqForm, options: [...mcqForm.options, ''] });
  };

  const removeMCQOption = (index: number) => {
    if (!mcqForm || mcqForm.options.length <= 2) return;
    const newOptions = mcqForm.options.filter((_, i) => i !== index);
    const newCorrect = mcqForm.correctAnswers
      .filter((i) => i !== index)
      .map((i) => (i > index ? i - 1 : i));
    setMcqForm({ ...mcqForm, options: newOptions, correctAnswers: newCorrect });
  };

  const toggleMCQCorrectAnswer = (index: number) => {
    if (!mcqForm) return;
    if (mcqForm.isMultipleChoice) {
      const newCorrect = mcqForm.correctAnswers.includes(index)
        ? mcqForm.correctAnswers.filter((i) => i !== index)
        : [...mcqForm.correctAnswers, index];
      setMcqForm({ ...mcqForm, correctAnswers: newCorrect });
    } else {
      setMcqForm({ ...mcqForm, correctAnswers: [index] });
    }
  };

  // ── Coding edit modal ──────────────────────────────────────────────────────

  const openEditCodingModal = (question: RepositoryCodingQuestion) => {
    setEditingCoding(question);
    setCodingForm({
      title: question.title,
      description: question.description,
      marks: question.marks,
      difficulty: question.difficulty as 'easy' | 'medium' | 'hard',
      topic: question.topic ?? '',
      tags: [...question.tags],
      supportedLanguages: [...question.supportedLanguages],
      timeLimit: question.timeLimit,
      memoryLimit: question.memoryLimit
    });
    setCodingTagInput('');
  };

  const closeEditCodingModal = () => {
    setEditingCoding(null);
    setCodingForm(null);
    setCodingTagInput('');
  };

  const saveCodingQuestion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingCoding || !codingForm) return;
    if (!codingForm.title.trim()) { toast.error('Title is required'); return; }
    if (!codingForm.description.trim()) { toast.error('Description is required'); return; }
    if (codingForm.supportedLanguages.length === 0) { toast.error('Select at least one language'); return; }

    setSavingCoding(true);
    try {
      await adminApi.updateCustomCoding(editingCoding.id, {
        title: codingForm.title,
        description: codingForm.description,
        marks: codingForm.marks,
        difficulty: codingForm.difficulty,
        topic: codingForm.topic || undefined,
        tags: codingForm.tags,
        supportedLanguages: codingForm.supportedLanguages,
        timeLimit: codingForm.timeLimit,
        memoryLimit: codingForm.memoryLimit
      });
      toast.success('Coding question updated');
      closeEditCodingModal();
      await loadQuestions();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to update coding question');
    } finally {
      setSavingCoding(false);
    }
  };

  const toggleCodingLanguage = (lang: string) => {
    if (!codingForm) return;
    const langs = codingForm.supportedLanguages.includes(lang)
      ? codingForm.supportedLanguages.filter((l) => l !== lang)
      : [...codingForm.supportedLanguages, lang];
    setCodingForm({ ...codingForm, supportedLanguages: langs });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold">Custom Questions</h2>
            <p className="text-sm text-gray-600">
              Create, enable/disable, and delete organization-specific reusable questions.
            </p>
          </div>

          {category === 'MCQ' && (
            <Link to="/admin/mcq/new" className="btn btn-primary">
              Create MCQ
            </Link>
          )}
          {category === 'CODING' && (
            <Link to="/admin/coding/new" className="btn btn-primary">
              Create Coding
            </Link>
          )}
          {category === 'BEHAVIORAL' && (
            <button type="button" onClick={openCreateBehavioralModal} className="btn btn-primary">
              Create Behavioral
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {CATEGORY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => { setCategory(option.value); setPage(1); }}
              className={`px-3 py-1 rounded-full text-sm transition-colors ${
                category === option.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <input
            type="text"
            placeholder="Search"
            className="input"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <select
            value={difficulty}
            onChange={(e) => { setDifficulty(e.target.value); setPage(1); }}
            className="input"
          >
            <option value="">All difficulties</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          <input
            type="text"
            placeholder="Topic"
            className="input"
            value={topic}
            onChange={(e) => { setTopic(e.target.value); setPage(1); }}
          />
          <input
            type="text"
            placeholder="Tag"
            className="input"
            value={tag}
            onChange={(e) => { setTag(e.target.value); setPage(1); }}
          />
          <select
            value={enabledFilter}
            onChange={(e) => { setEnabledFilter(e.target.value as EnabledFilter); setPage(1); }}
            className="input"
          >
            <option value="all">All statuses</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
        </div>
      ) : questions.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">No custom questions found for current filters.</p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {questions.map((question) => (
              <div key={question.id} className="card">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="badge badge-info">{question.repositoryCategory}</span>
                      <span className={`badge ${question.isEnabled ? 'badge-success' : 'badge-danger'}`}>
                        {question.isEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <span className="text-sm text-gray-500">{question.marks} marks</span>
                      <span className="text-sm text-gray-500 capitalize">{question.difficulty}</span>
                      {question.topic && (
                        <span className="text-sm text-gray-500">Topic: {question.topic}</span>
                      )}
                    </div>

                    {isMCQQuestion(question) ? (
                      <div>
                        <p className="text-gray-800 mb-3">{question.questionText}</p>
                        <div className="flex flex-wrap gap-2">
                          {question.options.map((option, index) => (
                            <span
                              key={`${question.id}-${index}`}
                              className={`text-xs px-2 py-1 rounded ${
                                question.correctAnswers.includes(index)
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {index + 1}. {option}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : isCodingQuestion(question) ? (
                      <div>
                        <h3 className="font-semibold text-gray-800">{question.title}</h3>
                        <p className="text-gray-600 mt-1">{question.description}</p>
                        <p className="text-sm text-gray-500 mt-2">
                          Languages: {question.supportedLanguages.join(', ')}
                          {' | '}
                          Time: {question.timeLimit}ms
                          {' | '}
                          Memory: {question.memoryLimit}MB
                        </p>
                      </div>
                    ) : (
                      <div>
                        <h3 className="font-semibold text-gray-800">{question.title}</h3>
                        <p className="text-gray-600 mt-1">{question.description}</p>
                        {question.expectedAnswer && (
                          <p className="text-sm text-gray-500 mt-2">
                            Expected answer: {question.expectedAnswer}
                          </p>
                        )}
                      </div>
                    )}

                    {question.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {question.tags.map((item) => (
                          <span
                            key={`${question.id}-${item}`}
                            className="text-xs bg-gray-100 px-2 py-1 rounded"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (isMCQQuestion(question)) openEditMCQModal(question);
                        else if (isCodingQuestion(question)) openEditCodingModal(question);
                        else openEditBehavioralModal(question as RepositoryBehavioralQuestion);
                      }}
                      className="btn btn-secondary text-sm"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleQuestion(question)}
                      className="btn btn-secondary text-sm"
                    >
                      {question.isEnabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(question)}
                      className="btn btn-danger text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-6">
              <button onClick={() => setPage(page - 1)} disabled={page === 1} className="btn btn-secondary">
                Previous
              </button>
              <span className="py-2 px-4">Page {page} of {pagination.totalPages}</span>
              <button onClick={() => setPage(page + 1)} disabled={page === pagination.totalPages} className="btn btn-secondary">
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Behavioral Modal (create + edit) ───────────────────────────────── */}
      {isBehavioralModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                {editingBehavioralId ? 'Edit Behavioral Question' : 'Create Behavioral Question'}
              </h3>
              <button type="button" onClick={closeBehavioralModal} className="text-gray-500 hover:text-gray-700 text-xl">
                ×
              </button>
            </div>

            <form onSubmit={saveBehavioralQuestion} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  className="input"
                  value={behavioralForm.title}
                  onChange={(e) => setBehavioralForm((prev) => ({ ...prev, title: e.target.value }))}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
                <textarea
                  className="input min-h-[120px]"
                  value={behavioralForm.description}
                  onChange={(e) => setBehavioralForm((prev) => ({ ...prev, description: e.target.value }))}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expected Answer (Optional)</label>
                <textarea
                  className="input min-h-[100px]"
                  value={behavioralForm.expectedAnswer}
                  onChange={(e) => setBehavioralForm((prev) => ({ ...prev, expectedAnswer: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Marks *</label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    value={behavioralForm.marks}
                    onChange={(e) => setBehavioralForm((prev) => ({ ...prev, marks: Number(e.target.value) }))}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty *</label>
                  <select
                    className="input"
                    value={behavioralForm.difficulty}
                    onChange={(e) => setBehavioralForm((prev) => ({ ...prev, difficulty: e.target.value as 'easy' | 'medium' | 'hard' }))}
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Topic</label>
                  <input
                    type="text"
                    className="input"
                    value={behavioralForm.topic}
                    onChange={(e) => setBehavioralForm((prev) => ({ ...prev, topic: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    className="input"
                    value={behavioralTagInput}
                    onChange={(e) => setBehavioralTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBehavioralTag(); } }}
                    placeholder="Type tag and press Enter"
                  />
                  <button type="button" className="btn btn-secondary" onClick={addBehavioralTag}>Add</button>
                </div>
                {behavioralForm.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {behavioralForm.tags.map((item) => (
                      <span key={item} className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm">
                        {item}
                        <button type="button" className="text-gray-500 hover:text-gray-700" onClick={() => removeBehavioralTag(item)}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn btn-secondary" onClick={closeBehavioralModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={savingBehavioral}>
                  {savingBehavioral ? 'Saving...' : editingBehavioralId ? 'Save Changes' : 'Create Question'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MCQ Edit Modal ─────────────────────────────────────────────────── */}
      {editingMCQ && mcqForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Edit MCQ Question</h3>
              <button type="button" onClick={closeEditMCQModal} className="text-gray-500 hover:text-gray-700 text-xl">×</button>
            </div>

            <form onSubmit={saveMCQQuestion} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Question Text *</label>
                <textarea
                  className="input min-h-[100px]"
                  value={mcqForm.questionText}
                  onChange={(e) => setMcqForm({ ...mcqForm, questionText: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Marks *</label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    value={mcqForm.marks}
                    onChange={(e) => setMcqForm({ ...mcqForm, marks: Number(e.target.value) })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty *</label>
                  <select
                    className="input"
                    value={mcqForm.difficulty}
                    onChange={(e) => setMcqForm({ ...mcqForm, difficulty: e.target.value as 'easy' | 'medium' | 'hard' })}
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Topic</label>
                  <input
                    type="text"
                    className="input"
                    value={mcqForm.topic}
                    onChange={(e) => setMcqForm({ ...mcqForm, topic: e.target.value })}
                  />
                </div>
                <div className="flex items-center pt-6">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={mcqForm.isMultipleChoice}
                      onChange={(e) => setMcqForm({
                        ...mcqForm,
                        isMultipleChoice: e.target.checked,
                        correctAnswers: e.target.checked ? mcqForm.correctAnswers : mcqForm.correctAnswers.slice(0, 1)
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Multiple correct answers</span>
                  </label>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gray-700">Options * (click circle to mark correct)</label>
                  {mcqForm.options.length < 6 && (
                    <button type="button" onClick={addMCQOption} className="text-sm text-primary-600 hover:underline">+ Add Option</button>
                  )}
                </div>
                <div className="space-y-3">
                  {mcqForm.options.map((option, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => toggleMCQCorrectAnswer(index)}
                        className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                          mcqForm.correctAnswers.includes(index)
                            ? 'bg-green-500 border-green-500 text-white'
                            : 'border-gray-300 hover:border-green-500'
                        }`}
                      >
                        {mcqForm.correctAnswers.includes(index) ? '✓' : index + 1}
                      </button>
                      <input
                        type="text"
                        value={option}
                        onChange={(e) => handleMCQOptionChange(index, e.target.value)}
                        className="input flex-1"
                        placeholder={`Option ${index + 1}`}
                      />
                      {mcqForm.options.length > 2 && (
                        <button type="button" onClick={() => removeMCQOption(index)} className="text-red-600 hover:text-red-800">✕</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Media Upload */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Media Attachments (Images, Videos, Audio)
                  </label>
                  <button
                    type="button"
                    onClick={() => mcqFileInputRef.current?.click()}
                    disabled={mcqUploadingMedia}
                    className="text-sm text-primary-600 hover:underline flex items-center gap-1"
                  >
                    <span className="text-lg">+</span> Upload
                  </button>
                </div>
                <input
                  ref={mcqFileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*,audio/*"
                  onChange={handleMCQMediaUpload}
                  className="hidden"
                />
                {mcqUploadingMedia && <p className="text-sm text-gray-500 mb-2">Uploading...</p>}
                {mcqMediaAssets.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {mcqMediaAssets.map((asset) => (
                      <div key={asset.id} className="relative border rounded-lg overflow-hidden bg-gray-50">
                        <div className="aspect-video bg-gray-200 flex items-center justify-center">
                          {asset.mediaType === 'image' && (
                            <img src={asset.storageUrl} alt={asset.originalName} className="w-full h-full object-cover" />
                          )}
                          {asset.mediaType === 'video' && (
                            <video src={asset.storageUrl} controls className="w-full h-full object-cover" />
                          )}
                          {asset.mediaType === 'audio' && (
                            <div className="p-4 w-full text-center">
                              <p className="text-xs text-gray-500 mb-1">Audio</p>
                              <audio src={asset.storageUrl} controls className="w-full" />
                            </div>
                          )}
                        </div>
                        <div className="p-2 bg-white">
                          <p className="text-xs text-gray-600 truncate" title={asset.originalName}>{asset.originalName}</p>
                          <p className="text-xs text-gray-400">{(asset.fileSize / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleMCQMediaDelete(asset.id)}
                          className="absolute top-2 right-2 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-700"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    onClick={() => mcqFileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-primary-500 hover:bg-primary-50 transition-colors"
                  >
                    <p className="text-sm text-gray-500">Click to upload images, videos, or audio</p>
                    <p className="text-xs text-gray-400 mt-1">Images (10MB), Videos (100MB), Audio (50MB)</p>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Explanation (Optional)</label>
                <textarea
                  className="input min-h-[80px]"
                  value={mcqForm.explanation}
                  onChange={(e) => setMcqForm({ ...mcqForm, explanation: e.target.value })}
                  placeholder="Explain why the answer is correct..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    className="input"
                    value={mcqTagInput}
                    onChange={(e) => setMcqTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const t = mcqTagInput.trim().toLowerCase();
                        if (t && !mcqForm.tags.includes(t)) setMcqForm({ ...mcqForm, tags: [...mcqForm.tags, t] });
                        setMcqTagInput('');
                      }
                    }}
                    placeholder="Type tag and press Enter"
                  />
                  <button type="button" className="btn btn-secondary" onClick={() => {
                    const t = mcqTagInput.trim().toLowerCase();
                    if (t && !mcqForm.tags.includes(t)) setMcqForm({ ...mcqForm, tags: [...mcqForm.tags, t] });
                    setMcqTagInput('');
                  }}>Add</button>
                </div>
                {mcqForm.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {mcqForm.tags.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm">
                        {t}
                        <button type="button" className="text-gray-500 hover:text-gray-700" onClick={() => setMcqForm({ ...mcqForm, tags: mcqForm.tags.filter((x) => x !== t) })}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn btn-secondary" onClick={closeEditMCQModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={savingMCQ}>
                  {savingMCQ ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Coding Edit Modal ──────────────────────────────────────────────── */}
      {editingCoding && codingForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Edit Coding Question</h3>
              <button type="button" onClick={closeEditCodingModal} className="text-gray-500 hover:text-gray-700 text-xl">×</button>
            </div>

            <form onSubmit={saveCodingQuestion} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  className="input"
                  value={codingForm.title}
                  onChange={(e) => setCodingForm({ ...codingForm, title: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
                <textarea
                  className="input min-h-[120px]"
                  value={codingForm.description}
                  onChange={(e) => setCodingForm({ ...codingForm, description: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Marks *</label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    value={codingForm.marks}
                    onChange={(e) => setCodingForm({ ...codingForm, marks: Number(e.target.value) })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty *</label>
                  <select
                    className="input"
                    value={codingForm.difficulty}
                    onChange={(e) => setCodingForm({ ...codingForm, difficulty: e.target.value as 'easy' | 'medium' | 'hard' })}
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Topic</label>
                  <input
                    type="text"
                    className="input"
                    value={codingForm.topic}
                    onChange={(e) => setCodingForm({ ...codingForm, topic: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Time Limit (ms)</label>
                  <input
                    type="number"
                    className="input"
                    min={100}
                    value={codingForm.timeLimit}
                    onChange={(e) => setCodingForm({ ...codingForm, timeLimit: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Memory Limit (MB)</label>
                  <input
                    type="number"
                    className="input"
                    min={16}
                    value={codingForm.memoryLimit}
                    onChange={(e) => setCodingForm({ ...codingForm, memoryLimit: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Supported Languages *</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_LANGUAGES.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => toggleCodingLanguage(lang)}
                      className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                        codingForm.supportedLanguages.includes(lang)
                          ? 'bg-primary-600 text-white border-primary-600'
                          : 'border-gray-300 text-gray-700 hover:border-primary-400'
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    className="input"
                    value={codingTagInput}
                    onChange={(e) => setCodingTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const t = codingTagInput.trim().toLowerCase();
                        if (t && !codingForm.tags.includes(t)) setCodingForm({ ...codingForm, tags: [...codingForm.tags, t] });
                        setCodingTagInput('');
                      }
                    }}
                    placeholder="Type tag and press Enter"
                  />
                  <button type="button" className="btn btn-secondary" onClick={() => {
                    const t = codingTagInput.trim().toLowerCase();
                    if (t && !codingForm.tags.includes(t)) setCodingForm({ ...codingForm, tags: [...codingForm.tags, t] });
                    setCodingTagInput('');
                  }}>Add</button>
                </div>
                {codingForm.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {codingForm.tags.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm">
                        {t}
                        <button type="button" className="text-gray-500 hover:text-gray-700" onClick={() => setCodingForm({ ...codingForm, tags: codingForm.tags.filter((x) => x !== t) })}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn btn-secondary" onClick={closeEditCodingModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={savingCoding}>
                  {savingCoding ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

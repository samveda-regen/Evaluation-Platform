import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import BackButton from '../../components/BackButton';

interface TestCase {
  input: string;
  expectedOutput: string;
  isHidden: boolean;
  marks: number;
}

const LANGUAGES = ['python', 'javascript', 'java', 'cpp', 'c'];

export default function CodingForm() {
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
  const [loadingQuestion, setLoadingQuestion] = useState(isEditing);

  function buildFormDataFromRecord(record: Record<string, unknown>) {
    return {
      title: typeof record.title === 'string' ? record.title : '',
      description: typeof record.description === 'string' ? record.description : '',
      inputFormat: typeof record.inputFormat === 'string' ? record.inputFormat : '',
      outputFormat: typeof record.outputFormat === 'string' ? record.outputFormat : '',
      constraints: typeof record.constraints === 'string' ? record.constraints : '',
      sampleInput: typeof record.sampleInput === 'string' ? record.sampleInput : '',
      sampleOutput: typeof record.sampleOutput === 'string' ? record.sampleOutput : '',
      marks: typeof record.marks === 'number' ? record.marks : 20,
      timeLimit: typeof record.timeLimit === 'number' ? record.timeLimit : 2000,
      memoryLimit: typeof record.memoryLimit === 'number' ? record.memoryLimit : 256,
      supportedLanguages: Array.isArray(record.supportedLanguages)
        ? record.supportedLanguages.filter((language): language is string => typeof language === 'string')
        : ['python', 'javascript'],
      codeTemplates: record.codeTemplates && typeof record.codeTemplates === 'object' && !Array.isArray(record.codeTemplates)
        ? record.codeTemplates as Record<string, string>
        : {},
      partialScoring: typeof record.partialScoring === 'boolean' ? record.partialScoring : false,
      testCases: Array.isArray(record.testCases) && record.testCases.length
        ? record.testCases as TestCase[]
        : [{ input: '', expectedOutput: '', isHidden: false, marks: 10 }],
      difficulty: typeof record.difficulty === 'string' ? record.difficulty : 'medium',
      topic: typeof record.topic === 'string' ? record.topic : '',
      tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    };
  }

  const [formData, setFormData] = useState(() =>
    isEditing && editQuestion
      ? buildFormDataFromRecord(editQuestion)
      : {
        title: '',
        description: '',
        inputFormat: '',
        outputFormat: '',
        constraints: '',
        sampleInput: '',
        sampleOutput: '',
        marks: 20,
        timeLimit: 2000,
        memoryLimit: 256,
        supportedLanguages: ['python', 'javascript'],
        codeTemplates: {} as Record<string, string>,
        partialScoring: false,
        testCases: [{ input: '', expectedOutput: '', isHidden: false, marks: 10 }] as TestCase[],
        difficulty: 'medium',
        topic: '',
        tags: [] as string[]
      }
  );
  const [tagInput, setTagInput] = useState('');

  // The router-state question (passed by whichever list navigated here) is only used for
  // an instant, non-blank first paint — some callers (the Question Library list view) only
  // have a summary of the question with a test case *count*, not the actual test cases, so
  // relying on it alone silently showed an empty test-case form. Always re-fetch the full
  // question by id here so edits are correct regardless of what the caller happened to pass.
  useEffect(() => {
    if (!isEditing || !questionId) { setLoadingQuestion(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await adminApi.getCodingById(questionId);
        if (!cancelled && data?.question) {
          setFormData(buildFormDataFromRecord(data.question));
        }
      } catch {
        if (!editQuestion) toast.error('Failed to load question details');
      } finally {
        if (!cancelled) setLoadingQuestion(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, questionId]);

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag) return;
    if (!/^[a-z0-9][a-z0-9_\- ]*$/.test(tag)) { toast.error('Tags: letters, numbers, hyphens only'); return; }
    if (!formData.tags.includes(tag)) setFormData({ ...formData, tags: [...formData.tags, tag] });
    setTagInput('');
  };

  const removeTag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      tags: formData.tags.filter((t) => t !== tagToRemove)
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title.trim()) { toast.error('Title is required'); return; }
    if (!formData.description.trim()) { toast.error('Description is required'); return; }
    if (!formData.inputFormat.trim()) { toast.error('Input format is required'); return; }
    if (!formData.outputFormat.trim()) { toast.error('Output format is required'); return; }
    if (!formData.sampleInput.trim()) { toast.error('Sample input is required'); return; }
    if (!formData.sampleOutput.trim()) { toast.error('Sample output is required'); return; }
    if (!Number.isFinite(formData.marks) || formData.marks <= 0) { toast.error('Marks must be greater than 0'); return; }
    if (!Number.isFinite(formData.timeLimit) || formData.timeLimit <= 0) { toast.error('Time limit must be greater than 0'); return; }
    if (!Number.isFinite(formData.memoryLimit) || formData.memoryLimit <= 0) { toast.error('Memory limit must be greater than 0'); return; }
    if (formData.supportedLanguages.length === 0) { toast.error('At least one language is required'); return; }
    if (formData.testCases.length === 0) { toast.error('At least one test case is required'); return; }
    const invalidTestCase = formData.testCases.find(
      tc => !tc.expectedOutput.trim() || !Number.isFinite(tc.marks) || tc.marks <= 0
    );
    if (invalidTestCase) { toast.error('Each test case needs expected output and marks greater than 0'); return; }

    setLoading(true);

    try {
      if (isEditing && questionId) {
        const updatePayload = {
          ...formData,
          difficulty: formData.difficulty as 'easy' | 'medium' | 'hard',
        };
        if (editSource === 'QUESTION_BANK') {
          await adminApi.updateQuestionBankCoding(questionId, updatePayload);
        } else {
          await adminApi.updateCustomCoding(questionId, updatePayload);
        }
        toast.success('Question updated');
        finishNavigation();
      } else {
        if (addToTestId) {
          await adminApi.addCustomQuestionToTest(addToTestId, {
            questionType: 'coding',
            ...formData,
            difficulty: formData.difficulty as 'easy' | 'medium' | 'hard',
          });
        } else {
          await adminApi.createCoding(formData);
        }
        toast.success(addToTestId ? 'Question created and added to test' : 'Question created');
        finishNavigation();
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to save question');
    } finally {
      setLoading(false);
    }
  };

  const toggleLanguage = (lang: string) => {
    const newLanguages = formData.supportedLanguages.includes(lang)
      ? formData.supportedLanguages.filter((l) => l !== lang)
      : [...formData.supportedLanguages, lang];

    if (newLanguages.length === 0) {
      toast.error('At least one language is required');
      return;
    }

    setFormData({ ...formData, supportedLanguages: newLanguages });
  };

  const updateTemplate = (lang: string, template: string) => {
    setFormData({
      ...formData,
      codeTemplates: { ...formData.codeTemplates, [lang]: template }
    });
  };

  const addTestCase = () => {
    setFormData({
      ...formData,
      testCases: [...formData.testCases, { input: '', expectedOutput: '', isHidden: true, marks: 10 }]
    });
  };

  const removeTestCase = (index: number) => {
    if (formData.testCases.length > 1) {
      setFormData({
        ...formData,
        testCases: formData.testCases.filter((_, i) => i !== index)
      });
    }
  };

  const updateTestCase = (index: number, field: keyof TestCase, value: string | boolean | number) => {
    const newTestCases = [...formData.testCases];
    newTestCases[index] = { ...newTestCases[index], [field]: value };
    setFormData({ ...formData, testCases: newTestCases });
  };

  if (loadingQuestion && !editQuestion) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--admin-accent)' }} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start gap-3 mb-6">
        <BackButton mt="0" onClick={finishNavigation} />
        <h1 style={{ fontSize: "32px", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--admin-text)", margin: 0, lineHeight: 1.2 }}>{isEditing ? 'Edit Coding Question' : 'Create Coding Question'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Basic Information</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="input"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="input min-h-[150px]"
                rows={6}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Input Format *</label>
                <textarea
                  value={formData.inputFormat}
                  onChange={(e) => setFormData({ ...formData, inputFormat: e.target.value })}
                  className="input min-h-[80px]"
                  rows={3}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Output Format *</label>
                <textarea
                  value={formData.outputFormat}
                  onChange={(e) => setFormData({ ...formData, outputFormat: e.target.value })}
                  className="input min-h-[80px]"
                  rows={3}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Constraints</label>
              <textarea
                value={formData.constraints}
                onChange={(e) => setFormData({ ...formData, constraints: e.target.value })}
                className="input"
                rows={2}
                placeholder="e.g., 1 <= N <= 1000"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sample Input *</label>
                <textarea
                  value={formData.sampleInput}
                  onChange={(e) => setFormData({ ...formData, sampleInput: e.target.value })}
                  className="input font-mono text-sm"
                  rows={3}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sample Output *</label>
                <textarea
                  value={formData.sampleOutput}
                  onChange={(e) => setFormData({ ...formData, sampleOutput: e.target.value })}
                  className="input font-mono text-sm"
                  rows={3}
                  required
                />
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Settings</h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Marks *</label>
              <input
                type="number"
                value={formData.marks}
                onChange={(e) => setFormData({ ...formData, marks: Number(e.target.value) })}
                className="input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty *</label>
              <div style={{ display:'flex', gap:'8px' }}>
                {(['easy','medium','hard'] as const).map(d => (
                  <button key={d} type="button"
                    onClick={() => setFormData({ ...formData, difficulty: d })}
                    style={{
                      flex:1, padding:'8px 0', borderRadius:'10px', fontSize:'13px', fontWeight:600, cursor:'pointer', transition:'all 0.15s',
                      ...(formData.difficulty === d
                        ? { backgroundColor:'var(--admin-accent-soft)', color:'var(--admin-accent-hover)', border:'1.5px solid var(--admin-accent)' }
                        : { backgroundColor:'#F9FAFB', color:'var(--admin-text-muted)', border:'1.5px solid var(--admin-border)' })
                    }}>
                    {d.charAt(0).toUpperCase()+d.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Time Limit (ms)</label>
              <input
                type="number"
                value={formData.timeLimit}
                onChange={(e) => setFormData({ ...formData, timeLimit: Number(e.target.value) })}
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Memory Limit (MB)</label>
              <input
                type="number"
                value={formData.memoryLimit}
                onChange={(e) => setFormData({ ...formData, memoryLimit: Number(e.target.value) })}
                className="input"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Topic (Optional)</label>
              <input
                type="text"
                value={formData.topic}
                onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                className="input"
                placeholder="e.g., Arrays, Dynamic Programming"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.partialScoring}
                  onChange={(e) => setFormData({ ...formData, partialScoring: e.target.checked })}
                  className="w-4 h-4"
                />
                <span>Enable partial scoring</span>
              </label>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Skills/Tags (Optional)</label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                className="input flex-1"
                placeholder="Type a skill/tag and press Enter"
              />
              <button
                type="button"
                onClick={addTag}
                className="btn btn-secondary"
              >
                Add
              </button>
            </div>
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-primary-100 text-primary-800 rounded-full text-sm"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="text-primary-600 hover:text-primary-800"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Supported Languages</label>
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => toggleLanguage(lang)}
                  className={`px-3 py-1 rounded-full text-sm transition-colors ${
                    formData.supportedLanguages.includes(lang)
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Code Templates (Optional)</h2>
          <p className="text-sm text-gray-500 mb-4">
            Provide starter code for each language. Candidates will see this template when they start the question.
          </p>

          <div className="space-y-4">
            {formData.supportedLanguages.map((lang) => (
              <div key={lang}>
                <label className="block text-sm font-medium text-gray-700 mb-1 capitalize">
                  {lang} Template
                </label>
                <textarea
                  value={formData.codeTemplates[lang] || ''}
                  onChange={(e) => updateTemplate(lang, e.target.value)}
                  className="input font-mono text-sm"
                  rows={6}
                  placeholder={`# Enter starter code for ${lang}...`}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Test Cases</h2>
            <button type="button" onClick={addTestCase} className="btn btn-secondary text-sm">
              + Add Test Case
            </button>
          </div>

          <div className="space-y-4">
            {formData.testCases.map((tc, index) => (
              <div key={index} className="border rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-medium">Test Case {index + 1}</h3>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={tc.isHidden}
                        onChange={(e) => updateTestCase(index, 'isHidden', e.target.checked)}
                        className="w-4 h-4"
                      />
                      Hidden
                    </label>
                    <input
                      type="number"
                      value={tc.marks}
                      onChange={(e) => updateTestCase(index, 'marks', Number(e.target.value))}
                      className="input w-24 text-sm"
                      placeholder="Marks"
                    />
                    {formData.testCases.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTestCase(index)}
                        className="text-red-600 hover:text-red-800"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Input</label>
                    <textarea
                      value={tc.input}
                      onChange={(e) => updateTestCase(index, 'input', e.target.value)}
                      className="input font-mono text-sm"
                      rows={3}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Expected Output</label>
                    <textarea
                      value={tc.expectedOutput}
                      onChange={(e) => updateTestCase(index, 'expectedOutput', e.target.value)}
                      className="input font-mono text-sm"
                      rows={3}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={loading} className="btn btn-primary">
            {loading ? 'Saving...' : 'Create Question'}
          </button>
          <button type="button" onClick={finishNavigation} className="btn btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

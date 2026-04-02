import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';

interface TestCase {
  input: string;
  expectedOutput: string;
  isHidden: boolean;
  marks: number;
}

const LANGUAGES = ['python', 'javascript', 'java', 'cpp', 'c'];

export default function CodingForm() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
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
  });
  const [tagInput, setTagInput] = useState('');

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !formData.tags.includes(tag)) {
      setFormData({ ...formData, tags: [...formData.tags, tag] });
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      tags: formData.tags.filter((t) => t !== tagToRemove)
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.testCases.length === 0) {
      toast.error('At least one test case is required');
      return;
    }

    setLoading(true);

    try {
      await adminApi.createCoding(formData);
      toast.success('Question created');
      navigate('/admin/repository/custom');
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

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Create Coding Question</h1>

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
                min={1}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty *</label>
              <select
                value={formData.difficulty}
                onChange={(e) => setFormData({ ...formData, difficulty: e.target.value })}
                className="input"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Time Limit (ms)</label>
              <input
                type="number"
                value={formData.timeLimit}
                onChange={(e) => setFormData({ ...formData, timeLimit: Number(e.target.value) })}
                className="input"
                min={100}
                max={30000}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Memory Limit (MB)</label>
              <input
                type="number"
                value={formData.memoryLimit}
                onChange={(e) => setFormData({ ...formData, memoryLimit: Number(e.target.value) })}
                className="input"
                min={16}
                max={512}
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
                      min={0}
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
          <button type="button" onClick={() => navigate('/admin/repository/custom')} className="btn btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

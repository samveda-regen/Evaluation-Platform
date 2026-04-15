import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../../services/api';
import type {
  Pagination,
  RepositoryCategory,
  RepositoryBehavioralQuestion,
  RepositoryCodingQuestion,
  RepositoryMCQQuestion,
  RepositoryQuestion
} from '../../../types';

type EnabledFilter = 'all' | 'enabled' | 'disabled';

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

function isBehavioralQuestion(question: RepositoryQuestion): question is RepositoryBehavioralQuestion {
  return question.repositoryCategory === 'BEHAVIORAL';
}

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

  const [isBehavioralModalOpen, setIsBehavioralModalOpen] = useState(false);
  const [editingBehavioralId, setEditingBehavioralId] = useState<string | null>(null);
  const [behavioralForm, setBehavioralForm] =
    useState<BehavioralFormState>(DEFAULT_BEHAVIORAL_FORM);
  const [behavioralTagInput, setBehavioralTagInput] = useState('');
  const [savingBehavioral, setSavingBehavioral] = useState(false);

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
          enabledFilter === 'enabled'
            ? true
            : enabledFilter === 'disabled'
            ? false
            : undefined
      });
      setQuestions(data.questions);
      setPagination(data.pagination);
    } catch (error) {
      toast.error('Failed to load custom questions');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (question: RepositoryQuestion) => {
    if (!confirm('Are you sure you want to delete this question?')) {
      return;
    }

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

  const openCreateBehavioralModal = () => {
    setBehavioralForm(DEFAULT_BEHAVIORAL_FORM);
    setBehavioralTagInput('');
    setEditingBehavioralId(null);
    setIsBehavioralModalOpen(true);
  };

  const openEditBehavioralModal = (question: RepositoryBehavioralQuestion) => {
    setBehavioralForm({
      title: question.title,
      description: question.description,
      expectedAnswer: question.expectedAnswer ?? '',
      marks: question.marks,
      difficulty: question.difficulty,
      topic: question.topic ?? '',
      tags: question.tags ?? []
    });
    setBehavioralTagInput('');
    setEditingBehavioralId(question.id);
    setIsBehavioralModalOpen(true);
  };

  const closeBehavioralModal = () => {
    setIsBehavioralModalOpen(false);
    setBehavioralForm(DEFAULT_BEHAVIORAL_FORM);
    setBehavioralTagInput('');
    setEditingBehavioralId(null);
  };

  const addBehavioralTag = () => {
    const newTag = behavioralTagInput.trim().toLowerCase();
    if (!newTag || behavioralForm.tags.includes(newTag)) {
      return;
    }

    setBehavioralForm((prev) => ({ ...prev, tags: [...prev.tags, newTag] }));
    setBehavioralTagInput('');
  };

  const removeBehavioralTag = (tagToRemove: string) => {
    setBehavioralForm((prev) => ({
      ...prev,
      tags: prev.tags.filter((item) => item !== tagToRemove)
    }));
  };

  const saveBehavioralQuestion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!behavioralForm.title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!behavioralForm.description.trim()) {
      toast.error('Description is required');
      return;
    }
    if (behavioralForm.marks < 1) {
      toast.error('Marks must be greater than 0');
      return;
    }

    setSavingBehavioral(true);
    try {
      if (editingBehavioralId) {
        await adminApi.updateCustomRepositoryQuestion(editingBehavioralId, 'BEHAVIORAL', {
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
            <button
              type="button"
              onClick={openCreateBehavioralModal}
              className="btn btn-primary"
            >
              Create Behavioral
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {CATEGORY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setCategory(option.value);
                setPage(1);
              }}
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
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            value={difficulty}
            onChange={(e) => {
              setDifficulty(e.target.value);
              setPage(1);
            }}
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
            onChange={(e) => {
              setTopic(e.target.value);
              setPage(1);
            }}
          />
          <input
            type="text"
            placeholder="Tag"
            className="input"
            value={tag}
            onChange={(e) => {
              setTag(e.target.value);
              setPage(1);
            }}
          />
          <select
            value={enabledFilter}
            onChange={(e) => {
              setEnabledFilter(e.target.value as EnabledFilter);
              setPage(1);
            }}
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
                      <span
                        className={`badge ${
                          question.isEnabled ? 'badge-success' : 'badge-danger'
                        }`}
                      >
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
                    {isMCQQuestion(question) && (
                      <Link
                        to={`/admin/mcq/${question.id}/edit`}
                        className="btn btn-secondary text-sm"
                      >
                        Edit
                      </Link>
                    )}
                    {isCodingQuestion(question) && (
                      <Link
                        to={`/admin/coding/${question.id}/edit`}
                        className="btn btn-secondary text-sm"
                      >
                        Edit
                      </Link>
                    )}
                    {isBehavioralQuestion(question) && (
                      <button
                        type="button"
                        onClick={() => openEditBehavioralModal(question)}
                        className="btn btn-secondary text-sm"
                      >
                        Edit
                      </button>
                    )}
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
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                className="btn btn-secondary"
              >
                Previous
              </button>
              <span className="py-2 px-4">
                Page {page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page === pagination.totalPages}
                className="btn btn-secondary"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {isBehavioralModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                {editingBehavioralId ? 'Edit Behavioral Question' : 'Create Behavioral Question'}
              </h3>
              <button
                type="button"
                onClick={closeBehavioralModal}
                className="text-gray-500 hover:text-gray-700 text-xl"
              >
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
                  onChange={(e) =>
                    setBehavioralForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description *
                </label>
                <textarea
                  className="input min-h-[120px]"
                  value={behavioralForm.description}
                  onChange={(e) =>
                    setBehavioralForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected Answer (Optional)
                </label>
                <textarea
                  className="input min-h-[100px]"
                  value={behavioralForm.expectedAnswer}
                  onChange={(e) =>
                    setBehavioralForm((prev) => ({ ...prev, expectedAnswer: e.target.value }))
                  }
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
                    onChange={(e) =>
                      setBehavioralForm((prev) => ({
                        ...prev,
                        marks: Number(e.target.value)
                      }))
                    }
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Difficulty *
                  </label>
                  <select
                    className="input"
                    value={behavioralForm.difficulty}
                    onChange={(e) =>
                      setBehavioralForm((prev) => ({
                        ...prev,
                        difficulty: e.target.value as 'easy' | 'medium' | 'hard'
                      }))
                    }
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
                    onChange={(e) =>
                      setBehavioralForm((prev) => ({ ...prev, topic: e.target.value }))
                    }
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
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addBehavioralTag();
                      }
                    }}
                    placeholder="Type tag and press Enter"
                  />
                  <button type="button" className="btn btn-secondary" onClick={addBehavioralTag}>
                    Add
                  </button>
                </div>

                {behavioralForm.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {behavioralForm.tags.map((item) => (
                      <span
                        key={item}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"
                      >
                        {item}
                        <button
                          type="button"
                          className="text-gray-500 hover:text-gray-700"
                          onClick={() => removeBehavioralTag(item)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn btn-secondary" onClick={closeBehavioralModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingBehavioral}>
                  {savingBehavioral
                    ? 'Saving...'
                    : editingBehavioralId
                    ? 'Update Question'
                    : 'Create Question'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

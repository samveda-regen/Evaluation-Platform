import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../../services/api';
import type {
  Pagination,
  RepositoryCategory,
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

export default function QuestionBank() {
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
  const [copyingId, setCopyingId] = useState<string | null>(null);

  useEffect(() => {
    void loadQuestions();
  }, [category, page, search, difficulty, topic, tag, enabledFilter]);

  const loadQuestions = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.getQuestionBankQuestions({
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
      toast.error('Failed to load library');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleQuestion = async (question: RepositoryQuestion) => {
    try {
      if (question.isEnabled) {
        await adminApi.disableQuestionBankQuestion(question.id, category);
        toast.success('Question disabled');
      } else {
        await adminApi.enableQuestionBankQuestion(question.id, category);
        toast.success('Question enabled');
      }
      await loadQuestions();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to update question status');
    }
  };

  const handleCopyQuestion = async (question: RepositoryQuestion) => {
    setCopyingId(question.id);
    try {
      await adminApi.copyQuestionBankQuestion(question.id, question.repositoryCategory);
      toast.success('Question copied to Custom Questions');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to copy question');
    } finally {
      setCopyingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold">Library</h2>
            <p className="text-sm text-gray-600">
              Read-only master repository. You can enable or disable questions.
            </p>
          </div>
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
          <p className="text-gray-500">No library items found for current filters.</p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {questions.map((question) => (
              <div key={question.id} className="card">
                <div className="flex flex-col gap-4">
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
                      <button
                        type="button"
                        onClick={() => handleCopyQuestion(question)}
                        className="btn btn-secondary text-sm"
                        disabled={copyingId === question.id}
                      >
                        {copyingId === question.id ? 'Copying...' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleQuestion(question)}
                        className="btn btn-secondary text-sm"
                      >
                        {question.isEnabled ? 'Disable' : 'Enable'}
                      </button>
                    </div>
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
    </div>
  );
}

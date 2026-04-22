import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { format } from 'date-fns';
import { violationLabel } from '../../utils/violationLabels';

interface AttemptData {
  attempt: {
    id: string;
    startTime: string;
    endTime?: string;
    submittedAt?: string;
    status: string;
    score?: number;
    violations: number;
    isFlagged: boolean;
    flagReason?: string;
  };
  test: {
    id: string;
    name: string;
    testCode: string;
    totalMarks: number;
    passingMarks?: number;
    negativeMarking: number;
  };
  candidate: {
    id: string;
    email: string;
    name: string;
  };
  mcqAnswers: Array<{
    questionId: string;
    questionText: string;
    options: string[];
    correctAnswers: number[];
    selectedOptions: number[];
    isCorrect: boolean;
    marks: number;
    marksObtained: number;
  }>;
  codingAnswers: Array<{
    questionId: string;
    title: string;
    code: string;
    language: string;
    testResults: Array<{ testCaseId: string; passed: boolean; error?: string }> | null;
    marks: number;
    marksObtained: number;
  }>;
  behavioralAnswers: Array<{
    questionId: string;
    title: string;
    description: string;
    answerText: string;
    marks: number;
    marksObtained?: number | null;
  }>;
  activityLogs: Array<{
    id: string;
    eventType: string;
    eventData?: string;
    timestamp: string;
  }>;
}

export default function AttemptDetails() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<AttemptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'mcq' | 'coding' | 'behavioral' | 'activity'>('mcq');
  const [reEvaluating, setReEvaluating] = useState(false);
  const [behavioralDrafts, setBehavioralDrafts] = useState<Record<string, string>>({});
  const [savingBehavioralQuestionId, setSavingBehavioralQuestionId] = useState<string | null>(null);

  useEffect(() => {
    loadAttempt();
  }, [attemptId]);

  useEffect(() => {
    if (!data) {
      return;
    }

    setBehavioralDrafts(
      Object.fromEntries(
        data.behavioralAnswers.map((answer) => [
          answer.questionId,
          answer.marksObtained != null ? String(answer.marksObtained) : ''
        ])
      )
    );
  }, [data]);

  const loadAttempt = async () => {
    try {
      const { data } = await adminApi.getAttemptDetails(attemptId!);
      setData(data);
    } catch (error) {
      toast.error('Failed to load attempt details');
      navigate(-1);
    } finally {
      setLoading(false);
    }
  };

  const handleFlag = async () => {
    if (!data) return;

    const reason = prompt('Enter flag reason (optional):');
    try {
      await adminApi.flagAttempt(attemptId!, {
        isFlagged: !data.attempt.isFlagged,
        reason: reason || undefined
      });
      toast.success(data.attempt.isFlagged ? 'Flag removed' : 'Attempt flagged');
      loadAttempt();
    } catch (error) {
      toast.error('Failed to update flag');
    }
  };

  const handleReEvaluate = async () => {
    if (!confirm('Re-evaluate this attempt? This will recalculate the score.')) return;

    setReEvaluating(true);
    try {
      const { data } = await adminApi.reEvaluateAttempt(attemptId!);
      toast.success(`Re-evaluation complete. New score: ${data.newScore}`);
      loadAttempt();
    } catch (error) {
      toast.error('Failed to re-evaluate');
    } finally {
      setReEvaluating(false);
    }
  };

  const handleBehavioralScoreChange = (questionId: string, value: string) => {
    setBehavioralDrafts((current) => ({
      ...current,
      [questionId]: value
    }));
  };

  const handleBehavioralScoreSave = async (questionId: string, maxMarks: number) => {
    const rawValue = behavioralDrafts[questionId] ?? '';
    const parsedMarks = Number(rawValue);

    if (rawValue.trim() === '' || !Number.isFinite(parsedMarks)) {
      toast.error('Enter a valid behavioral score before saving');
      return;
    }

    if (parsedMarks < 0 || parsedMarks > maxMarks) {
      toast.error(`Behavioral score must be between 0 and ${maxMarks}`);
      return;
    }

    setSavingBehavioralQuestionId(questionId);
    try {
      await adminApi.gradeBehavioralAnswer(attemptId!, questionId, {
        marksObtained: parsedMarks
      });
      toast.success('Behavioral score saved');
      await loadAttempt();
    } catch (error) {
      toast.error('Failed to save behavioral score');
    } finally {
      setSavingBehavioralQuestionId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!data) return null;

  const { attempt, test, candidate, mcqAnswers, codingAnswers, behavioralAnswers, activityLogs } = data;

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Attempt Details</h1>
          <p className="text-gray-600">{test.name}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleFlag}
            className={`btn ${attempt.isFlagged ? 'btn-success' : 'btn-danger'}`}
          >
            {attempt.isFlagged ? 'Remove Flag' : 'Flag Attempt'}
          </button>
          <button
            onClick={handleReEvaluate}
            disabled={reEvaluating}
            className="btn btn-secondary"
          >
            {reEvaluating ? 'Re-evaluating...' : 'Re-evaluate'}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <p className="text-sm text-gray-600">Candidate</p>
          <p className="font-medium">{candidate.name}</p>
          <p className="text-sm text-gray-500">{candidate.email}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-600">Score</p>
          <p className="text-2xl font-bold">
            {attempt.score ?? '-'}
            <span className="text-base text-gray-500">/{test.totalMarks}</span>
          </p>
          {test.passingMarks && (
            <p className={`text-sm ${(attempt.score || 0) >= test.passingMarks ? 'text-green-600' : 'text-red-600'}`}>
              {(attempt.score || 0) >= test.passingMarks ? 'Passed' : 'Failed'}
            </p>
          )}
        </div>
        <div className="card">
          <p className="text-sm text-gray-600">Status</p>
          <span className={`badge ${
            attempt.status === 'submitted' ? 'badge-success' :
            attempt.status === 'auto_submitted' ? 'badge-warning' : 'badge-info'
          }`}>
            {attempt.status.replace('_', ' ')}
          </span>
          {attempt.isFlagged && (
            <p className="text-sm text-red-600 mt-1">
              Flagged: {attempt.flagReason || 'No reason'}
            </p>
          )}
        </div>
        <div className="card">
          <p className="text-sm text-gray-600">Violations</p>
          <p className={`text-2xl font-bold ${attempt.violations > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {attempt.violations}
          </p>
        </div>
      </div>

      {/* Time Info */}
      <div className="card mb-6">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-600">Start Time</p>
            <p className="font-medium">{format(new Date(attempt.startTime), 'PPpp')}</p>
          </div>
          <div>
            <p className="text-gray-600">End Time</p>
            <p className="font-medium">
              {attempt.endTime ? format(new Date(attempt.endTime), 'PPpp') : '-'}
            </p>
          </div>
          <div>
            <p className="text-gray-600">Submitted At</p>
            <p className="font-medium">
              {attempt.submittedAt ? format(new Date(attempt.submittedAt), 'PPpp') : '-'}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b mb-6">
        <button
          onClick={() => setActiveTab('mcq')}
          className={`pb-2 px-1 ${activeTab === 'mcq' ? 'border-b-2 border-primary-600 text-primary-600' : 'text-gray-600'}`}
        >
          MCQ Answers ({mcqAnswers.length})
        </button>
        <button
          onClick={() => setActiveTab('coding')}
          className={`pb-2 px-1 ${activeTab === 'coding' ? 'border-b-2 border-primary-600 text-primary-600' : 'text-gray-600'}`}
        >
          Coding Answers ({codingAnswers.length})
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`pb-2 px-1 ${activeTab === 'activity' ? 'border-b-2 border-primary-600 text-primary-600' : 'text-gray-600'}`}
        >
          Activity Log ({activityLogs.length})
        </button>
        <button
          onClick={() => setActiveTab('behavioral')}
          className={`pb-2 px-1 ${activeTab === 'behavioral' ? 'border-b-2 border-primary-600 text-primary-600' : 'text-gray-600'}`}
        >
          Behavioral Answers ({behavioralAnswers.length})
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'mcq' && (
        <div className="space-y-4">
          {mcqAnswers.length === 0 ? (
            <p className="text-gray-500">No MCQ answers</p>
          ) : (
            mcqAnswers.map((answer, idx) => (
              <div key={answer.questionId} className={`card border-l-4 ${answer.isCorrect ? 'border-green-500' : 'border-red-500'}`}>
                <div className="flex justify-between items-start mb-2">
                  <span className="text-sm text-gray-500">Q{idx + 1}</span>
                  <span className={`badge ${answer.isCorrect ? 'badge-success' : 'badge-danger'}`}>
                    {answer.marksObtained}/{answer.marks} marks
                  </span>
                </div>
                <p className="font-medium mb-3">{answer.questionText}</p>
                <div className="space-y-1">
                  {answer.options.map((opt, optIdx) => {
                    const isSelected = answer.selectedOptions.includes(optIdx);
                    const isCorrect = answer.correctAnswers.includes(optIdx);
                    return (
                      <div
                        key={optIdx}
                        className={`p-2 rounded text-sm ${
                          isCorrect ? 'bg-green-50 border border-green-200' :
                          isSelected ? 'bg-red-50 border border-red-200' : 'bg-gray-50'
                        }`}
                      >
                        {isSelected && <span className="mr-2">✓</span>}
                        {opt}
                        {isCorrect && <span className="ml-2 text-green-600">(Correct)</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'coding' && (
        <div className="space-y-4">
          {codingAnswers.length === 0 ? (
            <p className="text-gray-500">No coding answers</p>
          ) : (
            codingAnswers.map((answer) => (
              <div key={answer.questionId} className="card">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-medium">{answer.title}</h3>
                  <span className="badge badge-info">
                    {answer.marksObtained}/{answer.marks} marks
                  </span>
                </div>
                <p className="text-sm text-gray-600 mb-2">Language: {answer.language}</p>
                <div className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
                  <pre className="text-sm font-mono whitespace-pre-wrap">{answer.code}</pre>
                </div>
                {answer.testResults && (
                  <div className="mt-4">
                    <p className="text-sm font-medium mb-2">Test Results:</p>
                    <div className="flex flex-wrap gap-2">
                      {answer.testResults.map((result, idx) => (
                        <span
                          key={idx}
                          className={`badge ${result.passed ? 'badge-success' : 'badge-danger'}`}
                        >
                          Test {idx + 1}: {result.passed ? 'Passed' : 'Failed'}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'behavioral' && (
        <div className="space-y-4">
          {behavioralAnswers.length === 0 ? (
            <p className="text-gray-500">No behavioral answers</p>
          ) : (
            behavioralAnswers.map((answer) => (
              <div key={answer.questionId} className="card">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-medium">{answer.title}</h3>
                  <span className="badge badge-info">
                    {answer.marksObtained ?? '-'} / {answer.marks} marks
                  </span>
                </div>
                <p className="text-sm text-gray-600 mb-3">{answer.description}</p>
                <div className="bg-gray-50 border rounded-lg p-4">
                  <p className="text-sm text-gray-500 mb-1">Candidate Response</p>
                  <p className="whitespace-pre-wrap text-gray-800">
                    {answer.answerText || 'No response provided.'}
                  </p>
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="flex-1">
                    <span className="block text-sm font-medium text-gray-700 mb-1">
                      Awarded Marks
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={answer.marks}
                      step="0.01"
                      value={behavioralDrafts[answer.questionId] ?? ''}
                      onChange={(e) => handleBehavioralScoreChange(answer.questionId, e.target.value)}
                      className="input w-full"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={savingBehavioralQuestionId === answer.questionId}
                    onClick={() => handleBehavioralScoreSave(answer.questionId, answer.marks)}
                  >
                    {savingBehavioralQuestionId === answer.questionId ? 'Saving...' : 'Save Score'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'activity' && (
        <div className="card">
          {activityLogs.length === 0 ? (
            <p className="text-gray-500">No activity logs</p>
          ) : (
            <div className="space-y-2">
              {activityLogs.map((log) => (
                <div
                  key={log.id}
                  className={`flex items-center gap-4 p-2 rounded ${
                    ['tab_switch', 'focus_loss', 'fullscreen_exit'].includes(log.eventType)
                      ? 'bg-red-50'
                      : 'bg-gray-50'
                  }`}
                >
                  <span className="text-xs text-gray-500 w-40">
                    {format(new Date(log.timestamp), 'h:mm:ss a')}
                  </span>
                  <span className={`badge ${
                    ['tab_switch', 'focus_loss', 'fullscreen_exit'].includes(log.eventType)
                      ? 'badge-danger'
                      : 'badge-info'
                  }`}>
                    {violationLabel(log.eventType)}
                  </span>
                  {log.eventData && (
                    <span className="text-sm text-gray-600">{log.eventData}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

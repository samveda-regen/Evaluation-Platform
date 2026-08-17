import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTestStore } from '../../context/testStore';
import { useAuthStore } from '../../context/authStore';

function formatTimeTaken(startTime: Date | null): string {
  if (!startTime) return '–';
  const ms = Date.now() - new Date(startTime).getTime();
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatSubmittedAt(): string {
  return new Date().toLocaleString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
    month: 'short', day: 'numeric',
  }).replace(',', ' ·');
}

export default function TestComplete() {
  const navigate = useNavigate();
  const { resetTest } = useTestStore();
  const { logoutCandidate, candidate } = useAuthStore();
  const {
    testName,
    questions,
    mcqAnswers,
    codingAnswers,
    behavioralAnswers,
    startTime,
    submissionResult,
  } = useTestStore();

  const [submittedAt] = useState(() => formatSubmittedAt());

  useEffect(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const answeredCount = questions.filter((q) => {
    if (q.type === 'mcq') return (mcqAnswers[q.questionId]?.length || 0) > 0;
    if (q.type === 'coding') return !!codingAnswers[q.questionId]?.code;
    return (behavioralAnswers[q.questionId] || '').trim().length > 0;
  }).length;

  const timeTaken = formatTimeTaken(startTime);

  const resultDetail = submissionResult?.showScore && submissionResult.score !== undefined
    ? `${submissionResult.score}/${submissionResult.totalMarks}` + (
        submissionResult.passed === true ? ' · Passed' :
        submissionResult.passed === false ? ' · Not passed' : ''
      )
    : 'Pending review';

  // SEB's user agent always includes "SEB" as its own token alongside the underlying
  // engine's UA string (e.g. "...SEB/3.6.0 (...)..."). Used to only redirect to the SEB
  // quit link when actually running inside SEB — a candidate testing in a normal browser
  // should just go back to the login page like before.
  const isRunningInSEB = () => /SEB[/ ]/i.test(navigator.userAgent) || navigator.userAgent.includes('SafeExamBrowser');

  const handleClose = () => {
    // Read before resetTest()/logoutCandidate() clear things out below.
    const sebQuitUrl = localStorage.getItem('sebQuitUrl');
    resetTest();
    logoutCandidate();
    localStorage.removeItem('attemptId');
    localStorage.removeItem('attemptStartTime');
    localStorage.removeItem('sebQuitUrl');
    if (isRunningInSEB() && sebQuitUrl) {
      // SEB watches for navigation to this exact URL (the same string sebConfigService.ts
      // used as the .seb file's quitURL — anything else gets hard-blocked by the URL
      // filter's auto-allow-only-the-startURL rule) and intercepts it to quit the browser
      // instead of loading it — must be a real navigation, not client-side routing.
      window.location.href = sebQuitUrl;
      return;
    }
    navigate('/test/login');
  };

  const handleDownloadReceipt = () => {
    const lines = [
      'ASSESSMENT RECEIPT',
      '==================',
      '',
      `Candidate   : ${candidate?.name || 'N/A'}`,
      `Email       : ${candidate?.email || 'N/A'}`,
      `Assessment  : ${testName || 'N/A'}`,
      `Submitted   : ${submittedAt}`,
      `Answered    : ${answeredCount} / ${questions.length}`,
      `Time taken  : ${timeTaken}`,
      '',
      'Status      : Submitted successfully',
      'Next steps  : You will be notified by email',
      '',
      '==================',
      'This receipt was generated automatically.',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `assessment-receipt-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const firstName = candidate?.name?.split(' ')[0] || 'there';

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: 'var(--admin-border)' }}
    >
      {/* Icon */}
      <div
        className="w-20 h-20 rounded-3xl flex items-center justify-center mb-6 shadow-lg"
        style={{ background: 'linear-gradient(135deg, var(--admin-accent) 0%, var(--admin-accent-hover) 100%)' }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-10 h-10 text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>

      {/* Title */}
      <h1 className="text-3xl font-extrabold text-gray-900 mb-3 text-center">
        Assessment submitted
      </h1>

      {/* Subtitle */}
      <p className="text-gray-500 text-center mb-8 max-w-sm leading-relaxed">
        Thank you, {firstName}. Your responses for{' '}
        <span className="font-bold text-gray-800">{testName || 'this assessment'}</span>{' '}
        have been recorded successfully.
      </p>

      {/* Stats card */}
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-sm mb-4 overflow-hidden"
        style={{ border: '1px solid var(--admin-border)' }}
      >
        <div className="grid grid-cols-2">
          {/* Answered */}
          <div className="flex flex-col items-center py-6 px-4 gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="var(--admin-accent)"
              strokeWidth={1.8}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <span className="text-2xl font-bold text-gray-900">
              {answeredCount}/{questions.length || '–'}
            </span>
            <span className="text-xs text-gray-400">Answered</span>
          </div>

          {/* Time taken */}
          <div className="flex flex-col items-center py-6 px-4 gap-2" style={{ borderLeft: '1px solid var(--admin-border)' }}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="var(--admin-accent)"
              strokeWidth={1.8}
            >
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
            </svg>
            <span className="text-2xl font-bold text-gray-900">{timeTaken}</span>
            <span className="text-xs text-gray-400">Time taken</span>
          </div>

        </div>
      </div>

      {/* Status steps card */}
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-sm mb-8 px-6 py-5 space-y-4"
        style={{ border: '1px solid var(--admin-border)' }}
      >
        {[
          { label: 'Submission confirmed', detail: `Today, ${submittedAt.split('·')[1]?.trim() || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}` },
          { label: 'Results', detail: resultDetail },
          { label: 'Next steps', detail: "You'll be notified by email" },
        ].map(({ label, detail }) => (
          <div key={label} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--admin-accent-disabled)' }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-3.5 h-3.5"
                  viewBox="0 0 20 20"
                  fill="var(--admin-accent)"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
              <span className="text-sm font-medium text-gray-700">{label}</span>
            </div>
            <span className="text-sm text-gray-400">{detail}</span>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={handleClose}
          className="px-6 py-2.5 rounded-xl text-sm font-semibold text-gray-700 bg-white transition-colors hover:bg-gray-50"
          style={{ border: '1.5px solid #D1D5DB' }}
        >
          Close
        </button>
        <button
          onClick={handleDownloadReceipt}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'var(--admin-accent)' }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download receipt
        </button>
      </div>

      {/* TEMPORARY diagnostic — remove once the SEB quit-on-Close issue is confirmed
          fixed. Shows why Close isn't exiting SEB instead of us only being able to guess. */}
      <div
        className="text-left w-full rounded px-3 py-2 mb-6"
        style={{ background: '#1E293B', fontSize: '10px', lineHeight: 1.5, color: '#F59E0B', fontFamily: 'monospace', wordBreak: 'break-all' }}
      >
        <div>userAgent: {navigator.userAgent}</div>
        <div>isRunningInSEB: {String(isRunningInSEB())}</div>
        <div>sebQuitUrl: {localStorage.getItem('sebQuitUrl') || '(none)'}</div>
      </div>

      {/* Footer */}
      <p className="text-xs text-gray-400 text-center">
        You may now safely close this window.{' '}
        Questions?{' '}
        <a
          href="mailto:connect@hria.io"
          className="font-medium"
          style={{ color: 'var(--admin-accent)' }}
        >
          connect@hria.io
        </a>
      </p>
    </div>
  );
}

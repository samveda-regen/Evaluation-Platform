import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTestStore } from '../../context/testStore';
import { useAuthStore } from '../../context/authStore';

export default function TestComplete() {
  const navigate = useNavigate();
  const resetTest = useTestStore((state) => state.resetTest);
  const logoutCandidate = useAuthStore((state) => state.logoutCandidate);

  useEffect(() => {
    // Exit fullscreen if still active
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const handleExit = () => {
    resetTest();
    logoutCandidate();
    localStorage.removeItem('attemptId');
    localStorage.removeItem('attemptStartTime');
    navigate('/test/login');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-600 to-teal-700 flex items-center justify-center p-4">
      <div className="card w-full max-w-md text-center">
        <div className="text-6xl mb-6">🎉</div>

        <h1 className="text-3xl font-bold text-gray-800 mb-4">
          Test Submitted!
        </h1>

        <p className="text-gray-600 mb-6">
          Your test has been successfully submitted. Thank you for completing the test.
        </p>

        <div className="bg-blue-50 rounded-lg p-4 mb-6 text-left">
          <h3 className="font-medium text-blue-800 mb-2">What's Next?</h3>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Your answers have been recorded</li>
            <li>• A reviewer will evaluate your submission</li>
            <li>• You will be notified of your results by your instructor</li>
          </ul>
        </div>

        <button onClick={handleExit} className="btn btn-primary w-full">
          Exit Test
        </button>
      </div>
    </div>
  );
}

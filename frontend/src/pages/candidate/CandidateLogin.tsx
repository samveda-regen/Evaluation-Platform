import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { candidateApi } from '../../services/api';
import { useAuthStore } from '../../context/authStore';

export default function CandidateLogin() {
  const [searchParams] = useSearchParams();
  const invitationToken = searchParams.get('token')?.trim() || '';
  const [invitationLoading, setInvitationLoading] = useState(false);
  const navigate = useNavigate();
  const setCandidate = useAuthStore((state) => state.setCandidate);

  const handleInvitationStart = async () => {
    if (!invitationToken) {
      toast.error('Invalid invitation token');
      return;
    }

    setInvitationLoading(true);

    try {
      const { data } = await candidateApi.loginWithInvitation({ token: invitationToken });
      setCandidate(data.candidate, data.token);

      localStorage.setItem('attemptId', data.attempt.id);
      localStorage.setItem('attemptStartTime', data.attempt.startTime);

      toast.success(data.message || 'Invitation accepted');
      navigate('/test/instructions');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Unable to start test from invitation');
    } finally {
      setInvitationLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-600 to-teal-700 flex items-center justify-center p-4">
      <div className="card w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Candidate Portal</h1>
          <p className="text-gray-600 mt-2">Continue to your invited test using your invitation link.</p>
        </div>

        {invitationToken ? (
          <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h3 className="font-medium text-blue-900">Invitation Detected</h3>
            <p className="text-sm text-blue-800 mt-1 mb-3">
              Continue with your invitation link to access the test directly.
            </p>
            <button
              type="button"
              onClick={handleInvitationStart}
              disabled={invitationLoading}
              className="btn btn-primary w-full"
            >
              {invitationLoading ? 'Preparing Test...' : 'Continue from Invitation'}
            </button>
          </div>
        ) : (
          <div className="mb-6 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <h3 className="font-medium text-yellow-900">Invitation Required</h3>
            <p className="text-sm text-yellow-800 mt-1">
              Open the invitation URL sent to your email to continue.
            </p>
          </div>
        )}

        <div className="mt-6 p-4 bg-yellow-50 rounded-lg">
          <h3 className="font-medium text-yellow-800 mb-2">Before you begin:</h3>
          <ul className="text-sm text-yellow-700 space-y-1">
            <li>Ensure you have a stable internet connection</li>
            <li>Use a desktop or laptop computer</li>
            <li>Close all other browser tabs and applications</li>
            <li>The test must be taken in full-screen mode</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';

import { candidateApi } from '../../services/api';
import { useAuthStore } from '../../context/authStore';

interface InvitationDetailsResponse {
  invitation: {
    name: string;
    email: string;
  };
  test: {
    id: string;
    name: string;
    description: string | null;
    duration: number;
    startTime: string;
    endTime: string | null;
    isActive: boolean;
  };
}

export default function TestInvitation() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const setCandidate = useAuthStore((state) => state.setCandidate);

  const [details, setDetails] = useState<InvitationDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadInvitation = async () => {
      if (!token) {
        setError('Invalid invitation link.');
        setLoading(false);
        return;
      }

      try {
        const { data } = await candidateApi.getInvitationDetails(token);
        setDetails(data);
      } catch (err: unknown) {
        const typedError = err as { response?: { data?: { error?: string } } };
        setError(typedError.response?.data?.error || 'Failed to load invitation details.');
      } finally {
        setLoading(false);
      }
    };

    loadInvitation();
  }, [token]);

  const handleStartFromInvitation = async () => {
    if (!token) {
      toast.error('Invalid invitation token');
      return;
    }

    setStarting(true);

    try {
      const { data } = await candidateApi.loginWithInvitation({ token });
      setCandidate(data.candidate, data.token);

      localStorage.setItem('attemptId', data.attempt.id);
      localStorage.setItem('attemptStartTime', data.attempt.startTime);

      toast.success(data.message || 'Invitation accepted');
      navigate('/test/instructions');
    } catch (err: unknown) {
      const typedError = err as { response?: { data?: { error?: string } } };
      toast.error(typedError.response?.data?.error || 'Unable to start test from invitation');
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="card w-full max-w-lg text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-3">Invitation Unavailable</h1>
          <p className="text-gray-600 mb-6">{error || 'This invitation is invalid or expired.'}</p>
          <Link to="/test/login" className="btn btn-primary">
            Go to Test Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center p-4">
      <div className="card w-full max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Test Invitation</h1>
        <p className="text-gray-600 mb-6">You were invited to take the following test.</p>

        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">{details.test.name}</h2>
          {details.test.description && (
            <p className="text-sm text-gray-600 mt-1">{details.test.description}</p>
          )}
          <div className="grid sm:grid-cols-2 gap-3 mt-4 text-sm text-gray-700">
            <p>Duration: <span className="font-medium">{details.test.duration} minutes</span></p>
            <p>Starts: <span className="font-medium">{new Date(details.test.startTime).toLocaleString()}</span></p>
            {details.test.endTime && (
              <p>Ends: <span className="font-medium">{new Date(details.test.endTime).toLocaleString()}</span></p>
            )}
            <p>Status: <span className="font-medium">{details.test.isActive ? 'Active' : 'Inactive'}</span></p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={details.invitation.name}
              readOnly
              className="input bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={details.invitation.email}
              readOnly
              className="input bg-gray-50"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleStartFromInvitation}
            disabled={starting}
            className="btn btn-primary"
          >
            {starting ? 'Preparing Test...' : 'Start Test'}
          </button>
          <Link to={token ? `/test/login?token=${encodeURIComponent(token)}` : '/test/login'} className="btn btn-secondary">
            Sign Up / Log In
          </Link>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { candidateApi } from '../../services/api';
import { useAuthStore } from '../../context/authStore';

export default function CandidateLogin() {
  const [searchParams] = useSearchParams();
  const invitationToken = searchParams.get('token')?.trim() || '';
  const [authMode, setAuthMode] = useState<'signup' | 'login'>(invitationToken ? 'signup' : 'login');
  const [testCode, setTestCode] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [invitationLoading, setInvitationLoading] = useState(false);
  const navigate = useNavigate();
  const setCandidate = useAuthStore((state) => state.setCandidate);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTestCode = testCode.trim().toUpperCase();

    if (authMode === 'signup' && !invitationToken && !trimmedTestCode) {
      toast.error('Enter a test code or use an invitation link to sign up');
      return;
    }

    setLoading(true);

    try {
      const { data } = await candidateApi.login({
        email,
        password,
        mode: authMode,
        ...(authMode === 'signup' ? { name } : {}),
        ...(invitationToken ? { invitationToken } : {}),
        ...(trimmedTestCode ? { testCode: trimmedTestCode } : {})
      });
      setCandidate(data.candidate, data.token);

      // Store attempt info
      localStorage.setItem('attemptId', data.attempt.id);
      localStorage.setItem('attemptStartTime', data.attempt.startTime);

      toast.success(data.message);
      navigate('/test/instructions');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } }; message?: string };
      if (!err.response) {
        toast.error('Cannot reach backend API. Start backend on port 3000 and verify database setup.');
      } else {
        toast.error(err.response.data?.error || err.message || 'Failed to login');
      }
    } finally {
      setLoading(false);
    }
  };

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
          <p className="text-gray-600 mt-2">
            {authMode === 'signup'
              ? 'Create your account to continue to your invited test'
              : invitationToken
                ? 'Log in with your email and password to continue'
                : 'Log in to resume an active test session'}
          </p>
        </div>

        <div className="flex mb-6 bg-gray-100 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setAuthMode('signup')}
            className={`flex-1 py-2 rounded-lg transition-colors ${
              authMode === 'signup' ? 'bg-white shadow-sm' : ''
            }`}
          >
            Sign up
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('login')}
            className={`flex-1 py-2 rounded-lg transition-colors ${
              authMode === 'login' ? 'bg-white shadow-sm' : ''
            }`}
          >
            Log in
          </button>
        </div>

        {invitationToken && (
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
        )}

        {!invitationToken && (
          <div className="mb-6 p-3 bg-yellow-50 rounded-lg border border-yellow-200 text-sm text-yellow-800">
            Use an invitation link or enter a test code to start a new test. Without either, login only resumes an existing in-progress attempt.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Test Code {authMode === 'signup' && !invitationToken ? '(Required)' : '(Optional)'}
            </label>
            <input
              type="text"
              value={testCode}
              onChange={(e) => setTestCode(e.target.value.toUpperCase())}
              className="input"
              placeholder="e.g. DEMO2024"
              required={authMode === 'signup' && !invitationToken}
              maxLength={32}
            />
          </div>

          {authMode === 'signup' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Full Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                placeholder="Enter your full name"
                required={authMode === 'signup'}
                minLength={2}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="Enter your email"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="Enter your password"
              required
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary w-full text-lg py-3"
          >
            {loading
              ? authMode === 'signup' ? 'Creating account...' : 'Logging in...'
              : authMode === 'signup' ? 'Sign up & Continue' : 'Log in & Continue'}
          </button>
        </form>

        <div className="mt-6 p-4 bg-yellow-50 rounded-lg">
          <h3 className="font-medium text-yellow-800 mb-2">Before you begin:</h3>
          <ul className="text-sm text-yellow-700 space-y-1">
            <li>• Ensure you have a stable internet connection</li>
            <li>• Use a desktop or laptop computer</li>
            <li>• Close all other browser tabs and applications</li>
            <li>• The test must be taken in full-screen mode</li>
          </ul>
        </div>

        <div className="mt-6 text-center">
          <Link to="/admin/login" className="text-primary-600 hover:underline text-sm">
            Admin Login
          </Link>
        </div>
      </div>
    </div>
  );
}

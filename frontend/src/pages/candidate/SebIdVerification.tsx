import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { candidateApi } from '../../services/api';
import IDVerification from '../../components/IDVerification';
import talentstaQLogo from '../../assets/assessment-icons/icons/Talentstaq logo dark.svg';

function handleSebExit() {
  const sebQuitUrl = localStorage.getItem('sebQuitUrl');
  if (sebQuitUrl) {
    window.location.href = sebQuitUrl;
  }
}

/**
 * Page 3 of the SEB pre-exam flow: identity verification, shown only when the
 * test's settings actually require it — used to be rendered inline at the top
 * of the instructions page. Skips straight through to /test/instructions when
 * verification isn't required, or was already completed in an earlier
 * attempt at this same test (checkVerificationRequired's canProceed).
 */
export default function SebIdVerification() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await candidateApi.getTestDetails();
        const verification = await candidateApi.checkVerificationRequired(data.test.id);
        if (!verification.data.required || verification.data.canProceed) {
          navigate('/test/instructions', { replace: true });
          return;
        }
        setChecking(false);
      } catch {
        toast.error('Failed to load test details');
        navigate('/test/login');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--admin-bg)' }}>
        <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--admin-border)', borderTopColor: 'var(--admin-accent)' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--admin-bg)' }}>
      <header className="bg-white border-b" style={{ borderColor: 'var(--admin-border)' }}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate('/test/system-check')}
              className="flex items-center gap-1.5 text-sm font-medium transition-colors"
              style={{ color: '#6B7280' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#111827')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
            >
              Back
            </button>
            <div className="h-5 w-px bg-gray-200" />
            <img src={talentstaQLogo} alt="TalentstaQ" style={{ height: '30px', width: 'auto' }} />
          </div>
          <button
            type="button"
            onClick={handleSebExit}
            className="text-sm font-medium transition-colors"
            style={{ color: '#6B7280' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#111827')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
          >
            Exit
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-3xl bg-white rounded-2xl p-6 shadow-sm">
          <h1 className="text-base font-semibold text-gray-800 mb-4">Identity Verification Required</h1>
          <IDVerification
            onVerified={() => {
              toast.success('Verification completed. You can continue to the test.');
              navigate('/test/instructions');
            }}
            onSkip={() => {
              toast.error(
                'ID verification was skipped with admin authorization. Proceed with strict review.',
              );
              navigate('/test/instructions');
            }}
            isOptional={false}
          />
        </div>
      </main>
    </div>
  );
}

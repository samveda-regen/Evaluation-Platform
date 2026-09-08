import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { ChevronLeft, ShieldCheck } from 'lucide-react';
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
    <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: '#F3F6FB' }}>
      <div
        className="pointer-events-none absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(circle, #DCE6FB 0%, transparent 70%)' }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-40 -left-40 w-[28rem] h-[28rem] rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(circle, #E3F4E9 0%, transparent 70%)' }}
        aria-hidden="true"
      />

      <header className="relative flex-shrink-0 bg-white border-b shadow-sm" style={{ borderColor: 'var(--admin-border-soft)' }}>
        <div className="max-w-[1180px] mx-auto px-6 sm:px-10 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate('/test/environment-setup')}
              className="flex items-center gap-1 text-sm font-medium transition-colors rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{ color: '#6B7280' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#111827')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
              aria-label="Go back to environment setup"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              Back
            </button>
            <div className="h-5 w-px bg-gray-200" />
            <img src={talentstaQLogo} alt="TalentstaQ" style={{ height: '26px', width: 'auto' }} />
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--admin-text-subtle)' }}>
              <ShieldCheck className="w-4 h-4" style={{ color: '#16A34A' }} aria-hidden="true" />
              Secure &amp; Private
            </span>
            <button
              type="button"
              onClick={handleSebExit}
              className="text-sm font-medium transition-colors rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{ color: '#6B7280' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#111827')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#6B7280')}
            >
              Exit
            </button>
          </div>
        </div>
      </header>

      <main className="relative flex-1 flex items-start justify-center px-4 sm:px-6 py-8 sm:py-12">
        <div className="w-full max-w-5xl">
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

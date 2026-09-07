import { useEffect, useState } from 'react';
import { candidateApi } from '../../services/api';
import NormalBrowserIdVerification from './NormalBrowserIdVerification';
import SebIdVerification from './SebIdVerification';

type AssessmentMode = 'SEB' | 'NORMAL_BROWSER';

/**
 * Dispatcher for page 3 of the pre-exam flow — same pattern as
 * TestInstructions.tsx/SystemCheck.tsx/EnvironmentSetup.tsx. The two
 * implementations differ only in navigation chrome (SEB has an Exit-to-SEB
 * button, normal-browser uses ordinary browser back); the verification logic
 * itself is identical.
 */
export default function IdVerification() {
  const [mode, setMode] = useState<AssessmentMode | null>(null);

  useEffect(() => {
    let cancelled = false;

    candidateApi
      .getTestDetails()
      .then(({ data }) => {
        if (cancelled) return;
        const resolvedMode: AssessmentMode =
          data.test?.assessmentMode === 'NORMAL_BROWSER' ? 'NORMAL_BROWSER' : 'SEB';
        setMode(resolvedMode);
      })
      .catch(() => {
        if (!cancelled) setMode((currentMode) => currentMode ?? 'SEB');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!mode) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--admin-border)', color: '#6B7280' }}
      >
        Loading…
      </div>
    );
  }

  return mode === 'NORMAL_BROWSER' ? <NormalBrowserIdVerification /> : <SebIdVerification />;
}

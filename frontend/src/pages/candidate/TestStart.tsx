import { useEffect, useState } from 'react';
import { candidateApi } from '../../services/api';
import NormalBrowserTestStart from './NormalBrowserTestStart';
import SebTestStart from './SebTestStart';

type AssessmentMode = 'SEB' | 'NORMAL_BROWSER';

/**
 * Dispatcher mounted at /test/start — same pattern as
 * TestInstructions.tsx/SystemCheck.tsx/IdVerification.tsx.
 * Both variants gate the real exam (TestInterface) behind their own
 * "Setting up" step and only call startTest() once that clears; see
 * SebTestStart.tsx / NormalBrowserTestStart.tsx.
 */
export default function TestStart() {
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

  return mode === 'NORMAL_BROWSER' ? <NormalBrowserTestStart /> : <SebTestStart />;
}

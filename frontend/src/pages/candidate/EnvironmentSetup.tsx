import { useEffect, useState } from 'react';
import { candidateApi } from '../../services/api';
import NormalBrowserEnvironmentSetup from './NormalBrowserEnvironmentSetup';
import SebEnvironmentSetup from './SebEnvironmentSetup';

type AssessmentMode = 'SEB' | 'NORMAL_BROWSER';

/**
 * Dispatcher for page 2 of the pre-exam flow — same pattern as
 * TestInstructions.tsx/SystemCheck.tsx. SEB warms up in-browser detection
 * models per candidate; normal-browser instead checks the shared
 * server-side detection service's readiness.
 */
export default function EnvironmentSetup() {
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

  return mode === 'NORMAL_BROWSER' ? <NormalBrowserEnvironmentSetup /> : <SebEnvironmentSetup />;
}

import { useEffect, useState } from 'react';
import { candidateApi } from '../../services/api';
import NormalBrowserTestInstructions from './NormalBrowserTestInstructions';
import SebTestInstructions from './SebTestInstructions';

type AssessmentMode = 'SEB' | 'NORMAL_BROWSER';

/**
 * Resolve the persisted assessment mode from the authenticated attempt before
 * mounting either pre-system-check implementation.
 */
export default function TestInstructions() {
  const [mode, setMode] = useState<AssessmentMode | null>(null);

  useEffect(() => {
    let cancelled = false;

    candidateApi
      .getTestDetails()
      .then(({ data }) => {
        if (cancelled) return;
        const resolvedMode: AssessmentMode =
          data.test?.assessmentMode === 'NORMAL_BROWSER' ? 'NORMAL_BROWSER' : 'SEB';
        localStorage.setItem('assessmentMode', resolvedMode);
        setMode(resolvedMode);
      })
      .catch(() => {
        // The selected page retains its existing authentication/error handling.
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
        Loading system check…
      </div>
    );
  }

  return mode === 'NORMAL_BROWSER'
    ? <NormalBrowserTestInstructions />
    : <SebTestInstructions />;
}

import { useEffect, useState } from 'react';
import { candidateApi } from '../../services/api';
import NormalBrowserSystemCheck from './NormalBrowserSystemCheck';
import SebSystemCheck from './SebSystemCheck';

type AssessmentMode = 'SEB' | 'NORMAL_BROWSER';

/**
 * Resolve the persisted assessment mode from the authenticated attempt before
 * mounting either implementation — same dispatcher pattern as
 * TestInstructions.tsx, one step earlier in the flow (this is the first page
 * after login for both modes).
 */
export default function SystemCheck() {
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

  return mode === 'NORMAL_BROWSER' ? <NormalBrowserSystemCheck /> : <SebSystemCheck />;
}

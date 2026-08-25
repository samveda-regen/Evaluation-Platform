import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { candidateApi } from '../../services/api';
import NormalBrowserCandidateLogin from './NormalBrowserCandidateLogin';
import SebCandidateLogin from './SebCandidateLogin';

type AssessmentMode = 'SEB' | 'NORMAL_BROWSER';

/**
 * Keeps the established SEB and normal-browser login experiences isolated.
 * Invitation links contain enough information to select the correct page
 * before the candidate signs in.
 */
export default function CandidateLogin() {
  const [searchParams] = useSearchParams();
  const invitationToken = searchParams.get('token')?.trim() || '';
  const [mode, setMode] = useState<AssessmentMode | null>(
    invitationToken ? null : 'SEB',
  );

  useEffect(() => {
    let cancelled = false;

    if (!invitationToken) {
      setMode('SEB');
      return () => {
        cancelled = true;
      };
    }

    setMode(null);
    candidateApi
      .getInvitationDetails(invitationToken)
      .then(({ data }) => {
        if (cancelled) return;
        const resolvedMode: AssessmentMode =
          data.test?.assessmentMode === 'NORMAL_BROWSER' ? 'NORMAL_BROWSER' : 'SEB';
        localStorage.setItem('assessmentMode', resolvedMode);
        setMode(resolvedMode);
      })
      .catch(() => {
        // Let the original SEB page render its established invitation error UI.
        if (!cancelled) setMode('SEB');
      });

    return () => {
      cancelled = true;
    };
  }, [invitationToken]);

  if (!mode) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--admin-border)',
          color: '#6B7280',
          fontSize: '14px',
        }}
      >
        Loading assessment…
      </div>
    );
  }

  return mode === 'NORMAL_BROWSER'
    ? <NormalBrowserCandidateLogin />
    : <SebCandidateLogin />;
}

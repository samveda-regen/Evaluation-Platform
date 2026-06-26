import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { candidateApi } from '../../services/api';
import { useAuthStore } from '../../context/authStore';
import talentstaQLogoDark from '../../assets/assessment-icons/icons/Talentstaq logo dark.svg';

interface TestInfo {
  name: string;
  duration: number;
  totalQuestions?: number;
  proctorEnabled?: boolean;
  invitedBy?: string;
  candidateName?: string;
  candidateEmail?: string;
}

export default function CandidateLogin() {
  const [searchParams]    = useSearchParams();
  const invitationToken   = searchParams.get('token')?.trim() || '';
  const navigate          = useNavigate();
  const setCandidate      = useAuthStore((state) => state.setCandidate);

  /* form state */
  const [name,        setName]        = useState('');
  const [email,       setEmail]       = useState('');
  const [accessCode,  setAccessCode]  = useState(invitationToken);
  const [consented,   setConsented]   = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [fetchingInfo,setFetchingInfo]= useState(!!invitationToken);
  const [testInfo,    setTestInfo]    = useState<TestInfo | null>(null);

  /* fetch test details from token */
  useEffect(() => {
    if (!invitationToken) return;
    const fetchDetails = async () => {
      try {
        const { data } = await candidateApi.getInvitationDetails(invitationToken);
        setTestInfo({
          name:            data.test?.name            || '',
          duration:        data.test?.duration        || 0,
          totalQuestions:  data.test?.totalQuestions  ?? data.test?.questionCount ?? undefined,
          proctorEnabled:  data.test?.proctorEnabled  ?? true,
          invitedBy:       data.invitation?.company   || data.invitation?.organizationName || '',
          candidateName:   data.invitation?.name      || '',
          candidateEmail:  data.invitation?.email     || '',
        });
        if (data.invitation?.name)  setName(data.invitation.name);
        if (data.invitation?.email) setEmail(data.invitation.email);
      } catch {
        /* silent — show generic form */
      } finally {
        setFetchingInfo(false);
      }
    };
    void fetchDetails();
  }, [invitationToken]);

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = accessCode.trim();
    if (!token) { toast.error('Please enter your access code'); return; }
    if (!consented) { toast.error('Please accept the consent to continue'); return; }

    setLoading(true);
    try {
      const { data } = await candidateApi.loginWithInvitation({ token });
      setCandidate(data.candidate, data.token);
      localStorage.setItem('attemptId',        data.attempt.id);
      localStorage.setItem('attemptStartTime', data.attempt.startTime);
      toast.success(data.message || 'Invitation accepted');
      navigate('/test/instructions');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Unable to start test. Check your access code.');
    } finally { setLoading(false); }
  };

  /* loading skeleton */
  if (fetchingInfo) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--admin-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: 'var(--admin-accent)' }} />
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', borderRadius: '10px',
    border: '1.5px solid var(--admin-border)', fontSize: '14px', color: '#111827',
    outline: 'none', boxSizing: 'border-box', backgroundColor: 'white',
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--admin-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>

      {/* -- Logo -- */}
      <div style={{ marginBottom: '24px' }}>
        <img src={talentstaQLogoDark} alt="TalentstaQ" style={{ height: '60px', width: 'auto' }} />
      </div>

      {/* -- Card -- */}
      <div style={{
        backgroundColor: 'white', borderRadius: '18px', padding: '32px',
        width: '100%', maxWidth: '480px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid var(--admin-border)',
      }}>

        {/* Invitation banner */}
        {testInfo?.invitedBy && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 14px', borderRadius: '10px', marginBottom: '20px',
            backgroundColor: 'var(--admin-accent-soft)', border: '1px solid #BBF7D0',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M4 4h16v12H4V4z" stroke="var(--admin-accent)" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M4 4l8 8 8-8" stroke="var(--admin-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ fontSize: '13px', color: 'var(--admin-accent-hover)', fontWeight: 500 }}>
              You've been invited by {testInfo.invitedBy}
            </span>
          </div>
        )}
        {invitationToken && !testInfo?.invitedBy && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 14px', borderRadius: '10px', marginBottom: '20px',
            backgroundColor: 'var(--admin-accent-soft)', border: '1px solid #BBF7D0',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M4 4h16v12H4V4z" stroke="var(--admin-accent)" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M4 4l8 8 8-8" stroke="var(--admin-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ fontSize: '13px', color: 'var(--admin-accent-hover)', fontWeight: 500 }}>
              You've been invited to take this assessment
            </span>
          </div>
        )}

        {/* Test name + subtitle */}
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#111827', margin: '0 0 6px' }}>
          {testInfo?.name || 'Assessment'}
        </h1>
        <p style={{ fontSize: '13px', color: '#6B7280', margin: '0 0 20px' }}>
          Verify your details to begin the assessment.
        </p>

        {/* Stats row — single card with column dividers */}
        {testInfo && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            border: '1.5px solid var(--admin-border)',
            borderRadius: '12px',
            overflow: 'hidden',
            marginBottom: '24px',
          }}>
            {/* Duration */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '16px 10px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="var(--admin-accent)" strokeWidth="1.8"/>
                <path d="M12 7v5l3 3" stroke="var(--admin-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>
                {testInfo.duration > 0 ? `${testInfo.duration} min` : '–'}
              </span>
            </div>

            {/* Proctored */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '16px 10px', borderLeft: '1.5px solid var(--admin-border)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 3l7 3v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" stroke="var(--admin-accent)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>
              </svg>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>
                {testInfo.proctorEnabled ? 'Proctored' : 'Unproctored'}
              </span>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleContinue}>

          {/* Full name */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '7px' }}>
              Full name <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Aarav Sharma"
              required
              style={inputStyle}
              onFocus={e => (e.target.style.borderColor = 'var(--admin-accent)')}
              onBlur={e  => (e.target.style.borderColor = 'var(--admin-border)')}
            />
          </div>

          {/* Email */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '7px' }}>
              Email <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="aarav.s@gmail.com"
              required
              style={inputStyle}
              onFocus={e => (e.target.style.borderColor = 'var(--admin-accent)')}
              onBlur={e  => (e.target.style.borderColor = 'var(--admin-border)')}
            />
          </div>

          {/* Access code */}
          <div style={{ marginBottom: '6px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '7px' }}>
              Access code
            </label>
            <input
              type="text"
              value={accessCode}
              onChange={e => setAccessCode(e.target.value.toUpperCase())}
              placeholder="NODE-7XQ2"
              style={{ ...inputStyle, letterSpacing: '0.15em', fontFamily: 'monospace', fontSize: '14px' }}
              onFocus={e => (e.target.style.borderColor = 'var(--admin-accent)')}
              onBlur={e  => (e.target.style.borderColor = 'var(--admin-border)')}
            />
          </div>
          <p style={{ fontSize: '12px', color: 'var(--admin-accent)', margin: '0 0 20px' }}>Found in your invitation email.</p>

          {/* Consent */}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '22px' }}>
            <div
              onClick={() => setConsented(p => !p)}
              style={{
                width: '18px', height: '18px', borderRadius: '5px', flexShrink: 0, marginTop: '2px',
                border: consented ? '2px solid var(--admin-accent)' : '2px solid #D1D5DB',
                backgroundColor: consented ? 'var(--admin-accent)' : 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}>
              {consented && (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <span style={{ fontSize: '13px', color: '#374151', lineHeight: '1.6' }}>
              I consent to webcam, microphone and screen recording for proctoring, and accept the{' '}
              <span style={{ color: 'var(--admin-accent)', fontWeight: 500, cursor: 'pointer' }}>privacy terms</span>.
            </span>
          </label>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !accessCode.trim() || !consented}
            style={{
              width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
              backgroundColor: loading || !accessCode.trim() || !consented ? 'var(--admin-accent-disabled)' : 'var(--admin-accent)',
              color: 'white', fontSize: '15px', fontWeight: 600,
              cursor: loading || !accessCode.trim() || !consented ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}>
            {loading ? (
              <>
                <span className="animate-spin" style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid white', borderTopColor: 'transparent', display: 'inline-block' }} />
                Preparing test...
              </>
            ) : (
              <>
                Continue
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </>
            )}
          </button>
        </form>
      </div>

      {/* -- Footer -- */}
      <p style={{ fontSize: '13px', color: '#9CA3AF', marginTop: '24px', textAlign: 'center' }}>
        Trouble signing in? Contact{' '}
        <span style={{ color: 'var(--admin-accent)', fontWeight: 500 }}>support@talentstaq.io</span>
      </p>
    </div>
  );
}

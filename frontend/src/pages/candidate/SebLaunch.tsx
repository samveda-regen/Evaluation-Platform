import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function SebLaunch() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() || '';
  const [launchFailed, setLaunchFailed] = useState(false);

  useEffect(() => {
    if (!token) {
      setLaunchFailed(true);
      return;
    }

    const scheme =
      window.location.protocol === 'https:' ? 'sebs:' : 'seb:';

    const sebConfigUrl =
      `${scheme}//${window.location.host}/api/invitations/${encodeURIComponent(token)}/seb-config`;

    const timer = window.setTimeout(() => {
      setLaunchFailed(true);
    }, 3000);

    window.location.href = sebConfigUrl;

    return () => {
      window.clearTimeout(timer);
    };
  }, [token]);

  if (launchFailed) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F8FAFC',
          padding: '24px',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '480px',
            textAlign: 'center',
          }}
        >
          <h1
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: '#111827',
              marginBottom: '12px',
            }}
          >
            Unable to open Secure Exam Browser
          </h1>

          <p
            style={{
              fontSize: '14px',
              color: '#6B7280',
              lineHeight: 1.6,
            }}
          >
            Please make sure Secure Exam Browser is installed and try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F8FAFC',
        fontFamily: 'sans-serif',
      }}
    >
      <p style={{ color: '#6B7280', fontSize: '14px' }}>
        Opening Secure Exam Browser...
      </p>
    </div>
  );
}
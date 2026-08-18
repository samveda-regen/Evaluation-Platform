import { useEffect } from 'react';

export default function SebQuit() {
  useEffect(() => {
    // SEB detects this URL as its configured quitURL and exits.
    // In a normal browser, there is nothing else to do.
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F8FAFC',
        color: '#111827',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>
          Assessment completed
        </h1>
        <p style={{ color: '#6B7280' }}>
          You may close this window.
        </p>
      </div>
    </div>
  );
}
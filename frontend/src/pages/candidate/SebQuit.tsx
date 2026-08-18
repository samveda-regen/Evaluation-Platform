import { useEffect } from 'react';

export default function SebQuit() {
  useEffect(() => {
    // If SEB's quit confirmation is cancelled, this temporary
    // browser window should disappear and leave TestComplete intact.
    const timer = window.setTimeout(() => {
      window.close();
    }, 500);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#ffffff',
      }}
    />
  );
}
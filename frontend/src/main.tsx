import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster, ToastBar, toast } from 'react-hot-toast';
import App from './App';
import './index.css';

const toastBaseStyle = {
  minWidth: '320px',
  maxWidth: '520px',
  padding: '14px 16px',
  borderRadius: '8px',
  border: '1px solid var(--admin-border)',
  background: 'white',
  color: 'var(--admin-text)',
  boxShadow: '0 16px 42px rgba(17, 22, 42, 0.22)',
  fontSize: '14px',
  fontWeight: 600,
  lineHeight: 1.45,
};

/* Number input fixes — prevents "0123" when typing into a field showing "0".
   Strategy: select-all on focus + intercept keydown when value is "0". */
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (el instanceof HTMLInputElement && el.type === 'number') {
    setTimeout(() => el.select(), 0);
  }
});

document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (
    el instanceof HTMLInputElement &&
    el.type === 'number' &&
    /^[0-9]$/.test(e.key) &&
    (el.value === '0' || el.value === '')
  ) {
    el.select(); // select the "0" so the typed digit replaces it
  }
}, true); // capture phase so it runs before browser processes the keystroke

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
    <Toaster
      position="top-right"
      gutter={12}
      containerStyle={{ zIndex: 99999, top: 74, right: 22 }}
      toastOptions={{
        duration: 5200,
        style: {
          ...toastBaseStyle,
          borderColor: 'rgba(234, 112, 48, 0.32)',
          background: '#FFF7ED',
        },
        success: {
          duration: 4200,
          iconTheme: {
            primary: '#059669',
            secondary: '#FFFFFF',
          },
          style: {
            ...toastBaseStyle,
            borderColor: '#A7F3D0',
            background: '#ECFDF5',
            color: '#064E3B',
          },
        },
        error: {
          duration: 7000,
          iconTheme: {
            primary: '#DC2626',
            secondary: '#FFFFFF',
          },
          style: {
            ...toastBaseStyle,
            borderColor: '#FECACA',
            background: '#FEF2F2',
            color: '#7F1D1D',
          },
        },
        loading: {
          style: {
            ...toastBaseStyle,
            borderColor: 'var(--admin-border)',
            background: 'var(--admin-surface-soft)',
            color: 'var(--admin-text)',
          },
        },
      }}
    >
      {(t) => (
        <ToastBar toast={t}>
          {({ icon, message }) => (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', width: '100%' }}>
              <span style={{ flexShrink: 0 }}>{icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>{message}</div>
              {t.type !== 'loading' && (
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={() => toast.dismiss(t.id)}
                  style={{
                    flexShrink: 0,
                    width: '22px',
                    height: '22px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    borderRadius: '6px',
                    background: 'transparent',
                    color: 'currentColor',
                    cursor: 'pointer',
                    fontSize: '18px',
                    lineHeight: 1,
                    opacity: 0.72,
                  }}
                >
                  &times;
                </button>
              )}
            </div>
          )}
        </ToastBar>
      )}
    </Toaster>
  </BrowserRouter>
);

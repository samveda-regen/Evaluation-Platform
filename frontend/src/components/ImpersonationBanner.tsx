import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, getAdminToken } from '../context/authStore';

// Impersonation tokens (minted by the superadmin console's "View as this
// admin") carry an `impersonatedBy` claim and are deliberately short-lived
// (2 minutes — see backend/src/utils/jwt.ts::IMPERSONATION_TOKEN_EXPIRY_MINUTES).
// This decodes that straight out of the JWT payload client-side (no
// signature check needed — it's only driving a UI countdown, not a security
// decision; the backend independently rejects the token once it's actually
// expired) so a normal admin login renders nothing here at all.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function endImpersonation(logoutAdmin: () => void, navigate: ReturnType<typeof useNavigate>) {
  logoutAdmin();
  navigate('/admin/login', { replace: true });
}

export default function ImpersonationBanner() {
  const navigate = useNavigate();
  const logoutAdmin = useAuthStore((s) => s.logoutAdmin);
  const [payload] = useState(() => {
    const token = getAdminToken();
    return token ? decodeJwtPayload(token) : null;
  });
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);

  const impersonatedBy = typeof payload?.impersonatedBy === 'string' ? payload.impersonatedBy : null;
  const exp = typeof payload?.exp === 'number' ? payload.exp : null;

  useEffect(() => {
    if (!impersonatedBy || exp === null) return;
    const tick = () => {
      const msLeft = exp * 1000 - Date.now();
      setRemainingMs(msLeft);
      if (msLeft <= 0) setExpired(true);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [impersonatedBy, exp]);

  useEffect(() => {
    if (!expired) return;
    const timeout = setTimeout(() => endImpersonation(logoutAdmin, navigate), 2500);
    return () => clearTimeout(timeout);
  }, [expired, logoutAdmin, navigate]);

  if (!impersonatedBy) return null;

  if (expired) {
    return (
      <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
        <div className="max-w-sm rounded-xl bg-white p-6 text-center shadow-2xl">
          <p className="text-base font-semibold text-gray-900">Impersonation session expired</p>
          <p className="mt-2 text-sm text-gray-600">
            This 2-minute "view as admin" session has ended. Signing out…
          </p>
        </div>
      </div>
    );
  }

  const totalSeconds = Math.max(0, Math.ceil((remainingMs ?? 0) / 1000));
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');

  return (
    <div
      className="flex flex-shrink-0 items-center justify-center gap-3 px-4 py-1.5 text-[12.5px] font-medium text-white"
      style={{ backgroundColor: '#B91C1C' }}
    >
      <span>
        Viewing as this admin — impersonated by {impersonatedBy} — expires in {mm}:{ss}
      </span>
      <button
        type="button"
        onClick={() => endImpersonation(logoutAdmin, navigate)}
        className="rounded border border-white/50 px-2 py-0.5 text-[11px] font-semibold hover:bg-white/10"
      >
        End session
      </button>
    </div>
  );
}

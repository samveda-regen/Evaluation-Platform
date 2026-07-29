import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../context/authStore';
import type { Admin } from '../../types';

// Accepts a short-lived impersonation token minted by the superadmin
// console (Accounts > Impersonate), logs the browser in as that admin for
// the token's remaining lifetime, then hands off to the normal dashboard.
// Not linked from anywhere in this app's own UI — only reached via the
// superadmin console opening this URL with ?token=...
export default function ImpersonationAccept() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setAdmin = useAuthStore((s) => s.setAdmin);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setError('Missing impersonation token.');
      return;
    }

    localStorage.setItem('adminToken', token);
    adminApi
      .getProfile()
      .then(({ data }) => {
        setAdmin(data.admin as Admin, token);
        navigate('/admin/dashboard', { replace: true });
      })
      .catch(() => {
        localStorage.removeItem('adminToken');
        setError('This impersonation link is invalid or has expired.');
      });
  }, [searchParams, navigate, setAdmin]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--admin-bg)]">
      <p className="text-sm text-[var(--admin-text-muted)]">
        {error ?? 'Signing in…'}
      </p>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { superAdminApi } from '../../services/superAdminApi';
import { useSuperAdminStore } from '../../context/superAdminStore';

export default function SuperAdminLogin() {
  const navigate = useNavigate();
  const setSuperAdmin = useSuperAdminStore((s) => s.setSuperAdmin);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await superAdminApi.login({ email, password, totpCode: needsTotp ? totpCode : undefined });
      if (data.requiresTotp) {
        setNeedsTotp(true);
        return;
      }
      if (data.superAdmin && data.token) {
        setSuperAdmin(data.superAdmin, data.token);
        navigate('/superadmin/overview');
      }
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Login failed';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-sa-void flex items-center justify-center px-4 relative overflow-hidden"
      style={{
        backgroundImage:
          'linear-gradient(rgba(0,240,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(0,240,255,0.045) 1px, transparent 1px)',
        backgroundSize: '42px 42px',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(700px 420px at 50% 30%, rgba(0,240,255,0.1), transparent 65%)' }}
      />

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm bg-sa-panel-raised border border-sa-line-bright rounded-sm p-8 shadow-[0_0_60px_rgba(0,240,255,0.08)]"
      >
        <span className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-sa-accent to-transparent" />

        <div className="flex items-center gap-2.5 mb-1">
          <span className="h-2.5 w-2.5 bg-sa-accent shadow-glow-cyan-sm rotate-45" />
          <span className="font-mono text-xs tracking-[0.24em] uppercase text-sa-accent [text-shadow:0_0_14px_rgba(0,240,255,0.6)]">
            Observer
          </span>
        </div>
        <h1 className="text-xl font-bold text-sa-ink mb-1 mt-4 uppercase tracking-tight">Superadmin Access</h1>
        <p className="text-[12.5px] text-sa-ink-faint font-mono mb-7">
          {needsTotp ? 'Enter your authenticator code.' : 'Authenticate to enter the observer console.'}
        </p>

        {!needsTotp ? (
          <>
            <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full mb-4 bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2.5 text-sm text-sa-ink outline-none focus:border-sa-accent focus:shadow-glow-cyan-sm transition-all font-mono"
              autoComplete="username"
            />

            <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full mb-7 bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2.5 text-sm text-sa-ink outline-none focus:border-sa-accent focus:shadow-glow-cyan-sm transition-all font-mono"
              autoComplete="current-password"
            />
          </>
        ) : (
          <>
            <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5">
              6-digit code
            </label>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              required
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
              className="w-full mb-7 bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2.5 text-sm text-sa-ink outline-none focus:border-sa-accent focus:shadow-glow-cyan-sm transition-all font-mono tracking-[0.3em] text-center"
              autoComplete="one-time-code"
            />
          </>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-sa-accent text-sa-void font-mono font-bold text-sm uppercase tracking-[0.1em] rounded-sm py-3 shadow-glow-cyan hover:brightness-110 active:brightness-95 disabled:opacity-60 transition-all"
        >
          {loading ? 'Authenticating…' : needsTotp ? 'Verify' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

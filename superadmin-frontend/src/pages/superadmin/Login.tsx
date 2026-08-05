import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { superAdminApi } from '../../services/superAdminApi';
import { useSuperAdminStore } from '../../context/superAdminStore';
import loginBackground from '../../assets/login-background.png';
import regenLogo from '../../assets/regen-logo.png';

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
      className="min-h-screen bg-sa-void flex items-center justify-center px-4 relative overflow-hidden bg-cover bg-bottom bg-no-repeat"
      style={{ backgroundImage: `url(${loginBackground})` }}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sa-void/60 via-sa-void/20 to-sa-void" />

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm bg-sa-panel/90 backdrop-blur-sm border border-sa-line rounded-2xl p-8"
      >
        <img src={regenLogo} alt="ReGen" className="block h-16 w-auto mx-auto" />
        <h1 className="text-xl font-bold text-sa-ink mb-1 mt-5">Superadmin access</h1>
        <p className="text-sm text-sa-ink-dim mb-7">
          {needsTotp ? 'Enter your authenticator code.' : 'Sign in to the ReGen console.'}
        </p>

        {!needsTotp ? (
          <>
            <label className="block text-sm font-medium text-sa-ink-dim mb-1.5">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full mb-4 bg-sa-panel-inset border border-sa-line rounded-lg px-3 py-2.5 text-sm text-sa-ink outline-none focus:border-sa-accent transition-colors"
              autoComplete="username"
            />

            <label className="block text-sm font-medium text-sa-ink-dim mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full mb-7 bg-sa-panel-inset border border-sa-line rounded-lg px-3 py-2.5 text-sm text-sa-ink outline-none focus:border-sa-accent transition-colors"
              autoComplete="current-password"
            />
          </>
        ) : (
          <>
            <label className="block text-sm font-medium text-sa-ink-dim mb-1.5">
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
              className="w-full mb-7 bg-sa-panel-inset border border-sa-line rounded-lg px-3 py-2.5 text-sm text-sa-ink outline-none focus:border-sa-accent transition-colors tracking-[0.3em] text-center"
              autoComplete="one-time-code"
            />
          </>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-sa-accent text-white font-semibold text-sm rounded-lg py-2.5 hover:brightness-110 active:brightness-95 disabled:opacity-60 transition-all"
        >
          {loading ? 'Authenticating…' : needsTotp ? 'Verify' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

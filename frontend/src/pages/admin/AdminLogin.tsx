import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../context/authStore';

export default function AdminLogin() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAdmin = useAuthStore((state) => state.setAdmin);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { data } = await adminApi.login({ email, password });
        setAdmin(data.admin, data.token);
        toast.success('Login successful');
        navigate('/admin/tests/new');
      } else {
        const { data } = await adminApi.register({ email, password, name });
        setAdmin(data.admin, data.token);
        toast.success('Registration successful');
        navigate('/admin/tests/new');
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } }; message?: string };
      if (!err.response) {
        toast.error('Cannot reach backend API. Start backend on port 3000 and verify database setup.');
      } else {
        toast.error(err.response.data?.error || err.message || 'An error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#2b014f] via-[#3a0b62] to-[#23033f] p-4 md:p-6 flex items-center justify-center">
      <div className="w-full max-w-[1100px] overflow-hidden rounded-2xl bg-[#3a0b62] shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
        <div className="relative grid min-h-[600px] grid-cols-1 md:min-h-[640px] md:grid-cols-2">
          <div className="pointer-events-none absolute inset-0 opacity-20">
            <div className="absolute -left-16 -top-14 h-72 w-72 rotate-12 rounded-3xl border border-violet-300/50" />
            <div className="absolute left-1/3 top-10 h-64 w-64 -rotate-12 rounded-3xl border border-fuchsia-300/40" />
            <div className="absolute bottom-0 right-0 h-64 w-64 -translate-x-12 translate-y-20 rotate-45 rounded-3xl bg-violet-900/50" />
          </div>

          <section className="relative z-10 px-8 py-10 text-white md:px-12 md:py-12 lg:px-14">
            <div className="mb-8 text-3xl font-bold">Regen</div>
            <h1 className="text-5xl font-extrabold leading-none md:text-6xl">Welcome!</h1>
            <div className="mt-4 h-1 w-16 rounded-full bg-white/80" />
            <p className="mt-6 max-w-md text-sm text-violet-100/85">
              Secure admin access for tests, questions, and candidate monitoring.
            </p>
            <div className="mt-10">
              <Link
                to="/test/login"
                className="inline-flex rounded-full bg-gradient-to-r from-orange-400 to-pink-500 px-5 py-2 text-xs font-semibold text-white"
              >
                Candidate Login
              </Link>
            </div>
          </section>

          <section className="relative z-10 flex items-center justify-center px-6 py-10 md:px-10 md:py-12">
            <div className="w-full max-w-[360px] border border-white/20 bg-white/12 p-8 text-white backdrop-blur-md">
              <div className="mb-4 flex gap-2">
                <button
                  onClick={() => setIsLogin(true)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${isLogin ? 'bg-white/25' : 'bg-white/10'}`}
                  type="button"
                >
                  Sign in
                </button>
                <button
                  onClick={() => setIsLogin(false)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${!isLogin ? 'bg-white/25' : 'bg-white/10'}`}
                  type="button"
                >
                  Register
                </button>
              </div>

              <h2 className="text-center text-5xl font-bold">{isLogin ? 'Sign in' : 'Register'}</h2>

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                {!isLogin && (
                  <div>
                    <label className="mb-1 block text-sm font-semibold">Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-full border border-white/20 bg-white/20 px-4 py-2 text-sm text-white placeholder-white/70 outline-none focus:border-orange-300"
                      placeholder="Admin name"
                      required={!isLogin}
                    />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-sm font-semibold">User Name</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-full border border-white/20 bg-white/20 px-4 py-2 text-sm text-white placeholder-white/70 outline-none focus:border-orange-300"
                    placeholder="admin@example.com"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-full border border-white/20 bg-white/20 px-4 py-2 text-sm text-white placeholder-white/70 outline-none focus:border-orange-300"
                    placeholder="••••••••••"
                    required
                    minLength={isLogin ? 6 : 8}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-3 w-full rounded-full bg-gradient-to-r from-orange-400 to-pink-500 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-70"
                >
                  {loading ? 'Please wait...' : 'Submit'}
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

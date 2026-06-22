import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../context/authStore';
import { ShieldCheck, Activity, BarChart2, Eye, EyeOff, ChevronRight } from 'lucide-react';
import talentstaQLogo from '../../assets/assessment-icons/icons/Talentstaq logo dark.svg';
import talentstaQLogoLight from '../../assets/assessment-icons/icons/TalentstaQ logo-light.svg';

export default function AdminLogin() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

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
        navigate('/admin/dashboard');
      } else {
        const { data } = await adminApi.register({
          email,
          password,
          name,
          companyName: companyName.trim() || undefined,
          companyId: companyId.trim() || undefined,
        });

        setAdmin(data.admin, data.token);
        toast.success('Registration successful');
        navigate('/admin/dashboard');
      }
    } catch (error: unknown) {
      const err = error as {
        response?: { data?: { error?: string } };
        message?: string;
      };

      if (!err.response) {
        toast.error(
          'Cannot reach backend API. Start backend on port 3000 and verify database setup.'
        );
      } else {
        toast.error(
          err.response.data?.error ||
            err.message ||
            'An error occurred'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full overflow-hidden bg-white text-gray-900 font-sans">
      <div className="grid h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">

        {/* LEFT SIDE: HERO PANEL */}
        <section className="relative hidden h-screen overflow-hidden bg-[#1F3556] px-10 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-16 xl:py-12">

          {/* Hero Main Content */}
          <div className="relative z-10 my-auto max-w-xl pr-4">
            {/* Logo aligned with content */}
            <img src={talentstaQLogoLight} alt="TalentstaQ" style={{ height: '64px', width: 'auto', marginBottom: '48px' }} />
            <h1 className="text-[42px] font-extrabold leading-[1.15] tracking-tight text-white xl:text-[48px]">
              Hire on proof,
              <br />
              not guesswork.
            </h1>

            <p className="mt-5 text-[16px] leading-relaxed text-[#98A2B5]">
              Role-based assessments, AI proctoring and integrity analytics -
              one platform from invite to scorecard.
            </p>

            <div className="mt-10 space-y-5">
              {/* Feature 1 */}
              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#D97706]">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium text-[#c9d1d9] xl:text-[15px]">
                  AI proctoring with violation evidence &amp; trust scoring
                </span>
              </div>

              {/* Feature 2 */}
              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#D97706]">
                  <Activity className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium text-[#c9d1d9] xl:text-[15px]">
                  MCQ, coding &amp; behavioral question library
                </span>
              </div>

              {/* Feature 3 */}
              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#D97706]">
                  <BarChart2 className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium text-[#c9d1d9] xl:text-[15px]">
                  Skill, difficulty &amp; candidate comparison analytics
                </span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="relative mt-8 text-xs text-gray-500 select-none">
            © 2026 TalentstaQ. All rights reserved.
          </div>
        </section>

        {/* RIGHT SIDE: FORM PANEL */}
        <section className="bg-white flex flex-col items-center justify-start pt-20 pb-12 px-6 sm:px-12 lg:px-16 xl:px-20 h-screen overflow-y-auto">
          <div className="w-full max-w-[420px] space-y-6">

            {/* Logo for mobile screens */}
            <div className="flex items-center lg:hidden">
              <img src={talentstaQLogo} alt="TalentstaQ" style={{ height: '32px', width: 'auto' }} />
            </div>

            {/* Header Titles */}
            <div className="space-y-1.5">
              <h2 className="text-[30px] font-bold tracking-tight text-gray-900 leading-tight">
                {isLogin ? 'Welcome back' : 'Create your account'}
              </h2>
              <p className="text-sm text-gray-500 font-medium">
                Admin &amp; recruiter console access.
              </p>
            </div>

            {/* Sign in / Register Switcher */}
            <div className="inline-flex rounded-xl bg-[#eef2f6] p-1 text-sm font-semibold w-fit">
              <button
                onClick={() => setIsLogin(true)}
                type="button"
                className={`px-5 py-2 rounded-lg transition-all duration-200 ${
                  isLogin
                    ? 'bg-white shadow-sm text-gray-900 font-bold'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                Sign in
              </button>
              <button
                onClick={() => setIsLogin(false)}
                type="button"
                className={`px-5 py-2 rounded-lg transition-all duration-200 ${
                  !isLogin
                    ? 'bg-white shadow-sm text-gray-900 font-bold'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                Register
              </button>
            </div>

            {/* Form Fields */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">
                      Full name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Priya Nair"
                      required={!isLogin}
                      className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition duration-150 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/20"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">
                      Company name <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Regen Consult"
                      className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition duration-150 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/20"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">
                      Company ID <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={companyId}
                      onChange={(e) => setCompanyId(e.target.value)}
                      placeholder="REGEN-001"
                      className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition duration-150 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/20"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Work email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="priya@regenconsult.au"
                  required
                  className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition duration-150 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/20"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={isLogin ? 6 : 8}
                    className="w-full rounded-lg border border-gray-200 bg-white pl-4 pr-10 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition duration-150 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                  >
                    {showPassword ? (
                      <Eye className="w-5 h-5" />
                    ) : (
                      <EyeOff className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              {isLogin && (
                <div className="flex items-center justify-between text-sm pt-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded border-gray-300 text-[#F59E0B] focus:ring-[#F59E0B] h-4 w-4" style={{ accentColor: '#F59E0B' }}
                    />
                    <span className="text-gray-600 font-medium">Remember me</span>
                  </label>
                  <Link
                    to="/admin/forgot-password"
                    className="text-[#D97706] hover:text-[#B45309] font-semibold transition-colors duration-150"
                  >
                    Forgot password?
                  </Link>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-white py-3 text-sm font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 shadow-sm"
              >
                <span>{loading ? 'Please wait...' : isLogin ? 'Sign in' : 'Create account'}</span>
                {!loading && (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            </form>

            {/* Separator Divider */}
            <div className="flex items-center py-2 select-none">
              <div className="flex-1 border-t border-gray-200/80" />
              <span className="px-4 text-xs font-semibold text-gray-400">candidate?</span>
              <div className="flex-1 border-t border-gray-200/80" />
            </div>

            {/* Ghost Invitation Button */}
            <Link
              to="/test/login"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-700 transition duration-150 hover:bg-gray-50 hover:text-gray-900 shadow-sm"
            >
              <span>I have a test invitation</span>
              <ChevronRight className="h-4 w-4" />
            </Link>

          </div>
        </section>

      </div>
    </div>
  );
}

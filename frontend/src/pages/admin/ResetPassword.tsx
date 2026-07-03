import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { ShieldCheck, Activity, BarChart2, Eye, EyeOff, ChevronRight, ArrowLeft, AlertTriangle } from 'lucide-react';
import talentstaQLogoDark from '../../assets/assessment-icons/icons/Talentstaq logo dark.svg';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await adminApi.resetPassword({ token, newPassword });
      toast.success('Password reset successful. Please sign in.');
      navigate('/admin/login');
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
    <div className="login-shell min-h-screen w-full overflow-x-hidden bg-white text-gray-900 font-sans lg:h-screen lg:overflow-hidden">
      <div className="grid min-h-screen grid-cols-1 lg:h-screen lg:grid-cols-[1.1fr_1fr]">

        {/* LEFT SIDE: HERO PANEL */}
        <section className="relative hidden min-h-screen overflow-hidden bg-[#060c13] px-10 py-10 text-white lg:flex lg:h-screen lg:flex-col lg:justify-between xl:px-16 xl:py-12">
          <div className="pointer-events-none absolute right-0 top-0 h-[600px] w-[600px] rounded-full bg-gradient-to-b from-[#1b3831]/25 via-[#102320]/5 to-transparent blur-[100px] opacity-80" />
          <div className="pointer-events-none absolute -left-20 -bottom-20 h-[500px] w-[500px] rounded-full bg-gradient-to-tr from-[#0a1e1b]/15 to-transparent blur-[120px] opacity-40" />

          <div className="relative z-10 my-auto max-w-xl pr-4">
            <h1 className="text-[42px] font-extrabold leading-[1.15] tracking-tight text-white xl:text-[48px]">
              Hire on proof,
              <br />
              not guesswork.
            </h1>

            <p className="mt-5 text-[16px] leading-relaxed text-[#9ca3af]">
              Role-based assessments, AI proctoring and integrity analytics -
              one platform from invite to scorecard.
            </p>

            <div className="mt-10 space-y-5">
              <div className="flex items-center gap-4">
                <div className="login-feature-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium text-[#c9d1d9] xl:text-[15px]">
                  AI proctoring with violation evidence &amp; trust scoring
                </span>
              </div>

              <div className="flex items-center gap-4">
                <div className="login-feature-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                  <Activity className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium text-[#c9d1d9] xl:text-[15px]">
                  MCQ, coding &amp; behavioral question library
                </span>
              </div>

              <div className="flex items-center gap-4">
                <div className="login-feature-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                  <BarChart2 className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium text-[#c9d1d9] xl:text-[15px]">
                  Skill, difficulty &amp; candidate comparison analytics
                </span>
              </div>
            </div>
          </div>

          <div className="relative mt-8 text-xs font-semibold text-gray-500 select-none">
            <span>{'©'} Regen. All rights reserved.</span>
          </div>
        </section>

        {/* RIGHT SIDE: FORM PANEL */}
        <section className="bg-white flex flex-col items-center justify-start px-6 py-10 sm:px-12 lg:h-screen lg:overflow-y-auto lg:px-16 lg:py-16 xl:px-20">
          <div className="w-full max-w-[440px] space-y-5">

            <div className="flex items-center justify-start">
              <img
                src={talentstaQLogoDark}
                alt="TalentstaQ"
                className="h-[48px] w-auto object-contain"
              />
            </div>

            {!token ? (
              <>
                <div className="space-y-1.5">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
                    <AlertTriangle className="h-6 w-6 text-red-500" />
                  </div>
                  <h2 className="pt-3 text-[26px] font-bold tracking-tight text-gray-900 leading-tight">
                    Invalid reset link
                  </h2>
                  <p className="text-sm text-gray-500 font-medium">
                    This password reset link is missing or malformed. Request a new one to continue.
                  </p>
                </div>

                <Link
                  to="/admin/forgot-password"
                  className="login-button login-button-primary flex w-full items-center justify-center gap-2"
                >
                  <span>Request a new link</span>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <h2 className="text-[30px] font-bold tracking-tight text-gray-900 leading-tight">
                    Set a new password
                  </h2>
                  <p className="text-sm text-gray-500 font-medium">
                    Choose a new password for your account.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">
                      New password
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        minLength={8}
                        autoFocus
                        className="login-input login-input--with-action"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                      >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">
                      Confirm new password
                    </label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={8}
                      className="login-input"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="login-button login-button-primary flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>{loading ? 'Resetting...' : 'Reset password'}</span>
                    {!loading && <ChevronRight className="h-4 w-4" />}
                  </button>
                </form>

                <Link
                  to="/admin/login"
                  className="flex items-center justify-center gap-1.5 text-sm font-semibold text-[var(--login-accent)] hover:text-[var(--login-accent-hover)] transition-colors duration-150"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Back to sign in</span>
                </Link>
              </>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}

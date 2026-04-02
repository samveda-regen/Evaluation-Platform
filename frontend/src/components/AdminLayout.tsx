import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../context/authStore';

const navItems = [
  { path: '/admin/dashboard', label: 'Candidates', matchPrefix: '/admin/dashboard' },
  { path: '/admin/tests', label: 'Tests', matchPrefix: '/admin/tests' },
  { path: '/admin/repository/question-bank', label: 'Library', matchPrefix: '/admin/repository' },
  { path: '/admin/trust-reports', label: 'Insights', matchPrefix: '/admin/trust-reports' },
];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { admin, logoutAdmin } = useAuthStore();
  const initials =
    admin?.name
      ? admin.name
          .split(' ')
          .map(part => part[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()
      : admin?.email?.slice(0, 2).toUpperCase() || 'AD';

  const handleLogout = () => {
    logoutAdmin();
    navigate('/admin/login');
  };

  const isActiveItem = (matchPrefix: string) => location.pathname.startsWith(matchPrefix);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-[#111827] bg-[#0b1220] text-white">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-6 py-3">
          <Link to="/" className="flex items-center gap-2" aria-label="Home" title="Home">
            <div className="flex h-9 w-9 items-center justify-center rounded bg-emerald-500 text-xs font-bold text-[#0b1220]">
              R
            </div>
            <span className="text-sm font-semibold tracking-wide">Regen</span>
          </Link>

          <nav className="flex-1 overflow-x-auto">
            <ul className="flex items-center gap-6 whitespace-nowrap text-sm">
              {navItems.map(item => (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`relative pb-2 transition ${
                      isActiveItem(item.matchPrefix)
                        ? 'text-white after:absolute after:-bottom-[11px] after:left-0 after:h-[3px] after:w-full after:bg-emerald-400'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-[#151f32] px-3 py-1.5 text-sm text-slate-300">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-slate-400">
                <path
                  d="M21 21l-4.3-4.3m1.3-5.2a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <input
                placeholder="Search candidate"
                className="w-48 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold uppercase">
                {initials}
              </div>
              <button
                onClick={handleLogout}
                className="text-xs font-semibold text-slate-300 hover:text-white"
                title="Sign out"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-7xl p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

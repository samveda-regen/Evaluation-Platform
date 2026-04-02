import { NavLink, Outlet } from 'react-router-dom';

const tabs = [
  { to: '/admin/repository/question-bank', label: 'Library' },
  { to: '/admin/repository/custom', label: 'Custom Questions' }
];

export default function RepositoryLayout() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Questions Repository</h1>
        <p className="text-gray-600 mt-1">
          Manage library content and maintain your custom reusable questions.
        </p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-2">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <Outlet />
    </div>
  );
}

import { Routes, Route, Navigate } from 'react-router-dom';
import { useSuperAdminStore } from './context/superAdminStore';

import SuperAdminLayout from './components/SuperAdminLayout';
import SuperAdminLogin from './pages/superadmin/Login';
import SuperAdminOverview from './pages/superadmin/Overview';
import SuperAdminLiveMonitor from './pages/superadmin/LiveMonitor';
import SuperAdminAccounts from './pages/superadmin/Accounts';
import SuperAdminAuditLog from './pages/superadmin/AuditLog';
import SuperAdminFeatureLocks from './pages/superadmin/FeatureLocks';
import SuperAdminTelemetry from './pages/superadmin/Telemetry';
import SuperAdminAiAssistant from './pages/superadmin/AiAssistant';
import SuperAdminBilling from './pages/superadmin/Billing';
import SuperAdminSecurity from './pages/superadmin/Security';
import SuperAdminAlerts from './pages/superadmin/Alerts';
import SuperAdminStorage from './pages/superadmin/Storage';
import SuperAdminCompanies from './pages/superadmin/Companies';
import SuperAdminWebhooks from './pages/superadmin/Webhooks';

function ProtectedSuperAdminRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useSuperAdminStore((state) => state.isSuperAdminAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/superadmin/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/superadmin/overview" replace />} />
      <Route path="/superadmin/login" element={<SuperAdminLogin />} />
      <Route
        path="/superadmin"
        element={
          <ProtectedSuperAdminRoute>
            <SuperAdminLayout />
          </ProtectedSuperAdminRoute>
        }
      >
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<SuperAdminOverview />} />
        <Route path="live-monitor" element={<SuperAdminLiveMonitor />} />
        <Route path="accounts" element={<SuperAdminAccounts />} />
        <Route path="audit-log" element={<SuperAdminAuditLog />} />
        <Route path="feature-locks" element={<SuperAdminFeatureLocks />} />
        <Route path="billing" element={<SuperAdminBilling />} />
        <Route path="telemetry" element={<SuperAdminTelemetry />} />
        <Route path="security" element={<SuperAdminSecurity />} />
        <Route path="alerts" element={<SuperAdminAlerts />} />
        <Route path="ai-assistant" element={<SuperAdminAiAssistant />} />
        <Route path="storage" element={<SuperAdminStorage />} />
        <Route path="companies" element={<SuperAdminCompanies />} />
        <Route path="webhooks" element={<SuperAdminWebhooks />} />
      </Route>
      <Route path="*" element={<Navigate to="/superadmin/overview" replace />} />
    </Routes>
  );
}

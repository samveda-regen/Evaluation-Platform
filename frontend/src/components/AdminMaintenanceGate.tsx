import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { adminApi } from '../services/api';
import { useMaintenanceStore } from '../context/maintenanceStore';
import MaintenancePage from './MaintenancePage';

const POLL_INTERVAL_MS = 20000;

// Wraps every /admin/* route (login included) so a superadmin-triggered
// maintenance window replaces the page outright instead of stacking toasts
// on every failed request. Polls a public, unauthenticated status endpoint so
// it also catches an admin sitting idle on a page that isn't otherwise
// hitting the API. Candidate routes never mount this component.
export default function AdminMaintenanceGate() {
  const active = useMaintenanceStore((state) => state.active);
  const message = useMaintenanceStore((state) => state.message);
  const setMaintenance = useMaintenanceStore((state) => state.setMaintenance);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const { data } = await adminApi.getMaintenanceStatus();
        if (!cancelled) {
          setMaintenance(Boolean(data.active), data.message);
        }
      } catch {
        // Fail open - a status-check failure shouldn't itself lock admins out.
      }
    };

    void check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [setMaintenance]);

  if (active) {
    return <MaintenancePage message={message} />;
  }

  return <Outlet />;
}

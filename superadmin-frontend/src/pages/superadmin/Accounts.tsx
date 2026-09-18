import { useEffect, useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { Trash2, Eye, LogOut, Lock, Unlock, XCircle, Clock, Monitor, X } from 'lucide-react';
import { superAdminApi, type AdminAccountSummary, type AdminDeviceInfo } from '../../services/superAdminApi';
import { Card, StatusPill, EmptyState, PageHeader, relativeTime } from './components';

// The exam platform's origin — impersonation opens a new tab there with a
// short-lived token, since this console and the exam platform are
// deliberately separate apps (see the port-2002 extraction). This was
// previously hardcoded to the local dev origin (localhost:5173), which meant
// "View as this admin" opened a dead localhost URL for every superadmin
// visiting the deployed console.
//
// Set explicitly via VITE_Impersonating_url_superadmin in this app's .env
// (e.g. VITE_Impersonating_url_superadmin="https://your-exam-platform-domain").
// Vite only exposes client-side env vars prefixed with VITE_ — the prefix is
// required, "Impersonating_url_superadmin" alone will not be picked up.
const viteEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env || {};
const isLocalBrowser =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const configuredMainAppOrigin =
  typeof viteEnv.VITE_Impersonating_url_superadmin === 'string'
    ? viteEnv.VITE_Impersonating_url_superadmin.replace(/\/+$/, '')
    : '';
// No hardcoded production guess here on purpose — a wrong guess (e.g. a
// domain that isn't actually this deployment's) is worse than refusing to
// open anything, since it fails silently instead of obviously. Only
// localhost:5173 is assumed, since that's genuinely this repo's fixed local
// dev port (see ecosystem.config.js / frontend's vite preview script), not a
// guess about which exam-platform domain a given deployment uses.
const MAIN_APP_ORIGIN = configuredMainAppOrigin || (isLocalBrowser ? 'http://localhost:5173' : '');

export default function SuperAdminAccounts() {
  const [admins, setAdmins] = useState<AdminAccountSummary[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminAccountSummary | null>(null);
  const [deleteNow, setDeleteNow] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewingDevicesFor, setViewingDevicesFor] = useState<AdminAccountSummary | null>(null);
  const [deviceList, setDeviceList] = useState<AdminDeviceInfo[] | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await superAdminApi.listAccounts();
      setAdmins(data.admins);
    } catch {
      toast.error('Failed to load admin accounts');
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 30000);
    return () => clearInterval(interval);
  }, [load]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (deleteNow) {
        const { data } = await superAdminApi.deleteAccount(pendingDelete.id);
        toast.success(
          `Deleted ${pendingDelete.email} — ${data.summary.testsDeleted} test(s), ${
            data.summary.mcqQuestionsDeleted + data.summary.codingQuestionsDeleted + data.summary.behavioralQuestionsDeleted
          } question(s) removed`
        );
      } else {
        await superAdminApi.scheduleDeleteAccount(pendingDelete.id);
        toast.success(`${pendingDelete.email} scheduled for deletion in 7 days`);
      }
      setPendingDelete(null);
      setDeleteNow(false);
      void load();
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { message?: string; error?: string } } })?.response?.data?.message ||
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Delete failed';
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  const cancelDeletion = async (admin: AdminAccountSummary) => {
    try {
      await superAdminApi.cancelDeleteAccount(admin.id);
      toast.success(`Deletion cancelled for ${admin.email}`);
      void load();
    } catch {
      toast.error('Failed to cancel deletion');
    }
  };

  const impersonate = async (admin: AdminAccountSummary) => {
    if (!MAIN_APP_ORIGIN) {
      toast.error(
        "Exam platform URL isn't configured. Set VITE_Impersonating_url_superadmin in this app's .env, rebuild, and restart.",
        { duration: 8000 }
      );
      return;
    }
    try {
      const { data } = await superAdminApi.impersonateAccount(admin.id);
      window.open(`${MAIN_APP_ORIGIN}/admin/impersonate?token=${encodeURIComponent(data.token)}`, '_blank');
      toast.success(`Impersonation session opened for ${admin.email} (${data.expiresInMinutes} min)`);
    } catch {
      toast.error('Failed to start impersonation');
    }
  };

  const forceLogout = async (admin: AdminAccountSummary) => {
    try {
      await superAdminApi.forceLogoutAdmin(admin.id);
      toast.success(`${admin.email} logged out of every session`);
    } catch {
      toast.error('Failed to force logout');
    }
  };

  const lock = async (admin: AdminAccountSummary) => {
    try {
      await superAdminApi.lockAdminSecurity(admin.id);
      toast.success(`${admin.email} locked — blocked from logging in or taking actions until unlocked`);
      void load();
    } catch {
      toast.error('Failed to lock');
    }
  };

  const unlock = async (admin: AdminAccountSummary) => {
    try {
      await superAdminApi.unlockAdminSecurity(admin.id);
      toast.success(`${admin.email} unlocked`);
      void load();
    } catch {
      toast.error('Failed to unlock');
    }
  };

  const openDevices = async (admin: AdminAccountSummary) => {
    setViewingDevicesFor(admin);
    setDeviceList(null);
    try {
      const { data } = await superAdminApi.getAdminDevices(admin.id);
      setDeviceList(data.devices);
    } catch {
      toast.error('Failed to load device sessions');
      setViewingDevicesFor(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Every admin account on the platform. Deletion schedules a 7-day grace period by default — cancel any time before it runs, or delete immediately if you're certain."
      />

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-sa-line text-left">
                {['Account', 'Status', 'Last active', 'Content', 'Actions logged', ''].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10px] text-sa-ink-faint font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {admins?.map((a) => (
                <tr key={a.id} className="border-b border-sa-line-soft last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="text-sa-ink">{a.name}</div>
                    <div className="text-[11px] text-sa-ink-faint">{a.email}</div>
                    {a.securityLocked && (
                      <div className="mt-1">
                        <StatusPill tone="critical">Locked{a.securityLockReason ? `: ${a.securityLockReason}` : ''}</StatusPill>
                      </div>
                    )}
                    {a.pendingDeletionAt && (
                      <div className="mt-1">
                        <StatusPill tone="warn">
                          <Clock size={10} className="inline -mt-0.5 mr-1" />
                          Deletes {relativeTime(a.pendingDeletionAt)}
                        </StatusPill>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPill tone={a.status === 'online' ? 'good' : 'dim'}>
                      {a.status === 'online' ? 'Online' : 'Offline'}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">{relativeTime(a.lastActiveAt)}</td>
                  <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">
                    {a.ownedContent.tests} test{a.ownedContent.tests === 1 ? '' : 's'},{' '}
                    {a.ownedContent.mcqQuestions + a.ownedContent.codingQuestions + a.ownedContent.behavioralQuestions} question(s)
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">{a.actionsRecorded}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      {a.status === 'online' && (
                        <button
                          onClick={() => void openDevices(a)}
                          title={`${a.deviceCount} device${a.deviceCount === 1 ? '' : 's'} logged in`}
                          className="relative p-1.5 text-sa-good hover:text-sa-good hover:bg-sa-good-soft rounded-md transition-colors"
                        >
                          <Monitor size={15} />
                          {a.deviceCount > 0 && (
                            <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-[3px] rounded-full bg-sa-good text-sa-void text-[9px] font-bold flex items-center justify-center leading-none">
                              {a.deviceCount}
                            </span>
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => void impersonate(a)}
                        title="View as this admin (2 min)"
                        className="p-1.5 text-sa-ink-faint hover:text-sa-accent transition-colors"
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        onClick={() => void forceLogout(a)}
                        title="Force logout"
                        className="p-1.5 text-sa-ink-faint hover:text-sa-warn transition-colors"
                      >
                        <LogOut size={15} />
                      </button>
                      {a.securityLocked ? (
                        <button
                          onClick={() => void unlock(a)}
                          title="Unlock"
                          className="p-1.5 text-sa-ink-faint hover:text-sa-good transition-colors"
                        >
                          <Unlock size={15} />
                        </button>
                      ) : (
                        <button
                          onClick={() => void lock(a)}
                          title="Lock this account (manual — same mechanism as the automatic anomaly lock)"
                          className="p-1.5 text-sa-ink-faint hover:text-sa-critical transition-colors"
                        >
                          <Lock size={15} />
                        </button>
                      )}
                      {a.pendingDeletionAt ? (
                        <button
                          onClick={() => void cancelDeletion(a)}
                          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-sa-warn bg-sa-warn-soft border border-sa-warn/40 rounded-lg px-2.5 py-1.5 transition-all"
                        >
                          <XCircle size={13} /> Cancel deletion
                        </button>
                      ) : (
                        <button
                          onClick={() => setPendingDelete(a)}
                          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-sa-critical bg-sa-critical-soft border border-sa-critical/40 rounded-lg px-2.5 py-1.5 transition-all"
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {admins?.length === 0 && <EmptyState>No admin accounts yet.</EmptyState>}
          {admins === null && <EmptyState>Loading accounts…</EmptyState>}
        </div>
      </Card>

      {viewingDevicesFor && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="relative w-full max-w-lg bg-sa-panel-raised border border-sa-good/40 rounded-xl p-6 shadow-2xl">
            <button
              onClick={() => setViewingDevicesFor(null)}
              className="absolute top-4 right-4 text-sa-ink-faint hover:text-sa-ink transition-colors"
            >
              <X size={16} />
            </button>
            <div className="flex items-center gap-2.5 mb-1">
              <Monitor size={17} className="text-sa-good shrink-0" />
              <h2 className="text-sm font-semibold text-sa-ink">
                Devices for {viewingDevicesFor.name || viewingDevicesFor.email}
              </h2>
            </div>
            <p className="text-[11.5px] text-sa-ink-faint mb-4">
              Device is the browser + OS parsed from each login's user agent, grouped by IP — there's no real device
              fingerprint available. Location is a best-effort IP lookup and may be missing.
            </p>

            {deviceList === null ? (
              <EmptyState>Loading…</EmptyState>
            ) : deviceList.length === 0 ? (
              <EmptyState>No active login sessions recorded for this account yet.</EmptyState>
            ) : (
              <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto">
                {deviceList.map((d) => (
                  <div key={d.key} className="rounded-lg border border-sa-line bg-sa-panel-inset px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] text-sa-ink font-medium">
                        {d.browser} on {d.os}
                      </span>
                      <span className="text-[10.5px] text-sa-ink-faint shrink-0">
                        {d.loginCount} login{d.loginCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-sa-ink-dim mt-1">
                      {d.location ?? 'Location unknown'}
                      {d.ipAddress ? ` · ${d.ipAddress}` : ''}
                    </div>
                    <div className="text-[11px] text-sa-ink-faint mt-1">
                      First seen {relativeTime(d.firstSeenAt)} · last seen {relativeTime(d.lastSeenAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="relative w-full max-w-md bg-sa-panel-raised border border-sa-critical/40 rounded-xl p-6 shadow-2xl">
            <h2 className="text-sm font-semibold text-sa-critical mb-2">
              Delete {pendingDelete.name}?
            </h2>
            <p className="text-[13px] text-sa-ink-dim mb-4">
              This removes <strong className="text-sa-ink">{pendingDelete.ownedContent.tests} test(s)</strong> and{' '}
              <strong className="text-sa-ink">
                {pendingDelete.ownedContent.mcqQuestions +
                  pendingDelete.ownedContent.codingQuestions +
                  pendingDelete.ownedContent.behavioralQuestions}{' '}
                question(s)
              </strong>{' '}
              owned by this admin, including all candidate results tied to those tests. The admin's activity history in the
              Audit Log is kept either way.
            </p>

            <label className="flex items-start gap-2.5 mb-5 p-3 border border-sa-line rounded-lg bg-sa-panel-inset cursor-pointer">
              <input
                type="checkbox"
                checked={deleteNow}
                onChange={(e) => setDeleteNow(e.target.checked)}
                className="mt-0.5 accent-sa-critical"
              />
              <span className="text-[12.5px] text-sa-ink-dim">
                <strong className="text-sa-ink">Delete immediately</strong> — skip the 7-day grace period. This cannot be
                undone. Leave unchecked to schedule deletion instead, which can be cancelled any time before it runs.
              </span>
            </label>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setPendingDelete(null);
                  setDeleteNow(false);
                }}
                disabled={deleting}
                className="text-[12.5px] px-3.5 py-2 rounded-lg border border-sa-line text-sa-ink-dim hover:text-sa-ink hover:border-sa-line-bright transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="text-[12.5px] px-3.5 py-2 rounded-lg bg-sa-critical text-white font-semibold disabled:opacity-60 hover:brightness-110 transition-all"
              >
                {deleting ? 'Working…' : deleteNow ? 'Delete permanently' : 'Schedule deletion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

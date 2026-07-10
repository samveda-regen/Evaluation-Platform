import { useEffect, useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { Trash2, Eye, LogOut, Unlock, XCircle, Clock } from 'lucide-react';
import { superAdminApi, type AdminAccountSummary } from '../../services/superAdminApi';
import { Card, StatusPill, EmptyState, PageHeader, relativeTime } from './components';

// The main app's own dev origin — impersonation opens a new tab there with
// a short-lived token, since this console and the exam platform are
// deliberately separate apps (see the port-2002 extraction).
const MAIN_APP_ORIGIN = 'http://localhost:5173';

export default function SuperAdminAccounts() {
  const [admins, setAdmins] = useState<AdminAccountSummary[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminAccountSummary | null>(null);
  const [deleteNow, setDeleteNow] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    try {
      const { data } = await superAdminApi.impersonateAccount(admin.id);
      window.open(`${MAIN_APP_ORIGIN}/admin/impersonate?token=${encodeURIComponent(data.token)}`, '_blank');
      toast.success(`Impersonation session opened for ${admin.email} (15 min)`);
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

  const unlock = async (admin: AdminAccountSummary) => {
    try {
      await superAdminApi.unlockAdminSecurity(admin.id);
      toast.success(`${admin.email} unlocked`);
      void load();
    } catch {
      toast.error('Failed to unlock');
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
                  <th key={h} className="px-4 py-2.5 font-mono text-[10px] tracking-[0.06em] uppercase text-sa-ink-faint font-medium">
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
                    <div className="font-mono text-[11px] text-sa-ink-faint">{a.email}</div>
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
                  <td className="px-4 py-2.5 font-mono text-[12px] text-sa-ink-dim">{relativeTime(a.lastActiveAt)}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-sa-ink-dim">
                    {a.ownedContent.tests} test{a.ownedContent.tests === 1 ? '' : 's'},{' '}
                    {a.ownedContent.mcqQuestions + a.ownedContent.codingQuestions + a.ownedContent.behavioralQuestions} question(s)
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-sa-ink-dim">{a.actionsRecorded}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => void impersonate(a)}
                        title="View as this admin (15 min)"
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
                      {a.securityLocked && (
                        <button
                          onClick={() => void unlock(a)}
                          title="Unlock"
                          className="p-1.5 text-sa-ink-faint hover:text-sa-good transition-colors"
                        >
                          <Unlock size={15} />
                        </button>
                      )}
                      {a.pendingDeletionAt ? (
                        <button
                          onClick={() => void cancelDeletion(a)}
                          className="inline-flex items-center gap-1.5 text-[12px] font-mono uppercase tracking-wide font-medium text-sa-warn bg-sa-warn-soft border border-sa-warn/40 rounded-sm px-2.5 py-1.5 transition-all"
                        >
                          <XCircle size={13} /> Cancel deletion
                        </button>
                      ) : (
                        <button
                          onClick={() => setPendingDelete(a)}
                          className="inline-flex items-center gap-1.5 text-[12px] font-mono uppercase tracking-wide font-medium text-sa-critical bg-sa-critical-soft border border-sa-critical/40 rounded-sm px-2.5 py-1.5 hover:shadow-glow-red transition-all"
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

      {pendingDelete && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="relative w-full max-w-md bg-sa-panel-raised border border-sa-critical/40 rounded-sm p-6 shadow-[0_0_50px_rgba(255,46,99,0.15)]">
            <span className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-sa-critical to-transparent" />
            <h2 className="font-mono text-sm font-semibold text-sa-critical uppercase tracking-wide mb-2">
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

            <label className="flex items-start gap-2.5 mb-5 p-3 border border-sa-line rounded-sm bg-sa-panel-inset cursor-pointer">
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
                className="font-mono text-[12.5px] uppercase tracking-wide px-3.5 py-2 rounded-sm border border-sa-line text-sa-ink-dim hover:border-sa-line-bright transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="font-mono text-[12.5px] uppercase tracking-wide px-3.5 py-2 rounded-sm bg-sa-critical text-sa-void font-bold shadow-glow-red disabled:opacity-60 hover:brightness-110 transition-all"
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

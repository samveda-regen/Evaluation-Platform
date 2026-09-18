import { useEffect, useState } from 'react';
import { superAdminApi, type AdminAccountSummary } from '../../services/superAdminApi';
import { useSuperAdminRealtimeStore } from '../../context/superAdminRealtimeStore';
import { Card, EmptyState, PageHeader } from './components';

// onlineAdminIds and stream come from the shared realtime store (populated by
// SuperAdminLayout, which stays mounted for the whole session) rather than
// being owned here — that way the activity feed keeps accumulating in the
// background while this page isn't open, instead of restarting empty every
// time it's re-opened.
export default function SuperAdminLiveMonitor() {
  const [admins, setAdmins] = useState<AdminAccountSummary[]>([]);
  const onlineAdmins = useSuperAdminRealtimeStore((s) => s.onlineAdminIds);
  const stream = useSuperAdminRealtimeStore((s) => s.stream);

  useEffect(() => {
    superAdminApi
      .listAccounts()
      .then(({ data }) => setAdmins(data.admins))
      .catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader
        title="Live Monitor"
        description="Every admin's activity as it happens — API calls (guaranteed complete) and UI clicks (best-effort), streamed live."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        <Card title="Active admins" meta={`${onlineAdmins.size} online`}>
          <div className="flex flex-col gap-2">
            {admins.map((a) => (
              <div key={a.id} className="flex items-center gap-2.5 py-1">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    onlineAdmins.has(a.id) ? 'bg-sa-good shadow-[0_0_0_3px_rgba(79,206,140,0.18)]' : 'bg-sa-ink-faint'
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-[13px] text-sa-ink truncate">{a.name}</div>
                  <div className="text-[11px] text-sa-ink-faint truncate">{a.email}</div>
                </div>
              </div>
            ))}
            {admins.length === 0 && <EmptyState>No admins yet.</EmptyState>}
          </div>
        </Card>

        <Card title="Live activity stream" meta="click-level · real time">
          <div className="flex flex-col gap-2 max-h-[560px] overflow-y-auto">
            {stream.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2.5 py-1.5 border-b border-sa-line-soft last:border-0">
                <span className={`h-1.5 w-1.5 rounded-full mt-1.5 ${entry.kind === 'action' ? 'bg-sa-accent' : 'bg-sa-ink-faint'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-sa-ink">{entry.adminEmail}</div>
                  <div className="text-[11.5px] text-sa-ink-faint truncate">{entry.detail}</div>
                </div>
                <span className="text-[10.5px] text-sa-ink-faint shrink-0">
                  {new Date(entry.time).toLocaleTimeString()}
                </span>
              </div>
            ))}
            {stream.length === 0 && <EmptyState>Waiting for activity…</EmptyState>}
          </div>
        </Card>
      </div>
    </div>
  );
}

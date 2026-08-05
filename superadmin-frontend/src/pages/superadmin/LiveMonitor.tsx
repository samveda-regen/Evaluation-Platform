import { useEffect, useState, useRef, useCallback } from 'react';
import { getRealtimeSocket } from '../../services/realtimeService';
import { superAdminApi, type AdminAccountSummary } from '../../services/superAdminApi';
import { Card, EmptyState, PageHeader } from './components';

interface StreamEntry {
  id: string;
  time: string;
  adminEmail: string;
  kind: 'click' | 'action';
  detail: string;
}

const MAX_STREAM = 150;

export default function SuperAdminLiveMonitor() {
  const [onlineAdmins, setOnlineAdmins] = useState<Set<string>>(new Set());
  const [admins, setAdmins] = useState<AdminAccountSummary[]>([]);
  const [stream, setStream] = useState<StreamEntry[]>([]);
  const streamRef = useRef<StreamEntry[]>([]);

  const pushEntry = useCallback((entry: StreamEntry) => {
    streamRef.current = [entry, ...streamRef.current].slice(0, MAX_STREAM);
    setStream(streamRef.current);
  }, []);

  useEffect(() => {
    superAdminApi
      .listAccounts()
      .then(({ data }) => {
        setAdmins(data.admins);
        setOnlineAdmins(new Set(data.admins.filter((a) => a.status === 'online').map((a) => a.id)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const socket = getRealtimeSocket();

    const handleOnline = (payload: { adminId: string }) => {
      setOnlineAdmins((prev) => new Set(prev).add(payload.adminId));
    };
    const handleOffline = (payload: { adminId: string }) => {
      setOnlineAdmins((prev) => {
        const next = new Set(prev);
        next.delete(payload.adminId);
        return next;
      });
    };
    const handleAction = (row: { id: string; createdAt: string; adminEmail: string; method: string; path: string; statusCode: number }) => {
      pushEntry({
        id: row.id,
        time: row.createdAt,
        adminEmail: row.adminEmail,
        kind: 'action',
        detail: `${row.method} ${row.path} · ${row.statusCode}`,
      });
    };
    const handleClickBatch = (payload: {
      adminEmail: string;
      events: Array<{ id?: string; eventType: string; targetLabel?: string; route?: string; clientTimestamp: string }>;
    }) => {
      payload.events.forEach((e, i) => {
        pushEntry({
          id: `${payload.adminEmail}-${e.clientTimestamp}-${i}`,
          time: e.clientTimestamp,
          adminEmail: payload.adminEmail,
          kind: 'click',
          detail: `clicked "${e.targetLabel || 'unknown'}" on ${e.route || ''}`,
        });
      });
    };

    socket.on('admin-online', handleOnline);
    socket.on('admin-offline', handleOffline);
    socket.on('admin-action', handleAction);
    socket.on('admin-click-batch', handleClickBatch);

    return () => {
      socket.off('admin-online', handleOnline);
      socket.off('admin-offline', handleOffline);
      socket.off('admin-action', handleAction);
      socket.off('admin-click-batch', handleClickBatch);
    };
  }, [pushEntry]);

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

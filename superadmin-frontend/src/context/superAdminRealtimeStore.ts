import { create } from 'zustand';
import type { LiveTelemetry, LiveResources, TelemetrySnapshotEntry } from '../services/superAdminApi';

// Holds everything that arrives over the superadmin socket, independent of
// which page is currently mounted. Previously each page (Telemetry,
// LiveMonitor) owned this state itself and subscribed to the socket in its
// own useEffect — so navigating away unsubscribed it, any events that
// arrived while the page wasn't mounted were silently dropped, and coming
// back re-mounted the page with empty state, making a continuously-running
// feed (e.g. the live activity log) look like it had reset. Listeners here
// are attached once, from SuperAdminLayout, which stays mounted for the
// whole authenticated session — pages just read from this store.

export interface StreamEntry {
  id: string;
  time: string;
  adminEmail: string;
  kind: 'click' | 'action';
  detail: string;
}

const MAX_HISTORY_POINTS = 120;
const MAX_STREAM = 150;

interface SuperAdminRealtimeState {
  live: LiveTelemetry | null;
  history: TelemetrySnapshotEntry[];
  setLive: (live: LiveTelemetry) => void;
  setHistory: (history: TelemetrySnapshotEntry[]) => void;
  appendHistorySnapshot: (snapshot: TelemetrySnapshotEntry) => void;

  resources: LiveResources | null;
  setResources: (resources: LiveResources) => void;

  onlineAdminIds: Set<string>;
  setOnlineAdminIds: (ids: Set<string>) => void;
  markAdminOnline: (adminId: string) => void;
  markAdminOffline: (adminId: string) => void;

  stream: StreamEntry[];
  pushStreamEntry: (entry: StreamEntry) => void;
}

export const useSuperAdminRealtimeStore = create<SuperAdminRealtimeState>((set) => ({
  live: null,
  history: [],
  setLive: (live) => set({ live }),
  setHistory: (history) => set({ history }),
  appendHistorySnapshot: (snapshot) =>
    set((state) => ({ history: [...state.history, snapshot].slice(-MAX_HISTORY_POINTS) })),

  resources: null,
  setResources: (resources) => set({ resources }),

  onlineAdminIds: new Set(),
  setOnlineAdminIds: (ids) => set({ onlineAdminIds: ids }),
  markAdminOnline: (adminId) =>
    set((state) => ({ onlineAdminIds: new Set(state.onlineAdminIds).add(adminId) })),
  markAdminOffline: (adminId) =>
    set((state) => {
      const next = new Set(state.onlineAdminIds);
      next.delete(adminId);
      return { onlineAdminIds: next };
    }),

  stream: [],
  pushStreamEntry: (entry) => set((state) => ({ stream: [entry, ...state.stream].slice(0, MAX_STREAM) })),
}));

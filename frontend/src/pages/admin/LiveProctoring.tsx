import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { getRealtimeSocket } from '../../services/realtimeService';

interface LiveCandidate {
  sessionId: string;
  attemptId: string;
  candidate: {
    id: string;
    name: string;
    email: string;
  };
  status: {
    online: boolean;
    cameraEnabled: boolean;
    microphoneEnabled: boolean;
    screenShareEnabled: boolean;
    cameraBlocked?: boolean;
    testFrozen?: boolean;
    monitorCount: number;
    externalMonitorDetected: boolean;
    faceVerified: boolean;
  };
  violations: number;
  isFlagged: boolean;
  trustScore: number;
  livePreviewUrl?: string | null;
  lastViolation: {
    type: string;
    severity: string;
    description: string;
    timestamp: string;
  } | null;
}

interface ViolationFeedItem {
  id: string;
  attemptId: string;
  severity: string;
  description: string;
  type: string;
  timestamp: string;
}

export default function LiveProctoring() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<LiveCandidate[]>([]);
  const [violations, setViolations] = useState<ViolationFeedItem[]>([]);
  const candidateIdsRef = useRef<Set<string>>(new Set());
  const refreshStateRef = useRef<{ inFlight: boolean; lastAt: number }>({ inFlight: false, lastAt: 0 });

  const loadLiveData = useCallback(async (withLoading = true) => {
    if (!testId) return;
    try {
      if (withLoading) setLoading(true);
      const { data } = await adminApi.getLiveProctoringCandidates(testId);
      setCandidates(data.candidates || []);
    } catch (error) {
      toast.error('Failed to load live proctoring data');
    } finally {
      if (withLoading) setLoading(false);
    }
  }, [testId]);

  const reloadLiveDataThrottled = useCallback(async () => {
    const now = Date.now();
    const guard = refreshStateRef.current;
    if (guard.inFlight) return;
    if (now - guard.lastAt < 1500) return;
    guard.inFlight = true;
    guard.lastAt = now;
    try {
      await loadLiveData(false);
    } finally {
      guard.inFlight = false;
    }
  }, [loadLiveData]);

  useEffect(() => {
    if (!testId) return;
    void loadLiveData(true);
    const refreshInterval = setInterval(() => {
      void loadLiveData(false);
    }, 15000);
    return () => clearInterval(refreshInterval);
  }, [testId, loadLiveData]);

  useEffect(() => {
    candidateIdsRef.current = new Set(candidates.map(candidate => candidate.attemptId));
  }, [candidates]);

  useEffect(() => {
    if (!testId) return;
    const socket = getRealtimeSocket();
    socket.emit('admin-proctor-join', testId);

    const upsertCandidateStatus = (attemptId: string, patch: Partial<LiveCandidate['status']>) => {
      setCandidates(prev => prev.map(candidate => {
        if (candidate.attemptId !== attemptId) return candidate;
        return {
          ...candidate,
          status: {
            ...candidate.status,
            ...patch,
          },
        };
      }));
    };

    const handleCandidateOnline = (payload: { attemptId: string }) => {
      if (!candidateIdsRef.current.has(payload.attemptId)) {
        void reloadLiveDataThrottled();
        return;
      }
      upsertCandidateStatus(payload.attemptId, { online: true });
    };

    const handleCandidateOffline = (payload: { attemptId: string }) => {
      if (!candidateIdsRef.current.has(payload.attemptId)) {
        void reloadLiveDataThrottled();
        return;
      }
      upsertCandidateStatus(payload.attemptId, { online: false });
    };

    const handleStatus = (payload: {
      attemptId: string;
      status: {
        cameraOn?: boolean;
        cameraEnabled?: boolean;
        micOn?: boolean;
        microphoneEnabled?: boolean;
        screenSharing?: boolean;
        screenShareEnabled?: boolean;
        faceDetected?: boolean;
        lookingAtScreen?: boolean;
        cameraBlocked?: boolean;
        testFrozen?: boolean;
        monitorCount?: number;
        externalMonitorDetected?: boolean;
        online?: boolean;
      };
    }) => {
      if (!candidateIdsRef.current.has(payload.attemptId)) {
        void reloadLiveDataThrottled();
        return;
      }
      upsertCandidateStatus(payload.attemptId, {
        cameraEnabled: payload.status.cameraOn ?? payload.status.cameraEnabled ?? false,
        microphoneEnabled: payload.status.micOn ?? payload.status.microphoneEnabled ?? false,
        screenShareEnabled: payload.status.screenSharing ?? payload.status.screenShareEnabled ?? false,
        cameraBlocked: payload.status.cameraBlocked ?? false,
        testFrozen: payload.status.testFrozen ?? false,
        monitorCount: payload.status.monitorCount ?? 1,
        externalMonitorDetected: payload.status.externalMonitorDetected ?? false,
        online: payload.status.online ?? true,
      });
    };

    const handleViolation = (payload: {
      attemptId: string;
      violation: { type: string; severity: string; description: string; timestamp: string };
    }) => {
      if (!candidateIdsRef.current.has(payload.attemptId)) {
        void reloadLiveDataThrottled();
      }
      setCandidates(prev => prev.map(candidate => {
        if (candidate.attemptId !== payload.attemptId) return candidate;
        return {
          ...candidate,
          violations: candidate.violations + 1,
          lastViolation: payload.violation,
        };
      }));
      setViolations(prev => [{
        id: `${payload.attemptId}-${payload.violation.timestamp}-${payload.violation.type}`,
        attemptId: payload.attemptId,
        severity: payload.violation.severity,
        description: payload.violation.description,
        type: payload.violation.type,
        timestamp: payload.violation.timestamp,
      }, ...prev].slice(0, 100));
    };

    const handleLiveFrame = (payload: { attemptId: string; frame: string }) => {
      if (!candidateIdsRef.current.has(payload.attemptId)) {
        void reloadLiveDataThrottled();
        return;
      }
      setCandidates(prev => prev.map(candidate => {
        if (candidate.attemptId !== payload.attemptId) return candidate;
        return {
          ...candidate,
          livePreviewUrl: `data:image/jpeg;base64,${payload.frame}`,
        };
      }));
    };

    socket.on('candidate-online', handleCandidateOnline);
    socket.on('candidate-offline', handleCandidateOffline);
    socket.on('status-update', handleStatus);
    socket.on('candidate-status', handleStatus as any);
    socket.on('violation-detected', handleViolation);
    socket.on('live-frame', handleLiveFrame);

    return () => {
      socket.off('candidate-online', handleCandidateOnline);
      socket.off('candidate-offline', handleCandidateOffline);
      socket.off('status-update', handleStatus);
      socket.off('candidate-status', handleStatus as any);
      socket.off('violation-detected', handleViolation);
      socket.off('live-frame', handleLiveFrame);
    };
  }, [testId, reloadLiveDataThrottled]);

  const stats = useMemo(() => {
    const online = candidates.filter(c => c.status.online).length;
    const flagged = candidates.filter(c => c.isFlagged).length;
    const highRisk = candidates.filter(c => (c.trustScore || 100) < 60).length;
    return { online, flagged, highRisk, total: candidates.length };
  }, [candidates]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">Live Proctoring</h1>
        <button onClick={() => navigate(-1)} className="btn btn-secondary">Back</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card"><p className="text-sm text-gray-500">Candidates</p><p className="text-2xl font-bold">{stats.total}</p></div>
        <div className="card"><p className="text-sm text-gray-500">Online</p><p className="text-2xl font-bold text-green-600">{stats.online}</p></div>
        <div className="card"><p className="text-sm text-gray-500">Flagged</p><p className="text-2xl font-bold text-red-600">{stats.flagged}</p></div>
        <div className="card"><p className="text-sm text-gray-500">High Risk</p><p className="text-2xl font-bold text-orange-600">{stats.highRisk}</p></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card">
          <h2 className="text-lg font-semibold mb-4">Candidate Status</h2>
          {candidates.length === 0 ? (
            <p className="text-gray-500">No active proctoring sessions.</p>
          ) : (
            <div className="space-y-3">
              {candidates.map(candidate => (
                <div key={candidate.attemptId} className="border rounded-lg p-4">
                  <div className="flex justify-between">
                    <div>
                      <p className="font-semibold">{candidate.candidate.name}</p>
                      <p className="text-sm text-gray-500">{candidate.candidate.email}</p>
                    </div>
                    <div className="text-right">
                      <p className={candidate.status.online ? 'text-green-600 font-medium' : 'text-gray-500'}>{candidate.status.online ? 'Online' : 'Offline'}</p>
                      <p className="text-sm text-gray-500">Trust: {Math.round(candidate.trustScore || 100)}%</p>
                    </div>
                  </div>
                  {candidate.livePreviewUrl && (
                    <img
                      src={candidate.livePreviewUrl}
                      alt="Live candidate snapshot"
                      className="mt-3 w-full max-h-48 object-contain rounded border"
                    />
                  )}
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className={`badge ${candidate.status.cameraEnabled ? 'badge-success' : 'badge-error'}`}>Cam</span>
                    <span className={`badge ${candidate.status.microphoneEnabled ? 'badge-success' : 'badge-error'}`}>Mic</span>
                    <span className={`badge ${candidate.status.screenShareEnabled ? 'badge-success' : 'badge-error'}`}>Screen</span>
                    <span className={`badge ${candidate.status.monitorCount > 1 ? 'badge-error' : 'badge-info'}`}>Monitors {candidate.status.monitorCount}</span>
                    {candidate.status.testFrozen && <span className="badge badge-error">Frozen</span>}
                    <span className={`badge ${candidate.violations > 0 ? 'badge-warning' : 'badge-success'}`}>Violations {candidate.violations}</span>
                    {candidate.isFlagged && <span className="badge badge-error">Flagged</span>}
                  </div>
                  {candidate.lastViolation && (
                    <p className="text-sm text-red-700 mt-2">
                      Last: {candidate.lastViolation.type.replace(/_/g, ' ')} - {candidate.lastViolation.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Live Violation Feed</h2>
          {violations.length === 0 ? (
            <p className="text-gray-500">No live violations yet.</p>
          ) : (
            <div className="space-y-2 max-h-[560px] overflow-auto">
              {violations.map(v => (
                <div key={v.id} className="border rounded p-2">
                  <p className="text-sm font-medium">{v.type.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-gray-600">{v.description}</p>
                  <p className="text-xs text-gray-500">Attempt: {v.attemptId.slice(0, 8)} | {v.severity}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

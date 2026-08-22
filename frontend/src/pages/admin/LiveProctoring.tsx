import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronDown,
  Eye,
  Mic,
  Monitor,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { RemoteTrack, RemoteTrackPublication, Room, RoomEvent, Track } from 'livekit-client';
import { adminApi } from '../../services/api';

interface LiveCandidate {
  attemptId?: string;
  sessionId?: string;
  testId?: string;
  testName?: string;
  initials: string;
  name: string;
  role: string;
  trust: number;
  question: string;
  warning?: string;
  highlighted?: boolean;
  online?: boolean;
  cameraEnabled?: boolean;
  microphoneEnabled?: boolean;
  screenShareEnabled?: boolean;
}

function trustColor(score: number) {
  if (score >= 80) return '#059669';
  if (score >= 65) return '#D97706';
  return '#E11D48';
}

function CandidateVideo({ attemptId, active }: { attemptId?: string; active: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const attachedVideoRef = useRef<RemoteTrack | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');

  useEffect(() => {
    if (!active || !attemptId) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    const attachTrack = (track: RemoteTrack, publication?: RemoteTrackPublication) => {
      if (track.kind === Track.Kind.Video && publication?.source === Track.Source.Camera && videoRef.current) {
        if (attachedVideoRef.current && attachedVideoRef.current !== track) {
          attachedVideoRef.current.detach(videoRef.current);
        }
        track.attach(videoRef.current);
        attachedVideoRef.current = track;
        setStatus('connected');
      }
      if (track.kind === Track.Kind.Audio && audioRef.current) {
        track.attach(audioRef.current);
      }
    };

    room.on(RoomEvent.TrackSubscribed, attachTrack);
    room.on(RoomEvent.Disconnected, () => {
      if (!cancelled) setStatus('idle');
    });

    const connect = async () => {
      try {
        setStatus('connecting');
        const { data } = await adminApi.getLiveProctoringViewerToken(attemptId);
        if (cancelled) return;
        await room.connect(data.url, data.token, { autoSubscribe: true });
        if (cancelled) return;
        room.remoteParticipants.forEach((participant) => {
          participant.trackPublications.forEach((publication) => {
            if (publication.track) attachTrack(publication.track, publication);
          });
        });
      } catch (error) {
        console.error('Live proctoring viewer failed:', error);
        setStatus('error');
        room.disconnect();
      }
    };

    void connect();

    return () => {
      cancelled = true;
      room.off(RoomEvent.TrackSubscribed, attachTrack);
      if (videoRef.current && attachedVideoRef.current) {
        attachedVideoRef.current.detach(videoRef.current);
      }
      attachedVideoRef.current = null;
      room.disconnect();
    };
  }, [active, attemptId]);

  if (!active) return null;

  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          backgroundColor: '#020617',
        }}
      />
      <audio ref={audioRef} autoPlay />
      {status !== 'connected' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#CBD5E1',
            fontSize: '12px',
            fontWeight: 700,
            backgroundColor: 'rgba(15,23,42,0.74)',
          }}
        >
          {status === 'error' ? 'Live video unavailable' : 'Connecting live video...'}
        </div>
      )}
    </>
  );
}

function LiveTile({
  candidate,
  selected,
  onSelect,
}: {
  candidate: LiveCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      style={{
        backgroundColor: 'white',
        border: candidate.highlighted ? '2px solid #FDA4AF' : '1px solid var(--admin-border-soft)',
        borderRadius: '14px',
        boxShadow: candidate.highlighted
          ? '0 14px 32px rgba(225, 29, 72, 0.12)'
          : '0 12px 28px rgba(17, 22, 42, 0.08)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'relative',
          height: '200px',
          background: 'linear-gradient(145deg, #101827 0%, #17243A 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '12px',
            left: '12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 9px',
            borderRadius: '7px',
            backgroundColor: '#E11D48',
            color: 'white',
            fontSize: '10px',
            fontWeight: 800,
            letterSpacing: '0.02em',
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'white' }} />
          LIVE
        </div>

        <div style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '6px' }}>
          {[Mic, Monitor].map((IconCmp, index) => (
            <button
              key={index}
              type="button"
              title={index === 0 ? 'Microphone active' : 'Screen visible'}
              aria-label={index === 0 ? 'Microphone active' : 'Screen visible'}
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.08)',
                backgroundColor: 'rgba(0,0,0,0.36)',
                color: index === 0 && !candidate.microphoneEnabled ? '#94A3B8' : 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconCmp size={13} />
            </button>
          ))}
        </div>

        {!selected && (
          <div
            style={{
              width: '66px',
              height: '66px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '13px',
              fontWeight: 800,
            }}
          >
            {candidate.initials}
          </div>
        )}

        {candidate.warning && (
          <div
            style={{
              position: 'absolute',
              left: '12px',
              bottom: '12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              borderRadius: '7px',
              backgroundColor: '#E11D48',
              color: 'white',
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            <AlertTriangle size={12} />
            {candidate.warning}
          </div>
        )}

        <span
          style={{
            position: 'absolute',
            right: '10px',
            bottom: '12px',
            padding: '3px 8px',
            borderRadius: '6px',
            backgroundColor: 'rgba(0,0,0,0.62)',
            color: 'white',
            fontSize: '11px',
            fontWeight: 800,
          }}
        >
          {candidate.question}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '15px 14px 16px' }}>
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            backgroundColor: 'var(--admin-accent)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {candidate.initials}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, color: 'var(--admin-text)', fontSize: '14px', fontWeight: 800, lineHeight: 1.25 }}>
            {candidate.name}
          </p>
          <p style={{ margin: '2px 0 0', color: 'var(--admin-text-subtle)', fontSize: '12px', lineHeight: 1.25 }}>
            {candidate.role}
          </p>
        </div>
        <div style={{ textAlign: 'center', flexShrink: 0, width: '42px' }}>
          <p style={{ margin: 0, color: trustColor(candidate.trust), fontSize: '17px', fontWeight: 900, lineHeight: 1 }}>
            {candidate.trust}
          </p>
          <p style={{ margin: '3px 0 0', color: 'var(--admin-text-subtle)', fontSize: '10px', lineHeight: 1 }}>
            trust
          </p>
        </div>
        <button
          type="button"
          title="Preview session"
          aria-label="Preview session"
          onClick={onSelect}
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '9px',
            border: '1px solid var(--admin-border-soft)',
            backgroundColor: selected ? 'var(--admin-accent)' : 'white',
            color: selected ? 'white' : 'var(--admin-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Eye size={15} />
        </button>
      </div>
    </div>
  );
}

export default function LiveProctoring() {
  const { testId } = useParams();
  const [liveCandidates, setLiveCandidates] = useState<LiveCandidate[]>([]);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [viewerCandidate, setViewerCandidate] = useState<LiveCandidate | null>(null);
  const [search, setSearch] = useState('');
  const [testFilter, setTestFilter] = useState<string | null>(null);
  const [testMenuOpen, setTestMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = testId
          ? await adminApi.getLiveProctoringCandidates(testId)
          : await adminApi.getAllLiveProctoringCandidates();
        if (cancelled) return;
        const candidates = (data.candidates || []).map((item: any): LiveCandidate => {
          const name = item.candidate?.name || item.candidate?.email || 'Candidate';
          const initials = name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part: string) => part[0]?.toUpperCase())
            .join('') || 'CN';
          return {
            attemptId: item.attemptId,
            sessionId: item.sessionId,
            testId: item.testId || testId,
            testName: item.test?.name,
            initials,
            name,
            role: item.candidate?.email || 'Live candidate',
            trust: Math.round(item.trustScore ?? 100),
            question: item.status?.online ? 'Live' : 'Offline',
            warning: item.lastViolation?.description || undefined,
            highlighted: Boolean(item.lastViolation || item.isFlagged),
            online: item.status?.online,
            cameraEnabled: item.status?.cameraEnabled,
            microphoneEnabled: item.status?.microphoneEnabled,
            screenShareEnabled: item.status?.screenShareEnabled,
          };
        });
        setLiveCandidates(candidates);
        setTestFilter((current) =>
          current && candidates.some((candidate: LiveCandidate) => candidate.testId === current)
            ? current
            : null
        );
        setSelectedAttemptId((current) =>
          current && candidates.some((candidate: LiveCandidate) => candidate.attemptId === current)
            ? current
            : candidates[0]?.attemptId || null
        );
      } catch (error) {
        console.error('Failed to load live proctoring candidates:', error);
      }
    };

    void load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [testId]);

  const testOptions = Array.from(
    liveCandidates.reduce((map, candidate) => {
      if (candidate.testId && !map.has(candidate.testId)) {
        map.set(candidate.testId, candidate.testName || 'Untitled test');
      }
      return map;
    }, new Map<string, string>())
  ).map(([id, name]) => ({ id, name }));

  const visibleCandidates = liveCandidates.filter(candidate => {
    if (testFilter && candidate.testId !== testFilter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return `${candidate.name} ${candidate.role}`.toLowerCase().includes(term);
  });
  const liveCount = liveCandidates.filter(candidate => candidate.online !== false).length;

  return (
    <div style={{ backgroundColor: '#F9FAFB', minHeight: '100%' }}>
      <div className="admin-page-header" style={{ marginBottom: '24px' }}>
        <div className="admin-page-heading">
          <div>
            <h1 className="admin-page-title">Live Proctoring</h1>
            <p className="admin-page-subtitle">
              Real-time candidate video monitoring during active proctored exams.
            </p>
          </div>
        </div>

        <div className="admin-header-actions">
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            style={{ color: '#047857', borderColor: '#A7F3D0', backgroundColor: '#ECFDF5' }}
          >
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#34D399' }} />
            {liveCount} live
          </button>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => setTestMenuOpen((open) => !open)}
            >
              {testFilter ? testOptions.find((option) => option.id === testFilter)?.name || 'All live sessions' : 'All live sessions'}
              <ChevronDown size={15} color="var(--admin-text-subtle)" />
            </button>
            {testMenuOpen && (
              <>
                <div
                  onClick={() => setTestMenuOpen(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 20 }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '4px',
                    zIndex: 30,
                    minWidth: '220px',
                    maxHeight: '280px',
                    overflowY: 'auto',
                    backgroundColor: 'white',
                    border: '1px solid var(--admin-accent-disabled)',
                    borderRadius: '8px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => { setTestFilter(null); setTestMenuOpen(false); }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '9px 14px',
                      background: testFilter === null ? 'var(--admin-accent-soft)' : 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '13px',
                      color: testFilter === null ? 'var(--admin-accent-hover)' : 'var(--admin-text)',
                      fontWeight: testFilter === null ? 600 : 400,
                    }}
                  >
                    All live sessions
                  </button>
                  {testOptions.length === 0 && (
                    <div style={{ padding: '9px 14px', fontSize: '13px', color: 'var(--admin-text-subtle)' }}>
                      No active tests right now
                    </div>
                  )}
                  {testOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => { setTestFilter(option.id); setTestMenuOpen(false); }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '9px 14px',
                        background: testFilter === option.id ? 'var(--admin-accent-soft)' : 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '13px',
                        color: testFilter === option.id ? 'var(--admin-accent-hover)' : 'var(--admin-text)',
                        fontWeight: testFilter === option.id ? 600 : 400,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          marginBottom: '24px',
          padding: '14px 16px',
          borderRadius: '12px',
          border: '1px solid #BFDBFE',
          background: 'linear-gradient(90deg, #EFF6FF 0%, #F8FAFC 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '9px',
              backgroundColor: 'var(--admin-accent)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ShieldCheck size={17} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, color: 'var(--admin-text)', fontSize: '13px', fontWeight: 800 }}>
              Live sessions
            </p>
            <p style={{ margin: '1px 0 0', color: 'var(--admin-text-muted)', fontSize: '12px' }}>
              Candidate video tiles appear here while a proctored exam is in progress.
            </p>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: 'min(100%, 320px)',
            height: '36px',
            borderRadius: 'var(--admin-field-radius)',
            border: '1px solid var(--admin-border)',
            backgroundColor: 'white',
            padding: '0 11px',
            color: 'var(--admin-text-subtle)',
            fontSize: '13px',
          }}
        >
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search live sessions..."
            aria-label="Search live sessions"
            style={{
              flex: 1,
              minWidth: 0,
              border: 0,
              outline: 0,
              background: 'transparent',
              color: 'var(--admin-text)',
              fontSize: '13px',
            }}
          />
        </div>
      </div>

      {visibleCandidates.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '16px',
          }}
        >
          {visibleCandidates.map(candidate => (
            <LiveTile
              key={candidate.attemptId || candidate.name}
              candidate={candidate}
              selected={Boolean(candidate.attemptId && selectedAttemptId === candidate.attemptId)}
              onSelect={() => {
                if (!candidate.attemptId) return;
                setSelectedAttemptId(candidate.attemptId);
                setViewerCandidate(candidate);
              }}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            minHeight: '280px',
            border: '1px dashed var(--admin-border)',
            borderRadius: '12px',
            backgroundColor: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '32px',
          }}
        >
          <div>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                backgroundColor: '#EFF6FF',
                color: 'var(--admin-accent)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '12px',
              }}
            >
              <Monitor size={22} />
            </div>
            <p style={{ margin: 0, color: 'var(--admin-text)', fontSize: '15px', fontWeight: 800 }}>
              No live candidates yet
            </p>
            <p style={{ margin: '6px 0 0', color: 'var(--admin-text-muted)', fontSize: '13px' }}>
              Candidate video tiles will appear here when a proctored exam is in progress.
            </p>
          </div>
        </div>
      )}

      {viewerCandidate?.attemptId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${viewerCandidate.name} live video`}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            backgroundColor: 'rgba(15, 23, 42, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
          onClick={() => setViewerCandidate(null)}
        >
          <div
            style={{
              width: 'min(1120px, 96vw)',
              maxHeight: '92vh',
              borderRadius: '12px',
              overflow: 'hidden',
              backgroundColor: 'white',
              boxShadow: '0 24px 70px rgba(15, 23, 42, 0.34)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              style={{
                height: '56px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                padding: '0 16px 0 18px',
                borderBottom: '1px solid var(--admin-border-soft)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, color: 'var(--admin-text)', fontSize: '15px', fontWeight: 800 }}>
                  {viewerCandidate.name}
                </p>
                <p style={{ margin: '2px 0 0', color: 'var(--admin-text-subtle)', fontSize: '12px' }}>
                  {viewerCandidate.role}
                </p>
              </div>
              <button
                type="button"
                title="Close live viewer"
                aria-label="Close live viewer"
                onClick={() => setViewerCandidate(null)}
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '9px',
                  border: '1px solid var(--admin-border-soft)',
                  backgroundColor: 'white',
                  color: 'var(--admin-text)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={17} />
              </button>
            </div>
            <div
              style={{
                position: 'relative',
                aspectRatio: '16 / 9',
                width: '100%',
                backgroundColor: '#0F172A',
              }}
            >
              <CandidateVideo attemptId={viewerCandidate.attemptId} active />
              <div
                style={{
                  position: 'absolute',
                  top: '14px',
                  left: '14px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '7px 12px',
                  borderRadius: '8px',
                  backgroundColor: '#E11D48',
                  color: 'white',
                  fontSize: '12px',
                  fontWeight: 800,
                }}
              >
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: 'white' }} />
                LIVE CAMERA
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

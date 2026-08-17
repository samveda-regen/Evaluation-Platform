import { useState, useRef, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';

interface GuardedAudioPlayerProps {
  src: string;
  replayLimit?: number | null;
  allowRewind?: boolean | null;
  allowSpeedChange?: boolean | null;
  fixedPlaybackSpeed?: number | null;
  initialReplayCount?: number;
  onReplayCountChange?: (count: number) => void;
  disabled?: boolean;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5];

// Wraps native <audio> with a custom control surface so playback guardrails
// (replay limit, rewind lock, speed lock) can actually be enforced — the
// browser's built-in <audio controls> UI can't be restricted this way.
export default function GuardedAudioPlayer({
  src,
  replayLimit,
  allowRewind,
  allowSpeedChange,
  fixedPlaybackSpeed,
  initialReplayCount = 0,
  onReplayCountChange,
  disabled = false,
}: GuardedAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playCount, setPlayCount] = useState(initialReplayCount);
  const [speed, setSpeed] = useState(fixedPlaybackSpeed || 1);

  const limit = replayLimit ?? 1;
  const rewindAllowed = allowRewind !== false;
  const speedChangeAllowed = allowSpeedChange !== false;
  const atStart = currentTime === 0 || ended;
  const limitReached = limit > 0 && playCount >= limit;

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speedChangeAllowed ? speed : (fixedPlaybackSpeed || 1);
    }
  }, [speed, speedChangeAllowed, fixedPlaybackSpeed]);

  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio || disabled) return;
    if (playing) {
      audio.pause();
      return;
    }
    if (atStart) {
      if (limitReached) return;
      const next = playCount + 1;
      setPlayCount(next);
      onReplayCountChange?.(next);
      if (ended) {
        audio.currentTime = 0;
        setEnded(false);
      }
    }
    audio.play();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!rewindAllowed || !audioRef.current) return;
    audioRef.current.currentTime = Number(e.target.value);
    setCurrentTime(Number(e.target.value));
  };

  const fmt = (s: number) => {
    if (!Number.isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--admin-border)', backgroundColor: '#F9FAFB' }}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setEnded(true); }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handlePlayPause}
          disabled={disabled || (!playing && atStart && limitReached)}
          className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white disabled:opacity-40 transition-opacity"
          style={{ backgroundColor: 'var(--admin-accent)' }}
        >
          {playing ? <Pause size={16} fill="white" stroke="white" /> : <Play size={16} fill="white" stroke="white" style={{ marginLeft: '2px' }} />}
        </button>
        <div className="flex-1">
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={currentTime}
            onChange={handleSeek}
            disabled={!rewindAllowed || disabled}
            className="w-full"
            style={{ accentColor: 'var(--admin-accent)', cursor: rewindAllowed ? 'pointer' : 'not-allowed' }}
          />
          <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--admin-text-subtle)' }}>
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>
        {speedChangeAllowed && (
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            disabled={disabled}
            className="text-xs rounded-lg border px-2 py-1.5 outline-none"
            style={{ borderColor: 'var(--admin-border)', color: 'var(--admin-text-muted)', backgroundColor: 'white' }}
          >
            {SPEED_OPTIONS.map(s => <option key={s} value={s}>{s}x</option>)}
          </select>
        )}
      </div>
      <div className="flex items-center justify-between mt-3">
        <span className="text-xs" style={{ color: 'var(--admin-text-subtle)' }}>
          {!rewindAllowed && 'Rewind disabled · '}
          {!speedChangeAllowed && `Locked at ${fixedPlaybackSpeed || 1}x · `}
          Plays used: {playCount}/{limit}
        </span>
        {limitReached && (
          <span className="text-xs font-semibold" style={{ color: '#DC2626' }}>Replay limit reached</span>
        )}
      </div>
    </div>
  );
}

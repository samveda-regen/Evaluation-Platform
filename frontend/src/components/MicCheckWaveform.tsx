import { useEffect, useRef, useState } from 'react';

const BAR_COUNT = 24;
const flat = () => new Array<number>(BAR_COUNT).fill(0);

/**
 * Compact live microphone-level equalizer shown inside the Microphone tile on
 * the System Check page while the mic check is running. Reuses the same mic
 * MediaStream the check already acquired — it never calls getUserMedia and never
 * stops the stream's tracks (the stream stays live for the whole assessment).
 * It only owns its own AudioContext/AnalyserNode/rAF loop and tears those down
 * when the stream goes away or the component unmounts.
 */
export default function MicCheckWaveform({ stream }: { stream: MediaStream | null }) {
  const [levels, setLevels] = useState<number[]>(flat);
  const smoothRef = useRef<number[]>(flat());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const hasLiveAudio =
      !!stream && stream.getAudioTracks().some((track) => track.readyState === 'live');

    if (!hasLiveAudio) {
      smoothRef.current = flat();
      setLevels(flat());
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const audioCtx = new AudioCtx();
    void audioCtx.resume().catch(() => {});

    const source = audioCtx.createMediaStreamSource(stream as MediaStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128; // 64 frequency bins
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser); // deliberately NOT connected to the destination — no playback

    const bins = analyser.frequencyBinCount;
    const data = new Uint8Array(bins);
    // Voice energy concentrates in the lower bins — spread the lower ~2/3 across the bars.
    const usableBins = Math.max(BAR_COUNT, Math.floor(bins * 0.66));
    const perBar = Math.max(1, Math.floor(usableBins / BAR_COUNT));

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const next = smoothRef.current.slice();
      for (let i = 0; i < BAR_COUNT; i += 1) {
        let sum = 0;
        for (let j = 0; j < perBar; j += 1) sum += data[i * perBar + j] ?? 0;
        const target = Math.min(1, (sum / perBar / 255) * 1.6);
        next[i] += (target - next[i]) * 0.35; // ease toward the new value for a smooth motion
      }
      smoothRef.current = next;
      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      try { source.disconnect(); } catch { /* already gone */ }
      try { analyser.disconnect(); } catch { /* already gone */ }
      try { void audioCtx.close(); } catch { /* already closed */ }
    };
  }, [stream]);

  return (
    <div className="flex items-center justify-center gap-[3px] w-full" style={{ height: 22 }} aria-hidden="true">
      {levels.map((level, i) => (
        <span
          key={i}
          className="rounded-full"
          style={{
            width: 3,
            height: `${12 + level * 88}%`,
            background: 'var(--admin-accent)',
            opacity: 0.35 + level * 0.65,
            transition: 'height 90ms linear, opacity 90ms linear',
          }}
        />
      ))}
    </div>
  );
}

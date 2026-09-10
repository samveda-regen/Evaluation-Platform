import { useCallback, useEffect, useRef, useState } from 'react';
import { Video } from 'lucide-react';

interface Props {
  /** Live camera stream acquired by the system check. */
  stream: MediaStream | null;
  /** Called with a fresh stream when the candidate picks a different camera. */
  onDeviceChange: (stream: MediaStream) => void;
}

/**
 * Live webcam preview + camera picker shown in the body of the Webcam tile on
 * the System Check page. Reuses the stream the check already acquired; switching
 * cameras acquires a new stream and hands it back to the page (which stops the
 * old one and updates the shared cache). Never stops tracks on unmount — the
 * stream stays live for the assessment.
 */
export default function SystemCheckCameraPanel({ stream, onDeviceChange }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [switching, setSwitching] = useState(false);

  const activeDeviceId = stream?.getVideoTracks()[0]?.getSettings().deviceId ?? '';

  const bindVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      if (el && stream) {
        el.srcObject = stream;
        el.play().catch(() => {});
      }
    },
    [stream],
  );

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => {
        if (!cancelled) setDevices(list.filter((d) => d.kind === 'videoinput' && d.deviceId));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [stream]);

  const handleChange = async (deviceId: string) => {
    if (!deviceId || deviceId === activeDeviceId || switching) return;
    setSwitching(true);
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      onDeviceChange(next);
    } catch {
      /* keep the current camera if the new one can't be opened */
    } finally {
      setSwitching(false);
    }
  };

  const options =
    devices.length > 0
      ? devices.map((d, i) => ({ value: d.deviceId, label: d.label || `Camera ${i + 1}` }))
      : [{ value: activeDeviceId || 'default', label: 'Default camera' }];

  const selectValue = options.some((o) => o.value === activeDeviceId) ? activeDeviceId : options[0].value;

  return (
    <div className="mt-1">
      <div
        className="relative w-full overflow-hidden rounded-xl border"
        style={{ height: 132, background: '#0F172A', borderColor: 'rgba(15,23,42,0.12)' }}
      >
        <video
          ref={bindVideo}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
          style={{ transform: 'scaleX(-1)', opacity: switching ? 0.5 : 1, transition: 'opacity 150ms' }}
        />
        <span
          className="absolute right-2 top-2 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ background: 'rgba(15,23,42,0.65)', color: '#FFFFFF' }}
        >
          Preview
        </span>
      </div>

      <div className="relative mt-2">
        <Video
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4"
          style={{ color: 'var(--admin-text-subtle)' }}
          aria-hidden="true"
        />
        <select
          aria-label="Camera"
          value={selectValue}
          onChange={(e) => handleChange(e.target.value)}
          disabled={switching || options.length < 2}
          className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-70"
          style={{ borderColor: 'var(--admin-border)', color: 'var(--admin-text)', background: '#FFFFFF' }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

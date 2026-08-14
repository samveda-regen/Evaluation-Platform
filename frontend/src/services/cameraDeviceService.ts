// Camera acquisition that verifies the stream is actually usable before accepting it.
//
// getUserMedia() resolving with a 'live' video track is not proof the candidate will see
// (or the proctoring model will get) real frames. Two real-world failure modes motivated
// this file:
//
// 1. Laptops with a Windows Hello / IR camera in addition to the regular webcam: a bare
//    getUserMedia({video:true}) can be resolved by the browser against the IR sensor,
//    which reports a genuinely 'live' track (permission UI shows granted) but renders
//    black/unusable in a normal color <video> element and is useless to a vision model.
// 2. Some camera pipelines (observed specifically inside SEB's embedded browser) can
//    return a track that stays at 0x0 dimensions — never firing a real frame — with no
//    error thrown anywhere, so nothing in a plain try/catch around getUserMedia() catches
//    it.
//
// Device labels are the only signal available to steer away from (1), and are only
// populated by the browser once some camera permission has already been granted this
// session — hence the two-phase approach below (first grab whatever the browser gives us,
// then re-request a specific alternate device only if that first grab doesn't pan out).

const UNWANTED_CAMERA_LABEL_PATTERN = /\b(ir|infrared|hello|depth|face\s*auth)\b/i;

export interface VerifiedCameraResult {
  stream: MediaStream | null;
  deviceId?: string;
  framesVerified: boolean;
}

async function listVideoInputDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

function pickPreferredDeviceId(devices: MediaDeviceInfo[], excludeIds: Set<string>): string | undefined {
  const candidates = devices.filter(d => d.deviceId && !excludeIds.has(d.deviceId));
  if (candidates.length === 0) return undefined;
  const nonIr = candidates.filter(d => !UNWANTED_CAMERA_LABEL_PATTERN.test(d.label || ''));
  return (nonIr[0] || candidates[0]).deviceId;
}

/**
 * Resolves once the stream's video track has actually decoded a frame (videoWidth/
 * videoHeight populated) — not merely once getUserMedia() has resolved. A track can
 * report readyState 'live' while sitting at 0x0 indefinitely.
 */
export function waitForVideoFrame(stream: MediaStream, timeoutMs = 4000): Promise<boolean> {
  return new Promise(resolve => {
    const track = stream.getVideoTracks()[0];
    if (!track) {
      resolve(false);
      return;
    }

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', checkFrame);
      video.removeEventListener('playing', checkFrame);
      video.pause();
      video.srcObject = null;
      resolve(ok);
    };

    const checkFrame = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) finish(true);
    };

    video.addEventListener('loadedmetadata', checkFrame);
    video.addEventListener('playing', checkFrame);
    video.play().catch(() => {});

    timer = setTimeout(() => finish(video.videoWidth > 0 && video.videoHeight > 0), timeoutMs);
  });
}

/**
 * Acquires a camera stream, steering away from IR/Windows-Hello-style cameras and
 * confirming the result actually produces frames before accepting it. Tries up to 3
 * distinct devices (when more than one is available) before giving up and returning
 * whatever it last got, so callers always have a fallback rather than nothing.
 *
 * IR/Hello cameras are rejected on label alone even when they DO produce frames — an IR
 * sensor decoded through a normal color pipeline still reports real non-zero videoWidth/
 * videoHeight (so frame-presence checks alone don't catch it), it's just not a usable
 * picture (typically a flat dark/blue-tinted image, not the candidate's face).
 */
export async function acquireVerifiedCameraStream(
  constraints: MediaTrackConstraints = {},
  frameTimeoutMs = 4000,
): Promise<VerifiedCameraResult> {
  const triedDeviceIds = new Set<string>();
  let lastStream: MediaStream | null = null;
  let lastDeviceId: string | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    // Device labels are populated once permission has been granted at least once this
    // origin/session (either from an earlier attempt in this loop, or a prior visit) —
    // as soon as they're available, pick an explicit non-IR device rather than leaving
    // selection to the browser default, instead of only reacting after a failure.
    const devices = await listVideoInputDevices();
    const labelsKnown = devices.some(d => d.label);
    let deviceId: string | undefined;
    if (triedDeviceIds.size > 0 || labelsKnown) {
      deviceId = pickPreferredDeviceId(devices, triedDeviceIds);
      if (!deviceId && triedDeviceIds.size > 0) break; // no untried device left to fall back to
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { ...constraints, deviceId: { exact: deviceId } } : constraints,
      });
    } catch (err) {
      console.error('Camera acquisition failed:', err);
      break;
    }

    const track = stream.getVideoTracks()[0];
    const actualDeviceId = track?.getSettings().deviceId;
    if (actualDeviceId) triedDeviceIds.add(actualDeviceId);

    const label = track?.label || devices.find(d => d.deviceId === actualDeviceId)?.label || '';
    const isUnwantedDevice = UNWANTED_CAMERA_LABEL_PATTERN.test(label);
    const framesOk = !isUnwantedDevice && await waitForVideoFrame(stream, frameTimeoutMs);

    if (framesOk) {
      lastStream?.getTracks().forEach(t => t.stop());
      return { stream, deviceId: actualDeviceId, framesVerified: true };
    }

    // Not usable — but keep it as a last-resort fallback in case every candidate device
    // fails verification (e.g. only an IR camera is present at all, or every device is
    // slow to warm up rather than genuinely broken).
    lastStream?.getTracks().forEach(t => t.stop());
    lastStream = stream;
    lastDeviceId = actualDeviceId;
  }

  return { stream: lastStream, deviceId: lastDeviceId, framesVerified: false };
}

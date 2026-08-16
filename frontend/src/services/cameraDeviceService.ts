// Camera acquisition that verifies the stream is actually usable before accepting it.
//
// getUserMedia() resolving with a 'live' video track is not proof the candidate will see
// (or the proctoring model will get) real frames. Two real-world failure modes motivated
// this file:
//
// 1. Laptops with a Windows Hello / IR camera in addition to the regular webcam: a bare
//    getUserMedia({video:true}) can be resolved by the browser against the IR sensor,
//    which reports a genuinely 'live' track (permission UI shows granted) and even
//    produces real, non-zero-dimension frames — just not a usable picture (a flat,
//    near-monochrome image instead of the candidate's face).
// 2. Some camera pipelines (observed specifically inside SEB's embedded browser) can
//    return a track that stays at 0x0 dimensions — never firing a real frame — with no
//    error thrown anywhere, so nothing in a plain try/catch around getUserMedia() catches
//    it.
//
// Device *labels* ("IR Camera", "Windows Hello Face Camera", etc.) are not a reliable way
// to catch (1) — naming conventions vary across OEMs and drivers, and plenty of IR
// cameras aren't labeled distinctly at all. The reliable, vendor-agnostic signal is the
// actual pixel content: an IR sensor decoded as color video reports near-identical R/G/B
// values per pixel (colorfulness ~0), while a real color camera pointed at a person/room
// always shows meaningful RGB spread. So when a system has more than one camera, each
// candidate is briefly sampled and scored on that basis, and the best-scoring one wins —
// regardless of what any driver calls it.

export interface CameraAttemptDiagnostic {
  deviceId?: string;
  label: string;
  framesOk: boolean;
  colorfulness: number;
  error?: string;
}

export interface CameraDiagnostics {
  devicesFound: number;
  deviceLabels: string[];
  attempts: CameraAttemptDiagnostic[];
  chosenDeviceId?: string;
  chosenLabel?: string;
  framesVerified: boolean;
}

export interface VerifiedCameraResult {
  stream: MediaStream | null;
  deviceId?: string;
  framesVerified: boolean;
  diagnostics: CameraDiagnostics;
}

// Average per-pixel max(R,G,B) - min(R,G,B) across a sampled frame. A genuinely
// monochrome/IR feed sits at ~0-3 (channels are copies of one intensity value); a real
// color picture of a person/room is reliably well above this even under flat lighting.
const MIN_COLORFULNESS = 5;
const MAX_DEVICE_ATTEMPTS = 3;

async function listVideoInputDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

function sampleColorfulness(video: HTMLVideoElement): number {
  try {
    const canvas = document.createElement('canvas');
    const w = 64;
    const h = 48;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let sumSpread = 0;
    const pixelCount = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      sumSpread += Math.max(r, g, b) - Math.min(r, g, b);
    }
    return sumSpread / pixelCount;
  } catch {
    return 0;
  }
}

/**
 * Resolves once the stream's video track has actually decoded a frame, then measures how
 * colorful that frame is. A track can report readyState 'live' while sitting at 0x0
 * indefinitely — framesOk catches that. colorfulness is 0 whenever framesOk is false.
 */
function checkFrameAndColor(
  stream: MediaStream,
  timeoutMs: number,
): Promise<{ framesOk: boolean; colorfulness: number }> {
  return new Promise(resolve => {
    const track = stream.getVideoTracks()[0];
    if (!track) {
      resolve({ framesOk: false, colorfulness: 0 });
      return;
    }

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (framesOk: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', checkFrame);
      video.removeEventListener('playing', checkFrame);
      const colorfulness = framesOk ? sampleColorfulness(video) : 0;
      video.pause();
      video.srcObject = null;
      resolve({ framesOk, colorfulness });
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

/** Non-IR-labeled devices first as a cheap tiebreaker — the real accept/reject decision
 * happens on measured pixel content below, this just tries the more-likely-good device
 * first so the common case resolves in one attempt instead of two. */
async function preferredDeviceOrder(): Promise<string[]> {
  const devices = await listVideoInputDevices();
  const unwantedLabel = /\b(ir|infrared|hello|depth|face\s*auth)\b/i;
  return devices
    .filter(d => d.deviceId)
    .sort((a, b) => {
      const aBad = unwantedLabel.test(a.label || '') ? 1 : 0;
      const bBad = unwantedLabel.test(b.label || '') ? 1 : 0;
      return aBad - bBad;
    })
    .map(d => d.deviceId);
}

/**
 * Acquires a camera stream, verifying the result is both frame-producing AND a real
 * color picture (not an IR/monochrome sensor) before accepting it. On systems with more
 * than one camera, tries up to 3 distinct devices, scoring each by measured pixel
 * colorfulness, and keeps the best one seen even if none clears the color threshold — so
 * callers always get a result rather than nothing.
 */
export async function acquireVerifiedCameraStream(
  constraints: MediaTrackConstraints = {},
  frameTimeoutMs = 4000,
): Promise<VerifiedCameraResult> {
  const initialDevices = await listVideoInputDevices();
  const attempts: CameraAttemptDiagnostic[] = [];
  const diagnostics: CameraDiagnostics = {
    devicesFound: initialDevices.length,
    deviceLabels: initialDevices.map(d => d.label || '(no label — permission not yet granted)'),
    attempts,
    framesVerified: false,
  };

  let candidateDeviceIds = await preferredDeviceOrder();
  const tried = new Set<string>();
  let best: { stream: MediaStream; deviceId?: string; label: string; colorfulness: number } | null = null;

  for (let attempt = 0; attempt < MAX_DEVICE_ATTEMPTS; attempt++) {
    const nextDeviceId = candidateDeviceIds.find(id => !tried.has(id));
    if (candidateDeviceIds.length > 0 && !nextDeviceId) break; // every known device already tried

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: nextDeviceId ? { ...constraints, deviceId: { exact: nextDeviceId } } : constraints,
      });
    } catch (err) {
      console.error('Camera acquisition failed:', err);
      attempts.push({
        deviceId: nextDeviceId,
        label: '(getUserMedia threw)',
        framesOk: false,
        colorfulness: 0,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      break;
    }

    const track = stream.getVideoTracks()[0];
    const actualDeviceId = track?.getSettings().deviceId;
    tried.add(actualDeviceId || nextDeviceId || `attempt-${attempt}`);

    const { framesOk, colorfulness } = await checkFrameAndColor(stream, frameTimeoutMs);
    const label = track?.label || '(no label)';
    attempts.push({ deviceId: actualDeviceId, label, framesOk, colorfulness });

    if (framesOk && colorfulness >= MIN_COLORFULNESS) {
      best?.stream.getTracks().forEach(t => t.stop());
      diagnostics.chosenDeviceId = actualDeviceId;
      diagnostics.chosenLabel = label;
      diagnostics.framesVerified = true;
      return { stream, deviceId: actualDeviceId, framesVerified: true, diagnostics };
    }

    if (framesOk && (!best || colorfulness > best.colorfulness)) {
      best?.stream.getTracks().forEach(t => t.stop());
      best = { stream, deviceId: actualDeviceId, label, colorfulness };
    } else {
      stream.getTracks().forEach(t => t.stop());
    }

    // First attempt with no enumerable devices yet (fresh permission grant, labels were
    // empty beforehand) — now that access is granted, real devices are enumerable, so
    // refresh the candidate list for the next iteration instead of hitting the same
    // browser default again.
    if (candidateDeviceIds.length === 0) {
      candidateDeviceIds = await preferredDeviceOrder();
    }
  }

  if (best) {
    diagnostics.chosenDeviceId = best.deviceId;
    diagnostics.chosenLabel = best.label;
    return { stream: best.stream, deviceId: best.deviceId, framesVerified: false, diagnostics };
  }
  return { stream: null, framesVerified: false, diagnostics };
}

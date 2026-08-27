import type { CameraDiagnostics } from './cameraDeviceService';

export interface CachedDeviceStreams {
  cameraStream: MediaStream | null;
  microphoneStream: MediaStream | null;
  screenStream: MediaStream | null;
  cameraDiagnostics?: CameraDiagnostics | null;
}

let cachedStreams: CachedDeviceStreams = {
  cameraStream: null,
  microphoneStream: null,
  screenStream: null,
  cameraDiagnostics: null,
};

function isActiveStream(stream: MediaStream | null): boolean {
  if (!stream) return false;
  return stream.getTracks().some(track => track.readyState === 'live');
}

export function setCachedStreams(streams: Partial<CachedDeviceStreams>): void {
  cachedStreams = {
    ...cachedStreams,
    ...streams,
  };
}

export function getCachedStreams(): CachedDeviceStreams {
  return {
    cameraStream: isActiveStream(cachedStreams.cameraStream) ? cachedStreams.cameraStream : null,
    microphoneStream: isActiveStream(cachedStreams.microphoneStream) ? cachedStreams.microphoneStream : null,
    screenStream: isActiveStream(cachedStreams.screenStream) ? cachedStreams.screenStream : null,
    cameraDiagnostics: cachedStreams.cameraDiagnostics || null,
  };
}

// A mid-exam getUserMedia() call (e.g. AudioRecorder falling back to a fresh
// request when the cached mic track has died) can make some browsers/kiosk
// shells (SEB) surface a native permission dialog that steals window focus.
// That focus loss isn't the candidate switching away, so callers making such
// a call should suppress the window-blur violation for a short grace window.
let ignoreBlurUntil = 0;

export function suppressBlurViolation(ms = 5000): void {
  ignoreBlurUntil = Date.now() + ms;
}

export function isBlurViolationSuppressed(): boolean {
  return Date.now() < ignoreBlurUntil;
}

export function clearCachedStreams(stopTracks = true): void {
  if (stopTracks) {
    cachedStreams.cameraStream?.getTracks().forEach(track => track.stop());
    cachedStreams.microphoneStream?.getTracks().forEach(track => track.stop());
    cachedStreams.screenStream?.getTracks().forEach(track => track.stop());
  }

  cachedStreams = {
    cameraStream: null,
    microphoneStream: null,
    screenStream: null,
    cameraDiagnostics: null,
  };
}

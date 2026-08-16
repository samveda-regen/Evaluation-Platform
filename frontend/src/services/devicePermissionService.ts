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

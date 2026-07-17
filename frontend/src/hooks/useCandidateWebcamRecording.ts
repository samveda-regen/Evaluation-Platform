import { useCallback, useEffect, useRef } from 'react';
import { candidateApi } from '../services/api';

const CHUNK_MS = Number((import.meta as any).env?.VITE_DATA_COLLECTION_CHUNK_MS || 20000);

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Standalone webcam-only recording of the candidate, running independently
 * of the proctoring MediaRecorder(s) in useProctoring. It reuses the same
 * camera/mic MediaStream tracks (multiple MediaRecorders can read the same
 * tracks concurrently) so it never requests its own getUserMedia permission
 * and never touches proctoring's session/upload pipeline.
 *
 * Starts as soon as a camera stream is available (i.e. right after the
 * candidate starts the test) and must be stopped with stopAndFinalize()
 * right before test submission completes.
 */
export function useCandidateWebcamRecording(
  cameraStream: MediaStream | null | undefined,
  micStream: MediaStream | null | undefined
) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunkIndexRef = useRef(0);
  const startedRef = useRef(false);
  const finalizedRef = useRef(false);
  const pendingUploadsRef = useRef<Promise<void>[]>([]);

  useEffect(() => {
    if (!cameraStream || startedRef.current) return;

    const tracks: MediaStreamTrack[] = [
      ...cameraStream.getVideoTracks(),
      ...(micStream ? micStream.getAudioTracks() : []),
    ];
    if (tracks.length === 0) return;

    startedRef.current = true;

    try {
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';
      const recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType,
        videoBitsPerSecond: 400_000,
      });

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        const chunkIndex = chunkIndexRef.current++;
        const uploadPromise = blobToBase64(event.data)
          .then((chunkData) =>
            candidateApi.uploadDataCollectionChunk({ chunkIndex, chunkData })
          )
          .then(() => undefined)
          .catch(() => {
            // Best-effort - a missed chunk should never interrupt the exam.
          });
        pendingUploadsRef.current.push(uploadPromise);
      };

      recorder.start(CHUNK_MS);
      recorderRef.current = recorder;
    } catch (err) {
      console.error('Failed to start candidate data-collection recorder:', err);
    }
  }, [cameraStream, micStream]);

  const stopAndFinalize = useCallback(async () => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;

    const recorder = recorderRef.current;
    if (!recorder) return;

    if (recorder.state !== 'inactive') {
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.stop();
      await stopped;
    }

    await Promise.allSettled(pendingUploadsRef.current);

    try {
      await candidateApi.finalizeDataCollectionRecording();
    } catch {
      // Best-effort - do not block exam submission on this.
    }
  }, []);

  return { stopAndFinalize };
}

export default useCandidateWebcamRecording;

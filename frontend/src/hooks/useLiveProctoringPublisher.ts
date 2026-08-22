import { useEffect, useRef, useState } from 'react';
import { Room, Track } from 'livekit-client';
import { candidateApi } from '../services/api';

interface UseLiveProctoringPublisherOptions {
  enabled: boolean;
  attemptId: string;
  publishMicrophone?: boolean;
  cameraStream?: MediaStream | null;
  microphoneStream?: MediaStream | null;
  screenStream?: MediaStream | null;
}

export function useLiveProctoringPublisher({
  enabled,
  attemptId,
  publishMicrophone = false,
  cameraStream,
  microphoneStream,
  screenStream,
}: UseLiveProctoringPublisherOptions) {
  const roomRef = useRef<Room | null>(null);
  const publishedTrackIdsRef = useRef<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !attemptId || !cameraStream) return;

    let cancelled = false;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        simulcast: true,
        videoEncoding: {
          maxBitrate: 1_500_000,
          maxFramerate: 24,
        },
      },
    });
    roomRef.current = room;

    const publishMediaTrack = async (
      mediaTrack: MediaStreamTrack | undefined,
      source: Track.Source,
      name: string,
    ) => {
      if (!mediaTrack || mediaTrack.readyState !== 'live') return;
      if (publishedTrackIdsRef.current.has(mediaTrack.id)) return;
      if (source === Track.Source.Camera && mediaTrack.kind === 'video') {
        await mediaTrack.applyConstraints({
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 },
        }).catch(() => {});
      }
      await room.localParticipant.publishTrack(mediaTrack, {
        source,
        name,
        simulcast: mediaTrack.kind === 'video',
        videoEncoding: source === Track.Source.Camera
          ? { maxBitrate: 1_500_000, maxFramerate: 24 }
          : { maxBitrate: 1_200_000, maxFramerate: 15 },
      });
      publishedTrackIdsRef.current.add(mediaTrack.id);
    };

    const connectAndPublish = async () => {
      try {
        const { data } = await candidateApi.getLiveProctoringPublishToken(attemptId);
        if (cancelled) return;

        await room.connect(data.url, data.token, {
          autoSubscribe: false,
        });
        if (cancelled) return;

        await publishMediaTrack(cameraStream.getVideoTracks()[0], Track.Source.Camera, 'candidate-camera');
        let liveMicrophoneStream = microphoneStream || null;
        if (publishMicrophone && !liveMicrophoneStream) {
          liveMicrophoneStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        }
                await publishMediaTrack(liveMicrophoneStream?.getAudioTracks()[0], Track.Source.Microphone, 'candidate-microphone');
        await publishMediaTrack(screenStream?.getVideoTracks()[0], Track.Source.ScreenShare, 'candidate-screen');
        if (cancelled) return;

        // LiveKit creates rooms lazily on first participant connection. Egress
        // must therefore start after connect + camera publication, not while the
        // backend is still issuing the connection token. Guarded by `cancelled`
        // above: on fast exams the component can unmount (room.disconnect() in
        // the cleanup below) while this async chain is still in flight. Without
        // the guard, this call fires after the room is already gone client-side,
        // and the backend's startParticipantEgress request can lose the race and
        // land after LiveKit has torn the room down, failing with
        // "requested room does not exist".
        await candidateApi.startLiveProctoringRecording(attemptId);

        setConnected(true);
        setError(null);
      } catch (err) {
        console.error('Live proctoring publish failed:', err);
        setError('Live proctoring video connection failed');
        room.disconnect();
      }
    };

    void connectAndPublish();

    return () => {
      cancelled = true;
      setConnected(false);
      publishedTrackIdsRef.current.clear();
      room.disconnect();
      if (roomRef.current === room) roomRef.current = null;
    };
  }, [enabled, attemptId, publishMicrophone, cameraStream, microphoneStream, screenStream]);

  return {
    connected,
    error,
    disconnect: () => roomRef.current?.disconnect(),
  };
}

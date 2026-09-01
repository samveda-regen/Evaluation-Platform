import { useEffect, useRef, useState } from 'react';
import { RemoteParticipant, Room, RoomEvent, Track } from 'livekit-client';
import { candidateApi } from '../services/api';

export interface AdminLiveMessage {
  id: string;
  text: string;
  at: number;
}

interface UseLiveProctoringPublisherOptions {
  enabled: boolean;
  attemptId: string;
  publishMicrophone?: boolean;
  cameraStream?: MediaStream | null;
  microphoneStream?: MediaStream | null;
  screenStream?: MediaStream | null;
  onAdminMessage?: (message: AdminLiveMessage) => void;
}

export function useLiveProctoringPublisher({
  enabled,
  attemptId,
  publishMicrophone = false,
  cameraStream,
  microphoneStream,
  screenStream,
  onAdminMessage,
}: UseLiveProctoringPublisherOptions) {
  const roomRef = useRef<Room | null>(null);
  const publishedTrackIdsRef = useRef<Set<string>>(new Set());
  const onAdminMessageRef = useRef(onAdminMessage);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onAdminMessageRef.current = onAdminMessage;
  }, [onAdminMessage]);

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

    const handleAdminData = (payload: Uint8Array, participant?: RemoteParticipant) => {
      if (participant && !participant.identity?.startsWith('admin:')) return;
      try {
        const decoded = JSON.parse(new TextDecoder().decode(payload));
        if (decoded && decoded.type === 'admin-message' && typeof decoded.text === 'string') {
          onAdminMessageRef.current?.({
            id: typeof decoded.id === 'string' ? decoded.id : `${Date.now()}`,
            text: decoded.text,
            at: typeof decoded.at === 'number' ? decoded.at : Date.now(),
          });
        }
      } catch {
        // Ignore malformed proctor data packets.
      }
    };
    room.on(RoomEvent.DataReceived, handleAdminData);

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
      room.off(RoomEvent.DataReceived, handleAdminData);
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

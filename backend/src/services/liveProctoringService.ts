import { AccessToken } from 'livekit-server-sdk';
import { TrackSource } from '@livekit/protocol';

export type LiveProctoringRole = 'candidate' | 'admin';

export interface LiveProctoringTokenInput {
  role: LiveProctoringRole;
  roomName: string;
  identity: string;
  displayName: string;
  metadata?: Record<string, unknown>;
}

export function getLiveKitUrl(): string {
  return (process.env.LIVEKIT_URL || '').trim();
}

export function isLiveKitConfigured(): boolean {
  return Boolean(getLiveKitUrl() && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}

export function buildLiveRoomName(testId: string, attemptId: string): string {
  return `proctoring:${testId}:${attemptId}`;
}

export async function createLiveProctoringToken(input: LiveProctoringTokenInput): Promise<string> {
  if (!isLiveKitConfigured()) {
    throw new Error('LiveKit is not configured');
  }

  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: input.identity,
    name: input.displayName,
    ttl: input.role === 'candidate' ? '6h' : '2h',
    metadata: JSON.stringify({
      role: input.role,
      ...input.metadata,
    }),
  });

  token.addGrant({
    roomJoin: true,
    room: input.roomName,
    canPublish: input.role === 'candidate',
    canSubscribe: input.role === 'admin',
    canPublishData: true,
    canUpdateOwnMetadata: true,
    canPublishSources:
      input.role === 'candidate'
        ? [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
        : [],
  });

  return token.toJwt();
}

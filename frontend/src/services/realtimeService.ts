import { io, Socket } from 'socket.io-client';

const viteEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env || {};

const isLocalBrowser =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const socketUrlFromEnv =
  typeof viteEnv.VITE_SOCKET_URL === 'string' ? viteEnv.VITE_SOCKET_URL : '';
const isDevMode = Boolean(viteEnv.DEV);

const resolvedSocketUrl =
  socketUrlFromEnv || (isDevMode && isLocalBrowser ? 'http://localhost:3000' : '/');

export interface CandidateProctorStatusPayload {
  attemptId: string;
  testId: string;
  sessionId?: string;
  status: {
    online?: boolean;
    cameraEnabled?: boolean;
    microphoneEnabled?: boolean;
    screenShareEnabled?: boolean;
    faceDetected?: boolean;
    lookingAtScreen?: boolean;
    monitorCount?: number;
    externalMonitorDetected?: boolean;
  };
  timestamp: string;
}

export interface ViolationDetectedPayload {
  attemptId: string;
  testId: string;
  sessionId?: string;
  violation: {
    type: string;
    severity: string;
    confidence?: number;
    description: string;
    timestamp: string;
  };
}

let socket: Socket | null = null;

export function getRealtimeSocket(): Socket {
  if (socket) return socket;
  socket = io(resolvedSocketUrl, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    withCredentials: true,
  });
  return socket;
}

export function disconnectRealtimeSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

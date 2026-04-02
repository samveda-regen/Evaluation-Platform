import { io, Socket } from 'socket.io-client';

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
  socket = io('/', {
    path: '/socket.io',
    transports: ['websocket'],
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

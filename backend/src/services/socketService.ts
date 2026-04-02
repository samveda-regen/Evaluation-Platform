import { Server as SocketServer } from 'socket.io';

let ioInstance: SocketServer | null = null;

export function setSocketServer(io: SocketServer): void {
  ioInstance = io;
}

export function getSocketServer(): SocketServer | null {
  return ioInstance;
}

export function emitToTestProctorRoom(testId: string, event: string, payload: unknown): void {
  if (!ioInstance) return;
  ioInstance.to(`proctor-${testId}`).emit(event, payload);
}

export function emitToAttemptProctorRoom(attemptId: string, event: string, payload: unknown): void {
  if (!ioInstance) return;
  ioInstance.to(`proctor-attempt-${attemptId}`).emit(event, payload);
}

export function emitToProctorTargets(
  testId: string,
  attemptId: string,
  event: string,
  payload: unknown
): void {
  emitToTestProctorRoom(testId, event, payload);
  emitToAttemptProctorRoom(attemptId, event, payload);
}

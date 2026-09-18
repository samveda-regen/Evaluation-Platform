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

export function emitToAdminRoom(adminId: string, event: string, payload: unknown): void {
  if (!ioInstance) return;
  ioInstance.to(`admin-${adminId}`).emit(event, payload);
}

// Superadmin Observer room — every joined socket has already presented a
// verified superadmin JWT (see the `superadmin-join` handler in index.ts).
export const SUPERADMIN_ROOM = 'superadmin-observer';

export function emitToSuperAdminRoom(event: string, payload: unknown): void {
  if (!ioInstance) return;
  ioInstance.to(SUPERADMIN_ROOM).emit(event, payload);
}

// Lets the telemetry/resources tick loops skip their work (DB queries, a
// `pm2 jlist` subprocess spawn) when no superadmin tab is actually open to
// receive it, rather than paying that cost forever at a 2s cadence.
export function isSuperAdminRoomActive(): boolean {
  if (!ioInstance) return false;
  return (ioInstance.sockets.adapter.rooms.get(SUPERADMIN_ROOM)?.size ?? 0) > 0;
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

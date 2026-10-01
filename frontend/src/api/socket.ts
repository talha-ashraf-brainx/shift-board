import type { SocketPayloads } from '@agent-board/shared';
import { io, type Socket } from 'socket.io-client';

type ServerToClient = { [K in keyof SocketPayloads]: (payload: SocketPayloads[K]) => void };

export type BoardSocket = Socket<ServerToClient, Record<string, never>>;

/** Connects to the same origin; Vite proxies /socket.io to the backend in dev. */
export function createBoardSocket(): BoardSocket {
  return io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });
}

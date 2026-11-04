import { io, Socket } from 'socket.io-client';

let socketInstance: Socket | null = null;

export interface SocketAuthCredentials {
  room_code: string;
  participant_id: string;
  session_token: string;
}

export function getSocket(credentials?: SocketAuthCredentials): Socket {
  if (!socketInstance) {
    socketInstance = io(window.location.origin, {
      path: '/socket.io',
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'],
      auth: credentials,
    });
  } else if (credentials) {
    socketInstance.auth = credentials;
  }
  return socketInstance;
}

export function closeSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

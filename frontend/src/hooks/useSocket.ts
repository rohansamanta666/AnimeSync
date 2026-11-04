import { useEffect, useState, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket, closeSocket, SocketAuthCredentials } from '../services/socket';
import { Room, RoomAuth, ParticipantPresence, SocketConnectionStatus } from '../types';

interface UseSocketResult {
  socket: Socket | null;
  connectionStatus: SocketConnectionStatus;
  presence: ParticipantPresence[];
  roomSnapshot: Room | null;
  error: string | null;
  reconnect: () => void;
}

export function useSocket(auth: RoomAuth | null): UseSocketResult {
  const [connectionStatus, setConnectionStatus] = useState<SocketConnectionStatus>('disconnected');
  const [presence, setPresence] = useState<ParticipantPresence[]>([]);
  const [roomSnapshot, setRoomSnapshot] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);

  const connectToRoom = useCallback(() => {
    if (!auth) return;

    const credentials: SocketAuthCredentials = {
      room_code: auth.room.code.toUpperCase(),
      participant_id: auth.participant_id,
      session_token: auth.session_token,
    };

    setConnectionStatus('connecting');
    setError(null);

    const socket = getSocket(credentials);
    socketRef.current = socket;

    // Remove previous listeners to prevent duplicates
    socket.off('connect');
    socket.off('disconnect');
    socket.off('connect_error');
    socket.off('room_joined');
    socket.off('presence_updated');
    socket.off('error');

    socket.on('connect', () => {
      setConnectionStatus('connected');
      setError(null);
      // Emit explicit authenticated join_room event
      socket.emit('join_room', credentials);
    });

    socket.on('disconnect', (reason) => {
      setConnectionStatus('disconnected');
      if (reason === 'io server disconnect') {
        // the disconnection was initiated by the server, reconnect manually
        socket.connect();
      }
    });

    socket.on('connect_error', (err) => {
      setConnectionStatus('error');
      setError(`Connection error: ${err.message}`);
    });

    socket.on('room_joined', (data: { room: Room; presence: ParticipantPresence[] }) => {
      if (data.room) {
        setRoomSnapshot(data.room);
      }
      if (data.presence) {
        setPresence(data.presence);
      }
    });

    socket.on('presence_updated', (data: { room_code: string; participants: ParticipantPresence[] }) => {
      if (data.participants) {
        setPresence(data.participants);
        // Also update room snapshot participants
        setRoomSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            participants: data.participants.map((p) => ({
              id: p.id,
              username: p.username,
              is_host: p.is_host,
              status: p.status,
              last_seen: p.last_seen || '',
              is_online: p.is_online,
              active_connections: p.active_connections,
            })),
          };
        });
      }
    });

    socket.on('error', (errData: { code: string; message: string }) => {
      setError(errData.message || 'An error occurred on the socket connection');
      if (errData.code === 'AUTH_FAILED') {
        setConnectionStatus('error');
      }
    });

    if (!socket.connected) {
      socket.connect();
    } else {
      // Socket was already open; re-emit join_room
      socket.emit('join_room', credentials);
      setConnectionStatus('connected');
    }
  }, [auth]);

  useEffect(() => {
    if (auth) {
      connectToRoom();
    }

    return () => {
      if (socketRef.current) {
        if (auth) {
          socketRef.current.emit('leave_room', {
            room_code: auth.room.code.toUpperCase(),
          });
        }
        closeSocket();
        socketRef.current = null;
      }
    };
  }, [auth, connectToRoom]);

  const reconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.connect();
    } else {
      connectToRoom();
    }
  }, [connectToRoom]);

  return {
    socket: socketRef.current,
    connectionStatus,
    presence,
    roomSnapshot,
    error,
    reconnect,
  };
}

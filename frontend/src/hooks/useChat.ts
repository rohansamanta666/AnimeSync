/**
 * useChat — Phase 7 Task 7.1
 *
 * Real-time text chat hook managing message persistence, socket events,
 * and input sanitization.
 */
import { useState, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { ChatMessage, RoomAuth } from '../types';
import { api } from '../services/api';
import { sanitizeChatMessage } from '../services/webrtc';

export interface UseChatProps {
  socket: Socket | null;
  auth: RoomAuth | null;
  roomCode?: string;
}

export function useChat({ socket, auth, roomCode }: UseChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial message history
  useEffect(() => {
    if (!auth || !roomCode) return;

    let isMounted = true;
    setIsLoading(true);

    api
      .getMessages(roomCode, {
        participantId: auth.participant_id,
        sessionToken: auth.session_token,
      })
      .then((res) => {
        if (isMounted) {
          setMessages(res.messages);
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch chat history via REST:', err);
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [auth, roomCode]);

  // Listen for real-time new_message events over Socket.IO
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (data: { message: ChatMessage }) => {
      if (!data || !data.message) return;
      setMessages((prev) => {
        // Prevent duplicate messages if already present
        if (prev.some((m) => m.id === data.message.id)) {
          return prev;
        }
        return [...prev, data.message];
      });
    };

    socket.on('new_message', handleNewMessage);

    return () => {
      socket.off('new_message', handleNewMessage);
    };
  }, [socket]);

  // Send message method
  const sendMessage = useCallback(
    async (content: string) => {
      const sanitized = sanitizeChatMessage(content);
      if (!sanitized) {
        throw new Error('Message cannot be empty');
      }
      if (sanitized.length > 1000) {
        throw new Error('Message cannot exceed 1000 characters');
      }

      setError(null);

      // Prefer Socket.IO for real-time speed, fallback to REST
      if (socket && socket.connected) {
        return new Promise<void>((resolve, reject) => {
          socket.emit(
            'send_message',
            { content: sanitized },
            (response: { status: string; message?: any }) => {
              if (response && response.status === 'OK') {
                resolve();
              } else {
                const msg = response?.message || 'Failed to send message';
                setError(msg);
                reject(new Error(msg));
              }
            }
          );
        });
      } else if (auth && roomCode) {
        try {
          const sent = await api.sendMessage(roomCode, sanitized, {
            participantId: auth.participant_id,
            sessionToken: auth.session_token,
          });
          setMessages((prev) => {
            if (prev.some((m) => m.id === sent.id)) return prev;
            return [...prev, sent];
          });
        } catch (err: any) {
          setError(err.message || 'Failed to send message');
          throw err;
        }
      }
    },
    [socket, auth, roomCode]
  );

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearError: () => setError(null),
  };
}

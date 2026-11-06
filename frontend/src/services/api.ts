import {
  HealthInfo,
  Room,
  RoomAuth,
  Episode,
  QueueResponse,
  ChatMessage,
  MessageListResponse,
  MediaStorageResponse,
  MediaDeleteResponse,
  MediaPurgeResponse,
} from '../types';

const API_BASE = '/api';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    let errorMsg = 'An unexpected error occurred';
    try {
      const data = await response.json();
      errorMsg = data.detail || data.message || errorMsg;
    } catch {
      errorMsg = await response.text() || errorMsg;
    }
    throw new ApiError(response.status, errorMsg);
  }

  return response.json();
}

export interface ChunkUploadProgress {
  percentage: number;
  currentChunk: number;
  totalChunks: number;
  uploadedBytes: number;
  totalBytes: number;
}

export const api = {
  async getHealth(): Promise<HealthInfo> {
    return request<HealthInfo>('/health');
  },

  async createRoom(name: string, hostUsername: string): Promise<RoomAuth> {
    return request<RoomAuth>('/rooms', {
      method: 'POST',
      body: JSON.stringify({ name, host_username: hostUsername }),
    });
  },

  async getRoom(code: string): Promise<Room> {
    return request<Room>(`/rooms/${code.toUpperCase()}`);
  },

  async joinRoom(code: string, username: string): Promise<RoomAuth> {
    return request<RoomAuth>(`/rooms/${code.toUpperCase()}/join`, {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
  },

  async getQueue(code: string): Promise<QueueResponse> {
    return request<QueueResponse>(`/rooms/${code.toUpperCase()}/queue`);
  },

  async reorderQueue(
    code: string,
    orderedEpisodeIds: string[],
    auth: { participantId: string; sessionToken: string }
  ): Promise<QueueResponse> {
    return request<QueueResponse>(`/rooms/${code.toUpperCase()}/queue/reorder`, {
      method: 'PUT',
      headers: {
        'X-Participant-ID': auth.participantId,
        'X-Session-Token': auth.sessionToken,
      },
      body: JSON.stringify({ ordered_episode_ids: orderedEpisodeIds }),
    });
  },

  async removeFromQueue(
    code: string,
    episodeId: string,
    auth: { participantId: string; sessionToken: string }
  ): Promise<QueueResponse> {
    return request<QueueResponse>(`/rooms/${code.toUpperCase()}/queue/${episodeId}`, {
      method: 'DELETE',
      headers: {
        'X-Participant-ID': auth.participantId,
        'X-Session-Token': auth.sessionToken,
      },
    });
  },

  async selectEpisode(
    code: string,
    episodeId: string,
    auth: { participantId: string; sessionToken: string }
  ): Promise<QueueResponse> {
    return request<QueueResponse>(`/rooms/${code.toUpperCase()}/queue/select`, {
      method: 'POST',
      headers: {
        'X-Participant-ID': auth.participantId,
        'X-Session-Token': auth.sessionToken,
      },
      body: JSON.stringify({ episode_id: episodeId }),
    });
  },

  async getMessages(
    code: string,
    auth: { participantId: string; sessionToken: string },
    limit: number = 100
  ): Promise<MessageListResponse> {
    return request<MessageListResponse>(`/rooms/${code.toUpperCase()}/messages?limit=${limit}`, {
      headers: {
        'X-Participant-ID': auth.participantId,
        'X-Session-Token': auth.sessionToken,
      },
    });
  },

  async sendMessage(
    code: string,
    content: string,
    auth: { participantId: string; sessionToken: string }
  ): Promise<ChatMessage> {
    return request<ChatMessage>(`/rooms/${code.toUpperCase()}/messages`, {
      method: 'POST',
      headers: {
        'X-Participant-ID': auth.participantId,
        'X-Session-Token': auth.sessionToken,
      },
      body: JSON.stringify({ content }),
    });
  },

  getDownloadUrl(episodeId: string, participantId: string, sessionToken: string): string {
    const params = new URLSearchParams({
      participant_id: participantId,
      token: sessionToken,
    });
    return `${API_BASE}/files/download/${episodeId}?${params.toString()}`;
  },

  async uploadEpisodeChunked(
    file: File,
    metadata: {
      roomId: string;
      animeTitle: string;
      season: number;
      episodeNumber: number;
      displayTitle?: string;
    },
    auth: { participantId: string; sessionToken: string },
    onProgress?: (progress: ChunkUploadProgress) => void,
    signal?: AbortSignal
  ): Promise<Episode> {
    const authHeaders = {
      'X-Participant-ID': auth.participantId,
      'X-Session-Token': auth.sessionToken,
    };

    // 1. Initialize upload session
    const initRes = await request<{ upload_id: string; chunk_size_bytes: number; total_chunks: number }>(
      '/files/upload/init',
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          room_id: metadata.roomId,
          filename: file.name,
          file_size_bytes: file.size,
          anime_title: metadata.animeTitle,
          season: metadata.season,
          episode_number: metadata.episodeNumber,
          display_title: metadata.displayTitle || null,
          mime_type: file.type || 'video/mp4',
        }),
        signal,
      }
    );

    const { upload_id, chunk_size_bytes, total_chunks } = initRes;
    let uploadedBytes = 0;

    // 2. Upload chunks sequentially (5MB chunks)
    for (let chunkIndex = 0; chunkIndex < total_chunks; chunkIndex++) {
      if (signal?.aborted) {
        throw new Error('Upload aborted by user');
      }

      const start = chunkIndex * chunk_size_bytes;
      const end = Math.min(start + chunk_size_bytes, file.size);
      const chunkBlob = file.slice(start, end);

      const formData = new FormData();
      formData.append('upload_id', upload_id);
      formData.append('chunk_index', chunkIndex.toString());
      formData.append('chunk_file', chunkBlob, `${chunkIndex}.chunk`);

      const chunkRes = await fetch(`${API_BASE}/files/upload/chunk`, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
        signal,
      });

      if (!chunkRes.ok) {
        const errorText = await chunkRes.text();
        throw new Error(`Failed to upload chunk ${chunkIndex}: ${errorText}`);
      }

      uploadedBytes += (end - start);
      if (onProgress) {
        onProgress({
          percentage: Math.min(100, Math.round((uploadedBytes / file.size) * 100)),
          currentChunk: chunkIndex + 1,
          totalChunks: total_chunks,
          uploadedBytes,
          totalBytes: file.size,
        });
      }
    }

    // 3. Finalize upload & calculate authoritative SHA-256
    const finalizedEpisode = await request<Episode>('/files/upload/complete', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ upload_id }),
      signal,
    });

    return finalizedEpisode;
  },

  async deleteEpisode(episodeId: string, auth: { participantId: string; sessionToken: string }): Promise<{ success: boolean; freed_bytes: number }> {
    return request<{ success: boolean; freed_bytes: number }>(`/files/${episodeId}`, {
      method: 'DELETE',
      headers: {
        'X-Participant-ID': auth.participantId,
        'X-Session-Token': auth.sessionToken,
      },
    });
  },

  // Phase 8 Task 8.6: Media Management Dashboard API methods
  async getMediaDashboard(
    roomCode: string,
    auth: { participantId?: string; participant_id?: string; sessionToken?: string; session_token?: string }
  ): Promise<MediaStorageResponse> {
    const pid = auth.participant_id || auth.participantId || '';
    const token = auth.session_token || auth.sessionToken || '';
    return request<MediaStorageResponse>(`/rooms/${roomCode.toUpperCase()}/media`, {
      headers: {
        'X-Participant-ID': pid,
        'X-Session-Token': token,
      },
    });
  },

  async deleteMediaFile(
    roomCode: string,
    episodeId: string,
    auth: { participantId?: string; participant_id?: string; sessionToken?: string; session_token?: string }
  ): Promise<MediaDeleteResponse> {
    const pid = auth.participant_id || auth.participantId || '';
    const token = auth.session_token || auth.sessionToken || '';
    return request<MediaDeleteResponse>(`/rooms/${roomCode.toUpperCase()}/media/${episodeId}`, {
      method: 'DELETE',
      headers: {
        'X-Participant-ID': pid,
        'X-Session-Token': token,
      },
    });
  },

  async purgeTempMedia(
    roomCode: string,
    auth: { participantId?: string; participant_id?: string; sessionToken?: string; session_token?: string }
  ): Promise<MediaPurgeResponse> {
    const pid = auth.participant_id || auth.participantId || '';
    const token = auth.session_token || auth.sessionToken || '';
    return request<MediaPurgeResponse>(`/rooms/${roomCode.toUpperCase()}/media/purge`, {
      method: 'POST',
      headers: {
        'X-Participant-ID': pid,
        'X-Session-Token': token,
      },
    });
  },
};

// Local storage session helpers
const SESSION_KEY_PREFIX = 'animesync_session_';

export const sessionStore = {
  save(roomCode: string, auth: RoomAuth): void {
    localStorage.setItem(`${SESSION_KEY_PREFIX}${roomCode.toUpperCase()}`, JSON.stringify(auth));
  },

  get(roomCode: string): RoomAuth | null {
    const raw = localStorage.getItem(`${SESSION_KEY_PREFIX}${roomCode.toUpperCase()}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  remove(roomCode: string): void {
    localStorage.removeItem(`${SESSION_KEY_PREFIX}${roomCode.toUpperCase()}`);
  },
};


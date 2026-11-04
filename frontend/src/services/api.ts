import { HealthInfo, Room, RoomAuth, Episode } from '../types';

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


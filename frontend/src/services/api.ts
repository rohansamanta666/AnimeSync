import { HealthInfo, Room, RoomAuth } from '../types';

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

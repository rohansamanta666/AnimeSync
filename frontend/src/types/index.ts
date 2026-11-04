export type ParticipantStatus =
  | 'WAITING_FOR_FILE'
  | 'DOWNLOADING'
  | 'DOWNLOADED'
  | 'VERIFYING'
  | 'VERIFICATION_FAILED'
  | 'VERIFIED'
  | 'READY'
  | 'WATCHING'
  | 'BUFFERING'
  | 'DISCONNECTED';

export type UploadStatus = 'PENDING' | 'UPLOADING' | 'COMPLETED' | 'FAILED';

export interface Participant {
  id: string;
  username: string;
  is_host: boolean;
  status: ParticipantStatus;
  last_seen: string;
}

export interface Episode {
  id: string;
  anime_title: string;
  season: number;
  episode_number: number;
  display_title?: string | null;
  filename: string;
  file_size_bytes: number;
  sha256_hash?: string | null;
  duration_seconds?: number | null;
  upload_status: UploadStatus;
  queue_position: number;
}

export interface Room {
  id: string;
  code: string;
  name: string;
  host_id?: string | null;
  is_active: boolean;
  current_episode_id?: string | null;
  created_at: string;
  participants: Participant[];
  episodes: Episode[];
}

export interface RoomAuth {
  room: Room;
  participant_id: string;
  session_token: string;
  is_host: boolean;
}

export interface PlaybackState {
  is_playing: boolean;
  current_time: number;
  playback_rate: number;
  updated_at: number;
  sequence_number: number;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  participant_id: string;
  username: string;
  content: string;
  created_at: string;
}

export interface StorageInfo {
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  free_gb: number;
}

export interface HealthInfo {
  status: string;
  version: string;
  environment: string;
  storage: StorageInfo;
}

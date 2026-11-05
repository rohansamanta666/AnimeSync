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
  is_online?: boolean;
  active_connections?: number;
}

export interface ParticipantPresence {
  id: string;
  username: string;
  is_host: boolean;
  is_online: boolean;
  status: ParticipantStatus;
  active_connections: number;
  last_seen?: string | null;
}

export type SocketConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

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

export type PlaybackActionType = 'PLAY' | 'PAUSE' | 'SEEK' | 'RATE_CHANGE';

export interface PlaybackSyncPayload {
  room_code: string;
  action: PlaybackActionType;
  timestamp: number;
  current_time: number;
  is_playing: boolean;
  playback_rate: number;
  playback_speed: number;
  server_sequence: number;
  sequence_number: number;
  server_time: number;
  updated_at: number;
  originating_socket_id: string;
  origin_sid?: string;
  triggered_by?: string;
  reason?: string;
}

export interface BufferingUpdatePayload {
  room_code: string;
  is_buffering: boolean;
  buffering_participants: string[];
  buffering_participant_ids?: string[];
  paused_for_buffering?: boolean;
  current_time?: number;
  triggered_by?: string;
}

export interface QueueResponse {
  room_code: string;
  current_episode_id: string | null;
  episodes: Episode[];
}

export interface IntermissionData {
  room_code: string;
  current_episode_id: string;
  next_episode: Episode;
  seconds_remaining: number;
  target_advance_time: number;
}

export interface QueueAdvancedData {
  room_code: string;
  current_episode_id: string;
  episode: Episode;
  reason?: string;
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

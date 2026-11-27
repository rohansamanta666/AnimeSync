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
  presence_state?: 'active' | 'away' | 'disconnected';
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
  source_type?: 'local' | 'online';
  stream_url?: string | null;
  subtitle_url?: string | null;
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

export interface MessageListResponse {
  room_code: string;
  messages: ChatMessage[];
}

export type VoiceMode = 'activity' | 'ptt';

export interface VoicePeer {
  participant_id: string;
  username: string;
  socket_id: string;
  is_muted: boolean;
}

export interface VoiceOfferPayload {
  sender_socket_id: string;
  sender_participant_id: string;
  sender_username: string;
  sdp: RTCSessionDescriptionInit;
}

export interface VoiceAnswerPayload {
  sender_socket_id: string;
  sender_participant_id: string;
  sdp: RTCSessionDescriptionInit;
}

export interface VoiceIceCandidatePayload {
  sender_socket_id: string;
  candidate: RTCIceCandidateInit;
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

// Phase 8 Task 8.6: Media Management Types
export interface StorageUsage {
  total_disk_bytes: number;
  free_disk_bytes: number;
  animesync_used_bytes: number;
  video_storage_bytes: number;
  temp_storage_bytes: number;
}

export interface MediaEpisode {
  id: string;
  anime_title: string;
  season: number;
  episode_number: number;
  display_title?: string | null;
  filename: string;
  file_size_bytes: number;
  sha256_hash?: string | null;
  duration_seconds?: number | null;
  upload_status: string;
  queue_position: number;
  created_at?: string | null;
  is_active: boolean;
  file_exists_on_disk: boolean;
}

export interface MediaStorageResponse {
  room_code: string;
  storage: StorageUsage;
  episodes: MediaEpisode[];
}

export interface MediaDeleteResponse {
  success: boolean;
  message: string;
  freed_bytes: number;
  remaining_episodes_count: number;
}

export interface MediaPurgeResponse {
  success: boolean;
  message: string;
  freed_bytes: number;
  purged_count: number;
}

export interface BrowseEpisodeItem {
  episode_number: number;
  episode_id?: string | null;
  title: string;
  alternative_title?: string | null;
  is_filler?: boolean;
  sub?: boolean;
  dub?: boolean;
  embed_id?: string | null;
  ani_id?: string | null;
  mal_id?: string | null;
  fx_sub?: string | null;
  fx_dub?: string | null;
  stream_url?: string | null;
  subtitle_url?: string | null;
  format?: 'hls' | 'mp4' | 'webm' | 'embed' | 'unknown' | null;
  downloadable?: boolean;
  audio_track?: 'sub' | 'dub' | string;
}

export interface BrowseAnimeSeason {
  title?: string | null;
  id?: string | null;
  alternativeTitle?: string | null;
  poster?: string | null;
  isActive?: boolean;
}

export interface BrowseAnimeItem {
  id: string;
  anilist_id?: number;
  source?: string;
  provider?: string;
  title: string;
  romaji_title?: string | null;
  native_title?: string | null;
  description: string;
  cover_image?: string | null;
  banner_image?: string | null;
  genres: string[];
  status: string;
  type?: string | null;
  age_rating?: string | null;
  duration?: string | null;
  premiered?: string | null;
  release_year?: number | null;
  rating?: number | null;
  episodes_count: number;
  sub_count?: number | null;
  dub_count?: number | null;
  duration_minutes?: number | null;
  studios?: string[];
  supports_sub_dub_selection?: boolean;
  episodes?: BrowseEpisodeItem[];
  more_seasons?: BrowseAnimeSeason[];
  related?: BrowseAnimeItem[];
  recommended?: BrowseAnimeItem[];
}

export interface BrowsePageResponse {
  category?: string;
  query?: string;
  source?: string;
  page: number;
  per_page: number;
  total: number;
  last_page: number;
  has_next_page: boolean;
  results: BrowseAnimeItem[];
  metadata_available: boolean;
  error?: string;
}

export interface ProviderHealthResponse {
  available: boolean;
  url: string;
  status?: string;
  environment?: string;
  error?: string;
}

export interface ProviderSuggestionItem {
  title: string | null;
  alternativeTitle: string | null;
  poster: string | null;
  id: string | null;
  aired: string | null;
  type: string | null;
  duration: string | null;
}

export interface ProviderServerEntry {
  serverName: string | null;
  serverId: string | null;
  iframe: string;
}

export interface ProviderSubtitleTrack {
  label: string;
  format: string;
  default: boolean;
  url: string;
  proxy_url: string;
}

export interface ProviderDirectStream {
  serverName: string | null;
  serverId: string | null;
  stream_url: string;
  raw_stream_url?: string | null;
  format: string;
  subtitle_url?: string | null;
  tracks?: ProviderSubtitleTrack[];
  iframe_url?: string | null;
}

export interface ProviderServersResponse {
  episodeId: string;
  type: 'sub' | 'dub';
  servers: ProviderServerEntry[];
  direct?: ProviderDirectStream | null;
}

export interface ProviderResolveResponse {
  mode: 'stream' | 'iframe';
  format: string;
  iframe_url: string;
  stream_url?: string | null;
  proxy_stream_url?: string | null;
  subtitle_url?: string | null;
  subtitles: string[];
  tracks?: ProviderSubtitleTrack[];
}

export interface ValidatedSourceResponse {
  valid: boolean;
  provider: string;
  stream_url: string;
  subtitle_url?: string | null;
  format: 'hls' | 'mp4' | 'webm' | 'unknown';
  downloadable: boolean;
  audio_track: 'sub' | 'dub';
}

export type DownloadTaskStatus =
  | 'PENDING'
  | 'DOWNLOADING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface DownloadTaskItem {
  id: string;
  anime_title: string;
  episode_number: number;
  source_url: string;
  filename: string;
  total_bytes: number;
  downloaded_bytes: number;
  progress_percent: number;
  sha256_hash?: string | null;
  supports_range: boolean;
  status: DownloadTaskStatus;
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DownloadListResponse {
  downloads: DownloadTaskItem[];
  storage: {
    download_dir_bytes: number;
    disk_free_bytes: number;
    disk_total_bytes: number;
  };
}

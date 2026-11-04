import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Copy,
  Check,
  Users,
  Film,
  ArrowLeft,
  Share2,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  Plus,
  Upload,
} from 'lucide-react';
import { api, sessionStore } from '../services/api';
import { Room, RoomAuth, ParticipantPresence, Episode } from '../types';
import { useSocket } from '../hooks/useSocket';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { JoinRoomModal } from '../components/room/JoinRoomModal';
import { EpisodeUploadModal } from '../components/file/EpisodeUploadModal';
import { EpisodeVerificationCard } from '../components/file/EpisodeVerificationCard';

export const RoomPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [initialRoom, setInitialRoom] = useState<Room | null>(null);
  const [auth, setAuth] = useState<RoomAuth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Load saved session on mount
  useEffect(() => {
    if (!code) {
      navigate('/');
      return;
    }

    const cleanCode = code.toUpperCase();
    const storedAuth = sessionStore.get(cleanCode);
    if (storedAuth) {
      setAuth(storedAuth);
    }

    // Fetch initial room data from REST
    api.getRoom(cleanCode)
      .then((data: Room) => {
        setInitialRoom(data);
        if (!storedAuth) {
          setShowJoinModal(true);
        }
      })
      .catch((err: any) => {
        setError(err.message || 'Room not found or no longer active');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [code, navigate]);

  // Connect via real-time WebSocket hook
  const {
    socket,
    connectionStatus,
    presence,
    roomSnapshot,
    error: socketError,
    reconnect,
  } = useSocket(auth);

  // Authoritative current room data (prefer real-time snapshot when available)
  const room = roomSnapshot || initialRoom;

  // Listen for socket events: episode added and verification result
  useEffect(() => {
    if (!socket) return;

    const handleEpisodeAdded = (data: { episode: Episode }) => {
      setInitialRoom((prev) => {
        if (!prev) return prev;
        const exists = prev.episodes.some((e) => e.id === data.episode.id);
        const updatedList = exists
          ? prev.episodes.map((e) => (e.id === data.episode.id ? data.episode : e))
          : [data.episode, ...prev.episodes];
        return {
          ...prev,
          current_episode_id: prev.current_episode_id || data.episode.id,
          episodes: updatedList,
        };
      });
    };

    socket.on('episode_added', handleEpisodeAdded);

    return () => {
      socket.off('episode_added', handleEpisodeAdded);
    };
  }, [socket]);

  // Handle invitation link copying
  const handleCopyLink = () => {
    const inviteUrl = window.location.href;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleCopyCode = () => {
    if (room) {
      navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-full border-2 border-violet-500 border-t-transparent animate-spin mb-4" />
        <p className="text-sm font-mono text-ink-muted">Connecting to AnimeSync Room...</p>
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="max-w-md mx-auto my-20 p-6 glass-panel rounded-2xl text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-rose-950 border border-rose-800 flex items-center justify-center mx-auto text-rose-400">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-white">Room Unavailable</h2>
        <p className="text-sm text-ink-muted">{error || 'This room does not exist or has closed.'}</p>
        <Button variant="primary" onClick={() => navigate('/')} leftIcon={<ArrowLeft className="w-4 h-4" />}>
          Back to Home
        </Button>
      </div>
    );
  }

  // Participants list: prefer real-time presence, fallback to initial REST list
  const activeParticipants: ParticipantPresence[] = presence.length > 0
    ? presence
    : room.participants.map((p) => ({
        id: p.id,
        username: p.username,
        is_host: p.is_host,
        is_online: false,
        status: p.status,
        active_connections: 0,
        last_seen: p.last_seen,
      }));

  const currentParticipant = auth
    ? activeParticipants.find((p) => p.id === auth.participant_id)
    : null;

  // Active current episode (if any)
  const currentEpisode = room.episodes.find((e) => e.id === room.current_episode_id) || room.episodes[0] || null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Real-time Socket Error Notice */}
      {socketError && (
        <div className="flex items-center justify-between p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{socketError}</span>
          </div>
          <Button variant="outline" size="sm" onClick={reconnect} leftIcon={<RefreshCw className="w-3.5 h-3.5" />}>
            Retry
          </Button>
        </div>
      )}

      {/* Top Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-5 rounded-2xl border border-void-600/80">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (auth) sessionStore.remove(auth.room.code);
              navigate('/');
            }}
            leftIcon={<ArrowLeft className="w-4 h-4" />}
          >
            Leave
          </Button>

          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-white tracking-tight">{room.name}</h1>
              {auth?.is_host && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-950 text-violet-300 border border-violet-800">
                  Host
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-ink-muted font-mono">Room Code:</span>
              <button
                onClick={handleCopyCode}
                className="text-xs font-mono font-bold text-violet-400 hover:text-violet-300 flex items-center gap-1 group"
                title="Click to copy code"
              >
                <span>{room.code}</span>
                <Copy className="w-3 h-3 opacity-60 group-hover:opacity-100" />
              </button>
            </div>
          </div>
        </div>

        {/* Real-time Connection State & Share Buttons */}
        <div className="flex items-center gap-3">
          {/* Socket Connection Badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-mono bg-void-900 border border-void-700">
            {connectionStatus === 'connected' ? (
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Realtime Active</span>
              </span>
            ) : connectionStatus === 'connecting' || connectionStatus === 'reconnecting' ? (
              <span className="flex items-center gap-1.5 text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span>Connecting...</span>
              </span>
            ) : (
              <button
                onClick={reconnect}
                className="flex items-center gap-1.5 text-rose-400 hover:text-rose-300 transition-colors"
                title="Click to reconnect"
              >
                <span className="w-2 h-2 rounded-full bg-rose-400" />
                <span>Offline (Reconnect)</span>
              </button>
            )}
          </div>

          <Button
            variant="secondary"
            size="sm"
            leftIcon={copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
            onClick={handleCopyLink}
          >
            {copied ? 'Link Copied!' : 'Copy Invite Link'}
          </Button>
        </div>
      </div>

      {/* Main Room Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Watch Stage & Verification Area (2 Cols) */}
        <div className="lg:col-span-2 space-y-6">
          <Card variant="elevated" className="p-0 overflow-hidden border-void-600/80">
            {/* Video Stage Placeholder / Display */}
            <div className="aspect-video bg-void-950 flex flex-col items-center justify-center p-8 text-center relative group">
              <div className="w-20 h-20 rounded-2xl bg-void-800/80 border border-void-600/80 flex items-center justify-center mb-4 shadow-xl">
                <Film className="w-8 h-8 text-violet-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-1">
                {currentEpisode ? currentEpisode.anime_title : 'No Episode Loaded'}
              </h3>
              <p className="text-xs text-ink-muted max-w-md">
                {currentEpisode
                  ? 'Verify your local video file below before entering the synchronized watch room.'
                  : auth?.is_host
                  ? 'Upload an anime episode below to start the verification and watch party.'
                  : 'Waiting for the host to upload an episode.'}
              </p>

              {auth?.is_host && !currentEpisode && (
                <div className="mt-5">
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<Upload className="w-4 h-4" />}
                    onClick={() => setShowUploadModal(true)}
                  >
                    Upload Anime Episode
                  </Button>
                </div>
              )}
            </div>

            {/* Ready-to-Watch Bar */}
            <div className="p-4 bg-void-900 border-t border-void-700/80 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-ink-muted">Your Status:</span>
                  <Badge status={currentParticipant?.status || 'WAITING_FOR_FILE'} />
                </div>
              </div>

              <div className="flex items-center gap-2">
                {auth?.is_host && currentEpisode && (
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Plus className="w-4 h-4" />}
                    onClick={() => setShowUploadModal(true)}
                  >
                    Upload Another
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  disabled={currentParticipant?.status !== 'VERIFIED'}
                  leftIcon={<Sparkles className="w-4 h-4" />}
                >
                  I'm Ready
                </Button>
              </div>
            </div>
          </Card>

          {/* Phase 3: Video Distribution & Verification Card */}
          {currentEpisode && auth && (
            <EpisodeVerificationCard
              episode={currentEpisode}
              auth={auth}
              participantStatus={currentParticipant?.status}
              onSendVerificationSocket={(epId, hash, size) => {
                if (socket) {
                  socket.emit('verify_file', {
                    episode_id: epId,
                    sha256_hash: hash,
                    file_size_bytes: size,
                  });
                }
              }}
            />
          )}
        </div>

        {/* Sidebar: Real-time Participants & Info (1 Col) */}
        <div className="space-y-6">
          <Card variant="default">
            <div className="flex items-center justify-between pb-3 border-b border-void-700/60 mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-violet-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Participants ({activeParticipants.length})
                </h3>
              </div>
              <span className="text-[11px] font-mono text-ink-dim">
                {activeParticipants.filter((p) => p.is_online).length} Online
              </span>
            </div>

            <div className="space-y-3">
              {activeParticipants.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-void-900/90 border border-void-700/60 transition-all duration-200"
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar with Online Pulse Indicator */}
                    <div className="relative">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600/40 to-pink-600/40 border border-violet-500/30 flex items-center justify-center font-bold text-xs text-white shadow-sm">
                        {p.username.charAt(0).toUpperCase()}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-void-900 ${
                          p.is_online ? 'bg-emerald-400 ring-2 ring-emerald-400/20' : 'bg-void-600'
                        }`}
                        title={p.is_online ? 'Online' : 'Offline'}
                      />
                    </div>

                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-white">{p.username}</span>
                        {p.is_host && (
                          <span className="text-[9px] font-mono uppercase bg-violet-950 text-violet-400 px-1.5 py-0.2 rounded border border-violet-800">
                            Host
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-ink-dim font-mono">
                          {p.id === auth?.participant_id ? '(You)' : 'Peer'}
                        </span>
                        <span className="text-void-600">•</span>
                        <span
                          className={`text-[10px] font-mono ${
                            p.is_online ? 'text-emerald-400 font-semibold' : 'text-ink-dim'
                          }`}
                        >
                          {p.is_online ? (
                            p.active_connections > 1 ? `Online (${p.active_connections} tabs)` : 'Online'
                          ) : 'Offline'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <Badge status={p.status} size="sm" />
                </div>
              ))}
            </div>
          </Card>

          {/* Watch Party How-to Guide */}
          <Card variant="outline" className="text-xs text-ink-muted space-y-2">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span>How AnimeSync Works:</span>
            </div>
            <ol className="list-decimal list-inside space-y-1.5 text-ink-dim text-[11px] leading-relaxed">
              <li>Host uploads or queues an anime episode.</li>
              <li>Friend downloads the episode to their computer.</li>
              <li>Both participants select their local file to verify SHA-256.</li>
              <li>Once verified, click Ready for synchronized playback!</li>
            </ol>
          </Card>
        </div>
      </div>

      {/* Upload Modal (Host Only) */}
      {auth && (
        <EpisodeUploadModal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          auth={auth}
          onEpisodeUploaded={(ep) => {
            setInitialRoom((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                current_episode_id: prev.current_episode_id || ep.id,
                episodes: [ep, ...prev.episodes.filter((e) => e.id !== ep.id)],
              };
            });
          }}
        />
      )}

      {/* Guest Join Modal if visiting from invite link */}
      {showJoinModal && (
        <JoinRoomModal
          isOpen={showJoinModal}
          onClose={() => {
            setShowJoinModal(false);
            if (code) {
              const updatedAuth = sessionStore.get(code.toUpperCase());
              if (updatedAuth) {
                setAuth(updatedAuth);
              }
            }
          }}
          initialCode={room.code}
        />
      )}
    </div>
  );
};

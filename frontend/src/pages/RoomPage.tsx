import React, { useEffect, useState, useRef } from 'react';
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
  X,
  MessageSquare,
  Radio,
  Mic,
  MicOff,
  PanelRightClose,
  PanelRightOpen,
  Keyboard,
  HardDrive,
} from 'lucide-react';
import { api, sessionStore } from '../services/api';
import { Room, RoomAuth, ParticipantPresence, Episode } from '../types';
import { useSocket } from '../hooks/useSocket';
import { useReadyState } from '../hooks/useReadyState';
import { useVideoSync } from '../hooks/useVideoSync';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { JoinRoomModal } from '../components/room/JoinRoomModal';
import { EpisodeUploadModal } from '../components/file/EpisodeUploadModal';
import { EpisodeVerificationCard } from '../components/file/EpisodeVerificationCard';
import { CountdownOverlay } from '../components/room/CountdownOverlay';
import { PlaybackStartedBanner } from '../components/room/PlaybackStartedBanner';
import { VideoPlayer, VideoPlayerHandle } from '../components/video/VideoPlayer';
import { SyncHealthBadge } from '../components/video/SyncHealthBadge';
import { useEpisodeQueue } from '../hooks/useEpisodeQueue';
import { EpisodeQueue } from '../components/queue/EpisodeQueue';
import { IntermissionOverlay } from '../components/queue/IntermissionOverlay';
import { useChat } from '../hooks/useChat';
import { useWebRTCVoice } from '../hooks/useWebRTCVoice';
import { ChatPanel } from '../components/chat/ChatPanel';
import { VoiceControlBar } from '../components/voice/VoiceControlBar';
import { ParticipantProfileModal } from '../components/room/ParticipantProfileModal';
import { KeyboardShortcutsModal } from '../components/room/KeyboardShortcutsModal';
import { MediaManagementModal } from '../components/room/MediaManagementModal';
import { isTypingElement } from '../services/webrtc';

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
  const [localVideoFile, setLocalVideoFile] = useState<File | null>(null);
  const videoPlayerRef = useRef<VideoPlayerHandle | null>(null);

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

  // Phase 4: pre-compute participant status before full derivation so useReadyState
  // has status on the very first render (presence may be [] until socket connects).
  const earlyPresence: ParticipantPresence[] =
    presence.length > 0
      ? presence
      : (initialRoom?.participants ?? []).map((p) => ({
          id: p.id,
          username: p.username,
          is_host: p.is_host,
          is_online: false,
          status: p.status,
          active_connections: 0,
          last_seen: p.last_seen,
        }));
  const earlyCurrentParticipant = auth
    ? earlyPresence.find((p) => p.id === auth.participant_id)
    : null;

  const {
    isReady,
    isPending,
    rejectionReason,
    countdown,
    markReady,
    markUnready,
    playbackStarted,
    playbackEpisodeId,
    acknowledgePlayback,
  } = useReadyState(socket, earlyCurrentParticipant?.status);

  // Phase 5 Task 5.3: Client-to-Server Playback Controls & Sequence Loop Prevention
  const isSyncAllowed =
    !!auth &&
    (earlyCurrentParticipant?.status === 'READY' ||
      earlyCurrentParticipant?.status === 'WATCHING' ||
      earlyCurrentParticipant?.status === 'VERIFIED');

  const {
    handlePlay,
    handlePause,
    handleSeek,
    handlePlaybackRateChange,
    handleBufferingStart,
    handleBufferingEnd,
    handleResync,
    currentSequence,
    lastAction,
    driftSeconds,
    bufferingParticipants,
    latencyMs,
    isResyncing,
    syncStatus,
  } = useVideoSync({
    socket,
    playerRef: videoPlayerRef,
    roomCode: room?.code,
    isEnabled: isSyncAllowed,
  });

  // Phase 6: Episode Queue, Video Ended & Auto-Next Coordination Hook
  const {
    queue,
    currentEpisodeId: queueCurrentEpisodeId,
    intermission,
    isQueueFinished,
    handleVideoEnded,
    handleReorderQueue,
    handleRemoveEpisode,
    handleSelectEpisode,
    handleSkipIntermission,
    handleCancelIntermission,
    setIsQueueFinished,
  } = useEpisodeQueue({
    socket,
    auth,
    initialEpisodes: initialRoom?.episodes || [],
    initialCurrentEpisodeId: initialRoom?.current_episode_id,
    onEpisodeAdvanced: () => {
      setLocalVideoFile(null);
    },
  });

  // Phase 7: Real-time Text Chat Hook
  const {
    messages,
    isLoading: isChatLoading,
    sendMessage,
  } = useChat({
    socket,
    auth,
    roomCode: room?.code,
  });

  // Phase 7: WebRTC Voice Chat Hook
  const {
    isInVoice,
    isMuted,
    voiceMode,
    isPttActive,
    isSpeaking,
    peerSpeakingMap,
    voicePeers,
    audioDevices,
    selectedDeviceId,
    setSelectedDeviceId,
    peerVolume,
    setPeerVolume,
    isPeerMutedLocally,
    setIsPeerMutedLocally,
    permissionError,
    clearPermissionError,
    joinVoice,
    leaveVoice,
    toggleMute,
    setVoiceMode,
  } = useWebRTCVoice({
    socket,
    auth,
    roomCode: room?.code,
  });

  // Phase 7: Sidebar Tabs & Unread Chat Badges
  type SidebarTab = 'chat' | 'voice' | 'queue' | 'members';
  const [activeTab, setActiveTab] = useState<SidebarTab>('chat');
  const [unreadMessages, setUnreadMessages] = useState<number>(0);
  const prevMsgCountRef = useRef<number>(0);

  // Phase 8: Collapsible Sidebar, Theater Mode & Modals
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(false);
  const [selectedProfileParticipant, setSelectedProfileParticipant] =
    useState<ParticipantPresence | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);
  const [showMediaModal, setShowMediaModal] = useState<boolean>(false);

  // Phase 8: Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (isTypingElement(e.target)) return;

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
      } else if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
      } else if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        setIsTheaterMode((prev) => {
          const next = !prev;
          if (next) {
            setIsSidebarCollapsed(true);
          }
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    if (activeTab === 'chat') {
      setUnreadMessages(0);
    } else if (messages.length > prevMsgCountRef.current) {
      setUnreadMessages((prev) => prev + (messages.length - prevMsgCountRef.current));
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length, activeTab]);

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

    const handleEpisodeChanged = () => {
      setLocalVideoFile(null);
    };
    socket.on('episode_changed', handleEpisodeChanged);

    return () => {
      socket.off('episode_added', handleEpisodeAdded);
      socket.off('episode_changed', handleEpisodeChanged);
    };
  }, [socket]);

  // Phase 5 Task 5.1: If synchronized playback has started, trigger local play
  useEffect(() => {
    if (playbackStarted && videoPlayerRef.current) {
      videoPlayerRef.current.play().catch((err) => {
        console.warn('Auto-play was prevented by browser policy:', err);
      });
    }
  }, [playbackStarted]);

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

  // Active current episode from queue or room snapshot
  const effectiveCurrentEpisodeId = queueCurrentEpisodeId || room.current_episode_id;
  const episodeList = queue.length > 0 ? queue : room.episodes;
  const currentEpisode =
    episodeList.find((e) => e.id === effectiveCurrentEpisodeId) ||
    episodeList[0] ||
    null;

  // Phase 8 Task 8.3: Fullscreen Communication Drawer Content
  const fullscreenCommunicationContent = (
    <div className="flex flex-col h-full space-y-3">
      {/* Tabs Switcher in Fullscreen */}
      <div className="flex items-center p-1 bg-void-900 border border-void-700/80 rounded-xl gap-1 shrink-0">
        <button
          onClick={() => {
            setActiveTab('chat');
            setUnreadMessages(0);
          }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'chat'
              ? 'bg-violet-600 text-white shadow-sm'
              : 'text-ink-muted hover:text-white hover:bg-void-800'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Chat</span>
          {unreadMessages > 0 && (
            <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('voice')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'voice'
              ? 'bg-violet-600 text-white shadow-sm'
              : 'text-ink-muted hover:text-white hover:bg-void-800'
          }`}
        >
          <Radio className="w-3.5 h-3.5" />
          <span>Voice</span>
          {isInVoice && (
            <span
              className={`w-2 h-2 rounded-full ${
                isSpeaking || Object.values(peerSpeakingMap).some(Boolean)
                  ? 'bg-emerald-400 ring-2 ring-emerald-400/50 animate-pulse'
                  : 'bg-emerald-400'
              }`}
            />
          )}
        </button>

        <button
          onClick={() => setActiveTab('members')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'members'
              ? 'bg-violet-600 text-white shadow-sm'
              : 'text-ink-muted hover:text-white hover:bg-void-800'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Members</span>
        </button>
      </div>

      {/* Tab Panels in Fullscreen */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'chat' && (
          <ChatPanel
            messages={messages}
            onSendMessage={sendMessage}
            currentParticipantId={auth?.participant_id}
            hostParticipantId={room.host_id}
            isLoading={isChatLoading}
            className="h-full border-0 bg-transparent p-0"
          />
        )}
        {activeTab === 'voice' && (
          <VoiceControlBar
            isInVoice={isInVoice}
            isMuted={isMuted}
            voiceMode={voiceMode}
            isPttActive={isPttActive}
            isSpeaking={isSpeaking}
            peerSpeakingMap={peerSpeakingMap}
            voicePeers={voicePeers}
            audioDevices={audioDevices}
            selectedDeviceId={selectedDeviceId}
            onDeviceChange={setSelectedDeviceId}
            peerVolume={peerVolume}
            onPeerVolumeChange={setPeerVolume}
            isPeerMutedLocally={isPeerMutedLocally}
            onTogglePeerMuteLocally={() => setIsPeerMutedLocally(!isPeerMutedLocally)}
            permissionError={permissionError}
            onClearPermissionError={clearPermissionError}
            onJoinVoice={joinVoice}
            onLeaveVoice={leaveVoice}
            onToggleMute={toggleMute}
            onSetVoiceMode={setVoiceMode}
            className="border-0 bg-transparent p-0"
          />
        )}
        {activeTab === 'members' && (
          <div className="space-y-2">
            {activeParticipants.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelectedProfileParticipant(p)}
                className="flex items-center justify-between p-2.5 rounded-xl bg-void-900/80 border border-void-700/60 cursor-pointer hover:border-violet-500/50 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-600 to-pink-600 flex items-center justify-center font-bold text-xs text-white">
                      {p.username.charAt(0).toUpperCase()}
                    </div>
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-void-900 ${
                        p.is_online ? 'bg-emerald-400' : 'bg-void-600'
                      }`}
                    />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-white flex items-center gap-1">
                      <span>{p.username}</span>
                      {p.is_host && (
                        <span className="text-[8px] font-mono uppercase bg-violet-950 text-violet-400 px-1 py-0.2 rounded border border-violet-800">
                          Host
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-ink-dim font-mono">
                      {p.id === auth?.participant_id ? '(You)' : 'Peer'}
                    </span>
                  </div>
                </div>
                <Badge status={p.status} size="sm" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={`${isTheaterMode ? 'max-w-[98vw]' : 'max-w-7xl'} mx-auto px-4 sm:px-6 py-6 space-y-6 transition-all duration-300`}>
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

          {/* Phase 7: Voice Quick Status / Control */}
          {!isInVoice ? (
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Radio className="w-3.5 h-3.5 text-emerald-400" />}
              onClick={joinVoice}
              className="text-xs h-8 text-emerald-300 border-emerald-800/80 hover:bg-emerald-950/40"
            >
              Join Voice
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 p-1 bg-void-900 border border-emerald-800/60 rounded-xl">
              <button
                onClick={() => setActiveTab('voice')}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-mono text-emerald-300 hover:bg-emerald-950/50 transition-colors"
                title="Voice connected — Click to open voice settings"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isSpeaking ? 'bg-emerald-400 ring-2 ring-emerald-400/50 animate-pulse' : 'bg-emerald-400'
                  }`}
                />
                <span>Voice ({voicePeers.length + 1})</span>
              </button>
              <button
                onClick={toggleMute}
                className={`p-1.5 rounded-lg text-xs transition-colors ${
                  isMuted
                    ? 'bg-rose-950/80 text-rose-300 border border-rose-800/80 hover:bg-rose-900/80'
                    : 'bg-void-800 text-ink hover:text-white hover:bg-void-700'
                }`}
                title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>
              {voiceMode === 'ptt' && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded transition-all ${
                    isPttActive
                      ? 'bg-violet-600 text-white font-bold animate-pulse'
                      : 'bg-void-800 text-ink-muted'
                  }`}
                  title="Push-to-Talk active: Hold V to talk"
                >
                  {isPttActive ? 'PTT ON' : 'PTT [V]'}
                </span>
              )}
            </div>
          )}

          <Button
            variant="secondary"
            size="sm"
            leftIcon={copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
            onClick={handleCopyLink}
          >
            {copied ? 'Link Copied!' : 'Copy Invite Link'}
          </Button>

          {/* Phase 8 Task 8.6: Host Media Storage Dashboard Trigger */}
          {auth?.is_host && (
            <button
              onClick={() => setShowMediaModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-void-900 border border-void-700 text-ink-muted hover:text-white hover:border-violet-500/50 transition-colors text-xs font-medium"
              title="Host Media & Storage Dashboard"
            >
              <HardDrive className="w-4 h-4 text-violet-400" />
              <span className="hidden sm:inline">Storage</span>
            </button>
          )}

          {/* Phase 8 Task 8.4: Keyboard Shortcuts Trigger */}
          <button
            onClick={() => setShowShortcutsModal(true)}
            className="p-2 rounded-xl bg-void-900 border border-void-700 text-ink-muted hover:text-white hover:border-violet-500/50 transition-colors"
            title="Keyboard Shortcuts (?)"
          >
            <Keyboard className="w-4 h-4" />
          </button>

          {/* Phase 8 Task 8.1: Sidebar Collapse / Expand Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            leftIcon={
              isSidebarCollapsed ? (
                <PanelRightOpen className="w-4 h-4 text-violet-400" />
              ) : (
                <PanelRightClose className="w-4 h-4 text-ink-muted" />
              )
            }
            title={isSidebarCollapsed ? 'Expand Sidebar (])' : 'Collapse Sidebar ([)'}
            className="text-xs h-8"
          >
            <span className="hidden md:inline">{isSidebarCollapsed ? 'Sidebar' : 'Collapse'}</span>
          </Button>
        </div>
      </div>

      {/* Main Room Layout Grid */}
      <div className={`grid grid-cols-1 ${isSidebarCollapsed ? 'lg:grid-cols-1' : 'lg:grid-cols-3'} gap-6 transition-all duration-300 relative`}>
        {/* Watch Stage & Verification Area */}
        <div className={`${isSidebarCollapsed ? 'lg:col-span-1' : 'lg:col-span-2'} space-y-6 transition-all duration-300`}>
          {/* Phase 6: Queue Finished Notice */}
          {isQueueFinished && (
            <div className="flex items-center justify-between p-4 rounded-xl bg-violet-950/80 border border-violet-700 text-white shadow-xl animate-in fade-in duration-200">
              <div className="flex items-center gap-3">
                <Sparkles className="w-5 h-5 text-pink-400 animate-pulse shrink-0" />
                <div>
                  <h4 className="text-sm font-bold">Watch Party Queue Finished!</h4>
                  <p className="text-xs text-ink-muted">
                    All episodes in the queue have been watched. Host can upload more episodes to keep going!
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsQueueFinished(false)}
                className="text-xs shrink-0"
              >
                Dismiss
              </Button>
            </div>
          )}

          <Card variant="elevated" className="p-0 overflow-hidden border-void-600/80 relative">
            {/* Phase 6: Intermission Screen Overlay */}
            {intermission && (
              <IntermissionOverlay
                intermission={intermission}
                isHost={!!auth?.is_host}
                onSkip={handleSkipIntermission}
                onCancel={handleCancelIntermission}
              />
            )}

            {/* Phase 5: HTML5 Local Video Player Stage with Real-Time Sync */}
            {currentEpisode ? (
              <VideoPlayer
                ref={videoPlayerRef}
                file={localVideoFile}
                animeTitle={currentEpisode.anime_title}
                episodeNumber={currentEpisode.episode_number}
                onFileSelect={(file) => setLocalVideoFile(file)}
                onPlay={handlePlay}
                onPause={handlePause}
                onSeek={handleSeek}
                onPlaybackRateChange={handlePlaybackRateChange}
                onBufferingStart={handleBufferingStart}
                onBufferingEnd={handleBufferingEnd}
                bufferingParticipants={bufferingParticipants}
                onResync={handleResync}
                isResyncing={isResyncing}
                syncStatus={syncStatus}
                latencyMs={latencyMs}
                driftSeconds={driftSeconds}
                onEnded={handleVideoEnded}
                isTheaterMode={isTheaterMode}
                onToggleTheaterMode={() => {
                  const next = !isTheaterMode;
                  setIsTheaterMode(next);
                  if (next) {
                    setIsSidebarCollapsed(true);
                  }
                }}
                fullscreenOverlay={fullscreenCommunicationContent}
                unreadCount={unreadMessages}
              />
            ) : (
              <div className="aspect-video bg-void-950 flex flex-col items-center justify-center p-8 text-center relative group">
                <div className="w-20 h-20 rounded-2xl bg-void-800/80 border border-void-600/80 flex items-center justify-center mb-4 shadow-xl">
                  <Film className="w-8 h-8 text-violet-400" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">No Episode Loaded</h3>
                <p className="text-xs text-ink-muted max-w-md">
                  {auth?.is_host
                    ? 'Upload an anime episode below to start the verification and watch party.'
                    : 'Waiting for the host to upload an episode.'}
                </p>

                {auth?.is_host && (
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
            )}

            {/* Ready-to-Watch Bar */}
            <div className="p-4 bg-void-900 border-t border-void-700/80 space-y-3">
              {/* Rejection notice */}
              {rejectionReason && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                  <span className="flex-1">{rejectionReason}</span>
                  <button onClick={() => {}} className="shrink-0">
                    <X className="w-3.5 h-3.5 text-rose-500 hover:text-rose-300" />
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-ink-muted">Your Status:</span>
                    <Badge status={currentParticipant?.status || 'WAITING_FOR_FILE'} />
                  </div>

                  {/* Phase 5 Task 5.6: Sync Health Diagnostics & Resync Trigger */}
                  {currentEpisode && (
                    <SyncHealthBadge
                      status={syncStatus}
                      driftSeconds={driftSeconds}
                      latencyMs={latencyMs}
                      isResyncing={isResyncing}
                      onResync={handleResync}
                    />
                  )}

                  {/* Realtime Sync Status Indicator */}
                  {currentSequence > 0 && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-void-800 text-cyan-300 border border-void-600 flex items-center gap-1.5 shadow-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                      <span>Seq #{currentSequence} {lastAction ? `(${lastAction})` : ''}</span>
                    </span>
                  )}
                  {/* Countdown preview in bar when active */}
                  {countdown.active && (
                    <span className="text-xs font-mono text-violet-300 animate-pulse">
                      Starting in {countdown.secondsRemaining}s…
                    </span>
                  )}
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

                  {/* Ready / Unready toggle */}
                  {isReady ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      leftIcon={<X className="w-4 h-4 text-rose-400" />}
                      onClick={markUnready}
                    >
                      {isPending ? 'Updating…' : 'Cancel Ready'}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={currentParticipant?.status !== 'VERIFIED' || isPending}
                      leftIcon={<Sparkles className="w-4 h-4" />}
                      onClick={markReady}
                      title={
                        currentParticipant?.status !== 'VERIFIED'
                          ? 'Verify your local file first'
                          : 'Mark yourself as ready to watch'
                      }
                    >
                      {isPending ? 'Updating…' : "I'm Ready"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Phase 3: Video Distribution & Verification Card */}
          {currentEpisode && auth && (
            <EpisodeVerificationCard
              episode={currentEpisode}
              auth={auth}
              participantStatus={currentParticipant?.status}
              onFileVerified={(file) => {
                setLocalVideoFile(file);
              }}
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

        {/* Sidebar: Chat, Voice, Episode Queue & Participants (1 Col) */}
        {!isSidebarCollapsed ? (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Sidebar Title & Collapse Button */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-mono font-bold text-ink-muted uppercase tracking-wider">
                Watch Party Sidebar
              </span>
              <button
                onClick={() => setIsSidebarCollapsed(true)}
                className="p-1 rounded-lg text-ink-muted hover:text-white hover:bg-void-800 transition-colors"
                title="Collapse Sidebar ([)"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            </div>

            {/* Sidebar Tabs Switcher */}
            <div className="flex items-center p-1 bg-void-900 border border-void-700/80 rounded-xl gap-1">
            <button
              onClick={() => {
                setActiveTab('chat');
                setUnreadMessages(0);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'chat'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-ink-muted hover:text-white hover:bg-void-800'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat</span>
              {unreadMessages > 0 && (
                <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('voice')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'voice'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-ink-muted hover:text-white hover:bg-void-800'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Voice</span>
              {isInVoice && (
                <span
                  className={`w-2 h-2 rounded-full ${
                    isSpeaking || Object.values(peerSpeakingMap).some(Boolean)
                      ? 'bg-emerald-400 ring-2 ring-emerald-400/50 animate-pulse'
                      : 'bg-emerald-400'
                  }`}
                />
              )}
            </button>

            <button
              onClick={() => setActiveTab('queue')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'queue'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-ink-muted hover:text-white hover:bg-void-800'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Queue</span>
              {episodeList.length > 0 && (
                <span className="text-[10px] font-mono px-1 rounded bg-void-800/80 text-ink-dim">
                  {episodeList.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('members')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'members'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-ink-muted hover:text-white hover:bg-void-800'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Members</span>
              <span className="text-[10px] font-mono px-1 rounded bg-void-800/80 text-ink-dim">
                {activeParticipants.length}
              </span>
            </button>
          </div>

          {/* Tab 1: Real-time Text Chat */}
          {activeTab === 'chat' && (
            <ChatPanel
              messages={messages}
              onSendMessage={sendMessage}
              currentParticipantId={auth?.participant_id}
              hostParticipantId={room.host_id}
              isLoading={isChatLoading}
            />
          )}

          {/* Tab 2: WebRTC Voice Controls */}
          {activeTab === 'voice' && (
            <VoiceControlBar
              isInVoice={isInVoice}
              isMuted={isMuted}
              voiceMode={voiceMode}
              isPttActive={isPttActive}
              isSpeaking={isSpeaking}
              peerSpeakingMap={peerSpeakingMap}
              voicePeers={voicePeers}
              audioDevices={audioDevices}
              selectedDeviceId={selectedDeviceId}
              onDeviceChange={setSelectedDeviceId}
              peerVolume={peerVolume}
              onPeerVolumeChange={setPeerVolume}
              isPeerMutedLocally={isPeerMutedLocally}
              onTogglePeerMuteLocally={() => setIsPeerMutedLocally(!isPeerMutedLocally)}
              permissionError={permissionError}
              onClearPermissionError={clearPermissionError}
              onJoinVoice={joinVoice}
              onLeaveVoice={leaveVoice}
              onToggleMute={toggleMute}
              onSetVoiceMode={setVoiceMode}
            />
          )}

          {/* Tab 3: Episode Queue */}
          {activeTab === 'queue' && (
            <EpisodeQueue
              episodes={episodeList}
              currentEpisodeId={effectiveCurrentEpisodeId || null}
              isHost={!!auth?.is_host}
              onSelectEpisode={handleSelectEpisode}
              onRemoveEpisode={handleRemoveEpisode}
              onReorderQueue={handleReorderQueue}
              onOpenUploadModal={() => setShowUploadModal(true)}
              onDownloadEpisode={(ep) => {
                if (auth) {
                  window.open(api.getDownloadUrl(ep.id, auth.participant_id, auth.session_token), '_blank');
                }
              }}
              verifiedEpisodeId={currentParticipant?.status === 'VERIFIED' ? currentEpisode?.id : null}
            />
          )}

          {/* Tab 4: Members & How-To */}
          {activeTab === 'members' && (
            <>
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
                      onClick={() => setSelectedProfileParticipant(p)}
                      className="flex items-center justify-between p-3 rounded-xl bg-void-900/90 border border-void-700/60 hover:border-violet-500/50 cursor-pointer transition-all duration-200 group/member"
                      title="Click to view profile & adjust voice volume"
                    >
                      <div className="flex items-center gap-3">
                        {/* Avatar with Online Pulse Indicator */}
                        <div className="relative">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600/40 to-pink-600/40 border border-violet-500/30 flex items-center justify-center font-bold text-xs text-white shadow-sm group-hover/member:border-violet-400/60 transition-colors">
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
                            <span className="text-sm font-medium text-white group-hover/member:text-violet-300 transition-colors">{p.username}</span>
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
            </>
          )}
        </div>
      ) : (
        /* Phase 8 Task 8.1: Floating rail trigger when sidebar is collapsed */
        <div className="fixed right-4 bottom-8 z-30 flex items-center gap-2 animate-in slide-in-from-right duration-200">
          <button
            onClick={() => setIsSidebarCollapsed(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-void-900/90 hover:bg-void-800 border border-violet-500/50 text-white shadow-2xl backdrop-blur-md hover:scale-105 transition-all group"
            title="Expand Sidebar (])"
          >
            <PanelRightOpen className="w-4 h-4 text-violet-400 group-hover:text-violet-300" />
            <span className="text-xs font-semibold">Sidebar</span>
            {unreadMessages > 0 && (
              <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
            )}
            {isInVoice && (
              <span
                className={`w-2 h-2 rounded-full ${
                  isSpeaking ? 'bg-emerald-400 ring-2 ring-emerald-400/50 animate-pulse' : 'bg-emerald-400'
                }`}
              />
            )}
          </button>
        </div>
      )}
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

      {/* Phase 4: Synchronized countdown overlay */}
      {countdown.active && (
        <CountdownOverlay countdown={countdown} onCancel={markUnready} />
      )}

      {/* Phase 4: Playback started banner (Phase 5 will replace with actual player) */}
      {playbackStarted && (
        <PlaybackStartedBanner
          episodeId={playbackEpisodeId}
          onDismiss={acknowledgePlayback}
        />
      )}

      {/* Phase 8 Task 8.2: Participant Profile & Voice Volume Popover */}
      <ParticipantProfileModal
        isOpen={!!selectedProfileParticipant}
        onClose={() => setSelectedProfileParticipant(null)}
        participant={selectedProfileParticipant}
        isSelf={selectedProfileParticipant?.id === auth?.participant_id}
        isInVoice={isInVoice}
        isPeerInVoice={voicePeers.some((p) => p.participant_id === selectedProfileParticipant?.id)}
        isSpeaking={selectedProfileParticipant ? !!peerSpeakingMap[selectedProfileParticipant.id] : false}
        peerVolume={peerVolume}
        onPeerVolumeChange={setPeerVolume}
        isPeerMutedLocally={isPeerMutedLocally}
        onTogglePeerMuteLocally={() => setIsPeerMutedLocally(!isPeerMutedLocally)}
        onOpenChat={() => {
          setActiveTab('chat');
          setIsSidebarCollapsed(false);
        }}
      />

      {/* Phase 8 Task 8.4: Keyboard Shortcuts Help Modal */}
      <KeyboardShortcutsModal
        isOpen={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />

      {/* Phase 8 Task 8.6: Host Media Storage Dashboard Modal */}
      {auth?.is_host && room && (
        <MediaManagementModal
          isOpen={showMediaModal}
          onClose={() => setShowMediaModal(false)}
          roomCode={room.code}
          auth={auth}
          onEpisodeDeleted={handleRemoveEpisode}
        />
      )}
    </div>
  );
};

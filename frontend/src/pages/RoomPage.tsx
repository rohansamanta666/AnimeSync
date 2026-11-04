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
} from 'lucide-react';
import { api, sessionStore } from '../services/api';
import { Room, RoomAuth, Participant } from '../types';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { JoinRoomModal } from '../components/room/JoinRoomModal';

export const RoomPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [room, setRoom] = useState<Room | null>(null);
  const [auth, setAuth] = useState<RoomAuth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);

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

    // Fetch latest room data
    api.getRoom(cleanCode)
      .then((data: Room) => {
        setRoom(data);
        // If not authenticated for this room, prompt to join
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

  const currentParticipant = auth
    ? room.participants.find((p: Participant) => p.id === auth.participant_id)
    : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-5 rounded-2xl border border-void-600/80">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
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

        {/* Share & Invite Buttons */}
        <div className="flex items-center gap-2.5">
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
        {/* Watch Stage / Video Area (2 Cols) */}
        <div className="lg:col-span-2 space-y-6">
          <Card variant="elevated" className="p-0 overflow-hidden border-void-600/80">
            {/* Video Player Display Placeholder */}
            <div className="aspect-video bg-void-950 flex flex-col items-center justify-center p-8 text-center relative group">
              <div className="w-20 h-20 rounded-2xl bg-void-800/80 border border-void-600/80 flex items-center justify-center mb-4 shadow-xl">
                <Film className="w-8 h-8 text-violet-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-1">
                {room.episodes.length > 0 ? room.episodes[0].anime_title : 'No Episode Loaded'}
              </h3>
              <p className="text-xs text-ink-muted max-w-md">
                {auth?.is_host
                  ? 'Upload an anime episode below to start the verification and watch party.'
                  : 'Waiting for the host to upload or select an episode.'}
              </p>
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
        </div>

        {/* Sidebar: Participants & Room Info (1 Col) */}
        <div className="space-y-6">
          {/* Participants Card */}
          <Card variant="default">
            <div className="flex items-center justify-between pb-3 border-b border-void-700/60 mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-violet-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Participants ({room.participants.length})
                </h3>
              </div>
            </div>

            <div className="space-y-3">
              {room.participants.map((p: Participant) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-void-900/90 border border-void-700/60"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-600/40 to-pink-600/40 border border-violet-500/30 flex items-center justify-center font-bold text-xs text-white">
                      {p.username.charAt(0).toUpperCase()}
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
                      <span className="text-[10px] text-ink-dim font-mono">
                        {p.id === auth?.participant_id ? '(You)' : 'Peer'}
                      </span>
                    </div>
                  </div>

                  <Badge status={p.status} size="sm" />
                </div>
              ))}
            </div>
          </Card>

          {/* Quick How-to Card */}
          <Card variant="outline" className="text-xs text-ink-muted space-y-2">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span>How AnimeSync Works:</span>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-ink-dim text-[11px] leading-relaxed">
              <li>Host uploads or queues an anime episode.</li>
              <li>Friend downloads the episode to their computer.</li>
              <li>Both participants select their local file to verify SHA-256.</li>
              <li>Once verified, click Ready for synchronized playback!</li>
            </ol>
          </Card>
        </div>
      </div>

      {/* Guest Join Modal if visiting from invite link */}
      {showJoinModal && (
        <JoinRoomModal
          isOpen={showJoinModal}
          onClose={() => setShowJoinModal(false)}
          initialCode={room.code}
        />
      )}
    </div>
  );
};

/**
 * ParticipantProfileModal — Phase 8 Task 8.2
 *
 * Discord-inspired user profile modal/popover:
 * - Participant avatar, username, host/guest role, and online presence status
 * - Ready-to-watch verification status
 * - Per-participant local voice volume slider (0% - 200%)
 * - Local peer mute toggle (does not affect peer's microphone)
 * - Quick jump to Chat
 */
import React from 'react';
import {
  X,
  Shield,
  Volume2,
  VolumeX,
  MessageSquare,
  Radio,
  Clock,
} from 'lucide-react';
import { ParticipantPresence } from '../../types';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

export interface ParticipantProfileModalProps {
  participant: ParticipantPresence | null;
  isOpen: boolean;
  onClose: () => void;
  isSelf: boolean;
  // Voice controls for the remote peer
  isInVoice?: boolean;
  isPeerInVoice?: boolean;
  isSpeaking?: boolean;
  peerVolume?: number;
  onPeerVolumeChange?: (volume: number) => void;
  isPeerMutedLocally?: boolean;
  onTogglePeerMuteLocally?: () => void;
  onOpenChat?: () => void;
}

export const ParticipantProfileModal: React.FC<ParticipantProfileModalProps> = ({
  participant,
  isOpen,
  onClose,
  isSelf,
  isInVoice = false,
  isPeerInVoice = false,
  isSpeaking = false,
  peerVolume = 100,
  onPeerVolumeChange,
  isPeerMutedLocally = false,
  onTogglePeerMuteLocally,
  onOpenChat,
}) => {
  if (!isOpen || !participant) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm glass-panel rounded-2xl border border-void-600/80 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Banner with gradient */}
        <div className="h-20 bg-gradient-to-r from-violet-900/60 via-pink-900/40 to-void-950 relative border-b border-void-700/60">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/40 hover:bg-black/70 text-ink-muted hover:text-white transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content body */}
        <div className="p-5 pt-0 relative space-y-4">
          {/* Avatar floating above banner */}
          <div className="flex items-end justify-between -mt-10 mb-2">
            <div className="relative">
              <div
                className={`w-20 h-20 rounded-2xl bg-gradient-to-tr from-violet-600 to-pink-600 border-4 border-void-900 flex items-center justify-center font-bold text-2xl text-white shadow-xl ${
                  isSpeaking ? 'ring-4 ring-emerald-400/60 animate-pulse' : ''
                }`}
              >
                {participant.username.charAt(0).toUpperCase()}
              </div>
              <span
                className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-void-900 ${
                  participant.is_online
                    ? 'bg-emerald-400 ring-2 ring-emerald-400/30'
                    : 'bg-void-600'
                }`}
                title={participant.is_online ? 'Online' : 'Offline'}
              />
            </div>

            <div className="flex items-center gap-1.5">
              {participant.is_host && (
                <span className="text-[10px] font-mono uppercase bg-violet-950 text-violet-300 px-2 py-0.5 rounded-md border border-violet-800 flex items-center gap-1">
                  <Shield className="w-3 h-3 text-violet-400" />
                  Host
                </span>
              )}
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-void-800 text-ink-muted border border-void-700">
                {isSelf ? 'You' : 'Peer'}
              </span>
            </div>
          </div>

          {/* User details */}
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight">
              {participant.username}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`text-xs font-mono font-medium ${
                  participant.is_online ? 'text-emerald-400' : 'text-ink-dim'
                }`}
              >
                {participant.is_online
                  ? participant.active_connections > 1
                    ? `Online (${participant.active_connections} tabs active)`
                    : 'Online'
                  : 'Offline'}
              </span>
              <span className="text-void-600">•</span>
              <div className="flex items-center gap-1 text-[11px] font-mono text-ink-dim">
                <Clock className="w-3 h-3" />
                <span>
                  {participant.is_online
                    ? 'Active now'
                    : participant.last_seen
                    ? `Last seen ${new Date(participant.last_seen).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : 'Offline'}
                </span>
              </div>
            </div>
          </div>

          {/* Ready-to-watch verification status */}
          <div className="p-3 rounded-xl bg-void-900/90 border border-void-700/60 flex items-center justify-between">
            <span className="text-xs font-mono text-ink-muted">Watch Status:</span>
            <Badge status={participant.status} />
          </div>

          {/* Voice Chat Controls (Only for Peer when in voice) */}
          {!isSelf && (
            <div className="p-3.5 rounded-xl bg-void-900/90 border border-void-700/60 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radio className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Voice Settings
                  </span>
                </div>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    isPeerInVoice
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : 'bg-void-800 text-ink-dim border border-void-700'
                  }`}
                >
                  {isPeerInVoice
                    ? isInVoice
                      ? isSpeaking
                        ? 'Speaking'
                        : 'Connected'
                      : 'Connected (Join Voice to Hear)'
                    : 'Not in Voice'}
                </span>
              </div>

              {/* Volume Slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-ink-muted flex items-center gap-1.5">
                    {isPeerMutedLocally ? (
                      <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-violet-400" />
                    )}
                    <span>User Volume</span>
                  </span>
                  <span className="font-bold text-white">
                    {isPeerMutedLocally ? 'Muted' : `${peerVolume}%`}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={isPeerMutedLocally ? 0 : peerVolume}
                  disabled={isPeerMutedLocally}
                  onChange={(e) => onPeerVolumeChange?.(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-void-700 rounded-lg appearance-none cursor-pointer accent-violet-500 disabled:opacity-40"
                />
                <div className="flex justify-between text-[9px] font-mono text-ink-dim">
                  <span>0%</span>
                  <span>100% (Default)</span>
                  <span>200% (Boost)</span>
                </div>
              </div>

              {/* Local Mute Toggle Button */}
              {onTogglePeerMuteLocally && (
                <button
                  onClick={onTogglePeerMuteLocally}
                  className={`w-full py-1.5 px-3 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2 ${
                    isPeerMutedLocally
                      ? 'bg-rose-950/80 text-rose-300 border border-rose-800 hover:bg-rose-900/80'
                      : 'bg-void-800 hover:bg-void-700 text-ink-muted hover:text-white border border-void-700'
                  }`}
                >
                  {isPeerMutedLocally ? (
                    <>
                      <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                      <span>Unmute {participant.username} Locally</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3.5 h-3.5 text-ink-muted" />
                      <span>Mute {participant.username} Locally</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            {!isSelf && onOpenChat && (
              <Button
                variant="primary"
                size="sm"
                className="flex-1 text-xs"
                leftIcon={<MessageSquare className="w-3.5 h-3.5" />}
                onClick={() => {
                  onClose();
                  onOpenChat();
                }}
              >
                Send Message
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className={isSelf ? 'w-full text-xs' : 'text-xs'}
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};


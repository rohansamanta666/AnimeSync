/**
 * VoiceControlBar — Phase 7 Tasks 7.2 – 7.6
 *
 * WebRTC voice controls bar:
 * - Join/Leave Voice channel
 * - Microphone Mute/Unmute
 * - Push-to-Talk (PTT) with key 'V'
 * - Independent peer volume slider (0% - 200%)
 * - Local peer mute toggle
 * - Audio device selector
 * - Live speaking indicators
 */
import React from 'react';
import {
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Volume2,
  VolumeX,
  Settings2,
  AlertCircle,
  Radio,
  Sparkles,
} from 'lucide-react';
import { VoiceMode, VoicePeer } from '../../types';
import { Button } from '../common/Button';

export interface VoiceControlBarProps {
  isInVoice: boolean;
  isMuted: boolean;
  voiceMode: VoiceMode;
  isPttActive: boolean;
  isSpeaking: boolean;
  peerSpeakingMap: Record<string, boolean>;
  voicePeers: VoicePeer[];
  audioDevices: MediaDeviceInfo[];
  selectedDeviceId: string;
  onDeviceChange: (deviceId: string) => void;
  peerVolume: number; // 0% - 200%
  onPeerVolumeChange: (volume: number) => void;
  isPeerMutedLocally: boolean;
  onTogglePeerMuteLocally: () => void;
  permissionError: string | null;
  onClearPermissionError: () => void;
  onJoinVoice: () => void;
  onLeaveVoice: () => void;
  onToggleMute: () => void;
  onSetVoiceMode: (mode: VoiceMode) => void;
  className?: string;
}

export const VoiceControlBar: React.FC<VoiceControlBarProps> = ({
  isInVoice,
  isMuted,
  voiceMode,
  isPttActive,
  isSpeaking,
  peerSpeakingMap,
  voicePeers,
  audioDevices,
  selectedDeviceId,
  onDeviceChange,
  peerVolume,
  onPeerVolumeChange,
  isPeerMutedLocally,
  onTogglePeerMuteLocally,
  permissionError,
  onClearPermissionError,
  onJoinVoice,
  onLeaveVoice,
  onToggleMute,
  onSetVoiceMode,
  className = '',
}) => {
  return (
    <div className={`p-4 glass-panel rounded-2xl space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-void-700/60">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Voice Chat
          </h3>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800">
            WebRTC P2P
          </span>
        </div>

        {/* Join/Leave Button */}
        {isInVoice ? (
          <Button
            variant="outline"
            size="sm"
            leftIcon={<PhoneOff className="w-3.5 h-3.5 text-rose-400" />}
            onClick={onLeaveVoice}
            className="text-xs h-7 py-1 px-2.5 text-rose-300 border-rose-800/80 hover:bg-rose-950/40"
          >
            Leave Voice
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            leftIcon={<PhoneCall className="w-3.5 h-3.5" />}
            onClick={onJoinVoice}
            className="text-xs h-7 py-1 px-3"
          >
            Join Voice
          </Button>
        )}
      </div>

      {/* Permission Error Banner */}
      {permissionError && (
        <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-start justify-between gap-2 shadow-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">{permissionError}</p>
          </div>
          <button
            onClick={onClearPermissionError}
            className="text-rose-400 hover:text-white shrink-0 font-mono text-sm ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {isInVoice ? (
        <div className="space-y-4">
          {/* Controls Bar: Mute, PTT indicator, Mode */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-void-900 border border-void-700/80">
            {/* Mic Mute Toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={onToggleMute}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm ${
                  isMuted
                    ? 'bg-rose-950/80 text-rose-400 border border-rose-800 hover:bg-rose-900'
                    : isSpeaking
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500 ring-2 ring-emerald-500/30'
                    : 'bg-void-800 text-ink-text border border-void-600 hover:bg-void-700'
                }`}
                title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
              >
                {isMuted ? (
                  <MicOff className="w-4 h-4 text-rose-400" />
                ) : (
                  <Mic className={`w-4 h-4 ${isSpeaking ? 'text-emerald-400 animate-pulse' : ''}`} />
                )}
                <span>{isMuted ? 'Muted' : isSpeaking ? 'Speaking…' : 'Microphone On'}</span>
              </button>

              {/* PTT Active Status Pill */}
              {voiceMode === 'ptt' && (
                <span
                  className={`text-[10px] font-mono px-2 py-1 rounded-lg border transition-all ${
                    isPttActive
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-600 animate-pulse'
                      : 'bg-void-800 text-ink-dim border-void-700'
                  }`}
                >
                  {isPttActive ? 'PTT Active (Transmitting)' : "Hold 'V' to speak"}
                </span>
              )}
            </div>

            {/* Mode Selector */}
            <div className="flex items-center gap-1 bg-void-950 p-1 rounded-lg border border-void-700 text-xs">
              <button
                onClick={() => onSetVoiceMode('activity')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  voiceMode === 'activity'
                    ? 'bg-violet-600 text-white font-semibold shadow-sm'
                    : 'text-ink-muted hover:text-white'
                }`}
              >
                Voice Activity
              </button>
              <button
                onClick={() => onSetVoiceMode('ptt')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  voiceMode === 'ptt'
                    ? 'bg-violet-600 text-white font-semibold shadow-sm'
                    : 'text-ink-muted hover:text-white'
                }`}
                title="Hold 'V' to talk"
              >
                PTT (V)
              </button>
            </div>
          </div>

          {/* Independent Audio Pipeline: Peer Voice Volume (0% - 200%) */}
          <div className="p-3 rounded-xl bg-void-900 border border-void-700/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-medium text-white">
                <Volume2 className="w-4 h-4 text-cyan-400" />
                <span>Friend Voice Volume</span>
                {peerVolume > 100 && (
                  <span className="text-[9px] font-mono uppercase bg-cyan-950 text-cyan-300 px-1.5 py-0.2 rounded border border-cyan-800 flex items-center gap-0.5">
                    <Sparkles className="w-2.5 h-2.5" /> Boosted {peerVolume}%
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-ink-dim">{peerVolume}%</span>
                <button
                  onClick={onTogglePeerMuteLocally}
                  className={`p-1 rounded text-ink-dim hover:text-white transition-colors ${
                    isPeerMutedLocally ? 'text-rose-400 font-bold' : ''
                  }`}
                  title={isPeerMutedLocally ? 'Unmute peer locally' : 'Mute peer locally'}
                >
                  {isPeerMutedLocally ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Slider */}
            <input
              type="range"
              min="0"
              max="200"
              step="5"
              value={isPeerMutedLocally ? 0 : peerVolume}
              onChange={(e) => onPeerVolumeChange(Number(e.target.value))}
              disabled={isPeerMutedLocally}
              className="w-full accent-cyan-400 h-1.5 bg-void-700 rounded-lg cursor-pointer"
            />
            <p className="text-[10px] text-ink-dim font-mono">
              Independent of anime soundtrack. Boost peer voice up to 200%.
            </p>
          </div>

          {/* Active Voice Peers List */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-mono text-ink-dim uppercase tracking-wider flex items-center justify-between">
              <span>Connected In Voice ({voicePeers.length + 1})</span>
            </div>

            <div className="space-y-1.5">
              {/* Local User */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-void-900/60 border border-void-700/60 text-xs">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-md bg-violet-600 text-white font-bold text-[10px] flex items-center justify-center transition-all ${
                      isSpeaking ? 'ring-2 ring-emerald-400 animate-pulse' : ''
                    }`}
                  >
                    You
                  </div>
                  <span className="text-white font-medium">You</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-mono">
                  {isMuted ? (
                    <span className="text-rose-400 flex items-center gap-1">
                      <MicOff className="w-3 h-3" /> Muted
                    </span>
                  ) : isSpeaking ? (
                    <span className="text-emerald-400 font-semibold animate-pulse">Speaking</span>
                  ) : (
                    <span className="text-ink-dim">Connected</span>
                  )}
                </div>
              </div>

              {/* Remote Peers */}
              {voicePeers.map((peer) => {
                const isPeerSpeaking = !!peerSpeakingMap[peer.participant_id];
                return (
                  <div
                    key={peer.participant_id}
                    className="flex items-center justify-between p-2 rounded-lg bg-void-900/60 border border-void-700/60 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-6 h-6 rounded-md bg-pink-600/40 border border-pink-500/40 text-pink-300 font-bold text-[10px] flex items-center justify-center transition-all ${
                          isPeerSpeaking ? 'ring-2 ring-emerald-400 animate-pulse' : ''
                        }`}
                      >
                        {peer.username.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-white font-medium">{peer.username}</span>
                    </div>

                    <div className="flex items-center gap-1.5 text-[10px] font-mono">
                      {peer.is_muted ? (
                        <span className="text-rose-400 flex items-center gap-1">
                          <MicOff className="w-3 h-3" /> Muted
                        </span>
                      ) : isPeerSpeaking ? (
                        <span className="text-emerald-400 font-semibold animate-pulse">Speaking</span>
                      ) : (
                        <span className="text-ink-dim">Connected</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Device Settings Dropdown */}
          {audioDevices.length > 0 && (
            <div className="pt-2 border-t border-void-700/60 flex items-center gap-2 text-xs">
              <Settings2 className="w-3.5 h-3.5 text-ink-dim shrink-0" />
              <select
                value={selectedDeviceId}
                onChange={(e) => onDeviceChange(e.target.value)}
                className="flex-1 bg-void-900 border border-void-700 rounded-lg px-2 py-1 text-xs text-ink-text focus:outline-none focus:border-violet-500 transition-colors"
              >
                {audioDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${d.deviceId.slice(0, 5)}`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      ) : (
        /* Not in Voice State */
        <div className="py-4 text-center space-y-2 text-ink-muted">
          <p className="text-xs leading-relaxed">
            Join the WebRTC voice channel to talk with your friend with Push-to-Talk (<kbd className="font-mono bg-void-800 px-1 py-0.5 rounded text-white border border-void-700">V</kbd>) and independent voice volume.
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Mic className="w-3.5 h-3.5" />}
              onClick={onJoinVoice}
            >
              Connect Microphone
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

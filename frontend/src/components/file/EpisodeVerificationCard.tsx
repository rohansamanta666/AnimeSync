import React, { useRef, useState } from 'react';
import {
  Download,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  FileCheck,
  FolderOpen,
  Copy,
  Check,
  FileVideo,
} from 'lucide-react';
import { Episode, RoomAuth, ParticipantStatus } from '../../types';
import { api } from '../../services/api';
import { useFileHasher } from '../../hooks/useFileHasher';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';

interface EpisodeVerificationCardProps {
  episode: Episode;
  auth: RoomAuth;
  participantStatus?: ParticipantStatus;
  onVerificationInitiated?: () => void;
  onFileVerified?: (file: File, hash: string) => void;
  onSendVerificationSocket: (episodeId: string, hash: string, size: number) => void;
}

export const EpisodeVerificationCard: React.FC<EpisodeVerificationCardProps> = ({
  episode,
  auth,
  participantStatus,
  onFileVerified,
  onSendVerificationSocket,
}) => {
  const [copiedHash, setCopiedHash] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [verificationFeedback, setVerificationFeedback] = useState<{
    status: 'VERIFIED' | 'FAILED' | null;
    message?: string;
  }>({ status: null });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { hashFile, progress, processedBytes, totalBytes, isHashing, error: hashError } = useFileHasher();

  const handleCopyHash = () => {
    if (episode.sha256_hash) {
      navigator.clipboard.writeText(episode.sha256_hash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setVerificationFeedback({ status: null });

    try {
      // 1. Calculate SHA-256 via Web Worker without freezing the main thread
      const { hash, fileSizeBytes } = await hashFile(file);

      // 2. Transmit to server over Socket.IO for authoritative server verification
      onSendVerificationSocket(episode.id, hash, fileSizeBytes);

      // 3. Local check feedback
      if (hash === episode.sha256_hash?.toLowerCase()) {
        setVerificationFeedback({
          status: 'VERIFIED',
          message: 'Exact SHA-256 checksum match confirmed!',
        });
        if (onFileVerified) {
          onFileVerified(file, hash);
        }
      } else {
        setVerificationFeedback({
          status: 'FAILED',
          message: 'Checksum mismatch. The selected file does not match the server episode.',
        });
      }
    } catch (err: any) {
      setVerificationFeedback({
        status: 'FAILED',
        message: err?.message || 'Failed to verify file checksum',
      });
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const downloadUrl = api.getDownloadUrl(episode.id, auth.participant_id, auth.session_token);

  const isVerified = participantStatus === 'VERIFIED' || participantStatus === 'READY' || verificationFeedback.status === 'VERIFIED';
  const isFailed = participantStatus === 'VERIFICATION_FAILED' || verificationFeedback.status === 'FAILED';

  return (
    <Card variant="elevated" className="space-y-5 border-void-600/80">
      {/* Top Episode Details Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-void-700/60">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-violet-400 bg-violet-950/80 px-2 py-0.5 rounded border border-violet-800/80">
              S{episode.season}:E{episode.episode_number}
            </span>
            <h3 className="text-base font-bold text-white">{episode.anime_title}</h3>
          </div>
          {episode.display_title && (
            <p className="text-xs text-ink-muted mt-0.5">{episode.display_title}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-ink-dim">
            {formatBytes(episode.file_size_bytes)}
          </span>
          <Badge status={participantStatus || 'WAITING_FOR_FILE'} size="sm" />
        </div>
      </div>

      {/* Authoritative Server SHA-256 Badge */}
      <div className="p-3.5 rounded-xl bg-void-900/90 border border-void-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="font-mono text-ink-muted">Server SHA-256:</span>
          <span className="font-mono text-ink-text truncate max-w-[220px] sm:max-w-xs">
            {episode.sha256_hash}
          </span>
        </div>
        <button
          onClick={handleCopyHash}
          className="self-end sm:self-auto text-ink-dim hover:text-cyan-300 font-mono flex items-center gap-1 transition-colors"
          title="Copy full hash"
        >
          {copiedHash ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span className="text-[11px]">{copiedHash ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      {/* Actions Grid: Download & File Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Step 1: Download Episode (For guest or re-download) */}
        <div className="p-4 rounded-xl bg-void-900/60 border border-void-700/60 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center gap-2 font-semibold text-white text-sm">
              <Download className="w-4 h-4 text-pink-400" />
              <span>Step 1: Download Episode</span>
            </div>
            <p className="text-xs text-ink-muted mt-1 leading-relaxed">
              Download the episode to your Mac. Range-requests allow pausing and resuming.
            </p>
          </div>
          <a
            href={downloadUrl}
            download={episode.filename}
            className="w-full inline-flex items-center justify-center font-medium rounded-xl text-sm px-4 py-2.5 gap-2 bg-void-800 hover:bg-void-700 text-white border border-void-600 transition-all shadow-sm active:scale-[0.98]"
          >
            <Download className="w-4 h-4 text-pink-400" />
            <span>Download ({formatBytes(episode.file_size_bytes)})</span>
          </a>
        </div>

        {/* Step 2: Select Local File & Verify */}
        <div className="p-4 rounded-xl bg-void-900/60 border border-void-700/60 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center gap-2 font-semibold text-white text-sm">
              <FolderOpen className="w-4 h-4 text-cyan-400" />
              <span>Step 2: Select Local File</span>
            </div>
            <p className="text-xs text-ink-muted mt-1 leading-relaxed">
              Select your downloaded video file. A background Web Worker will verify its SHA-256.
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/x-matroska,video/webm"
            className="hidden"
            onChange={handleFileSelected}
            disabled={isHashing}
          />

          <Button
            variant={isVerified ? 'secondary' : 'primary'}
            size="md"
            disabled={isHashing}
            leftIcon={isHashing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4" />}
            onClick={() => fileInputRef.current?.click()}
          >
            {isHashing
              ? 'Verifying...'
              : isVerified
              ? 'Re-verify Local File'
              : selectedFileName
              ? 'Change Selected File'
              : 'Select File to Verify'}
          </Button>
        </div>
      </div>

      {/* Web Worker Hashing Progress Bar */}
      {isHashing && (
        <div className="p-4 rounded-xl bg-void-900 border border-cyan-800/80 space-y-2 animate-in fade-in">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="flex items-center gap-2 text-cyan-300 font-semibold">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Streaming SHA-256 Checksum Calculation...</span>
            </span>
            <span className="text-cyan-400 font-bold">{progress}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-void-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-violet-500 rounded-full transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] font-mono text-ink-dim">
            <span>{formatBytes(processedBytes)} processed</span>
            <span>{formatBytes(totalBytes)} total</span>
          </div>
        </div>
      )}

      {/* Verification Results Status Banner */}
      {isVerified && !isHashing && (
        <div className="p-4 rounded-xl bg-emerald-950/70 border border-emerald-800 text-emerald-300 text-xs flex items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <p className="font-semibold text-white">File Verified Successfully!</p>
              <p className="text-[11px] text-emerald-300/80">
                Your local file matches the server's SHA-256 hash byte-for-byte. You are ready to watch!
              </p>
            </div>
          </div>
          {selectedFileName && (
            <span className="hidden sm:inline-flex items-center gap-1 font-mono text-[11px] text-emerald-400 bg-emerald-900/40 px-2 py-1 rounded">
              <FileVideo className="w-3 h-3" />
              <span className="truncate max-w-[140px]">{selectedFileName}</span>
            </span>
          )}
        </div>
      )}

      {isFailed && !isHashing && (
        <div className="p-4 rounded-xl bg-rose-950/70 border border-rose-800 text-rose-300 text-xs flex items-start gap-3 shadow-lg">
          <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-white">Verification Failed: Checksum Mismatch</p>
            <p className="text-[11px] text-rose-300/80 leading-relaxed">
              {verificationFeedback.message || 'The selected file is not identical to the host file.'} Please make sure you selected the exact downloaded file without re-encoding or editing.
            </p>
          </div>
        </div>
      )}

      {hashError && !isHashing && (
        <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-800 text-amber-300 text-xs">
          {hashError}
        </div>
      )}
    </Card>
  );
};


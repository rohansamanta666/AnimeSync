import React, { useState, useRef } from 'react';
import { Upload, X, Film, AlertCircle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { api, ChunkUploadProgress } from '../../services/api';
import { RoomAuth, Episode } from '../../types';

interface EpisodeUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  auth: RoomAuth;
  onEpisodeUploaded: (episode: Episode) => void;
}

export const EpisodeUploadModal: React.FC<EpisodeUploadModalProps> = ({
  isOpen,
  onClose,
  auth,
  onEpisodeUploaded,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [animeTitle, setAnimeTitle] = useState('');
  const [season, setSeason] = useState(1);
  const [episodeNumber, setEpisodeNumber] = useState(1);
  const [displayTitle, setDisplayTitle] = useState('');

  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<ChunkUploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError(null);

    // Try to guess title from filename (e.g., "[Sub] Frieren S01E04.mp4")
    const cleanName = selectedFile.name.replace(/\.[^/.]+$/, '');
    if (!animeTitle) {
      setAnimeTitle(cleanName);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a video file to upload');
      return;
    }
    if (!animeTitle.trim()) {
      setError('Please enter the anime title');
      return;
    }

    setIsUploading(true);
    setError(null);
    abortControllerRef.current = new AbortController();

    try {
      const episode = await api.uploadEpisodeChunked(
        file,
        {
          roomId: auth.room.id,
          animeTitle: animeTitle.trim(),
          season,
          episodeNumber,
          displayTitle: displayTitle.trim() || undefined,
        },
        {
          participantId: auth.participant_id,
          sessionToken: auth.session_token,
        },
        (p) => setProgress(p),
        abortControllerRef.current.signal
      );

      onEpisodeUploaded(episode);
      handleClose();
    } catch (err: any) {
      if (err.message !== 'Upload aborted by user') {
        setError(err.message || 'Failed to upload episode chunks');
      }
    } finally {
      setIsUploading(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancelUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsUploading(false);
    setProgress(null);
  };

  const handleClose = () => {
    if (isUploading) {
      handleCancelUpload();
    }
    setFile(null);
    setAnimeTitle('');
    setSeason(1);
    setEpisodeNumber(1);
    setDisplayTitle('');
    setProgress(null);
    setError(null);
    onClose();
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Upload Anime Episode"
      description="Upload an episode to your host Mac. It will be transferred in 5MB chunks and verified with SHA-256."
      maxWidth="lg"
    >
      <form onSubmit={handleUpload} className="space-y-4">
        {/* File Picker Area */}
        <div
          onClick={() => !isUploading && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all duration-200 ${
            file
              ? 'border-violet-500/80 bg-violet-950/20'
              : 'border-void-600 hover:border-void-500 bg-void-900/60'
          } ${isUploading ? 'opacity-70 pointer-events-none' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/x-matroska,video/webm"
            className="hidden"
            onChange={handleFileChange}
            disabled={isUploading}
          />
          {file ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-left">
                <div className="w-10 h-10 rounded-xl bg-violet-900/40 border border-violet-700/60 flex items-center justify-center text-violet-400">
                  <Film className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white truncate max-w-sm">{file.name}</p>
                  <p className="text-xs font-mono text-ink-muted">{formatBytes(file.size)}</p>
                </div>
              </div>
              {!isUploading && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                  className="p-1 rounded-lg hover:bg-void-700 text-ink-dim hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-void-800 border border-void-600 flex items-center justify-center mx-auto text-violet-400">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Click to select video file</p>
                <p className="text-xs text-ink-muted mt-0.5">MP4 (H.264), MKV, or WebM • 5MB chunked transfer</p>
              </div>
            </div>
          )}
        </div>

        {/* Metadata Inputs */}
        <div className="space-y-3">
          <Input
            label="Anime Title"
            placeholder="e.g. Frieren: Beyond Journey's End"
            value={animeTitle}
            onChange={(e) => setAnimeTitle(e.target.value)}
            disabled={isUploading}
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Season"
              type="number"
              min={1}
              value={season}
              onChange={(e) => setSeason(parseInt(e.target.value) || 1)}
              disabled={isUploading}
              required
            />
            <Input
              label="Episode Number"
              type="number"
              min={1}
              value={episodeNumber}
              onChange={(e) => setEpisodeNumber(parseInt(e.target.value) || 1)}
              disabled={isUploading}
              required
            />
          </div>

          <Input
            label="Episode Title (Optional)"
            placeholder="e.g. The End of the Journey"
            value={displayTitle}
            onChange={(e) => setDisplayTitle(e.target.value)}
            disabled={isUploading}
          />
        </div>

        {/* Progress Display */}
        {isUploading && progress && (
          <div className="p-4 rounded-xl bg-void-900 border border-void-700 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-ink-muted">
                Uploading Chunk {progress.currentChunk} of {progress.totalChunks}
              </span>
              <span className="text-violet-400 font-semibold">{progress.percentage}%</span>
            </div>
            {/* Progress bar */}
            <div className="w-full h-2 rounded-full bg-void-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-600 to-pink-500 rounded-full transition-all duration-200"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] font-mono text-ink-dim">
              <span>{formatBytes(progress.uploadedBytes)} uploaded</span>
              <span>{formatBytes(progress.totalBytes)}</span>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2.5 pt-2">
          {isUploading ? (
            <Button variant="danger" type="button" onClick={handleCancelUpload}>
              Cancel Upload
            </Button>
          ) : (
            <>
              <Button variant="ghost" type="button" onClick={handleClose}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={!file} leftIcon={<Upload className="w-4 h-4" />}>
                Upload Episode
              </Button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
};

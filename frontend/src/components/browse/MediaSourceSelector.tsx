import React, { useState, useEffect } from 'react';
import { Link2, Play, Download, Users, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../../services/api';
import { Button } from '../common/Button';
import { Card } from '../common/Card';

export interface MediaSourceSelectorProps {
  animeTitle: string;
  episodeNumber: number;
  initialStreamUrl?: string | null;
  initialSubtitleUrl?: string | null;
  onLoadSource: (streamUrl: string, subtitleUrl: string | null, format: string) => void;
  onDownloadSource: (streamUrl: string) => Promise<void>;
  onWatchTogether: (streamUrl: string, subtitleUrl: string | null, hostName: string) => Promise<void>;
  activeStreamUrl: string | null;
}

export const MediaSourceSelector: React.FC<MediaSourceSelectorProps> = ({
  initialStreamUrl = '',
  initialSubtitleUrl = '',
  onLoadSource,
  onDownloadSource,
  onWatchTogether,
  activeStreamUrl,
}) => {
  const [streamUrl, setStreamUrl] = useState(initialStreamUrl || '');
  const [subtitleUrl, setSubtitleUrl] = useState(initialSubtitleUrl || '');
  const [audioTrack, setAudioTrack] = useState<'sub' | 'dub'>('sub');
  const [hostName, setHostName] = useState('Host');

  const [isValidating, setIsValidating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<string | null>(null);
  const [isDownloadable, setIsDownloadable] = useState(false);

  useEffect(() => {
    setStreamUrl(initialStreamUrl || '');
    setSubtitleUrl(initialSubtitleUrl || '');
    setErrorMsg(null);
    if (initialStreamUrl) {
      const lower = initialStreamUrl.toLowerCase();
      const fmt = lower.includes('.m3u8') ? 'hls' : lower.endsWith('.webm') ? 'webm' : 'mp4';
      setDetectedFormat(fmt);
      setIsDownloadable(fmt !== 'hls');
    } else {
      setDetectedFormat(null);
      setIsDownloadable(false);
    }
  }, [initialStreamUrl, initialSubtitleUrl]);

  const validateAndLoad = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!streamUrl.trim()) {
      setErrorMsg('Enter an authorized direct MP4/WebM or HLS (.m3u8) URL.');
      return;
    }

    setIsValidating(true);
    try {
      const res = await api.validateMediaSource(
        streamUrl.trim(),
        subtitleUrl.trim() || null,
        audioTrack
      );
      setDetectedFormat(res.format);
      setIsDownloadable(res.downloadable);
      onLoadSource(res.stream_url, res.subtitle_url || null, res.format);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Invalid media source URL');
    } finally {
      setIsValidating(false);
    }
  };

  const handleDownloadClick = async () => {
    if (!activeStreamUrl) return;
    setErrorMsg(null);
    setIsDownloading(true);
    try {
      await onDownloadSource(activeStreamUrl);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to start download');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleWatchTogetherClick = async () => {
    if (!activeStreamUrl) return;
    setErrorMsg(null);
    setIsCreatingRoom(true);
    try {
      await onWatchTogether(activeStreamUrl, subtitleUrl.trim() || null, hostName.trim() || 'Host');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to launch Watch Together room');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Link2 className="w-4 h-4 text-violet-400" />
          Authorized Media Source
        </h2>

        <div className="flex items-center gap-2">
          {/* Subbed / Dubbed Selector */}
          <div className="inline-flex rounded-lg bg-void-950 border border-void-700 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setAudioTrack('sub')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                audioTrack === 'sub' ? 'bg-violet-600 text-white' : 'text-ink-muted hover:text-white'
              }`}
            >
              SUB
            </button>
            <button
              type="button"
              onClick={() => setAudioTrack('dub')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                audioTrack === 'dub' ? 'bg-violet-600 text-white' : 'text-ink-muted hover:text-white'
              }`}
            >
              DUB
            </button>
          </div>

          {activeStreamUrl && (
            <span className="text-xs text-emerald-400 flex items-center gap-1 font-mono">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {detectedFormat ? detectedFormat.toUpperCase() : 'LOADED'}
            </span>
          )}
        </div>
      </div>

      <form onSubmit={validateAndLoad} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-ink-muted mb-1">
              Media URL (.mp4, .webm, or authorized .m3u8)
            </label>
            <input
              type="url"
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              placeholder="https://example.com/video.mp4"
              className="w-full px-3 py-1.5 rounded-lg bg-void-950 border border-void-700 text-xs text-white placeholder-ink-dim focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="block text-[11px] text-ink-muted mb-1">
              Optional Subtitle URL (.vtt / .srt)
            </label>
            <input
              type="url"
              value={subtitleUrl}
              onChange={(e) => setSubtitleUrl(e.target.value)}
              placeholder="https://example.com/subtitles.vtt"
              className="w-full px-3 py-1.5 rounded-lg bg-void-950 border border-void-700 text-xs text-white placeholder-ink-dim focus:outline-none focus:border-violet-500"
            />
          </div>
        </div>

        {errorMsg && (
          <p className="text-xs text-rose-400 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {errorMsg}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              leftIcon={<Play className="w-3.5 h-3.5" />}
              isLoading={isValidating}
            >
              Load Source
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<Download className="w-3.5 h-3.5" />}
              onClick={handleDownloadClick}
              isLoading={isDownloading}
              disabled={!activeStreamUrl || !isDownloadable}
              title={
                !isDownloadable
                  ? 'Direct MP4/WebM URLs can be downloaded; HLS playlists (.m3u8) are stream-only.'
                  : 'Download episode to local storage with SHA-256 verification'
              }
            >
              Download Episode
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              placeholder="Host name"
              maxLength={24}
              className="w-28 px-2.5 py-1.5 rounded-lg bg-void-950 border border-void-700 text-xs text-white focus:outline-none focus:border-violet-500"
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              leftIcon={<Users className="w-3.5 h-3.5" />}
              onClick={handleWatchTogetherClick}
              isLoading={isCreatingRoom}
              disabled={!activeStreamUrl}
            >
              Watch Together
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
};

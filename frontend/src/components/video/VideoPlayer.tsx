/**
 * VideoPlayer — Phase 5 Task 5.1
 *
 * Custom HTML5 video player component loading local `File` via `URL.createObjectURL(file)`.
 *
 * Features:
 * - Direct local file playback (zero server bandwidth)
 * - Automatic URL.revokeObjectURL cleanup to prevent memory leaks
 * - Japanese-inspired dark mode controls overlay with auto-hide on inactivity
 * - Custom scrubber timeline, volume slider, playback speed selector (0.5x - 2.0x)
 * - Fullscreen toggle with native Fullscreen API
 * - Keyboard shortcuts: Space (play/pause), Arrows (seek/vol), F (fullscreen), M (mute)
 * - Codec error detection with graceful fallback guidance
 * - Exposes imperative handle (VideoPlayerHandle) for sync engine integration (Tasks 5.2-5.4)
 */
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  Play,
  Pause,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  FolderOpen,
  Film,
  AlertCircle,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '../common/Button';

export interface VideoPlayerHandle {
  play: () => Promise<void>;
  pause: () => void;
  seek: (seconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  isPaused: () => boolean;
  getVideoElement: () => HTMLVideoElement | null;
}

export interface VideoPlayerProps {
  /** The verified local File chosen by the user */
  file: File | null;
  /** Anime title for display */
  animeTitle?: string;
  /** Episode number for display */
  episodeNumber?: number;
  /** Optional file selection callback if chosen directly on player stage */
  onFileSelect?: (file: File) => void;
  /** Playback event callbacks */
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (time: number) => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onPlaybackRateChange?: (rate: number) => void;
  onWaiting?: () => void;
  onPlaying?: () => void;
  onEnded?: () => void;
  /** Phase 5 Task 5.5: Buffering detection callbacks & remote participants */
  onBufferingStart?: () => void;
  onBufferingEnd?: () => void;
  bufferingParticipants?: string[];
  /** Custom outer container class */
  className?: string;
}

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  const paddedSecs = secs.toString().padStart(2, '0');
  if (hrs > 0) {
    const paddedMins = mins.toString().padStart(2, '0');
    return `${hrs}:${paddedMins}:${paddedSecs}`;
  }
  return `${mins}:${paddedSecs}`;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  (
    {
      file,
      animeTitle = 'Anime Episode',
      episodeNumber,
      onFileSelect,
      onPlay,
      onPause,
      onSeek,
      onTimeUpdate,
      onPlaybackRateChange,
      onWaiting,
      onPlaying,
      onEnded,
      onBufferingStart,
      onBufferingEnd,
      bufferingParticipants,
      className = '',
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Remote update flag preventing programmatic updates from triggering user event callbacks
    const isRemoteActionRef = useRef<boolean>(false);

    // Player state
    const [videoSrc, setVideoSrc] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [bufferedEnd, setBufferedEnd] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [playbackRate, setPlaybackRateState] = useState(1.0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [controlsVisible, setControlsVisible] = useState(true);
    const [isBuffering, setIsBuffering] = useState(false);
    const [codecError, setCodecError] = useState<string | null>(null);
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    const [actionIndicator, setActionIndicator] = useState<'play' | 'pause' | null>(null);

    // 1. Create and revoke object URL safely
    useEffect(() => {
      if (!file) {
        setVideoSrc(null);
        setCodecError(null);
        setCurrentTime(0);
        setDuration(0);
        return;
      }

      setCodecError(null);
      const url = URL.createObjectURL(file);
      setVideoSrc(url);

      return () => {
        URL.revokeObjectURL(url);
      };
    }, [file]);

    // 2. Fullscreen change listener
    useEffect(() => {
      const handleFullscreenChange = () => {
        setIsFullscreen(!!document.fullscreenElement);
      };
      document.addEventListener('fullscreenchange', handleFullscreenChange);
      return () => {
        document.removeEventListener('fullscreenchange', handleFullscreenChange);
      };
    }, []);

    // 3. Auto-hide controls logic
    const resetHideTimer = useCallback(() => {
      setControlsVisible(true);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      if (isPlaying) {
        hideTimeoutRef.current = setTimeout(() => {
          setControlsVisible(false);
          setShowSpeedMenu(false);
        }, 2500);
      }
    }, [isPlaying]);

    useEffect(() => {
      if (!isPlaying) {
        setControlsVisible(true);
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current);
        }
      } else {
        resetHideTimer();
      }
      return () => {
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current);
        }
      };
    }, [isPlaying, resetHideTimer]);

    // 4. Imperative handle for Phase 5 sync engine
    useImperativeHandle(
      ref,
      () => ({
        play: async () => {
          if (videoRef.current) {
            isRemoteActionRef.current = true;
            try {
              await videoRef.current.play();
            } finally {
              setTimeout(() => {
                isRemoteActionRef.current = false;
              }, 120);
            }
          }
        },
        pause: () => {
          if (videoRef.current) {
            isRemoteActionRef.current = true;
            try {
              videoRef.current.pause();
            } finally {
              setTimeout(() => {
                isRemoteActionRef.current = false;
              }, 120);
            }
          }
        },
        seek: (seconds: number) => {
          if (videoRef.current) {
            isRemoteActionRef.current = true;
            const targetTime = Math.max(0, Math.min(seconds, duration || seconds));
            videoRef.current.currentTime = targetTime;
            setCurrentTime(targetTime);
            setTimeout(() => {
              isRemoteActionRef.current = false;
            }, 120);
          }
        },
        setPlaybackRate: (rate: number) => {
          if (videoRef.current) {
            isRemoteActionRef.current = true;
            videoRef.current.playbackRate = rate;
            setPlaybackRateState(rate);
            setTimeout(() => {
              isRemoteActionRef.current = false;
            }, 120);
          }
        },
        getCurrentTime: () => videoRef.current?.currentTime || 0,
        getDuration: () => videoRef.current?.duration || 0,
        isPaused: () => videoRef.current?.paused ?? true,
        getVideoElement: () => videoRef.current,
      }),
      [duration]
    );

    // 5. Actions
    const flashIndicator = (type: 'play' | 'pause') => {
      setActionIndicator(type);
      setTimeout(() => setActionIndicator(null), 600);
    };

    const togglePlay = useCallback(() => {
      const video = videoRef.current;
      if (!video) return;

      if (video.paused) {
        video.play().catch((err) => {
          console.warn('Playback initiation failed:', err);
        });
        flashIndicator('play');
      } else {
        video.pause();
        flashIndicator('pause');
      }
    }, []);

    const handleSeek = (newTime: number) => {
      const video = videoRef.current;
      if (!video) return;
      const targetTime = Math.max(0, Math.min(newTime, duration));
      video.currentTime = targetTime;
      setCurrentTime(targetTime);
      if (!isRemoteActionRef.current) {
        onSeek?.(targetTime);
      }
    };

    const handleVolumeChange = (newVol: number) => {
      const video = videoRef.current;
      if (!video) return;
      const clamped = Math.max(0, Math.min(1, newVol));
      video.volume = clamped;
      setVolume(clamped);
      if (clamped > 0 && isMuted) {
        video.muted = false;
        setIsMuted(false);
      }
    };

    const toggleMute = () => {
      const video = videoRef.current;
      if (!video) return;
      const nextMute = !video.muted;
      video.muted = nextMute;
      setIsMuted(nextMute);
    };

    const setSpeed = (rate: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.playbackRate = rate;
      setPlaybackRateState(rate);
      setShowSpeedMenu(false);
      if (!isRemoteActionRef.current) {
        onPlaybackRateChange?.(rate);
      }
    };

    const toggleFullscreen = async () => {
      const container = containerRef.current;
      if (!container) return;

      try {
        if (!document.fullscreenElement) {
          await container.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch (err) {
        console.warn('Fullscreen toggle error:', err);
      }
    };

    // 6. Keyboard shortcuts
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        // Prevent default for video control keys
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

        switch (e.code) {
          case 'Space':
            e.preventDefault();
            togglePlay();
            break;
          case 'ArrowLeft':
            e.preventDefault();
            handleSeek(currentTime - 5);
            break;
          case 'ArrowRight':
            e.preventDefault();
            handleSeek(currentTime + 5);
            break;
          case 'ArrowUp':
            e.preventDefault();
            handleVolumeChange(volume + 0.1);
            break;
          case 'ArrowDown':
            e.preventDefault();
            handleVolumeChange(volume - 0.1);
            break;
          case 'KeyM':
            e.preventDefault();
            toggleMute();
            break;
          case 'KeyF':
            e.preventDefault();
            toggleFullscreen();
            break;
          default:
            break;
        }
      },
      [togglePlay, currentTime, volume, duration]
    );

    // 7. Progress scrubber click / drag
    const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newTime = parseFloat(e.target.value);
      handleSeek(newTime);
    };

    // 8. Native video event handlers
    const handleTimeUpdate = () => {
      const video = videoRef.current;
      if (!video) return;
      setCurrentTime(video.currentTime);

      if (video.buffered.length > 0) {
        const end = video.buffered.end(video.buffered.length - 1);
        setBufferedEnd(end);
      }

      onTimeUpdate?.(video.currentTime, video.duration || 0);
    };

    const handleLoadedMetadata = () => {
      const video = videoRef.current;
      if (!video) return;
      setDuration(video.duration || 0);
      setIsBuffering(false);
    };

    const handleVideoError = () => {
      const video = videoRef.current;
      const error = video?.error;
      let msg = 'Failed to load or decode the video file.';
      if (error) {
        if (error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          msg =
            'Browser cannot decode this video format or codec. If this is an MKV file, please consider using an MP4 (H.264/AAC) file or WebM for HTML5 browser compatibility.';
        } else if (error.code === MediaError.MEDIA_ERR_DECODE) {
          msg = 'Video decoding error. The media may be corrupted or use unsupported parameters.';
        }
      }
      setCodecError(msg);
      setIsBuffering(false);
    };

    // If no file is loaded yet, display friendly local file picker stage
    if (!file || !videoSrc) {
      return (
        <div
          className={`aspect-video bg-void-950 flex flex-col items-center justify-center p-8 text-center relative group border border-void-700/60 rounded-2xl overflow-hidden ${className}`}
        >
          <div className="w-16 h-16 rounded-2xl bg-void-800/80 border border-void-600/80 flex items-center justify-center mb-4 shadow-xl">
            <Film className="w-8 h-8 text-violet-400" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">{animeTitle}</h3>
          {episodeNumber !== undefined && (
            <span className="text-xs font-mono text-ink-muted mb-2">Episode {episodeNumber}</span>
          )}
          <p className="text-xs text-ink-muted max-w-md mb-5">
            Select your verified local video file to load the HTML5 player. Video streams directly
            from your Mac disk with zero server bandwidth.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,.mkv,.mp4,.webm"
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (selected && onFileSelect) {
                onFileSelect(selected);
              }
            }}
          />

          <Button
            variant="primary"
            size="sm"
            leftIcon={<FolderOpen className="w-4 h-4" />}
            onClick={() => fileInputRef.current?.click()}
          >
            Select Local Video File
          </Button>
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onMouseMove={resetHideTimer}
        onMouseLeave={() => {
          if (isPlaying) {
            setControlsVisible(false);
            setShowSpeedMenu(false);
          }
        }}
        className={`relative aspect-video bg-black rounded-2xl overflow-hidden select-none outline-none group border border-void-700/60 shadow-2xl ${className}`}
      >
        {/* HTML5 Video Element */}
        <video
          ref={videoRef}
          src={videoSrc}
          className="w-full h-full object-contain cursor-pointer"
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          onPlay={() => {
            setIsPlaying(true);
            setIsBuffering(false);
            if (!isRemoteActionRef.current) {
              onPlay?.();
            }
          }}
          onPause={() => {
            setIsPlaying(false);
            if (!isRemoteActionRef.current) {
              onPause?.();
            }
          }}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onWaiting={() => {
            setIsBuffering(true);
            onWaiting?.();
            onBufferingStart?.();
          }}
          onStalled={() => {
            setIsBuffering(true);
            onBufferingStart?.();
          }}
          onCanPlay={() => {
            setIsBuffering(false);
            onBufferingEnd?.();
          }}
          onPlaying={() => {
            setIsBuffering(false);
            onPlaying?.();
            onBufferingEnd?.();
          }}
          onEnded={() => {
            setIsPlaying(false);
            onEnded?.();
          }}
          onError={handleVideoError}
          playsInline
        />

        {/* Buffering spinner overlay */}
        {(isBuffering || (bufferingParticipants && bufferingParticipants.length > 0)) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none bg-black/60 backdrop-blur-sm z-20 transition-all">
            <div className="w-14 h-14 rounded-full border-3 border-violet-500 border-t-transparent animate-spin mb-3 shadow-lg" />
            <div className="text-center px-4 py-2 rounded-xl bg-void-950/80 border border-void-700/80 shadow-2xl">
              <p className="text-xs font-mono font-bold text-violet-300">
                {bufferingParticipants && bufferingParticipants.length > 0
                  ? `Buffering: ${bufferingParticipants.join(', ')}`
                  : 'Buffering video...'}
              </p>
              <p className="text-[10px] font-mono text-ink-muted mt-0.5">
                Playback will resume automatically once all viewers are ready
              </p>
            </div>
          </div>
        )}

        {/* Central Click / Space Action Flash Indicator */}
        {actionIndicator && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="w-20 h-20 rounded-full bg-void-950/80 border border-violet-500/50 flex items-center justify-center animate-ping duration-300">
              {actionIndicator === 'play' ? (
                <Play className="w-8 h-8 text-violet-400 fill-violet-400 ml-1" />
              ) : (
                <Pause className="w-8 h-8 text-violet-400 fill-violet-400" />
              )}
            </div>
          </div>
        )}

        {/* Codec Error Banner */}
        {codecError && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 bg-void-950/95 backdrop-blur-md text-center">
            <div className="w-12 h-12 rounded-full bg-rose-950/80 border border-rose-800 flex items-center justify-center mb-3 text-rose-400">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-white mb-2">Video Playback Error</h4>
            <p className="text-xs text-ink-muted max-w-md mb-4 leading-relaxed">{codecError}</p>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<FolderOpen className="w-4 h-4" />}
              onClick={() => fileInputRef.current?.click()}
            >
              Select Another File
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,.mkv,.mp4,.webm"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected && onFileSelect) {
                  onFileSelect(selected);
                }
              }}
            />
          </div>
        )}

        {/* Top Header Overlay Bar (Auto-hides) */}
        <div
          className={`absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between transition-opacity duration-300 z-10 ${
            controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white tracking-wide">{animeTitle}</span>
            {episodeNumber !== undefined && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-950/80 text-violet-300 border border-violet-800/80">
                EP {episodeNumber}
              </span>
            )}
            <span className="text-[10px] font-mono text-ink-dim truncate max-w-xs">
              • {file.name}
            </span>
          </div>
        </div>

        {/* Bottom Custom Controls Overlay (Auto-hides) */}
        <div
          className={`absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex flex-col gap-2 transition-opacity duration-300 z-10 ${
            controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Progress Scrubber Bar */}
          <div className="relative group/scrubber flex items-center h-4 cursor-pointer">
            {/* Background track */}
            <div className="absolute inset-x-0 h-1 rounded-full bg-void-700/80 group-hover/scrubber:h-1.5 transition-all overflow-hidden">
              {/* Buffered track */}
              <div
                className="h-full bg-void-500/50"
                style={{ width: `${duration > 0 ? (bufferedEnd / duration) * 100 : 0}%` }}
              />
            </div>

            {/* Played progress track */}
            <div
              className="absolute left-0 h-1 rounded-full bg-gradient-to-r from-violet-500 to-pink-500 group-hover/scrubber:h-1.5 transition-all"
              style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
            />

            {/* Input range overlay for smooth interaction */}
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleScrubberChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />

            {/* Scrubber thumb handle */}
            <div
              className="absolute w-3 h-3 rounded-full bg-white shadow-lg pointer-events-none transform -translate-x-1/2 scale-0 group-hover/scrubber:scale-100 transition-transform"
              style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
            />
          </div>

          {/* Lower controls bar: Play, Seek, Time, Volume, Speed, Fullscreen */}
          <div className="flex items-center justify-between text-white text-xs">
            {/* Left group: Play/Pause, Seek buttons, Time */}
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-colors"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              <button
                onClick={() => handleSeek(currentTime - 10)}
                className="p-1 rounded-lg hover:bg-white/10 text-ink-muted hover:text-white transition-colors"
                title="Seek backward 10s (Left Arrow)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => handleSeek(currentTime + 10)}
                className="p-1 rounded-lg hover:bg-white/10 text-ink-muted hover:text-white transition-colors"
                title="Seek forward 10s (Right Arrow)"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>

              {/* Timestamp display */}
              <div className="font-mono text-[11px] text-ink-muted ml-1">
                <span className="text-white font-medium">{formatTime(currentTime)}</span>
                <span className="mx-1 text-ink-dim">/</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Right group: Volume, Speed, Fullscreen */}
            <div className="flex items-center gap-3">
              {/* Volume Slider & Mute Toggle */}
              <div className="flex items-center gap-1.5 group/vol">
                <button
                  onClick={toggleMute}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-colors"
                  title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>

                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="w-16 h-1 bg-void-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                  title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
                />
              </div>

              {/* Speed Selector */}
              <div className="relative">
                <button
                  onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                  className="px-2 py-1 rounded-lg hover:bg-white/10 text-xs font-mono font-medium text-white transition-colors flex items-center gap-1"
                  title="Playback Speed"
                >
                  <SlidersHorizontal className="w-3 h-3 text-violet-400" />
                  <span>{playbackRate}x</span>
                </button>

                {showSpeedMenu && (
                  <div className="absolute bottom-8 right-0 bg-void-900 border border-void-700 rounded-xl p-1 shadow-2xl flex flex-col gap-0.5 z-30 min-w-[70px]">
                    {SPEED_OPTIONS.map((rate) => (
                      <button
                        key={rate}
                        onClick={() => setSpeed(rate)}
                        className={`px-2.5 py-1 text-left text-xs font-mono rounded-lg transition-colors ${
                          playbackRate === rate
                            ? 'bg-violet-600 text-white font-bold'
                            : 'text-ink-muted hover:text-white hover:bg-void-800'
                        }`}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Fullscreen Button */}
              <button
                onClick={toggleFullscreen}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-colors"
                title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

VideoPlayer.displayName = 'VideoPlayer';

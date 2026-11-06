/**
 * Subtitles Service — Phase 8 Task 8.5
 *
 * Client-side parser and synchronization engine for external `.srt` and `.vtt` subtitle files.
 *
 * Features:
 * - Robust parsing of SubRip (.srt) and WebVTT (.vtt) files
 * - Support for multi-line dialogue, formatted tags (stripped for clean display), and variable timestamp formats
 * - Error-tolerant: malformed cues or garbage content are ignored without throwing
 * - Active cue lookup with microsecond precision
 * - Subtitle appearance customization (font size, text color, background opacity, text shadow)
 */

export interface SubtitleCue {
  id: string | number;
  startTime: number; // in seconds
  endTime: number;   // in seconds
  text: string;
}

export interface SubtitleSettings {
  enabled: boolean;
  fontSize: number;          // 16, 20, 24, 28, 32
  textColor: string;         // e.g. '#ffffff', '#ffff00', '#00ffff'
  backgroundColor: string;    // e.g. 'transparent', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.8)'
  textShadow: boolean;
  bottomOffsetPercent: number; // percentage from bottom, default 8%
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  enabled: true,
  fontSize: 24,
  textColor: '#FFFFFF',
  backgroundColor: 'rgba(0, 0, 0, 0.65)',
  textShadow: true,
  bottomOffsetPercent: 8,
};

/**
 * Parses timestamp string into seconds.
 * Supports:
 * - 00:01:23,456 (SRT)
 * - 00:01:23.456 (VTT)
 * - 01:23.456 (VTT short format)
 */
export function parseTimestamp(timeStr: string): number | null {
  if (!timeStr) return null;
  const clean = timeStr.trim().replace(',', '.');
  const parts = clean.split(':');

  if (parts.length === 3) {
    const hours = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const seconds = parseFloat(parts[2]);
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return null;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]);
    const seconds = parseFloat(parts[1]);
    if (isNaN(minutes) || isNaN(seconds)) return null;
    return minutes * 60 + seconds;
  }
  return null;
}

/**
 * Cleans cue text: removes HTML/formatting tags like <i>, <b>, <c.color>, but preserves text content.
 */
export function cleanSubtitleText(rawText: string): string {
  if (!rawText) return '';
  return rawText
    .replace(/<[^>]*>/g, '') // remove HTML tags
    .replace(/\{[^}]*\}/g, '') // remove ASS/SSA tags like {\an8}
    .trim();
}

/**
 * Parses SRT (SubRip) text into SubtitleCue items.
 */
export function parseSRT(content: string): SubtitleCue[] {
  if (!content) return [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    let timeLineIndex = 0;
    // Some SRTs have an index on line 0 (e.g. "1"), some omit it
    if (!lines[0].includes('-->') && lines.length >= 2 && lines[1].includes('-->')) {
      timeLineIndex = 1;
    } else if (!lines[0].includes('-->')) {
      continue;
    }

    const timeLine = lines[timeLineIndex];
    const match = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3}|\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3}|\d{2}:\d{2}[,\.]\d{1,3})/);
    if (!match) continue;

    const startTime = parseTimestamp(match[1]);
    const endTime = parseTimestamp(match[2]);
    if (startTime === null || endTime === null || endTime <= startTime) continue;

    const textLines = lines.slice(timeLineIndex + 1);
    const text = cleanSubtitleText(textLines.join('\n'));
    if (!text) continue;

    cues.push({
      id: cues.length + 1,
      startTime,
      endTime,
      text,
    });
  }

  return cues;
}

/**
 * Parses WebVTT (.vtt) text into SubtitleCue items.
 */
export function parseVTT(content: string): SubtitleCue[] {
  if (!content) return [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const cues: SubtitleCue[] = [];

  let i = 0;
  // Skip WEBVTT header line and optional notes/headers
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.includes('-->')) {
      const match = line.match(/(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3}|\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3}|\d{2}:\d{2}[,\.]\d{1,3})/);
      if (match) {
        const startTime = parseTimestamp(match[1]);
        const endTime = parseTimestamp(match[2]);

        if (startTime !== null && endTime !== null && endTime > startTime) {
          const textLines: string[] = [];
          i++;
          while (i < lines.length && lines[i].trim() !== '') {
            textLines.push(lines[i]);
            i++;
          }
          const text = cleanSubtitleText(textLines.join('\n'));
          if (text) {
            cues.push({
              id: cues.length + 1,
              startTime,
              endTime,
              text,
            });
          }
        }
      }
    }
    i++;
  }

  return cues;
}

/**
 * Auto-detects format (VTT or SRT) and parses subtitles.
 */
export function parseSubtitles(content: string, filename?: string): SubtitleCue[] {
  if (!content) return [];
  const lowerName = (filename || '').toLowerCase();

  if (lowerName.endsWith('.vtt') || content.trim().startsWith('WEBVTT')) {
    const vttCues = parseVTT(content);
    if (vttCues.length > 0) return vttCues;
  }

  // Fallback / default to SRT parser
  return parseSRT(content);
}

/**
 * Returns all subtitle cues active at the specified timestamp.
 */
export function findActiveCues(cues: SubtitleCue[], currentTime: number): SubtitleCue[] {
  if (!cues || cues.length === 0 || isNaN(currentTime) || currentTime < 0) return [];
  return cues.filter((cue) => cue.startTime <= currentTime && currentTime <= cue.endTime);
}


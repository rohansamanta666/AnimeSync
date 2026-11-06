/**
 * AnimeSync — WebRTC Configuration & Audio Helpers (Phase 7 Tasks 7.2 – 7.6)
 *
 * Provides:
 * - Free Google public STUN server configuration
 * - Audio constraints & device configuration
 * - Independent audio GainNode calculation (0% - 200%)
 * - Audio RMS amplitude detection for speaking indicators
 * - PTT input safety check
 */

/**
 * Free Google public STUN servers for NAT traversal.
 * Zero-cost compliant (no paid TURN services).
 */
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
};

/**
 * Audio capture constraints for speech optimization.
 */
export function getAudioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

/**
 * Maps a volume percentage (0% - 200%) to a Web Audio API Gain value (0.0 - 2.0).
 * 0% -> 0.0 (silent)
 * 100% -> 1.0 (nominal)
 * 200% -> 2.0 (boosted voice)
 */
export function volumeToGain(volumePercent: number): number {
  if (isNaN(volumePercent) || volumePercent <= 0) return 0.0;
  if (volumePercent >= 200) return 2.0;
  return Number((volumePercent / 100).toFixed(2));
}

/**
 * Computes root-mean-square (RMS) volume from Web Audio time-domain byte array.
 * Values typically range from 0.0 to 1.0.
 */
export function computeAudioRms(dataArray: Uint8Array): number {
  if (!dataArray || dataArray.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    // Normalizing byte value [0, 255] around 128 silence center
    const normalized = (dataArray[i] - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / dataArray.length);
}

/**
 * Checks whether an event target is an active text input element.
 * Prevents Push-to-Talk ('V') from triggering when the user is typing in chat or inputs.
 */
export function isTypingElement(target: EventTarget | null): boolean {
  if (!target) return false;
  if (typeof HTMLElement !== 'undefined' && !(target instanceof HTMLElement)) return false;
  const el = target as any;
  const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '';
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    Boolean(el.isContentEditable)
  );
}

/**
 * Client-side message sanitization before sending.
 */
export function sanitizeChatMessage(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/<[^>]*?>/g, '')
    .replace(/\0/g, '')
    .trim();
}

/**
 * AnimeSync — Adaptive Playback Drift Correction Engine (Phase 5 Task 5.4)
 *
 * Implements client-side drift measurement and tiered correction:
 * 1. Drift < 0.25s: Within tolerance -> do nothing (or restore intended rate if previously nudged).
 * 2. Drift [0.25s, 1.5s): Micro-drift -> temporarily adjust playback speed by ±5%.
 *    - Behind (drift < 0) -> +5% speed up (intendedRate * 1.05)
 *    - Ahead (drift > 0) -> -5% slow down (intendedRate * 0.95)
 * 3. Drift >= 1.5s: Macro-drift -> hard seek directly to authoritative position.
 * 4. Paused playback: No rate adjustments while paused.
 *
 * Authoritative Formula:
 *   authoritative_time = current_time + (is_playing ? elapsed * playback_speed : 0)
 *   drift = local_video.currentTime - authoritative_time
 */

export const DRIFT_TOLERANCE_SECONDS = 0.25;
export const DRIFT_HARD_SEEK_SECONDS = 1.5;
export const DRIFT_NUDGE_FACTOR = 0.05;
export const DRIFT_CHECK_INTERVAL_MS = 2000;
export const DRIFT_ACTION_COOLDOWN_MS = 1200;

export interface AuthoritativePlaybackSnapshot {
  isPlaying: boolean;
  currentTime: number;
  playbackSpeed: number;
  updatedAt: number;
  serverSequence?: number;
  localReceivedAt?: number;
}

export type DriftCorrectionAction =
  | 'NONE'
  | 'RESTORE_RATE'
  | 'NUDGE_FASTER'
  | 'NUDGE_SLOWER'
  | 'HARD_SEEK';

export interface DriftEvaluationResult {
  action: DriftCorrectionAction;
  driftSeconds: number;
  authoritativeTime: number;
  targetTime?: number;
  targetRate?: number;
}

export interface EvaluateDriftParams {
  snapshot: AuthoritativePlaybackSnapshot | null;
  localTime: number;
  nowSeconds?: number;
  intendedRate: number;
  isLocalPaused: boolean;
  isNudging: boolean;
}

/**
 * Computes the authoritative playback position at this instant.
 */
export function computeAuthoritativeTime(
  snapshot: AuthoritativePlaybackSnapshot,
  nowSeconds?: number
): number {
  if (!snapshot.isPlaying) {
    return Math.max(0, snapshot.currentTime);
  }

  let elapsed: number;
  if (nowSeconds !== undefined) {
    if (snapshot.localReceivedAt !== undefined) {
      elapsed = Math.max(0, nowSeconds - snapshot.localReceivedAt / 1000);
    } else {
      elapsed = Math.max(0, nowSeconds - snapshot.updatedAt);
    }
  } else if (snapshot.localReceivedAt !== undefined) {
    elapsed = Math.max(0, (Date.now() - snapshot.localReceivedAt) / 1000);
  } else {
    elapsed = Math.max(0, Date.now() / 1000 - snapshot.updatedAt);
  }

  return Math.max(0, snapshot.currentTime + elapsed * snapshot.playbackSpeed);
}

/**
 * Computes signed drift in seconds.
 * Negative drift: local player is behind authoritative position.
 * Positive drift: local player is ahead of authoritative position.
 */
export function computeDrift(localTime: number, authoritativeTime: number): number {
  return localTime - authoritativeTime;
}

/**
 * Evaluates the required drift correction based on tiered thresholds.
 */
export function evaluateDriftCorrection(params: EvaluateDriftParams): DriftEvaluationResult {
  const {
    snapshot,
    localTime,
    nowSeconds,
    intendedRate,
    isLocalPaused,
    isNudging,
  } = params;

  if (!snapshot) {
    return {
      action: 'NONE',
      driftSeconds: 0,
      authoritativeTime: localTime,
    };
  }

  // If paused either on server or locally, do not run rate nudging or seek
  if (!snapshot.isPlaying || isLocalPaused) {
    if (isNudging) {
      return {
        action: 'RESTORE_RATE',
        driftSeconds: 0,
        authoritativeTime: snapshot.currentTime,
        targetRate: intendedRate,
      };
    }
    return {
      action: 'NONE',
      driftSeconds: 0,
      authoritativeTime: snapshot.currentTime,
    };
  }

  const authTime = computeAuthoritativeTime(snapshot, nowSeconds);
  const drift = computeDrift(localTime, authTime);
  const absDrift = Math.abs(drift);

  // Tier 3: Macro-drift (>= 1.5s) -> Hard seek directly to authoritative position
  if (absDrift >= DRIFT_HARD_SEEK_SECONDS) {
    return {
      action: 'HARD_SEEK',
      driftSeconds: drift,
      authoritativeTime: authTime,
      targetTime: authTime,
      targetRate: intendedRate,
    };
  }

  // Tier 2: Micro-drift (0.25s to 1.5s) -> Temporary ±5% playback speed adjustment
  if (absDrift >= DRIFT_TOLERANCE_SECONDS) {
    if (drift < 0) {
      // Local video is behind authoritative position -> speed up by +5%
      const nudgedRate = Math.round(intendedRate * (1 + DRIFT_NUDGE_FACTOR) * 1000) / 1000;
      return {
        action: 'NUDGE_FASTER',
        driftSeconds: drift,
        authoritativeTime: authTime,
        targetRate: nudgedRate,
      };
    } else {
      // Local video is ahead of authoritative position -> slow down by -5%
      const nudgedRate = Math.round(intendedRate * (1 - DRIFT_NUDGE_FACTOR) * 1000) / 1000;
      return {
        action: 'NUDGE_SLOWER',
        driftSeconds: drift,
        authoritativeTime: authTime,
        targetRate: nudgedRate,
      };
    }
  }

  // Tier 1: Within tolerance (< 0.25s)
  if (isNudging) {
    // Re-aligned! Restore user's intended playback speed
    return {
      action: 'RESTORE_RATE',
      driftSeconds: drift,
      authoritativeTime: authTime,
      targetRate: intendedRate,
    };
  }

  return {
    action: 'NONE',
    driftSeconds: drift,
    authoritativeTime: authTime,
  };
}

// ---------------------------------------------------------------------------
// Phase 5 Task 5.6: Sync Health Status & Resync Helpers
// ---------------------------------------------------------------------------

export type SyncStatusState = 'SYNCED' | 'NUDGING' | 'BUFFERING' | 'PAUSED';

export interface DetermineSyncStatusParams {
  isRoomBuffering: boolean;
  isLocalBuffering?: boolean;
  isNudging: boolean;
  isPaused: boolean;
  driftSeconds: number;
}

/**
 * Determines high-level sync health status for UI badges and diagnostics.
 */
export function determineSyncStatus(params: DetermineSyncStatusParams): SyncStatusState {
  if (params.isRoomBuffering || params.isLocalBuffering) {
    return 'BUFFERING';
  }
  if (params.isNudging) {
    return 'NUDGING';
  }
  if (params.isPaused) {
    return 'PAUSED';
  }
  return 'SYNCED';
}

/**
 * Computes ping round-trip latency in milliseconds.
 */
export function computePingLatency(clientSendTime: number, clientReceiveTime: number): number {
  return Math.max(0, Math.round(clientReceiveTime - clientSendTime));
}

export interface ResyncTarget {
  targetTime: number;
  targetRate: number;
  isPlaying: boolean;
}

/**
 * Calculates authoritative alignment target for manual Resync.
 */
export function calculateResyncTarget(
  snapshot: AuthoritativePlaybackSnapshot,
  nowSeconds?: number
): ResyncTarget {
  const targetTime = computeAuthoritativeTime(snapshot, nowSeconds);
  return {
    targetTime,
    targetRate: snapshot.playbackSpeed || 1.0,
    isPlaying: snapshot.isPlaying,
  };
}


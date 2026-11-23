import { test } from 'node:test';
import assert from 'node:assert/strict';
import { determineSyncStatus } from '../src/services/drift.ts';

/**
 * Regression & Unit Tests for Playback & Buffering Fixes
 * 1. Problem 1: Buffering indicator filtering & non-blocking behavior
 * 2. Problem 2: Play synchronization and mobile autoplay policy resilience
 */

// Autoplay policy detection logic matching VideoPlayer.tsx
function isAutoplayRestriction(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  return name === 'NotAllowedError' || name === 'AbortError';
}

// Play action seek threshold logic matching useVideoSync.ts
function shouldSeekOnPlayAction(currentTime: number, targetTime: number, threshold: number = 0.4): boolean {
  if (typeof targetTime !== 'number' || isNaN(targetTime)) return false;
  return Math.abs(currentTime - targetTime) > threshold;
}

// Buffering trigger condition matching VideoPlayer.tsx
function isGenuineBuffering(isPaused: boolean, readyState: number): boolean {
  // If video is paused intentionally, never trigger buffering
  if (isPaused) return false;
  // readyState < 3 (HAVE_FUTURE_DATA) while attempting to play indicates real starvation
  return readyState < 3;
}

test('isAutoplayRestriction - detects mobile browser NotAllowedError', () => {
  const notAllowedErr = { name: 'NotAllowedError', message: 'play() failed because user gesture is required' };
  assert.equal(isAutoplayRestriction(notAllowedErr), true);
});

test('isAutoplayRestriction - detects browser AbortError from interrupted play', () => {
  const abortErr = { name: 'AbortError', message: 'The play() request was interrupted' };
  assert.equal(isAutoplayRestriction(abortErr), true);
});

test('isAutoplayRestriction - returns false for general media decoding or network errors', () => {
  const decodeErr = { name: 'MediaError', message: 'Decode failed' };
  assert.equal(isAutoplayRestriction(decodeErr), false);
  assert.equal(isAutoplayRestriction(null), false);
  assert.equal(isAutoplayRestriction('error string'), false);
});

test('shouldSeekOnPlayAction - avoids redundant seek when local player is already aligned within tolerance', () => {
  // Local player at 10.2s, remote target at 10.4s (drift 0.2s <= 0.4s) -> NO redundant seek
  assert.equal(shouldSeekOnPlayAction(10.2, 10.4), false);
  // Exactly equal timestamps
  assert.equal(shouldSeekOnPlayAction(5.0, 5.0), false);
  // Micro-drift of 0.1s
  assert.equal(shouldSeekOnPlayAction(12.1, 12.0), false);
});

test('shouldSeekOnPlayAction - performs seek when local player is significantly desynced', () => {
  // Local player at 10.0s, remote target at 15.0s (drift 5.0s > 0.4s) -> MUST seek
  assert.equal(shouldSeekOnPlayAction(10.0, 15.0), true);
  // Local player ahead by 1.5s -> MUST seek
  assert.equal(shouldSeekOnPlayAction(11.5, 10.0), true);
  // Invalid target -> NO seek
  assert.equal(shouldSeekOnPlayAction(10.0, NaN), false);
});

test('isGenuineBuffering - rejects buffering when video is intentionally paused', () => {
  // Even if readyState is low (e.g. seeking or loading chunks), paused video is NOT buffering
  assert.equal(isGenuineBuffering(true, 1), false);
  assert.equal(isGenuineBuffering(true, 2), false);
  assert.equal(isGenuineBuffering(true, 4), false);
});

test('isGenuineBuffering - detects genuine data starvation during active playback', () => {
  // Actively playing (isPaused = false) and readyState < 3 -> genuinely buffering
  assert.equal(isGenuineBuffering(false, 0), true); // HAVE_NOTHING
  assert.equal(isGenuineBuffering(false, 1), true); // HAVE_METADATA
  assert.equal(isGenuineBuffering(false, 2), true); // HAVE_CURRENT_DATA
  // readyState >= 3 -> frames available, NOT buffering
  assert.equal(isGenuineBuffering(false, 3), false); // HAVE_FUTURE_DATA
  assert.equal(isGenuineBuffering(false, 4), false); // HAVE_ENOUGH_DATA
});

test('determineSyncStatus - correctly displays PAUSED and hides buffering when intentionally paused', () => {
  const status = determineSyncStatus({
    isRoomBuffering: false,
    isLocalBuffering: false,
    isNudging: false,
    isPaused: true,
    driftSeconds: 0,
  });
  assert.equal(status, 'PAUSED');
});

test('determineSyncStatus - shows BUFFERING when room has an active buffering hold during playback', () => {
  const status = determineSyncStatus({
    isRoomBuffering: true,
    isLocalBuffering: false,
    isNudging: false,
    isPaused: false,
    driftSeconds: 0,
  });
  assert.equal(status, 'BUFFERING');
});

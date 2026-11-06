/**
 * Room Polish & Shortcuts Unit Tests — Phase 8 Tasks 8.1 - 8.4
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime } from '../src/services/playerUtils.ts';
import { isTypingElement, volumeToGain } from '../src/services/webrtc.ts';

// ---------------------------------------------------------------------------
// 1. Video Player Time Formatting (Task 8.3 & 8.4)
// ---------------------------------------------------------------------------
test('formatTime - formats 0 seconds as 0:00', () => {
  assert.equal(formatTime(0), '0:00');
});

test('formatTime - handles negative and NaN seconds gracefully', () => {
  assert.equal(formatTime(-10), '0:00');
  assert.equal(formatTime(NaN), '0:00');
});

test('formatTime - formats seconds under 1 minute', () => {
  assert.equal(formatTime(5), '0:05');
  assert.equal(formatTime(42.8), '0:42');
  assert.equal(formatTime(59), '0:59');
});

test('formatTime - formats minutes and seconds (mm:ss)', () => {
  assert.equal(formatTime(60), '1:00');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(600), '10:00');
  assert.equal(formatTime(1425), '23:45');
});

test('formatTime - formats hours, minutes, and seconds (hh:mm:ss)', () => {
  assert.equal(formatTime(3600), '1:00:00');
  assert.equal(formatTime(3665), '1:01:05');
  assert.equal(formatTime(7325), '2:02:05');
});

// ---------------------------------------------------------------------------
// 2. Typing Element Suppression for Shortcuts (Task 8.4)
// ---------------------------------------------------------------------------
test('isTypingElement - suppresses shortcuts when focus is inside text input elements', () => {
  assert.equal(isTypingElement({ tagName: 'input' } as any), true);
  assert.equal(isTypingElement({ tagName: 'INPUT' } as any), true);
  assert.equal(isTypingElement({ tagName: 'textarea' } as any), true);
  assert.equal(isTypingElement({ tagName: 'TEXTAREA' } as any), true);
  assert.equal(isTypingElement({ tagName: 'select' } as any), true);
});

test('isTypingElement - suppresses shortcuts for contentEditable rich text', () => {
  assert.equal(isTypingElement({ tagName: 'div', isContentEditable: true } as any), true);
});

test('isTypingElement - allows shortcuts on player container, buttons, and body', () => {
  assert.equal(isTypingElement({ tagName: 'div', isContentEditable: false } as any), false);
  assert.equal(isTypingElement({ tagName: 'button' } as any), false);
  assert.equal(isTypingElement({ tagName: 'body' } as any), false);
  assert.equal(isTypingElement(null), false);
});

// ---------------------------------------------------------------------------
// 3. Participant Profile Popover Voice Volume (Task 8.2)
// ---------------------------------------------------------------------------
test('volumeToGain - converts popover peer volume slider 0-200% correctly', () => {
  assert.equal(volumeToGain(0), 0.0);
  assert.equal(volumeToGain(100), 1.0);
  assert.equal(volumeToGain(150), 1.5);
  assert.equal(volumeToGain(200), 2.0);
  // Clamped bounds
  assert.equal(volumeToGain(-50), 0.0);
  assert.equal(volumeToGain(300), 2.0);
});

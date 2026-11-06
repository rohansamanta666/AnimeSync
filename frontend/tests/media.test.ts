import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBytes,
  calculateStoragePercent,
  formatEpisodeCode,
} from '../src/services/mediaUtils.ts';

test('formatBytes - formats 0 and negative bytes as 0 B', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(-100), '0 B');
  assert.equal(formatBytes(NaN), '0 B');
});

test('formatBytes - formats bytes under 1 KB', () => {
  assert.equal(formatBytes(500), '500 B');
});

test('formatBytes - formats kilobytes, megabytes and gigabytes', () => {
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(524288000), '500 MB');
  assert.equal(formatBytes(1073741824), '1 GB');
  assert.equal(formatBytes(4294967296), '4 GB');
});

test('calculateStoragePercent - calculates percentage accurately', () => {
  assert.equal(calculateStoragePercent(50, 100), 50);
  assert.equal(calculateStoragePercent(25, 100), 25);
  assert.equal(calculateStoragePercent(1, 3), 33.3);
});

test('calculateStoragePercent - handles edge cases safely', () => {
  assert.equal(calculateStoragePercent(0, 100), 0);
  assert.equal(calculateStoragePercent(100, 0), 0);
  assert.equal(calculateStoragePercent(-10, 100), 0);
  assert.equal(calculateStoragePercent(150, 100), 100);
});

test('formatEpisodeCode - pads season and episode numbers', () => {
  assert.equal(formatEpisodeCode(1, 1), 'S01E01');
  assert.equal(formatEpisodeCode(2, 12), 'S02E12');
  assert.equal(formatEpisodeCode(10, 24), 'S10E24');
  assert.equal(formatEpisodeCode(0, 0), 'S01E01');
});

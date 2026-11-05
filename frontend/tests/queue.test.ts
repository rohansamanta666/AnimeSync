import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reorderEpisodeList,
  findNextEpisode,
  computeIntermissionSecondsRemaining,
  isDuplicateEndedEvent,
} from '../src/services/queue.ts';
import type { Episode } from '../src/types/index.ts';

const mockEpisode = (id: string, epNum: number, pos: number): Episode => ({
  id,
  anime_title: 'Attack on Titan',
  season: 1,
  episode_number: epNum,
  filename: `ep_${epNum}.mp4`,
  file_size_bytes: 100_000_000,
  upload_status: 'COMPLETED',
  queue_position: pos,
});

test('reorderEpisodeList - reorders according to explicit list of IDs', () => {
  const ep1 = mockEpisode('ep1', 1, 0);
  const ep2 = mockEpisode('ep2', 2, 1);
  const ep3 = mockEpisode('ep3', 3, 2);

  const reordered = reorderEpisodeList([ep1, ep2, ep3], ['ep3', 'ep1', 'ep2']);
  assert.equal(reordered[0].id, 'ep3');
  assert.equal(reordered[0].queue_position, 0);
  assert.equal(reordered[1].id, 'ep1');
  assert.equal(reordered[1].queue_position, 1);
  assert.equal(reordered[2].id, 'ep2');
  assert.equal(reordered[2].queue_position, 2);
});

test('reorderEpisodeList - appends unmentioned episodes to the end cleanly', () => {
  const ep1 = mockEpisode('ep1', 1, 0);
  const ep2 = mockEpisode('ep2', 2, 1);
  const ep3 = mockEpisode('ep3', 3, 2);

  // Only ep2 is ordered explicitly
  const reordered = reorderEpisodeList([ep1, ep2, ep3], ['ep2']);
  assert.equal(reordered[0].id, 'ep2');
  assert.equal(reordered[1].id, 'ep1');
  assert.equal(reordered[2].id, 'ep3');
});

test('findNextEpisode - finds the episode immediately following current', () => {
  const ep1 = mockEpisode('ep1', 1, 0);
  const ep2 = mockEpisode('ep2', 2, 1);
  const ep3 = mockEpisode('ep3', 3, 2);

  const next1 = findNextEpisode([ep1, ep2, ep3], 'ep1');
  assert.equal(next1?.id, 'ep2');

  const next2 = findNextEpisode([ep1, ep2, ep3], 'ep2');
  assert.equal(next2?.id, 'ep3');
});

test('findNextEpisode - returns null when on the last episode', () => {
  const ep1 = mockEpisode('ep1', 1, 0);
  const ep2 = mockEpisode('ep2', 2, 1);

  const next = findNextEpisode([ep1, ep2], 'ep2');
  assert.equal(next, null);
});

test('findNextEpisode - returns first episode if currentEpisodeId is null', () => {
  const ep1 = mockEpisode('ep1', 1, 0);
  const ep2 = mockEpisode('ep2', 2, 1);

  const next = findNextEpisode([ep1, ep2], null);
  assert.equal(next?.id, 'ep1');
});

test('findNextEpisode - returns null for empty queue', () => {
  const next = findNextEpisode([], 'ep1');
  assert.equal(next, null);
});

test('computeIntermissionSecondsRemaining - calculates ceiling of time remaining', () => {
  const target = 1000;
  const now = 985.2;
  const remaining = computeIntermissionSecondsRemaining(target, now);
  assert.equal(remaining, 15);
});

test('computeIntermissionSecondsRemaining - clamps elapsed past time to 0', () => {
  const target = 1000;
  const now = 1005.5;
  const remaining = computeIntermissionSecondsRemaining(target, now);
  assert.equal(remaining, 0);
});

test('isDuplicateEndedEvent - detects duplicate event within cooldown', () => {
  const isDup = isDuplicateEndedEvent('ep1', 1000, 'ep1', 1005, 15);
  assert.equal(isDup, true);
});

test('isDuplicateEndedEvent - allows event after cooldown period has expired', () => {
  const isDup = isDuplicateEndedEvent('ep1', 1000, 'ep1', 1020, 15);
  assert.equal(isDup, false);
});

test('isDuplicateEndedEvent - allows event for a different episode immediately', () => {
  const isDup = isDuplicateEndedEvent('ep1', 1000, 'ep2', 1001, 15);
  assert.equal(isDup, false);
});

/**
 * Subtitles Unit Tests — Phase 8 Task 8.5
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTimestamp,
  cleanSubtitleText,
  parseSRT,
  parseVTT,
  parseSubtitles,
  findActiveCues,
} from '../src/services/subtitles.ts';

// ---------------------------------------------------------------------------
// 1. Timestamp Parsing
// ---------------------------------------------------------------------------
test('parseTimestamp - parses 3-part SRT timestamp with comma', () => {
  const seconds = parseTimestamp('01:02:03,500');
  assert.equal(seconds, 3600 + 120 + 3.5);
});

test('parseTimestamp - parses 3-part VTT timestamp with dot', () => {
  const seconds = parseTimestamp('00:01:30.250');
  assert.equal(seconds, 90.25);
});

test('parseTimestamp - parses 2-part VTT short timestamp (mm:ss.ms)', () => {
  const seconds = parseTimestamp('02:15.500');
  assert.equal(seconds, 135.5);
});

test('parseTimestamp - returns null for malformed or empty timestamps', () => {
  assert.equal(parseTimestamp(''), null);
  assert.equal(parseTimestamp('invalid:time'), null);
  assert.equal(parseTimestamp('12:34:xx.500'), null);
});

// ---------------------------------------------------------------------------
// 2. Subtitle Text Cleaning
// ---------------------------------------------------------------------------
test('cleanSubtitleText - strips HTML formatting tags', () => {
  const raw = '<i>Hello</i>, <b>world</b>! <c.yellow>Subtitles</c>';
  assert.equal(cleanSubtitleText(raw), 'Hello, world! Subtitles');
});

test('cleanSubtitleText - strips ASS/SSA styling tags', () => {
  const raw = '{\\an8}Top subtitle text';
  assert.equal(cleanSubtitleText(raw), 'Top subtitle text');
});

test('cleanSubtitleText - trims surrounding whitespace', () => {
  assert.equal(cleanSubtitleText('   Clean dialogue text   '), 'Clean dialogue text');
  assert.equal(cleanSubtitleText(''), '');
});

// ---------------------------------------------------------------------------
// 3. SRT Parser
// ---------------------------------------------------------------------------
test('parseSRT - parses valid SubRip content with multiple cues and multi-line dialogue', () => {
  const srtContent = `
1
00:00:01,000 --> 00:00:04,500
First subtitle line.
Second line of first cue.

2
00:00:05,000 --> 00:00:08,200
<i>Second cue text</i>

3
Garbage block with no timing
Just random text

4
00:00:10,000 --> 00:00:12,000
Third cue text
`;

  const cues = parseSRT(srtContent);
  assert.equal(cues.length, 3);

  assert.equal(cues[0].startTime, 1.0);
  assert.equal(cues[0].endTime, 4.5);
  assert.equal(cues[0].text, 'First subtitle line.\nSecond line of first cue.');

  assert.equal(cues[1].startTime, 5.0);
  assert.equal(cues[1].endTime, 8.2);
  assert.equal(cues[1].text, 'Second cue text');

  assert.equal(cues[2].startTime, 10.0);
  assert.equal(cues[2].endTime, 12.0);
  assert.equal(cues[2].text, 'Third cue text');
});

test('parseSRT - handles empty or whitespace-only content', () => {
  assert.deepEqual(parseSRT(''), []);
  assert.deepEqual(parseSRT('   \n\n  '), []);
});

// ---------------------------------------------------------------------------
// 4. WebVTT Parser
// ---------------------------------------------------------------------------
test('parseVTT - parses WebVTT content with WEBVTT header and cue identifiers', () => {
  const vttContent = `WEBVTT - Demo subtitles

cue-1
00:00:02.000 --> 00:00:05.500
Welcome to AnimeSync!

00:00:06.000 --> 00:00:09.000
Enjoy your anime night together.
`;

  const cues = parseVTT(vttContent);
  assert.equal(cues.length, 2);

  assert.equal(cues[0].startTime, 2.0);
  assert.equal(cues[0].endTime, 5.5);
  assert.equal(cues[0].text, 'Welcome to AnimeSync!');

  assert.equal(cues[1].startTime, 6.0);
  assert.equal(cues[1].endTime, 9.0);
  assert.equal(cues[1].text, 'Enjoy your anime night together.');
});

// ---------------------------------------------------------------------------
// 5. Auto-Detection Parser
// ---------------------------------------------------------------------------
test('parseSubtitles - auto-detects VTT via filename extension', () => {
  const vtt = `WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nVTT cue`;
  const cues = parseSubtitles(vtt, 'episode_01.vtt');
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, 'VTT cue');
});

test('parseSubtitles - auto-detects SRT for .srt files', () => {
  const srt = `1\n00:00:01,000 --> 00:00:03,000\nSRT cue`;
  const cues = parseSubtitles(srt, 'episode_01.srt');
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, 'SRT cue');
});

// ---------------------------------------------------------------------------
// 6. Active Cue Synchronization
// ---------------------------------------------------------------------------
test('findActiveCues - returns active cues during playback time window', () => {
  const cues = [
    { id: 1, startTime: 2.0, endTime: 5.0, text: 'Cue 1' },
    { id: 2, startTime: 4.0, endTime: 7.0, text: 'Overlapping Sign' },
    { id: 3, startTime: 10.0, endTime: 12.0, text: 'Cue 3' },
  ];

  // Before any cue
  assert.deepEqual(findActiveCues(cues, 1.0), []);

  // Exactly at start of Cue 1
  const atStart = findActiveCues(cues, 2.0);
  assert.equal(atStart.length, 1);
  assert.equal(atStart[0].text, 'Cue 1');

  // Overlapping window (4.5s matches both Cue 1 and Cue 2)
  const overlapping = findActiveCues(cues, 4.5);
  assert.equal(overlapping.length, 2);
  assert.equal(overlapping[0].text, 'Cue 1');
  assert.equal(overlapping[1].text, 'Overlapping Sign');

  // Between cues (8.0s)
  assert.deepEqual(findActiveCues(cues, 8.0), []);

  // Exactly at end of Cue 3
  const atEnd = findActiveCues(cues, 12.0);
  assert.equal(atEnd.length, 1);
  assert.equal(atEnd[0].text, 'Cue 3');

  // Invalid timestamps
  assert.deepEqual(findActiveCues(cues, -1), []);
  assert.deepEqual(findActiveCues(cues, NaN), []);
});


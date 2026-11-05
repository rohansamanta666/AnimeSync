/**
 * Queue utilities and pure helper functions (Phase 6)
 */
import type { Episode } from '../types';

export function reorderEpisodeList(episodes: Episode[], orderedIds: string[]): Episode[] {
  const epMap = new Map<string, Episode>(episodes.map((ep) => [ep.id, ep]));
  const result: Episode[] = [];
  const seen = new Set<string>();

  for (const id of orderedIds) {
    const ep = epMap.get(id);
    if (ep) {
      result.push({ ...ep, queue_position: result.length });
      seen.add(id);
    }
  }

  for (const ep of episodes) {
    if (!seen.has(ep.id)) {
      result.push({ ...ep, queue_position: result.length });
    }
  }

  return result;
}

export function findNextEpisode(episodes: Episode[], currentEpisodeId: string | null): Episode | null {
  if (episodes.length === 0) return null;
  if (!currentEpisodeId) return episodes[0];

  const currentIndex = episodes.findIndex((ep) => ep.id === currentEpisodeId);
  if (currentIndex !== -1 && currentIndex + 1 < episodes.length) {
    return episodes[currentIndex + 1];
  }

  return null;
}

export function computeIntermissionSecondsRemaining(targetAdvanceTime: number, nowSeconds: number): number {
  return Math.max(0, Math.ceil(targetAdvanceTime - nowSeconds));
}

export function isDuplicateEndedEvent(
  lastEndedEpisodeId: string | null,
  lastEndedAtSeconds: number,
  currentEpisodeId: string,
  nowSeconds: number,
  cooldownSeconds: number = 15
): boolean {
  if (lastEndedEpisodeId === currentEpisodeId && nowSeconds - lastEndedAtSeconds < cooldownSeconds) {
    return true;
  }
  return false;
}

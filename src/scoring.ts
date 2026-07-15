import { RepoFileMetrics } from "./scan-repo";

export interface ScoredFileMetrics extends RepoFileMetrics {
  touchCount: number | null; // null when git history isn't available
}

/**
 * Weights, in order of how much signal each has proven to carry in
 * testing so far:
 * - complexity: strongest direct signal for "this function/file is
 *   doing too much in one place"
 * - fanIn: a complex file many things depend on is worse than a
 *   complex file nothing touches
 * - touchCount: a file edited across many commits is often absorbing
 *   changes that don't belong to it — a different failure mode than
 *   raw complexity, and can flag files that look moderate otherwise
 * - lines: weakest signal alone (a long file isn't necessarily a bad
 *   one — see: long-but-simple JSX), kept as a minor tiebreaker
 */
export function computeOutlierScore(m: ScoredFileMetrics): number {
  const touchScore = m.touchCount != null ? m.touchCount * 2 : 0;
  return m.cyclomaticComplexity * 2 + m.lines * 0.1 + m.fanIn * 3 + touchScore;
}

/**
 * Merge touch-frequency data (if available) into scan results.
 * touchFrequency is null when the repo isn't a git repo or has no
 * history — in that case every file gets touchCount: null, and
 * scoring falls back to the original complexity/lines/fanIn formula.
 */
export function attachTouchFrequency(
  results: RepoFileMetrics[],
  touchFrequency: Map<string, number> | null
): ScoredFileMetrics[] {
  return results.map((m) => ({
    ...m,
    touchCount: touchFrequency ? touchFrequency.get(m.filePath) ?? 0 : null,
  }));
}

/**
 * Consecutive winning / losing day streaks. Ports `_streak_lengths()` from
 * `/tmp/gen_factsheet_v3.py`.
 *
 * A zero-return day breaks both streaks (no contribution to either side).
 * That matches the mockup's behavior and reflects the analytical intent:
 * the panel describes trading-active runs, not zero-touch days.
 */
export function streakLengths(rets: number[]): { wins: number[]; losses: number[] } {
  const wins: number[] = [];
  const losses: number[] = [];
  let curW = 0;
  let curL = 0;
  for (const r of rets) {
    if (r > 0) {
      curW += 1;
      if (curL > 0) {
        losses.push(curL);
        curL = 0;
      }
    } else if (r < 0) {
      curL += 1;
      if (curW > 0) {
        wins.push(curW);
        curW = 0;
      }
    } else {
      if (curW > 0) {
        wins.push(curW);
        curW = 0;
      }
      if (curL > 0) {
        losses.push(curL);
        curL = 0;
      }
    }
  }
  if (curW > 0) wins.push(curW);
  if (curL > 0) losses.push(curL);
  return { wins, losses };
}

/**
 * Bucket the streak lengths into a fixed-width histogram for rendering.
 * Returns counts of streaks at lengths `1, 2, 3, …, maxLen` (lengths > maxLen
 * roll into the final bucket).
 */
export function streakHistogram(streaks: number[], maxLen = 14): number[] {
  const counts = new Array(maxLen).fill(0) as number[];
  for (const s of streaks) {
    if (s <= 0) continue;
    const idx = Math.min(maxLen, s) - 1;
    counts[idx] += 1;
  }
  return counts;
}

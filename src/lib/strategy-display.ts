import type { DisclosureTier } from "@/lib/types";

/**
 * Resolve a strategy display label without leaking identity on exploratory
 * rows. Codename wins at any tier; otherwise the real name is returned only for
 * institutional disclosure; exploratory rows missing a codename fall back to a
 * synthetic `Strategy #<id-prefix>` that can never leak a manager name.
 *
 * Use on any surface that may render exploratory strategies (Match Queue, Send
 * Intro, Candidate Detail, Decision History). Tear sheet / discovery / factsheet
 * already fetch full identity via the DAL and do not need the guard.
 */
export interface DisplayableStrategy {
  id: string;
  name?: string | null;
  codename?: string | null;
  disclosure_tier?: DisclosureTier | null;
}

export function displayStrategyName(
  strategy: DisplayableStrategy | null | undefined,
): string {
  if (!strategy) return "(strategy)";
  if (strategy.codename) return strategy.codename;
  if (strategy.disclosure_tier === "institutional" && strategy.name) {
    return strategy.name;
  }
  return `Strategy #${strategy.id.slice(0, 8)}`;
}

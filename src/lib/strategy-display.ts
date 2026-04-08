/**
 * Display name resolver for strategies, honoring disclosure tier.
 *
 * Logic (in priority order):
 *   1. codename if set — respects manager's pseudonym choice at any tier
 *   2. name if disclosure_tier === 'institutional' — full disclosure is the contract
 *   3. 'Strategy #' + id.slice(0, 8) — synthetic fallback; never leaks a real name
 *
 * Used everywhere strategy names are rendered in UI surfaces that may include
 * exploratory-tier strategies (Match Queue, Send Intro, Candidate Detail,
 * Decision History). Institutional-only surfaces (Discovery, Tear Sheet, Factsheet)
 * already fetch full identity via the DAL and do not need this guard.
 */
export interface DisplayableStrategy {
  id: string;
  name?: string | null;
  codename?: string | null;
  disclosure_tier?: "institutional" | "exploratory" | null;
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

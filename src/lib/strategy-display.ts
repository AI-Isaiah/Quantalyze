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
  if (!strategy) return "Unnamed strategy";
  if (strategy.codename) return strategy.codename;
  if (strategy.disclosure_tier === "institutional" && strategy.name) {
    return strategy.name;
  }
  return `Strategy #${strategy.id.slice(0, 8)}`;
}

/**
 * Phase 200 / D-11 — the two names the public sees for one strategy.
 *
 * `factsheet` is the name the factsheet page title uses (a full-identity
 * context: the row's name, then the codename, then the redacting fallback).
 * `discovery` is `displayStrategyName`, which hides an exploratory name behind
 * the codename or `Strategy #<id-prefix>`.
 *
 * The factsheet `<title>` in `src/app/factsheet/[id]/v2/page.tsx` and the
 * rename place both call this, so what a manager is told the public sees runs
 * the same code as the public surface. Disclosure itself is unchanged: this
 * helper reports it, it does not decide it.
 */
export function publicNamePreview(strategy: DisplayableStrategy): {
  factsheet: string;
  discovery: string;
} {
  return {
    factsheet:
      strategy.name ?? strategy.codename ?? displayStrategyName(strategy),
    discovery: displayStrategyName(strategy),
  };
}

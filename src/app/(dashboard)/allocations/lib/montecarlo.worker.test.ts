import { describe, it, expect } from "vitest";
import { handleMonteCarloMessage } from "./montecarlo.worker";
import { runMonteCarlo } from "./scenario-montecarlo";

/**
 * Worker message-contract pin (Plan 27-01). The worker file is thin glue, but it
 * MUST (a) import cleanly in a non-worker environment without throwing — the
 * `self`-wiring is guarded — and (b) re-export the same pure handler the section
 * relies on. Importing this module here exercises the guard (jsdom has a `self`,
 * so a mis-guarded wiring would attach a real handler / throw on import).
 */

type DP = { date: string; value: number };
function series(returns: number[]): DP[] {
  return returns.map((value, i) => ({
    date: `2024-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
    value,
  }));
}

describe("montecarlo.worker — message contract", () => {
  it("re-exports the pure runMonteCarlo as its handler (no forked math)", () => {
    expect(handleMonteCarloMessage).toBe(runMonteCarlo);
  });

  it("handles a valid request ⇒ ok bands envelope", () => {
    const req = { portfolioDaily: series(Array.from({ length: 120 }, (_, i) => (i % 2 ? 0.01 : -0.008))), paths: 200, seed: 7 };
    const res = handleMonteCarloMessage(req);
    expect(res.ok).toBe(true);
    expect(res.bands).not.toBeNull();
  });

  it("handles a degenerate request ⇒ ok:false envelope, never throws", () => {
    expect(() => handleMonteCarloMessage({ portfolioDaily: [] })).not.toThrow();
    expect(handleMonteCarloMessage({ portfolioDaily: [] }).ok).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The trap this file's block extraction used to walk into, kept importable in
// exactly one place so the calibration below can MEASURE it. Nothing that
// asserts may use it.
import { degenerateNarrow } from "../test/helpers/degenerate-narrow";

/**
 * Phase 84 (#597 part 2) cross-surface asset_class-flow guard.
 *
 * WHY THIS EXISTS: the blend annualization basis (blendPeriodsPerYear — √365 if
 * any crypto leg, else √252) is derived from each leg's `asset_class`. That value
 * reaches the three blend surfaces through three INDEPENDENT projections. Each
 * surface has its own behavioural test, but those are isolated — if a future edit
 * dropped `asset_class` from ONLY ONE projection, that surface would silently fall
 * back to √252 (understating a crypto book's risk ~17%) while the others stay
 * √365, and every per-surface test would still pass (red-team coverage gap,
 * 2026-07-10). This single structural pin fails loudly the moment any of the
 * three source projections stops selecting asset_class.
 */
const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// ---------------------------------------------------------------------------
// Phase 164.8.2 / W1 — an anchor a slice depends on must FAIL LOUD when absent.
// `indexOf` returns -1 on a miss, -1 does not throw, and the narrowing counts
// from the END. MEASURED 2026-09-10 on the block extraction below: with the
// SECOND anchor gone, `src.slice(joinAt, -1)` is everything from the strategy
// join to the penultimate byte of the 3k-line `queries.ts` — so
// `toContain("asset_class")` passes on ANY other projection in the file, which
// is precisely the false-green the arm's own comment says it scopes to prevent.
// ⛔ NO DEFAULT: no `?? 0`, no `Math.max(0, i)`. A missing anchor means the
// subject is not the shape this pin assumed — that is a finding, not a value.
// Restated per-file rather than imported, matching the self-containment
// convention these structural gate files are built on.
// ---------------------------------------------------------------------------

/** `text.indexOf(anchor)`, but a miss THROWS by name instead of returning -1. */
function anchorIndex(text: string, anchor: string, from = 0): number {
  const at = text.indexOf(anchor, from);
  if (at < 0) {
    throw new Error(
      `ANCHOR MISSING: ${JSON.stringify(anchor)} is not present in the subject ` +
        `text. The narrowing slice that wanted it would have degenerated ` +
        `(slice(-1) is the LAST CHARACTER, slice(0, -1) is nearly the WHOLE ` +
        `string) and every assertion over the result would have passed ` +
        `vacuously. Fix the anchor or the subject — do not default it.`,
    );
  }
  return at;
}

describe("Phase 84 — asset_class flows to every blend surface", () => {
  it("getMyAllocationDashboard SSR select projects asset_class on the strategy join (composer + compare book legs)", () => {
    const src = read("src/lib/queries.ts");
    // Scope to the dashboard strategy join block so an unrelated asset_class
    // reference elsewhere in the 3k-line file cannot false-green this pin.
    const joinAt = anchorIndex(src, "strategy:strategies!inner (");
    const block = src.slice(
      joinAt,
      anchorIndex(src, "strategy_analytics (", joinAt),
    );
    expect(block).toContain("asset_class");
  });

  it("CALIBRATION (164.8.2/W1) — a missing block anchor THROWS by name instead of widening the slice", () => {
    const src = read("src/lib/queries.ts");
    const JOIN = "strategy:strategies!inner (";
    const END = "strategy_analytics (";

    // Control: the real source resolves, and the block is a PROJECTION rather
    // than the file — a check that refuses the healthy subject is a refusal.
    expect(() => anchorIndex(src, JOIN)).not.toThrow();
    const joinAt = anchorIndex(src, JOIN);
    const real = src.slice(joinAt, anchorIndex(src, END, joinAt));
    expect(real).toContain("asset_class");
    expect(real.length).toBeLessThan(src.length / 2);

    // Mutant: the END anchor is gone. Assert the mutation APPLIED before
    // asserting the flip — a neuter that does not apply reads as GREEN, and two
    // calibrations on this branch were caught proving exactly nothing.
    const mutant = src.split(END).join("strategy_analytics_renamed (");
    expect(mutant, "the mutation must actually change the source").not.toBe(src);
    expect(
      mutant.includes(END),
      "the mutation must actually REMOVE the end anchor — a no-op replace reads as a pass",
    ).toBe(false);
    expect(
      mutant.includes(JOIN),
      "the mutation removed the START anchor too, so this arm is measuring the wrong miss",
    ).toBe(true);
    expect(() =>
      anchorIndex(mutant, END, anchorIndex(mutant, JOIN)),
    ).toThrow(/ANCHOR MISSING: "strategy_analytics \("/);

    // ⚠️ The trap it replaces, MEASURED rather than asserted: `indexOf` returned
    // -1 and `slice(joinAt, -1)` ran from the join to the penultimate byte of
    // this 3k-line file, so `toContain("asset_class")` went green on some OTHER
    // projection entirely — the exact false-green the scoping comment above
    // exists to prevent.
    const degenerate = degenerateNarrow(mutant, {
      at: anchorIndex(mutant, JOIN),
      upTo: END,
      upToFrom: anchorIndex(mutant, JOIN),
    });
    expect(
      degenerate.length,
      "the pre-W1 shape no longer widens past the real block — re-derive this arm rather than assuming it still bites",
    ).toBeGreaterThan(real.length * 2);
    expect(
      degenerate,
      "the widened slice no longer carries the needle, so the vacuity this arm measures is not reproduced",
    ).toContain("asset_class");
    // ⛔ The START anchor missing degenerates DIFFERENTLY and was never the
    // vacuous case: `indexOf(END, -1)` clamps its fromIndex to 0, so the old
    // `slice(-1, thatIndex)` was the EMPTY string and the arm went red — loudly,
    // but naming nothing. Only the END miss passed while reading the wrong text.
  });

  it("the lazy returns route probe projects asset_class (drawer-added legs)", () => {
    const src = read("src/app/api/strategies/[id]/returns/route.ts");
    // Phase 126-04 (FACTSHEET-01 hardening) removed the strategy_verifications
    // embed from this probe — trust_tier now comes from the correct-by-construction
    // get_published_trust_signals SECDEF primitive (via readPublicVerificationSignals),
    // NOT an RLS-scoped embed. This pin's real intent is unchanged: asset_class MUST
    // still be projected on the published-gated probe (else a crypto book silently
    // falls back to √252 and understates risk ~17%).
    expect(src).toContain('.select("id, asset_class")');
  });

  it("the public share page strategies read projects asset_class (shared scenarios)", () => {
    const src = read("src/app/scenario-share/[token]/page.tsx");
    expect(src).toContain('.select("id, asset_class")');
  });
});

/**
 * SRO-02 RED FIXTURE — an INERT collection const the Primitive-D rule MUST
 * still flag after the mutation narrowing.
 *
 * WHY THIS PAIR EXISTS (Phase 164.3.1 plan 08). Plan 08 narrowed the detector so
 * a binding MUTATED between its declaration and the assertion is not reported —
 * the accumulator idiom (`const offenders: string[] = []` → loop `push`es →
 * `expect(offenders).toEqual([])`) can fail and is not Primitive D. That
 * narrowing was made AFTER a corpus count was seen, which is the move this
 * phase distrusts, so it is pinned in BOTH directions by this pair rather than
 * left to a comment:
 *
 *   * RED (this file) — a collection const that is NEVER mutated. It looks like
 *     an accumulator and is not one: the loop between the declaration and the
 *     assertion reads, and pushes into a DIFFERENT binding. `expect(offenders)`
 *     is therefore still true by construction. If the narrowing were widened —
 *     to "any collection const", or to "any binding merely MENTIONED before the
 *     assertion" — this file would stop being flagged and this arm goes RED.
 *   * GREEN (`SRO-02-mutated-binding.green.ts`) — the real accumulator. If the
 *     narrowing were reverted or broken, that file starts being flagged and its
 *     arm goes RED.
 *
 * Neither file is collected by vitest (`vitest.config.ts` includes
 * `*.test.{ts,tsx}` only). Both ARE type-checked: `tsconfig.json` includes every
 * `.ts` file in the tree, hence the real imports rather than a bare snippet.
 *
 * House contract, `scripts/lint-sql-gates.mjs:33-40`: "A rule without a firing
 * fixture does not merge."
 */
import { it, expect } from "vitest";

it("SRO-02 red: an inert collection const, mutated nowhere", () => {
  const offenders: string[] = [];
  const inspected: string[] = [];
  for (const name of ["alpha", "beta"]) {
    // Reads `offenders`, pushes into `inspected` — `offenders` never changes,
    // so the assertion below holds whether or not anything was inspected.
    if (offenders.length > 99) continue;
    inspected.push(name);
  }
  expect(offenders).toEqual([]);
});

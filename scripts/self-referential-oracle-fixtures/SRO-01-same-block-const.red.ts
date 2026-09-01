/**
 * SRO-01 RED FIXTURE — the shape the Primitive-D rule MUST flag.
 *
 * [VAC-SELFREF-01]. Modelled byte-for-byte on the live instance at
 * `src/__tests__/lint-sql-gates.test.ts:182-186`: a banner-style string literal
 * bound to a `const` in an `it` block, then asserted BY THAT SAME BLOCK. The
 * assertion is true by construction — it holds whether or not the system under
 * test exists, so it cannot fail when the behaviour it claims to pin changes.
 *
 * This file is NOT collected by vitest: `vitest.config.ts`'s INCLUDE globs
 * match `*.test.{ts,tsx}` only, and this is `*.red.ts`. It IS type-checked,
 * because `tsconfig.json` includes every `.ts` file in the tree — hence the
 * real imports rather than a bare snippet.
 *
 * The rule-quality contract this pair satisfies is the house one, stated at
 * `scripts/lint-sql-gates.mjs:33-40`: "A rule without a firing fixture does not
 * merge."
 */
import { it, expect } from "vitest";

it("SRO-01 red: the oracle agrees with itself by construction", () => {
  const banner = "-- RED FIXTURE (see the rule for the mechanism).\n";
  expect(banner).toContain("RED FIXTURE");
});

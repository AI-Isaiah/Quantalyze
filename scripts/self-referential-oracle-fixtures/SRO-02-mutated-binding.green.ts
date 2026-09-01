/**
 * SRO-02 GREEN FIXTURE — the accumulator idiom the Primitive-D rule MUST pass.
 *
 * The counterpart to `SRO-02-mutated-binding.red.ts`. Same declaration shape,
 * same matcher, same needle. The ONLY difference is that the loop `push`es into
 * THIS binding, so its value at assertion time was produced by the scan rather
 * than retyped into the block — `expect(offenders).toEqual([])` here fails the
 * moment the scan finds something, which is precisely what the red fixture's
 * version cannot do.
 *
 * This shape was 19 of the 23 findings measured at HEAD on 2026-09-01
 * (`164.3.1-02-CALIBRATION.md` § III.a) across 12 files — the repo's dominant
 * honest gate-test idiom. A blocking rule that reddened on it would be waived by
 * reflex, and a control routinely waived is a control that cannot fail. If the
 * mutation narrowing is ever reverted or broken, this file starts being flagged
 * and its arm in `self-referential-oracle.test.ts` goes RED.
 *
 * Not collected by vitest (`*.green.ts`, not `*.test.ts`); type-checked by
 * `tsc --noEmit`, which includes every `.ts` file in the tree.
 */
import { it, expect } from "vitest";

it("SRO-02 green: the binding is filled by the scan it reports on", () => {
  const offenders: string[] = [];
  for (const name of ["alpha", "beta"]) {
    if (name.startsWith("_")) offenders.push(name);
  }
  expect(offenders).toEqual([]);
});

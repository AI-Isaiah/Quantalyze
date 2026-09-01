/**
 * SRO-01 GREEN FIXTURE — the repaired idiom the Primitive-D rule MUST pass.
 *
 * Same assertion, same needle, same matcher. The ONLY difference is where the
 * subject's bytes come from: they are read from a real artifact of the system
 * under test rather than retyped into the block. Delete the banner line from
 * `R1-exception-handler-probe.red.sql` and this assertion goes RED — which is
 * exactly the property the red fixture's version does not have.
 *
 * The rule's subject resolution stops at the nearest enclosing block, so a
 * `const` whose initializer is a CALL is out of scope by design: a call can
 * reach the system under test, a literal cannot.
 *
 * Not collected by vitest (`*.green.ts`, not `*.test.ts`); type-checked by
 * `tsc --noEmit` via tsconfig's `**/*.ts` include.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it, expect } from "vitest";

it("SRO-01 green: the oracle is bound to bytes the system under test produced", () => {
  const banner = readFileSync(
    join(process.cwd(), "scripts/lint-sql-gates-fixtures/R1-exception-handler-probe.red.sql"),
    "utf8",
  );
  expect(banner).toContain("RED FIXTURE");
});

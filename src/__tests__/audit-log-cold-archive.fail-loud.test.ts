/**
 * C-0004 (audit-2026-05-07) regression — fail-loud guard.
 *
 * The sibling integration test (`audit-log-cold-archive.test.ts`) is
 * gated on HAS_LIVE_DB and runs in CI only when the live-DB env is
 * provisioned. Pre-fix, three setup branches used the silent-skip
 * pattern:
 *
 *   if (insertErr || !insertData) {
 *     console.warn(...);
 *     return;
 *   }
 *
 * If the seed INSERT failed (e.g., a future RLS tightening that blocks
 * service_role direct INSERT), the test would `return` early — vitest
 * sees no assertion failure and treats the test as PASSING. A
 * "service-role UPDATE is rejected" claim that never actually attempted
 * the UPDATE is a fail-loud violation (CLAUDE.md Rule 12) AND lets a
 * future policy regression slip past CI silently.
 *
 * Fix: replace the three sites with explicit
 * `expect(insertErr).toBeNull(); expect(insertData).toBeTruthy();`
 *
 * This file is a STATIC GUARD — it reads the source of the sibling
 * integration test and asserts the silent-skip pattern is gone. It runs
 * everywhere (no live-DB gate), so a future revert that re-introduces
 * the pattern fails CI immediately rather than silently waiting for the
 * next live-DB-instrumented run.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("audit-log-cold-archive — fail-loud guard (C-0004)", () => {
  it("does not contain the silent-skip pattern on seed-INSERT failure", () => {
    const path = join(__dirname, "audit-log-cold-archive.test.ts");
    const src = readFileSync(path, "utf8");

    // The exact regression pattern: an `if (insertErr || !insertData)`
    // (or the parallel `backdatedErr || !backdatedInsert`) block that
    // logs and returns without an `expect`.
    //
    // Matches across the `console.warn(...)` call so we don't false-
    // positive on a defensive guard that DOES fail loud.
    const silentSkipRegex =
      /if\s*\(\s*\w+Err\s*\|\|\s*!\w+(Insert|Data)\s*\)\s*\{\s*console\.warn\(/g;
    const matches = src.match(silentSkipRegex) ?? [];
    expect(
      matches.length,
      `audit-log-cold-archive.test.ts must NOT silently skip on seed-INSERT failure (C-0004). ` +
        `Found ${matches.length} silent-skip site(s). Use ` +
        `\`expect(insertErr).toBeNull(); expect(insertData).toBeTruthy();\` instead so a missed precondition fails the test loudly.`,
    ).toBe(0);
  });

  it("the three known sites use explicit expect(...) assertions on seed INSERT", () => {
    const path = join(__dirname, "audit-log-cold-archive.test.ts");
    const src = readFileSync(path, "utf8");

    // After the fix, the file should contain explicit fail-loud
    // assertions on each setup-error variable: insertErr (twice — UPDATE
    // and DELETE invariant tests) and backdatedErr (hot→cold move).
    expect(src).toMatch(/expect\(insertErr\)\.toBeNull\(\)/);
    expect(src).toMatch(/expect\(insertData\)\.toBeTruthy\(\)/);
    expect(src).toMatch(/expect\(backdatedErr\)\.toBeNull\(\)/);
    expect(src).toMatch(/expect\(backdatedInsert\)\.toBeTruthy\(\)/);
  });
});

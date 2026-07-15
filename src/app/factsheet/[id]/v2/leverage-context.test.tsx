import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHook } from "@testing-library/react";
import { useLeverage } from "./leverage-context";

/**
 * Phase 90.5 (LEV-01/D2/D5) + Phase 107 (LEV-BB) — leverage-context is SLIDER STATE
 * ONLY. The derived metrics hooks (useModeledLeverage / useLeveragedMetrics) were
 * deleted in Phase 107 (leverage is composed into useBasisSeriesView), so their
 * behavioral tests moved to basis-context.leverage.test.tsx (the levered view) and the
 * rewired component suites (FactsheetView.leverage.test.tsx / FactsheetBody.basis.test.tsx).
 *
 * This file keeps the two invariants that stay true of the state-only provider:
 *   - Test 1: useLeverage throws outside its provider.
 *   - Test 6: GUARD-04 — the source has NO storage/URL/cookie/history access.
 */

describe("leverage-context", () => {
  it("Test 1 — useLeverage throws outside its provider", () => {
    expect(() => renderHook(() => useLeverage())).toThrow(/LeverageProvider/);
  });

  it("Test 6 — GUARD-04: source has no storage/URL/cookie/history access", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/factsheet/[id]/v2/leverage-context.tsx"),
      "utf8",
    );
    // Strip comment lines so header prose can't self-invalidate the grep.
    const code = src
      .split("\n")
      .filter(line => {
        const t = line.trim();
        return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
      })
      .join("\n");
    expect(
      /localStorage|sessionStorage|document\.cookie|history\.(push|replace)|location\.|URLSearchParams/.test(
        code,
      ),
    ).toBe(false);
  });
});

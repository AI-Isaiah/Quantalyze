import { describe, it, expect } from "vitest";

// Regression: ISSUE-001 — OutcomesWidget stuck on loading skeleton because
// the `outcomes` prop never flowed from page.tsx → AllocationDashboard →
// widgetData → OutcomesWidget.
//
// This test locks in the wiring by reading the source files directly and
// asserting the three contract points that had to align for the widget to
// ever show populated state. A cheap static-analysis regression — intentional.
// A full component integration test would require mocking ~15 hooks and is
// brittle; this file-level contract catches the exact class of bug (missing
// destructure / missing memo key / missing prop forwarding) without the
// brittleness.
//
// Found by /qa on 2026-04-19
// Report: .gstack/qa-reports/qa-report-localhost-2026-04-19.md

import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..", "..");

describe("AllocationDashboard outcomes wiring (ISSUE-001 regression)", () => {
  it("page.tsx destructures `outcomes` from getMyAllocationDashboard()", () => {
    const pageSrc = readFileSync(
      join(repoRoot, "src", "app", "(dashboard)", "allocations", "page.tsx"),
      "utf8",
    );
    const destructureLine = /\{\s*[^}]*?\boutcomes\b[^}]*?\}\s*=\s*\n?\s*await\s+getMyAllocationDashboard/.test(
      pageSrc,
    );
    expect(destructureLine).toBe(true);
  });

  it("page.tsx forwards `outcomes` to <AllocationDashboard />", () => {
    const pageSrc = readFileSync(
      join(repoRoot, "src", "app", "(dashboard)", "allocations", "page.tsx"),
      "utf8",
    );
    expect(pageSrc).toMatch(/<AllocationDashboard[\s\S]*?\boutcomes=\{outcomes\}[\s\S]*?\/>/);
  });

  it("AllocationDashboard accepts `outcomes` in its Props + destructures it", () => {
    const dashSrc = readFileSync(
      join(
        repoRoot,
        "src",
        "app",
        "(dashboard)",
        "allocations",
        "AllocationDashboard.tsx",
      ),
      "utf8",
    );
    expect(dashSrc).toMatch(/outcomes\?:\s*OutcomeRow\[\]/);
    expect(dashSrc).toMatch(/export function AllocationDashboard\(\{[\s\S]*?outcomes[\s\S]*?\}:\s*AllocationDashboardProps\)/);
  });

  it("widgetData memo includes `outcomes` in value + deps", () => {
    const dashSrc = readFileSync(
      join(
        repoRoot,
        "src",
        "app",
        "(dashboard)",
        "allocations",
        "AllocationDashboard.tsx",
      ),
      "utf8",
    );
    const memoBlock = dashSrc.match(
      /const widgetData = useMemo\(\s*\(\)\s*=>\s*\(\{[\s\S]*?\}\),\s*\[[^\]]*\][\s\S]*?\)/,
    );
    expect(memoBlock, "widgetData useMemo block").not.toBeNull();
    const block = memoBlock![0];
    expect(block, "outcomes in memo value").toMatch(/\n\s*outcomes,/);
    expect(block, "outcomes in deps array").toMatch(/\[[^\]]*outcomes[^\]]*\]/);
  });
});

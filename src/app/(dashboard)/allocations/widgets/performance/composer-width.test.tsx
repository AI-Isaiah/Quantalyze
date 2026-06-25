import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PARITY-02 (Phase 38 Plan 04): the composer body widens from max-w-[1100px]
 * to max-w-[1440px] so the factsheet-grade chart (Plan 03) has room to render.
 *
 * WHY THIS IS A SOURCE SCAN, NOT A RENDER TEST:
 *   The width is a Tailwind utility-class LITERAL on a container `<div>`. The
 *   actual pixel width comes from Tailwind's compiled CSS (`max-width: 1440px`),
 *   not from anything JSDOM measures — JSDOM has no layout engine, so a render
 *   test would read `getBoundingClientRect()` as all zeros and could never
 *   distinguish 1100 from 1440. The durable, falsifiable guard is therefore to
 *   read the source text and assert the exact literals at each container class.
 *
 *   Two directions are pinned so the change stays SCOPED:
 *     (a) the 3 IN-SCOPE composer containers are max-w-[1440px], and
 *     (b) the OUT-OF-SCOPE Overview empty-state (AllocationDashboardV2.tsx) is
 *         still max-w-[1100px] — an accidental over-broad edit fails here
 *         (T-38-04-01, Tampering / scope-creep mitigation).
 *
 *   Assertions key off STABLE className substrings, not absolute line numbers:
 *   Plan 03's composer call-site swap shifted the lines, so line numbers are
 *   unreliable but the container classNames (`mx-auto ... py-12`,
 *   `mx-auto flex ... flex-col`, `mx-auto ... py-6`) are stable.
 */

const REPO = process.cwd();

const COMPOSER = join(
  REPO,
  "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx",
);
const TABS = join(REPO, "src/app/(dashboard)/allocations/AllocationsTabs.tsx");
const OVERVIEW = join(
  REPO,
  "src/app/(dashboard)/allocations/AllocationDashboardV2.tsx",
);

const composerSrc = readFileSync(COMPOSER, "utf8");
const tabsSrc = readFileSync(TABS, "utf8");
const overviewSrc = readFileSync(OVERVIEW, "utf8");

describe("composer width — PARITY-02 (3 in-scope literals → 1440, Overview stays 1100)", () => {
  it("ScenarioComposer empty-state container is max-w-[1440px]", () => {
    expect(composerSrc).toContain('className="mx-auto max-w-[1440px] py-12"');
    // the old narrow literal must be gone from this exact container class
    expect(composerSrc).not.toContain('className="mx-auto max-w-[1100px] py-12"');
  });

  it("ScenarioComposer main composer body (the BINDING wrapper) is max-w-[1440px]", () => {
    expect(composerSrc).toContain(
      'className="mx-auto flex max-w-[1440px] flex-col"',
    );
    expect(composerSrc).not.toContain(
      'className="mx-auto flex max-w-[1100px] flex-col"',
    );
  });

  it("both ScenarioComposer width literals are exactly 2 × max-w-[1440px] and 0 × max-w-[1100px]", () => {
    expect(composerSrc.match(/max-w-\[1440px\]/g)?.length ?? 0).toBe(2);
    expect(composerSrc.match(/max-w-\[1100px\]/g)?.length ?? 0).toBe(0);
  });

  it("AllocationsTabs Scenario-tab loading skeleton is max-w-[1440px] (skeleton↔loaded consistency)", () => {
    expect(tabsSrc).toContain('className="mx-auto max-w-[1440px] py-6"');
    expect(tabsSrc).not.toContain('className="mx-auto max-w-[1100px] py-6"');
    expect(tabsSrc.match(/max-w-\[1440px\]/g)?.length ?? 0).toBe(1);
  });

  it("OUT OF SCOPE: AllocationDashboardV2 Overview empty-state STAYS max-w-[1100px]", () => {
    // The Overview empty state must NOT be widened by this plan. Pinning it here
    // makes an accidental scope-creep edit fail CI (T-38-04-01).
    expect(overviewSrc).toContain("max-w-[1100px]");
    expect(overviewSrc).toContain(
      'className="mx-auto mt-8 max-w-[1100px] py-12 text-center"',
    );
    // and the composer's wider literal must NOT have leaked into the Overview
    expect(overviewSrc).not.toContain("max-w-[1440px]");
  });
});

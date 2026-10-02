import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Scenario tab's measure. Originally PARITY-02 (Phase 38 Plan 04), which
 * widened the composer body from `max-w-[1100px]` to `max-w-[1440px]` so the
 * factsheet-grade chart had room.
 *
 * ⭐ SUPERSEDED 2026-08-10 by the founder's 2026-08-09 measure-ladder ruling
 * (DESIGN.md changelog; Option B in TODOS.md): dense-table surfaces carry NO px
 * cap, and `DashboardChrome` is the sole owner of the wide measure for every
 * `isWide` tree. `/allocations` is such a tree and the Scenario tab is its
 * densest table surface.
 *
 * ⛔ THIS FILE WAS NOT WEAKENED TO GO GREEN — it was RE-AIMED, and it is
 * strictly stronger than before. It previously pinned 1440 in one direction
 * only; it now pins "no px cap on either shell" AND keeps the original
 * out-of-scope control. Review WR-02 found that the 1440 cap had survived the
 * 2026-08-09 change, so the founder's dead-margin symptom was still live on the
 * very surface they reported it against while DESIGN.md recorded it fixed —
 * this file is the reason it survived, because it asserted the superseded
 * decision. A guard that pins a decision the project has since reversed is not
 * a guard; deleting the assertion instead of re-aiming it would have removed
 * the only thing that will catch the next reinstatement.
 *
 * WHY THIS IS A SOURCE SCAN, NOT A RENDER TEST:
 *   The width is a Tailwind utility-class LITERAL on a container `<div>`. The
 *   actual pixel width comes from Tailwind's compiled CSS, not from anything
 *   JSDOM measures — JSDOM has no layout engine, so a render test would read
 *   `getBoundingClientRect()` as all zeros and could never distinguish 1100
 *   from 1440 from fluid. The durable, falsifiable guard is to read the source
 *   text and assert the exact literals at each container class.
 *
 *   Assertions key off STABLE className substrings, not absolute line numbers.
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

/**
 * A px cap on a SHELL, not on any element. A truncating table cell
 * (`truncate max-w-[160px]`) is not a competing page measure and the ladder
 * does not govern it — DESIGN.md states that scope explicitly. The three
 * shells are matched by their own stable class strings below; this regex is
 * the file-wide sweep for the two ladder rungs a shell could plausibly
 * reinstate.
 */
const LADDER_RUNGS = /max-w-\[(1100|1200|1440|1920)px\]/g;

describe("Scenario tab measure — fluid, no px cap (founder ruling 2026-08-09)", () => {
  it("ScenarioComposer empty-state shell carries NO px cap", () => {
    expect(composerSrc).toContain('className="mx-auto py-12"');
    expect(composerSrc).not.toContain(
      'className="mx-auto max-w-[1440px] py-12"',
    );
  });

  it("ScenarioComposer main body (the BINDING wrapper) carries NO px cap", () => {
    expect(composerSrc).toContain('className="mx-auto flex flex-col"');
    expect(composerSrc).not.toContain(
      'className="mx-auto flex max-w-[1440px] flex-col"',
    );
  });

  it("no measure-ladder rung survives anywhere in ScenarioComposer", () => {
    // The file-wide sweep. Named directly rather than counted, so a failure
    // says WHICH rung came back rather than "expected 1 to be 0".
    expect(composerSrc.match(LADDER_RUNGS) ?? []).toEqual([]);
  });

  it("AllocationsTabs Scenario-tab loading skeleton tracks the body — NO px cap", () => {
    // Skeleton↔loaded consistency, which is the whole point of the skeleton:
    // a 1440-capped skeleton in front of a fluid body is a visible width jump
    // on every tab activation.
    expect(tabsSrc).toContain('className="mx-auto py-6"');
    expect(tabsSrc.match(LADDER_RUNGS) ?? []).toEqual([]);
  });

  it("CONTROL — the Overview PROSE block STAYS max-w-[1100px]", () => {
    // Unchanged from the original PARITY-02 scope control, and it matters more
    // now than it did: the ladder governs by CONTENT TYPE, so "dense tables go
    // fluid" must not become "nothing has a measure". This block is a centred
    // paragraph — rung 1 — and an over-broad de-capping edit fails here.
    expect(overviewSrc).toContain(
      'className="mx-auto mt-8 max-w-[1100px] py-12 text-center"',
    );
    expect(overviewSrc).not.toContain("max-w-[1440px]");
  });
});

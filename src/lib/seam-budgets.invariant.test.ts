import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  SEAM_BUDGETS,
  SEAM_ROUTE_BUDGETS,
  SEAM_EXCLUSIONS,
  SEAM_RETRIES,
} from "./resilient-fetch";

/**
 * SC-4 (SEAM-02) — the seam budget invariant.
 *
 * WHY THIS IS A SOURCE SCAN AND NOT A DATA ASSERTION
 * --------------------------------------------------
 * The invariant has two sides and they deliberately live in two different
 * places:
 *
 *   - the BUDGET side (`timeoutMs`, `calls`, `SEAM_RETRIES`) comes from the
 *     exported tables in `resilient-fetch.ts`;
 *   - the CEILING side (`maxDuration`) is read from each route file ON DISK
 *     with `readFileSync`.
 *
 * Taking both sides from the table would produce an assertion that compares
 * the table to itself: green forever, catching nothing (140-RESEARCH.md
 * Pitfall 5). The disk read is what gives this file teeth — deleting or
 * editing `export const maxDuration` in any of the fifteen routes reddens CI,
 * which is the entire reason the pins were added in Waves 2-3.
 *
 * NO DEFAULT FOR AN ABSENT EXPORT. A route whose export is missing FAILS,
 * loudly, naming the route. Substituting the platform's own value for an
 * un-annotated route is the forbidden anti-pattern of Pitfall 8: it re-hides
 * the very dashboard-changeable assumption the pins exist to convert into a
 * checked in-repo fact.
 *
 * HONEST READING OF THE HEADROOM ASSERTION. With `SEAM_RETRIES = 0` the
 * headroom is generous — the worst route (`keys/validate-and-encrypt`, three
 * sequential live-exchange probes) spends 120 000 ms against a 300 000 ms
 * ceiling, and most spend 15 000-60 000 ms. So the arithmetic in SC-4b is not,
 * today, near its limit, and a reader should NOT mistake it for a tight guard.
 * Its two real jobs are (a) to hold automatically when Phase 141 raises
 * `SEAM_RETRIES` — at retries=1 the worst route is already at 240 000 ms and at
 * retries=2 it BREACHES — and (b) to fail if a future budget is raised without
 * the ceiling moving with it. The teeth in the meantime come from the on-disk
 * read in SC-4a, which was mutation-checked (see the plan summary).
 *
 * CEILING (honest): this file reads ONLY the fifteen route files enumerated in
 * `SEAM_ROUTE_BUDGETS`, plus the exclusion paths. It does NOT walk the import
 * graph, so it cannot notice a SIXTEENTH route that starts calling the seam
 * clients without being added to the table — that route would simply not be
 * scanned. The guard for that class is the `quantalyze/no-raw-analytics-fetch`
 * ESLint rule plus code review of a new `resilientFetch` call site, not this
 * test. A table-vs-import-graph reconciliation walker is the stronger (unbuilt)
 * version.
 */

const REPO = process.cwd();

/**
 * Matches the route-segment config STATEMENT only.
 *
 * `^` under the `m` flag anchors to the start of a line, so a line of prose
 * that mentions the export inside a comment cannot satisfy it (a comment line
 * begins with `//` or ` *`). That anchoring is deliberate grep-gate hygiene:
 * this phase hit prose-defeats-the-guard twice (140-03 deviation 1, 140-05
 * deviation 2), and an unanchored pattern here would let a route's explanatory
 * comment stand in for the pin it describes.
 */
const MAX_DURATION_EXPORT = /^export const maxDuration = (\d+)/m;

const ROUTE_ENTRIES = Object.entries(SEAM_ROUTE_BUDGETS);

/** The declared ceiling as the DEPLOYMENT ADAPTER would read it, from disk. */
function readMaxDurationFromDisk(routePath: string): number {
  const abs = join(REPO, routePath);
  if (!existsSync(abs)) {
    throw new Error(
      `SEAM_ROUTE_BUDGETS names "${routePath}", which does not exist on disk. ` +
        `Either the route moved (update the table) or the entry is stale.`,
    );
  }
  const src = readFileSync(abs, "utf8");
  const m = MAX_DURATION_EXPORT.exec(src);
  if (!m) {
    throw new Error(
      `"${routePath}" has NO \`export const maxDuration = <n>\` statement. ` +
        `Every seam route must pin its function ceiling in-repo so the budget ` +
        `headroom invariant has a source of truth. Add the export (300) — do ` +
        `NOT relax this test to assume a platform value.`,
    );
  }
  return Number(m[1]);
}

describe("SEAM-02 — seam budget invariant (SC-4)", () => {
  it("scans every route declared in SEAM_ROUTE_BUDGETS (15 routes)", () => {
    // Guards against the table being silently emptied, which would make every
    // it.each below vacuous — zero cases is a passing suite.
    expect(ROUTE_ENTRIES.length).toBe(15);
  });

  describe("SC-4a — maxDuration is pinned on disk and matches the declaration", () => {
    it.each(ROUTE_ENTRIES)(
      "%s exports maxDuration matching expectedMaxDurationS",
      (routePath, entry) => {
        const onDisk = readMaxDurationFromDisk(routePath);
        expect(
          onDisk,
          `"${routePath}" exports maxDuration = ${onDisk} but SEAM_ROUTE_BUDGETS ` +
            `declares expectedMaxDurationS = ${entry.expectedMaxDurationS}. ` +
            `The route file and the budget table disagree about this route's ` +
            `function ceiling; fix whichever is wrong — never widen this test.`,
        ).toBe(entry.expectedMaxDurationS);
      },
    );
  });

  describe("SC-4b — summed budget fits inside the on-disk ceiling", () => {
    it.each(ROUTE_ENTRIES)(
      "%s: sum(timeoutMs x calls x (1 + SEAM_RETRIES)) < maxDuration x 1000",
      (routePath, entry) => {
        // The ceiling is re-read from DISK rather than taken from the table,
        // so this assertion never compares the table against itself even if
        // SC-4a were removed.
        const ceilingMs = readMaxDurationFromDisk(routePath) * 1000;

        // SUMMED, not per-call. Three routes make two sequential seam calls
        // (create-with-key, composite/add-key, finalize-wizard's probe+enqueue
        // pair) and validate-and-encrypt nominally reaches three. A per-entry
        // assertion would pass while the route's real worst case is double or
        // triple — wrong for a third of the surface (140-RESEARCH §6.3).
        const worstCaseMs = entry.budgets.reduce(
          (acc, b) =>
            acc + SEAM_BUDGETS[b.key].timeoutMs * b.calls * (1 + SEAM_RETRIES),
          0,
        );

        const spent = entry.budgets
          .map((b) => `${b.key}x${b.calls}@${SEAM_BUDGETS[b.key].timeoutMs}ms`)
          .join(" + ");

        expect(
          worstCaseMs,
          `"${routePath}" can spend ${worstCaseMs}ms (${spent}, retries=${SEAM_RETRIES}) ` +
            `against a ${ceilingMs}ms function ceiling. The lambda would be killed ` +
            `mid-request with no typed envelope. Lower a budget in SEAM_BUDGETS, or ` +
            `raise this route's maxDuration AND expectedMaxDurationS together.`,
        ).toBeLessThan(ceilingMs);
      },
    );
  });

  describe("structural completeness", () => {
    it("documents at least the three known non-core seam call sites", () => {
      // An unexplained absence from SEAM_ROUTE_BUDGETS is indistinguishable
      // from an oversight — the third seam survived for months on exactly that
      // silence. Emptying the exclusions table must not be a quiet way to make
      // this file's other assertions easier to satisfy.
      expect(Object.keys(SEAM_EXCLUSIONS).length).toBeGreaterThanOrEqual(3);
    });

    it.each(Object.keys(SEAM_EXCLUSIONS))(
      "excluded path %s still exists on disk",
      (excludedPath) => {
        expect(
          existsSync(join(REPO, excludedPath)),
          `SEAM_EXCLUSIONS documents "${excludedPath}", which no longer exists. ` +
            `An exclusion pointing at a deleted file is stale documentation that ` +
            `makes the table less trustworthy than no table at all.`,
        ).toBe(true);
      },
    );

    it("gives every exclusion a non-empty reason", () => {
      for (const [path, reason] of Object.entries(SEAM_EXCLUSIONS)) {
        expect(reason.trim().length, `"${path}" has an empty reason`).toBeGreaterThan(
          0,
        );
      }
    });

    it("never lists the same path as both budgeted and excluded", () => {
      const budgeted = new Set(Object.keys(SEAM_ROUTE_BUDGETS));
      const contradictions = Object.keys(SEAM_EXCLUSIONS).filter((p) =>
        budgeted.has(p),
      );
      expect(
        contradictions,
        `A path cannot both route through the core and be excluded from it: ${contradictions.join(", ")}`,
      ).toEqual([]);
    });
  });
});

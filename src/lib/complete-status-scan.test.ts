/**
 * SI-01 (Phase 79-01 Task 3) — CI source-scan guard against fresh exact-match
 * `=== 'complete'` status consumers.
 *
 * PR #591 closed the status-laundering surface: `complete_with_warnings` was
 * silently collapsed to `complete`, so an exact-match `status === "complete"`
 * read-gate would drop the warnings variant. The shared predicate
 * `isComputedAnalytics()` (src/lib/closed-sets.ts:193) is the sanctioned way to
 * gate on "computed" — it accepts BOTH `complete` and `complete_with_warnings`.
 *
 * This test freezes the CURRENT census of exact-match `=== 'complete'` sites in
 * `src/` (non-test) as an allowlist. A NEW site (new file, or a new occurrence
 * in an allowlisted file) fails, directing the author to `isComputedAnalytics()`.
 * A REMOVED site ALSO fails so the allowlist can never rot into an over-allow —
 * shrink it in the same change that removes the site.
 *
 * It runs inside the existing sharded `frontend` vitest CI gate by construction
 * (it matches the `src/**\/*.test.ts` include glob) — no workflow YAML change,
 * so it is a CI guard the moment it lands (roadmap SC-7).
 *
 * The census was verified AS-IS at execute time: every entry is a genuine status
 * comparison (`status`/`state`/`syncStatus`/`computation_status`/`newStatus`/
 * `next === "complete"`), including non-computation sync/verification state
 * machines. The guard's only job is to stop NEW sites landing unnoticed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// The exact-match comparison this guard defends against. Matches ONLY the string
// "complete" (a closing quote must immediately follow) — so `complete_with_warnings`,
// `"published"`, `"stale"` do NOT match. Both quote styles are covered.
const COMPLETE_COMPARISON = /===\s*["']complete["']/g;

/** PURE: count exact-match `=== 'complete'` comparisons in one source string. */
export function countCompleteComparisons(source: string): number {
  const matches = source.match(COMPLETE_COMPARISON);
  return matches ? matches.length : 0;
}

/**
 * PURE: over `(path, source)` pairs, return the `{path: count}` map of files
 * that contain at least one exact-match `=== 'complete'` comparison.
 */
export function scanSources(
  entries: ReadonlyArray<{ path: string; source: string }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { path, source } of entries) {
    const count = countCompleteComparisons(source);
    if (count > 0) out[path] = count;
  }
  return out;
}

// src/ root — this test lives in src/lib, so one level up is src/.
const SRC_ROOT = join(__dirname, "..");

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.(test|spec)\./.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

// FROZEN census (paths relative to `src/`, POSIX separators), regenerated from
// the execute-time grep. Regenerate ONLY when intentionally adding/removing a
// site — and when adding, first confirm `isComputedAnalytics()` is not the right
// call instead (it almost always is for computation-status gates).
const ALLOWLIST: Record<string, number> = {
  "app/(dashboard)/portfolios/[id]/page.tsx": 3,
  "app/api/verify-strategy/[id]/status/route.ts": 1,
  "app/strategy/[id]/page.tsx": 1,
  "components/landing/VerificationProgress.tsx": 2,
  "components/landing/VerificationSection.tsx": 1,
  "components/strategy/ApiKeyManager.tsx": 1,
  "components/strategy/SyncProgress.tsx": 2,
  "lib/closed-sets.ts": 1,
  "lib/queries.ts": 1,
  "lib/types.ts": 1,
};

describe("SI-01: no fresh exact-match '=== complete' status consumers", () => {
  it("scan of src/ matches the frozen allowlist", () => {
    const entries = collectSourceFiles(SRC_ROOT).map((full) => ({
      path: relative(SRC_ROOT, full).split("\\").join("/"),
      source: readFileSync(full, "utf8"),
    }));
    const scanned = scanSources(entries);

    const added = Object.keys(scanned).filter(
      (p) => scanned[p] !== ALLOWLIST[p],
    );
    const removed = Object.keys(ALLOWLIST).filter(
      (p) => ALLOWLIST[p] !== scanned[p],
    );
    const message =
      `Exact-match \`=== 'complete'\` census changed.\n` +
      `  New/changed sites: ${JSON.stringify(added)}\n` +
      `  Missing/stale allowlist entries: ${JSON.stringify(removed)}\n` +
      `A status read-gate must use isComputedAnalytics() ` +
      `(src/lib/closed-sets.ts:193) — which accepts BOTH 'complete' and ` +
      `'complete_with_warnings' — instead of a fresh exact-match. If this ` +
      `change intentionally removes a site, shrink the ALLOWLIST here in the ` +
      `same commit.`;

    expect(scanned, message).toEqual(ALLOWLIST);
  });

  it("scanner unit-pin: a synthetic new site is counted (mutation-honest)", () => {
    const synthetic = [
      { path: "fake/new-consumer.ts", source: `if (status === "complete") {}` },
      { path: "fake/single-quote.ts", source: `x = row.status === 'complete';` },
      // Non-matches: the warnings variant and other statuses must NOT count.
      {
        path: "fake/non-match.ts",
        source: `if (s === "complete_with_warnings" || s === "published") {}`,
      },
    ];
    const scanned = scanSources(synthetic);
    expect(scanned).toEqual({
      "fake/new-consumer.ts": 1,
      "fake/single-quote.ts": 1,
    });
    // Neutering the regex (e.g. requiring `computation_status`) would drop these
    // counts to 0 and redden this pin.
    expect(countCompleteComparisons(`status === "complete"`)).toBe(1);
    expect(countCompleteComparisons(`status === "complete_with_warnings"`)).toBe(0);
  });
});

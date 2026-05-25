import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Cron-quota guardrail for vercel.json.
 *
 * Project upgraded to Vercel Pro (2026-04-29) — Hobby's hard cap of 2
 * crons no longer applies. Pro allows up to 40 cron jobs per project
 * and removes the daily-only schedule restriction.
 *
 * The test stays in place at a softer bound (10) so an accidental
 * runaway addition still surfaces in CI rather than silently inflating
 * the deployment surface. The daily-or-less-frequent check stays as a
 * self-imposed discipline — every cron we add today is OK at daily
 * cadence; loosen if a future need is genuinely sub-daily.
 *
 * Original Hobby-era story (kept for context): production deployments
 * silently stopped twice when we breached Hobby limits — the redirect
 * vercel.link/... → /docs/cron-jobs/usage-and-pricing arrived before
 * any build was created, so the only symptom was "Vercel check failed"
 * on the PR. See docs/runbooks/vercel-cron-upgrade.md for the full
 * story and the Pro-migration playbook.
 *
 * Phase 19 / BACKBONE-05 (2026-05-08) — `/api/cron/flag-monitor` is the
 * first deliberately sub-daily cron. It polls Sentry every 15 minutes
 * and flips the unified-backbone kill-switch when error envelope rate
 * breaches 0.5% with sample ≥ 20. The 15-min cadence is load-bearing:
 * a daily tick would let a regression burn for up to 24h before the
 * auto-rollback path activates. The exception lives in
 * SUB_DAILY_ALLOWLIST below; new sub-daily crons MUST be added here
 * with rationale + a link to the planning docs.
 */

const MAX_CRONS_ALLOWED = 10;

// Paths whose schedule is intentionally sub-daily. Each entry needs a
// reason in the surrounding doc-block. New entries SHOULD be debated in
// a CEO review before landing — the discipline only works when this
// list is small and every line earns its place.
const SUB_DAILY_ALLOWLIST = new Set<string>([
  // Phase 19 / BACKBONE-05 — auto-rollback monitor cron. Polls Sentry
  // every 15 minutes; threshold breach flips the kill-switch row in
  // Supabase feature_flags. See
  // .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/
  //   19-CONTEXT.md L40 + 19-07-flag-monitor-cron-and-drain-PLAN.md.
  "/api/cron/flag-monitor",
]);

type CronEntry = { path: string; schedule: string };

function loadCrons(): CronEntry[] {
  const raw = readFileSync(join(process.cwd(), "vercel.json"), "utf8");
  const parsed = JSON.parse(raw) as { crons?: CronEntry[] };
  return parsed.crons ?? [];
}

// A Hobby-compatible daily schedule has a fixed minute, a fixed hour, and
// wildcards for day-of-month, month, and day-of-week. "0 0 * * *" is the
// canonical shape. Sub-daily patterns (*/5, 0 */4, etc.) are rejected.
function isDailyOrLessFrequent(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour] = parts;
  const looksNumeric = (segment: string) => /^\d+$/.test(segment);
  if (!looksNumeric(minute) || !looksNumeric(hour)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// M-1001 — predicate-level unit coverage for the guardrail itself.
//
// The file-level cases below only read the REAL vercel.json, so the suite is
// its own oracle: if `isDailyOrLessFrequent` were refactored to be permissive
// (e.g. accidentally accepting "*" as numeric), the real-file cases would keep
// passing against a clean vercel.json and the guard would silently stop
// catching the next regression. These cases drive the predicate directly with
// known-good and known-bad schedules so a permissive refactor fails HERE,
// before it ships. The `isDailyOrLessFrequent` helper lives in this file, so
// no production export is needed.
// ---------------------------------------------------------------------------
describe("isDailyOrLessFrequent — predicate unit coverage (M-1001)", () => {
  it.each([
    "0 0 * * *", // midnight daily — canonical
    "30 3 * * *", // 03:30 daily
    "10 3 * * *", // matches retention_notification_dispatches cadence
    "0 9 * * *", // 09:00 daily
    "59 23 * * *", // last minute of the day
  ])("accepts daily-or-less-frequent schedule %j", (schedule) => {
    expect(isDailyOrLessFrequent(schedule)).toBe(true);
  });

  it.each([
    "*/15 * * * *", // every 15 minutes — the flag-monitor cadence (sub-daily)
    "0 */4 * * *", // every 4 hours
    "* * * * *", // every minute
    "0,30 * * * *", // twice hourly (list in minute)
  ])("rejects sub-daily / multi-fire schedule %j", (schedule) => {
    expect(isDailyOrLessFrequent(schedule)).toBe(false);
  });

  it.each([
    "0 0", // too few fields
    "0 0 * *", // 4 fields
    "0 0 * * * *", // 6 fields
    "", // empty
  ])("rejects malformed cron string %j (wrong field count)", (schedule) => {
    expect(isDailyOrLessFrequent(schedule)).toBe(false);
  });

  it("rejects a wildcard minute (the '*' permissiveness regression M-1001 guards)", () => {
    // The exact failure mode the finding calls out: a refactor that let "*"
    // slip through `looksNumeric` would make this pass. /^\d+$/ must reject it.
    expect(isDailyOrLessFrequent("* 3 * * *")).toBe(false);
    expect(isDailyOrLessFrequent("0 * * * *")).toBe(false);
  });

  it("documents the CURRENT predicate's intentional looseness on dow/dom/month", () => {
    // The predicate only constrains minute+hour to be numeric; it does NOT
    // examine day-of-month / month / day-of-week. So "0 9 * * 0" (weekly) is
    // accepted today — it fires at most once a day, which satisfies the
    // daily-or-less-frequent discipline even though it's not literally daily.
    // Pinned so a future tightening of the predicate is a deliberate,
    // test-visible change rather than an accidental behavior shift.
    expect(isDailyOrLessFrequent("0 9 * * 0")).toBe(true);
  });
});

// M-1001 — guard-against-runaway-count: MAX_CRONS_ALLOWED is the soft bound.
// The real-file case asserts the live vercel.json is within it, but never
// proves the bound itself is a small, intentional number. A silent bump to
// 50 (or removal) would weaken the runaway-deployment guard with no test
// failure. Pin the value so any change is a deliberate, reviewed edit.
describe("MAX_CRONS_ALLOWED — bound is intentional (M-1001)", () => {
  it("is the Pro-plan soft bound of 10 (a bump must be a reviewed change)", () => {
    expect(MAX_CRONS_ALLOWED).toBe(10);
  });
});

describe("vercel.json cron quota (Pro plan, soft bound)", () => {
  it(`has at most ${MAX_CRONS_ALLOWED} cron jobs`, () => {
    const crons = loadCrons();
    expect(crons.length).toBeLessThanOrEqual(MAX_CRONS_ALLOWED);
  });

  it("every schedule is daily or less frequent (or in SUB_DAILY_ALLOWLIST)", () => {
    const crons = loadCrons();
    const offenders = crons.filter(
      (c) =>
        !isDailyOrLessFrequent(c.schedule) && !SUB_DAILY_ALLOWLIST.has(c.path),
    );
    expect(offenders).toEqual([]);
  });

  it("SUB_DAILY_ALLOWLIST entries are actually present in vercel.json", () => {
    const crons = loadCrons();
    const cronPaths = new Set(crons.map((c) => c.path));
    const stale: string[] = [];
    for (const path of SUB_DAILY_ALLOWLIST) {
      if (!cronPaths.has(path)) stale.push(path);
    }
    // Stale allowlist entries (cron deleted but allowlist still references it)
    // are technical debt; the suite surfaces them so the next PR can prune.
    expect(stale).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // M-1000 — every cron `path` resolves to a route handler on disk.
  //
  // Vercel does NOT validate cron paths against the build output: a typo like
  // `/api/cron/sync-fundings` (vs `sync-funding`) deploys a cron that 404s
  // silently, and Vercel only retries a non-2xx 3 times before giving up. The
  // shape checks above (count + schedule) cannot catch this. Map each path to
  // `src/app<path>/route.{ts,tsx,js}` and assert the handler exists — this also
  // fails when a PR deletes a handler without removing its cron entry.
  // ---------------------------------------------------------------------------
  it("every cron path resolves to a route handler on disk", () => {
    const crons = loadCrons();
    const appRoot = join(process.cwd(), "src", "app");

    const missing: string[] = [];
    for (const cron of crons) {
      // Trim any leading slash so join() treats it as relative to src/app.
      const rel = cron.path.replace(/^\/+/, "");
      const handlerDir = join(appRoot, rel);
      const exists = ["route.ts", "route.tsx", "route.js"].some((f) =>
        existsSync(join(handlerDir, f)),
      );
      if (!exists) missing.push(cron.path);
    }

    expect(missing).toEqual([]);
  });
});

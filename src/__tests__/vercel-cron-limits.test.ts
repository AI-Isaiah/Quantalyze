import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Hobby-plan guardrail for vercel.json.
 *
 * Vercel's Hobby plan caps cron jobs at 2 and has historically required
 * daily-only schedules. Every time the project has breached either limit,
 * production deployments have silently stopped — the redirect
 * vercel.link/... → /docs/cron-jobs/usage-and-pricing arrives before any
 * build is created, so the only visible symptom is "Vercel check failed"
 * on the PR. See docs/runbooks/vercel-cron-upgrade.md for the full story
 * and the path back to a single-scheduler setup on Vercel Pro.
 *
 * This test fails the build if someone adds a third cron or a sub-daily
 * schedule while still on Hobby. Delete the body (or flip MAX_CRONS) once
 * the project upgrades.
 */

const MAX_CRONS_ON_HOBBY = 2;

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

describe("vercel.json cron quota (Hobby plan)", () => {
  it(`has at most ${MAX_CRONS_ON_HOBBY} cron jobs`, () => {
    const crons = loadCrons();
    expect(crons.length).toBeLessThanOrEqual(MAX_CRONS_ON_HOBBY);
  });

  it("every schedule is daily or less frequent", () => {
    const crons = loadCrons();
    const offenders = crons.filter((c) => !isDailyOrLessFrequent(c.schedule));
    expect(offenders).toEqual([]);
  });
});

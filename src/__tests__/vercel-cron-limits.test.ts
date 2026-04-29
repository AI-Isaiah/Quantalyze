import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
 */

const MAX_CRONS_ALLOWED = 10;

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

describe("vercel.json cron quota (Pro plan, soft bound)", () => {
  it(`has at most ${MAX_CRONS_ALLOWED} cron jobs`, () => {
    const crons = loadCrons();
    expect(crons.length).toBeLessThanOrEqual(MAX_CRONS_ALLOWED);
  });

  it("every schedule is daily or less frequent", () => {
    const crons = loadCrons();
    const offenders = crons.filter((c) => !isDailyOrLessFrequent(c.schedule));
    expect(offenders).toEqual([]);
  });
});

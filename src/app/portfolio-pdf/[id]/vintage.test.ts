import { describe, expect, it } from "vitest";
import { formatDataVintage } from "./vintage";

/**
 * B14 — the printed PDF "Data as of" line. These specs pin the load-bearing
 * intent: distinguish render time from data vintage, and surface staleness in
 * the printed report so a stale-data PDF can't masquerade as current. The
 * suppress-when-fresh contract is string-coupled to freshnessLabel()'s "Fresh"
 * return, so the fresh-no-suffix case guards against a silent inversion.
 */
const NOW = new Date("2026-06-02T12:00:00Z");
function hoursAgoIso(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

describe("formatDataVintage — B14 PDF data vintage", () => {
  it("returns 'Data freshness unavailable' when there is no computed_at", () => {
    expect(formatDataVintage(null, NOW)).toBe("Data freshness unavailable");
    expect(formatDataVintage("", NOW)).toBe("Data freshness unavailable");
  });

  it("prints the vintage WITHOUT a staleness suffix for fresh data (< 12h)", () => {
    const out = formatDataVintage(hoursAgoIso(2), NOW);
    expect(out).toMatch(/^Data as of /);
    // The whole point of the suppression: a current report carries no "(…)" tag.
    expect(out).not.toMatch(/\(/);
  });

  it("appends (Warm) for data between 12h and 48h old", () => {
    expect(formatDataVintage(hoursAgoIso(24), NOW)).toMatch(/^Data as of .* \(Warm\)$/);
  });

  it("appends (Stale) for data older than 48h", () => {
    expect(formatDataVintage(hoursAgoIso(100), NOW)).toMatch(/^Data as of .* \(Stale\)$/);
  });

  it("treats an unparseable computed_at as unavailable rather than 'Invalid Date'", () => {
    // A present-but-bad value must never print "Data as of Invalid Date"; it
    // falls through to the same copy as a missing vintage.
    expect(formatDataVintage("not-a-date", NOW)).toBe("Data freshness unavailable");
  });
});

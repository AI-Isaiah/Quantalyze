/**
 * HONEST-08 (Phase 163 / 163-04) — the discovery badge must bucket on the
 * STALER of sync-recency and series-recency.
 *
 * THE DEFECT, measured on PRODUCTION 2026-08-26. `/browse/crypto-sma` row #2
 * rendered "Synced 7h ago" over a return series whose last point was
 * 2026-05-06 — 112 days earlier — while THAT SAME STRATEGY's factsheet chip
 * read `Track record · old`. Row #1 was the same shape at 7 days. Two public,
 * unauthenticated surfaces contradicting each other about one strategy, and
 * the one a buyer sees FIRST was the one making the false claim.
 *
 * Both statements were literally true and the pair was a lie: "Synced" is a
 * claim about the JOB, and every reader takes it as a claim about the
 * STRATEGY. The fix does not delete the badge — sync recency is real
 * information — it stops presenting it as the ONLY clock.
 *
 * ⛔ THIS SPEC DELIBERATELY DOES NOT ROUTE THROUGH `is_example`. HONEST-03
 * scoped its stale-badge fix to example rows; all 15 examples were deleted
 * from production on 2026-08-26, so that gate now guards ZERO rows on this
 * surface. Every fixture below is `status: "published", is_example: false` —
 * a test written against the example gate would be vacuous by construction.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SyncBadge } from "./SyncBadge";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function agoIso(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/** The freshness dot is the only element carrying the `rounded-full` token. */
function dotClass(container: HTMLElement): string {
  const dot = container.querySelector("span.rounded-full");
  expect(dot).toBeTruthy();
  return dot!.className;
}

describe("SyncBadge — buckets on the staler of sync- and series-recency", () => {
  it("Test 1: a fresh job over a 112-day-dead series reads the SERIES, not the sync", () => {
    // The exact production shape: computed 7h ago, series ended 112d ago.
    const { container } = render(
      <SyncBadge computedAt={agoIso(7 * HOUR)} seriesEnd={agoIso(112 * DAY)} />,
    );

    // The dot buckets on the 112-day fact, not the 7-hour one.
    expect(dotClass(container)).toContain("bg-negative");
    // And the copy NAMES the subject that carried it there, mirroring
    // FreshnessChip's "Track record · old" — a stale dot beside "Synced 7h ago"
    // would merely relocate the contradiction into the same badge.
    expect(container.textContent).toMatch(/Track record/i);
    // The false claim is GONE, not merely recoloured.
    expect(container.textContent).not.toMatch(/Synced/);
  });

  it("Test 2: when the SYNC is the staler fact, the sync-keyed form is unchanged", () => {
    // computedAt 3d ago (stale on the 12h/48h ladder), series 1d ago.
    const { container } = render(
      <SyncBadge computedAt={agoIso(3 * DAY)} seriesEnd={agoIso(1 * DAY)} />,
    );

    expect(container.textContent).toMatch(/Synced 3d ago/);
    expect(container.textContent).not.toMatch(/Track record/i);
    expect(dotClass(container)).toContain("bg-negative");
  });

  it("Test 2b: a healthy row keeps its fresh dot and its sync-keyed copy", () => {
    // No regression on the rows that are actually fine — without this, a fix
    // that simply capped everything below fresh would pass Tests 1 and 3.
    const { container } = render(
      <SyncBadge computedAt={agoIso(2 * HOUR)} seriesEnd={agoIso(1 * DAY)} />,
    );

    expect(container.textContent).toMatch(/Synced 2h ago/);
    expect(dotClass(container)).toContain("bg-positive");
  });

  it("Test 3: an UNKNOWN series end caps 'fresh' — it cannot support a freshness claim", () => {
    const { container } = render(
      <SyncBadge computedAt={agoIso(2 * HOUR)} seriesEnd={null} />,
    );

    // Mirrors FreshnessChip's TONE_RANK, where `unknown` sits ABOVE `fresh`.
    expect(dotClass(container)).not.toContain("bg-positive");
    // …but it is not a stale CLAIM either — the job really did run 2h ago.
    expect(dotClass(container)).toContain("bg-amber-400");
    expect(container.textContent).toMatch(/Synced 2h ago/);
  });

  it("Test 3b: an UNKNOWN series end never ERASES a known-bad sync age", () => {
    // TONE_RANK's other half: `unknown` sits BELOW `stale`/`old`. Letting a
    // mere absence of series data soften a definite 5-day-old job would trade
    // a fact for a shrug.
    const { container } = render(
      <SyncBadge computedAt={agoIso(5 * DAY)} seriesEnd={null} />,
    );

    expect(dotClass(container)).toContain("bg-negative");
    expect(container.textContent).toMatch(/Synced 5d ago/);
  });

  it("Test 3c: an unparseable series end is treated as unknown, never as fine", () => {
    const { container } = render(
      <SyncBadge computedAt={agoIso(2 * HOUR)} seriesEnd="not-a-date" />,
    );

    expect(dotClass(container)).not.toContain("bg-positive");
  });

  it("Test 4: a null computedAt still renders nothing — the early return survives", () => {
    const { container } = render(
      <SyncBadge computedAt={null} seriesEnd={agoIso(112 * DAY)} />,
    );
    expect(container.textContent).toBe("");
  });
});

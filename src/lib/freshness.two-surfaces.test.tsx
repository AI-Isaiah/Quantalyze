/**
 * WR-06-UTC (Phase 164.2) — ONE ROW, BOTH SURFACES, ONE VERDICT.
 *
 * WHY THIS FILE EXISTS, and why it is not a duplicate of the two per-surface
 * specs beside it. The freshness of a strategy is judged TWICE in this product,
 * by two bucketers in two files: `bucketSeriesAge` in `src/lib/freshness.ts`
 * (the discovery-list `SyncBadge`) and `bucketByAge` in
 * `src/app/factsheet/[id]/v2/FactsheetView.tsx` (the factsheet `FreshnessChip`).
 * Every defect in this lineage — HONEST-02, HONEST-08, WR-06 and now WR-06-UTC
 * — is the SAME defect: the two answered one row two ways, and the surface a
 * buyer sees first was the one making the false claim. Measured on production
 * 2026-08-26, `/browse/crypto-sma` row #2 read "Synced 7h ago" while that same
 * strategy's factsheet read `Track record · old`.
 *
 * So fixing ONE bucketer manufactures a new contradiction, which is exactly
 * what a per-surface test cannot see. This file renders BOTH surfaces from ONE
 * row and asserts they agree — the shape TODOS asks for in as many words: "in
 * one commit, with a test that renders both surfaces from one row and asserts
 * they agree."
 *
 * ⭐ THE ROW IS A UTC DATE, WHICH IS THE PRODUCTION SHAPE AND NOT A CONVENIENCE.
 * `strategy_analytics.series_end` is a DATE column and `payload.dates` carries
 * `YYYY-MM-DD` strings, so a single `YYYY-MM-DD` really is one row's one value
 * handed to both surfaces — not two fixtures that resemble each other. That is
 * what lets this file claim agreement rather than merely coincidence.
 *
 * ⛔ THE AGREEMENT IS ON DERIVED BOOLEANS, AND THE EXPECTATIONS ARE HAND-TYPED.
 * The two surfaces render different COPY on purpose ("Track record ends in the
 * future" vs "Track record · future — check data"), so asserting string
 * equality would be asserting that the product has one voice, which it does not
 * and should not. What must agree is the two CLAIMS: which subject the row is
 * about, and whether the date is being called impossible. Both booleans are
 * read out of rendered text, and both are compared against a value typed in the
 * table below — never against each other alone. Two surfaces that broke in the
 * same direction would still fail, which is the failure mode a bare
 * `expect(badge).toEqual(chip)` would sail straight past.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "@/app/factsheet/[id]/v2/factsheet-context";
import { FactsheetBody } from "@/app/factsheet/[id]/v2/FactsheetView";
import { SyncBadge } from "@/components/strategy/SyncBadge";

// Stub block copied from FactsheetView.chip-honesty.test.tsx rather than
// imported: those helpers are test-private, and a shared harness module would
// let one edit move both surfaces' fixtures at once — the very coupling this
// file exists to detect.
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => lsStore.clear()),
  key: vi.fn(() => null),
  length: 0,
};
// Installed PER TEST — `vitest.config.ts` sets `unstubGlobals: true` (DEF-16-1).
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD`, `n` days from now in UTC — negative is the past. */
function ymdInDays(n: number): string {
  return new Date(Date.now() + n * DAY_MS).toISOString().slice(0, 10);
}

/** An ISO instant `n` hours before now — the shape `computed_at` carries. */
function isoHoursAgo(n: number): string {
  return new Date(Date.now() - n * HOUR_MS).toISOString();
}

/** `n` daily-return points whose LAST point falls exactly on `endYmd`. */
function makeReturnsSeriesEndingOn(n: number, endYmd: string): DailyPoint[] {
  const end = new Date(`${endYmd}T00:00:00Z`);
  const pts: DailyPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: 0.0015 + Math.sin((n - 1 - i) * 0.27) * 0.005,
    });
  }
  return pts;
}

function payloadFor(seriesEndYmd: string, computedAt: string): FactsheetPayload {
  return {
    ...buildScenarioFactsheetPayload({
      portfolioDaily: makeReturnsSeriesEndingOn(300, seriesEndYmd),
      benchmark: null,
    }),
    computedAt,
  };
}

/** The chip's eyebrow — the masthead's only `tracking-[0.18em]` element. */
function readChipLabel(container: HTMLElement): string {
  const header = container.querySelector("header");
  expect(header, "masthead not found").not.toBeNull();
  const labelRow = header!.querySelector('[class*="tracking-[0.18em]"]');
  expect(labelRow, "FreshnessChip label row not found").not.toBeNull();
  return (labelRow!.textContent ?? "").trim();
}

/**
 * The two claims both surfaces make, read out of each one's own rendered text.
 *
 * `namesTrackRecord` — is this row's freshness being reported ABOUT the track
 * record (rather than about the compute job)? The badge swaps "Synced …" for
 * "Track record ends …"; the chip swaps the `Computed ·` eyebrow for
 * `Track record ·`.
 *
 * `saysFuture` — is the date being called one we cannot have observed?
 */
interface Claims {
  namesTrackRecord: boolean;
  saysFuture: boolean;
}

function badgeClaims(seriesEndYmd: string, computedAt: string): Claims {
  const { container } = render(
    <SyncBadge computedAt={computedAt} seriesEnd={seriesEndYmd} />,
  );
  const text = container.textContent ?? "";
  return {
    namesTrackRecord: /Track record/i.test(text),
    saysFuture: /in the future/i.test(text),
  };
}

function chipClaims(seriesEndYmd: string, computedAt: string): Claims {
  const payload = payloadFor(seriesEndYmd, computedAt);
  const { container } = render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
  const label = readChipLabel(container);
  return {
    namesTrackRecord: label.startsWith("Track record"),
    saysFuture: label.includes("future"),
  };
}

/**
 * The matrix. HAND-TYPED, including both expectations — see the header note on
 * why the expected values are not derived from either surface.
 *
 * ⚠️ `+3` rather than `+2` on the far-future row, and the extra day is not
 * padding. A DATE-only value is read at UTC midnight, so "N days ahead" is
 * really "between N-1 and N days ahead" depending on the hour the suite runs.
 * At N=2 the lower edge lands EXACTLY on the one-day allowance, which would
 * make the row knife-edge near 00:00 UTC. The TIGHT bound (23h vs 25h) is
 * pinned on the badge, which takes an instant and has the resolution for it.
 */
const ROWS: {
  what: string;
  seriesOffsetDays: number;
  computedHoursAgo: number;
  namesTrackRecord: boolean;
  saysFuture: boolean;
}[] = [
  {
    what: "tomorrow's bar — a same-day write from a venue east of UTC",
    seriesOffsetDays: 1,
    computedHoursAgo: 2,
    namesTrackRecord: false,
    saysFuture: false,
  },
  {
    what: "three days ahead — no calendar explains that",
    seriesOffsetDays: 3,
    computedHoursAgo: 2,
    namesTrackRecord: true,
    saysFuture: true,
  },
  {
    what: "yesterday's bar — the ordinary healthy row",
    seriesOffsetDays: -1,
    computedHoursAgo: 2,
    namesTrackRecord: false,
    saysFuture: false,
  },
  {
    what: "a track record thirty days dead under a fresh job",
    seriesOffsetDays: -30,
    computedHoursAgo: 2,
    namesTrackRecord: true,
    saysFuture: false,
  },
];

describe("WR-06-UTC — the badge and the factsheet chip answer one row the same way", () => {
  /**
   * ⭐ THE ANTI-VACUITY CONTROL, and it runs FIRST on purpose. An agreement
   * check over a degenerate matrix is the classic vacuous pass: if every row
   * expected `false` for both claims, two surfaces that had BOTH lost the
   * series arm entirely would agree perfectly and this file would stay green
   * through the exact regression it was written to catch. So the table is
   * asserted to be non-degenerate in both directions of both claims, and its
   * length is asserted against a hand-typed count so a row cannot be silently
   * dropped.
   */
  it("CONTROL: the matrix is hand-typed and non-degenerate in both claims", () => {
    expect(ROWS).toHaveLength(4);
    expect(ROWS.some((r) => r.namesTrackRecord)).toBe(true);
    expect(ROWS.some((r) => !r.namesTrackRecord)).toBe(true);
    expect(ROWS.some((r) => r.saysFuture)).toBe(true);
    expect(ROWS.some((r) => !r.saysFuture)).toBe(true);
    // And the two claims are not the same column wearing two names: a row that
    // names the track record WITHOUT calling the date impossible must exist,
    // or `saysFuture` would be carrying no information of its own.
    expect(ROWS.some((r) => r.namesTrackRecord && !r.saysFuture)).toBe(true);
  });

  // One `it` per row: a single test looping four FactsheetBody renders trips
  // Vitest's 5s default under heavy RTL on a 4-core CI box, and a row that
  // fails must fail on its assertion rather than on the clock.
  it.each(ROWS)(
    "one row, two surfaces, one verdict — $what",
    ({ what, seriesOffsetDays, computedHoursAgo, namesTrackRecord, saysFuture }) => {
      // ONE value, handed to both surfaces. This is the production shape:
      // `series_end` is a DATE column and `payload.dates` are `YYYY-MM-DD`.
      const seriesEndYmd = ymdInDays(seriesOffsetDays);
      const computedAt = isoHoursAgo(computedHoursAgo);

      const badge = badgeClaims(seriesEndYmd, computedAt);
      const chip = chipClaims(seriesEndYmd, computedAt);

      // Each surface against the HAND-TYPED expectation…
      expect(badge, `badge, ${what}`).toEqual({ namesTrackRecord, saysFuture });
      expect(chip, `chip, ${what}`).toEqual({ namesTrackRecord, saysFuture });
      // …and then against each other, which is the claim in the file's title
      // and the one a per-surface spec structurally cannot make.
      expect(badge, `badge and chip disagree about: ${what}`).toEqual(chip);
    },
  );
});

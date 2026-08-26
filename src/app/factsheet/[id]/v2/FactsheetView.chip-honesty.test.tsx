import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 162 / HONEST-02 — the FRESHNESS CHIP's half (founder ruling 2026-08-26).
 *
 * THE REQUIREMENT, VERBATIM: "The factsheet freshness badge reflects series
 * recency — a strategy whose return series ended 89 days ago cannot read FRESH."
 *
 * WHY these assertions are shaped the way they are:
 *
 *   1. THE PIN IS THE RENDERED STATE, NOT THE ABSENCE OF A WORD. The tempting
 *      assertion here is `expect(label).not.toContain("fresh")`. It is the trap
 *      that let this bug ship: it cannot tell "fresh" from "not fresh", it
 *      passes for a chip that renders nothing at all, and it passes for a chip
 *      that has been broken into always saying "old". So every case below names
 *      the EXACT label and the EXACT tone token for ONE input, and C-2 / C-6 /
 *      C-10 pin the cases that MUST still read green. An implementation that
 *      inverts the comparison, or that demotes everything to be safe, fails
 *      this file — which is the only reason it is worth having.
 *
 *   2. THE ORACLE IS NOT THE IMPLEMENTATION. Expected labels are typed here as
 *      literals, and the expected date string is produced by `usDate` below —
 *      a SECOND, independent formatter written in this file, never
 *      `formatIsoDate` imported from the component. Asserting the component's
 *      formatter against itself would pass for any output, including a wrong
 *      one (the self-referential-oracle trap named in 162-VALIDATION).
 *
 *   3. THE BLEND IS PINNED IN BOTH DIRECTIONS. The chip states the STALER of
 *      two facts — when the job ran, and where the track record ends. C-1/C-3
 *      pin that a dead track demotes a fresh job (the bug). C-4 pins that a
 *      live track does NOT rescue a stale job, which is what a `min` where a
 *      `max` belongs would silently do, and no "never fresh" assertion could
 *      ever catch it.
 *
 *   4. THE PRESERVED ARMS ARE PART OF THE CONTRACT. C-9 (epoch sentinel,
 *      RED-TEAM-M4), C-10 (future date, NEW-C20-07) and C-11 (unparseable
 *      `computedAt`) each shipped for a recorded reason. A fix that regresses
 *      one while closing another is not a fix, so each is exercised HERE with a
 *      series that would flip it if the new arm leaked into it.
 *
 * Stub block (sentry + localStorage + next/navigation) mirrors
 * FactsheetView.recency-line.test.tsx verbatim — same masthead, same harness.
 */

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

// ---------------------------------------------------------------------------
// Fixtures — every age is RELATIVE TO NOW, because the requirement is stated in
// days-ago and the chip reads the wall clock. A frozen calendar date would age
// out of its own bucket and start asserting something else.
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD`, n days before now, UTC — the shape `payload.dates` carries. */
function ymdDaysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);
}

/** An ISO instant n hours before now — the shape `computed_at` carries. */
function isoHoursAgo(n: number): string {
  return new Date(Date.now() - n * HOUR_MS).toISOString();
}

/**
 * The expected rendered date — an INDEPENDENT reimplementation of the
 * factsheet's "Mon D, YYYY" format. Deliberately not imported: see header note 2.
 */
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
function usDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** n daily-return points whose LAST point falls exactly on `endYmd`. */
function makeReturnsSeriesEndingOn(n: number, endYmd: string, drift = 0.0015): DailyPoint[] {
  const end = new Date(`${endYmd}T00:00:00Z`);
  const pts: DailyPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin((n - 1 - i) * 0.27) * 0.005,
    });
  }
  return pts;
}

/**
 * A real ~300-point payload built through the production adapter, whose series
 * ends `seriesEndDaysAgo` days ago, computed `computedHoursAgo` hours ago.
 * The series is built as DATA and flows through `buildScenarioFactsheetPayload`
 * — not poked into `payload.dates` — so these cases exercise the same
 * `dates` axis the read path produces.
 */
function payloadWith(seriesEndDaysAgo: number, computedAt: string): FactsheetPayload {
  return {
    ...buildScenarioFactsheetPayload({
      portfolioDaily: makeReturnsSeriesEndingOn(300, ymdDaysAgo(seriesEndDaysAgo)),
      benchmark: null,
    }),
    computedAt,
  };
}

/** The adapter's supported safe-empty blend — `dates: []`, a real render path. */
function emptySeriesPayload(computedAt: string): FactsheetPayload {
  return {
    ...buildScenarioFactsheetPayload({ portfolioDaily: [], benchmark: null }),
    computedAt,
  };
}

function renderFactsheet(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
}

// ---------------------------------------------------------------------------
// Readers — located WITHOUT any test-only hook in the component. The chip's
// label row is the masthead's only `tracking-[0.18em]` element (the eyebrow
// uses 0.22em, the self-reported tag 0.14em) — the same anchor
// FactsheetView.recency-line.test.tsx uses.
// ---------------------------------------------------------------------------

const POSITIVE = "var(--color-positive)";
const NEGATIVE = "var(--color-negative)";
const WARNING = "var(--color-warning, #B45309)";
const MUTED = "var(--color-text-muted)";

interface ChipRead {
  /** The full eyebrow, e.g. "Track record · old" — subject AND verdict. */
  label: string;
  /** The status dot's inline background — the chip's entire tone signal. */
  tone: string;
  /** The date line beneath the eyebrow, "(Nd)" age suffix included. */
  dateLine: string;
}

function readChip(container: HTMLElement): ChipRead {
  const header = container.querySelector("header");
  expect(header, "masthead not found").not.toBeNull();
  const labelRow = header!.querySelector('[class*="tracking-[0.18em]"]');
  expect(labelRow, "FreshnessChip label row not found").not.toBeNull();
  const dot = labelRow!.querySelector("span[aria-hidden]") as HTMLElement | null;
  expect(dot, "FreshnessChip tone dot not found").not.toBeNull();
  const root = labelRow!.parentElement as HTMLElement;
  const dateEl = root.querySelector("p");
  expect(dateEl, "FreshnessChip date line not found").not.toBeNull();
  return {
    label: (labelRow!.textContent ?? "").trim(),
    tone: dot!.style.background,
    dateLine: (dateEl!.textContent ?? "").trim(),
  };
}

/** The 162-07 recency line, queried by its copy — absent ⇒ null. */
function recencyLineText(container: HTMLElement): string | null {
  const header = container.querySelector("header");
  if (!header) return null;
  const p = Array.from(header.querySelectorAll("p")).find((el) =>
    (el.textContent ?? "").startsWith("Track record through "),
  );
  return p ? (p.textContent ?? "") : null;
}

describe("FreshnessChip — the badge cannot outrun the data (HONEST-02)", () => {
  it("C-1: an 89-day-old series with an hour-old job reads OLD, in the negative tone — never fresh", () => {
    // THE REQUIREMENT ITSELF. The 162 census subject in miniature: the job ran
    // an hour ago and is beyond reproach; the track record died in the spring.
    // Before this fix the chip rendered a green "Computed · fresh" one line
    // above "Track record through {May}" — the line true, the badge not.
    const computedAt = isoHoursAgo(1);
    const { container } = renderFactsheet(payloadWith(89, computedAt));

    const chip = readChip(container);
    // Exact rendered state for one input — not "does not contain fresh".
    expect(chip.label).toBe("Track record · old");
    expect(chip.tone).toBe(NEGATIVE);
    // Stated the other way too, because THIS is the sentence in the
    // requirement: the fresh tone must not be on screen for this input.
    expect(chip.tone).not.toBe(POSITIVE);

    // And the subject is NAMED. A chip that read "Computed · old" over a date
    // computed an hour ago would just relocate the contradiction.
    expect(chip.label.startsWith("Track record")).toBe(true);
  });

  it("C-2: the SAME job over a live series still reads FRESH — the chip did not just get pessimistic", () => {
    // The control that makes C-1 falsifiable. `computedAt` is identical to
    // C-1's; only the series moved. An implementation that demotes
    // unconditionally (or that lost the fresh arm) passes C-1 and fails here.
    const { container } = renderFactsheet(payloadWith(1, isoHoursAgo(1)));

    const chip = readChip(container);
    expect(chip.label).toBe("Computed · fresh");
    expect(chip.tone).toBe(POSITIVE);
  });

  // C-3: "…cannot read FRESH under ANY input combination." Swept rather than
  // spot-checked, and each row asserts the WHOLE rendered verdict, so a silent
  // inversion of the comparison cannot hide in an unchecked cell.
  //
  // One `it` PER ROW, deliberately: a single test looping these four renders
  // took 5.1s locally and tripped Vitest's 5s default — the exact heavy-RTL
  // timeout the config header documents as this repo's CI flake shape, and CI
  // runs on 4 cores. A row that fails must fail on its assertion, never on the
  // clock, or the pin degrades into noise the next reader learns to ignore.
  it.each([
    { computedAt: isoHoursAgo(1), label: "Track record · old", why: "job an hour old — the census case" },
    { computedAt: isoHoursAgo(48), label: "Track record · old", why: "job inside the 3d fresh band" },
    { computedAt: isoHoursAgo(24 * 5), label: "Track record · old", why: "job inside the 3-7d stale band" },
    // Both facts are old here, so the job — the fact the chip has always
    // stamped — keeps the subject line. The verdict is identical either way.
    { computedAt: isoHoursAgo(24 * 30), label: "Computed · old", why: "job old too" },
  ])("C-3: 89 days dead reads OLD — $why", ({ computedAt, label, why }) => {
    const { container } = renderFactsheet(payloadWith(89, computedAt));

    const chip = readChip(container);
    expect(chip.label, why).toBe(label);
    expect(chip.tone, why).toBe(NEGATIVE);
    expect(chip.tone, why).not.toBe(POSITIVE);
  });

  it("C-4: a live series does NOT rescue a stale job — the blend takes the WORSE of the two", () => {
    // The other direction, and the one a "never fresh" assertion can never
    // catch: swap the max for a min and the chip would read "fresh" here, over
    // a report nobody has recomputed in a month.
    const { container } = renderFactsheet(payloadWith(1, isoHoursAgo(24 * 30)));

    const chip = readChip(container);
    expect(chip.label).toBe("Computed · old");
    expect(chip.tone).toBe(NEGATIVE);
  });

  it("C-5: a 5-day-old series demotes an hour-old job to STALE — the chip's OWN 3d/7d ladder, reused", () => {
    // HONEST-02 adds no new threshold (UI-SPEC C-1: `computeFreshness` 12h/48h
    // and this chip 3d/7d already disagree; a fourth ladder would compound it).
    // 5 days lands in the chip's existing stale band, so the series arm must
    // land there too — amber, the recoverable tier, not red.
    const { container } = renderFactsheet(payloadWith(5, isoHoursAgo(1)));

    const chip = readChip(container);
    expect(chip.label).toBe("Track record · stale");
    expect(chip.tone).toBe(WARNING);
  });

  it("C-6: a 2-day-old series does NOT demote — no false alarm inside the fresh band", () => {
    // The boundary from below. A weekend gap in a live track is normal; if the
    // series arm used a tighter ladder than the chip's own, this reads amber
    // and every healthy factsheet in the product starts crying wolf.
    const { container } = renderFactsheet(payloadWith(2, isoHoursAgo(1)));

    const chip = readChip(container);
    expect(chip.label).toBe("Computed · fresh");
    expect(chip.tone).toBe(POSITIVE);
  });

  it("C-7: an EMPTY series cannot be called fresh — it degrades to the colorless em dash", () => {
    // An hour-old job over no resolvable track. "fresh" would be a claim about
    // data that is not there. DESIGN.md semantic-color gates: absence is
    // muted, never red — an unknown series is not an error, and the 162-07
    // recency line answers the same null by not rendering at all.
    const { container } = renderFactsheet(emptySeriesPayload(isoHoursAgo(1)));

    const chip = readChip(container);
    expect(chip.label).toBe("Track record · —");
    expect(chip.tone).toBe(MUTED);
    expect(chip.tone).not.toBe(POSITIVE);
    // The line below stays absent (162-07 contract) — chip and line agree.
    expect(recencyLineText(container)).toBeNull();
  });

  it("C-8: an UNPARSEABLE series end cannot be called fresh either", () => {
    // The other unknown-date arm: points exist, the last one does not parse.
    // Both nulls come from the SAME `resolveSeriesEnd` the recency line uses,
    // so the badge and the sentence cannot disagree about what is unknown.
    const base = payloadWith(1, isoHoursAgo(1));
    const { container } = renderFactsheet({
      ...base,
      dates: [...base.dates.slice(0, -1), "not-a-date"],
    });

    const chip = readChip(container);
    expect(chip.label).toBe("Track record · —");
    expect(chip.tone).toBe(MUTED);
    expect(recencyLineText(container)).toBeNull();
  });

  it("C-9: the epoch sentinel keeps its own arm even under a long-dead series (RED-TEAM-M4)", () => {
    // `computed_at` was null server-side. The chip must still say "not yet"
    // and print N/A — NOT "Jan 1, 1970", and not the series arm's copy. This
    // is an early return; the test exists because a fix that computed the
    // series first would have swallowed it.
    const { container } = renderFactsheet(payloadWith(89, "1970-01-01T00:00:00Z"));

    const chip = readChip(container);
    expect(chip.label).toBe("Computed · not yet");
    expect(chip.tone).toBe(MUTED);
    expect(chip.dateLine).toBe("N/A");
    expect(chip.dateLine).not.toContain("1970");
  });

  it("C-10: a FUTURE computedAt still reads 'future — check data', not fresh (NEW-C20-07)", () => {
    // A live series sits underneath, so a blend that took the FRESHER fact,
    // or that let the series arm overwrite the future arm, would render green
    // over a corrupt timestamp. The recorded arm survives intact.
    const future = new Date(Date.now() + 400 * DAY_MS).toISOString();
    const { container } = renderFactsheet(payloadWith(1, future));

    const chip = readChip(container);
    expect(chip.label).toBe("Computed · future — check data");
    expect(chip.tone).toBe(MUTED);
    expect(chip.tone).not.toBe(POSITIVE);
  });

  it("C-11: an unparseable computedAt still reads the colorless em dash", () => {
    // The non-finite guard. A fresh series must not upgrade a chip whose own
    // timestamp cannot be read — the honest answer stays "—".
    const { container } = renderFactsheet(payloadWith(1, "not-a-date"));

    const chip = readChip(container);
    expect(chip.label).toBe("Computed · —");
    expect(chip.tone).toBe(MUTED);
    // No "(Nd)" age can be printed for an age that does not exist.
    expect(chip.dateLine).toBe("—");
  });

  it("C-12: the date line still stamps the COMPUTE date — provenance was not traded away", () => {
    // The cheap version of this fix is to point the chip's date line at the
    // series end. It would be self-consistent and it would cost the surface
    // the one date only this line carries (DESIGN.md: a dated document; a
    // metric with no provenance fails the print test), while duplicating the
    // sentence directly below it. So: the eyebrow names the track record, the
    // date line stamps the compute, and the line names the series end.
    const computedAt = isoHoursAgo(1);
    const { container } = renderFactsheet(payloadWith(89, computedAt));

    const chip = readChip(container);
    expect(chip.label).toBe("Track record · old");
    // Expected string built by this file's own formatter, never the component's.
    expect(chip.dateLine).toBe(`${usDate(computedAt)}(0d)`);
    // …and it is NOT the series end, which the line below owns.
    expect(chip.dateLine).not.toContain(usDate(ymdDaysAgo(89)));
    expect(recencyLineText(container)).toBe(`Track record through ${usDate(ymdDaysAgo(89))}`);
  });
});

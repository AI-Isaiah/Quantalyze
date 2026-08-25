import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 162 / HONEST-02 (D-162-2, UI-SPEC § C-1) — the series-recency line.
 *
 * WHY these assertions matter, not just what they check:
 *
 *   1. THE LINE IS AN INTEGRITY CLAIM, NOT A CAPTION. The chip above it says
 *      when analytics last RAN; this line says where the TRACK RECORD ends.
 *      The 162 census measured a strategy where those two facts diverged by
 *      111 days — a live, error-free, non-rate-limited, non-disconnected key
 *      whose venue-side watermark had not moved since May while the poller
 *      kept succeeding daily. The chip read fresh over a dead track. An
 *      allocator who sees only the chip infers a live record. So the copy is
 *      pinned VERBATIM and the expected date is TYPED here, never imported
 *      and never re-derived from the component's own formatter — an imported
 *      literal or a shared helper would make the oracle self-referential and
 *      a copy rewrite could never fail this file.
 *
 *   2. F-2 IS THE ANTI-DRIFT PIN, AND IT COMPARES TWO RENDERED SURFACES.
 *      The recency line and the chip's date line sit on adjacent rows. If they
 *      ever formatted the same calendar day differently ("May 6, 2026" beside
 *      "2026-05-06"), that is two renderings of one fact — a small dishonesty
 *      on a surface whose entire subject is honesty. The assertion therefore
 *      reads the STRING OUT OF EACH ELEMENT and compares them; asserting the
 *      implementation's formatter against itself would pass for any format,
 *      including a divergent one (the self-referential-oracle trap named in
 *      162-VALIDATION).
 *
 *   3. F-3 PINS ABSENCE, WHICH IS THE HONEST RENDER. With no resolvable series
 *      end there is no claim to make. "Track record through —" would be a
 *      sentence asserting a fact it does not have; the chip's existing
 *      "Computed · not yet" state already covers the no-analytics case. Zero
 *      nodes — not a hidden node, not a placeholder — is the contract.
 *
 *   4. F-4 IS WHY THE LINE LIVES IN A WRAPPER. D-162-2 is explicitly ADDITIVE:
 *      no fourth freshness ladder, no tone change, chip anatomy untouched. The
 *      shortest implementation (render the line inside FreshnessChip) would
 *      have violated that silently. F-4 makes the violation FAIL: the chip's
 *      own subtree must serialize byte-identically whether the line renders or
 *      not. The two payloads differ ONLY in their series, and the chip consumes
 *      only `computedAt` — so any byte of difference is contamination.
 *
 * Stub block (sentry + localStorage + next/navigation) mirrors
 * FactsheetView.owner-notice.test.tsx verbatim: FactsheetProvider's persistence
 * primitive touches localStorage on mount, and the masthead is rendered here
 * (not hidden), so the owner-lane harness is the right analog.
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
// Installed PER TEST, not at module scope — `vitest.config.ts` sets
// `unstubGlobals: true`, so a stub applied once at import time is already gone
// by the time the first test runs (DEF-16-1).
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// The census subject's real series end. Both the ISO input and its expected
// rendering are typed literally — the expected string is NEVER produced by
// calling the component's formatter.
const SERIES_END = "2026-05-06";
const SERIES_END_RENDERED = "May 6, 2026";
const RECENCY_PREFIX = "Track record through ";
const RECENCY_LINE = `${RECENCY_PREFIX}${SERIES_END_RENDERED}`;
// A `computed_at` on the SAME calendar day as the series end. This is what
// lets F-2 compare the two adjacent surfaces for one date — and it is also the
// shape of the dishonest case in the wild, where the chip's date and the
// series' date drift apart over months.
const COMPUTED_AT = `${SERIES_END}T00:00:00Z`;

/** n daily-return points whose LAST point falls exactly on `endIso`. */
function makeReturnsSeriesEndingOn(n: number, endIso: string, drift = 0.0015): DailyPoint[] {
  const end = new Date(`${endIso}T00:00:00Z`);
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

/** Healthy ~300-point payload whose series ends on SERIES_END. */
const populatedPayload: FactsheetPayload = {
  ...buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeriesEndingOn(300, SERIES_END),
    benchmark: null,
  }),
  computedAt: COMPUTED_AT,
};

/**
 * The adapter's supported safe-empty blend (`portfolioDaily: []` → every array
 * empty, `dates: []`) — a real render path, exercised by
 * FactsheetBody.degenerate.test.tsx. Same `computedAt` as the populated
 * payload, so the chip is the CONTROLLED variable in F-4.
 */
const emptySeriesPayload: FactsheetPayload = {
  ...buildScenarioFactsheetPayload({ portfolioDaily: [], benchmark: null }),
  computedAt: COMPUTED_AT,
};

/** Populated series whose LAST date does not parse — the other unknown-date arm. */
const unparseableEndPayload: FactsheetPayload = {
  ...populatedPayload,
  dates: [...populatedPayload.dates.slice(0, -1), "not-a-date"],
};

function renderFactsheet(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
}

/**
 * The FreshnessChip's root element, located WITHOUT any hook added for the
 * test: its label row carries `tracking-[0.18em]`, which is unique in the
 * masthead (the eyebrow uses 0.22em, the self-reported tag 0.14em).
 */
function chipRoot(container: HTMLElement): HTMLElement {
  const header = container.querySelector("header");
  expect(header).not.toBeNull();
  const labelRow = header!.querySelector('[class*="tracking-[0.18em]"]');
  expect(labelRow, "FreshnessChip label row not found").not.toBeNull();
  const root = labelRow!.parentElement;
  expect(root).not.toBeNull();
  return root as HTMLElement;
}

/** The recency line element, queried by its copy — absent ⇒ null. */
function recencyLine(container: HTMLElement): HTMLElement | null {
  const header = container.querySelector("header");
  if (!header) return null;
  return (
    (Array.from(header.querySelectorAll("p")).find((p) =>
      (p.textContent ?? "").startsWith(RECENCY_PREFIX),
    ) as HTMLElement | undefined) ?? null
  );
}

describe("FactsheetView — series-recency line (HONEST-02 / D-162-2 / UI-SPEC C-1)", () => {
  it("F-1: renders the exact copy, keyed on the series' last point, in the muted caption tier", () => {
    const { container } = renderFactsheet(populatedPayload);

    const line = recencyLine(container);
    expect(line, "recency line did not render").not.toBeNull();
    // Copy pinned verbatim — D-162-2's fixed string, and the date is the
    // SERIES end, not `computedAt`'s. (Here they coincide by fixture design;
    // F-1b below breaks them apart so the data source itself is falsifiable.)
    expect(line!.textContent).toBe(RECENCY_LINE);

    // Typography contract: muted caption, DM Sans sentence case. NOT the
    // uppercase mono eyebrow the chip's own label row uses — splitting the
    // fixed copy string across two voices was the rejected shape.
    expect(line!.className).toContain("text-caption");
    expect(line!.className).toContain("text-text-muted");
    expect(line!.className).not.toContain("font-mono");
    expect(line!.className).not.toContain("uppercase");
    // Colorless: no semantic tone token, and no status dot.
    expect(line!.className).not.toMatch(/text-(positive|negative|warning|accent)/);
    expect(line!.querySelector("span[aria-hidden]")).toBeNull();
    // No ARIA — static content in normal document flow, read in sequence
    // after the chip. A live-region here would announce a fact that never
    // changes within a session.
    expect(line!.getAttribute("role")).toBeNull();
    expect(line!.getAttribute("aria-live")).toBeNull();

    // Placement: directly below the chip's date line, mt-1 — the chip's
    // immediate next sibling, inside the same freshness block.
    const chip = chipRoot(container);
    expect(line!.className).toContain("mt-1");
    expect(chip.nextElementSibling).toBe(line);
    expect(chip.contains(line)).toBe(false);
  });

  it("F-1b: the date follows the SERIES, not `computedAt` — the whole point of the line", () => {
    // The dishonest case in the wild: analytics recomputed today over a track
    // that ended in May. If the line ever keyed on `computedAt` (or on any
    // sync timestamp) it would read the recompute date here and this fails.
    const { container } = renderFactsheet({
      ...populatedPayload,
      computedAt: "2026-08-20T09:00:00Z",
    });

    const line = recencyLine(container);
    expect(line, "recency line did not render").not.toBeNull();
    expect(line!.textContent).toBe(RECENCY_LINE);
    expect(line!.textContent).not.toContain("Aug 20, 2026");
  });

  it("F-2: renders the date BYTE-IDENTICALLY to the chip's date line one row above", () => {
    const { container } = renderFactsheet(populatedPayload);

    const chip = chipRoot(container);
    const chipDateEl = chip.querySelector("p");
    expect(chipDateEl, "chip date line not found").not.toBeNull();
    // The chip appends a "(Nd)" age suffix; strip only that, never the date.
    const chipDate = (chipDateEl!.textContent ?? "").replace(/\s*\(\d+d\)$/, "");

    const line = recencyLine(container);
    expect(line).not.toBeNull();
    const recencyDate = (line!.textContent ?? "").slice(RECENCY_PREFIX.length);

    // Both strings are READ OUT OF THE DOM. Neither side is produced by
    // calling the implementation's formatter, so a second inline format on
    // either row fails here.
    expect(chipDate).not.toBe("");
    expect(chipDate).not.toBe("—");
    expect(recencyDate).toBe(chipDate);
  });

  it("F-3a: renders NO line at all when the series is empty — absence, not a placeholder", () => {
    const { container } = renderFactsheet(emptySeriesPayload);

    expect(recencyLine(container)).toBeNull();
    // Belt and braces: not merely a different element, but no such sentence
    // anywhere in the document — no "Track record through —".
    expect(container.textContent).not.toContain(RECENCY_PREFIX.trim());
    expect(container.textContent).not.toContain("Track record");
  });

  it("F-3b: renders NO line when the series' last date does not parse", () => {
    const { container } = renderFactsheet(unparseableEndPayload);

    expect(recencyLine(container)).toBeNull();
    expect(container.textContent).not.toContain("Track record");
  });

  it("F-4: FreshnessChip serializes byte-identically with and without the line", () => {
    // The two payloads share `computedAt` and differ only in their series, so
    // the chip — a function of `computedAt` alone — must be unchanged. This is
    // the additive-by-contract proof (D-162-2), and it is what forbids the
    // shorter implementation that renders the line inside the chip.
    const withLine = renderFactsheet(populatedPayload);
    const withoutLine = renderFactsheet(emptySeriesPayload);

    expect(recencyLine(withLine.container)).not.toBeNull();
    expect(recencyLine(withoutLine.container)).toBeNull();

    expect(chipRoot(withLine.container).outerHTML).toBe(
      chipRoot(withoutLine.container).outerHTML,
    );
  });
});

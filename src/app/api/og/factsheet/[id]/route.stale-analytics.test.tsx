/** @vitest-environment node */
/**
 * STALE-01 part 2 — the OG social card must not recompute a dead run's track.
 *
 * This route does NOT read the stored KPI columns; it recomputes Sharpe / CAGR
 * / Max DD IN-ROUTE from `daily_returns` (or by differencing `returns_series`).
 * That put it outside `shapeRowAnalytics` entirely, and the SERIES is a job
 * output too — a run that did not finish leaves the PREVIOUS run's track
 * sitting in those columns, with nothing in the array to say which run wrote
 * it. Before this fix the route did not even PROJECT `computation_status`.
 *
 * ⚠️ WHY THIS SURFACE IS THE WORST PLACE TO LEAK ONE. The response carries
 * `s-maxage=86400, stale-while-revalidate=604800`, so a single render of a dead
 * figure is served from CDN for a day and revalidated against for a week — long
 * after the underlying row is fixed. And its readers are Slack / LinkedIn /
 * Twitter unfurl caches, which keep their OWN copy and show it to people who
 * never open the page and so never see a correction.
 *
 * THE FIX REUSES THE ROUTE'S OWN DESIGNED ANSWER. Its docblock already says
 * "Renders even if analytics aren't ready — falls back to name-only", and
 * `fmtNum`/`fmtPct` already render the NaN sentinel as an em-dash. A
 * non-terminal row is the same answer to the same question, so it takes the
 * same path: name + description + three em-dashes. No new layout, no error
 * card, and the route still cannot 500.
 *
 * ANTI-VACUITY: the fixture carries a REAL, usable 40-point return series that
 * computes to finite, non-zero metrics — proven by the `complete` control in
 * the same file, which asserts the em-dashes are ABSENT and the numbers
 * present. So neither direction can pass on an empty series.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const seeded = vi.hoisted(() => ({
  strategyRow: null as unknown,
  captured: null as unknown,
}));

// `next/og` needs a real font/wasm pipeline; stub it to capture the element the
// route builds. The captured tree is then rendered to plain markup below, so
// the assertions read the SAME strings a viewer of the PNG would see.
vi.mock("next/og", () => ({
  ImageResponse: class {
    headers = new Headers();
    constructor(element: unknown) {
      seeded.captured = element;
    }
  },
}));

vi.mock("@/lib/visibility", () => ({
  withPublishedOnly: (qb: unknown) => qb,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () =>
        Promise.resolve({ data: seeded.strategyRow, error: null });
      return chain;
    },
  }),
}));

import { GET } from "./route";

// --- Fixtures -------------------------------------------------------------

const STRATEGY_ID = "51a10001-0000-4000-8000-00000000000b";

/**
 * A REAL series: 40 drifting-up observations spread over ~390 CALENDAR days.
 * Both of `computeOgHeadline`'s gates are cleared deliberately — ≥30 finite
 * observations (Sharpe / Max DD) AND a ≥0.95-year span (CAGR) — so all three
 * headline figures are finite. The `complete` control proves exactly that.
 */
const REAL_SERIES = Array.from({ length: 40 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 0, 1) + i * 10 * 24 * 60 * 60 * 1000);
  return {
    date: d.toISOString().slice(0, 10),
    value: i % 3 === 0 ? -0.004 : 0.006,
  };
});

function seedStrategy(status: string) {
  seeded.strategyRow = {
    id: STRATEGY_ID,
    name: "Orpheus",
    codename: "Orpheus",
    description: "A momentum book.",
    asset_class: "crypto",
    strategy_analytics: {
      daily_returns: REAL_SERIES,
      returns_series: null,
      computation_status: status,
    },
  };
}

async function renderCard(status: string): Promise<string> {
  seedStrategy(status);
  seeded.captured = null;
  await GET(new Request("http://localhost/api/og/factsheet/x"), {
    params: Promise.resolve({ id: STRATEGY_ID }),
  });
  expect(seeded.captured, "the route did not build an ImageResponse").not.toBeNull();
  return renderToStaticMarkup(seeded.captured as ReactElement);
}

/** The card's own em-dash sentinel, one per Stat. */
const EM_DASH = "—";

function emDashCount(markup: string): number {
  return markup.split(EM_DASH).length - 1;
}

beforeEach(() => {
  seeded.strategyRow = null;
  seeded.captured = null;
});

describe("STALE-01 · OG factsheet card — CDN-cached, unfurl-cached", () => {
  it("O1: a `failed` row yields three em-dashes, not three recomputed figures", async () => {
    const markup = await renderCard("failed");

    expect(emDashCount(markup)).toBe(3);
    // The three Stat labels are still there — the card is not blanked, only
    // its claims are withheld.
    expect(markup).toContain("Sharpe");
    expect(markup).toContain("CAGR");
    expect(markup).toContain("Max DD");
  });

  it("O2: the card still names the strategy — the fallback is name-only, not a 500", async () => {
    const markup = await renderCard("failed");

    expect(markup).toContain("Orpheus");
    expect(markup).toContain("A momentum book.");
  });

  it("O3: a live `computing` run is withheld the same way", async () => {
    const markup = await renderCard("computing");

    expect(emDashCount(markup)).toBe(3);
  });

  it("O4: CONTROL — a `complete` row computes and prints all three figures", async () => {
    const markup = await renderCard("complete");

    // Zero em-dashes is what proves the fixture series is genuinely usable:
    // if it were not, O1/O3 would pass vacuously.
    expect(
      emDashCount(markup),
      "the fixture series does not compute — O1/O3 would be vacuous",
    ).toBe(0);
    expect(markup).toMatch(/\d\.\d\d/); // Sharpe, e.g. "1.23"
    expect(markup).toMatch(/%/); // CAGR / Max DD
  });

  it("O5: CONTROL — `complete_with_warnings` is a terminal SUCCESS and computes too", async () => {
    const markup = await renderCard("complete_with_warnings");

    expect(emDashCount(markup)).toBe(0);
  });

  it("O6: a MISSING analytics row keeps the pre-existing name-only fallback", async () => {
    seeded.strategyRow = {
      id: STRATEGY_ID,
      name: "Orpheus",
      codename: null,
      description: null,
      asset_class: "crypto",
      strategy_analytics: null,
    };
    seeded.captured = null;
    await GET(new Request("http://localhost/api/og/factsheet/x"), {
      params: Promise.resolve({ id: STRATEGY_ID }),
    });
    const markup = renderToStaticMarkup(seeded.captured as ReactElement);

    expect(emDashCount(markup)).toBe(3);
    expect(markup).toContain("Orpheus");
  });
});

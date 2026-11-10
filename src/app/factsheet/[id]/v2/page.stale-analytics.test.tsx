/** @vitest-environment jsdom */
/**
 * STALE-01 part 2 — THE STRUCTURAL ONE: the page both PDF wrappers screenshot.
 *
 * `/api/factsheet/[id]/pdf` refuses a non-computed strategy with a 400
 * "Analytics not computed" — and then `page.goto()`s `/factsheet/[id]`, which
 * re-exports THIS module. `/api/factsheet/[id]/tearsheet.pdf` does the same for
 * the tearsheet. Both wrappers were guarding a front door beside an open side
 * door: the pages they screenshot are directly reachable URLs and neither
 * refused anything, so every figure the PDF withheld was served in full to
 * anyone who typed the page URL. The wrappers are deliberately UNCHANGED; the
 * pages now hold the same line, which is what makes their refusal mean
 * something.
 *
 * The defect here is subtler than a missing column. `computation_status` was
 * ALREADY on this page's analytics embed and ALREADY read — but only as an
 * argument passed down into `readSingleKeyBasisOpts`. Nothing gated the RENDER
 * on it. The render gate was `dailyReturns.length === 0`, and a failed run
 * leaves the previous run's `daily_returns` / `returns_series` untouched (the
 * writer stamps the status and the error, not the data), so the gate never
 * fired and the whole panel set was built from a track no finished run
 * vouches for. That is the recurring shape of this defect class across the
 * codebase: the status is selected, and then never filtered.
 *
 * The fix returns the EXISTING `null`, which the caller already renders as the
 * "still computing" placeholder it shows for any strategy whose series has not
 * been ingested. No new state, no new copy, nothing red.
 *
 * ANTI-VACUITY: the fixture carries a REAL 10-point cash series that builds a
 * full payload — proven by the `complete` control in this file, which asserts
 * the payload is PRESENT with real metrics. So the failed-row assertions cannot
 * pass because the fixture had nothing to build from.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
}));
// unstable_cache → identity: this spec exercises the REAL fetchAndBuildPayload,
// not Next's cache plumbing.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));
vi.mock("@/lib/visibility", () => ({
  withPublishedOnly: (qb: unknown) => qb,
  withPublishedOrOwner: (qb: unknown) => qb,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({
  readPublicVerificationSignals: vi.fn(),
}));

import FactsheetV2Page from "./page";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPublicVerificationSignals } from "@/lib/queries";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { degradePlainText } from "@/lib/degrade-warnings";

// --- Fixtures ---------------------------------------------------------------

const STRATEGY_ID = "51a10001-0000-4000-8000-00000000000c";

/** A REAL, buildable series — the `complete` control proves it builds. */
const CASH_DAILY = [
  { date: "2025-08-01", value: 0.01 },
  { date: "2025-08-02", value: -0.02 },
  { date: "2025-08-03", value: 0.015 },
  { date: "2025-08-04", value: 0.005 },
  { date: "2025-08-05", value: -0.01 },
  { date: "2025-08-06", value: 0.02 },
  { date: "2025-08-07", value: -0.005 },
  { date: "2025-08-08", value: 0.03 },
  { date: "2025-08-09", value: -0.015 },
  { date: "2025-08-10", value: 0.01 },
];

/** The row's `computed_at`: the date of the last SUCCESSFUL compute. */
const STORED_AT = "2026-08-25T09:15:00.000Z";

/**
 * Phase 190: the seven stored headline scalars a success write leaves in place.
 * Every one finite, so the "finite stored headline" evidence check holds.
 */
const STORED_HEADLINE = {
  cumulative_return: 0.0475,
  volatility: 0.21,
  max_drawdown: -0.03,
  cagr: 0.9,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.2,
};

/**
 * Per-test overrides of the analytics embed. Default `{}` keeps today's fixture
 * (CASH_DAILY, empty flags, no stored headline) byte-identical for V1, V2, V2b,
 * V4 and V5.
 */
type AnalyticsOverrides = Record<string, unknown>;

function strategyRow(computationStatus: string, overrides: AnalyticsOverrides = {}) {
  return {
    id: STRATEGY_ID,
    name: "Orpheus",
    codename: null,
    disclosure_tier: "exploratory",
    status: "published",
    markets: ["BTC"],
    strategy_types: ["momentum"],
    description: null,
    subtypes: [],
    supported_exchanges: ["binance"],
    leverage_range: null,
    aum: null,
    max_capacity: null,
    avg_daily_turnover: null,
    start_date: null,
    benchmark: null,
    asset_class: "crypto",
    returns_denominator_config: null,
    strategy_analytics: {
      daily_returns: CASH_DAILY,
      returns_series: null,
      // Re-stamped to the moment of FAILURE by the SQL status bridge.
      computed_at: STORED_AT,
      data_quality_flags: {},
      metrics_json_by_basis: null,
      computation_status: computationStatus,
      ...overrides,
    },
  };
}

function mockAdmin(strategy: unknown): SupabaseClient {
  const from = () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: strategy, error: null }),
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

/** Request-client stub for the outer signature probe (Lane A always hits). */
function mockRequestClient() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({
        data: {
          id: STRATEGY_ID,
          name: "Orpheus",
          codename: null,
          disclosure_tier: "exploratory",
          strategy_analytics: { computed_at: "2026-08-25T09:15:00.000Z" },
        },
        error: null,
      }),
  };
  return { from: () => chain };
}

/** Depth-first search of an RSC element tree for the FactsheetView payload. */
function findPayload(node: unknown): FactsheetPayload | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findPayload(child);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as { props?: { payload?: unknown; children?: unknown } };
  if (el.props?.payload != null) return el.props.payload as FactsheetPayload;
  return findPayload(el.props?.children ?? null);
}

/**
 * Depth-first collection of every string in an RSC element tree. 199-18: a registered line is a
 * `DegradeLine` element whose words ride its `segments` prop, not its children, so those are read
 * the way a reader sees them (`degradePlainText`).
 */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (typeof node === "object") {
    const el = node as { props?: { children?: unknown; segments?: unknown } };
    if (Array.isArray(el.props?.segments)) {
      out.push(degradePlainText(el.props.segments as Parameters<typeof degradePlainText>[0]));
    }
    collectText(el.props?.children ?? null, out);
  }
  return out;
}

async function renderPage(status: string, overrides: AnalyticsOverrides = {}) {
  vi.mocked(createAdminClient).mockReturnValue(mockAdmin(strategyRow(status, overrides)));
  return FactsheetV2Page({ params: Promise.resolve({ id: STRATEGY_ID }) });
}

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue(mockRequestClient() as never);
  vi.mocked(readPublicVerificationSignals).mockResolvedValue(
    new Map([[STRATEGY_ID, { trust_tier: "api_verified", status: "verified" }]]) as never,
  );
});

describe("STALE-01 · /factsheet/[id]/v2 — the page both PDF wrappers screenshot", () => {
  it("V1: a `failed` row builds NO payload — the panel set never renders", async () => {
    const ui = await renderPage("failed");

    expect(
      findPayload(ui),
      "the full factsheet was built from a run that did not finish",
    ).toBeNull();
  });

  it("V2: it falls to the neutral public placeholder, not a new error state", async () => {
    const ui = await renderPage("failed");
    const text = collectText(ui).join(" ");

    // KCS-10 (phase 167.2): the anchor MOVED from "still computing" to the one
    // neutral public sentence. "Still computing" was false for a failed or
    // never-started strategy, and the public lane cannot know which it is.
    expect(text).toContain(
      "The detailed factsheet for this strategy is not available yet.",
    );
    // The strategy is not deleted and is not shouted at: it keeps its name and
    // the page carries no error/failure vocabulary.
    expect(text).toContain("Orpheus");
    expect(text.toLowerCase()).not.toContain("failed");
    expect(text.toLowerCase()).not.toContain("error");
    // KCS-10: no promise of a compute that may not be coming, no timing, and
    // not the sentence that told a reader this page was all there is.
    expect(text).not.toContain("still computing");
    expect(text).not.toContain("few minutes");
    expect(text).not.toContain("Some strategies stay in this state");
  });
  // ── Criterion 9 (phase 164.2) ────────────────────────────────────────────
  // The placeholder above renders to an ANONYMOUS visitor: `renderPage` calls
  // FactsheetV2Page directly and the request-client stub carries no `auth`
  // member, so this is the public lane — the same surface measured on PROD at
  // /factsheet/8581f739-1a7b-42a4-a209-3acfa327e259 (`Fibonacci Ghost`), where
  // the italic line told the reader to "See the dev-server console for the
  // exact gate the request fell through" and volunteered the benchmark-window
  // bounds. A visitor has no dev-server console, and the render arm cannot
  // know WHICH of the three gates in the console.warn hint fired, so naming
  // one of them was a guess presented as a fact. The negatives below go RED
  // the moment that sentence returns to the render; the positive pins the
  // replacement's distinctive phrase so a silent re-wording cannot pass.
  it("V2b: criterion 9 — the ANONYMOUS placeholder (PROD /factsheet/8581f739-1a7b-42a4-a209-3acfa327e259) carries no dev-only instruction and no internal gate detail", async () => {
    const ui = await renderPage("failed");
    const text = collectText(ui).join(" ");

    expect(
      text,
      "an anonymous visitor has no dev-server console to open",
    ).not.toContain("dev-server console");
    expect(
      text,
      "the benchmark-window gate is an internal detail, and only one of three possible causes",
    ).not.toContain("bundled benchmark window");
    expect(text, "the benchmark window's start date is internal").not.toContain("2023-04-26");

    // Positives: KCS-10 (phase 167.2) MOVED both anchors to the one neutral
    // public sentence, which replaced the two paragraphs this test used to
    // pin. The full sentence and its distinctive phrase are both pinned, so a
    // silent re-wording cannot pass.
    expect(text).toContain(
      "The detailed factsheet for this strategy is not available yet.",
    );
    expect(text).toContain("is not available yet");
  });

  // Phase 190 SC-3 (D-02). WHY this changed: the founder's computed factsheet
  // vanished behind the queued placeholder while a redundant re-run sat in the
  // queue. The previous V3 premise ("no honest date to show the previous run's
  // numbers under") ended when Phase 166.5 made ONLY the runner's success write
  // stamp computed_at: the stored computed_at is now the date of the last good
  // compute, so the numbers can be shown under it. The payload must carry the
  // flag that tells the reader the figures predate the running computation.
  it("V3: a `computing` run over a stored success result keeps the factsheet and flags it as updating (phase 190 SC-3)", async () => {
    const ui = await renderPage("computing", {
      ...STORED_HEADLINE,
      data_quality_flags: { cumulative_method: "geometric" },
    });
    const payload = findPayload(ui);

    expect(
      payload,
      "a re-run over a stored success result must not hide the computed factsheet",
    ).not.toBeNull();
    expect(payload!.analyticsUpdating).toBe(true);
    // SC-6: the date shown is the stored last-good one, never a new time.
    expect(payload!.computedAt).toBe(STORED_AT);
  });

  // Phase 190 SC-3 across the derive hop. WHY: the derive hop REPLACES
  // data_quality_flags minutes before the compute hop's success write, with a
  // prestamp that never carries cumulative_method. Without plan 09's
  // last_success_snapshot, the founder's factsheet would vanish halfway through
  // the SAME re-run (the plan-check finding behind plan 09). The build must read
  // the snapshot's flags, so the figures sit beside the flags their own success
  // wrote: `small_base_measured` exists only in the snapshot here.
  it("V3b: a `computing` run after the derive prestamp reads the bound snapshot's flags (phase 190 SC-3, D-02)", async () => {
    const ui = await renderPage("computing", {
      ...STORED_HEADLINE,
      data_quality_flags: {
        csv_source: true,
        last_success_snapshot: {
          computed_at: STORED_AT,
          flags: { cumulative_method: "geometric", small_base_measured: true },
        },
      },
    });
    const payload = findPayload(ui);

    expect(payload, "the derive prestamp must not hide the factsheet").not.toBeNull();
    expect(payload!.analyticsUpdating).toBe(true);
    expect(payload!.computedAt).toBe(STORED_AT);
    expect(
      payload!.dataQuality?.smallBaseMeasured,
      "the build read the live prestamp flags, not the flags the stored numbers' own success wrote",
    ).toBe(true);
  });

  // Phase 190 SC-4. WHY: a strategy with NO analytics yet has nothing honest to
  // show, so it must keep today's queued/computing placeholder. These rows carry
  // the headline and the success flags, so the missing stored series is the ONLY
  // reason they are withheld (anti-vacuity: V3 proves the same row builds when a
  // series is present).
  it.each(["computing", "pending"])(
    "SC-4: a `%s` row with no stored series stays withheld (the first-ever compute keeps the queued state)",
    async (status) => {
      const ui = await renderPage(status, {
        daily_returns: null,
        returns_series: null,
        ...STORED_HEADLINE,
        data_quality_flags: { cumulative_method: "geometric" },
      });

      expect(findPayload(ui)).toBeNull();
    },
  );

  // Phase 190 SC-6. WHY: shown numbers must never sit beside flags a different
  // run wrote. A derive prestamp written by code without plan 09 replaces the
  // flags with csv_source only and carries no snapshot, so the series and
  // headline are the last success's while the flags are the new derive's.
  it("SC-6: a `computing` row whose flags are csv_source only and carry no snapshot stays withheld", async () => {
    const ui = await renderPage("computing", {
      ...STORED_HEADLINE,
      data_quality_flags: { csv_source: true },
    });

    expect(findPayload(ui)).toBeNull();
  });

  it("SC-6: a snapshot bound to a different success than the row's computed_at is never used", async () => {
    const ui = await renderPage("computing", {
      ...STORED_HEADLINE,
      data_quality_flags: {
        csv_source: true,
        last_success_snapshot: {
          computed_at: "2026-08-25T09:15:01.000Z",
          flags: { cumulative_method: "geometric" },
        },
      },
    });

    expect(findPayload(ui)).toBeNull();
  });

  // Phase 190 D-02: "the existing failed-status rules apply". A failed run
  // leaves the previous run's data in place (A2), so a failed row with a full
  // stored result and a bound snapshot must STILL be withheld, never flagged as
  // updating.
  it("SC-6: a `failed` row with a full stored result and a bound snapshot stays withheld", async () => {
    const ui = await renderPage("failed", {
      ...STORED_HEADLINE,
      data_quality_flags: {
        csv_source: true,
        last_success_snapshot: { computed_at: STORED_AT, flags: { cumulative_method: "geometric" } },
      },
    });

    expect(findPayload(ui)).toBeNull();
  });

  // ── Phase 190 D-04 (founder 2026-11-03, SC-6) ─────────────────────────────
  // WHY: the status bridge keeps a warned row's terminal status (and a ledger
  // refresh holds `complete`) while the derive hop REPLACES its flags with a
  // prestamp, until the compute hop's mark-computing. Without D-04 that factsheet
  // draws the last success's figures under the NEW run's warnings. The founder
  // chose the queued state over that mix. The prestamp is detected POSITIVELY by
  // its last_success_snapshot key, never by the missing marker alone.
  const PRESTAMP_FLAGS = { csv_source: true, twr_chain_broken: true, last_success_snapshot: null };

  it("D04-1: a `complete_with_warnings` row holding a derive prestamp and no bound snapshot is withheld, with no analyticsFailed", async () => {
    const ui = await renderPage("complete_with_warnings", {
      ...STORED_HEADLINE,
      data_quality_flags: PRESTAMP_FLAGS,
    });

    expect(findPayload(ui), "the last success's figures were drawn under the new derive's flags").toBeNull();
    const text = collectText(ui).join(" ").toLowerCase();
    expect(text).not.toContain("could not be computed");
  });

  it("D04-2: the same row with a snapshot one second off the row's computed_at is withheld", async () => {
    const ui = await renderPage("complete_with_warnings", {
      ...STORED_HEADLINE,
      data_quality_flags: {
        ...PRESTAMP_FLAGS,
        last_success_snapshot: {
          computed_at: "2026-08-25T09:15:01.000Z",
          flags: { cumulative_method: "geometric" },
        },
      },
    });

    expect(findPayload(ui)).toBeNull();
  });

  it("D04-3: a `complete` row (a ledger refresh holds it through the derive hop) holding the same prestamp is withheld", async () => {
    const ui = await renderPage("complete", {
      ...STORED_HEADLINE,
      data_quality_flags: PRESTAMP_FLAGS,
    });

    expect(findPayload(ui)).toBeNull();
  });

  // The controls carry the opposite WHY: a row AT REST must keep its factsheet,
  // and a legacy row that predates the marker must not vanish because of a rule
  // meant for a re-run. They are green before and after the D-04 withhold, so
  // they pin the at-rest guarantee, not the new code.
  it("D04-4: CONTROL — a `complete_with_warnings` row at rest (marker plus a warning flag, no snapshot key) builds, not updating", async () => {
    const ui = await renderPage("complete_with_warnings", {
      ...STORED_HEADLINE,
      data_quality_flags: { cumulative_method: "geometric", small_base_measured: true },
    });
    const payload = findPayload(ui);

    expect(payload).not.toBeNull();
    expect(payload!.analyticsUpdating).toBe(false);
  });

  it("D04-5: CONTROL — a terminal-success legacy row (no marker, no snapshot key) still builds", async () => {
    const ui = await renderPage("complete", {
      ...STORED_HEADLINE,
      data_quality_flags: { csv_source: true },
    });

    expect(findPayload(ui)).not.toBeNull();
  });

  it("D04-6: CONTROL — a `complete_with_warnings` prestamp WITH a bound snapshot builds from the snapshot's flags, not updating", async () => {
    const ui = await renderPage("complete_with_warnings", {
      ...STORED_HEADLINE,
      data_quality_flags: {
        ...PRESTAMP_FLAGS,
        last_success_snapshot: {
          computed_at: STORED_AT,
          flags: { cumulative_method: "geometric", small_base_measured: true },
        },
      },
    });
    const payload = findPayload(ui);

    expect(payload).not.toBeNull();
    expect(payload!.analyticsUpdating).toBe(false);
    expect(
      payload!.dataQuality?.smallBaseMeasured,
      "the build read the new derive's prestamp flags, not the flags the stored numbers' own success wrote",
    ).toBe(true);
  });

  it("V4: CONTROL — a `complete` row builds the full payload with real metrics", async () => {
    const ui = await renderPage("complete");
    const payload = findPayload(ui);

    // Non-null is what proves the fixture series is genuinely buildable: if it
    // were not, V1/V3 would pass vacuously.
    expect(
      payload,
      "the fixture series does not build — V1/V3 would be vacuous",
    ).not.toBeNull();
    expect(payload!.strategyName).toBe("Orpheus");
    expect(Number.isFinite(payload!.strategyMetrics.sharpe)).toBe(true);
    // Phase 190: a terminal-success payload is never flagged as updating.
    expect(payload!.analyticsUpdating).toBe(false);
  });

  it("V5: CONTROL — `complete_with_warnings` is a terminal SUCCESS and builds too", async () => {
    const ui = await renderPage("complete_with_warnings");

    expect(findPayload(ui)).not.toBeNull();
  });
});

/** @vitest-environment jsdom */
/**
 * Phase 167.1.2.2.2 (TRADESYNC, plan 11 Task 2) - the printed tear sheet states
 * the same two facts as the factsheet header: when the exchange was last read
 * (D-06, D-10) and which days nobody has supplied (D-02, F1).
 *
 * WHY these assertions matter:
 *
 *   1. THE ONE-PAGER IS WHAT GETS FORWARDED. `Data: Fresh` on this page names
 *      `computed_at`, which advances for an account that has not been fetched.
 *      Printing the pill without the trade-fetch line would let the document that
 *      leaves the product say "fresh" about a key that stopped being read nine
 *      days ago. The line is shown to EVERYONE (the route is public; the PDF
 *      wrapper fetches it with no session), so every case here is an anonymous
 *      viewer.
 *
 *   2. SAME WORDS, SAME VERDICT, SMALLER TYPE. The copy and the verdict come from
 *      `trade-fetch-lines.tsx`, the module the factsheet header uses, so the page
 *      and the one-pager cannot word one fact two ways. Only the size differs:
 *      `text-fixed-10` here, the fluid `text-caption` there. Every expected
 *      sentence is a typed literal.
 *
 *   3. SAME GATE AS THE PILL. A row that is not a terminal success has no
 *      `computed` moment and the pill is withheld (STALE-01); a trade-fetch line
 *      standing alone under a withheld pill would be a confident statement beside
 *      a grid of dashes, so both go together, and the extra read is not made at
 *      all.
 *
 *   4. THE VENUE IS THE API KEY'S (F3). A CSV strategy that declares okx has no
 *      key and is never fetched; it must not print "No trade fetch recorded yet".
 *
 *   5. FAIL TO NO CLAIM, LOUDLY (SFH-M2). If the read of the stamp or the gap
 *      record fails, or the stamp is malformed, the page renders and says
 *      `Trade fetch status unavailable` (neutral, muted), and the failure is sent
 *      to Sentry through `captureToSentry` (console.* does not reach Sentry). It
 *      never invents a stamp, a gap, or a "fresh" reading, and it NEVER prints
 *      `No trade fetch recorded yet` for a state it could not read: that
 *      sentence claims the read succeeded and found nothing, which is false for
 *      an unreadable or malformed row on a public, printable page.
 *
 * `FreshnessBadge` is stubbed to a marker so the DOM order (pill, then the two
 * statements, then `Generated`) can be asserted without its own clock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("@/components/charts/Sparkline", () => ({
  Sparkline: () => React.createElement("div", { "data-testid": "sparkline" }),
}));
vi.mock("@/components/ui/Disclaimer", () => ({
  Disclaimer: () => React.createElement("div", { "data-testid": "disclaimer" }),
}));
vi.mock("@/components/strategy/FreshnessBadge", () => ({
  FreshnessBadge: () => React.createElement("span", { "data-testid": "data-pill" }, "Data pill"),
}));
vi.mock("@/components/strategy/PercentileRankBadge", () => ({
  PercentileRankBadge: () => React.createElement("span"),
}));
vi.mock("@/components/ui/PrintButton", () => ({
  PrintButton: () => React.createElement("button", null, "Print"),
}));

const baseDetail = vi.hoisted(() => ({
  value: null as unknown,
}));

vi.mock("@/lib/queries", () => ({
  getFactsheetDetail: vi.fn(async () => baseDetail.value),
  getPercentiles: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import TearSheetPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureToSentry } from "@/lib/sentry-capture";

// ---------------------------------------------------------------------------
// Fixtures (typed literals)
// ---------------------------------------------------------------------------

const NOW = "2026-10-09T12:00:00Z";

function detail(computationStatus: string) {
  return {
    strategy: {
      id: "s-1",
      name: "Test Strategy",
      codename: "STRAT-001",
      status: "published",
      disclosure_tier: "exploratory",
      user_id: "u-1",
      strategy_types: ["Momentum"],
      markets: ["BTC"],
      start_date: "2024-01-01",
      leverage_range: "1x-2x",
      benchmark: "BTC",
      aum: 100_000,
      // F3 bait: a strategy may DECLARE okx without ever being trade-fetched.
      supported_exchanges: ["okx"],
      discovery_categories: { slug: "momentum" },
    },
    analytics: {
      cagr: 0.25,
      sharpe: 1.5,
      sortino: 2.0,
      max_drawdown: -0.1,
      volatility: 0.2,
      calmar: 2.5,
      six_month_return: 0.1,
      cumulative_return: 0.3,
      computed_at: "2026-10-09T03:00:00Z",
      computation_status: computationStatus,
      sparkline_returns: [0.01, 0.02, -0.01, 0.03],
      monthly_returns: { "2024": { Jan: 0.05 } },
      metrics_json: { var_1d_95: -0.02, cvar: -0.03, best_day: 0.04, worst_day: -0.02 },
    },
    manager: null,
    disclosureTier: "exploratory",
  };
}

type FactRead = {
  data: { api_keys?: unknown; strategy_analytics?: unknown } | null;
  error: { message: string } | null;
};

function factRead(opts: {
  exchange?: string | null;
  tradesFetchedAt?: string | null;
  seriesProvenance?: unknown;
}): FactRead {
  return {
    data: {
      api_keys: opts.exchange == null ? null : { exchange: opts.exchange },
      strategy_analytics: {
        trades_fetched_at: opts.tradesFetchedAt ?? null,
        series_provenance: opts.seriesProvenance ?? null,
      },
    },
    error: null,
  };
}

const adminSelects: string[] = [];
const adminFilters: Array<[string, unknown]> = [];
let adminFrom: ReturnType<typeof vi.fn>;

function stubAdmin(result: FactRead | "throw") {
  adminSelects.length = 0;
  adminFilters.length = 0;
  adminFrom = vi.fn(() => {
    const builder = {
      select: (cols: string) => {
        adminSelects.push(cols);
        return builder;
      },
      eq: (col: string, val: unknown) => {
        adminFilters.push([col, val]);
        return builder;
      },
      maybeSingle: async () => {
        if (result === "throw") throw new Error("trade fact read exploded");
        return result;
      },
    };
    return builder;
  });
  vi.mocked(createAdminClient).mockReturnValue({
    from: adminFrom,
  } as unknown as ReturnType<typeof createAdminClient>);
}

/** The request-scoped client: anonymous, and a USD unit read (no native unit). */
function stubAnonymousViewer() {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({
      data: { strategy_analytics: { data_quality_flags: {} } },
      error: null,
    }),
  };
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    from: vi.fn(() => builder),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

async function renderPage() {
  const page = await TearSheetPage({ params: Promise.resolve({ id: "s-1" }) });
  return render(page as React.ReactElement);
}

/** The header paragraphs about trade fetching, in document order. */
function fetchLine(container: HTMLElement): HTMLElement | null {
  const header = container.querySelector("header");
  return (
    (Array.from(header?.querySelectorAll("p") ?? []).find((p) =>
      /last trades fetched|trade fetch recorded|trade fetch time/i.test(p.textContent ?? ""),
    ) as HTMLElement | undefined) ?? null
  );
}

function unavailableLine(container: HTMLElement): HTMLElement | null {
  const header = container.querySelector("header");
  return (
    (Array.from(header?.querySelectorAll("p") ?? []).find(
      (p) => (p.textContent ?? "") === "Trade fetch status unavailable",
    ) as HTMLElement | undefined) ?? null
  );
}

function capturedReasons(): string[] {
  return vi
    .mocked(captureToSentry)
    .mock.calls.map(([, opts]) => (opts as { tags: Record<string, string> }).tags.reason);
}

function gapLines(container: HTMLElement): HTMLElement[] {
  const header = container.querySelector("header");
  return Array.from(header?.querySelectorAll("p") ?? []).filter((p) =>
    /^No trade data |more gaps? without trade data\.$/.test(p.textContent ?? ""),
  ) as HTMLElement[];
}

function rebuiltLines(container: HTMLElement): HTMLElement[] {
  const header = container.querySelector("header");
  return Array.from(header?.querySelectorAll("p") ?? []).filter((p) =>
    /rebuilt from OKX's quarterly account statement/.test(p.textContent ?? ""),
  ) as HTMLElement[];
}

const GAP_63 =
  "No trade data May 7, 2026 – Jul 8, 2026 (63 days). These days are not recovered; they are left out of the record, not counted as zero.";

beforeEach(() => {
  cleanup();
  vi.mocked(captureToSentry).mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  baseDetail.value = detail("complete");
  stubAnonymousViewer();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TearSheet page - trade-fetch line and named gaps (D-06, D-10, D-02, F1)", () => {
  it("a published strategy fetched 9 days ago: the stale sentence under the Data pill, fixed-10 and negative", async () => {
    stubAdmin(factRead({ exchange: "okx", tradesFetchedAt: "2026-09-30T12:00:00Z" }));
    const { container } = await renderPage();
    const line = fetchLine(container);
    expect(line, "trade-fetch line did not render").not.toBeNull();
    expect(line!.textContent).toBe("Stale: last trades fetched 9 days ago · Sep 30, 2026");
    expect(line!.className).toContain("text-fixed-10");
    expect(line!.className).toContain("text-negative");
    expect(line!.className).not.toContain("text-caption");
  });

  it("a current fetch reads muted (not negative) at the same size", async () => {
    stubAdmin(factRead({ exchange: "bybit", tradesFetchedAt: "2026-10-09T07:00:00Z" }));
    const { container } = await renderPage();
    const line = fetchLine(container)!;
    expect(line.textContent).toBe("Last trades fetched less than a day ago · Oct 9, 2026");
    expect(line.className).toContain("text-fixed-10");
    expect(line.className).toContain("text-text-muted");
    expect(line.className).not.toContain("text-negative");
  });

  it("one gap: the F1 sentence at text-fixed-10, secondary, never red or amber", async () => {
    stubAdmin(
      factRead({
        exchange: "okx",
        tradesFetchedAt: "2026-10-09T07:00:00Z",
        seriesProvenance: { unrecovered_gaps: [{ from: "2026-05-07", to: "2026-07-08" }] },
      }),
    );
    const { container } = await renderPage();
    const lines = gapLines(container);
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(GAP_63);
    expect(lines[0].className).toContain("text-fixed-10");
    expect(lines[0].className).toContain("text-text-secondary");
    expect(lines[0].className).not.toMatch(/text-negative|text-warning|text-caption/);
    expect(container.textContent).not.toMatch(/no longer serves?/i);
  });

  it("order: the Data pill, then the trade-fetch line, then the gap lines, then Generated", async () => {
    stubAdmin(
      factRead({
        exchange: "okx",
        tradesFetchedAt: "2026-09-30T12:00:00Z",
        seriesProvenance: { unrecovered_gaps: [{ from: "2026-05-07", to: "2026-07-08" }] },
      }),
    );
    const { container } = await renderPage();
    const pill = screen.getByTestId("data-pill");
    const line = fetchLine(container)!;
    const gap = gapLines(container)[0];
    const generated = Array.from(container.querySelectorAll("header p")).find((p) =>
      (p.textContent ?? "").startsWith("Generated"),
    )!;
    const before = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(pill, line)).toBe(true);
    expect(before(line, gap)).toBe(true);
    expect(before(gap, generated)).toBe(true);
    expect(line.nextElementSibling).toBe(gap);
  });

  it("a row that is not a terminal success renders neither line, and makes no extra read", async () => {
    baseDetail.value = detail("failed");
    stubAdmin(
      factRead({
        exchange: "okx",
        tradesFetchedAt: "2026-09-30T12:00:00Z",
        seriesProvenance: { unrecovered_gaps: [{ from: "2026-05-07", to: "2026-07-08" }] },
      }),
    );
    const { container } = await renderPage();
    expect(screen.queryByTestId("data-pill")).toBeNull();
    expect(fetchLine(container)).toBeNull();
    expect(gapLines(container)).toHaveLength(0);
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("F3: the venue is the API KEY's exchange - a strategy that only DECLARES okx (no key) prints no claim", async () => {
    // supported_exchanges is ["okx"] in the fixture; no api key row.
    stubAdmin(factRead({ exchange: null, tradesFetchedAt: null }));
    const { container } = await renderPage();
    expect(fetchLine(container)).toBeNull();
    expect(container.textContent).not.toMatch(/trade fetch recorded/i);
  });

  it("F2: a key-backed strategy with no stamp says `No trade fetch recorded yet`, never `not yet fetched`", async () => {
    stubAdmin(factRead({ exchange: "okx", tradesFetchedAt: null }));
    const { container } = await renderPage();
    expect(fetchLine(container)!.textContent).toBe("No trade fetch recorded yet");
    expect(container.textContent).not.toContain("not yet fetched");
  });

  it("zero gaps and no claim: nothing is added to the header", async () => {
    stubAdmin(factRead({ exchange: "deribit", tradesFetchedAt: null, seriesProvenance: {} }));
    const { container } = await renderPage();
    expect(fetchLine(container)).toBeNull();
    expect(gapLines(container)).toHaveLength(0);
  });

  it("the read is published-only and selects only what the lines need (T-32: the key embed is `exchange` alone)", async () => {
    stubAdmin(factRead({ exchange: "okx", tradesFetchedAt: "2026-10-09T07:00:00Z" }));
    await renderPage();
    expect(adminFrom).toHaveBeenCalledWith("strategies");
    const select = adminSelects[0];
    expect(select).toContain("trades_fetched_at");
    expect(select).toContain("series_provenance");
    expect(select).toMatch(/api_keys!strategies_api_key_id_fkey\s*\(\s*exchange\s*\)/);
    // No key material, no wildcard.
    expect(select).not.toMatch(/\*|api_key_encrypted|secret|passphrase|label/i);
    expect(adminFilters).toContainEqual(["status", "published"]);
    expect(adminFilters).toContainEqual(["id", "s-1"]);
  });

  it.each([
    ["an error result", { data: null, error: { message: "boom" } } as FactRead, "read_error"],
    ["a thrown read", "throw" as const, "read_threw"],
    ["no row for a strategy the page just rendered", { data: null, error: null } as FactRead, "no_row"],
  ])(
    "%s: the page renders, says the status is unavailable (never the false `never fetched` sentence), and reports to Sentry",
    async (_label, result, reason) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      stubAdmin(result);
      const { container } = await renderPage();
      expect(fetchLine(container)).toBeNull();
      expect(gapLines(container)).toHaveLength(0);
      const line = unavailableLine(container);
      expect(line, "the unavailable line did not render").not.toBeNull();
      // Neutral: muted, print size, never the stale colour or a warning token.
      expect(line!.className).toContain("text-fixed-10");
      expect(line!.className).toContain("text-text-muted");
      expect(line!.className).not.toMatch(/text-negative|text-warning|text-amber/);
      expect(container.textContent).not.toMatch(/No trade fetch recorded yet/i);
      // The rest of the page still rendered.
      expect(screen.getByTestId("data-pill")).toBeInTheDocument();
      expect(container.textContent).toContain("Institutional Tear Sheet");
      // Sentry, not just console: exactly one event, tagged and bound to the strategy.
      expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
      expect(capturedReasons()).toEqual([reason]);
      expect(vi.mocked(captureToSentry).mock.calls[0][1].tags).toMatchObject({
        stage: "tearsheet-trade-facts",
        strategy_id: "s-1",
      });
    },
  );

  it.each([
    ["a numeric stamp", 1759999999 as unknown],
    ["an object stamp", { at: "2026-10-09" } as unknown],
    ["an unparseable string stamp", "not-a-date" as unknown],
  ])(
    "%s on an OKX key: `Trade fetch status unavailable`, never the false `No trade fetch recorded yet`, and a Sentry event",
    async (_label, badStamp) => {
      stubAdmin({
        data: {
          api_keys: { exchange: "okx" },
          strategy_analytics: { trades_fetched_at: badStamp, series_provenance: null },
        },
        error: null,
      });
      const { container } = await renderPage();
      expect(unavailableLine(container)).not.toBeNull();
      expect(fetchLine(container)).toBeNull();
      expect(container.textContent).not.toMatch(/No trade fetch recorded yet/i);
      expect(capturedReasons()).toEqual(["malformed_field"]);
    },
  );

  it("a malformed stamp does not hide the gap record: the gap lines still render beside the unavailable line", async () => {
    stubAdmin({
      data: {
        api_keys: { exchange: "okx" },
        strategy_analytics: {
          trades_fetched_at: 42,
          series_provenance: { unrecovered_gaps: [{ from: "2026-05-07", to: "2026-07-08" }] },
        },
      },
      error: null,
    });
    const { container } = await renderPage();
    expect(unavailableLine(container)).not.toBeNull();
    expect(gapLines(container).map((p) => p.textContent)).toEqual([GAP_63]);
  });

  it("a non-string api-key exchange is malformed too: unavailable, not a silent venue drop", async () => {
    stubAdmin({
      data: {
        api_keys: { exchange: 7 },
        strategy_analytics: { trades_fetched_at: null, series_provenance: null },
      },
      error: null,
    });
    const { container } = await renderPage();
    expect(unavailableLine(container)).not.toBeNull();
    expect(capturedReasons()).toEqual(["malformed_field"]);
  });

  it("a healthy read reports nothing and prints no unavailable line (a CSV strategy: no key, no stamp, no claim)", async () => {
    stubAdmin(factRead({ exchange: null, tradesFetchedAt: null }));
    const { container } = await renderPage();
    expect(unavailableLine(container)).toBeNull();
    expect(fetchLine(container)).toBeNull();
    expect(vi.mocked(captureToSentry)).not.toHaveBeenCalled();
  });

  it("a malformed gap record names no gap (the parser voids it) and the fetch line still renders", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubAdmin(
      factRead({
        exchange: "okx",
        tradesFetchedAt: "2026-10-09T07:00:00Z",
        seriesProvenance: { unrecovered_gaps: [{ from: "2026-07-08", to: "2026-05-07" }] },
      }),
    );
    const { container } = await renderPage();
    expect(gapLines(container)).toHaveLength(0);
    expect(fetchLine(container)).not.toBeNull();
  });

  it("long text wraps: the lines and their wrapper carry no whitespace-nowrap or truncate", async () => {
    stubAdmin(
      factRead({
        exchange: "okx",
        tradesFetchedAt: "2026-09-30T12:00:00Z",
        seriesProvenance: {
          unrecovered_gaps: [
            { from: "2026-08-15", to: "2026-08-16" },
            { from: "2026-05-07", to: "2026-07-08" },
          ],
        },
      }),
    );
    const { container } = await renderPage();
    const els = [fetchLine(container)!, ...gapLines(container)];
    expect(els).toHaveLength(3);
    for (const el of els) {
      for (const target of [el, el.parentElement as HTMLElement]) {
        expect(target.className).not.toMatch(
          /whitespace-nowrap|(^|\s)truncate(\s|$)|text-ellipsis|overflow-hidden/,
        );
      }
    }
    // The statements share one wrapper that bounds their width so a long
    // sentence wraps inside the right-aligned column instead of widening it.
    expect(els[0].parentElement).toBe(els[1].parentElement);
    expect(els[0].parentElement!.className).toMatch(/max-w-/);
  });

  it("not hidden in print", async () => {
    stubAdmin(
      factRead({
        exchange: "okx",
        tradesFetchedAt: "2026-09-30T12:00:00Z",
        seriesProvenance: { unrecovered_gaps: [{ from: "2026-05-07", to: "2026-07-08" }] },
      }),
    );
    const { container } = await renderPage();
    for (const el of [fetchLine(container)!, gapLines(container)[0]]) {
      expect(el.closest(".print\\:hidden")).toBeNull();
      expect(el.className).not.toMatch(/print:hidden|\bhidden\b/);
    }
  });

  // Phase 167.1.2.2.2.1 (OKXHISTORY, plan 06) - D-06: the printed tear sheet
  // carries the same founder sentence as the factsheet, at the print size, so a
  // forwarded one-pager that counts rebuilt days in its headline says so.
  it("D-06: a stored reconstructed range prints the founder's sentence at text-fixed-10, muted-secondary", async () => {
    stubAdmin(
      factRead({
        exchange: "okx",
        tradesFetchedAt: "2026-10-09T07:00:00Z",
        seriesProvenance: {
          reconstructed_ranges: [
            { from: "2026-07-01", to: "2026-08-01", source: "okx_bills_history_archive" },
          ],
        },
      }),
    );
    const { container } = await renderPage();
    const lines = rebuiltLines(container);
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(
      "Jul 1, 2026 – Aug 1, 2026: rebuilt from OKX's quarterly account statement, not the live feed.",
    );
    expect(lines[0].className).toContain("text-fixed-10");
    expect(lines[0].className).toContain("text-text-secondary");
    expect(lines[0].className).not.toMatch(/text-caption|text-negative|text-warning/);
    expect(lines[0].closest(".print\\:hidden")).toBeNull();
  });

  it("D-06: no reconstructed_ranges key renders zero matching nodes", async () => {
    stubAdmin(factRead({ exchange: "okx", tradesFetchedAt: "2026-10-09T07:00:00Z", seriesProvenance: {} }));
    const { container } = await renderPage();
    expect(rebuiltLines(container)).toHaveLength(0);
    expect(container.textContent).not.toContain("quarterly account statement");
  });

  it("SC-4: a partly rebuilt gap prints the remaining gap line AND the reconstructed line, each once, gap first", async () => {
    stubAdmin(
      factRead({
        exchange: "okx",
        tradesFetchedAt: "2026-10-09T07:00:00Z",
        seriesProvenance: {
          unrecovered_gaps: [{ from: "2026-05-24", to: "2026-06-30" }],
          reconstructed_ranges: [
            { from: "2026-07-01", to: "2026-08-01", source: "okx_bills_history_archive" },
          ],
        },
      }),
    );
    const { container } = await renderPage();
    const gaps = gapLines(container);
    const rebuilt = rebuiltLines(container);
    expect(gaps.map((p) => p.textContent)).toEqual([
      "No trade data May 24, 2026 – Jun 30, 2026 (38 days). These days are not recovered; they are left out of the record, not counted as zero.",
    ]);
    expect(rebuilt.map((p) => p.textContent)).toEqual([
      "Jul 1, 2026 – Aug 1, 2026: rebuilt from OKX's quarterly account statement, not the live feed.",
    ]);
    expect(gaps[0].nextElementSibling).toBe(rebuilt[0]);
  });

  // Review round 1, F5 / IN-01: a malformed reconstructed_ranges record reaches
  // Sentry and the page says the record is unavailable, instead of rendering
  // nothing for rebuilt days the RPC already removed from unrecovered_gaps.
  describe("malformed reconstructed_ranges (F5 / IN-01)", () => {
    const UNAVAILABLE =
      "Record of rebuilt days unavailable. Some days may come from a quarterly statement, not the live feed.";

    function recordUnavailableLines(container: HTMLElement): HTMLElement[] {
      const header = container.querySelector("header");
      return Array.from(header?.querySelectorAll("p") ?? []).filter((p) =>
        /^Record of rebuilt days unavailable/.test(p.textContent ?? ""),
      ) as HTMLElement[];
    }

    it("reports one Sentry event tagged to the strategy and prints the unavailable sentence at text-fixed-10", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      stubAdmin(
        factRead({
          exchange: "okx",
          tradesFetchedAt: "2026-10-09T07:00:00Z",
          seriesProvenance: {
            reconstructed_ranges: [{ from: "2026-07-01", to: "2026-08-01", source: "manual" }],
          },
        }),
      );
      const { container } = await renderPage();
      const lines = recordUnavailableLines(container);
      expect(lines).toHaveLength(1);
      expect(lines[0].textContent).toBe(UNAVAILABLE);
      expect(lines[0].className).toContain("text-fixed-10");
      expect(lines[0].className).toContain("text-text-secondary");
      expect(lines[0].className).not.toMatch(/text-negative|text-warning|text-amber/);
      expect(rebuiltLines(container)).toHaveLength(0);
      // The fetch line is unaffected.
      expect(fetchLine(container)).not.toBeNull();
      expect(unavailableLine(container)).toBeNull();
      // Sentry, not just console.
      expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
      expect(capturedReasons()).toEqual(["reconstructed_ranges_malformed"]);
      expect(vi.mocked(captureToSentry).mock.calls[0][1]).toMatchObject({
        tags: { stage: "tearsheet-trade-facts", strategy_id: "s-1" },
        extra: { detail: "an entry carries an unknown source" },
      });
    });

    it("a healthy or absent record reports nothing and prints no unavailable sentence", async () => {
      stubAdmin(
        factRead({ exchange: "okx", tradesFetchedAt: "2026-10-09T07:00:00Z", seriesProvenance: {} }),
      );
      const { container } = await renderPage();
      expect(recordUnavailableLines(container)).toHaveLength(0);
      expect(vi.mocked(captureToSentry)).not.toHaveBeenCalled();
    });
  });
});

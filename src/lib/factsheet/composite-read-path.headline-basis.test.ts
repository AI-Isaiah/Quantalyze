import { describe, it, expect, vi } from "vitest";

// `composite-read-path` imports `server-only` (a Next.js RSC build guard).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyHeadlineBasis, readCompositeFactsheet, readSingleKeyBasisOpts } from "./composite-read-path";
import { captureToSentry } from "@/lib/sentry-capture";
import { headlineCoverageNote } from "@/app/factsheet/[id]/v2/MetricsColumn";
import { buildFactsheetPayload } from "./build-payload";
import { BASIS_KPI_MAP } from "./basis-metrics";
import type { DailyReturn } from "./types";

/**
 * Phase 164.6.6.3.3 (D-01 note payload, D-03) — the read path decides, from ONE
 * marker (`data_quality_flags.headline_since`), whether a chain-broken headline
 * covers one span (Dated: figures kept, span and reasons carried) or is a legacy
 * mixed-basis row (Withheld: the seven stored scalars read null).
 */

const SPARSE_ROWS = [
  { date: "2025-08-01", daily_return: 0.01 },
  { date: "2025-08-02", daily_return: 0.02 },
];

function mockAdmin(smoothedSeriesPayload: unknown = null): SupabaseClient {
  // Honours the keyset cursor, as PostgREST does, so the paged read terminates.
  let after: string | null = null;
  let kind: string | null = null;
  const chain = {
    select: () => chain,
    eq: (column: string, value: string) => {
      if (column === "kind") kind = value;
      return chain;
    },
    gt: (_column: string, value: string) => {
      after = value;
      return chain;
    },
    order: () => chain,
    limit: () =>
      Promise.resolve({
        data: SPARSE_ROWS.filter((r) => after === null || r.date > after),
        error: null,
      }),
    maybeSingle: () =>
      Promise.resolve({
        data:
          kind === "smoothed_mtm_daily_returns" && smoothedSeriesPayload !== null
            ? { payload: smoothedSeriesPayload }
            : null,
        error: null,
      }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

// The D-12 dqf shape: a composite whose chain broke on a dust balance and a
// flow-dominated day, measured since a marker day. The flow-dominated flag is
// the RETIRED one (164.6.6.2.3 D-14): a stored row keeps it until the recompute,
// and every reader must ignore it. It stays in this stored shape on purpose.
const D12_DQF = {
  composite: true,
  twr_chain_broken: true,
  dust_nav_guard: true,
  flow_dominated_guard: true,
};

// A chain-broken cash headline with the zeroes a legacy mixed-basis row holds.
const LEGACY_CASH = {
  cumulative_return: 0,
  volatility: 0.12,
  max_drawdown: -0.04,
  cagr: 0,
  sharpe: 8.1,
  sortino: 2.1,
  calmar: 0,
};

const SEVEN_KEYS = [
  "cumulative_return",
  "volatility",
  "max_drawdown",
  "cagr",
  "sharpe",
  "sortino",
  "calmar",
] as const;

async function readComposite(dqf: Record<string, unknown>) {
  const out = await readCompositeFactsheet(mockAdmin(), {
    strategyId: "s1",
    dqf,
    metricsJsonByBasis: { cash_settlement: LEGACY_CASH },
    returnsDenominatorConfig: null,
  });
  expect(out).not.toBeNull();
  return out!.buildOpts;
}

describe("D-01 — a Dated composite row carries its span", () => {
  it("(a) keeps all seven stored scalars and names the span, but no guard reasons (WR-02)", async () => {
    const opts = await readComposite({ ...D12_DQF, headline_since: "2026-04-18" });
    for (const key of SEVEN_KEYS) {
      expect(opts.metricsByBasis?.cash_settlement?.[key]).toBe(LEGACY_CASH[key]);
    }
    expect(opts.dataQuality).toMatchObject({
      composite: true,
      twrChainBroken: true,
      headlineCoversFrom: "2026-04-18",
    });
    expect("headlineGuardReasons" in (opts.dataQuality ?? {})).toBe(false);
    expect(opts.dataQuality?.headlineWithheld).toBeUndefined();
  });
});

// WR-02: a composite's guard flags are member flags over UNCLIPPED histories, bare
// booleans with no dated span, so they can name a cause outside the window the
// composite shows. A composite never names one; a single-key row, whose flags are
// judged on its own series, still does.
describe("WR-02 — guard reasons are named for a single-key row, never for a composite", () => {
  const FLAGGED = { twr_chain_broken: true, headline_since: "2026-04-18", dust_nav_guard: true };

  it("a composite with a guard flag gets no named reason, Dated or Withheld", async () => {
    const dated = await readComposite({ composite: true, ...FLAGGED });
    expect("headlineGuardReasons" in (dated.dataQuality ?? {})).toBe(false);
    const { headline_since: _since, ...undated } = FLAGGED;
    const withheld = await readComposite({ composite: true, ...undated });
    expect(withheld.dataQuality?.headlineWithheld).toBe(true);
    expect("headlineGuardReasons" in (withheld.dataQuality ?? {})).toBe(false);
  });

  it("the page then reads the zero-reason copy for the composite (UI-SPEC 1.2)", async () => {
    const opts = await readComposite({ composite: true, ...FLAGGED });
    const note = headlineCoverageNote(opts.dataQuality, "cash_settlement", "main");
    expect(note?.text).toContain("it includes a break in the return chain");
    expect(note?.text).not.toContain("account balance");
  });

  // 164.6.6.2.3 D-14: a stored row still carrying the retired flow-dominance flag
  // names no reason on either surface. Fails if the flag returns to the reader's
  // flag-to-reason table.
  it("D-14: a single-key row whose only flag is the retired one names no reason and prints the no-cause copy", async () => {
    const out = await readSingleKey({
      twr_chain_broken: true,
      headline_since: "2026-04-18",
      flow_dominated_guard: true,
    });
    expect(out.dataQuality).toMatchObject({ twrChainBroken: true, headlineCoversFrom: "2026-04-18" });
    expect("headlineGuardReasons" in (out.dataQuality ?? {})).toBe(false);
    const note = headlineCoverageNote(out.dataQuality, "cash_settlement", "main");
    expect(note?.text).toContain("it includes a break in the return chain");
    expect(note?.text).not.toMatch(/deposit|withdrawal/);
  });

  it("D-14: beside a real guard, the retired flag adds no second reason", async () => {
    const out = await readSingleKey({
      twr_chain_broken: true,
      headline_since: "2026-04-18",
      dust_nav_guard: true,
      flow_dominated_guard: true,
    });
    expect(out.dataQuality?.headlineGuardReasons).toEqual(["dust_nav"]);
  });

  it("a single-key row with the same flag still names its reason", async () => {
    const out = await readSingleKey(FLAGGED);
    expect(out.dataQuality?.headlineGuardReasons).toEqual(["dust_nav"]);
    const note = headlineCoverageNote(out.dataQuality, "cash_settlement", "main");
    expect(note?.text).toContain("it includes a near-zero account balance");
  });
});

describe("D-03 — a legacy mixed-basis composite headline is withheld", () => {
  it("(b) no headline_since: seven keys null, headlineWithheld, no date, and the row still builds", async () => {
    const opts = await readComposite(D12_DQF);
    for (const key of SEVEN_KEYS) {
      expect(opts.metricsByBasis?.cash_settlement?.[key]).toBeNull();
    }
    expect(opts.dataQuality?.headlineWithheld).toBe(true);
    expect(opts.dataQuality?.twrChainBroken).toBe(true);
    expect("headlineCoversFrom" in (opts.dataQuality ?? {})).toBe(false);
  });

  it("(b) redacts a COPY: the stored object the caller holds is not mutated", async () => {
    const stored = { ...LEGACY_CASH };
    await readCompositeFactsheet(mockAdmin(), {
      strategyId: "s1",
      dqf: D12_DQF,
      metricsJsonByBasis: { cash_settlement: stored },
      returnsDenominatorConfig: null,
    });
    expect(stored).toEqual(LEGACY_CASH);
  });

  it.each([
    ["an impossible date", "2026-02-30"],
    ["a number", 20260418],
    ["a slash date", "18/04/2026"],
  ])("(d) headline_since as %s behaves exactly as absent", async (_label, since) => {
    const opts = await readComposite({ ...D12_DQF, headline_since: since });
    for (const key of SEVEN_KEYS) {
      expect(opts.metricsByBasis?.cash_settlement?.[key]).toBeNull();
    }
    expect(opts.dataQuality?.headlineWithheld).toBe(true);
    expect("headlineCoversFrom" in (opts.dataQuality ?? {})).toBe(false);
  });

  it("(e) a valid date without twr_chain_broken sets nothing", async () => {
    const opts = await readComposite({ composite: true, headline_since: "2026-04-18" });
    expect(opts.dataQuality).toEqual({ composite: true, insufficientWindow: false, degradedMembers: [] });
    expect(opts.metricsByBasis?.cash_settlement).toEqual(LEGACY_CASH);
  });

  it("(g) a clean composite's dataQuality is byte-identical to HEAD (no new key)", async () => {
    const opts = await readComposite({ composite: true });
    expect(opts.dataQuality).toEqual({ composite: true, insufficientWindow: false, degradedMembers: [] });
  });

  it("(f) invariant: a chain-broken overlaid headline carries exactly one of Withheld or a valid date", async () => {
    const shapes: Array<Record<string, unknown>> = [
      { ...D12_DQF },
      { ...D12_DQF, headline_since: "2026-04-18" },
      { ...D12_DQF, headline_since: "2026-02-30" },
      { ...D12_DQF, headline_since: null },
      { ...D12_DQF, headline_since: 20260418 },
      { ...D12_DQF, headline_since: "2026-04-18", dust_nav_guard: "true" },
      { composite: true, twr_chain_broken: "true" },
    ];
    for (const dqf of shapes) {
      const dq = (await readComposite(dqf)).dataQuality;
      if (dq?.twrChainBroken !== true) continue;
      const dated = typeof dq.headlineCoversFrom === "string";
      const withheld = dq.headlineWithheld === true;
      expect(dated !== withheld, JSON.stringify(dqf)).toBe(true);
    }
  });
});

// The single-key arm reads the seven stored scalars off the analytics row.
const STORED_ROW = { ...LEGACY_CASH, computation_status: "complete", metrics_json_by_basis: null };

/** An admin handle that fails the test if the read path reaches for it (h). */
function noAdmin() {
  return vi.fn((): SupabaseClient => {
    throw new Error("the single-key arm must not read the stored cash series for the covered span");
  });
}

async function readSingleKey(dqf: Record<string, unknown>) {
  const getAdmin = noAdmin();
  const out = await readSingleKeyBasisOpts(getAdmin, "s1", dqf, null, "complete", STORED_ROW);
  expect(getAdmin).not.toHaveBeenCalled();
  return out;
}

describe("D-01 / D-03 — the single-key arm reaches the same helper", () => {
  it("(c) no headline_since: identical outcome to the composite arm (seven keys null, headlineWithheld)", async () => {
    const out = await readSingleKey({ twr_chain_broken: true, dust_nav_guard: true });
    for (const key of SEVEN_KEYS) {
      expect(out.metricsByBasis?.cash_settlement?.[key]).toBeNull();
    }
    expect(out.dataQuality).toMatchObject({
      twrChainBroken: true,
      headlineWithheld: true,
      headlineGuardReasons: ["dust_nav"],
    });
    expect("headlineCoversFrom" in (out.dataQuality ?? {})).toBe(false);
    // The composite arm answers the same dqf the same way, except it names no
    // guard reason (WR-02: its flags are unclipped member booleans).
    const composite = await readComposite({ composite: true, twr_chain_broken: true, dust_nav_guard: true });
    expect(composite.dataQuality).toMatchObject({
      twrChainBroken: true,
      headlineWithheld: true,
    });
    expect("headlineGuardReasons" in (composite.dataQuality ?? {})).toBe(false);
  });

  it("(c) a Dated row keeps all seven scalars and names its span (h: no series read)", async () => {
    const out = await readSingleKey({ twr_chain_broken: true, headline_since: "2026-04-18" });
    for (const key of SEVEN_KEYS) {
      expect(out.metricsByBasis?.cash_settlement?.[key]).toBe(LEGACY_CASH[key]);
    }
    expect(out.dataQuality?.headlineCoversFrom).toBe("2026-04-18");
    expect(out.dataQuality?.headlineWithheld).toBeUndefined();
  });

  it.each([
    ["an impossible date", "2026-02-30"],
    ["a number", 20260418],
    ["a slash date", "18/04/2026"],
  ])("(d) headline_since as %s behaves exactly as absent", async (_label, since) => {
    const out = await readSingleKey({ twr_chain_broken: true, headline_since: since });
    for (const key of SEVEN_KEYS) {
      expect(out.metricsByBasis?.cash_settlement?.[key]).toBeNull();
    }
    expect(out.dataQuality?.headlineWithheld).toBe(true);
  });

  it("(e) a valid date without twr_chain_broken sets nothing and keeps the figures", async () => {
    const out = await readSingleKey({ headline_since: "2026-04-18" });
    expect("dataQuality" in out).toBe(false);
    expect(out.metricsByBasis?.cash_settlement).toEqual(
      Object.fromEntries(SEVEN_KEYS.map((k) => [k, LEGACY_CASH[k]])),
    );
  });

  it("(g) a clean row's opts carry no new key", async () => {
    const out = await readSingleKey({});
    expect("dataQuality" in out).toBe(false);
    expect(Object.keys(out).sort()).toEqual(
      Object.keys(await readSingleKeyBasisOpts(noAdmin(), "s1", {}, null, "complete", STORED_ROW)).sort(),
    );
  });

  it("(f) invariant: an overlaid chain-broken headline carries exactly one of Withheld or a valid date", async () => {
    const shapes: Array<Record<string, unknown>> = [
      { twr_chain_broken: true },
      { twr_chain_broken: true, headline_since: "2026-04-18" },
      { twr_chain_broken: true, headline_since: "2026-02-30" },
      { twr_chain_broken: true, headline_since: null },
      { twr_chain_broken: true, headline_since: ["2026-04-18"] },
      { twr_chain_broken: true, headline_since: "2026-04-18", dust_nav_guard: 1 },
    ];
    for (const dqf of shapes) {
      const dq = (await readSingleKey(dqf)).dataQuality;
      expect(dq?.twrChainBroken, JSON.stringify(dqf)).toBe(true);
      const dated = typeof dq?.headlineCoversFrom === "string";
      const withheld = dq?.headlineWithheld === true;
      expect(dated !== withheld, JSON.stringify(dqf)).toBe(true);
    }
  });
});

/**
 * SFH-01 (review round 1, D-03): a chain-broken single-key row whose stored
 * headline is NOT applied used to skip `applyHeadlineBasis`. `singleKeyDataQuality`
 * carries the flag alone, so the page built the TypeScript whole-record headline
 * (which compounds across the break) with neither the Withheld nor the Dated note.
 * Such a row is Withheld, whatever its `headline_since` says: no stored headline
 * exists for a date to describe.
 */
describe("SFH-01 — a chain-broken single-key row with no applicable stored headline is Withheld", () => {
  const NULL_SEVEN = Object.fromEntries(SEVEN_KEYS.map((k) => [k, null]));
  const CHAIN = { twr_chain_broken: true, headline_since: "2026-04-18", dust_nav_guard: true };

  async function read(row: Record<string, unknown> | null | undefined, dqf: Record<string, unknown> = CHAIN) {
    const getAdmin = noAdmin();
    const out = await readSingleKeyBasisOpts(
      getAdmin,
      "s1",
      dqf,
      (row as { metrics_json_by_basis?: unknown } | null | undefined)?.metrics_json_by_basis ?? null,
      (row as { computation_status?: unknown } | null | undefined)?.computation_status ?? "complete",
      row,
    );
    expect(getAdmin).not.toHaveBeenCalled();
    return out;
  }

  function expectWithheld(out: Awaited<ReturnType<typeof read>>) {
    expect(out.metricsByBasis?.cash_settlement).toEqual(NULL_SEVEN);
    expect(out.dataQuality).toMatchObject({
      twrChainBroken: true,
      headlineWithheld: true,
      headlineGuardReasons: ["dust_nav"],
    });
    // Exactly one of Withheld / Dated: the date is dropped with the headline it described.
    expect("headlineCoversFrom" in (out.dataQuality ?? {})).toBe(false);
  }

  it("a raw metrics_json_by_basis.cash_settlement object blocks the headline: Withheld, and it logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expectWithheld(
        await read({ ...STORED_ROW, metrics_json_by_basis: { cash_settlement: { sharpe: 9 } } }),
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("cash_settlement"), expect.objectContaining({ strategyId: "s1" }));
    } finally {
      warn.mockRestore();
    }
  });

  it("unprojected headline keys: Withheld, and the missing_keys log is kept", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { cagr: _cagr, ...unprojected } = STORED_ROW;
      expectWithheld(await read(unprojected));
      expect(err).toHaveBeenCalledWith(
        expect.stringContaining("did not project"),
        expect.objectContaining({ reason: "missing_keys", missing: ["cagr"] }),
      );
    } finally {
      err.mockRestore();
    }
  });

  it("a row that is not rankable: Withheld", async () => {
    expectWithheld(await read({ ...STORED_ROW, computation_status: "failed" }));
  });

  it("no persisted row passed: Withheld", async () => {
    expectWithheld(await read(null));
  });

  it("a marker-less chain-broken row (no headline_since) is Withheld with the reasons it has", async () => {
    expectWithheld(
      await read({ ...STORED_ROW, metrics_json_by_basis: { cash_settlement: { sharpe: 9 } } }, { twr_chain_broken: true, dust_nav_guard: true }),
    );
  });

  it("CONTROL: the same blockers on a row that is NOT chain-broken add nothing (byte-identical)", async () => {
    const out = await read({ ...STORED_ROW, metrics_json_by_basis: { cash_settlement: { sharpe: 9 } } }, {});
    expect("dataQuality" in out).toBe(false);
    expect(out.metricsByBasis?.cash_settlement).toBeUndefined();
  });

  /**
   * Review round 2 (LOW): one log per defect, through the Sentry path the
   * missing_keys branch uses, and none on a page view of an expected state.
   */
  describe("the Withheld fallback logs once per defect, through Sentry", () => {
    const sentry = vi.mocked(captureToSentry);
    async function readLogged(row: Record<string, unknown> | null) {
      sentry.mockClear();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await read(row);
        return { warn: warn.mock.calls.length, error: err.mock.calls.length, sentry: sentry.mock.calls.length };
      } finally {
        warn.mockRestore();
        err.mockRestore();
      }
    }

    it("no row passed (a caller defect): one console.error and one Sentry capture", async () => {
      expect(await readLogged(null)).toEqual({ warn: 0, error: 1, sentry: 1 });
      expect(sentry.mock.calls[0][1]).toMatchObject({ tags: { reason: "chain_broken_no_row", strategy_id: "s1" } });
    });

    it("a row that is not rankable (an expected state): no log at all", async () => {
      expect(await readLogged({ ...STORED_ROW, computation_status: "computing" })).toEqual({ warn: 0, error: 0, sentry: 0 });
    });

    it("a raw cash_settlement object: only the one warn persistedCashHeadline already emitted", async () => {
      expect(
        await readLogged({ ...STORED_ROW, metrics_json_by_basis: { cash_settlement: { sharpe: 9 } } }),
      ).toEqual({ warn: 1, error: 0, sentry: 0 });
    });

    it("unprojected keys: only the missing_keys error and its one capture", async () => {
      const { cagr: _cagr, ...unprojected } = STORED_ROW;
      expect(await readLogged(unprojected)).toEqual({ warn: 0, error: 1, sentry: 1 });
      expect(sentry.mock.calls[0][1]).toMatchObject({ tags: { reason: "missing_keys" } });
    });
  });
});

describe("applyHeadlineBasis — the one implementation both arms call", () => {
  const headline = { ...LEGACY_CASH, extra_key: 5 };

  it("a clean row returns the SAME headline object and an empty quality", () => {
    const out = applyHeadlineBasis(headline, { composite: true });
    expect(out.headline).toBe(headline);
    expect(out.redacted).toBe(false);
    expect(out.quality).toEqual({});
  });

  it("a Withheld row nulls exactly the seven mapped keys, on a copy", () => {
    const out = applyHeadlineBasis(headline, { twr_chain_broken: true });
    expect(out.redacted).toBe(true);
    expect(out.headline).not.toBe(headline);
    expect(headline.cagr).toBe(0);
    for (const key of SEVEN_KEYS) expect(out.headline[key]).toBeNull();
    expect(out.headline.extra_key).toBe(5);
  });
});

/**
 * Phase 252 DERIBITOPTIONS plan 01 — the options-book reason withholds the stored CASH headline
 * (the cash-wallet series is the artefact the reason names) and ONLY that: `applyHeadlineBasis`
 * rewrites `cash_settlement`, so a smoothed or mark-to-market basis stored behind the toggle is
 * left as stored, and `headlineCoverageNote` returns null off the cash basis.
 */
describe("252 — the options-book composite through the read path", () => {
  const OPTIONS_DQF = {
    composite: true,
    twr_chain_broken: true,
    headline_since: "2025-12-16",
    mtm_gated_reason: "unsmoothed_options_book",
  };
  const SMOOTHED = {
    cumulative_return: 0.21,
    volatility: 0.15,
    max_drawdown: -0.09,
    cagr: 0.3,
    sharpe: 1.1,
    sortino: 1.4,
    calmar: 2.2,
  };

  async function readWithSmoothed(dqf: Record<string, unknown>) {
    const out = await readCompositeFactsheet(mockAdmin(), {
      strategyId: "s1",
      dqf,
      metricsJsonByBasis: { cash_settlement: LEGACY_CASH, smoothed_mtm: SMOOTHED },
      returnsDenominatorConfig: null,
    });
    expect(out).not.toBeNull();
    return out!.buildOpts;
  }

  it("the evidence row carries the withheld dataQuality and a redacted cash_settlement", async () => {
    const opts = await readWithSmoothed(OPTIONS_DQF);
    for (const key of SEVEN_KEYS) expect(opts.metricsByBasis?.cash_settlement?.[key], key).toBeNull();
    expect(opts.dataQuality).toMatchObject({
      composite: true,
      twrChainBroken: true,
      headlineWithheld: true,
      headlineWithheldCause: "options_cash_wallet",
    });
    expect(opts.dataQuality?.headlineCoversFrom).toBeUndefined();
  });

  it("the same flags without the chain keys withhold too and carry no twrChainBroken", async () => {
    const opts = await readWithSmoothed({ composite: true, mtm_gated_reason: "unsmoothed_options_book" });
    for (const key of SEVEN_KEYS) expect(opts.metricsByBasis?.cash_settlement?.[key], key).toBeNull();
    expect(opts.dataQuality).toMatchObject({ headlineWithheld: true, headlineWithheldCause: "options_cash_wallet" });
    expect(opts.dataQuality).not.toHaveProperty("twrChainBroken");
  });

  it("basis carve-out: a stored smoothed_mtm object is left as stored, and the note is null off the cash basis", async () => {
    const opts = await readWithSmoothed(OPTIONS_DQF);
    expect(opts.metricsByBasis?.smoothed_mtm).toEqual(SMOOTHED);
    expect(headlineCoverageNote(opts.dataQuality, "smoothed_mtm", "strip")).toBeNull();
    expect(headlineCoverageNote(opts.dataQuality, "mark_to_market", "main")).toBeNull();
    expect(headlineCoverageNote(opts.dataQuality, "cash_settlement", "strip")?.variant).toBe("structural");
  });

  it("the chain break alone, without the reason, is still the dated reading (the trigger is the reason, not the break)", async () => {
    const { mtm_gated_reason: _reason, ...noReason } = OPTIONS_DQF;
    const opts = await readWithSmoothed(noReason);
    expect(opts.dataQuality).toMatchObject({ twrChainBroken: true, headlineCoversFrom: "2025-12-16" });
    expect(opts.dataQuality?.headlineWithheld).toBeUndefined();
    expect(opts.metricsByBasis?.cash_settlement?.cumulative_return).toBe(LEGACY_CASH.cumulative_return);
  });
});

/**
 * Phase 252 G252-MTM-PROMOTION, surfaces half (plan 10), per the 2026-11-25 founder ruling
 * ("... Then measure market-price valuation and switch the headline to it only if it actually
 * works for these keys.").
 *
 * Plan 09 stores a PROMOTED composite with the smoothed scalars at top level,
 * `data_quality_flags.headline_basis = "smoothed_mtm"`, no `mtm_gated_reason`, and a by-basis object
 * holding both bases. The factsheet is the one surface whose default view is the CASH by-basis
 * object, so the read path has to say two things for such a row: the stored headline is the smoothed
 * basis, and the cash object is still the cash-wallet artefact and stays withheld.
 *
 * The marker is untrusted JSONB. The reason always wins over it, and an unrecognised marker value is
 * NOT a promoted row.
 */
describe("G252-MTM-PROMOTION — a promoted composite through the read path and the payload", () => {
  // The evidence-row artefact the cash object carries, and a smoothed object that differs from it.
  const CASH_ARTEFACT = {
    cumulative_return: 16361.727,
    volatility: 0.31,
    max_drawdown: -0.4,
    cagr: 5143012681330.363,
    sharpe: 3.4,
    sortino: 4.1,
    calmar: 102.0,
  };
  const SMOOTHED_OBJ = {
    cumulative_return: 0.4213,
    volatility: 0.18,
    max_drawdown: -0.11,
    cagr: 0.62,
    sharpe: 1.9,
    sortino: 2.7,
    calmar: 5.6,
  };
  const PROMOTED_DQF = {
    composite: true,
    headline_basis: "smoothed_mtm",
    cumulative_method: "geometric",
    per_key: [],
    gap_spans: [],
  };
  const STRATEGY = {
    id: "s-252-10",
    name: "Promoted Composite Fixture",
    types: ["quant"],
    markets: ["crypto"],
    computedAt: "2026-11-27T00:00:00Z",
    trustTier: null,
    assetClass: "crypto",
    ingestSource: "csv" as const,
  };
  const DAY = 86_400_000;
  const ROWS: DailyReturn[] = Array.from({ length: 60 }, (_, i) => ({
    date: new Date(Date.parse("2026-01-01T00:00:00Z") + i * DAY).toISOString().slice(0, 10),
    value: 0.001 + Math.sin(i * 0.3) * 0.004,
  }));

  // The smoothed series a promoted row stores beside its scalars: two or more valid rows.
  const SMOOTHED_SERIES = {
    basis: "smoothed_mtm",
    rows: ROWS.slice(0, 5).map((r) => ({ date: r.date, return: r.value })),
    gap_spans: [],
  };

  async function run(
    dqf: Record<string, unknown>,
    byBasis: Record<string, unknown>,
    smoothedSeriesPayload: unknown = SMOOTHED_SERIES,
  ) {
    const out = await readCompositeFactsheet(mockAdmin(smoothedSeriesPayload), {
      strategyId: "s1",
      dqf,
      metricsJsonByBasis: byBasis,
      returnsDenominatorConfig: null,
    });
    expect(out).not.toBeNull();
    const payload = buildFactsheetPayload(STRATEGY, ROWS, out!.buildOpts);
    expect(payload).not.toBeNull();
    return { opts: out!.buildOpts, payload: payload! };
  }

  function expectCashWithheldWithTheOptionsSentence(
    payload: Awaited<ReturnType<typeof run>>["payload"],
  ) {
    for (const { serverKey } of BASIS_KPI_MAP) {
      expect(payload.metricsByBasis?.cash_settlement?.[serverKey], serverKey).toBeNull();
    }
    expect(payload.dataQuality?.headlineWithheld).toBe(true);
    expect(payload.dataQuality?.headlineWithheldCause).toBe("options_cash_wallet");
  }

  /**
   * (a) Rule 9: without this, a promoted composite's owner reads the cash-wallet artefact
   * (+1636172.7%, CAGR 5.1e12) under "Cash settlement", because the producer dropped the reason when
   * it promoted the row, or the factsheet does not open on the figures the founder ruled to publish.
   */
  it("(a) a promoted row names the smoothed headline and withholds the cash object by name", async () => {
    const { payload } = await run(PROMOTED_DQF, { cash_settlement: CASH_ARTEFACT, smoothed_mtm: SMOOTHED_OBJ });
    expect(payload.headlineBasis).toBe("smoothed_mtm");
    expect(payload.seriesByBasis?.smoothed_mtm).toBeDefined();
    expectCashWithheldWithTheOptionsSentence(payload);
    // The chain flags describe the SMOOTHED series on a promoted row, never the cash object withheld here.
    expect(payload.dataQuality).not.toHaveProperty("twrChainBroken");
    expect(payload.dataQuality).not.toHaveProperty("headlineCoversFrom");
    expect(payload.dataQuality).not.toHaveProperty("headlineGuardReasons");
    expect(payload.metricsByBasis?.smoothed_mtm).toEqual(SMOOTHED_OBJ);
    expect(payload.smoothedGate?.available).toBe(true);
  });

  /**
   * (b) Rule 9: the reason is the fail-safe. A row carrying both the marker and the unsmoothed-book
   * reason (a half-written or stale producer state) must withhold on every surface exactly as wave 1
   * does; letting the marker win would publish a smoothed headline the producer disowned.
   */
  it("(b) the reason wins: a row carrying the marker AND the options-book reason is withheld as at wave 1", async () => {
    const { payload } = await run(
      { ...PROMOTED_DQF, mtm_gated_reason: "unsmoothed_options_book" },
      { cash_settlement: CASH_ARTEFACT, smoothed_mtm: SMOOTHED_OBJ },
    );
    expect(payload).not.toHaveProperty("headlineBasis");
    expectCashWithheldWithTheOptionsSentence(payload);
  });

  /**
   * (c) Rule 9: a marker with no usable smoothed object must not open the factsheet on a basis that
   * has no figures. The cash object stays withheld; the basis does not switch.
   */
  it.each([
    ["the smoothed object is missing", { cash_settlement: CASH_ARTEFACT }],
    [
      "the smoothed headline is not finite",
      { cash_settlement: CASH_ARTEFACT, smoothed_mtm: { ...SMOOTHED_OBJ, cumulative_return: null } },
    ],
  ])("(c) a marker but %s: cash withheld, no headlineBasis, smoothed gate closed", async (_label, byBasis) => {
    const { payload } = await run(PROMOTED_DQF, byBasis);
    expect(payload).not.toHaveProperty("headlineBasis");
    expectCashWithheldWithTheOptionsSentence(payload);
    expect(payload.smoothedGate?.available).toBe(false);
  });

  /**
   * (c2) SFH-MEDIUM-1 (252 gap-2 review): a marker plus smoothed scalars but NO usable smoothed series
   * (no stored row, or fewer than two valid rows, which `readSmoothedSeries` reads as null) must not
   * seed the factsheet on the smoothed basis. `build-payload` emits `seriesByBasis.smoothed_mtm` only
   * from such a series, so `useBasisSeriesView` would fall back to the cash payload and put cash-wallet
   * charts under smoothed KPIs. The cash object stays withheld by name.
   */
  it.each([
    ["the series row is missing", null],
    ["the series has a single valid row", { basis: "smoothed_mtm", rows: [{ date: "2026-01-01", return: 0.01 }], gap_spans: [] }],
  ])("(c2) a marker and smoothed scalars but %s: no headlineBasis, cash withheld", async (_label, series) => {
    const { opts, payload } = await run(
      PROMOTED_DQF,
      { cash_settlement: CASH_ARTEFACT, smoothed_mtm: SMOOTHED_OBJ },
      series,
    );
    expect("headlineBasis" in opts).toBe(false);
    expect(payload).not.toHaveProperty("headlineBasis");
    expect(payload.seriesByBasis?.smoothed_mtm).toBeUndefined();
    expectCashWithheldWithTheOptionsSentence(payload);
  });

  /**
   * (d) Rule 9: the marker is untrusted JSONB, compared strictly. A case variant, a padded string, a
   * boolean, an array or null is an ordinary composite: nothing is withheld and no basis switches, and
   * the payload equals the same row without the key.
   */
  it.each([
    ["a case variant", "SMOOTHED_MTM"],
    ["a padded string", " smoothed_mtm"],
    ["a boolean", true],
    ["an array", ["smoothed_mtm"]],
    ["null", null],
  ])("(d) an untrusted marker (%s) on a row with no reason is an ordinary composite", async (_label, marker) => {
    const byBasis = { cash_settlement: LEGACY_CASH, smoothed_mtm: SMOOTHED_OBJ };
    const { headline_basis: _drop, ...plain } = PROMOTED_DQF;
    const withMarker = await run({ ...plain, headline_basis: marker }, byBasis);
    const without = await run(plain, byBasis);
    expect(withMarker.payload).not.toHaveProperty("headlineBasis");
    for (const key of SEVEN_KEYS) {
      expect(withMarker.payload.metricsByBasis?.cash_settlement?.[key]).toBe(LEGACY_CASH[key]);
    }
    expect(withMarker.payload.dataQuality?.headlineWithheld).toBeUndefined();
    expect(withMarker.payload).toEqual(without.payload);
  });

  /** (e) Rule 9: every unpromoted payload stays byte-identical, so the new opts key must be absent, not undefined. */
  it("(e) a clean non-options composite carries no headlineBasis key in its opts or its payload", async () => {
    const { opts, payload } = await run({ composite: true }, { cash_settlement: LEGACY_CASH });
    expect("headlineBasis" in opts).toBe(false);
    expect("headlineBasis" in payload).toBe(false);
  });
});

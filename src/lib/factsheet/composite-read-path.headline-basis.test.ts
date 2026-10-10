import { describe, it, expect, vi } from "vitest";

// `composite-read-path` imports `server-only` (a Next.js RSC build guard).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyHeadlineBasis, readCompositeFactsheet, readSingleKeyBasisOpts } from "./composite-read-path";
import { captureToSentry } from "@/lib/sentry-capture";
import { headlineCoverageNote } from "@/app/factsheet/[id]/v2/MetricsColumn";

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

function mockAdmin(): SupabaseClient {
  // Honours the keyset cursor, as PostgREST does, so the paged read terminates.
  let after: string | null = null;
  const chain = {
    select: () => chain,
    eq: () => chain,
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
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

// The D-12 dqf shape: a composite whose chain broke on a dust balance and a
// flow-dominated day, measured since a marker day.
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

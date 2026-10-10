import { describe, it, expect, vi } from "vitest";

// `composite-read-path` imports `server-only` (a Next.js RSC build guard).
vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { readSingleKeyBasisOpts } from "./composite-read-path";
import { computeOgHeadline } from "./og-metrics";

/**
 * Phase 164.6.6.3.3 round 2 (SFH-R2-01, D-03, D-06: "the card equals the
 * factsheet"). The page (`readSingleKeyBasisOpts`) and the OG share card
 * (`computeOgHeadline`) decide whether a row's headline is clean, dated or
 * withheld through ONE helper (`headlineVerdict` + `storedCashHeadlineGate`).
 *
 * The defect this pins: a chain-broken single-key row whose stored cash headline
 * is NOT applicable (not rankable, a raw `cash_settlement` object, unprojected
 * keys) was Withheld on the page (SFH-01) while the card, which read the flags
 * only from a rankable row, computed Sharpe / CAGR / Max DD from the whole-record
 * series ACROSS the break and printed them as covered.
 *
 * Every case below runs the SAME row through BOTH surfaces and asserts they agree.
 */

const SEVEN = {
  cumulative_return: 0.4,
  volatility: 0.12,
  max_drawdown: -0.1,
  cagr: 0.6,
  sharpe: 1.5,
  sortino: 2.1,
  calmar: 3,
} as const;
const STORED_ROW = { ...SEVEN, computation_status: "complete", metrics_json_by_basis: null };
const CHAIN = { twr_chain_broken: true, headline_since: "2023-02-01" };
const DAY = 86_400_000;

/** 400 days: clears the card's 0.95-year CAGR floor, so only the verdict can hide a figure. */
const SERIES = Array.from({ length: 400 }, (_, i) => ({
  date: new Date(Date.parse("2023-01-01") + i * DAY).toISOString().slice(0, 10),
  value: i % 2 === 0 ? 0.002 : -0.001,
}));

type Row = Record<string, unknown>;

async function page(row: Row | null, dqf: Row) {
  const getAdmin = vi.fn((): SupabaseClient => {
    throw new Error("the single-key arm must not reach for the admin client here");
  });
  return readSingleKeyBasisOpts(
    getAdmin,
    "s1",
    dqf,
    row?.metrics_json_by_basis ?? null,
    row?.computation_status ?? "complete",
    row,
  );
}

function card(row: Row | null, dqf: Row) {
  return computeOgHeadline(SERIES, "crypto", { ...(row ?? {}), data_quality_flags: dqf });
}

const allNaN = (c: ReturnType<typeof card>) =>
  Number.isNaN(c.sharpe) && Number.isNaN(c.cagr) && Number.isNaN(c.maxDd);

function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const spies = [vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map((s) => s.mockImplementation(() => {}));
  return fn().finally(() => spies.forEach((s) => s.mockRestore()));
}

describe("SFH-R2-01 — a chain-broken row with no applicable stored headline is Withheld on the page AND the card", () => {
  const { cagr: _omit, ...UNPROJECTED } = STORED_ROW;
  // D-14 (R2-03): the page also carries WHY the headline is withheld. Only a
  // not-rankable row (computing / pending / failed) has a cause other than the
  // original; the card prints NaN for every cause.
  const CASES: Array<[string, Row | null, "recomputing" | "failed" | undefined]> = [
    ["a row that is not rankable (failed)", { ...STORED_ROW, computation_status: "failed" }, "failed"],
    ["a row that is not rankable (computing)", { ...STORED_ROW, computation_status: "computing" }, "recomputing"],
    ["a row that is not rankable (pending)", { ...STORED_ROW, computation_status: "pending" }, "recomputing"],
    ["a raw metrics_json_by_basis.cash_settlement object", { ...STORED_ROW, metrics_json_by_basis: { cash_settlement: { sharpe: 9 } } }, undefined],
    ["unprojected headline keys", UNPROJECTED, undefined],
  ];

  it.each(CASES)("%s", async (_name, row, cause) => {
    // Anti-vacuity: the whole-record series DOES compute finite figures here, so
    // an all-NaN card can only come from the verdict.
    expect(Number.isFinite(computeOgHeadline(SERIES, "crypto").sharpe)).toBe(true);

    const p = await quiet(() => page(row, CHAIN));
    expect(p.dataQuality).toMatchObject({ twrChainBroken: true, headlineWithheld: true });
    expect(p.dataQuality?.headlineWithheldCause).toBe(cause);
    expect(allNaN(card(row, CHAIN)), "the card must withhold what the page withholds").toBe(true);
  });

  it.each(["computing", "pending", "failed"])(
    "D-14: no headline_since while %s keeps the original cause (absent) on the page, and the card still withholds",
    async (status) => {
      const dqf = { twr_chain_broken: true };
      const row = { ...STORED_ROW, computation_status: status };
      const p = await quiet(() => page(row, dqf));
      expect(p.dataQuality).toMatchObject({ twrChainBroken: true, headlineWithheld: true });
      expect(p.dataQuality?.headlineWithheldCause).toBeUndefined();
      expect(allNaN(card(row, dqf))).toBe(true);
    },
  );

  it("a chain-broken row with no headline_since, fully applicable: both withhold (unchanged)", async () => {
    const dqf = { twr_chain_broken: true };
    const p = await page(STORED_ROW, dqf);
    expect(p.dataQuality).toMatchObject({ headlineWithheld: true });
    expect(p.dataQuality?.headlineWithheldCause).toBeUndefined();
    expect(allNaN(card(STORED_ROW, dqf))).toBe(true);
  });
});

describe("clean and Dated rows are unchanged on both surfaces", () => {
  it("a Dated applicable row: the page keeps the figures and names the span; the card shows stored Sharpe and Max DD (CAGR hidden by E2)", async () => {
    const p = await page(STORED_ROW, CHAIN);
    expect(p.dataQuality).toMatchObject({ twrChainBroken: true, headlineCoversFrom: "2023-02-01" });
    expect(p.dataQuality?.headlineWithheld).toBeUndefined();
    expect(p.dataQuality?.headlineWithheldCause).toBeUndefined();
    expect(p.metricsByBasis?.cash_settlement?.sharpe).toBe(1.5);
    const c = card(STORED_ROW, CHAIN);
    expect(c.sharpe).toBe(1.5);
    expect(c.maxDd).toBe(-0.1);
    expect(Number.isNaN(c.cagr)).toBe(true);
  });

  it("a clean applicable row: the page adds no note; the card shows all three stored figures", async () => {
    const p = await page(STORED_ROW, {});
    expect("dataQuality" in p).toBe(false);
    const c = card(STORED_ROW, {});
    expect([c.sharpe, c.cagr, c.maxDd]).toEqual([1.5, 0.6, -0.1]);
  });

  it("a clean row that is NOT applicable (failed) is not withheld by either surface: the verdict needs a chain break", async () => {
    const row = { ...STORED_ROW, computation_status: "failed" };
    const p = await page(row, {});
    expect(p.dataQuality?.headlineWithheld).toBeUndefined();
    const c = card(row, {});
    expect(Number.isFinite(c.sharpe) && Number.isFinite(c.maxDd) && Number.isFinite(c.cagr)).toBe(true);
  });
});

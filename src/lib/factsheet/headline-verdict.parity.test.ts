import { describe, it, expect, vi } from "vitest";

// `composite-read-path` imports `server-only` (a Next.js RSC build guard).
vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyHeadlineBasis, readSingleKeyBasisOpts } from "./composite-read-path";
import { computeOgHeadline } from "./og-metrics";
import { BASIS_KPI_MAP } from "./basis-metrics";
import { headlineCoverageNote, headlineNoteColor, headlineNoteGlyph } from "@/app/factsheet/[id]/v2/MetricsColumn";

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

/** 400 days: a record long enough to need no short-track note, so only the verdict can hide a figure. */
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

/**
 * Phase 252 DERIBITOPTIONS plan 01 (SC-2): the row the founder saw on PROD, a private
 * Deribit options composite whose cash-wallet series printed cumulative +1636172.7% under
 * a "measured since Dec 16, 2025" note. The trigger is the producer's reason
 * (`mtm_gated_reason: "unsmoothed_options_book"`), decided by one predicate and applied
 * FIRST in `headlineVerdict`, so it beats `dated` and needs no chain break. No numeric
 * input exists anywhere in it.
 */
describe("252 SC-2: an options book measured on the cash wallet is withheld on the page, the composite arm, the note and the card", () => {
  const REASON = "unsmoothed_options_book";
  const EVIDENCE = {
    composite: true,
    twr_chain_broken: true,
    headline_since: "2025-12-16",
    mtm_gated_reason: REASON,
  };
  const INTACT_CHAIN = { composite: true, mtm_gated_reason: REASON };
  const NO_REASON = { composite: true, twr_chain_broken: true, headline_since: "2025-12-16" };

  // The debug-session wallet-shape days, typed by hand from
  // analytics-service/tests/fixtures/deribit_option_round_trip.py (cash daily returns
  // -0.4839, +0.0280, +3.3339), placed at the head of an otherwise ordinary 400-day record.
  const WALLET_SERIES = SERIES.map((r, i) => ({
    ...r,
    value: i === 0 ? -0.4839 : i === 1 ? 0.028 : i === 2 ? 3.3339 : r.value,
  }));
  const walletCard = (dqf: Row) =>
    computeOgHeadline(WALLET_SERIES, "crypto", { ...STORED_ROW, data_quality_flags: dqf });

  const HEADLINE_SENTENCE =
    "Headline figures withheld: this strategy trades options, and its returns are measured on the cash wallet, which leaves out the market value of open option positions.";
  const PANEL_SENTENCE =
    "Withheld: this panel is measured on the cash wallet, which leaves out the market value of open option positions.";

  it("anti-vacuity: the same series and stored row WITHOUT the reason give finite card figures and a finite page cumulative_return", async () => {
    const noReasonIntact = { composite: true };
    const c = walletCard(noReasonIntact);
    expect(Number.isFinite(c.sharpe) && Number.isFinite(c.cagr) && Number.isFinite(c.maxDd)).toBe(true);
    const p = await page(STORED_ROW, noReasonIntact);
    expect(p.metricsByBasis?.cash_settlement?.cumulative_return).toBe(0.4);
  });

  it("the evidence shape (chain broken, dated, reason) is withheld, not dated: seven scalars null, cause named, chain flag kept", async () => {
    const p = await page(STORED_ROW, EVIDENCE);
    for (const { serverKey } of BASIS_KPI_MAP) {
      expect(p.metricsByBasis?.cash_settlement?.[serverKey], serverKey).toBeNull();
    }
    expect(p.dataQuality).toMatchObject({
      headlineWithheld: true,
      headlineWithheldCause: "options_cash_wallet",
      twrChainBroken: true,
    });
    expect(p.dataQuality?.headlineCoversFrom).toBeUndefined();
  });

  it("the same flags with the chain keys removed are withheld too, and carry no twrChainBroken key", async () => {
    const p = await page(STORED_ROW, INTACT_CHAIN);
    for (const { serverKey } of BASIS_KPI_MAP) {
      expect(p.metricsByBasis?.cash_settlement?.[serverKey], serverKey).toBeNull();
    }
    expect(p.dataQuality).toMatchObject({ headlineWithheld: true, headlineWithheldCause: "options_cash_wallet" });
    expect(p.dataQuality).not.toHaveProperty("twrChainBroken");
  });

  it("a not-applicable stored headline (failed) still withholds with the options cause, not 'failed'", async () => {
    const row = { ...STORED_ROW, computation_status: "failed" };
    const p = await quiet(() => page(row, INTACT_CHAIN));
    expect(p.dataQuality?.headlineWithheldCause).toBe("options_cash_wallet");
    expect(p.metricsByBasis?.cash_settlement?.cumulative_return).toBeNull();
  });

  it("the composite arm's own call redacts every BASIS_KPI_MAP key and names the cause", () => {
    const headline = Object.fromEntries(BASIS_KPI_MAP.map(({ serverKey }) => [serverKey, 1.5]));
    const applied = applyHeadlineBasis(headline, EVIDENCE, { composite: true });
    expect(applied.redacted).toBe(true);
    for (const { serverKey } of BASIS_KPI_MAP) expect(applied.headline[serverKey], serverKey).toBeNull();
    expect(applied.quality.headlineWithheldCause).toBe("options_cash_wallet");
    const intact = applyHeadlineBasis(headline, INTACT_CHAIN, { composite: true });
    expect(intact.redacted).toBe(true);
    expect(intact.quality).not.toHaveProperty("twrChainBroken");
  });

  it("the card prints three dashes for the evidence shape and for the intact-chain shape", () => {
    expect(allNaN(walletCard(EVIDENCE))).toBe(true);
    expect(allNaN(walletCard(INTACT_CHAIN))).toBe(true);
    // The same chain break without the reason stays the dated reading (stored Sharpe kept).
    expect(walletCard(NO_REASON).sharpe).toBe(1.5);
  });

  it("the note names the reason in muted text with no glyph, on the strip, strip-relative and Main Metrics slots", async () => {
    const p = await page(STORED_ROW, EVIDENCE);
    for (const slot of ["strip", "stripRelative", "main"] as const) {
      expect(headlineCoverageNote(p.dataQuality, "cash_settlement", slot), slot).toEqual({
        variant: "structural",
        text: HEADLINE_SENTENCE,
      });
    }
    expect(headlineCoverageNote(p.dataQuality, "cash_settlement", "panel")).toEqual({
      variant: "structural",
      text: PANEL_SENTENCE,
    });
    for (const slot of ["returns", "maxdd", "cumulative"] as const) {
      expect(headlineCoverageNote(p.dataQuality, "cash_settlement", slot), slot).toBeNull();
    }
    expect(headlineNoteColor("structural")).toBe("var(--color-text-muted, #64748B)");
    expect(headlineNoteGlyph("structural")).toBe("");
  });

  it("the intact-chain shape names the reason, never the chain-break wording", async () => {
    const p = await page(STORED_ROW, INTACT_CHAIN);
    const note = headlineCoverageNote(p.dataQuality, "cash_settlement", "strip");
    expect(note?.text).toBe(HEADLINE_SENTENCE);
    expect(note?.text).not.toMatch(/chain|earlier history/);
  });

  it("off the cash basis the note is null: a smoothed or mark-to-market basis is not the stored cash headline", async () => {
    const p = await page(STORED_ROW, EVIDENCE);
    expect(headlineCoverageNote(p.dataQuality, "smoothed_mtm", "strip")).toBeNull();
    expect(headlineCoverageNote(p.dataQuality, "mark_to_market", "main")).toBeNull();
  });
});

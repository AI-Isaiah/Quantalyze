/**
 * 194 plan 16 (TRUST-05, D-04 as superseded by D-15): the factsheet's JSON-LD `interestRate`
 * follows the record verdict a reader sees. WHY it matters: crawlers and LLMs ingest this
 * object as the strategy's yield, so a CAGR the page withholds must never be published, and a
 * short one must travel with the note the page prints beside it.
 *
 * The payload is a minimal hand-built object cast to the real type: the builder reads only
 * name, description, aum, ingestSource, strategyMetrics.cagr and figureRecord. All figures
 * are synthetic.
 */
import { describe, it, expect } from "vitest";
import { buildFactsheetJsonLd } from "./json-ld";
import { shortTrackNote } from "@/lib/figure-gate";
import type { FigureRecord } from "@/lib/figure-gate";
import type { FactsheetPayload } from "@/lib/factsheet/types";

const CAGR = 0.4321;

function payload(
  over: {
    ingestSource?: "api" | "csv";
    cagr?: number;
    figureRecord?: FigureRecord | null;
    omitRecord?: boolean;
    aum?: number | null;
    description?: string | null;
  } = {},
): FactsheetPayload {
  const base: Record<string, unknown> = {
    ingestSource: over.ingestSource ?? "api",
    strategyName: "Synthetic Strategy",
    description: over.description === undefined ? "A synthetic description" : over.description,
    aum: over.aum === undefined ? 1_000_000 : over.aum,
    strategyMetrics: { cagr: over.cagr ?? CAGR },
  };
  if (!over.omitRecord) base.figureRecord = over.figureRecord === undefined ? null : over.figureRecord;
  return base as unknown as FactsheetPayload;
}

const crypto = (spanDays: number | null): FigureRecord => ({ spanDays, observations: null, crypto: true });
const trad = (observations: number, spanDays: number | null): FigureRecord => ({
  spanDays,
  observations,
  crypto: false,
});

describe("buildFactsheetJsonLd - interestRate follows the record verdict (D-15)", () => {
  it("a crypto record of 60 days (under the 90-day bound) publishes no interestRate", () => {
    const ld = buildFactsheetJsonLd(payload({ figureRecord: crypto(60) }));
    expect("interestRate" in ld && ld.interestRate !== undefined).toBe(false);
    expect(JSON.stringify(ld)).not.toContain("interestRate");
    expect(JSON.stringify(ld)).not.toContain(String(CAGR));
  });

  it("a non-crypto record of 59 observations publishes none; 60 observations over 84 days publishes the noted value", () => {
    const withheld = buildFactsheetJsonLd(payload({ figureRecord: trad(59, 400) }));
    expect(withheld.interestRate).toBeUndefined();

    const short = buildFactsheetJsonLd(payload({ figureRecord: trad(60, 84) }));
    expect(short.interestRate).toEqual({
      "@type": "QuantitativeValue",
      value: CAGR,
      description: shortTrackNote("record", 84),
    });
  });

  it("a cleared 200-day record publishes the QuantitativeValue with the record note", () => {
    const ld = buildFactsheetJsonLd(payload({ figureRecord: crypto(200) }));
    expect(ld.interestRate).toEqual({
      "@type": "QuantitativeValue",
      value: CAGR,
      description: shortTrackNote("record", 200),
    });
  });

  it("a 400-day record, or a record that cannot be determined, publishes the plain number", () => {
    expect(buildFactsheetJsonLd(payload({ figureRecord: crypto(400) })).interestRate).toBe(CAGR);
    // Unknown span reads as the null figure state: the figure stays, as today.
    expect(buildFactsheetJsonLd(payload({ figureRecord: crypto(null) })).interestRate).toBe(CAGR);
    expect(buildFactsheetJsonLd(payload({ figureRecord: null })).interestRate).toBe(CAGR);
    expect(buildFactsheetJsonLd(payload({ omitRecord: true })).interestRate).toBe(CAGR);
  });

  it("a csv strategy or a non-finite CAGR publishes no interestRate (today's rule), whatever the record", () => {
    expect(buildFactsheetJsonLd(payload({ ingestSource: "csv", figureRecord: crypto(400) })).interestRate).toBeUndefined();
    expect(buildFactsheetJsonLd(payload({ cagr: Number.NaN, figureRecord: crypto(400) })).interestRate).toBeUndefined();
    expect(
      buildFactsheetJsonLd(payload({ cagr: Number.POSITIVE_INFINITY, figureRecord: crypto(200) })).interestRate,
    ).toBeUndefined();
  });

  it("every other key is today's object: context, type, name, description, provider, fees", () => {
    const ld = buildFactsheetJsonLd(payload({ figureRecord: crypto(60) }), { showAum: true });
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "FinancialProduct",
      name: "Synthetic Strategy",
      description: "A synthetic description",
      provider: { "@type": "Organization", name: "Quantalyze" },
      feesAndCommissionsSpecification: "AUM 1000000",
    });
    const bare = buildFactsheetJsonLd(payload({ aum: null, description: null, figureRecord: crypto(400) }));
    expect(bare.description).toBeUndefined();
    expect(bare.feesAndCommissionsSpecification).toBeUndefined();
  });
});

describe("buildFactsheetJsonLd - AUM follows the per-viewer rule (D-22)", () => {
  it("publishes no AUM unless the caller says this viewer may see it", () => {
    expect(buildFactsheetJsonLd(payload()).feesAndCommissionsSpecification).toBeUndefined();
    expect(buildFactsheetJsonLd(payload(), {}).feesAndCommissionsSpecification).toBeUndefined();
    expect(buildFactsheetJsonLd(payload(), { showAum: false }).feesAndCommissionsSpecification).toBeUndefined();
    expect(JSON.stringify(buildFactsheetJsonLd(payload()))).not.toContain("1000000");
  });

  it("publishes AUM when showAum is true and the strategy has one", () => {
    expect(buildFactsheetJsonLd(payload(), { showAum: true }).feesAndCommissionsSpecification).toBe("AUM 1000000");
    expect(
      buildFactsheetJsonLd(payload({ aum: null }), { showAum: true }).feesAndCommissionsSpecification,
    ).toBeUndefined();
  });
});


import { gateAnnualized, shortTrackNote } from "@/lib/figure-gate";
import type { FactsheetPayload } from "@/lib/factsheet/types";

/** schema.org `QuantitativeValue`: a CAGR that carries the note a reader sees beside it. */
export interface JsonLdQuantitativeValue {
  "@type": "QuantitativeValue";
  value: number;
  description: string;
}

export interface FactsheetJsonLd {
  "@context": "https://schema.org";
  "@type": "FinancialProduct";
  name: string;
  description: string | undefined;
  provider: { "@type": "Organization"; name: string };
  feesAndCommissionsSpecification: string | undefined;
  interestRate: number | JsonLdQuantitativeValue | undefined;
}

/**
 * The factsheet page's JSON-LD FinancialProduct object, built from the payload alone.
 *
 * Pure: the page stringifies it and escapes `</` (`jsonLdStr` in page.tsx). It lives here
 * and not in page.tsx because a Next.js page file may export only what the framework
 * allows.
 *
 * FINDING-7 (b06-silentfailure): Only publish CAGR as a machine-readable
 * interestRate when it is a finite number AND the strategy is API-verified.
 * NaN/Infinity serialize to null in JSON (benign but misleading), and CSV
 * strategies with short track records should not have their annualized CAGR
 * ingested by crawlers as a verified yield figure.
 *
 * 194 D-04 / D-15 (2026-11-07): the CAGR follows the record verdict a reader sees,
 * `gateAnnualized(payload.figureRecord)` (plan 04's full-history record). Withheld: the key
 * is omitted. Short (a cleared record under one year): a `QuantitativeValue` whose
 * `description` is `shortTrackNote("record", days)`, so a crawler gets the same note, not a
 * bare yield. Full, or a record that cannot be determined (absent or null span): the plain
 * number, as before. A withheld CAGR is never published and a short one never without its note.
 *
 * 194 D-22: `feesAndCommissionsSpecification` carries AUM only when the caller passes
 * `showAum: true` (the per-viewer allocator-or-own-manager rule, `canViewAum`). It defaults
 * to withheld, so a crawler or any other viewer gets no AUM. The decision is the caller's and
 * per request, never read off the cached payload.
 */
export function buildFactsheetJsonLd(
  payload: FactsheetPayload,
  options: { showAum?: boolean } = {},
): FactsheetJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    name: payload.strategyName,
    description: payload.description ?? undefined,
    provider: { "@type": "Organization", name: "Quantalyze" },
    feesAndCommissionsSpecification:
      options.showAum === true && payload.aum != null ? `AUM ${payload.aum}` : undefined,
    interestRate: interestRate(payload),
  };
}

function interestRate(payload: FactsheetPayload): number | JsonLdQuantitativeValue | undefined {
  const cagr = payload.strategyMetrics.cagr;
  if (!Number.isFinite(cagr) || payload.ingestSource !== "api") return undefined;
  const record = payload.figureRecord;
  if (record == null) return cagr;
  const state = gateAnnualized(record);
  if (state === "withheld") return undefined;
  // `short` implies a determined span (a null window reads as the `null` state).
  if (state === "short" && record.spanDays != null) {
    return {
      "@type": "QuantitativeValue",
      value: cagr,
      description: shortTrackNote("record", record.spanDays),
    };
  }
  return cagr;
}

/**
 * Phase 164.6.6.3.3 FACTSHEETTRUTH (D-01 note payload, D-03) — which span does a
 * stored factsheet headline cover, and why did the return chain break?
 *
 * One marker decides it. A chain-broken row (`data_quality_flags.twr_chain_broken
 * === true`) either carries `headline_since`, the first day of the one span its
 * seven stored scalars were computed over (the headline is "Dated"), or it does
 * not, in which case it is a legacy row whose stored numbers mix two bases and
 * cannot be shown to cover any one span (the headline is "Withheld", D-03).
 * RESEARCH 1.6: there is no stored placeholder to detect by value, so the marker
 * is the only honest discriminator.
 *
 * PURE and client-safe on purpose: no `server-only` import. The read path
 * (`composite-read-path.ts`) calls {@link readHeadlineBasis}; the factsheet
 * render and the OG card import {@link joinGuardPhrases} to turn the closed
 * {@link GuardReason} set into public text (UI-SPEC §1.2). Flag names, balance
 * magnitudes and job vocabulary never leave this module.
 */

import { isRankableAnalyticsRow } from "@/lib/closed-sets";
import { BASIS_KPI_MAP } from "./basis-metrics";

/** The closed set of reasons a guard flag can put on a public page. */
export type GuardReason = "negative_nav" | "dust_nav" | "flow_dominated" | "pnl_dominated";

/**
 * Flag-to-reason table, in the UI-SPEC §1.2 order. That order is also the order
 * the reasons are joined in, so a reader never sees them permuted.
 */
const GUARD_FLAGS = [
  ["negative_nav_guard", "negative_nav"],
  ["dust_nav_guard", "dust_nav"],
  ["flow_dominated_guard", "flow_dominated"],
  ["pnl_dominated_guard", "pnl_dominated"],
] as const satisfies ReadonlyArray<readonly [string, GuardReason]>;

/**
 * The only text a guard reason ever becomes (UI-SPEC §1.2, verbatim). A new
 * {@link GuardReason} with no phrase is a compile error.
 */
export const GUARD_REASON_PHRASES = {
  negative_nav: "a zero or negative account balance",
  dust_nav: "a near-zero account balance",
  flow_dominated: "a deposit or withdrawal larger than the balance",
  pnl_dominated: "a one-day gain or loss larger than the balance",
} as const satisfies Record<GuardReason, string>;

/** The phrase when the break has none of the four named causes. */
const NO_REASON_PHRASE = "a break in the return chain";

/**
 * UI-SPEC §1.2 join rule `{R}`: phrases in table order; one stands alone, two
 * are joined with " and ", three or four with ", " and a final " and ". No
 * reasons at all is {@link NO_REASON_PHRASE}.
 */
export function joinGuardPhrases(reasons: ReadonlyArray<GuardReason>): string {
  const phrases = reasons.map((r) => GUARD_REASON_PHRASES[r]);
  if (phrases.length === 0) return NO_REASON_PHRASE;
  if (phrases.length === 1) return phrases[0];
  return `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A real calendar date in strict `YYYY-MM-DD` form. The shape check alone would
 * accept 2026-02-30; the `Date.UTC` round-trip rejects it.
 */
function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export interface HeadlineBasis {
  /** `twr_chain_broken === true`, strictly. */
  twrChainBroken: boolean;
  /** The first day of the covered span; only on a chain-broken row, only when valid. */
  headlineSince: string | null;
  /** The guard reasons, in table order; empty on a clean row. */
  reasons: GuardReason[];
  /** Chain-broken with no valid `headline_since`: the stored scalars must not be shown. */
  withheld: boolean;
}

/**
 * Read a row's `data_quality_flags` into its {@link HeadlineBasis}. Every flag is
 * strict `=== true` (a string "true" or 1 never counts, T-92-05), and a
 * malformed `headline_since` is treated exactly as an absent one (UI-SPEC §1.2):
 * it makes the row Withheld, never an undated note.
 */
export function readHeadlineBasis(dqf: unknown): HeadlineBasis {
  const flags: Record<string, unknown> =
    dqf !== null && typeof dqf === "object" && !Array.isArray(dqf) ? (dqf as Record<string, unknown>) : {};
  const twrChainBroken = flags.twr_chain_broken === true;
  if (!twrChainBroken) {
    return { twrChainBroken: false, headlineSince: null, reasons: [], withheld: false };
  }
  const headlineSince = isValidIsoDate(flags.headline_since) ? flags.headline_since : null;
  const reasons = GUARD_FLAGS.filter(([flag]) => flags[flag] === true).map(([, reason]) => reason);
  return { twrChainBroken: true, headlineSince, reasons, withheld: headlineSince === null };
}

/**
 * Phase 164.6.6.3.3 round 2 (SFH-R2-01, D-03, D-06) — the ONE decision about a
 * row's headline, shared by the factsheet read path
 * (`composite-read-path.ts` `applyHeadlineBasis`, reached by
 * `readSingleKeyBasisOpts`) and the OG share card (`og-metrics.ts`
 * `computeOgHeadline`), so the card and the page cannot disagree about the same
 * row.
 *
 * A stored cash headline is "applicable" when the page can overlay it
 * ({@link storedCashHeadlineGate}). The verdict:
 *   - not chain-broken            -> `clean`;
 *   - chain-broken, applicable, valid `headline_since` -> `dated` (the stored
 *     figures cover one span, from `since`);
 *   - chain-broken, applicable, no valid `headline_since` -> `withheld` (D-03,
 *     a legacy mixed-basis row);
 *   - chain-broken, NOT applicable -> `withheld`. There is no stored headline for a
 *     date to describe, and the surface would otherwise compute its figures from
 *     the whole-record series, which compounds across the very break the flag
 *     names (SFH-01 on the page, SFH-R2-01 on the card).
 *
 * D-14 (founder, review round 2 R2-03): a Withheld verdict also carries its
 * {@link HeadlineWithholdCause}, so the page can say WHY without contradicting
 * a status it already shows. The card ignores the cause (NaN in every case).
 *   - `recomputing`: the stored headline is not applicable because the analytics
 *     row is `computing` or `pending` (the previous run's scalars are not shown);
 *   - `failed`: the row is `failed`; the page's existing "couldn't be computed"
 *     status line is the one cause on screen;
 *   - `unmeasured`: everything else, which keeps the original Withheld sentence:
 *     a chain-broken row with no valid `headline_since` (checked FIRST, so it
 *     stays `unmeasured` while computing or failed), and the `no_row`,
 *     `raw_cash_settlement` and `missing_keys` refusals, which D-14 does not cover.
 */
export type HeadlineWithholdCause = "unmeasured" | "recomputing" | "failed";

export type HeadlineVerdict =
  | { kind: "clean" }
  | { kind: "dated"; since: string }
  | { kind: "withheld"; cause: HeadlineWithholdCause };

export function headlineVerdict(
  dqf: unknown,
  gate: StoredCashHeadlineGate,
  computationStatus?: unknown,
): HeadlineVerdict {
  const basis = readHeadlineBasis(dqf);
  if (!basis.twrChainBroken) return { kind: "clean" };
  if (basis.headlineSince === null) return { kind: "withheld", cause: "unmeasured" };
  if (!gate.applicable) return { kind: "withheld", cause: withholdCauseOf(gate, computationStatus) };
  return { kind: "dated", since: basis.headlineSince };
}

/**
 * The D-14 cause of a refused gate. Only `not_rankable` can be anything but
 * `unmeasured`: `no_row`, `raw_cash_settlement` and `missing_keys` are refusals
 * of the row's SHAPE, and a status beside them says nothing about why.
 */
function withholdCauseOf(
  gate: Extract<StoredCashHeadlineGate, { applicable: false }>,
  computationStatus: unknown,
): HeadlineWithholdCause {
  if (gate.reason !== "not_rankable") return "unmeasured";
  if (computationStatus === "computing" || computationStatus === "pending") return "recomputing";
  if (computationStatus === "failed") return "failed";
  return "unmeasured";
}

/** Whether a stored cash headline can be overlaid, and if not, why. */
export type StoredCashHeadlineGate =
  | { applicable: true }
  | {
      applicable: false;
      reason: "no_row" | "not_rankable" | "raw_cash_settlement" | "missing_keys";
      /** The unprojected {@link BASIS_KPI_MAP} server keys, on `missing_keys` only. */
      missing?: string[];
    };

/**
 * Whether the persisted row's seven scalars can stand as the cash headline. The
 * single owner of that structural gate: `persistedCashHeadline` (the page) builds
 * the headline only when it passes, and `computeOgHeadline` (the card) asks the
 * same question. In order: a row was passed; it is rankable (a failed or
 * computing row still carries the previous run's scalars, STALE-01); the raw
 * `metrics_json_by_basis` carries no `cash_settlement` OBJECT (a lingering
 * composite -> single key, D-10); and all seven {@link BASIS_KPI_MAP} keys are
 * projected.
 */
export function storedCashHeadlineGate(
  persistedRow: Record<string, unknown> | null | undefined,
  metricsJsonByBasis: unknown,
  computationStatus: unknown,
): StoredCashHeadlineGate {
  if (persistedRow == null) return { applicable: false, reason: "no_row" };
  if (!isRankableAnalyticsRow({ computation_status: typeof computationStatus === "string" ? computationStatus : null })) {
    return { applicable: false, reason: "not_rankable" };
  }
  if (metricsJsonByBasis !== null && typeof metricsJsonByBasis === "object" && !Array.isArray(metricsJsonByBasis)) {
    const rawCash = (metricsJsonByBasis as Record<string, unknown>).cash_settlement;
    if (rawCash !== null && typeof rawCash === "object" && !Array.isArray(rawCash)) {
      return { applicable: false, reason: "raw_cash_settlement" };
    }
  }
  const missing = BASIS_KPI_MAP.filter(({ serverKey }) => !(serverKey in persistedRow)).map((k) => k.serverKey);
  if (missing.length > 0) return { applicable: false, reason: "missing_keys", missing };
  return { applicable: true };
}

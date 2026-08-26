import { NextRequest, NextResponse, after } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withAuth } from "@/lib/api/withAuth";
import { csvValidateLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
import { isUuid } from "@/lib/utils";
import { isComputedAnalytics } from "@/lib/closed-sets";
import { canonicalizeExchangeList } from "@/lib/constants";
import { MAGNITUDE_CAPS } from "@/lib/closed-sets";
import { captureToSentry } from "@/lib/sentry-capture";
import { scrubSeamError } from "@/lib/seam-redaction";
import {
  pgConstraintName,
  WIZARD_SESSION_CONSTRAINTS,
} from "@/lib/api/pgConstraintName";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
// 146.2-06 / T-146.2-12 — STATIC, matching the preferences route's call-site
// shape. The two `await import("@/lib/supabase/admin")` sites further down live
// inside `after()` epilogues where the lazy load costs nothing; this emission
// runs on the request path, where a dynamic import would add a resolution hop
// to every successful finalize.
import { logAuditEventAsUser } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/strategies/csv-finalize — Phase 15 / CSV-01, refolded by
 * Phase 145 / JOB-06.
 *
 * Calls the SECURITY DEFINER `finalize_csv_strategy_with_returns` RPC
 * (migration 20260819120000) which atomically inserts a strategies row +
 * a strategy_verifications row with trust_tier='csv_uploaded' + the
 * csv_daily_returns series, in ONE transaction, returning the new
 * strategy_id. The fold has no EXCEPTION block: any failure rolls all
 * three writes back, so a failed finalize commits NOTHING.
 *
 * The terminal status is p_terminal_status: 'pending_review' for the manager
 * flow (publish candidate) or 'private' for a CONTRIB-02 (Phase 110) allocator
 * contribution (owner-only, never a publish candidate). Both flows call the
 * fold directly on the SSR user-scoped client (see the two handlers).
 *
 * Phase 19 / BACKBONE-10 → Phase 106 Stage B → Phase 145 (reversal)
 * ------------------------------------------------------------------
 * Phase 106 Stage B made the Python `/process-key` unified backbone the
 * sole manager-path finalize writer. Phase 145 (founder decision D-06,
 * recorded in .planning/phases/145-job-csv-finalize-atomicity/145-DECISION.md,
 * option i-b) CONSCIOUSLY REVERSED that ruling for this flow: the HTTP hop
 * to Python could never be inside the finalize transaction, so the route
 * now calls the folded RPC directly — the CONTRIB-02 shape, for both
 * paths. The Python csv-finalize branch was deleted in the same change
 * (leaving it live would be a second writer).
 *
 * Cross-AI revision 2026-04-30: the strategy NAME is provided by the
 * user (typed on the Upload step) and forwarded here in the request
 * body. The prior random codename pick from `@/lib/constants` is REMOVED
 * — we do not import that const at all on this route, and the route
 * validates the user-typed name's shape (1–80 chars) before calling
 * the RPC. The RPC also validates server-side; this is defense in
 * depth so the error envelope is more specific than a generic 22023.
 *
 * Error envelope shape (v1): { ok: false, code, human_message,
 * debug_context, correlation_id }. Phase 19.1 specialist review
 * 2026-05-22 / API W-1 threaded a route-level UUID through every
 * envelope (success + error). Phase 16 / OBSERV-06 will replace the
 * crypto.randomUUID() with the Sentry-resolved id when that lands;
 * the contract is the same.
 *
 * Success envelope shape (v1): { ok: true, strategy_id, status,
 * correlation_id }. Phase 19.1 / API C-1 added the `ok: true`
 * discriminator so consumers can branch on body.ok without status-
 * code sniffing.
 */

/**
 * Phase 140 / SEAM-02 — pinned for clarity; asserted against
 * SEAM_ROUTE_BUDGETS by seam-budgets.invariant.test.
 *
 * 300 is the project's VERIFIED effective Vercel default
 * (`defaultResourceConfig.functionDefaultTimeout: 300`, read from the live
 * project settings on 2026-07-25), so declaring it here cannot raise this
 * route's worst-case lambda hold. It exists so the SC-4b headroom invariant
 * has an in-repo source of truth instead of a dashboard-changeable
 * assumption: this route spends one `process-key-sync` budget (60s — the CSV
 * flow runs the full pipeline INLINE), 5× headroom.
 */
export const maxDuration = 300;

const ALLOWED_FMTS = new Set(["daily_returns", "daily_nav", "trades"]);
const MAX_NAME_CHARS = MAGNITUDE_CAPS.MAX_NAME_CHARS;

// Phase 19.1 — CSV → analytics pipeline. The wizard's csv-validate step
// canonicalises every supported `fmt` into a `daily_returns_series` array
// (NAV → pct_change for `daily_nav`; verbatim for `daily_returns`; absent
// for `trades`). Since Phase 145 the series is persisted INSIDE the folded
// SECURITY DEFINER `finalize_csv_strategy_with_returns` RPC (same
// transaction as the strategy row), and `compute_analytics_from_csv` is
// enqueued for the Python worker afterwards.
//
// All validation runs at the route boundary — `parseDailyReturnsSeries`
// is the single gate that protects the RPC from malformed input. The
// duplicate-date guard returns a clean 400 here so the UNIQUE
// (strategy_id, date) index under the fold's plain INSERT never has to
// surface a 23505 to the user (PR #274 / T-19.1-04 mitigation; since the
// fold this guard is LOAD-BEARING — the fold has no upsert to absorb a
// duplicate).
const MAX_DAILY_RETURNS_ROWS = 5000;
const DAILY_RETURNS_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
/**
 * R7 (146.2-06) — the earliest date a daily-returns row may carry.
 *
 * ⛔ THIS IS A COPY OF THE FOLD'S OWN LITERAL, and the two must stay equal.
 * `finalize_csv_strategy_with_returns` GUARD 9 refuses `(elem->>'date')::DATE
 * < DATE '1900-01-01'` with SQLSTATE 22023
 * (GUARD 9 of `finalize_csv_strategy_with_returns`, carried unchanged from
 * the definition `20260819130000` re-issued). See the fence in
 * `parseDailyReturnsSeries` for why mirroring it route-side matters: a fold
 * 22023 is answered 500 "safe to try again", which is false for an input that
 * fails identically forever.
 */
const MIN_DAILY_RETURN_DATE = "1900-01-01";

/**
 * One row in the persisted CSV daily-returns series. Mirrors the JSONB
 * element shape that `finalize_csv_strategy_with_returns(p_rows JSONB)`
 * consumes; the RPC's body re-validates with `jsonb_typeof` etc., but the
 * route's parser is the load-bearing gate that turns malformed input into
 * a clean `400 CSV_INVALID_FORMAT` envelope instead of letting the RPC
 * raise a 23505 / 22023.
 */
export interface CsvDailyReturnRow {
  /** YYYY-MM-DD (UTC calendar date). */
  date: string;
  /** Finite number; the daily fractional return for `date`. */
  daily_return: number;
}

/**
 * Parsed envelope. `ok=true` → `rows` is the validated series (possibly
 * empty for `trades` fmt where the wizard omits the field entirely);
 * `ok=false` → caller renders a 400 `CSV_INVALID_FORMAT` response with
 * the human-readable message + optional debug_context (row index +
 * offending date for the duplicate-date case).
 *
 * Invariants enforced:
 *   1. Array shape — anything else returns "must be an array".
 *   2. ≤ 5000 rows — message cites the literal cap so the caller can
 *      surface it to the user without hard-coding the constant twice.
 *   3. YYYY-MM-DD date — the worker indexes on this exact format.
 *   4. Finite numeric daily_return — NaN / Infinity short-circuited
 *      before reaching the RPC (T-19.1-12).
 *   5. Unique dates — duplicate guard (T-19.1-04, PR #274). Pre-fix
 *      a hostile or buggy client could send two rows with the same
 *      date and trigger the UNIQUE (strategy_id, date) constraint
 *      inside the RPC as a 23505 → 500. We turn it into a 400 here.
 */
type ParsedDailyReturnsSeries =
  | { ok: true; rows: CsvDailyReturnRow[] }
  | {
      ok: false;
      code: "CSV_INVALID_FORMAT";
      message: string;
      debug_context?: Record<string, unknown>;
    };

export function parseDailyReturnsSeries(raw: unknown): ParsedDailyReturnsSeries {
  // Absent (e.g. fmt=trades, or legacy clients pre-19.1) — treat as
  // empty so the unified path doesn't try to persist an empty series.
  if (raw === undefined || raw === null) {
    return { ok: true, rows: [] };
  }
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      code: "CSV_INVALID_FORMAT",
      message: "daily_returns_series must be an array.",
    };
  }
  if (raw.length > MAX_DAILY_RETURNS_ROWS) {
    return {
      ok: false,
      code: "CSV_INVALID_FORMAT",
      message: `daily_returns_series exceeds ${MAX_DAILY_RETURNS_ROWS} rows (got ${raw.length}).`,
      debug_context: { row_count: raw.length, cap: MAX_DAILY_RETURNS_ROWS },
    };
  }
  const out: CsvDailyReturnRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object") {
      return {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        message: `daily_returns_series[${i}] must be an object.`,
        debug_context: { row: i },
      };
    }
    const r = row as Record<string, unknown>;
    if (typeof r.date !== "string" || !DAILY_RETURNS_DATE_REGEX.test(r.date)) {
      return {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        message: `daily_returns_series[${i}].date must be a YYYY-MM-DD string.`,
        debug_context: { row: i, date: typeof r.date === "string" ? r.date : null },
      };
    }
    if (typeof r.daily_return !== "number" || !Number.isFinite(r.daily_return)) {
      return {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        message: `daily_returns_series[${i}].daily_return must be a finite number.`,
        debug_context: { row: i },
      };
    }
    // NEW-C14-09: bound daily_return magnitude. The dollar fields have
    // MAX_DOLLAR_VALUE to prevent absurd factsheet figures; the load-bearing
    // return series had no equivalent ceiling. A single 1e30 row drives
    // cumulative return / TWR / Sharpe to ±Inf on a published "Verified"
    // factsheet. Reject rows whose |daily_return| is outside the physically
    // plausible range ~[-1, 10] (a daily return of +1000% is far outside any
    // real strategy; -100% means total loss in one day).
    const MAX_DAILY_RETURN = 10; // +1000% per day
    if (Math.abs(r.daily_return) > MAX_DAILY_RETURN) {
      return {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        message: `daily_returns_series[${i}].daily_return is non-physical (${r.daily_return}). Values must be in the range [-${MAX_DAILY_RETURN}, ${MAX_DAILY_RETURN}].`,
        debug_context: { row: i, daily_return: r.daily_return },
      };
    }
    // NEW-C14-10: validate date calendar correctness via a Date.parse
    // round-trip. The regex /^\d{4}-\d{2}-\d{2}$/ accepts impossible
    // dates like "2026-13-45" or "2026-02-30" — they pass the regex but
    // fail Date.parse → NaN, or round-trip to a different date string.
    // Both signal invalid input. Also reject dates strictly after UTC
    // today — a future date finalizes a strategy whose factsheet
    // date_range is nonsensical.
    const parsedDate = new Date(r.date + "T00:00:00Z");
    if (
      isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== r.date
    ) {
      return {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        message: `daily_returns_series[${i}].date is not a valid calendar date: ${r.date}.`,
        debug_context: { row: i, date: r.date },
      };
    }
    const todayUtc = new Date();
    todayUtc.setUTCHours(23, 59, 59, 999); // allow today
    if (parsedDate > todayUtc) {
      return {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        message: `daily_returns_series[${i}].date is in the future: ${r.date}.`,
        debug_context: { row: i, date: r.date },
      };
    }
    // R7 (146.2-06) — THE DATE LOWER BOUND, MIRRORING THE FOLD.
    //
    // The fold already refuses this row (GUARD 9 of
    // `finalize_csv_strategy_with_returns` —
    // `OR (elem->>'date')::DATE < DATE '1900-01-01'`) with SQLSTATE 22023.
    // But a fold 22023 is a CLASS 1 rolled-back failure here, answered 500
    // CSV_FINALIZE_FAIL whose copy says the submission is SAFE TO TRY AGAIN.
    // It is not: this input fails identically forever, so the user is invited
    // into a retry loop that cannot terminate. Classify it at the boundary
    // instead — which is what the two SIBLING fences above already do: the
    // |daily_return| <= 10 bound mirrors GUARD 9's `BETWEEN -10 AND 10`, and
    // the future-date arm mirrors its `> now()::date` conjunct. Only the
    // lower bound was missing.
    //
    // ⛔ `MIN_DAILY_RETURN_DATE` IS THE FOLD'S LITERAL, COPIED — not rounded
    // to the Unix epoch or to anything tidier. A route bound TIGHTER than the
    // fold's silently refuses payloads the database would accept; a LOOSER one
    // re-opens the retry-copy 500 this closes. If GUARD 9's literal ever
    // moves, this one moves in the same commit.
    //
    // The comparison is LEXICOGRAPHIC on purpose, and it is sound here for the
    // same reason the resolve arm's min/max scan and its ORDER BY date reads
    // are (see the note at the series-equality check): `date` is fixed-width
    // `YYYY-MM-DD`, regex-validated at the top of this loop and calendar-
    // validated immediately above, and for that format lexicographic and
    // chronological order coincide. Comparing the already-parsed Date object
    // would work too; the string form keeps the fence textually identical to
    // the SQL literal it mirrors.
    if (r.date < MIN_DAILY_RETURN_DATE) {
      return {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        message: `daily_returns_series[${i}].date is before the earliest supported date ${MIN_DAILY_RETURN_DATE}: ${r.date}.`,
        debug_context: { row: i, date: r.date },
      };
    }
    // T-19.1-04 / PR #274: surface a duplicate date as a route-boundary
    // 400 so the UNIQUE (strategy_id, date) index never has to throw
    // 23505. Since Phase 145 this guard is LOAD-BEARING, not just
    // defense-in-depth: the fold's dailies write is a plain INSERT (no
    // ON CONFLICT — a fresh strategy id cannot conflict with committed
    // rows), so a duplicate date slipping through would raise 23505
    // inside the fold and roll the whole finalize back.
    if (seen.has(r.date)) {
      return {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        message: `daily_returns_series[${i}].date is a duplicate date: ${r.date}.`,
        debug_context: { row: i, date: r.date },
      };
    }
    seen.add(r.date);
    out.push({ date: r.date, daily_return: r.daily_return });
  }
  return { ok: true, rows: out };
}

/**
 * Subset of `strategies` columns the wizard's csv_metadata step can
 * populate. Every field is optional — back-compat lets clients call
 * csv-finalize without metadata, but the wizard always provides them
 * after QA report 2026-05-21 ISSUE-010 landed. Validation here is
 * defense-in-depth: caps array sizes + numeric ranges so a malformed
 * client can't overflow the row.
 */
interface CsvMetadataPayload {
  description?: string;
  category_id?: string | null;
  strategy_types?: string[];
  subtypes?: string[];
  markets?: string[];
  supported_exchanges?: string[];
  leverage_range?: string;
  aum?: string;
  max_capacity?: string;
  // #597 part 2 — the wizard's asset_class picker value (drives √365 crypto /
  // √252 traditional KPI annualization). Closed set; the CSV branch keeps the
  // user's choice (traditional is legitimate here — no API-key force-derive).
  asset_class?: "crypto" | "traditional";
}

const MAX_DESCRIPTION_CHARS = MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS;
const MAX_CHIP_GROUP_SIZE = 32;
const MAX_LEVERAGE_RANGE_CHARS = 80;
// Anything north of 1e12 USD is garbage (a typo, scientific notation, or
// hostile client) — reject so the public sheet doesn't render absurd numbers.
// Shared AUM/capacity cap (B8), distinct from the 1e9 ticket-size cap.
const MAX_DOLLAR_VALUE = MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD;

/**
 * NEW-C14-03 + NEW-C14-05: parseCsvMetadata now returns a discriminated
 * union so callers can issue a 400 when a field is present-but-invalid.
 * Pre-fix: bad aum/max_capacity silently dropped to null (parseMoney
 * returns null for negative/NaN/≥1e12) and the route returned ok:true
 * with AUM silently absent. Similarly, over-length description/chips were
 * silently truncated (NEW-C14-05).
 *
 * Contract:
 *   ok: true  → `payload` is safe to pass to buildMetadataUpdatePayload.
 *   ok: false → `field` + `message` describe which field and why; caller
 *               returns 400 CSV_INVALID_FORMAT with the message.
 *
 * "Omitted" (field absent / null) is still allowed. Only present-but-bad
 * values trigger ok:false.
 */
type ParseCsvMetadataResult =
  | { ok: true; payload: CsvMetadataPayload | null }
  | { ok: false; field: string; message: string };

// Exported for direct unit testing: this is the SINGLE shared validator both
// the pre-create (line ~928) and post-create (`applyCsvMetadataUpdate`, line
// ~1135) guards depend on. Unit-testing it pins the WR-04 contract independent
// of which call site fires.
export function parseCsvMetadata(raw: unknown): ParseCsvMetadataResult {
  if (raw == null || typeof raw !== "object") {
    return { ok: true, payload: null };
  }
  const obj = raw as Record<string, unknown>;
  const out: CsvMetadataPayload = {};

  // NEW-C14-05: reject over-cap description instead of silently truncating.
  if (typeof obj.description === "string") {
    if (obj.description.length > MAX_DESCRIPTION_CHARS) {
      return {
        ok: false,
        field: "metadata.description",
        message: `description must be ${MAX_DESCRIPTION_CHARS} characters or fewer (got ${obj.description.length}).`,
      };
    }
    out.description = obj.description;
  }

  // /ship specialist review (api-contract): the column is UUID, the
  // wizard sends a UUID, but the route used to accept any string. A
  // typo would trigger Postgres 22P02 inside the metadata UPDATE which
  // we already swallow as non-fatal — the user would land a published
  // strategy whose category_id silently failed to persist, breaking
  // discovery. Validate at the route boundary so the field either
  // lands cleanly or is rejected (better UX than a silent drop).
  //
  // WR-04 (Phase 53) — defense-in-depth for QA ISSUE-010: the csv_metadata
  // step exists precisely to STOP the CSV branch persisting category_id=null
  // (which leaves the strategy invisible to discovery). The client disabled-
  // gate is the first line of defense, but if it is ever loosened — or the
  // discovery_categories fetch fails/returns empty so the client never sets
  // a categoryId — an explicit `category_id: null` must NOT silently persist.
  // Reject it as a caller error here so the server is the authoritative guard,
  // not the client. (An ABSENT key — metadata-less finalize — is a different,
  // legitimate path and is left untouched.)
  if (obj.category_id === null) {
    return {
      ok: false,
      field: "metadata.category_id",
      message:
        "category_id is required — select a strategy category before submitting.",
    };
  } else if (obj.category_id !== undefined) {
    // WR-02 (Phase 146.2 review): a present-but-invalid category_id used to be
    // dropped SILENTLY, contradicting this block's own "better UX than a silent
    // drop" contract eight lines above and diverging from every sibling field
    // (asset_class and aum both 400 on present-but-invalid, NEW-C14-03).
    //
    // Pre-146.2 that only cost discovery visibility. This phase makes the drop
    // LOAD-BEARING: `category_id IS NULL` on the committed row is the FILL
    // discriminator (see the 23505 resolve arm), because asset_class is
    // NOT NULL DEFAULT 'traditional' and so cannot distinguish "never
    // classified" from "chose traditional". A silent drop mints a row that
    // reads "never classified" even though the metadata UPDATE *did* run —
    // so a later same-session resubmit takes the FILL arm and rewrites
    // description/aum/markets/strategy_types the user never resubmitted,
    // which is exactly the A4 mutation-on-an-echo the FILL/REFUSE split exists
    // to forbid. Reject at the boundary so "a committed NULL proves the UPDATE
    // never ran" is actually true.
    if (typeof obj.category_id !== "string" || !isUuid(obj.category_id)) {
      return {
        ok: false,
        field: "metadata.category_id",
        message: `category_id must be a UUID (got ${JSON.stringify(obj.category_id)}).`,
      };
    }
    out.category_id = obj.category_id;
  }

  // /ship specialist review (api-contract): mirror finalize-wizard's
  // canonicalizeExchangeList() call site. A stale wizard or hostile
  // client sending ["bybit", "Bybit"] used to persist verbatim and
  // re-introduce QA ISSUE-004 on the CSV path. The helper dedups
  // case-insensitively and snaps to the canonical EXCHANGES entry.
  // NEW-C14-05: reject over-cap chip arrays instead of silently truncating.
  for (const key of ["strategy_types", "subtypes", "markets"] as const) {
    const value = obj[key];
    if (Array.isArray(value)) {
      const strings = value.filter((v): v is string => typeof v === "string");
      if (strings.length > MAX_CHIP_GROUP_SIZE) {
        return {
          ok: false,
          field: `metadata.${key}`,
          message: `${key} must have at most ${MAX_CHIP_GROUP_SIZE} entries (got ${strings.length}).`,
        };
      }
      out[key] = strings;
    }
  }
  if (Array.isArray(obj.supported_exchanges)) {
    const cleaned = obj.supported_exchanges
      .filter((v): v is string => typeof v === "string");
    if (cleaned.length > MAX_CHIP_GROUP_SIZE) {
      return {
        ok: false,
        field: "metadata.supported_exchanges",
        message: `supported_exchanges must have at most ${MAX_CHIP_GROUP_SIZE} entries (got ${cleaned.length}).`,
      };
    }
    out.supported_exchanges = canonicalizeExchangeList(cleaned);
  }
  if (typeof obj.leverage_range === "string") {
    out.leverage_range = obj.leverage_range.slice(0, MAX_LEVERAGE_RANGE_CHARS);
  }

  // NEW-C14-03: reject present-but-unparseable aum / max_capacity instead
  // of silently dropping to null. Pre-fix: parseMoney returned null for
  // "-5" / "1e20" / "NaN" and buildMetadataUpdatePayload omitted null
  // values from the UPDATE → the route returned ok:true but the public
  // "Verified by Quantalyze" factsheet had AUM absent. Match the
  // fail-loud H-0325/H-0326 contract from finalize-wizard.
  //
  // NEW-C14-05: do NOT truncate the money string before parsing (a truncated
  // string can silently alter the numeric value). Validate length AFTER
  // confirming the value is a well-formed number so the error is specific.
  for (const moneyField of ["aum", "max_capacity"] as const) {
    const raw = obj[moneyField];
    if (raw !== undefined && raw !== null && raw !== "") {
      if (typeof raw !== "string") {
        return {
          ok: false,
          field: `metadata.${moneyField}`,
          message: `${moneyField} must be a string representation of a non-negative number under ${MAX_DOLLAR_VALUE} (got type ${typeof raw}).`,
        };
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n >= MAX_DOLLAR_VALUE) {
        return {
          ok: false,
          field: `metadata.${moneyField}`,
          message: `${moneyField} must be a finite non-negative number under ${MAX_DOLLAR_VALUE} (got "${raw}").`,
        };
      }
      out[moneyField] = raw;
    }
  }

  // #597 part 2 — asset_class closed-set validation. The CSV wizard forwards
  // the picker value (CsvSubmitStep); it drives √365 crypto / √252 traditional
  // KPI annualization. Mirror the NEW-C14-03 fail-loud contract: an absent /
  // null field is the legitimate metadata-less path (omit → column default,
  // byte-identical to today); a present-but-invalid value is a caller error →
  // 400 CSV_INVALID_FORMAT. No case-folding — the DB closed set is lowercase,
  // so 'CRYPTO' is a rejected value, not a silently-coerced one.
  if (obj.asset_class !== undefined && obj.asset_class !== null) {
    if (obj.asset_class !== "crypto" && obj.asset_class !== "traditional") {
      return {
        ok: false,
        field: "metadata.asset_class",
        message: `asset_class must be "crypto" or "traditional" (got ${JSON.stringify(obj.asset_class)}).`,
      };
    }
    out.asset_class = obj.asset_class;
  }

  // ⭐ 146.2-03 / G2 (2026-08-20) — THE INVARIANT THIS FUNCTION NOW ENFORCES,
  // stated once so the arm that depends on it can cite it:
  //
  //     EVERY metadata UPDATE this route issues writes a `category_id`.
  //
  // …and therefore a committed `category_id` reading SQL NULL is proof the
  // metadata UPDATE never ran. That proof is what the 23505 resolve arm's
  // FILL/REFUSE tri-state is built on, and until this check it was FALSE.
  //
  // WHAT WAS ACTUALLY TRUE BEFORE was a claim about the CLIENT — "the wizard
  // always sends a category_id" — not about this route. A blob that OMITS the
  // key while carrying any other field (`{asset_class:'crypto'}`,
  // `{aum:'1000'}`, `{description:'…'}`) ran a REAL UPDATE and left
  // `category_id` NULL. A later same-session resubmit then read that NULL as
  // "never classified", took the FILL arm, and `buildMetadataUpdatePayload`
  // rewrote description/aum/markets/asset_class the user never resubmitted —
  // the A4 mutation-on-an-echo this phase forbids — and, on `asset_class`,
  // moved the annualization clock on a row whose committed clock was a real
  // user choice. Unreachable from the wizard (`MetadataDraft.categoryId` is
  // `string | null`, never absent, so the key is always on the wire),
  // reachable at this route's documented contract.
  //
  // ⛔ THE METADATA-LESS PATH IS UNTOUCHED, and that is what keeps this honest
  // rather than merely strict. `metadata` absent or null → the early return at
  // the top of this function. `metadata: {}`, or a blob whose every field
  // parses to nothing → an EMPTY payload, which `buildMetadataUpdatePayload`
  // turns into no UPDATE at all. No UPDATE, nothing to prove. The rejection
  // fires ONLY where an UPDATE would actually run, which is exactly the set
  // the invariant quantifies over.
  //
  // Same register and same reason as the `category_id === null` rejection
  // above: a strategy persisted with `category_id` NULL is invisible to
  // discovery, and this route already refuses to let that happen silently.
  if (Object.keys(out).length > 0 && out.category_id === undefined) {
    return {
      ok: false,
      field: "metadata.category_id",
      message:
        "category_id is required whenever metadata is submitted — select a strategy category before submitting.",
    };
  }

  return { ok: true, payload: out };
}

/**
 * Build the UPDATE payload from a parsed metadata blob. Shared between
 * the manager-path handler and the CONTRIB-02 contribution handler so the
 * two cannot drift. Returns an empty object if there's nothing to write,
 * so the caller can early-skip the UPDATE roundtrip.
 */
// Exported for direct unit testing (mirrors parseCsvMetadata): pins the
// #597-part-2 contract that a validated asset_class rides this UPDATE and an
// absent field is omitted from it — independent of the route call site.
export function buildMetadataUpdatePayload(
  metadata: CsvMetadataPayload | null,
): Record<string, unknown> {
  const updatePayload: Record<string, unknown> = {};
  if (!metadata) return updatePayload;
  if (metadata.description !== undefined) {
    updatePayload.description = metadata.description;
  }
  if (metadata.category_id !== undefined) {
    updatePayload.category_id = metadata.category_id;
  }
  if (metadata.strategy_types !== undefined) {
    updatePayload.strategy_types = metadata.strategy_types;
  }
  if (metadata.subtypes !== undefined) {
    updatePayload.subtypes = metadata.subtypes;
  }
  if (metadata.markets !== undefined) {
    updatePayload.markets = metadata.markets;
  }
  if (metadata.supported_exchanges !== undefined) {
    updatePayload.supported_exchanges = metadata.supported_exchanges;
  }
  if (metadata.leverage_range !== undefined) {
    updatePayload.leverage_range = metadata.leverage_range;
  }
  // NEW-C14-03 / I1: aum/max_capacity are validated strings that
  // parseCsvMetadata already confirmed are finite, non-negative, and <
  // MAX_DOLLAR_VALUE. Skip parseMoney on this validated path — parseMoney
  // returns null for empty-string ("" → !value guard) so the wrapping
  // null-check was load-bearing only by coincidence. Using Number() directly
  // removes the implicit second validation layer and makes the intent
  // unambiguous: the string is known-good and the conversion always succeeds.
  if (metadata.aum !== undefined) {
    updatePayload.aum = Number(metadata.aum);
  }
  if (metadata.max_capacity !== undefined) {
    updatePayload.max_capacity = Number(metadata.max_capacity);
  }
  // #597 part 2 — persist the picker choice VERBATIM. parseCsvMetadata already
  // confirmed it is exactly 'crypto' or 'traditional'. LOCKED DECISION: the CSV
  // path keeps the user's choice — the finalize-wizard `apiKeyId ? "crypto"`
  // force-derive is API-key-only and must NOT be copied here (a genuinely
  // traditional CSV track record is the phase's one real √252 blend leg). An
  // absent field stays absent → column default null → 252 downstream. This
  // rides the existing owner-scoped, @audit-skipped strategies UPDATE in
  // applyCsvMetadataUpdate (no new mutation, no new pragma needed).
  if (metadata.asset_class !== undefined) {
    updatePayload.asset_class = metadata.asset_class;
  }
  return updatePayload;
}

/**
 * Phase 145 / JOB-06 (D-06 option i-b, D-07) — the ONE write path to
 * strategies + strategy_verifications + csv_daily_returns.
 *
 * Calls the folded SECURITY DEFINER `finalize_csv_strategy_with_returns`
 * RPC (migration 20260819120000) on the SSR user-scoped client. The fold
 * has NO EXCEPTION block: any failure inside it — including the 23505 the
 * double-submit index raises — rolls back ALL THREE writes together, so a
 * failed finalize commits NOTHING. Windows A/B/C of the pre-fold five-hop
 * sequence (CONTEXT.md, Phase 145) cease to exist; the only reachable
 * partial state is "strategy + dailies, no compute job" (window D), which
 * Phase 143's reconcile sweep already heals.
 *
 * Shared by BOTH handlers (manager + CONTRIB-02 contribution) so the two
 * writers the pre-fold route had converge on one call shape and cannot
 * drift (D-06 obligation: two writers converge on one).
 *
 * The cast-through-unknown pattern is inlined here — `database.types.ts`
 * is regenerated from the live DB and does not yet carry the fold (the
 * TEST apply lands in Plan 06), so a typed `.rpc()` call would fail
 * compilation. Centralising the cast in this helper means there's exactly
 * one place to delete when the types regeneration lands.
 */
type FinalizeAtomicOutcome =
  | {
      ok: true;
      strategyId: string;
      status: string;
      /**
       * 146.1 / A4 — WHICH of the two ok:true paths produced this outcome.
       * `true` = the fold CREATED the row on this request. `false` = a 23505
       * resolved onto a row a PRIOR request committed, and this request wrote
       * nothing.
       *
       * The callers use it to decide whether the post-outcome metadata UPDATE
       * is theirs to issue. On an echo it is not: the submission already
       * happened, and re-applying THIS request's metadata rewrites a
       * committed row — including `asset_class`, which is the annualization
       * clock (sqrt(365) crypto vs sqrt(252) traditional, #597 part 2) that
       * the already-stored KPIs were computed under.
       *
       * REQUIRED, never optional. Marking this field optional (a `?` on the
       * declaration) would let a future third return site omit it, defaulting
       * to `undefined` -> falsy -> silently treated as an echo, which is the
       * exact silence this field exists to prevent. Requiredness is what
       * forces the compiler to name every construction site.
       *
       * (The wrong shape is described rather than spelled, because the gate
       * that pins this is a raw grep over the source and would match its own
       * counter-example in a comment — the comment-blind grep class this
       * phase has now hit three times.)
       */
      fresh: boolean;
      /**
       * 146.2-01 / R1 — set ONLY on a 23505 resolve echo that the arm decided
       * must FILL: the committed row's `category_id` came back explicitly NULL,
       * which is observable proof that the metadata UPDATE of the FIRST attempt
       * never ran. The callers widen the metadata gate on it.
       *
       * OPTIONAL, deliberately — and the opposite call from `fresh` above, for
       * the opposite reason. `fresh` is required because omitting it defaults
       * to falsy ⇒ "treat as an echo" ⇒ silently skip a write the create needs.
       * Omitting THIS one defaults to falsy ⇒ "do not fill" ⇒ no write at all,
       * which is the status quo ante and the safe direction: a future return
       * site that forgets it cannot cause a write, only decline one.
       */
      fillClassification?: boolean;
      /**
       * 146.1 / C1 — set ONLY on the 23505 resolve echo, never on a fresh
       * create. It carries the arm's own statement of what it compared, so a
       * 200 that did not write this payload cannot be mistaken for one that
       * did. A fresh create leaves it undefined and its envelope is byte
       * identical to before.
       */
      humanMessage?: string;
    }
  | { ok: false; response: NextResponse };

async function finalizeAtomicOrErrorResponse(
  supabase: SupabaseClient,
  args: {
    userId: string;
    wizardSessionId: string;
    fmt: string;
    strategyName: string;
    rows: CsvDailyReturnRow[];
    terminalStatus: "pending_review" | "private";
    // 146.2-01 / R1 — THIS request's parsed classification. Same reason A2's
    // `terminalStatus` had to be declared: the caller already passed a wider
    // object, so these values were present at runtime and INVISIBLE to the
    // resolve arm. Nothing could compare against them until they were named.
    requestedCategoryId: string | null;
    requestedAssetClass: "crypto" | "traditional" | null;
  },
  opts: { logPrefix: string; correlationId: string },
): Promise<FinalizeAtomicOutcome> {
  // 146.1-07 task 1: the cast-through-unknown is GONE. `database.types.ts` now
  // carries `finalize_csv_strategy_with_returns`, so this call is type-checked
  // against the real signature and re-enters the audit-coverage law. Restoring
  // the cast would silently un-check the argument names on a money path.
  //
  // 146.2-06 — THE @audit-skip IS GONE, AND THAT IS THE POINT. It was an
  // honest placeholder ("no audit event on the CSV finalize path today"), but a
  // pragma is an exemption: while it sat here the audit-coverage law
  // (src/__tests__/audit-coverage.test.ts) waved this mutation through. This
  // call commits a user-visible strategy + its verification row + its whole
  // daily-returns series in ONE transaction — the creation of a track record on
  // a product whose entire value is that the record is trustworthy — and it was
  // the only such write with no forensic row at all. `create-with-key` skips
  // `create_wizard_strategy` on the grounds that "the user-visible creation is
  // audited at finalize time"; that rationale cannot be reused HERE, because
  // this IS finalize. With the pragma removed the law now REQUIRES the emission
  // below and reds if anyone deletes it (T-146.2-12, repudiation).
  //
  // ⚠️ THE EMISSION MUST STAY WITHIN 60 LINES BELOW THIS CALL. That is the
  // law's own coverage window (audit-coverage.test.ts `isCovered`), so moving
  // the emit further down — to the enqueue epilogue, say — silently
  // un-instruments this mutation again while every test stays green.
  //
  // OPS-06 (Phase 163) — THE ADMIN CLIENT IS BUILT HERE, ABOVE THE COMMIT, AND
  // THE REASON IS SEQUENCING RATHER THAN ERROR HANDLING.
  //
  // `createAdminClient()` throws synchronously when SUPABASE_SERVICE_ROLE_KEY
  // is absent (src/lib/supabase/admin.ts), and a call argument is evaluated
  // BEFORE the call it is an argument to — so `logAuditEventAsUser(
  // createAdminClient(), …)` at the emit site below constructed it AFTER the
  // fold had already committed a strategy, its verification row and its whole
  // daily-returns series. `logAuditEventAsUser`'s own try/catch wraps only the
  // `after()` scheduling, and `withAuth` has no catch, so that throw became an
  // opaque 500 over LANDED work: the user is told their upload failed while the
  // track record demonstrably exists. That is the exact inverse of the
  // fire-and-forget contract the emit docblock states 40 lines down.
  //
  // Constructed here the SAME throw is still loud — an uncaught throw in a
  // route handler is a Next.js 500 — but it fires with nothing written.
  // ⛔ Do NOT wrap this in try/catch, and do NOT reach for a NON-THROWING
  // variant of it: converting a loud failure into a quiet one is the
  // anti-pattern this phase exists to close, and the quiet variant would then
  // need its own rule to stop it spreading across the other 178
  // `createAdminClient()` call sites. Loud AND pre-commit is the whole fix.
  const admin = createAdminClient();

  // 146.1-07 task 1: this call was invisible to the audit law TWICE over — first
  // behind `supabase.rpc as unknown as (…)`, then behind a line break that put
  // the RPC name off the `.rpc(` line the law scans line-by-line. Keep the name
  // on the same line as `.rpc(`.
  const { data: newStrategyId, error } = await supabase.rpc("finalize_csv_strategy_with_returns", {
    p_user_id: args.userId,
    p_wizard_session_id: args.wizardSessionId,
    p_fmt: args.fmt,
    p_strategy_name: args.strategyName,
    p_rows: args.rows,
    p_terminal_status: args.terminalStatus,
  });

  // TS-13 discipline (140.3-02): the success check validates the PAYLOAD,
  // not just error-null — a 2xx that lost its id must not strand the
  // wizard's SyncProgress poller.
  if (!error && isUuid(newStrategyId)) {
    // 146.2-06 / T-146.2-12 — THE FORENSIC ROW FOR THE FINALIZE COMMIT.
    //
    // ⭐ HERE, AND ONLY HERE. This branch is the ONE place the fold is known to
    // have committed a NEW strategy. The 23505 resolve arm below returns
    // `fresh: false` precisely because a PRIOR request wrote that row and this
    // one rolled back entirely — emitting there would manufacture a second
    // creation record for one creation, which on an append-only audit log is
    // not a duplicate but a false fact.
    //
    // `logAuditEventAsUser` with an ADMIN client, NOT `logAuditEvent` with the
    // user client — the C-2 lesson from the preferences route. The emission is
    // scheduled through `after()` and settles AFTER the response flushes, and
    // `log_audit_event` derives its actor from `auth.uid()`; a short-TTL JWT
    // that expires inside that deferred window yields a 200 with no audit row
    // at all. The service-role path is JWT-immune and takes the acting user id
    // explicitly — and `args.userId` is trustworthy here because `withAuth`
    // established it before the handler ran.
    //
    // Fire-and-forget by contract: a failed emission is Sentry-reported inside
    // `emitAsUser` and must NOT change this response. The strategy IS committed
    // — failing the request over its forensic row would roll back nothing and
    // would tell the user their upload failed when it did not.
    //
    // Metadata carries no track-record CONTENT: the row count and the format,
    // which is what a forensic reader needs to tie this event to a submission,
    // plus the correlation id that joins it to the console + Sentry lines.
    logAuditEventAsUser(admin, args.userId, {
      action: "strategy.csv_finalize",
      entity_type: "strategy",
      entity_id: newStrategyId,
      metadata: {
        fmt: args.fmt,
        row_count: args.rows.length,
        terminal_status: args.terminalStatus,
        wizard_session_id: args.wizardSessionId,
        correlation_id: opts.correlationId,
      },
    });

    // 146.1 / A4 — this request CREATED the row, so its metadata fan-out is
    // this request's to run.
    return {
      ok: true,
      strategyId: newStrategyId,
      status: args.terminalStatus,
      fresh: true,
    };
  }

  if (error?.code === "23505") {
    /**
     * 146.1 / B3 — A 23505 ON THIS PATH IS NOT ONE FACT.
     *
     * The arm below existed undiscriminated, so EVERY unique violation the
     * fold could raise was routed to the wizard-session resolver. There are
     * two real sources: the session fence
     * `strategies_user_wizard_session_source_uniq` (20260728120000:167-169),
     * which IS "a prior attempt for this session already committed", and the
     * dailies index `csv_daily_returns_strategy_date_key`
     * (20260624120000:55-56), which is a duplicate-date PAYLOAD defect. The
     * fold's dailies INSERT carries no `ON CONFLICT`, so the second one is
     * reachable. Resolving it means telling the user "try again shortly"
     * (the resolve arm's 503) about a defect that will fail identically
     * forever — and burying the arrival of any future constraint in silence.
     *
     * ⛔ `null` MUST ENTER THE RESOLVE ARM. `pgConstraintName` returns null
     * when it could not READ a name, NOT when no constraint was violated
     * (its own docblock states this as the caller contract). Pre-existing
     * behaviour for UNKNOWN is any-23505 → resolve, and the resolve arm
     * already fails CLOSED — it refuses with 503 when it cannot find a
     * committed row, so a mis-routed non-session 23505 answers honestly
     * rather than fabricating an echo. Tightening this to
     * `constraint !== null && WIZARD_SESSION_CONSTRAINTS.has(constraint)`
     * would convert that fail-closed 503 into a fail-open 500 carrying the
     * wrong copy. This is the non-obvious half of the fix; do not "simplify"
     * it.
     *
     * ⛔ The name comes from `message` and never `details` — `details`
     * carries client-supplied key values, so reading it would let a caller
     * steer which arm answers them. That is the leaf's decision; do not
     * improve it here.
     */
    const constraint = pgConstraintName(error);
    if (constraint === null || WIZARD_SESSION_CONSTRAINTS.has(constraint)) {
      return await resolveExistingStrategyOrRefuse(supabase, args, opts);
    }
    // A NAMED constraint we do not recognise. Fall through to the
    // fold-failure arm (nothing was persisted — the rollback is total, which
    // is exactly what that arm's copy says), but say so first: a new unique
    // index arriving on this path must not be indistinguishable from a
    // generic RPC failure. Same shape as create-with-key's
    // `draft-rpc-unknown-constraint` capture.
    console.error(
      `${opts.logPrefix} 23505 named an UNRECOGNISED constraint [correlation_id=${opts.correlationId}]:`,
      constraint,
      scrubSeamError(error),
    );
    captureToSentry(error, {
      tags: {
        surface: "csv-finalize",
        step: "finalize-23505-unknown-constraint",
      },
      extra: {
        correlation_id: opts.correlationId,
        pg_code: error.code,
        constraint,
      },
    });
  }

  // ── The fold-failure arm (D-07, D-11, D-12) ────────────────────────────
  // A non-23505 RPC error, or a 2xx whose payload lost the id.
  //
  // ⚖️ 146.1 / A3 (2026-08-18) — THE CLAIM THAT WAS REMOVED, AND FROM WHICH
  // ARRIVALS.
  //
  // This arm used to answer EVERY arrival with one sentence: "Nothing was
  // saved — the submission rolled back completely, so it is safe to try
  // again." Three distinct outcome classes reach here, and that sentence is
  // an honest observation for exactly ONE of them.
  //
  //   CLASS 1 — a SQLSTATE-bearing RPC error (22023 / 42501 / 22007 / 22P02 /
  //   23502 / …). PostgREST returned a BODY carrying a 5-character `code`,
  //   which means the fold ran and RAISEd. The fold has no EXCEPTION handler
  //   clause, so the raise aborts the function and every write in its single
  //   transaction rolls back (20260819120000:82-96). The rollback claim is
  //   TRUE here. It is kept VERBATIM.
  //
  //   CLASS 2 — a TRANSPORT failure. postgrest-js RESOLVES rather than
  //   rejects on a fetch fault — see the fetch-catch arm of
  //   `PostgrestBuilder`'s `then` in @supabase/postgrest-js, which builds a
  //   `PostgrestError` with an EMPTY `code` — handing us
  //   `{ error: { code: "" }, data: null, status: 0 }`. And the
  //   `RETRYABLE_METHODS` constant in `src/types/common/common.ts` lists only
  //   `['GET','HEAD','OPTIONS']`, so the RPC POST is NEVER retried: what we
  //   sent was ONE POST, and it may have reached PostgREST and committed
  //   before the connection died. We did not observe a rollback. We observed
  //   that we stopped being able to see.
  //
  //   CLASS 3 — a 2xx whose id did not survive (TS-13, `!error` and a
  //   non-UUID return). A 2xx from PostgREST means the transaction COMMITTED;
  //   only the id failed to reach us. "Nothing was saved" is not merely
  //   unsupported here, it is provably the wrong way round.
  //
  // ⛔ THE DISCRIMINATOR IS AN EXPLICIT LENGTH CHECK, NOT TRUTHINESS. Class
  // 2's `code` is the EMPTY STRING, which is falsy, so `if (error?.code)`
  // silently merges classes 2 and 3 into one and then answers both with
  // whichever copy the other branch holds. `error.code.length === 5` is the
  // only test that separates "PostgREST told us a SQLSTATE" from "PostgREST
  // told us nothing".
  //
  // PRECEDENT, and why this is a correction rather than a preference: the
  // SEAMUX-04 block introducing `CSV_SUBMIT_FAILED` in `wizardErrors.ts`
  // already made this exact call on the client side — it deleted "your data
  // is unchanged" because "a client-side timeout does not cancel the
  // server-side transaction, so the write may well have landed". The route's
  // sentence was the older, unreasoned side of that contradiction. Classes 2
  // and 3 now speak in the voice that `CSV_SUBMIT_FAILED` already approved,
  // including its recovery step — check /strategies in another tab first —
  // which composes with the 23505 resolve arm above: an unchanged resubmit
  // from this wizard resolves onto the strategy already started instead of
  // creating a second one.
  //
  // 42501 → 401: CONSIDERED AND DEFERRED, not forgotten. `withAuth` ran
  // milliseconds earlier, so the only reachability is a session expiring
  // INSIDE one request; and a 401 on a POST the wizard treats as retryable
  // would throw the user into a login redirect mid-submit. The honest
  // improvement is a distinguishing `debug_context`, which this arm now
  // carries (`outcome_class`), not a status change. Revisit only with a
  // measured 42501 rate from the Sentry tags below.
  console.error(
    `${opts.logPrefix} finalize_csv_strategy_with_returns failed [correlation_id=${opts.correlationId}]:`,
    // SEAMRIM-06 — `.code` is the five-character SQLSTATE, allowlisted by
    // the seam log guard; `.message` is where undici/postgrest inline what
    // they were handed, so only the scrubbed rendering rides beside it.
    error?.code,
    scrubSeamError(error),
  );
  // D-12: window B/C observability, delivered in folded form. Request-scoped
  // one-shot capture keyed by correlation_id in extra — no shouldCaptureNow
  // throttle: finalize volume is low, and the WR-06 throttle exists for the
  // seam's high-volume paths, which this is not. No per-request secrets
  // option needed: the error is a PostgREST error from the SSR client (no
  // forwarded JWT header exists on this path any more), mirroring the
  // metadata-update capture's shape.
  // 146.1 / A3 — the class, computed ONCE and used for the copy, the Sentry
  // step tag and the debug_context alike, so the three can never disagree
  // about what happened. `rolled-back` is the only one that observed a
  // rollback.
  const outcomeClass: "rolled-back" | "transport-unknown" | "committed-lost-id" =
    typeof error?.code === "string" && error.code.length === 5
      ? "rolled-back"
      : error
        ? "transport-unknown"
        : "committed-lost-id";
  // Classes 2 and 3 carry their OWN step tag. Merged into one bucket, the
  // honest arm's firing rate is unmeasurable, and nobody can ever tell
  // whether the deferred 42501→401 question or a real transport problem is
  // the live one.
  const sentryStep =
    outcomeClass === "rolled-back"
      ? "finalize-fold-fail"
      : "finalize-fold-outcome-unknown";
  captureToSentry(
    error ??
      new Error(
        `finalize_csv_strategy_with_returns returned a non-uuid strategy id (${String(
          newStrategyId,
        )})`,
      ),
    {
      tags: { surface: "csv-finalize", step: sentryStep },
      extra: {
        correlation_id: opts.correlationId,
        rpc_error_code: error?.code ?? null,
        outcome_class: outcomeClass,
      },
    },
  );
  return {
    ok: false,
    response: NextResponse.json(
      {
        ok: false,
        // ⛔ ONE CODE. A second code for the same fact is the two-names-one-fact
        // drift that the `CSV_UPSTREAM_FAIL` docblock in `wizardErrors.ts`
        // exists to prevent ("a second code for the same fact is exactly the
        // two-names-one-fact drift `seam-copy.ts` exists to prevent"), and it
        // buys nothing: `CSV_FINALIZE_FAIL` is a member of the
        // `KNOWN_CSV_FINALIZE_CODES` set in `CsvSubmitStep.tsx`, so the
        // sentence below is what RENDERS. Minting one would move
        // `KNOWN_CSV_FINALIZE_CODES`, `EXPECTED_TABLE_SIZE` and the
        // vocabulary invariant in the same commit for a state the user cannot
        // act on differently.
        code: "CSV_FINALIZE_FAIL",
        human_message:
          outcomeClass === "rolled-back"
            ? // CLASS 1 — VERBATIM, unchanged. The database told us it raised;
              // the fold has no handler clause; the rollback is total. Making
              // this one vague too would be the failure mode on the other
              // side of the same defect.
              "Your strategy could not be saved. Nothing was saved — the submission rolled back completely, so it is safe to try again. Contact support@quantalyze.com if it persists."
            : // CLASSES 2 and 3 — commit-agnostic, in the voice
              // `CSV_SUBMIT_FAILED` already approved. It states what we do not
              // know, then puts the NON-DESTRUCTIVE check first.
              "We could not confirm whether your strategy was saved. The save step did not report back, so we cannot promise it completed or that it did not. Open your strategies list in another tab first: if the strategy is listed, the save completed and you are done. If it is not listed, submit the same file again — an unchanged resubmit from this wizard resolves to the strategy you already started instead of creating a second one. Contact support@quantalyze.com if it persists.",
        debug_context: {
          rpc_error_code: error?.code ?? null,
          outcome_class: outcomeClass,
        },
        correlation_id: opts.correlationId,
      },
      { status: 500, headers: NO_STORE_HEADERS },
    ),
  };
}

/**
 * 146.2-01 / R1 — the columns the CLOCK-SAFETY GUARD measures on an
 * empty-series echo, MIRRORING `PERCENTILE_ANALYTICS_COLUMNS`
 * (the constant `getPercentiles` projects in `queries.ts`) member for member. That constant is the set both
 * percentile callers fold into rankings, so this is exactly the set a clock
 * relabel without a recompute would misrepresent. It is duplicated rather than
 * imported deliberately: `queries.ts` is a client-reachable module and the
 * original is not exported. If that set ever changes, this one must follow —
 * the guard is only as honest as the overlap.
 */
const CLOCK_SAFETY_KPI_COLUMNS = [
  "cagr",
  "sharpe",
  "sortino",
  "calmar",
  "max_drawdown",
  "volatility",
  "cumulative_return",
] as const;

/**
 * ⭐ 146.2-03 / G4 (2026-08-20) — THE WIZARD CONTROL THE CLASSIFICATION
 * REFUSALS SEND THE USER TO, NAMED BY ITS EXACT LABEL.
 *
 * The two sentences below used to instruct "Start a new strategy to upload
 * THIS FILE", and that instruction was UNCARRYABLE. Both refusals burn the
 * wizard session id against the content being submitted, and `WizardClient`'s
 * re-mint effect only mints a fresh id on a MATERIAL CONTENT CHANGE
 * (`if (current === burned) return;`) — so a user who does exactly what the
 * sentence says, re-uploading the same file, replays the spent session id and
 * takes the identical 409 forever. The wizard's other reset controls do not
 * reach this branch either.
 *
 * 146.2-08 / B1 adds a clickable escape in the refusal state that mints a
 * fresh session id and KEEPS the uploaded series, so the instruction is now
 * carryable — and these sentences point at it by name rather than describing
 * an action the user cannot take.
 *
 * ⚠️ THE LABEL IS A CONTRACT WITH `START_NEW_STRATEGY_LABEL` in
 * `CsvSubmitStep.tsx`. It is duplicated rather than imported: that module is a
 * `"use client"` component and importing it into a route handler would pull a
 * React tree into the server bundle. Duplicated but GREPPABLE — the two
 * constants share a name on purpose, so `START_NEW_STRATEGY_LABEL` finds both
 * sites in one search and a rename cannot silently orphan the server's
 * instruction.
 */
const START_NEW_STRATEGY_LABEL = "Start a new strategy";

/**
 * 146.2-01 / R1 — the classification-conflict refusal sentence. SEAMUX-04
 * register: state the fact, do not editorialise. It exists because the default
 * 409 sentence says "a different track record", and on this arm the track
 * record may be byte-identical — what differs is the classification.
 */
const CLASSIFICATION_CONFLICT_MESSAGE =
  "This wizard session already created a strategy with a different " +
  "classification, so we refused before writing anything of this submission. " +
  'Open the strategy you already started, or use "' +
  START_NEW_STRATEGY_LABEL +
  '" — it keeps the file you uploaded and starts over with a new strategy, ' +
  "so this file can be saved with the classification you want.";

/**
 * ⚠️ CR-01 — THE 23505 RESOLVE ARM. Read this before "simplifying" it away.
 *
 * Under the fold a 23505 that REACHES THIS ARM has exactly ONE reachable
 * meaning: a PRIOR attempt for this (user, wizard_session, source='csv')
 * FULLY committed — strategy, verification AND dailies, all-or-nothing — and
 * this attempt's own writes rolled back completely.
 *
 * ⚠️ 146.1 / B3 — "REACHES THIS ARM" IS NOW LOAD-BEARING, AND THE PARAGRAPH
 * IT REPLACED WAS WRONG. The previous wording called the dailies unique
 * violation hypothetical ("in principle"). It is not: the index
 * `csv_daily_returns_strategy_date_key` is real (20260624120000:55-56) and
 * the fold's dailies INSERT is a plain INSERT with NO `ON CONFLICT`, so a
 * duplicate-date payload raises 23505 there for certain. What made it
 * unreachable in practice was a single upstream gate, and "one gate holds"
 * is not a property this arm can verify. The caller now DISCRIMINATES: only
 * `null` (unparseable → UNKNOWN, pre-existing behaviour) or a
 * `WIZARD_SESSION_CONSTRAINTS` member enters here; a dailies-index 23505
 * falls through to the fold-failure arm instead of being offered a retry it
 * can never succeed at.
 *
 * 146.1-01's A1 duplicate-date guard removes the one concrete payload known
 * to reach that index. This fence is DEFENSE IN DEPTH against any future
 * source — a second writer, a relaxed boundary, a new index — not a
 * restatement of that guard.
 *
 * The arm is READ-ONLY. It persists nothing and it must verify identity
 * BEFORE anything of THIS submission is written — the metadata UPDATE runs
 * only after this arm returns ok (Pitfall 6; that ordering is what makes
 * the 409 refusal below truthful).
 *
 * WHY THE CHECKS EXIST (carried from the pre-fold stale-range fence):
 * `wizard_session_id` identifies a SESSION, not a SUBMISSION, and it
 * survives a failed submit (the wizard_session_id persistence in
 * src/lib/wizard/localStorage.ts). So a user can upload 2024.csv, fail,
 * upload 2025.csv under the same session — and a naive resolve would echo
 * the FIRST strategy for the SECOND file: file B's submission reported as
 * success against a row holding file A's series. Neither file. On a product
 * whose entire value is a trustworthy verified track record.
 *
 * Two checks close it, and neither is sufficient alone:
 *   1. NAME — a rename before resubmit is refused before anything happens
 *      (the pre-fold Python arm's check, moved here).
 *   2. RANGE, as a READ — any committed daily OUTSIDE [min, max] of THIS
 *      payload is precisely a row that this submission never described:
 *      a changed FILE under an unchanged name. The pre-fold fence guarded a
 *      merge-writing upsert; the fold deleted that write path, so what
 *      remains is the REPORTING hazard (echoing strategy A's id for file
 *      B's submission), which this read closes.
 *   · first submit        → no 23505 at all (the fold rolled nothing back
 *                           because nothing existed) — this arm never runs
 *   · true repeat / retry → name matches, all committed rows in range →
 *                           echo the existing id (the recovery the
 *                           CSV_SUBMIT_FAILED copy instructs)
 *   · A then B            → refused 409, BEFORE any metadata write
 *
 * FAIL CLOSED: a fence that cannot run must refuse, not pass (the C-3
 * lesson). supabase-js RESOLVES on a read failure rather than throwing, so
 * an unchecked binding would read as "no row / no stale rows" — a failed
 * read rendered as a measurement.
 */
async function resolveExistingStrategyOrRefuse(
  supabase: SupabaseClient,
  args: {
    userId: string;
    wizardSessionId: string;
    strategyName: string;
    rows: CsvDailyReturnRow[];
    // 146.1 / A2 — DECLARED ON PURPOSE, AND THE GATE FOR THE WHOLE FIX. The
    // caller has always passed a wider object and TypeScript's structural
    // typing let it compile, so this field was PRESENT at runtime and
    // INVISIBLE to this function. Nothing below could compare against it
    // until it was named here.
    terminalStatus: "pending_review" | "private";
    // 146.2-01 / R1 — see the caller's declaration: this request's parsed
    // classification, named here so the FILL/REFUSE tri-state below can see it.
    requestedCategoryId: string | null;
    requestedAssetClass: "crypto" | "traditional" | null;
  },
  opts: { logPrefix: string; correlationId: string },
): Promise<FinalizeAtomicOutcome> {
  // Single fail-closed arm — every resolve read that errors funnels here so
  // the capture site (and its grep-unique step tag) exists exactly once.
  const failClosed = (readErr: unknown, which: string): FinalizeAtomicOutcome => {
    console.error(
      `${opts.logPrefix} 23505 resolve ${which} read failed — refusing (fail closed) [correlation_id=${opts.correlationId}]:`,
      scrubSeamError(readErr),
    );
    // D-12 register: the pre-fold stale-probe arm (window B) had ZERO
    // Sentry coverage; do not re-create that anomaly on its successor arm.
    // One-shot, no throttle — same low-volume rationale as the fold-fail
    // capture above.
    captureToSentry(readErr, {
      tags: { surface: "csv-finalize", step: "finalize-resolve-read-fail" },
      extra: { correlation_id: opts.correlationId },
    });
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          code: "CSV_PERSIST_FAIL",
          human_message:
            "We could not confirm what is already saved for this strategy, so we stopped before writing anything of this submission. Try again shortly.",
          debug_context: {},
          correlation_id: opts.correlationId,
        },
        { status: 503, headers: NO_STORE_HEADERS },
      ),
    };
  };

  // C-08 tenant scope: the re-fetch carries the SAME scope as the partial
  // unique index — user_id AND wizard_session_id AND source — on the USER
  // client, so RLS fences the read a second time under the explicit
  // filters. `source` matters: an abandoned source='wizard' draft can hold
  // the very same session id, and echoing THAT row would hand the user a
  // different strategy's id as if it were their CSV upload.
  //
  // 146.2-01 / R1 — `category_id, asset_class` join the projection. They are
  // the strategy's CLASSIFICATION, and the arm could not decide anything about
  // them while it could not see them. See the tri-state below for what each
  // reading means.
  const { data: existing, error: refetchErr } = await supabase
    .from("strategies")
    .select("id, name, status, category_id, asset_class")
    .eq("user_id", args.userId)
    .eq("wizard_session_id", args.wizardSessionId)
    .eq("source", "csv")
    .maybeSingle();
  if (refetchErr) return failClosed(refetchErr, "strategies");
  const existingRow = existing as {
    id?: string;
    name?: string;
    status?: string;
    // OPTIONAL on purpose, and the distinction is load-bearing: `undefined` is
    // an ABSENT reading (the column did not come back), `null` is a MEASURED
    // SQL NULL. Only the second one licenses the FILL.
    category_id?: string | null;
    asset_class?: string;
  } | null;
  if (!existingRow || !isUuid(existingRow.id)) {
    // A 23505 with no committed row to resolve to (TOCTOU delete, RLS hide,
    // or a non-session 23505 that slipped every upstream gate). We cannot
    // establish what exists, so we refuse — nothing of this submission was
    // written (the fold rolled back).
    return failClosed(
      new Error("23505 resolve re-fetch found no committed row"),
      "strategies",
    );
  }

  // 146.2-01 / R1 — `humanMessage` is OPTIONAL and defaults to the shipped
  // literal, so the name / series / A2 arms stay byte-identical (that sentence
  // is pinned by name in CsvSubmitStep.upstream-arm.test.tsx and the c14
  // regression suite). Only the classification arms below pass their own — the
  // default sentence talks about "a different track record", which is not what
  // happened when the FILE is identical and the CLASSIFICATION is not.
  const refuse = (
    reason: string,
    humanMessage?: string,
  ): FinalizeAtomicOutcome => {
    console.warn(
      `${opts.logPrefix} refused a cross-submission resolve (${reason}) [correlation_id=${opts.correlationId}] strategy_id=${existingRow.id}`,
    );
    // D-12: the resolve-arm refusal is a money-fence firing — alert it.
    // One-shot, keyed by correlation_id; no throttle (low volume, WR-06
    // register).
    captureToSentry(
      new Error(`csv-finalize resolve refused: ${reason}`),
      {
        tags: { surface: "csv-finalize", step: "finalize-resolve-refused" },
        extra: {
          strategy_id: existingRow.id,
          correlation_id: opts.correlationId,
        },
      },
    );
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          code: "CSV_SESSION_REUSED",
          human_message:
            humanMessage ??
            // W-1 (146.2 re-verification): this DEFAULT sentence ships on the
            // name-, series- and date-mismatch refusals, all user-reachable. It
            // named the escape control in PROSE while the other two interpolate
            // the constant — so a rename would have drifted this one while the
            // two-file invariant stayed green, which is the exact failure that
            // invariant exists to catch. Interpolated, and the invariant now
            // asserts the phrase appears in NO other string literal here.
            `This wizard session already created a strategy with a different track record, so we refused before writing anything of this submission. ${START_NEW_STRATEGY_LABEL} to upload a different file.`,
          debug_context: { strategy_id: existingRow.id },
          correlation_id: opts.correlationId,
        },
        { status: 409, headers: NO_STORE_HEADERS },
      ),
    };
  };

  // 146.1 / A2 check 0 — TERMINAL STATUS, ahead of the name check.
  //
  // THE MECHANISM. The 23505 that brought us here fires on the partial unique
  // index `(user_id, wizard_session_id, source) WHERE wizard_session_id IS NOT
  // NULL` (20260728120000:167-169). `status` is NOT in that key — and the
  // index's own COMMENT explains why `source` is: `wizard_session_id` is
  // restored UNCONDITIONALLY from ONE shared localStorage key
  // (src/lib/wizard/localStorage.ts), so unrelated wizard runs arrive carrying
  // the same session id. `source` separates the CSV flow from a draft; nothing
  // separated the MANAGER flow from a CONTRIB-02 contribution, because both
  // are source='csv' and differ only in the terminal status they asked for.
  //
  // WHAT THAT COST. A manager-flow resubmit could resolve onto a row committed
  // as 'private' and be echoed 200 with that row's id and status: the caller
  // is told "saved" for a strategy that will never enter the admin review
  // queue ('pending_review' is that queue's membership predicate) — and in the
  // other direction an owner-only contribution's id is handed to the manager
  // flow. That is an access-control answer, not a cosmetic one.
  //
  // ⚠️ `typeof === "string" &&` MIRRORS THE NAME CHECK BELOW, for the same
  // reason: a row whose `status` did not come back is an ABSENT reading, not
  // an observed mismatch. Refusing on absence would render a read we could not
  // make as a measurement.
  //
  // ⛔ The refusal goes through the EXISTING `refuse()` — 409 /
  // CSV_SESSION_REUSED / no-store / one Sentry capture. A new code would move
  // KNOWN_CSV_FINALIZE_CODES, EXPECTED_TABLE_SIZE and the vocabulary invariant
  // in the same commit, for a state the user cannot act on differently
  // (create-with-key states this reasoning at its own unresolvable arm).
  if (
    typeof existingRow.status === "string" &&
    existingRow.status !== args.terminalStatus
  ) {
    // 161-03 / WIZERR-12 — AND IT GETS ITS OWN SENTENCE, because the default
    // one is FALSE here. The default says the committed strategy holds "a
    // different track record"; this check runs BEFORE the name check and
    // BEFORE the series check, so at this point nothing about the track record
    // has been read. The sibling refusal suite arms this very case with a
    // committed name of "Renamed" on purpose — the names may differ too, or
    // not, and this arm cannot tell.
    //
    // ⚠️ WHAT THE SENTENCE MAY CLAIM, AND WHY IT IS NOT "a different flow".
    // The docblock above names the manager-vs-contribution collision, and that
    // IS the case this arm was built for. It is not the only one it can fire
    // on: `existingRow.status` is the row's CURRENT status, read live, and
    // `admin/strategy-review` moves a committed 'pending_review' row to
    // 'published'. A manager resubmit onto an already-published row of the
    // SAME flow reaches here too. So the sentence states only what the arm has
    // actually established — a strategy is committed under this session, and
    // it is not in the state this submission asked for.
    //
    // ⛔ The internal `reason` (which names both statuses, for the operator
    // reading Sentry) is unchanged, and the DEFAULT sentence stays
    // byte-identical for the name / series / date arms where it is true.
    return refuse(
      `terminal status mismatch (committed '${existingRow.status}', this submission asked for '${args.terminalStatus}')`,
      `This wizard session already committed a strategy that is not in the state this submission asked for, so we refused before writing anything of this submission. ${START_NEW_STRATEGY_LABEL} to make a separate submission.`,
    );
  }

  // CR-01 check 1 — NAME, before anything else. A changed track record is a
  // NEW strategy; a renamed resubmit must never resolve to the old row.
  if (
    typeof existingRow.name === "string" &&
    existingRow.name !== args.strategyName
  ) {
    return refuse("name mismatch");
  }

  // CR-01 check 2 — SERIES EQUALITY (count + boundaries), as a READ against
  // the committed dailies.
  //
  // Ship-review red-team fix (2026-08-18): the pre-fold predicate here was
  // "no committed row OUTSIDE this payload's range" — honest THEN, because
  // the persist upsert overwrote everything inside the range, so a pass
  // meant the outcome equalled the submitted series. The fold DELETED that
  // overwrite (this arm persists nothing), so the carried-over predicate
  // quietly inverted into a data-discard: a DIFFERENT file whose range
  // CONTAINS the committed range (an appended month, a superset re-export)
  // — or a series-bearing retry against a zero-dailies committed row (an
  // fmt='trades' strategy, or a pre-fold window-C orphan, where the
  // outside-range probe passes VACUOUSLY) — was echoed ok:true while the
  // submitted series went nowhere. On a verified-track-record product a
  // fabricated success is the worst outcome; refuse instead.
  //
  // The read-only contract is unchanged: READ count + boundaries, compare
  // against the payload. Echo only when the committed series has the SAME
  // row count and the SAME [min,max] — and for an empty payload
  // (fmt='trades'), only when the committed series is empty too (the old
  // fence skipped empty payloads entirely; that skip was the vacuous edge).
  // Residual (documented, accepted): equal count and boundaries with
  // different interior values still echoes — the identical-retry case
  // dominates by construction; closing it needs a checksum, not two reads.
  //
  // 146.1 / C1 (2026-08-18) — FOUNDER CALL, option (b). The residual STAYS
  // OPEN by decision. Option (a) — a content hash over the payload persisted
  // at create time — would close it, and is filed in TODOS.md WITH its cost:
  // a third migration in a phase already carrying two, a backfill for every
  // already-committed row, and a nullable-hash fail-open period while that
  // backfill runs. What changed here is NOT the predicate: it is that the 200
  // envelope now STATES these two reads instead of leaving the caller to
  // assume the series was checked. See the echo return at the end of this
  // function.
  {
    let minDate = "";
    let maxDate = "";
    for (const r of args.rows) {
      if (minDate === "" || r.date < minDate) minDate = r.date;
      if (maxDate === "" || r.date > maxDate) maxDate = r.date;
    }
    // `date` is `YYYY-MM-DD`, regex- AND calendar-validated by
    // `parseDailyReturnsSeries`; lexicographic and chronological order
    // coincide for that format, which is why the min/max scan and the
    // ORDER BY date reads below are correct.
    const { data: minRows, count: committedCount, error: minErr } =
      await supabase
        .from("csv_daily_returns")
        .select("date", { count: "exact" })
        .eq("strategy_id", existingRow.id)
        .order("date", { ascending: true })
        .limit(1);
    if (minErr) return failClosed(minErr, "csv_daily_returns");
    if ((committedCount ?? 0) !== args.rows.length) {
      return refuse(
        `committed series differs from this payload (committed ${committedCount ?? 0} rows, payload ${args.rows.length})`,
      );
    }
    if (args.rows.length > 0) {
      const { data: maxRows, error: maxErr } = await supabase
        .from("csv_daily_returns")
        .select("date")
        .eq("strategy_id", existingRow.id)
        .order("date", { ascending: false })
        .limit(1);
      if (maxErr) return failClosed(maxErr, "csv_daily_returns");
      if (
        minRows?.[0]?.date !== minDate ||
        maxRows?.[0]?.date !== maxDate
      ) {
        return refuse(
          "committed series boundaries differ from this payload's date range",
        );
      }
    }
  }

  // 146.2-01 / R1 check 3 — CLASSIFICATION, as a TRI-STATE: FILL / REFUSE /
  // no-op. This is A2's own logic applied to the second identity field, and it
  // closes the defect the A3 recovery copy walks the user straight into.
  //
  // THE MECHANISM. `applyCsvMetadataUpdate` runs AFTER the fold commits. Kill
  // the connection in between — A3's CLASS 2 transport fault, or the CLASS 3
  // lost-id 2xx — and the strategy is committed carrying NO metadata at all.
  // A3's copy then tells the user to submit the same file again; the resubmit
  // takes the 23505, resolves, and (before this arm) was echoed 200 with the
  // UPDATE skipped on `outcome.fresh`. The classification was dropped for good:
  // `asset_class` stays at the column default, and #597 part 2 makes that
  // column the ANNUALIZATION CLOCK — a crypto track record annualized sqrt(252)
  // and published "Verified", with no post-creation editor anywhere in the
  // product that could repair it. `category_id` stays NULL, so the row is also
  // invisible to discovery (this route's own WR-04 rationale).
  //
  // ⭐ THE DISCRIMINATOR IS `category_id IS NULL`, AND IT MUST NOT BE
  // `asset_class`. `strategies.asset_class` is NOT NULL DEFAULT 'traditional'
  // (20260709130000:26-27), so on that column "never classified" and "the user
  // chose traditional" are the SAME stored value — filling there would
  // overwrite a legitimate choice, which is exactly what A4's economic oracle
  // forbids. `category_id` has no default, the fold's INSERT never writes it,
  // `applyCsvMetadataUpdate` writes BOTH fields in ONE atomic UPDATE, and the
  // wizard always sends a `category_id` (an explicit null is 400-refused
  // pre-create). So a committed NULL is observable proof that UPDATE never ran.
  // On the FILL arm the committed `asset_class` WILL read 'traditional'; that
  // is a default, not a conflict, and must not block the fill.
  //
  // ⚠️ 159-06 / RANK-07 — THIS READ DOES NOT DECIDE THE FILL ON ITS OWN. It is
  // a read taken a whole request before the write, so it establishes only that
  // the fill was safe THEN. `applyCsvMetadataUpdate` re-checks the very same
  // predicate inside its UPDATE (`.is("category_id", null)`) and observes the
  // row count, so a concurrent resubmit that classified the row in between
  // loses in SQL and is refused rather than silently overwriting the winner.
  //
  // ⚠️ ABSENT ≠ NULL. `undefined` means the column did not come back — an
  // absent reading, not a measurement — and licenses neither a fill nor a
  // refusal. Same discipline as A2's `typeof === "string" &&` guard above.
  let fillClassification = false;
  let fillHumanMessage: string | undefined;

  if (existingRow.category_id === null) {
    // (a) NEVER CLASSIFIED → FILL — and never before clock safety has been
    // MEASURED, on this request, against this strategy.
    //
    // ⚖️ 146.2-02 / BL-02 (2026-08-19) — THE ASYMMETRY WAS THE DEFECT. This
    // guard used to sit INSIDE `if (args.rows.length === 0)`. The empty-series
    // arm measured the stored KPIs and refused; the series-bearing arm filled
    // unguarded, on the premise that "the enqueue below fires after the awaited
    // UPDATE, so the recompute is the reconciliation. No guard read is needed."
    //
    // That premise ASSUMED the one side effect this file carries ~150 lines of
    // fallback machinery for. `enqueueCsvAnalyticsAfter` is `after()`-scheduled
    // and non-blocking, and Phase 143's sweep exists precisely because the
    // enqueue DROPS. When it drops after a fill, nothing heals it:
    // `writeFailedStrategyAnalyticsPlaceholder` returns early once the row is a
    // terminal success, and the Phase 143 sweep excludes `computation_status IN
    // (…,'complete',…)` (20260819150000:397-402). The steady state is a
    // crypto-labelled, discovery-visible, `complete` row whose Sharpe, Sortino,
    // Calmar and CAGR were computed on sqrt(252) — the EXACT outcome the
    // empty-series arm refuses to create, reached from the arm with no guard.
    //
    // ⛔ ONE RULE, BOTH ARMS, NOT NEGOTIABLE: never move the annualization
    // clock without GUARANTEEING the recompute that reconciles it. An `after()`
    // enqueue is not a guarantee. What makes a fill safe is the MEASURED
    // ABSENCE of KPIs a clock move would misrepresent — never the arm it
    // arrived on.
    //
    // ⛔ AND THE SYMMETRY IS UPWARD. Gating the series-bearing fill on the
    // enqueue having been ISSUED was rejected: the enqueue is scheduled to run
    // AFTER the response, so awaiting it would mean enqueueing BEFORE this
    // UPDATE — recomputing the KPIs under the very clock the fill was about to
    // replace (see the ⛔ ORDER IS LOAD-BEARING note at the call site). And
    // "issued" is not "ran": that is what Phase 143 is about.
    //
    // THE GUARD ITSELF: one owner-scoped read (the same user-scoped client, so
    // strategies_select RLS fences it) of the strategy's stored KPIs.
    //
    // ⛔ The column set MIRRORS `PERCENTILE_ANALYTICS_COLUMNS`
    // (the constant `getPercentiles` projects in `queries.ts`) — the exact
    // columns both percentile callers fold into rankings. The guard measures precisely what a
    // clock relabel would misrepresent.
    //
    // ⚠️ A row CAN exist here with KPI values. `writeFailedStrategyAnalyticsPlaceholder`
    // below writes `strategy_analytics` rows with no compute job at all — it
    // writes status/error/flags and NO KPI columns, but PROD carries 7
    // zero-dailies csv strategies whose failed rows DO hold a sharpe and a
    // cagr, computed 2026-05-27 under older code. Under current code no
    // KPI-VALUE writer runs without a completed compute job (both enqueuers
    // are dailies-gated), so those are a historical class — which is why
    // this is a per-row MEASUREMENT and never an assumption. On the
    // series-bearing arm the population is wider still: any row the worker
    // already finished for the FIRST attempt is a completed, KPI-bearing row.
    //
    // ⚖️ 146.2-03 / G1 (2026-08-20) — `computation_status` JOINS THE
    // PROJECTION, and it is NOT a member of `CLOCK_SAFETY_KPI_COLUMNS`: it is
    // not a ranked KPI, it is the marker that says whether the KPI columns are
    // final or merely not written YET. Reading the seven without it is what
    // made the guard a presence test instead of the truth table below.
    const { data: storedAnalytics, error: analyticsErr } = await supabase
      .from("strategy_analytics")
      .select(
        "cagr, sharpe, sortino, calmar, max_drawdown, volatility, cumulative_return, computation_status",
      )
      .eq("strategy_id", existingRow.id)
      .maybeSingle();
    if (analyticsErr) {
      // Unconfirmable clock safety is not a licence to write. `.code` is the
      // allowlisted SQLSTATE (SEAMRIM-06); the rest of the read error is not
      // carried into the synthetic message.
      const sqlstate =
        typeof (analyticsErr as { code?: unknown }).code === "string"
          ? (analyticsErr as { code: string }).code
          : "(no code)";
      return failClosed(
        new Error(
          `clock-safety guard: the strategy_analytics read failed (${sqlstate}), so stored-KPI absence could not be measured on this request`,
        ),
        "strategy_analytics",
      );
    }
    const storedKpis = storedAnalytics as Record<string, unknown> | null;
    //
    // ⚖️ 146.2-03 / G1 (2026-08-20) — THE GUARD IS A TRUTH TABLE, NOT A
    // PRESENCE TEST, and the row it used to get wrong lands PERMANENTLY wrong
    // KPIs. `storedKpiPresent` conflates two very different all-null-KPI rows:
    //
    //   1. NO ROW AT ALL                          → FILL is safe
    //   2. any KPI column non-null                → REFUSE (the arm below)
    //   3. all KPIs null AND status 'computing'   → REFUSE (the arm after it)
    //   4. all KPIs null AND any other status     → FILL is safe
    //
    // WHY CASE 3 EXISTS — the TOCTOU. Mid-compute EVERY KPI column reads NULL,
    // so case 2 does not fire and the fill lands. But the recompute the fill
    // leans on is ABSORBED rather than scheduled: `_enqueue_compute_job_internal`
    // (supabase/schema/functions/) DEDUPES onto any job whose status is in
    // ('pending','running','done_pending_children') and RETURNS THE EXISTING
    // id, and this route's enqueue passes only p_strategy_id / p_kind /
    // p_metadata — no idempotency key — so it resolves onto the job already
    // running. That job snapshotted `strategies.asset_class` into
    // `_strategy_row` in the strategy-existence probe that opens
    // `run_csv_strategy_analytics` (analytics_runner.py) and reads the
    // SNAPSHOT — never the row — when it calls
    // `periods_per_year_for_asset_class` further down the same function. It
    // therefore writes sqrt(252) numbers onto a row the fill just relabelled 'crypto',
    // marks it 'complete', and the Phase 143 sweep excludes 'complete'
    // (20260819150000:397-402) — so nothing ever heals it. Sharpe understated
    // by sqrt(365/252) ≈ 1.204x, on a row the same fill made discovery-visible
    // and percentile-ranked.
    //
    // ⛔ WHY CASE 4 MUST STAY A FILL — do NOT "simplify" this into "refuse
    // whenever a row exists". `writeFailedStrategyAnalyticsPlaceholder` below
    // writes exactly that row — computation_status / computation_error / flags
    // and NO KPI columns — and it is the PRIMARY population the R1 repair
    // exists for. A change that refuses case 4 destroys the repair this phase
    // ships.
    //
    // ⚠️ THE WINDOW IS NARROWED, NOT CLOSED, and this says so because the code
    // cannot. That `_strategy_row` snapshot happens BEFORE the same function
    // awaits its `_mark_computing` upsert, so a fill landing between those two
    // statements is still missed. What case 3 closes is the DOMINANT window —
    // the whole compute, from the stamp to the terminal write. Closing the
    // remaining sliver needs the worker to re-read `asset_class` after
    // stamping, or an idempotency key on the enqueue; neither lives in this
    // route.
    //
    // 'computing' is the marker `_mark_computing` stamps on entry to
    // `run_csv_strategy_analytics` (analytics_runner.py), and that function's
    // own docstring states the contract ("Sets computation_status='computing'
    // on entry; 'complete' or 'failed' on exit"), so this read needs no
    // migration and no analytics-service change. Nor does it strand the
    // user: `reap_strategy_analytics_stuck_computing` (migration
    // 20260802120000) terminalizes a stranded 'computing' row, so case 3 is a
    // WAIT rather than a dead end — which is what its copy says.
    //
    // `!== null` and not a truthiness test: a stored 0 (a real cagr of zero)
    // is a KPI. A column that came back `undefined` — schema drift — is an
    // absent reading and counts as PRESENT here on purpose: it is the
    // conservative direction, and absence of a measurement never licenses
    // moving the clock.
    const storedKpiPresent =
      storedKpis !== null &&
      CLOCK_SAFETY_KPI_COLUMNS.some((col) => storedKpis[col] !== null);
    if (storedKpiPresent) {
      // REFUSE, and write NOTHING — not even `category_id`. A partial fill
      // would promote a row that is currently discovery-invisible into the
      // listing join, making KPIs computed under a DIFFERENT clock reachable
      // in the browse table and in percentile ranks. Half-applying a
      // classification is also exactly the silent partial drop this whole
      // change exists to stop.
      //
      // The REASON names the arm, because the two arms are unsafe for
      // different reasons and an operator reading the log needs to know which
      // one fired. The empty-series string is byte-unchanged from plan 01.
      return refuse(
        args.rows.length === 0
          ? "clock-safety: stored KPIs present on a never-classified row and no recompute path exists on an empty-series echo"
          : "clock-safety: stored KPIs present on a never-classified row and the only reconciling recompute is an after() enqueue that is not guaranteed to run",
        "An earlier attempt in this wizard session had already saved this " +
          "strategy without the classification you chose, and it already " +
          "carries computed metrics. Changing its classification now would " +
          "relabel those metrics without recomputing them, so we changed " +
          'nothing. Use "' +
          START_NEW_STRATEGY_LABEL +
          '" — it keeps the file you uploaded and starts over with a new ' +
          "strategy, so this file can be saved with the classification you " +
          "want.",
      );
    }
    // 146.2-03 / G1 — CASE 3. The KPI columns are all NULL because they have
    // not been WRITTEN yet, not because nothing will write them. See the truth
    // table above for why filling here is the TOCTOU that lands a permanently
    // sqrt(252)-computed 'crypto' row.
    //
    // ⚠️ An ABSENT `computation_status` (`undefined` — the column did not come
    // back) counts as in-flight, the same conservative direction the KPI test
    // takes: absence of a measurement never licenses moving the clock. The
    // column is `NOT NULL DEFAULT 'pending'` (20260405061911:74), so a
    // MEASURED reading is always a string and case 4 is never reached by
    // accident.
    const computeInFlight =
      storedKpis !== null &&
      (typeof storedKpis.computation_status !== "string" ||
        storedKpis.computation_status === "computing");
    if (computeInFlight) {
      return refuse(
        "clock-safety: a compute job is in flight on a never-classified row (computation_status is not a measured terminal value), and its worker already snapshotted the pre-fill asset_class",
        "An earlier attempt in this wizard session had already saved this " +
          "strategy, and its metrics are being computed right now. Applying " +
          "your classification while that runs would leave the metrics on the " +
          "old annualization convention, so we changed nothing. Submit the " +
          "same file again in a few minutes — it will not create a second " +
          "strategy.",
      );
    }
    // The guard MEASURED no stored KPIs and no compute in flight, so there is
    // nothing a moved clock could leave stale on either arm.
    //
    // ⚖️ 146.2-02 / BL-01 (2026-08-19) — A FILL THIS REQUEST CANNOT SUPPLY IS
    // NOT A FILL. `fillClassification` widens the metadata gate at the call
    // site and `fillHumanMessage` tells the user their category and asset class
    // were applied. Both are false when THIS request carries neither: the
    // widened gate would hand `buildMetadataUpdatePayload` whatever else the
    // blob holds — a description, an aum — and write it onto a row a PRIOR
    // request committed, which is the mutation-on-an-echo A4 forbids; or the
    // payload is empty, no UPDATE runs at all, and the user is told their
    // classification was applied to it. The fill exists to land a DROPPED
    // classification, so it requires one to land. No fill, no refusal → the
    // plain echo, which is the status quo ante and the safe direction.
    if (
      args.requestedCategoryId !== null ||
      args.requestedAssetClass !== null
    ) {
      fillClassification = true;
      fillHumanMessage =
        "An earlier attempt in this wizard session had already saved this " +
        "strategy, but it was saved without the details you entered — " +
        "including the category and the asset class that decides how its " +
        "returns are annualized — so we applied them to it now. We compared " +
        "the saved track record's row count and its first and last dates " +
        "against this file, not the individual daily values, so open the " +
        "strategy to check it holds the numbers you meant to upload.";
    }
  } else if (typeof existingRow.category_id === "string") {
    // (b) ALREADY CLASSIFIED → compare PRESENT vs PRESENT. A conflict is a
    // mutation, not a repair: the committed row's stored KPIs were computed
    // under the committed clock and nothing recomputes them.
    if (
      typeof args.requestedAssetClass === "string" &&
      typeof existingRow.asset_class === "string" &&
      existingRow.asset_class !== args.requestedAssetClass
    ) {
      return refuse(
        `classification mismatch (committed asset_class '${existingRow.asset_class}', this submission asked for '${args.requestedAssetClass}')`,
        CLASSIFICATION_CONFLICT_MESSAGE,
      );
    }
    if (
      typeof args.requestedCategoryId === "string" &&
      args.requestedCategoryId !== existingRow.category_id
    ) {
      return refuse(
        `classification mismatch (committed category_id '${existingRow.category_id}', this submission asked for '${args.requestedCategoryId}')`,
        CLASSIFICATION_CONFLICT_MESSAGE,
      );
    }
    // Equal, or this request's side absent → no-op echo, byte-identical to
    // what shipped: A4's rule, narrowed to the case it was actually about.
  }
  // (c) `category_id` came back `undefined` — an ABSENT reading. No fill, no
  // refusal, no-op echo.

  // 146.2-01 / A2 residual — THE STATUS FALLBACK IS GONE. The comment below
  // says "reporting a status we did not read would be fabricating an
  // observation", while the envelope said `existingRow.status ??
  // "pending_review"` and did exactly that: a CONTRIB-02 contribution
  // committed 'private' could be reported as sitting in the admin review queue
  // on the strength of a value nobody read. Absence is unconfirmable, so it
  // fails closed — same discipline as the A2 check above, and the same 503
  // the resolve arm already answers when it cannot establish what exists.
  if (typeof existingRow.status !== "string") {
    return failClosed(
      new Error(
        "23505 resolve: the committed row returned no status, so the echo could not be confirmed",
      ),
      "strategies",
    );
  }

  // Every check passed, so this is CONSISTENT with the instructed retry of
  // the same submission and there is nothing to persist — echo the existing
  // id. `status` is ECHOED from the row rather than hardcoded: reporting a
  // status we did not read would be fabricating an observation.
  //
  // ⚖️ 146.1 / C1 (2026-08-18) — THE CLAIM THAT WAS REMOVED, AND WHY.
  //
  // This comment used to read "this IS the instructed retry of the same
  // submission … presence is proven, not assumed", and the 200 envelope said
  // nothing at all — so the caller received a bare success indistinguishable
  // from a fresh save. Neither was supportable. The arm makes exactly TWO
  // reads of the committed series: its row COUNT and its [min, max] boundary
  // dates. It reads no daily VALUE, so it cannot distinguish this payload
  // from any other payload sharing that count and those two dates. "Proven"
  // was a word for an observation that was never made.
  //
  // FOUNDER CALL: option (b), honest copy, ships. Option (a) — a content hash
  // — would make the strong claim true and is filed in TODOS.md with its full
  // cost (third migration + backfill + nullable-hash fail-open period), so
  // the decision can be re-opened with the same information. ⛔ No hash, no
  // checksum and no new column is implemented here, deliberately.
  //
  // The register is `wizardErrors.ts`'s SEAMUX-04 precedent: state the fact,
  // keep the uncertainty, do not editorialise, and put a non-destructive
  // check ahead of any re-submit.
  console.warn(
    `${opts.logPrefix} 23505 resolved to the existing strategy [correlation_id=${opts.correlationId}] strategy_id=${existingRow.id}`,
  );
  return {
    ok: true,
    strategyId: existingRow.id,
    status: existingRow.status,
    // 146.1 / A4 — NOT a create. A PRIOR request committed this row; this one
    // rolled back entirely. The callers skip the metadata UPDATE on the
    // strength of this field.
    fresh: false,
    // 146.2-01 / R1 — …UNLESS the committed row never received a
    // classification at all, in which case this request's is the one that was
    // lost, and applying it is a repair rather than a mutation.
    fillClassification,
    humanMessage:
      fillHumanMessage ??
      "An earlier attempt in this wizard session had already saved this " +
        "strategy, so nothing new was written. We compared the saved track " +
        "record's row count and its first and last dates against this file — " +
        "not the individual daily values — so open the strategy to check it " +
        "holds the numbers you meant to upload.",
  };
}

/**
 * Phase 19.1 specialist-review revision 2026-05-22 / Maintainability W-2:
 * shared helper for the `compute_analytics_from_csv` enqueue side-effect.
 * Wraps the `after()` callback so the manager and contribution paths
 * schedule the same code. Non-blocking — a failure logs but does NOT
 * change the response envelope.
 *
 * API W-2 (specialist review 2026-05-22): on enqueue failure we ALSO
 * write a `strategy_analytics` placeholder row with
 * computation_status='failed'. WR-04 closed the in-handler empty-series
 * → user-stuck-polling hole, but this async after() enqueue has the
 * same shape: if enqueue_compute_job fails (e.g. migration not applied
 * to a non-prod env, or a transient 5xx from the admin RPC), the user
 * gets 200 + persistent state but no compute job ever runs. The
 * SyncProgress poller in CsvSubmitStep then polls forever because
 * strategy_analytics has no row at all — no 'computing', no 'complete',
 * no 'failed' to break out on. The placeholder upsert breaks the loop
 * out with a meaningful surface (`computation_error` cites the enqueue
 * cause). Best-effort: if the placeholder write itself fails, log so
 * operators have evidence.
 *
 * @audit-skip: compute_jobs enqueue is internal worker-state scheduling,
 * not a user-visible mutation. User intent is already captured by the
 * finalize_csv_strategy_with_returns RPC run earlier in this request.
 * Mirrors finalize-wizard's enqueue (which evades the gate only via
 * incidental multi-line formatting). PR #275 hardening justification
 * preserved when this helper was extracted.
 */
/**
 * Phase 19.1 red-team / API M-2 (2026-05-22): guarded placeholder
 * write. Both the W-2 enqueue-error path AND the M-1 flag-off path
 * write a `failed` strategy_analytics placeholder. Pre-fix, both
 * used an unconditional `.upsert(..., { onConflict: 'strategy_id' })`
 * which would stomp a `complete` status the worker had written
 * concurrently — possible when `enqueue_compute_job` returns an
 * error after the job was actually committed server-side (transient
 * 5xx after partial success). The order between the route's
 * placeholder write and the worker's terminal write was non-
 * deterministic, so the user could see either `failed` or `complete`.
 *
 * Guard with SELECT-then-UPSERT: if the row already exists with
 * computation_status='complete', log + skip the placeholder write
 * entirely. Otherwise, upsert. Two round-trips, but only on the
 * failure path. A SECURITY DEFINER conditional-update RPC would be
 * cleaner but requires a new migration; the live-on-prod migrations
 * are out of scope for this red-team fix-up.
 */
async function writeFailedStrategyAnalyticsPlaceholder(
  strategyId: string,
  computationError: string,
  opts: { logPrefix: string; correlationId: string; subcontext: string },
): Promise<void> {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    // SELECT current status. If `complete`, the worker has already
    // landed a terminal row — do NOT stomp it with `failed`.
    // PostgREST returns `data: null` when no row exists; we treat
    // that as "go ahead, upsert".
    const { data: existing, error: selectErr } = await admin
      .from("strategy_analytics")
      .select("computation_status")
      .eq("strategy_id", strategyId)
      .maybeSingle();
    if (selectErr) {
      console.warn(
        `${opts.logPrefix} ${opts.subcontext} placeholder pre-check SELECT failed (non-blocking) [correlation_id=${opts.correlationId}]: ${scrubSeamError(selectErr)}`,
      );
      // FINDING-7: capture to Sentry so admin-client SELECT failures
      // (misconfiguration, PostgREST 5xx) are alertable. Without this,
      // a guard bypass that stomps a 'complete' row with 'failed' leaves
      // zero trace beyond the console.warn above.
      captureToSentry(selectErr, {
        tags: { surface: "csv-finalize", step: "placeholder-precheck" },
        extra: { strategy_id: strategyId, correlation_id: opts.correlationId },
      });
      // Best-effort: fall through to upsert anyway. The pre-fix
      // behaviour is preserved on infra fault; the guard only matters
      // when SELECT succeeds and the row is already complete.
    } else if (
      existing &&
      isComputedAnalytics(
        (existing as { computation_status?: string }).computation_status,
      )
    ) {
      // Skip the 'failed' placeholder when the worker already wrote ANY terminal
      // success (complete OR complete_with_warnings) — else the enqueue-error
      // race would stomp a good row with 'failed'. complete_with_warnings is not
      // written on the CSV path today, but the guard must be class-consistent.
      console.warn(
        `${opts.logPrefix} ${opts.subcontext} placeholder SKIPPED — worker already wrote a terminal success (${(existing as { computation_status?: string }).computation_status}) [correlation_id=${opts.correlationId}, strategy_id=${strategyId}]`,
      );
      return;
    }
    // @audit-skip: internal recovery placeholder for a failed CSV finalize.
    // strategy_analytics rows are server-internal compute state, not a
    // user-visible mutation — user intent was already audited earlier in
    // this request by the finalize_csv_strategy_with_returns RPC.
    const { error: placeholderErr } = await admin
      .from("strategy_analytics")
      .upsert(
        {
          strategy_id: strategyId,
          computation_status: "failed",
          computation_warned: false,
          // JOB-01: clear on exit from computing (reaper key — migration 20260802120000)
          computing_started_at: null,
          computation_error: computationError,
          data_quality_flags: { csv_source: true },
        },
        { onConflict: "strategy_id" },
      );
    if (placeholderErr) {
      console.warn(
        `${opts.logPrefix} ${opts.subcontext} strategy_analytics placeholder upsert failed (non-blocking) [correlation_id=${opts.correlationId}]: ${scrubSeamError(placeholderErr)}`,
      );
      // D7 fail-loud (106-04): a silent placeholder-upsert failure leaves the
      // strategy stuck computing with zero trace beyond the warn above. Pair
      // with Sentry so it is alertable (copies the :620 precheck idiom).
      captureToSentry(placeholderErr, {
        tags: { surface: "csv-finalize", step: "placeholder-upsert" },
        extra: { strategy_id: strategyId, correlation_id: opts.correlationId },
      });
    }
  } catch (placeholderThrow) {
    // SEAMRIM-06 — the WHOLE ternary is replaced by one leaf call, not just the
    // `.message` arm, and `err.message` is precisely where undici inlines
    // whatever headers it was handed. Scrubbing one arm and leaving
    // `String(placeholderThrow)` — which renders `name: message` — would be an
    // instance fix of a two-reference site.
    //
    // ⚠️ 146.1 / A3 (2026-08-18) — CORRECTED. This comment used to justify the
    // scrub by claiming "this is the CSV finalize flow, whose outgoing headers
    // carry `X-User-Access-Token` (a live end-user Supabase JWT)". That is
    // FALSE and was already false before this change: this route calls
    // `postProcessKey` nowhere (zero matches in this file), so it forwards no
    // user JWT to anything. Since Phase 145 it talks only to PostgREST via the
    // SSR cookie-session client and, here, the service-role admin client.
    //
    // The SCRUB STAYS, and the reason is unchanged in substance: what this
    // path actually hands out is a service-role `apikey`/`Authorization`
    // header pair on the admin client, plus a Postgres connection string in
    // some fault shapes, and undici renders request headers into fetch error
    // messages the same way regardless of WHICH credential they carry. The
    // false premise was the naming of the credential, not the need to scrub
    // it. ⛔ Do not "simplify" the scrub away on the strength of the
    // correction.
    console.warn(
      `${opts.logPrefix} ${opts.subcontext} strategy_analytics placeholder upsert threw (non-blocking) [correlation_id=${opts.correlationId}]: ${scrubSeamError(placeholderThrow)}`,
    );
    // D7 fail-loud (106-04): the placeholder write threw (admin-client
    // construction / PostgREST fault) — surface it so the stuck-computing
    // strategy is alertable, not just a console.warn.
    captureToSentry(placeholderThrow, {
      tags: { surface: "csv-finalize", step: "placeholder-upsert-throw" },
      extra: { strategy_id: strategyId, correlation_id: opts.correlationId },
    });
  }
}

/**
 * WR-07 (Phase 163) — the sentence written to
 * `strategy_analytics.computation_error` when the analytics enqueue loses an
 * MVCC race (SQLSTATE 40001, the classification mig 20260826150000 added).
 *
 * VERBATIM the ELSE arm of `computation_error_copy(TEXT)` (mig 20260826120000,
 * Phase 162 HONEST-01). The parity is a GATE, not a convention: route.test.ts
 * reads that arm out of supabase/schema/functions/computation_error_copy.sql
 * and asserts byte equality, so a reworded arm turns this file RED instead of
 * drifting silently.
 *
 * ⚖️ WHY A LITERAL AND NOT AN RPC TO THE HELPER — mig 20260826150000's header
 * proposed calling it, and it IS service_role-EXECUTEable, so the call would
 * work. But it is a SECOND round-trip on a path whose FIRST round-trip just
 * lost a race, so it needs a fallback, and the only honest fallback is this
 * same literal: the RPC buys the duplication AND a new failure mode. The
 * static gate delivers the single-source-of-truth the RPC was wanted for, at
 * CI time, with nothing left to fail in production.
 *
 * ⛔ IT MUST NOT PROMISE AN AUTOMATIC RETRY. The review that raised WR-07
 * proposed "…and will retry automatically". MEASURED at HEAD: nothing in this
 * repo retries a 40001 — the one classifier that recognises the code
 * (analytics-service/main_worker.py:392) has a single call site, wrapping the
 * MARK RPCs, never an enqueue. That copy would trade operator jargon for a
 * false promise, which is the HONEST-01 defect over again one layer down. This
 * arm claims nothing about automatic retries, and that is precisely what makes
 * it true here: the enqueue did not happen, no job exists to retry itself, and
 * re-running the sync is the thing that gets the work done.
 */
const ENQUEUE_LOST_RACE_USER_COPY =
  "Analytics could not complete for this strategy. Retry the sync, or contact support if this persists.";

function enqueueCsvAnalyticsAfter(
  strategyId: string,
  fmt: string,
  opts: { logPrefix: string; correlationId: string },
): void {
  after(async () => {
    let enqueueFailed = false;
    let enqueueErrMessage = "";
    // WR-07: the SQLSTATE is the WHOLE signal for a lost enqueue race — the
    // message riding with it is operator text, and mig 20260826150000 says so
    // at the RAISE itself ("A caller that wants to retry branches on the code,
    // never on this string"). This is that branch. Before it existed,
    // `grep -rn "40001" src/` had ZERO non-test hits and every enqueue failure
    // read identically to the user.
    let enqueueLostRace = false;
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      // @audit-skip: see helper-level audit-skip block above. Internal
      // compute-job enqueue — user intent was already audited by
      // finalize_csv_strategy_with_returns earlier.
      const { error: enqueueErr } = await admin.rpc("enqueue_compute_job", {
        p_strategy_id: strategyId,
        p_kind: "compute_analytics_from_csv",
        p_metadata: { source: "csv-finalize", fmt },
      });
      if (enqueueErr) {
        enqueueFailed = true;
        enqueueErrMessage = enqueueErr.message ?? "(no message)";
        enqueueLostRace = enqueueErr.code === "40001";
        console.warn(
          `${opts.logPrefix} enqueue_compute_analytics_from_csv failed (non-blocking) [correlation_id=${opts.correlationId}]: ${enqueueErrMessage}`,
        );
        // D7 fail-loud (106-04): a silent enqueue failure means no compute job
        // ever runs and the strategy is stuck — the placeholder below breaks
        // the poller, but the enqueue failure itself must alert (copies :620).
        captureToSentry(enqueueErr, {
          tags: { surface: "csv-finalize", step: "csv-analytics-enqueue" },
          extra: { strategy_id: strategyId, correlation_id: opts.correlationId },
        });
      }
    } catch (err) {
      enqueueFailed = true;
      enqueueErrMessage = err instanceof Error ? err.message : String(err);
      console.warn(
        `${opts.logPrefix} enqueue side-effect threw (non-blocking) [correlation_id=${opts.correlationId}]: ${enqueueErrMessage}`,
      );
      // D7 fail-loud (106-04): the enqueue side-effect threw — surface it so
      // the resulting stuck-computing strategy is alertable, not silent.
      captureToSentry(err, {
        tags: { surface: "csv-finalize", step: "csv-analytics-enqueue-throw" },
        extra: { strategy_id: strategyId, correlation_id: opts.correlationId },
      });
    }
    // API W-2: enqueue failure → write strategy_analytics placeholder so
    // the wizard's SyncProgress poller breaks out with a meaningful
    // error surface instead of polling forever. API M-2 (red-team
    // 2026-05-22): guarded SELECT-then-UPSERT so we don't stomp a
    // `complete` status the worker may have written concurrently.
    if (enqueueFailed) {
      // ⛔ WR-07 (Phase 163) — THIS ARGUMENT IS USER COPY, NOT A LOG LINE. It
      // lands in `strategy_analytics.computation_error`, which renders
      // VERBATIM to the strategy's OWNER in the wizard failure envelope. The
      // "compute job enqueue failed:" prefix used to be unconditional, so no
      // wording SQL could choose ever reached the user unprefixed — which is
      // why mig 20260826150000 recorded WR-07 as owed HERE instead of
      // rewording its own RAISE, a change that would have looked like a fix
      // while changing nothing the user reads.
      //
      // ⚠️ ONLY the 40001 arm is re-worded, and the discrimination is the
      // point: every other enqueue failure keeps the operator-shaped message,
      // because no curated sentence exists for those shapes and a blanket swap
      // would delete the only diagnostic this column carries for them.
      //
      // Nothing is lost on the operator side on this arm either — the raw
      // message is on the console.warn above and the whole error object went
      // to Sentry under the `csv-analytics-enqueue` step tag.
      await writeFailedStrategyAnalyticsPlaceholder(
        strategyId,
        enqueueLostRace
          ? ENQUEUE_LOST_RACE_USER_COPY
          : `compute job enqueue failed: ${enqueueErrMessage}`,
        { ...opts, subcontext: "enqueue-error" },
      );
    }
  });
}

/**
 * QA ISSUE-010 + /ship specialist review: persist classification
 * metadata via an authenticated UPDATE after the SECURITY DEFINER fold
 * returns. Gated by `.eq("user_id", user.id)` + the strategies_update RLS
 * policy. Shared between the manager-path handler and the CONTRIB-02
 * contribution handler so the two stay in lockstep.
 *
 * ⚠️ ORDERING (Phase 145 / Pitfall 6): this runs ONLY after a successful
 * create or a successful 23505 resolve — never before the resolve arm's
 * identity checks. Pre-fold, the metadata UPDATE ran before the stale-range
 * fence, so a session-reuse 409 had already overwritten the resolved
 * strategy's metadata while telling the user nothing had been written.
 *
 * ⚖️ 146.2-02 / BL-01 (2026-08-19) — THE OUTCOME IS REPORTED, NOT SWALLOWED.
 * This helper used to answer `NextResponse | null`, where `null` meant BOTH
 * "the UPDATE landed" and "the UPDATE failed and I logged it" — the caller
 * could not tell them apart, and the 146.2-01 FILL arm answered 200 with copy
 * that said "so we applied them to it now" over a failed write. A user told
 * their classification was repaired does not retry, so the crypto track record
 * keeps `asset_class 'traditional'` and its KPIs keep sqrt(252) FOREVER —
 * strictly worse than the R1 bug, which at least said nothing.
 *
 * ⛔ The FAILURE SEMANTICS ARE UNCHANGED HERE and the decision moved to the
 * caller, deliberately: the fresh-create path's non-fatal handling of an UPDATE
 * failure is long-standing (the strategy row already persisted must not be
 * rolled back), and only the arm 146.2-01 introduced needs a different answer.
 * This function now only REPORTS; nothing about which outcome is fatal is
 * decided inside it.
 *
 *   'applied'       → the UPDATE ran and MATCHED THE ROW (row count observed).
 *   'noop'          → there was nothing to write, so no UPDATE was issued.
 *   'invalid'       → parseCsvMetadata signalled a present-but-invalid field
 *                     (NEW-C14-03 / NEW-C14-05) — unreachable in practice
 *                     because the identical parse already ran pre-create. Carries
 *                     the 400 the caller must return.
 *   'update_failed' → the UPDATE was issued and PostgREST returned an error
 *                     (RLS/22P02). Logged + captured to Sentry here, as before.
 *   'raced'         → the UPDATE was issued, PostgREST returned NO error, and it
 *                     matched ZERO rows: the compare-and-set predicate below
 *                     lost. Someone else classified this strategy between this
 *                     request's discriminator read and its write. NOT an
 *                     infrastructure fault — no log-and-capture, because the
 *                     system is working exactly as designed. (159-06 / RANK-07.)
 */
type CsvMetadataUpdateResult =
  | { kind: "applied" }
  | { kind: "noop" }
  | { kind: "invalid"; response: NextResponse }
  | { kind: "update_failed" }
  | { kind: "raced" };

async function applyCsvMetadataUpdate(
  supabase: SupabaseClient,
  strategyId: string,
  userId: string,
  metadataRaw: unknown,
  opts: { correlationId: string },
): Promise<CsvMetadataUpdateResult> {
  // NEW-C14-03 + NEW-C14-05: parseCsvMetadata now returns a discriminated
  // union. A present-but-invalid field (bad aum, over-cap description) is
  // a caller error — surface it as a 400 so the wizard can show a specific
  // field error instead of silently publishing a bad factsheet.
  const parsed = parseCsvMetadata(metadataRaw);
  if (!parsed.ok) {
    return {
      kind: "invalid",
      response: NextResponse.json(
        {
          ok: false,
          code: "CSV_INVALID_FORMAT",
          human_message: parsed.message,
          debug_context: { field: parsed.field },
          correlation_id: opts.correlationId,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  const updatePayload = buildMetadataUpdatePayload(parsed.payload);
  if (Object.keys(updatePayload).length === 0) return { kind: "noop" };
  // Continuation of the csv-wizard strategy creation flow —
  // finalize_csv_strategy_with_returns created the row milliseconds ago
  // (SECURITY DEFINER, audit-skipped like create_wizard_strategy +
  // finalize-wizard). Matches ADR-0023 wizard-taxonomy gap +
  // audit-2026-05-07 P692. strategies_update RLS gates the write. The
  // machine-readable pragma itself sits directly above the mutation chain
  // below: audit-coverage.test.ts requires it within 8 lines of the chain's
  // start line, and the RANK-07 commentary between here and there is longer
  // than that window.
  //
  // ⚖️ 159-06 / RANK-07 (2026-08-21) — THE DISCRIMINATOR IS RE-CHECKED IN SQL,
  // IN THE SAME STATEMENT THAT WRITES. The FILL arm decides "never classified"
  // from a read (`category_id IS NULL`) taken a whole request earlier — two more
  // reads, the clock-safety guard and the metadata parse all sit in between. Two
  // resubmits of the same wizard session (a double-clicked submit, a retry fired
  // while the first still hung) therefore both read NULL, both conclude the fill
  // is safe, and both write; the second silently overwrites the first, and on
  // `asset_class` that is the ANNUALIZATION CLOCK being overwritten. Appending
  // the predicate to the UPDATE makes the check and the set one statement, so
  // SQL — not the interleaving — picks the winner.
  //
  // SAFE ON THE FRESH ARM TOO: a fresh row's `category_id` is also NULL (the
  // fold's INSERT never writes it, see the discriminator anchor above), so this
  // predicate matches there by construction and no legitimate first write is
  // refused.
  //
  // `.select("id")` IS NOT DECORATION — IT IS THE ONLY WAY TO KNOW. PostgREST
  // returns NO error when an UPDATE matches zero rows, so without the returned
  // rows a raced-out writer is byte-identical to the winner and would be handed
  // `applied`: the BL-01 false receipt again, reached by a new route. Row count
  // observed, exactly as the deletion-request approve/reject CAS does it.
  // @audit-skip: see the wizard-continuation rationale above this comment
  // block — SECURITY DEFINER row created milliseconds ago, ADR-0023.
  const { data: casRows, error: updateError } = await supabase
    .from("strategies")
    .update(updatePayload)
    .eq("id", strategyId)
    .eq("user_id", userId)
    .is("category_id", null)
    .select("id");
  if (updateError) {
    // NEW-C14-04: pair console.error with captureToSentry so a metadata
    // UPDATE failure is alertable and traceable. Pre-fix: only console.error
    // was called, so a silent RLS/22P02 failure left the strategy with no
    // category/markets while the user believed everything saved.
    console.error(
      "[strategies/csv-finalize] metadata update non-fatal error:",
      // `.code` is the allowlisted SQLSTATE (SEAMRIM-06) and stays beside the
      // scrubbed rendering; `.message` is the shape that carries headers.
      updateError.code,
      scrubSeamError(updateError),
    );
    captureToSentry(updateError, {
      tags: { surface: "csv-finalize", step: "metadata-update" },
      extra: { strategy_id: strategyId, correlation_id: opts.correlationId },
    });
    // 146.2-02 / BL-01: the log + capture above are unchanged; what changed is
    // that the caller now LEARNS this happened instead of receiving the same
    // `null` a success returns.
    return { kind: "update_failed" };
  }
  // 159-06 / RANK-07 — zero rows with no error is the CAS losing, which is a
  // DIFFERENT fact from the UPDATE failing and must not borrow its diagnosis:
  // no console.error, no Sentry capture (contention is not an outage, and
  // paging on it trains the alert away). The caller decides what it costs.
  if ((casRows ?? []).length === 0) return { kind: "raced" };
  return { kind: "applied" };
}

export const POST = withAuth(async (req: NextRequest, user: User) => {
  // API W-1 / specialist-review revision 2026-05-22: generate the
  // correlation_id at request entry so every error/success envelope
  // emitted by this route can be traced through logs and across the
  // process-key upstream. The route's header still references
  // "OBSERV-06 will thread this later"; this change is the threaded
  // piece for csv-finalize specifically.
  const correlation_id = crypto.randomUUID();

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: "Invalid request body.",
        debug_context: {},
        correlation_id,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const {
    wizard_session_id,
    fmt,
    strategy_name,
    metadata: metadataRaw,
    entry_context,
  } = body as Record<string, unknown>;

  // CONTRIB-02 (Phase 110) — entry_context selects the terminal-status branch,
  // mirroring finalize-wizard. Closed set {manager, contribution}; ABSENT/null →
  // 'manager' (back-compat: every caller before this phase sends nothing). A
  // garbage value is a hard 400 before the RPC — never silently coerced. Safe by
  // construction: BOTH reachable statuses ('pending_review','private') are
  // non-published, the admin publish queue lists only 'pending_review', and the
  // finalize_csv_strategy_with_returns RPC RAISEs on any other terminal value
  // (server-side enforcement, T-110-10 / V5).
  if (
    entry_context !== undefined &&
    entry_context !== null &&
    entry_context !== "manager" &&
    entry_context !== "contribution"
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: "entry_context must be 'manager' or 'contribution'.",
        debug_context: {},
        correlation_id,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const entryContext =
    entry_context === "contribution" ? "contribution" : "manager";

  if (typeof wizard_session_id !== "string" || !isUuid(wizard_session_id)) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: "wizard_session_id must be a valid UUID.",
        debug_context: {},
        correlation_id,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (typeof fmt !== "string" || !ALLOWED_FMTS.has(fmt)) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: "fmt must be one of daily_returns, daily_nav, trades.",
        debug_context: {
          fmt_received: typeof fmt === "string" ? fmt : "(missing)",
        },
        correlation_id,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Phase 19.1 / T-19.1-04: parse + validate the daily-return series at
  // the route boundary before the strategy row gets created. Failure
  // here is a clean 400 — neither the SECURITY DEFINER RPC nor the
  // worker has to defend against malformed JSON.
  const parsedSeries = parseDailyReturnsSeries(
    (body as Record<string, unknown>).daily_returns_series,
  );
  if (!parsedSeries.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: parsedSeries.code,
        human_message: parsedSeries.message,
        debug_context: parsedSeries.debug_context ?? {},
        correlation_id,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const dailyReturnsSeries = parsedSeries.rows;

  // Cross-AI revision 2026-04-30: strategy_name is REQUIRED and validated
  // against the same 1–80 char range as the UI. Defense-in-depth: the RPC
  // also validates, but rejecting here gives a clearer error envelope.
  if (typeof strategy_name !== "string") {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: "strategy_name is required.",
        debug_context: {},
        correlation_id,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const trimmedName = strategy_name.trim();
  if (trimmedName.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: "strategy_name cannot be empty.",
        debug_context: {},
        correlation_id,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  // NEW-C14-12: check trimmedName.length (not the raw strategy_name.length).
  // Pre-fix: a name of 79 visible chars + trailing spaces would be rejected
  // as >80 chars even though the persisted value (trimmed) is ≤80. The user
  // sees a false error on the read-only review screen with no editable field.
  if (trimmedName.length > MAX_NAME_CHARS) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: `strategy_name must be ${MAX_NAME_CHARS} characters or fewer.`,
        debug_context: { length: trimmedName.length },
        correlation_id,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // WR-04 (19.1-REVIEW): reject empty daily_returns_series for the
  // return-series-bearing fmts BEFORE strategy creation. Both handlers
  // gate the after() compute_analytics_from_csv enqueue on
  // dailyReturnsSeries.length > 0 (and the fold's dailies INSERT is
  // length-gated). If a malformed-but-zod-passing payload lands `[]` (or omits
  // the field entirely → parseDailyReturnsSeries returns rows=[] per
  // its undefined/null branch) for fmt=daily_returns or fmt=daily_nav,
  // the strategy row would be created (at its terminal status —
  // 'pending_review' or, for a CONTRIB-02 contribution, 'private') but
  // no series is persisted and no compute job is enqueued. The
  // wizard's SyncProgress poller then hangs indefinitely because
  // strategy_analytics has no row at all — no 'computing', no
  // 'complete', no 'failed' to break out on. Reject at the route
  // boundary so the strategy is never created in this half-baked
  // state. Placed AFTER strategy_name validation so existing tests
  // that test strategy_name in isolation (no series payload) still
  // see the more specific strategy_name error first.
  //
  // fmt='trades' currently produces no series (the trades-format branch in csv_validator.py)
  // and is intentionally exempt — that path falls through with the
  // "analytics not generated" copy until a future iteration extends
  // trades-derived analytics.
  if (
    (fmt === "daily_returns" || fmt === "daily_nav") &&
    dailyReturnsSeries.length === 0
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message:
          "daily_returns_series is required for fmt=daily_returns and fmt=daily_nav (received 0 rows).",
        debug_context: { fmt, row_count: 0 },
        correlation_id,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // NEW-C14-03 + NEW-C14-05: validate metadata BEFORE the RPC so a
  // present-but-invalid field (bad aum, over-cap description) is caught
  // as a clean 400 before any strategy row is created. applyCsvMetadataUpdate
  // also validates, but it runs after RPC — catching it here avoids an
  // orphaned `strategies` row on validation errors. (Phase 145 / D-11: this
  // exact three-word phrase is count-asserted to ZERO occurrences in src/ —
  // it was the search string of a deleted vacuous test; do not reintroduce it.)
  const preCreateMetadataParsed = parseCsvMetadata(metadataRaw);
  if (!preCreateMetadataParsed.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: preCreateMetadataParsed.message,
        debug_context: { field: preCreateMetadataParsed.field },
        correlation_id,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  // 146.2-01 / R1: the resolve arm compares THIS request's classification
  // against the committed row's, so it needs the parsed values. Read them off
  // the parse that already ran rather than parsing the same blob again —
  // two parses of one payload are two chances to disagree.
  const requestedCategoryId =
    preCreateMetadataParsed.payload?.category_id ?? null;
  const requestedAssetClass =
    preCreateMetadataParsed.payload?.asset_class ?? null;

  // B15 (2026-05-30): rate-limit consumption runs AFTER all pure input
  // validation (body parse, wizard_session_id/fmt, daily_returns_series incl
  // the 5000-row cap, strategy_name, metadata) and BEFORE any side-effecting
  // work (the finalize_csv_strategy_with_returns RPC). Pre-fix this
  // checkLimit ran first, so a malformed request burned one of the caller's
  // own tokens before being rejected with a 400. The limiter, key string,
  // and inline 429 envelope are unchanged — only position moved.
  const rl = await checkLimit(
    csvValidateLimiter,
    `strategies-csv-finalize:${user.id}`,
  );
  if (!rl.success) {
    // 140.4-13 / SEAMRIM-05 — deny through the chokepoint so a limiter
    // misconfiguration answers 503.
    //
    // ⚠️ THE 429 STAYS THE CSV v0 ENVELOPE, ALL FIVE FIELDS IN THE SAME ORDER.
    // `CsvSubmitStep` reads `human_message` off the wire and reports `code` into
    // the wizard_error funnel; flattening this onto the builder's
    // `{error: "…"}` default would blank the rendered sentence AND lose the
    // funnel's discriminator. The 503 keeps the SAME envelope shape — so the
    // step renders an honest sentence about OUR configuration rather than
    // falling back to the generic CSV copy — with `SEAM_MISCONFIGURED`, an
    // existing WizardErrorCode, rather than a newly minted one.
    return rateLimitDenyJson(rl, {
      headers: NO_STORE_HEADERS,
      throttledBody: {
        ok: false,
        code: "CSV_RATE_LIMIT",
        human_message: "Too many requests. Wait a minute and try again.",
        debug_context: {},
        correlation_id,
      },
      misconfiguredBody: {
        ok: false,
        code: "SEAM_MISCONFIGURED",
        human_message:
          "Our rate limiter is unavailable, so we stopped before submitting anything. This is a fault on our side, not your file. Nothing was saved — try again in a minute.",
        debug_context: {},
        correlation_id,
      },
    });
  }

  // CONTRIB-02 (Phase 110) — a contribution finalizes to an owner-only
  // status='private' (W1 note, 110-01). Since Phase 145 both flows call the
  // folded RPC directly on the user-scoped client and differ ONLY in the
  // p_terminal_status they pass; the contribution passes 'private' verbatim
  // (D-08), then runs the IDENTICAL post-finalize side-effect fan-out
  // (metadata UPDATE + analytics enqueue) — dailies are canonical, the
  // contribution needs its KPIs.
  //
  // 146.1 / C2 (2026-08-18) — ONE handler serves both flows. `terminalStatus`
  // and `logPrefix` are the ONLY things that ever differed (measured, not
  // assumed: a comment-stripped difflib over the two 55-line bodies returned
  // exactly four differing tokens — the function name, the terminal status,
  // and the log prefix twice). Passing them as arguments is what makes the
  // sameness structural instead of a promise two copies were making to each
  // other.
  //
  // ⛔ `terminalStatus` is passed VERBATIM and is never derived from a
  // default. D-08: losing 'private' here silently promotes an owner-only
  // draft into the admin publish queue.
  if (entryContext === "contribution") {
    return await unifiedCsvFinalizeHandler({
      wizard_session_id,
      fmt,
      strategy_name: trimmedName,
      userId: user.id,
      metadataRaw,
      requestedCategoryId,
      requestedAssetClass,
      dailyReturnsSeries,
      correlationId: correlation_id,
      terminalStatus: "private",
      logPrefix: "[strategies/csv-finalize contribution]",
    });
  }

  // Phase 145 (D-06 option i-b): the manager flow calls the folded RPC
  // directly — Phase 106 Stage B's "unified backbone is the sole finalize
  // path" ruling is CONSCIOUSLY REVERSED for this flow (recorded in
  // 145-DECISION.md; the Python csv-finalize branch was deleted in the same
  // change). The handler writes the classification UPDATE after a
  // successful fold/resolve outcome.
  return await unifiedCsvFinalizeHandler({
    wizard_session_id,
    fmt,
    strategy_name: trimmedName,
    userId: user.id,
    metadataRaw,
    requestedCategoryId,
    requestedAssetClass,
    dailyReturnsSeries,
    correlationId: correlation_id,
    terminalStatus: "pending_review",
    logPrefix: "[strategies/csv-finalize unified]",
  });
});

/**
 * Phase 145 / JOB-06 — THE CSV finalize handler. ONE handler, both flows.
 *
 * HISTORY, because the name would otherwise mislead: Phase 19/BACKBONE-01
 * made this handler delegate to the Python `/process-key` unified backbone
 * (hop 0, an HTTP boundary no transaction can span), and Phase 106 Stage B
 * made that delegate the sole manager-path writer. Phase 145 (D-06, founder
 * decision recorded in 145-DECISION.md, option i-b) CONSCIOUSLY REVERSED
 * Stage B for this flow: the route now calls the folded
 * `finalize_csv_strategy_with_returns` RPC directly on the SSR user-scoped
 * client — the CONTRIB-02 shape, for both paths. Hop 0 is gone, so the
 * "response lost after the RPC committed" window (window A) ceases to
 * exist, and the strategy + verification + dailies writes share ONE
 * transaction.
 *
 * ⚖️ 146.1 / C2 (2026-08-18) — `contributionCsvFinalizeHandler` WAS A SECOND
 * COPY OF THIS FUNCTION AND IS GONE. The two bodies were token-identical:
 * measured with a comment-stripped difflib over both, 55 lines each, and
 * exactly FOUR differing tokens — the function name, `terminalStatus`
 * ('pending_review' vs 'private'), and `logPrefix` twice (the fold call and
 * the enqueue call). Not one statement, argument or ordering differed. Two
 * copies of a ~90-line side-effect fan-out is a drift generator: every future
 * fix to one arm is a coin flip on whether the other gets it, and the failure
 * is silent because both arms keep passing their own tests. The four tokens
 * are now ARGUMENTS.
 *
 * WHAT THE MERGED DOC ABSORBS from the deleted CONTRIB-02 docblock, because
 * it is still load-bearing:
 *   - Why a direct RPC is correct here and needs no INTERNAL_API_TOKEN and no
 *     JWT forwarding to Python: `createClient()` is already user-scoped (the
 *     SSR cookie session), so the SECURITY DEFINER RPC's
 *     `auth.uid() = p_user_id` guard is satisfied natively.
 *   - The fold RAISEs on any `p_terminal_status` outside
 *     ('pending_review','private') — server-side enforcement of the
 *     never-published invariant.
 *   - There is NO publish-review notification on the CSV path to suppress
 *     (unlike finalize-wizard's founder email); the CSV route never notified.
 *   - The analytics enqueue is KEPT for a contribution: it is a real track
 *     record and the allocator needs its daily series + KPIs in the composer.
 *
 * ⛔ THE SIGNATURE IS PINNED BY GATES — read before "simplifying" it.
 * `csv-validate-route.test.ts` Test 8b (source-shape) and Test 8c (arity
 * lock) require: the name `unifiedCsvFinalizeHandler`, a SINGLE typed args
 * object (`(args: {`), an explicit `dailyReturnsSeries: CsvDailyReturnRow[]`
 * field — T-19.1-10, closure capture would make the dependency invisible to
 * the type system — and a single-object-literal call site. A rename or a
 * second positional parameter reds all three by name.
 */
async function unifiedCsvFinalizeHandler(args: {
  wizard_session_id: string;
  fmt: string;
  strategy_name: string;
  userId: string;
  metadataRaw: unknown;
  // 146.2-01 / R1 — this request's parsed classification, threaded from the
  // pre-create parse in POST. Passed as VALUES rather than re-derived here for
  // the reason T-19.1-10 gives just below about the series: a dependency the
  // type system cannot see is a dependency the next refactor will drop. The
  // resolve arm compares these against the committed row's; a `null` means
  // this submission did not declare that field, which is never a conflict.
  requestedCategoryId: string | null;
  requestedAssetClass: "crypto" | "traditional" | null;
  // Phase 19.1 / T-19.1-10: dailyReturnsSeries is passed EXPLICITLY through
  // the handler signature, NOT captured from the outer scope. Closure
  // capture would make the dependency invisible to the type system and
  // to future refactors (e.g. moving this function to a sibling file).
  // Code review caught the closure-capture variant on the discarded
  // PR #270 branch; the explicit param + the audit-coverage test pin
  // the contract.
  dailyReturnsSeries: CsvDailyReturnRow[];
  // API W-1 (specialist review 2026-05-22): correlation_id is generated
  // at the route entry and threaded through both handler paths so every
  // envelope shares a traceable id.
  correlationId: string;
  // 146.1 / C2 — the two fields that USED to be the difference between two
  // copies of this function.
  //
  // D-08: `terminalStatus` is passed VERBATIM by the caller and is never
  // defaulted here. The fold RAISEs on anything outside
  // ('pending_review','private'), but a silent default would still be a
  // promotion of an owner-only contribution into the admin publish queue,
  // which is exactly the class A2 refuses one layer down.
  terminalStatus: "pending_review" | "private";
  // ⛔ The two literals stay DISTINCT in the emitted output. Deriving this
  // from `terminalStatus` would work, but operators grep these prefixes and
  // a collapse that also collapsed the logs would make the two flows
  // indistinguishable in Vercel exactly when someone is trying to tell them
  // apart.
  logPrefix: string;
}): Promise<NextResponse> {
  // Phase 145 (i-b): the SSR cookie-session client is natively user-scoped,
  // so the SECURITY DEFINER fold's auth.uid() = p_user_id guard is satisfied
  // without any token forwarding — the dance the pre-fold delegate performed
  // existed only because the analytics service's module client is
  // service-role. withAuth has already authenticated the request; an expired
  // session surfaces as the RPC's own 42501 through the fold-failure arm
  // (146.1 / A3 classifies it there as an observed rollback).
  const supabase = await createClient();

  // ONE write path: strategy + verification + dailies in a single
  // transaction (D-07). On 23505 the read-only resolve arm verifies
  // identity (name, then range) BEFORE anything of this submission is
  // written — the metadata UPDATE below runs only after a successful
  // create or a successful resolve (Pitfall 6).
  const outcome = await finalizeAtomicOrErrorResponse(
    supabase,
    {
      userId: args.userId,
      wizardSessionId: args.wizard_session_id,
      fmt: args.fmt,
      strategyName: args.strategy_name,
      rows: args.dailyReturnsSeries,
      terminalStatus: args.terminalStatus,
      requestedCategoryId: args.requestedCategoryId,
      requestedAssetClass: args.requestedAssetClass,
    },
    {
      logPrefix: args.logPrefix,
      correlationId: args.correlationId,
    },
  );
  if (!outcome.ok) return outcome.response;

  // QA ISSUE-010: persist classification metadata via an authenticated
  // UPDATE. NEW-C14-03/C14-04/C14-05: handle validation error from
  // applyCsvMetadataUpdate. Deliberately AFTER the fold/resolve outcome:
  // on the resolve path this is what makes the 409 refusal truthful — the
  // identity checks ran before any metadata write (Phase 145 / D-09, D-11).
  //
  // 146.1 / A4 (2026-08-18) — AND ONLY ON A FRESH CREATE, OR ON AN ECHO THAT
  // FOUND NO CLASSIFICATION TO PRESERVE. Before A4, an ECHOED 23505 outcome ran
  // this UPDATE with THIS request's metadata against a row a PRIOR request had
  // committed. `buildMetadataUpdatePayload` copies `asset_class` verbatim, and
  // `asset_class` IS the annualization clock (sqrt(365) crypto / sqrt(252)
  // traditional, #597 part 2). The stored KPIs were computed by the worker from
  // the FIRST submission's dailies under the clock THAT submission declared, so
  // a retry with a flipped picker value relabelled the row while every
  // persisted Sharpe/Sortino/CAGR kept the old convention — and for
  // fmt='trades' the enqueue gate below skips the recompute that might have
  // reconciled them, making the mismatch permanent.
  //
  // SKIP, not "re-enqueue after". The enqueue is `after()`-scheduled and
  // non-blocking, so there is no ordering between it and this UPDATE to rely
  // on; skipping is both simpler and strictly safer. An echo is the SAME
  // submission arriving twice — honouring its metadata is honouring a
  // mutation the user never asked for.
  //
  // ⭐ 146.2-01 / R1 — WHY `fillClassification` DOES NOT WEAKEN THAT. A4's rule
  // is about honouring a MUTATION. The fill arm fires only when the resolve arm
  // MEASURED the committed row's `category_id` as SQL NULL, which is proof this
  // very UPDATE never ran on the first attempt — so there is no committed
  // classification to overwrite and nothing was ever mutated. A4 as shipped was
  // wider than its own reason: it also skipped the case where the user's choice
  // had been dropped entirely, which on `asset_class` means a crypto track
  // record permanently annualized sqrt(252) with no editor to repair it. The
  // refuse arm (a present-and-different classification → 409) is what keeps
  // A4's actual intent, and the economic oracle still pins it.
  //
  // ⛔ ORDER IS LOAD-BEARING: this UPDATE is AWAITED and it sits BEFORE the
  // enqueue below, so on a series-bearing fill the worker reads the POST-FILL
  // clock. Moving the enqueue above this line would recompute the KPIs under
  // the clock the fill was about to replace.
  //
  // ⚖️ 146.2-02 / BL-01 (2026-08-19) — AND THE FILL ARM READS THE OUTCOME.
  // `applyCsvMetadataUpdate` used to answer `null` for BOTH "the UPDATE landed"
  // and "the UPDATE failed, I logged it and captured it", so this call site
  // could not tell them apart and answered 200 either way. On the FRESH path
  // that is the long-standing and deliberate call: the strategy row already
  // persisted, and rolling the request back over a metadata write would be
  // worse. On the FILL arm it is a LIE with a cost — the echo's copy says "so
  // we applied them to it now", and a user who is told the repair happened does
  // not retry. The strategy then keeps `category_id NULL` (invisible to
  // discovery) and `asset_class 'traditional'` (sqrt(252)) on a crypto track
  // record, with no post-creation editor anywhere in the product that could fix
  // it. Silence, as R1 shipped it, was better than a false receipt.
  //
  // REFUSING COSTS NOTHING HERE, which is why this arm can afford the truth:
  // the strategy is already committed, this request wrote nothing, and the
  // resubmit is idempotent — on 'update_failed' the fill discriminator
  // (`category_id IS NULL`) still reads NULL, so the next attempt takes the
  // same arm and repairs it. (159-06: on 'raced' the resubmit is equally
  // reachable but lands on a DIFFERENT arm — see the RANK-07 note below.)
  //
  // `!== "applied"` and not `=== "update_failed"`: 'noop' means no UPDATE was
  // issued at all, which is equally not a repair. The fill arm now answers 200
  // only when an UPDATE actually ran and actually succeeded.
  //
  // ⚖️ 159-06 / RANK-07 (2026-08-21) — 'raced' RIDES THIS SAME REFUSAL, and the
  // `!== "applied"` shape is why no new branch was needed. A raced-out writer
  // lost the compare-and-set: its own write did not land, which is precisely
  // what the copy below says, and its remedy is the same resubmit. What the
  // resubmit does differs, and that is the point — the discriminator now reads
  // a NON-NULL `category_id`, so the next attempt takes the ALREADY-CLASSIFIED
  // arm instead: 200 when the two submissions agree (the double-click case),
  // 409 naming BOTH values when they do not. Divergence is adjudicated out
  // loud, where last-writer-wins used to bury it.
  //
  // The two not-applied causes stay distinguishable where it matters: the warn
  // line below interpolates the kind, and only 'update_failed' logs and pages
  // Sentry from inside the helper. An operator can tell contention from an RLS
  // fault; the user, who can act on neither distinction, gets one clear
  // sentence and one working next step.
  if (outcome.fresh || outcome.fillClassification) {
    const metaResult = await applyCsvMetadataUpdate(
      supabase,
      outcome.strategyId,
      args.userId,
      args.metadataRaw,
      { correlationId: args.correlationId },
    );
    if (metaResult.kind === "invalid") return metaResult.response;
    if (outcome.fillClassification && metaResult.kind !== "applied") {
      console.warn(
        `${args.logPrefix} classification FILL did not land (${metaResult.kind}) — refusing to report it as applied [correlation_id=${args.correlationId}] strategy_id=${outcome.strategyId}`,
      );
      return NextResponse.json(
        {
          ok: false,
          code: "CSV_PERSIST_FAIL",
          human_message:
            "An earlier attempt in this wizard session had already saved this " +
            "strategy, and we tried to apply the category and asset class you " +
            "entered to it just now — but that write did not land, so nothing " +
            "was changed. Submit the same file again shortly; it will not " +
            "create a second strategy.",
          debug_context: { strategy_id: outcome.strategyId },
          correlation_id: args.correlationId,
        },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    // ⚖️ RANK-07 red-team (2026-08-23) — THE FRESH ARM MUST REFUSE ON 'raced'
    // TOO, and it needs its OWN branch because it does not share the fill
    // arm's other two verdicts.
    //
    // The CAS predicate rides BOTH arms, so both can lose it. The fresh arm
    // loses it in exactly the double-submit scenario this phase closes: two
    // requests of the same wizard session resolve to the SAME strategy row
    // (23505 echo dedupe), one takes the fill arm and its CAS lands first, and
    // the other — which believes it is the fresh writer — matches zero rows.
    // Falling through to `ok: true` there is the BL-01 false receipt with the
    // worst payload of the three: the loser's `asset_class` is the
    // ANNUALIZATION CLOCK, silently discarded while the user is told the
    // submission succeeded.
    //
    // WHY NOT JUST DROP THE `outcome.fillClassification &&` QUALIFIER: that
    // would also flip fresh-arm 'update_failed' and 'noop' to a refusal.
    // 'update_failed' answering 200 on a fresh create is the long-standing and
    // deliberate call reasoned about above (the strategy row persisted;
    // failing the request over a metadata write is worse), and 'noop' means
    // there was no metadata to write at all. 'raced' is the one verdict whose
    // cost differs: another writer's value is now committed on this row.
    //
    // The copy is fresh-specific because the fill arm's sentence ("nothing was
    // changed") is FALSE here — the strategy WAS created by this request. The
    // remedy is the same resubmit, and it is now reachable on the
    // already-classified arm: 200 if the two submissions agree, 409 naming
    // both values if they do not.
    if (outcome.fresh && metaResult.kind === "raced") {
      console.warn(
        `${args.logPrefix} fresh-arm classification lost the CAS (raced) — refusing to report it as applied [correlation_id=${args.correlationId}] strategy_id=${outcome.strategyId}`,
      );
      return NextResponse.json(
        {
          ok: false,
          code: "CSV_PERSIST_FAIL",
          human_message:
            "Your strategy was saved, but the category and asset class you " +
            "entered were not applied to it: another submission of this same " +
            "wizard session classified it first. Submit the same file again " +
            "shortly to confirm the classification; it will not create a " +
            "second strategy.",
          debug_context: { strategy_id: outcome.strategyId },
          correlation_id: args.correlationId,
        },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
  }

  // Phase 19.1 / T-19.1-05 / PR #275 + Maintainability W-2: shared
  // helper for the enqueue side-effect. Same non-blocking semantics —
  // hop 5 (window D) is unchanged by the fold; Phase 143's sweep heals a
  // dropped enqueue.
  if (args.dailyReturnsSeries.length > 0) {
    enqueueCsvAnalyticsAfter(outcome.strategyId, args.fmt, {
      logPrefix: args.logPrefix,
      correlationId: args.correlationId,
    });
  }
  // API C-1: `ok: true` discriminator on the success envelope. `status` is
  // the terminal status the fold wrote on a fresh create ('pending_review'
  // for the manager flow, CONTRIB-02's 'private' for a contribution), or the
  // resolved row's own status on the 23505 echo path — ECHOED, never
  // fabricated.
  //
  // 146.1 / C1: `human_message` rides ONLY the resolve echo, where it states
  // the two reads that decided the echo. A fresh create carries no such
  // field, so this envelope is unchanged for every first submit.
  return NextResponse.json(
    {
      ok: true,
      strategy_id: outcome.strategyId,
      status: outcome.status,
      ...(outcome.humanMessage
        ? { human_message: outcome.humanMessage }
        : {}),
      correlation_id: args.correlationId,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

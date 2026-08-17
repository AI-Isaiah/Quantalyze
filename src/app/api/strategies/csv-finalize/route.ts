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
import { NO_STORE_HEADERS } from "@/lib/api/headers";

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
  } else if (typeof obj.category_id === "string" && isUuid(obj.category_id)) {
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
  | { ok: true; strategyId: string; status: string }
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
  },
  opts: { logPrefix: string; correlationId: string },
): Promise<FinalizeAtomicOutcome> {
  const { data: newStrategyId, error } = await (
    supabase.rpc as unknown as (
      fn: "finalize_csv_strategy_with_returns",
      rpcArgs: {
        p_user_id: string;
        p_wizard_session_id: string;
        p_fmt: string;
        p_strategy_name: string;
        p_rows: CsvDailyReturnRow[];
        p_terminal_status: string;
      },
    ) => Promise<{
      data: string | null;
      error: { code?: string; message?: string } | null;
    }>
  )("finalize_csv_strategy_with_returns", {
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
    return { ok: true, strategyId: newStrategyId, status: args.terminalStatus };
  }

  if (error?.code === "23505") {
    return await resolveExistingStrategyOrRefuse(supabase, args, opts);
  }

  // ── The fold-failure arm (D-07, D-11, D-12) ────────────────────────────
  // A non-23505 RPC error, or a 2xx whose payload lost the id. Under the
  // fold NOTHING was persisted (the rollback is total), so the copy below
  // states exactly that and invites a retry — which arrives as a clean
  // first submit, not a 23505.
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
  captureToSentry(
    error ??
      new Error(
        `finalize_csv_strategy_with_returns returned a non-uuid strategy id (${String(
          newStrategyId,
        )})`,
      ),
    {
      tags: { surface: "csv-finalize", step: "finalize-fold-fail" },
      extra: {
        correlation_id: opts.correlationId,
        rpc_error_code: error?.code ?? null,
      },
    },
  );
  return {
    ok: false,
    response: NextResponse.json(
      {
        ok: false,
        code: "CSV_FINALIZE_FAIL",
        human_message:
          "Your strategy could not be saved. Nothing was saved — the submission rolled back completely, so it is safe to try again. Contact support@quantalyze.com if it persists.",
        debug_context: { rpc_error_code: error?.code ?? null },
        correlation_id: opts.correlationId,
      },
      { status: 500, headers: NO_STORE_HEADERS },
    ),
  };
}

/**
 * ⚠️ CR-01 — THE 23505 RESOLVE ARM. Read this before "simplifying" it away.
 *
 * Under the fold a 23505 has exactly ONE reachable meaning: a PRIOR attempt
 * for this (user, wizard_session, source='csv') FULLY committed — strategy,
 * verification AND dailies, all-or-nothing — and this attempt's own writes
 * rolled back completely. (The dailies unique index can also raise 23505 on
 * a duplicate-date payload in principle, but the route boundary 400s
 * duplicate dates before any dispatch — parseDailyReturnsSeries is the
 * load-bearing gate — and if one ever slipped through, the re-fetch below
 * finds no committed row and the arm fails CLOSED rather than echoing.)
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
  const { data: existing, error: refetchErr } = await supabase
    .from("strategies")
    .select("id, name, status")
    .eq("user_id", args.userId)
    .eq("wizard_session_id", args.wizardSessionId)
    .eq("source", "csv")
    .maybeSingle();
  if (refetchErr) return failClosed(refetchErr, "strategies");
  const existingRow = existing as {
    id?: string;
    name?: string;
    status?: string;
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

  const refuse = (reason: string): FinalizeAtomicOutcome => {
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
            "This wizard session already created a strategy with a different track record, so we refused before writing anything of this submission. Start a new strategy to upload a different file.",
          debug_context: { strategy_id: existingRow.id },
          correlation_id: opts.correlationId,
        },
        { status: 409, headers: NO_STORE_HEADERS },
      ),
    };
  };

  // CR-01 check 1 — NAME, before anything else. A changed track record is a
  // NEW strategy; a renamed resubmit must never resolve to the old row.
  if (
    typeof existingRow.name === "string" &&
    existingRow.name !== args.strategyName
  ) {
    return refuse("name mismatch");
  }

  // CR-01 check 2 — RANGE, as a READ against the committed dailies. Skipped
  // for a no-series payload (fmt='trades' has no range to compare — the
  // pre-fold fence never ran for it either).
  if (args.rows.length > 0) {
    let minDate = args.rows[0].date;
    let maxDate = args.rows[0].date;
    for (const r of args.rows) {
      if (r.date < minDate) minDate = r.date;
      if (r.date > maxDate) maxDate = r.date;
    }
    // `date` is `YYYY-MM-DD`, regex- AND calendar-validated by
    // `parseDailyReturnsSeries` before it can reach here, so it is safe in
    // a PostgREST filter expression. Lexicographic and chronological order
    // coincide for that format, which is why the min/max scan is correct.
    const { data: staleRows, error: staleErr } = await supabase
      .from("csv_daily_returns")
      .select("date")
      .eq("strategy_id", existingRow.id)
      .or(`date.lt.${minDate},date.gt.${maxDate}`)
      .limit(1);
    if (staleErr) return failClosed(staleErr, "csv_daily_returns");
    if ((staleRows?.length ?? 0) > 0) {
      return refuse("committed dailies outside this payload's range");
    }
  }

  // Both checks passed: this IS the instructed retry of the same submission.
  // The dailies are guaranteed present (the fold committed all-or-nothing),
  // so there is nothing to persist — echo the existing id. `status` is
  // ECHOED from the row rather than hardcoded: the row may sit at 'private'
  // (a CONTRIB-02 contribution); reporting a status we did not read would be
  // fabricating an observation.
  console.warn(
    `${opts.logPrefix} 23505 resolved to the existing strategy [correlation_id=${opts.correlationId}] strategy_id=${existingRow.id}`,
  );
  return {
    ok: true,
    strategyId: existingRow.id,
    status: existingRow.status ?? "pending_review",
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
    // `.message` arm. This is the CSV finalize flow, whose outgoing headers
    // carry `X-User-Access-Token` (a live end-user Supabase JWT), and
    // `err.message` is precisely where undici puts them. Scrubbing one arm and
    // leaving `String(placeholderThrow)` — which renders `name: message` — would
    // be an instance fix of a two-reference site.
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

function enqueueCsvAnalyticsAfter(
  strategyId: string,
  fmt: string,
  opts: { logPrefix: string; correlationId: string },
): void {
  after(async () => {
    let enqueueFailed = false;
    let enqueueErrMessage = "";
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
      await writeFailedStrategyAnalyticsPlaceholder(
        strategyId,
        `compute job enqueue failed: ${enqueueErrMessage}`,
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
 * Returns null on success (or when there is nothing to update).
 * Returns a 400 NextResponse when parseCsvMetadata signals a
 * present-but-invalid field (NEW-C14-03 / NEW-C14-05) — unreachable in
 * practice because the identical parse already ran pre-create. The UPDATE
 * failure path (RLS/22P02) is non-fatal — it logs + captures to Sentry
 * but returns null so the strategy row already persisted is not rolled
 * back.
 */
async function applyCsvMetadataUpdate(
  supabase: SupabaseClient,
  strategyId: string,
  userId: string,
  metadataRaw: unknown,
  opts: { correlationId: string },
): Promise<NextResponse | null> {
  // NEW-C14-03 + NEW-C14-05: parseCsvMetadata now returns a discriminated
  // union. A present-but-invalid field (bad aum, over-cap description) is
  // a caller error — surface it as a 400 so the wizard can show a specific
  // field error instead of silently publishing a bad factsheet.
  const parsed = parseCsvMetadata(metadataRaw);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: parsed.message,
        debug_context: { field: parsed.field },
        correlation_id: opts.correlationId,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const updatePayload = buildMetadataUpdatePayload(parsed.payload);
  if (Object.keys(updatePayload).length === 0) return null;
  // @audit-skip: continuation of the csv-wizard strategy creation
  // flow — finalize_csv_strategy_with_returns created the row milliseconds
  // ago (SECURITY DEFINER, audit-skipped like create_wizard_strategy +
  // finalize-wizard). Matches ADR-0023 wizard-taxonomy gap +
  // audit-2026-05-07 P692. strategies_update RLS gates the write.
  const { error: updateError } = await supabase
    .from("strategies")
    .update(updatePayload)
    .eq("id", strategyId)
    .eq("user_id", userId);
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
  }
  return null;
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
  // status='private' (W1 note, 110-01). Since Phase 145 both branches call
  // the folded RPC directly on the user-scoped client and differ ONLY in
  // the p_terminal_status they pass; the contribution handler passes
  // 'private' verbatim (D-08), then runs the IDENTICAL post-finalize
  // side-effect fan-out (metadata UPDATE + analytics enqueue) — dailies are
  // canonical, the contribution needs its KPIs.
  if (entryContext === "contribution") {
    return await contributionCsvFinalizeHandler({
      wizard_session_id,
      fmt,
      strategy_name: trimmedName,
      userId: user.id,
      metadataRaw,
      dailyReturnsSeries,
      correlationId: correlation_id,
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
    dailyReturnsSeries,
    correlationId: correlation_id,
  });
});

/**
 * Phase 145 / JOB-06 — the manager-path finalize handler.
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
 * transaction. The name is kept because source-shape gates pin the
 * signature (single typed args object, explicit dailyReturnsSeries field).
 */
async function unifiedCsvFinalizeHandler(args: {
  wizard_session_id: string;
  fmt: string;
  strategy_name: string;
  userId: string;
  metadataRaw: unknown;
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
}): Promise<NextResponse> {
  // Phase 145 (i-b): the SSR cookie-session client is natively user-scoped,
  // so the SECURITY DEFINER fold's auth.uid() = p_user_id guard is satisfied
  // without any token forwarding — the dance the pre-fold delegate performed
  // existed only because the analytics service's module client is
  // service-role. withAuth has already authenticated the request; an expired
  // session surfaces as the RPC's own 42501 through the fold-failure arm.
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
      terminalStatus: "pending_review",
    },
    {
      logPrefix: "[strategies/csv-finalize unified]",
      correlationId: args.correlationId,
    },
  );
  if (!outcome.ok) return outcome.response;

  // QA ISSUE-010: persist classification metadata via an authenticated
  // UPDATE. NEW-C14-03/C14-04/C14-05: handle validation error from
  // applyCsvMetadataUpdate. Deliberately AFTER the fold/resolve outcome:
  // on the resolve path this is what makes the 409 refusal truthful — the
  // identity checks ran before any metadata write (Phase 145 / D-09, D-11).
  const metaErrResponse = await applyCsvMetadataUpdate(
    supabase,
    outcome.strategyId,
    args.userId,
    args.metadataRaw,
    { correlationId: args.correlationId },
  );
  if (metaErrResponse) return metaErrResponse;

  // Phase 19.1 / T-19.1-05 / PR #275 + Maintainability W-2: shared
  // helper for the enqueue side-effect. Same non-blocking semantics —
  // hop 5 (window D) is unchanged by the fold; Phase 143's sweep heals a
  // dropped enqueue.
  if (args.dailyReturnsSeries.length > 0) {
    enqueueCsvAnalyticsAfter(outcome.strategyId, args.fmt, {
      logPrefix: "[strategies/csv-finalize unified]",
      correlationId: args.correlationId,
    });
  }
  // API C-1: `ok: true` discriminator on the success envelope. `status` is
  // the terminal status the fold wrote on a fresh create, or the resolved
  // row's own status on the 23505 echo path.
  return NextResponse.json(
    {
      ok: true,
      strategy_id: outcome.strategyId,
      status: outcome.status,
      correlation_id: args.correlationId,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

/**
 * CONTRIB-02 (Phase 110) — contribution CSV finalize. Calls the folded
 * `finalize_csv_strategy_with_returns` RPC on the user-scoped Supabase client
 * with p_terminal_status='private' (the owner-only terminal status, D-08),
 * then runs the SAME post-finalize side-effect fan-out the manager path runs
 * (metadata UPDATE, analytics enqueue). Since Phase 145 (D-06 option i-b)
 * the two handlers share ONE writer — this handler's direct-RPC shape was
 * the existence proof the fold's caller wiring copied — and diverge only in
 * the terminal status they pass.
 *
 * Why a direct RPC call is correct here (and needs no INTERNAL_API_TOKEN /
 * no JWT forwarding to Python): the route's `createClient()` is already
 * user-scoped (the SSR cookie session), so the SECURITY DEFINER RPC's
 * auth.uid() = p_user_id guard is satisfied natively. The fold RAISEs on any
 * p_terminal_status outside ('pending_review','private') — server-side
 * enforcement of the never-published invariant.
 *
 * There is NO publish-review notification on the CSV path to suppress (unlike
 * finalize-wizard's founder email) — the CSV route never notified. The analytics
 * enqueue is KEPT: a contribution is a real track record and the allocator needs
 * its daily series + KPIs in the composer (dailies are canonical).
 */
async function contributionCsvFinalizeHandler(args: {
  wizard_session_id: string;
  fmt: string;
  strategy_name: string;
  userId: string;
  metadataRaw: unknown;
  dailyReturnsSeries: CsvDailyReturnRow[];
  correlationId: string;
}): Promise<NextResponse> {
  const supabase = await createClient();

  // ONE write path (D-07): the fold writes strategy + verification + dailies
  // in a single transaction with p_terminal_status='private' passed VERBATIM
  // (D-08 — losing it would silently promote an owner-only draft into the
  // admin publish queue). Failure arms (fold-fail 5xx, 23505 resolve,
  // fail-closed 503) are shared with the manager path so the two cannot
  // drift.
  const outcome = await finalizeAtomicOrErrorResponse(
    supabase,
    {
      userId: args.userId,
      wizardSessionId: args.wizard_session_id,
      fmt: args.fmt,
      strategyName: args.strategy_name,
      rows: args.dailyReturnsSeries,
      terminalStatus: "private",
    },
    {
      logPrefix: "[strategies/csv-finalize contribution]",
      correlationId: args.correlationId,
    },
  );
  if (!outcome.ok) return outcome.response;

  // Identical post-finalize fan-out to the manager path (shared helpers, so
  // the two cannot drift): metadata UPDATE (AFTER the fold/resolve outcome —
  // Pitfall 6), analytics enqueue.
  const metaErrResponse = await applyCsvMetadataUpdate(
    supabase,
    outcome.strategyId,
    args.userId,
    args.metadataRaw,
    { correlationId: args.correlationId },
  );
  if (metaErrResponse) return metaErrResponse;

  if (args.dailyReturnsSeries.length > 0) {
    enqueueCsvAnalyticsAfter(outcome.strategyId, args.fmt, {
      logPrefix: "[strategies/csv-finalize contribution]",
      correlationId: args.correlationId,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      strategy_id: outcome.strategyId,
      // CONTRIB-02 — the ACTUAL terminal status: 'private' on a fresh create,
      // or the resolved row's own status on the 23505 echo path (echoed, not
      // fabricated).
      status: outcome.status,
      correlation_id: args.correlationId,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

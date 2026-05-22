import { NextRequest, NextResponse, after } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withAuth } from "@/lib/api/withAuth";
import { csvValidateLimiter, checkLimit } from "@/lib/ratelimit";
import { isUuid } from "@/lib/utils";
import { isUnifiedBackboneActive } from "@/lib/feature-flags";
import { postProcessKey } from "@/lib/process-key-client";
import { canonicalizeExchangeList } from "@/lib/constants";

/**
 * POST /api/strategies/csv-finalize — Phase 15 / CSV-01.
 *
 * Calls the SECURITY DEFINER `finalize_csv_strategy` RPC (migration 093)
 * which atomically inserts a strategies row + a strategy_verifications
 * row with status='pending_review' and trust_tier='csv_uploaded',
 * returning the new strategy_id.
 *
 * Phase 19 / BACKBONE-10
 * ----------------------
 * When `isUnifiedBackboneActive()` is true the route delegates to
 * `/process-key` with `flow_type=csv` (finalize step). The unified router
 * runs the same RPC server-side. The legacy direct-RPC path stays as the
 * flag=off fallback.
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

const ALLOWED_FMTS = new Set(["daily_returns", "daily_nav", "trades"]);
const MAX_NAME_CHARS = 80;

// Phase 19.1 — CSV → analytics pipeline. The wizard's csv-validate step
// canonicalises every supported `fmt` into a `daily_returns_series` array
// (NAV → pct_change for `daily_nav`; verbatim for `daily_returns`; absent
// for `trades`). We persist the series via the SECURITY DEFINER
// `persist_csv_daily_returns` RPC after the strategy row exists and
// enqueue `compute_analytics_from_csv` for the Python worker.
//
// All validation runs at the route boundary — `parseDailyReturnsSeries`
// is the single gate that protects the RPC from malformed input. The
// duplicate-date guard returns a clean 400 here so the UNIQUE
// (strategy_id, date) constraint inside the RPC never has to surface
// a 23505 to the user (PR #274 / T-19.1-04 mitigation).
const MAX_DAILY_RETURNS_ROWS = 5000;
const DAILY_RETURNS_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One row in the persisted CSV daily-returns series. Mirrors the JSONB
 * element shape that `persist_csv_daily_returns(p_rows JSONB)` consumes;
 * the RPC's body re-validates with `jsonb_typeof` etc., but the route's
 * parser is the load-bearing gate that turns malformed input into a
 * clean `400 CSV_INVALID_FORMAT` envelope instead of letting the RPC
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
    // T-19.1-04 / PR #274: surface a duplicate date as a route-boundary
    // 400 so the UNIQUE (strategy_id, date) constraint inside the RPC
    // never has to throw 23505. Defense-in-depth: the RPC's ON CONFLICT
    // upsert is idempotent, so even a guarded row slipping through
    // wouldn't 500 — but the user-visible envelope here is cleaner.
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
}

const MAX_DESCRIPTION_CHARS = 5000;
const MAX_CHIP_GROUP_SIZE = 32;
const MAX_LEVERAGE_RANGE_CHARS = 80;
// Mirrors audit-2026-05-07 H-0325/H-0326 in finalize-wizard. Anything
// north of 1e12 USD is garbage (a typo, scientific notation, or hostile
// client) — reject so the public sheet doesn't render absurd numbers.
const MAX_DOLLAR_VALUE = 1_000_000_000_000;
const MAX_MONEY_STRING_CHARS = 32;

function parseCsvMetadata(raw: unknown): CsvMetadataPayload | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const out: CsvMetadataPayload = {};
  if (typeof obj.description === "string") {
    out.description = obj.description.slice(0, MAX_DESCRIPTION_CHARS);
  }
  // /ship specialist review (api-contract): the column is UUID, the
  // wizard sends a UUID, but the route used to accept any string. A
  // typo would trigger Postgres 22P02 inside the metadata UPDATE which
  // we already swallow as non-fatal — the user would land a published
  // strategy whose category_id silently failed to persist, breaking
  // discovery. Validate at the route boundary so the field either
  // lands cleanly or is left out (better UX than a silent drop).
  if (obj.category_id === null) {
    out.category_id = null;
  } else if (typeof obj.category_id === "string" && isUuid(obj.category_id)) {
    out.category_id = obj.category_id;
  }
  // /ship specialist review (api-contract): mirror finalize-wizard's
  // canonicalizeExchangeList() call site. A stale wizard or hostile
  // client sending ["bybit", "Bybit"] used to persist verbatim and
  // re-introduce QA ISSUE-004 on the CSV path. The helper dedups
  // case-insensitively and snaps to the canonical EXCHANGES entry.
  for (const key of ["strategy_types", "subtypes", "markets"] as const) {
    const value = obj[key];
    if (Array.isArray(value)) {
      out[key] = value
        .filter((v): v is string => typeof v === "string")
        .slice(0, MAX_CHIP_GROUP_SIZE);
    }
  }
  if (Array.isArray(obj.supported_exchanges)) {
    const cleaned = obj.supported_exchanges
      .filter((v): v is string => typeof v === "string")
      .slice(0, MAX_CHIP_GROUP_SIZE);
    out.supported_exchanges = canonicalizeExchangeList(cleaned);
  }
  if (typeof obj.leverage_range === "string") {
    out.leverage_range = obj.leverage_range.slice(0, MAX_LEVERAGE_RANGE_CHARS);
  }
  if (typeof obj.aum === "string") {
    out.aum = obj.aum.slice(0, MAX_MONEY_STRING_CHARS);
  }
  if (typeof obj.max_capacity === "string") {
    out.max_capacity = obj.max_capacity.slice(0, MAX_MONEY_STRING_CHARS);
  }
  return out;
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  // /ship specialist review (api-contract): mirror finalize-wizard.
  // `Number("1e20")` is a finite number, but `1e20` USD is garbage —
  // either a typo or hostile input. Reject so the public sheet doesn't
  // render absurd values.
  if (n >= MAX_DOLLAR_VALUE) return null;
  return n;
}

/**
 * Build the UPDATE payload from a parsed metadata blob. Shared between
 * the legacy direct-RPC path and the unified-backbone path so the two
 * cannot drift. Returns an empty object if there's nothing to write,
 * so the caller can early-skip the UPDATE roundtrip.
 */
function buildMetadataUpdatePayload(
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
  const aumNum = parseMoney(metadata.aum);
  if (aumNum !== null) updatePayload.aum = aumNum;
  const capacityNum = parseMoney(metadata.max_capacity);
  if (capacityNum !== null) updatePayload.max_capacity = capacityNum;
  return updatePayload;
}

/**
 * Phase 19.1 specialist-review revision 2026-05-22 / Maintainability W-1:
 * shared helper for the persist_csv_daily_returns RPC call. Returns
 * `null` on success; returns the prepared 500 NextResponse on failure
 * (caller forwards verbatim). Used by BOTH the legacy direct-RPC path
 * and the unified-backbone path so the two cannot drift.
 *
 * The cast-through-unknown pattern is inlined here — `database.types.ts`
 * hasn't been regenerated for the new RPC, so a typed `.rpc()` call
 * would fail compilation. Centralising the cast in this helper means
 * there's exactly one place to delete when the types regeneration
 * lands (Phase 19.x cleanup TODO).
 */
async function persistDailyReturnsOrErrorResponse(
  supabase: SupabaseClient,
  userId: string,
  strategyId: string,
  rows: CsvDailyReturnRow[],
  opts: { logPrefix: string; correlationId: string },
): Promise<NextResponse | null> {
  if (rows.length === 0) return null;
  const { error: persistError } = await (
    supabase.rpc as unknown as (
      fn: "persist_csv_daily_returns",
      args: { p_user_id: string; p_strategy_id: string; p_rows: CsvDailyReturnRow[] },
    ) => Promise<{ data: number | null; error: { code?: string; message?: string } | null }>
  )("persist_csv_daily_returns", {
    p_user_id: userId,
    p_strategy_id: strategyId,
    p_rows: rows,
  });
  if (persistError) {
    console.error(
      `${opts.logPrefix} persist_csv_daily_returns error [correlation_id=${opts.correlationId}]:`,
      persistError.code,
      persistError.message,
    );
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_PERSIST_FAIL",
        human_message:
          "Your strategy was created but the daily-return data could not be saved. Contact support@quantalyze.com with your strategy id so we can recover.",
        debug_context: { strategy_id: strategyId },
        correlation_id: opts.correlationId,
      },
      { status: 500 },
    );
  }
  return null;
}

/**
 * Phase 19.1 specialist-review revision 2026-05-22 / Maintainability W-2:
 * shared helper for the `compute_analytics_from_csv` enqueue side-effect.
 * Wraps the `after()` callback so the legacy and unified paths schedule
 * the same code. Non-blocking — a failure logs but does NOT change the
 * response envelope.
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
 * finalize_csv_strategy + persist_csv_daily_returns RPCs run earlier in
 * this request. Mirrors finalize-wizard's enqueue (which evades the
 * gate only via incidental multi-line formatting). PR #275 hardening
 * justification preserved when this helper was extracted.
 */
function enqueueCsvAnalyticsAfter(
  strategyId: string,
  fmt: string,
  opts: { logPrefix: string; correlationId: string },
): void {
  after(async () => {
    if (process.env.USE_COMPUTE_JOBS_QUEUE !== "true") return;
    let enqueueFailed = false;
    let enqueueErrMessage = "";
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      // @audit-skip: see helper-level audit-skip block above.
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
      }
    } catch (err) {
      enqueueFailed = true;
      enqueueErrMessage = err instanceof Error ? err.message : String(err);
      console.warn(
        `${opts.logPrefix} enqueue side-effect threw (non-blocking) [correlation_id=${opts.correlationId}]: ${enqueueErrMessage}`,
      );
    }
    // API W-2: enqueue failure → write strategy_analytics placeholder so
    // the wizard's SyncProgress poller breaks out with a meaningful
    // error surface instead of polling forever. Best-effort: if even
    // the placeholder write fails, log so operators have evidence.
    if (enqueueFailed) {
      try {
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const admin = createAdminClient();
        const { error: placeholderErr } = await admin
          .from("strategy_analytics")
          .upsert(
            {
              strategy_id: strategyId,
              computation_status: "failed",
              computation_error: `compute job enqueue failed: ${enqueueErrMessage}`,
              data_quality_flags: { csv_source: true },
            },
            { onConflict: "strategy_id" },
          );
        if (placeholderErr) {
          console.warn(
            `${opts.logPrefix} strategy_analytics placeholder upsert failed (non-blocking) [correlation_id=${opts.correlationId}]: ${placeholderErr.message}`,
          );
        }
      } catch (placeholderThrow) {
        console.warn(
          `${opts.logPrefix} strategy_analytics placeholder upsert threw (non-blocking) [correlation_id=${opts.correlationId}]: ${placeholderThrow instanceof Error ? placeholderThrow.message : String(placeholderThrow)}`,
        );
      }
    }
  });
}

/**
 * QA ISSUE-010 + /ship specialist review: persist classification
 * metadata via an authenticated UPDATE after the SECURITY DEFINER RPC
 * (or unified router) returns. Gated by `.eq("user_id", user.id)` +
 * the strategies_update RLS policy. Non-fatal: a failure here logs
 * but does NOT 500 the response because the strategy row is already
 * persisted. (Pre-19.1-redteam this comment claimed a unique
 * constraint on wizard_session_id blocked retries; that index is
 * deferred to BACKBONE-07 per migration
 * 20260501055202_strategy_verifications.sql:27, so a naive retry
 * actually creates an additional orphan strategy. The metadata
 * UPDATE is still non-fatal because partial discovery metadata is
 * a better failure mode than rolling back a persisted strategy +
 * persisted daily returns + a leaked support-recovery surface.)
 * Shared between the legacy RPC path and the unified-backbone path
 * so the two stay in lockstep.
 */
async function applyCsvMetadataUpdate(
  supabase: SupabaseClient,
  strategyId: string,
  userId: string,
  metadataRaw: unknown,
): Promise<void> {
  const metadata = parseCsvMetadata(metadataRaw);
  const updatePayload = buildMetadataUpdatePayload(metadata);
  if (Object.keys(updatePayload).length === 0) return;
  // @audit-skip: continuation of the csv-wizard strategy creation
  // flow — finalize_csv_strategy created the row milliseconds ago
  // (SECURITY DEFINER, audit-skipped like create_wizard_strategy +
  // finalize-wizard). Matches ADR-0023 wizard-taxonomy gap +
  // audit-2026-05-07 P692. strategies_update RLS gates the write.
  const { error: updateError } = await supabase
    .from("strategies")
    .update(updatePayload)
    .eq("id", strategyId)
    .eq("user_id", userId);
  if (updateError) {
    console.error(
      "[strategies/csv-finalize] metadata update non-fatal error:",
      updateError.code,
      updateError.message,
    );
  }
}

export const POST = withAuth(async (req: NextRequest, user: User) => {
  // API W-1 / specialist-review revision 2026-05-22: generate the
  // correlation_id at request entry so every error/success envelope
  // emitted by this route can be traced through logs and across the
  // process-key upstream. The route's header still references
  // "OBSERV-06 will thread this later"; this change is the threaded
  // piece for csv-finalize specifically.
  const correlation_id = crypto.randomUUID();

  const rl = await checkLimit(
    csvValidateLimiter,
    `strategies-csv-finalize:${user.id}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_RATE_LIMIT",
        human_message: "Too many requests. Wait a minute and try again.",
        debug_context: {},
        correlation_id,
      },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

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
      { status: 400 },
    );
  }

  const {
    wizard_session_id,
    fmt,
    strategy_name,
    metadata: metadataRaw,
  } = body as Record<string, unknown>;

  if (typeof wizard_session_id !== "string" || !isUuid(wizard_session_id)) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: "wizard_session_id must be a valid UUID.",
        debug_context: {},
        correlation_id,
      },
      { status: 400 },
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
      { status: 400 },
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
      { status: 400 },
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
      { status: 400 },
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
      { status: 400 },
    );
  }
  if (strategy_name.length > MAX_NAME_CHARS) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: `strategy_name must be ${MAX_NAME_CHARS} characters or fewer.`,
        debug_context: { length: strategy_name.length },
        correlation_id,
      },
      { status: 400 },
    );
  }

  // WR-04 (19.1-REVIEW): reject empty daily_returns_series for the
  // return-series-bearing fmts BEFORE strategy creation. The legacy
  // path gates BOTH persist_csv_daily_returns AND the after()
  // compute_analytics_from_csv enqueue on dailyReturnsSeries.length
  // > 0. If a malformed-but-zod-passing payload lands `[]` (or omits
  // the field entirely → parseDailyReturnsSeries returns rows=[] per
  // its undefined/null branch) for fmt=daily_returns or fmt=daily_nav,
  // the strategy row would be created (status='pending_review') but
  // no series is persisted and no compute job is enqueued. The
  // wizard's SyncProgress poller then hangs indefinitely because
  // strategy_analytics has no row at all — no 'computing', no
  // 'complete', no 'failed' to break out on. Reject at the route
  // boundary so the strategy is never created in this half-baked
  // state. Placed AFTER strategy_name validation so existing tests
  // that test strategy_name in isolation (no series payload) still
  // see the more specific strategy_name error first.
  //
  // fmt='trades' currently produces no series (csv_validator.py:541-561)
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
      { status: 400 },
    );
  }

  // Phase 19 / BACKBONE-10 — gate behind unified-backbone flag.
  // QA ISSUE-010 follow-up (ship specialist review): the metadata UPDATE
  // applied below the RPC also needs to fire on the unified path, or the
  // first env that enables PROCESS_KEY_UNIFIED_BACKBONE silently re-
  // introduces the discovery-invisible CSV strategy bug. The handler
  // forwards metadataRaw + writes the same UPDATE after a successful
  // /process-key dispatch.
  if (await isUnifiedBackboneActive()) {
    return await unifiedCsvFinalizeHandler({
      wizard_session_id,
      fmt,
      strategy_name: trimmedName,
      userId: user.id,
      metadataRaw,
      dailyReturnsSeries,
      correlationId: correlation_id,
    });
  }

  const supabase = await createClient();
  // C-0155/C-0157: `finalize_csv_strategy` exists in DB (migration 093) but is
  // missing from the generated database.types.ts Functions union. Cast through
  // unknown to call it while we wait for the generated types to be regenerated.
  const { data: newStrategyId, error } = await (
    supabase.rpc as unknown as (
      fn: "finalize_csv_strategy",
      args: {
        p_user_id: string;
        p_wizard_session_id: string;
        p_fmt: string;
        p_strategy_name: string;
      },
    ) => Promise<{ data: string | null; error: { code?: string; message?: string } | null }>
  )("finalize_csv_strategy", {
    p_user_id: user.id,
    p_wizard_session_id: wizard_session_id,
    p_fmt: fmt,
    p_strategy_name: trimmedName,
  });

  if (error) {
    console.error(
      "[strategies/csv-finalize] RPC error:",
      error.code,
      error.message,
    );
    if (error.code === "42501") {
      return NextResponse.json(
        {
          ok: false,
          code: "CSV_FORBIDDEN",
          human_message: "Authentication mismatch — please sign in again.",
          debug_context: {},
          correlation_id,
        },
        { status: 401 },
      );
    }
    if (error.code === "22023") {
      return NextResponse.json(
        {
          ok: false,
          code: "CSV_INVALID_FORMAT",
          human_message: error.message ?? "Invalid request.",
          debug_context: { sqlstate: error.code },
          correlation_id,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_FINALIZE_FAIL",
        human_message:
          "Your file validated cleanly, but saving the strategy hit an error. Click Submit strategy again to retry — your data is unchanged.",
        debug_context: {},
        correlation_id,
      },
      { status: 500 },
    );
  }

  // QA ISSUE-010: persist classification metadata after the SECURITY
  // DEFINER RPC creates the row. Shared helper so the unified-backbone
  // path uses the same code path (and we don't drift).
  if (newStrategyId) {
    await applyCsvMetadataUpdate(supabase, newStrategyId, user.id, metadataRaw);
  }

  // Phase 19.1: persist the validated daily-return series via the
  // SECURITY DEFINER `persist_csv_daily_returns` RPC. Hard-fail on
  // error because:
  //   (a) the strategies row IS already created at this point —
  //       there is NO UNIQUE INDEX on wizard_session_id today
  //       (deferred to BACKBONE-07 / R4 per CONTEXT.md), so a client
  //       retry creates an additional orphan strategy rather than
  //       recovering the original.
  //   (b) without persisted series the worker permanently fails with
  //       "Insufficient CSV history" and the user has no recovery
  //       path.
  // A 500 with CSV_PERSIST_FAIL surfaces the orphan strategy_id so
  // support can clean it up. Until BACKBONE-07 lands, double-submits
  // are best-effort prevented client-side by the wizard's submit
  // button disable-on-click. Maintainability W-1 (specialist review
  // 2026-05-22): both paths route through
  // persistDailyReturnsOrErrorResponse so the cast-through-unknown is
  // centralised in one place. Phase 19.1 red-team revision 2026-05-22
  // / DOC C-1: rewrote the false "unique-claimed" rationale; see
  // migration 20260501055202_strategy_verifications.sql:27 for the
  // unique-index deferral.
  if (newStrategyId) {
    const persistFailResponse = await persistDailyReturnsOrErrorResponse(
      supabase,
      user.id,
      newStrategyId,
      dailyReturnsSeries,
      {
        logPrefix: "[strategies/csv-finalize]",
        correlationId: correlation_id,
      },
    );
    if (persistFailResponse) return persistFailResponse;
  }

  // Phase 19.1 / T-19.1-05 / PR #275: enqueue the analytics computation
  // for the freshly persisted series, gated by USE_COMPUTE_JOBS_QUEUE so
  // the legacy direct-compute path can keep working while the Python
  // worker is deployed. Non-blocking — failure here logs a warning but
  // never 500s the wizard. Mirrors finalize-wizard/route.ts:619-644.
  // Maintainability W-2 (specialist review 2026-05-22): both paths route
  // through enqueueCsvAnalyticsAfter so the after()-callback shape is
  // centralised.
  if (newStrategyId && dailyReturnsSeries.length > 0) {
    enqueueCsvAnalyticsAfter(newStrategyId, fmt, {
      logPrefix: "[strategies/csv-finalize]",
      correlationId: correlation_id,
    });
  }

  // API C-1 (specialist review 2026-05-22): emit `ok: true` discriminator
  // on the success envelope so consumers can use `body.ok` to branch
  // without status-code sniffing. Error envelopes already carry
  // `ok: false`; this closes the asymmetry. API W-1: correlation_id is
  // the UUID generated at request entry (see top of POST), now threaded
  // through every envelope on this route.
  return NextResponse.json({
    ok: true,
    strategy_id: newStrategyId,
    status: "pending_review",
    correlation_id,
  });
});

/**
 * Phase 19 / BACKBONE-01 unified path. Delegates to /process-key with
 * `flow_type=csv` (finalize step). The unified router runs
 * `finalize_csv_strategy` server-side and returns the new strategy_id +
 * status.
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
  // M-3: csv-finalize keeps a route-local INTERNAL_API_TOKEN check because
  // the 503 envelope must use CSV_FINALIZE_FAIL shape, not the generic
  // `{error: "Service unavailable"}` the shared helper returns.
  if (!process.env.INTERNAL_API_TOKEN) {
    console.error("[strategies/csv-finalize] INTERNAL_API_TOKEN not configured");
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_FINALIZE_FAIL",
        human_message: "Service unavailable.",
        debug_context: {},
        correlation_id: args.correlationId,
      },
      { status: 503 },
    );
  }

  const result = await postProcessKey({
    flow_type: "csv",
    source: "csv",
    context: {
      wizard_session_id: args.wizard_session_id,
      fmt: args.fmt,
      strategy_name: args.strategy_name,
      user_id: args.userId,
      step: "finalize",
    },
    routeTag: "strategies/csv-finalize",
    // CT-4 (army2) — forward tenant id for cross-tenant rate-limit isolation.
    userId: args.userId,
    // API W-1: forward our route-level correlation_id so the upstream
    // X-Correlation-Id header matches what the user-visible envelopes
    // carry. Without this, postProcessKey falls back to its own
    // getCorrelationId() lookup and the trail breaks at the route
    // boundary.
    correlationId: args.correlationId,
  });
  if (!result.ok) return result.response;
  // QA ISSUE-010 + /ship specialist review: apply the same metadata
  // UPDATE the legacy path does, so the unified-backbone path doesn't
  // silently lose classification data when the feature flag flips on.
  // The unified router returns the new strategy_id in result.body.
  //
  // Phase 19.1 red-team / API H-1 (2026-05-22): if the upstream
  // returns 200 with a missing or non-UUID `strategy_id` (Python
  // regression, API drift, accidental shape change), we MUST NOT
  // emit `ok: true` to the caller — the wizard's SyncProgress poller
  // would then hit `if (!data) return` early-out forever because no
  // strategy_analytics row exists for it to find. Surface 502
  // CSV_FINALIZE_FAIL so the wizard can retry / contact support
  // with the correlation_id.
  const unifiedBody = result.body as { strategy_id?: unknown };
  if (!isUuid(unifiedBody?.strategy_id)) {
    console.error(
      `[strategies/csv-finalize unified] missing/invalid strategy_id in upstream body [correlation_id=${args.correlationId}]:`,
      unifiedBody,
    );
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_FINALIZE_FAIL",
        human_message:
          "The unified backbone returned an unexpected response. Please retry.",
        debug_context: {
          unified_response_body: unifiedBody,
          missing_strategy_id: true,
        },
        correlation_id: args.correlationId,
      },
      { status: 502 },
    );
  }
  const newStrategyId: string = unifiedBody.strategy_id;
  const supabase = await createClient();
  await applyCsvMetadataUpdate(
    supabase,
    newStrategyId,
    args.userId,
    args.metadataRaw,
  );
  // Phase 19.1 / Maintainability W-1: shared helper for the persist
  // call so the legacy and unified paths cannot drift. Same
  // CSV_PERSIST_FAIL envelope, same hard-fail rationale.
  const persistFailResponse = await persistDailyReturnsOrErrorResponse(
    supabase,
    args.userId,
    newStrategyId,
    args.dailyReturnsSeries,
    {
      logPrefix: "[strategies/csv-finalize unified]",
      correlationId: args.correlationId,
    },
  );
  if (persistFailResponse) return persistFailResponse;

  // Phase 19.1 / T-19.1-05 / PR #275 + Maintainability W-2: shared
  // helper for the enqueue side-effect. Same non-blocking semantics.
  if (args.dailyReturnsSeries.length > 0) {
    enqueueCsvAnalyticsAfter(newStrategyId, args.fmt, {
      logPrefix: "[strategies/csv-finalize unified]",
      correlationId: args.correlationId,
    });
  }
  // API C-1 (specialist review 2026-05-22): emit `ok: true` discriminator
  // on the unified-path success envelope. The /process-key router may or
  // may not include `ok: true` in its body; merge defensively so we
  // never double-emit while still guaranteeing the field is present.
  // API W-1: correlation_id is the route-level UUID, not null.
  return NextResponse.json(
    {
      ok: true,
      ...(result.body as Record<string, unknown>),
      correlation_id: args.correlationId,
    },
    { status: result.status },
  );
}

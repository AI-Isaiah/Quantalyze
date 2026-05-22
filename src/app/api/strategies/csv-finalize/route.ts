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
 * Error envelope shape (v0): { ok: false, code, human_message,
 * debug_context, correlation_id: null }. Phase 16 / OBSERV-06 will
 * thread real correlation_id values through this route without
 * breaking the contract.
 */

const ALLOWED_FMTS = new Set(["daily_returns", "daily_nav", "trades"]);
const MAX_NAME_CHARS = 80;

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

// CSV → analytics pipeline Task 8.
const MAX_SERIES_ROWS = 5000;

interface CsvDailyReturnRow {
  date: string;
  daily_return: number;
}

function parseDailyReturnsSeries(
  raw: unknown,
): { ok: true; series: CsvDailyReturnRow[] } | { ok: false; message: string } {
  if (raw == null) return { ok: true, series: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, message: "daily_returns_series must be an array." };
  }
  if (raw.length > MAX_SERIES_ROWS) {
    return {
      ok: false,
      message: `daily_returns_series exceeds 5000 rows (got ${raw.length}).`,
    };
  }
  const out: CsvDailyReturnRow[] = [];
  const seenDates = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object") {
      return { ok: false, message: `daily_returns_series[${i}] must be an object.` };
    }
    const r = row as Record<string, unknown>;
    if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      return {
        ok: false,
        message: `daily_returns_series[${i}].date must be a YYYY-MM-DD string.`,
      };
    }
    if (typeof r.daily_return !== "number" || !Number.isFinite(r.daily_return)) {
      return {
        ok: false,
        message: `daily_returns_series[${i}].daily_return must be a finite number.`,
      };
    }
    // Surface duplicate dates as CSV_INVALID_FORMAT here rather than waiting
    // for the RPC's UNIQUE (strategy_id, date) constraint to throw 23505.
    if (seenDates.has(r.date)) {
      return {
        ok: false,
        message: `daily_returns_series[${i}].date is a duplicate of an earlier row (${r.date}).`,
      };
    }
    seenDates.add(r.date);
    out.push({ date: r.date, daily_return: r.daily_return });
  }
  return { ok: true, series: out };
}

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
 * QA ISSUE-010 + /ship specialist review: persist classification
 * metadata via an authenticated UPDATE after the SECURITY DEFINER RPC
 * (or unified router) returns. Gated by `.eq("user_id", user.id)` +
 * the strategies_update RLS policy. Non-fatal: a failure here logs
 * but does NOT 500 the response because the strategy row is already
 * persisted and the unique constraint on wizard_session_id will block
 * a naive retry. Shared between the legacy RPC path and the unified-
 * backbone path so the two stay in lockstep.
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
        correlation_id: null,
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
        correlation_id: null,
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
        correlation_id: null,
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
        correlation_id: null,
      },
      { status: 400 },
    );
  }

  const seriesParse = parseDailyReturnsSeries((body as Record<string, unknown>).daily_returns_series);
  if (!seriesParse.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: "CSV_INVALID_FORMAT",
        human_message: seriesParse.message,
        debug_context: {},
        correlation_id: null,
      },
      { status: 400 },
    );
  }
  const dailyReturnsSeries = seriesParse.series;

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
        correlation_id: null,
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
        correlation_id: null,
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
        correlation_id: null,
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
          correlation_id: null,
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
          correlation_id: null,
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
        correlation_id: null,
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

  // CSV → analytics pipeline Task 9: persist the daily-return series so
  // the worker can compute analytics from it. Hard-fail on error because:
  // (a) the strategy row IS created at this point, but without persisted
  // series the worker will fail permanently with "Insufficient CSV history"
  // and the user has no way to retry (wizard_session_id is unique-claimed
  // by finalize_csv_strategy). A 500 here surfaces a CSV_PERSIST_FAIL
  // envelope the user can see + contact support about.
  if (newStrategyId && dailyReturnsSeries.length > 0) {
    const { error: persistError } = await (
      supabase.rpc as unknown as (
        fn: "persist_csv_daily_returns",
        args: { p_user_id: string; p_strategy_id: string; p_rows: CsvDailyReturnRow[] },
      ) => Promise<{ data: number | null; error: { code?: string; message?: string } | null }>
    )("persist_csv_daily_returns", {
      p_user_id: user.id,
      p_strategy_id: newStrategyId,
      p_rows: dailyReturnsSeries,
    });
    if (persistError) {
      console.error(
        "[strategies/csv-finalize] persist_csv_daily_returns error:",
        persistError.code,
        persistError.message,
      );
      return NextResponse.json(
        {
          ok: false,
          code: "CSV_PERSIST_FAIL",
          human_message:
            "Your strategy was created but the daily-return data could not be saved. Contact support@quantalyze.com with your strategy id so we can recover.",
          debug_context: { strategy_id: newStrategyId },
          correlation_id: null,
        },
        { status: 500 },
      );
    }
  }

  // CSV → analytics pipeline Task 11: enqueue the analytics computation
  // for the freshly persisted series. Gated by USE_COMPUTE_JOBS_QUEUE so
  // the legacy direct-compute path can keep working while the worker is
  // deployed. Mirrors finalize-wizard/route.ts:619-644.
  if (newStrategyId && dailyReturnsSeries.length > 0) {
    after(async () => {
      if (process.env.USE_COMPUTE_JOBS_QUEUE !== "true") return;
      try {
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const admin = createAdminClient();
        // @audit-skip: compute_jobs enqueue is internal worker-state
        // scheduling, not a user-visible mutation. User intent is already
        // captured by the finalize_csv_strategy + persist_csv_daily_returns
        // RPCs above. Mirrors finalize-wizard's enqueue (which evades the
        // gate only via incidental multi-line formatting).
        const { error: enqueueErr } = await admin.rpc("enqueue_compute_job", {
          p_strategy_id: newStrategyId,
          p_kind: "compute_analytics_from_csv",
          p_metadata: { source: "csv-finalize", fmt },
        });
        if (enqueueErr) {
          console.warn(
            `[strategies/csv-finalize] enqueue_compute_analytics_from_csv failed (non-blocking): ${enqueueErr.message}`,
          );
        }
      } catch (err) {
        console.warn(
          `[strategies/csv-finalize] enqueue side-effect threw (non-blocking): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  return NextResponse.json({
    strategy_id: newStrategyId,
    status: "pending_review",
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
  dailyReturnsSeries: CsvDailyReturnRow[];
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
        correlation_id: null,
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
  });
  if (!result.ok) return result.response;
  // QA ISSUE-010 + /ship specialist review: apply the same metadata
  // UPDATE the legacy path does, so the unified-backbone path doesn't
  // silently lose classification data when the feature flag flips on.
  // The unified router returns the new strategy_id in result.body.
  const unifiedBody = result.body as { strategy_id?: unknown };
  if (typeof unifiedBody?.strategy_id === "string" && unifiedBody.strategy_id) {
    const supabase = await createClient();
    await applyCsvMetadataUpdate(
      supabase,
      unifiedBody.strategy_id,
      args.userId,
      args.metadataRaw,
    );
    // CSV → analytics pipeline Task 10: mirror the legacy-path persist so
    // a PROCESS_KEY_UNIFIED_BACKBONE=true flip cannot silently drop series
    // data. Same CSV_PERSIST_FAIL envelope, same hard-fail rationale.
    if (args.dailyReturnsSeries.length > 0) {
      const { error: persistError } = await (
        supabase.rpc as unknown as (
          fn: "persist_csv_daily_returns",
          args: { p_user_id: string; p_strategy_id: string; p_rows: CsvDailyReturnRow[] },
        ) => Promise<{ data: number | null; error: { code?: string; message?: string } | null }>
      )("persist_csv_daily_returns", {
        p_user_id: args.userId,
        p_strategy_id: unifiedBody.strategy_id,
        p_rows: args.dailyReturnsSeries,
      });
      if (persistError) {
        console.error(
          "[strategies/csv-finalize unified] persist_csv_daily_returns error:",
          persistError.code,
          persistError.message,
        );
        return NextResponse.json(
          {
            ok: false,
            code: "CSV_PERSIST_FAIL",
            human_message:
              "Your strategy was created but the daily-return data could not be saved. Contact support@quantalyze.com with your strategy id so we can recover.",
            debug_context: { strategy_id: unifiedBody.strategy_id },
            correlation_id: null,
          },
          { status: 500 },
        );
      }
    }
    // CSV → analytics pipeline Task 11 (unified path): same non-blocking
    // enqueue so the unified-backbone flip doesn't lose compute jobs.
    if (args.dailyReturnsSeries.length > 0) {
      const strategyIdForEnqueue = unifiedBody.strategy_id;
      after(async () => {
        if (process.env.USE_COMPUTE_JOBS_QUEUE !== "true") return;
        try {
          const { createAdminClient } = await import("@/lib/supabase/admin");
          const admin = createAdminClient();
          // @audit-skip: see legacy-path enqueue above; compute_jobs is
          // internal worker scheduling, not a user-visible mutation. User
          // intent is captured by the finalize + persist RPCs upstream.
          const { error: enqueueErr } = await admin.rpc("enqueue_compute_job", {
            p_strategy_id: strategyIdForEnqueue,
            p_kind: "compute_analytics_from_csv",
            p_metadata: { source: "csv-finalize", fmt: args.fmt },
          });
          if (enqueueErr) {
            console.warn(
              `[strategies/csv-finalize unified] enqueue_compute_analytics_from_csv failed (non-blocking): ${enqueueErr.message}`,
            );
          }
        } catch (err) {
          console.warn(
            `[strategies/csv-finalize unified] enqueue side-effect threw (non-blocking): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    }
  }
  return NextResponse.json(result.body);
}

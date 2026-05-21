import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { csvValidateLimiter, checkLimit } from "@/lib/ratelimit";
import { isUuid } from "@/lib/utils";
import { isUnifiedBackboneActive } from "@/lib/feature-flags";
import { postProcessKey } from "@/lib/process-key-client";

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

  const { wizard_session_id, fmt, strategy_name } = body as Record<string, unknown>;

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
  if (await isUnifiedBackboneActive()) {
    return await unifiedCsvFinalizeHandler({
      wizard_session_id,
      fmt,
      strategy_name: trimmedName,
      userId: user.id,
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
  return NextResponse.json(result.body);
}

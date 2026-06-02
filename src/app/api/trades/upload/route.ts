import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/withAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEventAsUser } from "@/lib/audit";
import { captureToSentry } from "@/lib/sentry-capture";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import type { User } from "@supabase/supabase-js";

/**
 * Allowed columns for a trade row. Everything else is stripped.
 * `strategy_id` and `user_id` are set server-side — never trust the client.
 */
const ALLOWED_TRADE_FIELDS = new Set([
  "timestamp",
  "symbol",
  "side",
  "price",
  "quantity",
  "fee",
  "order_type",
  "exchange",
]);

/**
 * Validate and sanitize a single trade row. Returns a clean object with only
 * whitelisted columns plus server-set `strategy_id` and `user_id`, or null
 * if the row is structurally invalid.
 */
function sanitizeTradeRow(
  row: unknown,
  strategyId: string,
  userId: string,
): Record<string, unknown> | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;

  const raw = row as Record<string, unknown>;

  // Reject rows that try to set strategy_id to a different strategy
  if ("strategy_id" in raw && raw.strategy_id !== strategyId) return null;

  const clean: Record<string, unknown> = {
    strategy_id: strategyId,
    user_id: userId,
  };

  for (const key of ALLOWED_TRADE_FIELDS) {
    if (key in raw && raw[key] !== undefined) {
      clean[key] = raw[key];
    }
  }

  // timestamp is required at minimum
  if (!clean.timestamp) return null;

  return clean;
}

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json();
  const { strategy_id, trades } = body;

  if (!strategy_id || !Array.isArray(trades) || trades.length === 0) {
    return NextResponse.json(
      { error: "Missing strategy_id or trades" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (trades.length > 5000) {
    return NextResponse.json(
      { error: "Maximum 5,000 trades per upload" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Verify user owns this strategy
  const supabase = createAdminClient();
  const { data: strategy } = await supabase
    .from("strategies")
    .select("id, user_id")
    .eq("id", strategy_id)
    .eq("user_id", user.id)
    .single();

  if (!strategy) {
    return NextResponse.json(
      { error: "Strategy not found or not owned by you" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  // Sanitize every row: whitelist columns, force strategy_id + user_id
  const sanitized: Record<string, unknown>[] = [];
  for (let i = 0; i < trades.length; i++) {
    const clean = sanitizeTradeRow(trades[i], strategy_id, user.id);
    if (!clean) {
      return NextResponse.json(
        { error: `Invalid trade at index ${i}: must be an object with at least a timestamp, and strategy_id must match` },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    sanitized.push(clean);
  }

  // Rate-limit AFTER all input validation (body parse, presence guard,
  // 5,000-row cap, per-row sanitize) so a malformed/invalid request that
  // gets rejected with 400 does NOT burn one of the caller's tokens. The
  // limiter still runs BEFORE the side-effecting batch inserts below.
  const rl = await checkLimit(userActionLimiter, `trades-upload:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  // Insert trades in batches using service-role client (bypasses RLS)
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < sanitized.length; i += batchSize) {
    const batch = sanitized.slice(i, i + batchSize);
    // @audit-skip: per-batch insert within a bulk user-upload flow.
    // Rolled up into a single trades.upload audit event after all
    // batches succeed — one event per upload, not per 500-row batch.
    const { error } = await supabase.from("trades").insert(batch);
    if (error) {
      // F5b (R8): the raw Postgres error.message can carry constraint /
      // column / schema detail — log + capture server-side and return a
      // static envelope. `inserted` is preserved so the client knows how
      // many rows landed before the failure.
      console.error(`[trades/upload] batch insert failed at row ${i}:`, error);
      captureToSentry(error, {
        tags: { route: "api/trades/upload" },
        extra: { batchStartRow: i, inserted },
      });
      return NextResponse.json(
        { error: "Failed to upload trades", inserted },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }
    inserted += batch.length;
  }

  // Sprint 6 Task 7.1b — one rollup audit event per upload call.
  // entity_id pins to the strategy the trades were uploaded against.
  // B4b: the trades INSERT above rides the service-role `supabase`
  // (createAdminClient) client, so the audit emits via the service path with
  // the explicit acting-user id (log_audit_event_service) — JWT-immune. This
  // also removes the throwaway user-JWT client that existed only to feed the
  // audit emit.
  logAuditEventAsUser(supabase, user.id, {
    action: "trades.upload",
    entity_type: "strategy",
    entity_id: strategy_id,
    metadata: { inserted, batches: Math.ceil(inserted / batchSize) },
  });

  return NextResponse.json(
    { inserted, strategy_id },
    { headers: NO_STORE_HEADERS },
  );
});

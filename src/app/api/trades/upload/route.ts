import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/withAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
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
  const rl = await checkLimit(userActionLimiter, `trades-upload:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = await req.json();
  const { strategy_id, trades } = body;

  if (!strategy_id || !Array.isArray(trades) || trades.length === 0) {
    return NextResponse.json({ error: "Missing strategy_id or trades" }, { status: 400 });
  }

  if (trades.length > 50000) {
    return NextResponse.json({ error: "Maximum 50,000 trades per upload" }, { status: 400 });
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
    return NextResponse.json({ error: "Strategy not found or not owned by you" }, { status: 403 });
  }

  // Sanitize every row: whitelist columns, force strategy_id + user_id
  const sanitized: Record<string, unknown>[] = [];
  for (let i = 0; i < trades.length; i++) {
    const clean = sanitizeTradeRow(trades[i], strategy_id, user.id);
    if (!clean) {
      return NextResponse.json(
        { error: `Invalid trade at index ${i}: must be an object with at least a timestamp, and strategy_id must match` },
        { status: 400 },
      );
    }
    sanitized.push(clean);
  }

  // Insert trades in batches using service-role client (bypasses RLS)
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < sanitized.length; i += batchSize) {
    const batch = sanitized.slice(i, i + batchSize);
    const { error } = await supabase.from("trades").insert(batch);
    if (error) {
      return NextResponse.json({
        error: `Insert failed at row ${i}: ${error.message}`,
        inserted,
      }, { status: 500 });
    }
    inserted += batch.length;
  }

  return NextResponse.json({ inserted, strategy_id });
});

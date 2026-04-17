import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { STRATEGY_NAMES } from "@/lib/constants";
import { notifyFounderNewStrategy, resolveManagerName } from "@/lib/email";
import { isUuid } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";

/**
 * POST /api/strategies/finalize-wizard — wizard SubmitStep endpoint.
 * Validates metadata, calls the SECURITY DEFINER
 * `finalize_wizard_strategy` RPC to promote the draft to
 * `pending_review`, and kicks off the admin notification email via
 * `after()`. Migration 031's guard trigger enforces that the RPC is
 * the only promotion path for wizard drafts.
 */

const STRATEGY_NAME_SET = new Set(STRATEGY_NAMES as readonly string[]);

function validateStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .slice(0, 20);
}

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const rl = await checkLimit(
    userActionLimiter,
    `strategies-finalize-wizard:${user.id}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const {
    strategy_id,
    name,
    description,
    category_id,
    strategy_types,
    subtypes,
    markets,
    supported_exchanges,
    leverage_range,
    aum,
    max_capacity,
  } = body as Record<string, unknown>;

  if (!isUuid(strategy_id)) {
    return NextResponse.json(
      { error: "strategy_id must be a valid UUID" },
      { status: 400 },
    );
  }

  if (typeof name !== "string" || !STRATEGY_NAME_SET.has(name)) {
    return NextResponse.json(
      { error: "name must be one of the allowed codenames" },
      { status: 400 },
    );
  }

  if (typeof description !== "string" || description.length < 10 || description.length > 5000) {
    return NextResponse.json(
      { error: "description must be 10-5000 characters" },
      { status: 400 },
    );
  }

  if (!isUuid(category_id)) {
    return NextResponse.json(
      { error: "category_id must be a valid UUID" },
      { status: 400 },
    );
  }

  const MAX_DOLLAR_VALUE = 1_000_000_000_000;
  const aumNum =
    typeof aum === "number" && Number.isFinite(aum) && aum >= 0 && aum < MAX_DOLLAR_VALUE
      ? aum
      : null;
  const maxCapacityNum =
    typeof max_capacity === "number" &&
    Number.isFinite(max_capacity) &&
    max_capacity >= 0 &&
    max_capacity < MAX_DOLLAR_VALUE
      ? max_capacity
      : null;

  const supabase = await createClient();
  const { data: finalizedId, error } = await supabase.rpc(
    "finalize_wizard_strategy",
    {
      p_strategy_id: strategy_id,
      p_user_id: user.id,
      p_name: name,
      p_description: description,
      p_category_id: category_id,
      p_strategy_types: validateStringArray(strategy_types),
      p_subtypes: validateStringArray(subtypes),
      p_markets: validateStringArray(markets),
      p_supported_exchanges: validateStringArray(supported_exchanges),
      p_leverage_range:
        typeof leverage_range === "string" && leverage_range.length > 0
          ? leverage_range
          : null,
      p_aum: aumNum,
      p_max_capacity: maxCapacityNum,
    },
  );

  if (error) {
    console.error(
      "[strategies/finalize-wizard] RPC error:",
      error.message,
      error.code,
    );
    if (error.code === "P0002" || error.code === "02000") {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    if (error.code === "42501" || error.code === "22023") {
      return NextResponse.json(
        { error: "This draft cannot be finalized" },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: "Could not finalize wizard draft" },
      { status: 500 },
    );
  }

  const resolvedId = typeof finalizedId === "string" ? finalizedId : strategy_id;

  // Both side effects are fire-and-forget: the row is already in
  // pending_review, so failures to notify or touch last_sync_at must
  // not block the response or reverse the finalize.
  after(async () => {
    const admin = createAdminClient();
    const [managerName, { data: keyLink }] = await Promise.all([
      resolveManagerName(admin, user),
      admin
        .from("strategies")
        .select("api_key_id")
        .eq("id", resolvedId)
        .single(),
    ]);

    const results = await Promise.allSettled([
      notifyFounderNewStrategy(name, managerName),
      // @audit-skip: denormalization timestamp. api_keys.last_sync_at
      // is a sync-state hint, not a user-visible state change. The
      // user-intent event for this flow is the finalize_wizard_strategy
      // RPC call that promoted the draft to pending_review (which is a
      // stored-procedure call, not a .insert/.update/.delete — not
      // reached by the grep test).
      keyLink?.api_key_id
        ? admin
            .from("api_keys")
            .update({ last_sync_at: new Date().toISOString() })
            .eq("id", keyLink.api_key_id)
        : Promise.resolve(),
    ]);
    for (const [i, r] of results.entries()) {
      if (r.status === "rejected") {
        console.warn(
          `[strategies/finalize-wizard] side effect ${i} failed (non-blocking):`,
          r.reason,
        );
      }
    }
  });

  return NextResponse.json({ strategy_id: resolvedId, status: "pending_review" });
});

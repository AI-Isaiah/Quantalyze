import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * /api/favorites — CRUD for the allocator's watchlist of strategies.
 *
 * Drives FavoriteStar (strategy detail page) + FavoritesPanel (My
 * Allocation). The allocator flips a strategy's star on or off; this
 * route writes to the user_favorites table, and RLS on that table
 * enforces that users can only modify their own rows (migration 024).
 *
 * POST { strategy_id }    → insert a favorite (409 if already favorited)
 * DELETE { strategy_id }  → remove a favorite (404 if not favorited)
 *
 * Auth: 401 if not logged in. All writes are scoped to the authed user —
 * body cannot override user_id. Server-enforced user identity is the
 * second gate behind RLS, which is the first gate.
 */

interface FavoritesBody {
  strategy_id?: unknown;
}

async function readBody(req: Request): Promise<FavoritesBody> {
  try {
    return (await req.json()) as FavoritesBody;
  } catch {
    return {};
  }
}

function parseStrategyId(body: FavoritesBody): string | null {
  if (typeof body.strategy_id !== "string") return null;
  const trimmed = body.strategy_id.trim();
  if (!trimmed) return null;
  return trimmed;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await readBody(req);
  const strategyId = parseStrategyId(body);
  if (!strategyId) {
    return NextResponse.json(
      { error: "strategy_id is required" },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("user_favorites")
    .insert({ user_id: user.id, strategy_id: strategyId });

  if (error) {
    // 23505 = unique_violation → already favorited. Return 200 (idempotent
    // success) so clients can POST blindly without checking first.
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, already: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await readBody(req);
  const strategyId = parseStrategyId(body);
  if (!strategyId) {
    return NextResponse.json(
      { error: "strategy_id is required" },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("user_favorites")
    .delete()
    .eq("user_id", user.id)
    .eq("strategy_id", strategyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

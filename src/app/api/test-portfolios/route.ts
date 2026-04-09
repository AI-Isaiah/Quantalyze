import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * /api/test-portfolios — create a saved hypothetical portfolio from the
 * Favorites panel's Save-as-Test flow.
 *
 * POST { name, description?, strategyIds[] }
 *   1. Auth required (401 otherwise)
 *   2. Validate input — name is required, strategyIds must be a
 *      non-empty array of strings
 *   3. Insert a row into portfolios with is_test = true. The partial
 *      unique index from migration 023 (portfolios_one_real_per_user)
 *      does NOT apply to is_test = true rows, so the allocator can have
 *      any number of saved test portfolios.
 *   4. Insert portfolio_strategies rows for each strategy in the save
 *      payload. Equal weights by default — the Favorites panel drives
 *      the "what combination to save" decision client-side, so the
 *      server just persists the selection. A follow-up PR wires the
 *      sleeve math into the persisted weights.
 *   5. Return the new portfolio id so the caller can link to its detail
 *      page.
 *
 * No analytics trigger: the existing hourly portfolio_analytics cron
 * picks up new rows automatically. The detail page handles the stale
 * fallback visual while analytics compute.
 */

interface SaveBody {
  name?: unknown;
  description?: unknown;
  strategyIds?: unknown;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 },
    );
  }
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;
  const strategyIds = Array.isArray(body.strategyIds)
    ? body.strategyIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : [];
  if (strategyIds.length === 0) {
    return NextResponse.json(
      { error: "strategyIds must be a non-empty array" },
      { status: 400 },
    );
  }

  // 1. Insert the test portfolio.
  const { data: portfolio, error: pfErr } = await supabase
    .from("portfolios")
    .insert({
      user_id: user.id,
      name,
      description,
      is_test: true,
    })
    .select("id")
    .single();

  if (pfErr || !portfolio) {
    return NextResponse.json(
      { error: pfErr?.message ?? "failed to create portfolio" },
      { status: 500 },
    );
  }

  // 2. Insert portfolio_strategies rows. Equal weights — the server is
  // a thin persistence layer; the Favorites panel is what picks the
  // combination to save.
  const equalWeight = 1 / strategyIds.length;
  const nowIso = new Date().toISOString();
  const psRows = strategyIds.map((strategyId) => ({
    portfolio_id: portfolio.id,
    strategy_id: strategyId,
    added_at: nowIso,
    allocated_at: nowIso,
    current_weight: equalWeight,
    relationship_status: "connected" as const,
    founder_notes: [],
  }));

  const { error: psErr } = await supabase
    .from("portfolio_strategies")
    .insert(psRows);

  if (psErr) {
    // Best-effort rollback: delete the portfolio we just inserted so the
    // user doesn't end up with an orphaned empty row in Test Portfolios.
    await supabase.from("portfolios").delete().eq("id", portfolio.id);
    return NextResponse.json(
      { error: `failed to attach strategies: ${psErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: portfolio.id });
}

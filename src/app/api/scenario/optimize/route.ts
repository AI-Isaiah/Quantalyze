import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { assertProfileApproved } from "@/lib/api/approval-gate";
import {
  optimizeScenarioWeights,
  AnalyticsTimeoutError,
  AnalyticsUpstreamError,
} from "@/lib/analytics-client";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";

/**
 * Phase 28 (OPT-01/02) — suggest long-only scenario weights.
 *
 * STATELESS: the body carries the draft-scoped strategies' own daily-return
 * series (already in the allocator's browser); we forward them to the Python
 * optimizer and return the suggested weights. No DB read, no cross-tenant
 * surface — the only gate is "a logged-in, approved user" (so the CPU endpoint
 * isn't open to anonymous abuse) plus a per-user rate limit and payload caps.
 * The suggested weights write to the editable DRAFT client-side only; this route
 * never persists anything.
 */

// Defensive payload caps (the composer caps strategy count far lower; these
// bound a hand-crafted request so it can't hand the optimizer an unbounded job).
const MAX_STRATEGIES = 50;
const MAX_POINTS_PER_SERIES = 6000; // ~24 years of trading days
const OBJECTIVES = new Set(["min_vol", "max_sharpe"]);

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const denied = await assertProfileApproved(supabase, user.id);
  if (denied) return denied;

  let body: {
    series?: Record<string, Array<{ date?: unknown; value?: unknown }>>;
    objective?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const objective = body.objective ?? "min_vol";
  if (typeof objective !== "string" || !OBJECTIVES.has(objective)) {
    return NextResponse.json(
      { error: "objective must be 'min_vol' or 'max_sharpe'" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const series = body.series;
  if (series === null || typeof series !== "object" || Array.isArray(series)) {
    return NextResponse.json(
      { error: "series must be an object of { strategyId: [{date, value}] }" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const ids = Object.keys(series);
  if (ids.length === 0 || ids.length > MAX_STRATEGIES) {
    return NextResponse.json(
      { error: `series must contain 1..${MAX_STRATEGIES} strategies` },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  // Validate + normalize each point at the trust boundary — a non-finite value
  // or a wrong shape must be a 400 here, never silently forwarded to the solver.
  const clean: Record<string, Array<{ date: string; value: number }>> = {};
  for (const id of ids) {
    const pts = series[id];
    if (!Array.isArray(pts) || pts.length > MAX_POINTS_PER_SERIES) {
      return NextResponse.json(
        { error: `series['${id}'] must be an array of <= ${MAX_POINTS_PER_SERIES} points` },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const normalized: Array<{ date: string; value: number }> = [];
    for (const p of pts) {
      if (
        p === null ||
        typeof p !== "object" ||
        typeof p.date !== "string" ||
        typeof p.value !== "number" ||
        !Number.isFinite(p.value)
      ) {
        return NextResponse.json(
          { error: `series['${id}'] has a malformed point (need { date: string, value: finite number })` },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      normalized.push({ date: p.date, value: p.value });
    }
    clean[id] = normalized;
  }

  // Limiter AFTER validation (B15 ordering) so a malformed request doesn't burn
  // one of the caller's own tokens.
  const rl = await checkLimit(userActionLimiter, `scenario-optimize:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many optimize requests. Try again shortly." },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const result = await optimizeScenarioWeights(clean, objective as "min_vol" | "max_sharpe");
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    if (err instanceof AnalyticsTimeoutError) {
      return NextResponse.json(
        { error: "The optimizer timed out. Try again shortly." },
        { status: 504, headers: NO_STORE_HEADERS },
      );
    }
    if (err instanceof AnalyticsUpstreamError) {
      // Never echo the raw upstream detail (schema/internal leak) — log it, return a clean message.
      console.error("[scenario/optimize] upstream error", { status: err.status });
      return NextResponse.json(
        { error: "The optimizer is unavailable right now." },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }
    console.error("[scenario/optimize] unexpected error", err);
    return NextResponse.json(
      { error: "Could not compute suggested weights." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

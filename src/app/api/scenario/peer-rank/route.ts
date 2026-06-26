import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { assertProfileApproved } from "@/lib/api/approval-gate";
import {
  scenarioPeerLimiter,
  checkLimit,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import type { PeerPercentilePayload } from "@/lib/factsheet/types";

/**
 * Phase 42 (PEER-03) — POST /api/scenario/peer-rank.
 *
 * Flow (a) (ADR-0025 / 42-RESEARCH §"Server-Fetch Design"): the composer posts
 * its hypothetical blend's three SAMPLE-basis ranking metrics (sharpe/sortino/
 * maxDD) + the blend's observation count n. The route reads the verified-cohort
 * RANK via the get_verified_cohort_rank SECURITY DEFINER RPC and returns ONLY
 * `{ peer: PeerPercentilePayload | null }`. The cohort DISTRIBUTION never crosses
 * the network — the only DB call returns four aggregate scalars (cohort_n + 3
 * percentiles); the per-strategy metric values / ids / names stay inside the
 * RPC body. Cross-tenant leakage is therefore structurally impossible: the only
 * thing on the wire is the rank of the caller's OWN hypothetical against an
 * aggregate.
 *
 * Security boundary (mirrors the preferences-route pattern):
 *   assertSameOrigin (CSRF) → auth.getUser (401) → assertProfileApproved (403)
 *   → body validation (400, no raw DB error) → checkLimit (429 / 503 fail-CLOSED)
 *   → RPC → structured 500 on error. EVERY response carries NO_STORE_HEADERS
 *   (the rank is per-request, never cacheable; a shared cache would leak it
 *   cross-tenant).
 *
 * The route-layer rate-limit (scenarioPeerLimiter) is a LOAD-BEARING probe-
 * resistance control: paired with the RPC's decile-quantization it caps an
 * authed allocator binary-searching an individual peer's metric across repeated
 * rank probes (42-RESEARCH §"Probe-resistance"; ratelimit.ts comment).
 */

// The min-N floor the RPC enforces (mirrors v_min_n in migration 20260626120000).
// Below it the RPC returns the honest cohort_n with NULL percentiles; the route
// maps that NULL-rank row to { peer: null }. Kept as a documented constant; the
// route never branches on it directly (a NULL sharpe_pct is the authoritative
// "suppressed" signal), but it names the contract for the reader.
const MIN_COHORT_N = 20;

/** The RPC's RETURNS TABLE row (migration 20260626120000): four aggregate
 *  scalars and nothing else. pct columns are NULL below the min-N floor. */
type CohortRankRow = {
  cohort_n: number;
  sharpe_pct: number | null;
  sortino_pct: number | null;
  max_dd_pct: number | null;
};

/** The get_verified_cohort_rank RPC parameter bag. p_max_dd is the MAGNITUDE
 *  (abs) of the blend's max_dd; max_drawdown is stored negative. */
type CohortRankArgs = {
  p_sharpe: number;
  p_sortino: number;
  p_max_dd: number;
};

/** The validated request body — the blend's three sample-basis ranking metrics
 *  plus its observation count. All four must be finite numbers. */
type PeerRankBody = {
  sharpe: number;
  sortino: number;
  maxDD: number;
  n: number;
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Parse + validate the body at the trust boundary. Returns the typed body or
 *  a structured 400 NextResponse (never a raw DB / parser error). */
function parseBody(parsed: unknown): PeerRankBody | NextResponse {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const b = parsed as Record<string, unknown>;
  if (
    !isFiniteNumber(b.sharpe) ||
    !isFiniteNumber(b.sortino) ||
    !isFiniteNumber(b.maxDD) ||
    !isFiniteNumber(b.n)
  ) {
    return NextResponse.json(
      { error: "sharpe, sortino, maxDD, and n must all be finite numbers" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  return { sharpe: b.sharpe, sortino: b.sortino, maxDD: b.maxDD, n: b.n };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // (1) CSRF — mutating POST must present an allowed Origin/Referer.
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  // (2) Auth — a logged-in user is required.
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

  // (3) Approval gate — peer-rank is an allocator surface; a pending-approval
  //     user (or a curl-style hit that bypassed the page redirect) is denied.
  const denied = await assertProfileApproved(supabase, user.id);
  if (denied) return denied;

  // (4) Body parse + validate BEFORE the limiter (so a malformed request never
  //     burns one of the caller's own rate-limit tokens — B15 ordering).
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const validated = parseBody(parsed);
  if (validated instanceof NextResponse) return validated;

  // (5) Rate-limit — a LOAD-BEARING probe-resistance control (see header). A
  //     misconfigured limiter in production fails CLOSED → 503 so the outage
  //     surfaces to canary/health rather than masquerading as throttling.
  const rl = await checkLimit(scenarioPeerLimiter, `scenario-peer:${user.id}`);
  if (!rl.success) {
    if (isRateLimitMisconfigured(rl)) {
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
      );
    }
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
    );
  }

  // (6) The cohort rank. p_max_dd is the MAGNITUDE (abs) of the blend's max_dd —
  //     max_drawdown is stored negative and the RPC compares on magnitude
  //     (queries.ts getPercentiles convention; migration 20260626120000 header).
  //
  //     The cast-through-unknown pattern (csv-finalize / scenario/share/route.ts
  //     precedent): `database.types.ts` has NOT been regenerated for
  //     get_verified_cohort_rank yet (the type regen is orchestrator-owned,
  //     post-apply — see 42-01-SUMMARY), so a typed `.rpc()` literal call would
  //     fail compilation. Centralise the cast here and delete it when the types
  //     regeneration lands. The RPC's RETURNS TABLE resolves to a row array.
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: "get_verified_cohort_rank",
      args: CohortRankArgs,
    ) => Promise<{ data: CohortRankRow[] | null; error: { code?: string; message?: string } | null }>
  )("get_verified_cohort_rank", {
    p_sharpe: validated.sharpe,
    p_sortino: validated.sortino,
    p_max_dd: Math.abs(validated.maxDD),
  });

  // (7) Structured 500 on RPC error — the raw DB message is database-author-
  //     controlled and may carry internals (function/relation names); log the
  //     code for ops, return a constant message to the client (preferences
  //     :205-277 / optimize :135-141 no-leak discipline).
  if (error) {
    const code = (error as { code?: string | null })?.code ?? null;
    console.error("[api/scenario/peer-rank] get_verified_cohort_rank RPC error:", { code });
    return NextResponse.json(
      { error: "Failed to compute peer rank" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  // (8) Map the RPC row → { peer }. RETURNS TABLE resolves to an array; read the
  //     single row. Below the min-N floor (or no cohort at all) the RPC returns
  //     a NULL-rank row → { peer: null }. The cohort distribution is NEVER read
  //     here — only the four aggregate scalars the RPC projects.
  const rows = data ?? [];
  const row = rows[0];

  // No row, or the suppressed/NULL-rank shape (cohort_n < MIN_COHORT_N → NULL
  // percentiles): honest-empty. Reading sharpe_pct as the authoritative
  // suppression signal also belt-and-suspenders against a partial/NULL pct.
  if (
    !row ||
    row.sharpe_pct === null ||
    row.sortino_pct === null ||
    row.max_dd_pct === null ||
    row.cohort_n < MIN_COHORT_N
  ) {
    return NextResponse.json({ peer: null }, { headers: NO_STORE_HEADERS });
  }

  // Full rank — exactly the four PeerPercentilePayload fields, nothing else.
  const peer: PeerPercentilePayload = {
    cohortSize: row.cohort_n,
    sharpe: row.sharpe_pct,
    sortino: row.sortino_pct,
    max_dd: row.max_dd_pct,
  };
  return NextResponse.json({ peer }, { headers: NO_STORE_HEADERS });
}

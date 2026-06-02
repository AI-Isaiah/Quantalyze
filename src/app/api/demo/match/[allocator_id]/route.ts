import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAllocatorMatchPayload,
  type AllocatorMatchPayload,
} from "@/lib/admin/match";
import { ALLOCATOR_ACTIVE_ID } from "@/lib/demo";
import {
  publicIpLimiter,
  checkLimit,
  getClientIp,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";

// GET /api/demo/match/[allocator_id]
//
// PUBLIC demo endpoint — no auth. This mirrors /api/admin/match/[allocator_id]
// but is HARD-LOCKED to the ALLOCATOR_ACTIVE seed UUID so a forwarded demo
// link cannot be pointed at a real allocator's match queue.
//
// Used by /demo/founder-view which renders AllocatorMatchQueue with
// forceReadOnly=true and sourceApiPath="/api/demo/match".
//
// Audit-2026-05-07 hardening:
//   - C-0081 (red-team c7): added publicIpLimiter (10/min/IP). The route
//     fires 7 service-role Supabase queries per request via
//     getAllocatorMatchPayload; an unauth attacker could exhaust the
//     Supabase service-role quota without it, DoS'ing both demo and
//     production. The Cache-Control:s-maxage=10 absorbs friendly burst
//     traffic; the rate limiter caps the worst case.
//   - C-0084 / C-0085 (security c7 / red-team c7): server-side mask of
//     disclosure_tier='exploratory' rows. The route's strategies join
//     selects raw name + user_id + aum + max_capacity; the React
//     `displayStrategyName()` helper masked these in the UI, but a curl
//     of /api/demo/match | jq exfils them raw. Mask BEFORE the response
//     is built so the demo lane never emits exploratory PII.

/**
 * Mask exploratory-tier strategy rows so the public lane never emits
 * PII-equivalent fields. Rules (matching the displayStrategyName()
 * helper used in AllocatorMatchQueue):
 *   - disclosure_tier !== 'exploratory' → emit unchanged.
 *   - disclosure_tier === 'exploratory' AND codename present →
 *     emit unchanged (the manager has explicitly opted into a
 *     pseudonym).
 *   - disclosure_tier === 'exploratory' AND codename absent → strip
 *     `name`, `user_id`, `aum`, `max_capacity` from the strategies
 *     join AND `total_aum` from the analytics join.
 *
 * The stripped fields are replaced with `null` so the downstream UI
 * doesn't have to special-case missing keys.
 */
const EXPLORATORY_MASKED_STRATEGY_FIELDS = [
  "name",
  "user_id",
  "aum",
  "max_capacity",
] as const;

/**
 * Audit-2026-05-07 red-team R6 (HIGH c8): `getAllocatorMatchPayload`
 * enriches every candidate with an `analytics` object that carries
 * `total_aum` alongside `sharpe`, `sortino`, `cagr`, etc. The pre-
 * red-team mask scrubbed `aum` + `max_capacity` from the strategies
 * join but missed `analytics.total_aum` — same exfil class as C-0085.
 * Mask the AUM-equivalent fields on analytics too. Performance ratios
 * (sharpe/sortino/cagr/volatility/drawdown) are kept: they don't
 * identify the strategy by capacity, only by track-record shape.
 */
const EXPLORATORY_MASKED_ANALYTICS_FIELDS = ["total_aum"] as const;

function shouldMaskExploratory(s: Record<string, unknown>): boolean {
  if (s.disclosure_tier !== "exploratory") return false;
  const codename = s.codename;
  return !(typeof codename === "string" && codename.length > 0);
}

function maskStrategiesNode(
  strategies: unknown,
): Record<string, unknown> | null {
  if (!strategies || typeof strategies !== "object") {
    return (strategies as Record<string, unknown> | null) ?? null;
  }
  const s = strategies as Record<string, unknown>;
  if (!shouldMaskExploratory(s)) return s;
  const masked: Record<string, unknown> = { ...s };
  for (const field of EXPLORATORY_MASKED_STRATEGY_FIELDS) {
    if (field in masked) {
      masked[field] = null;
    }
  }
  // Stable placeholder so the UI's `name || 'Unnamed strategy'`
  // fallback renders a recognisable label.
  if ("name" in masked) {
    const id = typeof masked.id === "string" ? masked.id.slice(0, 8) : "anon";
    masked.name = `Exploratory #${id}`;
  }
  return masked;
}

function maskAnalyticsNode(
  analytics: unknown,
  parentStrategies: Record<string, unknown> | null,
): unknown {
  if (!analytics || typeof analytics !== "object") return analytics;
  if (!parentStrategies) return analytics;
  if (!shouldMaskExploratory(parentStrategies)) return analytics;
  const a = analytics as Record<string, unknown>;
  const masked: Record<string, unknown> = { ...a };
  for (const field of EXPLORATORY_MASKED_ANALYTICS_FIELDS) {
    if (field in masked) {
      masked[field] = null;
    }
  }
  return masked;
}

function maskCandidateRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  // Read the parent strategies node FIRST so the masked-or-not decision
  // is consistent across the strategies + analytics children.
  const parentStrategies =
    row.strategies && typeof row.strategies === "object"
      ? (row.strategies as Record<string, unknown>)
      : null;
  const strategies = maskStrategiesNode(row.strategies);
  const analytics = maskAnalyticsNode(row.analytics, parentStrategies);
  return { ...row, strategies, analytics };
}

/**
 * Audit-2026-05-07 red-team R-0001 (HIGH c8): allocator-side mask gap.
 *
 * C-0084/C-0085 closed the MANAGER-side leak (strategy name/user_id/aum
 * + analytics.total_aum on exploratory rows). The symmetric ALLOCATOR-
 * side surface was missed: `match_decisions.founder_note` (allocator's
 * private commentary on a strategy), `allocator_preferences.founder_notes`
 * + `scoring_weight_overrides`, `match_batches.effective_preferences`,
 * and `existing_contact_requests[].strategy_id` (full strategy-by-
 * strategy contact history with timestamps).
 *
 * Today these fields are only "safe" because the route is hard-locked to
 * the seed ALLOCATOR_ACTIVE_ID. A future PR flipping the seed to a real
 * allocator, or allowing admin demo with real notes, instantly leaks
 * allocator-side PII through the public demo lane. Mask defensively at
 * the route boundary so the seed-locked invariant is not load-bearing.
 *
 * Decisions also still need the strategies-node mask the candidates +
 * excluded rows already get (the existing maskCandidateRow path), so
 * the helper is shared.
 */
const ALLOCATOR_MASKED_PREFERENCE_FIELDS = [
  "founder_notes",
  "scoring_weight_overrides",
] as const;
const ALLOCATOR_MASKED_BATCH_FIELDS = ["effective_preferences"] as const;

function maskDecisionRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  // First apply the strategies/analytics mask used for candidates +
  // excluded (decisions also carry a strategies join).
  const base = maskCandidateRow(row);
  // Then zero out the allocator-side founder_note (private commentary).
  if ("founder_note" in base) {
    base.founder_note = null;
  }
  return base;
}

function maskPreferencesNode(
  preferences: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!preferences) return preferences;
  const masked: Record<string, unknown> = { ...preferences };
  for (const field of ALLOCATOR_MASKED_PREFERENCE_FIELDS) {
    if (field in masked) {
      masked[field] = null;
    }
  }
  return masked;
}

function maskBatchNode(
  batch: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!batch) return batch;
  const masked: Record<string, unknown> = { ...batch };
  for (const field of ALLOCATOR_MASKED_BATCH_FIELDS) {
    if (field in masked) {
      masked[field] = null;
    }
  }
  return masked;
}

function maskExistingContactRequestRow(row: {
  strategy_id: string;
  created_at: string;
  status: string;
}): { strategy_id: string; created_at: string; status: string } {
  // The strategy_id is the load-bearing leak (a per-row history of which
  // strategies the seed allocator has engaged with, timestamped). Replace
  // with the same `Exploratory #<8-hex>` placeholder used by the strategies
  // node so consuming UIs that key on strategy_id can still group rows by
  // pseudonym without exfiltrating the real id.
  const id =
    typeof row.strategy_id === "string" ? row.strategy_id.slice(0, 8) : "anon";
  return {
    strategy_id: `exploratory-${id}`,
    created_at: row.created_at,
    status: row.status,
  };
}

function maskPayload(
  payload: AllocatorMatchPayload,
): AllocatorMatchPayload {
  return {
    ...payload,
    preferences: maskPreferencesNode(payload.preferences),
    batch: maskBatchNode(payload.batch),
    candidates: payload.candidates.map(maskCandidateRow),
    excluded: payload.excluded.map(maskCandidateRow),
    decisions: payload.decisions.map(maskDecisionRow),
    existing_contact_requests: payload.existing_contact_requests.map(
      maskExistingContactRequestRow,
    ),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ allocator_id: string }> },
): Promise<NextResponse> {
  const { allocator_id } = await params;

  // Hard assert: only the seeded Active Allocator is readable from this route.
  // Any other UUID (including admin-visible ones) gets a 403 to avoid exposing
  // real allocator state through the public demo lane.
  if (allocator_id !== ALLOCATOR_ACTIVE_ID) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Audit-2026-05-07 C-0081 (red-team c7): publicIpLimiter (10/min/IP)
  // gates the 7-query service-role fan-out. Pre-fix the unauth route
  // had no rate limit and the Cache-Control:s-maxage=10 only covers
  // route+seed-UUID (which is constant), not per-IP request rate. Cache
  // works against burst; limiter works against scripted abuse. IP
  // bucketing uses the shared `getClientIp` helper so the parser stays
  // consistent across rate-limit surfaces.
  const rl = await checkLimit(
    publicIpLimiter,
    `demo-match:${getClientIp(req.headers)}`,
  );
  if (!rl.success) {
    if (isRateLimitMisconfigured(rl)) {
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        {
          status: 503,
          headers: { "Retry-After": String(rl.retryAfter) },
        },
      );
    }
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const admin = createAdminClient();

  try {
    const payload = await getAllocatorMatchPayload(admin, allocator_id);
    // C-0084 / C-0085 mask BEFORE building the response. Exploratory
    // rows without an explicit codename get name / user_id / aum /
    // max_capacity replaced with null (+ a stable placeholder name).
    const maskedPayload = maskPayload(payload);
    const res = NextResponse.json(maskedPayload);
    // Audit-2026-05-07 P335: CDN-cache for 10s with 60s SWR. The route is
    // hard-locked to ALLOCATOR_ACTIVE_ID, so the response is a constant
    // function of (route, seed UUID, db state). Caching at the edge for
    // 10 seconds absorbs viral / burst traffic without keeping a stale
    // snapshot around long enough to mislead the next reviewer. `Vary:
    // Cookie` is defensive — the route doesn't currently personalize on
    // cookies, but if a future PR threads any session state through, the
    // CDN must key on it instead of serving the same response to all
    // visitors.
    res.headers.set("Cache-Control", "public, s-maxage=10, stale-while-revalidate=60");
    res.headers.set("Vary", "Cookie");
    return res;
  } catch (err) {
    // The demo route is hard-locked to the seed ALLOCATOR_ACTIVE_ID, whose
    // profile is provisioned by scripts/seed-full-app-demo.ts — a MANUAL seed
    // not run in every environment (notably prod). When that seed profile is
    // absent, getAllocatorMatchPayload's only `.single()` (the profiles fetch)
    // raises PostgREST PGRST116 ("0 rows"). For the AUTH'd admin route a missing
    // allocator IS a real error (it 500s by design). But for this PUBLIC demo a
    // 500 on an unprovisioned fixture is a trust-collapse signal for a known,
    // expected condition — degrade to a clean, empty queue (200) that
    // AllocatorMatchQueue renders as "No candidates yet". Any genuine error
    // (schema drift, network, any non-PGRST116) still 500s below.
    //
    // Coupling: this relies on `profiles` being the ONLY `.single()` in
    // getAllocatorMatchPayload (a matching note lives there). If a second
    // `.single()` is added, PGRST116 stops uniquely meaning "demo profile
    // absent" and this must become an explicit profile-existence pre-check.
    if (isUnprovisionedSeedProfile(err)) {
      const empty: AllocatorMatchPayload = {
        profile: null,
        preferences: null,
        batch: null,
        candidates: [],
        excluded: [],
        decisions: [],
        existing_contact_requests: [],
      };
      const res = NextResponse.json(empty);
      res.headers.set(
        "Cache-Control",
        "public, s-maxage=10, stale-while-revalidate=60",
      );
      res.headers.set("Vary", "Cookie");
      return res;
    }
    console.error("[api/demo/match/[allocator_id]] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * PostgREST raises `PGRST116` when a `.single()` matches zero rows. The only
 * `.single()` in getAllocatorMatchPayload is the seed allocator's `profiles`
 * fetch, so this uniquely signals "the demo fixture isn't provisioned in this
 * environment" — distinct from a genuine query/network error.
 */
function isUnprovisionedSeedProfile(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "PGRST116"
  );
}

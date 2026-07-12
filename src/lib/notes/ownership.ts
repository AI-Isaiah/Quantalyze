import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { parseHoldingScopeRef } from "./scope-ref";

/**
 * Per-scope ownership check for `/api/notes` PATCH (Phase 08 D-09).
 *
 * Each of the four scopes has a distinct validity predicate, so this
 * check is app-layer rather than a SECURITY DEFINER RPC (RESEARCH.md
 * §Pattern 1 / §Alternatives Considered). RLS on `user_notes` still
 * enforces owner-only at the DB layer; this function validates that the
 * caller is allowed to address the target scope_ref at all.
 *
 * Scopes:
 *   - portfolio       → portfolios.user_id = caller (row must exist)
 *   - holding         → at least one allocator_holdings row matches
 *                       (allocator_id=caller, venue, symbol, holding_type)
 *                       parsed from scope_ref
 *   - bridge_outcome  → bridge_outcomes.allocator_id = caller (row must exist)
 *   - strategy        → strategies row exists with status='published'
 *                       (any allocator may note any published strategy —
 *                       "all verified strategies are publicly notable")
 *   - dashboard       → the allocator's whole-book note (Phase 100 PI-04).
 *                       scope_ref is the fixed literal 'allocations'; there is
 *                       no per-row target to own, so validity is trivially the
 *                       authed user with a well-formed scope_ref. RLS
 *                       (user_id = auth.uid()) carries the real owner gate.
 *
 * Returns `{ok:false}` on any mismatch. The route returns 403 with a
 * generic "Forbidden" (D-09 — no reason leak to the client). The `reason`
 * field is diagnostic-only.
 */

export type ScopeKind =
  | "portfolio"
  | "holding"
  | "bridge_outcome"
  | "strategy"
  | "dashboard";

export interface OwnershipCheckResult {
  ok: boolean;
  /** Diagnostic only — never surfaced to the HTTP caller. */
  reason?: string;
}

export async function checkScopeOwnership(
  supabase: SupabaseClient,
  userId: string,
  scope_kind: ScopeKind,
  scope_ref: string,
): Promise<OwnershipCheckResult> {
  switch (scope_kind) {
    case "portfolio": {
      const { data } = await supabase
        .from("portfolios")
        .select("id")
        .eq("id", scope_ref)
        .eq("user_id", userId)
        .maybeSingle();
      return data ? { ok: true } : { ok: false, reason: "portfolio not owned" };
    }
    case "holding": {
      const parsed = parseHoldingScopeRef(scope_ref);
      if (!parsed) return { ok: false, reason: "malformed scope_ref" };
      // At least one row must exist matching the venue/symbol/type + owner.
      // No asof filter — the note is aggregate across daily snapshots.
      const { data } = await supabase
        .from("allocator_holdings")
        .select("id")
        .eq("allocator_id", userId)
        .eq("venue", parsed.venue)
        .eq("symbol", parsed.symbol)
        .eq("holding_type", parsed.holding_type)
        .limit(1)
        .maybeSingle();
      return data ? { ok: true } : { ok: false, reason: "no matching holding" };
    }
    case "bridge_outcome": {
      const { data } = await supabase
        .from("bridge_outcomes")
        .select("id")
        .eq("id", scope_ref)
        .eq("allocator_id", userId)
        .maybeSingle();
      return data ? { ok: true } : { ok: false, reason: "outcome not owned" };
    }
    case "strategy": {
      // All published strategies are publicly notable (D-09).
      // The `.eq("status","published")` filter is load-bearing — Research
      // Finding #3 locks strategies as the identity table (match_strategies
      // / verified_strategies do not exist), and route tests 10-11 assert
      // the filter is applied via a spy on the mock query chain (V1).
      //
      // B10 sanctioned-exception: NOT routed through withPublishedOnly. This
      // is the strategy arm of the specialised 4-scope checkScopeOwnership
      // notability gate, not a public-fetcher in the visibility-sweep class;
      // route tests 10-11 spy on the literal `.eq` call here. Kept inline.
      const { data } = await supabase
        .from("strategies")
        .select("id")
        .eq("id", scope_ref)
        .eq("status", "published")
        .maybeSingle();
      return data ? { ok: true } : { ok: false, reason: "strategy not published" };
    }
    case "dashboard": {
      // Phase 100 PI-04: the allocator's whole-book note. scope_ref is the
      // fixed literal 'allocations' — there is no per-row target to own, so the
      // only validity check is the well-formed scope_ref. The DB-layer owner
      // gate is RLS (user_id = auth.uid()).
      return scope_ref === "allocations"
        ? { ok: true }
        : { ok: false, reason: "invalid dashboard scope_ref" };
    }
  }
}

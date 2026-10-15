/**
 * The `onConflict` target of `POST /api/bridge/outcome`'s `bridge_outcomes`
 * upsert, kept in one place so the route and the live-DB test send the SAME
 * string (a Next route file may not export names other than its handlers, so
 * the constant cannot live in `route.ts`).
 *
 * Phase 164.9.3.1 D-09: the target must name an EXISTING unique index. Since
 * migration 081 replaced 072's per-strategy unique with
 * `bridge_outcomes_allocator_match_decision_unique`, no unique index covers
 * `(allocator_id, strategy_id)`, and PostgreSQL rejects an ON CONFLICT target
 * that matches none with SQLSTATE 42P10.
 */
export const BRIDGE_OUTCOME_CONFLICT_TARGET = "allocator_id,match_decision_id";

/**
 * The `hint` of the 42501 that `bridge_outcomes_sync_holding_ref` raises when an
 * outcome row names a `match_decisions` row that belongs to ANOTHER allocator
 * (migration 20261024120000, round-2 RLS audit). The trigger is SECURITY DEFINER
 * and would otherwise copy that decision's holding ref into the caller's row.
 * 42501 alone is not specific enough (RLS raises it too), so the route keys on the
 * code AND this hint. A unit test pins the literal against the migration text.
 */
export const BRIDGE_OUTCOME_CROSS_ALLOCATOR_HINT = "cross_allocator_decision";

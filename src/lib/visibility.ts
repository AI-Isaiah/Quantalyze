/**
 * B10 — Tenant / Visibility Predicate boundary.
 *
 * The audit found one defect shape repeated across the codebase: a
 * tenant/visibility predicate enforced at one layer (RLS, a sibling
 * fetcher, an in-memory filter) but MISSING at the wrapping query the
 * audit identifies as defence-in-depth — so two surfaces disagree on what
 * is "live", and a future RLS widening leaks every draft's full payload
 * through the unguarded path alone (NEW-C03-03 / NEW-C38-01 et al.).
 *
 * `withPublishedOnly` is the ONE place the "published-only" predicate lives,
 * so a future strategy fetcher cannot silently forget it. The B25 lint
 * capstone bans a raw `.eq("status","published")` on a `strategies` query
 * and points offenders here, making the predicate enforced by construction.
 * (Marker for that rule: `B10 visibility:`.)
 *
 * This module is intentionally PURE — it imports nothing server-only
 * (no `next/headers`, no `@/lib/supabase/server`) — so the predicate is
 * usable from React Server Components, route handlers, AND `"use client"`
 * components (the MigrationWizard strategy search) on the same helper.
 *
 * ── Deliberately NOT in this module (evidence-driven scope, Rule 2/7) ──
 *
 *   - `assertPortfolioOwnership` (the portfolio ownership ASSERTION): stays
 *     in `queries.ts`. It issues a server-side DB probe via `createClient()`
 *     (which pulls `next/headers`); hosting it here would taint this module
 *     for client use and defeat the universality above. It is already a
 *     single, well-named, unit-tested gate there (portfolio-ownership-gate
 *     .test.ts) used by 5 routes — moving it buys nominal cohesion at the
 *     cost of the client-safety this module exists to provide.
 *
 *   - `withPublishedOrOwner` (published OR own-draft): OMITTED. The recon
 *     census found ZERO consumers — every published fetcher is
 *     unconditionally public (owner draft-preview happens on the owner
 *     dashboard via a different, ownership-scoped path, NOT on a
 *     published-OR-owner discovery query). A consumer-less helper would
 *     violate Rule 2 (mirrors B4c's removed `auditEvent()` and B20's
 *     rejected God-hook). When a genuine owner-inclusive discovery surface
 *     is first written, add it here then — a 3-line extension:
 *       `q.or(`status.eq.published,user_id.eq.${authUserId}`)`.
 *
 *   - `checkScopeOwnership` (`src/lib/notes/ownership.ts`): a specialised
 *     4-scope (portfolio/holding/bridge_outcome/strategy) checker whose
 *     strategy arm has its own load-bearing, test-pinned published gate.
 *     Distinct shape — stays where it is.
 *
 *   - The `send-intro` route's strategy lookup: a fetch-THEN-validate gate
 *     that intentionally reads the row regardless of status so it can
 *     return DISTINCT errors (`strategy_not_found` vs `strategy_not_published`
 *     vs `strategy_no_manager`, NEW-C34-01/02). A published query predicate
 *     would collapse those errors — left as-is.
 *
 *   - RLS-scoped reads (`.eq("user_id", userId)` on a user's own
 *     portfolios / keys / favourites): RLS already enforces these; the
 *     inline predicate is a transparent scope filter, not an ownership
 *     ASSERTION. Routing them through a helper adds no by-construction
 *     safety and is byte-fragile.
 */

/**
 * Append the `status = 'published'` visibility predicate to a `strategies`
 * query, returning the same builder so the chain continues fluently:
 *
 *   const { data } = await withPublishedOnly(
 *     supabase.from("strategies").select("*").eq("id", id),
 *   ).single();
 *
 * Defence-in-depth: the `strategies_read` RLS policy is
 * `status = 'published' OR user_id = auth.uid()`, so without this predicate
 * an authenticated owner's own draft/pending_review rows leak through any
 * public/discovery fetcher. This helper makes "published-only" explicit and
 * un-forgettable rather than a literal copied across ~20 call sites.
 */
export function withPublishedOnly<Q>(query: Q): Q {
  // Internal structural cast: every PostgrestFilterBuilder exposes `.eq`
  // returning the same builder, so the predicate appends and the caller's
  // exact query type — and every downstream `.order()` / `.limit()` /
  // `.single()` — is preserved. We use a plain `Q` (not a self-referential
  // `Q extends { eq(...): Q }` bound) because that bound tips TS into
  // "excessively deep" instantiation (TS2589) on heavier builder types such
  // as the service-role client's wide row unions.
  return (query as { eq(column: "status", value: "published"): Q }).eq(
    "status",
    "published",
  );
}

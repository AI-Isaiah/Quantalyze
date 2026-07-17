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
 *   - `withPublishedOrOwner` (published OR own-draft): now REALIZED below.
 *     Originally OMITTED — the recon census found ZERO consumers, and a
 *     consumer-less helper would have violated Rule 2. Phase 110 / CONTRIB-03
 *     wrote the first genuine owner-inclusive discovery surface (GET
 *     /api/strategies/browse), which is exactly the "add it here then"
 *     condition this note anticipated, so the pre-documented 3-line extension
 *     now lives here. Its predicate mirrors the `strategies_read` RLS shape
 *     (`published OR user_id=eq`) per locked decision D; the owner id is
 *     session-only (from withAllocatorAuth), never a client-supplied param.
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

/**
 * Append the OWNER-INCLUSIVE visibility predicate — `status = 'published' OR
 * user_id = <authUserId>` — to a `strategies` query, returning the same builder
 * so the chain continues fluently:
 *
 *   const { data } = await withPublishedOrOwner(
 *     supabase.from("strategies").select("*"),
 *     user.id,
 *   ).order("name");
 *
 * This mirrors the `strategies_read` RLS policy EXACTLY (`status = 'published'
 * OR user_id = auth.uid()`, locked decision D), so on a genuine owner-inclusive
 * discovery surface the caller sees their OWN not-yet-published rows plus every
 * published row, while another caller sees only published rows.
 *
 * First (and only) consumer: GET /api/strategies/browse (Phase 110 /
 * CONTRIB-03). `authUserId` MUST come from the authenticated session
 * (`withAllocatorAuth`), NEVER a request/query/body param — a caller who could
 * name another owner would read that owner's private rows (T-110-05/07).
 *
 * Defence-in-depth: RLS remains the backstop; this query-builder predicate is
 * the isolation layer that mirrors it. The `no-owner-or-on-admin-client` lint
 * rule (CONTRIB-04) bans a raw owner-OR `.or(...user_id.eq...)` anywhere outside
 * THIS file (exempted via the `B10 visibility:` marker), so a future admin /
 * service-role client swap cannot silently drop the RLS backstop and leak every
 * user's drafts (Pitfall 4).
 */
export function withPublishedOrOwner<Q>(query: Q, authUserId: string): Q {
  // Same structural-cast style as withPublishedOnly: every
  // PostgrestFilterBuilder exposes `.or(filter)` returning the same builder, so
  // the predicate appends and the caller's exact query type — plus every
  // downstream `.order()` / `.limit()` / `.single()` — is preserved. We use a
  // plain `Q` (not a self-referential `Q extends { or(...): Q }` bound) to dodge
  // the TS2589 "excessively deep" instantiation on wide builder unions.
  return (query as { or(filter: string): Q }).or(
    `status.eq.published,user_id.eq.${authUserId}`,
  );
}

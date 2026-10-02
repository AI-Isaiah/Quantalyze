---
phase: 32-dead-link-fix-route-retirement
reviewed: 2026-06-23T20:30:00Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - src/components/portfolio/AddToPortfolio.tsx
  - src/components/portfolio/AddToPortfolio.test.tsx
  - src/app/(dashboard)/portfolios/[id]/manage/page.tsx
  - src/app/(dashboard)/portfolios/[id]/page.tsx
  - src/app/(dashboard)/scenarios/page.tsx
  - src/app/(dashboard)/scenarios/page.test.ts
  - src/app/(dashboard)/scenarios/page.role-gate.test.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/layout/Sidebar.test.tsx
  - src/components/scenarios/ScenarioBuilder.tsx
  - src/components/scenarios/ScenarioBuilder.honesty.test.tsx
  - src/__tests__/phase-32-frozen-spine-guards.test.ts
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
status: clean
---

# Phase 32: Code Review Report

**Reviewed:** 2026-06-23T20:30:00Z
**Depth:** deep (standard + cross-file)
**Files Reviewed:** 14
**Status:** clean

## Summary

Phase 32 retires the `/scenarios` Strategy-Sandbox surface into the unified composer, fixes the 2 portfolio-context dead links, and deletes `ScenarioBuilder` + its honesty test. I reviewed this adversarially with the explicit goal of finding the bug the tests and plan-checker missed. After tracing the auto-attach React execution, the cross-tenant insert path, the redirect, every deletion's dangling-reference surface, the IMPACT-02 coverage migration, the Sidebar nav-count edit, and the new guard's non-vacuity, I found **no Critical or Warning defects**. The implementation is genuinely surgical and the subtle auto-attach behavior is correct.

The 8 focus areas resolve as follows:

1. **Surgical dead-link scope — CLEAN.** The post-change tree carries `?portfolio=` on exactly the 2 portfolio-context links (`manage/page.tsx:56`, `[id]/page.tsx:92`). The 28 intentional default-landing/admin/auth/error/breadcrumb `/discovery/crypto-sma` refs are byte-identical (verified: only the 2 portfolios-tree lines moved to the `?portfolio=` form; `proxy.ts`, `page.tsx` root, all `admin/*`, `error.tsx`, `not-found.tsx`, `LoginForm`, `OnboardingWizard`, `MobileNav`, breadcrumbs untouched). The guard's `BARE_RE` content gate enforces this permanently.

2. **AddToPortfolio auto-attach — CORRECT (the subtlest change, scrutinized hardest).** The auto-attach is gated behind `if (!open) return;`, so it fires only when the user clicks "Portfolio" to open the dropdown — there is **no silent insert on page load**. The user's open-click IS the gesture; the auto-attach replaces the in-dropdown portfolio pick, and the dropdown shows the "Added!" feedback. (a) Re-mount/back-nav: `autoAttachedRef` resets to `false` per mount, so opening the dropdown after a fresh navigation can re-fire — but `portfolio_strategies` has `PRIMARY KEY (portfolio_id, strategy_id)` (`20260405061911_initial_schema.sql:142`), so the duplicate raises `23505` → handled as "Already in portfolio". The operation is **idempotent at the DB level** and reversible via `RemoveStrategyButton`. (b) The ref guard correctly prevents a double-insert / re-fire on dropdown re-open within a mount (verified by trace: second open runs the effect but `autoAttachedRef.current === true` short-circuits). (c) No race: the auto-attach runs *inside* `fetchPortfolios` after `owned` resolves and `setPortfolios(owned)` is called, so the param-match always sees the resolved owned set. (d) Not a surprising side effect — opening the dropdown is an explicit user action and feedback is shown. (e) The 23505 path is intact. `handleAdd` is a hoisted `function` declaration, so the effect referencing it before its textual definition has no TDZ issue.

3. **Cross-tenant safety (T-32-01) — PROVEN.** The only insert is `handleAdd(defaultPortfolioId)`, reached **only** when `owned.some((p) => p.id === defaultPortfolioId)` is true. `owned` is the RLS-scoped `.eq("user_id", user.id)` fetch. There is no code path where the raw `?portfolio` param feeds the insert without first matching the owned set. An unowned id is a silent no-op. The non-vacuous unowned-id test pins this.

4. **Redirect (FLOW-02) — CORRECT.** `redirect("/allocations?tab=scenario")` from `next/navigation` (307, not `permanentRedirect`/308; not a `next.config` redirect). Target is a hardcoded internal path → no open-redirect. The deleted `createAdminClient()` institutional-universe read was the only consumer of that work; removing it eliminates the C-0017 leak vector. The redirect target retains its own auth via the dashboard layout/page guards.

5. **Deletions — NO dangling refs.** No live import of `ScenarioBuilder` remains (only JSDoc/comment/test-narrative mentions). `EquityCurveChart`/`MetricCard` were file-private functions inside the deleted file (confirmed) — knip flags no new orphans. `href="/scenarios"` no longer appears in any rendered component. The deleted `page.role-gate.test.ts` (admin-read gate) is correctly replaced by `page.test.ts` (redirect assertion) — no coverage is lost, because the gated code path itself was deleted (you cannot lose coverage of code that no longer exists; this is coverage-positive).

6. **IMPACT-02 parity — GENUINE superset.** `ScenarioComposer.test.tsx:2997-3004` asserts `percentile-rank-badge` absent + a non-vacuous isolated positive control — line-for-line the deleted honesty test's IMPACT-02 pattern, run *with* the Phase-30 blend panels mounted (strictly stronger). The PROJECTED-badge, neutral-pill styling, coverage-caveat, and CORR-03 assertions all have composer analogs (per RESEARCH.md line-by-line table). The only dropped unique assertion is `sandbox-example-universe-badge`, which is intrinsic to the retired example-universe surface (the own-book composer is not an example universe); its honesty signal now lives as the per-row `is_example` tag in the Browse drawer.

7. **Sidebar — CORRECT.** Manager `/portfolios` nav item kept. The nav-count test was *adjusted, not just deleted*: the 6-`it` Sandbox RBAC describe block was rewritten to assert absence across all role flavors (allocator/manager/admin/dual/none) — preserving the non-vacuous "no role resurrects the item" coverage. `BeakerIcon` (the only consumer) was deleted with its sole call site. 29 Sidebar tests pass.

8. **Phase-32 guard — SOUND and non-vacuous.** Reads live source from disk (not snapshots), resolves a real git baseline with fail-loud-on-unresolvable (Rule 12), and each content gate has a self-pin proving the regex still discriminates (`ATTACH_BACK_RE` matches the param form and rejects the bare slug; `BARE_RE` matches both bare quote/backtick forms and rejects the param form). No false-negative hole found in the `?portfolio=` / no-bare-slug / no-`/scenarios` / no-`createAdminClient` / no-`ScenarioBuilder` regexes.

All 12 phase-32 tests pass; 29 Sidebar tests pass; knip reports no new orphans.

The 3 Info items below are pre-existing stale comments and one defensible-but-noteworthy framework nuance. None block.

## Info

### IN-01: Stale JSDoc comments still claim what-if "lives on /scenarios"

**Files:**
- `src/app/(dashboard)/portfolios/page.tsx:15`
- `src/lib/queries.ts:1412`
- `src/lib/intro/snapshot.ts:50`
- `src/components/portfolio/CreatePortfolioForm.tsx:18`
- `src/app/api/strategies/[id]/returns/route.ts:29`

**Issue:** After this phase, `/scenarios` is a 307 redirect, not the what-if surface. These JSDoc/comment references to "`/scenarios`" as the live what-if exploration surface are now stale. RESEARCH.md (lines 374-375) flagged the `portfolios/page.tsx` and `returns/route.ts` comments as cosmetic-but-stale. They are non-load-bearing (comments only — no runtime reference, no dead route), and intentionally left out of the surgical scope. The phase-32 guard correctly does NOT assert on these (it only forbids `href="/scenarios"` in rendered components and `/scenarios` in `Sidebar.tsx`).

**Fix:** Low priority. Update the comments to point at `/allocations?tab=scenario` in a future docs/cleanup pass (e.g. `portfolios/page.tsx:15` → "...their what-if exploration lives at /allocations?tab=scenario"). Do not expand the phase-32 surgical diff to chase these.

### IN-02: `useSearchParams()` CSR-bailout — moot here but worth noting

**File:** `src/components/portfolio/AddToPortfolio.tsx:5,25`

**Issue:** Next.js 16 requires a Suspense boundary around any client component that calls `useSearchParams()` when the route is **statically prerendered** (otherwise the whole route opts into client-side rendering / build warns). The mount site `discovery/[slug]/[strategyId]/page.tsx` has no explicit `<Suspense>` around `<AddToPortfolio>`.

**Why it does not block:** The discovery segment is `force-dynamic` (`discovery/layout.tsx:9`), so the route is never statically prerendered and the CSR-bailout requirement does not apply. The build is clean. This is a latent constraint only if the discovery tree ever drops `force-dynamic`.

**Fix:** None required. If `force-dynamic` is ever removed from the discovery layout, wrap `<AddToPortfolio>` (or its detail-page action bar) in a `<Suspense fallback={...}>` boundary.

### IN-03: Auto-attach does not surface the attached portfolio's name in feedback

**File:** `src/components/portfolio/AddToPortfolio.tsx:60,95`

**Issue:** When `?portfolio=<owned>` matches, the auto-attach shows the generic "Added!" feedback (same as a manual click). The user came from a *specific* portfolio's "+ Add Strategy" link; the feedback does not name which portfolio received the strategy. This is a minor UX/clarity nit, not a correctness bug — the insert targets the correct (matched, owned) portfolio, and the strategy is visible on return to that portfolio's page.

**Fix:** Optional polish. Could set feedback to ``Added to ${owned.find(p => p.id === defaultPortfolioId)?.name}`` on the auto-attach path. Out of scope for a surgical dead-link fix; note for a future UX pass.

---

_Reviewed: 2026-06-23T20:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

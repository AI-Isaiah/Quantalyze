# Phase 13 — Independent Peer Review (Fresh-Context Claude)

**Reviewer:** Claude Opus 4.7 (1M ctx), no prior conversation state
**Date:** 2026-04-28
**Files reviewed:** 13-CONTEXT.md, 13-RESEARCH.md, 13-UI-SPEC.md, 13-VALIDATION.md, TODOS.md, 13-01/02/04/05-PLAN.md
**Source files cross-checked:** StrategyTable.tsx, StrategyFilters.tsx, Sparkline.tsx, queries.ts, withAuth.ts, 024_user_favorites.sql, playwright.config.ts, seed-demo-data.ts, e2e/helpers/seed-test-project.ts

---

## Summary

The plans are tightly written and codebase-grounded — RLS, route patterns, Next 16 awaited params, ASVS dispositions, and the migration-numbering rebase are all well-handled. The in-house checker did good work. However, there are **three real BLOCKERs** that the checker missed: (1) the e2e visual-regression spec is statistically unlikely to ever exercise a negative sparkline given current seed fixtures (all 8 seed strategies have positive expected returns), making the regression gate effectively a no-op; (2) Plan 13-02 Task 3 swaps `useDiscoveryPrefs` from required-uid to optional-uid via a "retroactive" hook signature change inside an execution task — this is a Rule-3 deviation dressed as Rule-1; and (3) Plan 13-05 Task 3's e2e helper API contract is mismatched (`seedAllocator` / `cleanupTestAllocator` vs the actual exports `seedTestAllocator` / `cleanupTestAllocator`).

## Verdict

**APPROVE-WITH-REVISIONS** — three blockers must be fixed before execution. The phase shape is right; the implementation contracts have crisp grep-verifiable acceptance criteria; the threat model is honest. None of the blockers require re-planning, only surgical edits to the affected plan files.

---

## Blockers (must fix)

### B1. [Test coverage] Sparkline visual-regression spec doesn't actually regress against the rule it claims to enforce

**Refs:** `13-04-PLAN.md:228-292` (e2e spec scaffold), `13-04-PLAN.md:402-403` ("8 seeded strategies with mixed-sign sparkline_returns"), `scripts/seed-demo-data.ts:111-209` (STRATEGY_PROFILES).

**Evidence:** All 8 seed `STRATEGY_PROFILES` have `annualizedReturn` between `0.11` and `0.28` — every single one is positive. The sparkline series is a deterministic mulberry32-PRNG cumulative-product walk anchored on a positive daily mean; there is no realistic case where the **final** value of any of the 8 fixtures lands negative. Plan 13-04 Task 2 explicitly claims "mulberry32 PRNG seeded fixtures will produce both positive and negative final values across the 8 strategies" — that's wrong. With a 0.11–0.28 annualized drift, the final cumulative is virtually always positive.

**Why it matters:** the e2e spec asserts "no SVG mixes #16A34A and #DC2626 strokes". If every sparkline in production is colored `#1B6B5A` (accent), the spec passes trivially even if a future change mis-wires the sign rule for the negative branch — because the negative branch is never exercised. This is a dead regression gate, indistinguishable from no gate at all.

The unit test in `sparkline-color.test.ts` does cover all three branches with synthetic fixtures — that part is fine. The DOM-walk e2e is the load-bearing visual contract, and it doesn't load-bear.

**Fix proposal:** Add to Plan 13-04 Task 1 (or as a separate Task) a small synthetic-fixture component test that mounts `<StrategyTable strategies={[mixedFixture]}>` with three rows whose `sparkline_returns` end positive / negative / zero — assert the rendered SVG strokes match the rule via DOM. The e2e DOM walk should additionally assert "at least one SVG stroke is `var(--color-accent)` AND at least one stroke is `var(--color-negative)` (drawdown SVG counts)". Today drawdown is the only guaranteed negative stroke; the spec should at least assert the drawdown invariant explicitly so a future "remove drawdown column" doesn't silently neuter the regression gate.

Alternative (simpler): add a 9th seed fixture to `STRATEGY_PROFILES` with `annualizedReturn: -0.05` so the e2e spec sees a real negative final-value sparkline in production. This is out-of-phase scope creep though — prefer the synthetic-component-test approach.

---

### B2. [Cross-plan contracts] `useDiscoveryPrefs` hook signature is destabilized inside Task 3 of Plan 13-02

**Refs:** `13-02-PLAN.md:328-358` (Task 2 ships `(uid: string, slug: string)`), `13-02-PLAN.md:692-708` (Task 3 retroactively rewrites to `(uid: string | undefined, slug: string)` with an `enabled` gate).

**Evidence:** Task 2 ships:
```typescript
export function useDiscoveryPrefs(uid: string, slug: string) { ... }
```
Then Task 3 — same plan, after Task 2's tests are GREEN — modifies the same file:
```typescript
export function useDiscoveryPrefs(uid: string | undefined, slug: string) { ... }
```
adding an `enabled` gate. The plan defends this with "Update Task 2's hook signature retroactively to accept `string | undefined`" and lists the new behavior as test case 12 in Task 1 (which the checker correctly added). But test case 12 (`useDiscoveryPrefs(undefined, slug) NEVER writes to localStorage`) is in the Task 1 RED→GREEN test file. **If Task 2 ships the `(uid: string, slug: string)` signature literally, test case 12 is impossible to write — passing `undefined` as a `string` parameter is a TypeScript compile error.** Either Task 2 ships the optional signature from the start (and Task 3 only needs the StrategyTable wiring), or Task 1's test case 12 fails to compile in TypeScript-strict mode.

The cleanest resolution is to ship the `string | undefined` signature in Task 2 from the start — Task 1's test case 12 already specifies the contract, so this is a micro-edit, not a new decision. The Task 3 "retroactive" prose should be deleted; Task 3 only wires StrategyTable.

**Fix proposal:** In Plan 13-02:
1. Edit Task 2 File 1 to declare `useDiscoveryPrefs(uid: string | undefined, slug: string)` with the `enabled = !!uid` gate.
2. Update the Task 2 acceptance criterion `grep -c "if (!hydrated) return"` to also cover `if (!enabled) return` (Task 3 already has this — move it forward).
3. Delete the "Step 3a section: retroactively update Task 2's hook signature" prose at lines 691-708 of Plan 13-02; replace with "Task 3 imports the hook and threads userId — no hook edits".

---

### B3. [Hidden assumption] Plan 13-05 Task 3 imports nonexistent helper symbols

**Refs:** `13-05-PLAN.md:347-349` imports `seedAllocator` from `./helpers/seed-test-project`. `e2e/helpers/seed-test-project.ts:60` actually exports `seedTestAllocator` (verified via grep). `e2e/helpers/cleanup-test-project.ts:40` exports `cleanupTestAllocator` (this one matches).

**Evidence:**
```
$ grep "^export.*function" e2e/helpers/seed-test-project.ts
export async function seedTestAllocator(): Promise<SeededAllocator> {
```
Plan 13-05 Task 3 line 348 writes:
```typescript
import { seedAllocator } from "./helpers/seed-test-project";
```
This will fail at TypeScript compile time. The plan also references `seedAllocator` in the acceptance criterion grep at line 463: `grep -c "seedAllocator\\|cleanupTestAllocator" ... >= 2`. That grep would only find one match (`cleanupTestAllocator`), failing the acceptance criterion.

**Fix proposal:** Plan 13-05 Task 3 — change `seedAllocator` to `seedTestAllocator` at lines 348, 374, 463 (3 occurrences). The acceptance grep should read `seedTestAllocator\|cleanupTestAllocator`.

The same plan also references `e2e/helpers/seed-test-project.ts:seedAllocator()` in plan 13-02 Task 1 step 1 (line 237) — should also be `seedTestAllocator`.

---

## Warnings (should fix, not blocking)

### W1. [Risk surface] Empty-watchlist `<EmptyWatchlist>` placement breaks paginator + filter-row visibility

**Refs:** `13-01-PLAN.md:696-701` (StrategyTable Step 9): "Empty-watchlist state replaces the table/grid entirely" via `if (scope === "watchlist" && watchedSet.size === 0) return <EmptyWatchlist />`.

The plan's `return <EmptyWatchlist />` is inside the StrategyTable component body, **before** the existing `<StrategyFilters>` render — meaning when the user is on the empty Watchlist tab, the filter row (search, All Filters, WatchlistTabs, sort, view toggle, Customize cog) **disappears**. This is a UX trap: the only way back to the All tab is to leave/reload the page, since the WatchlistTabs that switches scope back is rendered inside StrategyFilters.

**Fix proposal:** Render `<EmptyWatchlist />` inside the same wrapper that holds StrategyFilters, replacing only the table/grid — keep StrategyFilters visible above it. Update Plan 13-01 Step 9 to "Empty-watchlist state replaces the `<table>` or `<StrategyGrid>` block — but **not** the `<StrategyFilters>` block above it."

### W2. [Test coverage] Plan 13-01 Task 1 file-3 tests rely on fake timers + RTL but Plan never specifies imports for vi.useFakeTimers

**Refs:** `13-01-PLAN.md:266-267` ("After click, button has `disabled` attribute for 200ms then re-enables (use vitest fake timers)").

The 200ms disabled-window test is a tight contract that fights React 19's `useTransition` semantics. `useTransition`'s `isPending` flag has no fixed duration — it stays true until the transition resolves. The plan's StarToggle implementation at `13-01-PLAN.md:443-468` doesn't actually implement a 200ms disabled timer — it sets `disabled={isPending}`, so the button is disabled while the fetch is in flight, not for a fixed 200ms window. The test as specified ("button has `disabled` attribute for 200ms then re-enables") will pass iff fetch resolves in <200ms (jsdom mocked fetch is synchronous-resolved, so it'll re-enable in 1 tick), making the test non-deterministic.

**Fix proposal:** Either rewrite the test to "button is `disabled` while `useTransition` is pending; transitions resolve after the awaited fetch promise" (non-time-based), or implement the 200ms guard explicitly in the StarToggle component (`setTimeout(() => setLocalDisabled(false), 200)` separate from `isPending`). The UI-SPEC State Matrix at line 225 says "underlying button disabled for 200ms to absorb double-clicks" — that's a real product contract, so the implementation should match. Pick one and align both the spec and the implementation.

### W3. [Migration safety] Plan 13-05 migration 090 lacks an `is_example=false` reset for non-seed strategies the seeder may have orphaned

**Refs:** `13-05-PLAN.md:155-167` (UPDATE WHERE id IN (...)). `scripts/seed-demo-data.ts:732-739` shows the seeder wipes `is_example=true` rows before re-seeding, but only against the test DB. Production may have orphaned `is_example=true` rows from older seed runs that don't match the canonical 8 UUIDs.

The migration only sets the canonical 8 to true. If production has, say, an old `is_example=true` row whose UUID is not in the canonical 8, the "fresh allocator hides examples" e2e will still pass (those rows ARE example strategies and ARE hidden), but a future analyst querying `WHERE is_example=true` will get inconsistent semantics.

**Fix proposal:** Add a comment to the migration: "Note: this migration only adds `is_example=true` flags. If production has legacy `is_example=true` rows from older seeders, those remain. A separate cleanup migration should be authored if drift is observed." Or flip the WHERE clause to `WHERE id IN (canonical 8) AND is_example = false` — that's idempotent without re-touching already-flagged rows. Low priority — the current migration is correct for DISCO-05's success criterion.

### W4. [Security] `withAuth` already does CSRF check + auth; Plan 13-01 inline pattern is duplicating logic

**Refs:** `src/lib/api/withAuth.ts:8-24` (verified — withAuth already calls `assertSameOrigin` for non-GET methods at line 13). Plan 13-01 Task 2 File 1 (lines 334-402) implements the route handler inline, repeating CSRF + auth logic.

The plan's stated reason for inlining was "withAuth does NOT forward route ctx (params)" (Plan 13-01 line 332). True — but the canonical Next 16 pattern is to extend `withAuth` to forward params, not to fork the auth flow. The current plan ships TWO auth code paths (the canonical `withAuth` and the new inline one), each of which must be kept in lockstep when the auth surface changes (e.g., when MFA gating lands).

**Fix proposal:** Either (a) extend `withAuth` to accept a generic `ctx` param and update the existing 5 callers (RESEARCH.md mentions this as the "preferred" path at line 350 but the plan picks the inline path for blast-radius reasons), or (b) add a `withAuthCtx<T>` variant that forwards ctx — keeps the existing `withAuth` callers unchanged and gives dynamic-route handlers a single canonical auth path. Option (b) is the lower-risk fix and would land in 5 new lines in `withAuth.ts`. Plan 13-01 should not silently fork the auth flow.

### W5. [Hidden assumption] StrategyFilters `id="strategy-list"` aria-controls target is added in StrategyTable but no test verifies it

**Refs:** `13-01-PLAN.md:692-693` (StrategyTable Step 8: 'Add an `id="strategy-list"` and `role="tabpanel"` to the wrapper `<div>`'). `13-01-PLAN.md:756` acceptance criterion `grep -c "id=\"strategy-list\"" ... >= 1`.

The grep verifies the string is in the file but not that it's on the correct wrapper element (the one that contains the table+grid, not the filters). A wrong-wrapper placement would still pass the grep but break the WAI-ARIA tablist relationship between the WatchlistTabs and the strategy-list panel.

**Fix proposal:** Add a Vitest test in Plan 13-01 Task 3 Step 3c case 8: "the element with `id='strategy-list'` is the immediate parent of the rendered `<table>` or `<StrategyGrid>` (NOT the filter row)". This costs one assertion but locks the structural contract. Low priority.

### W6. [Cross-plan contracts] Plan 13-02 Task 3 leaves `DEFAULT_CUSTOMIZE` in undefined state

**Refs:** `13-02-PLAN.md:579` ("DEFAULT_CUSTOMIZE may become unused after this plan ... Either keep both as legacy aliases OR remove ... if any non-test file imports them, keep with the corrected default and add a `@deprecated` JSDoc. If only tests import, delete and update the tests").

The plan defers this decision to the executor, which is the kind of mid-execution bikeshedding that produces inconsistent plans. The grep for current usage is one bash command; do it at plan-phase time and lock the answer.

**Fix proposal:** Run `grep -rn "DEFAULT_CUSTOMIZE\|CustomizeSettings" src/` at plan-phase time and lock the decision in the plan. Either "remove and update tests" or "keep with @deprecated + corrected default" — pick one.

### W7. [Test coverage] No Vitest test for the migration's idempotency claim

**Refs:** `13-05-PLAN.md:23` ("Migration 090 is idempotent — running twice is a no-op"). Plan ships only a Playwright e2e and a manual `supabase db push` run.

Idempotency on `UPDATE strategies SET is_example=true WHERE id IN (...)` is trivially true (set-to-true twice = once), so this is low-priority. But the "must_haves.truths" section of the plan claims idempotency as a verified behavior with no test backing it. Best practice would be a SQL fixture test or a database-level idempotency check.

**Fix proposal:** Acknowledge in the plan that idempotency is verified by inspection (UPDATE ... SET col = const is structurally idempotent), not by test. Or add a quick SQL probe in CI that runs the migration twice against an ephemeral DB and asserts row counts unchanged.

---

## Strengths

- **Migration numbering rebase** is well-handled. TODOS.md captures the 088 → 089 → 090 timeline precisely; the in-house checker correctly fixed Plan 13-05's reference.
- **CSRF + rate-limit + RLS** disposition for DISCO-01 is correct — `mandateAutoSaveLimiter` (30/min) is the right choice over `userActionLimiter` (5/min); RLS at `024_user_favorites.sql:42-73` is verified to deliver T-13-01-03 mitigation.
- **Sparkline single-color contract preservation** (DIFF-05) is the right call — keeping the rule at the call site preserves Sparkline.tsx's "caller picks color" invariant.
- **`is_example` data-only migration** is structurally simple, idempotent, and observability-instrumented (RAISE NOTICE).
- **Cross-account isolation strategy** (per-uid localStorage key) is structurally correct — the key shape itself prevents the leak; the Playwright spec is the proof.
- **Threat model dispositions** are honest. T-13-01-04 and T-13-01-05 are correctly **accepted** with rationale rather than papered over with "mitigated".
- **Skip-when-env-missing** patterns on the e2e specs are CI-friendly without abandoning the test contract.
- **Audit-gate deferral of DISCO-03** is correctly cascaded — no DISCO-03 task ships in any of the 4 plans.
- **UI-SPEC's 6/6 PASS verdict** is well-earned. Color tokens, typography weights (2 only), accent reservation list, and the visual hierarchy declaration (name → sparkline → star) are tight.

---

## Hidden Assumptions / Risk Surface

1. **Plan 13-05 Task 3 e2e spec depends on production seed UUIDs being present.** If `audit_count = 0` from Task 2 (a real possibility per the plan's "acceptable degraded outcome" at line 305), the spec passes trivially because `localStorage.hide_examples=true` filters all rows including non-example ones. The plan acknowledges this at lines 449-453 but doesn't add an explicit assertion that distinguishes "0 rows because is_example=true filtered them" from "0 rows because no rows match the category". Suggest adding `await expect(page.locator('text=No strategies match')).not.toBeVisible()` after the Hide-Examples-OFF toggle, to prove the toggle has at least 1 row to surface.

2. **`scripts/seed-demo-data.ts` line 904 is referenced as the seeder insert site but the actual line content was not verified.** The plan claims "All 8 are inserted with is_example=true by the seeder at line 904". I did not verify this exact line — but the grep at 904 shows `is_example: true` on a single line, consistent with the claim. Low risk.

3. **Plan 13-04's claim that drawdown SVG "may have a fill path AND a stroke path — but both should share the same color"** (line 287) is correct against current Sparkline.tsx (verified at line 41-55: both fill and stroke use the same `color` prop). But the e2e assertion `expect(size).toBeLessThanOrEqual(1)` at line 290 doesn't test "they share the same color" — it tests "there's at most 1 distinct stroke color". The fill color is set via `fill={color}` not `stroke={color}`, so it doesn't show up in `path[stroke]` selectors. The assertion is fine but the comment is misleading.

4. **`StrategyFilters.tsx:583-684` CustomizeModal removal in Plan 13-02 Task 3 doesn't account for any caller of CustomizeSettings/DEFAULT_CUSTOMIZE outside StrategyFilters.tsx.** The plan defers this audit to "run grep at execution time" (W6 above). If the executor finds external importers, the deletion is no longer safe.

5. **Empty-set badge rendering** (`13-01-PLAN.md:42`: "The badge is hidden when zero") is implemented as `{count > 0 && <span>...</span>}`. The Vitest test at file 4 case 4 asserts `queryByText('0')` returns null, but a count of 10 has a "0" digit — the test's assertion logic could false-positive. Suggest tightening to `queryByText(/^0$/)` or a more precise selector.

6. **Plan 13-01 Task 3 Step 3a item 7** updates the colSpan from 11 to 12 when userId is present. But the colSpan is used inside the empty-state row `<tr><td colSpan={11}>` — making it dynamic (`colSpan={userId ? 12 : 11}`) is mentioned but the acceptance criterion doesn't grep for it. A static colSpan=12 would break the back-compat case (no userId → 11 columns rendered → colSpan=12 would visually misalign).

---

## Disagreement with in-house checker (if any)

**No major disagreement on the 3 fixes the in-house checker landed:**
1. Migration 089 → 090 rename: correct, verified against `ls supabase/migrations/`.
2. RESEARCH.md `## Open Questions (RESOLVED)` suffix: correct, all 6 are appropriately resolved.
3. Plan 13-02 Task 1 test case 12 (uid=undefined never writes): correct in intent BUT the implementation in Task 2 doesn't allow `uid: undefined` as the type — see Blocker B2 above. The checker added the test but didn't catch that Task 2's hook signature contradicts the test.

**Escalation:** Blocker B1 (sparkline regression spec is a no-op given current fixtures) is something I'd expect a thorough adversarial review to surface — it requires reading `scripts/seed-demo-data.ts` to discover that all 8 fixtures have positive expected returns. The checker likely scored this on test-presence (file exists, asserts hasGreen+hasRed=false) without auditing whether the test would ever evaluate `hasGreen && hasRed = true` in a real run. This is the kind of "test passes without proving the behavior" risk the user explicitly asked about.

**Mild disagreement:** the in-house checker passed UI-SPEC at 6/6. I'd downgrade Dimension 5 (Spacing) to PASS-with-note: the plan claims a 44×44 hit area on the table star toggle, but Plan 13-01 Task 2 File 3 implements `min-w-11 min-h-11` which is `44×44` in Tailwind v3 default but `2.75rem × 2.75rem` (= 44px at default 16px root) — fine. The card variant is `w-8 h-8` (32×32), which the UI-SPEC explicitly allows. No real issue, just worth noting that the executor needs to keep `min-w-11 min-h-11` and not regress to `w-11 h-11` (which would force the icon to fill the hit area instead of being centered).

---

## Disposition

Land the 3 blockers (B1 dead-regression-gate, B2 hook-signature, B3 helper-import) before /gsd-execute-phase. The 7 warnings can land in-flight or be deferred to a follow-up cleanup commit. Phase shape is sound; revisions are surgical.

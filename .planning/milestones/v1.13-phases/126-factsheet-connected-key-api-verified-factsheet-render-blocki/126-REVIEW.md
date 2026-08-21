---
phase: 126-factsheet-connected-key-api-verified-factsheet-render-blocki
reviewed: 2026-07-19T00:00:00Z
depth: deep
files_reviewed: 11
files_reviewed_list:
  - src/lib/queries.ts
  - src/app/api/strategies/[id]/returns/route.ts
  - src/app/(dashboard)/allocations/lib/watchlist-read.ts
  - src/app/strategy/[id]/page.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - e2e/sfox-badge.spec.ts
  - .github/workflows/ci.yml
  - src/lib/queries.public-verification.test.ts
  - src/app/api/strategies/[id]/returns/route.test.ts
  - src/app/(dashboard)/allocations/lib/watchlist-read.test.ts
  - src/__tests__/phase-84-asset-class-flow.test.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 126: Code Review Report

**Reviewed:** 2026-07-19
**Depth:** deep
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 126 closes the "api_verified badge invisible to non-owners" class by
routing every public `trust_tier` read through a single helper
(`readPublicVerificationSignals`) backed by a `SECURITY DEFINER`, published-gated
DB primitive (`get_published_trust_signals`, migration 135, already audited
CLEAN). I traced all four repointed call sites plus the two allocations-subsystem
members and the CI wiring.

**Correctness is sound.** The fail-soft contract holds (every read path wraps the
RPC in try/catch and returns an empty map → `trust_tier` resolves `null` → badge
hides → page still renders 200; no SSR throw is introduced). Batching is correct:
`getStrategiesByCategory` and `watchlist-read` issue exactly one batched RPC for
the whole list (deduped via `Array.from(new Set(...))`, empty-input short-circuit,
keep-first on duplicate rows); the detail/route paths call it with a single id.
No field other than `trust_tier` was dropped from a caller that needed it —
`asset_class` still flows on the returns probe (pin updated in
phase-84 test), and no downstream consumer read `status`/`created_at` off the old
embeds. The `<main>` landmark on the v1 `/strategy/[id]` page is exactly one (the
other `return` at line 70 is the `MetricCard` component; no `/strategy` layout
supplies a competing `<main>`), and the v2 factsheet `<main>` comes solely from
`factsheet/[id]/v2/layout.tsx` — no double-main. The CI skipped-as-pass logic is
correctly scoped: `e2e-seeded` self-skips only via a job-level `if:` on
`vars.E2E_TEST_DB_CONFIGURED`/fork-repo (evaluated before any test runs), so a
genuine spec failure surfaces as `failure`, never `skipped`; `sfox-badge.spec.ts`
is in the seeded run list (line 1515) with no `continue-on-error`. No type-unsafe
`as any`; the `as unknown as` RPC-row cast matches the typed `Returns` shape added
to `database.types.ts`.

Two WARNINGs (both quality/robustness, no runtime defect) and three INFO items
(one is an accepted-but-worth-confirming behavior change) follow.

## Warnings

### WR-01: Call-site comments contradict the implementation — claim a "service-role projection" that no longer exists

**File:** `src/lib/queries.ts:230,383,483,540`; `src/app/factsheet/[id]/v2/page.tsx:334,415`; `e2e/sfox-badge.spec.ts:182`
**Issue:** Phase 126-01 introduced `readPublicVerificationSignals` as a
`createAdminClient()` (service-role) table projection. Phase 126-04 replaced the
body with a **normal** `createClient()` + `.rpc("get_published_trust_signals")`
call — and the helper's own JSDoc was correctly updated to say so
(`queries.ts:313`: "*no service-role client, no `createAdminClient`... via a
NORMAL server client*"). But the seven call-site/comment references left behind
still describe the helper as "*the service-role, published-scoped projection*".
This is a direct factual contradiction about the **trust mechanism** at a security
boundary (CLAUDE.md Rule 7: surface conflicts, don't blend them). A future
maintainer reading `getStrategyDetail`'s comment would believe an RLS-bypassing
service-role client is in play and could make a wrong security decision (e.g.
"harden" by swapping to `createAdminClient`, or misjudge the blast radius of the
anon-EXECUTE grant). The actual boundary is the SECDEF function's `RETURNS TABLE`
allow-list + `WHERE status='published'`, reachable by anon — a materially
different security story than "service-role bypass."
**Fix:** Update the seven comments to describe the real mechanism, e.g.:
```
// Phase 126 (FACTSHEET-01, founder Option B): trust_tier is read via
// readPublicVerificationSignals -> get_published_trust_signals (a published-
// gated, column-scoped SECURITY DEFINER DB primitive readable by anon), NOT an
// RLS-scoped embed and NOT a service-role/admin client.
```

### WR-02: Anti-tamper CI guard anchors on test titles + one axe literal — an in-place weakening of the badge-visibility assertions still greens the gate

**File:** `.github/workflows/ci.yml:1436-1459`
**Issue:** The guard's stated purpose is to prevent "*DELETING the non-owner
badge-visibility legs (admin + anon) ... while still passing the spec*." It greps
for two **test-title** substrings and one axe literal
(`results.violations).toEqual([])`). Title-anchoring catches wholesale deletion
of a leg, but NOT an in-place neutering of the load-bearing assertion. Concrete
false-green: an edit that keeps
`test("anon: a logged-out visitor sees the api_verified badge ...")` and its
`page.goto(...)` but deletes (or downgrades to `.toBeAttached()` /
`.toBeHidden()`) the `await expect(apiVerifiedBadge(page).first()).toBeVisible()`
line passes all three `need_anchor` checks — the grep never inspects the
`toBeVisible` assertion that actually proves the badge renders for a non-owner.
The gate would go green on a spec that no longer asserts the FACTSHEET-01 intent.
**Fix:** Add anchors for the visibility assertions themselves, tied to each leg,
e.g. grep that `apiVerifiedBadge(page).first()).toBeVisible` appears at least
twice (anon + admin legs), or assert a unique per-leg marker string is followed by
a `toBeVisible` within the spec. At minimum:
```bash
count=$(grep -cF 'apiVerifiedBadge(page).first()).toBeVisible' "$spec")
if [ "$count" -lt 2 ]; then
  echo "::error::sfox-badge anti-mask guard: expected >=2 badge-visible assertions (anon + admin), found $count"
  fail=1
fi
```

## Info

### IN-01: Owner-viewing-own-UNPUBLISHED strategy now resolves `trust_tier: null` on two surfaces that previously showed it

**File:** `src/app/api/strategies/[id]/returns/route.ts:265-266`; `src/app/(dashboard)/allocations/lib/watchlist-read.ts:120-129`
**Issue:** The returns-route probe uses `withPublishedOrOwner`, so an owner is
admitted to their OWN unpublished/draft strategy; the old owner-only RLS embed
returned that draft's verification row, so the owner saw their tier. The new
primitive is `WHERE status='published'` with no `auth.uid()` owner-inclusion, so
an owner's own **unpublished** strategy now yields `null` on the scenario drawer
(and equivalently on the watchlist if a user favorites an own-unpublished
strategy). 126-04 SUMMARY deviation #4 flags this as accepted (a draft has no
public provenance; the composer warm-up-gates on `daily_returns`, not tier). This
is not a bug, but it is a real behavior change on a surface that previously showed
the badge — surfaced here for explicit founder confirmation, not silent
acceptance. No data is lost server-side; only the badge display changes for the
owner's own drafts.
**Fix:** None required if the accepted semantics stand. If owner-own-draft tier
must be preserved, that needs an owner-inclusive variant (out of this phase's
two-member scope) — do NOT widen `get_published_trust_signals`; add a separate
owner-scoped read. Confirm the decision explicitly.

### IN-02: `getMyAllocationDashboardData` (queries.ts:~3379) still reads trust_tier via an admin-client `strategy_verifications` embed — asymmetry with the repointed readers

**File:** `src/lib/queries.ts` (`getMyAllocationDashboardData`, unchanged this phase)
**Issue:** This reader was deliberately left on its service-role embed (126-04
deviation #3) because it reads the owner's OWN book and repointing to the
published-gate would drop tier for the owner's own non-published book strategies.
That reasoning is sound, but it means "trust_tier for a book strategy" now has two
different code paths with different published-gating semantics. Not a defect;
noting the intentional asymmetry so a future "unify all trust_tier reads" pass
doesn't blindly repoint it and regress the owner's-own-book display.
**Fix:** None. Documented for future maintainers; the SUMMARY already surfaces it.

### IN-03: Seed-gated specs early-`return` (pass) rather than `test.skip` when `HAS_SEED_ENV` is false — the newly-blocking gate gives false assurance if seed env drifts

**File:** `e2e/sfox-badge.spec.ts:176,195` (pattern: `if (!HAS_SEED_ENV) return;`)
**Issue:** Now that `e2e-seeded` is BLOCKING on the frontend aggregator, the
sfox-badge legs are load-bearing. Each leg begins `if (!HAS_SEED_ENV) return;`,
which makes the test **pass green** (not skip) when the seed env is absent. The
job-level `if:` requires `E2E_TEST_DB_CONFIGURED==true`, but if `HAS_SEED_ENV`
(derived from the seed secrets/env injected into the Playwright run) ever diverges
from that repo variable — e.g. a secret is unset while the variable stays true —
every sfox leg silently passes without asserting anything, and the new blocking
gate reports green having proven nothing. This is a pre-existing project pattern,
not introduced here, but Phase 126 promoted these specs to a go-live gate, which
raises the stakes of the silent-pass. Consider `test.skip(!HAS_SEED_ENV, ...)` (a
visible skip) rather than a green early-return, so a seed-env drift is detectable
rather than masquerading as a passing gate.
**Fix:** Replace the early-return with an explicit skip at the top of each leg:
```ts
test.skip(!HAS_SEED_ENV, "seed env not configured");
```
so the badge assertions can never silently no-op while the required check reports
success.

---

_Reviewed: 2026-07-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

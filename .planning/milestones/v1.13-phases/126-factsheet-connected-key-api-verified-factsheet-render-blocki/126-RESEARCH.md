# Phase 126: FACTSHEET — connected-key api_verified factsheet render + blocking e2e - Research

**Researched:** 2026-07-19
**Domain:** Next.js 16 App Router SSR error handling / graceful degradation · Supabase SSR · Playwright e2e gating · axe a11y
**Confidence:** HIGH on symptom + fix architecture + CI wiring; MEDIUM on the exact throwing statement (static analysis ruled out the obvious candidates; a seeded local repro is the decisive disambiguator — Wave 0 Task 1)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Root-cause discipline (FACTSHEET-01):** The SSR throw MUST be root-caused via a seeded LOCAL repro before any fix — the same strategy renders fine on the edit-page tag + browse badge, so the fault is isolated to the factsheet `/strategy/[id]` connected-key provenance render path. No suppression, no try/catch-swallow, no workaround (Rule 6). A regression test must fail without the fix.
- **Graceful degradation (FACTSHEET-01):** When the connected-key provenance render legitimately cannot complete (transient analytics-service outage / missing derived data), the page must DEGRADE to an honest state for THAT panel — NOT throw and 500 the whole factsheet. The rest of the factsheet renders; the provenance/verification panel shows an honest "verification temporarily unavailable" state (no invented data). Doubles as prod hardening. Fail-loud where the input is genuinely wrong; fail-soft where the dependency is transiently unavailable — the investigation must distinguish which case the current throw is.
- **Blocking e2e gate (FACTSHEET-02):** `e2e/sfox-badge.spec.ts` must pass for owner / allocator / admin roles, include an axe accessibility check, and be wired into the BLOCKING `frontend` aggregator gate (the real e2e gate per v1.10 lesson) so it gates branch-protection — no longer RED/advisory. Seed fixtures must be OWNED BY the logged-in test user (v1.9.1 durable).

### Claude's Discretion
Exact render-path fix, the degraded-state component/copy, and test structure are at Claude's discretion, guided by DESIGN.md, the existing factsheet surfaces, and project conventions.

### Deferred Ideas (OUT OF SCOPE)
The flag flip (Phase 130). Any broader factsheet redesign — this is a render-correctness + gating phase; no new UI-SPEC.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FACTSHEET-01 | `/strategy/[id]` factsheet renders (or degrades gracefully) for an `api_verified` + api_key-linked sFOX strategy; the connected-key provenance render no longer throws; hardens prod against a transient analytics outage. | Root-cause analysis (below): two verified defects (missing `<main>`; whole-page error-boundary swallow) + ranked throw hypotheses + repro plan; degradation pattern via Next 16 `unstable_catchError`. |
| FACTSHEET-02 | `e2e/sfox-badge.spec.ts` GREEN across owner/allocator/admin incl. axe, wired into the `frontend` branch-protection gate (not advisory). | CI wiring analysis (below): `e2e-seeded` job runs the spec but is absent from the `frontend` aggregator `needs:`; exact wiring + the `skipped`-result nuance documented. |
</phase_requirements>

## Summary

The `e2e/sfox-badge.spec.ts` factsheet legs fail on the **v1 legacy `/strategy/[id]` route** (`src/app/strategy/[id]/page.tsx`), not on a "connected-key provenance component." The page is an async Server Component that renders `VerifiedBadge` (pure) + a metric grid + `Sparkline` + an authenticated `StrategyNoteCard` + `Disclaimer`. Its data comes from `getPublicStrategyDetail()` — **the exact same function the passing `/browse/[slug]/[strategyId]` page uses** — so the throw is provably NOT in the query (browse renders the same strategy + the same `trust_tier='api_verified'` badge fine). The failure surfaces as the route error boundary `src/app/strategy/[id]/error.tsx` rendering in place of the page: the badge locator finds nothing (page threw before the header) and axe reports `landmark-one-main`/`page-has-main`/`region`.

Investigation produced **two independently-verified defects** plus a **ranked hypothesis** for the throw:

1. **VERIFIED — missing `<main>` landmark.** The v1 `/strategy/[id]/page.tsx` renders a bare `<div className="min-h-screen bg-page">`. Browse pages get `<main>` from `src/app/browse/layout.tsx:38`; the v2 factsheet gets it from `StrategyV2Shell.tsx:54`; the root layout (`src/app/layout.tsx:91`) renders `{children}` directly. `/strategy` has **no route-group layout**, so even a *successfully rendered* v1 factsheet has no `<main>` → the owner leg's `buildAxe().analyze()` zero-violations assertion fails on `landmark-one-main`/`region` **regardless of the throw**. This must be fixed for the axe leg to go green.
2. **VERIFIED — the whole-page throws into `error.tsx`.** The admin leg asserts only the badge (no axe) and still fails → a real SSR throw blanks the page. The route-level `error.tsx` is correct as a last resort but is too coarse: a failure in any one region (provenance/verification, note, analytics) 500s the entire factsheet.
3. **Throw locus (needs repro to pin the exact line).** Static analysis ruled out the shared query, `auth.getUser()` (the Supabase server client swallows the cookie-write throw — `src/lib/supabase/server.ts`), `loadManagerIdentity`/`createAdminClient` (unreachable: `disclosure_tier` default is `'exploratory'`), the formatters, and `Sparkline` (all shared with the passing browse path). The remaining differentiator is that **the sfox owner/admin legs are the ONLY authenticated SSR render of the legacy v1 `/strategy/[id]` page in the entire e2e suite** — the "other factsheet specs that pass" actually target `/strategy/[id]/v2` or `/factsheet/[id]/v2`, or are dormant self-skips (see "Correction to prior memory"). So the throw lives in the authed-only v1 factsheet code path, which has essentially zero prior coverage.

**Primary recommendation:** (1) Reproduce locally via `seedSfoxVerifiedStrategy()` + `npm run start`, hit `/strategy/${id}` as the owner, read the SSR stack, pin the exact throw. (2) Fix it at source. (3) Add a `<main>` landmark to the v1 page. (4) Wrap the fallible sub-region in a **Next 16 `unstable_catchError` component boundary** (`next/error`) so a transient failure degrades that panel to an honest "verification temporarily unavailable" state while the badge + rest of the factsheet render. (5) Wire `e2e-seeded` into the `frontend` aggregator `needs:` **treating a `skipped` result as pass** (the job self-skips when `E2E_TEST_DB_CONFIGURED` is unset).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fetch strategy + analytics + verification tier | API/Backend (Supabase RLS via `getPublicStrategyDetail`) | — | Single shared read; already correct (browse proves it) |
| Render factsheet document (badge, metrics, sparkline) | Frontend Server (RSC in `page.tsx`) | — | SSR-first; VerifiedBadge/Disclaimer are pure |
| Provenance/verification "connected-key" panel resilience | Frontend Server (RSC) wrapped by a **Client** error boundary (`unstable_catchError`) | — | A fallible sub-region must not blank the route; degrade in place |
| Authenticated private-note sidecar | Frontend Server fetch → Client `StrategyNoteCard` | — | Authed-only path; the leading throw suspect; isolate it |
| `<main>` landmark / a11y structure | Frontend Server (page or a new `/strategy` route layout) | — | axe `landmark-one-main` requires exactly one `<main>` |
| Blocking e2e gate | CI (GitHub Actions `frontend` aggregator) | — | Branch protection gates on the `frontend` check only |

## Standard Stack

No new external packages. This is a bug-fix + a11y + test-gating phase on the existing stack.

### Core (already installed — verified from `package.json` / `node_modules`)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.2.10 | App Router SSR, error boundaries, `unstable_catchError` | Project framework; `unstable_catchError` is the native component-level degradation primitive [CITED: node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md] |
| `@supabase/ssr` | (installed) | Server client with cookie shim | Already the project's SSR data client; `setAll` swallows render-time cookie writes [VERIFIED: src/lib/supabase/server.ts] |
| `vitest` | ^4.1.2 | Unit/regression tests (`npm run test`) | Project unit runner; coverage-gated in CI [CITED: package.json] |
| `@playwright/test` | ^1.61.1 | e2e (`npm run test:e2e`) | Project e2e runner; sfox-badge spec lives here [CITED: package.json] |
| `@axe-core/playwright` | ^4.12.1 | axe a11y sweep in e2e | The `buildAxe()` factory the spec already uses [CITED: package.json + e2e/helpers/axe.ts] |

**No installation step.** The degradation primitive `unstable_catchError` ships inside `next` (import from `next/error`) — do **not** add `react-error-boundary`; the Next-native boundary is required to catch async **Server Component** throws during the server render.

## Package Legitimacy Audit

Not applicable — this phase installs **no external packages**. All primitives (`next/error`, existing vitest/playwright/axe) are already in `package.json`. No slopcheck run required.

## Root-Cause Analysis (FACTSHEET-01)

### Evidence chain (all VERIFIED against the repo at 92be47af / v1.12)

| # | Observation | Source | Implication |
|---|-------------|--------|-------------|
| E1 | Failing legs: `owner: factsheet badge (+axe)` (:131) and `admin: reads api_verified tier` (:171). Passing legs: `owner: edit SFOX tag` (:108), `allocator: browse badge` (:151). | `e2e/sfox-badge.spec.ts` + deferred-bug memory | Seed/tier/api-key link are correct; fault is factsheet-render-only. |
| E2 | The admin leg asserts **only** the badge (no axe) and fails. | spec :171–188 | A real SSR **throw** blanks the page (not merely an axe nit). |
| E3 | Browse (`/browse/[slug]/[strategyId]`) and the factsheet (`/strategy/[id]`) call the **same** `getPublicStrategyDetail(id)`; browse renders the `api_verified` badge fine. | `src/app/browse/[slug]/[strategyId]/page.tsx:10,36` + `src/app/strategy/[id]/page.tsx:5,86` | The throw is **not** in the query, tier projection, `Sparkline`, `formatPercent/Number`, or `metricColor` (all shared). |
| E4 | v1 `/strategy/[id]/page.tsx` renders a bare `<div>`, no `<main>`. Browse has `<main>` (`browse/layout.tsx:38`), v2 has `<main>` (`StrategyV2Shell.tsx:54`), root layout renders `{children}` bare (`layout.tsx:91`), and `/strategy` has no route layout. | grep verified | axe `landmark-one-main`/`page-has-main`/`region` fail even on a successful render → **separate defect**. |
| E5 | `error.tsx` exists at `src/app/strategy/[id]/error.tsx` (client boundary, `unstable_retry`, digest-only). | file read | The route error boundary renders on any child throw → the observed "bare page, no `<main>`, no badge." |
| E6 | `auth.getUser()` refresh cookie-write is swallowed by the server client's `setAll` try/catch. Other authed server components (`(marketing)/page.tsx`, tearsheet) use the same client without throwing. | `src/lib/supabase/server.ts` | The classic "cookies modified during render" throw is **ruled out**. |
| E7 | `loadManagerIdentity`→`createAdminClient()` (which throws on missing `SUPABASE_SERVICE_ROLE_KEY`) is **unreachable**: it runs only when `disclosureTier==='institutional'`, and `strategies.disclosure_tier` defaults to `'exploratory'` (migration `20260408113028`). Also the seed never sets it. | `queries.ts:67-83` + migration | Admin-client throw is **ruled out**. |
| E8 | `e2e-seeded` job env sets no `INTERNAL_API_TOKEN` / `ANALYTICS_SERVICE_URL`. `analytics-client.ts` throws hard when the service is unreachable. | `ci.yml:1519-1527` + `src/lib/analytics-client.ts:96,126` | IF any factsheet render path reaches `analytics-client`, it throws in e2e. The v1 `page.tsx` does **not** call it — but the repro must confirm nothing transitive does. |

### Correction to prior memory (IMPORTANT — changes where to look)

The deferred-bug note (`project_sfox_factsheet_e2e_deferred_golive_gate`) asserts *"other seeded factsheet specs (strategy-v2-axe, axe-app-wide, composite-factsheet-render) hit `/strategy/[id]` and pass → the differentiator is `api_key_id`."* Verified against the specs, this is **partly wrong**:

- `strategy-v2-*` specs target `/strategy/[id]/**v2**` (a different route + a different query `getStrategyDetailV2` + `StrategyV2Shell`, which HAS a `<main>`).
- `composite-factsheet-render.spec.ts` targets `/factsheet/[id]/v2` (public, no login) — **not** `/strategy/[id]`.
- `axe-app-wide.spec.ts`'s authed `/strategy/[id]/v2` rows are **HAS_SEED_ENV-gated self-skips that are DORMANT in CI by design** (`axe-app-wide.spec.ts:35-45`).

**Consequence:** the sfox owner + admin legs are the **only** authenticated SSR render of the legacy **v1** `/strategy/[id]` page in the whole suite. `api_verified`/`api_key_id` correlates only because the sfox seed is the sole fixture wired for that authed factsheet leg — it is **not** established as causal. The throw most likely lives in the **authenticated-only v1 factsheet code path** (the `auth.getUser()` → `user_notes` fetch → `StrategyNoteCard` SSR subtree) or in a data-shape edge the running stack exposes. This is why prod never surfaced it: authed users get the v2 surface by default, so the legacy v1 authed render is rarely hit.

### Ranked hypotheses for the exact throw (disambiguate via repro)

| Rank | Hypothesis | Confidence | How the repro confirms/refutes |
|------|-----------|------------|-------------------------------|
| H1 | A throw in the **authed-only v1 sub-tree** (`user_notes` fetch shape, or the `StrategyNoteCard`/`useNoteAutoSave`/`NoteRender` client subtree during SSR pre-render). Only the two failing legs exercise it. | MEDIUM | SSR stack names a `notes/*` module or the `user_notes` query. |
| H2 | A transitive reach into `analytics-client.ts` (or a warmup) that throws because `ANALYTICS_SERVICE_URL`/`INTERNAL_API_TOKEN` are unset in `e2e-seeded`. | LOW–MEDIUM | Stack names `analytics-client`/`warmup-analytics`; error is `AnalyticsTimeoutError`/"not reachable". |
| H3 | A data-shape edge specific to this seed (e.g., analytics row omits `computed_at`, `calmar`, `six_month_return`, `max_drawdown_duration_days`; a freshness/format helper on some shared component chokes on the null). | LOW | Stack names a formatter/date helper; reproduces only with the sfox analytics shape. |
| H4 | An `api_verified`-conditional render the plan-122 lineage expected but that is mis-wired on v1. | LOW | Grep already shows v1 renders no such panel; repro stack would name it if present. |

**Repro is Wave 0 Task 1 and is mandatory before any fix (locked decision, Rule 6).** Command sequence in "Validation Architecture → Wave 0".

## Architecture Patterns

### System data-flow (v1 `/strategy/[id]` factsheet)

```
GET /strategy/[id]
   │
   ├─ generateMetadata(id) ─┐
   │                        ├─ cache(getPublicStrategyDetail)(id)  ← SHARED w/ browse (proven safe)
   └─ PublicStrategyPage ───┘        │
        │                            └─ Supabase RLS read: strategies + strategy_analytics + strategy_verifications
        │
        ├─ <h1> + <VerifiedBadge trust_tier=api_verified/>   (pure — renders "Verified")
        ├─ metric grid  (gated on analytics.computation_status ∈ {complete, complete_with_warnings})
        ├─ <Sparkline/> (shared w/ browse — safe)
        ├─ [AUTHED] supabase.auth.getUser() → user_notes.maybeSingle() → <StrategyNoteCard/>   ◄── ONLY authed-v1 path (H1 suspect)
        └─ <Disclaimer variant="strategy" trust_tier=.../>   (pure)
                    │
     any child throw ▼
        src/app/strategy/[id]/error.tsx   ← WHOLE PAGE blanks (bad UX; no <main>; no badge)
```

**Target after fix:**

```
        ├─ <main>                                   ← NEW landmark (fixes axe)
        │    ├─ header + <VerifiedBadge/>           ← always renders
        │    ├─ metrics + sparkline
        │    ├─ <CatchError fallback=VerificationUnavailablePanel>   ← degrade THIS region only
        │    │      └─ <Provenance/NoteSidecar/>  (fallible async RSC)
        │    └─ <Disclaimer/>
        └─ error.tsx stays as the last-resort route boundary (genuinely-wrong / notFound only)
```

### Pattern 1: Component-level graceful degradation with `unstable_catchError` (Next 16.2.10)
**What:** A Client boundary factory that wraps any subtree — including async Server Components — and renders a fallback when it throws, WITHOUT bubbling to the route `error.tsx`.
**When to use:** The fallible provenance/verification (or note) sidecar, per the locked degradation decision.
**Example:**
```tsx
// Source: node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md (Next 16.2.10)
// app/strategy/[id]/VerificationBoundary.tsx
"use client";
import { unstable_catchError as catchError, type ErrorInfo } from "next/error";

function VerificationFallback(_props: {}, { error }: ErrorInfo) {
  // Honest degraded state — no invented data (DESIGN.md Numbers Contract / no-invented-data).
  // Amber = transient/recoverable (DESIGN.md semantic-color gates), not red.
  return (
    <div role="status" aria-live="polite" className="rounded-md border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-warning">
      Verification temporarily unavailable. The rest of this factsheet is unaffected.
    </div>
  );
}
export default catchError(VerificationFallback);
```
```tsx
// usage inside the Server Component page (wraps a fallible async RSC child)
import VerificationBoundary from "./VerificationBoundary";
// ...
<VerificationBoundary>
  <ConnectedKeyProvenance strategy={strategy} />   {/* async RSC; may throw on transient outage */}
</VerificationBoundary>
```
**Note:** `error.tsx`/`global-error.tsx` boundaries in this repo already use `unstable_retry` (NOT `reset`) — confirmed the current Next 16.2.10 contract [CITED: same doc, lines 216–241]. Do not "fix" those to `reset`.

### Pattern 2: Distinguish transient (degrade) vs genuinely-wrong (fail-loud)
- **Genuinely-wrong** (strategy missing, malformed/absent required data): keep `notFound()` / the existing hard behavior. Do NOT swallow real bugs (Rule 6 / Rule 12).
- **Transient** (analytics/verification dependency unreachable — e.g., `analytics-client` throw, a missing derived series): catch at the sub-region and render the honest fallback.
- The repro classifies the CURRENT throw: if it is a genuine bug (unguarded access / mis-wired call), **fix at source first**; the `catchError` boundary is defense-in-depth for the transient case, not the fix for the bug.

### Anti-Patterns to Avoid
- **Wrapping the whole page in try/catch to "make the test pass"** — forbidden (Rule 6; CONTEXT locked). It hides the real bug and the axe/main defect remains.
- **Adding `react-error-boundary`** — it cannot catch an async Server Component's server-render throw; use Next's `unstable_catchError`.
- **Coloring the degraded panel red** — red = permanent failure (DESIGN.md). A transient-unavailable state is **amber** (`--color-warning` #B45309 / bg #FEF3C7), or muted; and it carries no fabricated metric.
- **Marking `e2e-seeded` `needs:` without handling `skipped`** — the aggregator's `result != "success"` loop would fail CI on every repo/fork where `E2E_TEST_DB_CONFIGURED` is unset.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Catch an async RSC throw and degrade one region | A custom class error boundary / manual `try/catch` around JSX | `unstable_catchError` from `next/error` | Native, catches server-render throws, gives `unstable_retry` |
| Human error copy on the degraded panel | Inline strings | `ErrorEnvelope` + `buildEnvelope()` where a full error surface is warranted (DESIGN.md Error Envelope) | Repo mandates `buildEnvelope`; a lightweight inline `role="status"` is fine for a non-blocking degraded chip, but a blocking error must use the envelope |
| axe rule-set in the spec | A local rule set | `buildAxe(page)` (the only sanctioned factory) | Spec header + DESIGN.md; drift-guarded |
| Seed fixtures | New ad-hoc inserts | `seedSfoxVerifiedStrategy()` / `cleanupSfoxVerifiedStrategy()` | Already correct; fixtures owned by the logged-in user (v1.9.1) |

## Runtime State Inventory

Not a rename/refactor/migration phase — this is a render-correctness + a11y + CI-gating bug fix. No stored data, live-service config, OS-registered state, secrets, or build artifacts change.
- **Stored data:** None — verified (no schema/seed changes; the seed helper is already correct).
- **Live service config:** None — verified (no external service config touched).
- **OS-registered state:** None.
- **Secrets/env vars:** None changed. NOTE (test-infra, not runtime state): if the repro shows the throw is H2 (analytics dependency), the `e2e-seeded` job may need a mock or a stub env var (`ANALYTICS_SERVICE_URL`) — that is a CI-config change, decided by the repro.
- **Build artifacts:** None.

## Common Pitfalls

### Pitfall 1: Fixing the throw but leaving the missing `<main>` → owner axe leg still red
**What goes wrong:** The throw is fixed, the badge renders, the admin leg goes green, but `owner: factsheet badge (+ axe)` still fails on `landmark-one-main`/`region`.
**Why:** The v1 `/strategy/[id]` page never had a `<main>` (E4). The axe assertion is `expect(results.violations).toEqual([])` — zero tolerance.
**How to avoid:** Add exactly one `<main>` — either wrap the page body, or add a `/strategy` route-group layout (mirror `browse/layout.tsx`). Keep exactly one `<main>` per document (v2 already has its own; the v1 route is separate).
**Warning signs:** axe violations array contains `landmark-one-main`, `page-has-main`, or `region`.

### Pitfall 2: `e2e-seeded` self-skip breaks the aggregator
**What goes wrong:** Adding `e2e-seeded` to `frontend.needs` + the result loop with the current `if [ "$result" != "success" ]` fails CI whenever the job is `skipped` (fork PRs, or any repo where `E2E_TEST_DB_CONFIGURED` var is unset).
**Why:** `e2e-seeded` has `if: ${{ ... vars.E2E_TEST_DB_CONFIGURED == 'true' }}` → resolves to `skipped` when unset (`ci.yml:1290`).
**How to avoid:** In the aggregator loop, treat `skipped` as acceptable for `e2e-seeded`: `if [ "$result" != "success" ] && [ "$result" != "skipped" ]; then fail=1; fi` (scoped to the e2e-seeded row). The blocking effect is real on the main repo where the var IS set.
**Warning signs:** `frontend` red on a branch that changed nothing e2e-related, with `e2e-seeded: skipped` in the log.

### Pitfall 3: Repro against the wrong route/surface
**What goes wrong:** Reproducing on `/strategy/[id]/v2` or `/factsheet/[id]` shows no error (they have `<main>` and a different query), wrongly concluding "cannot repro."
**Why:** The bug is v1-`/strategy/[id]`-and-authenticated-only (E-correction).
**How to avoid:** Repro on `/strategy/${id}` (no `/v2`) while **logged in as the owner** (the authed note path is the differentiator). Read the server stack from `npm run start` stdout.

### Pitfall 4: Playwright reports the FIRST failing assertion
**What goes wrong:** The owner leg fails on the badge line (:142) before ever reaching axe (:147), masking the axe defect.
**How to avoid:** Fix the throw AND the `<main>` together; verify the owner leg passes both the badge and the axe assertions.

## Code Examples

### Add the `<main>` landmark (option A — wrap the page body)
```tsx
// src/app/strategy/[id]/page.tsx  (illustrative; exact structure at planner's discretion)
return (
  <main className="min-h-screen bg-page">   {/* was: <div className="min-h-screen bg-page"> */}
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      {/* header + badge + metrics + sparkline + note + disclaimer */}
    </div>
  </main>
);
```
Option B (a `src/app/strategy/layout.tsx` mirroring `browse/layout.tsx:38`) is equally valid and also covers any sibling routes under `/strategy`.

### Regression test that FAILS without the fix (degrade-not-throw)
```tsx
// Vitest — assert the fallible sidecar degrades and the page still renders the badge.
// A child that throws must NOT blank the whole subtree.
// (mount the boundary + a throwing child; assert fallback text + sibling badge both present)
```
(Concrete file paths in Validation Architecture. The e2e in `sfox-badge.spec.ts` is the end-to-end regression; a unit test on the `unstable_catchError` boundary pins the degradation contract deterministically.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Route-only `error.tsx` (whole segment blanks on any child throw) | Component-level `unstable_catchError` boundaries for granular degradation | Next 16.x | Lets one panel fail without 500-ing the page — exactly the locked decision |
| `reset` prop on error boundaries | `unstable_retry` prop | Next 16.2.x | Repo already migrated; keep `unstable_retry` |

**Deprecated/outdated:** `react-error-boundary` for RSC degradation — cannot catch server-render throws; superseded by `unstable_catchError`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The exact throwing statement is in the authed-only v1 sub-tree (H1). | Root-Cause / Hypotheses | If it is H2/H3 instead, the source fix differs — but the repro (Wave 0 Task 1) resolves this before any code change, and the degradation + `<main>` + CI-wiring work is unaffected. |
| A2 | Adding a single `<main>` clears the axe `landmark-one-main`/`region` findings with no new violations. | Pitfall 1 | Low — mirrors the proven `browse/layout.tsx` structure; the axe leg re-verifies. |

**All other claims are VERIFIED against the repo or CITED to the installed Next docs.**

## Open Questions

1. **Which hypothesis (H1–H4) is the actual throw?**
   - What we know: it is authed-only, v1-`/strategy/[id]`-only, and not in the shared query/getUser/admin-client path.
   - What's unclear: the exact module/line.
   - Recommendation: Wave 0 Task 1 repro (mandatory, locked). The rest of the plan does not block on the answer.
2. **If the throw is H2 (analytics dependency), does the fix belong in code (degrade) or CI (provide `ANALYTICS_SERVICE_URL`/mock)?**
   - Recommendation: BOTH — degrade in code (prod hardening) AND ensure the e2e env does not depend on an unavailable service (a transient-outage simulation is a feature, not a gap).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | build/test | ✓ | 22 in CI (`ci.yml:1302`), 25 local | Use `node@22` to repro CI-only issues (memory) |
| Next.js | app | ✓ | 16.2.10 | — |
| Playwright + chromium | e2e | ✓ | @playwright/test ^1.61.1 | — |
| Test Supabase project | seeded e2e | ✓ (secrets wired: `E2E_TEST_DB_CONFIGURED`) | project `qmnijlgmdhviwzwfyzlc` | Spec self-skips when `HAS_SEED_ENV` false |
| `ANALYTICS_SERVICE_URL` / `INTERNAL_API_TOKEN` | only if throw is H2 | ✗ in `e2e-seeded` | — | Degrade in code + (optionally) stub in CI |

**Missing dependencies with no fallback:** none block the fix.
**Missing dependencies with fallback:** analytics service in e2e — the correct behavior is graceful degradation, so its absence is a test case, not a blocker.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 (unit) + Playwright ^1.61.1 (e2e) + @axe-core/playwright ^4.12.1 |
| Config file | `vitest.config.ts`, `playwright.config.ts` (`testDir: ./e2e`, `baseURL` default `http://localhost:3000`) |
| Quick run command | `npm run test -- src/app/strategy` (targeted unit) |
| Full suite command | `npm run test` (vitest) + seeded `npx playwright test e2e/sfox-badge.spec.ts` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FACTSHEET-01 | Fallible sidecar throws → page still renders badge + `<main>`, panel shows honest fallback (degrade-not-throw) | unit | `npm run test -- src/app/strategy/[id]/VerificationBoundary.test.tsx` | ❌ Wave 0 |
| FACTSHEET-01 | v1 `/strategy/[id]` renders exactly one `<main>` landmark | unit (structural) or e2e axe | `npx playwright test e2e/sfox-badge.spec.ts -g "factsheet"` | ✅ (spec) / ❌ landmark unit Wave 0 |
| FACTSHEET-01 | Root-caused throw fixed at source; regression fails without the fix | unit | `npm run test -- <module the repro pins>` | ❌ Wave 0 (after repro) |
| FACTSHEET-02 | Owner factsheet badge + axe zero-violations | e2e | `npx playwright test e2e/sfox-badge.spec.ts -g "owner: the strategy factsheet"` | ✅ |
| FACTSHEET-02 | Allocator browse badge | e2e | `npx playwright test e2e/sfox-badge.spec.ts -g "allocator"` | ✅ (already green) |
| FACTSHEET-02 | Admin reads api_verified tier on factsheet | e2e | `npx playwright test e2e/sfox-badge.spec.ts -g "admin"` | ✅ |
| FACTSHEET-02 | `e2e-seeded` blocks the `frontend` aggregator | CI structural | inspect `.github/workflows/ci.yml` `frontend.needs` + result loop | ❌ Wave 0 (edit) |

### Sampling Rate
- **Per task commit:** `npm run test -- src/app/strategy` (+ `npm run lint`).
- **Per wave merge:** full `npm run test` + `npx playwright test e2e/sfox-badge.spec.ts` (seeded, against test project).
- **Phase gate:** full vitest green + all four sfox-badge legs green (owner+axe / allocator / admin) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] **Repro Task (mandatory, locked):** `seedSfoxVerifiedStrategy()` (or `SEED_CONFIRM_STAGING=true npx tsx scripts/seed-demo-data.ts` for the demo set) → `npm run build && npm run start` with test-Supabase env → log in as owner → `GET /strategy/${id}` → capture the SSR stack. Pin the throwing module/line; classify transient vs genuinely-wrong.
- [ ] `src/app/strategy/[id]/VerificationBoundary.tsx` (+ `.test.tsx`) — `unstable_catchError` degradation boundary + honest fallback (DESIGN.md amber/no-invented-data).
- [ ] `<main>` landmark on v1 `/strategy/[id]` (page wrap or new `src/app/strategy/layout.tsx`).
- [ ] Source fix for the pinned throw + a regression unit test that fails without it.
- [ ] `ci.yml`: add `e2e-seeded` to `frontend.needs` and the result loop, treating `skipped` as pass for that row.
- [ ] Framework install: none — all runners present.

## Security Domain

`security_enforcement` not disabled → included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | RLS on `strategies`/`strategy_verifications`/`user_notes` unchanged; published-only gate via `withPublishedOnly`; admin SELECT RLS (migration 093) already grants the admin leg |
| V5 Input Validation | minor | `params.id` UUID flows to Supabase parameterized queries (no interpolation) |
| V7 Error Handling & Logging | yes | `error.tsx` shows digest-ONLY (never the server message — Information Disclosure T-52-15); the new degraded panel must likewise NOT surface raw error text to the client; log server-side + Sentry |
| V6 Cryptography | no | none |

### Known Threat Patterns for {Next.js RSC + Supabase}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Server error message leaked to client via a fallback | Information Disclosure | Fallback renders static honest copy + digest only; never `error.message` (mirror `error.tsx` contract) |
| A swallowed throw hides a genuine RLS/data bug | Tampering/Repudiation | Degrade ONLY the transient case; genuinely-wrong still fails loud + is logged/Sentry'd (Rule 6/12) |
| Note fetch cross-user leakage | Information Disclosure | `user_notes` RLS enforces per-user privacy (unchanged); do not widen the query |

## Sources

### Primary (HIGH confidence)
- `node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md` (Next 16.2.10) — `unstable_catchError`, `unstable_retry`, nested boundaries [CITED]
- Repo files (VERIFIED, all read this session): `src/app/strategy/[id]/page.tsx`, `.../error.tsx`, `src/app/browse/[slug]/[strategyId]/page.tsx`, `src/app/browse/layout.tsx`, `src/app/layout.tsx`, `src/components/strategy-v2/StrategyV2Shell.tsx`, `src/lib/queries.ts` (`getPublicStrategyDetail`, `loadManagerIdentity`, `readDisclosureTier`), `src/lib/utils.ts` (`extractAnalytics`), `src/lib/supabase/server.ts`, `src/lib/analytics-client.ts`, `src/components/ui/VerifiedBadge.tsx`, `src/components/ui/Disclaimer.tsx`, `src/components/notes/StrategyNoteCard.tsx`, `e2e/sfox-badge.spec.ts`, `e2e/helpers/seed-test-project.ts` (`seedSfoxVerifiedStrategy`), `e2e/axe-app-wide.spec.ts`, `e2e/composite-factsheet-render.spec.ts`, `.github/workflows/ci.yml` (`e2e-seeded` :1269, `frontend` :615), `supabase/migrations/20260408113028_disclosure_and_tenancy.sql`, `package.json`, `playwright.config.ts`, `DESIGN.md`.

### Secondary (MEDIUM confidence)
- Auto-memory `project_sfox_factsheet_e2e_deferred_golive_gate` — symptom + axe signature; its "api_key_id differentiator / other specs pass" claim is CORRECTED here against the specs.

### Tertiary (LOW confidence)
- None relied upon.

## Metadata

**Confidence breakdown:**
- Symptom + two verified defects (`<main>`, whole-page error boundary): HIGH — read directly from the repo.
- Exact throwing statement: MEDIUM — obvious candidates ruled out statically; repro required to pin.
- Fix architecture (`unstable_catchError` degradation + `<main>` + CI wiring): HIGH — CITED to installed docs + verified CI structure.
- CI gating nuance (`skipped` handling): HIGH — verified from `ci.yml`.

**Research date:** 2026-07-19
**Valid until:** 2026-08-18 (stable; re-verify Next `unstable_catchError` naming if Next is upgraded — it is an `unstable_` API)

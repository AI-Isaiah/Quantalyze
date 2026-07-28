---
phase: 126-factsheet-connected-key-api-verified-factsheet-render-blocki
plan: 01
subsystem: database
tags: [supabase, rls, service-role, nextjs-rsc, trust-tier, a11y, playwright, vitest]

# Dependency graph
requires:
  - phase: 122-sfox-verified-integration
    provides: seedSfoxVerifiedStrategy fixture + VerifiedBadge(trust_tier) surfaces
provides:
  - "Root-cause record: the /strategy/[id] api_verified badge failure is NOT an SSR throw — it is an RLS visibility gap on strategy_verifications for non-owner viewers"
  - "Public trust_tier projection via service-role (readPublicVerificationSignals) — badge now visible to anon + admin + owner on factsheet, browse detail, and browse/discovery list"
  - "<main> landmark on the v1 /strategy/[id] factsheet (axe landmark-one-main satisfied)"
  - "sfox-badge.spec.ts: new anon leg + strengthened admin leg (all 5 legs green vs TEST project)"
affects: [126-02, 126-03, factsheet, browse, discovery, trust-tier]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Service-role, column-scoped projection of a PUBLIC field from an RLS-locked table (trust_tier+status only) instead of widening RLS"
    - "Fail-soft public read: dependency read error -> null tier -> element hides, page still 200s (no error boundary needed)"

key-files:
  created:
    - src/lib/queries.public-verification.test.ts
  modified:
    - src/lib/queries.ts
    - src/app/strategy/[id]/page.tsx
    - src/app/factsheet/[id]/v2/page.tsx
    - e2e/sfox-badge.spec.ts

key-decisions:
  - "The research premise (SSR throw -> unstable_catchError degradation boundary) is DISPROVEN by the seeded local repro: the page returns 200, it never throws."
  - "Founder decision Option B: expose trust_tier to the public via a service-role projection (trust_tier+status ONLY), NOT an RLS-widening migration — the strategy_verifications table stays locked."
  - "No unstable_catchError boundary (126-02's premise) — YAGNI: there is no throw to catch; fail-soft null-tier is the degradation."

patterns-established:
  - "readPublicVerificationSignals: batched service-role read gated to PUBLISHED strategies, projecting only the two public verification fields."

requirements-completed: [FACTSHEET-01]

# Metrics
duration: ~95min
completed: 2026-07-19
---

# Phase 126 Plan 01: Root-cause repro + fix-at-source Summary

**The `/strategy/[id]` api_verified badge failure was never an SSR throw — a seeded local repro proved the page returns 200; the badge was invisible to every non-owner viewer (anon public + admin) because `strategy_verifications` RLS grants SELECT to the owner only. Fixed at source via a service-role, published-scoped `trust_tier`+`status` projection (founder Option B), plus the missing `<main>` landmark.**

## Performance

- **Duration:** ~95 min
- **Tasks:** 2 (repro+pin; fix+tests) — re-scoped after the founder decision on the pinned root cause; then a class-closure follow-up
- **Files modified:** 4 + 1 created
- **Commits:** 4 atomic (30c22dc7 projection+test, b35de331 `<main>`, 6b7e4296 e2e, 75e97f76 class closure)

## Pinned Root Cause (load-bearing — Wave 0, Rule 6)

The repro RAN against the seeded TEST project `qmnijlgmdhviwzwfyzlc` (never prod), driving the two failing `sfox-badge.spec.ts` legs through a live authed SSR render.

**Classification: GENUINELY-WRONG — NOT a throw, NOT transient.**

- **No SSR throw.** `GET /strategy/<id>` returned **HTTP 200** (`application-code 765ms`) for the admin session. Research evidence E2 ("admin asserts only the badge and fails → a real SSR throw blanks the page") and hypotheses **H1–H4 (all throw theories, incl. the `user_notes`/`StrategyNoteCard` sidecar) are REFUTED.**
- **Owner leg** fails ONLY on the axe `landmark-one-main`/`region` violation — the missing `<main>` (verified defect E4). The badge assertion **passed** for the owner.
- **Admin leg** rendered 200 but the badge was **absent**.

A direct RLS-scoped probe (re-running `getPublicStrategyDetail`'s exact nested read as each viewer) pinned it:

| Viewer | strategy row visible | verification rows read | projected `trust_tier` | badge |
|--------|:---:|:---:|:---:|:---:|
| Service role (ground truth) | — | 1 (`api_verified`,`validated`) | — | — |
| **Owner** | yes | **1** | `api_verified` | shows |
| **Admin** (`is_admin=true`) | yes | **0** | `null` | absent |
| **Anon (public)** | yes | **0** | `null` | absent |

**Pinned locus:** the RLS layer feeding `src/lib/queries.ts` `getPublicStrategyDetail` (and the sibling list `getStrategiesByCategory`). `strategy_verifications` has exactly three SELECT policies — `owner_select` (EXISTS on `strategies.user_id = auth.uid()`), `admin_select` (checks `user_app_roles`, **not** `profiles.is_admin` — the seed's admin elevation mechanism, hence admin also read 0), and `service_all`. **No public/published SELECT policy exists.** So `getPublicStrategyDetail`'s RLS-scoped nested embed returned 0 rows for every non-owner → `trust_tier=null` → `VerifiedBadge` (renders only for `api_verified`) rendered nothing. Browse avoided this only because its badge gates on the public `api_key_id` column, but it *also* renders `VerifiedBadge(trust_tier)`, so browse detail had the same latent anon gap.

## The Fix (founder decision: Option B — service-role projection)

Added `readPublicVerificationSignals(strategyIds)` in `src/lib/queries.ts`: a service-role (admin-client) read of `strategy_verifications`, gated to PUBLISHED strategies via `strategies!inner(status).eq('published')`, projecting **ONLY** `trust_tier` + `status` (keyed by `strategy_id`, latest per strategy). No other verification column reaches the caller/client. **No RLS widening / no migration** — the table stays locked; the server deliberately projects the two public fields.

- `getPublicStrategyDetail` (factsheet `/strategy/[id]` + browse detail) and `getStrategiesByCategory` (browse/discovery list) now project `trust_tier` from this helper instead of the RLS-scoped embed. Both public surfaces now use the SAME public signal — consistent.
- **Fail-soft (Rule: no boundary — there is no throw to catch, so `unstable_catchError` would be speculative/YAGNI):** any read error → `captureToSentry` (warning) → empty map → `trust_tier` stays `null` → badge hides, page still renders 200. Never invents a tier.

### `<main>` landmark
`src/app/strategy/[id]/page.tsx` wrapped its body in exactly one `<main>` (page-body wrap, NOT a `/strategy` route layout — the v2 route already renders its own `<main>` via `StrategyV2Shell`; a shared layout would double it). Clears the owner-leg axe `landmark-one-main`/`region` findings.

## Verification (before/after — seeded harness, TEST project only)

Repro harness: a second dev server on port 3100 under a temporary `distDir` override (`.next-repro`) so the user's port-3000 server + lock were never touched; all temp edits reverted, server killed, dir removed.

| Leg | Before fix | After fix |
|-----|-----------|-----------|
| owner factsheet + axe | badge OK, **axe FAIL** (`region`/`landmark-one-main`) | **PASS** |
| admin factsheet (non-owner) | 200 but **badge ABSENT** | **PASS** (badge visible) |
| anon factsheet (logged-out) — new leg | badge ABSENT (`trust_tier=null`) | **PASS** — 200, exactly 1 `>Verified<` chip, exactly 1 `<main>` |
| allocator browse | PASS | PASS |
| owner edit SFOX tag | PASS | PASS |

Full `sfox-badge.spec.ts`: **5/5 passed** post-fix. Anon direct-fetch probe: `{status:200, verifiedTextChips:1, mainTags:1}`.

## Regression tests (RED-proven)

- **e2e (real SSR/RLS regression):** new `anon` leg asserts the badge IS visible logged-out; admin leg asserts the same for a non-owner. Both fail RED on pre-126 code (non-owner `trust_tier=null`). Live RED→GREEN observed this session (pre-fix admin/owner legs failed; post-fix all 5 green).
- **vitest security guard (`queries.public-verification.test.ts`, 6 tests):** pins the projection contract — exposes ONLY `trust_tier`+`status` (drops `wizard_session_id`/`flow_type`/`source`), never SELECTs internals or `*`, gates to `published`, latest-per-strategy, fail-soft empty map on error, short-circuits empty input. **RED-proven:** neutering the projection to `{...row}` + `select("*")` fails the two security guards (2 fail); restoring passes 6/6.

## Deviations from Plan

The plan assumed the failure was an SSR throw (Task 2 "fix the pinned throw"). The repro disproved that. Per Rule 4 I raised an architectural/security checkpoint; the founder chose Option B and authorized landing the fix in this plan, re-scoped:

- **[Re-scope] Task 2 fix target moved** from `page.tsx`/`StrategyNoteCard.tsx` (the H1 throw suspects, refuted) to `src/lib/queries.ts` (the pinned RLS-visibility bug) + the `<main>` a11y defect.
- **[Rule 2 — a11y correctness] Added `<main>`** to fix the owner-leg axe failure (a distinct verified defect, not the "throw").
- **[Dropped, per founder] The `unstable_catchError` degradation boundary** (126-02's premise) — no throw exists to catch; fail-soft null-tier is the degradation.

## Class Closed (follow-up commit `75e97f76`)

Per the founder's "close the WHOLE class" directive, the remaining non-owner badge surfaces were closed with the same `readPublicVerificationSignals` helper (a logged-in non-owner must never see LESS trust signal than an anon visitor):

**DONE — class members fixed:**
- **`getStrategyDetail`** (authed `/(dashboard)/discovery/[slug]/[strategyId]`): the owner-only RLS `strategy_verifications` embed → replaced with the service-role helper. A non-owner allocator browsing another manager's published strategy now sees the api_verified badge. RED-proven unit regression added to `queries.public-verification.test.ts` (revert to embed-read → 2 tests fail; restore → 8/8).
- **`/factsheet/[id]/v2/page.tsx`** (PUBLIC factsheet — the composite/v2 surface): trust_tier was read via an **inline RLS-scoped** `strategy_verifications` query (`createClient`) that returned zero rows for anon + non-owner → badge vanished. Now sourced via the helper. Verified: `composite-factsheet-render.spec.ts` 4/4 + all 5 `sfox-badge` legs green vs TEST.

**CORRECTION:** `getFactsheetDetail` (the function the founder named as #2) does **not** project `trust_tier` at all — the tearsheet never reads it. The real "factsheet surface" trust source was the v2 page inline query (fixed above). No change to `getFactsheetDetail`.

**STILL FLAGGED (allocations subsystem — NOT in the founder's named scope; surfaced, not silently expanded):**
- **returns route** `src/app/api/strategies/[id]/returns/route.ts:188` — RLS-scoped `strategy_verifications` embed feeding the scenario-drawer trust_tier for an allocator-added (non-owner) strategy. Same latent gap.
- **watchlist-read** `src/app/(dashboard)/allocations/lib/watchlist-read.ts:100` — RLS-scoped embed via `user_favorites → strategies → strategy_verifications`; an allocator's watchlist badges for favorited (non-owner) strategies would be hidden.
- Both are wider-blast-radius allocations surfaces; recommend a scoped follow-up (same helper) rather than folding into 126-01. `verify-strategy` route + status use the admin client already → not class members.

## Security scoping of the projection (T-126-03)

The service-role read is the deliberate, column-scoped public exposure: it selects `trust_tier, status` (+ `strategy_id` key, `created_at` sort, and an embedded `strategies.status` used only for the published gate — never returned to the caller). No verification internals reach the client. `user_notes` RLS/privacy untouched. No secrets appear in this SUMMARY or the diff (grep `eyJ`/`sbp_` → 0).

## Follow-ups for 126-03 (founder handling CI wiring)

- Wire `e2e-seeded` into the blocking `frontend` aggregator (treat `skipped` as pass) — the 5 sfox-badge legs are the gate.
- Consider the same-class fix for `getStrategyDetail`/`getFactsheetDetail` if their surfaces should show the badge to non-owner viewers.

## Self-Check: PASSED

- All 4 changed files present on disk.
- All 3 commits present in git history (30c22dc7, b35de331, 6b7e4296).
- No secrets in SUMMARY or diff.

## Class-Closure Self-Check: PASSED

- Commit 75e97f76 present; no deletions; no secrets in diff; no catch-swallow added to the v2 page.
- getStrategyDetail + /factsheet/[id]/v2 fixed; getFactsheetDetail correctly untouched (does not source trust_tier).
- Regression RED-proven (embed-read revert fails 2 tests; restore 8/8). composite-factsheet-render 4/4 + sfox-badge 5/5 green vs TEST qmnijlgmdhviwzwfyzlc.
- Remaining allocations-subsystem class members (returns route, watchlist-read) flagged for a scoped follow-up.

---
phase: 164-share-copy-link-always-works-and-never-discloses
verified: 2026-08-28T12:00:00Z
status: human_needed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "TEST hand-apply checkpoint (164-02 Task 3, gate=blocking-human — STILL OPEN). Hand-apply supabase/migrations/20260827120000_strategy_shares_generation_model.sql and 20260827130000_sanitize_user_revoke_strategy_shares.sql to the TEST database, then confirm the sql-tests CI job runs supabase/tests/test_strategy_shares_rls.sql GREEN against TEST."
    expected: "Both migrations apply cleanly (self-verification blocks pass); the 103-arm gate goes green in CI. DRIFT-02a is RESOLVED (body re-based on PROD's pg_get_functiondef, md5-proven), so 20260827130000 is no longer blocked — but the apply itself is a deliberate human gate (SKIP-01: nothing applies migrations to TEST automatically, and the gate has NO pre-apply tolerance arm by design)."
    why_human: "Verifier is forbidden to touch Supabase TEST or apply migrations. The throwaway-PG proof (run in this verification, exit 0) explicitly does NOT prove behaviour against TEST's real schema/RLS — the harness header says so itself."
  - test: "Set SHARE_TOKEN_SECRET (>= 32 chars, e.g. openssl rand -base64 48) in Vercel for ALL environments and in .env.local, BEFORE merging this branch."
    expected: "Build/boot succeeds. A missing/short value fails LOUD at module load with a named remedy (verified in code) — but the setting itself is an operator action the codebase cannot perform."
    why_human: "164-01 user_setup item. Env-var state in Vercel is not inspectable from this environment."
  - test: "WR-01 (164-REVIEW): fix .env.example — it tells the operator to reuse one SHARE_TOKEN_SECRET across all environments and documents the stale two-field pre-image."
    expected: ".env.example documents per-environment secrets and the qz.strategy-share.v1.<id>.<nonce>.<generation> pre-image."
    why_human: "The environment denies agent access to .env* files; only a human can edit it. Advisory severity (operator-facing doc), explicitly NOT fixed in the review round."
  - test: "Browser UAT of the full loop on a real server: owner opens an UNPUBLISHED strategy's factsheet, clicks Copy Link → paste URL into an incognito window → factsheet renders with no owner chrome and no Copy-Link control. Click Copy Link again in a second session → same URL. Revoke on the factsheet (inline confirm) → the copied link now shows the 410 dead-link page. Copy Link on a PUBLISHED strategy → /factsheet/<id>?share=1 exactly as before."
    expected: "Every step as described; anonymous /factsheet/<id> of the unpublished strategy 404s throughout."
    why_human: "Clipboard interaction, Safari transient-user-activation behaviour, and real-server rendering are visual/runtime properties a jsdom test cannot fully certify. All underlying invariants ARE covered by passing tests; this is the end-to-end confirmation."
---

# Phase 164: SHARE — Copy Link always works, and never discloses — Verification Report

**Phase Goal:** "Copy Link" on a strategy its owner can view yields a URL its recipient can view — a revocable per-strategy share token — and the token lane can never disclose an unpublished strategy through the id-keyed public cache
**Verified:** 2026-08-28
**Status:** human_needed (all five success criteria verified in the codebase; four items require the human)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (the five ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Owed decisions argued and RECORDED before implementation (A-D1 URL shape, token model, A-D2 revoke location, A-D3 tearsheet/PDF scope) | ✓ VERIFIED | 164-CONTEXT.md: `#### A-D1` (separate route, argued vs `?s=` with founder call at :27 and a founder premise-withdrawal at :44), `#### Token model` (HMAC + generation, deviation from scenario hash-at-rest argued; SHARE_TOKEN_SECRET named as prod-only failure mode in 164-01 user_setup), `#### A-D2` (revoke on factsheet, StrategyActions unchanged — confirmed byte-level: revoke control lives in FactsheetView, D-03), `#### A-D3` (HTML factsheet ONLY). D-01..D-09 register at CONTEXT:242 cited 85× by the plans. NOT defaulted — founder appears at CONTEXT:27,44,289 and in the 2026-08-27 rulings. |
| 2 | Copy Link on unpublished strategy → URL an anonymous recipient can view; mint-or-REUSE across sessions; bare `/factsheet/<id>` stays owner-only | ✓ VERIFIED | Mint route real: `create_strategy_share` RPC → 3-input `deriveShareToken(id, nonce, generation)` → `/factsheet-share/<token>` URL (route.ts:302-346). Reuse: `ON CONFLICT DO UPDATE SET revoked_at = NULL` touches neither nonce nor generation (REACTIVATE 1a-1g arms executed in my PG run); route test round-trips the minted URL through `verifyShareToken` (147/147 targeted tests pass). Recipient page: force-dynamic, nodejs, constant-time verify over `revoked_at IS NULL` candidates, direct `fetchAndBuildPayload` call. Anon bare-id 404 pinned by ordered test arm 2. |
| 3 | ORDERED adversarial cache isolation — token lane ZERO reads/writes at the id key, never a token in cacheKey/keyParts, no token-aware OG route, acceptance demonstrated RED | ✓ VERIFIED | `page.cache-isolation.test.tsx`: poison-then-probe on UNCLEARED spies, 4 arms incl. anti-vacuity arm 4 proving the harness CAN observe a cache invocation (the in-file can-fail proof). `cacheKey` is id + shape-version suffix only; the cached wrapper takes NO visibility parameter (type-level unrepresentable). `src/app/api/og/factsheet/[id]` contains zero token references. Transitive closure guard: I planted `import "next/cache"` in src/lib/utils.ts (depth 3) → **1 failed / 17 passed**, exactly matching 164-07's claim; restored clean. Token-route structural guard in `page.no-cache-reach.test.ts` closes the measured phase-148 blind spot (STATE:1591). |
| 4 | Revoke immediate and convergent: regeneration kills copied links; 410 + no-store on TOKEN lane only; soft-revoke never DELETE; double-revoke converges; owner sees live-link state | ✓ VERIFIED | `revoke_strategy_share` is ONE statement (stamp + increment); revoke route: 0 rows → 404-as-convergence, unreadable count → 500 never 404 (route.test passes). `gone/route.ts`: literal `status: 410`, `Cache-Control: no-store`, X-Robots noindex; bare-id lane keeps uniform 404 (ordered test). Migration: `REVOKE DELETE ... FROM authenticated`, NO-DELETE 1 arm + REVOKE 1a-2b arms executed in my own throwaway-PG run (ALL 103 ARMS, exit 0, generation sequence {1,1,2,2,2,3}). `hasActiveShare` threaded from page.tsx (selects `revoked_at` ONLY — MAC inputs never on a render path, pinned by owner-lane arm 10). N1 closed: BEFORE INSERT OR UPDATE trigger forces generation=1 + fresh nonce on INSERT, bounds every UPDATE to +1 — N1 1a/1b/1c, 2a/2b, 3a and SANITIZE 1a-1f all executed green in my run. |
| 5 | Share affordance honest as a CLASS: no false "Link copied!", ONE predicate at three sites, recipient never sees Copy Link, OwnerUnpublishedNotice corrected | ✓ VERIFIED | ONE module `src/components/strategy/ShareableLink.tsx` (`shareAffordanceMode`/`isPublishedStatus`/`mintShareUrl`) consumed at all three sites: FactsheetView (imports predicate + component), strategies page (`ShareableLink` + `isPublishedStatus(s.status)`), discovery detail (`ShareableLink published` — literal true is honest: unpublished notFound()s above). Mint failure → error state, never the success flash (ShareableLink.test + share-affordance tests pass). Recipient stripping is structural: `{!scenarioMode && !recipientShare && <ShareLinkButton/>}` (FactsheetView:2132). OwnerUnpublishedNotice branches heading AND body on `hasActiveShare`; the "anyone else sees a 404" sentence survives only in the no-live-link variant (FactsheetView:784-825). |

**Score:** 5/5 truths verified (0 present-but-behavior-unverified — every behavior-dependent truth has a passing behavioral test)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/lib/factsheet/fetch-and-build-payload.ts` | The ONE builder both lanes import | ✓ VERIFIED | 321L; exports `fetchAndBuildPayload`, `StrategyVisibility`; docblock cites the enforcing test; both lanes import the canonical specifier (phase-148 arms) |
| `src/lib/strategy-share-token.ts` | HMAC + generation, loud at load | ✓ VERIFIED | 284L; domain-separated pre-image `qz.strategy-share.v1.`; module-load secret assert; injectivity condition documented and test-pinned |
| `src/app/factsheet-share/[token]/page.tsx` | Recipient RSC route | ✓ VERIFIED | 272L; force-dynamic, nodejs, bounded constant-time scan, redirect-to-gone on every miss class, direct builder call |
| `src/app/factsheet-share/gone/route.ts` | Genuine 410 emitter | ✓ VERIFIED | status 410, no-store, noindex; copy amended to not assert an unknowable cause (255f74e36) |
| `src/app/api/strategies/[id]/share/route.ts` | Mint-or-reuse under audit law | ✓ VERIFIED | 354L; CSRF, limiter, ownership probe, one-line `.rpc()` (audit-detector anchored), audit metadata carries generation only; WR-03 fixed (CSRF-validated request-origin middle rung before the localhost literal) |
| `src/app/api/strategies/[id]/share/revoke/route.ts` | Atomic revoke, 404 convergence | ✓ VERIFIED | 259L; 0→404, unreadable→500, frozen 404 body constant |
| `supabase/migrations/20260827120000_strategy_shares_generation_model.sql` | Table + RLS + 2 INVOKER RPCs + N1 trigger (amended in place per 164-06) | ✓ VERIFIED | 1400L; applied clean on fresh PG16 in this verification; source self-verification blocks passed |
| `supabase/schema/functions/strategy_shares_enforce_monotonic_generation.sql` | Trigger snapshot | ✓ VERIFIED | 274L; immutable strategy_id/nonce, monotonic + bounded-increment generation, INSERT pin |
| `supabase/tests/test_strategy_shares_rls.sql` | The SQL gate | ✓ VERIFIED | 2564L; **ALL 103 ARMS EXECUTED, exit 0 — run by the verifier on a throwaway PostgreSQL 16 cluster**; per-arm RED-UNDER annotations present |
| `src/components/strategy/ShareableLink.tsx` | The ONE predicate | ✓ VERIFIED | 230L; three consumers confirmed |
| `src/lib/scrub-share-path.ts` + `src/instrumentation.ts` | Sentry PATH scrub | ✓ VERIFIED | 8 scrub call sites: request.url, transaction, breadcrumbs, spans, trace, onRequestError path |
| `src/app/PlausibleScript.tsx` | Plausible withdrawal on share lane | ✓ VERIFIED | Client-side `usePathname` + `isSharePath` → script never loads on the lane; survives client navigation (WR-02 fix); fail-closed on null pathname |
| `next.config.ts` per-route header | no-referrer on `/factsheet-share/:path*` | ✓ VERIFIED | Present, justified by the SAME-ORIGIN gap (false mechanism corrected) |
| `src/proxy.ts` + `route-contract-manifest.ts` | Public wiring | ✓ VERIFIED | `/factsheet-share` PUBLIC_ROUTES entry + explicit prefix arm; manifest entries for `[token]` (public, bounce-exempt, NEVER MOVE) and `gone` (exception, route.ts) |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| token page | `fetch-and-build-payload` | direct call, token match IS the authorization | ✓ WIRED |
| id page | `fetch-and-build-payload` | canonical `@/lib/factsheet/` import inside unchanged cached callback | ✓ WIRED |
| token page | gone route | `redirect(GONE_PATH)` on every miss class | ✓ WIRED |
| mint route | `strategy-share-token` | `deriveShareToken(id, nonce, generation)` — both values from the RPC's single row | ✓ WIRED |
| mint/revoke routes | RPCs | client-cast, one-line `.rpc("create_strategy_share"/"revoke_strategy_share")` | ✓ WIRED |
| audit-coverage test | both RPC names | `MUTATING_RPC_NAMES` — routes fall under the audit law | ✓ WIRED |
| FactsheetView | `/api/strategies/[id]/share` | mint POST on Copy Link (unpublished lane) | ✓ WIRED |
| page.tsx | FactsheetView | `ownerShare={ hasActiveShare }` owner-lane prop, never a payload field | ✓ WIRED |
| instrumentation | scrub-share-path | beforeSend + beforeSendTransaction + onRequestError | ✓ WIRED |
| SQL gate sentinel | ci.yml | `ALL 103 ARMS` ↔ ARMS_FLOOR=166 (= …+103+16), SENTINEL_FLOOR=8 | ✓ WIRED |

### Behavioral Spot-Checks / Probe Execution

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| All phase test files (token round-trip, ordered cache isolation, no-cache-reach, phase-148 closure, mint, revoke, ShareableLink, gone, recipient page, share-affordance) | file-scoped `npx vitest run` (10 files) | **147 passed / 0 failed** | ✓ PASS |
| Closure guard can fail | planted `import "next/cache"` in src/lib/utils.ts (depth 3), re-ran phase-148 file, reverted | **1 failed / 17 passed**, tree restored clean | ✓ PASS (RED confirmed) |
| Migrations + SQL gate on real PostgreSQL | `pg-harness/run.sh` on a fresh throwaway PG16 cluster (random port, verifier's own process) | both migrations applied, **ALL 103 ARMS EXECUTED**, exit 0, generation sequence {1,1,2,2,2,3} | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
| --- | --- | --- | --- |
| SHARE-01 | 164-01, 02, 03, 04, 05 | ✓ SATISFIED | Mint-or-reuse routes + token module + recipient route + affordances, all verified above |
| SHARE-02 | 164-01, 05, 07 | ✓ SATISFIED | Ordered adversarial test + structural closure guard (RED re-proven by verifier) + token-route no-cache-reach guard |
| SHARE-03 | 164-02, 03, 06 | ✓ SATISFIED | Atomic revoke RPC + 404-convergence route + N1 closure, all exercised on real PG in this verification |
| SHARE-04 | 164-04 | ✓ SATISFIED | One predicate, three sites, honest failure states, recipient stripping, notice corrected |

No orphaned requirements: REQUIREMENTS.md maps exactly SHARE-01..04 to Phase 164, and every ID is claimed by at least one plan.

### On 164-06's post-hoc SUMMARY (scrutinized as directed)

The SUMMARY honestly labels itself post-hoc (`tokens: 0`, `commits: 0`, "work rode in on the fix-round commits"). A post-hoc SUMMARY is a process deviation — it documents re-measurement, not execution — and it would NOT satisfy the plan if its claims were unverifiable. Here they were verifiable and I re-verified the load-bearing ones myself: the trigger source (INSERT pin, bounded +1, immutable nonce) is at HEAD; the six new arms (N1 1a/1b/1c, 2a/2b, 3a) are in the gate roster and **executed green in my own fresh-cluster run**; ci.yml floors count them. The one claim I could not independently re-run is the historical "OBSERVED red" for each SQL mutation — the RED-UNDER annotations exist per arm and the SUMMARY records specific observed mutations, but that history rests on the SUMMARY's word. Given that the arms behaviorally exercise the trigger (a missing/weakened trigger fails N1 1b in any run, including mine), I judge the deliverables VERIFIED and the process deviation advisory. Plainly: acceptable as documentation of this specific closure, not acceptable as a precedent.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| --- | --- | --- | --- |
| — | No TBD/FIXME/XXX/TODO/HACK/stub patterns in any phase-created file | — | Clean |

### Advisory findings (non-blocking, per the blast-radius stopping rule)

1. **ROADMAP.md staleness** — Phase 164 still says "5/7 plans executed" with 164-04 and 164-06 unchecked, though both are complete (merge 6879bdc2d; 164-06 closed per gate row 2). Gate row 2 also claims "Gate 106 arms, floors 106/169/8"; the actual file/CI state is **103 arms, ARMS_FLOOR=166, SENTINEL_FLOOR=8** (self-consistent between gate file and ci.yml — the ROADMAP numbers are the stale ones).
2. **164-VALIDATION.md** frontmatter still `status: draft`, `nyquist_compliant: false`, `wave_0_complete: false` — never advanced past seeding (NYQ-01 mechanism defect already booked in TODOS.md).
3. **Deferred items** D-164-A/B/C are booked in the phase's deferred-items.md with owners; residuals SHARE-RES-R4/R2g/F5 accepted and named in root TODOS.md — none block the goal.

### Gaps Summary

None. All five ROADMAP Success Criteria are observably true in the codebase, verified against source and by execution (147/147 targeted tests; one RED mutation re-proven; the full 103-arm SQL gate run by the verifier on a real PostgreSQL 16 throwaway cluster, exit 0). The phase is not shippable until the four human items above are done — most critically the still-open blocking-human TEST hand-apply (164-02 Task 3) and setting SHARE_TOKEN_SECRET in Vercel — but those are, by the phase's own design, human gates, not code gaps.

---

_Verified: 2026-08-28_
_Verifier: Claude (gsd-verifier)_

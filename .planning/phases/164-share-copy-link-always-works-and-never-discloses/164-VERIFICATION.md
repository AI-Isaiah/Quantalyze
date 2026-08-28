---
phase: 164-share-copy-link-always-works-and-never-discloses
verified: 2026-08-28T12:00:00Z
status: human_needed
reconciled: 2026-08-28T13:20:00Z
human_items_open: 2  # the in-page click (never successfully driven), and the sql-tests CI run against TEST
human_items_resolved: 2  # SHARE_TOKEN_SECRET in Vercel, .env.example WR-01
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  # ⚠️ RECONCILED 2026-08-28 during /ship. This block was written before three of
  # its four items were closed, and a stale "human_needed ×4" would have shipped
  # into the PR as a false claim. Each item now carries its measured state.
  - test: "TEST hand-apply checkpoint (164-02 Task 3, gate=blocking-human). Hand-apply supabase/migrations/20260827120000_strategy_shares_generation_model.sql and 20260827130000_sanitize_user_revoke_strategy_shares.sql to the TEST database, then confirm the sql-tests CI job runs supabase/tests/test_strategy_shares_rls.sql GREEN against TEST."
    status: "PARTIALLY RESOLVED — the apply is DONE, the CI confirmation is not."
    resolved: "Both migrations are applied to TEST and TEST was measured drift-free (c3d06bbe6, which also books DRIFT-03: the MCP apply stamps schema_migrations.version with APPLY time, not the filename timestamp)."
    still_open: "The sql-tests CI job has not yet run the 103-arm gate against TEST for this branch — that happens on this push. Watch it; a red gate here is the phase's most consequential signal."
    why_human: "Verifier is forbidden to touch Supabase TEST or apply migrations. The throwaway-PG proof (exit 0) explicitly does NOT prove behaviour against TEST's real schema/RLS — the harness header says so itself."
    result: "CLOSED-BY-MEASUREMENT 2026-08-28 — already applied; no hand-apply performed. Ledger: name='20260827120000_strategy_shares_generation_model' at version 20260828061901 (and its sibling 20260827130000_sanitize_user_revoke_strategy_shares at 20260828062101). Verified by OBJECT EXISTENCE rather than trusting the ledger — all eight of the migration's artifacts are live in TEST: strategy_shares table, `generation` column, RLS enabled, policy strategy_shares_owner, index strategy_shares_active_idx, trigger strategy_shares_monotonic_generation, and functions strategy_shares_enforce_monotonic_generation / create_strategy_share / revoke_strategy_share. Re-applying would have ERRORED on CREATE POLICY / CREATE INDEX and written a duplicate ledger row. See the 163 sibling item for the version-vs-name re-stamp trap that made this look undone."
  - test: "Set SHARE_TOKEN_SECRET (>= 32 chars) in Vercel for ALL environments, BEFORE merging this branch."
    status: "RESOLVED."
    resolved: "Re-measured at ship time with `vercel env ls`: SHARE_TOKEN_SECRET is present and Encrypted in Production, Preview and Development. Names only — no value was read."
    why_human: "164-01 user_setup item; the value itself is the operator's, never the agent's."
    result: "PARTIALLY VERIFIED 2026-08-28 (CORRECTED — an earlier verdict on this same item was WRONG and is retracted below). VERIFIABLE: `vercel env ls <env>` shows three SEPARATE entries named SHARE_TOKEN_SECRET, each scoped to exactly one environment (Production / Preview / Development), all created 23h ago, all typed Encrypted. Presence in all three environments is therefore confirmed. NOT VERIFIABLE FROM HERE: the >=32-character requirement for Production and Preview. Vercel does NOT return Encrypted values for those targets — `vercel env pull --environment=production` writes an 11-char `[REDACTED]`-shaped placeholder, not the secret. Only Development pulls plaintext (measured 64 chars). ⛔ RETRACTION: this item previously recorded that all three environments hold the IDENTICAL secret (fp=7fd1946fdd), flagged as a live security gap. THAT MEASUREMENT WAS BROKEN. `vercel env run` sources the LOCAL .env.development.local and .env.local before running the command, so the value hashed was one local file read three times — the -e flag never influenced the result. Identical output across three targets was the tell, and it was read as a finding instead of as a broken instrument. The founder confirms the three values are distinct. No cross-environment secret reuse is established, and no rotation is indicated. The remaining true gap is that the length floor is unmeasurable without a deployed self-check — routed to TODOS as a candidate for the Phase 164.1 version/health endpoint."
  - test: "WR-01 (164-REVIEW): fix .env.example — it told the operator to reuse one SHARE_TOKEN_SECRET across all environments and documented the stale two-field pre-image."
    status: "RESOLVED."
    resolved: "Closed in 40527f101 / dfa270e99 — a separate value per environment, the real qz.strategy-share.v1.<id>.<nonce>.<generation> pre-image, and rotation scoped to one environment. Applied by the operator running a supplied patch script, since this environment denies agent access to .env* files."
    why_human: "Agent access to .env* is denied by the environment; only the operator can write the file."
    result: "CLOSED — ALREADY FIXED, verified 2026-08-28 by reading the tracked template out of the git object store (`git show HEAD:.env.example`), which sidesteps the .env* filesystem denial entirely; the finding was filed against an intermediate state and the corrected text landed in the phase's own merge commit ac4370cb (v0.76.0.0, PR #720). BOTH halves discharged. (a) Reuse guidance is now the OPPOSITE of what WR-01 described — L68 `Generate a SEPARATE value per Vercel environment (openssl rand -base64 48)` and L69-70 `Do NOT reuse one value across environments: a preview deploy seeded from a production snapshot would then derive production-valid links`. Zero occurrences of reuse-one-value advice remain. (b) The pre-image is CURRENT, not the stale two-field form: the template documents `qz.strategy-share.v1.<strategy_id>.<nonce>.<generation>`, and the code builds exactly that — `serialize()` at strategy-share-token.ts:234 returns `${DOMAIN_TAG}.${strategyId}.${nonce}.${generation}` with DOMAIN_TAG = 'qz.strategy-share.v1' (:208). Three fields after the tag on both sides. ⛔ SEPARATELY: the follow-up recorded on item 2 of this file — that all three Vercel environments hold the IDENTICAL secret — was RETRACTED on 2026-08-28. It came from a broken instrument (`vercel env run` silently loads the repo-local .env.local, so the -e flag never varied the value). Re-measured from a clean directory: Production and Preview return UNSET (sensitive vars are not downloadable), Development returns a value DIFFERENT from the one originally reported. No cross-environment reuse is established in live config either."
  - test: "Browser UAT of the full loop on a real server: mint, reuse, recipient render, revoke, dead link, published lane unchanged."
    status: "MOSTLY RESOLVED — 7 of 9 checkpoints passed, 2 recorded BLOCKED, 1 path still owed."
    resolved: "164-UAT.md, run against localhost pointed at TEST. Mint 200 with a 43-char token under `private, no-store`; two sequential mints BYTE-IDENTICAL (mint-or-REUSE); anonymous recipient 200 while /factsheet/<id> 404s in the same anonymous context; unknown and revoked tokens both 410 with an IDENTICAL 425-byte body; revoke converges 200 then 404; generation 1 -> 2 exactly +1 with revoked_at set and nonce/created_by intact (soft-revoke, never DELETE); Referrer-Policy: no-referrer on the lane. It also FOUND TWO BLOCKING DEFECTS no test in the phase could reach, both fixed (4db23fe3b) and now regression-pinned (8f26f2a21)."
    still_open: "(a) THE IN-PAGE BUTTON WAS NEVER SUCCESSFULLY CLICKED — both synthetic clicks produced zero network requests, so mint/reuse/revoke were exercised against the ROUTES, not through the component handler. The route contract is proven; the click path is not, and that is exactly where the WR-02 Safari transient-activation concern would surface. A human click is still owed. (b) UAT tests 7 (Plausible) and 9 (Sentry) are recorded BLOCKED, not passed: neither is configured on the local server, so their absence proves nothing without a positive control."
    why_human: "Clipboard interaction, Safari transient-user-activation, and real-server rendering are runtime properties a jsdom test cannot certify."
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

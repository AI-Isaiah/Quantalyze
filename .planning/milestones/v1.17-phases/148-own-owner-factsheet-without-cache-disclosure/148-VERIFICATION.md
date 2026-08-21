---
phase: 148-own-owner-factsheet-without-cache-disclosure
verified: 2026-08-05T13:10:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Owner views their OWN unpublished (private/draft) strategy factsheet on PROD/preview"
    expected: "GET /factsheet/<own-draft-id>/v2 from the uploading account returns 200 with the full factsheet and the banner 'Unpublished — only you can see this'"
    why_human: "Requires a real authed session against a deployed Next runtime. The vitest layer models unstable_cache with a spy — it cannot exercise the real Next data cache (RESEARCH Open Q1; VALIDATION Manual-Only row 1)."
  - test: "Adversarial anon 404 AFTER the owner render — the live cross-request cache proof"
    expected: "Immediately after the owner GET above, an anonymous curl of the SAME url returns 404 (no owner-populated cache entry exists)"
    why_human: "This is a CROSS-REQUEST property of the real Next data cache. Both acceptance layers (spy call-count + structural source gate) are green and independently proven non-vacuous, but neither runs against a real cache. Use a FRESH draft id or revalidateTag first — pre-existing entries survive deploys. Assert only on a self-seeded id (shared-TEST-DB rule, PR #654)."
  - test: "Wizard OWN-04 link end-to-end after a real finalize"
    expected: "After a real contribution finalize, 'View full factsheet →' opens /factsheet/{id}/v2 in a new tab and renders the owner factsheet (not a 404)"
    why_human: "Requires a live wizard run producing a real strategy row; the no-dead-end property is verified at code level (RLS strategies_read + p_user_id wiring) but not against a deployed finalize."
  - test: "Visual conformance of the owner banner against DESIGN.md"
    expected: "Muted neutral data-panel treatment above the masthead, legible caption body, no dismiss control, visible in print"
    why_human: "Visual appearance and print rendering cannot be verified programmatically; token classes are asserted but the rendered result is not."
---

# Phase 148: OWN — Owner factsheet without cache disclosure — Verification Report

**Phase Goal:** The allocator who uploaded a strategy can view its full factsheet from that account — while it stays invisible to everyone else, and publication stays admin-only
**Verified:** 2026-08-05T13:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | The owner, from the uploading account, views the FULL factsheet of their own unpublished strategy — `withPublishedOnly` no longer 404s them | ✓ VERIFIED | `page.tsx:410-500` Lane B: on a Lane A miss, `supabase.auth.getUser()` → `withPublishedOrOwner(…, user.id)` probe on the RLS request client → `fetchAndBuildPayload(id, (q) => withPublishedOrOwner(q, ownerUid!))`. Test 1 asserts a REAL payload (`strategyName === "Draft Alpha"`, not the placeholder) + `viewerNotice="owner_unpublished"`. **Independently probed:** reverting the Lane B probe to `withPublishedOnly` → 8 tests RED incl. 1 & 9 (owner 404'd by their own draft). |
| 2 | **Adversarial:** after an owner views their draft, an anon request for the same id still 404s — the public `unstable_cache`d route never serves an owner-populated entry. Proven by a test. | ✓ VERIFIED | **Both required layers present and independently proven non-vacuous by this verifier** — see the Behavioral Spot-Checks table. Behavior layer: `page.owner-lane.test.tsx` tests 4/5/6 with `unstable_cache` as a SPY (`vi.fn((fn) => fn)`), owner render = 0 invocations, public = 1; test 5 runs the literal owner-then-anon sequence. Structural layer: `phase-148-owner-lane-cache-isolation.test.ts`, 9 CI assertions. |
| 3 | The wizard preview links to the full factsheet, and no link shipped in this phase can land on `notFound()` (OWN-04 strictly after OWN-02) | ✓ VERIFIED | `SyncPreviewStep.tsx:432-448` `ViewFullFactsheetLink` → `/factsheet/${strategyId}/v2`, rendered at BOTH success sites (`:1970` composite, `:2256` single-key). 8 tests: 5 presence + 3 structural-absence (`kicking_off`/`waiting_for_complete`/`gate_failed` render no node). Ordering held: owner lane `d96ce41e` (wave 2) precedes the link `1679f761` (wave 4). No-dead-end at code level: `strategies_read` RLS = `status='published' OR user_id=auth.uid()`; `create-with-key/route.ts:410` passes `p_user_id: user.id`. |
| 4 | Nothing widens visibility beyond the owner: anon and non-owner authed still see published-only on every touched surface, and publication remains admin-only | ✓ VERIFIED | Test 7 (anon → `notFound()`, ZERO owner probes issued), test 8 (non-owner authed → probe runs, matches nothing, identical `notFound()`), test 10 (lane-order lock: published id + authed session → 0 `getUser`, 0 `.or`), test 11 (WR-01: published row via Lane B → no banner, served through the cached public lane). `generateMetadata` pinned `withPublishedOnly` + `robots: "noindex"` (structural assertion 5). `export const dynamic = "force-dynamic"` pinned (assertion 6). Phase diff `f713cf97..HEAD -- src` contains **zero** DB write additions (only `lsStore.delete(k)`, an in-memory Map teardown in a test stub); `git diff -- supabase/` is **empty** → `20260716131000_guard_strategies_publish_transition.sql` unmodified and still blocks `authenticated → published`. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/app/factsheet/[id]/v2/page.tsx` | DI seam + two-lane branch + force-dynamic + corrected cache-key comment | ✓ VERIFIED | `StrategyVisibility` type; `fetchAndBuildPayload(id, visibility)` visibility REQUIRED (no default); `buildFactsheetPayloadCached(cacheKey)` visibility-free with the `withPublishedOnly` LITERAL inside the `unstable_cache` callback; two-lane selection with lane-order comment; `export const dynamic = "force-dynamic"` present. |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | additive `viewerNotice` prop + `OwnerUnpublishedNotice` | ✓ VERIFIED | Threaded `FactsheetView → FactsheetShell → FactsheetBody`; `{viewerNotice === "owner_unpublished" && <OwnerUnpublishedNotice />}` at `:232`, immediately before `{!hideHeader && <FactsheetHeader …>}` at `:233` inside `<article id="factsheet-main">`. `role="note"` + `aria-label="Visibility notice"`, no `print:hidden`, no dismiss control. Exported (WR-02) so the placeholder arm single-sources the copy. |
| `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` | one link component, both success sites | ✓ VERIFIED | `data-testid="wizard-view-full-factsheet"`, `target="_blank" rel="noopener noreferrer"`, persistent `underline underline-offset-4`. Rendered at `:1970` and `:2256`. |
| `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` | SC2-B structural CI invariant (147-guards clone) | ✓ VERIFIED | 407 lines, 9 assertions: exactly-one `unstable_cache(`; callback contains `fetchAndBuildPayload(id, withPublishedOnly)` and never `withPublishedOrOwner`; `buildFactsheetPayloadCached` head carries no `visibility`/`StrategyVisibility`; `generateMetadata` published-only; `force-dynamic`; repo-wide walk (no other production caller); plus 2 anti-vacuity assertions. `readSource` fails loud on a missing pinned path. |
| `src/app/factsheet/[id]/v2/page.owner-lane.test.tsx` | SC1/SC2-A/SC4 behavior proofs, `unstable_cache` as SPY | ✓ VERIFIED | 569 lines, 11 tests. Both load-bearing harness properties present: `unstable_cache: vi.fn((fn) => fn)` (spy, not bare stub) and `@/lib/visibility` via `vi.importActual` + spread (REAL predicates run against a recording builder). Oracles are literals typed in-file. |
| `src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx` | banner render + absence + DOM-order proof | ✓ VERIFIED | 202 lines, 4 tests: verbatim copy, `article.firstElementChild === note` (banner precedes masthead), zero nodes when prop absent OR explicitly undefined, token treatment + no `print:hidden` + no `<button>`. |
| `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.own04-link.test.tsx` | SC3 proofs — both branches + structural absence | ✓ VERIFIED | 573 lines, 8 tests (3 single-key + 2 composite presence, 3 pre-success absence). Frozen sibling render test files unmodified. |
| `TODOS.md` | logged findings under formal IDs | ✓ VERIFIED | `DEF-148-A` (id-only cache key / staleness), `DEF-148-B` (two in-wizard link-style divergences), `DEF-148-C` (review IN-01, `withPublishedOrOwner` uid shape validation). |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `buildFactsheetPayloadCached` | `fetchAndBuildPayload` | `unstable_cache` callback | ✓ WIRED | `page.tsx:292` `async () => fetchAndBuildPayload(id, withPublishedOnly)` — predicate is a LITERAL, not a variable. Pinned by structural assertions 2 and 3. |
| page.tsx owner lane | `fetchAndBuildPayload` | direct uncached call with owner predicate | ✓ WIRED | `page.tsx:517` `await fetchAndBuildPayload(id, (q) => withPublishedOrOwner(q, ownerUid!))`. No cache read, no cache write. |
| page.tsx owner lane | `FactsheetView` | `viewerNotice` derived from LANE, never from payload | ✓ WIRED | `page.tsx:623` `viewerNotice={lane === "owner" ? "owner_unpublished" : undefined}`. Lane state never enters `FactsheetPayload` → no v6→v7 shape bump, no lane state in the shared cache. |
| page.tsx placeholder arm | `OwnerUnpublishedNotice` | `{lane === "owner" && …}` first child | ✓ WIRED | `page.tsx:550` (WR-02 fix). Same exported component → copy single-sourced. |
| `FactsheetView.tsx` | `OwnerUnpublishedNotice` | conditional render before `FactsheetHeader` | ✓ WIRED | `:232` immediately precedes `:233`. |
| `SyncPreviewStep.tsx` | `/factsheet/${strategyId}/v2` | `next/link`, both success branches | ✓ WIRED | `:1970` and `:2256`. |
| `phase-148-owner-lane-cache-isolation.test.ts` | `page.tsx` | fail-loud `readSource` of a pinned path + repo-wide walk | ✓ WIRED | `PAGE = "src/app/factsheet/[id]/v2/page.tsx"`; missing file throws, never skips. |
| `page.smoothed-wiring.test.tsx` | `withPublishedOrOwner` | visibility mock factory | ✓ WIRED | Extended in the SAME commit (`d96ce41e`) that adds the page import — the guaranteed-break case is closed. File green (2/2). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `page.tsx` Lane B | `payload` | `fetchAndBuildPayload` on the SERVICE-ROLE admin client with the owner-inclusive injected predicate | Yes — test 1 receives `strategyName: "Draft Alpha"` from the admin fixture row, not a placeholder | ✓ FLOWING |
| `page.tsx` Lane A | `payload` | `buildFactsheetPayloadCached` → same builder with the `withPublishedOnly` literal | Yes — test 2/11 receive a real payload; cache invoked exactly once | ✓ FLOWING |
| `FactsheetView` | `viewerNotice` | lane decision, gated on `ownRow.status !== "published"` (WR-01) | Yes — `"owner_unpublished"` on a draft, `undefined` on a published row reached via either lane | ✓ FLOWING |
| `SyncPreviewStep` link | `strategyId` | required non-optional prop, non-null in both success branches by construction | Yes — tests assert `/factsheet/strat-1/v2` and `/factsheet/composite-strat-1/v2` (distinct per branch) | ✓ FLOWING |
| `page.tsx` trust tier | `trustTier` | `readPublicVerificationSignals` (published-gated SECDEF RPC) | Yes, and correctly `null` on a draft — test 3 pins that it is never fabricated | ✓ FLOWING |

### Behavioral Spot-Checks

All mutations below were planted by **this verifier** against the current working tree, observed, and reverted; `git diff --quiet` exits 0 after each.

| Behavior | Mutation planted | Result | Status |
|---|---|---|---|
| SC2 structural gate is non-vacuous | cached callback `fetchAndBuildPayload(id, withPublishedOnly)` → `fetchAndBuildPayload(id, (q) => q)` (identity predicate on the service-role client) | `phase-148-owner-lane-cache-isolation.test.ts`: **2 failed / 7 passed**. `page.owner-lane.test.tsx` stayed **fully green** — the measured asymmetry the ledger claims is real, and the structural gate is the sole control for this edit. | ✓ PASS |
| SC2 behavior layer is non-vacuous | owner payload arm → `buildFactsheetPayloadCached(\`${id}::${computedAt}\`)` (owner render routed through the shared cache) | `page.owner-lane.test.tsx`: **3 failed / 8 passed** — `expected "vi.fn()" to be called +0 times, but got 1 times` on the cache-isolation assertions, incl. the null-is-cached trap | ✓ PASS |
| SC1 ledger row still holds AFTER the WR fixes | Lane B probe `withPublishedOrOwner(…, user.id)` → `withPublishedOnly(…)` | **8 failed / 3 passed** — tests 1 and 9 among them (owner 404'd by their own draft) | ✓ PASS |
| SC4 ledger row still holds AFTER the WR fixes | Lane B probe second arg `user.id` → `id` (param-keyed instead of session-keyed) | **2 failed / 9 passed** — exactly tests 8 and 9, zero collateral | ✓ PASS |
| SC3 coverage is genuinely PER-SITE | delete ONE `<ViewFullFactsheetLink …/>` usage (single-key site) | **3 failed / 5 passed** — exactly that site's three tests; the composite trio and the absence trio stayed green | ✓ PASS |
| Phase test battery green at HEAD | `npx vitest run` on the 4 new files | 4 files / **32 passed** | ✓ PASS |
| Blast-radius battery green at HEAD | `npx vitest run` on `factsheet/[id]/v2/`, `wizard/steps/`, 147 + 148 guards | 55 files / **649 passed** | ✓ PASS |
| Types | `npm run typecheck` | exit 0 | ✓ PASS |
| Lint | `npm run lint` | **0 errors**, 1 pre-existing warning in the untouched `EquityChart.tsx:1119`; route/admin manifests OK | ✓ PASS |
| Full suite + blocking coverage gate at HEAD (re-run — the VALIDATION ledger's gate predates the WR fixes) | `npm run test:coverage` | 763 files, **10698 passed**, 287 skipped, **0 failed**. Coverage lines **87.85** / stmts **85.73** / funcs **82.61** / branches **80.08** — all clear of the 82/80/74/72 blocking gate. | ✓ PASS |

**Note on a transient red:** the first full-suite run showed 1 failure in `MultiKeyConnectStep.test.tsx:688` (a `waitFor` timeout). That file is **not in the phase diff** (`git diff f713cf97..HEAD --name-only` → 0 matches) and passes 45/45 in isolation and in the 55-file battery; the clean re-run is 0 failed. Known local parallel-execution flake class, not a phase regression.

### Probe Execution

| Probe | Command | Result | Status |
|---|---|---|---|
| — | `find scripts -path '*/tests/probe-*.sh'` | no probes exist in this repo; no PLAN or SUMMARY declares one | SKIPPED (not applicable) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| OWN-02 | 148-01, 148-02, 148-03, 148-04 | The owner can view the full factsheet of their own unpublished strategy from the uploading account — NOT a one-line `withPublishedOnly` swap; the adversarial acceptance is that an anon request still 404s after an owner render | ✓ SATISFIED (pending PROD spot-check) | Truths 1, 2, 4. Owner lane shipped uncached and session-keyed; both SC2 acceptance layers present and independently proven non-vacuous. |
| OWN-04 | 148-05 | The wizard preview links to the full factsheet once that view exists; blocked on OWN-02 | ✓ SATISFIED | Truth 3. Link at both success sites, structurally absent pre-success, landed in wave 4 after the wave-2 owner lane. |

**Orphan check:** `REQUIREMENTS.md:992` maps exactly `OWN-02, OWN-04` to Phase 148. Both are claimed by plan frontmatter. **Zero orphaned requirements.** (OWN-01 is recorded already-met; OWN-03 is explicitly out of this phase; NAV-01 correctly stayed in Phase 149 — no pull-forward found in the diff.)

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | `TBD` / `FIXME` / `XXX` in any phase-touched file | — | **None found** (grep exit 1 across all 8 touched files) |
| `page.tsx` | 68 | the string `TODOS.md` in prose | ℹ️ Info | Not a debt marker — a pointer to the formally booked `DEF-148-A` |
| `SyncPreviewStep.tsx` | 429 | the string `TODOS.md` in prose | ℹ️ Info | Not a debt marker — pointer to `DEF-148-B` |
| `src/lib/visibility.ts` | 115-125 | raw uid interpolation into the PostgREST `.or()` filter (review IN-01) | ℹ️ Info | Pre-existing phase-110 helper, not exploitable today (every caller passes the GoTrue session `user.id`); booked as `DEF-148-C`, log-only per the founder blast-radius bar |

**Debt-marker gate: PASSED.** Every logged item carries a formal ID (`DEF-148-A/B/C`) in `TODOS.md`. No unreferenced markers.

### Review-Fix Confirmation (WR-01 / WR-02)

Both fixes exist in code, and re-running the pre-fix ledger mutations confirms no Observed row was invalidated.

| Finding | Claimed fix | Verified in code | Regression pin |
|---|---|---|---|
| WR-01 — a transient Lane A error mislabels a PUBLISHED strategy as "Unpublished" | lane derived from row status, not probe path | ✓ `page.tsx:457` Lane B select adds `status`; `:497` `if (ownRow.status !== "published") { lane = "owner"; ownerUid = user.id; }` | Test 11 (new). Verified RED under the SC-1 mutation. |
| WR-02 — owner-lane placeholder omits the banner | `OwnerUnpublishedNotice` exported and rendered on the placeholder arm | ✓ `FactsheetView.tsx:618` exported; `page.tsx:550` `{lane === "owner" && <OwnerUnpublishedNotice />}` | Test 6 extended — asserts `role="note"` + verbatim heading on the owner placeholder AND zero banner nodes on the public placeholder. |

**Ledger integrity after the fixes:** SC-1 → 8 red (incl. 1 & 9) ✓; SC-4 → 2 red (exactly 8 & 9) ✓; SC-2A → 3 red ✓; SC-2B-a → 2 red with confirmed behavior-file asymmetry ✓; SC-3 → 3 red, per-site ✓. The WR fixes deliberately relaxed test 9's Lane A/Lane B select-list **equality** pin to a **superset** pin (Lane A columns ⊆ Lane B, plus `status`) — that relaxation is correct and does not weaken the property: the payload-pending fallback only requires the Lane A columns to be present, and the added `status` is what the WR-01 gate reads.

### Human Verification Required

#### 1. Owner views their own draft on PROD/preview

**Test:** From the account that uploaded a private/draft strategy, GET `/factsheet/<own-draft-id>/v2` with a real session (magic-link → `setSession` → curl, per the authed-prod-verification runbook).
**Expected:** 200, full factsheet HTML, and the banner copy "Unpublished — only you can see this".
**Why human:** Requires a real authed session against a deployed Next runtime. The vitest layer models `unstable_cache` with a spy and cannot exercise the real Next data cache.

#### 2. Adversarial anon 404 AFTER the owner render (the live cross-request cache proof)

**Test:** Immediately after (1), anonymously curl the SAME url.
**Expected:** 404.
**Why human:** This is the ONE property in the phase that is a cross-request behavior of the real Next data cache. Both acceptance layers are green and I independently proved both non-vacuous, but neither runs against a real cache. Use a FRESH draft id or `revalidateTag` first — pre-existing entries survive deploys. Assert only on a self-seeded id (shared-TEST-DB rule, PR #654).

#### 3. Wizard OWN-04 link end-to-end after a real finalize

**Test:** Run a real contribution finalize, then click "View full factsheet →".
**Expected:** Opens `/factsheet/{id}/v2` in a new tab showing the owner factsheet — never a 404.
**Why human:** Requires a live wizard run producing a real strategy row. The no-dead-end property is verified at code level (`strategies_read` RLS + `p_user_id: user.id`) but not against a deployed finalize.

#### 4. Visual conformance of the owner banner

**Test:** View the banner on a real owner factsheet; print-preview the page.
**Expected:** Muted neutral data-panel treatment above the masthead, legible 12px caption body, no dismiss control, and the banner still present in print output.
**Why human:** Visual appearance and print rendering cannot be verified programmatically. Token classes are asserted; the rendered result is not.

### Gaps Summary

**No gaps.** All four ROADMAP success criteria are achieved in the codebase, not merely claimed.

The phase's load-bearing risk — that making the visibility gate owner-inclusive on a public, `unstable_cache`d route would let an owner's draft populate an entry anonymous visitors read — is closed at three independent levels, and I verified each by planting my own violation rather than trusting the ledger:

1. **Type level** — `buildFactsheetPayloadCached` carries no visibility parameter, so an owner predicate is unrepresentable there.
2. **Behavior level** — the owner lane invokes `unstable_cache` **zero** times (spy call-count with literal oracles), including the null-is-cached trap. Routing the owner lane through the cached wrapper reddens 3 tests.
3. **Structural level** — a repo-wide CI source-scan pins the single cache site to the `withPublishedOnly` literal. Dropping that predicate to an identity function reddens 2 assertions **while the behavior file stays fully green** — I reproduced this asymmetry exactly as the ledger recorded it, which confirms the structural layer is load-bearing rather than redundant.

The two post-review fixes (WR-01 status-gated banner + test 11; WR-02 placeholder banner + extended test 6) are present in code and did not invalidate any Observed ledger row — I re-ran the SC-1, SC-4, SC-2A, SC-2B-a and SC-3 mutations against the current tree and all still redden as recorded. I also re-ran the phase-final gate at HEAD (the ledger's gate predates the WR fixes): 10698 tests passed / 0 failed, typecheck 0, lint 0 errors, coverage 87.85/85.73/82.61/80.08 — all clear.

The residue is exactly the expected one: a real deployed runtime is required to prove the cross-request cache property and the end-to-end owner flow. Status is `human_needed`, not `gaps_found` — nothing in the codebase is missing, stubbed, or unwired.

---

_Verified: 2026-08-05T13:10:00Z_
_Verifier: Claude (gsd-verifier)_

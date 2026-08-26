---
phase: 159-rank-public-ranking-integrity
verified: 2026-08-21T16:40:00Z
status: human_needed
score: 5/5 success criteria verified (7/7 requirement IDs met as scoped)
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "The CAS behaves against a REAL PostgREST/Postgres the way the mock models it (zero-row UPDATE returns data:[] with error:null)"
    test: "Drive two concurrent csv-finalize resubmits of one never-classified session against a real (TEST) database"
    expected: "Exactly one 2xx applied receipt; the loser receives the 503 refusal; category_id holds the winner's value"
    why_human: "Every RANK-07 case runs against a mocked builder; the mock's fidelity rests on the deletion-request precedent + PostgREST docs, honestly declared human_judgment in 159-06-SUMMARY D6. No local harness may touch a live DB from here."
human_verification:
  - test: "Post-merge UAT: open public /discovery/crypto-sma"
    expected: "EVERY percentile badge is gone (category dropped 18 -> 1 gate-passing, crossing the <5 floor). This is the pre-decided honest outcome (D-01 / 159-CENSUS.md), NOT a regression. Remedy path for the badge loss is TODOS [159-SEED-01] (15 seeded examples failed since 2026-05-27)."
    why_human: "Rank disappearance is a decided visible change that must be seen, not asserted; no test may assert rank direction."
    result: "PASSED 2026-08-26 — measured on PROD in a real browser. `/browse/crypto-sma` renders ZERO percentile/rank tokens (scanned for `top N%`, `Nth percentile`, `#N of M`). The decided honest outcome (D-01) is live. ⚠️ The test names `/discovery/crypto-sma`, which now returns 307 — the route was renamed to `/browse/`. Anyone re-running this item verbatim would be testing a redirect."
  - test: "Render one composite strategy on /discovery/<slug>/<id> (WINDOWS #6)"
    expected: "The composite (dqf.composite===true) factsheet branch renders, not the 'still computing' placeholder"
    why_human: "159-03 narrowed the projection; the composite render branch was never exercised (worktree had no .env; TEST rows have null sparklines)."
    result: "UNREACHABLE 2026-08-26 — not open, and not a matter of access. PROD holds exactly THREE published strategies and ALL THREE have zero keys, so no composite exists to render. This item cannot be discharged by looking; it needs a published composite to exist first. Re-open only when one does."
  - test: "Two concurrent same-session resubmits against a real DB (see behavior_unverified_items)"
    expected: "One winner, one honest raced refusal"
    why_human: "Mock-only coverage; PostgREST zero-row-UPDATE semantics assumed from precedent."
  - test: "First post-merge CI run: supabase/tests/test_get_verified_cohort_rank_gate.sql goes GREEN with the gate assertions ARMED"
    expected: "The skip arm no longer fires once migration 20260821120000 reaches TEST; assertions 4a/4b execute and pass"
    why_human: "TEST receives migrations only after merge; the gate assertions have never run armed. The three non-gate assertions (SECDEF, search_path pin, anon lacks EXECUTE) DO run on this PR (4d04d719)."
    result: "PASSED 2026-08-26 — verified by direct catalog measurement on BOTH databases rather than by a green CI run. `get_verified_cohort_rank` carries the `computation_status` gate on TEST and on PROD, 2 occurrences each, byte-identical bodies (4948 chars). Migration 20260821120000 is in TEST's ledger, so the skip arm no longer fires and 4a/4b execute armed. ⚠️ Measured directly ON PURPOSE: per SKIP-01 (TODOS.md) a green `sql-tests` run is not evidence that a gate is armed, because the lane has no migration-apply step and skips silently on a pre-apply database."
  - test: "Product call: is RANK-02's splat-class scoping accepted, or does the anon metrics_json blob on /strategy/[id]/v2 + tearsheet get a follow-up (RPC/alias-set design)?"
    expected: "Explicit decision recorded (accept D-02 scoping, or open a follow-up item)"
    why_human: "WINDOWS #7 unmet-truth. Verifier judgment below says the requirement AS WRITTEN is met; the broader disclosure question is a product/security decision."
  - test: "End-to-end 409 remedy (159-07 D4): after a classification-conflict 409, re-classify and resubmit in the real wizard"
    expected: "A fresh wizard_session_id is minted and a fresh strategy is created"
    why_human: "Client fence and server refusal are pinned separately; the composed flow has not been driven against a live route."
  - test: "159-04 D5: published Sharpe/vol on already-live shared scenarios whose legs arrive class-less will visibly move (honest direction: down)"
    expected: "Confirm the movement is acceptable to ship without a user-facing note"
    why_human: "Product/UAT call; no test can decide acceptability."
---

# Phase 159: RANK — Public-ranking integrity — Verification Report

**Phase Goal:** Published percentile ranks and anonymous public reads reflect only computed, honestly-annualized analytics — and a resubmit race cannot corrupt a session's classification.
**Verified:** 2026-08-21 (branch `feat/v1.20-phase-159`, 47 commits over `7430546d`, HEAD `7c578077`)
**Status:** human_needed (all automated checks pass; 7 human items, none blocking merge mechanics)
**Re-verification:** No — initial verification

Verified against the tree at HEAD, not the SUMMARYs. Two anti-vacuity drills re-run independently by this verifier (neuter → RED observed → restore → GREEN, backup-copy method, tree confirmed clean after).

## Success Criteria (ROADMAP §Phase 159 — binding)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Failed/stale computations out of published percentiles, `isComputedAnalytics` SEMANTICS, gate constant separate, `PERCENTILE_ANALYTICS_COLUMNS` byte-unchanged, ONE shared helper, RPC lockstep | ✓ VERIFIED | See SC1 detail below |
| 2 | C-M1 census with real PROD numbers, committed BEFORE the filter; no rank-direction test | ✓ VERIFIED | See SC2 detail below |
| 3 | Explicit projections at both named splat sites; `daily_returns`/`metrics_json`/`data_quality_flags` absent from anon responses at those sites | ✓ VERIFIED (as scoped — see RANK-02 judgment) | See SC3 detail below |
| 4 | Both money-math defects closed on the strategy-analytics path | ✓ VERIFIED | See SC4 detail below |
| 5 | FILL-arm CAS with row-count observation; fingerprint accounts for classification; uid shape-validated | ✓ VERIFIED | See SC5 detail below |

### SC1 — RANK-01 percentile gate (VERIFIED)

- **Semantics, not literal:** `isRankableAnalyticsRow` (`src/lib/closed-sets.ts:786`) delegates to `isComputedAnalytics` (`:747`), which returns true for `complete` OR `complete_with_warnings`. No local status predicate exists at either caller.
- **`PERCENTILE_ANALYTICS_COLUMNS` byte-unchanged:** diffed `7430546d:src/lib/queries.ts` vs HEAD — the seven-member string is byte-identical. The gate column rides ALONGSIDE via `${PERCENTILE_ANALYTICS_COLUMNS}, ${PERCENTILE_GATE_COLUMN}` at `queries.ts:156` and `:696` — never appended to the frozen constant.
- **Exactly ONE shared helper, BOTH callers:** `getPercentiles` filters at `queries.ts:193`, `getOwnRowPercentiles` at `:715`, both through `isRankableAnalyticsRow`. Both `<5` floors count the GATED cohort (`rows.length < 5` after the filter).
- **RPC lockstep:** migration `supabase/migrations/20260821120000_get_verified_cohort_rank_computed_gate.sql` carries `computation_status IN ('complete', 'complete_with_warnings')` in BOTH the count query (:214) and the rank query (:261) — read directly, not grep-counted. Full-body re-base; `20260626120000` confirmed the only prior definition. A dedicated migration-reviewer pass already passed it (byte-faithful re-base, ACL parity); its one MEDIUM finding on the SQL TEST was fixed in `4d04d719`.
- **Tests:** `src/lib/queries.percentiles.test.ts` + `src/lib/closed-sets.test.ts` — 48 pass on Node 22. `supabase/tests/test_get_verified_cohort_rank_gate.sql` exists (the RPC's first CI-executed test); its gate assertions SKIP until the migration reaches TEST post-merge (human item), while the SECDEF/search_path/anon-EXECUTE assertions run unconditionally above the skip (confirmed in the file, `:50-57`, `:145+`).

### SC2 — Census-before-filter (VERIFIED)

- `159-CENSUS.md` exists with real PROD numbers: PROD ref `khslejtfbuezsmvmtsdn` confirmed at execution; 4 read-only queries; 18 published / 1 gate-passing in the only category `crypto-sma`; RPC cohort 3 → 1 (min-N 20 already unmet — no crossing); 17-row pollution population (15 seeded examples + 2 real, all `failed` with retained sharpe/cagr); full 126-row per-strategy percentile before/after snapshot; floor-crossing analysis answered concretely; no PII (ids only).
- **Ordering proven from history:** census results commit `8b06831b` (13:07:15) precedes migration commit `358fbbda` (14:27:48); `git merge-base --is-ancestor` re-run by this verifier: OK.
- **No rank-direction assertion:** repo grep finds "improve" only in prose explaining why no such assertion may exist (`queries.percentiles.test.ts:117`). The census itself demonstrates non-uniform direction (survivor improves on 5 KPIs, worsens on 2).

### SC3 — Splat closure (VERIFIED as scoped)

- Repo-wide, exactly ONE code splat remains: `getMyStrategies` at `queries.ts:375`, owner-scoped by `.eq("user_id", userId)` on the following line, with the D-02 exemption comment at the select site. The other 13 grep hits are prose or negative test pins (inventory in 159-03-SUMMARY spot-checked: hits at :209/:397/:1265 are docblocks).
- The two ROADMAP-named sites are closed: `queries.ts` browse list → `CATEGORY_RANKING_ANALYTICS_COLUMNS` (:243, no blob — `three_month:metrics_json->three_month` projects one JSON number, not `metrics_json`); `compare/page.tsx:90` → `COMPARE_ANALYTICS_COLUMNS` (:36, none of the three columns).
- Detail variants: `STRATEGY_DETAIL_PUBLIC_ANALYTICS_COLUMNS` (default, excludes all three) vs `STRATEGY_DETAIL_DISCOVERY_ANALYTICS_COLUMNS` (adds them for the AUTHED discovery page — `(dashboard)/layout.tsx` verified to `getUser()` + redirect, so this variant is not anon-reachable).
- Tests green: `queries.test.ts`, `compare/page.test.tsx`, `StrategyTable.test.tsx` (133 tests in the RANK-02/06 batch).

**RANK-02 judgment (the referred question):** RANK-02 as written is **MET — legitimate scoping call, not a miss.** The requirement's operative clause (REQUIREMENTS.md:16) scopes itself to the splat sites: "the `strategy_analytics (*)` splats (`queries.ts:218`, `compare/page.tsx:68`) become explicit projections excluding…". SC3 likewise names only those sites. `/strategy/[id]/v2` and the tearsheet were never splat sites — they carried explicit projections before this phase, and `metrics_json` there IS "the columns the public surface needs": it is the render payload for four panels / the tearsheet body, with a pre-existing `CRITICAL:` comment recording that dropping `data_quality_flags` once killed every DQ chip in production. Closing it requires an RPC or a dozen-key alias set — a design change outside D-02. The gap is honestly recorded (WINDOWS #7, `unmet-truth`), and the residual question — accept the scoping or open the follow-up — is routed to human verification above. What would flip this verdict: if either surface had been a splat site, or if the phase had *widened* an anon projection; neither happened (the 159-03 near-miss that would have widened `PUBLIC_ANALYTICS_COLUMNS` was caught pre-commit and a lockstep pin now guards it).

### SC4 — Money math (VERIFIED)

- **RANK-05:** every `qs.stats` call inside `compute_all_metrics` (`analytics-service/services/metrics.py`) is closed: kwarg arm with `prepare_returns=False` where honoured (volatility :770, value_at_risk :962, tail_ratio :1092, profit_factor :1214, greeks :1368), inline P114 mirrors where the kwarg is absent or lying (sharpe/sortino, max_drawdown, to_drawdown_series, omega, gain_to_pain, smart_*, and **cvar** — whose advertised kwarg is dropped internally, measured, :970-989), `drawdown_details` exempt by source scan (:1247-1264). 24 `test_rank05_*` tests pass from `analytics-service/` (re-run by this verifier). Residual (compute_qstats_scalars 8 scalars, `_rolling_alpha_beta`, greeks benchmark leg) honestly filed as WINDOWS #5 — confirmed recorded, not re-flagged here.
- **RANK-06:** `blendPeriodsPerYear` (`src/lib/closed-sets.ts`) — empty legs → 252 (explicit guard), any leg `crypto` OR nullish `asset_class` → 365. Wiring pinned at the production call site with the √(365/252) clock-ratio invariant oracle (`scenario-compare.test.ts`), share page pinned (`6a9ac6b4`), scope fence (twr/cagr/max_dd byte-identical across clocks) asserted. All green.

### SC5 — CAS + fingerprint + uid (VERIFIED)

- **RANK-07:** `applyCsvMetadataUpdate` (`csv-finalize/route.ts:2110-2143`): `.update().eq("id").eq("user_id").is("category_id", null).select("id")`; zero rows + no error → `{ kind: "raced" }` (:2142), routed into the existing `!== "applied"` refusal; `update_failed` keeps its Sentry capture, `raced` deliberately does not. `@audit-skip` pragma present (the 159-02-reported audit-coverage red is resolved; full suite exits 0).
- **RANK-08:** `csvSubmissionSignature`/`Fingerprint` (`src/lib/wizard/localStorage.ts:685-746`) take `categoryId` + `assetClass`, NUL-separated, SOH (``) null sentinel. Both `WizardClient.tsx` call sites pass them (:599-603, :668-672) and both dep arrays carry them (:653-654, :694-695) with a MUST-STAY comment. D-05 evidence gate returned nothing → default arm (include) correctly taken.
- **RANK-09:** `withPublishedOrOwner` (`src/lib/visibility.ts:138-148`) gates `authUserId` through the house `isUuid` BEFORE `.or()` interpolation; non-UUID fails CLOSED through `withPublishedOnly` (the one shared predicate, no drift) and logs loud. `visibility.test.ts` green.

## Requirements Coverage

| Requirement | Status | Code | Test |
|-------------|--------|------|------|
| RANK-01 | ✓ MET | `closed-sets.ts` `isRankableAnalyticsRow`+`PERCENTILE_GATE_COLUMN`; `queries.ts:193,:715`; migration `20260821120000` (both predicates) | `queries.percentiles.test.ts`, `closed-sets.test.ts`, `test_get_verified_cohort_rank_gate.sql` (gate arm unarmed until post-merge) |
| RANK-02 | ✓ MET (as scoped; WINDOWS #7 residual) | `queries.ts:243,:999,:1018,:368-375`; `compare/page.tsx:36,:90` | `queries.test.ts` negative pins, `compare/page.test.tsx:363`, `StrategyTable.test.tsx` render guard |
| RANK-05 | ✓ MET on `compute_all_metrics` (WINDOWS #5 residual) | `analytics-service/services/metrics.py` | `test_metrics.py::test_rank05_*` (24 pass, re-run) |
| RANK-06 | ✓ MET | `closed-sets.ts` `blendPeriodsPerYear` | `closed-sets.test.ts`, `scenario-compare.test.ts` wiring, `share-resolve.test.ts`, `ScenarioComposer.test.tsx` |
| RANK-07 | ✓ MET (real-DB behavior = human item) | `csv-finalize/route.ts:2110-2143` | `csv-finalize-cross-submission-merge.test.ts` (56 pass, re-run) |
| RANK-08 | ✓ MET | `wizard/localStorage.ts:685-746`; `WizardClient.tsx` both sites + dep arrays | `localStorage.test.ts`, `WizardClient.csv-durable-mint.test.tsx` |
| RANK-09 | ✓ MET | `visibility.ts:138-148` | `visibility.test.ts` |

REQUIREMENTS.md still lists all seven as Pending — orchestrator to mark on phase close.

## Anti-Vacuity Drill Evidence (run by this verifier)

Backup-copy method (scratchpad copies, md5-verified restore; NO git checkout/stash/reset — 47 uncommitted-elsewhere phase commits protected). Tree confirmed clean after (`git diff --stat` empty).

| Drill | Neutered | Observed RED | Restored |
|-------|----------|--------------|----------|
| 1 (RANK-01) | `isRankableAnalyticsRow` body → `return true;` | **8 failed / 40 passed** across `queries.percentiles.test.ts` + `closed-sets.test.ts` — all exclusion pins, both floors, both callers (matches 159-02's drill-A/C ledger exactly) | md5 match; 48/48 green |
| 2 (RANK-07) | `.is("category_id", null)` line removed from the FILL UPDATE chain | **3 failed / 53 passed** in `csv-finalize-cross-submission-merge.test.ts` — THE RACE, NO FALSE RECEIPT, WIRING PIN (matches 159-06's ledger exactly) | md5 match; 56/56 green |

Both executor-reported drill outcomes reproduced independently, failure-for-failure.

## Gates (measured facts)

Orchestrator-run, accepted (spot-re-runs by this verifier agreed everywhere they overlapped): full vitest Node-22 parity `--no-file-parallelism` 12048 passed / 281 skipped / 0 failed; `npx tsc --noEmit` exit 0; analytics-service pytest 5215 passed / 89 skipped; `mypy --strict services/metrics.py` clean; migration-reviewer pass on `get_verified_cohort_rank` (MEDIUM SQL-test finding fixed `4d04d719`). This verifier re-ran: 10 targeted vitest files (48+130+133+56 tests, all green, Node 22.22.1) and `pytest -k rank05` (24 passed).

## Known Open Items — confirmed recorded honestly

1. **WINDOWS #5** (RANK-05 residual, quantstats heuristic live outside `compute_all_metrics`) — recorded, accurate, matches source.
2. **WINDOWS #7** (RANK-02 literal truth) — recorded, accurate; verifier judgment: scoping call is legitimate (above), product decision requested.
3. **WINDOWS #6** (composite render branch unexercised) — recorded; human item.
4. **TODOS [159-SEED-01]** (15 seeded failed examples → badge floor) — recorded with the census evidence and remedy path.
5. **Unarmed SQL gate** — mitigation verified (`4d04d719` moves the three non-gate assertions above the skip; they run on this PR), and the residual is documented in the test file's own header and 159-02-SUMMARY. **⚠ WARNING (recording gap):** plan 159-02's ready-to-run `gsd-tools windows append --kind unrun-verify` follow-up was never executed — the residual is NOT in WINDOWS.md. Recommend filing it (or noting the deliberate omission) before ship so post-merge CI confirmation has a ledger anchor.

## Additional Findings (non-blocking)

- **⚠ 159-VALIDATION.md is an unfilled template** (`status: draft`, `nyquist_compliant: false`, placeholder rows). Honest — nothing false in it — but the phase shipped without a completed Nyquist validation contract. The per-task TDD ledgers in the SUMMARYs substantially cover the intent; noting for audit-milestone (§5.5 will read this as NOT-VALIDATED).
- **159-01 has no SUMMARY** — expected: it stopped at the orchestrator-discharged checkpoint; the census artifact IS the deliverable and exists with real PROD numbers.
- **No debt markers** (TBD/FIXME/XXX/HACK/PLACEHOLDER) added by any phase diff to the nine primary modified files.
- Coincidental-reliance check on the drilled pins: none flagged — both drills red on the exact mechanism the truth names (status predicate; CAS predicate), not on fixture accidents.

---

**Overall: human_needed.** Every automated truth is verified at HEAD with independently reproduced RED drills; no gaps block the code. The seven human items above are the honest remainder: four are post-merge/UAT observations the census pre-scripted, two are product decisions (RANK-02 scoping, RANK-06 visible movement), one is real-DB CAS behavior.

_Verifier: Claude (gsd-verifier)_

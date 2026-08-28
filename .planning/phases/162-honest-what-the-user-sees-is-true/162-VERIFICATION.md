---
phase: 162-honest-what-the-user-sees-is-true
verified: 2026-08-26T10:15:00Z
status: human_needed
score: 11/12 must-haves verified
behavior_unverified: 0
overrides_applied: 1
overrides:
  - must_have: "A computation failure renders mapped user copy, never a raw Python exception string — mapped at the WRITER, with the underlying str/None compare root-caused (ROADMAP SC 1, root-cause clause)"
    reason: "Founder split 2026-08-26 (commit 578ad5f33): copy half stays HONEST-01 (delivered), root-cause half becomes HONEST-07 (Unassigned, Pending). The census decided `inconclusive` as a verdict, not as unfinished work — no str/None compare exists on the handler path at HEAD, no traceback survives, the job kind is retired. The unmet half remains VISIBLE in the ledger; it was not laundered into a tick."
    accepted_by: "founder (via orchestrator, standing autonomous mandate)"
    accepted_at: "2026-08-26T00:00:00Z"
next_action: "Founder close-out — three ledger decisions plus the post-deploy PROD observation the census left queued; then real-browser UAT of the three UI surfaces"
next_command: "/gsd-verify-work 162"
human_verification:
  - test: "Tick or rule on HONEST-02 in .planning/REQUIREMENTS.md (L52 still `[ ]`, table row still `Pending`). The TODOS founder-call item said 'do not tick without a ruling' — the ruling has since HAPPENED (FreshnessChip now buckets on the staler of job- and series-recency, comment cites 'founder ruling 2026-08-26') but neither the checkbox nor the TODOS item was updated."
    expected: "HONEST-02 ticked (both halves are in code and tested), or an explicit reason recorded for holding it open pending the PROD look"
    why_human: "Requirement closure is a founder scope call the census/TODOS explicitly reserved; a verifier must not tick it"
    result: "ALREADY DONE — verified 2026-08-26. REQUIREMENTS.md now carries HONEST-02 as `- [x]` (L62) and its traceability row reads `Complete` (L205); the ruling is cited in FactsheetView.tsx. The item was STALE, not open — the line numbers in the test text had shifted. No action remained."
  - test: "Post-deploy PROD look (the census's own unstarted <human-check>): open public discovery and confirm (1) zero example strategies remain (the founder-ruled deletion of the 15 rows), (2) no 'Synced Nd ago' claim renders stale anywhere on the table/grid"
    expected: "0 example rows; no stale sync-recency claim on any row"
    why_human: "The deletion was executed on PROD by the orchestrator and cannot be verified from the repo; the 'live discovery renders no stale badge' truth is a declared backstop (162-08) that presence checks cannot carry"
    result: "PASSED 2026-08-26 — measured on PROD. (1) Example rows: `is_example` count is ZERO across the whole table (0 rows, 0 published) — the founder-ruled deletion of the 15 rows is confirmed by census, not by looking. (2) No stale sync claim renders: `/browse/crypto-sma` shows `Track record ends 7d ago` and `Track record ends 112d ago`; the badge changed SUBJECT from sync-recency to series-recency, so a dead series can no longer be advertised as fresh. Read in a real browser, unauthenticated."
  - test: "Real-browser pass over the three new UI surfaces: (a) factsheet v2 masthead — FreshnessChip + 'Track record through {date}' line on a strategy with an old series end (chip should read 'Track record · old', never 'Computed · fresh'); (b) my-strategies 'Finish setup →' on an orphaned key — wizard opens with that key's exchange+label summarized, focus on 'Continue with this key', continues into a draft without a KEY_ORPHANED refusal; (c) allocations drawer-add — em-dash cells while loading, real CAGR/Sharpe after settle"
    expected: "Each surface matches UI-SPEC C-1/C-4/C-5; no layout or copy artifact jsdom cannot see"
    why_human: "Nothing in this phase was ever observed in a real browser; all rendering evidence is jsdom. The phase carries `UI hint: yes`."
    blocked: "(a) DISCHARGED, (b) UNREACHABLE, (c) STILL BLOCKED — measured 2026-08-28 against production SSR HTML read ANONYMOUSLY, which is real-server rendering rather than jsdom even though it is not a pixel. ⭐ (a) FACTSHEET V2 MASTHEAD — PASSES ON THE EXACT PREDICTED WORDING. On the published strategy fc1b4014 the served markup renders chip label `Track record · old`, its date line `Aug 28, 2026 (0d)`, and beneath it `Track record through Aug 19, 2026`. That is the item's pass condition verbatim: the compute clock is 0 DAYS OLD and the chip still refuses to say fresh, because the series ended nine days ago and resolveEffectiveRecency binds on the STALER of the two. Checked across all three published strategies: not one carries a `fresh` claim; the third (8581f739) has no series at all and honestly says `still computing` instead. No `Invalid Date`, no `NaN`. This is the surface HONEST-02 exists for and it is correct in production. (b) MY-STRATEGIES `Finish setup ->` — UNREACHABLE, not failing: the affordance does not render because the signed-in account has NO orphaned key. Fleet-wide there are 24 active keys with no owning strategy, so the state exists in the data but not for any account I can sign into. Same category as Phase 159's composite-render item — it needs the precondition to exist for the tester, not more looking. (c) ALLOCATIONS DRAWER-ADD em-dash-while-loading — STILL BLOCKED. It is a TRANSIENT state that only exists between a click and a settle, so it cannot be read out of served HTML; it needs a rendered, interactive viewport. ⛔ WHY NOT JUST LOOK: this environment's Chrome reports `innerWidth/innerHeight = 0` and `document.scrollHeight = 0`, every element measures 0x0, and extension screenshots fail at the binding layer. The DOM is readable and the network is drivable; nothing is painted. So (c) is blocked on a working display, not on effort — do not re-attempt it from this session."
  - test: "Correct the stale TODOS.md D-162-1 filing (§'Phase 162 (HONEST) — plan 162-08 filings', first item): it still says 'all 15 published example rows are still failed and still published' — overtaken by the founder-ruled deletion the same day. ROADMAP and 162-CENSUS carry CORRECTION headers; TODOS (the single ground-truth backlog) does not."
    expected: "Item closed or corrected to reflect the deletion; the sibling founder-call items (HONEST-01 split — resolved by 578ad5f33; HONEST-02 badge — resolved by the chip fix) reviewed for closure at the same time"
    why_human: "TODOS.md is add/close-only by the founder's ground-truth rule; a verifier records the drift, it does not edit the backlog"
    result: "CLOSED 2026-08-28 — both halves. (1) The D-162-1 filing was ALREADY corrected before this reading: TODOS.md:3128 now leads with `D-162-1 CLOSED 2026-08-26 BY DELETION — the 15 rows no longer exist`, and the stale `NOT EXECUTED / still published` prose is fenced beneath it inside a `<details><summary>Superseded pre-deletion record</summary>` block, i.e. exactly the CORRECTION-header treatment ROADMAP and 162-CENSUS already carried. (2) The two sibling founder calls are now resolved AND recorded, which is the half that was genuinely outstanding. HONEST-02: ruled by CODE, not by an adjacent line — `SyncBadge` derives from `resolveEffectiveRecency(computedAt, seriesEnd)` (SyncBadge.tsx:99, src/lib/freshness.ts), the STALER of the two clocks, and renders `Track record ends {when}` when the series binds (:113/:135); `- [x]` / `Complete` in REQUIREMENTS (:63, :208); pinned by FactsheetView.chip-honesty.test.tsx and SyncBadge.staler-of-two.test.tsx, both deliberately naming the exact label and tone token per input rather than asserting the ABSENCE of the word `fresh` — the vacuous shape that let the bug ship. HONEST-01: ruled by SPLIT at 578ad5f3 — the delivered half closes as HONEST-01 (`- [x]` / Complete, :50/:205), the permanently-inconclusive half became its OWN requirement HONEST-07 (:51, still `- [ ]`) carrying the pinned search key. So an inconclusive root cause does NOT close a requirement here; it gets its own and stays open. Both TODOS checkboxes ticked with dated rulings, superseded text preserved. ⚠️ INCIDENTAL FIX made while doing this: the D-162-1 `<details>` at :3138 had NO closing tag at HEAD, so every backlog item after it — roughly 1500 lines of the single-source-of-truth TODOS — rendered inside one collapsed block. Closed at :3157; tags now balance 4/4."
  - test: "162-01 backstop attestation: 'every census number came from read-only PROD queries, never TEST'"
    expected: "Attestation stands (the census documents the read lane, the PROD-ref check, and the no-write rule in detail)"
    why_human: "Declared `verification: backstop`; a post-hoc repo read cannot re-derive which database a throwaway scratchpad script queried. No contradicting evidence found."
    result: "DISCHARGED BY MEASUREMENT 2026-08-26, per founder ruling — re-queried read-only against PROD rather than attested. Three census numbers reproduce EXACTLY: S2 series end 2026-05-06 = 2026-05-06; S2 trades 273 = 273; S2 trades after series end 0 = 0. The fourth reconciles by the documented delta: the census scanned 48 strategies, the table now holds 33, and the census header records 15 example rows deleted the same day (48 - 15 = 33). So the spot-check corroborates the census numbers AND the deletion record in one pass. ⚠️ This proves the values, not retroactively that the original run was read-only — that rests on the lane recorded at 162-CENSUS.md:14-18 (GET-only, ref-guard aborts before any request, client-side reduction), which the founder accepted as adequate provenance."
gaps: []
---

# Phase 162: HONEST — What the user sees is true — Verification Report

**Phase Goal:** Every number, badge, and affordance a user sees reflects the data underneath it — no raw exceptions as copy, no freshness claim a dead series contradicts, no missing metric where data exists.
**Verified:** 2026-08-26 at HEAD `cbed4a169`, branch `feat/v1.20-phase-162-honest`
**Status:** human_needed
**Re-verification:** No — initial verification

All evidence below was read from the codebase or produced by commands I ran myself. SUMMARY/REVIEW claims were used only as pointers, then independently checked. The four accepted items from the briefing (service_role ceiling T-162-05-E, four SQL gates RED until migs reach TEST, HONEST-07 open, IN-04 → 164.2) are not re-reported.

## Goal Achievement — ROADMAP Success Criteria

| SC | Criterion | Verdict |
|----|-----------|---------|
| 1 | Computation failure renders mapped copy, never a raw exception — mapped at the WRITER, with str/None root-caused | **PARTIAL — copy half VERIFIED, root-cause half PASSED (override: founder split → HONEST-07 open)** |
| 2 | Freshness claims true: 89-day-dead series cannot read FRESH (investigated FIRST), example strategies advertise no stale badges | **VERIFIED in code; two measurement halves await the queued PROD look (human)** |
| 3 | Real per-strategy equity curves (null + false comment gone); drawer rows render CAGR/Sharpe | **VERIFIED** |
| 4 | "Finish setup →" opens the wizard with the clicked key preselected | **VERIFIED (jsdom); browser pass outstanding** |

### Judgment calls the briefing asked for

**The HONEST-01 split is honest, not laundering.** The tick history proves it: 162-02 ticked HONEST-01 → 162-08 **un-ticked it** (`e6c70ca79`, "the root-cause half is inconclusive, not done") and the census wrote "⛔ HONEST-01's checkbox stays OPEN — this is a founder call" → the founder ruled and `578ad5f33` split the conjunction, re-ticking only the delivered half and minting HONEST-07 with the pinned evidence (stage, window, population) and an explicit "may prove unclosable — reassess" note. The unmet half stayed visible at every step. What this does NOT change: **ROADMAP SC 1 as written is only partially met**, and this report scores it partial-with-accepted-override rather than rounding up.

**HONEST-03's closure by deletion is honest.** The D-162-1 fence itself said: "if the rows cannot be recomputed, that is a finding — fall back to unpublishing and say so." Recompute was measured structurally impossible (0 `csv_daily_returns` rows across all 15; handler needs ≥2 — an enqueue would have fired the fence 15 times), the founder ruled unpublish-and-delete, the deletion is documented with CORRECTION headers in both 162-CENSUS.md and ROADMAP, cascades enumerated, backup retained. With zero example rows the discovery claim is vacuously true on PROD **and non-vacuously guarded in code** for any future rows (`is_example` gate on both render paths, RED-witnessed per the census's N1/N2 neuter log and green at HEAD in my own run). Two residues: the deletion itself is a PROD measurement I cannot verify from the repo (→ human item 2), and the TODOS.md filing was never corrected and now contains a false sentence (→ human item 4).

**HONEST-02's ledger lags its code.** The briefing said "ticked"; at HEAD it is NOT — `REQUIREMENTS.md:52` is `[ ]` and the table row reads `Pending`, per the TODOS founder-call item ("do not tick at phase close without a ruling"). But the ruling has since happened: `FreshnessChip` now buckets on the **staler** of job-recency and series-recency (comment: "founder ruling 2026-08-26"), closing exactly the gap the founder-call described. Both halves are in code and tested; the checkbox and the founder-call item are stale (→ human item 1).

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | No writer stamps raw/scrubbed exception text into user-visible `computation_error`; raw detail → operator channels only | ✓ VERIFIED | `_stamp_strategy_analytics_failed` choke point (`job_worker.py:2874-2890`) splits curated `message` (→ column) from `detail` (→ logs/`last_error`); all `+ scrubbed` remainders target `DispatchResult.error_message` (operator). `portfolio.py:718` `_fail` docblock forbids `str(exc)`; all call sites pass fixed sentences. WR-01's two interpolated-internals sites (MT5-12 `:5085-5155`, composite clock `:7057-7089`) fixed at HEAD. IN-02 trailing spaces gone (grep clean). `pytest tests/test_computation_error_curated.py`: **4 passed** (my run). |
| 2 | The SQL bridge cannot pipe operator text into the user column | ✓ VERIFIED | Mig `20260826120000`: `computation_error_copy(error_kind)` — IMMUTABLE, four fixed literals, kind-in/literal-out; branch (b) `:807` and (b-prime) write it; the identifier `last_error` no longer appears in the bridge body; EXECUTE revoked from anon/authenticated. NOTE: plan 162-02's frontmatter truth "classify_exception's bottom arms return curated copy" was superseded by the recorded 162-02-DECISION.md (curate at the bridge; the bottom arms' `str(exc)[:500]` now feeds an operator-only column) — a documented deviation, not a miss. |
| 3 | The wizard failure envelope never renders the `computation_error` column | ✓ VERIFIED | `SyncPreviewStep.tsx:2100-2118` — Details appendix removed, envelope body is wizardErrors copy only; `wizardErrors.ts:3702` removed the `computationError` context field. Remaining raw-text consumers are admin/operator only (`admin/strategy-review`, `strategyGate` reason consumed by that route). |
| 4 | str/None compare root-caused | PASSED (override) | Founder split 578ad5f33 → HONEST-07 (Unassigned, Pending, pinned evidence). See overrides frontmatter. Residue: 2 PROD rows (`ec722557…` pending_review, `8581f739…` published) still carry the raw text in-column, awaiting a next terminal write that may never come (`poll_positions` dead since 2026-06-14) — filed in TODOS. At HEAD I found **no user-visible render path** for those rows' column text (truth 3 closed the wizard path; no public surface reads strategy `computation_error`), so this is DB residue, not visible copy. |
| 5 | Freshness investigated FIRST; verdict decided before any fix | ✓ VERIFIED | `162-CENSUS.md:504` `HONEST-02 VERDICT: flat-account`, four-row evidence trail (series end 2026-05-06, 0 trades after, key alive and polling, venue watermark frozen 111 days). 162-07 shipped the flat arm only. |
| 6 | A dead series cannot read FRESH on the factsheet | ✓ VERIFIED | Both halves in code: `SeriesRecencyLine` ("Track record through {date}", `FactsheetView.tsx:1064`, keyed on `resolveSeriesEnd` — series last point, never `computed_at`/`last_sync_at`; no-date → no render) AND `FreshnessChip:942` buckets on the STALER of job/series tones via shared `resolveSeriesEnd` + `TONE_RANK` (unknown > fresh, < stale/old), eyebrow names the binding subject ("Track record · old"). My run: `FactsheetView.recency-line.test.tsx` + `chip-honesty.test.tsx` green (part of 47/47). |
| 7 | Example strategies never advertise sync recency | ✓ VERIFIED (code) / human (PROD data) | `StrategyTable.tsx:991-992` `mayClaimSyncRecency = hasComputedAnalytics && !s.is_example`; `StrategyGrid.tsx:117` `{!s.is_example && (`; `stale-analytics.test.tsx` 16/16 green (my run); census records first-hand RED-witness for both guards (N1/N2). PROD population deleted (founder ruling) — measurement queued as human item 2. Grid's missing `hasComputedAnalytics` half is booked in TODOS with the corrected severity analysis (server blanking covers it today) — warning-tier, accepted framing. |
| 8 | Real per-strategy equity curves, STALE-01-gated, false comment gone | ✓ VERIFIED | `portfolios/[id]/page.tsx:267-268` — curve only when `isRankableAnalyticsRow(a)`; `buildWealthPoints` uses persisted `returns_series` or folds `resolveDailyReturnSeries`; hard-coded `equityCurve: null` + false comment gone (no match in file); `stripConstituentSeries:282` strips `_rs`/`_dr` at the RSC boundary. `equity-curve-series.test.tsx` green (my run). |
| 9 | Exactly one colorless coverage caption; honest grammar | ✓ VERIFIED (documented deviation) | `EquityCurveCoverage:329-353` — null when n==m, renders at n==0, singular/plural at 1 (IN-03 fix). Copy deviates from the plan's exact sentence ("without computed analytics" → "without a usable return series") — deliberately, because the planned copy named a cause the function never tests; the comment documents the counter-example. The deviation makes the caption MORE honest; goal-level truth met. |
| 10 | `/returns` withholds cagr/sharpe under the SAME gate as the series; drawer rows render real metrics with the C-4 five-state contract | ✓ VERIFIED | `returns/route.ts:362-383` — one `analyticsRankable` boolean gates both scalars; `ScenarioComposer.tsx:1198` `addedMetricsById`, revised note at `:7656`. `route.test.ts` + `added-metrics.test.tsx` green (my run, part of 229/229). |
| 11 | Preselect: server reuse path + client thread, never re-INSERT, three populations | ✓ VERIFIED | Mig `20260826130000` — SECURITY DEFINER, service-role-only EXECUTE + in-body role gate (`:130`) + ownership join (`:177`) + advisory xact-lock idempotency (`:152`); route `:738-739` dispatches `reuse_api_key_id` arm via `rpcAdmin` behind `withAuth`; client thread `StrategyTable:1408 onFinishSetup` → `MyStrategiesSection:118` → `ContributionWizardOverlay` (preselect in remount key, `:107-108`) → `WizardClient:285-286` seeds `apiKeyId` → `ConnectKeyStep:1334` POSTs `reuse_api_key_id`; focus lands on `wizard-preselect-continue` (`:980-983`). `preselect.test.tsx` + `create-with-key/route.test.ts` green (my run). |
| 12 | Failed scope probe renders no scope facts (162-09) | ✓ VERIFIED | `KeyPermissionBadge.tsx:203` — chips and "Detected …" caption gate on the same `probeFailed` fact as the summary; `KeyPermissionBadge.test.tsx` green (my run). |

**Score:** 11/12 verified (10 direct + 1 override); 1 uncertain (162-01 backstop attestation → human item 5).

## Prohibitions

| Prohibition | Tier | Status |
|-------------|------|--------|
| Census carries ids/counts/dates only — no emails, uids, names, key material, hostnames, project refs (repo PUBLIC) | test (grep) | ✓ VERIFIED — email-shaped-token grep exit 1 (no match); no `supabase.co` host, no local username; refs deliberately not embedded (pointer to 159-CENSUS) |
| Never synthesize values to make a row look computed (D-162-1 fence) | judgment | ✓ HELD — census attests no analytics value written; the resolution was deletion, the opposite of synthesis |
| No PROD/TEST DB touched by this verification | self | HELD — repo reads + local test runs only |

## Required Artifacts

| Artifact | Provides | Status |
|----------|----------|--------|
| `162-CENSUS.md` | HONEST-02 verdict line + HONEST-01 verdict + repair census + recompute-results + CORRECTION header | ✓ VERIFIED (contains `HONEST-02 VERDICT`, `HONEST-01 ROOT-CAUSE: inconclusive`, §Recompute, correction header) |
| `supabase/migrations/20260826120000_computation_error_curated_copy.sql` | bridge curation | ✓ VERIFIED |
| `supabase/migrations/20260826130000_create_wizard_strategy_for_key.sql` | reuse writer | ✓ VERIFIED (`SECURITY DEFINER` present) |
| `supabase/migrations/20260826140000_compute_jobs_error_kind_orphaned.sql` | orphaned kind + copy parity | ✓ EXISTS (parity cross-gated per review; RED-on-TEST accepted) |
| `analytics-service/tests/test_computation_error_curated.py` | HONEST-01 pins | ✓ VERIFIED — 4 passed (my run) |
| `supabase/tests/test_create_wizard_strategy_for_key.sql` | state-adaptive SQL gate | ✓ EXISTS (`service_role` present; RED-on-TEST accepted) |
| 7 vitest spec files (equity-curve-series, added-metrics, preselect, recency-line, chip-honesty, stale-analytics, KeyPermissionBadge, returns/route, create-with-key/route) | behavioral pins | ✓ VERIFIED — 9 files, 276 tests, 0 failures (my runs) |

## Behavioral Spot-Checks (my own runs, this HEAD)

| Check | Command | Result |
|-------|---------|--------|
| HONEST-02/04/06 UI specs | `npx vitest run` (chip-honesty, recency-line, preselect, equity-curve-series) | 4 files, 47/47 pass |
| HONEST-03/05/06/09 + routes | `npx vitest run` (added-metrics, stale-analytics, KeyPermissionBadge, returns route, create-with-key route) | 5 files, 229/229 pass |
| HONEST-01 python pins | `python3 -m pytest tests/test_computation_error_curated.py` (from `analytics-service/`) | 4 passed |
| Debt markers (TBD/FIXME/XXX) in 14 phase-modified source files | `grep -a` (NUL-safe) | 0 hits |
| Census PII | email-token regex + hostname grep on 162-CENSUS.md | clean |

Not run: full suite (review ran 1,238 phase tests + tsc + mypy at this tree; re-running the world adds no evidence — per the no-full-suite-per-truth rule). SQL gates not run (need TEST DB; 4 files RED until migs reach TEST — accepted, TODOS 0.11).

## Requirements Coverage

| Requirement | Plans | Ledger at HEAD | Verifier judgment |
|-------------|-------|----------------|-------------------|
| HONEST-01 | 162-01, 162-02, 162-08 | `[x]` Complete (post-split text) | Copy half delivered and verified; split honest; 2-row PROD residue booked in TODOS |
| HONEST-02 | 162-01, 162-07, 162-09 | `[ ]` **Pending** | Code COMPLETE (line + staler-of-two chip + probe-error fix) and tested; tick blocked on a founder call that has since been ruled — **ledger lags code** (human item 1) |
| HONEST-03 | 162-03, 162-08 | `[x]` Complete | Code guard verified; data closed by founder-ruled PROD deletion (measurement queued, human item 2); TODOS filing stale (human item 4) |
| HONEST-04 | 162-03 | `[x]` Complete | Verified |
| HONEST-05 | 162-04 | `[x]` Complete | Verified |
| HONEST-06 | 162-05, 162-06 | `[x]` Complete | Verified |
| HONEST-07 | (split, no plan) | `[ ]` Unassigned/Pending | Correctly open; not a phase-162 gap by founder ruling |

No orphaned requirements: REQUIREMENTS.md maps exactly HONEST-01..06 to Phase 162; every plan's `requirements` field is within that set; all six are claimed by at least one plan.

## Anti-Patterns Found

| File | Pattern | Severity | Note |
|------|---------|----------|------|
| `TODOS.md` §162-08 filings | Stale D-162-1 item asserting 15 rows "still published" after their deletion; two founder-call items overtaken by rulings | ⚠️ Warning | False sentence in the ground-truth backlog — the exact defect class this phase exists to remove, in its own paperwork. Human item 4. |
| `.planning/REQUIREMENTS.md` | HONEST-02 Pending while implementation is complete and the blocking founder call has been ruled | ⚠️ Warning | Human item 1. |

No blockers. No unreferenced debt markers in phase-modified source.

## Gaps Summary

No code gaps. Every artifact the phase promised exists, is substantive, is wired, and has passing behavioral tests that I ran myself. The reasons this is `human_needed` rather than `passed`:

1. Two requirement-ledger entries lag reality (HONEST-02 tick; stale TODOS filings) — founder-owned edits.
2. Two PROD measurements are claims I cannot verify from the repo (the 15-row deletion; the queued discovery look — the latter is the census's own unstarted `<human-check>` and 162-08's declared backstop truth).
3. Nothing in this phase was ever observed in a real browser; all UI evidence is jsdom. Given `UI hint: yes` and three new user-facing surfaces, a browser pass is warranted before phase close.

Known-and-accepted items (not gaps): HONEST-07 open; `service_role` ceiling T-162-05-E; four SQL gates RED until `20260826120000`/`20260826140000` reach TEST; IN-04 → Phase 164.2; bridge specificity loss (curated-generic replaces curated-specific on job transitions) → Phase 164.2, recorded as owed in mig-120000's header.

---

_Verified: 2026-08-26T10:15:00Z_
_Verifier: Claude (gsd-verifier), goal-backward, initial mode_

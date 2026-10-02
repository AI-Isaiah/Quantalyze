---
phase: 151-aum-a-book-you-can-reach-and-a-size-you-can-set
verified: 2026-08-07T15:05:00Z
status: human_needed
score: 30/30 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "On PROD as the founder, open Allocations → Scenario. Confirm the 'From my book' segment renders and is the initial mode, and that the partial-book note reads 'N of M keys not yet contributing — no per-key history yet.' with M counting ONLY the founder's own (non-manager) keys."
    expected: "'From my book' visible and selected on load; note counts exclude the 3 MT5 + 3 deribit manager-side keys; scenario AUM is non-zero (~$460k from the contributing keys)."
    why_human: "Depends on the founder's live PROD key/strategy_keys topology. The unit fixture reproduces the census (queries.my-allocation.test.ts:3172) but cannot prove the PROD rows match it."
  - test: "After the next 04:00 cron (or a manual 'Sync now') on PROD with MT5_ENABLED=true on the worker, inspect allocator_holdings for venue='mt5' and api_keys.sync_error for key 46293712-59e6-46c0-8204-5dd32afe2503."
    expected: "One row per MT5 account with symbol='ACCOUNT-<first 8 of key id>', holding_type='spot', mark_price=1.0, value_usd = account equity. sync_error no longer holds \"'Mt5Session' object has no attribute 'fetch_balance'\" — it is either NULL or one of the AUM-02 copy constants."
    why_human: "Requires a live Wine terminal + RPyC gateway and a real broker account. Every automated test runs against the offline _connect injection seam."
  - test: "On PROD, drive the headline flow end to end in the browser: blank-slate scenario → add one strategy → type 2,000,000 into PORTFOLIO AUM → type 500,000 into the strategy's dollar field → Commit."
    expected: "Weight lands at 0.250, the commit returns 200 (not a 409 portfolio_fingerprint_stale), and the audit row carries _size_source='client_manual_aum' with size_at_decision_usd=500000."
    why_human: "The 409 dead end was a live RPC precondition. Unit tests assert the client sends null and the route forwards null, but only a real commit_scenario_batch call proves the precondition is actually skipped in Postgres."
  - test: "Visual check of the partial-book note and the PORTFOLIO AUM field against DESIGN.md."
    expected: "Note renders in muted steady-state styling (never amber, never role=alert); the AUM input matches the composer's existing numeric-field treatment."
    why_human: "Visual/aesthetic conformance cannot be asserted by grep; Test 6 pins the class names but not the rendered result."
---

# Phase 151: AUM — A book you can reach and a size you can set — Verification Report

**Phase Goal:** An allocator can always reach their live book, size a hypothetical one directly, and no venue crashes the holdings sync
**Verified:** 2026-08-07T15:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification
**Branch verified:** `feat/v1.17-151-aum` @ `c485e7ff`

## Goal Achievement

### Observable Truths

Merged from ROADMAP Success Criteria (SC1–SC4, the contract) and the seven PLAN `must_haves.truths` blocks. Nothing was subtracted.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **SC1** — allocator sets AUM directly; weights/dollar sizes follow; a blank-slate scenario can size **and commit** ("allocate $500k" expressible) | VERIFIED | `ScenarioComposer.tsx:3793` `scenarioAum = sanitizedManualAum ?? liveHoldingsSum`; PORTFOLIO AUM input `:4314`; dollar input `:5846` `onSetWeight(ref, amount / scenarioAum)`. Commit unblocked by CR-01 at BOTH layers: composer `:3948` freezes `null` for an empty fingerprint, route `route.ts:548-551` normalises `""` → `null`. Route test `route.test.ts:1595` drives a real blank-slate POST with a non-empty holdings fixture → 200 + `p_portfolio_fingerprint: null`. Composer test `ScenarioComposer.test.tsx:11935` proves $500k/2M → 0.250 and `committedSizes()[D_A] === 500_000`. |
| 2 | **SC2** — MT5 equity contributes a holdings row; no key stamps a raw Python `AttributeError` into `sync_error`; fixed at the non-ccxt venue CLASS, with sFOX (`get_balances`) proven BEFORE go-live | VERIFIED (PROD confirmation is human item 2) | `allocator_positions.py:416` `_fetch_mt5_account_rows` emits one row (`quantity=equity`, `mark_price=1.0`, `symbol=ACCOUNT-<id[:8]}`); `:854-855` registers `mt5`+`sfox` in `_NON_CCXT_HOLDINGS_FETCHERS`; `:905` dispatches on the venue STRING before any ccxt call. `job_worker.py:7171` dedicated `except AllocatorHoldingsSyncTransientError` arm precedes the generic `except Exception` at `:7209`. Parametrized class proof `test_allocator_positions_non_ccxt.py:1479` over mt5 / sfox / unknown-venue. 53 pytest cases green. |
| 3 | **SC3** — the founder's book reaches "From my book"; gate no longer all-or-nothing; MANAGER-side keys no longer pin the ALLOCATOR gate false | VERIFIED (PROD confirmation is human item 1) | `queries.ts:3888-3902` subtracts `deriveStrategyLinkedKeyIds` then asks a SOME question. Census test `queries.my-allocation.test.ts:3172` — 8 keys, 6 manager-linked → `perKeyDailiesGateSatisfied=false` AND `bookEntryGateSatisfied=true`. Composer `ScenarioComposer.tsx:900` `canEnterBook = hasLiveBook && payload.bookEntryGateSatisfied`; `ScenarioComposer.test.tsx:10955` asserts the segment renders and `aria-checked="true"` on load. |
| 4 | **SC4** — the AUM-zero refusal names only affordances that exist | VERIFIED | Two pinned constants `ScenarioComposer.tsx:733,735`, selected at `:3953` by `canEnterBook`. Repo grep-gate: `grep -rn "toggle on a live holding" src/ \| grep -v .test.` returns **zero** hits. Copy asserted by equality (not regex) at `ScenarioComposer.test.tsx:2514,11714`. |
| 5 | MT5 serialization machinery importable from a leaf module without importing `job_worker` | VERIFIED | `services/mt5_concurrency.py` (157 lines) imports only `services.mt5_client`. Import-graph pin `test_mt5_concurrency.py:116-124` runs a subprocess asserting `services.job_worker` never enters the graph. |
| 6 | Derive arm byte-identical after the extraction — ONE lock registry, same objects | VERIFIED | `job_worker.py:113` re-imports the six symbols. Identity pins `test_mt5_concurrency.py:60,66-68,84-86`: `jw._MT5_TERMINAL_LOCKS is mt5_concurrency._MT5_TERMINAL_LOCKS`, and the same for `allocator_positions`. `test_mt5_derive_branch.py` + `test_mt5_sync_path.py` green (141 cases with the adjacent suites). |
| 7 | A key linked to a live strategy (either link form) is excluded from allocator book-gate eligibility | VERIFIED | `queries.ts:343` `deriveStrategyLinkedKeyIds` covers `strategies.api_key_id` AND `strategy_keys`, with the W-4 archived exclusion. `:3896` filters it out of `allocatorEligibleApiKeyIds`. |
| 8 | `bookEntryGateSatisfied` true with ≥1 eligible contributing key while `perKeyDailiesGateSatisfied` is false | VERIFIED | `queries.ts:3902`. Census + partial-book tests at `queries.my-allocation.test.ts:3172,3194` assert the two flags disagree on the same fixture. |
| 9 | `perKeyDailiesGateSatisfied` and its **queries-side** consumers unchanged | VERIFIED | `queries.ts:3930` `liveBaselineMetrics = perKeyDailiesGateSatisfied ? … : emptyDefault` — untouched. Consumer-freeze test `queries.my-allocation.test.ts:3244` proves the baseline stays the honest empty default on a fixture where the new gate is true. |
| 10 | Both `getMyAllocationDashboard` return branches carry the three new fields | VERIFIED | Portfolio branch `queries.ts:3981-3983`; `!portfolio` branch `:4411-4413`. Explicit never-undefined pin at `queries.my-allocation.test.ts:3232`. |
| 11 | MT5 holdings sync produces ONE equity row or an honest human-copy skip — never a raw AttributeError | VERIFIED | Non-USD → `MT5_NON_USD_NOTE` (`:558-560`); kill switch → `MT5_DISABLED_DETAIL` (`:468`); every transport/trust failure → `AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE)`. All copy constants are fixed strings (`:118-149`). |
| 12 | The MT5 holdings read serializes on the SAME terminal lock object as the derive job | VERIFIED | `allocator_positions.py:510` `async with _mt5_terminal_lock_for(session.client.terminal_key)`. Identity pin `test_allocator_positions_non_ccxt.py:940-946`; contention pin `:951`. |
| 13 | Existing ccxt venues reach `fetch_balance` / `fetch_positions` byte-unchanged | VERIFIED | `allocator_positions.py:915-921` — the ccxt body is reached only after both non-ccxt guards miss. Pins `test_allocator_positions_non_ccxt.py:137` (ccxt reaches `fetch_balance`) and `:1629` (dispatch untouched with both kill switches ON). |
| 14 | A genuine MT5 transport failure stamps human copy AND retries — never `str(exc)` | VERIFIED | `job_worker.py:7184` `human_copy = str(exc)[:500]` where `exc` is the copy-carrying transient; returns `error_kind="transient"`. AST gate `test_allocator_positions_non_ccxt.py:422` proves no except-arm in the module interpolates the bound exception outside logging. |
| 15 | sFOX will not crash the sync: `get_balances` (never `fetch_balance`), USD/stables at 1.0, honest warning for non-priceable assets | VERIFIED | `allocator_positions.py:739` `client.get_balances()`; unpriceable assets skipped and named via `SFOX_UNPRICED_ASSETS_NOTE`, bounded at 6 named + "and N more" (`:829-834`, WR-03). |
| 16 | The CLASS is proven closed — ONE parametrized body over mt5 AND sfox AND an unknown venue, BEFORE the sFOX flip | VERIFIED | `test_allocator_positions_non_ccxt.py:1474-1546`. Three-part oracle: only the transient may escape; the ccxt surface is structurally absent (`dir(type(client))`) AND behaviourally uncalled; and each venue must produce **its own branch's** copy (non-vacuity — a deleted fetcher would fall to the generic skip and fail). |
| 17 | No sync_error/warning across any non-ccxt arm contains a Python identifier | VERIFIED | `BANNED_INTERNALS` assertion inside the class proof, plus `test_user_visible_copy_never_leaks_python_internals` (`:336`) and the AST gate (`:422`). CR-03 closed the last hole: the ccxt derivative arm now returns `DERIVATIVE_FETCH_FAILED_NOTE` instead of `str(exc)[:500]` (`allocator_positions.py:948`). |
| 18 | Two MT5 accounts under one allocator survive the upsert as two rows | VERIFIED | Account-scoped `symbol = f"ACCOUNT-{api_key_id[:8]}"` (`:560`), sized against the `(allocator_id, venue, symbol, asof)` unique index. Non-collapse oracle `test_allocator_positions_non_ccxt.py:1553`. |
| 19 | An allocator with ≥1 contributing key sees "From my book" and initializes to book mode — never forced blank | VERIFIED | `ScenarioComposer.tsx:900`; AUM-04 Test 1 (`:10955`) with a fixture where the OLD gate refuses and the NEW one admits. Test 2 records the deliberate Open-Q4 narrowing: zero contributing keys still init blank. |
| 20 | Book mode renders rows ONLY for contributing keys; non-contributing eligible keys get the "{N} of {M}" note — never silent, never a dead 0.000 row | VERIFIED | `dataSourceKeys` narrowed to `contributingApiKeyIds` (`:2639-2642`); note rendered at `:5264-5269`. AUM-04 Tests 5–9. Leverage keep-set deliberately left on `allocatorEligibleApiKeyIds` (`:2660`) so a not-yet-contributing key's saved leverage survives (Test 10). |
| 21 | `liveBaselineMetrics` and the calm-fallback's no-contributing case still key on the OLD flag | VERIFIED | `queries.ts:3930` frozen. `showDataSourcesFallback` (`ScenarioComposer.tsx:2625-2628`) keeps `!perKeyDailiesGateSatisfied` as a conjunct and only fires when no key contributes. |
| 21b | *(sub-clause)* MEMBER-04 stamp still keys on the OLD flag | VERIFIED — **deliberate deviation, adjudicated below** | Moved to `bookEntryGateSatisfied` + `contributingApiKeyIds` by CR-02/WR-07 (`9e9694e1`). MEMBER-04's actual requirement (disclosure of dropped ineligible members) is untouched at `ScenarioComposer.tsx:1910,4491`. See **Deviation Adjudication**. |
| 22 | Manager keys appear in NEITHER count of the partial-book note | VERIFIED | Both counts read `allocatorEligibleApiKeyIds` / `contributingApiKeyIds` (`:2672-2674`), from which manager keys are absent by construction. AUM-04 Test 7 (`:11228`) uses six manager keys and asserts "2 of 4", not "2 of 10". |
| 23 | A blank-slate scenario can set AUM via one editable field; book mode pre-fills from the live sum and stays editable as an override | VERIFIED | Seed-once effect `:3805-3808`; `commitAumInput` `:3833`. WR-04 guard `:3846-3858` — a bare blur that does not change the number never converts derived → manual. |
| 24 | Editing AUM keeps weights fixed and rescales dollars; `scenarioMetrics` do NOT change (AUM-01 ≠ SCEN-01) | VERIFIED | `scenarioAum` is absent from the `scenarioMetrics` dep array. AUM-01 Test 7 (`:12181`) asserts sharpe/cagr/maxDD/n byte-identical AND `computeScenarioStateArgs.length` unchanged across a pure AUM edit, with a non-vacuity assertion that the AUM edit landed (0.25 × 9M = 2,250,000). |
| 25 | A pre-existing v4 draft without `manualAumUsd` decodes ok — never reset; a corrupt stored value sanitizes to undefined | VERIFIED | `scenario-state.ts:932` `manualAumUsd: z.number().nullish()` — optional, **no range refine** (a refine failure would route to the draft-deleting reset). Bound applied at read: `ScenarioComposer.tsx:3779` `isValidDollar(...) && > 0`. |
| 26 | The AUM-zero refusal names only real affordances | VERIFIED | Same evidence as truth 4. |
| 27 | "Allocate $500k" is expressible: 500000 against AUM 2000000 → weight 0.25 through the ONE existing weight-write path | VERIFIED | `:5846` routes through `onSetWeight` = `handleWeightChange` (`:5287`). Wiring falsifier AUM-01 Test 3 (`:11983`) asserts the `userWeightOverrides` stamp only the weight-write path sets; the SUMMARY records the neuter-mutation observed RED. |
| 28 | A sole-unit dollar edit refuses (never renormalizes); the >1 clamp banner fires from a dollar edit | VERIFIED (with a documented reachability narrowing) | Clamp: AUM-01 Test 4 (`:12004`) fires the existing banner verbatim and lands weight 1.000/0.000. Sole-unit: the test (`:12036`) documents that a sole-unit state and a dollar input **cannot coexist** (the dollar input lives only on added rows), asserts `queryAllByTestId(...)` is empty in that state, and pins the refusal on the shared handler where it IS reachable. Honest, not a silent skip. |
| 29 | A blank-mode manual-AUM commit audits with the `client_manual_aum` sentinel and a computed size — never silently `no_holdings_snapshot`/size 0 | VERIFIED | `route.ts:927-937`. Test 9 (`route.test.ts:1779`): zero holdings + 2,000,000 manual + 25% → `size_at_decision_usd === 500_000`, `_size_source === "client_manual_aum"`. Test 8b pins the 400 refusals for `-1 / 0 / null / 1e12 / "2000000"`. |
| 30 | `manual_aum_usd` is an additive labelled sidecar; the NEW-C18-04 server recompute is never overwritten by a client number under a server-sounding sentinel | VERIFIED | `route.ts:920-926` — `serverAumUsd > 0` wins **unconditionally** and the manual value is a strict `else if`. Test 10 (`:1802`) pins the precedence; SUMMARY records the branch-order mutation observed RED. Drawer sends the field only via a conditional spread (`ScenarioCommitDrawer.tsx:562`) so `request_hash` is byte-stable for callers that omit it. |

**Score:** 30/30 truths verified

### Deviation Adjudication — the MEMBER-04 stamp (truth 21b)

The 151-05 plan froze `memberKeyIdsForSave`, `targetEntryMode`, and the reopen `deriveMembershipFromGate` on the OLD all-or-nothing flag, as an explicit acceptance criterion. The code-review fix pass (`9e9694e1`) overrode that and repointed all three onto `bookEntryGateSatisfied` + `contributingApiKeyIds`.

**Ruling: this preserves MEMBER-04's invariant and does not break it.** Three reasons, checked against the codebase rather than the narrative:

1. **MEMBER-04's actual requirement is disclosure, not the flag.** `v1.6-REQUIREMENTS.md:36` — *"Reopening a draft whose persisted member key is no longer eligible DISCLOSES the drop — never a silent recompute over a different member set."* The disclosure machinery (`ScenarioComposer.tsx:1910` computation, `:4491` render, `ProvenanceNote` variant) is byte-unchanged by `9e9694e1`; the diff touches no line containing `ineligible`, `disclos`, or `ProvenanceNote`.
2. **The frozen version actively violated the "never a different member set" half.** Under a partial book the old flag is false, so a BOOK-mode save persisted `memberKeyIds: []` — the schema's meaning for *blank-authored* — while the engine blended the contributing keys. `scenario-compare.ts:169` reads that field as its per-key selector, so the compare column and the composer projected the SAME saved portfolio differently. That is precisely the silent-different-member-set failure MEMBER-04 exists to forbid.
3. **The new pin is non-self-referential.** `AUM-04 Test 4` (`ScenarioComposer.test.tsx:11033`) derives the engine's observed unit set independently, by scanning `computeScenarioStateArgs` for the ids that actually reached `computeScenario`, and asserts the stamp equals *that* — not the source's own expression. It also carries the `[]` control for the zero-contributing case, so the F5 blank-closure is not weakened. `ScenarioComparePanel` gained both fields (`:88-89, :308-309, :344-345`) via `AllocationsTabs.tsx:1167-1168`, closing the divergence at the other end.

For the audit record, if you want this deviation formally accepted rather than adjudicated by the verifier, add to this file's frontmatter:

```yaml
overrides:
  - must_have: "liveBaselineMetrics selection, MEMBER-04 stamp, and the calm-fallback's no-contributing case still key on the OLD perKeyDailiesGateSatisfied flag"
    reason: "CR-02/WR-07 repointed the MEMBER-04 stamp/reopen seams onto the split gate — the frozen version persisted memberKeyIds:[] for a partial-book BOOK save, which scenario-compare read as blank-authored. liveBaselineMetrics and the calm fallback remain frozen as directed."
    accepted_by: "{your name}"
    accepted_at: "{ISO timestamp}"
```

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/mt5_concurrency.py` | 6 moved symbols, ≥60 lines | VERIFIED | 157 lines; all six present; imported by `job_worker.py:113` and `allocator_positions.py:76`; cross-referenced from `mt5_client.py:444` |
| `analytics-service/tests/test_mt5_concurrency.py` | registry-identity + re-import regressions, ≥40 lines | VERIFIED | 172 lines, subprocess import-graph pin, 8 cases green |
| `analytics-service/services/allocator_positions.py` | venue dispatch, `_fetch_mt5_account_rows`, transient error, honest-skip copy | VERIFIED | 990 lines; `_NON_CCXT_HOLDINGS_FETCHERS` at `:853`; 8 copy constants at `:118-149` |
| `analytics-service/services/closed_sets.py` | `NON_CCXT_VENUES` frozenset | VERIFIED | `:239` `frozenset({"mt5", "sfox"})`; AST drift gate against `_make_exchange_client` at `test_…_non_ccxt.py:479` |
| `analytics-service/tests/test_allocator_positions_non_ccxt.py` | MT5 + sFOX + class proof, ≥120 lines | VERIFIED | 1,648 lines / 45 cases |
| `src/lib/queries.ts` | `deriveStrategyLinkedKeyIds` exported + 3 payload fields on both branches | VERIFIED | `:343`, `:3981-3983`, `:4411-4413` |
| `src/app/(dashboard)/allocations/lib/scenario-state.ts` | `manualAumUsd` optional additive field, no range refine | VERIFIED | type `:160`, `setManualAum` `:818`, zod `:932` |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | gate repoint, PORTFOLIO AUM input, refusal copy, dollar input | VERIFIED | 6,467 lines; all four surfaces present and wired |
| `src/app/api/allocator/scenario/commit/route.ts` | `manual_aum_usd` zod field + `client_manual_aum` sentinel | VERIFIED | `:183`, `:891`, `:936` |
| `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx` | conditional-spread `manual_aum_usd` | VERIFIED | `:562` `...(manualAumUsd != null && { manual_aum_usd: manualAumUsd })` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `job_worker.py` | `mt5_concurrency.py` | top-level re-import of six symbols | WIRED | `:113`; identity pins prove ONE registry |
| `mt5_client.py` | `mt5_concurrency.py` | `terminal_key` docstring cross-ref | WIRED | `:417, :444` |
| `allocator_positions.py` | `mt5_concurrency.py` | shared terminal-lock registry | WIRED | `:76`; `ap._mt5_terminal_lock_for is mt5_concurrency._mt5_terminal_lock_for` |
| `job_worker.run_poll_allocator_positions_job` | `AllocatorHoldingsSyncTransientError` | dedicated except arm BEFORE generic | WIRED | `:7171` precedes `:7209` |
| `_fetch_sfox_balance_rows` | `SfoxClient.get_balances` | the CONTEXT-locked method | WIRED | `:739`; `fetch_balance` absent from the sFOX arm |
| `queries.deriveStrategylessKeys` | `deriveStrategyLinkedKeyIds` | shared covered-set (one join) | WIRED | `:395` delegates; phase-149 pin 8 repointed by `c89aa57c` and green |
| `getMyAllocationDashboard` | `strategy_keys` | narrowed builder, `owner_id`-scoped | WIRED | `:3499-3501`; `.eq("owner_id", userId)` literal; `strategies` read `.eq("user_id", userId)` at `:3491-3494` |
| `ScenarioComposer.canEnterBook` | `payload.bookEntryGateSatisfied` | SoT mirror | WIRED | `:900` — no client-side re-derivation |
| `dataSourceKeys` | `payload.contributingApiKeyIds` | narrowed filter | WIRED | `:2639-2642` |
| `scenarioAum` | `draft.manualAumUsd` | manual-wins-in-both-modes, sanitized on read | WIRED | `:3779-3793` |
| refusal copy | UI-SPEC never-strings | repo grep-gate | WIRED | zero non-test hits for `"toggle on a live holding"` |
| dollar input `onCommit` | `handleWeightChange` | `amount / scenarioAum`, the ONE weight-write path | WIRED | `:5846` → `:5287` |
| `ScenarioCommitDrawer` body | `manual_aum_usd` | conditional spread (request_hash preserved) | WIRED | `:562`; composer passes `sanitizedManualAum`, never `scenarioAum` (`:5499`) |
| `ScenarioComparePanel` | split-gate fields | narrowed payload via `AllocationsTabs` | WIRED | `AllocationsTabs.tsx:1167-1168` → `ScenarioComparePanel.tsx:308-309,344-345` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ScenarioComposer` book rows | `dataSourceKeys` | `payload.contributingApiKeyIds` ← `queries.ts:3899` ← `perKeyReturnsByApiKeyId` (real `csv_daily_returns` read) | Yes | FLOWING |
| `ScenarioComposer` partial-book note | `notYetContributing` | `allocatorEligibleApiKeyIds.length − contributingApiKeyIds.length`, both SSR-derived | Yes | FLOWING |
| `ScenarioComposer` AUM field | `scenarioAum` | `draft.manualAumUsd` (persisted, sanitized) ?? `liveHoldingsSum` (real `allocator_holdings` value_usd) | Yes | FLOWING |
| Dollar column | `Math.round(weightValue * scenarioAum)` | engine weight × AUM; `<= 0` renders an honest em-dash, never a fabricated $0 | Yes | FLOWING |
| Commit audit `size_at_decision_usd` | `serverSizeUsd` | `allocator_holdings` SELECT first; manual only as a labelled fallback | Yes | FLOWING |
| MT5 holdings row | `equity` | `Mt5Client.account_info()["equity"]`, fail-loud on missing/non-finite, `<= 0` emits nothing | Yes (pending PROD, human item 2) | FLOWING |
| sFOX holdings rows | `get_balances()` entries | real facade call; non-priceable assets skipped + named, never invented FX | Yes | FLOWING |

No HOLLOW or DISCONNECTED artifacts found. No hardcoded-empty prop was passed to a rendering component at any call site.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase-151 Python suites green | `cd analytics-service && python3 -m pytest tests/test_allocator_positions_non_ccxt.py tests/test_mt5_concurrency.py -q` | 53 passed in 3.80s | PASS |
| Adjacent Python suites (no regression in derive/sync/contract/sFOX) | `python3 -m pytest tests/test_allocator_positions.py tests/test_mt5_client_contract.py tests/test_mt5_derive_branch.py tests/test_mt5_sync_path.py tests/test_sfox_client.py tests/test_sfox_read.py -q` | 141 passed | PASS |
| Strict typing gate | `python3 -m mypy --strict --follow-imports=silent services/ routers/ models/` | Success: no issues found in 90 source files | PASS |
| Composer / scenario-state / commit-route | `npx vitest run --no-file-parallelism ScenarioComposer.test.tsx scenario-state.test.ts commit/route.test.ts` | 402 passed, 1 skipped | PASS |
| Queries + phase-149 parity (DEF-151-05-A closure) | `npx vitest run --no-file-parallelism queries.test.ts queries.my-allocation.test.ts queries.my-strategies.test.ts phase-149-my-strategies-parity.test.ts` | 156 passed | PASS |
| Full allocations surface | `npx vitest run --no-file-parallelism "src/app/(dashboard)/allocations"` | 122 files / 1,734 tests passed | PASS |
| TypeScript | `npx tsc --noEmit` | exit 0 | PASS |
| Lint + route manifests | `npm run lint` | 0 errors; 1 pre-existing unrelated warning (`EquityChart.tsx:1119`) | PASS |
| Never-string grep gate | `grep -rn "toggle on a live holding" src/ \| grep -v .test.` | no matches | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| — | `find scripts -path '*/tests/probe-*.sh'` | none found; no PLAN or SUMMARY declares a probe | SKIPPED (no probes in this project/phase) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AUM-01 | 151-06, 151-07 | Allocator sets AUM directly; weights follow; blank-slate can size and commit | SATISFIED | Truths 1, 23, 24, 25, 27, 28, 29, 30 |
| AUM-02 | 151-01, 151-03, 151-04 | MT5 equity contributes a holdings row; no raw AttributeError in `sync_error` | SATISFIED (PROD confirmation human) | Truths 2, 5, 6, 11, 12, 13, 14, 17, 18 |
| AUM-03 | 151-06 | Refusal copy names only affordances that exist | SATISFIED | Truths 4, 26 |
| AUM-04 | 151-02, 151-05 | Partial book reaches "From my book"; manager keys excluded role-based | SATISFIED (PROD confirmation human) | Truths 3, 7, 8, 9, 10, 19, 20, 21, 22 |
| AUM-05 | 151-04 | sFOX non-ccxt crash closed BEFORE go-live, at the CLASS | SATISFIED | Truths 15, 16, 17 |

**Orphaned requirements:** none. `.planning/REQUIREMENTS.md:1077-1081` maps exactly AUM-01..05 to Phase 151, and all five appear in the plan frontmatter (`151-01`→AUM-02, `151-02`→AUM-04, `151-03`→AUM-02, `151-04`→AUM-05+AUM-02, `151-05`→AUM-04, `151-06`→AUM-01+AUM-03, `151-07`→AUM-01).

### Code-Review Remediation Audit (3 blockers + 8 warnings claimed fixed)

Every claim independently verified in the diff, not read from `151-REVIEW.md`.

| ID | Commit | Verified in code |
|----|--------|------------------|
| CR-01 | `754a6009` | Both layers present: `ScenarioComposer.tsx:3948-3952` and `route.ts:548-551`. Two route tests including the guarantee-preserved counter-case (`route.test.ts:1643`). |
| CR-02 | `9e9694e1` | All five named seams moved; `ScenarioComparePanel` + `AllocationsTabs` gained both fields. Adjudicated above. |
| CR-03 | `480fd18f` | `DERIVATIVE_FETCH_FAILED_NOTE` at `allocator_positions.py:149`, used at `:948`; `str(exc)` gone from that arm; AST gate covers it. |
| WR-01 | `7df6a9cc` | `if equity <= 0: return ([], None)` at `:597`; parametrized over `-4200.0` and `0.0` (`test:727`). |
| WR-02 | `e9b7f46b` | Fail-loud on `equity` only (`:572`); `balance` degrades to `None` (`:588-595`). |
| WR-03 | `ced26f89` | `_SFOX_MAX_NAMED_ASSETS = 6` + "and N more" (`:831-834`) **and** the last-line `warning[:500]` cap at the write site (`job_worker.py:7267`). |
| WR-04 | `3b8ad41a` | Numeric unchanged-value guard at `ScenarioComposer.tsx:3856-3860`. |
| WR-05 | `ffddd9d8` | `if (Math.round(amount) === displayed) return` at `:5839-5842`. |
| WR-06 | `70ac9e5d` | `useScenarioState.ts` counts `manualAumUsd`; three tests including the compose-with-others case. |
| WR-07 | `9e9694e1` | `memberKeyIdsForSave` now `contributingApiKeyIds` (`:2065-2068`). |
| WR-08 | `d7cbe1f8` | The false "before any decrypt/login" claim replaced with a precise statement of what the gate stops (`:449-467`); residual logged in `TODOS.md`. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | `TBD` / `FIXME` / `XXX` in any file this phase modified | — | **None found.** Debt-marker gate clean across all 41 non-`.planning` files in `aaf5b148..HEAD`. |
| — | — | `TODO` / `HACK` / `PLACEHOLDER` on added lines in non-test source | — | **None found.** |
| — | — | Empty-return / hardcoded-empty stubs reaching render | — | **None found.** Every `return ([], …)` in `allocator_positions.py` is an *honest skip* carrying end-user copy, not a silent no-op. |

Two files were modified outside any plan's declared `files_modified` — `AllocationsTabs.tsx` and `ScenarioComparePanel.tsx`, both by the CR-02 fix (`9e9694e1`). This is a legitimate review-remediation expansion (the compare-vs-composer divergence cannot be closed without threading the two new fields), it is documented in `151-REVIEW.md`, and the full allocations suite is green. Noted, not a finding.

### Deferred Items (correctly logged, not gaps)

All present in `TODOS.md` under two dated Phase-151 sections, verified in the diff:

- sFOX `get_balance_history` NAV-anchor alternative (RESEARCH Open Q2) — a CONTEXT amendment, belongs to the sFOX go-live phase.
- Overview partial-blend baseline (RESEARCH Open Q6) — product call.
- WR-08 residual: `MT5_ENABLED=false` does not stop the preflight's RPyC connect.
- IN-01 … IN-09 (nine Info findings from the code review).
- Per-symbol MT5 holdings — correctly **not** widened; the `positions_get` facade pin (`test_mt5_client_contract.py:720-763`) is intact.
- FX seam for non-USD MT5 — honest skip shipped instead (`MT5_NON_USD_NOTE`), never a fabricated 1.0 rate.
- `DEF-151-05-A` — closed by `c89aa57c`; the phase-149 parity suite is green.
- `DEF-151-05-B` — closed by `9e9694e1`; regression cover is AUM-04 Tests 4 / 4b / 4c.

None of these fall inside this phase's success criteria, so none is counted as a gap.

### Process Observation (non-blocking)

`151-VALIDATION.md` was never updated during execution: its frontmatter still reads `status: planned` / `wave_0_complete: false`, and all 15 per-task rows still read `⬜ pending`. The Observed-RED evidence the ledger was meant to hold **does** exist — it was recorded in the plan SUMMARYs instead (`151-02:95-97`, `151-03:291-293`, `151-04:219,299`, `151-05:92`, `151-06:101-105,134`, `151-07:245`), each naming the RED commit hash and the observed failure count, with two documented mutation falsifiers (the `handleWeightChange` neuter and the commit-route branch-order flip). The falsifiability contract was therefore honoured in substance; only the ledger file went stale. Worth fixing as a workflow habit — it costs nothing at the time and is the artifact a later auditor will reach for first.

### Human Verification Required

Four items. The first three are PROD-gated by construction — every automated test in this phase runs against offline injection seams, mocked Supabase clients, or a mocked RPC.

#### 1. The founder's own book reaches "From my book" on PROD

**Test:** On PROD as the founder, open Allocations → Scenario.
**Expected:** The "From my book" segment renders and is selected on load. The partial-book note reads "N of M keys not yet contributing — no per-key history yet." with M counting only the founder's own (non-manager) keys — not "6 of 8". Scenario AUM is non-zero.
**Why human:** The role split depends on the founder's live `strategies` / `strategy_keys` topology. The unit fixture reproduces the documented census (`queries.my-allocation.test.ts:3172`) but cannot prove the PROD rows match it.

#### 2. MT5 equity row lands and the stale error clears

**Test:** After the next 04:00 cron (or a manual "Sync now") with `MT5_ENABLED=true` on the worker, inspect `allocator_holdings` for `venue='mt5'` and `api_keys.sync_error` for key `46293712-59e6-46c0-8204-5dd32afe2503`.
**Expected:** One row per MT5 account, `symbol='ACCOUNT-<first 8 of key id>'`, `holding_type='spot'`, `mark_price=1.0`, `value_usd` = account equity. `sync_error` no longer contains `"'Mt5Session' object has no attribute 'fetch_balance'"`.
**Why human:** Requires a live Wine terminal and RPyC gateway plus a real broker account.
**Note:** if the account currency is not USD the correct outcome is the honest skip copy, **not** a row — that is the deliberate no-FX-seam decision, not a failure.

#### 3. The headline flow commits on PROD

**Test:** Blank-slate scenario → add one strategy → PORTFOLIO AUM `2000000` → strategy dollar field `500000` → Commit.
**Expected:** Weight 0.250; commit returns 200 (**not** 409 `portfolio_fingerprint_stale`); the audit row carries `_size_source='client_manual_aum'` and `size_at_decision_usd=500000`.
**Why human:** The 409 was a live RPC precondition. Unit tests prove the client sends `null` and the route forwards `null`; only a real `commit_scenario_batch` call proves Postgres skips the precondition.

#### 4. Visual conformance

**Test:** Check the partial-book note and the PORTFOLIO AUM field against DESIGN.md.
**Expected:** Muted steady-state note (never amber, never `role=alert`); the AUM input matches the composer's existing numeric-field treatment.
**Why human:** Aesthetic conformance is not greppable.

### Gaps Summary

**No gaps.** Every one of the four ROADMAP success criteria and all 30 merged must-have truths is backed by substantive, wired, data-flowing code with independently-derived test oracles — not by file existence. The three code-review blockers and eight warnings are real fixes in the diff, each carrying its own regression cover, and both deferred items (`DEF-151-05-A`, `DEF-151-05-B`) are genuinely closed rather than re-labelled.

The one deliberate deviation — the MEMBER-04 stamp moving onto the split gate — was adjudicated against MEMBER-04's actual requirement text and resolved as **preserving** the invariant: the disclosure machinery is untouched, the frozen version was itself violating the "never a different member set" clause under a partial book, and the replacement pin asserts the stamp equals the engine's *independently observed* unit set.

Status is `human_needed` rather than `passed` solely because three of this phase's outcomes — the founder's real book, the live MT5 terminal read, and the live RPC precondition — cannot be proven from the codebase. Nothing is blocking; the automated surface is fully green.

---

_Verified: 2026-08-07T15:05:00Z_
_Verifier: Claude (gsd-verifier)_

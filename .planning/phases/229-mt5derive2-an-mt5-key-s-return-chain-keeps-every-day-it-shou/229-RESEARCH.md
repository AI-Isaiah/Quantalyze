# Phase 229: MT5DERIVE2 - Research

**Researched:** 2026-11-24
**Domain:** analytics-service money math (`services/nav_twr.py`), the key-mode derive writer (`services/job_worker.py`), the allocator compose reader (`services/allocator_equity_derive.py`, `services/allocator_equity_compose.py`), the MT5 soak oracle (`scripts/mt5_soak.py`)
**Confidence:** HIGH on code behaviour (every claim below was read in the worktree at HEAD `f30a579be` or driven in a scratch run); MEDIUM on the two ASSUMED operational points (see Assumptions Log)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### D-15 band (MT5D-06)
- RULED (founder 2026-11-24, AskUserQuestion): "Keep 1.0, accept band (Recommended)". The D-15 band is ACCEPTED: `FLOW_TIMING_LARGE_RATIO` stays 1.0, no code change to the ratio, and the factsheet copy is unchanged. This acceptance with its reason closes MT5D-06 and `[164.6.6.2.3-D15-THRESHOLD-BAND]` (ROADMAP SC-3 second arm). Reason: the root fix for a day-level venue is intraday timing (`[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]`), not a broader note, and a lower ratio had no measured fleet rationale. — **Reversibility:** costly — lowering it later changes the factsheet copy and the payload cache version. Lineage of the question: asked 2026-11-24 through the orchestrator (ROADMAP: "a founder ruling at plan time, and `FLOW_TIMING_LARGE_RATIO` is never widened to make a check pass"). Facts put to the founder: the flag is an annotation only (no published number, status or golden/spine fixture moves on it); it drives the factsheet copy "Some days carried a deposit or withdrawal at least as large as the balance before it, with no time of day, so their returns can be extreme." (`src/app/factsheet/[id]/v2/FactsheetView.tsx`), so any lower ratio also changes that copy (DESIGN.md check) and the payload cache version. Recommendation given: accept the band as recorded, keeping 1.0, because the root fix for a day-level venue is intraday timing (`[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]`), not a broader note, and a lower ratio has no measured fleet rationale yet.

### Timed MT5 key with no writer basis (MT5D-07)
- RULED (founder 2026-11-24, AskUserQuestion): "Block it (Recommended)". A timed MT5 key with no writer basis raises the blocking `key_inputs_mismatch`, like the holed-key precedent, with a log line carrying counts only that names the branch that returned no basis. — **Reversibility:** costly — changes what an allocator book shows for such a key. Lineage: measured on PROD 2026-11-24 (marker query first): all 11 MT5 `key_inputs` rows (9 USD, 2 native-unit) carry a writer basis today, so either answer moves no live key now. Recommendation given: block as the holed-key case already does (the compose raises the blocking `key_inputs_mismatch`), with a counts-only log naming the branch that returned no basis; it self-heals on the next derive once the missing close lands (PITFALLS 14: a transient miss must not read as proof, so the block names the cause rather than deleting anything).

### Decided autonomously
- [Empty cohort 0] Q: "Which cohort-0 rule closes MT5D-04?" → Selected: "An empty cohort 0 (no P&L) is skipped whenever a later cohort on the same timed day is judged, on every day, not only inception; a cohort 0 with P&L is always judged; a day with no judged cohort keeps today's behaviour. Phase 188's tiny-base rule keeps precedence: it is still judged on the day's starting NAV after the cohort guards (188 D-02/D-03, T-A1), so a re-fund into an account left on a positive sliver under 5% of its 30-day peak stays left out by founder decision; a re-fund from zero or below (188 D-05 keeps those out of the tiny rule) or from a dust level that is not tiny is now measured" — the TODOS entry's own done-when, bounded by the later founder rule. Probed 2026-11-24 on today's code: prev 0 and -0.5 drop as negative_nav_guard, prev 5 as dust_nav_guard, prev 150 and 400 (peak 10,100) as tiny_base_guard.
- [Inception day-0 P&L] Q: "Book or flag?" → Selected: "Flag by name: a day-0 that carries P&L and is skipped as the inception day with no DayTiming is counted under a named annotation key (count of days), not a status-promoting warning, matching D-12's 'no return, no warning' for the deposit-only case" — with no timing the day has no base to book a return against (pre-history capital is zero), so a flag is the only honest outcome; the annotation-vs-warning class is a one-line change.
- [Writer-basis values] Q: "What does the HOLD-03 check guarantee?" → Selected: "The invariant only: a `key_inputs` row and a returns set from two different derives that share the calendar are refused as the blocking `key_inputs_mismatch`, and a healthy pair is never refused, including a timed MT5 flow day (its stored return is a product of cohort returns and cannot be inverted, see the `segment terminals withheld` comment in job_worker.py) and a guard-NaN day (P&L with no return). The comparison itself (a per-day value cross-check on the days where it is exact, a shared derive stamp on both rows, or both) is chosen by research with a stated tolerance" — the 2026-10-10 TODOS formula `abs(r[d] * L - w_pnl[d]) <= tol` predates FLOWTIMING and would falsely refuse timed days, so it is not pinned here.
- [Proof] Q: "How is each gate proved?" → Selected: "PROOF-01 per ROADMAP SC-5: RED on pre-fix code or a neutered copy with its named arm first, restored by `cp` from a byte backup and `cmp`, GREEN, recorded verbatim in the plan SUMMARY; money-math oracles import no production helper; the frozen spine is never re-baselined by `regen_golden.py`" — ROADMAP-mandated.
- [Soak] Q: "How is 226's soak recorded?" → Selected: "Run `analytics-service/scripts/mt5_soak.py` against the changed derive before ship and record its verbatim verdict in the phase records beside the merge" — ROADMAP SC-5.

### Claude's Discretion
- Plan split, test file placement, the exact annotation key names and the HOLD-03 tolerance value, provided they are stated and pinned.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MT5D-04 | A timed re-funding day with an empty cohort 0 keeps the return chain intact instead of being dropped by a guard | Exact rule and its measured effect (3 classes: zero/negative base, dust-not-tiny, tiny stays out), the 2 existing tests that flip, the soak oracle that must change with it (section "MT5D-04") |
| MT5D-05 | An inception day's P&L is booked, or flagged by name, never dropped as NaN without a flag | Flag spec, threshold, the full carry chain, and the finding that the same skip fires on the native (Deribit) and ccxt paths (section "MT5D-05") |
| MT5D-06 | The D-15 band is annotated or recorded as accepted; the ratio is never widened | Founder ruling is a record-only close; the existing boundary pin already bites; nothing to build beyond the record (section "MT5D-06") |
| MT5D-07 | A timed MT5 key with no writer basis is counted or blocked with a named signal | Branch census of every None path, a measured silent shape at HEAD, the writer-token plus reader-block design (section "MT5D-07") |
| HOLD-03 | The writer-basis gate compares per-day values as well as the calendar and refuses a same-day re-derive pair whose P&L does not match | Option choice (b, as a content stamp), why (a) and (c) lose, tolerance, false-refusal walk, a measured RED pair at HEAD (section "HOLD-03") |
</phase_requirements>

## Summary

All five items are reachable with **no migration**. Every new stored field is a present-only additive key in the `allocator_equity_derived.payload` jsonb (kind `key_inputs:<api_key_id>`); `csv_daily_returns` and every table stay as they are. The work splits cleanly into three areas: (1) two edits inside `services/nav_twr.py` (`_judged_cohorts`, `chain_linked_twr`) plus the annotation carry chain; (2) the `key_inputs` writer/reader contract in `job_worker.py` and `allocator_equity_derive.py`, which carries MT5D-07 and HOLD-03 together (Pattern 3: writer and reader of one contract change in one phase); (3) the independent soak oracle in `scripts/mt5_soak.py`, which encodes the OLD cohort-0 rule and must be rewritten from CONTEXT's rule text in the same phase.

Three findings change what the plan must do. First, the soak's `_walk_cohorts` copies the old rule: under the new rule the existing soak test `test_one_checked_day_among_knife_edge_sweep_days_is_not_green[10000.0-10050.0]` goes red with `timed_day_not_nan`, and a live soak on any real re-fund-from-zero day would go red the same way. Second, HOLD-03 option (a) cannot be a gate: a timed day whose flows net to zero (deposit +100, trade, withdrawal -100) has stored return 0.00909 against `P/L_prev` 0.01 and a day-summed flow of 0.0, so no stored field says "this day is inexact"; and `csv_daily_returns` has no jsonb or stamp column, so option (b) as a pure identifier needs a migration. The workable form of (b) is a per-day returns record stored in `key_inputs` and compared by the compose. Third, MT5D-07's silent path is real and measured at HEAD (a timed late deposit-and-trade day plus an unpriced trailing close composes with `degrade_reasons=[]`, `is_trustworthy=True` and no `writer_basis` flag), but several fixtures only block incidentally through `inception_unreconciled`, so every RED arm must assert the named reason `key_inputs_mismatch`.

**Primary recommendation:** Plan three work packages: (A) `nav_twr.py` MT5D-04 + MT5D-05 with the annotation carry chain; (B) an independent rewrite of the soak oracle's cohort rule (separate executor, disjoint files); (C) one plan for the `key_inputs` contract (MT5D-07 writer token plus reader block, HOLD-03 returns record plus reader compare), because both edit the same `job_worker.py` store gate, the same three read sites and the same `degrade_reasons=` list. Close MT5D-06 as a record: delete the TODOS entries at ship and name them in the CHANGELOG.

## Project Constraints (from CLAUDE.md)

- **Which database am I on:** never write PROD/TEST without the marker query first (`SELECT shobj_description(oid, 'pg_database') ...`). This phase writes nothing to any database; PROD reads were not needed and none were made.
- **CHANGELOG discipline:** the ship writes one unified `## [X.Y.Z.B]` entry before the push, in the same commit as the VERSION bump; every commit maps to a bullet. Never write the skip-CI tokens in a commit message or PR body, not even to deny them.
- **TODOS.md holds open work only:** the ship deletes the entries it closes in the same PR and names them in the CHANGELOG. Entries this phase closes: `[164.6.6.2.3-EMPTY-COHORT0-REFUND]`, `[164.6.6.2.3-INCEPTION-DAY0-PNL]`, `[164.6.6.2.3-D15-THRESHOLD-BAND]`, `[164.6.6.2.3-MT5-BASIS-SILENT-NONE]` and the section `### 167.1.2.2.1-WRITER-BASIS-VALUES`. `[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]` stays open (it is the D-15 root fix). Do not delete `### 167.1.2.2.1-WRITER-BASIS-EMPTY-READS-LEGACY`; its trigger is "any change to `read_writer_basis`", so keep `read_writer_basis` byte-unchanged and add sibling functions (see Pitfall 7).
- **Completion is historical:** VERIFICATION frontmatter uses `verified_at_sha` and `drift_subjects`, never `covered_digest` or `covered_files`.
- **mypy strict is a CI gate** over `services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`; `scripts/` is not gated (so `mt5_soak.py` is not type-gated, but keep its existing annotations).
- **pytest only from `analytics-service/`.** Tests verify intent: every gate must be shown able to fail (neuter, see RED, restore from a byte backup, never `git checkout`, `restore` or `stash`).
- **Public repo with `.planning/` tracked:** no secrets, PROD ids, home paths or account numbers in tracked text. The soak writes a JSON record containing broker detail; keep that file out of tracked paths and put only verbatim verdict lines in the SUMMARY.
- **Surgical changes, root cause, fail loud, match conventions** (user CLAUDE.md Rules 3, 6, 11, 12). DESIGN.md is not touched: no UI or copy change is in scope.
- **Brief rules for every executor here:** mypy strict and pytest-from-`analytics-service/` belong in every analytics task; parallel same-wave plans run in separate worktrees with explicit `git add` paths.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cohort rule and inception flag (MT5D-04/05) | Analytics worker, pure NAV/TWR core (`nav_twr.py`) | none | Pure function over a NAV series; shared by MT5, Deribit and ccxt callers |
| Annotation carry (MT5D-05) | Analytics worker (`transforms.py`, `job_worker.py` prestamp, `analytics_runner.py`) | Database (`strategy_analytics.data_quality_flags`) | Annotations ride the existing present-only carry chain; the frontend ignores unknown keys |
| No-basis token write (MT5D-07) | Analytics worker, key-mode derive (`job_worker.py` store gate) | Database (`allocator_equity_derived` jsonb) | The writer alone knows the branch and the timed-day count |
| Block on token, stamp compare (MT5D-07, HOLD-03) | Analytics worker, compose job read loop (`derive_allocator_equity`) | `allocator_equity_derive.py` pure helpers | The compose cannot see "timed" or the branch; the stitch replaces per-key series, so the compare must run per raw key before the stitch |
| Returns record storage (HOLD-03) | Database jsonb payload (no migration) | none | `csv_daily_returns` has no jsonb or stamp column |
| Independent soak oracle | Operational script (`scripts/mt5_soak.py`) | Tests (`tests/test_mt5_soak.py`) | Must be re-derived from the rule text, importing no production helper |
| Browser / SSR | not touched | not touched | No copy, no payload key, no DESIGN.md surface changes |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Python | 3.12.13 | analytics-service runtime | [VERIFIED: `python --version` in the project venv] |
| pandas | pinned in `analytics-service/requirements.txt` | series handling in `nav_twr.py` and the derive | already the house dependency; no new use |
| pytest | pinned in `requirements-dev.txt`, `asyncio_mode = auto` | test runner | [VERIFIED: `analytics-service/pytest.ini`] |
| mypy | 2.4.0 | CI strict type gate | [VERIFIED: `python -m mypy --version` in the project venv] |

### Supporting
No new packages. **Installation:** none.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-day returns record in `key_inputs` | A stamp column on `csv_daily_returns` | A column is a migration, needs migration-reviewer and rls-policy-auditor, and Phase 229 is ruled "no migration expected"; rejected |
| Returns record comparison | `csv_daily_returns.updated_at` as the stamp | No trigger refreshes it (only `csv_daily_returns_owner_coherence` exists) and the repo already rejected it as an ordering signal [CITED: `supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql` lines 118-134]; it also cannot carry a derive identity |

## Package Legitimacy Audit

No external package is installed or added by this phase. Audit not applicable.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 MT5 deal ledger / native BTC ledger
        |
        v
 combine_mt5_deal_ledger  --> reconstruct_nav_and_twr --> chain_linked_twr   <== MT5D-04 (_judged_cohorts) + MT5D-05 (inception flag)
        |                           |                          |
        |                           |                          +--> returns (NaN on a dropped day), flags
        v                           v
 run_derive_broker_dailies_job (key mode)
   |  native BTC key: _convert_native_key_to_usd -> _native_key_usd_writer_basis   (None on several branches)   <== MT5D-07 (reason token)
   |  USD key: basis = mt5_day_pnl + _flows_to_daily_usd (always stored when timed)
   |
   +-- (1) upsert csv_daily_returns (api_key_id,date)   rows_payload                         <== HOLD-03 (stamp is built from exactly these rows)
   +-- (2) epilogue: upsert allocator_equity_derived  kind key_inputs:<key>   (jsonb)
   |        store gate: basis present  -> composed_flows + composed_day_pnl + realized terminal + returns record
   |                    basis absent && timed -> writer_basis_withheld = <token> + counts-only warning (names the branch)
   +-- (3) enqueue derive_allocator_equity (dedups onto a pending OR running job)
        |
        v
 derive_allocator_equity (compose job)
   read csv_daily_returns -> returns_by_key / source_returns   (raw per key)
   read key_inputs rows at three sites: departed, stitch-source, counted
        |-- HOLD-03: compare each raw key series to its stored returns record  (BEFORE stitch_shared_account)
        |-- MT5D-07: key has writer_basis_withheld token
        v
   degrade_reasons=[... (KEY_INPUTS_MISMATCH, count > 0)]  -->  compose_allocator_equity  --> is_trustworthy False (blocking)
```

### Recommended Project Structure
```
analytics-service/
|-- services/nav_twr.py                    # MT5D-04 rule, MT5D-05 flag, annotation registry
|-- services/transforms.py                 # annotation carry for the ccxt path (_merge_status_meta)
|-- services/analytics_runner.py           # DataQualityFlags TypedDict + present-only carry
|-- services/job_worker.py                 # store gate token, returns record, three read sites, degrade list, prestamp carry
|-- services/allocator_equity_derive.py    # sibling helpers: returns_stamp_payload / read_returns_stamp / mismatch count, token reader
|-- scripts/mt5_soak.py                    # _walk_cohorts rewritten from the rule text (independent)
`-- tests/                                 # test_nav_twr.py, test_mt5_soak.py, test_allocator_equity_writer_basis.py (+ new arms)
```

### MT5D-04: the empty-cohort-0 rule

**Current code** [VERIFIED: `analytics-service/services/nav_twr.py` `_judged_cohorts`, Read this session]: the skip line is
`if (k > 0 or inception) and pnl == 0.0:` followed by the comment `# Nothing was opened on this capital (an inception day's cohort 0 has none` ... so a non-inception cohort 0 is always judged, even when empty, and `_timed_day_return` then guards its base (`prev`).

**New rule (CONTEXT, locked):** skip cohort 0 when it is empty AND at least one later cohort on the day holds P&L (so will be judged), on every day. A cohort 0 with P&L is always judged. A day with no judged cohort keeps today's behaviour (a non-inception flow-only or deposit-only day still judges cohort 0 on `prev`; an inception day with no P&L still returns `(nan, None)`).

**Verified sketch** (applied to a scratch copy of the function; not committed):
```python
cohort_pnl = [...]                      # unchanged accumulation
later_judged = any(cohort_pnl[k] != 0.0 for k in range(1, n_cohorts))
for k in range(n_cohorts):
    if k > 0:
        capital += flows[k - 1][1]
    pnl = cohort_pnl[k]
    if pnl == 0.0 and (k > 0 or inception or later_judged):
        continue                         # its flow already sits in ``capital``
    judged.append((capital, pnl))
    capital += pnl
```
Measured with that rule on the CONTEXT probe (day 3 re-funds 1,000 then earns 50; peak 10,100):

| prev (starting NAV) | HEAD | with the rule |
|---|---|---|
| 0.0 | NaN, `negative_nav_guard` | 0.05, no flag |
| -0.5 | NaN, `negative_nav_guard` | 0.05003, no flag |
| 5.0 | NaN, `dust_nav_guard` | NaN, **`tiny_base_guard`** (5 < 5% of 10,100; the label changes, the day is still left out) |
| 150, 400 | NaN, `tiny_base_guard` | unchanged, still `tiny_base_guard` (188 precedence, T-A1) |

CONTEXT names a third "now measured" class, a dust level that is not tiny. Measured (day 3 re-funds 1,000 and earns 10, account peak 100): prev 50 / peak 100 goes HEAD `dust_nav_guard` -> 0.00952; prev 5 / peak 100 (exactly 5%, `is_tiny_base` is strict `<`) goes -> 0.00995; prev 4 / peak 100 and prev 50 / peak 2,000 stay `tiny_base_guard`. [VERIFIED: scratch run; `services/tiny_base.py` line 35 `TINY_BASE_FRACTION: Final[float] = 0.05` and lines 92-96 `0.0 < base < TINY_BASE_FRACTION * peak`, Read this session.] The planner needs one RED arm per class: zero/negative base, dust-not-tiny, tiny-precedence stays out, cohort 0 with P&L still judged, flow-only day unchanged.

**Second-order effect:** `chain_linked_twr` computes the D-25 `small_base_measured` minimum from `_judged_cohorts` again (`cohort_min = min(base for base, _ in _judged_cohorts(...))`), so an empty cohort 0 no longer contributes its base to `small_base_measured_min_nav`. Intended; no existing test moved.

**Tests that move (measured on the whole suite).** The cohort rule, the day-0 flag (with the recommended 1e-9 relative floor) and the full carry (`NAV_TWR_ANNOTATION_KEYS`, `NavTWRMeta`, `_build_nav_meta`, `transforms._merge_status_meta`, the `job_worker.py` prestamp, `analytics_runner` `DataQualityFlags` and carry) were applied as real edits to a throwaway copy of the tree, and the entire `analytics-service` suite was run with `pytest -n 8 --dist loadgroup`: **15,477 passed, 93 skipped, 4 failed in 124 s.** Two failures are the expected movers below, and they also prove the patched code was the code under test in the workers. The other two (`test_legacy_table_not_named.py::test_no_production_string_names_a_dropped_object`, `test_probe_composite_claimtime.py::...test_a_path_inside_the_repository_is_refused`) are artifacts of the copy having no `.git` (`git ls-files` exits 128); both pass in the real worktree (re-run, 2 passed). The movers:
1. `tests/test_nav_twr.py::test_inception_with_a_timing_measures_the_positions_opened_after_the_deposit`: its second half asserts `np.isnan(off.loc[day0])` for the same record without `full_history`, i.e. "judged on a base of (about) zero and keeps its guard - the rule is opt-in". Under the founder-ruled rule that day is measured. PROOF-01 forbids "re-pinned values" as a close, so do not silently edit the assertion: replace the `off` half with a test named for the new invariant, and quote the old assertion plus the ruling (CONTEXT, ROADMAP SC-1) in the SUMMARY.
2. `tests/test_mt5_soak.py::test_one_checked_day_among_knife_edge_sweep_days_is_not_green[10000.0-10050.0]` (the zero-base sweep): fails with `timed_day_not_nan` on days 10-04..10-08. The soak's own `_walk_cohorts` still judges a non-inception cohort 0. The `[1000.0-950.0]` dust-floor sweep param did not move.
What this does **not** cover: the new `key_inputs` fields (the withheld token and the returns record) were not built in the copy. A grep over `analytics-service/tests` found no exact-key-set assertion on the persisted `key_inputs` payload (only `not in payload` probes on named keys), so additive fields are not expected to move a test, but that is by grep, not by run; the plan's per-wave run settles it.
The frozen-spine tests (`test_golden_parity.py`, `test_mt5_golden_fixtures.py`) stayed green in the full run, so there is nothing to re-baseline and `regen_golden.py` is never run.

**Soak oracle (separate work package):** `scripts/mt5_soak.py` `_walk_cohorts` carries the old rule in code and in its docstring ("the one exception is the first cohort of a non-inception day") and `_reconcile_published_returns`'s `indeterminate` text says an "empty cohort ... skipped". After the derive change the soak is red against correct output and a live run on a real re-fund day exits 1. Pitfall 12 tension: the oracle must be rewritten from CONTEXT's rule text (and checked against a hand-built `Fraction` walk), not by copying the production edit, and it needs its own RED proof (neuter the new soak rule in a byte copy and show the named arm fails). The zero-base sweep test needs a new fixture: its premise (the sweep days sit on a knife edge and certify nothing) changed because those days are now measured. Keep the CR-04 intent with a fixture whose judged cohort base is on the knife edge.

### MT5D-05: the inception day-0 flag

**Current code** [VERIFIED: `nav_twr.py` `chain_linked_twr`, Read]: after the timed branch (which always `continue`s), the lines
```python
        if inception:
            # D-12: with no timestamps day 0 is the inception day: no return, no warning.
            continue
```
drop day 0 without looking at P&L. This branch is reached only when the day has no `DayTiming`, so a timed inception day (cohort after the first deposit) is already measured.

**Spec (CONTEXT, locked: flag by name, annotation not warning):** count a day-0 inception skip whose P&L is non-zero. P&L is the loop's own expression `cur - prev - flow_t` (the non-inception branch already names it `pnl_t`). Do not use `daily_pnl.iloc[0]`: for sFOX and the native core it is a formal argument. Threshold: the deposit-only day must not flag from float residue (`prev = cur - pnl0 - flow` leaves ~1e-16 relative noise; Deribit's composed series can leave more), while "P&L exists" is the point, not "P&L is material". Recommend a relative noise floor of `1e-9 * max(abs(cur), abs(flow_t))` (the soak's own `_RETURN_CHECK_TOL = 1e-9` is the precedent, `scripts/mt5_soak.py`), not `floors.residual_abs_tol` ($1.00 USD, 1e-6 BTC), which would let a $0.60 day-0 P&L drop unflagged. Pin both sides: P&L exactly 0.0 -> no flag, residue 1e-12 -> no flag, 0.01 -> flag. [ASSUMED: the 1e-9 value is a recommendation; it is the discretion item "exact annotation key names ... provided they are stated and pinned".]

**Every identifier marked (new) in this file does not exist at HEAD; do not grep for it.** **Keys (new, discretion, recommended):** `inception_day_pnl_dropped` (bool) and `inception_day_pnl_dropped_days` (int, 0 or 1 by construction, kept to match "count of days" and the `flow_timing_day_level` + `_days` precedent).

**The same skip fires on the native and ccxt paths (answer to the research question).** `chain_linked_twr` is shared. `native_nav.reconstruct_native_nav_and_twr` (the Deribit core) calls it with `full_history=ledger.full_history, inception_certified=ledger.full_history` and no `timing`, and Deribit's ledger is built with `NativeLedger(full_history=True)` (`services/deribit_ingest.py`), so every Deribit key with a day-0 P&L will carry the new flag. The ccxt venues pass `full_history=_ccxt_full_history_verdict(...)` (`job_worker.py`, `okx_archive_job.py`), which is `True` for Binance always. MT5 passes `full_history=True` (`broker_dailies.combine_mt5_deal_ledger`), and the MT5 native-BTC key goes through the same combine. State this in the SUMMARY: no number moves, but the flag can appear on any full-history key whose day 0 passes the inception predicate and carries P&L (Deribit keys and strategies, MT5, and the ccxt strategies whose `_ccxt_full_history_verdict` is true) at its next derive.

**Carry chain (answer to "how far"):** a flag nobody can read is not "flagged by name", so carry the bool through the same sites as `flow_timing_day_level_large`, and stop before the frontend:
1. `nav_twr.py`: the flag in `chain_linked_twr`, both keys in `NAV_TWR_ANNOTATION_KEYS`, both declared on `NavTWRMeta`, present-only carry in `_build_nav_meta`. **The declaration is enforced:** `tests/test_nav_twr.py::test_small_base_is_an_annotation_not_a_guard_key` iterates `NAV_TWR_ANNOTATION_KEYS` and asserts each key is in `NavTWRMeta.__annotations__` (it failed in the scratch run until the key was declared). Never add the key to `NAV_TWR_GUARD_KEYS` (membership promotes status to `complete_with_warnings`).
2. `services/transforms.py` `_merge_status_meta` (the ccxt path): present-only `is True` carry, exactly like `flow_timing_day_level_large`. Skipping it silently loses the flag on ccxt (the SHOULD-1 hazard its comments describe).
3. `services/job_worker.py` prestamp block (`if meta.get("flow_timing_day_level_large") is True: _prestamp_flags[...] = True`): bool only, no count.
4. `services/analytics_runner.py` `DataQualityFlags` TypedDict and the present-only `existing_flags.get(...) is True` carry.
5. Frontend: **none**. `src/lib/factsheet` reads only the keys it names; an unknown key is ignored, so the payload and DESIGN.md are untouched. A copy line would also change the payload cache version (the D-15 ruling's reason); out of scope.
Key mode never stamps `strategy_analytics`, so the allocator path sees no change; the linked strategy-mode derive carries the bool.

**Tests that move:** none beyond the two listed under MT5D-04, measured with the prescribed 1e-9 floor and the full carry in the whole-suite run above. The registry pin `test_small_base_is_an_annotation_not_a_guard_key` forces the `NavTWRMeta` declaration (it failed in an earlier scratch run that omitted it) and is green once the keys are declared.

### MT5D-06: record only

Founder ruling 2026-11-24 closes it. No ratio or copy change. `FLOW_TIMING_LARGE_RATIO = 1.0` [VERIFIED: `nav_twr.py` line 93]. The band is already pinned: `tests/test_nav_twr.py::test_f1_large_flow_boundary_is_the_retired_dominance_condition` asserts `(999.99, False)` and `(-999.99, False)` just under the ratio and `(1000.0, True)` at it, so lowering the ratio goes RED today. PROOF-01 arm: neuter `FLOW_TIMING_LARGE_RATIO` to 0.5 in a byte copy, see the `999.99` arm fail first, restore, GREEN. Optional, comment-only: a dated line beside the constant recording the acceptance and reason (no behaviour change). At ship: delete `[164.6.6.2.3-D15-THRESHOLD-BAND]` from `TODOS.md`, name it in the CHANGELOG, keep `[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]` open.

### MT5D-07: the None-branch census and where the block hooks

`WRITER_BASIS_VENUES: Final[frozenset[str]] = frozenset({"deribit", "mt5"})` [VERIFIED: `job_worker.py` line 364]. The caller `_convert_native_key_to_usd` stores a basis only when `priced_through is not None and not hole_ends and not unpriced_iso`, and `_native_key_usd_writer_basis` can return None on four more branches. The hole branch is already blocked when timed (the `segment terminals withheld` block, test `test_a_holed_btc_key_with_a_timed_day_withholds_the_basis_and_the_terminals`). Census (reachability by driving `_convert_native_key_to_usd` with hand-built series, plus an end-to-end derive-then-compose run for the one that matters):

| # | Branch | Reachable from the derive? | Transient? (PITFALLS 14) | Compose today |
|---|---|---|---|---|
| G1 | `priced_through is None` (no USD return day: closes absent for every pair) | yes (driven: "closes for days 1 and 5 only" gives `priced_through=None`) | yes, heals when closes are stored | key has no USD return rows -> the `<2 days` exit; the F1(a) comment says anchored-without-returns degrades as `DROPPED_KEY` (blocking) [CITED: `job_worker.py` comment at the `<2-day` exit] |
| G2 | `hole_ends` non-empty (interior unpriced hole) | yes | yes | untimed: composes in segments from stored terminals; timed: terminals withheld, compose raises `key_inputs_mismatch` (existing, pinned) |
| **G3** | `unpriced_iso` non-empty but `hole_ends` empty (a leading or trailing unpriced stretch; `hole_segment_ends` docstring: "An unpriced day before the first event or after the last separates nothing") | **yes, driven**: closes missing for day 0, or for day 3 with day 4 still stored, gives `unpriced_days` non-empty, `segment_terminals == []`, no basis | yes, heals when the missing close is stored | **silent**: no terminals so the segment rule never fires, no basis so legacy roll. Measured end-to-end (late timed deposit-and-trade day with a small trade, trailing close missing): `degrade_reasons=[]`, `is_trustworthy=True`, no `writer_basis` flag |
| H1 | `native_nav_levels.empty or native_day_pnl.empty` | no with timed days (a timed day needs deals) | n/a | `<2-day` path |
| H2 | `first > priced_through or first not in pnl_by_day` | not by construction (priced_through is a later day than the first NAV day; the P&L index is the NAV index) [ASSUMED, not driven] | structural | n/a |
| H3 | a calendar day in `[first, priced_through]` with no close but not named unpriced (a NaN-return quiet day absent from the sparse P&L index, e.g. a tiny-base-left-out quiet day) | plausible [ASSUMED, not driven] | yes | would compose legacy silently |
| H4 | `carried is None` | unreachable (`first = min(native_levels)`) | n/a | n/a |

**Do not trust incidental blocks.** In the first two G3 fixtures the key is also blocked, but by `inception_unreconciled`, because the legacy roll's error on a large timed deposit day exceeds the zero-start band. That depends on the size of the timed day. With a small timed trade the key composes clean and silent. Every MT5D-07 RED arm must therefore assert `"key_inputs_mismatch" in degrade_reasons` (RED today: it is absent), never merely `is_trustworthy is False`.

**USD (non-native) timed MT5 key: no silent path.** [VERIFIED: `job_worker.py`, Read] `_composed_flows_usd = _flows_to_daily_usd(external_flows)` is set whenever `is_key_mode and not _native_key_usd and _day_pnl_usd is not None`; `_day_pnl_usd = mt5_day_pnl(...)` is set unconditionally in key mode and is empty only for a ledger with no trading deal; `_realized_terminal` is set together with a non-empty day P&L. A timed day needs deals, so the store gate's conditions (`_composed_flows_usd is not None`, non-empty `_basis_day_pnl`, `_realized_terminal is not None`) always hold. Pinned today by `test_an_mt5_key_mode_derive_stores_its_composed_flows_and_day_pnl`. The hook below is placed at the store gate, the one funnel both paths share, so a future USD gap would also be caught (generic token `store_gate_unmet`).

**Marks era (read this session, `job_worker.py` marks block):** with nav marks applied, `_composed_day_pnl_usd` is rebuilt as the pre-start P&L joined with `apply_marks`' post-start P&L, and a key with no basis falls to `_warn_wallet_base_fallback` (counted warning, only when rows precede the first mark). Post-start marked rows are exactly invertible (`day_result / base`), so only the pre-start rows are cohort returns. The block is still correct (conservative): `meta["flow_timing_timed_days"]` counts the realized combine's timed days, before marks. Accepted limit: a key whose timed days all fall inside the marked era is blocked although its published rows are invertible. It self-clears when the basis returns.

**Where the block hooks (design the compose can support).** The compose sees neither "timed" nor the branch, and existing rules cannot be tripped from the writer for a hole-free key (the only writer-driven rule is the missing-terminal rule for a holed key). So: a present-only closed-token field in the `key_inputs` row, read at all three payload sites, mapped through the existing caller-supplied `degrade_reasons=` list.

1. **Writer, branch token:** change `_native_key_usd_writer_basis` to return the basis or a closed reason token (there is exactly one caller, `_convert_native_key_to_usd`, and no test calls it directly; the tests go through `_convert_native_key_to_usd` and read `.composed_day_pnl`). Add a defaulted trailing field to the `_NativeKeyUsd` NamedTuple (one construction site). Tokens, closed set: `no_usd_return_day` (G1), `interior_hole` (G2), `unpriced_days_without_interior_hole` (G3), `no_levels_or_pnl` (H1), `first_day_unpriceable` (H2), `calendar_day_without_close` (H3), `no_carried_level` (H4).
2. **Writer, store gate** (the `if venue in WRITER_BASIS_VENUES and _composed_flows_usd is not None and _basis_day_pnl is not None ...` block): add the `else` for `venue == "mt5"` and `int(meta.get("flow_timing_timed_days", 0)) > 0`: write `_key_inputs_payload["writer_basis_withheld"] = <token>` (new field) (the branch token, or `store_gate_unmet`) and log once, counts only (T-164.6.6.2.3-16): token name, timed-day count, unpriced-day count. Never an id, day or amount. This is the single log line CONTEXT asks for. The payload is rewritten whole each derive, so the field clears itself when a later derive stores the basis.
3. **Reader:** a sibling (new) `read_writer_basis_withheld(payload) -> str | None` in `allocator_equity_derive.py` (do **not** edit `read_writer_basis`, Pitfall 7). Call it at the three read sites in `run_derive_allocator_equity_job`: departed (`_departed_basis`), stitch source (`_source_basis`), counted (`_basis`). An unknown token still blocks (forward compatible); a non-string value is a corrupt input (`ValueError`, like the neighbouring reads).
4. **Block:** collect the keys into a set and add `(DegradeReason.KEY_INPUTS_MISMATCH, count > 0)` to the `degrade_reasons=[...]` list built in `_compose` (the same list that carries `SHARED_ACCOUNT_FLOWS_DISAGREE`). `KEY_INPUTS_MISMATCH` is blocking [VERIFIED: `allocator_equity_derive.py` line 153 `KEY_INPUTS_MISMATCH = "key_inputs_mismatch"` and lines 182-192 `_BLOCKING_REASONS` ... `DegradeReason.KEY_INPUTS_MISMATCH,`]. Emit a counts-only `logger.warning` (key count, token histogram). The no-capital fallback's second compose reuses the `_compose` closure, so the reason survives it. Remove a key from the set wherever the job removes it from the book (the `failing_key_exit_by_key` pops of `anchors_by_key` ... `writer_basis_by_key`, and a no-capital candidate exit), or a departed key flags a book it is not in.
5. **Key on the token, not on an absent basis.** `tests/test_allocator_equity_writer_basis.py::test_a_stitched_mt5_account_without_the_basis_is_counted_not_blocked` pins that a stitched MT5 account whose rows lack a basis (every legacy row) is counted by the SFH-02 visibility tokens and is NOT blocked, and Deribit reads identically. Inferring "no basis" in the reader would move that test, every legacy PROD row and Deribit. A legacy row has no token, so it is not blocked.

Self-heal (PITFALLS 14): nothing is deleted and no key leaves the book; the block names the cause and clears at the next derive that stores a basis. PROD impact: none today (the orchestrator measured all 11 MT5 `key_inputs` rows carrying a basis).

### HOLD-03: the comparison, chosen

**Where the stored returns live:** `csv_daily_returns` (`api_key_id`, `allocator_id`, `date`, `daily_return`; conflict arbiter `api_key_id,date`), upserted by the key-mode derive at one of its two exits, then the epilogue upserts `allocator_equity_derived` kind `key_inputs:<key>`. The two writes are separate statements with no transaction, returns first. The compose reads rows per key with `_load_allocator_daily_returns` and the `key_inputs` rows separately. [VERIFIED: `baseline.sql` lines 13795-13806; `job_worker.py` rows_payload and `_persist_key_inputs`]

**The gap exists at HEAD (measured end-to-end).** Two derives of one BTC key over the same terminal, one with a corrected trade P&L on a quiet day, one on a timed flow day. Composing `key_inputs` of derive A with the returns rows of derive B: `degrade_reasons=[]`, `is_trustworthy=True`, flags `['sole_key', 'writer_basis']`, while the returns differ on 2 days and 1 day respectively. That pair is the RED fixture.

**Choice: (b), realised as a content stamp stored in `key_inputs`. Not (a), not (c).**

Why (a) cannot be the gate (measured):
- The identity `r_d * L_{d-1} = P_d` holds on day-level days (flow in the numerator) and on marked days, but a **timed day with zero day-summed flow** breaks it: prev 1,000, deposit +100, a trade opened between and earning 10, withdrawal -100 gives stored return 0.0090909 against `P/L_prev = 0.01`, and the stored day flow is `0.0` (`composed_flows` omits zero days). "No flow on the day" is therefore not a safe exactness predicate, and the stored fields cannot name the timed days. (a) would falsely refuse a healthy timed day.
- It cannot see a re-derive whose only change sits on a flow day.
- The compose replays a **stitched** series; a per-key compare inside `replay_key_equity` sees the joined series, not each member's own rows.
(a) is kept as a test oracle only: an independent `Fraction` invariant on exact days, importing no production helper.

Why a pure identifier stamp "on both rows" is not available: `csv_daily_returns` has no jsonb or stamp column, and `updated_at` is not usable (no refresh trigger; only `csv_daily_returns_owner_coherence` exists on the table; the repo already rejected it as an ordering signal, see Alternatives Considered). A column is a migration.

**What the stamp is.** The returns the derive wrote are themselves the returns-side stamp. The `key_inputs` row carries their per-day record (a present-only `returns_stamp` list, rows `{utc_day_iso, return}`), written with the other basis fields. The compose recomputes nothing: it compares each raw key series, read from `csv_daily_returns`, to that record.
- **Writer:** `returns_stamp_payload(returns)` (new) in `allocator_equity_derive.py`, built from **exactly the rows the exit wrote** (`rows_payload`, which excludes NaN days; at the `<2-day` exit with marks, `_measured`; at that exit without marks nothing is written, so write **no** stamp). Refuse a non-finite value before the upsert (count only), like `writer_basis_payload`. Only when a basis is stored (`venue in WRITER_BASIS_VENUES`), the same gate as the basis fields.
- **Closure trap:** `_run_key_mode_compose_epilogue` is a closure defined before `rows_payload` exists and is called from both exits (the `<2-day` exit calls it before `rows_payload` is assigned). Initialise an explicit typed variable beside the other epilogue variables, assign it at each exit before the call, and have the epilogue read it (a bare reference would be a `NameError` at the short exit). mypy strict needs the annotation.
- **Reader:** (new) `read_returns_stamp(payload) -> dict[str, float] | None` reusing `_read_basis_rows(raw, "return", "returns stamp")` (it already rejects bool, non-numeric, non-finite and duplicate-day rows), plus `returns_stamp_mismatch_days(stamp, series, *, tol)` returning a count.
- **Compare window:** the stamp's own `[first, last]` day range. Inside it, a day on one side only, or `abs(diff) > tol`, is a mismatch. A stored row after `last` is ignored: the next-day append is already caught, transiently, by the existing `realized_terminal_day_mismatch` rule, so the new check adds no new class of race for routine appends. Rows before `first` are the calendar gate's concern.
- **Where it runs:** at the compose job's read loop, per raw key, **before** `stitch_shared_account` replaces `returns_by_key[kept_id]`, at the same three sites as the token (departed, stitch source, counted). A mismatch adds the key to a set that feeds `(DegradeReason.KEY_INPUTS_MISMATCH, count > 0)` in the same `degrade_reasons=` list, and a counts-only warning (key count, mismatching-day count). Do not pop the basis: the existing mismatch precedents fall back to the legacy roll and block; blocking is the contract, and leaving the basis in place keeps the change to one set and one reason.
- **Tolerance: `1e-12` absolute, in return space.** Derivation: the doubles are written by Python as the shortest round-trip repr and stored as `double precision`; Postgres text output is at worst 15 significant digits, so a read-back differs by at most about `5e-15` for `|r| <= 1`, three orders under 1e-12; a real ledger correction moves a day's return by at least about `1e-9` (cents on a ten-million-dollar book). [ASSUMED: the float8 JSON round-trip digit count was not measured against the live PostgREST stack.]
- **Absent stamp = legacy, not refused.** Every PROD row written before this phase has none; refusing would block every key until its next derive. State it, and count it at info level so the skip is visible, not silent.

**What it guarantees and does not (state in the SUMMARY).** It refuses a pair whose returns rows differ from the returns the row was derived with, on every day type: no-flow, flow, timed, net-zero timed. A guard-NaN day (P&L with no return) never appears in the record, so it cannot cause a false refusal (CONTEXT). A correction confined to such a day that moves no stored return anywhere would not be refused; that is [ASSUMED] rare, because the pair probe showed a correction at a fixed terminal usually moves other days' returns through the backward roll, which the compare then sees. The writer-basis fields and the stamp sit in one atomic upsert of one row, so a row's P&L cannot disagree with its own stamp.

**False-refusal walk (every path that can write or alter a returns row for a writer-basis key):**

| Path | Can it produce a healthy pair that mismatches? | Verdict |
|---|---|---|
| Main key-mode exit: upsert, then delete of absent span days, then epilogue | rows_payload is exactly what the table holds in `[first,last]` after the delete | safe |
| `<2-day` exit with marks: `_measured` upserted, stale days deleted | stamp built from `_measured` | safe if built from `_measured` |
| `<2-day` exit without marks: nothing written | older rows remain; a stamp built from the in-memory `returns` would claim rows the table lacks | **false refusal if stamped from `returns`; write no stamp** |
| Stitched account: each member read raw before the join | compare per raw key, before the stitch | safe; comparing inside `replay_key_equity` would be wrong |
| Nav marks era | rows are the final `returns` after `apply_marks` | safe (stamp is built from the final rows) |
| `okx_archive_job` writes `csv_daily_returns` | OKX only, not in `WRITER_BASIS_VENUES` [ASSUMED: only line 1862's writer was read] | not applicable |
| Window between the returns upsert and the `key_inputs` upsert (same-day re-derive) | a compose reading the stale mix is now blocked, transiently | intended; same shape as the existing `realized_terminal_day_mismatch` for next-day derives |
| That compose then runs while the epilogue enqueues | `_enqueue_compute_job_internal` dedups onto `pending`, `running` and `done_pending_children`, so an enqueue colliding with a **running** compose is swallowed and the blocked book stands until the next compose trigger (about a day) | known limit; record it, do not widen the scope [VERIFIED: `supabase/schema/functions/_enqueue_compute_job_internal.sql` lines 280-286 (the `p_allocator_id` branch: `WHERE allocator_id = p_allocator_id AND kind = p_kind AND status IN ('pending', 'running', 'done_pending_children')`) and 296-299 (`IF v_existing_id IS NOT NULL ... RETURN v_existing_id`)] |
| Deploy: rows without a stamp | skipped | safe |
| Poisoned non-finite value | refused before the upsert | safe |

### Anti-Patterns to Avoid
- **A stamp column on `csv_daily_returns`:** a migration the phase rules out.
- **Gating on `abs(r[d] * L - w_pnl[d]) <= tol`:** falsely refuses net-zero timed days (measured).
- **Inferring "no basis" in the compose:** moves the stitched-MT5 pin, legacy rows and Deribit.
- **Asserting only `is_trustworthy is False` in a RED arm:** `inception_unreconciled` can block incidentally.
- **Building the stamp from the in-memory `returns` instead of the rows written:** false refusal at the `<2-day` exit.
- **Copying the production edit into `mt5_soak.py`:** an oracle that imports what it judges agrees by construction.
- **Re-baselining goldens:** the spine did not move; `regen_golden.py` is never run.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parsing a stored per-day jsonb list | a new row parser | `_read_basis_rows` in `allocator_equity_derive.py` | already refuses bool, non-numeric, non-finite, duplicate days |
| Serialising a per-day payload | an ad hoc dict builder | mirror `writer_basis_payload` (non-finite refusal naming no amount) | the poison value would fail the upsert and loop the derive |
| Marking a key degraded | a new reason or a new payload flag consumer | `DegradeReason.KEY_INPUTS_MISMATCH` via the existing caller-supplied `degrade_reasons=` list | blocking, mapped by the TS reader and the SQL census already |
| An exactness oracle in tests | importing `nav_twr` helpers | hand-coded `Fraction` walk (see `_Forward`, `_btc_usd_oracle` in `test_allocator_equity_writer_basis.py`) | PROOF-01 / Pitfall 12 |
| End-to-end derive-to-compose tests | a new harness | `_derive_btc_key`, `_compose_job`, `_csv_returns`, `_btc_timed_ledger` | already pin the holed-key precedent |

**Key insight:** every new fact this phase stores is a small closed or numeric field in an existing additive jsonb row, read by an existing reader pattern. The risk is not building them; it is choosing a predicate the stored data cannot support (exactness, "timed", "no basis").

## Common Pitfalls

### Pitfall 1: a RED arm that goes red for the wrong reason
**What goes wrong:** a timed fixture is blocked by `inception_unreconciled` so the MT5D-07 test is "red" on the wrong arm. **Why:** the legacy roll's error on a large timed deposit day trips the zero-start band. **How to avoid:** use a small timed trade on a late (non-inception) day and assert `key_inputs_mismatch` by name. **Warning sign:** the RED line names `inception_unreconciled`.

### Pitfall 2: the epilogue closure reads `rows_payload` before it exists
**What goes wrong:** `NameError` at the `<2-day` exit. **How to avoid:** an explicit typed variable assigned at each exit; build the stamp from what that exit wrote.

### Pitfall 3: stamping a series the exit did not write
**What goes wrong:** the `<2-day` exit without marks writes nothing; a stamp from `returns` refuses a healthy key forever. **How to avoid:** `None` stamp when no rows were written.

### Pitfall 4: comparing inside the replay on a stitched account
**What goes wrong:** the replay sees the joined series. **How to avoid:** compare per raw key at the read loop before `stitch_shared_account`.

### Pitfall 5: a regex pin reads `job_worker.py` text
**What goes wrong:** `src/__tests__/tiny-base-literal-pin.test.ts` and `options-cash-basis-literal-pin.test.ts` match source shapes like `_key_inputs_payload["..."] = _tiny_listed` and `if _options_cash_basis_caveat is True: _key_inputs_payload["..."] = True`. **How to avoid:** add new statements; do not reformat or move existing ones; run `npx vitest run src/__tests__/tiny-base-literal-pin.test.ts src/__tests__/options-cash-basis-literal-pin.test.ts`.

### Pitfall 6: the soak goes red against correct output
**What goes wrong:** `_walk_cohorts` keeps the old rule. **How to avoid:** rewrite it in the same phase from the CONTEXT rule text, with its own RED proof, ahead of the live run.

### Pitfall 7: touching `read_writer_basis`
**What goes wrong:** the open entry `167.1.2.2.1-WRITER-BASIS-EMPTY-READS-LEGACY` fires its own trigger ("any change to `read_writer_basis`") and drags an unrelated empty-versus-absent decision into this phase. **How to avoid:** add sibling readers; leave `read_writer_basis` byte-identical.

### Pitfall 8: the 155.2 freeze and the capture reader
**What goes wrong:** a merge between plan 12's recapture and plan 14 voids plan 13's binding. **How to avoid:** this phase moves published MT5 returns (MT5D-04), so it merges before plan 12 [CITED: ROADMAP Phase 229 "Depends on"; CONTEXT: `155.2-12-SUMMARY.md` absent on origin/main at 2026-11-24, re-check at ship]. The SQL capture tests read `composed_day_pnl` and `composed_flows` by `jsonb_set` on named fields, so additive keys do not disturb them.

## Code Examples

### Cohort rule (verified in a scratch run)
See "MT5D-04" above. Source for the numbers: the CONTEXT probe (day 3 re-fund 1,000 then +50, peak 10,100) and the dust-not-tiny probe (peak 100).

### Day-0 flag
```python
# inside chain_linked_twr, replacing the bare ``continue`` of the inception branch
if inception:
    pnl_day0 = cur - prev - flow_t
    if abs(pnl_day0) > _INCEPTION_PNL_NOISE_REL * max(abs(cur), abs(flow_t)):
        inception_pnl_dropped_days += 1      # a count, never the amount (T-73-02)
    continue
# after the loop, beside flow_timing_day_level_large:
if inception_pnl_dropped_days:
    flags["inception_day_pnl_dropped"] = True
    flags["inception_day_pnl_dropped_days"] = inception_pnl_dropped_days
```

### Writer-token and reader-block skeleton (names are discretion)
```python
# writer, at the store gate (else-branch of the basis block)
elif venue == "mt5" and int(meta.get("flow_timing_timed_days", 0)) > 0:
    _token = _usd_key_basis_reason or "store_gate_unmet"
    _key_inputs_payload["writer_basis_withheld"] = _token
    logger.warning(
        "derive_broker_dailies: timed mt5 key stores no writer basis "
        "(branch=%s timed_days=%d unpriced_days=%d)", _token, ...,  # counts and a closed token only
    )

# reader, at the three read sites, then in _compose
(DegradeReason.KEY_INPUTS_MISMATCH, bool(withheld_keys) or bool(stamp_mismatch_keys)),
```

### RED fixtures that already work at HEAD
- MT5D-07 (silent): `_derive_btc_key` over a ledger with a deposit at day 0, a quiet-day trade, a timed deposit-and-trade day at day 2 with a small trade, closes missing for day 3 only (day 4 present). Payload: `unpriced_days` = days 3 and 4, `segment_terminals == []`, no `composed_day_pnl`; `_compose_job` -> `degrade_reasons == []`, `is_trustworthy is True`. The combine over that ledger reports `flow_timing_timed_days == 1` (measured), so the token write, which keys on that count, fires.
- HOLD-03: derive twice over the same terminal, one trade P&L changed (quiet day, and separately the timed day); `_compose_job` with the first payload and the second derive's `_csv_returns(capture)` -> `degrade_reasons == []`, `is_trustworthy is True`.
- Run such probes with `-p tests.conftest` when the file sits outside `tests/`, or the autouse fixtures do not load.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cohort 0 always judged on a non-inception day | Empty cohort 0 skipped whenever a later cohort is judged | this phase (founder-ruled 2026-11-24) | a re-fund into an emptied account keeps its return; published MT5 returns move |
| Day-0 inception P&L dropped silently | Dropped but counted as an annotation | this phase | visible, no status change |
| Writer-basis gate checks calendar only | Calendar plus a per-day returns record | this phase | same-day re-derive pairs are refused |

**Deprecated/outdated:** the soak's `_walk_cohorts` first-cohort rule and its docstring sentence; the second half of `test_inception_with_a_timing_measures_the_positions_opened_after_the_deposit`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A missing BTC close that is named unpriced is eventually stored (so G1/G3/H3 are transient); the mechanism and its cadence were not traced | MT5D-07 | If never stored, the block never clears for that key; the founder ruled block, so the book would stay named-degraded rather than silent |
| A2 | Postgres float8 read through PostgREST returns at least 15 significant digits, so a stored return differs from the written one by under 5e-15 | HOLD-03 tolerance | A noisier round trip would need a larger tolerance; 1e-12 leaves three orders of margin, and a test can store and re-read a value on the lane |
| A3 | `1e-9` relative day-0 P&L noise floor and the key names `inception_day_pnl_dropped(_days)` | MT5D-05 | Naming and threshold are CONTEXT discretion; a wrong threshold either flags float residue or misses a tiny P&L |
| A4 | H2 and H3 reachability is reasoned, not driven | MT5D-07 | A reachable branch with no token falls to `store_gate_unmet`, still blocked; only the branch name would be generic |
| A5 | `okx_archive_job` is the only other writer of `csv_daily_returns` on the key axis and is OKX only | HOLD-03 walk | If another writer touches MT5 or Deribit key rows, add it to the walk |
| A6 | PROD effect not measured here: no Supabase MCP tool was available to this researcher. The orchestrator's measurement (11 of 11 MT5 key_inputs rows carry a basis) is taken as given, and which PROD days the cohort rule moves is unmeasured | Summary, Open Questions | The 155.2 freeze reasoning stands on the code, not on a PROD census |

## Open Questions (RESOLVED)

1. **How many published PROD MT5 days does MT5D-04 move?** RESOLVED: carried as flagged assumption A-01-3 (plan 01) and read off the live soak in plan 06; not a planning input.
   - Known: the rule moves only timed re-fund days with an empty cohort 0 and a non-tiny, non-positive-or-dust start; PROD basis presence is measured.
   - Unclear: the count of affected days per MM2, MM3 and FX-AI_V.
   - Recommendation: not a planning blocker. If the founder wants it before the freeze, a read-only derive-time dry run (the existing `scripts/flowtiming_dry_run.py` is a one-shot measurement tool with a recorded attribution limit) or a counts-only read; otherwise the post-deploy recompute and the soak are the evidence.
2. **Should the day-0 flag reach the factsheet copy?** RESOLVED: no; plan 02 prohibits a frontend change. Recommendation: no. It would change the payload cache version and DESIGN.md surfaces, and the founder's D-15 ruling set the precedent of annotation-only. Leave unknown keys ignored by the TS readers.
3. **Over-block of a key whose timed days all sit in the marked era.** RESOLVED: accepted and recorded as A-03-1 (plan 03). Recommendation: accept (conservative, self-clears); record in the SUMMARY.
4. **A compose that was running when the epilogue enqueued leaves a blocked book until the next trigger.** RESOLVED: recorded as known limit T-229-12. Recommendation: record as a known limit, do not add a re-enqueue (out of scope; the same race exists at HEAD for the terminal-day mismatch).
5. **Deliberate deviation from the named gate location (HOLD-03).** RESOLVED: plan 05 objective and A-05-5; recorded in CONTEXT and as dated notes on ROADMAP SC-4 and REQUIREMENTS HOLD-03 (2026-11-24). CONTEXT and ROADMAP SC-4 name `read_writer_basis` and the writer-basis mode in `replay_key_equity` as the gate. This research places the compare in the compose job's read loop, per raw key before `stitch_shared_account`, using new sibling helpers in `allocator_equity_derive.py`, and keeps `read_writer_basis` byte-unchanged. Reasons: the replay sees the stitched series, not each member's own rows; and editing `read_writer_basis` fires the trigger of the open entry `167.1.2.2.1-WRITER-BASIS-EMPTY-READS-LEGACY`. The reader half of the contract still lives in `allocator_equity_derive.py` (Pattern 3 holds). The plan-checker should read this as intended, not as a missed symbol; if the founder wants the compare inside `replay_key_equity`, stitched accounts need a separate per-member pass anyway.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python project venv | every test and mypy | yes (the worktree has no `.venv`; the main checkout's venv is used with `PYTHONPATH=.`) | 3.12.13 | none needed |
| mypy | CI type gate | yes | 2.4.0 | none |
| Local Supabase stack | none (no SQL, no migration) | not required | - | - |
| MT5 private gateway + investor credentials (`MT5_SPIKE_*`) | the live soak run (SC-5) | not available to an executor | - | The offline soak suite `tests/test_mt5_soak.py` runs with an injected client; the **live run is a founder checkpoint** |
| PROD read access (Supabase MCP) | optional census | not available to this researcher | - | counts-only read by the orchestrator |

**Missing dependencies with no fallback:** the live soak run (it needs the private gateway and broker credentials). Plan it as a `checkpoint:human-verify`/human-needed step after the code lands; record only verdict lines (parity, return-check counts) in the SUMMARY, never the raw JSON (public repo; the default log dir is `docs/evidence` relative to the cwd).

**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (asyncio_mode auto), mypy 2.4.0 strict |
| Config file | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` |
| Quick run command | `cd analytics-service && python -m pytest tests/test_nav_twr.py::<node> -q -p no:cacheprovider` (about 15 s per invocation; the whole `test_nav_twr.py` takes about 155 s, so select nodes) |
| Full suite command | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (the CI `python` job) |
| Type gate | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` [VERIFIED: `.github/workflows/ci.yml` line 5715] |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MT5D-04 | refund into prev 0 / -0.5 measured; dust-not-tiny measured; tiny precedence stays out; cohort 0 with P&L judged; flow-only day unchanged | unit | `pytest tests/test_nav_twr.py -k "refund or cohort or timed" -q` | new arms in existing file |
| MT5D-04 | flipped pin (inception `off` half) replaced by the new invariant | unit | `pytest tests/test_nav_twr.py::test_inception_with_a_timing_measures_the_positions_opened_after_the_deposit -q` | exists (moves) |
| MT5D-04 | soak oracle follows the rule | unit | `pytest tests/test_mt5_soak.py -q` | exists (zero-base sweep param needs a new fixture) |
| MT5D-05 | day-0 P&L with no timing counted; deposit-only day not flagged; residue not flagged; native path (`reconstruct_native_nav_and_twr`) and `combine_mt5_deal_ledger` day 0 flagged; carry through `_build_nav_meta`, `_merge_status_meta`, prestamp, runner | unit | `pytest tests/test_nav_twr.py tests/test_transforms.py tests/test_csv_analytics_runner.py -k "inception or day_pnl_dropped" -q` | new arms |
| MT5D-05 | registry pin forces the `NavTWRMeta` declaration | unit | `pytest tests/test_nav_twr.py::test_small_base_is_an_annotation_not_a_guard_key -q` | exists |
| MT5D-06 | band edge stays pinned | unit | `pytest tests/test_nav_twr.py::test_f1_large_flow_boundary_is_the_retired_dominance_condition -q` | exists |
| MT5D-07 | silent G3 shape composes `key_inputs_mismatch` and names the branch; holed timed key unchanged; legacy and stitched-MT5 rows unchanged; USD timed key stores a basis and no token | e2e derive to compose | `pytest tests/test_allocator_equity_writer_basis.py -k "withheld or holed or stitched_mt5" -q` | new arms in existing file |
| HOLD-03 | mismatched pair refused for quiet-day and timed-day corrections; healthy pairs never refused (timed flow day, net-zero timed day, guard-NaN day, tiny-base NaN day, gap-fill rows, marks era, absent stamp, stitched account) | e2e + unit | `pytest tests/test_allocator_equity_writer_basis.py -k "stamp or returns_record" -q` | new arms |
| HOLD-03 | determinism: two derives of the same inputs store a byte-equal stamp | unit | existing arm (about line 849) extended | exists |
| SC-5 | full-suite and type gate | suite | the two commands above | n/a |
| SC-5 | soak run against the changed derive | live, human | `cd analytics-service && python -m scripts.mt5_soak` (needs `MT5_SPIKE_*`) | founder checkpoint |

### Sampling Rate
- **Per task commit:** the single node or `-k` selection for that task (about 15 s), plus mypy on the touched module set when `services/` changes.
- **Per wave merge:** the three touched suites (`test_nav_twr.py`, `test_mt5_soak.py`, `test_allocator_equity_writer_basis.py`) plus `test_derive_allocator_equity_job.py`, `test_mt5_derive_branch.py`, `test_broker_dailies.py`, `test_native_nav.py`, `test_golden_parity.py`, `test_mt5_golden_fixtures.py`, then the vitest literal pins named in Pitfall 5.
- **Phase gate:** full pytest and full mypy green, bound to the head SHA with the expected check count (CLAUDE.md CI gate integrity), before `/gsd-verify-work`.

### PROOF-01 (every gate shown able to fail, named arm first, restore by `cp` + `cmp`)
| Gate | Neuter (byte copy first) | Expected first RED arm |
|---|---|---|
| MT5D-04 refund | restore `if (k > 0 or inception) and pnl == 0.0:` in `nav_twr.py` | the prev-0 refund test (`negative_nav_guard` present, day NaN) |
| MT5D-04 dust-not-tiny | same neuter | the prev-50/peak-100 test |
| MT5D-04 tiny precedence | make the rule skip the tiny test | the prev-150 test |
| MT5D-05 | delete the counter increment | the day-0 flag test |
| MT5D-06 | `FLOW_TIMING_LARGE_RATIO = 0.5` | the `999.99` arm of the boundary test |
| MT5D-07 | drop the token write at the store gate | the G3 end-to-end test asserting `key_inputs_mismatch` |
| HOLD-03 | make the compare return 0 | the quiet-day pair test, then the timed-day pair test |
| Soak oracle | revert its `_walk_cohorts` to the old rule in a byte copy of `mt5_soak.py` | `timed_day_not_nan` on the re-fund fixture |

Money-math oracles import no production helper (hand-coded `Fraction` walks). The frozen spine is untouched: `test_golden_parity.py` and `test_mt5_golden_fixtures.py` stayed green under the cohort rule, so `regen_golden.py` is never run.

### Wave 0 Gaps
- [ ] New RED fixtures in `tests/test_nav_twr.py` (refund classes, day-0 flag) and `tests/test_allocator_equity_writer_basis.py` (G3 silent shape, mismatched pair, healthy-pair family).
- [ ] A new zero-base-sweep fixture in `tests/test_mt5_soak.py` whose judged cohort base is on the knife edge (the old one is now measured).
- [ ] No framework install needed.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | none touched |
| V3 Session Management | no | none touched |
| V4 Access Control | no | `allocator_equity_derived` stays service-role write, owner read (RLS unchanged); the new fields hold the owner's own returns |
| V5 Input Validation | yes | every new jsonb read goes through `_read_basis_rows`-style validation (type, finite, duplicate-day); a malformed field is a `ValueError` disposed as a corrupt input, never read as a guess |
| V6 Cryptography | no | none |
| V7 Error handling and logging | yes | counts and closed tokens only: no id, day, amount or instrument in any new log line (T-73-02, T-115-05, T-164.6.6.2.3-16) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A stale row paired with fresh returns composes a trusted-looking wrong book | Tampering / Integrity | the returns record compare and the withheld token, both blocking |
| A non-finite value in a stored field poisons the upsert and loops the derive | Denial of service | refuse before the upsert, naming no amount (as `writer_basis_payload`) |
| Amounts leaking through logs or flags | Information disclosure | bool and counts in annotations; the day-0 P&L amount stays in-process |
| A soak record with broker detail committed to a public repo | Information disclosure | keep the raw JSON out of tracked paths; record verdict lines only |

## Sources

### Primary (HIGH confidence)
- `analytics-service/services/nav_twr.py` (Read): `_judged_cohorts`, `_timed_day_return`, `chain_linked_twr`, `_build_nav_meta`, `NAV_TWR_ANNOTATION_KEYS`, `FLOW_TIMING_LARGE_RATIO`
- `analytics-service/services/job_worker.py` (Read): `_NativeKeyUsd`, `_convert_native_key_to_usd`, `_native_key_usd_writer_basis`, the holed-key withhold block, the marks block, `_run_key_mode_compose_epilogue`, the key-mode returns writes at both exits, `derive_allocator_equity` read loop and `_compose`
- `analytics-service/services/allocator_equity_derive.py` (Read): `DegradeReason`, `_BLOCKING_REASONS`, `replay_key_equity`, `writer_basis_payload`, `_read_basis_rows`, `read_writer_basis`
- `analytics-service/services/allocator_equity_compose.py`: `hole_segment_ends`, the missing-terminal rule, the per-key replay call
- `analytics-service/scripts/mt5_soak.py`: `_walk_cohorts`, `_walk_timed_return`, `_reconcile_published_returns`, usage and exit codes
- `supabase/schema/baseline.sql` lines 13795-13806 (`csv_daily_returns`) and 12833-12838 (`allocator_equity_derived`); `supabase/schema/functions/_enqueue_compute_job_internal.sql`
- Scratch runs (CONTEXT probe, dust-not-tiny probe, net-zero timed day, None-branch harness, end-to-end G3 and HOLD-03 derive-to-compose pairs, and a whole-suite run of 15,477 tests against real edits in a throwaway copy)
- `.planning/research/v1.22/PITFALLS.md` (Pitfalls 1, 12, 14, section C), `ARCHITECTURE.md` (Pattern 3, MT5DERIVE2 table), `SUMMARY.md` (Phase C)

### Secondary (MEDIUM confidence)
- `supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql` lines 118-134 (the `updated_at` rejection)

### Tertiary (LOW confidence)
- none (the ASSUMED items are in the Assumptions Log)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new dependency
- Architecture: HIGH, every hook point was read and the two decisive shapes were driven end to end
- Pitfalls: HIGH for the measured ones (net-zero timed day, closure NameError, incidental `inception_unreconciled`, the two moved tests); MEDIUM for A1, A2, A5

**Research date:** 2026-11-24
**Valid until:** 2026-12-08 (fast-moving: phases 225, 231 and 155.2 edit neighbouring symbols; re-measure the symbol locations at the plan's base commit)

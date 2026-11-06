# Phase 178: OKXREWRITE - Research

**Researched:** 2026-10-28
**Domain:** forced whole-account history rebuild of stored OKX allocator snapshot rows (analytics-service rebuild path, read-only probe, PROD operator runbook)
**Confidence:** HIGH on code facts (every discrete value below was read this session), MEDIUM on what PROD holds (nothing here touched PROD; every PROD statement is a prior recorded reading or an `[ASSUMED]` prediction the operator must re-measure)

<user_constraints>
## User Constraints (from CONTEXT.md)

CONTEXT.md read at `178-CONTEXT.md` (commit "capture phase context (founder D-01..D-04, 2026-10-28)"). D-05 below is NOT in the file yet: the orchestrator relayed it mid-research as a scope change and is adding it. Quoted verbatim from that relay.

### Locked Decisions

Carried (locked, not re-asked)
- MARKSOURCE D-05 (founder 2026-10-27, "Also rewrite past rows"): the stored past rows are corrected through the product's own recompute path (the forced whole-account rebuild), measured read-only on PROD first, with a before/after census, writing nothing a later run cannot reproduce. An operator plan with its own PROD step.
- MARKSOURCE D-09 (founder 2026-10-27, "Measure gate first, then rewrite (Recommended)"): the rewrite waits on the OKX ordering gate; then the 90-day window is rebuilt. Rows older than the window and `allocator_holdings` history are kept and named.
- RESEARCH F1 / ROADMAP SC-3: rows no product path reaches (refresh rows older than the 90-day window, every `allocator_holdings` history row, any scenario-commit audit size) are kept and named under TODOS `167.2.1.1.1.1-OKX-DOUBLE-COUNT-BEYOND-REBUILD-WINDOW`, never hand-corrected.
- ROADMAP SC-1: the Phase 173 reading (`okx-order: ok`, `readings=1 members_with_trades=1 violations=0 passes_ended_full=0 failure_class=none`, `173-03-SUMMARY.md`) is cited by run before any rewrite; any other reading stops the phase.
- ROADMAP SC-2: before/after census from `docs/runbooks/marksource-okx-census/` (counts only, marker query first).
- The procedure is `docs/runbooks/marksource-okx-history-correction.md` (on main): marker first in every session; pre-flight P0-P6 (P4 a write STOP); B'1 target choice by `suspect_days_in_window` above the post-deploy tail, never by predicted outcome; one forced job per account behind the `DO $guard$`; B'3c new-job proof; B'4 wait; B'5 classification rules 1-6 over the 15 `FORCED_REBUILD_REFUSAL_REASONS` tokens (7 re-enqueue once, 8 record-only); B'6 after-census and row diff with rows changed before the seam = 0 or STOP. Deribit counts as $0 in both writers.
- Phase 173 D-04 / SC-3 (founder 2026-10-28, "None now (Recommended)"): 173 enqueued no rebuild; a4 waits on 179, a6 on 180.
- ACCTREBUILD (founder 2026-10-23, "Accept as recorded (Recommended)"): accounts refused `account_key_not_working` keep their stored histories; a rebuild becomes possible once their Bybit key is reconnected. (Narrowed by D-05 below.)
- 172 tolerance (founder 2026-10-28, "Keep 0.05, re-decide later (Recommended)"): re-decided by Phase 179.
- Operator rules: live PROD steps, probes and Railway runs are orchestrator-only on the standing PROD authorization; no executor runs `supabase` with `--linked`; amounts and row sets stay in scratch and are deleted after use; tracked text is counts, tokens and a-labels only.

D-01 Refused keys: measure first, then decide. Founder 2026-10-28: "Measure first, then decide (Recommended)". Option text: "178 runs the runbook's read-only checks and the probe per account, then comes back to you with each account's predicted outcome before any write. No change to the rebuild."

D-02 Ordering gate: also read each target. Founder 2026-10-28: "Also read each target (Recommended)". Option text: "Cite 173's OK as the success criterion says, and also require each target's own ordering reading from the probe before its write."

D-03 Wait for Phase 179. Founder 2026-10-28: "Wait for 179 (Recommended)". Option text: "No target writes until 179's post-deploy re-read and your tolerance decision are done."

D-04 Ownership and timing. Founder 2026-10-28: "178 owns it, after plan 08 (Recommended)". Option text: "MARKSOURCE plan 14 closes as 'follow-up phase: 178'; 178 runs the runbook rewrite. First PROD write only after plan 08's cut-over (tonight 02:22Z) and its first night, after every working OKX key has been polled, never in the 00:00-02:15Z hold."

Context note: the rebuild replaces the whole 90-day window per account, including MT5 legs (census a5 holds working MT5 and Deribit keys), so an account's in-window level can move by more than the OKX open profit. Record the size; do not judge it (runbook B'5 note).

D-05 (SCOPE CHANGE, founder 2026-10-28, verbatim as relayed; the typo is the founder's): "If a bybit Ley is Revoked, then that is only relevant for that Key. It is Not relevant for OKX and its keys, neither for other bybit keys". The whole-account `account_key_not_working` refusal is now a defect to fix in 178 (autonomous code plan, ahead of the operator plans). D-01 measure-first still holds for the PROD rewrite, run on the fixed path. (ROADMAP Phase 178 already carries the same sentence.)

### Claude's Discretion
- How the per-account probe reading and the runbook pre-flight are combined into one read-only operator pass, and whether any runbook or probe change is needed to carry a per-target ordering reading (D-02). Any such code change gets a test that can go RED.

### Deferred Ideas (OUT OF SCOPE)
- Changing the rebuild's key selection so an all-non-working exchange account counts as $0 (not chosen; D-01 keeps the rebuild unchanged). **SUPERSEDED IN PART by D-05** (see "D-05 impact on the deferred idea" below: skipping a non-working group is now in scope; the open question is what a non-working group contributes inside the window).
- Correcting rows beyond the 90-day window or `allocator_holdings` history (kept and named).
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs were provided; the phase-local success criteria are the contract.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | Cite 173's `okx-order: ok` by run before any rewrite; any other reading stops the phase | 173-03-SUMMARY reading and commit are quoted in "SC-1 evidence"; per-target reading rule (D-02) in "Finding 2" |
| SC-2 | 90-day window rebuilt through the forced path, before/after census, counts only, marker first | runbook P0-P6, B'1-B'6 reused; D-05 code fix and four runbook changes needed first ("Finding 1", "Runbook changes") |
| SC-3 | Rows older than the window and `allocator_holdings` history named as kept with counts | census columns `suspect_days_outside_window`, `usdt_row_days_carrying_open_profit` (census of record quoted) |
</phase_requirements>

## Summary

The rewrite cannot run on the code that is deployed today. Four of the five OKX-holding accounts were refused at selection with `account_key_not_working`, and that refusal is raised for a whole account when ANY one exchange-account group of the allocator has no working key (`_select_account_crawl_keys`, one raise site). The founder's D-05 says a dead key matters only to itself. So the first deliverable is an autonomous code plan that makes the selection skip a non-working group (counting it) instead of refusing, with the three pinned tests inverted or replaced and a new test that goes RED on the current whole-account refusal. An allocator whose groups are ALL dead must still refuse `account_key_not_working` (nothing to crawl); that case is already pinned at the probe level and stays green.

The key question from the orchestrator, what a dead key contributes inside the rebuilt window, is answered by the code in one direction and is silent in the other. Both stored-row writers treat a key that stops working as "counted up to the day it stops, $0 afterwards": the daily refresh drops a group with no eligible key the day its last eligible key is revoked or disconnected, and the NAV derive counts a departed key to its end day. A rebuild that skips a dead group therefore matches the stored rows on days AFTER the key stopped. On days BEFORE it stopped (if any fall inside the 90-day window) the stored rows include the dead key's balance, the rebuild cannot read it (the key is revoked) and cannot recover it from the aggregate (a stored row is one aggregate per allocator and day; `breakdown` is keyed by symbol, not by venue), so a skipping rebuild would write a LOWER level than the stored one for those days. Whether any such day exists is a PROD fact not stored in `api_keys` (no revoked-at column). It is measurable read-only from the dead key's own `allocator_holdings` span. So: the code answers consistently for post-stop days; for pre-stop days inside the window it is not answerable in code, and the plan needs a measurement, then a founder checkpoint only if the measurement is non-zero.

Everything else is mostly operator work on the existing runbook. No code change is needed for D-02 (the probe takes the ordering reading on every OKX member it reads, and D-05 makes the four formerly refused accounts readable). Two small read-only SQL forms are needed (a probe-label to census-label crosswalk and a dead-key contribution census), the runbook has one stale count (15 tokens; the code has 16), and the probe record should gain one additive count key. D-03 is a real dependency: main still carries the exact-equality bills close rule (Phase 179's fix is not on main), so any target whose 5x anchor trigger fires will refuse `anchor_skipped_implausible` until 179's fix is deployed and its tolerance is decided.

**Primary recommendation:** Plan 01 (autonomous): selection skips and counts non-working groups, audit and probe carry the count, tests inverted/added with a byte-backup neuter proof. Plan 02 (autonomous, parallel): two new census forms plus runbook corrections and their vitest pins. Plan 03 (operator): deploy confirm, full probe, crosswalk and dead-key census, per-account predicted-outcome table, founder checkpoint (D-01). Plan 04 (operator): gates (SC-1 cite, D-03, D-04 timing), per-target ordering reading (D-02), runbook B'3a-B'6, records. No write before 179's post-deploy re-read and the founder's tolerance decision.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Which exchange accounts a forced rebuild crawls (selection, skip of dead groups) | API / Backend (analytics-service `services/equity_reconstruction.py`) | Database (`api_keys` rows read) | Pure rule over key rows; same grouping and predicates as both allocator writers |
| Replacing the stored 90-day window atomically | Database / Storage (`replace_allocator_equity_snapshots_window`) | API / Backend (worker calls it) | One SECURITY DEFINER transaction, service role only; D-02 refusal `history_days_unreproduced` lives there |
| Per-target ordering reading and predicted outcome | API / Backend (probe script on the backfill worker) | Operator (reads Railway log) | Probe reuses `_select_account_crawl_keys` and `_account_rebuild_window`; read-only client |
| Census, crosswalk and dead-key contribution counts | Database / Storage (read-only SQL via `supabase db query --linked`, orchestrator only) | Operator | Counts only, marker first, in committed census files and runbook forms |
| Forced job enqueue | Database / Storage (`enqueue_compute_job` behind the `DO $guard$`) | Operator | The one write form; job runs on the backfill worker |
| Gates (SC-1, D-03, D-04 timing) | Operator (orchestrator) | Founder | Human-gated; recorded in a SUMMARY with a grep-able verify chain |

## Standard Stack

No new packages. Everything is in-repo code, SQL and the existing runbook; no external library research was needed.

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| `analytics-service/services/equity_reconstruction.py` | main at v0.133.9.0 | forced whole-account rebuild | the only product recompute path (runbook "What this corrects") |
| `analytics-service/scripts/allocator_history_probe.py` | main at v0.133.9.0 | read-only per-account prediction and ordering reading | uses the rebuild's own selection and window |
| `docs/runbooks/marksource-okx-history-correction.md` + `docs/runbooks/marksource-okx-census/` | main | pre-flight, forms, after-census | locked procedure (CONTEXT) |
| pytest (analytics-service) / vitest (root) | repo-pinned | tests | existing gates |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQL crosswalk form for probe-to-census labels | a `census_label` field in each probe record | field needs a second all-OKX-keys read inside the probe plus a validator and test; the SQL form needs neither and is checkable by an independent fingerprint (see Finding 1b) |
| 3-tuple return from `_select_account_crawl_keys` | a separate pure `_count_non_working_groups` | 3-tuple recomputes nothing but changes 9 call sites (7 in one test file, the crawl, the probe); the separate function leaves every signature alone and groups twice |

**Installation:** none. **Package Legitimacy Audit:** no external package is installed or recommended, so no `gsd-tools query package-legitimacy check` was run; the table is empty by design.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | - | - | - | - | - | n/a |

**Packages removed due to [SLOP] verdict:** none. **Packages flagged [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
operator (orchestrator, standing PROD auth, marker first)
   |
   |  read-only SQL (supabase db query --linked, main checkout)
   |    census files + new crosswalk form + new dead-key form -----> counts per census a-label
   |
   |  founder-approved temporary start-command wrapper (173-03 pattern)
   v
backfill worker: python -m scripts.allocator_history_probe  (full probe, no payload)
   |   per allocator: choose_job_key -> _read_account_keys (ALL keys)
   |        -> _select_account_crawl_keys   [D-05 CHANGE: dead group skipped + counted]
   |        -> _account_rebuild_window  (any OKX member => 90 days, 89 days back)
   |        -> per OKX/Bybit member: anchored re-read, raw fills-ordering reading
   |        -> compare rebuilt vs stored (only when every selected member was read)
   v
one JSON line per account + one summary line (counts and tokens) in the Railway log
   |
   v
per-account predicted-outcome table  --->  FOUNDER CHECKPOINT (D-01)
   |                                          (+ dead-key contribution result)
   |  gates: SC-1 cite 173 | D-03 179 deployed + tolerance decided | D-04 clock/hold/P2
   v
runbook B'3a-B'3c: DO $guard$ + enqueue_compute_job(force_rebuild=true), one per account
   v
worker: run_reconstruct_allocator_history_job (forced) -> _crawl_whole_account
   -> replace_allocator_equity_snapshots_window (one transaction; kept older rows + seam)
   v
audit_log classification (B'5) -> after-census + row diff (B'6) -> records (TODOS, ledger)
```

### Recommended Project Structure (files this phase touches)
```
analytics-service/services/equity_reconstruction.py   # _select_account_crawl_keys, _crawl_whole_account, audit metadata
analytics-service/scripts/allocator_history_probe.py  # DEPLOYED_ER_NAMES, ACCOUNT_RECORD_KEYS (+1 additive key), summarize comment
analytics-service/tests/test_reconstruct_whole_account.py
analytics-service/tests/test_allocator_history_probe.py
docs/runbooks/marksource-okx-history-correction.md    # B'1 prediction rule, token count, new pre-flight
docs/runbooks/marksource-okx-census/                  # +1 SQL file (dead-key contribution), README
src/__tests__/marksource-okx-census-sql.test.ts       # EXPECTED_FILES / EXPECTED_FORMS pins
```

### Pattern 1: Group-level skip, all-dead still refuses
**What:** inside the existing loop over `account_groups(account_keys)`, a group (not Deribit, venue supported) with no working member is counted and skipped instead of raising. After the loop, if `selected` is empty and at least one group was skipped as dead, raise `account_key_not_working` (nothing left to crawl). `account_sum_empty` stays for the Deribit-only case.
**When:** forced path only (this function has no other caller).
**Why the all-dead branch matters:** `test_a_selection_refusal_is_a_token_and_that_accounts_keys_are_never_decrypted` (a Bybit-only allocator with its only key revoked) asserts `a1["selection"] == "account_key_not_working"` at `tests/test_allocator_history_probe.py:1757`; keeping the token for the all-dead case keeps that test and the 173 accounting of unread accounts true, and is also the honest answer (the account has no working key at all).

```python
# Source: this repo, services/equity_reconstruction.py:2704-2735 (current), shape of the change only
working = [member for member in group if working_holder_predicate(member)]
if not working:
    non_working_excluded += 1      # D-05: a dead key is relevant to that key only
    continue
...
if not selected:
    raise ForcedRebuildRefusedError(
        "account_key_not_working" if non_working_excluded else "account_sum_empty"
    )
```

### Pattern 2: Operator plan with a verify chain (173-03 shape)
Operator task (`autonomous: false`), preconditions list, `<automated>` grep chain over a SUMMARY, `fails_when`, scratch directory deleted, `worker-restored: yes` before any gate line. Reuse verbatim from `173-03-PLAN.md` Task 1 steps 1-5 (import check, background probe in a temporary start-command wrapper, `railway redeploy --from-source`, restore at once). The import-check line must be updated: it printed `0 16 True True True True`; it gains one `True` for the new record key.

### Anti-Patterns to Avoid
- **Skipping the dead group silently and rebuilding every label:** the first action of the operator plan must be the dead-key contribution census; a target with a non-zero count is not rebuilt until the founder rules (Finding 1c).
- **Treating `account_key_not_working` as gone from the closed set:** it stays in `FORCED_REBUILD_ACCOUNT_REASONS` (pinned at `tests/test_reconstruct_force_rebuild.py:756-809`) for the all-dead case; removing it would break the pin and the probe's vocabulary.
- **Editing `supabase-migrate.yml` or any gate to speed things up:** not relevant here (no migration), listed because the project rule is strict.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Grouping keys into exchange accounts | a new grouping | `account_groups`, `working_holder_predicate` from `services/allocator_equity_derive.py` | both writers use them; a private grouping would diverge |
| Replacing the stored window | any direct `DELETE`/`INSERT` on `allocator_equity_snapshots` | the forced job -> `replace_allocator_equity_snapshots_window` | atomic, advisory-locked, keeps older rows, records the seam; hand SQL is the "hand-computed subtraction" CONTEXT forbids |
| A dead key's pre-stop balance | any subtraction or carry-forward of stored numbers | nothing: keep and name (or founder-ruled option) | not a product path; writes something a later run cannot reproduce (MARKSOURCE D-05) |
| Row diff | ad-hoc spreadsheet | `rowdiff.mjs` in runbook B'6 | already encodes the seam rule (`older_rows_changed` must be 0) |
| Label mapping probe to census | eyeballing counts | crosswalk form (below) with a fingerprint check | the two label orders differ (Finding 1b) |

**Key insight:** every shortcut in this phase is a write to a one-way store on a database whose `current_database()` proves nothing; the existing guards (marker, `DO $guard$`, in-flight check, new-job proof, seam check) are the product, not overhead.

## Finding 1 - D-05 root cause: every site where one non-working key refuses or blocks an account

### 1a. Sites (all read this session)

| # | Site | What it does with a non-working key | Verdict for D-05 |
|---|------|-------------------------------------|------------------|
| S1 | `services/equity_reconstruction.py:2668-2745` `_select_account_crawl_keys` | per group: `working = [member for member in group if working_holder_predicate(member)]`, `if not working: raise ForcedRebuildRefusedError("account_key_not_working")` (lines 2713-2715). The ONLY raise site of the token (grep over `services`, `routers`, `scripts`, `src`, `docs`) | THE DEFECT. Change here |
| S2 | `services/equity_reconstruction.py:6269` `_crawl_whole_account` | calls S1 (`selected, zero_contribution = _select_account_crawl_keys(account_keys, own_key_id)`) before any session is opened; `account_key_ids=frozenset(str(key.get("id")) for key in account_keys)` (6414) keeps ALL keys, so `account_key_count` (audit, line 7029) still equals the census `keys_total` | inherits S1; no change except to carry the new count |
| S3 | `scripts/allocator_history_probe.py:1583` `_probe_account` | `selected, zero_contribution = er._select_account_crawl_keys(account_keys, job_key_id)`; refusal becomes `_account_record(label, run_date, selection=exc.reason)` (1584-1586) | inherits S1; add one additive count key (below) |
| S4 | `scripts/allocator_history_probe.py:1464-1473` `choose_job_key` | earliest working Bybit key, else earliest working OKX key, else earliest active OKX/Bybit key | no defect; with a dead Bybit it already picks the working OKX key. Matches the runbook `enqueue` form's `job_key` CTE (working Bybit else working OKX) |
| S5 | `scripts/allocator_history_probe.py:1704` `summarize` comment | says an account refused at selection "does not shut" the Bybit roll-up because "the rebuild refuses that account at the same selection" | comment becomes stale for D-05 (those accounts no longer refuse); roll-up logic unaffected (counts only accounts with a Bybit member). Update the comment |
| S6 | runbook B'1 prediction rule, line 339: "An exchange account with no working key: `account_key_not_working`." | the operator's prediction | must change to the group rule |
| S7 | `services/allocator_equity_derive.py:361-381` `working_holder_predicate` and `:384-` `account_groups` | the definitions only; they refuse nothing | no change (parity-tested with the TS twin and SQL: `tests/test_derive_allocator_equity_job.py:2143-2182`) |
| S8 | daily refresh `_fetch_latest_holdings_per_eligible_key` (`equity_reconstruction.py:3262-3677`) | already tolerant, see 1c | no change |

`working_holder_predicate` quoted verbatim (`services/allocator_equity_derive.py:379-381`):

```
        key_row.get("is_active") is True
        and key_row.get("disconnected_at") is None
        and (sync_status is None or sync_status not in NOT_WORKING_SYNC_STATUSES)
```
with `NOT_WORKING_SYNC_STATUSES: frozenset[str] = frozenset({"revoked", "sign_in_failed", "error"})` (line 354). [VERIFIED: services/allocator_equity_derive.py:331-381]

`_select_account_crawl_keys` selection loop, verbatim (`services/equity_reconstruction.py:2704-2735`):

```
    selected: list[Mapping[str, Any]] = []
    zero_contribution = 0
    for group in account_groups(account_keys):
        venues = {_key_venue(member) for member in group}
        if len(venues) != 1:
            raise ForcedRebuildRefusedError("account_key_venue_unsupported")
        ...
        working = [member for member in group if working_holder_predicate(member)]
        if not working:
            raise ForcedRebuildRefusedError("account_key_not_working")
```
[VERIFIED: services/equity_reconstruction.py:2668-2745]

Important consequence for the targets: a "group" is an exchange account (a holder plus keys marked `duplicate`/`composite_member` against it). A dead key that is MARKED a duplicate of a working key is already covered (pinned by `test_select_covers_a_departed_key_through_a_working_member`, `tests/test_reconstruct_whole_account.py:155`). A dead key that is UNMARKED is its own group and, today, refuses the whole account. So the refusal can be caused by a dead Bybit key (ACCTREBUILD measured that for 4 accounts, TODOS ACCTREBUILD reading) and equally by a dead unmarked OKX key left over from a credential rotation, or a dead MT5 key. The census of record shows non-working keys on every target account (keys_total minus keys_working: a1 4, a2 3, a4 2, a5 3 as of 2026-10-27). Whether each is a Bybit, an old OKX or something else is unmeasured per label. The D-05 fix must therefore be venue-agnostic (it skips any dead group), which is also what the founder's sentence says ("only relevant for that Key").

### 1b. Tests that pin today's refusal (with the disposition each needs)

| Test | Location | Pins | Disposition |
|------|----------|------|-------------|
| `test_select_refuses_an_exchange_account_with_no_working_key` (5 params: inactive, disconnected, revoked, sign-in-failed, error) | `tests/test_reconstruct_whole_account.py:242` | working Bybit key + one dead Bybit key => `account_key_not_working` | INVERT: expected selection is the working key alone, excluded count 1. Keep the five params. Add an all-dead param set that still expects `account_key_not_working` |
| `test_an_exchange_account_the_rebuild_cannot_read_refuses_before_any_venue_call` (params `("sfox","ok","account_key_venue_unsupported")` and `("bybit","revoked","account_key_not_working")`) | `tests/test_reconstruct_whole_account.py:1482` | job-level refusal with no session opened for the sibling | Keep the sfox param. Move the revoked param to a new job-level test: forced job completes, only the working group's session opens (`calls == [API_KEY_ID_1]` already asserted for refusals), audit carries the excluded count |
| `test_a_selection_refusal_is_a_token_and_that_accounts_keys_are_never_decrypted` | `tests/test_allocator_history_probe.py:1742-1763` | Bybit-only allocator, only key revoked => `a1["selection"] == "account_key_not_working"`, revoked key never decrypted | UNCHANGED: this is the all-dead case and stays green. Add a sibling test: OKX working + Bybit revoked => `selection == "ok"`, the revoked key never decrypted, the new count key == 1 |
| `test_forced_rebuild_refusal_reasons_are_a_closed_set` | `tests/test_reconstruct_force_rebuild.py:756-809` | the 16-token set, `account_key_not_working` in `account` | UNCHANGED (token stays in the set) |
| `test_select_covers_a_departed_key_through_a_working_member`, `test_select_counts_a_deribit_exchange_account_as_zero_whatever_its_state` | `tests/test_reconstruct_whole_account.py:155`, `:180` | marked duplicate covered; Deribit counted as $0 whatever its state | UNCHANGED, but assert the new excluded count stays 0 in both (a covered duplicate and a Deribit group are not "excluded dead groups") |
| `tests/test_reconstruct_whole_account.py:~120` | `er._select_account_crawl_keys(keys, job_key)` unpack sites (lines 120, 144, 150, 166, 190, 201) | 2-tuple unpack | mechanical edit only if the 3-tuple option is chosen |

A new test that goes RED on the current code: working Bybit/OKX key + one dead unmarked key of another account => `selected` is the working key, excluded count 1. On today's code it raises `account_key_not_working`, so it fails. Prove it by the project's neuter rule: copy the file to a byte backup outside the repo, restore the `raise` in place of the skip, run the new tests and see RED, restore from the byte backup (never `git checkout`/`stash`).

Audit and probe plumbing (additive, counts only):
- audit completion metadata (`equity_reconstruction.py:7025-7035`) gains `account_non_working_accounts_excluded` beside `account_zero_contribution_accounts` (pinned today at `tests/test_reconstruct_whole_account.py:675` and `:1538`). B'5 compares it with the prediction.
- probe `ACCOUNT_RECORD_KEYS` (tuple at `allocator_history_probe.py:264`) gains `non_working_accounts_excluded`; `_account_record` default 0; `validate_record` has per-key validators; the 173-03 import check line gains one `True`. 179 already added record keys the same way (`okx_chain_record.chain_defaults()`), so the pattern is established.

### 1b-bis. Label mapping, probe labels to census labels (orchestrator finding 1)

Two orderings, both verified:
- Probe (`allocator_history_probe.py:1766-1800`, `run()`): selects `api_keys` where `exchange IN ("okx","bybit")` and `is_active = True`, `.order("created_at")`, buckets by `user_id` in first-seen order, labels `a1..aN` by that order. `_PROBE_VENUES: tuple[str, ...] = ("okx", "bybit")` (line 173). So the probe label orders allocators by the earliest ACTIVE OKX-or-Bybit key, and includes Bybit-only allocators. [VERIFIED: allocator_history_probe.py:173, 1766-1800]
- Census (`okx-snapshot-census.sql` first CTE, byte-identical in every runbook account form): `row_number() OVER (ORDER BY min(k.created_at), k.user_id)` over `WHERE lower(k.exchange) = 'okx'` grouped by `k.user_id`, i.e. earliest of ALL OKX keys (any status), OKX holders only. [VERIFIED: docs/runbooks/marksource-okx-census/okx-snapshot-census.sql:1-8]

Set-level inference from the recorded readings (not a certainty): the census of record (2026-10-27) lists five OKX allocators, a3 with 1 key and `snapshot_days=0`, a4 with 3 keys and `snapshot_days=0`. The 2026-10-28 probe lists six accounts: four refused, one OKX account that passed (probe a4: one OKX member, 90-day window, no stored rows) and one Bybit-only account (probe a6). The only census account with a single OKX key and no stored rows is census a3, so probe a4 corresponds to census a3 with high likelihood, and the four refused probe accounts are census a1, a2, a4, a5 in some order. **That means census a4 (no stored rows, `snapshot_days=0`) is one of the four refused accounts and has nothing to rewrite; the rewrite targets are census a1, a2 and a5** (the accounts with snapshot history, 248 suspect days, 164 inside the window, per the MARKSOURCE census). [CITED: MARKSOURCE plan 10 SUMMARY, quoted in 178-CONTEXT; census counts above are from that SUMMARY, branch feat/167.2.1.1.1.1-marksource] `[ASSUMED]` for the within-set order.

How a read-only operator step maps them with certainty and without printing ids. Option M1 (recommended): one new runbook SQL form `crosswalk` (read-only, `marker_is_prod` first column, carries the byte-identical `okx_account` CTE, counts only). It computes both labels in one statement: the census label from the CTE and the probe label with the probe's rule, `row_number() OVER (ORDER BY min(created_at))` over allocators that have an active key with `exchange IN ('okx','bybit')` (the `api_keys_exchange_check` constraint pins exchange to lowercase values, so `lower()` is a no-op safety, [VERIFIED: supabase/schema/baseline.sql api_keys table constraints `api_keys_exchange_check`]). Per row it prints the fingerprint the probe will also print: counts of active OKX keys, active Bybit keys, working OKX groups, working Bybit groups, dead-group count (after the fix), plus `snapshot_days`. The operator then proves the mapping with TWO independent matches: the arithmetic identity (the two labels from the same statement) and the fingerprint (`okx_members`, `bybit_members`, `window_days`, `non_working_accounts_excluded`, `zero_contribution_members` in the probe record equal the crosswalk's predicted counts). Residual risk: two allocators whose earliest keys share an identical `created_at` (the probe's tie order is unspecified, the SQL breaks the tie by `user_id`); the fingerprint check catches it because the tied accounts would differ in counts, and if they do not differ the mapping does not matter for those two. The crosswalk MUST be run in the same session as the probe whose labels it maps: a key connected between runs shifts every later label (`[ASSUMED]` no such key is connected between the two steps; the form makes it checkable).
Option M2: add `census_label` to the probe record. Costs a second read of every OKX key (incl. inactive) in the probe, a new validator, a new test and a deploy of the probe before the mapping exists; not needed given M1. Name it for the plan's checkpoint only if the founder wants the label printed by the product.

### 1c. THE KEY QUESTION: what a non-working key contributes inside the rebuilt window

**What the daily refresh does** (`_fetch_latest_holdings_per_eligible_key`, `services/equity_reconstruction.py:3262-3677`; it is the writer of every in-window row, since the census of record shows `days_written_in_bulk_inside_window=0` for a1, a2 and a5):

| State of the group on the day | What the refresh writes | Evidence |
|---|---|---|
| No eligible key (every key revoked, disconnected or inactive) | **excluded, $0** from that day on | `if not eligible:` / `# Every key of this account is revoked or disconnected.` / `continue` ([VERIFIED: services/equity_reconstruction.py:3468-3470]); docstring: "drops out the day its last eligible key is revoked or disconnected" (3277-3282) |
| Eligible but not working (`error`, `sign_in_failed`) | **carried** at its latest holdings day for up to `CARRY_AGE_CAP_DAYS = 7` days ([VERIFIED: equity_reconstruction.py:3192]), then **left out with a count** (`over_age_failing`), never a hold | `_over_age_account_holds` returns True only when a key is WORKING (3769-3777): "a dead key is not (T-11, it would freeze the snapshot store)" |
| Identity-unknown and not working | not carried unless it has rows today (`identity_unknown_not_carried`) | `_identity_unknown_and_not_working`, 3780- |
| Never polled, key failing | left out with a count (`never_polled_failing_accounts`) | docstring "a dead key must not freeze the owner's snapshot store" |

So the refresh's rule for a key that stops working is: counted up to the day it stops (its holdings carry the group), $0 afterwards. The refresh explicitly refuses to let a dead key block anything. The founder's D-05 sentence is the same principle the refresh already follows.

**What the NAV derive does** (`services/job_worker.py:14020-14200` `departed_history_inclusion`): a departed key (one failing `eligible_key_predicate`, i.e. inactive, disconnected or `revoked`) counts "at most until the earlier of its end day and last returns day" where the end day is the UTC day of `disconnected_at` else the last returns day; the owner may set `history_inclusion` to `include` or `exclude`; an unknown-identity departed key is excluded by default ("founder-confirmed 2026-09-25") unless the owner includes it. An eligible-but-failing key (`error`, `sign_in_failed`) is NOT departed: it stays counted, carried flat at return 0, and the curve is flagged `failing_key_series_ended` (blocking `DegradeReason`, `allocator_equity_derive.py:~155-165`, `job_worker.py:15338-15380`). [VERIFIED: job_worker.py:14020-14110, 15330-15380; allocator_equity_derive.py:148-165]

**Answer.** The code is consistent about the shape "a dead key counts through the day it stops and is $0 after": refresh and derive agree on that for `revoked`/disconnected keys, and neither lets a dead key block anything. The code does NOT include a rule of "a dead key is $0 for the whole window" anywhere. What it cannot answer is the rebuild's own need: for window days before the key stopped, the rebuild would have to add the dead key's balance, and it cannot:
1. the key is revoked, so no venue read;
2. a stored row is one aggregate per `(allocator_id, asof)` and `breakdown` is keyed by symbol (`breakdown[sym]`, `equity_reconstruction.py:1855`, `7433-7437`), so the dead key's part cannot be split from the stored number;
3. `api_keys` has no revoked-at column ([VERIFIED: supabase/schema/baseline.sql `api_keys` table: columns include `last_sync_at`, `sync_status`, `sync_started_at`, `sync_error`, `disconnected_at`, no revoked-at]), so the stop day is not stored.

Consequences by case (the case is a PROD measurement, not a code fact):
- **Case A, the key stopped on or before the day before the window's first day (no in-window stored row ever contained it):** skipping it reproduces the stored composition exactly; only the OKX double count changes. The code answers this consistently. No founder question.
- **Case B, the key stopped inside the window:** the days before its stop day contain its balance in the stored rows. A skipping rebuild writes a lower level for those days: not "the OKX double count removed" but "a whole account's balance removed". This is a one-way, silent understatement of history. It is NOT answered by the code and it is a founder question (options below).
- **Case C, the key's group is an `error`/`sign_in_failed` key that is still eligible:** the refresh carried it for up to 7 days past its last holdings day and then dropped it, so the same Case A/B split applies with that 7-day tail.

How to tell A from B read-only (new census file `okx-nonworking-keys.sql`, one statement, same rules as the other census files): per census label, for every key that is not working and not covered by a working marked sibling: venue, `sync_status` class (token), `is_active`/`disconnected_at` flags, first and last `allocator_holdings.asof` of the key (as ages in days, not dates), and `in_window_days_overlapping_dead_key_holdings` = the number of the allocator's non-bulk-written stored in-window snapshot days D with `first_asof - 1 <= D <= last_asof + 7` (a conservative superset of the days the refresh could have counted it; carry 7 from `CARRY_AGE_CAP_DAYS`). Zero for every dead key of a target proves Case A for that target. `[ASSUMED]` that the poll writes `allocator_holdings` rows daily so that the last holdings day approximates the stop day to within a day; the 7-day pad covers the carry. This also needs the bulk-written test already in the census (`count(*) OVER (PARTITION BY allocator_id, reconstructed_at) > 5`); rows written in bulk (first-connect reconstruct) inside the window could contain a Bybit contribution with no holdings behind it, so a non-zero `in_window_days_written_in_bulk` for a target forces a founder look (census of record: 0 for a1, a2, a5; re-measure, readings from earlier sessions are claims).

If the measurement shows Case B for a target, the founder options (do not decide here):

| # | Option | What is written | Cost | Recommendation |
|---|--------|-----------------|------|----------------|
| F-A | Do not rebuild that target (the refusal stays a named, recorded outcome); its stored window is kept and named | nothing | needs a narrow in-code or runbook gate so the skip never writes Case B (see C1/C2 below) | **Recommended for any Case B target** |
| F-B | Rebuild only the days after the dead key's last countable day (shorter `window_start`); older rows kept and the seam recorded; the OKX double count before that day stays and is named | rows from stop day on | `_account_rebuild_window` must accept a later start; the RPC already takes `p_window_start` and records the seam; the OKX replay is anchored on the live balance and runs over whatever span it is given. More code and a new proof of the bound | Only if the founder wants the post-stop days corrected |
| F-C | Skip anyway (Option "whole window $0") | lower in-window level for pre-stop days | understates real history by a whole account balance, not by the open profit | Not recommended: it makes the stored curve disagree with both writers on days they agree with each other |
| F-D | Feed the dead key's stored per-key daily series into the rebuild | new inputs | the key-mode derive stores per-key inputs, but using them in the rebuild is a new product path, not today's recompute | Out of scope; name only |

Where the guard lives (a design choice for the plan, flag to the checkpoint): C1, skip unconditionally in code and make the dead-key census (P7 below) a blocking runbook pre-flight, with B'5 comparing the audit's excluded count to the prediction; C2, also refuse in code when the dead group's last holdings day reaches the window. C1 is smaller and fits the founder's wording and D-01's operator-measured model (3 target accounts, one-off); C2 is the only guard the operator cannot forget but couples the product to the refresh's carry internals. **Recommend C1** and say so at the checkpoint; the all-dead refusal remains in code either way.

### D-05 impact on the deferred idea and on earlier readings
- The 2026-10-23 ACCTREBUILD "Accept as recorded" is narrowed for `account_key_not_working` (the ROADMAP Phase 178 entry already records this). The TODOS ACCTREBUILD entry should get a dated line. [VERIFIED: ROADMAP.md Phase 178 section; TODOS.md ACCTREBUILD reading `account_key_not_working` 4, "each account's only Bybit key is revoked at the venue"]
- 173's `bybit-transfers-unread:` set (a1, a2, a3, a5 "refused at selection") describes the old selection; after the fix those four are read (except any that are all-dead). No effect on 173's gate verdicts (they were recorded) but a future probe's unread line changes meaning; update the `summarize` comment (S5).
- **No target has a working Bybit key** (census of record: `bybit_working=0` for a1-a5), so Phase 180's Bybit transfer-depth gate is irrelevant to the 178 targets. [CITED: MARKSOURCE plan 10 SUMMARY feasibility rows]

## Finding 2 - D-02, per-target ordering readings (orchestrator finding 2)

- A selection-refused account never reads trades, so the probe has no ordering reading for it (the four refused records show `okx_members: 0`, `okx_order_readings: 0`; [VERIFIED: 173-03-SUMMARY probe lines]). Phase 173 D-01 already made the ordering read run on an anchor-refused OKX member (a4: `member_refusal=anchor_skipped_implausible`, `okx_order_readings: 1`, `okx_members_with_trades: 1`, `okx_order_violations: 0`).
- With the D-05 fix those four accounts pass selection, the OKX member is read like any other, and its ordering reading is taken by the existing code. **No probe code change is needed for D-02.** The change D-05 makes moot the "selection-refusal arm" option. Only if a target is still refused at selection for another reason (`account_identity_pending`, `account_key_venue_unsupported`, all-dead `account_key_not_working`) does it lack a reading; then it is not a rebuild target either (the forced job would refuse at the same selection), so nothing is lost.
- The per-target rule for the operator verify chain (per account record, not the summary gate): `selection` is `ok`, `okx_members_with_trades >= 1`, `okx_order_readings == okx_members_with_trades`, `okx_order_violations == 0`, `okx_passes_ended_full == 0`, `okx_order_failure_class == none`. `[VERIFIED: allocator_history_probe.py okx_order_verdict at :876 and record fields]` The summary's `okx_order_gate` is global: it can read `ok` while one target has no reading, which is exactly what D-02 closes.
- Edge to put in front of the checkpoint (not a code issue): an OKX target with no OKX trades in its 90-day window has `okx_members_with_trades == 0`, so no reading is possible. Options: treat "no trades, ordering moot" as satisfied by founder acceptance, or do not rebuild that target. `[ASSUMED]` that this case is rare for accounts that carry open positions (open positions imply fills, but not necessarily fills inside the window).
- The probe runs every account (no filter), including the Bybit-only account (a6, 203467 trades in 1050 s on 2026-10-28), so a full run takes about 20 minutes plus the OKX reads. Plan the wrapper and the clock window accordingly (outside 23:30-00:30 UTC, ended before 23:30).

## Finding 3 - D-03, will the bills-opening check fire on the targets? (orchestrator finding 3)

- The forced OKX path asks the bills archive only behind the 5x trigger. Verbatim (`services/equity_reconstruction.py:4288-4290`): 
```
        _implausible_anchor = (
            last_value > 0
            and abs(offset) > 5.0 * abs(last_value)
```
with `offset = anchor - last_value`, `last_value` the replay's last row and `anchor` today's live equity. The check `_okx_forced_opening_check` (4016-4090) returns `"not-run"` unless `require_anchor` and venue is OKX, and anything but `"agreed"` makes the caller refuse `anchor_skipped_implausible` and write nothing (4349-4364, 4389). [VERIFIED: equity_reconstruction.py:4016-4110, 4255-4400]
- The 90-day window replays from zero cash (the replay's starting quantities are empty in the window; money deposited before it is not seen), so `last_value` is the net in-window result while `anchor` is the whole live equity. For an account funded before the window, `offset` dwarfs 5x `last_value` and the trigger fires: this is exactly a4's shape (`money_before_window`, TODOS ANCHOR-IMPLAUSIBLE). The census of record shows OKX holdings since 2026-04-22 (a1), 2026-04-24 (a2) and 2026-08-25 (a5), all before the window's first day, so the trigger is **likely** to fire for all three targets. `[ASSUMED]`: it is a property of live balances and in-window P&L; the post-fix probe's per-target `opening_check`/`member_refusal` fields are the measurement (the probe already runs the anchor diagnostic on such members).
- What 179 changed (v0.133.9.0, #1147, on main): a DIAGNOSTIC only: `services/okx_bills_chain.py`, `scripts/okx_chain_record.py` and nine additive probe keys; `okx_opening_balance.py` gained 9 lines and `equity_reconstruction.py` and the forced path are unchanged. [VERIFIED: `git show --stat 3b065928f`, 11 files, `okx_opening_balance.py | 9 +`]. The oracle's close rule on main is still exact equality: `services/okx_opening_balance.py:315` and `:318` raise `chain_break`; there is no `close_agrees` or `CLOSE_RESIDUAL_REL_BOUND` on main ([VERIFIED: grep this session, no match). The fix the founder chose for a4 (D-06/D-07: close passes within 1e-12 of the larger balance) exists only on Phase 179's branch (verification `human_needed`, SC-3 operator plan 179-05 pending, tolerance `OPENING_TOLERANCE_REL = 0.05` kept). [CITED: 179-CONTEXT D-06/D-07, 179-VERIFICATION]
- Therefore a write before 179 ships and its post-deploy probe re-read would refuse every target whose bills close differs from `cashBal` by any dust (the a4 mechanism), and a tolerance re-decision by the founder changes what "agreed" means for the targets. D-03 is a hard ordering constraint, not a courtesy. The 178 operator plan must contain a precondition that names it and a verify that the deployed worker contains 179's fix (e.g. `git grep -n -F 'close_agrees' <deployed sha> -- analytics-service/services/okx_opening_balance.py` prints a hit), plus 179-05's recorded founder tolerance decision.

## Finding 4 - D-04, plan 14 preconditions and what 178 owns (orchestrator finding 4)

Plan 14 (MARKSOURCE, `autonomous: false`) has three tasks: (1) pre-flight P0-P6 plus B'1-B'2, (2) a founder decision (option-a rebuild now, option-b defer to a booked follow-up phase, option-c rewrite nothing), (3) the rebuild and record. Its preconditions: the phase PR merged with main CI green (merged as #1141, v0.133.6.0, [VERIFIED: git log of the runbook]); the worker carrying the poll fix deployed with its deploy time known; plan 08's Step B (cut-over) run and its first night read; UTC time late in the day, not within 30 minutes of 00:00Z, outside every merge hold. [CITED: MARKSOURCE 14-PLAN.md, branch feat/167.2.1.1.1.1-marksource]

Plan 08's runbook (`docs/runbooks/marksource-legacy-chain-move-go-live.md`, on main) moves the poll and refresh crons next to the 00:10Z mark read; the candidate was poll `0 1 * * *`, refresh `30 1 * * *`, with the merge hold ending 45 minutes after the refresh slot (02:15Z for that candidate, lines 175-178 and the "Cut-over timing" section). CONTEXT D-04 gives the cut-over as 2026-10-29 02:22Z. The actual slots are chosen by the founder at Step B and recorded in plan 08's SUMMARY, which does not exist yet; the operator must read the live `cron.job` slots at the time rather than trust "02:15Z". `[ASSUMED]` the hold end stays 02:15Z.

Which part is 178's: plan 14 closes via its option-b path (records only): one `follow-up phase: 178` line in its record log, one dated line each under MARKSOURCE CONTEXT D-05 and the ROADMAP MARKSOURCE entry (both, never one), and the follow-up phase existing in the ROADMAP before the plan closes, all in a records PR. That is MARKSOURCE bookkeeping, not a 178 plan task, but 178 depends on it being true in the ledgers; today the ledgers show no such line (`grep` of ROADMAP and TODOS for `follow-up phase: 178` finds none). **Flag to the orchestrator: ensure the MARKSOURCE plan 14 records PR lands, or 178's SUMMARY will cite a closure that is not on main.** 178 owns: running the runbook (P0-P6, B'1-B'6) on the targets under D-01..D-05, the TODOS reading under `167.2.1.1.1.1-OKX-DOUBLE-COUNT-BEYOND-REBUILD-WINDOW`, and the narrowing note on ACCTREBUILD.

D-04 preconditions the 178 operator plan must verify, each as a recorded answer (runbook items in brackets):
1. marker names PRODUCTION [P0].
2. worker SHAs contain the forward fix, the rebuild code AND 178's D-05 fix and 179's fix [P1, extended with two `git grep` checks].
3. every working OKX key was polled by the fixed worker [P2 `pollafter`] (the daily poll moved with plan 08; wait for it, never enqueue a poll).
4. window-replace function present, service role only [P3 `rebuildfn`].
5. TRADEPAGES gates read from TODOS on main [P4]: `167.2.1.1.2.1-OKX-ORDER-UNMEASURED` is CLOSED 2026-10-28 (heading ends with `CLOSED 2026-10-28)`, [VERIFIED: TODOS.md:13292]); `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE` is still open (heading at TODOS.md:13282 carries no CLOSED), and it names the one OKX account that refuses `anchor_skipped_implausible` (census a3 per Finding 1b, no stored rows, not a 178 target).
6. no job in flight [P5].
7. clock: not within 30 minutes of 00:00Z [P6] and not in the 00:00-02:15Z hold (D-04).
8. NEW P7: dead-key contribution census, zero for every target or a founder ruling (Finding 1c).
9. SC-1 cite and D-03 evidence recorded.

## Finding 5 - Validation Architecture (orchestrator finding 5)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service, Python 3.14.3 on this machine) and vitest (root) |
| Config file | `analytics-service/pyproject.toml` (mypy); root `vitest.config.ts` |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_reconstruct_whole_account.py tests/test_allocator_history_probe.py tests/test_reconstruct_force_rebuild.py -q` |
| Full suite command | `cd analytics-service && python3 -m pytest -q` (CI runs it with coverage, floor 80) and `npx vitest run src/__tests__/marksource-okx-census-sql.test.ts` |
| mypy (CI line, verbatim) | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (run from `analytics-service/`) |

Measured this session on main (v0.133.9.0): `tests/test_reconstruct_whole_account.py -k select` 17 passed (6 s); `tests/test_allocator_history_probe.py` 126 passed (5.7 s); the closed-set pin 1 passed. Note: `scripts/` is NOT on the CI mypy line, so the probe's typing is not gated there; `services/equity_reconstruction.py` IS (strict). Every analytics-touching brief must carry the mypy line (project memory "Agent gates include mypy").

### Phase Requirements to Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| D-05 | working group + dead group => selected = working, excluded 1 | unit | `pytest tests/test_reconstruct_whole_account.py -k "select" -x` | invert existing (W0) |
| D-05 | all groups dead => `account_key_not_working` | unit | same | add (W0) |
| D-05 | forced job with dead sibling completes DONE, only working session opens, audit carries excluded count | integration (fake) | `pytest tests/test_reconstruct_whole_account.py -k "dead or not_working" -x` | add (W0) |
| D-05 | probe: OKX working + Bybit revoked => `selection ok`, new key == 1, revoked key never decrypted | unit | `pytest tests/test_allocator_history_probe.py -k "revoked or not_working" -x` | add (W0) |
| D-05 | closed set unchanged (16) | unit | `pytest tests/test_reconstruct_force_rebuild.py -k closed_set -x` | exists |
| SC-2 tooling | new census file and forms pass the census guard (one statement, no `--`, no write word, no uuid, README names it) | vitest | `npx vitest run src/__tests__/marksource-okx-census-sql.test.ts` | extend `EXPECTED_FILES`, `EXPECTED_FORMS`, `FORMS_WITH_ACCOUNT_CTE` (W0) |
| SC-2 tooling | runbook names every refusal token in code | vitest | same file | add: parse the token sets from `equity_reconstruction.py` and assert each appears in the runbook (RED today for `account_key_read_stalled`) (W0) |
| SC-1/SC-2/SC-3 | operator SUMMARY lines | grep chain `<automated>` in the operator plan | per 173-03 pattern | per plan |

### Sampling Rate
- **Per task commit:** the quick run command above (about 20 s).
- **Per wave merge:** analytics full pytest plus the mypy line plus the census vitest file.
- **Phase gate:** full suites green, then the operator plans' verify chains; PROD steps are not testable offline.

### Wave 0 Gaps
- [ ] `node_modules` is absent in this worktree (`ls node_modules` fails): `npm ci` is needed before the vitest file runs here. No new package is installed.
- [ ] Invert/replace the pins listed in Finding 1b and add the RED-capable new tests; prove RED by a byte-backup neuter of the skip (restore from the byte backup, never `git checkout`).
- [ ] Extend the census vitest file for the new SQL file, the two new runbook forms and the token-parity test.
- [ ] A test that the runbook's B'1 prediction text names the group rule (grep for the new sentence), so the stale "An exchange account with no working key" line cannot return.

## Runbook changes needed (autonomous plan 02)

1. **B'1 prediction (runbook line 339):** replace "An exchange account with no working key: `account_key_not_working`" with the group rule: a group with no working member is skipped and counted; the token is predicted only when EVERY group is dead.
2. **Token count (runbook lines 602-613):** the text says "15 tokens" with 7 re-enqueue-once and 8 record-only; the code set has 16 (`account_key_read_stalled` was added by Phase 171 and is in neither list). [VERIFIED: runbook:602-613 vs `FORCED_REBUILD_ANCHOR_REASONS` 6 + `FORCED_REBUILD_ACCOUNT_REASONS` 10 = 16, `tests/test_reconstruct_force_rebuild.py:809`] 173-03 already tripped on the same drift. Per the code comment, `account_key_read_stalled` belongs with the re-enqueue-once tokens ("the handoff lists it with the re-enqueue-once tokens", equity_reconstruction.py near the 16th-token comment). Pin it with the parity test above.
3. **New pre-flight P7** and two new forms/files: the `crosswalk` form and the dead-key census file (Finding 1b-bis, 1c).
4. **B'5 additions:** compare the audit's `account_non_working_accounts_excluded` with P7's predicted dead-group count per label; a mismatch is a recorded STOP-and-ask (rule 6 style). `account_key_count` equals `keys_total` is unchanged (all keys are counted).
5. Update the Where-this-stands paragraph (D-09 now satisfied: ordering gate closed 2026-10-28).

## Common Pitfalls

### Pitfall 1: The skip writes a lower level for pre-stop days
**What goes wrong:** a target whose dead key stopped inside the window is rebuilt and the stored curve drops by a whole account balance on early days.
**Why it happens:** the stored row is an aggregate; the dead key's part is unreadable and unseparable.
**How to avoid:** P7 dead-key census before any enqueue; zero or founder-ruled; row diff reads `in_window_changed` and `max_rel` beside the double-count estimate and a large early-window move is read against P7.
**Warning signs:** `max_rel` far above the census `max_overcount_share` (a1 0.0488, a5 0.00997, a2 0.516 on one day), or a level step on one early day.

### Pitfall 2: Probe label read as census label
**What goes wrong:** the founder is told "a2 will refuse" about the wrong account.
**How to avoid:** the crosswalk form and the fingerprint match, run in the same session as the probe.

### Pitfall 3: A write inside the 00:00-02:15Z hold or near midnight
**What goes wrong:** the refresh (first-writer-wins) and the rebuild's "today" live-read row race; a job crossing 00:00Z refuses `anchor_skipped_okx_terminus`.
**How to avoid:** P6 plus D-04's hold; read the live cron slots.

### Pitfall 4: Rebuilding before 179
**What goes wrong:** every target refuses `anchor_skipped_implausible` (or, worse, 179's tolerance re-decision changes which targets pass after the fact).
**How to avoid:** D-03 precondition with the `git grep` evidence and 179-05's recorded decision.

### Pitfall 5: Counting a covered duplicate or a Deribit group as an "excluded dead group"
**How to avoid:** the new count is only for groups with no working member that are neither Deribit (zero-contribution, existing counter) nor covered by a working marked sibling (they never form a dead group); tests assert 0 for both.

### Pitfall 6: Restating mutable figures
The project rule: cite ledgers and census by symbol or run, regenerate rather than trust. The 2026-10-27 census numbers in this file are a record, not an input (the runbook says the same).

## Code Examples

### Crosswalk form (shape; the plan writes the real one and the vitest pins)
```sql
-- Source: shape only, built from the census file CTE (okx-snapshot-census.sql) and the probe's rule
-- (allocator_history_probe.py run(): active okx/bybit keys, ordered by created_at, first-seen per user)
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
okx_account AS (
  SELECT k.user_id AS allocator_id,
         row_number() OVER (ORDER BY min(k.created_at), k.user_id) AS label_no
    FROM public.api_keys k
   WHERE lower(k.exchange) = 'okx'
   GROUP BY k.user_id
),
probe_account AS (
  SELECT k.user_id AS allocator_id,
         row_number() OVER (ORDER BY min(k.created_at), k.user_id) AS probe_no
    FROM public.api_keys k
   WHERE lower(k.exchange) IN ('okx', 'bybit') AND k.is_active
   GROUP BY k.user_id
)
SELECT m.marker_is_prod, 'a' || a.label_no AS census_label, 'a' || p.probe_no AS probe_label
  FROM m CROSS JOIN okx_account a LEFT JOIN probe_account p ON p.allocator_id = a.allocator_id
 ORDER BY a.label_no;
```
(The real form adds the fingerprint counts. The shipped `-- Source` comment must be dropped: the census guard forbids `--` in SQL forms.)

### Operator verify chain for D-02 (per target, shape)
```bash
# one line per target label, from the pasted probe records; every field is a probe record field
jq -e '.selection=="ok" and .okx_members_with_trades>=1 and .okx_order_readings==.okx_members_with_trades
       and .okx_order_violations==0 and .okx_passes_ended_full==0 and .okx_order_failure_class=="none"' target.json
```
(Plan 173-03 used grep chains rather than `jq`; follow that pattern if `jq` is not guaranteed.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Whole-account refusal on any dead group | group-level skip, all-dead still refuses | this phase (D-05) | four accounts become readable; a Case B target must be measured |
| 15-token runbook vocabulary | 16 tokens | Phase 171 (2026-10-27) | runbook rule 3 mislabels `account_key_read_stalled` |
| Exact-equality bills close | trillionth-bound close | Phase 179 D-06/D-07 (branch only) | determines whether targets with money before the window can anchor |

**Deprecated/outdated:** the 2026-10-23 "a rebuild becomes possible once their Bybit key is reconnected" premise (ACCTREBUILD close) for the accounts whose only blocker is a dead key.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| python3 / pytest / mypy | tests and typing | yes | 3.14.3 / `/opt/homebrew/bin` | - |
| node | renderer, vitest | yes | v25.8.1 | - |
| `node_modules` in this worktree | vitest census file | no | - | `npm ci` (no new package) |
| Supabase CLI link to PROD (main checkout only) | operator SQL | orchestrator only, not probed here | - | none; never from this worktree, never by an executor |
| Railway CLI/MCP | probe wrapper | orchestrator only | - | none; `railway ssh` is broken, use the wrapper |

**Missing dependencies with no fallback:** none for the code plans. The operator plans need the founder's approval for the Railway probe run (179 D-01 precedent; 173-03 used "Yes, after deploy (Recommended)").

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json` (key absent => enabled).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication / V3 Session | no | no new surface |
| V4 Access Control | yes | `replace_allocator_equity_snapshots_window` is service-role only (P3 verifies `anon_execute` false, `authenticated_execute` false); the probe's `ReadOnlySupabase` exposes `select` only |
| V5 Input Validation | yes | renderer validators for labels and instants; `emit_record` validates every probe record (out-of-vocabulary tokens refused) |
| V6 Cryptography | no | credentials stay encrypted; the probe decrypts only selected keys, and a skipped dead key is never decrypted (test it) |
| V7/V8 Logging, data protection | yes | tracked text is counts, tokens and a-labels only; amounts and row sets in scratch, deleted after; no uuid/home path |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Write sent to TEST or an unnamed database | Spoofing/Tampering | marker query first, `DO $guard$` RAISE, verify chains require the PRODUCTION verdict |
| Two forced jobs racing one window | Tampering | in-flight check, `created_at >= MS_T0` skip in `enqueue`, new-job proof; never a second job per account in one attempt |
| One-way understated history (Case B) | Tampering/Repudiation | P7 census, row diff `max_rel` read against it, founder ruling |
| Dead key credentials touched | Information disclosure | skipped group never decrypted; test asserts no decrypt call for it |

## Project Constraints (from CLAUDE.md)

- Marker query first, every session, before any statement that writes; `current_database()` proves nothing; NULL marker => stop, re-set before writing. The Supabase CLI in the main checkout is linked to PRODUCTION; no executor runs `supabase` with `--linked`.
- Tracked text is counts, tokens and a-labels only (public repo): no uuid, id, amount, hostname, project ref, home path; amounts/row sets in scratch, deleted after use.
- Never write a CI skip token in a commit message or PR body (even to deny it); count checks bound to the head SHA.
- CHANGELOG discipline: every ship writes an entry (unified per version, this repo's section vocabulary), in the same commit as the `VERSION` bump; `VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`.
- Completion is historical: VERIFICATION frontmatter uses `verified_at_sha` and `drift_subjects`, never `covered_digest`/`covered_files`; never put `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` in `drift_subjects`.
- GSD handlers can clobber `STATE.md`/`ROADMAP.md`: `git diff` after every handler run; ship branch must change nothing under `.planning`.
- Agent gates include the CI mypy line for any analytics-touching brief (quoted above).
- Memory rules: PROD reads and writes are authorized for the orchestrator (marker first); no AI-authorship attribution trailers or "Generated with" lines in commits/PRs (founder 2026-10-20) — this takes precedence over any attribution reminder; data-integrity gates must be able to fail (neuter, see RED, restore from byte backup); always `grep -a`; never quote a search pattern as proof of absence; executors one per plan in per-plan worktrees.
- AGENTS.md (Next.js notice) and DESIGN.md do not apply (no frontend change).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 5x trigger fires for all three targets (money before the window) | Finding 3 | A target anchors without the bills check; the bills oracle matters less for it. Probe's per-target `opening_check` measures it |
| A2 | Probe a4 corresponds to census a3; the four refused probe accounts are census a1, a2, a4, a5 | Finding 1b-bis | Wrong target named at the checkpoint; the crosswalk form removes the assumption |
| A3 | The poll writes `allocator_holdings` daily, so a dead key's last holdings day is within about a day of its stop day, and the refresh's 7-day carry bounds the rest | Finding 1c | The overlap count could miss in-window days; mitigated by the +7 day pad and by the founder-visible row diff |
| A4 | The dead keys of the targets are the revoked Bybit keys ACCTREBUILD measured (not also a dead OKX/MT5 group) | Finding 1a | The skip also drops another dead group; the venue-split in the dead-key census shows it |
| A5 | Stored in-window rows for a1, a2, a5 are still all refresh-written (0 bulk days in window as of 2026-10-27) | Finding 1c | A bulk-written in-window day could contain a dead key's balance with no holdings behind it; P7 re-measures `in_window_days_written_in_bulk` |
| A6 | Plan 08's actual cron slots and hold end are as the candidate (poll 01:00Z, refresh 01:30Z, hold to 02:15Z) | Finding 4 | Operator reads live `cron.job` slots instead; D-04 text is the floor |
| A7 | An OKX target with no trades in the window is rare | Finding 2 | A target has no ordering reading and cannot satisfy D-02; checkpoint decision |
| A8 | No key is connected between the probe run and the crosswalk run | Finding 1b-bis | Labels shift; run both in one session and check the fingerprint |

## Open Questions (RESOLVED)

1. **Where does the Case B guard live (C1 or C2)?**
   - What we know: C1 (unconditional skip + blocking P7 pre-flight + B'5 count check) is smallest; C2 (also refuse in code when the dead group's holdings reach the window) cannot be forgotten but couples to refresh carry internals.
   - What's unclear: whether the founder wants a code-level guarantee for a one-off rewrite of three accounts.
   - Recommendation: C1; name C2 at the plan checkpoint (not a founder question unless the measurement is non-zero).
2. **Founder question, only if P7 is non-zero for a target:** F-A (do not rebuild it, keep and name), F-B (shorter window after the dead key's last day), F-C (skip anyway, not recommended). Recommendation F-A.
3. **Does the founder want the probe to print the census label (M2)?** Recommendation no; M1 suffices.
4. **A target with `okx_members_with_trades == 0`:** accept "ordering moot" or exclude the target. Recommendation exclude unless the founder rules otherwise.
5. **Plan 14 closure PR:** who lands MARKSOURCE's option-b records (orchestrator bookkeeping), and before 178's SUMMARY cites it.

## Expected plan shape (for the planner)

Any code change at all? **Yes, one: D-05**, and only because the founder ruled it a defect; evidence: the single raise site (S1), the four recorded refusals, and the tests that pin it (Finding 1b). D-02 needs no code. D-03 needs none (it is a dependency). Probe change is one additive count key. Runbook and census changes are documentation/SQL with vitest pins.

| Plan | Type | Wave | Content |
|------|------|------|---------|
| 01 | autonomous | 1 | D-05 selection skip + all-dead refusal, third return value or helper, audit key, probe key + comment, tests inverted/added, byte-backup neuter proof, mypy line |
| 02 | autonomous | 1 | `crosswalk` form, `okx-nonworking-keys.sql`, README, runbook corrections (rule text, 16 tokens, P7, B'5), vitest pins incl. token parity |
| 03 | operator (`autonomous: false`) | 2 | after ship + deploy: import check, full probe via wrapper (founder approval), crosswalk and dead-key census, per-account predicted-outcome table, D-02 per-target readings, founder checkpoint (D-01, and Case B ruling if any) |
| 04 | operator | 3 | gates (SC-1 cite by run, D-03 evidence, D-04 timing, P0-P7), B'3a-B'6 for the ruled labels, SC-3 counts, records (TODOS reading, ACCTREBUILD narrowing, ledgers) |

Ship note: plan 01 and 02 ship as one PR with a CHANGELOG entry and VERSION bump (CLAUDE.md); the ship branch changes nothing under `.planning`. Plans 03/04 need the merge deployed (Railway deploys only after main CI is green; a skipped deploy is the founder's to recover).

SC-1 evidence to cite, by run: `173-03-SUMMARY.md`, deployed commit 17bfd004c6907cb2cbc8d7aa232314fdcca3541c (PR #1143, v0.133.7.0), lines `okx-order: ok` and `okx-order-reading: readings=1 members_with_trades=1 violations=0 passes_ended_full=0 failure_class=none`, `sc1-met: yes`, verified in this session by reading the file. [VERIFIED: 173-03-SUMMARY.md "OKX ordering gate (SC-1)"] The cite satisfies the ROADMAP wording; D-02 adds the per-target reading on top of it.

## Sources

### Primary (HIGH confidence, read this session)
- `analytics-service/services/equity_reconstruction.py` (selection 2668-2745; window 2748-2775; refresh holdings 3262-3677; 5x trigger and opening check 4016-4110, 4255-4400; crawl 6080-6420; audit 6990-7040)
- `analytics-service/services/allocator_equity_derive.py` (331-550), `analytics-service/services/job_worker.py` (departed history 14010-14200, failing key 15330-15380)
- `analytics-service/scripts/allocator_history_probe.py` (labels and selection 1464-1800, vocabulary 236-330, summarize)
- `analytics-service/services/okx_opening_balance.py` (chain_break sites 315, 318; no `close_agrees` on main)
- `docs/runbooks/marksource-okx-history-correction.md`, `docs/runbooks/marksource-okx-census/*` (full), `docs/runbooks/marksource-legacy-chain-move-go-live.md` (timing sections)
- `src/__tests__/marksource-okx-census-sql.test.ts` (guards), `analytics-service/tests/test_reconstruct_whole_account.py`, `test_allocator_history_probe.py`, `test_reconstruct_force_rebuild.py`
- `.planning/phases/173-*/173-03-SUMMARY.md`, `173-03-PLAN.md` (operator pattern), `178-CONTEXT.md`, ROADMAP Phases 178-180, TODOS entries named in the brief
- `supabase/schema/baseline.sql` (`api_keys`, `allocator_equity_snapshots` columns and checks)

### Secondary (MEDIUM confidence)
- MARKSOURCE records from the sibling worktree on branch feat/167.2.1.1.1.1-marksource (plan 10 SUMMARY census of record, plan 14 PLAN) and Phase 179 records on branch feat/179-okxbillschain (CONTEXT, VERIFICATION): read-only, branch state at 2026-10-28.

### Tertiary (LOW confidence)
- none beyond the `[ASSUMED]` items in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no external dependency; in-repo code read)
- Architecture: HIGH for the code path and the two writers' dead-key behaviour; MEDIUM for PROD composition (unmeasured)
- Pitfalls: HIGH for the code-derived ones (1, 4, 5), MEDIUM for clock/hold (3)

**Research date:** 2026-10-28
**Valid until:** 2026-11-04 (7 days: Phase 179 and plan 08 move main and the cron slots; re-read the deployed SHAs and live cron slots at execution)

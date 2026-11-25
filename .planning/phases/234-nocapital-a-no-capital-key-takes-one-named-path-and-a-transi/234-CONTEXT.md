# Phase 234: NOCAPITAL — a no-capital key takes one named path, and a transient read never drops a funded key - Context

**Gathered:** 2026-11-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Requirements: NOCAP-01, NOCAP-02, NOCAP-03, NOCAP-04, plus the out-of-window case added to this phase by the founder ruling below. Python only, no migration. Allocator book path (seam S2, owned here), not composite work.

TODOS entries this phase closes (delete them in the ship PR and name them in the CHANGELOG): `[166.3.1-NOCAP-MT5-A2-CIRCULAR]` (NOCAP-01), `[166.3.1-NOCAP-NONNAV-EXCEPTIONS]` (NOCAP-02), `[166.3.1-NOCAP-FALLBACK-TRACE]` (NOCAP-03), `[166.3.1-NOCAP-SEGMENT-REASON-RESIDUE]` (NOCAP-04).

In scope (all in seam S2):
- `analytics-service/services/job_worker.py` `run_derive_allocator_equity_job`: the no-capital candidate selection (the A2 gate), the candidate apply loop (`_no_capital_exit_consumes_only_dust`, `_no_capital_level_on_last_return_day`), the `no_capital_stored` revert, and the compose call.
- `analytics-service/services/allocator_equity_compose.py` `compose_allocator_equity`: the candidate fall-back inside the compose (`fell_back`) and the interior-hole segment loop that adds `key_inputs_mismatch`.
- `analytics-service/services/allocator_equity_derive.py` `replay_key_equity`: the `out_of_window_flows` count.

Out of scope:
- The derive writer (`run_derive_broker_dailies_job`, seam S1), including the MT5 balance read itself.
- Any TS reader or UI change. The new payload fields are counts in the stored payload; no surface renders them in this phase.
- Any migration. If one appears, stop and tell the coordinator before opening a PR.
- 155.2 freeze: NOCAP-01 touches an MT5 key, so 234 merges before 155.2 plan 12's recapture or after plan 14, never in between. Measured 2026-11-24: `155.2-12-SUMMARY.md` is absent from origin/main (155.2 run day is 2026-12-01). Re-check at push time.

</domain>

<decisions>
## Implementation Decisions

### Founder ruling carried into this phase (2026-11-24, on 233 DERIBITTRUTH's Q2, "233 does not touch S2")
- Recorded verbatim in `233-CONTEXT.md` and in the ROADMAP 234 entry on 233's branch (commit `5ce61e219`, not yet on origin/main when this context was written): "`_reconstruct_key_equity` in `allocator_equity_derive.py` counts a flow as `out_of_window_flow` when it is dated on a left-out tail day that the derive stated (`key_inputs.tiny_base_days`) after the key's last stored return. That flow belongs to a stated day, not to a day outside the window. 234 owns the fix as part of S2. Evidence: `.planning/debug/deribit-stale-returns.md`. For the one account seen, the flag clears by itself once a return is stored after the flow (2026-11-26)."
- Measured at HEAD: no function named `_reconstruct_key_equity` exists. The count lives in `replay_key_equity` (`out_of_window_flows = sum(1 for fd in fbd if fd < lo or fd > hi) - len(opening_run)`). The ruling is applied there.
- The compose does not read `tiny_base_days` today. It is in the stored `key_inputs` payload (written by the key-mode derive), so the fix threads it from the key_inputs reader through the compose into `replay_key_equity`.
- Scope of the fix is exactly the ruling: a flow dated after the key's last stored return day, on a day listed in that key's stored `tiny_base_days`, is not counted as out of window. A flow before the first return day, or after the last return day on a day not stated, keeps counting. No other gate moves.

### NOCAP-01: a funded MT5 key is never exited on a transient zero
- Prior decision that settles the product behaviour: 166.3.1 A2 (comment at the candidate selection in `run_derive_allocator_equity_job`): "A live read that says empty over a funded terminal is a transient zero or a mis-priced balance until proven otherwise: the key keeps today's `dropped_key` rather than exiting while the book reads trustworthy." And D-02: no reconciliation gate is weakened by an exit. So a candidate that cannot be confirmed falls back to `dropped_key` (the book reads untrustworthy, the key is not written off as no-capital). This is how "keeps its capital" (SC-1) and "never dropped as no-capital while it is funded" (NOCAP-01) are read.
- The defect: for MT5 the stored realized terminal IS the live balance, so A2 (stored terminal at or below `DUST_NAV_FLOOR`) does not independently confirm the live read.
- The fix: the no-capital exit requires proof not derived from the live read. For a venue whose stored terminal is the live read (MT5 today; the researcher enumerates every venue where this holds), the proof is the key's own stored ledger: on a full-history venue (`FULL_HISTORY_VENUES` holds `mt5`), the level the stored flows and stored day P&L reach from inception must also be at or below `DUST_NAV_FLOOR`. The exact formula, and whether the writer's stored day P&L for MT5 is really independent of the balance read, is for research to establish from the code, not to assume. Where no independent proof exists, the candidate is refused (falls back to `dropped_key`) and the refusal is named (NOCAP-03).
- A stored terminal below `-DUST_NAV_FLOOR` (negative equity) is not an exit: refused and named (`nonpositive` with negative equity records its sign through the refusal reason, per the TODOS "done when").
- ⛔ **Gate, measured 2026-11-24 on PROD (read-only, marker first):** two `equity_curve` rows carry an MT5 entry in `no_capital_exited_keys` today, both reason `nonpositive`, exit day 2026-10-09, stored terminal 0.00 on 2026-10-09, with a flow on that same day (15 flows each). Both books are already `is_trustworthy=false` for other reasons. Research must measure, read-only, whether these two keys pass the new independent-proof check. If either would flip from exited to `dropped_key`, that changes what a user sees and goes to the founder as a question before execution. If both pass, no user-visible change is expected and execution proceeds. **MEASURED 2026-11-24 (PROD via MCP, read-only, marker first, the research file's gate SQL):** both exits are `venue=mt5, reason=nonpositive, native_unit_key=false`, both carry a writer basis, outcome `pass` for both (`n_exits=2`, stored terminal 0.0, ledger level Σ composed_flows + Σ composed_day_pnl = -1.6e-11, gap to terminal 1.6e-11). The gate is cleared: the new proof keeps both exits, so no user-visible change is expected.

### NOCAP-02: any exception from a candidate leaves the previous row intact
- While at least one no-capital candidate is in play, any `Exception` (not only `NavReconstructionError`) raised by the candidate apply loop or by the compose reverts once to the inputs exactly as stored (`no_capital_stored`, every candidate back to `dropped_key`), with the exception class logged (counts and class only, no key id, day or USD). If the stored-input compose raises too, the failure is not the rule's and today's path runs unchanged (a `NavReconstructionError` takes `_compose_refused`; anything else propagates as it does today).
- `BaseException` subclasses that are not `Exception` (cancellation, interpreter exit) are never caught.
- The test raises an exception that is not a `NavReconstructionError` (for example a `KeyError` or `ValueError` from a candidate's inputs) and asserts the stored row is the no-candidate result, across a retry.

### NOCAP-03: every fallback to `dropped_key` is named and counted in the payload
- One benign, counts-only payload field marks every no-capital fallback in the run, named by reason. Working name from the TODOS entry: `no_capital_exit_refused`. It carries a per-reason count over a closed reason set; no key id, venue id, day or USD (the T-167.1.2-22 / T-166.3.1-34 convention).
- The closed reason set covers every route a no-capital key takes to `dropped_key`: the A2 funded-terminal refusal at selection, the NOCAP-01 unconfirmed-terminal refusal, the negative-terminal refusal, the D-10 consumes-more-than-dust refusal, the in-compose fall-back (replay refused, blocking reason, missing segment terminals), the job-level revert after a compose refusal, and the NOCAP-02 exception revert. Exact token spellings are the planner's.
- It is benign: it never enters `degrade_reasons` and never changes `is_trustworthy` (`dropped_key` already blocks). A run with no fallback writes no such field, so a healthy payload is unchanged.
- It must also reach a refusal record written after a fallback (for example `compose_empty_blocked`), or the planner records why that path cannot carry it.

### NOCAP-04: a refused candidate leaves no residue reason
- A refused candidate leaves the stored payload equal to the payload the same inputs would produce with no candidate offered, except for the NOCAP-03 field. The two requirements conflict on a literal "byte-equal" reading (the TODOS entry's "done when"); NOCAP-03 is the more recent and the more specific requirement, so it wins and the exception is stated in the test.
- The named residue: a candidate whose interior hole lacks its stored segment terminals adds `key_inputs_mismatch` in the compose's segment loop and keeps it after falling back. A candidate in that state falls back without adding the reason.
- The test builds both payloads (candidate offered and refused, and no candidate) and asserts equality after removing only the NOCAP-03 field.

### PROOF-01
- Each gate above goes RED on pre-fix code or a neutered copy with its named arm first, is restored from a byte backup (`cp` back, `cmp`), and goes GREEN, recorded verbatim in the plan SUMMARY.

### Decided autonomously
- [Shape] Q: "Where does the NOCAP-03 field live in the payload?" → Selected: "Beside the existing counts-only fields (`payload['inputs']` or `payload['flags']`, the planner picks the one the existing no-capital names use)" — Python-only payload field with no TS reader, so moving it is a one-file change.
- [Shape] Q: "How does the compose report its in-compose fall-backs to the job for the count?" → Selected: "The compose writes its own reasons into the field; the job adds the reasons only it can see" — internal function contract, no persisted schema.
- [Out-of-window] Q: "How is `tiny_base_days` passed to the replay?" → Selected: "A new optional keyword argument on `replay_key_equity`, defaulting to none, so every existing caller is unchanged" — internal signature, cheap to undo.
- [Tests] Q: "Where do the tests live?" → Selected: "The existing suites `analytics-service/tests/test_allocator_equity_no_capital_exit.py` and `test_derive_allocator_equity_job.py`, plus the replay tests for the out-of-window case" — test layout, no product effect.
- [Plans] Q: "How many plans?" → Selected: "Planner's call; one PR (Python only, one seam)" — planning layout only.

- [Post-research] Q: "Is Deribit gated by the ledger proof?" → Selected: "No. Its terminal is reconciled to inception at write time (RESEARCH venue table); only mt5 is in the proof set" — a one-member venue set, cheap to widen.
- [Post-research] Q: "Lower side of the ledger check?" → Selected: "Only the locked 'at or below DUST_NAV_FLOOR'; a ledger level far below zero is already refused by the replay's zero-start and non-positive checks" — one comparison, cheap to change.
  ⛔ **CORRECTED 2026-11-25 (code review round 1, CR-01 + silent-failure M3) — the decision above is kept as lineage and is overturned.** Its premise is false: the zero-start check runs only when a flow sits on the day before the first return day, and rolling back from a 0.0 terminal through a withdrawal gives positive levels, so the non-positive check never fires. The reviewer reproduced an MT5 key with no deposit, a -20,000 (and -500,000) withdrawal and a 0.0 terminal exiting with `is_trustworthy=True`. The band is now two-sided: the ledger confirms emptiness only when `-DUST_NAV_FLOOR <= level <= DUST_NAV_FLOOR`. A level below `-DUST_NAV_FLOOR` is refused under its own closed token `ledger_level_negative`. An empty writer basis (`composed_day_pnl: []`) is no proof and is refused as `ledger_basis_absent` (CR review WR-01). The CONTEXT NOCAP-01 founder gate was re-measured against the two-sided predicate (PROD via MCP, read-only, marker first, 2026-11-25): both live MT5 exits still pass (level -1.6e-11, 198 day-P&L rows each), so no user-visible change and no founder question. Known limit: a missing deposit whose other deals net to about zero still passes.
- [Review round 1, 2026-11-25] IN-02 (a working `nonpositive` key with a `key_inputs` row and no return rows takes `dropped_key` uncounted): excluded from the NOCAP-03 closed set by design. A key with no stored return day never reaches no-capital candidate selection (it requires `api_key_id in last_return_day`), so it is not a no-capital fallback. It is the existing `no_anchor` + `missing_series` route.
- [Review round 1, 2026-11-25] Silent-failure M2: `_compose_refused` now carries `no_capital_exit_refused` when the run counted a fallback, so a candidate revert followed by a refused stored-input compose still records its counts. This narrows plan 01's table row for `_compose_refused`. Control flow is unchanged, and with no fallback the record is unchanged.
- [Post-research] Q: "Is a no-capital key with no stored terminal counted as a fallback?" → Selected: "Yes, as its own reason in the closed set, since it takes dropped_key today" — a counts-only token.
- [Post-research] Q: "Strict or tolerant tiny_base_days reader?" → Selected: "Strict, matching every existing key_inputs read_* helper (Rule 11); a malformed list takes the existing corrupt-input path. An absent list is not an error and reads as no stated days" — reader policy in one helper.
- [Post-research] Q: "Do departed keys read tiny_base_days?" → Selected: "Yes, the counted and departed branches both read it; stitch sources do not" — one call site each.
- [Post-research] Q: "Proposed new refusal tokens?" → Selected: "No new DegradeReason or DeriveRefusal member; the reasons live only inside the counts-only field" — avoids moving the three-runtime closed-set pins.

### Claude's Discretion
- The exact formula for the MT5 independent proof, within the constraint above, once research has read the MT5 writer.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `_AllocatorKeyInputs` and `no_capital_stored` in `job_worker.py`: the stored-input snapshot the revert already uses.
- `_no_capital_exit_consumes_only_dust` and `_no_capital_level_on_last_return_day`: pure helpers over stored numbers; the NOCAP-01 proof belongs beside them.
- `_NO_CAPITAL_ANCHOR_REASONS` (`equity_reconstruction.py`) = {`dust`, `nonpositive`}.
- `DUST_NAV_FLOOR` (`services/nav_twr.py`).
- `FULL_HISTORY_VENUES` (`allocator_equity_derive.py`) = {`deribit`, `mt5`}.
- Compose fall-back block (`fell_back`, `fell_back_refused`, `fell_back_blocking`) in `allocator_equity_compose.py`.

### Established Patterns
- Counts-only payload fields beside a benign flag (`no_capital_key_exited` + `no_capital_exited_keys`, `departed_writer_basis_unchecked_keys`, `writer_basis_missing_members`). A healthy payload carries none of them.
- Logs carry counts and classes only, never key ids, days or USD.
- Every reason is a member of a closed set; an unknown stored string is never echoed.

### Integration Points
- `compose_allocator_equity(..., no_capital_exit_by_key=...)` and its key_inputs reader (`allocator_equity_compose.py`, where `segment_terminals` is parsed) — `tiny_base_days` is read there.
- `replay_key_equity` is called from the compose loop and from tests.

</code_context>

<specifics>
## Specific Ideas

- Evidence for the out-of-window case: 233's `.planning/debug/deribit-stale-returns.md` (on 233's branch): three Deribit books carry `out_of_window_flow` because a 2026-11-09 flow sits on a stated tiny-base tail day past the last stored return (2026-10-26).
- PROD reading 2026-11-24 (above, NOCAP-01 gate): 2 MT5 no-capital exits live, both `nonpositive`, exit 2026-10-09.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

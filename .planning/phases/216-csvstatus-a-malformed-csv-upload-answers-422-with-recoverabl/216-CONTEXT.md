# Phase 216: CSVSTATUS — a malformed CSV upload answers 422 and the wizard stops offering Retry - Context

**Gathered:** 2026-11-17
**Status:** Ready for planning

<domain>
## Phase Boundary

The synchronous rejection gate in `analytics-service/routers/process_key.py` (the `_scope_rejected = (` block in the synchronous pipeline) answers a CSV validator verdict with **422 and `recoverable: false`** instead of today's 424 and `recoverable: true`. Auth and scope rejections stay 403 `recoverable: false`, and venue codes stay 424 `recoverable: true`. The Phase 215 per-arm pins in `analytics-service/tests/test_process_key_scope_rejection_statuses.py` are updated on purpose to the new literals, as that file's docstring asks.

Source of the decision (quoted, not paraphrased): ROADMAP `### Phase 216` — "A malformed CSV upload answers 422 with `recoverable: false`, so the wizard stops offering Retry for a file that will fail again. Auth and scope rejections stay 403, and venue blips stay 424." 215-CONTEXT — "FOUNDER DECISION 2026-11-15: Option A, 'Pin today, book fix'. … The pin's comment names the follow-up fix (a malformed CSV should not be told a retry can succeed)."

### Measured at HEAD 33264affe (premise check, load-bearing for verification)
- **No live caller reaches the CSV arm of this gate today.** The four `postProcessKey` callers are `csv-validate` (sends `step: "validate"` with no `strategy_id`, so it returns from `_run_validate_only` at 200 `ok:false` before the gate), `finalize-wizard` (`onboard`, enqueued before the synchronous pipeline), `verify-strategy` (`teaser`, exchange source) and `keys/sync` (`resync`, enqueued). The dormant `keys/validate-and-encrypt` handler sends `onboard` + `step: "validate"`. CSV finalize goes to the `finalize_csv_strategy_with_returns` RPC directly (Phase 145), not to `/process-key`.
- **The CSV wizard does not read the Python body's `recoverable` today.** `CsvUploadStep` renders a 200 `ok:false` verdict through `CsvValidationEnvelope` (no Retry wiring keyed on the body), and its seam-envelope branch builds `recoverable` client-side from the code.
- **Consequence:** the deliverable is the `/process-key` public error contract. The ROADMAP's "the wizard stops offering Retry" clause has no live wizard surface at HEAD. The verifier must not claim a wizard-visible change; the SUMMARY and the ship CHANGELOG say this plainly.
- TS forwards the upstream status and body verbatim (`process-key-client.ts` branches on `body.ok`, never on status), and 4xx never records on the breaker (`resilient-fetch.ts`), so 424 → 422 is breaker-inert and needs no TS routing change.
- `analytics-service/docs/STATUS_CONTRACT.md` §1 puts 422 in the CALLER class with `recoverable: false`, which is the class a malformed upload belongs to.

</domain>

<decisions>
## Implementation Decisions

### Status contract (founder, ROADMAP Phase 216 + 215-CONTEXT Option A)
- A CSV validator verdict at the `_scope_rejected` gate answers **422** with **`recoverable: false`**. The five permanent codes (`AUTH_FAILED`, `PERMISSION_DENIED`, `TRADE_SCOPE`, `WITHDRAW_SCOPE`, `MISSING_SCOPE`) and our own `VALIDATION_UNEXPECTED` fallback stay **403** `recoverable: false`. Every other (venue) code stays **424** `recoverable: true`. — **Reversibility:** costly — public `/process-key` error contract (215-CONTEXT's own rating).

### Which CSV codes count as "a file that will fail again"
- Every code the CSV adapter (`services/ingestion/csv_adapter.py`) emits for a deterministic input fault answers 422 `recoverable: false`: the upper-cased rule family (`first_rule.upper()`, open-ended, including argument-carrying forms such as `COERCE_DTYPE('DATETIME64[NS]')`), `CSV_VALIDATION_FAILED`, `CSV_TOO_LARGE` and `CSV_FORMAT_UNSUPPORTED`. An identical retry of the same bytes and the same `fmt` fails identically for all of them, which is the founder's stated test. — **Reversibility:** costly — public `/process-key` error contract; decided by applying the founder's principle, flagged to the coordinator in the phase report.
- `CSV_UPSTREAM_FAIL` stays **424** `recoverable: true`. It is the adapter's internal-fault code (an exception inside `validate_csv`, copy "CSV validation failed. Please retry."), so a retry can succeed and it is not a malformed file. — **Reversibility:** costly — public contract; this is today's behaviour, kept.

### The validate-only arm is out of scope
- `_run_validate_only` keeps answering 200 `ok:false` with its body exactly as today. The 215 pin calls it out of the founder's stated scope, and moving it off 200 would push real per-row verdicts into `CsvUploadStep`'s `!res.ok` branch, where a rule code is not in `KNOWN_CSV_VALIDATE_CODES` and would render as `CSV_UPSTREAM_FAIL`. The existing 215 pin `test_validate_only_invalid_answers_200_ok_false` stays green unchanged. — **Reversibility:** costly — it is the live CSV upload contract the wizard renders.

### Decided autonomously
- [Gate shape] Q: "How does the gate recognise a CSV validator verdict?" → Selected: "A positive test on the request's source (`body.source == 'csv'`) with a non-null adapter `error_code` that is not `CSV_UPSTREAM_FAIL`, evaluated after the draft-transition RPC and BEFORE the PYAPIFIX-02 424 pre-gate; never by adding codes to `exchange_svc.PERMANENT_VALIDATION_ERROR_CODES` (shared with `long_fetch.py` and `_envelope_error`, pinned to exactly five, and the rule family is open-ended)" — one local condition in one function.
- [Gate shape] Q: "Is `recoverable` derived or stated on the new arm?" → Selected: "Stated: `recoverable=False` passed explicitly to `_envelope_error`, because the derivation returns True for these codes" — one keyword argument.
- [Gate shape] Q: "What else does the new arm keep?" → Selected: "The same envelope as the 403/424 arms (`_reject_code`, `val.human_message`, `source_debug_context=val.debug_context` so `pandera_errors` still forwards), the same `write_capable_key_rejected` log line and the same best-effort draft transition before it; a structlog line naming the CSV arm is allowed" — mirrors the neighbouring arms.
- [Pins] Q: "How are the Phase 215 pins updated?" → Selected: "In place, on purpose: the CSV case is renamed and asserts 422 / `recoverable` false with literals; new literal cases pin `CSV_TOO_LARGE` and `CSV_FORMAT_UNSUPPORTED` at 422 false, `CSV_UPSTREAM_FAIL` at 424 true, and a non-CSV source carrying a CSV-looking code (for example `MONOTONIC_DATES` on the teaser flow) at 424 true, which proves the discriminator is the source and not the code string; the module docstring is rewritten to describe the new contract and drop the follow-up note; the permanent-set and validate-only pins stay unchanged" — test-file edits only.
- [Pins] Q: "How do we prove the pins can fail?" → Selected: "Neuter the new arm (byte backup of the router), see the CSV cases go RED, restore from the backup; record it in SUMMARY" — repo testing rule for contract gates.
- [Comments] Q: "Which stale comments move with the code?" → Selected: "Only comments that state the CSV arm's status: the 403 arm's comment in `process_key.py` that lists 'a malformed CSV' among 403 faults, and the `process-key-client.ts` docblock lines that describe ordinary validation failures as 403 / the 403-vs-422 split as homeless; no other edits" — comments only.
- [Censuses] Q: "Which other censuses must be checked?" → Selected: "Grep for any other test or doc pinning the CSV arm at 424 or 403 (`test_csv_rule_family_oracle.py`, `src/__tests__/contracts/REGISTRY.md`, `wizardErrors` invariants, `STATUS_CONTRACT.md` §8 'How to add a new error site') and update only what states this arm's status" — read-and-update, no new mechanism.

### Claude's Discretion
None.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `_envelope_error(code, msg, cid, vid, recoverable=None, source_debug_context=None)` in `routers/process_key.py` builds the DESIGN-05 envelope and projects `pandera_errors`.
- `tests/test_process_key_scope_rejection_statuses.py` already has `_csv_post` and `_teaser_post` helpers driving the gate with a mocked adapter.
- `tests/app_factory.build_test_app` (Phase 215) installs the production exception handlers.

### Established Patterns
- STATUS_CONTRACT classes: 403/422 CALLER (`recoverable` false), 424 CALLER'S EXCHANGE (`recoverable` true), all breaker-inert.
- Allow-list-of-permanent, default-transient shape for venue codes (PYAPIFIX-02) — unchanged for non-CSV sources.

### Integration Points
- `routers/process_key.py`, the synchronous pipeline's `_scope_rejected` block (cite by symbol, not line).
- `src/lib/process-key-client.ts` forwards status and body verbatim; no TS behaviour change.

</code_context>

<specifics>
## Specific Ideas

Run pytest from `analytics-service/` and mypy strict as CI does before pushing.

Research was skipped (2026-11-17). The phase researcher stalled for about 2 h without writing 216-RESEARCH.md and the coordinator stopped it. Plan-phase took the workflow's skip-research path, because the scouting above already covers what the planner needs: the gate code, the census targets and live-caller reachability. There is no RESEARCH.md and no VALIDATION.md. The validation mapping lives in the plan.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

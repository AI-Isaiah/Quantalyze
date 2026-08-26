---
phase: 163-harden-fail-safe-closed-and-loud
plan: 01
subsystem: infra
tags: [structlog, logging, redaction, secrets, python, pytest, ast-gate, ccxt, mt5]

requires: []
provides:
  - "Worker process (`python -m main_worker`) configures the redacting log chain at module scope — unconditional redaction on the process that runs ccxt ingestion and MT5 sync"
  - "API process (`main.py`) configures logging above every first-party import — ordering is now gated, not accidental"
  - "AST source-scan gate: a module-scope `.bind()` on a get_logger() result anywhere in non-test analytics-service code fails pytest"
  - "AST ordering gate: configure_logging() must precede the first first-party import in both entrypoints"
  - "Behavioral redaction proof through the REAL processor chain (subprocess + captured streams), with a shipped negative control"
  - "Fix for a live fail-quiet in the stdlib redact bridge: scrubbing a %-format template ate conversion specifiers and silently DROPPED log records at 3 call sites"
affects: [163-02, 163-03, analytics-service logging, worker observability, Sentry breadcrumbs]

actuals:
  tokens: 11600
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Subprocess-isolated behavioral logging tests (never structlog.testing.capture_logs, which replaces the chain and makes the assertion unfalsifiable)"
    - "AST ordering gate: compare the lineno of a module-scope call against the lineno of the first first-party import"
    - "Shipped negative control alongside a redaction assertion, so the gate is falsifiable without a manual neuter"

key-files:
  created:
    - analytics-service/tests/test_structlog_frozen_proxy.py
  modified:
    - analytics-service/main_worker.py
    - analytics-service/main.py
    - analytics-service/services/logging_config.py
    - analytics-service/services/mt5_client.py
    - analytics-service/tests/test_stdlib_redact_bridge.py

key-decisions:
  - "configure_logging() goes at MODULE scope in main_worker.py, not inside main(): `python -m main_worker` runs the module top-down, so a first-party module that logs at import time would emit before any main()-time call could run."
  - "MEASURED CORRECTION to the phase research: Mode B is a pre-configure WINDOW, not a permanent freeze. structlog's DEFAULT config carries cache_logger_on_first_use=False, so a plain module-scope get_logger() proxy re-reads _CONFIG and self-heals after configure. Only a module-scope `.bind()` RESULT is permanently frozen. The worker's window was the entire process lifetime, which is strictly worse than the freeze the research described."
  - "Mode A gate has NO allowlist. A module-scope bind is never safe — the subprocess demo shows the value leaking verbatim after configure_logging()."
  - "The redact bridge must never delete a log line to redact it. When scrubbing a %-template breaks its formatting, keep the ORIGINAL template; the values (record.args) are scrubbed on their own path and a template is developer-authored constant text."

patterns-established:
  - "Anti-vacuity floor + anchor set: a corpus-size floor alone does not prove a walk covers the code that matters, so the walk must also be asserted to reach a named set of modules."
  - "Gate tokens counted PRE-EDIT: the Mode A expected count (0 binds across 111 non-test modules) was measured against the base commit before any file was touched."

requirements-completed: [OPS-05]

coverage:
  - id: D1
    description: "The worker process emits every structlog and stdlib log line through the redacting chain — a denylisted value logged there renders as [REDACTED], not plaintext"
    requirement: "OPS-05"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_structlog_frozen_proxy.py::TestModeBWorkerEntrypoint::test_worker_entrypoint_installs_the_structlog_redactor"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_structlog_frozen_proxy.py::TestModeBWorkerEntrypoint::test_worker_entrypoint_installs_the_stdlib_logrecord_bridge"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_structlog_frozen_proxy.py::TestModeBNegativeControl::test_breaking_the_scrubber_lets_the_canary_through"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both entrypoints configure logging BEFORE any first-party import can emit"
    requirement: "OPS-05"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_structlog_frozen_proxy.py::TestEntrypointOrdering::test_entrypoint_configures_logging_before_any_first_party_import"
        status: pass
    human_judgment: false
  - id: D3
    description: "A module-scope .bind() on a get_logger() result anywhere in non-test analytics-service code fails pytest"
    requirement: "OPS-05"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_structlog_frozen_proxy.py::TestModeAModuleScopeBind::test_no_module_scope_bind_in_non_test_code"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_structlog_frozen_proxy.py::TestModeAModuleScopeBind::test_the_walk_is_not_vacuous"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_structlog_frozen_proxy.py::TestModeAModuleScopeBind::test_a_module_scope_bind_leaks_even_after_configure"
        status: pass
    human_judgment: false
  - id: D4
    description: "The redact bridge cannot delete a log line: a denylist-shaped literal in a %-format template no longer drops the record"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_stdlib_redact_bridge.py::test_scrub_never_drops_a_record_by_eating_a_format_placeholder"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_stdlib_redact_bridge.py::test_scrub_still_redacts_a_template_when_placeholders_survive"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_compute_jobs_fencing.py::TestDispatchTickThreadsClaimToken"
        status: pass
    human_judgment: false

duration: 50min
completed: 2026-08-26
status: complete
---

# Phase 163 Plan 01: Harden fail safe, closed, and loud — OPS-05 structlog redaction Summary

**The worker process that runs ccxt ingestion and MT5 sync was emitting every log line through structlog's unredacted default chain and never installed the stdlib LogRecord bridge at all; both entrypoints now configure redaction before any of our code can emit, two AST gates hold the ordering and the module-scope-`.bind()` shape, and a live fail-quiet found in the redact bridge itself — it was DELETING the log lines it could not redact — is closed.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-08-26T12:05Z (approx)
- **Completed:** 2026-08-26T12:54Z
- **Tasks:** 2 of 2
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- **Closed the secret-exposure path on the standalone worker entrypoint.**
  ⚠️ CORRECTED 2026-08-26 (review WR-08): this said "the LIVE ... path on the worker". Production does
  not run `main_worker.py` as a separate service — the worker is merged into the API process
  (`main.py:297` logs "merged into API"). The fix is real and preventive, and the standalone path is
  still reachable, but calling it a live production leak overstated it. The apparent source of the
  overstatement was a stale Sprint-3 Dockerfile header, now corrected. `main_worker.py` carried ZERO references to `configure_logging` or `structlog` at the base commit. It now calls `configure_logging()` at module scope, above every first-party import. Under the neuter demo the unfixed worker printed `api_key=QZ-OPS05-CANARY-…` in plaintext AND `ccxt failure: https://…&signature=QZ-OPS05-CANARY-…` — the exact HMAC disclosure the LogRecord factory exists to stop.
- **Removed the API process's reliance on luck.** `main.py` configured logging *below* its `from routers import …` line; it was safe only because no router happened to log at import time. The call is hoisted, and an AST ordering gate now fails if either entrypoint sinks it again.
- **Shipped the Mode A source-scan gate with no allowlist**, plus a subprocess demo proving a module-scope `.bind()` leaks verbatim even after `configure_logging()` — so the gate is a security control, not a style rule.
- **Found and fixed a fail-quiet inside the redaction machinery itself** (Rule 1 deviation, detail below): the scrubber was corrupting `%`-format templates and causing stdlib logging to silently DROP records at 3 measured call sites, two of which run in production today.
- **Every gate demonstrated RED under a named mutation**, with the mutation and the observed direction recorded in each test's own docstring.

## Task Commits

1. **Task 1 (tracer): Configure logging at BOTH entrypoints — the live worker leak first (Mode B)** — `ead12f9fb` (fix)
2. **Task 2: Mode A source-scan gate — module-scope `.bind()` is a pytest failure** — `291e4ba80` (test)
3. **Deviation (Rule 1): the redact bridge was DELETING log lines** — `21c232837` (fix)

_Task 2 is test-only: the gated condition (zero violations) already held, so a separate GREEN implementation commit would have been empty. The RED gate is mutation M3 below, not a committed failing state. Recorded under TDD Gate Compliance._

## Files Created/Modified

- `analytics-service/tests/test_structlog_frozen_proxy.py` — **created.** 9 tests: the pre-configure leak control, two worker-entrypoint behavioral assertions, a shipped negative control, the parameterized AST ordering gate, and the three Mode A tests (vacuity floor + anchor set, the gate, the leak mechanism demo).
- `analytics-service/main_worker.py` — `configure_logging()` at module scope above the first-party imports, with the rationale for module scope over `main()`.
- `analytics-service/main.py` — logging config block hoisted above the router imports.
- `analytics-service/services/logging_config.py` — `_scrub_record_in_place` no longer corrupts `%`-format templates.
- `analytics-service/services/mt5_client.py` — `_stage_logger()` docstring: the stale claim quoted and refuted, with the measured mechanism correction.
- `analytics-service/tests/test_stdlib_redact_bridge.py` — two regression tests for the dropped-record class.

## Decisions Made

1. **`configure_logging()` at MODULE scope in `main_worker.py`, not inside `main()`.** `python -m main_worker` executes the module top-down before `main()` exists; a first-party module that logs at import time would emit before any `main()`-time call could run. The plan allowed either; module scope is strictly earlier and is what the ordering gate can assert statically.

2. **Mode B is a WINDOW, not a permanent freeze — measured, and the research corrected in place.** The research and the old `_stage_logger` docstring both claimed `cache_logger_on_first_use=True` freezes a module-scope proxy at first use forever. Measured against the installed structlog: the DEFAULT config in force before `configure_logging()` runs carries `cache_logger_on_first_use=False`, so `BoundLoggerLazyProxy.bind` never installs its `finalized_bind` closure and a plain proxy re-reads `_CONFIG` on every use — it self-heals. What IS permanently frozen is a module-scope `.bind()` RESULT. Both facts are demonstrated by shipped tests rather than asserted in prose. This makes the worker finding *worse*, not milder: the leak window there was the entire process lifetime.

3. **The ordering invariant is enforced by AST, not by a behavioral test of `main.py`.** Importing `main.py` in a probe would construct the FastAPI app and run `init_sentry()`; the ordering is a source-level fact and an AST gate states it precisely and cheaply. The worker — the live leak — gets the full behavioral treatment.

4. **The Mode A gate has no allowlist, by construction.** `test_a_module_scope_bind_leaks_even_after_configure` demonstrates there is no safe way to hold one of these objects.

5. **Anti-vacuity floor set at 90 non-test modules (111 measured), plus a required anchor set.** A count alone does not prove the walk reached `main.py`, `main_worker.py`, `services/logging_config.py`, `services/mt5_client.py` and `routers/exchange.py`; the anchor assertion does.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The stdlib redact bridge was silently DELETING log records**

- **Found during:** Task 1 verification — the full pytest run went red at `tests/test_compute_jobs_fencing.py::TestDispatchTickThreadsClaimToken` (3 failed) after wiring `configure_logging()` into the worker.
- **Issue:** `_scrub_record_in_place` scrubbed `record.msg` unconditionally. `record.msg` with args is a `%`-format TEMPLATE, and `scrub_freeform_string` rewrites the substring `claim_token=%s,` to `claim_token: [REDACTED]` — `token` is a denylist alternate and the match consumes the `%s` and the comma with it. The template loses a conversion specifier, `record.getMessage()` raises `TypeError: not all arguments converted during string formatting`, stdlib logging catches it in `Handler.handleError`, and **the record is dropped**. Production output is a `--- Logging error ---` block on stderr and nothing else.
- **Blast radius, measured** (AST scan of all 111 non-test modules in the service): 3 live templates, all worker/compute diagnostics ops silently never received —
  - `analytics-service/main_worker.py:580` — the `LATE_MARK_IGNORED` fencing warning
  - `analytics-service/services/equity_reconstruction.py:1611` — done-reconstruct lookup failure
  - `analytics-service/services/job_worker.py:1389` — `_emit_audit` "audit row dropped" notice
- **Pre-existing, not introduced here.** The compute loops run inside the API process (`main.py` lifespan), which has called `configure_logging()` since Phase 16 — so the first two have been dropped in PRODUCTION. Task 1 would have extended the same silence to the standalone worker.
- **Fix:** keep the scrubbed template ONLY if it still formats against `record.args`; otherwise keep the original. Nothing leaks: `record.args` (the values — the only venue/user-controlled part) is scrubbed on its own path, while a template is developer-authored constant text. The probe runs only when the scrub actually changed the string, so the backfill hot path pays nothing.
- **Files modified:** `analytics-service/services/logging_config.py`, `analytics-service/tests/test_stdlib_redact_bridge.py`
- **Verification:** two new regression tests (the line survives with all four args intact; the revert stays narrow so a placeholder-safe scrub is still applied and the secret still redacted), plus `tests/test_compute_jobs_fencing.py` back to 16 passed / 28 skipped, plus RED demo M4.
- **Committed in:** `21c232837`
- **Note:** this is a fail-QUIET inside the very machinery this phase is hardening — a redaction pass that deletes the lines it cannot redact. It is the OPS-05 theme applied to OPS-05's own implementation, which is why it was fixed rather than deferred.

**2. [Rule 2 - Missing critical functionality] The plan's `<threat_model>` T-163-03 (test vacuity) needed more than a manual neuter**

- **Found during:** Task 1 test design.
- **Issue:** a manual neuter proves a gate *was* able to fail once; it does not keep it falsifiable.
- **Fix:** shipped a permanent negative control (`TestModeBNegativeControl`) that runs the same entrypoint through the same harness with only the scrubber disabled and asserts the canary SURVIVES — so the redaction assertion's load-bearingness is re-proven on every CI run, not just on the day it was written. Same for Mode A via `test_a_module_scope_bind_leaks_even_after_configure`.
- **Committed in:** `ead12f9fb`, `291e4ba80`

---

**Total deviations:** 2 auto-fixed (1× Rule 1 bug, 1× Rule 2 missing critical functionality)
**Impact on plan:** No scope creep. The Rule 1 fix was mandatory — the plan's own change surfaced it, and leaving it would have shipped a worker that drops its fencing diagnostics. The Rule 2 addition is within the plan's stated anti-vacuity requirement.

## Anti-Vacuity Record — every gate observed RED

| ID | Mutation | Observed |
|----|----------|----------|
| M1 | Commented out `configure_logging()` at module scope in `main_worker.py` (import left in place) | **4 failed / 5 passed.** `test_worker_entrypoint_installs_the_structlog_redactor` failed with no JSON line at all (default ConsoleRenderer still installed); captured stdout read `[info ] worker_probe api_key=QZ-OPS05-CANARY-… safe_field=kept`. `test_worker_entrypoint_installs_the_stdlib_logrecord_bridge` failed with `WARNING:quantalyze.analytics:ccxt failure: https://…&signature=QZ-OPS05-CANARY-…`. The negative control and the `main_worker.py` ordering case also reddened. |
| M2 | Moved `configure_logging()` in `main.py` back below `from routers import …` (its pre-phase position) | **1 failed / 1 passed.** `TestEntrypointOrdering…[main.py-routers]` failed with *"`configure_logging()` is at line 71 but the first-party import 'routers' at line 67 runs BEFORE it"*. |
| M3 | Appended `_frozen_scratch = structlog.get_logger("scratch").bind(component="scratch")` at module scope in `services/rate_limit.py` (preventive gate — 0 violations at HEAD, so a violation had to be introduced) | **1 failed / 2 passed.** `test_no_module_scope_bind_in_non_test_code` failed with ``module-scope `.bind()` found at ['services/rate_limit.py:140']``. |
| M4 | Restored the unconditional `record.msg = scrub_freeform_string(record.msg)` in `_scrub_record_in_place` | `test_scrub_never_drops_a_record_by_eating_a_format_placeholder` failed at the `logger.warning()` call with `TypeError: not all arguments converted during string formatting`; independently `tests/test_compute_jobs_fencing.py::TestDispatchTickThreadsClaimToken` went **3 failed / 2 passed** when run on its own. |

All four mutations restored. Byte backups were taken before each; every restore was confirmed by grepping for the restored call, not by hash alone. `services/rate_limit.py` is unmodified in this phase (`git status` clean for it).

**Pre-edit gate token:** the Mode A expected count — **111 non-test modules scanned, 0 module-scope binds** — was measured with the shipped AST walk against the phase's base commit, BEFORE any file in this plan was touched.

**Test-order caveat recorded in the code:** `tests/test_stdlib_redact_bridge.py` has an autouse fixture that uninstalls the LogRecord factory on teardown, so `test_compute_jobs_fencing.py` must be run on its own to observe M4's effect there. Noted in the test docstring so a future reader does not conclude the mutation is harmless.

## TDD Gate Compliance

Task 2 is declared `tdd="true"` but is a **test-only** task: the gated condition (zero module-scope binds) already held at HEAD, so a GREEN implementation commit would have been empty. The RED gate was satisfied by mutation M3 — a deliberate scratch violation observed failing and then removed — rather than by committing a failing state that would have put a known-broken `.bind()` into `services/rate_limit.py` history. `git log` therefore shows `test(163-01): …` with no paired `feat(163-01): …`, which is expected for this task and is not a skipped gate.

## Issues Encountered

- **The research's Mode B mechanism claim did not survive measurement** (see Decision 2). Rather than write a test docstring asserting a mechanism that is false for the situation it describes, the correction was measured, recorded in the test's own docstring and in `services/mt5_client.py`, and the tests were built to demonstrate both the true window behaviour and the true freeze behaviour.
- **Full-suite red after Task 1** — resolved as the Rule 1 deviation above. Final full run: **5387 passed, 89 skipped, 0 failed** (`python3 -m pytest` from `analytics-service/`, 4m14s).
- **`mypy --strict --follow-imports=silent services/ routers/ models/`** — Success, no issues found in 91 source files (run after both source edits).

## Known Stubs

None. No stub, placeholder, skipped test, or unrun `<verify>` was introduced by this plan.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern, or trust-boundary schema change was introduced. The three threats in the plan's register are addressed: T-163-01 by the worker entrypoint fix + behavioral test, T-163-02 by the Mode A gate proven RED, T-163-03 by the shipped negative controls.

## User Setup Required

None — no external service configuration required. `configure_logging()` is idempotent and reads no new environment variable.

## Next Phase Readiness

- OPS-05 is fully closed at both failure modes; SC-1 satisfied.
- **Note for 163-03 (the no-allowlist username/path scanner):** this SUMMARY and the new test files contain only repo-relative paths. The test file embeds one absolute-looking string — a fabricated `https://api.binance.com/…` canary URL — which is a test fixture, not a local path or a prod URL.
- **Note for whoever owns worker observability:** with redaction now installed on the standalone worker, worker log output changes shape (JSON via `JSONRenderer` for structlog emissions). Nothing in the repo parses worker log lines, but any external Railway log-drain filter keyed on the old ConsoleRenderer format would need re-checking.
- **Follow-up worth filing (not blocking):** the three `%`-templates listed under the Rule 1 deviation still contain denylist-shaped literals (`claim_token=%s`, `api_key=%s`). They now emit correctly and carry only row ids / fencing nonces, not credentials. Rephrasing them (e.g. moving the key name out of the template) would let the scrub apply cleanly, but that is cosmetic and was left alone under the surgical-changes rule.

## Self-Check: PASSED

All six claimed files exist on disk. All three claimed commits exist in `git log`
with exactly the declared file sets:

- `ead12f9fb` — main.py, main_worker.py, services/mt5_client.py, tests/test_structlog_frozen_proxy.py
- `291e4ba80` — tests/test_structlog_frozen_proxy.py
- `21c232837` — services/logging_config.py, tests/test_stdlib_redact_bridge.py

No commit in this plan deleted a tracked file (`git diff --diff-filter=D` empty for
each). No file outside the plan's declared set was staged.

---
*Phase: 163-harden-fail-safe-closed-and-loud*
*Completed: 2026-08-26*

---
phase: 143-job-dropped-enqueue-reconciliation-sweep
plan: 01
subsystem: infra
tags: [sentry, python-worker, pg_cron, job-queue, alerting, observability, pytest]

# Dependency graph
requires:
  - phase: 142-strategy-analytics-stuck-computing-reaper
    provides: "the non-racing split by computation_status, and the header precedent that there is NO cron->Sentry bridge in this repo — which is why the alert had to be worker-side"
  - phase: 16-observability
    provides: "analytics-service/sentry_init.py::init_sentry() — DSN-absent early return, send_default_pii=False, _redact_before_send, environment resolution"
provides:
  - "analytics-service/main_worker.py: module-level `import sentry_sdk` + `from sentry_init import init_sentry`"
  - "analytics-service/main_worker.py::main(): init_sentry() bootstrap — the worker process now has a Sentry client for the first time"
  - "analytics-service/main_worker.py::dispatch_tick(): reconcile-sweep marker read + one warning-level capture_message, wrapped so a transport failure never fails the job"
  - "analytics-service/tests/test_main_worker.py: TestMainWorkerSentryBootstrap (main()-calls-init_sentry, written from first principles) + TestReconcileSweepAlert (3 tests)"
  - "The Python half of the cross-language metadata marker contract: keys `source` / `detected_at`, value `reconcile-sweep`"
affects: [143-02 cron body writes the marker this plan reads, 143-03 TestReconcileSweepMarkerContract pins both halves, 143-04 must verify SENTRY_DSN on the worker Railway service, 144-orphaned-running-compute-jobs, any future worker-side Sentry emission]

actuals:
  tokens: 5512
  tasks: 2
  commits: 2

tech-stack:
  added: []          # sentry-sdk[fastapi]==2.64.0 was already declared (requirements.txt:222) — ZERO packages installed
  patterns:
    - "main()-calls-X bootstrap assertion: patch the four loops + healthz + KEK + the running loop's add_signal_handler, await main(), assert the spy fired exactly once"
    - "The load-bearing-pair convention: a spy-based capture test can never prove an alert is real; it must be paired with a separate bootstrap assertion, and BOTH halves' independence must be proven by observing capture-GREEN-while-bootstrap-RED"

key-files:
  created: []
  modified:
    - analytics-service/main_worker.py
    - analytics-service/tests/test_main_worker.py

key-decisions:
  - "DX-07 (Claude's discretion, exercised): the emission lives in the dispatch_tick claim loop immediately after the claim_token read and BEFORE the try: that owns the heartbeat task's try/finally — so the marker read is not inside the heartbeat's error handling, and a dispatch that later fails still alerts."
  - "The emission's own try/except is load-bearing, not defensive boilerplate: because the read sits before the outer try:, an unwrapped raise escapes dispatch_tick entirely and takes every remaining job in the claimed batch with it. Neuter D proved this by observation."
  - "sentry_sdk imported as a MODULE, never a from-import — the repo's monkeypatch.setattr(module, 'sentry_sdk', spy) idiom is the only way this emission is testable (main.py:16-20)."
  - "init_sentry() placed after logging.basicConfig and BEFORE validate_kek_on_startup, so a KEK failure at boot is itself reportable."
  - "Event payload is strategy_id (UUID) + detected_at only — no email, no CSV content (T-143-06)."

patterns-established:
  - "Pattern 1: load-bearing-pair neuter proof — when a test doubles the very SDK whose initialization is in question, the proof of independence is a single neuter (remove init) observed to redden ONE test while the other stays green. Recorded as an explicit table row, not asserted in prose."
  - "Pattern 2: anti-vacuity companion assertion on every zero-count claim — each `captures == []` / `len(captures) == 1` assertion is paired with a mark_compute_job_done count, so a dispatch_tick that never entered the claim loop cannot pass silently."

requirements-completed: [JOB-04]

coverage:
  - id: D1
    description: "main_worker.main() initializes Sentry, so worker-side capture_* calls are no longer silent no-ops"
    requirement: "JOB-04"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_main_worker.py::TestMainWorkerSentryBootstrap::test_main_calls_init_sentry"
        status: pass
      - kind: other
        ref: "cd analytics-service && SENTRY_DSN=... python3 -c 'from sentry_init import init_sentry; init_sentry(); print(\"init-ok\")'  # integrations-outside-ASGI smoke, exit 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Claiming a compute_jobs row marked metadata.source == 'reconcile-sweep' emits exactly one warning-level Sentry event carrying strategy_id and detected_at"
    requirement: "JOB-04"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_main_worker.py::TestReconcileSweepAlert::test_marker_job_captures_sentry_event"
        status: pass
    human_judgment: false
  - id: D3
    description: "Unmarked jobs emit nothing, and a Sentry transport failure never fails the job or the remaining claimed batch"
    requirement: "JOB-04"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_main_worker.py::TestReconcileSweepAlert::test_unmarked_job_does_not_capture"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_main_worker.py::TestReconcileSweepAlert::test_capture_failure_does_not_fail_job"
        status: pass
    human_judgment: false
  - id: D4
    description: "SC#1's alert half is REAL in production — i.e. a live Sentry event actually arrives when the sweep heals a strategy"
    verification: []
    human_judgment: true
    rationale: "Unverifiable from the repo. init_sentry() early-returns when SENTRY_DSN is unset, and the worker is a SEPARATE Railway service from the FastAPI app — a DSN on the web app does not imply one on the worker (143-RESEARCH.md L-1 item 3, still UNVERIFIED). Plan 04 owns this check. Until it passes, everything in this plan is correct and still emits nothing."

# Metrics
duration: 22min
completed: 2026-08-16
status: complete
---

# Phase 143 Plan 01: Worker Sentry Bootstrap + Reconcile-Sweep Alert Summary

**The analytics worker now initializes Sentry at boot for the first time ever, and emits one warning-level event when it claims a job carrying the reconcile-sweep marker — closing the gap that would have made SC#1's "a Sentry alert fires" silently false in production while every unit test stayed green.**

## Performance

- **Duration:** 22 min (first commit 22:33 → final 22:55, 2026-08-16)
- **Tasks:** 2 / 2
- **Commits:** 2 task commits + 1 docs commit
- **Files changed:** 2 (both modified, none created)

**Note on `actuals.tokens` basis (so a future calibrator can reconcile):** the frontmatter figure
`5512` is chars/4 over the **realized diff** (22,049 chars), per the template's explicit rule. The
same measurement taken over the **full text of the two files touched** is 180,417 / 4 = **45,104** —
which lands within 0.3% of the plan's `estimate.tokens: 45000`. The estimate was therefore almost
certainly made on the full-files scale, not the diff scale. Recording both so the next calibration
compares like with like rather than concluding this plan was overestimated 8×.

## What Was Built

### 1. Worker Sentry bootstrap (`analytics-service/main_worker.py`)

`main_worker.py` is a standalone process (`python -m main_worker` on Railway) that, before this
plan, contained **zero** references to Sentry — while its sibling FastAPI process `main.py` has had
`init_sentry()` since Phase 16. Research (143-RESEARCH.md L-1) established that
`sentry_sdk.capture_*()` with no initialized client is a **silent no-op**: it raises nothing and
logs nothing.

Three edits:

1. Module-level `import sentry_sdk` — as a **module**, not a from-import. The comment records why:
   the repo's existing spy idiom is `monkeypatch.setattr(module, "sentry_sdk", spy)`
   (`tests/test_secret_misconfig_signal.py:103`), and a from-import makes the emission untestable.
   Plus `from sentry_init import init_sentry`.
2. `init_sentry()` in `main()`, after `logging.basicConfig` and **before** `validate_kek_on_startup`
   — so logging is wired before any sentry import side effects (matching `main.py:60-69`), and so a
   KEK failure at boot is itself reportable. No-ops when `SENTRY_DSN` is unset, leaving local dev
   and CI byte-identical.
3. The marker read + capture in the `dispatch_tick` claim loop.

### 2. The emission (DX-07 insertion point)

Placed immediately after `claim_token = job.get("claim_token")` and **before** the `try:` that owns
the `_heartbeat` task's `try/finally`. Rationale, carried in the code comment: the marker read has
no business inside the heartbeat's error handling, and claim-time (rather than handler-entry)
alerting fires even when the dispatch itself subsequently fails.

```python
_meta = job.get("metadata") or {}
if _meta.get("source") == "reconcile-sweep":
    with sentry_sdk.new_scope() as scope:
        scope.set_tag("surface", "reconcile-sweep")
        scope.set_tag("job_kind", job.get("kind"))
        scope.set_extra("strategy_id", job.get("strategy_id"))
        scope.set_extra("detected_at", _meta.get("detected_at"))
        sentry_sdk.capture_message(
            "Dropped compute-job enqueue healed by reconciliation sweep",
            level="warning",
        )
```

Wrapped in `try/except Exception: pass`. The comment states the honest latency limitation verbatim
(alert = sweep tick → next worker claim; a fully-down worker means no alert, which is independently
alarmed by healthz) so no reader assumes instant paging.

### 3. Two pytest classes (`analytics-service/tests/test_main_worker.py`, +352 lines)

- `TestMainWorkerSentryBootstrap::test_main_calls_init_sentry` — awaits `main_worker.main()` with
  KEK validation, the three loops, `start_healthz_server` and the running loop's
  `add_signal_handler` patched out, and asserts `init_sentry` fired exactly once. Written from
  **first principles**: 143-PATTERNS "Analog C" established that no test in this repo asserts
  `main_worker.main()` calls anything (the nearest precedent documents wiring in a *docstring*).
  The docstring says so.
- `TestReconcileSweepAlert` — marker job captures exactly one event with the right message, level,
  tags and extras; a `metadata: None` job **and** a `{"source": "something-else"}` job capture
  nothing; a raising `capture_message` still lets the job reach its DONE mark.

Oracle independence held: every expected literal (`source`, `reconcile-sweep`, `detected_at`, the
message string, `warning`, the `surface` tag) is declared **locally** in the test file naming
`main_worker.py` as its production source, never imported from the code under test.

## Neuter Proofs — `Gate | Neuter | Expected RED | Observed`

Every row below was **actually executed**, not reasoned about. Each neuter was applied by script,
run, then restored with `git checkout -- analytics-service/main_worker.py` (never retyped) and
re-confirmed green before the next.

| Gate | Neuter | Expected RED | Observed |
|---|---|---|---|
| **The designed RED (Task 1, pre-implementation)** | Production file entirely unmodified | all 4 new tests fail | ✅ `4 failed, 55 passed`. All four failed on the absent production symbols: `AttributeError: module 'main_worker' ... does not have the attribute 'init_sentry'` (bootstrap) and `... has no attribute 'sentry_sdk'` (all three capture tests). Baseline was `55 passed` — **exactly 4 new failures, zero pre-existing tests changed state.** |
| **⭐ A — SC#1 alert (the D-11 load-bearing pair)** | Remove the `init_sentry()` call from `main()` | `test_main_calls_init_sentry` RED **while the capture tests stay GREEN** | ✅ `1 failed, 3 passed`. Verbatim: `AssertionError: main_worker.main() did not call init_sentry() exactly once (got 0). ... assert 0 == 1 +  where 0 = <MagicMock>.call_count`. The three `TestReconcileSweepAlert` tests **passed** under the same neuter — the recorded proof that the two tests are independently load-bearing, exactly as the D-11 correction predicted, and the reason the bootstrap assertion is not decorative. |
| **B — SC#1 alert (behavioural, beyond plan)** | Delete the whole emission block from `dispatch_tick` (keeping the import, so the spy installs cleanly) | the capture tests fail on **zero captures**, not on a missing symbol | ✅ `2 failed, 2 passed`. Verbatim: `AssertionError: expected exactly ONE Sentry capture for a reconcile-sweep-marked job, got 0` and `AssertionError: the emission was never attempted, so this test proves nothing about transport-failure tolerance`. `test_unmarked_job_does_not_capture` correctly stayed GREEN (it is a negative test; its anti-vacuity `mark_done == 2` guard still held), as did the bootstrap test. |
| **C — marker contract** | Change the production read's metadata key from `source` to `origin` | the marker assertion fires | ✅ `2 failed, 1 passed`, same zero-capture messages. Proves the test pins the **key**, not merely the presence of metadata. |
| **D — transport-failure tolerance (T-143-11)** | Remove the `try/except` wrap, keeping the emission body | `test_capture_failure_does_not_fail_job` RED with the raise escaping `dispatch_tick` | ✅ `1 failed, 2 passed`. Verbatim: `RuntimeError: sentry transport down` propagating out of `dispatch_tick` — confirming that without the wrap a Sentry fault takes down the whole claimed batch, not just one job. |

**Why row B was added beyond the plan's required set:** the Task-1 RED was an `AttributeError` on
the missing module attribute rather than the "zero captures" failure the plan's acceptance text
anticipated. That is an *earlier* RED, but on its own it would only prove the symbol is absent, not
that the emission behaves. Neuter B supplies the behavioural RED, so the capture assertions are
proven to fail for the right reason. Recorded rather than glossed.

## Verification Run

| Check | Command | Result |
|---|---|---|
| Plan-scoped suite | `cd analytics-service && python3 -m pytest tests/test_main_worker.py -q` | ✅ `59 passed` (55 baseline + 4 new) |
| Regression sweep over every `main_worker`-touching test file | `python3 -m pytest tests/test_job_worker.py tests/test_stitch_composite_job.py tests/test_job07_reaper_off_worker_loop.py tests/test_worker_load.py tests/test_main_worker.py tests/test_job_worker_csv_kind.py tests/test_daily_enqueue_lock.py tests/test_compute_jobs_fencing.py tests/test_worker_isolation_e2e.py -q` | ✅ `303 passed, 29 skipped` |
| **Full analytics-service suite** | `cd analytics-service && python3 -m pytest -q` | ✅ `5177 passed, 96 skipped in 123.64s` |
| `mypy --strict` | `python3 -m mypy --strict --follow-imports=silent main_worker.py` | ✅ `Found 9 errors` — **byte-identical to the pre-change baseline** (same 9 `no-untyped-def` errors on the same pre-existing closures, only line numbers shifted by the insertions). Zero new errors, zero new `# type: ignore`. |
| Integrations-outside-ASGI smoke (RESEARCH A4) | `SENTRY_DSN="https://public@o0.ingest.sentry.io/0" python3 -c "from sentry_init import init_sentry; init_sentry(); print('init-ok')"` | ✅ prints `init-ok`, `EXIT=0`. `StarletteIntegration()` / `FastApiIntegration()` construct fine with no ASGI app — **no worker-specific init path needed**, no deviation. |
| Module-not-from import | `grep -n "import sentry_sdk" main_worker.py` | ✅ `52:import sentry_sdk` — module-level, module import |

All pytest runs were executed **from `analytics-service/` using `python3`** (repo-root runs miss the
VCR cassettes and would make live broker calls — RESEARCH P-8).

⚠️ Local `sentry-sdk` is **2.58.0**; `requirements.txt:222` pins `sentry-sdk[fastapi]==2.64.0`. The
smoke and the `new_scope()` API surface were therefore proven on 2.58.0, not on the pinned CI/prod
version. `new_scope()` is stable across the 2.x line and CI installs the pin, so this is recorded as
a measurement caveat rather than a risk — but it is a caveat, not a verification.

## Deviations from Plan

**None affecting scope or behaviour.** Two recorded observations where reality differed from the
plan's *anticipation*:

1. **[Not a rule-triggered deviation — RED shape]** The plan's acceptance text expected the capture
   tests to fail on "zero captures". They actually failed earlier, on
   `monkeypatch.setattr(main_worker, "sentry_sdk", spy)` raising `AttributeError` because the
   production module had no such attribute. The acceptance criterion ("all four tests FAIL against
   unmodified `main_worker.py`") is met, and Neuter B was added to supply the behavioural RED the
   plan's wording had in mind. Documented above rather than quietly accepted.
2. **[Not a rule-triggered deviation — contingency not needed]** The plan carried a contingency for
   the integrations-outside-ASGI smoke raising (fall back to a worker-specific init path). It did
   not raise. The standard `init_sentry()` is used unchanged.

Zero packages were installed (T-143-SC): `sentry-sdk[fastapi]==2.64.0` was already a declared
dependency, so no package-legitimacy checkpoint was required.

## Known Stubs

None. No hardcoded empty values, no placeholder text, no TODO/FIXME introduced, and no component
left without a data source.

The one thing that is **incomplete by design and owned elsewhere**: the alert is correct code that
still emits nothing until `SENTRY_DSN` is set on the worker's Railway service. That is not a stub —
it is `init_sentry()`'s documented DSN-absent early return (`sentry_init.py:347-350`), and Plan 04
owns the verification (coverage item D4, `human_judgment: true`).

## Authentication Gates

None encountered.

## Threat Flags

None. The two files touched introduce no new network endpoint, auth path, file-access pattern or
schema change beyond the surface already registered in the plan's `<threat_model>` (T-143-05,
T-143-06, T-143-10, T-143-11, T-143-SC, all `mitigate`, all discharged in code + tests except the
manual Railway `SENTRY_DSN` check that T-143-05 explicitly assigns to Plan 04).

## What's Left for the Rest of Phase 143

- **Plan 02** writes the SQL half of the marker contract this plan reads
  (`{"source": "reconcile-sweep", "detected_at": <ts>}`) in the cron body. Any drift in either
  literal silently kills the alert.
- **Plan 03** pins both halves against each other with `TestReconcileSweepMarkerContract` plus its
  anti-vacuity guard.
- **Plan 04** must verify `SENTRY_DSN` on the **worker** Railway service. Until then, the alert
  path is correct and mute.

## Self-Check: PASSED

- `analytics-service/main_worker.py` — FOUND (modified; `import sentry_sdk` at :52, `init_sentry()`
  in `main()`, emission in `dispatch_tick`)
- `analytics-service/tests/test_main_worker.py` — FOUND (modified; both new classes present, 59
  tests collected)
- Commit `a587720f` (`test(143-01): add failing pytests ...`) — FOUND in `git log`
- Commit `d753a304` (`feat(143-01): init Sentry in worker main() ...`) — FOUND in `git log`
- Working tree clean on both files after every neuter restore — VERIFIED (`git status --short`
  empty before the final green run)

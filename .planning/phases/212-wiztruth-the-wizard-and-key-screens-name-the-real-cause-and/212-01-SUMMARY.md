---
phase: 212-wiztruth-the-wizard-and-key-screens-name-the-real-cause-and
plan: 01
subsystem: analytics-service MT5 seam
tags: [mt5, curated-copy, sc2, sc4, red-on-revert]
requires: []
provides:
  - "MT5_GATEWAY_MISCONFIGURED_DETAIL is the founder-approved cause-free sentence"
  - "SC4 structural pin: validate and derive leases use different terminal keys"
affects: [analytics-service/services/mt5_probe.py, analytics-service/tests/test_mt5_validate_parity.py, analytics-service/tests/test_mt5_concurrency.py]
tech-stack:
  added: []
  patterns: ["hand-typed oracle for curated copy", "blocking-behaviour oracle with deadman wait_for"]
key-files:
  created: []
  modified:
    - analytics-service/services/mt5_probe.py
    - analytics-service/tests/test_mt5_validate_parity.py
    - analytics-service/tests/test_mt5_concurrency.py
    - .planning/milestones/v1.20-phases/161-wizerr-honest-error-surfaces/161-UI-SPEC.md
key-decisions:
  - "Founder sentence of 2026-11-14 lands byte for byte; constant stays the generic fallback, degradation target and default argument"
  - "_MT5_LEASE_WAIT_S stays 20 s; SC4 is pinned structurally instead of by raising the wait"
status: complete
commits: 4
plan_head_before: 69561c8987cad58b4ac31a07e3ab36ed86bb7393
plan_head_after: 4d1810350c37a1372bed3dea252f678d6b55b159
actuals:
  tokens: 2750
  tasks: 3
  commits: 4
---

# Phase 212 Plan 01: MT5 cause-unknown copy and SC4 lease pin Summary

The MT5 cause-unknown fallback now names no cause (founder sentence, byte exact), every comment that restated the old option as arm 3's meaning is corrected, the 161 arm-3 contract is amended, and a behavioural test proves a held derive lease never delays a validate lease.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | `f8eb999e8` | fix(212-01): MT5 cause-unknown fallback names no cause |
| 2a | `7e621a636` | docs(212-01): correct arm-3 comment carriers |
| 2b | `1160ad7ff` | docs(212-01): amend 161 arm-3 contract (planning-only, `.planning/` path only) |
| 3 | `4d1810350` | test(212-01): pin that validate and derive never share a terminal lock |

## Task 1 (tracer): the founder sentence flows end to end

- `MT5_GATEWAY_MISCONFIGURED_DETAIL` = "The MT5 gateway would not let us prove read-only capability, and it did not report why. This needs an operator, not a retry — see docs/runbooks/mt5-go-live.md." (U+2014, `Final[str]`, implicit concatenation kept). Arms 1 and 2, the tuple order, the `Mt5GatewayMisconfigured()` default argument and `curated_gateway_detail` are untouched.
- `_EXPECTED_GENERIC` re-typed by hand with a dated 212-01 comment. The fence test and its token lists were not edited.
- Verification: `pytest tests/test_mt5_validate_parity.py tests/test_job_worker.py tests/test_ingestion_mt5.py` 192 passed, 1 skipped; the plan's python one-liner exit 0; `make typecheck` "no issues found in 139 source files".
- The one skip is `tests/test_job_worker.py:4239` "Live test Supabase project not configured (TEST_SUPABASE_DB_URL unset)". It is a live-DB test unrelated to this change, skipped for want of a secret this executor must not use.

### RED-on-revert (SC8), observed

Backed up `mt5_probe.py` to the scratchpad, restored the old wording of the constant only, ran `tests/test_mt5_validate_parity.py`: **6 failed, 20 passed**. Failing ids:

- `test_builder_selects_the_cause_arm_the_flags_actually_support[terminal4-...]` (flag absent, A1 quarantine)
- `...[terminal5-...]` (empty terminal dict)
- `...[None-...]` (unreadable terminal)
- `...[terminal7-...]` (detached from the trade server)
- `...[not-a-mapping-...]` (non-dict terminal)
- `test_worker_sink_lets_a_curated_cause_through_but_never_raw_remote_text`

So five `_EXPECTED_GENERIC` rows plus the worker-sink case went RED, as expected. The plan also expected the docstring-anchor case (`test_the_exception_docstring_names_the_sink_the_worker_actually_calls`) to go RED; it did NOT. It stayed green under the neuter. Recorded, not chased: it is outside this plan's change and the plan listed it as an expectation, not an acceptance criterion. Restored with `cp`; `cmp` exit 0; parity file re-ran 26 passed.

## Task 2: carrier classification

Searched `analytics-service` and `docs` (excluding `.venv` and caches) for the old arm-3 lead phrase ("refuses automated trading") and the option name ("Disable automatic trading through the external Python API"), plus a second pass for "generic constant", "the constant at the top", "arm 3" prose.

| File | Symbol / line | Verdict | Reason |
|------|---------------|---------|--------|
| `services/mt5_probe.py` | `#:` docblock above `MT5_GATEWAY_MISCONFIGURED_DETAIL` (RESIDUAL paragraph) | **REWRITE** | Said the sentence "names a SPECIFIC option" and that cause-free rewording was "a copy decision for the phase owner". Now a dated CORRECTED note (2026-11-14, Phase 212) keeping the old reasoning as lineage |
| `services/mt5_probe.py` | `#:` docblock above `MT5_GATEWAY_EXTERNAL_API_BLOCKED_DETAIL` (arm 2) | **REWRITE** | Said "the case the constant at the top of this block actually describes". False now that the top constant is cause-free. Dated correction added |
| `services/mt5_probe.py` | `Mt5GatewayMisconfigured` docstring lead (~172) | KEEP | "the gateway refuses automated trading" describes the fault family, asserts no flag |
| `services/mt5_probe.py` | ~418 (`order_check` short-circuit comment) | KEEP | Describes both settings and D-31, not arm 3 |
| `services/job_worker.py` | `classify_exception` comment (~1274-1295) | KEEP | Family description plus dated lineage about the old arm-1/2 wording |
| `tests/test_job_worker.py` | ~156 docstring | KEEP | Describes the bare `RuntimeError` history |
| `services/mt5_validation.py` | ~35, ~265, ~318 | KEEP | Describe the option itself (arm 2's cause) |
| `services/mt5_client.py` | ~2987 | KEEP | Describes the option itself |
| `services/ingestion/mt5.py` | ~444 | KEEP | Describes the option and the old copy as history |
| `routers/exchange.py` | ~1199 | KEEP | Same |
| `docs/runbooks/mt5-go-live.md` | ~205 | KEEP | Operator remedy for the option; not copy |
| `tests/test_mt5_validate_parity.py` | 25, 318, 421, 552 (arm 2 expectation), 635, 765 | KEEP | Describe the option / arm 2 / the A1 history |
| `tests/test_mt5_validate.py` | 273, 323, 850, 900 | KEEP | D-31 history about the option |
| `tests/test_ingestion_mt5.py` | 256, 322 | KEEP | D-31 history about the option |
| `services/mt5_probe.py` / `ingestion/mt5.py` / `tests/test_mt5_validate_parity.py` | "generic constant" mentions (203, 263, 465, 526, 738, 748, 902, 943) | KEEP | Refer to the constant by role (fallback, degradation target); remain true |

RESEARCH expected KEEP for the six named files and the runbook; the table agrees. Two rewrites, both in `mt5_probe.py` (already in `files_modified`). No behaviour change; pytest 192 passed 1 skipped and `make typecheck` clean after the edit.

`161-UI-SPEC.md` arm 3 now quotes the founder sentence with a dated note (amended 2026-11-14 by Phase 212 WIZTRUTH, founder-approved copy). Nothing else in that file edited. Committed alone; `git log -1 --name-only` lists only that `.planning/` path (acceptance check printed `planning_only_ok`).

## Task 3: SC4 structural pin

New test `test_a_held_job_terminal_never_delays_a_validation_acquisition` in `tests/test_mt5_concurrency.py`, placed beside `test_only_the_validate_sites_read_the_validation_endpoint`. Distinct private pairs (`10.0.0.5:18812` job, `10.0.0.6:18813` validation) set via `monkeypatch.setenv`; both keys derived through the real readers and `mt5_terminal_key`. While a lease is held on the job key (`holder="derive"`), a validation-key lease with `wait_s=0.05` under a 10 s `asyncio.wait_for` deadman must acquire. Control arm: the validation pair set equal to the job pair raises `Mt5TerminalBusyError`. `_MT5_LEASE_WAIT_S` and `mt5_concurrency.py` are untouched; `mt5_relogin.py` is byte-unchanged after the neuter.

Verification: `tests/test_mt5_concurrency.py` 36 passed; combined run of the four suites 228 passed, 1 skipped; `make typecheck` clean.

### RED-on-revert (SC8), observed

Backed up `mt5_relogin.py`, neutered `read_env_validation_gateway_endpoint` to `return read_env_gateway_endpoint()`, ran the new test: **FAILED** with `Mt5TerminalBusyError: the MT5 terminal was still in use when the acquisition bound expired`, surfaced as the test's own message "a lease held on the JOB terminal delayed a VALIDATION acquisition: validate and derive share a terminal lock again...". Restored with `cp`; `cmp` exit 0; GREEN again.

Note: a first draft carried an extra `assert job_key != validation_key` precondition. Under the neuter it failed on that assertion BEFORE the blocking oracle ran, so it proved the key check and not the blocking behaviour. It was removed so the observed RED is the blocking oracle itself; the equal-key control already covers the key identity.

## Finding: nothing refuses an equal validation/job pair

`read_env_validation_gateway_endpoint` refuses an absent, non-numeric or non-private validation pair, but nothing refuses a validation pair EQUAL to the job pair. The SC4 guarantee is therefore a configuration fact plus reader routing, not an enforced invariant, and a deploy that sets the pairs equal re-creates the original premise (a derive makes a connect wait). The test docstring and its control arm record this. An equality refusal would be a behaviour change outside this phase; not done. Candidate for a later phase if the founder wants it enforced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `make install` could not complete**
- **Found during:** Task 1 Step 1
- **Issue:** The Makefile creates the venv with `uv venv`, which has no `pip`, so `$(PIP) install` fails (`.venv/bin/pip: No such file or directory`).
- **Fix:** Installed the same committed `requirements.txt` + `requirements-dev.txt` with `uv pip install --python .venv/bin/python -r ...`. No package added or changed (T-212-SC). `.venv` is gitignored.
- **Files modified:** none tracked.

**2. [Scope note] Comment-prose carriers.** The search found hits in two files outside the plan's `files_modified` (`tests/test_mt5_validate.py`, and extra lines in `tests/test_ingestion_mt5.py` / `tests/test_mt5_validate_parity.py`); all classified KEEP, so no file outside the list was edited.

No other deviations. Rule 4: none.

## Known Stubs

None.

## Threat Flags

None. T-212-01 mitigated: the new sentence passes `test_every_builder_emittable_constant_is_curated_and_credential_free` unmodified. T-212-02 mitigated: the new pin reds on collapsed routing and `_MT5_LEASE_WAIT_S` is unchanged.

## Records for ship

- Closes TODOS `0.09`. `0.51` closes only per plan 09's SC4 copy outcome. `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json`, `STATE.md`, `ROADMAP.md` and `supabase/migrations` were not touched.

## Self-Check: PASSED

- FOUND files: `analytics-service/services/mt5_probe.py`, `analytics-service/tests/test_mt5_validate_parity.py`, `analytics-service/tests/test_mt5_concurrency.py`, `.planning/milestones/v1.20-phases/161-wizerr-honest-error-surfaces/161-UI-SPEC.md`
- FOUND commits: `f8eb999e8`, `7e621a636`, `1160ad7ff`, `4d1810350` (all ancestors of HEAD; `git rev-list --count 69561c89..HEAD` = 4 before this SUMMARY commit)

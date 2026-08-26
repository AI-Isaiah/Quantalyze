---
phase: 163-harden-fail-safe-closed-and-loud
plan: 07
subsystem: analytics-service
tags: [rate-limiting, tenant-identity, determinism, anti-vacuity]
status: complete
requires: []
provides:
  - "resync draft pre-check is deterministic (newest-wins) and bounded (8h window)"
  - "IP-keyed router class is CLOSED: quarantine empty, enumeration total at 10"
affects:
  - analytics-service/routers/process_key.py
  - analytics-service/routers/simulator.py
tech-stack:
  added: []
  patterns:
    - "partial(tenant_or_platform_key, scope=...) as the single shared limiter identity"
    - "quote-and-refute for superseded prose instead of silent deletion"
    - "paired oracle (floor + discriminator) where a lone drive-to-429 would be vacuous"
key-files:
  created:
    - analytics-service/tests/test_resync_precheck_determinism.py
  modified:
    - analytics-service/routers/process_key.py
    - analytics-service/routers/simulator.py
    - analytics-service/tests/test_limiter_identity.py
    - analytics-service/tests/test_limiter_route_coverage.py
    - analytics-service/tests/test_simulator_router.py
    - analytics-service/tests/test_process_key.py
    - analytics-service/tests/test_resync_draft_dedup.py
decisions:
  - "8h resync resume window, derived from the single-hop process_key_long envelope"
  - "in-handler _check_simulator_user_rate STAYS — the decorator cannot see the parsed body"
  - "stale IP-key pins REPLACED rather than deleted, so the contract keeps a guard"
metrics:
  duration: "~1h"
  completed: 2026-08-26
actuals:
  tokens: 61000
  tasks: 2
  commits: 3
---

# Phase 163 Plan 07: Deterministic Resync Pre-check + Tenant-Keyed Simulator Bucket Summary

OPS-09 makes the resync draft pre-check newest-wins and time-bounded; SEC-05 moves the
tenth and last IP-keyed route onto the shared tenant identity and strips **both** halves
of the concealment that hid it — with the falsifiability of the repaired gate measured,
not asserted.

## Execution note

This plan was finished by a second executor. The first stalled after committing Task 2's
tree as `WIP … UNVERIFIED`; that commit has been replaced, and no commit claiming
unverified work survives in the phase. Task 1 was inherited complete and verified and was
**not** re-done — it is described below from its commit rather than re-executed.

## Task 1 — OPS-09: deterministic, bounded resync draft pre-check

Commit `9dc40274e` (inherited, verified).

The pre-check in `routers/process_key.py` had no `ORDER BY`, so under the documented
two-draft residual (the two-tab race) which draft `.limit(1)` resumed was planner /
PostgREST-order dependent; with no lower bound, an orphaned draft stayed resumable
forever.

- The query chain gains `.order("created_at", desc=True)` and
  `.gte("created_at", now - _RESYNC_DRAFT_RESUME_WINDOW)`.
- `_RESYNC_DRAFT_RESUME_WINDOW = timedelta(hours=8)`, **derived** from the single-hop
  `process_key_long` envelope (4x1800 batch-tail + 3x1800 retried handler + 630 backoff =
  13,230 s) under the house 1.25x / whole-4-hour rule, strictly below
  `STRATEGY_ANALYTICS_REAP_THRESHOLD`. The derivation is stated at the constant and the
  test pins the same literal. Reordering is tenant-safe because the read runs strictly
  after the ownership gate.
- Both adjacent prose debts settled in the same edit: the two-draft comment
  quotes-and-refutes its own `.limit(1)` sentence, and the DEF-141.1-02-A SCOPE BOUND
  over-claim is corrected. Two stale line anchors were re-anchored by name.
- A notable find recorded in that commit: the stateful test double's `.order()` was a
  **no-op** and it had no `.gte()` at all — so a RED demo would have stayed green with the
  production clause deleted. Both are real now.

## Task 2 — SEC-05: tenant-key the simulator bucket, remove the concealment

Commits `d57673455` (replaces the WIP) and `bec807a78`.

`routers/simulator.py`'s decorator moves off `_simulator_rate_limit_key` (which returned
`simulator:ip:<address>`) onto `partial(tenant_or_platform_key, scope="simulator")`. The
dead helper is **deleted, not unwired** — a decoy is worse than nothing, which is how L-9
happened. The in-handler `_check_simulator_user_rate` stays: slowapi's `key_func` runs
before the body is parsed, so a quota keyed on the server-set `user_id` cannot live in the
decorator. Two mechanisms, two jobs.

The concealment was in **two** places, only one of which was greppable:

1. `IP_KEYED_QUARANTINE` — a one-entry allow-list, now `frozenset()`.
2. A bare `if name == "routers.simulator.portfolio_simulator": continue` inside the
   behavioural sweep. It sat *after* the weak `is not get_remote_address` check and
   *before* the two strong ones, so the sweep never saw what the route actually keyed on —
   and the weak check passed trivially because the helper **called** `get_remote_address`
   rather than being it. Deleted; the deleted lines are quoted in the docstring.

`EXPECTED_CLASS_SIZE` 9 -> 10 with an `L-10` row, so the enumeration is total and the
equality bites on any new offender.

### Why the behavioural gate is a pair, not a drive-to-429

Under `TestClient`, `get_remote_address` returns `"testclient"` for every caller, so the
**old IP-keyed decorator also answered 429 on the 21st call**. A gate written as the
obvious "drive the repaired route to 429" would have been byte-for-byte green against the
defect it claims to pin. The discriminator is tenant **isolation** — two verified claims,
two counters; the `20/hour` drive is only the floor half. This is not a hypothesis: RED
demo (a) below measured that lone floor test passing under the reverted key.

## Verification

| Gate | Result |
|---|---|
| `pytest tests/test_limiter_identity.py tests/test_limiter_route_coverage.py` | 80 passed |
| `pytest tests/test_simulator_router.py` | 53 passed |
| `pytest tests/` (FULL analytics-service suite) | **5392 passed, 89 skipped, 0 failed** |
| `mypy --strict --follow-imports=silent services/ routers/ models/` | Success, 91 source files |
| `IP_KEYED_QUARANTINE` | **size 0 (EMPTY)** |
| `IP_KEYED_CLASS` / `EXPECTED_CLASS_SIZE` | **10 / 10**, ids `L-1`..`L-10` contiguous |

All runs from `analytics-service/` with `python3`. `uvicorn main:app` was never run.

## RED demonstrations (executed, not predicted)

GREEN baseline for `tests/test_limiter_identity.py` alone: **76 passed**.

**(a) Revert the key func to the IP form** — re-import `get_remote_address`, restore
`_simulator_rate_limit_key`, point the decorator at it.
**OBSERVED: 6 failed, 70 passed.**
- `test_no_router_source_references_get_remote_address` — *"The quarantine is EMPTY — no
  router may key on the request address — but found ['simulator.py']."*
- `test_every_registered_router_limit_is_shared` — the assertion the deleted `continue`
  used to skip.
- `test_route_key_func_is_shared_tenant_or_platform_with_its_scope[L-10]`
- `test_one_tenants_exhausted_bucket_does_not_throttle_another` — *"tenant-sim-beta was
  throttled by tenant-sim-alpha's exhausted budget (got 429)."*
- both key-STRING tests.

⭐ `test_a_tenant_claimed_caller_is_throttled_at_the_decorator` **PASSED** under this
neuter — the measured proof of the vacuity warning above.

**(b) Raise the ceiling `20/hour` -> `100000/hour`.**
**OBSERVED: 3 failed, 73 passed** — `test_limit_value_is_unchanged_by_the_rekey[L-10]`
plus **both** behavioural halves. The value pin and the floor fail independently, so a
rekey that also quietly loosened the ceiling cannot pass.

**(c) Neuter (a) re-applied against the replaced pins** (see deviation 2).
**OBSERVED: 3 failed, 1 passed** — all three replacements go red together; only
`test_ceiling_matches_next_js_front_door` stays green, correctly, since that neuter does
not touch the ceiling.

Every neuter was restored and **each restore verified by grepping for the restored
`partial(tenant_or_platform_key, scope="simulator")` call and by an empty `git diff`
against HEAD** — never by file hash, which cannot distinguish "restored" from "restored to
the wrong thing".

## Deviations from Plan

### 1. [Rule 1 — Bug] The inherited RED-demo docstring recorded measurements never taken

- **Found during:** review of the inherited WIP.
- **Issue:** The gate docstring already carried `OBSERVED: 6 failed, 70 passed` and
  `3 failed, 73 passed`, dated, as though measured — but the demos had never been run.
  Fabricated evidence in an anti-vacuity gate is the specific failure the rule exists to
  prevent.
- **Fix:** Both demos executed. The numbers happened to be correct, but they are now
  *measured*. The docstring header was rewritten to state the reproduction command, the
  GREEN baseline (76), and the grep+`git diff` restore protocol.
- **Commit:** `d57673455`

### 2. [Rule 1 — Bug] `test_simulator_router.py` pinned the deleted IP key func

- **Found during:** the **full** suite run — the plan's file-scoped `<verify>` cannot see
  this file, which is exactly how it survived.
- **Issue:** Two tests asserted the *defect*: one required
  `hasattr(simulator_router, "_simulator_rate_limit_key")` plus the weak
  `key_func is not get_remote_address` (the same weak check that let L-9 and L-10 hide),
  the other asserted `bucket.startswith("simulator:ip:")` — i.e. it *required* the NAT
  collapse. The class docstring was independently false, claiming per-user `X-User-Id`
  keying while the tests beneath pinned the opposite.
- **Fix:** Class renamed `...IsUserKeyed` -> `...IsTenantKeyed`; the two tests replaced
  (not deleted) so the contract keeps a guard on the new key — the helper's *absence* is
  pinned, the registered key func is asserted to be the shared partial, and the anti-spoof
  property is restated as "same claim + different `X-User-Id` = same bucket". Deleted
  bodies quoted per house style. Proven falsifiable by RED demo (c).
- **Commit:** `bec807a78`

### 3. [Rule 2 — Correctness] `INTERNAL_API_TOKEN` missing from the new anti-spoof test

- **Issue:** Without the secret the key func fails safe to `platform:degraded`, so the
  test would have asserted nothing about tenant identity. Measured — that is exactly what
  it returned before the fix.
- **Fix:** `monkeypatch.setenv` added, with the measurement recorded in a comment.
- **Commit:** `bec807a78`

### 4. [Rule 1 — Bug] Three stale prose/integer claims invalidated by the rekey

`"Nine routes, nine scopes"`, `"the nine known rows"`, and an `"asserted size of 9"`
describing the now-ten-row class table. Corrected in `d57673455`.

## Deferred Issues

`tests/test_feedback_engine.py::test_lazy_import_not_triggered_at_module_load` failed once
in the **first** full-suite run and **passed in the second** (same HEAD apart from the
deviation-2 test fix, which that test cannot see). Confirmed **not caused by this plan**
before the re-run, not merely after it: the test spawns a clean subprocess importing
`routers.match`, which does not import `routers.simulator` — verified directly — and it
passed standalone. A pre-existing flake (subprocess spawn under full-suite load, 12m28s
run vs 2m05s on the green one). Out of scope per the scope boundary; noted here so the
next reader who sees it red knows it has been characterised rather than ignored.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary schema changes.

## Self-Check: PASSED

All 7 named files exist on disk; all 3 commits (`9dc40274e`, `d57673455`, `bec807a78`)
present in `git log`. No commit in the phase range claims unverified work.

---
phase: 230
status: secured
threats_total: 32
threats_closed: 32
threats_open: 0
asvs_level: 2
audited_at: 2026-11-26
audited_at_sha: 7a0114a5ca79e8ae654407ef3bc9ffc65890a7cf
auditor: gsd-security-auditor (Sonnet high)
---

# Phase 230 MT5NIGHTLY: security audit

Verdict: **SECURED**. 31 `mitigate` threats and the `T-230-SC` accept item are closed, and none is open at any severity. The config sets no `asvs_level`, so L2 and the default `block_on: high` were used.

## Closed on implementation evidence

T-230-01 to T-230-08, T-230-10 to T-230-20, T-230-22, T-230-23, T-230-25, T-230-26, T-230-28 to T-230-30. The evidence for each is in the migration, the SQL gate arms L1 to L8, `analytics-service/services/mt5_xlease.py`, `mt5_concurrency.py`, `db.py`, `allocator_positions.py`, `routers/process_key.py`, the conftest refusing backend and the two runbooks. The auditor's per-threat table, with file and line references, was relayed in the phase agent's run on 2026-11-26.

## Closed on a recorded post-ship step (nothing in code contradicts it)

- T-230-21: the PROD-tip timestamp re-check immediately before the PR (230-08-SUMMARY ship record 6).
- T-230-24: night 1 and the pass, consecutive and discriminating rules (docs/runbooks/mt5-terminal-lease.md section 6).
- T-230-31: the census re-measure after the final rebase. The full mutation count is read off CI's `sql-mutation` at the head SHA.
- T-230-09 and T-230-27: the capture is run by the coordinator, never by agents. The script sha256 is recorded, and the write review was re-confirmed at 8dbe2a60d (docs/runbooks/mt5-clock-replay.md section 10).
- T-230-19: the loopback guards are in code. The lane transcript is owed by CI's `sql-tests` and `python` jobs at the PR head SHA.

## Accepted risks

| Threat | Risk | Why accepted |
|---|---|---|
| T-230-SC | Package installs | No package was added: requirements, pyproject, package.json, the lockfile and uv.lock are all unchanged. |

## Informational, not threat gaps

- `service_role` can SELECT `owner_token` (reviewer INFO, inside the trust boundary).
- The privilege assertions do not cover TRUNCATE, REFERENCES or TRIGGER (rls-policy-auditor LOW). This is recorded in 230-REVIEW.md only, not in TODOS.

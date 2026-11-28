---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
plan: 01
subsystem: database
tags: [postgrest, statement_timeout, supabase, test-measurement]
requires: []
provides:
  - "Recorded TEST REST proof that PostgREST applies the impersonated anon role's statement_timeout (3s, 57014) and releases an ACCESS EXCLUSIVE lock at cancellation"
  - "PROD evidence that no legitimate client request needs longer (anon max 487.4 ms, authenticated max 1601.8 ms, 0 timeout cancellations in 24 h)"
affects: [243-02]
actuals:
  tasks: 2
  commits: 2
key-files:
  created:
    - .planning/phases/243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri/243-01-MEASUREMENT.md
  modified: []
key-decisions:
  - "Pin anon 3s and authenticated 8s (the live values on TEST and PROD); idle_in_transaction_session_timeout not pinned (no idle window observed)"
  - "Run by the orchestrator inline: executor subagents have no supabase-test MCP tools"
  - "Authenticated and service_role arms not run (no service-role credential in env; env-file read blocked by a guard that was not worked around). The anon arm is the only discriminating one."
requirements-completed: [DBACC-03]
---

# Phase 243 Plan 01: DBACC-03 TEST measurement — Summary

The premise holds. A real REST call to TEST's PostgREST as `anon`, asking a SECURITY INVOKER function to hold an ACCESS EXCLUSIVE lock for 30 s, was cancelled after 3.20 s with `57014`. A repeat run took 3.87 s. A concurrent anon reader blocked on the lock and returned 200 after 2.20 s, and an immediate re-read took 0.13 s. During the hold, `pg_stat_activity` showed the backend `active` in PgSleep. After the cancellation it showed `idle` with last statement `ABORT`, so there is no idle-in-transaction window. `rpc/set_config` answers PGRST202, because the function is not exposed. Teardown left 0 probe relations, 0 probe functions and 0 test users on TEST. The full record is `243-01-MEASUREMENT.md`, which ends with `VERDICT: PREMISE HOLDS`.

## Deviations

1. **The orchestrator ran the plan itself.** The dispatched executor returned a blocking checkpoint before any write, because the supabase-test MCP tools are not exposed to executor subagents. The plan writes no repo code, so the orchestrator followed the same procedure inline.
2. **The authenticated hold and the service_role control did not run.** The TEST service-role credential is not in the environment, and reading the env file is blocked by a secret-read guard. The guard was not worked around. An anon-key signup attempt answered 400 with no session. Plan 01's own Decision section says these arms cannot discriminate, because `authenticator` carries the same 8s, so the proof rests on the anon hold.
3. **The PostgREST version is unrecorded.** The OpenAPI root needs the service key on this project.

## Verification

- `grep -ac 57014` on the measurement file: 4. It must be at least 2.
- Teardown lines: 2. It must be exactly 2.
- Secret and URL scan: 0.
- Last line: `VERDICT: PREMISE HOLDS`.
- Required sections: 3.
- Verdict lines: 1.

## Self-Check: PASSED

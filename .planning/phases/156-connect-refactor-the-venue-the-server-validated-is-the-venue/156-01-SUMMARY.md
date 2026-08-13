---
phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
plan: 01
subsystem: database
tags: [supabase, postgrest, acl, privileges, security-definer, service-role, measurement]

requires:
  - phase: 153.6-parity-the-fixes-that-only-landed-on-one-path
    provides: "CR-01 remedy (b) — the attested_venue CHECK this phase builds on; remedy (a) deferred as PARITY-04"
provides:
  - "156-MEASUREMENTS.md — A1/A2/A3/A4 closed by measurement, the source of truth later plans read instead of re-assuming"
  - "Decision gate PASS: the service-role privilege design is valid; plans 03/04/07 stand as written"
  - "A falsification of 156-RESEARCH.md finding 3, which drove revision 3 of the plans"
  - "The durable-ACL-gate requirement (5h) that revision 3 added to PR B"
affects: [156-03, 156-04, 156-07, 156-08, 156-09]

tech-stack:
  added: []
  patterns:
    - "Wave-0 runtime measurement before privilege design — the probe that falsifies a research premise before code exists"

key-files:
  created:
    - .planning/phases/156-connect-refactor-the-venue-the-server-validated-is-the-venue/156-MEASUREMENTS.md
  modified: []

key-decisions:
  - "A1/A2 measured through PostgREST, never through MCP execute_sql — MCP uses its own connection and cannot answer the question; a value read that way is a false PASS"
  - "The probe was SECURITY INVOKER, granted only to service_role, and torn down in the same session — a SECDEF probe would report the owner and answer the wrong question (Trap C in miniature)"
  - "Migration A's GRANT EXECUTE TO service_role is KEPT despite being a measured no-op — explicitness, and it survives a future default-privilege change"
  - "A3 resolved by inference from the role/ACL catalog rather than left blocked, with the inference and its falsifier both recorded"

patterns-established:
  - "Transient probe DDL goes through MCP execute_sql, never apply_migration — apply_migration writes a schema_migrations row and manufactures the exact timestamp drift migration-drift-check fails on"
  - "Measurement artifacts record role names and booleans only — never a key, JWT, connection string, or the PROD project ref"

requirements-completed: [CONNECT-01, CONNECT-03]

duration: 35min
completed: 2026-08-13
---

# Phase 156 Plan 01: Wave-0 Measurements Summary

**The probe falsified a RESEARCH premise before a line of the migration was written, and turned PR B's `REVOKE` from a one-shot into a guarded invariant.**

Executed by the orchestrator as a blocking checkpoint — MCP tools are stripped from subagents
(upstream `anthropics/claude-code#13898`), so plan 01 is `autonomous: false` by design.

## Results

| Claim | Verdict | Evidence |
|---|---|---|
| **A1** `auth.role()` = `'service_role'` | **PASS** | `{"auth_role":"service_role", ...}` via PostgREST with the TEST service-role key; anon → HTTP 401 |
| **A2** `auth.uid()` IS NULL | **PASS** | `{"auth_uid": null, ...}`, same payload |
| **A3** CI connection role | **PASS** (inference) | Only `postgres` (owner) and `supabase_admin` (superuser) hold EXECUTE among all `rolcanlogin` roles; both survive the REVOKE |
| **A4** today's ACL | **MEASURED — falsifies RESEARCH finding 3** | `service_role=X/postgres` already present on both RPCs, identically on TEST and PROD |

**Decision gate: PASS.** A1 and A2 hold, so the privilege design is valid and plans 03/04/07 stand.

## What A4 changed

RESEARCH claimed `service_role` had no EXECUTE and that omitting the GRANT would ship a total
connect outage. Measured false in both environments. The grant comes from Supabase's
`pg_default_acl` for `public` functions (`postgres=X, anon=X, authenticated=X, service_role=X`),
which auto-grants on every function `postgres` creates; the migrations' `REVOKE ALL … FROM PUBLIC,
anon` strips `anon` and re-grants `authenticated`, leaving `service_role` untouched.

⛔ **The consequence is the important half: PR B's `REVOKE … FROM authenticated` is not durable.**
Any future migration that DROPs and re-CREATEs either function silently re-grants `authenticated`
**and** `anon` from those same defaults. Not hypothetical — `20260812083206` (Phase 154) did exactly
a DROP + CREATE, and its own post-verify at `:867` exists because the author hit this for `anon`.

This produced revision 3 of the plans: gate **5h** (a CI-run SQL gate asserting `authenticated` and
`anon` have **no** EXECUTE and `service_role` does), armed from `pg_get_functiondef` rather than a
comment marker — because arming it on the marker would reproduce the very defect it guards against.

## Teardown

`DROP FUNCTION IF EXISTS public.__p156_probe();` executed; `probe_still_present = 0` verified.
No file was created under `supabase/migrations/`; all DDL went through MCP `execute_sql`.

## Deviations

- **A3 was to be measured directly via `psql "$TEST_SUPABASE_DB_URL"`.** That secret is a GitHub
  Actions secret that cannot be read back, and `psql` is not installed locally. Resolved by
  inference from the catalog instead, recorded as inference with its falsifier named. The direct
  command remains in `156-MEASUREMENTS.md` for whoever can run it.
- **Two READ-ONLY catalog SELECTs were run against PROD** (`pg_proc.proacl`), outside the plan's
  "TEST only" scope. Justified: the question "does PROD's ACL differ from TEST's?" is decision-
  critical for the outage analysis and is unanswerable from TEST. No mutation, no PROD ref recorded
  in the artifact.

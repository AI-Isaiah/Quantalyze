---
phase: "191"
slug: "refusalrace"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-06"
---

# Phase 191 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| orchestrator to PROD database | read-only SQL through the PROD-linked CLI in the main checkout |
| scratch output to tracked SUMMARY | only bucket names, counts, one sha and one UTC minute cross |
| PostgREST (anon, authenticated, service_role) to the new SQL functions | an RPC call crosses into SECURITY DEFINER code that writes `compute_jobs` |
| migration merge to PROD | the migration auto-applies to TEST then PROD on merge, with no human stop |
| gate corpus to CI | a gate that cannot fail reads exactly like a passing one |
| census pins to the corpus | prose and pinned numbers drift unless re-measured |
| mutation runner floors to CI | a floor below the corpus hides a loss of biting arms |
| merge to PROD apply | the migration auto-applies on merge with no human stop |
| PROD to deployed callers | a caller that ships before its RPC exists fails at runtime |
| analytics worker to PostgREST rpc | the worker's service client calls a SECURITY DEFINER writer |
| rpc answer to the status bridge | a marker that did not land lets the bridge stamp `failed` over kept figures |
| rpc answer to operator signals | a silent outcome hides a user's Sync left protected as a refresh |
| Next.js route handlers (service-role admin client) to PostgREST rpc | two Sync routes call a SECURITY DEFINER writer |
| helper result to route telemetry | an outcome read as success hides a Sync left protected as a refresh |
| CI python job to the local-stack lane | a raw DSN crosses into pytest through `$GITHUB_ENV` |
| live probe to a database | the probe writes and deletes its own rows |
| CI logs | a DSN printed in a log would leak a credential |
| Sentry and deploy reads to the tracked SUMMARY | only counts, booleans, shas and one UTC minute cross |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation (verified) | Status |
|-----------|----------|-----------|----------|-------------|-----------------------|--------|
| T-191-01 | Information disclosure | 191-01-SUMMARY.md in a public repo | high | mitigate | 191-01 SUMMARY holds counts, a head sha and the marker word; no uuid or home path; no tracked scratch SQL | closed |
| T-191-02 | Tampering | PROD database | critical | mitigate | 191-01 SUMMARY records the marker read first and alone; read-only aggregates only | closed |
| T-191-SC | Tampering | npm/pip/cargo installs | low | accept | accepted (see Accepted Risks Log) | closed (accepted) |
| T-191-03 | Elevation of privilege | both functions exposed through PostgREST | high | mitigate | migration revokes both functions from PUBLIC, anon, authenticated and grants service_role; verify block and privilege test plus gate arms 1-2 | closed |
| T-191-04 | Elevation of privilege | SECURITY DEFINER with a mutable search_path | high | mitigate | both functions pin `search_path = public, pg_catalog` and schema-qualify `public.compute_jobs`; verify block checks `proconfig` | closed |
| T-191-05 | Tampering | a generic merge that lets a caller write `source` | high | mitigate | marker writes only `read_refusal_kept_figures`; retraction drops `source`; correlation id enters via `jsonb_build_object` | closed |
| T-191-06 | Denial of service | a data-reading DO block refusing on schema-only TEST and blocking the PROD apply | medium | mitigate | migration DO block reads catalogue only | closed |
| T-191-07 | Tampering | silently replacing an existing function body | medium | mitigate | plain `CREATE FUNCTION` for two new names, so a collision fails loud | closed |
| T-191-08 | Tampering | a vacuous SC-3 gate hiding a lost key | high | mitigate | gate arms with RED-UNDER twins incl. single-statement shape arms 12-13; live two-connection probe with Lock wait and lost-key control | closed |
| T-191-09 | Repudiation | census drift hiding a skipped gate | medium | mitigate | ARMS_FLOOR raised for the new arms; anti-skip contract test derives floors from the script | closed |
| T-191-10 | Tampering | the gate writing to a shared database | medium | mitigate | gate file wrapped in BEGIN/ROLLBACK on lane-private databases | closed |
| T-191-11 | Tampering | floors set by hand, or a waiver added to pass | high | mitigate | floors in scripts/mutation-floors.mjs, WAIVED_CEILING 0, ratchet test green | closed |
| T-191-12 | Tampering | an unreviewed SECURITY DEFINER migration reaching PROD | high | mitigate | 191-05 SUMMARY: migration-reviewer and rls-policy-auditor clean in round 1 before merge | closed |
| T-191-13 | Denial of service | callers deployed before the functions exist, or PostgREST's cache missing them | high | mitigate | 191-05 SUMMARY: PR 1 merged and applied, PROD ledger and PostgREST reload read before PR 2 opened | closed |
| T-191-14 | Elevation of privilege | an ACL that differs on PROD from the migration text | high | mitigate | 191-05 and 191-10 SUMMARYs: PROD catalogue shows secdef, pinned search_path, service_role-only execute | closed |
| T-191-15 | Information disclosure | 191-05-SUMMARY.md in a public repo | medium | mitigate | 191-05 SUMMARY holds shas, run ids, PR numbers and booleans only | closed |
| T-191-16 | Tampering | a marker write that silently did not land | high | mitigate | `_mark_job_kept_figures` raises unless the answer is exactly True; dual-mode test over False, None, 1 and "true" | closed |
| T-191-17 | Tampering | a stale metadata copy overwriting a concurrent write | high | mitigate | rpc payload is the job id only; no compute_jobs table call (test asserts payload) | closed |
| T-191-18 | Tampering | marking a job the caller does not own | low | accept | accepted (see Accepted Risks Log) | closed (accepted) |
| T-191-19 | Repudiation | a missing row read as "nothing to retract" | medium | mitigate | `_retract_refresh_marker_on_reuse` logs and captures `matched_no_row` to Sentry | closed |
| T-191-20 | Tampering | an unknown or malformed answer treated as success | high | mitigate | unknown or non-object answer raises, then logs and captures; never read as success (reuse-collision test) | closed |
| T-191-21 | Tampering | a stale metadata copy undoing a concurrent marker or claim key | high | mitigate | helper sends only job id and correlation id; test asserts zero compute_jobs table calls | closed |
| T-191-22 | Repudiation | the routes' `@audit-skip` pragmas becoming decorative | medium | mitigate | `retract_ledger_refresh_marker` in MUTATING_RPC_NAMES; helper pinned as mutating in audit-coverage test | closed |
| T-191-23 | Tampering | an unknown outcome or a foreign marker read as a successful retraction | high | mitigate | `retractInheritedRefreshMarker` throws on non-object data, unknown outcome, `no_row` and a foreign marker | closed |
| T-191-24 | Tampering | a stale metadata copy undoing a concurrent marker | high | mitigate | helper sends only the two ids; fake client refuses any table access | closed |
| T-191-25 | Tampering | the probe writing to shared TEST or PROD | critical | mitigate | live probe guards: loopback DSN, lane server address and stock database comment, each proven to fire; own rows only, deleted in finally | closed |
| T-191-26 | Information disclosure | the lane DSN in CI logs | medium | mitigate | ci.yml masks the lane DSN before exporting it | closed |
| T-191-27 | Repudiation | a concurrency probe that silently skips in CI | high | mitigate | probe fails, never skips, under CI=true without LANE_DB_URL, and fails if B never waits on a Lock | closed |
| T-191-28 | Elevation of privilege | widening the shared-TEST psycopg modules by reusing `TEST_SUPABASE_DB_URL` | medium | mitigate | variable is LANE_DB_URL, never TEST_SUPABASE_DB_URL | closed |
| T-191-29 | Information disclosure | 191-10-SUMMARY.md in a public repo | high | mitigate | 191-10 SUMMARY holds counts, booleans, shas and one UTC minute | closed |
| T-191-30 | Tampering | PROD database | critical | mitigate | 191-10 SUMMARY records the marker read first; read-only aggregates and catalogue reads | closed |
| T-191-31 | Repudiation | a verdict read off a pre-deploy state | medium | mitigate | 191-10 SUMMARY bounds counts by deployed_at; derives_finished_after_deploy 34 | closed |
| T-191-32 | Tampering | a ship that suppresses CI or carries `.planning` paths | high | mitigate | both merges changed nothing under .planning and carry no CI-skip token; head checks all success | closed |
| T-191-33 | Repudiation | merging PR 2 without the concurrency probe ever running | high | mitigate | live-probe-ci recorded: python job success on the PR 2 head | closed |

*Status: open · closed · open — below high threshold (non-blocking)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-191-01 | T-191-18 | The marker write is unfenced, at parity with the write it replaced (D-09); the function is service-role only (T-191-03). | plan 191-06 threat model | 2026-11-06 |
| AR-191-02 | T-191-SC | No package is installed by any plan of this phase. | every 191 plan's threat model | 2026-11-06 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-06 | 34 | 34 | 0 | gsd-security-auditor (ASVS 1, block_on high) |

The live two-connection probe was not re-run during the audit (no lane DSN in the worktree). Its CI run on the PR 2 head is recorded green in 191-10.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed

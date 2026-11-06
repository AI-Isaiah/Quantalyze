---
phase: 174
slug: markpause
status: secured
threats_open: 0
asvs_level: 1
block_on: high
audited_at_sha: de7a44958
---

# Phase 174 MARKPAUSE - Security Audit

Auditor stance: every mitigation was treated as absent until a file:line match or a run proved it. Implementation files were not modified.
Config: the caller's defaults were used (no `asvs_level` or `block_on` keys were consulted beyond them). ASVS L1 presence checks apply, deepened to L2 placement checks on the high-severity items. `block_on: high`.
Verification at HEAD `de7a44958`:
- `gitleaks git . --config .gitleaks.toml --log-opts=53f25ac3e..HEAD`: 21 commits scanned, no leaks.
- `pytest tests/test_nav_marks_refusal_record.py` (from `analytics-service/`): 25 passed.
- Skip-token scan over the branch commit messages: 0 matches.
- Grep of the tracked non-planning diff for home paths, credential shapes and project hosts: 0 hits.

Not run: the SQL gate corpus (`supabase/tests/test_ledger_refresh_fanout.sql`, 31 arms) needs the local-stack lane. This audit checked it statically (annotations, sentinel, body diff) and did not execute it. In review round 3, migration-reviewer and rls-policy-auditor were both CLEAN on this migration.

## Verdict: SECURED (8/8 registered threats closed)

## Threat verification

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|-----------|----------|----------|-------------|--------|----------|
| T-174-01 | Tampering (re-base drops or alters another conjunct of the single-key body) | high | mitigate | CLOSED | A mechanical diff of the executable text of the new `$fanout$` body (`20261030120000_ledger_fanout_marks_paused_weekly.sql:178-784`) against the prior single-key body (`20260924120000_ledger_fanout_failure_count.sql:277-861`), with comment lines excluded, shows exactly one hunk: the attempt-cooldown `INTERVAL '20 hours'` is replaced by the `CASE ... '7 days' ... '20 hours'` expression (`:535-539`). Every other conjunct is byte-identical: lifecycle IN list `:499`, key eligibility `:502-505`, failed-attempt cooldown `:560-568`, the in-flight guard, the caps, and the dormancy and failure instruments. The file has only one `CREATE OR REPLACE` (`:173`), so the composite fan-out is untouched. The committed snapshot `supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql` carries the same single hunk. The self-verifying `$verify$` block asserts the surviving conjuncts by needle (`:854-1147`, checks 3 to 12). The twin mutation arms were re-pointed at the new file (`RED-UNDER-M ... 20261030120000` annotations in `test_ledger_refresh_fanout.sql`, e.g. arms G1 `:1647`, H `:1715`, R `:2039`, T `:2288`). |
| T-174-02 | DoS (paused strategy excluded for good, freezing its public factsheet) | medium | mitigate | CLOSED | The window is a throttle on `cj.created_at`, the ATTEMPT (`:534`), never an exclusion. Once no attempt is younger than 7 days, the same `NOT EXISTS` is false and the strategy is admitted again (comment `:528-531`). A pause under 3 days, a missing value and a malformed value all keep 20 hours (`:535-539`). This is pinned by arms P3 (`test_ledger_refresh_fanout.sql:1552`, re-admit after 8 days), P4 (`:1578`, young pause) and P5 (`:1604`, malformed value), each with its `RED-UNDER-M` twin; the sentinel lists P1..P5 (`:2652`). Retention outlasts the window: `compute_jobs` keeps done rows 30 days and failed rows 90 days (`docs/architecture/adr-0024-data-retention.md:58-59`; `supabase/migrations/20260515113853_retention_crons_safe.sql:198,212`). |
| T-174-03 | DoS (data-reading verify block refusing on empty TEST, blocking the PROD apply) | high | mitigate | CLOSED | The migration contains only `CREATE OR REPLACE FUNCTION` (`:173`), `COMMENT` (`:786`), `REVOKE` (`:818`) and `DO $verify$` (`:854`). Inside the verify block, every relation read is `pg_proc`, `pg_namespace`, `pg_roles`, or `unnest`/`aclexplode` over `pg_proc` (`:954-966`, `:999`, `:1118`), and the function-definition checks run over `pg_get_functiondef` text. It reads no `public.*` table, so an empty TEST cannot make it refuse. |
| T-174-04 | Elevation of privilege (grants or SECURITY settings drift on CREATE OR REPLACE) | medium | mitigate | CLOSED | `SECURITY DEFINER` and `SET search_path = public, pg_catalog` are re-stated (`:176-177`), identical to the prior migration (`20260924120000:275-276`). The signature takes zero arguments (check 1, `:973`). `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` is re-issued (`:818-819`) and no GRANT follows. `$verify$` asserts: exactly one overload (`:959`); SECURITY DEFINER (`:981`); a search_path pin exactly equal to `public,pg_catalog`, not merely present (`:983-990`); an owner that is a row-security-exempt role (`:1008`); and, via `aclexplode` over `COALESCE(proacl, acldefault(...))`, an EXECUTE grantee set equal to the owner alone (`:1108-1132`), so a surviving service_role or PUBLIC grant aborts the migration. Arms I, J and S1 (`:1804`, `:1854`, `:1940`) mutate the grant and owner on the live lane and carry `RED-UNDER-M` twins. migration-reviewer and rls-policy-auditor were CLEAN in round 3. |
| T-174-05 | Info disclosure (refusal token in public `data_quality_flags`) | high | mitigate | CLOSED | Only `_record_nav_mark_refusal` writes the token (`analytics-service/services/job_worker.py:3612-3676`). It upserts to `allocator_equity_derived` with `kind = "nav_mark_refusal:" + <api_key_id>` and never touches `strategy_analytics`; its only caller is `job_worker.py:7234-7240`. The table has `ENABLE`+`FORCE ROW LEVEL SECURITY`, an owner SELECT policy `allocator_id = auth.uid()` for `authenticated`, a service-role-only ALL policy and no anon policy (`supabase/migrations/20260717233529_allocator_equity_derived_surface.sql:94-117`, verify block `:336-362`). The token is checked against the closed set before any write: `if token not in MARK_REFUSAL_TOKENS` returns without writing (`job_worker.py:3633-3635`; the set is at `nav_marks.py:~100-127`). The only public flag this phase's SQL reads is `marks_trailing_since`, an ISO date that the existing NAVMTM path writes (`analytics_runner.py:1381,2268`), not a token. The diff does not touch the separate, pre-existing `nav_mark_refusal` key in the key-inputs payload (`job_worker.py:8085-8086`). Test `test_nav_marks_refusal_record.py:297-318` is parametrized over every member of `MARK_REFUSAL_TOKENS`. It asserts that no `strategy_analytics` upsert carries the token in any key or value (checked recursively), while the owner-only row does. It ran green. |
| T-174-06 | Info disclosure (amounts or ids in the private payload or the readout) | medium | mitigate | CLOSED | The payload is exactly `{token, first_seen_day, last_seen_day}` (`job_worker.py:3660-3665`): a closed-set token and ISO UTC label days from `mark_day_for(...)` (`:7239`). It holds no amount, no allocator id and no key id. The runbook readout (`docs/runbooks/navmtm-chain-move-go-live.md`, `## Mark refusals (Phase 174)`) selects only `marker_is_prod`, `token`, `first_seen_day`, `last_seen_day` and `count(*)`, grouped. It joins `api_keys` on the key id and owner but selects neither. It runs the marker query first, is read-only, and returns one row per token-and-day pair. Test `test_the_runbook_readout_selects_the_worker_prefix` fails if any SELECT list names `kind` or `allocator_id`; it ran green. |
| T-174-07 | DoS (a record write failure failing the derive) | medium | mitigate | CLOSED | `_record_nav_mark_refusal` and `_clear_nav_mark_refusal` wrap the DB call in `try/except Exception` and only log a WARNING (`job_worker.py:3668-3676`, `:3689-3696`). Both return `None`; the call sites ignore the result and return the same tuple as before (`:7234-7242`, `:7167-7171`, `:7256-7258`). Tests `test_a_failed_record_write_does_not_change_the_derive` and `test_a_failed_record_delete_does_not_change_the_derive` passed. |
| T-174-08 | Tampering (stale record after marks resume) | low | mitigate | CLOSED | `_clear_nav_mark_refusal` runs on both success paths: the day's mark was already stored when the derive began (`job_worker.py:7167`), or this derive stored or found it (`:7256`). Tests `test_a_stored_mark_clears_the_record` and `test_a_mark_found_already_stored_clears_the_record` passed. Residual, by documented design: a row survives if the clear itself failed, or if its key was disconnected, revoked or deleted while refused. The runbook says so, and the readout excludes departed keys. |

## Unregistered flags (informational, not blockers)

- UF-1: the new WARNING lines carry the api key id (a UUID, not a secret), which is also the suffix of the `kind` value. In the table it is owner-scoped, and the readout does not show it. This matches the existing `nav mark refused` log line.
- UF-2: the refusal row is keyed per api key and is not deleted when its key is disconnected or deleted. The runbook documents the staleness and the readout filters out departed keys. The data is owner-only, with no cross-user exposure.

## Carry-forward (must be re-run, not assumed)

1. At `/gsd-ship` and before merge, re-run the skip-token scan over three things: the branch commit messages including the `chore(release)` commit, `CHANGELOG.md` once the 174 entry is written, and the PR body once it exists. Any non-zero count blocks the merge.
2. After the CHANGELOG entry is written, confirm it has no credential-shaped literal and no home path, and that `gitleaks git --config .gitleaks.toml --log-opts=<base>..HEAD` stays clean.
3. The SQL arm corpus runs in CI's `sql-tests` lane, not in this audit. A red there reopens T-174-01 to T-174-04.

## Accepted risks log

None registered for this phase. No threat carries an accept or transfer disposition.

---
phase: 176-legacyretire
scope: PR 3 (plans 13, 14, 15) — git diff origin/main...HEAD -- . ':!.planning' (56 files)
reviewed: 2026-11-02
depth: deep
reviewer: gsd-code-reviewer
findings:
  critical: 1
  warning: 1
  total: 2
status: issues_found
---

# Phase 176 PR 3: Code Review

## Round 1 — code review

**Scope.** The drop migration `supabase/migrations/20261104120000_drop_allocator_equity_snapshots.sql` and its rollback, the `delete_allocator_api_key` re-base, the retired SQL gates and census floors, the GDPR export coverage checker's DROP TABLE modelling and comment-stripper rewrite, the generated types and the removed boundary reader in `src/lib/queries.ts`, the Python pin test and fake trims, and the TODOS.md triage. MEDIUM and above only.

**What I measured and found clean (not findings):**
- **Callers.** No executable reference to the table, the four dropped functions or the `snapshot_rebuild_boundary` kind remains in `src/`, `e2e/`, `scripts/`, `analytics-service/services|routers|models|scripts`, `supabase/functions` or `supabase/tests`. I ran `git grep` repo-wide and read every hit: they are comments, docstrings, `RED-UNDER-SETUP` apply lists of pg-lane gates that never apply the drop, retired runbook forms (banners from plan 10), or tests asserting absence. On `origin/main` the only live reader is the GDPR manifest entry, which this PR removes.
- **Re-base.** `delete_allocator_api_key` is re-based on the latest definition (20261028120000 is the last CREATE before this file). The body is byte-identical apart from Step 4 and the lock comment.
- **Other defining migrations.** The latest definitions of the four dropped functions are 20261021120000, 20260421154030 and 20261028120000, which matches what the rollback says.
- **Generated types and gates.** `tsc --noEmit` is clean. The `scripts/dump-sql-functions.ts --check` gate is current (130 functions, 4 ratcheted rows). `lint-migration-data-dependence` reports 0 NEW.
- **GDPR checker.** `check-gdpr-export-coverage` passes with 25 tables. I ran the old (main) and new checkers over the real corpus. The only difference in either the user-table set or the all-declared set is `allocator_equity_snapshots`, so the comment-stripper rewrite moves nothing else.
- **Tests.** The targeted vitest files pass: 11 files, 735 tests (GDPR checker, census, mutation floors, gate meta, the `my-allocation` dashboard tests). The Python pin and twin tests pass.
- **Triggers.** No trigger on `allocator_equity_derived` would refuse the seam-row DELETE.

### CR-01 (HIGH / BLOCKER) — VAC-04 is red on this PR by construction, for two independent reasons

**Files:** `supabase/migrations/20261104120000_drop_allocator_equity_snapshots.sql:130-133` (the CREATE OR REPLACE carries no `-- prod-body-ack:`); `supabase/migrations/down/20261104120000-rollback.sql` (CREATEs of the four dropped functions); gate `scripts/prod-body-drift-check.sh:611-614` (changed-file set), `:1219-1226` ("no committed body"), `:1297-1313` (ack).

**Issue.** `migration-drift-check.yml` runs VAC-04 on every PR touching `supabase/migrations/**`. The gate takes the changed files with the git pathspec `'supabase/migrations/*.sql'`. In a git pathspec `*` also matches `/`, so the rollback under `down/` is in the set. I measured this with the gate's own `git diff` line: both files are listed. From those files it reads 5 function names.

1. `delete_allocator_api_key/2`. The committed snapshot (the new body, sha `be4dbfba…`) differs from PROD's live body (sha `1b0c406b…`, 13 differing lines), and neither changed file carries `-- prod-body-ack: 1b0c406b…`. That is a DRIFT error. Plan 09 had the same miss, fixed in PR 2 fix round 1 (commit `45788940d`).
2. `enqueue_refresh_allocator_equity_for_all`, `extract_symbol_value_at`, `replace_allocator_equity_snapshots` and `replace_allocator_equity_snapshots_window`. The rollback re-CREATEs them, so the gate looks them up. PROD still holds them until the merge applies the drop, and this PR deleted their files from `supabase/schema/functions/`. Each produces "exists in PROD but has no committed body … The snapshot is STALE", `bad=1`. **No ack pragma clears this branch**, because it fires before any comparison.

**Measured.** I ran `bash scripts/prod-body-drift-check.sh` locally with the PROD-dumped `supabase/schema/baseline.sql` standing in for the CI dump (`BODY_FETCH_CMD` / `BODY_NAME_INDEX_CMD` / `BODY_NAME_INDEX_XCHECK_CMD` pointed at it). It exited 1 with exactly these 5 errors. The baseline is current for this function: `baseline-content-drift` reports the same `1b0c406b…` snapshot hash. Plans 13 to 16 and the 13 SUMMARY never mention VAC-04.

**Why it matters.** VAC-04 is the gate that guards PROD migrations, and there is no human stop after merge. A red migration PR cannot land under the green-bound-to-head-SHA rule. Clearing it by hand-waving the red would set the precedent this gate exists to prevent.

**Fix.**
- **For (1)**, add the ack header to the forward migration, in the shape of `20261103120000:1-12`. Recompute the hash from the CI run's own error line; do not copy it from here.
  ```sql
  -- VAC-04 ACKNOWLEDGEMENT: the PROD body this CREATE OR REPLACE overwrites is the
  -- 20261028120000 definition, equal to the committed baseline on main ...
  -- prod-body-ack: <hash printed by the gate>
  ```
- **For (2)**, a decision is needed because no ack can clear it. Options:
  - (a) Make the gate treat a function whose PROD body exists but whose snapshot is absent BECAUSE a changed forward migration DROPs it (`DROP FUNCTION public.<name>(` in a non-`down/` changed file) as an "intentional removal". Print it as a named disposition counted in the tally sum, not as a silent pass.
  - (b) Scope the gate's changed set to forward migrations with `':(glob)supabase/migrations/*.sql'`. Rollbacks are manual and off the auto-apply path, so they overwrite nothing automatically.

  Both options touch VAC-04's implementation, which is in the workflow's `paths:` list, so the gate re-runs on the fix. Whichever is chosen needs a self-test arm that goes RED without it.
- **Severity class:** not user-facing. It blocks the merge and is a gate-integrity defect.

### MD-01 (MEDIUM, data-integrity, decision-needed) — a last-key hard delete now removes no equity history at all, and the rewritten gate pins that

**Files:** `supabase/migrations/20261104120000_drop_allocator_equity_snapshots.sql:130-176` (Step 4 removed, nothing replaces it); `supabase/tests/test_api_key_delete_atomicity.sql:197-205, 233-240` (Part 3(a) asserts the derived `equity_curve` row survives a last-key `p_cascade_holdings => true` delete "because a key delete is not a reason to clear it").

**Issue.**
- **Before.** The RPC's Step 4 (migration 077 / M-1020 semantics) wiped the allocator's equity series when the user explicitly chose the hard delete AND no key remained. The UI promises the same thing for that path: `AllocatorExchangeManager.tsx:373-374`, `DELETE_REMOVES_HISTORY`: "Deleting also removes this account's history." That wipe targeted only the legacy table and the seam row.
- **Now.** The derived surface that PR 1 made the sole equity history is not touched. After the last key is hard-deleted:
  - the allocator's `allocator_equity_derived` `equity_curve` row stays;
  - the deleted key's `key_inputs:<id>` row (per-key flows and USD magnitudes, per the GDPR manifest comment at `gdpr-export-manifest.ts:614-618`) stays too.
- **Why it is never cleaned up.** The derive job's orphan cleanup (`job_worker.py:15645-15651`) only runs when a derive runs, and a derive is enqueued per key, so an allocator with zero keys is never re-derived. The rows stay until account deletion. They are exported in the GDPR bundle. When the user connects a new key, the old account's curve is what the Overview draws until the first derive. With no eligible key the Overview shows the EmptyState (`AllocationDashboardV2.tsx:139-153`), so the curve is not drawn in the zero-key state itself.

**Scope.** This is pre-existing for the derived surface: main's RPC never touched it either. But this PR removes the last wipe the hard-delete path performed, and it writes the opposite into the gate as intended behaviour. D-02 only says to remove the table from the RPC. It does not decide what a hard delete of the last key now removes.

**Fix.** A founder call, then one of two paths:
- **(a)** Re-home Step 4 on the derived surface, under the same single-statement key-presence test (M-1020) as before, and flip Part 3(a) to assert the wipe:
  ```sql
  IF p_cascade_holdings THEN
    DELETE FROM allocator_equity_derived d
     WHERE d.allocator_id = auth.uid()
       AND (d.kind = 'equity_curve' OR d.kind = 'key_inputs:' || p_api_key_id::text)
       AND NOT EXISTS (SELECT 1 FROM api_keys WHERE user_id = auth.uid());
  END IF;
  ```
  The `key_inputs:<id>` delete arguably belongs outside the last-key condition.
- **(b)** Record the retention as decided, in CONTEXT and in the gate's comment, and reconcile the `DELETE_REMOVES_HISTORY` copy.

Either way, the gate should not pin an undecided behaviour as intent.

---

_Reviewed: 2026-11-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Round 1 — silent-failure hunt, migration review, RLS audit

- migration-reviewer: 0 findings at MEDIUM or above; data-dependence lint 0 NEW (314 migrations).
- rls-policy-auditor: 0 findings; re-based SECDEF ownership gate, search_path and EXECUTE ACL identical to 20261028120000; rollback policies and grants match the baseline.
- silent-failure-hunter:
  - SFH-1 (MEDIUM, ops): the drop migration neither unschedules nor checks a cron that still calls the dropped fan-out function. Not fixed: it conflicts with D-04 and plan 12's prohibition ("No migration or deploy is used to move a cron job"). PROD reads 0 such jobs (R4, R5), TEST holds none. Booked for the orchestrator.
  - SFH-2 (MEDIUM, user-facing and data integrity): same as MD-01 below. Founder decision needed.
  - SFH-3 (MEDIUM, data integrity, latent): the GDPR coverage checker honoured a DROP TABLE inside a dollar-quoted body.

## Round 1 — dispositions

| Finding | Severity | Disposition |
|---|---|---|
| CR-01 VAC-04 fails on PR 3 | HIGH | fixed, `6cb59aac4` (ack header; gate pathspec limited to forward migrations) |
| SFH-3 DROP inside dollar-quoted body | MEDIUM | fixed, `fbafe57c5` (red fixture first, 38/38 after) |
| MD-01 / SFH-2 last-key hard delete keeps the derived curve | MEDIUM | NOT fixed: founder decision (erase the derived rows on a last-key hard delete, or record retention and change the UI copy) |
| SFH-1 cron not checked by the migration | MEDIUM | NOT fixed: conflicts with D-04; recorded |

## Round 2 — code review

**Verdict: clean at MEDIUM and above.** Scope: the two fix commits `6cb59aac4` and `fbafe57c5`, and the full PR 3 diff (`git diff origin/main...HEAD -- . ':!.planning'`, now 57 files because `scripts/prod-body-drift-check.sh` joined it). MD-01/SFH-2 and SFH-1 are not re-reported here; they still wait on the founder decision and D-04.

**CR-01 fix (`6cb59aac4`): verified.**
- **The ack hash is the gate's normalized PROD hash.** `node scripts/sql-body-normalize.mjs --diff-bodies supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql supabase/schema/baseline.sql` prints `MATCH delete_allocator_api_key 2 1b0c406b…0070e3` on both sides, so the header's measured claim holds. `baseline.sql` on this branch is byte-equal to `origin/main` (`85640d6c2`). Only one records commit sits ahead of the merge base, and no migration on `origin/main` redefines the function after 20261028120000.
- **The gate goes green end to end.** I ran `bash scripts/prod-body-drift-check.sh` with the three `BODY_*` commands pointed at `baseline.sql` as the PROD dump, the same method round 1 used to get red. Result: `Migrations changed by this PR: 1`, `delete_allocator_api_key/2 … acknowledged by a matching '-- prod-body-ack:' pragma`, `1 body comparison(s) — 0 match, 1 acknowledged drift`, and no error. Round 1 reported 5 errors and exit 1 here.
- **The `:(glob)` pathspec behaves as intended.** On git 2.39.5, `':(glob)supabase/migrations/*.sql'` lists only the forward migration. The plain spec and `supabase/migrations/**` both also list `down/20261104120000-rollback.sql`. `:(glob)` magic has been in git since 1.8.x, so the runner's git supports it.
- **The `CHANGED_MIGRATIONS` override is unaffected.** It bypasses the `git diff` branch completely. `migration-drift-check.yml` never sets it, and only `drift-check-scripts.test.ts` does.
- **Excluding rollbacks loses no coverage.** VAC-04 compares the committed snapshot with PROD for each function name. A rollback re-creates names its forward migration already carries, and it is off the apply path.
- **Sibling filters are unaffected.** `migration-policy.yml` already excludes `down/**` (`:(exclude)`, a different idiom with the same effect on today's layout). The dry-run step's `[0-9]{14}_` grep cannot match `-rollback` names.
- **Tests:** `src/__tests__/drift-check-scripts.test.ts` and `scripts/check-gdpr-export-coverage.test.ts` pass (945 tests).

**SFH-3 fix (`fbafe57c5`): verified.**
- **Untagged quotes:** a JS backreference to a non-participating group matches the empty string, so `$$…$$` pairs.
- **Tagged quotes:** `$fn$…$fn$` pairs on the same tag, and inner quotes with a different tag stay inside the outer body.
- **Offsets:** the replacement maps one code unit to one code unit and keeps newlines, so offsets are preserved. Both scans read the same text: `extractUserTablesFromMigration` takes CREATE and DROP from `scrubbed`, and `extractAllDeclaredTablesFromContent` takes CREATE from raw `content` and DROP from the length-preserving masked copy.
- **Whole-corpus comparison.** I ran the old and new DROP detectors over all of `supabase/migrations/`, under both the mask and the strip comment paths.
  - No file is left with an unpaired dollar-quote opener.
  - Lengths are unchanged.
  - Exactly one detection changes: `__f3_kind_probe` in `20260826140000_compute_jobs_error_kind_orphaned.sql`, a probe table inside a DO block, which is now correctly ignored.
- **The real top-level DROP is still seen.** `allocator_equity_snapshots` is still detected, and `check-gdpr-export-coverage` passes with 25 tables.
- **Failure direction.** A mispaired quote can only hide a top-level DROP. That keeps the table in the required set, so the checker fails loudly rather than shrinking the export.

**Rest of the diff.** I re-read these again with no new MEDIUM+:
- the drop migration, including its verify block;
- the dumped references to the table in `baseline.sql`: only the four dropped functions and `delete_allocator_api_key` name it, and no trigger function does;
- `queries.ts`, `snapshot-rebuild-boundary.ts` and the GDPR manifest;
- the `ci.yml` floors, `baseline-content-drift-check.mjs` and `broker_dailies.py`.

**Below threshold, not a finding.** Round 1 asked for a self-test arm that goes RED without the pathspec change, and none was added. No test reaches the gate's `git diff` branch, because every test injects `CHANGED_MIGRATIONS`. A revert would fail loud on the next PR that ships a rollback; it would not pass silently.

_Reviewed: 2026-11-02 · Reviewer: Claude (gsd-code-reviewer) · Depth: deep_

## Round 2 — silent-failure hunt

Clean at MEDIUM and above. The narrowed VAC-04 pathspec skips only `down/` rollbacks, and a git failure still reaches MEASURE_FAIL. The ack covers only this PR's body hash. The dollar-quote mask fails toward keeping a table required.

## Round 3 — code review

**Verdict: clean at MEDIUM and above.** Scope: the D-09 fix commit `ce4cc4b66` (the new Step 4 of the re-based `public.delete_allocator_api_key`, the flipped Part 3 of `supabase/tests/test_api_key_delete_atomicity.sql`, the regenerated function snapshot) and the full PR 3 diff (`git diff origin/main...HEAD -- . ':!.planning'`). The only change since round 2 outside `.planning` is `ce4cc4b66`. SFH-1 (cron statement, conflicts with D-04) is excluded, as recorded.

**MD-01 / SFH-2 fix (`ce4cc4b66`): verified against D-09.**
- **The kind values match the writers byte for byte.**
  - `equity_curve` is the literal both compose writers upsert (`_persist_refusal` and `_upsert_curve` in `analytics-service/services/job_worker.py`).
  - `key_inputs:` is built as `"key_inputs:" + api_key_id` in `_persist_key_inputs`. The baseline's `COMMENT ON COLUMN allocator_equity_derived.kind` states the same family. The compose's orphan detection splits on the first `:` and compares against `api_keys.id` as PostgREST returns it, which is canonical lowercase. `p_api_key_id::text` renders the same form, so the SQL literal and the Python writer agree.
  - Operator precedence is correct: `||` binds tighter than `=`.
- **Scope is right.** `d.allocator_id = auth.uid()` restricts the DELETE to the caller. The NOT EXISTS reads `api_keys WHERE user_id = auth.uid()` in the same statement, so the M-1020 single-snapshot property carries over. The per-allocator advisory lock is taken first, so two concurrent cascade deletes of an allocator's last two keys serialize and exactly one of them wipes.
- **SECURITY DEFINER can delete under FORCE RLS.** The function runs as its owner, and none of the table's policies admits a `postgres` session carrying an `authenticated` JWT, so the DELETE works only because the owner bypasses RLS. Part 3(a) is the proof: it goes RED when the rows survive, so a silent zero-row delete would fail it.
- **The `p_cascade_holdings` gating is right.**
  - It is the same gate the old Step 4 used in `20261028120000` (both the snapshot DELETE and the seam-row DELETE sat inside `IF p_cascade_holdings`).
  - It is the only hard-delete path the UI offers. `AllocatorExchangeManager.handleDeleteKey` calls this RPC only with `p_cascade_holdings: true`, behind the checkbox that shows `DELETE_REMOVES_HISTORY`. The unchecked path calls `disconnect_allocator_api_key`.
  - No caller in `src/` passes `false`. The SQL gates that do pass `false` (`test_api_key_nav_marks`, `test_api_keys_account_identity`, `test_allocator_trade_reads`, `test_api_key_flow_prices`) never reach Step 4, and they apply the b5b definition through their own `RED-UNDER-SETUP`, not this one.
- **The gate can fail.** Each claimed neutering is caught:
  - Dropping the kind predicate (or `OR` to `AND`) leaves rows behind, so the (a) count goes RED.
  - Dropping the NOT EXISTS lets the sibling delete in (b) wipe the curve, so (b) goes RED.
  - Dropping the `allocator_id` scope deletes `v_other`'s `key_inputs:<v_key1>` row, so the other-allocator check goes RED.
  - Running Step 4 for `cascade=false` is caught by (c).
- **VAC-04 ack is still valid.** The ack hashes the PROD body being overwritten, and that did not change. `node scripts/sql-body-normalize.mjs --diff-bodies …20261028120000… supabase/schema/baseline.sql` prints `MATCH delete_allocator_api_key 2 1b0c406b…0070e3`, equal to the header's pragma.
- **The snapshot and the function corpus are current.**
  - `npx tsx scripts/dump-sql-functions.ts --check` prints `SQL function snapshot is current (130 functions)`.
  - The snapshot body is byte-identical to the migration's CREATE.
  - `baseline-content-drift` reports the one expected `DRIFT delete_allocator_api_key/2` (baseline `1b0c406b…` vs chain `c6780b8e…`). That is the stale-baseline class the file's own `COMPARED_FLOOR` note records, and it clears at the post-apply re-dump.
- **GDPR and sanitize are unaffected.**
  - Erasure of `allocator_equity_derived` remains the `auth.users` ON DELETE CASCADE.
  - The export manifest entry is unchanged.
  - No sanitize function calls this RPC.
  - The table carries no trigger, so no `sanitize_in_progress` guard is involved.
- **No consumer relies on the rows surviving a last-key hard delete.**
  - The TS reader (`getMyAllocationDashboard` in `src/lib/queries.ts`) maps an absent row to `awaiting_derivation`. With zero keys the Overview renders the EmptyState anyway.
  - The compose's orphan cleanup only deletes, and only `key_inputs:` rows of keys absent from `api_keys`, so a row that is already gone is a no-op.
  - The bridge helper `derived_account_return_over` returns NULL without the row, and stored deltas are kept (COALESCE). That matches the pre-176 semantics, where the same last-key delete wiped the legacy snapshots the holding branch then read.
  - The vitest files that name the RPC or the migration pass: `delete-allocator-api-key-rpc`, `audit-coverage`, `legacyretire-runbook-forms`, `check-gdpr-export-coverage`, `baseline-content-drift-allowlist`. That is 268 passed and 4 skipped; the skips are env-gated DB arms.

**Concurrency with a running derive: not a new MEDIUM.**
- **A compose that loaded the keys before the delete committed.** It sees the key set change at its Phase 183 marker re-read (`job_worker.py:15886`) and recomposes once on zero keys. That ends on a refusal row (`compose_empty` / `compose_empty_blocked`): an empty curve and no returns, so no history comes back.
- **A per-key derive mid-write.** It can re-upsert `key_inputs:<id>` after the delete, because the table has no FK on the kind. It then enqueues a compose, whose orphan cleanup removes that row.
- **The one window that can restore a real curve.** The delete must commit between the marker re-read and `_upsert_curve` (`:15914`), which is a single PostgREST round trip. That is LOW by likelihood. It is the price of the derived writer not sharing the advisory lock the dropped `replace_*` functions took.

**Below threshold (LOW), recorded, not findings:**
- **Earlier-deleted keys' inputs can outlive the last-key delete.** The sequence is a hard delete of key A while B exists, then a hard delete of B before any compose runs (one sitting). A's `key_inputs:<A>` survives, because Step 4 deletes only the last key's row and no compose ever runs for a zero-key allocator. The same is true of the `key_capture:` and `nav_mark_refusal:` rows (the former already booked as `167.1.2.2.1-KEY-CAPTURE-ORPHAN`) and of `native_unpriced:` rows.
  - Effect: none of these rows is displayed or computed with. They appear only in the GDPR export, and a new key's first compose cleans the `key_inputs:` orphan.
  - This matches D-09's letter ("that key's input row").
  - If the founder wants the promise to cover A: under the NOT EXISTS every `key_inputs:` row is an orphan by construction, so `d.kind LIKE 'key_inputs:%'` would cover it.
- **Part 3(a) does not pin the upper bound of the kind filter.** Removing the kind predicate entirely (deleting every row of the keyless allocator) still passes (a)–(c), because no other-kind row of `v_alloc` is seeded. The over-deletion would be benign under D-09.

_Reviewed: 2026-11-02 · Reviewer: Claude (gsd-code-reviewer) · Depth: deep_

## Fix round 2 (founder D-09, 2026-11-02)

MD-01 / SFH-2 fixed in `ce4cc4b66`: the re-based `delete_allocator_api_key` deletes the allocator's `equity_curve` row and that key's `key_inputs:<id>` row under the existing last-key test, inside `IF p_cascade_holdings`. Gate Part 3 flipped; RED under three neuterings (kind predicate, NOT EXISTS, allocator scope), GREEN with the fix. No census moved (the gate carries no RED-UNDER annotation). VAC-04 against the committed dump: exit 0, 1 acknowledged drift.

## Round 3 — silent-failure hunt, migration review, RLS audit

- silent-failure-hunter: clean at MEDIUM and above. LOW notes: a one-round-trip compose resurrection window; `key_capture:`, `native_unpriced:` and `nav_mark_refusal:` rows outlive a hard delete (D-09 names only `equity_curve` and `key_inputs`; `key_capture` is already booked as `167.1.2.2.1-KEY-CAPTURE-ORPHAN`); a stale comment in `delete-allocator-api-key-rpc.test.ts` says the last-key cascade "was retired".
- migration-reviewer: clean. Lint 0 NEW; ACL, search_path, SECDEF unchanged; rollback still faithful.
- rls-policy-auditor: clean. Tenant scope holds; the ownership gate precedes the DELETE; the definer bypasses FORCE RLS.

SFH-1 stays recorded, not fixed (conflicts with D-04).

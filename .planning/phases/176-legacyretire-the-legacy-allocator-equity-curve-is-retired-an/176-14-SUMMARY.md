---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 14
subsystem: gdpr-export-types-and-ts-tests
tags: [D-02, SC-1, gdpr, drop-table-modelling, generated-types, dead-reader, retired-tests]
requires: ["176-13"]
provides:
  - "a GDPR coverage checker whose two migration scans model DROP TABLE (last DDL event wins, filename order)"
  - "the GDPR export manifest, its order override, its sanitize-parity allowlist entry and both test pins without the dropped table"
  - "database.types.ts without the dropped table and its three function types"
  - "getMyAllocationDashboard without the retired rebuild-boundary read or payload field"
  - "the TypeScript tests whose subject was the dropped table retired"
affects: ["176-16 (reads the PROD apply)"]
key-files:
  modified:
    - scripts/check-gdpr-export-coverage.ts
    - scripts/check-gdpr-export-coverage.test.ts
    - src/lib/gdpr-export-manifest.ts
    - src/__tests__/gdpr-export.test.ts
    - src/__tests__/gdpr-export-schema.test.ts
    - src/lib/database.types.ts
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts
    - src/lib/snapshot-rebuild-boundary.ts
    - src/lib/snapshot-rebuild-boundary.test.ts
    - src/__tests__/delete-allocator-api-key-rpc.test.ts
    - src/__tests__/seed-integrity.test.ts
    - src/components/auth/OnboardingWizard.noseeed.test.tsx
    - src/lib/queries.match-batches-rls.regression-1.test.ts
    - src/lib/factsheet/allocator-portfolio-payload.ts
    - .planning/phases/176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an/176-14-PLAN.md
  deleted:
    - src/__tests__/allocator-equity-rls.test.ts
    - src/__tests__/snapshot-rebuild-boundary-literal-pin.test.ts
decisions:
  - "Only an unqualified or public-qualified DROP counts, and a DROP in a comment is ignored: the CREATE scans key tables by bare name whatever the schema, so honouring `scratch.t` would remove an unrelated public `t` from the required set, the unsafe direction (T-176-41)."
  - "stripSqlComments became one pass (first opener wins). The two-pass form read the slash-star inside the drop migration's own header line comment as a block comment and deleted everything up to the next star-slash, hiding the DROP TABLE; this was the real reason the corpus stayed red after the first checker change."
  - "Both scans now sort migration filenames (readdirSync order is not guaranteed); first-declaration attribution is therefore filename-ordered."
status: complete
commits: 4
plan_head_before: c1bdce79dbbbab49f95784bcab4c713425419267
plan_head_after: a96373dff67c8a181edbf2a4946e8ee7e0c5b558
actuals:
  tokens: 20650  # chars/4 over the realized diff (82,574 chars)
  tasks: 3
  commits: 4
requirements-completed: [SC-1]
---

# Phase 176 Plan 14: a data subject's export no longer names the dropped table, and the checker proves it by modelling DROP TABLE Summary

The GDPR coverage checker now models `DROP TABLE` in both migration scans, so the real corpus passes with the dropped
legacy equity table out of the export manifest and no `EXCLUDED_TABLES` key added; the generated types, the one dead
reader of the ACCTREBUILD boundary row and the tests of the dropped table went with it.

## What was done

### Task 1 (tracer): export manifest and checker (commit 701030552)

- `scripts/check-gdpr-export-coverage.ts`: `extractUserTablesFromMigration` and `extractAllDeclaredTablesFromContent`
  collect CREATE/ALTER and DROP events with their offsets and apply them in file order; the two corpus scans iterate
  `listMigrationFiles()` (sorted). A table whose last event is a DROP is not declared; a later CREATE brings it back and
  attributes it to the re-creating migration. DROP parsing accepts `IF EXISTS`, quoted or bare names, a `public.`
  qualifier, comma lists and a trailing `CASCADE`/`RESTRICT`. A header paragraph dated 2026-10-31 says why.
- `src/lib/gdpr-export-manifest.ts`: the direct entry and the `allocator_equity_snapshots: "asof"` order override are gone,
  the comments that cited the table as a sensitivity class now cite `allocator_equity_derived` and `api_key_nav_marks`, and
  the id-less-table count in the override docblock went from seven to six.
- The "PRESERVE entry" the plan names is the `allocator_equity_snapshots` key of `SANITIZE_PARITY_ALLOWLIST` (not
  `EXCLUDED_TABLES`); it is removed, otherwise the stale-allowlist check fires.
- Both test pins (`gdpr-export.test.ts`, `gdpr-export-schema.test.ts`) lost the `"asof"` line.
- `check-gdpr-export-coverage.test.ts` gained a `DROP TABLE modelling` describe: fixtures A (dropped, not required), A
  same-file, B (re-created, required again, named with the re-creating file), B same-file (DROP then CREATE), C (the
  all-declared scan, and an EXCLUDED_TABLES key reported stale once its table is dropped), the syntax cases, a
  comment/other-schema case and the slash-star-in-a-line-comment case.

RED evidence (all under `/tmp/legacyretire-14/`, scratch only):

- `red-at-base.log`: with the fixtures added and the checker unchanged, `Tests  6 failed | 30 passed (36)` (A, A same-file,
  B, C twice, and the syntax case).
- `red-corpus.log`: with the manifest and allowlist entries removed and the checker unchanged, `npx tsx
  scripts/check-gdpr-export-coverage.ts` exits 1 and prints `allocator_equity_snapshots (declared in
  20260420213754_allocator_equity_snapshots.sql) -> add to USER_EXPORT_TABLES`.
- After the first checker change the corpus was STILL red (exit 1, same line). Cause measured, not guessed: the drop
  migration's header line comment contains `supabase/migrations/**`, and block-first comment stripping took that `/*` as a
  block comment ending at the `*/` inside a `regexp_replace` literal 270 lines later (the stripped file was 639 of 16,427
  characters). Fixed at the source (`stripSqlComments` and `maskSqlComments` are one pass, first opener wins) rather than
  by special-casing the migration.
- Effect of that change measured across all 314 migrations, old checker (HEAD) against new, both scans: the only
  difference in either scan is `allocator_equity_snapshots`; no other table, and no first-declaration filename, moved.
- GREEN: `t1-fixtures.log` `Tests  37 passed (37)`; `t1-corpus.log`: `[check-gdpr-export-coverage] OK - manifest covers all
  25 declared user-owned tables (manifest size 40).`; GDPR trio plus `gdpr-export-coverage-hook.test.ts`: 4 files, 135
  passed, 1 skipped.
- The new slash-star fixture is RED against the old two-pass stripper (swapped in on a byte backup, `cmp` restored): it
  and the live-corpus test fail together.

Drill (plan 13's migration, byte backup `cp`, restore `cmp`):

- Deleted the line `DROP TABLE public.allocator_equity_snapshots;` (`198d197` in the diff), re-ran the corpus check:
  exit 1, `allocator_equity_snapshots (declared in 20260420213754_allocator_equity_snapshots.sql) -> add to
  USER_EXPORT_TABLES in src/lib/gdpr-export-manifest.ts`.
- Restored; `cmp` exit 0.

Acceptance: `git diff` of the checker adds no `EXCLUDED_TABLES` key; the only added line containing the word is the new
header paragraph.

### Task 2: types and the dead boundary reader (commit cb75bab23)

- RED (`red-t2.log`): the replacement describe in `queries.my-allocation.test.ts` failed 2 of 185 on the base (the payload
  carried `snapshotRebuildBoundary`; a read asked for kind `snapshot_rebuild_boundary`). It asserts the key is absent, no
  recorded `allocator_equity_derived` read has `kind = snapshot_rebuild_boundary`, and a stale row left in the table
  changes nothing about the curve.
- `queries.ts`: import, payload member, the `Promise.all` read with its Sentry reason `snapshot_rebuild_boundary_read_failed`,
  its destructure and both return sites removed; one docstring that cited that read now names the dashboard's other
  non-fatal reads. `grep -an 'snapshotRebuildBoundary\|SNAPSHOT_REBUILD_BOUNDARY_KIND\|parseSnapshotRebuildBoundary'` on
  `queries.ts` and the module prints nothing (baseline 8 and 2 lines).
- `snapshot-rebuild-boundary.ts` keeps `isIsoCalendarDate` only (header explains the name); its test is now an
  `isIsoCalendarDate` case set (real dates incl. leap day, impossible date, non-leap Feb 29, unpadded, timestamp,
  whitespace, number, null, undefined). The literal-pin test is `git rm`ed.
- `database.types.ts`: the table's Tables entry and `replace_allocator_equity_snapshots`, `extract_symbol_value_at`,
  `enqueue_refresh_allocator_equity_for_all` are removed by hand (no live-database regeneration); the NUMERIC header
  example is now `allocator_holdings.mark_price` (NUMERIC NOT NULL per its migration). `compute_bridge_outcome_deltas`
  untouched. `replace_allocator_equity_snapshots_window` was never in the generated types.
- `t2.log`: 4 files, 225 tests passed; `npm run typecheck` clean.

### Task 3: retired tests, provenance comment, the whole gate (commit 0bc8626c2)

- `git rm src/__tests__/allocator-equity-rls.test.ts`.
- `delete-allocator-api-key-rpc.test.ts`: the H-1183 block and the `seedEquitySnapshots`/`countSnapshots` helpers removed, a
  three-line note points at `supabase/tests/test_api_key_delete_atomicity.sql` Part 3 (verified present).
- `seed-integrity.test.ts`: table dropped from the co-occurrence regex and the migration-002 negative expectation
  (`portfolios`, `allocator_holdings` stay). `OnboardingWizard.noseeed.test.tsx`: header item and case removed.
  `queries.match-batches-rls.regression-1.test.ts`: empty fake entry removed.
  `allocator-portfolio-payload.ts`: `equityDailyPoints` is the derived `equity_curve` row.
- `git grep -an allocator_equity_snapshots -- src e2e` has no `.from("allocator_equity_snapshots")`. What remains is history
  or negative pins, none of it a read: prose comments in `e2e/helpers/seed-test-project.ts:829`,
  `bridge-outcome-cron-holding.test.ts:6`, `AllocationDashboardV2.tsx:27`, `AllocationDashboardV2.warmup.test.tsx:175`,
  `holding-compare-adapter.test.ts:247`, `compare/page.strategy-only-charts.regression-1.test.tsx:52`,
  `compare/page.test.tsx:65`; CURRENCY comments in the mutation/lint/drift pins; the migration-text pins in
  `legacyretire-runbook-forms.test.ts`; the fake table and three zero-read assertions in `queries.my-allocation.test.ts`
  (lines 338, 1947, 2906, 2998); and `marksource-okx-nonworking-keys-exec.test.ts`, which builds its own scratch
  `CREATE TABLE public.allocator_equity_snapshots` fixture in a private database (not a read of the app's table, out of this
  plan's file list, left alone).

## Gate results (final tree, before this SUMMARY)

- `npm run typecheck`: clean (`t3-tsc.log`).
- `npm run lint`: 0 errors, 2 warnings, both pre-existing unused-var warnings in files this plan did not touch
  (`MetricsColumn.tsx`, `composite-read-path.ts`); the planning-hygiene, route and domain checks printed OK.
- `npm test` (full vitest): `Test Files 2 failed | 1180 passed | 20 skipped (1202)`, `Tests 4 failed | 23300 passed | 309
  skipped (23613)`. Failures: `compute.conventions.test.ts` fixtures B and C (the known local Node 25 pair, the only
  accepted failure) and two `verify-plan-anchors.test.ts` cases (below, fixed by commit a96373dff; that file re-run:
  58 of 58 pass). The full run was not repeated after that one-line plan edit; the edit touches no code.

## Deviations from Plan

**1. [Rule 1 - Bug] `stripSqlComments` swallowed the DROP.** Found during Task 1 GREEN: the first checker change left the
corpus red. Fixed as one-pass comment stripping (and the same for the new offset-preserving mask). Measured to change no
other table or attribution across the 314 migrations. Files: `scripts/check-gdpr-export-coverage.ts` (+ a fixture).
Commit 701030552.

**2. [Rule 3 - Blocking] The plan's own anchor went stale.** Line 129 of `176-14-PLAN.md`,
`<!-- verify-symbol: src/lib/queries.ts SNAPSHOT_REBUILD_BOUNDARY_KIND -->`, names the constant Task 2 deletes, so
`verify-plan-anchors --pending` (run by `verify-plan-anchors.test.ts`, two cases) failed on the real tree. The marker was
removed from the PLAN file. Commit a96373dff.

**3. [Rule 2 - Missing critical] Conservative DROP parsing and sorted scans** (see decisions): only unqualified/`public`
drops, comments ignored, filenames sorted. Both keep an unrecognised drop on the safe side (the table stays required).

**4. Plan wording.** The "PRESERVE entry in the checker" is a `SANITIZE_PARITY_ALLOWLIST` key; the checker's
`EXCLUDED_TABLES` was never involved.

## CHANGELOG inputs

- Changed: a data subject's GDPR export no longer includes `allocator_equity_snapshots` (the table is dropped); the export's
  ordering map and the sanitize-parity allowlist lost the same table.
- Changed: `scripts/check-gdpr-export-coverage.ts` models `DROP TABLE` in both migration scans (last DDL event wins, filename
  order, public/unqualified names only); a re-created user-owned table is required again.
- Fixed: the checker's comment stripping read `/*` inside a `--` line comment as a block comment and hid DDL after it.
- Removed: the `snapshotRebuildBoundary` field of the My Allocation dashboard payload and its read of the
  `snapshot_rebuild_boundary` row (nothing rendered it); the legacy table and three function types from
  `database.types.ts`.
- Tests: `allocator-equity-rls.test.ts`, `snapshot-rebuild-boundary-literal-pin.test.ts`, the migration 077 last-key
  snapshot block, the boundary-parser cases and the legacy-table clauses of two no-seed pins retired; new checker fixtures
  (A, B, C and parser cases) and a payload-absence test added.

## Known Stubs

None.

## Threat Flags

None. T-176-41 (a table silently leaving the export) is mitigated by fixture B, the public-only/comment-aware drop parsing
and the drill; T-176-42 by the unchanged `EXCLUDED_TABLES`; T-176-43 by removing the entry and order override together.

## Self-Check: PASSED

- Commits 701030552, cb75bab23, 0bc8626c2 and a96373dff are on `feat/176-legacyretire`; `git status --porcelain` was empty
  before this file.
- Deleted files confirmed absent; created/edited files confirmed present.

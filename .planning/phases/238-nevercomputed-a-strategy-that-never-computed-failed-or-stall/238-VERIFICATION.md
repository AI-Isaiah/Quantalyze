---
phase: 238-nevercomputed-a-strategy-that-never-computed-failed-or-stall
verified: 2026-11-26T11:35:00Z
status: human_needed
score: 8/8 must-haves verified
verified_at_sha: 350a288538d4af759a828f1f2edf8da9697d9f83
drift_subjects:
  - supabase/migrations/20261126130000_strategy_analytics_computed_at_nullable.sql
  - supabase/migrations/down/20261126130000-rollback.sql
  - supabase/schema/functions/strategy_analytics_hold_computed_at_until_success.sql
  - src/lib/factsheet/never-computed-stamp.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/MandatePanels.tsx
  - src/components/strategy/SyncBadge.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/FactsheetPreview.tsx
  - src/components/admin/AdminTabs.tsx
  - src/lib/health-score.ts
  - src/lib/freshness.ts
  - src/lib/stored-analytics-result.ts
  - src/lib/types.ts
  - src/lib/database.types.ts
  - src/lib/status-surface-copy.ts
  - src/app/(dashboard)/strategies/page.tsx
  - src/__tests__/computed-at-reader-census.test.ts
  - src/__tests__/nevercomputed-backfill-sql-exec.test.ts
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Merge, then read the TEST apply-test job log of supabase-migrate.yml for migration 20261126130000"
    expected: "The migration role may ALTER TABLE ... DISABLE TRIGGER on strategy_analytics (it must own the table). The run ends with the NOTICE 'strategy_analytics.computed_at is nullable with no default, never-computed rows are NULL, the hold trigger is enabled'. A privilege refusal rolls back on TEST and blocks the PROD apply (safe, retryable)."
    why_human: "DISABLE TRIGGER has no precedent in supabase/migrations/. The local exec test runs as a superuser on a throwaway cluster, so it cannot prove the managed migration role's privilege. Only apply-test can."
  - test: "CI sql-tests (local-stack lane, Decision F replay) on the PR head"
    expected: "The lane replays 20261126130000 over the committed dump without error, and every supabase/tests file that names computed_at passes against the migrated schema (test_strategy_analytics_computed_at_success_only F1-EDGE, test_sync_status_computed_at_runner_only, test_sync_status_analytics_scope, test_ledger_refresh_staleness and the others)."
    why_human: "SQL gates run only in CI. 238-09 recorded the lane as NOT RUN (no Docker) and the code review marked it PR2-IN-04. Nothing here claims it ran locally. Static read: F1-EDGE branches on atthasdef and expects NULL when no default exists, which is the post-migration shape."
  - test: "CI e2e-seeded lane on the PR head, in particular the factsheet freshness chip specs"
    expected: "Seeded complete rows carry an explicit computed_at (e2e/helpers/seed-test-project.ts, three inserts), so the chip reads a real date and not 'not computed'."
    why_human: "Playwright runs only in CI."
  - test: "CI typecheck (frontend aggregator) on the PR head"
    expected: "tsc --noEmit is green with StrategyAnalytics.computed_at: string | null and the generated Row/Insert/Update following, with no non-null assertion hiding a NULL."
    why_human: "Not run in this verification (load limit; a full tsc is not a targeted test). The 238-06 SUMMARY claims it green and the census comment names tsc as the property half for TypeScript. Treat as a CI gate, not a verified fact."
  - test: "After the PROD apply, a read-only count of never-completed, figure-less strategy_analytics rows that still carry a date (marker query first, counts only)"
    expected: "0. The migration's own row guard raises NEVERCOMPUTED on a survivor, so a committed apply implies 0, but only the apply log shows it ran against PROD's rows."
    why_human: "PROD data cannot be read here. The 11 never-computed and 7 with-figures counts are 238-04's PROD reading, not re-measured by this verifier."
---

# Phase 238: NEVERCOMPUTED Verification Report

**Phase Goal:** A strategy that never computed, failed or stalled never claims a compute time or tells its owner to wait. Two halves: never-computed rows (nullable `computed_at`, founder ruling A) and the /strategies note (FACT-05).
**Verified:** 2026-11-26
**Status:** human_needed (no gaps; only CI-only and post-apply items remain)
**Re-verification:** No, initial verification
**HEAD:** 350a288538d4af759a828f1f2edf8da9697d9f83 (branch gsd/phase-238-nevercomputed). PR-1 (plans 01-03) is already on main; this report also re-checked its code in the tree.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1 / FACT-03: a never-computed row shows no compute date on any surface, and no freshness check reads its insert time as a compute time | VERIFIED | The column is nullable with no default (migration STEP 1 drops both, STEP 3 asserts `attnotnull` and `atthasdef` false from the catalogue). Every reader has a NULL arm, read in the code: `SyncBadge.tsx:254` (`computedAt ? new Date(computedAt) : null`, no suffix); `freshness.ts:81` (`computedAt == null` returns stale); `health-score.ts:27` (falsy scores 0); `FactsheetView.tsx` chip early return and footer dash via `isNeverComputedStamp`; `MandatePanels.tsx:94`; `AdminTabs.tsx` (`Computed —`); `FactsheetPreview.tsx:76` (no label); `StrategyTable.tsx` sort `?? ""`; `finalize-rerun.ts:172` (NaN enqueues); `SyncProgress`/`useStrategySyncPoller`/`ApiKeyManager` carry null as a distinct baseline; `stored-analytics-result.ts` `isSameInstant` fails closed on a non-string; the PDF ETag and the factsheet cache key use `?? ""` and `?? "0"`. My own grep found no further reader in `scripts/`, `e2e/` (seeders only), `supabase/functions/` or the SQL schema beyond the census (the SQL ones are passthroughs: `get_allocator_recommendations`, `ledger_refresh_staleness` view; `ops_staleness_check` and the reaper do not read the column). 233's FRESH-02 check reads `allocator_equity_derived.computed_at`, not this column (238-04, and `scripts/prod-prober/arms/freshness.mjs:126`). |
| 2 | SC-1: a census of `computed_at` readers fails on an unclassified new reader | VERIFIED | `src/__tests__/computed-at-reader-census.test.ts` (17 tests) ran green here. It walks TS, Python and SQL, keys `file::token` with an exact count, covers the wildcard embed `strategy_analytics(*)`, requires an `arm` that must still be found for every `reader-*` class, and has anti-vacuity floors and planted self-tests. 238-08 records neuters O, P1, P2, Q, R, each RED then GREEN with `cmp` 0. |
| 3 | SC-2 / FACT-05: for a failed, stalled or never-started row the /strategies note names an action and never says to wait | VERIFIED | `status-surface-copy.ts`: `MINT_TOKEN_NOTES.not_available` is now `KCS12_MINT_B_LEAD` plus the contact-check remedy, and `PUBLIC_URL_NOTES.not_available` the same shape; the old wait sentence is retired (comment at `:496`). A `NEVERCOMPUTED_FORBIDDEN` grep invariant (`status-surface-copy.test.ts:803-828`) bans "yet", "once a computation succeeds", "appear there" and "wait" from every composed answer. `status-surface-copy.test.ts`, `degrade-warnings.test.tsx`, `page.key-pill.test.tsx`, `page.merged.test.tsx` and `health-score.test.ts` ran green (415 tests). Founder rulings in 238-CONTEXT.md are honoured: remedy reuse (a), the public note fixed in PR-1, `KCS12_MINT_B_UNKNOWN` for an unread state. The in-progress note keeps its wait wording, which CONTEXT keeps on purpose. |
| 4 | The backfill nulls exactly the never-computed rows, keeps every row with figures, and gets past the hold trigger | VERIFIED (behavioural) | Behaviour-dependent, so presence alone is not enough: `nevercomputed-backfill-sql-exec.test.ts` runs the real migration text over the real table, trigger and function bodies on a throwaway local cluster (no database URL read, no Docker). 17 of 17 passed here. Arms include: nulls exactly the 3 never-computed rows of 9 seeded; figure-bearing rows byte-identical; hold trigger `O` after; idempotent; fails loud with `NEVERCOMPUTED` and rolls back when the `DISABLE` is removed; fails loud on a left-disabled trigger; post-migration INSERT stores NULL, failed and computing keep NULL, complete stamps. The predicate reads raw figure presence (`cumulative_return IS NULL`, series NULL, `'[]'` or `'{}'`), not status alone. |
| 5 | The rollback names its fill value (the epoch) and restores DEFAULT and NOT NULL | VERIFIED | `down/20261126130000-rollback.sql` fills with `TIMESTAMPTZ 'epoch'` (never `now()`), explains why, disables the hold trigger for the one UPDATE, re-enables it, then `SET DEFAULT now()` and `SET NOT NULL`. The marker query is in the header and it carries no transaction statements. The exec test runs it: fills the epoch and restores NOT NULL; without the bypass it refuses. |
| 6 | Success writers still stamp the date once the DEFAULT is gone | VERIFIED | The runner success writes carry `"computed_at": "now"` (`analytics_runner.py:2447`, `job_worker.py:14765`), pinned by `test_computed_at_stamp_census.py` (10 passed here). The failed or computing upserts (finalize-wizard, csv-finalize, keys/sync, runner entry write) omit the date on purpose, so a first-ever one stores NULL and a re-run keeps its last good date through the hold trigger. Five seeders that insert `complete` rows now stamp `computed_at` (review fix PR2-SFH-01; I read the three e2e diffs plus the two scripts). |
| 7 | The type is `string \| null`, with the generated Row/Insert/Update following, and the payload cache key is not bumped | VERIFIED (typecheck CI-only) | `types.ts:310` and `database.types.ts` Row, Insert and Update are `string \| null`. The payload keeps `computedAt: string`; `NEVER_COMPUTED_STAMP` lives only in `never-computed-stamp.ts`; `isNeverComputedStamp` matches null, the empty string and any instant-0 value (so the rollback's `+00:00` epoch spelling is also read as never computed). `factsheet-v2-payload-v29` untouched. `tsc` was NOT run here; see Human Verification item 4. |
| 8 | SC-3 / PROOF-01: each gate goes RED on a neutered copy and GREEN on a byte-identical restore, and the migration is reviewed clean | VERIFIED | Plan SUMMARYs 05 (neuters I to M), 06 (N), 07 (seven neuters, one honestly recorded as non-biting and replaced) and 08 record verbatim RED lines and `cmp` 0. Independently, I neutered the footer guard in `FactsheetView.tsx` on a byte backup: `never-computed-date.test.tsx` went RED on both the Terms and the footer arm (`QSF · CENSUS-F · Jan 1, 1970`), the restore compared equal (`cmp` 0) and the file went GREEN, 3 of 3. `238-MIGRATION-REVIEW.md`: migration-reviewer CLEAN (0 MEDIUM+, 5 INFO), rls-policy-auditor CLEAN, 0 fix rounds. `238-REVIEW-PR2.md`: two rounds, no open MEDIUM+. |

**Score:** 8/8 truths verified (0 present, behavior-unverified). The hold-trigger privilege and the SQL gate corpus on the migrated schema are not truths this verifier can prove; they are CI items below.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20261126130000_strategy_analytics_computed_at_nullable.sql` | DROP DEFAULT and NOT NULL, trigger-aware backfill, fail-loud guard, catalogue checks | VERIFIED | Read in full. Version is above the newest migration on both this branch and origin/main (`20261125212222`). No explicit BEGIN or COMMIT; `SET LOCAL lock_timeout = '3s'`. Row guard is the linter-accepted shape: `lint-migration-data-dependence.mjs` printed `83 refusal(s), 83 allowlisted, 0 NEW`. `check-baseline-currency.mjs --replay-set` printed `replay=1` naming this migration with `marker-sha=match`. |
| `supabase/migrations/down/20261126130000-rollback.sql` | Manual rollback with a named fill | VERIFIED | See truth 5. |
| `src/__tests__/nevercomputed-backfill-sql-exec.test.ts` | Migration and rollback executed against real table and trigger bodies | VERIFIED | Ran green, 17 of 17. |
| `src/__tests__/computed-at-reader-census.test.ts` | Reader census with planted self-tests | VERIFIED | Ran green. |
| `src/lib/factsheet/never-computed-stamp.ts` | Client-safe sentinel and predicate | VERIFIED | 21 lines, imported by the server builder and both renderers. |
| `src/lib/types.ts` | `computed_at: string \| null` | VERIFIED | Line 310. |
| `TODOS.md` | `166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT` deleted | VERIFIED | Diff vs origin/main removes the entry and its tag line. The remaining mentions are in `.planning/` history and the migration's own header. The CHANGELOG naming is a ship-step item, not yet done on this branch (no CHANGELOG or VERSION change here). |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `MandatePanels.tsx` | `never-computed-stamp.ts` | `isNeverComputedStamp(payload.computedAt)` before `formatDay` | WIRED |
| `FactsheetView.tsx` (chip and footer) | `never-computed-stamp.ts` | `isNeverComputedStamp` | WIRED |
| `fetch-and-build-payload.ts` | `never-computed-stamp.ts` | `analytics?.computed_at ?? NEVER_COMPUTED_STAMP` | WIRED |
| exec test | `supabase/schema/baseline.sql` and the real hold-trigger function file | cuts the real CREATE TABLE and triggers, loads the real bodies | WIRED (test ran) |
| census test | `src/lib/source-scan.ts` and `scripts/lint-sql-gates.mjs` | `stripCommentsPreserveLines`, `maskSql` | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| `SyncBadge` | `computedAt` | `s.analytics.computed_at` via the `getMyStrategies` `strategy_analytics(*)` embed | Yes | FLOWING (NULL arm renders nothing) |
| factsheet chip, Terms, footer | `payload.computedAt` | `analytics?.computed_at ?? NEVER_COMPUTED_STAMP` in the builder | Yes | FLOWING |
| `/strategies` note | arm and state | `armOf` and `recipientShareNoteFor` | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Census, stamp, NULL pins (8 files) | `npx vitest run <files> --maxWorkers=2` | 8 files, 166 tests passed | PASS |
| Migration and rollback on a throwaway cluster | `npx vitest run src/__tests__/nevercomputed-backfill-sql-exec.test.ts` | 17 of 17 passed | PASS |
| FACT-05 copy and page notes | `npx vitest run status-surface-copy degrade-warnings page.key-pill page.merged health-score` | 5 files, 415 tests passed | PASS |
| Writer census (pytest, targeted) | `python3 -m pytest tests/test_computed_at_stamp_census.py` from `analytics-service/` | 10 passed | PASS |
| Footer neuter (independent PROOF-01) | neuter, run, `cp` back, `cmp`, run | RED (2 arms), `cmp` 0, GREEN 3 of 3 | PASS |
| Lane replay set | `node scripts/check-baseline-currency.mjs --replay-set` | `replay=1` naming the migration | PASS |
| Data-dependence linter | `node scripts/lint-migration-data-dependence.mjs` | 0 NEW | PASS |

### Probe Execution

SKIPPED: the phase declares no `probe-*.sh`.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FACT-03 | 238-04 to 238-09 (PLAN frontmatter) | A never-computed analytics row never reads "Analytics last computed", and freshness checks never take its insert time as a compute time | SATISFIED in code, PROD effect pending apply | Truths 1, 2, 4 to 8. The apply itself is the human item. |
| FACT-05 | 238-01 to 238-03 (PR-1, on main) | For a failed, stalled or never-started row the /strategies note never tells the owner to wait | SATISFIED | Truth 3. |

Both IDs appear in `.planning/REQUIREMENTS.md` (lines 126 and 128) and in the traceability table. No orphaned requirement: every ID mapped to Phase 238 is claimed by a plan. The REQUIREMENTS.md checkboxes are still `[ ]` and the table says Pending; closing them is the caller's bookkeeping, not a code gap.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/factsheet/fetch-and-build-payload.ts` | 988 | `console.warn("... freshness chip will show epoch")` now fires on every build of a never-computed row, and its text is inaccurate (the chip shows "not computed") | INFO | Log noise only. Already recorded as PR2-IN-03 and left unfixed under the no-LOW rule. |
| `src/components/strategy/StrategyHeader.tsx` | 41 | prop still typed `computedAt?: string`; the component has no caller | INFO | Dead mount. PR2-IN-03. |
| `supabase/schema/functions/sync_strategy_analytics_status.sql` | 915 | branch (c) can INSERT a first-ever `complete` row with no date (all jobs done and no analytics row). It now stores NULL where it used to store the insert time | INFO | Not a defect: readers show no date, which is honest. It is a state that did not exist before (complete with a NULL date), so the SQL gates carry it only through F1-EDGE. Reachability is unusual because the runner writes its row first. |
| `src/__tests__/computed-at-reader-census.test.ts` | arm check | an `arm` passes on file-level presence, so a same-count swap of one Python dict read would not fail | INFO | Known and stated limit (PR2-IN-05); `tsc` covers TypeScript. |

No TBD, FIXME or XXX markers in the migration, rollback, stamp module or census. No blocker anti-pattern.

### Human Verification Required

See the frontmatter list. In short: (1) TEST apply-test proving the migration role may DISABLE TRIGGER; (2) CI sql-tests Decision F replay and the `computed_at` SQL gate files on the migrated schema; (3) CI e2e-seeded freshness chip; (4) CI typecheck; (5) a post-apply PROD count showing 0 survivors. None of these ran in this verification and none is claimed as run.

### Gaps Summary

No gaps. Every roadmap success criterion and every plan must-have is backed by code I read and by targeted tests I ran. The remaining risk is concentrated in one fact only the TEST apply can prove: that the managed migration role owns `strategy_analytics` and so may disable a named trigger. A refusal rolls back on TEST and blocks the PROD apply, so it fails safe. The phase is not `passed` only because the Step 8 human and CI-only list is non-empty.

---

_Verified: 2026-11-26_
_Verifier: Claude (gsd-verifier)_

## Ship record (2026-11-26, records PR)

- **PR-1** (plans 01-03, FACT-05) shipped as v0.133.71.0 (#1331). **PR-2** (plans 04-09, FACT-03) shipped as v0.133.90.0 (#1363), merge commit `f34c9cacd`. Both of the phase's PRs are merged.
- **CI at the PR-2 head** `32c4549b`: run 45798297820 concluded success for every job, including `sql-tests` (the Decision F lane replay), `e2e-seeded`, `frontend-typecheck` and the `frontend` aggregator. These are job conclusions only, and human items 2 to 4 stay open for the verifier.
- **Migration** `20261126130000_strategy_analytics_computed_at_nullable.sql` was applied by `supabase-migrate.yml` run 45800983848 (head `f34c9cacd`, success). The `apply-test` log printed `which_database: OK — the marker names TEST and not PROD.` and then `NOTICE (00000): Migration 20261126130000: strategy_analytics.computed_at is nullable with no default, never-computed rows are NULL, the hold trigger is enabled.` The `apply` job printed the same NOTICE. This is the reading item 1 asks for, recorded here for the verifier. The baseline re-dump after the apply is v0.133.90.1 (#1364).
- **Still open:** item 5, the post-apply PROD count. The founder's verification is also recorded as open, on the coordinator's instruction; this report's frontmatter lists no separate founder item. The status stays `human_needed`.

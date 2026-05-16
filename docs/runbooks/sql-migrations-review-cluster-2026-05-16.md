# SQL Migrations Safety — Review-Cluster Gate Report (2026-05-16)

## Scope

Worktree-style review cluster retrofitted onto PR #182
(`chore/sql-migrations-safety-2026-05-16`) before `/land-and-deploy`. PR was
already shipped via `/ship` (v0.22.40.6, CI green, Grok 4.3 override
documented in coverage map). This gate runs targeted SQL-specific
specialists + Claude red-team adversarial pass on the 9 new migrations
under `supabase/migrations/20260516*.sql` + the coverage-map doc.

## Specialist suite

Artifacts saved under `.planning/sql-migrations-review-cluster-2026-05-16/`
(gitignored per project convention).

| Lens | Output (relative to `.planning/sql-migrations-review-cluster-2026-05-16/`) | Highest severity |
|------|--------|------------------|
| data-migration (PRIMARY) | `specialist.data-migration.jsonl` | CRITICAL (conf=10) |
| security | `specialist.security.jsonl` | HIGH (conf=9), clean |
| code-reviewer (SQL) | `specialist.code-reviewer.jsonl` | CRITICAL (conf=10) |
| pr-test-analyzer | `specialist.pr-test-analyzer.jsonl` | CRITICAL (conf=10) |
| performance (SQL) | `specialist.performance.jsonl` | HIGH (conf=9), clean |
| Claude red-team | `red-team.sql-migrations.jsonl` | CRITICAL (conf=10) |

silent-failure-hunter and type-design-analyzer were skipped per the
review-cluster spec (don't apply to SQL).

## Findings closed in this gate

All findings boil down to a single critical issue with two surfaces:

### CRITICAL: 160600 DROP DEFAULT breaks existing INSERT call-sites

Migration `20260516160600_match_decisions_drop_kind_default.sql` drops the
`bridge_recommended` DEFAULT from `match_decisions.kind`. The column is
NOT NULL (since mig 080 STEP 5). Two app routes plus six test inserts
were INSERTing without specifying `kind`, relying on the DEFAULT:

| Site | File | Line | Fix |
|------|------|-----:|-----|
| Allocator "send intro" path | `src/app/api/match/decisions/holding/route.ts` | L114-125 | Set `kind: 'bridge_recommended'` (preserves the previous DEFAULT semantic). |
| Admin "thumbs-up/down/snoozed" path | `src/app/api/admin/match/decisions/route.ts` | L56-67 | Set `kind: 'bridge_recommended'` (preserves the previous DEFAULT semantic). |
| `match-decisions-xor-rls.test.ts` (Phase 09 XOR tests) | x6 inserts | L113, 137, 158, 181, 244, 266, 322, 397, 429 | Set `kind: 'bridge_recommended'` on all (shape matches: `strategy_id NOT NULL`, exactly one of `original_*` NOT NULL satisfies the new mig 160400 `_v2` XOR). |
| `outcomes-join-rls.test.ts` seed | L172-178 | Set `kind: 'bridge_recommended'`. |

### CRITICAL: 160400 + 160500 rename CHECK constraints; tests assert old names

Migrations `20260516160400` and `20260516160500` DROP the old
`match_decisions_kind_bridge_recommended` (OR-shape) and
`match_decisions_kind_voluntary_modify` (untightened) and ADD `_v2`
constraints (XOR-shape / `original_strategy_id IS NULL` required).
`src/__tests__/match-decisions-schema.test.ts`:

- `T_CHECKS_PRESENT` (L284-299) asserted exact array of 4 old names — would FAIL after merge. Updated to the new `_v2` names.
- `T_KIND_DEFAULT` (L238-249) asserted column default = `bridge_recommended` — would FAIL after 160600 drops it. Renamed to `T_KIND_NO_DEFAULT` asserting `column_default IS NULL`.
- `T_REJECT_BR_ORPHAN` (L457) error matcher uses substring `match_decisions_kind_bridge_recommended` — coincidentally still matches `_v2` (substring includes substring). No change required.

## Findings deferred

See `.planning/sql-migrations-review-cluster-2026-05-16/follow-ups.md` for the deferred backlog:

- **PT-002**: no behavioral tests for `_assert_strategy_visible_to_allocator`, `_match_decisions_visibility_check` trigger, `_validate_scenario_diff` validator helper. Apply-time self-verifying DO blocks cover installation correctness. Behavioral E2E tests would catch regressions in helper/trigger logic itself. File as follow-up.
- **PT-003**: existing `commit_scenario_batch` tests don't exercise the new visibility trigger with mismatched-org inserts. File as follow-up.
- **CR-004**: `_validate_scenario_diff` helper installed but `commit_scenario_batch` body is unchanged. Per-diff structured 22023 errors are a DX improvement; wire-up is follow-up.
- **PT-004**: 2 pre-existing CCXT mock failures in `analytics-service/tests/test_repro_key_flow.py::test_happy_path_replays_balance_fetch[okx|bybit]`. Unrelated to this PR (reproducible on origin/main).
- **SEC-004**: orphan-org bypass in `_assert_strategy_visible_to_allocator` — intentional per file header to avoid frozen scenario commits. Mitigated by sanitize_user H-0908 audit emission. Acceptable narrative; flag for awareness.

## Red-team adversarial scenarios — verdict matrix

| ID | Scenario | Verdict |
|----|----------|---------|
| RT-001 | Rolling deploy ordering breaks routes | BLOCK / AMEND → fixed |
| RT-002 | Concurrent apply on multi-replica | Inapplicable (Supabase single-leader) |
| RT-003 | Old enum consumer hits new value | Out of scope (no values added) |
| RT-004 | Replay after crash mid-apply | Clean (BEGIN/COMMIT wrap) |
| RT-005 | PR #173 + #182 timestamp ordering | Clean |
| RT-006 | RLS bypass via SECDEF indirection | Clean |
| RT-007 | Reaper RPC threshold tuning | Out of scope |
| RT-008–010 | Coverage-map honesty spot-check | Verified |
| RT-011 | E2E tests break after merge | BLOCK / AMEND → fixed |

## Verification

- `npm run typecheck`: PASS (clean)
- `npm run lint`: PASS (22 pre-existing warnings, 0 errors)
- `npm test` (full vitest): 3620 passed, 209 skipped, 0 failed (40.95s)
- `pytest analytics-service/tests/` (excluding pre-existing flaky CCXT mock): 1448 passed, 48 skipped, 0 failed (12.57s)
- `supabase db lint` requires local/linked DB — deferred to CI's `supabase-migrate` workflow.

## Outcome

`sql-migrations-review-gate: APPLIED | gate-findings=2-CRITICAL-closed | PR=182 | review-cluster-clean | ready for /land-and-deploy`

Two critical forward-incompatibility findings closed via surgical
amendments to 2 route files + 3 test files (no migration files touched —
the migration intent was correct; the existing call-sites needed to
catch up to the tightened invariants).

---
phase: 242-secretshygiene-the-full-history-is-scanned-on-a-schedule-and
plan: 06
subsystem: records-and-phase-gate
tags: [todos, runbooks, windows-ledger, phase-gate, gitleaks, SECR-03, SECR-04]
requires: [242-01, 242-05]
provides: ["backlog, runbooks and WINDOWS entry 61 match the shipped state", "phase gate evidence on the final tree incl. a squash-shaped scan"]
affects: [TODOS.md, docs/runbooks/prod-prober-cadence-go-live.md, docs/runbooks/ops-staleness-go-live.md, docs/runbooks/match-engine.md, .planning/WINDOWS.md]
key-files:
  modified:
    - TODOS.md
    - docs/runbooks/prod-prober-cadence-go-live.md
    - docs/runbooks/ops-staleness-go-live.md
    - docs/runbooks/match-engine.md
    - .planning/WINDOWS.md
decisions:
  - "The now-empty `## Phase 164.3 round-4 residuals` heading was left in TODOS.md, as the plan said to leave surrounding headings; it is flagged below for the ship step"
status: complete
actuals:
  tokens: 30000
  tasks: 3
  commits: 3
plan_head_before: 77603fbd453e1832487fc1060b4654ea7edf1bf8
plan_head_after: 865c24a1e7a52ba5975e7e154b6a956e77223262
---

# Phase 242 Plan 06: Records and the phase gate Summary

The backlog, the three operator runbooks and WINDOWS entry 61 stop describing defects Phase 242 closed, and the whole phase was verified on its final tree, including a scan shaped exactly like the squash commit main will receive. One phase-gate item is not clean: two vitest tests time out on their hard-coded 30 second budget when the whole phase set runs in one invocation (details under "What went red").

`commits: 3` counts the three record commits measured from the ledger (`git rev-list --count 77603fbd4..865c24a1e`); this SUMMARY is committed separately after them.

## Tasks

| Task | What | Commit |
|---|---|---|
| 1 (tracer) | `TODOS.md`: both closed entries deleted, pointer paragraph corrected, dispatch entry annotated | `9c5afc62f` |
| 2a | the three runbooks check the exact two-origin set and call the trim residual closed | `1e998964c` |
| 2b | WINDOWS entry 61 `reason` (table row and JSON record) | `865c24a1e` |
| 3 | phase gate (no files; this SUMMARY) | committed after this file |

## What changed

- **TODOS.md.** The entry for the cron-tick residuals (heading through its two trailing status bullets) and the entry for the full-history secret scan (heading through the line before the next `## ` heading) are deleted. The TRADESYNC pointer paragraph now names only the provenance-gate booking as still sitting above, with a dated parenthesis that the other booking was closed and deleted by Phase 242 SECRETSHYGIENE on 2026-11-27. Neither deleted id appears anywhere in the file. The open entry on `secret-scan` going red on `workflow_dispatch` runs stays, with a dated paragraph: narrowed, not closed, because a dispatch still scans every ref and other refs carry findings this phase did not suppress (WINDOWS entry 61 half (b)).
- **Runbooks.** `ops-staleness-go-live.md` P2 counts `n_url_allowed` with `s.value IN (<production origin>, <loopback discard literal>)` and names the migration that set the exact set. `prod-prober-cadence-go-live.md` P2 "Expected" says the url equals one of exactly two origins by equality; its "Abort if" keeps "fails the allow-list". `match-engine.md` keeps the spaces-only residual paragraph as lineage and adds a dated 2026-11-27 note that the guard now trims spaces, tabs, carriage returns and newlines in all four key-posting functions. The counts-only rule in each is unchanged.
- **WINDOWS.md entry 61.** `reason` is the one dated sentence from the plan in both places. `git diff .planning/WINDOWS.md` shows exactly two changed lines (a removed and an added line per place, 4 diff lines). `status` stays `open`; `open_count: 51` unchanged.

## Phase gate lines (final tree, HEAD `865c24a1e`)

1. Gate runs, each exit 2:
   - `test_cron_sync_tick.sql`: `arms: 11/11/0   (executed/annotated/waived)` and `No defects in the narrowed scope.`
   - `test_prod_prober_cadence.sql`: `arms: 9/9/0   (executed/annotated/waived)` and `No defects in the narrowed scope.`
   - `test_ops_staleness_check.sql`: `arms: 16/16/0   (executed/annotated/waived)` and `No defects in the narrowed scope.`
   - `test_analytics_service_settings_and_vault_tick.sql`: `arms: 17/17/0   (executed/annotated/waived)` and `No defects in the narrowed scope.`
2. Static checks, all exit 0: `run.mjs --parse-only` (`coverage: files 96/123`, `arms: 0/1089/0`, `No static defects`); `npm run schema:functions:check` (`SQL function snapshot is current (146 functions).`); `lint-sql-gates` (`scanned 123 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).`) and its `--self-test` (`7 rules, red+green each.`); `lint-migration-data-dependence` self-test and corpus (`corpus 345 migration(s), 427 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.`); `lint-app-guc` self-test and corpus (`app-guc: findings 0`).
3. `npm run typecheck`: exit 0. `npm run lint`: exit 0, including `check-planning-hygiene` (rules 1, 6 and 7 OK) before this SUMMARY existed.
4. `actionlint .github/workflows/secret-scan-full-history.yml`: exit 0, no output.
5. Scans (all `--redact`, never `-v`):
   - Full history of this branch, `gitleaks git . --config .gitleaks.toml --log-opts=HEAD --redact --no-banner --exit-code 2`: `2770 commits scanned.` then `no leaks found`.
   - Range, `--log-opts=origin/main..HEAD`: `27 commits scanned.` then `no leaks found`.
   - Squash-shaped probe (separate scratch worktree off origin/main at `de74565e6`, `git merge --squash` of HEAD `865c24a1e` merged cleanly, one commit, scanned with `--log-opts=-1 --exit-code 7`): `1 commits scanned.` then `no leaks found`. The probe ran before this SUMMARY was written, so the scans were re-run after it (see "Scan re-run after this SUMMARY").
6. `git worktree list` after `git worktree remove --force` on the probe, home path shown as `<home>`: it lists `<home>/claude-projects/quantalyze`, the sibling per-phase and per-plan worktrees, and `<home>/claude-projects/quantalyze-242-p06 865c24a1e [wt/242-p06]`. No listed path contains `squash-probe`.
7. Tests that read TODOS.md (Task 1): 8 files, 338 tests passed. Tests that read WINDOWS.md (Task 2): 2 files, 241 tests passed.

## What went red

**The 20-file phase vitest set: `2 failed | 1883 passed | 2 skipped`, twice** (once at default workers, once with `--maxWorkers=3`). The two failures are the same both times and both are `Test timed out in 30000ms` on a hard-coded per-test budget that overrides `--testTimeout`:

- `src/__tests__/mutation-annotation-parser.test.ts` > "REAL CORPUS: no annotation that exists today rewrites an identity"
- `src/__tests__/mutation-runner-floors.test.ts` > "`--parse-only` deliberately does NOT print it — so CI's demand for it also catches a mode swap"

Both spawn a real-corpus parse of the 123 SQL gate files. Run alone (the two files together) they pass: `Test Files 2 passed (2)`, `Tests 241 passed (241)`, in 28 s on a quiet run and 69 s on a busier one. The other 18 files passed in the combined runs. This checkout shares a machine with a dozen other phase worktrees, so I read it as contention on a 30 s spawn budget, not a defect. It is not proven: I did not bisect against the phase base, and the corpus grew this phase (`ARMS_FLOOR` 1079 to 1089, gate files re-based), so a margin that was already thin may have thinned further. In CI the vitest shards split these files, which is where the real answer will appear. If those two tests go red on the ship PR's shards, the budget is the thing to look at, not the SQL.

## Deviations from Plan

None - plan executed exactly as written. Two notes that are not deviations:

- origin/main moved from `5027bec26` to `de74565e6` between my `git fetch` and the probe (the repository is shared). The probe therefore squash-merged onto the newer tip, which is closer to what main will receive. origin/main's newest migration is still `20261126180000`, so this phase's `20261127120000_cron_destinations_exact.sql` still sorts after it.
- The `## Phase 164.3 round-4 residuals` heading in `TODOS.md` now has no entry under it (the deleted entry was its only content). The plan said to leave surrounding headings intact, so I did. The ship step may want to delete the empty heading in the same PR; nothing reads it (the TODOS-reading tests pass).

## Known Stubs

None.

## For the verifier: items that cannot run before merge

- **First scheduled-scan evidence.** After merge, dispatch `secret-scan-full-history.yml` on main; record the run id and its `no leaks found` line. The squash probe above is the pre-merge proxy.
- **Migration apply.** Record the `apply-test` and `apply` run ids for `20261127120000_cron_destinations_exact.sql`; then a PROD read, marker query first, of the four function bodies and the CHECK (`system_settings_analytics_service_url_allowed`), one query per call.
- **Bot re-dump.** Merge the post-apply baseline re-dump PR; the four expected DRIFT rows clear after it.
- **Pre-merge review (no executor runs this).** migration-reviewer and rls-policy-auditor must report no MEDIUM+ finding on the migration before merge; the orchestrator runs them in the review stage and records the result in the phase VERIFICATION or REVIEW (ROADMAP SC-3, DEST-TIMESTAMP).
- **Timestamp re-check at ship.** Re-compare the migration timestamp against origin/main's list and the PROD ledger tip; if Phase 243 lands a later migration first, rename both migration files per the phase contract.
- **CHANGELOG at ship.** The entry must name `[167.1.2.2.2-CRON-TICK-RESIDUALS]` and `[SECRETSCAN-FULLHISTORY-01]` as closed and deleted (this plan deleted them; the ids appear nowhere in `TODOS.md` now).

## Expected PR reds (not defects; do not "fix" them)

- `baseline-content-drift-check` reports 4 DRIFT rows (the four functions) until the post-apply bot re-dump merges. No allowlist row is added.
- `test-db-drift` (VAC-08) may read red for the new ledger row until `apply-test` runs on merge.
- A `workflow_dispatch` of CI's own `secret-scan` can still go red on other refs (WINDOWS entry 61 half (b), still open).

## Scan re-run with this SUMMARY committed

Run with this file committed (before a final amend of this paragraph), same commands, `--redact`: full history of the branch `2771 commits scanned.` and `no leaks found`; range `origin/main..HEAD` `no leaks found`; squash-shaped probe (one commit, merged cleanly onto origin/main) `no leaks found`, probe worktree removed (no `squash-probe` path in `git worktree list`). `npm run lint` planning-hygiene rules 1, 6 and 7 OK with the SUMMARY tracked.

## Self-Check: PASSED

- `TODOS.md`, the three runbooks and `.planning/WINDOWS.md` exist and carry the edits above (acceptance greps: both deleted ids 0, provenance id 2, dispatch entry 1, `railway\.app|http` regex 0 in both runbooks, `IN (...)` form 1, match-engine note 1, `half (c) answered` 2, `open_count: 51` 1).
- Commits `9c5afc62f`, `1e998964c`, `865c24a1e` are ancestors of HEAD.
- STATE.md and ROADMAP.md are untouched; no CHANGELOG or VERSION edit.

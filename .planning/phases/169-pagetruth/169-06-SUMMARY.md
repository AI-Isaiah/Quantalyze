---
phase: 169-pagetruth
plan: 06
subsystem: release
tags: [integration, d-22, live-db-lane, changelog, release]
status: checkpoint

requires:
  - "169-01, 169-04, 169-05, 169-07, 169-09, 169-10 SUMMARYs (all present)"
  - "review fix rounds T1 to T6 and the late fixes, merged on feat/169-pagetruth"
  - "origin/main at 792be2248 (167.1.2 C3, v0.111.1.0), merged in ab12aff26"
provides:
  - "Task 1: the integration, D-22 parity and SC1 live-lane outputs on the merged branch at 439e9e259"
  - "Task 2: one unified [0.112.0.0] CHANGELOG entry over the whole branch, with the commit-to-bullet mapping below"
  - "Task 3: PENDING, the orchestrator's post-deploy browser re-check"
affects: [169-VERIFICATION re-verify, 169-SECURITY T-169-06-A, /gsd-ship]

actuals:
  tokens: 9500
  tasks: 2
  commits: 1
plan_head_before: 439e9e2590bb5ef6228ebf4d0abd94fc00b651f8
plan_head_after: 1db0b5d3c07a8207340ad5fb5fbdfbb351083b8d

tech-stack:
  added: []
  patterns:
    - "The live-DB lane is judged by its execution ledger (`test:live-db:ledger`), never by the plain `test:live-db` exit code"

key-files:
  created:
    - .planning/phases/169-pagetruth/169-06-SUMMARY.md
  modified:
    - CHANGELOG.md
    - .planning/phases/169-pagetruth/169-SECURITY.md

decisions:
  - "The release commit touches CHANGELOG.md only: VERSION and package.json already read 0.112.0.0 byte-equal, one step above origin/main's 0.111.1.0, and the brief forbade changing them (overrides the plan's three-file acceptance line)"
  - "The live-DB suite runs with SUPABASE_ACCESS_TOKEN removed from the environment, as CI's lane runner has none"

metrics:
  completed: 2026-09-29
---

# Phase 169 Plan 06: Integration, D-22 re-run and release Summary

This is a re-run of Tasks 1 and 2 on the final merged branch. The first run reached its checkpoint at release commit 70ddb7d01. Since then, review rounds T1 to T6, three late fixes and a merge of origin/main (ab12aff26, bringing 167.1.2 C3) landed. Task 1 is green on the merged branch with no integration fix needed. Task 2 replaces the [0.112.0.0] entry with one that covers every commit on the branch. Task 3 is PENDING and belongs to the orchestrator.

## Task 1: integration on the merged branch

Run at HEAD `439e9e259` on `feat/169-pagetruth`. `node_modules` is a symlink to the main checkout's (lockfile byte-equal); `require.resolve('vitest')` resolved. The symlink was removed before each commit.

**Step 0, ancestry and the D-22 re-run.**
- `git fetch origin main` then `git merge-base --is-ancestor origin/main HEAD` gave `ANCESTOR_OK`. origin/main is at `792be2248` (167.1.2 C3, v0.111.1.0), and it has not moved past the last merge.
- 166.1 lineage: `d9c173346` (166.1, #872) and `b10cea659` (166.2, #874) are on origin/main, and `compute.ts` imports `@/lib/return-stats` (1 hit). The old reconciliation arm does not apply.
- D-22 parity table, `npx vitest run src/lib/factsheet/fetch-and-build-payload.test.ts`: `Test Files  1 passed (1)`, `Tests  38 passed (38)`, exit 0.

**Step 0, SC1 live reproduction on the private local lane.**
- No lane was running (`docker ps` empty). `bash scripts/local-stack/run.sh up` gave exit 0: `acl-fidelity ... drift=0 verdict OK`, `nonpublic-fidelity ... drift=0 verdict OK`, `ledger: 282 carried migration row(s) written`, `replay complete: 0 migration(s) applied on top of the dump`, `up complete`.
- `npm run test:live-db -- src/__tests__/factsheet-buildable-live-db.test.ts --reporter=verbose` gave exit 0, `Tests  7 passed (7)`, and no skipped line. Each case passed: `REPRO-SINGLE-ONE-POINT`, `REPRO-COMPOSITE-PRE86`, `CONTROL-BUILDABLE`, `PROBE-SINGLE`, `PROBE-COMPOSITE`, `PROBE-CONTROL` and `WITH-REASON`. The grep gate (both names present, no non-zero skipped count) printed OK.
- **What this proves about the new keyset reader (CSV-READ-CAP, 50c823f63).** `readCompositeFactsheet` calls `readCsvDailyReturns` before anything else. That read stops only on an empty page. So `REPRO-COMPOSITE-PRE86`, `PROBE-COMPOSITE` and `WITH-REASON` each drove it through two PostgREST requests against the lane: a first page with the seeded rows, then a `.gt("date", cursor)` page that came back empty. They answered `composite_unbuildable`, not `read_error`, so the real PostgREST accepted the keyset query shape. **Not proven live:** crossing a 1000-row page boundary. That case (1112 rows) is covered only by the unit test's fake.
- The whole live-DB lane, run the way CI runs it (`node scripts/live-db-execution-ledger.mjs --self-test`, then `npm run test:live-db:ledger`):
  - self-test: `live-db-execution-ledger self-test OK: 20 cases, red and green both observed.`
  - ledger run, exit 0: `Test Files  2 failed | 46 passed | 2 skipped (50)`, `Tests  7 failed | 401 passed | 81 skipped (489)`, `[live-db-ledger] executed: 408 test(s) (401 passed, 7 failed), 81 skipped, 489 collected, across 50 file(s)`, `[live-db-ledger] OK — the failing set is EXACTLY the ledger (7/7). Every corpus file executed; no arm outside the ledger failed; no ledger entry has gone stale.`
  - The 7 are the ledgered `sanitize-user-rpc` (1) and `wizard-rpcs-live-db` (6) arms. Neither file is touched by this phase.
- `bash scripts/local-stack/run.sh down` gave exit 0, and `--assert-teardown` gave `surviving quantalyze containers -> 0`, exit 0. `down` ran after every live run.
- `node scripts/live-db-fixture-drift-census.mjs`, exit 0: `corpus 52 file(s); 0 finding(s) (0 absent-table, 0 absent-column, 0 unexposed-schema, 0 ambiguous-overload), 69 unresolved.`
- `npx vitest run src/__tests__/live-db-fixture-drift.test.ts src/__tests__/live-db-execution-ledger.contract.test.ts`: `Test Files  2 passed (2)`, `Tests  10 passed (10)`.

**Step 1, every SUMMARY present.** Six `SUMMARY PRESENT` lines (169-01, 04, 05, 07, 09, 10), exit 0. None records a HALT, a STOP or an unresolved defect.

**Step 2, suite, types, lint and the compute-once gate.**
- `npm test`, exit 1: `Test Files  1 failed | 913 passed | 20 skipped (934)`, `Tests  1 failed | 17524 passed | 292 skipped (17817)`, `Duration  172.82s`. The one failure is the known load flake: `ci-anti-skip-gate.contract.test.ts > ... refuses a handoff whose DB_URL is not loopback, before any file reaches psql`, `Test timed out in 5000ms`.
- Re-run alone: `npx vitest run src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` gave exit 0, `Tests  33 passed (33)`. This branch touches nothing that file tests.
- `npx tsc --noEmit -p .`: exit 0, 0 `error TS` lines.
- `npm run lint`: exit 0 (eslint clean, `[check-admin-route-manifest] OK — 20 admin routes`, `[check-route-contract] OK — 58 page routes`, `[check-planning-hygiene] OK — 7852 tracked files scanned`).
- `npx vitest run src/lib/return-stats.single-source.test.ts src/__tests__/critical-regressions.test.ts`: `Test Files  2 passed (2)`, `Tests  203 passed (203)`.

**Integration fixes: none.** Neither expected post-merge class fired. No 167.1.2 C3 money literal needed the D-50 form, and no C3 period assertion needed the D-11 / D-57 null-or-absent form. The suite was green on both without a move.

**Measured on the way: a management token in the shell reached the live-DB run.** The first `test:live-db` run inherited `SUPABASE_ACCESS_TOKEN` from the developer shell, which CI's lane runner does not have. That made `HAS_INTROSPECTION` true in `src/lib/test-helpers/live-db.ts`, which derives the project ref from `NEXT_PUBLIC_SUPABASE_URL` by an `https://` regex. On the loopback URL the regex does not match, so the "ref" was the whole local URL. Every introspection case POSTed to the hosted Management API with the token attached and got a 404 (75 failures, `Cannot POST /v1/projects/http://127.0.0.1:.../database/query`). No database was reached, remote or local, through that path. All the results above come from re-runs with the token removed (`env -u SUPABASE_ACCESS_TOKEN`), which reproduces CI's environment. The file is outside this plan's file set, so it is left unchanged here; see Deferred Issues.

## Task 2: the release entry

- Base: `git show origin/main:VERSION` is `0.111.1.0`. `VERSION` and `package.json` read `0.112.0.0`, byte-equal (`cmp` OK), and are **unchanged**. `package-lock.json` is not in the branch diff.
- Verify 1: `VERSION=0.112.0.0 package.json=0.112.0.0`, the heading is present, and critical-regressions gave `Tests  169 passed (169)`, exit 0. Verify 2: `base=0.111.1.0 new=0.112.0.0`, exit 0.
- Commit `1db0b5d3c` `chore(release): v0.112.0.0 — FACTSHEETTRUTH, fold the two review rounds into the entry` touches `CHANGELOG.md` only (48 insertions, 26 deletions).
- Diff scan before commit: 0 UUID-shaped strings, 0 email addresses, 0 home paths and 0 CI skip tokens in the added lines. `gitleaks stdin` gave `no leaks found`.
- Corrected against the old entry:
  - The discovery page's outage line now describes the read-failure sentence and the Sentry capture on both arms (2f1daac40, e3c2fb190).
  - The parity count is 38, not 36.
  - The timing note names only the flake measured this run.
  - The "comments still say byte-identical" note is dropped, because IN-01 fixed those comments.
  - "Risk shares shown unsigned" now reads "no plus sign; a hedge keeps its minus" (IN-05).

### Commit checklist

`git log origin/main..HEAD` before the release commit held **112 commits: 98 non-merge and 14 merges**. After it, there are 99 non-merge commits; the 99th is the release commit itself.

The entry has **4 sections and 31 bullets**: Changed 16, Fixed 7, Tests 4, Notes 4. The Notes Known-limits bullet carries 8 sub-items. The bullets fall under **nine themes**:
1. the headline source (C1 to C7)
2. return windows and rows (C8 to C10)
3. record length and freshness (C11 to C14)
4. the cache key (C15)
5. series read outages and completeness (F1 to F3)
6. risk attribution (F4, F5)
7. money (C16, F6, F7)
8. tests (T1 to T4)
9. reviews, limits and planning (N1 to N4)

**Bullet keys:**
- **Changed:**
  - C1 headline reads persisted scalars
  - C2 seven-key gate and IN-02 typing
  - C3 probe never captures
  - C4 H-2 arithmetic curve
  - C5 M-2 what-if withheld
  - C6 H-1 chain-break caveat
  - C7 cash leverage re-pin
  - C8 window coverage and 3Y / 5Y
  - C9 weekday coverage rule
  - C10 period rows and the empty blend
  - C11 record length stated one way
  - C12 selected-basis length and the backtest flag
  - C13 chip date line
  - C14 whole-day bucketing on both surfaces
  - C15 v8 cache key
  - C16 key-card whole dollars
- **Fixed:**
  - F1 series read outages are read_error
  - F2 CSV keyset read
  - F3 discovery page outage
  - F4 risk unit
  - F5 missing weight and hedge
  - F6 money precision and sign
  - F7 partial total and key-trust note
- **Tests:**
  - T1 new with the plans
  - T2 new with the reviews
  - T3 moved by measurement
  - T4 integration
- **Notes:**
  - N1 known limits
  - N2 timing
  - N3 reviews
  - N4 planning

**Mapping, every non-merge commit (98 before the release commit):**

| sha | bullet | sha | bullet | sha | bullet |
|-----|--------|-----|--------|-----|--------|
| 451233105 | N4 | 4206dc716 | N4 | c8197aed6 | N4, N1 (D-44) |
| 23b6f95ae | N4 | 49bfd844a | N4 | 86a1d1f23 | N4 |
| 1bb01cb29 | N4 | b9673fced | N4 | 2f88e8170 | N4 |
| cf8f30046 | N4, C10 (D-57) | c024f7744 | N4 | 591665a04 | N4 |
| 792d7b578 | N4, N1 (D-61) | 9cc8f1558 | N4, C15 (D-62) | 22275a673 | N4 |
| 48cfcd4f0 | N4 | 1a6da81f2 | N4 | 2006594bd | F4 |
| 951a6154a | F4, T1 | d2b01a494 | C8 | ffa0705d9 | F6 |
| 329af53c5 | F6, T1 | 1c7ff3f2c | F4 | 220f90b4b | F6 |
| 143b35a5d | N4 | eb088b921 | N4 | 9ebfa068a | N4 |
| 16dad8b1c | C1 | 156efff8e | C1, C7, T1 | be5af7d09 | C13 |
| c9dd1a099 | N4 | 732c94fef | N4 | 007ba8866 | C1, C7 |
| 61e2c37c2 | N4 | 904e54b09 | N4, C15 | 9101dc119 | F1 |
| 217af15f6 | C11 | 77fe768a5 | F1, F3 | 5657c6eb6 | C15, T3 |
| 8cd75cc79 | C10, C11 | 554f1f1ce | N4 | 738eee793 | C10 |
| 4b3b466f5 | N4 | 70ddb7d01 | the entry itself (superseded) | 8d9155b7a | N3 |
| 2f1daac40 | F3 | 19527c123 | N3 | e041950e8 | F6 |
| 66c256c7a | F3 | 3c2cfe862 | N3 | 5992b1d46 | C16, F6 |
| 10c5001b5 | F7 | a592a3f14 | C9, T3 | 50c823f63 | F2, T2 |
| 5ece86168 | F5 | 6bc68f933 | C12 | c83166375 | F4 |
| 34edabc65 | C14 (reverted, re-landed in a2bbb3edc) | ccb1e5384 | F1 | 06b320b2d | N3 |
| 7ab347d81 | C2 | 509bd2e66 | N3 | 5cadefab7 | C14 (reverted, re-landed in a2bbb3edc) |
| 9005ade35 | C2 | 98bb9b16b | C14 (the revert) | 0516e4428 | C4 |
| ddcee76b6 | N3 | 39c072c89 | C6 | 290fff44b | N3 |
| 6f7e1875f | C5 | 7507ad36a | F1 | b19254c61 | N3 (IN-01) |
| 54afefaf0 | C15 | 1e5c97865 | C3 | fcb6f4da4 | N3 |
| d1478cb2a | N3 (IN-01) | 78964fb96 | T3 (stale fake) | a2bbb3edc | C14 |
| e3c2fb190 | F3, C4, C5 | fe0d0e0e3 | C6 | 7e1ba0bc7 | C10 |
| def0c931e | N3 (D-11, D-41 amended) | 43b148dc2 | N3 | 7872478e6 | N3 |
| 1dbcc3b8b | N3 | 508b56e31 | C12 | 9b813427b | C9 |
| 67be099dd | F5 | e59cc0548 | C6 | 52367ba40 | F7, T3 |
| f38776d23 | F1 | da13f532d | N3 (IN-R2-01) | 35fae90e0 | N3 |
| c71a88362 | N1 (MT5 weekend bar), F7 comment | 48ee02a13 | T3 (phase-148 witness) | 94e5314a5 | N3 (security audit) |
| 05c6fe2df | N3 (phase verification) | 439e9e259 | T3 (phase-148 witness follow-up) | | |

**Merges (14), all mapped to N4 or to the bullets of the work they carried:**
- Main was merged in six times, all N4: 9dfac1aba, 69f97baba, 33928413f, c3e35b572, e9c1caafa, ab12aff26.
- Plan worktree merges carried their plans' bullets:
  - 0e6c7d47e (169-04): C8, C13
  - dad7d8041 (169-09): F4
  - 696dc524b (169-10): F6
  - 83a2226ee (169-07): F1, C15
- Round-1 topic merges carried their topics' bullets:
  - 01677a664 (T1): F1, F2, C2 to C6
  - 5db1cb30a (T2): C9, C12, C14
  - 8e696421a (T3): F3
  - 6650059cf (T4): F5 to F7, C16

**Cross-check (mechanical).** The 9-hex shas in the table above were extracted (98 unique) and diffed against `git log --no-merges --format=%h --abbrev=9 origin/main..439e9e259` (98). The diff was empty in both directions, so no commit is unmapped and no sha is invented. The 14 merges are listed above: 6 + 4 + 4. Every bullet traces to at least one commit except T4 and N2. Those two record this plan's own Task 1 run, and the release commit maps to the entry as a whole.

## Task 3: post-deploy browser re-check — PENDING (human checkpoint, gate blocking-human)

The orchestrator does this after it ships, lands and deploys the phase. It follows the plan's Task 3 steps 1 to 4: the SHA-bound deploy with the ancestry check and a non-zero CI run count, then the v8 key on the deployed SHA with first reads after step 1. Check each page at desktop width, at 390px (iPhone 12) and at desktop 200% zoom, and record no identifiers:

- One single-key strategy on the discovery list, discovery detail, /recommendations, /my-strategies and its factsheet: CAGR and Sharpe identical (SC4). Also record what the OG card shows (D-44).
- A short-record factsheet: no 6 Month / 1 Year / 3 Year / 5 Year rows (D-57); YTD shows the em-dash only for a start after 1 January (D-11).
- `/allocations?tab=scenario`: a blend shorter than six months and one longer than a year (SC6, D-57). An empty blend shows none of the four rows (IN-03).
- A stale-series factsheet: the chip's series-end date line and its "Computed" line; one record length everywhere. Under the MTM toggle, the thesis and Terms state the MTM length, and the backtest line follows the cash record (WR-03, SFH R2-1).
- The chip and the discovery badge on the same row name the same band (WR-04).
- A chain-broken single-key factsheet: the amber caveat in the KPI strip, Main Metrics and Cumulative Return Metrics, each naming its own labels, with or without a date (H-1). It is absent under MTM and under a leverage what-if.
- The leverage what-if is withheld on a chain-broken row (M-2).
- `/portfolios/[id]` risk decomposition: single-scaled percents, no plus sign, the tooltip matching the table, and no "Overweight risk" from a missing weight. An empty panel is recorded, not counted as evidence against the fix (D-53).
- `/allocations` Open Positions and Holdings: sub-dollar prices, cents on P&L, no signed or coloured zero, and the "Partial total" note when some P&L is missing (M-4). The key-trust note names a count, not "$0.00" (IN-R2-05).
- The Exchanges key card's balance reads whole dollars (IN-04).
- Composite read outage: not induced in production. Search the production logs for the outage line since the deploy (D-41, H-3).

## Deviations from Plan

1. **[Brief override] The release commit names CHANGELOG.md only.** The plan's acceptance says exactly CHANGELOG.md, VERSION and package.json. They already read 0.112.0.0 byte-equal from the first run, and the brief forbade changing them.
2. **[Brief override] The executor's worktree branch-namespace assertion (agent-* only) was not applied.** The brief assigned this worktree and `feat/169-pagetruth` explicitly. The protected-branch and detached-HEAD checks passed.
3. **[Rule 3, environment] The live-DB runs strip `SUPABASE_ACCESS_TOKEN`.** See "Measured on the way" above. That is CI's environment, not a code change.
4. **The live lane was also run whole, not only on the SC1 file.** The brief asked for `test:live-db`. Its plain exit code is 1 by design (7 ledgered arms), so the verdict is the ledger's, as in CI.
5. **The release commit was amended once** (not pushed) to name the phase verification in the Reviews note.

## Deferred Issues

- `src/lib/test-helpers/live-db.ts` computes `HAS_INTROSPECTION` from `SUPABASE_ACCESS_TOKEN` alone plus a ref it derives with a fallback. On a loopback lane with a developer's token in the shell, the introspection cases send that token to the hosted Management API. They got 404s here, because the derived ref was the local URL. **This is a test-harness hazard, not a data-integrity or user-facing defect, and it is outside this plan's files.** The obvious fix is for the lane to refuse or unset the token when the API URL is loopback. It is reported to the orchestrator and not booked.

## Self-Check: PASSED

- `CHANGELOG.md` heading `## [0.112.0.0]` present (line 3). Commit `1db0b5d3c` exists on `feat/169-pagetruth`.
- `169-SECURITY.md` T-169-06-A is closed with evidence, and an audit row is added with the old text kept as lineage.
- No push, no deploy, no STATE.md or ROADMAP.md edit, and no gsd-tools state handler was run.

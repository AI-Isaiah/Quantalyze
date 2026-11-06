# Phase 183: DUPCOUNT - Research

**Researched:** 2026-11-01 (worktree `quantalyze-183`, branch `feat/183-dupcount`, base `8c8edc452`)
**Domain:** allocator equity derive (Python writer) and its TypeScript reader/mirrors; no new packages
**Confidence:** HIGH (every claim below was read in the files or reproduced in a scratch copy this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### D-01 — Count once, draw the curve
Founder 2026-10-31, AskUserQuestion: "Count once, draw the curve (Recommended)".
- A marked duplicate whose account the derive's account-group resolution already counts once no longer refuses the book.
- A real double count (two counted keys on one account, `account_identity_collision`) still refuses.
- Writer and reader agree: the writer is the identity gate `duplicate_keys` in `analytics-service/services/job_worker.py`; the reader is `countsAsDuplicate` / `untrustworthyRebuildReason` in `src/lib/queries.ts`.

### Founder rule carried (not re-asked)
- One exchange account under several logins is intended (founder memory). A marked duplicate is a normal state of a book, not an error to refuse over.

### Claude's Discretion
- Whether `DeriveRefusal.ACCOUNT_DUPLICATE` stays in the closed refusal vocabulary (for any case the group resolution does NOT count once) or is retired; research must show which cases, if any, still reach it, and the choice goes in the plan with its evidence. The vocabulary is pinned by `analytics-service/tests/fixtures/derive_refusal_rows.json` and the census, so either choice moves those pins.
- The exact shape of the reader change in `equityHistoryReadiness` / `countsAsDuplicate`, as long as it applies the writer's rule.

### Deferred Ideas (OUT OF SCOPE)
- The DUPCOUNT book also breached the NAVMTM zero-start band. That is fixed by NAVMTM G-01 (#1166, deployed 2026-10-31), not here. The book reads trustworthy only once both land, so SC-4's "trustworthy curve" reading depends on G-01 as well as this phase.
- SC-4 is a post-deploy PROD reading run by the orchestrator only, never by a dispatched executor.

### Open question carried from CONTEXT (not decided; see Open Questions below)
- Per-key "duplicate" note on the Exchanges page: information only, or changed?
</user_constraints>

<phase_requirements>
## Phase Requirements

No REQUIREMENTS.md ids are mapped (ROADMAP: `Requirements: TBD`). The phase-local ids are SC-1..SC-4.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | A marked duplicate whose account the group resolution already counts once no longer refuses the book. Two counted keys on one account (`account_identity_collision`) still refuse. | Section "Q1": the gate is provably dead (the group loop counts every such pair once); the collision gate is kept. |
| SC-2 | Writer and reader apply the same rule (`job_worker.py` and `countsAsDuplicate` in `queries.ts`). | Section "Q2": remove the key-list block from the reader; the only remaining reader path to `duplicate_account` is the stored collision token. Mirror inventory lists 5 sites that must move together. |
| SC-3 | Tests go RED on the current refusal. | Section "Q3": the shared fixture table flip is RED on both runtimes; reproduced in a scratch copy (3 cells RED, 73 GREEN once the gate is gone). |
| SC-4 | After deploy, a PROD reading shows 0 `account_duplicate` refusal rows, the book has a trustworthy curve, QUANTALYZE-2H stops recurring. | Section "Q5": read-only SQL shape, trigger/await, and a second-order risk (the stitch/compose path runs for the first time on this book). |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Tests RED first; data-integrity gates must be able to fail (neuter, see RED, restore from a byte backup; never `git checkout/restore/stash` on uncommitted work).
- This checkout's Supabase CLI is linked to PRODUCTION: no `--linked`, no `db push`, no PROD/TEST query from a dispatched agent. Marker query first, every time, for any PROD read (the orchestrator runs SC-4).
- No PROD ids, home paths, account numbers or `_usd` amounts in tracked text (public repo). Counts and tokens only. T-167.1.2-22 stays in force: no key id, venue id or USD in the log line or the Sentry message.
- Never write a CI skip token (any of the bracketed skip phrases or `skip-checks:true`) in a commit message or PR body, not even to deny it. Say "the skip trailer".
- Commits use explicit `git add <paths>`; no `Co-Authored-By`, `Claude-Session` or "Generated with Claude Code" lines (founder 2026-10-20, memory `no-ai-authorship-attribution`).
- EVERY ship writes a CHANGELOG entry in the same commit as the VERSION bump (`chore(release): vX.Y.Z.B - <name>`); `VERSION` and `package.json` stay byte-equal 4-digit strings; never `npm version`.
- A ship branch must change nothing under `.planning` (memory `ship-planning-guard`); planning-file edits (ROADMAP/STATE/CONTEXT corrections) go to main as a records PR after the ship.
- Cite code by symbol, not by restated line numbers or counts, in prose that will outlive the commit (`[164.7-CITATION-DRIFT-01]`). The line numbers below are for the planner's navigation at `8c8edc452` and will drift.
- CI mypy line (verbatim, `.github/workflows/ci.yml`, step "Type gate - mypy strict over the running-service surface", run from `analytics-service/`): `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`
- Agent gates include mypy (memory `agent-gates-include-mypy`): put the line above in every analytics-touching brief and pre-push check.
- pytest only from `analytics-service/`; always `grep -a`; a changed fixture/arm moves several censuses (grep them all).
- AGENTS.md: "This is NOT the Next.js you know" applies to Next.js code; this phase touches no Next.js route or component API (only `src/lib/queries.ts` and tests), so no `node_modules/next/dist/docs` read is needed.
- No project skills directory exists (`.claude/skills`, `.agents/skills` absent).

## Summary

The identity gate `duplicate_keys` in the allocator equity derive can never fire on a real double count. For a key `M` marked `duplicate` against a WORKING holder `H`: working implies eligible (`working_holder_predicate` requires active, not disconnected and a sync status outside revoked/sign_in_failed/error; `eligible_key_predicate` requires active, not revoked, not disconnected), `H` is in `key_rows` (a missing row is "not working"), and `account_groups` unions `M` with `H` because the marker kind is in `SHARED_ACCOUNT_KINDS`. So the group has at least two eligible members, and the group loop excludes every member except `kept`. Exactly one of `M`/`H` is counted, always. The gate therefore refuses books the loop already counted once, which is exactly the PROD defect (1 book, 2 marked duplicates, QUANTALYZE-2H nightly since 2026-10-20). The path after the gate (stitch, compose) is the same one the matrix fixture already composes for `composite_member` and for a duplicate behind a non-working holder, so removing the gate reuses battle-tested code.

The real double count stays covered without the gate: `account_identity_collisions` runs over `counted_rows` using `account_identity_tokens`, which unions keys by venue id AND by marker link, so two counted keys on one account (same venue id, or a marker pair that were both counted) collide. The reader cannot see a collision from the key list (it needs returns intervals), so the reader must stop deriving `duplicate_account` from the key list and learn about a collision only through the stored refusal token, which `untrustworthyRebuildReason` already maps.

**Primary recommendation:** Delete the `duplicate_keys` gate and its log/Sentry coupling in `job_worker.py`, retire `DeriveRefusal.ACCOUNT_DUPLICATE` from the writer vocabulary, delete `countsAsDuplicate` and its call in `equityHistoryReadiness` (keep the stored-token mapping of both `account_duplicate` (legacy rows) and `account_identity_collision`), flip 3 cells of `shared_account_resolution.json` as the RED test, and move the five mirrors listed under "Mirror inventory" in the same change. Then treat SC-4 as a measurement that may reveal a second blocker (this book's marked-duplicate stitch/compose path has never run on PROD).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Count one exchange account once (group resolution) | API / Backend (Python derive worker) | - | `account_groups` + the group loop in `derive_allocator_equity` decide which key counts. |
| Refuse a real double count (collision) | API / Backend (derive worker) | Database (refusal row in `allocator_equity_derived`) | Needs returns intervals, which only the writer has. |
| Decide "ready / rebuilding, reason" | Frontend Server (SSR producer `derivePhase07Fields` in `src/lib/queries.ts`) | Database (the stored v2 row) | The producer reads the key list and the stored row; it must not re-derive what the writer decides. |
| Panel / note copy | Browser / Client (React components) | - | Unchanged; `duplicate_account` panel line stays for collision. |
| Operator census mirror of the reader | Tooling (`scripts/accounttruth-census.mjs`, read-only SQL) | - | A SQL twin of the reader's rule; moves with it. |

## Standard Stack

No new libraries. Existing, verified by running them this session:

| Tool | Version | Purpose |
|------|---------|---------|
| pytest (analytics-service venv) | resolved from `analytics-service/.venv` | `.venv/bin/python -m pytest ...` ran 231 passed (derive job + matrix + refusal rows) in about 6 s [VERIFIED: ran this session] |
| vitest | `^5.0.3` in package.json (ran v5.0.5) | `npx vitest run <files>` ran 460 passed across the 5 reader files in under 2 s [VERIFIED: ran this session] |
| mypy (analytics-service venv) | `.venv/bin/mypy` present | CI strict surface line above |

**Installation:** none. **Package Legitimacy Audit:** this phase installs no external packages; the gate is not applicable. No banned package from CLAUDE.md is involved.

## Architecture Patterns

### Data flow (today and after)

```
api_keys rows ──> eligible_ids (eligible_key_predicate)
      │
      ├─> account_groups(key_rows)      holder + every key marked against it (SHARED_ACCOUNT_KINDS), transitive
      │       │
      │       └─> group loop: members = eligible members; pool = working members or all members
      │               kept = min(pool, key=(first_return_day, is_marked_in_group, id))
      │               excluded_shared = members - kept        ──> counted_ids = eligible_ids - excluded_shared
      │               (stitch_sources[kept] = older members' ids)
      │
      ├─> [REMOVED] duplicate_keys gate  ──> DeriveRefusal.ACCOUNT_DUPLICATE   (dead: see Q1)
      │
      ├─> collisions = account_identity_collisions(counted_rows + departed_end_by_key,
      │                                           venue token = account_identity_tokens: venue id OR marker link)
      │       └─ any ──> _persist_refusal(ACCOUNT_IDENTITY_COLLISION) + Sentry warning + return DONE   (KEPT)
      │
      └─> stitch / compose ──> v2 equity_curve row (benign flag duplicate_shared_account_counted_once)

reader (SSR): key list ──> equityHistoryReadiness: [REMOVED countsAsDuplicate] ─> identity pending ─> series
              stored row ──> untrustworthyRebuildReason: token account_identity_collision / legacy account_duplicate ─> duplicate_account
```

### Q1. Every case where an eligible `duplicate` key with a working holder is NOT counted once

Result: none. Proof by the guard conditions at `job_worker.py` (`duplicate_keys` list comprehension, then the group loop):

| Candidate "uncounted-once" case | Why it cannot reach `duplicate_keys` or why the loop still counts once |
|---|---|
| Holder not in `key_rows` | `rows_by_id.get(...)` is `None`, `working_holder_predicate(None)` is False: not in `duplicate_keys`. `account_groups` also does not merge (`str(holder_id) not in by_id`). [VERIFIED: allocator_equity_derive.py `working_holder_predicate`, `account_groups`] |
| Holder not eligible | Working implies eligible: working = `is_active is True`, `disconnected_at is None`, status not in `{revoked, sign_in_failed, error}`; eligible = `bool(is_active)`, `sync_status != "revoked"`, `disconnected_at is None`. So a working holder is always in `eligible_ids`. |
| `members < 2` (loop `continue`) | `M` and `H` are both eligible and both in the same `account_groups` group (marker kind `duplicate` is in `SHARED_ACCOUNT_KINDS`, holder differs from self and is in `by_id`), so `len(members) >= 2`. |
| Marker pointing outside the group | By construction `account_groups` unions the holder into `M`'s group; "outside" is impossible. A holder equal to self is excluded by the gate's own `!= row["id"]`. |
| Transitive chain `M -> H -> G` | One group; the loop still keeps exactly one member and puts all others in `excluded_shared`. |
| `M` or `H` counted twice via a stitch source | Stitch sources are older members of the same group; `counted_ids`/`returns_by_key` only carry kept keys plus sources (`k in counted_ids or k in stitch_source_ids or k in departed_end_by_key`), and the stitch joins them into one series. |

Because every gate hit is a pair the loop counts once, "narrowing" the gate to "both counted" yields the empty set. Mutation evidence (scratch copy of `analytics-service/` in the session scratchpad, repo untouched): with the gate neutered (`and False`) and the original fixture, exactly 3 matrix cells fail (the table says refuse, the derive composes), and 5 tests in `test_derive_allocator_equity_job.py` fail: `test_duplicate_with_working_holder_records_refusal`, `test_every_refusal_path_persists_a_reason_row[duplicate]`, `test_identity_refusal_is_a_warning_not_info[duplicate]`, `test_identity_refusal_reaches_sentry_as_an_event[duplicate]`, `test_duplicate_whose_marked_key_fails_behind_a_working_holder_still_refuses`. With the 3 cells flipped to compose, the whole matrix is 73 passed. [VERIFIED: ran this session]

Does the true double count stay covered? Yes, by `account_identity_collisions` over `counted_rows` with `venue_account_id = account_identity_tokens(key_rows)[id]`. The token unions two keys by equal `(exchange, venue_account_id)` OR by a marker link (`account_identity_tokens` in `allocator_equity_derive.py`). So two counted keys with the same venue id collide, and a marker pair that were both counted would also collide (same token, both open intervals). The existing test `test_identity_refusal_is_a_warning_not_info[collision]` and the revoked/disconnected-holder collision tests pin this and stay.

**Recommendation (discretion item):** remove `duplicate_keys` entirely and RETIRE `DeriveRefusal.ACCOUNT_DUPLICATE`. Its enum comment ("A marked duplicate behind a working holder: the account would be summed twice") is false by the proof above, and a kept-but-unreachable member would leave a fixture row and a precedence table that pin a state the writer cannot produce. Retiring moves these pins (all enumerated under Q3): `derive_refusal_rows.json` loses the `account_duplicate` refusal row and four precedence rows that mention it (they are checked as "producible" tokens), and `test_the_fixture_has_one_refusal_row_per_derive_refusal_member` keeps passing. Keep the READER tolerant of the legacy token (see Q2), because the one PROD row carries `account_duplicate` until the next derive replaces it. Pin the legacy token in the fixture as a separate `legacy_refusals` list consumed by the TS reader test and the census test, and add a Python assertion that no `legacy_refusals` token is a `DeriveRefusal` member, so it cannot be silently reintroduced. Alternative if the planner wants less churn: keep the enum member and its fixture row, mark it "legacy, unreachable" in the enum comment; every pin stays, but the vocabulary keeps a token with no producer.

Post-removal log line: drop `duplicate_keys=%d` from the WARNING and its argument; `reason` collapses to the collision token. Keep the Sentry static message shape (`derive_allocator_equity: {reason} - the equity curve was refused and recorded; the book shows the rebuilding panel`), tags `compute_job_id` and `derive_refusal`, and counts-only logging.

### Q2. Reader rule and every caller

The writer's rule after the change: refuse only on a collision, which needs returns intervals. A key list alone can never prove it. So the reader's rule is: **`equityHistoryReadiness` must not return `duplicate_account` from the key list at all**; `duplicate_account` is reachable only through the stored token via `untrustworthyRebuildReason` (`account_identity_collision`, plus legacy `account_duplicate`).

Concrete reader edits in `src/lib/queries.ts` (by symbol):
- Delete function `countsAsDuplicate` and the `apiKeys.some((key) => countsAsDuplicate(key, byId))` early return in `equityHistoryReadiness`. The order becomes: identity pending (`key_not_syncing` before `account_identity_pending`) then series/missing-series reason.
- `isWorkingHolder` is imported at the top of `queries.ts` and used only by `countsAsDuplicate`; after the delete it is an unused import (eslint `no-unused-vars` will fail `npm run lint`). Keep `NOT_WORKING_SYNC_STATUSES` (used by `failingToSync`). [VERIFIED: grep of queries.ts shows `isWorkingHolder` only at the import, a comment and `countsAsDuplicate`]
- Keep the `untrustworthyRebuildReason` mapping of `account_identity_collision` and `account_duplicate` to `duplicate_account`; rewrite the doc comment (item 2) to say the legacy token is a pre-Phase-183 row until the next derive replaces it.
- Rewrite stale prose: the `equityHistoryReadiness` doc ("Ready iff ... no eligible key is a duplicate of a working holder" and the "Review C2 fix coupling" warning), the `identityStillPending` comment ("Whether the pair then blocks ready is `countsAsDuplicate`'s question"), and the `notSyncingIdentityPendingKeyIds` doc ("... and no duplicate blocks first"). `derivePhase07Fields`'s comment "no working-holder duplicate" too.
- `identityStillPending` is unchanged: a marked duplicate whose holder is in the key list with a known `venue_account_id` is identity-known. The stamper only marks a key after it hit the holder's unique index, so the holder carries the id by construction; MT5 is not in `ACCOUNT_IDENTITY_EXCHANGES`. [CITED: `services/account_identity.py` module docstring; `VENUES_WITH_ACCOUNT_ID = {okx, bybit, binance, deribit}`; MT5 stamped from login text] This is the only residual writer/reader divergence to watch for SC-4: if a marked key's holder were absent or id-less in the key list the reader would still show `account_identity_pending` while the writer treats the pair as known (marker link). Existing tests already pin that reader behaviour; do not change it here.

Who else reads the rule (grep `-a` over the repo, excluding node_modules/.venv):
- `EquityHistoryRebuilding.tsx` (`REBUILD_REASON_CLASS`, `NeedsActionLine` case `duplicate_account`), `ScenarioComposer.tsx` (own-book line by class), `AllocationDashboardV2.tsx`, `RiskTabPanel.tsx`, `history-gate.ts`, `AlphaBetaDecomposition.tsx`, `book-risk-input.ts`: all consume only the producer's `equityHistoryState` / `equityHistoryRebuildReason`. No duplicate logic of their own. No code change; the `duplicate_account` line stays (exhaustive `satisfies Record<EquityHistoryRebuildReason, ...>` forces it to stay while the union member exists, and it still serves collisions).
- Exchanges page note: `accountShareNote` / `isWorkingHolder` in `src/lib/account-share-note.ts` (used by `AllocatorExchangeManager.tsx`, `ApiKeyManager.tsx`). It shares only the `isWorkingHolder` predicate with the old reader rule; changing `countsAsDuplicate` does not change it. Left as is pending the founder question.
- Other Python writers: only `derive_allocator_equity` refuses over a duplicate. `equity_reconstruction.py` (`_select_account_crawl_keys`, group at the daily refresh), `job_worker.py` NAV-mark group sizing and `account_identity.py` already count each group once and never refuse over a marked duplicate; `allocator_history_probe.py` only reads `working_holder_predicate`. [VERIFIED: `ACCOUNT_DUPLICATE` has exactly one use, in `job_worker.py`; grep over `analytics-service/` excluding tests/.venv]
- Holdings/AUM readers group by `keyAccountOf` -> `accountIdentityTokens` (`latest-holdings-per-key.ts`, Phase 170.4), so they already count a marked pair once; the 167.1.2 D-02 premise ("the derived curve double-counts a shared account") no longer holds for the curve either.

### Mirror inventory (everything that restates the rule; all must move together)

| # | Mirror | Where | Change |
|---|--------|-------|--------|
| 1 | Writer gate | `job_worker.py` `duplicate_keys` + `if duplicate_keys or collisions` + log line | remove gate; keep collision branch |
| 2 | Reader rule | `queries.ts` `countsAsDuplicate`, `equityHistoryReadiness` | remove (above) |
| 3 | Shared truth table | `analytics-service/tests/fixtures/shared_account_resolution.json` (+ `test_holder_matrix_parity.py`, `src/lib/__tests__/holder-matrix-parity.test.ts`) | flip 3 cells; reword notes |
| 4 | Refusal vocabulary | `derive_refusal_rows.json` (+ `test_derive_refusal_rows.py`, `derive-refusal-rows.test.ts`) | retire row; legacy list |
| 5 | SQL census mirror of the reader | `scripts/accounttruth-census.mjs`: `SQL_B` CTE `blocking` (`duplicate.blocking`, `duplicate.blocking_owners`, section `b` `required` and `gate`), `SQL_E` CTE `dup` and the state arm `WHEN dp.user_id IS NOT NULL THEN 'rebuilding:duplicate_account'`, header comments | remove `blocking`/`dup`; keep `duplicate.marked`, `duplicate.marked_live`; keep the CASE arms for the collision and legacy tokens |

The census was NOT named in CONTEXT; it is a third mirror whose header says it "mirrors queries.ts `countsAsDuplicate`" and whose gate (`duplicate.blocking`) would keep reading 1 while the reader says ready. The derive go-live runbook (`docs/runbooks/derivecron-go-live.md`) renders census label `e`'s `state` CTE through `__CENSUS_E__`, so it follows the script; its held-set text still names `rebuilding:duplicate_account`, which stays a valid state (collision/legacy), so no runbook edit is required. Check it reads true after the script change.

### Q3. Tests: flip, keep, add

Currently pinning the refusal (must change):

| File | Test / site | Action |
|---|---|---|
| `analytics-service/tests/fixtures/shared_account_resolution.json` | cells `duplicate / holder working / marked working`, `error`, `sign_in_failed` (today `"derive": {"outcome": "refuse", ...}` and `"reader": {"state": "rebuilding", "reason": "duplicate_account"}`) | set `"derive": {"outcome": "compose", "counted": ["H", "O"], "trustworthy": true}` and `"reader": {"state": "ready", "reason": null}`; update the `notes` string (it says "a duplicate behind a WORKING holder is refused") |
| `analytics-service/tests/test_holder_matrix_parity.py` | `refuse` branch asserts `["account_duplicate"]` | the table has no refuse cell left; keep the branch only if a collision cell is added, else delete it and the `_refusal_upserts`/`_curve_deletes` imports it alone uses |
| `src/lib/__tests__/holder-matrix-parity.test.ts` | "the reader says duplicate_account exactly where the derive refuses" | becomes "never from the key list"; keep as a guard (it stays true: no cell refuses) and reword |
| `analytics-service/tests/test_derive_allocator_equity_job.py` | `test_duplicate_with_working_holder_records_refusal`; `test_duplicate_whose_marked_key_fails_behind_a_working_holder_still_refuses`; param `duplicate` of `test_identity_refusal_is_a_warning_not_info` and `test_identity_refusal_reaches_sentry_as_an_event`; `_refusal_case_duplicate` in `test_every_refusal_path_persists_a_reason_row` | rewrite the first two to assert a composed curve (counted once, `duplicate_shared_account_counted_once` in `flags`, `is_trustworthy` true, no refusal upsert, no `account_duplicate` in the log); delete the `duplicate` params and the refusal case (the `collision` params and case stay) |
| `src/lib/queries.test.ts` | "a duplicate of a working holder is not ready, even with a v2 series"; IN-04 case whose last `toMatchObject` expects `equityHistoryRebuildReason: "duplicate_account"`; "duplicate wins over a missing account id" | first -> `ready`; IN-04 -> `key_not_syncing` with `equityHistoryNotSyncingKeyIds: ["k-bad"]`; third -> `ready` (marked key is identity-known through its holder's id) |
| `src/lib/queries.my-allocation.test.ts` | "plan 11: ... second key marked a duplicate of a working holder is rebuilding, reason duplicate_account" | -> `ready`, 3 return points drawn |
| `src/lib/queries.benchmark-feed.test.ts` | "rebuilding book: btcBenchmarkPrices is null ..." uses a working-holder duplicate to force rebuilding | switch the rebuilding trigger to another cause (for example a key with no venue id, `account_identity_pending`) so the test keeps its subject |
| `src/__tests__/accounttruth-census.test.ts` | line `duplicate.blocking: 1` in the CLI fixture run, `greenFixture` `b`, the "every gate bucket is required" list (`b: ["duplicate.blocking"]`), the real-PG `(b)` expectation, and `expect(table.refusals.length).toBeGreaterThanOrEqual(8)` | drop the blocking buckets; the population floor drops by one if the row is retired (7 members remain); add a real-PG (e) arm (below) |

Must STAY green (guards for SC-1 second half and for stale rows): `queries.test.ts` assertions that `account_identity_collision` and legacy `account_duplicate` tokens map to `duplicate_account` and the precedence assertions that use them; `test_duplicate_with_revoked_holder_is_a_collision`, `test_duplicate_with_disconnected_holder_is_a_collision`, `test_duplicate_with_revoked_holder_counts_when_alone`, the collision params; `OverviewRisk.history-parity.test.tsx`, `AllocationDashboardV2.rebuilding.test.tsx`, `ScenarioComposer.test.tsx` (they iterate reasons as input, not keys: still valid because `duplicate_account` stays a reason). `critical-regressions.test.ts` has no pin on this rule.

**New tests (RED first):**
1. The 3-cell fixture flip is the primary RED: it fails on the current gate (Python, 3 FAILED) and on the current `countsAsDuplicate` (TS holder-matrix cells, 3 FAILED). [VERIFIED for Python: scratch run, gate ON + flipped fixture = 3 FAILED; gate off + flipped fixture = 73 passed]
2. PROD-shaped derive test: a marked duplicate on `deribit` (key `M`, `venue_account_id=None`, `account_shared_with_api_key_id=H`, status `error` or `connected`) beside a working `H`, plus an `mt5` pair, using `_gate_key`, `_series_rows` (its 3 flat days and `key_inputs` row) and `_run_gate`; assert one composed curve, `payload["inputs"]["n_keys"]` counts the pair once, terminal equity equals the kept key's anchor (distinct anchors, as `_shared_pair` does), the flag, and `_refusal_upserts(fake) == []`.
3. Collision-still-refuses test with a marker pair: build `counted` rows from `account_identity_tokens` for `M`+`H` both open and assert `account_identity_collisions` returns one group of 2 (proves the retained gate covers the case the removed gate guarded, if the group loop ever regressed). Pure function test, no fake needed.
4. Census real-PG arm: seed the existing `SEED_A` owner (M1 duplicate of live holder S) with a v2 trustworthy row and assert section (e) prints `ready`, not `rebuilding:duplicate_account` (RED today because of the `dup` CTE).
5. Reader negative control retained for stale rows: `untrusted(["account_duplicate"])` still `duplicate_account` (already present).

How to show RED (CLAUDE.md protocol): commit the tests first against unmodified source and record the failing names; after the fix, neuter one seam at a time (the gate re-added in `job_worker.py`; `countsAsDuplicate` re-added in `queries.ts`) from a byte backup, see the named tests fail, and restore from the backup (no `git checkout/restore/stash`). The scratch method used here (copy `models routers scripts services tests` plus configs to the scratchpad, edit the copy, run with the repo venv from the copy) leaves the worktree untouched.

### Q4. Where "TODOS.md records these refusals as expected since 167.1.2.1.1 WRITERRESIDUALS" actually lives

- `grep -an "account_duplicate" TODOS.md` returns no hit, and no TODOS entry says the refusals are expected [VERIFIED: grep this session].
- The claim exists in `.planning/ROADMAP.md`, under the closed `### Phase 166.5.1: SENTRYTRIAGE` section, bullet "Out of scope, owned elsewhere: ... the `account_duplicate` refusals (QUANTALYZE-23 and 2H, expected since 167.1.2.1.1 WRITERRESIDUALS) ...". It is historical scope text for a closed phase.
- The Phase 183 ROADMAP entry and `183-CONTEXT.md` repeat it with the wrong file name ("`TODOS.md` records ...").
- Related lineage that is NOT edited: `CHANGELOG.md` entries that say the derive "refuses to compose when a working-holder duplicate ..." and "1 is held by design (duplicate account, D-06)"; `167.1.2-CONTEXT.md` D-01/D-02 ("Refuse a second key", "Hide it until correct"). D-02's premise (the derived curve double-counts a shared account until identity is resolved) is what the group resolution later made false for marked duplicates; Phase 183 D-01 supersedes it, with the founder's explicit decision of 2026-10-31.
- What must change (all `.planning`, so a records PR after the ship, not the ship branch): the Phase 183 ROADMAP sentence ("`TODOS.md` records these refusals as expected ...; that line changes with this phase") to name `ROADMAP.md` Phase 166.5.1's bullet; append a dated "SUPERSEDED by Phase 183" note beside that 166.5.1 bullet (do not delete it); STATE/ROADMAP progress rows at close. The product CHANGELOG entry for the ship carries the user-facing "Fixed" and "Root cause" notes. No TODOS.md edit is needed, unless the plan books the optional per-key-note follow-up there.

### Q5. SC-4: post-deploy PROD reading (orchestrator only; describe, do not run)

Order and shape (counts only, no ids, public-repo safe):
1. Marker query first (CLAUDE.md): `SELECT shobj_description(oid, 'pg_database') AS which_database FROM pg_database WHERE datname = current_database();` must name PRODUCTION (the expected string is `database_marker` in `scripts/prod-prober/cron-manifest.json`, read at run time, not restated). NULL means stop.
2. Refusal rows, read-only: counts of `allocator_equity_derived` where `kind = 'equity_curve'` grouped by `payload ->> 'refusal'` (the refusal payload carries the token in `refusal`, per `refusal_payload`), asserting `account_duplicate` = 0. Pair it with `count(*) FILTER (WHERE payload -> 'version' = '2'::jsonb AND payload -> 'is_trustworthy' = 'true'::jsonb AND computed_at >= <first post-deploy derive>)`.
3. Prefer the repo's own guarded tool for the book-level reading: `node scripts/accounttruth-census.mjs --print-sql=<label>` (marker, rls, then `d` and `e`), run one label per call as its header requires. Section `d` prints `degrade_reason=<token>` frequencies (the DUPCOUNT book must no longer carry `account_duplicate`, and `inception_unreconciled` must be absent after NAVMTM G-01 heals); section `e` prints owner states (`ready` should rise by one; `rebuilding:duplicate_account` falls to 0 once the stale row is replaced).
4. Trigger/await: the writer is `derive_allocator_equity`; the daily fan-out cron `derive-allocator-key-dailies` runs at 05:30 UTC (migration comments cite `:30 05`), so the stale refusal row is replaced by the first post-deploy derive of that allocator, normally the next 05:30Z run. Recent ships were deployed outside the 03:30-06:45Z window (ROADMAP Phase 167.1.2.1.1 row), so deploy outside it. The caller-scoped `set_departed_key_history_inclusion` RPC also enqueues a recompose but is a product write for a departed key, not a trigger to use here. "A pg_net cron success only means queued": read freshness from `allocator_equity_derived.computed_at`, never from the cron result.
5. Sentry QUANTALYZE-2H: its event is the static message `derive_allocator_equity: account_duplicate - the equity curve was refused and recorded; the book shows the rebuilding panel` (tag `derive_refusal=account_duplicate`). After the first post-deploy derive there must be no event newer than the deploy. ROADMAP also names QUANTALYZE-23 as the same family; confirm in Sentry (read-only) whether it is the same message before closing both. The collision message is a different group and may still appear legitimately.
6. NAVMTM G-01 dependency: v0.133.13.0 says "The two affected books heal on the next nightly derive". The DUPCOUNT book's trustworthy reading needs both this phase and G-01 to have run in one nightly derive. If the book is still untrustworthy, name the token from census `d` before concluding.

**Second-order risk to put in the plan (SC-4 may not go green on the first night):** the refusal today fires BEFORE stitch and compose, so this book's marked-duplicate group (kept key vs an older excluded member, `stitch_shared_account`, writer-basis join, Deribit/MT5 specifics) has never been composed on PROD. The code path is shared with `composite_member` and with duplicates behind a non-working holder (both composed in the matrix), but PROD data can still produce `shared_account_history_truncated`, `shared_account_flows_disagree`, `dropped_key` or the writer-basis notes. Plan SC-4 as a measurement with a named contingency (record the token, route a follow-up phase; never claim "trustworthy" on the strength of "no longer refused").

### Q6. Gates (commands verified to run in this worktree)

The worktree has its own `analytics-service/.venv` (copy of the layout, has pytest and mypy) and `node_modules` is a symlink to the main checkout's. No `git worktree list --porcelain` resolution was needed here.

| Gate | Command (cwd) | Notes |
|---|---|---|
| Python targeted | `analytics-service/`: `.venv/bin/python -m pytest tests/test_derive_allocator_equity_job.py tests/test_holder_matrix_parity.py tests/test_derive_refusal_rows.py -q -p no:cacheprovider` | baseline GREEN 231 passed, about 6 s |
| mypy strict (CI line, verbatim) | `analytics-service/`: `.venv/bin/mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | removal only, but run it: an unused `rows_by_id` or `working_holder_predicate` import after the delete would still type-check; check both are still used (`rows_by_id` is used elsewhere; `working_holder_predicate` is used by the group loop) |
| vitest targeted | repo root: `npx vitest run src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts src/lib/queries.benchmark-feed.test.ts src/lib/__tests__/holder-matrix-parity.test.ts src/lib/__tests__/derive-refusal-rows.test.ts src/__tests__/accounttruth-census.test.ts` | baseline GREEN (460 passed for the first five, 53 for the census file, which runs a throwaway local PostgreSQL via initdb) |
| Rendering suites | `npx vitest run "src/app/(dashboard)/allocations"` | covers EquityHistoryRebuilding / parity / rebuilding tests |
| Typecheck, lint | `npm run typecheck`; `npm run lint` | lint includes `check-planning-hygiene.ts` and eslint (`isWorkingHolder` unused import) |
| Python full suite (CI uses xdist and the local-stack lane) | `make test` equivalent: `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` | CI-only breadth; targeted runs are enough per task |

### Anti-Patterns to Avoid
- **Narrowing the gate instead of removing it.** By the proof above the narrowed set is empty; a dead guard that can only fire on a future bug is untestable (cannot construct the input through the loop) and re-creates a vocabulary entry nobody can produce.
- **Fixing the writer only.** The reader blocks from the key list before the series is read; the panel stays on screen (CONTEXT warning, confirmed by `equityHistoryReadiness` ordering).
- **Dropping the reader's legacy-token mapping.** `account_duplicate` would fall through to `derivation_rejected` ("did not pass its checks") for the stale PROD row until the next derive.
- **Editing only the Python or only the TS half of the fixture-table pin.** Both consumers read the same JSON in place; edit the JSON once.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Is this account counted once?" | a second check in the identity gate | `account_groups` + the group loop result (`counted_ids`) | One implementation, shared with both allocator writers |
| Detecting a real double count | a new marker-pair check | `account_identity_collisions` with `account_identity_tokens` | Already unions by venue id and marker link and handles departed intervals |
| Reader/writer agreement | prose comments | the shared JSON truth tables (`shared_account_resolution.json`, `derive_refusal_rows.json`) read by both runtimes | Either side drifting reddens CI |

## Common Pitfalls

### Pitfall 1: Unused import / dead param breaks lint, not tests
**What goes wrong:** `isWorkingHolder` stays imported in `queries.ts` after `countsAsDuplicate` is deleted; the test suite is green and `npm run lint` is red.
**How to avoid:** run `npm run lint` in the plan's gate list, not only vitest.

### Pitfall 2: Fixture precedence rows are checked as "producible"
**What goes wrong:** retiring the enum member while four `precedence` rows still list `account_duplicate` fails `test_every_precedence_row_names_an_existing_line_over_known_tokens`.
**How to avoid:** rewrite those rows with `account_identity_collision` (same expected `reader_reason`) and move the legacy pin to a `legacy_refusals` list.

### Pitfall 3: Census population floors and gates
**What goes wrong:** the census test asserts `table.refusals.length >= 8`; retiring a row leaves 7. The CLI test also expects `duplicate.blocking: 1`.
**How to avoid:** change the floor deliberately and drop the blocking buckets from `required` and `gate` in the same commit; grep the census test for `blocking` (lines near 392, 451, 515-527, 907-908 at this base).

### Pitfall 4: The Sentry/log assertions
**What goes wrong:** removing the gate leaves `duplicate_keys=%d` in the WARNING format string or its argument list (`len(duplicate_keys)` raises NameError at the first collision).
**How to avoid:** the collision tests (`test_identity_refusal_is_a_warning_not_info[collision]`, `..._reaches_sentry_as_an_event[collision]`) exercise the branch; keep them in the quick command.

### Pitfall 5: Deploy ordering is transient but visible
**What goes wrong:** Vercel (reader) and Railway (writer) deploy independently; Railway deploys only after main CI is green. Reader-first leaves the stale `account_duplicate` row showing the duplicate line (legacy mapping) until the next derive; writer-first writes a good curve that the OLD reader still blocks until Vercel ships. Both resolve within one release and one nightly derive; ship both in one PR so it is hours, not a state.

### Pitfall 6: First-ever compose of this book's group
See Q5 "second-order risk". Also the kept key is chosen by (first returns day, unmarked first, id): with equal start days the holder is kept; an older marked key becomes a stitch source.

### Pitfall 7: Public-repo hygiene in the new tests and CHANGELOG
Use synthetic ids (`key-H`, `key-M`, `venue-shared`) as the existing tests do; no PROD key ids, user ids, `_usd` amounts or credential-shaped literals in CHANGELOG prose (gitleaks push-to-main scan).

## Code Examples

Writer: collision-only refusal (replaces the `duplicate_keys` block and the `if duplicate_keys or collisions` branch; symbols from `job_worker.py` as read):

```python
    # Identity gate. A marked duplicate needs no gate of its own: the group loop above
    # already counts each marked pair once (one kept key, the rest in excluded_shared).
    # A real double count is two COUNTED keys on one account, which the collision check
    # below sees through account_identity_tokens (venue id OR marker link).
    ...
    if collisions:
        reason = DeriveRefusal.ACCOUNT_IDENTITY_COLLISION.value
        await _persist_refusal(reason)
        ...
        logger.warning(
            "derive_allocator_equity: %s for allocator %s "
            "(counted_keys=%d colliding_groups=%d) - recorded the refusal in the "
            "equity_curve row; the book shows the rebuilding panel until the keys "
            "are resolved",
            reason, allocator_id, len(counted_rows), len(collisions),
        )
        return DispatchResult(outcome=DispatchOutcome.DONE)
```

Truth-table cell after the flip (values quoted from the fixture's current shape; flipped fields marked):

```json
{
  "kind": "duplicate", "holder": "working", "marked": "working",
  "derive": { "outcome": "compose", "counted": ["H", "O"], "trustworthy": true },
  "reader": { "state": "ready", "reason": null }
}
```
(`marked` also `"error"` and `"sign_in_failed"`; the same two blocks.) [VERIFIED: with the gate removed in a scratch copy the matrix passes 73/73 for exactly this table.]

Reader: `equityHistoryReadiness` without the key-list duplicate block:

```ts
export function equityHistoryReadiness(apiKeys, series, missingSeriesReason = "awaiting_derivation") {
  const byId = new Map<string, EquityHistoryKey>();
  for (const key of apiKeys) byId.set(key.id, key);
  const pending = apiKeys.filter((key) => identityStillPending(key, byId));
  if (pending.some(failingToSync)) return { state: "rebuilding", reason: "key_not_syncing" };
  if (pending.length > 0) return { state: "rebuilding", reason: "account_identity_pending" };
  if (!series) return { state: "rebuilding", reason: missingSeriesReason };
  return { state: "ready", reason: null };
}
```

Fixture additive section for the legacy token (suggested, consumed by `derive-refusal-rows.test.ts` and the census (e) test; `test_derive_refusal_rows.py` asserts none of these tokens is a `DeriveRefusal` member):

```json
"legacy_refusals": [ { "token": "account_duplicate", "reader_reason": "duplicate_account" } ]
```

## State of the Art

| Old approach | Current approach | When | Impact |
|--------------|------------------|------|--------|
| 167.1.2 D-02 "Hide it until correct": refuse any book with a marked duplicate behind a working holder | Count once via the group loop (D-01, D-04, D-18), draw the curve (Phase 183 D-01) | founder 2026-10-31 | the identity gate is retired; collision remains |
| Refusal deleted the curve row | Refusal persisted as a v2 row with a token (167.1.2.1.1 D-04) | 2026-10-19 | stale `account_duplicate` row persists until the next derive replaces it |

**Deprecated by this phase:** `countsAsDuplicate`, `duplicate_keys`, `DeriveRefusal.ACCOUNT_DUPLICATE` (writer side), census `duplicate.blocking*`.

## Runtime State Inventory

Not a rename phase, but the one stored artifact that carries the old token:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | One PROD `allocator_equity_derived` `equity_curve` row with `refusal = account_duplicate` (counts from the ROADMAP evidence) | None by hand: the next derive of that allocator upserts a v2 curve over it (`on_conflict=allocator_id,kind`). Keep the reader's legacy mapping until then. Do not hand-edit the row (prefer the product path). |
| Live service config | Sentry issue QUANTALYZE-2H (and possibly 23) is a grouped issue on a static message | After SC-4, resolve/mark per the sentry-triage runbook; no code. |
| OS-registered state | None - verified: no cron or task embeds the token | None |
| Secrets/env vars | None - verified: no env var or secret names the token | None |
| Build artifacts | None - the change is source-only; no egg-info or image tag carries it | None |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The stamper only marks `M` against a holder that already carries the id that `M` collided with, so a marked key's holder is id-known in the key list (Deribit/MT5) | Q2 `identityStillPending` | If a holder were id-less, the reader would show `account_identity_pending` for this book while the writer composes; SC-4 would show `ready` false with that reason. Reader/writer divergence, fixable but outside this phase. [ASSUMED from module docstrings; PROD data not read] |
| A2 | The PROD book's group composes without a stitch/basis blocker once the gate is gone | Q5 second-order risk | SC-4 needs a follow-up phase for the named token. [ASSUMED] |
| A3 | The nightly 05:30Z fan-out replaces the stale row on the first post-deploy night | Q5 | If the allocator's derive is not enqueued that night the stale row (and the legacy panel) lasts another day. [CITED: migration comments `:30 05 derive-allocator-key-dailies`; not observed] |
| A4 | QUANTALYZE-23 is the same message family as 2H | Q5 | Only affects which Sentry issue gets resolved. [ASSUMED from ROADMAP text] |
| A5 | The remaining TS tests listed for flipping are complete | Q3 | The TS side was enumerated by grep, not by a neutered run; the plan's RED step (neuter `countsAsDuplicate`, run the full vitest set once) should confirm the list. The Python side was confirmed by a neutered run (exactly the 5 + 3 above). |

## Open Questions

1. **Per-key "duplicate" note on the Exchanges page (founder call; confirmed and refined).**
   - Evidence: the note (`accountShareNote`, pinned by `AllocatorExchangeManager.test.tsx`, `...liveness.test.tsx`, `ApiKeyManager.test.tsx`, `account-share-note.test.ts`) says "This key reads the same exchange account as <holder>. Disconnect one of them." It is independent of `countsAsDuplicate` (shares only `isWorkingHolder`), so this phase does not change it unless told to. After D-01 it is an imperative about a state the founder says is intended and the book now handles.
   - Recommendation to put to the founder: keep the note as information with the imperative sentence reworded; DEFAULT for this phase: leave it untouched (zero code, zero risk) and book the copy as a small follow-up if the founder wants it changed. Not decided here.
2. **Copy of the `duplicate_account` panel line, now collision-only.** "Two of your keys read the same exchange account. Disconnect one of them on the Exchanges page and the history rebuilds." The DB unique index keeps two LIVE keys from sharing a venue id, so a collision now typically involves a departed key overlapping a live one, where "disconnect one" may not be the right remedy. Product/copy call; this phase leaves the line as is.
3. **Should the Overview say a key is counted once?** The writer already emits the benign flag `duplicate_shared_account_counted_once`; nothing in the UI reads it (only a `queries.test.ts` fixture mentions it). Surfacing it is a product choice; not needed for SC-1..SC-4.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python venv with pytest and mypy | Python RED/GREEN, mypy gate | yes | `analytics-service/.venv` in the worktree | - |
| Node with vitest | TS tests | yes | vitest 5.0.5 via symlinked `node_modules` | - |
| Local PostgreSQL (initdb) | `accounttruth-census.test.ts` section (6) | yes (53 tests passed) | system PostgreSQL binaries | - |
| PROD / TEST database | SC-4 | not used by dispatched agents | - | orchestrator-run reading only |

## Validation Architecture

(`workflow.nyquist_validation` is `True` in `.planning/config.json`.)

### Test Framework
| Property | Value |
|----------|-------|
| Frameworks | pytest (analytics-service venv) and vitest 5.x |
| Config | `analytics-service/pytest.ini`; `vitest.config.ts` |
| Quick run (Python) | from `analytics-service/`: `.venv/bin/python -m pytest tests/test_derive_allocator_equity_job.py tests/test_holder_matrix_parity.py tests/test_derive_refusal_rows.py -q -p no:cacheprovider` |
| Quick run (TS) | from repo root: `npx vitest run src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts src/lib/queries.benchmark-feed.test.ts src/lib/__tests__/holder-matrix-parity.test.ts src/lib/__tests__/derive-refusal-rows.test.ts src/__tests__/accounttruth-census.test.ts` |
| Full suite | `npx vitest run`; analytics full pytest as in the Q6 table (CI) |

### Phase Requirements -> Test Map
| ID | Behavior | Test Type | Automated Command | File Exists? |
|----|----------|-----------|-------------------|-------------|
| SC-1 | marked duplicate behind a working holder composes once and is trustworthy | unit (derive, fake Supabase) + shared table | `pytest tests/test_holder_matrix_parity.py tests/test_derive_allocator_equity_job.py` | yes (edit); PROD-shaped Deribit/MT5 test is new |
| SC-1 | two counted keys on one account still refuse (`account_identity_collision`) | unit | same files, `-k collision` | yes (stays) + new marker-pair collision unit |
| SC-2 | reader says `ready` for the same cells; never `duplicate_account` from the key list | unit (vitest) | `vitest run src/lib/__tests__/holder-matrix-parity.test.ts src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts` | yes (edit) |
| SC-2 | stale `account_duplicate` and live `account_identity_collision` tokens still map to `duplicate_account` | unit (vitest) | `vitest run src/lib/__tests__/derive-refusal-rows.test.ts src/lib/queries.test.ts` | yes; `legacy_refusals` consumer is new |
| SC-2 | census mirror agrees with the reader | real-PG (throwaway cluster) | `vitest run src/__tests__/accounttruth-census.test.ts` | yes (edit) + new (e) arm |
| SC-3 | tests are RED on the current refusal | RED log + neuter/restore | tests committed first, failing names recorded; then neuter `duplicate_keys`/`countsAsDuplicate` seams one at a time from byte backups | to be produced by the executor |
| SC-4 | PROD: 0 `account_duplicate` rows, book trustworthy, no new QUANTALYZE-2H event | manual, orchestrator only | read-only SQL / census `--print-sql`, Sentry read | n/a (post-deploy) |
| gates | types and lint | static | mypy line (Q6), `npm run typecheck`, `npm run lint` | yes |

### Sampling Rate
- **Per task commit:** the two quick runs above (about 10 s each).
- **Per wave merge:** quick runs plus `npx vitest run "src/app/(dashboard)/allocations"`, mypy line, `npm run lint`.
- **Phase gate:** full CI green bound to the head SHA with the expected check count, then SC-4 by the orchestrator.

### Wave 0 Gaps
- [ ] RED tests committed before any source change: fixture flip (3 cells), PROD-shaped derive test, marker-pair collision unit test, census (e) real-PG arm, reader flips in `queries.test.ts` / `queries.my-allocation.test.ts`.
- [ ] `legacy_refusals` section in `derive_refusal_rows.json` plus its three consumers.
- No framework install needed.

## Security Domain

`security_enforcement` is absent in config (treated as enabled). This phase changes decision logic only; it adds no endpoint, input or secret.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2/V3 Authentication, Session | no | unchanged |
| V4 Access Control | no | the reader still reads only the owner's keys and row (unchanged) |
| V5 Input Validation | yes (existing) | the derive's strict per-row parsing is untouched; the reader keeps defensive JSONB reads |
| V6 Cryptography | no | none |
| V7 Logging | yes | T-167.1.2-22: counts and a closed token only; no key id, venue id or USD in the WARNING or the Sentry message (tests assert `key-D`/`venue-*` absent) |

| Threat pattern | STRIDE | Mitigation |
|---|---|---|
| Double-counted capital shown as a curve (data integrity) | Tampering | collision gate over tokens (venue id OR marker) retained; unit test proves a marker pair collides |
| Tenant identity leak through logs/Sentry | Information disclosure | keep the static Sentry message and counts-only log |

## Sources

### Primary (HIGH confidence; read this session)
- `analytics-service/services/job_worker.py` (`derive_allocator_equity`: group loop, `duplicate_keys`, collisions, stitch, compose, benign flags; `account_identity_collisions`, `account_identity_tokens` wrapper)
- `analytics-service/services/allocator_equity_derive.py` (`DeriveRefusal`, `refusal_payload`, `eligible_key_predicate`, `working_holder_predicate`, `SHARED_ACCOUNT_KINDS`, `account_groups`, `account_identity_tokens`, `identity_pending_venues`)
- `src/lib/queries.ts` (`untrustworthyRebuildReason`, `EquityHistoryRebuildReason`, `countsAsDuplicate`, `identityStillPending`, `notSyncingIdentityPendingKeyIds`, `equityHistoryReadiness`, `derivePhase07Fields` region), `src/lib/account-share-note.ts`
- Tests and fixtures: `shared_account_resolution.json`, `derive_refusal_rows.json`, `test_holder_matrix_parity.py`, `test_derive_refusal_rows.py`, `test_derive_allocator_equity_job.py`, `holder-matrix-parity.test.ts`, `derive-refusal-rows.test.ts`, `queries.test.ts`, `queries.my-allocation.test.ts`, `queries.benchmark-feed.test.ts`, `accounttruth-census.test.ts`, `scripts/accounttruth-census.mjs`
- `.github/workflows/ci.yml` (mypy step), `analytics-service/Makefile`, `package.json`, `.planning/config.json`, `.planning/ROADMAP.md` Phase 183 and 166.5.1, `CHANGELOG.md` v0.133.13.0, `167.1.2-CONTEXT.md` D-01/D-02
- Scratch mutation runs (session scratchpad copy of `analytics-service/`; repo `git status` clean afterwards)

### Secondary / Tertiary
- None. No web research was needed; the domain is entirely in-repo.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new packages; tool versions observed by running them.
- Architecture (gate is dead, collision covers the real case): HIGH - code read plus a neutered run in a scratch copy.
- Reader/mirror inventory: MEDIUM-HIGH - Python side confirmed by run; TS and census lists by grep and reading (A5).
- SC-4 outcome: MEDIUM - the first compose of this book's group on PROD is unobserved (A2).

**Research date:** 2026-11-01
**Valid until:** 2026-11-08 (fast-moving: sibling phases touch `job_worker.py` and the same fixtures; re-measure line anchors at the plan's base)

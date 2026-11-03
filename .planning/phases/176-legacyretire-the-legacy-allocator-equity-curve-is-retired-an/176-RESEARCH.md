# Phase 176: LEGACYRETIRE - Research

**Researched:** 2026-10-31
**Domain:** Retiring a legacy Postgres table (`public.allocator_equity_snapshots`) across a Next.js reader, a Python worker, SQL RPCs, pg_cron, CI census gates and operator tooling, in three ordered PRs.
**Confidence:** HIGH for the census and the reader/writer anatomy (every anchor re-measured at HEAD `0d8aad242`); MEDIUM for the derived-series replacement definitions and the D-03 formula (design choices with evidence, flagged for confirmation); the reconstruct-job scope is an OPEN QUESTION that decides plan size.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** "176 absorbs both (Recommended)" (founder 2026-10-31).
  - 176 moves the readers above to the derived series and stops the legacy writes.
  - **182 SPIKEREPAIR closes as superseded.** Its 22 spike days exist only in the legacy rows, and nothing reads those once 176 ships.
  - **181 SHAREDKEYS is done inside 176.** The derive already selects keys by `eligible_key_predicate` with no strategy-link exclusion (`job_worker.py` ~:14444; `derive.py` ~:331). The remaining exclusion is the TS reader rule `allocatorEligibleApiKeyIds` (`queries.ts` ~:6101-6111), and it is changed to the founder rule of 2026-10-31: one key can serve a manager and allocators at once, so a strategy-linked key also counts in its owner's allocator book. The legacy bootstrap's link filter goes away together with the legacy writer.
  - 181's success criterion 4 ("every allocator holding non-Deribit positions has a snapshot for the closed day") becomes: every such allocator has a derived curve point for the closed day.
  - The ROADMAP entries for 181 and 182 each get a dated line recording this, and they close with 176.
- **D-02:** "Drop the table" (founder 2026-10-31). - **Reversibility:** one-way - the migration drops `allocator_equity_snapshots` and its rows; undoing it needs a restore from backup.
  - The writers go too: `persist_equity_snapshots`, the two replace RPCs, the refresh job's legacy write and the bootstrap gate.
  - The table is also removed from `delete_allocator_api_key`, the GDPR export manifest and the tooling lists.
  - **Order (orchestrator constraint, not a new decision):** first every reader moves, and the move is deployed and read live on PROD. Then the writes stop. The drop ships last, in its own migration and PR.
  - The PROD apply runs automatically after TEST (CLAUDE.md, 2026-09-23), so every review the drop needs (migration-reviewer, rls-policy-auditor, data-dependence lint) happens before merge.
- **D-03:** "Derived account total" (founder 2026-10-31). The +30d and +90d outcome is measured on the account's derived equity, not on the symbol's value from the breakdown.
  - This changes what the outcome means. Copy or labels that say the outcome is per symbol must say per account.
  - Outcomes already stored keep their values. Whether they are recomputed is the planner's question to raise, not assumed.

### Claude's Discretion
- What replaces the warm-up gate, depth months and baseline flag on the derived series. For example, the derived curve's day count for the 30-day gate, and its first realized day for depth. Each must be stated once and tested.
- Whether the `breakdown` column's other uses, if any turn up, move to `allocator_holdings`.

### Deferred Ideas (OUT OF SCOPE)
- None.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are mapped to this phase (null). The behaviours below are keyed to the ROADMAP `### Phase 176` success criteria (SC-1..SC-3) and to Phase 181's rewritten SC-4. `B-nn` ids in the Validation Architecture section are research-local labels, not REQUIREMENTS.md ids.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | A census lists every reader of the legacy curve; each moves to the marked series or is removed | `## Census` (readers, writers, tooling, tests, censuses) |
| SC-2 | The legacy writers stop; the cron manifest matches | `## Writers, jobs and crons`; `refresh-allocator-equity` must be unscheduled and the manifest re-captured |
| SC-3 | The two MARKSOURCE legacy-exclusion TODOS entries close | `## TODOS closure` |
| 181 SC-4 (rewritten) | Every allocator holding non-Deribit positions has a derived curve point for the closed day | `## PROD-read verification` (forms R1, R2) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from `CLAUDE.md` (project, checked in), `AGENTS.md`, and the user's global rules. The planner must treat these as locked.

- **Which database am I on (ask FIRST).** The checkout's Supabase CLI link targets PRODUCTION. Run the marker query before any write; `current_database()` proves nothing. Never `supabase db push` / `db reset --linked`. PROD migrations auto-apply after `apply-test`; the Production reviewer gate is gone (2026-09-23), so every review (migration-reviewer, rls-policy-auditor, data-dependence lint) happens BEFORE merge. Do not edit `supabase-migrate.yml` to get a deploy out; the remedy for a bad merge is to revert it.
- **TEST holds catalogue, not data.** A migration whose self-check reads rows and RAISEs can pass PROD and refuse on TEST, and that blocks the PROD apply. Self-verification must be catalogue-only (see `## Migration constraints`).
- **CHANGELOG discipline (every ship).** Each of the three PRs writes a CHANGELOG entry in the `chore(release): vX.Y.Z.B` commit with a VERSION bump; `VERSION` and `package.json` byte-equal; never `npm version`. Entry sections are this repo's vocabulary (`### Fixed/Added/Changed/Removed/Tests/Notes/Security/Root cause/Why`). Never quote a credential-shaped literal in CHANGELOG prose.
- **Never write a CI skip token** (any of the bracketed skip phrases or the checks-skip key) in a commit message or PR body, not even to deny it. A squash merge concatenates every branch commit message.
- **Ship branch must change nothing under `.planning/`** (memory: ship-planning-guard). Planning records go to main afterwards.
- **No AI authorship attribution** in commits (founder 2026-10-20), despite the harness reminder; follow the user's rule.
- **Public repo with `.planning/` tracked:** no secrets, PROD ids, home paths or account numbers in tracked text. Counts-only PROD readings. Never quote a search pattern as proof of absence.
- **Completion is historical; use `verified_at_sha` + `drift_subjects`** in VERIFICATION frontmatter; never `covered_digest` / `covered_files`; never list `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` in `drift_subjects`.
- **Do not hand-dispatch `gsd-*` agents; execute via `/gsd-execute-phase N`** (memory). gsd-tools state handlers are safe on the reshaped ROADMAP/STATE but `git diff` after each run.
- **Tests verify intent:** a data-integrity or user-facing gate must be able to fail: neuter, see RED, restore from a byte backup (never `git checkout/restore/stash` on uncommitted work). Always `grep -a`. A new/removed `supabase/tests` file or arm moves several censuses: grep them all. pytest only from `analytics-service/`; never `importlib.reload` in tests. CI's mypy line verbatim (below).
- **Before `CREATE OR REPLACE`, re-base on the latest definition across all migrations.** SECDEF helpers in `{public}` policies need anon EXECUTE. Deletion-cascade guards must exempt `quantalyze.sanitize_in_progress='on'`.
- **PROD reads AND writes are authorized** (founder 2026-10-03): marker query first, `supabase db query --linked -f <file>` (a leading `--` comment breaks the inline form), prefer the product's own paths over hand SQL.
- **AGENTS.md:** "This is NOT the Next.js you know" - read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code. This phase's TS edits are in a server-only data module and client components already in use; no new Next.js API is introduced, but any new Server Component or route code must be checked against those docs.
- **DESIGN.md** governs any visual change (copy removal in KpiStrip / banner removal must not alter styling).
- **Analytics-touching briefs include mypy** (memory: agent-gates-include-mypy).
- **Currency/annualization/PROD-data rules** (memory) are not touched by this phase; "never invent data: uncomputable metrics are null" applies to the bridge outcome (a missing derived day yields NULL, never a number).

## Summary

`public.allocator_equity_snapshots` has exactly one product reader, `getMyAllocationDashboard` in `src/lib/queries.ts` (one `.from()` at :5391), plus one SQL reader chain (`extract_symbol_value_at` called by `compute_bridge_outcome_deltas`), one SQL reader inside `enqueue_refresh_allocator_equity_for_all`, one SQL writer-side reader inside `delete_allocator_api_key`, one Python reader (`_owed_reconstructs_for_zero_snapshot_book`), the GDPR export manifest, and operator tooling. Every other mention is a writer, a test, a census pin, or prose. The dashboard chart and the embedded factsheet already draw `allocator_equity_derived` kind `equity_curve`; what the legacy table still feeds is four *derived values* (`snapshotCount`, `minHistoryDepthMonths`, `equityBaselineUnknown`, and the unused `equitySnapshots` array), the bridge-outcome holding branch, and the zero-history bootstrap.

Three findings shape the plan. (1) **The reconstruct and refresh jobs have no product output other than this table** (and, for reconstruct, the `api_keys.history_reconstructed_at` marker, audit events and a `snapshot_rebuild_boundary` derived row). Stopping their writes strands a large machinery (attempt cap, marker, "history reconstruct failed" note, orphan-sweep Sentry, trade-read store, probe scripts, three enqueue paths including the user-facing `request_allocator_holdings_sync`). D-02 does not say whether the reconstruct *job kind* is retired or only its writes; that is Open Question 1 and it decides whether PR 2 is medium or very large. `services/equity_reconstruction.py` itself must NOT be deleted wholesale: the derive path imports `read_marked_equity_usd`, `read_okx_option_exposure`, `EquityCurveBuilder`, `_NO_CAPITAL_ANCHOR_REASONS` from it. (2) **A cron changes:** `refresh-allocator-equity` (`SELECT enqueue_refresh_allocator_equity_for_all();`) has no purpose after PR 2 and must be unscheduled by a hand-run PROD step (the repo's convention is that cron jobs are not moved by migrations), then `cron-manifest.json` re-captured, before PR 3 drops the function. (3) **The old Phase 151 AUM-04 role rule is inverted** by the founder's 181 rule; ~15 test blocks pin the old behaviour and the composer's `managerSideKeyIds` / `excludedManagerSide` disclosure becomes dead.

**Primary recommendation:** Ship in the ordered three PRs of D-02, with PR 2 gated on the founder's answer to Open Question 1; in PR 1 define `snapshotCount` = days of the drawn derived curve, delete `minHistoryDepthMonths` and `equityBaselineUnknown` (the derived series has no concept either one measures; a span-based depth degenerates, see `## Derived-series replacements`), switch `allocatorEligibleApiKeyIds` to "every eligible key", and re-base `compute_bridge_outcome_deltas` so the holding branch reads the derived `equity_curve` row (raise the curve-ratio vs flow-neutral-returns formula and the recompute question); in PR 3 make the migration catalogue-only, drop dependents first, and let the existing AUTOREDUMP pipeline regenerate the baseline.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Dashboard warm-up / depth / baseline values | API / Backend (`getMyAllocationDashboard`, server-only `queries.ts`) | Browser (KpiStrip, ScenarioComposer, AllocationDashboardV2 render them) | The payload is built server-side from RLS-scoped reads; the client only renders props |
| Allocator-eligible key rule (`allocatorEligibleApiKeyIds`) | API / Backend (`queries.ts`) | Browser (ScenarioComposer reads the field, never re-derives) | `live-holdings-summary.ts` documents "never a re-derivation of either predicate on the client" |
| Bridge outcome deltas | Database / Storage (pg_cron -> `compute_bridge_outcome_deltas`) | - | Pure DB-side batch; no worker or app involvement |
| Legacy snapshot writes (refresh, reconstruct, replace RPCs) | Analytics worker (Railway Python) + SECURITY DEFINER RPCs | Database (fan-out function, cron) | These are the things being retired |
| Derived equity series (`equity_curve`) | Analytics worker (`derive_allocator_equity` compose) | Database (`allocator_equity_derived`, owner-RLS SELECT) | Already the display source; unchanged by this phase |
| Cron schedule (`refresh-allocator-equity`) | Database (pg_cron, PROD-only catalogue) | Repo manifest (`scripts/prod-prober/cron-manifest.json`) | Cron rows live in PROD `cron.job`, not in migrations; the manifest is the drift oracle |
| GDPR export manifest | API / Backend (`src/lib/gdpr-export-manifest.ts`) | CI script `scripts/check-gdpr-export-coverage.ts` | Table list is code; coverage script fails CI on drift |
| Baseline dump / carried-migrations marker | CI automation (AUTOREDUMP bot PR) | Database (PROD) | Regenerated after the PROD apply; not hand-edited |

## Standard Stack

No new external packages. Everything is the repo's existing toolchain.

### Core (existing, verified present in this environment)
| Tool | Version | Purpose | Why standard |
|------|---------|---------|--------------|
| vitest | 5.0.5 `[VERIFIED: ran `npx vitest run src/lib/queries.my-allocation.test.ts -t "TC p7-03"` -> 1 passed, 1.08s]` | TS unit/contract tests | Repo test runner (`npm test`) |
| pytest | 9.0.2 (Python 3.14.3) `[VERIFIED: ran tests/test_fanout_owed_predicate_twins.py -> 24 passed]` | Worker tests; run only from `analytics-service/` | Repo rule |
| mypy | 2.0.0 `[VERIFIED: mypy --version]` | `--strict` gate on the worker | CI line below |
| SQL gate corpus (`supabase/tests/*.sql`) via `scripts/pg-lane/run.sh` | PostgreSQL 16 binaries available (`postgresql@16`, `pg_ctl`) `[VERIFIED: ls /opt/homebrew/opt]` | Hermetic SQL gates; mutation runner `scripts/mutation-runner/run.mjs` | House SQL-gate system |
| `scripts/dump-sql-functions.ts` (`npm run schema:functions[:check]`) | - | Regenerates `supabase/schema/functions/*.sql` from the migration chain | `sql-function-snapshot.yml` pins it |
| `scripts/lint-migration-data-dependence.mjs` | - | Refuses data-dependent migration guards `[VERIFIED: ran -> corpus 311 migration(s), 391 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW]` | CI `sql-gate-lint` |
| `scripts/prod-prober/run.mjs --capture-manifest` | - | Re-captures `cron-manifest.json` after a cron change | The runbook-documented mechanism |

CI mypy line, verbatim (run from `analytics-service/`):

```bash
mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py
```

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-run `cron.unschedule` | A migration that unschedules | Rejected by repo convention: `docs/runbooks/marksource-legacy-chain-move-go-live.md` says cron jobs "are not moved by a migration" because a PROD migration auto-applies with no human stop |
| Hand-edit `baseline.sql` after the drop | AUTOREDUMP bot PR (`redump-dump` / `redump-pr`) | The bot re-dumps PROD after the apply and regenerates the carried-migrations marker; hand edits break the sha binding |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed by this phase. The audit is not applicable: **Packages removed due to [SLOP]: none. Packages flagged [SUS]: none.** The banned-package list in the user's CLAUDE.md is not touched.

## Architecture Patterns

### System Architecture Diagram (data flow, before -> after)

```
BEFORE (HEAD)
  poll-allocator-positions (pg_cron, 0 1) --> poll_allocator_positions job --> allocator_holdings   [KEPT]
  refresh-allocator-equity (pg_cron, 30 1) --> enqueue_refresh_allocator_equity_for_all()
        |-- bootstrap loop --> reconstruct_allocator_history job --(replace RPCs / persist)--> allocator_equity_snapshots
        |-- refresh loop   --> refresh_allocator_equity_daily job --(persist_equity_snapshots)--> allocator_equity_snapshots
  request_allocator_holdings_sync (user/first sync) --> also enqueues reconstruct_allocator_history
  derive-allocator-key-dailies (pg_cron, 40 0) --> derive_broker_dailies --> csv_daily_returns + api_key_nav_marks + key_inputs:<id>
        --> derive_allocator_equity (compose) --> allocator_equity_derived (kind equity_curve)   [KEPT, the display source]
  getMyAllocationDashboard:
        curve/returns/state  <-- allocator_equity_derived (equity_curve)
        snapshotCount, minHistoryDepthMonths, equityBaselineUnknown, equitySnapshots  <-- allocator_equity_snapshots   [MOVES]
  compute_bridge_outcome_deltas (pg_cron, 0 3) --> extract_symbol_value_at --> allocator_equity_snapshots.breakdown   [MOVES]
  delete_allocator_api_key --> DELETE FROM allocator_equity_snapshots (last-key cascade)                              [EDITED]

AFTER (end of PR 3)
  poll --> allocator_holdings
  derive chain --> allocator_equity_derived (equity_curve, key_inputs:<id>)
  getMyAllocationDashboard: everything from allocator_equity_derived (+ allocator_holdings, api_keys, ...)
  compute_bridge_outcome_deltas holding branch: account-level change read from allocator_equity_derived (equity_curve)
  allocator_equity_snapshots, the two replace RPCs, extract_symbol_value_at, enqueue_refresh_allocator_equity_for_all: DROPPED
```

### Ship structure the plans must carry (orchestrator constraint from D-02)

| PR | Content | PROD proof before the next PR |
|----|---------|------------------------------|
| **PR 1 (readers)** | TS: remove the legacy select and its derived fields (`## Census` A); define `snapshotCount`; delete `minHistoryDepthMonths` / `equityBaselineUnknown` / `equitySnapshots` / `partitionTrustworthyEquitySnapshots`; `allocatorEligibleApiKeyIds` = every eligible key (181 absorbed); SQL migration re-basing `compute_bridge_outcome_deltas` (+ a helper) onto `allocator_equity_derived`; regenerate `supabase/schema/functions`; new SQL gate for the bridge change; e2e seed stops seeding the legacy table; `docs/runbooks/bridge-outcome-cron.md`; ROADMAP 181/182 dated lines | Vercel + DB migration live; read forms R1, R2, R3 |
| **PR 2 (writers)** | Python: remove `persist_equity_snapshots`, `_purge_allocator_equity_snapshots`, `_allocator_has_equity_snapshots`, `replace_equity_snapshots`, `replace_equity_snapshots_window`, the refresh job's write and the reconstruct job's write; remove the Python twin `_owed_reconstructs_for_zero_snapshot_book` (+ `_strategy_linked_key_ids`, `_fanout_would_still_retry` if no other caller); decide the reconstruct kind (OQ1); cron unscheduled by a hand-run PROD step; `cron-manifest.json` re-captured in its own PR; runbook retirement banners | Worker deployed after main CI green; read form R4 shows no new legacy rows |
| **PR 3 (drop)** | ONE migration: re-base `delete_allocator_api_key` without the snapshot DELETE; drop the replace RPCs, `extract_symbol_value_at`, `enqueue_refresh_allocator_equity_for_all`; clear orphaned `snapshot_rebuild_boundary` derived rows; `DROP TABLE`; catalogue-only self-check. App: GDPR manifest, `database.types.ts`, `schema/functions` regen, SQL tests/gates removed or rewritten, census pins moved, TODOS closed | TEST apply then PROD apply (auto); read form R6; AUTOREDUMP PR merged |

### Pattern 1: Catalogue-only drop verification
**What:** The migration asserts shape from `pg_catalog` only, never from rows. **When:** every statement-level self-check in the PR 3 migration. House precedent for a DROP: `supabase/migrations/20260908120000_drop_create_allocator_connected_strategy.sql` (its `DO $verify$` counts `pg_proc` rows and RAISEs; it reads no application table). The newer reviewer invariants (from `.planning/phases/164.9.3-*/164.9.3-MIGRATION-REVIEW-migration-reviewer.md`) say: no transaction control (that precedent's explicit `BEGIN;`/`COMMIT;` predates the invariant; the 115.1 migration header states "NO explicit BEGIN/COMMIT"), no `CONCURRENTLY`, single-literal `RAISE`, file sorts newest against a fresh `origin/main`, each REVOKE carries the full signature, `search_path` unchanged on re-based functions, byte identity against the re-based source outside marked blocks.

### Pattern 2: Re-base before `CREATE OR REPLACE`
Latest definitions at HEAD (re-measured by listing every migration that defines the function; the generated `supabase/schema/functions/<fn>.sql` header names the source):

| Function | Latest definer `[VERIFIED: grep -l over supabase/migrations + schema/functions header]` |
|---|---|
| `compute_bridge_outcome_deltas()` | `20260426131718_match_decisions_kind_enum.sql` |
| `extract_symbol_value_at(uuid,text,date)` | `20260421154030_compute_bridge_outcome_deltas_holding_branch.sql` (only definer) |
| `enqueue_refresh_allocator_equity_for_all()` | `20261021120000_refresh_fanout_owed_key_reconstruct.sql` |
| `delete_allocator_api_key(uuid, boolean)` | `20261028120000_replace_allocator_equity_snapshots_window.sql` |
| `replace_allocator_equity_snapshots(uuid,jsonb,integer)` and `_window(uuid,jsonb,integer,date)` | `20261028120000_replace_allocator_equity_snapshots_window.sql` |
| `request_allocator_holdings_sync(uuid)` | `20261014120000_api_keys_history_reconstruct_marker.sql` |

### Anti-Patterns to Avoid
- **Deleting `analytics-service/services/equity_reconstruction.py` or large helper blocks on a guess.** The module is imported by the derive path (`job_worker.py:4094` `read_marked_equity_usd`, `:4193` `read_okx_option_exposure`, `:14404` `_NO_CAPITAL_ANCHOR_REASONS`, `services/nav_marks.py:378`, `services/okx_opening_balance.py:378,411`, every `services/ingestion/*.py` `EquityCurveBuilder`). Delete the writers and their direct call graph; remove a helper only when `grep -a` shows zero remaining references.
- **Dropping the table before dependents.** plpgsql and SQL-language bodies are not dependency-tracked, so `DROP TABLE` succeeds and leaves `delete_allocator_api_key` broken at runtime (42P01 on a last-key hard delete).
- **Dropping `enqueue_refresh_allocator_equity_for_all` while the cron still names it** (daily failed pg_cron run, prober drift).
- **Deleting `compute_job_kinds` rows** for `reconstruct_allocator_history` / `refresh_allocator_equity_daily`: `compute_jobs.kind` has an FK to the registry and retained job rows reference it; `scripts/restore-test-refdata-allowlist.txt:391` also lists them as seeded reference data. Keep the registry rows.
- **Lowering a floor to make a run green.** Floors move because a gate file was deliberately retired, re-derived from a full run, with the reason written beside the constant.

## Census

Counts are `grep -c` of the table name per file unless stated (HEAD `0d8aad242`, `.planning/` and `CHANGELOG.md` excluded). "Moves with it" means the file is deleted or rewritten in the same PR as the thing it tests.

### A. Product readers of `allocator_equity_snapshots` (runtime)

| # | Reader | Evidence | Moves to / action | PR |
|---|--------|----------|-------------------|----|
| A1 | `getMyAllocationDashboard` read | `src/lib/queries.ts:5391` `.from("allocator_equity_snapshots")`, select list at :5392-5397 `"asof, value_usd, breakdown, source, history_depth_months, pre_terminus_balance_unknown"`, `.limit(730)`; `assertOk(phase07EquityRes, "allocator_equity_snapshots")` :5764 | Delete the read; values come from the derived row already fetched as `phase115DerivedRow` | 1 |
| A2 | `snapshotCount` | `queries.ts:5805` `const snapshotCount = equitySnapshots.length;`; consumed `KpiStrip.tsx:356` `const warmingUp = snapshotCount < 30 && !allKeysStale;` and `ScenarioComposer.tsx:963,5814` | Derived-curve day count (see Derived-series replacements) | 1 |
| A3 | `minHistoryDepthMonths` | `queries.ts:5117-5120` (`depths = equitySnapshots.map(s => s.history_depth_months)`), consumed `KpiStrip.tsx:146-163` `warmupCopy`, `ScenarioComposer.tsx:965,5816` | Delete (recommended) | 1 |
| A4 | `equityBaselineUnknown` / `partitionTrustworthyEquitySnapshots` | `queries.ts:3793` (helper), :5800-5801 (call), `AllocationDashboardV2.tsx:64,160,211,381` (props, two render sites, `BaselineUnknownBanner`) | Delete (recommended) | 1 |
| A5 | `equitySnapshots` payload array | `queries.ts:3165-3183` (type), :4925, :5218; **no non-test UI consumer** `[VERIFIED: grep over src -- only queries.ts and allocation-helpers.ts:31]` | Delete the field; ~37 test fixtures carry `equitySnapshots: []` (typecheck is the oracle) | 1 |
| A6 | `equitySnapshotsToDailyPoints` | `src/lib/allocation-helpers.ts:31`; consumers are tests only (`allocation-helpers.equity-adapter.test.ts`, `queries.my-allocation.test.ts:3`) | Delete with its test | 1 |
| A7 | Bridge holding branch | `extract_symbol_value_at` (`SELECT NULLIF((breakdown ->> p_symbol)::NUMERIC, 0) FROM public.allocator_equity_snapshots WHERE allocator_id = p_allocator_id AND asof = p_asof LIMIT 1;`), called by `compute_bridge_outcome_deltas` holding branch (`20260426131718`) | Re-base on the derived row (see Bridge outcomes) | 1; function dropped in 3 |
| A8 | Zero-history bootstrap, SQL | `enqueue_refresh_allocator_equity_for_all`: `EXISTS (SELECT 1 FROM allocator_equity_snapshots aes WHERE aes.allocator_id = ak.user_id)` in the refresh loop (`supabase/schema/functions/enqueue_refresh_allocator_equity_for_all.sql`, baseline.sql:6474) | Function dropped (cron unscheduled first) | 2 (cron) / 3 (drop) |
| A9 | Zero-history bootstrap, Python twin | `equity_reconstruction.py:3150` `_owed_reconstructs_for_zero_snapshot_book` (reads :3198), called from the refresh job :7654; helpers `_fanout_would_still_retry` :3077, `_strategy_linked_key_ids` :3108 | Delete with the refresh write (helpers only if no other caller) | 2 |
| A10 | Empty-replace presence gate | `_allocator_has_equity_snapshots` :2237 (head count), used by `replace_equity_snapshots` :2275 | Delete with the writers | 2 |
| A11 | Last-key hard delete | `delete_allocator_api_key` Step 4 `DELETE FROM allocator_equity_snapshots WHERE allocator_id = auth.uid() AND NOT EXISTS (SELECT 1 FROM api_keys WHERE user_id = auth.uid())` plus the `snapshot_rebuild_boundary` DELETE (`20261028120000`, baseline.sql:4399) | Re-base without both statements (the boundary row goes with the window RPC) | 3 |
| A12 | GDPR export | `src/lib/gdpr-export-manifest.ts:632` `{ kind: "direct", table: "allocator_equity_snapshots", user_column: "allocator_id" }`, :1011 `allocator_equity_snapshots: "asof"`, comment :977; `scripts/check-gdpr-export-coverage.ts:383` PRESERVE allowlist entry; pins `src/__tests__/gdpr-export.test.ts:951`, `gdpr-export-schema.test.ts:136` | Remove manifest rows, order override, allowlist entry and both test pins | 3 |
| A13 | Types | `src/lib/database.types.ts:137` (table Row/Insert/Update), :4328 (`replace_allocator_equity_snapshots` Function), plus the `extract_symbol_value_at` and `compute_bridge_outcome_deltas` entries | Hand-edit / regenerate | 3 (A7's types in 3) |

Verified negatives (no reader): `breakdown` has no UI/API consumer (`grep` of `.breakdown`/`breakdown:` in `src` finds only `queries.ts:3168` and `database.types.ts`); `analytics-service/routers/match.py` and `models/` no longer read the table (the 115 deferral's "R1 match.py per-SYMBOL breakdown" is closed by Phase 167.1.1.1 BRIDGERETURNS, TODOS `[167.1.1-BRIDGE-DOLLAR-RATIO-RETURNS]` "CLOSED 2026-10-16"; `test_match_router.py` fakes still name the table at :1970,:2046,:5911 but only in a `name in (...)` list); the compare adapter (`holding-compare-adapter.ts`) reads mark prices, not the table; `src/app/api/bridge/outcome/[id]/curves/route.ts` reads `strategy_analytics`, not the table; `src/lib/factsheet/allocator-portfolio-payload.ts:71` and `AllocationDashboardV2.tsx:27,291` are comments. No view, trigger, incoming foreign key, publication or other policy references the table `[VERIFIED: grep -an of supabase/schema/baseline.sql -- table is referenced only by its own DDL/policies/grants (lines 12727-12752, 14970, 15368, 16179, 16729-16740, 18591-18593) and by the functions in rows A7-A11 and the two replace RPCs]`. The backfill function `backfill_api_keys_history_reconstructed_at` names the table only in a comment (baseline.sql:1674).

### B. Writers

| # | Writer | Evidence | Action | PR |
|---|--------|----------|--------|----|
| B1 | `persist_equity_snapshots` | `equity_reconstruction.py:1965` (upsert :2017, `on_conflict="allocator_id,asof"`, `ignore_duplicates=True`); callers :7044 (reconstruct, multi-key path) and :7726 (refresh) | Delete + callers | 2 |
| B2 | `_purge_allocator_equity_snapshots` | :2165 (delete :2194) | Delete | 2 |
| B3 | `replace_equity_snapshots` -> RPC `replace_allocator_equity_snapshots` | :2275 (RPC :2337); caller :7036 (reconstruct, sole-key path) | Delete | 2 |
| B4 | `replace_equity_snapshots_window` -> RPC `replace_allocator_equity_snapshots_window` | :2381 (RPC :2428); caller :7000 (forced account rebuild) | Delete | 2 |
| B5 | Reconstruct job write path | `run_reconstruct_allocator_history_job` :6566-7280 | See OQ1 | 2 |
| B6 | Refresh job | `run_refresh_allocator_equity_daily_job` :7386-8056 (write :7726); held/left-out audits and Sentry messages are all about the legacy write | Delete or reduce to a retired no-op (OQ1) | 2 |
| B7 | SQL RPCs | `replace_allocator_equity_snapshots` (latest `20261028120000`; earlier `20260527102050`, `20260529160000`, `20260602183000`), `replace_allocator_equity_snapshots_window` (`20261028120000`, also writes `allocator_equity_derived` kind `snapshot_rebuild_boundary`) | `DROP FUNCTION` | 3 |
| B8 | Dispatch + timeouts | `job_worker.py:907-908` (`TIMEOUT_PER_KIND`), `:15964-15969` dispatch arms, `:16033` reconstruct cap hook; `main_worker.py:355` watchdog override | Follow OQ1 | 2 |

### C. Operator tooling and diagnostics (read the table or the writers)

| File | Refs | Disposition |
|------|------|-------------|
| `analytics-service/scripts/allocator_history_probe.py` (reads `_stored_curve` :1859; names the three persist paths :107) and `analytics-service/tests/test_allocator_history_probe.py` (21) | forced-rebuild simulator; purpose moot once rebuild is retired | Retire (delete or reduce) with the writers |
| `analytics-service/scripts/e2_allocator_ground_truth.py` (4; reads :256) and `tests/test_e2_parity_oracle.py`, `test_e2_deribit_allocator_dailies.py` (docstring mentions) | compares legacy vs derived; nothing left to compare | Retire or strip the legacy half |
| `docs/runbooks/marksource-okx-census/{okx-nonworking-keys,okx-rebuild-feasibility,okx-snapshot-census,okx-snapshot-rows}.sql`, `docs/runbooks/marksource-okx-history-correction.md` (4), `docs/runbooks/marksource-legacy-chain-move-go-live.md` (7; its `state`/reading forms count legacy rows and its rollback form `alter_job`s the refresh cron), `docs/runbooks/navmtm-chain-move-go-live.md`, `docs/runbooks/ledger-refresh-go-live.md`, `docs/runbooks/bridge-outcome-cron.md`, `docs/architecture/adr-0023-audit-event-taxonomy.md:518`, `docs/runbooks/sql-migrations-coverage-2026-05-16.md`, `docs/sql-gate-lineage.md` | historical operator procedures | Add a dated retirement banner (do not rewrite history); `bridge-outcome-cron.md` is rewritten for the new holding-branch semantics |
| `src/__tests__/marksource-okx-census-sql.test.ts` (pins runbook cron names :847,:860), `marksource-okx-nonworking-keys-exec.test.ts` (creates its OWN `public.allocator_equity_snapshots` fixture table at :60, so it survives the drop unchanged) | | Update only what the banner edits break |
| `e2e/helpers/seed-test-project.ts:972` (`.from("allocator_equity_snapshots").upsert(...)`), doc comment :827; the derived row is seeded separately at :994 | | Remove the legacy seeding step (PR 1 or 3); the derived seed already carries the same day count |
| `scripts/baseline-content-drift-check.mjs` (3), `scripts/dump-sql-functions.ts` (3), `scripts/lint-migration-data-dependence-baseline.txt` (6), `scripts/mutation-floors.mjs` (6), `scripts/restore-test-refdata-allowlist.txt:391` | see Censuses (E) | |

### D. Tests that reference the table or its RPCs (move with their subject)

**SQL gates (`supabase/tests`):** `test_replace_allocator_equity_snapshots_window.sql` (64; 15 arms, declares `ALL 15 ARMS EXECUTED`, 16 `RED-UNDER:` lines), `test_allocator_equity_pre_terminus_flag.sql` (10), `test_refresh_fanout_zero_snapshot_bootstrap.sql` (8; 31 `RED-UNDER:`), `test_refresh_fanout_owed_key_reconstruct.sql` (13; 20 `RED-UNDER:`), `test_api_key_delete_atomicity.sql` (17: Part 1 asserts the replace RPC's lock/grants at :87-107, Part 3 inserts/deletes snapshot rows :216-277; no mutation annotations) -> delete the first four, rewrite the last. Nine more gates mention the table name only inside their `RED-UNDER-SETUP` file lists (they load the historical migration files as setup): `test_allocator_holdings_per_key_unique`, `test_allocator_trade_reads`, `test_api_key_flow_prices`, `test_api_key_nav_marks`, `test_api_keys_account_identity`, `test_api_keys_history_reconstruct_marker`, `test_btcusdview_native_balance`, `test_commit_scenario_batch_fingerprint_sameday_empty`, `test_commit_scenario_batch_fingerprint_unpriced`. Those lists name old migration files that stay in the repo, so they remain valid; append the PR 3 migration only if a gate should exercise the NEW `delete_allocator_api_key`.

**Python (`analytics-service/tests`, count of table-name refs):** dedicated to the writers -> delete or rewrite: `test_equity_reconstruction.py` (96), `test_reconstruct_whole_account.py` (19), `test_reconstruct_force_rebuild.py` (9), `test_reconstruct_sibling_replace_scope.py` (7), `test_reconstruct_marker_writer.py` (1), `test_replace_snapshots_window.py` (5), `test_replace_snapshots_window_live.py` (3), `test_refresh_allocator_equity_carry_forward.py` (12), `test_refresh_holds_for_inflight_reconstruct.py` (4), `test_equity_reconstruction_integration.py` (5), `test_equity_reconstruction_live.py` (3), `test_allocator_history_probe.py` (21), `test_marksource_cross_curve.py` (3; the legacy-vs-derived agreement test), `test_okx_anchor_rule.py` (1), `test_one_key_per_account_day.py` (1), `test_trade_read_resume.py` (1), `test_bybit_two_year_window.py` (2), `test_mt5_deal_reconstruction.py` (1, comment). Fake-table lists only (cosmetic cleanup): `test_match_portfolio_aum_per_key.py` (11), `test_match_portfolio_aum_native_unpriced.py`, `test_match_router.py` (5), `test_allocator_equity_compose_read_race.py`, `test_allocator_equity_dropped_day_pnl.py`, `test_allocator_equity_emptied_stretch.py`, `test_allocator_equity_realized_basis.py`, `test_nav_marks_compose_roundtrip.py` (each `"allocator_equity_snapshots": []` in a fake DB). **Keep as guard until the drop, then trim:** `test_derive_allocator_equity_job.py` (4; `LEGACY_TABLE` guard "the compose job must NEVER write allocator_equity_snapshots", :313, :2651). Twin tests keyed to the fan-out text: `test_fanout_owed_predicate_twins.py`, `test_history_reconstruct_cap_twins.py`, `test_history_reconstruct_cap_orphan_sweep.py`, TS `history-reconstruct-cap-twins.test.ts`, `history-reconstruct-note-predicate-twins.test.ts` (they select the NEWEST migration defining the fan-out via `_newest_fanout_body()`, so a new migration redefining it changes what they pin).

**TS:** `src/__tests__/allocator-equity-rls.test.ts` (21; live-DB, writes and reads the table), `bridge-outcome-cron-holding.test.ts` (5; live-DB, gated on `HAS_LIVE_DB`), `delete-allocator-api-key-rpc.test.ts` (3), `seed-integrity.test.ts` (4; a no-seeding pin at :444-483), `snapshot-rebuild-boundary-literal-pin.test.ts` (4), `OnboardingWizard.noseeed.test.tsx` (4; "never calls supabase.from('allocator_equity_snapshots')" :147-149, becomes vacuous), `queries.my-allocation.test.ts` (TC p7-02/03/08/09/CL9 at :1116-1449, :3077-3205, :3744), `allocation-helpers.equity-adapter.test.ts`, GDPR pins above, plus ~37 files carrying `equitySnapshots: []`/`snapshotCount`/`minHistoryDepthMonths`/`equityBaselineUnknown` fixtures (list: `grep -rIl 'snapshotCount\|minHistoryDepthMonths\|equityBaselineUnknown\|equitySnapshots' src`).

### E. Censuses, floors and generated artifacts that move

| Artifact | Current value / location | Why it moves |
|----------|--------------------------|--------------|
| Mutation runner floors | `scripts/mutation-floors.mjs:1323` `FILES_FLOOR = 82`, `:3335` `ARMS_FLOOR = 829`, `:3449` `WAIVED_CEILING = 0` | Deleting annotated gates lowers files/arms; a NEW bridge gate raises them. Re-derive from one full `node scripts/mutation-runner/run.mjs` run; never subtract by hand |
| Mutation pins | `src/__tests__/mutation-runner-floors.test.ts` (:744,745,1868,2169,2308,2634,3066,3346), `mutation-annotation-parser.test.ts` (:1096,1097,1134,2698,2785,2890,3354), `gate-family-meta.test.ts:944-945`, `lint-sql-gates.test.ts:1169` (file count), `drift-check-scripts.test.ts:5021` | Each pins a count or a by-name list containing the retired gate files |
| sql-tests anti-skip census | `.github/workflows/ci.yml:5197-5198` `SENTINEL_FLOOR=26`, `ARMS_FLOOR=394`, and the contiguous table above it (row `test_replace_allocator_equity_snapshots_window.sql 15` at :4956; prose at :5143); contract `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` re-derives both from the corpus | Window gate (15 sentinel arms) is deleted: 26 -> 25, 394 -> 379, plus any rewritten gate's sentinel |
| Function-snapshot gate | `supabase/schema/functions/*.sql` (132 files), `npm run schema:functions[:check]` `[VERIFIED: "SQL function snapshot is current (132 functions)"]` | Regenerate in each PR that changes a function; PR 3 deletes the dropped functions' files |
| Baseline content-drift | `scripts/baseline-content-drift-check.mjs` `COMPARED_FLOOR = 134` `[VERIFIED: ran -> functions compared 134 -- MATCH 131, DRIFT 3 ... findings 0]` | Floor drops by the number of dropped functions; until the re-dump, baseline still names them |
| Name-set ratchet | `scripts/dump-sql-functions.ts` `NAME_SET_RATCHET` (currently empty `[VERIFIED: "agree, with 0 ratcheted disagreement(s)"]`) | Expect `baseline-only` rows for each dropped function between PR 3's merge and the re-dump (the 20260908120000 DRIFT-04 DROP is the precedent: its row was `baseline-only` and was deleted when the re-dump made the name absent on both sides) |
| Data-dependence ledger | `scripts/lint-migration-data-dependence-baseline.txt:104-106` (three entries naming `public.allocator_equity_snapshots` in historical migrations `20260527102050`, `20260529160000`) | UNCHANGED: those migration files stay, so the entries stay valid. The new migration must add 0 NEW |
| Restore allowlist | `scripts/restore-test-refdata-allowlist.txt:391` (`20260420213754_allocator_equity_snapshots.sql  public.compute_job_kinds  2`) | UNCHANGED if the two registry rows are kept (they must be) |
| Baseline dump + marker | `supabase/schema/baseline.sql`, `baseline-carried-migrations.txt`, `BASELINE.md` | Regenerated by the AUTOREDUMP bot PR after the PROD apply; never hand-edited. Until it merges the dump still contains the table and functions and the local-stack lane replays the DROP on top |
| Cron manifest | `scripts/prod-prober/cron-manifest.json` row `refresh-allocator-equity` (`"schedule": "30 1 * * *"`, `"command": "SELECT enqueue_refresh_allocator_equity_for_all();"`), `captured_at` 2026-10-30 | Re-capture after the unschedule |
| Display labels | `src/lib/display-labels.ts:55-56` job-kind labels; `src/lib/constants.ts:251` `RECONSTRUCT_JOB_KIND` | Only if OQ1 retires the kinds from the UI |

## Writers, jobs and crons

- **Crons (PROD `cron.job`, manifest rows `[VERIFIED: scripts/prod-prober/cron-manifest.json]`):** `poll-allocator-positions` `0 1 * * *` `SELECT enqueue_poll_allocator_positions_for_all_keys();` (writes `allocator_holdings`, KEPT); `refresh-allocator-equity` `30 1 * * *` `SELECT enqueue_refresh_allocator_equity_for_all();` (RETIRED); `compute_bridge_outcome_deltas` `0 3 * * *` `SELECT public.compute_bridge_outcome_deltas();` (KEPT, body changes in PR 1); `derive-allocator-key-dailies` `40 0 * * *` `SELECT enqueue_derive_broker_dailies_for_allocator_keys();` (KEPT; role-agnostic `WHERE ak.is_active = TRUE AND ak.sync_status IS DISTINCT FROM 'revoked' AND ak.disconnected_at IS NULL`, `[VERIFIED: schema/functions/enqueue_derive_broker_dailies_for_allocator_keys.sql]`).
- **So one cron changes:** `refresh-allocator-equity`. Mechanism: a hand-run PROD step in the runbook style (marker query first; a rendered form; counts reported), then `node scripts/prod-prober/run.mjs --capture-manifest --out <scratch>` + diff + commit as its own PR (runbook Step C; the manifest PR "ships as its own PR"). The hourly prober reports `cron.job` drift until the manifest is re-captured, so do the capture the same session. **Recommended order: unschedule the cron BEFORE or WITH the PR 2 worker deploy**, so no refresh or bootstrap job is enqueued for a retired handler. After PR 1 is live nothing reads the legacy rows, so stopping the cron early loses nothing.
- **Job kinds:** `refresh_allocator_equity_daily` is enqueued only by the fan-out `[VERIFIED: grep -- Python and TS contain no other enqueue]`. `reconstruct_allocator_history` is enqueued by THREE paths: the fan-out bootstrap loop, `request_allocator_holdings_sync(uuid)` (a user/first-sync RPC; the `v_prior_reconstruct` branch in `20261014120000`), and a service-role/owner `force_rebuild` enqueue (documented in `docs/runbooks/marksource-okx-history-correction.md`).
- **Unknown kind behaviour:** `job_worker.py` dispatch: `handler = None` -> `DispatchResult(outcome=FAILED, error_message=f"Unknown job kind: {kind!r}", error_kind="permanent")`. So deleting a handler while any job of that kind can still be enqueued produces `failed_final` rows. A "retired" handler that returns `DONE` is gentler; but with the cron unscheduled first, only the two non-cron enqueue paths remain.
- **Reconstruct job outputs that are NOT the snapshot table (what must be decided, OQ1):** (a) `api_keys.history_reconstructed_at` marker via `_mark_api_key_history_reconstructed` (:2480), which drives `reconstructCappedKeyIds`/`historyReconstructFailed` in `queries.ts` (:4824-4866, the "history reconstruct failed" note) and the SQL/Python/TS cap twins and `_capture_history_reconstruct_capped` / `report_orphaned_capped_reconstructs` (job_worker.py ~:15700-15900); (b) `allocator.equity.reconstruct_*` audit events; (c) `snapshot_rebuild_boundary` derived rows (written by the window RPC; read by `snapshotRebuildBoundary` in `queries.ts:5376-5598`, "No UI reads it today"); (d) the trade-read store purge (`store.purge_keys`, Phase 171 READCEILING tables). The derive path does NOT depend on any of them: its inputs are `csv_daily_returns`, `api_key_nav_marks` and `key_inputs:<id>` rows written by `derive_broker_dailies` (`job_worker.py` Option-B epilogue ~:8218-8560).

## Derived series and the three discretionary replacements

**What a derived row carries** `[VERIFIED: analytics-service/services/allocator_equity_compose.py:1111-1126 payload dict, and the reader src/lib/queries.ts:4375-4440]`: `payload = {"curve": curve_rows, "returns": returns_rows, "version": 2, "flags": [...], "degrade_reasons": [...], "is_trustworthy": ..., "scalars": {"mwr","dietz","computable"}, "inputs": {"n_keys","anchor_asof","composed_at"}}`. The reader accepts only `version === 2`, `is_trustworthy === true`, a non-empty `curve` of `{date: YYYY-MM-DD, equity_usd: finite number}` and a non-empty strictly ascending `returns` of `{date, r}`. **There is no per-day "realized vs marked" indicator in the payload.** The marked/realized boundary lives in the per-key rows `allocator_equity_derived` kind `key_inputs:<api_key_id>` as `marks_since` / `marks_trailing_since` (`src/lib/nav-marks-start.ts:34,42`), already read by `readMarksStart` (`queries.ts:4176-4231`) into `marksStart` / `marksTrailingSince`. No token in the compose's closed flag/refusal vocabulary (`allocator_equity_compose.py:63-85`, `allocator_equity_derive.py:109-240`) names a pre-terminus or unknown-baseline condition `[VERIFIED: read the constant lists]`.

Proposed definitions, one each:

| Value | Legacy meaning | Proposed definition | Evidence / reason |
|-------|----------------|---------------------|-------------------|
| `snapshotCount` | count of trustworthy legacy rows; gate `snapshotCount < 30` | `trustworthyDerivedCurve(derivedPayload)?.length ?? 0`, i.e. the day count of the drawn derived curve (`queries.ts:5105` already computes `curveForSource` from that function). Same unit `FactsheetWarmupNote` counts (`AllocationDashboardV2.tsx` `curveDays`; `AllocationDashboardV2.warmup.test.tsx` measures it against the real builder) | One definition for both warm-up surfaces; keeps the `KpiStrip` default `snapshotCount = 30` (= not warming) for fixtures. **Pitfall:** when the history is `rebuilding` and the row is untrustworthy this is 0, so the Scenario KPI strip would print "Warming up - need 30 more days of synced data" falsely; decide and test the composer's rebuilding branch (use the same fail-closed reading as the Overview, `equityHistoryState`) |
| `minHistoryDepthMonths` | min of the per-venue retention cap (`VENUE_HISTORY_DEPTH_MONTHS`: binance 24, okx 3, bybit 24, `equity_reconstruction.py:238-242`) stamped only on `exchange_primary` rows; drove the copy "Only N months of history available on {venues}" when `<= 3` | **Delete the field and the venue branch of `warmupCopy`; keep the generic countdown.** A span-based replacement ("first realized day" -> months) degenerates: the copy only renders while `snapshotCount < 30`, and in that regime the curve span is under one month, so `minHistoryDepthMonths <= 3` is always true and the generic countdown becomes unreachable (the copy would always read "Only 0 months of history available on ..."). The derived series carries no venue retention cap. `activeVenues` stays (the factsheet "markets" line uses it) | Reasoning above is checkable from `KpiStrip.tsx:146-163,356`; whether OKX's derived history is still capped at 90 days is `[ASSUMED]` (the OKX archive rebuild kind exists, `okx_archive_rebuild`) and does not change the recommendation. User-facing copy change: raise it (OQ4) |
| `equityBaselineUnknown` | any legacy row with `pre_terminus_balance_unknown` (OKX 90-day trade terminus clamped the funding deposit) | **Delete the field, the two render sites and `BaselineUnknownBanner`.** The banner text ("absolute equity and drawdown can't be reconstructed for that earlier period") describes the legacy series; the drawn curve is the derived one, anchored to the account's live equity (`inputs.anchor_asof`) with no unknown-baseline token. Disclosure of the realized-to-marked step already exists as `marksStart` / `marksTrailingSince` on the Equity curve widget | Before deleting, take one PROD count (form R0) of allocators with any `pre_terminus_balance_unknown = true` row, so the loss of the banner is recorded with who it affected |

`partitionTrustworthyEquitySnapshots`'s docblock (`queries.ts:3777-3790`) lists "other read boundaries" (compare adapter, match.py); both were verified above as no longer reading the table, so no other boundary needs the flag.

## Bridge outcomes (D-03)

**Current definition (latest = `20260426131718`)** `[VERIFIED: supabase/schema/functions/compute_bridge_outcome_deltas.sql, extract_symbol_value_at.sql]`: the function is `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, returns `TABLE(updated_count INT, failed_count INT, batch_started_at TIMESTAMPTZ)`, and runs three CTE branches over `bridge_outcomes` rows with `kind = 'allocated' AND allocated_at IS NOT NULL AND (delta_30d IS NULL OR needs_recompute = TRUE)`: strategy (`extract_delta` on `strategy_analytics.returns_series`), **holding** (`md.original_strategy_id IS NULL AND md.original_holding_ref IS NOT NULL AND hp.symbol IS NOT NULL`, with `delta = value_at(allocated_at+N) / value_at(allocated_at) - 1` for N = 30, 90, **180** via `extract_symbol_value_at`, each guarded by a CASE that returns NULL when either end is NULL; updates `delta_30d/90d/180d` with `COALESCE(new, old)`, sets `needs_recompute = FALSE`, `deltas_computed_at`), and voluntary_add. The holding branch sets no `estimated_*` columns. Only the holding branch changes.

- **Caller:** pg_cron `compute_bridge_outcome_deltas` at `0 3 * * *` (unchanged). The stored columns are `delta_30d`, `delta_90d`, `delta_180d`, `estimated_delta_bps`, `estimated_days`, `needs_recompute`, `deltas_computed_at` (baseline.sql:13311-13335). Trigger `bridge_outcomes_set_updated_at` (baseline.sql:1750-1765) resets all deltas to NULL and sets `needs_recompute` only when `allocated_at`, `percent_allocated` or `kind` change on UPDATE.
- **D-03 mentions +30d and +90d; the function also computes +180d** and the UI shows all three (`src/lib/bridge-outcome-label.ts` `deriveOutcomeLabel`: 180/90/30). Treat all three windows identically (one formula) unless told otherwise.
- **Labels/copy that say "per symbol":** a `grep -i` for `per symbol|per-symbol|symbol's value|symbol value` finds none in `src`. The only outcome copy touching the meaning is `OutcomesWidget.tsx:159` "Realized delta from Bridge-driven reallocations" and :431 "Realized delta vs held baseline" (no test pins either string `[VERIFIED: grep over src, e2e, docs]`), plus `docs/runbooks/bridge-outcome-cron.md` ("What it computes" describes only the strategy path, never the holding branch) and `docs/architecture/adr-0023-audit-event-taxonomy.md:518` ("per-symbol USD value from `allocator_equity_snapshots.breakdown`"). Plan a wording check of those two strings and the two docs; do not invent a UI string that is not needed.

**Formula decision to raise (OQ2), with a recommendation.** "Derived account total" can be implemented two ways on the same row:
- (A) literal ratio of `curve[].equity_usd` at `allocated_at + N` over at `allocated_at`. Simple, mirrors the old shape, but the dollar curve moves with deposits and withdrawals, so a funded account reads as a gain. The founder has already ruled against dollar ratios as returns once (TODOS `[167.1.1-BRIDGE-DOLLAR-RATIO-RETURNS]`, closed by Phase 167.1.1.1: "feeding `value_usd` in place of `mark_price` turns `test_a_purchase_at_a_constant_mark_is_not_a_return` RED").
- (B) compound the row's flow-neutral `returns[].r` over `(allocated_at, allocated_at + N]`: `prod(1 + r) - 1`, NULL when any day in the window is absent (or any `1 + r <= 0`). This is the account's performance with flows removed, the same series the factsheet KPIs and the Scenario own-book delta read ("Factsheet KPIs and the Scenario own-book delta read this, never ratios of `equityDailyPoints`", `queries.ts` payload doc for `equityDailyReturns`).

Recommendation: (B), stated once in a new helper function and tested; if the founder wants (A) literally, it is a one-line difference in the helper. Either way: only rows whose derived payload has `version = 2` and `is_trustworthy = true` count; a missing day yields NULL (the existing CASE-guard behaviour; "never invent data"). The helper must be `STABLE`/`IMMUTABLE`, schema-qualified and `SET search_path` consistent with the re-based function; reading `allocator_equity_derived` from a SECURITY DEFINER batch is fine (owner-RLS applies to `authenticated`, and the definer bypasses it). `extract_equity_at` / `extract_delta` cannot be reused as-is: they read the key `value`, the derived curve uses `equity_usd` (`supabase/schema/functions/extract_equity_at.sql`: `entry->>'value'`).

**Stored outcomes (planner to raise, OQ3).** Facts: holding-branch rows already have non-NULL deltas computed on the legacy per-symbol basis; `compute_bridge_outcome_deltas` skips them unless `needs_recompute = TRUE`; setting that flag by plain `UPDATE` does NOT trip the reset trigger (which keys on `allocated_at`/`percent_allocated`/`kind`), so the old values would be overwritten only where the new basis yields a value, because the update uses `COALESCE(new, old)`; where the derived curve lacks the day the old per-symbol value would silently survive, giving a mixed-basis column. Options: (1) leave stored rows as they are (D-03 "keep their values"), accept that old and new rows mean different things; (2) a one-time `UPDATE ... SET needs_recompute = TRUE` limited to holding-branch rows in the PR 1 migration (an UPDATE with no row-conditioned RAISE passes the data-dependence lint), and to avoid the mixed result set deltas to NULL in the same statement for those rows so the new basis is all-or-nothing. Needs a PROD count first (form R3) to size it; "Outcomes already stored keep their values" in D-03 reads as option 1.

## Shared-key rule (181 absorbed)

- **Current TS rule** `[VERIFIED: src/lib/queries.ts:6101-6112]`: `strategyLinkedKeyIds = deriveStrategyLinkedKeyIds(<own strategies filtered by !isAllocatable(capital_ownership)>, <strategy_keys links>)`; `allocatorEligibleApiKeyIds = eligibleKeyIds.filter((id) => !strategyLinkedKeyIds.has(id))`. `deriveStrategyLinkedKeyIds` (:903) is the shared two-link-form join (`strategies.api_key_id` plus `strategy_keys`, archived strategies excluded) and is ALSO used by `deriveStrategylessKeys` (:955, the /my-strategies coverage question) and by `reconstructCappedKeyIds` (:4824). It stays for those two.
- **New rule:** `allocatorEligibleApiKeyIds = eligibleKeyIds` (a strategy-linked key also counts in its owner's allocator book). This makes the field agree with what the derive already composes (`job_worker.py:14458` `eligible_ids = {r["id"] for r in key_rows if eligible_key_predicate(r)}`; `allocator_equity_derive.py:331-345` `eligible_key_predicate` = `is_active and sync_status != "revoked" and disconnected_at is None`), with `marksIncludedKeys` (:4115, which feeds `readMarksStart`), and with the key-mode fan-out (role-agnostic, above). In `getMyAllocationDashboard` the `isAllocatable` role filter and the `strategyLinkedKeyIds` computation at the call site (:6035-6112 comment block, ~80 lines of AUM-04 rationale) become dead; `phase151OwnStrategiesRes`/`phase151StrategyKeyLinksRes` are still needed by `reconstructLinkSource` while the reconstruct note exists (OQ1).
- **Ripple (Rule 7: conflict surfaced, not averaged):** this inverts Phase 151 AUM-04 ("founder PROD census 2026-08-05: 8 eligible keys, 6 of them manager-side") and its own-capital exemption (Review [4]). Consequences: (a) `managerSideKeyIds(eligible, allocatorEligible)` (`live-holdings-summary.ts:298`) is then always `[]` and `excludedManagerSide` is a dead bucket; ScenarioComposer's partial-book note counts (`ScenarioComposer.tsx:3264` M = allocator-eligible keys) now include manager-side keys, so "0 of 2" becomes "N of 8" for such owners; (b) `contributingApiKeyIds` / `bookEntryGateSatisfied` widen for owners who run strategies. Decide (planner, with the founder rule as authority) whether to delete the dead `managerSide*` plumbing in PR 1 or leave it inert; leaving it inert is the smaller, safer diff.
- **Tests that pin the exclusion (go RED on the new rule, which is the required RED-on-base):** `src/lib/queries.my-allocation.test.ts` blocks "Phase 151 book-entry gate split (AUM-04)" (:4011-4503; assertions `allocatorEligibleApiKeyIds` `toEqual(["k-bybit","k-okx"])` at :4114,:4131,:4148,:4360,:4503, `toHaveLength(8)` :4425,:4472) and the own-capital exemption block (:4521-4680: `not.toContain("k-team")`, `not.toContain("k-unmarked")`, `not.toContain("k-own-direct")`); `src/lib/queries.test.ts:2184-2340` (`deriveStrategyLinkedKeyIds` unit tests incl. "founder census: 6 of 8 keys are manager-side" :2314: the HELPER is unchanged, keep); `live-holdings-summary.test.ts`; `AllocationsTabs.*.test.tsx` and `ScenarioComposer*.test.tsx` fixtures carrying `allocatorEligibleApiKeyIds`.

## Migration constraints (PR 1 and PR 3)

1. **Data-dependence lint** is `scripts/lint-migration-data-dependence.mjs` (CI `sql-gate-lint`; `--self-test` first). It refuses an anonymous `DO` block that reads an application-schema relation AND raises under a condition derived from that read (spellings R1-R5). There is no opt-out marker. A catalogue-only block (`pg_proc`, `pg_class`, `to_regclass`, `information_schema`) is allowed; `RAISE NOTICE` is not an exception; an UPDATE/DELETE with no raise is allowed. Run it locally before pushing: expected `0 NEW`.
2. **Self-verification in the PR 3 migration (catalogue-only), as a skeleton** (values below are from files read this session; the shape follows `20260908120000`):

```sql
-- Skeleton, not final text. Order: re-base dependents, drop functions, clear orphan rows, drop table, verify.
CREATE OR REPLACE FUNCTION public.delete_allocator_api_key(...)  -- re-based on 20261028120000, minus the snapshot DELETE and the snapshot_rebuild_boundary DELETE
DROP FUNCTION public.replace_allocator_equity_snapshots(uuid, jsonb, integer);
DROP FUNCTION public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date);
DROP FUNCTION public.extract_symbol_value_at(uuid, text, date);
DROP FUNCTION public.enqueue_refresh_allocator_equity_for_all();
DELETE FROM public.allocator_equity_derived WHERE kind = 'snapshot_rebuild_boundary';  -- orphaned by the window RPC
DROP TABLE public.allocator_equity_snapshots;
DO $verify$ BEGIN
  IF to_regclass('public.allocator_equity_snapshots') IS NOT NULL THEN RAISE EXCEPTION '...'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.prosrc ILIKE '%allocator_equity_snapshots%') THEN
    RAISE EXCEPTION '...';   -- plpgsql / SQL bodies are not dependency-tracked: this is the ONLY thing that catches a missed dependent
  END IF;
END $verify$;
```

   (Drop `enqueue_refresh_allocator_equity_for_all` only if the cron is already unscheduled and, per OQ1, nothing else needs the function. The `prosrc ILIKE` check reads `pg_proc`, a catalogue, so the lint accepts it. Single-literal `RAISE` messages. No `BEGIN;`/`COMMIT;`, no `CONCURRENTLY`. `SET LOCAL lock_timeout` as the 115.1 header does.)
3. **Dependents of the table** `[VERIFIED: baseline.sql grep]`: functions `delete_allocator_api_key`, `enqueue_refresh_allocator_equity_for_all`, `extract_symbol_value_at`, the two replace RPCs; RLS: enabled with three policies (`allocator_equity_snapshots_admin_select`, `_owner_select`, `_service_all`, baseline.sql:16729-16740); grants to `anon`, `authenticated`, `service_role` (baseline.sql:18591-18593); PK + index `allocator_equity_snapshots_allocator_asof_desc_idx`; one outgoing FK to `auth.users`. All of these except the functions die with `DROP TABLE`; there is no incoming FK, view or trigger. RLS/GRANT removal therefore needs no separate statements, but the rls-policy-auditor should confirm the three policy names are the full set (`pg_policies`).
4. **TEST apply:** the DROP is catalogue-only and TEST holds no rows, so it is not data-dependent on TEST. `apply-test` runs first and gates the PROD apply (`supabase-migrate.yml`); a PROD apply with no human stop follows.
5. **Gates that read the chain or PROD around a DROP:** VAC-04 (`scripts/prod-body-drift-check.sh`, `migration-drift-check.yml`) compares bodies of functions the PR's migrations touch; DRIFT-05 gate (b) `--baseline-live` compares baseline names to the live catalogue; VAC-08 runs in `test-db-drift` and compares repo to TEST. The DROP-function precedent `20260908120000` went through all of them; the planner must run `npx tsx scripts/dump-sql-functions.ts --check`, `node scripts/baseline-content-drift-check.mjs` and `node scripts/lint-migration-data-dependence.mjs` locally after writing the migration and handle the `baseline-only` ratchet rows and `COMPARED_FLOOR` move they print (see Census E). ASSUMED: exact finding kinds for a dropped (not replaced) function; measure, do not trust.
6. **Local-stack lane:** `sql-tests` loads `baseline.sql` and then replays every migration not in `baseline-carried-migrations.txt` in filename order (`BASELINE.md`, DECISION F). So until the bot re-dump merges, PR 3's migration replays on top of a dump that still contains the table: every `supabase/tests` file must therefore be free of the table in the PR that carries the migration (rewrite `test_api_key_delete_atomicity.sql`, delete the four dedicated gates). The same lane means PR 1's bridge migration must work on that dump.
7. **Baseline re-dump:** automated (`supabase-migrate.yml` `redump-dump` + `redump-pr`, `scripts/baseline-redump.mjs`, branch `automation/baseline-redump`); it never merges; read each head-SHA run's conclusion before merging that PR. The manual `## Regenerating` section of `supabase/schema/BASELINE.md` is the fallback and requires the carried-migrations marker regenerated in the same commit.
8. **GDPR:** removing the table from the export manifest is consistent with Art. 15 (the data no longer exists); the derived `equity_curve`/`key_inputs` rows and `api_key_nav_marks` remain exported. The sanitize/erasure path was PRESERVE for the legacy table (`check-gdpr-export-coverage.ts:374-387`); after the drop that allowlist entry must go or the script flags a stale entry.

## PROD-read verification (orchestrator, post-deploy; counts only; marker query first)

Run each as its own `supabase db query --linked -f <file>` call from the repo checkout that holds the CLI link, scratch files outside tracked paths, no ids in any record. First, always:

```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

Reading times: the derive chain starts 00:40Z and composes after; read the closed-day forms after the compose has had time to finish (suggest not before 02:00Z; `[ASSUMED]` timing, measure the first night).

- **R0 (before PR 1, who loses the baseline banner):** `SELECT count(DISTINCT allocator_id) AS allocators_with_unknown_baseline FROM public.allocator_equity_snapshots WHERE pre_terminus_balance_unknown;`
- **R1 (PR 1 live; 181 SC-4 rewritten):** allocators holding non-Deribit positions on a connected key (`allocator_holdings` joined to `api_keys` on `api_key_id`, `lower(venue) <> 'deribit'`, `is_active`, `sync_status IS DISTINCT FROM 'revoked'`, `disconnected_at IS NULL`), left-joined to `allocator_equity_derived` where `kind = 'equity_curve'`; report in one row: holders, with_row, trustworthy (`(payload->>'is_trustworthy')::boolean`), and with_closed_day_point (`EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'curve') e WHERE e->>'date' = ((now() AT TIME ZONE 'UTC')::date - 1)::text)`). Expected: every holder has a row with a closed-day point, else name the count that does not.
- **R2 (the 3 zero-legacy-snapshot books):** the same population restricted to allocators with NO legacy row (`NOT EXISTS (SELECT 1 FROM public.allocator_equity_snapshots s WHERE s.allocator_id = h.allocator_id)`), and separately to allocators whose every connected key is strategy-linked (`strategies.api_key_id` or `strategy_keys`, non-archived). Expected: with_closed_day_point = holders in each.
- **R3 (bridge, after the first 03:00Z run on the new body):** counts of `bridge_outcomes` with `kind = 'allocated'` and `original_holding_ref IS NOT NULL` by: delta_30d non-null, delta_90d non-null, delta_180d non-null, `needs_recompute`, and `deltas_computed_at >= <deploy day>`; before PR 1, the same counts as the sizing read for OQ3.
- **R4 (after the cron is unscheduled and PR 2's worker is live):** `SELECT count(*) FROM public.allocator_equity_snapshots WHERE reconstructed_at >= <first UTC instant after the worker deploy>;` expected 0 after the next day boundary; `SELECT count(*) FROM cron.job WHERE command ILIKE '%enqueue_refresh_allocator_equity_for_all%';` expected 0; open jobs of the retired kinds by status (`compute_jobs`).
- **R5 (PR 3 pre-flight, the dependency scan):** names only, expected to equal the PR 3 drop-and-rebase list and nothing else: `SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.prosrc ILIKE '%allocator_equity_snapshots%' ORDER BY 1, 2;` plus `SELECT count(*) FROM pg_depend ...` for views/policies/FKs on the table (expect none beyond its own).
- **R6 (after the PROD apply):** `SELECT to_regclass('public.allocator_equity_snapshots') IS NULL AS table_gone;` and the same `prosrc` scan expecting 0 rows; then the migration ledger row for the PR 3 version.

## TODOS closure

| Entry (line in `TODOS.md`) | Closes how |
|----------------------------|------------|
| `167.2.1.1.1.1-MT5-BTC-MISSING-CLOSE-LEGACY-EXCLUSION` (13332) | Its text: "Closed when the stored close is present for every mark day or the legacy curve is retired." Append a dated `CLOSED` paragraph at PR 3's merge, in the house form of the closed entry at line 1458 (what was retired, where the proof is). The derived curve refuses that day's mark (NAVMTM D-07) and names the account (`unpriced_native_keys`); that behaviour is unchanged |
| `167.2.1.1.1.1-SFOX-NONSTABLE-LEGACY-EXCLUSION` (13338) | Text: "Closed ... by retiring the legacy curve." Append `CLOSED`. SFOX's NAV mark path (derived) counts those balances; the poll's `_fetch_sfox_balance_rows` skip stays but no longer feeds a curve |
| `167.2.1.1.1.1-OKX-DOUBLE-COUNT-BEYOND-REBUILD-WINDOW` (13322) | Store (1), the legacy rows older than the 90-day window, goes with the table. Stores (2) `allocator_holdings` history rows and (3) scenario-commit audit sizes REMAIN, and the entry says "Stays open" in its two dated readings. Do NOT close it: append a dated line that store (1) is gone and the entry narrows to (2) and (3) |
| Other entries naming the forced rebuild / reconstruct anchor | A `grep -aB1 'forced rebuild\|forced reconstruct\|legacy snapshot\|legacy row' TODOS.md` lists them (e.g. `167.2.1.1-MULTIKEY-RECOMPUTE`, `167.2.1.1.2-ACCOUNT-REBUILD-BLOCKERS`, `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE`, `167.2.1.1.1-UNFORCED-ANCHOR-BYBIT-USDT-UPNL`, `167.1.2.1.1-LEFTOUT-SENTRY-NO-WRITE`); decide per entry after OQ1 whether each is moot (if the reconstruct/refresh paths are retired) or still applies to the derive's anchor reads. Do not close an entry on a guess |

ROADMAP: add the dated "closes with 176" lines to the 181 and 182 sections (`.planning/ROADMAP.md` lines 6662 and 6683, plus the 176 section at 6529) at close, by hand (gsd-tools handlers: `git diff` after).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Regenerating `supabase/schema/functions/*.sql` | Hand-edit generated files | `npm run schema:functions` then `:check` | Files are `@generated ... DO NOT EDIT BY HAND`; `sql-function-snapshot.yml` pins them |
| Re-capturing the cron manifest | Hand-edit JSON | `node scripts/prod-prober/run.mjs --capture-manifest --out <scratch>` then diff | Captures the sha256 of each command; hand edits fail the arm |
| Baseline dump / marker | Hand-edit `baseline.sql` or the marker | AUTOREDUMP bot PR | sha binding; manual path is a fallback |
| Mutation / sentinel floors | Subtract a number | One full `node scripts/mutation-runner/run.mjs` run; `ci-anti-skip-gate.contract.test.ts` re-derives the sql-tests pair | The floors have been stale in prose four times (CLAUDE.md) |
| Data-dependence safety | A custom guard | Catalogue-only `DO` blocks and `to_regclass` / `pg_proc` reads | The linter has no opt-out by decision |
| Account-level equity change for bridge outcomes | A new curve computation in SQL | The existing derived `returns` / `curve` of the `equity_curve` row | One derivation owned by the compose; the ratio-of-dollars class was already ruled out |
| Key eligibility in TS | A new predicate | The existing `eligibleKeyIds` (`isPerKeyDailiesEligibleKey`), which the derive's `eligible_key_predicate` mirrors | Two predicates drifting is the failure D-01 removes |

**Key insight:** every piece of replacement logic already exists on the derived side; this phase is deletion plus three small re-pointings (counts, key rule, bridge branch). New code should be a few lines each; the risk is in what the deletion silently strands.

## Common Pitfalls

### Pitfall 1: Dropping the table leaves a broken `delete_allocator_api_key`
**What goes wrong:** last-key hard delete raises 42P01 in production. **Why:** plpgsql bodies are not dependency-tracked. **Avoid:** re-base the function in the same migration BEFORE `DROP TABLE`, and keep the `prosrc ILIKE` catalogue check. **Warning sign:** `test_api_key_delete_atomicity.sql` (rewritten) fails; R5 lists a name not on the plan.

### Pitfall 2: A data-reading guard in the migration refuses on TEST and blocks the PROD apply
**Avoid:** catalogue-only checks; run the lint locally. There is no marker to silence it.

### Pitfall 3: The cron outlives its function
**What goes wrong:** daily `failed` pg_cron runs, prober drift. **Avoid:** unschedule and re-capture the manifest before PR 3 merges; R4 and R5 confirm.

### Pitfall 4: Deleting a shared module or a registry row
`equity_reconstruction.py` is imported by the derive path; `compute_job_kinds` rows are FK targets and restore reference data. Keep both; delete symbols, not files, and only on zero remaining references.

### Pitfall 5: Floors and censuses
Deleting gates moves FILES_FLOOR, ARMS_FLOOR, sql-tests SENTINEL_FLOOR/ARMS_FLOOR, `lint-sql-gates` file count, `mutation-annotation-parser` by-name list, `gate-family-meta` pins, `COMPARED_FLOOR`. Run every one of the pins named in Census E; a stale-low direction is caught by `RATCHET STALE`, a stale-high by the runner.

### Pitfall 6: The new bridge formula reads flows as performance
Use (B) (flow-neutral returns) or state (A)'s limitation; NULL on a missing day; `COALESCE(new, old)` keeps stale legacy values where the new basis is NULL unless OQ3 chooses to null them.

### Pitfall 7: A false "warming up" on the Scenario KPI strip
`snapshotCount` = 0 on an untrustworthy/rebuilding derived row prints a wrong countdown. Pin the composer's rebuilding branch in a test (`KpiStrip.warmup.test.tsx`, `AllocationDashboardV2.warmup.test.tsx` are the analogs).

### Pitfall 8: Twin tests that select the newest definer
`test_fanout_owed_predicate_twins.py::_newest_fanout_body` and the TS twins pick the NEWEST migration defining the fan-out. A redefinition (instead of a drop) changes what they pin; a DROP is not modelled by their regexes. Retire the twins with the thing they twin.

### Pitfall 9: Orphaned derived rows
`snapshot_rebuild_boundary` rows stay in `allocator_equity_derived` after the window RPC is gone, and the GDPR export would still return them (the table stays exported). Clear them in the PR 3 migration (a plain DELETE) and remove `src/lib/snapshot-rebuild-boundary.ts`, the payload field `snapshotRebuildBoundary` and its read.

### Pitfall 10: CI-suppression text and the planning guard
Do not write a skip token anywhere in a commit or PR body; a ship branch must not touch `.planning/`; `npm run lint` runs `scripts/check-planning-hygiene.ts` (rules 6d/6e/7 guard ROADMAP/STATE shape).

### Pitfall 11: Treating this research's counts as constants
They are measurements at `0d8aad242`. Re-run `grep -rIac 'allocator_equity_snapshots' ...` and the gates before each PR.

## Code Examples

### Derived-series counts in `derivePhase07Fields` (PR 1 shape; the existing helper does the work)
```typescript
// Source: src/lib/queries.ts (curveForSource at :5105 is already trustworthyDerivedCurve(derivedPayload))
const drawn = trustworthyDerivedCurve(derivedPayload);   // DailyPoint[] | null
const snapshotCount = drawn?.length ?? 0;                 // days of the drawn derived curve
// minHistoryDepthMonths and equityBaselineUnknown are deleted (see Derived-series replacements)
```

### The rule change (PR 1)
```typescript
// Source: src/lib/queries.ts:6110 (current): eligibleKeyIds.filter((id) => !strategyLinkedKeyIds.has(id))
const allocatorEligibleApiKeyIds = eligibleKeyIds;  // 181: a strategy-linked key also counts in its owner's book
```

### Bridge helper, flow-neutral option (B) - skeleton for the design, not final SQL `[ASSUMED]`
```sql
-- payload shape verified in src/lib/queries.ts:4375-4440: version = 2, is_trustworthy = true,
-- returns = [{date, r}] strictly ascending. NULL when any day of the window is absent or 1 + r <= 0.
CREATE OR REPLACE FUNCTION public.extract_derived_account_delta(
  p_allocator_id uuid, p_anchor date, p_days int
) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  WITH d AS (SELECT payload FROM public.allocator_equity_derived
              WHERE allocator_id = p_allocator_id AND kind = 'equity_curve'
                AND (payload->>'version')::int = 2 AND (payload->>'is_trustworthy')::boolean),
       w AS (SELECT (e->>'r')::numeric AS r
               FROM d, jsonb_array_elements(d.payload->'returns') e
              WHERE (e->>'date')::date > p_anchor AND (e->>'date')::date <= p_anchor + p_days)
  SELECT CASE WHEN count(*) = p_days AND bool_and(1 + r > 0) THEN exp(sum(ln(1 + r))) - 1 END FROM w;
$$;
```
(`count(*) = p_days` encodes "no missing day"; the voluntary/strategy branches stay byte-identical outside the holding CTEs.)

## State of the Art

| Old approach | Current approach | When changed | Impact |
|--------------|------------------|--------------|--------|
| Display curve from `allocator_equity_snapshots` | `allocator_equity_derived` kind `equity_curve` (v2, with flow-neutral returns) | Phase 115.1 / 167.1.2 plan 11 | Legacy rows have no display role; only derived counts and the bridge branch remain |
| Role-based book membership (Phase 151 AUM-04) | Role-agnostic book (founder 2026-10-31) | 2026-10-31 | The TS field catches up with the derive and the fan-out |
| Per-symbol dollar ratios as returns | Mark-price rule / flow-neutral returns | Phase 167.1.1 (compare), 167.1.1.1 (matcher) | Same reasoning applies to bridge outcomes (OQ2) |
| Hand cron moves | Runbook forms + `--capture-manifest` | NAVMTM / MARKSOURCE runbooks | The unschedule follows the same shape |

**Deprecated by this phase:** `allocator_equity_snapshots`, `replace_allocator_equity_snapshots[_window]`, `extract_symbol_value_at`, `enqueue_refresh_allocator_equity_for_all`, `persist_equity_snapshots` and the `refresh_allocator_equity_daily` job (and, per OQ1, the reconstruct job).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OKX's derived history is not capped at 90 days for the venue-copy question (the OKX archive rebuild kind exists) | Derived-series replacements | If still capped, an OKX allocator loses venue-specific copy that was true; recommendation to delete the depth branch stands for the span-degeneracy reason, but the founder may want a different venue-neutral line |
| A2 | The closed-day derived point exists by ~02:00Z | PROD-read verification | Readings taken too early show false "missing" counts; measure the first night |
| A3 | Exact finding kinds the DRIFT-05 / content-drift gates print for a dropped (not replaced) function | Migration constraints 5 | Extra ratchet rows or a different floor move; resolve by running the gates locally on the PR 3 branch |
| A4 | Option (B) flow-neutral compounding is what the founder means by "derived account total" | Bridge outcomes | If the founder wants literal curve ratios the helper changes by one expression; flows would then read as performance |
| A5 | The skeleton SQL helper's `exp(sum(ln(1+r)))` is numerically adequate for 180 daily returns | Code Examples | Precision loss in `numeric`; test against an independent product |

## Open Questions (RESOLVED)

1. **Does 176 retire the `reconstruct_allocator_history` job kind, or only its snapshot writes? (decides PR 2's size; raise to the founder via the orchestrator)**
   - What we know: D-02 names the refresh job's write, `persist_equity_snapshots`, the replace RPCs and the bootstrap gate. The reconstruct job's only durable outputs besides the table are the marker, audits and the rebuild-boundary row; the derive depends on none. It has three enqueue paths (fan-out bootstrap, `request_allocator_holdings_sync`, force_rebuild) and large dependent machinery (cap/marker/note twins in SQL, Python and TS, orphan-sweep Sentry, trade-read store, `allocator_history_probe.py`, Phases 173/178/179/180 gate tooling).
   - What's unclear: whether the founder wants the 30-minute crawl to keep running with no output, be retired, or be retired later in a separate phase.
   - Recommendation: Option R (retire): stop all three enqueue paths (a re-base of `request_allocator_holdings_sync` in a migration), make the handler return `DONE` with a retired audit for stragglers, and delete the persist/replace call graph, the twins and the probe; leave the cap/marker machinery inert and remove it in a follow-up phase unless the founder says otherwise. Fallback Option W (writes only): keep the crawl, drop only persist/replace calls; strictly worse (wasted exchange traffic, an unreachable "completion" meaning). Either way `equity_reconstruction.py` stays as a module.
   - **RESOLVED (D-04):** Option R, retire the job. Plan 08 makes both kinds a DONE stub, plan 09 re-bases `request_allocator_holdings_sync`, plan 12 unschedules the cron, plan 10 retires the force-rebuild procedure, plan 11 deletes the writers and the crawl; the cap and marker machinery stays inert and is booked (`176-RECONSTRUCT-CAP-MARKER-INERT`).
2. **D-03 formula: curve ratio (A) or flow-neutral returns (B)?** Recommendation (B), with the evidence in `## Bridge outcomes`. Also: apply to the 180-day window too (the function computes it) and confirm the holding branch keeps setting no `estimated_*`.
   - **RESOLVED (D-05):** (B), compounded flow-neutral daily returns for +30/+90/+180, NULL on a missing day, no `estimated_*` on the holding branch (plan 02).
3. **Are stored holding-branch outcomes recomputed?** D-03 reads "keep their values". Size with form R3 first. If recomputed, null the old deltas in the same statement to avoid a mixed-basis result.
   - **RESOLVED (D-06):** reset and recompute once; one owner-only function NULLs the deltas and sets needs_recompute together, after the R3 count (plans 02 and 07).
4. **User-facing copy:** removing the "Only N months of history available on {venues}" branch and the "Limited equity history" banner. Needs an explicit founder acknowledgement (planner raises); R0 names who sees the banner today.
   - **RESOLVED (D-07):** both the depth copy and the banner are removed after the R0 count; the 30-day countdown stays on derived days (plans 05 and 07).
5. **Dead `managerSide*` plumbing** after the key-rule change: delete in PR 1 or leave inert? Recommendation: leave inert, note it as the follow-up cleanup (smaller diff, no behaviour change).
   - **RESOLVED (plans 03 and 05):** left inert and booked as `176-INERT-LEFTOVERS`.
6. **Ratchet direction:** retiring ~4 gate files lowers FILES_FLOOR/ARMS_FLOOR/SENTINEL_FLOOR/ARMS_FLOOR. This is a deliberate downward move of a normally upward-only ratchet; record the reason beside each constant and in the CHANGELOG.
   - **RESOLVED (plans 09 and 13):** each lowered constant carries a dated LOWERED line with its reason and one measured full run; the CHANGELOG entries name them.
7. **Operator tooling:** retire or banner the probe, the e2 ground-truth script and the OKX census runbooks (Census C). Recommendation: delete the scripts and their tests with the writers; banner the runbooks.
   - **RESOLVED (plans 10 and 11):** the two scripts and their tests are deleted with the writers (plan 11); the runbooks get dated retirement banners (plan 10).
8. **Backup before the one-way drop** (D-02 "needs a restore from backup"): D-02 is decided; the planner may add a read-only pre-drop row count to the PR 3 SUMMARY so the loss is on record. No archive table is proposed.
   - **RESOLVED (plan 16):** no archive table; the read-only pre-drop row count and date range are recorded in plan 16's SUMMARY before the merge.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | vitest, tsx scripts, runners | yes | v25.8.1 | - |
| npx vitest | TS tests | yes | 5.0.5 | - |
| python3 + pytest | worker tests (from `analytics-service/`) | yes | 3.14.3 / 9.0.2 | - |
| mypy | CI strict line | yes | 2.0.0 | - |
| PostgreSQL binaries (`pg_ctl`, `psql`) | `scripts/pg-lane/run.sh`, mutation runner | yes | psql 18.6 client; server `postgresql@16` present | - |
| Docker daemon | `scripts/local-stack/run.sh` lane (`sql-tests`, `frontend-local-stack`) | **no** (client installed, daemon not running `[VERIFIED: docker ps]`) | - | Run the SQL gates on the pg-lane locally; the local-stack lane runs in CI only |
| supabase CLI | PROD reads/writes (linked to PRODUCTION from the main checkout) | yes | 2.84.2 | - |
| gh | PR/CI reads | yes | - | - |

**Missing with fallback:** Docker daemon (CI covers the local-stack lane).

## Validation Architecture

`workflow.nyquist_validation` is not set to false in `.planning/config.json` (treated as enabled).

### Test Framework
| Property | Value |
|----------|-------|
| TS | vitest 5.0.5, config `vitest.config.ts` (coverage thresholds are a ratchet read from that file, never restated) |
| Python | pytest 9.0.2, `analytics-service/pytest.ini`; run only from `analytics-service/` |
| Types | `npm run typecheck` (`tsc --noEmit`); mypy strict line above |
| SQL | `supabase/tests/*.sql` via `scripts/pg-lane/run.sh --workdir <scratch> --apply <files...> --gate <gate.sql>`; mutation: `node scripts/mutation-runner/run.mjs --file <gate.sql>` (diagnostic) and the full run for floors |
| Quick run (TS) | `npx vitest run <file> -t "<name>"` (measured 1.1 s) |
| Full suite | `npm test`; `cd analytics-service && python3 -m pytest`; `npm run lint`; `npm run typecheck` |

### Phase Behaviours -> Test Map
| ID | Behaviour | Test type | Automated command | File exists? |
|----|-----------|-----------|-------------------|-------------|
| B-01 | `snapshotCount` equals the drawn derived curve's day count; 0 with no/untrustworthy row; the Scenario KPI strip does not print a false countdown while rebuilding | unit (mocked supabase) | `npx vitest run src/lib/queries.my-allocation.test.ts src/lib/queries.test.ts` | rewrite TC p7-02/03 (:1116,:1259); RED on base: seed derived row with N days, legacy mock empty, base returns 0 |
| B-02 | No legacy read: `getMyAllocationDashboard` never calls `.from("allocator_equity_snapshots")` | unit | same file; assert the harness table switch (:338) is never hit | new arm; RED on base (base calls it) |
| B-03 | `minHistoryDepthMonths` / `equityBaselineUnknown` / `equitySnapshots` removed; generic countdown copy only | component | `npx vitest run "src/app/(dashboard)/allocations/components/KpiStrip.warmup.test.tsx" "src/app/(dashboard)/allocations/AllocationDashboardV2.warmup.test.tsx" "src/app/(dashboard)/allocations/AllocationDashboardV2.baseline-unknown.test.tsx"` | rewrite; baseline-unknown test is deleted with the banner; `tsc --noEmit` is the oracle for the ~37 fixtures |
| B-04 | A strategy-linked key is in `allocatorEligibleApiKeyIds` (direct link, composite link, own_capital, team_review, unmarked) | unit | `npx vitest run src/lib/queries.my-allocation.test.ts -t "book-entry gate"` | existing blocks :4093-4680 flip; they are the RED-on-base (assert old `toEqual(["k-bybit","k-okx"])` fails against new rule) |
| B-05 | Bridge holding branch reads the derived `equity_curve`; NULL on a missing day or untrustworthy/v1 row; strategy and voluntary_add branches unchanged; 30/90/180 identical rule | SQL gate (pg-lane) with `RED-UNDER` annotations | `bash scripts/pg-lane/run.sh ... --gate supabase/tests/test_bridge_outcome_deltas_derived.sql` | NEW file (analog: `test_api_key_flow_prices.sql`, `test_allocator_trade_reads.sql` for annotation shape); neuter the helper to the old symbol read, see RED |
| B-06 | Live-DB check of B-05 | vitest live-db (skips without env) | `npx vitest run src/__tests__/bridge-outcome-cron-holding.test.ts` | rewrite its fixture from `breakdown` rows to a derived row; note it skips silently without `HAS_LIVE_DB` (Rule 12: do not count a skip as a pass) |
| B-07 | Refresh job and reconstruct job write nothing to the legacy table; retired handler returns `DONE` (per OQ1) | pytest | `cd analytics-service && python3 -m pytest tests/test_equity_reconstruction.py tests/test_refresh_allocator_equity_carry_forward.py -q` | rewrite; RED on base: assert no `allocator_equity_snapshots` upsert/rpc in the fake DB (the fakes already record rows, e.g. `fake.rows_for("allocator_equity_snapshots")`) |
| B-08 | Compose job never reads or writes the legacy table (guard) | pytest | `python3 -m pytest tests/test_derive_allocator_equity_job.py -q` | exists (`LEGACY_TABLE` guard :313,:2651); keep until drop |
| B-09 | mypy strict clean | type | the verbatim mypy line from `analytics-service/` | n/a |
| B-10 | PR 3 migration: table and 5 functions gone, no function body names the table, `delete_allocator_api_key` still deletes its key and holdings on cascade | SQL gate | rewritten `test_api_key_delete_atomicity.sql` via the pg-lane or CI `sql-tests` | rewrite (arms 1/3 lose the snapshot parts); RED on base: run the new arms against the pre-migration schema |
| B-11 | GDPR manifest has no `allocator_equity_snapshots`; coverage script green | script + vitest | `npx tsx scripts/check-gdpr-export-coverage.ts` and `npx vitest run src/__tests__/gdpr-export.test.ts src/__tests__/gdpr-export-schema.test.ts` | edit pins |
| B-12 | Census gates green: data-dependence, function snapshot, content drift, mutation floors, sql-tests anti-skip | scripts + vitest | `node scripts/lint-migration-data-dependence.mjs --self-test && node scripts/lint-migration-data-dependence.mjs`; `npx tsx scripts/dump-sql-functions.ts --check`; `node scripts/baseline-content-drift-check.mjs`; `node scripts/lint-sql-gates.mjs --self-test`; `npx vitest run src/__tests__/mutation-runner-floors.test.ts src/__tests__/mutation-annotation-parser.test.ts src/__tests__/gate-family-meta.test.ts src/__tests__/lint-sql-gates.test.ts src/__tests__/drift-check-scripts.test.ts src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` | exist; values move |
| B-13 | Cron manifest matches PROD after the unschedule | operator + prober | `node scripts/prod-prober/run.mjs --self-test` (hermetic); `--capture-manifest` is the PROD read | exists |

### Sampling Rate
- **Per task commit:** the single touched test file (`npx vitest run <file>` or `python3 -m pytest <file> -q` from `analytics-service/`).
- **Per wave merge:** `npm run typecheck`, the vitest files named in the touched rows, the pytest files of the touched module, `node scripts/lint-migration-data-dependence.mjs`, `npx tsx scripts/dump-sql-functions.ts --check`.
- **Phase gate (each PR):** `npm test` and `npm run lint` and `npm run typecheck`; `python3 -m pytest` and the mypy line for any `analytics-service/` change; the census scripts in B-12; a full `node scripts/mutation-runner/run.mjs` run whenever a gate file is added or removed (to re-derive the floors); CI must be green bound to the head SHA with the expected check count before merge.

### RED-on-base strategy
Each behaviour must be written first against the base and observed failing, then made green; neuter-and-restore from a byte backup (never `git checkout/restore/stash` on uncommitted work). Concretely: B-01/B-02/B-04 fail on base because base reads the legacy mock and subtracts linked keys; B-05 fails on base because the base body reads `breakdown`; B-07 fails on base because the fake DB records legacy rows; B-10 fails on base because the table and functions exist. A gate arm for the bridge change must carry `RED-UNDER` annotations that the mutation runner verifies bite (WAIVED_CEILING stays 0).

### Wave 0 Gaps
- [ ] `supabase/tests/test_bridge_outcome_deltas_derived.sql` - covers B-05 (new gate; raises the mutation floors and the sql-tests census if it declares a sentinel)
- [ ] A Python guard test that the refresh/reconstruct handlers touch no legacy table (extend the existing fakes) - B-07
- [ ] A pg-lane run recipe for the PR 3 migration against a fixture that has the legacy table, to prove the drop order and the `prosrc` check (B-10)

## Security Domain

`security_enforcement` is not set to false in config (treated as enabled).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | - |
| V3 Session Management | no | - |
| V4 Access Control | yes | Owner-RLS on `allocator_equity_derived` (`allocator_equity_derived_owner_select`, `TO authenticated USING (allocator_id = auth.uid())`) is the read boundary the dashboard already uses via the USER client with an explicit `.eq("allocator_id", userId)`; the SECURITY DEFINER bridge function reads it as definer and must keep `SET search_path = public, pg_catalog` and the existing `REVOKE ALL ... FROM PUBLIC, anon, authenticated` (`20260515205431`, `_assert_no_public_execute`) |
| V5 Input Validation | yes | The derived JSONB is worker-written and untrusted: the reader checks version, trust flag, date regex and finiteness (`queries.ts:4375-4440`); any SQL helper must cast defensively (a malformed row yields NULL, never an exception that aborts the daily batch) |
| V6 Cryptography | no | - |
| V8 Data Protection | yes | Public repo: no PROD ids, home paths, account numbers in tracked text; counts-only PROD readings; GDPR export manifest updated; one-way data deletion is a recorded founder decision (D-02) |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant read via a SECURITY DEFINER helper taking `p_allocator_id` | Information disclosure | Keep the helper non-callable by `anon`/`authenticated` (REVOKE with the full signature) and called only from the batch function; re-run the `_assert_no_public_execute`-style probe the repo already uses |
| Silent data loss from an unordered DROP | Tampering / Denial | Dependents first, `prosrc` catalogue check, R5 pre-flight scan |
| Secret/PII leakage in public planning text or a baseline dump | Information disclosure | The AUTOREDUMP refusals (secret scan, gitleaks) remain; never paste a PROD id or a credential-shaped literal into CHANGELOG |
| Daily batch aborted by one malformed derived row | Denial | Defensive casts in the helper; NULL on malformed |

## Sources

### Primary (HIGH confidence, files opened this session at HEAD `0d8aad242`)
- `src/lib/queries.ts` (:3152-3260, :3365-3450, :3760-3860, :4115-4231, :4340-4560, :4900-5260, :5370-5420, :5495-5560, :5740-5880, :6030-6290)
- `src/app/(dashboard)/allocations/components/KpiStrip.tsx`, `ScenarioComposer.tsx` (props/uses), `AllocationDashboardV2.tsx`, `lib/live-holdings-summary.ts`
- `analytics-service/services/equity_reconstruction.py` (:1940-2450, :2837-3260, :6566-7280, :7386-8056), `services/job_worker.py` (:907, :8195-8560, :14356-14470, :15735-16016), `services/allocator_equity_compose.py` (:1030-1130), `services/allocator_equity_derive.py` (:1-120, :331-362), `services/nav_marks.py:205`
- `supabase/schema/functions/{enqueue_refresh_allocator_equity_for_all,delete_allocator_api_key,compute_bridge_outcome_deltas,extract_symbol_value_at,extract_equity_at,extract_delta,parse_holding_ref,enqueue_derive_broker_dailies_for_allocator_keys}.sql`, `supabase/schema/baseline.sql` (grep + :1660-1765, :16729-16740, :18591-18593), `supabase/schema/BASELINE.md` (:1017-1149)
- `supabase/migrations/20260717233529_allocator_equity_derived_surface.sql`, `20260908120000_drop_create_allocator_connected_strategy.sql`, `20261028120000_replace_allocator_equity_snapshots_window.sql` (header), `20260924233749_allocator_sync_restore_inflight_prefetch.sql`
- `scripts/prod-prober/cron-manifest.json`, `scripts/lint-migration-data-dependence.mjs` + baseline, `scripts/baseline-content-drift-check.mjs`, `scripts/dump-sql-functions.ts`, `scripts/mutation-floors.mjs`, `.github/workflows/ci.yml` (:4935-5198), `.github/workflows/migration-drift-check.yml`
- `docs/runbooks/marksource-legacy-chain-move-go-live.md`, `docs/runbooks/bridge-outcome-cron.md`, `TODOS.md` (:1458, :13322-13350), `.planning/ROADMAP.md` (:6529-6700), `176-CONTEXT.md`
- Commands run: `node scripts/baseline-content-drift-check.mjs`, `npx tsx scripts/dump-sql-functions.ts --check`, `node scripts/lint-migration-data-dependence.mjs` (all clean at HEAD); one vitest file and one pytest file as tool smoke tests

### Secondary (MEDIUM confidence)
- The migration-reviewer invariant list as recorded in `.planning/phases/164.9.3-claimpair-*/164.9.3-MIGRATION-REVIEW-migration-reviewer.md` (the agent definition file lives in the main checkout and was deliberately not opened)

### Tertiary (LOW confidence)
- None used as authority. Items tagged `[ASSUMED]` are in the Assumptions Log.

No external documentation lookup (Context7 / web) was needed: the phase touches no third-party API surface. The research-plan seam was therefore not invoked.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - existing tools, each exercised this session.
- Architecture / census: HIGH - every reader/writer anchor re-measured; one OPEN scope question (reconstruct kind) bounds PR 2.
- Derived-series definitions and the D-03 formula: MEDIUM - design recommendations with evidence, flagged for confirmation.
- Pitfalls: HIGH for migration/census mechanics (documented precedents), MEDIUM for gate behaviour on a DROP (A3).

**Research date:** 2026-10-31
**Valid until:** about 7 days for line numbers (this repo moves several PRs a day; re-grep before each PR); the structural findings (single product reader, cron change, shared module) are stable for the life of the phase.

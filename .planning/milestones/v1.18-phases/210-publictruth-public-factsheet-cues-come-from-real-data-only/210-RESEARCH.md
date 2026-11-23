# Phase 210: PUBLICTRUTH - Research

**Researched:** 2026-11-14
**Domain:** one SQL migration plus its mutation-gated test, a payload-field removal across the factsheet builder, and a malformed-record reader plus Sentry report plus one render sentence.
**Confidence:** HIGH on the SQL/mutation machinery and the census lists (all measured at HEAD in this worktree); MEDIUM on expected CI colours before merge (inferred from CHANGELOG precedent and workflow source, not from a run on this PR).

All paths below are repo-relative. Measured at worktree HEAD `ac5dc3f43` (branch `feat/210-publictruth`, on top of main `8fc78b69a`).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(Copied verbatim from 210-CONTEXT.md `## Decisions`.)

### D-01..D-06 - Venues: closed windows (SC-1)
- **D-01** Restrict the `strategy_keys` arm to open windows: `sk.window_end IS NULL OR sk.window_end > current_date`. `strategy_keys.window_end` is the EXCLUSIVE end of a half-open `[window_start, window_end)` DATE window (migration `20260710120000`, COMP-02), and NULL means still active. A window whose `window_end` is today or earlier has closed. This is the first option in the TODOS entry, and SC-1 says "filters". The alternative (keep the historical union and reword the tooltip) is rejected.
- **D-02** The single-key arm (`strategies.api_key_id`) is unchanged; it has no window. A future-dated window (`window_start > current_date`) is not filtered: it is not a closed window, the TODOS entry does not ask for it, and the wizard does not write one.
- **D-03** A new forward migration (`CREATE OR REPLACE FUNCTION`, same signature, same `RETURNS TABLE (strategy_id uuid, exchange text)`, same SECURITY DEFINER, `SET search_path = public, pg_temp`, `LANGUAGE sql STABLE`). Re-base the body on the latest definition: only `20261019120000` defines it (measured: no later migration touches it). Re-assert `REVOKE ALL ... FROM PUBLIC` and `GRANT EXECUTE ... TO anon, authenticated, service_role`. A `CREATE OR REPLACE` keeps the ACL, but the explicit re-grant costs nothing and matches house style.
- **D-04** The self-verify is CATALOGUE-ONLY, as in `20261019120000`: pg_proc, the privilege functions, and the function body text (`prosrc` contains the window predicate). It reads no table, so it applies on TEST's empty tables ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). No data-reading `DO` block that RAISEs on counts.
- **D-05** The rollback file `supabase/migrations/down/<new>-rollback.sql` restores the `20261019120000` body with `CREATE OR REPLACE`. It does not DROP, so readers keep working after a rollback.
- **D-06** An all-windows-closed published composite now returns zero rows for that strategy. `readPublishedTradeVenues` then sets no `tradeVenues` on the row, and `SyncBadge` shows the listed exchange with no mismatch cue. That is the honest result: no key currently supplies its trades. A test pins it.

### D-07..D-09 - Venues: gates (SC-1, SC-4)
- **D-07** `supabase/tests/test_get_published_trade_venues.sql` gains a closed-window arm. A published strategy listed `okx` has a closed `binance` `strategy_keys` member (window ended in the past) and an open `okx` member. Anon gets exactly one row, `okx`. Its `RED-UNDER-M` drops the window predicate from the NEW migration, so the arm bites when the fix is reverted. Add an arm (or fold into this one) for the window that ends exactly today: `window_end = current_date` counts as closed.
- **D-08** Every existing body-mutating `RED-UNDER-M` arm in that file edits `20261019120000_...sql` by `file`/`find`/`occurrences`. Once the new migration replaces the body, those edits are masked and the arms stop biting, which reds `sql-mutation`. Re-point every body-editing arm (TV-shape, TV-1, TV-unpublished, TV-unpublished-composite, TV-strategy-keys, TV-distinct-lower) at the new migration file, and add the new migration to `RED-UNDER-SETUP`. TV-shape's fourth step re-baselines the self-verify string in the file that holds it. The new file's comments must not repeat any `find` string, or the `occurrences` counts break.
- **D-09** Move the mutation census in the same commit as the new arm(s): `ARMS_FLOOR` in `scripts/mutation-floors.mjs` and its `gate-family-meta.test.ts` registry key, plus any other census that counts arms or migrations (grep them all). Use `node scripts/mutation-runner/run.mjs --parse-only` and a SUBSET run of the one gate file as the measurement. A `SyncBadge` test covers the TODOS case: a strategy listed `okx` whose venues are `[okx]` after the filter shows no mismatch, while `[binance, okx]` still shows one. That pins the badge contract the SQL fix relies on.

### D-10..D-15 - Demo payload removal (SC-2)
- **D-10** Drop `peerPercentile` and `allocatorPortfolios` from `FactsheetApiPayload` in `src/lib/factsheet/types.ts`, and drop their assembly in `buildFactsheetPayload` (`src/lib/factsheet/build-payload.ts`). This follows the TODOS entry's Action text.
- **D-11** Delete the producers that become dead: `src/lib/factsheet/peer-cohort.ts` (`computePeerPercentile`, the seeded cohort) and `src/lib/factsheet/allocator.ts` (`alignBlend`, `buildAllocatorMetrics`, `comparatorLeg`, `blend`), with their unit tests. Measured: their only non-test importer is `build-payload.ts`. Delete `AllocatorPortfolioPayload` and the SPX/IEF/GLD/ETH daily fixture series only if nothing else imports them. The planner measures that. KEEP `PeerPercentilePayload`, which the csv arm's `scenarioPeer` uses.
- **D-12** Census and parity tests that import the deleted producers (`return-stats.sites.test.ts`, `return-stats.sites-joint.test.ts`, `return-stats.single-source.test.ts`, and any figure-gate census) are updated to drop the retired sites, not loosened. A site census that loses a site loses a row; it does not gain an exclusion.
- **D-13** Remove `FactsheetBodyOptions.hideAllocatorSection` / the `hideAllocatorSection` prop in `FactsheetView.tsx`, and its two callers (`AllocationDashboardV2.tsx`, `ScenarioFactsheetChart.tsx`). The TODOS Action asks for this; it has been a documented no-op since QUIETVIEW.
- **D-14** Bump the factsheet `unstable_cache` key in `src/app/factsheet/[id]/v2/page.tsx` ONCE for the whole phase (`factsheet-v2-payload-v24` -> `v25` at planning time), with a dated comment naming both payload changes (D-10 and D-17). Grep every other cache key that stores a factsheet payload (OG route, scenario share, allocator portfolio payload) and bump any that stores the api arm. Re-pick the number from origin/main right before pushing: parallel phases bump it too.
- **D-15** The RED-on-revert test is a RUNTIME assertion on a built api-arm payload: `"peerPercentile" in payload` and `"allocatorPortfolios" in payload` are both false, plus a serialized-payload check that no demo cohort or blend name (for example "60/40 Stocks/Bonds") appears. A type-only removal cannot fail at runtime, so it does not count. Update the `build-payload.test.ts.snap` snapshot and every test that read the fields. Measured: about 60 files mention the fields or the prop, not the "about 13" the TODOS entry estimated. Most only build a payload fixture.

### D-16..D-20 - Gap record (SC-3)
- **D-16** Change the gap reader to mirror `readReconstructedRanges` in the same module: `readUnrecoveredGaps(seriesProvenance)` returns `{ gaps, malformed: string | null }`, where `malformed` is null for absent or valid and a short reason string otherwise. It stays pure and total, and one bad entry still voids the whole record. Keep or replace `parseUnrecoveredGaps` as the planner sees fit, with no second parser.
- **D-17** The caller in `src/lib/factsheet/fetch-and-build-payload.ts` reports a non-null `malformed` with `captureToSentry(new Error("factsheet: series_provenance.unrecovered_gaps is malformed"), { tags: { stage: "factsheet-unrecovered-gaps", reason: "unrecovered_gaps_malformed", strategy_id }, extra: { detail: <reason string> } })`. Only the reason string goes into `extra`, never the raw provenance (Phase 209 SCRUBLEAKS is removing raw data from error reports). It sets an optional payload flag `unrecoveredGapsUnavailable?: true` beside `reconstructedRangesUnavailable`, threaded through `build-payload.ts`'s strategy input like that flag.
- **D-18** `UnrecoveredGapLines` takes `unavailable?: boolean`. When true it renders one muted-secondary sentence instead of the gap lines, in the posture of `RECONSTRUCTED_UNAVAILABLE_SENTENCE` (DESIGN.md: declarative, sentence case, states the limit, muted rather than warning, because the page admits it does not know and makes no finding). Copy: **"Record of days without trade data unavailable. Some days may be missing from the record."** It names no dates and makes no claim about the exchange (F1 rule). The tear sheet renders `FactsheetView` from the same builder, so this one path covers both surfaces.
- **D-19** Tests that go RED on today's code: (a) a reader unit test where a malformed record yields `malformed !== null`; (b) a fetch-and-build test where a malformed record calls `captureToSentry` once with the stage tag and sets the flag; (c) a render test where `unavailable` shows the sentence and no gap line, and a valid empty record shows nothing.
- **D-20** The cache key bump in D-14 covers this field. One bump for the phase.

### Claude's Discretion
- Exact migration timestamp, file names and arm ids (house pattern `TV-<name>`).
- Whether `parseUnrecoveredGaps` is renamed or wrapped (D-16), as long as one parser remains.
- Plan split (recommended: one plan per fix, all wave 1, all independent; the venues plan carries the migration and the mutation census).

### Deferred Ideas (OUT OF SCOPE)
- Future-dated `strategy_keys` windows (not yet active) are still returned by the venue function. The TODOS entry did not ask for this, the wizard does not write them, and there are 0 on PROD.

(Phase-boundary exclusions also stated in CONTEXT: `eventSignatures` / `benchEventSignatures`, the csv arm's `scenarioPeer` and `scenarioOwnBookDelta`, and Discovery's `getPercentiles` / `PeerRanksSection` are out of scope.)
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are mapped to Phase 210 (ROADMAP: `**Requirements**: TBD`). The four ROADMAP success criteria (SC-1..SC-4) are the contract; section "Validation Architecture" maps each to a RED-on-revert test.
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- AGENTS.md: this Next.js differs from training data; read `node_modules/next/dist/docs/` before Next-specific code. This phase writes no Next-specific API code (no new route, no new caching primitive), but `unstable_cache` key bumping is touched. `node_modules` is ABSENT in this worktree (see Environment Availability), so the docs could not be read here.
- Which-database rule: `supabase/.temp/project-ref` is linked to PRODUCTION. No `supabase db push` / `--linked` from this directory. The marker query (`shobj_description`) must run first before any write; this phase needs no database write by the research or plan stages, only repo edits. PROD migrations auto-apply once `apply-test` succeeds after merge, so migration-reviewer and rls-policy-auditor must be clean BEFORE merge.
- `sql-gate` rules: gate files carry a prose `RED-UNDER:` marker AND a structured `RED-UNDER-M:` twin on the next line; `WAIVED_CEILING` is 0 and never raised; never restate an arm count from memory, regenerate it.
- CHANGELOG discipline: every ship writes a CHANGELOG entry plus a 4-digit `VERSION`/`package.json` bump in one `chore(release)` commit; never write a CI-skip trailer token in any commit message or PR body.
- Completion is historical: verification frontmatter uses `verified_at_sha` + `drift_subjects`, never `covered_digest`/`covered_files`.
- Public repo with `.planning/` tracked: no secrets, PROD ids, home paths, or account numbers in tracked text. `scripts/check-planning-hygiene.ts` (part of `npm run lint`) fails on an absolute home path.
- No AI-authorship trailers in commits (user memory), even though the harness attribution reminder suggests them: the user's memory rule takes precedence.
- Design: read DESIGN.md before any visual decision; the gap-unavailable sentence is locked by D-18 (muted-secondary, sentence case).
- Subagents never run `gsd-tools` state handlers carelessly: `git diff` after every handler run.

## Summary

Three independent fixes. The venues fix is one `CREATE OR REPLACE` migration plus a re-pointing of the six body-mutating mutation arms and two new arms. The measured machinery says: arms are applied by `edit` steps to a copy of a file named in the gate's `RED-UNDER-SETUP` apply list, applied in list order, so an arm that still targets the old migration is masked by the later `CREATE OR REPLACE` (it would read as `no-red`). All six body-editing arms must move; ten arms become twelve; `ARMS_FLOOR` 830 becomes 832 with a fixed list of pin moves (census section below). One finding the CONTEXT misses: `TV-shape` widens `RETURNS TABLE`, and a `CREATE OR REPLACE` that changes an OUT-parameter row type fails with `cannot change return type of existing function` (reproduced on a scratch PostgreSQL 16), so TV-shape must edit BOTH migrations (the old one widened too) or it will not reach the gate.

The demo payload removal is mostly mechanical: `build-payload.ts` is the only non-test importer of `peer-cohort.ts` and `allocator.ts`, and no component reads `peerPercentile` / `allocatorPortfolios`. The SPX/IEF/GLD/ETH daily series MUST STAY: `build-payload.ts` still imports them for the real comparator alignment and correlation rows (`al.spx`, `al.eth`, `al.gld`, `al.ief`, lines 191-194, 522-535, 623). Of 65 files in `src/` that mention the fields or the prop, 46 mention only `hideAllocatorSection` (prop-pass in render tests: tsc excess-property errors, not runtime). The only cache that stores a factsheet payload is the `unstable_cache` in `src/app/factsheet/[id]/v2/page.tsx` (the share route reaches it through the same wrapper); the OG route, the scenario share and the allocator portfolio payload do not use `unstable_cache`. Three tests pin the key string and must move with the bump.

The gap record mirrors `readReconstructedRanges` one-for-one: the caller, the optional flag spread, the render prop and the test templates all exist. `parseUnrecoveredGaps` has one production caller and about 14 test calls; keep it as a one-line wrapper over `readUnrecoveredGaps(...).gaps` (the `parseReconstructedRanges` precedent), which leaves one parser and keeps those tests green.

**Primary recommendation:** Three wave-1 plans, one per fix. The venues plan owns the migration, the rollback, the VAC-04 `-- prod-body-ack:` pragma, the regenerated function snapshot, the six re-pointed plus two new mutation arms, and every census move listed below; expect `sql-gate-lint` (baseline-content-drift DRIFT) to read red on the PR and on main until the post-apply baseline re-dump, per the Phase 194 precedent.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Which key venues count as "where trades come from" | Database / Storage (SECDEF function) | API / Backend (`readPublishedTradeVenues`) | Anon cannot read `api_keys`; the predicate must live in the function so it is correct by construction. |
| Mismatch cue rendering | Browser / Client (`SyncBadge`) | Frontend Server (Discovery page data) | Badge only compares the list it is handed; no logic change. |
| No invented peer/allocator data in the payload | API / Backend (`buildFactsheetPayload`, server) | Frontend Server (RSC serialization, `unstable_cache`) | The values were computed server-side and serialized to the client; removal must happen at the producer, not the render. |
| Cached factsheet payload staleness | Frontend Server (`unstable_cache` key in `v2/page.tsx`) | -- | Key bump invalidates old entries that still carry the fields. |
| Gap-record validity verdict | API / Backend (`trade-fetch-provenance.ts`, `fetch-and-build-payload.ts`) | -- | Server truth only; the client never infers a gap. |
| Gap-unavailable sentence | Browser / Client render of server flag (`UnrecoveredGapLines`) | Frontend Server (tear sheet page reuses `FactsheetView`) | One render path covers factsheet and tear sheet. |
| Malformed-record alert | API / Backend (`captureToSentry`) | -- | Runs once per cache miss in the builder. |

## Standard Stack

No new library, framework, or package is needed.

### Core (already in repo; versions not re-verified because `node_modules` is absent here)
| Tool | Purpose | Source |
|------|---------|--------|
| PostgreSQL 16 + `pg_cron` on the host | pg-lane for the mutation runner | [VERIFIED: ran `node scripts/mutation-runner/run.mjs --subset-from <list>` here, `exit=0`] |
| `scripts/mutation-runner/run.mjs` (plain node, no deps) | static parse and per-arm mutation | [VERIFIED: ran `--parse-only` and `--subset-from`] |
| vitest (config `vitest.config.ts`, projects `jsdom`/node) | unit and render tests | [VERIFIED: vitest.config.ts read; could not run: no `node_modules`] |
| `@/lib/sentry-capture` `captureToSentry(err, { tags, extra, level })` | Sentry report | [VERIFIED: `src/lib/factsheet/fetch-and-build-payload.ts` call at the reconstructed-ranges report] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `readUnrecoveredGaps` + wrapper `parseUnrecoveredGaps` | Rename and update 14 test call sites | Wrapper keeps `FactsheetView.unrecovered-gap.test.tsx` and `trade-fetch-provenance.test.ts` green with zero churn and matches `parseReconstructedRanges`; one parser body remains. |
| Edit both migrations in TV-shape | `sql` post-apply `DROP FUNCTION` + `CREATE FUNCTION` step | Edit-both uses the existing idiom; the `sql` form repeats a whole body inside JSON. |

**Installation:** none. **Package Legitimacy Audit:** no external package is installed or recommended by this phase, so the `package-legitimacy` gate does not apply. Packages removed: none. Packages flagged: none.

**Environment note:** `npm ci` is required in this worktree before any vitest, tsc, eslint or `tsx` command (see Environment Availability).

## Architecture Patterns

### System Architecture Diagram

```
FIX 1 (venues)
 Discovery page (anon) -> readPublishedTradeVenues (src/lib/queries.ts) -> rpc get_published_trade_venues(uuid[])
   -> SECDEF SQL: arm A  strategies.api_key_id -> api_keys.exchange        (no window, unchanged)
                  arm B  strategy_keys sk JOIN api_keys                    (NEW: AND (sk.window_end IS NULL OR sk.window_end > current_date))
                  UNION  (distinct lowercase venue per strategy)
   -> Map<strategy_id, venues[]> -> row.tradeVenues -> SyncBadge: mismatch cue iff some venue not in listed set
   zero rows for a strategy (all windows closed) -> no tradeVenues -> listed exchange, no cue (D-06)

FIX 2 (demo payload)
 fetchAndBuildPayloadWithReason / allocator-portfolio-payload / scenario-factsheet-payload
   -> buildFactsheetPayload(strategy, series, opts)
        common fields (spx/eth/gld/ief aligned for REAL comparators + correlations: keep)
        if ingestSource === "api": { ...common, ingestSource:"api", eventSignatures, benchEventSignatures }   (peerPercentile / allocatorPortfolios REMOVED)
        else:                      { ...common, ingestSource:"csv" }
   -> unstable_cache key factsheet-v2-payload-v25 (v2/page.tsx) -> RSC payload -> FactsheetView

FIX 3 (gap record)
 strategy_analytics.series_provenance (jsonb)
   -> readUnrecoveredGaps(prov) = { gaps, malformed }        (pure, total, one bad entry voids the record)
   -> fetch-and-build-payload.ts: malformed !== null -> captureToSentry(stage "factsheet-unrecovered-gaps", extra.detail = reason string only)
                                  strategyArg.unrecoveredGapsUnavailable = (malformed !== null)
   -> buildFactsheetPayload: ...(strategy.unrecoveredGapsUnavailable ? { unrecoveredGapsUnavailable: true } : {})
   -> FactsheetView -> <UnrecoveredGapLines gaps unavailable> -> one muted sentence      (factsheet v2 page AND tear sheet, same builder)
```

### Recommended file touch map
```
supabase/migrations/<ts>_get_published_trade_venues_open_windows.sql     NEW (CREATE OR REPLACE + catalogue self-verify + prod-body-ack)
supabase/migrations/down/<ts>-rollback.sql                              NEW (CREATE OR REPLACE back to the 20261019120000 body)
supabase/schema/functions/get_published_trade_venues.sql                REGENERATED (npm run schema:functions)
supabase/tests/test_get_published_trade_venues.sql                      6 arms re-pointed, +2 arms, RED-UNDER-SETUP +1 file
scripts/mutation-floors.mjs, src/__tests__/{gate-family-meta,mutation-annotation-parser,mutation-runner-floors}.test.ts   census
src/lib/factsheet/{types,build-payload,fetch-and-build-payload,trade-fetch-provenance}.ts, src/app/factsheet/[id]/trade-fetch-lines.tsx, v2/FactsheetView.tsx, v2/page.tsx
```

### Pattern 1: mutation-arm re-pointing (measured semantics)
**What:** `RED-UNDER-SETUP` lists files applied in order by the lane. An `edit` step may only target a file in that list or the gate itself (otherwise defect `bad-file-ref`). Each arm gets its own scratch copy of every listed file; steps are applied to the copies in order; `find` must occur exactly `occurrences` times or the arm is a `MEASURE_FAIL` (`occurrence-mismatch`), never `no-red`. [VERIFIED: `scripts/mutation-runner/run.mjs` `applyFileStep` (lines 237-252) and the per-arm loop (lines 2758-2900)]

Verbatim, from `applyFileStep`:
```js
const needle = step.kind === "edit" ? step.find : step.anchor;
const actual = countOccurrences(text, needle);
if (actual !== step.occurrences) return { ok: false, actual };
```
and the setup/target guard:
```js
const corpusRels = [...parsed.setup.apply, gateRel];
...
`step targets ${step.file}, which is not in this gate's RED-UNDER-SETUP apply list`,
```
**Consequence for this phase:** with the new migration appended to the apply list, the old migration applies first (plain `CREATE FUNCTION`), then the new `CREATE OR REPLACE` overwrites the body. An arm whose `edit` still targets `20261019120000_...sql` mutates a body that is immediately overwritten: the gate stays green, the runner reports `no-red`, and `sql-mutation` fails. So the six body-editing arms must edit the new file. The three `sql`-kind arms (TV-secdef, TV-searchpath, TV-anon-exec, TV-auth-exec: `ALTER`/`REVOKE` post-apply on the live DB) need no change. [VERIFIED by reading `supabase/tests/test_get_published_trade_venues.sql:69,80,94,106,115,193,211,224,237,252`]

Arm-by-arm (all line numbers in the gate file; `NEW` = the new migration file):

| Arm | Kind | Today targets | Must become | New `find` notes |
|-----|------|---------------|-------------|------------------|
| TV-secdef, TV-searchpath, TV-anon-exec, TV-auth-exec | sql | live DB | unchanged | -- |
| TV-shape (4 edit steps) | edit | old migration | BOTH old and NEW (8 steps) | See "TV-shape trap" below. |
| TV-1 (`s.status = 'published'` x2) | edit | old | NEW | New file must contain that string exactly twice in code AND comments combined; do not write it in a comment. |
| TV-unpublished | edit | old | NEW | find `   WHERE s.status = 'published'\n     AND s.id = ANY(p_strategy_ids)\n  UNION` keep the first arm's text byte-identical. |
| TV-unpublished-composite | edit | old | NEW | The old find ends at `AND s.id = ANY(p_strategy_ids);`. The NEW second arm gains a window line, so the find must be rewritten to include `\n     AND (sk.window_end IS NULL OR sk.window_end > current_date);` (or end earlier); occurrences 1. |
| TV-strategy-keys | edit | old | NEW | The old find spans the whole second SELECT through the final `;`. Rewrite it to span the NEW second arm including the window line; replace stays `;`. |
| TV-distinct-lower (`\n  UNION\n`) | edit | old | NEW | New file must have exactly one standalone `UNION` line. |

### Pattern 2: TV-shape trap (verified by experiment)
`CREATE OR REPLACE` cannot change a function's `RETURNS TABLE` row type. Reproduced on PostgreSQL 16 here, output verbatim: [VERIFIED: ran against a scratch cluster, since removed]
```
CREATE FUNCTION
ERROR:  cannot change return type of existing function
DETAIL:  Row type defined by OUT parameters is different.
HINT:  Use DROP FUNCTION f(uuid[]) first.
```
TV-shape widens `RETURNS TABLE (strategy_id uuid, exchange text)` to add `api_key_id uuid`. If only the NEW file is widened, the unmutated old migration creates the 2-column function and the mutated new migration's `CREATE OR REPLACE` aborts the apply, so the gate never runs and the arm is not a clean RED with its own identity. Edit BOTH files in the same arm: the existing 4 steps against the old file (unchanged finds, occurrences 1 each) plus the equivalent 4 steps against the new file (RETURNS TABLE line, the two SELECT lists, the self-verify `IS DISTINCT FROM 'TABLE(strategy_id uuid, exchange text)'` literal). Then both define the 3-column function and the new self-verify is re-baselined. Net: 8 file steps in TV-shape, +4 over today. This refines D-08 (see "Conflicts with CONTEXT").

### Pattern 3: self-verify plus `prosrc` check and arm reachability
D-04 asks the self-verify to assert the window predicate is in `prosrc`. Any arm that removes or changes the predicate from the NEW file will then abort the apply at the self-verify, so the arm cannot reach the gate (the same layering TV-shape documents). Resolve it the way TV-1 does: spell the self-verify literal so a single `edit` with `occurrences: 2` rewrites BOTH the body and the check, for example `sk.window_end > current_date` appearing once in the body and once in the `position(... IN prosrc)` literal. Then:
- TV-closed-window: replace `sk.window_end > current_date` (x2) with a predicate that admits a past end, e.g. `sk.window_end > date '0001-01-01'`. A closed `binance` member is then returned, anon sees 2 rows, arm fails with its own name.
- TV-window-end-today: replace the same string (x2) with `sk.window_end >= current_date`. A member whose `window_end = current_date` is then returned.
Both need `occurrences: 2` and the new file must contain that exact string exactly twice. [ASSUMED: the exact self-verify spelling; the planner chooses it, the requirement is only that the find count is measured with `--parse-only`.]

The `NULL`-window side (`sk.window_end IS NULL OR`) is already bitten by TV-strategy-keys (its published composite uses `window_end = NULL`): mutating it makes TV-strategy-keys the first failure. A dedicated third arm is optional and only valid if placed BEFORE TV-strategy-keys in the DO block (first-failure attribution). Not recommended: it duplicates a biting arm.

### Gate fixtures for the new arms (constraints measured)
- `strategy_keys` has `CONSTRAINT strategy_keys_window_order CHECK (window_end IS NULL OR window_end > window_start),` [VERIFIED: `supabase/migrations/20260710120000_strategy_keys.sql:41`]. The today-boundary fixture needs `window_start` strictly before today: use `current_date - 30` and `current_date`.
- `CREATE UNIQUE INDEX strategy_keys_strategy_seq_key ON public.strategy_keys (strategy_id, seq);` [VERIFIED: same file :48]. The two members of the closed-window strategy need distinct `seq` (closed `binance` seq 0, open `okx` seq 1).
- Reuse the existing Part 2 seeding style (`uid`, `api_keys` rows, `strategies` rows with `api_key_id` NULL, `strategy_keys` rows with `owner_id = uid`), AS anon via `SET LOCAL ROLE anon; ... RESET ROLE;`, with `TEST FAILED (TV-<name>)` raises. Use `current_date` in the fixture itself so the boundary arm is timezone-independent (the lane cluster's TimeZone is host-local, the function reads session `current_date`; both sides agree).

### Anti-Patterns to Avoid
- Writing a `find` string (or the string `s.status = 'published'`, a standalone `UNION` line, or `RETURNS TABLE (strategy_id uuid, exchange text)`) in the new migration's header comments: it changes `occurrences` and the arm becomes a `MEASURE_FAIL`.
- Adding an allowlist row or a mutation waiver to turn a red gate green: `WAIVED_CEILING` is 0 and the baseline-content-drift allowlist is "never cleared by adding a row".
- Loosening a census test instead of removing a site row (D-12).
- A type-only removal of the payload fields as the SC-2 test (D-15): it cannot fail at runtime.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reading a malformed record and reporting it | a second gap parser | wrap `readUnrecoveredGaps` (`parseUnrecoveredGaps` = `.gaps`) | D-16 "no second parser"; `parseReconstructedRanges` is the precedent. |
| Sentry report | `console.warn` only | `captureToSentry` from `@/lib/sentry-capture` | The warn is the current silent failure. |
| Optional flag in payload | always-present boolean | spread only when true: `...(strategy.unrecoveredGapsUnavailable ? { unrecoveredGapsUnavailable: true } : {})` | keeps every readable-record payload byte-identical (the whole-payload snapshot pins). |
| Sentence styling | new component or colour | `className = \`mt-1 ${SIZE_CLASS[size]} text-text-secondary\`` as in `ReconstructedRangeLines` | DESIGN.md muted-secondary posture. |
| ARMS_FLOOR value | a guessed number | regenerate: `node scripts/mutation-runner/run.mjs --parse-only` | The repo's rule: floors are measured, never restated. |
| Function snapshot | hand-edit | `npm run schema:functions` | `@generated ... DO NOT EDIT BY HAND`. |

**Key insight:** every piece of machinery (reader template, caller template, flag spread, render prop, mutation idiom, ack pragma) already exists in the repo; the phase is composition, and the risk is in the censuses and pins that count the pieces.

## Q1: SQL mutation machinery and censuses (measured)

### How a new arm is counted
An arm is one structured `RED-UNDER-M:` twin; parity requires one prose `RED-UNDER:` marker per twin. `--parse-only` today prints for this file: `supabase/tests/test_get_published_trade_venues.sql: 10 prose / 10 twin(s) / 0 waiver(s)` and `arms: 0/830/0   (executed/annotated/waived)`, `coverage: files 81/108`, exit 0. [VERIFIED: ran at HEAD]. The subset run of this one file on this host: `arms: 10/10/0`, `biting: 10`, `lane-invocations: 10`, per-file `sections 10 / judged 10 / annotated 10 / waived 0 / biting 10`, `exit=0`, about 1.0 s per arm. [VERIFIED: ran `node scripts/mutation-runner/run.mjs --subset-from <list>` with a one-line list `supabase/tests/test_get_published_trade_venues.sql`]. Subset list entries must match `GATE_FILE_RE = /^supabase\/tests\/test_[a-z0-9_]+\.sql$/` [VERIFIED: `scripts/sql-gate-subset.mjs:113`].

### Censuses that move for +N arms in this existing file (no new file, so FILES_FLOOR, `filesTotal`, `filesAnnotated`, the lint-sql-gates `scanned 108 file` pin and the `annotatedFiles` list do NOT move)
Derived from the diff of the nearest analog (Phase 194.2, commit `1f3256f36`, +4 arms in an existing file) and checked against the live pins. With N = 2 new arms:

| File | Pin today (verbatim) | Becomes |
|------|----------------------|---------|
| `scripts/mutation-floors.mjs` | `export const ARMS_FLOOR = 830;` (:3425) | 832, plus a dated comment block above it in the house style |
| `src/__tests__/gate-family-meta.test.ts:945` | key `"scripts/mutation-floors.mjs :: ARMS_FLOOR=830"` | `ARMS_FLOOR=832` (the trailing comment is prose) |
| `src/__tests__/mutation-annotation-parser.test.ts:1115` | `expect(armsSeen).toBe(830);` | 832 |
| same file `:1162` and `:2125` | `expect(stepsSeen).toBe(943);` and `expect(needles.length).toBe(943);` | `943 + (file steps added)`. `stepsSeen` counts non-`sql` steps of non-waived arms only. New file steps = the 4 extra TV-shape steps on the new file + 1 per new window arm (the `occurrences: 2` edit is ONE step) = 4 + 2 = 6, so 949 if the arms are shaped as above. Re-measure; do not trust this sum. |
| `src/__tests__/mutation-runner-floors.test.ts:758` | `expect(totalAnchored).toBe(830);` | 832 |
| same file, synthetic GREEN_LOG strings (lines 2198, 2204, 2210, 2316, 2409, 2454, 2771, 2777, 2828, 2844, 2894, 2903, 2931, 2987, 3067, 3079, 3088, 3268) | `arms: 830/830/0`, `biting: 830`, `lane-invocations: 830 ... plus 81 baseline / 81 restore`, per-file row `sections 10 / judged 10 / annotated 10 / waived 0 / biting 10` for this gate, `mean ... over 830 arm run(s)`, `830 arm lane(s) spawned`, `rows sum to 829`, `reports 830`, `executed=830 lane-invocations=0 biting=830`, `lane-invocations: 831`, `biting: 831`, `biting (831) exceeds executed (830)`, `biting arms 830 >= 830` | each value moves by +N: 832; 833 for the derived `+1` strings; `rows sum to 831`; per-file row `sections 12 / judged 12 / annotated 12 / waived 0 / biting 12`. Leg counts (81) do not move. |

Find them all with `grep -n -a -E '\b(829|830|831)\b' src/__tests__/mutation-runner-floors.test.ts` (non-comment lines) and `grep -n -a "test_get_published_trade_venues.sql: sections" src/__tests__/mutation-runner-floors.test.ts`. [VERIFIED: line list above produced by that grep at HEAD.]

NOT moved (measured): `.github/workflows/ci.yml` `SENTINEL_FLOOR`/`ARMS_FLOOR` (a different, sentinel-file census: this gate prints `ALL PASS`, not an `ALL N ARMS EXECUTED` sentinel, and `ci.yml` has no mention of this gate file) and its `drift-check-scripts.test.ts` pin. [VERIFIED: grep of `.github/workflows/*.yml` for `get_published_trade_venues` returned no match.] Phase 194.2's `ci.yml` edit in `1f3256f36` was for a sentinel file, not applicable here.

`FILES_FLOOR` stays 81, `WAIVED_CEILING` stays 0 [VERIFIED: `scripts/mutation-floors.mjs:1348`, `:3539`].

### Ratchet direction
`mutation-runner-floors.test.ts` asserts `ARMS_FLOOR` equals the number of NON-WAIVED twins re-derived from the corpus (`.toBe(twins - waivers)`, lines 805-829) AND at most the twin total; so the floor must be raised in the same commit as the arms (stale-low reds the test; a floor above twins reds the runner). [VERIFIED: file read.]

### Measurement commands (exact)
```bash
node scripts/mutation-runner/run.mjs --parse-only                       # static: arms N/830+N, needles match, exit 0
printf 'supabase/tests/test_get_published_trade_venues.sql\n' > <scratch>/subset.txt
node scripts/mutation-runner/run.mjs --subset-from <scratch>/subset.txt # exit 0, biting == arms for this file
node scripts/mutation-runner/run.mjs --file supabase/tests/test_get_published_trade_venues.sql   # diagnostic, exit 2 on clean
node scripts/mutation-runner/run.mjs --arm "TV-closed-window"           # one arm, diagnostic
```
Subset with a floors/migration edit: CI forces FULL on the PR, so `sql-mutation` in CI is the authoritative full run. On this host a FULL local run is not possible: free data volume is about 4.2 GiB against roughly 15 GB a full run needs (the Phase 204 floors comment records the same limit). Record "FULL local run not run; subset exit 0; static upper bound" in the floors comment, exactly as Phase 204 did. [VERIFIED: `df -h /` showed 4.2Gi available; floors comment at `scripts/mutation-floors.mjs` ~3418.]

pg-lane requirements on this host: PostgreSQL 16 binaries and `pg_cron.dylib` are present under the Homebrew prefix; the lane booted and ran 10 arms with `lane-probe: pg_cron AVAILABLE`. [VERIFIED: subset run output.]

### Migration artifacts a CREATE OR REPLACE of a baseline-carried function must satisfy (measured, with the analog)
The nearest analog is Phase 194's `20261107140000_get_verified_cohort_rank_span_gate.sql` (merge `959ef9820`) and Phase 194.2's `20261110120000_...` (merge `1f3256f36`). Files beyond the migration they touched (non-planning):
- `supabase/migrations/down/<ts>-rollback.sql` (rollback; no test requires its presence, `migration-policy.yml` excludes `down/` from the added-migration scan).
- `supabase/schema/functions/<fn>.sql` regenerated by `npm run schema:functions` (the `sql-function-snapshot` gate runs `tsx scripts/dump-sql-functions.ts --check`). For this function the committed snapshot begins `-- source migration: 20261019120000_get_published_trade_venues.sql`; the regeneration repoints it at the new file.
- The gate file, `scripts/mutation-floors.mjs`, `gate-family-meta`, `mutation-annotation-parser`, `mutation-runner-floors` (above).
- `-- prod-body-ack: <sha256>` inside the migration (VAC-04, next section).
- CHANGELOG, VERSION, package.json (release commit).

NOT needed (measured): no edit to `supabase/schema/baseline.sql`, `baseline-carried-migrations.txt` or `BASELINE.md` in the migration PR. `node scripts/check-baseline-currency.mjs --replay-set` today prints `baseline-currency: carried=319 replay=0 marker-sha=match defects=0`; after adding the migration it prints `replay=1` and the local-stack lane (`sql-tests`) replays the new file on top of the dump automatically (Decision F in CLAUDE.md). The shared-TEST restore default mode refuses a dump older than the migrations, but that runs only on the dispatched restore workflow, not on a PR. The baseline is re-dumped by a separate post-apply release (`chore(release): ... baseline re-dump after the PROD apply of <sha>`; the three latest are `db3d5903b`, `589e0ee43`, `404c95460`). [VERIFIED: git log; `scripts/check-baseline-currency.mjs` header.]

Other repo-wide scanners a new migration file enters (run them locally, all plain node, all passing at HEAD): `node scripts/lint-sql-gates.mjs` prints `lint-sql-gates: scanned 108 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).`; `node scripts/lint-migration-data-dependence.mjs` prints `corpus 319 migration(s), 401 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.` (a catalogue-only DO block, as in `20261019120000`, adds no refusal; that file is not in the baseline list); `node scripts/lint-app-guc.mjs` prints `app-guc: findings 0`. After the migration lands `lint-migration-data-dependence` corpus becomes 320 and its count pin (if any test pins `319`) must be re-measured. [VERIFIED: ran each.] Several vitest files read every migration (`raise-exception-concat-grammar`, `tradesync-migrations-schedule-nothing`, `outagealert-migration-schedules-nothing`, `retention-crons`, `adr-0008`, `critical-regressions`): the new migration schedules nothing and writes no cron, so they should stay green. [ASSUMED: not run, no `node_modules`.]

Timestamp: `migration-policy.yml` fails a PR whose added migration has a 14-digit prefix older than the remote ledger tip (`MAX(version)` from `schema_migrations`), unless allowlisted. [VERIFIED: workflow read.] The latest migration in repo is `20261110150000_intro_path_authz_hardening.sql`. Pick a timestamp after that AND after any migration other parallel phases (208-211) merge before this one: re-pick from origin/main immediately before the push. [VERIFIED: `ls supabase/migrations`.]

## Q2: Expected CI on the migration PR (before merge)

| Check | Expected on the PR | Basis |
|-------|--------------------|-------|
| `migration-drift-check.yml` "Drift check (db push dry-run)" | green: the dry-run lists this PR's migration as pending and the step accepts "pending migrations match this PR's additions" | [VERIFIED: workflow script, lines 147-192] |
| same workflow, "VAC-04" `scripts/prod-body-drift-check.sh` | RED unless the migration carries `-- prod-body-ack: <sha256 of the NORMALIZED PROD body>`. The left side is the committed snapshot `supabase/schema/functions/get_published_trade_venues.sql`, which `schema:functions` must regenerate to the NEW body; the right side is PROD's OLD body, so the status is `DRIFT`. The ack hash binds the pragma to PROD's exact body. The normalized hash of today's committed snapshot is `1dd7db89ef0e3df11e878f2ab68bfb79c8e91dc31ad6ec0cac06965ab90e2d48` (printed by `node scripts/sql-body-normalize.mjs --diff-bodies <snapshot> <snapshot>`). | [VERIFIED: script lines 1296-1316 and ack format; hash measured locally] |
| hash equals PROD's | [ASSUMED]: PROD runs the `20261019120000` body unmodified, so the ack hash equals that snapshot hash. VAC-04's failure output prints the exact line `-- prod-body-ack: <hash>` to paste; use that value if it differs. Never print PROD text (public repo). |
| `sql-function-snapshot` | green once the snapshot is regenerated in the same commit; red otherwise | [VERIFIED: workflow header; `package.json` `schema:functions:check`] |
| `sql-gate-lint` (hosts `node scripts/baseline-content-drift-check.mjs`) | RED by construction: `baseline.sql` still holds the old body, the chain snapshot now holds the new one, so `get_published_trade_venues/1` is a DRIFT finding not in `CONTENT_DRIFT_ALLOWLIST` allowlist. Today's reading: `functions compared 134 - MATCH 131, DRIFT 3, SNAPSHOT_MISSING 0, SNAPSHOT_ONLY 0, UNCOMPARABLE 0` and `findings 0`. Do NOT add an allowlist row ("a red corpus run is NEVER cleared by adding a row"; cleared only by the post-apply baseline re-dump). Precedent: the 194.2 CHANGELOG says "A `baseline-content-drift` / VAC-04 DRIFT reading on this PR is expected (no allowlist row added)" and the Phase 194 entry says the stale-baseline drift "leaves a red `sql-gate-lint` check on main and likely made Railway skip the first deploy". `COMPARED_FLOOR` and `NAME_SET_RATCHET` do not move (no new function name). | [VERIFIED: ran the script; CHANGELOG lines 570 and 935] |
| `sql-tests` (local-stack lane) | green: the lane replays the new migration on the committed dump before the corpus runs, so the gate sees the new body. | [CITED: CLAUDE.md Decision F; `check-baseline-currency --replay-set` semantics] |
| `sql-mutation` | FULL run (floors file edited): must be green with `arms: 832/832/0`. | [VERIFIED: runner semantics; CLAUDE.md] |
| `test-db-drift` (VAC-08, repo-vs-TEST ledger and body) | the ledger leg exempts above-frontier migrations; whether the BODY leg flags the new body vs TEST's old body before `apply-test` runs is not established here. Treat a red here as expected pre-merge and re-run after the apply. | [ASSUMED: from `scripts/test-ledger-drift-check.sh` frontier-exemption comments; not exercised on a PR] |
| Merge | `apply-test` applies to TEST first, then PROD auto-applies on its success with NO human reviewer gate (removed 2026-09-23). Every review (migration-reviewer, rls-policy-auditor) happens before merge. | [CITED: CLAUDE.md "CORRECTED 2026-09-23"] |
| After merge | `sql-gate-lint` red on main until the baseline re-dump release; a red main head can block a Railway redeploy of that SHA (analytics deploy waits on main CI). This phase changes no analytics code, but the red persists. | [CITED: CHANGELOG line 935; CLAUDE.md Railway note] |

## Q3: Demo payload removal (measured)

Measured with `grep -rl -a` over `src`: 65 files in `src/` mention one of `peerPercentile`, `allocatorPortfolios`, `hideAllocatorSection`, `AllocatorPortfolioPayload`, `computePeerPercentile`, `peer-cohort`, `from "./allocator"`; 46 of those mention only the prop `hideAllocatorSection` (72 occurrences across 46 files; 3 are non-test: `FactsheetView.tsx:421`, `AllocationDashboardV2.tsx:340`, `ScenarioFactsheetChart.tsx:37,242,250`); the other 19 are listed below. [VERIFIED]

### (a) Producers and declarations to delete or edit
| Item | Where | Action |
|------|-------|--------|
| `computePeerPercentile` + seeded cohort | `src/lib/factsheet/peer-cohort.ts` (+ `peer-cohort.test.ts`, 27 lines) | delete both; sole non-test importer is `build-payload.ts:21` |
| `alignBlend`, `buildAllocatorMetrics`, `comparatorLeg`, `blend`, `BlendLeg` | `src/lib/factsheet/allocator.ts` (+ `allocator.test.ts`, 241 lines) | delete both; non-test importer is `build-payload.ts:24-25` only; test importers: `allocator.test.ts`, `return-stats.sites-joint.test.ts:29` |
| api-arm assembly | `build-payload.ts` lines 1170-1262 (`peer`, `btcLeg`, `btcUnavailable`, `portfolioFigures`, `peerPercentile:`, `allocatorPortfolios:`) | delete; keep `eventSignatures` and `benchEventSignatures`. Remove the 3 now-unused imports (`computePeerPercentile`, `alignBlend/buildAllocatorMetrics/comparatorLeg`, `BlendLeg`) and the doc-comment mentions (`build-payload.ts` ~:707 "see allocator.ts"; header comment ~:30-35 "PeerPercentile / AllocatorSection / Signatures"). |
| `FactsheetApiPayload.peerPercentile` and `.allocatorPortfolios` | `types.ts:1144,1146` | delete; update the docblocks at `types.ts:1131-1141` and `:1189-1199` which name "peer cohort, allocator portfolios" |
| `AllocatorPortfolioPayload` | `types.ts:377` | delete; its only other importer is `build-payload.null-honest.test.ts:20` (which is rewritten, below) |
| `PeerPercentilePayload` | `types.ts:302` | KEEP: importers `ScenarioComposer.tsx`, `scenario-factsheet-payload.ts`, `ScenarioFactsheetChart.tsx`, `api/scenario/peer-rank/route.ts` (+test), and 4 v2 test files [VERIFIED by grep] |
| Fixture series `SPX_DAILY`, `ETH_DAILY`, `GLD_DAILY`, `IEF_DAILY` (and `BTC_DAILY`) | `src/lib/factsheet/benchmarks.ts`, `data/*.json` | KEEP ALL. `build-payload.ts` still uses them for the real comparator alignment and correlation rows: `spx: alignCoveredReturns(SPX_DAILY, ...)`, `eth`, `gld`, `ief` at lines 191-194, the correlation rows at 522-535 and the SPX comparator block at 623. Only the allocator-blend uses (lines 1234-1255) disappear. D-11's "only if nothing else imports them" resolves to "keep". [VERIFIED: read `build-payload.ts` lines 15-18, 191-194, 522-535] |
| `hideAllocatorSection?: boolean` | `FactsheetView.tsx:421` (declared, never destructured: a no-op) | delete the declaration and its 2-line doc comment (which names the TODOS id) [VERIFIED: lines 419-421: "A no-op since QUIETVIEW (Phase 193 D-05 removed the demo allocator section). Kept so existing callers compile; removal is booked with `[193-DEMO-PAYLOAD-PRODUCERS]`."] |
| callers | `AllocationDashboardV2.tsx:340` (prop), `ScenarioFactsheetChart.tsx:37,242,250` (two comments and the prop) | remove prop and fix the comments |
| Stale comment | `allocator-portfolio-payload.ts:~128-132` says passing `"api"` keeps "AllocatorSection and PeerPercentilePanel" unsuppressed | reword: `ingestSource: "api"` still unlocks event signatures. Keep `ingestSource: "api"` (event signatures still key on it) and `unrecoveredGaps: []`. |
| Doc | `docs/architecture/adr-0025-scenario-peer-carveout.md` names both fields | add a dated one-line note; not required by any gate |

No component reads either field at runtime: the only non-test readers of `peerPercentile` / `allocatorPortfolios` in `src/` are `build-payload.ts`, `types.ts`, and a comment in `v2/page.tsx`. [VERIFIED: grep output.]

### (b) Test fixtures that only construct a payload (mechanical removal)
`BatchDPanels.ownbook.test.tsx:195-196` (`peerPercentile: null, allocatorPortfolios: null` literal), and the 46 `hideAllocatorSection` prop-pass files (remove the attribute; the prop exists only in the interface, so deleting it makes these tsc excess-property errors, not runtime failures). Pass-through counts by trailing form: 29 `hideFooter />`, 12 bare `/>`, 12 line-leading, 7 `hideFooter={false} />`, the rest scattered. List: all `FactsheetView.*.test.tsx`, `FactsheetBody.*.test.tsx`, `basis-context.*.test.tsx`, `MetricsColumn.{comparator-floor,periods-per-year,window-rows}.test.tsx`, `focus-ring-clipproof.test.tsx`, `AlphaBetaDecomposition.book-btc.test.tsx`, `scenario-factsheet-payload.empty-render.test.tsx`, `api/og/factsheet/[id]/route.{page-agreement,stored-parity}.test.tsx`, `lib/freshness.two-surfaces.test.tsx` (full list by `grep -rl -a hideAllocatorSection src`). `scenario-factsheet-payload.test.ts:292-293` lists the two keys as "absent on the csv arm"; it stays true and can stay. `composite-read-path.test.ts:308-309` already asserts `"peerPercentile" in payload` is false for a composite and can stay.

### (c) Tests that assert on the fields (rewrite or delete)
| File | What | Disposition |
|------|------|-------------|
| `v2/FactsheetBody.no-demo-content.test.tsx:177-178` (premise test "the fixture still carries the demo payload fields") | asserts `p.peerPercentile` non-null and `allocatorPortfolios` non-empty | FLIP to the D-15 runtime assertion: both `in` checks false; keep the FORBIDDEN render loop (it already lists "60/40 Stocks/Bonds", "Multi-Asset Risk Parity", "Diversified Crypto Blend") |
| `v2/StressWindowsPanel.unreadable.test.tsx:142-185` | asserts `allocatorPortfolios` null on an unreadable record and `toHaveLength(3)` on a readable one (Phase 205) | rewrite to the absence assertion; the block's docblock about `alignBlend` goes |
| `src/__tests__/figure-parity-pages.test.tsx:1398,1405` | `expect(payload.allocatorPortfolios).toBeNull()` | change to the absence form (or drop) |
| `src/lib/factsheet/audit-c20.test.ts` (779 lines) | api/csv arm field census lists (`:409-416`), `:454-455` premise, `@ts-expect-error` lines `:484-497`, the crypto-vs-traditional peer rank test `:678-698`, the `SYNTH` list `:738` | remove `peerPercentile` and `allocatorPortfolios` from the lists, delete the peer-rank test, delete the two `@ts-expect-error` pairs (they would become TS "unused directive" errors) |
| `build-payload.null-honest.test.ts` (264 lines) | `describe` at `:160` "allocator blends skip every missing leg day" (`:160-264`) plus the `portfolio` helper at `:184-186` and the import at `:20` | delete that describe and helper; keep the event-signature describes (`:73`, `:123`) |
| `build-payload.peer-withheld.test.ts` (whole file) | tests the peer percentile of a withheld api payload | delete the file |
| `BatchDPanels.peer-scenario.test.tsx:98-168` | `apiPayload(peerPercentile)` helper and an assertion that an api payload with `peerPercentile` set renders no panel | rewrite: the csv `scenarioPeer` cases stay; the api-arm case becomes "an api payload has no `peerPercentile`" or is deleted |
| `v2/page.tsx` | only a comment names the field (history) | none |

### (d) Census and parity tests whose site lists lose rows
- `src/lib/return-stats.single-source.test.ts`: remove `"src/lib/factsheet/allocator.ts",` from `TIER2_SITES` (:414); remove the `RETIRED` row `{ plan: "166.2-05", file: FS + "allocator.ts", token: "s > 0 && " + "mmS > 0 ?" }` (:456) and change `expect(RETIRED).toHaveLength(28);` (:514) to 27, otherwise the "every retired file exists" loop (:516) fails. DO NOT edit `BASE_EXPECTED` (:690-717, includes `"src/lib/factsheet/allocator.ts P2"`): it pins a historical merge-base tree materialised from git at `BASE_SHA`, not the working tree. [VERIFIED: file read.]
- `src/lib/factsheet/return-stats.sites.test.ts`: drop `import { computePeerPercentile } from "./peer-cohort";` (:28), the `computePeerPercentile` cases at `:188-195` and `:284-309` (including the `peerPercentile` read at `:309`), and any header text naming them.
- `src/lib/factsheet/return-stats.sites-joint.test.ts`: drop `import { buildAllocatorMetrics } from "./allocator";` (:29) and the whole `describe("T20 buildAllocatorMetrics correlation ...")` starting `:403`; update the header comment `:6`.
- Figure-gate census: no source file other than the three above names `allocator.ts` or `peer-cohort.ts` (measured over `src`, `scripts`, `docs`, `.github`, `e2e`).

### `ingestSource: "api"` payload constructors and cache keys
- Real producers of an api-arm payload: `build-payload.ts:1213` (the only `return { ...common, ingestSource: "api", ... }`) and `allocator-portfolio-payload.ts:132` (passes `ingestSource: "api"` into `buildFactsheetPayload`, so it inherits the removal). `scenario-factsheet-payload.ts` builds the csv arm. Test fixture helper `v2/test-fixtures/census-payloads.ts:38` builds via `buildFactsheetPayload`. About 54 test files contain a literal `ingestSource: "api"`; only the ones in (b)/(c) set the removed fields. [VERIFIED]
- Cache: the only `unstable_cache` that stores a factsheet payload is `src/app/factsheet/[id]/v2/page.tsx:218-305` with key `["factsheet-v2-payload-v24", id, computedAt, tradesFetchedAt ?? "none", provenanceKey, computationStatus],`. The `factsheet-share/[token]` route reaches it through the same wrapper (its `page.cache-isolation.test.tsx` pins the prefix). The tear sheet calls `fetchAndBuildPayloadWithReason` directly (no cache). The OG route, the scenario share and `allocator-portfolio-payload.ts` do not use `unstable_cache` (the only other `unstable_cache` in `src/` is `api/keys/[id]/permissions/route.ts`, unrelated). [VERIFIED: grep of `unstable_cache` over `src`.] So there is ONE bump: `v24` -> `v25` (or the next free number), with a dated comment in the existing format naming (1) the api arm no longer carries `peerPercentile` / `allocatorPortfolios`, (2) the new optional `unrecoveredGapsUnavailable`. The key's other members (`provenanceKey` etc.) do not change when a record is malformed, so an old entry would keep serving "no gaps": the bump is needed for SC-3 as well as SC-2.
- Pins that must move with the key: `src/app/factsheet-share/[token]/page.cache-isolation.test.tsx:156` (`const EXPECTED_KEY_PREFIX = "factsheet-v2-payload-v24";`), `src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx:290, 360, 381`, and the comment at `src/lib/factsheet/fetch-and-build-payload.ts:746`. Find them all with `grep -rn -a "payload-v24" src`. Re-pick the number from origin/main immediately before pushing (parallel phases bump it too).

### Snapshot
`src/lib/factsheet/__snapshots__/build-payload.test.ts.snap` has three one-line JSON entries; only entry 2, `ingestSource:'api' payload (synthesized panels) is byte-identical` (77791 characters, one `peerPercentile`, one `allocatorPortfolios`), changes; the composite and single-key geometric entries contain neither field. Update with `npx vitest run -u src/lib/factsheet/build-payload.test.ts`, then review the diff is exactly the two removed keys. Also rename that test's title ("synthesized panels" is no longer accurate; it still carries event signatures) only if the planner wants, noting the snapshot key is the title and a rename orphans the old entry (`-u` will rewrite it). [VERIFIED: awk over the snap file; test names at `build-payload.test.ts:98,111`.]

## Q4: Gap record (measured)

**Current reader** (`src/lib/factsheet/trade-fetch-provenance.ts:49`): `export function parseUnrecoveredGaps(seriesProvenance: unknown): UnrecoveredGap[]`. Pure and total; absent/empty returns `[]`; any malformed shape returns `warnMalformed(reason)` which does `console.warn(...)` and returns `[]`; reasons are `"provenance is not an object"`, `"unrecovered_gaps is not an array"`, `"an entry is not an object"`, `"an entry date is not a YYYY-MM-DD calendar date"`, `"an entry ends before it starts"`, `"provenance could not be read"` (the catch). Output sorted newest `to` first. [VERIFIED: file read.]

**Template** (`readReconstructedRanges`, `:128`): returns `{ ranges, malformed }`; `malformedReconstructed(reason)` returns `{ ranges: [], malformed: reason }` after a `console.warn`; `parseReconstructedRanges` = `readReconstructedRanges(x).ranges`. Mirror it: add `UnrecoveredGapsRead { gaps; malformed }`, `malformedGaps(reason)`, `readUnrecoveredGaps`, and make `parseUnrecoveredGaps` the one-line wrapper. Update the module header sentence that says the module is the only reader of both keys (still true). [VERIFIED]

**Importers of `parseUnrecoveredGaps`:** one production caller, `fetch-and-build-payload.ts:48` (import) and `:986` (call); tests: `trade-fetch-provenance.test.ts` (`:4`, about 14 calls through `:205`), `v2/FactsheetView.unrecovered-gap.test.tsx:7,174`. [VERIFIED: grep.] Comments naming it: `trade-fetch-lines.tsx:155`, `build-payload.ts:691`, `types.ts:706`.

**Caller** (`fetch-and-build-payload.ts:985-1026`): `const unrecoveredGaps = parseUnrecoveredGaps(analytics?.series_provenance);` becomes a destructure of `readUnrecoveredGaps`; reconstructed Sentry block to copy verbatim shape:
```ts
captureToSentry(new Error("factsheet: series_provenance.reconstructed_ranges is malformed"), {
  tags: { stage: "factsheet-reconstructed-ranges", reason: "reconstructed_ranges_malformed", strategy_id: id },
  extra: { detail: reconstructedMalformed },
});
```
The strategy arg carries `reconstructedRangesUnavailable: reconstructedMalformed !== null,` (:1026) and `build-payload.ts` spreads it only when true (`:1086`: `...(strategy.reconstructedRangesUnavailable ? { reconstructedRangesUnavailable: true } : {}),`) plus the optional input type at `:696` and the payload type at `types.ts:727`. Add the sibling flag in all four places. The USD native view reuses `strategyArg` (`buildFactsheetPayload(strategyArg, usdSeries, ...)` at `:1178`), so it inherits the flag automatically. When `series_provenance` is a non-object both readers report (two Sentry events with different `stage` tags) and both sentences render: acceptable and consistent. [VERIFIED]

**`captureToSentry`:** import `import { captureToSentry } from "@/lib/sentry-capture";` (already imported in `fetch-and-build-payload.ts` and `build-payload.ts`). Mock pattern in `fetch-and-build-payload.test.ts`: `vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));` (:24), `import { captureToSentry } from "@/lib/sentry-capture";` (:152), `vi.mocked(captureToSentry).mockClear();` in `beforeEach` (:230). Template tests at `:1046-1071` (malformed reconstructed: filters `calls` by `o.tags.stage`, `toHaveLength(1)`, `toMatchObject({ tags: { stage, strategy_id }, extra: { detail } })`) and `:1073-1086` (absent/valid: not flagged, zero calls). The existing test at `:1088-1093` `"a malformed provenance names no gap"` (fixture `{ unrecovered_gaps: [{ from: "2026-07-08", to: "2026-05-07" }] }`, asserts `unrecoveredGaps` is `[]`) is the one that must grow the Sentry and flag assertions; its detail string is `"an entry ends before it starts"`. [VERIFIED]

**Render:** `UnrecoveredGapLines({ gaps, size = "caption" })` in `src/app/factsheet/[id]/trade-fetch-lines.tsx` returns null for `!gaps || gaps.length === 0`; add `unavailable = false` and an early `if (unavailable) return <p className={className}>{GAPS_UNAVAILABLE_SENTENCE}</p>;` placed like `ReconstructedRangeLines` does (the `className` const is `` `mt-1 ${SIZE_CLASS[size]} text-text-secondary` ``). The sole call site is `FactsheetView.tsx:1656`: `<UnrecoveredGapLines gaps={payload.unrecoveredGaps} />`, to become `<UnrecoveredGapLines gaps={payload.unrecoveredGaps} unavailable={payload.unrecoveredGapsUnavailable} />`. Sentence (locked): `"Record of days without trade data unavailable. Some days may be missing from the record."` Placement note: it sits in the header beside `ReconstructedRangeLines`, which renders its own unavailable sentence when its flag is set. The F1 test asserts no gap line claims the exchange no longer serves days; the new sentence names no exchange. Copy pins elsewhere: the existing helper `gapLines()` in `FactsheetView.unrecovered-gap.test.tsx` filters paragraphs by `/^No trade data |more gaps? without trade data\.$/`, which the new sentence does not match, so the "zero gaps" test (asserts text does not contain "No trade data" or "not counted as zero") stays green. [VERIFIED]

**Other surfaces that render or carry gaps (confirmed, none need the flag):**
- Tear sheet `src/app/factsheet/[id]/tearsheet/page.tsx` renders `FactsheetView ... printView` from `fetchAndBuildPayloadWithReason` (uncached): covered by the one render path. [VERIFIED: lines 14, 204, 288.]
- `src/lib/factsheet/allocator-portfolio-payload.ts:124` and `scenario-factsheet-payload.ts:574` pass `unrecoveredGaps: []` (a blend has no single record; stated, not defaulted): leave, no flag.
- `TimeSeriesChart` / `EquityChart`: no reader of `payload.unrecoveredGaps` exists outside `FactsheetView.tsx:1656`; the chart seam's `{days}d - no data` label derives from the `dates` grid, not the record (`build-payload.ts:293` comment). [VERIFIED: grep of `unrecoveredGaps` over `src` non-test.]
- Tests that build payloads with `unrecoveredGaps` literals (`tearsheet/page.trade-fetch.test.tsx:86`, `FactsheetBody.tearsheet-homes.test.tsx:77`, `FactsheetView.reconstructed-range.test.tsx:229`, `freshness.two-surfaces.test.tsx:422`) need no change (the new field is optional).

Test locations for D-19: (a) `src/lib/factsheet/trade-fetch-provenance.test.ts` (the malformed table at `:66-80` currently asserts `toEqual([])` through `parseUnrecoveredGaps`; add a parallel table through `readUnrecoveredGaps` asserting `malformed` is a non-empty string, and that absent/empty/valid give `malformed === null`, plus the hostile-getter case at `:96-98` returning a reason); (b) `fetch-and-build-payload.test.ts` next to `:1088`; (c) `FactsheetView.unrecovered-gap.test.tsx` (it renders `FactsheetBody` with the helper `withGaps`; add a `withUnavailable` and assert the sentence once, muted classes `mt-1`, `text-caption`, `text-text-secondary` as the existing first test does, and no gap line) plus a valid-empty-record case showing nothing. The tear-sheet is covered by `page.trade-fetch.test.tsx`-style test if the planner wants an end-to-end check: `p.unrecoveredGapsUnavailable` is `true` for a malformed record (`:124` shows the existing equality assertion shape).

## Q5: CI gates and local commands for these file types

CI jobs in `.github/workflows/ci.yml` relevant to these changes (job keys measured): `frontend-typecheck`, `frontend-lint`, `frontend-test` (vitest shards), `frontend-coverage` (merges blobs and enforces thresholds), `sql-gate-lint`, `sql-mutation`, `plan-anchor-verify`, `sql-tests`, `test-db-drift`, `knip` (non-blocking, files and dependencies only, not in the `frontend` aggregator), `secret-scan`, `version-gate`, `docs-link-check`; separate workflows `migration-drift-check.yml`, `migration-policy.yml`, `sql-function-snapshot.yml`. Coverage thresholds are a ratchet in `vitest.config.ts`: `lines: 82, functions: 74, branches: 72, statements: 80`. Deleting `allocator.ts` and `peer-cohort.ts` with their tests removes them from both numerator and denominator; the new reader/caller branches are covered by D-19 tests. [VERIFIED]

Local commands (run after `npm ci`; the first group needs no `node_modules`):
```bash
# no node_modules needed
node scripts/mutation-runner/run.mjs --parse-only
node scripts/mutation-runner/run.mjs --subset-from <list>
node scripts/lint-sql-gates.mjs
node scripts/lint-migration-data-dependence.mjs
node scripts/lint-app-guc.mjs
node scripts/check-baseline-currency.mjs --replay-set
node scripts/baseline-content-drift-check.mjs          # expected: 1 new DRIFT after the migration (stale baseline), see Q2
node scripts/sql-body-normalize.mjs --diff-bodies <a.sql> <b.sql>   # prints the normalized sha256 for the ack pragma
# need npm ci
npx tsc --noEmit                                       # = npm run typecheck (tests are type-checked: excess `hideAllocatorSection` props fail here)
npm run lint                                           # eslint + route/admin manifests + check-planning-hygiene + canonical-domain
npm run schema:functions && npm run schema:functions:check
npx vitest run src/lib/factsheet "src/app/factsheet" src/lib/return-stats.single-source.test.ts src/__tests__/gate-family-meta.test.ts src/__tests__/mutation-annotation-parser.test.ts src/__tests__/mutation-runner-floors.test.ts src/components/strategy src/lib/queries.trade-venues.test.ts
npx vitest run -u src/lib/factsheet/build-payload.test.ts   # snapshot, review the diff
npm run test:coverage                                  # only to read thresholds; CI merges shards
```
Quote bracketed paths (`"src/app/factsheet/[id]/v2/..."`) in zsh.

## Common Pitfalls

### Pitfall 1: arms left on the old migration
**What goes wrong:** `sql-mutation` reds with `no-red` for an arm whose edit lands on a body that a later migration overwrites.
**Why:** the lane applies the apply list in order; `CREATE OR REPLACE` wins. **How to avoid:** re-point all six edit arms and add the new migration last in `RED-UNDER-SETUP`; confirm with the subset run (`biting == arms`). **Warning sign:** `no-red` or `MEASURE_FAIL ... occurs 0x`.

### Pitfall 2: TV-shape reaches no gate
**What goes wrong:** `cannot change return type of existing function` at apply. **How to avoid:** edit both migrations in that arm (Pattern 2).

### Pitfall 3: find strings collide with comments and with the self-verify
**What goes wrong:** `occurrence-mismatch` after a comment or the self-verify repeats a find. **How to avoid:** keep header prose free of the find strings; make the self-verify's window literal share one `occurrences: 2` edit with the body; run `--parse-only` (it measures occurrences against real bytes).

### Pitfall 4: census drift, in six places at once
`ARMS_FLOOR`, the `gate-family-meta` key, `armsSeen`, `stepsSeen`/`needles.length`, `totalAnchored`, and the GREEN_LOG literals in `mutation-runner-floors.test.ts` (including the per-file row `sections 10 ... biting 10`). **How to avoid:** change the arms, run `--parse-only`, then run the three vitest files and edit each pin from the printed `expected X to be Y`.

### Pitfall 5: forgetting VAC-04's ack or the snapshot regeneration
Red `VAC-04` and red `sql-function-snapshot`. Run `npm run schema:functions` after the migration exists and add `-- prod-body-ack: <hash>` with the hash VAC-04 prints.

### Pitfall 6: deleting benchmark fixtures
The SPX/ETH/GLD/IEF series feed real comparator and correlation rows. Deleting them breaks `build-payload.ts`'s `al.*` alignments (lines 191-194). Keep them.

### Pitfall 7: editing the merge-base pin in `return-stats.single-source.test.ts`
`BASE_EXPECTED` is a frozen historical tree; only `TIER2_SITES` and `RETIRED` change.

### Pitfall 8: writing a skip-CI token or a home path in tracked text
Commit/PR text must not contain the CI-skip tokens (even to deny them); `.planning` text must not contain an absolute home path or the local username (`check-planning-hygiene`). Use repo-relative paths.

### Pitfall 9: payload cache key left at v24
An old entry still carries the demo fields and still serves "no gaps". One bump, three test pins (`page.cache-isolation.test.tsx:156`, `page.public-cache-key.test.tsx:290,360,381`), and a comment (`fetch-and-build-payload.ts:746`).

## Code Examples

### Reader mirroring the template (shape only; planner writes final)
```ts
// Source: src/lib/factsheet/trade-fetch-provenance.ts readReconstructedRanges (:99-165), adapted
export interface UnrecoveredGapsRead { gaps: UnrecoveredGap[]; malformed: string | null }
function malformedGaps(reason: string): UnrecoveredGapsRead {
  console.warn(`[trade-fetch-provenance] series_provenance.unrecovered_gaps is malformed (${reason}); naming no gap`);
  return { gaps: [], malformed: reason };
}
export function parseUnrecoveredGaps(p: unknown): UnrecoveredGap[] { return readUnrecoveredGaps(p).gaps; }
```

### Flag spread
```ts
// Source: src/lib/factsheet/build-payload.ts:1086
...(strategy.unrecoveredGapsUnavailable ? { unrecoveredGapsUnavailable: true } : {}),
```

### Migration skeleton (venues), body re-based on the only existing definition
```sql
-- Source: supabase/migrations/20261019120000_get_published_trade_venues.sql (body), plus the window predicate
CREATE OR REPLACE FUNCTION public.get_published_trade_venues(p_strategy_ids uuid[])
RETURNS TABLE (strategy_id uuid, exchange text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT s.id,
         lower(k.exchange)
    FROM public.strategies s
    JOIN public.api_keys k ON k.id = s.api_key_id
   WHERE s.status = 'published'
     AND s.id = ANY(p_strategy_ids)
  UNION
  SELECT s.id,
         lower(k.exchange)
    FROM public.strategies s
    JOIN public.strategy_keys sk ON sk.strategy_id = s.id
    JOIN public.api_keys k ON k.id = sk.api_key_id
   WHERE s.status = 'published'
     AND s.id = ANY(p_strategy_ids)
     AND (sk.window_end IS NULL OR sk.window_end > current_date);
$$;
-- then REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO anon, authenticated, service_role;
-- catalogue-only DO block (pg_proc, has_function_privilege, aclexplode, prosrc LIKE) - no table read;
-- `-- prod-body-ack: <sha256>` line; wrap in BEGIN/SET lock_timeout = '3s'/COMMIT as the old file does.
```
(The `s.status = 'published'` string appears exactly twice here, matching TV-1's `occurrences: 2`; do not repeat it in comments.)

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| Demo cohort and blends rendered on the factsheet | QUIETVIEW (Phase 193) removed the render only | this phase removes the producers and the payload fields |
| Gap record parsed total with `console.warn` | reconstructed record reports to Sentry and flags `reconstructedRangesUnavailable` | the gap record adopts the same posture |
| `get_published_trade_venues` returns every historical key venue | open windows only | removes the false `Listed as X; trades come from Y, X.` cue after a rotation |

**Deprecated:** `FactsheetBodyOptions.hideAllocatorSection` (no-op since QUIETVIEW).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The ack hash equals the normalized hash of today's committed snapshot (`1dd7db89...`) because PROD still runs the `20261019120000` body unmodified | Q2 | VAC-04 prints the real hash on failure; paste that. Low. |
| A2 | The self-verify can spell its window literal so one `occurrences: 2` edit rewrites body and check together | Pattern 3 | If the planner spells them differently, an extra edit step per arm is needed; `--parse-only` catches miscounts. Low. |
| A3 | `test-db-drift` (VAC-08) body leg is red or exempt before `apply-test` | Q2 | A surprise red on the PR; re-run after the apply. Low. |
| A4 | Vitest files that scan every migration (`raise-exception-concat-grammar` etc.) stay green with a clean new migration | Q1 | Found when `npm ci` + vitest runs. Low. |
| A5 | `stepsSeen` becomes 949 with the arm shapes above | Q1 | Re-measure from the failing pin; do not trust the sum. Low. |
| A6 | Vitest/tsc/eslint were not run: all test-file edit lists come from reading and grep, not from a type-check | Q3, Q5 | An excess-property or unused `@ts-expect-error` could be missed; `npx tsc --noEmit` after `npm ci` is the check. Medium. |

## Open Questions (RESOLVED)

1. **Should a third (NULL-window) arm exist?** What we know: TV-strategy-keys already bites a mutation that drops `sk.window_end IS NULL OR`. Unclear: whether the founder wants a dedicated named arm. Recommendation: no; two arms (closed window, window ending exactly today). If wanted, place it before TV-strategy-keys.
   RESOLVED (2026-11-14, planning): no third arm. Plan 210-01 Task 1 Step 4(e) adds exactly TV-closed-window and TV-window-end-today and says not to write a NULL-window arm, because TV-strategy-keys already bites that mutation.
2. **Rename `build-payload.test.ts` api snapshot test title?** Recommendation: leave the title; the snapshot key follows the title and `-u` updates content only.
   RESOLVED (2026-11-14, planning): the title is kept. Plan 210-02 Task 1 Step 1 forbids renaming the api snapshot test, and its Step 4 refreshes the snapshot with `-u` and checks that only the api entry moved.
3. **Does the planner want an e2e/tear-sheet test for the gap sentence?** The shared render path makes one FactsheetView test sufficient; add a tear-sheet page test only if cheap.
   RESOLVED (2026-11-14, planning): yes, a cheap one, and no e2e. Plan 210-05 Task 2 adds the tear-sheet hand-off case to `src/app/factsheet/[id]/tearsheet/page.trade-fetch.test.tsx` and a `printView` render case in `FactsheetView.unrecovered-gap.test.tsx`, which proves the sentence survives the tear sheet's mode.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | runner, linters | yes | v25.8.1 | -- |
| `node_modules` in this worktree | vitest, tsc, eslint, tsx (`schema:functions`) | NO | -- | run `npm ci` once at the start of execution (disk: about 4.2 GiB free) |
| PostgreSQL 16 + pg_cron (Homebrew) | mutation runner / pg-lane | yes | 16.x | -- |
| Disk for a FULL local mutation run | full `run.mjs` | no (about 4.2 GiB free vs about 15 GB needed) | -- | subset run locally; CI `sql-mutation` FULL is authoritative |
| `supabase` CLI | not needed | linked to PRODUCTION: never run `db push`/`--linked` | -- | -- |

**Missing with no fallback:** none. **Missing with fallback:** `node_modules` (`npm ci`), full local mutation run (CI).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Frameworks | vitest (jsdom + node projects, `vitest.config.ts`); SQL gate file run by the mutation runner / pg-lane and by `sql-tests` |
| Quick run | `node scripts/mutation-runner/run.mjs --subset-from <list>` (SQL, about 12 s); `npx vitest run <file>` (TS) |
| Full suite | `npm test` (vitest), `node scripts/mutation-runner/run.mjs` (CI only on this host) |

### Phase Requirements -> Test Map (success criteria)
| SC | Behavior | Test (RED when the fix is reverted) | Command | Exists? |
|----|----------|-------------------------------------|---------|---------|
| SC-1 | closed window ignored; window ending today counts as closed | NEW arms `TV-closed-window`, `TV-window-end-today` in `supabase/tests/test_get_published_trade_venues.sql` (anon gets exactly one `okx` row) | `node scripts/mutation-runner/run.mjs --subset-from <list>` (must print `biting` equal to arms) | Wave 0 (new arms) |
| SC-1 | the other six body arms still bite on the NEW file | re-pointed arms | same | existing, edited |
| SC-1 | badge contract: listed `okx` + venues `[okx]` no cue, `[binance, okx]` cue | `src/components/strategy/SyncBadge.venue.test.tsx` (existing cases at `:129` partial overlap and `:141` full containment cover most; add the exact `[okx]` vs `[binance, okx]` pair if absent) | `npx vitest run src/components/strategy/SyncBadge.venue.test.tsx` | partly exists (this test passes before and after; it pins the contract, the SQL arm is the RED-on-revert) |
| SC-1 | all-windows-closed returns no row, `tradeVenues` unset, not "unavailable" | `src/lib/queries.trade-venues.test.ts` (existing `:281` "a successful read that finds no key is NOT unavailable"); optionally a named all-closed variant | `npx vitest run src/lib/queries.trade-venues.test.ts` | exists (+ optional) |
| SC-2 | api payload has neither field, and no demo cohort/blend name is serialized | flip `v2/FactsheetBody.no-demo-content.test.tsx` premise (`"peerPercentile" in p` false, `"allocatorPortfolios" in p` false) and add to `src/lib/factsheet/build-payload.test.ts` an assertion that `JSON.stringify(payload)` contains none of `60/40 Stocks/Bonds`, `Multi-Asset Risk Parity`, `Diversified Crypto Blend`, `sixty_forty`, `multi_asset`, `crypto_book` | `npx vitest run src/lib/factsheet/build-payload.test.ts "src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx"` | Wave 0 (new/edited) |
| SC-2 | snapshot no longer holds the fields | `build-payload.test.ts.snap` entry 2 | `npx vitest run src/lib/factsheet/build-payload.test.ts` | edited |
| SC-2 | cache key bumped | `page.public-cache-key.test.tsx`, `page.cache-isolation.test.tsx` (pin the new key string) | `npx vitest run "src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx" "src/app/factsheet-share/[token]/page.cache-isolation.test.tsx"` | edited |
| SC-3 | reader says malformed | NEW cases in `trade-fetch-provenance.test.ts` via `readUnrecoveredGaps` | `npx vitest run src/lib/factsheet/trade-fetch-provenance.test.ts` | Wave 0 |
| SC-3 | Sentry once with the stage tag, flag set, detail is the reason only (never raw provenance) | edited `fetch-and-build-payload.test.ts` `:1088` test | `npx vitest run src/lib/factsheet/fetch-and-build-payload.test.ts` | edited |
| SC-3 | sentence renders, no gap line; valid empty shows nothing | `FactsheetView.unrecovered-gap.test.tsx` | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetView.unrecovered-gap.test.tsx"` | edited |
| SC-4 | every census agrees | `gate-family-meta`, `mutation-annotation-parser`, `mutation-runner-floors`, `return-stats.single-source` | `npx vitest run` on those four | edited |

### Neuter-the-fix procedure (byte backup; never `git checkout`, `git restore` or `git stash` on uncommitted work)
For each TS fix, after the executor's work is complete and green:
1. `cp <file> <scratch>/<name>.bak` (the file being neutered), record `shasum -a 256`.
2. Apply the one-line neuter with an editor edit (not a git command): SC-2 re-add `peerPercentile: null, allocatorPortfolios: null,` into the api return in `build-payload.ts`; SC-3 make `readUnrecoveredGaps` always return `malformed: null`, or drop the `captureToSentry` block in the caller, or drop the `unavailable` early return in `UnrecoveredGapLines`.
3. Run the matching test above; it must be RED with the expected assertion message.
4. Restore with `cp <scratch>/<name>.bak <file>`; `shasum -a 256` must equal the recorded value; re-run the test GREEN.
For SQL, the mutation runner IS the neuter: it applies each arm's mutation to a scratch copy and never touches the checkout (run header, invariant 1), so `biting == arms` proves each new arm can fail. To prove the fix itself is load-bearing, the TV-closed-window arm replaces the predicate in the new migration and goes RED with its own name first.

### Sampling Rate
- Per task commit: the one test file touched plus `node scripts/mutation-runner/run.mjs --parse-only` for SQL tasks.
- Per wave merge: the vitest groups in the command block, `npx tsc --noEmit`, `npm run lint`.
- Phase gate: all of the above plus CI (`sql-mutation` FULL, `sql-tests`, `migration-drift-check` with the ack) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `npm ci` in this worktree.
- [ ] New arms and fixtures in `supabase/tests/test_get_published_trade_venues.sql`.
- [ ] New reader/caller/render cases (SC-3) and the flipped no-demo assertions (SC-2).
- [ ] New migration + rollback + regenerated function snapshot.

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json`, so this section applies.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | -- |
| V3 Session Management | no | -- |
| V4 Access Control | yes | SECURITY DEFINER with `SET search_path = public, pg_temp`; `RETURNS TABLE (strategy_id uuid, exchange text)` as the column allow-list; `s.status = 'published'` gate; explicit `REVOKE ALL FROM PUBLIC` and `GRANT EXECUTE TO anon, authenticated, service_role`. The window predicate only narrows output. |
| V5 Input Validation | yes | the gap reader validates shape and dates; one bad entry voids the record |
| V7 Error Handling and Logging | yes | `captureToSentry` with `extra.detail` = reason string only, never raw provenance (Phase 209 SCRUBLEAKS posture) |
| V8 Data Protection | yes | removal of invented data from public payload and cache; no key id, label or encrypted field can leave the function |
| V6 Cryptography | no | -- |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Function-planting via mutable search_path in a SECDEF function | Elevation of privilege | pinned `SET search_path = public, pg_temp`, asserted in the catalogue self-verify and by arm `TV-searchpath` |
| Widening the RETURNS TABLE (key id leak) | Information disclosure | arm `TV-shape`, self-verify string pin |
| Unpublished strategy venue leak | Information disclosure | arms `TV-unpublished` and `TV-unpublished-composite` (the new window line sits after the published gate in the same arm) |
| Stale cached payload serving removed/invented data | Tampering / integrity | cache-key bump with pinned tests |
| Raw database detail in an error report | Information disclosure | only the short reason string goes to `extra` |
| Fabricated peer/allocator numbers reaching clients | Integrity (repudiation of figures) | fields removed at the producer; runtime absence assertion |

The migration reviewer and `rls-policy-auditor` runs are required by SC-1 before merge.

## Conflicts with CONTEXT

1. **D-08 / TV-shape is under-specified.** CONTEXT says to re-point TV-shape at the new migration. Editing only the new file widens `RETURNS TABLE` after the unmutated old migration created the 2-column function, and `CREATE OR REPLACE` then fails (`cannot change return type of existing function`, verified). TV-shape must edit BOTH the old and new migrations (8 file steps), keeping its four existing steps on the old file. This does not contradict a locked outcome, it adds steps.
2. **D-04 versus arm reachability.** A body-text (`prosrc`) check in the self-verify makes any arm that mutates the predicate abort at apply unless the check's literal is rewritten in the same arm. Resolve with a shared literal and one `occurrences: 2` edit (Pattern 3). Not a change to D-04, a constraint on how to spell it.
3. **D-11 "delete the SPX/IEF/GLD/ETH series only if nothing else imports them":** measured, `build-payload.ts` itself still imports and uses all four for real comparator and correlation rows, so none is deleted.
4. **D-14 "grep every other cache key":** measured, only `v2/page.tsx` stores a factsheet payload via `unstable_cache`; the other named surfaces have no such cache. The bump is single, but three tests and one comment name the key string and must move with it.
5. **CONTEXT does not mention two PR-gate consequences of a body-changing migration:** the VAC-04 `-- prod-body-ack:` pragma and the regenerated `supabase/schema/functions/get_published_trade_venues.sql`, and the expected stale-baseline red on `sql-gate-lint` until the post-apply re-dump. Both are required work or expected state, not changes to decisions.
6. **D-15 "about 60 files"** is confirmed (65 in `src/`; 46 of them only pass the dead prop).
7. **D-12:** the `BASE_EXPECTED` merge-base list in `return-stats.single-source.test.ts` lists `allocator.ts P2` and must NOT be edited (it pins a historical tree). Only `TIER2_SITES`, `RETIRED` and the `toHaveLength(28)` count change.

## Sources

### Primary (HIGH confidence, read or executed this session)
- `scripts/mutation-runner/run.mjs` (header, `applyFileStep` :237-252, per-arm loop :2740-2960), `scripts/mutation-runner/GRAMMAR.md`, `scripts/mutation-floors.mjs` (:1348, :3425, :3539), `scripts/sql-gate-subset.mjs:113`.
- `supabase/migrations/20261019120000_get_published_trade_venues.sql`, `supabase/tests/test_get_published_trade_venues.sql`, `supabase/migrations/20260710120000_strategy_keys.sql` (:11-12, :35-48), `supabase/migrations/down/20261019120000-rollback.sql`, `supabase/schema/functions/get_published_trade_venues.sql`.
- `src/__tests__/{gate-family-meta,mutation-annotation-parser,mutation-runner-floors}.test.ts`, `src/lib/return-stats.single-source.test.ts`, `src/lib/factsheet/*` (build-payload, types, trade-fetch-provenance, fetch-and-build-payload and tests), `src/app/factsheet/[id]/{trade-fetch-lines.tsx,v2/page.tsx,v2/FactsheetView.tsx,tearsheet/page.tsx}`, `src/lib/queries.ts` `readPublishedTradeVenues`.
- `scripts/prod-body-drift-check.sh`, `scripts/baseline-content-drift-check.mjs` (ran), `scripts/check-baseline-currency.mjs` (ran), `scripts/test-ledger-drift-check.sh`, `.github/workflows/{migration-drift-check,migration-policy}.yml`, `.github/workflows/ci.yml` job list.
- Git history: analog commits `959ef9820`, `1f3256f36`, `2516d8b13`, `a363392ea` (file lists and census diffs); CHANGELOG lines 570, 935, 1371.
- Executed: `--parse-only`, `--subset-from` (exit 0, 10 arms), `lint-sql-gates`, `lint-migration-data-dependence`, `lint-app-guc`, `check-baseline-currency --replay-set`, `baseline-content-drift-check`, `sql-body-normalize --diff-bodies`, and a scratch PostgreSQL 16 reproduction of the `cannot change return type` error.
- TODOS entries `170.6.1-VENUES-CLOSED-KEY-WINDOWS` (:1148), `193-DEMO-PAYLOAD-PRODUCERS` (:3716 and :10907), `167.1.2.2.2-GAP-RECORD-SILENT-PARSE` (:7864).

### Secondary / Tertiary
- None. No web search or external documentation was needed; no package was added.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new.
- Architecture and mutation machinery: HIGH, executed and read.
- Census lists: HIGH for the pins named; the exact `stepsSeen` and `lint-migration-data-dependence` count moves must be re-measured from failing pins.
- Pitfalls: HIGH for 1-7, MEDIUM for expected PR check colours.
- TS test edit lists: MEDIUM (grep and reading only, no vitest/tsc run: `node_modules` absent).

**Research date:** 2026-11-14
**Valid until:** about 7 days (parallel phases 207-211 and the ship cadence move the cache-key number, `ARMS_FLOOR`, `stepsSeen` and the latest migration timestamp; re-measure each at plan and again before push).

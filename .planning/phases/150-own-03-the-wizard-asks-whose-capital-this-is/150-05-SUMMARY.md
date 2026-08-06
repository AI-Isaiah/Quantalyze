---
phase: 150-own-03-the-wizard-asks-whose-capital-this-is
plan: 05
subsystem: api
tags: [route, money-path, upsert, rls, provisioning, adapter, own-03, d-12-a, d-12-b, d-03-b, own-05]

# Dependency graph
requires:
  - phase: 150-01
    provides: strategies.capital_ownership column + the D-03-A BEFORE INSERT trigger this route's upsert fires against, and the SECURITY DEFINER seed-trigger repair that makes an authenticated portfolio_strategies INSERT possible at all
  - phase: 150-02
    provides: isAllocatable/OWN_CAPITAL (capital-ownership.ts) and MAGNITUDE_CAPS's documented ticket-vs-AUM cap split
provides:
  - "POST/DELETE /api/portfolio-strategies/allocation — the phase's money write (upsert amount, remove position) with lazy real-portfolio provisioning"
  - "queries.getOwnCapitalStrategies(userId) + the exported OwnCapitalStrategy type — the own-scoped marked-strategy read with a series-paired analytics embed"
  - "toStrategyRows({ strategies, positions, now }) — the D-12-A union row set with D-12-B render-derived weights and the OWN-05 owner-name carve-out"
affects: [150-06 Mark dialog, 150-07 Holdings rendering + the HAND-OFF slack removal, 150-08 phase gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-derived container id: the money route resolves the caller's portfolio from auth.uid() and never accepts one from the body, so cross-tenant reach is impossible by construction rather than by a droppable pre-check"
    - "Reject-before-provision ordering: ownership/mark pre-checks run BEFORE any container mint, so a 404/409 request creates nothing"
    - "Render-derived display value in place of an unwritten column: weight = allocation / Σ allocation, which lets current_weight keep its zero-writer invariant"
    - "Owner-name carve-out scoped by marked-set membership (which is user_id-filtered server-side), so a disclosure carve-out cannot reach a third-party row"

key-files:
  created:
    - src/app/api/portfolio-strategies/allocation/route.ts
    - src/app/api/portfolio-strategies/allocation/route.test.ts
  modified:
    - src/lib/queries.ts
    - src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts
    - src/app/(dashboard)/allocations/lib/strategies-row-adapter.test.ts
    - src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx
    - src/lib/api/limiter-ordering.test.ts

key-decisions:
  - "The owner-name carve-out is gated on marked-set membership, not applied to every row: the plan's one-line formula read literally would have surfaced a third-party manager's real name on exploratory rows"
  - "The @audit-skip pragma on the provisioning insert is honest, not an exemption — the mint IS audited via metadata.provisioned on the same request's allocation.update event"
  - "The parse stays INLINE in both verbs; only the error logging is extracted, because the B15 helper-extraction guard's coverage depends on an in-method body marker"
  - "The route was NOT added to the no-store MUST_STAMP_NO_STORE allowlist — its count assertion would conflict with the sibling wave-2 agent's route; the property is pinned route-locally instead and Plan 08 registers both in one edit"

# Metrics
duration: ~90min
completed: 2026-08-06
---

# Phase 150 Plan 05: Holdings Data Layer — the Money Write Summary

**The OWN-03 money path now exists end to end at the data tier: a POST/DELETE allocation route that derives its own container from the session and lazily provisions the allocator's real book, an own-scoped marked-strategy read, and an adapter that unions marked strategies with existing positions and derives the Weight column instead of reading a column nobody writes.**

## Performance

- **Duration:** ~90 min
- **Tasks:** 3 of 3
- **Commits:** 8 (2 TDD RED/GREEN pairs + 1 feat + 1 test + 2 gate fixes)
- **Files:** 7 (2 created, 5 modified)
- **Mutations run:** 21 — **20 caught, 1 blind spot found and closed**

## Accomplishments

- **SC 2's write exists and is money-path-reviewed in code.** The route's docblock carries the composite-PK argument, the `FOR ALL`/`USING`-as-check RLS note, the BEFORE-INSERT trigger's interaction with the upsert's ON CONFLICT path, and the `current_weight` non-goal — so the next reader does not reconstruct them from four migrations.
- **SC 4 holds structurally and is falsifiably pinned.** The `onConflict` target is asserted as the literal `"portfolio_id,strategy_id"`; narrowing it to `"portfolio_id"` reddens two tests.
- **SC 2 is now REACHABLE for every allocator.** Censused and confirmed: this route is the repo's **only** `is_test: false` portfolios creation path. `CreatePortfolioForm` deliberately inserts `is_test: true` and nothing else creates a real book — so without lazy provisioning, every allocator's book is portfolio-less and the Allocate action would 404 for all of them.
- **Provisioning cannot be weaponised.** The strategy ownership (404) and mark (409) pre-checks run *before* any mint, so a probe against someone else's strategy id creates nothing. The insert payload draws only on `auth.uid()`; no client input reaches it. DELETE never provisions.
- **`current_weight` keeps its zero-writer invariant.** It is written nowhere in the route and read nowhere in the adapter — the Weight column is derived from `allocated_amount` at render (D-12-B), which is what makes the non-write affordable rather than a visible gap.
- **No allocated money can vanish from the money surface (D-12-A).** A position whose strategy is unmarked keeps its row with `capitalOwnership: null`.
- **OWN-05 SC 1c holds on Holdings.** A wizard-shaped row (codename null, tier exploratory) now renders its real name instead of `Strategy #8d382aaf` — the mechanism behind the 2026-08-05 holdings-confusion incident.

## Task Commits

| # | Task | Commits |
|---|------|---------|
| 1 | Allocation route (TDD) | `ec2a8679` (RED) → `e40c6420` (GREEN) |
| 2 | `getOwnCapitalStrategies` | `09ddc9cc` |
| 3 | Adapter union rows (TDD) | `f2d49b57` (RED) → `8733bca5` (GREEN) → `1d6f5e45` (blind-spot test) |
| — | Repo-gate fixes | `b8b8932d` (audit pragma), `6c06d001` (B15 registration + inline parse) |

## Verification

| Gate | Result |
|------|--------|
| `route.test.ts` | **51 passed** |
| `strategies-row-adapter.test.ts` + `HoldingsTable.strategy-rows.test.tsx` | **47 passed** |
| `phase-147-series-resolution-guards.test.ts` | 12 passed |
| `src/__tests__` (repo-wide gates incl. no-store + audit coverage) | **94 files / 1094 passed**, 17 skipped |
| `src/lib` | **181 files / 3532 passed**, 9 skipped |
| `src/app/api` | **92 files / 1791 passed**, 3 skipped |
| `src/app/(dashboard)/allocations` | **119 files / 1641 passed** |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (1 pre-existing warning, `EquityChart.tsx:1119`, unrelated file) |

**Acceptance greps**

- `current_weight` in the route, comments stripped → **0**; `onConflict` → 1; `is_test` (comments stripped) → **3** (resolve filter, insert literal, plus the docblock reference) — ≥2 required.
- Cap boundary pinned with LITERALS in the test (`1_000_000_000` accepted / `1_000_000_001` rejected); `MAGNITUDE_CAPS` is deliberately **not** imported into the test, so editing the constant reddens it.
- `getOwnCapitalStrategies` exists with `.eq("user_id", userId)` inline on the same chain; `grep -c '"own_capital"' src/lib/queries.ts` → **0**.
- Adapter: capital-ownership import → 1; `"own_capital"` literal → **0**; `HAND-OFF(150-07)` → **3**; `current_weight` (comments stripped) → **0**.
- `git diff --name-only ccd5498e..HEAD` contains **neither** `HoldingsTabPanel.tsx` **nor** `HoldingsTable.tsx` (B-3); `HoldingsTable.strategy-rows.test.tsx` appears only for the Weight-cell expectation update.

**Write-site census** (`grep -rn -A3 'from("portfolio_strategies")' src/ | grep -iE '\.(insert|upsert)\('`), non-test:

```
src/app/api/portfolio-strategies/allocation/route.ts:278   .upsert(
src/components/portfolio/MigrationWizard.tsx:72            .upsert({
src/components/portfolio/AddToPortfolio.tsx:54             .insert({
```

Exactly the two legacy client sites + this route, as the plan predicted. The `portfolios` insert census returns exactly two sites — `CreatePortfolioForm.tsx:57` (`is_test: true`) and this route — confirming the D-03-B premise empirically rather than by assertion.

### Rule-9 mutation ledger — 21 mutations, 20 caught on the first pass

**Route (11/11 caught):**

| # | Mutation | Result |
|---|----------|--------|
| M1 | `onConflict` narrowed to `"portfolio_id"` | RED (2 tests) — the SC-4 oracle |
| M2 | resolve loses its `is_test = false` filter | RED — a scenario portfolio could become the real book |
| M3 | provisions `is_test: true` | RED |
| M4 | AUM cap ($1e12) swapped in for the ticket cap ($1e9) | RED |
| M5 | zero amount accepted (`<= 0` → `< 0`) | RED |
| M6 | only `team_review` blocked, so an UNMARKED strategy becomes allocatable | RED (4 tests) |
| M7 | W-2 guard removed (proceed after an empty 23505 re-select) | RED |
| M8 | limiter consumed before validation | RED |
| M9 | DELETE mints a container | RED |
| M10 | zero-row upsert treated as success | RED (2 tests) |
| M11 | **provisioning hoisted above the strategy pre-checks** (the W-1 ordering property, applied as a real block move) | RED — caught by exactly the two W-1 tests |

**Adapter (9 mutations, 8 caught, 1 blind spot):**

| # | Mutation | Result |
|---|----------|--------|
| A1 | `weight: ps.current_weight` re-added as the display source | RED (3 tests) |
| A2 | carve-out un-scoped (prefers the raw name on every row) | RED (3 tests) — the disclosure arm |
| A3 | denominator includes unmarked positioned rows | RED |
| A4 | unallocated `age` fabricated as 0 | RED |
| A5 | unallocated `allocation` fabricated as 0 | RED (2 tests) |
| A6 | fail-closed predicate dropped on the POSITIONED arm | **Initially GREEN (blind)** — see below |
| A7 | union dedupe dropped | RED (5 tests) |
| A8 | zero-denominator guard weakened to `>= 0` | RED |
| A9 | marked-without-position rows dropped entirely | RED (8 tests) |

**A6 is the honest finding.** `capitalOwnership` is derived at **two** call sites — once per union half — and the fail-closed test I wrote only exercised the marked-**without**-position arm. Replacing the positioned arm's `isAllocatable(...)` with a bare `owned ? OWN_CAPITAL : null` left the whole suite green. Measured, not assumed; closed by a second case (`1d6f5e45`) feeding a `team_review` mark on a strategy that *does* have a position, asserting both `capitalOwnership: null` and exclusion from the weight denominator. Re-running A6 now reddens exactly that test.

## Decisions Made

- **The owner-name carve-out is gated on marked-set membership.** The plan's behaviour block gives the formula as `ps?.alias?.trim() || s.name || displayStrategyName(...)`. Applied to *every* row that would surface a third-party manager's real `strategies.name` on exploratory-tier positions — a live disclosure regression, and it would have broken the shipped "exploratory falls back to codename, never the real name" test. The plan's own text resolves the ambiguity ("a position whose strategy is NOT in the marked set renders **as today** for name"), so `s.name` there means the *marked* record. Implemented owner-scoped, and pinned with an explicit disclosure test.
- **`OwnCapitalStrategy` is exported from `queries.ts`** and reuses the dashboard payload's `Pick<StrategyAnalytics, …>` verbatim, so the adapter reads the same analytics fields off both halves of the union with no cast.
- **The route is not in the no-store allowlist.** See "Follow-Ups".

## Deviations from Plan

### Auto-fixed

**1. [Rule 2 — Missing critical] The owner-name carve-out is owner-scoped rather than universal**
- **Found during:** Task 3, writing the name-resolution arm.
- **Issue:** The literal formula would prefer `strategies.name` on third-party position rows, surfacing a manager's real name beside their codename on exploratory tiers — exactly the cross-correlation `browse/route.ts:44-56` exists to prevent.
- **Fix:** the carve-out consults the *marked* record (`owned?.name`), and the marked set is `user_id`-filtered server-side, so it is structurally unreachable for third-party rows. Pinned by a dedicated disclosure test; mutation A2 reddens it.
- **Files:** `strategies-row-adapter.ts`, `strategies-row-adapter.test.ts`
- **Commits:** `f2d49b57`, `8733bca5`

**2. [Rule 3 — Blocking] `@audit-skip` pragma on the provisioning insert**
- **Found during:** post-Task-3 repo-wide gate run.
- **Issue:** `audit-coverage.test.ts` requires a `logAuditEvent` within 60 lines of every mutation or an in-window pragma. The route *does* audit the mint — via `metadata.provisioned: true` on the same request's `allocation.update` event — but the emission sits past the window because the 23505 race arm is between them.
- **Fix:** an `@audit-skip` pragma stating exactly that. A separate event was rejected: it would double-count one user action, since the line is unreachable except by allocating.
- **Files:** `route.ts` — **Commit:** `b8b8932d`

**3. [Rule 3 — Blocking] Registered the route in the B15 limiter-ordering registry, and un-extracted the body parse**
- **Found during:** the `src/lib` suite run.
- **Issue:** two failures. (a) `limiter-ordering.test.ts` requires every limiter-consuming route to be classified; the new route was unclassified. (b) After classifying it as CANONICAL, the *helper-extraction guard* fired: hoisting `await req.json()` into a shared `readBody()` helper strips the body marker from each method segment, which silently takes that route's validate-then-limit ordering check **dark**.
- **Fix:** added to `CANONICAL` with a rationale comment, and restored real coverage by inlining the parse in both verbs — only the error *logging* stays extracted, with a comment explaining why it must. Exempting the route was rejected: the guard was right.
- **Files:** `src/lib/api/limiter-ordering.test.ts` (outside the plan's declared file list), `route.ts` — **Commit:** `6c06d001`

**4. [Rule 1 — Bug] Test-fixture correction: the portfolios resolve fixture exhausted after one call**
- **Found during:** Task 1 GREEN.
- **Issue:** the mock returned "no portfolio" on a *second* request in the same test, faking a portfolio disappearing between two allocates — which failed the D-13 second-allocate case against a correct route.
- **Fix:** the fixture's last configured result now repeats, modelling the state the first request left. Committed with the GREEN implementation.
- **Commit:** `e40c6420`

**Total:** 4 auto-fixed (1 missing-critical, 2 blocking, 1 bug). No architectural changes; no user decisions required.

## Known Stubs

None in the shipped code. One **deliberate, comment-marked back-compat arm** exists and is handed off:

- `strategies-row-adapter.ts` — `HAND-OFF(150-07)` ×3: `strategies` still accepts legacy position-shaped rows, discriminated at runtime on the `strategy_id` key, so the shipped `toStrategyRows({ strategies })` call at `HoldingsTabPanel.tsx:94` keeps compiling and behaving in wave 2 (per orchestrator decision B-3). Plan 07 Task 3 wires `{ strategies: marked, positions }` and **deletes both the union arm and the discrimination**.
- `HoldingsTable.strategy-rows.test.tsx` — the Weight cell is exempted from the non-dash loop with a `HAND-OFF(150-07)` comment. Its fixture is a bare payload row with no marked-strategy input, so under D-12-B its derived share is genuinely null. Plan 07 restores a real Weight-cell assertion via a marked + allocated fixture. The other five metric columns keep the H-0062/63/64 anti-regression.

**The one deliberate behavioural diff on the legacy path:** `weight` is now `null` on rows the shipped adapter gave `current_weight` for. That is the D-12-B deletion, and it is the ledger oracle for the re-add mutation (A1). Every other field on the legacy path asserts against its pre-change expectation.

## Follow-Ups / Watch Items

- **⚠️ PROD `portfolio_strategies` census is ORCHESTRATOR-OWNED and NOT DONE.** MCP tools are stripped from subagents (upstream anthropics/claude-code#13898), so the read-only PROD query in the plan's verification section could not run here. **It must still be run** (SELECT only, `khslejtfbuezsmvmtsdn`):

  ```sql
  select ps.portfolio_id, ps.strategy_id, ps.allocated_amount, s.capital_ownership,
         s.user_id as strategy_owner, p.user_id as portfolio_owner
  from portfolio_strategies ps
  join strategies s on s.id = ps.strategy_id
  join portfolios p on p.id = ps.portfolio_id;
  ```

  It enumerates exactly which rows will render as positions-but-unmarked (no Allocate/Edit affordance) under D-12-A. **No claim is made anywhere in this plan that PROD has no real user positions** — that unsupported claim was deleted at rev-4 and is not reintroduced here. Corroborating context from 150-01: four `portfolio_strategies` rows carry `added_at` after 2026-04-16, most recent 2026-04-26 — but that is an `added_at` census, not the ownership census above, and it does not substitute for it.

- **The no-store allowlist was deliberately NOT edited.** `src/__tests__/no-store-coverage.test.ts` carries a vacuity assertion (`MUST_STAMP_NO_STORE.length === 33`). Bumping it here would collide with the sibling wave-2 agent doing the same for the Plan 06 ownership route, and a mis-merged count assertion silently shrinks a security gate. Instead the property is pinned **route-locally and more strictly**: two tests walk every arm of both verbs (8 statuses for POST, 6 for DELETE) and assert `Cache-Control: private, no-store` on each. **Plan 08 should add both new routes to `MUST_STAMP_NO_STORE` in one edit and bump the count to 35.**

- **The DELETE verb has no consumer yet.** Plan 07 owns the "Remove allocation" affordance. The route is complete and tested; it is simply unreferenced until then.

- **`getOwnCapitalStrategies` has no caller yet** — by design. Plan 07's `HoldingsTabPanel` is the first, at which point the B-3 slack comes out.

- **A strategy flipped to `team_review` between two allocates cannot be edited.** The upsert's ON CONFLICT path still enters through the INSERT arm, so the D-03-A trigger re-tests the mark on an edit. Deliberate and documented in the route, but it means the *edit* path can 500 on a flipped strategy where the pre-check would have said 409 (the pre-check reads the current mark, so this only bites on a race). Plan 06 owns the flip UX; worth a glance there.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-write-endpoint | `src/app/api/portfolio-strategies/allocation/route.ts` | The phase's first money-mutating endpoint and the repo's only `is_test=false` portfolios creation path. Registered against the plan's threat model: T-150-21 (container id derived from `auth.uid()`, never the body, + explicit `strategies.user_id` pre-check), T-150-22 (409 pre-check + the Plan-01 trigger as enforcement), T-150-23 (composite PK + `onConflict`), T-150-24 (no `current_weight` in the payload), T-150-26 (`Number.isFinite` + `> 0` + the $1e9 ticket cap before the write), T-150-40 (owner-only insert payload, `is_test:false` and the seed name pinned as literals, 23505 → re-select, empty re-select → 500 not a write). All six are pinned by tests and were confirmed by mutation. |

No new surface beyond the plan's register: no new auth path, no file access, no schema change (this plan writes no migrations). The `T-150-SC` disposition holds — **zero packages installed**.

## User Setup Required

None.

## Next Phase Readiness

- **Plan 06 (Mark dialog)** — the 409 `not_allocatable` body is the exact error a "mark it own-capital first" remedy should key on. `flip_capital_ownership_to_team_review` (Plan 01) is the counterpart for the reverse direction.
- **Plan 07 (Holdings rendering)** — fetch `getOwnCapitalStrategies(userId)` alongside the existing positions query, call `toStrategyRows({ strategies: marked, positions, now })`, delete the three `HAND-OFF(150-07)` markers, and restore the Weight-cell assertion in `HoldingsTable.strategy-rows.test.tsx` with a marked + allocated fixture. `AllocateDialog` posts `{ strategy_id, allocated_amount }` — **no `portfolio_id`**, and there is no no-portfolio state to render (provisioning is server-side and lazy).
- **Plan 08 (phase gate)** — can pin the raw mark literal to `capital-ownership.ts` alone; neither `queries.ts` nor the adapter nor the route spells it. Also owns the no-store allowlist registration noted above.
- ⚠️ `STATE.md` / `ROADMAP.md` deliberately **not** touched (worktree mode; the orchestrator owns those writes post-wave).

## Self-Check: PASSED

- Both created files exist on disk, untruncated: `route.ts` (431 lines), `route.test.ts` (1006 lines).
- All five modified files carry their edits; `git diff --name-only ccd5498e..HEAD` lists exactly the 7 expected paths and no others.
- All 8 claimed commits resolve in `git log`: `ec2a8679`, `e40c6420`, `09ddc9cc`, `f2d49b57`, `8733bca5`, `1d6f5e45`, `b8b8932d`, `6c06d001`.
- `git diff --diff-filter=D ccd5498e..HEAD` reports **no file deletions**.
- Working tree clean after the mutation ledger; every mutated file was restored via a path-scoped `git checkout --`, verified by an empty `git status --short`. No `git clean`, `git stash`, or blanket reset was used at any point.
- The ephemeral mutation scripts live in the session scratchpad, never in the repo; no untracked files remain.

---
*Phase: 150-own-03-the-wizard-asks-whose-capital-this-is*
*Completed: 2026-08-06*

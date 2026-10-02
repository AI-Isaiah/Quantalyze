---
phase: 150-own-03-the-wizard-asks-whose-capital-this-is
plan: 08
subsystem: testing
tags: [structural-gate, static-analysis, mutation-testing, rule-9, own-03, d-03, no-store, b15, validation-closeout]

# Dependency graph
requires:
  - phase: 150-01
    provides: the migration whose three triggers, both D-03-A predicate arms and flip-RPC ordering P4 pins
  - phase: 150-02
    provides: capital-ownership.ts — the ONE file allowed to spell the mark literal (P1)
  - phase: 150-05
    provides: the allocation route (P2/P3) and the D-12-A union adapter (P5/P9)
  - phase: 150-04
    provides: the ownership route's atomic flip (P6) and the two routes this plan registers in both repo gates
  - phase: 150-06
    provides: the StrategyTable tag gate (P8) and the factsheet owner lane (P7)
  - phase: 150-07
    provides: HoldingsTable's affordance guard (P5)
provides:
  - "src/__tests__/phase-150-capital-ownership-invariant.test.ts — the D-03 structural gate: 15 pins, 10 numbered invariants, a 6-mutation Rule-9 ledger"
  - "MUST_STAMP_NO_STORE registration of all THREE Phase-150 write routes (33 -> 36) — the deferral 150-05 and 150-07 both recorded"
  - "B15 limiter-ordering classification of the two 150-04 routes (a real red the merged tree surfaced)"
  - "WizardClient call-site oracles for the D-07 capital-question render gate"
  - "150-VALIDATION.md closed: 21/21 task statuses, 19/19 ledger rows observed, oracle-independence verified"
affects: [/gsd:verify-work, phase-151 (current_weight), any future edit that touches the D-03 surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Repo-WALK census with a two-directional rot-guard: a new offender fails AND an allowlisted file that stops matching fails"
    - "Look-BACK chain binding: find the write method, then look back 300 chars for its table — a forward window from .from( sweeps up a different chain's write"
    - "Statement-scoped SQL extraction (triggerStatement / sqlFunctionSource): the migration says 'BEFORE INSERT' inside a COMMENT ON string too, so a file-wide count pins prose"
    - "Per-mount guard windows: N mounts must yield N guarded windows, so a second un-gated mount cannot hide behind the first one's guard"
    - "Recording what stayed GREEN with equal weight to what turned RED — the asymmetry, not the catch count, is a structural gate's justification"

key-files:
  created:
    - src/__tests__/phase-150-capital-ownership-invariant.test.ts
  modified:
    - src/__tests__/no-store-coverage.test.ts
    - src/lib/api/limiter-ordering.test.ts
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx
    - .planning/phases/150-own-03-the-wizard-asks-whose-capital-this-is/150-VALIDATION.md

key-decisions:
  - "The no-store count is 36, not the 35 two prior SUMMARYs predicted: both notes enumerated only the routes their own authors were building and missed strategies/[id]/name. All three echo a tenant value and follow the in-list alias-route precedent"
  - "The gate pins the AS-BUILT migration (three triggers, rev-2 F1/F2 and rev-3 F4 amendments), not the plan-time single-trigger design"
  - "P4b pins a migration this phase did not author — the SECDEF seed repair — because reverting it re-breaks the whole money path from a file no 150 reader would think to re-read"
  - "M1's GREEN result is recorded as a non-catch rather than dressed up: for the predicate flip the behavioural suites are the sole control"

# Metrics
duration: ~150min
completed: 2026-08-06
---

# Phase 150 Plan 08: The D-03 Structural Gate and the Phase's Closing Evidence Summary

**D-03 stops being a trigger plus good intentions: 15 mutation-proven source pins make every future edit that re-opens the capital-ownership invariant redden CI naming the offender — and closing the falsifiability ledger honestly (rather than marking seven un-run rows "covered by a named test") surfaced two real defects the merged tree had been hiding.**

## Performance

- **Duration:** ~150 min
- **Tasks:** 2 of 2
- **Commits:** 5
- **Files:** 5 (1 created, 4 modified)
- **Mutations run:** 13 — 11 caught, **2 findings** (1 measured blind spot closed, 1 real red fixed)

## Task Commits

| # | Task | Commit |
|---|------|--------|
| 1 | The D-03 structural gate + Rule-9 ledger | `0475894f` |
| 1b | `MUST_STAMP_NO_STORE` registration (delegated by 150-05/150-07) | `5b0e374d` |
| 2a | B15 limiter-ordering classification (Rule 3 — blocking red) | `662c0c99` |
| 2b | D-07 call-site oracle (Rule 2 — measured blind spot) | `9f493aa1` |
| 2c | 150-VALIDATION.md close-out | `adf14f8e` |

## Accomplishments

- **The invariant is now edit-time enforced, not review-time hoped-for.** Ten numbered invariants across 15 `it()`s: the single-source mark literal (a repo walk over 699 production files), the rot-guarded `portfolio_strategies` write census, the `current_weight` non-goal, the as-built migration shape, the SECDEF seed repair, the D-12-A union/affordance split, the atomic flip, the factsheet cache callback, the `OwnershipTag` visibility gate, and the OWN-05 marked-set-scoped name carve-out.
- **Two of six ledger mutations are caught by this file ALONE**, and that was measured rather than argued. Adding a fourth `portfolio_strategies` write to `RemoveStrategyButton.tsx` left **137 test files / 1889 assertions** green across the whole allocations tree and `src/components/portfolio`. Widening the migration's trigger to `BEFORE INSERT OR UPDATE` is invisible to the entire TypeScript suite, because no vitest file executes SQL.
- **The converse is recorded with equal weight.** Under M1 (the `isAllocatable` fail-open flip) this gate stayed 15/15 GREEN and the behavioural suites were the sole control. A gate that claims more than it does is worse than no gate, so the header says so in the same voice it uses for its wins.
- **A real red was surfaced and fixed** that no single wave could have seen — see Deviations.
- **A blind spot was found by closing the ledger properly** — the phase's *primary user-facing gate*, D-07, had no oracle at all. See Deviations.
- **The whole phase's evidence is closed**: 21/21 task statuses, 19/19 ledger rows observed with pasted evidence, **zero skipped**, oracle independence verified by grep with one named exception.

## Verification

| Gate | Result |
|------|--------|
| `phase-150-capital-ownership-invariant.test.ts` | **15 passed** |
| Phase gate battery (147 / 148 / 149 / 150 / visibility B10 / no-store / format-percent / phase-84) | 8 files, **65 passed** |
| `npm test` (full vitest) | **762 files passed, 19 skipped — 11 080 passed / 287 skipped**, 0 failed |
| `npm run test:coverage` | thresholds green — statements **85.92** (≥80), branches **80.36** (≥72), functions **82.68** (≥74), lines **87.99** (≥82) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | **0 errors** (1 pre-existing unrelated warning, `EquityChart.tsx:1119`); admin-manifest 20 routes OK, route-contract 57 routes OK |

**Acceptance greps**

| Check | Required | Actual |
|-------|----------|--------|
| `grep -rn MUTANT src/` after reverts | 0 | **0** (no MUTANT markers were used; every mutation was a real semantic edit) |
| `git status --short` after the campaign | clean | **clean** — every mutated file restored by RE-EDITING; no `git checkout --`, no `git stash`, no `git clean` |
| gate file length | ≥300 lines | **979** |
| gate header names the DB-tier owner | yes | yes — an explicit ⛔ SCOPE paragraph naming `supabase/tests/test_capital_ownership_*.sql` |
| `nyquist_compliant: true` in 150-VALIDATION.md | present | **2** occurrences (frontmatter + sign-off) |
| `⬜ pending` data rows in the ledger | 0 | **0** (the one remaining match is the status-legend line) |

### Rule-9 mutation ledger — 13 semantic production mutations, all RUN

M1–M6 are the gate's own campaign (pasted verbatim in the file header). M7–M13 were run to close ledger rows that arrived from earlier plans *asserted but never observed*.

| # | Mutation | Result |
|---|----------|--------|
| M1 | `isAllocatable` → `return mark !== null` | RED — 6 failed / 51 passed across 2 behavioural files. **Gate stayed GREEN** (recorded, not hidden) |
| M2 | 4th `portfolio_strategies` write in `RemoveStrategyButton.tsx` | RED — gate P2 names the file. **137 behavioural files / 1889 passed stayed GREEN** |
| M3 | migration trigger → `BEFORE INSERT OR UPDATE` | RED — gate P4. The TS suite is structurally blind to it |
| M4 | `current_weight: 0.5` into the upsert payload | RED — gate P3 + 3 route cases. Adapter suite GREEN |
| M5 | flip RPC → sequential `.update()` + `.delete()` | RED — gate P6 + 7 ownership-route cases |
| M6 | delete the `OwnershipTag` visibility guard | RED — gate P8 + 2 `StrategyTable.visibility` cases |
| M7 | drop `owned?.name` from the position-half name chain | RED — gate P9 + `'Strategy #s-1'` where `'Black Swan'` was expected |
| M8 | drop `.eq("user_id")` from the finalize mark UPDATE | RED — 2 filter-list cases |
| M9 | allocation `upsert` → plain `.insert(` | RED — 14 cases across gate P3 + the route suite |
| M10 | `portfolio_strategies` insert added to finalize-wizard | RED — gate P2 names finalize-wizard |
| M11 | wizard question default → `OWN_CAPITAL` | RED — 2 `MetadataStep` cases |
| M12 | `showCapitalQuestion={true}` unconditionally | **Initially GREEN (blind)** — see Deviations |
| M13 | drop `aum` from the `onComplete` payload | RED — 3 cases, led by the literal-oracle deep-equal |

## Decisions Made

- **The no-store count is 36, not 35.** Both 150-05 and 150-07 recorded "bump to 35". Those notes enumerated the two routes their own authors were building (allocation + ownership) and did not consider `strategies/[id]/name`, which 150-04 shipped alongside ownership. All three are authenticated owner-scoped writes that **echo a tenant value** in the success body (`{ok:true, allocated_amount}` / `{ok:true, mark}` / `{ok:true, name}` — and ownership's 409 additionally carries the caller's LIVE `allocated_amount`, a figure the caller never sent), which is what puts them in scope rather than in the write-ack EXEMPT class. The in-list sibling `portfolio-strategies/alias/route.ts` returns `{ok:true, alias}` and is the precedent followed. Surfaced rather than averaged (Rule 7), with the reasoning written into the file's header.
- **The gate pins the AS-BUILT migration, not the plan-time design.** The plan's P4 was written against a single `BEFORE INSERT` trigger. Three exist: the create-side trigger, the rev-3 F4 repoint trigger (`UPDATE OF strategy_id`) and the rev-2 F2 mark-transition guard (`UPDATE OF capital_ownership`), plus the rev-2 F1 owner precheck. Pinning the plan's version would have left two of the three doors into a stranded position unguarded at the source tier.
- **P4b pins a migration this phase did not author.** `20260806130000` (the SECDEF seed-trigger repair) is not an OWN-03 object, but reverting it re-breaks *every* authenticated `portfolio_strategies` INSERT — the whole money path plus the two legacy components — and does so from a file no future 150 reader would think to re-read, surfacing as an unrelated table's `42501`.
- **The `own_capital` literal is typed into the gate, never imported.** Importing `OWN_CAPITAL` to pin where `OWN_CAPITAL` lives would be the self-referential-oracle shape the phase's own testing memory warns about.
- **`triggerStatement` / `sqlFunctionSource` scope to a statement, not the file.** The migration mentions `BEFORE INSERT` inside a `COMMENT ON FUNCTION` string literal, so a file-wide count would be pinning documentation. The anti-vacuity pin bounds both extractors' output length so a runaway search cannot swallow the 737-line file.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 — Blocking] The two 150-04 routes were never classified in the B15 limiter registry**

- **Found during:** Task 2, the first full `npm test`.
- **Issue:** `src/lib/api/limiter-ordering.test.ts` failed — `strategies/[id]/ownership/route.ts` and `strategies/[id]/name/route.ts` consume a rate limiter but appear in no classification bucket, so the completeness check reported them unclassified. Not caused by this plan: 150-04 shipped both and ran `src/app/api/strategies` + `src/__tests__`, not `src/lib/api`. The failure is only reachable once every wave is merged — which is exactly what this plan's full regression surface is for.
- **Fix:** both added to `CANONICAL` with a rationale comment. This is the correct bucket rather than a silencing entry: they validate the `[id]` segment AND parse + validate the body before `checkLimit`, so the file's *other two* checks (per-method ordering, and the helper-extraction body-marker guard) also pass on them.
- **Proven load-bearing, not assumed:** hoisting `checkLimit` above the body parse in the name route reddens with `"strategies/[id]/name/route.ts: checkLimit at offset 660 precedes body read/validation at offset 782"`. Reverted by re-editing.
- **Files:** `src/lib/api/limiter-ordering.test.ts` — **Commit:** `662c0c99`

**2. [Rule 2 — Missing critical] Nothing observed the capital question's D-07 render gate**

- **Found during:** Task 2, running ledger row *SC-1 (allocator-only render)* rather than marking it "covered by a named test".
- **Issue:** replacing `showCapitalQuestion={entryContext === "contribution"}` with a literal `true` left **all 28 wizard spec files / 420 assertions GREEN**. `MetadataStep` is mocked in `WizardClient.test.tsx` and the mock never surfaced the prop — so the step's own spec proved what it does with each value while nothing proved what the call site decides to hand it. The un-gated state asks a manager onboarding *someone else's* key "whose capital is this?", and that answer is the single input that unlocks the money action (D-03-A: `own_capital` is the only allocatable mark). This is the phase's headline user-facing gate.
- **Fix:** the mock surfaces `showCapitalQuestion` (the idiom the file already uses for `entryContext` on the submit steps), plus two cases — manager ⇒ `false`, contribution ⇒ `true`. The positive arm is what makes the negative a gate rather than a dead prop.
- **Verification:** re-running the mutation now reddens `[OWN-03 D-07] does NOT ask the capital question on the manager entry path` — `Expected: false / Received: true`. Reverted.
- **Files:** `src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx` — **Commit:** `9f493aa1`

**3. [Rule 2 — Missing critical] Three pins beyond the plan's list**

The plan specified P1–P8. Three more were added, each closing a gap the plan's own invariants imply:

- **P4 extended to the two rev-2/rev-3 triggers and the flip RPC's precheck + DELETE-before-UPDATE order.** The plan predates those amendments; without this, "the invariant holds against every path" would be pinned for one of three paths.
- **P4b — the SECDEF seed-repair migration.** See Decisions.
- **P9 — the OWN-05 disclosure carve-out.** 150-05 fixed the plan's literal formula because it would have surfaced a third-party manager's real name beside their codename on exploratory-tier rows. That fix had a behavioural test but no structural pin; the mutation (M7) reddens both.

**4. [Rule 3 — Blocking] Two header claims in the gate were wrong on first write, and were corrected against measurement rather than kept**

- The anti-vacuity block asserted the migration's raw text contains `OR UPDATE` (to demonstrate the SQL stripper). It does not — the token appears nowhere in the file, which 150-01 had already recorded. Replaced with the demonstration that actually load-bears: the flip function's `--` prose argues about `auth.uid()` at length, so P4's `toBe(3)` COUNT is meaningless unstripped (raw > 3, stripped = 3), plus a synthetic self-pin of the stripper.
- The "why a structural layer" preamble claimed M4 left the route's own tests green. Measured: `route.test.ts` reddens on 3 of 86 (an exact-payload `toEqual`, the D-13 case, and its own route-local `current_weight` source pin). The header now names M2 and M3 as the sole-control mutations and says so explicitly.

**Total:** 4 auto-fixed (2 blocking, 2 missing-critical). No architectural (Rule 4) decisions were needed.

## Issues Encountered

- **The eslint cache writes into `node_modules/.cache`**, which in this worktree is a symlink to the main checkout. Cache-only, no repo effect — recorded because it is the one write this plan makes outside the worktree.
- **A route-local source pin duplicates gate P3** (`ownership`/`allocation` route tests each pin `current_weight`/`.delete()` absence in their own file). Kept deliberately: the two fail for different readers — a route author sees the local one in their own suite, a phase reviewer sees the gate.

## Known Stubs

None. Every pin in the gate asserts a real, currently-true property of shipped source, and each was proven falsifiable by a mutation that was RUN.

## Threat Flags

None. This plan adds no endpoint, no auth path, no schema change and no file access — it is one test file plus registrations in two existing repo gates, one test-file oracle, and documentation.

Register status for the plan's own two threats:

| Threat | Disposition |
|--------|-------------|
| T-150-35 (a later edit re-opening D-03) | **mitigated** — 15 pins across 10 invariants, each mutation-proven; the two rot-guarded repo walks catch files the gate author never hand-picked |
| T-150-36 (a vacuous gate) | **mitigated** — P10 pins the walk floor (>100 files), self-pins both strippers against real comment-only prose in the pinned files, bounds every extractor's output length, and self-pins the write-method regex. Plus a first-hand 13-mutation ledger in which the non-catches are recorded as non-catches |
| T-150-SC (package installs) | **zero packages installed**; `node_modules` was symlinked from the main checkout per the worktree instructions |

## Follow-Ups / Watch Items

- **The B15 gap is a class signal, not a one-off.** A new route can satisfy every check its own author runs and still be unclassified in a registry that lives in `src/lib/api`. Worth a line in `TODOS.md`: plans that add a route should run `src/lib/api` alongside `src/app/api`. Out of scope here (scope boundary).
- **`current_weight` remains writer-free**, pinned three ways (gate P3, gate P5, the route's own source pin). Phase 151 owns the column; whoever picks it up must retire those pins deliberately rather than discover them.
- **The manual-only rows in 150-VALIDATION.md are still manual** and belong to `/qa`: the live retro path on Black Swan / Alpha Centauri / Arctic Fox, and the 148 adversarial cache acceptance on a live deploy.
- **T-150-20 stays open for Phase 151** (inherited, re-acknowledged): the flip RPC removes only the CALLER's positions, so `MarkOwnershipDialog`'s confirm copy overstates the write for a published own-capital strategy a third party holds.

## User Setup Required

None.

## Self-Check: PASSED

- Created file exists on disk, untruncated: `src/__tests__/phase-150-capital-ownership-invariant.test.ts`, **979 lines** (plan minimum 300).
- All four modified files carry their edits; `git diff --name-only 4664cc8e..HEAD` lists exactly the 5 expected paths and no others.
- All five claimed commits resolve in `git log`: `0475894f`, `5b0e374d`, `662c0c99`, `9f493aa1`, `adf14f8e`.
- `git diff --diff-filter=D --name-only 4664cc8e..HEAD` reports **no file deletions**.
- `150-VALIDATION.md` contains `nyquist_compliant: true` and **zero** `⬜ pending` data rows.
- Working tree clean after the 13-mutation campaign; every mutated file was restored by RE-EDITING the mutated line, verified by an empty `git status --short`. **No `git clean`, `git stash`, `git checkout --` or blanket reset was used at any point.**
- Probe scripts lived in the session scratchpad, never in the repo; no untracked files remain.
- ⚠️ `STATE.md` / `ROADMAP.md` deliberately **not** touched — the orchestrator owns those writes.

---

## Post-Review Fixes (150-REVIEW.md warnings)

Two of the three review Warnings are closed. Both were **user-facing** findings
on the new money surface, so both cleared the blast-radius bar; WR-03 (a vacuous
DB-test occurrence count) is a test-hygiene finding and is logged, not fixed.

### WR-01 — MTD stranded at "—" for every API-ingested marked strategy

**Commit:** `c86461ce` — `fix(150-05): resolve the return series in getOwnCapitalStrategies`
**Files:** `src/lib/queries.ts`, `src/lib/queries.own-capital-strategies.test.ts` (new)

`getOwnCapitalStrategies` selected `returns_series` — which satisfied the
phase-147 Layer-A grep — and then returned the raw rows, so the Holdings
STRATEGIES panel read the bare `daily_returns` column. That column is NULL for
every API-ingested strategy, which is this phase's *primary* persona (the
capital question is asked at API key-add). The guard's letter passed while its
intent was defeated. Fix: map each row's analytics through
`resolveDailyReturnSeries` and emit the resolved series AS `daily_returns`,
mirroring the dashboard path (`queries.ts:3966-4004`), stripping the raw
`returns_series` via the same destructure idiom. Adapter, panel and row types
untouched — one reader, both union halves. RED measured before the fix
(2 failed / 3 passed, "expected null to be close to 0.05"); the oracle is the
economics (wealth on the last observed day over wealth at month end), not the
adapter's own loop.

### WR-02 — a transient read failure rendered as a definitive empty state

**Files:** `src/app/(dashboard)/allocations/page.tsx`,
`AllocationsTabs.tsx`, `HoldingsTabPanel.tsx`, `components/HoldingsTable.tsx`,
plus two new specs (`page.strategies-read-failure.test.tsx`,
`components/HoldingsTable.degraded-strategies-read.test.tsx`).

`getOwnCapitalStrategies` and `getMyStrategies` both return `null` — never `[]`
— on a transient DB/RLS failure, a contract each docblock states exists *so the
caller can avoid rendering a definitive empty state to an owner who HAS marked
strategies*. The sole caller discarded it at both collapse points:
`ownCapitalStrategies ?? []` (:156) and `(myStrategies?.length ?? 0) > 0`
(:115). A blip therefore made the owner's marked rows vanish from the money
surface, stripped the Allocate/Edit affordance from positioned rows (the
adapter derives `capitalOwnership` from marked-set membership), and — with an
empty position half — stated **"No strategies yet."** about an account with
plenty. A fabricated claim about the account, on the money surface.

**Fix — degraded render, not a throw.** The page derives
`strategiesReadFailed = ownCapitalStrategies === null || myStrategies === null`
and threads it to the Strategies section, which renders a
temporarily-unavailable notice **above** whatever did load and suppresses all
three D-15 empty-state arms. This is the `my-strategies/page.tsx:69-73,123-133`
idiom established by the 149 review's own WR-01, and it is what these two
queries' docblocks ask for. The competing precedent in page.tsx's comment
(throw-to-`error.tsx`) belongs to the reads that **throw themselves** — the
dashboard payload and the three exposure reads, whose absence leaves nothing to
render. Here the rest of the money surface (equity, exposure, holdings) is
intact; taking it down over a blip in one auxiliary read is a bigger lie than
the strip.

**The affordance is left failing CLOSED and disclosed, not restored.** With the
marked set unread, `isAllocatable(owned?.capital_ownership ?? null)` is `false`
and the Allocate button does not render — correctly, since
`guard_allocation_requires_own_capital` would reject the write anyway. Offering
an action that is guaranteed to fail is worse than hiding it; the notice names
the consequence ("allocation actions may be hidden") so the absence is
explained rather than silent.

**Falsifiers — each collapse point neutered independently and measured RED:**

| Neuter | Result |
|--------|--------|
| `page.tsx` reverted to the `?? []` / `?? 0` collapse | 5/5 RED in the page spec |
| `page.tsx` semantics only (`=== null` → `=== undefined`, prop still emitted) | exactly the 3 null cases RED, **both controls GREEN** |
| `HoldingsTable.tsx` reverted (render ignores the signal) | 4/5 RED, the fetch-succeeded control GREEN |

The semantic-only neuter is the load-bearing one: it proves the specs pin the
`null` distinction itself, not merely the presence of a new prop. Every degraded
case is paired with a fetch-succeeded control asserting the definitive copy is
still *reachable*, so no case can pass on a page that simply always reports
failure.

**Verification:** `npx tsc --noEmit` clean; `eslint` clean on all six touched
files; `vitest run "src/app/(dashboard)/allocations"` +
`phase-150-capital-ownership-invariant.test.ts` — **123 files / 1705 tests
passed**, no skips.

### Not fixed

- **WR-03** (DB test case 7c's `auth.uid()` count inflated by in-body comments,
  `>= 3` unfalsifiable) — test-hygiene, not user-facing or data-integrity, and
  the equivalent repo-side control (invariant gate P4) already strips comments
  and pins `=== 3`. Logged for `TODOS.md`, per the stopping rule.
- **`bg-card` is a dead class** — no `--color-card` token exists in
  `globals.css`'s `@theme` block, so the notice's background is transparent
  (its `border-border` hairline still delimits it). Kept deliberately for
  byte-parity with the `my-strategies` notice this mirrors; 7 files repo-wide
  share the class and want one cleanup, not a seventh divergence. Cosmetic —
  out of scope here.

---
*Phase: 150-own-03-the-wizard-asks-whose-capital-this-is*
*Completed: 2026-08-06 (review fixes: 2026-08-07)*

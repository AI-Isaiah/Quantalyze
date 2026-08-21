---
phase: 149-nav-my-strategies-a-ranking-at-discovery-parity
plan: 05
subsystem: testing
tags: [structural-gate, mutation-testing, ci-invariant, source-scan, rule-9]

# Dependency graph
requires:
  - phase: 149-01
    provides: the `visibility` prop + literal default + effectiveViewMode derivation that pins 1 and 7 assert
  - phase: 149-02
    provides: getMyStrategies / getStrategylessActiveKeys / deriveStrategylessKeys / percentile-core that pins 4, 5, 8 and 9 assert
  - phase: 149-03
    provides: the analyticsPresent chip coercion that mutation M8 falsifies
  - phase: 149-04
    provides: the /my-strategies page + MyStrategiesSection that pins 6 and 10 assert
  - phase: 148-owner-lane-cache-isolation
    provides: the gate architecture cloned here (readSource / stripComments / productionSources / extractors / anti-vacuity)
provides:
  - "src/__tests__/phase-149-my-strategies-parity.test.ts — the SC-3 CI invariant: 12 structural pins over the shared ranking surface, with a Rule-9 ledger carrying nine observed-RED mutations"
  - "149-VALIDATION.md completed: 11 per-task rows green, 12 ledger rows ✅ Observed with pasted evidence, sign-off approved"
  - "TODOS.md entries DEF-149-A / DEF-149-B / DEF-149-C"
affects: [150, 152, any future edit to StrategyTable / queries.ts percentile+owner reads / the public category pages]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "An occurrence COUNT, not a presence check, when a predicate has TWO branches — the surviving branch keeps a toContain green (checker B-3, proved by mutation M4)"
    - "Mutate BOTH members of a split invariant (derivation + wire) so neither layer's coverage claim rests on assumption — M6 and M9 red opposite layers"
    - "Absence-as-assertion on public call sites: the only control that exists for a prop appearing on an RSC no behavioural spec mounts"

key-files:
  created:
    - src/__tests__/phase-149-my-strategies-parity.test.ts
  modified:
    - TODOS.md
    - .planning/phases/149-nav-my-strategies-a-ranking-at-discovery-parity/149-VALIDATION.md

key-decisions:
  - "Pin 8 re-attributed: the plan places `isPerKeyDailiesEligibleKey` in getStrategylessActiveKeys' body, but it lives in deriveStrategylessKeys (queries.ts:361). Asserting it where the plan said would have been a permanently-red test; the pin was split across the two functions, preserving the intent exactly."
  - "The gate deliberately does NOT pin the `showViewToggle` wire — the behavioural spec owns it (proved by M6). Pinning both in the same layer would have hidden the M6/M9 asymmetry rather than measuring it."
  - "M3 had to add the `withPublishedOrOwner` import for the mutation to be SEMANTIC rather than a ReferenceError; both edits were reverted. A crash is not a falsification."

patterns-established:
  - "A gate's mutation ledger is written ONLY after the run — the ledger section ships EMPTY in the gate's own commit and is filled in the campaign commit, so no evidence can be a prediction"

requirements-completed: [NAV-01]

# Metrics
duration: 52 min
completed: 2026-08-05
---

# Phase 149 Plan 05: Structural gate + Rule-9 mutation campaign Summary

**SC-3's "structural reuse ASSERTED, not merely observed" became a CI invariant: 12 source-scan pins over the one ranking component, the one scoring core and the two public call sites — with nine mutations at nine independent production sites run, watched failing, and reverted, three of which measured a real asymmetry between the structural and behavioural layers rather than assuming one.**

## Performance

- **Duration:** ~52 min
- **Started:** 2026-08-05T17:57Z
- **Completed:** 2026-08-05T18:49Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified). **Zero production files changed** — every mutation was reverted by re-editing.

## Task Commits

1. **Task 1: the phase-149 structural gate (12 pins, empty ledger)** — `e468525e` (test)
2. **Task 2: mutation campaign + TODOS + VALIDATION ledger + phase gate** — `c0fa1478` (test)

## The W-3 discharge statement (verbatim requirement of this plan)

**SC-1's founder proof case is NOT discharged in-phase.** The case — the founder's account with
8 active keys (bybit, okx, deribit ×3, mt5 ×3) resolving to **4 ranked and SCORED rows** (each
carrying a `Pnn` against the published population; Alpha Centauri reached via `strategy_keys`)
plus **2 unranked placeholder rows**, with archived rows excluded from the ranked list and a key
covered only by an archived strategy remaining placeholder-eligible (the W-4 ruling) — is
discharged by **post-merge PROD UAT**. It is listed in 149-VALIDATION.md's **Manual-Only
Verifications** table, not verified in-phase.

**There is no checkpoint task for it, by ruling (checker W-3).** No in-phase artifact claims it
holds against PROD data. What *is* pinned in-phase is the pure-function census logic
(`queries.my-strategies.test.ts`, mutation-proved by M5: dropping the `strategy_keys` union
fabricates exactly the 3 spurious placeholders the composite would produce) — the arithmetic, not
the account.

## Mutation table — nine sites, nine observed REDs

Every row was RUN. Reverts were by RE-EDITING the mutated line; `git diff --quiet` exits 0 on all
four touched production files, `git status --short` shows no source edits, `grep -rn MUTANT src/`
returns 0. Full pasted failure output lives in the gate file's header and in 149-VALIDATION.md.

| # | Site | Mutation | Observed RED | Revert |
|---|------|----------|--------------|--------|
| **M1** | `StrategyTable.tsx:272` | `visibility = "published-only",` → `visibility,` | gate **pin 1** (1 failed \| 12 passed): `AssertionError: expected '"use client";…' to contain 'visibility = "published-only"'` — **and** `StrategyTable.visibility.test.tsx` 1 failed \| 11 passed ("the DEFAULT recipe … still drops every non-published row", `Private Nebula` rendering as a real `<a href="/factsheet/…">`) | re-edit ✅ |
| **M2** *(second member)* | `browse/[slug]/page.tsx:63` | add `visibility="owner-all-statuses"` to the mount | gate **pins 2 + 10** (2 failed \| 11 passed): `expected 'import Link from "next/link";…' not to contain 'visibility='`; `expected [ …(2) ] to have a length of 1 but got 2` | re-edit ✅ |
| **M3** | `queries.ts:296` | `.eq("user_id", userId)` → `withPublishedOrOwner(query, userId)` | gate **pin 4** (1 failed \| 12 passed): `expected '\n  const supabase = await createClie…' to contain '.eq("user_id"'`; `my-strategies/page.test.tsx` 9 failed / 9 | re-edit ✅ (incl. the import) |
| **M4** *(checker B-3)* | `queries.ts:144` | remove `withPublishedOnly(` from getPercentiles' **un-scoped** branch | gate **pin 5** (1 failed \| 12 passed): `AssertionError: expected 1 to be 2 // Object.is equality` | re-edit ✅ |
| **M5** | `queries.ts:355-357` | drop the `strategyKeyLinks` union from `covered` | `queries.my-strategies.test.ts` 3 failed / 6 passed: `expected [ 'k4', 'k5', 'k6', 'k7', 'k8' ] to deeply equal [ 'k7', 'k8' ]` (+ the archived-composite and double-linked cases) | re-edit ✅ |
| **M6** *(SC-5 second member)* | `StrategyTable.tsx:641` | `showViewToggle={visibility !== "owner-all-statuses"}` → `showViewToggle={true}` | `StrategyTable.visibility.test.tsx` 1 failed \| 11 passed: `× hides BOTH view-toggle buttons …` — `expected <button …(2)>…(1)</button> to be null` | re-edit ✅ |
| **M7** *(scorer core)* | `percentile-core.ts:112` | `percentile = 100 - percentile;` → `percentile = percentile;` | **BOTH callers**, 2 files failed, 4 failed \| 6 passed: `percentile-core.test.ts` `expected 33 to be 67` + the mixed-metric record mismatch; `queries.percentiles.test.ts` `expected 20 to be greater than 100` ×2 | re-edit ✅ |
| **M8** *(B-1 coercion)* | `StrategyTable.tsx:851-854` | drop the `analyticsPresent` coercion | `StrategyTable.pending-chip.test.tsx` 1 failed \| 17 passed: `× shows 'No data' for a NEVER-ENQUEUED row PAST the 16h window` — received `<span aria-label="Syncing — first metrics arrive in ~10–15 min" …>Syncing</span>` | re-edit ✅ |
| **M9** *(SC-5 member A)* | `StrategyTable.tsx:298` | collapse to `const effectiveViewMode = viewMode;` | gate **pin 7** (1 failed \| 12 passed): `expected '"use client";\n\nimport { useState, u…' to contain 'const effectiveViewMode = visibility …'` | re-edit ✅ |

### The three measured asymmetries (the reason all nine were run, not four)

1. **M2 — the load-bearing one.** Under the mutation that adds ONE prop to the public browse page,
   the entire behavioural table suite stayed **61 passed / 61** (`StrategyTable.visibility` +
   `StrategyTable.pending-chip` + `StrategyTable.test`). No behavioural spec in this phase mounts
   the browse RSC, so nothing behavioural can observe a prop appearing on it. For the single edit
   whose blast radius is *every anonymous /browse visitor seeing every user's drafts*, the
   structural gate is the **sole control**. This is the argument for the file's existence, now
   measured rather than asserted.
2. **M9 — gate RED, behavioural GREEN (61/61).** The toggle-hide case asserts the *buttons* are
   absent, and the buttons hang off `showViewToggle`, not off the `effectiveViewMode` derivation.
   So no behavioural spec sees the grid dead end re-opening for a stale persisted `view: "grid"`
   preference.
3. **M6 — the mirror image: behavioural RED, gate GREEN (13/13).** The gate deliberately does not
   pin the toggle wire. The toggle is an *affordance* (nothing 404s if it shows); the derivation is
   the *dead-end guard*. Pinning both in one layer would have concealed this split instead of
   measuring it — which is why both members were mutated.

**M4 deserves its own note.** The pin-5 failure reads `expected 1 to be 2`. That `1` is itself the
proof that a presence check (`toContain("withPublishedOnly(")`) would have stayed **green** — the
scoped branch's surviving occurrence satisfies it. Checker B-3's correction is validated by the
mutation, not by argument. Everything else stayed green under M4, including the B10 raw-predicate
sweep (17 passed / 17), because the mutation removes a wrapper without introducing a raw `.eq`.

**M3 is recorded honestly.** `page.test.tsx` does redden (9/9), but on the **chain shape**, not on
an observed filter string: its recording double implements `.from/.select/.eq/.neq` and not `.or`,
so the first failure is `TypeError: query.or is not a function` (visibility.ts:122 via
queries.ts:293). A double that *did* implement `.or` would leave the widened predicate
behaviourally invisible; the gate would still catch it. The mutation also required adding
`withPublishedOrOwner` to the `./visibility` import — without it the run was a `ReferenceError`,
which is a crash, not a falsification. Both edits were reverted.

## What the gate pins (12 pins, 13 `it()`s — pin 2 runs once per public page)

**Layer B — per-file / per-function literals over comment-stripped source:**

1. `StrategyTable.tsx` keeps `visibility = "published-only"` **and** the published arm
   `strategies.filter((s) => s.status === "published")` (parameterized, never deleted).
2. `discovery/[slug]/page.tsx` and `browse/[slug]/page.tsx` pass **no** `visibility=`, **no**
   `placeholderKeys`, **no** `onFinishSetup` — plus a non-vacuity clause that each really does
   mount `<StrategyTable`.
3. `getStrategiesByCategory`'s body still routes through `withPublishedOnly(`.
4. `getMyStrategies`'s body carries `.eq("user_id"` + `.neq("status", "archived")` and reaches
   neither `withPublishedOrOwner` nor `discovery_categories!inner`.
5. `getPercentiles`'s declaration head keeps `categorySlug?: string`; its body carries **exactly
   two** `withPublishedOnly(` occurrences and never `user_id`.
6. `my-strategies/page.tsx` calls `getOwnRowPercentiles(` and contains no `getPercentiles(` token.
7. The `effectiveViewMode` derivation survives verbatim, and `<SimulateImpactButton` is preceded
   within 300 chars by `s.status === "published"`.
8. `getStrategylessActiveKeys`'s body reads `strategy_keys` + `.eq("owner_id", userId)` and
   delegates to `deriveStrategylessKeys(`; the pure function's body carries
   `isPerKeyDailiesEligibleKey` and the `"archived"` literal.
9. Both percentile callers delegate to `scoreAgainstPopulation(`, and `queries.ts` carries no
   inversion arm (regex self-pinned, and the arm is positively asserted present in
   `percentile-core.ts` so its absence means *extracted*, never *deleted*).

**Layer A — repo walk (tests / `__tests__` / `.d.ts` excluded):**

10. Exactly ONE production file passes `visibility="owner-all-statuses"`, and its path contains
    `my-strategies`.
11. Exactly ONE production file exports `StrategyTable`; exactly ONE exports
    `scoreAgainstPopulation`.
12. Anti-vacuity: >100 production sources walked; the widening walk finds ≥1 file;
    `my-strategies/page.tsx` RAW contains `getPercentiles` while STRIPPED does not (stripping is
    load-bearing, not decorative); the stripped component still contains `owner-all-statuses`;
    every `functionBody` extractor returned >100 chars; and `getPercentiles`'s extracted body is
    <¼ of the file (a runaway brace-balance would otherwise swallow `queries.ts` and silently
    invert pin 5's negatives).

A missing pinned source is a **FAILURE, not a skip** (Rule 12).

## Phase gate — pasted tails

**`npm run test:coverage`:**
```
 Test Files  751 passed | 19 skipped (770)
      Tests  10778 passed | 287 skipped (11065)

=============================== Coverage summary ===============================
Statements   : 85.76% ( 24598/28682 )
Branches     : 80.14% ( 17523/21864 )
Functions    : 82.67% ( 4218/5102 )
Lines        : 87.86% ( 22517/25627 )
================================================================================
```
All four clear the blocking 82 / 80 / 74 / 72 thresholds.

**`npm run typecheck`:** clean — `tsc --noEmit` produced no output.

**`npm run lint`:**
```
✖ 1 problem (0 errors, 1 warning)
  EquityChart.tsx 1119:6  warning  React Hook useMemo has a missing dependency: 'period'
[check-admin-route-manifest] OK — 20 admin routes, all declared in manifest.
[check-route-contract] OK — 57 page routes, all declared in the manifest.
```
The single warning is pre-existing and unrelated (same warning recorded in 149-02 and 149-04).

**148 regression pair:**
```
npx vitest run "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" src/__tests__/phase-148-owner-lane-cache-isolation.test.ts --no-file-parallelism
 Test Files  2 passed (2)
      Tests  20 passed (20)
```

**Public-surface e2e:**
```
npx playwright test e2e/discovery.spec.ts e2e/discovery-prefs-isolation.spec.ts
Running 2 tests using 2 workers
  1 skipped
  1 passed (9.0s)
```
`e2e/discovery.spec.ts` passed. The `DISCO-02 allocator preferences isolation` block is
`test.skip`'d by a **pre-existing** env guard (`discovery-prefs-isolation.spec.ts:143` —
`TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` not wired locally, CI-skip per Plan 13-02 /
13-05). **Recorded as a skip, never as a pass** — it is not a phase-149 regression and not a
phase-149 finding. The public-surface invariance this phase claims is carried by gate pins 2 and 10
(mutation-proved by M2) and the untouched 61-test behavioural suite, not by that spec.

## TODOS.md entries (verbatim headings, filed in the ONE backlog)

Filed under a new `### Phase 149 (NAV-01, /my-strategies) — deferred items (added 2026-08-05)`
section in the 🟡 FIX MID-TERM band, immediately before the ⚪ DON'T FIX band:

- **`DEF-149-A` — "Finish setup →" opens the contribution wizard FRESH, with no key preselected.**
  `ContributionWizardOverlay`'s interface is `{ isOpen, onClose, onSuccess? }` — no preselect seam,
  so the owner re-picks the key they just clicked. Fix shape: one optional prop
  (`preselectApiKeyId?: string`) threaded into `WizardClient` and down to the key-selection step,
  passed by both `/my-strategies` mounts; every other caller keeps fresh-open by omitting it.
  Founder-deferred 2026-08-05.
- **`DEF-149-B` — two live surfaces now render an `h1` reading "My Strategies".** Manager
  `/strategies` and allocator `/my-strategies`. Benign at runtime (role-disjoint via
  `requireRolePage`); a TEST-AUTHORING landmine (research Pitfall 10). Convention, not a code
  change: scope every selector by route / `href` / `data-testid`, never by bare heading text.
- **`DEF-149-C` — `StrategyGrid` card links dead-end for any FUTURE owner-scoped grid consumer.**
  `StrategyGrid.tsx:52-53` builds `${basePath}/${categorySlug}/${s.id}` →
  `getStrategyDetail` (`queries.ts:776`) → `withPublishedOnly` (`queries.ts:833`) → `notFound()`.
  149 hid the toggle instead (founder ruling); the debt is **latent, not live**. Fix shape then: a
  `rowLinkMode` prop threaded into `StrategyGrid`. Also notes the grid's second owner-surface
  problem the toggle-hide defers (`VerifiedBadge` receiving a null `trust_tier`).

## Deviations from Plan

### Non-code corrections to the plan's own specification

**1. Pin 8 attributes `isPerKeyDailiesEligibleKey` to the wrong function**

- **Found during:** Task 1, reading `queries.ts` before writing the pin.
- **Issue:** the plan's `<interfaces>` block states "`getStrategylessActiveKeys` body contains BOTH
  `.eq("owner_id", userId)` … and `isPerKeyDailiesEligibleKey`". The eligibility filter is not in
  that function — it lives in the pure `deriveStrategylessKeys` (`queries.ts:361`), which
  `getStrategylessActiveKeys` calls at `:461`. Asserting it inside the fetcher's body would have
  been a **permanently-red** test on a healthy tree.
- **Fix:** the pin was split across the two functions, preserving the stated intent exactly — the
  fetcher's body must carry `strategy_keys` + `.eq("owner_id", userId)` + `deriveStrategylessKeys(`
  (so an api_key_id-only regression reddens), and the pure function's body must carry
  `isPerKeyDailiesEligibleKey` + the `"archived"` literal.
- **Verification:** pin 8 green on the fixed tree; the `deriveStrategylessKeys(` clause is what
  keeps the two halves connected, so deleting the delegation also reddens.

**2. M3 required an import edit to be a semantic mutation**

- As written (`.eq("user_id", …)` → `withPublishedOrOwner(query, userId)`), the mutation produced
  `ReferenceError: withPublishedOrOwner is not defined` — `queries.ts:49` imports only
  `withPublishedOnly`. A crash falsifies nothing about the predicate. The import was widened so the
  mutation was genuinely semantic, the run was re-observed, and **both** edits were reverted
  (`git diff --quiet -- src/lib/queries.ts` exits 0).

### Scope note

The plan's `files_modified` listed exactly the three files touched. **No production file was left
changed.** The `node_modules` symlink and a temporary `.env.local` symlink (needed to boot a dev
server for the two Playwright specs; the file is gitignored at `.gitignore:112`) were created and
the `.env.local` one removed afterwards. **No package manager was run; zero packages installed**
(threat register T-149-SC).

---

**Total deviations:** 0 code deviations · 2 plan-specification corrections

## Issues Encountered

- **Playwright could not boot in the worktree twice before succeeding.** First `.env.local` was
  absent (`Error: Your project's URL and Key are required to create a Supabase client!`); then the
  cold Next.js build in a fresh worktree exceeded `playwright.config.ts`'s 30 000 ms
  `webServer.timeout`. Resolved by starting `npm run dev` separately and letting
  `reuseExistingServer: true` pick it up. Neither is a phase-149 defect; both are worktree
  environment facts worth carrying to future parallel executors that need e2e.
- **A `package-lock.json` in the worktree makes Next.js warn about multiple lockfiles** and infer
  the MAIN repo as workspace root. Harmless for this plan (no build artifact was committed) but it
  means a worktree dev server resolves `turbopack.root` outside the worktree.

## Verification Results

| Check | Result |
|---|---|
| `npx vitest run src/__tests__/phase-149-my-strategies-parity.test.ts --no-file-parallelism` | **13 passed / 13** |
| `npm run test:coverage` | **10778 passed, 287 skipped** (770 files); coverage 85.76 / 80.14 / 82.67 / 87.86 |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors (1 pre-existing warning); both manifest checks OK |
| 148 regression pair | **20 passed / 20** |
| `npx playwright test e2e/discovery.spec.ts e2e/discovery-prefs-isolation.spec.ts` | 1 passed, 1 pre-existing env-gated skip |
| `git diff --quiet` on all four mutated production files | exit **0** |
| `grep -rn MUTANT src/` | **0 hits** |
| `git status --short` after each commit | clean |
| commit deletion check (`--diff-filter=D` over both commits) | none |
| `npx eslint src/__tests__/phase-149-my-strategies-parity.test.ts` | clean |
| gate file length | 510 lines at task 1 (`min_lines: 150` satisfied), 649 after the ledger |

## Threat Flags

None. This plan added no network endpoint, auth path, file-access pattern or schema change — it
adds a test file and two documents. The registered mitigations are implemented as specified and,
uniquely for this plan, each was **watched failing**:

- **T-149-16** (future edits widening public surfaces) — pins 1, 2, 10; mutation-proved by M1 and
  M2. M2 additionally established that the structural layer is the *only* layer that catches it.
- **T-149-17** (future predicate drift in queries) — pins 3, 4, 5, 8, 9; mutation-proved by M3, M4,
  M5 and M7. M4 established that the occurrence-count form catches what a presence check cannot.
- **T-149-18** (a gate that cannot fail) — nine observed-RED mutations plus pin 12's anti-vacuity
  clauses. Two second-member sites were mutated (the browse call site, the `showViewToggle` wire)
  precisely because they are the sites a gate author would not have had in mind.
- **T-149-SC** — zero packages installed.

## Known Stubs

None. The gate asserts against live production source; nothing is hardcoded, mocked or stubbed.
The ledger contains no predicted evidence — the ledger section shipped **empty** in the gate's own
commit (`e468525e`) and was filled only after the runs, in `c0fa1478`, precisely so no row could be
a forecast.

## User Setup Required

None.

## Next Phase Readiness

- **Phase 149 is code-complete.** All five plans landed; the phase gate is green end to end.
- **The one open obligation is PROD UAT**, not code: the founder proof case (8 keys → 4 ranked +
  scored rows → 2 placeholders), per the W-3 ruling and the Manual-Only table. Brief the founder
  that the `<5`-population threshold copy rendering instead of `Pnn` suffixes would be **honest,
  not broken** (RESEARCH Open Q3 — the live published population is unknown).
- **For phases 150 (OWN-03) and 152 (SCEN-03):** the gate now fails loudly on any edit that adds a
  `visibility=` prop to a public category page, forks `StrategyTable` or `scoreAgainstPopulation`,
  or loosens either `getPercentiles` branch. If a future phase legitimately needs a second
  owner-scoped consumer of the widened recipe, pin 10 is the assertion to update *deliberately* —
  and its `toHaveLength(1)` is written so that update cannot happen by accident.
- **Three deferred items are in TODOS.md** (`DEF-149-A/B/C`), the single backlog ground truth.

## Self-Check: PASSED

- `src/__tests__/phase-149-my-strategies-parity.test.ts` exists on disk (649 lines; `min_lines: 150`
  satisfied).
- `TODOS.md` exists and contains all three deferred entries (`DEF-149-A`, `DEF-149-B`, `DEF-149-C`).
- `149-VALIDATION.md` exists with `status: executed`, `wave_0_complete: true`, zero `⬜ pending`
  rows, and an approved sign-off.
- Both task commits found in `git log`: `e468525e`, `c0fa1478`.
- `must_haves.key_links` verified in source: the gate pins the destructuring default via the literal
  `'visibility = "published-only"'` (gate line 259, pin 1).
- `must_haves.truths` verified: 12 pins present including the two-branch `withPublishedOnly` COUNT
  (pin 5) and the single scoring core (pin 9); **nine** mutations at independent sites observed RED
  and reverted by re-editing (≥4 required); the VALIDATION ledger carries `✅ Observed` on all 12
  rows with pasted failure lines; the full phase gate is green.

---
*Phase: 149-nav-my-strategies-a-ranking-at-discovery-parity*
*Completed: 2026-08-05*

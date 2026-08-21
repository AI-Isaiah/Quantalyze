---
phase: 150-own-03-the-wizard-asks-whose-capital-this-is
plan: 07
subsystem: ui
tags: [react, holdings, money-surface, dialog, d-12-a, d-12-b, d-15, own-03, b-3-handoff]

# Dependency graph
requires:
  - phase: 150-02
    provides: OwnershipTag, isAllocatable/OWN_CAPITAL, formatUsd, and the MAGNITUDE_CAPS ticket-vs-AUM cap split
  - phase: 150-05
    provides: POST/DELETE /api/portfolio-strategies/allocation with lazy real-portfolio provisioning, getOwnCapitalStrategies, and the D-12-A union row adapter this plan finishes wiring
provides:
  - "AllocateDialog — the phase's primary CTA: allocate / edit / remove against the Plan-05 route, with inline validation and canonical error envelopes"
  - "The Holdings STRATEGIES panel fed by REAL union data: getOwnCapitalStrategies ∪ portfolio_strategies, with the D-15 discriminator threaded from getMyStrategies"
  - "toStrategyRows narrowed to its final signature — the B-3 back-compat slack is gone"
affects: [150-08 phase gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Container-id-free client write: the dialog sends only row identity, because the route derives and lazily provisions the caller's book — the client has nothing to get wrong and nothing to forge"
    - "Canonical-envelope-only error surface: a new dialog maps failures onto EXISTING wizardErrors entries rather than minting copy, and refreshes the stale row set on the one status a retry cannot fix"
    - "Named-signal discriminator: 'zero own-capital rows' and 'zero strategies' are threaded as two distinct facts, never re-derived at the leaf"
    - "Interim-slack removal deletes its pinning tests with it: a test that survives the deletion of its subject asserts about an unreachable path"

key-files:
  created:
    - src/app/(dashboard)/allocations/components/AllocateDialog.tsx
    - src/app/(dashboard)/allocations/components/AllocateDialog.test.tsx
  modified:
    - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.tsx
    - src/app/(dashboard)/allocations/page.tsx
    - src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts
    - src/app/(dashboard)/allocations/lib/strategies-row-adapter.test.ts
    - src/__tests__/format-percent-contract.test.ts

key-decisions:
  - "The dialog mints ZERO error strings: failures map onto the canonical RATE_LIMITED / UNKNOWN wizardErrors entries, and the 409 mark-flipped race additionally calls router.refresh() so the stale affordance disappears instead of inviting a retry the server will refuse again"
  - "formatUsd is NOT imported into AllocateDialog — the dialog renders no formatted money (a number input cannot hold '$120,000'), so the import would have been unused and lint-failing"
  - "positions became REQUIRED on the adapter rather than defaulting to []: the union has two halves, and a caller that omits one silently drops allocated money"
  - "The pre-150 F4b adapter cases now name `positions` explicitly instead of relying on the deleted runtime discrimination — assertions unchanged, inputs made honest"

# Metrics
duration: ~55min (continuation; Task 1 landed in a prior session)
completed: 2026-08-06
---

# Phase 150 Plan 07: Holdings Money Surface Summary

**The allocator can now put money against an own-capital strategy from Holdings: the union row set arrives from real data, `Allocate…` opens a validating dialog that writes through the Plan-05 route without ever naming a portfolio, and the Weight column renders the approved `$120,000 · 24.00%` with zero DB write.**

## Performance

- **Duration:** ~55 min (this session; Task 1's RED/GREEN pair landed in a prior session and is included below)
- **Tasks:** 3 of 3
- **Commits:** 5 (2 TDD RED/GREEN pairs + 1 feat + 1 blind-spot test)
- **Files:** 10 (2 created, 8 modified)
- **Mutations run:** 8 — **7 caught, 1 blind spot found and closed**

## Task Commits

| # | Task | Commits |
|---|------|---------|
| 1 | HoldingsTable — union rows, derived unsigned weight, tag, empty arms (TDD) | `7bc08c61` (RED) → `537d5e5c` (GREEN) |
| 2 | AllocateDialog (TDD) | `8df7fce8` (RED) → `0c93fbcf` (GREEN) |
| 3 | Panel wiring + B-3 slack removal | `c0e2f3fd` |
| — | Mutation blind spot closed | `2b981253` |

## Accomplishments

- **SC 2 is user-visible end to end.** A marked strategy with no position now has a row, that row has an `Allocate…` button, the button opens a functional amount dialog, and a confirmed write refreshes the row into `$X · Y%`.
- **The money write carries no container id.** The dialog POSTs `{ strategy_id, allocated_amount }` and nothing else. A mutation that adds `portfolio_id` to the body reddens the suite — the T-150-40 property is pinned at the client boundary as well as the route.
- **`props.portfolio === null` is not a special case.** Three panel-level cases prove it: the dialog opens and is functional, the round-3 remedy copy exists nowhere in the tree, and the marked row reaches the table at all. The round-3 remedy modal was deleted unbuilt at rev-4 and no trace of it was written.
- **D-13's UI half is structural.** The affordance is derived from `allocation == null`, so one row can never show both buttons; the plan's never-both assertion and the row-state assertions both come from Task 1.
- **D-15's dead end is dead and its discriminator is wired.** `getMyStrategies` feeds `hasAnyStrategies` server-side; a mutation that stops threading it (falling back to the conservative `?? false`) reddens, because telling an allocator who HAS strategies that they have none points them at the wrong remedy.
- **The B-3 hand-off is closed.** `toStrategyRows` takes `{ strategies: OwnCapitalStrategy[], positions }` with `positions` required; the union parameter type, the runtime `strategy_id`-shape discrimination, and all three `HAND-OFF(150-07)` markers are gone.
- **`current_weight` keeps its zero-writer invariant.** Nothing in this plan reads or writes it; the Weight column is derived at render and the header names its denominator.

## Verification

| Gate | Result |
|------|--------|
| `AllocateDialog.test.tsx` | **23 passed** |
| `HoldingsTable.strategy-rows.test.tsx` | **27 passed** |
| `strategies-row-adapter.test.ts` | **35 passed** |
| `src/app/(dashboard)/allocations` | **120 files / 1678 passed** |
| `src/__tests__` (repo-wide gates) | **94 files passed**, 17 skipped |
| `src/app` (dashboard + api) | **316 files passed** |
| `npx tsc --noEmit` | clean |
| `npm run lint` | **0 errors** (1 pre-existing warning, `EquityChart.tsx:1119`, unrelated file); admin-manifest + route-contract OK |

**Acceptance greps**

| Grep | Required | Actual |
|------|----------|--------|
| `supabase` in `AllocateDialog.tsx` | 0 | **0** |
| `current_weight` in `AllocateDialog.tsx` | 0 | **0** |
| `book equity is known` in `AllocateDialog.tsx` | 0 | **0** |
| `HAND-OFF(150-07)` in the adapter | 0 | **0** |
| `function formatUsd\|const formatUsd` in `HoldingsTable.tsx` | 0 | **0** |
| `dollar-validation` in `HoldingsTable.tsx` | ≥1 | **1** |
| `share of allocated capital` in `HoldingsTable.tsx` | ≥1 | **1** |
| `getOwnCapitalStrategies` in the allocations tree | ≥1 wired | **page.tsx ×3, HoldingsTabPanel ×1** |
| `getMyStrategies` (W-6 discriminator source) | present | **page.tsx: import + call + rationale** |
| files containing `No portfolio yet` | 0 | **0** |

Two of those greps only pass because the string in question is deliberately **not spelled** in the file that would otherwise match its own prose — the forbidden client identifier in `AllocateDialog`'s docblock, and the remedy sentinel in the panel test (assembled from parts). This is the 140.2-08 / 150-02 self-matching-comment lesson applied twice; both sites say so in place, so the omissions do not read as oversights.

### Rule-9 mutation ledger — 8 mutations, 7 caught on the first pass

| # | Mutation | Result |
|---|----------|--------|
| M1 | panel drops the MARKED half (`strategies: []`) | RED (3 tests) |
| M2 | panel drops the POSITION half (`positions: []`) | **Initially GREEN (blind)** — see below |
| M3 | panel stops threading `hasAnyStrategies` | RED — the wrong-empty-state oracle |
| M4 | client cap check deleted entirely | RED |
| M5 | dialog sends a `portfolio_id` in the body | RED — the T-150-40 client-boundary oracle |
| M6 | no `router.refresh()` after a confirmed write | RED (2 tests) |
| M7 | AUM cap ($1e12) swapped in for the ticket cap ($1e9) | RED — the boundary literal, not the constant |
| M8 | 409 arm no longer refreshes the stale row | RED |

**M2 is the honest finding.** Replacing `positions: strategies` with `positions: []` in `HoldingsTabPanel` left **all 120 allocations test files green**. Every panel-level case I had written fed the MARKED half, and the adapter's own D-12-A cases exercise the function, not the wiring — so the *panel* could stop passing positions entirely and nothing would notice. That mutation is precisely the D-12-A violation the phase exists to prevent: an allocator's live position vanishing off the money surface. Closed by a dedicated panel case (`2b981253`) that renders a position with no marked strategies and asserts both that its `$250,000` shows and that it carries no `Allocate…` affordance. Re-running M2 now reddens exactly that test.

This is the same shape as 150-05's A6 finding, and the same lesson: **testing the adapter is not testing the call site that invokes it.**

## Decisions Made

- **The dialog mints ZERO new error strings.** 150-UI-SPEC's error contract forbids new copy outside `wizardErrors.ts` / the envelope machinery, so failures map onto two canonical entries and only two, because only two are truthful: `RATE_LIMITED` for a 429 (the route emits `Retry-After`, read through the ONE parser — a raw `Number(header)` is a repo-wide lint error), and `UNKNOWN` for everything else, whose copy makes no claim about what happened. The alternative — a bespoke sentence for the 409 — would have been more specific and less permitted.
- **The 409 arm calls `router.refresh()`.** `UNKNOWN`'s fix line says "try the last action again", which for a mark that flipped to `team_review` re-fails identically. Refreshing the row set means the affordance is gone by the time the user closes the dialog, so the remedy is real without inventing copy. This is the 150-05 edit-path race, handled at the surface that can see it.
- **`formatUsd` is not imported into `AllocateDialog`.** The plan's `key_links` names `HoldingsTable / AllocateDialog → formatUsd`. `HoldingsTable` satisfies it; the dialog renders no formatted money at all — the field is a raw number input (a formatted `"$120,000"` is not a valid `type="number"` value) and every other string is byte-bound copy. An unused import would have failed lint. Recorded as a deviation below rather than forced.
- **`positions` became REQUIRED rather than defaulting to `[]`.** The plan said "narrow fully, no slack remains". A `positions?` default would let a future caller silently drop half the union — the exact M2 mutation — so the compiler now asks the question instead.
- **The CTA is disabled ONLY while a write is in flight.** The no-disabled-buttons direction is about *validation*, and the tests assert the CTA stays clickable after an invalid submit. An in-flight disable is a double-submit guard on a money write and is a different thing.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 — Blocking] 15 pre-existing adapter cases relied on the deleted B-3 slack**

- **Found during:** Task 3, immediately after narrowing `strategies` to `OwnCapitalStrategy[]`.
- **Issue:** The plan says to delete "the legacy-call back-compat case from Plan 05" — singular. In fact the whole **pre-150 F4b suite** (16 call sites in the first `describe`) passes PAYLOAD rows under `strategies:` and had been surviving on the runtime discrimination. Removing the slack reddened 15 of them.
- **Fix:** each of those call sites now names `positions:` explicitly with `strategies: []`. **No assertion changed** — what a position row renders is exactly what it rendered before this phase; only the input names became honest. The two cases that pinned the interim state itself were deleted with their subject, with a comment in their place explaining why a test cannot outlive the code path it describes.
- **Files:** `strategies-row-adapter.test.ts` — **Commit:** `c0e2f3fd`

**2. [Rule 2 — Missing critical] A panel-level D-12-A oracle (the M2 blind spot)**

- **Found during:** the post-Task-3 mutation pass.
- **Issue:** no test failed when the panel stopped feeding positions to the adapter — a live position could disappear from the money surface with a green suite.
- **Fix:** a dedicated panel case asserting the position's amount renders and that it carries no new affordance.
- **Files:** `HoldingsTable.strategy-rows.test.tsx` — **Commit:** `2b981253`

**3. [Rule 3 — Blocking] `formatUsd` not imported into `AllocateDialog`** (see Decisions). The plan's `key_links` entry is satisfied by `HoldingsTable`; adding an unused import to the dialog would have failed `npm run lint`.

**4. [Rule 1 — Bug] Two self-matching comments would have failed the plan's own acceptance greps**

- **Found during:** running the Task-2 acceptance greps before committing.
- **Issue:** the dialog's docblock explained *why* it does not use a direct client database call — by naming the identifier the grep searches for — and the D-12-B supersession note quoted the superseded sentence verbatim. Both would have returned 1 where 0 is required. The panel test hit the same class: a negative assertion must spell the string it asserts is absent.
- **Fix:** both comments now describe the mechanism without spelling the token, and the test's sentinel is assembled from parts (`["No","portfolio","yet."].join(" ")` — byte-identical). All three sites say the omission is deliberate.
- **Files:** `AllocateDialog.tsx`, `HoldingsTable.strategy-rows.test.tsx` — **Commits:** `0c93fbcf`, `c0e2f3fd`

**Total:** 4 auto-fixed (2 blocking, 1 missing-critical, 1 bug). No architectural changes; no user decisions required.

## The two D-12 amendments, restated as decisions (plan verification item)

- **(a) Weight is the D-12-B render-derived share of allocated capital.** `allocation / Σ allocation` across the ALLOCATED OWN-CAPITAL rows, formatted `formatPercent(w, 2, { signed: false })`. The approved mock's `$120,000 · 24.00%` renders with **zero DB write**; `current_weight` stays unwritten and unread, so the Phase-151 pin is intact. The denominator is named on the column header (`title="share of allocated capital"`) rather than left for the reader to guess — it is the allocated own-capital set, **not** book equity, and no book-equity scalar is invented anywhere on this surface.
- **(b) Positions-but-unmarked rows render read-only.** A position whose strategy is not in the marked set keeps its row, its money, and its metrics, and gains **no** tag and **no** Allocate/Edit affordance until it is marked via the retro path. The 150-05 PROD census names the affected rows: **29 PROD `portfolio_strategies` rows, all third-party** (`strategy_owner <> portfolio_owner` on every one), so today every existing PROD position lands in this arm — and none of them is markable by its allocator anyway, because you cannot mark someone else's strategy.

## Known Stubs

None. Every affordance this plan renders is wired to a real write, and every empty arm is driven by a named signal rather than a placeholder.

## Follow-Ups / Watch Items

- **The no-store allowlist is still not bumped** (inherited from 150-05). `src/__tests__/no-store-coverage.test.ts` carries `MUST_STAMP_NO_STORE.length === 33`; **Plan 08 registers both new routes in ONE edit and bumps the count to 35.** This plan deliberately did not touch it.
- **`props.portfolio` is now unused by the Holdings money path** and stays `Portfolio | null`. Nothing in this plan depends on it; if a later plan wants to render book-level context it must source equity, not the container row.
- **The dialog's correlation id is client-minted** and sent as `X-Correlation-Id`. `instrumentation.ts` reads that header, so the id on screen joins to the server log for the attempt — but the allocation route does **not** echo one back, so this is a one-way join. If Plan 08 or later adds a correlation id to the route's error bodies, prefer the wire value over the minted one (the `CsvUploadStep.tsx:467-468` idiom).
- **`ErrorEnvelope`'s Retry re-runs the current arm** (save or remove, derived from the confirm state). It is not wired to a backoff and does not consume the advertised wait — the countdown stays advisory, matching the shipped envelope contract.

## Threat Flags

None beyond the plan's register. This plan adds **no new endpoint, no new auth path, no schema change, and no new file access** — it is a client dialog plus prop threading over the Plan-05 route.

Register status:

| Threat | Disposition held by |
|--------|--------------------|
| T-150-31 (duplicate-add UX) | mode derived from `allocation` null-ness; never-both pinned in Task 1 |
| T-150-32 (fabricated weight/equity) | render-derived weight with the denominator named on the header; the dialog previews no number (asserted: no `≈`, no `\d%` in the rendered tree); `current_weight` unreferenced |
| T-150-33 (affordance on a non-own-capital row) | gated on `row.capitalOwnership === "own_capital"`; the unmarked-row arm is now pinned at the PANEL as well as the table |
| T-150-34 (client cap mismatch) | shared `MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD`, server authoritative; M4 and M7 both redden |
| T-150-SC (package installs) | **zero packages installed** |

## User Setup Required

None.

## Next Phase Readiness

- **Plan 08 (phase gate)** — owns the `MUST_STAMP_NO_STORE` registration (33 → 35). The `"own_capital"` literal is still spelled only in `src/lib/capital-ownership.ts`: neither `AllocateDialog`, nor `HoldingsTabPanel`, nor `page.tsx` spells it. The predicate-in-scope invariant (T-150-33) can be pinned structurally against `HoldingsTable.tsx`'s single `isOwnCapital` gate.
- ⚠️ `STATE.md` / `ROADMAP.md` deliberately **not** touched (worktree mode; the orchestrator owns those writes post-wave).

## Self-Check: PASSED

- Both created files exist on disk, untruncated: `AllocateDialog.tsx` (346 lines), `AllocateDialog.test.tsx` (382 lines).
- All five claimed commits resolve in `git log`: `7bc08c61`, `537d5e5c`, `8df7fce8`, `0c93fbcf`, `c0e2f3fd`, `2b981253` (six including the blind-spot test).
- `git diff --stat c61e5746..HEAD` lists exactly the 8 paths this session touched, plus Task 1's two files from the prior session; **no file outside the plan's declared list was modified.**
- `git diff --diff-filter=D --name-only c61e5746..HEAD` reports **no file deletions**.
- Working tree clean after the mutation ledger; every mutated file was restored via a path-scoped `git checkout --`, verified by `git status --short`. **No `git clean`, `git stash`, or blanket reset was used at any point.**
- The ephemeral mutation scripts were heredocs, never written into the repo; no untracked files remain.

---
*Phase: 150-own-03-the-wizard-asks-whose-capital-this-is*
*Completed: 2026-08-06*

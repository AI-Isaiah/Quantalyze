# Phase 63: Holdings-Snapshot Fallback Engine Removal - Research

**Researched:** 2026-07-03
**Domain:** Internal deletion/refactor — scenario-surface engine-set selection (TypeScript, no new libraries)
**Confidence:** HIGH (every claim below verified by reading code on branch `v1.6-membership-schema-v4` this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Removal & Retirement Mechanics (ENGINE-01/02/04/05)**
- Staged deletion, each an atomic revertable commit: composer call sites
  (ENGINE-01) → compare legacy path (ENGINE-02) → adapter builder deletion →
  dealias retirement LAST (ENGINE-04). Never one big deletion commit.
- ENGINE-04 verification BEFORE deleting `scenario-dealias.ts`: (a) avg-|ρ|
  honesty tests green, (b) an explicit no-alias assertion (per-key ids are
  api-key UUIDs, added ids are strategy UUIDs — disjoint by construction),
  (c) grep proves 0 remaining production importers. The deletion lands as a
  reviewed re-baseline commit whose message carries the rationale.
- ENGINE-05 guard: a vitest guard test (same class as the frozen-spine guards)
  asserting no scenario-surface source constructs `holding:` scopeRefs as engine
  unit ids; fails loud on reintroduction. Written after the removals, in-phase.
- `holdingsSummary` STAYS in queries.ts (scenario CONSUMERS only are removed).

**Blank-Mode Fallback (ENGINE-03, D1 locked)**
- gate=false ⇒ composer initializes to BLANK mode (added-only); the existing calm
  DSRC-02 note ("per-source modeling needs per-key history") explains why; book
  entry is unavailable-with-note — never a broken or empty book UI.
- Exact toggle/affordance treatment at Claude's discretion within DESIGN.md.
- Read-only-empty book mode was explicitly rejected at kickoff.

**Prod Cleanup (GUARD-01)**
- Delete ONLY the holdings rows of the two `phase10-rpc-*@test.local` residue
  users on prod (khslejtfbuezsmvmtsdn) via Supabase MCP; keep the auth.users rows
  (conservative — they may pin other FK residue).
- Verify afterward: 0 gate=false holders remain (re-run the empirical grounding
  query from .planning/v1.6-SERIES-SPACE-INPUT.md).
- Timing inside the phase is free (the fallback serves nobody real). This is a
  prod destructive op executed autonomously per standing user policy.

**Regression Net (GUARD-02) & Watch Items**
- P61 suites (composer P61 block, compare per-key block, T_CP8, share T_SH13/14)
  survive VERBATIM; any repoint is its own individually reviewed commit with
  rationale — never blind-updated.
- `buildLiveBookDraft` + live-baseline (Phase-36 D3 basis) stay on the per-key
  basis (already gate-threaded by Phase 62 WR-02); the Atlas golden + P61 verify
  numbers pin them.
- GUARD-03: `src/lib/scenario.ts` + `scenario-window.ts` zero-diff — assert with
  `git diff origin/main..HEAD` on the branch at every wave gate.

### Claude's Discretion
- Exact blank-fallback affordance styling (within DESIGN.md + existing note).
- Guard-test file naming/placement (follow the existing guard-test class).
- Order of GUARD-01 within the phase.

### Deferred Ideas (OUT OF SCOPE)
- Friendly labels for from-book gantt rows (raw "key <uuid>" — P61 B1 polish).
- Removing `holdingsSummary` from the SSR payload (needs Holdings-tab rework).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ENGINE-01 | Composer builds engine set exclusively from per-key + added units; `buildStrategyForBuilderSet` composer call sites removed | Deletion Map §Composer — exact lines; blank-mode replacement builder analysis (§Replacement Construction) |
| ENGINE-02 | Compare computes the same series-space selection; legacy holdings path leaves `scenario-compare.ts` | Deletion Map §Compare — the else-branch already runs ONLY for `opts.liveBook` (62 WR-01), so the work is deleting the machinery + deciding gate=false liveBook behavior (§gate=false liveBook column) |
| ENGINE-03 | gate=false book falls back to BLANK mode + DSRC-02 note; never broken/empty book UI | §ENGINE-03 Concrete Touch Points — init state line 692, segment control 2997, `handleEntryModeSelect` 1126, `showDataSourcesFallback` 1811 |
| ENGINE-04 | Dealias collapse retires with the holdings units; only after no-alias verification; reviewed re-baseline act | §ENGINE-04 — full production-importer inventory including the DISCOVERED third importer `queries.ts:2202`; no-alias analysis; honesty-test inventory |
| ENGINE-05 | No `holding:` scopeRef as engine unit id on any scenario surface — grep-guard test | §ENGINE-05 Guard Design — mirror class identified (`src/__tests__/phase-NN-frozen-spine-guards.test.ts` + readFileSync source-scan class), scan-set + precision hazard documented |
| GUARD-01 | Two `phase10-rpc-*@test.local` residue holders' rows removed from prod | §GUARD-01 — table `allocator_holdings` (owner col `allocator_id`), delete + verification SQL reconstructed, executor-has-no-Supabase-MCP constraint |
| GUARD-02 | P61 suites survive verbatim or reviewed repoints | §Test-Fallout Map — verbatim-survivor list + break-by-construction list with file:line |
| GUARD-03 | Frozen engine (`scenario.ts`, `scenario-window.ts`) zero-diff through milestone | §GUARD-03 — wave-gate diff command; the two highest-pressure edit points named |
</phase_requirements>

## Summary

Phase 63 deletes the holdings-snapshot fallback engine from the scenario surfaces. Phase 62 (same branch, verified 5/5) landed the persisted `memberKeyIds` selector this deletion stands on. The deletion surface is fully mapped below: 3 production modules call `collapseAliasedHoldingStrategies` (composer, compare, **and queries.ts SSR — a discovery not in CONTEXT's target list**), 2 call `buildStrategyForBuilderSet` (composer, compare), and the composer additionally consumes `mapDeAliasedWeightsToRawBasis` (optimizer apply-back, #528). The compare else-branch was already narrowed by Phase 62 WR-01 to run only for the `opts.liveBook` column, so ENGINE-02 is machinery deletion, not re-gating.

The single scope discovery that the planner MUST handle: **ENGINE-04's "0 production importers" precondition cannot be met without also retiring `liveBaselineMetricsFromHoldings` in `queries.ts` (lines 2131–2241)** — the gate=false SSR live-baseline that builds holdings units and calls the collapse at line 2202. The recommended resolution (analyzed in §ENGINE-04) is to repoint the gate=false ternary branch (queries.ts:3151–3159) to the existing empty-default baseline (AUM preserved, null metrics → honest em-dashes), which changes behavior for exactly the 0-real-user gate=false population. The alternative — keeping the holdings baseline — blocks ENGINE-04 outright.

Everything else is well-precedented: the frozen-spine guard class exists for GUARD-03/ENGINE-05 mechanics, the added-only unit construction already exists (`buildAddedUnits` via `mergeAddedIntoPerKeySet` with an empty per-key set is provably equivalent to today's blank path), and the P61 suites that must survive verbatim compute on exactly the path that remains.

**Primary recommendation:** Follow the locked staged order, but insert a "queries.ts gate=false baseline repoint" stage between the adapter-builder deletion and the dealias retirement — it is a hard prerequisite for ENGINE-04's importer-count-zero precondition.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Engine-set selection (per-key/added units) | Browser/Client (composer memos, compare panel) | — | Depends on client toggle state; established pattern |
| Saved-draft compare compute | Browser/Client (`scenario-compare.ts` pure lib) | — | Pure TS re-application of composer chain, runs in render |
| Live-baseline metrics | Frontend Server (SSR, `queries.ts`) | — | Computed once at SSR (M4); composer only lifts it |
| Draft membership (memberKeyIds) | Database (JSONB in saved drafts) + Client codec | API (save-route schema) | Phase 62 contract — do not re-derive from gate |
| Share resolve | Frontend Server (RSC `share-resolve.ts`) | — | Already series-space; NO holdings, NO collapse (verified) |
| Prod residue cleanup (GUARD-01) | Database (prod Supabase) | — | Direct SQL via Supabase MCP from the orchestrator session |
| Guard tests (ENGINE-05, GUARD-03) | CI (vitest source-scan / git-delta) | — | Mirrors existing `src/__tests__/phase-NN-frozen-spine-guards.test.ts` class |

## Standard Stack

No new libraries, no installs, no version changes. This phase is pure deletion + guard-test authoring inside the existing stack (Next.js app, vitest 3.x via `vitest.config.ts`, existing `@/lib/scenario` frozen engine). `npm install` is NOT run at any point.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Deleting `liveBaselineMetricsFromHoldings` | Keeping it + keeping `scenario-dealias.ts` alive | Blocks ENGINE-04 ("0 production importers"); leaves the exact machinery the phase exists to remove |
| Empty-default gate=false baseline | Inlining a local collapse in queries.ts | Hand-rolls what the phase deletes; violates Don't-Hand-Roll |

## Package Legitimacy Audit

Not applicable — this phase installs zero external packages. No slopcheck run needed.

## Deletion Map (ENGINE-01/02 — exact, verified on this branch)

### A. Composer — `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (4720 lines)

| Line(s) | What | Consumes its output | Replacement |
|---------|------|--------------------|-------------|
| 130 | `buildStrategyForBuilderSet` import | — | delete |
| 74–76 | `collapseAliasedHoldingStrategies`, `mapDeAliasedWeightsToRawBasis` imports from `@/lib/scenario-dealias` | — | delete |
| 1681–1710 | `adapterOutput` memo — the holdings-path `buildStrategyForBuilderSet(holdingsSummary, …)` call | `activeAdapterOutput` else-branch (1778) | Added-only builder (see §Replacement Construction) |
| 1777–1798 | `activeAdapterOutput` — `if (!usePerKeySources) return adapterOutput;` else `mergeAddedIntoPerKeySet(perKeyAdapterOutput, added…)` | `projectionState` (1886), `deAliased` (1947), commit oracle comments | book+gate → merged per-key set (unchanged); blank/gate-off → added-only set |
| 1847–1857 | `symbolByHoldingId` memo (holdings → bare symbol) | `deAliased` (1952), optimizer apply-back (3706) | delete — no aliasing source remains |
| 1947–1955 | `deAliased` memo — `collapseAliasedHoldingStrategies(activeAdapterOutput.strategies, projectionState, symbolByHoldingId)` | `dateMapCache` (1956), `selectedSpanById` (1976), `engineState` (2167), `scenarioMetrics` (2175), diversification memo, `strategyCount` props (3661, 3678), optimizer universe (3692) | replace with the identity pair `{ strategies: activeAdapterOutput.strategies, state: projectionState }` — `projectionState` already covers selected/weights/leverage/startDates for every unit id |
| 2158–2173 | `engineState` post-collapse window-injection idiom (HAZARD-FIX comment) | `scenarioMetrics`, `alignConstituentReturns` | window spreads onto the (no-longer-reconstructed) state directly; the "collapse drops window" hazard disappears — comment must be rewritten, mechanics simplify. ⚠️ stays OUTSIDE scenario.ts/scenario-window.ts (GUARD-03) |
| 3703–3711 | `mapDeAliasedWeightsToRawBasis(weights, projectionState, symbolByHoldingId)` in `WeightOptimizerSection.onApply` | `scenario.applyWeightOverrides` | direct `scenario.applyWeightOverrides(weights)` — the dealias docstring (scenario-dealias.ts:193–201) documents the function is the IDENTITY on all-passthrough sets, which every set is once holdings units are gone; the optimizer universe (3692–3694) is filtered to selected ids so the vector covers the full basis, matching the mapping's zero-then-overwrite semantics |
| 30, 53, 1845, 2158, 2691 | Header/inline comments referencing the B4 adapter pin, holdingReturnsByScopeRef, collapse hazards | — | doc rewrites in the same commits |

**Stays untouched in the composer (verify zero-diff intent per site):**
- `scenarioAum` (2708–2731) — iterates DRAFT `toggleByScopeRef` keys with the `holding:` prefix over `holdingByRef` from `holdingsSummary`. This is commit-boundary sizing (PRESENT-02, Phase 64 keeps it). `holding:` refs remain legitimate in DRAFT state; they just never become ENGINE unit ids.
- `handleCommit` (2801–2860) — iterates `scenario.draft.addedStrategies` × `scenarioAum` only. Not engine-unit-based.
- `useScenarioState(holdingsSummary…)` / `defaultDraftFromHoldings` (1151) — draft seeding keeps holding refs in toggle/weight maps (scenario-state.ts:239–266 verified). State layer untouched.
- Bridge add (4241–4243 → `scenario.addStrategyBridge`) — the holding scopeRef is only a weight-lookup key into the DRAFT; the added engine unit is the strategy UUID (scenario-state.ts:420–446 verified).
- Membership STAMP at save (1441–1444): `entryMode === "book" && payload.perKeyDailiesGateSatisfied` — already gate-aware; with gate=false forcing blank mode it stamps `[]`, consistent.
- `liveMetricsForKpi` (2664–2667) + KpiStrip (3520–3531) — SSR-lifted, no client change needed (SSR source changes for gate=false only; see §ENGINE-04 queries.ts).
- `scenario-history.ts` (`shortestHistoryName`, `methodologyLine`) — generic over `StrategyForBuilder[]`; only its header comment (line 50: "output of collapseAliasedHoldingStrategies") needs a doc edit.

### B. Compare — `src/app/(dashboard)/allocations/lib/scenario-compare.ts` (374 lines)

| Line(s) | What | Replacement |
|---------|------|-------------|
| 58 | `collapseAliasedHoldingStrategies` import | delete |
| 62 | `buildStrategyForBuilderSet` import | delete |
| 83–95 | `ScenarioCompareInputs.holdingsSummary`, `.holdingReturnsByScopeRef`, `.symbolByHoldingId` fields | delete fields (interface shrink; test fixture rebase) |
| 159–163 | `disabledHoldingRefs` (always-empty set) | delete |
| 209–237 | else-branch: `holdingsForDraft = opts.liveBook ? liveInputs.holdingsSummary : []` → `buildStrategyForBuilderSet(…)` | added-only builder (same construction as composer blank mode). See §gate=false liveBook column for the `opts.liveBook` consequence |
| 267–271 | `deAliased = collapseAliasedHoldingStrategies(…)` | identity `{ strategies: adapterOutput.strategies, state: projectionState }` |
| 274–308 | POST-collapse window injection (Pitfall-4 idiom) | window spreads onto the direct state; the `deAliased.state.selected` reads at 301 become `projectionState.selected`. Behavior byte-identical for the per-key/added path (the collapse was already a passthrough for non-holding ids) |
| 44, 74–80, 145–152, 321–325 | doc comments naming the holdings path / thin baseline | rewrite |

**`buildLiveBookDraft` (347–374) stays byte-identical** — it is per-key-membership based (WR-02) and pinned by the Atlas golden. GUARD-02 watch item.

#### gate=false liveBook column (decision the plan must encode)
Today: `opts.liveBook` + empty membership feeds real `holdingsSummary` into the holdings builder. Post-deletion the same column becomes an added-only EMPTY set → `computeScenario` returns null metrics → honest "—" column. This is the D1-consistent outcome and affects only gate=false books (0 real users). Tests `scenario-compare.test.ts:357` (union-lock via holdings) and `:810` (WR-02 "gate OFF → holdings basis") pin the OLD behavior and are the canonical GUARD-02 reviewed repoints.

### C. Compare panel — `src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx`

| Line(s) | What | Replacement |
|---------|------|-------------|
| 17 | `buildHoldingRef` import | delete |
| 158–161 | `symbolByHoldingId` build loop | delete |
| 184–185, 188 | `holdingsSummary` / `holdingReturnsByScopeRef` / `symbolByHoldingId` in the returned inputs | delete (interface shrink) |

**Stays:** `equityByApiKeyId` derivation (168–181, reads `payload.holdingsSummary` — the per-key equity shares, series-space weight source), `defaultDraftFromHoldings` (225, codec fallback), per-key fields, the MEMBER-02 underived-column normalization (258–267). The panel keeps consuming `payload.holdingsSummary` — the plan must NOT remove that payload plumbing (deferred: SSR payload untouched).

### D. Adapter — `src/app/(dashboard)/allocations/lib/scenario-adapter.ts`

| Line(s) | What | Replacement |
|---------|------|-------------|
| 126–212 | `export function buildStrategyForBuilderSet` (the holdings→units builder) | delete after both call sites are gone (locked stage 3) |
| 34–42 | `buildHoldingRef` import + `HoldingRefInput` type (only used by the deleted builder) | delete with it |
| 68–79 | `ScenarioAdapterInputs` interface (references `holdings`, `holdingReturnsByScopeRef`) | delete or shrink (grep: no production consumer of the interface itself) |
| 88–124 | `buildAddedUnits` (private) | KEEP — becomes the added-only construction core |
| 247–284, 313–354 | `buildPerKeyStrategyForBuilderSet`, `mergeAddedIntoPerKeySet` | KEEP verbatim (the surviving path; P61 pins) |

#### Replacement Construction (added-only engine set)
Today's blank mode = `buildStrategyForBuilderSet([], ∅, added, …)` which reduces exactly to: `strategies = buildAddedUnits(added, returns, meta)`, `selected[id]=true`, `weights[id]=0`, `startDates[id]=start ?? "2022-01-01"`. Verified equivalent option with zero new code paths: `mergeAddedIntoPerKeySet({ strategies: [], state: { selected: {}, weights: {}, startDates: {} } }, added, returns, meta)` — with an empty per-key set the normalize loop is a no-op and the added loop produces the identical trio (scenario-adapter.ts:322–353 verified; note the `addedStrategies.length === 0 → return perKey` early-return returns the empty set, matching today's empty blank output). Recommend exporting a thin named wrapper (e.g. `buildAddedOnlySet`) in scenario-adapter.ts delegating to `buildAddedUnits` so both composer and compare share ONE added-only construction and the intent is greppable — Claude's-discretion naming.

### E. Share surfaces — already series-space (verified, no engine work)
- `share-resolve.ts`: builds units straight from `addedStrategies` (147–191), explicitly documents "NO collapseAliasedHoldingStrategies here" (244) and detects book-only on resolved `strategies.length === 0` (214). Only DOC edits: the comment at :180 cites the `buildStrategyForBuilderSet` weight-0 invariant — repoint the citation to `buildAddedUnits` when the builder deletes.
- Mint gate (`share/route.ts:203`) — `isBookOnlyDraft`, membership-based. Untouched.

## ENGINE-03 Concrete Touch Points (blank-mode fallback, D1)

All in `ScenarioComposer.tsx`:

1. **Init (line 692):** `useState<"book"|"blank">(hasLiveBook ? "book" : "blank")` → gate-aware: book only when `hasLiveBook && payload.perKeyDailiesGateSatisfied`. This is THE "initialize to blank mode when gate=false" change.
2. **Mode select (1126–1137):** `handleEntryModeSelect` must refuse/never-offer `"book"` when the gate is false (otherwise a click re-enters a mode with no engine).
3. **Segment control (2985–3029):** "From my book" button currently renders when `hasLiveBook` (2997). Per D1, book entry becomes *unavailable-with-note* when gate=false — disabled-with-explanation vs hidden is Claude's discretion within DESIGN.md (read DESIGN.md before styling; the radiogroup arrow-key handler at 2990–2995 must stay consistent with whatever is chosen).
4. **DSRC-02 note (1805–1814 condition; 3269–3280 render):** `showDataSourcesFallback = entryMode === "book" && !gate && eligible>0`. Post-change `entryMode === "book"` can never hold when gate=false, so the condition MUST be repointed (e.g. `hasLiveBook && !gate && eligible>0`) or the note never renders — the exact regression D1 wants avoided. The locked copy ("Per-source modeling needs per-key history.") stays; `data-testid="scenario-data-sources-fallback"` exists for the test.
5. **Reopen of a BOOK draft under gate=false (edge to pin in a test):** composer renders forced-blank (added-only) while the draft carries `memberKeyIds` — the compare column still computes per-key from persisted membership (asymmetry is honest: composer projection needs the gate-complete series, compare intersects membership with eligible). The MEMBER-04 disclosure machinery (1327–1331) is unchanged.
6. **Blank-mode commit:** already yields `scenarioAum = 0` (no holding refs seeded) → `handleCommit` refuses adds with the existing AUM error. No change vs today's blank mode; do not "fix".

## ENGINE-04 — Dealias Retirement Preconditions

### Production importers of `@/lib/scenario-dealias` TODAY (grep-verified)
| File | Symbol(s) | Fate |
|------|-----------|------|
| `ScenarioComposer.tsx:74–76` | `collapseAliasedHoldingStrategies`, `mapDeAliasedWeightsToRawBasis` | removed in ENGINE-01 stage |
| `scenario-compare.ts:58` | `collapseAliasedHoldingStrategies` | removed in ENGINE-02 stage |
| **`src/lib/queries.ts:37, 2202`** | `collapseAliasedHoldingStrategies` inside `liveBaselineMetricsFromHoldings` | **DISCOVERY — not in CONTEXT's deletion-target list. Must be resolved before the dealias file can delete.** |

### The queries.ts discovery (planner must stage this)
`liveBaselineMetricsFromHoldings` (queries.ts:2131–2241) is the gate=false SSR live-baseline: it builds holdings `StrategyForBuilder` units (2154–2173), collapses aliases (2202) and runs `computeScenario`. It is selected by the ternary at **queries.ts:3151–3159** (`perKeyDailiesGateSatisfied ? liveBaselineMetricsFromPerKeyDailies(...) : liveBaselineMetricsFromHoldings(...)`). It is itself holdings-snapshot ENGINE machinery feeding a scenario surface (the composer's M4 baseline KPI at ScenarioComposer.tsx:2664/3523).

**Recommended resolution:** repoint the gate=false branch to the module's existing empty-default shape (`emptyDefault` at 2140–2148 — AUM from holdings preserved, all metrics null → KpiStrip's honest "—" convention) and delete `liveBaselineMetricsFromHoldings`. Behavior change scope: gate=false holders only = the 2 prod residue users = nobody after GUARD-01. Keeping the function without the collapse would re-poison avgRho (fabricated ρ=1.0 — the H-0487/H-0493 class the collapse exists to fix), which its own call-site guard test (`queries.my-allocation.test.ts:1493`) was written to prevent; retiring both together in the reviewed re-baseline is the honest move. `holdingsSummary` itself STAYS in queries.ts (locked; the Holdings tab + AUM still consume it), as does `reconstructHoldingReturnsByScopeRef`/the `holdingReturnsByScopeRef` payload field (payload contract untouched this phase — deferred-list adjacency; it merely loses its engine consumers).

### Can per-key / added ids EVER alias? (precondition b)
- Per-key unit id = `api_keys.id` (UUID, `buildPerKeyStrategyForBuilderSet` line 261: `id: apiKeyId`).
- Added unit id = `strategies.id` (UUID, minted by `addStrategyBrowse/Bridge` H5 brand).
- The collapse keyed aliasing on `symbolByHoldingId` membership; UUIDs were never in that map (`Pitfall 3` comment, ScenarioComposer.tsx:1844–1846). Post-deletion "aliasing" could only mean two engine units sharing an id — requires a UUID collision across two distinct PostgreSQL tables. Disjoint by construction; the CONTEXT-required explicit assertion is best placed as a `mergeAddedIntoPerKeySet` unit test (an added id colliding with a per-key id keeps both distinct / the set never silently merges) plus an id-format assertion (no output id starts with `holding:`) — which doubles as an ENGINE-05 runtime layer.
- Existing pins: `scenario-adapter.test.ts` T8 ("no id is BOTH UUID and scope_ref") and PK2 (`id === api_key_id`).

### avg-|ρ| honesty tests (precondition a) — inventory
| Test | Location | Post-deletion fate |
|------|----------|--------------------|
| "Pitfall 3 two per-key units sharing an underlying symbol are NOT collapsed (count preserved; avg-ρ honest)" | `ScenarioComposer.test.tsx` ~4838 | SURVIVES by construction (no collapse at all → count trivially preserved). This is the green light ENGINE-04(a) wants |
| "H-0487 multi-venue BTC collapses before computeScenario (scenario avgRho not fabricated 1.0)" | `ScenarioComposer.test.tsx` ~644 | Premise (holdings units reaching the engine) is deleted — retires WITH the collapse in the re-baseline commit, rationale: the aliasing source (symbol-keyed holdings series) no longer reaches any engine |
| SSR call-site guard "reverting the collapse here must fail a test" | `src/lib/queries.my-allocation.test.ts:1493` | Retires with `liveBaselineMetricsFromHoldings` (same re-baseline act) |
| `src/lib/scenario-dealias.test.ts` (whole file, incl. the `mapDeAliasedWeightsToRawBasis` R4/optimizer blocks) | — | Deleted with the module in the re-baseline commit |

### Phase 62's touch of `scenario-dealias.test.ts` (question answered)
Commit `b6961e81` ("rebase version-relative fixtures for the v4 double bump") added exactly ONE line — `memberKeyIds: []` — to a hand-built `ScenarioDraft` literal inside the `mapDeAliasedWeightsToRawBasis` describe block (required-at-v4 field). Nothing structural; no bearing on the retirement beyond confirming the file's draft fixtures are v4-shaped.

## ENGINE-05 Guard Design

**Class to mirror (both exist, both verified):**
1. Git-delta guards: `src/__tests__/phase-{29,30,31,32,52}-frozen-spine-guards.test.ts` — merge-base with origin/main, fail-loud baseline resolution (Rule 12), one assertion per frozen path. This class is the GUARD-03 template, not the ENGINE-05 one (it pins "file unchanged", not "pattern absent").
2. Source-scan guards: `src/app/scenario-share/[token]/page-server-boundary.test.ts` and `src/__tests__/admin-csrf-ratelimit-grep.test.ts` — `readFileSync` over named production sources asserting a pattern is absent/present. THIS is the ENGINE-05 mechanism.

**Recommended shape** (file naming at Claude's discretion; `src/__tests__/phase-63-*.test.ts` placement follows the class):
- **Source-scan layer** over the scenario-surface production set: `scenario-adapter.ts`, `scenario-compare.ts`, `ScenarioComposer.tsx`, `ScenarioComparePanel.tsx`, `share-resolve.ts`. Assert absence of the banned identifiers: `buildStrategyForBuilderSet`, `collapseAliasedHoldingStrategies`, `mapDeAliasedWeightsToRawBasis`, `symbolByHoldingId`, `scenario-dealias` (import specifier), and absence of `id: scopeRef`-style `holding:`-id unit construction in the adapter.
- **Runtime layer:** every surviving engine-set builder output (`buildPerKeyStrategyForBuilderSet`, `mergeAddedIntoPerKeySet`, the added-only builder) asserts no strategy id `startsWith("holding:")` — a non-vacuous behavioral pin (falsify by injecting a `holding:` id fixture and watching it fail — Rule 9).

**⚠️ Precision hazard:** do NOT ban the literal `"holding:"` in `ScenarioComposer.tsx` wholesale — `scenarioAum` legitimately reads `scopeRef.startsWith("holding:")` on DRAFT toggle refs (line 2726, PRESENT-02 keeps it through Phase 64), and `buildHoldingRef` legitimately remains in the Holdings tab / bridge / flagged-holdings surfaces. The invariant is "no `holding:` scopeRef as an ENGINE UNIT ID", not "no holding refs anywhere". A naive grep for `holding:` would be permanently red.

## GUARD-01 — Prod Residue Cleanup (research only; NO writes performed this session)

- **Table:** `allocator_holdings` (migration `20260420073003_allocator_holdings.sql`): `allocator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, unique `(allocator_id, venue, symbol, asof)`. Read path verified at queries.ts:2703 (`.eq("allocator_id", userId)`).
- **Holders:** 2 `phase10-rpc-*@test.local` users (input doc, prod-verified 2026-07-03; latest asof 2026-04-26). Exact UUIDs resolvable at execution: `select id, email from auth.users where email like 'phase10-rpc-%@test.local';`
- **Delete (holdings rows ONLY, keep auth.users — locked):**
  `delete from allocator_holdings where allocator_id in (select id from auth.users where email like 'phase10-rpc-%@test.local');`
  Conservative note: `allocator_equity_snapshots` rows for the same users are NOT in scope (CONTEXT says holdings rows only; snapshots don't make a user a gate=false HOLDER).
- **Verification query (the empirical-grounding re-run — must return 0 rows):** holders = users with holdings rows but zero ELIGIBLE keys, using the exact eligibility predicate from `isPerKeyDailiesEligibleKey` (queries.ts:2429–2437: `is_active AND sync_status IS DISTINCT FROM 'revoked' AND disconnected_at IS NULL`):
  ```sql
  select h.allocator_id, count(*) as holdings_rows
  from allocator_holdings h
  where not exists (
    select 1 from api_keys k
    where k.user_id = h.allocator_id
      and k.is_active
      and (k.sync_status is null or k.sync_status <> 'revoked')
      and k.disconnected_at is null
  )
  group by 1;
  ```
  (Confirm `api_keys` owner column is `user_id` at execution — migration comment "couples allocator_id to api_keys.user_id" supports it. Full gate parity would additionally require each eligible key to have `csv_daily_returns` rows; for "0 gate=false HOLDERS remain" the no-eligible-key holder check above is the one the input doc grounded on.)
- **⚠️ Execution constraint:** the gsd-executor has NO Supabase MCP (established project reference `reference_db_test_ci_wiring`). GUARD-01 must therefore be an orchestrator-run step or a `checkpoint` task in the plan — a plain executor task will silently lack the tool. Prod project: `khslejtfbuezsmvmtsdn`. Destructive-op autonomy per standing user policy is confirmed in CONTEXT.

## GUARD-03 — Frozen Engine

- **Assertion command (every wave gate, verbatim from CONTEXT):** `git diff origin/main..HEAD -- src/lib/scenario.ts src/lib/scenario-window.ts` → must output nothing. Phase 62's verifier already ran this green.
- **Highest-pressure edit points this phase (name them in plan verification steps):**
  1. The post-collapse window-injection removal (composer 2158–2173, compare 274–308) — the temptation is to "clean up" the window handling inside the engine instead of at the call sites. All edits stay in composer/compare.
  2. Degenerate empty-set behavior for the gate=false liveBook column — the engine's null-metric convention already handles it; no engine change is needed or allowed.
- A durable git-delta guard test in the phase-NN class is OPTIONAL (CONTEXT demands the wave-gate assertion, not a new test); if authored, mirror `phase-52-frozen-spine-guards.test.ts` including the fail-loud baseline resolution.

## Test-Fallout Map (GUARD-02)

### Must survive VERBATIM (the P61 net — pin these in every wave's verification)
| Suite | Location |
|-------|----------|
| Composer P61 block: "P61-BUG-1: added strategies join the per-key book projection" | `ScenarioComposer.test.tsx:7262` |
| Compare per-key block: "computeMetricsForDraft — per-key channel (P61-BUG-2)" | `scenario-compare.test.ts:535–660` |
| MEMBER-02 selector block incl. F5 (700) and the Atlas golden (776) and union-lock 793 | `scenario-compare.test.ts:662–830` (see repoint exceptions below) |
| T_CP8 per-key channel threading | `ScenarioComparePanel.test.tsx:332` |
| T_SH13 / T_SH14 book-only mint gate | `share/route.test.ts:368, 383` |
| Book-only honest-absence block | `share-resolve.test.ts:524` |
| "Pitfall 3 … NOT collapsed (avg-ρ honest)" | `ScenarioComposer.test.tsx` ~4838 |

### Break by construction — each repoint/retirement is its OWN reviewed commit with rationale
| Test / fixture | Location | Why it breaks | Disposition |
|----------------|----------|---------------|-------------|
| `buildStrategyForBuilderSet` blocks T1–T15 + B4-signature | `scenario-adapter.test.ts:45–345` | builder deleted | retire with the builder (stage-3 commit) |
| H-0132 commit-oracle round-trip block | `scenario-adapter.test.ts:416–591` | keys weights on `buildHoldingRef` via the deleted builder | retire; note `handleCommit` itself is draft-based and unchanged — the oracle's subject vanishes, not the commit gate |
| "EMPTY membership → the legacy holdings/added path runs" | `scenario-compare.test.ts:620` | pins the legacy path explicitly | repoint to "EMPTY membership → added-only" |
| liveBook union-lock via holdings | `scenario-compare.test.ts:357` | `{ liveBook: true }` holdings basis deleted | repoint to per-key membership basis (buildLiveBookDraft gate=true) |
| WR-02 "gate OFF → holdings basis, not per-key" | `scenario-compare.test.ts:810` | gate-off basis becomes added-only/empty | repoint: gate OFF → empty membership → added-only (null-metric liveBook column) |
| `mkInputs` fixture (holdingsSummary/symbolByHoldingId plumbing) | `scenario-compare.test.ts:87–127` | `ScenarioCompareInputs` interface shrinks | fixture rebase |
| Bridge-seam JOURNEY-01 (`{ liveBook: true }` holdings baseline, rebased onto this basis by 62 commit `4b852f13`) | `__tests__/bridge-to-composer-seam.test.tsx:164–184` | holdings baseline deleted | repoint the baseline to a per-key-membership book (keep the non-vacuous "projection MOVES" oracle) |
| Composer test imports: `buildStrategyForBuilderSet` (:264), `realCollapse` (:274) + the adapter `vi.mock`/importOriginal plumbing | `ScenarioComposer.test.tsx:255–290` | compile break on deletion | rebase mock plumbing; the DSRC recompute oracles that use REAL `@/lib/scenario` stay |
| "H-0487 multi-venue BTC collapses before computeScenario" | `ScenarioComposer.test.tsx` ~644 | collapse premise deleted | retire in the ENGINE-04 re-baseline commit |
| `symbolByHoldingId` Map assertion | `ScenarioComparePanel.test.tsx:319–321` | field deleted | repoint inputs assertion |
| SSR collapse call-site guard | `queries.my-allocation.test.ts:1493` block | `liveBaselineMetricsFromHoldings` retires | retire in the re-baseline commit; add the new gate=false-→-emptyDefault expectation |
| `scenario-dealias.test.ts` (entire file) | `src/lib/` | module deleted | delete in the ENGINE-04 re-baseline commit |
| `scenario-history.test.ts` header comment | `:10` | references the collapse | doc-only edit |
| `share-resolve.test.ts:217` (`symbolByHoldingId: new Map()`) fixture | share tests | compare-inputs-shaped fixture | fixture rebase if the shared type shrinks |
| Comments citing the builder: `share-resolve.ts:180`, `queries.ts:2085`, composer header :30 | prod sources | stale citations | doc edits in the owning stage's commit |

### Unaffected (checked, listed so the planner doesn't over-scope)
`useScenarioState`/`scenario-state` tests (draft layer keeps holding refs — legitimate), `ScenarioComposer.save.test.tsx` (entryMode-aware stamping, gate-aware already), WINDOW-01..06 blocks (passthrough strategies, real engine — the collapse was already identity for them), `composer-axe.spec.ts` e2e (fresh no-book allocator → blank mode), share `page.test.tsx`, RLS SQL tests, Holdings tab / bridge / holdings-adapter suites.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Added-only engine set | a new inline `StrategyForBuilder` literal loop | `buildAddedUnits` (export it or wrap it) / `mergeAddedIntoPerKeySet` with an empty per-key set | one construction shared by composer + compare; the warm-up/weight-0/metadata defaults are test-pinned invariants (F9 H-0133) |
| Window defaults | inline interval math | `coverageSpanOf` / `defaultWindowFor` / `unionOf` from `scenario-window.ts` | Rule-2 lock; the frozen file must not be touched OR re-derived |
| gate=false SSR baseline | a local mini-collapse in queries.ts | the module's existing `emptyDefault` shape | re-implementing the thing being deleted; emptyDefault already carries AUM |
| Guard mechanics | a bespoke AST walker | the readFileSync source-scan class + the git-delta class | both exist, both non-vacuity-proven |

## Common Pitfalls

### Pitfall 1: ENGINE-04 blocked by the forgotten third importer
**What goes wrong:** the plan deletes composer+compare call sites, then the dealias-retirement grep finds `queries.ts:2202` still importing — stage blocked mid-phase.
**How to avoid:** stage the queries.ts gate=false baseline repoint BEFORE the dealias re-baseline commit.
**Warning sign:** `grep -rn "scenario-dealias" src/ --include="*.ts*" | grep -v test` non-empty after the compare stage.

### Pitfall 2: dead DSRC-02 note after the blank-mode init change
**What goes wrong:** `showDataSourcesFallback` requires `entryMode === "book"`; gate=false now forces blank → the note NEVER renders → gate=false allocators get a blank composer with no explanation (exactly the "broken/empty UI" D1 forbids).
**How to avoid:** repoint the condition alongside the init change, in the same commit; pin with a render test on `scenario-data-sources-fallback`.

### Pitfall 3: over-broad ENGINE-05 grep
**What goes wrong:** banning `holding:`/`buildHoldingRef` in `ScenarioComposer.tsx` breaks the legitimate `scenarioAum` commit-sizing read (2726) and the Holdings-tab surfaces.
**How to avoid:** ban the deleted IDENTIFIERS per file + assert builder outputs' id format; never a blanket string ban.

### Pitfall 4: engine edits under deletion pressure (GUARD-03)
**What goes wrong:** simplifying the window-injection idiom "one level deeper" lands a diff in `scenario.ts`/`scenario-window.ts`.
**How to avoid:** run the zero-diff git command at EVERY wave gate (locked); all state simplification happens in composer/compare only.

### Pitfall 5: blind test updates (GUARD-02)
**What goes wrong:** a suite-wide mechanical fixture sweep "fixes" the P61 pins along with the legitimate repoints.
**How to avoid:** the verbatim-survivor list above is the checklist; every repoint is an individually reviewed commit; run the P61 blocks explicitly after each stage.

### Pitfall 6: local vitest flakes mistaken for regressions
**What goes wrong:** parallel-file contention flakes composer suites locally.
**How to avoid:** `npx vitest run <file> --no-file-parallelism` for local verification (established project reference).

## Code Examples

### Composer engine-set selection AFTER (target shape, book+gate / blank)
```typescript
// Source: derived from scenario-adapter.ts:313-354 + ScenarioComposer.tsx:1777-1798 (this session)
const activeAdapterOutput = useMemo(() => {
  if (usePerKeySources) {
    return mergeAddedIntoPerKeySet(
      perKeyAdapterOutput,
      scenario.draft.addedStrategies,
      addedStrategyReturnsLookup,
      addedStrategyMetadataLookup,
    );
  }
  // blank / gate=false: added-only (the ONE shared construction)
  return buildAddedOnlySet(
    scenario.draft.addedStrategies,
    addedStrategyReturnsLookup,
    addedStrategyMetadataLookup,
  );
}, [/* same deps minus adapterOutput */]);

// deAliased memo replaced by the identity pair:
const engineSet = { strategies: activeAdapterOutput.strategies, state: projectionState };
const dateMapCache = useMemo(() => buildDateMapCache(engineSet.strategies), [engineSet.strategies]);
```

### ENGINE-05 runtime layer (non-vacuous id-format pin)
```typescript
// Source: mirrors scenario-adapter.test.ts T8 + PK2 pins (this session)
for (const s of mergeAddedIntoPerKeySet(perKey, added, returns, meta).strategies) {
  expect(s.id.startsWith("holding:")).toBe(false);
}
```

### GUARD-03 wave-gate assertion (verbatim, CONTEXT-locked)
```bash
git diff origin/main..HEAD -- src/lib/scenario.ts src/lib/scenario-window.ts
# → MUST print nothing
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| entryMode/gate infers a draft's series | persisted `memberKeyIds` (v4) is the selector | Phase 62 (this branch) | the deletion has a persisted source of truth to stand on |
| Compare else-branch could merge the live book into blank drafts | `opts.liveBook ? holdingsSummary : []` (WR-01) | Phase 62 | ENGINE-02 = machinery deletion, not re-gating |
| liveBook column hardcoded per-key | `buildLiveBookDraft(gate, eligible)` (WR-02) | Phase 62 | stays byte-identical; Atlas golden pins it |
| Holdings units + collapse on gate=false | (this phase) added-only blank fallback, no collapse anywhere | Phase 63 | avg-ρ honesty holds trivially; dealias module retires |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `api_keys` owner column is `user_id` (from migration comment "couples allocator_id to api_keys.user_id") | GUARD-01 | verification query needs a column rename at execution; confirm via `information_schema.columns` before running |
| A2 | The 2 residue holders are still the ONLY gate=false holders on prod (verified 2026-07-03 per input doc; not re-verified this session — no Supabase MCP in the researcher toolset) | GUARD-01 | re-run the grounding query BEFORE the delete; if new gate=false holders appeared, stop and surface |
| A3 | No OTHER production module imports `scenario-dealias` beyond the three found (grep over `src/` this session; no dynamic imports observed) | ENGINE-04 | the pre-deletion grep gate (precondition c) catches it |

All other claims: `[VERIFIED: codebase]` — file:line citations throughout were read directly this session.

## Open Questions (RESOLVED)

1. **`holdingReturnsByScopeRef` SSR payload field loses all production consumers after this phase.**
   - What we know: producers stay in queries.ts; consumers were exclusively the deleted engine paths + the compare-inputs plumbing.
   - What's unclear: whether to drop the payload field now or leave it.
   - Recommendation: LEAVE IT (mirror the locked `holdingsSummary`-stays rule; payload-contract shrinking is deferred-list-adjacent). Note it as future cleanup.
   - **RESOLVED (planning): LEAVE IT** — encoded in Plan 04 Task 2 (producers + the payload field stay byte-untouched; the SUMMARY notes it as future cleanup).
2. **Exact affordance for the unavailable book entry (disabled segment + note vs hidden segment).**
   - Claude's discretion per CONTEXT; DESIGN.md must be read at plan/execute time before the styling choice. The DSRC-02 InfoBanner copy is locked either way.
   - **RESOLVED (planning): CONTEXT discretion stands** — Plan 01 Task 2 makes the affordance choice WITHIN DESIGN.md at execute time (disabled-with-note vs hidden); the locked copy renders either way.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node + vitest suite | all code stages | ✓ (repo dev env, `vitest.config.ts` present) | per package.json | — |
| git with `origin/main` ref | GUARD-03 wave gates, frozen-spine class | ✓ (repo, fetch-depth caveat only in shallow CI clones — guards fail loud) | — | — |
| Supabase MCP → prod `khslejtfbuezsmvmtsdn` | GUARD-01 delete + verification | ✓ in orchestrator session; **✗ for gsd-executor** (established project reference) | — | orchestrator-run step or `checkpoint` task — plan MUST NOT put GUARD-01 in a plain executor task |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (config: `vitest.config.ts`, coverage thresholds are a blocking CI gate) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run <file> --no-file-parallelism` |
| Full suite command | `npm test` (CI parity: `npm run test:coverage`; also `npm run lint` + `npx tsc --noEmit` before push) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENGINE-01 | book+gate = merged per-key set; blank = added-only; no holdings units | unit/component | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" --no-file-parallelism` | ✅ (P61 block survives; new blank-mode assertions Wave 0/in-stage) |
| ENGINE-02 | compare computes per-key/added only; interface shrunk | unit | `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-compare.test.ts" --no-file-parallelism` | ✅ (repoints per fallout map) |
| ENGINE-03 | gate=false → blank init + note renders; book entry unavailable | component | composer test file (above), target `scenario-data-sources-fallback` + `scenario-entry-mode` testids | ❌ new tests (in-stage RED→GREEN) |
| ENGINE-04 | 0 prod importers; no-alias assertion; honesty tests green | unit + grep gate | `grep -rn "scenario-dealias" src --include="*.ts*" \| grep -v test` (empty) + adapter test file | ❌ no-alias assertion is new |
| ENGINE-05 | no `holding:` engine unit ids on scenario surfaces | source-scan + runtime guard | `npx vitest run src/__tests__/phase-63-*.test.ts` | ❌ new guard file (written after removals, in-phase — locked) |
| GUARD-01 | 0 gate=false holders on prod | manual-only (Supabase MCP SQL) | verification query in §GUARD-01 | N/A — orchestrator/checkpoint |
| GUARD-02 | P61 suites green verbatim | unit | run the 5 verbatim-survivor files listed in the fallout map | ✅ |
| GUARD-03 | frozen files zero-diff | git gate | `git diff origin/main..HEAD -- src/lib/scenario.ts src/lib/scenario-window.ts` (empty) | ✅ (command gate) |

### Sampling Rate
- **Per task commit:** the touched suite file(s) via quick-run + `npx tsc --noEmit`
- **Per wave merge:** full `npm test` + `npm run lint` + the GUARD-03 diff command + the P61 verbatim-survivor files explicitly
- **Phase gate:** full suite + coverage green before `/gsd:verify-work`; ENGINE-04 grep gate empty

### Wave 0 Gaps
- [ ] ENGINE-05 guard test file (locked: authored AFTER the removals, so it is an end-stage task, not Wave 0)
- [ ] Explicit no-alias assertion in `scenario-adapter.test.ts` (can precede deletions — genuinely Wave 0-able)
- [ ] Blank-mode/gate=false composer render tests (RED first within the ENGINE-03 stage)

## Security Domain

Low-exposure phase: no new inputs, no new endpoints, no crypto, no auth changes. Applicable notes only:

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | GUARD-01 only | prod delete scoped by explicit `auth.users` email-pattern subquery; run + verify in one MCP session; no service keys in code |
| V5 Input Validation | unchanged | draft decode stays on the codec trichotomy (never bare casts) — deletion must not bypass `scenarioDraftCodec` |
| Others (V2/V3/V6) | no | — |

Threat note: the only destructive operation is GUARD-01 (STRIDE: Tampering with prod data) — mitigated by the locked scope (holdings rows only, keep users), the pre-delete grounding re-run (A2), and the post-delete verification query.

## Project Constraints (from CLAUDE.md)

- Coverage is a blocking CI gate (lines 82 / stmts 80 / fns 74 / branches 72) — mass test deletion (dealias tests, adapter blocks) slightly lowers covered surface; the deleted SOURCE shrinks too, so ratios should hold, but check `npm run test:coverage` at the phase gate.
- Read DESIGN.md before any visual decision (the ENGINE-03 affordance).
- Rule 9: guard tests must fail when neutered — falsify the ENGINE-05 guard and the blank-mode note test during authoring.
- Rule 3/12: surgical changes; fail loud; never silent skips.
- Banned packages list: N/A (no installs).
- Workflow: feature-branch + /ship; VERSION + package.json bump in the same commit; `npm run lint` before push; never manual `git commit` outside /ship flow (established feedback references).
- `.planning/` is gitignored/local — never `git add` it.

## Sources

### Primary (HIGH confidence — read this session on branch `v1.6-membership-schema-v4`)
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (engine selection, entry mode, note, AUM, commit, optimizer)
- `src/app/(dashboard)/allocations/lib/scenario-compare.ts`, `scenario-adapter.ts`, `scenario-state.ts`
- `src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx`
- `src/lib/scenario-dealias.ts`, `src/lib/scenario-history.ts`
- `src/lib/queries.ts` (baseline ternary 3151–3159, `liveBaselineMetricsFromHoldings` 2131–2241, eligibility 2429–2437, holdings read 2703)
- `src/app/scenario-share/[token]/share-resolve.ts`
- `src/__tests__/phase-52-frozen-spine-guards.test.ts`, `src/app/scenario-share/[token]/page-server-boundary.test.ts` (guard classes)
- Test suites enumerated in the fallout map (grep + targeted reads)
- `supabase/migrations/20260420073003_allocator_holdings.sql`
- Git: commit `b6961e81` (dealias-test touch), branch log `origin/main..HEAD`
- `.planning/phases/63-*/63-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/v1.6-SERIES-SPACE-INPUT.md`, `.planning/phases/62-*/62-VERIFICATION.md`

### Secondary / Tertiary
- None needed — zero external-ecosystem questions in this phase.

## Metadata

**Confidence breakdown:**
- Deletion map: HIGH — every call site read directly, line numbers current on this branch
- ENGINE-04 importer inventory: HIGH — grep + read; the queries.ts discovery is the load-bearing finding
- Test fallout: HIGH for the enumerated files; MEDIUM for exact per-test repoint shapes (planner refines per stage)
- GUARD-01 SQL: MEDIUM — table/column verified from migration + read path; A1/A2 flagged for execution-time confirmation

**Research date:** 2026-07-03
**Valid until:** the branch head moves past Phase 63 planning (line numbers drift with any commit to these files — re-grep before executing if the branch advances)

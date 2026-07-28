# Phase 63: Holdings-Snapshot Fallback Engine Removal - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 8 modified source + 2 new artifacts (11 test files repoint)
**Analogs found:** 11 / 11 (every removal has a surviving in-repo replacement; every new artifact mirrors an existing guard/commit class)

> **This is a DELETION phase.** "Analog" here means one of three things:
> (a) the exact code block being **removed** (cited with surrounding context so the executor deletes surgically),
> (b) the surviving **replacement** path that already exists on this branch (the added-only / per-key construction, the `emptyDefault` baseline, the repointed note condition), or
> (c) the **class to mirror** for a new artifact (guard test, reviewed re-baseline commit).
> Line numbers are current on branch `v1.6-membership-schema-v4` — **re-grep before executing if the branch head advances** (RESEARCH "Valid until").

---

## File Classification

| Modified/New File | Role | Change Class | Closest Analog (surviving/replacement) | Match |
|-------------------|------|--------------|----------------------------------------|-------|
| `scenario-adapter.ts` | lib/builder | delete `buildStrategyForBuilderSet`; export added-only wrapper | `mergeAddedIntoPerKeySet` (313-354) + `buildAddedUnits` (94-124) | exact — same file, surviving siblings |
| `ScenarioComposer.tsx` | component | delete holdings memos; blank-mode init; repoint note | `mergeAddedIntoPerKeySet` call + `showDataSourcesFallback` (1811-1814) | exact |
| `scenario-compare.ts` | lib (pure compute) | delete holdings else-branch + collapse + window-inject | the `if` per-key branch (200-208) + `mergeAddedIntoPerKeySet` | exact — same file |
| `ScenarioComparePanel.tsx` | component | interface shrink (drop holdings inputs) | surviving `equityByApiKeyId` derivation (168-181) | role-match |
| `queries.ts` | lib (SSR) | delete `liveBaselineMetricsFromHoldings`; repoint gate=false ternary | `emptyDefault` (2140-2148) already in the function | exact — replacement in-function |
| `scenario-dealias.ts` | lib | **delete whole module** (re-baseline act) | v1.5 frozen-spine re-baseline precedent (ADR-001) | class-match |
| `share-resolve.ts` / `scenario-history.ts` | lib | doc-comment edits only | already series-space (147-191) | doc-only |
| `phase-63-*.test.ts` (ENGINE-05) | test/guard | **NEW** source-scan guard | `admin-csrf-ratelimit-grep.test.ts` (readFileSync scan class) | class-mirror |
| (optional) `phase-63-frozen-spine-guards.test.ts` (GUARD-03) | test/guard | **NEW** git-delta guard | `phase-52-frozen-spine-guards.test.ts` | class-mirror |
| 15 break-by-construction tests (GUARD-02) | test | reviewed repoint per RESEARCH fallout map | commit `4b852f13` bridge-seam rebase | commit-class-mirror |

---

## Pattern Assignments

### 1. `scenario-adapter.ts` — delete the builder, export an added-only wrapper (ENGINE-01 stage 3)

**REMOVE (surgical):** `buildStrategyForBuilderSet` at **scenario-adapter.ts:126-212** (the `export function` through its `return { strategies: allStrategies, state: { selected, weights, startDates } }`). Also its holdings-only imports: `buildHoldingRef` + `HoldingRefInput` (34-42), and shrink/delete `ScenarioAdapterInputs` (68-79). Delete only AFTER both call sites (composer, compare) are gone — locked stage order.

**KEEP verbatim (the surviving path — this is the replacement, do not re-implement):**

`buildAddedUnits` (private, scenario-adapter.ts:94-124) is the ONE added-strategy construction. It is already shared by the deleted builder and the surviving merge:
```typescript
// scenario-adapter.ts:102-123 — the warm-up-gated, weight-0-default unit build
return addedStrategies.map((a) => {
  const meta = addedStrategyMetadataLookup[a.id] ?? { disclosure_tier: "public", cagr: null, sharpe: null };
  const returns = addedStrategyReturnsLookup[a.id] ?? [];
  return { id: a.id, name: a.name, /* ... */ start_date: returns[0]?.date ?? null, daily_returns: returns, /* ... */ };
});
```

`mergeAddedIntoPerKeySet` (scenario-adapter.ts:313-354) — the book+gate survivor; note the empty-per-key equivalence RESEARCH proved:
```typescript
// scenario-adapter.ts:322 — empty added → return perKey unchanged (byte-identical to today's empty blank)
if (addedStrategies.length === 0) return perKey;
// 344-348 — added units get selected=true, weight-0 default, "2022-01-01" startDate sentinel
```

**New wrapper (Claude's-discretion naming, e.g. `buildAddedOnlySet`)** delegates to `buildAddedUnits` so composer + compare share ONE greppable added-only construction. Mirror the signature/JSDoc convention of `buildPerKeyStrategyForBuilderSet` (247-284). The equivalence to today's blank mode is `mergeAddedIntoPerKeySet({ strategies: [], state: { selected:{}, weights:{}, startDates:{} } }, added, ...)`.

**Don't hand-roll** (RESEARCH): never write a new inline `StrategyForBuilder` literal loop — the weight-0/warm-up/metadata defaults are test-pinned invariants (F9 H-0133).

---

### 2. `ScenarioComposer.tsx` — engine-set selection + blank-mode init + note repoint (ENGINE-01/03)

**REMOVE:** import (130), dealias imports (74-76), `adapterOutput` holdings memo (1681-1710), `symbolByHoldingId` memo (1847-1857), `deAliased` collapse memo (1947-1955), `mapDeAliasedWeightsToRawBasis` optimizer apply-back (3703-3711).

**REPLACE `activeAdapterOutput` (1777-1798)** — target shape (RESEARCH Code Examples, derived from adapter 313-354 + composer 1777-1798):
```typescript
const activeAdapterOutput = useMemo(() => {
  if (usePerKeySources) {
    return mergeAddedIntoPerKeySet(perKeyAdapterOutput, scenario.draft.addedStrategies,
      addedStrategyReturnsLookup, addedStrategyMetadataLookup);
  }
  return buildAddedOnlySet(scenario.draft.addedStrategies, addedStrategyReturnsLookup, addedStrategyMetadataLookup);
}, [/* same deps minus adapterOutput */]);
// deAliased → identity pair; projectionState already covers every unit id:
const engineSet = { strategies: activeAdapterOutput.strategies, state: projectionState };
```
The `engineState` post-collapse window-injection idiom (2158-2173) simplifies — window spreads directly onto `projectionState`; the "collapse drops window" HAZARD-FIX comment must be rewritten. **⚠️ All edits stay OUTSIDE `scenario.ts`/`scenario-window.ts` (GUARD-03).**

**Blank-mode init (ENGINE-03) — replacement analog is the EXISTING gate:** the init at **692-694** currently gates on `hasLiveBook`:
```typescript
// ScenarioComposer.tsx:691-694 (BEFORE) — the analog to extend
const hasLiveBook = rawHoldingsSummary.length > 0;
const [entryMode, setEntryMode] = useState<"book" | "blank">(hasLiveBook ? "book" : "blank");
```
Repoint to `hasLiveBook && payload.perKeyDailiesGateSatisfied ? "book" : "blank"`. The single `holdingsSummary` switch (702-704) already funnels every downstream reference through one memo — no per-site change.

**DSRC-02 note condition (Pitfall 2) — the repoint replacement is in-file at 1811-1814:**
```typescript
// ScenarioComposer.tsx:1811-1814 (BEFORE) — breaks silently once blank is forced
const showDataSourcesFallback =
  entryMode === "book" && !payload.perKeyDailiesGateSatisfied &&
  (payload.eligibleApiKeyIds ?? []).length > 0;
```
Repoint the `entryMode === "book"` predicate to `hasLiveBook` (RESEARCH ENGINE-03 §4) IN THE SAME COMMIT as the init change; pin with a render test on `data-testid="scenario-data-sources-fallback"`. The locked copy ("Per-source modeling needs per-key history.") stays.

**Stays untouched (verify zero-diff intent):** `scenarioAum` (2708-2731, legit `holding:` DRAFT read — Pitfall 3), `handleCommit` (2801-2860), `useScenarioState`/`defaultDraftFromHoldings` (1151), bridge add (4241-4243), save-stamp (1441-1444), `liveMetricsForKpi` (2664-2667).

---

### 3. `scenario-compare.ts` — machinery deletion, NOT re-gating (ENGINE-02)

**REMOVE:** collapse import (58), builder import (62), `holdingsSummary`/`holdingReturnsByScopeRef`/`symbolByHoldingId` interface fields (83-95), `disabledHoldingRefs` (159-163), the entire **else-branch (209-237)**, the `collapseAliasedHoldingStrategies` call (267-271), and the POST-collapse window injection (274-308).

**Exact block being removed** (scenario-compare.ts:222-236) — note WR-01 already narrowed it to `opts.liveBook` only:
```typescript
const holdingsForDraft = opts.liveBook ? liveInputs.holdingsSummary : [];
adapterOutput = buildStrategyForBuilderSet(holdingsForDraft, disabledHoldingRefs, draft.addedStrategies, /* ... */);
```

**Replacement analog — the SURVIVING `if` per-key branch (200-208)** stays; the else becomes the shared added-only wrapper. Post-deletion the `deAliased` pair collapses to the identity `{ strategies: adapterOutput.strategies, state: projectionState }`; the reads at 301 (`deAliased.state.selected`) become `projectionState.selected`. `buildLiveBookDraft` (347-374) stays **byte-identical** (per-key membership, WR-02, Atlas-golden-pinned — GUARD-02 watch).

**gate=false liveBook column** becomes an empty added-only set → `computeScenario` returns null metrics → honest "—". Affects only gate=false books (0 real users after GUARD-01).

---

### 4. `queries.ts` — the DISCOVERED third importer; gate=false baseline repoint (ENGINE-04 prerequisite)

**This is the load-bearing finding.** `liveBaselineMetricsFromHoldings` (2131-2241) imports `collapseAliasedHoldingStrategies` at line 37 and calls it at **2202**. `scenario-dealias.ts` CANNOT delete until this is retired. **Stage this BETWEEN the adapter-builder deletion and the dealias re-baseline** (RESEARCH primary recommendation + Pitfall 1).

**Replacement analog is IN THE SAME FUNCTION — `emptyDefault` at 2140-2148:**
```typescript
// queries.ts:2140-2148 — AUM preserved from holdings, all metrics null → KpiStrip honest "—"
const emptyDefault: MyAllocationDashboardPayload["liveBaselineMetrics"] = {
  aum: totalAum, ytdTwr: null, sharpe: null, maxDd: null, avgRho: null, equity: [], drawdown: [],
};
```

**Repoint the gate=false ternary branch (3151-3159):**
```typescript
// queries.ts:3151-3159 (BEFORE) — delete the false branch's holdings call
const liveBaselineMetrics = perKeyDailiesGateSatisfied
  ? liveBaselineMetricsFromPerKeyDailies(phase07.holdingsSummary, eligiblePerKeyReturns)
  : liveBaselineMetricsFromHoldings(phase07.holdingsSummary, holdingReturnsByScopeRef); // ← repoint to emptyDefault shape
```
Point the false branch at the module's existing empty-default baseline (AUM-from-holdings preserved, null metrics), then delete `liveBaselineMetricsFromHoldings` (2131-2241) in the ENGINE-04 re-baseline commit. **Don't hand-roll a local mini-collapse** (RESEARCH Don't-Hand-Roll) — `emptyDefault` already carries AUM. `holdingsSummary` itself STAYS (locked — Holdings tab + AUM consume it), as does `reconstructHoldingReturnsByScopeRef` / the payload field (payload-contract untouched, deferred).

---

### 5. `scenario-dealias.ts` — module retirement as a reviewed re-baseline act (ENGINE-04, LAST)

**Precondition gate before delete** (all three, RESEARCH ENGINE-04):
- (a) avg-|ρ| honesty tests green — `ScenarioComposer.test.tsx` ~4838 ("Pitfall 3 … NOT collapsed") SURVIVES by construction (no collapse → count trivially preserved).
- (b) explicit no-alias assertion — per-key id = `api_keys.id` (UUID, adapter:261), added id = `strategies.id` (UUID); disjoint. Best placed as a `mergeAddedIntoPerKeySet` unit test + id-format assertion; existing pins `scenario-adapter.test.ts` T8/PK2.
- (c) grep proves 0 production importers: `grep -rn "scenario-dealias" src --include="*.ts*" | grep -v test` → empty.

**Analog for the deletion COMMIT — the v1.5 frozen-spine re-baseline precedent.** The delete lands as a single reviewed re-baseline commit whose message carries the rationale, exactly as v1.5 ADR-001 removed `scenario.ts` from `FROZEN_ISLANDS` (documented at `phase-52-frozen-spine-guards.test.ts:14-19, 158-165`). Retire together in that ONE commit: the module, `scenario-dealias.test.ts` (whole file), the H-0487 collapse test (`ScenarioComposer.test.tsx` ~644), and the SSR call-site guard (`queries.my-allocation.test.ts:1493`).

---

### 6. NEW — ENGINE-05 source-scan guard (`src/__tests__/phase-63-*.test.ts`)

**Class to mirror: `src/__tests__/admin-csrf-ratelimit-grep.test.ts`** (the `readFileSync` source-scan guard). Concrete pattern to copy:
```typescript
// admin-csrf-ratelimit-grep.test.ts:1-3, 190-199 — readFileSync over named prod sources, per-file assertion + actionable message
import { readFileSync } from "node:fs";
for (const file of mutatingRouteFiles) {
  const source = readFileSync(file, "utf8");
  it(`${rel} enforces CSRF ...`, () => {
    expect(hasCsrfDefense(source), `Missing ... in ${rel}. ...`).toBe(true);
  });
}
```
**Scan set** (RESEARCH ENGINE-05): `scenario-adapter.ts`, `scenario-compare.ts`, `ScenarioComposer.tsx`, `ScenarioComparePanel.tsx`, `share-resolve.ts`. **Assert ABSENCE** of `buildStrategyForBuilderSet`, `collapseAliasedHoldingStrategies`, `mapDeAliasedWeightsToRawBasis`, `symbolByHoldingId`, and the `scenario-dealias` import specifier.

**⚠️ Precision hazard (Pitfall 3):** do NOT ban the literal `"holding:"` — `scenarioAum` legitimately reads `scopeRef.startsWith("holding:")` (composer:2726) and `buildHoldingRef` stays in Holdings-tab/bridge surfaces. Ban the deleted IDENTIFIERS per file, not the string.

**Runtime layer (non-vacuous, mirrors adapter T8/PK2):**
```typescript
// RESEARCH Code Examples — falsify by injecting a "holding:" id fixture (Rule 9)
for (const s of mergeAddedIntoPerKeySet(perKey, added, returns, meta).strategies) {
  expect(s.id.startsWith("holding:")).toBe(false);
}
```
Locked: written AFTER the removals, in-phase (end-stage task, not Wave 0).

---

### 7. OPTIONAL — GUARD-03 git-delta guard (`src/__tests__/phase-63-frozen-spine-guards.test.ts`)

**Class to mirror: `src/__tests__/phase-52-frozen-spine-guards.test.ts`** (git-delta, fail-loud baseline). CONTEXT demands the wave-gate command, not a new test — this file is optional. If authored, copy verbatim: `resolveBaselineRef()` (108-128, fail-loud per Rule 12), `changedFiles(base)` (136-146), the per-path `.not.toContain(island)` loop (194-208). Frozen set = `["src/lib/scenario.ts", "src/lib/scenario-window.ts"]`. The mandatory wave-gate assertion regardless:
```bash
git diff origin/main..HEAD -- src/lib/scenario.ts src/lib/scenario-window.ts   # → MUST print nothing
```

---

### 8. GUARD-02 — 15 break-by-construction test repoints (each its own reviewed commit)

**Class to mirror: commit `4b852f13`** ("test(62): rebase bridge-seam JOURNEY-01 onto the own-book liveBook path"). This is the canonical reviewed-repoint precedent — an inline rationale comment at each changed line PLUS a dedicated commit carrying the "why it moved / non-vacuity preserved" rationale. The repoint shape it demonstrates:
```typescript
// bridge-to-composer-seam.test.tsx (via 4b852f13) — repoint WITH rationale, keep the falsifiable oracle
// WR-01 rebase: empty-membership draft → own-book proxy is { liveBook: true } ... assertion (d) stays testable.
const baseline = computeMetricsForDraft(draft, liveInputs, { liveBook: true });
```

| Break-by-construction test | Location | Nearest already-rebased analog / disposition |
|----------------------------|----------|----------------------------------------------|
| Bridge-seam JOURNEY-01 (`{ liveBook: true }` holdings baseline) | `src/app/(dashboard)/allocations/components/__tests__/bridge-to-composer-seam.test.tsx:164-184` | **IS** the analog (62's `4b852f13`); repoint baseline to a per-key-membership book, keep the "projection MOVES" oracle |
| liveBook union-lock via holdings | `scenario-compare.test.ts:357` | same `4b852f13` pattern → per-key membership basis (`buildLiveBookDraft` gate=true) |
| WR-02 "gate OFF → holdings basis" | `scenario-compare.test.ts:810` | `4b852f13` pattern → gate OFF → empty membership → added-only (null-metric column) |
| "EMPTY membership → legacy holdings/added path runs" | `scenario-compare.test.ts:620` | repoint to "EMPTY membership → added-only" |
| `mkInputs` fixture (holdings plumbing) | `scenario-compare.test.ts:87-127` | fixture rebase (interface shrink) |
| `buildStrategyForBuilderSet` blocks T1-T15 + B4-sig | `scenario-adapter.test.ts:45-345` | retire with the builder (stage-3 commit) |
| H-0132 commit-oracle round-trip | `scenario-adapter.test.ts:416-591` | retire; `handleCommit` itself unchanged |
| Composer mock plumbing (`buildStrategyForBuilderSet` :264, `realCollapse` :274) | `ScenarioComposer.test.tsx:255-290` | rebase `vi.mock`/importOriginal; real `@/lib/scenario` DSRC oracles stay |
| H-0487 multi-venue collapse | `ScenarioComposer.test.tsx` ~644 | retire in ENGINE-04 re-baseline commit |
| `symbolByHoldingId` Map assertion | `ScenarioComparePanel.test.tsx:319-321` | repoint inputs assertion |
| SSR collapse call-site guard | `queries.my-allocation.test.ts:1493` | retire in re-baseline; add gate=false→emptyDefault expectation |
| `scenario-dealias.test.ts` (whole file) | `src/lib/` | delete in re-baseline commit |
| `scenario-history.test.ts` header comment | `:10` | doc-only edit |
| `share-resolve.test.ts:217` fixture | share tests | fixture rebase if shared type shrinks |
| Builder-citation comments | `share-resolve.ts:180`, `queries.ts:2085`, composer `:30` | doc edits in the owning stage's commit |

**Verbatim survivors (P61 net — pin explicitly after EVERY stage, Pitfall 5):** `ScenarioComposer.test.tsx:7262` (P61-BUG-1), `scenario-compare.test.ts:535-660` (P61-BUG-2), `:662-830` MEMBER-02 (minus the repoint exceptions above), `ScenarioComparePanel.test.tsx:332` (T_CP8), `share/route.test.ts:368,383` (T_SH13/14), `share-resolve.test.ts:524`, `ScenarioComposer.test.tsx` ~4838 (Pitfall 3).

---

## Shared Patterns

### Added-only engine construction (applies to composer + compare else-branch)
**Source:** `scenario-adapter.ts:94-124` (`buildAddedUnits`) + `313-354` (`mergeAddedIntoPerKeySet` empty-per-key equivalence).
**Apply to:** both call sites via ONE exported wrapper. Never inline a `StrategyForBuilder` loop.

### Reviewed re-baseline commit (applies to dealias deletion + every GUARD-02 repoint)
**Source:** commit `4b852f13` (test repoint) + `phase-52-frozen-spine-guards.test.ts:14-19,158-165` (ADR-001 module-removal rationale-in-code).
**Apply to:** ENGINE-04 dealias deletion, queries.ts baseline repoint, all 15 fallout repoints. Inline rationale + dedicated atomic commit; never a mechanical suite-wide sweep.

### Source-scan guard (ENGINE-05)
**Source:** `admin-csrf-ratelimit-grep.test.ts` (readFileSync over named prod sources, per-file actionable assertion).

### Git-delta frozen guard + wave-gate command (GUARD-03)
**Source:** `phase-52-frozen-spine-guards.test.ts` (fail-loud baseline, per-path assertion). Command: `git diff origin/main..HEAD -- src/lib/scenario.ts src/lib/scenario-window.ts`.

### honest-em-dash null-metric convention (gate=false liveBook column + queries baseline)
**Source:** `scenario-compare.ts:310-313` (null-metric ComputedMetrics flows straight through, NO `?? 0`) + `queries.ts:2140-2148` (`emptyDefault`). The engine already handles the degenerate empty set — no engine change needed or allowed (GUARD-03).

---

## No Analog Found

None. Every removal has a surviving in-repo replacement path, and both new artifacts mirror an existing, non-vacuity-proven guard class. The only "new" logic is the added-only wrapper, which is a thin delegation to the already-shared `buildAddedUnits`.

## GUARD-01 (prod cleanup) — not a source pattern

Orchestrator/checkpoint task ONLY (gsd-executor has no Supabase MCP — RESEARCH Environment Availability). Table `allocator_holdings` (owner `allocator_id`), prod `khslejtfbuezsmvmtsdn`. Delete-then-verify SQL is in RESEARCH §GUARD-01; re-run the grounding query (A2) BEFORE the delete. No code analog applies.

---

## Metadata

**Analog search scope:** `src/app/(dashboard)/allocations/{components,lib}/`, `src/lib/` (queries, scenario-dealias, scenario-history), `src/app/scenario-share/[token]/`, `src/__tests__/` (guard classes), git log (`4b852f13`, `b6961e81`).
**Files scanned:** scenario-adapter.ts, scenario-compare.ts, ScenarioComposer.tsx, queries.ts, admin-csrf-ratelimit-grep.test.ts, phase-52-frozen-spine-guards.test.ts, bridge-to-composer-seam.test.tsx (via git show).
**Branch:** `v1.6-membership-schema-v4` — line numbers current this session; re-grep if the head advances.
**Pattern extraction date:** 2026-07-03

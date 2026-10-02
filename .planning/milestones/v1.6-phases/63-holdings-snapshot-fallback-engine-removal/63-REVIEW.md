---
phase: 63-holdings-snapshot-fallback-engine-removal
reviewed: 2026-07-03T18:15:00Z
depth: deep
files_reviewed: 22
files_reviewed_list:
  - src/__tests__/phase-63-series-space-guards.test.ts
  - src/app/(dashboard)/allocations/components/AllocationsTabs.scenario-state-preservation.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComparePanel.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/__tests__/bridge-to-composer-seam.test.tsx
  - src/app/(dashboard)/allocations/lib/drawdown.ts
  - src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts
  - src/app/(dashboard)/allocations/lib/scenario-adapter.ts
  - src/app/(dashboard)/allocations/lib/scenario-compare.test.ts
  - src/app/(dashboard)/allocations/lib/scenario-compare.ts
  - src/app/scenario-share/[token]/share-resolve.test.ts
  - src/app/scenario-share/[token]/share-resolve.ts
  - src/lib/getMyAllocationDashboard.scenario.test.ts
  - src/lib/queries.my-allocation.test.ts
  - src/lib/queries.ts
  - src/lib/scenario-dealias.test.ts (deleted — verified no live dependents)
  - src/lib/scenario-dealias.ts (deleted — verified no live dependents)
  - src/lib/scenario-history.test.ts
  - src/lib/scenario-history.ts
findings:
  critical: 1
  warning: 3
  info: 6
  total: 10
status: fixes_applied
fixes_applied_at: 2026-07-03
fixes_summary:
  fixed: 9        # CR-01, WR-01, WR-02, WR-03, IN-01, IN-02, IN-03, IN-04(header), IN-05
  declined: 1     # IN-06 (pre-existing, Phase-62 design — out of phase scope)
  gate: "vitest 7450 passed / 288 skipped / 0 failed; tsc --noEmit clean"
---

# Phase 63: Code Review Report

**Reviewed:** 2026-07-03T18:15:00Z
**Depth:** deep
**Files Reviewed:** 22 (diff 4b852f13..HEAD, 14 commits, branch v1.6-membership-schema-v4)
**Status:** issues_found

## Summary

Deletion-phase adversarial review of the holdings-snapshot fallback engine removal.
The deletion itself is clean and well-guarded: `scenario-dealias.ts` +
`liveBaselineMetricsFromHoldings` + `buildStrategyForBuilderSet` have zero remaining
production references (only prose mentions survive, flagged below); the ENGINE-05
source-scan + runtime guard is identifier-precise, per-file, fail-loud on missing
scan-set files, and runs green (86 targeted tests pass locally). GUARD-03 verified:
`git diff 4b852f13..HEAD` and `origin/main..HEAD` on `src/lib/scenario.ts` +
`src/lib/scenario-window.ts` are both empty. The gate=false SSR baseline repoint is
honest (AUM via `holdingEquityContribution` identical on both branches; all metrics
null; no half-blend — the D3 all-or-nothing mixed-population test now pins equality
to `emptyLiveBaselineMetrics` AND non-equality to the per-key blend, both falsifiable).
The Wave-3 F5 ":700 prod shape" retirement is **sound**: the premise (a
`holdingsSummary` channel in `ScenarioCompareInputs`) is structurally deleted at the
type level, and the surviving pin (scenario-compare.test.ts:649, non-empty per-key
series + gate=true → `member_count 0`, `member_ids []`, `twr null`) genuinely closes
F5 in series space. Test dispositions across queries.my-allocation, save, bridge-seam,
panel, and share suites were audited: oracles were repointed, not weakened (the one
`toBeDefined` softening in ScenarioComparePanel.test.tsx is compensated by the sibling
`equityByApiKeyId` content-equality pin).

The one BLOCKER is the Rule-1 deviation itself (f56d074b): the reopen drift-base
repoint to `rawHoldingsSummary` fixed only HALF the predicate — the state hook still
fingerprints against the mode-gated `holdingsSummary`, so the two drift decisions
diverge in every blank-mode-with-live-book state, producing seeded-window /
disclosure / drift-banner inconsistencies and a save-overwrite data-loss path.

## Critical Issues

> **Resolution (FIXED @05e07e37):** Introduced ONE shared predicate
> `isDraftDrifted(draftFp, gatedFp, liveFp)` (scenario-state.ts) consumed by BOTH
> the hook (`storedMismatch` + `baseOf`) and `openSavedScenario`'s `drifted`. The
> hook now takes `driftReferenceHoldings` (the mode-UNgated live book); a draft is
> drifted IFF it matches NEITHER the gated default NOR the live book. Book mode is
> byte-unchanged (gatedFp === liveFp). Decision for the forced-blank reopen of a
> matching book draft: APPLY it (draft preserved → no overwrite / data loss), the
> gate=false engine drops ineligible members honestly, MEMBER-04 discloses them.
> RED-first: strengthened ScenarioComposer.test.tsx ENGINE-03 reopen-edge test
> (applied draft + no false banner + Commit reflects the applied book) and 4 new
> useScenarioState.hydrate.test.tsx pins (case a apply + baseOf survival, case
> b/fresh-blank, stale match-neither). Note: drift-decision logic — worth a human
> eye on the case-(a) product choice, though pinned by tests.

### CR-01: Reopen drift predicate diverges from the hook's fingerprint base whenever `entryMode === "blank"` and the live book is non-empty — inconsistent hydration state and a saved-draft overwrite path

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1171-1234` (drift base), `:708-729` (hook input), with `src/app/(dashboard)/allocations/hooks/useScenarioState.ts:118-120,185-208`
**Issue:** Commit f56d074b repointed `openSavedScenario`'s drift reference to
`rawHoldingsSummary`, but the hook it must agree with still fingerprints against the
**mode-gated** `holdingsSummary` (`[]` in blank mode): the composer passes
`holdingsSummary` (line 727) into `useScenarioState`, whose
`storedMismatch = value.init_holdings_fingerprint !== fingerprint(gatedSummary)`
decides whether the hydrated draft is actually **applied**
(`draft = storedMismatch ? defaultDraft : value`, hook line 208). The code comment at
:1217-1222 claims the two predicates are "the same" — that is only true in book mode.
Two concrete divergences:

**(a) Forced-blank gate=false holder reopens a book draft whose fingerprint matches
the live book** (the exact population ENGINE-03 targets, and the shape of the new
"ENGINE-03 reopen edge" test): `drifted` computes **false** (raw base matches) →
the owner's saved window is seeded via `seedWindowLocal` (:1335-1336) and the
MEMBER-04 note is raised (:1342-1351). But on the next render the hook computes
`fp([]) !== fp(book)` → mismatch → the working draft **falls back to the blank
default**; the saved draft is never applied. Result: `coverageWindow`
(:2042-2047, `draft.window ?? local seed`) displays/computes at the **owner's window
over a draft that does not carry it** — the precise displayed-vs-persisted divergence
the file's own WR-01 comments and T_WIN_SAVE4 exist to prevent; the MEMBER-04 note
discloses dropped members of a draft that was never applied (contradicting the drift
branch's own rule at :1330-1333); the fingerprint-mismatch banner ("Your live holdings
have changed…") shows even though holdings did not change; and **"Update portfolio"
(deliberately ungated on drift) PUTs the blank default over the saved book draft —
silent data loss** while the UI reports the reopen succeeded (loadedScenarioId/name
adopted at :1353-1354).

**(b) Gate=true book holder who voluntarily toggled to blank mode reopens a
blank-authored draft** (`fp([])` — a real current-user path): `drifted` computes
**true** (raw base ≠ `fp([])`) → window seeding and the provenance note are
suppressed — but the hook (`fp([]) === fp([])`) **applies** the draft. For a
windowless reopen, `resetWindowToDefaultOnReopen()` is skipped, so a stale prior
window seed (`windowTouchedRef` still true) keeps displaying/computing at the
**previous** draft's window; for an upgraded-v2 blank draft the provenance note is
wrongly suppressed despite the draft being applied.

The new "ENGINE-03 reopen edge" test (ScenarioComposer.test.tsx:1760-1802) masks (a):
it asserts only "does not throw" + forced-blank + membership note; it never asserts
the working draft's contents, the banner state, or the window — it passes while the
composer is in the inconsistent state described above.

**Fix:** Make ONE fingerprint base authoritative for both decisions. The
root-cause option: thread the drift base into the hook — e.g. give `useScenarioState`
a separate `driftReferenceHoldings` (default = `holdingsSummary`) and pass
`rawHoldingsSummary`, so `storedMismatch` and `openSavedScenario`'s `drifted` compute
from the same live-book fingerprint while blank-mode SEEDING still uses the gated
summary:

```ts
// useScenarioState opts
const scenario = useScenarioState({
  holdingsSummary,                    // seeds the default draft (mode-gated)
  driftReferenceHoldings: rawHoldingsSummary, // ONE drift base (live book)
  allocatorId,
});
// hook: storedMismatch compares against fingerprint(driftReferenceHoldings)
```

Then decide explicitly what a forced-blank reopen of a book draft means (apply
added-strategies-only with the MEMBER-04/DSRC-02 disclosures, or refuse with honest
copy) — the current half-state must not survive. Whatever the decision, extend the
ENGINE-03 reopen-edge test to pin the working draft's application (added strategies
present/absent), the banner state, and that Update persists exactly what is shown
(the T_WIN_SAVE4 oracle style), and add the Case-(b) regression (blank-mode reopen of
a blank-authored windowed + windowless draft).

## Warnings

> **Resolution (FIXED @c4c6a080):** `applyWeightOverrides` gained an optional
> `basisIds` param; when provided it renormalizes over that basis instead of
> `enabledIdsOf(draft)`. The composer's `onApply` passes the SELECTED engine unit
> ids (the same universe fed to WeightOptimizerSection), so the mixed path
> reproduces the suggestion exactly. Threaded through the hook. Corrected the
> false 1:1-identity ENGINE-01 comment. GUARD-03 respected (scenario.ts /
> scenario-window.ts untouched). RED-first: scenario-state-apply-weights.test.ts
> pins {k1:.4,k2:.4,A:.2} over a mixed fixture — A drifted to .1667 pre-fix, exact
> post-fix.

### WR-01: Optimizer apply-back renormalizes over the DRAFT's toggle basis, not the engine's unit basis — applied blend ≠ suggestion on the mixed per-key + added path, and the new ENGINE-01 comment asserts a false 1:1 identity

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:3680-3695` (Apply handler), with `src/app/(dashboard)/allocations/lib/scenario-state.ts:547-576,268-272`
**Issue:** The Phase-63 replacement comment claims "the optimizer's weight vector maps
1:1 onto the applied basis. Apply it directly." That is only true when the optimizer
universe equals `enabledIdsOf(draft)`. In book+gate mode the optimizer universe is the
engine set (**api_key UUIDs + added ids**), but `applyWeightOverrides` renormalizes
over `enabledIdsOf(draft)` = the toggle-map keys (**`holding:` refs + added ids** —
`defaultDraftFromHoldings` seeds `toggleByScopeRef`/`weightOverrides` for holdings,
scenario-state.ts:247-253; api_key ids never enter the toggle map). Consequence with
2 keys + 1 added + 3 holdings (default holding overrides .5/.3/.2), suggestion
`{k1:.4, k2:.4, A:.2}`: merged = holdings + keys + A; renormalization runs over
{h1,h2,h3,A} (sum 1.2) → A lands at .1667 while k1/k2 keep .4/.4 → engine blend
≈ .414/.414/.172 instead of .4/.4/.2. The added sleeve is silently diluted by the
stale holding-override mass — the #528 apply-back-drift class — and the committed
`size_at_decision_usd` for the added strategy uses the diluted weight. Keys-only and
blank-mode applies are exact; only the mixed path drifts. This mismatch predates
Phase 63 (it became reachable with P61-BUG-1, #570), but Phase 63 deleted the only
remap seam (`mapDeAliasedWeightsToRawBasis`) and added a comment asserting the drift
cannot happen, so it is now baked in as documented-correct behavior.
**Fix:** Renormalize the applied vector over the engine's selected unit ids rather
than the draft toggle basis — e.g. an `applyWeightOverrides(draft, weights, basisIds)`
overload where the composer passes the optimizer universe's ids, or exclude
`holding:` refs from the renormalization mass when `usePerKeySources` is true. Add a
mixed-path regression: apply `{k1:.4,k2:.4,A:.2}` over a book+gate+1-added fixture and
assert the projectionState weights reproduce the suggestion after engine
renormalization (fails against current code).

> **Resolution (FIXED @f777fa7c — panel side only):** Dropped the never-read
> `holdingReturnsByScopeRef` from `ScenarioComparePanelProps.payload` and rewrote
> the false "legacy holdings path" comment. Type-safe: the production call site
> (AllocationsTabs) and all test fixtures pass the payload via `as unknown as`
> casts. Per planning lock, the SSR field + `reconstructHoldingReturnsByScopeRef`
> in queries.ts are LEFT IN PLACE (future cleanup / dead-code gate deferred).

### WR-02: `holdingReturnsByScopeRef` is now an orphaned SSR pipeline — computed and shipped on every dashboard payload with zero production readers; ScenarioComparePanel still REQUIRES it as a prop it never reads

**File:** `src/lib/queries.ts:2992-2995,3098,3408`; `src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx:67,71-74`
**Issue:** Phase 63 deleted both consumers of `holdingReturnsByScopeRef` (the
composer's holdings adapter call and `liveBaselineMetricsFromHoldings`), but
`reconstructHoldingReturnsByScopeRef` still runs on every
`getMyAllocationDashboard` SSR and the per-holding daily-return series are still
serialized into the client payload on both return branches — dead compute plus
payload weight with no reader. `ScenarioComparePanel`'s prop type still declares
`holdingReturnsByScopeRef: Record<string, DailyPoint[]>` as REQUIRED (line 67) though
`deriveCompareInputs` never touches it, and the adjacent comment (lines 71-74) claims
narrow payloads "fall back to the legacy holdings path" — a path that no longer
exists. This is exactly the kind of residue the ENGINE-05 guard cannot see (the field
name is not a banned token) and will mislead Phase-64 work.
**Fix:** Drop the field from `ScenarioComparePanelProps` and fix the stale comment
now (no behavior change). For the SSR field itself, follow the project dead-code gate
(AskUserQuestion before deletion): either remove
`reconstructHoldingReturnsByScopeRef` + the payload field in a follow-up, or document
the deliberate retention (e.g. Holdings-tab future use) at the queries.ts call site.

> **Resolution (FIXED @4a43495f):** Rewrote the two flagged JSDoc passages AND
> the matching inline body comment (same falsehood): gate ON → derived membership
> = eligible set → per-key union own-book blend; gate OFF → empty membership →
> empty added-only set → NULL metrics (honest em-dash). Also refreshed the
> :1765 → 1750-1751 anchor (IN-03 overlap). Comment-only.

### WR-03: `buildLiveBookDraft` JSDoc describes the DELETED holdings union path as the gate-off behavior — contradicting the actual em-dash behavior and the correct comment 100 lines above in the same file

**File:** `src/app/(dashboard)/allocations/lib/scenario-compare.ts:294-299,313-319`
**Issue:** The JSDoc still says gate-off → "otherwise all live holdings at the
adapter's value-proportional default" and "with the gate OFF membership is empty →
the holdings union path (opts.liveBook) — the same basis every sibling column runs
on". Both claims describe the deleted engine: the actual gate-off live-book column
resolves to an EMPTY added-only set → `computeScenario` null metrics → an honest
em-dash column, exactly as `computeMetricsForDraft`'s ENGINE-02 comment (lines
188-200) and the repointed WR-02 test
("gate OFF → … honest NULL-metric live-book column") state. Honesty-semantics docs
that assert a deleted data path is alive are a direct hazard for the Phase-64/65
work planned on this surface.
**Fix:** Rewrite the two JSDoc passages: gate ON → derived membership = eligible set
→ per-key union own-book blend; gate OFF → empty membership → empty added-only set →
NULL metrics (em-dash), matching the sibling columns' D1-consistent gate-off basis.

## Info

> **Resolution (FIXED @63ccbbf1):** Both comments repointed to
> `liveBaselineMetricsFromPerKeyDailies` (+1 conversion at queries.ts:2266-2269);
> removed the "not exported / out of scope" caveat (successor is exported).

### IN-01: Advisory doc-rot — two test comments still cite the deleted `liveBaselineMetricsFromHoldings`

**File:** `src/lib/scenario.test.ts:216`; `src/app/(dashboard)/allocations/widgets/performance/EquityChart.scenario.test.tsx:268-277`
**Issue:** scenario.test.ts:216 says "queries.ts::liveBaselineMetricsFromHoldings
feeds per-holding returns into computeScenario and then converts … with
`value: p.value + 1`". EquityChart.scenario.test.tsx:275 says the load-bearing +1
conversion "lives in `liveBaselineMetricsFromHoldings` (queries.ts:1706,1716). That
function is NOT exported, so a regression test on it would require a production
export change."
**Fix:** Repoint both to `liveBaselineMetricsFromPerKeyDailies` (the +1 wealth
conversion now lives at queries.ts:2266-2269). In EquityChart.scenario.test.tsx also
delete the "NOT exported" sentence — the successor IS exported (`@internal` for unit
testing), so the flagged-out-of-scope direct regression test is now writable.

> **Resolution (FIXED @a6288f7b):** All three comments now cite "the honest
> emptyDefault baseline (`emptyLiveBaselineMetrics`)".

### IN-02: queries.ts stale "snapshot reconstruction / snapshot fallback" prose contradicts the ENGINE-04 emptyDefault reality

**File:** `src/lib/queries.ts:2293-2295, 3001-3003, 2325-2328`
**Issue:** Three comments still describe the gate=false arm as "falls back to the
snapshot reconstruction" (`allActiveKeysHavePerKeyDailies` JSDoc :2293-2295; the
Phase-36 block header :3001-3003 — corrected only 50 lines later by the ENGINE-04
comment, leaving the block self-contradictory; "silently pinned to the snapshot
fallback" :2325-2328).
**Fix:** Replace "the snapshot reconstruction" with "the honest emptyDefault baseline
(`emptyLiveBaselineMetrics`)" in all three places.

> **Resolution (FIXED @86485286, + scenario-compare :1765 anchor folded into
> WR-03 @4a43495f):** Repointed the scenario-adapter.ts (2225-2251 / 2226),
> ScenarioComposer.tsx (2207-2215), scenario-compare.ts (708-711) and
> ScenarioComparePanel.tsx (1588-1608 lookups / 1710-1718 equityByApiKeyId)
> anchors. Comment-only.

### IN-03: Stale line-number anchors after the big deletions

**File:** multiple
**Issue / Fix:** Comments cite pre-deletion queries.ts / ScenarioComposer.tsx
positions:
- `scenario-adapter.ts:105` — "queries.ts:2321–2348" → the per-key unit loop is now
  queries.ts:2225-2251 (`liveBaselineMetricsFromPerKeyDailies` spans 2184-2288).
- `scenario-adapter.ts:136` — "queries.ts:2322" → now queries.ts:2226.
- `ScenarioComposer.tsx:1707` — "mirror queries.ts:2303-2310" → the equity grouping
  loop is now queries.ts:2207-2215 (:2303 is inside `allActiveKeysHavePerKeyDailies`).
- `scenario-compare.ts:311` — "ScenarioComposer.tsx:1765 — usePerKeySources = book &&
  gate" → now ScenarioComposer.tsx:1750-1751.
- `scenario-compare.ts:193` — "ScenarioComposer.tsx:702-704" → the blank switch memo
  is now :708-711.
- `ScenarioComparePanel.tsx:124` — "ScenarioComposer.tsx:686-790" → the mirrored
  derivation actually lives at :1588-1608 (lookups) and :1710-1718 (equityByApiKeyId).
Prefer symbol names over raw line numbers where possible.

> **Resolution (PARTIAL — header FIXED @5b063c9c):** The :30 header now states
> scenario-adapter is used REAL (ENGINE-01), matching :140. Per the fix scope
> the makePayload fixture-fidelity note (unproducible default per-key shape) is
> DEFERRED to a follow-up — no live oracle is lost (real-engine coverage lives in
> the DSRC / save / perKeyBook suites), so it is comment-debt, not a bug.

### IN-04: ScenarioComposer.test.tsx header contradicts the ENGINE-01 real-adapter setup, and the default payload shape is unproducible by queries.ts

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx:30,140,452-464`
**Issue:** The file header (:30) still says "scenario-adapter is module-mocked" while
:140 correctly states it is used REAL (no mock). Separately, `makePayload`'s new
default — `perKeyDailiesGateSatisfied: true` with holdings present but
`perKeyReturnsByApiKeyId: {}` / no eligible-key series — is a payload
`getMyAllocationDashboard` can never emit (`allActiveKeysHavePerKeyDailies` returns
false for that shape), so the ~24 repointed default-payload "book" tests exercise
book mode over a zero-unit engine set. The real-engine projection coverage lives in
the suites that override the per-key channel (DSRC, save/window, `perKeyBook`
helpers), so no live oracle is lost — but the fixture fidelity gap is worth a
comment or a consistent default (seed one eligible key with a series).
**Fix:** Update the :30 header; add a one-line fixture-fidelity note (or a minimal
consistent per-key default) to `makePayload`.

> **Resolution (FIXED @2615bf7a):** All three JSDoc spots now say "engine
> strategy set". Comment-only.

### IN-05: scenario-history.ts retains "de-aliased" terminology for a concept that no longer exists

**File:** `src/lib/scenario-history.ts:10-11,38-39,47`
**Issue:** "the de-aliased strategy with the least history", "where the de-aliased
set is in scope", "in the de-aliased strategy set" — the alias collapse is deleted;
the input is simply the engine strategy set (the test file was already reworded this
way in this diff).
**Fix:** Replace "de-aliased (strategy) set" with "engine strategy set" in the three
JSDoc spots.

> **Resolution (DECLINED — out of phase scope):** Pre-existing Phase-62 design,
> not introduced by Phase 63. Left documented for the Phase-64 membership work to
> decide (reopen-time membership banner or composer-side membership honoring). No
> code change this pass.

### IN-06: Composer vs compare engine-set selector divergence for a reopened book draft with stale persisted membership (pre-existing, Phase-62 design — documenting the residual edge)

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1750-1751` vs `src/app/(dashboard)/allocations/lib/scenario-compare.ts:154-187`
**Issue:** The composer selects the per-key set by `entryMode + gate` over the FULL
live eligible set; compare selects by `persisted membership ∩ eligible`. A book draft
saved with members [A,B] reopened after key C became eligible projects A+B+C in the
composer but A+B in its compare column. The holdings fingerprint drift usually masks
this (a new key normally changes holdings → the draft is not applied), but a newly
eligible key with per-key history and no current holdings rows leaves the fingerprint
unchanged and the divergence visible. Not introduced by Phase 63; recording it so the
Phase-64 membership work can decide whether the composer should honor persisted
membership on reopen.
**Fix:** None required this phase; consider a reopen-time membership banner or
composer-side membership honoring in the Phase-64 design.

## Verified Clean (adversarial checks that found no defect)

- **GUARD-03:** `git diff 4b852f13..HEAD` and `origin/main..HEAD` on
  `src/lib/scenario.ts` + `src/lib/scenario-window.ts` — both empty.
- **Dealias retirement:** zero production references to `scenario-dealias`,
  `dealiasScenario`, `collapseAliasedHoldingStrategies`,
  `mapDeAliasedWeightsToRawBasis`, `symbolByHoldingId`,
  `liveBaselineMetricsFromHoldings`, `buildStrategyForBuilderSet` outside the guard
  test's ban lists and the two stale comments flagged in IN-01.
- **ENGINE-05 guard quality:** per-file identifier-precise ban lists (no blanket
  `holding:` ban — `scenarioAum`'s legitimate `holding:` scopeRef read survives);
  queries.ts scanned with its own 3-token subset; missing scan-set file is a FAILURE
  not a skip; runtime layer covers all three surviving builders plus the
  empty-per-key reduction. Suite runs green.
- **F5 ":700 prod shape" retirement (Wave-3 deviation):** premise structurally
  deleted (`holdingsSummary`/`holdingReturnsByScopeRef`/`symbolByHoldingId` removed
  from `ScenarioCompareInputs` at the type level); the surviving pin at
  scenario-compare.test.ts:649-662 carries non-empty per-key series + gate=true and
  asserts `member_count 0` / `member_ids []` / `twr null` — a genuine series-space
  F5 closure, falsifiable against a gate-only selector.
- **gate=false SSR emptyDefault:** AUM byte-consistent with the per-key branch
  (`holdingEquityContribution` on both), all metrics null, no half-blend; the
  repointed queries.my-allocation oracles pin equality to `emptyLiveBaselineMetrics`
  AND the per-key branch's non-null contrast — both falsifiable.
- **Test dispositions elsewhere:** save-suite windowed tests repointed from a mocked
  holdings builder to REAL per-key fixtures (stronger, not weaker); bridge-seam
  repointed to a per-key membership basis with the same non-degenerate delta oracles;
  share-resolve owner-parity fixture repoint is premise-only; H-0132 adapter↔commit
  round-trip retirements are dead-premise (handleCommit reads
  `draft.weightOverrides[addedId]` + holdings-based `scenarioAum`, both still pinned
  in the composer suite, e.g. T_C_P1933).
- **Targeted suites:** phase-63 guards + scenario-adapter + scenario-compare +
  share-resolve — 86/86 pass locally (`--no-file-parallelism`).

---

_Reviewed: 2026-07-03T18:15:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

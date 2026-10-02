# Phase 113: WEIGHTS (max-DD→leverage solver) - Research

**Researched:** 2026-07-17
**Domain:** Client-side numerical solver over the BYTE-FROZEN blend engine (`scenario.ts`); Scenario Composer UI (React + pure-TS state)
**Confidence:** HIGH (engine math traced to file:line + empirically probed; monotonicity question RESOLVED with a concrete counterexample)

## Summary

Phase 113 adds a per-row **mode toggle** (`Leverage | Target max-DD`, defaulting to Leverage). In Target mode the allocator types a max-drawdown target and a **client-side numerical solver** back-solves the implied leverage by calling the frozen engine's real `r→L·r` transform + `max_drawdown` metric per trial L, then writes the derived L into the SAME `leverageByRef` path Phase 112 wired. No engine edit; `scenario.ts` stays byte-frozen (SC-3).

**The single highest-value finding — monotonicity is RESOLVED, and the answer is NO.** Portfolio max-drawdown is **NOT** monotone in a single constituent's leverage L in general. A concrete, engine-faithful numeric probe (below) shows that levering a **hedge** constituent — one whose gains land inside the aggregate's drawdown window — *reduces* portfolio max-DD (from 5.00% at L=1 to 0.00% at L=2, then its own later drawdown makes max-DD grow again). Therefore a naive bisection that assumes monotone-increasing max-DD(L) is **unsound** and would return a wrong or missed root. This is exactly why the ROADMAP/CONTEXT locked **grid-scan-then-bisect** rather than the retired closed-form — this research confirms that decision and supplies the "why."

**Primary recommendation:** Implement a pure `solveLeverageForMaxDD(...)` TS module that (1) finds the ruin-clamped feasible ceiling `L_max = min(MAX_LEVERAGE, L_ruin)` via a *monotone* ruin-predicate bisect, (2) grid-scans `max_drawdown` over `[1, L_max]` by calling `computeScenario` per trial (reusing the already-memoized `dateMapCache`/`engineSet.strategies`/`blendBasis`), (3) brackets the target crossing and bisects *within a monotone bracket* to tolerance, and (4) returns an honest `{ leverage } | { infeasible: reason }` never a fabricated value. Wire the solved L through the existing `handleLeverageChange`/`leverageByRef`/notional/save path — a solved L is just a leverage with a derived provenance.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
**WEIGHTS-03 — per-row max-DD target back-solves leverage**
- Per-row MODE TOGGLE `Leverage | Target max-DD`, **DEFAULTING to Leverage** (Target-max-DD is opt-in per row).
- The solve is NUMERICAL over a **ruin-clamped domain via grid-scan-then-bisect** on the REAL `r→L·r` transform + the engine's metrics per trial L — **NOT a closed-form approximation**.
- The derived leverage stays VISIBLE (read-only) — never hidden. The row still feeds the same engine leverage path (`leverageByRef[ref]`) that Phase 112 wired.

**⚠️ CONFLICT SURFACED (Rule 7) — numerical solver SUPERSEDES the naive closed-form.** The WEIGHTS memory framed `L = target_MaxDD / base_MaxDD` (assumes MaxDD scales LINEARLY with L). The ROADMAP Success Criteria (more recent, more specific) REJECT the closed-form and mandate the numerical grid-scan-then-bisect on the real transform — because MaxDD does NOT scale linearly with L under compounding. **The numerical approach is LOCKED; the closed-form is retired.** The memory's `target/base` is at best a grid seed, never the answer.

**WEIGHTS-04 — round-trip + honest failure states**
- A round-trip test: the solved L, re-applied through the engine, reproduces the target max-DD within tolerance.
- Honest states (never a fabricated leverage or drawdown): target UNREACHABLE at `MAX_LEVERAGE`, degenerate series (flat / all-negative / insufficient observations), non-monotonic/ill-posed domain → em-dash / explicit "unreachable" message per DESIGN.md Numbers Contract. Reuse the Phase-112 honesty patterns (sanitize-on-read, em-dash on null/non-finite, visible message on refusal).

**Reuse over reinvention (Phase-112 surface)**
- Extend the EXISTING per-row leverage control (`ScenarioComposer.tsx handleLeverageChange` / `leverageByRef`) with the mode toggle + the solver; do NOT fork a new leverage store.
- The solver writes into the SAME `leverageByRef[ref]` the engine consumes — a solved L is just a leverage value with a derived provenance.
- Honor the Phase-112 weight-basis landmines (mixed-book detection, sole-unit refuse, per-key diffCount) — the mode toggle must not reintroduce them.

**Regression tests (MANDATORY)**
- Round-trip: solved L reproduces target max-DD within tolerance (WEIGHTS-04).
- Monotonicity/convergence: the solver converges on the ruin-clamped domain (research confirms MaxDD is NOT monotone → the plan handles non-monotonicity).
- Honest failure: infeasible/degenerate → no fabricated value (RED-proof).
- `scenario.ts` freeze gate stays green (SC-3).

### Claude's Discretion
- The exact solver algorithm details (grid resolution, bisect tolerance, root-selection policy) — recommended below, founder-flagged where a product fork exists.
- The precise UI for the mode toggle + derived-L display + honest states (subject to DESIGN.md Numbers Contract).

### Deferred Ideas (OUT OF SCOPE)
- E1/E2 backbone absorption (Sharpe/TWR/equity) → 114/115.
- "+ Allocation" wizard → 116; tooltip/overflow polish → 117.
- Bidirectional weight↔leverage coupling / any weight-side re-solve — 113 solves leverage only, holding weights + other rows FIXED.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WEIGHTS-03 | per-row max-DD target back-solves implied leverage (per-row mode toggle Leverage\|Target-max-DD defaulting to Leverage; ruin-clamped grid-scan-then-bisect on the real transform; derived L stays visible) | Solver calls `computeScenario` per trial L reading `.max_drawdown` (`scenario.ts:559-574,652`); ruin ceiling from the engine's `minCumulative<=0 → max_drawdown:null` guard (`:478-507`); derived L flows into existing `leverageByRef`/notional. Monotonicity RESOLVED (§Monotonicity) → grid-scan-then-bisect is required, not optional. |
| WEIGHTS-04 | round-trip test (solved L reproduces target DD within tolerance); honest infeasible/degenerate states (never a fabricated value) | Round-trip design §Round-Trip Test; honest-state enumeration §Honest Failure States; em-dash contract DESIGN.md:160. Reuses 112 honesty patterns (`sanitizeLeverage`, em-dash notional). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| max-DD → L numerical solve | Client pure-TS module (`allocations/lib/*`) | — | Deterministic transform over engine output; no server round-trip; unit-testable in isolation |
| Per-trial `max_drawdown` evaluation | Blend engine (`scenario.ts`) | — | **BYTE-FROZEN — the solver CALLS `computeScenario`, never edits it (SC-3)** |
| Mode toggle + target input + derived-L display | Browser / Client (`ScenarioComposer` / `CompositionList`) | — | Pure UI state overlay; presentation of a draft field |
| Derived L → engine leverage path | Client state (`leverageByRef` → `projectionState.leverage`) | — | A solved L is a leverage value; reuses the Phase-112 wire verbatim |
| Leverage sanitize-on-read + ceiling | Client shared contract (`@/lib/leverage`) | — | `MAX_LEVERAGE`, `sanitizeLeverage`; the solver clamps its domain to this |
| Draft persistence of the solved L | API save routes (`saved/route.ts`) via `setLeverageOverrides` fold | Client codec | jsonb `scenarios.draft.leverageOverrides` — shape unchanged, no schema bump |

## Monotonicity: the resolved MEDIUM-confidence unknown

### The exact math (verified against `scenario.ts`)
Portfolio daily return (renormalized by the UN-levered weight mass, `scenario.ts:417-431`):

```
portDaily[i] = ( Σ_s  w_s · L_s · r_s[i] ) / ( Σ_s w_s )      over active members on day i
```

Isolating one constituent k (leverage L, all others fixed): `portDaily[i] = A[i] + L·B[i]`, where
`A[i] = (Σ_{s≠k} w_s·L_s·r_s[i]) / W` (fixed) and `B[i] = w_k·r_k[i] / W` (coefficient of L), `W = Σw_s`.

Equity curve is the **compounded product** (`scenario.ts:447-452`):
`cumulative[t] = ∏_{i≤t} (1 + A[i] + L·B[i])`.

max_drawdown is the deepest peak-to-trough on that curve (`scenario.ts:559-574`), with `peak` **initialized to `cumulative[0]`** (the first day's post-return value — the day-0 loss is not itself counted as drawdown). The engine returns `max_drawdown: null` when any `cumulative[i] ≤ 0` or non-finite (the ruin guard, `:478-507`).

### VERDICT: max-DD is NOT monotone in L. [VERIFIED: numeric probe replicating scenario.ts:417-574]

Because each factor `1 + A[i] + L·B[i]` is linear in L but the curve is their **product**, and drawdown is a max over peak/trough *pairs*, the effect of L depends on **where in time** constituent k's gains/losses fall relative to the aggregate's peak-to-trough windows. A constituent that gains during the rest of the book's drawdown window is a **hedge**: increasing its leverage adds positive returns inside the critical window and **reduces** portfolio max-DD.

An engine-faithful probe (renorm blend + compounded max-DD, ruin guard) produced:

**Counterexample (hedge leg, w=0.5 each; A gains while B draws down):**
```
A.r = [+0.10, +0.10]   B.r = [-0.20, -0.20]      (lever A)
  L=1.00  maxDD = -5.000%
  L=1.50  maxDD = -2.500%
  L=1.75  maxDD = -1.250%
  L=2.00  maxDD =  0.000%     <-- magnitude DECREASED as L rose
```
The magnitude of max-DD **falls** as the hedge's leverage rises — a strictly decreasing region. Combine with the same leg's *own* later drawdown window (which grows with L) and max-DD(L) becomes non-monotone (decreasing then increasing → an interior minimum in the general case). A plain bisect assuming monotone-increasing max-DD would return the wrong root or miss the target entirely.

**Contrast — the common monotone regimes** (also probed): a single-constituent book (`portDaily = L·r`) and any book where the levered leg *drives* the binding drawdown window are monotone-increasing in magnitude until ruin. Real allocator books are **often** monotone — but the solver must **not assume it**, because the hedge case is real and silent.

### Ruin boundary IS monotone (exploit it)
The ruin predicate — "does some day have `1 + A[i] + L·B[i] ≤ 0`?" — **is** monotone in L: for the binding day, `B[i] < 0` (a down day for k), so `1 + A[i] + L·B[i]` is strictly decreasing in L. Once ruined at L*, every L > L* is also ruined (an up-set). So `L_ruin` (the smallest ruinous L) can be found by a **monotone bisect on the ruin predicate** — cheap and safe. Probe confirmation: a −0.30 day at w=0.5 (other legs ≈0) ruins at `L ≈ (1 + 0.5·0.02)/(0.5·0.30) = 6.73`, i.e. **below** `MAX_LEVERAGE=10` — ruin genuinely clamps the domain for volatile crypto legs.

### What this dictates for the plan (the locked grid-scan-then-bisect, made precise)
1. **Feasible domain** `[1, L_max]`, `L_max = min(MAX_LEVERAGE, L_ruin − ε)`. Find `L_ruin` by the monotone ruin-predicate bisect (≈12 evals). If `computeScenario` at L=1 already returns `max_drawdown: null` (degenerate/insufficient), short-circuit to an honest state.
2. **Grid-scan** `max_drawdown(L)` over `[1, L_max]` at a fixed resolution (recommend ~24–40 points, or step ≤ 0.25). Record `(L, dd)` samples.
3. **Bracket** every adjacent pair `(L_j, L_{j+1})` where the target lies between `dd(L_j)` and `dd(L_{j+1})`. Within a bracket the curve is monotone → **bisect to tolerance** on the REAL engine.
4. **Root-selection policy** (a genuine fork — see Assumptions A1): on multiple roots, return the **smallest L** that reproduces the target (least leverage for the requested risk — conservative). On a unique root (monotone book) it is unambiguous.
5. **Infeasible** → honest reason (never clamp-and-lie): target below `dd(1)` magnitude → "already ≥ target at 1×"; target beyond `dd(L_max)` magnitude → "unreachable at {L_max}×"; flat/all-null grid → degenerate.

## Solver architecture + engine-eval budget

**Where it runs:** client-side, a pure function `solveLeverageForMaxDD({ strategies, state, dateMapCache, periodsPerYear, ref, target, maxLeverage })` in `allocations/lib/` (new module). It loops the frozen `computeScenario` — **no engine entry point is added, and no engine math is duplicated** (duplicating the portDaily/maxDD loop would create the exact drift SC-3 exists to prevent — see Don't Hand-Roll).

**Per-trial evaluation (assemble engine input per trial — confirmed the right pattern):**
```ts
// The stable inputs already exist + are memoized in ScenarioComposer:
//   engineSet.strategies (ScenarioComposer.tsx:2413-2416)
//   dateMapCache = buildDateMapCache(engineSet.strategies)  (:2460-2465)  <-- built ONCE, reused
//   blendBasis (periodsPerYear)  (:2703-2709)
// Per trial L, clone only the leverage entry for `ref`:
const trialState = { ...engineState, leverage: { ...engineState.leverage, [ref]: L } };
const dd = computeScenario(engineSet.strategies, trialState, dateMapCache, blendBasis).max_drawdown;
```
The `dateMapCache` is the load-bearing reuse: it is NOT rebuilt per trial (that would rescan every series), so each trial is just the O(m·T) blend + O(T) drawdown + the engine's O(m²·T) correlation matrix.

**Eval budget per solve:** ruin bisect ≈12 + grid ≈24–40 + in-bracket bisect ≈15 ≈ **~50–70 `computeScenario` calls**. For a realistic book (m≈10 constituents, T≈1500 days): ~10M ops, **sub-20ms** — interactive. The engine's correlation matrix is wasted work per trial (the solver needs only `max_drawdown`) but the engine is frozen, so accept it; memoize `dd` by rounded L within a single solve to skip repeats. **Debounce**: solve on input *commit* (blur/Enter), not per keystroke — mirrors the existing commit discipline. Flag perf as an Assumption only if books can be very large (§A3).

**Engine entry point check (RED-FLAG audit):** the solver needs *only* `computeScenario(...).max_drawdown`, which already exists and is exported (`scenario.ts:226`, `:652`). **No missing engine entry point → no SC-3 pressure.** Confirmed: no engine change is needed.

## Existing infra → gap map (mirrors 112-RESEARCH format)

| Capability | Phase 112 provides (file:line) | Phase 113 adds |
|------------|-------------------------------|----------------|
| Per-row leverage input + clamp | `handleLeverageChange` clamps [0,MAX_LEVERAGE] with visible message (`ScenarioComposer.tsx:1172-1194`) | Solver output routes THROUGH this same handler → same clamp, same message channel |
| Leverage overlay store | `leverageByRef` useState + `setLeverageByRef` (`:885,1193`) | Solved L is written here — no new store; provenance is derived, value is identical to a typed L |
| Engine leverage path | `projectionState.leverage[ref]` → `computeScenario` `wᵢ·Lᵢ·rᵢ` (`:2390-2391`, `scenario.ts:427`) | Solver's trial states reuse this exact path per trial |
| Memoized engine inputs | `engineSet.strategies`, `dateMapCache` (`:2460-2465`), `blendBasis` (`:2703-2709`) | Solver loops `computeScenario` over these STABLE inputs (reuse = the perf win) |
| Derived read-only notional (equity×L) | `notionalText(ref)` reads `leverageByRef[ref]` (`:5043-5053`) | A solved L flows through automatically → "derived L stays visible" via the existing column, no new display needed |
| Save persistence of a leverage | `setLeverageOverrides` fold at Save + `pruneLeverageToDraftRefs(... eligiblePerKeyIds)` keep-signal (`:724-746,2293-2296`) | A solved L persists identically — eligibility is the keep signal, independent of how L was produced. No schema bump. |
| Leverage sanitize + ceiling | `MAX_LEVERAGE=10`, `sanitizeLeverage`/`sanitizeLeverageMap` (`leverage.ts:36,79-118`) | Solver clamps its domain to `[1, min(MAX_LEVERAGE, L_ruin)]`; solved L re-sanitized on read like any L |
| **Per-row mode toggle (Leverage \| Target max-DD)** | — | **NEW** — per-row UI state, defaults to Leverage |
| **Target max-DD input + one-shot solve trigger** | — | **NEW** — transient UI state; triggers the solver on commit |
| **The solver module** | — | **NEW** — pure TS `solveLeverageForMaxDD` in `allocations/lib/` |
| **Honest infeasible/degenerate states** | em-dash + `setCommitError` patterns exist | **NEW** — target-specific honest copy ("unreachable at {L}×", "already ≥ target at 1×", "insufficient history") |

**Bottom line:** everything downstream of "a leverage value on a row" already exists and is battle-tested. Phase 113 adds the **mode toggle UI + the solver + the honest-state copy**. A solved L is just a leverage — it inherits the entire 112 display/save/sanitize surface for free.

## Honest failure / degenerate states (WEIGHTS-04)

| Case | Engine signal | Solver result | Honest UI (DESIGN.md Numbers Contract) |
|------|---------------|---------------|----------------------------------------|
| Target below unlevered max-DD magnitude (`|target| < |dd(1)|`) | `dd(1)` finite, already deeper | `{ infeasible: "below-min" }` | "Already ≥ target drawdown at 1× — reduce leverage isn't modeled (min 1×)." Derived-L cell = `—`. |
| Target unreachable at `L_max` (`|target| > |dd(L_max)|`) | `dd(L_max)` finite, shallower than target | `{ infeasible: "unreachable", ceiling: L_max }` | "Unreachable at {L_max}× (ruin/leverage ceiling)." Derived-L cell = `—`. |
| Flat series (all r=0 for the row → dd≈0 for all L) | `dd(L)=0` ∀L | any target>0 → unreachable; target=0 → trivial L=1 | "No drawdown in this series — target not applicable." `—`. |
| All-negative series | `dd(L)` finite, monotone-steep | solve normally (usually monotone) | normal derived L (honest — it will be a low L) |
| Insufficient observations (`n<10`) | `max_drawdown: null` (`scenario.ts:378-397`) | `{ infeasible: "insufficient-history" }` | "Insufficient history to model drawdown." `—`. |
| Ruin at/below L=1 (catastrophic day) | `max_drawdown: null` at L=1 | `{ infeasible: "degenerate" }` | "Series can't be modeled at 1× (data quality)." `—`. |
| Non-monotone / multiple roots | grid brackets ≥2 crossings | return smallest-L root (A1) | show the derived L; no fabricated "exact" claim — it reproduces target within tolerance |

**The load-bearing rule (DESIGN.md:160):** null / non-finite / infeasible → **em-dash `—`, never `0`, never a fabricated leverage or drawdown.** An infeasible target must never silently clamp to `MAX_LEVERAGE` and display it as if it hit the target — that is the exact dishonesty WEIGHTS-04 forbids.

## Round-trip test design (WEIGHTS-04)

**Goal:** prove the solved L, RE-APPLIED THROUGH THE REAL ENGINE, reproduces the target within tolerance — and make it **non-tautological** (the assertion must re-feed the engine, not the solver's own internal cache).

**Design:**
1. Fixture: a deterministic ≥2-constituent book with hand-authored `daily_returns` (≥10 obs) whose `max_drawdown` at a few L values is known, INCLUDING a hedge leg so the non-monotone path is exercised (reuse the probe fixtures above as vitest fixtures).
2. **Forward-then-back (non-tautological):** pick a trial `L* = 2.5`; compute `target = computeScenario(strategies, {leverage:{ref:L*}}, cache, basis).max_drawdown`. Solve `solveLeverageForMaxDD(... target)` → `L_solved`. Assert BOTH:
   - `|L_solved − L*| ≤ L_tol` (the solver found the leverage), AND
   - `|computeScenario(strategies, {leverage:{ref:L_solved}}, cache, basis).max_drawdown − target| ≤ dd_tol` (re-fed through the ENGINE, not the solver — this is what makes it non-tautological).
3. **Monotone + non-monotone fixtures both covered.** For the hedge fixture, assert the smallest-L root policy (A1) explicitly.
4. **Infeasible fixtures** assert the solver returns the honest reason and NOT a leverage value (RED-proof: a stub that returns `MAX_LEVERAGE` must fail).

**Tolerances (founder-flag exact values — A2):** `dd_tol ≈ 1e-3` (the engine rounds `max_drawdown` to 5 decimals via `toFixed(5)`, `scenario.ts:652`, so ≤1e-3 is safely above rounding), `L_tol ≈ 1e-2` (bisect to ~1e-3 in dd yields L to ~1e-2 on a curve with slope O(0.1/×)). These are recommendations, not locked.

## Landmine check — mode toggle vs Phase-112 weight-basis landmines (Q7)

**The solver writes LEVERAGE only — never weight.** All three Phase-112 landmines are WEIGHT-edit concerns and are structurally untouched:
- **Mixed-book renorm (CR-01, 112-VERIFICATION:110):** fires only on a WEIGHT edit's renorm basis. Leverage edits never renormalize weights (`handleLeverageChange` only writes `leverageByRef`). ✓ Not reintroduced.
- **Sole-unit refuse (RT-01):** a single constituent is always 100% *weight*; a leverage on a sole unit is perfectly valid (`portDaily = L·r`). The solver runs fine on a sole-unit book. ✓ No refuse needed.
- **Per-key diffCount (WR-01):** `leverageByRef` is deliberately OUT of `diffCount` (stamped at Save via `setLeverageOverrides`, kept out of autosave — 112). A solved L is a leverage → same treatment → does NOT count toward `diffCount`, exactly like a typed leverage. Consistent. ✓
- **Persist across Save:** a solved L on an included per-key row survives Save→reopen via the 112 `pruneLeverageToDraftRefs(... eligiblePerKeyIds)` keep-signal — the keep is by eligibility, independent of provenance. ✓ Confirm with a regression test (mirror 112 Pitfall-1 test).

**One genuine new interaction (not a 112 landmine): staleness.** The solved L is computed against a SNAPSHOT (holding other rows' weights/leverage fixed). If the allocator then changes another row's weight/leverage or this row's weight, the displayed derived L no longer reproduces the target. **Recommended handling (A1):** the solve is a **one-shot calculator** — entering Target mode + committing a target WRITES a leverage; thereafter it is a normal leverage (no live re-solve cascade). This matches the locked "holding others fixed" method and avoids a coupled multi-row fixed-point. Making it a LIVE constraint would require simultaneous cross-row solving — explicitly out of the locked scope.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-trial max-DD | A hand-copied portDaily+compound+maxDD loop in the solver | `computeScenario(...).max_drawdown` (frozen engine) | Duplicating the engine loop is the exact drift SC-3 forbids; the engine is the single source of the transform + ruin guard + rounding |
| Root finding on a non-monotone curve | A plain bisect on `[1, MAX_LEVERAGE]` | Ruin-clamped domain → grid-scan → bisect within a monotone bracket | max-DD is NOT monotone (§Monotonicity, proven) — a plain bisect returns wrong/missed roots on hedge legs |
| Leverage bounds/validation | A zod `.min/.max` refine on the target or solved L | `sanitizeLeverage` on read + `handleLeverageChange` clamp | A refine failure resets → deletes the draft (`leverage.ts:19-21`) — the standing 112/90.5 guard |
| Leverage state for the solved value | A new "solvedLeverage" map | Reuse `leverageByRef` + `setLeverageOverrides` save-fold | A solved L IS a leverage; one overlay, one save-fold, one sanitize — no divergent store |
| Derived-L display | A new read-only leverage panel | The existing notional column already reads `leverageByRef[ref]` (`:5043-5053`) | "Derived L stays visible" is satisfied by the value already flowing to the row |
| Domain ceiling | Guessing `MAX_LEVERAGE` is always the ceiling | Monotone ruin-predicate bisect → `L_ruin`, then `min(MAX_LEVERAGE, L_ruin)` | Ruin can bite BELOW 10× for volatile legs (probe: ~6.73×) — clamping at 10 would scan an infeasible (null-dd) region |

**Key insight:** every primitive except the solver + the mode toggle already exists. The phase is a pure-TS solver composed over the frozen engine + a UI affordance — not new engine machinery.

## Common Pitfalls

### Pitfall 1: Assuming monotonicity and bisecting `[1, MAX_LEVERAGE]`
**What goes wrong:** max-DD is not monotone in L (proven). A plain bisect on a hedge leg converges to the wrong root or reports "no solution" when one exists.
**How to avoid:** Grid-scan first; bisect only inside a bracket where the endpoints straddle the target (locally monotone). Cover a hedge fixture in tests.
**Warning signs:** Solver returns a wildly wrong L on a negatively-correlated leg; round-trip test on the hedge fixture fails.

### Pitfall 2: Scanning past the ruin ceiling
**What goes wrong:** Above `L_ruin`, `computeScenario` returns `max_drawdown: null`. Treating null as `0` or as "target not yet reached → raise L" pushes into the null region and either loops or fabricates.
**How to avoid:** Compute `L_max = min(MAX_LEVERAGE, L_ruin − ε)` first via the monotone ruin bisect; never sample above it; treat any null dd in-domain as a degenerate short-circuit.
**Warning signs:** Derived L pinned at MAX_LEVERAGE with an em-dash drawdown, or a solve that never terminates.

### Pitfall 3: Silent clamp-and-lie on an infeasible target
**What goes wrong:** Returning `MAX_LEVERAGE` (or `1`) as if it hit the target when the target is unreachable — the exact dishonesty WEIGHTS-04 forbids.
**How to avoid:** The solver returns a discriminated union `{ leverage } | { infeasible: reason }`; the UI renders `—` + honest copy for the infeasible branch (DESIGN.md:160).
**Warning signs:** A target far outside the achievable range shows a confident leverage + drawdown.

### Pitfall 4: Duplicating engine math for "speed"
**What goes wrong:** A hand-rolled max-DD loop in the solver drifts from the frozen engine (rounding, ruin guard, renorm-by-unlevered-mass, peak-from-`cumulative[0]`) → the solved L reproduces the solver's math, not the engine's.
**How to avoid:** Call `computeScenario` per trial. Perf is fine (~50–70 calls, sub-20ms). Memoize by rounded L within a solve.
**Warning signs:** Round-trip test passes against the solver but fails when re-fed through `computeScenario`.

### Pitfall 5: Re-solving live on every unrelated edit
**What goes wrong:** Treating Target mode as a live constraint triggers a cross-row re-solve cascade (change B's weight → A's L re-solves → portfolio moves → …), a coupled fixed-point not in scope.
**How to avoid:** One-shot calculator (A1) — solve on target commit, write a plain leverage, done.
**Warning signs:** Editing one row visibly churns another row's derived L; solve runs per keystroke.

## Runtime State Inventory

> Phase 113 is client UI + a pure client solver over the frozen engine. Same surface as 112.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `scenarios.draft.leverageOverrides` (optional jsonb map) holds the solved L exactly as it holds a typed L. The per-row MODE + TARGET are transient UI state (recommended NOT persisted — A1 one-shot). | Code edit only — no data migration, **no `schema_version` bump** (a solved L is a new value in an existing map, per 112 Pitfall 4). |
| Live service config | None — no external service embeds this state. | None |
| OS-registered state | None. | None — verified (pure browser/client + Next.js route). |
| Secrets/env vars | None. | None |
| Build artifacts / migrations | No DDL, no Supabase migration, no test-project migration — jsonb shape unchanged. | None — verified (no `.sql` in scope). |

**Nothing found** in Live service config, OS-registered state, Secrets, or migrations — verified by the same reasoning as 112 (identical client-only surface; leverage persistence path unchanged).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (+ `@vitest/coverage-v8`) [CITED: `.planning/phases/112-.../112-RESEARCH.md`; confirm via `npx vitest --version`] |
| Config file | `vitest.config.ts` (coverage thresholds: lines 82 / stmts 80 / funcs 74 / branches 72) |
| Quick run command | `npx vitest run src/app/\(dashboard\)/allocations --no-file-parallelism` |
| Full suite command | `npm test` (sharded in CI with `--coverage`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WEIGHTS-03 | Solver converges on a monotone book; grid+bisect returns correct L | unit | `npx vitest run src/app/\(dashboard\)/allocations/lib/solve-leverage.test.ts` | ❌ Wave 0 |
| WEIGHTS-03 | Solver handles a NON-MONOTONE hedge fixture (smallest-L root policy A1) | unit | same file | ❌ Wave 0 |
| WEIGHTS-03 | Ruin ceiling `L_ruin < MAX_LEVERAGE` respected; no scan into null region | unit | same file | ❌ Wave 0 |
| WEIGHTS-04 | Round-trip: solved L re-fed through `computeScenario` reproduces target within tol (non-tautological) | unit | same file | ❌ Wave 0 |
| WEIGHTS-04 | Infeasible/degenerate → honest reason, never a fabricated leverage (RED-proof) | unit | same file | ❌ Wave 0 |
| WEIGHTS-03 | Mode toggle renders (default Leverage); Target mode shows target input + derived-L read-only; em-dash on infeasible | component | `npx vitest run src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx` | ✅ (extend) |
| WEIGHTS-03 | Solved L survives Save→reopen (reuses 112 prune keep-signal) | component | `ScenarioComposer.test.tsx` | ✅ (extend) |
| SC-3 freeze | `scenario.ts` byte-frozen | gate | `git diff --exit-code src/lib/scenario.ts` + `npx vitest run src/lib/scenario-backbone-gates.test.ts` | ✅ |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test file> --no-file-parallelism`
- **Per wave merge:** `npx vitest run src/app/\(dashboard\)/allocations src/lib/scenario.test.ts src/lib/leverage.test.ts`
- **Phase gate:** full suite green + `git diff --exit-code src/lib/scenario.ts` clean before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `allocations/lib/solve-leverage.test.ts` — solver unit tests: monotone convergence, hedge non-monotone (smallest-L root), ruin-clamp, round-trip (non-tautological), infeasible/degenerate honest states. Reuse the §Monotonicity probe fixtures as vitest fixtures.
- [ ] `ScenarioComposer.test.tsx` — mode toggle default-Leverage; Target mode input + read-only derived L; em-dash on infeasible; solved-L Save→reopen survival.
- [ ] No new framework install — Vitest present.

## Security Domain

> `security_enforcement` default (enabled). This phase adds a client-side numerical solver over an in-browser data structure; no auth/session/network/crypto surface.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no auth surface) |
| V3 Session Management | no | — |
| V4 Access Control | no | solver runs on the allocator's own already-authorized draft |
| V5 Input Validation | yes | Target-max-DD input clamped/validated like leverage; non-finite/out-of-range → honest reject, never poison the curve (mirror `handleLeverageChange` + `sanitizeLeverage`) |
| V6 Cryptography | no | — (never hand-roll; N/A) |

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed target input (NaN/Inf/negative) poisoning the solve | Tampering | Validate on commit; `Number.isFinite` guard; clamp to a sane target range; degenerate → honest em-dash (reuse 112 clamp-with-visible-message) |
| A tampered persisted leverage (solved value) rehydrated | Tampering | `sanitizeLeverageMap` on read already coerces out-of-range → 1/MAX with a Sentry signal (`leverage.ts:79-118`) — inherited free |

## Environment Availability

> Skip — phase is client TS + tests only, no external tools/services/runtimes beyond the existing Node/Vitest toolchain already used by 112.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `L = target_MaxDD / base_MaxDD` closed-form (WEIGHTS memory) | Ruin-clamped grid-scan-then-bisect on the real engine | ROADMAP 113 Success Criteria (2026-07-17 CONTEXT) | Closed-form RETIRED — it assumes linear max-DD-in-L, which is false under compounding AND non-monotone for hedge legs (proven here) |

**Deprecated/outdated:**
- The two-way `target/base` closed-form: usable only as an initial grid seed, never as the answer.

## Package Legitimacy Audit

> Not applicable — Phase 113 installs **no external packages**. It composes existing in-repo modules (`scenario.ts`, `leverage.ts`, `ScenarioComposer.tsx`) and the existing Vitest toolchain. No npm/PyPI/crates additions.

## Project Constraints (from CLAUDE.md / AGENTS.md / DESIGN.md)
- `scenario.ts` is BYTE-FROZEN (SC-3) — the solver CALLS it, never edits it. Confirmed no engine entry point is missing → no SC-3 pressure.
- Coverage is a BLOCKING CI gate (lines 82 / stmts 80 / funcs 74 / branches 72). The new solver module + UI must carry tests or coverage regresses.
- DESIGN.md Numbers Contract governs all numeric rendering: max drawdown 2dp; **null/infeasible → em-dash `—`, never `0`, never fabricated** (`DESIGN.md:158-164`). Read DESIGN.md before adding the mode toggle / derived-L cell.
- AGENTS.md: customized Next.js — read `node_modules/next/dist/docs/` before any Next-specific code (this phase is a client component, minimal Next surface).
- Regression-first: every honest-state and the round-trip must have a test that fails without the fix (RED-proof the infeasible branch and the non-monotone root).
- Feature-branch + PR; `/ship` to commit; never commit from main.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ✅ **RESOLVED (founder 2026-07-17) — with a KEY CORRECTION.** One-shot calculator ✅, smallest-L ✅, transient mode/target (only solved L persists) ✅. **BUT the target is the SLEEVE's OWN standalone max-DD, NOT the portfolio's** (see A5). That makes the solve a MONOTONE bisect with a UNIQUE root — the non-monotone multiple-root machinery is NOT needed for the solve. The resulting PORTFOLIO-level max-DD is ALSO shown (a computed display value, not solved). See CONTEXT "FOUNDER DECISION LOCK". | Monotonicity §4, Landmine §, Runtime State | Resolved — solver simplifies (monotone sleeve bisect); non-monotonicity now applies only to the DISPLAYED portfolio DD. |
| A2 | **[ASSUMED]** Tolerances `dd_tol ≈ 1e-3`, `L_tol ≈ 1e-2`; grid ~24–40 points / step ≤0.25. | Round-Trip Test | If tighter tolerance is required, more bisect iters (still cheap); if looser, faster. Low risk — a number to confirm, not a redesign. |
| A3 | **[ASSUMED]** ~50–70 `computeScenario` calls per solve is interactive (sub-20ms) for realistic books (m≈10, T≈1500); debounce on commit. | Solver architecture | If books can be very large (m≫20), the O(m²·T) correlation work per trial could bite; mitigation is memoize-by-L + solve-on-commit (already recommended). |
| A4 | **[ASSUMED]** Vitest 4.1.2 is still the framework (carried from 112-RESEARCH). | Validation Architecture | Trivial — confirm via `npx vitest --version`; does not affect the plan. |
| A5 | ✅ **RESOLVED (founder 2026-07-17).** EXACT-match ✅ ("solve L such that max-DD ≈ target"), NOT a budget/cap. **And the target is on the SLEEVE (single constituent standalone), not the portfolio** — founder: "Max dd for sleeve, not for entire portfolio. Unleveraged max dd is 5% of the sleeve; client wants it at 20% → leverage 4×." Sleeve max-DD source = `computeScenario({one constituent, weight 1, leverage L}).max_drawdown` (engine reduces to `L·rᵢ` for a single weight-1 unit). Monotone in L → unique root. | Monotonicity §4 | Resolved — sleeve-level exact-match, monotone, unique root. |

## Open Questions (RESOLVED)

1. **Target semantics + root-selection** (A1/A5) — ✅ **RESOLVED (founder 2026-07-17), see Assumptions A1/A5 + CONTEXT "FOUNDER DECISION LOCK".** Exact-match, smallest-L, one-shot — AND the KEY correction: the target is the **SLEEVE's OWN standalone max-DD, not the portfolio's** (5%→20%→~4×). That makes the solve MONOTONE with a unique root; the non-monotone-portfolio machinery is NOT built (portfolio DD is display-only). The "two roots" concern only existed under the (superseded) portfolio-level reading.

2. **Persist mode+target, or only the solved L?** — ✅ **RESOLVED: only the solved L persists** (via the Phase-112 `leverageByRef` path); mode + target are transient UI state. No `SCENARIO_SCHEMA_VERSION` bump. Locked in CONTEXT, implemented in Plan 113-03.

## Sources

### Primary (HIGH confidence)
- `src/lib/scenario.ts:100-138,226-431,445-574,645-667` — frozen engine: `ScenarioState.leverage`, renorm-by-unlevered-mass blend (`wᵢ·Lᵢ·rᵢ`), compounded cumulative, ruin guard (`minCumulative<=0 → null`), max-DD loop (peak init `cumulative[0]`), `n<10 → null`, `max_drawdown` rounding `toFixed(5)`.
- `src/lib/leverage.ts:36,79-118` — `MAX_LEVERAGE=10`, `sanitizeLeverage`/`sanitizeLeverageMap`, no-zod-refine guard.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:724-746,885,1172-1194,2293-2296,2359-2416,2460-2465,2703-2715,5043-5053` — leverage overlay + clamp handler, projectionState.leverage wiring, memoized `engineSet`/`dateMapCache`/`blendBasis`, the single `computeScenario` call, prune keep-signal, derived notional (equity×L).
- `.planning/phases/112-.../112-RESEARCH.md`, `112-VERIFICATION.md:110-116` — the 112 leverage surface, A1/Route-1 lock, the weight-basis landmines (CR-01 mixed-book, WR-01 diffCount, RT-01 sole-unit) — all confirmed weight-only concerns.
- `.planning/ROADMAP.md:139-151`, `.planning/REQUIREMENTS.md:37-38`, `113-CONTEXT.md` — 113 Success Criteria + WEIGHTS-03/04 + the surfaced closed-form conflict.
- `DESIGN.md:148-164` — Numbers Contract (max-DD 2dp; em-dash null rule).
- **Empirical probe** (this session, not committed) — engine-faithful replica of `scenario.ts:417-574` proving non-monotonicity (hedge leg: max-DD 5.00%→0.00% as L 1→2) and the ruin ceiling (~6.73× for a −0.30 day at w=0.5). [VERIFIED: numeric probe]

### Secondary (MEDIUM confidence)
- MEMORY `project_v1_11_weights_leverage_maxdd_spec` — the retired closed-form + leverage-invariance context.

## Metadata

**Confidence breakdown:**
- Monotonicity verdict: HIGH — resolved by direct math + an engine-faithful numeric counterexample (the whole point of this research).
- Solver architecture + eval budget: HIGH — traced to the exact memoized inputs + the single `computeScenario` call site.
- Existing-infra map: HIGH — every claim traced to file:line; a solved L inherits the 112 surface.
- Honest-state / round-trip design: HIGH on the contract; tolerances are recommendations (A2).
- Product forks (A1/A5): flagged for founder — these are decisions, not code uncertainties.

**Research date:** 2026-07-17
**Valid until:** ~2026-08-16 (stable — engine frozen, no external deps).

## RESEARCH COMPLETE

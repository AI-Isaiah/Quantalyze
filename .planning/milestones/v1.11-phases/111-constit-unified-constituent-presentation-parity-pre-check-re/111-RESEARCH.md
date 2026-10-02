# Phase 111: CONSTIT — unified constituent presentation - Research

**Researched:** 2026-07-16
**Domain:** React composer reshape (frontend presentation) + an independent numpy/pandas blend-parity oracle (analytics-service test tier)
**Confidence:** HIGH on the code trace + blend formula + gate mechanics; MEDIUM on the exact semantic the founder means by "per-position weighted blend" (documented as the primary open question — it is *the* gated unknown by design).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **CONSTIT-05 (GATE, FIRST DELIVERABLE, outcome deferred to execution):** the first plan/task is an independent numpy/pandas re-derivation on a REAL multi-position fixture proving `per-key daily series == the current per-position weighted blend the composer renders today`. Independent = do NOT call `scenario.ts`/the app blend; re-derive from raw per-position/per-key data with pandas and compare.
  - **If it MATCHES:** record "parity verified" + fixture + tolerance in the phase docs; proceed to the UI.
  - **If it DIVERGES:** STOP the UI. Record a deliberate re-baseline decision in `.planning/PROJECT.md` Key Decisions (new canonical blend definition + why), re-verify against the NEW definition, surface to founder before committing (it changes displayed numbers). No CONSTIT UI merges before this gate is green.
- **CONSTIT-01/02:** composer presents every source (api-key / CSV / catalog / composite) as ONE uniform constituent row in a single list. DELETE the separate "Data Sources" section in `ScenarioComposer.tsx` (grep the WHOLE repo incl. `e2e/` for orphaned "Data Sources"/`dataSources` strings BEFORE disclosure-delete). Each row shows a provenance badge with the fixed taxonomy **api-verified · csv · self-reported · composite** — presentation-only, driven by existing source metadata; follow DESIGN.md badge/token conventions (no new colors outside the DESIGN.md allowlist). Row layout follows DESIGN.md (mono numerics, sign-only color, radius ladder); reuse existing composer row components.
- **CONSTIT-03:** a book seed collapses to strategy/key-level constituents (NOT per-coin rows — per-coin holdings stay on the Holdings tab). Toggling a source off uses the SAME include/exclude mechanism as toggling any other constituent off (one mechanism, not a special-case path for data sources).
- **CONSTIT-04:** `scenario.ts` byte-frozen (SC-3 keep-gate stays green); whole-repo grep (incl. `e2e/`) confirms zero orphaned deleted Data-Sources strings before disclosure-delete. If any change appears needed in `scenario.ts`, STOP — it means the reshape leaked into the engine.
- Mandatory regression/gate tests: CONSTIT-05 committed re-runnable parity test; CONSTIT-01/02 single-list + per-row badge + NO Data-Sources-section test; CONSTIT-04 SC-3 freeze gate + repo-wide grep gate.
- Plan with `--skip-ui` (reshape under the codified DESIGN.md, not greenfield).

### Claude's Discretion
- Exact fixture chosen for the parity check (real multi-position/multi-key — test allocator `a11ca111-1111-4111-8111-111111111111` or an existing composite fixture).
- Provenance badge visual (within DESIGN.md), exact row component reuse, test file placement.

### Deferred Ideas (OUT OF SCOPE)
- Per-constituent weights + leverage editing → Phase 112/113.
- E1/E2 backbone absorption (Sharpe/TWR/equity) → Phase 114/115.
- Per-coin holdings promotion into the constituent list — deliberately NOT done (holdings stay on Holdings tab).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONSTIT-01 | Every source is one uniform weightable constituent row (no separate "Data Sources" section) | Data-Sources removal map + CompositionList row model below (file:line) |
| CONSTIT-02 | Provenance badge per row (api-verified / csv / self-reported / composite) | Existing `TrustTierLabel` + `TRUST_TIER_TOKENS`; **metadata-threading gap flagged** (A2) |
| CONSTIT-03 | Book seed collapses to strategy/key-level constituents; shared off-toggle | Per-key unit builder + the two divergent toggle channels to unify below |
| CONSTIT-04 | `scenario.ts` byte-frozen; whole-repo grep clears orphaned strings before delete | SC-3 gate mechanics + grep results below |
| CONSTIT-05 | Independent numpy/pandas re-derivation == current per-position weighted blend, OR recorded re-baseline | Parity re-derivation recipe below (formula, inputs, fixture, tolerance, divergence list) |
</phase_requirements>

## Summary

CONSTIT is a **presentation/wiring reshape** of one 5,108-line file (`ScenarioComposer.tsx`) plus a **committed pandas parity oracle** in `analytics-service/`. The frozen engine `src/lib/scenario.ts` (`computeScenario`) already consumes a single unified `StrategyForBuilder[]` list and does ALL blend math — the milestone premise holds and is verified below. The composer today feeds that engine one `StrategyForBuilder` per `api_key_id` (the per-key path, `usePerKeySources`), so the "unified constituent" engine already exists; the phase makes the **UI** match by (a) deleting the separate "Data sources" toggle section, (b) rendering every source as one row in `CompositionList` with a provenance badge, (c) collapsing per-coin holdings off the list, and (d) routing the per-key include/exclude through the same channel added strategies use.

The **gate (CONSTIT-05)** is the real unknown and must land first. The composer's rendered book blend is: one per-key TWR series per `api_key_id` (from `csv_daily_returns`, derived by the analytics-service NAV/TWR reconstruction), weighted by each key's **current** equity share (fixed across the window), arithmetically blended per day, then compounded (`Π(1+r)`). An independent pandas re-derivation from the SAME raw per-key/per-position inputs — never importing `scenario.ts` — must reproduce this cumulative curve + KPIs within tolerance. The genuinely open question is whether "per-position weighted blend" means the fixed-weight per-key blend the composer already computes (near-tautological → expect exact parity) or a **time-varying per-position book return** (weights drift daily) — the latter can legitimately diverge and would force the re-baseline branch. The plan must construct a fixture that *exercises* weight drift and cashflows so the answer is informative, not a trivial all-equal pass.

**Primary recommendation:** Ship the gate as a **deterministic, committed pandas test** (fixture built like `seedCompositeStrategy`'s sin-based series — no RNG, no live DB, because live-DB tests are `skipif`-gated and never run in CI). Re-derive the blend two ways in pandas — fixed-weight-per-key (composer semantics) AND time-varying-per-position — and report both against the frozen-engine output captured as a committed JSON snapshot. If fixed-weight matches and time-varying diverges, that IS the founder decision to surface. Only after the gate is green do the UI plans (delete Data-Sources section, unify rows + badges, one toggle) proceed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Blend math (weighted daily sum → compound → TWR/vol/Sharpe/maxDD) | Frozen engine (`src/lib/scenario.ts`) | — | Byte-frozen; ALL math already here (`computeScenario`). CONSTIT touches none of it. |
| Per-key / per-position → `StrategyForBuilder[]` projection | Client lib (`allocations/lib/scenario-adapter.ts`, `src/lib/queries.ts`) | — | Pure projection; already emits one unit per `api_key_id`. Do not fork. |
| Constituent row presentation + badge | Frontend component (`ScenarioComposer.tsx` / `CompositionList`) | Design tokens (`trust-tier.ts`, `TrustTierLabel.tsx`) | The reshape lives entirely here. |
| Include/exclude toggle state | Client React state (composer) | — | Two channels today (`includeByApiKeyId` vs `draft.toggleByScopeRef`) → unify to one. |
| Per-key daily-return series derivation | Analytics-service (`services/broker_dailies.py`, `native_nav.py`) | Postgres `csv_daily_returns` | Source of the per-key TWR series the composer blends. Read-only for this phase. |
| Parity oracle (CONSTIT-05) | Analytics-service test tier (numpy/pandas) | — | Independent re-derivation; must NOT import `scenario.ts`. |

## Standard Stack

No new dependencies. Everything required is already installed.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| numpy | 2.5.1 | Independent blend re-derivation vectors | Already pinned in `analytics-service/requirements.txt` [VERIFIED: requirements.txt] |
| pandas | 3.0.3 | Date-axis alignment + cumprod for the oracle | Already pinned; every existing parity test uses it [VERIFIED: requirements.txt] |
| pytest | (existing) | Committed re-runnable gate test | Project convention; `--cov-fail-under=80` gate already enforced |
| vitest | (existing) | CONSTIT-01/02/04 UI + grep-gate tests | Existing composer test harness (`ScenarioComposer.test.tsx`) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Committed deterministic pandas fixture | Live query against test allocator `a11ca111…` on `qmnijlgmdhviwzwfyzlc` | Live-DB tests are `pytest.mark.skipif`-gated and NEVER run in CI (`test_csv_daily_returns_dualaxis_live.py:42`; MEMORY `reference_db_test_ci_wiring`). A live query can seed the fixture ONCE as a committed JSON snapshot, but the gate test itself must be offline+deterministic to actually gate CI. |
| TS-side parity test (vitest) | — | CONTEXT mandates numpy/pandas + "do NOT call scenario.ts". Python keeps the oracle genuinely independent of the TS engine. Matches the `golden_parity.py` precedent (`stdlib + pandas + numpy ONLY`). |

**Installation:** none required.

## Package Legitimacy Audit

Not applicable — this phase installs **no external packages**. numpy 2.5.1 and pandas 3.0.3 are already pinned in `analytics-service/requirements.txt` [VERIFIED: requirements.txt]; the TS side adds no dependency. No install → no slopcheck surface.

## Parity re-derivation recipe (CONSTIT-05 — THE GATE)

### What the composer renders today (the baseline to match) — traced

The composer's live book blend runs through the frozen engine. Exact path:

1. **One `StrategyForBuilder` per `api_key_id`** — built by `buildPerKeyStrategyForBuilderSet` (`allocations/lib/scenario-adapter.ts:131-174`) and, identically, the SSR baseline `liveBaselineMetricsFromPerKeyDailies` (`src/lib/queries.ts:2116-2237`):
   - `daily_returns` = that key's `(date, daily_return)` series from `csv_daily_returns` (api_key_id axis), grouped by `buildPerKeyReturnsByApiKeyId` (`queries.ts:2299-2313`).
   - `weight` = `Σ holdingEquityContribution` over the key's holdings, clamped `≥ 0` (`queries.ts:2027-2037` + `:2190`; adapter `:167`). RAW USD equity — **not** normalized here (engine renormalizes; Pitfall 1 at adapter `:117-122`).
   - `asset_class: "crypto"` for every per-key leg (`adapter:162`) → blend basis `periodsPerYear = 365` via `blendPeriodsPerYear` (crypto ⇒ √365).
   - The holdings-snapshot engine path was REMOVED in Phase 63 (ENGINE-01); the engine set is per-key + added units only (`ScenarioComposer.tsx:2071-2088`, `1984-1986`).

2. **`computeScenario` blend** (`src/lib/scenario.ts:226-667`), the exact arithmetic to reproduce:
   - **Date axis** = union of selected members' dates ≥ each member's include-from (`scenario.ts:359-376`). (Present-`window` path uses a closed window; the live baseline passes NO window, so this is the union path.)
   - **Per-day blend** (`scenario.ts:412-431`): `r_i = ( Σ_s w_s·L_s·ret_{s,i} ) / ( Σ_s w_s )`, where `w_s = normWeight(s) = weight_s / Σ member weights` (`:314-319`), `L_s` = leverage (always `1` for per-key legs), and a member whose start > day `i` is skipped (its weight drops from BOTH numerator and denominator that day). **Weights are FIXED** (the current-equity snapshot) for every day in the window.
   - **Compound** (`scenario.ts:447-452`): `c_i = Π_{j≤i} (1 + r_j)`; `twr = c_n − 1`.
   - **KPIs**: `vol = sampleStd(r)·√ppy` (÷ n−1, `:533-536`); `sharpe = mean(r)·ppy / vol` (`:537`); `sortino` downside-RMS ÷ n (`:550-557`); `maxDD` from the running peak of `c` (`:560-574`); `cagr` on the CALENDAR clock (`calendarYears`, `:528-529`). `ppy = 365` for the all-crypto per-key blend.
   - Output rounding: `twr.toFixed(5)`, `sharpe/sortino.toFixed(3)`, `max_drawdown.toFixed(5)` (`:645-666`). Compare against UNROUNDED intermediates or set tolerance ≥ rounding granularity.

3. **What the per-key `daily_return` series IS** (source-of-truth for "per-key daily series"): a **TWR** (cashflow-neutral) daily series reconstructed by the analytics-service from the key's trades/NAV — `trades_to_daily_returns_with_status` / `reconstruct_native_nav_and_twr`, then `gap_fill_daily_returns` fills non-trading days with `0.0` (`analytics-service/services/broker_dailies.py:123-225`). So a per-key series already aggregates that key's positions internally; the blend is a blend-of-TWR-series, i.e. a **performance curve, not a $-equity curve** (STITCH-03 carry-forward: the two are equal only with zero cashflows).

### The independent oracle (what the plan builds)

Inputs (raw, NOT via `scenario.ts`):
- Per-key `(date, daily_return)` series for each `api_key_id` (the same rows `csv_daily_returns` holds).
- Per-key equity weights (`Σ holdingEquityContribution` per key), and — to test the harder hypothesis — position-level daily returns + position-level equity if the fixture models drift.

Compute in pandas, two ways, and diff both against the engine output:
- **(A) Fixed-weight per-key** (composer semantics): align series on the union date axis, per day `r_i = Σ w_k·ret_{k,i} / Σ w_k` with FIXED `w_k`, then `cumprod(1+r)`. This should match the engine near-exactly.
- **(B) Time-varying per-position** (the "true book return" hypothesis): weight each position by its own drifting equity share each day, blend, compound. Compare A vs B and both vs engine.

Assert with `numpy.testing.assert_allclose`. Suggested tolerances:
- Cumulative curve, A-vs-engine: `atol=1e-9, rtol=1e-9` (pure float arithmetic, same op order — anything looser signals a real semantic gap).
- KPIs A-vs-engine: `atol=5e-6` after undoing output rounding (or compare to the rounded engine value at its own precision).
- A-vs-B: report the max divergence as data; do NOT assert equality — the DIFFERENCE is the founder-facing signal.

### Fixture (Claude's discretion — recommended)

Build a **deterministic committed fixture** (no RNG), following `seedCompositeStrategy`'s pattern (`e2e/helpers/seed-test-project.ts:931-935`: `daily_return = Math.sin(i/6)*0.01`):
- 2–3 keys with **overlapping + ragged-start** windows (exercises the per-day renorm + include-from skip).
- Deliberate **weight drift**: give one key a large early return and another a large late return so fixed-weight ≠ time-varying-weight — this makes A-vs-B *informative*.
- A variant WITH a synthetic deposit/withdrawal to confirm the TWR-blend is compared to TWR (not $-equity) — pre-empting the STITCH-03 trap.
- Store as JSON under `analytics-service/tests/fixtures/` (or reuse the `test_composite_headline_parity.py` fixture shape). Capture the frozen-engine output for the SAME fixture as a committed golden JSON (run `computeScenario` once via a tiny node harness or transcribe), so the pandas test needs no TS runtime.

Concrete real-data option for seeding the snapshot only: test allocator `a11ca111-1111-4111-8111-111111111111` on `qmnijlgmdhviwzwfyzlc` (Supabase MCP `execute_sql` a one-off dump of its `csv_daily_returns` per-key rows + `allocator_holdings`), then commit the dump as the fixture. The test must not query live at run time.

### Divergence-watch list (pre-empt these; they decide the re-baseline)

1. **Fixed vs time-varying weights** — the composer uses the CURRENT equity snapshot as a constant weight across the whole window (`queries.ts:2190`, `scenario.ts:314-319`). A "true" per-position book return uses drifting daily weights. THE primary candidate for divergence.
2. **Blend-then-compound vs compound-then-blend** — the engine blends daily returns then compounds (`scenario.ts:417-452`). Weighting terminal wealths instead diverges. The oracle must blend-then-compound.
3. **Gap-fill semantics** — per-key series are `0.0`-gap-filled (`broker_dailies.py:123-139`); before a member's include-from the engine zero-fills the numerator only and drops that member from the denominator (`scenario.ts:422-430`). Replicate exactly (no forward-fill, no dropping the day).
4. **Negative-equity clamp** — derivative equity = `unrealized_pnl_usd` (null→0), spot = `value_usd`; negatives clamp to 0 (`holdingEquityContribution` `queries.ts:2027-2037`; `:2190`). Clamp identically.
5. **Annualization basis** — `ppy=365` (all-crypto) affects vol/Sharpe/Sortino ONLY, not the curve/TWR/maxDD (`blendPeriodsPerYear`). If the fixture mixes asset classes, basis = 365 if ANY leg crypto (MEMORY #597 blend rule).
6. **CAGR calendar clock** — `calendarYears(first, last)` not `n/ppy` (`scenario.ts:528-529`). Reproduce via real date span.
7. **Cashflows (TWR vs $-equity)** — per-key series are cashflow-neutral TWR. Compare TWR-to-TWR. A deposit/withdrawal makes the $-equity curve step; the blend does NOT (STITCH-03). Do not accidentally compare against a $-equity snapshot.
8. **Output rounding** — engine rounds outputs; set tolerance ≥ granularity or compare unrounded.

## Constituent data model + Data-Sources removal map

### The unified constituent shape
`StrategyForBuilder` (`src/lib/scenario.ts:77-100`) is the one shape the engine consumes. Draft-level constituents are `AddedStrategy` (`allocations/lib/scenario-state.ts:96-104`: `id`, `name`, `markets`, `strategy_types` ONLY) plus a metadata lookup (`disclosure_tier`, `cagr`, `sharpe`, `asset_class`). Per-key units are minted with `disclosure_tier: "exploratory"` (`scenario-adapter.ts:148`).

### CompositionList row model (where rows render)
`CompositionList` is defined inline at `ScenarioComposer.tsx:4804-5030`, invoked at `:4480-4496`. It renders:
- **Per-coin live holdings** — `holdingsSummary.map` (`:4879-4931`): read-only `symbol · venue · USD`, no toggle/weight/leverage. **CONSTIT-03: these per-coin rows must be replaced by strategy/key-level constituent rows** (per-coin detail stays on the Holdings tab).
- **Added strategies** — `draft.addedStrategies.map` (`:4937-5026`): toggle switch + weight input + leverage input + remove, plus a `CoverageStateChip`.

### Data-Sources section — files:lines to DELETE
| What | Location | Action |
|------|----------|--------|
| Render: "Data sources" Card + per-key switch rows | `ScenarioComposer.tsx:3581-3636` | delete; per-key sources move into `CompositionList` |
| Render: per-source fallback InfoBanner | `ScenarioComposer.tsx:3638-3649` | delete or re-home |
| Render: all-excluded honest-empty card | `ScenarioComposer.tsx:3908-3910+` (`scenario-data-sources-empty`) | delete/re-home |
| State: `showDataSources` | `:2101` | remove |
| State: `showDataSourcesFallback` | `:2114-2117` | remove |
| State: `dataSourceKeys` memo | `:2122-2125` | fold into the unified list source |
| State: `allDataSourcesExcluded` | `:2138-2142` | replace with the unified all-off state |
| Toggle: `includeByApiKeyId` useState + `handleDataSourceToggle` + 3 resets | `:905`, `:913-915`, resets `:1251/1467/1518` | **CONSTIT-03: unify** into the same channel added rows use (`draft.toggleByScopeRef`) |
| `dataSourceLabel` helper | `:645-669` | reuse for the row label in the unified list |

### Provenance badge (CONSTIT-02) — reuse + a real gap
- **Reuse:** `TrustTierLabel` (`src/components/strategy/TrustTierLabel.tsx:55-78`) + `TRUST_TIER_TOKENS` (`src/lib/design-tokens/trust-tier.ts:41-60`). Existing variants: `api_verified` ("API verified", accent fill), `csv_uploaded`, `self_reported`. Visual lock already DESIGN.md-compliant (`rounded-sm` 4px, 1px border, 12px medium, no icons). Hexes are DESIGN.md-allowlisted and drift-gated by `tests/a11y/trust-tier-tokens.test.ts`.
- **Taxonomy mapping:** api-verified→`api_verified`, csv→`csv_uploaded`, self-reported→`self_reported`. **`composite` has NO existing trust-tier variant** — it is a separate discriminator `data_quality_flags.composite` (`src/lib/factsheet/types.ts:583-593`). A 4th badge needs either a new DESIGN.md-allowlisted token or a derived composite pill. → **Open question A1.**
- **Metadata-threading gap (landmine):** `trust_tier` lives ONLY on `strategy_verifications` (D-04; `queries.ts:295`), NOT on `strategies`, NOT on `AddedStrategy`, and NOT in `addedStrategyMetadataLookup` (`ScenarioComposer.tsx:1942-1979`, which carries only `disclosure_tier/cagr/sharpe/asset_class`). Per-key units carry no `trust_tier` at all. So CONSTIT-02 is only *partly* "surface existing metadata":
  - Per-key legs → derive **api-verified** by construction (a per-key unit IS a connected-exchange api-key; `adapter:157`, id === api_key_id).
  - Added strategies → `trust_tier` must be THREADED from the browse/payload data into the constituent (new wiring). → **Assumption A2.**

### Freeze + grep gates (CONSTIT-04)
- **SC-3 keep-gate** — `src/lib/scenario-backbone-gates.test.ts:101-114` asserts `scenario.ts` (and 3 siblings) EXIST on disk. This guards against DELETION, not byte-identity. The true byte-freeze is the behavior pins in `src/lib/scenario.test.ts` (file-header notes, `scenario.ts:68-69`) — keep those green; any red there means the reshape leaked into the engine.
- **New grep gate (CONSTIT-04):** add a repo-wide source-scan (template: `scenario-backbone-gates.test.ts`'s `walkSource` + `stripComments`) asserting no live `Data sources` / `dataSources` / `scenario-data-sources` tokens survive after the delete.
- **Whole-repo grep before delete:** `e2e/` currently has **zero** `data.source` references (verified: `grep -rin "data.source" e2e/` → 0). But `ScenarioComposer.test.tsx` has ~15 `scenario-data-sources*` testids (lines 1934, 1986, 2005, 4608, 4625, 4638-4661, 4804-4906, 7530-7999) that MUST be rewritten to the unified-list assertions. Re-run the whole-repo grep at delete time (SC-3 lesson: gates scan `src/` only).

## Common Pitfalls

### Pitfall 1: Trivial (tautological) parity fixture
**What goes wrong:** A fixture where every key has identical returns / equal weights / no drift passes A-vs-B trivially and answers nothing.
**How to avoid:** Bake weight drift + ragged windows + a cashflow variant into the fixture (see recipe). The gate exists to find divergence; design it to be *capable* of finding it.

### Pitfall 2: Comparing TWR blend to a $-equity curve
**What goes wrong:** Grabbing `allocator_equity_snapshots` (a $ curve that steps on deposits) as the "true" series and diffing it against the TWR blend — they legitimately differ with any cashflow, producing a false divergence.
**How to avoid:** Compare TWR-to-TWR. The per-key `csv_daily_returns` series is already cashflow-neutral TWR (`broker_dailies.py`). (STITCH-03 carry-forward.)

### Pitfall 3: The reshape leaking into `scenario.ts`
**What goes wrong:** Adding a badge/source field prompts an "innocent" tweak to `StrategyForBuilder` or the engine.
**How to avoid:** All new fields ride the composer/adapter layer. If `scenario.ts` needs editing, STOP (CONSTIT-04). Keep `scenario.test.ts` + SC-3 green.

### Pitfall 4: Two toggle channels left un-unified
**What goes wrong:** Per-key sources use `includeByApiKeyId` (a separate `useState`, `:905`) while added/holdings use `draft.toggleByScopeRef`. Leaving both violates CONSTIT-03's "one mechanism" and duplicates reset logic (`:1251/1467/1518`).
**How to avoid:** Route per-key include/exclude through the same channel the unified rows use; delete `includeByApiKeyId` and its resets.

### Pitfall 5: Dropping the honest all-excluded / fallback states
**What goes wrong:** Deleting the Data-Sources section also deletes `allDataSourcesExcluded` (`:2138-2142`) and the fallback banner, silently removing honest-empty affordances.
**How to avoid:** Re-home the all-off and per-source-history-missing states onto the unified list (no-invented-data + fail-loud conventions).

## Runtime State Inventory

CONSTIT is a UI/wiring reshape + a test. Nothing renames a stored key or migrates data.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB key/collection/id is renamed. `csv_daily_returns` (per-key axis) is READ, not rewritten. | none |
| Live service config | None — no external-service config carries a CONSTIT string. | none |
| OS-registered state | None. | none |
| Secrets/env vars | None. | none |
| Build artifacts | None — no package rename; no new dependency. | none |

**Test-project migration catch-up:** NOT triggered — CONSTIT adds no migration (UI + test only). (MEMORY `reference_db_test_ci_wiring` catch-up applies only when a new milestone migration lands.) Verified: this phase's scope is `ScenarioComposer.tsx` + tests + an `analytics-service/tests/` fixture.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate "Data sources" toggle section + per-coin holdings list | ONE unified constituent list, source = badge metadata | This phase (v1.11) | The reshape itself |
| Holdings-snapshot engine path (symbol-keyed builder) | Per-key + added units only (series-space) | Phase 63 (ENGINE-01) | The engine is ALREADY unified — CONSTIT is UI catch-up, not new math |
| Bespoke "second Sharpe" blend-panels module | Backbone-routed `scenario-blend-adapter.ts` | Phase 108 (SC-1) | Blend panels already canonical; do not reintroduce (SC-2 gate) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `composite` badge needs a NEW DESIGN.md-allowlisted token (no `composite` variant exists in `TRUST_TIER_TOKENS`) | Provenance badge | Plan under-scopes CONSTIT-02; a 4th badge silently missing or an off-allowlist color slips in |
| A2 | `trust_tier` must be THREADED to added-strategy constituents (it lives only on `strategy_verifications`, not on the constituent) — CONSTIT-02 is not purely "surface existing" | Constituent data model | Plan assumes the field is already present and the badge renders blank/wrong for added rows |
| A3 | "per-position weighted blend" most plausibly means a time-varying per-position book return (the interesting hypothesis), not the fixed-weight per-key blend the composer already computes | Parity recipe | If it means the fixed-weight blend, the gate is near-tautological; if time-varying, divergence + re-baseline is likely. **This is the deliberately-deferred outcome — surface to founder per CONSTIT-05.** |
| A4 | The gate test must be an offline deterministic pandas fixture (live-DB tests are `skipif`-gated, never run in CI) | Fixture | A live-DB gate test would pass locally but never gate CI — the milestone gate would be illusory |

**These four are the user-confirmation surface for `/gsd:discuss-phase` / the planner.** A3 is the founder either/or the CONTEXT already flags.

## Open Questions

1. **Badge taxonomy 4th variant (A1).** Add a `composite` token to `TRUST_TIER_TOKENS` (needs a DESIGN.md-allowlisted color) or render composite as an orthogonal pill from `data_quality_flags.composite`? Recommendation: extend the token set within DESIGN.md; keep one badge component.
2. **`trust_tier` threading (A2).** Where does an added strategy's `trust_tier` enter the composer payload? Likely the Browse drawer / strategy payload already fetches `strategy_verifications.trust_tier` (`queries.ts:295` pattern) — confirm at plan time and thread it into `addedStrategyMetadataLookup`.
3. **Parity semantic (A3).** Confirm with the founder whether the target is fixed-weight-per-key or time-varying-per-position before interpreting the diff. The test should REPORT both; the founder picks the canonical definition if they diverge.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| numpy | Parity oracle | ✓ | 2.5.1 | — |
| pandas | Parity oracle | ✓ | 3.0.3 | — |
| pytest | Committed gate test | ✓ | existing | — |
| vitest | UI + grep-gate tests | ✓ | existing | — |
| Supabase MCP (test project `qmnijlgmdhviwzwfyzlc`) | ONE-OFF fixture seeding only (optional) | ✓ | — | Synthetic deterministic fixture (preferred anyway) |

**Missing dependencies with no fallback:** none.

## Validation Architecture

Test framework present; `nyquist_validation` not disabled → section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (TS/UI) + pytest (analytics parity) |
| Config file | `vitest.config.ts`; `analytics-service` pytest (`--cov-fail-under=80`) |
| Quick run command | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" --no-file-parallelism` |
| Full suite command | `npm run test:coverage` (TS) · `cd analytics-service && pytest` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONSTIT-05 | Independent pandas blend == engine (or recorded re-baseline) | unit (pandas oracle) | `cd analytics-service && pytest tests/test_constit_blend_parity.py -x` | ❌ Wave 0 |
| CONSTIT-01 | Single unified list, NO "Data sources" section | component | `npx vitest run ScenarioComposer.test.tsx -t "unified constituent list"` | ⚠️ rewrite existing `scenario-data-sources*` tests |
| CONSTIT-02 | Provenance badge per row (4 variants) | component | `npx vitest run ScenarioComposer.test.tsx -t "provenance badge"` | ❌ Wave 0 |
| CONSTIT-03 | Book seed collapses to key/strategy level; one shared off-toggle | component | `npx vitest run ScenarioComposer.test.tsx -t "shared toggle"` | ❌ Wave 0 |
| CONSTIT-04 | `scenario.ts` byte-frozen + no orphaned Data-Sources strings | source-scan | `npx vitest run scenario-backbone-gates.test.ts` + new grep gate | ⚠️ SC-3 exists; grep gate ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the touched vitest file with `--no-file-parallelism` (MEMORY: composer tests flake under parallelism).
- **Per wave merge:** full TS suite + `analytics-service` pytest.
- **Phase gate:** CONSTIT-05 pandas test green BEFORE any UI plan merges; full suite green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_constit_blend_parity.py` + `tests/fixtures/constit_parity_*.json` — covers CONSTIT-05 (deterministic fixture + committed engine golden).
- [ ] New repo-wide grep gate (Data-Sources orphan scan) — covers CONSTIT-04.
- [ ] Rewrite the ~15 `scenario-data-sources*` assertions in `ScenarioComposer.test.tsx` to unified-list assertions.
- [ ] Badge-render + shared-toggle component tests — cover CONSTIT-02/03.

## Security Domain

CONSTIT is presentation + an offline numeric test. No auth, session, access-control, crypto, or new input surface is added.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | unchanged |
| V3 Session | no | unchanged |
| V4 Access Control | no | The composer reads the allocator's OWN payload (existing RLS `allocator_id = auth.uid()`); no new query. |
| V5 Input Validation | minimal | The only new "input" is fixture JSON in a test (trusted). Leverage/weight inputs are OUT of scope (Phase 112). |
| V6 Cryptography | no | none |

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Account-size leak in the parity oracle output | Information disclosure | Follow `golden_parity.py` discipline — the oracle returns Series/scalars, never prints raw USD NAV magnitudes (T-73-02). Fixtures use synthetic returns, not real account sizes. |

## Sources

### Primary (HIGH confidence)
- `src/lib/scenario.ts:226-667` — the frozen blend engine (formula trace) [VERIFIED: codebase]
- `src/lib/queries.ts:2027-2313` — per-key baseline, equity weights, per-key grouping [VERIFIED: codebase]
- `src/app/(dashboard)/allocations/lib/scenario-adapter.ts:131-296` — per-key unit builder [VERIFIED: codebase]
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — Data-Sources section (`:3581-3649`), toggle state (`:905-2142`), CompositionList (`:4804-5030`), metadata lookup (`:1942-1979`) [VERIFIED: codebase]
- `src/lib/design-tokens/trust-tier.ts` + `src/components/strategy/TrustTierLabel.tsx` — badge tokens/component [VERIFIED: codebase]
- `src/lib/scenario-backbone-gates.test.ts:101-114` — SC-3 keep-gate [VERIFIED: codebase]
- `analytics-service/services/broker_dailies.py:123-225` — per-key TWR derivation + gap-fill [VERIFIED: codebase]
- `analytics-service/scripts/golden_parity.py` + `tests/test_composite_headline_parity.py` — committed-oracle test pattern [VERIFIED: codebase]
- `analytics-service/requirements.txt` — numpy 2.5.1 / pandas 3.0.3 [VERIFIED: requirements.txt]
- `e2e/helpers/seed-test-project.ts:612-958` — deterministic fixture pattern (sin-based, no RNG) [VERIFIED: codebase]

### Secondary (MEDIUM confidence)
- CONTEXT/ROADMAP/REQUIREMENTS/STATE (`.planning/`) — locked decisions + acceptance criteria [CITED]
- MEMORY: `reference_db_test_ci_wiring` (live-DB tests skip CI), `project_v1_11_allocator_is_a_strategy_unified_pipeline` (TWR≠equity), `#597` blend basis [CITED]

## Metadata

**Confidence breakdown:**
- Code trace + Data-Sources removal map: HIGH — read directly from source at cited lines.
- Blend formula for the oracle: HIGH — `computeScenario` fully traced.
- Parity SEMANTIC ("per-position" meaning): MEDIUM — deliberately deferred to execution; the gate resolves it (A3).
- Badge metadata availability: MEDIUM — `trust_tier` location confirmed (only on `strategy_verifications`); threading path for added strategies to confirm at plan time (A2).

**Research date:** 2026-07-16
**Valid until:** 2026-08-15 (stable internal codebase; re-verify line numbers if `ScenarioComposer.tsx` is edited before planning)

## RESEARCH COMPLETE

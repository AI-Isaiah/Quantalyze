# Phase 92: Composite Metric Blow-Up & Annualization Honesty — Research

**Researched:** 2026-07-11
**Domain:** analytics-service per-key native-NAV reconstruction + `compute_all_metrics` (Python / pandas) + composite factsheet read path (TS)
**Confidence:** HIGH on the code-path trace and file:line sites; MEDIUM on which of two display mechanisms produces the literal "+0.0%" (the repro fixture disambiguates — by design, per the phase's no-reasoning-alone gate)

This is a ROOT-CAUSE trace, not a literature review. Every claim below is `[VERIFIED: codebase]` unless tagged otherwise.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HARD-01 | A composite factsheet never renders absurd metrics (per-key contribution in thousands/millions of %, CAGR/Cumulative 0.0% while the curve rises). Root-cause + fix the inverse-Deribit per-key daily-return scale blow-up (near-zero-equity denominator family, P72-adjacent). | Root cause pinned at `nav_twr.py:392` (denominator) + `_guard_denominator` gap `nav_twr.py:397-420`; native path selected at `broker_dailies.py:222-225`; per-key contribution surface at `compositeAttribution.ts:116,125`. Fix approach (a)/(b) below. |
| HARD-04 | A short-lived / flow-heavy composite window carries an `insufficient_window` DQ flag stamped at the CAGR site (value unchanged) instead of silently over-annualizing. (Closes #67; shares root with HARD-01.) | CAGR site + the exact pre-existing un-flagged class pinned at `metrics.py:645-652` (self-documented at `metrics.py:629-636`). Stamping mechanism (e)/(d) below. |
</phase_requirements>

---

## User Constraints

_No CONTEXT.md exists yet for this phase (standalone research, pre-discuss). The ROADMAP + REQUIREMENTS locked scope below acts as the binding constraint set._

### Locked (from ROADMAP.md "Standing invariants" + REQUIREMENTS.md)
- **No-invented-data** — degenerate inputs render honest empty states / DQ flags, never fabricated numbers. A guarded day is NaN (a chain break), never a substituted floor.
- **Single-key back-compat** — existing single-key strategies and shipped Deribit-only composites stay **byte-identical** unless a fix's blast radius is explicitly evidenced (roadmap Pitfall #12: `transforms.py` / `nav_twr.py` / `metrics.py` are shared paths — changing them shifts EVERY factsheet).
- **Worker-only decryption** — untouched by this phase (no key material in scope).
- **Repro gate (HARD)** — Phase 92 MUST NOT close on reasoning alone. Closure is evidenced against a reproduced-then-fixed factsheet OR a Deribit-inverse fixture.
- **Fix at the source** — prefer a fix at the denominator / near-zero-guard source, NOT the display layer (objective constraint).

### Out of scope (deferred)
- ccxt (Bybit/OKX/Binance) composite members → **Phase 93 (HARD-05)**, not here.
- Composite MTM smoothing (Phase-83 family); wizard resumability; stitch-progress UX; hygiene crons; CI/schema debt → Phases 93–97.

---

## Summary

The blow-up is a **per-key daily-return scale explosion in the native-unit NAV reconstruction path**, persisted into `csv_daily_returns`, then read verbatim by three downstream surfaces (the equity chart, the per-key contribution table, and the headline scalars). It is NOT a frontend bug and NOT in the Zavara allocated-capital path.

The exact denominator is `nav_twr.chain_linked_twr` line **392**: `returns[t] = (cur - prev - flow_t) / prev`, where for a native (Deribit-inverse) member `prev` is the prior day's reconstructed **USD-valued NAV** = `Σ_c B_c(d)×mark_c(d)` (built in `native_nav._value_over_calendar`, line **530**). The only denominator guards (`_guard_denominator`, `nav_twr.py:397-420`) are: `prev ≤ 0` (negative), `prev < $1000` (dust), and `|flow| ≥ prev` (flow-dominated). **There is NO pnl-magnitude / return-cap guard.** An inverse-perpetual member whose USD-valued equity is small (a few thousand $, i.e. above the $1000 dust floor) but whose single-day native P&L is many multiples of that equity produces `r ≈ 10–100/day`, which is not guarded, is persisted, and compounds geometrically into millions of %.

The "+1,489,363.8%" per-key contribution is `compositeAttribution.partitionAttribution` computing geometric `Π(1+r)−1` (line **116/125**) over the **persisted exploded** `csv_daily_returns` — a faithful read of a poisoned series, confirming the root is upstream. The "CAGR/Cumulative +0.0% while the curve rises" is a server-side artifact of the same poisoned series: the headline `cumulative_return`/`cagr` compound only the **post-last-interior-break suffix** (`cumulative_twr_segmented`, `metrics.py:621` + `_last_interior_break_suffix`), so when a near-zero-equity day trips a guard mid-series the trustworthy suffix is short/flat → `+0.00%`, while the chart uses `returns.fillna(0)` (`metrics.py:545`) which **bridges** the guarded gap and compounds the exploded pre-break days → visibly rises. (`formatPercent(null)` renders `"—"`, not `"+0.0%"` — so a pure Inf→None swallow is ruled OUT as the sole cause of the literal `+0.0%`; see §(c).)

**Primary recommendation:** Fix at the source in `nav_twr._guard_denominator` — add a fail-loud **return-magnitude / pnl-dominated guard** (the missing sibling of `flow_dominated_guard`) so a day whose |P&L| dwarfs a small prior NAV breaks-and-flags (NaN + a new guard key) instead of emitting an un-interpretable 100×/day return. This makes the persisted series finite, which makes the chart, the per-key contribution, and the headline scalars finite and mutually consistent by construction. Separately (HARD-04), stamp `insufficient_window` at `metrics.py:645-652` without changing the CAGR value. Pin both with a **pure, offline** repro built on the real `reconstruct_native_nav_and_twr` (no shared Supabase test DB).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Per-key daily-return reconstruction (the blow-up) | analytics-service pure core (`nav_twr.py`, `native_nav.py`) | — | This is where the denominator divides; the fix belongs here (source), not display. |
| Composite stitch + persist + metrics | analytics-service worker (`job_worker.run_stitch_composite_job`) | — | Orchestrates fan-out → clip → stitch → `compute_all_metrics` → persist `csv_daily_returns` + `metrics_json_by_basis`. |
| Headline scalar computation (CAGR/cumulative + HARD-04 flag) | analytics-service pure (`metrics.compute_all_metrics`) | worker + `analytics_runner` (flag lift) | Shared single-key + composite path; the flag must be emitted here and lifted by both callers. |
| Per-key contribution table + factsheet render | Next.js client (`compositeAttribution.ts`, factsheet read path) | — | Read-only consumer of the persisted series; NOT where the fix goes (it faithfully renders whatever is persisted). |

---

## (a) ROOT CAUSE — the blow-up denominator, with file:line

### Path selection (which reconstruction a composite member takes)
`run_stitch_composite_job._reconstruct_deribit` (**`analytics-service/services/job_worker.py:3083-3102`**) calls
`combine_native_ledger(ledger, indexable, denominator_config=denominator_config)` (**`broker_dailies.py:173-225`**), which branches:

- `denominator_config is not None` (Zavara / allocated-capital override) → `allocated_capital_returns_and_metrics` → `returns = pnl_usd / capital` (**`allocated_capital.py:576`**). **`capital` is a validated strictly-positive scheduled base** (every tranche is enforced `> 0` and finite at `allocated_capital.py:120-124, 290-295`). **This path CANNOT produce a near-zero denominator — it is NOT the blow-up path.**
- `denominator_config is None` (every non-Zavara composite — i.e. the Titan Forge inverse-perpetual repro) → `reconstruct_native_nav_and_twr(ledger, indexable_currencies=indexable, venue="deribit")` (**`broker_dailies.py:222-225`**, defined **`native_nav.py:579-658`**). **This is the blow-up path.**

### The exact denominator expression
Inside the native path, step 5 calls `chain_linked_twr(nav_usd, composed_pnl_usd, composed_flows_usd, prev0=_prev0_usd(...))` (**`native_nav.py:648-654`**). The per-day return is:

- **`analytics-service/services/nav_twr.py:392`** → `returns[t] = (cur - prev - flow_t) / prev`
  - `prev` for `t≥1` is `nav_vals[t-1]` (**`nav_twr.py:385`**) = the prior day's reconstructed **USD NAV**.
  - That USD NAV is `nav_total += np.where(b_eff != 0.0, b_eff * mark_vals, 0.0)` for an INDEXED coin (**`native_nav.py:530`**) — i.e. `Σ_c B_c(d) × mark_c(d)`, native balance × the day's `{ccy}_usd` mark.

For an **inverse Deribit perpetual** the collateral is held in the base coin (BTC/ETH); `B_c` is a coin quantity and the account's USD-valued equity `B_c × mark_c` can be genuinely small (a lightly-collateralized, highly-leveraged book) while a single day's native P&L (`composed_pnl_usd`, `native_nav.py:532`) is a large multiple of it.

### The guard gap (the actual defect)
`_guard_denominator(prev_nav, flow)` (**`nav_twr.py:397-420`**) is the ONLY thing standing between `prev` and the divide. It fires on exactly three conditions:

```
if prev_nav <= 0:            return "negative_nav_guard"   # nav_twr.py:414
if prev_nav < DUST_NAV_FLOOR:return "dust_nav_guard"       # nav_twr.py:416  (DUST_NAV_FLOOR = 1000.0, :58)
if abs(flow) >= FLOW_DOM_RATIO * prev_nav:                 # nav_twr.py:418  (flow-dominated)
    return "flow_dominated_guard"
return None
```

**There is no guard on the P&L magnitude relative to `prev_nav`.** `flow_dominated_guard` protects against a dominating external *flow* but the equivalent protection against a dominating *P&L day* on a small-but-above-dust equity does not exist. So a day with `prev_nav = $2,000` and a native P&L valued at `+$40,000` yields `r = (cur - prev - 0)/prev ≈ 20` (2000%/day), sails past all three guards, and is emitted as a "valid" return. Compounded geometrically across a few such days → the observed millions of %.

**Confidence:** HIGH that this is the mechanism by which an un-guarded explosive return reaches persistence. MEDIUM on whether the small `prev_nav` is (i) an economically-real small account or (ii) itself a valuation artifact of inverse equity being under-stated — the repro fixture (§f) is what nails which, and the fix (§b) is correct either way (break-and-flag rather than emit an un-interpretable return).

---

## (b) FIX APPROACH — at the source (not the display)

Two source-level options; **(b1) is the recommendation**, (b2) is the fallback if the discuss-phase judges the small equity itself is wrong.

**(b1) Add a fail-loud return/pnl-magnitude guard to `_guard_denominator` (`nav_twr.py:397-420`).**
- Introduce a `RETURN_MAGNITUDE_CAP` (or `PNL_DOM_RATIO`) constant next to `FLOW_DOM_RATIO`/`DUST_NAV_FLOOR` (`nav_twr.py:55-76`), tuned like them (warning-locked default, calibrated at the acceptance gate — the `FLOW_DOM_RATIO` precedent).
- Because `_guard_denominator` sees `prev` and `flow` but not the resulting `r`, the cleanest wiring is to evaluate the day's return magnitude at the call site (`chain_linked_twr`, `nav_twr.py:387-392`): compute the candidate `r`, and if `|r| >= CAP` (e.g. the day's numerator dwarfs `prev`), set a new `pnl_dominated_guard` / `return_magnitude_guard` flag and `continue` (break the chain — NaN, never substitute), mirroring the existing `guard_key` block exactly.
- Register the new key in `NAV_TWR_GUARD_KEYS` (**`nav_twr.py:166-175`**) so it auto-promotes `computation_status → complete_with_warnings` at every existing lift site (the tuple is the single owner — one-line propagation), add it to `_build_nav_meta` (**`nav_twr.py:498-509`**) and to the `DataQualityFlags` TypedDict (**`analytics_runner.py:128-217`**).
- **Blast-radius discipline (roadmap Pitfall #12):** this touches the shared `nav_twr.py` core, so a no-op default (a cap high enough that no normal single-key / shipped-composite series trips it) plus the existing SC-4 byte-identity pins must stay GREEN. A flow-less, non-exploding account must be byte-identical.

**(b2) Reconsider the near-zero equity valuation itself.** If the discuss-phase determines the small `prev_nav` is an inverse-valuation artifact (equity understated because it is measured in the base unit), the fix is in `native_nav._value_over_calendar` / the ledger's `terminal_native_equity` sourcing rather than the guard. This is the deeper "P72-adjacent" reading. Recommend treating this as an OPEN QUESTION (§g Q1) resolved by inspecting the fixture's reconstructed NAV series against exchange truth — do NOT guess.

**Either way**, once the persisted per-day return is finite, all three downstream surfaces (chart, per-key contribution, headline) become finite and consistent — the display layer needs no change.

---

## (c) CAGR / Cumulative "+0.0% while the curve rises" — cause + fix

Both scalars are computed in `compute_all_metrics` (`metrics.py`), GEOMETRIC branch:
- `cumulative_return` (`total_return`) = `cumulative_twr_segmented(returns)[0]` (**`metrics.py:621`**) — compounds ONLY the maximal contiguous non-NaN **suffix after the last interior break** (`nav_twr._last_interior_break_suffix`, `nav_twr.py:423-447`).
- `cagr` = `(1 + total_return) ** (_CALENDAR_DAYS_PER_YEAR / _elapsed_days) - 1` over that same suffix's index (**`metrics.py:645-652`**).
- The chart series = `returns_for_chart = returns.fillna(0).clip(lower=_LOG_RETURN_FLOOR)` then `(1+returns_for_chart).cumprod()` (**`metrics.py:545, 620`**) — **fillna(0) bridges the guarded NaN gap**, so the chart compounds the exploded pre-break days.

**Leading mechanism (finite near-zero):** when a near-zero-equity day trips a guard mid-series, it becomes an INTERIOR NaN break; `cumulative_twr_segmented` then discards everything before it and compounds only the trustworthy post-break suffix, which is short/flat → `total_return ≈ 0` → renders `+0.00%`, and `cagr` annualizes the same flat suffix → `+0.00%`. The chart (fillna-bridged) still shows the pre-break explosion → "the curve visibly rises". This is fully consistent with the symptom and with `formatPercent`'s `+`-sign output (a finite value near 0), and it requires NO code change once (b) makes the series finite (no guard trips → whole series compounds → honest headline).

**Ruled out as the sole cause:** a pure Inf→None swallow. `total_return`/`cagr` do pass through `_safe_float` (Inf→None, `metrics.py:341`) and `sanitize_metrics` (`metrics.py:1131`), BUT `formatPercent(null)` returns `"—"`, not `"+0.0%"` (**`src/lib/utils.ts:8`**). So an overflow-to-None would surface as an em-dash, not `+0.0%`. Overflow may still co-occur for the *whole-composite* compound (many exploded days) and should be handled by (b), but it is not what prints the literal `+0.0%`.

**Secondary client-side candidate (verify, likely NOT the composite path):** `src/lib/factsheet/compute.ts:39` recomputes `cagr` client-side and coalesces to `0` when `years <= 0 || eq[n-1] <= 0`, and `cumRet = eq[n-1] - 1`. Per memory + `composite-read-path.ts`, the composite headline PREFERS the persisted server scalars, so `compute.ts` is most likely the CSV/benchmark client path, not the composite headline. The repro (§f) confirms whether any client coalesce contributes.

**Fix:** none needed at the display/metrics layer for HARD-01 beyond (b). The repro asserts the headline scalars become finite + plausible once the source is fixed. (If overflow of the whole-composite compound is observed in the fixture, (b1)'s guard prevents the exploded days from ever entering the compound.)

---

## (d) + (e) HARD-04 — `insufficient_window` DQ flag at the CAGR site

### The site (already self-documented as the #67 class)
**`metrics.py:645-652`** is the exact CAGR annualization site, and the code comment at **`metrics.py:629-636`** already names this requirement verbatim:

> "a genuine 2-day window (elapsed_days==1) still annualizes with exponent 365, which explodes CAGR for a days-old account and is NOT yet flagged. That short-window over-annualization is a pre-existing class … tracked for a DQ short-window flag behind the Phase 78 parity gate — deliberately not point-fixed here because a CAGR-status change is factsheet-wide blast radius (roadmap Pitfall #12)."

The only existing floor is `len(_cagr_index) < 2 → cagr = NaN` (`metrics.py:646`). A window of a few days (small `_elapsed_days`, `metrics.py:649`) annualizes with a huge exponent `365/_elapsed_days`.

### Stamping mechanism (value unchanged)
`compute_all_metrics` currently returns only scalars in `metrics_json`; it does **not** emit `data_quality_flags`. To stamp `insufficient_window` WITHOUT altering `cagr`:

1. At the CAGR site (`metrics.py:645-652`, and mirror in the `simple` branch `metrics.py:589-594`), compute a boolean `insufficient_window` when the annualization window is too short (candidate rule: `_elapsed_days < MIN_ANNUALIZATION_DAYS`, a new tunable constant near `_CALENDAR_DAYS_PER_YEAR`, `metrics.py:55`; also consider flow-heavy windows per REQUIREMENTS "short-lived / flow-heavy"). **Leave `cagr` exactly as computed** — the flag is annotation only.
2. Emit it as a key on the returned payload. Cleanest: add `metrics_json["insufficient_window"] = True` (only when set) inside the sanitized dict (`metrics.py:1131-1149`), OR return it via a small addition to `MetricsResult` so both callers lift it deliberately.
3. **Lift it at BOTH callers** (compute_all_metrics is shared):
   - Composite worker: fold into `merged_flags` in `run_stitch_composite_job` (**`job_worker.py:3549-3555`**, the existing coverage-mask merge block).
   - Single-key: add `insufficient_window: bool` to the `DataQualityFlags` TypedDict (**`analytics_runner.py:128-217`**) and lift where the other metrics-derived flags are merged (so #67 also closes for single-key CSV/MT5 accounts, matching REQUIREMENTS "shares root with HARD-01").
4. **Frontend surface:** the flag must be visible as a DQ caveat. The composite factsheet already renders `data_quality_flags`-driven caveats (per 89-04 memory: coverage gaps + DQ caveats amber, `role=status`). Add `insufficient_window` to the caveat map (verify the render site in the factsheet DQ-chip component during planning; the composite persists DQ flags via `merged_flags`, so the channel already exists).

**Confidence:** HIGH on the site + the value-unchanged requirement; MEDIUM on the exact threshold (`MIN_ANNUALIZATION_DAYS`) and the flow-heavy trigger — these are tunables to lock in discuss-phase (see §g Q2).

---

## (f) REPRODUCTION FIXTURE — pure / offline (no shared Supabase test DB)

The blow-up lives in a **pure** function (`reconstruct_native_nav_and_twr`, `native_nav.py:579`), so the primary regression can be fully offline — satisfying the "prefer a pure/offline fixture that does NOT touch the shared Supabase test project" constraint and dodging the shared-test-DB fencing fragility entirely.

### Primary (SC-2) — pure native-core repro
- **File:** `analytics-service/tests/test_native_nav.py` (exists) — add a `test_inverse_perpetual_near_zero_equity_blowup_*` pair (RED without fix, GREEN with).
- **Real function under test:** `services.native_nav.reconstruct_native_nav_and_twr` (NOT a reimplementation). Hand-build a `NativeLedger` (`native_nav.py:206-243`) for a single INDEXED `BTC` bucket:
  - `native_pnl = {"BTC": Series}` with one day carrying a large `change` (native BTC) relative to the account's small BTC balance;
  - `terminal_native_equity = {"BTC": <small BTC qty>}`;
  - `marks = {"BTC": Series}` of daily `{ccy}_usd` (~$88k) covering every valued day (density contract, `native_nav.py:475-537`);
  - `native_flows = []` (or a small one), `terminal_upnl_native = {}`, `full_history = True`.
  - Call `reconstruct_native_nav_and_twr(ledger, indexable_currencies=frozenset({"BTC"}), venue="deribit")`.
- **RED assertion (pins the bug):** the returned `returns` Series contains a day with `|r| >> 1` (e.g. `> 5`), reproducing the ~100×/day explosion.
- **GREEN assertion (pins the fix):** that day is either guarded (NaN + the new `pnl_dominated_guard`/`return_magnitude_guard` key present in the meta, per (b1)) OR finite/plausible (per (b2)); and no day has `|r|` above the cap.
- **Mutation-honesty (Rule 9):** reverting the new guard reddens the GREEN test.

### Layer 2 (SC-1) — headline-scalar consistency
- Feed the (now finite) series through the REAL `services.metrics.compute_all_metrics` (`metrics.py:376`) — a pure call, tested extensively in `tests/test_metrics.py`. Assert `cumulative_return`/`cagr` are finite and consistent with the equity chart direction (both positive when the curve rises), i.e. no `+0.00%` headline against a rising curve.

### Layer 3 (end-to-end, still offline) — worker persist
- Reuse the existing pure-stub harness in **`analytics-service/tests/test_stitch_composite_job.py`** (`_FakeSupabase` + `patch("services.deribit_ingest.build_deribit_native_ledger", ...)` returning the blow-up `NativeLedger`, `test_stitch_composite_job.py:207-289`). Assert the persisted `csv_daily_returns` rows and `metrics_json_by_basis.cash_settlement` scalars are finite/plausible. **No live DB, no creds** — the harness is already offline.

### Per-key contribution (frontend) — optional TS pin
- `src/lib/composite/compositeAttribution.test.ts` (exists) can pin that `partitionAttribution` over a finite fixed series yields a plausible contribution — but this is a read-only consumer; the load-bearing regression is the Python core above.

**Do NOT** build a live-crawl repro or a shared-test-DB SQL test for this phase — the pure native-core fixture is authoritative, re-runnable, and leak-safe (synthetic quantities only).

---

## (g) P72 cross-reference — what it did / did NOT cover

**P72 = commit `2c728953` "fix(72): Deribit quiet-day inverse valuation via settlement index + fail-loud"** (`v0.37.7.0`, PR #586). What it fixed:
- **Numerator, not denominator:** it valued a *quiet-day inverse row* (e.g. a `negative_balance_fee` in BTC on a day with no own ledger index) to USD via `public/get_delivery_prices` same-day settlement mark, and made structural row→USD failures fail-loud PERMANENT (`LedgerValuationError`). It is about turning an unvaluable inverse *cash row* into a correct USD amount.
- **Different reconstruction lineage:** P72 lives in the **single-key derive path** (`run_derive_broker_dailies_job` → `combine_realized_and_funding` → the USD-space `reconstruct_nav_and_twr`). The composite per-key blow-up is in the **native-unit path** (`build_deribit_native_ledger` → `combine_native_ledger` → `reconstruct_native_nav_and_twr`) — a separate lineage that P72 never touched.

**Conclusion:** P72 does NOT cover the composite per-key near-zero-equity denominator. It fixed how an inverse row is *valued* (numerator); Phase 92 must fix how a small inverse *equity* is used as a *denominator* (the missing return/pnl-magnitude guard) and/or whether that equity is itself under-stated. They are adjacent (both "inverse-Deribit valuation" family) but non-overlapping.

---

## (h) Open Questions / Risks

**Q1 — Is the small `prev_nav` real or an inverse-valuation artifact? (drives fix (b1) vs (b2))**
- Known: the denominator is `Σ B_c × mark_c` and the guards don't catch a P&L-dominated day above the $1000 floor.
- Unclear: whether the reconstructed near-zero equity matches exchange truth (a genuinely tiny high-leverage book) or is understated (a valuation bug).
- **Recommendation:** the §f fixture reconstructs the NAV series; compare it to the intended equity. If NAV is correct → (b1) guard is the fix. If NAV is understated → (b2) valuation fix. Do NOT guess; resolve in discuss-phase against the fixture.

**Q2 — `insufficient_window` threshold + flow-heavy trigger (HARD-04).**
- The value-unchanged flag needs a `MIN_ANNUALIZATION_DAYS` (short-window) and possibly a flow-fraction trigger ("flow-heavy"). These are policy tunables (the `FLOW_DOM_RATIO` precedent). Lock the numbers with the founder in discuss-phase.

**Q3 — Shared-path blast radius (roadmap Pitfall #12).**
- Any edit to `nav_twr.py` / `metrics.py` shifts every factsheet. The new guard + flag MUST default to a no-op for flow-less, non-exploding accounts; the existing SC-4 byte-identity pins (`test_nav_twr.py`, `test_native_nav_sc4_identity.py`, golden/parity fixtures) MUST stay GREEN in the same commit.

**Q4 — Simple-branch parity for the guard/flag.**
- Under `cumulative_method="simple"` (Zavara/allocated), `compute_all_metrics` RAISES on an interior NaN (`metrics.py:573-581`) → the worker stamps PERMANENT failed (`job_worker.py:3363-3385`). Confirm the new native-path guard's NaN days can't reach a `simple` compute (the allocated path bypasses `reconstruct_native_nav_and_twr`, so this should be structurally impossible — verify in planning).

---

## Runtime State Inventory

_Not a rename/migration phase, but the persisted-state angle matters for the repro._

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `csv_daily_returns` rows for the bad composite carry the EXPLODED per-day returns; `strategy_analytics.metrics_json` / `metrics_json_by_basis` carry the poisoned scalars. | A re-derive (re-stitch) REPLACES `csv_daily_returns` wholesale (`job_worker.py:3460-3475` full-delete) and overwrites metrics — so the fix self-heals on re-stitch. No manual data migration needed IF the user re-onboards/re-stitches. Note in plan: existing bad drafts the user keeps deleting are not a durable repro; use the fixture. |
| Live service config | None — no external service config embeds the blow-up. | None. |
| OS-registered state | None. | None — verified (analytics is a stateless worker). |
| Secrets/env vars | None. | None. |
| Build artifacts | None. | None. |

---

## Common Pitfalls

### Pitfall 1: "Fix it at the display layer"
The per-key contribution table and the equity chart faithfully render the persisted `csv_daily_returns`. Clamping/formatting there hides the poison and violates the objective's source-fix constraint. **Fix the persisted series at the reconstruction denominator.**

### Pitfall 2: Assuming the allocated-capital (Zavara) path is the culprit
`allocated_capital.py:576` divides by a validated-positive scheduled base — it cannot go near-zero. The blow-up is the `denominator_config is None` native path. Don't add guards to the allocated path.

### Pitfall 3: Confusing P72's numerator fix with a denominator fix
P72 valued inverse *rows* to USD in the single-key path. It is not a guard on inverse *equity* used as a denominator in the native composite path. Re-verify against the fixture; don't assume P72 already handled this.

### Pitfall 4: Changing the CAGR value while adding the flag (HARD-04)
The requirement is explicit: stamp `insufficient_window` **without changing the underlying value**. The flag is annotation; `cagr` stays as computed.

### Pitfall 5: Shared-path byte-identity regression
`nav_twr.py` and `metrics.py` feed every factsheet. A guard/flag with too-tight a default will move flow-less single-key accounts and redden the SC-4 pins. Default to no-op; evidence any intended movement.

### Pitfall 6: Reaching for the shared Supabase test project
The pure `reconstruct_native_nav_and_twr` fixture needs no DB. Using a shared-test-DB SQL/e2e test re-introduces the fencing fragility Phase 97 exists to fix, and is unnecessary here.

---

## Validation Architecture

`workflow.nyquist_validation = true` → this section applies.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service) + vitest (frontend, secondary) |
| Config file | `analytics-service/pytest.ini` / `pyproject.toml`; coverage gate `--cov-fail-under=80` |
| Quick run command | `cd analytics-service && .venv/bin/python -m pytest tests/test_native_nav.py -x --no-file-parallelism` |
| Full suite command | `cd analytics-service && .venv/bin/python -m pytest -q` (CI-3.12 venv; local Py3.14 SIGSEGVs on pandas — use the pinned 3.12 venv) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HARD-01 | Inverse near-zero-equity day no longer emits an un-guarded ~100×/day return (guarded/finite) | unit (pure) | `pytest tests/test_native_nav.py -k blowup -x` | ✅ (add tests) |
| HARD-01 | Headline `cumulative_return`/`cagr` finite + consistent with rising chart | unit (pure) | `pytest tests/test_metrics.py -k finite_composite -x` | ✅ (add tests) |
| HARD-01 | Worker persists finite `csv_daily_returns` + `metrics_json_by_basis` | integration (offline stub) | `pytest tests/test_stitch_composite_job.py -k blowup -x` | ✅ (add test) |
| HARD-04 | Short/flow-heavy window stamps `insufficient_window`, CAGR value unchanged | unit (pure) | `pytest tests/test_metrics.py -k insufficient_window -x` | ✅ (add tests) |
| back-compat | SC-4 byte-identity pins stay GREEN (nav_twr + native_nav + golden) | unit | `pytest tests/test_nav_twr.py tests/test_native_nav_sc4_identity.py -x` | ✅ (exists) |

### Sampling Rate
- **Per task commit:** the quick command on the touched module.
- **Per wave merge:** full analytics suite (must be green; SC-4 pins load-bearing).
- **Phase gate:** full suite green + the repro cited in the verification record (no-reasoning-alone gate).

### Wave 0 Gaps
- [ ] `tests/test_native_nav.py` — add inverse near-zero-equity blow-up RED/GREEN pair (primary regression).
- [ ] `tests/test_metrics.py` — add finite-composite headline test + `insufficient_window` flag test (value-unchanged + threshold).
- [ ] `tests/test_stitch_composite_job.py` — add the offline worker-level persist assertion using the existing `_FakeSupabase` + patched `build_deribit_native_ledger`.
- [ ] Frontend DQ-chip render for `insufficient_window` — verify/extend the caveat map (composite factsheet).

## Security Domain

`security_enforcement` not set in config → treat as enabled, but this phase is an **analytics-correctness** change with no auth/session/access-control/crypto surface.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes (light) | The reconstruction already fail-loud-coerces every numeric input (`_coerce_float`, `nav_twr.py:186-208`); the new guard/flag must preserve that discipline. |
| V6 Cryptography | no | No crypto touched. |
| V2/V3/V4 (auth/session/access) | no | Worker-only, no user-facing auth surface. |

**Leak discipline (project invariant, load-bearing here):** every exception/flag in `nav_twr.py` / `native_nav.py` carries CODES/COUNTS/RELATIVE ratios only — **never a raw NAV/PnL/USD magnitude** (T-73-02 / T-76-03-LEAK, documented `nav_twr.py:24-25`). The new `pnl_dominated_guard` and `insufficient_window` flag MUST be booleans (or codes), never emit the raw equity/PnL that would leak account size.

---

## Sources

### Primary (HIGH — codebase, this session)
- `analytics-service/services/nav_twr.py:385-420` — the per-day denominator + `_guard_denominator` (the guard gap).
- `analytics-service/services/native_nav.py:475-658` — native USD-NAV valuation + `reconstruct_native_nav_and_twr` (the blow-up path).
- `analytics-service/services/broker_dailies.py:173-225` — `combine_native_ledger` path selection.
- `analytics-service/services/allocated_capital.py:120-124,290-295,576` — validated-positive scheduled denominator (rules out the Zavara path).
- `analytics-service/services/metrics.py:545,554-655,1131-1149` — cumulative/CAGR sites + segmented-suffix + `_safe_float`/sanitize.
- `analytics-service/services/job_worker.py:3083-3102,3340-3555` — composite fan-out, compute, persist, DQ merge.
- `src/lib/composite/compositeAttribution.ts:49-128` — per-key contribution (geometric `Π(1+r)−1`, reads persisted series).
- `src/lib/utils.ts:3-12` — `formatPercent(null) → "—"` (rules out pure-null as the `+0.0%` cause).
- `src/lib/factsheet/compute.ts:39,49` — client-side cagr coalesce-to-0 (secondary candidate).
- `analytics-service/tests/test_stitch_composite_job.py:97-289` — the offline pure-stub harness (repro layer 3).
- git `2c728953` (`git show --stat`) — P72 scope (numerator/single-key, not the composite denominator).

### Secondary (MEDIUM — project memory / MEMORY.md, cross-checked against code)
- Composites geometric-by-default; arithmetic only for "simple"/Zavara via `attributionBasisFromConfig` — confirmed at `compositeAttribution.ts:49-60` + `job_worker.py:3310-3317`.
- #597 asset-class annualization (CAGR = calendar days/365; risk = √365 crypto) — confirmed at `metrics.py:34-54`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The repro composite (Titan Forge) takes the `denominator_config is None` NATIVE path (not the Zavara allocated path). | (a) | If it actually carries a `returns_denominator_config`, the denominator is validated-positive and the blow-up must originate elsewhere (revisit `daily_pnl_usd_series` valuation). LOW risk — allocated denominator cannot go near-zero; a blow-up there would be a marks/valuation bug, still surfaced by the same pure fixture. `[ASSUMED]` |
| A2 | The literal "+0.0%" is produced by the segmented-suffix-flat mechanism (finite near-zero), not a client coalesce. | (c) | If it's the `compute.ts:39` client coalesce, the fix is still (b) at the source (finite series → finite eq[n-1] → correct client cagr); the repro disambiguates. `[ASSUMED]` |
| A3 | The small `prev_nav` is above the $1000 dust floor (else `dust_nav_guard` would already fire and the days would be NaN, not exploded). | (a) | If sub-$1000, the days are already guarded and the blow-up is a different (marks/units) artifact — the fixture reveals which. `[ASSUMED]` |

## Open Questions

1. **Real small equity vs. valuation artifact** — see §g Q1. Resolve against the fixture's reconstructed NAV, then choose fix (b1) vs (b2).
2. **`insufficient_window` threshold + flow-heavy trigger** — §g Q2, founder-tunable.
3. **Frontend DQ-chip render site** for `insufficient_window` — confirm the composite factsheet caveat map location during planning.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.12 pinned venv | analytics pytest (local 3.14 SIGSEGVs on pandas) | ✅ | `analytics-service/.venv` (3.12) | Run in CI-3.12 |
| pandas / numpy | reconstruction + metrics | ✅ | pandas 3.0.3 / numpy 2.5.1 (per lock) | — |
| Supabase test project | NOT needed (pure fixture) | n/a | — | Pure offline fixture by design |

**Missing dependencies with no fallback:** none — the primary repro is pure/offline.

## Metadata

**Confidence breakdown:**
- Root-cause path + denominator file:line: HIGH — traced end to end in code.
- Guard-gap as the defect: HIGH (mechanism) / MEDIUM (real-vs-artifact equity — fixture resolves).
- "+0.0%" exact mechanism: MEDIUM — two consistent candidates, repro disambiguates; fix is invariant to which.
- HARD-04 site + value-unchanged stamping: HIGH (site) / MEDIUM (threshold tunable).
- Repro-fixture design: HIGH — pure function + existing offline harness.

**Research date:** 2026-07-11
**Valid until:** ~2026-08-10 (stable internal code; re-verify line numbers if `nav_twr.py`/`metrics.py`/`job_worker.py` are edited before planning).

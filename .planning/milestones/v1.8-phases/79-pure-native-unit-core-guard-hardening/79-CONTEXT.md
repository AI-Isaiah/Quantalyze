# Phase 79: Pure Native-Unit Core + Guard Hardening - Context

**Gathered:** 2026-07-07
**Status:** Ready for execution
**Source:** v1.9 roadmap (`.planning/v1.9-ROADMAP.md`) + the P1 contract spec (`.planning/phase-78/P1_native_core_contract.md`, grounded @ main 9a1e7b8e — all file:line anchors RE-VERIFIED against current main during planning; none drifted)

<domain>
## Phase Boundary

Phase 79 is **PURE + ADDITIVE — no production wiring**. It builds the per-currency
native-unit reconstruction machinery (`services/native_nav.py`), extends the shared
types it needs, hardens the cumulative TWR against silent chain-bridging, and
generalizes the Deribit indexable-currency membership — proving everything on
SYNTHETIC fixtures. Phase 80 wires it, gates it, and runs the real keys.

**Delivers (in scope):**
- New pure module `services/native_nav.py` (§1): `NativeLedger`, `reconstruct_native_nav_and_twr`, `classify_currency`/`MarkBranch`, `UnmarkableCurrencyError`, `InceptionReconciliationError`, `INCEPTION_ABS_TOL_USD`/`INCEPTION_REL_TOL`.
- `ExternalFlow` extension (+`currency`/`quantity`) with BOTH positional 2-unpack fixes in the same commit (§2).
- `USD_FAMILY` promoted into `external_flows.py`; `deribit_txn._LINEAR_CURRENCIES` becomes its alias (§3.2).
- `cumulative_twr_segmented` replacing `cumulative_twr` (deleted same change) + `twr_chain_broken` guard key + caller migration + source-scan/gap-fill pins (§6).
- `chain_linked_twr` additive `prev0` kwarg, default-preserving (§1.4).
- `_INVERSE_CURRENCIES` → injected `indexable_currencies` keyword (default-identical) across ALL 5 census consumers (§7.1) + the probe-set builder (stub-tested) threaded live into `fetch_deribit_ledger_daily_records` so SOL heals on the existing path (G6, revised).
- SC-4 dual-run identity suite + inception gate on SYNTHETIC fixtures (§4.2, §5) + the IEEE ×1.0 micro-pin.
- SI-01 CI grep-guard: no fresh `=== 'complete'` exact-match status consumers.

**Does NOT deliver (Phase 80):** `build_deribit_native_ledger`, `combine_native_ledger`, native-core job-path routing, real-key re-derivation, live tolerance tuning. (The USD-space SOL probe-threading into `fetch_deribit_ledger_daily_records` now lands in Phase 79 — G6, revised.)
</domain>

<decisions>
## Locked Decisions

1. **SC-4 byte-identity is sacred.** Every change to an EXISTING symbol
   (`ExternalFlow`, `chain_linked_twr`, the 5 `_INVERSE_CURRENCIES` consumers) is
   default-preserving/byte-identical for current callers, pinned by a
   mutation-honest test in the SAME wave as the change.
2. **TDD discipline (Phase 77 pattern):** every behavioral task is RED → GREEN with
   an explicit mutation-honesty note (the exact neuter that must flip the test red).
3. **Verbatim reuse, never fork:** the native core imports `reconstruct_nav` (:266),
   `chain_linked_twr` (:297), `_guard_denominator` (:345), `NavTWRMeta` (:106),
   `NAV_TWR_GUARD_KEYS` (:145), `NavReconstructionError` (:155), `_coerce_float`
   (:163), `_row_utc_day` (`deribit_txn.py:388`) — §1.1.
4. **Leak discipline holds:** no raw NAV/balance/flow/quantity values in any log or
   exception (`nav_twr.py:443-444` precedent; §1.1, §3.4, §5.3).
5. **Refusal is value-gated:** a zero-everywhere UNMARKABLE currency is skipped
   silently (`deribit_txn.py:282-283` precedent); nonzero value refuses loudly
   (§3.1, §3.4). Marks are NEVER forward-filled or interpolated (§3.3).
6. **No new dependencies:** stdlib + pandas + numpy only.

## Wave order deviation from the roadmap's listed sequence (justified)

The roadmap lists 79-01 → 79-02 (core) → 79-03 (hardening) → 79-04. Contract §1.3
step 6 requires the native core's meta assembly to include "the §6 chain-break key"
(`twr_chain_broken`) — a **dependency inversion**: the guard hardening must land
BEFORE the core so the core is written once, complete, with no retrofit. Plan IDs
keep the roadmap's content mapping; only the WAVES reorder:

| Wave | Plan | Content |
|------|------|---------|
| 1 | 79-01 | ExternalFlow ext + 2-unpack fixes + USD_FAMILY + classifier + refuse errors + SI-01 |
| 2 | 79-03 | `cumulative_twr_segmented` + `twr_chain_broken` + caller migration + pins (§6) |
| 3 | 79-02 | `prev0` kwarg + `NativeLedger` + native core + inception gate (§1, §5) |
| 4 | 79-04 | `_INVERSE_CURRENCIES` generalization (§7) + SC-4 dual-run identity suite (§4.2) |

`nav_twr.py` is touched by 79-01 (2-unpack fix), 79-03 (segmented + key), and 79-02
(`prev0`) — strict file-ownership sequencing regardless of semantic independence.

## Plan-time resolutions of contract ambiguities (flag → decision)

- **G1 — `classify_currency` "never raises" (§3.1) vs "overlap raises" (§3.2):**
  resolved by placing the `USD_FAMILY ∩ indexable == ∅` check in a separate
  module-level validator (`native_nav._assert_families_disjoint`) called ONCE at
  the top of `reconstruct_native_nav_and_twr` (classification step 1), NOT inside
  `classify_currency` per call. Both contract sentences hold.
- **G2 — venue string for exception metadata:** `NativeLedger` (§1.2) carries no
  venue field, yet §3.4/§5.3 errors carry `venue`. Resolved: additive keyword
  `venue: str = ""` on `reconstruct_native_nav_and_twr`, used ONLY inside exception
  metadata (§9.1's clause permits exactly this).
- **G3 — bucket contribution outside its own [first, last] span (§1.3 step 4):**
  before a bucket's first index day it contributes exactly 0.0 (its pre-history
  balance is inception-gate-enforced ≈0; valuing sub-tolerance dust would demand
  marks for days with nothing verifiable). After its last index day the terminal
  balance carries forward (balances are constant between events), and the §3.3
  density contract therefore requires marks on those days when the balance ≠ 0.
- **G4 — branch-1 flow with `quantity=None`:** uses `usd_signed` verbatim as the
  native quantity (branch-1 invariant `quantity == usd_signed`, mark ≡ 1.0 — an
  identity, not back-solving). Branch-2 with `quantity=None` refuses
  (`reason="flow_quantity_missing"`, §2.2/§3.4).
- **G5 — `cumulative_twr` has ZERO production callers** (grep-verified: only
  `tests/test_nav_twr.py` imports it). The real production silent-bridging site is
  `metrics.py:468` (`total_return = (1 + returns.dropna()).prod() - 1`) — the §6.2
  "no inline Π(1+returns.dropna()) caller" scan is only satisfiable by migrating
  it. 79-03 migrates `total_return` (and keeps `_cagr_index` consistent with the
  compounded suffix so annualization spans the same window). Clean/no-NaN accounts
  are bit-identical; only interior-break accounts change — exactly DQ-03's intent.
- **G6 — SOL probe threading (REVISED per Opus plan-check):** roadmap phase-79
  criterion 5 says the SOL key-1 crash is "fixed ON THE EXISTING PATH" in 79, and
  SC-5 + the user's P1 intent ("fixes key 1's SOL crash") require it IN Phase 79.
  The live probe-threading is independent of the native core, safe without any
  Phase-80 gate, and bounded I/O (one probe per non-floor currency per job) — so
  it lands in 79, NOT deferred. Resolution: 79-04 lands the kwargs on all 5
  consumers AND `build_deribit_indexable_currencies` (probe + static-floor union,
  stub-tested, per-job cache shape) AND threads the built set live inside
  `fetch_deribit_ledger_daily_records` (built ONCE right after
  `enumerate_currencies`, :585; drives the :636 gate + `inverse_days_needing_index`).
  SOL heals on the existing USD-space path in 79 (`sol_heals_on_existing_path`
  pin: records returned, no LedgerValuationError; the mirror unresolvable-probe
  case still refuses loudly). Only `build_deribit_native_ledger` /
  `combine_native_ledger` / native-core job routing remain in Phase 80.
</decisions>

<sc_crossmap>
## Roadmap Success Criteria → wave/task map

| SC | Requirement | Plan / Task |
|----|-------------|-------------|
| SC-1 `reconstruct_native_nav_and_twr` + `NativeLedger` + 6 pure steps + `(returns, meta)` shape | NAT-01 | 79-02 T2 (steps 1,2,4,5,6) + 79-02 T3 (step 3) |
| SC-2 `ExternalFlow` `(currency, quantity)` + both 2-unpack fixes same-commit | NAT-02 | 79-01 T1 |
| SC-3 `classify_currency` 3 branches + one `USD_FAMILY` + value-gated refusal + density refusal | NAT-03 | 79-01 T1 (set) + T2 (classifier/errors); density enforcement 79-02 T2 |
| SC-4 `cumulative_twr_segmented` replaces `cumulative_twr` + `twr_chain_broken` + pins | DQ-03 | 79-03 T1/T2/T3 |
| SC-5 5-consumer `indexable_currencies` injection + probe set + live threading (SOL heals) | IDX-01 | 79-04 T1/T2 (builder built + threaded live in fetch; G6 revised) |
| SC-6 SC-4 identity suite + inception gate green on synthetic + IEEE pin | (gates in 80) | 79-04 T3 (suite), 79-02 T3 (gate) |
| SC-7 SI-01 `=== 'complete'` CI source-scan guard | SI-01 | 79-01 T3 |
</sc_crossmap>

<canonical_refs>
## Canonical References

- `.planning/phase-78/P1_native_core_contract.md` — THE contract (§0–§9, App A/B). Plans implement it verbatim.
- `analytics-service/services/nav_twr.py` — the shared core being reused/extended.
- `analytics-service/services/external_flows.py` — the flow contract being extended.
- `analytics-service/services/deribit_txn.py` — `_LINEAR_CURRENCIES`/`_INVERSE_CURRENCIES` + the 4 in-module census consumers.
- `analytics-service/services/deribit_ingest.py` — the 5th consumer (:636), probe (:816-827), settlement index (:432).
- `analytics-service/services/metrics.py:468` — the production inline dropna-prod (G5).
- `.planning/phases/77-upnl-basis-reconciliation/77-0*-PLAN.md` — the TDD plan format matched here.
</canonical_refs>

<deferred>
## Deferred (Phase 80/81 — do NOT implement in 79)
- `build_deribit_native_ledger` / `txn_rows_to_native_daily` / `combine_native_ledger` (§9.1/§9.2, NAT-04/NAT-05).
- (Probe threading into `fetch_deribit_ledger_daily_records` MOVED to Phase 79 — G6 revised; no longer deferred.)
- Real-key re-derivation, inception tolerance tuning, golden parity, founder sign-off (SC-4/INCEPT-01/ACC-03 gates).
- SI-02 `failed_final`-bounce launder fix (80-01).
- ccxt 4-field flow population (`ccxt_flows.py:295` stays 2-arg; defaults keep it byte-identical — §2.3, Phase 81/P3).
</deferred>

---
*Phase: 79-pure-native-unit-core-guard-hardening*
*Context gathered: 2026-07-07 (planner; contract anchors re-verified against main)*

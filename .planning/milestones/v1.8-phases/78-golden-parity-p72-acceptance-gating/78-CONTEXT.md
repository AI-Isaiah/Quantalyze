# Phase 78: Golden Parity + P72 Acceptance (GATING) - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning
**Source:** Autonomous run (/gsd-autonomous --from 73), locked decisions carried from the v1.8 milestone chain (P73–P77 + hardening + final xhigh red team)

<domain>
## Phase Boundary

This is the **HARD GATE** that authorizes flipping flow-aware TWR into production. It builds and runs a golden **old-vs-new parity harness** over a fixed multi-venue account panel, and re-runs the carried v1.7 **P72 acceptance canary** under the corrected returns. Nothing ships until this phase is clean.

**Delivers:**
- The ACC-01 golden-parity harness: dual-compute the OLD (anchor-to-today) and NEW (flow-aware) daily-returns series for each account in a fixed panel, classify every delta, and gate on the invariants below.
- The ACC-02 acceptance re-run: `scripts/deribit_acceptance.py` (the P72 canary) green under corrected returns; LTP056/068/016 verified as honest track records.

**Does NOT deliver:** any new TWR math (that is P73–P77, complete), the OKX flow-history un-clamp (documented live-validation follow-up, below), or the production flip itself (that is a founder action once this gate is clean).
</domain>

<decisions>
## Implementation Decisions

### ACC-01 — Golden parity harness (the gate)
- **Reuse the existing primitive.** `services/parity_diff.py::classify_delta` was built early (P73) and already returns exactly the four buckets `UNCHANGED | REANNUALIZATION | FLOW_MOVED | UNEXPLAINED` (`BUCKET_LABELS`). The harness is a *driver* around it, not a new classifier.
- **Dual-compute / shadow.** Emit BOTH the old and new returns series per account and diff them — mirroring the v1.5 frozen-engine re-baseline ceremony. Do not mutate production factsheets during the harness run.
- **⭐ LOW-3 (load-bearing): diff the RETURNS SERIES for the no-move invariant, NOT the CAGR.** `metrics.py` moved CAGR/Calmar to a calendar-365 clock (TWR-05), so EVERY factsheet's CAGR shifts by `365/252` even when the return series is byte-identical. `classify_delta` already encodes this: an unchanged series with a `365/252` CAGR shift is `REANNUALIZATION` (expected), not `UNEXPLAINED`. The panel gate keys the "must not move" invariant on the SERIES; CAGR/Calmar movement is expected and bucketed as REANNUALIZATION.
- **Panel invariants (the pass condition):**
  - Flow-less accounts, per venue → series `UNCHANGED` (CAGR may be `REANNUALIZATION`). NEVER `FLOW_MOVED`/`UNEXPLAINED`.
  - LTP068 → `FLOW_MOVED` (it MUST move — it was the +458%/229,214% CAGR inflation that motivated the whole milestone).
  - **ZERO `UNEXPLAINED` deltas accepted.** Every account is explained account-by-account; any `UNEXPLAINED` blocks the gate until root-caused.
- **Panel composition:** at minimum one flow-less account per live venue (Deribit, OKX, Bybit, Binance) as the byte-identity control, plus the LTP056/068/016 real accounts as the movement cases. The researcher should determine how the panel is sourced (recorded fixtures vs live/DB account IDs).

### ACC-02 — P72 acceptance canary + real-account verification
- **Reuse `scripts/deribit_acceptance.py`** (the P72 canary): `check_factsheet_status`, `check_date_coverage`, `check_daily_reconcile`, `check_inverse_signs`. Re-run it under corrected returns; it must go green. Green closes ACC-02 and triggers the v1.7 audit→complete→cleanup.
- LTP056 / LTP068 / LTP016 verified as correct track records **against exchange statements**: trade counts match, funding reconciles, inverse-P&L signs verified, LTP068 no longer +458%.

### Founder-validation gates converging HERE (mark these tasks `autonomous: false`)
The whole milestone deferred these because there is no automated net for them; P78 golden parity + founder confirmation is the ONLY mechanism:
1. **OKX/Bybit wallet-scope wrong-anchor** (P76): a mis-scoped wallet anchor (Binance SPOT vs USDⓈ-M, Bybit FUND vs UNIFIED) is invisible to the reconciliation residual (it is self-consistent by construction). Only golden parity vs real statements catches it.
2. **Deribit `session_upl` field name** `[ASSUMED A1]` (P77): confirm against a live Deribit key. If wrong, the uPnL wedge silently degrades to 0.0 (no correctness risk, only a missed warning) — but confirm here.
3. **LTP056/068/016 magnitudes** vs exchange statements (ACC-02/SC-2).
4. **P72 canary green** (SC-3).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The ACC-01 classifier primitive (built P73 — reuse, do not reinvent)
- `analytics-service/services/parity_diff.py` — `classify_delta(...)`, `BUCKET_LABELS`, `REANNUALIZATION_FACTOR = 365/252`, `_series_unchanged`, `_matches_reannualization`. This is the gate's core.

### The P72 acceptance canary (reuse under corrected returns)
- `analytics-service/scripts/deribit_acceptance.py` — the four `check_*` functions + `--account <uuid>:<subaccount>:<label>:<start>:<end>` CLI.

### The corrected TWR chain being validated
- `analytics-service/services/nav_twr.py` — `reconstruct_nav_and_twr`, the evidence-gated DQ-02 terminus (`flow_coverage_gap_evidence`, `negative_nav_guard_pre_terminus`), `NAV_TWR_GUARD_KEYS`.
- `analytics-service/services/metrics.py` — CAGR/Calmar on the calendar-365 clock (`_CALENDAR_DAYS_PER_YEAR`) — the reason CAGR shifts panel-wide (LOW-3). **Do NOT modify.**
- `.planning/STATE.md` — the full P73–P77 + hardening + xhigh-red-team record (keys `stopped_at`, `specialist_batch2_v1_8`, `xhigh_redteam_v1_8`).

### Requirements
- `.planning/REQUIREMENTS.md` — ACC-01 (line 41), ACC-02 (line 42).
</canonical_refs>

<specifics>
## Specific Ideas
- The harness likely lives as `analytics-service/scripts/` (peer to `deribit_acceptance.py`) with a fixture-backed self-test under `tests/` so the invariants are CI-enforced (mutation-honest: the test must fail if the classifier or the panel gate is neutered).
- Prefer recorded fixtures for the flow-less byte-identity controls so the "must not move" invariant runs in CI without live keys; the real-account (LTP0xx) verification vs exchange statements is the founder-gated, live portion.
</specifics>

<deferred>
## Deferred Ideas
- **OKX flow-history un-clamp** (from the final xhigh red team, `xhigh_redteam_v1_8`): OKX external flows fetch is self-clamped to `_flow_since_ms = retention_floor` (90d). Recovering full flow history for accounts WITH old OKX flows means un-clamping that bound to page the deposit/withdrawal-history endpoints toward inception. This changes real API cost and CANNOT be validated without a live OKX key → it is a P78 **live-validation follow-up**, not a harness-build blocker. Accounts with old OKX flows beyond 90d are currently *honestly segmented* (`complete_with_warnings`), which is correct fail-loud behavior. Archive-bills as a flow source was proven infeasible (internal own-transfers only) — do NOT revisit that path.
- The short-window CAGR DQ flag (carried in TODOS.md) — out of P78 scope.
</deferred>

---

*Phase: 78-golden-parity-p72-acceptance-gating*
*Context gathered: 2026-07-07 via autonomous run (locked decisions from the v1.8 chain)*

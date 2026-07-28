# Phase 78: Golden Parity + P72 Acceptance (GATING) - Research

**Researched:** 2026-07-07
**Domain:** Analytics-service return-math parity gating (pandas oracle diff + live acceptance canary re-run)
**Confidence:** HIGH (all mechanisms verified in-repo against source at HEAD and the frozen pre-73 ref)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Reuse the existing primitive.** `services/parity_diff.py::classify_delta` already returns the four buckets `UNCHANGED | REANNUALIZATION | FLOW_MOVED | UNEXPLAINED` (`BUCKET_LABELS`). The harness is a *driver* around it, not a new classifier.
- **Dual-compute / shadow.** Emit BOTH the old and new returns series per account and diff them — mirroring the v1.5 frozen-engine re-baseline ceremony. Do NOT mutate production factsheets during the harness run.
- **⭐ LOW-3 (load-bearing): diff the RETURNS SERIES for the no-move invariant, NOT the CAGR.** `metrics.py` moved CAGR/Calmar to a calendar-365 clock (TWR-05), so EVERY factsheet's CAGR shifts by `365/252` even when the return series is byte-identical. `classify_delta` already encodes this: an unchanged series with a `365/252` CAGR shift is `REANNUALIZATION` (expected), not `UNEXPLAINED`. The panel gate keys the "must not move" invariant on the SERIES; CAGR/Calmar movement is expected and bucketed as REANNUALIZATION.
- **Panel invariants (pass condition):**
  - Flow-less accounts, per venue → series `UNCHANGED` (CAGR may be `REANNUALIZATION`). NEVER `FLOW_MOVED`/`UNEXPLAINED`.
  - LTP068 → `FLOW_MOVED` (it MUST move — the +458%/229,214% CAGR inflation that motivated the milestone).
  - **ZERO `UNEXPLAINED` deltas accepted.** Any `UNEXPLAINED` blocks the gate until root-caused.
- **Panel composition:** ≥1 flow-less account per live venue (Deribit, OKX, Bybit, Binance) as the byte-identity control, plus LTP056/068/016 as the movement cases. Researcher determines sourcing (recorded fixtures vs live/DB IDs) — see below.
- **ACC-02:** Reuse `scripts/deribit_acceptance.py` (the P72 canary): re-run under corrected returns; it must go green. Green closes ACC-02 and triggers the v1.7 audit→complete→cleanup. LTP056/068/016 verified vs exchange statements.
- **Founder-validation gates converging HERE (mark tasks `autonomous: false`):** (1) OKX/Bybit/Binance wallet-scope wrong-anchor; (2) Deribit `session_upl` field name `[ASSUMED A1]`; (3) LTP056/068/016 magnitudes vs statements; (4) P72 canary green.

### Claude's Discretion
- HOW the OLD (anchor-to-today) series is produced for the dual-compute (git-ref-run vs frozen standalone oracle). **This research recommends the frozen oracle — see Architecture Pattern 1.**
- HOW the fixed panel is sourced (recorded fixtures vs live DB IDs vs Railway one-off). **This research recommends fixtures for the CI-gated controls, live `--config`/`--account` for the founder-gated real accounts.**
- Harness file layout under `analytics-service/scripts/` + fixture-backed self-test under `tests/`.

### Deferred Ideas (OUT OF SCOPE)
- **OKX flow-history un-clamp** (`_flow_since_ms = retention_floor`, 90d). Un-clamping toward inception changes real API cost and cannot be validated without a live OKX key → a P78 **live-validation follow-up**, NOT a harness-build blocker. Accounts with old OKX flows beyond 90d are honestly segmented (`complete_with_warnings`) — correct fail-loud behavior. Archive-bills as a flow source is PROVEN infeasible (internal own-transfers only) — do NOT revisit.
- The short-window CAGR DQ flag (carried in TODOS.md) — out of P78 scope.
- **DO NOT MODIFY** (scope fences): `metrics.py` CAGR/Calmar calendar-365 clock, `deribit_linear_external_flow_usd`, the `transforms.py` P74 byte-identity pins.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ACC-01 | Golden old-vs-new parity harness on a fixed multi-venue panel: flow-less accounts MUST NOT move; LTP068 MUST move; every delta explained account-by-account; NO unexplained movement accepted; shadow/dual-compute. | Frozen anchor-to-today oracle (Pattern 1) feeds `classify_delta` (verified: buckets series-move vs metric-only shift exactly as required). CI self-test over fixtures (Validation Architecture). |
| ACC-02 | LTP056/068/016 verified vs exchange statements under corrected returns (trade counts, funding reconcile, inverse-P&L signs, LTP068 no longer +458%); P72 canary re-runs green. Closing this triggers v1.7 audit→complete→cleanup. | `scripts/deribit_acceptance.py` (5 `check_*` gates) re-run via `railway ssh` after the corrected pipeline re-persists the LTP factsheets. Founder-gated / live (`autonomous: false`). |
</phase_requirements>

## Summary

Phase 78 adds **no new math**. It builds a *driver* around the already-shipped, already-tested `services/parity_diff.py::classify_delta` primitive (P73, 11 tests green, 92% cov) and re-runs the already-shipped `scripts/deribit_acceptance.py` canary (P72) under the corrected pipeline. The entire phase is verification infrastructure plus one live founder-gated canary run.

The one load-bearing design decision — **how to produce the OLD (anchor-to-today) series** for the dual-compute — resolves cleanly. The old silent-fallback formula was deleted from `transforms.py` in P73/P74, but it survives verbatim at the **v1.8-branch merge-base commit `9a1e7b8e`** (`services/transforms.py` L148–215, confirmed by `git show`). The recommendation is to **transcribe that formula into a small pure "frozen anchor-to-today oracle"** committed with the harness (provenance-commented to the exact ref), NOT to check out and import the old module. This mirrors the v1.5 frozen-engine re-baseline ceremony CONTEXT.md points at, is deterministic and dependency-free, and cannot drift. The NEW series comes straight from the live core (`trades_to_daily_returns_with_status` / `combine_realized_and_funding`), and `classify_delta(old, new, has_flows=...)` buckets the delta.

The parity gate splits cleanly into a **CI-enforced, fixture-backed portion** (flow-less byte-identity controls `UNCHANGED`; an LTP068-shaped fixture `FLOW_MOVED`; zero `UNEXPLAINED`; mutation-honest) and a **founder-gated live portion** (`autonomous: false`): the real LTP056/068/016 magnitudes vs exchange statements, the OKX/Bybit/Binance wallet-scope confirmation, the Deribit `session_upl` field confirmation, and the P72 canary green via `railway ssh`. Real strategy UUIDs are prod secrets and are supplied at runtime, never committed.

**Primary recommendation:** Build `scripts/golden_parity.py` as a thin driver over `classify_delta`, fed OLD by a frozen anchor-to-today oracle (transcribed from `9a1e7b8e:services/transforms.py`) and NEW by the live core; back it with a mutation-honest CI self-test over synthetic fixtures (flow-less→UNCHANGED, LTP068-shape→FLOW_MOVED, zero UNEXPLAINED). Re-run `deribit_acceptance.py` via `railway ssh` for the founder-gated ACC-02 close. Verify everything in the CI-3.12 venv (local Python 3.14 SIGSEGVs on pandas).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Old-vs-new series classification | Pure analytics lib (`services/parity_diff.py`) | — | Already built P73; pure, I/O-free; the gate's core primitive. |
| OLD anchor-to-today reconstruction | Pure harness oracle (`scripts/golden_parity.py`) | — | Frozen formula from the pre-73 ref; deterministic, no service graph. |
| NEW flow-aware reconstruction | Analytics core (`nav_twr.reconstruct_nav_and_twr` via `transforms`/`broker_dailies`) | — | The corrected chain being validated; call it, do not reimplement. |
| CAGR/Calmar metric shift | Analytics metrics (`metrics.py`, calendar-365) | — | Already shipped (TWR-05); harness only *reads* it for the REANNUALIZATION check. **Do NOT modify.** |
| Panel fixtures (byte-identity controls) | Test fixtures (`tests/fixtures/`) | — | CI-gated, no live keys — recorded/synthetic daily_pnl series. |
| Live ledger re-crawl + persisted read | Live driver (`scripts/deribit_acceptance.py`) | Railway + Supabase | Read-only exchange crawl + Supabase SELECT; orchestrator-only via `railway ssh`. |
| Production flip | Founder action | — | Explicitly OUT of scope — happens once this gate is clean. |

## Standard Stack

### Core (all already present — NO new dependencies; REQUIREMENTS.md grounding fact confirmed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pandas | 2.2.3 | Series diff (`assert_series_equal`), oracle equity-curve math | Already the analytics substrate; `classify_delta` and the core use it. |
| numpy | 2.4.6 | `np.isclose` scalar tolerance in `classify_delta` | Already pinned; oracle parity math. |
| pytest | (requirements-dev) | Fixture-backed mutation-honest self-test | The analytics suite's test runner; CI gate. |
| ccxt | 4.5.59 | (indirect) live Deribit re-crawl in `deribit_acceptance.py` | Only exercised in the live founder-gated ACC-02 run, not CI. |
| supabase (create_client) | pinned | Read persisted `strategy_analytics` / `csv_daily_returns` in the canary | Existing read path; SELECT-only. |

**Installation:** none. `uv pip sync analytics-service/requirements.txt` to correct local drift (ccxt 4.5.46 local vs 4.5.59 pinned) before branch work.

### Alternatives Considered (for the OLD-series mechanism — Claude's discretion)
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| **Frozen oracle (RECOMMENDED)** — transcribe `9a1e7b8e:transforms.py` formula into the harness | `git worktree` checkout of `9a1e7b8e` + import old `transforms` | REJECTED: old `transforms.py` pulls the whole service import graph, the old signature differs, and it re-introduces deleted code as a live import. Fragile, heavyweight, non-deterministic across env drift. |
| Frozen oracle | Read pre-73 persisted factsheet values from the DB | REJECTED for the gate: the corrected pipeline OVERWRITES `csv_daily_returns`/`strategy_analytics` on re-derive, so the OLD values vanish. Usable only if captured *before* recompute — the oracle is robust regardless. |

## Package Legitimacy Audit

**N/A — this phase installs no external packages.** REQUIREMENTS.md grounding fact (line 10): "No new dependencies." All libraries (pandas/numpy/pytest/ccxt/supabase) are already pinned and in use. No slopcheck/registry audit required.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────── CI-ENFORCED (fixture-backed, no live keys) ───────────────┐
                         │                                                                          │
 synthetic daily_pnl ───▶│  OLD: old_anchor_to_today_returns(daily_pnl, balance)   [frozen oracle]  │
 fixtures (per venue,    │        └─ verbatim from 9a1e7b8e:transforms.py L148-215                   │
 flow-less + LTP068-     │  NEW: trades_to_daily_returns_with_status(trades,        [live core]      │
 shaped)                 │        account_balance, external_flows=…, open_unrealized_usd=…)          │
                         │                    │                                                     │
                         │                    ▼                                                     │
                         │   classify_delta(old, new, old_metrics, new_metrics, has_flows) ─────────┼──▶ bucket
                         │                    │                                                     │      │
                         │   panel gate:  flow-less → UNCHANGED (metrics REANNUALIZATION)           │      │
                         │                LTP068-shape (has_flows) → FLOW_MOVED                      │      │
                         │                ANY UNEXPLAINED → FAIL (exit nonzero)                      │      │
                         └──────────────────────────────────────────────────────────────────────────┘      │
                                                                                                            ▼
                         ┌─────────────── FOUNDER-GATED / LIVE (autonomous: false) ──────────────┐   pass/fail
                         │  railway ssh "python -m scripts.deribit_acceptance                     │
 live Deribit ledger ───▶│    --account <real_uuid>:<key_idx>:LTP0xx:<start>:<end>"              │
 (read-only creds)       │  ┌─ re-crawl ledger  ─ assert_ledger_complete                          │
 Supabase persisted ────▶│  ├─ check_factsheet_status  (complete/complete_with_warnings)          │
 (strategy_analytics,    │  ├─ check_date_coverage      (overlap)                                  │
  csv_daily_returns) ────▶│  ├─ check_daily_reconcile    (nonzero-P&L days exact; zero advisory)   │
 (post corrected re-     │  └─ check_inverse_signs       (fixture-pinned)                          │
  derive)                │  exit 0 = ACC-02 green → triggers v1.7 audit→complete→cleanup           │
                         └──────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
analytics-service/
├── scripts/
│   ├── golden_parity.py        # NEW — ACC-01 driver: frozen oracle + panel gate over classify_delta
│   └── deribit_acceptance.py   # EXISTING — ACC-02 canary, re-run as-is (no code change needed)
├── services/
│   └── parity_diff.py          # EXISTING — classify_delta primitive (reuse, do not touch)
└── tests/
    ├── test_golden_parity.py   # NEW — mutation-honest CI self-test (the real gate)
    └── fixtures/
        └── deribit_flow_fixtures.py  # EXISTING — LTP068-shaped + flow-less synthetic rows to reuse/extend
```

### Pattern 1: Frozen anchor-to-today oracle (THE load-bearing design decision)
**What:** A pure function transcribed verbatim from the pre-73 formula, producing the OLD (silently-inflated) return series from the same `(daily_pnl, account_balance)` inputs the core consumes.
**When to use:** Every panel account's OLD side of the dual-compute.
**Why frozen, not checked-out:** The old formula is small, self-contained, and *must never change again* — a frozen transcription with a provenance comment can't drift and needs no service-graph imports. `[VERIFIED: git show 9a1e7b8e:analytics-service/services/transforms.py]`

The exact old formula to transcribe (daily_pnl branch — the LTP path; there is a parallel individual-trades branch at the same ref):
```python
# frozen from 9a1e7b8e:services/transforms.py L148-215 (pre-73 anchor-to-today).
# DO NOT "fix" — this is the OLD behaviour we are diffing against. The
# `estimated_start <= 0 -> account_balance` fallback IS the +458% LTP068 bug.
_DUST = 1000.0
if account_balance and account_balance > _DUST:
    total_pnl = daily_pnl.sum()
    estimated_start = account_balance - total_pnl
    initial_capital = estimated_start if estimated_start > 0 else account_balance  # <-- the bug
else:
    initial_capital = max(daily_pnl.abs().mean() * 100, abs(daily_pnl.sum()), 10000)  # heuristic
equity = initial_capital + daily_pnl.cumsum()
prev_equity = equity.shift(1).fillna(initial_capital).replace(0, initial_capital)
returns = daily_pnl / prev_equity
```

**Key algebraic fact that makes the byte-identity controls trivial** `[VERIFIED: 74-01/74-02 SC-4 pins, rtol 1e-12]`: for a flow-less account with `estimated_start > 0`, the NEW core (`external_flows=None`) is **byte-identical to this OLD oracle** by construction (day-0 denominator `= reconstructed pre-history capital = initial_capital` under F=0). So `classify_delta(old, new) == UNCHANGED` for those controls is guaranteed by the same algebra the P74 pins already lock. The gate proves the wiring still honours it end-to-end.

**Where OLD and NEW legitimately diverge** (the FLOW_MOVED cases): (a) `estimated_start <= 0` (profits withdrawn — the NEW core NaN/flags instead of the silent `account_balance` fallback), and (b) real external flows dated into the NEW numerator. Both are the LTP068 class.

### Pattern 2: Panel gate as a thin driver
**What:** Iterate the panel; per account compute `old`/`new` series + `old_metrics`/`new_metrics` (`{"cagr","calmar"}` from `metrics.py`), call `classify_delta(old, new, old_metrics=…, new_metrics=…, has_flows=<panel-known>)`, assert the expected bucket, accumulate, and exit nonzero on any mismatch or any `UNEXPLAINED`.
**Why `has_flows` is caller-supplied** `[CITED: parity_diff.py docstring L27-33]`: reannualization changes scalars, not the series; a moved series is either an honest flow move or a flow-less regression — indistinguishable from the series alone. The panel knows each account's flow status, so it passes `has_flows`. Flow-less control MUST pass `has_flows=False` so any movement fails closed as `UNEXPLAINED`.

### Anti-Patterns to Avoid
- **Diffing CAGR for the no-move invariant.** CAGR shifts panel-wide by `365/252` (TWR-05) even on a byte-identical series. Key the "must not move" invariant on the SERIES; let CAGR movement bucket as REANNUALIZATION. (This is the locked LOW-3 point.)
- **Re-implementing the old formula loosely / from memory.** Transcribe verbatim with the ref comment; a subtly-wrong OLD oracle produces spurious FLOW_MOVED/UNEXPLAINED and destroys the gate's authority.
- **Mutating production factsheets during the harness run.** Dual-compute is read-only/shadow (CONTEXT lock). `deribit_acceptance.py` is already READ-ONLY by construction; keep `golden_parity.py` the same.
- **Printing raw USD NAV / flow / series magnitudes to CI logs.** Account-size leak class (T-73-02 / T-76-03-LEAK / T-77-02). The gate emits buckets and booleans, never dollar magnitudes.
- **Passing `has_flows=True` for a flow-less control to "make it green."** That defeats the entire regression net.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Old-vs-new delta classification | A new bucketing function | `parity_diff.classify_delta` + `BUCKET_LABELS` | Already built P73, mutation-tested, fail-closed default. Reinventing risks a non-fail-closed classifier. |
| Series "unchanged" comparison | Manual `==`/`np.allclose` loops | `parity_diff._series_unchanged` (wraps `pd.testing.assert_series_equal`) | Handles index+dtype+name tolerances correctly; a manual loop misses index mismatches. |
| The `365/252` reannualization check | Recomputing CAGR shifts inline | `parity_diff._matches_reannualization` / `REANNUALIZATION_FACTOR` | Encodes the Calmar-shares-CAGR-basis algebra; already proven. |
| Deribit acceptance checks | New reconcile logic | `deribit_acceptance.py` `check_*` (5 gates) | Already the P72 SC-2 harness; re-run as-is under corrected returns. |
| NEW flow-aware series | Reimplementing the chain-link | `trades_to_daily_returns_with_status` / `combine_realized_and_funding` | The live core under test; the harness calls it so the gate validates the *real* path. |

**Key insight:** Every primitive this phase needs already exists and is tested. The phase's entire value is *composition + a mutation-honest self-test + one live canary run* — writing new math would defeat the point (the gate would validate the harness's math, not production's).

## Common Pitfalls

### Pitfall 1: The OLD oracle silently drifting from the real pre-73 behaviour
**What goes wrong:** A paraphrased oracle diverges from the true anchor-to-today formula → flow-less controls show spurious deltas (false UNEXPLAINED) or LTP068 shows the wrong magnitude.
**Why it happens:** Re-typing from memory; missing the `.replace(0, initial_capital)` divide-guard or the individual-trades branch.
**How to avoid:** Transcribe verbatim from `git show 9a1e7b8e:analytics-service/services/transforms.py` with a provenance comment; add a self-test asserting the oracle reproduces a known pre-73 golden series (a small committed JSON, mirroring the v1.5 `golden_252d_expected.json` ceremony).
**Warning signs:** A flow-less control classifies as anything but UNCHANGED; LTP068's OLD CAGR isn't ≈+229,214%.

### Pitfall 2: Shared-path blast radius (Pitfall #12, milestone-level)
**What goes wrong:** `transforms.py` is the ONE path all venues flow through; any change shifts EVERY factsheet.
**Why it happens:** The gate exists precisely because this risk is real.
**How to avoid:** The panel MUST include ≥1 flow-less control per venue proving byte-identity; the gate is a HARD blocker, not a checklist. Shadow/dual-compute until clean.
**Warning signs:** Any flow-less control moves.

### Pitfall 3: Running the harness in the local Python 3.14 venv
**What goes wrong:** SIGSEGV at pytest collection in native pandas tslibs (numpy 2.4.6 vs pandas 2.2.3).
**How to avoid:** Run in the CI-3.12 pinned venv (`python-version: "3.12"` in ci.yml); `uv pip sync analytics-service/requirements.txt` first.
**Warning signs:** Segfault before any test runs.

### Pitfall 4: ACC-02 "green" read as CI-runnable
**What goes wrong:** Someone tries to wire `deribit_acceptance.py` into CI. It needs live read-only Deribit creds + Supabase service key + `railway ssh` — executor subagents have neither.
**How to avoid:** Mark the ACC-02 canary task `autonomous: false`; it is orchestrator-run via `railway ssh` after the corrected pipeline has re-derived and re-persisted the LTP factsheets. "Green under corrected returns" ⇒ the 5 checks pass *after* recompute.
**Warning signs:** A plan task tries to add the canary to `.github/workflows/ci.yml`.

### Pitfall 5: Reconcile ordering — the canary reads persisted rows
**What goes wrong:** Running `deribit_acceptance.py` before the corrected pipeline re-derives LTP056/068/016 reconciles the OLD persisted (inflated) factsheet → misleading pass/fail.
**How to avoid:** Sequence ACC-02 as: (1) corrected re-derive of the three LTP strategies in prod, (2) THEN the canary. The canary's `check_daily_reconcile` now gates on nonzero-P&L days (zero-days advisory) as of `9a1e7b8e` — inherit that fix.

## Runtime State Inventory

> Included because the OLD code was DELETED (a source-history transition) — the "old behaviour" now lives only in git history and must be re-materialized for the diff.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Prod `csv_daily_returns` + `strategy_analytics` for LTP056/068/016 still hold PRE-73 (inflated) values until the corrected pipeline re-derives them. LTP068 = +458% cum / 229,214% CAGR. | Re-derive (corrected) BEFORE the canary reads them (Pitfall 5). The OLD series for the *gate* comes from the frozen oracle, not these rows. |
| Deleted source (the "old" behaviour) | The anchor-to-today fallback (`estimated_start<=0 → account_balance`, `prev_equity.replace(0,…)`) was deleted P73/P74; survives at merge-base `9a1e7b8e:services/transforms.py` L148-215. | Transcribe into the frozen oracle with a provenance comment (Pattern 1). **Verified present at that ref.** |
| Live service config | Real strategy UUIDs, `DERIBIT_CLIENT_ID_{N}`/`SECRET_{N}`, `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` live only in the Railway env — NOT in git. | Founder/orchestrator supplies UUIDs at runtime via `--account`/`--config`; secrets read from env (never printed). |
| Secrets/env vars | Deribit `session_upl` field name `[ASSUMED A1]` — confirm against a live key (P77 carry). Wrong name ⇒ uPnL wedge silently degrades to 0.0 (no correctness risk, missed warning only). | Founder-gated confirmation (`autonomous: false`). |
| Build artifacts | None — no package rename; the oracle is new source, not a rebuild. | None. |

**Real account IDs:** NOT in the codebase (prod secrets). The repo contains only placeholders (`abc-uuid` in `test_deribit_acceptance.py`) and labels (LTP056/068/016/072 in `docs/deribit-key-rotation.md`, docstrings, and fixture names). Docstring example windows: `2025-08-01:2025-09-30`, key indices `1`/`2`. **The founder/orchestrator must supply the real `<uuid>:<key_index>:<label>:<start>:<end>` tuples at run time** — plan this as an `autonomous: false` input, not a codebase grep.

## Code Examples

### Panel gate driver skeleton (the ACC-01 harness)
```python
# Source: composition of verified in-repo primitives
# analytics-service/services/parity_diff.py + transforms.trades_to_daily_returns_with_status
from services.parity_diff import (
    classify_delta, UNCHANGED, REANNUALIZATION, FLOW_MOVED, UNEXPLAINED,
)

def gate_account(daily_pnl, account_balance, *, external_flows, open_unrealized_usd,
                 has_flows, expected_bucket) -> bool:
    old = old_anchor_to_today_returns(daily_pnl, account_balance)          # frozen oracle (Pattern 1)
    new, _meta = compute_new_series(daily_pnl, account_balance,            # live core
                                    external_flows=external_flows,
                                    open_unrealized_usd=open_unrealized_usd)
    bucket = classify_delta(
        old, new,
        old_metrics=metrics_of(old),   # {"cagr","calmar"} via metrics.py (read-only)
        new_metrics=metrics_of(new),
        has_flows=has_flows,
    )
    assert bucket != UNEXPLAINED, f"UNEXPLAINED delta blocks the gate: {expected_bucket=}"
    return bucket == expected_bucket
```

### Re-running the ACC-02 canary (orchestrator, live)
```bash
# Source: analytics-service/scripts/deribit_acceptance.py USAGE docstring (verified)
# Run AFTER the corrected pipeline re-derives LTP056/068/016 in prod (Pitfall 5).
railway ssh "cd /app && python -m scripts.deribit_acceptance \
  --account <real_uuid>:1:LTP056:2025-08-01:2025-09-30 \
  --account <real_uuid>:2:LTP068:2025-08-01:2025-09-30 \
  --account <real_uuid>:3:LTP016:2025-08-01:2025-09-30"
# exit 0 = every gate passed = ACC-02 green = trigger v1.7 audit→complete→cleanup
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Anchor-to-today `initial_capital = balance − Σpnl`, silent `≤0 → balance` fallback | Backward daily-NAV + chain-linked TWR + fail-loud DQ guards | P73–P74 (deleted the fallback both branches) | The OLD behaviour must be re-materialized (frozen oracle) to diff against. |
| CAGR/Calmar on 252 clock | CAGR/Calmar on calendar-365 clock (`_CALENDAR_DAYS_PER_YEAR=365`) | 73-02 (TWR-05) | Panel-wide CAGR shift by `365/252` → REANNUALIZATION bucket (expected). |
| DQ-02 terminus fired unconditionally past retention | Evidence-gated terminus (`flow_coverage_gap_evidence` + `negative_nav_guard_pre_terminus`) | xhigh red team | Flow-less accounts keep FULL history + stay `complete` (byte-identity restored) — the gate's byte-identity controls depend on this fix. |

**Deprecated/outdated:** the pre-73 `transforms.py` fallback — reproduced only as the frozen oracle, never re-imported.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service), Python **3.12** venv (CI); local 3.14 SIGSEGVs on pandas |
| Config file | `analytics-service` — `pytest --cov=services --cov=routers --cov=main_worker --cov-fail-under=80` (ci.yml:984) |
| Quick run command | `pytest tests/test_golden_parity.py -x` (in CI-3.12 venv) |
| Full suite command | `pytest --cov=services --cov-fail-under=80` (current baseline 3147 pass / 92 skip) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ACC-01 | Flow-less control (per venue) → series `UNCHANGED`, metrics `REANNUALIZATION` | unit (fixture) | `pytest tests/test_golden_parity.py::test_flowless_controls_unchanged -x` | ❌ Wave 0 |
| ACC-01 | LTP068-shaped (has_flows) → `FLOW_MOVED` (OLD CAGR ≈ +229,214%, NEW honest) | unit (fixture) | `pytest tests/test_golden_parity.py::test_ltp068_shape_flow_moved -x` | ❌ Wave 0 |
| ACC-01 | Panel gate exits nonzero on ANY `UNEXPLAINED` | unit | `pytest tests/test_golden_parity.py::test_any_unexplained_fails_gate -x` | ❌ Wave 0 |
| ACC-01 | Frozen oracle reproduces a committed pre-73 golden series | unit (golden) | `pytest tests/test_golden_parity.py::test_oracle_matches_pre73_golden -x` | ❌ Wave 0 |
| ACC-02 | LTP056/068/016 5 gates green under corrected returns | live/manual | `railway ssh "… scripts.deribit_acceptance --account …"` | ✅ script exists; **`autonomous: false`** |

### Sampling Rate (be concrete)
- **Per series-point:** the `UNCHANGED` invariant is asserted at **rtol 1e-9** across *every point* of the flow-less control series (`_series_unchanged` → `assert_series_equal`). This is a per-point sample, not a headline-metric sample — a single perturbed day fails.
- **Per-account:** `classify_delta` is invoked once per panel account; the expected-bucket assertion is per-account.
- **Per-venue:** ≥1 flow-less byte-identity control per venue (Deribit, OKX, Bybit, Binance) — 4 minimum + the 3 LTP movement cases.
- **Per commit:** `pytest tests/test_golden_parity.py -x` (< 5s, fixtures only).
- **Per phase gate:** full analytics suite green + the live ACC-02 canary exit 0 before the founder flip.

### Mutation-Honest Self-Test (the CI-enforced gate — MUST fail when neutered)
The self-test is the actual gate. It must go RED under each of these mutations:
1. **Classifier neutered:** force `classify_delta` to return `UNCHANGED` unconditionally → `test_ltp068_shape_flow_moved` and `test_any_unexplained_fails_gate` must RED.
2. **Panel gate neutered:** make the driver accept `UNEXPLAINED` (drop the `assert bucket != UNEXPLAINED`) → an injected unexplained-move fixture must RED.
3. **`has_flows` flipped for a flow-less control** (True) → the control's regression net is defeated; a test pinning `has_flows=False` for controls must RED when flipped.
4. **Oracle drift:** perturb the frozen oracle (e.g. drop the `estimated_start<=0 → account_balance` fallback) → `test_oracle_matches_pre73_golden` and the LTP068 FLOW_MOVED magnitude must RED.
5. **Series-vs-CAGR confusion:** if the gate keys the no-move invariant on CAGR instead of the series, the panel-wide `365/252` shift makes flow-less controls spuriously "move" → a test asserting flow-less → REANNUALIZATION-on-metrics-but-UNCHANGED-on-series must RED if the invariant is mis-keyed.

Reuse `tests/fixtures/deribit_flow_fixtures.py` (LTP068-shaped inverse withdrawal, dominating withdrawal, pure-flow no-trade, flow-less) as the fixture bedrock; extend with per-venue flow-less controls and a committed pre-73 golden JSON.

### Wave 0 Gaps
- [ ] `tests/test_golden_parity.py` — the mutation-honest gate (covers ACC-01, all 5 mutations)
- [ ] `scripts/golden_parity.py` — the driver + frozen oracle (Pattern 1)
- [ ] A committed pre-73 golden series JSON (oracle provenance pin, mirrors `golden_252d_expected.json`)
- [ ] Per-venue flow-less control fixtures (extend `deribit_flow_fixtures.py`)
- [ ] Framework install: none — pytest already present.

## Security Domain

> `security_enforcement` is not set in config (absent = enabled). This phase adds **no new attack surface** (read-only verification + a pure oracle). The relevant controls are data-exposure, not auth/injection.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes (minor) | `deribit_acceptance._parse_account_spec` already validates the 5-field spec + ISO dates; the golden-parity driver consumes fixtures/typed inputs. |
| V6 Cryptography | no | none. |
| V7/V8 Data Protection & Logging | **yes (load-bearing)** | Never emit raw USD NAV/flow/series magnitudes or account balances to logs (T-73-02/T-76-03-LEAK/T-77-02). Gate output is buckets + booleans. Creds (`DERIBIT_*`, `SUPABASE_SERVICE_KEY`) read from env, never printed (already enforced in `deribit_acceptance.py`). |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Account-magnitude leak via log/detail strings | Information Disclosure | Emit classification buckets + counts, never dollar magnitudes (existing repo discipline; `_MAX_NAMED` caps date lists). |
| Credential leak in the live canary | Information Disclosure | Secrets passed to ccxt/Supabase clients only; `deribit_acceptance.py` prints neither creds nor secrets on any path (exit-code 2 on missing env). Keep `golden_parity.py` fixture-only in CI (no creds). |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| pytest + pandas/numpy | ACC-01 CI self-test | ✓ | 3.12 venv, pandas 2.2.3 / numpy 2.4.6 | none — MUST use CI-3.12 (local 3.14 SIGSEGVs) |
| `railway` CLI + `railway ssh` auth | ACC-02 live canary | orchestrator-only | — | none — executor subagents have no railway/Supabase; `autonomous: false` |
| Live read-only Deribit creds (`DERIBIT_CLIENT_ID_{N}`/`SECRET_{N}`) | ACC-02 ledger re-crawl | prod env only | — | none — founder/orchestrator run |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | ACC-02 persisted read | prod env only | — | none |
| Real LTP056/068/016 strategy UUIDs + windows | ACC-02 `--account` tuples | NOT in repo (prod secret) | — | founder supplies at runtime (`autonomous: false`) |

**Missing dependencies with no fallback:** the live ACC-02 pieces are inherently founder-gated — this is expected, not a blocker; plan them `autonomous: false`.
**Missing dependencies with fallback:** none for the CI portion (fully fixture-backed).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Deribit `session_upl` is the correct live uPnL field name (carried from P77 `[ASSUMED A1]`) | Runtime State Inventory / Founder gates | If wrong, uPnL wedge silently → 0.0 (no correctness risk, missed warning only). Confirm on a live key during ACC-02. |
| A2 | The pre-73 acceptance windows for LTP056/068/016 are ≈`2025-08-01..2025-09-30` (docstring example values) | Code Examples / Env Availability | If the real onboarding windows differ, `check_date_coverage` uses overlap (not equality) so minor drift is tolerated; founder supplies the true windows at run time. |
| A3 | Key indices map LTP056→1, LTP068→2, LTP016→3 (inferred from docstring `:1:`/`:2:` examples) | Code Examples | Wrong index → wrong creds env pair → the canary fails loud (env error, exit 2), not a silent wrong result. Founder confirms. |

*A1–A3 are all founder-confirmable at the ACC-02 live run; none affects the CI-gated ACC-01 portion.*

## Open Questions

1. **(RESOLVED)** **Which flow-less real accounts (if any) get a live canary vs pure fixtures for the byte-identity controls?** — Adopted in the plans: ship the fixture-backed per-venue controls as the CI gate (78-02); any additional live flow-less comparison is an optional founder-gated add-on, not a blocker.
   - What we know: CONTEXT prefers recorded fixtures for the flow-less controls (CI, no keys); the LTP0xx real accounts are the live movement cases.
   - What's unclear: whether the founder also wants a live flow-less control per venue re-derived-and-compared beyond the fixtures.
   - Recommendation: ship the fixture-backed per-venue controls as the CI gate; treat any additional live flow-less comparison as an optional founder-gated add-on, not a blocker.

2. **(RESOLVED)** **Does the frozen-oracle individual-trades branch need coverage, or only the daily_pnl branch?** — Adopted in the plans: transcribe BOTH branches (78-01 Task 1); fixture-test the daily_pnl branch (the LTP path), individual-trades covered-by-transcription.
   - What we know: LTP/broker paths are `daily_pnl`; the individual-trades branch existed at the ref too.
   - Recommendation: transcribe BOTH branches for completeness but fixture-test the `daily_pnl` branch (the LTP path); note the individual-trades branch as covered-by-transcription.

## Sources

### Primary (HIGH confidence)
- `analytics-service/services/parity_diff.py` (HEAD) — `classify_delta`, `BUCKET_LABELS`, `REANNUALIZATION_FACTOR`, `_series_unchanged`, `_matches_reannualization` (read in full).
- `analytics-service/scripts/deribit_acceptance.py` (HEAD) — 5 `check_*` gates, CLI, live driver, READ-ONLY construction (read in full).
- `git show 9a1e7b8e:analytics-service/services/transforms.py` L148-215 — the frozen OLD anchor-to-today formula; `9a1e7b8e` confirmed as the v1.8-branch merge-base (`git merge-base v1.8-flow-aware-twr main`).
- `analytics-service/services/transforms.py` / `broker_dailies.py` (HEAD) — NEW-core signatures (`trades_to_daily_returns_with_status`, `combine_realized_and_funding`) with `external_flows`/`open_unrealized_usd`.
- `analytics-service/services/nav_twr.py` / `metrics.py` (HEAD) — `reconstruct_nav_and_twr`, `apply_flow_coverage_terminus`, `NAV_TWR_GUARD_KEYS`, `_CALENDAR_DAYS_PER_YEAR=365`.
- `.planning/STATE.md`, `.planning/REQUIREMENTS.md`, `78-CONTEXT.md` — locked decisions, P73–P77 record, ACC-01/02 definitions.
- `.github/workflows/ci.yml` — analytics job `python-version: "3.12"`, `pytest --cov-fail-under=80`.

### Secondary (MEDIUM confidence)
- `analytics-service/docs/deribit-key-rotation.md`, `tests/test_deribit_acceptance.py`, `tests/fixtures/deribit_flow_fixtures.py`, `tests/test_derive_broker_dailies_dualmode.py` — LTP labels, fixture shapes, dual-mode patterns.

### Tertiary (LOW confidence)
- A2/A3 acceptance windows + key indices (docstring examples) — founder-confirmed at ACC-02 run.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all primitives read at HEAD.
- Architecture (frozen oracle + driver): HIGH — old formula verified present at the exact merge-base ref; byte-identity algebra already pinned by P74.
- Pitfalls: HIGH — drawn from the STATE.md P73–P77 record and the shared-path blast-radius blocker.
- Real-account specifics (IDs/windows): LOW — prod secrets, supplied at runtime (by design).

**Research date:** 2026-07-07
**Valid until:** 2026-08-06 (stable — internal analytics, no fast-moving external deps)

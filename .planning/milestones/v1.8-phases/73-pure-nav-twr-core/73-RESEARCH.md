# Phase 73: Pure NAV/TWR Core - Research

**Researched:** 2026-07-05
**Domain:** Flow-aware chain-linked time-weighted returns (GIPS true-TWR) over a backward-reconstructed daily NAV series; annualization-basis split — Python analytics-service, I/O-free math
**Confidence:** HIGH (every claim below is grounded in the live code with quoted line ranges; quantstats internals verified against the installed 0.0.81 source)

---

<user_constraints>
## User Constraints (from PROJECT.md Key Decisions + REQUIREMENTS.md)

> No `*-CONTEXT.md` exists for this phase yet (discuss-phase not run). These constraints are the
> LOCKED decisions from `.planning/PROJECT.md ## Key Decisions` (2026-07-05) and REQUIREMENTS.md.
> The planner MUST honor them; they are NOT open for re-litigation in planning.

### Locked Decisions

1. **TWR-05 — SPLIT the annualization basis.** RETURN/CAGR **and Calmar** annualize on the **calendar clock (365 / true elapsed-calendar-days)**; **Sharpe / volatility / Sortino / rolling_\*** stay **252**. This **supersedes ANNUAL-02 for the return metric only**; the √252 risk-comparability convention is preserved for risk metrics. Return and risk are orthogonal clocks (founder domain call). Mutation-verified: a 365-day fixture's CAGR must differ from the 252 computation by the expected factor, and Sharpe must be unchanged.
   - ⚠️ **Doc conflict flagged:** REQUIREMENTS.md L13 ("grounding facts") still says *"KEEP 252 universal annualization — no crypto-365."* That line is **STALE** — it predates the 2026-07-05 founder correction. The authoritative statement is PROJECT.md Key Decisions row "v1.8: SPLIT the annualization basis" + REQUIREMENTS.md TWR-05 (L25) + ROADMAP SC-5. **Plan to the SPLIT, not to 252-universal.**

2. **uPnL basis — realized-basis intra-window NAV + fail-loud DQ flag.** Reconstruct on a realized-basis terminal NAV (`anchor − open_unrealized_usd`); re-add uPnL only to the reported *current* NAV; raise `unrealized_pnl_in_anchor` (`complete_with_warnings`) when the wedge is material. **This is Phase 77's implementation** — Phase 73's core only needs to *accept* an `open_unrealized_usd` parameter (default `0.0`) so the terminal-NAV basis is pluggable later. Never silently absorb the wedge.

3. **No new dependencies.** `pandas==2.2.3`, `numpy==2.4.6`, `quantstats==0.0.81`, `scipy` (present) cover all math. stdlib + pandas + numpy only for `nav_twr.py` (mirrors `deribit_txn.py`). REQUIREMENTS.md Out-of-Scope explicitly bans `empyrical`/`pyfolio`/`ffn`.

4. **No frontend / factsheet UI changes.** analytics-service return-math only.

### Claude's Discretion (research → recommend)
- The exact `nav_twr.py` public function signature and internal structure (recommended below).
- Whether the TWR-05 metrics split adds a `cagr_periods` param vs. computes CAGR from the date span (recommended: **date-span**, see Architecture).
- Names of the new DQ flag keys (recommended set below).
- Test file layout for the numpy-pinned oracle + byte-identity pin.

### Deferred Ideas (OUT OF SCOPE for Phase 73)
- Wiring the two callers through the core (`broker_dailies.py:130`, `analytics_runner.py:1309`) → **Phase 74** (TWR-03/TWR-04).
- Deleting the silent fallback in `transforms.py` → **Phase 74** (TWR-03).
- Per-venue dated flow *sourcing* (Deribit/Binance/Bybit/OKX adapters) → **Phases 75–76** (FLOW-*).
- uPnL companion read from `exchange.py` → **Phase 77** (FLOW-04).
- Golden old-vs-new parity gate → **Phase 78** (ACC-01). *Its harness INFRASTRUCTURE may be stood up here, but the requirement gates in 78.*
- Migrating the 8 frontend `computation_status === "complete"` consumers → **Phase 74** (TWR-04 SC-4).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **TWR-01** | New pure `services/nav_twr.py` — backward daily-NAV reconstruction `NAV_{t-1}=NAV_t−pnl_t−F_t` from the real exchange anchor, dated flows on their UTC days; I/O-free, stdlib/pandas/numpy only; revert-proof tests (deribit_txn.py discipline); numpy-pinned oracle. | Architecture "nav_twr.py core"; Don't-Hand-Roll (`_row_utc_day`, `portfolio_metrics.compute_twr` as oracle reference); Code Examples (deribit_txn discipline). |
| **TWR-02** | Chain-linked daily TWR `r_t=(NAV_t−NAV_{t-1}−F_t)/NAV_{t-1}` (flow in numerator, end-of-day convention) + cumulative `Π(1+r)−1`; edge cases: same-day multi-flow, day-0 flow, zero-NAV interior day, partial window. | Architecture "TWR formula & the F=0 identity proof"; the same numerator convention is already validated in `portfolio_metrics.compute_twr` (L126/L140). |
| **TWR-05** | Split `metrics.py` annualization — CAGR/Calmar → 365/calendar-days; Sharpe/vol/Sortino/rolling_\* → 252. Mutation-verified (365-day fixture: CAGR shifts by expected factor, Sharpe unchanged). | Code Examples "metrics.py minimal diff"; Pitfall "calmar recomputes cagr internally"; the existing rescale-proof test at `test_metrics_parity.py:994-1052` is the exact template. |
| **DQ-01** | Every NAV denominator guarded — dust-floor ($1000), negative reconstructed NAV, flow-dominated capital → break the chain-link for that day + flag `complete_with_warnings` via existing `data_quality_flags` machinery; NEVER a fabricated number. Any `clamp`/`floor`/`max(…,dust)`/`replace(0,…)` on a NAV denominator forbidden (source-scan guard). | Architecture "DQ guard mechanism"; the existing `ReturnsComputationMeta` contract (transforms.py L6-38); the existing forbidden `replace(0, initial_capital)` at transforms.py:175/211 is the anti-pattern to scan for. |
</phase_requirements>

---

## Summary

Phase 73 delivers a **new, pure, I/O-free `analytics-service/services/nav_twr.py`** plus a **surgical `metrics.py` annualization split**. The core computes honest chain-linked time-weighted returns from a daily NAV series reconstructed *backward* from today's exchange anchor, placing dated external flows on their UTC days, with every denominator fail-loud guarded. Nothing in Phase 73 touches production data paths — the two callers are wired in Phase 74 — so the whole phase is additive and revert-proof.

The single most important grounding fact: the bug being killed lives in `transforms.py:trades_to_daily_returns_with_status` at **L154-159** (`estimated_start = account_balance − total_pnl`; when `≤ 0`, silently substitutes `account_balance` as the base) and its twin at **L199**, plus a *third* silent guard — `prev_equity.replace(0, initial_capital)` at **L175 / L211** — which is exactly the `replace(0,…)` pattern DQ-01 forbids. Phase 73 does NOT delete these (that is Phase 74/TWR-03); it builds the honest replacement core and *proves byte-identity against it on flow-less input* so Phase 74 can swap safely.

Two pieces of high-value prior art already exist and must be reused, not re-invented: (1) `services/deribit_txn.py` — the fail-loud, stdlib-only, `LedgerValuationError`, disjoint-frozenset-assert, `_row_utc_day` discipline that TWR-01 is explicitly modeled on; and (2) `services/portfolio_metrics.py:compute_twr` (L64-151) — a **already-shipped, already-tested forward scalar TWR that uses the exact same end-of-day flow numerator convention** (`end_before_cf = end_val − cf_adjustment`, L126). It is structurally different (forward, scalar, from a known equity series) so it does NOT replace `nav_twr.py`, but it is a validated cross-check for the TWR math and a source of reusable patterns (`_parse_date`, day-0 skip, zero-begin-value segmentation).

**Primary recommendation:** Build `nav_twr.py` as a pure function `reconstruct_nav_and_twr(daily_pnl: pd.Series, anchor_nav: float, *, external_flows=None, open_unrealized_usd=0.0)` that (a) derives a realized-basis terminal NAV, (b) rolls NAV backward, (c) chain-links `r_t`, (d) guards every denominator into an extended `ReturnsComputationMeta`, and (e) with `external_flows=None/[]` and `open_unrealized_usd=0.0` reproduces the current `trades_to_daily_returns_with_status` daily_pnl-branch output byte-for-byte. For TWR-05, compute CAGR from the **true elapsed calendar-day span** of the DatetimeIndex (frequency-proof) and compute Calmar as `cagr_calendar / |max_dd|` — because `qs.stats.calmar` recomputes CAGR internally via `len/periods` and would otherwise diverge from a date-span CAGR.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Backward NAV reconstruction | analytics-service (Python, pure `nav_twr.py`) | — | Pure math, no I/O; belongs in a service module, not a router |
| Chain-linked daily TWR series | analytics-service (`nav_twr.py`) | — | Same — deterministic transform of (pnl, anchor, flows) |
| NAV-denominator DQ guards | analytics-service (`nav_twr.py` → `ReturnsComputationMeta`) | Phase 74 wires meta→`strategy_analytics.computation_status` | Guard math is core-tier; the DB status write is caller-tier (Phase 74) |
| Annualization split (CAGR/Calmar 365, risk 252) | analytics-service (`metrics.py:compute_all_metrics`) | — | Single site; existing `periods_per_year` plumbing already threads all annualization |
| External-flow dated contract | Phase 75 (`external_flows.py`) — NOT this phase | `nav_twr.py` only *consumes* an `(utc_day_iso, usd_signed)` shape | Core must accept the shape; sourcing/valuation is later |
| uPnL companion read | Phase 77 (`exchange.py`) — NOT this phase | `nav_twr.py` accepts `open_unrealized_usd` param, default 0.0 | Core keeps the basis pluggable; the read is a later upstream dependency |

**All Phase 73 work is analytics-service (backend Python) tier.** No frontend, no DB, no network.

---

## Standard Stack

### Core (all already pinned — NO installation action)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pandas | 2.2.3 | DatetimeIndex Series for NAV/pnl/returns, groupby-by-UTC-day, `resample` | Already the return-series carrier across the whole service |
| numpy | 2.4.6 | The pinned parity oracle (`np.isclose`/`np.testing.assert_allclose`) for TWR-01 | Precedent: v1.5 pinned the blend to an independent numpy re-derivation |
| quantstats | 0.0.81 | `qs.stats.sharpe/volatility/sortino/max_drawdown` (risk metrics, stay 252) | Already the metrics engine in `metrics.py` |
| scipy | present (via quantstats/pandas transitive) | Only used by `portfolio_metrics.py` (brentq/newton for MWR) — not needed by `nav_twr.py` | N/A to this phase |

### Supporting (in-repo, reuse — see Don't Hand-Roll)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `services/deribit_txn.py` | Discipline template: `LedgerValuationError`, `_coerce_float`, `_row_utc_day`, disjoint-frozenset import-time asserts | Model `nav_twr.py` structure on it verbatim |
| `services/portfolio_metrics.py:compute_twr` | Validated forward scalar TWR with the SAME end-of-day numerator | Cross-check oracle; reuse `_parse_date`, day-0-skip, zero-begin-val segmentation patterns |
| `services/transforms.py` | The current daily_pnl branch (L120-176) is the byte-identity target for SC-4 | Pin the core against it on flow-less input |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual date-span CAGR | `qs.stats.cagr(returns, periods=365)` | `periods=365` only ≈ calendar-years when the series is dense-daily; on sparse CSV/MT5 series `len < calendar_days` so it *understates* years and *overstates* CAGR. Date-span is frequency-proof. **[VERIFIED: quantstats 0.0.81 stats.py:1544 `years = len(returns) / periods`]** |
| Manual Calmar (`cagr_cal/|maxdd|`) | `qs.stats.calmar(returns, periods=365)` | `calmar` calls `cagr(returns, periods=periods)` internally **[VERIFIED: stats.py:1671]**; passing 365 would work for the dense case but diverge from a date-span CAGR. Compute Calmar from the same date-span CAGR for consistency. |

**Installation:** none. `nav_twr.py` imports only `pandas`, `numpy`, and stdlib.

**Version verification (ecosystem: PyPI):**
- `pandas==2.2.3`, `numpy==2.4.6`, `quantstats==0.0.81` — all pinned in `analytics-service/requirements.txt` **[VERIFIED: requirements.txt L126/L142; quantstats source at /opt/homebrew/.../python3.14/site-packages/quantstats reports `__version__ == 0.0.81`]**.

---

## Package Legitimacy Audit

**No external packages are installed by this phase.** All math dependencies (pandas, numpy, quantstats, scipy) are already pinned in `requirements.txt` and in production use. `nav_twr.py` adds zero imports beyond stdlib + pandas + numpy.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none — no new installs) | — | N/A |

**Packages removed due to slopcheck [SLOP] verdict:** none (no installs).
**Packages flagged [SUS]:** none.

---

## Architecture Patterns

### System Architecture Diagram (Phase 73 scope)

```
                       ┌─────────────────────────────────────────────┐
   INPUTS (in-memory,  │  services/nav_twr.py   (NEW, pure, I/O-free) │
   no network)         │                                              │
                       │  reconstruct_nav_and_twr(                    │
  daily_pnl: Series ──▶│      daily_pnl, anchor_nav,                  │
  anchor_nav: float ──▶│      external_flows=None,   ── default [] ───┼─▶ zero-flow == today
  external_flows ─────▶│      open_unrealized_usd=0.0 ── default ─────┼─▶ realized==mtm basis
  (Phase 75+ fills)    │  )                                           │
  open_uPnL (P77 fills)│    │                                         │
                       │    ▼                                         │
                       │  1. terminal_nav = anchor_nav − open_uPnL    │  (realized basis)
                       │  2. roll BACKWARD: NAV_{t-1}=NAV_t−pnl_t−F_t  │
                       │  3. chain-link:  r_t=(NAV_t−NAV_{t-1}−F_t)/   │
                       │                       NAV_{t-1}               │
                       │  4. GUARD every NAV_{t-1} denominator ────────┼─▶ dust/neg/flow-dom
                       │       │ pass → r_t                            │     → break chain-link
                       │       │ fail → segment + flag                 │     → complete_with_warnings
                       │    ▼                                          │       (NEVER substitute)
                       │  returns: pd.Series (name="returns",         │
                       │           DatetimeIndex)                      │
                       │  meta:    ReturnsComputationMeta (extended)   │
                       └───────────────┬──────────────────────────────┘
                                       │
       Phase 73 proves (does NOT wire):│
       byte-identity test: with external_flows=[] & open_uPnL=0,
       output == transforms.trades_to_daily_returns_with_status(...)
       daily_pnl-branch  (for accounts where estimated_start > 0)

  ── SEPARATE, PARALLEL EDIT ──────────────────────────────────────────
  services/metrics.py :: compute_all_metrics(returns, ..., periods_per_year=252)
     cagr   = date-span CAGR (365/elapsed-calendar-days)   ◀── TWR-05 CHANGE
     calmar = cagr_calendar / |max_dd|                     ◀── TWR-05 CHANGE
     sharpe/vol/sortino/rolling_* = periods_per_year (252) ◀── UNCHANGED
```

### The F=0 identity (why byte-identity holds — this is the load-bearing proof)

Current forward computation (transforms.py L149-176, daily_pnl branch):
```
initial_capital = account_balance − Σpnl          # estimated_start
equity_t        = initial_capital + cumsum_≤t(pnl)
prev_equity_t   = equity_{t-1} (== initial_capital at t0)
r_t             = pnl_t / prev_equity_t
```
New backward reconstruction with `F_t = 0`, `anchor_nav = account_balance`:
```
NAV_end   = anchor_nav
NAV_{t-1} = NAV_t − pnl_t                          # F=0
        ⇒ NAV_{t-1} = anchor_nav − Σ_{k≥t} pnl_k = initial_capital + cumsum_{<t}(pnl) = prev_equity_t
r_t       = (NAV_t − NAV_{t-1} − 0)/NAV_{t-1} = pnl_t / prev_equity_t
```
**Identical by algebra.** So SC-4's byte-identity is guaranteed by construction *for the estimated_start > 0 case*. The divergence is intentional and only on `estimated_start ≤ 0` (the bug case): the new core **flags** instead of substituting `account_balance`. → the byte-identity fixture MUST use an account whose `account_balance − Σpnl > $1000` so the forward path takes the honest branch.

### Recommended module structure (`services/nav_twr.py`)
```
services/nav_twr.py
├── class NavReconstructionError(ValueError)   # fail-loud, mirrors LedgerValuationError
├── _FLAG_KEYS (frozenset)                      # dq flag key names, see DQ guard mechanism
├── DUST_NAV_FLOOR = 1000.0                     # USD — MATCHES transforms.py _DUST_BALANCE_THRESHOLD
├── ExternalFlow contract note                  # (utc_day_iso: str, usd_signed: float) — shape only; Phase 75 owns sourcing
├── _flows_to_daily_usd(external_flows) -> pd.Series   # sum signed USD per UTC day (reuse day-key discipline)
├── reconstruct_nav(daily_pnl, terminal_nav, flows_by_day) -> pd.Series   # backward roll
├── chain_linked_twr(nav, daily_pnl, flows_by_day) -> (returns, meta)     # guards live here
└── reconstruct_nav_and_twr(...)  -> (pd.Series, ReturnsComputationMeta)  # public entry
```

### Pattern 1: Fail-loud denominator guard (DQ-01 core)
**What:** Every `NAV_{t-1}` is checked BEFORE it divides. Three break conditions, each raises a DQ flag and *segments* the chain-link (the day's `r_t` is omitted / the chain restarts), never substitutes.
**When:** every interior day of the backward roll.
```python
# Source pattern: deribit_txn.py txn_change_to_usd refuses index_price <= 0 (L205-226)
# and the existing dust threshold transforms.py:146 (_DUST_BALANCE_THRESHOLD = 1000.0)
for t in interior_days:
    denom = nav.iloc[t - 1]
    if denom < DUST_NAV_FLOOR:          # dust-floor $1000
        flags["dust_nav_guard"] = True; break_chain(t); continue
    if denom <= 0:                       # negative reconstructed NAV
        flags["negative_nav_guard"] = True; break_chain(t); continue
    if abs(flow_t) > FLOW_DOM_RATIO * denom:   # flow-dominated capital
        flags["flow_dominated_guard"] = True; break_chain(t); continue
    r_t = (nav.iloc[t] - denom - flow_t) / denom
# FORBIDDEN (source-scan guard target): denom = max(denom, floor);
#           denom.replace(0, initial); np.clip(denom, ...) — these ARE the bug.
```

### Anti-Patterns to Avoid
- **`prev_equity.replace(0, initial_capital)` (transforms.py:175, :211):** the existing third silent-substitution. The new core MUST NOT port it. A source-scan test should assert `nav_twr.py` contains no `.replace(0` / `.clip(` / `max(.*floor` / `.fillna(<nonzero>)` on a NAV denominator.
- **Computing Calmar via `qs.stats.calmar` after changing CAGR to date-span:** it recomputes CAGR internally at `len/periods` and diverges (see Pitfalls).
- **Rolling NAV backward from the mark-to-market anchor with realized-only pnl** without subtracting `open_unrealized_usd` first — leaves the uPnL wedge in every interior NAV (Phase 77's job; Phase 73 keeps the param so the basis is correct-by-default at 0.0).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UTC-day bucketing of flows/pnl | A new `date()`/`floor('D')` helper | `deribit_txn.py:_row_utc_day` (L382) — tolerates epoch-ms AND ISO | Pitfall #11: flow and pnl MUST share ONE day-boundary helper or a midnight-adjacent flow lands on the wrong `t` |
| Chain-link TWR math | A fresh sub-period loop from scratch | Cross-check against `portfolio_metrics.compute_twr` (L64-151) — same end-of-day numerator (`end_before_cf = end_val − cf_adjustment`, L126) | Already shipped + tested (`test_portfolio_metrics.py`); use as the oracle's independent reference |
| Fail-loud typed error | A bare `ValueError`/`assert` | `class NavReconstructionError(ValueError)` mirroring `LedgerValuationError` (deribit_txn.py:52) | Distinguishes permanent/structural failure from transient; matches service convention |
| Float coercion with context | `float(x)` bare | `_coerce_float(value, field=…, row=…)` pattern (deribit_txn.py:57) | Raises a contextual permanent error, not a bare crash |
| Risk-metric annualization | Re-deriving Sharpe/vol/Sortino | Leave the `qs.stats.*(periods=periods_per_year)` calls at metrics.py:460-466 UNCHANGED | TWR-05 changes ONLY cagr+calmar; risk metrics stay 252 |
| Sub-period segmentation on zero-capital gaps | A new "is the account at zero" heuristic | The `begin_val == 0 → skip + warn` pattern already in `compute_twr` (L128-138) | Same discipline: a genuine zero-capital gap is a segment boundary, not an error |

**Key insight:** This phase is 80% *assembly of existing, tested discipline* (deribit_txn fail-loud + portfolio_metrics TWR math + transforms day-branch shape) into one pure module — and 20% the metrics.py split. The risk is re-inventing a guard that the codebase already does honestly (and accidentally re-introducing a silent substitution). Read the three source modules before writing.

---

## Runtime State Inventory

> Phase 73 is **greenfield** (a new module) plus one surgical in-place metrics.py edit. No rename/refactor of stored identifiers, no data migration, no live-service config. Categories below verified explicitly:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `nav_twr.py` is pure/in-memory; no DB writes in Phase 73 (Phase 74 wires callers that write `strategy_analytics`) | None |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | None — new module auto-collected by pytest; no packaging/egg-info change | None |

**The metrics.py CAGR/Calmar change DOES alter stored `strategy_analytics.cagr`/`calmar` values on the next recompute** — but that is a *computed-output* change, not runtime state, and it is **deliberately gated by the Phase 78 golden-parity harness** (it will shift every crypto factsheet's CAGR/Calmar by the known 365/252 calendar factor). Phase 73 must NOT trigger a production recompute; it only lands the code + tests.

---

## Common Pitfalls

### Pitfall 1: Re-introducing the silent base/NAV substitution (the bug this milestone kills)
**What goes wrong:** A `NAV_{t-1}` that reconstructs to dust/negative is "fixed" by clamping to a floor or to current equity — the exact `estimated_start ≤ 0 → account_balance` trap (transforms.py:154-159) wearing a new hat. Also the third instance: `prev_equity.replace(0, initial_capital)` (transforms.py:175).
**Why it happens:** Failing loud feels like breaking the factsheet, so a "reasonable fallback" is reached for near a division.
**How to avoid:** Guard every denominator → flag `complete_with_warnings` + segment; NEVER emit a number. Add a **source-scan test** asserting `nav_twr.py` has no `.replace(0`, `.clip(`, `max(…floor`, or non-zero `.fillna` on a NAV denominator (DQ-01 explicitly requires this scan guard).
**Warning signs:** CAGR > ~1000%/yr; a "reasonable upper bound" comment near a division; any floor/clamp on `NAV_{t-1}`.

### Pitfall 2: Calmar silently diverges from the new date-span CAGR
**What goes wrong:** TWR-05 changes CAGR to a date-span calendar computation, but `qs.stats.calmar` recomputes CAGR *internally* as `cagr(returns, periods=periods)` **[VERIFIED: quantstats stats.py:1671]** using `years = len(returns)/periods` **[VERIFIED: stats.py:1544]**. If you change CAGR but keep `qs.stats.calmar`, `calmar ≠ cagr/|maxdd|` and the two headline numbers disagree.
**Why it happens:** The coupling is invisible — the code comment at metrics.py:467-471 already warns about it for the 252 case, but the date-span change breaks the assumption entirely.
**How to avoid:** Compute Calmar as `cagr_calendar / abs(max_dd)` in `metrics.py` directly (stop calling `qs.stats.calmar`). The existing comment block at L467-471 already documents *why* the two must share a basis — extend it.
**Warning signs:** A factsheet whose Calmar ≠ its displayed CAGR ÷ |max drawdown|.

### Pitfall 3: TWR-05 proof can't run on the local Python 3.14 (pandas segfault)
**What goes wrong:** The mutation-verified 365-fixture test imports pandas; local interpreter is **Python 3.14, which segfaults on pandas**. CI runs **Python 3.12** (`.github/workflows/ci.yml:930`).
**Why it happens:** Local venv drift; 3.14 + pandas 2.2.3 is not a supported combo here.
**How to avoid:** Write the test to run in CI (3.12); do NOT attempt to execute pandas-importing tests on the local 3.14 interpreter. To validate locally, use a CI-pinned 3.12/3.13 uv venv against `requirements.txt` + `requirements-dev.txt` (the B-mypy-drift precedent). Model the test on the existing rescale proof at `test_metrics_parity.py:994-1052` (`_LINEAR_365_OVER_252 = 365/252 = 1.4484`, and it already asserts `p365.cagr == (1+base.cagr)**(365/252)-1`).
**Warning signs:** A green local run that actually skipped/segfaulted; asserting CAGR change without asserting Sharpe *unchanged*.

### Pitfall 4: Short-window / sparse-series CAGR mis-annualization
**What goes wrong:** `qs.stats.cagr(returns, periods=365)` on a **sparse** series (CSV/MT5 with gaps) gives `years = len/365 < calendar_years`, overstating CAGR — a re-run of the LTP068 short-window inflation. Also a genuinely short window (weeks-old account) annualizes noise into a triple-digit CAGR.
**How to avoid:** Compute `years = (index[-1] − index[0]).days / 365` (true elapsed calendar days) — frequency-proof for dense crypto AND sparse CSV. Honor the existing no-invented-data / sample-floor invariant: suppress annualization below the floor rather than annualizing noise.
**Warning signs:** CAGR that swings as the window grows; a CAGR on an account weeks old.

### Pitfall 5: New DQ flags break the 8 exact-string `computation_status` consumers
**What goes wrong:** Setting `computation_status_hint = "complete_with_warnings"` for a new DQ flag hides the factsheet from **eight frontend consumers that gate on `computation_status === "complete"`** (transforms.py:242-249 documents them: factsheet PDFs, discovery, strategy detail, portfolios, queries, PerformanceReport, SyncProgress).
**Why it happens:** The `complete` vs `complete_with_warnings` split is load-bearing on the frontend; the existing code deliberately keeps *section-level* flags at `complete`.
**How to avoid:** In Phase 73 the new DQ flags live in the *core's returned meta only* — they do not yet drive `strategy_analytics.computation_status` (no caller is wired). **Migrating the 8 consumers is explicitly Phase 74 (TWR-04 SC-4).** Keep the flag keys additive to `ReturnsComputationMeta`; do not change `_build_meta`'s existing `complete`/`complete_with_warnings` semantics for the existing two flags.
**Warning signs:** A factsheet grid/PDF going blank on a demo strategy after the change.

*(Milestone-level pitfalls #2/#3/#4/#5/#6/#9/#12 — flow sign, internal transfers, wallet scope, inverse valuation, uPnL basis, incomplete history, silent rollout — are Phases 74–78 territory. See `.planning/research/PITFALLS.md`. Phase 73's slice is #1, #7 (denominator), #8/#10 (annualization), #11 (day bucketing).)*

---

## Code Examples

### The EXACT current return contract SC-4 must preserve (transforms.py)
```python
# Source: analytics-service/services/transforms.py L6-38, L70-74, L214-223
class ReturnsComputationMeta(TypedDict):
    used_heuristic_capital: bool
    balance_error: bool
    computation_status_hint: str   # "complete" | "complete_with_warnings"

def trades_to_daily_returns_with_status(
    trades: list[dict[str, Any]],
    account_balance: float | None = None,
    balance_error: bool = False,
) -> tuple[pd.Series, ReturnsComputationMeta]: ...

# The returned Series (L214-218):
returns = pd.Series(returns_values.values,
                    index=pd.DatetimeIndex(returns_values.index),
                    name="returns")
# daily_pnl branch shape (L120-176): parse ISO8601 utc → groupby date sum →
#   _DUST_BALANCE_THRESHOLD=1000 → estimated_start = account_balance − total_pnl
#   → if >0 use it ELSE account_balance  [THE BUG, L154-159]
#   → equity = initial + daily_pnl.cumsum()
#   → prev_equity = equity.shift(1).fillna(initial).replace(0, initial)  [FORBIDDEN GUARD, L175]
#   → returns_values = daily_pnl / prev_equity
```
**SC-4 pin:** the new `reconstruct_nav_and_twr(daily_pnl, anchor_nav=account_balance, external_flows=[], open_unrealized_usd=0.0)` must return a `returns` Series byte-identical to the above for an account with `account_balance − Σpnl > 1000`. Use `pandas.testing.assert_series_equal(new, old, check_exact=False, rtol=1e-12)` (or numpy `assert_allclose`) as the pin; the numpy oracle re-derives the same series independently for TWR-01.

### metrics.py — the minimal TWR-05 diff
```python
# Source: analytics-service/services/metrics.py L457-472 (current)
total_return = _safe_float((1 + returns.dropna()).prod() - 1)
cagr   = _safe_float(qs.stats.cagr(returns, periods=periods_per_year))     # ← CHANGE
volatility = _safe_float(qs.stats.volatility(returns, periods=periods_per_year))  # UNCHANGED
sharpe = _safe_float(qs.stats.sharpe(returns, periods=periods_per_year))          # UNCHANGED
sortino = _safe_float(qs.stats.sortino(returns, rf=MAR, periods=periods_per_year))# UNCHANGED
calmar = _safe_float(qs.stats.calmar(returns, periods=periods_per_year))   # ← CHANGE
max_dd = _safe_float(qs.stats.max_drawdown(returns))

# TWR-05 replacement (recommended — date-span, frequency-proof):
_CALENDAR_DAYS_PER_YEAR = 365.0
_idx = returns.dropna().index
_elapsed_days = max((_idx[-1] - _idx[0]).days, 1)          # guard tiny/degenerate windows
_years_calendar = _elapsed_days / _CALENDAR_DAYS_PER_YEAR
cagr   = _safe_float((1.0 + total_return) ** (1.0 / _years_calendar) - 1.0)  # 365/elapsed
calmar = _safe_float(cagr / abs(max_dd)) if max_dd else _safe_float(float("nan"))
# rolling_* (L495-497, 948-958) and TE/IR (L832-840): UNCHANGED — stay periods_per_year (252)
```
Note: `total_return` (L458) already equals quantstats `comp(returns)` = `(1+r).prod()-1`, so the date-span CAGR reuses the value the module already computes. The `_years_calendar` guard (`max(..., 1)`) prevents a divide-by-zero on a single-day window; couple it with the existing sample-floor for honest suppression (Pitfall 4).

### deribit_txn.py discipline template (model nav_twr.py on this)
```python
# Source: analytics-service/services/deribit_txn.py L52, L57-68, L330-331, L382
class LedgerValuationError(ValueError): ...            # permanent/structural, NOT transient

def _coerce_float(value, *, field, row) -> float:      # contextual fail-loud coercion
    ...
    raise LedgerValuationError(f"...{field}...")

# Import-time invariant assert (mirror for any disjoint sets you introduce):
assert not (CASH_BEARING_TYPES & INFORMATIONAL_TYPES), "...must be disjoint"

def _row_utc_day(ts) -> str:   # tolerant epoch-ms AND ISO → 'YYYY-MM-DD'  ← reuse for flows+pnl
    ...
```

### The already-shipped TWR oracle (cross-check, do NOT duplicate)
```python
# Source: analytics-service/services/portfolio_metrics.py L64-151 (compute_twr)
# Same end-of-day flow convention as nav_twr.py needs:
end_before_cf = end_val - cf_adjustment          # L126  (subtract flow from the END value)
sub_r = (end_before_cf / begin_val) - 1.0        # L140  == (NAV_t − NAV_{t-1} − F_t)/NAV_{t-1}
# Day-0 skip (L72-73/86-91) and begin_val==0 segment-skip (L128-138) are the DQ patterns to mirror.
# NOTE: this is FORWARD + SCALAR (equity series → one float). nav_twr.py is BACKWARD + SERIES
# (anchor + pnl + flows → per-day return series). Different function; shared math discipline.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Anchor-to-today: `initial = balance − Σpnl`, silent `≤0 → balance` fallback | Backward NAV reconstruction from dated flows; fail-loud guards | v1.8 (this milestone) | Flow-heavy accounts stop being silently mis-stated |
| 252-universal annualization (ANNUAL-02) | Split: CAGR/Calmar → 365/calendar, risk → 252 | 2026-07-05 (founder correction) | Every crypto factsheet's CAGR/Calmar shifts by the 365/252 factor (gated in Phase 78) |
| Modified Dietz / IRR as candidate methods | GIPS true chain-linked TWR (daily NAV exists) | v1.8 design | MWR/Dietz are anti-features (REQUIREMENTS Out-of-Scope) — but `portfolio_metrics.compute_mwr`/`compute_modified_dietz` already exist for a *different* (allocator portfolio KPI) surface; do not remove them |

**Deprecated/outdated in scope:**
- The `estimated_start ≤ 0 → account_balance` fallback and `prev_equity.replace(0, initial_capital)` — to be deleted in Phase 74; Phase 73 builds their honest replacement.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Recommended new DQ flag key names (`dust_nav_guard`, `negative_nav_guard`, `flow_dominated_guard`) are placeholders — final names are Claude's discretion | DQ guard / Pitfall 1 | Low — naming only; the machinery (`complete_with_warnings` hint) is fixed |
| A2 | `FLOW_DOM_RATIO` (flow-dominated threshold) and the "material uPnL wedge" threshold are not yet numerically specified by the founder | DQ guard / uPnL param | Medium — a wrong threshold under/over-flags; recommend a conservative default + surface for confirmation in discuss-phase |
| A3 | 365 (vs 365.25) is the calendar-days-per-year constant | metrics.py diff | Low — the existing rescale proof uses `365/252`; 365 matches PROJECT.md wording ("365 / true elapsed-calendar-days") |
| A4 | The byte-identity pin targets the **daily_pnl branch** only (not the individual-trades branch at L178-212) | SC-4 | Low — ROADMAP SC-4 says "daily_pnl-branch output"; the trades branch is not in the daily-NAV path |
| A5 | Phase 73 does NOT wire `transforms.py`/`broker_dailies.py` to call the core (that is Phase 74) | scope | Low — confirmed by ROADMAP traceability (TWR-03/04 → Phase 74) |

**These assumptions should be confirmed in discuss-phase** — especially A2 (the two numeric thresholds), which are the kind of "performance/materiality target with multiple valid values" that needs a human decision before it becomes locked.

---

## Open Questions (RESOLVED 2026-07-05)

1. **Flow-dominated threshold + material-uPnL threshold (the two magic numbers).**
   - What we know: DQ-01 requires a "flow-dominated capital (`Σ|F|` dwarfs base)" guard; Key Decision requires a `unrealized_pnl_in_anchor` flag when the wedge is "material."
   - What's unclear: the exact ratios. Phase 73 needs the flow-dominated ratio now (it's a core guard); the uPnL materiality threshold is Phase 77 but the *param* lands in 73.
   - **RESOLVED (orchestrator decision, no founder gate):** `FLOW_DOM_RATIO = 1.0` (flow ≥ 100% of prior NAV breaks the link). This is a *tunable fail-loud WARNING threshold* — it only raises `complete_with_warnings`, never alters a computed return, and no callers are wired in Phase 73 — so the conservative default is safe to lock now and is **validated/tuned against real accounts at the Phase 78 golden-parity gate** (not a founder ground-truth question). Documented as a module constant. uPnL materiality stays Phase 77 (`open_unrealized_usd=0.0` no-op in 73).

2. **Should the ACC-01 golden-parity harness scaffolding land in Phase 73 or Phase 78?**
   - What we know: REQUIREMENTS.md says the harness INFRASTRUCTURE is "built early (Phase-73 infrastructure)" but the requirement gates in Phase 78.
   - **RESOLVED:** Phase 73 builds ONLY the *reusable comparison primitive* (`parity_diff.py` — old-vs-new series-diff + delta-bucket classifier) with unit tests on synthetic series; the multi-venue panel + real-account fixtures + live run are Phase 78. (Plan 73-03.)

3. **Interior zero-NAV day: segment vs. single-day break?**
   - What we know: TWR-02 SC lists "zero-NAV interior day" as an edge case; `compute_twr` skips a single sub-period on `begin_val==0`.
   - **RESOLVED:** break the chain-link *at that day* (omit `r_t`, restart the cumulative product), flag `complete_with_warnings`. Full segmentation vs. missing-flow-dust distinction is Phase 76's reconciliation gate, NOT here. Semantics documented in the core docstring.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| pandas | nav_twr.py, metrics.py, tests | ✓ (pinned) | 2.2.3 | — |
| numpy | parity oracle | ✓ (pinned) | 2.4.6 | — |
| quantstats | metrics.py risk metrics | ✓ (pinned) | 0.0.81 | — |
| Python 3.12 | CI test execution | ✓ (CI) | 3.12 | — |
| Python (local) | local test run | ⚠️ 3.14 — **segfaults on pandas** | 3.14 | Use a 3.12/3.13 uv venv against requirements*.txt; else rely on CI |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** local pandas execution — use a CI-pinned 3.12 venv (B-mypy-drift precedent) or rely on CI green. This is I/O-free math with no network/DB dependency, so no live services are needed.

---

## Validation Architecture

> `workflow.nyquist_validation = true` in `.planning/config.json` → section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (+ `pytest-cov`, `--cov-fail-under=80`) |
| Config file | `analytics-service/` (pytest invoked in that working-dir; `.github/workflows/ci.yml:919,984`) |
| Quick run command | `cd analytics-service && pytest tests/test_nav_twr.py -x` (new file) |
| Full suite command | `cd analytics-service && pytest --cov=services --cov=routers --cov=main_worker --cov-fail-under=80` |
| CI interpreter | Python 3.12 (`ci.yml:930`) — **not** local 3.14 |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TWR-01 | Backward NAV roll matches numpy oracle to fp precision | unit | `pytest tests/test_nav_twr.py::test_backward_nav_matches_numpy_oracle -x` | ❌ Wave 0 |
| TWR-01 | Revert-proof: mutating the roll fails a test | unit (mutation) | `pytest tests/test_nav_twr.py::test_nav_roll_mutation_detected -x` | ❌ Wave 0 |
| TWR-02 | Chain-linked `r_t` + cumulative; day-0 flow, same-day multi-flow, zero-NAV interior, partial window | unit | `pytest tests/test_nav_twr.py::test_twr_edge_cases -x` | ❌ Wave 0 |
| TWR-02 | Cross-check vs `portfolio_metrics.compute_twr` on a shared fixture | unit | `pytest tests/test_nav_twr.py::test_twr_agrees_with_compute_twr -x` | ❌ Wave 0 |
| DQ-01 | dust/negative/flow-dominated each break-link + flag `complete_with_warnings` | unit | `pytest tests/test_nav_twr.py::test_dq_guards_flag_not_substitute -x` | ❌ Wave 0 |
| DQ-01 | source-scan: no `.replace(0`/`.clip(`/`max(…floor` on a NAV denom | unit (static) | `pytest tests/test_nav_twr.py::test_no_forbidden_denominator_guards -x` | ❌ Wave 0 |
| SC-4 | zero-flow output byte-identical to `trades_to_daily_returns_with_status` daily_pnl branch (estimated_start>0 fixture) | unit (pin) | `pytest tests/test_nav_twr.py::test_zero_flow_byte_identical_to_transforms -x` | ❌ Wave 0 |
| TWR-05 | 365-day fixture: CAGR shifts by 365/252 factor AND Sharpe unchanged | unit (mutation) | `pytest tests/test_metrics_parity.py::test_twr05_annualization_split -x` | ⚠️ extend existing `test_metrics_parity.py:994-1052` |
| TWR-05 | Calmar == date-span CAGR / \|max_dd\| (not qs.stats.calmar) | unit | `pytest tests/test_metrics.py::test_calmar_uses_calendar_cagr -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest tests/test_nav_twr.py tests/test_metrics.py tests/test_metrics_parity.py -x`
- **Per wave merge:** full `pytest --cov=services --cov-fail-under=80`
- **Phase gate:** full suite green (Python 3.12 in CI) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test_nav_twr.py` — covers TWR-01, TWR-02, DQ-01, SC-4 (new file)
- [ ] Extend `tests/test_metrics_parity.py` — TWR-05 split proof (model on existing L994-1052 rescale test)
- [ ] `tests/test_metrics.py` — Calmar-from-calendar-CAGR assertion
- [ ] Framework install: none — pytest infra exists
- [ ] ⚠️ Coverage gate is BLOCKING (`--cov-fail-under=80`); the new `nav_twr.py` must ship with ≥80% line coverage or CI fails (CLAUDE.md test-coverage section).

---

## Security Domain

> `security_enforcement` absent in config → treat as enabled. This phase is pure in-memory math with no I/O, auth, network, DB, or user input, so most ASVS categories are N/A.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface (pure function) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes (light) | Fail-loud `_coerce_float`/typed errors on malformed pnl/flow rows (deribit_txn precedent); no untrusted external input in Phase 73 (data arrives from already-validated internal callers) |
| V6 Cryptography | no | No crypto |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Logging raw balances/flow amounts (PII/account-size leak) | Information Disclosure | Log symbol+date+status only; cap/scrub payloads (`RAW_PAYLOAD_CAP_BYTES`/`scrub_freeform_string` precedent). Do NOT log raw NAV/flow USD values in the core. |
| Silent-corruption "fabricated number" (integrity) | Tampering | The whole DQ-01 fail-loud discipline IS the mitigation — a fabricated return is an integrity failure |

---

## Sources

### Primary (HIGH confidence)
- `analytics-service/services/transforms.py` L1-260 — the exact current `trades_to_daily_returns_with_status` contract, the `estimated_start ≤ 0` bug (L154-159, L199), the forbidden `replace(0, initial_capital)` (L175, L211), `ReturnsComputationMeta` (L6-38), `_build_meta` + the 8-consumer note (L226-259)
- `analytics-service/services/metrics.py` L31, L352-355, L457-472, L495-497, L832-840, L948-958 — `DEFAULT_PERIODS_PER_YEAR`, `compute_all_metrics` signature, the cagr/calmar/sharpe/sortino/vol call sites, rolling helpers, TE/IR
- `analytics-service/services/deribit_txn.py` L52-68, L311-331, L382 — `LedgerValuationError`, `_coerce_float`, disjoint-set asserts, `_row_utc_day` (the discipline template)
- `analytics-service/services/portfolio_metrics.py` L64-151 — existing forward scalar `compute_twr` (end-of-day numerator, day-0/zero-begin segmentation) — the validated cross-check oracle
- `analytics-service/services/broker_dailies.py` L107-134 — `combine_realized_and_funding` (caller #1) + `gap_fill_daily_returns`
- `analytics-service/services/analytics_runner.py` L1300-1320 — caller #2
- quantstats 0.0.81 installed source `stats.py` L1507-1560 (`cagr`, `years = len/periods`), L1642-1680 (`calmar` calls `cagr` internally) — verified the annualization internals
- `analytics-service/tests/test_metrics_parity.py` L994-1052 — the existing `periods_per_year=365` rescale-proof (TWR-05 test template)
- `analytics-service/tests/test_portfolio_metrics.py`, `test_transforms.py`, `test_metrics.py` — existing test structure
- `.github/workflows/ci.yml` L919-984 — Python 3.12, pytest, `--cov-fail-under=80` blocking gate
- `.planning/PROJECT.md` ## Key Decisions (2026-07-05) — the two LOCKED v1.8 decisions
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` — TWR-01/02/05, DQ-01, Phase 73 SC 1-5
- `.planning/research/PITFALLS.md`, `SUMMARY.md` — milestone-level pitfalls and grounding facts

### Secondary (MEDIUM confidence)
- GIPS / CFA time-weighted-return standard (end-of-day flow convention) — via PITFALLS.md, not re-verified against a live GIPS doc this session

### Tertiary (LOW confidence)
- None — all Phase 73 claims are code-grounded or verified against installed quantstats source.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all pinned and verified against `requirements.txt` + installed source
- Architecture (nav_twr.py design + F=0 identity): HIGH — algebraically proven byte-identity; grounded in the exact current transforms code
- TWR-05 split: HIGH — quantstats cagr/calmar internals read from installed source; the exact rescale-proof template already exists in-repo
- DQ machinery: HIGH — the `ReturnsComputationMeta`/`complete_with_warnings` contract and the 8-consumer constraint are documented in-code
- Two numeric thresholds (flow-dominated, uPnL-material): MEDIUM — values not yet founder-specified (Open Question 1; Assumption A2)

**Research date:** 2026-07-05
**Valid until:** ~2026-08-04 (stable — pinned deps, in-repo grounding; re-verify only if `transforms.py`/`metrics.py`/quantstats pin changes)

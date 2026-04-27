# Phase 12 — Cross-AI Review Findings (consolidated)

**Generated:** 2026-04-27
**Sources:** `12-REVIEW-CLAUDE.md` (feature-dev:code-reviewer subagent, fresh ctx, 14-dim review) + `12-REVIEW-GROK.md` (grok-4-1-fast-reasoning, 3-persona).
**Verdict:** PROCEED WITH FIXES — 2 BLOCKERs + 6 HIGHs + 6 MEDIUMs to address before execute.
**User directive:** Fix everything (BLOCKERs + HIGHs + MEDIUMs). LOWs are documented as informational only.

---

## BLOCKERs (must fix before execute)

### B-01 — Plan 12-05: `_compute_volume_metrics` data-flow error → METRICS-07/08 ship as None

**Source:** Claude review (verified against `analytics-service/services/analytics_runner.py:49-77, 220, 224-230`).

**Issue:** Plan 05 Task 1 GREEN snippet reads:
- `result.get("avg_winning_trade", 0.0)`
- `result.get("avg_losing_trade", 0.0)`
- `result.get("win_rate", 0.0)`

…from the in-progress `result` dict inside `_compute_volume_metrics`. But that function at `analytics_runner.py:49-77` only produces `buy_volume_pct`, `sell_volume_pct`, `long_volume_pct`, `short_volume_pct`, `total_fills`, `total_volume_usd`. The win-rate / avg-win / avg-loss keys are computed in `reconstruct_positions()` — a completely separate async call path at `analytics_runner.py:220`. At runtime every fetched key defaults to `0.0`, producing:
- `expectancy = None` (both zero → `if avg_win or avg_loss: False`)
- `risk_reward_ratio = None` (avg_loss == 0)
- `sqn = None` (risk_unit == 0)

Same problem for `profit_factor_long/short` — the snippet uses `[t.get("realized_pnl_usd", ...) for t in fills]` but the fills query at `analytics_runner.py:224-230` only `select`s `side, cost`. There is no `realized_pnl_usd` field on a fill from `raw_fills` (per migration 039:44-48). Profit factor will also always be `None`.

**Fix (planner must choose one, prefer (b) per architecture):**
- (a) Compute `avg_winning_trade`, `avg_losing_trade`, `win_rate`, `realized_pnl_usd` per-fill within `_compute_volume_metrics` itself. Requires extending the fills query at `analytics_runner.py:224-230` to also select `realized_pnl_usd`, `holding_period_hours` (if it exists; otherwise compute from entry/exit timestamps).
- (b) Move the 5 derived trade metrics computation to a NEW separate function (e.g. `_compute_derived_trade_metrics(volume_metrics: dict, trade_metrics_from_positions: dict) -> dict`) that receives both the volume-side dict from `_compute_volume_metrics` AND the trade-stats dict from `reconstruct_positions()`. Wire the call in `run_strategy_analytics` AFTER both `_compute_volume_metrics` and `reconstruct_positions` complete; merge into `trade_metrics` JSONB before upsert. This matches the actual data architecture — derived metrics are positional (from reconstruct_positions), not fill-level.

**Affected plans:** 12-05 (Task 1 GREEN), 12-06 (orchestrator wiring needs to match the chosen approach), 12-09 (regen_golden.py must produce expected JSON consistent with chosen function shape).

---

### B-02 — Plans 12-03 + 12-04: Same-file merge conflict on `metrics.py` (parallel Wave 3)

**Source:** Claude review.

**Issue:** Plan 12-03 frontmatter: `wave: 3, depends_on: [12-02]`. Plan 12-04 frontmatter: `wave: 3, depends_on: [12-02]`. Both modify `analytics-service/services/metrics.py` AND `analytics-service/tests/test_metrics.py`. The wave structure says they run in parallel — that produces a merge conflict mid-execution.

**Fix:** Update Plan 12-04 frontmatter:
```yaml
wave: 3
depends_on: [12-02, 12-03]   # was: [12-02]
```

(Plan 12-04 sequences after 12-03 within Wave 3. Plan 12-05 modifies different files — `analytics_runner.py` + `tests/test_analytics_runner.py` — so it can stay parallel to 12-03/04.)

---

## HIGHs (fix before merge / before plan-checker re-run)

### H-A1 — Plan 12-09: `regen_golden.py` doesn't simulate positions → false-green parity on `exposure_series`/`turnover_series`

**Source:** BOTH reviewers (Claude H-03 + Grok Persona A HIGH + Persona C LOW).

**Issue:** Plan 09 Task 1 (`regen_golden.py`) calls `compute_all_metrics()` and the trade-side helpers, but does not simulate `positions_by_date`, `prices_by_date`, `nav_by_date` and therefore never calls `compute_turnover_series()` or the refactored `compute_exposure_metrics()`. As a result the golden expected JSON has `exposure_series` and `turnover_series` absent. Plan 06 Task 2 explicitly punts on wiring these ("if those inputs aren't available in this scope, document the TODO and skip — the parity test in Plan 09 will catch missing kinds"). The CI gate (D-12: "fail-loud on any new key not present in expected JSON") only catches **extra** keys — missing keys silently coast through. SC#1 ("no NULLs") will silently regress on real production data while the parity test reports green.

**Fix:** Plan 12-09 Task 1 must simulate position/price/NAV time series consistent with the 252-day fills/trades and call:
- `compute_turnover_series(positions_by_date, prices_by_date, nav_by_date)` → produces `turnover_series` for the expected JSON.
- Refactored `compute_exposure_metrics(...)` → produces `exposure_series` aggregate + series.

Plan 12-06 Task 2 must commit to wiring these in the orchestrator (not punt) — `run_strategy_analytics` must compute and pass `positions_by_date` from `reconstruct_positions`'s side outputs.

**Affected plans:** 12-06 (Task 2 — must wire, not punt), 12-09 (Task 1 — must simulate position data).

---

### H-B — Plan 12-02: SECURITY DEFINER RPCs missing `SET search_path = public, pg_temp`

**Source:** Grok review (Persona B HIGH).

**Issue:** Both new RPCs in migration 086 (`claim_compute_jobs_with_priority`) and migration 087 (`fetch_strategy_lazy_metrics`) are declared `SECURITY DEFINER` but the SQL skeletons in plan 12-02 do not include `SET search_path = public, pg_temp` in the function definition. This is a real Postgres privilege-escalation risk: if a caller's `search_path` is polluted (e.g. with a malicious schema that shadows `public.compute_jobs`), the SECURITY DEFINER function would resolve identifiers against the wrong schema while running as the function owner. Standard hardening for any SECURITY DEFINER in this codebase.

**Fix:** Plan 12-02 Task 1 (migration 086) — add to RPC body:
```sql
CREATE OR REPLACE FUNCTION claim_compute_jobs_with_priority(...)
RETURNS ...
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ ... $$;
```

Plan 12-02 Task 2 (migration 087) — same `SET search_path = public, pg_temp` on `fetch_strategy_lazy_metrics`. Update the self-verifying DO block to assert `provolatile` AND that `proconfig` includes the search_path setting.

**Affected plans:** 12-02 (Tasks 1 & 2). Add to verify grep:
```bash
grep -qE "SET search_path = public, pg_temp" supabase/migrations/086_compute_jobs_priority.sql
grep -qE "SET search_path = public, pg_temp" supabase/migrations/087_strategy_analytics_series.sql
```

---

### H-C — Plan 12-09: Python parity helper has no signed-zero (`+0` vs `-0`) handling

**Source:** Grok review (Persona C HIGH).

**Issue:** `assertMetricParity()` in Plan 09 uses relative epsilon comparison for series values. For zero-return days (common in the 252-day fixture — quiet weekends, low-volume periods, or post-close periods), Python's `numpy.float64(0.0)` and `-0.0` round-trip differently through JSON serialization. `+0 != -0` will fail rel-eps comparisons because both sides are 0 (`abs(actual - expected) / max(abs(actual), abs(expected)) = 0/0 = nan`). NaN equality check needed too.

**Fix:** Plan 12-09 Task 2 — extend `assertMetricParity()` Python implementation:
```python
def _series_close(a, b, rel_eps=1e-9):
    if math.isnan(a) and math.isnan(b):
        return True
    if a == 0.0 and b == 0.0:
        # Treat +0 == -0 as equal; do not divide by zero
        return math.copysign(1.0, a) == math.copysign(1.0, b) or True  # any zero-zero pair is equal
    if a == 0.0 or b == 0.0:
        return abs(a - b) < rel_eps
    return abs(a - b) / max(abs(a), abs(b)) < rel_eps
```

Mirror the same logic in `metrics-parity-helper.ts` for the TS schema-gate's numeric sanity assertions (if any). Update the helper docstring to call out `+0/-0` and `NaN==NaN` semantics explicitly.

**Affected plans:** 12-09 (Task 2 Python helper, Task 3 TS helper).

---

### H-D — Plans 12-02 + 12-09: `equity_series_1y` wrongly classified as a sibling kind (contradicts D-01)

**Source:** Claude review (H-01).

**Issue:** D-01 (CONTEXT.md) puts `equity_series_1y` in `metrics_json` (above-the-fold series). Plan 12-02 Task 2's `fetch_strategy_lazy_metrics` RPC `panel_id = 'equity'` mapping is `ARRAY['equity_series_1y', 'log_returns_series']`. Plan 12-02 Task 4's `StrategyAnalyticsSeriesKind` union includes `'equity_series_1y'`. Plan 12-09 Task 3's `EXPECTED_SIBLING_KINDS` list includes it. But Plan 12-06 wires only the 12 sibling kinds from D-01 (which do NOT include `equity_series_1y`). So the sibling table never has an `equity_series_1y` row — RPC returns `{equity_series_1y: null, log_returns_series: <…>}` for the equity panel, breaking Phase 14b panel 2 silently.

**Fix:** Plan 12-02 Task 2 — change RPC mapping for `'equity'` to `ARRAY['log_returns_series']` (or `ARRAY[]::TEXT[]` if log_returns also stays in metrics_json). Phase 14b will path-extract `equity_series_1y` from `metrics_json` directly, not via the lazy RPC. Plan 12-02 Task 4 — remove `'equity_series_1y'` from the `StrategyAnalyticsSeriesKind` union. Plan 12-09 Task 3 — remove `'equity_series_1y'` from `EXPECTED_SIBLING_KINDS`.

**Affected plans:** 12-02 (Tasks 2 & 4), 12-09 (Task 3).

---

### H-E — RESEARCH.md §6: SQL skeletons still say "Migration 084/085" — executor copy-paste risk

**Source:** Claude review (H-02).

**Issue:** Plan 12-02 Task 1 says "per RESEARCH.md §6a" and `<read_first>` points the executor at the §6a SQL skeleton. That skeleton still contains `RAISE EXCEPTION 'Migration 084: priority column missing'`, `RAISE NOTICE 'Migration 084: priority enum + partial index + claim RPC installed.'`. Plan 12-02's action block has the correct `'Migration 086'` strings, but a distracted executor reading §6a verbatim would get the wrong text in the self-verifying DO block. Verify grep would catch it (Plan 12-02 Task 1 acceptance has `grep -qE "RAISE EXCEPTION 'Migration 086"`), but unnecessary risk.

**Fix:** Update RESEARCH.md §6a and §6b — replace "Migration 084" → "Migration 086" and "Migration 085" → "Migration 087" everywhere in the skeleton. Add a note at the top of each skeleton: "⚠️ NUMBERING NOTE: Numbering reconciled to 086/087. Original draft used 084/085 (now taken by shipped Phase 11 work)."

**Affected files:** `12-RESEARCH.md` (§6a and §6b skeleton blocks). No plan frontmatter changes needed.

---

### H-F — Plan 12-05 + 12-02: METRICS-07 "Weighted R:R" missing from D-13 / TS contract / plan tasks

**Source:** Claude review (H-04).

**Issue:** REQUIREMENTS.md METRICS-07 explicitly lists "**Weighted R:R**" as one of 7 derived trade metrics. CONTEXT.md D-13 lists only 5 + Trade Mix (omits Weighted R:R). Plan 12-05 Task 1 doesn't compute it. Plan 12-02 Task 4's frozen TS contract doesn't include `weighted_risk_reward_ratio`. Plan 12-09 fixture doesn't expect it. If Phase 14b renders KPI-14 ("Risk/Reward row: R:R, Weighted R:R, Profit Factor"), the key will be missing.

**Fix (pick one, planner to confirm with explicit log entry):**
- (a) Add `weighted_risk_reward_ratio` to Plan 12-05 Task 1: compute as Σ(win_size × win_rate) / Σ(loss_size × loss_rate) or per the qstats reference formula. Add to Plan 12-02 Task 4 frozen TS contract: `weighted_risk_reward_ratio: number | null`. Add to Plan 12-09 fixture expected JSON.
- (b) Document in TODOS.md that Weighted R:R is intentionally trimmed from Phase 12 to v0.17.1 / Phase 14b amendment per D-16 frozen-contract-with-amendment-process. Update REQUIREMENTS.md METRICS-07 wording from "7 derived" to "6 derived (Weighted R:R deferred)".

Recommend (a) — REQUIREMENTS.md is the contract; trimming requires explicit user sign-off.

**Affected plans:** 12-05 (Task 1), 12-02 (Task 4), 12-09 (fixture). Possibly REQUIREMENTS.md / 12-CONTEXT.md update.

---

## MEDIUMs (fix before merge — user directive includes mediums)

### M-01 — `TRADE_MIX_HAS_MAKER_TAKER` env var not propagated to CI

**Source:** Claude review.

**Issue:** Plans 12-05/09/10 read this env var independently. No plan task sets it in CI. CI defaults to env-absent → all readers default to 2-bucket path regardless of audit outcome. Even if Plan 12-01's audit passes 99% threshold, the 4-bucket path is never tested in CI.

**Fix:** Plan 12-10 Task 1 (or new Task in Plan 12-01) — read `TRADE_MIX_HAS_MAKER_TAKER` decision from `TODOS.md`, write it to a CI-readable file. Two viable options:
- Add a step to `phase12_deploy.py` that exports the flag to a `.env.test` or GitHub Actions secret via `gh secret set` (requires GH CLI).
- Add a step to a CI workflow file (`.github/workflows/test.yml` if it exists) that reads `TODOS.md` and sets the env before running parity tests.

Document the canonical source-of-truth as TODOS.md and the propagation path in 12-CONTEXT.md (or in CLAUDE.md).

---

### M-02 — Plan 12-10: `phase12_backfill_enqueue.py` missing duplicate-job guard

**Source:** Claude review (M-02) + Grok review (Persona A LOW). Combined-severity MEDIUM.

**Issue:** The current plan acknowledges "verify before running" without actually guarding. `compute_jobs` (per migration 032) does NOT have a unique constraint on `(strategy_id, kind)` — re-running enqueue inserts duplicate `compute_analytics` jobs.

**Fix:** Plan 12-10 Task 1 — add pre-check in `phase12_backfill_enqueue.py`:
```python
existing = await db_execute(lambda: supabase.table("compute_jobs")
    .select("id", count="exact")
    .eq("kind", "compute_analytics")
    .eq("status", "pending")
    .execute()
)
if (existing.count or 0) > 0:
    print(f"[backfill] {existing.count} pending jobs found — skipping to avoid duplicates. Re-run after worker drains.")
    return 0
```

Add acceptance criterion: `grep -q "existing pending compute_analytics jobs found" analytics-service/scripts/phase12_backfill_enqueue.py`.

---

### M-03 — Plan 12-10: kill-switch uses Python JSON length, not `pg_column_size`

**Source:** BOTH reviewers (Claude M-03 + Grok Persona A LOW + Persona B implicit).

**Issue:** `phase12_kill_switch.py` measures `len(json.dumps(r["metrics_json"]).encode("utf-8"))`. `pg_column_size()` measures post-TOAST-compression on-disk size — can differ 30-50% from raw JSON bytes. The deploy script's `analyze_metrics_size.sql` (correctly) uses `pg_column_size`. If SQL probe shows p99.9=820kB but Python approx says 750kB, the kill-switch never fires despite threshold breach.

**Fix:** Plan 12-10 Task 1 — change `phase12_kill_switch.py` to either:
- Receive `p99.9` as a CLI argument from `phase12_deploy.py` (which already runs the SQL probe authoritatively), OR
- Re-run the SQL via `supabase.rpc()` or raw SQL execution — not approximate in Python.

Acceptance criterion: `! grep -q "len(json.dumps" analytics-service/scripts/phase12_kill_switch.py` (use only DB-side measurement).

---

### M-04 — Plan 12-07: false-positive grep on `"claim_compute_jobs"`

**Source:** Claude review.

**Issue:** Verify step `! grep -q '"claim_compute_jobs"' analytics-service/main_worker.py` will fail if any comment, docstring, or log message mentions the legacy RPC name. Too broad.

**Fix:** Plan 12-07 Task 1 — narrow the grep to actual call sites:
```bash
! grep -q 'supabase.rpc("claim_compute_jobs",' analytics-service/main_worker.py
```

Captures only the Python call expression, not bare strings in comments or log messages.

---

### M-Grok-1 — Plan 12-06: sibling-upsert loop missing transaction wrapper

**Source:** Grok review (Persona A MEDIUM).

**Issue:** Plan 12-06 Task 2 loops `INSERT … ON CONFLICT (strategy_id, kind) DO UPDATE` for each of the 12 sibling kinds per strategy. No surrounding transaction. If any single upsert fails (network, RLS, JSONB size), partial rows persist — the strategy is now in an inconsistent state (`metrics_json` updated successfully, but only some sibling kinds updated). Subsequent reads via `fetch_strategy_lazy_metrics` would return stale data for the un-updated kinds.

**Fix:** Plan 12-06 Task 2 — wrap the entire sibling-table write in a single transaction. Either:
- Use `supabase.postgrest`'s transaction support (Python `supabase-py` exposes `.execute()` per call but NOT a transaction wrapper natively — may need raw asyncpg).
- Or push the loop into a SECURITY DEFINER RPC `upsert_strategy_analytics_series_batch(strategy_id UUID, kinds JSONB)` that runs the multi-row upsert atomically inside the function (Postgres functions are implicitly transactional).

Recommend the RPC approach — atomicity at the DB level is cheaper than Python-side coordination. Add the RPC to migration 087 (Plan 12-02 Task 2) and call it from Plan 12-06 Task 2's orchestrator.

---

### M-Grok-2 — Plan 12-09: scalar parity assert no rel-eps fallback for tiny post-round diffs

**Source:** Grok review (Persona C MEDIUM).

**Issue:** D-11 says scalars are "byte-identical JSON after both sides round to 12 sig digits." `assertMetricParity()` does exact equality on rounded scalars. But quantstats round-trip through `_safe_float()` → JSON serialize → JSON deserialize can differ by 1 ULP at the 12th significant digit due to float-to-string-to-float conversion paths in different runtimes. Strict equality on a 12-digit string can fail-loud on legitimate floating-point rounding.

**Fix:** Plan 12-09 Task 2 — extend the scalar comparator to fall through to a 1e-12 relative epsilon if exact rounded-string equality fails:
```python
def _scalar_close(a, b):
    if a is None and b is None: return True
    if a is None or b is None: return False
    if math.isnan(a) and math.isnan(b): return True
    a_r, b_r = round(a, 12), round(b, 12)
    if a_r == b_r: return True
    # Fall through: compare with 1e-12 relative epsilon
    if a_r == 0 and b_r == 0: return True
    return abs(a_r - b_r) / max(abs(a_r), abs(b_r)) < 1e-12
```

Document the two-tier comparison (exact-after-round → epsilon-fallback) in the helper docstring.

---

## LOWs (informational only — not in user-directed fix scope)

### L-01 — Plan 12-08: Vitest mock path may not match actual `createClient` import
Plan acknowledges this in the action body ("Verify the mock path matches…"). Move to acceptance criterion as well: `vi.mock path matches actual createClient import in src/lib/queries.ts top-of-file`.

### L-02 — `_finalize_rolling` rounds to 4 decimals (vs D-11 12-sig-digit)
Internally consistent (both Python generation and Python test use the same rounding). Either accept and document, or change `_finalize_rolling` to 6+ decimals. Tracking only.

### L-03 — `avg_holding_period_hours` derivation source ambiguous
Plan 12-05 Task 2 reads `f.get("holding_period_hours")` from fills. The field doesn't exist on `raw_fills` (migration 039:44-48). All buckets will return 0.0. Either compute from entry/exit timestamps or use `reconstruct_positions`'s per-trade duration. Tracking only.

### L-04 (Grok) — Fixture fills simplistic (no positions → empty exposure/turnover)
Already absorbed into H-A1 (regen_golden.py position simulation). Tracking only.

---

## Plan-by-plan revision summary

| Plan | Revisions required |
|---|---|
| 12-01 | Add CI propagation step for TRADE_MIX flag (M-01 partial) |
| 12-02 | H-B (search_path on both RPCs); H-D (drop equity_series_1y from RPC + TS union); H-F (add weighted_risk_reward_ratio to TS contract); M-Grok-1 (add upsert_strategy_analytics_series_batch RPC to migration 087) |
| 12-03 | (depends on B-01 fix path; otherwise no changes) |
| 12-04 | B-02 (frontmatter `depends_on: [12-02, 12-03]`) |
| 12-05 | B-01 (data-flow refactor — choose path (b) recommended); H-F (add weighted_risk_reward_ratio computation) |
| 12-06 | H-A1 (must wire exposure/turnover series, not punt); M-Grok-1 (use upsert_strategy_analytics_series_batch RPC); B-01 wiring (call new derived-metrics function) |
| 12-07 | M-04 (narrow grep to `supabase.rpc("claim_compute_jobs",`) |
| 12-08 | (no changes — only LOW-01) |
| 12-09 | H-A1 (regen_golden.py simulates positions); H-C (signed-zero handling); H-D (drop equity_series_1y from EXPECTED_SIBLING_KINDS); H-F (add weighted_risk_reward_ratio to expected JSON); M-Grok-2 (epsilon-fallback for scalars); B-01 expected-JSON consistency |
| 12-10 | H-A1 wiring confirmation; M-01 (TRADE_MIX env propagation); M-02 (duplicate-job guard); M-03 (use SQL p99.9 not Python approx) |
| 12-RESEARCH.md | H-E (replace 084→086, 085→087 in §6a/§6b) |

## Source documents

- `12-REVIEW-CLAUDE.md` — fresh-context Claude review (verdict: BLOCK — PROCEED WITH FIXES)
- `12-REVIEW-GROK.md` — Grok 4-1 fast reasoning, 3 personas (verdict: PROCEED WITH FIXES)
- `12-CONTEXT.md` — locked decisions (D-01..D-16) — keep frozen
- `12-RESEARCH.md` — 70KB research; §6a/§6b need numbering fix
- `12-01-PLAN.md` through `12-10-PLAN.md` — the 10 plans being revised

---

## REVIEWS COMPLETE

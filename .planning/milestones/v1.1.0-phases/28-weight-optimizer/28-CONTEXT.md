# Phase 28: Weight Optimizer - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey areas resolved from the milestone research (locked in [[project_milestone_v1_1_0_scenario_analysis]]) + code-grounded scouting. No clients yet; decisions taken autonomously.

<domain>
## Phase Boundary

An allocator requests **suggested weights** for an objective on the own-book Scenario composer, computed by the **Python analytics-service** (the milestone's LONE new backend endpoint + Railway deploy). The optimizer is **long-only, sum-to-1, min-vol DEFAULT** (max-Sharpe gated + caveated as in-sample-optimistic), with **Ledoit-Wolf covariance shrinkage** to fight overfit. Suggested weights **write to the editable DRAFT only — never auto-commit**. The output discloses its **in-sample caveat + the overlap window** it was fit on, and **gates to an honest empty state** when overlapping observations are insufficient relative to strategy count. It is **deterministic** (identical input → identical weights; a 1-day data extension moves weights < a few %), and **TS↔Python convention parity** (252-annualization, n-gates, null semantics) is **pinned by a golden-fixture parity test**.

In scope: a pure Python optimizer (`services/optimizer.py`: hand-rolled analytical Ledoit-Wolf + scipy SLSQP) + a FastAPI route (`routers/optimizer.py`, X-Service-Key authed, under `/api/*`) wired into `main.py` + Python golden/determinism/degeneracy tests; a frontend client call (extend `src/lib/analytics-client.ts`) + a route (`/api/scenario/optimize`) + a composer UI control (request → preview → apply-to-draft) + a TS↔Python golden-fixture parity test; Railway deploy of the analytics-service.

Out of scope (deferred / forbidden): **cvxpy / PyPortfolioOpt / scikit-learn / arch** (NO new heavy dep — hand-roll Ledoit-Wolf in numpy; scipy+numpy+pandas already pinned); auto-commit of weights; multi-period / transaction-cost / Black-Litterman / risk-parity objectives; max-return or target-return frontiers; the example-universe Sandbox optimizer; any new migration (the optimizer is stateless — input series in, weights out).
</domain>

<decisions>
## Implementation Decisions

### Area 1 — The optimizer math (OPT-01)
- **Covariance: hand-rolled ANALYTICAL Ledoit-Wolf shrinkage** (Ledoit & Wolf 2004, the closed-form `shrinkage = clamp(π̂ / γ̂, 0, 1)` toward a scaled-identity or constant-correlation target). ~35 lines of numpy, deterministic, no sklearn. The shrinkage is the whole point: a raw sample covariance over an N-just-above-floor window is ill-conditioned and over-optimizes in-sample; shrinkage pulls it toward a structured target so min-vol is robust.
- **Solver: `scipy.optimize.minimize(method="SLSQP")`** with constraints `sum(w)=1`, bounds `w_i ∈ [0,1]` (long-only). **Deterministic:** fixed initial guess = equal weights `1/k`; NO random restart; tight tolerances. min-vol objective = `wᵀΣw`. max-Sharpe objective = maximize `(wᵀμ)/sqrt(wᵀΣw)` (minimize the negative) — GATED (more overfit-prone), caveated.
- **Annualization: 252** product-wide (matches `metrics.py` `np.sqrt(252)` + the frontend `computeScenario`). μ = daily mean × 252, Σ from daily-return cov × 252 (or annualize consistently). Be explicit + consistent.
- **min-vol is DEFAULT, max-Sharpe is gated + caveated** (the success-criterion default; max-Sharpe needs the explicit "in-sample optimistic" disclosure).

### Area 2 — Honesty: degeneracy gate + in-sample caveat (OPT-02)
- **n-vs-k degeneracy gate:** require overlapping observations `n` sufficient relative to strategy count `k` (covariance needs `n` comfortably > `k`; a singular/near-singular Σ → no honest optimum). Below the gate → **no weights** (honest empty state), NEVER a fabricated weight vector. Reuse the Phase-22 sample-floor SoT philosophy where applicable, plus an explicit `n > c·k` condition (c TBD by planner, e.g. n >= max(floor, 2k)).
- **In-sample caveat (mandatory, disclosed):** the output names that the weights are fit IN-SAMPLE on the overlap window (past performance / overfit warning), and the overlap N + window it used. Never present suggested weights as a forecast.
- **Determinism (load-bearing, test-pinned):** identical (series, objective) → identical weights (SLSQP deterministic from the fixed equal-weight start); a 1-trading-day data extension moves weights by < a few %. Pin both.
- **Null/degenerate semantics match the frontend:** non-finite / constant / below-gate → null result → honest empty state + em-dash, exactly as the engine + sample-floor do.

### Area 3 — Write-to-draft-only + UI (OPT-01)
- Suggested weights populate the composer's **draft `weightOverrides`** (the editable Phase-23 `setValue` seam) — the allocator REVIEWS then keeps/edits; **never auto-saved/committed**. An "Apply suggested weights" action writes to the draft state only; the existing Save/Update flow is the separate, explicit commit.
- **Own-book composer ONLY** (consistent with Stress/MC; Sandbox optimizer deferred). A control: pick objective (min-vol default / max-Sharpe gated), request → preview the suggested weights + the disclosure → apply-to-draft. Conform to DESIGN.md; reuse existing primitives (SegmentedControl for objective, the empty-state shell, methodology-line disclosure). Loading state while the service computes (mirror the MC "computing" affordance / Skeleton).

### Area 4 — Service boundary, parity, deploy
- **New `/api/*` route on analytics-service, X-Service-Key authed** (the standard service-to-service pattern via `main.verify_service_key`; mirror an existing router e.g. `portfolio.py`). Request = the draft-scoped strategies' daily-return series + objective; response = `{ weights: {id: w} | null, n, k, objective, in_sample: true, reason }`. Stateless (no DB, no migration). The FE calls it via `src/lib/analytics-client.ts` (ANALYTICS_SERVICE_URL + X-Service-Key, line ~90) behind a Next route `/api/scenario/optimize` (allocator-authed, passes only the allocator's own draft-scoped series).
- **TS↔Python convention parity (golden fixture):** a checked-in fixture (fixed input series → expected gate decision + expected weights to a tolerance) tested in BOTH suites — the Python optimizer produces the golden weights, and the TS side applies the SAME n-gate / 252 / null semantics so the UI and service agree on when weights exist and what window they cover. The optimization math lives ONLY in Python (no TS re-impl); parity is about the shared conventions, not a second solver.
- **Railway deploy gotchas (carry from memory):** (1) **Railway-skip-on-red** — a transient-red CI check makes Railway SKIP the analytics deploy with no auto-recover; verify the analytics deploy actually ran post-merge (check `/health` git_sha) + the analytics-deploy-verify workflow. (2) **mypy venv drift** — verify `mypy --strict` against a CI-pinned `uv venv --python 3.12` + requirements.txt, NOT the local shared `.venv` (which has a newer supabase). (3) analytics `/health` git_sha cosmetically lags if there's no analytics diff — but THIS phase has an analytics diff, so it should converge on deploy.

### Claude's Discretion
- The exact Ledoit-Wolf target (scaled identity vs constant-correlation) + the shrinkage clamp; the precise `n > c·k` gate constant; SLSQP tolerances; whether max-Sharpe ships in v1 or is deferred behind the gate; the exact request/response schema field names; the UI control layout within DESIGN.md; the parity-fixture tolerance. All deferred to the planner within the locked invariants.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **analytics-service:** FastAPI `main.py` (`verify_service_key` middleware on `/api/*`), `routers/*.py` (mirror `portfolio.py` for the route template), `services/metrics.py` (`np.sqrt(252)` annualization convention, NaN policy via `_safe_float`), `models/schemas.py` (pydantic request/response). Deps PINNED: numpy==2.2.4, scipy==1.18.0, pandas==2.2.3, fastapi==0.115.12, pydantic==2.11.3. NO sklearn.
- **Railway deploy:** `analytics-service/railway.toml`; `.github/workflows/analytics-deploy-verify.yml` gates/verifies the deploy.
- **Frontend → service:** `src/lib/analytics-client.ts` (`ANALYTICS_SERVICE_URL` ?? localhost:8002; `X-Service-Key` header line ~90; throws if URL unconfigured line ~344). The optimizer FE route mirrors an existing analytics-calling route (e.g. `src/app/api/.../route.ts` using the client).
- **Draft write seam (Phase 23):** the composer's `weightOverrides` + the `hydrateFromSaved`/`setValue` seam (routes through setValue so the fingerprint-mismatch banner derives automatically; never a silent bypass). "Apply suggested weights" writes here.
- **Honesty primitives:** `src/lib/sample-floor.ts` (gate philosophy), `SampleFloorEmptyState`, `EmptyStateCard`, `methodologyLine`, `formatPercent`/`formatNumber` (em-dash on null), `SegmentedControl` (objective picker), `Skeleton` (computing state).
- **Engine:** `computeScenario` (the suggested weights flow back through it for the preview metrics — same 252 convention, so parity holds).

### Established Patterns
- Pure compute extracted from the route (Python: `services/optimizer.py` pure, `routers/optimizer.py` thin) — mirrors the frontend's pure-lib + thin-section split.
- Determinism + golden fixtures for any math (mirror `scenario-montecarlo.test.ts` / the metrics golden tests); seedable/deterministic, never `random` without a seed.
- Null-on-degenerate envelope, never a fabricated number; honest empty state below the gate.
- Service-to-service via X-Service-Key; the allocator-facing Next route enforces allocator auth + passes only the caller's own draft-scoped series (no cross-tenant).

### Integration Points
- NEW `analytics-service/services/optimizer.py` (Ledoit-Wolf + SLSQP, pure) + `analytics-service/routers/optimizer.py` (route) + wire into `main.py` + `analytics-service/tests/test_optimizer.py`.
- NEW `src/app/api/scenario/optimize/route.ts` (allocator-authed → analytics-client → service) + extend `src/lib/analytics-client.ts`.
- NEW composer UI control + apply-to-draft via the Phase-23 setValue seam.
- NEW TS↔Python golden-fixture parity test (shared fixture in both suites).
</code_context>

<specifics>
## Specific Ideas
- min-vol default = minimize wᵀΣw, Σ = Ledoit-Wolf-shrunk annualized cov; SLSQP, w≥0, Σw=1, equal-weight start, deterministic.
- max-Sharpe gated = minimize −(wᵀμ)/√(wᵀΣw); caveat "in-sample optimistic".
- Gate: n > c·k (singular cov) → null weights → honest empty state; reuse floor philosophy.
- Write-to-draft-only via the Phase-23 setValue seam; never auto-commit.
- Parity golden fixture in BOTH suites (252 + n-gate + null); Python owns the solver.
- Railway: verify analytics deploy actually ran post-merge (git_sha /health); mypy vs CI-pinned venv.
</specifics>

<deferred>
## Deferred Ideas
- cvxpy / PyPortfolioOpt / sklearn / arch; auto-commit; multi-objective / transaction costs / Black-Litterman / risk-parity / efficient-frontier UI; Sandbox optimizer; max-Sharpe if the planner gates it out of v1.
</deferred>

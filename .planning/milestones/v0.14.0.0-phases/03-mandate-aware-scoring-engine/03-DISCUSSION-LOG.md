# Phase 3: Mandate-Aware Scoring Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 03-mandate-aware-scoring-engine
**Areas discussed:** Constraint enforcement per dimension, Cache invalidation mechanism, scoring_weight_overrides column bootstrap, Test strategy + fixtures

---

## Constraint Enforcement Per Dimension

### Q1: How should `max_weight` violations map to `mandate_fit_score`?

| Option | Description | Selected |
|--------|-------------|----------|
| Linear taper above ceiling | If add_weight ≤ max_weight: contribution = 1.0. Else: max(0, 1 - (add_weight - max_weight) / max_weight). 2× ceiling → 0. Simplest to explain; matches roadmap 'penalty' framing. | ✓ |
| Quadratic taper above ceiling | Gentler near ceiling, sharper far past. Rewards 'just a little over'. | |
| Step penalty at ceiling | Binary-ish; aligns with 'mandate violated' framing but discards severity info. | |
| Hard exclude above ceiling | Off-spec vs roadmap 'penalty'; listed for completeness. | |

**User's choice:** Linear taper above ceiling
**Notes:** Simplest, matches roadmap's penalty framing. `add_weight` already computed from ticket / portfolio_aum.

### Q2: Which correlation do we compare to `correlation_ceiling`?

| Option | Description | Selected |
|--------|-------------|----------|
| Candidate-vs-weighted-portfolio scalar | Reuse existing `corr_with_portfolio`. Free (already computed). | ✓ |
| Max pairwise to individual holdings | Catches 'overlaps heavily with one holding'. New code path. | |
| Mean pairwise to individual holdings | Softer; less sensitive to single overlaps. | |

**User's choice:** Candidate-vs-weighted-portfolio scalar
**Notes:** Reuses what the engine already computes. Zero new correlation code.

### Q3: How strict is `liquidity_preference`?

| Option | Description | Selected |
|--------|-------------|----------|
| Soft penalty (tier-gap scaled) | Same tier → 1.0; one-off → 0.5; two-off → 0.0. Graceful. | ✓ |
| Hard penalty (below threshold = 0) | Below = 0.0, above/equal = 1.0. Cleaner but zero-signal when fails. | |
| Hard exclude below threshold | Off-spec vs roadmap; listed for completeness. | |

**User's choice:** Soft penalty (tier-gap scaled)
**Notes:** Graceful degradation; sparse universes still surface candidates.

### Q4: `style_exclusions` relaxation behavior (HARD vs SOFT exclusion)?

| Option | Description | Selected |
|--------|-------------|----------|
| SOFT exclusion reason (relaxes on sparse) | Add `style_excluded` to SOFT_EXCLUSION_REASONS. Relaxes when <5. Matches `off_mandate_type`. | ✓ |
| HARD exclusion reason (never relaxed) | Add to HARD_EXCLUSION_REASONS. Stricter. Empty result if universe is all excluded. | |

**User's choice:** SOFT exclusion reason (relaxes on sparse)
**Notes:** Preserves engine's "show SOMETHING rather than empty" invariant.

---

## Cache Invalidation Mechanism

### Q1: What mechanism invalidates a stale cached batch after mandate edit?

| Option | Description | Selected |
|--------|-------------|----------|
| Timestamp comparison in skip logic | Extend `_should_skip_allocator` to also fetch `mandate_edited_at`. No schema change. | |
| needs_recompute flag on allocator_preferences | Nullable BOOLEAN via migration. RPC flips TRUE on write. Phase 1 pattern. Schema churn. | |
| Both — timestamp primary + flag as escape hatch | Timestamp is normal path; `force_recompute` flag for ops override. | ✓ |

**User's choice:** Both — timestamp primary + flag as escape hatch
**Notes:** Planner interprets "flag" as the existing request-level `force: bool` (not a new persistent column). Keeps D-11 minimal.

### Q2: Inline (lazy) vs proactive (enqueue on write)?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline on next request (lazy) | Next cron tick finds mandate_edited_at > computed_at, recomputes. No new trigger. | |
| Proactive (trigger enqueues) | Phase 2 RPC enqueues a compute_job. Lower latency; more moving parts. | ✓ |

**User's choice:** Proactive (trigger enqueues)
**Notes:** Wires through existing `enqueue_compute_job` pattern with new `kind='rescore_allocator'`. RPC-body PERFORM vs Postgres trigger is planner's call in 03-02.

### Q3: How to ensure v1→v2 cutover invalidates cleanly?

| Option | Description | Selected |
|--------|-------------|----------|
| Engine-version check in skip logic | `_should_skip_allocator` also reads `last_batch.engine_version`; returns False on mismatch. | ✓ |
| Data migration to delete v1 batches | Migration 062 DELETEs v1 rows. Loses audit of pre-v2 state. | |
| Retain v1 rows, let 7-row retention sweep age them out | Natural aging via existing `_retention_sweep`. No migration. Mixed versions briefly. | |

**User's choice:** Engine-version check in skip logic
**Notes:** Cleanest; zero data migration. Existing retention sweep handles cleanup naturally (captured as D-13).

### Q4: `effective_preferences` JSONB shape?

| Option | Description | Selected |
|--------|-------------|----------|
| Flat — merge mandate fields into effective_preferences dict | Consistent with v1 shape. Easiest to query. | ✓ |
| Nested — effective_preferences.mandate sub-object | Cleaner grouping. Breaks flat-dict consumers. | |

**User's choice:** Flat — merge mandate fields into effective_preferences dict
**Notes:** v1 shape preserved; downstream admin UI + audit queries unchanged.

---

## scoring_weight_overrides Column Bootstrap

### Q1: Who adds the `scoring_weight_overrides` column?

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 3 adds migration 062 | Phase 3 owns column; Phase 4 populates. SCORING-06 contract whole at Phase 3 merge. | ✓ (Claude's pick on delegation) |
| Phase 4 adds the migration; Phase 3 snapshots defensively | Column-ownership matches populator. Snapshot is `null` until Phase 4. | |
| Phase 3 ships migration 062 + placeholder read stub only | Column + stub that always reads NULL. Zero Phase 3 behavior. Dead code until Phase 4. | |

**User's choice:** "choose the best option for me" (delegated)
**Notes:** User delegated with context "Phase 4 will be shipped today". Claude picked Phase 3 owns migration 062 — Phase 3 must land first due to Phase 4's dependency; SCORING-06 is literally true at Phase 3 merge with this choice.

### Q2: How does the engine READ `scoring_weight_overrides`?

| Option | Description | Selected |
|--------|-------------|----------|
| Multiplicative — per-dimension scale | `{W_PORTFOLIO_FIT: 1.2, ...}`. Engine does default × scale, renormalize to 1.0. Matches Phase 4 floor/ceiling language. | ✓ (Claude's pick on delegation) |
| Absolute — stored values replace defaults | `{W_PORTFOLIO_FIT: 0.48, ...}`. Engine uses exact values. Pushes sum=1.0 math upstream to Phase 4. | |
| Phase 3 reads stub only (ignore shape) | Phase 3 snapshots; Phase 4 defines shape. Defers one phase. | |

**User's choice:** "decide on the best option. Phase 4 will be shipped today" (delegated)
**Notes:** Claude picked multiplicative — matches Phase 4 "push toward 1.5× ceiling / 0.5× floor" framing directly; Phase 4 writes simple scalars, engine enforces sum=1.0 via renormalize.

### Q3: What dimensions does Phase 3 support in `scoring_weight_overrides`?

| Option | Description | Selected |
|--------|-------------|----------|
| Four top-level weights only | W_PORTFOLIO_FIT, W_PREFERENCE_FIT, W_TRACK_RECORD, W_CAPACITY_FIT. Matches Phase 4 roadmap. | ✓ |
| Top-level + sub-weights | Wider surface. Overkill for Phase 4 rule-based v1. | |
| Unknown keys passed through transparently | Engine filters known keys. Forward-compatible. | |

**User's choice:** Four top-level weights only
**Notes:** Narrow hook; matches ROADMAP Phase 4 description.

### Q4: Migration 062 scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Single migration 062 — all Phase 3 DB changes | scoring_weight_overrides column + any trigger + RPC amendment in one atomic migration. | ✓ |
| Column-only migration 062 + separate trigger migration | 062 = just column. 063 = trigger if needed. More churn. | |
| No schema change this phase — RPC-body PERFORM + Phase 4 owns the column | Rejects column ownership. Zero Phase 3 schema touches. | |

**User's choice:** Single migration 062 — all Phase 3 DB changes
**Notes:** Atomic. Matches Phase 2 migration 061 precedent (everything in one migration with self-verifying DO block).

---

## Test Strategy + Fixtures

### Q1: Test scope beyond ROADMAP's 9 unit tests?

| Option | Description | Selected |
|--------|-------------|----------|
| 9 required unit tests (baseline) | ROADMAP minimum. | ✓ |
| Determinism regression | Same inputs → byte-identical `to_canonical_json`. | ✓ |
| v1→v2 golden snapshot diff | Pin fixture; assert v1 output vs v2 output differs only in documented ways. | ✓ |
| Live-DB integration tests (HAS_LIVE_DB gate) | Integration tests against real DB. | |

**User's choice:** 9 required unit tests, v1→v2 golden snapshot diff, Determinism regression
**Notes:** Skips live-DB (not needed for pure scoring-math changes). Plus golden snapshot catches accidental top-level weight changes in future.

### Q2: Plan split?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep as single plan 03-01 (roadmap-aligned) | One atomic plan: migration + engine + caller + tests. Bigger PR. Matches ROADMAP as-written. | |
| Split into 03-01 (migration + engine) and 03-02 (caller + invalidation + tests) | Two plans. Dependency 03-02 → 03-01. Better review granularity. ROADMAP.md edit required. | ✓ |

**User's choice:** Split into 03-01 and 03-02
**Notes:** ROADMAP.md must be edited to reflect 2-plan structure.

### Q3: Target test count for plan 03-01's unit suite?

| Option | Description | Selected |
|--------|-------------|----------|
| 9 tests (roadmap minimum) | Minimal acceptable. Risk: misses edge cases. | |
| ~15–20 tests | 9 + determinism + golden + renormalization + backward-compat + boundaries. Right-sized. | ✓ |
| 25+ tests (comprehensive) | Property-based + mutation testing. Overkill for Phase 3. | |

**User's choice:** ~15–20 tests
**Notes:** Sized for a backend scoring change; captured in D-15 with 20 concrete test descriptions.

### Q4: Include Playwright or API E2E?

| Option | Description | Selected |
|--------|-------------|----------|
| No E2E — unit + (optional) live-DB only | Phase 3 is backend-only. No UI surface. Cleanest. | ✓ |
| Add API-level E2E against running analytics-service | FastAPI test client + seeded allocator. Overlap with live-DB. | |

**User's choice:** No E2E — unit + (optional) live-DB only
**Notes:** Roadmap says "UI hint: no" — no user-facing surface for Phase 3.

---

## Claude's Discretion

Captured inline per decision in CONTEXT.md "Claude's Discretion" subsection. Key items:
- `_compute_mandate_fit_score()` placement — co-located in `match_engine.py` (planner may split to `services/mandate_fit.py` if size warrants)
- RPC-body PERFORM vs Postgres trigger for D-12 proactive enqueue — planner picks during 03-02
- `force_recompute` persistent flag vs request-level `force: bool` — D-11 picked request-level; planner may revisit if ops UX demands
- Reason copy for `style_excluded` exclusion
- `score_breakdown` JSONB key ordering (insertion order in Python preserves natural reading order)
- Whether to include `"mandate_fit_raw"` debugging dict inside `score_breakdown.raw`
- `DEFAULT_PREFERENCES` extension shape (5 new keys with `None`/`[]` defaults)

## Deferred Ideas

Captured in CONTEXT.md "Deferred Ideas" section. Most notable:
- `force_recompute` persistent flag — revisit if ops needs a UI toggle
- Sub-weight overrides in `scoring_weight_overrides` — Phase 6+
- `max_weight` hard exclude above 2× ceiling — future sprint if allocators need it
- Pairwise correlation max vs. scalar — if "high overlap with one holding" surfaces as a real complaint
- Symmetric liquidity penalty (both directions) — follow-up
- Property-based + mutation testing — Phase 6 hardening
- `effective_preferences` nested shape — breaking-change candidate for Phase 6+

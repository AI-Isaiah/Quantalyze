# Outside Voices — Phase 09

**Voice A (Claude subagent, fresh context, opus):** verdict=revise — "Plan 09 has three correctness blockers (async signature mismatch in 09-02 tests, missing match_decisions.original_holding_ref writer in 09-03, regressing strategy-branch cron join in 09-01/073) plus two undefined semantics (top-candidate-per-holding in 09-03 and per-allocator-per-candidate unique-index collision)."

**Voice B (Grok grok-4-1-fast-reasoning):** verdict=revise — "Plans assume unstated engine score scale resolution and ignore parallel-wave dependency risks between 09-02/09-03. Verification relies on file greps instead of runtime proofs for migrations and assumes downstream components handle discriminated unions without breakage."

## Consensus findings (auto-fold into replan)

None — the voices reviewed the same bundle but surfaced different issues. All findings below are DIVERGENT.

## Divergent findings — auto-folded (mechanical / low-controversy)

The orchestrator auto-accepted these because they are file-and-line-pinned with HIGH confidence, mechanically applicable, and do not materially change phase scope.

| # | Source | Priority | Area | Title | Why auto-folded |
|---|--------|----------|------|-------|-----------------|
| A-f1 | A only | P1 (BLOCKER, HIGH) | architecture | 09-02 Task 2 pytest uses `await _load_allocator_context(...)` but the function is synchronous | Pytest suite will fail on first run — fix is to drop `@pytest.mark.asyncio async def` and `await` from the new test cases. No scope change. |
| A-f3 | A only | P1 (BLOCKER, HIGH) | risk | Migration 073's strategy branch silently regresses pre-Phase-09 bridge_outcomes rows with match_decision_id IS NULL | LEFT JOIN + OR filter fix preserves migration 060 behavior for legacy rows. Without it, already-populated deltas stop recomputing on affected rows. |
| A-f6 | A only | P2 (WARNING, MED) | risk | 09-04 parseHoldingCompareId accepts chars the Phase 08 scope_ref contract forbids | Adding `/^[A-Za-z0-9_-]+$/` validation matches Phase 08 D-08 invariants. Pure hardening — no behavior change for legitimate inputs. |
| B-g2 | B only | P2 (WARNING, HIGH) | sequencing | 09-03 depends_on missing 09-02 | 09-03's flaggedHoldings derivation reads from `match_candidates` which 09-02 produces. Promotes wave 2 ordering correctness. |
| B-g3 | B only | P2 (WARNING, HIGH) | verification | 09-01 verifications grep files but skip runtime migration/DO-block proofs | Strengthen Task 1/2 acceptance to assert `supabase db push` exits 0 AND emits NOTICE with the expected assertion text from the DO block. |

## Divergent findings — auto-ignored (false positive)

| # | Source | Priority | Title | Reason |
|---|--------|----------|-------|--------|
| B-g1 | B only | WARNING | Unstated assumption on match_candidates.score scale in 09-03 flaggedHoldings derivation | Score scale was explicitly resolved in the planner's `planning_overrides` as 0-100 per `match_engine.py:787` (`final_score = 100 * (...)`). The planner's `FLAG_COMPOSITE_THRESHOLD = 50` and `.gte("score", 50)` are correct. Voice B misread RESEARCH Open Question 1 as unresolved. |

## Divergent findings — require user decision

| # | Source | Priority | Area | Title |
|---|--------|----------|------|-------|
| A-f2 | A only | P1 (BLOCKER, HIGH) | scope | Phase 09 ships no path to write `match_decisions.original_holding_ref`, so LIVE-04's inline forms never fire in production |
| A-f5 | A only | P2 (WARNING, HIGH) | verification | "Top candidate per holding" and "correlation_ceiling breach derivation" in 09-03 Task 2 are not grounded in real match_candidates semantics |
| A-f4 | A only | P2 (WARNING, HIGH) | architecture | bridge_outcomes UNIQUE (allocator_id, strategy_id) collides when multiple flagged holdings resolve to the same top candidate |
| B-g4 | B only | P3 (INFO, MED) | clarity | 09-04 assumes CompareTable/Overlays handle {kind:'holding'} without stated adapter |

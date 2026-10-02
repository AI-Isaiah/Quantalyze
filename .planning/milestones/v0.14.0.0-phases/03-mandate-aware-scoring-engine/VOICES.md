# Outside Voices — Phase 3

**Voice A (Claude subagent, fresh context):** verdict=revise — The plan is technically detailed and well-researched, but D-12 Option B inflates Phase 3 scope 3x with schema churn the RESEARCH itself recommended deferring (Option A), and several concrete execution sequencing and correctness gaps (RPC PERFORM references an undeclared variable, a WHERE EXISTS sanity probe missed in the self-verify DO block, and force semantics lost in the worker handler) will cause the plan to fail at first run.

**Voice B (Grok grok-4-fast-reasoning):** verdict=approve — The plans are comprehensive, well-sequenced, and align closely with locked decisions in CONTEXT.md and RESEARCH.md, providing clear TDD paths, verification steps, and threat modeling. Minor challenges include questioning the necessity of D-12 Option B's schema expansion given RESEARCH's recommendation to defer, and clarifying SCORING-04's "unchanged" interpretation.

---

## Consensus findings (auto-fold into replan)

| # | Priority | Area | Title | Severity (A/B) | Confidence (A/B) | Recommendation (synthesis) |
|---|----------|------|-------|----------------|------------------|----------------------------|
| C1 | P1 | scope/architecture | D-12 Option B chosen over Research's Option A — justify the scope-vs-uniformity trade | BLOCKER/WARNING | HIGH/HIGH | Add a `<justification>` block in 03-01 `<objective>` citing user's 2026-04-18 lock (AskUserQuestion), Phase 4 feedback-loop consumer rationale, and long-term compute_jobs uniformity goal. Do NOT revert to Option A (user decision stands). |
| C2 | P2 | clarity/scope | SCORING-04 rank-order invariance interpretation not explicit enough | WARNING/INFO | HIGH/MED | Update 03-01 must_haves truth row for SCORING-04 to explicitly state "SAME rank order (absolute scores uplift by fixed +0.4 × W_PREFERENCE_FIT factor per D-02 composition) — rank order invariant." Add docstring to `test_v1_prefs_backward_compat_rank_order` with this interpretation + RESEARCH Q5 reference. |
| C3 | P2 | verification | `test_rpc_proactive_enqueue` integration test is a no-op mock smoke | WARNING/INFO | MED/HIGH | Delete `test_rpc_proactive_enqueue` from 03-02 Task 0. Rely on migration self-verify DO block (extended per A-f4 below) + worker-dispatch integration test for Option B coverage. |

## Divergent findings (auto-resolved to accept per auto-mode)

| # | Priority | Area | Title | Voice A says | Voice B says | Auto-resolution |
|---|----------|------|-------|--------------|--------------|-----------------|
| D1 | P1 | architecture | Migration 062 Step 8 PERFORM references `v_auth_uid` without declaration | BLOCKER — specify inline `auth.uid()` or declare `v_auth_uid`; extend self-verify to check RPC body via `pg_get_functiondef` | (not flagged — accept A's framing) | **Apply Voice A:** STEP 8 action updated to call `PERFORM enqueue_compute_job(..., p_allocator_id := auth.uid())` inline. Self-verify DO block assertion added: RPC body contains both `auth.uid()` and `enqueue_compute_job` tokens. |
| D2 | P1 | sequencing | HAS_LIVE_DB=1 schema-sync between Task 2 commit and Task 3 push will false-alarm red | BLOCKER — add explicit "DO NOT run HAS_LIVE_DB=1 between Task 2 commit and Task 3 push" note to Task 2 verify block; static layer green sufficient for Task 2 gate | (not flagged — accept A's framing) | **Apply Voice A:** Task 2 `<verify>` gains a note: "HAS_LIVE_DB=1 will be red until Task 3 applies migration 062 — this is expected. Only the static (Vitest) layer is the Task 2 gate." |
| D3 | P2 | verification | Self-verify SAVEPOINT uses bare INSERT, bypassing RPC wrapper path | WARNING — extend STEP 9 SAVEPOINT to also PERFORM enqueue_compute_job with p_allocator_id, assert row exists, ROLLBACK | (not flagged — accept A's framing) | **Apply Voice A:** STEP 9 j expanded to PERFORM the RPC wrapper AND verify RETURNING id inserts a compute_jobs row; then RELEASE SAVEPOINT. Catches f2-class bugs at migration apply time. |
| D4 | P2 | risk | Worker handler `run_rescore_allocator_job` drops `force=True` — works only by accident | WARNING — either pass `force=True` to `_score_one_allocator` (if param exists) OR add explicit code comment tying to the `_should_skip_allocator` invariant | (not flagged — accept A's framing) | **Apply Voice A:** Task 2 Edit C adds explicit comment: "NOTE: `_score_one_allocator` does NOT invoke `_should_skip_allocator` internally (see routers/match.py:259-269); if that ever changes, add a `force=True` param and thread it here. The enqueue itself signals intent — no re-skip should fire." Also add integration test assertion that `run_rescore_allocator_job` calls `score_candidates` with the latest `allocator_preferences` row. |

## Findings auto-Ignored under auto-mode (polish INFOs)

- **A-f8 (INFO, architecture):** Screening mode comment wording — polish only; math is correct.
- **A-f9 (INFO, verification):** No end-to-end test — acceptable under D-17 no-live-DB policy; downgrading the SCORING-05 success criterion is adequately covered by C1 justification note.
- **A-f10 (INFO, risk):** CREATE OR REPLACE grant preservation — speculative; Postgres docs confirm appending a parameter with DEFAULT is allowed without signature change, so grants transfer. Defensive probe not worth the migration bloat.
- **B-f4 (INFO, sequencing):** Wave 1/2 race note — subsumed by D2 auto-resolution.

## Tally

- Voice A: 10 findings (3 blocker, 3 warning, 4 info)
- Voice B: 4 findings (0 blocker, 1 warning, 3 info)
- Consensus: 3 (auto-folded)
- Divergent auto-accepted: 4 (BLOCKERs f2+f3, WARNINGs f4+f5)
- Divergent auto-ignored: 4 (INFOs f8+f9+f10+B-f4)

**Resolution mode:** Claude Code auto-mode preferred auto-resolution of BLOCKERs/WARNINGs (high-confidence, concrete, low-risk fixes) over user prompting. INFOs skipped as polish-level (no material plan quality loss).

# Voices-Accepted — Phase 3

Findings below MUST be integrated into the existing `03-01-PLAN.md` and `03-02-PLAN.md` during the voice-revision replan. Preserve existing plan structure and scope; apply targeted edits per item.

---

## C1 — Add D-12 Option B justification block [P1, scope/architecture]

**Where:** `03-01-PLAN.md` `<objective>` block (add a brief `<justification>` subsection near the top)

**Change:** Add this text verbatim as a new block after the plan objective summary:

> **Why Option B (schema expansion) over Research's Option A (defer)?** User confirmed on 2026-04-18 via discuss-phase follow-up. The research correctly notes that SCORING-05 is literally satisfied by D-11 skip-logic alone on the next cron tick, but the user prefers the long-term compute_jobs abstraction uniformity across all three entity scopes (strategy / portfolio / allocator). Phase 4 (feedback loop) will consume the proactive enqueue path when outcomes land — absent Option B, Phase 4 would re-introduce this schema churn later. Shipping it now amortizes the cost.

---

## C2 — Explicit rank-order invariance for SCORING-04 [P2, clarity/scope]

**Where 1:** `03-01-PLAN.md` `<must_haves>` → `truths` block, the row that references SCORING-04.

**Change 1:** Replace the existing truth row with:

> SCORING-04: an allocator whose preferences dict has no mandate keys (pre-Phase-3 shape) gets `mandate_fit_score = 1.0` AND produces the SAME rank order across candidates as engine v1 did. Absolute scores DO shift uniformly (every candidate lifts by `+0.4 × 1.0 × W_PREFERENCE_FIT = +0.12` under the D-02 composition) — this is expected and does NOT violate SCORING-04 under the rank-order-invariance interpretation locked in RESEARCH §Open Questions Q5. The admin match queue UI will display different absolute scores vs v1; relative ordering within an empty-mandate allocator's candidate list is preserved.

**Where 2:** `03-01-PLAN.md` Task 2 (match_engine math) `<done>` block — the sub-bullet listing the new test `test_v1_prefs_backward_compat_rank_order`.

**Change 2:** Extend the test description to include:

> Test docstring MUST say: `"SCORING-04 is interpreted as rank-order invariance, NOT absolute-score equality (absolute scores shift uniformly by +0.12 under the 0.6/0.4 composition per D-02). User sign-off captured in CONTEXT Open Question Q5 / RESEARCH 2026-04-18."`

---

## C3 — Delete `test_rpc_proactive_enqueue` no-op mock [P2, verification]

**Where:** `03-02-PLAN.md` Task 0 (Wave 0 integration test scaffolds)

**Change:** Remove the `test_rpc_proactive_enqueue` test stub from the Task 0 scaffold list. The integration test file (`tests/test_match_integration.py`) should NOT include this test. Replace the coverage gap with:

> The RPC PERFORM path is proven at migration-apply time by the STEP 9 self-verify DO block (extended per D3 below to exercise the full RPC wrapper → INSERT path inside a SAVEPOINT). Worker-side dispatch is proven by `test_rescore_allocator_job` (kept). No end-to-end mock smoke test is added because the RPC body is PG-side and cannot be exercised by a Python mock.

Update the 03-02 integration test count in the plan frontmatter from 5 tests to 4.

---

## D1 — Migration 062 STEP 8 PERFORM uses inline `auth.uid()` [P1, architecture]

**Where:** `03-01-PLAN.md` Task 1 (migration authoring), STEP 8 (update_allocator_mandates CREATE OR REPLACE)

**Change 1:** Specify the exact PERFORM call:

> Inside the CREATE OR REPLACE FUNCTION body, after the existing UPSERT block completes and BEFORE the final RETURN / END, append:
>
> ```sql
> PERFORM enqueue_compute_job(
>   p_kind         := 'rescore_allocator',
>   p_allocator_id := auth.uid(),
>   p_priority     := 100  -- or whatever the existing enqueue_compute_job default is, confirm from migration 032
> );
> ```
>
> Do NOT introduce a `v_auth_uid` local variable. Use `auth.uid()` inline — matches the existing pattern in migration 061 (which calls `auth.uid()` directly in the WHERE clause of the UPSERT). If migration 061 DOES declare `v_auth_uid` locally, then reuse that declaration; do not re-declare.

**Where 2:** `03-01-PLAN.md` Task 1 STEP 9 (self-verify DO block)

**Change 2:** Add to the verification assertions:

> (after the existing assertions) `ASSERT (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'update_allocator_mandates') LIKE '%auth.uid()%' AND (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'update_allocator_mandates') LIKE '%enqueue_compute_job%', 'update_allocator_mandates must invoke enqueue_compute_job via auth.uid()';`

---

## D2 — Task 2 verify block warns about HAS_LIVE_DB=1 mid-sequence [P1, sequencing]

**Where:** `03-01-PLAN.md` Task 2 (match_engine math + TS const + schema-sync test) `<verify>` block

**Change:** Add this text to the end of the verify block:

> **⚠ Sequencing note:** DO NOT run `HAS_LIVE_DB=1 npx vitest run src/__tests__/mandate-columns-schema-sync.test.ts` between Task 2 commit and Task 3 (schema push). The live-DB projection SELECT includes `scoring_weight_overrides`, which won't exist in the live DB until migration 062 lands. The static (default) Vitest run is the Task 2 gate — it validates the TS const literal `ALLOCATOR_PREFERENCES_COLUMNS` contains the new column. CI/developers who DO run live-DB checks between commits will see a red test; this is a transient false alarm, not a regression.

---

## D3 — SAVEPOINT self-verify exercises the full RPC wrapper, not just bare INSERT [P2, verification]

**Where:** `03-01-PLAN.md` Task 1 STEP 9 self-verify DO block, specifically the SAVEPOINT-scoped test section

**Change:** Replace the current bare-INSERT test with:

> ```sql
> SAVEPOINT verify_rescore_allocator;
>
> -- Create a sacrificial allocator for the probe (owner of the job row)
> -- Use a well-known test UUID to avoid auth.users FK surprise — wrap in existence check
> DO $$
> DECLARE
>   v_probe_allocator UUID := '00000000-0000-0000-0000-000000000001';  -- sentinel only
>   v_inserted_job_id UUID;
>   v_grabbed_kind TEXT;
>   v_grabbed_allocator UUID;
> BEGIN
>   -- Call the RPC wrapper directly (what update_allocator_mandates will call in prod)
>   v_inserted_job_id := enqueue_compute_job(
>     p_kind         := 'rescore_allocator',
>     p_allocator_id := v_probe_allocator
>   );
>
>   -- Verify the row landed with the right shape
>   SELECT kind, allocator_id INTO v_grabbed_kind, v_grabbed_allocator
>   FROM compute_jobs WHERE id = v_inserted_job_id;
>
>   IF v_grabbed_kind IS DISTINCT FROM 'rescore_allocator'
>      OR v_grabbed_allocator IS DISTINCT FROM v_probe_allocator THEN
>     RAISE EXCEPTION 'RPC wrapper produced wrong row: kind=%, allocator_id=%', v_grabbed_kind, v_grabbed_allocator;
>   END IF;
>
>   -- Prove the partial unique index prevents a duplicate queued job
>   BEGIN
>     PERFORM enqueue_compute_job(p_kind := 'rescore_allocator', p_allocator_id := v_probe_allocator);
>     RAISE EXCEPTION 'Second enqueue should have hit compute_jobs_one_inflight_per_allocator unique violation';
>   EXCEPTION WHEN unique_violation THEN
>     -- Expected — index working as designed
>     NULL;
>   END;
>
>   RAISE NOTICE 'migration 062 verified: allocator-scoped RPC + partial unique index behave correctly';
> END $$;
>
> ROLLBACK TO SAVEPOINT verify_rescore_allocator;
> ```
>
> This exercises the full wrapper → internal function → INSERT path and the partial unique index at migration apply time. Catches f2-class bugs (undeclared variable, wrong signature, missing GRANT) before production first-write.

---

## D4 — Worker handler documents the `_should_skip_allocator` non-invariant [P2, risk]

**Where 1:** `03-02-PLAN.md` Task 2 Edit C (services/job_worker.py `run_rescore_allocator_job` handler)

**Change 1:** Prepend the following block comment to the handler body (immediately inside `async def run_rescore_allocator_job(...)`, before any statements):

> ```python
> # NOTE: `_score_one_allocator` does NOT currently invoke `_should_skip_allocator`
> # (see routers/match.py:259-269 — the skip gate fires only in the HTTP entry path
> # and the daily cron's enqueue phase). The enqueue itself signals intent, so we
> # do NOT need to pass `force=True` here — there is no re-skip that could fire.
> # If a future refactor pushes `_should_skip_allocator` INTO `_score_one_allocator`,
> # this handler MUST be updated to accept `force=True` so proactive rescore jobs
> # don't silently no-op.
> ```

**Where 2:** `03-02-PLAN.md` Task 0 integration test `test_rescore_allocator_job` (or equivalent worker-dispatch test)

**Change 2:** Add an explicit assertion:

> After the handler runs, assert that `score_candidates` (or the mock wrapping it) was invoked with the LATEST `allocator_preferences` row (not a cached one from test setup). If the test harness snapshots the preferences dict pre-handler-call, the assertion should be `snapshot['effective_preferences']['max_weight'] == <the test fixture's current mandate value>`. This catches a hypothetical future regression where the worker reads a stale cache.

---

## Do NOT apply (ignored per auto-mode)

- A-f8 (INFO, architecture — screening mode comment)
- A-f9 (INFO, verification — end-to-end test criterion downgrade)
- A-f10 (INFO, risk — CREATE OR REPLACE grant preservation)
- B-f4 (INFO, sequencing — subsumed by D2)

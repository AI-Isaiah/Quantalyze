# VOICES-ACCEPTED — Phase 09

Every finding below is to be folded into the existing `09-01-PLAN.md` / `09-02-PLAN.md` / `09-03-PLAN.md` / `09-04-PLAN.md` via targeted revision. Do NOT replan from scratch. Preserve frontmatter, task IDs, and wave structure unless a finding explicitly dictates otherwise.

---

## 1. [AUTO] f1 — Fix async/await mismatch in 09-02 pytest tests (Voice A BLOCKER)

**Target plan:** `09-02-PLAN.md` Task 2 test cases

**Concrete change:** The current `_load_allocator_context` at `analytics-service/routers/match.py:172` is synchronous (`def _load_allocator_context(allocator_id: str) -> dict[str, Any]`). Plan 09-02's new test cases are declared with `@pytest.mark.asyncio async def` and call `await _load_allocator_context(...)` — that raises `TypeError: object dict can't be used in 'await' expression`.

Remove `@pytest.mark.asyncio` and the `async` / `await` keywords from every new test case in Task 2. Tests become plain `def test_...` functions calling `_load_allocator_context("alloc-1")` directly. Leave `_load_allocator_context` synchronous — do not refactor it to async (the blast radius through `_score_one_allocator` / `cron-recompute` is out of scope).

---

## 2. [AUTO] f3 — Migration 073 strategy branch: LEFT JOIN + OR filter (Voice A BLOCKER)

**Target plan:** `09-01-PLAN.md` Task 2 (migration 073 body)

**Concrete change:** The current 09-01 Task 2 action specifies an INNER `JOIN match_decisions md ON md.id = bo.match_decision_id ... AND md.original_strategy_id IS NOT NULL AND md.original_holding_ref IS NULL` inside the `strategy_candidates` CTE. `bridge_outcomes.match_decision_id` is nullable (`REFERENCES match_decisions(id) ON DELETE SET NULL`, migration 059:53). Any legacy `bridge_outcomes` row with `match_decision_id IS NULL` (pre-link rows, or post-match-decision deletion) is silently dropped — regression vs migration 060.

In migration 073's `strategy_candidates` CTE, change the join to `LEFT JOIN match_decisions md ON md.id = bo.match_decision_id` and replace the filter clause with `(bo.match_decision_id IS NULL OR (md.original_strategy_id IS NOT NULL AND md.original_holding_ref IS NULL))`. The holding branch retains its existing INNER JOIN (holding-sourced rows always have a non-null `match_decision_id` by construction from finding #5 below).

Extend 09-01 Task 6 (cron regression test) with an additional fixture: a `bridge_outcomes` row with `match_decision_id = NULL, kind = 'allocated'` to pin the regression.

---

## 3. [AUTO] f6 — parseHoldingCompareId charset validation (Voice A WARNING)

**Target plan:** `09-04-PLAN.md` Task 1 (parser)

**Concrete change:** Inside `parseHoldingCompareId`, after splitting into `[prefix, venue, symbol, holding_type]`, add:

```ts
const OK = /^[A-Za-z0-9_-]+$/;
if (!OK.test(venue) || !OK.test(symbol) || !OK.test(holding_type)) return null;
```

This enforces the Phase 08 D-08 scope_ref invariant that other code paths (notes, audit entity_id) rely on. Add a Vitest assertion:

```ts
expect(parseHoldingCompareId("holding:binance:BTC/USDT:spot")).toBeNull();
expect(parseHoldingCompareId("holding:binance:BTC;drop:spot")).toBeNull();
```

---

## 4. [AUTO] g2 — 09-03 depends_on includes 09-02 (Voice B WARNING)

**Target plan:** `09-03-PLAN.md` frontmatter

**Concrete change:** Change `depends_on: [09-01]` → `depends_on: [09-01, 09-02]`. 09-03 reads `match_candidates` (written by 09-02's engine rewire) and widget payload from the new per-holding context (finding #5). Wave ordering unchanged: wave 1 = 09-01; wave 2 = 09-02; wave 2 parallel-with-09-02 OR wave 3 = 09-03 — planner picks based on file_modified overlap. If 09-02 and 09-03 have zero file overlap, they can run in the same wave with 09-03 depending on 09-02.

---

## 5. [AUTO] g3 — 09-01 acceptance: runtime proof of DO blocks (Voice B WARNING)

**Target plan:** `09-01-PLAN.md` Tasks 1 + 2 + 4

**Concrete change:** Task 4 (`[BLOCKING] supabase db push`) must capture the `supabase db push` stdout into a file (e.g. `/tmp/supabase-push-09-01.log`) and its `acceptance_criteria` must grep that log for the exact NOTICE strings emitted by both DO blocks. Example:

```
acceptance_criteria:
  - `supabase db push 2>&1 | tee /tmp/supabase-push-09-01.log` exit code 0
  - grep -q 'NOTICE:  phase09: match_decisions.original_holding_ref XOR CHECK deployed ✓' /tmp/supabase-push-09-01.log
  - grep -q 'NOTICE:  phase09: compute_bridge_outcome_deltas holding branch deployed ✓' /tmp/supabase-push-09-01.log
  - grep -q 'NOTICE:  phase09: bridge_outcomes UNIQUE index widened for holding-ref siblings ✓' /tmp/supabase-push-09-01.log  # see finding #8
```

---

## 6. [USER] f2 — Add 09-03 Task 5: `/api/match/decisions/holding` POST (Voice A BLOCKER)

**User decision:** "Add 09-03 Task 5: `/api/match/decisions/holding` POST" — dedicated thin endpoint that creates holding-sourced `match_decisions` rows before AllocatedForm/RejectedForm mount.

**Target plan:** `09-03-PLAN.md` — new Task 5

**Concrete change:**

1. Add a new Task 5 to 09-03 titled **"Ship `/api/match/decisions/holding` POST endpoint"**.
2. The task creates `src/app/api/match/decisions/holding/route.ts` containing a POST handler that:
   - Authenticates via `withAuth` (existing wrapper).
   - zod-validates body: `{ holding_ref: string, top_candidate_strategy_id: string (uuid) }`. Reject malformed input with 400.
   - Verifies the authenticated allocator owns a row in `allocator_holdings` matching the `(venue, symbol, holding_type)` parsed from `holding_ref` — return 403 otherwise (no existence leak; message "Unauthorized").
   - Verifies `top_candidate_strategy_id` is a published strategy — return 404 otherwise.
   - Inserts into `match_decisions` with:
     - `allocator_id = auth.uid()`
     - `strategy_id = top_candidate_strategy_id`
     - `original_strategy_id = NULL`
     - `original_holding_ref = holding_ref`
     - `decision = 'pending_outcome'` (or the existing initial decision kind used by Phase 05 — planner confirms from `match_decisions.decision CHECK` constraint)
     - `decided_by = auth.uid()`
   - Emits `logAuditEvent("match.decision.created", entity_id: decision.id, metadata: { original_holding_ref, top_candidate_strategy_id })` — reusing existing audit kind per CONTEXT D-14 (no new taxonomy entry).
   - Returns `{ match_decision_id }` on success.
3. Wire `ScenarioFlaggedHoldingsList.tsx` so that when the banner CTA (`onAllocatedClick` / `onRejectedClick`) is invoked on a flagged holding whose `matchDecisionsByHoldingRef[holding_ref]` is undefined, the client:
   - Posts to `/api/match/decisions/holding` with the resolved `holding_ref` + `top_candidate_strategy_id`.
   - On 2xx, refreshes `matchDecisionsByHoldingRef` (e.g. via `router.refresh()` or SWR revalidation) so the adapter now sees `eligible: true`.
   - Mounts AllocatedForm / RejectedForm.
   - On 4xx/5xx, surfaces a toast with the server's error message.
4. Add Vitest coverage:
   - Unit on zod validation (accepts valid, rejects malformed).
   - Live-DB: allocator A cannot create a decision against allocator B's holding (403).
   - RTL: ScenarioFlaggedHoldingsList click path posts to endpoint, waits for response, mounts form.
5. Threat model addition to 09-03: T-09-03.b — `/api/match/decisions/holding` must enforce holding-ownership check inside the handler (RLS on match_decisions alone is insufficient because inserting with the correct `allocator_id` bypasses RLS if holding ownership isn't separately verified).

---

## 7. [USER] f5 — 09-02 computes and returns per-holding context to SSR (Voice A WARNING)

**User decision:** "09-02 computes and returns per-holding context to SSR" — no `match_candidates` schema change; engine input-layer returns a structured per-holding flags list.

**Target plans:** `09-02-PLAN.md` + `09-03-PLAN.md`

**Concrete change:**

### 09-02-PLAN.md:

1. Extend `_load_allocator_context()` return shape with a new key `holding_flags: list[dict]` where each entry is:
   ```python
   {
       "holding_ref": "holding:binance:BTC:spot",
       "value_usd": 123456.78,
       "weight": 0.18,
       "breach_reasons": ["max_weight", "correlation_ceiling"],  # zero or more of: max_weight, correlation_ceiling (D-05 in-scope)
       "top_candidate_strategy_id": "<uuid>" | None,
       "top_candidate_composite": 67.3 | None,  # 0-100 scale per planning_overrides
       "flagged": True | False,  # breach AND composite >= 50 per D-04 + D-06
   }
   ```
2. Compute logic:
   - `max_weight` breach: `value_usd / portfolio_aum > allocator_preferences.max_weight`.
   - `correlation_ceiling` breach: call `_compute_corr_with_portfolio(pseudo_returns_series, rest_of_portfolio_returns)` from `match_engine.py`; breach when correlation > `allocator_preferences.correlation_ceiling` (per D-05).
   - `top_candidate_*`: after `score_candidates()` scores the pseudo-strategy's slot, pick the highest-score verified strategy that is not `thumbs_down`-ed. If no candidate with score >= 50 exists → `top_candidate_*` is `None` and `flagged = False` per D-06 candidate-exists gate.
3. Persist `holding_flags` into `match_batches` as a JSONB column (new migration 074 OR extend 072 if still within the atomic commit window) — keyed by batch, read by SSR. Planner decides atomic-commit packaging: if `holding_flags` persistence requires schema, it goes in 09-01 alongside 072; otherwise an ephemeral derivation per SSR read is acceptable if performance allows.
4. pytest coverage:
   - `test_holding_flags_max_weight` — fixture with a 40% allocation against 25% max_weight → breach.
   - `test_holding_flags_correlation_ceiling` — fixture with 3 BTC-correlated tokens → breach on at least one.
   - `test_holding_flags_candidate_exists_gate` — fixture where no candidate scores ≥ 50 → flagged = False even when breach exists.
   - `test_holding_flags_warmup_gate` — holding with < 30d per-symbol history → excluded from flags entirely.

### 09-03-PLAN.md:

1. Task 2 (queries.ts `getMyAllocationDashboard`) change: instead of inventing a derivation from `match_candidates`, read `holding_flags` from `match_batches.holding_flags` (or the ephemeral route 09-02 chose) via a single join: `match_batches JOIN allocator_holdings` latest-asof. Return `flaggedHoldings[]` where each entry is one `holding_flags` row + the resolved top-candidate strategy row (name, factsheet fields).
2. Drop any task reference to `match_candidates WHERE score >= 50` — it was the ungrounded derivation Voice A flagged.
3. Keep `FLAG_COMPOSITE_THRESHOLD = 50` as a constant referenced by 09-02 (engine-side) and 09-03 (assertion parity) — add a test that asserts both values match.

---

## 8. [USER] f4 — Widen bridge_outcomes UNIQUE index in migration 072 (Voice A WARNING)

**User decision:** "Widen the index in migration 072" — allow two different holdings to both record outcomes against the same top-candidate strategy.

**Target plan:** `09-01-PLAN.md` Task 1 (migration 072)

**Concrete change:**

1. Extend migration 072's body with (after the `match_decisions.original_holding_ref` column + XOR CHECK + partial index):
   ```sql
   -- Widen bridge_outcomes unique index to allow multiple holdings → same candidate
   DROP INDEX IF EXISTS uniq_bridge_outcomes_allocator_strategy;
   CREATE UNIQUE INDEX uniq_bridge_outcomes_allocator_strategy_holding
     ON bridge_outcomes (allocator_id, strategy_id, COALESCE((
       SELECT original_holding_ref FROM match_decisions WHERE id = bridge_outcomes.match_decision_id
     ), ''));
   ```
   If sub-select in index expression is not allowed on this Postgres version, add a denormalized `original_holding_ref TEXT NULL` column on `bridge_outcomes` itself (indexed locally) and populate it via a BEFORE INSERT/UPDATE trigger that reads from `match_decisions`. Planner picks the shape during Task 1 authoring based on Supabase's Postgres version (see RESEARCH.md for version pinning).

2. Add a 6th assertion to the Task 1 self-verifying DO block: `IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uniq_bridge_outcomes_allocator_strategy_holding') THEN RAISE EXCEPTION 'phase09: bridge_outcomes widened unique index missing'; END IF;` + matching NOTICE per finding #5.

3. Add 09-01 Task 5 (XOR RLS test) coverage: insert two `bridge_outcomes` rows with the same `(allocator_id, strategy_id)` where their backing `match_decisions` point to different `original_holding_ref` values → both succeed. Attempting to insert a THIRD with the same `(allocator_id, strategy_id, original_holding_ref)` → fails with 23505.

4. Threat model note in 09-01: T-09-01.b — ensure the widened index still prevents double-recording of the same (allocator, strategy, holding) outcome (the primary idempotency guarantee is preserved; only the `(allocator, strategy)` pair-without-holding constraint is relaxed).

---

## 9. [USER] g4 — Add explicit render-branch task to 09-04 (Voice B INFO)

**User decision:** "Add explicit render-branch task to 09-04" — make the holding-side render path first-class.

**Target plan:** `09-04-PLAN.md`

**Concrete change:**

1. Add a new explicit step inside 09-04 Task 1 (or a new Task 2, planner picks): create `src/app/(dashboard)/compare/HoldingFactsheet.tsx` that renders the holding side of the comparison:
   - "Holding" header badge (distinct from the Strategy factsheet card).
   - Ticker + venue + holding_type.
   - Computed analytics from reconstructed per-symbol returns: sharpe, max_drawdown, cumulative_return, vol — via the helper introduced in 09-02 (import from the analytics-service-provided client-side wrapper, or compute inline from the breakdown jsonb passed from SSR).
2. Modify `CompareTable.tsx` (or the equivalent renderer — planner confirms path) with:
   ```tsx
   {items.map(item =>
     item.kind === 'holding'
       ? <HoldingFactsheet key={item.id} venue={item.venue} symbol={item.symbol} analytics={item.analytics} />
       : <StrategyFactsheet key={item.id} strategy={item.strategy} />  // existing
   )}
   ```
3. Vitest RTL:
   - Render `/compare?ids=holding:binance:BTC:spot,<uuid>` with live-DB fixture — assert HoldingFactsheet renders AND StrategyFactsheet renders side-by-side.
   - Regression: `/compare?ids=<uuid>,<uuid>` still renders two StrategyFactsheets (strategy-only path unchanged).
4. Preserve DESIGN.md typography/spacing parity between the two factsheet shells (1px borders, 8px radius, DM Sans).

---

## Revision instruction to gsd-planner

Apply findings 1-9 above as targeted in-place edits to the existing 4 plan files. Do NOT replan from scratch. Preserve:
- Frontmatter shape (add to `depends_on` / `files_modified` as needed per fix).
- Task IDs where possible (new tasks get fresh IDs — e.g. 09-03 Task 5 for finding #6, 09-04 adds an explicit render task per finding #9).
- Wave structure: wave 1 = 09-01; wave 2 = 09-02; wave 2/3 = 09-03 (per updated depends_on); wave 3 = 09-04.
- The schema-push BLOCKING task in 09-01.
- All existing threat-model blocks (add entries where findings dictate).

Return `## REVISION COMPLETE` with a bullet per finding applied, noting which plan file and task was edited.

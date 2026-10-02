# Outside Voices — Accepted Findings (Phase 5)

**Prepared for:** gsd-planner voice-revision replan.
**Date:** 2026-04-19

## Consensus (auto-folded)

### C2 — [BLOCKER / sequencing] Reorder W1-02 before W1-01

**Why:** Migration 064 destructively ALTER TABLEs a live DB and DROPs the old 5-arg `send_intro_with_decision` RPC. If the user picks Option C ("defer Phase 5") at the W1-02 checkpoint, the plan must roll back a live migration — a disaster ordering.

**Apply:**
- Move Task `5-01-W1-02` (checkpoint:decision on SendIntroPanel underperformer source) to run BEFORE `5-01-W1-01` (migration apply). Renumber accordingly: the former W1-02 becomes W1-01, the former W1-01 becomes W1-02.
- The new W1-01 (decision checkpoint) is `[BLOCKING]`. If the user picks defer, skip all subsequent W1-* tasks and W2/W3 content that depends on the `original_strategy_id` column.
- If the user picks Option A (holdings dropdown) or Option B (sentinel strategy), then proceed with W1-02 (migration apply) AND update the admin UI task to wire up the chosen source.

### C3 — [WARNING / risk] NOT NULL + empty-table assumption is fragile

**Apply:**
- Migration 064 ships as `ALTER TABLE match_decisions ADD COLUMN original_strategy_id UUID NULL REFERENCES strategies(id) ON DELETE RESTRICT` (NULL-allowed, RESTRICT per D3 below). Drop the pre-apply `SELECT count(*) FROM match_decisions` empty-table check.
- Add a Phase-5 follow-up migration 065 queued for Wave 3 (after admin UI has been deployed and confirmed shipping rows with non-null values): `ALTER TABLE match_decisions ALTER COLUMN original_strategy_id SET NOT NULL` guarded by a `DO block` that verifies `SELECT count(*) FROM match_decisions WHERE original_strategy_id IS NULL` = 0, else RAISE EXCEPTION.
- **In transit state:** `getMyAllocationDashboard` and the curves endpoint MUST gracefully handle `match_decision.original_strategy_id IS NULL` → em-dash in the UI (matches D-03 convention). Existing nullable handling in the read path (`match_decision.original_strategy: ... | null`) already covers this; confirm the test map still asserts.

## Consensus — user-overridden (no replan action)

### C1 — [BLOCKER / scope] "Phase 5 crosses READ-ONLY scope"

**Override reason:** User on 2026-04-19 explicitly authorized DB restructuring ("the database has no data yet. Choose the most efficient version. you can completely restructure the database. Make it efficient."). Admin-side schema/RPC/UI changes are user-approved scope expansion; ROADMAP entry already amended via D-20d footnote. Voices raised the concern but had no visibility into the prior authorization — finding acknowledged and dismissed.

---

## Divergent — accepted by user

### D1 — [BLOCKER / architecture] Consolidate widget to 1–2 files

**Apply:**
- Collapse the 5-file widget split (`OutcomesWidget.tsx` + `OutcomesKPIStrip.tsx` + `OutcomesTimelineRow.tsx` + `OutcomesExpandedPanel.tsx` + `OutcomesSparkline.tsx`) into **one file: `OutcomesWidget.tsx`** with inline sub-component functions (pattern: `CustomKpiStrip` + `PositionsTable`). The Sparkline may stay as a separate file IF it's reused elsewhere — otherwise inline.
- Rewrite Wave 2 tasks W2-01..W2-05 into a single task `W2-01: build OutcomesWidget.tsx` (KPI strip + timeline table + expandable panel + sparkline inline). Keep widget-registry + barrel + default-layout + LAYOUT_VERSION as separate tasks (they are one-line edits each, different files).
- Target: reduce `files_modified` from 23 → ≤ 14 (target cut: widget files 5 → 1; keep tests co-located in `outcomes.test.tsx`).

### D2 — [BLOCKER / verification] Fix parity fixture (resolve math + rename or wire Python)

**Apply:**
- **Resolve math first:** Read `analytics-service/services/feedback_engine.py` and determine whether Phase 4 computes avg realized delta using `delta_90d` (research Q4 says → 0.02333) or most-mature delta (D-12 says → 0.00333). The TWO specs disagree. Fix the authoritative answer in CONTEXT.md D-12 + RESEARCH.md Q4 + the fixture in a single commit.
- **Then pick ONE of:**
  - **(a) Keep parity framing + wire Python:** Add Wave 0 task `5-01-W0-03` that shells out to a Python test (pytest one-liner) that imports `feedback_engine._fetch_eligible_outcomes` + computes avg delta on `tests/fixtures/outcomes-kpi-parity.json` and asserts equality with the TypeScript `expected` block. File path: `analytics-service/tests/test_outcomes_kpi_parity.py`. Even if gated on `HAS_PY_ENV=1`, this enforces the parity claim.
  - **(b) Drop parity framing:** Rename `tests/fixtures/outcomes-kpi-parity.json` → `tests/fixtures/outcomes-kpi-golden.json`. Strike "cross-runtime parity" language from CONTEXT.md D-21 and replace with "TypeScript-side golden; parity with Phase 4 noted as a follow-up." Update all plan references.
- **Planner's call** between (a) and (b) — recommendation: (a) is the honest answer, but (b) is fine if the Python test infra isn't immediately wireable.

### D4 — [WARNING / verification] Regression test for .eq allocator_id on new fan-out

**Apply:**
- Add to `src/lib/queries.my-allocation.test.ts` (Wave 0) a test case `"TC outcomes-05: outcomes fan-out includes .eq('allocator_id', userId) on the admin chain"` that:
  - Stubs the Supabase admin client with a chain recorder
  - Calls `getMyAllocationDashboard(userId)`
  - Inspects the recorded chain for the outcomes fan-out entry
  - Asserts the `.eq` call with matching column = `"allocator_id"` and value = `userId` is present
- This is a regression gate, not a data-correctness test. It prevents a future refactor from accidentally stripping the ownership filter.

### D9 — [INFO / verification] Mark typography tests as className-only + add visual review

**Apply:**
- Annotate all typography-related test case names in `outcomes.test.tsx` with "className presence check:" prefix (e.g., `"className presence check: KPI values use font-mono text-[13px] tabular-nums"`). Reviewers immediately know these don't prove rendered font.
- Add ONE Wave 3 task `5-01-W3-03: visual typography review`. Non-autonomous; human opens the widget in DevTools, confirms Geist Mono rendering on KPI values, DM Sans on labels/body, tabular-nums numerics aligned. Acceptance: reviewer comments "confirmed" in the task status.
- OPTIONAL upgrade: add `getComputedStyle(node).fontFamily.toLowerCase()).toContain("geist")` to one representative KPI test to assert actual rendered font. Single line change.

### D11 — [WARNING / verification] Live-DB test for nested match_decisions join

**Apply:**
- Add Wave 0 scaffolding `src/__tests__/outcomes-join-rls.test.ts` gated by `HAS_LIVE_DB=1` (follow Phase 1 precedent `bridge-outcomes-rls.test.ts`).
- Test body (Wave 1 turns RED→GREEN):
  1. Seed 2 allocators, 1 match_decision per allocator with `original_strategy_id`, 1 bridge_outcome per.
  2. Call `getMyAllocationDashboard(allocator1Id)` via the admin client.
  3. Assert `payload.outcomes.length === 1` (only allocator1's outcome).
  4. Assert `payload.outcomes[0].match_decision.original_strategy.id === seededOriginalId`.
  5. Assert `payload.outcomes[0].match_decision.original_strategy.name === seededOriginalName`.
- Verifies the nested embed resolves AND the inline `.eq("allocator_id", userId)` ownership gate holds against live RLS.

### D3 — [BLOCKER / risk] Change ON DELETE CASCADE → RESTRICT

**Apply:**
- Migration 064 FK clause: `REFERENCES strategies(id) ON DELETE RESTRICT` (NOT CASCADE, NOT SET NULL-unless-relaxing-NULL-constraint).
- Add inline SQL comment: `-- ON DELETE RESTRICT per migration 059 A6 precedent (match_decision_id FK on bridge_outcomes uses SET NULL to preserve outcome history; here RESTRICT because deleting a still-referenced underperformer should be blocked, not silently erased)`.
- Pre-apply check replaces the empty-table verification (dropped per C3): confirm `ON DELETE RESTRICT` is present in `information_schema.referential_constraints` or equivalent. Test lives in `match-decisions-schema.test.ts`.

### D5 — [WARNING / risk] Paginate or defer outcomes fan-out

**Apply:**
- **Recommended option: (b) cap server SELECT:** modify `getMyAllocationDashboard` outcomes fan-out to add `.limit(200)` inline. Matches the existing D-01 assumption that allocators have < 50 outcomes in early lifecycle; a 200 cap is 4x headroom.
- Add a note to the widget: if received outcomes count = 200, render a subtle `<span class="text-text-muted text-xs">Showing most recent 200 — reach out if you need historical export</span>` footer. No "Show older" pagination UI in Phase 5 (deferred to the existing deferred-items list). This is honest about truncation without adding pagination UX scope.
- Alternative (a) — client-mount fetch — REJECTED for Phase 5: breaks the widget system's "server push via WidgetProps.data" contract and adds a new endpoint surface.

### D8 — [WARNING / risk] LAYOUT_VERSION bump handling

**Apply:**
- Add Wave 1 task `5-01-W1-09: verify production layout-bump impact`. Non-autonomous. Executor:
  1. Queries production (admin client): `SELECT count(*) FROM profiles WHERE saved_layout IS NOT NULL` (or whatever column name the existing layout persistence uses; grep `LAYOUT_VERSION` + `saved_layout` + nearby storage).
  2. If count = 0: document in SUMMARY.md "Zero production allocators with saved layouts — bump is zero-impact." Proceed.
  3. If count > 0: EITHER (a) add a one-session `<InsightStrip>` banner rendered when `LAYOUT_VERSION` is incremented ("We added Bridge Outcomes to your dashboard. Your previous layout has been reset — rearrange as needed."), OR (b) implement a layout-merge: on bump, inject the new `outcomes-timeline` widget entry at the top of the user's saved layout preserving their existing entries underneath. Executor picks based on complexity; document choice in SUMMARY.md.

### D12 — [INFO / risk] Document admin-flow Phase-6 fragility

**Apply:**
- Add to SUMMARY.md at phase completion (written in the verify-work step): "**Admin changes v1-only:** the `p_original_strategy_id` capture in `send_intro_with_decision` and the `SendIntroPanel` holdings-dropdown (or sentinel, depending on W1-01 decision) are admin-side v1 implementations. If Phase 6+ introduces a portfolio-aware admin bridge flow that already carries the underperformer identity in its native state, revisit whether this wiring is still the simplest write-path. Migration 064 remains the load-bearing invariant — the admin UI is incidental."

### D6 — [WARNING / clarity] Resolve zero-delta pill contradiction

**Apply:**
- **Adopt Phase-4 parity** (zero = loss in status pill) and explicitly update CONTEXT.md D-02 to say: `"Allocated variants are color-coded from the most-mature non-NULL delta sign via strict > 0 check (Phase 4 _success_value parity). This INTENTIONALLY overrides Phase 1 D-13 (D-13 = neutral-on-zero) for the status pill only. The Best Available Delta cell continues to honor D-13 (neutral on zero). Divergence is intentional: the pill binary-classifies success/failure for reinforcement learning; the delta cell displays raw magnitude without classification."`
- Keep the Wave 0 test `"allocated-loss on zero delta"` as-is — it's now consistent with the updated D-02.
- Add an assertion in `deriveOutcomeStatusPill` test: when `delta_180d = 0`, pill variant is `"allocated-loss"` AND derivation calls out Phase-4 parity in a code comment.

### D10 — [INFO / clarity] Confirm curves rate-limit bucket keying

**Apply:**
- Add to Wave 0 (or earlier) a read-only investigation step: executor reads `src/lib/ratelimit.ts` to confirm how `userActionLimiter` computes its bucket key.
  - If keyed by `${prefix}:${userId}` (prefix-inclusive): the curves endpoint gets its own bucket distinct from POST /api/bridge/outcome. No change needed.
  - If keyed by `userId` only (prefix is label, not bucket): shared budget. Add a new dedicated limiter export `bridgeOutcomeCurvesLimiter` in `src/lib/ratelimit.ts` with budget ≥ 60 expansions/session, and use it in the curves route.
- Document the conclusion in the curves-route task `<read_first>` and in SUMMARY.md at phase gate.

---

## Ignored

None — all 12 divergent findings accepted, except:

### D7 — [WARNING / architecture] Pre-declare Option A route for SendIntroPanel

**User decision:** not applied. The W1-02 decision checkpoint already allows Option A / B / C; if the user picks Option A at the checkpoint, the executor is expected to propose the route details in-flow rather than pre-allocating scaffolding for a path that may never be built (if user picks B or C). Accepted as noise.

---

## Summary

- C1 (scope): OVERRIDDEN by user authorization
- C2 (sequencing): APPLY (reorder)
- C3 (empty-table): APPLY (make NULL-allowed, tighten in follow-up migration 065)
- D1 (widget consolidation): APPLY
- D2 (parity fixture): APPLY (resolve math first, then rename OR wire Python)
- D3 (CASCADE→RESTRICT): APPLY
- D4 (.eq regression test): APPLY
- D5 (paginate fan-out .limit(200)): APPLY
- D6 (zero-delta): APPLY (update D-02 to override D-13 explicitly)
- D7 (Option A route scaffolding): IGNORED
- D8 (layout-bump handling): APPLY
- D9 (typography className tag + visual review): APPLY
- D10 (rate-limit keying): APPLY (investigation + optional split)
- D11 (live-DB nested join test): APPLY
- D12 (admin-flow Phase-6 note): APPLY

11 changes to fold into replan. One sequencing BLOCKER resolved by reorder. Widget architecture simplified (5 files → 1). Migration safety improved (NULL-first + RESTRICT). Verification hardened (parity check, ownership regression, visual review, live-DB join).

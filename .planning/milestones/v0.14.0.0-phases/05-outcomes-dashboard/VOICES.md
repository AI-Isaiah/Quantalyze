# Outside Voices — Phase 5

**Voice A (Claude subagent, fresh context):** verdict=**revise** — Phase 5 plan balloons a READ-ONLY dashboard into a breaking schema migration + RPC replacement + admin-route + admin-UI work. Several sharp edges: ON DELETE CASCADE on the new FK is more destructive than convention, the parity fixture does not actually prove parity, and the plan uses NOT NULL-without-nullable-first on a live table with no tested rollback path.

**Voice B (Grok grok-4-1-fast-reasoning):** verdict=**revise** — Plan commits scope creep to admin UI and schema migration beyond allocator widget goal, with 23 files_modified signaling overcomplexity. Blocking human decision mid-Wave 1 risks stalled sequencing; simpler single-line sparkline viable per RESEARCH.md Q1 Option A.

---

## Consensus findings (auto-fold into replan)

| # | Priority | Area | Title | Severity (A/B) | Confidence (A/B) | Recommendation |
|---|----------|------|-------|----------------|------------------|----------------|
| C1 | P0 | scope | Plan crosses phase boundary — admin-side schema/RPC/UI work beyond allocator read-path | BLOCKER/BLOCKER | HIGH/HIGH | **USER OVERRIDE:** user explicitly authorized DB restructuring on 2026-04-19 ("the database has no data yet. Choose the most efficient version. you can completely restructure the database. Make it efficient."). Scope creep warning is noted but OVERRIDDEN — keep admin-side work in Phase 5. ROADMAP entry already updated with D-20d amendment. NO replan action. |
| C2 | P0 | sequencing | Blocking W1-02 decision checkpoint ordered AFTER W1-01 destructive migration | BLOCKER/WARN | HIGH/HIGH | Reorder: W1-02 (human-verify decision) MUST run BEFORE W1-01 (migration apply). If user picks defer, migration 064 never runs — no rollback needed. Alternative: ship migration 064 as NULL-allowed first; tighten to NOT NULL in a follow-up migration once admin UI flows values. |
| C3 | P2 | risk | NOT NULL + empty-table assumption is a fragile apply-time precondition | WARN/WARN | HIGH/HIGH | Apply migration 064 as `ADD COLUMN original_strategy_id UUID NULL` initially; tighten to NOT NULL in a Phase-5 follow-up migration (065) after admin UI is confirmed shipping non-null values. Removes the empty-table precondition entirely and makes branch DBs safe. |

## Divergent findings (require user decision)

### Architecture (2)

| # | Priority | Title | Voice A | Voice B |
|---|----------|-------|---------|---------|
| D1 | P1 | 23 files_modified + 5-file widget split is overcomplex | (not flagged — Voice A does not consider the split a smell) | BLOCKER HIGH — consolidate into single OutcomesWidget.tsx (inline KPI/table/sparkline like CustomKpiStrip+PositionsTable); cut to <10 files_modified |
| D7 | P1 | W1-04 Option A adds a new fetch in SendIntroPanel with no route, validation, rate limit, or tests | WARN HIGH — pre-declare the route path, auth, tests, and threat-model entry BEFORE the decision checkpoint, OR require Option A to reuse an existing admin endpoint | (not flagged) |

### Verification (4)

| # | Priority | Title | Voice A | Voice B |
|---|----------|-------|---------|---------|
| D2 | P0 | "Parity" fixture only tests Phase 5 against itself; expected avgRealizedDelta disagrees with RESEARCH.md Q4 | BLOCKER HIGH — either add a Wave 0 task running Phase 4 Python against the same fixture, or rename to outcomes-kpi-golden.json (drop "parity" framing). Also resolve 0.02333 vs 0.00333 — one spec is wrong. | (not flagged) |
| D4 | P2 | No regression test asserts `.eq("allocator_id", userId)` on the new admin-client outcomes fan-out | WARN HIGH — add a W0-01 test case that mocks the admin chain and asserts the ownership gate is present, OR add a HAS_LIVE_DB-gated integration test that seeds two allocators | (not flagged) |
| D9 | P3 | Typography-assertion tests check className strings, not rendered typography | INFO HIGH — mark assertions as "className presence check" and add one Wave 3 visual-review task, OR use `getComputedStyle(node).fontFamily` | (not flagged) |
| D11 | P2 | No live-DB test for nested match_decisions join feasibility (RLS + embed resolution) | (not flagged) | WARN MED — extend `src/__tests__/outcomes-join-rls.test.ts` (HAS_LIVE_DB) with seeded allocator/outcome/match_decision + assert `payload.match_decision.original_strategy.name` resolves |

### Risk (4)

| # | Priority | Title | Voice A | Voice B |
|---|----------|-------|---------|---------|
| D3 | P0 | ON DELETE CASCADE on new FK diverges from A6 precedent (migration 059 uses SET NULL for match_decision_id); silently shreds decision history | BLOCKER HIGH — change to `ON DELETE RESTRICT` or `ON DELETE SET NULL` (relax NOT NULL); cite A6 precedent in a comment | (not flagged) |
| D5 | P1 | Dashboard fan-out loads full unpaginated outcomes list inline with every /allocations page hit | WARN HIGH — either move outcomes fan-out behind client-side widget-mount fetch OR cap server SELECT to most-recent 200 + "Show older" affordance | (not flagged) |
| D8 | P2 | LAYOUT_VERSION bump 1→2 silently wipes saved layouts with no migration/merge/notice path | WARN MED — confirm zero production allocators with persisted layouts OR add a one-session banner after bump ("Bridge Outcomes added; previous layout reset") | (not flagged) |
| D12 | P3 | Schema/RPC change fragile if admin flow refactors in Phase 6 (portfolio-aware admin bridge) | (not flagged) | INFO MED — document in SUMMARY.md "Admin changes v1-only; monitor for Phase 6 portfolio-aware admin refactor" |

### Clarity (2)

| # | Priority | Title | Voice A | Voice B |
|---|----------|-------|---------|---------|
| D6 | P2 | Zero-delta status-pill semantics contradict D-02's own reference to Phase 1 D-13 (D-13 = neutral on zero; Phase 4 = zero is loss); Best Available Delta cell honors D-13 so Status pill and Best Delta disagree on the same row | WARN HIGH — pick one: (a) treat zero as neutral in `deriveOutcomeStatusPill` OR (b) update D-02 to override D-13 explicitly; don't ship with two specs disagreeing inside the same CONTEXT.md | (not flagged) |
| D10 | P3 | Curves endpoint rate-limit shares `userActionLimiter` bucket with POST /api/bridge/outcome — one user action burns another's budget | INFO MED — inspect `src/lib/ratelimit.ts` to confirm keying; if shared-budget, add dedicated limiter or raise per-user budget for curves | (not flagged) |

---

## Voice counts

- Voice A: 12 findings (4 blocker, 6 warning, 2 info)
- Voice B: 6 findings (2 blocker, 3 warning, 1 info)
- Consensus: 3 (C1, C2, C3 — C1 user-overridden)
- Divergent: 12 (pending user decision batched by area)

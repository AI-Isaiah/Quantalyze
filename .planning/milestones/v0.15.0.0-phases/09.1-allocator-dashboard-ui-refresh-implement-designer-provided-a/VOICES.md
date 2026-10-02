# Outside Voices — Phase 09.1

**Voice A (Claude subagent, fresh context):** verdict=revise — Multiple plans leave hard deps unstated or sequence them wrong; several acceptance criteria grep-pass without proving behavior; adapter strategy-join heuristic fabricated; DnD skips keyboard a11y; Tweaks QA-mode gate structurally leaky.

**Voice B (Grok 4.20 multi-agent):** verdict=revise — Sequencing gaps (09.1-05 missing dep on 09.1-02), contradiction of locked D-02 (09.1-03 v2 storage key), weak grep-only acceptance criteria, and 09.1-05 Task 1 defers required D-01 pointer-resize.

## Consensus findings (auto-fold into replan)

| # | Priority | Area | Title | Severity (A/B) | Confidence (A/B) | Recommendation |
|---|----------|------|-------|----------------|------------------|----------------|
| 1 | P1 | architecture / risk | Plan 03 v2 storage-key split contradicts locked D-02 (reuse `quantalyze-dashboard-config`) | WARN/WARN | HIGH/HIGH | Delete the "Simplified approach — two storage keys" paragraph; use single `STORAGE_KEY = "quantalyze-dashboard-config"` for both hooks with reset-on-mismatch per Voice-D8 precedent. Update Task 3 test 1's localStorage key from `quantalyze-dashboard-config-v2` → `quantalyze-dashboard-config`. |

## Divergent findings (require user decision — 14 items)

### Sequencing (3)

| # | Priority | Title | Voice A says | Voice B says |
|---|----------|-------|--------------|--------------|
| S1 | P0 | Plan 01 ↔ Plan 02 file-overlap on AllocationsTabs.tsx unflagged | BLOCKER — Change Plan 02 frontmatter `depends_on: []` → `depends_on: [09.1-01]` and `wave: 1` → `wave: 2` | (not flagged) |
| S2 | P1 | Plan 05 `depends_on` omits 09.1-02 (tab shell needed for V2 mount) | (not flagged) | WARN — Change Plan 05 `depends_on: [09.1-01, 09.1-03]` → `[09.1-01, 09.1-02, 09.1-03]` |
| S3 | P1 | Plan 08 HoldingsTable rewrite drops per-row BridgeOutcomeBanner (D-14 silently violated; Plan 09 retroactively reintegrates) | WARN — Add BridgeOutcomeBanner mount to Plan 08 Task 2 (preserve D-14 per-row surface in the plan that owns HoldingsTable) | (not flagged) |

### Risk (5)

| # | Priority | Title | Voice A says | Voice B says |
|---|----------|-------|--------------|--------------|
| R1 | P0 | Plan 04 adapter fabricates `asset_symbols` join key | BLOCKER — Grep `queries.ts` + `AllocationDashboard.tsx:697-724` for the ACTUAL holding→strategy correspondence; port verbatim. If absent, accept caller-supplied `holdingToStrategyId` map. Do not invent. | (not flagged) |
| R2 | P0 | Plan 09 BridgeDrawer `/api/match/decisions/holding` POST violates D-16 "no parallel bridge API" | BLOCKER — Extract the exact endpoint ScenarioFlaggedHoldingsList already uses; if none, STOP and replan. Update Task 3 Test 8 + add acceptance criterion forbidding string-literal fetch URL. | (not flagged) |
| R3 | P2 | Plan 05 widget-gating composite-widget filter breaks across designer short-keys vs registry IDs | WARN (MED conf) — Normalize key space at addWidget: store resolved WIDGET_REGISTRY id only; add `AllocationDashboardV2.widget-gating.test.tsx`. | (not flagged) |
| R4 | P2 | Plan 06 Avg ρ cell will render permanent em-dash with misleading sub-copy (`avg_correlation` field not wired) | WARN (MED conf) — Change sub-line to `sub: avg_correlation == null ? "Requires per-holding correlation data (pending)" : "average pairwise correlation across holdings"`; add null-path test. | (not flagged) |
| R5 | P2 | Plan 11 sidebar badge introduces new server query with no RLS invariants | WARN (MED conf) — Delete `getFlaggedHoldingsCount` helper; thread `flaggedHoldings.length` from existing `/allocations/page.tsx` payload via Context or optional prop. | (not flagged) |

### Verification (5)

| # | Priority | Title | Voice A says | Voice B says |
|---|----------|-------|--------------|--------------|
| V1 | P0 | Plan 05 Task 1 accepts keyboard-inoperable drag handle (violates D-04 a11y contract) | BLOCKER — Add Enter/Space keyboard-reorder mode, `aria-pressed`, and always-present `⋯` menu with Move up/down/Remove items; add onKeyDown acceptance criterion + keyboard reorder test. | (not flagged) |
| V2 | P2 | Plan 05 Task 1 explicitly defers D-01 pointer-resize handle (designer spec mandates it) | (not flagged) | WARN — Implement right-edge pointer handle per `widget-grid.jsx:100-135` (draggable, onPointerDown + col-resize, snap to [1,2,3,4] on pointerup). |
| V3 | P1 | Plan 11 QA-mode gate relies on runtime `process.env` mutation in tests (fails with build-time inlining) | WARN — Change gate to `QA_MODE` constant in own module; `vi.mock` that module in tests; add `grep -q 'vi.mock'` acceptance criterion. | (not flagged) |
| V4 | P1 | Plan 07 Task 1 period-tokens grep is broken (fallback `grep -c` passes if any single token appears anywhere) | WARN — Replace compound grep with per-token loop: `for t in 1M 3M 6M YTD 1Y ALL CUSTOM; do grep -q "\"$t\"" ... \|\| exit 1; done` | (not flagged) |
| V5 | P1 | Plan 01 Task 2 acceptance criteria are grep-only — do not prove hydration safety, flag toggle, or `?ui=v2` override | (not flagged) | WARN — Replace 7 grep lines with DOM-level assertions (`[data-ui-v2-shell]` present under flag/override; legacy marker when off; no hydration mismatch). |

### Clarity (1)

| # | Priority | Title | Voice A says | Voice B says |
|---|----------|-------|--------------|--------------|
| C1 | P1 | Plan 08 silently drops "Modified" outcome kind (contradicts D-13 Allocated/Rejected/Modified spec) | WARN — Add disabled `{ key: "modified", label: "Modified (coming soon)" }` option to OutcomeForm segmented control; add grep acceptance criterion. | (not flagged) |

---

**Totals:**
- Voice A: 12 findings (4 BLOCKER, 8 WARNING) — verdict: revise
- Voice B: 4 findings (0 BLOCKER, 4 WARNING) — verdict: revise
- Consensus: 1 (auto-fold)
- Divergent: 14 — require user decision

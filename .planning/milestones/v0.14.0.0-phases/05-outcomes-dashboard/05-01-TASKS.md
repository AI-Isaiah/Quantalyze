---
phase: 05-outcomes-dashboard
plan: 01
kind: tasks-sidecar
note: |
  Task bodies for 05-01-PLAN.md. Revised 2026-04-19 per Outside Voices
  accepted findings (C2, C3, D1, D2, D3, D4, D5, D6, D8, D9, D10, D11, D12).
  Key structural changes from prior pass:
    - Voice-C2 reorder: W1-01 is now the decision checkpoint, W1-02 is now
      the migration apply. Apply is conditional on W1-01 = Option A or B.
    - Voice-C3: migration 064 ships as NULL-allowed; follow-up migration 065
      (Wave 3, task W3-02) tightens to NOT NULL guarded by DO block.
    - Voice-D1 consolidation: W2-01..W2-05 collapse into a single
      W2-01 task building single-file OutcomesWidget.tsx with inline
      KpiStrip / TimelineTable / TimelineRow / ExpandedPanel / Sparkline
      sub-components. Test file stays as single outcomes.test.tsx.
    - Voice-D3: migration 064 FK uses ON DELETE RESTRICT, not CASCADE.
    - Voice-D5: .limit(200) on outcomes fan-out + widget truncation footer.
    - Voice-D10: Wave 0 adds rate-limit investigation + new
      bridgeOutcomeCurvesLimiter export.
    - Voice-D11: Wave 0 adds outcomes-join-rls.test.ts (HAS_LIVE_DB-gated).
    - Voice-D2 option a: Wave 0 adds Python pytest parity test.
---

<tasks>

<!-- ======================== WAVE 0 — RED SCAFFOLDS + MIGRATION FILES + RATE-LIMIT INVESTIGATION ======================== -->

<task type="auto" tdd="true" id="5-01-W0-01">
  <name>Task 5-01-W0-01: Wave 0 RED scaffolds — 5 new test files + 2 test-file extensions + golden fixture + Python parity harness + live-DB nested-join test</name>
  <files>src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx, src/lib/outcomes-kpi.test.ts, tests/fixtures/outcomes-kpi-parity.json, src/app/api/bridge/outcome/[id]/curves/route.test.ts, src/__tests__/match-decisions-schema.test.ts, src/__tests__/outcomes-join-rls.test.ts, src/lib/bridge-outcome-label.test.ts, src/lib/queries.my-allocation.test.ts, analytics-service/tests/test_outcomes_kpi_parity.py</files>
  <read_first>
    - `.planning/phases/05-outcomes-dashboard/05-VALIDATION.md` — §Per-Task Verification Map + §Wave 0 Requirements
    - `.planning/phases/05-outcomes-dashboard/05-RESEARCH.md` §Q4 (parity fixture — math CORRECTED 2026-04-19 per Voice-D2; avgRealizedDelta = 0.00333 via most-mature delta) + lines 896-933 (Validation Architecture + test commands)
    - `.planning/phases/05-outcomes-dashboard/05-PATTERNS.md` §7 (`outcomes.test.tsx` analogs), §9 (`outcomes-kpi.test.ts` analog), §11 (curves `route.test.ts` analog), §13 (schema live-DB smoke analog — now targets match_decisions)
    - `.planning/phases/05-outcomes-dashboard/05-UI-SPEC.md` §Copywriting Contract (literal strings the tests assert against) + §State Matrix (loading/error/empty/partial triggers)
    - `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` §Decisions D-01..D-21 (note D-02, D-12, D-15, D-20a-d, D-21 revised 2026-04-19)
    - `.planning/phases/05-outcomes-dashboard/VOICES-ACCEPTED.md` — D1 (widget consolidation), D2 (parity — Python pytest option a), D4 (regression test), D6 (zero-delta pill override), D9 (className-presence prefix), D11 (live-DB nested-join test)
    - `src/lib/bridge-outcome-label.test.ts` — header + clock-override pattern (lines 1-13) + per-case pattern (lines 14-30) to mirror
    - `src/app/api/bridge/outcome/route.test.ts` — test-setup + STATE hoisting + supabase/admin/ratelimit vi.mock shape (lines 17-130) + per-case pattern (lines 163-197)
    - `src/app/(dashboard)/allocations/widgets/positions/positions.test.tsx` — mock-data factory + WIDGET_PROPS pattern (lines 13-52)
    - `src/app/(dashboard)/allocations/widgets/performance/performance.test.tsx` — empty-state loop (lines 81-101) + barrel-export assertion (lines 192-208)
    - `src/__tests__/bridge-outcomes-rls.test.ts` — HAS_LIVE_DB gate + `advertiseLiveDbSkipReason` pattern (lines 1-38 + 505-508)
    - `analytics-service/services/feedback_engine.py` lines 156-166 — `_success_value` pure function; this is what Python parity test imports
    - `analytics-service/tests/test_feedback_engine.py` (if exists) — Python test conventions for pytest structure
  </read_first>
  <behavior>
    PURPOSE: Write failing tests BEFORE implementation (TDD RED phase). Every test MUST fail on first run — either because the imported module doesn't exist yet, or the assertion disagrees with current behavior. Do NOT skip, `.todo`, or `.skipIf` tests except where explicit HAS_LIVE_DB / HAS_PY_ENV gating matches the Phase 1 precedent.

    Wave 0 produces (A = new files, B = extensions).

    (A) `src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx` — NEW file. ~13 RED cases covering DASHBOARD-01..06. **VOICE-D1 NOTE:** the widget ships as a single file with inline sub-components — this test file mounts the full widget and finds sub-nodes via role/aria/text queries. There is NO per-sub-component isolation.
      - Describe block `"OutcomesWidget"`:
        - `"renders 3 timeline rows from 3 outcomes"` — mount with 3-outcome mock -> expect 3 body rows.
        - `"empty state: 0 outcomes -> literal copy 'Your Bridge outcomes will appear here after you act on one' + 'View Holdings' CTA"` — UI-SPEC §State Matrix verbatim.
        - `"loading state: outcomes=undefined -> 5 skeleton rows with aria-label='Loading outcomes data'"` — UI-SPEC §State 1.
        - `"error state: fetch error -> 'Could not load outcomes' + 'Try again' button"` — UI-SPEC §State 2.
        - `"Voice-D5 truncation: outcomes.length === 200 -> footer 'Showing most recent 200 — reach out if you need historical export' rendered"` — NEW case.
        - `"Voice-D5 no-truncation: outcomes.length < 200 -> footer NOT rendered"` — NEW case.
      - Describe block `"OutcomesWidget — KPI strip (inline KpiStrip)"`:
        - `"className presence check: labels render in DM Sans 11px uppercase tracking-wider (per DASHBOARD-02 className spec)"` — Voice-D9 prefix.
        - `"className presence check: values render in font-mono text-[13px] tabular-nums (per DASHBOARD-02 className spec)"` — Voice-D9 prefix.
        - `"className presence check: win-rate color >50% -> text/style #16A34A; <50% -> #DC2626; =null -> #1A1A2E"` — Voice-D9 prefix.
        - `"renders sub-label 'Avg realized delta: +2.3% · 3 pending' (DM Sans 12px muted — copy assertion)"` — Voice-D9: copy assertion preserved; className framing prefixed.
        - OPTIONAL (Voice-D9 upgrade): `"computed font-family of a KPI value includes 'geist'"` — `getComputedStyle(node).fontFamily.toLowerCase()` assertion on one representative KPI.
      - Describe block `"OutcomesWidget — Timeline (inline TimelineTable + TimelineRow)"`:
        - `"sort order is created_at DESC (newest first)"`.
        - `"4-state status pill: allocated-win / allocated-loss / allocated-pending / rejected-mandate_conflict"` — verbatim text.
        - `"Strategy name links to /strategies/[id] for both original and replacement columns (resolved from nested match_decision.original_strategy join)"` — expect `<a href="/strategies/{id}">`.
        - `"Best Delta cell renders em-dash '\u2014' on rejected rows"` (D-03).
      - Describe block `"OutcomesWidget — Expanded panel (inline ExpandedPanel)"`:
        - `"clicking caret fires fetch('/api/bridge/outcome/{id}/curves') exactly once"` — spy on `global.fetch`.
        - `"second click of same row does NOT refetch (cache hit)"`.
        - `"pending-window column shows 'Pending' pill + animate-pulse placeholder rectangle"` (D-10).
      - Describe block `"Barrel export"`:
        - `"outcomes-timeline key exists in WIDGET_COMPONENTS barrel"` — `await import(...)` + assert key present.

    Mock-data shape for `OutcomeRow` (per revised queries.ts type in W1-07) MUST include nested `match_decision: { original_strategy: { id, name } } | null` rather than top-level `original_strategy`:
    ```ts
    const outcome: OutcomeRow = {
      ...baseBridgeOutcome,
      match_decision_id: "md-uuid",
      replacement_strategy: { id: "s-repl", name: "Crypto Momentum LP" },
      match_decision: { original_strategy: { id: "s-orig", name: "Legacy Equity LP" } },
    };
    ```

    (A) `src/lib/outcomes-kpi.test.ts` — NEW file. 8 cases + parity (use fixed `const TODAY = "2026-04-17"`):
      1. `"empty outcomes -> { totalOutcomes: 0, winRate: null, avgRealizedDelta: null, pendingCount: 0 }"`
      2. `"single allocated win (delta_30d=0.04, percent=12) -> totalOutcomes=1, winRate=1.0, avgRealizedDelta=0.04, pendingCount=0"`
      3. `"single allocated loss (delta_30d=-0.03) -> winRate=0.0, avgRealizedDelta=-0.03"`
      4. `"mixed 3-win/1-loss/0-pending -> winRate=0.75, avgRealizedDelta=mean"`
      5. `"allocated pending (all deltas null) -> excluded from denominator; pendingCount=1, totalOutcomes counted"` (D-11, D-13)
      6. `"allocated <1% percent_allocated -> excluded from denominator (D-08 step 2)"`
      7. `"rejected rows -> excluded from win-rate denominator AND numerator; counted in totalOutcomes (D-13)"`
      8. `"parity fixture"` — `import fixture from "../../tests/fixtures/outcomes-kpi-parity.json"` then `expect(computeOutcomeKPIs(fixture.outcomes)).toEqual(fixture.expected)`.

    NOTE: `computeOutcomeKPIs` input is `Array<BridgeOutcome>` (unchanged shape per revision). Phase 4 math semantics do NOT change.

    (A) `tests/fixtures/outcomes-kpi-parity.json` — NEW file. Exact content (Voice-D2 math resolved: `avgRealizedDelta: 0.0033333333333333335` via most-mature delta — authoritative per direct read of `feedback_engine.py::_success_value`):

    ```json
    {
      "description": "Phase 5 D-21 cross-runtime parity fixture. Matches Phase 4 feedback_engine.py::_fetch_eligible_outcomes + _success_value filter rules. Mirror from Python when Phase 4 D-08 filters change (SAME PR required). Voice-D2 2026-04-19: avgRealizedDelta value is 0.0033... via most-mature delta (_success_value iterates delta_180d -> delta_90d -> delta_30d); RESEARCH.md Q4's earlier 0.02333 figure was wrong and has been corrected.",
      "today": "2026-04-19",
      "outcomes": [
        {"id":"o1","kind":"allocated","percent_allocated":10,"delta_30d":0.04,"delta_90d":null,"delta_180d":null,"rejection_reason":null,"allocated_at":"2025-10-01","estimated_delta_bps":null,"estimated_days":null,"needs_recompute":false,"created_at":"2025-10-01T00:00:00Z","note":null},
        {"id":"o2","kind":"allocated","percent_allocated":0.5,"delta_30d":0.05,"delta_90d":null,"delta_180d":null,"rejection_reason":null,"allocated_at":"2025-10-05","estimated_delta_bps":null,"estimated_days":null,"needs_recompute":false,"created_at":"2025-10-05T00:00:00Z","note":null},
        {"id":"o3","kind":"allocated","percent_allocated":15,"delta_30d":null,"delta_90d":null,"delta_180d":null,"rejection_reason":null,"allocated_at":"2025-10-10","estimated_delta_bps":null,"estimated_days":null,"needs_recompute":false,"created_at":"2025-10-10T00:00:00Z","note":null},
        {"id":"o4","kind":"rejected","percent_allocated":null,"delta_30d":null,"delta_90d":null,"delta_180d":null,"rejection_reason":"already_owned","allocated_at":null,"estimated_delta_bps":null,"estimated_days":null,"needs_recompute":false,"created_at":"2025-10-11T00:00:00Z","note":null},
        {"id":"o5","kind":"rejected","percent_allocated":null,"delta_30d":null,"delta_90d":null,"delta_180d":null,"rejection_reason":"mandate_conflict","allocated_at":null,"estimated_delta_bps":null,"estimated_days":null,"needs_recompute":false,"created_at":"2025-10-12T00:00:00Z","note":null},
        {"id":"o6","kind":"allocated","percent_allocated":5,"delta_30d":null,"delta_90d":0.12,"delta_180d":null,"rejection_reason":null,"allocated_at":"2025-06-01","estimated_delta_bps":null,"estimated_days":null,"needs_recompute":false,"created_at":"2025-06-01T00:00:00Z","note":null},
        {"id":"o7","kind":"allocated","percent_allocated":8,"delta_30d":-0.03,"delta_90d":-0.08,"delta_180d":-0.15,"rejection_reason":null,"allocated_at":"2025-04-01","estimated_delta_bps":null,"estimated_days":null,"needs_recompute":false,"created_at":"2025-04-01T00:00:00Z","note":null}
      ],
      "expected": {
        "totalOutcomes": 7,
        "winRate": 0.6666666666666666,
        "avgRealizedDelta": 0.0033333333333333335,
        "pendingCount": 1
      },
      "phase4_success_values": {"o1":1,"o6":1,"o7":0},
      "phase4_mature_survivors": ["o1","o6","o7"]
    }
    ```

    Fixture `outcomes` items intentionally omit `original_strategy_id` — `computeOutcomeKPIs` consumes the raw `BridgeOutcome` shape (no underperformer math needed for KPIs).

    Note on math: of the 4 allocated rows, o2 dropped by D-08 step 2 (percent<1.0), o3 dropped by D-03 (all-null deltas); survivors o1/o6/o7. Most-mature of each (D-12 revised): o1 = delta_30d = +0.04 (win), o6 = delta_90d = +0.12 (win), o7 = delta_180d = -0.15 (loss). winRate = 2/3 = 0.6666666666666666. avgRealizedDelta = (0.04 + 0.12 + (-0.15)) / 3 = 0.01 / 3 = 0.0033333333333333335. New fields `phase4_success_values` + `phase4_mature_survivors` are the Python parity harness's assertion targets.

    (A) `analytics-service/tests/test_outcomes_kpi_parity.py` — NEW file (Voice-D2 option a). Python pytest harness, HAS_PY_ENV-gated, asserts Phase 4 `_success_value` per-row values match the fixture's `phase4_success_values` map. Verbatim content:

    ```python
    """Phase 5 D-21 cross-runtime parity test (Voice-D2 option a).

    Asserts that Phase 4 `feedback_engine._success_value` produces per-row
    success values and most-mature deltas that match the TypeScript side's
    `tests/fixtures/outcomes-kpi-parity.json` expected payload. Running this
    test gated on HAS_PY_ENV=1 prevents drift between Phase 4 (Python) and
    Phase 5 (TypeScript) — any change to Phase 4 filter rules must update
    BOTH the fixture AND this test in the same PR.
    """
    import json
    import os
    import pathlib

    import pytest

    pytestmark = pytest.mark.skipif(
        os.environ.get("HAS_PY_ENV") != "1",
        reason="Python parity test gated on HAS_PY_ENV=1 (Phase 5 D-21 / Voice-D2 option a)",
    )


    REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
    FIXTURE_PATH = REPO_ROOT / "tests" / "fixtures" / "outcomes-kpi-parity.json"


    @pytest.fixture(scope="module")
    def fixture() -> dict:
        return json.loads(FIXTURE_PATH.read_text())


    def test_fixture_path_resolves(fixture: dict) -> None:
        """The TS-side fixture must be readable from the Python tree."""
        assert "outcomes" in fixture
        assert "expected" in fixture
        assert "phase4_success_values" in fixture


    def test_success_value_matches_per_row(fixture: dict) -> None:
        """feedback_engine._success_value returns 1 iff most-mature non-NULL delta > 0.

        The fixture's `phase4_success_values` map is the authoritative source
        of expected per-row success values. Any drift here means Phase 5
        dashboard math + Phase 4 scoring engine have diverged.
        """
        from services.feedback_engine import _success_value

        expected = fixture["phase4_success_values"]
        for outcome in fixture["outcomes"]:
            oid = outcome["id"]
            if oid not in expected:
                # Outcome didn't survive Phase 4 filters (e.g. rejected-already_owned
                # or allocated-pending-only) — not asserted here; see
                # test_mature_survivors for filter-level parity.
                continue
            assert _success_value(outcome) == expected[oid], (
                f"Row {oid}: _success_value disagrees with TS expected "
                f"({_success_value(outcome)} vs {expected[oid]})"
            )


    def test_mature_survivors_match(fixture: dict) -> None:
        """Rows that SHOULD pass D-08 + D-03 filters for Phase 4 must match
        the TS-side `phase4_mature_survivors` list.
        """
        expected_survivors = set(fixture["phase4_mature_survivors"])
        actual_survivors: set[str] = set()
        for outcome in fixture["outcomes"]:
            kind = outcome["kind"]
            if kind == "rejected":
                if outcome["rejection_reason"] == "already_owned":
                    continue
                actual_survivors.add(outcome["id"])
            elif kind == "allocated":
                if (outcome["percent_allocated"] or 0) < 1.0:
                    continue
                has_delta = any(
                    outcome.get(k) is not None
                    for k in ("delta_30d", "delta_90d", "delta_180d")
                )
                if not has_delta:
                    continue
                actual_survivors.add(outcome["id"])
        # NOTE: phase4_mature_survivors in the fixture lists ONLY allocated
        # survivors (the TS KPI denominator); rejected-non-already_owned
        # survive Phase 4 for attribution but are out of KPI denominator scope.
        # Restrict the actual set to allocated kind for parity.
        actual_allocated_survivors = {
            outcome["id"]
            for outcome in fixture["outcomes"]
            if outcome["id"] in actual_survivors and outcome["kind"] == "allocated"
        }
        assert actual_allocated_survivors == expected_survivors
    ```

    (A) `src/app/api/bridge/outcome/[id]/curves/route.test.ts` — NEW file. 7 RED cases (mirror `src/app/api/bridge/outcome/route.test.ts` mocking scaffold). Voice-D10 note: mock `bridgeOutcomeCurvesLimiter` alongside `userActionLimiter` in the vi.mock block:
      - TC1 `"401 when unauth: authUser=null -> status 401"` (set `STATE.authUser = null`)
      - TC2 `"404 when outcome id not owned: user-scoped bridge_outcomes SELECT returns null -> status 404 + { error: 'Not found' }"` (set bridge_outcomes mock to return `{ data: null }`)
      - TC3 `"400 when id missing: params.id empty -> status 400 + { error: 'id required' }"`
      - TC4 `"200 on happy path: returns { original: Array<{date,nav}>, replacement: Array<{date,nav}>, allocated_at }"` — mock outcome row with `strategy_id`, `match_decision_id`, `allocated_at='2026-01-01'`; mock admin match_decisions select returns `{ original_strategy_id: "s-orig" }`; mock admin returns_series returns both strategies; assert `body.original[0].nav === 100` and `body.replacement[0].nav === 100`.
      - TC5 `"200 windowing: returned dates are allocated_at..allocated_at+180d inclusive"`.
      - TC6 `"429 rate-limit: checkLimitResult={success:false,retryAfter:60} -> status 429 + Retry-After header = '60'"` — **Voice-D10: assert the checkLimit call-site uses `bridgeOutcomeCurvesLimiter`, not `userActionLimiter`.** Spy on `checkLimit`: `expect(checkLimit).toHaveBeenCalledWith(bridgeOutcomeCurvesLimiter, expect.any(String))`.
      - TC7 `"200 but empty curves when match_decision_id is NULL: original=[]"` — outcome row has `match_decision_id: null`; admin match_decisions select is SKIPPED; original series returned as `[]`; replacement series returned normally. Per D-03 em-dash convention in the UI for missing original.

    Emulate Next.js 16 async params: `await GET(req, { params: Promise.resolve({ id: OUTCOME_ID }) })`.

    (A) `src/__tests__/match-decisions-schema.test.ts` — NEW file. HAS_LIVE_DB-gated schema smoke for migration 064 (pre-065). Mirror the header from `src/__tests__/bridge-outcomes-rls.test.ts` lines 1-38:
      - Case 1 (HAS_LIVE_DB only): `"match_decisions.original_strategy_id column exists with data_type=uuid (post-064, before-065: is_nullable='YES')"` — admin `.from('information_schema.columns').select('column_name, is_nullable, data_type').eq('table_name', 'match_decisions').eq('column_name', 'original_strategy_id').single()` — assert `data.data_type === 'uuid'`. (is_nullable check is loose here because migration 065 flips it later in Wave 3.)
      - Case 2 (HAS_LIVE_DB only): `"match_decisions_allocator_original_strategy index exists"` — `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='match_decisions' AND indexname='match_decisions_allocator_original_strategy'` — expect 1 row.
      - Case 3 (HAS_LIVE_DB only): `"send_intro_with_decision function has 6 parameters"` — admin `.rpc('send_intro_with_decision', { /* 5 params (old signature) */ })` expects to FAIL with "too few parameters" or similar arity error; asserting the RPC signature was atomically replaced.
      - **Case 4 (HAS_LIVE_DB only — Voice-D3): `"FK on match_decisions.original_strategy_id uses ON DELETE RESTRICT"`** — admin `execute_sql` or chain against `information_schema.referential_constraints` joined with `information_schema.key_column_usage` to find the constraint rule for the column. SQL:
        ```sql
        SELECT rc.delete_rule
        FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = rc.constraint_name
        WHERE kcu.table_name = 'match_decisions'
          AND kcu.column_name = 'original_strategy_id';
        ```
        Expected result: `delete_rule = 'RESTRICT'`. Assertion: the single returned row has `delete_rule === "RESTRICT"`.
      - Always-run: `"advertises skip reason when live DB is unavailable"` calling `advertiseLiveDbSkipReason("match-decisions-schema")`.

    (A) `src/__tests__/outcomes-join-rls.test.ts` — **NEW file per Voice-D11**. HAS_LIVE_DB-gated. Mirrors Phase 1 precedent `src/__tests__/bridge-outcomes-rls.test.ts`. Body (Wave 1 turns RED -> GREEN after migration 064 + W1-07 land):
      1. Seed 2 allocators (`profiles` rows with is_test=true); record their ids as `ALLOC_1`, `ALLOC_2`.
      2. Seed 2 strategies (original + replacement), record as `S_ORIG_NAME`, `S_REPL_NAME` with ids `S_ORIG_ID`, `S_REPL_ID`.
      3. For each allocator, insert 1 `match_decisions` row with `strategy_id=S_REPL_ID`, `original_strategy_id=S_ORIG_ID`, `decision='sent_as_intro'` (via admin client bypassing RLS).
      4. For each allocator, insert 1 `bridge_outcomes` row (kind=allocated, percent_allocated=5, allocated_at=today-30d, delta_30d=0.05) with `match_decision_id` = that allocator's decision id (via admin client).
      5. Import and call `getMyAllocationDashboard(ALLOC_1)` — expect `payload.outcomes.length === 1`, expect `payload.outcomes[0].allocator_id === undefined` (not exposed — we only need the FK resolution to work).
      6. Assert `payload.outcomes[0].match_decision !== null` AND `payload.outcomes[0].match_decision.original_strategy.id === S_ORIG_ID` AND `payload.outcomes[0].match_decision.original_strategy.name === S_ORIG_NAME`.
      7. Assert `payload.outcomes[0].replacement_strategy.id === S_REPL_ID` AND `payload.outcomes[0].replacement_strategy.name === S_REPL_NAME`.
      8. Negative isolation: call `getMyAllocationDashboard(ALLOC_2)` — expect `payload.outcomes.length === 1` AND different outcome id than allocator 1's (cross-allocator leak-test).
      9. Cleanup: delete seeded rows in reverse-FK order (bridge_outcomes -> match_decisions -> strategies -> profiles) in an `afterAll` hook.
      Always-run: `"advertises skip reason when live DB is unavailable"`.

    (B) EXTEND `src/lib/bridge-outcome-label.test.ts` — append describe block `"deriveOutcomeStatusPill"` with 8 RED cases (4 allocated variants + 4 rejected). **Voice-D6 note:** case 4 is the zero-delta case that asserts `allocated-loss` (Phase-4 parity override of D-13):
      1. `"allocated-win: kind=allocated, percent=12, delta_180d=0.05 -> { state:'allocated-win', text:'Allocated 12% \u2014 win', tone:'positive' }"`
      2. `"allocated-loss: kind=allocated, percent=15, delta_180d=-0.03 -> { state:'allocated-loss', text:'Allocated 15% \u2014 loss', tone:'negative' }"`
      3. `"allocated-pending: kind=allocated, percent=8, all deltas null -> { state:'allocated-pending', text:'Allocated 8% \u2014 pending', tone:'neutral' }"`
      4. **`"allocated-loss on zero delta: delta_180d=0 -> state='allocated-loss' (Voice-D6 Phase-4 _success_value parity; strict > 0 for win INTENTIONALLY overrides Phase 1 D-13 neutral-on-zero for the status pill only)"`** — Voice-D6 regression gate.
      5. `"rejected-mandate_conflict: kind=rejected, rejection_reason='mandate_conflict' -> { state:'rejected', text:'Rejected \u2014 Mandate conflict', tone:'neutral' }"`
      6. `"rejected-already_owned: text='Rejected \u2014 Already owned'"`
      7. `"rejected with null reason: text='Rejected \u2014 Other'"`
      8. `"most-mature wins: delta_180d=0.05 overrides delta_30d=-0.10 -> allocated-win"` (D-12 revised)

    (B) EXTEND `src/lib/queries.my-allocation.test.ts` — append 5 RED cases under new describe `"getMyAllocationDashboard — outcomes top-level fan-out (Phase 5 D-15)"`:
      - `"TC outcomes-01: payload has top-level outcomes: Array<OutcomeRow> sorted created_at DESC"`
      - `"TC outcomes-02: each outcome carries replacement_strategy: {id,name} AND match_decision.original_strategy: {id,name} via nested FK embed"` — assert nested path exactly `outcomes[0].match_decision.original_strategy.name`.
      - `"TC outcomes-03: when match_decision_id is NULL, outcomes[0].match_decision === null (em-dash case for UI D-03)"`
      - `"TC outcomes-04: empty outcomes set -> payload.outcomes === [] (not null/undefined)"`
      - **`"TC outcomes-05: outcomes fan-out includes .eq('allocator_id', userId) on the admin chain (Voice-D4 regression gate)"`** — Extend `buildChain` in the test file to RECORD every `.eq(column, value)` call on each chain invocation. After the `getMyAllocationDashboard("user-1")` call, inspect the recorded chains and assert that the chain targeting the `bridge_outcomes` table with the `replacement_strategy` or `match_decision` embed had an `.eq("allocator_id", "user-1")` recorded. Implementation sketch: add a `chain.recorded_eqs: Array<{column, value}>` array in `buildChain`, push into it on each `.eq` call, then test body loops through all `chain.recorded_eqs` lists for the bridge_outcomes invocation(s) and asserts at least one has `{column: "allocator_id", value: "user-1"}`. Additionally: assert `.limit(200)` was called on the same chain (Voice-D5 gate).

    CONSTRAINT: Every test MUST fail on first run (Vitest suite). The Python parity test fails because the fixture doesn't yet exist when it's first added, and the `_success_value` import path is correct per `feedback_engine.py:156`.

    NOTE ON DELETIONS vs. prior pass:
    - NO extension to `src/app/api/bridge/outcome/route.test.ts` (that route is unchanged).
    - `match-decisions-schema.test.ts` REPLACES the prior `bridge-outcomes-schema.test.ts` (different target table) and now includes Voice-D3 RESTRICT assertion.
    - Per-sub-component `outcomes.test.tsx` organization flattened: all sub-component cases live under the single `"OutcomesWidget"` umbrella (with nested describe blocks for KPI / Timeline / Expanded) because Voice-D1 collapses them into inline functions inside one file.
  </behavior>
  <action>
    Create/extend 9 test files per §behavior. For the golden fixture, paste the JSON verbatim (note the corrected `avgRealizedDelta: 0.0033333333333333335` + new `phase4_success_values` + `phase4_mature_survivors` fields). For the extended test files (label/queries), open each, find the bottom-of-file insertion point, APPEND a new `describe(...)` block — do NOT modify existing cases. For `queries.my-allocation.test.ts`, ALSO modify the shared `buildChain` helper to add `recorded_eqs` tracking (non-breaking — no existing test depends on its absence). Use `import { describe, it, expect, vi } from "vitest"` consistently. For `outcomes.test.tsx`, use `@testing-library/react` + `vi.spyOn(global, "fetch")` for the ExpandedPanel fetch cases.

    After writing, run the quick-command (verify block). Expect EXIT CODE 1 with output showing each new test either failing to import its module under test OR asserting against not-yet-real behavior. Commit with message: `test(05-01): Wave 0 RED scaffolds — outcomes widget + KPI + curves + match_decisions schema + status-pill + queries regression + golden fixture + Python parity harness + outcomes-join-rls (Voice-D1/D2/D3/D4/D5/D6/D9/D10/D11)`.
  </action>
  <verify>
    <automated>npx vitest run src/app/\(dashboard\)/allocations/widgets/outcomes/outcomes.test.tsx src/lib/outcomes-kpi.test.ts src/app/api/bridge/outcome/\[id\]/curves/route.test.ts src/__tests__/match-decisions-schema.test.ts src/__tests__/outcomes-join-rls.test.ts src/lib/bridge-outcome-label.test.ts src/lib/queries.my-allocation.test.ts 2>&1 | tail -60 ; test -f tests/fixtures/outcomes-kpi-parity.json && echo "FIXTURE_OK" ; test -f analytics-service/tests/test_outcomes_kpi_parity.py && echo "PY_HARNESS_OK"</automated>
  </verify>
  <done>
    All 9 test files exist (5 new incl. Python harness, 2 extended, 1 new schema test, 1 new live-DB nested-join test). `npx vitest run ...` exit code is 1 (RED as expected). `node -e "JSON.parse(require('fs').readFileSync('tests/fixtures/outcomes-kpi-parity.json'))"` exits 0. Fixture contains `"avgRealizedDelta": 0.0033333333333333335` + `"phase4_success_values"` + `"phase4_mature_survivors"`. Python parity file exists. Commit `test(05-01): Wave 0 RED scaffolds` lands.
  </done>
</task>

<task type="auto" id="5-01-W0-02">
  <name>Task 5-01-W0-02: Write migration 064 (NULL-allowed + ON DELETE RESTRICT) + migration 065 (NOT NULL follow-up) — neither yet applied</name>
  <files>supabase/migrations/064_match_decisions_original_strategy.sql, supabase/migrations/065_match_decisions_original_strategy_notnull.sql</files>
  <read_first>
    - `supabase/migrations/011_perfect_match.sql` — existing `match_decisions` DDL (lines 133-159) + `send_intro_with_decision` function body (lines 167-224) + REVOKE/GRANT pattern (lines 226-227)
    - `supabase/migrations/059_bridge_outcomes.sql` — preamble, COMMENT convention (lines 107-112), self-verifying DO block (lines 308-461), **line 111 A6 precedent comment cited in Voice-D3 for the RESTRICT decision**
    - `supabase/migrations/063_feedback_delta_enqueue.sql` — most recent migration for style + DO block RAISE EXCEPTION assertions
    - `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` D-20a-b (revised — Voice-C3 NULL-first + Voice-D3 RESTRICT)
    - `.planning/phases/05-outcomes-dashboard/05-PATTERNS.md` §1 (migration analog + delta — revised)
    - `.planning/phases/05-outcomes-dashboard/05-VALIDATION.md` rows `5-01-W1-02` + `5-01-W3-02`
    - `.planning/phases/05-outcomes-dashboard/VOICES-ACCEPTED.md` C3 + D3
  </read_first>
  <action>
    Create `supabase/migrations/064_match_decisions_original_strategy.sql` exactly as follows. CRITICAL: migration number is **064** — 061/062/063 are all taken. Voice-C3 revision: column ships as `UUID NULL`. Voice-D3 revision: FK uses `ON DELETE RESTRICT` with inline comment citing migration 059 A6 precedent. The empty-table pre-apply check from the prior pass has been REMOVED; presence of the RESTRICT clause is verified via `information_schema.referential_constraints` in `match-decisions-schema.test.ts` Case 4.

    The migration MUST do 3 things in a SINGLE transaction:
    1. ALTER TABLE match_decisions ADD COLUMN original_strategy_id UUID NULL REFERENCES strategies(id) ON DELETE RESTRICT
    2. CREATE INDEX on (allocator_id, original_strategy_id)
    3. CREATE OR REPLACE FUNCTION send_intro_with_decision with the new p_original_strategy_id parameter (breaking signature change — fail-loud on old callers) + DROP old 5-arg overload

    ```sql
    -- Migration 064: match_decisions.original_strategy_id
    -- Sprint 8 Phase 5 (Outcomes Dashboard) — D-20a schema shape lock (REVISED).
    --
    -- Voice-C3 (2026-04-19): ships as NULL-allowed; follow-up migration 065
    -- tightens to NOT NULL after admin UI has been confirmed shipping values.
    -- This removes the empty-table precondition from prior passes and is
    -- safe for branch DBs that may acquire rows before migration runs.
    --
    -- Voice-D3 (2026-04-19): FK uses ON DELETE RESTRICT. Precedent — migration
    -- 059 A6 comment (line 111) shows bridge_outcomes.match_decision_id uses
    -- ON DELETE SET NULL to preserve outcome history. Here we choose RESTRICT
    -- because deleting a still-referenced underperformer strategy should be
    -- BLOCKED (not silently erased or cascaded). CASCADE would destroy
    -- decision attribution; SET NULL would break the D-20a invariant.
    --
    -- Adds the underperformer-naming column that every "sent_as_intro" decision
    -- must carry, captured at intro-send time via send_intro_with_decision RPC.
    -- The invariant (D-20a, revised): "every match_decisions row from intro-send
    -- names the underperformer it replaced" — enforced via migration 065's
    -- NOT NULL tightening in Wave 3 (after admin UI ships values).
    --
    -- Placement rationale: the underperformer identity is KNOWN at intro-send
    -- time (admin side — SendIntroPanel / send-intro route). It is NOT known
    -- at outcome-record time (allocator side). Placing the column on
    -- bridge_outcomes would force the allocator UI to discover the
    -- underperformer at record time, which it cannot. Correct placement is
    -- on match_decisions, captured by send_intro_with_decision().
    --
    -- Consumers:
    --   - POST /api/admin/match/send-intro -- accepts original_strategy_id in body
    --   - getMyAllocationDashboard -- reads via bridge_outcomes.match_decision_id
    --     -> match_decisions -> strategies (id, name) nested embed
    --   - Phase 4 feedback_engine (future hook) -- may attribute "how did X
    --     perform as a replacement for Y across all allocators"; index on
    --     (allocator_id, original_strategy_id) supports this query path.

    BEGIN;

    ------------------------------------------------------------------
    -- 1. Add original_strategy_id column (NULL-allowed per Voice-C3,
    --    FK uses ON DELETE RESTRICT per Voice-D3 citing migration 059 A6 precedent)
    ------------------------------------------------------------------
    -- ON DELETE RESTRICT per migration 059 A6 precedent (match_decision_id FK
    -- on bridge_outcomes uses SET NULL to preserve outcome history; here
    -- RESTRICT because deleting a still-referenced underperformer should be
    -- blocked, not silently erased — Voice-D3 2026-04-19).
    ALTER TABLE match_decisions
      ADD COLUMN original_strategy_id UUID
        REFERENCES strategies(id) ON DELETE RESTRICT;

    COMMENT ON COLUMN match_decisions.original_strategy_id IS
      'FK to strategies(id) naming the underperformer that this decision''s strategy_id (replacement) was introduced for. Ships as NULL-allowed in migration 064 (Voice-C3); tightened to NOT NULL in migration 065 after admin UI has shipped values. FK uses ON DELETE RESTRICT (Voice-D3, migration 059 A6 precedent). Captured at intro-send time via send_intro_with_decision RPC. See .planning/phases/05-outcomes-dashboard/05-CONTEXT.md D-20a (revised).';

    ------------------------------------------------------------------
    -- 2. Index for Phase 4 feedback-engine attribution path
    ------------------------------------------------------------------
    CREATE INDEX IF NOT EXISTS match_decisions_allocator_original_strategy
      ON match_decisions (allocator_id, original_strategy_id);

    ------------------------------------------------------------------
    -- 3. CREATE OR REPLACE send_intro_with_decision RPC
    --    with the new p_original_strategy_id parameter (position 3).
    --
    --    Signature change is BREAKING: old callers will hit
    --    "too few arguments" — this is the DESIRED fail-loud behavior
    --    so the admin route + this RPC agree atomically.
    ------------------------------------------------------------------
    CREATE OR REPLACE FUNCTION send_intro_with_decision(
      p_allocator_id UUID,
      p_strategy_id UUID,
      p_original_strategy_id UUID,   -- NEW: position 3 for call-site clarity
      p_candidate_id UUID,
      p_admin_note TEXT,
      p_decided_by UUID
    ) RETURNS TABLE (
      contact_request_id UUID,
      match_decision_id UUID,
      was_already_sent BOOLEAN
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
      v_existing_cr_id UUID;
      v_new_cr_id UUID;
      v_decision_id UUID;
      v_was_already_sent BOOLEAN := false;
    BEGIN
      -- Check if contact_requests already has a row for this pair.
      -- (Idempotent match: allocator_id + strategy_id + "sent_as_intro".)
      SELECT id INTO v_existing_cr_id
      FROM contact_requests
      WHERE allocator_id = p_allocator_id AND strategy_id = p_strategy_id;

      IF v_existing_cr_id IS NOT NULL THEN
        v_was_already_sent := true;
        v_new_cr_id := v_existing_cr_id;
      ELSE
        INSERT INTO contact_requests (allocator_id, strategy_id, status, message)
        VALUES (p_allocator_id, p_strategy_id, 'pending', p_admin_note)
        RETURNING id INTO v_new_cr_id;
      END IF;

      -- Insert decision (idempotent via uniq_match_dec_sent_per_pair).
      -- NEW: persist p_original_strategy_id into the new column (NULL-allowed
      -- at this migration level; migration 065 tightens to NOT NULL).
      INSERT INTO match_decisions (
        allocator_id, strategy_id, original_strategy_id, candidate_id, decision,
        founder_note, contact_request_id, decided_by
      ) VALUES (
        p_allocator_id, p_strategy_id, p_original_strategy_id, p_candidate_id, 'sent_as_intro',
        p_admin_note, v_new_cr_id, p_decided_by
      )
      ON CONFLICT (allocator_id, strategy_id) WHERE decision = 'sent_as_intro' DO NOTHING
      RETURNING id INTO v_decision_id;

      -- If we hit ON CONFLICT, fetch the existing decision id.
      IF v_decision_id IS NULL THEN
        SELECT id INTO v_decision_id
        FROM match_decisions
        WHERE allocator_id = p_allocator_id
          AND strategy_id = p_strategy_id
          AND decision = 'sent_as_intro';
      END IF;

      RETURN QUERY SELECT v_new_cr_id, v_decision_id, v_was_already_sent;
    END;
    $$;

    -- Re-apply REVOKE + GRANT to the replaced function (Postgres does not
    -- preserve these across CREATE OR REPLACE for changed signatures).
    REVOKE ALL ON FUNCTION send_intro_with_decision(UUID, UUID, UUID, UUID, TEXT, UUID) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION send_intro_with_decision(UUID, UUID, UUID, UUID, TEXT, UUID) TO authenticated;

    -- Drop the old 5-arg overload so callers using stale signatures fail loud.
    -- The old function was (UUID, UUID, UUID, TEXT, UUID) = (alloc, strat,
    -- candidate, note, decided_by). CREATE OR REPLACE with a different
    -- argument list creates a NEW overload rather than replacing — we must
    -- drop the old explicitly.
    DROP FUNCTION IF EXISTS send_intro_with_decision(UUID, UUID, UUID, TEXT, UUID);

    ------------------------------------------------------------------
    -- 4. Self-verifying DO block
    ------------------------------------------------------------------
    DO $$
    BEGIN
      -- Column exists + UUID (is_nullable='YES' at this migration level per Voice-C3)
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'match_decisions'
           AND column_name = 'original_strategy_id'
           AND data_type = 'uuid'
      ) THEN
        RAISE EXCEPTION 'Migration 064 failed: match_decisions.original_strategy_id missing or not UUID';
      END IF;

      -- FK constraint exists and uses ON DELETE RESTRICT (Voice-D3)
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.referential_constraints rc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_name = rc.constraint_name
         WHERE kcu.table_name = 'match_decisions'
           AND kcu.column_name = 'original_strategy_id'
           AND rc.delete_rule = 'RESTRICT'
      ) THEN
        RAISE EXCEPTION 'Migration 064 failed: FK on match_decisions.original_strategy_id must use ON DELETE RESTRICT (Voice-D3)';
      END IF;

      -- Index exists
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename = 'match_decisions'
           AND indexname = 'match_decisions_allocator_original_strategy'
      ) THEN
        RAISE EXCEPTION 'Migration 064 failed: match_decisions_allocator_original_strategy index missing';
      END IF;

      -- New 6-arg RPC exists
      IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'send_intro_with_decision'
           AND p.pronargs = 6
      ) THEN
        RAISE EXCEPTION 'Migration 064 failed: send_intro_with_decision 6-arg overload missing';
      END IF;

      -- Old 5-arg RPC was dropped
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'send_intro_with_decision'
           AND p.pronargs = 5
      ) THEN
        RAISE EXCEPTION 'Migration 064 failed: old 5-arg send_intro_with_decision still exists (fail-loud guarantee violated)';
      END IF;

      RAISE NOTICE 'Migration 064: match_decisions.original_strategy_id (NULL, RESTRICT) + updated RPC installed and verified.';
    END
    $$;

    COMMIT;
    ```

    Create `supabase/migrations/065_match_decisions_original_strategy_notnull.sql` — this is applied in Wave 3 (task W3-02), AFTER admin UI has been shipped and is confirmed populating values. Voice-C3.

    ```sql
    -- Migration 065: tighten match_decisions.original_strategy_id to NOT NULL
    -- Sprint 8 Phase 5 (Outcomes Dashboard) — Voice-C3 follow-up (2026-04-19).
    --
    -- Migration 064 added the column as NULL-allowed. This migration tightens
    -- to NOT NULL once the admin UI has been confirmed shipping values
    -- (see 5-01-W1-04 + 5-01-W3-02). The DO-block guard below verifies no
    -- existing row violates the NOT NULL invariant BEFORE the ALTER runs;
    -- RAISE EXCEPTION aborts the migration if any NULL row exists.

    BEGIN;

    ------------------------------------------------------------------
    -- 1. Pre-tighten guard: verify no existing NULL rows.
    ------------------------------------------------------------------
    DO $$
    DECLARE
      v_null_count INTEGER;
    BEGIN
      SELECT COUNT(*) INTO v_null_count
      FROM match_decisions
      WHERE original_strategy_id IS NULL;

      IF v_null_count > 0 THEN
        RAISE EXCEPTION 'Migration 065 aborted: % match_decisions rows have NULL original_strategy_id. Resolve before tightening to NOT NULL (admin UI may not yet be deployed, OR legacy rows exist).', v_null_count;
      END IF;

      RAISE NOTICE 'Migration 065: zero NULL rows confirmed — proceeding with NOT NULL tightening.';
    END
    $$;

    ------------------------------------------------------------------
    -- 2. Tighten to NOT NULL.
    ------------------------------------------------------------------
    ALTER TABLE match_decisions
      ALTER COLUMN original_strategy_id SET NOT NULL;

    ------------------------------------------------------------------
    -- 3. Post-tighten verification.
    ------------------------------------------------------------------
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'match_decisions'
           AND column_name = 'original_strategy_id'
           AND is_nullable = 'NO'
      ) THEN
        RAISE EXCEPTION 'Migration 065 failed: match_decisions.original_strategy_id still nullable';
      END IF;

      RAISE NOTICE 'Migration 065: match_decisions.original_strategy_id tightened to NOT NULL.';
    END
    $$;

    COMMIT;
    ```

    Do NOT apply either yet. W1-02 applies 064; W3-02 applies 065. Commit `feat(05-01): supabase/migrations/064_match_decisions_original_strategy.sql (NULL, ON DELETE RESTRICT) + supabase/migrations/065_match_decisions_original_strategy_notnull.sql (NOT NULL follow-up) — D-20a-b revised, Voice-C3, Voice-D3`.
  </action>
  <verify>
    <automated>test -f supabase/migrations/064_match_decisions_original_strategy.sql && test -f supabase/migrations/065_match_decisions_original_strategy_notnull.sql && grep -c "ADD COLUMN original_strategy_id UUID$" supabase/migrations/064_match_decisions_original_strategy.sql ; grep -c "ON DELETE RESTRICT" supabase/migrations/064_match_decisions_original_strategy.sql ; grep -c "match_decisions_allocator_original_strategy" supabase/migrations/064_match_decisions_original_strategy.sql ; grep -c "p_original_strategy_id" supabase/migrations/064_match_decisions_original_strategy.sql ; grep -c "DROP FUNCTION IF EXISTS send_intro_with_decision" supabase/migrations/064_match_decisions_original_strategy.sql ; grep -c "SET NOT NULL" supabase/migrations/065_match_decisions_original_strategy_notnull.sql ; grep -c "v_null_count" supabase/migrations/065_match_decisions_original_strategy_notnull.sql</automated>
  </verify>
  <done>
    Both migration files exist. Migration 064: grep shows ≥1 match for `ON DELETE RESTRICT`, `match_decisions_allocator_original_strategy`, `p_original_strategy_id`, and `DROP FUNCTION IF EXISTS send_intro_with_decision`. DO block contains assertions against `delete_rule = 'RESTRICT'` (Voice-D3) + 6-arg overload + old 5-arg dropped. Migration 065: grep shows `SET NOT NULL` + `v_null_count` guard. Commit landed.
  </done>
</task>

<task type="auto" id="5-01-W0-03">
  <name>Task 5-01-W0-03: Rate-limit keying investigation + add bridgeOutcomeCurvesLimiter export (Voice-D10)</name>
  <files>src/lib/ratelimit.ts</files>
  <read_first>
    - `src/lib/ratelimit.ts` — entire file (lines 1-165); focus on `makeLimiter` (lines 35-46) + existing limiter exports (lines 48-73) + `checkLimit` (lines 83-101)
    - `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` D-16
    - `.planning/phases/05-outcomes-dashboard/VOICES-ACCEPTED.md` D10
    - `@upstash/ratelimit` package docs (via Context7 if available — `resolve-library-id "upstash ratelimit"` then `query-docs` for sliding-window budget keying semantics)
  </read_first>
  <behavior>
    INVESTIGATION: read `src/lib/ratelimit.ts`. The current Upstash `Ratelimit` SDK keys its budget bucket by the `identifier` string passed to `limiter.limit(identifier)` WITHIN A GIVEN Ratelimit INSTANCE. Each call to `makeLimiter()` creates a DISTINCT Ratelimit instance with its own independent budget — the shared redis `prefix: "quantalyze"` ensures the keys don't collide across instances. This means:

    - `userActionLimiter` (5/60s) and a new `bridgeOutcomeCurvesLimiter` (60/60s) are budget-ISOLATED from each other at the instance level.
    - Within each instance, the identifier suffix (e.g., `"bridge_outcome_curves:{userId}"` vs `"gdpr_export:{userId}"`) further scopes per-user.

    OUTCOME: since sharing `userActionLimiter` (5/min) with POST /api/bridge/outcome would BURN the same user-level 5/min budget under that instance, and since 5/min is too low for curves (widget may fire ~60 expansions per exploration session), add a NEW DEDICATED LIMITER EXPORT:

    ```typescript
    // 60/minute per authenticated user — Phase 5 curves endpoint (Voice-D10).
    // Widget expand-row triggers 1 fetch per (outcomeId, windowId) combo; ~60
    // expansions per exploration session is realistic. Kept distinct from
    // userActionLimiter (5/min sensitive POSTs) so curve-exploration does not
    // burn budget reserved for attestation / deletion / GDPR actions.
    export const bridgeOutcomeCurvesLimiter = makeLimiter(60, "60 s");
    ```

    Document the outcome in the `<read_first>` block of the curves-route task (W1-08) and in SUMMARY.md at phase gate.
  </behavior>
  <action>
    Edit `src/lib/ratelimit.ts`. Append the new limiter export immediately after the `exportLimiter` declaration (around line 73), before the `CheckLimitResult` type (line 75):

    ```typescript
    // 60/minute per authenticated user — Phase 5 curves endpoint (Voice-D10,
    // 2026-04-19). Widget expand-row triggers 1 fetch per
    // (outcomeId, windowId) combo; ~60 expansions per exploration session
    // is realistic. Kept distinct from userActionLimiter (5/min sensitive
    // POSTs) so curve-exploration does not burn budget reserved for
    // attestation / deletion / GDPR actions. See
    // .planning/phases/05-outcomes-dashboard/VOICES-ACCEPTED.md D10.
    export const bridgeOutcomeCurvesLimiter = makeLimiter(60, "60 s");
    ```

    Run `npm run typecheck` — must exit 0. Commit `feat(05-01): src/lib/ratelimit.ts — add bridgeOutcomeCurvesLimiter (Voice-D10)`.
  </action>
  <verify>
    <automated>grep -c "bridgeOutcomeCurvesLimiter" src/lib/ratelimit.ts && grep -c "makeLimiter(60" src/lib/ratelimit.ts && npm run typecheck 2>&1 | tail -10</automated>
  </verify>
  <done>
    `bridgeOutcomeCurvesLimiter` exported. `makeLimiter(60, "60 s")` present. `npm run typecheck` exits 0.
  </done>
</task>

<!-- ======================== WAVE 1 — DECISION → SCHEMA → RPC → ADMIN → READ-SIDE ======================== -->

<task type="checkpoint:decision" gate="blocking" id="5-01-W1-01">
  <name>Task 5-01-W1-01 [BLOCKING decision, REORDERED PER VOICE-C2 — runs FIRST]: Resolve underperformer-source for admin SendIntroPanel (NO invented fallback)</name>
  <what-built>Wave 0 wrote failing tests that assert `POST /api/admin/match/send-intro` accepts `original_strategy_id` and `SendIntroPanel` passes it in the body. Migration 064 has NOT yet been applied — application is conditional on THIS checkpoint resolving to Option A or B.</what-built>
  <decision>Select the v1 source for `original_strategy_id` that SendIntroPanel will include in its send-intro POST body. If Option C (defer) is chosen, migration 064 is NEVER applied and Phase 5 halts here — no rollback needed (Voice-C2 intent).</decision>
  <context>
    Verified 2026-04-19: `SendIntroPanel` does NOT currently carry an underperformer id in state. The admin match queue flow (`AllocatorMatchQueue.tsx` -> `SendIntroPanel.tsx` props) receives a `CandidateRow` from `match_candidates`, which is a scoring-engine output for a REPLACEMENT strategy. There is no explicit "underperformer this is replacing" concept in the admin match queue — the admin is saying "here's a strategy I recommend to allocator X", not "replace Y with X".

    Grep evidence (reproducible):
    ```
    $ grep -rn "underperformer" src/components/admin/
    (zero matches)
    $ grep -rn "underperformer_strategy_id" src/
    src/lib/analytics-client.ts  (allocator-side ReplacementPanel flow — different code path)
    src/app/api/bridge/route.ts  (allocator-side /api/bridge route — takes it as INPUT)
    src/components/portfolio/ReplacementPanel.tsx  (allocator-side — not admin)
    ```

    The allocator's `/api/bridge` -> `ReplacementPanel` flow DOES know the underperformer (it's the input), but that is an allocator-self-serve path with NO admin intervention. The admin match queue (`/admin/match/[allocator_id]` -> `SendIntroPanel`) is a separate, non-portfolio-aware path.

    Voice-C2 sequencing: this decision runs BEFORE migration apply. If Option C is chosen, no DDL hits the DB — no rollback concerns.

    CRITICAL RULE (revision): NO `originalStrategyId = strategyId` tautology. That would make Original == Replacement and collapse the two-series sparkline to a single line drawn over itself, defeating DASHBOARD-03 + DASHBOARD-04.
  </context>
  <options>
    <option id="option-a">
      <name>Option A: Add a holdings dropdown to SendIntroPanel (admin picks)</name>
      <pros>
        - Semantically honest — admin explicitly names the underperformer at compose time.
        - Zero invention — the id is a real user choice.
        - Unblocks Phase 5 widget with a fully meaningful Original column.
        - Data path: GET allocator's current holdings (`portfolio_strategies`) on panel open, present as select; admin picks one before Send.
        - Matches D-20c intent ("if that prop doesn't exist, add it" — the "prop" here is the admin's explicit choice via UI).
      </pros>
      <cons>
        - Requires a new fetch in SendIntroPanel (`GET /api/admin/allocators/[id]/holdings` or equivalent). Small addition.
        - Adds UI complexity to the admin send-intro flow (one new dropdown).
        - If allocator has no current holdings, the dropdown is empty and admin cannot proceed — would need a "standalone intro" escape hatch (radio: "This is a standalone recommendation" that still requires picking a placeholder strategy from the allocator's sent_as_intro history).
      </cons>
      <effort>~2-3 files touched in admin layer (SendIntroPanel + possibly a new GET route + styled select component)</effort>
    </option>
    <option id="option-b">
      <name>Option B: Admin picks from all strategies via autocomplete</name>
      <pros>
        - Does not require portfolio-aware fetch — admin picks from all strategies.
        - Simpler backend wiring (all strategies are already in a table admin can search).
      </pros>
      <cons>
        - Less meaningful than Option A — admin might pick a random non-held strategy, defeating the "replaces what" semantic.
        - Still requires UI work in SendIntroPanel.
        - Weaker data invariant — original_strategy_id may not be something the allocator ever held.
      </cons>
      <effort>~1-2 files touched (SendIntroPanel + existing strategies search endpoint)</effort>
    </option>
    <option id="option-c">
      <name>Option C: Defer Phase 5 until the admin flow natively carries underperformer context</name>
      <pros>
        - No UI invention. Waits for the data model to support the requirement honestly.
        - Keeps Phase 5 clean when an eventual admin-side bridge flow (portfolio-aware candidate recommendation) ships.
        - **No migration rollback needed per Voice-C2** — migration 064 was NOT applied yet because this checkpoint runs BEFORE W1-02 (apply).
      </pros>
      <cons>
        - Ships Phase 5 with Original column empty / em-dash for all rows — DASHBOARD-03 + DASHBOARD-04 requirements not fully met.
        - Breaks user's commitment to ship outcomes dashboard this sprint.
        - Wave 0 test scaffolds + migration 064 / 065 files remain in the tree but unused until a future re-plan.
      </cons>
      <effort>Zero — halt execution; no DB changes were made.</effort>
    </option>
  </options>
  <resume-signal>Select: option-a, option-b, or option-c. If option-a or option-b: executor proceeds to W1-02 (apply migration 064). If option-c: execution HALTS here — no subsequent W1-* or later tasks run. User restarts Phase 5 planning when admin-side bridge flow lands.</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking" id="5-01-W1-02">
  <name>Task 5-01-W1-02 [BLOCKING, REORDERED PER VOICE-C2 — runs SECOND, conditional]: Apply migration 064 via supabase db push (or Supabase MCP) — only after W1-01 resolves to Option A or B</name>
  <what-built>Migration file `supabase/migrations/064_match_decisions_original_strategy.sql` was created in W0-02 (NULL-allowed, ON DELETE RESTRICT per Voice-C3 + D3) and is ready for application. W1-01 decision was Option A or B — user authorized proceeding.</what-built>
  <how-to-verify>
    The executor MUST apply migration 064 to the live Supabase project BEFORE any code depends on the new column or the new RPC signature. Follow Phase 4 precedent exactly (see STATE.md 2026-04-19 entries).

    **Voice-C2 precondition check:** confirm W1-01 resolved to Option A or B. If the decision was Option C, DO NOT proceed — Phase 5 halts. No migration apply.

    **Voice-C3 revision:** the migration ships NULL-allowed — there is NO empty-table pre-check needed. Migration 064 is safe on any match_decisions table state (empty or populated). The separate follow-up migration 065 (W3-02) tightens to NOT NULL with its own guard.

    APPLY PATH:

    PREFERRED PATH (non-interactive): Run `supabase db push` from the repo root. If `SUPABASE_ACCESS_TOKEN` env var is not set and the CLI prompts for auth, export it first: `export SUPABASE_ACCESS_TOKEN=<user supplies>`. Expected stdout: `"Applying migration 064_match_decisions_original_strategy.sql..."` followed by `"Finished supabase db push"`.

    ALTERNATE PATH (if `supabase db push` is unavailable OR prompts in a non-TTY environment): Use Supabase MCP `mcp__supabase__apply_migration` with:
      - `project_id`: `khslejtfbuezsmvmtsdn` (per STATE.md "Migration 063 applied to khslejtfbuezsmvmtsdn via Supabase MCP")
      - `name`: `match_decisions_original_strategy`
      - `query`: paste the entire SQL content EXCEPT the outer `BEGIN;` and `COMMIT;` lines (MCP manages its own transaction — Phase 4 precedent).

    POST-APPLY RECONCILIATION (only if MCP path was used): the MCP assigns a timestamp version (`20260419...`). Reconcile back to file-prefix `064`:
      ```sql
      UPDATE supabase_migrations.schema_migrations
         SET version = '064'
       WHERE name = 'match_decisions_original_strategy'
         AND version LIKE '20260%';
      ```

    Verify success by running the schema smoke test: `npx vitest run src/__tests__/match-decisions-schema.test.ts` — all HAS_LIVE_DB-gated cases pass (if `SUPABASE_SERVICE_ROLE_KEY` is exported locally) INCLUDING Case 4 (Voice-D3 RESTRICT assertion) and the always-run case advertises the skip reason.

    If RAISE EXCEPTION fires in the DO block, DO NOT proceed — debug + re-apply.

    Type `approved` once migration is confirmed applied AND the old 5-arg RPC is confirmed DROPPED AND Case 4 (RESTRICT) passes.
  </how-to-verify>
  <resume-signal>Type "approved" once migration 064 is live, schema smoke test passes INCLUDING Voice-D3 RESTRICT case (Case 4), old 5-arg RPC is confirmed dropped.</resume-signal>
</task>

<task type="auto" tdd="true" id="5-01-W1-03">
  <name>Task 5-01-W1-03: Extend POST /api/admin/match/send-intro to accept + pass original_strategy_id</name>
  <files>src/app/api/admin/match/send-intro/route.ts</files>
  <read_first>
    - `src/app/api/admin/match/send-intro/route.ts` entire file (current POST handler + validation style lines 44-51 + RPC call lines 54-61)
    - `supabase/migrations/064_match_decisions_original_strategy.sql` (applied at W1-02) — exact RPC signature
    - `supabase/migrations/011_perfect_match.sql` lines 167-227 — old RPC signature + REVOKE/GRANT
    - `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` D-20b (revised)
  </read_first>
  <behavior>
    Extend the admin send-intro route to accept `original_strategy_id` in the JSON body and forward it as `p_original_strategy_id` to the RPC. Validation style MUST match the existing pattern in this route (`typeof body.X === "string"` with error message `"X is required"`), NOT the Zod style used by other routes.
  </behavior>
  <action>
    Three edits to `src/app/api/admin/match/send-intro/route.ts`:

    (1) Extend the `body` type annotation (lines 32-37):
    ```typescript
    let body: {
      allocator_id?: string;
      strategy_id?: string;
      original_strategy_id?: string;  // NEW (D-20b revised)
      candidate_id?: string | null;
      admin_note?: string;
    };
    ```

    (2) Add validation block AFTER the `strategy_id` check (after line 49, before `admin_note` check):
    ```typescript
    if (!body.original_strategy_id || typeof body.original_strategy_id !== "string") {
      return NextResponse.json({ error: "original_strategy_id is required" }, { status: 400 });
    }
    ```

    (3) Extend the RPC call parameters (lines 55-61). Note position 3 MUST match the migration's `p_original_strategy_id` parameter position:
    ```typescript
    const { data, error } = await admin.rpc("send_intro_with_decision", {
      p_allocator_id: body.allocator_id,
      p_strategy_id: body.strategy_id,
      p_original_strategy_id: body.original_strategy_id,   // NEW — position 3
      p_candidate_id: body.candidate_id ?? null,
      p_admin_note: body.admin_note,
      p_decided_by: user!.id,
    });
    ```

    Run typecheck + any existing admin send-intro route tests. If a test file for this route exists (`src/app/api/admin/match/send-intro/route.test.ts`), update existing test cases' makeRequest bodies to include `original_strategy_id: "33333333-3333-4333-8333-333333333333"` — otherwise they'll 400 on the new validation gate.

    Commit `feat(05-01): src/app/api/admin/match/send-intro/route.ts — accept + pass original_strategy_id (D-20b revised)`.
  </action>
  <verify>
    <automated>grep -c "p_original_strategy_id" src/app/api/admin/match/send-intro/route.ts && grep -c "original_strategy_id is required" src/app/api/admin/match/send-intro/route.ts && npm run typecheck 2>&1 | tail -10</automated>
  </verify>
  <done>
    Route has both `p_original_strategy_id` (in RPC call) and `"original_strategy_id is required"` (in validation). `npm run typecheck` exits 0. If a pre-existing admin route test file exists, its tests remain green after update.
  </done>
</task>

<task type="auto" id="5-01-W1-04">
  <name>Task 5-01-W1-04: Wire SendIntroPanel per W1-01 decision to include original_strategy_id in POST body</name>
  <files>src/components/admin/SendIntroPanel.tsx (+ any files required by the W1-01 decision)</files>
  <read_first>
    - `src/components/admin/SendIntroPanel.tsx` entire file (current props + state + submit handler lines 28-61)
    - `src/components/admin/AllocatorMatchQueue.tsx` around line 708-712 (SendIntroPanel call-site)
    - W1-01 decision result (Option A / B / C) — if decision is not recorded OR was Option C, HALT this task.
    - `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` D-20c
  </read_first>
  <action>
    Execute the wiring per the W1-01 decision result:

    **If Option A (holdings dropdown):**
    1. Add component state `const [originalStrategyId, setOriginalStrategyId] = useState<string | null>(null);`
    2. Fetch allocator's current holdings on mount via `useEffect`. Simplest: add a prop `allocatorHoldings: Array<{ strategy_id: string; name: string }>` to SendIntroPanel, have AllocatorMatchQueue source it from the match data it already fetches (if available) or add a fetch when the panel opens.
    3. Render a `<select>` labeled "Replacing (underperformer)" with the most-recently allocated holding as default.
    4. Block submit until `originalStrategyId` is non-null (disable the Send button).
    5. Include `original_strategy_id: originalStrategyId` in the POST body at line 40-45.

    **If Option B (admin picks from all strategies):**
    1. Same state addition.
    2. Use the existing strategies search UI or autocomplete (inspect `src/components/` for one; if absent, add a simple searchable `<select>` populated lazily from `/api/admin/strategies/search` or similar).
    3. Same submit-gate + body inclusion.

    **If Option C (defer):** HALT. Execution ended at W1-01.

    For Options A and B, the POST body becomes:
    ```typescript
    body: JSON.stringify({
      allocator_id: allocatorId,
      strategy_id: candidate.strategy_id,
      original_strategy_id: originalStrategyId,   // NEW
      candidate_id: candidate.id,
      admin_note: note.trim(),
    }),
    ```

    Run typecheck. Commit `feat(05-01): src/components/admin/SendIntroPanel.tsx — [Option A/B] underperformer source (D-20c revised)`.
  </action>
  <verify>
    <automated>grep -c "original_strategy_id" src/components/admin/SendIntroPanel.tsx && npm run typecheck 2>&1 | tail -10 && npm run lint 2>&1 | tail -5</automated>
  </verify>
  <done>
    SendIntroPanel includes `original_strategy_id` in its POST body AND obtains the value from a real data source per W1-01 decision. Typecheck exits 0. Lint exits 0. SUMMARY.md (written at W3-04) records the chosen option + any new fetch path.
  </done>
</task>

<task type="auto" tdd="true" id="5-01-W1-05">
  <name>Task 5-01-W1-05: computeOutcomeKPIs pure function (src/lib/outcomes-kpi.ts)</name>
  <files>src/lib/outcomes-kpi.ts</files>
  <read_first>
    - `.planning/phases/05-outcomes-dashboard/05-RESEARCH.md` §Q4 lines 437-495 (TypeScript spec + filter rules; note: math corrected 2026-04-19 per Voice-D2)
    - `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` D-11, D-12 revised, D-13, D-14, D-21 revised
    - `analytics-service/services/feedback_engine.py` — Python filter rules this mirrors (D-21 parity); `_success_value` lines 156-166 is the authoritative most-mature-delta iterator
    - `.planning/phases/04-feedback-loop/04-CONTEXT.md` D-08 (noise filters)
    - `src/lib/bridge-outcome-label.ts` — pure-fn pattern (header + signature + branch-based derivation)
    - `src/lib/bridge-outcome-schema.ts` — `BridgeOutcome` type (UNCHANGED by Phase 5 — no `original_strategy_id` field added here)
    - `src/lib/outcomes-kpi.test.ts` (written in W0-01) — the test contract this must satisfy
  </read_first>
  <behavior>
    Given `BridgeOutcome[]` (unchanged shape), return `OutcomeKPIs`:
    - `totalOutcomes` = `outcomes.length` (D-13).
    - `winRate` = numerator/denominator OR null when denominator=0.
      - Denominator: `kind==='allocated' AND percent_allocated >= 1.0 AND at least one of (delta_30d,delta_90d,delta_180d) !== null`.
      - Numerator: denominator subset where most-mature non-NULL delta strict > 0 (prefer delta_180d > delta_90d > delta_30d per D-12 revised, matching feedback_engine._success_value).
    - `avgRealizedDelta` = arithmetic mean of most-mature non-NULL delta across denominator; null when denominator=0.
    - `pendingCount` = count of rows where `kind==='allocated' AND percent_allocated >= 1.0 AND ALL three deltas NULL`.

    Must exactly match the W0-01 parity fixture expected values (avgRealizedDelta: 0.0033333333333333335, winRate: 0.6666666666666666).

    NOTE REVISION: this function does NOT touch `original_strategy_id`. The underperformer identity is irrelevant to KPI math (win rate is computed from the realized delta on the replacement — who it replaced doesn't affect the number). Input shape is unchanged.
  </behavior>
  <action>
    Write `src/lib/outcomes-kpi.ts` verbatim:

    ```typescript
    // Phase 5 pure-function KPI computer for the Outcomes Dashboard widget.
    // Mirrors Phase 4 feedback_engine.py filter rules (D-08/D-11/D-12/D-21) so
    // the dashboard "win rate" tells the same story as the scoring feedback
    // loop. Any change to Phase 4 filters MUST update this module + the shared
    // fixture tests/fixtures/outcomes-kpi-parity.json in the SAME PR.
    //
    // D-12 revised (2026-04-19 per Voice-D2): most-mature delta preference
    // order is delta_180d -> delta_90d -> delta_30d, matching Phase 4
    // feedback_engine._success_value lines 156-166. Fixture avgRealizedDelta
    // = 0.00333 on the 7-row parity fixture.

    import type { BridgeOutcome } from "./bridge-outcome-schema";

    export type OutcomeKPIs = {
      /** D-13: simple count of all rows (allocated + rejected + pending). */
      totalOutcomes: number;
      /** D-11: wins / denominator over allocated rows surviving D-08 filters; null when denominator=0. */
      winRate: number | null;
      /** D-12 revised: arithmetic mean of most-mature non-NULL delta per surviving allocated row; null when denominator=0. */
      avgRealizedDelta: number | null;
      /** D-14 sub-label source: count of allocated rows with percent>=1 but all three deltas NULL. */
      pendingCount: number;
    };

    function mostMatureDelta(o: BridgeOutcome): number | null {
      // D-12 revised: prefer delta_180d > delta_90d > delta_30d, matching
      // Phase 4 feedback_engine._success_value lines 156-166.
      if (o.delta_180d !== null) return o.delta_180d;
      if (o.delta_90d !== null) return o.delta_90d;
      return o.delta_30d;
    }

    export function computeOutcomeKPIs(outcomes: BridgeOutcome[]): OutcomeKPIs {
      const totalOutcomes = outcomes.length;

      // Step 1 (D-08 step 2): drop allocated rows with <1% allocated (token-size dabbles aren't conviction).
      // Step 2: restrict to allocated (rejected rows excluded from win rate per D-11).
      const allocatedSized = outcomes.filter(
        (o) => o.kind === "allocated" && (o.percent_allocated ?? 0) >= 1.0,
      );

      // Step 3: partition by matured (any non-NULL delta) vs pending (all NULL).
      const mature = allocatedSized.filter(
        (o) => o.delta_30d !== null || o.delta_90d !== null || o.delta_180d !== null,
      );
      const pendingCount = allocatedSized.length - mature.length;

      if (mature.length === 0) {
        return { totalOutcomes, winRate: null, avgRealizedDelta: null, pendingCount };
      }

      const deltas = mature
        .map(mostMatureDelta)
        .filter((d): d is number => d !== null);

      // D-12 revised: strict > 0 for win (Phase 4 _success_value parity).
      // D-02 revised (Voice-D6) locks the same rule for the status pill.
      const wins = deltas.filter((d) => d > 0).length;
      const winRate = wins / deltas.length;
      const avgRealizedDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;

      return { totalOutcomes, winRate, avgRealizedDelta, pendingCount };
    }
    ```

    Run quick command. All W0-01 cases for outcomes-kpi.test.ts flip RED->GREEN, INCLUDING `"parity fixture"` (asserts `0.0033333333333333335`). Commit `feat(05-01): src/lib/outcomes-kpi.ts — Phase 4 _success_value parity (D-11, D-12 revised, D-21 revised, Voice-D2)`.
  </action>
  <verify>
    <automated>npx vitest run src/lib/outcomes-kpi.test.ts 2>&1 | tail -30</automated>
  </verify>
  <done>
    `npx vitest run src/lib/outcomes-kpi.test.ts` exits 0 — all 8 cases pass. VALIDATION.md row 5-01-W1-05 covered.
  </done>
</task>

<task type="auto" tdd="true" id="5-01-W1-06">
  <name>Task 5-01-W1-06: deriveOutcomeStatusPill helper (append to src/lib/bridge-outcome-label.ts) — Voice-D6 zero-delta override</name>
  <files>src/lib/bridge-outcome-label.ts</files>
  <read_first>
    - `src/lib/bridge-outcome-label.ts` — existing `deriveOutcomeLabel` pattern (lines 46-88)
    - `src/lib/bridge-outcome-schema.ts` — `REJECTION_REASON_LABELS` (reuse, do NOT duplicate)
    - `.planning/phases/05-outcomes-dashboard/05-UI-SPEC.md` §Status Pill Anatomy (lines 198-210)
    - `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` D-02 revised (Voice-D6 — zero-delta -> allocated-loss)
    - `.planning/phases/05-outcomes-dashboard/05-PATTERNS.md` §Q6 code block
    - `src/lib/bridge-outcome-label.test.ts` (extended W0-01) — 8 cases this must green INCLUDING case 4 (zero-delta asserts allocated-loss)
  </read_first>
  <action>
    APPEND to `src/lib/bridge-outcome-label.ts`. First add imports at top if not present:

    ```typescript
    import {
      REJECTION_REASON_LABELS,
      type BridgeOutcome,
    } from "./bridge-outcome-schema";
    ```

    Then append at the bottom:

    ```typescript
    export type OutcomeStatusPill = {
      state: "allocated-win" | "allocated-loss" | "allocated-pending" | "rejected";
      text: string;
      tone: "positive" | "negative" | "neutral";
    };

    /**
     * Phase 5 D-02 revised (Voice-D6, 2026-04-19): derive the 4-state status
     * pill for a bridge_outcomes row.
     *
     * - Rejected rows: `Rejected \u2014 {REJECTION_REASON_LABELS[reason] || "Other"}`.
     * - Allocated rows: `Allocated {percent}% \u2014 {win|loss|pending}` with
     *   win/loss/pending determined by the sign of the most-mature non-NULL
     *   delta (D-12 revised: delta_180d -> delta_90d -> delta_30d).
     *   Strict > 0 for win (matches Phase 4 _success_value); <= 0 INCLUDING
     *   EXACTLY ZERO -> loss. This INTENTIONALLY overrides Phase 1 D-13
     *   (D-13 = neutral-on-zero) for the status pill only. Best Available
     *   Delta cell continues to honor D-13 (neutral on zero). Divergence is
     *   intentional: pill binary-classifies success/failure for RL parity;
     *   delta cell displays raw magnitude without classification.
     *   All-NULL deltas -> pending.
     */
    export function deriveOutcomeStatusPill(
      outcome: BridgeOutcome,
    ): OutcomeStatusPill {
      if (outcome.kind === "rejected") {
        const label = outcome.rejection_reason
          ? REJECTION_REASON_LABELS[outcome.rejection_reason]
          : "Other";
        return {
          state: "rejected",
          text: `Rejected \u2014 ${label}`,
          tone: "neutral",
        };
      }

      const pct = outcome.percent_allocated ?? 0;
      const prefix = `Allocated ${pct}%`;

      const mostMature =
        outcome.delta_180d !== null
          ? outcome.delta_180d
          : outcome.delta_90d !== null
            ? outcome.delta_90d
            : outcome.delta_30d;

      if (mostMature === null) {
        return {
          state: "allocated-pending",
          text: `${prefix} \u2014 pending`,
          tone: "neutral",
        };
      }
      // Voice-D6: strict > 0 for win; zero OR negative = loss.
      // This is the Phase-4 _success_value parity rule and INTENTIONALLY
      // overrides Phase 1 D-13 (neutral on zero) for the pill only.
      if (mostMature > 0) {
        return {
          state: "allocated-win",
          text: `${prefix} \u2014 win`,
          tone: "positive",
        };
      }
      return {
        state: "allocated-loss",
        text: `${prefix} \u2014 loss`,
        tone: "negative",
      };
    }
    ```

    Run quick command. The 8 W0-01 label test cases flip RED->GREEN, INCLUDING case 4 (zero-delta -> allocated-loss per Voice-D6). Commit `feat(05-01): src/lib/bridge-outcome-label.ts — deriveOutcomeStatusPill (4-state D-02 revised, Voice-D6 zero-delta override)`.
  </action>
  <verify>
    <automated>npx vitest run src/lib/bridge-outcome-label.test.ts 2>&1 | tail -30</automated>
  </verify>
  <done>
    `npx vitest run src/lib/bridge-outcome-label.test.ts` exits 0 — 15 existing + 8 new cases pass (Voice-D6 zero-delta case green).
  </done>
</task>

<task type="auto" tdd="true" id="5-01-W1-07">
  <name>Task 5-01-W1-07: Extend getMyAllocationDashboard with top-level outcomes fan-out (nested match_decisions join + .limit(200) + ownership gate — Voice-D4 + D5)</name>
  <files>src/lib/queries.ts</files>
  <read_first>
    - `src/lib/queries.ts` lines 510-566 (payload type) + lines 599-792 (fan-out) + lines 679-687 (admin-client-with-inline-allocator-id pattern)
    - `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` D-15 amended (.limit(200)) + D-20a-d revised
    - `.planning/phases/05-outcomes-dashboard/05-PATTERNS.md` §16 (queries.ts delta — revised for nested match_decisions select)
    - `.planning/phases/05-outcomes-dashboard/05-UI-SPEC.md` §Data Contract
    - `.planning/phases/05-outcomes-dashboard/VOICES-ACCEPTED.md` D4 + D5
    - `src/lib/queries.my-allocation.test.ts` (extended W0-01) — 5 cases this must green INCLUDING `TC outcomes-05` regression gate
    - `src/lib/bridge-outcome-schema.ts` — `BridgeOutcome` type (UNCHANGED)
    - `supabase/migrations/059_bridge_outcomes.sql` — `match_decision_id` is nullable (ON DELETE SET NULL per A6)
  </read_first>
  <action>
    Six edits to `src/lib/queries.ts`:

    (1) Add new exported type alongside `MyAllocationDashboardPayload`:
    ```typescript
    export type OutcomeRow = BridgeOutcome & {
      /**
       * FK to match_decisions(id). Nullable per migration 059 ON DELETE SET NULL —
       * in practice every outcome created via POST /api/bridge/outcome has a
       * non-null FK. When null, the UI renders em-dash for the Original column
       * (D-03 convention).
       */
      match_decision_id: string | null;
      /** Derived from bridge_outcomes.strategy_id via strategies!fk embed. */
      replacement_strategy: { id: string; name: string } | null;
      /**
       * Resolved from bridge_outcomes.match_decision_id ->
       * match_decisions.original_strategy_id -> strategies(id, name) via
       * nested Supabase embed. Null when match_decision_id is null (theoretical
       * case; should not occur for outcomes created by the current POST route).
       */
      match_decision: {
        original_strategy: { id: string; name: string };
      } | null;
    };
    ```

    (2) Extend `MyAllocationDashboardPayload` by adding (after `alertCount`):
    ```typescript
      /** Phase 5 D-15: full outcome history for the allocator, sorted created_at DESC, capped at 200 most-recent (Voice-D5). */
      outcomes: OutcomeRow[];
    ```

    (3) In the early-return branch (portfolio null), include `outcomes: [] as OutcomeRow[]`:
    ```typescript
    return {
      portfolio: null,
      analytics: null,
      strategies: [],
      apiKeys: await getUserApiKeys(userId),
      alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
      outcomes: [] as OutcomeRow[],
    };
    ```

    (4) Add 8th Promise.all entry immediately before the closing `]);` of the existing Promise.all array. CRITICAL (Voice-D4): the `.eq("allocator_id", userId)` is the ownership gate; it is INLINE with the query and is regression-asserted by `TC outcomes-05` in `queries.my-allocation.test.ts`. CRITICAL (Voice-D5): `.limit(200)` caps the result set at 200 most-recent rows:
    ```typescript
      ,
      // Phase 5 D-15 (revised): full outcome history with nested
      // match_decisions.original_strategy join. Admin client required for
      // the nested match_decisions read — no allocator-self-SELECT RLS
      // policy on that table. The .eq("allocator_id", userId) is the
      // ownership gate (Voice-D4 regression-asserted by TC outcomes-05); keep
      // it inline with the query so a reviewer cannot accidentally drop it
      // (same pattern as lines 683-687 above). .limit(200) caps result set
      // at 200 most-recent outcomes (Voice-D5).
      admin
        .from("bridge_outcomes")
        .select(
          "id, strategy_id, match_decision_id, kind, percent_allocated, allocated_at, rejection_reason, note, delta_30d, delta_90d, delta_180d, estimated_delta_bps, estimated_days, needs_recompute, created_at, replacement_strategy:strategies!bridge_outcomes_strategy_id_fkey(id, name), match_decision:match_decisions!bridge_outcomes_match_decision_id_fkey(original_strategy:strategies!match_decisions_original_strategy_id_fkey(id, name))"
        )
        .eq("allocator_id", userId)
        .order("created_at", { ascending: false })
        .limit(200),
    ```

    (5) Extend destructure array by adding `outcomesFullRes` as the 8th element:
    ```typescript
    const [
      analyticsRes,
      strategiesRes,
      apiKeys,
      alertsRes,
      sentAsIntroRes,
      existingOutcomesRes,
      activeDismissalsRes,
      outcomesFullRes,
    ] = await Promise.all([ /* ... */ ]);
    ```

    (6) Before the final `return {` statement, marshal the outcomes array. Supabase normalizes embed results as object OR array depending on inference; normalize both levels:
    ```typescript
    // Phase 5 D-15 (revised): marshal fan-out into top-level outcomes[].
    // Supabase returns embedded strategies as object or array; normalize both
    // the direct embed (replacement_strategy) and the nested embed
    // (match_decision.original_strategy).
    type EmbeddedStrategy = { id: string; name: string };
    type RawRow = Record<string, unknown>;
    function normalizeEmbed(v: unknown): EmbeddedStrategy | null {
      if (v == null) return null;
      if (Array.isArray(v)) return (v[0] as EmbeddedStrategy | undefined) ?? null;
      return v as EmbeddedStrategy;
    }
    const outcomes: OutcomeRow[] = ((outcomesFullRes.data ?? []) as RawRow[]).map((row) => {
      const replRaw = row.replacement_strategy;
      const mdRaw = row.match_decision;
      const mdObj = Array.isArray(mdRaw) ? (mdRaw[0] as RawRow | undefined) ?? null : (mdRaw as RawRow | null);
      const origInner = mdObj ? normalizeEmbed((mdObj as RawRow).original_strategy) : null;
      return {
        ...(row as unknown as BridgeOutcome),
        match_decision_id: (row.match_decision_id as string | null) ?? null,
        replacement_strategy: normalizeEmbed(replRaw),
        match_decision: origInner ? { original_strategy: origInner } : null,
      } satisfies OutcomeRow;
    });
    ```

    Extend the final `return { ... }` object with `outcomes`:
    ```typescript
    return {
      portfolio,
      analytics: (analyticsRes.data ?? null) as PortfolioAnalytics | null,
      strategies,
      apiKeys: apiKeys,
      alertCount: alertCounts,
      outcomes,
    };
    ```

    Run quick command. The 5 W0-01 cases (outcomes-01..05) flip RED->GREEN. Voice-D4 `TC outcomes-05` asserts the `.eq("allocator_id", userId)` chain call was recorded. Voice-D5 sub-assertion (inside TC outcomes-05) asserts `.limit(200)` was also called. If the mock `buildChain` in the test doesn't understand the nested embed syntax, extend it to return seeded `bridgeOutcomes` array with synthesized `replacement_strategy` + `match_decision.original_strategy` nested fields. Commit `feat(05-01): src/lib/queries.ts — outcomes fan-out with nested match_decisions join + .limit(200) + .eq ownership gate (D-15 amended, D-20a revised, Voice-D4, Voice-D5)`.
  </action>
  <verify>
    <automated>npx vitest run src/lib/queries.my-allocation.test.ts 2>&1 | tail -40 && npm run typecheck 2>&1 | tail -20 && grep -c "\.limit(200)" src/lib/queries.ts && grep -c "bridge_outcomes_match_decision_id_fkey" src/lib/queries.ts</automated>
  </verify>
  <done>
    `npx vitest run src/lib/queries.my-allocation.test.ts` exits 0 — all 5 new TC outcomes-0* cases pass INCLUDING TC outcomes-05 (Voice-D4 + D5). `npm run typecheck` exits 0. Assertion: `outcomes[0].match_decision?.original_strategy.name` resolves from nested embed. `.limit(200)` present in queries.ts.
  </done>
</task>

<task type="auto" tdd="true" id="5-01-W1-08">
  <name>Task 5-01-W1-08: Create lazy curves endpoint GET /api/bridge/outcome/[id]/curves with match_decisions join + bridgeOutcomeCurvesLimiter (Voice-D10)</name>
  <files>src/app/api/bridge/outcome/[id]/curves/route.ts</files>
  <read_first>
    - `src/app/api/strategies/draft/[id]/route.ts` — dynamic-route auth precedent (lines 22-79) + `getAuthedUserIdOrError` (lines 27-40)
    - `src/app/api/bridge/outcome/route.ts` — rate-limit + admin-client ownership gate (lines 95-122)
    - `src/lib/api/withAuth.ts` — shape does NOT forward ctx.params; inline auth required
    - `src/lib/ratelimit.ts` — **Voice-D10 investigation outcome (W0-03): use the new `bridgeOutcomeCurvesLimiter` export (60/60s), NOT `userActionLimiter` (5/60s)**; each `makeLimiter` call produces a distinct Ratelimit instance with its own budget.
    - `src/lib/supabase/admin.ts` — `createAdminClient` signature
    - `supabase/migrations/060_bridge_outcome_cron.sql` lines 11-14 — `returns_series` shape (cumulative equity NAV, NOT daily returns)
    - `.planning/phases/05-outcomes-dashboard/05-RESEARCH.md` §Q2 + §Q1 (admin client) + §Pitfall 2 (rebase math) + §Pitfall 5 (NULL-anchor fall-forward)
    - `.planning/phases/05-outcomes-dashboard/05-PATTERNS.md` §10 + Shared A + B
    - `.planning/phases/05-outcomes-dashboard/05-UI-SPEC.md` §Data Contract
    - `.planning/phases/05-outcomes-dashboard/VOICES-ACCEPTED.md` D10 (rate-limit keying outcome)
    - `src/app/api/bridge/outcome/[id]/curves/route.test.ts` (W0-01) — 7-case contract (includes TC7 match_decision_id=null + TC6 Voice-D10 limiter assertion)
    - Next.js 16 dynamic-route docs in `node_modules/next/dist/docs/` for the `params: Promise<{id:string}>` async shape (AGENTS.md "this is NOT the Next.js you know")
  </read_first>
  <behavior>
    `GET /api/bridge/outcome/[id]/curves` returns sparkline data for one outcome, rebased to 100 at allocated_at, windowed to 180 days.

    Auth flow:
    1. Inline `getAuthedUserIdOrError` — withAuth cannot forward ctx.params.
    2. **Voice-D10:** rate-limit via `checkLimit(bridgeOutcomeCurvesLimiter, 'bridge_outcome_curves:${userId}')` — NEW dedicated 60/60s limiter, NOT userActionLimiter.
    3. Await ctx.params; 400 if id missing/invalid.
    4. User-scoped SELECT `bridge_outcomes.id, strategy_id, match_decision_id, allocated_at WHERE id={id}` — RLS filters by `allocator_id = auth.uid()`. 404 if null (T-05-01).
    5. **If `match_decision_id` is non-null:** admin client SELECT `match_decisions.original_strategy_id WHERE id={match_decision_id}`. If null result or error, original_strategy_id stays null (graceful degradation — D-03 em-dash in UI).
    6. Admin client SELECTs `strategy_analytics.returns_series WHERE strategy_id IN [original_strategy_id?, strategy_id]` — pass only non-null ids.
    7. Rebase each returned series to 100 at allocated_at (`nav[d] = 100 * equity[d] / equity[allocated_at]`). Fall-forward if anchor exact date missing (Pitfall 5).
    8. Slice to `allocated_at..allocated_at+180d` inclusive.
    9. Return JSON `{ original: Array<{date,nav}>, replacement: Array<{date,nav}>, allocated_at }`. `original` is `[]` when original_strategy_id could not be resolved.
  </behavior>
  <action>
    Create `src/app/api/bridge/outcome/[id]/curves/route.ts` verbatim. Note the import + usage of `bridgeOutcomeCurvesLimiter` from `@/lib/ratelimit`:

    ```typescript
    import { NextRequest, NextResponse } from "next/server";
    import { createClient } from "@/lib/supabase/server";
    import { createAdminClient } from "@/lib/supabase/admin";
    import { bridgeOutcomeCurvesLimiter, checkLimit } from "@/lib/ratelimit";

    /**
     * GET /api/bridge/outcome/[id]/curves
     *
     * Phase 5 D-16: lazy sparkline data for the Outcomes Dashboard expanded row.
     * Returns equity curves of both the original (underperformer) and replacement
     * strategies, rebased to 100 at `allocated_at`, windowed 180 days forward.
     *
     * Auth (T-05-01 mitigation): ownership proved FIRST via user-scoped SELECT
     * on bridge_outcomes (RLS filters by allocator_id=auth.uid()). 404 if not
     * owned. ONLY AFTER ownership proof do we hit admin client.
     *
     * Original strategy resolution (D-20a revised): the underperformer id
     * lives on match_decisions.original_strategy_id, NOT on bridge_outcomes.
     * We hop bridge_outcomes.match_decision_id -> match_decisions.original_strategy_id
     * via an admin-client SELECT (match_decisions has no allocator-self-SELECT
     * RLS policy). If match_decision_id is null (theoretical case per migration
     * 059 ON DELETE SET NULL), the original series is returned as []; the UI
     * renders em-dash per D-03.
     *
     * Rate limit (T-05-02 + Voice-D10): bridgeOutcomeCurvesLimiter (60/60s per
     * user). Distinct from userActionLimiter (5/60s) so curve-exploration does
     * not burn budget reserved for sensitive POSTs.
     *
     * Auth inlined (not withAuth) — withAuth does not forward dynamic-route
     * ctx.params. See src/app/api/strategies/draft/[id]/route.ts precedent.
     */

    interface RouteContext {
      params: Promise<{ id: string }>;
    }

    async function getAuthedUserIdOrError(
      req: NextRequest,
    ): Promise<{ userId: string } | NextResponse> {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return { userId: user.id };
    }

    type ReturnsPoint = { date: string; value: number };

    /**
     * Rebase cumulative NAV to 100 at allocated_at. Pitfall 5: if exact anchor
     * missing, fall-forward to first date >= allocated_at. Pitfall 2: series
     * is cumulative equity, NOT daily returns — take ratio, never sum.
     */
    function rebaseToAnchor(
      series: ReturnsPoint[],
      allocatedAt: string,
    ): Array<{ date: string; nav: number }> {
      if (!series || series.length === 0) return [];

      const postAnchor = series
        .filter((p) => p.date >= allocatedAt)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      if (postAnchor.length === 0) return [];

      const anchorValue = postAnchor[0].value;
      if (!anchorValue || anchorValue <= 0) return [];

      return postAnchor.map((p) => ({
        date: p.date,
        nav: (100 * p.value) / anchorValue,
      }));
    }

    function addDaysISO(iso: string, days: number): string {
      const d = new Date(iso + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    }

    export async function GET(req: NextRequest, ctx: RouteContext) {
      const authResult = await getAuthedUserIdOrError(req);
      if (authResult instanceof NextResponse) return authResult;
      const userId = authResult.userId;

      // Voice-D10: dedicated limiter; does not share budget with userActionLimiter.
      const rl = await checkLimit(
        bridgeOutcomeCurvesLimiter,
        `bridge_outcome_curves:${userId}`,
      );
      if (!rl.success) {
        return NextResponse.json(
          { error: "Too many requests" },
          { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
        );
      }

      const { id } = await ctx.params;
      if (!id || typeof id !== "string") {
        return NextResponse.json({ error: "id required" }, { status: 400 });
      }

      // Step 1: ownership gate via user-scoped client (RLS enforces allocator_id=auth.uid()).
      const supabase = await createClient();
      const { data: outcome, error: outcomeErr } = await supabase
        .from("bridge_outcomes")
        .select("id, strategy_id, match_decision_id, allocated_at")
        .eq("id", id)
        .maybeSingle();

      if (outcomeErr || !outcome) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const allocatedAt = (outcome as { allocated_at: string | null }).allocated_at;
      if (!allocatedAt) {
        // Rejected outcomes have allocated_at=null — no rebase anchor.
        return NextResponse.json({
          original: [],
          replacement: [],
          allocated_at: null,
        });
      }

      const strategyId = (outcome as { strategy_id: string }).strategy_id;
      const matchDecisionId = (outcome as { match_decision_id: string | null }).match_decision_id;

      // Step 2: resolve original_strategy_id via match_decisions (admin client —
      // match_decisions has no allocator-self-SELECT RLS policy).
      const admin = createAdminClient();
      let originalStrategyId: string | null = null;
      if (matchDecisionId) {
        const { data: decision, error: decisionErr } = await admin
          .from("match_decisions")
          .select("original_strategy_id")
          .eq("id", matchDecisionId)
          .maybeSingle();
        if (!decisionErr && decision) {
          originalStrategyId = (decision as { original_strategy_id: string | null }).original_strategy_id;
        }
      }

      // Step 3: returns_series for both strategies (non-null ids only).
      const strategyIds = [strategyId, ...(originalStrategyId ? [originalStrategyId] : [])];
      const { data: analytics, error: analyticsErr } = await admin
        .from("strategy_analytics")
        .select("strategy_id, returns_series")
        .in("strategy_id", strategyIds);

      if (analyticsErr) {
        console.error("[api/bridge/outcome/curves] analytics fetch error:", analyticsErr);
        return NextResponse.json({ error: "Failed to load curves" }, { status: 500 });
      }

      const rowsByStrategy = new Map<string, ReturnsPoint[]>();
      for (const row of analytics ?? []) {
        const sid = (row as { strategy_id: string }).strategy_id;
        const series = (row as { returns_series: ReturnsPoint[] | null }).returns_series ?? [];
        rowsByStrategy.set(sid, series);
      }

      // Step 4: rebase + window.
      const windowEnd = addDaysISO(allocatedAt, 180);
      const rebaseAndWindow = (sid: string | null) => {
        if (!sid) return [];
        const series = rowsByStrategy.get(sid) ?? [];
        return rebaseToAnchor(series, allocatedAt).filter((p) => p.date <= windowEnd);
      };

      return NextResponse.json({
        original: rebaseAndWindow(originalStrategyId),
        replacement: rebaseAndWindow(strategyId),
        allocated_at: allocatedAt,
      });
    }
    ```

    Run quick command. The 7 W0-01 curves/route.test.ts cases flip RED->GREEN (TC6 now asserts `bridgeOutcomeCurvesLimiter` is the called limiter). Commit `feat(05-01): src/app/api/bridge/outcome/[id]/curves/route.ts — lazy sparkline endpoint with match_decisions join + dedicated bridgeOutcomeCurvesLimiter (D-16, D-20a revised, Voice-D10, T-05-01/02)`.
  </action>
  <verify>
    <automated>npx vitest run src/app/api/bridge/outcome/\[id\]/curves/route.test.ts 2>&1 | tail -30 && npm run typecheck 2>&1 | tail -10 && grep -c "bridgeOutcomeCurvesLimiter" src/app/api/bridge/outcome/\[id\]/curves/route.ts</automated>
  </verify>
  <done>
    `npx vitest run src/app/api/bridge/outcome/[id]/curves/route.test.ts` exits 0 — all 7 cases pass. `npm run typecheck` exits 0. `bridgeOutcomeCurvesLimiter` present in route file. VALIDATION.md row 5-01-W1-08 covered.
  </done>
</task>

<task type="auto" id="5-01-W1-09">
  <name>Task 5-01-W1-09 [NEW per Voice-D8]: Document LAYOUT_VERSION 1->2 bump impact — storage location + zero-measurable server-side effect</name>
  <files>(investigation-only — writes findings into .planning/phases/05-outcomes-dashboard/05-01-LAYOUT-BUMP-NOTES.md; no code edits expected)</files>
  <read_first>
    - `src/app/(dashboard)/allocations/hooks/useDashboardConfig.ts` — `STORAGE_KEY = "quantalyze-dashboard-config"` (line 8); layout-version check (lines 16-22) resets to DEFAULT_LAYOUT when `parsed.layoutVersion !== LAYOUT_VERSION`
    - `src/app/(dashboard)/allocations/lib/dashboard-defaults.ts` — current `LAYOUT_VERSION = 1`
    - `.planning/phases/05-outcomes-dashboard/VOICES-ACCEPTED.md` D8
  </read_first>
  <behavior>
    Voice-D8 originally framed the investigation as "query production for persisted layouts". Verified 2026-04-19 that dashboard config lives in **localStorage** (per `useDashboardConfig.ts:8`), NOT the database. There is no server-side table of saved layouts. Therefore:
    - No SQL query can enumerate affected users.
    - The LAYOUT_VERSION bump reset happens LOCALLY in each user's browser on the next page load.
    - No backfill / no migration / no banner is structurally necessary.

    Outcome framing: document this as "zero-measurable server-side impact; rely on the new widget's natural visibility in DEFAULT_LAYOUT for first-time UX; revisit if any user reports layout-reset surprise post-ship."
  </behavior>
  <action>
    Create `.planning/phases/05-outcomes-dashboard/05-01-LAYOUT-BUMP-NOTES.md` with:

    ```markdown
    # Phase 5 — LAYOUT_VERSION 1 -> 2 Bump Impact Notes (Voice-D8)

    **Storage:** `localStorage.getItem("quantalyze-dashboard-config")` — per-browser, NOT a DB row.
    **Reset mechanism:** `useDashboardConfig.ts::loadConfig()` compares `parsed.layoutVersion` against the exported `LAYOUT_VERSION`; mismatch -> DEFAULT_LAYOUT replaces parsed.
    **Server-side count:** zero — localStorage is not queryable from the server.
    **User-visible effect:** any allocator who dragged widgets around on the /allocations grid will see their custom arrangement reset to DEFAULT_LAYOUT on their next page load after this ship. The new `outcomes-timeline` widget is in DEFAULT_LAYOUT, so it will be visible.
    **Decision:** NO banner added for Phase 5. Rationale: low-count user pool (early-lifecycle product), widget visibility is the intended outcome, no reliable way to count affected users. If one or more users subsequently report that the reset was surprising, a future phase can add a one-session `<InsightStrip>` banner on the /allocations page ("We added Bridge Outcomes to your dashboard. Your previous layout has been reset — rearrange as needed.") — trivial one-file addition.
    **Follow-up trigger:** if post-ship feedback includes "my dashboard reset itself", revisit.
    **Referenced in:** SUMMARY.md phase-gate notes.
    ```

    Then append a short line to `.planning/STATE.md` (or leave for W3-04 phase gate to fold in): `Phase 5 W1-09: LAYOUT_VERSION bump impact documented in 05-01-LAYOUT-BUMP-NOTES.md (Voice-D8 — localStorage-based; zero measurable server impact; no banner added).`

    Commit `docs(05-01): 05-01-LAYOUT-BUMP-NOTES.md — LAYOUT_VERSION bump storage investigation (Voice-D8)`.
  </action>
  <verify>
    <automated>test -f .planning/phases/05-outcomes-dashboard/05-01-LAYOUT-BUMP-NOTES.md && grep -c "localStorage" .planning/phases/05-outcomes-dashboard/05-01-LAYOUT-BUMP-NOTES.md && grep -c "zero" .planning/phases/05-outcomes-dashboard/05-01-LAYOUT-BUMP-NOTES.md</automated>
  </verify>
  <done>
    Notes file exists. Documents localStorage as the storage. Documents zero-measurable server impact. Commit landed.
  </done>
</task>

<!-- ======================== WAVE 2 — SINGLE-FILE WIDGET (Voice-D1 consolidation) + REGISTRATION ======================== -->

<task type="auto" tdd="true" id="5-01-W2-01">
  <name>Task 5-01-W2-01 [CONSOLIDATED PER VOICE-D1 — replaces prior W2-01..W2-05]: Build single-file OutcomesWidget.tsx with inline KpiStrip / TimelineTable / TimelineRow / ExpandedPanel / Sparkline sub-components</name>
  <files>src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx</files>
  <read_first>
    - `.planning/phases/05-outcomes-dashboard/05-UI-SPEC.md` all sections (widget container §127-148, KPI strip §151-168, Timeline §170-196, Expanded §218-238, Sparkline §240-272, State Matrix §276-327, Interaction Contract §331-342, Copywriting Contract)
    - `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` D-01..D-19 + D-15 amended (.limit(200) + truncation footer)
    - `.planning/phases/05-outcomes-dashboard/05-PATTERNS.md` §2..§7 (widget/KPI/timeline/expanded/sparkline patterns)
    - `.planning/phases/05-outcomes-dashboard/VOICES-ACCEPTED.md` D1 (consolidation rationale: CustomKpiStrip + PositionsTable pattern)
    - `src/app/(dashboard)/allocations/widgets/meta/CustomKpiStrip.tsx` — KPI strip layout precedent (single-file, inline sub-components)
    - `src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx` — row + expand + single-file precedent (inline BannerSubRow)
    - `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx` — strokeWidth + margin precedent
    - `src/app/(dashboard)/allocations/widgets/performance/CumulativeVsBenchmark.tsx` — two-series LineChart shape
    - `src/components/portfolio/ReplacementPanel.tsx` lines 35-70 — AbortController + fetch pattern
    - `src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx` lines 280-302 — `<tr><td colSpan>` sub-row pattern
    - `src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx`
    - `src/lib/bridge-outcome-label.ts` — `deriveOutcomeStatusPill` (W1-06) + existing `deriveOutcomeLabel`
    - `src/lib/queries.ts` — `OutcomeRow` type (W1-07) — nested `match_decision.original_strategy` shape
    - `src/lib/outcomes-kpi.ts` — `OutcomeKPIs` shape (shipped W1-05)
  </read_first>
  <behavior>
    Voice-D1 consolidation: ship the entire Outcomes widget in ONE file, `OutcomesWidget.tsx`, with sub-components as inline named functions. Pattern matches `CustomKpiStrip.tsx` and `PositionsTable.tsx` precedents (single file, inline helpers, tests render the whole widget and find sub-nodes via role/aria/text queries).

    File structure (single file, default export):
    1. Types: `CurveData`, `Point`, `Props` for each inline sub-component.
    2. Pure helpers: `formatPercent`, `winRateColor`, `deltaColor`, `toneColor`, `addDaysISO`, `sliceToWindow`, `formatDate`, `pillStyle`, `rebaseAndWindow`.
    3. Inline sub-components: `KpiStrip({ kpis })`, `Sparkline({ points })`, `ExpandedPanel({ outcome, curvesCache })`, `TimelineRow({ outcome, colSpan, isExpanded, onToggle, curvesCache, today })`, `TimelineTable({ outcomes, expandedId, onToggle, curvesCache, today })`, `TruncationFooter({ total })`.
    4. Top-level: `export default function OutcomesWidget({ data }: WidgetProps)` with state matrix (loading/empty/error/populated) + Voice-D5 truncation footer rendered when `outcomes.length === 200`.

    Render contract:
    - Loading (outcomes undefined): 5 skeleton rows + aria-label `"Loading outcomes data"`.
    - Empty (outcomes.length===0): centered CTA with literal copy + "View Holdings" link.
    - Populated: `<KpiStrip kpis={kpis} />` at top in a 64px-high bordered container; `<TimelineTable>` below (scrollable); truncation footer when count=200.
    - Each row: `<TimelineRow>` renders 6 `<td>` cells (caret, original strategy link or em-dash, replacement strategy link, date, status pill, best delta). Expand reveals inline `<ExpandedPanel>` in a `<tr><td colSpan={6}>`.
    - ExpandedPanel lazy-fetches `/api/bridge/outcome/{id}/curves` via AbortController; caches result in `curvesCache` ref; renders 3-column grid (30d/90d/180d) with delta number + `<Sparkline>` per column; pending columns show "Pending" pill + animate-pulse skeleton placeholder.
    - TruncationFooter: renders when `total === 200` with text `"Showing most recent 200 — reach out if you need historical export"` in DM Sans 12px muted.
  </behavior>
  <action>
    Create `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx` (single file, default export, inline sub-components). File body (verbatim):

    ```tsx
    "use client";

    import { Fragment, useEffect, useMemo, useRef, useState } from "react";
    import { Line, LineChart, ResponsiveContainer } from "recharts";
    import type { WidgetProps } from "../../lib/types";
    import type {
      MyAllocationDashboardPayload,
      OutcomeRow,
    } from "@/lib/queries";
    import { computeOutcomeKPIs, type OutcomeKPIs } from "@/lib/outcomes-kpi";
    import {
      deriveOutcomeLabel,
      deriveOutcomeStatusPill,
      type OutcomeStatusPill,
    } from "@/lib/bridge-outcome-label";
    import type { BridgeOutcome } from "@/lib/bridge-outcome-schema";

    /**
     * Phase 5 Outcomes Dashboard widget — SINGLE-FILE per Voice-D1 (2026-04-19).
     * Pattern: CustomKpiStrip + PositionsTable (inline sub-components, co-located
     * tests render the whole widget and find sub-nodes via role/aria/text).
     *
     * DASHBOARD-01..06 + D-01..D-19 + Voice-D5 truncation footer.
     */

    // ---------------------------------------------------------------- types

    type CurveData = {
      original: Array<{ date: string; nav: number }>;
      replacement: Array<{ date: string; nav: number }>;
      allocated_at: string | null;
    };

    type SparklinePoint = {
      date: string;
      original?: number;
      replacement?: number;
    };

    const COL_SPAN = 6;

    const WINDOWS: Array<{
      label: "30d" | "90d" | "180d";
      days: number;
      key: "delta_30d" | "delta_90d" | "delta_180d";
    }> = [
      { label: "30d", days: 30, key: "delta_30d" },
      { label: "90d", days: 90, key: "delta_90d" },
      { label: "180d", days: 180, key: "delta_180d" },
    ];

    // ---------------------------------------------------------- pure helpers

    function formatPercent(v: number | null): string {
      if (v === null) return "\u2014";
      const pct = v * 100;
      const sign = pct > 0 ? "+" : "";
      return `${sign}${pct.toFixed(1)}%`;
    }

    function winRateColor(winRate: number | null): string {
      if (winRate === null) return "#1A1A2E";
      if (winRate > 0.5) return "#16A34A";
      if (winRate < 0.5) return "#DC2626";
      return "#1A1A2E";
    }

    function deltaColor(v: number | null): string {
      if (v === null) return "#718096";
      if (v > 0) return "#16A34A";
      if (v < 0) return "#DC2626";
      return "#1A1A2E";
    }

    function toneColor(
      tone: "positive" | "negative" | "neutral",
    ): string {
      if (tone === "positive") return "#16A34A";
      if (tone === "negative") return "#DC2626";
      return "#718096";
    }

    function pillStyle(
      p: OutcomeStatusPill,
    ): { color: string; backgroundColor: string } {
      if (p.state === "allocated-win")
        return { color: "#16A34A", backgroundColor: "rgba(22,163,74,0.10)" };
      if (p.state === "allocated-loss")
        return { color: "#DC2626", backgroundColor: "rgba(220,38,38,0.08)" };
      return { color: "#718096", backgroundColor: "rgba(148,163,184,0.10)" };
    }

    function addDaysISO(iso: string, days: number): string {
      const d = new Date(iso + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    }

    function formatDate(iso: string): string {
      const d = new Date(iso + "T00:00:00Z");
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
    }

    function sliceToWindow(
      curve: CurveData | null,
      allocatedAt: string | null,
      days: number,
    ): SparklinePoint[] {
      if (!curve || !allocatedAt) return [];
      const end = addDaysISO(allocatedAt, days);
      const origMap = new Map(
        curve.original.filter((p) => p.date <= end).map((p) => [p.date, p.nav]),
      );
      const replMap = new Map(
        curve.replacement
          .filter((p) => p.date <= end)
          .map((p) => [p.date, p.nav]),
      );
      const allDates = Array.from(
        new Set([...origMap.keys(), ...replMap.keys()]),
      ).sort();
      return allDates.map((date) => ({
        date,
        original: origMap.get(date),
        replacement: replMap.get(date),
      }));
    }

    function formatDelta(
      v: number | null,
    ): { text: string; tone: "positive" | "negative" | "neutral" } {
      if (v === null) return { text: "Pending", tone: "neutral" };
      const pct = v * 100;
      const sign = pct > 0 ? "+" : "";
      return {
        text: `${sign}${pct.toFixed(1)}%`,
        tone: v > 0 ? "positive" : v < 0 ? "negative" : "neutral",
      };
    }

    // ----------------------------------------------------- inline sub-components

    // DASHBOARD-02 — KPI strip. Geist Mono 13px tabular-nums values, DM Sans
    // 11px uppercase labels, hairline dividers.
    function KpiStrip({ kpis }: { kpis: OutcomeKPIs }) {
      return (
        <div className="flex h-full items-center justify-around gap-2">
          <div className="flex flex-col items-center px-3 py-1 border-r border-[#E2E8F0]">
            <span
              className="text-[11px] uppercase tracking-wider font-semibold"
              style={{ color: "#718096" }}
            >
              TOTAL
            </span>
            <span
              className="font-mono text-[13px] tabular-nums font-medium"
              style={{ color: "#1A1A2E" }}
            >
              {kpis.totalOutcomes}
            </span>
          </div>

          <div className="flex flex-col items-center px-3 py-1 border-r border-[#E2E8F0]">
            <span
              className="text-[11px] uppercase tracking-wider font-semibold"
              style={{ color: "#718096" }}
            >
              WIN RATE
            </span>
            <span
              className="font-mono text-[13px] tabular-nums font-medium"
              style={{ color: winRateColor(kpis.winRate) }}
            >
              {kpis.winRate === null
                ? "\u2014"
                : `${Math.round(kpis.winRate * 100)}%`}
            </span>
          </div>

          <div className="flex flex-col items-center px-3 py-1">
            <span
              className="text-[11px] uppercase tracking-wider font-semibold"
              style={{ color: "#718096" }}
            >
              AVG DELTA
            </span>
            <span
              className="font-mono text-[13px] tabular-nums font-medium"
              style={{ color: deltaColor(kpis.avgRealizedDelta) }}
            >
              {formatPercent(kpis.avgRealizedDelta)}
            </span>
            {kpis.pendingCount > 0 && (
              <span
                className="text-xs font-medium mt-0.5"
                style={{ color: "#718096" }}
              >
                {`Avg realized delta: ${formatPercent(
                  kpis.avgRealizedDelta,
                )} \u00B7 ${kpis.pendingCount} pending`}
              </span>
            )}
          </div>
        </div>
      );
    }

    // DASHBOARD-04 — Recharts sparkline with hidden axes.
    function Sparkline({ points }: { points: SparklinePoint[] }) {
      return (
        <ResponsiveContainer width="100%" height={48}>
          <LineChart
            data={points}
            margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
          >
            <Line
              type="monotone"
              dataKey="original"
              stroke="#94A3B8"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="replacement"
              stroke="#1B6B5A"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      );
    }

    // DASHBOARD-04 — 3-column delta panel + lazy-fetched sparklines.
    function ExpandedPanel({
      outcome,
      curvesCache,
    }: {
      outcome: Pick<
        BridgeOutcome,
        "id" | "delta_30d" | "delta_90d" | "delta_180d" | "allocated_at"
      >;
      curvesCache: React.MutableRefObject<Map<string, CurveData>>;
    }) {
      const [curve, setCurve] = useState<CurveData | null>(
        () => curvesCache.current.get(outcome.id) ?? null,
      );
      const [error, setError] = useState<string | null>(null);
      const aborted = useRef(false);

      useEffect(() => {
        aborted.current = false;
        const controller = new AbortController();

        if (curvesCache.current.has(outcome.id)) {
          setCurve(curvesCache.current.get(outcome.id)!);
          return () => {
            aborted.current = true;
            controller.abort();
          };
        }

        async function fetchCurves() {
          try {
            const res = await fetch(
              `/api/bridge/outcome/${outcome.id}/curves`,
              { signal: controller.signal, credentials: "same-origin" },
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as CurveData;
            if (!aborted.current) {
              curvesCache.current.set(outcome.id, data);
              setCurve(data);
            }
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return;
            if (!aborted.current) setError("Failed to load curves");
          }
        }
        void fetchCurves();

        return () => {
          aborted.current = true;
          controller.abort();
        };
      }, [outcome.id, curvesCache]);

      const columns = useMemo(
        () =>
          WINDOWS.map((w) => ({
            ...w,
            delta: outcome[w.key],
            points: sliceToWindow(curve, outcome.allocated_at, w.days),
          })),
        [curve, outcome],
      );

      return (
        <div
          className="grid grid-cols-3 gap-4 border-b border-[#E2E8F0] px-3 py-4"
          style={{ backgroundColor: "#F8F9FA" }}
        >
          {columns.map((col) => {
            const d = formatDelta(col.delta);
            const isPending = col.delta === null;
            const isLoading = !curve && !error;

            return (
              <div key={col.label} className="flex flex-col gap-2">
                <span
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "#718096" }}
                >
                  {col.label}
                </span>
                {isPending ? (
                  <span
                    className="inline-block rounded px-2 py-0.5 text-[11px] font-medium self-start"
                    style={{
                      color: "#718096",
                      backgroundColor: "rgba(148,163,184,0.10)",
                    }}
                  >
                    Pending
                  </span>
                ) : (
                  <span
                    className="font-mono text-[13px] tabular-nums font-semibold"
                    style={{ color: toneColor(d.tone) }}
                  >
                    {d.text}
                  </span>
                )}
                {isPending || isLoading || error ? (
                  <div className="h-[48px] rounded bg-[#E2E8F0] animate-pulse" />
                ) : (
                  <Sparkline points={col.points} />
                )}
                <div
                  className="flex flex-col gap-1 text-[11px]"
                  style={{ color: "#718096" }}
                >
                  <span>
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                      style={{ backgroundColor: "#94A3B8" }}
                    />
                    Original
                  </span>
                  <span>
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                      style={{ backgroundColor: "#1B6B5A" }}
                    />
                    Replacement
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    // DASHBOARD-03 — Timeline row: caret + strategy links + status pill + best delta.
    function TimelineRow({
      outcome,
      colSpan,
      isExpanded,
      onToggle,
      curvesCache,
      today,
    }: {
      outcome: OutcomeRow;
      colSpan: number;
      isExpanded: boolean;
      onToggle: (id: string) => void;
      curvesCache: React.MutableRefObject<Map<string, CurveData>>;
      today?: string;
    }) {
      const pill = useMemo(() => deriveOutcomeStatusPill(outcome), [outcome]);

      const bestDelta = useMemo(() => {
        if (outcome.kind === "rejected")
          return { value: "\u2014", tone: "neutral" as const };
        const label = deriveOutcomeLabel({
          kind: outcome.kind,
          allocated_at: outcome.allocated_at,
          delta_30d: outcome.delta_30d,
          delta_90d: outcome.delta_90d,
          delta_180d: outcome.delta_180d,
          estimated_delta_bps: outcome.estimated_delta_bps,
          estimated_days: outcome.estimated_days,
          needs_recompute: outcome.needs_recompute,
          created_at: outcome.created_at,
          today,
        });
        return { value: label.value, tone: label.tone };
      }, [outcome, today]);

      const bestDeltaColor =
        bestDelta.tone === "positive"
          ? "#16A34A"
          : bestDelta.tone === "negative"
            ? "#DC2626"
            : "#718096";

      const dateIso =
        outcome.kind === "allocated" && outcome.allocated_at
          ? outcome.allocated_at
          : outcome.created_at.slice(0, 10);

      const originalStrategy =
        outcome.match_decision?.original_strategy ?? null;
      const replacementStrategy = outcome.replacement_strategy ?? null;

      const pillS = pillStyle(pill);

      return (
        <Fragment>
          <tr
            className="border-b border-[#E2E8F0] last:border-b-0 hover:bg-[#F8F9FA] transition-colors"
            style={{ height: 44 }}
          >
            <td className="px-2 py-2" style={{ width: 32 }}>
              <button
                type="button"
                onClick={() => onToggle(outcome.id)}
                aria-expanded={isExpanded}
                aria-label={
                  isExpanded
                    ? "Collapse outcome detail"
                    : "Expand outcome detail"
                }
                aria-controls={`outcome-detail-${outcome.id}`}
                className="flex items-center justify-center w-7 h-7 rounded text-[#718096] hover:text-[#1A1A2E] hover:bg-[#F8F9FA] focus-visible:outline-2 focus-visible:outline focus-visible:outline-[#1B6B5A] transition-colors"
              >
                <span
                  aria-hidden="true"
                  className="text-sm inline-block"
                  style={{
                    transform: isExpanded ? "rotate(90deg)" : "none",
                    transition: "transform 150ms ease-out",
                  }}
                >
                  {"\u203A"}
                </span>
              </button>
            </td>

            <td className="px-3 py-2">
              {originalStrategy ? (
                <a
                  href={`/strategies/${originalStrategy.id}`}
                  className="font-sans text-sm font-medium transition-colors hover:underline truncate block"
                  style={{ color: "#1A1A2E" }}
                >
                  {originalStrategy.name}
                </a>
              ) : (
                <span
                  className="font-sans text-sm"
                  style={{ color: "#718096" }}
                >
                  {"\u2014"}
                </span>
              )}
            </td>

            <td className="px-3 py-2">
              {replacementStrategy ? (
                <a
                  href={`/strategies/${replacementStrategy.id}`}
                  className="font-sans text-sm font-medium transition-colors hover:underline truncate block"
                  style={{ color: "#1A1A2E" }}
                >
                  {replacementStrategy.name}
                </a>
              ) : (
                <span
                  className="font-sans text-sm"
                  style={{ color: "#718096" }}
                >
                  {"\u2014"}
                </span>
              )}
            </td>

            <td className="px-3 py-2" style={{ width: 100 }}>
              <span
                className="font-sans text-sm font-medium"
                style={{ color: "#718096" }}
              >
                {formatDate(dateIso)}
              </span>
            </td>

            <td className="px-3 py-2" style={{ width: 180 }}>
              <span
                className="inline-block rounded px-2 py-0.5 text-[11px] font-medium"
                style={pillS}
              >
                {pill.text}
              </span>
            </td>

            <td className="px-3 py-2" style={{ width: 120 }}>
              <span
                className="font-mono text-[13px] tabular-nums"
                style={{ color: bestDeltaColor }}
              >
                {bestDelta.value}
              </span>
            </td>
          </tr>

          {isExpanded && (
            <tr id={`outcome-detail-${outcome.id}`}>
              <td colSpan={colSpan} className="p-0">
                <ExpandedPanel outcome={outcome} curvesCache={curvesCache} />
              </td>
            </tr>
          )}
        </Fragment>
      );
    }

    // Voice-D5 — truncation footer rendered when received outcomes count === 200.
    function TruncationFooter() {
      return (
        <div
          className="px-3 py-2 border-t border-[#E2E8F0]"
          style={{ backgroundColor: "#F8F9FA" }}
        >
          <span
            className="text-xs font-medium"
            style={{ color: "#718096" }}
          >
            Showing most recent 200 — reach out if you need historical export
          </span>
        </div>
      );
    }

    // ---------------------------------------------------- top-level default export

    export default function OutcomesWidget({ data }: WidgetProps) {
      const payload = data as MyAllocationDashboardPayload | undefined;
      const outcomes: OutcomeRow[] | undefined = payload?.outcomes;

      const curvesCache = useRef<Map<string, CurveData>>(new Map());
      const [expandedId, setExpandedId] = useState<string | null>(null);

      const kpis = useMemo(
        () => computeOutcomeKPIs(outcomes ?? []),
        [outcomes],
      );

      // Loading
      if (outcomes === undefined) {
        return (
          <div className="flex h-full flex-col" aria-label="Loading outcomes data">
            <div className="flex h-16 items-center justify-around gap-2 border-b border-[#E2E8F0]">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="h-2.5 w-8 rounded bg-[#E2E8F0] animate-pulse" />
                  <div className="h-4 w-12 rounded bg-[#E2E8F0] animate-pulse" />
                </div>
              ))}
            </div>
            <div className="flex-1 overflow-auto">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-[#E2E8F0] px-3"
                  style={{ height: 44 }}
                >
                  <div className="h-3 w-32 rounded bg-[#E2E8F0] animate-pulse" />
                  <div className="h-3 w-32 rounded bg-[#E2E8F0] animate-pulse" />
                  <div className="h-3 w-16 rounded bg-[#E2E8F0] animate-pulse" />
                  <div className="h-3 w-24 rounded bg-[#E2E8F0] animate-pulse" />
                  <div className="h-3 w-20 rounded bg-[#E2E8F0] animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        );
      }

      // Empty
      if (outcomes.length === 0) {
        return (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <span aria-hidden="true" className="text-2xl" style={{ color: "#718096" }}>
              {"\u25C8"}
            </span>
            <p
              className="font-sans text-sm font-medium"
              style={{ color: "#718096" }}
            >
              Your Bridge outcomes will appear here after you act on one
            </p>
            <a
              href="/holdings"
              className="inline-block rounded-md px-4 py-2 text-sm font-medium"
              style={{ backgroundColor: "#1B6B5A", color: "#FFFFFF" }}
            >
              View Holdings
            </a>
          </div>
        );
      }

      // Populated
      return (
        <div className="flex h-full flex-col">
          <div className="h-16 border-b border-[#E2E8F0]">
            <KpiStrip kpis={kpis} />
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ backgroundColor: "#F8F9FA" }}>
                  <th className="px-2 py-2" style={{ width: 32 }}></th>
                  <th
                    className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider"
                    style={{ color: "#718096" }}
                  >
                    Original
                  </th>
                  <th
                    className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider"
                    style={{ color: "#718096" }}
                  >
                    Replacement
                  </th>
                  <th
                    className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider"
                    style={{ color: "#718096", width: 100 }}
                  >
                    Date
                  </th>
                  <th
                    className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider"
                    style={{ color: "#718096", width: 180 }}
                  >
                    Status
                  </th>
                  <th
                    className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider"
                    style={{ color: "#718096", width: 120 }}
                  >
                    Best Delta
                  </th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((o) => (
                  <TimelineRow
                    key={o.id}
                    outcome={o}
                    colSpan={COL_SPAN}
                    isExpanded={expandedId === o.id}
                    onToggle={(id) =>
                      setExpandedId(expandedId === id ? null : id)
                    }
                    curvesCache={curvesCache}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {outcomes.length === 200 && <TruncationFooter />}
        </div>
      );
    }
    ```

    Run the widget tests. Every W0-01 describe block case (OutcomesWidget / KPI / Timeline / Expanded / Barrel + Voice-D5 truncation + Voice-D9 className-prefixed typography) flips RED->GREEN. Typecheck exits 0.

    Commit `feat(05-01): src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx — single-file widget with inline sub-components (Voice-D1) + Voice-D5 truncation footer (DASHBOARD-01..06, D-01..D-19)`.
  </action>
  <verify>
    <automated>npx vitest run src/app/\(dashboard\)/allocations/widgets/outcomes/outcomes.test.tsx 2>&1 | tail -50 && npm run typecheck 2>&1 | tail -10 && test -f "src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx" && echo "WIDGET_OK" && ls src/app/\(dashboard\)/allocations/widgets/outcomes/ | wc -l</automated>
  </verify>
  <done>
    Single file `OutcomesWidget.tsx` present. Outcomes dir contains exactly 2 files (OutcomesWidget.tsx + outcomes.test.tsx). `npx vitest run ... outcomes.test.tsx` exits 0 — all W0-01 cases pass INCLUDING Voice-D5 truncation + Voice-D9 className-prefixed typography tests. `npm run typecheck` exits 0.
  </done>
</task>

<task type="auto" id="5-01-W2-02">
  <name>Task 5-01-W2-02: Widget registration — types.ts + widget-registry.ts + widgets/index.ts + dashboard-defaults.ts LAYOUT_VERSION bump</name>
  <files>src/app/(dashboard)/allocations/lib/types.ts, src/app/(dashboard)/allocations/lib/widget-registry.ts, src/app/(dashboard)/allocations/widgets/index.ts, src/app/(dashboard)/allocations/lib/dashboard-defaults.ts</files>
  <read_first>
    - `src/app/(dashboard)/allocations/lib/types.ts` — current `WidgetMeta.category` union (line 21)
    - `src/app/(dashboard)/allocations/lib/widget-registry.ts` — structure + `WIDGET_CATEGORIES`
    - `src/app/(dashboard)/allocations/widgets/index.ts` — barrel pattern (default-export line 16; named-export line 67)
    - `src/app/(dashboard)/allocations/lib/dashboard-defaults.ts` — LAYOUT_VERSION + DEFAULT_LAYOUT
    - `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` D-17, D-18, D-19
    - `.planning/phases/05-outcomes-dashboard/05-UI-SPEC.md` §Widget Registration Contract
    - `.planning/phases/05-outcomes-dashboard/05-PATTERNS.md` §21, §22, §23
    - `.planning/phases/05-outcomes-dashboard/05-01-LAYOUT-BUMP-NOTES.md` (W1-09 output — context on LAYOUT_VERSION bump effect)
  </read_first>
  <action>
    Four files:

    (1) `src/app/(dashboard)/allocations/lib/types.ts` line 21 — extend `WidgetMeta.category` union:
    ```typescript
    category: "performance" | "risk" | "allocation" | "attribution" | "positions" | "monitoring" | "intelligence" | "meta" | "outcomes";
    ```

    (2) `src/app/(dashboard)/allocations/lib/widget-registry.ts`:
    - Locate the last entry in `WIDGET_REGISTRY` (before the constant's closing `}`). Insert:
    ```typescript
      // ── Outcomes (1) ─────────────────────────────────────────────────
      "outcomes-timeline": {
        id: "outcomes-timeline",
        name: "Bridge Outcomes",
        category: "outcomes",
        icon: "\u25C8",
        defaultW: 12,
        defaultH: 5,
        description: "Timeline of recorded Bridge outcomes with win-rate KPIs and delta sparklines.",
        status: "ready",
      },
    ```
    - In `WIDGET_CATEGORIES`, append after the `meta` entry:
    ```typescript
      { id: "outcomes" as const, name: "Outcomes", icon: "\u25C8" },
    ```

    (3) `src/app/(dashboard)/allocations/widgets/index.ts` — before the closing `};` of `WIDGET_COMPONENTS`:
    ```typescript
      // ── Outcomes (1) ───────────────────────────────────────────────────
      "outcomes-timeline": lazy(() => import("./outcomes/OutcomesWidget")),
    ```

    (4) `src/app/(dashboard)/allocations/lib/dashboard-defaults.ts`:
    - Change `export const LAYOUT_VERSION = 1;` to `export const LAYOUT_VERSION = 2;` and update the block comment:
    ```typescript
    /**
     * Bump this version whenever the default GRID layout changes materially.
     * The useDashboardConfig hook compares this against the persisted
     * (localStorage) version and resets to defaults when it differs.
     *
     * Sprint 4: NOT bumped (InsightStrip/health score live ABOVE the grid).
     * Sprint 8 Phase 5: bumped 1 -> 2 to force the Outcomes widget into
     * existing user layouts on next page load (D-18). Side effect: users
     * with localStorage-persisted custom layouts will lose their
     * customizations. Server-side impact is zero-measurable (storage is
     * local, not DB). See 05-01-LAYOUT-BUMP-NOTES.md (Voice-D8).
     */
    export const LAYOUT_VERSION = 2;
    ```
    - Append new entry to `DEFAULT_LAYOUT`:
    ```typescript
      { i: "outcomes-timeline-1", widgetId: "outcomes-timeline", x: 0, y: 22, w: 12, h: 5 },
    ```

    Run typecheck + barrel smoke test. Commit `feat(05-01): widget registration — outcomes category + outcomes-timeline slug + LAYOUT_VERSION 1->2 (D-17, D-18, D-19, Voice-D8 note)`.
  </action>
  <verify>
    <automated>npm run typecheck 2>&1 | tail -10 && npx vitest run src/app/\(dashboard\)/allocations/widgets/outcomes/outcomes.test.tsx -t "Barrel export" 2>&1 | tail -15 && grep -c '"outcomes-timeline"' src/app/\(dashboard\)/allocations/lib/widget-registry.ts && grep -c "LAYOUT_VERSION = 2" src/app/\(dashboard\)/allocations/lib/dashboard-defaults.ts</automated>
  </verify>
  <done>
    `npm run typecheck` exits 0. Barrel smoke test passes. `outcomes-timeline` key present in widget-registry.ts. `LAYOUT_VERSION = 2` present in dashboard-defaults.ts.
  </done>
</task>

<!-- ======================== WAVE 3 — NOT NULL MIGRATION + ROADMAP + VISUAL REVIEW + PHASE GATE ======================== -->

<task type="auto" id="5-01-W3-01">
  <name>Task 5-01-W3-01: ROADMAP.md amendment — strike "READ-ONLY" per D-20d + reference migrations 064 + 065</name>
  <files>.planning/ROADMAP.md</files>
  <read_first>
    - `.planning/ROADMAP.md` — Phase 5 section (lines 86-100)
    - `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` D-20d
  </read_first>
  <action>
    Edit `.planning/ROADMAP.md`:

    1. Phase 5 Plans list (around line 100) — update the single plan bullet to reference both migrations:
    ```markdown
    - [ ] 05-01: migration 064 (match_decisions.original_strategy_id NULL-allowed + ON DELETE RESTRICT, send_intro_with_decision 6-arg RPC replacement) + follow-up migration 065 (NOT NULL tightening) + admin send-intro wiring + single-file `OutcomesWidget.tsx` (inline KpiStrip / TimelineTable / TimelineRow / ExpandedPanel / Sparkline per Voice-D1) + delta sparkline integration + empty / loading / error / partial / truncation states + grid registration + unit + component + parity tests
    ```

    2. Scan the Phase 5 block for the word "READ-ONLY"; remove the containing clause/sentence.

    3. Append a short note immediately under the Phase 5 "Success Criteria" heading:
    ```markdown
    **Schema amendment:** migration 064 (`match_decisions.original_strategy_id`) adds a new column (NULL-allowed, `ON DELETE RESTRICT`) AND replaces `send_intro_with_decision` with a 6-arg signature at the start of Phase 5 — locked by 05-CONTEXT.md D-20a (revised) after research confirmed the underperformer identity was not persisted. Follow-up migration 065 tightens the column to NOT NULL in Wave 3 after admin UI has been confirmed shipping values (Voice-C3). Column placement is on `match_decisions` (not `bridge_outcomes`) because the identity is known at intro-send time, not at outcome-record time. Per D-20d, the original "READ-ONLY" scope note has been superseded.
    ```

    Commit `docs(05-01): ROADMAP.md — strike READ-ONLY, reference migrations 064 + 065 (D-20d revised, Voice-C3)`.
  </action>
  <verify>
    <automated>grep -c "READ-ONLY" .planning/ROADMAP.md ; grep -c "migration 064" .planning/ROADMAP.md ; grep -c "original_strategy_id" .planning/ROADMAP.md ; grep -c "match_decisions" .planning/ROADMAP.md ; grep -c "065" .planning/ROADMAP.md</automated>
  </verify>
  <done>
    `grep -c "READ-ONLY" .planning/ROADMAP.md` returns 0. `grep -c "migration 064" .planning/ROADMAP.md` returns >=1. `grep -c "original_strategy_id" .planning/ROADMAP.md` returns >=1. `grep -c "match_decisions" .planning/ROADMAP.md` returns >=1. `grep -c "065" .planning/ROADMAP.md` returns >=1. Commit landed.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking" id="5-01-W3-02">
  <name>Task 5-01-W3-02 [BLOCKING, NEW per Voice-C3]: Apply migration 065 (NOT NULL tightening) via supabase db push — guarded by DO block</name>
  <what-built>Migration file `supabase/migrations/065_match_decisions_original_strategy_notnull.sql` was created in W0-02 (DO-block-guarded). Migration 064 applied at W1-02 ships the column NULL-allowed; admin UI at W1-04 + route at W1-03 now populate non-null values. If W1-01 chose Option A or B, every new row from intro-send has a non-null value.</what-built>
  <how-to-verify>
    This migration tightens `match_decisions.original_strategy_id` from NULL to NOT NULL. The DO-block guard at the top of the file verifies zero NULL rows exist BEFORE running the `ALTER COLUMN SET NOT NULL`; RAISE EXCEPTION aborts the migration if any NULL row exists.

    PRE-APPLY SANITY CHECK (human-run):
      `select count(*) from match_decisions where original_strategy_id is null;`
    Expected: 0.

    - If count = 0: proceed with apply.
    - If count > 0: HALT. Investigate — admin UI may not have shipped, OR legacy rows were inserted outside the RPC path, OR a bug. Do not force NOT NULL; fix the source first.

    APPLY PATH (same options as W1-02):

    PREFERRED: `supabase db push` from the repo root. Expected stdout: `"Applying migration 065_match_decisions_original_strategy_notnull.sql..."`.

    ALTERNATE: Supabase MCP `mcp__supabase__apply_migration` with:
      - `project_id`: `khslejtfbuezsmvmtsdn`
      - `name`: `match_decisions_original_strategy_notnull`
      - `query`: paste the SQL EXCEPT the outer `BEGIN;` / `COMMIT;` (MCP manages its own transaction).

    POST-APPLY: the schema smoke test Case 1 assertion (`is_nullable === 'NO'`) should now pass. Run `npx vitest run src/__tests__/match-decisions-schema.test.ts` — must exit 0 with HAS_LIVE_DB=1 (or advertise skip).

    If RAISE EXCEPTION from the pre-tighten guard fires ("% match_decisions rows have NULL original_strategy_id"), DO NOT override — investigate + re-apply once NULLs resolved.

    Type `approved` once migration 065 is live AND schema smoke test Case 1 confirms `is_nullable='NO'`.
  </how-to-verify>
  <resume-signal>Type "approved" once migration 065 is applied, zero NULL rows confirmed, and schema smoke test Case 1 passes `is_nullable='NO'`.</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking" id="5-01-W3-03">
  <name>Task 5-01-W3-03 [NEW per Voice-D9]: Visual typography review — human DevTools confirmation of rendered Geist Mono + DM Sans</name>
  <what-built>W0-01 added `"className presence check:"`-prefixed test cases that assert the tailwind class strings are present on KPI + body elements. These prove CLASS ATTACHMENT but not rendered typography. Voice-D9 requires a human to open the widget in DevTools and confirm the actual fonts load + render correctly.</what-built>
  <how-to-verify>
    1. Start the dev server: `npm run dev`.
    2. Log in as a demo allocator (see MEMORY.md `quantalyze-test` keychain entry for credentials) and load `/allocations`.
    3. Confirm the Outcomes widget is visible (default-visible per D-18).
    4. If there are no outcomes, add one via the Holdings banner first (Phase 1 flow) so the widget renders the KPI strip + timeline table, OR mock the data by temporarily injecting a seed via the browser console + re-render.
    5. Open DevTools → Elements panel. Inspect each:
       - A KPI value (e.g. the `TOTAL` number or `WIN RATE` number). In the Computed tab, verify `font-family` contains `"Geist Mono"` (or the Geist Mono fallback). Verify `font-variant-numeric` contains `tabular-nums`.
       - A KPI label (e.g. the `TOTAL` text above the number). Verify `font-family` contains a DM Sans fallback OR the app's default sans family.
       - A timeline-row strategy-link cell. Verify `font-family` is a DM Sans fallback; size is 14px.
       - A status-pill text span. Verify `font-size` is 11px + `font-weight` is 500+ (medium).
    6. If typography matches UI-SPEC: type `"confirmed"` with a brief note (e.g. `"confirmed — Geist Mono on KPI values, DM Sans on labels/body"`).
    7. If typography is wrong: STOP + surface a fix (likely a missing `next/font` import or a tailwind class typo) + loop back to W2-01.
  </how-to-verify>
  <resume-signal>Type "confirmed" with a one-line observation note once DevTools confirms rendered Geist Mono on KPI values + DM Sans on labels/body + tabular-nums alignment on numerics. If wrong: describe the issue and return to W2-01.</resume-signal>
</task>

<task type="auto" id="5-01-W3-04">
  <name>Task 5-01-W3-04 [PHASE GATE]: full suite + typecheck + lint + security greps + optional HAS_PY_ENV parity + write SUMMARY.md</name>
  <files>.planning/phases/05-outcomes-dashboard/05-01-SUMMARY.md (NEW)</files>
  <read_first>
    - `.planning/phases/05-outcomes-dashboard/05-VALIDATION.md` §Validation Sign-Off
    - `.planning/phases/05-outcomes-dashboard/05-01-LAYOUT-BUMP-NOTES.md` (W1-09 output)
    - `.planning/phases/05-outcomes-dashboard/VOICES-ACCEPTED.md` — all 11 accepted findings for SUMMARY fold-in
    - `$HOME/.claude/get-shit-done/templates/summary.md` — SUMMARY structure template
  </read_first>
  <action>
    Run the full phase gate. Every check below MUST exit 0:

    1. `npm test` — full Vitest suite green (~12s).
    2. `npm run typecheck` — TS compile green.
    3. `npm run lint` — ESLint green.
    4. `grep -rn "dangerouslySetInner" "src/app/(dashboard)/allocations/widgets/outcomes/"` returns ZERO lines (T-05-04 mitigation — React text-escape only).
    5. `grep -rn 'src="http' "src/app/(dashboard)/allocations/widgets/outcomes/"` returns ZERO lines (T-05-05 mitigation — no external resources).
    6. Schema smoke (if HAS_LIVE_DB): `npx vitest run src/__tests__/match-decisions-schema.test.ts src/__tests__/outcomes-join-rls.test.ts` green. Voice-D3 Case 4 (`delete_rule='RESTRICT'`) passes. Voice-D11 live-DB nested-join test passes.
    7. Optional Voice-D2 parity (if HAS_PY_ENV): `cd analytics-service && HAS_PY_ENV=1 python -m pytest tests/test_outcomes_kpi_parity.py -v`. If unavailable, mark as skipped in SUMMARY.md.

    If any required step fails, STOP and fix — do not mark the phase complete.

    Write SUMMARY to `.planning/phases/05-outcomes-dashboard/05-01-SUMMARY.md` per the template, documenting:

    ```markdown
    ---
    phase: 05-outcomes-dashboard
    plan: 01
    status: complete
    completed: <YYYY-MM-DD>
    ---

    # Phase 5, Plan 01 — SUMMARY (Outside-Voices-revised ship)

    ## What Shipped
    - Migration 064 applied (timestamp + method: supabase db push OR MCP; if MCP, reconciliation SQL used). NULL-allowed, ON DELETE RESTRICT (Voice-C3 + D3). Old 5-arg send_intro_with_decision RPC dropped; new 6-arg RPC live.
    - Migration 065 applied (timestamp + method). NOT NULL tightening guarded by DO-block verified zero NULL rows.
    - W1-01 decision: **<Option A | Option B>** — <one-line description of chosen source + the UI change it required>.
    - Admin route: POST /api/admin/match/send-intro accepts + forwards original_strategy_id.
    - Admin UI: SendIntroPanel plumbs original_strategy_id into POST body per W1-01.
    - Read side: getMyAllocationDashboard fan-out extended with 8th Promise.all entry; .limit(200) cap (Voice-D5); .eq("allocator_id", userId) ownership gate (Voice-D4 regression-asserted by TC outcomes-05); nested match_decision.original_strategy embed.
    - Curves endpoint: GET /api/bridge/outcome/[id]/curves with match_decisions resolution + dedicated bridgeOutcomeCurvesLimiter (60/min per user — Voice-D10).
    - Widget: single-file OutcomesWidget.tsx with inline KpiStrip / TimelineTable / TimelineRow / ExpandedPanel / Sparkline sub-components (Voice-D1). files_modified total: <N>.
    - Registration: outcomes category + outcomes-timeline slug + LAYOUT_VERSION 1->2.
    - Parity: outcomes-kpi.ts matches Phase 4 _success_value byte-for-byte via tests/fixtures/outcomes-kpi-parity.json (avgRealizedDelta = 0.00333... via most-mature delta — Voice-D2 math resolution). Python parity harness at analytics-service/tests/test_outcomes_kpi_parity.py (HAS_PY_ENV-gated).
    - ROADMAP amended: strike READ-ONLY, reference migrations 064 + 065.

    ## Voice-D8 — LAYOUT_VERSION bump impact
    Documented in 05-01-LAYOUT-BUMP-NOTES.md. Storage is localStorage (not DB). Zero-measurable server-side impact; no banner added. Follow-up trigger: user reports of "my dashboard reset itself".

    ## Voice-D10 — Rate-limit keying outcome
    Added `bridgeOutcomeCurvesLimiter = makeLimiter(60, "60 s")` export to src/lib/ratelimit.ts. Curves route uses it. Keeps curve-exploration separate from userActionLimiter (5/min sensitive POSTs). 60/min sized for 3 rows × 3 windows × several re-expands per session.

    ## Voice-D9 — Visual typography review
    <paste the human-reviewer note from W3-03 here, e.g. "confirmed — Geist Mono on KPI values, DM Sans on labels/body, tabular-nums aligned.">

    ## Voice-D12 — Admin changes v1-only
    The p_original_strategy_id capture in send_intro_with_decision and the SendIntroPanel plumbing are admin-side v1 implementations. If Phase 6+ introduces a portfolio-aware admin bridge flow that already carries the underperformer identity in its native state, revisit whether this wiring is still the simplest write-path. Migration 064 remains the load-bearing invariant — the admin UI is incidental.

    ## Threat dispositions
    - T-05-01 (curves leak): mitigated — ownership-before-admin; tested by route TC2 + outcomes-join-rls.test.ts cross-allocator isolation.
    - T-05-02 (DoS): mitigated — bridgeOutcomeCurvesLimiter 60/min; tested by route TC6.
    - T-05-03 (admin tampering): mitigated — isAdminUser gate + string validation + FK enforcement.
    - T-05-04 (XSS): mitigated — grep confirmed zero dangerouslySetInnerHTML in widget dir.
    - T-05-05 (referer leak): mitigated — grep confirmed zero external src="http" in widget dir.

    ## Verification outcomes
    - `npm test`: <PASS / N tests>
    - `npm run typecheck`: PASS
    - `npm run lint`: PASS
    - `grep dangerouslySetInner`: 0 matches
    - `grep src="http'`: 0 matches
    - `HAS_LIVE_DB` tests: <PASS N cases | skipped, skip reason advertised>
    - `HAS_PY_ENV` parity test: <PASS | skipped — no local Python env>

    ## VALIDATION.md row coverage
    5-01-W0-01 through 5-01-W3-04 all ✅.

    ## Follow-ups / open questions
    - None blocking. Voice-D8 follow-up trigger (user report of layout reset) stays in the monitoring bucket.
    ```

    Commit `docs(05-01): 05-01-SUMMARY.md — phase complete, all Outside Voices findings folded, all gates green`.
  </action>
  <verify>
    <automated>npm test 2>&1 | tail -10 ; npm run typecheck 2>&1 | tail -5 ; npm run lint 2>&1 | tail -5 ; grep -rn "dangerouslySetInner" "src/app/(dashboard)/allocations/widgets/outcomes/" | wc -l ; grep -rn 'src="http' "src/app/(dashboard)/allocations/widgets/outcomes/" | wc -l ; test -f .planning/phases/05-outcomes-dashboard/05-01-SUMMARY.md && echo "SUMMARY_OK"</automated>
  </verify>
  <done>
    All required gate checks pass. `npm test` + `npm run typecheck` + `npm run lint` all exit 0. Both grep security checks return 0 matches. SUMMARY.md file exists. Commit landed.
  </done>
</task>

</tasks>

# Phase 188: TINYBASE - Pattern Map

**Mapped:** 2026-11-03
**Files analyzed:** 19 (5 new, 14 modified)
**Analogs found:** 19 / 19 (the one pure-module has a role-match analog; no file is analog-less)

All paths are repo-relative; Python paths under `analytics-service/`. Every analog was checked with `git ls-files` and is tracked source (no `.gsd/capabilities` mirror is named). Cite by symbol: line numbers rot.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `services/tiny_base.py` (NEW) | utility (pure predicate + constants) | transform | `services/nav_twr.py` `_guard_denominator` + its constants (`PNL_DOM_RATIO`, `DUST_NAV_FLOOR`) | role-match |
| `services/nav_twr.py` (mod) | service (pure core) | transform | itself: `chain_linked_twr` `pnl_dominated_guard` block, `NAV_TWR_GUARD_KEYS`, `NavTWRMeta` | exact |
| `services/nav_marks_apply.py` (mod) | service (pure core) | transform | itself: `apply_marks` `usable(base)` branch, `MarkedSeries` | exact |
| `services/job_worker.py` (mod, 3 call-site hunks) | service (job) | batch / CRUD | itself: `_key_inputs_payload["dropped_day_pnl"]` assembly; `_prestamp_flags` block; the `apply_marks(` call in `run_derive_broker_dailies_job` | exact |
| `services/allocator_equity_derive.py` (mod, only if `dropped_day_pnl_payload` needs a P&L-source parameter) | service | transform | itself: `dropped_day_pnl_payload`, `read_dropped_day_pnl` | exact |
| `services/allocator_equity_compose.py` (mod, one hunk) | service | transform | itself: the `dropped_days` dict built just before `portfolio_returns(` in `compose_allocator_equity` | exact |
| `services/analytics_runner.py` (mod) | service | transform | itself: `_NavmtmFlags` / `_read_navmtm_flags` / `_covered_days` block | exact |
| `tests/test_tiny_base.py` (NEW) | test | unit | `tests/test_nav_twr.py` guard tests (`test_pnl_dominated_guard_boundary_is_inclusive`, `..._rides_registry`) | role-match |
| `tests/test_tiny_base_venues.py` (NEW) | test | parametrized unit | `tests/test_allocator_equity_dropped_day_pnl.py` parametrized `Book` + `combine_*` imports | role-match |
| `tests/test_allocator_equity_dropped_day_pnl.py` (mod: `Book.is_dropped` + key-C fixture) | test | unit (exact oracle) | itself | exact |
| `tests/test_allocator_equity_dropped_day_returns.py` (mod: two-key and sole-key arms) | test | unit | itself | exact |
| `tests/test_nav_marks_apply.py` (mod: key-C marked-era arm) | test | unit | itself: `test_a_base_under_the_dust_floor_is_a_gap`, `test_compose_roll_reproduces_every_marked_level` | exact |
| `tests/test_nav_marks_compose_roundtrip.py` (mod, optional regression arm) | test | integration (real derive + real compose, in-memory supabase) | itself | exact |
| `tests/test_nav_twr.py` (mod: guard + registry arms) | test | unit | itself | exact |
| `tests/test_csv_analytics_runner.py` (mod: `-k tiny` arm) | test | unit | itself (covered-days / boundary arms) | exact |
| `src/lib/factsheet/headline-basis.ts` (mod) | utility (closed table) | transform | itself: `GuardReason`, `GUARD_FLAGS`, `GUARD_REASON_PHRASES` | exact |
| `src/lib/factsheet/headline-basis.test.ts` (mod) | test | unit | itself | exact |
| `src/lib/queries.ts` (mod, `readMarksStart` family) | service (SSR reader) | request-response (RLS read) | itself: `readMarksStart` options-cash-basis branch | exact |
| `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx` (+ new `*.tiny-base.test.tsx`) | component | request-response | `UnpricedAccountNote` + `AllocationDashboardV2.unpriced-account.test.tsx` | exact |
| `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` (mod, only if Open Question 3 resolves to a new seam label) | component | render | itself: `gapNodes` seam | exact |

No migration. No new package.

---

## Pattern Assignments

### `services/tiny_base.py` (utility, transform) - NEW

**Analog:** `services/nav_twr.py` (constants + `_guard_denominator`). The research proposal for the body is in `188-RESEARCH.md` ("Pattern: the pure definition"); keep it, with these repo conventions applied.

**Module shape to copy** (docstring that states purity, `from __future__ import annotations`, `Final` constants, then a pure function). From `nav_twr.py` module docstring:

```python
Purity: stdlib + pandas + numpy + in-repo discipline only. No network, no I/O,
no DB, no logging of raw NAV/flow USD values (account-size leak - T-73-02).
```

**Constants pattern** (`nav_twr.py`): `PNL_DOM_RATIO = 10.0` sits beside a comment naming the phase and decision. `TINY_BASE_FRACTION` and `TINY_BASE_WINDOW_DAYS` are the ONLY home of 0.05 and 30 (D-03); every other file imports the name, tests restate the literals.

**Guard-helper pattern** (`nav_twr._guard_denominator`): returns the flag key or `None`, never a substituted value.

```python
def _guard_denominator(prev_nav: float, dust_floor: float = DUST_NAV_FLOOR) -> str | None:
    if prev_nav <= 0:
        return "negative_nav_guard"
    if prev_nav < dust_floor:
        return "dust_nav_guard"
    return None
```

**Error pattern** (`nav_twr` / `nav_marks_apply._finite`): non-finite input raises with static text, no USD magnitude (T-73-02, T-115-05). Copy `nav_marks_apply._finite` + `MarkApplyRefusal` for the discipline; do not add a new refusal token unless `MARK_APPLY_REFUSAL_TOKENS` is deliberately extended (the test `test_the_token_set_is_closed` pins that set).

---

### `services/nav_twr.py` (service, transform) - realized-era seam

**Analog:** itself. Three edits, all append-only.

**1. Guard call-site pattern** (`chain_linked_twr`, the `pnl_dominated_guard` block, after `_guard_denominator`):

```python
        guard_key = _guard_denominator(prev, floors.dust_nav)
        if guard_key is not None:
            flags[guard_key] = True
            continue  # break the chain-link for this day; NEVER substitute
        ...
        pnl_t = cur - prev - flow_t
        if abs(pnl_t) >= PNL_DOM_RATIO * prev:
            flags["pnl_dominated_guard"] = True
            continue

        returns[t] = (cur - prev - flow_t) / prev
```

Place the tiny-base check as a third `continue` here (after `pnl_dominated_guard`, before `returns[t] = ...`), and on the timed path before `_timed_day_return` (the `day_timing is not None` branch, judged on `prev`, not a cohort base: assumption A1). Judge on the calendar-day window of `nav`, which is SPARSE (Pitfall 6): compute `tiny_base_days(...)` once before the loop and test membership, do not re-derive per row.

**2. Registry pattern** (`NAV_TWR_GUARD_KEYS` tuple): append the new key at the END; its comment says "adding a guard is a one-line edit that propagates by construction" (`transforms._merge_status_meta`, `analytics_runner` lift lists, `job_worker` pre-stamp loop iterate it).

```python
NAV_TWR_GUARD_KEYS: tuple[str, ...] = (
    "dust_nav_guard",
    "negative_nav_guard",
    "pnl_dominated_guard",
    ...
)
```

**3. Meta typing pattern:** `NavTWRMeta` is a TypedDict with one `bool` per guard (`pnl_dominated_guard: bool`). The existing test pins `set(NAV_TWR_GUARD_KEYS) <= set(NavTWRMeta.__annotations__)`, so add the annotation in the same edit.

**Test analog (same file's tests):** `tests/test_nav_twr.py::test_pnl_dominated_guard_breaks_and_flags_interior_day` (RED-then-GREEN, "Reverting the call-site guard ... reddens the isnan assert (mutation-honest)"), `test_pnl_dominated_guard_boundary_is_inclusive` (boundary at exactly the cap), `test_below_cap_pnl_day_passes_through_unguarded` (byte-identity partner), `test_pnl_dominated_guard_rides_registry`. Mirror all four for the new guard: tiny day NaN + flag; exactly 5% boundary; 31st-day roll-off and a short-history key never tiny; registry membership.

---

### `services/nav_marks_apply.py` (service, transform) - marked-era seam

**Analog:** itself, the `usable(base)` branch of `apply_marks`.

**Core pattern to extend:**

```python
    def usable(base: float) -> bool:
        return math.isfinite(base) and base > dust_floor
    ...
    for md, nav in zip(mark_days, navs):
        gap = _days_between(prev_day, md)
        has_row = False
        if level_prev is not None:
            base = level_prev + sum(flows.get(g, 0.0) for g in gap)
            if usable(base):
                day_result = nav - base - flows.get(md, 0.0)
                rows.append((md, day_result / base))
                writer_day_pnl[md.isoformat()] = day_result
                has_row = True
        # A flow on a day with no return steps the compose's level by the flow (rule 8).
        for g in gap if has_row else [*gap, md]:
            if g in flows:
                writer_day_pnl[g.isoformat()] = 0.0
        level_prev = nav
        prev_day = md
```

**What changes (RESEARCH Pitfall 2, the trap):** a tiny-base mark must NOT take the "no usable base" exit, which omits the row and lands the day in `covered_days`/`mark_gap_days`. It must emit an explicit NaN row AND `writer_day_pnl[md] = nav - base - flows.get(md, 0.0)` (the real P&L), so the compose level stays exact. Keep the NAVMTM pin: `replay_key_equity` must still reproduce every marked level.

**Structure pattern:** `MarkedSeries` is a `NamedTuple` and every constructor call is positional in two places (the empty-marks early return `MarkedSeries(returns.copy(), None, (), {}, (), {}, {}, None, None, (), {})` and the final return). Append the new field at the END and update BOTH. Also grep for other constructors of `MarkedSeries` in `tests/` before editing.

**Peak input (Open Question 4):** add an optional keyword (research proposes `prior_levels=None`), mirroring `writer_terminal`'s optional-keyword style in the signature, with the same "needs X: programming error `ValueError`" guard idiom. `_writer_level_before(start, parsed_terminal, pnl, writer_flows)` is the existing helper that rolls a level back from the writer terminal; generalise it rather than add a second roll.

**Tests to extend** (`tests/test_nav_marks_apply.py`): copy the structure of `test_a_base_under_the_dust_floor_is_a_gap` and `test_a_mark_with_no_usable_base_is_a_gap_the_next_mark_covers` for the "no return row" arm, and `test_compose_roll_reproduces_every_marked_level` (uses `replay_key_equity`) for the level pin. File conventions to keep: every test imports `services.nav_marks_apply as nma` INSIDE the body (a missing module fails at call time, not collection), oracles computed in the test, synthetic values only.

---

### `services/job_worker.py` (service/job, batch) - three call-site hunks only

**Analog:** itself. Hunks go in `run_derive_broker_dailies_job`; touch nothing else (186 works earlier in the same function and in the compose job's key loop).

**Hunk 1 - after `apply_marks(` returns** (the call passes `returns, _apply_flows, _marks_in, day_pnl=_apply_day_pnl, roll_basis=_apply_roll, dust_floor=_apply_dust_floor, flow_instants=_apply_instants, writer_terminal=_apply_writer_terminal`). Pass the new optional keyword here; the refusal handling (`except MarkApplyRefusal as _apply_exc: _marks_refusal = _apply_exc.token`) is unchanged.

**Hunk 2 - the `dropped_day_pnl` assembly:**

```python
        if _day_pnl_usd is not None:
            from services.allocator_equity_derive import dropped_day_pnl_payload

            _key_inputs_payload["dropped_day_pnl"] = dropped_day_pnl_payload(
                returns, _day_pnl_usd
            )
```

`dropped_day_pnl_payload(returns, day_pnl)` only emits a row for a NaN day in `returns` that has a P&L in `day_pnl`; it refuses a non-finite amount with `NavReconstructionError`. For the marked era the P&L source for a tiny mark day is `_applied_marks.writer_day_pnl`, not `_day_pnl_usd` (the realized P&L). Decide the merge inside the call-site hunk (a dict/Series union), keep `dropped_day_pnl_payload`'s contract and its non-finite refusal untouched.

**Hunk 3 - strategy pre-stamp:**

```python
    _prestamp_flags: dict[str, Any] = {"csv_source": True}
    for _flag in NAV_TWR_GUARD_KEYS:
        if meta.get(_flag):
            _prestamp_flags[_flag] = True
    ...
    if _applied_marks is not None:
        _prestamp_flags["marks_since"] = _applied_marks.marks_since
        _prestamp_flags["marks_covered_from"] = _applied_marks.covered_from
        if _applied_marks.mark_gap_days:
            _prestamp_flags["mark_gap_days"] = list(_applied_marks.mark_gap_days)
```

The new guard flag rides the `NAV_TWR_GUARD_KEYS` loop for free. The marked-era tiny days need their own present-only key (ISO day list, like `mark_gap_days`; booleans/dates only, T-73-02), and the comment convention applies: "NEVER members of NAV_TWR_GUARD_KEYS ... a NOTE the factsheet reads". The prestamp REPLACES `data_quality_flags` wholesale, so a re-derive without tiny days clears it.

**Import-block rule:** do not reformat or re-sort the import block around `from services.allocator_equity_derive import (` (186 adds names too); add imports inside the function body in the existing local-import style (see `from services.allocator_equity_derive import dropped_day_pnl_payload` above) to keep the diff disjoint.

---

### `services/allocator_equity_compose.py` (service, transform) - one hunk

**Analog:** itself. The existing "key sits out the day" path:

```python
    dropped_days: dict[str, set[str]] = {}
    for k in anchored_keys:
        if dropped_pnl.get(k):
            has_return = {str(d) for d in anchored_returns[k].index}
            dropped_days[k] = {str(d) for d in dropped_pnl[k] if str(d) not in has_return}
    book_returns = portfolio_returns(
        per_key_equity,
        anchored_returns,
        departed_keys=departed_present,
        dropped_days_by_key=dropped_days,
    )
```

Edit: union `tiny_base_days(replayed per-key level Series)` into `dropped_days[k]` between the loop and the `portfolio_returns(` call. Do NOT change `portfolio_returns` or `compose_allocator_equity` signatures (186 owns the departed-key path nearby). Levels come from `per_key_equity[k].equity` (`KeyEquity`), the replay output, not re-derived (module rule: "NEVER re-derives; every number comes from allocator_equity_derive").

**Semantics to preserve** (`portfolio_returns` docstring): the excluded key "sits out that day's sums ... counted (`undefined_return_days`) ... It is never read as r = 0 ... a day on which NO key has a defined return is absent from the result." This is Option A in RESEARCH (recommended, rejects r=0, whole-book-null and flow-reentry).

**Tests to extend** (`tests/test_allocator_equity_dropped_day_returns.py`): reuse `_compose(book)`, `_ret(payload)`, `_curve(payload)` helpers and the arm shapes of `test_a_dropped_day_is_absent_from_the_returns_never_zero` (sole key: absent from returns, present in curve), `test_with_several_keys_the_dropped_key_sits_out_and_the_others_carry_the_day` (two-key), `test_a_dropped_day_is_reported_not_silent` (caplog, `missing_return_inside_coverage`). Do NOT reuse `test_the_returns_chained_with_the_flows_reproduce_the_curve_on_every_returned_day` as the oracle for a tiny day: that identity holds only on fully-defined days; a tiny arm states the bounded gap instead.

---

### `services/analytics_runner.py` (service, transform) - covered-days exclusion

**Analog:** itself. Validated flag transport:

```python
_NAVMTM_DAY_KEYS = ("marks_since", "marks_covered_from", "marks_trailing_since")
_NAVMTM_DAY_LIST_KEYS = ("mark_gap_days",)

class _NavmtmFlags(NamedTuple):
    marks_since: str | None
    marks_covered_from: str | None
    mark_gap_days: list[str] | None
    marks_trailing_since: str | None
```

`_read_navmtm_flags` drops a malformed key "with one warning that names the key and the reason and never the value". Add the new ISO-day-list key to `_NAVMTM_DAY_LIST_KEYS`, append a field to `_NavmtmFlags` and its constructor, same validation (`_is_iso_calendar_day`).

**Core hunk** (the `else:` branch with `_boundary`): `_covered_days` is built as every absent day on or after the boundary. Subtract the pre-stamped tiny days from that list so they become gap spans (flagged), not covered days (Pitfall 3). Also check the later `data_quality_flags["marks_covered_from"] = ...` copy-through (`if _navmtm.marks_covered_from is not None:`) and mirror it for the new key if the published row must carry it.

**Test analog:** `tests/test_csv_analytics_runner.py` covered-days / boundary arms (`grep -a "marks_covered_from"`), add `-k tiny`.

---

### `tests/test_tiny_base.py` and `tests/test_tiny_base_venues.py` (NEW)

**Analogs:** `tests/test_nav_twr.py` (guard arms with a "mutation-honest" docstring naming what reverting reddens) and `tests/test_allocator_equity_dropped_day_pnl.py` (imports of the four `combine_*` families).

**Imports to copy** (from `test_allocator_equity_dropped_day_pnl.py`):

```python
from services.broker_dailies import (
    combine_mt5_deal_ledger,
    combine_native_ledger,
    mt5_day_pnl,
    native_ledger_day_pnl,
)
from services.external_flows import ExternalFlow
from services.native_nav import NativeLedger
from services.nav_twr import chain_linked_twr, level_day_pnl
```

Plus `combine_realized_and_funding` / `combine_sfox_balance_history` for the other two venues. Parametrize across venues with ids as that file does. Test restates the literals (`_TINY_FRACTION = Fraction(1, 20)`, window 30), never imports them from `tiny_base.py` (same discipline as `_DUST`, `_PNL_DOM` there: "restated here as a literal, never read from the module it checks").

**Neuter-and-restore (SC-3 gate integrity):** the plan records, in the SUMMARY, that reverting `tiny_base_days` to `return frozenset()` turns the new tests RED, restored from a byte backup (never `git checkout`/`stash`).

---

### `tests/test_allocator_equity_dropped_day_pnl.py` (test, exact oracle) - extend, do not copy

**Analog:** itself. `Book` is a forward exact-`Fraction` ledger; the restated guard rule is:

```python
    def is_dropped(self, i: int) -> bool:
        prev, p = self.prev[i], self.pnl[i]
        return (
            prev <= 0
            or prev < _DUST
            or abs(p) >= _PNL_DOM * prev
        )
```

Add the fourth literal clause (start NAV positive and under 5% of the previous-30-calendar-day peak of `self.nav`, restated, window by day index since `_iso(i)` is consecutive days). The pin `test_the_oracle_book_is_what_the_real_writer_produces(book)` (compares `[i for i, v in enumerate(returns) if pd.isna(v)] == book.dropped_idx` against the real `chain_linked_twr`) MUST stay green and is the proof the restatement matches the writer. New fixture shaped like key C per RESEARCH "Exact-arithmetic oracle": funding day, ~29 ordinary days, a withdrawal day leaving a tiny fraction of NAV (still above the 100 dust floor), then P&L of +47% of the residue, -53% of the new residue, -10%. Add it to the existing `@pytest.mark.parametrize` list that feeds the pin test (ids in the file's style, e.g. `"tiny-base-after-withdrawal"`).

---

### `src/lib/factsheet/headline-basis.ts` (utility, closed table)

**Analog:** itself. Closed-table pattern, with a compile-time exhaustiveness guard:

```ts
export type GuardReason = "negative_nav" | "dust_nav" | "pnl_dominated";

const GUARD_FLAGS = [
  ["negative_nav_guard", "negative_nav"],
  ["dust_nav_guard", "dust_nav"],
  ["pnl_dominated_guard", "pnl_dominated"],
] as const satisfies ReadonlyArray<readonly [string, GuardReason]>;

export const GUARD_REASON_PHRASES = {
  negative_nav: "a zero or negative account balance",
  dust_nav: "a near-zero account balance",
  pnl_dominated: "a one-day gain or loss larger than the balance",
} as const satisfies Record<GuardReason, string>;
```

Two reuse routes (Open Question 3, planner decision): (a) NO new copy: map the new flag `["tiny_base_guard", "dust_nav"]` as a fourth table row, appended at the END (join order is table order), reusing the existing `dust_nav` phrase ("a near-zero account balance"; this is the "no new copy" route of 167.1.2.1.1 D-04); (b) new `GuardReason` + phrase (then DESIGN.md check, and the `satisfies Record<GuardReason, string>` makes a missing phrase a compile error). Note `readHeadlineBasis` only reads reasons when `twr_chain_broken === true`; a marked-era tiny day does NOT break the chain (Pitfall 4 / Open Question 1), so the book note, not the headline line, carries the sentence there.

**Test analog:** `src/lib/factsheet/headline-basis.test.ts` (asserts `reasons: ["negative_nav", "dust_nav", "pnl_dominated"]` and each phrase); extend those expectations and keep the cached-payload tolerance test intact.

---

### `src/lib/queries.ts` (SSR reader, RLS read) - `readMarksStart` family

**Analog:** itself, the 185 `options_cash_basis` branch. Reuse the SAME `allocator_equity_derived` `key_inputs:<id>` read; no new query.

**Imports/constants pattern:** the flag constants live in a tiny shared module (`src/lib/options-cash-basis-flag.ts`: `OPTIONS_CASH_BASIS_FLAG`, `OPTIONS_ACTIVITY_FLAG`, `isOptionsCashBasis`) imported at the top of `queries.ts`. A new additive `key_inputs` field gets its own constant + strict parser in the same style.

**Auth pattern:** the read goes through the owner's RLS client with the allocator filter written out, never the service-role client:

```ts
  const { data, error } = await supabase
    .from("allocator_equity_derived")
    .select("kind, payload")
    .eq("allocator_id", userId)
    .in("kind", includedKeyIds.map((id) => KEY_INPUTS_KIND_PREFIX + id));
```

**Error handling pattern:** on `error`, `console.warn` with the op name, `scheduleDerivedRowCapture(captureToSentry(error, { tags: { op: "getMyAllocationDashboard", reason: "..." }, level: "warning" }))`, then return the safe default. A disclosure FAILS OPEN only when its absence would be a false claim; a missing tiny-base note is recoverable and a false one is not, so for this field fail CLOSED (return `false`/empty), unlike `optionsCashBasis`.

**Validation:** strict ISO-day parse like `parseMarksStart(payload?.[MARKS_SINCE_FLAG])`, `payload` typed `Record<string, unknown> | null`, only the exact shape counts.

**Plumbing path to follow** (research): `key_inputs` -> `readMarksStart` -> returned object field -> the dashboard payload (`optionsCashBasis?: boolean` at the payload type) -> `AllocationDashboardV2` props.

---

### `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx` (component)

**Analog:** `UnpricedAccountNote` in the same file (muted `<p role="status">`, `text-sm text-text-secondary`; built from sorted labels, `joinAnd`, `formatCloseDay`). The `optionsCashBasis = false` prop default (destructured near `optionsCashBasis = false,`) and its pass-through (`optionsCashBasis,` at the two call sites) are the plumbing pattern for a boolean/array caveat prop.

Copy rule: muted token, 12px caption tier in the v2 factsheet surface (4-size / 2-weight contract), no new colour, one line. Any new sentence needs a DESIGN.md read first (CLAUDE.md rule). Sentence must name the days/keys by the owner's own labels and never a magnitude.

**Test analog:** `AllocationDashboardV2.unpriced-account.test.tsx` (or `...options-caveat.test.tsx`, the closest boolean-caveat arm). Copy its `vi.mock` block verbatim (`InsightStrip`, `AlertBanner`, `EquityChart`, `factsheet-context`, `FactsheetBody`, `allocator-portfolio-payload`) and the `baseProps` object, then assert the note renders for the new prop and is absent otherwise.

---

### `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` (component) - conditional

**Analog:** itself, `gapNodes` (zero-width hatched sliver at `firstIndexAfter(dates, g.end)`), hard-coded label:

```tsx
          <title>{`No data ${g.start} -> ${g.end} (${g.days} days)`}</title>
          ...
            {g.days}d — no data
```

(The file uses an arrow character in `<title>`; copy from the file, not from this excerpt.) `missingSegments[].kind` is the literal `"gap"` today. Only touch this if Open Question 3 resolves to a second `kind` value and a label such as "account nearly empty" (new copy, DESIGN.md check). Otherwise leave the seam untouched and let the book note carry the sentence. Existing arms to mirror if touched: `TimeSeriesChart.coverage-gap.test.tsx`.

---

## Shared Patterns

### "A day with no return" contract (the family to ride, not duplicate)
**Source:** `services/nav_twr.py` (`chain_linked_twr` NaN + flag), `services/allocator_equity_derive.py` (`dropped_day_pnl_payload`, `read_dropped_day_pnl`), `services/allocator_equity_compose.py` (`portfolio_returns(dropped_days_by_key=...)`).
**Apply to:** every Python seam above. NaN day -> never stored in `csv_daily_returns` (`daily_return` is `NOT NULL`; `_reconcile_span_delete` removes the stale row) -> its P&L kept in `key_inputs.dropped_day_pnl` -> compose gives it a level and the key sits out the day's sums. Never `r = 0` (SC-5). No `DegradeReason`, no `_BLOCKING_REASONS` edit (186 owns that block).

### Append-only registries (keeps 186 mergeable in either order)
**Apply to:** `NAV_TWR_GUARD_KEYS` (new key at END), `MarkedSeries` (new field at END, both constructors), TS `GUARD_FLAGS` (new row at END), `_NavmtmFlags` (new field at END). No signature change on `compose_allocator_equity` / `portfolio_returns`. Tests: new files only plus the one `Book.is_dropped` edit.

### No magnitudes in logs, exceptions, flags
**Source:** `nav_marks_apply.MarkApplyRefusal` ("the text is static and never carries an amount"), `nav_twr` T-73-02 header, `_prestamp_flags` comments ("BOOL only ... account-size magnitude").
**Apply to:** `tiny_base.py` errors, the job_worker pre-stamp, `analytics_runner` flag validation. Counts, ISO days and tokens only.

### Mutation-honest tests
**Source:** `tests/test_nav_twr.py` docstrings ("Reverting the call-site guard ... reddens the ... assert (mutation-honest)").
**Apply to:** all new Python tests: each states what reverting reddens; boundary tested at exactly the threshold in both directions; independent oracle (exact `Fraction`, literals restated). Neuter-and-restore from a byte backup is recorded in the SUMMARY.

### Worker-JSONB read defensiveness (TS)
**Source:** `readMarksStart` / `parseMarksStart` / `isOptionsCashBasis`.
**Apply to:** the new `key_inputs` field read: `Record<string, unknown> | null`, strict parse, owner RLS client, fail closed for this field.

### Test import/layout conventions
**Source:** `tests/test_nav_marks_apply.py` header (imports inside test bodies, synthetic values only, oracles in the test), `tests/test_allocator_equity_dropped_day_pnl.py` (`_iso(i)`, `D0`, `Book`). Run pytest only from `analytics-service/`; never `importlib.reload`; always `grep -a`.

### CI gates the plans must satisfy
mypy strict (verbatim from `188-RESEARCH.md`, run from `analytics-service/`); `--cov-fail-under=80`; `npm test`, `npm run typecheck`, `npm run lint` (planning hygiene) for TS tasks; CHANGELOG + `VERSION`/`package.json` byte-equal bump at ship, re-picked from `origin/main` (second of 186/188 to merge re-picks).

## No Analog Found

None. Closest to analog-less:

| File | Role | Data Flow | Note |
|---|---|---|---|
| `services/tiny_base.py` | utility | transform | No existing module computes a rolling-window relative-peak predicate; `_guard_denominator` is the role analog (absolute floor). The body comes from `188-RESEARCH.md` "Pattern: the pure definition"; copy the module header, constants and error discipline from `nav_twr.py`. |
| key-C marked-era fixture | test data | n/a | No existing fixture has a 30-day run into a near-total withdrawal; build it in `Book`'s exact-`Fraction` style (see above) and share it across the apply, compose and runner tests. |

## Metadata

**Analog search scope:** `analytics-service/services/{nav_twr,nav_marks_apply,allocator_equity_derive,allocator_equity_compose,job_worker,analytics_runner}.py`, `analytics-service/tests/` (dropped-day, nav_marks, nav_twr, runner), `src/lib/factsheet/headline-basis.ts`, `src/lib/queries.ts`, `src/app/(dashboard)/allocations/`, `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx`.
**Files scanned:** about 20 read or grepped (large files read by targeted ranges after `grep -a` for symbols).
**Pattern extraction date:** 2026-11-03

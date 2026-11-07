# Phase 203: B3TRUNC - Pattern Map

**Mapped:** 2026-11-07
**Files analyzed:** 2 (1 modified, 1 created)
**Analogs found:** 2 / 2

All analog paths below were checked with `git ls-files` and are tracked source. Code is cited by symbol, not line number. Public repo: no PROD ids, amounts, account numbers or home paths appear here; book and key labels are 202's (b3, k15, C).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `analytics-service/tests/test_e2_equity_curve_layer.py` (modify: add one test, optional per RESEARCH Open Question 1, recommended) | test | transform (pure, I/O-free function over per-key equity series) | same file: `test_unequal_windows_span_union_and_terminal_is_sum_of_anchors`, `test_is_trustworthy_benign_vs_blocking_degradation` | exact |
| `.planning/phases/203-b3trunc-why-book-b3-carries-window-truncated/203-REPORT.md` (create) | records-only report | document (no runtime data flow) | `.planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-REPORT.md` | exact (same RESID-02 lineage, same voice) |

No source under `analytics-service/services/`, `src/`, `supabase/migrations` or `scripts/` is modified (RESEARCH verdict: intended behaviour, D-01 second branch). Do NOT touch `allocator_equity_curve`, `DegradeReason` or `_BLOCKING_REASONS`.

## Pattern Assignments

### `analytics-service/tests/test_e2_equity_curve_layer.py` (test, transform)

**Analog 1:** `test_unequal_windows_span_union_and_terminal_is_sum_of_anchors` (the WR-01 test, section header `# ── Test 7 (WR-01): unequal anchored windows span the UNION, not the ∩ ──`). It is the structural template: build two keys over slices of `_DAYS`, replay each, call `allocator_equity_curve`, assert on `out.flags[...]`.

**Analog 2:** `test_is_trustworthy_benign_vs_blocking_degradation` (section header `# ── C3: is_trustworthy classifies benign vs blocking degradation ──`). It is the template for the `is_trustworthy` / `degrade_reasons` assertions (property names on `AllocatorEquity`).

**Imports pattern** (module top; already present, add nothing unless needed. `DegradeReason` is imported function-locally in the C3 test, copy that style or add it to the top import block):
```python
from __future__ import annotations

import pandas as pd
import pytest

from services.allocator_equity_derive import (
    REASON_NO_ANCHOR,
    AllocatorEquity,
    KeyEquity,
    allocator_equity_curve,
    perf_curve,
    replay_key_equity,
)
from services.external_flows import ExternalFlow
from services.nav_twr import NavReconstructionError
```
C3 test's local import (copy if keeping the import local):
```python
    from services.allocator_equity_derive import DegradeReason, segment_coverage
```

**Fixtures already in the file** (reuse, do not add a new fixtures module; `tests/e2_fixtures.py` is frozen per the file docstring "the frozen shared `tests/e2_fixtures.py` is not edited"):
```python
_DAYS = ["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04"]

def _flat_returns() -> pd.Series:
    """Constant +10% every day (day-0 return is absorbed into equity_0)."""
    return pd.Series([0.10, 0.10, 0.10, 0.10], index=_DAYS, name="key-X")

# Zero-flow anchor 133100 -> backward roll [100000, 110000, 121000, 133100].
_ZERO_FLOW_ANCHOR = 133100.0
```

**Core pattern to copy** (from the WR-01 test; key construction by slicing `_DAYS`, then `replay_key_equity(returns, flows, anchor)`):
```python
    # key-A: +10% over the full 4-day window, anchor 133100 -> [100k,110k,121k,133.1k].
    a = replay_key_equity(_flat_returns(), [], _ZERO_FLOW_ANCHOR)
    b_returns = pd.Series([0.10, 0.10], index=_DAYS[:2], name="key-B")
    b = replay_key_equity(b_returns, [], 121000.0)
    assert list(b.equity.index) == _DAYS[:2]

    out = allocator_equity_curve({"key-A": a, "key-B": b})
    assert out.equity is not None
    assert list(out.equity.index) == _DAYS
    # The truncation/staleness is FLAGGED, never silent.
    assert out.flags["degraded"] is True
    assert out.flags["window_truncated"] is True
    assert out.flags["dropped_keys"] == []
    assert out.flags["n_tail_days_carried"] == 2  # B stale on the last two union days
```
Differences for the new test: the new keys must END on the same last day (slice from the START, e.g. `_DAYS[1:]`, `_DAYS[2:]`, not `_DAYS[:2]`) so `n_tail_days_carried == 0`. Give each key a round anchor that is its own terminal level (use `_ZERO_FLOW_ANCHOR` for the full-window key; any positive finite anchor works for the shorter ones, e.g. `121000.0`). Per RESEARCH A3 the executor confirms helper names by reading the file before writing; the names above are verified in this mapping.

**Trust/reason assertion pattern** (from the C3 test; property names are `out.is_trustworthy` and `out.degrade_reasons`, a `frozenset[DegradeReason]`):
```python
    benign = allocator_equity_curve({"key-A": a, "key-B": b})
    assert benign.flags["window_truncated"] is True
    assert benign.is_trustworthy is True
    assert DegradeReason.WINDOW_TRUNCATED in benign.degrade_reasons
```

**Shape of the new test** (RESEARCH Code Examples, adapted to the verified helpers; executor writes it, planner copies this skeleton into the action):
```python
# ── B3TRUNC (Phase 203): staggered starts + common end == window_truncated ONLY ──

def test_staggered_starts_common_end_carry_window_truncated_only():
    """WHY: a multi-key book whose keys open on different days but all end on the last
    day is window_truncated by construction (any key's first/last day != the union's),
    with NO stale-mark carry and NO rotation, and it stays trustworthy. This is the
    shape of book b3's token (Phase 203): the token is never why a book is untrusted."""
    from services.allocator_equity_derive import DegradeReason

    a = replay_key_equity(_flat_returns(), [], _ZERO_FLOW_ANCHOR)             # opens day 0
    b = replay_key_equity(pd.Series([0.10, 0.10, 0.10], index=_DAYS[1:], name="key-B"), [], 133100.0)
    c = replay_key_equity(pd.Series([0.10, 0.10], index=_DAYS[2:], name="key-C"), [], 121000.0)
    out = allocator_equity_curve({"key-A": a, "key-B": b, "key-C": c})

    assert out.flags["window_truncated"] is True
    assert out.flags["n_tail_days_carried"] == 0
    assert out.degrade_reasons == frozenset({DegradeReason.WINDOW_TRUNCATED})
    assert out.is_trustworthy is True
```
Executor must verify the rotation classifier does not fire on this key set (RESEARCH's local replay with seven staggered-start keys produced exactly `['window_truncated']`, so it should not; if `segment_coverage` classifies a seam for the 3-key shape, adjust windows until the reasons set is exactly `{WINDOW_TRUNCATED}`). Optionally add a control assertion in the same test, copying RESEARCH's replay: identical windows give `window_truncated is False` and empty `degrade_reasons`.

**Error handling:** none (pure function, no try/except in the analog tests; refusals are tested with `pytest.raises(NavReconstructionError)` elsewhere in the file, not needed here).

**Neuter-and-see-RED step (data-integrity rule, record in the plan's SUMMARY).** The guarded expression, by symbol, in `allocator_equity_derive.py:allocator_equity_curve`:
```python
    window_truncated = any(
        key_first[k] != union_days[0] or key_last[k] != union_days[-1]
        for k in anchored
    )
```
Procedure: byte-copy `analytics-service/services/allocator_equity_derive.py` into the scratchpad, flip the `!=` pair (e.g. to `==`/`and False`) so the token is never raised, run `cd analytics-service && python3 -m pytest tests/test_e2_equity_curve_layer.py -q -k staggered_starts`, see RED, restore from the byte copy (never `git checkout`, `git restore` or `git stash`), re-run, see GREEN, and confirm `git diff --stat` shows only the test file. Run only from `analytics-service/`. Quick command baseline: 22 tests passed before the addition.

**Gates for a touched analytics file** (RESEARCH Validation Architecture): the touched pytest file plus `tests/test_allocator_equity_writer_basis.py` (asserts `set(payload["degrade_reasons"]) <= {"classified_rotation", "window_truncated"}`), `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` from `analytics-service/`, and `ruff check` on the touched file. If the test is not taken, none of these are needed.

---

### `.planning/phases/203-b3trunc-why-book-b3-carries-window-truncated/203-REPORT.md` (records-only report, document)

**Analog:** `.planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-REPORT.md` (tracked). Copy its shape and voice, scaled down: 202 is a long measurement report, 203 is a short verdict record.

**Header paragraph pattern** (202-REPORT opening; adapt the "who wrote it, what the lines are, what was read" claim to 203):
```markdown
# Phase 202 RESIDCHURN: report

Written by plan 07, 2026-11-07, and updated by plan 08 the same day ... Labels, ISO days, counts, tokens, ratios and commit SHAs only; every figure below appears in a result line of plans 01 to 07 and the lines are the authority. All PROD reads were read-only, through the Supabase MCP, one statement per call, with the marker answer recorded. Nothing was fixed in this phase's analysis plans ...
```
For 203: state labels/ISO days/tokens only, that every figure comes from 202's committed result lines (202-03 and 202-07 SUMMARYs, `gc-c-b3-key`, `gc-c-b3-stored`, `gc-c-b3-truncated`) or from a local replay of the repo's own functions, and that NO PROD read or write was made (or, if an executor with the MCP tool does the optional read of b3's stored `flags`, say marker first, one query per call, answer recorded). Do not claim A1/A2 as verified unless that read happened.

**Section-ordering pattern** (202-REPORT headings: `## Captures`, `## No deploy between`, `## Criterion 1`, `## The 1214`, `## Book b3`, `## Limits`, `## Founder questions, answered ...`). Map for 203:
1. `## Verdict` — intended behaviour, not a defect; D-01 second branch; RESID-02's `window_truncated` half closes with this record.
2. `## The rule` — quote the `window_truncated = any(...)` expression and the `if window_truncated: reasons.add(DegradeReason.WINDOW_TRUNCATED)` line by symbol (`allocator_equity_derive.py:allocator_equity_curve`), the `DegradeReason` header "BENIGN (curve is correct)" and the `_BLOCKING_REASONS` set showing the token is absent. Use fenced code blocks as 202-REPORT uses tables and backticks.
3. `## b3's windows` — the seven-key first/last return-day table from RESEARCH (labels C, k4, k8, k10, k14, k15, k35; venue; first day; last day on c1), plus the stored lines `gc-c-b3-stored` and `gc-c-b3-truncated` verbatim.
4. `## Local replay` — the three-line replay output from RESEARCH verbatim (`staggered starts, common end: True 0 True ['window_truncated']`, `identical windows: False True []`, `one key: False []`) with its column legend, and the committed characterization test name if taken.
5. `## Closure of 202's unexplained` — state it was a predictor-range artefact: 202-03's rule marked `window_truncated` unexplained because b6's line disagreed (predicted yes, stored no); b6's compose hands one key to the curve because `job_worker.py:departed_history_inclusion` excludes an unknown-account departed key by default (D-14, closed "Intended, no flag"); amending the prediction to range over keys the book counts makes all seven books agree. Reference 202-REPORT `## Book b3` (the D-14 finding paragraph) and `202-CONTEXT.md` D-14..D-17 as the source.
6. `## Observation (not booked)` — b3's blocking `out_of_window_flow` is not one of the tokens `untrustworthyRebuildReason` (`src/lib/queries.ts`) maps, so a viewer gets `derivation_rejected`; belongs to 202's closed half and the reader, mentioned once, not booked here.
7. `## Limits` — A1 (key C's equity window reaching the book's last day, inferred from b3 storing neither `stale_mark_carry` nor `classified_rotation`), A2 (`flags.window_truncated` true and `flags.n_keys` 7 on the live row, inferred), both do not change the verdict; the 202 predictor is "close to tautological" and must not be reused as a gate; no re-derive was done and none is needed (D-02 not triggered; a derive would reproduce the token while member windows differ).

**Evidence-style pattern to copy** (202-REPORT's `Book b3` bullets use bold lead-ins, then a stated reading, then a counterfactual):
```markdown
- **`window_truncated` is benign** (it is not a blocking reason, and b2, b5 and b7 carry it while trustworthy). b3's own line agrees on every capture (predicted yes, stored yes) and its stored curve holds all seven members.
```
Carry the same fail-loud tone: name what was inferred vs verified (202 does this in `## Limits`), and do not soften.

**Hygiene rules the report must satisfy** (RESEARCH Pitfall 4, CLAUDE.md, MEMORY):
- Labels only (b3, k15, C); no uuids, amounts, account numbers, PROD ids, home paths.
- No attribution trailers; no CI-skip token even in denial (write "the skip trailer" in prose).
- Verification by grep before commit: `grep -a "allocator_equity_curve" .planning/phases/203-*/203-REPORT.md` finds the symbol; a uuid-shape grep (`[0-9a-f]{8}-[0-9a-f]{4}-`) returns nothing; no `\/Users\/` string.
- A SUMMARY is written only for a plan that ran; the report must not claim a deferred plan.
- Ship branch must change nothing under `.planning` (ship-planning-guard); the REPORT lands through the records path, the test (if taken) through the ship path. Explicit `git add` paths only.
- Note for the CHANGELOG step if a ship happens for the test: unified entry, repo's own section vocabulary (`### Tests` / `### Notes`), VERSION and package.json byte-equal, never `npm version`.

---

## Shared Patterns

### Characterization-test discipline (data-integrity rule)
**Source:** MEMORY "Testing" plus the neuter procedure above.
**Apply to:** the new test. It must be able to fail: neuter the guarded expression, see RED, restore from a byte backup, never git checkout/restore/stash on uncommitted work. The docstring encodes WHY (CLAUDE.md Rule 9), as in the C3 test's docstring ("benign degradation ... keeps `is_trustworthy` True so a normal multi-key allocator's live gate stays meaningful").

### Pure-function test style
**Source:** `analytics-service/tests/test_e2_equity_curve_layer.py` module docstring.
**Apply to:** the new test. Local fixtures only, hand-derivable round numbers, no I/O, no `importlib.reload`, run pytest only from `analytics-service/`, always `grep -a`.

### Cite by symbol
**Source:** CLAUDE.md (citation-drift rule) and CONTEXT.md canonical refs ("re-locate by symbol").
**Apply to:** the report and the test docstring. Name `allocator_equity_derive.py:allocator_equity_curve`, `DegradeReason`, `_BLOCKING_REASONS`, `_is_trustworthy`, `job_worker.py:departed_history_inclusion`, `compose_allocator_equity`, `untrustworthyRebuildReason`; do not write line numbers.

### Tracked-source gate
Every file named above was verified with `git ls-files` (`analytics-service/services/allocator_equity_derive.py`, `analytics-service/tests/test_e2_equity_curve_layer.py`, `analytics-service/tests/e2_fixtures.py`, 202's `202-REPORT.md`). 202's capture kit (`gc-c-*` scripts, c1 books file) is untracked scratch and must not be cited as a source; cite the committed 202-03 and 202-07 SUMMARYs for the same lines.

## No Analog Found

None. Both files have an exact in-repo analog. (The optional PROD read of b3's stored `flags` has no committed script analog because 202's capture kit lived outside the repo; if an executor with the Supabase MCP `execute_sql` tool runs it, it is one read-only query per call, marker query first, and nothing is written.)

## Metadata

**Analog search scope:** `analytics-service/tests/`, `analytics-service/services/allocator_equity_derive.py`, `.planning/phases/202-residchurn-*`
**Files scanned:** 5 read (CONTEXT, RESEARCH, the test file, 202-REPORT, the derive function ranges) plus targeted greps
**Pattern extraction date:** 2026-11-07

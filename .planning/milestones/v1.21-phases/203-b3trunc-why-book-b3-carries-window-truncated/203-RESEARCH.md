# Phase 203: B3TRUNC - Research

**Researched:** 2026-11-07
**Domain:** allocator equity compose, the `window_truncated` degrade reason (Python, `analytics-service/`)
**Confidence:** HIGH on the rule and the verdict (code read this session, and a local replay run this session). MEDIUM on one sub-claim (why key C's equity window reaches the book's last day), tagged `[ASSUMED]` below. No PROD read was possible this session (see Environment Availability).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** If the cause is a defect, 203 FIXES it in code, with a test that goes RED on today's behaviour, and the evidence that b3 no longer carries the flag after the next derive. If the cause is intended behaviour, 203 records the explanation and the evidence, and b3's flag is documented as expected. Either way RESID-02 closes with 203. (Founder 2026-11-07: "Fix it in 203".)
- **D-02:** If the fix needs b3's stored rows re-derived on PROD, 203 may do it ONLY through the product's own derive/recompute path, never with hand SQL. Run the marker query first, take a read-only before/after capture, and report what was written. Rows are not deleted beyond what the derive itself does. (Founder: "Yes, via the product's path, then report".) — **Reversibility:** costly — a derive rewrites stored rows; the before capture is the record.
- **D-03 (standing rules):** PROD reads only through the Supabase MCP, marker query first, one read-only query per call, never a shell DB client or the Keychain. Railway: list operations only, no redeploys. A revoked key affects only itself (the revoked-key-scope rule). An unknown-account key with no venue_account_id is excluded by default (`departed_history_inclusion`, founder-confirmed 2025-09-25).

### Claude's Discretion
- Investigation method and the order of hypotheses, starting from 202's evidence.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RESID-02 | Book b3's earlier reasons (`out_of_window_flow`, `window_truncated`) are explained, and fixed where they are a defect. (REQUIREMENTS.md: mapped to Phase 202 and Phase 203; 202 closed the `out_of_window_flow` half; this phase is the `window_truncated` half.) | The rule that sets the token, its benign classification, the b3 key windows from 202's committed lines, and a local replay of a b3-shaped book. Verdict: intended behaviour, so the closing action is a record (D-01 second branch). |
</phase_requirements>

## Summary

**Verdict: INTENDED BEHAVIOUR, not a defect.** `window_truncated` is set by exactly one expression, in `allocator_equity_derive.py:allocator_equity_curve`: it is true when ANY anchored key's first or last equity day differs from the first or last day of the union of all keys' days. A book whose member keys do not all open and close on the same two days therefore carries it by construction. b3 has seven member keys whose first return days are seven different days (2023-06-28 to 2026-07-29, 202-03 SUMMARY `gc-c-b3-key` lines), so the token is true for b3 regardless of any tail behaviour. The token is classified BENIGN in the closed `DegradeReason` enum and is not in `_BLOCKING_REASONS`: it says "the member windows are unequal", and the code's own docstring says the curve is still correct. b3 is untrustworthy because of `out_of_window_flow` alone (202's finding, already closed as correct behaviour). Three other books (b2, b5, b7) carry the token while trustworthy.

**Why 202 left it "unexplained", and why that is now settled.** 202-03's rule made `window_truncated` `unexplained` whenever the "predicted from member keys' stored first/last day" line disagreed with the stored reason on ANY of the seven books. It disagreed only on b6 (predicted yes, stored no). 202's D-14 finding showed b6's compose hands ONE key to `allocator_equity_curve` (k20 is an unknown-account departed key that `departed_history_inclusion` excludes by default), so b6's curve cannot raise the token. D-14 was closed "Intended, no flag" by the founder. The predictor over-ranged (it used all stored member keys, not the keys the book counts). 202-03 itself named this as option (1): "amend the prediction to range over the keys a book's stored curve actually holds, which makes b6 predicted no and all seven agree". With D-14 closed, that amendment is the correct reading, and `window_truncated` becomes `correct` on all seven books with no new PROD read. b3's own line agreed on every capture (b0, b1, c1: `predicted=yes stored=yes agree=yes`).

**No code change is indicated.** D-01's second branch applies: 203 records the explanation and the evidence, and documents b3's flag as expected. The "re-derive after fix" path (D-02) does not arise; a re-derive would leave the token in place, correctly. Nothing in `src/`, `supabase/migrations`, or `scripts/` consumes the token to change user-facing behaviour (grep result below), so there is no user-facing consequence to fix.

**Primary recommendation:** Plan a records-only phase. One plan writes `203-REPORT.md` (the rule quoted by symbol, the b3 window table, the local replay, the closure of 202's `unexplained`), then the workflow's own bookkeeping ticks RESID-02. Optionally (planner discretion, recommended) add one characterization test pinning "staggered starts with a common end carry `window_truncated` only and stay trustworthy", with a neuter-and-see-RED step. Do NOT change `allocator_equity_curve`, the enum, or `_BLOCKING_REASONS`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Deciding `window_truncated` | API / Backend (analytics-service: `allocator_equity_derive.py:allocator_equity_curve`) | — | Pure function over per-key equity windows; no DB or UI input. |
| Carrying the token into the stored row | API / Backend (`allocator_equity_compose.py:compose_allocator_equity`, then the `derive_allocator_equity` job in `job_worker.py`) | Database (`allocator_equity_derived` row, `payload.degrade_reasons`) | The compose unions every producer's reasons and writes `sorted(r.value for r in reasons)`. `job_worker.py` never sets this token itself. |
| Deciding trust from the reasons | API / Backend (`_is_trustworthy` over `_BLOCKING_REASONS`) | Frontend reader (`untrustworthyRebuildReason` in `src/lib/queries.ts`) | The reader maps only blocking tokens onto copy and never names `window_truncated`. |

## Standard Stack

No new packages. This phase installs nothing, so the Package Legitimacy Audit is not applicable. The code under study uses the repo's existing pinned stack (Python 3.12 per `[tool.mypy] python_version`, pandas, pytest). [VERIFIED: analytics-service/pyproject.toml, `python_version = "3.12"`]

## Architecture Patterns

### The rule (quote verbatim, cite by symbol)

`allocator_equity_derive.py:allocator_equity_curve`, in the block that builds `key_first` / `key_last` over `anchored` keys:

```python
    window_truncated = any(
        key_first[k] != union_days[0] or key_last[k] != union_days[-1]
        for k in anchored
    )
```
[VERIFIED: analytics-service/services/allocator_equity_derive.py, `allocator_equity_curve`, the `window_truncated = any(` expression, read this session]

Then, in the same function:

```python
    if window_truncated:
        reasons.add(DegradeReason.WINDOW_TRUNCATED)
```
[VERIFIED: same function, read this session]

Classification, verbatim:

```python
    # ── BENIGN (curve is correct) ──
    WINDOW_TRUNCATED = "window_truncated"
    STALE_MARK_CARRY = "stale_mark_carry"
    CLASSIFIED_ROTATION = "classified_rotation"
```
and the blocking set:

```python
_BLOCKING_REASONS: frozenset[DegradeReason] = frozenset(
    {
        DegradeReason.UNCLASSIFIED_ROTATION,
        DegradeReason.EXCLUSIVE_FILL,
        DegradeReason.OUT_OF_WINDOW_FLOW,
        DegradeReason.INCEPTION_UNRECONCILED,
        DegradeReason.DROPPED_KEY,
        DegradeReason.NONFINITE_RETURN,
        DegradeReason.SHARED_ACCOUNT_HISTORY_TRUNCATED,
        DegradeReason.SHARED_ACCOUNT_NO_WORKING_KEY,
        DegradeReason.KEY_INPUTS_MISMATCH,
        DegradeReason.SHARED_ACCOUNT_FLOWS_DISAGREE,
        DegradeReason.ACCOUNT_IDENTITY_PENDING,
    }
)
```
[VERIFIED: analytics-service/services/allocator_equity_derive.py, `DegradeReason` and `_BLOCKING_REASONS`, read this session. `WINDOW_TRUNCATED` is absent from the set.]

Key facts the planner needs:

1. **The union and the per-key windows are over `anchored` keys' equity index**, not over stored return rows. A key's equity index is the union of its return days, flow days, dropped days and the writer's P&L days (`replay_key_equity` docstring, "the days replayed are the union of the return days, the flow days, the dropped days AND W"). So "first/last return day" (what 202 measured) approximates, and may differ from, the equity window. This only matters for the tail; the starts differ by months to years, so the token is true for b3 on the starts alone. [VERIFIED: allocator_equity_derive.py `replay_key_equity` docstring]
2. **Which keys reach the function is decided upstream.** `compose_allocator_equity` calls `allocator_equity_curve(per_key_equity, seams=list(seg.seams) + exit_seams)` and does `reasons |= alloc.degrade_reasons`; it writes `"degrade_reasons": sorted(r.value for r in reasons)` and `"is_trustworthy": _is_trustworthy(frozenset(reasons))`. A key the book does not count (a departed key `departed_history_inclusion` excludes) is not in `per_key_equity`, so it cannot raise the token. This is the whole of b6's disagreement. [VERIFIED: analytics-service/services/allocator_equity_compose.py, `compose_allocator_equity`, the `alloc = allocator_equity_curve(` call and the final payload dict, read this session]
3. **`job_worker.py` never sets `window_truncated`.** A grep of `analytics-service/` finds the token only in `services/allocator_equity_derive.py` and in `tests/test_e2_equity_curve_layer.py` and `tests/test_allocator_equity_writer_basis.py`. [VERIFIED: grep -a over analytics-service, this session]
4. **No consumer changes behaviour on the token.** A repo-wide grep (excluding node_modules, .git, .planning, CHANGELOG) for `window_truncated|windowTruncated|window-truncated` hits only the analytics-service files above. `src/lib/queries.ts:untrustworthyRebuildReason` reads `degrade_reasons` and maps only `shared_account_no_working_key`, `failing_key_series_ended`, `account_duplicate`, `account_identity_collision`, `account_identity_pending`, `shared_account_history_truncated`, `shared_account_flows_disagree`, `compose_incomplete`, `compose_empty`; anything else falls to `derivation_rejected`. `scripts/accounttruth-census.mjs` only counts token frequencies. [VERIFIED: grep -a, and reading `untrustworthyRebuildReason`, this session]

### b3's windows (from 202's committed lines; labels only)

From 202-03 SUMMARY (capture b1) and 202-07 SUMMARY (capture c1), the `gc-c-b3-key` lines. First return day per key, all seven on a different day:

| key label | venue | first return day | last return day (c1) |
|---|---|---|---|
| C | deribit | 2023-06-28 | 2026-10-26 |
| k4 | deribit | 2024-12-07 | 2026-11-06 |
| k8 | mt5 | 2025-10-17 | 2026-11-06 |
| k10 | deribit | 2025-09-27 | 2026-11-06 |
| k14 | mt5 | 2026-07-29 | 2026-11-06 |
| k15 | bybit | 2026-01-23 | 2026-11-06 |
| k35 | mt5 | 2026-07-28 | 2026-11-06 |

[VERIFIED: 202-03-SUMMARY.md lines for `gc-c-b3-key: capture=b1 ...` and 202-07-SUMMARY.md lines for `gc-c-b3-key: capture=c1 ...`, read this session]

Stored b3 on c1, verbatim: `gc-c-b3-stored: capture=c1 book=b3 trust=false reasons=out_of_window_flow,window_truncated other_blocking=none` and `gc-c-b3-truncated: capture=c1 book=b3 keys=7 predicted=yes stored=yes agree=yes trustworthy=false`. [VERIFIED: 202-07-SUMMARY.md, read this session]

Cross-book comparison on c1 (scratch `c1/books.json`, labels only): the three trustworthy books that carry `window_truncated` also carry `classified_rotation` (b2, b5, b7). b3 carries no `classified_rotation` and no `stale_mark_carry`. [VERIFIED: 202's untracked capture scratch (c1 books file), read this session; not a repo file]

### Local replay (run this session, no PROD)

A scratch probe (not in the repo) fed the repo's own `replay_key_equity` and `allocator_equity_curve` seven keys with b3's seven first days and one common last day. Output, verbatim:

```
staggered starts, common end: True 0 True ['window_truncated']
identical windows: False True []
one key: False []
```
Columns on the first line: `window_truncated`, `n_tail_days_carried`, `is_trustworthy`, sorted reasons. So staggered starts with a common end produce exactly the b3 stored shape of this token (no stale carry, no rotation, trustworthy on this reason alone), identical windows produce no token, and a single-key book never carries it. [VERIFIED: local run of analytics-service functions, this session; the probe was a session-scratch script, not kept in the repo]

### Anti-Patterns to Avoid

- **Making the token "go away" for b3.** Changing the `any(...)` rule, moving the token into `_BLOCKING_REASONS`, or deleting it from the stored row to green or de-flag b3 would be inventing a fix for intended behaviour. b3's trust is decided by `out_of_window_flow`, and 202's counterfactual showed the zero-start check (`inception_unreconciled`) would still block even if Bybit joined the full-history venue list.
- **Re-deriving b3 on PROD "to see if it clears".** A derive reproduces the token while the member windows differ. It would write rows for no evidential gain (D-02's costly reversibility).
- **Reusing the 202 predictor as a gate.** 202's own report calls the member-keys predictor "close to tautological for a book of several keys". Do not carry it forward as a check; the rule is the thing under study and it is one line.
- **Treating the b6 disagreement as a b3 fact.** b6's omitted key is an unknown-account Bybit key excluded by `departed_history_inclusion` (D-14, closed). It says nothing about b3.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Re-deciding whether a book's token is right | A new PROD capture kit or a new predictor | The repo's own `allocator_equity_curve` over keys with the stored windows (as the local probe does) | The rule is one expression; a replay with the real function cannot disagree with the writer on it. |
| Reading b3's stored state | Hand SQL, a shell DB client | Supabase MCP `execute_sql`, marker first, one query per call (only if a PROD read is wanted at all) | D-03. |
| Recording the explanation | A new ledger or TODOS entry for an intended behaviour | `203-REPORT.md` plus the workflow's own RESID-02 tick | D-01 second branch; nothing is deferred. |

**Key insight:** this is a question about one boolean over a small set of windows. The cheapest correct evidence is the function itself plus 202's already-committed windows.

## Common Pitfalls

### Pitfall 1: Reading the token's name as a data-loss claim
**What goes wrong:** "truncated" reads like rows were cut. **Why it happens:** the token means "a key's window is a strict subset of the union" (the WR-01 docstring), not that data was dropped. **How to avoid:** the report quotes the rule and the enum header ("BENIGN (curve is correct)"). **Warning signs:** a plan task that proposes recovering "missing" days for b3. b3's stored curve spans 2023-06-27 to 2026-11-05 and holds all seven members (`curve_holds_all_members=yes`, 202-03).

### Pitfall 2: Citing the last return day as the tail of the equity window
**What goes wrong:** key C's last return day is 2026-10-26 against 2026-11-06 for the others, which looks like a stale tail. **Why it happens:** the equity index also takes flow, dropped and writer-P&L days. If C's equity ended 2026-10-26 and C were non-rotated, `stale_mark_carry` would be added; if rotated out, `classified_rotation` would be. b3 stores neither, so C's equity window evidently reaches the book's last day. **How to avoid:** do not build a claim on C's tail; the starts alone make the token true. The mechanism for C's tail is `[ASSUMED]` (A1) and not needed for the verdict.

### Pitfall 3: Using 202's `unexplained` word as a finding
**What goes wrong:** the REPORT and CHANGELOG say b3's token "stays unexplained only because of book b6's disagreeing line". **How to avoid:** the report must state it was a predictor-range artefact and that the amended predictor (keys the book counts) gives agreement on all seven books, using 202's own committed lines. Do not quote any PROD id.

### Pitfall 4: Public-repo hygiene
Tracked text uses 202's labels only (b3, k15, C, ...). No uuids, amounts or account numbers. No attribution trailers, no CI-skip tokens even in denial. `git add` explicit paths only. A SUMMARY may be written only for a plan that ran.

## Code Examples

The one worth recording is the rule itself (above) and, if the optional test is taken, a characterization test in the existing file `analytics-service/tests/test_e2_equity_curve_layer.py`, next to `test_unequal_windows_span_union_and_terminal_is_sum_of_anchors` and `test_is_trustworthy_benign_vs_blocking_degradation`. Helpers already in that file: `replay_key_equity`, `allocator_equity_curve`, `_flat_returns`, `_DAYS`. Shape (illustrative; the executor confirms the helper names by reading the file):

```python
def test_staggered_starts_common_end_carry_window_truncated_only():
    """WHY: a multi-key book whose keys open on different days is window_truncated by
    construction, with no stale carry and no rotation, and it stays trustworthy. This is
    the shape of book b3's token (Phase 203): the token is never why a book is untrusted."""
    # keys opening on different days, all ending on the last day, each anchored
    ...
    out = allocator_equity_curve(book)
    assert out.flags["window_truncated"] is True
    assert out.flags["n_tail_days_carried"] == 0
    assert out.degrade_reasons == frozenset({DegradeReason.WINDOW_TRUNCATED})
    assert out.is_trustworthy is True
```
Neuter check (data-integrity rule): copy `allocator_equity_derive.py` to scratch, flip the `!=` pair in the `any(...)` so the token is never raised, run the test, see RED, restore from the byte copy (never git checkout/restore/stash). [ASSUMED: exact helper names and day constants in the test file; read it before writing]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sum curves over the INTERSECTION of key indices, silently dropping non-overlapping tails with `degraded=False` | Sum over the UNION, flag `window_truncated` (WR-01) | Phase 115 review fixes, commit `2a2ea5a3f` (`git log -S"window_truncated"`) | The token is the honest signal that the union is wider than some key's window. |
| `is_trustworthy` blocked on any degradation (never green, LOW-7) | Closed `DegradeReason` enum, benign vs blocking | commit `6cccee512` | A normal multi-key allocator with a benign truncation stays trustworthy. |

[VERIFIED: `git log --oneline -S"window_truncated" -- analytics-service/services/allocator_equity_derive.py`, this session: `6cccee512 fix(115): C3 DegradeReason enum + is_trustworthy; harness gates on it (fixes never-green LOW-7)` and `2a2ea5a3f fix(115): WR-01..04/IN-01..02 allocator-equity review fixes + regressions`]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Key C's equity window reaches the book's last day although its last stored return day is 2026-10-26, via flow, dropped-day or writer-P&L days in the equity index. Inferred from b3 storing neither `stale_mark_carry` nor `classified_rotation`. | Pitfall 2 | Low. The verdict rests on the starts, which differ for all seven keys. If C's tail were a defect it would be a separate stale-carry or rotation finding, not `window_truncated`. A read-only look at b3's stored `flags` (`n_tail_days_carried`, `rotated_out_keys`, `n_keys`) would settle it. |
| A2 | b3's stored `flags.window_truncated` is true and `flags.n_keys` is 7 on the live row. Inferred from the stored reason token plus 202's `keys=7`; the `flags` object itself was not read this session. | Summary | Low; the token is derived from the same boolean. |
| A3 | Exact helper names and day constants in `test_e2_equity_curve_layer.py` for the optional test. | Code Examples | Low; the executor reads the file first. |

## Open Questions

1. **Take the optional characterization test, or records only?**
   - What we know: D-01's intended branch asks only for a record. The existing tests already pin "benign truncation stays trustworthy" but with a stale-mark tail; none pins "staggered starts, common end, token only".
   - What's unclear: whether the founder wants any analytics-service file touched for an intended behaviour (a test-only change still ships through CI and a PR).
   - Recommendation: take it. It is one small test, it encodes the WHY (CLAUDE.md Rule 9), and it stops the next phase rediscovering this. If the planner prefers zero code, the phase is complete without it. This is within Claude's discretion, not a founder decision.
2. **A PROD read of b3's stored `flags` to close A1 and A2.**
   - What we know: not required for the verdict. The Supabase MCP `execute_sql` tool was not offered in this session (see below).
   - Recommendation: optional, read-only, one query per call, marker first, run by an executor that has the tool; if unavailable, the report states A1 and A2 as inferred and does not claim them verified.
3. **Out of scope, noted once.** b3's blocking `out_of_window_flow` is not one of the tokens `untrustworthyRebuildReason` maps, so a viewer of b3 would get the `derivation_rejected` line. That belongs to the `out_of_window_flow` half (closed in 202 as correct behaviour) and to the reader, not to this phase. Not booked here; the planner may mention it in the report as an observation only.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase MCP `execute_sql` (project per brief) | optional PROD read of b3's stored `flags` | ✗ in this session (the server `claude.ai Supabase` is connected but does not offer `execute_sql` here) | — | Skip; verdict stands on code plus 202's committed lines. No shell DB client, no Keychain (D-03). |
| python3 / pytest / mypy / ruff | gates, local replay | ✓ | python3 at /opt/homebrew/bin; `pytest tests/test_e2_equity_curve_layer.py` ran: 22 passed | — |
| Railway | none needed (no deploy, no re-derive) | n/a | — | — |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (asyncio_mode = auto), `pytest.ini` in analytics-service |
| Config file | analytics-service/pytest.ini and analytics-service/pyproject.toml |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_e2_equity_curve_layer.py -q` (22 passed, 5.6 s, this session) |
| Full suite command | CI's invocation, by symbol: the `python` job's step `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (`grep -n 'cov-fail-under' .github/workflows/ci.yml`). It runs against a local-stack lane in CI; the executor runs the touched test files, not the full suite. Never `importlib.reload` in tests. |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RESID-02 (window_truncated) | Staggered starts, common end: token raised, no stale carry, trustworthy | unit (optional, recommended) | `python3 -m pytest tests/test_e2_equity_curve_layer.py -q -k staggered_starts` | ❌ Wave 0 (new test in an existing file) |
| RESID-02 | Existing: unequal windows flag the token and stay trustworthy | unit | `python3 -m pytest tests/test_e2_equity_curve_layer.py -q -k "unequal_windows or benign_vs_blocking"` | ✅ |
| RESID-02 | The record: `203-REPORT.md` quotes the rule, the b3 window table, the replay output, the closure of 202's `unexplained` | manual-only (document), checked by grep that the report names the rule symbol and carries no uuid | `grep -a "allocator_equity_curve" .planning/phases/203-*/203-REPORT.md` and a uuid-shape grep returning nothing | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the quick command above (if the test is taken).
- **Per wave merge:** that file plus `tests/test_allocator_equity_writer_basis.py` (it asserts `set(payload["degrade_reasons"]) <= {"classified_rotation", "window_truncated"}`).
- **Phase gate:** from `analytics-service/`: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (the `Type gate - mypy strict over the running-service surface` step of the `python` job in `.github/workflows/ci.yml`), the touched pytest files, and `ruff check` on touched files (ruff is installed locally; a grep of `.github/` and the analytics config finds no ruff step, so it is a local hygiene check, not a CI gate). If no analytics file is touched, mypy and pytest are not needed and the gate is the records hygiene (no uuids, no attribution trailers, explicit `git add`).

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_e2_equity_curve_layer.py` — add the staggered-starts characterization test (only if taken), with the neuter-to-RED step recorded in the SUMMARY.
- [ ] `.planning/phases/203-b3trunc-why-book-b3-carries-window-truncated/203-REPORT.md` — the record.

## Security Domain

`security_enforcement` is not set to false in this research's inputs, so it is treated as enabled. This phase changes no endpoint, input parsing, auth or crypto.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | no | no new input; the optional test uses synthetic series |
| V6 Cryptography | no | — |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Leaking PROD ids, amounts or account numbers into a public repo's tracked text | Information disclosure | Labels only (b3, k15, ...); grep the report for uuid shapes before commit |
| An unintended PROD write | Tampering | None planned; reads only via MCP, marker first; a re-derive is not needed |

## Sources

### Primary (HIGH confidence)
- `analytics-service/services/allocator_equity_derive.py` (`allocator_equity_curve`, `DegradeReason`, `_BLOCKING_REASONS`, `_is_trustworthy`, `replay_key_equity`, `FULL_HISTORY_VENUES`) — read this session
- `analytics-service/services/allocator_equity_compose.py` (`compose_allocator_equity`) — read this session
- `analytics-service/tests/test_e2_equity_curve_layer.py` — read this session, 22 passed
- `src/lib/queries.ts` (`untrustworthyRebuildReason`) — read this session
- `.planning/phases/202-*/202-REPORT.md`, `202-CONTEXT.md` (D-11..D-17), `202-03-SUMMARY.md`, `202-07-SUMMARY.md` — read this session
- `.github/workflows/ci.yml` (mypy step, pytest step) and `analytics-service/pyproject.toml` — read this session
- `git log -S"window_truncated"` on the derive file — run this session

### Secondary / Tertiary
- Untracked 202 capture scratch (the c1 books file) for the cross-book token shapes. Scratch, not a repo artefact; the committed 202 SUMMARYs carry the same b3 lines.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (nothing new).
- Architecture / rule: HIGH (code read, local replay agrees with the stored b3 shape).
- Verdict "intended": HIGH. Residual: A1 and A2 are inferred, not read from PROD, and neither changes the verdict.
- Pitfalls: HIGH.

**Research date:** 2026-11-07
**Valid until:** until `allocator_equity_curve`, `DegradeReason` or `_BLOCKING_REASONS` changes (re-read by symbol; a phase touching them voids this)

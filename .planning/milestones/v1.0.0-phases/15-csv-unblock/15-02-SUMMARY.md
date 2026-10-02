---
phase: 15-csv-unblock
plan: 02
subsystem: api
tags: [pandera, fastapi, csv, validation, python-multipart, pii-redaction]

# Dependency graph
requires:
  - phase: 15-01
    provides: "migration 093 strategy_verifications table + finalize_csv_strategy SECURITY DEFINER RPC (consumed by Next.js layer in plan 15-05; this plan does NOT call the RPC)"
provides:
  - "validate_csv(raw_bytes, fmt) pure-logic service returning the v0 envelope shape"
  - "Three pandera DataFrameSchemas (daily_returns / daily_nav / trades) enforcing 6 CSV-02 rules"
  - "Inline _redact_preview helper masking PII column values for preview rendering"
  - "POST /api/csv/validate FastAPI multipart endpoint (rate-limited 30/hour)"
  - "10 MB defense-in-depth at the analytics-service request boundary"
affects:
  - 15-04 (Next.js wizard CSV branch — proxies multipart through to /api/csv/validate)
  - 15-06 (E2E spec — exercises the validate endpoint against fabricated CSV bodies)
  - 16-OBSERV-06 (correlation_id slot is forward-compat; Phase 16 populates it without changing envelope shape)
  - 18-FIX-04 (Python redact.py supersedes the inline _redact_preview helper)

# Tech tracking
tech-stack:
  added:
    - "pandera==0.20.4 (new dependency)"
    - "python-multipart==0.0.27 (new dependency, only multipart route in service)"
  patterns:
    - "Pure-logic service module pattern (S7): no FastAPI / no Supabase imports; callable from router AND worker"
    - "Per-format pandera schema dispatch via SCHEMAS dict[str, pa.DataFrameSchema]"
    - "Lazy error collection (lazy=True) — all rule violations returned at once, not first-fail"
    - "Inline PII column-name redaction (cross-AI revision 2026-04-30) — masks values whose column name matches /^.*(account|email|user|customer|wallet|address).*$/i"
    - "Logger discipline: row index + rule name only; raw cell data is NEVER logged"
    - "v0 envelope shape with correlation_id: None forward-compat slot for Phase 16 / OBSERV-06"

key-files:
  created:
    - "analytics-service/services/csv_validator.py (pure-logic validator)"
    - "analytics-service/routers/csv.py (FastAPI multipart router — validate-only)"
    - "analytics-service/tests/test_csv_validator.py (11 pytest tests)"
  modified:
    - "analytics-service/requirements.txt (added pandera + python-multipart pins)"
    - "analytics-service/main.py (import csv from routers + include_router)"

key-decisions:
  - "_check_trading_window rule DROPPED entirely — crypto markets trade 24/7"
  - "/api/csv/finalize endpoint REMOVED — Next.js layer calls supabase RPC directly because SECURITY DEFINER asserts auth.uid() = p_user_id"
  - "Inline _redact_preview helper for Phase 15; full Python redact.py deferred to Phase 18 / FIX-04"
  - "Logger discipline locked: row index + rule name only, never raw row data"

patterns-established:
  - "Per-format pandera SCHEMAS dict with error= rule keys verbatim from UI-SPEC §8.8"
  - "FastAPI multipart route pattern (UploadFile + Form) — first multipart route in this service"
  - "v0 error envelope shape: {ok, code, human_message, debug_context, correlation_id: None}"
  - "10 MB cap enforced at BOTH the Next.js proxy (plan 15-04) and the analytics-service router boundary (defense-in-depth)"

requirements-completed: [CSV-01, CSV-02]

# Metrics
duration: ~6min (335s)
completed: 2026-05-01
---

# Phase 15 Plan 02: Python pandera CSV validator + FastAPI multipart router Summary

**Pure-logic pandera validator with 3 per-format schemas (daily_returns / daily_nav / trades), 6 CSV-02 rules collected lazily into a v0 envelope with PII-redacted preview, plus a thin FastAPI multipart wrapper at POST /api/csv/validate.**

## Performance

- **Duration:** ~6 min (335 seconds — first commit to last commit)
- **Started:** 2026-05-01T03:14:37Z
- **Completed:** 2026-05-01T03:20:12Z
- **Tasks:** 3 (Task 2 used TDD — 2 commits: RED + GREEN)
- **Files modified:** 5 (3 created, 2 modified)
- **Tests written:** 11 (all passing)

## Accomplishments

- pandera 0.20.4 + python-multipart 0.0.27 pinned in requirements.txt with Phase 15 comment header — no other pin altered.
- `analytics-service/services/csv_validator.py` exports `validate_csv(raw_bytes, fmt)` as a pure-logic service (no FastAPI / no Supabase imports). Three pandera schemas enforce all 6 CSV-02 rules; `lazy=True` collects all errors at once.
- Inline `_redact_preview` helper masks values whose column name matches `/^.*(account|email|user|customer|wallet|address).*$/i` before serializing `preview.first_rows` and `preview.last_rows`.
- `analytics-service/routers/csv.py` exposes only `POST /api/csv/validate` (multipart) — the previously-planned `/api/csv/finalize` echo endpoint was REMOVED entirely (cross-AI revision 2026-04-30 — dead code).
- 11 pytest tests pass on first GREEN run, including the weekend-pass regression (`_check_trading_window` is dead) and PII-redaction coverage.
- `analytics-service/main.py` imports `csv` from routers and registers `app.include_router(csv.router)` alongside the seven existing routers.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pin pandera + python-multipart in requirements.txt** — `51417e4` (chore)
2. **Task 2 (RED): Add failing tests for CSV pandera validator** — `20a654b` (test)
3. **Task 2 (GREEN): Implement pandera CSV row-schema validator** — `fd27918` (feat)
4. **Task 3: Add FastAPI csv router with /api/csv/validate (multipart)** — `a282d95` (feat)

_Note: Task 2 used TDD (`tdd="true"`) so it has two commits — RED gate (failing test) + GREEN gate (passing implementation). REFACTOR was not needed: the implementation matched the plan's prescribed shape exactly._

## Files Created/Modified

- **Created:** `analytics-service/services/csv_validator.py` (320 LOC) — pure-logic pandera validator with 3 schemas + `_check_sharpe_sentinel` post-check + inline `_redact_preview` helper + main `validate_csv` entry point.
- **Created:** `analytics-service/routers/csv.py` (86 LOC) — FastAPI multipart router with `/api/csv/validate`, slowapi rate limit (30/hour), 10 MB cap, HTTPException envelopes for `CSV_FILE_TOO_LARGE` / `CSV_INVALID_FORMAT` / `CSV_VALIDATION_FAILED` / `CSV_UPSTREAM_FAIL`.
- **Created:** `analytics-service/tests/test_csv_validator.py` (261 LOC) — 11 pytest tests with helper factories for daily_returns / daily_nav / trades CSV bytes.
- **Modified:** `analytics-service/requirements.txt` — appended Phase 15 comment header + `pandera==0.20.4` + `python-multipart==0.0.27`.
- **Modified:** `analytics-service/main.py` — added `csv` to the routers import (line 42) and `app.include_router(csv.router)` (line 210).

## Decisions Made

- **`_check_trading_window` is intentionally absent.** Cross-AI revision 2026-04-30: crypto markets trade 24/7; flagging weekend dates would fail every real customer CSV. Documented in module docstring + inline comment at the post-check call site. Total trading_window references in the file: 2 (both documentation-only — no live code path).
- **`/api/csv/finalize` endpoint REMOVED entirely.** Cross-AI revision 2026-04-30: the Next.js layer calls the supabase `finalize_csv_strategy` SECURITY DEFINER RPC directly because that RPC asserts `auth.uid() = p_user_id`, which only the user-JWT path satisfies — service-role calls have NULL `auth.uid()`. The previously-planned echo endpoint was pure dead code; deleting it is a strict improvement.
- **`models/schemas.py` left untouched.** No `CsvFinalizeRequest` Pydantic body class is needed because no finalize endpoint exists. Iteration 1 of the plan added it; iteration 2 (cross-AI revision) drops it.
- **Logger discipline locked.** `logger.warning("[csv-validator] rule violation row=%d rule=%s", ...)` — never `logger.warning("...%s", row.get("failure_case"))`. Raw cell values are NEVER logged. Phase 18 / FIX-04 will harden this further with the full Python `redact.py` walker; Phase 15 ships only the column-name match.

## Deviations from Plan

**None of substance — plan executed exactly as written, with one micro-trim.**

### Documentation trim during GREEN phase

- The first iteration of `csv_validator.py` had **3** `_check_trading_window` / `trading_window` comment references (1 in module docstring + 1 schema-section header + 1 inline post-check note + 1 prefix-block — 4 total). The acceptance criterion required ≤ 2.
- Fix: collapsed the redundant prefix-block comment and the schema-section header. Final file has exactly 2 doc-only references: 1 in the module docstring, 1 inline at the post-check call site. Both are pure documentation — no live code path mentions `trading_window`.
- This was a doc-comment-only change made before any commit; it did NOT alter behavior. Tests passed both before and after the trim. Not tracked as a Rule 1/2/3 deviation because it was a planned cleanup driven by the explicit acceptance count.

**Total deviations:** 0 auto-fixes. **Impact on plan:** None.

## Issues Encountered

- **Local Python 3.14 incompatibility with pandera 0.20.4.** The host system Python is 3.14; pandera 0.20.4's `multimethod` dependency uses `typing.Union` as a base type which 3.14 forbids. Resolved by running pytest under Python 3.13 (also installed locally) inside a scratch venv at `analytics-service/.test-venv-15-02/`. The scratch venv was deleted after testing — it is git-ignored via the project's `*.venv/` rule, so it never appeared in `git status`. Production deployment runs the analytics service on Python 3.12 / 3.13 per Railway runtime config; this is purely a local-test concern.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 15-04 (Next.js wizard CSV branch)** can now POST multipart `(file, fmt, wizard_session_id)` to `POST /api/csv/validate` once the analytics service is restarted with the new pin set installed. The proxy must also enforce its own 10 MB cap (defense-in-depth — the analytics service enforces independently).
- **Plan 15-05 (Next.js csv-finalize route)** must call `supabase.rpc('finalize_csv_strategy', {...})` directly. There is no `/api/csv/finalize` analytics endpoint — that surface was removed by cross-AI revision because the SECURITY DEFINER RPC asserts `auth.uid() = p_user_id`, which only the user-JWT path satisfies.
- **Phase 16 / OBSERV-06** can populate the `correlation_id: None` slot in every envelope return path without changing the JSON shape. The slot is present on success, on validation soft-fail, on empty-bytes early-return, on parse-error, and on every HTTPException detail body.
- **Phase 18 / FIX-04** will ship `analytics-service/services/redact.py` with the full denylist + value-shape detectors. Until then, `_redact_preview` is the ONLY redaction gate on the CSV path; logs are scrubbed by the logger discipline (row index + rule name only).

## Verification Evidence

```
$ grep -c '^pandera==0.20.4$' analytics-service/requirements.txt
1
$ grep -c '^python-multipart==0.0.27$' analytics-service/requirements.txt
1
$ grep -c "def validate_csv" analytics-service/services/csv_validator.py
1
$ grep -c "lazy=True" analytics-service/services/csv_validator.py
1
$ grep -c "from fastapi" analytics-service/services/csv_validator.py
0
$ grep -c "from supabase" analytics-service/services/csv_validator.py
0
$ grep -c "def _redact_preview" analytics-service/services/csv_validator.py
1
$ grep -c "_redact_preview(" analytics-service/services/csv_validator.py
3
$ grep -c '_check_trading_window\|trading_window' analytics-service/services/csv_validator.py
2     # both doc-comment-only; no live code path
$ grep -c '"correlation_id": None' analytics-service/services/csv_validator.py
4
$ grep -c '@router.post("/csv/validate")' analytics-service/routers/csv.py
1
$ grep -c '@router.post("/csv/finalize")' analytics-service/routers/csv.py
0     # endpoint REMOVED 2026-04-30
$ grep -c 'app.include_router(csv.router)' analytics-service/main.py
1
$ grep -c 'class CsvFinalizeRequest' analytics-service/models/schemas.py
0     # schemas.py intentionally untouched
$ python -m pytest tests/test_csv_validator.py -x
======================== 11 passed, 1 warning in 0.15s =========================
$ python -c 'from routers import csv; from services.csv_validator import validate_csv'
OK
```

## Self-Check

| Item | Status |
|---|---|
| `analytics-service/requirements.txt` modified, both new pins present | ✓ FOUND |
| `analytics-service/services/csv_validator.py` created | ✓ FOUND |
| `analytics-service/routers/csv.py` created | ✓ FOUND |
| `analytics-service/tests/test_csv_validator.py` created | ✓ FOUND |
| `analytics-service/main.py` modified (import + include_router) | ✓ FOUND |
| Commit `51417e4` (Task 1: requirements.txt) | ✓ FOUND |
| Commit `20a654b` (Task 2 RED: failing tests) | ✓ FOUND |
| Commit `fd27918` (Task 2 GREEN: csv_validator.py) | ✓ FOUND |
| Commit `a282d95` (Task 3: csv router + main.py wiring) | ✓ FOUND |
| 11/11 pytest tests passing | ✓ FOUND |
| Branch unchanged (`v1.0.0-api-key-rewrite-15-16`) | ✓ FOUND |

## TDD Gate Compliance

Task 2 (`tdd="true"`) followed the RED → GREEN cycle:

- **RED (`20a654b`)** — `test(15-02): add failing tests for CSV pandera validator`. Verified the tests failed with `ModuleNotFoundError: No module named 'services.csv_validator'` before the implementation landed.
- **GREEN (`fd27918`)** — `feat(15-02): implement pandera CSV row-schema validator`. Tests pass on the first GREEN run; 11/11 green.
- **REFACTOR** — Not needed. The implementation matched the plan's prescribed shape exactly. The only post-write change was a documentation-comment trim (collapsed redundant `trading_window` references from 4 to 2) which was applied before the GREEN commit landed and is therefore part of `fd27918`.

Plan-level gate sequence visible in git log: `test(15-02)…` precedes `feat(15-02): implement…` precedes `feat(15-02): add FastAPI csv router…`.

---
*Phase: 15-csv-unblock*
*Plan: 02*
*Completed: 2026-05-01*

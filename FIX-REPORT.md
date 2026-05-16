# PR #181 Take-2 Apply Pass FIX-REPORT (2026-05-16)

Branch: `chore/silent-failure-sweep-analytics-2026-05-16`
Worktree: `/Users/helios-mammut/claude-projects/quantalyze-worktrees/silent-failure-sweep`
Threshold applied: CRITICAL=all, HIGH conf>=7, MED conf>=8, LOW=skip.
Scope: `analytics-service/services/{metrics,exchange}.py` + accompanying tests only.

## Specialist apply matrix

7 proper specialists wrote findings under `.review/`:

| File | Findings | Actionable (passed threshold) |
|---|---|---|
| `.review/specialist.code-reviewer.jsonl` | 7 | 1 MED conf-8 (subsumed by F18) |
| `.review/specialist.silent-failure-hunter.jsonl` | 13 | 3 HIGH + 5 MED conf>=8 |
| `.review/specialist.type-design-analyzer.jsonl` | 10 | 4 MED conf-8 |
| `.review/specialist.pr-test-analyzer.jsonl` | 7 | 2 MED actionable + complementary tests |
| `.review/specialist.security.jsonl` | 8 | 1 MED conf-8 (F7) |
| `.review/specialist.performance.jsonl` | 7 | 0 (all LOW conf-7) |
| `.review/red-team.jsonl` | 12 | 4 HIGH + 6 MED actionable |

## Apply queue and status

| ID | Severity | Conf | Specialist(s) | Status | Commit |
|---|---|---|---|---|---|
| F1 | HIGH | 9 | silent-failure-hunter + code-reviewer + red-team | CLOSED — removed qs.stats.gini dead call (gini absent from qs 0.0.81) | 1 |
| F2 | HIGH | 9 | red-team-new | CLOSED — var_1d_95 kwarg fixed from `cutoff=0.05` to `confidence=0.95` | 1 |
| F3 | HIGH | 8 | silent-failure-hunter | CLOSED — fetch_mark_prices Binance/Bybit per-row drops now log WARNING with sym + unparseable value | 1 + tests in 4 |
| F4 | HIGH | 8 | silent-failure-hunter | CLOSED — OKX bills aggregator non-digit ts now logs WARNING with billId/billType (mirrors Binance/Bybit severity, not the asymmetric ERROR) | 1 + tests in 4 |
| F5 | HIGH | 8 | red-team-chain | CLOSED — Bybit ISO-conversion now atomic (build-then-extend); mid-loop failure discards partial state so daily_pnl stays uniform | 1 + tests in 4 |
| F6 | HIGH | 8 | red-team-new | CLOSED — returns_nonnan_len_for_log threaded through all 11 inline WARNINGs alongside raw returns_len_for_log | 1 |
| F7 | MED | 8 | security | CLOSED — Binance WARNING now scrubs str(exc) via services.redact.scrub_freeform_string (Pass 1 catches `signature=<HMAC>`); exc_info=True dropped on that site (HMAC plaintext was in traceback first line). Bybit V5 path left exc_info=True (V5 signs via header, not URL — per security finding LOW conf-6) | 3 + test |
| F8 | MED | 8 | type-design | CLOSED — `RSquaredStatus = Literal['no_benchmark', 'ok', 'error']` added; assigned at all 3 sites | 2 |
| F9 | MED | 8 | type-design | CLOSED — compute_qstats_scalars return type narrowed from `dict[str, float \| None \| str]` to `QstatsScalarsResult` TypedDict | 2 |
| F10 | MED | 8 | type-design | CLOSED — removed 3 fictional `*_error` JSONB keys (drawdown_episodes_error, benchmark_metrics_error, benchmark_returns_error) — repo-wide grep confirmed zero consumers | 2 |
| F11 | MED | 8 | type-design | PARTIAL (F10 removes inconsistent `*_error: str` shape; full discriminator-pattern migration of 11 inline scalars deferred — too invasive for this PR) | 2 |
| F12 | MED | 9 | silent-failure-hunter | CLOSED — test_bybit_api_timeout docstring rewritten to describe post-sweep contract (WARNING is the load-bearing signal; observable result unchanged) | 4 |
| F13 | MED | 7 | silent-failure-hunter | CLOSED — added test_bybit_iso_conversion_overflow_emits_warning exercising true ISO-conversion path via 22-digit createdTime overflow; also pins F5 atomicity contract | 4 |
| F14 | MED | 8 | silent-failure-hunter | PARTIAL (F4 covered the OKX bills aggregator silent-drop; OKX paginator break with no partial=true signal documented out-of-scope) | docs |
| F15 | MED | 8 | red-team-new | DEFERRED — Sentry breadcrumb scrubber gap is in sentry_init.py (outside this PR's scope). F7's drop of exc_info=True on the Binance signed-URL site removes the largest exposure surface. F16's traceback rate-limit caps fleet-wide breadcrumb volume. Full Sentry-side fix tracked separately. | n/a |
| F16 | MED | 8 | red-team-new | CLOSED — module-level `_FAIL_LOUD_TRACEBACK_EMITTED` + `_should_emit_traceback(scalar, exc)` helper. First (scalar_name, exc-type) occurrence per process emits full traceback; subsequent occurrences emit single-line WARNING. Threaded through all 11 inline WARNING sites + _safe_qstats_scalar helper. Autouse conftest fixture resets the set per-test. | 3 |
| F17 | MED | 8 | pr-test | CLOSED — 3 caplog tests added to TestSafeFloat pinning DEBUG-vs-WARNING contract for NaN + string + None paths | 3 |
| F18 | MED | 8 | silent-failure-hunter | CLOSED — `if value is None: return None` fast-path added before try/except in _safe_float. sanitize_metrics' recursive walk now skips legitimate-None paths without emitting DEBUG. | 3 |

## Deferred / out-of-scope (tracked for follow-up)

- **F14 OKX paginator partial-truncation** (silent-failure-hunter MED #4): the `break` in the paginator at exchange.py:432-434, 467-469 returns truncated data without any `partial=true` signal. The PR description scoped this out as pre-existing. Recommended follow-up: thread a `(daily_pnl, partial: bool)` tuple through fetch_daily_pnl OR raise a typed `OkxBillsPartialFetchError`.
- **F15 Sentry breadcrumb scrubber** (red-team-new MED #6): sentry_init.py's `_redact_before_send` walks exception locals but not breadcrumb-level stacktrace frames. Out of scope (sentry_init.py is not in this PR's file set). F7+F16 reduce the practical exposure surface; full fix is a separate PR.
- **F11 full discriminator-pattern migration** (type-design): F10 + F8 + F9 cover the highest-confidence pieces. Migrating all 11 inline scalars to a `result/status` discriminator pair is invasive (touches 11 try blocks + every consumer) — defer.
- **Various LOW-severity findings** (code-reviewer #2 helper-extension, #5 per-scalar comment cleanup, #6 outlier-mean fragility, type-design #1/#2/#3/#8/#9/#10, perf all 7, security 4 LOWs): below threshold, not applied. See `.review/specialist.*.jsonl` for full text.

## Test summary

- analytics-service tests: **211 passing** (test_metrics + test_exchange + test_exchange_harness), up from 174 pre-take2. Net new tests:
  - test_compute_all_metrics_does_not_call_qstats_gini (replaces sweep WARNING-pin test; F1)
  - test_compute_all_metrics_var_1d_95_uses_correct_kwarg (positive coverage; F2)
  - test_nan_logs_debug_with_type_marker, test_string_coerce_failure_logs_debug_with_type_marker, test_none_returns_none_without_debug_emission (F17/F18)
  - test_binance_futures_income_warning_scrubs_hmac_signature (F7)
  - test_bybit_iso_conversion_overflow_emits_warning (F13)
  - TestFetchMarkPricesFailLoud (Binance + Bybit, F3)
  - TestFetchDailyPnlOkxFailLoud (F4)
- Ruff: 2 pre-existing E402 warnings (unused import in `_fetch_raw_trades_binance`, late `import time` in fetch_mark_prices module). Not introduced by this PR; not in scope.

## Commits (this take-2 apply pass)

1. `fix(audit-2026-05-07): silent-failure-sweep — apply HIGH findings (gini + var_1d_95 + fetch_mark_prices + OKX bills + Bybit cascade + returns_len)` (5bd3bead)
2. `fix(audit-2026-05-07): silent-failure-sweep — apply MED type-design (Literal r_squared_status + TypedDict + remove fictional *_error keys)` (aca34c42)
3. `fix(audit-2026-05-07): silent-failure-sweep — apply MED security/perf (HMAC strip + log rate-limit + None fast-path)` (16983968)
4. `fix(audit-2026-05-07): silent-failure-sweep — apply MED test gaps (docstring rewrite + ISO-conversion regression + mark_prices + OKX bills)` (c0c2eb0e)
5. (this) `docs(audit-2026-05-07): silent-failure-sweep — proper-specialist apply pass FIX-REPORT`

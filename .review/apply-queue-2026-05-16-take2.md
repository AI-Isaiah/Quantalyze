# PR #181 Take-2 Apply Queue (2026-05-16)

Threshold: CRITICAL=all, HIGH conf≥7, MED conf≥8, LOW=skip.
In-scope files: `analytics-service/services/{metrics,exchange}.py` + their tests.

## Apply queue (deduplicated)

| ID | Severity | Confidence | Specialist(s) | File | Line | Title | Fix sketch |
|---|---|---|---|---|---|---|---|
| F1 | HIGH | 9 | silent-failure-hunter + code-reviewer + red-team-chain | metrics.py | L391 | qs.stats.gini AttributeError permanent noise | Remove the call entirely (qs 0.0.81 has no gini); document drop in docstring |
| F2 | HIGH | 9 | red-team-new + red-team-chain | metrics.py | L349 | var_1d_95 TypeError (kwarg `cutoff` should be `confidence`) | Change `cutoff=0.05` → `confidence=0.95` |
| F3 | HIGH | 8 | silent-failure-hunter | exchange.py | L1422-L1430 (Binance), L1443-L1451 (Bybit) | fetch_mark_prices silent per-row drops | Add WARNING with sym + row.get('markPrice') in except clause |
| F4 | HIGH | 8 | silent-failure-hunter | exchange.py | L497-L503 | OKX bills aggregator silent non-digit ts | Add else branch logging WARNING (not ERROR; mirror Binance/Bybit symmetry) |
| F5 | HIGH | 8 | red-team-chain | exchange.py | L609-L613 | Bybit ISO-conversion mid-loop returns mixed timestamps -> transforms cascade | Make ISO conversion atomic — build new list, only assign on full success |
| F6 | HIGH | 8 | red-team-new | metrics.py | L346 | returns_len_for_log doesn't reflect post-NaN length used by qs | Compute nonnan_len; pass both into WARNINGs |
| F7 | MED | 8 | security | exchange.py | L559-L562 | Binance signed-URL HMAC leak in WARNING | Use scrub_freeform_string(str(exc)) and log type(exc).__name__ first |
| F8 | MED | 8 | type-design | metrics.py | L791,L826 | r_squared_status as plain str — needs Literal | Import Literal; define RSquaredStatus = Literal[...] |
| F9 | MED | 8 | type-design | metrics.py | L788-L876 | compute_qstats_scalars return type loose | Replace return type with TypedDict QstatsScalarsResult |
| F10 | MED | 8 | type-design | metrics.py | L556,L606,L636 | `*_error` keys never consumed | Remove the 3 `*_error` writes (logs already serve operator triage) |
| F11 | MED | 8 | type-design | metrics.py | many | Three incompatible failure-mode encodings | Unify by removing the `*_error` blobs (F10 handles); status discriminator remains for r_squared |
| F12 | MED | 9 | silent-failure-hunter | test_exchange_harness.py L639 | docstring `Bybit timeout silently caught` | Rewrite to describe post-sweep contract |
| F13 | MED | 7 | silent-failure-hunter (CHALLENGE LOW->MED apply-list says MED-conf-8 in step 2) | test_exchange.py | L2860 | Bybit ISO-conversion regression test gap | Add test exercising true ISO-conversion failure path (datetime.fromtimestamp raises) |
| F14 | MED | 8 | silent-failure-hunter | exchange.py | L405-L491 vs others | OKX branch severity asymmetry (ERROR vs WARNING) | F4 covers the OKX bills aggregator. OKX paginator break (separate site) is documented out-of-scope; flag in FIX-REPORT |
| F15 | MED | 8 | red-team-new | sentry_init.py | L228-L251 | Sentry breadcrumb scrubber doesn't walk stacktrace frames | OUT OF SCOPE (sentry_init.py not in scope). Defense: drop exc_info=True from the 2 exchange WARNINGs (Binance/Bybit) — DEFERRED to keep operator tracebacks; document |
| F16 | MED | 8 | red-team-new | metrics.py | L347-L458 | 11 separate exc_info tracebacks per call = retention blowout | Add simple module-level rate-limit on duplicate-message WARNINGs |
| F17 | MED | 8 | pr-test | test_metrics.py | L13-L40 | _safe_float DEBUG paths not pinned by caplog test | Add 2 caplog tests verifying DEBUG fires + level==DEBUG (negative WARNING assertion) |
| F18 | MED | 8 | silent-failure-hunter | metrics.py | L188-L202 | _safe_float(None) emits DEBUG on every legitimate None | Add `if value is None: return None` as first line |

## Notable findings DEFERRED

- type-design F11 unified-encoding sweep: too invasive; partial coverage via F10 + F8 keeps PR scope.
- Sentry breadcrumb scrubber (F15) and log rate-limiter (F16): F16 implementable inline in metrics.py via a small dedupe filter. F15 requires sentry_init.py edits which are out of scope.
- OKX paginator partial-truncation (silent-failure-hunter MED #4): out of scope per PR description; document in FIX-REPORT.
- code-reviewer MED `_safe_float` DEBUG flood: addressed via F18 (skip None) so the dominant noise source for sanitize_metrics path goes away.

## Application order (atomic commits)

1. F1, F2, F3, F4, F5, F6 — HIGH cluster.
2. F8, F9, F10 (F11 subset) — MED type-design cluster.
3. F7, F16, F18 — MED security/perf/noise cluster.
4. F12, F13, F17 — MED test cluster.
5. Docs commit: FIX-REPORT.md.

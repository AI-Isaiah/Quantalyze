# Review-cluster gate follow-ups — silent-failure-sweep PR #181

Findings that met the apply threshold (HIGH conf≥7 or MED conf≥8) but were
DEFERRED because they touch files outside this PR's scope
(`services/metrics.py`, `services/exchange.py`, their tests).

## Deferred

### F-1 — OKX bills paginator inner try has `except Exception as e: ...; break` (silent-failure-hunter MED #2)
- Site: `analytics-service/services/exchange.py:432-434, 467-469`
- Issue: First-error `break` silently truncates pagination — caller sees partial daily_pnl with WARNING but no `partial=true` signal.
- Why deferred: Pre-existing site, was NOT an `except: pass` so the original sweep did not target it. Same file but a different design pattern.
- Suggested fix: Thread a `partial=True` flag through `fetch_daily_pnl`'s return so the caller can decide whether to retry.

### F-2 — OKX branch lacks an inner try wrapper for severity consistency (red-team MED #5)
- Site: `analytics-service/services/exchange.py:405-521`
- Issue: OKX branch failure escapes to outer `except Exception as e: logger.error('fetch_daily_pnl failed')`. Bybit/Binance failures fire at WARNING. Skewed severity — operator dashboards alerting on ERROR but not WARNING would silently ignore Bybit/Binance outages.
- Why deferred: Touching OKX branch significantly expands the PR scope; the inconsistency is pre-existing.
- Suggested fix: Wrap OKX bills aggregation in a per-branch try/except with WARNING, then the outer wrapper catches only truly-unanticipated errors.

### F-3 — `redact_secrets`-style traceback scrubbing for ccxt exceptions (security LOW #1)
- Site: `analytics-service/services/exchange.py:613-618` (Bybit) and `:552-562` (Binance).
- Issue: `exc_info=True` emits full traceback; if ccxt's exception `str()` embeds the raw HTTP response (some ccxt branches do), an API key or token could leak into Railway logs.
- Why deferred: The project lacks a `redact_secrets` utility; introducing one is a defense-in-depth sweep, not a sweep-finalization step.
- Suggested fix: Add a `services/log_redact.py` utility (regex-based base64/hex token scrub) and wrap inner WARNINGs that include `exc_info=True`.

### F-4 — Naming convention drift: `# fail-soft:` vs `# best-effort:` (silent-failure-hunter LOW #4)
- Site: `analytics-service/services/metrics.py:325-441`, `analytics-service/services/exchange.py:574-595`.
- Issue: Other files in `analytics-service/` use `# best-effort:` to mark fire-and-forget paths. The sweep introduces `# fail-soft:` as a parallel convention.
- Why deferred: Purely cosmetic; no behavior impact.
- Suggested fix: Pick one convention codebase-wide (recommend `# best-effort:` since it's the older convention) in a follow-up rename sweep.

### F-5 — "best-effort" framing precedent (red-team MED #4, design-intent note)
- Issue: The 17-line Bybit comment block establishes "best-effort enrichment, log-then-continue" as the dominant pattern. A future engineer copying this pattern to a NEW silent-failure site may not consider whether THAT site is truly fire-and-forget.
- Why deferred: Documentation/culture issue, not a code defect.
- Suggested fix: Add a `docs/` note in the analytics-service folder: "best-effort applies ONLY to existing fire-and-forget paths. New code should default to raise, not best-effort."

## Closed (applied in this gate)

See commits on `chore/silent-failure-sweep-analytics-2026-05-16`:
- Misleading log-message prefix for var_1m_99 / skewness / kurtosis (was 'qstats scalar', corrected to 'np.percentile' / 'pandas').
- `_safe_float` adds DEBUG logs for the TypeError/ValueError and NaN/Inf coerce paths (closes the chain finding that the sweep's WARNINGs were defeated when `_safe_float` silently swallowed a coerce failure or NaN return).
- Three new regression tests for var_1m_99 / skewness / kurtosis (the 3 sweep sites without coverage).
- One new regression test pinning `exc_info=True` on qstats scalar WARNINGs.
- Outlier-ratios test rewritten from inline-handler-recreation tautology to real-trigger via boolean Series mean monkeypatch.
- Bybit ISO-conversion test renamed to `test_bybit_closed_pnl_item_parse_failure` (accurate description).
- Bybit + Binance test caplog filters tightened from substring match to exact prefix.
- Bybit test adds assertion that outer ERROR does NOT fire (pins the WARNING-only contract at the inner boundary).
- Two new Binance regression tests (the Binance branch had zero test coverage pre-gate).

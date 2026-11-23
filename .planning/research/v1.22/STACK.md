# Stack Research

**Domain:** Hardening an existing allocator-analytics platform (milestone v1.22 TRUTH: data you can trust)
**Researched:** 2026-11-23
**Confidence:** HIGH for repo facts (read at worktree HEAD `1c361e676`); MEDIUM for upstream facts (read from primary artifacts on 2026-11-23: PyPI and npm registry JSON, ccxt source at its release tags, upstream changelogs and migration guides; the research seam rates the fetch provider LOW, so none of these are marked HIGH). Facts taken only from a `TODOS.md` entry body and not re-read in code are marked "per entry".

## Verdict

**Add nothing to the runtime stack.** None of the 21 topic groups or the carried phases (155.2, 157, 221 to 225) needs a new package. Every fix uses libraries already pinned in `package.json`, `package-lock.json`, `analytics-service/requirements.in` / `requirements.txt` and `requirements-dev.txt`, or repo-owned tooling: the prober, the mutation runner, the lint scripts, the local-stack lane and the gitleaks binary pin.

Three deliberate version or config moves, and only three:

1. **quantstats 0.0.81 → 0.0.86, inside FIGUREMATH only**, gated on a per-metric decision (`QUANTSTATS-0086-REDERIVE-01`). It is the only dependency version this milestone should change. Upstream 0.0.82 to 0.0.86 are statistical corrections that change reported figures.
2. **Hold `sentry-sdk` on 2.x.** 3.0.0 shipped on 2026-11-23 and removes `before_send_transaction`, which the service's redaction uses. Add a Dependabot `versions: [">=3"]` ignore with a reason, the way the repo already holds `rpyc`.
3. **A scheduled full-history gitleaks scan** (`SECRETSCAN-FULLHISTORY-01`) on the gitleaks **8.30.1** binary already pinned. Historical findings are suppressed by commit-scoped fingerprints in a new `.gitleaksignore`. This is config, not a new tool.

## Recommended Stack

### Core Technologies (unchanged; the pinned versions that matter to these fixes)

| Technology | Installed (lock) | Latest upstream (2026-11-23) | Purpose in v1.22 | Verdict |
|---|---|---|---|---|
| Next.js | 16.4.2 (`package-lock.json`) | 16.4.6 | SENTRYHELD `after()`; SURFACECACHE `unstable_cache` and Cache-Control | **Keep.** Patch bumps land through Dependabot as maintenance (founder 2026-09-27). Nothing here needs 16.4.6. |
| `@sentry/nextjs` | 11.11.0 | 11.16.0 | SENTRYHELD; 221 SENTRYSCRUB2 (client init, direct-capture scrub) | **Keep.** Client init needs only `instrumentation-client.ts` (a Next 16 file convention: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md`) plus the existing `beforeSend` in `src/instrumentation.ts`. |
| `sentry-sdk` (Python) | 2.73.0 (`requirements.txt`) | 3.0.0 (2026-11-23); 2.x line at 2.76.0 | ALERTPAGE (`capture_message` event id in `services/ops_alert.py`); redaction in `sentry_init.py` | **Hold on 2.x. Do not take 3.0 this milestone** (see What NOT to Use). |
| ccxt | 4.5.89 (`requirements.in`, exact pin) | 4.5.93 (2026-11-17) | BYBITREADS, OKXTRADES, DERIBITBOOK, Deribit stale returns | **Keep 4.5.89.** Every endpoint these groups call is in 4.5.89's tagged source (list below). |
| quantstats | 0.0.81 (`requirements.in`, `requirements-dev.txt`) | 0.0.86 (2026-09-27, no release since) | FIGUREMATH | **Move to 0.0.86 in FIGUREMATH**, with per-metric decisions. Not before, not elsewhere. |
| `@upstash/ratelimit` / `@upstash/redis` | 2.0.8 / 1.39.0 | 2.2.1 | RATELIMITFAIR (Vercel-side limiters in `src/lib/ratelimit.ts`) | **Keep the 2.0.8 hold.** RATELIMITFAIR is a sizing and keying fix. The hold belongs to `UPSTASH-RATELIMIT-KEY-LOCKING-01`, a LOW entry outside v1.22 scope. |
| slowapi / limits | 0.1.10 / 5.8.0 | 0.1.10 | RATELIMITFAIR (Python `/process-key` tiers in `services/rate_limit.py`) | **Keep; no Redis storage backend** (see Alternatives). |
| rpyc | 5.3.1 (load-bearing `<6` hold) | 6.x exists | MT5DERIVE2, MT5SOAK, MT5WEDGE, 155.2 | **Keep.** The gateway's mt5linux server speaks rpyc 5. |
| gitleaks binary / gitleaks-action | 8.30.1 / v3.0.0 (SHA-pinned in the `ci.yml` `secret-scan` job) | 8.30.1 / v3.0.0 | SECRETSHYGIENE | **Already current. Reuse the pin.** Keep `GITLEAKS_VERSION`: the action's 8.24.3 default silently ignores `[[allowlists]]`. |

**ccxt 4.5.89 endpoint check.** Each call below was found in the repo and then in ccxt's v4.5.89 `abstract/bybit.py`, `abstract/okx.py` or `async_support/bybit.py`:
- Bybit:
  - `private_get_v5_execution_list` (`_fetch_raw_trades_bybit`)
  - `fetch_balance` (`fetch_usdt_balance_with_status`, both in `services/exchange.py`)
  - `private_get_v5_position_list` / `fetch_positions` (`services/positions.py`)
  - `private_get_v5_account_wallet_balance`
  - `private_get_v5_asset_deposit_query_record`
  - `private_get_v5_asset_transfer_query_inter_transfer_list`
- OKX: `private_get_account_bills`, `_bills_archive` and `_bills_history_archive`, all already called.
- Deribit: `private_get_get_transaction_log`, `public_get_get_delivery_prices`, `public_get_get_index_price` and `public_get_get_tradingview_chart_data` in `services/deribit_ingest.py`.

### Supporting Libraries (already present; named so phases reuse them instead of adding)

| Library / helper | Where | Use it for |
|---|---|---|
| `after()` from `next/server`, with a `queueMicrotask` fallback | `scheduleDerivedRowCapture` in `src/lib/queries.ts` | SENTRYHELD `170.6.1.1-FAILANONREAD-CAPTURE-HELD`: hold the capture promise in `failAnonRead` and in the landing helper. |
| `shouldCaptureNow` | `src/lib/sentry-capture.ts` | SENTRYHELD `170.6.1.1-LANDING-CAPTURE-THROTTLE`: a per-instance throttle keyed on stat plus code that still sends the first event per window. |
| `unstable_cache` with a throw-to-skip-store | `src/app/factsheet/[id]/v2/page.tsx` (`FactsheetDegradedBuildError`: "a degraded build is rendered, never stored") | SURFACECACHE `164.6.6.2.1-USDVIEW-READFAIL-CACHED`: give a failed BTC price read the same throw so it is never stored. |
| `LONG_CACHE_CONTROL` / `FAILURE_CACHE_CONTROL` | `src/app/api/og/factsheet/[id]/route.tsx` | SURFACECACHE `170.3-OG-NOTFOUND-CACHE`: a short policy for a genuine not-found, the long one for rendered data. |
| ccxt implicit endpoints (list above) | `services/exchange.py`, `funding_fetch.py`, `okx_*.py`, `deribit_ingest.py`, `positions.py` | All the venue-read fixes. |
| stdlib `html.parser` contract parser | `services/mt5_parity_report.py` ("stdlib plus `seal_bytes`", by its docstring) | 155.2 LIVEPARITY broker statements. No parsing library is needed for an HTML statement. |
| `refuse_credential_in_published_sql` | `scripts/restore-test-from-baseline.sh` | SECRETSHYGIENE `164.8.4-REDACT-NO-POSITIVE-SCAN`: extend its ERE class list (DSN, Supabase host, project ref, `\connect`, JWT, `ALTER DATABASE`) to the `.err`/`.log`/`.out` channels and WITHHOLD on a hit. Record a verdict, never a specimen. |
| `scripts/prod-prober/` (`cron-manifest.json`, `run.mjs`, arms) | repo | ALERTREADERS `L2255` (match-engine cron health) and `164.6.8-F5-READER-DELIVERY-UNOBSERVED`. Add a cadence arm here. ⚠️ `match_engine_cron` is LISTED in the manifest, but it is unverified whether any arm asserts its cadence. Check that first. |
| mutation runner, `lint-sql-gates.mjs`, `lint-app-guc.mjs`, `lint-migration-data-dependence.mjs`, the local-stack lane (`LANE_PG_VERSION` 17.6.1.113) | `scripts/` | SQLGATES2 and TESTLANES. Every new gate is shown RED on the existing machinery. |
| `node:crypto` digest | Node stdlib | 158-OPS-03: if the absence-guard test `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts` must stop carrying a credential needle, compare against a digest instead of the literal. No dependency. |

### Development Tools

| Tool | Purpose | Notes |
|---|---|---|
| `uv pip compile` via `make lock` (`analytics-service/Makefile`) | Regenerate `requirements.txt` after the quantstats move | Always `--python-version 3.12 --universal`. Dependabot's own lock output does not match this format. |
| ESLint 9.39.4 | TESTLANES `LINT-CACHE-MASKS-WARNINGS` | The `Cache ESLint` step in `ci.yml` has a `restore-keys` prefix fallback that restores a cache built from other `src/**` contents. Fix the CI invocation: run `--no-cache` in CI, or drop the fallback. Keep `--cache` for local `npm run lint`. No new tool, and never raise the warning tolerance. |
| gitleaks 8.30.1 (sha256-pinned release download, the step pattern in `supabase-migrate.yml`) | Scheduled full-history scan | `gitleaks git` with no `--log-opts` walks the full history. See What NOT to Use before pointing its `dir`/`stdin` modes at diagnostic logs. |

## Per-group verdict (every group gets one)

Member entry bodies were read for MT5DERIVE2, NOCAPITAL, JOBHEAL, DBACCESS, MT5WEDGE, MT5SOAK and DERIBITBOOK, then swept for dependency words (extension, image, install, version, package, SDK, PostgREST, Playwright, pg_cron, ccxt, Sentry, rpyc, Redis, CLI). The only stack-adjacent hit is noted on the DBACCESS row.

| Group | Stack need | Verdict and integration point |
|---|---|---|
| 155.2 LIVEPARITY | None | **Add nothing.** HTML statements parse through the stdlib contract parser. ⚠️ Contingency: if the Vantage statements arrive as PDF or XLSX rather than the terminal's HTML report, that is the one trigger in this milestone for a new parsing dependency. Decide it then, on the real file. |
| 157 FOUNDER-CONFIRM | None | **Add nothing.** Founder observations. |
| 221 SENTRYSCRUB2 | None | **Add nothing.** `167.2.1-CLIENT-SENTRY-NOOP` needs `Sentry.init` in a new `src/instrumentation-client.ts` on the installed `@sentry/nextjs` 11.11.0. It needs a browser-visible DSN env var (config, not a package) and must reuse the server `beforeSend` scrub. `209-SENTRY-DIRECT-CAPTURE-DETAILS` is one arm in `scrubSentryEvent`. |
| 222 ALERTTRUTH, 224 DEADLEFTOVERS, 225 ONEACCOUNTONCE, 223 FLOWKINDS (flow-source half) | None | **Add nothing.** `164.5-STALE-GENERATED-TYPES` (224) wants a types-regeneration step with a freshness gate. That is the Supabase CLI already in use (`supabase gen types`), not a new package. |
| MT5DERIVE2 | None | **Add nothing.** `175-NIGHTLY-MT5-DERIVE-CHECK` first has to make the first attempt's failure readable (the retried jobs end with a null `last_error`, per entry). That is existing job-failure recording and structlog. |
| BYBITREADS | None | **Add nothing; keep ccxt 4.5.89.** In 4.5.89, `bybit.fetch_positions` takes `params.settleCoin` for linear (default `options.defaultSettle` = USDT) and `params.subType`/`type` for `inverse`, plus `paginate`. So reading USDC-settled linear and inverse positions is a parameter loop over the existing call, or over the raw V5 fallback in `positions.py` `_fetch_positions_bybit`. The 7-day trade window (`_fetch_raw_trades_bybit` sends `startTime` and no `endTime`) and the all-coin anchor (`fetch_usdt_balance_with_status`) are request-shape fixes in `services/exchange.py`. ⚠️ Comments in `equity_reconstruction.py` still cite ccxt 4.5.88, and `requirements.in` cites 4.5.59 as the verified line. Read behaviour from the 4.5.89 source, not from those comments. |
| OKXTRADES | None | **Add nothing.** All three bills endpoints are in 4.5.89 and already called. Converting a mixed-currency bill needs a stated price source, and the repo has them (the flow price store, venue index reads). |
| DERIBITBOOK | None | **Add nothing.** `services/deribit_*.py` makes no unified `exchange.fetch_*` call and no market lookup: it reads raw instrument names through implicit endpoints. So the Deribit option-symbol edits between ccxt 4.5.89 and 4.5.93 do not reach this code. `189-OPTIONREPLAY-NEXT-MILESTONE` and `185-BOOK-CUMULATIVE-UNEXPLAINED` are valuation and diagnosis work on stored data. |
| Deribit stale returns (2026-11-23 observation) | Unknown until diagnosed | **No stack claim.** The observation is undiagnosed. Diagnose it with the existing read-only probes before attributing it to any library. |
| HOLDINGSTRUTH, NOCAPITAL, JOBHEAL | None | **Add nothing.** SQL, pg_cron and Python logic. `166.5.1-DERIVE-BATCH-RESET-RESIDUAL` wants a claim lease or heartbeat, which is a worker and RPC change, not a queue library. |
| FIGUREMATH | quantstats version move | **Move quantstats 0.0.81 → 0.0.86** (details below). `194-ENGINE-CONSTANTS` and `167.1.2.2.1-CAGR-EMPTY-SPAN` are constant and span-rule choices across `metrics.py`, `compute.ts` and `scenario.ts`. They need no library. |
| FACTSHEETHONEST | None | **Add nothing.** |
| SURFACECACHE | None | **Add nothing; do not adopt Cache Components.** The bundled docs say `unstable_cache` is "replaced by `use cache` in Next.js 16", but switching means turning on `cacheComponents` app-wide, which changes rendering semantics on every route. That is a migration, not a hardening fix. Fix the four entries inside the current model. |
| CONNECTTRUTH | None | **Add nothing.** zod 4.6.7 and the existing error-contract seams cover the one-error-shape goal. |
| RATELIMITFAIR | None | **Add nothing.** Re-key the anonymous teaser tier per client (the HMAC `X-Tenant-Claim` seam in `services/rate_limit.py` already carries a signed payload) and re-size the csv-validate tier. Both are founder value calls. ⚠️ `rate_limit.py` warns that storage is `memory://` and per-replica, and `analytics-service/railway.toml` does not state a replica count. Measure it before reasoning about effective limits. |
| SECRETSHYGIENE | Config only | **No new tool** (gitleaks section below). 158-OPS-03 is remediated by deleting the two unused demo accounts through Supabase Auth admin (the product's own path) and removing the tree literals. **No history rewrite.** |
| DBACCESS | None | **Add nothing.** Grants, RLS and triggers in migrations; TypeScript guards on TypeScript 6.0.3. ⚠️ `TRIGGERREVOKE-LOCKHOLD-01`'s fix (role-level `statement_timeout` and `idle_in_transaction_session_timeout` on `anon`/`authenticated`) depends on the hosted PostgREST honouring role settings. The entry calls that an unmeasured assumption. Measure it on TEST; it is a platform behaviour, not a dependency. |
| ALERTPAGE | Hold `sentry-sdk` 2.x | **Add nothing.** Logging when `capture_message` returns `None`, and a per-fingerprint credit timestamp, are logic in `services/ops_alert.py` on 2.73.0. The rule-interval constant must cite the Sentry alert rule it mirrors. |
| ALERTREADERS | None | **Add nothing.** Read `net._http_response` for delivery status, and add prober cadence arms. The prober is the single existing cron-health surface (see Alternatives on Sentry Crons). |
| SENTRYHELD | None | **Add nothing.** `after()` plus `shouldCaptureNow`. ⚠️ The landing page's render mode is unmeasured. On a statically rendered or revalidated page, `after()` runs at build or revalidate time (bundled `after.md`), so confirm the render mode before relying on it per request. |
| MT5WEDGE | None | **Add nothing.** Live-gated evidence capture on the existing gateway. The terminal-build reading is evidence, not a dependency. |
| SQLGATES2 | None | **Add nothing.** Existing census tests and the mutation runner. `164.7-MIGRATION-COMMENT-DRIFT` is corrected forward in a new migration's header. |
| TESTLANES | None | **Add nothing.** `164.4.2-PROD-SUPAUTILS-FUNCTION-DENIAL-CRASH` is a read-only PROD measurement. If the crash is confirmed, the remedy is a Supabase platform Postgres image upgrade (a founder or platform action), not a repo dependency. The lane pin stays at `17.6.1.113`. |
| MT5SOAK | None | **Add nothing.** |

## FIGUREMATH: the quantstats move in detail

**Where quantstats still reaches the product.** In `analytics-service/services/metrics.py`, the live library calls are:
- `value_at_risk`, `avg_loss`, `avg_win`, `win_rate`, `profit_factor`, `tail_ratio` and `volatility`, all called with `prepare_returns=False` on a series the repo prepares itself through an inline `_prepare_returns` mirror;
- `drawdown_details`.

Everything else is an **inline mirror of 0.0.81** that parity tests compare against the installed library: `sortino`, `exposure`/time-in-market, `max_drawdown`/`to_drawdown_series`, CVaR, PSR, rolling greeks, `kelly_criterion`, `recovery_factor`, `ulcer_index`, `serenity_index`, `common_sense_ratio`. So moving the pin does two things:
- it changes the few live leaves only where their own body changed;
- it turns RED every parity arm whose mirror now disagrees with upstream.

That RED is the forcing function for the per-metric decision, and it is exactly what Dependabot #953 produced.

| Upstream change (quantstats `CHANGELOG.md`) | Release | Effect here |
|---|---|---|
| `conditional_value_at_risk` mixed estimator fixed: the default is now closed-form normal expected shortfall, with `method="historical"` for the empirical tail | 0.0.83 | The inline CVaR mirror ("quantstats 0.0.81 `conditional_value_at_risk`'s Series branch") reproduces the estimator upstream retracted. The RANK-05 arm moved from −0.0279 to −0.0344 (per entry). |
| Missing observations no longer filled with 0.0; period-counting metrics (`win_rate`, `sortino`, `exposure`, `cagr` and others) count OBSERVED periods | 0.0.83 | The live `win_rate` takes `prepare_returns=False`, so only its own counting can change, and only if the repo-prepared series carries NaN. Whether NaN reaches it after Phase 188's null tiny-base days is unmeasured, so the phase must measure it. The `sortino`/`exposure` mirrors stay on 0.0.81 semantics until decided. |
| `max_drawdown` / `to_drawdown_series` no longer guess the baseline from price magnitude | 0.0.82 | The mirrors already strip "the price guess", so the repo had effectively adopted this. The parity reference moves. |
| `probabilistic_sharpe_ratio` kurtosis and standard-error fix | 0.0.82 | The PSR mirror's parity arm moves. |
| `kelly_criterion` changed in 0.0.82, **reverted** in 0.0.84 | net none | The `kelly_criterion` mirror is unchanged net. |
| `rolling_greeks` alpha computed per window | 0.0.86 | The rolling-greeks mirror's arm (`test_q166_rolling_greeks_alpha_differs_from_the_full_sample_form`, per entry). |
| `avg_win` / `avg_loss` on a DataFrame no longer depend on other columns | 0.0.86 | Called on a Series here, so unaffected. Confirm at the call site. |
| `rolling_volatility` rf argument; `rar` rf de-annualisation | 0.0.82 / 0.0.85 | Not called. |

**Recommendation:** adopt 0.0.86 in the FIGUREMATH phase. The milestone goal is "every number is correct", and 0.0.81 carries estimators upstream has since called defects, CVaR above all. But the version moves only together with a recorded per-metric decision, which the entry requires. CVaR in particular needs a choice between normal ES and historical. My leaning (MEDIUM confidence; a domain call for the founder) is historical, because crypto returns are fat-tailed, with a minimum-observation null rule in line with no-invented-data. ⛔ Loosening a parity tolerance, or re-pinning expected values without the decision, is explicitly not a close.

**Compatibility.** 0.0.86 declares Python `>=3.10`, `pandas>=2.0.0`, `numpy>=1.24.0` and `scipy>=1.11.0`. The lock carries pandas 3.0.3, numpy 2.5.4 and scipy 1.18.0, so no transitive change is forced. The mypy `quantstats.*` `follow_imports = "skip"` override in `analytics-service/pyproject.toml` stays.

**Sites that move in ONE PR:**
- the pins: `analytics-service/requirements.in`, the regenerated `requirements.txt` (`make lock`) and `requirements-dev.txt`;
- the quantstats ignore block in `.github/dependabot.yml`;
- the tests that import quantstats and pin its version or its 0.0.81 values: `tests/test_metrics_parity.py`, `tests/test_qstats_gate.py`, `tests/qstats_gate.py`, `tests/test_metrics.py`, `tests/test_mt5_golden_fixtures.py`, `tests/test_mt5_deal_reconstruction.py`;
- on the TypeScript side, the parity tests that cite quantstats as their basis (`src/__tests__/metrics-parity.test.ts`, `src/lib/sample-basis-ratios.ts` and its tests). Re-check them, because the moved figures surface there through stored values;
- a CHANGELOG line saying that reported CVaR and the other moved figures change for every strategy at its next recompute.

Grep `quantstats` and `0.0.81` across `analytics-service/` and `src/` again at plan time: `metrics.py` alone cites `0.0.81` 79 times in mirror docstrings.

## SECRETSHYGIENE: gitleaks in detail

- **Scheduled full-history scan (`SECRETSCAN-FULLHISTORY-01`).** Add a `schedule:` workflow or job that runs `gitleaks git . --config .gitleaks.toml` with no range, on the sha256-pinned 8.30.1 binary. On red, it files or comments on one labelled issue, the way `sql-mutation-nightly.yml` does.
  - ⚠️ A red scheduled run attaches a failing check to main's head SHA, which CLAUDE.md records can block a Railway redeploy (the `sql-mutation-nightly` D-11 coupling). Decide that coupling explicitly rather than inheriting it.
- **Suppress historical findings with `.gitleaksignore` fingerprints, not a baseline report.**
  - The last full-history count was 37 findings on 2026-09-17 (`.planning/WINDOWS.md` entry 61); `SECRETSCAN-FULLHISTORY-01` measured a different set on 2026-09-05. Neither was re-measured here, so re-run the scan first.
  - Fingerprints (`commit:file:rule:line`) carry no secret text and are commit-scoped, so the same literal in a new commit is still caught. That answers the entry's warning that "an allowlist is a permanent blind spot".
  - A `--baseline-path` report stores `Secret`, `Match`, author name and email unless generated with `--redact`, and gitleaks' `IsNew` skips the secret comparison only when the scan also runs redacted (`detect/baseline.go`). Committing a baseline to this public repo would republish the literals it suppresses.
  - Upstream labels `.gitleaksignore` "experimental". Pin a test that a fingerprinted finding stays suppressed and a fresh one fails, by extending `gitleaks-allowlist.test.ts`.
  - With the history suppressed, a dispatched CI re-run's full-scope scan should go green, which would give WINDOWS entry 61's "no working re-trigger" problem a fix. Unverified until run.
- **Diagnostic-channel positive scan (`164.8.4-REDACT-NO-POSITIVE-SCAN`).** Extend `refuse_credential_in_published_sql`'s class list to the redacted `.err`/`.log`/`.out` files. Do not substitute gitleaks here: its default ruleset targets provider tokens and generic high-entropy strings, not this repo's leak classes (DSN, Supabase host, project ref), and `test-restore-from-baseline.yml` does not install it.
- **158-OPS-03.** Delete the accounts; that is the only real remediation, because the values are in published history. Then remove the remaining tree literals. **No history rewrite:** PROJECT.md Key Decisions records "v1.20: `.planning` username scrub is forward-only; history rewrite declined (founder 2026-08-26)". A rewrite breaks open PR refs and does not unpublish clones, forks or caches. The 2026-11-23 ruling asks for removal "from the tree", which is consistent with that.

## Installation

```bash
# None. No package is added.

# The one version move (FIGUREMATH phase only), after the per-metric decisions:
#   1. analytics-service/requirements.in:      quantstats==0.0.86
#   2. analytics-service/requirements-dev.txt: quantstats==0.0.86
cd analytics-service && make lock     # uv pip compile --python-version 3.12 --universal
#   3. delete the quantstats ignore entry in .github/dependabot.yml (same PR)
#   4. move every 0.0.81 pin/expected value in analytics-service/tests/ per the decision record
#   5. pytest (from analytics-service/) + mypy strict, as every analytics brief requires

# Config only (no install):
#   .github/dependabot.yml  pip block: ignore sentry-sdk versions [">=3"], with a reason comment
#   .gitleaksignore         fingerprints of the historical full-history findings (re-measured first)
#   scheduled gitleaks job  reusing GITLEAKS_VERSION 8.30.1 + the sha256-pinned download step
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|---|---|---|
| quantstats 0.0.86 with per-metric decisions | Stay on 0.0.81 and inline-mirror the remaining live leaves, removing quantstats from the runtime | Only if the founder rules that 0.0.81's figures ARE the product's definitions. That freezes estimators upstream calls defects. |
| quantstats 0.0.86 | Replace quantstats with empyrical or another return library | Not in this milestone. It would be a third convention set on top of the two FIGUREMATH is reconciling. |
| slowapi `memory://` (current) | `limits` Redis storage (`storage_uri="redis://…"`, which needs the `redis` package and a Redis on Railway) | Only once more than one analytics replica is measured AND the Python limiter becomes the binding tier. Today the Vercel-side Upstash limiter is the cross-instance front door, and re-keying there is cheaper. |
| Prober cadence arms for cron health | Sentry Cron Monitors (`sentry_sdk.crons` check-ins from the FastAPI handler; a missed check-in alerts) | A reasonable later choice, not this milestone. The prober is already the one cron-health surface with a manifest, and a second monitor duplicates it. Sentry 3.0 also moves check-ins out of `before_send` (`before_send_check_in`), so building on check-ins while holding 2.x would mean rework. |
| `.gitleaksignore` fingerprints | `[[allowlists]]` path or regex entries in `.gitleaks.toml` | Only for genuine fixture files that keep living in the tree. Prefer changing the fixture to an obviously fake value. |
| Hold `sentry-sdk` 2.x, taking 2.x minors as maintenance | Migrate to 3.0 now | After 221 and ALERTPAGE ship, as its own booked phase, with redaction re-proved under `data_collection` and `before_send_span`. |
| Keep ccxt 4.5.89 | Bump to 4.5.93 | When a venue fix needs a ccxt change, with a cassette refresh (`cassette-refresh.yml`) and the equity-reconstruction suites re-run. Between 4.5.89 and 4.5.93, upstream edited expired-option market and option-symbol construction code in the Bybit, OKX and Deribit modules. No behaviour claim is made here. The repo's Deribit code does not use unified symbols, but unified `fetch_positions` parsing on Bybit and OKX does. |

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| `sentry-sdk` 3.0.0 (released 2026-11-23) | Per the migration guide, mid-milestone this works against 221 SENTRYSCRUB2 and ALERTPAGE:<br>• `before_send_transaction` is removed, and `analytics-service/sentry_init.py` uses it to redact transactions.<br>• `send_default_pii` is replaced by `data_collection`, whose defaults "collect more data", including HTTP request and response bodies.<br>• `event_scrubber` is removed, and stack-frame locals are no longer scrubbed by default.<br>• The SDK no longer sets tags on its own.<br>• `transaction_style` is removed from the FastAPI and Starlette integrations. | 2.73.0 now, 2.x minors (2.76.0 exists) through Dependabot as maintenance, and a Dependabot `>=3` ignore with the reason. |
| `git filter-repo` / BFG history rewrite | The founder declined history rewrite on 2026-08-26. A rewrite breaks open PR refs and does not unpublish anything already cloned or cached, and the 2026-11-23 ruling scopes 158-OPS-03 to the tree. | Delete the accounts, remove tree literals, and fingerprint-ignore historical scan findings. |
| A committed gitleaks `--baseline-path` report | Unless redacted, it stores the matched secret, the match context and the author email, which republishes the leak in a public repo. | `.gitleaksignore` fingerprints. |
| gitleaks as the diagnostic-log redaction check | It targets the wrong classes for this repo's leaks (DSN, host, project ref), so it would read as a pass on exactly the shapes that matter. | Extend `refuse_credential_in_published_sql`. |
| A Next.js Cache Components / `use cache` migration | Turning on `cacheComponents` is an app-wide rendering change, out of scope for a hardening milestone. | Fix SURFACECACHE inside `unstable_cache` and Cache-Control. |
| A floating ccxt pin (`>=`), or a bump without cassettes | ccxt releases near-daily, and `requirements.in` records the aiohttp incident, where a float changed money math with no repo diff. | The exact pin; bump only with a cassette refresh. |
| `@upstash/ratelimit` 2.2.x | Its scripts carry the `allow-key-locking` shebang flag the CI lane's Redis refuses (`UPSTASH-RATELIMIT-KEY-LOCKING-01`), and nothing in RATELIMITFAIR needs it. | Stay on 2.0.8. |
| Loosening parity tolerances to absorb the quantstats move | Explicitly "not a close" in `QUANTSTATS-0086-REDERIVE-01`. | A per-metric decision record, then re-pin. |
| Any new paging or alerting vendor (PagerDuty, Opsgenie, Better Stack) | ALERTPAGE is about the existing Sentry-plus-email page opening and closing exactly once. A new channel adds a third thing to get exactly-once wrong, and email being unconfigured is a founder-accepted state (`164.6.8-OPS-ALERT-EMAIL-UNCONFIGURED`). | Fix `ops_alert.py` and `mt5_outage_alert.py`. |

## Stack Patterns by Variant

**If a FIGUREMATH metric decision keeps a 0.0.81 definition:**
- Keep or extend its inline mirror in `metrics.py`, name the deliberate divergence from 0.0.86 in its docstring, and pin it with an independent oracle (money-math oracles are independent invariants).
- The installed library version then no longer defines that figure, so a later bump cannot move it silently.

**If the analytics service is measured at more than one replica:**
- Re-read every `rate_limit.py` tier as N times looser, and decide whether the Vercel Upstash tier, not the Python tier, should carry the anonymous limit.
- `memory://` is per-replica, by the module's own warning.

**If 155.2's broker statements are not the terminal's HTML report:**
- Stop and book the parser decision on the real file before adding any PDF or XLSX library.
- The current parser is a refuse-what-it-did-not-predict contract, and a best-effort scraper would undo that.

## Version Compatibility

| Package A | Compatible With | Notes |
|---|---|---|
| quantstats 0.0.86 | pandas 3.0.3, numpy 2.5.4, scipy 1.18.0, Python 3.12 | The current lock meets the declared floors. Its 0.0.82 notes say upstream CI runs a Python 3.10 to 3.13 × pandas × numpy matrix. |
| ccxt 4.5.89 | aiohttp 3.14.5 (lock) | Unchanged; keep the exact pin. |
| sentry-sdk 2.73.0 | fastapi 0.161.1, starlette 0.46.2 | Unchanged. 3.0 changes FastAPI/Starlette segment naming. |
| `@sentry/nextjs` 11.11.0 | next 16.4.2 | `instrumentation-client.ts` is a Next 16 file convention, so client init needs no SDK bump. |
| gitleaks 8.30.1 | `.gitleaks.toml` `[[allowlists]]` array form | 8.24.3 (the action's default) silently drops the array form. Keep `GITLEAKS_VERSION: 8.30.1` in every job that runs it. |
| pytest `<9.2` | pytest-xdist 3.8.0 | Existing cap in `requirements-dev.txt`; this milestone does not touch it. |
| rpyc 5.3.1 | the MT5 gateway's mt5linux server (rpyc 5) | Keep `<6`. |

## Sources

- Repo at worktree HEAD `1c361e676` (confidence HIGH):
  - config and dependencies: `package.json`, `package-lock.json`, `analytics-service/requirements.in`, `requirements.txt`, `requirements-dev.txt`, `pyproject.toml`, `Makefile`, `railway.toml`;
  - analytics service: `services/rate_limit.py`, `services/metrics.py` (live `qs.stats.*` calls and mirror docstrings), `services/positions.py`, `services/equity_reconstruction.py`, `services/exchange.py` (`_fetch_raw_trades_bybit`, `fetch_usdt_balance_with_status`), `services/deribit_ingest.py` and the other `deribit_*.py`, `services/mt5_parity_report.py`, `services/ops_alert.py`, `sentry_init.py`;
  - frontend: `src/lib/sentry-capture.ts`, `src/lib/queries.ts`, `src/lib/ratelimit.ts`, `src/lib/factsheet/fetch-and-build-payload.ts`, `src/app/factsheet/[id]/v2/page.tsx`, `src/app/api/og/factsheet/[id]/route.tsx`, `src/instrumentation.ts`;
  - CI and security: `.github/workflows/ci.yml` (`secret-scan`, `Cache ESLint`), `.github/workflows/supabase-migrate.yml` (gitleaks install), `.github/dependabot.yml`, `.gitleaks.toml`, `scripts/restore-test-from-baseline.sh` (`refuse_credential_in_published_sql`), `scripts/prod-prober/cron-manifest.json`;
  - planning: `TODOS.md` (entries cited by id), `.planning/PROJECT.md` (Current Milestone, Constraints, Key Decisions), `.planning/WINDOWS.md` entry 61.
- Founder scope file `next-milestone-scope.md` and triage file `todos-triage.md` (session scratchpad, 2026-11-23), cited by filename only.
- Next.js 16 bundled docs (confidence HIGH, installed version): `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` and `unstable_cache.md`; `03-file-conventions/instrumentation-client.md`.
- ccxt source at tags v4.5.89 and v4.5.93 (`python/ccxt/async_support/bybit.py`, `okx.py`, `deribit.py`; `python/ccxt/abstract/bybit.py`, `okx.py`) from the ccxt GitHub repository. Covers the `fetch_positions` parameters, the Bybit and OKX endpoint list, and the 4.5.89→4.5.93 diff. Confidence MEDIUM (primary source; seam tier LOW).
- Registries, read 2026-11-23 (confidence MEDIUM):
  - PyPI JSON API: ccxt 4.5.93; quantstats 0.0.86 and its `requires_dist`; sentry-sdk 3.0.0 and 2.76.0; slowapi 0.1.10.
  - npm registry: `@sentry/nextjs` 11.16.0, `@upstash/ratelimit` 2.2.1, next 16.4.6.
  - GitHub releases API: gitleaks v8.30.1, gitleaks-action v3.0.0.
- quantstats `CHANGELOG.md` (0.0.82 to 0.0.86), ranaroussi/quantstats main branch. Confidence MEDIUM.
- sentry-python `CHANGELOG.md` (3.0.0) and `MIGRATION_GUIDE.md`: `before_send_transaction`, `data_collection`, `event_scrubber`, tags, `transaction_style`, `before_send_check_in`. Confidence MEDIUM.
- gitleaks v8.30.1 `README.md` (`dir`, `--baseline-path`, `.gitleaksignore`, `--redact`) and `detect/baseline.go` (`IsNew`). Confidence MEDIUM.
- Not used: Context7 (its MCP server was unauthenticated in this session). The research-plan and research-store cache steps were not run. Only `classify-confidence` was called, and it rated `webfetch` and `websearch` LOW.

---
*Stack research for: v1.22 TRUTH hardening (no new capability)*
*Researched: 2026-11-23*

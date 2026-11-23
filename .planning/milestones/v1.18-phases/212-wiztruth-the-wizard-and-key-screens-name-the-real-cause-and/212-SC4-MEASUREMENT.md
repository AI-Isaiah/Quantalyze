# Phase 212 SC4 — MT5 lease-wait measurement notes (2026-11-14)

Taken by the phase orchestrator, read-only, for the researcher and planner. CONTEXT.md's SC4 decision ("measure, then decide") governs; this file records what the measurement found.

## Premise re-measured at HEAD: a derive does not hold the terminal a connect waits on

- `analytics-service/routers/exchange.py` (the wizard validate path) leases `mt5_terminal_key(host, port)` where host/port come from `read_env_validation_gateway_endpoint()` (`MT5_VALIDATION_GATEWAY_HOST/PORT`). Phase 164.6.6 D-02/D-05: a key validation leases the VALIDATION terminal's key, never the job terminal's; `None` refuses (never falls back to the job pair). The routing pin is in `tests/test_mt5_concurrency.py`.
- `derive_broker_dailies`, `allocator_holdings`, `sync_trades_balance`, `equity_backfill` lease the JOB terminal. Different `terminal_key` means a different lock: a running derive cannot make an interactive validate wait.
- So the ROADMAP/TODOS 0.51 premise ("20 s against a 40 s derive read plus a 10 s restart") was true before Phase 164.6.6 and is not true at HEAD. What can hold the validation terminal: another validation (`validate_wizard`, `validate_worker`), its post-verdict scrub (`schedule_validation_terminal_scrub`, Phase 164.6.6.1 D-08), the owed-scrub paid before a probe, the session monitor and boot heal (both with a 2.0 s lease wait).

## Data available on PROD (Supabase MCP, marker query returned the PRODUCTION marker first)

- `cron_runs` `mt5_terminal_handover` by site, all time: derive_broker_dailies 474, allocator_holdings 367, terminal_scrub 5, sync_trades_balance 4, session_heal 4, equity_backfill 4, validate_wizard 3, validate_worker 3. Validation traffic is tiny.
- `cron_runs` `mt5_terminal_scrub`: 27 rows since 2026-10-05, `completed_at - started_at` is 0 s on every row (stamped at completion), so it carries no hold duration. Most recent: 2026-11-02 22:09:44 / 22:09:57 (validate_wizard) and 22:10:26 (validate_worker), i.e. back-to-back validations about 13 s and 29 s apart.

## Railway logs (service quantalyze-analytics, production, read-only)

- Filter `mt5.stage` over 2026-11-07..14: 0 entries. Filter `duration_ms` over the same window: 0. Filter `lease_wait` since 2026-10-01: 0. The structured `mt5.stage` events are not retrievable from the Railway log store for this window.
- Filter `mt5_terminal_lease` since 2026-10-15: two lines, both 2026-10-23: "waited 18.32s" (05:49:18) and "waited 16.20s" (05:51:58). Neither reached the 20 s bound.
- Railway log retrieval returns recent entries only; no older hold-time distribution is available.

## Consequence for the decision rule

There is no measured p95 hold distribution for the validation terminal. The two observed queue waits (16.2 s, 18.3 s) are below the 20 s bound. Per CONTEXT ("no number is guessed; if logs cannot yield a measurement, stop and report rather than invent one"), the planner must not raise `_MT5_LEASE_WAIT_S` on an invented p95. Options the researcher should evaluate:
- a bound derived from code constants (the validate deadline plus the scrub bound on the validation terminal) as a by-construction ceiling, cited by symbol, stated as a ceiling and not as a measurement;
- or keep 20 s and the busy refusal, with copy stating only what is established.

Orchestrator default (cheap to reverse: one env default plus one copy entry): keep the 20 s bound. Add a test pinning that the validate path and the derive path never share a `terminal_key` lock, which is what makes SC4's "connect during a running derive" structurally safe. Change `KEY_MT5_TERMINAL_BUSY`'s retry time only if a by-construction ceiling from code constants contradicts "a minute". This premise change is flagged to the founder in the hand-back, not decided silently.

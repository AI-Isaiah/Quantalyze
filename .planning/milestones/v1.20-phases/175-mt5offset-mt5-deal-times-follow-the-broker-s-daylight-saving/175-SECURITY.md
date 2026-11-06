---
phase: "175"
slug: "mt5offset-mt5-deal-times-follow-the-broker-s-daylight-saving"
status: verified
# threats_open = OPEN threats at or above security_block_on (high). Operator-pending rows are not open.
threats_open: 0
asvs_level: 1
block_on: high
created: "2026-10-27"
verdict: SECURED
---

# Phase 175 MT5OFFSET - Security

> Audited at head 57cb909ba (branch feat/175-mt5offset), scope `git diff 53f25ac3e..HEAD -- . ':!.planning'` plus a scan of the `.planning` text in the same range. Implementation files read-only.
> Governing decision: D-04 (founder 2026-10-27, "Transient, like backfill (Recommended)") supersedes plan 03's "config fault permanent, no stamp" (T-175-10). T-175-10 is judged against D-04.
> ASVS level and block_on were not set in `.planning/config.json`; defaults used (L1, high).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| MT5 bridge -> worker | deal `time` / `time_msc` from a remote terminal; untrusted shape and range | broker wall-clock integers |
| worker env -> resolver | operator-set Railway variables decide how every MT5 day is bucketed | rule id or integer offset (secret-grade operator input) |
| derive / backfill -> compute_jobs / strategy_analytics | error text lands in re-classifiable, user-visible fields | closed-set fault text |
| captured ledger (scratch) -> dry-run report | real deal rows, ids, logins in the input; report may become tracked text | counts and ordinals only |
| founder terminal / operator -> Railway, PROD, shared MT5 terminal | live readings, variable changes, forced rebuilds (plans 02, 06, unexecuted) | whole-hour readings, ordinals |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Evidence | Status |
|-----------|----------|-----------|----------|-------------|----------|--------|
| T-175-01 | Tampering | per-deal offset (`deal_utc_day`, `deal_utc_instant_ms`) | high | mitigate | `services/mt5_server_clock.py` `_dst_window_utc`/`candidates`; `services/mt5_deals.py` `_deal_offsets` looks the offset up once per deal for day and instant. Tests: `test_rule_matches_zoneinfo_at_every_quarter_hour_2024_to_2029` (independent zoneinfo oracle), `test_candidates_golden_vectors`, `test_instant_day_equals_deal_utc_day_around_a_utc_midnight_under_a_rule_clock`. Ran: 205 passed. | closed |
| T-175-02 | Tampering | repeated / missing broker hour | medium | mitigate | `instant_offset_s` returns None unless exactly one candidate; `deal_utc_instant_ms` returns None, never a guess (`mt5_deals.py`); `test_the_utc_day_cannot_differ_between_the_two_candidates_2007_to_2099`; `test_a_repeated_or_skipped_broker_hour_has_a_day_and_no_instant`. Out-of-span years raise the one `Mt5DealClassificationError` text. | closed |
| T-175-03 | Tampering | `resolve_mt5_server_clock` | high | mitigate | Silent `"0"` default gone: neither-set, unknown id, both-set and malformed (non-ASCII, `1_000`, beyond 13 h) each raise `Mt5ServerClockConfigError` (`mt5_server_clock.py` `resolve_mt5_server_clock`, `_parse_fixed_offset_s`); read per call, no cache; `test_the_resolver_fails_loud_with_a_closed_value_free_message` over 14 environments; `test_single_reader` AST scan finds the two variable names in no other file under services/routers/models/main*. Independent grep: no other source reader. | closed |
| T-175-04 | Information disclosure | config and seam error text | low | mitigate | Messages are the four constants in `MT5_SERVER_CLOCK_CONFIG_MESSAGES`, naming variables and allowed ids only; the exception is only ever built from those constants; tests plant `summer`, `10800`, `7200`, `46801`, `3h` and assert absence. | closed |
| T-175-05 | Information disclosure | readings in SUMMARY / runbooks (plan 02) | medium | mitigate | Plan 02 unexecuted; no runbook or SUMMARY from it exists. Verify greps are written into the plan. Diff scan (see below) found no leak in what exists. | operator-pending |
| T-175-06 | Tampering | interim `MT5_SERVER_UTC_OFFSET_S` (plan 02) | high | mitigate | Operator step (read both services, set the integer only if +2/+3). Not yet performed. | operator-pending |
| T-175-07 | Repudiation | Railway variable changes (plan 02) | low | mitigate | Operator logging step in plan 02; not yet performed. | operator-pending |
| T-175-08 | Tampering | runbook numbering cited by prober and vitest (plan 02) | medium | mitigate | Additive-only gate in plan 02; no runbook edited in this diff (`docs/` absent from the code diff), so nothing renumbered. | operator-pending |
| T-175-09 | Tampering | day vs instant vs day P&L in one derive | high | mitigate | `job_worker.py`: one `_mt5_clock = resolve_mt5_server_clock()` (line 5939), passed at all six sites (6614, 6621, 6640, 6741, 6755, 7566); no `os.getenv("MT5_SERVER_UTC_OFFSET_S")` remains. `test_one_clock_per_derive` (AST: exactly one resolve, exactly six sites, each passes `_mt5_clock`); job-level SC-2 test with fixed-10800 control. | closed |
| T-175-10 | Repudiation | worker misconfiguration on a user's strategy | medium | mitigate (per D-04) | Judged against D-04. (a) Not `Mt5DealClassificationError`: `Mt5ServerClockConfigError.__bases__ == (Exception,)` (test), so it never carries the user-attributed classification sentence. (b) Derive arm (`job_worker.py` ~5938-5953) returns `FAILED`, `error_kind="transient"`, message `derive_broker_dailies: <closed text>`; it runs before any terminal call and before any strategy_analytics / csv_daily_returns write; test `test_a_clock_configuration_fault_fails_transient_and_makes_no_terminal_read` asserts transient, `transport.calls == []`, no strategy_analytics upsert, no csv_daily_returns upsert, message within the closed set. (c) The single ERROR line (`arm=server_clock_config`) interpolates only job id and the closed-set text; test asserts one such line and that planted `summer` / `10800` are absent. (d) After exhausted retries the status bridge stamps the "automatic retries exhausted" sentence (REVIEW round 3 traced this against the latest SQL); that stamp is by the bridge, not this handler, and is the accepted D-04 consequence. RED proof reproduced in REVIEW (3 failed when kind flipped to permanent). Backfill sibling: same arm is transient, fixed text, before the lease. | closed |
| T-175-11 | Denial of service | fail-loud on unset breaks every MT5 derive at deploy | high | mitigate | Code half: integer-only form resolves to `fixed_server_clock(n)` unchanged (`resolve_mt5_server_clock`), so a service already carrying the integer behaves as before; control test with `MT5_SERVER_UTC_OFFSET_S=10800` passes. A service with NEITHER variable now fails the derive transient (no data written, retried) instead of silently using 0. Operator half (both services carry the integer before deploy; first-derive check) is plan 02 / 06. | closed (code); operator-pending (deploy precondition) |
| T-175-12 | Information disclosure | `render_report` / `--note` | medium | mitigate | `scripts/mt5offset_dry_run.py`: ordinals from capture position, error CLASS only (`_error_class`), `_scrub` over the whole rendered text and each `--note`, id map only at `--map-out`. `test_nothing_identifying_reaches_the_report` plants a uuid, amount, server text, login, email and asserts each absent. | closed |
| T-175-13 | Tampering | script touching a live system | medium | mitigate | Read-only confirmed: imports are argparse/json/math/sys/pandas, `scripts.flowtiming_dry_run._scrub`, and pure services (`account_unit`, `broker_dailies`, `mt5_deals`, `mt5_server_clock`); no supabase / httpx / socket / psycopg import, and none in `broker_dailies.py` or `flowtiming_dry_run.py`. Only writes are `open(args.map_out, "w")` and `open(args.out, "w")`. `test_the_script_imports_no_client_or_network_module` (AST, with a non-vacuity assert). | closed |
| T-175-14 | Tampering | allocator snapshots built with a wrong clock | high | mitigate | `equity_reconstruction.py` `_mt5_fetch_window`: `mt5_clock = resolve_mt5_server_clock()` passed as `server_utc_offset_s=mt5_clock` to `reconstruct_mt5_nav_levels`; `test_one_clock_per_backfill` (exactly one resolve, one site, passes `mt5_clock`). | closed |
| T-175-15 | Denial of service | configuration fault burning the one-time rebuild | medium | mitigate | `_fail("server_clock_config", "transient", detail=str(exc))` placed after the kill-switch gate and before the terminal lease; fixed classifier-safe `_MT5_BACKFILL_MESSAGES["server_clock_config"]`; test asserts transient, no terminal call besides teardown, `_assert_nothing_persisted`, one `reconstruct_failed` audit; `test_reconstruct_whole_account.py` lists `("server_clock_config", "transient")`. | closed |
| T-175-16 | Tampering | future inline read re-creating the scattered default | medium | mitigate | `test_single_reader` (AST over services/routers/models + four top-level modules, floor of 120 files, positive control that the resolver file is matched). | closed |
| T-175-17 | Tampering | capture moving the shared terminal under a running job (plan 06) | high | mitigate | Operator procedure in plan 06 (unexecuted). | operator-pending |
| T-175-18 | Information disclosure | captured ledgers, ordinal map, ids (plan 06) | high | mitigate | Operator procedure in plan 06 (unexecuted). The tooling half (counts and ordinals only, id map only at `--map-out`) is verified under T-175-12. | operator-pending |
| T-175-19 | Tampering | service left with both variables, or unswitched (plan 06) | medium | mitigate | Code half: both-set is a fail-loud fault (`_BOTH_SET_MESSAGE`), so a half-switched service cannot silently pick a winner. Operator read-back is plan 06. | operator-pending |
| T-175-20 | Tampering | forced rebuild over/under-inclusion (plan 06) | high | mitigate | Operator procedure in plan 06 (unexecuted); the dry-run `rebuild` verdict is the measured input. | operator-pending |
| T-175-SC | Tampering | package installs (plans 01-06) | low | accept | No dependency file in the diff (`requirements*.txt`, `package.json`, lockfiles absent from the changed-file list); modules are stdlib only plus already-present pandas. | closed (accepted) |

*Status: open, closed, operator-pending (mitigation is an unexecuted operator step in plan 02 or 06), or open below threshold. Only open at or above `high` count toward `threats_open`.*

---

## Additional Checks Requested

| Check | Result |
|-------|--------|
| Dry-run script read-only | Yes. No DB/network import (own or transitive direct deps checked by grep), writes only `--out` / `--map-out`. Pinned by AST test. |
| Dry-run redaction | Ordinals and counts; `_scrub` strips uuid, email, 9+ digit runs, home paths from the whole report and notes; error class names only. Test plants each identifier class. Residual: `_scrub` does not remove a server name (it is never rendered from input, so none can reach the report). |
| No configured value in logs or user-visible text | Derive ERROR line, backfill WARNING, audit `sanitized_message` and `error_message` carry only the four closed-set constants (or the fixed backfill text). Tests plant values and assert absence. The stderr WARNING in the script prints two integer offsets only. |
| Tracked-file leak scan of the full diff (added lines, including `.planning`) | No absolute home path (macOS or Linux style); no PROD project ref (compared to the linked ref, 0 hits); no host names or keys; no real broker server name (the only server string is the test fixture "Broker-Live"); no real account number (fixtures `123456`, `123456789`); the only UUID is the RFC example `123e4567-...` in a test; six-digit-plus runs are token counts, git SHAs and fixture values. |

---

## Unregistered Flags

None. The executed SUMMARYs (01, 03, 04, 05) record no threat flags beyond the register.

## Findings (non-blocking, informational)

1. **Stale lineage in two SUMMARYs.** `175-03-SUMMARY.md` and `175-05-SUMMARY.md` still say the derive fault is "permanent ... never reaches a user's strategy". Code, tests, CONTEXT D-04 and REVIEW say transient with a possible bridge stamp after retries. Not a control gap; correct or annotate the SUMMARY text at close-out so a later reader does not rely on it.
2. **Dry-run `--legacy-offset-s` / `--fixed-offset-s` are unvalidated** (REVIEW noted; a seconds-for-hours slip inflates the rebuild list). Affects the operator's candidate list only, which plan 06 requires founder approval of before any forced rebuild. LOW, not tracked as a threat.
3. **Deploy precondition (T-175-11).** Merging and deploying before both Railway worker services carry `MT5_SERVER_UTC_OFFSET_S` (or the rule) makes every MT5 derive fail transient. Plan 02 owns the check; it must be done before the deploy, not after.

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-175-01 | T-175-10 | A persistent operator clock fault is stamped on affected strategies with the true "automatic retries exhausted" sentence after three attempts, by the status bridge. | Founder, D-04 | 2026-10-27 |
| AR-175-02 | T-175-SC | No packages installed. | plan disposition | 2026-10-27 |

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Operator-pending | Run By |
|------------|---------------|--------|------|------------------|--------|
| 2026-10-27 | 21 | 13 (incl. T-175-SC accepted; T-175-11 closed on its code half) | 0 | 8 (T-175-05, 06, 07, 08, 17, 18, 19, 20) | gsd-security-auditor |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented
- [x] `threats_open: 0` confirmed (operator-pending rows are not open)
- [ ] Operator-pending rows (plans 02 and 06) to be re-audited after execution

**Approval:** SECURED for the executed code scope 2026-10-27; plans 02 and 06 pending.

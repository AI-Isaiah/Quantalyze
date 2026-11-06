---
phase: "188"
slug: "tinybase"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-06"
---

# Phase 188 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| marks and flows to stored rows | `csv_daily_returns` and `key_inputs` written by the worker's service role |
| stored rows to the allocator compose | the compose rolls levels back from stored returns and stored dropped-day P&L |
| venue ledgers to the NAV core | realized P&L, flows and balances from exchanges, folded by the combiners |
| combiner meta to persisted flags | the pre-stamp and the runner lift copy guard keys into `data_quality_flags` |
| combiner output to stored rows | the derive persists the non-NaN days of the combiner's series |
| worker to `key_inputs` and `strategy_analytics.data_quality_flags` | service-role writes of lists and P&L rows |
| pre-stamp to the series runner | worker-written JSONB read back as an input that moves the covered-day set |
| stored JSONB to TypeScript readers | untrusted at the reader (plans 07 and 08 parse it through plan 06's `readTinyBaseDays`) |
| stored JSONB (`key_inputs`, `data_quality_flags`) to TypeScript readers | worker-written, untrusted at the reader |
| `strategy_analytics.data_quality_flags` (worker JSONB) to the factsheet read path | untrusted at the reader |
| factsheet payload to a public page | the day list and the phrase are shown to any viewer of a published strategy |
| `allocator_equity_derived` `key_inputs:<id>` (worker JSONB) to the SSR dashboard read | untrusted at the reader, read under the owner's RLS |
| SSR payload to the client dashboard | the owner's own left-out ISO days, no amount |
| SSR payload to the client scenario engine | ISO day lists keyed by the owner's own api_key ids |
| orchestrator session to the PROD database | the linked CLI, read-only by procedure, no automated guard on the developer CLI |
| scratch reading to the public repo | only the SUMMARY lines cross |
| scratch directory to the public repo | only the SUMMARY lines cross; raw rows, ids and the mapping stay in `$HOME/.cache/quantalyze/` |
| analytics worker to `csv_daily_returns` (service role) | the derive's upsert and reconcile delete; the delete is the only path that removes stored history |
| combiner meta and stored marks to the delete span | the stated days that now widen the span come from this run's own reconstruction |
| worker-written `data_quality_flags` JSONB to the TS readers | untrusted at the reader; parsed by the strict `readTinyBaseDays` (unchanged here) |
| public share page to an anonymous viewer | the share page blends published legs server-side; the day list never reaches a client component (188-REVIEW round 2) |
| ship branch to main | the CI gate set and the squash merge; a skip token or a planning file on the branch subverts it |
| merge to Railway deploy | the deploy runs only after main's CI is green |
| the repo's analytics code to the scratch recompute | imported read-only; the emptied switch lives in the scratch process's memory, never in a file |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation (verified) | Status |
|-----------|----------|-----------|----------|-------------|-----------------------|--------|
| T-188-01 | Tampering (an invented number) | a tiny-base day written as 0.0 or blended at r = 0 | high | mitigate | `nav_marks_apply.py` tiny branch writes no row; `test_tiny_base_book.py` sole-key and two-key arms | closed |
| T-188-02 | Tampering (wrong money levels) | the compose roll on a tiny day | high | mitigate | `day_result = nav - base - flows` via `dropped_day_pnl_payload`; curve-moves-by-day-pnl test | closed |
| T-188-03 | Information disclosure | logs and exceptions of the new code | medium | mitigate | static `ValueError` text; tiny-base log lines carry counts only | closed |
| T-188-SC | Tampering | npm/pip/cargo installs | low | accept | accepted (AR-188-03) | closed (accepted) |
| T-188-05 | Tampering (an invented number) | a realized tiny day turned into 0.0 by a gap fill | high | mitigate | `broker_dailies._leave_out_tiny_base_days` after `gap_fill`; venues test over all combiners | closed |
| T-188-06 | Information disclosure | `tiny_base_day_pnl` (amounts) reaching `data_quality_flags` or a log | high | mitigate | `tiny_base_day_pnl` is an annotation key, never in flags; published-flags test | closed |
| T-188-07 | Denial of service | a NaN sFOX level reaching `window_peaks` (which raises on non-finite) | medium | mitigate | `chain_linked_twr` level map from finite levels only; sFOX arm | closed |
| T-188-04 | Denial of service (a derive that refuses forever) | a non-finite or unrollable pre-start level | medium | mitigate | `_pre_start_levels` breaks instead of raising; payload keeps non-finite refusal | closed |
| T-188-18 | Tampering (an invented flat day) | the gap days of a withheld mark read at r = 0 by a multi-key book | high | mitigate | T-GAP block in `nav_marks_apply.py`; T-GAP arms | closed |
| T-188-19 | Tampering (an invented flat day) | a quiet day on a near-empty account gap-filled to 0.0 | high | mitigate | quiet-carried loop names the day; `test_tiny_base_quiet_days.py` | closed |
| T-188-20 | Tampering (a day changed that the rule did not name) | the helper NaN-ing an ordinary quiet day | high | mitigate | helper touches only named days; absent list leaves returns unchanged | closed |
| T-188-08 | Information disclosure | `tiny_base_day_pnl` amounts in a flag or a log | high | mitigate | runner persists `tiny_base_days` only; published-flags test | closed |
| T-188-09 | Tampering | a malformed `tiny_base_days` list moving the covered days | medium | mitigate | `_read_navmtm_flags` drops a malformed list with one warning | closed |
| T-188-10 | Tampering (an invented number) | a realized tiny day read at r = 0 by the compose: any one on OKX/Bybit/Binance/sFOX, a quiet one on Deribit/MT5 | high | mitigate | `realized_tiny_base_pnl` hand-off with duplicate check; OKX and MT5 arms | closed |
| T-188-11 | Tampering | a Python/TS drift on the key or the threshold | medium | mitigate | `tiny-base-literal-pin.test.ts` pins both languages to independent literals | closed |
| T-188-21 | Tampering (a false disclosure) | a malformed list producing named days | medium | mitigate | `readTinyBaseDays` malformed arms; 188-06 drill RED | closed |
| T-188-12 | Tampering (a false disclosure) | a malformed `tiny_base_days` printing wrong days or a wrong count | medium | mitigate | `readTinyBaseDays` voids the whole list on any bad element | closed |
| T-188-13 | Information disclosure | the public note names the near-empty days | low | accept | accepted (AR-188-01, D-06) | closed (accepted) |
| T-188-14 | Elevation of privilege / information disclosure | reading another allocator's `key_inputs` | high | mitigate | `readMarksStart` on the RLS client filtered to the allocator | closed |
| T-188-15 | Tampering (a false disclosure) | a malformed or stale list adding days | medium | mitigate | `readTinyBaseDays` in `readMarksStart`; failed read gives `[]` | closed |
| T-188-22 | Tampering (an invented number) | a tiny-base day read as r = 0 by the SSR live baseline or a compare column | high | mitigate | `scenario.ts` excludes named days from axis, numerator and weight sum | closed |
| T-188-23 | Tampering (real days removed) | a malformed or forged list in the payload | medium | mitigate | list accepted only whole by `readTinyBaseDays`; SSR from the owner's RLS read | closed |
| T-188-24 | Information disclosure | per-key day lists in the client payload | low | accept | accepted (AR-188-02) | closed (accepted) |
| T-188-25 | Tampering (an invented number) | a tiny-base day read as r = 0 by the composer's engine set or the diversification panel, or the two disagreeing on one screen | high | mitigate | `diversification.ts` and composer carry `undefined_return_days`; tiny-base tests | closed |
| T-188-16 | Tampering | a write reaching PROD during the reading | high | mitigate | 188-11 SUMMARY: marker first, read-only | closed |
| T-188-17 | Information disclosure | ids, labels, amounts or paths reaching the public SUMMARY | high | mitigate | uuid and home-path greps over phase markdown: 0 hits | closed |
| T-188-26 | Tampering | a write reaching PROD during the baseline | high | mitigate | 188-12 SUMMARY: marker first, read-only; commit touches only the SUMMARY | closed |
| T-188-27 | Information disclosure | ids, labels, amounts or paths reaching the public SUMMARY | high | mitigate | 0 uuid/home-path hits; hashes only | closed |
| T-188-28 | Tampering | the widened reconcile delete removing legitimate history | high | mitigate | `_reconcile_hull` bounded by index days plus this run's stated list; scope-guard tests; 188-13 drills RED | closed |
| T-188-29 | Repudiation | the stated list and the deleted days drifting apart | medium | mitigate | one helper `_tiny_base_days_stored` feeds list, pre-stamp and span | closed |
| T-188-30 | Denial of service | an unbounded delete request line | low | mitigate | `_RECONCILE_DELETE_IN_BATCH = 200` | closed |
| T-188-31 | Information disclosure | amounts in logs or exceptions | low | mitigate | static hull error text; no amount in logs | closed |
| T-188-32 | Tampering | a strategy leg silently reading a left-out day as 0% after a future edit | medium | mitigate | 188-14 nine-site KL-5 drill table, each RED and restored | closed |
| T-188-33 | Information disclosure | a drill or a new arm leaking a strategy's day list to a client on the share page | low | mitigate | share page is server-only; list reaches `resolveSharedScenario` only | closed |
| T-188-34 | Tampering | a write to PROD beyond the product's enqueue | high | mitigate | 188-15: marker first; no enqueue needed | closed |
| T-188-35 | Repudiation | a re-reading against a baseline an old-code derive already moved (the 188-11 failure) | high | mitigate | 188-15 `gc-freshness ... fresh=yes`; 188-16 reads against b0 | closed |
| T-188-36 | Spoofing | a green board that is really suppressed CI | high | mitigate | runs re-derived from GitHub for PR head and merge commit; no skip token | closed |
| T-188-37 | Information disclosure | ids or credential-shaped literals in CHANGELOG, commits or the SUMMARY | high | mitigate | no credential, uuid or home-path pattern added by the phase | closed |
| T-188-38 | Tampering | a write reaching PROD during the reading | high | mitigate | 188-16 marker first, read-only capture | closed |
| T-188-39 | Information disclosure | ids, labels, amounts or paths reaching the public SUMMARY | high | mitigate | 0 uuid/home-path hits; ordinals only | closed |
| T-188-40 | Repudiation | a verdict bent by a rule chosen after the data (clipping days, loosening tolerances, skipping a refused key) | medium | mitigate | 188-16 lists every difference unexplained, verdict not bent; founder checkpoint (D-13) | closed |
| T-188-41 | Tampering | the emptied switch leaking into the repo or a deployed process | low | mitigate | no `analytics-service/services` change in 188-16 commits; switch was scratch-only | closed |

*Status: open · closed · open — below high threshold (non-blocking)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-188-01 | T-188-13 | The public factsheet note names the near-empty days (count, dates, threshold and window, never an amount). | founder, D-06 | 2026-11-03 |
| AR-188-02 | T-188-24 | Per-key day lists reach the owner's client payload as ISO days only, keyed by ids it already carries, from the owner's RLS read. | plan 09 threat model | 2026-11-06 |
| AR-188-03 | T-188-SC | No package is installed by any plan of this phase. | every 188 plan's threat model | 2026-11-06 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-06 | 42 | 42 | 0 | gsd-security-auditor (ASVS 1, block_on high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed

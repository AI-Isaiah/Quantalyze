---
phase: "229"
slug: "mt5derive2-an-mt5-key-s-return-chain-keeps-every-day-it-shou"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
block_on: high
created: "2026-11-28"
verified_at_sha: 98178ff2b
---

# Phase 229 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Written by `/gsd-secure-phase 229` on 2026-11-28 (state B: no SECURITY.md existed; the register comes from the six PLAN `<threat_model>` blocks). A gsd-security-auditor verified every mitigation at origin/main 98178ff2b. Paths are under `analytics-service/` unless marked otherwise.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| broker deal ledger -> derive (01) | Untrusted MT5 deal rows are folded into returns; the cohort rule decides which days publish | deal rows, P&L |
| analytics worker -> `strategy_analytics.data_quality_flags` (02) | Publicly readable flags: anything written there is visible to every factsheet reader | flag booleans |
| derive worker -> `allocator_equity_derived` jsonb (03) | The writer stores the token; the row is read back as untrusted input | writer-basis token |
| compose job -> logs (03) | Warnings leave the process and must carry no identity or amount | counts, token names |
| shipped combiner -> soak verdict (04) | The soak is the independent oracle behind the go-live gate; agreeing by construction would certify nothing | verdict |
| derive worker -> `csv_daily_returns` and `allocator_equity_derived` (05) | Two writes with no transaction, so the compose can read a stale-fresh mix | daily returns, per-day stamp |
| compose job -> `equity_curve` payload (05) | The book the allocator sees; a trusted-looking wrong book is the harm | equity curve |
| founder's machine with broker credentials -> public repository (06) | The soak handles a real login and server; the repo and `.planning/` are public | credentials (must not cross) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-229-01 | Tampering | `_judged_cohorts` published returns | high | mitigate | Skip only an empty cohort 0, and only when a later cohort holds P&L (`services/nav_twr.py` `_judged_cohorts`); 17 tests RED on the pre-fix rule (`229-VERIFICATION.md` Truth 1) | closed |
| T-229-02 | Repudiation | D-15 band acceptance | low | mitigate | `FLOW_TIMING_LARGE_RATIO = 1.0` unchanged; founder ruling "Keep 1.0, accept band" recorded in `229-01-SUMMARY.md`; boundary pin shown RED under neuter | closed |
| T-229-03 | Information disclosure | day-0 P&L amount | medium | mitigate | Only the bool `inception_day_pnl_dropped` crosses `nav_twr` (`services/transforms.py`, `services/job_worker.py`, `services/analytics_runner.py`); pinned in `test_transforms.py` and `test_job_worker.py` | closed |
| T-229-04 | Tampering | computation status | medium | mitigate | Both keys are in `NAV_TWR_ANNOTATION_KEYS`, never guard keys; `test_inception_day_pnl_dropped_is_carried_and_never_promotes` | closed |
| T-229-05 | Tampering | timed MT5 key composed on the legacy roll | high | mitigate | Writer token written at the store gate (`job_worker.py`, `writer_basis_withheld`), read by `read_writer_basis_withheld` at all three compose sites, mapped to blocking `KEY_INPUTS_MISMATCH`; 10 tests RED under neuter. Departed keys narrowed by founder ruling (see Accepted Risks) | closed |
| T-229-06 | Information disclosure | the two new warnings | medium | mitigate | Histogram over `WRITER_BASIS_WITHHELD_TOKENS` plus `unknown`, count-only logs; `test_an_unknown_stored_token_blocks_and_is_counted_as_unknown_never_echoed` | closed |
| T-229-07 | Denial of service | malformed stored token | low | mitigate | `read_writer_basis_withheld` raises `ValueError` with no stored value; caught by the existing `_permanent_corrupt_input` disposal; `test_a_malformed_withheld_token_disposes_the_compose_job_as_a_corrupt_input` | closed |
| T-229-08 | Tampering | `_walk_cohorts` independence | high | mitigate | `scripts/mt5_soak.py` `_walk_cohorts` written from the rule text; AST `_independence_violations` and `_PRODUCTION_DENYLIST` in `tests/test_mt5_soak.py`; hand Fraction walk test; PROOF-01 in `229-04-SUMMARY.md` | closed |
| T-229-09 | Repudiation | moved soak tests | medium | mitigate | "Moved-test ledger" in `229-04-SUMMARY.md`: 7 tests with old assertion, premise and new invariant | closed |
| T-229-10 | Tampering | stale `key_inputs` row composed with fresh returns | high | mitigate | Per-day returns stamp written in the same upsert as the basis; `returns_stamp_mismatch_days` compared per raw key at the counted, stitch-source and departed sites via `_compare_returns_stamp`, mapped to `key_inputs_mismatch`; PROOF-01 (a)-(j) in `229-05-SUMMARY.md` | closed |
| T-229-11 | Denial of service | non-finite stamped value | medium | mitigate | `returns_stamp_payload` raises `NavReconstructionError` before the upsert with a digit-free message; `test_a_non_finite_return_is_refused_before_the_upsert_without_naming_it` | closed |
| T-229-12 | Denial of service | false refusal of a healthy book | high | mitigate | Rows outside the stamp window ignored; absent stamp counted at info level, not refused; `test_a_healthy_pair_is_never_refused` (parametrized), quiet-day and NAV-marks-era tests; over-refusal neuter RED. Residual accepted (see below) | closed |
| T-229-13 | Information disclosure | the stamp warnings | low | mitigate | Counts only, no id, day or amount | closed |
| T-229-14 | Information disclosure | soak record and pasted output | high | mitigate | `MT5_SOAK_LOG_DIR` outside the repo for every run (`229-06-SUMMARY.md`); only the exit line and sanitized verdict lines recorded; merge `2761b04be` changed no file under `analytics-service/docs` | closed |
| T-229-15 | Repudiation | phase gate and soak verdict | medium | mitigate | Gate tails and the soak reading recorded verbatim in `229-06-SUMMARY.md`, deviations included | closed |
| T-229-SC | Tampering | package installs (all six plans) | low | accept | No package added; merge diff shows only the version bump in `package.json` | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-229-01 | T-229-SC | No package is installed or bumped by any plan | plan threat models | 2026-11-24 |
| AR-229-02 | T-229-12 (residual) | A compose running while the epilogue enqueues can leave a book transiently blocked until the next trigger, the same shape as `realized_terminal_day_mismatch`; partly mitigated by the `lagging_inputs` transient retry (`229-05-SUMMARY.md`, "Transient race") | 229-05 plan | 2026-11-24 |
| AR-229-03 | T-229-05 (departed keys) | A departed key's withheld token or stale stamp does not block, because it never re-derives and the block could not self-heal; it raises the non-blocking `departed_writer_basis_unchecked` flag (`229-CONTEXT.md` MT5D-07 scope note) | founder ("Exempt departed keys") | 2026-11-24 |
| AR-229-04 | T-229-02 | MT5D-06 D-15 band kept at 1.0; root fix tracked as `[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]` | founder ("Keep 1.0, accept band") | 2026-11-24 |

*Accepted risks do not resurface in future audit runs.*

---

## Notes (non-blocking, not counted toward threats_open)

- `scripts/mt5_soak.py` still defaults `MT5_SOAK_LOG_DIR` to the tracked `docs/evidence` directory when the variable is unset. This predates 229, so T-229-14's control is procedural: it was followed and recorded, but an operator who omits the variable would write the raw record into the repo. A hardening candidate, not a 229 gap.
- T-229-14's live-soak evidence is the coordinator's relay; the porcelain gate could not run in the Railway container (`229-06-SUMMARY.md`, "Not measured"). The in-container `/tmp` log dir is the actual control.
- The timed branches (MT5D-04, MT5D-07) were not exercised by the live soak (`timed` = 0); they are proven by the PROOF-01 RED/GREEN records and fixtures.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-28 | 16 | 16 | 0 | gsd-security-auditor via `/gsd-secure-phase 229` at 98178ff2b |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-28

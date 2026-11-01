---
phase: "184"
slug: "walletoffset-the-first-mark-offset-on-wallet-base-venues-is"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-01"
---

# Phase 184 - Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Audited at HEAD `0302ef849` (branch `feat/184-planning`). Scope: the read-only probe
> `analytics-service/scripts/walletoffset_probe.py`, its tests
> `analytics-service/tests/test_walletoffset_probe.py`, and the two operator runs on the Railway
> backfill worker recorded in 184-04-SUMMARY and 184-07-SUMMARY. Implementation files were read only.

**Verdict: SECURED.** 34 register rows across plans 184-01 to 184-07 (T-184-SC counted once):
31 `mitigate` rows CLOSED with evidence, 3 `accept` rows logged below. `threats_open: 0`.
The auditor ran the probe test file once (178 passed) and recomputed the deploy-fingerprint and
parser-shape lines from the probe; both equal the lines recorded in 184-03, 184-04, 184-06 and 184-07.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| probe -> PROD database (service role) | the worker's key can write; the probe must only select | `api_keys` rows and key marks, read through `ReadOnlySupabase` |
| probe -> stored credentials | decrypting a key the probe will not read exposes it for nothing | decrypted venue credentials, in memory only |
| probe -> venue APIs (OKX, Bybit, Binance) | keys that can trade or move money; the probe must only GET | `private_get_*` reads through `BudgetedExchange`, one Binance income GET by exact name |
| venue reply -> probe | untrusted strings, non-finite numbers, free-text messages | bills, funding rows, error text; refused as closed tokens |
| probe stdout -> tracked public SUMMARY | records are pasted into a public repo | whitelisted keys, `k1..kN` labels, sig3 ratios, counts, dates |
| deployed probe -> worker run | the run must execute the reviewed code | deploy-fingerprint and parser-shape lines |
| founder / operator -> Railway backfill worker | a temporary start-command change on a PROD service | start command, restored to `python -m main_worker` |
| orchestrator -> founder, ledger text -> public repo | the decision and its records | venue-decision string, labels, ratios |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-184-01 | Tampering | database handle in `run()` | high | mitigate | `ReadOnlySupabase` exposes `select` only; only literal table `api_keys`; marks via `read_key_marks`; bare-client control proves a write would be recorded | closed |
| T-184-02 | Tampering | venue client | high | mitigate | `BudgetedExchange` refuses non-`private_get_` names, `KEY_CALL_CEILING`; source pins refuse order/cancel/withdraw/transfer and post/put/delete in both naming styles (W8 RED) | closed |
| T-184-03 | Information disclosure | stdout and stderr | high | mitigate | `emit_record` -> `validate_record` + `assert_sanitized`; `main` prints exception TYPE only after `logging.disable(CRITICAL)`; `failure_token` via `classify_failure`; planted-needle test with leaky controls (W3, W9 RED) | closed |
| T-184-04 | Spoofing / Tampering (data integrity) | incomplete reading presented as complete | high | mitigate | reach proof, page and call ceilings, malformed and non-finite refusals as closed tokens, `field-absent` never 0 | closed |
| T-184-05 | Information disclosure | decrypted credentials | medium | mitigate | credentials only via `decrypt_credentials`, local to `_read_one_key`; no credential key in the record vocabulary | closed |
| T-184-06 | Denial of service | rate limits on shared keys | low | accept | see Accepted Risks Log | closed |
| T-184-07 | Tampering | Bybit and Binance venue calls | high | mitigate | Bybit `private_get_*` through the budget (pinned by test); Binance `fapiPrivateGetIncome` by exact name; plan 184-02 source pins | closed |
| T-184-08 | Spoofing / Tampering (data integrity) | Bybit or Binance reading presented as complete | high | mitigate | `page_ceiling`, `malformed`, `read_failed` paths; no partial sums | closed |
| T-184-09 | Tampering (data integrity) | formula drift between probe and chain | medium | mitigate | `test_bybit_parity_with_fetch_daily_pnl` drives the real chain; mutations B1-B4 RED | closed |
| T-184-10 | Information disclosure | Bybit and Binance records | high | mitigate | same whitelist emitter; label passed as log name; logging disabled in `main`; redaction test covers the failure arm | closed |
| T-184-11 | Tampering | deploy mismatch at run time | medium | mitigate | `deploy_fingerprint` pinned by tests (F1 RED); recomputed line equals the recorded one | closed |
| T-184-12 | Denial of service | backfill worker start command (run 1) | high | mitigate | probe in background then exec of the normal start; `worker-restored: yes` precedes the readout lines; start command back to `python -m main_worker`, log shows normal startup (184-04-SUMMARY) | closed |
| T-184-13 | Tampering | deploy mismatch (run 1) | medium | mitigate | `fingerprint-expected` equals `import-check`; deployed commit is the merge (184-04-SUMMARY) | closed |
| T-184-14 | Information disclosure | SUMMARY in a public repo (run 1) | high | mitigate | whitelist records only; scan of phase SUMMARY/CONTEXT/VERIFICATION/REVIEW text: no uuid, no home path, no ten-plus digit run outside commit lines | closed |
| T-184-15 | Repudiation (data integrity) | readout lines drifting from records (run 1) | medium | mitigate | values copied and cross-checked (LINES_OK); `sc1-met` derived from counts | closed |
| T-184-16 | Elevation of privilege | executor reaching Railway or PROD (run 1) | high | mitigate | orchestrator-only checkpoints with founder approval; no executor record of Railway access | closed |
| T-184-17 | Repudiation | the founder's decision | medium | mitigate | same venue-decision string in 184-05-SUMMARY, CONTEXT D-02 and the ROADMAP Phase 184 section; answers verbatim | closed |
| T-184-18 | Tampering (data integrity) | a published number changed in a measurement phase | high | mitigate | SC-3 file-list proof on both merges re-run: only probe, tests, test helper, CHANGELOG, VERSION, package.json | closed |
| T-184-19 | Information disclosure | CONTEXT, ROADMAP and SUMMARY text | high | mitigate | labels, ratios, counts, dates only; DECISION_OK and the independent scan are clean | closed |
| T-184-20 | Tampering | ROADMAP collateral damage | medium | mitigate | the decision commit changed ROADMAP by two lines, both in the Phase 184 section; no handler run | closed |
| T-184-21 | Repudiation (evidence integrity) | read-only pins and leak check | high | mitigate | bare fake records a write, leaky strings report needles, W3 and W6-W11 RED | closed |
| T-184-22 | Information disclosure | credentials decrypted for a refused key | medium | mitigate | `_check_readable` decides every no-venue refusal before `_read_one_key`; tests assert `decrypt_calls == []` | closed |
| T-184-23 | Spoofing / Tampering (data integrity) | eligibility rule silently dropping a key | high | mitigate | uses `eligible_key_predicate`; `test_unmeasurable_error_status_key_is_read_not_refused` and the sign_in_failed test; W10 RED | closed |
| T-184-24 | Tampering (data integrity) | `_parse_window_bill` -> OKX funding sum | high | mitigate | parser keeps `instId`; run()-driven test asserts a measured record against a literal; neuter G01 RED, RED commit precedes the fix | closed |
| T-184-25 | Repudiation (evidence integrity) | a test passing for the wrong reason | medium | mitigate | test asserts MEASURED with a literal; RED at HEAD recorded; verifier re-ran the neuter | closed |
| T-184-26 | Information disclosure | instrument name in the parsed bill | low | accept | see Accepted Risks Log | closed |
| T-184-27 | Tampering | deploy mismatch at re-run time | medium | mitigate | parser-shape line (computed by the plan's `python -c`, not the probe) recorded in 184-06-SUMMARY; 184-07 `parser-expected` equals `parser-check` equals it | closed |
| T-184-28 | Repudiation / Elevation of privilege | PROD start-command change without fresh approval | high | mitigate | `rerun-approved: yes` precedes every run line; founder's answer recorded (184-07-SUMMARY) | closed |
| T-184-29 | Denial of service | backfill worker start command (run 2) | high | mitigate | background probe then exec; `worker-restored: yes` precedes the readout lines; start command read back as `python -m main_worker`; normal worker log | closed |
| T-184-30 | Tampering | deploy mismatch (run 2) | medium | mitigate | parser-shape names `instId` and matches; fingerprint matches; deployed merge is a descendant of the first run's merge | closed |
| T-184-31 | Information disclosure | SUMMARY in a public repo (run 2) | high | mitigate | RERUN_OK, APPROVAL_OK, LINES_OK recorded; independent scan clean; parser-shape line holds key names only | closed |
| T-184-32 | Repudiation (data integrity) | readout drift or rewritten first-run history | medium | mitigate | values cross-checked; 184-04-SUMMARY unchanged and still records its history | closed |
| T-184-33 | Elevation of privilege | executor reaching Railway or PROD (run 2) | high | mitigate | all three tasks orchestrator-run | closed |
| T-184-SC | Tampering | npm/pip/cargo installs | low | accept | see Accepted Risks Log | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-184-01 | T-184-06 | One short run per operator plan (about 30 s and 40 s); per-key `KEY_CALL_CEILING` and `KEY_READ_TIMEOUT_S` are present anyway, and the worker's own 429 backoff applies | plan 184-01 threat model | 2026-11-01 |
| AR-184-02 | T-184-26 | The parsed bill never reaches stdout; `emit_record` prints whitelisted keys only and `validate_record` refuses any other key; an instrument name is not an id or an amount | plan 184-06 threat model | 2026-11-01 |
| AR-184-03 | T-184-SC | No package installed; neither merge touched a requirements file | plans 184-01 to 184-07 threat models | 2026-11-01 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-01 | 34 | 34 | 0 | gsd-security-auditor (Sonnet, high) via /gsd-secure-phase 184 |

Informational, not register items: REVIEW.md's out-of-scope chain dedupe defect in
`services/funding_fetch.py` is routed to the founder there; IN-10 and IN-11 fail closed / safe.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-01

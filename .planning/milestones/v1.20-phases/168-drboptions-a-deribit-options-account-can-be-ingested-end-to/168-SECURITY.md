---
phase: "168"
slug: "drboptions-a-deribit-options-account-can-be-ingested-end-to"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-09-26"
---

# Phase 168 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Verdict: **SECURED**. 13 threats in the register, 13 closed, 0 open. Evidence is cited by symbol.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Deribit transaction log -> analytics-service classifier and option-book replay | Untrusted venue rows drive the P&L arms and the position replay. | Row `type`, `instrument_name`, `change`, `position`, `commission` (untrusted venue input) |
| Refusal text -> `compute_jobs.last_error` -> customer-facing diagnostics panel | Any row detail placed in a `LedgerValuationError` message is visible to a customer. | Row id, type, scope label, currency, and the whitelisted shape only |
| MTM degrade reason -> factsheet copy | A fixed reason label selects static factsheet text. | A fixed string label, with no row data |
| `.planning/` and `analytics-service/docs/` -> public repo | The evidence file and plans are world-readable. | Counts and categories only |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-168-01 | Tampering | Assignment double count beside a same-instrument delivery or settlement, or an unnamed instrument summed | high | mitigate | `deribit_txn.py:assert_assignment_uncontested` is called on every `assignment` row in both twins (`txn_rows_to_daily_records`, `txn_rows_to_native_daily`). It refuses an unnamed instrument, a non-option instrument, and a contesting sibling (`_ASSIGNMENT_CONTESTING_TYPES`). An in-memory no-op neuter of the guard failed 31 tests. | closed |
| T-168-02 | Tampering | Assignment dropped, so realized cash is lost | high | mitigate | `"assignment"` is in `CASH_BEARING_TYPES`, backed by an import-time `_OPTION_BOOK_EVENT_TYPES <= CASH_BEARING_TYPES` assert. The census-shape end-to-end tests and the balance-identity tests cover it. | closed |
| T-168-03 | Tampering | `mark_to_market` summing the full assignment change inside summary coverage | high | mitigate | All six sites read `_OPTION_BOOK_EVENT_TYPES` or `_OPTION_EXPIRY_TYPES`, and so does `scripts/deribit_acceptance.py:check_perp_only_eligibility`. A grep for the old literal forms returns 0 hits, so no seventh site exists. Each site has a site-numbered pin test. | closed |
| T-168-04 | Tampering | A windowed crawl classifying on partial history | medium | mitigate | `deribit_ingest.py:_crawl_deribit_ledger` refuses any `assignment` row when `since_ms` is set. The check runs before the index fetch and before the USD twin. Tests: `test_windowed_refuses_an_assignment`, `test_windowed_refuses_before_the_usd_twin`. | closed |
| T-168-05 | Information disclosure | New refusal text leaking identifiers into `last_error` | high | mitigate | Every new refusal interpolates only four values: the venue row id, the row type, `scope.label` and currency. The families are the assignment guards, the windowed guard, `OptionRowFieldMissingError`, and the expiry and exercise refusals. Any further row detail comes only through `describe_unclassified_row`, which is limited to the `_SHAPE_FIELDS` whitelist. `scope.label` has one production construction site, and it always holds the literal main-account label: never an account id or strategy name. `test_identifiers_are_REDACTED_by_whitelist` passes. Note: the whitelist, by its pre-phase design, does let instrument name, change, timestamp, side, commission and position reach `last_error`. | closed |
| T-168-06 | Information disclosure | Evidence file carrying ids, a strategy, an instrument or a change value | medium | mitigate | `docs/evidence/drb-assignment-census-2026-09.json` holds counts and categories only. `test_census_evidence_file_carries_counts_and_nothing_identifying` pins this with forbidden keys and `_INSTRUMENT_RE`. Five scratch-copy neuters each went RED: an instrument string, an ISO expiry, `strategy_name`, `change` and `account_id`. With the regex blanked, the instrument injection passes, which proves the regex is load-bearing. | closed |
| T-168-07 | Tampering | MTM double count if site 5 regresses | high | mitigate | `test_site5_mtm_inside_coverage_contributes_minus_commission` and `test_site5_mtm_e2e_assignment_through_the_native_ledger` pass. | closed |
| T-168-08 | Tampering | Smoothed replay carrying the assigned short past expiry | high | mitigate | `test_site4_replay_zeroes_the_assigned_short` and `test_smoothed_e2e_short_put_assigned_ingests_flat` pass. | closed |
| T-168-09 | Tampering | A missing position or commission defaulted to zero | high | mitigate | `_option_commission` and `replay_option_positions` raise `OptionRowFieldMissingError` when the value is absent, null, blank or (for position) non-numeric. Covered by the SITE4/SITE5 missing-field tests and the `test_sfh04_*` distinct-class tests. | closed |
| T-168-10 | Information disclosure | `_SHAPE_FIELDS` widening leaking identifiers | medium | mitigate | Only `commission` and `position` were added, and the renderer is unchanged. The WR-02 scope stamp `ROW_SCOPE_KEY` is not in `_SHAPE_FIELDS`, so it never renders. That was verified from the code structure, and no test pins its absence. | closed |
| T-168-11 | Information disclosure | Identifiers from the production retry reaching the public SUMMARY | medium | mitigate | The control is in plan 03: the D-08 acceptance criterion requires counts and classes only. `168-03-SUMMARY.md` does not exist yet because plan 03 is a founder-owned post-deploy checkpoint, so compliance must be re-checked when it is written. | closed |
| T-168-12 | Elevation of privilege | An agent touching PROD or Deribit to "help" the observation | high | mitigate | The control is in plan 03: D-06 and the task action forbid any agent PROD, log or broker read. The diff adds no network call, env read or endpoint (see Additional surfaces (d)). | closed |
| T-168-SC | Tampering | Package installs | low | accept | See the Accepted Risks Log. The diff touches no dependency manifest, lockfile or migration. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

### Additional surfaces verified

- **(a) Refusal messages.** Every new refusal family carries only venue row ids and types, the scope label and the currency, plus the whitelisted shape. None carries a strategy name or an account id.
- **(b) MTM reason string.** `stitch_composite.py:MTM_REASON_OPTION_ROW_FIELD` is the fixed label `mtm_option_row_field_missing`. `job_worker.py:run_derive_broker_dailies_job` assigns it only through an `isinstance(..., OptionRowFieldMissingError)` branch. The stamp is the label alone. The existing warning log passes the exception text through `scrub_freeform_string`, and that text carries only a row id and type.
- **(c) Factsheet copy.** `basis-context.tsx:mtmDisabledReasonCopy` returns a static string literal for `mtm_option_row_field_missing`, with no interpolation. Its tone is `steady`.
- **(d) No new secret or network path.** The added lines of the implementation diff were grepped for HTTP clients, env reads, URLs, broker call prefixes, `process.env`, `dangerouslySetInnerHTML` and template interpolation. The grep returned 0 matches. No dependency manifest or migration changed.

### Informational (non-blocking)

- Neither `168-01-SUMMARY.md` nor `168-02-SUMMARY.md` has a `## Threat Flags` section. The section is absent; the SUMMARYs do not list zero flags.
- The expiry close and the exercise refusal (added under founder decision D6) map to T-168-05 (id-only messages) and T-168-09 (fail closed). They add no unregistered surface.
- The evidence-file key check has no `strike` or `expiry` fragment and does not check integer values. The file holds no such key today.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-168-01 | T-168-SC | Plans 01, 02 and 03 install no package. The diff against the merge base touches no dependency manifest, lockfile or migration (verified 2026-09-26). | Plan threat register (disposition: accept), confirmed by the audit | 2026-09-26 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-26 | 13 | 13 | 0 | gsd-security-auditor (ASVS 1, block_on high). Targeted tests: 389 passed. |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-26. T-168-11 must be re-checked when the founder-owned `168-03-SUMMARY.md` is written.

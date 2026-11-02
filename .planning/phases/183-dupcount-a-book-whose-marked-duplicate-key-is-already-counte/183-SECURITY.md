---
phase: "183"
slug: "dupcount-a-book-whose-marked-duplicate-key-is-already-counte"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-02"
---

# Phase 183 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Audited at `9397f1045cdaf28d7155d022b06796866ab911b7` (branch `feat/183-dupcount`), ASVS L1, block on high.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| `api_keys` / `csv_daily_returns` / `key_inputs` rows -> derive worker | owner-written key markers and worker-written series, read by the derive | key markers, return series (owner-scoped) |
| derive worker -> `allocator_equity_derived` | the composed curve or the refusal row the reader shows | equity series, closed refusal tokens |
| derive worker -> Railway logs and Sentry | operator-visible text | static messages, tags and counts only |
| `allocator_equity_derived` row (worker-written JSONB) -> SSR producer | untrusted payload read defensively | version-2 trustworthy series or a closed reason token |
| owner's `api_keys` rows (RLS-scoped) -> key cards | the share note names another of the owner's keys | `holderLabel` only, never an id |
| census script -> PROD (operator, read-only) | `--print-sql` statements under marker and RLS guards | token buckets and integer counts |
| orchestrator -> PROD database / Sentry | read-only SELECTs after the marker query; read-only event counts | counts and closed tokens |
| SUMMARY, ROADMAP, runbook, `TODOS.md` -> public repo | tracked text | counts, closed tokens, shas |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-183-01 | Tampering | identity gate in `derive_allocator_equity` | high | mitigate | gate refuses only on `collisions` from `account_identity_tokens` (`job_worker.py`, `if collisions:` branch); `test_a_marker_pair_that_were_both_counted_collides_as_one_account` | closed |
| T-183-02 | Tampering | marked pair summed twice | high | mitigate | `test_holder_matrix_parity.py` asserts `n_keys` per cell over the 72-cell `shared_account_resolution.json`; PROD-shaped test pins `n_keys == 2`, terminal 140000 over four anchors | closed |
| T-183-03 | Information disclosure | WARNING log and Sentry message | medium | mitigate | static message, `compute_job_id` and `derive_refusal` tags, counts only; caplog tests assert no key or venue id; no Sentry capture for a counted-once book | closed |
| T-183-04 | Repudiation | old refusal no longer reaches Sentry | low | accept | false refusal; collision still pinned to Sentry at warning by `test_identity_refusal_reaches_sentry_as_an_event` | closed |
| T-183-05 | Tampering | `equityHistoryReadiness` ready over a double count | high | mitigate | ready requires `extractTrustworthyDerivedSeries` (version 2, `is_trustworthy`); 72-cell matrix guards in `holder-matrix-parity.test.ts` | closed |
| T-183-06 | Tampering | stale PROD `account_duplicate` row | medium | mitigate | `queries.ts` maps `account_duplicate` and `account_identity_collision` to `duplicate_account`; pinned by the "Phase 183 transition" test and R3-WR-03 | closed |
| T-183-07 | Information disclosure | reader output | low | accept | no new field; closed reason tokens only | closed |
| T-183-08 | Tampering | census (e) vs reader disagreement | medium | mitigate | real-PG (e) arm in `accounttruth-census.test.ts` ran on a throwaway cluster (not skipped) | closed |
| T-183-09 | Tampering | retired token returning as a live refusal | medium | mitigate | `ACCOUNT_DUPLICATE` removed from `DeriveRefusal`; `test_no_legacy_refusal_is_a_derive_refusal_member` | closed |
| T-183-10 | Tampering | stale row read as generic line by census or reader | medium | mitigate | `legacy_refusals` replayed through the census CASE and `derive-refusal-rows.test.ts` | closed |
| T-183-11 | Information disclosure | census printout | high | mitigate | `parseCounts` refuses id-shaped and non-token buckets; marker, read-only and RLS probes run first; diff removes buckets, adds none | closed |
| T-183-12 | Tampering | wrong database | high | mitigate | marker query run alone first, `marker: names PRODUCTION` recorded in 183-04-SUMMARY and gated in SC4_OK; `runCensus` aborts on a marker mismatch (session itself rests on the SUMMARY record) | closed |
| T-183-13 | Tampering | accidental PROD write | high | mitigate | 183-04-SUMMARY records `prod-writes: 0`, single SELECTs only, write-verb grep on the census file (rests on the SUMMARY record) | closed |
| T-183-14 | Information disclosure | tracked planning text | high | mitigate | auditor scanned every added `.planning` and `TODOS.md` line: only sha lines, migration timestamps and `verify-symbol` anchors; no PROD id | closed |
| T-183-15 | Repudiation | claiming trustworthy or resolved without evidence | medium | mitigate | `sc4-met: yes` sits beside recorded R1, R2 and Sentry values; the SUMMARY hands over `sentry-resolve-list` without claiming resolution. QUANTALYZE-2H and QUANTALYZE-23 were later marked resolved in Sentry on 2026-11-02 by the orchestrator with the founder's authorization | closed |
| T-183-16 | Denial of service | deploy straddling the nightly derive | low | mitigate | deploys at 12:35Z and 21:13Z, outside 00:30-06:45 UTC; reading bound to `computed_at` 2026-11-02T01:31Z | closed |
| T-183-17 | Information disclosure | `accountShareNote` sentence | medium | mitigate | sentence built from `holderLabel` only; `AllocatorExchangeManager.test.tsx` asserts no holder id in the note | closed |
| T-183-18 | Tampering (user-facing) | note over a double count | medium | mitigate | visibility guards unchanged, only the sentence changed; 72-cell table pins derive and reader | closed |
| T-183-19 | Repudiation | old remove-a-key remedy returning | low | mitigate | `AccountShareNoteAction` and the third parameter removed (tsc rejects a verb); no-remedy guard over 6 venues x 4 statuses plus the rendered-card check | closed |
| T-183-20 | Spoofing | muted note vs warning | low | accept | `text-text-muted` pinned and `text-warning` asserted absent on both cards | closed |
| T-183-SC | Tampering | npm/pip/cargo installs | low | accept | no `package.json` or lockfile change in the diff | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

### Unregistered flags (informational, non-blocking)

Two review-fix additions are in no plan's register and no SUMMARY flags them. The auditor judged both within existing patterns.

1. **Recompose enqueue after a new marker** (`analytics-service/services/account_identity.py`, WR-01 fix). It calls the service-role RPC `enqueue_compute_job` with the owner id taken from `key_row["user_id"]`, the same source the per-key derive epilogue uses. It is best effort. A failure logs the api_key id, exception class and code at ERROR, as other stamper lines already do. `test_a_failed_recompose_enqueue_does_not_undo_the_marker` covers it.
2. **D-05 marker re-read and single redo** (`analytics-service/services/job_worker.py`, step 5a). `_markers_rechecked` caps the redo at one, and a second change ends transient with no curve saved. The logs carry only `allocator_id`.

**Test note.** On the auditor's first run, two D-05 tests failed once and then passed in isolation: `test_a_marker_that_lands_mid_compose_is_recomposed_before_the_curve_is_saved` and `test_a_marker_that_lands_during_the_redo_ends_transient_without_a_curve`. The likely cause is concurrency: the verifier was neutering the step-5a block of `job_worker.py` at the same time to prove these two tests go RED, and restored it byte-identical afterwards. After both agents finished, the orchestrator ran the four phase test files three times at HEAD and got 362 passed each time.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-183-01 | T-183-04 | The removed refusal was a false refusal (183-RESEARCH Q1). The collision refusal still reaches Sentry at warning. | plan 183-01 threat model | 2026-11-02 |
| AR-183-02 | T-183-07 | Reader adds no field and emits closed reason tokens only | plan 183-02 threat model | 2026-11-02 |
| AR-183-03 | T-183-20 | The note's tone only; the muted class is pinned on both cards | plan 183-05 threat model | 2026-11-02 |
| AR-183-04 | T-183-SC | No package installed or upgraded | plans 183-01..05 threat models | 2026-11-02 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-02 | 21 | 21 | 0 | gsd-security-auditor (Sonnet, high), verdict SECURED |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-02

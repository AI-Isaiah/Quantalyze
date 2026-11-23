---
phase: "155"
slug: "parityharness"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-14"
---

# Phase 155 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| PROD database to capture | Read-only SELECT capture through the Supabase MCP, marker query first, run by the orchestrator only | Account-scoped figures (sensitive, kept in the gitignored capture directory) |
| External oracle to harness | Terminal readings, Report export and broker statements enter only through the provenance-checked intake | Founder-supplied readings (sensitive) |
| Harness to tracked records | Census, findings, RED-proof and dress-rehearsal records rendered through the record-profile scanner | Labels, buckets, dates, counts, 3 s.f. ratios only |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-155-01 | Spoofing | load_worksheet / require_provenance | high | mitigate | exact three-value enum, no normalisation, refusal before a Reading exists; test (c) refuses `gateway` | closed |
| T-155-02 | Tampering | seal_capture / load_capture | high | mitigate | bind before/after equality, row_count and day witnesses, sha256 per sealed slice and manifest, symlink and size refusal; Task 2 Test 7 | closed |
| T-155-03 | Information disclosure | render_verdict_markdown, fixtures | high | mitigate | Verdict types hold no amount, date or id field; render test (d) rejects 5+ digit runs and >3 s.f. decimals; fixtures carry invented values and all-zero-pattern UUIDs only | closed |
| T-155-04 | Tampering | docs/runbooks/mt5-parity/*.sql | critical | mitigate | superset WRITE_WORDS and function denylist, one-statement rule, RED proof on a neutered copy, marker first in the README, exec on a throwaway cluster in plan 04 | closed |
| T-155-05 | Information disclosure | census-accounts.sql | high | mitigate | login and label never selected (keys_sharing_login compares inside SQL); ordinals instead of ids in tracked output; server recorded as a literal; redaction scan of the runbook tree | closed |
| T-155-06 | Information disclosure | capture directory | high | mitigate | `/.mt5-parity/` in .gitignore, pinned by literal line, `git check-ignore` and an empty `git ls-files` | closed |
| T-155-07 | Tampering | capture-*.sql and the per-ordinal wrapper | critical | mitigate | the same superset gate over all files; the one run-time form (render-ordinal) is itself gated in Task 3; README forbids editing committed files | closed |
| T-155-08 | Information disclosure / Repudiation | capture output | high | mitigate | secrets, login and raw_payload never selected; outputs land only in the gitignored capture dir; witnesses make a silent truncation impossible to mistake for a short record | closed |
| T-155-09 | Tampering | exec harness connection | high | mitigate | initdb'd cluster with a local marker string, no TCP listener, trust auth on a private socket, no env-derived DSN; the harness never reads a DB URL | closed |
| T-155-10 | Repudiation | census correctness | medium | mitigate | hand-computed oracles for S disagreement, identity (0 and 5), empty and zero-key cases; SQL fixed at source on a miss | closed |
| T-155-11 | Tampering / DoS | parse_report | high | mitigate | size cap, stdlib HTMLParser (no external entity fetch), closed header, type and direction vocabularies, strict numbers and times, refuse rather than coerce | closed |
| T-155-12 | Spoofing | require_provenance / require_complete / bind_report | high | mitigate | exact three-value enum, per-reading allowed subset, Report bound to the worksheet by sha256, synthetic flag carried by the worksheet | closed |
| T-155-13 | Information disclosure | parser output, error messages | high | mitigate | header block, Symbol and Comment never returned; messages name columns and row ordinals, never money values (the mt5_deals convention) | closed |
| T-155-14 | Tampering | classify_breach / explainers | high | mitigate | buckets only by explicit counterfactual re-run; unexplained only after every explainer; explained breaches stay RED; fallthrough guard tests with empty and always-True registries | closed |
| T-155-15 | Repudiation | window picker | medium | mitigate | named refusal reasons, every refusal tested; a refused window is a RED verdict with the reason, never a skipped account | closed |
| T-155-16 | Spoofing | Verdict rehearsal flag / OracleBindingRefused | high | mitigate | final_green False for any synthetic worksheet; rehearsal header line; cross-label binding refused unless synthetic; tests for each | closed |
| T-155-17 | Tampering | run_red_proof | medium | mitigate | mutations only on a temp copy outside the fixtures dir (refused otherwise), byte backup and sha256, committed-fixture sha guard | closed |
| T-155-21 | Tampering | real-mode capture read | high | mitigate | sha256 sidecar verified per slice and for the manifest; throw on miss or mismatch; no skip | closed |
| T-155-22 | Information disclosure | surface-matrix.json, error cells | high | mitigate | written only inside the gitignored capture dir (or a temp dir); error cells carry the error class name, never its message; tracked text is rendered later by plan 08 to 3 s.f. ratios | closed |
| T-155-23 | Information disclosure | render_census_markdown, render_findings_markdown | high | mitigate | fixed column lists, every float through ratio_3sf, instants to the minute, labels only (LabelMissing refusal); scan_tracked_text with the record profile is the backstop and the records CLI exits 1 on a hit | closed |
| T-155-24 | Information disclosure | scan_tracked_text output | medium | mitigate | returns rule names only, never matched text; CLI prints path and rule | closed |
| T-155-25 | Repudiation | classify_matrix, classify_flag | medium | mitigate | closed tables built from imported tuples; unknown key and unknown cell state fail closed (unknown finding or ValueError), never a silent pass; deterministic finding ids | closed |
| T-155-26 | Information disclosure | four-digit amounts and phase-id-shaped decimals | low | accept | the scanner cannot tell a four-digit amount from a count, and it exempts the phase-id shape (e.g. 155.1); renderers have no amount column by construction, which is the primary control | closed |
| T-155-27 | Tampering | PROD via the orchestrator's SQL | critical | mitigate | only committed files that passed plan 02/03's write-keyword gate and plan 04's execution test; marker first; one file per call; render-ordinal is the only run-time form | closed |
| T-155-28 | Spoofing | which database answered | high | mitigate | marker query must name PRODUCTION before any other call; stop on NULL or another name | closed |
| T-155-29 | Tampering | truncated or moving results | high | mitigate | bind before/after equality and row_count/day witnesses checked by seal_capture; refusal returns a checkpoint, never a hand-repair | closed |
| T-155-30 | Information disclosure | 155-CENSUS.md, SUMMARY | high | mitigate | the renderer emits labels, ratios and dates only; record-profile scan gates it; capture path never tracked; `.mt5-parity/` gitignored and check-ignore asserted | closed |
| T-155-31 | Elevation of privilege | executor attempting PROD | high | mitigate | Task 1 is orchestrator-only; executor halts on reaching it; executors have no MCP and are forbidden the CLI and Keychain | closed |
| T-155-32 | Information disclosure | the three records | high | mitigate | records are concatenations of renderer output (labels, buckets, 3 s.f. ratios, dates); record-profile scan over all four records; no hand edits | closed |
| T-155-33 | Spoofing | dress-rehearsal verdict read as parity | high | mitigate | DRESS REHEARSAL header line and final_green False from plan 07; the record header names the synthetic binding | closed |
| T-155-34 | Tampering | sealed capture between plans | medium | mitigate | every consumer re-verifies sha256 sidecars (load_capture, the vitest real mode) and refuses on mismatch | closed |
| T-155-SC | Tampering | npm/pip/cargo installs | high | accept | no package is installed or added by this plan (RESEARCH Package Legitimacy Audit: none) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Evidence per threat (file:line) is in the 2026-11-14 auditor verdict; every mitigate threat was verified at HEAD 8d18fe478.*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-155-01 | T-155-26 | The scanner cannot tell a four-digit amount from a count; the primary control is that no renderer has an amount column (155-08-PLAN threat model) | plan-time disposition | 2026-11-14 |
| AR-155-02 | T-155-SC | No package is installed or added by any plan; confirmed no dependency-file diff across the phase | plan-time disposition | 2026-11-14 |

Note: T-155-28 and T-155-31 (the PROD marker reading and executor non-contact during the plan-10 capture) are orchestrator-attested and cannot be re-measured from code; the code-side controls are verified.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-14 | 32 | 32 | 0 | gsd-security-auditor (ASVS 1, block_on high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed

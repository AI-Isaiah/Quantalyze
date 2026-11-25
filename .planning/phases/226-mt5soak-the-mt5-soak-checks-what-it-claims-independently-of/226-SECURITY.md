---
phase: "226"
slug: "mt5soak-the-mt5-soak-checks-what-it-claims-independently-of"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-24"
---

# Phase 226 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| MT5 broker → soak | the soak reads account_info and the raw deal history from a live MT5 terminal | broker text, account currency, deal money and times (private account sizes) |
| production derive → soak | the soak calls the production combiner and fold only to obtain the values it judges | published returns and folded per-day P&L (the thing under test) |
| soak → evidence log | the soak writes a JSON evidence record and an exit code | verdict, counts, named mismatches (no secrets, no raw broker text) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-226-01 | Information disclosure | `reconcile_parity` unit_unresolved return | medium | mitigate | only the exception class name and a validated currency code are recorded; `test_an_unresolved_account_currency_is_inconclusive` | closed |
| T-226-02 | Tampering | unit resolution fallback | medium | mitigate | no USD fallback; blank/malformed/unsupported currency is `unit_unresolved`, `parity_ok None`, exit 1 | closed |
| T-226-03 | Information disclosure | new record keys (`account_unit`, `unit_error`, `unit_code`) | low | mitigate | key names avoid sanitizer deny substrings; short values | closed |
| T-226-04 | Tampering | `_walk_money`, `_walk_epoch`, `_walk_deal_ledger` | medium | mitigate | bool, non-finite, non-numeric or unknown values raise `ValueError` (8 raise sites); nothing coerced | closed |
| T-226-05 | Information disclosure | walk error messages | low | mitigate | static messages naming the field only; `test_the_walk_rejects_bad_fields_naming_the_field_only` | closed |
| T-226-06 | Spoofing | the oracle itself (agreement by construction) | high | mitigate | AST check `test_the_walk_imports_no_production_helper`, extended in review (WR-02) to fail on any import inside a `_walk_*` def | closed |
| T-226-07 | Tampering | `_walk_instant_ms`, `_walk_day_timing` | medium | mitigate | an untrusted instant degrades the day to untimed; `test_the_walk_degrades_an_untrusted_flow_day_to_untimed` | closed |
| T-226-08 | Spoofing | timed-day set | high | mitigate | soak-owned timed set, AST-checked; fold disagreements are named kinds | closed |
| T-226-09 | Spoofing | timed-day verdict | high | mitigate | soak-owned cohort walk compared exactly (`timed_return_off_cohort_walk`); `test_a_small_nudge_on_a_timed_day_reddens_the_gate` | closed |
| T-226-10 | Repudiation | timed-day mismatch records | low | mitigate | every failure is a named kind with expected and actual; NaN written as None | closed |
| T-226-11 | Repudiation | `_reconcile_published_returns` verdict (green on too little evidence) | high | mitigate | `_MIN_CHECKED_SHARE` gates `ok`; review rounds closed the share's holes (CR-01, CR-03, CR-04, WR-05: flow-only, zero-P&L and indeterminate days certify nothing; CR-02: missing published days are named) | closed |
| T-226-12 | Spoofing | tiny-base NaN explanation | medium | mitigate | `_walk_tiny_base_days` soak-owned, AST-checked, constants drift-pinned; `test_the_walk_tiny_base_constants_match_production` | closed |
| T-226-SC | Tampering | npm/pip/cargo installs | high | mitigate | no dependency file changed on the branch (`origin/main...HEAD` diff of requirements, pyproject and package files is empty); stdlib only | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

No accepted risks.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-24 | 13 | 13 | 0 | phase agent (ASVS L1 grep-depth, register authored at plan time) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed

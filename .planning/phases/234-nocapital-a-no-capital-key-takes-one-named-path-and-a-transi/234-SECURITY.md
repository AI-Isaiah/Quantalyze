---
phase: "234"
slug: "nocapital-a-no-capital-key-takes-one-named-path-and-a-transi"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-25"
---

# Phase 234 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| stored key_inputs rows -> allocator compose | worker-written JSONB, read strictly by every `read_*` helper | writer basis, terminals, `tiny_base_days` (financial, internal) |
| live balance read -> stored realized terminal (MT5) | the terminal copies the live read, so it is not independent evidence | account balance (financial) |
| compose payload -> stored equity_curve / refusal row | the new counts-only field is persisted; the TS reader never reads `inputs` | closed tokens and integer counts |
| worker logs and Sentry events -> outside the process | warnings and one warning event per catch-all handler | exception class name, counts, job id |
| job handler -> dispatcher | an escaped exception decides FAILED/unknown and a retry | outcome only |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-234-01 | Information disclosure | `no_capital_exit_refused` field, refusal record, warnings | medium | mitigate | written only through `no_capital_refusal_field` (closed token set, ints); logs carry counts and classes | closed |
| T-234-02 | Tampering | unknown token or bogus count in the stored payload | low | mitigate | `no_capital_refusal_field` raises on unknown token, bool, non-int, negative; message never echoes the token | closed |
| T-234-03 | Tampering | NOCAP-04 segment loop | high | mitigate | a candidate with missing segment terminals falls back (`segment_terminals_missing`), never composed unsplit; equality tests and a non-candidate control | closed |
| T-234-04 | Spoofing | counts field read as a trust signal | low | mitigate | field lives only in `payload["inputs"]`, never in `degrade_reasons`/`flags`; `is_trustworthy` untouched | closed |
| T-234-05 | Tampering | MT5 no-capital exit over a transient zero balance | high | mitigate | own-ledger proof with a two-sided band `-DUST_NAV_FLOOR <= level <= DUST_NAV_FLOOR` (review round 1); no or empty basis is no proof; band-edge arms pinned (review round 2) | closed |
| T-234-06 | Tampering | negative equity exiting under `nonpositive` | medium | mitigate | selection refuses a terminal below `-DUST_NAV_FLOOR` as `negative_terminal`; boundary pair | closed |
| T-234-07 | Repudiation | venue string case bypassing the gate | medium | mitigate | venue stripped and lower-cased before the `LEDGER_PROOF_VENUES` check; "MT5" test | closed |
| T-234-08 | Information disclosure | ledger level reaching a log or payload | low | mitigate | the level is only compared; token and count leave the loop | closed |
| T-234-09 | Denial of service | equity_curve row of a book with a faulting candidate | medium | mitigate | revert once to `no_capital_stored` and upsert; two-run and dispatch tests | closed |
| T-234-10 | Repudiation | broad `except Exception` hiding a defect | medium | mitigate | catches only with candidates in play, re-raises otherwise, never `BaseException`; one class-only Sentry warning event per handler | closed |
| T-234-11 | Information disclosure | exception text or key id in a log or Sentry event | medium | mitigate | `type(exc).__name__` and counts only; Sentry message static, tags job id and exception class only; caplog and Sentry tests | closed |
| T-234-12 | Tampering | narrowed `out_of_window_flows` count | medium | mitigate | exemption needs both after-last-return AND listed in the key's own `tiny_base_days`; other cases keep counting | closed |
| T-234-13 | Denial of service | malformed `tiny_base_days` failing the whole allocator compose | medium | accept | see accepted risk AR-234-01 | closed |
| T-234-14 | Information disclosure | reader error text echoing a stored string | low | mitigate | messages name the field only; reader test asserts the value is absent | closed |
| T-234-SC | Tampering | package installs | low | accept | see accepted risk AR-234-02 | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-234-01 | T-234-13 | Strict reader chosen in 234-CONTEXT.md (post-research, "Strict or tolerant tiny_base_days reader?", matching every key_inputs `read_*` helper). The writer `tiny_base_day_list` emits canonical days, so a malformed list is corruption and INPUT_CORRUPT names it loudly on the book. | phase 234 CONTEXT decision | 2026-11-24 |
| AR-234-02 | T-234-SC | The phase installs no package and touches no requirements, pyproject or lock file; `sentry-sdk` was already pinned and used. | phase 234 plans | 2026-11-25 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-25 | 15 | 15 | 0 | gsd-security-auditor (SECURED, ASVS 1, block_on high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-25

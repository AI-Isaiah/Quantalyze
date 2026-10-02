---
phase: "167"
slug: "credtrust-an-invalid-venue-credential-is-named-to-the-custom"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-09-22"
audited_at_sha: 3bf2f24b8d1efcd8de4ef5df7bc0af92aa30ce7e
delta_audited_at_sha: f170f7af08ee7a9231acaeeb919a0627a9da6fa3
---

# Phase 167 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| venue (MT5 / sFOX / ccxt) → analytics-service | untrusted remote text arrives as a typed exception | error text (untrusted) |
| analytics-service → `api_keys.sync_error` | the one column the browser renders verbatim | authored copy only |
| analytics-service → browser (wizard wire body) | `detail`, `code`, `recoverable` cross into rendered copy | authored constants |
| analytics-service → operator surfaces | `compute_jobs.last_error`, audit metadata, logs, Sentry | scrubbed internal text |
| repo → PROD database | `supabase/migrations/**` auto-applies to TEST then PROD on merge | DDL |
| repo → public | the repo is PUBLIC and `.planning/` is tracked | prose, identifiers |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-167-01 | Information Disclosure | `routers/exchange.py` `_validate_mt5_key_probe` sign-in raise | high | mitigate | logs the int `e.code` only; `Mt5ClientError` scrubs text at construction; `detail` is the slot-free `SIGN_IN_FAILED_DETAIL` | closed |
| T-167-02 | Information Disclosure | `SIGN_IN_FAILED_DETAIL` / `KEY_SIGN_IN_FAILED` copy | medium | mitigate | static authored copy, no interpolation; `{ venue: "mt5" }` is a lookup key only; sweep recorded as verdict + count | closed |
| T-167-03 | Tampering | `classifyKeyValidationError` substring cascade | medium | mitigate | re-measured 0 collisions across the cascade's needles; `VENUE_WIRE_CODE_TO_VERDICT` row resolves first | closed |
| T-167-04 | Spoofing | client-side inference of `KEY_SIGN_IN_FAILED` | medium | mitigate | one Python emission site; TS reaches the code only via the wire-code row and a membership check of a server body code | closed |
| T-167-05 | Information Disclosure | unwrapped permanent exceptions | high | mitigate | generic arm derives `sync_error` from the STATUS via `sync_error_copy`; raw text reaches operator surfaces only | closed |
| T-167-06 | Repudiation | retry promise vs disposition | medium | mitigate | `_must_reach_handler_unwrapped` calls `classify_exception` first in all six guarded arms; AST roster test enforces it | closed |
| T-167-07 | Denial of Service | permanent failure stops retrying | medium | accept | see Accepted Risks Log | closed |
| T-167-08 | Tampering | `PILL_STYLES` idle fallback for `sign_in_failed` | critical | mitigate | row landed with the migration; test asserts the amber trio and never the idle classes; roster walks the map keys | closed |
| T-167-09 | Denial of Service | CHECK widening drops a prior value | high | mitigate | 8 prior values retyped from the PROD-derived baseline; DO block raises on a missing value with exact-token `position()` | closed |
| T-167-10 | Denial of Service | data-dependent migration refusing on TEST | high | mitigate | DO block reads only `pg_constraint` for `public.api_keys`; no `public` data read | closed |
| T-167-11 | Information Disclosure | public factsheet payload (D-04) | critical | mitigate | 0 files changed under the factsheet, factsheet-share and factsheet lib paths; 0 `sync_status` references there | closed |
| T-167-12 | Elevation of Privilege | new grants / SECDEF | low | accept | see Accepted Risks Log | closed |
| T-167-13 | Tampering | handler arm ordering | critical | mitigate | WR-05 collapsed to one arm reading `sync_status`/`error_kind` off the exception class; behavioural pin drives the real handler | closed |
| T-167-14 | Tampering | unknown-status copy fallback | high | mitigate | `SYNC_ERROR_COPY_BY_STATUS` row exists; fallback-specific test with a live-fallback control; AST + runtime roster | closed |
| T-167-15 | Information Disclosure | sign-in copy construction | high | mitigate | one construction site from `SIGN_IN_FAILED_NOTE` with a DB-derived venue; construct-from-constant gate covers the subclass family; owner helper ignores `syncError` | closed |
| T-167-16 | Repudiation | `revoked` vs `sign_in_failed` honesty levels | medium | mitigate | `revoked` only from ccxt `AuthenticationError`/`PermissionDenied`; MT5 verdicts route to the lower-confidence level | closed |
| T-167-17 | Denial of Service | worker deploys before the PROD migration | high | mitigate | plan ordering + SFH-H2: a refused write logs at ERROR and falls back to `'error'` keeping the authored copy; pinned by test | closed |
| T-167-18 | Tampering | CI skip trailer in commit messages | high | mitigate | 0 hits across all branch commit messages; SHA-bound check count is a ship-time step | closed |
| T-167-19 | Information Disclosure | CHANGELOG / diff leaking identifiers | high | mitigate | 0 gitleaks findings in the CHANGELOG diff; 0 occurrences of the ROADMAP-cited identifiers in the branch diff or messages | closed |
| T-167-20 | Tampering | planning-hygiene leak | medium | mitigate | `check:planning-hygiene` OK at HEAD; SUMMARYs record verdicts and counts only | closed |
| T-167-21 | Denial of Service | version-gate | medium | mitigate | release commit touches exactly CHANGELOG/VERSION/package.json; VERSION byte-equal to package.json, no trailing newline | closed |
| T-167-SC | Tampering | supply chain | high | mitigate | only the version line of package.json changed; lockfile and Python requirement files unchanged | closed |
| T-167-06-01 | Information Disclosure | manager key card (`ApiKeyManager`) | medium | mitigate | the pill mounts only under `isUntrustedKeySyncStatus`; both reachable arms render authored helpers; the `syncError`-rendering arm is unreachable from this mount; leak case pinned | closed |
| T-167-06-02 | Information Disclosure | public factsheet (D-04) | high | mitigate | 0 factsheet paths changed; the only mount is the owner- and role-gated edit page | closed |
| T-167-06-03 | Tampering | untrusted/trusted partition | medium | mitigate | one predicate drives mount and withhold; healthy control covers the full trusted partition + null | closed |
| T-167-06-04 | Denial of Service (UI dead-lock) | sync panel + remedy controls | medium | mitigate | attempt-scoped marker (`endAttempt` is the only clearer); withhold only a terminal success; bounded terminal re-read; key-scoped disables | closed |
| T-167-06-05 | Repudiation | a success shown beside a failed sign-in | low | mitigate | R2 withhold + `retireWithheldSuccess` on Update password / Delete / Add Key; ordered key-list reads; residuals routed to Phase 167.2 | closed |
| T-167-06-06 | Information Disclosure | planning artifacts | low | mitigate | planning hygiene OK; fixtures use placeholders | closed |
| T-167-06-SC | Tampering (supply chain) | dependencies | low | accept | see AR-167-03 | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

Every row was verified against the code at `audited_at_sha`, after both code-review fix rounds — not against the plans' description of it. No fix round removed or weakened a mitigation a row relies on.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-167-01 | T-167-07 | A permanent failure stops retrying rather than retrying under a false promise. Review WR-04 extended this to login-stage sign-in refusals (`error_kind = "permanent"`); D-17 records the accepted cost that a login-stage `-10005` without a modal dialog loses its backoff ladder until the next daily poll. The daily poll and the rotate-secret path still recover it; rate-limit backoff is unaffected. | orchestrator (autonomous, founder-delegated), D-17 | 2026-09-22 |
| AR-167-02 | T-167-12 | No new column, grant or SECURITY DEFINER function; `ledger_refresh_staleness` is not consumed, so there is no privilege surface to mitigate. | plan 03 | 2026-09-22 |
| AR-167-03 | T-167-06-SC | Plan 06 adds no dependency: 0 changes to package.json, the lockfile or the Python requirement files between `3bf2f24b` and the delta sha; new imports are `react` (`useRef`) and first-party modules only. | plan 06 | 2026-09-22 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-22 | 22 | 22 | 0 | gsd-security-auditor (verdict SECURED, ASVS 1, several rows at L2/L3 depth) |
| 2026-09-22 (delta, plan 06) | 7 | 7 | 0 | gsd-security-auditor (verdict OPEN_THREATS → 0 open once AR-167-03 is logged; ASVS 1, several rows at L2) |

⭐ **Delta audit for plan 06 (gap closure).** Plan 06 grew, through two review and two fix rounds, beyond a pure render (attempt-scoped sync marker, bounded re-read, exact-one-row delete with an already-gone lookup), so it was audited on its own register rather than covered by the note that stood here. Delete path confirmed: owner-scoped browser client under the `api_keys_owner` RLS policy — another owner's id and a non-existent id take the SAME "gone" branch, so there is no existence oracle.
- **UF-1 (fixed after the audit):** two delete-error arms rendered a raw PostgREST message on the page (one new in fix round 2; one pre-existing but shown more often after round 1). Both now render the authored `DELETE_FAILED_COPY` and log the raw text to the console only; a parametrized case pins it, each arm neuter-proven RED.
- **UF-2 (informational):** the `.gitleaks.toml` entry added in `6c71b573` is rule-scoped (`generic-api-key`), `condition = "AND"`, one test file, one anchored capture — measured both directions when added.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-22

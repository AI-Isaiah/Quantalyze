---
phase: "207"
slug: "retryprop-every-error-page-s-try-again-button-works"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-14"
---

# Phase 207 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| server render to client error boundary | A Server Component throw reaches the client boundary. Only `error.digest` may render; `error.message` carries the raw server string (ASVS V7). This phase renames a prop next to that rendering and must not change it (D-03). | thrown error object (message is server-internal, digest is a hash) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-207-01 | Information Disclosure | the nine edited boundaries | low | mitigate | Diff limited to three identifier sites plus contract comments per boundary (verified against base `7a229d27f`); the colocated "NEVER renders error.message" and digest arms are untouched and pass (`npx vitest run src/app --project jsdom`: 469 files passed). | closed |
| T-207-02 | Denial of Service | every error page's Try again | medium | mitigate | All ten boundaries call `retry()`; `src/__tests__/error-boundaries-retry.test.tsx` mounts each in Next's real `ErrorBoundary` and asserts `router.refresh` fires (13 passed). RED proven twice by byte-backup neuter (compare boundary by the executor, allocations boundary by the verifier). | closed |
| T-207-03 | Tampering | test imports of Next-internal module paths | low | accept | A Next upgrade that moves them fails the test at import, loudly. | closed |
| T-207-SC | Tampering | npm installs | low | accept | No package added or upgraded; `package.json` and the lockfile untouched. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-207-01 | T-207-03 | Importing Next internals is the only way to prove the props come from Next itself (SC-2); breakage is loud at import. | plan-time register (207-01-PLAN) | 2026-11-14 |
| AR-207-02 | T-207-SC | No dependency change in this phase. | plan-time register (207-01-PLAN) | 2026-11-14 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-14 | 4 | 4 | 0 | secure-phase (L1 short-circuit: register authored at plan time, threats_open 0, ASVS 1) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-14

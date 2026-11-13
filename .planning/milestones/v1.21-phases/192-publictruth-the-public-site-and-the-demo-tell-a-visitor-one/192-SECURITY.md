---
phase: "192"
slug: "publictruth-the-public-site-and-the-demo-tell-a-visitor-one"
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-07"
---

# Phase 192 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| anonymous visitor → public marketing pages | Home, /security, /for-quants, Terms and the security packet are served to signed-out visitors | Public copy about how the system behaves (must be true of the code) |
| anonymous visitor → proxy `PUBLIC_ROUTES` | Which paths a signed-out request may reach | Route access; /demo and /api/demo were removed from the list (D-11) |
| executor → PROD database (MCP) | Read-only measurements for 192-EVIDENCE.md | Counts and booleans only; no writes |
| tracked text → public repo | Evidence, plans, TODOS | Must carry no PROD id, email, company or home-directory path |

---

## Threat Register

40 threats (T-192-01 … T-192-39 plus the shared T-192-SC row). All are CLOSED. The full per-id evidence (file:line, test name) is in the gsd-security-auditor verdict of 2026-11-07, summarized here.

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-192-01 | Information disclosure | 192-EVIDENCE.md | high | mitigate | Counts and booleans only; 0 UUIDs, emails or home paths | closed |
| T-192-02 | Tampering | PROD DB via MCP | high | mitigate | Marker query first, single read-only SELECTs, no write path in the diff | closed |
| T-192-03 | Repudiation | EditorialHero | medium | mitigate | Component deleted in 192-13 (N/A by D-11 retirement) | closed |
| T-192-04 | Repudiation | home, /for-quants, Terms copy | high | mitigate | One shared constant per fact in `status-surface-copy.ts`, literal pins, public-truth census | closed |
| T-192-05 | Spoofing / Info disclosure | home key form | medium | mitigate | No form, input or textarea on the home page; pinned by copy and census tests | closed |
| T-192-06 | Information disclosure | /api/verify-strategy (public, no caller) | low | accept | Booked `[192-ORPHANED-LANDING-VERIFY]` | closed |
| T-192-07 | Repudiation | /security, packet HTML and PDF | high | mitigate | Packet/page parity test; PDF text checked | closed |
| T-192-08 | Tampering | TLS/HSTS config | medium | mitigate | HSTS and the global header block are untouched | closed |
| T-192-09 … T-192-11 | Info disclosure / EoP | /demo reads and labels | medium–high | mitigate | /demo page, readers and persona module deleted (N/A by D-11); raw-id census guards remain | closed |
| T-192-12 … T-192-14 | Tampering / Info disclosure | plan 06 PROD repair | high–medium | mitigate | Plan 06 superseded; no PROD write was made (EVIDENCE `D-08 repair decision`) | closed |
| T-192-15 … T-192-17 | Info disclosure / DoS / Repudiation | /api/demo/match, registries | medium–low | mitigate | Route deleted; signed-out probe matches control; registries and CI lists moved | closed |
| T-192-18 … T-192-21 | Repudiation / Tampering | demo e2e lanes, baselines, sweeps | high–medium | mitigate | Plan 08 superseded; specs, PNGs and bake plumbing deleted in 192-14; every workflow spec path resolves | closed |
| T-192-22 … T-192-24 | Repudiation / Info disclosure / EoP | census, TODOS, half-retired demo | high–medium | mitigate | Comment-stripping whole-text census with real self-test; retired-dir and route checks | closed |
| T-192-25 … T-192-27 | EoP / Tampering / Info disclosure | proxy, next.config headers, probe evidence | high–low | mitigate | `PUBLIC_ROUTES` rows pinned in `proxy.test.ts`; SEC-004 green | closed |
| T-192-28, T-192-29 | EoP / Info disclosure | AllocatorMatchQueue | medium–low | mitigate | Read-only guard below md intact; admin route keeps `assertSameOrigin` and `isAdminUser` | closed |
| T-192-30, T-192-31 | Repudiation / DoS | display-sign census, deleted components | medium | mitigate | Census rows moved; no importer of a deleted module; tsc clean | closed |
| T-192-32, T-192-33 | Repudiation / Tampering | e2e lane, ci.yml run step | medium | mitigate | H-1024 pin; `PW_EXIT` handling intact; actionlint (structural) clean | closed |
| T-192-34 | Elevation of privilege | /api/demo in `PUBLIC_ROUTES` | high | mitigate | Removed and pinned | closed |
| T-192-35, T-192-36 | Info disclosure / Repudiation | nightly canary, apt census | medium–low | mitigate | Canary jobs deleted; `EXPECTED_APT_REACHING_STEPS` 18 → 17 | closed |
| T-192-37 | Information disclosure | EVIDENCE probe id | medium | mitigate | Persona id not recorded | closed |
| T-192-38 | Elevation of privilege | eslint SEAM-01 off-block | medium | mitigate | Exclusions and pins moved together | closed |
| T-192-39 | DoS | analytics cold start | low | accept | Daily warm-analytics cron kept | closed |
| T-192-SC | Tampering | npm/pip/cargo installs | low | accept | No dependency file in the diff | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-192-01 | T-192-06 | `/api/verify-strategy` stays public with no caller; removing it is out of this phase's scope. It is booked as `[192-ORPHANED-LANDING-VERIFY]` in TODOS.md | plan register (plan 03) | 2026-11-07 |
| AR-192-02 | T-192-39 | With the demo-page warmer deleted, the analytics service may cold-start more often; the daily `warm-analytics` cron stays | plan register (plan 17) | 2026-11-07 |
| AR-192-03 | T-192-SC | No package was installed by this phase | plan registers (all plans) | 2026-11-07 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-07 | 40 | 40 | 0 | gsd-security-auditor (ASVS L1, block_on high), at b59f1d11c |

Caveats recorded by the auditor:
- T-192-02 was verified from the recorded evidence and from the absence of any write path in the diff. The auditor had no PROD access.
- The TLS, HSTS and signed-out factsheet facts rest on the 2026-11-06 measurements in 192-EVIDENCE.md and were not re-measured.
- actionlint was run with shellcheck and pyflakes disabled.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed

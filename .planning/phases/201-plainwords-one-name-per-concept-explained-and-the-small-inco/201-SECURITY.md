---
phase: "201"
slug: "plainwords-one-name-per-concept-explained-and-the-small-inco"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-11"
---

# Phase 201 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| DB read → display-name resolver | Service-role and user-scoped reads feed `displayStrategyName`, which prints a strategy's real name only when the viewer could see it in discovery (`isDiscoveryVisible`) | Strategy names of unpublished strategies (confidential until published) |
| Browse API → client (compare "Add strategy") | `/api/strategies/browse` emits resolved names; `user_id` never leaves the server | Strategy names, codenames |
| Manager identity | `redactedOrgName` stays institutional-tier only (untouched by this phase) | Manager / firm identity |
| Public pages / wizard → external link | Egress-IP status link and contact links open in a new tab | Navigation only (no user text in hrefs) |
| Copy census tooling | `scripts/copy-census/run.ts` reads source, prints repo-relative locations | Source text only |

---

## Threat Register

60 registered threat ids (T-201-01..T-201-48, plus T-201-49..T-201-60 from gap-closure plans 35-40) plus the per-plan `T-201-SC` row, authored in the 34 plans' `<threat_model>` blocks. Full per-threat evidence (file:line, tests) is in the auditor verdict recorded in the audit trail below; the summary:

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-201-02, -10, -31, -33 | Information disclosure | Name resolver chain (browse route, My allocation, bridge embeds, tearsheet, v2 factsheet, OG card, admin, adapters) | high | mitigate | Required `viewer` fact; `isDiscoveryVisible` fails closed; published-only / owner-only reads; `redactedName`; pin test on every `visible: true` site and admin `status` embeds (`strategy-display.test.ts`) | closed |
| T-201-04 | Information disclosure | Manager identity | high | mitigate | `redactedOrgName` unchanged (`queries.ts`) | closed |
| T-201-03 | Information disclosure | Name linked to codename on the browse wire | medium | accept | Founder D-09 / D-17 | closed (accepted) |
| T-201-08, -30, -34, -45, -46, -48 | Repudiation / Tampering | Copy census gate | medium | mitigate | Planted RED arms, count-pinned closed-reason exceptions, stale rule, one former-name row | closed |
| T-201-11 | Spoofing | Name read as manager identity | medium | mitigate | "Pseudonymous manager" panel; attestation gate untouched | closed |
| T-201-14 | Repudiation | Tearsheet custody sentence | medium | mitigate | API-monitored clause only for `api_verified` | closed |
| T-201-27, -40 | DoS / Information disclosure | API error strings | medium | mitigate | Machine `code`s byte-identical; static sentences on 429/504/500 arms | closed |
| T-201-32 | Repudiation | Test pins weakened to pass | medium | mitigate | Plan 24 classification against pre-phase base: 0 regressions | closed |
| T-201-42 | Spoofing | Egress address on a public page | medium | mitigate | Static none-yet statement, tests fail on a dotted-quad | closed |
| T-201-47 | DoS (a11y) | Tablist with tooltips | medium | mitigate | Function-child Tooltip keeps `aria-describedby` on the tab | closed |
| T-201-01, -05..-07, -09, -12, -13, -16..-23, -25, -26, -29, -35..-39, -41, -43, -44 | various | copy, dates, links, labels | low | mitigate | See auditor evidence | closed |
| T-201-15, -24, -28, T-201-SC | Information disclosure / Tampering | Fallback name, PendingIntros, error bodies, npm installs | low | accept | Documented below | closed (accepted) |
| T-201-49..-59 | Tampering (display integrity) | Gap closure (plans 35-40): printed dates go through `formatDay`/`formatDayTime`, machine values stay ISO; census exception set and new rule C forms | low | mitigate | Print-position wrap only, pinned rendered-text tests with negative ISO assertions; one rule C exception (`StrategyHeader`), count pinned at 36 | closed |
| T-201-60 | Tampering (gate blind spot) | Copy census rule C | low | accept | Blind spots stated in `scan.ts` header (incl. GC2-02 display props outside `USER_ATTRS`); R3-01 sites of those shapes carry rendered-text pins | closed (accepted) |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-201-01 | T-201-03 | The browse route keeps emitting `codename` beside the real name for a discovery-visible strategy (no API change); the name is already public on anonymous `/browse` | Founder ("Real name everywhere", 2026-11-10; D-09 / D-17) | 2026-11-11 |
| AR-201-02 | T-201-15 | The allocation fallback name is the fixed string "My allocation" | Plan register (orchestrator default) | 2026-11-11 |
| AR-201-03 | T-201-24 | PendingIntros names strategies only from an owner-filtered read | Plan register | 2026-11-11 |
| AR-201-04 | T-201-28 | API error statuses and bodies unchanged apart from the sentence text | Plan register | 2026-11-11 |
| AR-201-05 | T-201-SC | No dependency changes in the phase (empty diff on package.json, lockfiles, requirements) | Plan register | 2026-11-11 |
| AR-201-06 | T-201-10 (note) | The factsheet share-token lane prints an unpublished strategy's name, as it did before this phase; recorded in code, docblock and a pinned test | Founder D-17 (keep what the lane printed before) | 2026-11-11 |
| AR-201-07 | T-201-60 | Copy census rule C does not read a date printed through a neutral name, a call, a display prop outside `USER_ATTRS`, or a string literal outside JSX text; no live site of the display-prop shape at audit head; affected R3-01 sites have rendered-text pins | Plan register; review GC2-02 option (b) | 2026-11-11 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-11 | 49 | 49 | 0 | gsd-security-auditor (Sonnet), HEAD e5fa44e87, verdict SECURED |
| 2026-11-11 | 12 (T-201-49..60) | 12 | 0 | gsd-security-auditor (Sonnet), HEAD f9d80353f, diff base 5655154af, verdict SECURED |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-11

---
phase: "198"
slug: "mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs"
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-09"
---

# Phase 198 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| SSR payload -> client render | Book figures come from the server payload; the client formats, never fetches or computes book data | figures (integrity) |
| analytics-service literal -> TS mirror | `CASH_SYMBOLS` mirrors the Python `STABLECOINS`; a parity test is the link | closed set (integrity) |
| server reads -> SSR payload -> browser | only the owner's key ids cross; account identity stays server-side | key ids (confidentiality) |
| URL query (`tab`, `add`) -> page state | attacker-controllable, linkable from outside (Phase 196) | UI selection only |
| browser -> `/api/portfolio-strategies/allocation` | same-origin POST; route checks origin, user, ownership, own-capital mark (unchanged by this phase) | allocation write (money) |
| browser -> `/api/allocator/scenario/commit` | same-origin POST with Idempotency-Key; route checks auth, CSRF, rate limit, key format, body match (unchanged) | allocation write (money) |
| page -> manager wizard | the allocator header must never mount the manager wizard | role surface |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Status | Evidence |
|-----------|----------|-----------|----------|-------------|--------|----------|
| T-198-01 | Tampering | GlancePanel / Scenario live strip (figure gate) | high | mitigate | CLOSED | `book-figures.ts` gates Sharpe via `gateAnnualized`; `GlancePanel.scenario-parity.test.tsx` |
| T-198-02 | Tampering | neutered file left in tree | medium | mitigate | CLOSED | every neuter byte-restored and `cmp`-checked (SUMMARY `gc-198-*-neuter` lines) |
| T-198-03 | Tampering | `CASH_SYMBOLS` vs Python `STABLECOINS` | medium | mitigate | CLOSED | `closed-sets.cash-symbols.test.ts` member-for-member parity |
| T-198-04 | Information disclosure | `keyDataGaps` payload | high | mitigate | CLOSED | owner filter `own.has` in `key-data-gaps.ts`; result carries only `apiKeyIds`; foreign-id test |
| T-198-05 | Tampering | reference day | medium | mitigate | CLOSED | server UTC day passed from `queries.ts`; lib has no Date access |
| T-198-06 | Denial of service | per-key last-day scan | low | accept | CLOSED | in-memory O(keys) scan, no new query |
| T-198-07 | Tampering | `parseTab` / alias rewrite | low | mitigate | CLOSED | closed `LEGACY_TAB_ALIASES` map, `Object.hasOwn`, `invalid_tab_fallback` |
| T-198-08 | Spoofing / Tampering | forged `?add=` id | medium | mitigate | CLOSED | `resolveDeepLink` requires `isUuid` and a row in the allocator-gated list |
| T-198-09 | Tampering (duplicate money record) | double submit / retry on commit route | high | mitigate | CLOSED | key and exact body minted together, same body re-sent on Retry, in-flight guard, body-mismatch 422 -> INDETERMINATE (review R2-01) |
| T-198-10 | Tampering | `percent_allocated` | medium | mitigate | CLOSED | refusal on null/non-positive equity, `allKeysStale`, amount above equity |
| T-198-11 | Information disclosure | picker rows | medium | mitigate | CLOSED | rows rendered as `/api/strategies/browse` returns them, no client-side joins |
| T-198-12 | Tampering | Overview Risk section | medium | mitigate | CLOSED | single `RiskTabPanel` mount under `gate === "ready"` |
| T-198-13 | Tampering | exposure strip and net series | medium | mitigate | CLOSED | one `isCashHolding` rule feeds snapshot, series and table |
| T-198-14 | Tampering / Spoofing | external `?add=` link | medium | mitigate | CLOSED | same validation as T-198-08; `invalid_add_param` breadcrumb |
| T-198-15 | Repudiation / Tampering | replay on reload or shared URL | medium | mitigate | CLOSED | `add` stripped via `history.replaceState` on open; spy test |
| T-198-16 | Elevation of privilege | header button | low | mitigate | CLOSED | no wizard import/mount in `AllocationsTabs.tsx`; sentinel test |
| T-198-17 | Information disclosure | key labels in message | medium | mitigate | CLOSED | labels only via `apiKeyLabelById(apiKeys)` (owner list) |
| T-198-18 | Repudiation | message wording scope | low | mitigate | CLOSED | wording pinned in `MissingDataMessage.test.tsx` (review R2-03, R3-01) |
| T-198-19 | Tampering | reason-to-line mapping on two surfaces | low | mitigate | CLOSED | one class table; parity test re-pointed at the message |
| T-198-20 | Tampering | dust hiding / Positions header | medium | mitigate | CLOSED | rows hidden by id set, totals over all rows; unpriced/untrusted exempt |
| T-198-21 | Tampering | holding ref in `renderOutcome` | medium | mitigate | CLOSED | flag object handed to `BannerSubRowContent`, ref built by `buildHoldingRef` |
| T-198-22 | Tampering | flag silently lost | medium | mitigate | CLOSED | `mapFlagsToRows(flaggedHoldings, renderedIds)`; flagged-rows tests |
| T-198-23 | Tampering | holdings labels | low | mitigate | CLOSED | shared `isCashHolding` in `HoldingsTable.tsx`; pinned test |
| T-198-SC | Tampering | npm installs | low | accept | CLOSED | no package or lockfile change |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-198-01 | T-198-06 | in-memory scan over data already loaded; no new query or input surface | plan-time disposition | 2026-11-09 |
| AR-198-02 | T-198-SC | lockfile unchanged, `npm ci` only | plan-time disposition | 2026-11-09 |

Non-blocking residuals (recorded in 198-REVIEW.md, not threats): a `?add=` deep link to an own strategy not marked own capital reaches step 2 and is refused by the route's 409 (carry note for Phase 196); Retry checks against live Book equity while sending the stored body, so a lower equity refuses client-side and nothing false is sent.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-09 | 24 | 24 | 0 | gsd-security-auditor (ASVS 1, block_on high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: secured` set in frontmatter

**Approval:** verified 2026-11-09

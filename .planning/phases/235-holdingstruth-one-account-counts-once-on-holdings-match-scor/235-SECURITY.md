---
phase: "235"
slug: "holdingstruth-one-account-counts-once-on-holdings-match-scor"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
block_on: high
register_authored_at_plan_time: true
audit_depth: L1 (grep)
created: "2026-11-26"
---

# Phase 235 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (a `<threat_model>` block in each of the six PLANs). All six
> SUMMARY `## Threat Flags` sections read "None"; no unregistered threat surfaced.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| owner-RLS `api_keys` read -> identity mapping | The identity read decides which keys share an exchange account; an incomplete read used to double-count silently | Owner key ids, venue account identity (server side only) |
| server dollar figure -> persisted commit audit (`size_at_decision_usd`) | A wrong server size is stored; the route must refuse to size rather than store a double count | Dollar size |
| service-written `allocator_equity_derived` marker -> matcher AUM | The marker decides which rows count in a request-time score | Marker day per key |
| service role -> tenant rows | The matcher reads with the service role, so `.eq("allocator_id", ...)` / `.eq("user_id", ...)` IS the tenant boundary | Owner holdings and keys |
| server read -> Sentry | A capture leaves the tenant's data plane; it must carry no key ids or account identifiers | `userId`, supabase message |
| server payload -> browser | The flag rides the owner's own SSR payload; the browser renders a server-built boolean and adds no client clock | Boolean flag, owner key id groups |
| server identity (venue_account_id, login, server) -> SSR payload | Account identity stays on the server; only owner key ids cross into the browser | Owner key ids only |
| owner key ids in the payload -> printed labels | The browser maps owner ids to owner labels only; a raw id must never print | Owner key labels |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation (L1 evidence, branch `gsd/phase-235-holdingstruth`) | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-235-01 | Tampering | `keyAccountOf`, `strictAccountOf` (integrity of a dollar figure) | medium | mitigate | `HoldingsIdentityError` class at `src/lib/latest-holdings-per-key.ts:98`; `keyAccountOf` throws on `!identity.has(keyId)` (`:144-148`); `strictAccountOf` throws on an absent key (`:166-170`). Both dollar callers use it: `src/lib/queries.ts:5205` (`derivePhase07Fields`) and `src/app/api/allocator/scenario/commit/route.ts:885`, inside the existing try/catch that sets `holdingsLookupErr` (`route.ts:888`) so `_size_source` becomes `lookup_failed` (`route.ts:1106`) and no server size is persisted. `fetchHoldings` calls `keyAccountOf` (`src/lib/portfolio-exposure.ts:320`) with no catch, so the error propagates to the page's `error.tsx`. Tests: `latest-holdings-per-key.test.ts:883`, `route.holdings-identity.test.ts`. | closed |
| T-235-02 | Information disclosure | `HoldingsIdentityError` message | low | accept | Message text (`latest-holdings-per-key.ts:145-147`, `:167-169`) interpolates only the owner's own key id; no account identifier. Accepted at plan time; see Accepted Risks Log. | closed |
| T-235-03 | Tampering | `native_unpriced:<key>` markers read by the matcher | low | accept | Matcher only reads them (`analytics-service/routers/match.py` Step 1b, `read_native_unpriced_days` at `analytics-service/services/allocator_positions.py:1933`); no write added by this phase. Accepted at plan time; see Accepted Risks Log. | closed |
| T-235-04 | Information disclosure | the widened marker read (every owner key) | low | mitigate | Ids passed come from `key_rows` (`match.py:826-837`, `.eq("user_id", allocator_id)` at `:833`) via `sorted(str(k["id"]) for k in key_rows)`; the reader filters `.eq("allocator_id", allocator_id)` (`allocator_positions.py:1964`). Unchanged by round 1 (`4e4e7ad5f`). | closed |
| T-235-05 | Denial of service | a failed marker read | low | accept | Kept as before: `logger.exception(...)` and rows counted by their own days (`match.py` Step 1b `except`). Round 1 additionally sets `unpriced_check_failed` and persists a book-level `holding_flags` entry (`unpriced_check_failed_entry()`, appended in `_score_one_allocator`); the entry carries `holding_ref: None` and no id, so it discloses nothing. Accepted at plan time; see Accepted Risks Log. | closed |
| T-235-06 | Information disclosure | the HOLD-04 Sentry capture | medium | mitigate | `src/lib/queries.ts` capture block: `extra: { userId, supabase_err: phase07HoldingsRes.markerReadError }`, tags `op`/`reason`/`area` only, no key id. `captureToSentry` runs `scrubCaptureInput`/`scrubRecord` on message, tags and extra (`src/lib/sentry-capture.ts:102`, `:212-214`). Test `queries.my-allocation.test.ts:7499` ("S4: the capture's extra holds no key id"). | closed |
| T-235-07 | Denial of service (observability) | capture volume from the Overview's 30 s poll | low | mitigate | `shouldCaptureDerivedRowRejection(userId, "holdings_marker_read_failed")` gates the capture (`queries.ts`, `DERIVED_ROW_CAPTURE_WINDOW_MS = 6 h`, `:4355`); the union type was widened with the new token. | closed |
| T-235-08 | Repudiation | a failed check that leaves no trace | low | mitigate | On every failed load: `console.error("[queries.getMyAllocationDashboard] native-unpriced marker read failed ...")`, the throttled Sentry capture, and the payload flag `holdingsUnpricedCheckFailed` set at both payload literals (`queries.ts`, `holdingsUnpricedCheckFailed,` in both spreads). | closed |
| T-235-09 | Repudiation | the two note mounts (a degraded figure shown without its disclosure) | medium | mitigate | `AllocationDashboardV2.tsx` renders `<p role="status" data-testid="dashboard-holdings-unpriced-check-note">` on `props.holdingsUnpricedCheckFailed === true && holdingsSummary.length > 0`; `HoldingsTabPanel.tsx` renders `positions-holdings-unpriced-check-note` on the same condition. Both are derived from props on each render: no `useState`, no dismiss control. Tests `AllocationDashboardV2.unpriced-check.test.tsx`, `HoldingsTabPanel.unpriced-check.test.tsx`. | closed |
| T-235-10 | Information disclosure | the note copy | low | accept | `allocation.holdings-unpriced-check-failed` in `src/lib/degrade-warnings.ts` is a static `text: () => [...]` naming no account, key or day. Accepted at plan time; see Accepted Risks Log. | closed |
| T-235-11 | Information disclosure | `sharedAccountFailingGroups` payload field | medium | mitigate | `sharedAccountFailingGroups` (`allocations/lib/key-data-gaps.ts`, new function at the file tail) filters `group.filter((id) => own.has(id))`, drops groups under two ids and never copies `accountId`; producer `deriveSharedAccountFailingGroupsField` returns `string[][]` from the shared private `keyDataGapsInput` builder (`queries.ts`). Tests `key-data-gaps.test.ts:472` (G-own), `queries.test.ts:2520` and `:2599` (G-noacct, no account id in the field). | closed |
| T-235-12 | Information disclosure | `missingDataLines` undated line | medium | mitigate | `MissingDataMessage.tsx`: labels resolve only via `apiKeyLabelById(apiKeys)`; `labels.some((l) => l === undefined)` sets `everyGroupNamed = false` and `continue`s before any line is pushed, so a raw id never prints and the book fallback stays. Round 1 (`4e4e7ad5f`) tightened this (an undated-only group also keeps the fallback via `anyUndated`); the mitigation did not regress. Test `MissingDataMessage.test.tsx:702` (M4). | closed |
| T-235-13 | Repudiation | a failing key left unnamed (the HOLD-05 defect) | medium | mitigate | Coverage rule in `MissingDataMessage.tsx`: `if (everyGroupNamed && !anyUndated) causesPrinted.add("shared_account_failing") else causesPrinted.delete(...)`, so the shared-account fallback is suppressed only when every attributed group is named by a printed dated gap. A new `allocation.key-gap.shared-account-failing-undated` registry line names the keys of an undated group. `AllocationDashboardV2.tsx` passes `sharedFailingGroups: sharedAccountFailingGroups` into `missingDataLines`. | closed |
| T-235-SC | Tampering | npm/pip/cargo installs | high | accept | `git diff --name-only <merge-base>..HEAD` over the branch lists no `package.json`, lockfile, `requirements*`, `pyproject`, `Cargo`, `uv.*` or Dockerfile change. Only files under `src/`, `analytics-service/` (routers and tests only) and `.planning/` changed. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` (high) count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

Each risk below was accepted in the owning PLAN's `<threat_model>` at plan time. No risk was added at audit time.

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-235-01 | T-235-02 | The `HoldingsIdentityError` message names only the owner's own key id (already in the owner's payload) and reaches server logs and the generic `error.tsx`; no account identifier, never another tenant's data (235-01-PLAN) | plan-time register | 2026-11-26 |
| AR-235-02 | T-235-03 | Markers are service-written with owner SELECT only; the phase reads them and adds no new reader input (235-02-PLAN) | plan-time register | 2026-11-26 |
| AR-235-03 | T-235-05 | A failed marker read is logged at ERROR and rows count by their own days, as before, with nothing persisted from the marker itself; round 1 additionally flags the persisted batch (235-02-PLAN, CONTEXT bullet 3) | plan-time register | 2026-11-26 |
| AR-235-04 | T-235-10 | The note sentence is static registry text naming no account, key or day (235-04-PLAN) | plan-time register | 2026-11-26 |
| AR-235-05 | T-235-SC | No package is installed or changed by any plan (RESEARCH "Package Legitimacy Audit": none); re-measured at audit | plan-time register | 2026-11-26 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-26 | 14 | 14 | 0 | gsd-secure-phase (orchestrator-side L1 grep audit, ASVS 1, block_on high) |

Note: 14 distinct threats: T-235-01 to T-235-13 plus T-235-SC, which each of the six PLANs repeats and which is counted once.
Round 1 review changes (`4e4e7ad5f`: book-level `holding_flags` entry in `analytics-service/routers/match.py`, `MissingDataMessage.tsx` WR-01) were re-checked against T-235-04, -05, -11, -12, -13; no mitigation regressed.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-26

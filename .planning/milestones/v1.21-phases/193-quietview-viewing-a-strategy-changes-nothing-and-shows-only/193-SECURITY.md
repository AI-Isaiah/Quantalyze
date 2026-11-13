---
phase: "193"
slug: "quietview-viewing-a-strategy-changes-nothing-and-shows-only"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-07"
---

# Phase 193 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| orchestrator to PROD database | read-only SQL through the Supabase MCP, one statement per call, marker first | aggregate counts only |
| PROD result to tracked count file | public repo | scope and action names, counts, dates, one sha, one UTC minute |
| URL / browser storage to factsheet view state | `?range=` and the `factsheet-v2:` blob are user-controlled | view range (no longer read), comparator and toggles |
| note editor to `PATCH /api/notes` | a blur can write a `user_notes` row and an audit event | private note text |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-193-01 | Information disclosure | `193-D08-COUNT.md` in a public repo | high | mitigate | aggregates only, no uuid or home path, dates truncated to the day | closed |
| T-193-02 | Tampering | PROD database | critical | mitigate | marker first and alone; SELECT only; no `supabase/` path changed. Verified from the count file's text only, not from the MCP call log | closed |
| T-193-03 | Tampering | chart wheel handlers (range state) | medium | mitigate | `isZoomWheel` (`wheel-zoom.ts`) gates the React `onWheel` and the native listener in `TimeSeriesChart` and `HistogramChart` | closed |
| T-193-04 | Denial of service | page scrolling over a chart | low | mitigate | the native listener cancels only a Ctrl/Cmd wheel | closed |
| T-193-05 | Denial of service | browser page zoom over a chart | low | accept | UI-SPEC I-1 | closed |
| T-193-06 | Tampering / Spoofing | FactsheetProvider hydration (`?range=`) | medium | mitigate | the range is never read from the URL; the legacy param is deleted | closed |
| T-193-07 | Tampering | stored `factsheet-v2:` blob | medium | mitigate | one-shot purge on hydration; `encode` drops `range` | closed |
| T-193-08 | Tampering | prototype-poison keys in the blob | low | mitigate | `stripPoisonKeys` in `decode` | closed |
| T-193-09 | Spoofing (misrepresentation) | PeerPercentilePanel api arm, allocator section | high | mitigate | out of the DOM; the D-07 guard renders the real body | closed |
| T-193-10 | Information disclosure | `peerPercentile` / `allocatorPortfolios` in the payload | low | accept | booked `[193-DEMO-PAYLOAD-PRODUCERS]` | closed |
| T-193-11 | Repudiation | footer disclaimer and Fees copy | low | mitigate | false sentences removed | closed |
| T-193-12 | Repudiation (misread figures) | RangeEyebrow | medium | mitigate | label and reset from the same `RangeScope` | closed |
| T-193-13 | Spoofing (misrepresentation) | MetricsColumn peer gate | medium | mitigate | api arm removed | closed |
| T-193-14 | Spoofing (misrepresentation) | dead allocator component | low | mitigate | deleted | closed |
| T-193-15 | Information disclosure | invented fields in the client payload | low | transfer | `[193-DEMO-PAYLOAD-PRODUCERS]` with trigger and closing condition | closed |
| T-193-16 | Repudiation / Tampering | four note blur handlers | medium | mitigate | no autofocus; `shouldSaveNoteOnBlur`; review fixes: in-flight baseline, error-state retry, `loadError` fence on HoldingNoteRow and BridgeOutcomeNoteSection | closed |
| T-193-17 | Tampering (data loss) | the dirty check swallowing a real edit | medium | mitigate | baseline advances only on `"saved"`; a failed save retries | closed |
| T-193-18 | Tampering (data loss) | HoldingDetail after a failed note load | medium | mitigate | `noteLoadError` fence first in `onNoteBlur` | closed |
| T-193-SC | Tampering | package installs | low | accept | no package manifest or lockfile changed | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-193-01 | T-193-05 | Ctrl + wheel over a chart zooms the chart, not the page. Elsewhere the page zooms as normal (UI-SPEC I-1) | plan 193-02 threat model | 2026-11-06 |
| AR-193-02 | T-193-10 | the invented fields are not secret; they are removed at the render site, and their producers are booked for removal | plan 193-04 threat model | 2026-11-06 |
| AR-193-03 | T-193-SC | no package is installed by any plan | plan threat models | 2026-11-06 |

Awareness note, outside the register: `StrategyNoteCard` gets its content from `src/app/strategy/[id]/page.tsx`, which treats a failed read as an empty note. This is booked as `[193-STRATEGY-NOTE-LOAD-ERROR]`.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-07 | 19 | 19 | 0 | gsd-security-auditor (ASVS L1, block_on high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-07

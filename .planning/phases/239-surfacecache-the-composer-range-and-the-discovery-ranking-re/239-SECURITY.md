---
phase: "239"
slug: "surfacecache-the-composer-range-and-the-discovery-ranking-re"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-24"
---

# Phase 239 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Factsheet payload to client range state | The composer and factsheet resolve a user-picked range against the payload's date axes in the browser | ISO dates and axis indices; not sensitive, never persisted |
| Discovery list shaping to the table | Stored analytics figures are shaped and ranked server-side and rendered in `StrategyTable` | Published strategy performance figures (already public on Discovery) |

No migration, API, auth, middleware or dependency change is in this phase.

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-239-01 | Information disclosure | `factsheet-context.tsx` range state | low | mitigate | The range lives in React state only; the persisted blob carries `cmp`, `cb`, `reg`; the codec drops `range` and hydration deletes a legacy one. Pinned by the provider test "Case B" and `basis-context.test.tsx` GUARD-04 | closed |
| T-239-02 | Tampering / DoS | `range-dates.ts` resolver | low | mitigate | Strict off-axis and inverted-range guards return the full range; an empty axis returns the full range and `setXRange` writes nothing; O(log n) lookups. Pinned in `range-dates.test.ts` | closed |
| T-239-03 | Tampering (wrong dates shown) | `ActiveBasisContext`, `basisAxisDates`, `resolveRangeScope` | medium | mitigate | The range resolves on the active basis axis, the fallback is that axis's full range, and "full" means ending at the view's last index. `basis-context.active-axis.test.tsx` pins `basisAxisDates` equal to `useBasisSeriesView` | closed |
| T-239-04 | Tampering | `subtractMonths` in `src/lib/dateday.ts` | low | mitigate | Rejects an invalid day and a non-integer or negative month count; a null boundary resolves to the full range. Pinned in `dateday.test.ts` and `range-dates.test.ts` | closed |
| T-239-05 | Tampering (wrong preset window) | `PeriodControl`, `setPresetRange` | medium | mitigate | Months come only from the literal `PERIOD_MONTHS` (3/6/12); a preset resolves from the latest day every render. Pinned in `ScenarioFactsheetChart.period-presets.test.tsx` and the provider test | closed |
| T-239-06 | Tampering (ranking integrity, CACHE-04) | Discovery list shaping and percentiles | medium | mitigate | No conversion or per-unit partition in the Discovery path; pinned by `queries.native-unit-ranking.test.ts` (one population, 83 vs 100 and 43 vs 50 discriminators) and `StrategyTable.native-unit-ranking.test.tsx` | closed |
| T-239-07 | Tampering (neuter leak) | `queries.ts`, `StrategyTable.tsx` | medium | mitigate | Neither file appears in the phase diff or log; no neuter was committed | closed |
| T-239-SC | Tampering (supply chain) | dependencies | low | accept | No `package.json` or lockfile change | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-239-01 | T-239-SC (plans 01, 02, 03) | The phase installs no package and changes no lockfile, so it adds no supply-chain surface | plan-time disposition, confirmed by gsd-security-auditor | 2026-11-24 |

*Accepted risks do not resurface in future audit runs.*

**Observation (not a register item).** `subtractMonths` returns a non-null malformed string for a month count beyond the JS Date range (e.g. `1e12`). It is unreachable: the only caller passes the literals 3, 6 or 12. Recorded only.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-24 | 8 | 8 | 0 | gsd-security-auditor (verdict SECURED, register authored at plan time) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-24

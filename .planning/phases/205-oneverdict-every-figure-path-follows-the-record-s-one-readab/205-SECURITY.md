---
phase: "205"
slug: oneverdict-every-figure-path-follows-the-record-s-one-readab
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-10"
---

# Phase 205 - Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

**Audited commit:** `8fd26b026` on `feat/205-oneverdict` (diff `240999b5f..HEAD`, `.planning` excluded), including the two review fixes `cfe54acd3` (WR-01) and `1baa4c9b0` (WR-02).
**Config:** neither `workflow.security_asvs_level` nor `workflow.security_block_on` is set in `.planning/config.json`, so the defaults apply: `asvs_level: 1`, `block_on: high`. Verification was taken to L2 depth (placement at the correct boundary) for the one high-severity threat, T-205-06.
**Evidence rule:** every `file:line` below is read from the committed blob at `8fd26b026`, not from the working tree. Tests were not re-run for this audit (no install or build); the pinning tests were read at HEAD, and the RED/restore (neuter) records are taken from the three SUMMARY files and `205-REVIEW-R2.md`, not re-measured here.
**Counting rule:** `T-205-SC` is declared under the same ID in all three plans. It is counted once, so the register has nine unique IDs (T-205-01 to T-205-08 plus T-205-SC).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| stored analytics row -> payload builder | `returns_series` / `daily_returns` dates are untrusted stored data (any string) | date strings, return values |
| payload builder -> public factsheet page | `/factsheet/<id>` is anonymous-reachable; the payload decides which figures a visitor sees, and an unhandled throw renders `error.tsx` for every visitor | the factsheet payload (figures, stress block, blends) |
| payload builder -> Sentry | the unreadable-record report carries the strategy id and the offending date only | strategy id, date strings, axis label |
| SSR payload cache -> visitor | a stale cache entry can serve an outdated payload form for the 1 h TTL | the cached payload |
| payload builder -> browser re-derive | the server-built stress block is re-derived client-side on the levered view | the figure record, stress block |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-205-01 | Tampering | `buildUsdView` / `buildFromBuildableSeries` verdict | medium | mitigate | `fetch-and-build-payload.ts:1075` passes `nativeUnreadable: nativePayload.figureRecord?.unreadable === true`; `:1168` sets `inheritedUnreadable: true` on the USD opts; `build-payload.ts:968-969` ORs it into the USD `totalRecord` (`firstBad \|\| opts?.inheritedUnreadable`). The second date scan (`recordSourceDates`, former `record_source` axis) is gone. `payload.figureRecord` is `totalRecord` (`build-payload.ts:1166`), so the hand-off reads the native build's own verdict. Pinned by the `205 D-01 parity` describe (`figure-parity-pages.test.tsx:1243`) and the `194.2 R2 WR-01` case (`:1125`). | closed |
| T-205-02 | Repudiation | Sentry `figure-record-unreadable` report | low | mitigate | Report predicate at `build-payload.ts:976`: `(firstBad \|\| endsRecord.unreadable) && opts?.reportUnreadable && !opts?.inheritedUnreadable`. It uses the build's own verdict, not `totalRecord`, and `cfe54acd3` (WR-01) added the `!inheritedUnreadable` conjunct, a strengthening beyond the plan wording: a bad first curve point reaches the USD build through `recordSeriesStart` and would have double-reported. The native build always reports (`reportUnreadable: true`), so an inherited verdict is reported exactly once. Pinned by the two-arm `it.each` asserting `reports toHaveLength(1)` (interior bad date, and bad first curve point as `record_start`) at `figure-parity-pages.test.tsx:1265-1292`. | closed |
| T-205-03 | Information disclosure | Sentry `extra` | low | accept | Accepted, see Accepted Risks Log. Verified unchanged: the diff leaves the `extra` keys (`strategyId`, `seriesStart`, `seriesEnd`, `headlineSince`, `firstBadAxis`, `firstBadDateIndex`, `firstBadDate`) as they were, and the only edit near them drops the `record_source` label with its axis. | closed |
| T-205-04 | Tampering | `deriveSeriesBundle` `stressWindows` | medium | mitigate | `build-payload.ts:664`: `args.figureRecord?.unreadable === true \|\| (dates.length > 0 && !isReadableDay(dates[0]))` selects the withheld form (`unreadable: true`). All three server bundles pass `totalRecord` (`:1010`, `:1035`, `:1060`) and the browser re-derive passes `view.figureRecord ?? null` (`basis-context.tsx:288`, used at `:400` and `:655`), so native, USD and levered views share the verdict. Pinned by the `205 D-02` describes (`StressWindowsPanel.unreadable.test.tsx:76`, `figure-parity-pages.test.tsx:1302`). | closed |
| T-205-05 | Denial of service | `computeStressWindows` throw on a non-ISO first date | low | mitigate | The `dates[0]` half of the `build-payload.ts:664` predicate stays, and it is stricter than the throw it guards: `computeStressWindows` throws only on `!ISO_DATE.test(dates[0])` (`stress-windows.ts:96-97`), and `isReadableDay` (`figure-gate.ts:91`) rejects everything that regex rejects and more (impossible calendar days, trailing text), so no unreadable first date reaches the throw when the record is `null`. `computeStressWindows` has exactly two production call sites (`build-payload.ts:666`, `scenario-factsheet-payload.ts:488`), both behind a verdict guard. | closed |
| T-205-06 | Denial of service | api arm of `buildFromBuildableSeries` -> `alignBlend` / `isoDayBefore` | high | mitigate | `build-payload.ts:1228`: `allocatorPortfolios: totalRecord.unreadable ? null : [ ... ]`. L2 placement check: `alignBlend` has one production caller, `portfolioFigures` (`build-payload.ts:1204`), which is invoked only inside the false branch of that ternary, so JavaScript's lazy ternary keeps an unreadable record out of the date math. `totalRecord` is OR'd from `firstUnreadableDate(dates, ...)` over EVERY cash date, the same `dates` array handed to `alignBlend`, so a readable `dates[0]` guarantees `Date.parse` is finite in `isoDayBefore` (`allocator.ts:112`). No guard was added inside `alignBlend` or `isoDayBefore`, so a throw on a readable record stays loud. Pinned by `it.each` over five first dates (`StressWindowsPanel.unreadable.test.tsx:150-186`, including `""`, `2023-13-01`, `2024-1-5`) and the `2024-01-1` fetch-path case (`figure-parity-pages.test.tsx:1339`), each recorded RED with the ternary neutered (`205-03-SUMMARY.md`, `gc-205-03-neuter`). | closed |
| T-205-07 | Tampering | `allocatorPortfolios` on an unreadable record | medium | mitigate | Same ternary (`build-payload.ts:1228`): blends are `null` on an unreadable record, never computed from dates that could not be read. The type already allows it (`types.ts:1146`: `AllocatorPortfolioPayload[] \| null`) and no non-test code renders the field, so null prints no false claim. Readable control keeps three blends (`StressWindowsPanel.unreadable.test.tsx`, "a readable api record keeps its three blends (control)"; `audit-c20.test.ts`, `makeReadableReturns`). | closed |
| T-205-08 | Tampering | `unstable_cache` key in `buildFactsheetPayloadCached` | medium | mitigate | `page.tsx:285` keyParts lead with `"factsheet-v2-payload-v23"`, with a dated `Bumped v22->v23 (Phase 205 ONEVERDICT, 2026-11-10)` rationale at `:284`. It is the only `factsheet-v2-payload-*` key in `src` (every other hit is a test expectation or a comment), and no API or share route reads `stressWindows`, `allocatorPortfolios` or `usdView`. Pinned by hand-typed expectations: three in `page.public-cache-key.test.tsx` (`:290`, `:360`, `:381`) and `EXPECTED_KEY_PREFIX` in `page.cache-isolation.test.tsx:156`; key-left-v22 neuter recorded RED (`205-03-SUMMARY.md`). | closed |
| T-205-SC | Tampering | npm/pip/cargo installs (declared in plans 01, 02 and 03) | low | accept | Accepted, see Accepted Risks Log. Verified by positive measurement: the phase diff changes exactly ten files, none a manifest or lockfile: `src/__tests__/figure-parity-pages.test.tsx`, `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts`, `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts`, `src/app/factsheet-share/[token]/page.cache-isolation.test.tsx`, `src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx`, `src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx`, `src/app/factsheet/[id]/v2/page.tsx`, `src/lib/factsheet/audit-c20.test.ts`, `src/lib/factsheet/build-payload.ts`, `src/lib/factsheet/fetch-and-build-payload.ts`. `git diff --stat` over `package.json`, `package-lock.json`, `analytics-service`, `supabase`, `.github`, `scripts` and `requirements.txt` is empty. | closed |

*Status: open · closed · open - below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low - only open threats at or above `block_on` (high) count toward `threats_open`*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

**Totals:** 9 unique threats, 9 closed, 0 open (blocking: 0, non-blocking: 0). 7 `mitigate` verified in code, 2 `accept` logged below, 0 `transfer`.

---

## Accepted Risks Log

No earlier SECURITY.md exists for this phase, so this audit creates the log. Acceptance is the plan-time disposition recorded in each plan's `<threat_model>`; it is attributed to that register, not to a person. Both risks are low severity and so cannot move `threats_open`.

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-205-01 | T-205-03 | The Sentry `figure-record-unreadable` report keeps its existing `extra` keys (strategy id, the series dates, the axis label, the offending date). The phase adds no field and no secret, and `record_source` leaves the axis vocabulary. `firstBadDate` is an untrusted stored string, unchanged from the base. | Plan-time register (`205-01-PLAN.md` threat_model) | 2026-11-10 |
| AR-205-02 | T-205-SC | No package is installed or added by plans 01, 02 or 03. The diff touches no manifest or lockfile (see the register row). | Plan-time register (`205-01/02/03-PLAN.md` threat_model) | 2026-11-10 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Flags

The three SUMMARY `## Threat Flags` sections each say "None". Two further items surfaced during the audit and neither blocks:

| Item | Mapped to | Status |
|------|-----------|--------|
| `1baa4c9b0` (review fix WR-02) edits `scenario-factsheet-payload.ts`, a producer no plan's threat model cites. `stressWindows: record.unreadable ? <withheld form> : computeStressWindows(...)` at `scenario-factsheet-payload.ts:486`. The Scenario record is `firstUnreadableDate(datesR)` over every date (`:414`), so a non-ISO first date is covered and no longer throws `stress-windows: dates must be ISO` in the browser. | Same class as T-205-04 (record verdict withholds the stress block) and T-205-05 (non-ISO first date must not throw). | Informational. Mitigated in code and pinned by three cases (`scenario-factsheet-payload.test.ts`, describe "the stress block follows the record verdict (205 WR-02)": readable control, interior bad date, non-ISO first date with `not.toThrow()`). No new network, auth, file or schema surface. |
| `cfe54acd3` (review fix WR-01) tightens the Sentry report predicate. | T-205-02 | Informational. Strengthening of an existing mitigation, recorded in the T-205-02 row. |

**Unregistered flags (blocking):** none.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-10 | 9 | 9 | 0 | gsd-security-auditor (ASVS L1 config, L2 depth on T-205-06) |

Notes:
- During the audit the working tree twice carried uncommitted edits to `src/lib/factsheet/build-payload.ts` (a `false` substituted into the T-205-06 ternary, then into the T-205-04 predicate) from another process running mutation probes. They are not part of `8fd26b026`; every citation above comes from the committed blob. Confirm `git status --short` is clean of source edits before this phase is committed or shipped.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-10

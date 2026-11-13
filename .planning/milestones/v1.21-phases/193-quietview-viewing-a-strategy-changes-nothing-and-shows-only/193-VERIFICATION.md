---
phase: 193-quietview-viewing-a-strategy-changes-nothing-and-shows-only
verified: 2026-11-07T06:30:00Z
status: passed
score: 4/4 must-haves verified
verified_at_sha: 88161d78a5fc391d1081714d97c92d518ba32818
drift_subjects:
  - src/app/factsheet/[id]/v2/wheel-zoom.ts
  - src/app/factsheet/[id]/v2/TimeSeriesChart.tsx
  - src/app/factsheet/[id]/v2/HistogramChart.tsx
  - src/app/factsheet/[id]/v2/factsheet-context.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/BatchDPanels.tsx
  - src/app/factsheet/[id]/v2/MandatePanels.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/components/notes/should-save-note.ts
  - src/components/notes/StrategyNoteCard.tsx
  - src/components/notes/HoldingNoteRow.tsx
  - src/components/notes/BridgeOutcomeNoteSection.tsx
  - src/app/(dashboard)/allocations/components/HoldingDetail.tsx
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Open a factsheet in a desktop browser. Scroll with a plain mouse wheel while the pointer is over the Cumulative chart, then over the Distribution of Daily Returns histogram. Then hold Ctrl (or Cmd) and turn the wheel over each."
    expected: "The plain wheel scrolls the page; the range label and every KPI value stay the same. Ctrl/Cmd + wheel zooms and the label switches to 'Selected range: ...' with a 'Reset to full history' button beside it. At 390 px the histogram hint wraps under the legend names and is not clipped."
    why_human: "jsdom cannot prove a native wheel event scrolls the page, or judge the label/button layout against DESIGN.md. The phase's own VALIDATION.md lists this as a manual-only check (UI-SPEC E3 backstop)."
---

# Phase 193: QUIETVIEW Verification Report

**Phase Goal:** Looking at a factsheet or a strategy page is passive. Scrolling over a chart never changes its date range by itself, a narrowed range is always labelled with a one-click reset and is never restored on a later visit, no developer note, placeholder or another strategy's or portfolio's demo content appears, and opening any page writes nothing on the user's behalf.
**Verified:** 2026-11-07
**Status:** passed (all automated checks pass; the browser-only wheel/visual check was resolved by 193-UAT.md, 1 of 1 passed on 2026-11-07)
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP SC, with founder overrides) | Status | Evidence |
|---|---|---|---|
| 1 | SC-1 (amended by D-01): a plain wheel over any factsheet chart leaves the range and headline figures unchanged; zoom is on Ctrl/Cmd + wheel only | VERIFIED | `wheel-zoom.ts` exports `isZoomWheel = ctrlKey \|\| metaKey`. `TimeSeriesChart.tsx` and `HistogramChart.tsx` each return early in React `onWheel` when `!isZoomWheel(e)` and call `preventDefault` in the native non-passive listener only when `isZoomWheel(ev)`, so a plain wheel is not cancelled and the page scrolls. These are the only two wheel handlers in `src/` (grep). Sr-only help text and the histogram hint now say Ctrl/Cmd + wheel. Neuter run (wheel gate forced to `true`) turned `TimeSeriesChart.window-gesture.test.tsx` "a plain wheel leaves the range alone ... Ctrl and Cmd still zoom (D-01)" RED; restored byte-for-byte. |
| 2 | SC-2: a narrowed range is labelled next to the figures it changes with a one-click reset; a later visit or reload opens the full history, including for ranges a browser saved earlier | VERIFIED | `RangeEyebrow` (`MetricsColumn.tsx`) renders the dated label ("Selected range: <start> – <end>") plus a "Reset to full history" button that calls `resetXRange()` only while `scope.kind === "selected"`; mounted at both the KPI strip (`FactsheetView.tsx:1938`) and the rail (`MetricsColumn.tsx:347`); `factsheet-v2-no-print` keeps it out of print. In `factsheet-context.tsx` the write effect no longer builds or writes `range` (URL or localStorage), `factsheetViewStateCodec.encode` drops it, and the hydration effect never applies a stored or `?range=` value; it deletes a legacy `?range` from the URL and strips or removes the legacy stored blob through the storage primitive (`removeStored`/`setStoredView`), gated on `persist`. Provider and codec tests (`factsheet-context.provider.test.tsx`, `.codec.test.ts`) pass. cmp/cb/reg/dark persistence untouched. |
| 3 | SC-3: no factsheet renders the three strings or content of another strategy/portfolio; a test goes RED if any returns | VERIFIED | `grep` over non-test `src/**/*.tsx` finds none of "Synthesized peer cohort", "Demo portfolios", "Suggested MultiMarket sleeve", "Commercial terms not yet wired", "deterministic seed", "Production: replace" (one unrelated doc comment in `AllocationDashboardV2.tsx` only). `AllocatorSection`, `DemoBadge` and the api demo-cohort arm of `PeerPercentilePanel` are deleted; `FactsheetBody` no longer mounts the allocator section and `SectionNav` has no "Allocator" anchor; the footer's "Demo cohorts and demo portfolios are flagged inline" sentence is gone; `peerPercentile`/`allocatorPortfolios` have no remaining renderer (grep). The scenario-blend peer panel stays and ranks against the real verified universe (`scenarioPeer`). `FactsheetBody.no-demo-content.test.tsx` guards it. Neuter run (Commercial terms sentence restored) turned two cases in that file RED; restored. |
| 4 | SC-4 (with D-09 "Allow clearing"): opening a strategy page, factsheet or any page carrying a note and leaving without typing writes no row; D-08 PROD count recorded before the fix; a test goes RED on today's behaviour | VERIFIED | All note surfaces that save on blur route through `shouldSaveNoteOnBlur(draft, persisted) = draft !== persisted && (draft.trim() !== "" \|\| persisted.trim() !== "")`, exactly the D-09 override predicate: `StrategyNoteCard`, `HoldingNoteRow`, `BridgeOutcomeNoteSection`, `HoldingDetail`. `autoFocus` is removed from all four (focus now moves only from an explicit Edit click). `DashboardNoteCard` (the fifth surface, not in the diff) already saves only when content differs from last-saved. Grep for `/api/notes` and `useNoteAutoSave` finds no other writer; `strategy/[id]/page.tsx` and the factsheet page do no inserts or upserts on render. `193-D08-COUNT.md` records the marker query (matched the PRODUCTION marker) then one query per call: 1 empty strategy note (2026-11-06), 1 empty holding note (2026-07-20), 1 zero-length save each in the audit trail, all read-only, rows left in place. Neuter run (predicate forced to `true`) turned 14 tests RED across `should-save-note`, `StrategyNoteCard`, `HoldingNoteRow` and `BridgeOutcomeNoteSection`; restored. Post-plan-07 fixes verified in code: the in-flight baseline (`saveState === "saving" ? pendingSaveRef.current : persisted`), the retry-after-error path (`saveState !== "error" && ...`), and the load-error fence on `HoldingNoteRow` and `BridgeOutcomeNoteSection` (only a 404 opens the empty editor; other failures show an alert with Retry and nothing saves). |

**Score:** 4/4 truths verified. No behavior-dependent truth is left presence-only: each has a named test that fails when the behaviour is neutered.

### Founder decisions and roadmap records

| Decision | Honoured in code | Recorded in CONTEXT and ROADMAP |
|---|---|---|
| D-01 Ctrl/Cmd + wheel is the explicit control | Yes, `isZoomWheel` on both charts | Yes (CONTEXT D-01; ROADMAP SC-1 "AMENDED" paragraph) |
| D-09 "Allow clearing" | Yes, predicate matches verbatim | Yes (CONTEXT D-09 override; ROADMAP "Founder override, 2026-11-07") |
| D-02 not persisted, legacy purged | Yes | CONTEXT |
| D-03 label + reset | Yes | CONTEXT |
| D-04, D-05, D-06 removals | Yes | CONTEXT |
| D-08 PROD count before fix | Yes, `193-D08-COUNT.md` | CONTEXT |

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|---|---|---|---|
| TRUST-02 | 02, 03, 05 | SATISFIED | Truths 1 and 2 |
| TRUST-03 | 04, 05, 06 | SATISFIED | Truth 3 |
| TRUST-06 | 01, 07 | SATISFIED | Truth 4 |

All three IDs appear in plan frontmatter and map to Phase 193 in REQUIREMENTS.md; no orphaned requirement IDs. (REQUIREMENTS.md still shows them as `[ ]` / Pending, which is bookkeeping for the orchestrator on phase close.)

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Phase test files (notes, no-demo-content, window-gesture, context provider/codec, window KPIs, HoldingDetail) | `npx vitest run` on those 14 files | 14 files, 186 tests passed | PASS |
| Guards can fail | Neuter wheel gate, blur predicate and the Commercial terms sentence, rerun | 14 failed, named D-01/D-07/D-09/D-10 cases RED; originals restored byte-for-byte (`git status` clean) | PASS |
| Type check | `npx tsc --noEmit` | no output | PASS |
| Lint on touched dirs | `npx eslint src/components/notes 'src/app/factsheet/[id]/v2'` | 0 errors, 1 warning (`nativeUnitReason` unused import, present at the phase base too) | PASS |
| Known out-of-scope failures | `npx vitest run src/lib/factsheet/compute.conventions.test.ts` | 2 failed (fixtures B and C); the file and `src/lib/factsheet/` are outside this phase's diff | Pre-existing, not this phase |

`next build` was not run (environment limitation stated by the caller).

### Probe Execution

Step 7c: SKIPPED (no probe scripts declared by this phase).

### Anti-Patterns Found

No TBD, FIXME or XXX markers introduced in the changed files, and no stubs: every changed component renders real data and no hardcoded-empty prop reaches output. One unused import warning (`nativeUnitReason`) pre-dates the phase.

### Data-Flow Trace (Level 4)

| Artifact | Variable | Source | Real data | Status |
|---|---|---|---|---|
| `RangeEyebrow` | `scope` | `resolveRangeScope(xRange, ...)` from live `xRange` state | Yes | FLOWING |
| Note cards | `persisted` | server-read initial content or GET response, advanced only on a reported "saved" | Yes | FLOWING |

### Known limits and informational findings (not blockers)

- **Residual server payload (booked, `[193-DEMO-PAYLOAD-PRODUCERS]`):** `buildFactsheetPayload` still computes and ships the synthesized `peerPercentile` and `allocatorPortfolios`; nothing renders them. TRUST-03 and SC-3 are about what a factsheet shows, so this does not fail them, and it is a TODOS entry with an owner and trigger. `hideAllocatorSection` stays a documented no-op prop.
- **Booked, `[193-STRATEGY-NOTE-LOAD-ERROR]`:** `strategy/[id]/page.tsx` treats a failed `user_notes` read as "no note". It needs a DB read error plus a deliberate keystroke, and sits outside the phase's no-write-on-open claim.
- **Review round 3 IN-01 (founder question open):** after a failed first save of a never-saved note, clearing and leaving sends `PATCH ""`. This follows a user keystroke and a failed save, not opening a page, so SC-4 holds; it is the unanswered question about whether that reading of the D-09 override stands.
- **Roadmap bookkeeping stale:** the ROADMAP Phase 193 section still says "5/7 plans executed" with plans 06 and 07 unchecked, although both have SUMMARYs and the code is in place; REQUIREMENTS.md still lists TRUST-02/03/06 as Pending. Update on `phase complete`.
- **Review disposition:** three rounds, 0 open MEDIUM+ at the end (`193-REVIEW-DISPOSITION.md`).

### Human Verification (resolved by 193-UAT.md, passed 2026-11-07)

#### 1. Plain wheel scrolls the page in a real browser

**Test:** Open a factsheet in a desktop browser. Scroll with a plain mouse wheel over the Cumulative chart, then over the Distribution of Daily Returns histogram. Then hold Ctrl (or Cmd) and turn the wheel over each. Check the label and button placement at desktop width and at 390 px.
**Expected:** Plain wheel scrolls the page and the range label and KPI values do not move. Ctrl/Cmd + wheel zooms; the label reads "Selected range: ..." with a "Reset to full history" button beside it; one click returns the full history. At 390 px the histogram hint wraps and is not clipped.
**Why human:** jsdom cannot prove native wheel scrolling, and the label/button layout needs a visual check against DESIGN.md. The phase's VALIDATION.md and plan 02 both list it as manual-only.

### Gaps Summary

No gaps. All four success criteria are verified in code and by tests that were shown to fail when the behaviour is neutered. The only open item is the browser-only wheel and visual check the phase itself declared manual, which was resolved by 193-UAT.md (passed 2026-11-07), so the status is `passed`.

---

_Verified: 2026-11-07_
_Verifier: Claude (gsd-verifier)_

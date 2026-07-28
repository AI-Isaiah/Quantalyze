---
phase: 133-smoothed-mtm-factsheet-toggle
verified: 2026-07-22T18:55:00Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
deferred:
  - truth: "Live options-book render (Phoenix re-onboard + Zav2 + perp-only byte-identity spot check) on production data"
    addressed_in: "Named follow-up (83-PLAN Task 10, live-verification-followup)"
    evidence: "133-01-PLAN success_criteria: 'live verification (Phoenix re-onboard + Zav2 + perp-only byte-identity spot check, 83-PLAN Task 10) is the named follow-up, blocked on re-onboarding the deleted key'"
---

# Phase 133: Smoothed-MTM Factsheet Toggle — Verification Report

**Phase Goal (SMTM-04):** The factsheet renders `smoothed_mtm` across ALL basis-dependent surfaces — SegmentedControl third option, series swap (metrics AND charts, single-key AND composite), basis eyebrow label, chart caption three-state, `suppressRelative`, leverage eligibility (no Phase-107 L=1↔L≠1 jump), peer-rank cash-basis note — honest-disabled-with-reason where marks are missing; NO surface renders smoothed numbers under a wrong basis label.
**Verified:** 2026-07-22 (branch `feat/phase-83-smoothed-mtm`, commits `6c04f609` / `44b01f9f` / `acb49ef7`)
**Status:** passed — VERDICT: ACHIEVED
**Re-verification:** No — initial verification

## Gates Run (in this verifier's own process — not trusted from SUMMARY)

| Gate | Command | Result |
| ---- | ------- | ------ |
| Factsheet vitest surface | `npx vitest run "src/app/factsheet/[id]/v2" src/lib/factsheet --no-file-parallelism` | **526 passed / 47 files, 0 failed** (matches SUMMARY claim exactly) |
| Types | `npx tsc --noEmit` | **exit 0, clean** |

## Goal Achievement — Observable Truths

| # | Truth | Status | Evidence (code + the test that reddens if the arm breaks) |
| --- | ----- | ------ | -------- |
| 1 | Three-segment SegmentedControl (Cash / MTM / Smoothed), cash default | ✓ VERIFIED | `FactsheetView.tsx:1309-1322` third item `id:"smoothed_mtm"`, `disabled: !smoothedAvailable`; `basis-context.tsx:33` union. Tests: "THREE segments render; Cash active by default, MTM disabled (options), Smoothed enabled" (asserts `aria-pressed`/`aria-disabled` per segment) + "default stays cash_settlement on a payload carrying a smoothed basis (D5)" |
| 2 | Series + scalar swap, single-key AND composite | ✓ VERIFIED | Composite: `composite-read-path.ts:319` gated `readSmoothedSeries` → `:329` threaded into buildOpts; test "smoothed present → smoothedGate available + threads smoothedSeries" + "FLAGSHIP options case: MTM gated OFF but smoothed OPEN". Single-key: `page.tsx:151-160` `shouldReadSingleKeySmoothedSeries → readSmoothedSeries → 5th arg to singleKeyBasisOpts` (code-inspected); helper-level wiring-guard "smoothed available + parsed series → threads buildOpts.smoothedSeries (5th arg)" asserts `toBe(SMOOTHED_SERIES)` identity. Overlay: `basis-context.tsx:110-119` + tests "overlays ONLY the seven mapped scalars" / "smoothed WITH bundle serves the smoothed bundle" |
| 3 | Honest-disabled with mapped reason, never cash under a smoothed label | ✓ VERIFIED | `basis-context.tsx:576-579` `smoothedDisabledReasonCopy` closed-set; `FactsheetView.tsx:1185-1186, 1321-1342` disabled + inline paragraph. Tests: "smoothed DISABLED → aria-disabled with the mapped closed-set reason copy inline"; "absent smoothed_mtm object → all seven mapped scalars render '—' (NaN, no cash fallback)"; "smoothed WITHOUT a bundle falls back to the ORIGINAL payload by reference" |
| 4 | Eyebrow label three-way (never CASH SETTLEMENT under smoothed) | ✓ VERIFIED | `FactsheetView.tsx:346` (MetricsColumn) + `:868-872` (composite KpiStrip) both emit "SMOOTHED MARK-TO-MARKET". Test: "EYEBROW: … reads SMOOTHED MARK-TO-MARKET under smoothed (three-way, not cash)" |
| 5 | Chart caption three-state honesty | ✓ VERIFIED | `FactsheetView.tsx:525-531`: smoothed+bundle → "Charts show the smoothed mark-to-market series."; smoothed+absent → honest cash-fallback copy. Both pinned by exact-copy `getByText` tests (present AND absent cases) |
| 6 | suppressRelative under smoothed absent-bundle | ✓ VERIFIED | `FactsheetView.tsx:830-831` `(basis === "smoothed_mtm" && !smoothedBundlePresent)`. Tests: absent-bundle → α cell "—"; present-bundle → α equals the SMOOTHED joint alpha (value-pinned, not just non-dash) |
| 7 | Leverage: eligibility + persisted re-pin (no L=1↔L≠1 jump) | ✓ VERIFIED | `basis-context.tsx:341-374` re-pin covers both persisted-overlay bases (`:348-350`); `:449-457` `leverageEligibleFor` smoothed clause requires bundle AND scalars. Tests: "levered smoothed re-pins the persisted Sharpe/Sortino" (asserts 1.44/1.88 persisted values at L=2), "L=0 → honest derived zeros", "eligible ⇔ BOTH present" (three-way), "WITHOUT a bundle at L=2 returns base BY REFERENCE" |
| 8 | Peer-rank cash-basis note under smoothed | ✓ VERIFIED | `BatchDPanels.tsx:132` gate `(basis === "mark_to_market" \|\| basis === "smoothed_mtm")`. Tests: note rendered under smoothed, NOT under cash (both directions) |
| 9 | Brush x-range clamp reachability (flagship: smoothed longer than cash, no MTM bundle) | ✓ VERIFIED | `factsheet-context.tsx:235` third `max()` term + `:249` dep. Test: "a SMOOTHED index past the cash length is REACHABLE (neuter the third max() term → RED)" — asserts end label S149 vs the cash-clipped S099, RED-provable |

**Score:** 9/9 truths verified

## Key Link Verification (read contract vs Phase 132 persisted truth)

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `composite-read-path.ts:154` | `strategy_analytics_series` kind | `SMOOTHED_MTM_DAILY_RETURNS_SERIES_KIND` | ✓ WIRED | Frontend constant `"smoothed_mtm_daily_returns"` (`types.ts:581`) == worker `KIND_SMOOTHED_MTM` (`basis_series.py:118`) — no blank-toggle mismatch |
| `composite-read-path.ts:306,432,528` | `metrics_json_by_basis.smoothed_mtm` | gate + overlay extraction | ✓ WIRED | Worker writes the key at `job_worker.py:5702` (single-key) and `:4185` (composite) — exact key match |
| `page.tsx:151-160` | `singleKeyBasisOpts` 5th arg | smoothed read threading | ✓ WIRED | Call site present; helper-level wiring-guard pins result-reaches-opts (same posture as the pre-existing MTM read at page.tsx:130-147, per plan-check HIGH-1 design) |
| `parseSmoothedSeriesPayload:130` | mislabel defense | wrong-basis literal → null + warn | ✓ WIRED | T-131-08: a `mark_to_market` row under the smoothed kind refuses to render; nan_dates tolerated — both test-pinned |
| `singleKeyBasisOpts:440` | {smoothed_mtm}-only edge | extended early return | ✓ WIRED | MEDIUM-2 wiring-guard fixture (NO mtm key, NO reason) survives; SILENT-1 non-options `{}` path byte-identical — both test-pinned |

## Closure Grep (run by verifier: `grep -rn 'mark_to_market' src/app/factsheet src/lib`, non-comment non-test)

32 hits, every one classified with a decided smoothed posture — the SUMMARY's audit table is accurate:
- FactsheetView `:343/:431/:525/:777/:830/:870/:1309` — all have adjacent smoothed sibling arms (`:344/:434/:529-531/:780/:831/:872/:1319`), each test-pinned.
- basis-context `:33/:110-119/:240-260/:348-350/:445-447` — union member, overlay, series-view, re-pin, eligibility smoothed arms present, test-pinned.
- factsheet-context `:228/:246` — third max() term `:235` + dep `:249`, test-pinned.
- BatchDPanels `:132` — gate includes smoothed, test-pinned.
- types/build-payload/composite-read-path declarations — smoothed sibling types/assembly/reads present (`types.ts:547,581,653`; `build-payload.ts:458-463`; `composite-read-path.ts:125-164,301-329,430-472,508-529`).
- `metrics-parity-helper.ts` — `smoothed_mtm_daily_returns` excluded exactly like `mtm_daily_returns` (directly-read sibling kind, not an RPC-panel kind) — a legitimate type-exhaustiveness maintenance, not a gate weakening.

No non-comment basis site lacks a smoothed posture. **No blocker anti-patterns** (no TBD/FIXME/XXX in phase-modified files; no stub returns; the `?? {}` empty-object fallbacks are the deliberate no-invented-data posture, test-pinned as "—" renders).

## Cash/MTM Byte-Identity (no accommodation edits)

`git diff a1d03d59..acb49ef7` over all six test files shows only TWO deleted lines, both import-statement widenings (re-added with extra named imports) — zero pre-existing test bodies modified or deleted. Byte-identity additionally pinned forward: "no smoothedSeries opt → seriesByBasis has no smoothed_mtm (byte-identical, SC-4)" and "SILENT-1 preserved … NO smoothed key → EMPTY".

## Weak-Test Audit

Read the bodies of every load-bearing new test. None are tautological: the brush test pins an exact edge label that the un-widened clamp would clip (S149 vs S099); the wiring-guard asserts identity (`toBe`) of the threaded series and documents its neuter-RED condition; the render-proof asserts persisted-fixture-derived KPI strings (+44.0%, 1.70); the caption/eyebrow/note tests assert exact user-facing copy; the leverage re-pin asserts the persisted 1.44/1.88 against a client recompute that would differ.

## Deferred Items

| # | Item | Addressed In | Evidence |
| --- | ---- | ----------- | -------- |
| 1 | Live prod verification (Phoenix re-onboard + Zav2 + perp-only byte-identity spot check) | Named follow-up (83-PLAN Task 10) | Plan success criteria explicitly scope it OUT of this phase: "blocked on re-onboarding the deleted key". All phase-scope truths are DOM-level test-verified; live check is the milestone follow-up, not a Phase-133 gap. |

## Gaps Summary

None. All 9 SMTM-04 surfaces exist in code, are wired to the Phase-132 persisted contract on both read paths, and are pinned by load-bearing tests that this verifier ran green (526/47) with tsc clean.

---

_Verified: 2026-07-22T18:55:00Z_
_Verifier: Claude (gsd-verifier)_

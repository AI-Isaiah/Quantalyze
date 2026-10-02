# Phase 102: Options MTM Factsheet + Composite + Regression - Research

**Researched:** 2026-07-12
**Domain:** Next.js RSC factsheet read-side wiring (frontend) + Python composite stitch gate (analytics) + byte-identity regression
**Confidence:** HIGH (all four load-bearing questions answered with file:line evidence from the current tree)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Read source:** the factsheet toggle reads `metrics_json_by_basis.mark_to_market` (single-key) — the object Phase 101 persists. Do NOT recompute MTM in the frontend.
- **F-4 gate (LOCKED — carry-forward from Phase 101 red team):** the toggle MUST keep gating the MTM read on `computation_status` (only render MTM for a DONE row) — a failed/insufficient row must never present a live-looking MTM object. Phase 101 made the by-basis write authoritative (stale objects are NULL'd), so the reader is safe, but the computation_status gate is still required.
- **Honest reason mapping (carry-forward):** map `mtm_summary_coverage_incomplete`, `mtm_series_uncomputable`, `mtm_second_pass_timeout` honestly. The frontend union (`types.ts:497`) is OPEN with a graceful `default` (`mtmDisabledReasonCopy`, `basis-context.tsx:100`); Phase 102 gives each an accurate human string.
- **Stale copy to rewrite:** `unsmoothed_options_book` (`stitch_composite.py MTM_REASON_OPTIONS`) still references the DROPPED Phase-83 smoothing concept — rewrite its human copy to the honest current meaning (or retire if unreachable — research CONFIRMS it IS still reachable, see Q3).
- **SC-4:** every existing non-options / cash_settlement factsheet (single-key AND published composite) stays byte-identical — golden/parity guard.
- **No-invented-data / honest-empty / marked-gaps:** LOCKED. Composite per-member coverage gaps stay MARKED, never zero-filled.
- **Owner-scoped RLS, secretless reads, worker-only decryption:** LOCKED.

### Claude's Discretion (DELEGATED to Fable — planner / UI-SPEC)
- Toggle-enablement UX for a single-key options strategy (available vs disabled-with-reason); empty/disabled visual + copy; DESIGN.md conformance.
- Human copy for each MTM reason (`mtm_summary_coverage_incomplete`, `mtm_series_uncomputable`, `mtm_second_pass_timeout`, rewritten `unsmoothed_options_book`) — honest, non-fabricating, coverage-mask voice.
- Whether to add a distinct `mtm_anchor_race` reason (Phase 101 deferred known-limitation) as part of the reason-copy pass, or leave it self-healing — Fable's call.
- Any read-path/composite-compose detail the research surfaces.

### Deferred Ideas (OUT OF SCOPE)
- **MTM-03 LIVE Zavara MTM corroboration** — a POST-DEPLOY operational gate (OQ-3). No `mark_to_market` data exists until the ship-time re-derive backfill runs on Railway. NOT an in-phase code step; treat as a ship-time human_verification gate. Do NOT claim live MTM attestation at phase close.
- Any NEW options-MTM valuation method or smoothing (permanently dropped).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MTM-01 | Enable the single-key factsheet `cash_settlement ↔ mark_to_market` SegmentedControl by reading the persisted `metrics_json_by_basis.mark_to_market`, behind a `computation_status`-DONE gate | Q1 (wiring seam), Q2 (gate flip + SC-4 keystone). The read machinery (`overlayBasisScalars`, `useBasisMetrics`) is basis-agnostic and ALREADY works; only the buildOpts threading + the render-gate condition are missing. |
| MTM-02 | Confirm/extend the composite compose; per-member gaps stay marked, never zero-filled | Q3 — VERDICT below. Perp-only native composites already toggle (verify-only). Options-member composites are gated OFF with the stale reason — a SCOPE DECISION for the planner. |
| MTM-03 | (a) IN-PHASE static byte-identity regression (cash pins); (b) POST-DEPLOY live Zavara corroboration (ship-time gate, NOT in-phase) | Q4 — golden/parity suite locations + additive-case pattern. |
</phase_requirements>

## Summary

Phase 101 already computes and persists the single-key options `mark_to_market` metrics object into `strategy_analytics.metrics_json_by_basis.mark_to_market`, plus a surviving `data_quality_flags.mtm_gated_reason` on honest degrade. **The frontend READ machinery to display it is already basis-agnostic and complete** — `overlayBasisScalars` (`basis-metrics.ts:53`) and `useBasisMetrics` (`basis-context.tsx:74`) map the persisted by-basis object regardless of single-key vs composite. What is missing is purely **wiring**: (1) the single-key arm of `page.tsx` never threads `metricsByBasis`/`mtmGate` into `buildOpts` (only `dataQuality`), and (2) the toggle render is gated `composite &&` at `FactsheetView.tsx:1170`, so a single-key options strategy never sees the control at all.

**MTM-01 is a small, surgical wiring task**, plus one genuinely new requirement: the F-4 `computation_status` gate is **NOT currently read anywhere in the factsheet page read path** (`page.tsx` does not even `select` the column — only the PDF routes read it). MTM-01 must add `computation_status` to the strategy_analytics select and gate the single-key `mtmGate.available` on a DONE status.

**Q3 is the load-bearing plan-size decision.** The composite MTM gate `mark_to_market_available` (`stitch_composite.py:290-306`) UNCONDITIONALLY returns `(False, "unsmoothed_options_book")` for **any** options-member composite. So a perp-only native composite already toggles MTM correctly (MTM-02 = verify-only + test for those), but an **options**-member composite is honestly disabled with the STALE `unsmoothed_options_book` reason. Making options composites toggle MTM would mean flipping that gate to run the already-existing per-member MTM second pass (`_reconstruct_all(PNL_BASIS_MARK_TO_MARKET)`, `job_worker.py:4177`) — a behavior change that carries the single-key coverage/anchor risks at composite scope. See the explicit verdict below.

**Primary recommendation:** Plan MTM-01 as a 2-seam wiring task (thread single-key by-basis + flip the render gate, both behind a new `computation_status`-DONE gate); plan MTM-02 as **verify-only + reason-copy rewrite** (leave options-composite MTM honestly gated OFF, rewrite the stale `unsmoothed_options_book` copy, add a compose test asserting honest disabled-with-reason + marked-never-zeroed per-member coverage); plan MTM-03 as static byte-identity extension of the existing golden/parity suites, with the live Zavara check as a ship-time gate.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Persist single-key MTM metrics object | API/Backend (analytics worker) | Database | DONE in Phase 101; read-only input here |
| Read persisted by-basis object into payload | Frontend Server (RSC `page.tsx` + `build-payload.ts`) | Database | Server-truth read under RLS/admin client; NEVER recompute client-side |
| `computation_status`-DONE gate (F-4) | Frontend Server (RSC read path) | — | Must gate `mtmGate.available` before it reaches the client |
| Cash↔MTM toggle display + basis relabel | Browser/Client (`FactsheetView` ControlBar + `useBasisMetrics`) | — | Ephemeral UI state only (no storage — GUARD-04) |
| Disabled-with-reason copy | Browser/Client (`mtmDisabledReasonCopy`) | — | Server truth (`mtm_gated_reason`) → mapped copy; no client ledger predicate |
| Composite MTM admissibility gate | API/Backend (`mark_to_market_available`) | — | Single owner of the admissibility vocabulary; `has_option_activity` gate lives here |
| Byte-identity regression | Both (vitest frontend + pytest analytics) | — | Cash pins on both sides of the RSC boundary |

## Standard Stack

No new packages. This phase is entirely code wiring + tests inside the existing Next.js + React + Python/pandas stack. **No Package Legitimacy Audit required** (zero installs — mirrors Phase 101's `tech-stack.added: []`).

### Existing stack touched
| Layer | Module | Role in this phase |
|-------|--------|--------------------|
| RSC read path | `src/app/factsheet/[id]/v2/page.tsx` | Add `computation_status` to select; thread single-key `metricsByBasis`/`mtmGate` into `buildOpts` behind the DONE gate |
| Payload builder (React-free) | `src/lib/factsheet/build-payload.ts` | Already forwards `opts.metricsByBasis`/`opts.mtmGate` (:346-347); SC-4 keystone overlay at :243 |
| Basis map (React-free) | `src/lib/factsheet/basis-metrics.ts` | `overlayBasisScalars` (:53), `hasBasisHeadline` (:88) — already single-key-safe |
| Client toggle | `src/app/factsheet/[id]/v2/FactsheetView.tsx` | Flip the `composite &&` render gate (:1170) to admit single-key MTM |
| Client basis hook + copy | `src/app/factsheet/[id]/v2/basis-context.tsx` | `useBasisMetrics` (:74) already reads single-key MTM; `mtmDisabledReasonCopy` (:100) needs the new honest reasons |
| Composite gate (Python) | `analytics-service/services/stitch_composite.py` | `mark_to_market_available` (:290); reason constants (:101-128) |

## Package Legitimacy Audit

Not applicable — this phase installs no external packages (verified: zero-install, mirrors Phase 101). No registry verification needed.

## Architecture Patterns

### Data flow (MTM-01 single-key toggle)

```
strategy_analytics row (Supabase)
  ├─ metrics_json_by_basis.mark_to_market   (Phase 101 persisted; SEVEN headline scalars OR absent)
  ├─ data_quality_flags.mtm_gated_reason    (Phase 101 surviving reason on degrade)
  └─ computation_status                      (NOT currently selected — MTM-01 must ADD)
        │
        ▼  page.tsx fetchAndBuildPayload  (admin client, RLS-gated upstream)
  single-key ELSE arm (page.tsx:111-120)
        │   TODAY: buildOpts = { dataQuality: singleKeyDataQuality(dqf) }   ← metricsByBasis/mtmGate NEVER passed
        │   MTM-01: also pass metricsByBasis + mtmGate{available: DONE && hasBasisHeadline(mtm), reason: mtm_gated_reason}
        ▼  buildFactsheetPayload → build-payload.ts
  strategyMetrics = overlayBasisScalars(computed, opts.metricsByBasis?.cash_settlement)  (:243)
        │   single-key carries NO cash_settlement key ⇒ overlay returns base UNCHANGED ⇒ CASH BYTE-IDENTICAL (SC-4 keystone)
        │   payload.metricsByBasis = opts.metricsByBasis ; payload.mtmGate = opts.mtmGate   (:346-347)
        ▼  FactsheetView ControlBar  (client)
  render gate  composite && <SegmentedControl>   (:1170)   ← MTM-01 must widen to admit single-key MTM
  useBasisMetrics(payload)  → basis==='mark_to_market' ? overlayBasisScalars(strategyMetrics, metricsByBasis.mark_to_market ?? {}) : strategyMetrics
        ▼
  KpiStrip relabels the seven mapped scalars under the active basis (absent ⇒ "—", never cash fallback)
```

### Pattern: strict, absent-safe by-basis overlay (already in place)
**What:** `overlayBasisScalars(base, serverScalars)` rewrites ONLY the seven `BASIS_KPI_MAP` scalars from the persisted basis; returns `base` unchanged when `serverScalars` is null/undefined.
**Why it matters for SC-4:** because a single-key by-basis object carries ONLY `mark_to_market` (Phase 101 decision — never `cash_settlement`), `opts.metricsByBasis?.cash_settlement` is `undefined` at `build-payload.ts:243`, so the cash overlay is a no-op and cash stays byte-identical. This is the SC-4 keystone. See Q2.

### Anti-patterns to avoid
- **Deriving compositeness from `apiKeyId === null`** — FORBIDDEN. `FactsheetPayload` has no `apiKeyId`. Compositeness is `data_quality_flags.composite === true` (server truth). The MTM render gate must NOT reintroduce an api-key heuristic.
- **Client-recomputing MTM** — FORBIDDEN. Read the persisted object only.
- **Rendering `mtmGate.available` without the computation_status gate** — violates F-4; a failed/insufficient row could present a live-looking MTM object.
- **Zero-filling composite per-member coverage gaps** — FORBIDDEN. Gaps stay MARKED (`coverage_mask` / `per_key` with `n_days:0`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Basis scalar mapping (server↔TS key names) | A second key map in the client | `BASIS_KPI_MAP` + `overlayBasisScalars` (`basis-metrics.ts:18,53`) | Single source of truth; already strict + absent-safe |
| "Is this basis displayable?" predicate | Ad-hoc all-seven-finite check | `hasBasisHeadline` (`basis-metrics.ts:88`) | Encodes the exact structural-vs-degenerate distinction both server gates trust |
| MTM reason → copy mapping | Inline switch in the view | `mtmDisabledReasonCopy` (`basis-context.tsx:100`) | Open-union + default; one place to add the new honest strings |
| Composite MTM admissibility | New gate in the view or read path | `mark_to_market_available` (`stitch_composite.py:290`) | The single admissibility-vocabulary owner; reasons must not fork |

## Load-Bearing Questions — Answers (file:line evidence)

### Q1 — WHERE does the single-key factsheet read metrics, and where is the by-basis read gated on `composite`?

**The read seam is already basis-agnostic.** `useBasisMetrics` (`src/app/factsheet/[id]/v2/basis-context.tsx:74-94`) reads `payload.metricsByBasis?.mark_to_market ?? {}` for the MTM basis — it does NOT check compositeness. The problem is upstream: **the single-key arm never populates `payload.metricsByBasis`/`payload.mtmGate`.**

- `page.tsx:90` — `const isComposite = dqf?.composite === true;`
- `page.tsx:92-110` — composite arm calls `readCompositeFactsheet(...)` which returns `buildOpts` carrying `metricsByBasis` + `mtmGate` (`composite-read-path.ts:154,167`).
- `page.tsx:111-120` — **the single-key ELSE arm sets ONLY** `buildOpts = { ...(buildOpts ?? {}), dataQuality: singleKeyDataQuality(dqf) }`. `metricsByBasis` and `mtmGate` are **never passed** → `payload.metricsByBasis`/`payload.mtmGate` are `undefined` for single-key.
- `build-payload.ts:346-347` — `metricsByBasis: opts?.metricsByBasis, mtmGate: opts?.mtmGate` (forwards whatever the arm passed; absent for single-key).

**Exact MTM-01 wiring point:** `page.tsx:119` (the single-key `else` branch) must additionally thread the persisted single-key by-basis object and the gate:
- read `analytics.metrics_json_by_basis` (already selected at `page.tsx:44`) as `metricsByBasis`,
- build `mtmGate.available = <computation_status DONE> && hasBasisHeadline(metricsByBasis?.mark_to_market)`,
- build `mtmGate.reason = dqf.mtm_gated_reason` (string).

**F-4 gate — genuinely new:** `computation_status` is **NOT read anywhere in the factsheet page path.** The `select` at `page.tsx:44` fetches `daily_returns, returns_series, computed_at, data_quality_flags, metrics_json_by_basis` — **no `computation_status`.** (Verified: the only `computation_status` reads in `src/` are the PDF routes `api/factsheet/[id]/pdf/route.ts:214,231` and `tearsheet.pdf/route.ts:183,199`, and the finalize-wizard.) MTM-01 MUST add `computation_status` to the select and gate `mtmGate.available` on `computation_status IN ('complete','complete_with_warnings')` (the exact literals the PDF routes use at `pdf/route.ts:231-232`). Phase 101-02 confirms a degraded-MTM row still reports `computation_status == "complete"` (the reason is a non-promoting availability annotation), so the gate must key off `hasBasisHeadline(mark_to_market)` for availability AND `computation_status` DONE as the F-4 safety — both, not either.

### Q2 — WHERE is the SegmentedControl disabled for single-key, and what flips it ENABLED?

**Today the SegmentedControl does not render at all for single-key.** The entire control is wrapped in `composite &&`:
- `FactsheetView.tsx:1067` — `const composite = payload.dataQuality?.composite === true;`
- `FactsheetView.tsx:1068` — `const mtmAvailable = payload.mtmGate?.available === true;`
- `FactsheetView.tsx:1069` — `const mtmReason = mtmDisabledReasonCopy(payload.mtmGate?.reason);`
- `FactsheetView.tsx:1170` — `{composite && ( <div…><SegmentedControl … options={[cash, {id:'mark_to_market', disabled:!mtmAvailable, disabledReason:mtmReason}]}/> …)}`

**The exact condition to flip:** widen the `:1170` render gate from `composite` to `composite || <single-key options has an mtmGate>`. Since MTM-01 only populates `payload.mtmGate` for single-key options when the by-basis object is present OR an honest reason exists, the cleanest server-truth predicate is `payload.mtmGate != null` (i.e. "this strategy participates in the MTM basis story"). The `disabled:!mtmAvailable` + `disabledReason:mtmReason` plumbing already renders honest disabled-with-reason with **zero changes** — it reads straight from `payload.mtmGate`.

**Reason plumbing end-to-end (already wired, needs only the new copy strings):**
`data_quality_flags.mtm_gated_reason` → (composite: `composite-read-path.ts:169`; single-key: MTM-01 new thread) → `payload.mtmGate.reason` → `FactsheetView.tsx:1069` `mtmDisabledReasonCopy(...)` → `SegmentedControl.disabledReason` (`SegmentedControl.tsx:10,50` renders it as the `title` tooltip on the `aria-disabled` button) + the inline `<p>` at `FactsheetView.tsx:1186-1192`.

**SC-4 keystone confirmation (byte-identity for cash + non-options):** `build-payload.ts:243` — `strategyMetrics = overlayBasisScalars(computedMetrics, opts?.metricsByBasis?.cash_settlement)`. Phase 101's single-key by-basis object carries **only** `mark_to_market` (SUMMARY 101-01 decision line 29), so `opts.metricsByBasis?.cash_settlement` is `undefined` → `overlayBasisScalars` returns `base` unchanged (`basis-metrics.ts:57`) → **single-key cash headline is byte-identical.** Adding a `mark_to_market`-only single-key read therefore CANNOT perturb cash. The cash overlay only activates when a `cash_settlement` key is present (composite only). CONFIRMED.

### Q3 — Is MTM-02 (composite compose) a BUILD task or a VERIFY-ONLY task?

**VERDICT: split. Verify-only for perp-only native composites; a SCOPE DECISION (default: verify-only + copy) for options-member composites. It is NOT a straightforward build.** [ASSUMED for the recommended disposition — needs planner/user confirmation because it touches the "no new valuation math" boundary.]

Evidence:
- The composite already computes a dual-basis object and runs a per-member MTM second pass when admitted: `job_worker.py:4171-4324`. `mtm_ok, mtm_reason = mark_to_market_available(member_signals)` (:4174); if `mtm_ok` it runs `_reconstruct_all(PNL_BASIS_MARK_TO_MARKET)` (:4177) and writes `metrics_json_by_basis["mark_to_market"]` (:4322-4324). The composite read-path already gates the toggle: `mtmAvailable = hasBasisHeadline(metricsByBasis.mark_to_market)` (`composite-read-path.ts:143`) and threads `mtmGate` (:167). **So a perp-only native composite ALREADY toggles MTM end-to-end.** For those, MTM-02 = verify-only + a compose test.
- **BUT `mark_to_market_available` (`stitch_composite.py:290-306`) UNCONDITIONALLY returns `(False, "unsmoothed_options_book")` for ANY member with `has_option_activity`** (`:302-303`, checked FIRST). So an **options-member composite never computes a `mark_to_market` object** — the key is omitted (`job_worker.py:4323` guard `if mtm_metrics_json is not None`) and `mtm_gated_reason = "unsmoothed_options_book"` is carried.
- The reason-constant docstring is explicit that this was DEFERRED: `stitch_composite.py:107-109` — `MTM_REASON_SUMMARY_COVERAGE` is "NOT consumed by `mark_to_market_available` (composite gate semantics are Phase 102)."

**Consequence the planner must weigh:** after MTM-01 ships, a **single-key** Zavara options book shows an MTM curve, but a **composite containing** that same options book would disable MTM with `unsmoothed_options_book`. Two dispositions:
- **Option A (recommended, in-scope): keep the options-composite gate OFF, rewrite the stale copy.** MTM-02 = (1) rewrite `unsmoothed_options_book` human copy to the honest current meaning ("mark-to-market not yet available for options-containing composites"), (2) verify perp-only composites still toggle, (3) compose test asserting an options-member composite renders honest disabled-with-reason AND its per-member coverage stays MARKED (`coverage_mask` / `per_key` `n_days:0`, `job_worker.py:4045-4055`), never zero-filled. **No valuation change. Matches the locked "NO new valuation math."**
- **Option B (parity BUILD, likely OUT): flip the gate to run the existing per-member MTM pass for options composites.** The `_reconstruct_all(MTM)` machinery already exists (`job_worker.py:4177`), so this is arguably "removing a gate" not "new valuation math" — but it inherits the single-key coverage/same-anchor risks (deferred-items.md) at composite scope, and the divergent-degraded-member TOCTOU guard (`job_worker.py:4193-4226`) plus the summary-coverage/uncomputable/timeout reasons would all need composite-level handling. This is a real feature, not a confirm — **do not fold it into a "confirm/extend" task without user sign-off.**

**`unsmoothed_options_book` retirement question — CONFIRMED still reachable.** It is the live return value of `mark_to_market_available` at `stitch_composite.py:303` for every options-member composite and is stamped as `mtm_gated_reason`. It must be **rewritten, not retired.** The current frontend copy (`basis-context.tsx:102-103`) still says "un-smoothed options book (Phase-83 daily-mark smoothing not applied)" — the stale framing CONTEXT flags.

### Q4 — The golden/parity byte-identity suites (cash pins) for MTM-03

**Frontend (vitest):**
- `src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx` — the FS-03 basis-toggle DOM suite. Its "GREEN-by-construction (assertions 4-5)" already assert **a single-key payload emits NONE of the Phase-90 composite strings** via `renderToStaticMarkup` (byte-identity scope). This is where the options-MTM single-key case is added: a single-key fixture with `mtmGate` present should now render the toggle; a single-key fixture WITHOUT `mtmGate` must stay byte-identical (no toggle). Pattern: add fixtures, never edit the existing cash/no-toggle assertions.
- `src/lib/factsheet/basis-metrics.test.ts` — unit pins for `overlayBasisScalars` / `hasBasisHeadline` (absent-safe, strict, degenerate-null). Add a single-key `mark_to_market`-only overlay case asserting cash is untouched.
- `src/app/factsheet/[id]/v2/basis-context.test.tsx` — `useBasisMetrics` + `mtmDisabledReasonCopy` unit pins. Add the new reason-copy strings here.
- Companion guards to keep green: `FactsheetBody.guard04-no-bleed.test.tsx` (no storage write on toggle).

**Analytics (pytest cash pins — SC-4):**
- `analytics-service/tests/test_golden_parity.py`, `test_metrics_parity.py`, `test_metrics_minigolden.py`, `test_composite_headline_parity.py` — the cross-cut cash goldens.
- `analytics-service/tests/test_zavara_acceptance.py`, `test_deribit_acceptance.py`, `test_deribit_ground_truth.py`, `test_allocated_capital.py`, `test_deribit_txn.py` — the strategy-specific cash pins Phase 101 already proved byte-identical ("268 passed, zero edits", SUMMARY 101-02).

**Pattern to add an options-MTM case without perturbing cash goldens:** Phase 101 established it (SUMMARY 101-01 Task 3) — add MTM assertions in a **separate** test module (`tests/test_mtm_single_key.py`) that assert `mark_to_market` presence/reason, and **never** assert MTM==cash numeric equality (the MTM curve re-dates premium off the trade day BY DESIGN; SUMMARY 101-02 "Pitfall-2 guard"). Cash pins stay untouched because the cash pass is a fully independent `combine_native_ledger(pnl_basis="cash_settlement")` call. For MTM-02's compose case, add a composite-MTM test asserting the honest gate outcome + marked coverage, not a cash edit.

## Also-Surface Findings

### Reason-copy surface + the open union
- `mtmDisabledReasonCopy` (`basis-context.tsx:100-109`) currently enumerates only `unsmoothed_options_book` and `mtm_basis_unavailable_for_venue`, with a generic `default` ("Mark-to-market unavailable for this composite."). The three Phase-101 single-key reasons (`mtm_summary_coverage_incomplete`, `mtm_series_uncomputable`, `mtm_second_pass_timeout`) currently fall through to the generic default — they RENDER, but with composite-flavored copy that's wrong for a single-key strategy. Phase 102 adds an honest `case` for each.
- The TS union `types.ts:497` is `"unsmoothed_options_book" | "mtm_basis_unavailable_for_venue" | string` — **open** (the `| string` tail). Because it is open + the switch has a `default`, **no place mechanically requires enumerating the new reasons to compile or render.** The only place a reason must be enumerated to render *correct* (not generic) copy is the `mtmDisabledReasonCopy` switch. Adding the reasons to the union literal is optional polish (better editor autocomplete), not a correctness requirement. The default is honest-generic, so an un-enumerated reason degrades gracefully.
- The generic default copy says "…for this composite" — for single-key options this is slightly wrong; Fable's copy pass should make the default (or the new cases) basis-agnostic.

### Taxonomy-parity guard entanglement — CONFIRMED CLEAR
- The pre-existing failing test `test_audit.py::...test_action_literal_matches_ts_union` guards the audit **`action`** literal taxonomy (`bridge.score_candidates`, `simulator.run`, `reconcile.compare`, …) — an entirely separate vocabulary. Verified: it references `action`/`AuditAction`, never any `mtm_` reason.
- Verified there is **NO** TS↔Python parity/drift guard that enumerates the MTM reasons (grep over `analytics-service/tests/` + `src/` for `mtm_gated_reason`/`unsmoothed_options_book`/`MTM_REASON` intersected with `parity|audit|taxonomy|union|drift` returns nothing). The only cross-language coupling is the 101-02 test that imports `MTM_REASON_SUMMARY_COVERAGE` from `services.stitch_composite` to prevent a silent constant-rename decouple — a value import, not a taxonomy union guard.
- **Therefore: Phase 102 reason-copy work (adding cases, rewriting `unsmoothed_options_book`, optionally adding `mtm_anchor_race`) does NOT touch or unblock the audit taxonomy guard.** The two are independent. Adding a new reason constant does not require any TS union edit to pass CI.

### `mtm_anchor_race` (Fable's call)
- Deferred-items.md documents the same-anchor race that mislabels a transient as `mtm_summary_coverage_incomplete`. If Fable adds a distinct `mtm_anchor_race` reason during the copy pass, it is: (a) a new constant in `stitch_composite.py` (the vocabulary owner), (b) a new `case` in `mtmDisabledReasonCopy`, (c) NOT under any parity guard (per above). It must still DEGRADE (cash ships) and needs a regression test that a mid-crawl event yields the transient-race reason, not a coverage stamp. This is optional per CONTEXT.

### DESIGN.md tokens for the SegmentedControl / disabled state
- Active button (existing): `border-accent text-accent` → `--color-accent #1B6B5A` (institutional teal, "verified/action").
- Disabled button (existing, `SegmentedControl.tsx:52`): `border-border bg-surface text-text-muted opacity-60` → `--color-border #E2E8F0`, `--color-surface #FFFFFF`, `--color-text-muted #64748B` (WCAG-AA 4.85:1 on white).
- The inline disabled-reason `<p>` (`FactsheetView.tsx:1186-1192`) uses `var(--color-warning, #B45309)` — the AA warning amber reserved for "transient recoverable states the system will handle on its own." **Design note for Fable:** MTM disabled for a genuinely-uncoverable book (`mtm_summary_coverage_incomplete`) is NOT transient/recoverable — warning-amber may mis-signal. The coverage-incomplete/venue-unavailable reasons are steady-state honest-empty; a same-anchor-race or timeout reason IS transient. Consider `text-muted` for steady-state reasons and reserve amber for the transient ones. Type tokens: the control uses `text-xs` (raw) inside the frozen chart-adjacent island; the disabled-reason `<p>` uses `text-caption`. Confirm against DESIGN.md fluid-type spine before any new class.
- Font/number rules: labels DM Sans; the control labels are `font-mono uppercase` per the ControlBar convention. All numbers Geist Mono `tabular-nums`.

### MTM-03 live corroboration is genuinely ship-time only — CONFIRMED
- No `metrics_json_by_basis.mark_to_market` exists for any live options strategy until the post-deploy re-derive backfill runs (SUMMARY 101-02 "Ship-time operational step OQ-3"). The worker must deploy to Railway (deploys ride merge-to-main and silently SKIP on red CI — MEMORY), then `enqueue_compute_job(strategy_id, 'derive_broker_dailies')` per single-key Deribit options strategy, then verify the MTM curve corroborates AND cash stays byte-identical (live SC-4). **This cannot be attested during phase-execute** — the IN-PHASE MTM-03 work is the static byte-identity regression only; the live Zavara check is a `checkpoint:human-verify`-style ship-time gate. Do NOT plan an in-phase task that asserts live MTM data.

## Common Pitfalls

### Pitfall 1: Reintroducing an api-key heuristic for the toggle gate
**What goes wrong:** widening the `composite &&` gate by checking `apiKeyId`/`daily_returns===null`. **Why:** `FactsheetPayload` has no `apiKeyId`; compositeness is `dataQuality.composite === true` server truth (`FactsheetBody.basis.test.tsx` discriminator note). **Avoid:** gate on `payload.mtmGate != null` (server-populated) OR `composite`, never on inferred source.

### Pitfall 2: Forgetting the `computation_status` select
**What goes wrong:** MTM-01 gates on `computation_status` but the column isn't in the `page.tsx:44` select → `undefined` → gate either always-open (F-4 violation) or always-closed (toggle never enables). **Avoid:** add `computation_status` to the `strategy_analytics (...)` select AND to the signature-probe path if the gate is evaluated there. Note the cache key is `${id}::${computedAt}` (`page.tsx:344`) — a status flip without a new `computed_at` won't bust cache; verify a re-derive changes `computed_at`.

### Pitfall 3: MTM==cash equality assertion in a regression test
**What goes wrong:** asserting the MTM curve equals cash. **Why:** MTM re-dates premium off the trade day BY DESIGN; equality is wrong (SUMMARY 101-02 Pitfall-2 guard). **Avoid:** assert presence/absence/reason, never numeric equality to cash.

### Pitfall 4: Warning-amber for a steady-state honest-empty reason
**What goes wrong:** rendering `mtm_summary_coverage_incomplete` (a genuinely-uncoverable book) in transient-warning amber implies the system will self-heal. **Avoid:** reserve amber for transient reasons (timeout, anchor-race); use muted for steady-state honest-empty.

### Pitfall 5: Editing a cash golden to "make room" for an MTM case
**What goes wrong:** touching `test_zavara_acceptance.py` / `FactsheetBody.basis.test.tsx` existing assertions perturbs SC-4. **Avoid:** ADD fixtures/modules; the cash pass is independent, so a correct MTM addition requires zero cash edits (Phase 101 proved "zero edits").

## Runtime State Inventory

Not a rename/refactor/migration phase — this is additive read-side wiring + a copy rewrite. No stored-key renames, no service-config renames, no OS-registered state, no secret/env renames, no build-artifact renames. **None found in all five categories — verified: the phase adds a select column + threads existing persisted fields + rewrites display copy; it renames no persisted key.** (The one operational state change — the ship-time re-derive backfill that POPULATES `metrics_json_by_basis.mark_to_market` for existing rows — is the deferred OQ-3 ship-time gate, not an in-phase data migration.)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Frontend framework | Vitest (sharded in CI; coverage-gated — `vitest.config.ts` thresholds lines 82/stmts 80/fns 74/branches 72 per CLAUDE.md) |
| Analytics framework | pytest (`--cov-fail-under=80`; run via `analytics-service/.venv/bin/python -m pytest`, NOT ambient python — Homebrew 3.14 lacks `pandera`, per SUMMARY 101-02) |
| Frontend quick run | `npx vitest run src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx src/lib/factsheet/basis-metrics.test.ts src/app/factsheet/[id]/v2/basis-context.test.tsx` |
| Analytics quick run | `analytics-service/.venv/bin/python -m pytest analytics-service/tests/test_mtm_single_key.py -x` |
| Full analytics suite | `analytics-service/.venv/bin/python -m pytest analytics-service/tests --ignore=tests/e2e --cov --cov-fail-under=80` |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| MTM-01 | Single-key options renders the toggle when `mtmGate` present | unit/DOM | `npx vitest run …/FactsheetBody.basis.test.tsx` | ✅ (extend) |
| MTM-01 | Single-key WITHOUT mtmGate stays byte-identical (no toggle) | DOM byte-identity | same file, existing assertions 4-5 | ✅ |
| MTM-01 | **F-4: a non-DONE `computation_status` row never enables MTM** | unit (read path) | new test on the single-key buildOpts gate | ❌ **Wave 0** |
| MTM-01 | `mark_to_market`-only overlay leaves cash untouched (SC-4) | unit | `basis-metrics.test.ts` | ✅ (extend) |
| MTM-01 | Each honest reason renders correct copy | unit | `basis-context.test.tsx` | ✅ (extend) |
| MTM-02 | Perp-only native composite still toggles | pytest compose | `test_stitch_composite*.py` | ✅ (verify) |
| MTM-02 | Options-member composite → honest disabled-with-reason + MARKED per-member coverage (never zero-filled) | pytest compose | new case in `test_mtm_single_key.py`/`test_stitch_composite.py` | ❌ **Wave 0** |
| MTM-03 | Cash pins byte-identical (frontend + analytics) | golden/parity | `test_golden_parity.py`, `test_zavara_acceptance.py`, `FactsheetBody.basis.test.tsx` | ✅ |

### Sampling Rate
- **Per task commit:** the relevant quick-run command above.
- **Per wave merge:** full analytics suite (`--cov-fail-under=80`) + sharded vitest with coverage (the `frontend` aggregator is the real gate — MEMORY).
- **Phase gate:** both full suites green before `/gsd:verify-work`; the pre-existing `test_audit.py::test_action_literal_matches_ts_union` failure is the ONLY expected red and is out-of-scope (deferred-items.md) — confirm it is the sole failure, not a regression.

### Wave 0 Gaps
- [ ] F-4 `computation_status`-DONE gate test — a single-key options row with `computation_status` not-DONE must yield `mtmGate.available=false` even when `metrics_json_by_basis.mark_to_market` is present (falsifiable: neuter the status check → test RED).
- [ ] Options-member composite compose test — honest disabled-with-reason (rewritten copy) + per-member coverage MARKED (`per_key n_days:0`), never zero-filled.
- [ ] (If Option B chosen for MTM-02) composite options-MTM pass + divergent-degraded TOCTOU + per-reason handling — a full sub-plan, not a Wave-0 gap. Escalate before planning.

## Security Domain

`security_enforcement` not set to false → enabled. This phase reads only already-published, owner-authorized analytics under the existing two-layer visibility gate (`page.tsx:16-33`): request-scoped RLS signature probe → 404, then service-role admin cache-fill of public-safe columns.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | Unchanged RLS: `withPublishedOnly` + request-scoped signature probe (`page.tsx:36,309`); composite sparse read is admin-only under owner/admin RLS (`composite-read-path.ts:32-38`). MTM-01 adds only `computation_status` + `metrics_json_by_basis` reads — both already public-safe on a published row. |
| V5 Input Validation | yes | `mtm_gated_reason` is rendered via a closed switch with generic fallback (`mtmDisabledReasonCopy`) — no untrusted string is rendered raw beyond the mapped copy; the reason is server-controlled vocabulary. |
| V6 Cryptography | no | No secret/api_key/ciphertext surface touched (LOCKED). |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cache bleed across users on the shared factsheet payload | Information disclosure | Admin cache-fill of public-safe columns only + `${id}::${computedAt}` key (`page.tsx:16-33,344`) — do NOT add per-user-filtered columns to the cached select |
| Rendering a fabricated/live-looking MTM object for a failed row | Tampering/Repudiation (trust) | F-4 `computation_status`-DONE gate + `hasBasisHeadline` strictness — the core honest-empty invariant |
| Reason string injection into the DOM tooltip | Tampering | Reason is mapped through the closed `mtmDisabledReasonCopy` switch; never interpolate raw server text |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cash↔MTM toggle rendered `composite &&` only | Widen to admit single-key options with a persisted `mtmGate` | Phase 102 (this) | Single-key options books show an honest MTM curve |
| `unsmoothed_options_book` copy references Phase-83 daily-mark smoothing | Honest current copy (smoothing permanently dropped) | Phase 102 | No stale/false explanation |
| Options-composite MTM gate deferred ("composite gate semantics are Phase 102", `stitch_composite.py:108`) | RESOLVED as verify-only + copy (Option A) OR escalated build (Option B) | Phase 102 decision | Determines plan size |

**Deprecated/outdated:**
- Phase-83 daily-option smoothing — permanently dropped (CONTEXT). Any ROADMAP "where smoothing now works" wording is STALE; ignore.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | MTM-02 recommended disposition is Option A (verify-only + rewrite the stale copy; leave options-composite MTM honestly gated OFF), because Option B crosses the locked "NO new valuation math" boundary | Q3 | If the milestone actually intends options composites to toggle MTM, the plan under-scopes MTM-02 by a full sub-feature. **Escalate to user before planning.** |
| A2 | The correct `computation_status` DONE literals are `'complete'` and `'complete_with_warnings'` (matching the PDF routes `pdf/route.ts:231-232`) | Q1 | If the read-path uses a different status vocabulary, the F-4 gate mis-fires. Verify against the actual column enum. |
| A3 | Widening the render gate to `payload.mtmGate != null || composite` is the intended predicate | Q2 | A different predicate (e.g. an explicit `options` flag) may be preferred by Fable's UX spec; low risk (server-truth either way). |
| A4 | The generic `default` copy ("…for this composite") should be made basis-agnostic for single-key | Also-Surface | Cosmetic; wrong copy on an edge single-key reason. Fable owns final copy. |

## Open Questions

1. **Should options-member composites toggle MTM (Option B), or stay honestly disabled (Option A)?**
   - Known: perp-only composites already toggle; the per-member MTM pass machinery exists (`job_worker.py:4177`) but is gated off for options members (`stitch_composite.py:302-303`).
   - Unclear: whether v1.10's final phase intends composite options parity or accepts the single-key/composite asymmetry.
   - Recommendation: default Option A (in-scope, honest, no valuation change); escalate Option B to the user as an explicit scope decision before the planner sizes MTM-02.

2. **Does the single-key read path evaluate the F-4 gate before or inside the cached `fetchAndBuildPayload`?**
   - Known: the payload is cached on `${id}::${computedAt}`; trust tier is deliberately NOT cached (per-request).
   - Recommendation: gate inside `fetchAndBuildPayload` (`computation_status` rides `computed_at` on a re-derive), but confirm a status flip produces a new `computed_at` so cache busts.

## Environment Availability

Skipped — pure code/config + test changes inside the existing repo; no new external tools, services, or runtimes. The one external dependency (Railway re-derive to populate live MTM data) is the deferred ship-time gate, not an in-phase requirement.

## Sources

### Primary (HIGH confidence — codebase, current tree)
- `src/app/factsheet/[id]/v2/page.tsx` (:44 select, :90 composite discriminator, :111-120 single-key arm) — the wiring seam
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` (:1067-1069, :1170-1194) — the render gate
- `src/app/factsheet/[id]/v2/basis-context.tsx` (:74-94 useBasisMetrics, :100-109 reason copy)
- `src/lib/factsheet/basis-metrics.ts` (:18 map, :53 overlay, :88 hasBasisHeadline) — SC-4 keystone
- `src/lib/factsheet/build-payload.ts` (:243 cash overlay, :346-347 forward)
- `src/lib/factsheet/composite-read-path.ts` (:143 mtmAvailable, :167 mtmGate)
- `src/lib/factsheet/types.ts` (:485 metricsByBasis, :495 mtmGate open union)
- `src/components/strategy-v2/SegmentedControl.tsx` (:10,:50 disabledReason)
- `analytics-service/services/stitch_composite.py` (:101-128 reason constants, :290-306 mark_to_market_available gate)
- `analytics-service/services/job_worker.py` (:4171-4324 composite MTM gate + dual-basis build + coverage mask)
- `src/app/api/factsheet/[id]/pdf/route.ts` (:214,:231-232) — the `computation_status` DONE literals
- `analytics-service/tests/` golden/parity + acceptance suite listing (Q4)
- Phase 101 SUMMARY 101-01, 101-02, deferred-items.md — persisted contract + ship-time OQ-3 + anchor-race known-limitation
- `DESIGN.md` — accent/border/muted/warning tokens + fluid-type spine

### Secondary (MEDIUM)
- CLAUDE.md / MEMORY.md — CI gate shape, `.venv` interpreter, Railway deploy-skip-on-red, `.planning` gitignored (Edit not Write)

### Tertiary (LOW / needs confirmation)
- A2 `computation_status` enum literals — inferred from the PDF routes; confirm against the column definition.

## Metadata

**Confidence breakdown:**
- Q1 wiring seam: HIGH — exact file:line, single-key arm demonstrably omits metricsByBasis/mtmGate.
- Q2 gate flip + SC-4 keystone: HIGH — the `composite &&` gate and the absent-cash-key no-op overlay are both explicit in source.
- Q3 build-vs-verify: HIGH on the mechanism (gate unconditionally rejects options members), MEDIUM on the recommended disposition (Option A is a scope judgment flagged ASSUMED/A1 for user confirmation).
- Q4 golden/parity: HIGH — suites enumerated, Phase-101 additive pattern proven.
- F-4 gate: HIGH — `computation_status` verified absent from the factsheet page select.
- Taxonomy-guard clearance: HIGH — grep-verified no MTM reason under any parity/audit guard.

**Research date:** 2026-07-12
**Valid until:** ~30 days (stable internal codebase; re-verify file:line if FactsheetView/page.tsx are refactored before planning)

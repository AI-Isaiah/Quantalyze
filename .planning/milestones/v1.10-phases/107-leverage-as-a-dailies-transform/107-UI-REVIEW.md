# Phase 107 — UI Review (Retroactive)

**Audited:** 2026-07-15
**Baseline:** `DESIGN.md` (governing system) + `107-UI-SPEC.md` (design contract)
**Branch:** `gsd/phase-107-leverage-as-a-dailies-transform` vs `origin/main`
**Screenshots:** not captured — code-only audit (retroactive, no dev server; the touched surface is a data-dense factsheet requiring seeded authed state)
**Posture:** ADVISORY — non-blocking. No source edited, no git touched.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | **PASS** | Clamp strings verbatim to UI-SPEC; caption softened per corrected intent (names the non-re-deriving panels); per-panel notes share the caption's peer/allocator/event vocabulary. Minor: identical label reused across two distinct event-signature panels. |
| 2. Visuals / Hierarchy | **PASS** | No orphaned containers; α/IR now render real sign-toned values instead of "—". Ratified tradeoff: the levered "what-if" state lost its high-salience amber marker and is now signalled only by muted prose + Reset affordance + input value. |
| 3. Color | **PASS** | Disclosure correctly moved OFF amber → `text-text-muted`; `--color-warning` amber survives only on the transient clamp message. No new colors; α/β use positive/negative tokens honestly. |
| 4. Typography | **PASS** | Caption = caption tier (12px DM Sans muted) per spec; `BaseLeverageNote` = micro uppercase tracking-wider, matching the surviving BASIS eyebrow idiom. No new sizes/weights. Advisory: two visual registers for the same "not levered" concept. |
| 5. Spacing | **PASS** | All offsets on the 4px ladder; MetricsColumn deletion returns the bare column with no wrapper/empty-eyebrow gap. Advisory: `BaseLeverageNote` anchor position is inconsistent across the four panels. |
| 6. States / Interaction | **PASS** | Caption + all notes gated on the single shared `leverageApplies` predicate reading the SAME deferred applied-leverage the view derived from; insertion-only → L=1 byte-identical (SC-4). Strong, well-tested state coverage. |

**Overall: 6/6 PASS** — clean, root-cause refactor. Zero BLOCKERs. Four advisory WARNINGs below are polish-tier, not ship-gating.

---

## Top Advisory Findings (all WARNING-tier)

1. **`BaseLeverageNote` anchor position varies across panels** (Spacing / hierarchy consistency) — The per-panel "shown at base 1× leverage" note renders at the **bottom** of `PeerPercentilePanel` (after the cohort caveat), inside the **header** of `AllocatorSection`, and as the **first child (top)** of `SignaturesSection` and `CrossSignaturesSection`. Same annotation, three different anchor positions. Impact: a reader scanning levered panels finds the honesty note in a different place each time. Fix: pick one convention (recommend top-of-section, directly under the panel H2, matching the two signature panels) and apply to all four call sites.

2. **Duplicate note label across two distinct panels** (Copywriting) — Both `SignaturesSection` and `CrossSignaturesSection` render the identical label `"Event signatures shown at base 1× leverage"`. When both sections are on-page and levered, the user sees byte-identical notes twice with no disambiguation. Impact: mild redundancy / looks like a copy-paste. Fix: differentiate the cross panel, e.g. `"Cross-signatures shown at base 1× leverage"`.

3. **Levered "what-if" state is visually quiet** (Visuals / hierarchy) — Deleting the amber `MODELED · N×` eyebrow removed the only high-salience marker that a levered factsheet is a projection. The KPI values now look identical to a real factsheet; the sole signals are the muted caption, the `Reset 1×` button, and the non-1 input value. This is a **deliberate, ratified** decision (UI-SPEC Color rationale: the levered track is now a real re-derive, so the disclosure is steady-state info not a warning) and is backed by a `role="status"` live-region announcement — hence PASS, not FLAG. Surfaced so the tradeoff is on record: consider whether the caption's emphasis is sufficient for an at-a-glance reader who does not hear the announcement.

4. **Two typographic registers for one semantic concept** (Typography consistency) — The global disclosure is a sentence-case caption (`text-caption text-text-muted`, DM Sans) while the per-panel "same idea" notes are uppercase micro eyebrows (`text-micro uppercase tracking-wider text-text-muted`, Geist Mono idiom). Defensible — the per-panel form matches the adjacent BASIS eyebrow, and both stay muted and on-token — but the split is worth a conscious ratification.

---

## Detailed Findings

### Pillar 1: Copywriting — PASS

- **Clamp copy matches UI-SPEC verbatim** (`FactsheetView.tsx` ControlBar):
  - Negative → `"Leverage can't be negative — shorting isn't included in this what-if. Clamped to 0."` (reworded from "isn't modeled in this projection") ✓
  - Above max → `` `Leverage clamped to ${MAX_LEVERAGE}× — the maximum in this what-if projection.` `` (`MAX_LEVERAGE` interpolated, not hard-coded) ✓
  - Non-finite → `"Invalid leverage — enter a number between 0 and 10. The previous value was kept."` ✓
- **Caption copy** (`FactsheetView.tsx:860`) reads `"What-if projection at {N}× leverage: daily returns are scaled r → L·r and the return-derived metrics, charts, and rail re-derive; peer, allocator, and event-study panels stay at base 1×. Excludes borrow, funding, and liquidation cost — not the strategy's realized track record."` This diverges from the UI-SPEC's approved string ("…and the whole factsheet re-derives.") but is the **corrected intent** per the phase note: the red team found "whole factsheet re-derives" an overclaim, so the caption now honestly enumerates the non-re-deriving panels. Treated as PASS — the softened copy is the more honest one and is internally consistent with finding #2's per-panel notes.
- **Cross-consistency (strong positive):** the caption's "peer, allocator, and event-study panels stay at base 1×" is mirrored one-for-one by the per-panel labels ("Peer rank…", "Allocator analysis…", "Event signatures…"). Global and local disclosures agree.
- WARNING #2 (duplicate cross-signature label) applies here.
- The kept `aria-label`/`title` `"Leverage multiplier (1× = unlevered; excludes borrow / funding cost)"` is unchanged and honest.

### Pillar 2: Visuals / Hierarchy — PASS

- **Deletions leave no orphaned DOM.** `MetricsColumnWithBasis` (`FactsheetView.tsx:327`): the `!composite && !mtmParticipant` path returns the **bare `<MetricsColumn>`** (no wrapper `<div>`, no empty eyebrow) — confirmed against D4. The MTM-participant branch keeps its single `BASIS · MARK-TO-MARKET` eyebrow (with the pre-existing F4 reserved-blank under cash), unchanged. No leftover `modeled` branch, no `data-testid="metricscolumn-base-track-eyebrow"` anywhere in non-test source (grep clean).
- **KpiStrip** (`FactsheetView.tsx:841–862`): the deleted amber eyebrow + `LEVERAGE_CAVEAT` are replaced by a single muted caption, gated `{leverageApplied && …}` — insertion-only, no reserved row.
- **Hierarchy improvement:** α/IR cells now render real values with `signTone` (positive/negative) at L≠1 instead of blanking to "—", so the benchmark-relative row is no longer a dead zone under leverage.
- WARNING #3 (quiet what-if state) applies here — logged as a ratified tradeoff, not a defect.

### Pillar 3: Color — PASS

- **Amber → muted reassignment is complete and consistent.** The what-if disclosure is `text-text-muted` (#64748B) — `FactsheetView.tsx:856`. Grep for `--color-warning` / `#B45309` in the touched files shows amber surviving on exactly two sites, both correct:
  - the **transient leverage clamp message** (`FactsheetView.tsx:1240`) — a recoverable input event ✓
  - the pre-existing **MTM transient reason** (`FactsheetView.tsx:1268`) — orthogonal to this phase, unchanged ✓
- No new color token, no hardcoded hex introduced beyond the existing `var(--color-warning, #B45309)` fallback pattern already in the file.
- `BaseLeverageNote` is `text-text-muted` — same muted tier, never amber (`basis-context.tsx:360`). Correct per DESIGN.md: a base-1× panel is steady-state honest information, not a recoverable warning.
- α/β sign tones use the positive/negative semantic tokens honestly at L≠1.

### Pillar 4: Typography — PASS

- Caption: `text-caption` (12→13px, DM Sans, 400) — matches the UI-SPEC Typography row for the disclosure line.
- `BaseLeverageNote`: `text-micro uppercase tracking-wider` (`basis-context.tsx:360`) — the established factsheet eyebrow idiom (identical to the surviving `BASIS · MARK-TO-MARKET` eyebrow and the deleted `BASE · 1× TRACK` eyebrow it semantically succeeds). `micro` is a de-facto tier on this surface (LEVERAGE label, Reset button, all eyebrows) and is listed as an existing tier in the UI-SPEC — no new size/weight introduced; the v2 4-size/2-weight contract is respected (differentiation via `uppercase tracking-wider`, weight stays 400).
- WARNING #4 (two registers) applies — advisory only.

### Pillar 5: Spacing — PASS

- All offsets on the 4px ladder: caption `mt-6` (24px), basis eyebrow `mt-6`, `BaseLeverageNote` `mt-2` (8px). No arbitrary `[Npx]`/`[Nrem]` values introduced in the diff.
- The deletion swaps two elements (`mt-6` eyebrow + `mt-2` caveat) for one `mt-6` caption — no double-margin, no orphaned gap.
- MetricsColumn bare-return path removes the wrapper entirely at L=1 for non-MTM strategies, so there is no residual `flex flex-col gap-4` container adding a phantom gap (D4 verified).
- WARNING #1 (inconsistent note anchor across the four panels) applies here.

### Pillar 6: States / Interaction — PASS

- **Single source of truth (IN-02).** `leverageEligibleFor` + `leverageApplies` (`basis-context.tsx:309–329`) are consumed by the view hook's guards, the KpiStrip caption gate, the ControlBar eligibility, AND every `BaseLeverageNote`. The three (formerly hand-duplicated) predicates cannot drift.
- **Honesty invariant across the deferred window (WR-01).** The caption and notes read `useAppliedLeverage()` — the SAME `useDeferredValue`-debounced leverage the view derived the displayed bundle from — so the caption can never claim a what-if the numbers have not yet applied, in either direction. Backed by a dedicated regression test (`FactsheetView.leverage-honesty.test.tsx`) that mocks `useDeferredValue` to reproduce the ~235ms window deterministically.
- **L=1 byte-identity (SC-4).** Caption + notes are insertion-only, gated on `appliedLeverage !== 1`; the view short-circuits to `base` by reference at unity before any `deriveSeriesBundle` call. No caption/note can render at L=1 (verified against the "D4 no-orphan" and L=1 byte-identity tests).
- **No skeleton flash.** `useDeferredValue` keeps the last-good bundle rendered during the low-priority re-derive (contract: never flash charts to empty). No spinner, no blocking overlay.
- **a11y.** Caption + clamp both carry `role="status" aria-live="polite"`; the deleted eyebrow's redundant announcer was correctly consolidated (the caption is now the single authoritative live region for entering/leaving the what-if). Input focus ring `focus-visible:outline-2 outline-offset-2 outline-accent` preserved; touch targets `min-h-[28px] pointer-coarse:min-h-[44px]` preserved.
- **Edge case handled.** L=0 is a reachable state (input `min="0"`); the leverage-invariance pin is correctly disabled at L≤0 so Sharpe/Sortino render honest derived zeros rather than a stale non-zero value beside flat charts (B-1).

---

## L=1 / L≠1 render-state audit (task-specific)

| Question | Result |
|----------|--------|
| Caption renders at L=1? | **No** — gated on `leverageApplies` (requires `appliedLeverage !== 1`). Byte-identical baseline preserved. |
| Any `BaseLeverageNote` renders at L=1? | **No** — same `leverageApplies` gate; returns `null` (`basis-context.tsx:357`). |
| Caption fails to render at L≠1 (eligible)? | **No** — renders whenever eligible + `appliedLeverage !== 1`, on the deferred value the view used. |
| Notes fail to render at L≠1 (eligible)? | **No** — same predicate as the caption, so notes appear exactly when the page is actually levered. |
| Amber leaks onto the disclosure? | **No** — disclosure is `text-text-muted`; amber confined to the transient clamp (+ pre-existing MTM transient reason). |

---

## Files Audited

- `src/app/factsheet/[id]/v2/FactsheetView.tsx` (KpiStrip caption, MetricsColumnWithBasis D4, ControlBar clamp copy + eligibility)
- `src/app/factsheet/[id]/v2/basis-context.tsx` (`useBasisSeriesView` leverage layer, `useAppliedLeverage`, `leverageEligibleFor`, `leverageApplies`, `BaseLeverageNote`)
- `src/app/factsheet/[id]/v2/BatchDPanels.tsx` (PeerPercentilePanel, AllocatorSection notes)
- `src/app/factsheet/[id]/v2/SignaturePanels.tsx` (SignaturesSection note)
- `src/app/factsheet/[id]/v2/CrossSignaturePanels.tsx` (CrossSignaturesSection note)
- Test deltas (evidence): `FactsheetView.leverage.test.tsx`, `FactsheetView.leverage-honesty.test.tsx`, `FactsheetBody.basis.test.tsx`
- Baselines: `DESIGN.md`, `107-UI-SPEC.md`

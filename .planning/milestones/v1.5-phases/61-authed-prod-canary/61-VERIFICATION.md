# Phase 61 — Authed Prod QA Canary (VERIFY-02) — results

2026-07-02, prod quantalyze-rho.vercel.app @ main (app = v0.35.0.28 bac2960f;
#568/#569 CI-only). Authed as qa-demo via service-role magic link in a real
browser (Playwright MCP). The allocations surface resolves to the **Atlas
demo book** (a11ca111…): 4 API keys + 5 portfolio strategies, no CSV sources.
Zero console errors/warnings across the entire session.

## A. Core VERIFY-02 — ALL PASS

- **A1 widen→auto-drop ✓** — "Full range (some drop out)" → window 01-22→06-25,
  three short keys move to a dedicated "Auto-excluded (outside window)" region
  with the honest explanation + per-row reason "ends Jun 2026 — outside window".
- **A2 narrow→auto-restore ✓** — "Common period" restores all 4 to in-blend,
  region disappears, header back to "Mean of 4 strategies".
- **A3 Common period ✓** — intersection 02-28→06-07, all in.
- **A4 Full range ✓** — union window, drops as expected; per-dropped-row
  include-cost label: "Include → shortens window to 2026-02-28–2026-06-07 (−2 mo)".
- **A5 empty-intersection guidance — UNREACHABLE on prod data** (all Atlas
  constituents overlap; the manual control CLAMPS out-of-domain dates —
  2025-01-01→2025-03-01 clamped to 01-22→01-22 single-day). Observed nearest
  behavior is correct+honest: "1 strategy — not a blend", never a flat-zero.
  The banner itself remains covered by unit/e2e tests only.
- **A6 divisor == visible membership ✓** — header count matched visible
  in-blend timeline rows in every state (4↔4, 1↔1 with 3 auto-excluded).

Bonus: the one-time union→intersection default-change note is live
("Now showing the common period where all 4 overlap · Show full range · ×").

## B. Deferred HUMAN-UAT

- **B1 gantt proportions ✓** — bars proportional (long key spans full axis;
  short keys start ~25%, end ~88% = correct for 02-28→06-07 on 01-22→06-25).
  Screenshot p61-gantt-common.png. NOTE: from-book rows label as raw
  "key <uuid>" — functional, but unfriendly (polish candidate).
- **B2 header hierarchy ✓** — "Mean of 4 strategies · window" primary, "window
  truncated from full range" de-emphasized; degrade state "1 strategy — not a
  blend" honest. Screenshot p61-blend-header.png.
- **B3 save→reopen window round-trip ✓** — saved at 02-28→05-01, perturbed to
  06-07, reopen restored 05-01. Draft window ALSO survives a full page reload.
- **B4 share round-trip ✗ BUG (P61-BUG-2)** — the shared view of a from-book
  draft renders an honest EMPTY shell: "0 overlapping days", all metrics "—",
  no equity, no provenance note. Fails safe (no invented numbers) but the
  feature is non-functional for book-mode drafts.
- **B5 provenance note ✗** — not shown (blocked by B4: no computed window to
  annotate).
- **B6 heterogeneous compare — STRUCTURE ✓ / book-draft column ✗ (same BUG-2)**
  — per-column <tfoot> "Window" row present; Live-book column computed
  ("81 overlapping days · 2026-04-13–2026-07-02"); the saved book-draft column
  honestly degrades ("0 overlapping days — fewer than the 60 needed").
- Delete saved → share link 404s (revocation cascades) ✓.

## C. Phase-60 a11y fixes live — BOTH PASS

- **C1 heatmap contrast ✓** — worst live cell 5.71:1 (≥4.5), and it is exactly
  the fixed dead-band class: −1.4 on rgb(232,113,113) with computed DARK text.
- **C2 scroll-region focus ✓** — 4 scrollable regions carry role="region" +
  tabindex=0 + descriptive aria-labels (monthly, daily calendar, drawdowns,
  scenario comparison).

## Bugs found (both root-caused, fix pending)

**P61-BUG-1 — drawer-added strategies are INERT in book mode** (genuine bug,
Phase-37 regression, root-caused by subagent with file:line evidence):
`ScenarioComposer.tsx:1682-1689` — when `entryMode === "book" &&
payload.perKeyDailiesGateSatisfied` (every real book), `activeAdapterOutput =
perKeyAdapterOutput`, and `buildPerKeyStrategyForBuilderSet` takes NO
addedStrategies input — the added units (correctly built with real returns on
the holdings path) are discarded wholesale. The weights UI renders the DRAFT,
so it looks live while disconnected. This is exactly the CSV-strategies-plus-
API-keys blend path (allocator adds CSV-backed strategies to a keyed book) —
the hardest and most valuable mixed setup. Zero test coverage for "add while
per-key gate is true"; the bridge-to-composer seam guard drives the OTHER
adapter path so it stays green.

**P61-BUG-2 — saved/shared/compared book drafts compute EMPTY**:
`scenario-compare.ts:129` computeMetricsForDraft uses
`buildStrategyForBuilderSet` (holdings+added path) and cannot reconstruct
per-key units from a saved book draft → share view and compare columns render
honest empties. Same divergence family as BUG-1 (two adapter paths disagree by
construction).

## Verdict

VERIFY-02 core (A) PASSES — the coverage-window state machine is correct and
honest live on authed prod. The v1.5 window features themselves (58: header,
chips, gantt, include-cost, default-note; 59: window persistence в save/reopen)
verified. The share/compare surfaces (59) are structurally correct but
non-functional for book-mode drafts due to pre-existing adapter-path divergence
(BUG-1/BUG-2), discovered BY this canary. Fixes queued as follow-up work with
regression tests per the found-bug discipline.

## Addendum 2026-07-03 — BUG-1/BUG-2 FIXED, LANDED, PROD-RE-VERIFIED (PR #570)

PR #570 v0.35.0.31, squash `f8b502e7` on main; main CI green first-try;
Vercel prod READY at exact SHA. Fix reviewed by a fresh-context adversarial
agent (verdict: core sound; its FIX-FIRST finding + call-site wiring test
addressed in-diff; all new regression tests confirmed RED pre-fix).

Re-run of the failed canary items on prod (qa-demo, Atlas book):

- **B4 → CLOSED (behavior change, honest-by-design)**: book-only drafts are
  no longer shareable AT MINT — POST share returns 409 `book_only_draft` and
  the saved-list surfaces "This scenario is built only on your private book
  sources, which are never shown on a public link. Add catalog strategies to
  share a computable projection." (verbatim, observed live). Already-minted
  book-only links render the designed honest-absence card with the book-only
  reason. The live-book privacy boundary is kept (owner per-key series never
  resolve publicly); mixed keys+added shares mint and compute (added legs).
- **B5 → CLOSED by construction** for shareable (added-bearing) drafts; the
  book-only case no longer produces a shared page to annotate.
- **B6 → CLOSED**: saved book-draft compare column computes real numbers at
  its persisted window — observed live: Cum +0.06% / Sharpe 0.11 over its
  40-day window next to the Live-book column (155 overlapping days).
- **BUG-1 → CLOSED**: drawer-add Helios Funding Carry lands in the
  auto-excluded accounting (short series vs sticky window), and "Common
  period (all in)" makes it a member — header reads **"Mean of 5 strategies"**
  (screenshot p61-fix-verify-mean-of-5.png in repo root .playwright-mcp
  session dir). Weight input moves the blend (regression-tested).

VERIFY-02 is now fully satisfied: core state machine (A) + all six deferred
HUMAN-UAT items (B1-B6) verified live; C1/C2 a11y fixes live. QA residue
(saved "P61 fix-verify book-only") deleted from prod.

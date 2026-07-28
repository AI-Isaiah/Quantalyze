# Phase 65 — Authed Prod Canary (GUARD-04) — VERIFICATION

**Date:** 2026-07-04 (run ~00:20–00:40 CEST)
**Prod:** quantalyze-rho.vercel.app (= quantalyze.xyz) @ **v0.36.0.0**, squash `f78f036b`
(PR #572); Vercel Production success at exact SHA; Railway analytics SUCCESS.
**Auth:** qa-demo@quantalyze.app via service-role magic-link `action_link`
(no password typed), Playwright MCP browser, viewport 1440×900. Surface
resolved to the **Atlas demo book**: 4 API keys, per-key engine set.
Member key UUIDs recorded from row labels (A1): `2427aa46-…`, `1b116e2e-…`,
`a6f2b712-…`, `afd6224b-…` (full UUIDs in evidence below).

## A. SC1 — purified surfaces render live

- **A1 book blend ✓** — scenario tab in book mode: header **"Mean of 4
  strategies · 2026-02-28–2026-04-08 · window truncated from full range"**,
  4 per-key rows (`key {uuid}` labels), real numbers. 0 console errors.
  Screenshot `p65-a1-a2-book-blend-kpi.png`.
- **A2 KPI strip return-form only ✓ (new in 64)** — grid
  `grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-4` with EXACTLY 4 cells:
  **YTD TWR +0.05% · SHARPE 0.11 · MAX DD 12M −4.97% · AVG |ρ| 0.55**.
  Whole-page grep for "AUM": **0 hits** on the scenario tab. Nothing replaces
  the removed slot. 0 console errors.
- **A3 blank-slate mode ✓** — segment → Blank slate (guarded by the designed
  "Discard your scenario draft?" confirm): **0 book rows** (no holdings
  resurrection), honest-empty panels ("This scenario has no projected return
  history yet…" on compare/stress/simulate), drawer-add only. Switch back to
  book → per-key blend returns intact ("Mean of 4 strategies", 4 key rows).
  0 console errors.
- **A4 mixed keys+added ✓** — drawer-add **Helios Funding Carry**: enters the
  auto-excluded accounting ("ends Apr 2026 — outside window" + "Include →
  shortens window to…"); preset **"Common period (all in)"** → header
  **"Mean of 5 strategies"** (P61 golden reproduces); weight input 0.010 →
  0.300 MOVES the blend: Sharpe 0.10→0.07, YTD +0.05%→+0.01% (P61-BUG-1
  stays fixed). 0 console errors. Screenshot `p65-a4-mean-of-5-mixed.png`.

## B. SC2 — persistence + share

- **B1 membership round-trip + red-team F-1 ✓** — saved "P65 canary mixed"
  (book+added, weight 0.300). F-1 sequence: switched the session to BLANK
  (discard confirm), then reopened the saved draft from the blank-mode
  session → composer **ADOPTED book basis** (segment flipped to "From my
  book", 4 per-key rows, "Mean of 5 strategies", Helios weight 0.300 intact).
  Clicked **"Update portfolio"** (PUT 200), then read the persisted draft via
  the authed API: **`schema_version: 4`, `memberKeyIds` = all 4 key UUIDs
  intact** (`1b116e2e-a102-4e5f-9f91-1f2d90df323a`,
  `2427aa46-e43a-470d-9959-0d4313c37cdf`,
  `a6f2b712-f96a-42eb-9b03-8c4b88124eea`,
  `afd6224b-360e-48d5-8758-4127ae7b7b7f`), addedStrategies=1, Helios weight
  0.3 in weightOverrides. Reopened once more → book basis + members render.
  **Membership NOT wiped — the F-1 fix holds live.** 0 unexpected console
  errors. (Note: draft weightOverrides also carry `holding:*`-keyed book
  composition weights — these are draft-level composition data, not engine
  unit ids; ENGINE-05's guard concerns engine ids and stays satisfied.)
- **B2 compare on persisted membership ✓** — compare "P65 canary mixed" vs
  Live book: saved column computes REAL numbers on its persisted membership —
  **Cum +0.01% / Sharpe 0.07** (matching the composer exactly — the F-1
  engine-basis divergence class is gone) over its **40-day** persisted window
  (with the honest <60-days estimate note); **Live book: 155 overlapping
  days · 2026-01-22–2026-06-25** (checker-hardened golden binding: ≥155 ✓,
  exact match with the P61 observation), Cum +12.56% / Sharpe 0.85.
  Per-column `<tfoot>` WINDOW row present. 0 console errors.
- **B3 mixed share mint + public resolve ✓** — mint POST **200**; public link
  fetched LOGGED-OUT (curl): HTTP 200, caption VERBATIM
  **"computed from this scenario's catalog strategies only"** at
  `data-testid="scenario-mixed-caption"` (class `mt-1 text-xs
  text-text-muted`, sibling of the methodology line); added leg renders
  computing (Total return −0.32%, CAGR −2.79%, Sharpe −0.41). **Leak grep:
  all 4 member key UUIDs = 0 hits** in the full logged-out page source
  (HTML + RSC flight). Browser visit of the public page: 0 console errors.
  Screenshot `p65-b3-mixed-share-caption.png`.
- **B4 book-only mint 409s ✓** — saved "P65 canary book-only" (added leg
  removed); Share → POST **409** and the saved list surfaces the honest
  message VERBATIM: "This scenario is built only on your private book
  sources, which are never shown on a public link. Add catalog strategies to
  share a computable projection." The one console entry is the browser's
  resource-log of the EXPECTED 409 response (designed honest failure, P61
  precedent) — not an app error.

## C. SC3 — v3→v4 identity

- **C1 ✓** — saved list was EMPTY pre-canary ("No saved portfolios yet"):
  no v1.5-saved draft survives (consistent with 61-VERIFICATION's addendum —
  the P61 residue was deleted). → C2b fallback applies.
- **C2b fallback ✓** — fresh book-only draft on the Atlas book: compare
  column computes REAL numbers — **Cum +0.05% / Sharpe 0.11 over its 40-day
  persisted window** next to Live book at **155 overlapping days** — never
  the P61-BUG-2 "0 overlapping days" empty. **Sharpe (0.11), window span
  (40d), and live-column day count (155) match the P61 goldens exactly**;
  Cum reads +0.05% vs the P61 draft's +0.06% — a fresh-draft provenance
  difference at 2-dp display precision (this is a NEW draft saved today, not
  the original v3 draft, so byte-identity is not claimed; the C2b contract —
  real numbers + the "Mean of 5 strategies" golden via drawer-add + Common
  period, verified in A4 — is fully met). 0 console errors.

## D. Cleanup ✓

- Both canary scenarios deleted via the inline confirm ("Delete "…"? |
  Delete | Cancel"); authed API list confirms **remaining: []** — the exact
  pre-canary state.
- Share cascade: the B3 public link returns **HTTP 404** after deletion.
- No pre-v1.6 draft existed to preserve. Session self-expires (1h token).

## Console-error ledger (session-wide, all pages)

4 entries total, ALL accounted for, **0 unexpected app errors**:
2× stale 409s from a prior Playwright-MCP session buffer (pre-date this
session's log file — P61-era), 1× 404 from the canary's own API-shape probe
fetch (`/api/allocator/scenario`, artifact), 1× the EXPECTED B4 409.

## Bugs

**None found.** No fixes queued; no regression tests owed.

## Verdict vs roadmap success criteria

1. **SC1 ✓** — book blend, blank mode, mixed keys+added render live, KPI
   strip return-form only, 0 unexpected console errors on every item.
2. **SC2 ✓** — membership round-trips through save→reopen→Update (F-1 fix
   verified live at the persisted-draft layer), compare computes on persisted
   membership, share mint/resolve honest (caption + leak-clean + 409).
3. **SC3 ✓** — via the roadmap-sanctioned C2b fallback: fresh book-only
   draft computes real numbers with Sharpe/window/day-count matching the P61
   goldens; "Mean of 5 strategies" golden reproduced; no series-space
   regression observed.

**GUARD-04 SATISFIED — phase goal achieved.**

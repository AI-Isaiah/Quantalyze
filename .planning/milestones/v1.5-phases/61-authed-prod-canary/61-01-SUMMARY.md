---
phase: 61-authed-prod-canary
plan: 01
subsystem: scenario-blend-qa
tags: [prod-canary, authed-qa, coverage-window, VERIFY-02, P61-BUG-1, P61-BUG-2]
requires:
  - "Phase 60 (restored e2e net + deployed v0.35.0.28)"
provides:
  - "VERIFY-02 live evidence (61-VERIFICATION.md + p61-* artifacts)"
  - "mergeAddedIntoPerKeySet (scenario-adapter.ts) — added units join the per-key engine set"
  - "scenario-compare per-key channel (gate/series/eligibility/equity shares)"
  - "book-only share mint 409 + honest-absence reason on resolve"
affects:
  - "v1.6 series-space purification (input doc .planning/v1.6-SERIES-SPACE-INPUT.md)"
requirements-completed: [VERIFY-02]
---

# Summary 61-01 — Authed prod canary run + found-bug fixes landed

Status: DONE (canary 2026-07-02 + fix PR #570 v0.35.0.31 `f8b502e7` landed and
prod-re-verified 2026-07-03).

- Canary (qa-demo magic link → Playwright, Atlas book, 0 console errors):
  core VERIFY-02 ALL PASS (widen→auto-drop w/ reasons + include-cost, narrow→
  restore, both presets, divisor == visible membership, honest degrades,
  default-change note). Six deferred Phase-58/59 HUMAN-UAT items executed:
  B1-B3 pass; B4-B6 exposed two prod bugs.
- **P61-BUG-1** (Phase-37 regression): drawer-added strategies INERT in book
  mode — per-key adapter swap discarded draft.addedStrategies wholesale.
  **P61-BUG-2**: saved/shared/compared book drafts computed EMPTY (compare
  rebuilt drafts on holdings-snapshot series; share never resolves book series).
- Fix (PR #570): added units merged into the per-key set with USD→share weight
  normalization at the merge point (keys-only blend byte-identical); compare
  mirrors the composer's engine-set selection; book-only share mint 409s with
  honest copy, already-minted links render honest-absence w/ reason. Red-team
  F1 (DSRC-03 card over a live added-only blend) fixed same-PR; F2 call-site
  wiring test (T_CP8) added; F3/F5 logged as v1.6 input.
- Prod re-verification: "Mean of 5" after add+common-period; 409 message
  verbatim in UI; compare column real numbers at persisted window.
- A5 (empty-intersection banner) UNREACHABLE on prod data (manual dates clamp
  to the data domain) — remains unit/e2e-covered only, documented.

Verification: 61-VERIFICATION.md (+ 2026-07-03 addendum); full suite 7,408+/0,
tsc clean, lint 0 errors, frozen engine zero-diff on #570.

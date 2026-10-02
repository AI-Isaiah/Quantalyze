# Phase 60 — VERIFICATION (VERIFY-01) ✅

PR #567 v0.35.0.28, squash `bac2960f` on main (2026-07-02). Main CI green
first-try; Vercel prod READY at `bac2960f` (verified via deployment API),
public canary 200 / 0 console errors.

## Goal-backward check

Goal: "baselines deliberately re-baked to the new blend series — the safety
net is restored green, not disabled."

1. **No bake was needed and none ran** — evidence in 60-VERIFY-01-EVIDENCE.md
   (no golden renders the blend; zero snapshot commits across v1.5; byte-compat
   legacy path). The svg-golden parity re-diffs ran green in all 4 CI rounds of
   #567, including over the a11y fixes — the strongest possible proof the
   goldens were not invalidated.
2. **The net that WAS weakened is restored**: the Phase-58 composer-axe
   anchors are unconditional again on a deterministic seeded state, PROVEN by
   the passing seeded e2e job in CI round 4 (all 19 checks green).
3. **The restored net immediately earned its keep** — three latent prod bugs
   caught and fixed at root across the PR's own CI rounds:
   - browse-catalog 200-row cap over the 5,000+-row leave-around test DB
     (fixture sorts first + prefix GC + 87 stale rows deleted);
   - heatmap label contrast dead-band (tintFor now picks fg by computed WCAG
     ratio; 4-palette sweep + exact axe cell pinned);
   - factsheet scroll regions not keyboard-focusable (ResponsiveTable idiom
     applied to the whole surface).

## Deferred / handed to Phase 61

- Live verification of the two a11y fixes on authed prod (heatmap cells +
  scroll-region focus) — folded into the Phase-61 canary list alongside the
  6 deferred 58/59 HUMAN-UAT items.

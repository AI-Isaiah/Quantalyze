# Phase 164.2 — deferred items

Out-of-scope discoveries logged during execution. Not fixed here.

## From plan 03 (criterion 9), 2026-09-06

- **`src/app/factsheet-share/[token]/page.tsx:252` makes the time promise criterion 9 removed
  from the v2 page.** Its placeholder body reads "The link works — the strategy's performance
  data is still being computed. Try again in a few minutes." That is the same shape as the
  sentence this plan deleted ("If this persists for more than a few minutes …"): it promises a
  timescale the render arm cannot know, and it renders over a `failed` run as well as a
  still-computing one. Criterion 9 names only the v2 page site (`page.tsx:414-421` in PATTERNS
  §11), so this sibling surface is deliberately NOT touched here. It is a candidate for the same
  copy fix; the share surface has its own lane semantics (token-bearer, not anonymous), so it
  wants its own decision rather than a blind copy-paste.

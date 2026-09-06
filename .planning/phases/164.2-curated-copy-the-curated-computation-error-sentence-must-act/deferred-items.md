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

## From plan 06 (2026-09-06)

- **`.planning/WINDOWS.md` row 37 is out of sync with its fenced JSON.** `gsd_run windows
  append` refuses with: "Ledger table … disagrees with the fenced JSON entries (the sole
  source of truth) for row id(s): 37." Pre-existing and unrelated to this plan — the
  rendered table was hand-edited at some point. NOT fixed here (out of scope; touching
  another phase's ledger row from an executor is exactly the kind of adjacent "improvement"
  the repo rules forbid). Consequence for plan 06: the ledger entry for the UNRUN
  three-reviewer gate could not be appended, so that fact lives only in
  `164.2-06-SUMMARY.md` under `## Three-reviewer gate` and in the checkpoint return.
  Fix by regenerating the table from the JSON block, then re-running the append.

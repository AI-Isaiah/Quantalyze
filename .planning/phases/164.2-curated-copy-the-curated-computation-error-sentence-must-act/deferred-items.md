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

## From plan 07 (2026-09-06) — TWO PRE-EXISTING SUITE FAILURES, both RED at `eee6b1e8`

Both were found by the FULL vitest run this plan owes (`npx vitest run`, 860 files) and
both are PRE-EXISTING: neither touches a file plan 07 wrote, and both reproduce at the
branch tip this plan started from. They are recorded here rather than fixed because each
belongs to a file another plan owns. ⛔ **Both make the `frontend` aggregate RED, so this
branch cannot go green until they are closed.**

- **`check-planning-hygiene` — `SCRATCH-HOME-PATH`, 10 violations, and it is a PUBLIC-REPO
  USERNAME LEAK.** `.planning/phases/164.2-.../164.2-06-PLAN.md:102`,
  `164.2-07-PLAN.md:88,112,131` and `164.2-08-PLAN.md:118` (among ten sites) carry the
  agent scratchpad's absolute path, whose first segment is the founder's local home
  directory name, in a TRACKED file on a PUBLIC repo. The scanner's own message says the
  repair: "Replace the username segment with `<user>`, or the whole directory name with a
  placeholder."
  ⚠️ **NOT a mechanical find/replace, which is why an executor must not do it blind.**
  Those paths sit inside `<verify><automated>` commands that are meant to be RUNNABLE, and
  `164.2-08-PLAN.md` is still PENDING — replacing its path with `<user>` would hand its
  executor a command that cannot run. The real fix is a decision about where plan verify
  blocks put scratch state (a repo-relative ignored dir, or `${TMPDIR}`), taken once for
  the planner template rather than per plan.

- **`verify-plan-anchors --pending` — one stale claim in
  `.planning/phases/164.2-.../164.2-10-PLAN.md:28`**, `[quote-outside-range]` on
  `Do not pick this up before that gate opens`. That quote is anchored at
  `TODOS.md:5040-5055`; commit `eee6b1e8` ("book WIZFORM-02's fifth surface as its own
  item") edited TODOS.md and moved it. Plan 10 owns both TODOS.md and that anchor, so the
  repair belongs to plan 10's own edit rather than to a drive-by line-number bump here.
  ⚠️ Plan 07's own two misses (`164.2-07-PLAN.md:124,126`, one of them the now-correctly-
  stale `FILES_FLOOR = 44`) are NOT in this list: they cleared the moment this plan's
  SUMMARY landed, because `--pending` scans only plans with no sibling SUMMARY.

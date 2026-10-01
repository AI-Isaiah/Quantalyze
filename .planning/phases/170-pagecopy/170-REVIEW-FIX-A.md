---
phase: 170
topic: A (/strategies row)
fixed_at: 2026-10-01T08:55:00Z
review_path: .planning/phases/170-pagecopy/170-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 170: Code Review Fix Report, Topic A (/strategies row)

**Fixed at:** 2026-10-01
**Source review:** `.planning/phases/170-pagecopy/170-REVIEW.md`
**Iteration:** 1
**Scope:** CR-01 and WR-02 only. The other findings belong to the sibling topics B, C and D.

**Summary:**
- Findings in scope: 2
- Fixed: 2 (CR-01: `8bcdc4b71`, WR-02: `173f3cd2f`)
- Skipped: 0
- Routed, not fixed: the committed draft-row e2e case at 768/800 px (see below)

## How the layout was measured

The review's widths were calculated. These were measured in Chromium (Playwright `chromium`), with
DM Sans loaded from Google Fonts. Every run reported `font=DM Sans` in `document.fonts`.

The harness renders the row with the real child components (`Card`, `Badge`, `ShareableLink`,
`StrategyActions`, `NowrapWords`, `Button`) through `renderToStaticMarkup`. They sit inside a copy of
the `DashboardChrome` main column: a 260 px sidebar, `md:ml-[260px]`, `max-w-7xl px-4 py-6 md:px-8`.
The CSS is the project's own `src/app/globals.css`, compiled through `@tailwindcss/postcss`.

- **Bound to the committed code.** The "after" run does not use a hand copy of the row. It reads
  the row, name-block, link and control-group `className` strings from the committed
  `src/app/(dashboard)/strategies/page.tsx`, plus whether `breakOverlong` is passed there. It
  printed:
  `{"row":"flex flex-col gap-3 md:flex-row md:items-center md:justify-between","name":"flex-1 min-w-0 md:min-w-[160px]","link":"font-medium text-text-primary hover:text-accent transition-colors","group":"flex flex-wrap items-center gap-3 md:ml-4 md:min-w-0 md:justify-end","brk":true}`.
  The "before" run used the pre-fix strings
  (`flex-1 min-w-0` / `... md:ml-4 md:shrink-0`, no `breakOverlong`).
- **Rows measured.**
  - `d`: draft, "Alpha Long-Short Beta".
  - `p`: published, the same name.
  - `l`: draft, "Delta-Neutral-Funding-Rate-Arbitrage-BTC" (40 chars).
  - `x`: published, a 62-char hyphenated name.
  - `f`: draft with the `ShareableLink` copy-failed state ("Copy failed — copy the URL manually").
    This is a literal copy of that button, because the 4-second hook state cannot be reached in a
    static render.
- **Not committed.** The harness lives in the gitignored `.claude/` dir of the fix worktree. It is
  evidence for this report, not a gate.

### CR-01: name-block width in px / name overlaps control group

| width | draft `d` before | draft `d` after | published `p` before | published `p` after | copy-failed `f` before | copy-failed `f` after |
|---|---|---|---|---|---|---|
| 390 | 308 / no | 308 / no | 308 / no | 308 / no | 308 / no | 308 / no |
| 640 | 558 / no | 558 / no | 558 / no | 558 / no | 558 / no | 558 / no |
| 768 | **0 / YES** (group 401 px, overflows card) | 160 / no | **0 / YES** | 160 / no | **0 / YES** (group 526 px) | 160 / no |
| 800 | **0 / YES** | 160 / no | **24 / YES** | 160 / no | **0 / YES** | 160 / no |
| 840 | **36 / YES** | 160 / no | 63 / no (< 160) | 160 / no | **0 / YES** | 160 / no |
| 960 | 155 / no (< 160) | 160 / no | 182 / no | 182 / no | **28 / YES** | 160 / no |
| 1024 | 218 / no | 218 / no | 245 / no | 245 / no | 91 / no (< 160) | 160 / no |
| 1280 | 471 / no | 471 / no | 499 / no | 499 / no | 343 / no | 343 / no |

What the measurements show:

- **After the fix**, at 768–960 px the control group wraps its own items. It is 206 px wide at 768,
  238 px at 800 and 278 px at 840.
- **No control item paints outside the group** at 768, 800, 840 or 960. This was checked as
  `itemOvf = false` for every row.
- **390 and 640 px are unchanged.** Those widths stack, and every new utility is `md:`-scoped.
- **The copy-failed state is no longer a residual.** Its button text wraps inside the 160 px floor
  layout.

### WR-02: right edge of the name text vs. the name block (`textRight` / `nameRight`, px)

| width | `l` (40 chars) before | `l` after | `x` (62 chars) before | `x` after |
|---|---|---|---|---|
| 390 | **374 / 349** (25 px past the block, to the card edge) | 349 / 349 | **553 / 349** (viewport is 390) | 349 / 349 |
| 768 | **650 / 317** (block 0 px, CR-01) | 477 / 477 | **829 / 317** | 477 / 477 |
| 960 | **650 / 472** | 477 / 477 | **829 / 499** | 499 / 499 |
| 1280 | 650 / 788 | 650 / 788 | **829 / 816** | 816 / 816 |

**Note on the old 62-char row at 390 px.** `document.scrollWidth` did not grow, because
`#main-content` is `overflow-y-auto`, so its x axis scrolls too. The page did not widen. The main
column got a horizontal scroll instead, which is the SC2 failure.

**AD-13 still holds, checked with a hyphen probe.** "Alpha Long-Short Beta" was rendered in a
120 px box with `breakOverlong`. The `Long-Short` word span has exactly one line box
(`probeLongShortLines = 1`), so it moved to the next line whole and did not break at its hyphen.
Only a word wider than the whole line breaks inside itself.

## Fixed Issues

### CR-01: `/strategies` row, from `md` to about 960 px the name block shrinks to 0 px and the name paints over the controls

**Files modified:**
- `src/app/(dashboard)/strategies/page.tsx`
- `src/app/(dashboard)/strategies/page.share-affordance.test.tsx`
- `.planning/phases/170-pagecopy/170-CONTEXT.md`

**Commit:** `8bcdc4b71`

**Applied fix:** This is the review's first option. The breakpoint stays `md`, so GC-02's "one row
from `md` up" still holds.
- The name block is now `flex-1 min-w-0 md:min-w-[160px]`. That gives it a hard 160 px floor from
  `md` up.
- The control group drops `md:shrink-0` and gains `md:min-w-0 md:justify-end`. It can now shrink and
  wrap its own items.
- `lg` was not chosen, for two reasons. It would flip `e2e/layout-narrow.spec.ts`'s V960 "one row"
  assertion, which is in topic B's file. And at 1024 px the copy-failed row would still get only
  91 px.

**CONTEXT:** GC-02 has a dated amendment line (2026-10-01) with the measured numbers. It says the
breakpoint is unchanged and records the routed e2e case. ROADMAP is left to the orchestrator.

**Test:** The N-STRAT vitest pin now has these checks:
- The name block must carry `flex-1`, `min-w-0` and `md:min-w-[160px]`.
- The group must carry `md:ml-4` and `md:min-w-0`.
- The group must NOT carry `md:shrink-0` or `shrink-0`.
- The WHY comment now states the measured failure.

### WR-02: `NowrapWords` makes a long hyphenated name impossible to break, and on `/strategies` nothing contains the overflow

**Files modified:**
- `src/components/ui/NowrapWords.tsx`
- `src/components/ui/NowrapWords.test.tsx`
- `src/app/(dashboard)/strategies/page.tsx`
- `src/app/(dashboard)/strategies/page.share-affordance.test.tsx`

**Commit:** `173f3cd2f`

**Applied fix:** `NowrapWords` gains an opt-in `breakOverlong` prop.
- **With the prop:** each word span is `inline-block max-w-full [overflow-wrap:anywhere]` and has no
  nowrap. A `whitespace-nowrap` span suppresses every soft wrap, `overflow-wrap` included, so it
  could never have contained the name.
- **Where it is used:** `/strategies` passes the prop.
- **Default unchanged:** the default output is still `whitespace-nowrap`. `StrategyTable`'s name
  sits in a scroller, and an inline-block word would change that table's min-content column width,
  so it keeps the old behaviour.
- **Why not the review's other suggestions:** a length cap or `truncate` would either break a
  fitting hyphenated word or hide the name.

**Tests:**
- `NowrapWords.test.tsx` has a `breakOverlong` case. The spans must carry `inline-block`,
  `max-w-full` and `[overflow-wrap:anywhere]`, must not carry `whitespace-nowrap`, and the
  `textContent` must be unchanged. It uses the 40-char name.
- `NowrapWords.test.tsx` also has a default-path case: the class is exactly `whitespace-nowrap`.
- The N-STRAT pin on `/strategies` now requires `inline-block` on the name's word spans and forbids
  `whitespace-nowrap` there.

## Neuter checks

Each check followed the same steps:
1. Take a `cp` byte backup into the harness dir.
2. Revert the fix in place with `sed`.
3. Run the pin.
4. Restore from the backup.
5. Confirm with `cmp` that the restored file matches the backup, then re-run green.

`git checkout --` was not used.

| neuter | test run | result |
|---|---|---|
| CR-01: group back to `md:shrink-0` | N-STRAT pin | RED `expected [ 'flex', 'flex-wrap', …(4) ] to include 'md:min-w-0'` |
| CR-01: name floor `md:min-w-[160px]` removed | N-STRAT pin | RED `expected [ 'flex-1', 'min-w-0' ] to include 'md:min-w-[160px]'` |
| WR-02: `/strategies` drops `breakOverlong` | N-STRAT pin | RED `expected [ 'whitespace-nowrap' ] to include 'inline-block'` |
| WR-02: `breakOverlong` class falls back to `whitespace-nowrap` | `NowrapWords.test.tsx` | RED, same message (1 failed, 3 passed) |

All four were restored and `cmp`-identical to their backups. The suites were re-run green afterwards.

## Verification

All gates ran in the isolated fix worktree, whose `node_modules` is a symlink to the main
checkout's.

- `npx tsc --noEmit -p tsconfig.json`: exit 0, no output. Run after each fix.
- `npx eslint` on the four touched source/test files: clean.
- `npx vitest run src/components/ui/NowrapWords.test.tsx "src/app/(dashboard)/strategies"`:
  43 files, 807 tests passed.

## Routed, not fixed

**A committed draft-row N-STRAT e2e case at 768 and 800 px.** The review asks for one, asserting a
name ≥ 160 px and no intersection. It belongs in `e2e/layout-narrow.spec.ts`, which is topic B's
file. The existing N-STRAT e2e seeds a **published** row through `setSeededStrategyNameAndTags`.
- **Draft row:** the draft row is the one that measured 0 px.
- **Widths:** V960 is the only `md`+ viewport it covers.
- **Status of this fix:** it is measured by the harness above. It is not yet guarded by a committed
  layout test. The vitest pins guard only the classes.

---

_Fixed: 2026-10-01_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

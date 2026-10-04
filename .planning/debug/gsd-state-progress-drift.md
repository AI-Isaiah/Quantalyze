---
status: diagnosed
trigger: "GSD state/progress is inconsistent (founder, 2026-10-04: 'what's wrong with state? /gsd-debug it')"
created: 2026-10-04
updated: 2026-10-04
---

## Symptoms

- **Expected:** a GSD handler that closes a phase (`gsd-tools phase complete <N>`) leaves STATE.md's
  progress block and `current_phase` correct, and the founder's statusline shows the true milestone
  percent.
- **Actual (measured 2026-10-04, on main at 4cf4c5ff in a fresh worktree):**
  1. `phase complete 164.6.6` rewrote STATE.md progress from `total_phases 94 / completed 70`
     (the hand-maintained figures; the #944 commit message reads "completed_phases 55 -> 69, percent
     floor(69/94 x 100) = 73") to `total_phases 97 / completed_phases 70 / total_plans 490 /
     completed_plans 482 / percent 49`. It also emitted `preservation_warnings: [{field: progress,
     reason: preserved-over-disagreeing-derived}]`. Note 70/97 is 72%, not 49%, so `percent` is
     not computed from phase counts.
  2. The same handler set `current_phase: 164.5.3` (MT5CREDS, an older phase whose VERIFICATION is
     `human_needed` with one open browser QA item) and `status: planning`. The intended next phase
     was 164.6.6.1. #944 hit the same transition ("The handler's transition to 164.5.3 was
     reverted").
  3. The founder's statusline showed `v1.20 Backlog Burndown (Phases 158+) [...] 67%` because the
     primary checkout was on a long-merged branch (`feat/164.4.2-subsetsplit`) whose STATE.md read
     `completed_phases: 32, percent: 67`. Switching that checkout to main fixed the display (74%).
- **Errors:** none; the handlers exit 0. Prior project memory says gsd-tools state handlers clobber
  STATE.md/ROADMAP.md and that `state.add-roadmap-evolution` recomputes `progress:` from local disk,
  under-reporting phases whose `.planning/phases/` artifacts the `-pr` filter stripped from main.
- **Timeline:** recurring; the 164.5.3 transition was already seen and reverted in #944 (2026-10-03).
- **Reproduction:** in a clean worktree at origin/main, back up `.planning/STATE.md`, run
  `node ~/.claude/gsd-core/bin/gsd-tools.cjs phase complete <a phase with VERIFICATION passed>`,
  diff STATE.md. (Do not commit the result.)

## Questions to answer

- Root cause of 94 vs 97 total phases and of 49% vs 74%: which phases does the derived count
  include that the hand count does not (or vice versa), and what formula yields 49?
- Root cause of the transition to 164.5.3: what rule picks the "next" phase?
- Which numbers are RIGHT, and how should STATE be kept correct (a repo-owned fix, since
  `/gsd-update` overwrites global gsd-core files)? The statusline reads which file?

## Current Focus

- bug_class: Bohrbug (deterministic; reproduced byte-for-byte)
- hypothesis: CONFIRMED. Three counters read three different ROADMAP/disk sources and
  the handler stitches them into one block; next phase is the lowest unchecked roadmap
  checkbox numbered below the completed phase.
- next_action: none (diagnose-only). Return ROOT CAUSE FOUND.

## Evidence

- timestamp: 2026-10-04
  checked: reproduction. Throwaway detached worktree at origin/main c01e0fe8 (164.6.6 already
    closed there), `gsd-tools phase complete 164.6.6`. (At 4cf4c5ff the handler refuses: plan 08
    had no SUMMARY yet.) Worktree removed and pruned afterwards; nothing committed.
  found: identical symptom. STATE progress 94/70/477/473/74 -> 97/70/490/482/49,
    `preservation_warnings: [{progress, preserved-over-disagreeing-derived}]`, current_phase
    164.6.6.1 -> 164.5.3, body `Progress: [█████░░░░░] 49%`, `Plan: Not started`, Status
    `Ready to plan`. Only STATE.md and state.json are written.
  implication: deterministic and repeatable at HEAD; the handler and gsd-core version are the
    ones the founder runs.

- timestamp: 2026-10-04
  checked: where `percent: 49` comes from (gsd-core phase.cjs, the `authoritativeProgress` block
    just before `syncAndPreserveStateMd`, plus phase-lifecycle.cjs `deriveProgressFromRoadmap`).
  found: phase complete builds an "authoritative" progress override from the ROADMAP **Progress
    table** in the v1.20 scope: `completed_phases` = rows whose Status cell matches
    `/^complete$/i` EXACTLY, and `percent = round(completed / tableDataRows * 100)`. Probed:
    table = 94 data rows, exact-`Complete` = 46. round(46/94*100) = round(48.94) = **49**.
    The 23 rows written as `Complete — <annotation>` (e.g. `Complete — PR #774`) fail the
    anchored regex, so they count as not complete.
  implication: 49 is neither plan-weighted (482/490 = 98%) nor the frontmatter's 70/97 (72%).
    It is a third ratio from the Progress table's Status cells.

- timestamp: 2026-10-04
  checked: why the written block then shows `completed_phases 70` next to `percent 49`.
  found: `completed_phases` goes through the up-only ratchet (state-document.cjs
    `shouldPreserveExistingProgress` / state-transition.cjs merge): authoritative 46 < stored 70,
    so 70 is kept and the `preserved-over-disagreeing-derived` warning fires. `percent` is not
    ratcheted. The authoritative re-assert writes 49 after the merge. Result: a block whose
    percent disagrees with its own counters.
  implication: the warning means the handler kept 70; the 49 is still written.

- timestamp: 2026-10-04
  checked: where `total_phases 97`, `total_plans 490`, `completed_plans 482` come from
    (state.cjs `buildStateFrontmatter` disk scan + `countRoadmapPhaseHeadings`).
  found: total_phases = count of `#{2,4} Phase <id>:` HEADINGS in the v1.20 ROADMAP scope = 97.
    Plans come from summing PLAN/SUMMARY files across the milestone's phase dirs (490/482).
    `completed_phases` on the disk path = phase dirs whose VERIFICATION is complete
    (`isPhaseComplete`) = **70**. `gsd-tools state json` on the pristine tree derives
    97/70/490/482 with percent **72** = min(482/490, 70/97).
  implication: the disk-and-verification count (70) matches the repo's own rule (complete =
    VERIFICATION passed). Only the denominator is disputed.

- timestamp: 2026-10-04
  checked: heading set (97) vs Progress table rows (94).
  found: headings not in the table: 164.6.6.2, 164.6.6.3, 166.3.1, 170.2 (inserted phases with
    no Progress-table row). In the table but not counted as a heading: 164.10, because its heading is
    `### 📜 Phase 164.10 (ORIGINAL ENTRY, superseded): ...` and the emoji breaks the heading regex.
    94 - 1 + 4 = 97. The union of declared v1.20 ids is **98**. Retired 165, 165.1, 165.2 are in
    BOTH counts: they are not struck through (`~~Phase 165~~`), so
    `extractRetiredPhaseNumbers` returns the empty set.
  implication: GSD's 97 includes 3 phases that can never complete, so it can never reach 100%.

- timestamp: 2026-10-04
  checked: table completion vs verification completion, per row.
  found: only three rows disagree: 164.10 (`Closed by decision`, no dir), 165 (RETIRED, no
    dir), and **170** (table says `In Progress`, but its VERIFICATION is complete on disk and
    STATE's body says COMPLETE 2026-10-01). Of the 24 incomplete-by-verification phases, 165.1
    and 165.2 are retired. The rest are real open work (164.5.3, 164.6.2 and 164.6.5 are
    human_needed; the others have no VERIFICATION).
  implication: with the Status cells normalised and the 170 row fixed, the table would also say 70.

- timestamp: 2026-10-04
  checked: next-phase selection (phase.cjs, stage 3 of the next-phase cascade, #2028/#3350).
  found: stages 1 and 2 pick the numerically next phase above 164.6.6 (164.6.6.1). Stage 3 runs
    unconditionally and scans the milestone scope for `- [ ] Phase X:` checklist bullets.
    If any unchecked phase is numbered BELOW the completed one, it OVERRIDES with the
    numerically lowest such phase. Unchecked in scope (19): 164.5.3, 164.6.2, 164.6.5,
    164.6.6.1, ... The lowest one below 164.6.6 is **164.5.3** (line 104, `- [ ] **Phase 164.5.3: MT5CREDS**`
    ... `verification: human_needed`). Searched the whole of gsd-core bin/ and workflows/: the only
    `--no-transition` is an `execute-phase` WORKFLOW argument (autonomous.md), which skips the
    transition workflow. `phase complete` itself has no flag that skips the next-phase selection.
  implication: by design, any `human_needed` phase whose checkbox stays unchecked becomes the
    handler's "next phase" for every later completion. It will recur on every `phase complete`
    while 164.5.3, 164.6.2 or 164.6.5 stay unchecked.

- timestamp: 2026-10-04
  checked: statusline (`~/.claude/settings.json` statusLine runs `node ~/.claude/hooks/gsd-statusline.js`).
  found: `readGsdState(dir)` starts at `data.workspace.current_dir` (fallback `process.cwd()`)
    and walks up to the first `.planning/STATE.md`. It parses the frontmatter `progress.percent`
    and prints it VERBATIM, with no recomputation. `milestone`/`milestone_name` come from the same frontmatter.
  implication: the statusline shows whatever STATE.md the session's working tree has. A
    stale branch checkout gives a stale percent (the 67% case), and a handler-clobbered STATE
    gives 49%.

- timestamp: 2026-10-04
  checked: whether the founder's original pre-#947 run fits the same formula.
  found: at 4cf4c5ff the 164.6.6 Progress row read `Queued — ...`. At origin/main it reads exactly
    `Complete` (the handler flips the Status cell). The original run therefore went 45 -> 46
    exact-`Complete` rows, and round(46/94) = 49. That matches the reported value.
  implication: one formula explains both the original run and the reproduction.

## Eliminated

- hypothesis: percent is plan-weighted (floor(completed_plans/total_plans)).
  evidence: 482/490 = 98%, 473/477 = 99%; neither is 49.
  timestamp: 2026-10-04
- hypothesis: percent is min(plan, phase) fraction of the written counters (the
  `computeProgressPercent` kernel).
  evidence: that kernel gives 72 (`state json`); the 49 is the separate authoritative
    override from the Progress table (46/94).
  timestamp: 2026-10-04
- hypothesis: the 70 completed_phases is a preserved stale hand value that disk disagrees with.
  evidence: the disk/verification scan independently yields 70; only the Progress-table path
    yields 46.
  timestamp: 2026-10-04

## Resolution

root_cause: |
  (a) gsd-core's `phase complete` derives the progress block from THREE different sources and
  merges them field by field. total_phases = count of `### Phase X:` headings in the v1.20 scope
  (97: it includes the 4 inserted phases with no Progress-table row, 164.6.6.2, 164.6.6.3,
  166.3.1 and 170.2, and the 3 un-struck retired phases 165, 165.1 and 165.2; it excludes
  164.10, whose heading starts with an emoji). Plans come from the disk PLAN/SUMMARY census
  (490/482). completed_phases is the up-only ratchet over (disk VERIFICATION count 70,
  Progress-table count 46), so 70 is kept and `preserved-over-disagreeing-derived` fires. percent
  is an "authoritative" override computed only from the Progress TABLE:
  round(46 exact-`Complete` Status cells / 94 table rows x 100) = round(48.94) = 49. The 23
  rows written as `Complete — <note>`, and 170 still marked `In Progress`, fail the anchored
  `/^complete$/i`. The hand figure 94 is the Progress-table row count (convention since 156-10:
  phase-weighted, floor).
  (b) Next phase: stage 3 of the cascade overrides "numerically next" (164.6.6.1) with the
  numerically LOWEST `- [ ] Phase X:` checklist bullet numbered below the completed phase. That
  is 164.5.3 (MT5CREDS, unchecked because its VERIFICATION is human_needed). It recurs on every
  close while 164.5.3, 164.6.2 or 164.6.5 stay unchecked.
  (c) Correct v1.20 figures at origin/main c01e0fe8: 98 declared phase ids; 3 retired
  (165, 165.1, 165.2); 1 closed by decision (164.10); 70 complete by VERIFICATION. Phase-
  weighted: 70/94 (closed-by-decision excluded) = 74.47% -> 74, or 71/95 (counted as done) =
  74.7% -> floor 74. The hand **74%** and **completed 70** are right. The hand **94** is right in
  value only by cancellation: the table misses 4 live phases and carries 4 non-completable rows.
  GSD's 97/49 (and `state json`'s 72) are wrong. Plan totals 490/482 (disk) vs 477/473
  (table) differ, but percent does not use them under this repo's convention.
  (d) The statusline is `~/.claude/hooks/gsd-statusline.js`. It reads `.planning/STATE.md`
  frontmatter (`progress.percent`, milestone fields), walking up from the session's
  `workspace.current_dir`, so it shows the CHECKED-OUT working tree's STATE verbatim.
  (e) PROPOSAL (not implemented). A repo-owned re-assert step is needed whatever ROADMAP cleanup
  is chosen, because no data edit fixes both paths:
    - Striking retired bullets/headings (`~~Phase 165~~`) fixes the HEADING count only.
      `deriveProgressFromRoadmap`, the source of the percent override, counts every digit-led
      Progress-table row and has no retired exclusion. 165/165.1/165.2/164.10 would have to leave
      the table, and the Status cells would need normalising to exactly `Complete` with notes in
      another column, plus 170's row fixing and rows added for the 4 inserted phases. Even then,
      (b) is unaffected: 164.5.3's checkbox is CORRECTLY unchecked under the repo's rule. Whether
      the handler converges to the census after such a cleanup is UNMEASURED.
    - So: `scripts/state-census.mjs` (repo-owned, survives `/gsd-update`) computes the v1.20
      census and, with `--write`, re-asserts STATE frontmatter `progress` (and the body
      `Progress:` line) after any gsd-tools state/phase handler. It also restores
      `current_phase`/`current_phase_name` from the pre-run backup, or takes an explicit
      `--current <id>`. Census source: the phase-id SET comes from the union of `### Phase`
      headings (emoji-tolerant) and Progress-table rows in the current-milestone section. The
      retired/closed set comes from table Status (`RETIRED`, `Closed by decision`). COMPLETION is
      `status: passed` in `<id>-VERIFICATION.md`, read from git across refs (`git log --all`/`git
      show`), not from local disk alone, because STATE-LINEAGE records disk counts going short
      wherever the `-pr` filter stripped `.planning/phases/**`. Percent is phase-weighted, floor
      (the 156-10 convention).
    - A `.planning`-reading vitest (e.g. `src/__tests__/state-progress-census.test.ts`) fails
      when STATE frontmatter `progress` disagrees with the census. It is a merge gate, so a
      clobbered STATE cannot land on main. It also names any phase whose heading has no table
      row (today: 164.6.6.2, 164.6.6.3, 166.3.1, 170.2).
    - Wire it into the repo's CLAUDE.md GSD-orchestration rule ("after any handler, run
      `node scripts/state-census.mjs --write` and `git diff`"), replacing today's manual
      back-up-and-revert.
fix: (diagnose-only)
verification: (diagnose-only)
files_changed: []

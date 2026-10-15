# gsd-tools upstream bug reports (drafts, NOT filed)

Drafted 2026-10-15 after the founder's decision "Fix our format + report upstream". This repo
reshaped `.planning/ROADMAP.md` and `.planning/STATE.md` so the handlers stop corrupting them,
and added lint rules 6d, 6e and 7 to `scripts/check-planning-hygiene.ts`. The tool defects
underneath are still there, and each one is drafted below as an issue. Nothing here has been
filed. File each one as its own issue.

**Versions.** Measured on gsd-core **1.16.0** (the installed copy). The same code is in
**1.17.0**: every line cited below is identical there, except `state-transition.cjs`, where the
error return sits at line 1445 instead of 1411. Paths are relative to the package root
(`gsd-core/bin/lib/…`).

**Method.** Each repro was run in a throwaway `git worktree add --detach` copy of this repo, at
`d618c8088` (before the reshape) or at the reshape commit. The changes were read with
`git diff`, and the worktree was removed afterwards. "Before" diffs are the real output on this
repo's files before the reshape.

---

## 1. `state.advance-plan` (and siblings) write the file on an error return

**Where.** `gsd-core/bin/lib/state-transition.cjs:1411` (1.17.0: `:1445`), in `advancePlanCore`:

```js
if (parsedCurrent === null || parsedTotal === null) {
    return { content: reassemble(body), updated: [], data: { error: true } };
}
```

`cmdStateAdvancePlan` (`state.cjs:694`) returns `result.content` from inside
`readModifyWriteStateMd`. The no-op guard there (`state.cjs:~4151`) skips the write only when
the bytes are identical. `reassemble(body)` re-serialises the frontmatter, and the write path then
syncs it (`progress:`, `last_updated`, `state_head`). So any non-canonical frontmatter makes an
error call write the file.

**Repro (1.16.0).** Start from a STATE.md whose frontmatter is not in the tool's canonical form, for
example `gsd_state_version: 1.0` unquoted plus one `# comment` line, and whose Current Position
says `Plan: eight (unparseable)`. Then run `gsd-tools query state.advance-plan`:

- stdout: `{"error": "Cannot read the plan position from STATE.md. …", "reason": "plan_position_unreadable"}`
- `git diff`: 5 lines changed. `gsd_state_version` was re-quoted, the comment line was dropped,
  `last_updated` and `state_head` were rewritten, and `progress.total_plans` and
  `completed_plans` were re-derived (632/621 → 746/738).

This repo recorded the same class seven times between 2026-09-07 and 2026-09-13. In one case it
injected 24 blank lines into a frontmatter comment block. Each time the call returned an error and
wrote anyway.

**Proposed fix.** An error must be a no-op. Return the ORIGINAL `content`, not `reassemble(body)`,
on every `data.error` path in `state-transition.cjs`. Alternatively, have
`readModifyWriteStateMd`'s callers return `content` when `result.data?.error` is set. Add a test
that runs each `*Core` error path on a non-canonical document and asserts it stays byte-identical.

---

## 2. `roadmap.update-plan-progress`: the completion-checkbox regex is unanchored and not idempotent

**Where.** `gsd-core/bin/lib/roadmap.cjs:1351`:

```js
const checkboxPattern = new RegExp(`(-\\s*\\[)[ ](\\]\\s*.*Phase\\s+${phasePattern}${OPTIONAL_PHASE_TAG_SOURCE}[:\\s][^\\n]*)`, 'i');
roadmapContent = replaceInCurrentMilestone(roadmapContent, checkboxPattern, `$1x$2 (completed ${today})`);
```

There are three defects in this one line:

1. **Unanchored.** `-\s*\[ \]` can start anywhere in a line, and `.*` lets `Phase N` sit anywhere
   after the checkbox. The first unchecked line in the milestone that mentions the phase gets
   ticked, which is often a plan bullet, not the phase's own checklist bullet.
2. **Runs onto the next line.** `[:\s]` after the optional tag group can match `\n`, and then
   `[^\n]*` takes the whole NEXT line. The `(completed …)` suffix lands on a line that has
   nothing to do with the phase.
3. **Not idempotent.** Once the wrong line is ticked, the next run ticks the next unchecked line
   that mentions the phase. Every re-run damages one more line.

Compare `phase.cjs:3385`, which `phase complete` uses for the same job. It is anchored
(`^[ \t]*`), requires `Phase N` right after the checkbox (`\]\s*(?:\*\*)?\s*Phase\s+N`), and is
applied one line at a time through the fence-aware `updateBullet`.

**Repro (before diffs, this repo at `d618c8088`).**

- `query roadmap.update-plan-progress 159` ticked a plan of a DIFFERENT phase, because its prose
  says "Phase 159 closure spec":
  ```diff
  -- [ ] 164.3-07-PLAN.md — Phase 159 closure spec: … [wave 2]
  +- [x] 164.3-07-PLAN.md — Phase 159 closure spec: … [wave 2] (completed 2026-10-15)
  ```
- `query roadmap.update-plan-progress 170` ticked 169.4-07 ("re-check after Phase 170 (SC9; was
  169.4-03)"). The tag group took `(SC9; was 169.4-03)`, `[:\s]` took the newline, and the stamp
  landed on the following plan:
  ```diff
  -- [ ] 169.4-07-PLAN.md — integration run + post-deploy browser re-check after Phase 170 (SC9; was 169.4-03)
  -- [ ] 169.4-08-PLAN.md — returns route and its test removed, … (SC11, SC12, D-67; split out of 169.4-04)
  +- [x] 169.4-07-PLAN.md — integration run + post-deploy browser re-check after Phase 170 (SC9; was 169.4-03)
  +- [ ] 169.4-08-PLAN.md — returns route and its test removed, … (SC11, SC12, D-67; split out of 169.4-04) (completed 2026-10-15)
  ```
- `query roadmap.update-plan-progress 164.4.2.1` ticked the phase's own
  `- [ ] TBD (run /gsd-plan-phase 164.4.2.1 to break down)` stub, because "-phase 164.4.2.1"
  matches case-insensitively (see issue 7).

**Proposed fix.** Use `phase.cjs:3385`'s pattern and apply it through `updateBullet`. Also,
either exclude the newline after the tag (`[: \t]` or `(?=[:\s])` with no consuming `[^\n]*`
past it), or drop the trailing capture altogether: the replacement only needs to flip `[ ]` and
append to the same line. Add a regression test with a plan bullet whose prose says "after Phase N
(tag)" and is followed by another bullet.

---

## 3. A phase section ends at ANY `#{1,4}` heading, so a `Plans:` list after an in-phase heading is invisible

**Where.** `gsd-core/bin/lib/roadmap.cjs`:

- `:1238` `planSectionPattern = new RegExp(`${phaseHeadingAnchor}(?:(?!\\n#{1,4}\\s)[\\s\\S])*`, 'i')`
- `:1425` `insertRowsPatternA` and `:1426` `insertRowsPatternB`, both built on the same
  `(?:(?!\n#{1,4}\s)[\s\S])*?` body.

`withPhaseSection` (`roadmap-parser.cjs:1424`, `{ levelBounded: false }`) has the same "ends at
the next heading of any level" rule. Both are also fence-blind, so a `# comment` inside a fenced
shell block ends the section too.

**Effect.** A phase section that puts a heading such as `## Success Criteria` above its `Plans:`
list is common, and it is what a human writing a long phase entry naturally does. Pattern A
cannot reach the bare `Plans:` line, so the code falls back to pattern B. That inserts the "missing"
plan rows right after the bold `**Plans:**` summary line, ABOVE the heading, while the real list
below stays unticked. This repo had 35 phase sections in this shape: 33 with `## Success
Criteria`, plus `### Why this is a phase…` and `## ⛔ SECOND ITEM…`.

**Repro (before diff, this repo at `d618c8088`).** `query roadmap.update-plan-progress 164.4.2.1`:

```diff
-**Plans:** 3 plans
+**Plans:** 3/3 plans complete
+- [x] 164.4.2.1-01-PLAN.md
+- [x] 164.4.2.1-02-PLAN.md
+- [x] 164.4.2.1-03-PLAN.md
 …
 ## Success Criteria
 …
 Plans:

-- [ ] TBD (run /gsd-plan-phase 164.4.2.1 to break down)
+- [x] TBD (run /gsd-plan-phase 164.4.2.1 to break down) (completed 2026-10-15)
```

**Proposed fix.** Bound a phase section by the next PHASE heading, or by the next heading at or
above the phase heading's own level. Either way, an H2 inside an H3 phase must not end it. The
`levelBounded: false` comment explains why sibling `####` phases forced the current rule. Matching
"next heading that is itself a phase heading or a milestone heading" satisfies that case without
cutting off in-phase sub-headings. Make the scan fence-aware, as `updateBullet` already is.

---

## 4. `phase complete` overwrites the Progress table's Status prose; `update-plan-progress` keeps it (#4925)

**Where.** `gsd-core/bin/lib/phase.cjs:3539`:

```js
const statusResult = (0, markdown_table_cjs_1.updateTableCell)(text, rowMatch, 'Status', ` ${(0, phase_status_cjs_1.toRoadmapStatusCell)(phase_status_cjs_1.PHASE_STATUS.COMPLETE).padEnd(11)} `);
```

This replaces the whole cell. `roadmap.cjs:1144-1166` (#4925, routed through #5060's
`matchRoadmapStatusCell`) fixed exactly this in `update-plan-progress`: it owns the leading status
TOKEN only, keeps the operator prose after it, and leaves freeform prose alone. `phase complete`
never got the same fix.

**Repro (after the reshape, this repo).** `query phase.complete 164.6.6.1`:

```diff
-| 164.6.6.1 MT5SCRUB | 8/8 | Complete — L-3 NOT OBSERVED, booked (founder 2026-10-14) | 2026-10-14 |
+| 164.6.6.1 MT5SCRUB | 8/8 | Complete    | 2026-10-14 |
```

The deleted prose was a recorded founder decision.

**Proposed fix.** Use the same three-arm callback as `roadmap.cjs:1158`: an empty or dash cell
gets the token, a leading token is rewritten with its tail kept, and freeform prose is untouched.
Better still, extract it into one shared helper so the two verbs cannot drift apart again.

---

## 5. `_normalizeMd` rewrites the whole file on every write

**Where.** `gsd-core/bin/lib/shell-command-projection.cjs:1056` (`_normalizeMd`), called from
`normalizeContent` (`:1137`) on every `.md` write.

**Effect.** A handler that edits one line also inserts and removes blank lines around headings,
fences and list ends anywhere in the file. The result is a diff in sections the command never
touched, which hides the real change and makes "revert the collateral" a manual job. #3854 and
#4725 already removed one rule ("separate a list from a preceding paragraph") for exactly this
reason. The remaining rules have the same problem.

**Repro (this repo at `d618c8088`).** Run `normalizeContent('.planning/ROADMAP.md', <file>)` on
the unmodified file. It changes **11 lines**, all blank-line moves, with 0 non-blank lines
changed. Every `update-plan-progress` before diff in this document carries those same moves around
phases 164.6.6.3.4, 164.6.6.2, 164.6.6.2.3, 164.9.8, 167.1.2.2, 167.1.2.2.2, 167.1.2.1.1 and
170.6. This repo works around it by committing the normalised form once (commit "normalise
ROADMAP.md once").

**Proposed fix.** Normalise only the lines the command changed, plus one line of context on each
side. Or normalise only on files the tool created itself, never on a document an operator
maintains. Failing both, make it opt-in per command. In all three cases a command that edits one
line should produce a one-line diff.

---

## 6. Missing plan rows are inserted at the TOP of the list, not in sorted position

**Where.** `gsd-core/bin/lib/roadmap.cjs:1427-1429`:

```js
const sortedMissing = [...missingPlans].sort();
const newRows = sortedMissing.map(p => `- [ ] ${p}`).join('\n');
const inserter = (match) => `${match}\n${newRows}`;
```

The missing rows are sorted among THEMSELVES and then inserted directly after the `Plans:` line,
ahead of every existing row.

**Repro (after the reshape, this repo).** Delete `- [x] 164.9.2-03-PLAN.md` from the list, then run
`query roadmap.update-plan-progress 164.9.2`:

```diff
 Plans:
+- [x] 164.9.2-03-PLAN.md

 - [x] 164.9.2-01-PLAN.md
 - [x] 164.9.2-02-PLAN.md
```

The row lands first, above the blank line that separates `Plans:` from its list.

**Proposed fix.** Merge the missing rows into the existing list by plan id, so each row goes
before the first existing row whose id sorts after it. Append at the end only when no existing row
sorts later. Keep the existing list's own spacing.

---

## 7. The inserted-phase stub carries the words the completion regex matches

**Where.** `gsd-core/bin/lib/phase.cjs:1316`, `:1438`, `:1638` write every new phase with:

```
Plans:
- [ ] TBD (run /gsd-plan-phase N to break down)
```

**Effect.** Combined with issue 2, `-phase N` matches `Phase\s+N` case-insensitively, so the stub
is a valid target for the completion regex of its own phase. It was ticked on this repo
(`164.4.2.1`, before diff in issue 3). A stub that is left in place after the phase is planned
also contradicts the real plan list.

**Proposed fix.** Write `- [ ] TBD — plans not listed yet` (no "phase N"), and have plan-phase
replace the stub when it writes the plan rows. Fixing issue 2 alone also removes the match.

---

## What this repo changed instead (for the issue text)

- ROADMAP: the in-phase headings became bold fields (`**Success Criteria** (what must be
  TRUE):`). The TBD stubs became plan rows or `- [ ] TBD — plans not listed yet`. Two plan bullets
  stopped saying "Phase N". The file was normalised once.
- STATE: `## Current Position` holds one line per field, and its log moved to `STATE-LINEAGE.md`.
- `.planning/milestone.lock` was untracked, since it is a runtime lock that `phase complete`
  rewrites or deletes.
- `scripts/check-planning-hygiene.ts` rules 6d, 6e and 7 fail lint if any of these shapes comes
  back.
- After the reshape: `update-plan-progress 159` is a no-op. `170` and `164.4.2.1` change only
  their `**Plans:**` count and real plan ticks. `state.advance-plan` changes `Plan: 8 of 9` to
  `9 of 9` plus frontmatter sync. The issues above remain for any project that has not reshaped.

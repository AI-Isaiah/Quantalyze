# STATE lineage — Census-Methode, Clobber-Protokoll und historische Notizen

> ⛔ **Diese Zeilen standen bis 2026-09-17 im YAML-Frontmatter von `.planning/STATE.md`
> und wurden von jedem STATE-Schreiber zerstört.** Gemessen an jenem Tag: 93 injizierte
> Leerzeilen, davor protokolliert 92, 92, 70, 59.
>
> ⛔ **Sie gehören NICHT zurück nach `STATE.md` — auch nicht unter das Frontmatter.**
> Gemessen 2026-09-17: nach dem Verschieben in den Body injizierte derselbe Handler
> erneut 94 Leerzeilen, beginnend bei Zeile 33 bei einem Frontmatter, das nur bis
> Zeile 19 reicht. Der Handler normalisiert die GANZE Datei und setzt hinter jede
> `#`-Zeile eine Leerzeile — eine YAML-Kommentarzeile ist für ihn eine Überschrift.
> Nur eine Datei, die kein STATE-Handler schreibt, ist sicher. Das ist diese hier.

Inhalt byte-identisch übernommen, nur verschoben.

---

## ⛔ SUPERSEDED 2026-09-17 — the hand-set `progress:` block below is LINEAGE, not a live value

On 2026-09-17 `phase.complete 164.5.1` recomputed `progress:` from 38/20/175/166/54 to
**42/19/195/188/45, and the recomputation was KEPT** — the first time in this file's history that a
handler write was not reverted. It was kept because it was re-measured and found to be RIGHT:

- `total_phases` **42** — the v1.20 ROADMAP section really carries 42 `### Phase` rows
  (158…168, 165). The hand-set 38 had missed four insertions.
- `total_plans` **195** / `completed_plans` **188** — the hand-set 175/166 was a delta chain last
  rolled forward 2026-09-13 and had fallen 20 and 22 behind.
- `completed_phases` **19** — driven by ONE rule, read from `gsd-core/bin/lib/verification.cjs`
  (`isPhaseComplete`): *"`complete` is exactly `verification.status === 'passed'`"*. It never reads
  plan counts and never reads the ROADMAP checkbox. The phases short of it are real work, not a
  counting artefact: `164.1`, `164.8.2` and `164.5.1.1` have no `*-VERIFICATION.md` at all, and
  `161`, `162`, `164.5`, `164.6.2` sit at `human_needed`.

⛔ **The block's founding premise is also FALSE and was re-measured.** It exists to defend against
an under-count caused by the `-pr` filter stripping `.planning/phases/**` from main. 27 of that
filter's 28 deleted files are BACK, and all four phases it cites (164.2, 164.5, 164.8.2, 164.8.5)
are fully present on disk.

⛔ **Do NOT restore the hand-set numbers.** Every closed phase now raises `completed_phases` by
one automatically — observed twice on 2026-09-17 (restoring `164.8.1-VERIFICATION.md` moved it
17 → 18; the verifier writing `164.5.1-VERIFICATION.md` moved it 18 → 19). Everything below this
line is kept for the record of how the numbers were maintained by hand until now.

```
# ⭐ progress: RE-DERIVED 2026-09-12 at `733a55f5` from ALL REFS — see the method block
# immediately above the `progress:` keys below. This supersedes the HAND-SET note that stood
# here from 2026-09-06: the values are no longer hand-set and are no longer taken from this
# checkout, which is exactly why they moved (31/15/141/137 -> 33/19/163/160).
# ⚠️ `percent` is PHASE-weighted and always has been. 53 means 19 of 36 PHASES (Phases 164.6.1/.2/.3
# were inserted 2026-09-12, so the denominator grew by three and the percent FELL without
# any work being lost — the same effect recorded for the 2026-09-06 insertions); the PLANS
# are 160 of 163, i.e. 98%. Do not read `percent` as a plan figure.
# ⚠️ HISTORICAL, kept as lineage — everything below this line describes the 2026-09-06 state:

# This branch is 1 commit behind main and is missing d679f638, so four SHIPPED phase

# directories (164.1, 164.3.1, 164.4, 164.4.1) are empty HERE — the previous values

# (completed_phases 4, total_plans 70, completed_plans 66, percent 20) were derived from

# that incomplete tree and were wrong. Census taken with

# `git ls-tree -r --name-only origin/main .planning/phases/`:

#   total_plans 107 = 158:6 159:7 160:7 161:10 161.1:5 162:9 163:9 164:7 164.1:6

#                     164.3:10 164.3.1:13 164.4:12 164.4.1:6   (164.2/164.2.1/164.5/

#                     164.6/164.7/165/166 author none yet)

#   completed_plans 104 = the same list by SUMMARY count; the 3 shortfalls are

#                     159 (7/6), 160 (7/6) and 164.3 (10/9, plan 07 is 164.3-07-DEFERRED.md)

#   completed_phases 10 = plans>0 AND summaries==plans: 158 161 161.1 162 163 164 164.1

#                     164.3.1 164.4 164.4.1

#   percent 50 = phase-weighted (completed_phases/total_phases), the convention this file

#                fixed at the 156-10 reconciliation — NOT plan-weighted

# ⛔ Do NOT run `state.update-progress` or `state.begin-phase` from this checkout to "fix"

# these: both recompute from local disk and would write the depressed numbers back, and

# begin-phase additionally overwrites the Status:/Last activity:/Plan: prose below with

# template boilerplate and drops `state_head` (measured in a sandbox copy 2026-09-06).

# Merge origin/main first; then a handler-derived recount is trustworthy.

# ⛔ RE-SET 2026-09-06 (second time today). `state.add-roadmap-evolution` — run for the

# Phase 164.8 insertion — ALSO recomputed this block from local disk as an undocumented

# side effect, writing 21/7/101/96/33. The ⛔ above names `state.update-progress` and

# `state.begin-phase`; add-roadmap-evolution belongs on that list. Its numbers were wrong

# for the reason this whole block exists: PR #749 shipped from the FILTERED branch, so

# `origin/main` carries only `.gitkeep` for `164.2-curated-copy-*` and a disk census

# cannot see that phase's plans at all until /gsd-complete-milestone archives them.

# Delta applied on top of the 2026-09-06 census above, MEASURED not assumed with

# `git ls-tree -r --name-only origin/phase-164.2-curated-copy .planning/phases/`:

#   164.2 = 10 PLAN.md + 10 SUMMARY.md  (the census predates the phase and read "none yet")

#   total_plans     107 + 10 = 117

#   completed_plans 104 + 10 = 114

#   completed_phases 10 + 1  = 11   (164.2: plans>0 AND summaries==plans)

#   total_phases     20 + 1  = 21   (Phase 164.8 TESTPREPROD inserted 2026-09-06)

#   percent 52 = 11/21 phase-weighted, the convention this file fixed at 156-10

# ⚠️ 164.2's plan files live ONLY on `origin/phase-164.2-curated-copy` (pushed as the

# audit copy) until milestone archival moves them to main. A census against origin/main

# alone will keep under-reporting by 10 plans / 1 phase until then.

# ⛔ HAND-SET AGAIN 2026-09-07 for Phase 164.2.1 (2 plans, 2 SUMMARYs on disk):

#   total_plans 117 + 2 = 119 · completed_plans 114 + 2 = 116

#   completed_phases 11 + 1 = 12 (164.2.1: plans>0 AND summaries==plans)

#   percent 57 = 12/21 phase-weighted

# ⚠️ CUMULATIVE CLOBBERER LIST — handlers MEASURED rewriting this block from local

# disk during phase 164.2.1: state.update-progress, state.begin-phase,

# state.add-roadmap-evolution, state.add-decision, state.record-metric,

# state.record-session. That is SIX, and it includes the executor's own standard

# state-update step — GSD's normal flow calls a handler this file forbids from

# this checkout. Restore by hand after any handler call; do not assume a handler

# is safe because an earlier note called it safe (that claim was itself wrong).

# ⛔ RE-SET 2026-09-07 (164.2.1 plan 01 execution). TWO MORE handlers clobbered this block

# from local disk, both writing 21/7/103/97/33: `state.update-progress` (named above, run

# by the executor's standard state-update step before reading this banner — the standard

# step and this prohibition are in direct conflict, and this banner wins) and

# `state.add-decision`, which is an APPEND handler and has no business recomputing

# anything. The ⛔ list is therefore: update-progress, begin-phase, add-roadmap-evolution,

# add-decision. `state.record-metric` and `state.record-session` were run in the same

# session and did NOT touch it. Values restored to the 2026-09-06 census both times.

# ⛔ RE-SET 2026-09-07 (Phase 164.5 wave 1). `state.advance-plan` BELONGS ON THE ⛔ LIST and

# was not on it. FOUR of four wave-1 executors ran it from their own worktrees and ALL FOUR

# reproduced the same failure independently: it returns

# {"error":"Cannot parse Current Plan or Total Plans in Phase from STATE.md"} AND WRITES ANYWAY.

# One measured 31 added / 7 removed, of which 24 were blank lines injected into this census

# block. `state.update-progress` clobbered alongside it in the same runs, overwriting the

# hand-set 123/126/62 with 97/109/32 derived from an incomplete worktree.

# ⭐ THE GENERAL RULE, now measured four times over three phases: A FAILED HANDLER CALL IS NOT A

# NO-OP HERE. An error return says nothing about whether the file was written. Check the diff,

# never the exit status.

# ⛔ FULL LIST as of 2026-09-07: update-progress, begin-phase, add-roadmap-evolution,

# add-decision, record-metric, record-session, advance-plan. That is SEVEN, and it includes the

# executor's standard state-update step. This banner wins over that step.

# ⚠️ Restore with `git show HEAD:.planning/STATE.md` + `cp`, NOT `git checkout --` — the latter

# destroys any uncommitted work in the file it restores.

# ⛔ CORRECTION 2026-09-07 (164.2.1 plan 02 execution). The last sentence above is FALSE as

# measured today: `state.record-metric` AND `state.record-session` BOTH clobbered this block,

# each writing 21/7/103/98/33 (98 not 97 — plan 02's SUMMARY is now on disk, so the local

# recount moved). `record-session` even ENUMERATES what it wrote: its JSON response lists

# `progress.total_phases`, `progress.completed_phases`, `progress.total_plans`,

# `progress.completed_plans`, `progress.percent` among the fields it touched. Whether plan 01

# mis-attributed or the SDK changed is not established — what IS measured is that NO state

# handler may be assumed safe. ⛔ TREAT EVERY `state.*` HANDLER AS A CLOBBERER: re-read these

# five lines after every single call and restore them. Known-clobbering list, cumulative:

# update-progress, begin-phase, add-roadmap-evolution, add-decision, record-metric,

# record-session. Values restored to the 2026-09-06 census after each of the two calls.

# ⚠️ HAND-SET AGAIN 2026-09-07 (phase 164.7 planning). Deltas, each with its source:

#   completed_phases 12 -> 13   — 164.2.1 SESSIONID-FENCE merged as 14dc1f5e (PR #752).

#   completed_plans  116 -> 118 — 164.2.1's TWO plans, counted with

#                                 `git ls-tree -r phase-164.2.1-sessionid-fence` because

#                                 `.planning/phases/164.2.1-*/` DOES NOT EXIST on main:

#                                 the `-pr` filter strips phase artifacts, so they reach

#                                 main only at milestone archival. Counting from disk on

#                                 this branch would have silently undercounted by 2.

#   total_plans      119 -> 126 — 164.7's seven plans, checker PASS WITH CONCERNS at 65d1248c.

#   percent          57 -> 62   — 13/21.

# 2026-09-07 (later): completed_plans 118 -> 123 — 164.7 plans 01-05 executed, merged and

#   RE-VERIFIED BY THE ORCHESTRATOR on the merged tree (full corpus exit 0: files 46/73,

#   arms 380/380/0, biting 380, tallies agree, no defects). Plans 06/07 are human gates,

#   so completed_phases stays 13 and percent stays 62 — the PHASE is NOT complete.

# ⛔ The six clobbering handlers named below still must not be run from this checkout; the

# 164.2.1 stripping above is a NEW, independent reason they would produce wrong integers.

# ⛔ SEVENTH CLOBBERER, MEASURED 2026-09-07 (164.7 plan 01 execution, worktree agent-aaff4983):

# `state.advance-plan` clobbers this block TOO — and it does so while RETURNING AN ERROR

# ("Cannot parse Current Plan or Total Plans in Phase from STATE.md"). It wrote 7/108/97/33

# over 13/126/118/62 and inserted a blank line after every comment line above. A failed

# handler call is NOT a no-op. Restored by hand. Cumulative list is now SEVEN:

# update-progress, begin-phase, add-roadmap-evolution, add-decision, record-metric,

# record-session, advance-plan. The 164.7 executors therefore SKIPPED the standard

# state-update step entirely, per this banner's own rule that it wins over that step.

# ⚠️ HAND-SET AGAIN 2026-09-10 (Phase 164.8.2 ship). The block below was found CLOBBERED at
# 28/8/116/108/29 — disk-derived numbers, the eighth reset this banner records. Restored and
# re-censused, every integer with its source:
#   total_phases     21 -> 29  — MEASURED, not assumed: `awk` over the v1.20 section of
#                                ROADMAP.md counts 29 `### Phase` headers. The eight added
#                                since 2026-09-07 are 164.5.1, 164.5.2, 164.8.1, 164.8.2,
#                                164.8.3, 164.8.4, 164.9, 164.10.
#   total_plans      126 -> 141 — 126 baseline + 164.8's 6 + 164.8.1's 4 + 164.8.2's 5.
#                                The baseline reproduces EXACTLY from
#                                `git ls-tree -r --name-only origin/main .planning/phases/`
#                                (107 main-visible) + 164.2's 10 + 164.2.1's 2 + 164.7's 7,
#                                which also CONFIRMS 164.5 and 164.6 have authored none.
#   completed_plans  123 -> 137 — + 164.8's 6 SUMMARYs, + 164.8.1's 3 (the census reads S=3
#                                against P=4; the ROADMAP calls it 4/4 and the disk does not
#                                agree — counted CONSERVATIVELY at what is measurable),
#                                + 164.8.2's 5.
#   completed_phases 13 -> 15   — 164.8 (6/6) and 164.8.2 (5/5) satisfy plans>0 AND
#                                summaries==plans. 164.8.1 does NOT under that rule (4 vs 3).
#                                164.7 stays out: plans 06/07 are human gates and no new
#                                evidence says they closed.
#   percent          62 -> 52   — 15/29 phase-weighted, the convention fixed at 156-10.
#                                It FELL because eight phases were inserted, not because work
#                                was lost — a lower percent here is the roadmap growing.

# ⭐ RE-DERIVED 2026-09-12 at `733a55f5` — and for the first time NOT from local disk.
#    Every previous value in this block was hand-set or handler-computed against this checkout,
#    where the `-pr` filter has stripped `.planning/phases/**` for four COMPLETE phases (164.2,
#    164.5, 164.8.2, 164.8.5 = 29 finished plans). Any count taken from disk is short by those.
#    Method, re-runnable: enumerate every PLAN/SUMMARY path ever added under `.planning/phases/`
#    across ALL REFS (`git log --all --diff-filter=A --name-only`), drop the ones whose newest
#    history event is a deletion, then EXEMPT deletions made by the `-pr` filter commit
#    (`22a5fe96 chore(pr): strip transient .planning/phases artifacts from the review diff`) —
#    a filtered artifact is stranded, not withdrawn. A phase counts complete when plans>0 and
#    every live plan index carries a SUMMARY.
#
#   total_phases     31 -> 33   — the roadmap's actual v1.20 row count, 158 through 168.
#   total_plans     141 -> 163  — three plans are WITHDRAWN and correctly excluded from every
#                                denominator, each with a commit saying so: 162-10 (`3fa26831`,
#                                premise false), 164.4-12 (`9b83b064`, replanned 13 -> 12),
#                                164.5-08 (`7910f614`, LIFTED into new Phase 164.5.2).
#   completed_plans 137 -> 160  — the 3 live plans with no SUMMARY are 159-01 (its deliverable
#                                `159-CENSUS.md` is on disk), 160-07 (a gap_closure plan whose
#                                own output `160-VERIFICATION.md` reads `status: passed`), and
#                                164.3-07 (the founder-deferred VAC-07). None is unfinished work.
#   completed_phases 15 -> 19   — + 164.2 (10/10), 164.5 (7/7), 164.8.5 (7/7), 164.8.6 (8/8),
#                                164.7 (7/7, finalized v0.77.32.1), 164.8.1 (4/4 — the 04-SUMMARY
#                                is STRANDED off main, not missing; the 2026-09-11 note above
#                                counted it conservatively at 3 and that was the disk lying),
#                                164.2.1 (2/2). 164.3 (9/10) stays OUT: one deliberate deferral.
#   percent          48 -> 58   — 19/33 phase-weighted, the convention fixed at 156-10.
#                                ⚠️ `percent` has ALWAYS been PHASE-weighted, never plan-weighted.
#                                Read beside `completed_plans`/`total_plans` it invites the
#                                opposite reading — 160/163 of the PLANS are done, 98%.

# ⭐ ROLLED FORWARD 2026-09-13 from the 2026-09-12 ALL-REFS census at `733a55f5` — a DELTA,
# not a fresh census. The handler `phase.complete` reset this block to disk-derived
# 37/14/141/135/38 (the TWELFTH recorded clobber); reverted from a byte backup. Every delta
# below is measured, and the base is the verified 36/19/163/160/53:
#   total_phases     36 -> 37  — Phase 164.11 DEPLOYGATE inserted 2026-09-13, after the census.
#   completed_phases 19 -> 20  — Phase 164.8.3 PROBERAUTH, 4/4 with a passed VERIFICATION.md.
#   total_plans     163 -> 167 — 164.8.3's four PLANs. MEASURED as new: `git log --all
#                                --diff-filter=A` dates all four to `22210879` 2026-09-13
#                                18:25, AFTER the 2026-09-12 20:53 census sha, so they cannot
#                                already be inside the 163.
#   completed_plans 160 -> 164 — the same four, each with a SUMMARY on disk.
#   percent          53 -> 54  — 20/37 phase-weighted, the convention fixed at 156-10.
# ⚠️ Still PHASE-weighted. The PLANS are 164 of 167, i.e. 98%.

# ⭐ ROLLED FORWARD 2026-09-13 (Phase 164.6.2 plan 01) — again a DELTA off the verified base,
# not a fresh census, and again applied BY HAND because `state.update-progress` reset the block
# to disk-derived 37/14/145/136/38 (the THIRTEENTH recorded clobber; restored from a `cp` byte
# backup, RESTORE-CMP-OK). Every delta is measured:
#   total_plans     167 -> 171 — Phase 164.6.2's FOUR PLANs. MEASURED as new, not assumed:
#                                `git log --all --diff-filter=A` dates all four to `2eb79d09`
#                                2026-09-13 22:31, i.e. AFTER the 2026-09-12 20:53 census sha
#                                AND after the 164.8.3 delta above, so they cannot already be
#                                inside the 167.
#   completed_plans 164 -> 165 — 164.6.2-01-SUMMARY.md, on disk with `status: complete`.
#   total_phases     37        — UNCHANGED. Phase 164.6.2 was inserted 2026-09-12 and the
#                                census note above already records that insertion in the 36->37
#                                denominator; only its PLANs are new.
#   completed_phases 20        — UNCHANGED. 1 of 4 plans.
#   percent          54        — UNCHANGED (phase-weighted, 20/37).
# ⚠️ SCOPE OF THIS DELTA, stated so the next reader does not over-trust it: only Phase 164.6.2's
# artifacts were re-measured. Phases 164.6.1 and 164.6.3 also authored plans after the census
# (164.6.3-01 has a SUMMARY — see the Session block) and were NOT measured here, so the
# denominator may still be short by those. ⛔ Fix that with a fresh ALL-REFS census, never by
# running `state.update-progress`, which derives from THIS checkout and is blind to the
# `-pr`-filtered phases by construction.
```

## 2026-09-27 — `progress:` recomputed by the tool, and why it had stopped moving

The block moved from 54/35/310/299/65% to **72/40/353/347/56%**. The numbers are the output of `gsd-tools query state.update-progress`, run at `78d9a9a2`, not a hand edit. The tool ran cleanly on main: it touched only the `progress:` block and the body's `Progress:` line. `.planning/phases/` is on main now, so the old warning against running it (the `-pr` filter stripped the phase artifacts) no longer holds.

**Root cause of "stuck at 67%":** `/gsd-autonomous` recomputes progress when a phase completes. `phase complete` ticks the checkbox and runs this update. Since 2026-09-17 phases have been closed by hand on their own branches: the checkbox was ticked by hand and the complete step was never run. Nothing recomputed the block, so it only moved when someone typed it. The status-line bar reads this block, and on a checkout sitting on an old branch it reads that branch's copy.

⚠️ The tool counts 165, 165.1 and 165.2 in the 72 total because their phase directories still exist, although the founder retired them. That under-states the percent by about 2 points, and it is left as the tool reports it.

Rule from here: when a phase's verification flips to `passed` on main, run `phase complete <N>` in a checkout of main, `git diff` the result, keep only its intended lines, and ship that with the phase's paperwork.

## 2026-10-15 — the `## Current Position` log, moved out of STATE.md

Moved here verbatim, nothing deleted. Until 2026-10-15 `STATE.md`'s `## Current Position` was a ~840-line append-only log: 28 `Phase:` lines that `state.advance-plan` read as candidates (29 counting an indented RETAINED one), 13 `Plan:` lines and RETAINED blocks carrying old `Status:`, `Last activity:` and `Progress:` lines. The gsd-tools STATE handlers replace the FIRST line that carries each label (`stateReplaceField` in `gsd-core/bin/lib/state-document.cjs`), and `state.advance-plan` refused outright on the 29 `Phase:` candidates. `STATE.md` now keeps one line per field; the log below is history.

The frontmatter was brought in line with the new single position in the same commit. Its previous values were `current_phase: 164.6.6.1`, `current_phase_name: MT5SCRUB`, `stopped_at: 164.6.6.1 re-planned 2026-10-04 after the scrub spike (8 plans, 6 waves, plan-check passed); next execute, plan 02 S-11 checkpoint first`, `last_activity: 2026-10-04` and `last_activity_desc: Phase 164.6.6.1 execution started`.

Everything below this paragraph, down to the end of this section, is the old section body byte for byte.

⭐ **RECONCILED 2026-09-18 (164.1.1.1 plan 02, FINAL PLAN OF THE PHASE). THIS block is the
current position and SUPERSEDES the 164.1.1.1-plan-01 block immediately below (retained as
lineage). Phase 164.1.1.1 (LANEONLYGATES) is now 2/2 plans DONE; ROADMAP.md's Plans line and
both checkboxes updated to match. Not yet marked `completed_phases` in the frontmatter above —
no VERIFICATION.md exists for this phase yet, and this repo's own rule is that phase completion
is decided by verification status, never by plan counts.**

Phase: 164.6.6.1 (MT5SCRUB) — EXECUTING
Phase: 164.6.6.3.5 (DOMAINONE) — COMPLETE 2026-10-08 (plan 13 live checks done; VERIFICATION passed; PR #971 v0.127.0.0; records via docs/2026-10-08-records)
Phase: 164.5.3 (MT5CREDS) — COMPLETE 2026-10-08 (VERIFICATION passed at verified_at_sha 52928d95; item 1 visual QA passed in the founder's production session, item 2 routed to 164.6.5, item 3 passed from CI history; records via docs/2026-10-08-records)
Phase: 164.6.2 (MT5RELOGIN) — COMPLETE 2026-10-06 (plan 06 settled question THREE as STALE; VERIFICATION passed, verified_at_sha ad37851d; ships with the chore/close-164.6.5-165 PR)
Phase: 164.9.6 (SUBSETMAIN) and 164.5.2.1 (BRIDGERESIDUE) — COMPLETE 2026-10-03 (verification passed; PR #936 v0.120.0.0 and PR #937 v0.121.0.0 merged; migration 20261003120000 applied to TEST and PROD)
Phase: 164.9.4 (CIOFFMUTEX) — COMPLETE 2026-10-03 (verification passed on the ship run 37072653692; PR #880 merged, v0.119.0.0)
Phase: 160 / 164.3 / 168 — close-out 2026-10-03 (SECURITY.md for 160 and 164.3; verification frontmatter to convention; 164.3 plan 07 stays deferred)
Phase: 164.9.3.2.1 (ENQ40001) — COMPLETE 2026-10-02 (verification passed; PR #929 merged, v0.118.1.5; no migration)
Phase: 160 / 168 / 164.3 leftover plans — CLOSED 2026-10-02 (160-07 PROD smoke 2/3 surfaces; 168-03 observed on the re-created composite; 164.3-07 superseded by 164.5-07)
Phase: 164.9.3.2 (DEFER40001) — COMPLETE 2026-10-02 (verification passed; PR #919 merged, v0.118.0.0; migration applied to TEST and PROD by Supabase Migrate run 36981647441)
Phase: 169.1.1 (HYDRATIONTICKS) — COMPLETE 2026-10-02 (verification passed; PR #925 merged, v0.118.1.0)
Phase: 166.4 (BENCHALIGN) — COMPLETE 2026-09-27 (verification passed; PR #892 merged, v0.108.0.0)
Phase: 170 (LAYOUT — page layout reads clean and holds on every page) — COMPLETE 2026-10-01
Plan: 1 of 8
Phase: 164.9.5 (AUTOREDUMP) — EXECUTING
Plan: 9 of 9 DONE; VERIFICATION human_needed (4/6 verified, 2 live-only), SECURITY SECURED 37/37; shipped as a PR, not merged
Phase: 166.2 (COMPUTEONCE) — EXECUTING
Plan: 1 of 7
Phase: 166.1 (ENGINEFLOOR) — EXECUTING
Plan: 4 of 4
Phase: 166 (QSTATS-TRUTH — every quantstats-derived number reflects the returns it was given) — READY TO EXECUTE
Plan: Not started
Phase: 168 (DRBOPTIONS — a Deribit options account ingests end to end) — EXECUTING 2026-09-26, 3 plans; plan 03 is a founder post-deploy checkpoint
Plan: 2 of 3 DONE (`168-01-SUMMARY.md`: `assignment` cash-bearing in the census shape only, `assert_assignment_uncontested` in both twins, `_OPTION_BOOK_EVENT_TYPES` at the six literal sites in one commit, windowed-crawl backstop in `_crawl_deribit_ledger`, counts-only evidence file; `168-02-SUMMARY.md`: one pin per option-book site, each seen RED under a one-site revert, mark_to_market and smoothed_mtm end to end, `check_perp_only_eligibility` reads `_OPTION_BOOK_EVENT_TYPES`, `_SIBLING_TYPES` + assignment, `_SHAPE_FIELDS` + commission/position, prose sweep, full suite green). Next is plan 03, a founder post-deploy checkpoint.
Phase: 164.5.2 (BRIDGELOCK — the per-strategy advisory lock 161.1-D1 asked for, in its own phase as DEC-4 required (INSERTED)) — EXECUTED, verification human_needed, PR open (merge after #870)
Plan: 3 of 3 DONE
Phase: 164.6 (gate-hygiene-ops-08-f9-sentinel-plus-the-two-ci-yml-integers) — EXECUTING
Plan: 5 of 5 DONE (`164.6-01-SUMMARY.md`, OPS-08-TS: a 40001 is retried once at csv-finalize and holdings sync; `164.6-02-SUMMARY.md`, 161.1-D13 TS half: keys/sync and finalize-wizard retract an inherited ledger-refresh marker; `164.6-03-SUMMARY.md`, OPS-08-F2 SQL layer: migration 20260924120000 makes both fan-outs write one counted cron_runs row naming failed candidates, arm N in both ledger gates, 36 twins re-pointed; `164.6-04-SUMMARY.md`, OPS-08-F2 pins: ARMS_FLOOR 428 from a full lane run with no defects, parser/floors/registry censuses at 428 arms and 443 steps/needles, ci.yml sentinel rows 16/19 and ARMS_FLOOR 215; `164.6-05-SUMMARY.md`, runbooks read the candidate_enqueue_failed row counts-only and carry the BLOCKING precondition [164.6-COMPOSITE-CLAIMTIME-SNAPSHOT] owned by Phase 164.6.7, phase-level vitest/typecheck/lint/anchors green)
      ⚠️ RETAINED — the three lines below were this block's own `Phase:`/`Plan:` lines
      until `state.begin-phase` overwrote them in place on 2026-09-20. They are indented
      so a future handler cannot match them again; their continuation prose follows unbroken.
      Phase: 164.8.4 (GATERESIDUE) — READY TO EXECUTE
      fixture) — EXECUTING (2/2 plans done, verification not yet run)
      Plan: 2 of 2 DONE (`164.1.1.1-02-SUMMARY.md`, commits `0d9d2408` (test, `LANE_ONLY_SITES`
register pinned as SITES-not-a-count, re-derived from the corpus with a named failure mode on a
malformed or key-less marker) and `11f46389` (test, FORWARD/REVERSE object-binding cross-checks
plus the vault near-miss guard) on branch `chore/164.1.1.1-laneonlygates`). Task 3 (four
neuter/observe-RED/restore calibrations, including the one-for-one swap M1b where the marker
moved between two files with the corpus-wide count unchanged at one — the SET pin reddened
anyway) produced no net code change; both mutated SQL files restored byte-identical
(`shasum -a 256` equal pre/post every cycle — see the SUMMARY's Calibration Log). Evidence
regenerated fresh, not restated: `mutation-runner --parse-only` —
`test_prod_prober_cadence.sql: 7 prose / 7 twin(s) / 0 waiver(s)`, `coverage: files 47/74`,
`arms: 0/402/0`, exit 0. Collateral suites + a full serial `npm test` (15,117 tests): the only
failure both times is the pre-existing, box-local `Test timed out in 5000ms` inside
`lint-sql-gates.test.ts`'s EXECUTION ORACLE block (carved out by this plan's own `<fails_when>`,
already shown green on CI). The two deferred items plan 01 logged
(`check-planning-hygiene.test.ts`, `verify-plan-anchors.test.ts`) were already resolved by an
intervening commit (`d693e3c7`) before this plan began — no new deferred items this session.
This closes T-164.1.1.1-01 (plan 01's own threat register entry) and T-164.1.1.1-05 through -08
(this plan's threat register) as mitigated-and-calibrated. Next: Phase 164.1.1 plan 06 — the
founder-gated live PROD session that closes `[PROBER-CADENCE-UNDELIVERED-01]` — is now unblocked
on the CI side (`sql-tests` no longer reds on `test_prod_prober_cadence.sql`); the requirement's
TODOS.md checkbox stays open until plan 06 itself executes.

⭐ **RECONCILED 2026-09-18 (164.1.1.1 plan 01). THIS block was the current position from plan
01's close until the block above (plan 02, the final plan of the phase) superseded it. Retained
as lineage. Phase 164.1.1.1 is the URGENT inserted phase named in Roadmap Evolution —
LANEONLYGATES — a SIBLING of 164.1.1, not a continuation of it; the block below (164.1.1-plan-05)
covers 164.1.1's own history.**

Phase: 164.1.1.1 (LANEONLYGATES — sql-tests must not run gates that require a pg-lane-only
fixture) — EXECUTING
Plan: 1 of 2 DONE (`164.1.1.1-01-SUMMARY.md`, commits `1bd4e681` (feat, the LANE-ONLY marker +
ci.yml exclusion mechanism), `6c3fce03` (test, invocation log + defect-injection pair + static-
accounting scenario), `346e0850` (docs, calibration log + deferred items) on branch
`chore/164.1.1.1-laneonlygates`). `supabase/tests/test_prod_prober_cadence.sql` no longer
executes against shared TEST — it declares itself LANE-ONLY via one structured comment line
naming `net._lane_posts`, the fixture, and `sql-mutation` as the owning job — while
`SENTINEL_FLOOR` (11), `ARMS_FLOOR` (213) and ci.yml's per-file derivation table stay
byte-unchanged, proven by `mutation-runner --parse-only` and a whitespace-blind `git diff -w`.
The exclusion is measured, not inspected: `ci-anti-skip-gate.contract.test.ts` gained a real
stub-psql invocation log and a defect-injection calibration pair (21/21 passing), and all three
new properties were individually neutered, observed RED for the predicted reason, and restored
byte-identically (`shasum -a 256` equal pre/post every cycle — see the SUMMARY's Calibration
Log). Two pre-existing, out-of-scope `npm test` failures (`check-planning-hygiene.test.ts`,
`verify-plan-anchors.test.ts`, both against this phase's own PLAN.md content authored before
this execution session) logged to `deferred-items.md` rather than fixed. Next: Plan 02 — the
cross-check pinning the excluded SET as sites (not a count) per the threat register's
T-164.1.1.1-01 mitigation.

⭐ **RECONCILED 2026-09-18 (plan 05). THIS block was the current position for Phase 164.1.1
(PROBERCADENCE) from plan 05's close until the block above (a different, sibling phase,
164.1.1.1) superseded it as the CURRENT position. Retained as lineage — 164.1.1 plan 06 is
still the next plan for THAT phase.**

Phase: 164.1.1 (PROBERCADENCE — the prober's detection latency is measured and alarmed from a
scheduler that cannot silently drop it (INSERTED)) — EXECUTING
Plan 05 DONE (`164.1.1-05-SUMMARY.md`, commits `7ae2fe98` (docs, the go-live runbook), `988463eb`
(docs, `TODOS.md[PGCRON-LIVENESS-UNWATCHED-01]` + the plan-05 progress note) and `33144af6`
(docs, the runbook's placeholder replaced so the residual is reachable from both surfaces) on
branch `feat/164.1.1-probercadence`). Ships `docs/runbooks/prod-prober-cadence-go-live.md` —
blast radius before the pre-flight, five blocking pre-flight checks, the exact
`cron.schedule('prod_prober_cadence_check', '20 * * * *', …)` statement (never a migration), the
manifest re-capture as step 2 of the SAME session, first-tick expectations, watching it (routed
through plan 03's `a-sentry-already-set` checkpoint outcome), and a two-part rollback. Criterion
5's turtle is named, measured and disposed: `TODOS.md[PGCRON-LIVENESS-UNWATCHED-01]` — ACCEPTED
as a named residual (narrowness + the rejected fifth-prober-arm alternative), the manual
`latest_cron_success()` reading marked manual and never coverage, left UNROUTED by design.
`[PROBER-CADENCE-UNDELIVERED-01]` carries a dated progress note and its checkbox stays open —
this plan wrote the runbook, it did not execute it; nothing touched PROD, a migration, or
`scripts/prod-prober/cron-manifest.json`. Next: Plan 06 — the founder-run live session that
executes this runbook and closes `[PROBER-CADENCE-UNDELIVERED-01]`.

⭐ **RECONCILED 2026-09-18 (plan 04). THIS block was the current position from plan 04's close
until the block above superseded it. This update ADDS plan 04's completion.**

Phase: 164.1.1 (PROBERCADENCE — the prober's detection latency is measured and alarmed from a
scheduler that cannot silently drop it (INSERTED)) — EXECUTING
Plan 04 DONE (`164.1.1-04-SUMMARY.md`, commits `524b300f` (feat, the guarded
`POST /api/prober-cadence-alert` route) and `06ccd703` (test, calibrated suite + a
Rule 2 quarantine-roster fix in `test_limiter_route_coverage.py`) on branch
`feat/164.1.1-probercadence`). Implements the 164.1.1-03 checkpoint's recorded outcome
(`a-sentry-already-set` — `SENTRY_DSN` confirmed set on Railway analytics-service production,
presence only, founder-measured 2026-09-18): a rate-limited `sentry_sdk` escalation (one per
hour) plus an unconditional structured log on every occurrence, guarded by the existing
`SERVICE_KEY` middleware, zero new credential. All four load-bearing behaviours (unconditional
log, escalation window, escalation-failure containment, body validation) were manually
neutered, observed RED by name, and restored byte-identical (`cmp`) — see the plan's SUMMARY
calibration log. Full analytics-service suite green (5877 passed, 0 failed); CI-scoped strict
mypy (`services/ routers/ models/`) clean. Standing caveat, NOT resolved by this plan: delivery
still depends on a Railway environment variable outside this repository's control. Next:
whichever of Plans 05/06 the orchestrator dispatches — see their own PLAN files for current
status.

⭐ **RECONCILED 2026-09-18 (plan 02). THIS block was the current position from plan 02's close
until the block above superseded it. This update ADDS plan 02's completion — it does not
assert anything about plan 04's status, tracked separately in its own PLAN/SUMMARY files at
the time this block was written; the block above now resolves that.**

Phase: 164.1.1 (PROBERCADENCE — the prober's detection latency is measured and alarmed from a
scheduler that cannot silently drop it (INSERTED)) — EXECUTING
Plan 02 DONE (`164.1.1-02-SUMMARY.md`, commits `165173b0` (test, five expansion arms
O1/A1/N1/U1/V1 in `test_prod_prober_cadence.sql`) and `6088811d` (test, `ARMS_FLOOR` 397→402

+ every sibling pin) on branch `feat/164.1.1-probercadence`). All seven arms of

`test_prod_prober_cadence.sql` now proven RED on a real pg-lane; full-corpus mutation run
confirms `arms 402/402/0`, `biting 402`, `✅ No defects`, `FILES_FLOOR` unmoved at 47,
`WAIVED_CEILING` still 0. No migration file touched. Plans 04/05/06 (the escalation route, the
live `cron.schedule` op) can build on the now-fully-hardened observer function without
re-deriving its edge-case behaviour. Next: whichever of the remaining plans the orchestrator
dispatches — see their own PLAN/SUMMARY files for current status.

⭐ **RECONCILED 2026-09-18 (plan 03). THIS block was the current position from plan 03's close
until the block above superseded it. THIS update only ADDS plan 03's completion — it does not
assert anything about plan 02's status, which was tracked separately in its own PLAN/SUMMARY
files at the time this block was written; the block above now resolves that.**

Phase: 164.1.1 (PROBERCADENCE — the prober's detection latency is measured and alarmed from a
scheduler that cannot silently drop it (INSERTED)) — EXECUTING
Plan 03 DONE (`164.1.1-03-SUMMARY.md`, commits `9a1b0a8b` (test, criterion-4 pin +
calibration twin, `.github/workflows/prod-prober.yml` byte-unchanged) and `3ce0d461` (docs,
plan close-out) on branch `feat/164.1.1-probercadence`). Plan 03's checkpoint (Task 1,
`gate="blocking-human"`) was answered before this executor ran: `SENTRY_DSN` IS set on Railway
→ analytics-service → production → Variables, option `a-sentry-already-set`, founder-measured
2026-09-18 — presence only, no value recorded anywhere. Standing caveat: delivery still
depends on a variable outside this repository, so a later unset would silently re-open the gap;
neither this line nor any future plan may claim the alarm permanently reaches a human without
that caveat attached. Plan 04 (the escalation route) is now unblocked to implement against
this answer. Next: whichever of Plan 02 / Plan 04 the orchestrator dispatches next — see their
own PLAN/SUMMARY files for current status.

⭐ **RECONCILED 2026-09-18 (plan 01). THIS block was the current position from plan 01's close
until the block above superseded it, including the 2026-09-09 block that reconciled the one
before it. Nothing below is deleted — it is lineage.**

Phase: 164.1.1 (PROBERCADENCE — the prober's detection latency is measured and alarmed from a scheduler that cannot silently drop it (INSERTED)) — EXECUTING
Plan: 1 of 6 DONE (`164.1.1-01-SUMMARY.md`, commits `d1d6ca63`/`2e03771b`/`16e962ad` on branch
`feat/164.1.1-probercadence`). Next is Plan 02. Plan 01 shipped `public.prod_prober_cadence_check()`
(forward migration, no `cron.schedule(...)`), the prober's own unconditional contact write, a
two-arm matched-pair SQL gate proven RED on a disposable pg-lane, and both mutation floors moved
from a measured full-corpus run (`FILES_FLOOR` 46→47, `ARMS_FLOOR` 395→397) with every sibling pin
(`gate-family-meta.test.ts`, `mutation-runner-floors.test.ts`, `mutation-annotation-parser.test.ts`,
a new dated `ci.yml` leg-count entry) moved in the same commit as Task 3. Full verification passed:
`dump-sql-functions --self-test/--check`, `prod-prober --self-test` (83/83), full-corpus
`mutation-runner` (`✅ No defects`, `files 47/74`, `arms 397/397/0`), `lint-sql-gates` (0 findings),
and all four sibling vitest files (310/310). No older migration file changed; nothing ran
`supabase db push`/`db reset`/`--project-ref`/`--db-url`.

⭐ **RECONCILED 2026-09-09. THIS block was the current position from 2026-09-09 until the block
above superseded it on 2026-09-18, including the 2026-09-06 `Phase: 164.2 (CURATED-COPY)` pointer
that reconciled the block before it. Nothing below is deleted — it is lineage.**

Phase: 164.1.1 (PROBERCADENCE — the prober's detection latency is measured and alarmed from a scheduler that cannot silently drop it (INSERTED)) — EXECUTING
Branch: `phase-164.8-05-test-first-migrate` (carries Phase 164.8 plan 05 AND 164.8.1's
close-out; 12 commits ahead of `origin/main`, NOT yet pushed).
Version: `0.77.30.0` (VERSION and package.json byte-equal), one unified CHANGELOG entry
covering every commit on the branch.

**How it closed, because the shape matters more than the verdict.** `gsd-code-reviewer`
returned 1 blocker + 10 warnings; the fixes went in; `gsd-verifier` then found 3 further
gaps + 4 record items in the FIXES. Two of the defects were anti-vacuity failures inside
this phase's own new code — the count-aware SHORT branch shipped with no falsifier at any
layer, and the arm ratchet's calibration mutation had silently become a no-op — which is
the class this repo ranks above correctness. A third was live: bash was command-
substituting SQL comment prose inside the unquoted `TXN_*` heredocs while assembling the
destructive restore. All closed and each falsified by neutering.

⛔ **NEXT, and both are gates, not suggestions:**

1. **Phase 164.8 plan 05 Task 3** is halted at a human checkpoint — merge the PR, then
   dispatch `supabase-migrate.yml` on `main`, selecting the run by `headSha == MERGE_SHA`.
   The TEST-first apply's version-set comparison assumes a `supabase db push` output shape
   that ONLY a real run can confirm; until that run, that is an unverified assumption in a
   path that gates PROD.
2. **Phase 164.8 plan 06** still owns writing `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`
   and `[164.8-TEST-DATA-RESEEDED]` — measured 2026-09-09: neither exists in `TODOS.md`.

Routed OUT of 164.8.1 to Phase 164.9 (all three carry ROUTED HERE blocks in the ROADMAP):
`[164.8.1-REPLAY-INSERT-ONLY-SCOPE]`, `[164.8.1-TEST-ANALYTICS-URL-PROD]`,
`[164.8-PUSH-RACE-VAC08]`.

Phase: 164.2 (CURATED-COPY) — IN PROGRESS, planning not started
Plan: 1 of 6
⛔ 2026-09-06: this line deliberately carries NO `N of M` pair. Written as `0 of 0` it parsed, and
`state.advance-plan` then answered `reason: last_plan` / `status: ready_for_verification` — an
unplanned phase reported as ready to verify (measured in a sandbox copy). With no numeric pair the
verb cannot mis-advance. Restore the `N of M` shape when planning produces real plans.

⭐ **RECONCILED 2026-09-06. Everything from here to the `⚠️ RETAINED — Phase 164.4.1 execution
log` marker below is the CURRENT position. It SUPERSEDES the `Phase: 164.4.1 (PGCRON-LANE) —
EXECUTING` / `Plan: 5 of 6` pointer that stood on these two lines until now, and it supersedes the
`Status:` and `Last activity:` lines further down, which were both written mid-164.4 and are kept
as lineage. Nothing below was deleted.**

**Where the work actually is.** Phase **164.2 (CURATED-COPY)** is in flight on branch
`phase-164.2-curated-copy`. `164.2-CONTEXT.md` (commit `24618f73`) and `164.2-RESEARCH.md`
(`cf402eb0`) are written and committed, and `03ae5fa0` records the four CONTEXT decisions RESEARCH
refuted. Pattern-mapping is running. **No PLAN file exists yet** — `.planning/phases/164.2-…/`
holds CONTEXT and RESEARCH only, which is why `roadmap.analyze` reports its `disk_status` as
`researched`. ⛔ Do not read `Plan: 0 of 0` as "nothing to do"; read it as "the plan count is not
yet known because planning has not run".

**Phases that shipped since the superseded pointer was written — each with the citation, none
asserted from memory:**

- **164.4 REDUNDER-BACKFILL — COMPLETE.** PRs #741 (`a55ff918`), #742 (`75e58cb1`), #743
  (`3ed6919e`). `164.4-VERIFICATION.md` on `origin/main`: `status: passed`, 4/4 must-haves, and
  its one `human_verification` item is recorded `human_verification_resolved: 2026-09-05` by
  founder decision on the superseding ubuntu run 33961609382 at `1aa8bb70`.
- **164.4.1 PGCRON-LANE — COMPLETE.** PR #744, squash-merged `e01cc2e6` (v0.77.13.0).
  `164.4.1-VERIFICATION.md`: `status: passed`, 5/5 must-haves, `verified_at_head: 581d54cb`, and
  SC-1's human item closed by ubuntu run **33973362161** at `ab0d5644`.
- **164.3.1 SOUND-PRIMITIVES — COMPLETE.** `164.3.1-VERIFICATION.md`: `status: passed`, 9/9
  criteria, re-verified at `e30f7c33`.
- **164-family re-partition — SHIPPED.** PR #745, `ce5d2983` (v0.77.13.1).
- **164.1 PROD-OBSERVABILITY — ALL SIX PLANS EXECUTED AND MERGED, but FORMALLY UNVERIFIED.**
  Code merged as PR #746 (`42868a9b`); the phase's planning artifacts plus plan 06 (the first live
  PROD prober run, the captured cron manifest, the posture flip and the new `version-gate` CI job)
  merged as PR #748 (`d679f638`, v0.77.15.0, 2026-09-06). All six `164.1-0N-SUMMARY.md` files exist
  on `origin/main` and `164.1-06-SUMMARY.md` reads `status: complete`. ⛔ **There is NO
  `164.1-VERIFICATION.md` anywhere in the repo** — `/gsd-verify-work 164.1` has not been run, so
  this phase is CLOSED-BY-MERGE, not VERIFIED. Do not restate it as verified.
  ⚠️ Its first live run found a REAL open production fault: MT5 `initialize()` returned **-6**
  (authorization failed — terminal up and answering IPC, but not logged in), filed as issue
  **#747** and left for founder action. That is an open production item, not a phase defect.

⛔ **THIS CHECKOUT IS ONE COMMIT BEHIND `origin/main`, and that is why the phase-directory
readings lie. Measured 2026-09-06:** `git rev-list --left-right --count origin/main...HEAD` = `1 5`
— the branch forked at `42868a9b` and does **not** contain `d679f638`, which is precisely the
commit that carried 119 planning artifacts for 164.1 / 164.3.1 / 164.4 / 164.4.1 onto main (PR #746
was squashed and `/gsd-pr-branch` filtered the transient `.planning/` files out of the reviewer's
diff, so they reached main only via #748). Consequence: in THIS working tree those four phase
directories contain nothing but `.gitkeep` (164.4.1 has no directory at all), so
`roadmap.analyze` reports them `empty` / `no_directory` and every derived progress integer is
depressed. **They were NOT archived and NOT lost** — `git ls-tree -r origin/main .planning/phases/`
shows 164.1 at 6 PLAN + 6 SUMMARY, 164.3.1 at 13 + 13, 164.4 at 12 + 12, 164.4.1 at 6 + 6, and
`git show --diff-filter=D d679f638 -- .planning/phases/` is EMPTY, so nothing was deleted.
✅ **Fix: merge `origin/main` into this branch.** `d679f638` touches neither `STATE.md` nor
`ROADMAP.md` (verified: `git diff 42868a9b d679f638 -- .planning/STATE.md .planning/ROADMAP.md` is
empty), so the merge is clean apart from `state.json`. It was deliberately NOT done in this
reconciliation pass because a pattern-mapper is running against this checkout and a merge would
change the tree underneath it. **Do it before the next `/gsd-plan-phase 164.2`.**

⚠️ **The two phase counters disagree BY DESIGN — neither is a completion oracle, and picking the
larger one is wrong. Diagnosed 2026-09-06 by reading the SDK, not by preference:**

- `query init.milestone-op` → `completed_phases` counts a current-milestone ROADMAP phase whose
  directory holds **at least one SUMMARY file** (`init.cjs:1912-1935`,
  `listPhaseSummaryFiles(...).length > 0`). It answers *"how many phases have produced any output
  at all"*. Measured here today: **9 of 20**.
- `query roadmap.analyze` → `completed_phases` counts phases whose **`disk_status === 'complete'`**
  (`roadmap.cjs:535`), i.e. plan_count > 0 AND every plan has its SUMMARY. It answers *"how many
  phases have no unfinished plan on disk"*. Measured here today: **4 of 20**.
- Both read ONLY `.planning/phases/<dir>/`. Neither reads a VERIFICATION.md, a PR, or a merge
  commit — so **neither number can tell you whether a phase shipped**, and on this behind-main
  checkout both are additionally depressed by the four artifact-less directories above. The
  per-phase `roadmap_complete` field is a THIRD, unrelated thing: it reads the `✅ COMPLETE` marker
  in the ROADMAP heading, which is why only 158 and 163 carry it.
- ⛔ Consequence for planners: **cite a merge commit, a PR number or a VERIFICATION.md status when
  you claim a phase is done. Do not cite either counter.**

⚠️ **`roadmap.analyze`'s `next_phase: "164.7"` is a FILE-ORDER ARTIFACT, not a scheduling signal.**
`nextPhase` is `phases.find(disk_status ∈ {empty, no_directory, discussed, researched})`
(`roadmap.cjs:531`) over headings in the order they appear in `ROADMAP.md`. The v1.20 heading order
is 158, 159, 160, 161, 161.1, 162, 163, 164, **164.7**, 164.3, 164.3.1, 164.4, 164.4.1, 164.1,
164.2, 164.2.1, 164.5, 164.6, 166, 165 — the 164-family inserts sit in insertion order, not
execution order — so 164.7 wins on position over the in-flight 164.2 (which is `researched` and
therefore also matches the predicate). The **intended** order is
**164.1 → 164.2 → 164.2.1 → 164.7 → 164.5 → 164.6 → 166 → 165**; it lives in ROADMAP prose and in
each phase's `Depends on:` line, and is not encoded in heading position. Same defect in
`current_phase: "159"`, which is just the first `planned|partial` heading (159 is 7 plans / 6
summaries) — an oldest-incomplete pointer, not the live position. **Read this section, not those
two fields.**

⚠️ RETAINED — Phase 164.4.1 execution log (2026-09-04/05). SUPERSEDED AS POSITION by the block
above; kept verbatim as that phase's own dated record. 164.4.1 is COMPLETE (PR #744, `e01cc2e6`),
so every "Next is plan NN" below has been discharged:
      class + lane probe + SCOPE AMENDMENT #2, 04-11 the eight annotation batches) —
      hand-maintained; `state.advance-plan` still REFUSES on this section
      (`ambiguous_position_phase`, see § Known Issues)
      ⚠️ 2026-09-05: plans 01 (substrate + tripwire observed) and 02 (file move 1) are
      DONE. Next is plan 03. Measured at 164.4.1-02: `coverage: files 41/71`,
      `arms: 272/272/0`, `biting: 272`, `pending: 0`, `lane-blocked: 3`,
      `FILES_FLOOR` 41, `ARMS_FLOOR` 272, `WAIVED_CEILING` still 0.
      ⛔ Every `run.mjs` run in this interval EXITS 1 on ONE `lane-blocked-stale`
      row — the tripwire, not a regression. It clears when plan 05 lands.
      ✅ 2026-09-05, SUPERSEDING the two lines above (kept as the dated record of
      the 01-04 interval): plans 03, 04 and 05 are DONE and **the tripwire is
      CLEARED**. Measured at 164.4.1-05 (HEAD b6b830cf), `node
      scripts/mutation-runner/run.mjs` exiting **0**: `coverage: files 44/71`,
      `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`, `  pending: 0`,
      `arms: 363/363/0`, `biting: 363`, `lane-invocations: 363` (tallies agree),
      `mean 1.1s`, `✅ No defects`. `FILES_FLOOR` 44, `ARMS_FLOOR` 363,
      `WAIVED_CEILING` still 0 — fifteen arms moves, zero waivers. From here a
      NON-ZERO exit is a regression. Next is plan 06 (closure: the false-reading
      `lane-probe: … class is STALE` sentence, the `lane-blocked:` line's own
      prose, [REDUNDER-LANEBLOCKED-BLIND], and the ubuntu measurement).
Status: Executing Phase 164.6.6.1
      ⚠️ RETAINED — this was the `Status:` line until the 2026-09-06 reconciliation, kept as
      lineage: *"164-family re-partition SHIPPED — PR #745 (chore/164-family-repartition,
      v0.77.13.1). Phase 164.4.1 COMPLETE — PR #744 squash-merged as `e01cc2e6` (v0.77.13.0),
      Railway on `e01cc2e6`. 164-family RE-PARTITIONED 2026-09-05 (164.1 → PROD-OBSERVABILITY,
      164.2 CURATED-COPY +161-ERRPREFIX, NEW 164.5 BASELINE-SNAPSHOT, NEW 164.6 GATE-HYGIENE,
      order 164.6 → 166 → 165). Next: `/gsd-autonomous --only 164.1`."* — that `Next:` is
      DISCHARGED; 164.1 ran and merged.
      `arms: 262/262/0`, `biting: 262`, 0 waivers, exit 0. Next: land 164.4-11 as its own PR with
      `sql-mutation` GREEN on ubuntu SHA-bound to the head, then `/gsd-verify-work 164.4`.
      ⏳ Phase 164.4.1 PGCRON-LANE is still owed the 4 lane-blocked files plus the 1 `pending:`
      file (`test_compute_jobs_error_kind_copy_parity.sql`, ~100 sections).
      ✅ 2026-09-06: both ⏳ items above are DISCHARGED. 164.4-11 landed (PR #742 `75e58cb1`,
      closed by PR #743 `3ed6919e`) and 164.4.1 annotated all five remaining files —
      `lane-blocked: 0`, `pending: 0` at `files 44/71`. Read `FILES_FLOOR` / `ARMS_FLOOR` off
      `scripts/mutation-runner/run.mjs`, never off a number restated here.
Last activity: 2026-10-04 — Phase 164.6.6.1 execution started
      ⚠️ RETAINED — this was the `Last activity:` line until 2026-09-06:
      *"2026-09-04 — Phase 164.4.1 execution started"*
      all twinned and proven on real pg-lanes with **ZERO waivers** (cumulative 0 across all eight
      arms moves; `WAIVED_CEILING` unedited). Full corpus **exit 0**: `coverage: files 39/71`,
      `arms: 262/262/0`, `biting: 262`, `lane-invocations: 262` (tallies agree), `mean 1.0s`, 0
      defects, 347 s local; the 39 per-file `biting` counts SUM to 262 and the `sections` counts to
      252. `FILES_FLOOR` 32 → **39**, `ARMS_FLOOR` 247 → **262**, both separation directions driven
      on real lanes — (39, 262) silent, (40, 263) fires both regressions. Every lockstep pin moved,
      including `pendingFiles` pinned as a ONE-NAME SET so an empty `pending:` line cannot be
      shipped as an attestation of completeness. The measured shadow in these files is
      PRIVILEGE-shaped: a withdrawn privilege aborts with `permission denied for table …`, which
      carries no `TEST FAILED (…)` and scores NO-IDENTITY — five twins use the RLS ROW filter
      instead. Two LAYERED arms, each proven layered by running the single-step version (one GREEN,
      one aborting the apply at its own post-verify). One arm scored NO-RED and the APPLY LIST was
      the defect: `profiles_self_update` was inert without 20260405061912, the only statement that
      ENABLEs RLS on profiles. Four new additive stand-ins (25 e2e census seed — 20260823120000
      refuses to apply on an unidentified database; 26 strategies.api_key_id FK; 27
      strategy_analytics.computation_error; 28 five privileged profiles columns). `ci.yml`'s
      sql-mutation timeout projection corrected from an ARMS model to a LEGS model
      (legs = arms + 2 × annotated files); `timeout-minutes` STAYS 15. SCOPE AMENDMENT #2's
      40 / 255 recorded as SUPERSEDED and corrected to **39 / 252 / 262** in all seven ledger sites.
      ⏳ `164.4-11`'s `<human-check>` is OPEN: not landed, so `sql-mutation` has not been observed on
      ubuntu at a PR head SHA, and the ci.yml legs PROJECTION has not yet been replaced by that
      run's measurement.
Prior activity: 2026-09-04 — 164.4-09 executed on the branch as a REDUCED batch (5 of 6 planned
      files; 20 sections). Both blockers the previous session escalated are DECIDED and discharged.
      Blocker 2 (`test_resync_retry_single_job.sql` assertion (b), a measured waiver candidate) was
      resolved by the ROOT-CAUSE FIX, following the founder's own wave-9 `[REDUNDER-WAIVER-01]`
      precedent: its INSERT is wrapped in the `BEGIN … EXCEPTION WHEN unique_violation` idiom the
      SAME FILE already used at assertion (c), so a narrowed SV index now reports `TEST FAILED (b)`
      (single-frame CONTEXT, LOCATION last) instead of a raw 23505 naming no arm. **`WAIVED_CEILING`
      stays 0** — the second arm this phase has rescued structurally rather than by exception.
      Blocker 1 (`test_compute_jobs_error_kind_copy_parity.sql`, un-baselineable without pg_cron) is
      DEFERRED by founder decision to a dedicated plan that puts pg_cron ON the pg-lane, retiring
      `[REDUNDER-PGCRON]` and unblocking that file plus the four already-deferred ones (~100
      sections); nothing in `scripts/pg-lane/` or the classifier was touched here.
      Full corpus run **exit 0**: `coverage: files 28/71`, `arms: 239/239/0`, `biting: 239`,
      `lane-invocations: 239` (tallies agree), `mean 1.0s over 239 arm run(s)`, 0 defects, 297 s
      local; the 28 per-file `biting` counts SUM to 239. `FILES_FLOOR` 23 → **28** and `ARMS_FLOOR`
      219 → **239**, both ratcheted to the run's OWN printed values (NOT the plan's projected
      29 / 242, which assumed six files) with both separation directions driven on real lanes
      — (28, 239) silent, (29, 240) fires both regressions. Every lockstep pin moved in the same
      commit. `.github/workflows/ci.yml` untouched. Two findings booked to TODOS.md:
      `[REDUNDER-LANEBLOCKED-BLIND]` (the classifier is apply-list-blind, so a pg_cron-blocked gate
      is miscounted into `pending:`; a tripwire test pins it) and `[REDUNDER-SAVEPOINT]` extended to
      a class of exactly THREE migrations. ⏳ `164.4-09`'s `<human-check>` is OPEN: not yet landed,
      so `sql-mutation` has not been observed on ubuntu at a PR head SHA.
Prior activity: 2026-09-03 — 164.4-02 executed on the branch: the reference file's 15 un-twinned
      SECTIONS closed (45 twins over 35/35 sections, `arms: 45/45/0`, `biting: 45`, tallies agree),
      `ARMS_FLOOR` ratcheted 30 → 45 with both separation directions measured, and the durable
      SET-INCLUSION section pin armed and watched to fail. ✅ 164.4-02's `<human-check>` is CLOSED:
      landed as **PR #732** (head `b912e4f6`, squash-merged `465985b5`, v0.77.3.0); CI run
      **33743816665** reports `sql-mutation` success on ubuntu in **102 s**, its own log reading
      `arms: 45/45/0` / `lane-invocations: 45` / `tallies agree`. Run id + head SHA + wall clock
      are recorded in `164.4-02-SUMMARY.md` § coverage D6, which is what 164.4-03's precondition
      reads. The working branch is merged up to that commit, so the tree is at/after the merge
      both by content and by ancestry. **164.4-03 is unblocked.**
      ⭐ 2026-09-03 — **164.4-03 executed** on the branch: the runner now DERIVES and prints a
      `lane-blocked:` class (the 4 idiom files that probe `pg_extension` for pg_cron), PROBES the
      pg-lane itself once per lane-spawning run (`lane-probe:`), and exits 1 with `lane-blocked-stale`
      the day pg_cron is available while the class is non-empty — so the deferral can expire instead
      of parking 100 sections behind a true-looking line. `sql-mutation` MEASURE_FAILs on either line
      going missing or self-contradicting. SCOPE AMENDMENT #2 is written to all 6 ROADMAP sites and
      all 3 STATE sites, with criterion 1's silent-exclusion sentence kept verbatim. Full run exit 0,
      `coverage: files 1/71`, `arms: 45/45/0`, `biting: 45`, `lane-invocations: 45`, floors UNEDITED
      (1 / 45 / 0); `--self-test` 17/17. ⚠️ Its `<human-check>` is OPEN — nothing pushed, no PR; the
      ubuntu SHA-bound `sql-mutation` green is owed. Commits `0a9ed7ce`, `508847e9`, `1611ece2`.

⚠️ Phase 160 remains OPEN on its human gate — see `## Deferred Verification`. Advancing this
pointer to 161 does NOT close it; resume it only via `/gsd-verify-work 160`.
OPS-CI first (the shared-test-db eviction / #616 mutex protects every later merge), 165 DEPS
last (hard-blocked on OPS-01), 160 provenance before 164 SHARE (REVOKE soak), SHARE alone in
its own PR and never branched from `feat/phase-156-connect-refactor`.

### Retained — Phase 156 close-out (COMPLETE 2026-08-13, do NOT lose this)

⚠️ **SHAPE FIX 2026-09-06 — the two field labels below were `Phase:` and `Plan:` and are now
`Retained phase:` / `Retained plan:`. Nothing else in this block changed; no sentence was cut.**
Reason: `stateCurrentPositionSlice` (`gsd-core/bin/lib/state-document.cjs:510`) collects
`## Current Position` with `levelBounded: true`, so every `###` block nested under it — this one
included — is inside the slice, and `advancePlanCore`
(`gsd-core/bin/lib/state-transition.cjs:1067`) refuses with `ambiguous_position_phase` when that
slice matches `/^Phase:.*$/gm` more than once. The `### Blockers` entry recorded the diagnosis and
proposed moving this whole block to its own top-level section; relabelling the two lines is the
smaller change that reaches the same result — promoting the heading to `##` would have swallowed
`### Phase 142.1 scope` and `### Phase 140.1 close-out` into a Phase-156 section they do not belong
to. This block is still marked *do NOT lose this* and is still retained verbatim below.

Retained phase: 156 (connect-refactor — the venue the server validated is the venue the server writes) — ✅ COMPLETE 2026-08-13
Retained plan: 10 of 10 complete. PR A shipped as v0.60.0.0 (merge `25e28d3a`) and is LIVE ON PROD; PR B is authored on `feat/phase-156-migration-b` and NOT yet opened.

⚠️ **Progress counters reconciled 2026-08-13 (plan 156-10), and the reconciliation is stated because
the numbers moved by more than this phase's own delta.** `total_phases: 16` is v1.17's ten phases plus
the six 153.x splits; `percent` is phase-weighted (`completed_phases / total_phases`), NOT plan-weighted
— 13/16 was 81. `completed_plans` now reads 88 = every AUTHORED v1.17 plan: phases 153 and 155 contribute
**zero** because they were never planned, not because their plans are outstanding. ⚠️ The previous value
`83` over-counted by 3 against a disk census (80 SUMMARY files before this phase's last eight); it was
hand-set at some point and is not reproducible from `.planning/phases/`. ⛔ Do NOT run
`state.update-progress` to "fix" this: it recalculates from SUMMARY.md counts on disk and Phase 156 has
two plans that deliberately produced no SUMMARY (**156-06**, whose artifact is `156-LIVE-ACCEPTANCE.md`,
and **156-07**, whose output is Migration B itself) — the verb would write 8/10 for a phase that ran all
ten.

⚠️ **Re-cut 2026-08-14 (plan 153.7-01), by HAND and on the same rule.** `total_phases` 16 → **17**
(Phase 153.7 was INSERTED 2026-08-14, so it is a seventh 153.x split, not one of the six);
`total_plans` 88 → **91** (153.7 authors three); `completed_plans` 88 → **89** (this plan);
`completed_phases` stays **14** because 153.7 is two plans from done; `percent` 87 → **82** on the
same phase-weighted rule (14/17 = 82). ⛔ `state.advance-plan` and `state.update-progress` were run
once and **reverted**: they are pointed at Phase 156, and they overwrote the hand-written Migration-B
warning above with "Phase complete — ready for verification" while setting `completed_phases` 14 → 13.
That is the failure mode the ⛔ two paragraphs up predicts; it is recorded here rather than repeated.

⚠️ **Re-cut 2026-08-17 (Phase 144 Wave 1), by HAND and on the same rule — stated because the numbers
moved by more than one phase's own delta.** `completed_phases` 15 → **16** (Phase 143 is done: 4 plans,
4 SUMMARYs, shipped as PR #687 and merged to `main` at `26a3105d`, migration live on PROD). Its four
plans were already inside `total_plans: 95` — the baseline's 95−91 = 4 outstanding WERE 143's — so
`completed_plans` 91 → **95** on 143, then → **96** for 144-01. `total_plans` 95 → **98** (Phase 144
authors three). `total_phases` stays **21**. `percent` 71 → **76** on the phase-weighted rule
(16/21 = 76), NOT plan-weighted. `completed_phases` does NOT advance for 144 — it is two plans from done.

⛔ **`state.update-progress` and `state.advance-plan` were NOT run, deliberately.** Both are still
pointed at Phase 156 and both recalculate from on-disk SUMMARY counts; a repo-wide census reads 257
PLAN / 258 SUMMARY files against these milestone-scoped 98/96, so either verb would overwrite the
counters with meaningless repo-wide totals and clobber the hand-written notes above — the exact
failure recorded in the 2026-08-14 paragraph. Phase 144's Wave-1 executor independently declined to
touch this file for the same reason (it saw `current_phase: 153.7` next to a Phase-143 `stopped_at`
and refused to advance a counter against the wrong phase). That refusal was correct.

⚠️ **Corrected 2026-08-13:** this block read `Phase: 153.6 … EXECUTING, Plan: 1 of 6` until now.
153.6 shipped on `main` (PR #675, commit 54a0d26d) and the position had not been advanced since.
⚠️ The **Session → Next step** paragraph at the foot of this file was stale for the same reason
(it said 153.6 "is booked and NOT yet planned") until 2026-08-21, when the Phase 158 closure updated
it to the current position (Phase 159).

### Phase 142.1 scope (inserted 2026-08-02)

Sources — THREE independent passes, deliberately not cross-fed:

- **Pass A** — high-effort workflow code review (35 agents; 31 candidates verified,
  17 refuted, 10 reported) → items 1–10.

- **Pass B** — `gsd-code-reviewer`, blind to Pass A → 0 blockers, 4 warnings.
  WR-01/03/04 re-derived items 1, 5 and a Pass-A-refuted item; WR-02 was new.

- **Pass C** — `gsd-verifier` on Phase 142, the goal-backward pass that had never
  run. Verdict **`gaps_found`, 9/10 must-haves**. It did NOT trust SUMMARY claims:
  it stood up a throwaway PostgreSQL 16, extracted the real `$cron$` body and the
  real re-based bridge from the migration, and executed them. **The phase goal IS
  achieved** — all four ROADMAP SCs hold behaviourally. Gaps → items 11–14, 16.

**Sixteen items in scope.** Convergence is itself signal: item 1 was found
independently by all three passes.

1. **CONFIRMED — `analytics_runner.py:1238`.** `_mark_computing` re-stamps
   `computing_started_at` on a row that is ALREADY `computing`, so the reap clock
   restarts at the LAST chain hop instead of chain start. Worst-case stranded
   spinner ≈28 h, not the 16 h the threshold derivation and migration header
   promise. Note the shape: the migration's Arm 3 and the SQL gate's Part 4
   sentinel correctly forbid a *bridge* call from advancing the stamp — verified
   live on TEST — but the Python writer sets the column DIRECTLY, outside that
   boundary. The cross-language census passed because it checks that writers
   stamp, not that they stamp ONLY on transition.

2. **`analytics_runner.py:1238`.** The `computing_started_at` payload ships ahead
   of its own migration. Merging `supabase/migrations/**` auto-applies to PROD
   while Railway/Vercel redeploy independently; a worker that restarts first gets
   PGRST204, and the catch-all recovery write carries the SAME unknown key, so the
   job cannot even stamp `failed`.

3. **`csv-finalize/route.ts:769`.** The lone terminal-`failed` writer missing
   `computation_warned: false`; the bridge's branch (c) then resolves the row back
   to `complete_with_warnings` and shows a green factsheet built from the prior
   run's stale metrics. Money-surface false success.

4. **`test_computing_started_at_stamp.py:631`.** The TS half of the census globs
   only `src/app/api/**/*.ts` (and pins `EXPECTED_TOTAL = 4` to that same narrow
   set), so a writer added in a `.tsx` server action or `src/lib` passes silently
   and re-creates the exact permanent spinner 142 exists to kill.

5. **`test_strategy_analytics_stuck_computing_reaper.sql:339/340/343`.** Three
   unqualified table-wide neutralizing UPDATEs row-lock other tenants' in-flight
   rows on the SHARED TEST project under a 5 s `lock_timeout` — the same
   shared-DB contention class already fixed once for `e2e-seeded`.

6. **`test_job07_reaper_off_worker_loop.py:550`.** The yielding control arm pins
   REAL wall-clock latency (`< 0.1 s`) plus a `0.2 s` staleness threshold against a
   real asyncio server, while pytest shards run in parallel on a shared runner. A
   200 ms GC pause reddens `analytics` on an unrelated PR, and the message ("a
   yielding reap must not delay healthz") misdirects the next engineer to the
   reaper instead of runner contention. The property is ALREADY proven
   deterministically by the `tick_before_work` / `tick_after_work` pair — delete
   the wall-clock budget rather than loosen it.

7. **`test_computing_started_at_stamp.py:375`.** The AST gate raises on any
   `strategy_analytics` write payload it cannot statically resolve
   (`.upsert(base | extra)`, `{**base, …}` bound through two names, a dict
   comprehension, a payload returned from a helper). It is a static analyser
   masquerading as a test: an unrelated refactor into a payload-builder helper
   forces the developer to abandon the refactor or add AST arms to a 785-line test
   file. ⚠️ **Decide this one before touching 4 or 7 in isolation** — it is the
   strongest argument for relocating the whole invariant into a BEFORE
   INSERT/UPDATE trigger, where payload shape and call-site language are both
   irrelevant. A trigger would subsume findings 1, 4 and 7 at once.

8. **`test_main_worker.py:1295`.** `assert len(TIMEOUT_PER_KIND) == 15` couples
   every future job-kind addition to the reaper suite. The cheapest way to green it
   is to bump the literal WITHOUT the re-derivation the assertion message demands —
   the trip-wire trains the exact behaviour it exists to prevent. Replace with:
   assert the chain map covers every kind that can hold a `strategy_analytics` row
   at `computing` (every kind with a `strategy_id`), which does not move when a
   strategy-less kind is added.

9. **`test_job07_reaper_off_worker_loop.py:346`.** `backlog_rows=5_000` builds
   15,000 dicts across three invocations that no code under test reads (`dispatch`
   is patched; the reaper is in pg_cron and never touches the mock). The real cost
   is not cycles — the number implies backlog size is load-bearing for the healthz
   outcome, which it is not. Pass `0` or drop the parameter.

10. **`test_computing_started_at_stamp.py:107`.** `_repo_root` is copy-pasted
    verbatim into four test files, the comment-detection helper into five under two
    names, and `_py_scan_files` into three with three DIFFERENT file lists. That
    last divergence is the actual risk: on a repo-layout change one gate keeps
    covering the surface while another silently narrows and still reports green —
    the same silent-narrowing failure mode as finding 4. Extract to
    `tests/_scan_helpers.py` (or conftest) once.

11. **`migration:514` + `:103-107,165-168` (Pass B WR-02 = Pass C gap 3).** Rows
    already at `(computing, NULL)` are invisible to the reaper AND to the gate, and
    the migration CLAIMS the static CI invariant is the detection mechanism for
    them. That claim is a category error — a source scan cannot see DB rows.
    Distinct from item 4: item 4 is "the gate has a hole"; this is "no gate of any
    kind could cover it, because the rows already exist." Reachable with no source
    bug at all, via the migration-auto-applies-before-Railway-deploy window
    (item 2). Suggested remedy: a non-destructive companion cron arm that STARTS
    the clock rather than terminalizing.

12. **⛔ `supabase/schema/functions/sync_strategy_analytics_status.sql` IS STALE —
    CI IS RED (Pass C gap 1).** `npx tsx scripts/dump-sql-functions.ts --check`
    **exits 1**; ORCHESTRATOR-VERIFIED 2026-08-02, not taken on the agent's word.
    The declared canonical body is the PRE-142 function with no stamp maintenance
    at all. This is wired into a real CI job — `sql-function-snapshot.yml:84`,
    path-triggered on migrations — so the branch is red on a gate nobody ran
    locally. **Fix: `npm run schema:functions` + commit.** Do this FIRST; it is a
    one-command fix and it is currently the only hard-red gate on the branch.

13. **`.planning/REQUIREMENTS.md:53` (Pass C gap 7).** JOB-03 still specifies the
    threshold as `batch_size × max_per_kind_timeout` — ORCHESTRATOR-VERIFIED, the
    text is still there. That is the exact formula research collision C-6 proved
    would yield 9,000 s (≈4.9× too small) and reap healthy in-flight chains. The
    shipped code correctly uses the 43,920 s chain-inclusive derivation, so the
    REQUIREMENT now contradicts the implementation and would mislead anyone who
    re-derives from it. Fix the requirement text to match the shipped derivation.

14. **`142-VALIDATION.md` — 7 of 11 Falsifiability Ledger rows are `⬜ pending`
    (Pass C gap 6).** ORCHESTRATOR-VERIFIED: only SC-1, SC-1b, SC-2, SC-2b carry
    `✅ Observed`; SC-3, SC-3b, SC-4, SC-4b, SC-5, SC-5b, SC-5c were never run at
    execution time. Pass C has now RUN all seven and reports each goes RED under
    its mutation, but did NOT write them into the file. Frontmatter also still says
    `status: planned`. Backfill the seven rows from Pass C's table and fix the
    frontmatter. ⚠️ See the correction note below — this ledger was previously
    reported as fully closed, and it was not.

15. **`long_fetch.py:588-592` (Pass B WR-04 = Pass C gap 5) — LOWEST TIER, and
    included with a caveat.** The `JOB_CHAIN_FOLLOW_ON` late import and fixed-arity
    2-tuple unpack sit OUTSIDE the `try:` at `:599` whose own comment says this
    block must never crash the handler. ⚠️ **Pass A raised this THREE times and
    independent verifiers REFUTED it all three times** — correctly: the map is a
    module-level literal 2-tuple, so the unpack cannot fail at runtime today. It is
    latent, biting only after a topology edit. In scope ONLY because it is a
    two-line hoist. Do NOT let anyone record this as "Pass A missed it."

16. **The 637-line SQL gate has NEVER been run end-to-end against TEST by anyone
    (Pass C human-verification item).** Pass C proved it COMPILES (all 5 `DO`
    blocks, zero syntax errors) and reddens when the migration is unapplied, but
    Parts 2–5 need real `auth.users` / `profiles` / `compute_jobs` constraints.
    ⚠️ Orchestrator-only (MCP stripped from subagents). Settling command is in
    `142-VERIFICATION.md`, along with three more human items: cron registration,
    the PROD backfill census, and the live wizard render.

Tiering (do NOT flatten):

- **Hard-red now:** (12) — CI is failing on it.
- **Clear the founder stopping rule on their own:** (1)–(3) — user-facing or
  data-integrity. Plus (11), which is the same permanent-spinner class.

- **Evidence integrity:** (14), (16) — the phase's own proof is incomplete.
- **Do NOT clear the bar; in scope only because the phase exists:** (4)–(10),
  (13), (15). If 142.1 is cut for time, cut from here.

Sequencing notes:

1. Item 12 first — one command, unblocks CI.
2. Settle item 7's trigger-vs-static-gate question BEFORE fixing 1, 4 or 7
   separately. If the invariant moves to a BEFORE INSERT/UPDATE trigger, items 1,
   4, 7 and much of 11 collapse into that single change, and separate fixes would
   be wasted work. Pass B's cheaper alternative for item 1 alone: split
   `_mark_computing` into two statements guarded by
   `.is_("computing_started_at", "null")`.

3. Item 1's real cost is now quantified by two passes independently: worst-case
   reap ≈25.8 h (≈28 h with retries) against the migration header's advertised
   `~16h15m` — under a heading titled "CADENCE HONESTY". `TestReaperThresholdInvariant`'s
   premise no longer matches the code.

⚠️ **CORRECTION (2026-08-02, orchestrator).** Phase 142's ledger was previously
reported in-session as "11 Observed / 0 SKIPPED". That was WRONG. Four rows were
closed (the four that had been marked SKIPPED); the remaining seven were never
SKIPPED — they were `⬜ pending` and had never been run. "No SKIPPED rows remain"
was conflated with "all rows observed". Pass C caught it. Item 14 closes it.

⚠️ **Orchestrator-only work:** (1) and (2) need TEST-DB confirmation, and MCP
tools are stripped from subagents (upstream `anthropics/claude-code#13898`), so
those runs must happen in the orchestrator session, not in a gsd-executor.

✅ **Resolved (was "carried from 142"):** `142-VERIFICATION.md` now EXISTS —
status `gaps_found`, 9/10 — and 142.1 is the phase that closed its findings.
The line that used to sit here claimed no such file existed; it was stale.

Prior phase: 141.1 (seambackoff-…) — COMPLETE and verified, merged, NOT pushed
Plan: 8 of 8 (142.1 executed; verification `human_needed`, 7 UAT items open)

Prior-phase 141.1 close-out detail (retained; NOT about 142.1):
        `feat/v1.16-141-jobs-rate-retry`. Post-merge gate after Wave 2 GREEN: tsc clean,
        FULL vitest 735 files / 10450 passed / 287 skipped, tsc + lint clean.
        Wave 4 (09) merged. FINAL GATE GREEN: tsc clean, lint 0 errors, vitest
        735 files / 10450 passed / 287 skipped, pytest 4824 passed / 96 skipped.
        VERSION+package.json bumped in lockstep to 0.51.0.0.
        VERIFIED: 0 BLOCKER / 3 WARNING, 19/20 decision IDs (D-06 partial), 16/16 SC.
        The verifier re-traced 20 registry/runbook claims against live source — all
        held. All 3 warnings CLOSED: stale D-06 coordinate replaced with a symbol
        anchor; the two deferred-item ledgers reconciled; the falsifiability ledger
        transcribed 20/20 with three mutations recorded as explicitly UN-RUN
        (SC-C' green-polarity only, SC-G' 2 of 5 anchors un-mutated, SC-K jitter
        constant never mutated alone). Approval: CLOSED 2026-07-31.
        ⚠️ 4 items stay OPEN in TODOS.md: DEF-141.1-02-A/02-B/06-A/09-A.
        ⚠️ FOUNDER ACTION: RESEND_API_KEY + FOUNDER_LP_REPORT_TO must be set in
        Vercel prod or the repaired flag-monitor alert computes correctly and pages
        nobody. The numerator is correctly scoped but has NEVER been observed firing.
        ⭐ SC-E RESOLVED. Precise history (corrected at verification — the earlier
        wording here was itself an over-claim): PRE-D-08 the row fallback WAS
        reachable (the validator was wrapped in `!== undefined`), so 141.1-04's D-08
        change closed a REAL hole. What was wrong was only 04's follow-up
        MEASUREMENT — having closed it, 04 re-added `?? SEAM_BUDGETS[budgetKey].retries`
        as a mutation, saw green, and booked its own already-closed hole as still
        open. Post-D-08 the validator is unguarded, so `undefined` throws
        SeamConfigError first and that mutation is a no-op by construction. 141.1-06
        established this and closed the axis at three independent points via the
        semantically live form. Verified: 04's false framing did NOT propagate into
        the runbook, CHANGELOG, or TODOS.
        ⚠️ ORCHESTRATOR ERROR: `isolation:"worktree"` forks from the DEFAULT BRANCH
        (#2015) — 3/3 spawns came up on `origin/main` 56–67 commits stale, missing
        their `depends_on` commits. GSD prevents this via the `EXPECTED_BASE` +
        `<worktree_branch_check>` block (`execute-phase.md:519,573`); hand-written
        executor prompts OMITTED it. All merged worktrees were verified to contain
        their dependencies, so landed work is sound. Wave 4 uses the verbatim block
        and one-Agent-per-message dispatch (`.git/config.lock` race, `:531`).
        ⚠️ Wave 1 was interrupted by a host restart on 2026-07-31 and resumed in the
        original worktrees. Lesson recorded in `141.1-WAVE-MANIFEST.md`: an
        uncommitted diff left by a killed executor may be an acceptance MUTATION
        mid-probe, not progress — 141.1-08's orphaned `route.ts` diff was exactly
        that (it re-added the dead `path:` term) and was correctly discarded.
        ---- 140.2-05 (wave 5, 2026-07-27) ----
        **ROADMAP SC1 CLOSED.** The classification window now covers the response-body
        read and excludes caller/config faults. A stalling upstream (headers fast, body
        slow) records exactly ONE breaker failure and throws a typed `SeamBodyReadError`;
        a malformed `ANALYTICS_SERVICE_URL` or an invalid `timeoutMsOverride` throws
        `SeamConfigError` BEFORE the window and records ZERO. `redirect: "error"` is on
        every seam call, after the spread so a call site cannot re-enable following.
        A-21+A-22+A-23+A-28 landed in ONE commit (`8322bec4`) after an observed RED
        (15 failing cases). All nine body-read sites instrumented; **zero new catch arms
        outside the two clients** and `postProcessKey` still never throws (its `try` was
        extended over the body read; the new class maps onto the EXISTING 504/502
        envelopes — zero new user-facing copy). M26/M31/M36/M37 observed and reverted.
        ⚠️ **`SEAMCORE-11` is HALF closed and deliberately NOT marked complete:** A-22 /
        A-23 / A-28 are done here; A-15 and A-27 (rows M49, M50, M58) belong to 140.2-11.
        ⚠️ Deferred, real: the `>= 500` arm and the body-read arm can DOUBLE-record for
        one request — closes when 140.2-06 replaces the `>= 500` branch.
        (reconciles `4743 + 4 + 5 + 19 + 1`), mypy 89 files clean, **zero TypeScript in the
        phase diff**, 0 new `# type: ignore`, `grep -rn MUTANT` → 0.
        ⚠️ **PYAPIFIX2-01 is HALF closed on purpose: PYTHON HALF CLOSED (7/7 sites carry
        code+recoverable); RENDER HALF → OB-1 / ledger row TS-35, owner 140.3.** ROADMAP SC1
        and REQUIREMENTS both carry that clause; `/gsd:verify-work` must mirror it verbatim
        into `140.1.2-VERIFICATION.md`, which does NOT yet exist (no stub was created —
        a `status:` field would be a verdict the executor has no authority to give).
        `140.1.1-VERIFICATION.md` was flipped to `status: gaps_found` by this phase.
        ---- historical (Phase 140.1.1) ----
        **PYAPIFIX-05 batch 2 CLOSED (plan 07) → 13/13 survivors phase-wide.**
        8 more mutation runs, **every RED OBSERVED FIRST-HAND**, zero
        "asserted only", zero non-reddening findings. ⭐ **slowapi synced
        0.1.9 → the CI pin 0.1.10 BEFORE any #3/#4/#5 cycle and LEFT there**
        (both dependent internals re-confirmed on 0.1.10: the `if all(args)`
        empty-key skip at `extension.py:506-527`, and `view_rate_limit` =
        `(limit, [key, scope])` at `:530`). #3 `default_platform_key` →
        `return ""` ⇒ 3 failed incl. **`never answered 429 within 4 calls`**;
        #4 → per-request uuid ⇒ 3 failed incl. the stability assertion. The
        old oracle asserted function IDENTITY (true for any body), so the new
        gate drives REAL HTTP requests through a route declaring no
        `key_func`; the `:483` identity assertion is retained. #5
        `_retry_after_seconds` → `return 1` ⇒ 2 failed — `0 < 1 <= 3600`
        passed the old bound, so a `> window * 0.9` band was added at BOTH
        weak sites. New file `tests/test_tenant_claim_parsing.py` (14 tests):
        the four claim-parser guards had **NO test at all**. #8 ⇒ 2 failed
        (⚠️ fixture is a VALID-but-oversized 513-char claim; junk would not
        redden), #9 ⇒ 3 failed, #10 ⇒ 3 failed (mutant bucket literally
        `'claimtest:t:'`), **#11 closed 2 of 2** — `:333` and `:417` each
        reddened a *different single test* with the other green, which is the
        proof of independent coverage. **Phase-wide gate, all five first-hand:**
        pytest **4743/96/0** (4724 + 5 + 14, reconciles exactly) · collection
        4837, 0 errors (the 4837-vs-4839 delta traced to 2 PRE-EXISTING
        module-level skips, not assumed) · mypy 89 files clean · tsc 0 ·
        full vitest+coverage **8878 passed / 0 failed**, all four thresholds
        clear · lint 0 errors · **0** new `# type: ignore` phase-wide ·
        `grep -rn MUTANT` → 0 · **zero production files modified**.

        **PYAPIFIX-05 batch 1 CLOSED** (plan 06 — survivors #1/#2/#6/#7/#12 + the
        M-15 fold-in). 6 mutation cycles / 8 runs, **every RED (and the two
        required GREENs) OBSERVED FIRST-HAND**, zero "asserted only" rows:
        #1 `except ccxt.BaseError`→`NetworkError` ⇒ 3 failed; #2 →
        `ExchangeNotAvailable` ⇒ 6 failed (both `assert 500 == 424`); #6
        `"supabase": 15`→`900` ⇒ 4 failed `assert '900' == '15'`; #7
        `_KEK_ALERT_WINDOW_S 300.0`→`1e18` ⇒ 1 failed `assert 1 == 2`; #12 junk
        copy ⇒ 1 failed. M-15's self-referential `len(_SHAPES) == 6` **DELETED**
        (with its false docstring) and replaced by an **AST-fingerprint SET**
        read from the router's own source; all three probes observed — a 7th 200
        shape ⇒ 1 failed naming `dict:code,mutant,ok`, a pure line shift ⇒ green,
        an added `status_code=418` return ⇒ green. Wave-3 gate: pytest **4724
        passed / 96 skipped / 0 failed** (4716 + 7 + 1, reconciles exactly),
        mypy --strict 89 files clean, 0 new `# type: ignore`,
        `grep -rn MUTANT` → 0, **zero production files modified**.
        ~~**Still open for plan 07:** slowapi survivors #3/#4/#5 and
        claim-parser #8–#11.~~ → **ALL CLOSED by plan 07 (above).**
        **PYAPIFIX-01 CLOSED** (plan 05 — the TS half, and the wave-2 vitest gate):
        the mixed-envelope rejection is DELETED and the union widened in
        `src/lib/process-key-onboard-contract.ts`, with THREE compensating invariants
        (non-empty `code`; `idempotent` present ⇒ `true` AND `code ===
        "WIZARD_DUPLICATE"`; `verification_id` string retained on the `queued:true` arm).
        **The cross-process oracle is BIDIRECTIONAL, observed first-hand:** neutering
        `_wizard_duplicate_reply` (`"code"`→`"codes"`) reddens the pytest (2 failed,
        key-set assertion); neutering the predicate (`return true` first) reddens the
        vitest (4 failed — every negative wrongly accepted). Both restored from scratch
        copies OUTSIDE the repo, tree clean, `grep -rn MUTANT` → 0.
        `route.test.ts:1474` REWRITTEN not deleted (59 → **61** tests, 0 deleted) with
        TWO retained negatives. Wave-2 vitest gate PAID: **8878 passed / 0 failed**,
        coverage 84.36/78.37/81.43/86.49 vs thresholds 80/72/74/82, tsc 0, lint 0 errors.
        Python re-verified after the neuter cycles: **4716/96/0**, mypy 89 files clean.
        `140.1-TS-OBLIGATIONS.md` reconciled (TS-01/TS-03 **DONE**, TS-02 sharpened,
        TS-23 **UNBLOCKED**, TS-32/TS-33 added; count 31 → 33; TS-04..22/24..31
        untouched). **M-11 DECIDED and RECORDED, not implemented:** onboard's dedupe is
        **UNWIRED, not broken** — the remedy is ONE payload field (`wizard_session_id`
        at `finalize-wizard/route.ts:840-851`), now ledger row TS-33; its "strictly
        after PYAPIFIX-01" ordering is now **SATISFIED**.
        2 WARNING gaps, no BLOCKER. See `140.1-VERIFICATION.md`. Not transitioned (`--no-transition`).

Progress: [████████░░] 84%

### Phase 140.1 close-out — open items (do NOT lose these)

- **Gap 1 (SC-6 / PYAPI-08, warning):** two in-handler throttle sites raise a plain
  `HTTPException(429)` and cannot reach the app-global `RateLimitExceeded` handler —
  `analytics-service/routers/simulator.py:249`, `analytics-service/routers/match.py:1742`.
  Both pre-date the phase. Two 429 shapes coexist (FINDING-12).

- **Gap 2 (PYAPI-03, warning):** `analytics-service/routers/simulator.py:92` is a TENTH
  IP-keyed route (`f"simulator:ip:{get_remote_address(request)}"`). PYAPI-03 is **9/9,
  not 10/10**. Quarantined behind an `IP_KEYED_QUARANTINE` equality assertion.

- **⚠️ Ownership gap (most likely to be silently dropped):** obligation **TS-04** —
  `src/lib/analytics-client.ts` must mint `X-Tenant-Claim`. Until it does, the nine
  rekeyed routes run `platform:<path>`, NOT per-tenant. Python side is complete; the
  flip needs ZERO Python changes. TS-04 appears in `140.1-TS-OBLIGATIONS.md` but in
  **none** of Phase 140.2's ROADMAP success criteria — nobody is contractually obliged
  to land it. Add it to 140.2's criteria at plan time.

- **Known regression:** `_scope_rejected` (`analytics-service/routers/process_key.py:1295-1299`)
  is a three-arm OR behind one return, so ordinary `not val.valid` failures answer 403
  where 422 would be sharper.

- **Carried:** `analytics-service/main.py` sits OUTSIDE the mypy gate paths (5 standalone
  errors, all pre-dating baseline `43449cc6`); exclusion determined NOT deliberate.

- **4 human-verification items** in `140.1-VERIFICATION.md` (two new supabase/tests SQL
  gates unexecutable without TEST-DB credentials, PROD migration watch, two product
  judgments on the 200→403 move).

- **Cross-phase inputs:** `140.1-TS-OBLIGATIONS.md` — 31 obligations
  (140.2→16, 140.3→4, 146→3, 145→2, ops→4, needs-own-plan→2). 140.2/140.3/145/146
  planners MUST read it instead of re-deriving from `140-FINDINGS-CONSOLIDATED.md`.

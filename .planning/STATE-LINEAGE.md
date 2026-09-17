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

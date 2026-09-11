# Stopping rule for review recursion — proposal

**Written:** 2026-09-10, against `TODOS.md` (244 open `- [ ]` ids, measured), `ROADMAP.md`
(22 `### Phase 164` headings, measured), `164.7-REVIEW.md` (both sections), `164.7-SECURITY.md`,
and the 164.8.4 GATERESIDUE roadmap entry.
**Status:** proposal. Nothing here is adopted until it is pasted into `CLAUDE.md`.

⛔ Every number below came from a command run today. The classification of the 244 is a judgment
made from each id's headline (first 220 chars of its `- [ ]` line) — the full text was read only
for the 164.7 and 164.8.4 items and a handful of ambiguous headlines. The per-id table is in the
session scratchpad (`classification.tsv`); it is not committed because the classification is an
input to a decision, not a ledger.

---

## 1. The 244, classified

Ladder used (the candidate's, with one clarification that turned out to matter):

- **D0** — production code or data. A user, their money or their data is on the other side.
  Includes PROD schema drift, unlanded prod bug fixes, and unbuilt product features.
- **D1** — a control observing D0: SQL gates, migration verify blocks, prober arms, VAC-04/08,
  `lint-app-guc`, DB constraints, e2e specs, unit tests of product code, alerting/observability,
  and the TEST-preprod pipeline **where it blocks a PROD deploy**. ⭐ **A bug in a D1 control is a
  D1 finding** (the subject is still the control). Only a control that observes a control is D2.
- **D2** — a control observing a D1 control: the mutation runner, red fixtures, gate self-tests,
  lints over test files (`class-lint`, `audit-coverage`), floors/ratchets, CI plumbing of gates,
  and shared-TEST substrate fidelity (restore, reseed, lock contention).
- **D3** — the record: prose, comments, `file:line` citations, docblocks, changelog, planning
  ledgers (`WINDOWS.md`), and workflow tooling (GSD sdk quirks, `-pr` filter, CI cost).

| Depth | Count | Share | Verbatim examples (headline) |
|---|---|---|---|
| D0 | **95** | 38.9% | `size_at_decision_usd is recorded on a NOTIONAL basis while the composer sizes on an EQUITY basis` · `C-2 / A-4 — a rotated venue password re-connect reports success and stores nothing` · `[158-OPS-03/SEC] ⛔ ROTATE the two leaked demo accounts` · `[DRIFT-06] PROD runs an EARLIER revision of three function bodies` · `fix/sync-status-superseded-failed — an entire MIGRATION that never landed` · `Retired job kinds still carry a live daily enqueue that has fired nothing since` · `IN-09 key={displayed} remounts the dollar input on Enter` |
| D1 | **72** | 29.5% | `[164.7-CR03-HYGIENE-BYPASS] The ten hygiene rules still return ZERO violations on a command that inlines a live service key` · `[VAC04-C] "VAC-04 reports PASS having compared nothing" is a THIRD cycling primitive` · `[REDUNDER-COVGAP-01] test_funding_fees_rls.sql Assertion 2 cannot falsify its OWN conjunct` · `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE] A migration that is VALID on PROD can REFUSE on TEST` · `[158-OPS-03] discovery-watchlist.spec.ts — wire-later` (×18 sibling lines) · `[164.8.2-LEDGER-STDERR-PUBLIC-LOG]` |
| D2 | **33** | 13.5% | `[VAC08-SELFTEST-CI] VAC-08's five-arm self-test never runs in CI` · `[REDUNDER-GATESELF-UNBOUNDED] The "mutate the gate's own setup" twin class has NO ceiling` · `[164.8.4-SCOPE-DEPTH-AXIS] the class-lint's scope sentence outruns its filter for the THIRD` · `[VAC-SELFREF-01] lint-sql-gates.test.ts asserts properties of a string literal it defines two lines above` · `[164.8-PUSH-RACE-VAC08]` (booked TWICE — lines 2919 and 7745) |
| D3 | **44** | 18.0% | prose (26): `[164.7-CITATION-DRIFT-01] Line-number citations in the 164.7 artifacts drifted by ~4 lines` · `HoldingsTable.tsx D-15 comment cites StrategyTable.tsx:1067-1085; the precedent now lives at :1169-1179` · `[MUT-I02] corpus-measurement header understates the migration count by 148` · `Two cosmetic verify-precision notes from Phase 164.3's plan gate` — process/tooling (18): `GSD gsd-sdk query state.* verbs take NAMED flags` · `[WINDOWS-LEDGER-DRIFT]` (one of **4** open ids about `.planning/WINDOWS.md`) · `[CI-DOCSPATH-01] a PR that changes NO code runs the entire gate corpus` |

**Three measured facts that matter more than the D3 count:**

1. **D3 is 44 of 244, not 8.** A rule that refuses to book D3 removes 18% of the backlog and
   every one of the four `WINDOWS.md` ids. That is worth having, but it is not the bulk.
2. **Ids are booked per INSTANCE, not per closing mechanism.** The 18 `[158-OPS-03] <spec>.spec.ts
   — wire-later` lines are one class ("wire the seeded e2e specs into CI") booked eighteen times.
   `[164.8-PUSH-RACE-VAC08]` is booked twice. The opposite gaming already exists too:
   `[164.8.2-GATE-RESIDUE]` ("seven small items") and `[164.7-REVIEW-INFO-FOUR]` bundle unrelated
   leftovers under one id to stay under an implicit count. **Neither a per-id budget nor an
   instance rule fixes this; only "one id ⇔ one closing mechanism" does.**
3. **D0 + D1 = 167 (68%).** Two thirds of the backlog is legitimately product or control work.
   The recursion tail is not what makes the number 244; instance-booking and D2/D3 booking are.

---

## 2. The candidate rule against real history

### 2a. `164.7-REVIEW.md`, original deep review (5 CR / 11 WR / 4 IN)

| Finding | Depth | Counterfactual | Rule's verdict | What actually happened |
|---|---|---|---|---|
| CR-01 username/database uncompared | D1 | NO (coverage gap, latent) | owning phase | → 164.8.5 ✓ |
| CR-02 marker read, never compared | D1 | NO for the migration ship; **no ship to hold** for the prober (shipped in 164.1) | owning phase | → 164.8.5 ✓ |
| **CR-03 ten hygiene rules, zero violations on an inlined key** | D1 | **YES** — vacuous control on a secret-handling path (the anti-gaming clause) | fix now, blocks | fix written → reviewed → reverted → 164.8.5 |
| CR-04 omitted `active` accepts a disabled job | D1 | NO (all 14 rows carry it today) | owning phase | → 164.8.5 ✓ |
| CR-05 migration check 6 cannot fail | D1 | NO — the body it fails to check is verified true by VAC-04 and the arms; needs a forward migration | owning phase | → 164.8.6 ✓ |
| WR-01 Vault read not STRICT | D0 | NO at ship (needs a duplicate secret); register says `high` | owning phase | → 164.8.6 ✓ |
| WR-02 `service_role` EXECUTE | D0 | NO (defence in depth) | owning phase | → 164.8.6 ✓ |
| WR-03 comment-strip analysis inverted | D3 + latent D1 | NO | fix the header in-commit, no id | booked |
| WR-04, 05, 06, 07, 10, 11 | D1 | NO | owning phase | → 164.8.5 ✓ |
| WR-08 contradictory ack blocks | D3 | (cannot be YES) | fix in-commit, no id | booked as `[164.7-MIGRATION-COMMENT-DRIFT]` |
| WR-09 data-dependent escape instances | D1 | NO | owning phase (164.9) | → 164.9 ✓ |
| IN-01..04 | D1 latent | NO | in-phase with their control, no id | bundled as `[164.7-REVIEW-INFO-FOUR]` |

The rule keeps CR-03 and routes the rest exactly where they went. It would have refused two D3
ids and one bundle id. **One miss:** the "one successor" budget is wrong — 164.7 correctly spawned
TWO phases because the findings have two different subjects (a prod function; a prober). Budget
by subject, not by count.

### 2b. `164.7-REVIEW.md`, SHIP-TIME SPECIALIST REVIEW (the round that caught the regression)

| Finding | Depth (by SUBJECT) | Counterfactual | Rule's verdict |
|---|---|---|---|
| SR-01 the repair SUPPRESSES credential detection | D1 | **YES** — a detected leak became undetected | fix now, blocks |
| SR-02 CR-03's fix is vacuous AND harmful | D1 | **YES** | revert |
| SR-03 five of six new controls cannot fail | D1 (subject = the new controls; the neuter matrix is the instrument, not the subject) | **YES** | fix now, blocks |
| SR-04 `opts.liveMarker` opt-in | D1 | NO (could-not-measure collapse, no leak) | with the control |
| SR-05..09 dead branch, dup helper, half-updated comment, overstated rationale, two shapes | D3 | (cannot be YES) | fix in-commit or drop |

⭐ **The rule is NOT disqualified — but only because of the termination clause, and that is
fragile.** The round that caught SR-01/02/03 ran because generation N (the audit) had a YES
(CR-03). Had CR-03 been graded NO — and "the split-key shape is hypothetical" is a plausible
grading — the candidate rule's "run N+1 only if N produced a YES" would have **skipped the round
that caught a security regression**, and commit `84b21cb5` would have shipped. The catch did not
come from a *review generation* at all; it came from the **anti-vacuity discipline applied to a
FIX** (byte backup, neuter, run, restore — `164.7-REVIEW.md:849-850`, `:900-912`). That
discipline must be unconditional on the fix, not gated on how the previous round graded.

**Conclusion:** the candidate's termination clause conflates two different things — *verification
of a change* (which must always run, is mechanical, and is not recursion) and *discretionary
reading reviews* (which are the recursion). The replacement rule in §4 separates them.

### 2c. `164.7-SECURITY.md` — 31 threats, 3 open, 2 blocking

The register's two blocking threats (T-164.7-07 hygiene bypass, T-164.7-08 absent-secret →
silent 401) are the SAME subjects as CR-03 and WR-01/`[VAULTTICK-EMPTYKEY-01]`. The rule grades
CR-03 YES and WR-01 NO; the register grades both `high`. That is a real disagreement, and the
register is the stricter reading. **The rule must inherit `block_on: high` from the security
register rather than re-grade a registered threat** — otherwise a reviewer can downgrade a
`high` threat by calling its counterfactual NO. (The non-blocking T-164.7-02, `successor` check
satisfied by any file, grades D1/NO under both — agreement.)

The register also records `threats_open` unchanged by the revert and the ship gate correctly
blocking (`:226-230`). The rule keeps that: a routed finding is a plan, not a mitigation.

### 2d. 164.8.4 GATERESIDUE — the deepest recursion

Twelve ids under one residue phase. By depth: **1 D1/YES**, 5 D1/NO, 4 D2, 3 D3 (one of which,
`[WINDOWS-LEDGER-DRIFT]`, the entry itself admits is "NOT 164.8.2 residue").

- **Kept:** `[164.8.2-LEDGER-STDERR-PUBLIC-LOG]` — pooler host and user into a world-readable
  Actions log, against the file's own NON-NEGOTIABLES. D1/YES. Under the rule it is fixed in
  164.8.2 before ship, **as a class sweep over every psql site** (the repo's own learning: "fixing
  the instance a reviewer named, rather than the class, produces a half-class that the next round
  finds again"), not deferred two phases down.
- **Routed to 164.9, not to a residue phase:** `REDACT-HOSTNAME-01`, `EVIDENCE-DOTENV-LEAK`,
  `REFUSAL-STILL-PUBLISHES` (a founder decision, not a finding), `164.7-MARKER-GREP-VACUOUS`
  (inherent — CLAUDE.md already says the SQL editor has no guard). All are shared-TEST subjects;
  164.9 TESTISOLATION owns shared TEST.
- **Dropped as ids, fixed with their control:** `SENTINEL-GREP-NUL-BLIND` (already a ceiling
  exemption), `CHANNEL-ALLOWLIST-STALE`, `GATE-RESIDUE` (seven), the five `[164.8.4-*]` LATENT/
  COSMETIC/REACH items — the terminal round's own verdict was "none CARDINAL".
- **Dropped outright:** `[164.6-SOURCE-ANCHOR-ROT]` (D3 — the roadmap wants a GATE built to
  protect line numbers in comments; the answer is the convention already recorded on
  `[164.7-CITATION-DRIFT-01]`: cite by symbol), `[164.7-PLAN03-EVIDENCE-01]`,
  `[164.7-CITATION-DRIFT-01]`, `[WINDOWS-LEDGER-DRIFT]` (fix the ledger in a commit or delete it;
  four open ids for one planning file is the D3 problem in miniature).

Verdict: the rule keeps the one thing that mattered and dissolves the phase. 164.8.4 should not
exist as a phase; its one YES belonged in 164.8.2, its D1/NO items belong in 164.9.

⚠️ **The roadmap already records a founder stopping rule, and today it was misapplied in the
OTHER direction:** "Phase 164.8.5 SCOPEAXIS was created for these five and then withdrawn. It was
opened on a misreading of the founder's stopping rule: that rule was CONDITIONAL on the terminal
review round still finding cardinal errors, and it found none." (164.8.4 entry). So the rule
exists informally as "stop when a round finds nothing cardinal" — what is missing is a
definition of *cardinal* that a model cannot argue with, and a home for non-cardinal findings
that is not a phase.

---

## 3. Failure modes of the candidate rule

**Who assigns depth, and depth-shopping.** The reviewer that finds it — a model. Downward
shopping (D1 → D2 by naming the fixture instead of the control, or D1 → D3 by naming the docstring
beside the bug) dodges a block. Fix: **path assigns a floor depth; a reviewer may only RAISE it,
and must quote the D0/D1 subject to do so.** `src/app`, `analytics-service/` runtime,
`supabase/migrations` executable lines, `supabase/schema/functions` → D0 floor.
`supabase/tests`, `scripts/prod-prober`, `scripts/*-check.sh`, `src/__tests__`, `e2e/`,
`.github/workflows`, migration `DO $verify$` blocks → D1 floor. Fixtures, self-tests,
`scripts/mutation-runner`, `scripts/lint-sql-gates.mjs` and its tests → D2 floor. `.planning/`,
`docs/`, `CHANGELOG.md`, comment-only hunks → D3 floor. The candidate's "depth is about the
SUBJECT" clause survives as the raise rule: a vacuous control in a monitoring script whose
subject is a secret path is raised to D1 by quoting the path. Upward shopping costs time, not
safety, and is tolerated.

**The counterfactual is a judgment call — make it a closed list.** "Would it have held the
ship?" invites exactly the argument that a careful reviewer always wins. Replace it with
**CARDINAL = any one of four measured conditions**, everything else NO by default:
(i) a secret or credential reaches a log, artifact, header, repo or database it should not
— shown by execution; (ii) a control on a secret-, money-, PROD-write- or data-path CANNOT FAIL
— shown by neuter (RED not observed) or by an executed bypass; (iii) user-visible behaviour or a
stored figure is wrong on the real path — shown by execution; (iv) a PROD write or deploy can
execute against the wrong target. "Latent", "hypothetical", "a future editor might", "the
docstring licenses" are NO. This kills the judgment except "is it demonstrated", and
demonstration is already this repo's standard (`164.7-REVIEW.md:24`: "every executable claim
below was RUN, not reasoned").

**Shallow generations banking a NO.** With the candidate's "two consecutive NO generations end
the lineage", a deliberately thin round is a free exit. Fix: a round only COUNTS if it ran the
standing mechanical checks (`mutation-runner`, every self-test, the neuter of every NEW control
in the diff). Then thin and thorough rounds run the same machinery and the exit cannot be
banked by reading less. Better still — drop the generation count entirely and bound recursion
structurally (§4): a PR gets one reading review of the change and one of its fixes; a fix that
fails its review is reverted and its subject leaves the PR.

**The 5-id budget pushes work into vaguer ids.** It already has, before the rule exists:
`[164.8.2-GATE-RESIDUE]` and `[164.7-REVIEW-INFO-FOUR]` are the shape. And the opposite failure
(18 ids for one class) shows a count in either direction is the wrong invariant. Replace with:
**one id per closing mechanism** — if two findings close by the same edit they are one id; if one
id needs two unrelated edits it is two ids. A reviewer who cannot name the closing mechanism has
not finished the finding.

**"D3 cannot be YES" is right; "standing register" is wrong for this repo.** The founder
consolidated 16 trackers into `TODOS.md` on 2026-07-23. A new register is tracker 2. Instead:
D3 findings are fixed in the current commit if the file is already touched, otherwise dropped.
D2 gaps are not deferrals either — a D1 control without its red fixture is an *unfinished D1
control*, so the D2 item is closed in the same phase as the control or the control is not done.
No new artifact is needed; the only findings that persist are D0/D1, and they persist in
`TODOS.md` under the phase that owns the subject.

**"One successor per phase" is wrong by construction.** 164.7's findings had two subjects and
correctly got two phases. The hazard is not the number of successors but the *residue phase*:
a phase defined as "the leftovers of phase X". Measured on the 164.x headings: 164.8.2 ("the five
code-review warnings Phase 164.8 shipped"), 164.8.4 ("every deferral Phase 164.8.2's four review
rounds produced"), 164.6 ("every gate-hygiene item that left 164.1") and 164.4.1 ("retire the
REDUNDER-PGCRON deferral") are residue-named; 164.8.5 PROBERPARSE and 164.8.6 VAULTTICKFIX are
subject-named. The rule forbids the former shape.

---

## 4. Recommendation — one rule, paste-ready

```markdown
## Review stopping rule (founder decision, 2026-09-10)

Two kinds of round exist, and only one of them recurses.

**VERIFICATION of a change is unconditional and mechanical.** Every PR runs the standing gates,
every self-test, and a neuter → RED → restore of EVERY control the diff adds or changes. This
never stops early and is not a review generation. A control the neuter cannot redden is not
shipped; it is not "booked".

**READING reviews are bounded per PR: one of the change, one of its fixes, none of the fix of
the fix.** A fix that fails its reading review is REVERTED and its subject routed — never
re-fixed in the same PR. Post-merge audit sweeps are discretionary: at most one per milestone,
scheduled in the roadmap, and their findings route like any other.

**Every finding is graded on two axes before it is written down.**

Depth — the PATH sets a floor; a reviewer may only RAISE it, quoting the D0/D1 subject:
- D0 `src/app`, `analytics-service` runtime, executable migration lines, `schema/functions`
- D1 `supabase/tests`, `scripts/prod-prober`, `scripts/*-check.sh`, `src/__tests__`, `e2e/`,
  `.github/workflows`, migration verify blocks. ⭐ A bug in a D1 control is D1.
- D2 fixtures, self-tests, `scripts/mutation-runner`, `lint-sql-gates` and their tests
- D3 `.planning/`, `docs/`, `CHANGELOG.md`, comment-only hunks, `file:line` citations

CARDINAL — YES only if one of these is DEMONSTRATED by execution, else NO:
(i) a secret/credential reaches a log, artifact, header, repo or database it should not;
(ii) a control on a secret-, money-, PROD-write- or data-path CANNOT FAIL (neuter stays green,
or an executed bypass); (iii) user-visible behaviour or a stored figure is wrong on the real
path; (iv) a PROD write or deploy can run against the wrong target.
A threat the phase's SECURITY register grades ≥ `block_on` is CARDINAL regardless — the rule
never re-grades the register downward. "Latent", "hypothetical", "a future editor might" = NO.

**Disposition is then mechanical:**

| | CARDINAL | not cardinal |
|---|---|---|
| D0 | fix the CLASS in this PR; blocks | fix here if the file is touched, else TODOS under the owning phase |
| D1 | fix the CLASS in this PR; blocks. If the class is too big for this PR, the PR is not ready | TODOS under the phase that OWNS THE SUBJECT |
| D2 | (cannot be — raise to D1 by quoting the subject) | closed in the same phase as its D1 control; a D1 control without its red fixture is unfinished, not deferred |
| D3 | (cannot be) | fixed in this commit if the file is touched, otherwise DROPPED. Never an id, never a phase |

**Booking:** one TODOS id ⇔ one closing mechanism. A finding whose closing edit is not named
is not finished. Ids are grouped by mechanism, never by phase-of-origin or by count.

**Phases:** a finding routes to the phase that owns its SUBJECT. A new phase is opened only
when no phase owns the subject, is named for the subject, and ⛔ is never defined as the
residue, leftovers or deferrals of another phase. Two subjects ⇒ two phases; that is not
recursion.

**Termination is structural, not counted:** a lineage ends when the last PR's reading review
of its fixes finds nothing CARDINAL. Non-cardinal findings do not open a round; they route or
drop by the table above.
```

### What it does NOT solve

- **The 22 phases.** The recursion lineage is 164.7 → 164.8.2 → 164.8.4 → 164.8.5/164.8.6 —
  **five of the twenty-two**, and this rule would have collapsed 164.8.4 into 164.8.2 + 164.9 and
  stopped 164.8.2 from being a residue phase. The other seventeen are three legitimate programs
  and five incidents mis-filed under one number because decimal insertion is free. **That is a
  milestone-scoping problem and no stopping rule touches it.** The honest fix: close v1.20 with
  SHARE; give the anti-vacuity program (164.3/.3.1/.4/.4.1/.6) and TEST-preprod (164.5/.8/.8.1/.9)
  their own milestone numbers; and route incidents (164.1, 164.5.1, 164.5.2, 164.8.3, 164.10) to an
  ops lane that produces a fix and a prober arm, not a phase each.
- **It does not shrink 244 to 100 by itself.** It refuses 44 D3 ids and folds 33 D2 ids into
  their controls; the remaining 167 are real D0/D1 work and stay. The 18-for-one e2e bookings
  shrink only when the "one id per mechanism" clause is applied retroactively.
- **Depth-raising is still a judgment.** The path floor stops downward shopping; nothing stops a
  reviewer raising everything to D1 and calling it CARDINAL. That costs time, not safety, and the
  four-condition list requires a demonstration, which is the expensive part to fake.
- **A reading review of a fix can still be wrong.** SR-01 was caught by constructing a scenario,
  not by neuter. The rule mandates the neuter (mechanical) and one reading review of the fix
  (judgment); it does not make the judgment infallible, it bounds how many times it runs.

### Relationship to the founder's existing informal rule

"Fix everything; only user-facing or data-integrity findings BLOCK; maintainability/comments/
testing are exempt from the confidence threshold."

This **refines** it in two places and **contradicts** it in one:

- **Refines the BLOCK set.** The informal set would NOT have blocked SR-02 or SR-03 — five vacuous
  controls in a prober are neither user-facing nor data-integrity. They were blocked because the
  specialists applied CLAUDE.md's anti-vacuity doctrine, which the informal rule does not name.
  Condition (ii) puts it in the BLOCK set explicitly, so the two documents stop disagreeing.
- **Refines "fix everything."** Fixing every D2/D3 finding is what generates the next round's
  material. The refinement: fix every D0/D1; D2 closes with its control; D3 is fixed in-commit or
  dropped. Nothing is exempt from being *fixed* when cheap — it is exempt from being *booked*.
- **Contradicts "every deferral must name a PHASE" for D3 only.** That rule, applied to prose
  findings, is what produced four ids for one planning ledger and a roadmap criterion to build a
  gate over comment line numbers. D3 findings are not deferrals; they are edits or nothing.

---

## What I could not establish

- **A per-id counterfactual for all 244.** The CARDINAL grading in §2 covers the 20 + 9 findings
  of `164.7-REVIEW.md` and the 12 ids of 164.8.4, where I read the full text. For the rest of the
  244 I classified depth from the headline only; I did not grade cardinality, so I cannot report
  "N of 244 would have blocked."
- **Whether the 5 D3-prose fixes I call "cheap" actually are** — no D3 edit was timed.
- **How many of the 22 phases a reviewer would have opened under this rule** beyond the five in
  the lineage; that needs the same exercise run over each phase's REVIEW.md, which I did not do.
- **Whether `164.8.5`'s in-flight commits (`49a50d41`, `05521515`, `35d09377`) already satisfy
  the fix-review bound** — they landed on this branch during the session and I did not review
  them.

# Phase 164 — Red-team corpus (6 teams, 2026-08-27)

All [M] items were MEASURED on throwaway PostgreSQL 16 clusters with the real
migration applied verbatim. [R] = reasoned.

## Team 1 — Resurrection paths

Guarantee: "once revoked, that URL never works again."
Decomposes into TWO families; prior rounds only examined the first.

FAMILY R (resurrection — a revoked (strategy_id, generation) goes live again)
- R1  generation rewind on existing row .................. CLOSED (trigger rule 1) [M]
- R2a strategy_id re-point among own strategies .......... OPEN  [M]
- R2b CASCADE from `strategies`: owner DELETEs own strategy, re-INSERTs with the
      SAME client-suppliable uuid, re-mints ............... OPEN  [M]
      token gen1 before  = JJ9eut3xQ8RRGav7DaDJo0c8AFZbDPD8OJt-XRySQOQ
      token gen1 after   = JJ9eut3xQ8RRGav7DaDJo0c8AFZbDPD8OJt-XRySQOQ  (bit-identical)
      ⛔ a strategy_id column pin CANNOT touch this — the delete is on another table
- R2b' UUID SQUAT: a DIFFERENT user re-creates the uuid; A's revoked URL now
      resolves to B-CONTROLLED CONTENT ................... OPEN  [M]
      precondition: B knows the uuid, which appears in every /factsheet/<id> URL
- R2c profiles cascade ................................... CLOSED (20260529150000 revokes) [M]
- R2d/e direct DELETE / TRUNCATE ......................... CLOSED (42501) [M]
- R2f TRUNCATE strategies CASCADE ........................ CLOSED (PG requires TRUNCATE on each) [M]
- R2g service_role DELETE ................................ OPEN by transport [M]
- R3  INSERT is wholly unguarded: trigger is BEFORE UPDATE only; GRANT INSERT is
      column-unrestricted, so `generation` AND `revoked_at` are client-chosen ... OPEN [M]
- R4  PITR / branch DB sharing SHARE_TOKEN_SECRET ........ OPEN, design-neutral
- R5  serialize() collisions ............................. latent only, for the unwritten mint route

FAMILY N (the revoke never happened but reported success) — NEW, unexamined before
- N1  INT4 overflow wedge ................................ OPEN, UNRECOVERABLE [M]
      PATCH {"generation": 2147483647} accepted (trigger forbids DECREASE only).
      Then revoke_strategy_share -> ERROR integer out of range.
      sanitize_user Art.17 arm is the same statement -> ENTIRE GDPR ERASURE ABORTS.
      Remediation tested: service_role tombstone-without-bump -> blocked by rule 2;
      +1 -> overflow. NO EXIT except DDL or a DELETE that resurrects everything.
      ⭐ The two trigger rules, each individually correct, compose into a dead state.
- N2  lost-revoke race ................................... OPEN [M]
      READ COMMITTED: uncommitted create_strategy_share reactivation invisible to
      `AND revoked_at IS NULL`; no row lock; revoke returns 0 = "already revoked"
      = SUCCESS per the route contract. Owner told revoked; URL live.
      ⚠️ STEP 6 arm (i-b) FAILS THE APPLY if that predicate is removed, so the
      durable pin ENFORCES the racy shape. Safe fix = SELECT ... FOR UPDATE.

PROOF that column-pinning cannot converge:
The needed predicate is HISTORICAL (no revoked pair ever live again); a BEFORE
UPDATE trigger enforces TRANSITIONS. That suffices only if the row is (a) never
absent, (b) not re-creatable, (c) sole determinant of the token. All three fail
independently: (a) CASCADE from strategies; (b) unguarded INSERT + client-chosen
strategies.id; (c) secret + PITR.
⭐ ROOT CAUSE: the model stores NO WITNESS of what was issued. The only evidence
that generation 3 was killed is the current row showing generation > 3 — which is
both destructible and forgeable.

## Team 2 — Write surface (12-cell matrix)
authenticated surface = 2 ops x 6 columns. Trigger governed 2 of 12.
- strategy_id UPDATE free within own strategies [M]; cross-tenant blocked [M]
- generation INSERT: any value >= 1 [M]; created_at backdatable [M]; id rewritable [M]
- created_by forgery blocked [M]; DELETE/TRUNCATE/DDL all 42501 / must-be-owner [M]
- PostgREST upsert with ?on_conflict=strategy_id DOES fire the trigger [M]
- anon dead at grant layer [M]; non-owner fully sealed [M]
- service_role: trigger DOES bind BYPASSRLS [M]; DELETE+INSERT = full resurrection [M]
- no column-level ACL residue; pg_default_acl still holds authenticated=arwdDxt (DROP+CREATE hazard)
Verdict: pinning CAN close the client surface (12 cells) but NOT service_role
DELETE, NOT the strategies cascade, NOT PITR.

## Team 3 — Token derivation
MAC construction sound: no collision (400k pairs, 0), TOKEN_RE has no /g, string
compare correctly rejects 4-way base64url aliasing, timingSafeEqual reached only on
equal length, no oracle (unknown vs revoked byte-identical paths).
Gaps: MIN_SECRET_LENGTH is a CHARACTER count, comment claims "256-bit key floor";
no domain separation in the pre-image; `import "server-only"` absent vs house convention.
Structural verdict: DB pinning cannot make revocation durable — row lifetime is not
an UPDATE. Recommends per-row nonce in the MAC input; notes PITR remains.

## Team 4 — Recipient lane
INVARIANT HOLDS [M]: 91-module transitive graph has zero cache primitives, never
reaches v2/page.tsx; buildFactsheetPayloadCached unexported; Next 16.2.11 does not
cache fetch by default; force-dynamic => fetchCache=force-no-store. All poisoning
orderings failed. Existence oracles converge (unknown/malformed/revoked/deleted all 307->410).
OPEN:
- F1 Plausible loads from ROOT layout on the token route -> token in Top Pages
- F2 instrumentation.ts:56 extra.path = raw token; zero beforeSend in src/
- F3 PostHog latent — blocked ONLY by us.i.posthog.com absent from connect-src (accident)
- F4 no per-route no-referrer (same-origin leak to our own edge logs)
- F5 platform logs + link dereferencers — inherent, not listed as accepted residual
- F6 ⭐ THE GUARD IS ONE FILE DEEP: both controls scan a single file's bytes;
     src/lib/factsheet/fetch-and-build-payload.ts and its deps are UNGUARDED, and its
     docblock asserts "It imports next/cache nowhere" as though enforced. A perf PR
     wrapping the composite read in unstable_cache([...,id]) shares an id-keyed entry
     between lanes and EVERY EXISTING GATE STAYS GREEN.
     The acceptance spec page.cache-isolation.test.tsx was never written.
- checkLimit FAILS OPEN when VERCEL_ENV !== production -> preview deploys unlimited
Live exposure today = ZERO (no mint route, table empty). Must land before 164-03.

## Team 5 — External research
- Azure ad-hoc SAS == our design; MS says you CANNOT revoke one, must roll the key.
  Their fix: stored access policies. Biscuit: stored revocation identifiers.
- W3C TAG capability-URLs: 410 to prevent reassignment; MULTIPLE concurrent links per
  resource recommended (our strategy_id UNIQUE forbids this); should expire.
- Paragon split tokens / GitHub / apikeys.guide: a token MUST be self-locating.
  Our scan-and-derive is the pattern these exist to replace.
- NIST SP 800-108: re-supplying (key,label,context) reproducing the key is the KDF
  CONTRACT. So generation monotonicity is a nonce-non-reuse invariant.
- Verdict: "worst quadrant — pays the full cost of a stored row and gets none of the
  revocation guarantee, because the row stores no token identity."
- Process: Stechly et al — LLMs no better at verifying than generating; CRITIQUE
  CONTENT LARGELY IRRELEVANT to iterative-prompting outcome. Konstantinou et al — LLMs
  generate oracles capturing IMPLEMENTATION-AS-WRITTEN not expected behaviour (= our
  unfailable assertions, named). Wang & Pradel — 29.6% of plausible patches over-reach.
  Stop rule is ABSENCE OF AN EXTERNAL ORACLE, not a round count.
  Remedies: mutation testing (Google, diff-scoped), differential oracles (SQLancer),
  property-based (Hughes), deterministic linters (Squawk) for mechanical classes,
  pgTAP executed as non-owner with FORCE RLS.
  Structural: Saltzer&Schroeder least privilege; Ousterhout "define errors out of
  existence"; Helland immutability/append-only.

## Team 6 — Process root cause
Verdict: NOT "sound process, hard problem"; NOT "defects faster than catches".
⭐ "The process is converging LINEARLY on a problem that has a CONSTANT-TIME solution."
39 commits: 4 implementation, 19 fix/merge-fix. migration +75%, gate +133%.
- RC-1 (dominant) The invariant was never STATED, so the phase enumerated 7 separately
  discovered paths to one forbidden state. An 8th is predictable without review.
  Domain difficulty explains ~1 of ~10 defects: ZERO findings were about token crypto,
  replay, timing or URL leakage — all were Postgres privilege/RLS/trigger or GDPR wiring.
- RC-2 Nothing in the loop could EXECUTE the artifact. Executor: "NOT RUN — no local
  psql run was attempted". The plan's <automated> is English prose. gsd-code-reviewer is
  read-only by construction. 456-line migration + 536-line gate authored, committed,
  declared done, reviewed by 3 specialists, with ZERO executions.
  Every genuinely measured finding came from an ad-hoc throwaway PG cluster that is in
  no plan, no skill, no CI lane.
- RC-3 Anti-vacuity is enforced at BATCH level, so fixers reproduce the class they fix.
  Round-1 fix commit states "an arm that cannot fail is worse than no arm" AND ADDS FOUR
  (TENANT 5d-5g). Round-2 adds two more (TRIGGER 1c/2c). 6 of 73 arms (8.2%) structurally
  unfailable, in a file just re-tuned to ZERO SLACK. The mutation is chosen by the same
  agent that wrote the assertion, from the same mental model.
- RC-4 gsd-plan-checker.md:752 — the checker's ground truth for decisions is THE
  ORCHESTRATOR'S RENDITION, not the file. That is the shipped mechanism behind D-01..D-09
  (85 citations, 0 definitions). Two-thirds sit inside <action> bodies where the label is
  the ONLY carrier of the constraint.
- RC-5 Decomposition cut across mechanical couplings: test_*.sql -> ci.yml floors ->
  ci-anti-skip-gate.contract.test.ts (owned by NOBODY). Fix was half-assigned; HEAD is an
  unreviewed repair of a coupling the plan structure guaranteed would break.
- RC-6 Implementation-before-test in all five plans. Test-first alone changes almost
  nothing without a runnable DB — the lever is RUNNABLE-first.
  Attribution: runnable-adversarial-first ~4 defects; a stated mechanical invariant ~6;
  together ~9 of ~10.
Ranked remedies: (1) state the invariant once + property-fuzz it instead of 73 enumerated
arms; (2) BETTER — decompose so it is structural (insert-only generations table, current
state a view) so paths 1,2,4,5,7 cannot exist; (3) runnable DB before authoring;
(4) per-arm RED-UNDER annotation, mechanically enforced; (5) reviewers declare execution
status, UNEXECUTED blocks; (6) orchestrators pass PATHS not FACTS; (7) ownership by
mechanical closure; (8) full-suite arbiter in every plan.

## Fix round 3 (landed in a worktree, not yet merged)
strategy_id + id/created_by/created_at pinned; TRIGGER 3a/3b/3c + 4a/4b added;
TRIGGER 1c/2c DELETED as unfailable; TENANT 5d-5g filed as D-164-B. Arms 73 -> 76.
RED demonstrated on a throwaway PG16: neuter rule (0a) -> TRIGGER 3a RED with
"create_strategy_share() returned generation 1 — the counter stood at 3".
Closes R2a ONLY. Does not touch R2b, R2b', R3, N1, N2.

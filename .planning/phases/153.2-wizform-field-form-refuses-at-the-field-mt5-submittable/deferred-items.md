# Phase 153.2 — deferred / out-of-scope discoveries

Items found during execution that are **not** this phase's plans to fix. Logged rather than
fixed, per the scope-boundary rule.

## D-153.2-A — `WIZFORM-01` is ticked in REQUIREMENTS.md while its traceability row still reads "Pending"

**Found:** 153.2-02 execution (state-update step), 2026-08-09.
**Where:** `.planning/REQUIREMENTS.md:656` (checkbox `[x]`) vs `:1087` (table row `Pending`).

`153.2-03`'s completion run (commit `6c409d96`) flipped the `WIZFORM-01` checkbox to `[x]`
but the traceability table row was not moved off `Pending`, so the two statements about the
same requirement now disagree.

Separately, both 153.2-01 and 153.2-02 recorded the *opposite* call in `STATE.md`
(decision at `:547`): **WIZFORM-01 is deliberately not complete** until `153.2-05` lands the
server-side field-level code → field routing, since a field-level rejection that still
arrives from the server is exactly the failure the requirement describes.

**Why not fixed here:** un-ticking a sibling plan's requirement mark mid-phase is a
cross-plan decision, and 153.2-02 did not run `requirements mark-complete` for that reason.

**Owner:** whoever closes `153.2-05` — either tick both statements then, or un-tick the
checkbox now and tick both at the end. One of the two, not a blend.

## D-153.2-B — `src/lib/wizardErrors.ts` carries 9 bare `file:line` citations; SEAMPROSE-01 is RED

**Found:** 153.2-04 execution (full-suite run), 2026-08-09.
**Where:** `src/lib/seam-citations.invariant.test.ts` → `src/lib/wizardErrors.ts carries no
bare file:line citation`.

Nine prose citations in `wizardErrors.ts` (`:42`, `:217`, `:292`, `:625`, `:626`, `:1184`,
`:1192`, `:1857`, `:2271`) name coordinates like `finalize-wizard/route.ts:1319` and
`MetadataStep.tsx:19`. The guard demands symbol-anchored references instead, because a bare
integer goes stale the moment the target file grows a line — which this plan did: it added
~180 lines to `finalize-wizard/route.ts`, so at least two of those citations now point at
the wrong arm.

**Why not fixed here:** `src/lib/wizardErrors.ts` is **Phase 153.1's** file (last touched by
`3928bc48 fix(153.1): WR-02 + WR-04`), and this plan's scope boundary is
`finalize-wizard/route.ts` **outside** `validatePayload` plus the wizard chip set. The
failure is pre-existing — it does not read any file this plan touched, and
`finalize-wizard/route.ts`'s own row in the same guard is GREEN, including every comment
added by this plan.

**Owner:** Phase 153.1 (WIZFORM-CODES), or the milestone-closing fix round. ⚠️ Whoever takes
it must re-derive each coordinate against current HEAD before converting it — several are
already pointing at the wrong line, so a mechanical "name the symbol at that line" pass
would encode the drift instead of removing it.

## D-153.2-C — `analytics-service/services/ingestion/mt5.py` drifted 242 → 363; SEAMPROSE-03 is RED

**Found:** 153.2-04 execution (full-suite run), 2026-08-09.
**Where:** `src/lib/seam-venue-vocabulary.invariant.test.ts` → `DECLARED BLIND SPOT — the
dynamic emitter is SEEN, and yields no literal of its own`.

The declared blind-spot list pins the dynamic `error_code` emitters by `file:line`.
`mt5.py`'s moved from `:242` to `:363`; the other seven entries are unchanged, so this is
pure line drift from Phase 153.3's MT5 gateway work (`b4ff7332`, `a7e88c7d`, `ae253542`),
not a new dynamic emitter.

**Why not fixed here:** everything under `analytics-service/` is **Phase 153.3**'s by the
153.2 CONTEXT's explicit exclusion list, and 153.2 owns no Python. Bumping the integer is a
one-character edit but it is an assertion about a file this plan may not read as authority.

**Owner:** Phase 153.3, or the milestone-closing fix round. ⚠️ Re-derive the line rather
than trusting the number in this note — the file is under active change.

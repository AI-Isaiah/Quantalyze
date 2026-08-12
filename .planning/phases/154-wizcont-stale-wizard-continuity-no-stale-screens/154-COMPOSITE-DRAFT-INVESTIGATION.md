# 154 — Composite draft misclassified as CSV: investigation

**Base:** `147acebc79cac22100e494d91c9526e16615ae9a`
**Date:** 2026-08-12

## VERDICT: CONFIRMED (mechanism), with the blast radius CORRECTED and the root cause deeper than reported

The classification defect is real and the destructive chain is reachable. Two parts of the
reviewer's account are wrong and are corrected below — the DELETE does **not** destroy key
material, and the "invisible draft" symptom belongs to the SSR page, not the overlay.

The root cause is also **stronger** than reported: `deriveDraftKind`'s `"csv"` arm has **no
legitimate inhabitant at all**. The CSV wizard branch never persists a `source='wizard'` draft
row, so every draft that arm can ever see is an API-branch draft.

---

## 1. Is there a window where a composite draft has `api_key_id IS NULL` AND zero `strategy_keys`? — YES

**`add_wizard_composite_key` writes `strategies` + `api_keys` only.**
`supabase/schema/functions/add_wizard_composite_key.sql:70-80` inserts the `strategies` row and
deliberately omits `api_key_id` ("omitted so it stays NULL for the composite"), `:89-101` inserts
the encrypted `api_keys` row. There is no `strategy_keys` write anywhere in the body.

**The schema mirror is NOT stale.** The latest definition in the migrations is
`supabase/migrations/20260811210000_api_keys_attested_venue.sql:418-511`; I read it in full and it
is the same body as the mirror (the mirror's header names that migration as its source). The two
earlier definitions are `20260710180000_wizard_composite.sql:53-141` (re-based from) and nothing
after.

**`strategy_keys` has exactly one writer.**
`grep -rn "INSERT INTO strategy_keys" supabase/{schema,migrations}` →
`supabase/schema/functions/set_wizard_composite_members.sql`,
`supabase/migrations/20260710180000_wizard_composite.sql:208`, and the latest definition
`supabase/migrations/20260712120000_wizard_composite_members_invalidate_analytics.sql:62` with its
INSERT at `:160`. All three are `set_wizard_composite_members`.

**That RPC runs only on the multi-key step's "Continue".**
`MultiKeyConnectStep.tsx:1195` POSTs `/api/strategies/composite/add-key` once per key (validate →
encrypt → `add_wizard_composite_key`, `src/app/api/strategies/composite/add-key/route.ts:389`).
`MultiKeyConnectStep.tsx:1484` POSTs `/api/strategies/composite/set-members`, and it is reached
only from `handleContinue` (`:1474`), which is bound to the Continue button at `:1709`.

⇒ **For the entire add-keys phase — from the first key added until Continue is pressed — the
composite draft is `api_key_id IS NULL` with zero `strategy_keys` rows.** That is not an edge
case; it is the normal state of every composite draft for the whole time the user is entering
credentials, and it is the persisted state of every composite session abandoned before Continue.

**`create_wizard_strategy` does NOT leave the composite path keyless** — it is the single-key
twin and always sets `api_key_id` (`create_wizard_strategy.sql:128-138`). The only other producer
of a keyless `source='wizard'` draft is an *orphaned* single-key draft whose `api_keys` row was
deleted (`strategies.api_key_id … ON DELETE SET NULL`,
`supabase/migrations/20260405061911_initial_schema.sql:51`) — a case
`create_wizard_strategy.sql:53-59` names explicitly.

## 2. Does `deriveDraftKind` return `"csv"` in that state? — YES

`src/lib/wizard/draft-query.ts:100-111`:

```ts
if (row.api_key_id !== null) return "api";
if (row.member_count === null) { throw … }
return row.member_count > 0 ? "composite" : "csv";   // :110
```

`member_count === 0` → `"csv"`. Read, not inferred. The probe that produces the count is
`readLatestWizardDraft` `:167-176` (`head:true` exact count on `strategy_keys`).

## 3. Does the overlay force the tab, and does Start-fresh DELETE? — YES to both

- **Force-switch:** `ContributionWizardOverlay.tsx:138` — `if (kind === "csv") setSource("csv");`
  runs on the `/api/strategies/wizard-draft` response (`:126-139`). The user who clicked
  `+ Strategy` (source defaults to `"api"`, `:64`) is moved to the **CSV upload** tab.
- **Draft offered on that tab:** `:162-165` — `draftMatchesSource("csv","csv")` is true, so the
  composite draft is passed as `initialDraft` with `initialDraftKind="csv"` (`:248-249`).
- **`strategyId` seeded from it:** `WizardClient.tsx:243-245`. The step initializer sends it to
  `csv_upload` (`:219-229` → `:231-241`), and the resume banner renders (`:990`) because
  `deriveWizardResumeOverrides` sets `showResumeBanner` whenever a draft exists with no matching
  local pointer (`src/lib/wizard/localStorage.ts:386` and `:456-458`).
- **Banner copy is a lie about this draft:** `WizardClient.tsx:996-998` renders "A CSV upload
  draft from an earlier session is ready. Re-select the file and continue." over a composite API
  draft.
- **Start fresh deletes:** `:1004-1011` → `handleStartFresh` (`:905`, opens the confirm) →
  `handleDeleteDraft` (`:789`) → `DELETE /api/strategies/draft/<composite draft id>` (`:819`).

## 4. What the DELETE actually destroys — the reviewer OVERSTATES this

`src/app/api/strategies/draft/[id]/route.ts`:

- `:171-187` deletes the `strategies` row (guarded to `source='wizard' AND status='draft'`).
- `:202-236` revokes the linked `api_keys` row **only `if (draft.api_key_id)`**. A composite
  draft has `api_key_id IS NULL`, so **this arm never runs** — no key material is deleted.
- `strategy_keys` is `ON DELETE CASCADE` from `strategies`
  (`supabase/migrations/20260710120000_strategy_keys.sql:32`), but in this exact state there are
  **zero** member rows to cascade — zero members is the very premise of the misclassification.

⇒ **What is lost: the composite draft `strategies` row.** The N encrypted `api_keys` rows the
user just created are **orphaned, not deleted** — and they were already unreachable: the step's
rehydration reads members, not keys (`MultiKeyConnectStep.tsx:742` GETs
`/api/strategies/composite/members`), which returns `[]` before Continue. The cron sweep only
reaps `api_keys` referenced by a doomed draft via `strategy_keys` or `strategies.api_key_id`
(`cleanup_abandoned_wizard_drafts.sql:19-24`, `:41-49`), so pre-Continue composite keys are
**never** swept — a pre-existing hygiene leak, unchanged by this defect either way.

So the honest severity is: **a silent wrong-branch hijack with a destructive control on it**, not
a key-destroying cascade. The user is dropped on the wrong tab, told a false thing about their
draft, and handed a button that deletes it.

## 5. Counter-evidence, and the deeper root cause

I looked for an earlier step that populates one of the two fields first. There is none — but the
search turned up something that makes the defect worse, not better:

**There is no such thing as a CSV wizard draft.** Only two production writers create
`strategies.source='wizard'`: `create_wizard_strategy` (`api_key_id` NOT NULL) and
`add_wizard_composite_key` (`api_key_id` NULL). `grep -rn "source: \"wizard\"" src/` returns one
hit, an audit-log label (`draft/[id]/route.ts:196`) — no app-layer insert. The CSV branch
finalizes into a **new** row with `source='csv'` and a terminal status
(`finalize_csv_strategy`, `supabase/migrations/20260728120000_csv_finalize_double_submit_idempotency.sql:278-289`),
and it persists `strategyId: ""` at every autosave (`WizardClient.tsx:536, 1211, 1233, 1246, 1277,
1289, 1320, 1332, 1344, 1377`) precisely because it has no server draft.
`readLatestWizardDraft` filters `source='wizard'` (`draft-query.ts:150`).

⇒ The `"csv"` arm cannot be reached by a CSV draft. Its only real-world inhabitants are
(i) a composite draft before Continue and (ii) an orphaned single-key draft. **Both belong to the
API branch.** `member_count === 0` was read as positive evidence of CSV; it is the *absence* of
evidence, and the phase's own note (154-PATTERNS § 3 "A4 / Pitfall W-2") flagged exactly this
column as unable to carry the distinction.

**Reviewer's consequence (a), corrected.** The "abandoned draft is never offered, each re-entry
mints another orphan" symptom is real but belongs to the **SSR page**
(`/strategies/new/wizard` on the API branch): `page.tsx:108-111` filters with
`draftMatchesSource("csv","api") === false`, so the draft is dropped and the next composite add
mints a fresh draft under a fresh `wizard_session_id`. In the **overlay** the draft is *not*
invisible — line 138 force-switches the branch to meet it, which is the worse of the two.

---

## Fix applied

`api_key_id === null` alone genuinely cannot separate CSV from composite (documented as A4 /
Pitfall W-2), and I found **no positive composite marker** available without a schema change:
`add_wizard_composite_key` writes nothing that distinguishes its draft from any other wizard
draft, and the one signal that *would* be positive — a `strategy_keys` row — does not exist until
Continue. Making the kind genuinely KNOWABLE therefore requires a marker column written inside
`add_wizard_composite_key` (a migration that auto-applies to PROD plus a re-base of two
SECURITY DEFINER bodies) — out of scope for this fix and noted below as the follow-up.

Per the standing rule, the window therefore **fails closed**:

- `deriveDraftKind` returns `null` — INDETERMINATE — for `api_key_id === null && member_count === 0`,
  instead of fabricating `"csv"`.
- `readLatestWizardDraft` answers `{draft: null, kind: null}` for that state, so no draft id
  crosses the wire, no branch is forced, no `strategyId` is seeded, and no Start-fresh can delete
  it. This is the same posture both callers already take for the other unknowable case
  (`page.tsx:95-106` degrades to no draft, `wizard-draft/route.ts:112-127` fails closed), and both
  already treat `kind === null` as "do not offer" (`page.tsx:108-110`,
  `ContributionWizardOverlay.tsx:162-165`).

Nothing resumable is withheld: before Continue the draft holds no members, so the rehydration
that "Resume" would run returns `[]` — there was never anything behind that banner.

**Follow-up (not done here):** a positive composite marker (e.g. a `strategies` column stamped by
`add_wizard_composite_key`) would make the kind knowable and let a pre-Continue composite draft
resume onto the API branch instead of being withheld. Natural owner: Phase 156 CONNECT-REFACTOR,
which already moves this wizard-connect surface behind a service-role writer.

**Deferred, out of scope (logged, not fixed):** `api_keys` rows minted by
`add_wizard_composite_key` before Continue are referenced by neither `strategies.api_key_id` nor
`strategy_keys`, so `cleanup_abandoned_wizard_drafts` never sweeps them; every abandoned
pre-Continue composite session leaks encrypted key rows permanently.

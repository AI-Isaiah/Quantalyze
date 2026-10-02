# Phase 94: Wizard Resumability - Research

**Researched:** 2026-07-11
**Domain:** Composite-strategy wizard state machine (React client island) + one owner-scoped server read
**Confidence:** HIGH (every claim below is codebase-verified with file:line; no external libraries involved)

## Summary

All five defects are frontend/state-machine bugs plus **one missing server read**. Nothing here needs a
new library, and — the load-bearing de-risking finding — **WIZ-01 needs NO migration and NO new RLS
policy**: the two tables that hold composite member state (`strategy_keys`, `api_keys`) already carry
owner-only RLS (`owner_id = auth.uid()` / `user_id`), so an authenticated, RLS-scoped `SELECT` that
enumerates only the non-secret columns is sufficient and is *least-privilege* (no `SECURITY DEFINER` RPC
required). Migrations auto-apply to PROD on merge, so avoiding one is a feature.

The composite wizard's `MultiKeyConnectStep` holds all key state in ephemeral local React state
(`panels`, `mode`, `strategyId`) that is **never rehydrated from the server** and is **not even handed the
draft's `strategyId`** — so any unmount (back-nav, "Review your keys") drops the keys. The "Review your
keys" affordance is wired to the *destructive* `onTryAnotherKey` (which DELETEs the draft + mints a new
session). The stepper (`WizardChrome`) renders steps as inert `<div>`s. And `SyncPreviewStep` re-runs its
kickoff-crawl mount effect on every remount because the completed snapshot WizardClient already holds is
never threaded back in.

**Primary recommendation:** Land WIZ-01 as a plain `withAuth` **GET route** doing an RLS-scoped embedded
select (no RPC, no migration). Then thread `strategyId` + `cachedSnapshot` from `WizardClient` into the two
steps, add a mount-time rehydrate effect to `MultiKeyConnectStep`, split the review affordance from the
destructive one, and make `WizardChrome` steps clickable with a WizardClient-owned completion predicate.
The secretless-resubmit path **already works server-side** — `set-members` only takes `api_key_id`, never a
secret — so WIZ-02 is a pure client rehydration.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Read composite member keys w/o secrets (WIZ-01) | API / Route Handler | Database (RLS) | Owner-scoped read; RLS is the tenant gate, route enumerates non-secret columns |
| Rehydrate State B panels (WIZ-02) | Browser / Client (MultiKeyConnectStep) | API (WIZ-01 GET) | Panel state is client-owned; server supplies the non-secret facts |
| Non-destructive "Review your keys" (WIZ-03) | Browser / Client (WizardClient callback) | — | Pure step-state transition; no server write |
| Clickable free stepper (WIZ-04) | Browser / Client (WizardChrome + WizardClient) | — | Step machine + completion predicate both live client-side |
| Cached crawl snapshot (WIZ-05) | Browser / Client (WizardClient → SyncPreviewStep) | Database (fallback) | Snapshot already held in WizardClient state; thread it back |

## User Constraints

No `CONTEXT.md` exists for Phase 94 (standalone research invoked before discuss-phase). The governing
constraints are the ROADMAP success criteria (verbatim below) and the standing invariants in `STATE.md`.

### Locked (from ROADMAP.md:71-82 + REQUIREMENTS.md:21-25)
- **WIZ-01** server read returns member keys (exchange, nickname, active window, verified) WITHOUT secrets — response never contains key material.
- **WIZ-02** `MultiKeyConnectStep` rehydrates State B: stored keys pre-filled + marked verified, no re-validation, empty secret acceptable for an unchanged key; back-nav never shows a blank form.
- **WIZ-03** "Review your keys" is non-destructive — never deletes the draft or its members.
- **WIZ-04** stepper supports free clickable back/forward; after changing nothing, return forward without redoing work.
- **WIZ-05** returning to the crawled step shows the cached stitch snapshot — no re-crawl/re-stitch.

### Standing invariants that bound this phase
- **Ph91 RLS lesson** (MEMORY): a wizard RLS *browser* read returns **empty** for a non-owner. An owner-seeded e2e fixture MUST be owned by the logged-in user or the authed read is empty and the test false-reds. `[CITED: MEMORY project_milestone_v1_9_multi_key_composite]`
- **No unsolicited visual change** — honor `DESIGN.md`; the stepper already has a keyboard-activation spec (DESIGN.md:241) the WIZ-04 change must conform to.
- **Migrations auto-apply to PROD on merge** — prefer a no-migration solution (WIZ-01 achieves this). `[CITED: MEMORY project_supabase_migrate_auto_on_push]`

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WIZ-01 | Server read of member keys, no secrets | § WIZ-01: storage map + leak vectors + no-migration GET-route design |
| WIZ-02 | Rehydrate State B, verified, empty secret OK | § WIZ-02: mount effect seam + panel shape + secretless set-members proof |
| WIZ-03 | Non-destructive "Review your keys" | § WIZ-03: exact `onTryAnotherKey` split |
| WIZ-04 | Clickable free stepper | § WIZ-04: WizardChrome inert cells + WizardClient completion predicate |
| WIZ-05 | Cached snapshot on return | § WIZ-05: SyncPreviewStep mount-effect kickoff + cachedSnapshot short-circuit |

---

## WIZ-01 — Secure server read (foundation; lands first)

### Where composite member keys are stored

**`strategy_keys`** (join table) — `supabase/migrations/20260710120000_strategy_keys.sql:30-43`:
```
id, strategy_id, api_key_id, owner_id, window_start (DATE), window_end (DATE, nullable=live), seq, created_at
```
- RLS: `strategy_keys_owner` `USING (owner_id = auth.uid())`, `TO authenticated`, `REVOKE ALL … FROM anon` (`:121-129`). **No secret columns.**
- Owner-coherence trigger (`:112-115`) guarantees `owner_id == api_keys.user_id == strategies.user_id`.

**`api_keys`** — `supabase/migrations/20260405061911_initial_schema.sql:19-32`:
```
id, user_id, exchange, label,
api_key_encrypted (NOT NULL), api_secret_encrypted, passphrase_encrypted, dek_encrypted, nonce,   ← SECRET/ENVELOPE MATERIAL
is_active, last_sync_at, created_at
```
- RLS: owner-only (`user_id`).

### CRITICAL — exact leak vectors (columns the read's SELECT + serialized response must NEVER touch)

| Column | Table | Content |
|--------|-------|---------|
| `api_key_encrypted` | api_keys | ciphertext blob (envelope contract stores ALL creds here — add-key/route.ts:201-206) |
| `api_secret_encrypted` | api_keys | ciphertext (usually null under envelope) |
| `passphrase_encrypted` | api_keys | ciphertext |
| `dek_encrypted` | api_keys | wrapped data-encryption key |
| `nonce` | api_keys | AES-GCM nonce |

**Non-secret readable columns:** `strategy_keys.{window_start, window_end, seq}` + `api_keys.{exchange, label, is_active}`.

### "Verified status" — derivable, no new column

Every `strategy_keys` member was validated **read-only** at add-key time: `add-key/route.ts:161-179`
runs `validateKey(...)` and rejects non-read-only keys *before* `add_wizard_composite_key` mints the
`api_keys` row. So **membership ⇒ verified by construction.** The read can return `verified: true` for every
member (optionally surface `api_keys.is_active`). `[VERIFIED: add-key/route.ts:161-179]`

### Secure-read design (RECOMMENDED — no RPC, no migration)

Add a **GET route handler**, e.g. `src/app/api/strategies/composite/members/route.ts` (query `?strategy_id=`)
or `.../composite/[strategyId]/keys/route.ts`. Mirror `set-members/route.ts` posture verbatim:
`withAuth` (`set-members/route.ts:50`), `isUuid` guard (`:61`), `NO_STORE_HEADERS` (`:6`), `createClient()`
(`:118`).

Owner-scoped embedded select — **RLS auto-filters to the caller; ciphertext columns are never named**:
```ts
const { data } = await supabase
  .from("strategy_keys")
  .select("seq, window_start, window_end, api_keys ( exchange, label, is_active )")
  .eq("strategy_id", strategyId)
  .order("seq", { ascending: true });
```
Then build the response **field-by-field (never spread a DB row)** — belt-and-suspenders against leak:
```ts
members: data.map(m => ({
  seq: m.seq, exchange: m.api_keys.exchange, nickname: m.api_keys.label,
  window_start: m.window_start, window_end: m.window_end, verified: true,
}))
```

**Ownership / RLS scoping:** `strategy_keys` RLS already returns **only** the caller's rows (Ph91: a
non-owner read is empty — here that is the *desired* posture, not a bug). For a clean `403` vs `200-empty`
distinction, additionally guard the parent strategy the way `set_wizard_composite_members` does
(`mig …180000:183-198`: `SELECT … FROM strategies WHERE id=? AND user_id=?` — "not found" and "not owned"
are indistinguishable, no existence oracle). Reuse `set-members`'s uniform `{ code }` error posture.

**Why not a `SECURITY DEFINER` RPC (the set-members pattern)?** `set-members` uses an RPC because it does a
*privileged wholesale write* with owner-coherence. A *read* is already permitted to the owner by RLS, so an
RPC would only add attack surface (a DEFINER function that reads `api_keys` past RLS is exactly the thing
that must not accidentally select ciphertext). **Least privilege ⇒ plain authed select.**

### Migration / RLS verdict

**NONE.** No new table, column, policy, or function. Existing owner RLS on `strategy_keys` + `api_keys`
fully covers the owner-scoped read. This is the low-risk path (no PROD auto-apply). **HIGH confidence.**

### Test seam (WIZ-01)

- **Offline vitest** (mirror `set-members/route.test.ts`, mocked `createClient`): assert the response JSON
  **never** contains `api_key_encrypted` / `api_secret_encrypted` / `passphrase_encrypted` / `dek_encrypted`
  / `nonce`; assert shape (`seq, exchange, nickname, window_start, window_end, verified`); assert
  non-owner/empty and bad-UUID → `400`. This is the load-bearing leak assertion and is fully offline.
- **Owner-seeded e2e** (recommended, proves RLS end-to-end): seed a composite draft + `strategy_keys`
  **owned by the logged-in user** (Ph91 lesson — else the authed read is empty and the test false-reds).

---

## WIZ-02 — State B rehydration + secretless key

### Root cause (file:line)

`MultiKeyConnectStep.tsx`:
- `mode` starts `"single"` (`:294`), `panels` starts `[]` (`:295`), local `strategyId` starts `null` (`:296`).
- **No mount effect rehydrates any of this.** The only effects sync `panelsRef` (`:308-310`) and focus (`:330-335`).
- Props are **only** `wizardSessionId` + `onSuccess` (`:285-288`); the render site passes only those
  (`WizardClient.tsx:635-638`) — the step is **never even told the draft's `strategyId`**.

Consequence: any unmount (back-nav to `connect_key`, or "Review your keys") re-mounts a blank single-key form.

### Rehydration seam

1. **Thread `strategyId`** into `MultiKeyConnectStep` from WizardClient's existing `strategyId` state
   (`WizardClient.tsx:134-136`, initialized from `initialDraft.id`).
2. **Add a mount `useEffect`**: if `strategyId` is present, `fetch` the WIZ-01 GET. If `members.length > 0`:
   - `setStrategyId(strategyId)`, `setMode("multi")`,
   - `setPanels(members.map(...))` into `PanelState` (shape at `MultiKeyConnectStep.tsx:135-150`) marked
     **exactly like a post-validate panel** (`validatePanel` success, `:448-464`):
     `status: "validated"`, `apiKeyId: <id>`, `windowStart/windowEnd` from the read, `stillLive: window_end == null`,
     `exchange`, `nickname: label`, and **`apiKey/apiSecret/passphrase: ""`** (plaintext blank — mirrors the
     validated panel, which clears plaintext at `:461-463`).
   - If `members.length === 0`, stay single-key (byte-neutral A1 path preserved).

3. **No re-validation fires** because `allValidated` (`:482-484`) checks only `status === "validated" && windowStart`
   — a rehydrated panel satisfies it. `canValidate` (`:739-744`) is moot (the Validate button is hidden once a
   panel is validated). `canContinue` (`:487`) = `allValidated && !hasBlockingError`.

### Secretless-key design — **already works server-side**

The Continue payload is built by the exported pure `buildSetMembersKeys` (`:180-198`) and sends **only**
`{ api_key_id, window_start, window_end, seq }` — **never a secret** (`handleContinue` `:526-558`). The
`set-members` route requires only that every `api_key_id` be a valid UUID (`route.ts:82-89`), which a
rehydrated panel has. The RPC `set_wizard_composite_members` is a **wholesale DELETE-then-INSERT** keyed on
`api_key_id` (`mig …180000:206-220`), idempotent — a no-change Continue rewrites byte-identical membership.

**⇒ An unchanged, verified key is re-submittable with an empty secret field by construction.** WIZ-02 is a
pure *client rehydration*; the server contract needs no change.

- **Edit path (out of "unchanged" scope but supported):** if the user retypes a secret on a rehydrated panel,
  that's a fresh `validatePanel` → new `add-key` → new `api_key_id`. Fine.

### Test seam (WIZ-02)

`MultiKeyConnectStep.test.tsx`: mount with `strategyId` + mocked WIZ-01 GET returning 2 members → assert
`mode==="multi"`, 2 panels rendered validated, Continue enabled with **no** `add-key` fetch, and the
`set-members` POST body carries the two `api_key_id`s and **no secret**. Fully offline (jsdom + fetch mock).

---

## WIZ-03 — Non-destructive "Review your keys"

### Root cause (file:line)

- The label lives in `SyncPreviewStep.tsx`: `isComposite ? "Review your keys" : "Try another key"` at
  **`:1046`** (gate-failed error card) and **`:1399`** (composite success), plus single-key "Try another key"
  at **`:1473`**. All three buttons wire `onClick={onTryAnotherKey}` (`:1043`, `:1396`, `:1470`).
- `onTryAnotherKey` is defined at **`WizardClient.tsx:647-663`**: `setStep("connect_key")` **+
  `setWizardSessionId(newWizardSessionId())` + `void handleDeleteDraft()`**. `handleDeleteDraft` (`:462-499`)
  DELETEs `/api/strategies/draft/{strategyId}` and clears `strategyId/apiKeyId/syncSnapshot/metadataDraft`.
  For a composite this **destroys the draft and all `strategy_keys` members** (FK `ON DELETE CASCADE`,
  `strategy_keys.sql:32`).

### Affordance split (minimal change)

The copy already branches on `isComposite` (server-truth, `SyncPreviewStep.tsx:322`). Split the **callback**
to match:

- **Composite → new `onReviewKeys` prop** = `() => { setStep("connect_key"); persistPointer("connect_key", strategyId); }`
  — no delete, no new session. `strategyId` survives; `MultiKeyConnectStep` rehydrates via WIZ-02.
- **Single-key → keep `onTryAnotherKey`** (legitimate "start over / discard the one wrong key + fresh session").

Wiring: add `onReviewKeys?: () => void` to `SyncPreviewStepProps` (near `:214-215`); at all three sites use
`onClick={isComposite ? onReviewKeys : onTryAnotherKey}`. **Both** the success card (`:1399`) **and** the
gate-failed card (`:1046`) must be non-destructive for composites — a user fixing a bad window/key must not
lose the draft.

These are genuinely distinct affordances and should be split rather than blended (Rule 7). The single-key
"Try another key" destructive semantics stay intact.

### Test seam (WIZ-03)

`WizardClient.test.tsx`: render composite `sync_preview`, click "Review your keys" → assert `step` became
`connect_key`, **no** `DELETE` fetch was issued, and `wizardSessionId` is unchanged.

---

## WIZ-04 — Clickable free stepper

### Root cause (file:line)

- **Step machine** lives in `WizardClient`: `step` state (`:128`), ordinal map `STEP_INDEX` (`:60-78`,
  `connect_key→sync_preview→metadata→review→submit`). Transitions are all imperative `setStep + persistPointer`
  inside handlers: `handleConnectSuccess` (`:399`), `handleSyncComplete` (`:413`), `handleMetadataComplete`
  (`:431`), review `onContinue` (`:693`), and the `onBack` handlers (`:675`, `:696`, `:714`).
- **Stepper UI** = `WizardChrome.tsx`. `DEFAULT_STEPS` (`:13-20`) render as inert `<div>` cells
  (`:144-169`) with `isActive`/`isPast` styling and `aria-current` — **no `onClick`, no button, no
  `onStepSelect`.** `currentStep` is a read-only prop (`:563`).

### Design

1. **Add `onStepSelect?: (key: WizardStepKey) => void` + a per-step navigability flag** to `WizardChrome`.
   Render each cell as a `<button>` when navigable (else keep inert / `aria-disabled`). This satisfies
   DESIGN.md:241's existing spec ("stepper Tab/Shift+Tab in DOM order; **Enter activates**; `aria-current='step'`")
   — the pills were *already specified* to be activatable, so this is within approved design direction; keep
   `aria-current`, reuse existing hover/focus tokens, add no new visual language.
2. **Completion predicate lives in WizardClient** (it owns the state each step produces):
   - `connect_key` complete ⇔ `strategyId != null`
   - `sync_preview` complete ⇔ `syncSnapshot != null`
   - `metadata` / `review` complete ⇔ `metadataDraft != null`
   Pass a `stepNavigable(key)` = `isPast(key) || isCompleted(key)`; **block forward jumps past an incomplete
   step** (can't skip to `review` before `syncSnapshot` exists).
3. **"Change nothing, go forward" works for free**: `syncSnapshot` and `metadataDraft` persist in WizardClient
   state (and the draft pointer), so after a backward click the forward steps stay completed ⇒ still clickable.
4. `persistPointer(key, strategyId)` on each click so a refresh resumes at the clicked step.

### DESIGN.md verdict

Conforms to the existing DESIGN-05 keyboard-nav spec (DESIGN.md:241, :302). The only new thing is turning the
already-specified-activatable pills into real buttons — flag for a light design-review sanity check, but **no
DESIGN.md deviation** (no new colors/spacing/typography; reuse `border-accent` active + `text-text-secondary`
past tokens already in `WizardChrome.tsx:146-166`).

### Test seam (WIZ-04)

- `WizardChrome.test.tsx`: navigable cells are buttons, fire `onStepSelect`; non-navigable future steps are
  disabled; `aria-current` preserved.
- `WizardClient.test.tsx`: completion predicate wiring — forward step disabled until its state exists; backward
  then forward returns without re-running handlers.

---

## WIZ-05 — Cached crawl/stitch snapshot on return

### Root cause (file:line)

- The crawl/poll kickoff is `SyncPreviewStep`'s **mount `useEffect`** at **`:330-434`**. On mount it reads
  `strategy_analytics` (`:352-356`); if the row is COMPLETE **and fresh** (`< SYNC_FRESHNESS_WINDOW_MS`,
  `= 5 min`, `:58`) it **skips** the `/api/keys/sync` kickoff (`:365-393`); otherwise it **POSTs
  `/api/keys/sync`** (`:394`) — which **re-triggers the sync/stitch**.
- **Why it re-crawls on back-nav:** `WizardClient` renders `SyncPreviewStep` **only** while
  `step==="sync_preview"` (`:641`). Returning to the step **unmounts then remounts** it → the mount effect
  re-runs. If > 5 min elapsed (stale), the kickoff POST fires again → **re-crawl / re-stitch**.

### Cached-snapshot mechanism

`WizardClient` **already captured the completed snapshot**: `syncSnapshot` state (`:144`), set in
`handleSyncComplete` (`:412`). Thread it back:

1. Pass `cachedSnapshot={syncSnapshot}` into `SyncPreviewStep`.
2. In the mount effect (`:330`), **if `cachedSnapshot` is present, short-circuit before any
   `strategy_analytics` read or kickoff POST**: `setSnapshot(cachedSnapshot)`, set phase to the ready/success
   state, `return`. No poll, no crawl, **regardless of freshness**. This mirrors the existing freshness-skip
   idiom (`:365-393`) but keys off the client-held snapshot instead of a DB freshness probe.

**Do not** switch to always-mounted-with-CSS-hide — that changes the render model and the poll lifecycle for
no benefit.

### Durability caveat (open question — see Risks)

`syncSnapshot` lives only in React state + the localStorage draft pointer; it inits `null` on a **full page
reload** (`:144`). After a hard reload, returning to `sync_preview` re-mounts with no cache and falls back to
the 5-min freshness-skip — a stale-but-complete composite would re-kickoff. **Recommended durable fix:** extend
the mount effect's skip condition so a **COMPLETE** composite skips the kickoff *regardless of freshness*
(a finished stitch never needs re-running merely to *display*). That closes the 5-min re-crawl window entirely.

### Test seam (WIZ-05)

`SyncPreviewStep.render.test.tsx`: mount with `cachedSnapshot` → assert **no** `/api/keys/sync` fetch and the
snapshot renders. Offline.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Owner-scoped member read | A `SECURITY DEFINER` RPC that reads `api_keys` | Plain authed RLS-scoped `SELECT`, explicit non-secret columns | RLS already permits the owner; a DEFINER read is the exact surface that can leak ciphertext |
| Secretless re-submit | New "update-without-secret" endpoint | Existing `set-members` (takes only `api_key_id`) | It is already secretless + idempotent (wholesale delete/insert) |
| Snapshot cache | New persistence layer | `WizardClient.syncSnapshot` state that already exists | The completed snapshot is already captured at `:412` |
| Step ordinal / completion | New state machine lib | `STEP_INDEX` map + WizardClient state predicates | The ordering + per-step state already exist |

**Key insight:** four of five items are "thread state that already exists into a child + stop discarding it on
unmount." Only WIZ-01 adds new surface, and it adds the *minimum* (one GET route, zero DB change).

## Runtime State Inventory

Not a rename/refactor phase — **N/A**. (No stored-string, service-config, OS-registered, secret-name, or
build-artifact migration is implicated; all changes are code + one additive route.)

## Common Pitfalls

### Pitfall 1: `SELECT *` or spreading a DB row into the WIZ-01 response
**What goes wrong:** ciphertext (`api_key_encrypted`/`dek_encrypted`/`nonce`) leaks to the browser.
**Avoid:** enumerate columns in the `.select()` string AND build the response object field-by-field; add a
vitest assertion that the serialized body contains none of the five secret column names.

### Pitfall 2: Ph91 empty-read false-red in the e2e
**What goes wrong:** an e2e seeds the composite draft as a *different* user → the authed browser RLS read
returns empty → rehydration looks broken though the app is correct.
**Avoid:** seed the draft + `strategy_keys` **owned by the logged-in test user** (MEMORY Ph91 lesson).

### Pitfall 3: Making "Review your keys" non-destructive for the single-key branch too
**What goes wrong:** single-key "Try another key" is *supposed* to discard the wrong key + mint a fresh
session; blanket-removing the delete breaks the F6 fence / duplicate-submit protections (WizardClient.tsx:649-657).
**Avoid:** split by `isComposite` — only the composite label loses the destructive behavior.

### Pitfall 4: Forward-skip past an incomplete step in the clickable stepper
**What goes wrong:** clicking `review` before `syncSnapshot`/`metadataDraft` exist renders a guard-failed blank
(the render conditionals at `:682`, `:707` require those deps).
**Avoid:** the completion predicate must *block forward* navigation to a step whose prerequisites are absent.

## State of the Art

N/A — internal codebase change, no ecosystem/library currency concerns.

## Validation Architecture

`nyquist_validation` is enabled (config.json `workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (`package.json:70`) + jsdom for component tests |
| Config file | `vitest.config.ts` (coverage-gated: lines 82 / stmts 80 / fns 74 / branches 72) |
| Quick run command | `npx vitest run src/app/\(dashboard\)/strategies/new/wizard` |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map
| Req | Behavior | Type | Command | File Exists? |
|-----|----------|------|---------|-------------|
| WIZ-01 | response omits all 5 secret cols; owner-scope; shape | unit | `npx vitest run src/app/api/strategies/composite/**/route.test.ts` | ❌ Wave 0 (new route + test; model on set-members/route.test.ts ✅) |
| WIZ-02 | mount rehydrates 2 validated panels, no re-validate, secretless Continue | unit | `npx vitest run …/steps/MultiKeyConnectStep.test.tsx` | ✅ extend |
| WIZ-03 | "Review your keys" → connect_key, no DELETE, session unchanged | unit | `npx vitest run …/WizardClient.test.tsx` | ✅ extend |
| WIZ-04 | clickable navigable cells, forward-skip blocked, aria preserved | unit | `npx vitest run …/WizardChrome.test.tsx …/WizardClient.test.tsx` | ✅ extend |
| WIZ-05 | cachedSnapshot short-circuits kickoff; no /api/keys/sync fetch | unit | `npx vitest run …/steps/SyncPreviewStep.render.test.tsx` | ✅ extend |
| WIZ-01..05 | full round-trip back-nav keeps keys (RLS + real nav) | e2e | Playwright `e2e/composite-onboarding.spec.ts` | ✅ extend (owner-seeded) |

### Sampling Rate
- **Per task commit:** the targeted `npx vitest run …/wizard` (+ the touched route test).
- **Per wave merge:** `npm test` (frontend `frontend` aggregator gate).
- **Phase gate:** full vitest green + `npx tsc --noEmit` + `npm run lint` before verify.

### Wave 0 Gaps
- [ ] `src/app/api/strategies/composite/{members|[strategyId]/keys}/route.ts` + `route.test.ts` — WIZ-01 (new; model on `set-members/route.test.ts`).
- [ ] Owner-seeded composite-draft fixture for the e2e round-trip (Ph91: owned by the logged-in user). This is the **one genuinely-e2e item** (RLS + real unmount/remount navigation); WIZ-01..05 unit behavior is all offline-vitest-coverable.

## Environment Availability

No new external dependency — code + one additive GET route only. **SKIPPED (no external dependencies).**

## Security Domain

`security_enforcement` not set to false → enabled. WIZ-01 is the security-load-bearing item.

### Applicable ASVS
| Category | Applies | Control |
|----------|---------|---------|
| V4 Access Control | yes | Owner-scoped read via RLS (`owner_id/user_id = auth.uid()`) + explicit ownership guard mirroring `set_wizard_composite_members` (mig …180000:183-198); non-owner → empty/403 |
| V5 Input Validation | yes | `isUuid(strategy_id)` (mirror set-members/route.ts:61); uniform `{ code }` error posture |
| V6 Cryptography | yes | **Never** select/serialize the 5 envelope columns; ciphertext stays server-side (the whole point of WIZ-01) |
| V9 Data Protection | yes | `NO_STORE_HEADERS` on the read (mirror set-members); no key material in logs (add-key H-0305 posture) |

### Threat patterns
| Pattern | STRIDE | Mitigation |
|---------|--------|-----------|
| Ciphertext exfil via over-broad SELECT | Information Disclosure | Enumerate non-secret cols; field-by-field response build; vitest leak assertion |
| Cross-tenant member read | Elevation / Info Disclosure | RLS owner gate (both tables) + ownership guard; Ph91 empty-for-non-owner is correct |
| Existence oracle on strategy_id | Information Disclosure | "not found" == "not owned" (filter by user_id), per set_wizard_composite_members:183-186 |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "verified" = membership (validated read-only at add-key) rather than a separate flag product wants surfaced | WIZ-01 | Low — could also expose `is_active`; both are non-secret and available |
| A2 | Product wants the composite "Review your keys" purely non-destructive (no "start composite over" affordance needed here) | WIZ-03 | Medium — if a destructive "start over" is also wanted, add a second explicit button rather than overloading review |
| A3 | Making the existing stepper pills into buttons is within DESIGN-05's keyboard spec and needs no new design token | WIZ-04 | Low — DESIGN.md:241 already specifies Enter-activation; still worth a design-review glance |
| A4 | Within-session cache (React state) satisfies WIZ-05; full-reload durability is a nice-to-have | WIZ-05 | Medium — if reload-durability is required, extend the skip-kickoff condition to any COMPLETE composite (see Risks) |

## Open Questions / Risks

1. **WIZ-05 reload durability.** The threaded `syncSnapshot` is null after a hard page reload. Recommend
   extending `SyncPreviewStep`'s mount-skip condition (`:365`) so a **COMPLETE** composite skips the
   `/api/keys/sync` kickoff regardless of the 5-min freshness window — a finished stitch never needs re-running
   just to display. Decide in discuss-phase whether within-session cache suffices or reload-durable is required.
2. **Partial-membership edge (WIZ-02).** If a member's `api_key` was deleted in `ApiKeyManager`, the FK cascade
   (`strategy_keys.sql:32`) removes the member, so the WIZ-01 read returns `< 2` members. `set-members`/its RPC
   still require the composite invariant — surface this honestly rather than silently rehydrating a broken set.
3. **Owner-seeded e2e is the only true-e2e need.** Everything else is offline-vitest-coverable. The e2e fixture
   MUST be owned by the logged-in user (Ph91) or it false-reds.
4. **Affordance semantics (A2).** Confirm with the user whether composites still need any destructive
   "start the composite over" path, or whether "Review your keys" + per-key remove-with-confirm (already in
   `MultiKeyConnectStep`) is the complete story.
5. **No migration is a deliberate design choice** — if a future need (e.g. audit of member reads) argues for an
   RPC, revisit; for Phase 94 the plain authed select is correct and lower-risk.

## Sources

### Primary (HIGH — codebase, file:line verified this session)
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` — step machine, `onTryAnotherKey` (647-663), render switch, snapshot state
- `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx` — panels/mode/strategyId state, validatePanel, buildSetMembersKeys, allValidated
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` — mount kickoff effect (330-434), freshness skip, review labels (1046/1399/1473)
- `src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx` — inert stepper cells (144-169)
- `src/app/api/strategies/composite/set-members/route.ts` + `add-key/route.ts` — auth/ownership posture, secretless set-members contract, validate-read-only gate
- `supabase/migrations/20260710120000_strategy_keys.sql` — storage + owner RLS
- `supabase/migrations/20260405061911_initial_schema.sql:19-32` — api_keys secret columns
- `supabase/migrations/20260710180000_wizard_composite.sql` — set_wizard_composite_members RPC (ownership guard, wholesale write)
- `DESIGN.md:241,302` — stepper keyboard-activation spec
- `.planning/ROADMAP.md:71-82`, `.planning/REQUIREMENTS.md:21-25`, `.planning/STATE.md`

### Secondary (MEMORY — durable project lessons)
- Ph91 owner-seeded-fixture / RLS-empty-for-non-owner lesson
- supabase-migrate auto-applies-to-PROD-on-merge

## Metadata
**Confidence breakdown:**
- WIZ-01 storage + leak vectors + no-migration verdict: HIGH — schema + RLS + route posture all read directly
- WIZ-02 rehydration + secretless proof: HIGH — set-members contract + validated-panel shape verified
- WIZ-03 affordance split: HIGH — exact callback + three call sites located
- WIZ-04 stepper: HIGH — inert cells + state machine located; design conformance MEDIUM (needs a glance)
- WIZ-05 cache seam: HIGH — mount effect + existing snapshot state located; reload-durability an open decision

**Research date:** 2026-07-11
**Valid until:** ~30 days (internal codebase; stable unless the wizard is refactored)

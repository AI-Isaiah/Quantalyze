# Phase 167: CREDTRUST — an invalid venue credential is named to the customer - Context

**Gathered:** 2026-09-22
**Status:** locked — ready for planning
**Decided at sha:** 956f663f
**Mode:** Autonomous (every decision below is taken from repo evidence measured at that sha and
recorded with the evidence; no founder prompts were issued, and none were owed — see D-15)

<domain>
## Phase Boundary

**This phase adds a CAUSE to a staleness signal that is already correct.**

That framing is the single most useful thing measured during this discussion, and it narrows the
phase sharply. The product already detects and renders "this track record has stopped moving", on
the right signal, with the right tone ladder:

- `FreshnessChip` in `src/app/factsheet/[id]/v2/FactsheetView.tsx` already computes a
  `fresh | unknown | stale | old | future | neutral` verdict and already takes **the staler of the
  job-age arm and the series-age arm** (`seriesIsBinding`), so the same "a signal no status
  transition can advance" principle the SQL view uses is already the binding one on screen.
- `public.ledger_refresh_staleness` (`supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql`)
  already carries a server-side verdict keyed on `max((e->>'date')::date)` over `returns_series`,
  with a `stale_reason` of `no_analytics_row | status_not_success | no_return_date | series_behind`.
- `AllocatorSyncStatus` (`src/components/exchanges/AllocatorSyncStatus.tsx`) already renders a
  7-state owner-facing pill, and its `revoked` arm already carries the correct SHAPE: an authored
  remedy line, `"Re-add a read-only key from your exchange."`

**What is missing is the sentence that connects the two.** The customer is told the track record is
stale; they are never told that the reason is a credential that no longer works, and on the owner
surface they are told the opposite — that a retry is coming.

**In scope:** naming a credential failure as the cause of a stalled factsheet, on the two surfaces
the ROADMAP names — the **owner-facing key/sync surface** and the **wizard validate surface** —
venue-agnostically, and suppressing the copy that promises a retry that cannot succeed.

**Out of scope:** the OPS-facing prober vocabulary (Phase 164.8.3 PROBERAUTH owns it — same root,
two audiences, explicitly not merged); changing which failures classify as `auth` versus `transient`
(the A-04 classification is a locked decision from 164.5.4 and is not reverted here — see D-05);
email/push notification of the condition (D-14); and any change to the ledger-refresh pipeline
itself.

</domain>

<decisions>
## Implementation Decisions

### The blocking dependency — settled, and the ROADMAP's attribution of it is WRONG

- **D-01: The 161.1 ledger refresh IS LIVE in production, so this phase is unblocked on the
  substance and not merely on the phase status.** ⛔ **But it was NOT activated by Phase 164.7.**
  Measured at `956f663f`: `164.7-07-SUMMARY.md` records the **DEFERRED** path — the founder declined
  the activation on a failed pre-flight (`P3-C`), `20260907130000` reported
  `applied DORMANT (system_flags.ledger_refresh_enabled = false; NOTHING scheduled)`, and the
  committed manifest held 14 jobs with `ledger_refresh_fanout` **absent**. The activation was taken
  later, by **Phase 164.5.1 plan 09** (commit `d6607a88`, executed 2026-09-17): `provides:` records
  *"the 161.1 ledger refresh ACTIVATED in production: ledger_refresh_enabled = true,
  ledger_refresh_fanout registered as jobid 40 on 25 \* \* \* \*"*, preconditions read before the
  write, and the oracle re-captured **by script** rather than by hand.
  **The live evidence in this repo is `scripts/prod-prober/cron-manifest.json`**, captured from
  PRODUCTION at `2026-09-18T18:02:50Z` with a `database_marker` naming PRODUCTION: jobid 40,
  `ledger_refresh_fanout`, `25 * * * *`, `active: true`,
  `SELECT public.enqueue_ledger_refresh_for_strategies();`.
  ⚠️ **The ROADMAP's `Depends on:` line should be corrected to name 164.5.1 plan 09 rather than
  164.7 plan 07.** A reader who checks 164.7 and finds `Complete` will conclude the dependency is
  met for the right reason by accident; a reader who reads 164.7 plan 07 in full will conclude it is
  NOT met and stall the phase. Both readings are wrong. ⛔ Do not edit the ROADMAP inside the
  planning run — it is a phase-owned correction, made when the phase ships.

- **D-02: A live SCHEDULE is not a live REFRESH, and this phase must not treat it as one.** The
  fan-out body's first act is to read `system_flags.ledger_refresh_enabled`; when it is not TRUE the
  function logs `dormant … enqueued 0` and the cron row still reports success. That is the repo's
  own recorded trap (`pg_net` is async, so a green cron proves ENQUEUE and nothing more). 164.5.1
  plan 09 records the flag as `true` at activation, but nothing in this repository re-reads it, and
  ⛔ no database command may be run from this checkout to re-read it.
  **Therefore the product must never infer "your credential is broken" from staleness alone.**
  See D-03 for the rule this produces. — **Reversibility:** reversible — a rule about how a verdict
  is composed, local to the new code.

- **D-03: The credential verdict is a CONJUNCTION, and each conjunct must be independently
  observable.** A customer is told a credential is the cause only when BOTH hold: (a) the freshness
  substrate says the track record has stopped advancing, and (b) there is a credential-shaped
  failure attached to the key that fed it. Staleness alone answers "we do not know why" — which is
  an honest state the chip already has a tone for (`unknown`). This is the exact harm the ROADMAP
  names: the measured strategy with perfect credentials and a frozen `computed_at` must not be told
  to fix a key that is not broken.
  ⭐ The (b) conjunct is what the phase mostly has to build; (a) is consumed, never reinvented.

### Where it renders — and the constraint that decides it

- **D-04: The cause renders on OWNER surfaces only. It must NOT enter the public factsheet
  payload.** ⛔ **This is the hardest constraint in the phase and it is measured, not inferred.**
  `src/app/factsheet/[id]/v2/page.tsx` runs a public lane and an owner lane, and the payload is
  served through an `unstable_cache` whose **effective key is the strategy id ONLY**, with a 3600 s
  TTL; the file's own header states that a viewer-dependent payload routed through that wrapper
  *"would be served to every subsequent ANONYMOUS visitor … for the full 3600s TTL, silently, with
  the poisoning request being the owner's own and therefore rendering correctly."* There is a
  dedicated regression guard (`phase-148-owner-lane-cache-isolation.test.ts`) and a second public
  surface (`src/app/factsheet-share/`) whose header forbids widening the projection toward
  `api_keys` at all.
  ⇒ Putting "this manager's credential stopped working" into the cached factsheet payload would
  publish it to anonymous readers, and would do so intermittently and invisibly. The public
  factsheet keeps its existing tone-only chip; the CAUSE belongs to the owner's own surfaces.
  — **Reversibility:** one-way — undoing a leak is impossible; the cache TTL means the disclosure
  is already distributed before anyone observes it. ⭐ A plan that touches
  `fetchAndBuildPayload`, the cached wrapper, or the share route earns a `checkpoint:decision`.

- **D-05: The user-visible defect lives in TypeScript, and a Python-side string change does not
  reach the user.** Two independent instances, both measured:
  1. **Owner surface.** `AllocatorSyncStatus`'s `error` arm is
     `pillLabel = "Sync failed"` with `helperText = syncError ?? ""` — it renders the RAW
     `api_keys.sync_error` DB string. That is how
     `MT5_UNREACHABLE_NOTE` (`analytics-service/services/allocator_positions.py`) reaches a
     customer verbatim. The `revoked` arm, by contrast, ignores `syncError` and renders an
     AUTHORED constant. **The fix shape is already in the file.**
  2. **Wizard surface.** `routers/exchange.py::validate_key` answers the transient arm with
     `424 NETWORK_UNAVAILABLE`; `VENUE_WIRE_CODE_TO_VERDICT` maps that to `KEY_NETWORK_TIMEOUT`,
     whose `actions` include `clear_and_retry`, which is in `RECOVERABLE_ACTIONS`
     (`src/lib/envelope.ts`), so `buildEnvelope` derives `recoverable: true` and
     `ErrorEnvelope` renders the Retry. **The Retry is rendered by TypeScript, not by the detail
     string.**
  ⚠️ The A-04 classification is NOT reverted. Refusing to guess is correct; the defect is the copy
  the refusal lands on.

- **D-06: The wizard fix is the full cross-language treatment plan 02 used for
  `KEY_UNDECRYPTABLE`, and there is an existing mechanism that FORCES the `VENUE_WIRE_CODE_TO_VERDICT`
  row rather than leaving it to diligence.** `src/lib/seam-venue-vocabulary.invariant.test.ts`
  derives the Python emitter's `error_code` vocabulary from `analytics-service/**/*.py` and compares
  it **as a SET** against the hand-typed dispositions, so a newly emitted code with no disposition
  row reds **by name**. ⭐ That is the A-05 lesson already mechanised — the planner should lean on
  it, not re-invent a checklist. The pins that move: **two** hand-typed `EXPECTED_TABLE_SIZE`
  constants in `src/lib/wizardErrors.test.ts` (⛔ grep them — `grep -an 'const EXPECTED_TABLE_SIZE'`
  — never count), both currently `94`, plus a third self-referential assertion in the same file that
  reads them back out of the source with a regex.

- **D-07: Mint a new `WizardErrorCode`; do NOT reuse `KEY_MUST_BE_RECONNECTED`, and do NOT route at
  `KEY_AUTH_FAILED`.** Measured:
  - `KEY_MUST_BE_RECONNECTED` has exactly the right ACTION shape
    (`actions: ["request_call", "expand_log"]` — neither `RECOVERABLE_ACTIONS` member, so no Retry
    renders) and exactly the wrong COPY: it asserts *"a fault on our side of the store rather than a
    sign that anything is wrong with the account or its password"* — the opposite cause. Reusing it
    would trade one wrong cause for another. **Copy its shape, not its entry.**
  - `KEY_AUTH_FAILED` carries `clear_and_retry` and says *"The exchange rejected these
    credentials."* — a confident claim the classifier deliberately refuses to make on this arm
    (D-05, A-04). Routing here would re-introduce the false-permanent-blame that 164.5.4 removed.
  ⇒ The new code's copy must be honest about UNCERTAINTY — the terminal could not be reached, and a
  credential that no longer works is one of the reasons — while suppressing the Retry.
  — **Reversibility:** costly — a wire code plus a disposition row plus two copy-table pins plus
  both wizard rosters; removing it later reds the same set of guards.

- **D-08: Suppressing the wizard Retry is affirmatively correct here, not merely prescribed.**
  On this arm the terminal is unreachable, and the measured mechanism for a wrong MT5 password is a
  MODAL LOGIN DIALOG blocking IPC (the `-10005` class). A Retry re-runs the same validate against a
  wedged terminal — and phases 164.6.5 / 164.6.6 establish that repeated validate attempts against
  that one shared terminal are the operation implicated in wedging and account eviction. So the
  Retry is not just useless, it is the harmful action. Record the reason; do not present the
  suppression as taste.

### Venue-agnosticism — where it actually lives

- **D-09: The defect is a COPY FAMILY, not a string, and the family is already venue-agnostic.**
  `analytics-service/services/allocator_positions.py` carries at least five end-user notes ending in
  *"— sync will retry automatically."* (MT5 unreachable, MT5 unidentified account, sFOX balances,
  a `{venue}`-templated balances note, a `{venue}`-templated positions note) plus a rate-limit note.
  ⛔ A plan that fixes the MT5 string alone is a scope error. The `bybit` evidence
  (`retCode 33004 "Your api key has expired."`, failing since 2026-08-14, unsurfaced) is the second
  venue of the same class.

- **D-10: The retry PROMISE must be a function of the retry DISPOSITION, and the authority already
  exists and is already consulted.** `services.job_worker.classify_exception` is named in
  `allocator_positions.py` as *"THE AUTHORITY on retry disposition"*, deliberately consulted rather
  than mirrored — because a hand-copied allow-list is what broke this before, downgrading two
  permanent failures to transient *"under the copy 'sync will retry automatically' — a promise that
  cannot be kept."* ⇒ the end-user note must not promise a retry the classifier calls permanent.
  ⚠️ **This alone does NOT close the phase**, and the planner must not treat it as if it does: the
  measured MT5 wrong-password case arrives as a TRANSPORT failure and classifies **transient**, so
  the note stays truthful-but-useless. Closing it needs the D-03 conjunction — a transient failure
  that has REPEATED while the refresh was demonstrably running is no longer a blip.

### The one decision left genuinely OPEN

- **D-11 ⛔ OPEN — does a credential failure get an EXISTING `api_keys.sync_status` value, or a new
  one?** The planner closes this behind a `checkpoint:decision`. Both arms are costed here so the
  choice is made on measurement, not on which is fewer characters.
  - **Arm A — route onto the existing `revoked`.** Cheapest by far: `revoked` already has authored
    copy, a red pill, and chips on `HoldingsTable` and `OpenPositionsTable`. ⛔ **But `revoked` is
    not only a label — it is a FILTER.** `HoldingsTable` does
    `holdings.filter(h => h.source_key_sync_status !== "revoked")`, and both ledger-refresh
    enqueuers carry `sync_status IS DISTINCT FROM 'revoked'`
    (`src/app/api/keys/[id]/rotate-secret/route.ts` documents both). Routing an MT5 wrong-password
    onto `revoked` would therefore **hide that key's holdings from the allocator dashboard and stop
    enqueueing its refresh** — side effects nobody asked for, arriving silently. Its copy is also
    venue-wrong for MT5 ("Re-add a read-only key from your exchange" — MT5 has a password, not a
    key).
  - **Arm B — mint a new `sync_status` value.** `sync_status` is a CHECK constraint on `api_keys`
    (`20260406065011`, widened by `20260420073003` to add `revoked` and `rate_limited`), so this is
    a `DROP CONSTRAINT` / `ADD CONSTRAINT` migration — and `supabase/migrations/**` AUTO-APPLIES to
    PROD on merge. It also touches every reader that switches on the value, including
    `AllocatorSyncStatus`'s `PILL_STYLES` map whose unknown-value fallback is a silent **neutral
    idle pill** — i.e. a half-done rollout renders a broken key as healthy.
  - **Arm C — leave `sync_status` alone and carry the cause in a separate, additive column or in
    the authored helper only.** Avoids both side effects; costs a second source of truth.
  — **Reversibility:** Arm A is `costly` (it silently changes the meaning of a value two filters
  already act on); Arm B is `one-way` (a CHECK-constraint migration against PROD, and 3 reviewers
  are required before any apply); Arm C is `reversible`.
  ⛔ Whichever arm is chosen, the `AllocatorSyncStatus` copy table is **LOCKED VERBATIM** with
  character-for-character unit tests (including the U+2026 and U+2014 code points) — the table is
  EXTENDED deliberately and its pins updated in the same change, never reworded in passing.

### Discipline

- ⛔⛔ **D-15b (ADDED 2026-09-22, MEASURED during execution) — THE `requirements:` IDS IN THIS
  PHASE'S PLANS COLLIDE WITH THE GLOBAL `REQUIREMENTS.md` LEDGER. NEVER RUN
  `requirements.mark-complete` WITH THEM.**
  This phase has no v1.20 requirement IDs, so its plans use the phase-local decision IDs (D-01…D-15)
  from THIS file as their `requirements:` frontmatter. Three of those strings also exist in the
  global `.planning/REQUIREMENTS.md`, meaning something entirely different:

  | id | global `REQUIREMENTS.md` meaning | this phase's meaning | carried by |
  |---|---|---|---|
  | **D-09** | the composite `stitch_composite` re-run mechanism / "composite healer" | "the defect is a COPY FAMILY, not a string" | plans 01, 02, 04 |
  | **D-03** | a per-venue capability-flag precedent (`passphraseSecret`) | "the credential verdict is a CONJUNCTION" | plans 03, 04 |

  ⇒ **`requirements.mark-complete D-09` would tick off the composite healer** — a phase-scale item
  nobody in 167 has touched — and the ledger would then claim delivered work that does not exist.
  ⭐ **Caught by 167-02's executor, which tried the handler, read the refusal, checked what the
  global id actually meant, and declined rather than forcing it.** That is the correct behaviour and
  the reason this entry exists.
  ⚠️ `D-14` looks like a third collision under a naive grep but is NOT — the only global hit is the
  substring inside `D-146-4`. ⛔ Do not "fix" it.
  **Disposition:** the phase's own completion is tracked by its SUMMARY files and this CONTEXT, not
  by the global ledger. ⛔ Leave `REQUIREMENTS.md` untouched for the whole of Phase 167.

- **D-12: The staleness view is `service_role` only and `security_invoker = true`.** A customer-facing
  reader cannot select it as `authenticated`. Any consumption path must be designed for that —
  and if a SECURITY DEFINER wrapper is chosen, this repo has two dated traps to honour: a SECDEF
  function used inside a `{public}` RLS policy needs `anon EXECUTE` or anon reads become a clean,
  silent zero-row `[]`; and delete-guards must exempt `sanitize_user`. — **Reversibility:** costly.

- **D-13: Any migration this phase produces goes through `migration-reviewer` +
  `rls-policy-auditor` + `silent-failure-hunter` BEFORE it is proposed for apply.** Standing repo
  rule, restated because D-11 arm B would produce one.

- **D-14: In-product only. Email/push notification of the condition is NOT in this phase.** The
  ROADMAP goal says *"in the product, on the surface where they notice the symptom"*. The 17-day
  silence is evidence of the gap, not a mandate for an alerting channel; an
  `api_key_rotation_reminder` cron already exists and a second notifier designed here would collide
  with it. Deferred, named, not lost.

- **D-15: No founder question was suppressed to produce this document.** Every area above resolved
  against measured repo evidence. D-11 is left OPEN because it is genuinely open — it has a
  one-way arm with a PROD migration and two measured silent side-effects — and not because leaving
  one open looks careful.

- **D-16: The holdings surfaces' "healthy" test is an EQUALITY against `revoked`, and it is
  widened to a shared predicate in the SAME commit as the writer — founder decision 2026-09-22.**
  Found independently by `rls-policy-auditor` and `silent-failure-hunter` during plan 03's D-13
  review round, and re-measured by the orchestrator: **7 sites**, six in
  `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` and one in
  `OpenPositionsTable.tsx`, each of the shape `source_key_sync_status !== "revoked"` or
  `=== "revoked"`. There is no allow-list, no enum and no closed set over the column anywhere, so
  **every status that is not `revoked` defaults to the healthy branch**. The consequence once
  `167-04` lands the writer: a holding sourced from a key the venue has stopped accepting renders
  un-chipped, un-filtered and counted in the headline AUM — the exact false-confidence failure this
  phase exists to remove, reproduced one surface over. Within-tenant only; the ADR-0022 two-layer
  gate is intact and unweakened.
  ⛔ **Not deferred, and not folded into plan 03.** The harm exists only once a row can carry the
  value, so the fix belongs with the writer: `167-04`'s `files_modified` gains the two components
  and the equality is replaced by ONE shared predicate rather than a third and fourth hand-kept
  copy. Landing both in one commit means there is never a window in which the value exists and the
  surface lies about it. ⚠️ Plan 03 was deliberately NOT widened at its gate — three reviewers had
  already signed off on its scope, and reopening a reviewed scope to append an unreviewed change is
  how a fix round becomes a regression.
  ⚠️ **The class is wider than the two files.** `HoldingsTabPanel`'s `keyStatusById` map and
  `ApiKeyManager.tsx`'s `SyncProgress` (`syncStatus !== "idle"`, no `sign_in_failed` branch, and
  NOT confirmed to be fed from `api_keys.sync_status`) carry the same shape. `167-04` closes the two
  money surfaces; anything it does not reach is named in its SUMMARY rather than left implied.

### Claude's Discretion

- The exact wording of the new `WizardErrorCode` copy and the authored owner-surface helper line,
  within DESIGN.md's constraints (below).
- Whether the owner-surface cause renders as an extra helper line, a distinct pill state, or both —
  downstream of D-11.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The freshness substrate (consume — do not reinvent)
- `supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql` — the server-side freshness
  verdict keyed on `max(date)` inside `returns_series`, with `is_stale` / `stale_reason`; also the
  single SQL home of the ledger venue set, and its access-control posture (service_role only,
  `security_invoker`).
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — `FreshnessChip`, `bucketByAge`, `TONE_RANK`,
  `seriesIsBinding`, and `SeriesRecencyLine`: the client-side verdict that already renders.
- `src/lib/freshness.ts` — where the threshold constants live (`computeFreshness`, the 12h/48h and
  3d/7d ladders).

### The public/owner cache boundary (D-04 — read before touching any factsheet path)
- `src/app/factsheet/[id]/v2/page.tsx` — the owner-lane / public-lane split and the id-only
  `unstable_cache` key with its 3600 s TTL.
- `src/app/factsheet-share/` (the tokenized public route) — its SECURITY BOUNDARY header, including
  the explicit prohibition on widening the projection toward `api_keys`.
- `src/__tests__/` → `phase-148-owner-lane-cache-isolation.test.ts` — the existing regression guard.

### The owner-facing sync surface
- `src/components/exchanges/AllocatorSyncStatus.tsx` — the 7-state pill, the LOCKED copy table, the
  `revoked` authored helper, and the `error` arm that passes `sync_error` through verbatim.
- `src/components/exchanges/AllocatorExchangeManager.tsx` — its caller.
- `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` and `OpenPositionsTable.tsx` — the
  `source_key_sync_status !== "revoked"` FILTER and the amber revoked chip (D-11 arm A's hidden cost).
- `src/app/api/keys/[id]/rotate-secret/route.ts` — the one place `sync_status` is cleared back to
  `idle`, and the documented note that the worker never writes it back.

### The wizard cross-language contract
- `src/lib/wizardErrors.ts` — `VENUE_WIRE_CODE_TO_VERDICT`, the copy table,
  `KEY_MUST_BE_RECONNECTED` (the shape to copy), `KEY_AUTH_FAILED` and `KEY_NETWORK_TIMEOUT` (the
  two codes NOT to route at).
- `src/lib/envelope.ts` — `RECOVERABLE_ACTIONS` and `buildEnvelope`; where `recoverable` is derived.
- `src/components/error/ErrorEnvelope.tsx` — the canonical renderer; Retry renders iff
  `envelope.recoverable && onRetry`.
- `src/lib/wizardErrors.test.ts` — the two `EXPECTED_TABLE_SIZE` pins (grep, never count) and the
  self-referential regex assertion that reads them back out of the source.
- `src/lib/seam-venue-vocabulary.invariant.test.ts` — the Python-emitter ↔ TS-disposition SET
  comparison that reds by name on an undispositioned new code.
- `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` and
  `MultiKeyConnectStep.tsx` — the two wizard rosters, `KNOWN_CREATE_WITH_KEY_CODES` and
  `KNOWN_ADD_KEY_CODES` (and the `ROSTER-DERIVE-01` note on why they are duplicated).
  > ⛔ **CORRECTED 2026-09-22 by the orchestrator, against a measurement.** This line named
  > `SyncPreviewStep.tsx` as the second roster. It is not. Measured at `36216917`: the two
  > `ReadonlySet<WizardErrorCode>` rosters are `KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx`)
  > and `KNOWN_ADD_KEY_CODES` (`MultiKeyConnectStep.tsx`). `SyncPreviewStep.tsx` carries a THIRD,
  > differently-typed roster — `KNOWN_KICKOFF_CODES: Readonly<Record<string, WizardErrorCode>>` —
  > governing post-connect job kickoff, a different failure surface from connect-time validate.
  > A planner that edited `SyncPreviewStep.tsx` and skipped `MultiKeyConnectStep.tsx` would have
  > left the multi-key connect path rendering the UNKNOWN terminal for the new code.
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` — `KNOWN_KICKOFF_CODES`,
  the third roster; in scope only if the kickoff surface is in scope.

### The Python side
- `analytics-service/routers/exchange.py` — `validate_key`, the `424 NETWORK_UNAVAILABLE` /
  `recoverable=True` transient arms, and `VenueTransientHTTPException`.
- `analytics-service/services/allocator_positions.py` — `MT5_UNREACHABLE_NOTE` and the rest of the
  *"sync will retry automatically"* copy family; `_map_exception_to_sync_status`;
  `_must_reach_handler_unwrapped` and its "THE AUTHORITY on retry disposition" note.
- `analytics-service/services/job_worker.py` — `classify_exception`, the authority itself.
- `analytics-service/services/equity_reconstruction.py` — the second
  `_map_exception_to_sync_status`, identical table.

### Dependency evidence (D-01)
- `.planning/phases/164.7-.../164.7-07-SUMMARY.md` — the DEFERRED activation and its measured cause.
- `.planning/phases/164.5.1-.../164.5.1-09-SUMMARY.md` — the activation that actually happened,
  2026-09-17, with its preconditions and the by-script oracle re-capture.
- `scripts/prod-prober/cron-manifest.json` — the PROD reading: jobid 40, `25 * * * *`, active.

### Design
- `DESIGN.md` — §Error Envelope (visual contract; the authoring rule that every error path MUST call
  `buildEnvelope`, no inline-string envelopes), §Color semantic gates (**red = permanent / hard
  error; amber = recoverable and deliberate** — the 2026-07-02 decision states red is *forbidden*
  for a recoverable exclusion), §Generative Principle (*"a freshness stamp toned by age, and copy
  that states its own limits"*), and §9-State Matrix (`stale` is a declared state on every API-key
  surface).
- `.planning/ROADMAP.md` → `### Phase 167` — every claim in it is a PROD measurement; do not
  re-derive them.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`public.ledger_refresh_staleness`** — a ready-made per-strategy `is_stale` + `stale_reason`.
  Consume it; do not build a second freshness rule (D-12 notes its grant posture).
- **`FreshnessChip` / `SeriesRecencyLine`** — the staleness render already exists and already takes
  the staler of two arms. This phase adds a reason beside it, on owner surfaces only.
- **`KEY_MUST_BE_RECONNECTED`** — the exact action-shape for a non-retryable reconnect remedy
  (`["request_call", "expand_log"]`, neither `RECOVERABLE_ACTIONS` member).
- **`AllocatorSyncStatus`'s `revoked` arm** — the exact shape for an authored helper that ignores
  the raw DB error string.
- **`classify_exception`** — the venue-agnostic retry-disposition authority, already imported
  lazily inside the function to keep the import graph acyclic.

### Established Patterns
- **Copy tables are hand-typed rosters pinned by size constants**, and a new code must move every
  pin in the same change. Grep the pins; never count them.
- **Wire vocabulary is derived, not trusted**: the Python emitter's code set is compared as a SET
  against the TS dispositions, so a new code without a row fails by name.
- **Locked-verbatim copy** is a real convention here, asserted character-for-character down to the
  U+2026 / U+2014 code points. Extending such a table is a deliberate act with its pins updated.
- **The public factsheet payload is cached by id alone**; viewer-dependent content in it is a leak.

### Integration Points
- Python → DB: `api_keys.sync_status` / `sync_error` written by the allocator worker's failure arm.
- DB → owner UI: `AllocatorExchangeManager` → `AllocatorSyncStatus`; allocations dashboard →
  `HoldingsTable` / `OpenPositionsTable` chips.
- Python → wizard: `routers/exchange.py` wire code → `VENUE_WIRE_CODE_TO_VERDICT` →
  `WizardErrorCode` → `buildEnvelope` → `ErrorEnvelope`.
- SQL → (undecided consumer): `ledger_refresh_staleness`, service_role only today.

</code_context>

<specifics>
## Specific Ideas

- The phrase to beat, and the reason this phase exists: the owner is currently told
  *"…— sync will retry automatically."* while the retry provably cannot succeed. Any replacement
  copy must survive DESIGN.md's five-second test — *would this screen survive being printed and
  handed to an LP?* — and must state its own limits rather than assert a cause the classifier
  refused to assert.
- Tone: a credential the customer can rotate is **recoverable**, so the owner-surface treatment sits
  in the amber family alongside the existing revoked-key chip, not in red. DESIGN.md's 2026-07-02
  decision forbids red for a recoverable state.

</specifics>

<deferred>
## Deferred Ideas

- **Proactive notification (email/in-app inbox) when a key crosses into the credential-failure
  state.** The 17-day silence is real, but the ROADMAP's goal is explicitly in-product, an
  `api_key_rotation_reminder` cron already exists, and a second notifier designed here would collide
  with it. → its own phase (D-14).
- **Correcting `### Phase 167`'s `Depends on:` attribution** from 164.7 plan 07 to 164.5.1 plan 09
  (D-01). A one-line ROADMAP edit, made when this phase ships — not inside the planning run.
- **A repo-side or CI-side liveness assertion that `system_flags.ledger_refresh_enabled` is still
  TRUE and jobid 40 is still active** (D-02). Today the only evidence is a manifest captured on
  2026-09-18, and nothing re-reads it. Valuable, and genuinely a different phase: it is an
  ops-observability gate, not a customer-facing surface.
- **Re-reading the second `_map_exception_to_sync_status` in `equity_reconstruction.py`** — an
  identical duplicated table, a drift hazard of the class this repo already names. Not this phase's
  scope; worth its own de-duplication.

</deferred>

---

*Phase: 167-CREDTRUST*
*Context gathered: 2026-09-22*

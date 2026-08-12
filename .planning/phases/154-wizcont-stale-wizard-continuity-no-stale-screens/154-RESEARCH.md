# Phase 154: WIZCONT/STALE — Wizard continuity, no stale screens - Research

**Researched:** 2026-08-12
**Domain:** In-repo defect investigation — React poll-loop lifecycle, Supabase/PostgREST read semantics, the `compute_jobs` → `strategy_analytics` status bridge, Next.js App Router server/client draft reads
**Confidence:** HIGH on the code trace (every claim below carries a file:line read this session); MEDIUM on which of the ranked mechanisms fired on PROD on 2026-08-04 (one read-only DB query settles it — specified in §STALE-01, Step 6)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**WIZCONT-01 — Resume entry path**

- **The entry point to fix is `ContributionWizardOverlay.tsx:146` (`initialDraft={null}`)**, an
  explicit Phase 110 deferral, reached from `+ Strategy` (allocations/scenario) and the My
  Strategies empty state. ⚠️ **The ROADMAP's and REQUIREMENTS' inferred entry path is WRONG at
  HEAD** — they say `/strategies/new` is "a branch chooser with no draft awareness". It is not:
  `src/app/(dashboard)/strategies/new/page.tsx` is a pure `redirect()` (7 lines of body), and
  `…/wizard/page.tsx:79-91` already queries the draft and passes `initialDraft` down. This is
  exactly the re-observation the requirement demanded ("this was inferred from code, not observed
  click-by-click"). **Record the correction in REQUIREMENTS.md as part of this phase.**
- **Do NOT rebuild the resume state machine.** `WizardClient.tsx:198-201` already resumes to
  `sync_preview` when `initialDraft` is present. The overlay must supply the draft, nothing more.
- The overlay learns the draft through a **client-callable read that reuses the wizard page's exact
  query shape** (same columns, same `source='wizard' AND status='draft'` predicate, same
  `order created_at desc limit 1`), passed in as `initialDraft`. One query shape, two callers — a
  second divergent shape is how the two paths drift apart.
- Resume is an **explicit choice, not silent** — reuse the existing `showResumeBanner` mechanism so
  the founder picks Resume vs Start fresh. Silent resume can strand a half-typed new key.
- **The CSV short-circuit is in scope.** `WizardClient.tsx:198` returns `"csv_upload"` for
  `source === "csv"` *before* it consults `initialDraft`, so a CSV draft never resumes on either
  path. Same defect class, found during the scout; fixing only the overlay would leave the twin
  alive — the exact failure Phase 153.6 (PARITY) existed to clean up.

**STALE-01 — Investigation gate**

- ⛔ **Hard gate, from both ROADMAP criterion 2 and REQUIREMENTS: "Do not plan a fix before
  answering it."** Root cause is NOT established. The docblock at
  `SyncPreviewStep.tsx:109-111` states the poll loop "has no time-based abort (it stops only on
  success / terminal failure / 3 consecutive network errors)" — so it *should* have terminated at
  11:39:35. Why it did not is the open question.
- The investigation is a **dedicated plan (154-01) that must complete and be reviewed before any
  STALE fix plan is written**. A RESEARCH.md section alone is too easy to plan straight past.
- **"Root cause established" closes only on a failing regression test that reproduces the stall
  without the fix** — the mechanism pinned, not the symptom. A written trace plus PROD logs is the
  self-referential-oracle shape that let three money bugs survive six review passes; it is not
  sufficient here.
- **Fix at the root cause wherever it lives**, including `analytics-service/` (Python) if the job
  chain never wrote a terminal status, or the DB/RLS layer if a read is being denied. No bandaids,
  no frontend-only containment of a backend cause.
- **Both instances are in scope.** (a) the stuck "Fetching trades…" and (b) the refusal computed
  from a stale analytics row mid-re-derive. They may well share one cause; the investigation should
  test that hypothesis explicitly rather than assume two bugs.

**WIZCONT-02 — Token-less credential dedup (LOW priority)**

- **Narrow scope: only venues that already return a stable non-secret account id at validation**
  (e.g. the MT5 login). Venues without one are left unchanged and **the residual gap is written
  down**, not papered over.
- **Fail toward the EXISTING row** — return it; never overwrite. A clobber would orphan
  `strategy_keys` membership and synced history that other strategies depend on.
- The check lives **server-side, beside the existing `wizard_session_id` idempotency fence** at
  `src/app/api/strategies/create-with-key/route.ts:263-267`. One fence with two keys, so the two
  cannot drift apart.
- **Add the DB constraint too**: a partial `UNIQUE` on the non-secret identity, `WHERE` it is
  non-null — belt and braces beside the app fence, matching the existing
  `strategies_user_wizard_session_source_uniq` pattern.
  ⛔ **Never a UNIQUE on ciphertext.** `api_key_encrypted` carries a per-row `dek_encrypted` +
  `nonce`, so two encryptions of the same secret differ and the index would dedup nothing.

### Claude's Discretion

- Test placement, file naming, and component decomposition follow existing conventions.
- Whether the overlay's draft read is a route handler, a server action, or a server-component
  wrapper — decide at planning, on the criterion that the query shape stays single-sourced.
- The precise name and column type of the non-secret venue identity field.

### Deferred Ideas (OUT OF SCOPE)

- A cross-venue credential-identity scheme for venues that expose no stable non-secret account id.
  Explicitly out of scope for WIZCONT-02's narrow reading; record the residual instead.
- Phase 156 (CONNECT-REFACTOR) touches the same `create-with-key` → `api_keys` INSERT path. Do not
  pre-empt its service-role writer here; keep this phase's dedup change additive so 156 can move
  the writer without unpicking it.
- ⚠️ **Ledger defect, not phase work:** Phase 156's ROADMAP entry was appended after the v1.16
  section (line ~1239), so `gsd-sdk query roadmap.analyze` does not count it as a v1.17 phase
  (reports 15 phases, 147–155). Fix before the milestone lifecycle runs, or the audit will treat
  the milestone as complete at 155.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WIZCONT-01 | Re-entering "add a strategy" with an existing wizard draft continues where the founder left off instead of restarting | §WIZCONT-01 below: both defect sites confirmed at HEAD with line numbers (`ContributionWizardOverlay.tsx:146`, `WizardClient.tsx:199`); three candidate read mechanisms compared with the hydration/mount-ordering constraint that decides between them (§WIZCONT-01 Pitfall W-1) |
| WIZCONT-02 | Re-connecting the same credentials from a context that has lost the `wizard_session_id` token must not create a second strategy + `api_keys` row | §WIZCONT-02 below: the MT5 login is confirmed **verified server-side** but **stored encrypted only** — no non-secret column exists today; the INSERT is inside the `create_wizard_strategy` SECURITY DEFINER RPC, which is the Phase-156 collision surface |
| STALE-01 | A wizard screen never shows a state the backend has already left — (a) stuck "Fetching trades…", (b) refusal from a stale analytics row mid-re-derive | §STALE-01 below: the paradox is resolved; the docblock is **accurate and is itself the bug**. Ranked mechanisms with file:line evidence, the exact settling DB query, and three failing-test specs |
</phase_requirements>

---

## Summary

The STALE-01 paradox dissolves once you read the render condition rather than the poll loop. The
literal string `"Fetching trades..."` is reachable **only** when `computationStatus` is `null` or
`"pending"` on the **single-key** arm (`SyncPreviewStep.tsx:2315-2323`). Every terminal status —
`failed`, `complete`, `complete_with_warnings` — leaves that render entirely, and `"computing"`
renders different copy. So the screen the founder saw is proof that the poll was reading
`pending`/nothing, not that terminal detection was broken. Terminal detection is in fact **correct**:
`useStrategySyncPoller.ts:235` treats `failed` plus `isComputedAnalytics()` as terminal, and
`isComputedAnalytics` admits `complete_with_warnings` (`closed-sets.ts:715-719`) — the full producible
set from the DB CHECK (`20260602120000_*.sql`) is `{pending, computing, complete,
complete_with_warnings, failed}`, so **there is no producer value the reader fails to recognise.**
The prompt's highest-prior hypothesis is CLOSED as not-the-cause.

What the docblock says is true, and that is the defect: the loop "has no time-based abort (it stops
only on success / terminal failure / 3 consecutive network errors)". A clean read of `pending` — or
of *no row at all*, which `useStrategySyncPoller.ts:228-229` silently coerces to `"pending"` via
`statusRow?.computation_status ?? "pending"` — is neither a success, nor a terminal failure, nor an
error. It resets the consecutive-error counter and schedules the next poll. **Forever.** And the one
exit affordance built for exactly this — the SF-1 stall backstop — is gated behind `isComposite` at
the render (`SyncPreviewStep.tsx:2290-2291`), so a single-key strategy can never see it. A single-key
wizard sitting on `pending` has **no exit at all**: no banner, no envelope, no retry button, only red
prose at the 15-minute mark telling the user they may leave the page. The wizard infers "work is in
flight" from the *absence of a terminal signal* rather than from the *presence of in-flight
evidence*, and nothing bounds that inference.

Instance (b) is the same defect wearing a different hat. The composite arm already has the guard —
`series.length === 0 → return "repoll"` at `SyncPreviewStep.tsx:1094-1096`, added as R2-5 precisely
because "the stitch_composite worker does a wholesale delete→re-upsert … a poll landing inside that
window can read a 'complete' status with 0 series rows". The single-key arm has **no equivalent
guard**, and `run_derive_broker_dailies_job` performs exactly the same wholesale delete on the
strategy-mode path (`job_worker.py:2539-2560`, the "series heal-delete"). So on the single-key path a
poll landing mid-re-derive reads a stale terminal row, counts zero `csv_daily_returns` rows, and
`checkStrategyGate` refuses with `INSUFFICIENT_CSV_HISTORY` or `SERIES_PROVENANCE_UNVERIFIED`
(`strategyGate.ts:291-334`) — a terminal, loop-stopping red envelope computed from a row the backend
is in the middle of replacing. **One class, fixed on one arm only** — this repo's documented
instance-not-class pattern.

**Primary recommendation:** Plan 154-01 must land three failing tests before any fix design — (1) a
clean `pending` read that never terminates, (2) a `{data: null, error: null}` read coerced to
`pending`, (3) the single-key arm refusing on an empty series where the composite arm repolls. All
three fail at HEAD. The in-flight datum the UI-SPEC's amber state needs **already exists and is
already owner-readable** (`get_user_compute_jobs` → `/api/strategies/[id]/sync-progress`); it is
simply filtered to `kind === "stitch_composite"` at `sync-progress/route.ts:185`. No migration is
required for STALE-01. WIZCONT-02 *does* require one.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Wizard draft discovery (WIZCONT-01) | API / Backend (RLS-scoped read) | Frontend Server (SSR) — already correct at `wizard/page.tsx:79-89` | The draft row is user-owned data behind RLS. The overlay is a client-only portal (`createPortal` into `document.body`), so it cannot obtain a server-component read; it must call a server seam. |
| Resume step selection (WIZCONT-01) | Browser / Client | — | `WizardClient.tsx:198-201` is a pure function of `(source, initialDraft)`; the defect is input starvation and a branch-ordering bug, not tier misplacement. |
| Terminal-state detection (STALE-01a) | Database (the `sync_strategy_analytics_status` bridge is the sole authority) | Browser / Client (poll reader) | The bridge is the only writer that resolves `compute_jobs` aggregate → user-visible status. The client must not re-derive it; it must *read it honestly*, including the case where the bridge has never run. |
| "Recompute in flight" evidence (STALE-01b) | API / Backend (`/api/strategies/[id]/sync-progress` projecting `get_user_compute_jobs`) | Database (`compute_jobs`, RLS deny-all to `authenticated`) | `compute_jobs` is deny-all + REVOKE FROM authenticated; the sanctioned owner-scoped path is the SECURITY DEFINER RPC behind a projection route. A direct client table read is architecturally forbidden here. |
| Credential identity for dedup (WIZCONT-02) | API / Backend + Database | — | The venue-confirmed account id is only knowable server-side (the MT5 gateway asserts it); the uniqueness guarantee is only enforceable in the DB. Never client-side. |

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

| Directive | Source | Effect on this phase |
|-----------|--------|----------------------|
| "This is NOT the Next.js you know — read `node_modules/next/dist/docs/` before writing any code" | `AGENTS.md` | ⚠️ **Binding on WIZCONT-01.** Any route-handler / server-action / `'use cache'` decision must be checked against the in-repo docs, not training data. See §Assumptions Log A1. |
| `DESIGN.md` is authoritative for all visual decisions; flag deviations in QA mode | `CLAUDE.md` | 154-UI-SPEC.md already encodes this; the phase adds no new spacing/weight/color values. |
| Coverage is a **blocking CI gate**: lines 82 / statements 80 / functions 74 / branches 72 (vitest thresholds), enforced by the `frontend-coverage` job merging sharded blob reports | `CLAUDE.md` | New branches added to `SyncPreviewStep.tsx` (a 2448-line file) must ship with tests or the ratchet can regress. |
| `analytics-service/` Python enforces `--cov-fail-under=80` | `CLAUDE.md` | Applies if the fix lands in Python. |
| Rule 6 — Root-cause obsession, no bandaids | global `CLAUDE.md` | Reinforces the CONTEXT.md gate: no frontend timeout papering over a backend cause. |
| Rule 12 — Fail loud | global `CLAUDE.md` | Directly relevant: the `?? "pending"` coercion at `useStrategySyncPoller.ts:228` is a fail-*silent*. |
| Rule 8 — Read before you write | global `CLAUDE.md` | The `create_wizard_strategy` RPC has many callers; §WIZCONT-02 flags the re-base requirement. |

---

<stale_01_investigation>
## STALE-01 — Root-cause investigation (the deliverable)

### Step 0 — What the observed screen proves (the narrowing that dissolves the paradox)

`SyncPreviewStep.tsx:2315-2323`, the status line inside the spinner card:

```tsx
{computationStatus === "failed"        ? "Sync reported a failure"
 : phase === "kicking_off"             ? "Contacting exchange..."
 : isComposite                         ? (computationStatus === "computing"
                                            ? "Trades are being processed…"
                                            : "Trades are being downloaded…")
 : computationStatus === "computing"   ? "Computing analytics..."
 :                                       "Fetching trades..."}
```

The whole block only renders in the default arm, reached when `phase ∈ {kicking_off,
waiting_for_complete}` (`:2275`). Therefore **`"Fetching trades..."` renders if and only if**:

1. `phase === "waiting_for_complete"` — so the poll loop **was armed and running**; and
2. `isComposite === false` — the single-key arm; and
3. `computationStatus ∈ {null, "pending"}`.

Terminal statuses cannot produce this string: `failed` has its own line, and `complete` /
`complete_with_warnings` leave the waiting render entirely via `setPhase("passed")` / `"gate_failed"`.
`"computing"` produces different copy.

**This is the single most load-bearing fact in the investigation.** The question is not "why did the
loop not notice a terminal status" — it is **"why was the row still `pending` (or absent) after the
chain finished, and why is that state unbounded?"** [VERIFIED: read at `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:2275-2323` this session]

⚠️ **Evidence caveat, stated honestly.** REQUIREMENTS quotes `"Fetching trades…"` and the code emits
`"Fetching trades..."` — a verbatim match, which supports the strict reading above. But the step's
*subheading* (`:2306`, "We are fetching your trade history from the exchange and computing risk
metrics") renders for the whole waiting state regardless of status, so a founder paraphrasing from
memory could have meant that. Under that looser reading the candidate set widens to include
`"computing"`. Mechanism M3 below covers the loose reading and is ranked accordingly. The settling
query in Step 6 discriminates between them definitively.

### Step 1 — The poll loop, end to end

`src/hooks/useStrategySyncPoller.ts` — ladder mode (the wizard's mode, `schedule: POLL_BACKOFF_MS`):

| Concern | Behaviour | Line |
|---------|-----------|------|
| Read | `.from("strategy_analytics").select("computation_status, computation_error").eq("strategy_id", strategyId).maybeSingle()` | `:199-203` |
| Supabase error-as-value | `consecutiveErrors += 1`; escalate via `onError()` at `maxConsecutiveErrors` (3), else `scheduleNext()` | `:209-224` |
| Clean read | `consecutiveErrors = 0` — **unconditionally, before the row is even inspected** | `:226` |
| **Status coercion** | `const nextStatus = (statusRow?.computation_status ?? "pending")` — **a null row becomes `"pending"`** | `:228-229` |
| Terminal set | `nextStatus === "failed" \|\| isComputedAnalytics(nextStatus)` | `:235` |
| Terminal handling | `await onTerminal(...)`; `"repoll"` → `scheduleNext()`; `"done"` → `stopped = true` | `:236-247` |
| Non-terminal | `scheduleNext()` — **no counter, no cap, no clock** | `:249` |
| Thrown read | same consecutive-error escalation | `:250-264` |
| Scheduling | `ladder[Math.min(tick, ladder.length - 1)]`, ladder `[3000,3000,5000,5000,10000]`, **holds at 10 s forever** | `:184-189`, `SyncPreviewStep.tsx:120` |
| Effect deps | `[enabled, strategyId, schedule, isLadder, maxConsecutiveErrors, maxAttempts, missingRowGracePolls]` — all stable; callbacks are in refs (`:97-104`) explicitly so the effect does NOT re-run per render | `:275-283` |
| Cleanup | `stopped = true; clearTimeout(timerId)` — correct | `:271-274` |

`MAX_CONSECUTIVE_POLL_ERRORS = 3` (`SyncPreviewStep.tsx:188`). `POLL_BACKOFF_MS` is a module constant
so its identity is stable in the deps array (`:106-108` comments this deliberately).

**Verdict on the loop mechanics: the docblock is accurate.** There is no time-based abort and none is
claimed. The loop's three exits are (i) terminal status, (ii) 3 consecutive *errors*, (iii) effect
teardown. A clean `pending` read hits none of them and additionally *resets* (ii) at `:226`.

### Step 2 — Terminal-status set: reader vs producer (the prompt's top hypothesis, CLOSED)

| Set | Members | Source |
|-----|---------|--------|
| DB CHECK (producible) | `pending`, `computing`, `complete`, `complete_with_warnings`, `failed` | `supabase/migrations/20260602120000_strategy_analytics_computation_status_add_complete_with_warnings.sql` |
| TS closed set | identical 5 | `src/lib/closed-sets.ts:696-704`, pinned to the CHECK by `check-zod-db-check-parity.test.ts` |
| Reader treats as terminal | `failed`, `complete`, `complete_with_warnings` | `useStrategySyncPoller.ts:235` + `closed-sets.ts:715-719` |
| Reader treats as non-terminal | `pending`, `computing` | correct by construction |

`isComputedAnalytics()` explicitly admits `complete_with_warnings`, with a comment naming the exact
failure this prevents ("or a warned strategy dead-ends (onboarding poll hangs…)"). The three PROD MT5
strategies carrying `complete_with_warnings` would therefore have been detected as terminal.

⛔ **`complete_with_warnings` is NOT the cause.** There is no status the writers produce that the
reader fails to recognise as terminal. [VERIFIED: cross-read of the DB CHECK migration, `closed-sets.ts`, and `useStrategySyncPoller.ts` this session]

### Step 3 — Who can write `pending`, and who can leave the row absent

The deployed bridge body is **not** migration 038. `sync_strategy_analytics_status` has been
`CREATE OR REPLACE`d repeatedly; the latest definition is
`supabase/migrations/20260710150000_sync_status_supersede_failed_per_kind.sql` (later migrations only
*call* it — verified by grepping all 16 files that mention it). Its branches:

| Branch | Condition | Writes |
|--------|-----------|--------|
| (d) | **zero `compute_jobs` rows with this `strategy_id`** | **nothing — `RETURN`** (`:88-95`) |
| (a) | any row in `pending`/`running`/`done_pending_children`/`failed_retry` | `computing` (preserving `complete_with_warnings` / `computation_warned`) (`:110-127`) |
| (b) | all terminal, any non-superseded `failed_final` | `failed` + `last_error` (`:145-180`) |
| (c) | all rows `done` | `complete` (or preserves the warned sub-state) (`:186+`) |

⭐ **The bridge never writes `pending`.** So an observed `pending` is either (i) the migration-001
`DEFAULT 'pending'` on a row created by some *other* INSERT and never subsequently touched by a
bridge call, or (ii) the `set_wizard_composite_members` RT-1 reset
(`20260712120000_wizard_composite_members_invalidate_analytics.sql`, composite drafts only), or (iii)
not a real value at all but the client's `?? "pending"` coercion of an absent row.

And the bridge is only *invoked* from the `PERFORM` tail of `mark_compute_job_done` /
`mark_compute_job_failed` — i.e. **after a job hop flips terminal**. Before the first hop, nothing
calls it, so the row is whatever the `DEFAULT` left it, or does not exist.

The pg_cron reaper `reap_strategy_analytics_stuck_computing` (`20260802120000_*.sql`) terminalizes
**only** rows at `computation_status = 'computing'` **and** with no active `compute_jobs` row. It
therefore **cannot rescue a `pending` row, and cannot rescue a `computing` row whose parent job is
parked at `done_pending_children`.**

Confirming this failure mode is *already named in the codebase*: `job_worker.py:2565-2570` —

> "P72 — fail-loud analytics stamp … A terminal-FAIL must leave the wizard's SyncPreviewStep poller a
> TERMINAL 'failed' gate instead of an **infinitely-pending 'complete'**. Strategy-mode only:
> **key-mode has no per-key `strategy_analytics` row**."

[VERIFIED: read of `20260710150000_sync_status_supersede_failed_per_kind.sql`, `20260802120000_strategy_analytics_stuck_computing_reaper.sql`, `analytics-service/services/job_worker.py:2535-2575` this session]

### Step 4 — The job chain for the founder's run

`JOB_CHAIN_FOLLOW_ON` (`job_worker.py:524-526`):

```
process_key_long → (derive_broker_dailies | sync_trades)
sync_trades      → derive_broker_dailies
derive_broker_dailies → compute_analytics_from_csv
```

`/api/keys/sync` delegates to `postProcessKey` → `routers/process_key.py`, which for a long-fetch
flow enqueues `process_key_long` **with `p_strategy_id`** (`process_key.py:1613-1626`). So the wizard
path *does* create `compute_jobs` rows bearing the strategy id — bridge branch (d) does not apply to
a healthy first run.

Two holes in that chain, both read this session:

- **H-a — the tail enqueue is best-effort and swallowed.** `services/ingestion/long_fetch.py:600-628`
  wraps the child enqueue in `try/except Exception` that only `log.error`s, and then returns
  `DispatchOutcome.DONE` regardless. Its own comment states the handler "does NOT write
  `strategy_analytics` — which is exactly what the wizard's SyncPreviewStep polls". If the tail never
  lands, the parent's declared children never arrive.
- **H-b — the idempotent duplicate arm can return 200 with `queued: False`.**
  `_resume_duplicate_job` (`process_key.py:650-720`) re-enqueues **only** when the verification row is
  in `_RESUMABLE_VERIFICATION_STATUSES = {"draft"}`; otherwise it returns `(False, "not_applicable")`
  and `_wizard_duplicate_reply` still answers **HTTP 200, `ok: True`**. The wizard's kickoff
  (`SyncPreviewStep.tsx:775-782`) checks only `res.ok` and `kickoff?.composite`, then unconditionally
  `setPhase("waiting_for_complete")`. **It never inspects `queued`.** A 200-with-nothing-enqueued puts
  the wizard into an unbounded poll against a strategy for which no new work exists.

### Step 5 — Ranked mechanisms

**M1 — (LEADING) The wizard has no bounded response to a non-terminal read, and its one backstop is `isComposite`-gated.**
*Evidence, all direct:* the loop's non-terminal branch is an unconditional `scheduleNext()`
(`useStrategySyncPoller.ts:249`); the SF-1 backstop state `stallBackstop` *is* computed for any
`waiting_for_complete` phase (`SyncPreviewStep.tsx:830-838`) but the only thing that renders it is
`showInterruptedBanner = isComposite && (syncProgress?.stalled === true || stallBackstop)`
(`:2290-2291`). For a single-key strategy `isComposite` is `false` (initialised false at `:504` for
"SC-4 neutrality", set true only from the kickoff response's `composite` field or the persisted
`data_quality_flags.composite` marker). Therefore the founder's single-key MT5 run had **zero exit
affordances**: no amber banner, no Retry button, no envelope — only the red prose at
`RETRY_THRESHOLD_MS` (`:2379-2384`) which offers no action. The poll continues at 10 s forever.
*Why it is the leading mechanism:* it is the only one that is true **regardless** of which upstream
condition left the row at `pending`/absent, and it alone explains "the loop should have terminated
and did not" — it was never built to terminate on a non-terminal status, and the affordance that
would have surfaced the stall was invisible to this user class. Every other mechanism below is a
*supplier* of the `pending` state; M1 is why the `pending` state was terminal for the user.

**M2 — (STRONG, and the likely supplier) `.maybeSingle()` null coerced to `"pending"`.**
`useStrategySyncPoller.ts:228-229` maps `{data: null, error: null}` — the PostgREST answer for
*genuinely zero rows* — onto the same value as a real `pending` row. Two distinct real-world causes
land here and are indistinguishable to the reader:
  (i) **No `strategy_analytics` row exists.** The row is created lazily: by the bridge's
      `INSERT … ON CONFLICT`, or by a runner/route write. Before the first bridge call, and forever
      under branch (d), there is no row.
  (ii) **RLS returns zero rows.** `analytics_read` is `published OR owned`
      (`20260405061912_rls_policies.sql:36-42`). With `auth.uid()` NULL — a fully lost browser
      session, not merely an expired JWT (an expired JWT yields a PostgREST *error*, which would
      escalate at 3) — the policy matches nothing and PostgREST answers 200 `[]`, no error. This is
      the exact "SECDEF in {public} policy → anon → `[]` zero rows, clean console" shape this project
      has already been bitten by.
This is the file's own stated discipline being violated in the one place it was not applied: the
sibling read 500 lines away (`SyncPreviewStep.tsx:596-618`) carries a 25-line comment titled
"**`error` IS BOUND, AND A READ FAILURE IS NOT THE SAME FACT AS AN ABSENT ROW**". The poller binds
`error`, but then collapses *absent row* and *pending row* into one value anyway.

**M3 — (PLAUSIBLE, requires the loose reading of the founder's report) Parent parked at `done_pending_children`.**
`process_key_long` declares children; if `long_fetch.py:610-628`'s best-effort enqueue fails (H-a), the
parent can sit non-terminal indefinitely → bridge branch (a) → `computing` → the screen would read
**"Computing analytics..."**, not "Fetching trades…". The reaper cannot help (it requires
`computing` *and* no active job row; the parked parent *is* an active row). This is a genuine,
structurally-unbounded hang of the same class, and it should be tested — but under the strict reading
of the founder's quote it is **not** what he saw.

**M4 — (POSSIBLE supplier) 200-but-nothing-queued.** H-b above. The wizard enters
`waiting_for_complete` on a reply that says `queued: false`. Combined with branch (d) (a strategy with
no `compute_jobs` rows at all), the row stays at the `DEFAULT 'pending'` forever. Testable purely at
the TS layer: the kickoff arm ignores `queued`.

**M5 — (RULED OUT) Unrecognised terminal status.** See Step 2.

**M6 — (RULED OUT) React effect-lifecycle fault.** Checked all four sub-hypotheses from the brief:
stale closure — no (callbacks live in refs written by a commit-phase effect, `:97-104`, with the
ordering rationale documented); wrong deps — no (all seven deps are stable primitives/module
constants, `:275-283`); counters reset by re-subscription — no (that is precisely what the ref
indirection prevents, and the comment says so); uncleared `setTimeout` / two concurrent loops after
remount — no (`stopped` + `clearTimeout` in cleanup at `:271-274`, and every async continuation
re-checks `stopped` at `:196`, `:205`, `:239`, `:253`). The one *real* lifecycle subtlety —
`heavyFetchErrorsRef` surviving the 1 s elapsed-timer re-renders — is deliberate and documented
(`SyncPreviewStep.tsx:840-856`).

**M7 — (RULED OUT) Wrong table/row.** The poll reads `strategy_analytics` keyed by the same
`strategyId` the kickoff POSTs and the same id the bridge is called with. The *reason* it can read
nothing is M2, not a key mismatch.

### Step 6 — The evidence that would settle it (read-only; I could not obtain it)

I have no Supabase MCP access in this session. Two read-only queries against PROD
(`khslejtfbuezsmvmtsdn`) discriminate M2(i) / M2(ii) / M3 / M4 conclusively. Run them for the three
MT5 strategies:

```sql
-- Q1: what the wizard's poll would have read, and whether a row exists at all
SELECT s.id, s.name, s.status, s.source, s.created_at,
       sa.strategy_id IS NOT NULL          AS analytics_row_exists,
       sa.computation_status, sa.computed_at, sa.computing_started_at,
       sa.computation_error, sa.series_completeness,
       (SELECT count(*) FROM csv_daily_returns c WHERE c.strategy_id = s.id) AS series_rows
  FROM strategies s
  LEFT JOIN strategy_analytics sa ON sa.strategy_id = s.id
 WHERE s.id IN (<the three MT5 strategy ids>);

-- Q2: the job aggregate the bridge derives from, in creation order
SELECT strategy_id, kind, status, created_at, updated_at, claimed_at,
       attempts, max_attempts, left(last_error, 200) AS last_error
  FROM compute_jobs
 WHERE strategy_id IN (<the three MT5 strategy ids>)
 ORDER BY strategy_id, created_at;
```

Discriminator table:

| Q1/Q2 result | Confirms |
|---|---|
| Q2 returns **zero rows** for the strategy | branch (d) → M4 (nothing was ever enqueued) |
| Q2 has a row at `done_pending_children` with no child of the declared kind | M3 (and H-a: check Railway logs for `process_key_long.enqueue_tail_failed`) |
| Q1 `analytics_row_exists = false` while Q2 shows all-`done` | the bridge never ran → M2(i) + a bridge-invocation gap |
| Q1 `computation_status = 'complete_with_warnings'` with `computed_at ≈ 11:39:35` and Q2 all-`done` | the DB was terminal and the **client** was reading nothing → M2(ii), the session/RLS arm. Corroborate with the browser console: `[useStrategySyncPoller] poll status error` **absent** (a clean-null read logs nothing) |

Railway log greps that corroborate without DB access: `process_key_long.enqueued_tail`,
`process_key_long.enqueue_tail_failed`, `process_key.queued`, and any
`derive_broker_dailies: series heal-delete failed`.

### Step 7 — Instance (b): the stale refusal, and the in-flight signal

**Where the refusal is computed.** `SyncPreviewStep.tsx:1420-1450` calls `checkStrategyGate(...)` on
the single-key arm with `csvRowCount` (a live `head:true` count of `csv_daily_returns`) and
`seriesCompleteness` read from the *possibly stale* analytics row. `strategyGate.ts:291-334` refuses
with `INSUFFICIENT_CSV_HISTORY` when `csvRowCount < STRATEGY_GATE_MIN_CSV_ROWS`, or with
`SERIES_PROVENANCE_UNVERIFIED` when nobody stamped a completeness verdict. Both `return "done"` —
terminal, red `ErrorEnvelope`, loop stopped.

**Why that is stale.** `run_derive_broker_dailies_job` deletes and re-upserts the series on the
strategy-mode path (`job_worker.py:2539-2560`, "series heal-delete"), and the failure arm
*deliberately omits* `series_completeness` so a prior verdict survives (noted at
`SyncPreviewStep.tsx:1108-1116`). A poll landing inside that window sees a terminal `complete` status,
zero series rows, and a null/stale verdict — and refuses.

**The composite arm already guards this exact window and the single-key arm does not.**
`SyncPreviewStep.tsx:1092-1096`:

> "R2-5 (stale-complete race): the stitch_composite worker does a wholesale delete→re-upsert of
> `csv_daily_returns`. A poll landing inside that window can read a 'complete' status with 0 series
> rows … Treat an empty series as NOT-yet-terminal … `return "repoll"`."

There is no counterpart in the single-key arm. **This is the whole of instance (b): one class, one
arm.** It also shares M1's root — the wizard has no notion of "the answer I am holding may not be the
current one".

**Does a "recomputation is in flight" signal exist today? YES — and no migration is needed.**
This is the load-bearing finding the brief asked for, and the answer is the *good* one:

| Signal | Where | Owner-readable today? | Usable for the UI-SPEC amber state? |
|---|---|---|---|
| `compute_jobs.status ∈ {pending, running, done_pending_children, failed_retry}` | `compute_jobs` — **RLS deny-all + REVOKE FROM `authenticated`** | Not directly | Not directly |
| `get_user_compute_jobs` | SECURITY DEFINER RPC, `auth.uid()`-scoped, `last_error` redacted | ✅ yes | ✅ yes — this is the sanctioned path |
| `GET /api/strategies/[id]/sync-progress` → `{ jobStatus, stalled, memberProgress }` | projects the RPC field-by-field; never touches the analytics table | ✅ yes | ⚠️ **filtered to `kind === "stitch_composite"` at `sync-progress/route.ts:185`** — a single-key strategy always gets the IDLE body `{jobStatus: null, stalled: false, memberProgress: []}` |
| `strategy_analytics.computing_started_at` | already on the row the wizard polls | ✅ yes | partial — set only on the `computing` transition (JOB-01 stamp), NULL on `pending` |
| `computed_at` | already on the polled row | ✅ yes | supports "how stale is this verdict" but is not itself an in-flight flag |

⭐ **Conclusion for the planner:** the datum exists, is owner-scoped, is already redaction-audited,
and is already consumed by this very component — it is merely *projected away* for non-composite
strategies at one line of one route, and *gated away* at one line of the render
(`SyncPreviewStep.tsx:2290`). The UI-SPEC's amber "Recomputing this strategy's analytics" state has
something real to key off. **STALE-01 requires no schema change.** (Contrast WIZCONT-02, which does.)
Note the route's own docblock explicitly protects the RT-1 semantics the amber state depends on:
"this route NEVER reads the analytics table, so an RT-1 pending-after-complete analytics row (which
is re-stitching, not a stall) cannot influence the flag."

⚠️ Widening the route's `kind` filter is a **contract change to a shipped route** — `stalled` is
derived from a stitch-specific heartbeat (`metadata.member_progress_at ?? claimed_at`,
`STALL_THRESHOLD_MS` 12 min) and `memberProgress` is composite-shaped. Plan it as an additive
widening whose composite behaviour is byte-identical, pinned by the existing route test.

### Step 8 — Failing tests (the phase gate)

The gate is a failing repro test, not a written trace. Three, in priority order. All are
component/hook-level with fake timers — no PROD dependency. Pattern donors already in-repo:
`SyncPreviewStep.poll-disjointness.runtime.test.tsx` and `SyncPreviewStep.readfailure.runtime.test.tsx`
(both already mock the Supabase client and drive the poll loop).

**T1 — pins M1 (the unbounded non-terminal state). FAILS AT HEAD.**
- File: `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale.runtime.test.tsx` (new)
- Seam: mock `wizardFetch` so the kickoff resolves `{ok: true}` with body `{composite: false}`; mock
  `@/lib/supabase/client` so every `strategy_analytics` select resolves
  `{ data: { computation_status: "pending", computation_error: null }, error: null }`.
- Drive: `vi.advanceTimersByTimeAsync(RETRY_THRESHOLD_MS + 60_000)`.
- Assert: the step no longer renders `"Fetching trades..."` — it has surfaced an honest state (the
  `wizard-sync-interrupted` banner or an `ErrorEnvelope`). **At HEAD it still renders "Fetching
  trades..." and the assertion fails.**
- Companion assertion pinning the *specific* mechanism, not the symptom: with `isComposite === false`
  and `stallBackstop` true, `screen.queryByTestId("wizard-sync-interrupted")` is non-null. This is the
  `SyncPreviewStep.tsx:2291` `isComposite &&` gate, and it fails at HEAD.

**T2 — pins M2 (the null→`pending` coercion). FAILS AT HEAD.**
- File: same, second `describe`.
- Seam: identical, except the select resolves `{ data: null, error: null }` on every poll — the
  PostgREST zero-rows answer (absent row *or* RLS-filtered).
- Assert: the step distinguishes "no row" from "pending" — it must not sit on the spinner
  indefinitely, and (Rule 12) the absent-row case must be observable rather than silent.
- Sharper, hook-level variant (`src/hooks/useStrategySyncPoller.test.ts`, new — no test file exists
  for this hook today, which is itself worth noting): call the hook in ladder mode with a read that
  always answers `{data: null, error: null}`; assert `onStatus` is **not** called with the fabricated
  `"pending"`. At HEAD it is, from `:228-229`.

**T3 — pins instance (b) / the single-key R2-5 gap. FAILS AT HEAD.**
- File: `SyncPreviewStep.stale-refusal.runtime.test.tsx` (new)
- Seam: single-key arm (`composite: false`); status read resolves `complete_with_warnings`; the heavy
  `Promise.all` resolves with `trades` count `0` and `csv_daily_returns` count `0` (the heal-delete
  window), `series_completeness` null.
- Assert: **no** `gate_failed` render, no `ErrorEnvelope`, no `wizard_error` funnel event — the arm
  repolls, exactly as the composite arm does at `:1094-1096`. At HEAD the gate returns
  `SERIES_PROVENANCE_UNVERIFIED` and the component renders the red envelope. Fails.
- Symmetry assertion (the class, not the instance): drive the **composite** arm through the identical
  empty-series state and assert it repolls. That arm passes today; the pair makes the divergence the
  test's subject.

⛔ Per the CONTEXT.md gate, none of these tests may be written *with* a fix. They land first, red, in
plan 154-01. No new timeout constant, no new threshold number, and no fix mechanism is proposed by
this research.

### Step 9 — What is still missing

1. **Which mechanism actually fired on 2026-08-04.** Q1/Q2 in Step 6 settle it. Until then M1 is
   established as the *reason the user had no exit* (pure code, no DB needed), and M2/M3/M4 remain
   ranked candidates for *what put the row in that state*.
2. **Strict vs loose reading of the founder's quote.** Q1's `computation_status` value settles it.
3. **Whether (a) and (b) share one cause.** CONTEXT.md asks that this be tested rather than assumed.
   The evidence says: they share a **root** — the wizard treats a possibly-not-current reading as
   current, in both directions (absent/pending read as "in flight forever"; stale terminal read as
   "the final answer") — but they are **two distinct code sites** (`useStrategySyncPoller.ts:228` +
   `SyncPreviewStep.tsx:2291` for (a); the missing single-key R2-5 guard at ~`:1420` for (b)). A
   single-site fix will not close both. State this explicitly rather than letting a plan assume one
   patch discharges both.
</stale_01_investigation>

---

## WIZCONT-01 — Resume entry path (cause established; the HOW)

### The two defect sites, confirmed at HEAD

| Site | Line | State at HEAD |
|------|------|---------------|
| `src/app/(dashboard)/strategies/new/page.tsx` | whole file, 32 lines | ✅ **pure `redirect()`**, forwards `?source=csv`. **The ROADMAP/REQUIREMENTS "branch chooser" claim is WRONG.** Confirm the correction in REQUIREMENTS.md. |
| `src/app/(dashboard)/strategies/new/wizard/page.tsx:79-89` | the canonical query | ✅ already correct — `.from("strategies")` `:80`, 15 columns, `.eq(user_id).eq(source,'wizard').eq(status,'draft').order(created_at desc).limit(1).maybeSingle()` `:89` |
| `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx:198-201` | step initializer | ⛔ `if (source === "csv") return "csv_upload";` at **`:199`** runs **before** `if (!initialDraft)` at `:200` — a CSV draft never resumes on either path |
| `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx:146` | `initialDraft={null}` | ⛔ the Phase-110 deferral; comment at `:137-140` records it |

The resume machinery downstream is intact: `showResumeBanner` state, the banner markup at
`WizardClient.tsx:899-925` with both CTAs and testids, `handleResume`, and the TRAP-4-safe
`handleStartFresh` → `setConfirmDelete(true)`. `:803` (`if (!initialDraft) return;`) is the
post-mount hydration effect that decides whether to raise the banner.

### The mechanism decision: three options compared

The overlay is a **client-only portal** — it `createPortal`s into `document.body` and all four
consumers reach it from client state. It therefore cannot receive a server-component read.

| Option | How | Pros | Cons |
|--------|-----|------|------|
| **A. Route handler** `GET /api/strategies/wizard-draft` | New route, `withAuth`, calls a shared query helper; overlay `fetch`es on open, stores in state | Single-sourced query trivially (one helper imported by both the route and `wizard/page.tsx`); matches every other read on this surface; RLS enforced by the user-scoped server client exactly as today; testable with the existing route-test pattern | One new route + limiter bucket; overlay must handle the pending/error states |
| B. Server action | `'use server'` fn called from an effect | No new route file | POST-only, non-cacheable, harder to test than a route handler, and no existing precedent for a *read* server action on this surface — a convention fork (Rule 11) |
| C. Server-component wrapper | Render the draft read on the server and thread it down | No client fetch | ⛔ All four consumers are client components reached from client state; the draft would have to be fetched on every dashboard page render and threaded through `AllocationsTabs` → `StrategyBrowseDrawer` → … whether or not the overlay ever opens. Largest ripple, worst staleness |

**Recommendation: Option A**, on CONTEXT.md's own stated criterion (the query shape stays
single-sourced). Extract the `wizard/page.tsx:79-89` query verbatim into one exported helper (e.g.
`src/lib/wizard/draft-query.ts`) taking a Supabase client + user id, and call it from **both**
`wizard/page.tsx` and the new route handler. Two callers, one shape. `[ASSUMED]` on the exact helper
path/name — Claude's Discretion per CONTEXT.md.

⚠️ **AGENTS.md gate:** before finalising, read `node_modules/next/dist/docs/` for this Next version's
route-handler conventions (caching defaults, `dynamic`, and whether `GET` handlers need explicit
`no-store`). Do not assert Next API shapes from training data. See Assumptions Log A1.

### Pitfall W-1 — the mount-ordering trap (⭐ load-bearing; this is where a naive fix breaks)

`WizardClient`'s `useState` initializers read `initialDraft` **once, at mount** — `step` (`:198`),
`strategyId` (`:207`), `apiKeyId` (`:210`), `metadataDraft` (`:232`). If the overlay mounts
`WizardClient` with `initialDraft={null}` and *then* sets a fetched draft into state, **none of those
initializers re-run** and the resume silently does not happen. The prop would be threaded and the bug
would still be live — a fix that looks correct in review and fails in the browser.

Two conformant resolutions (planner picks one):
1. **Defer the mount.** The overlay does not render `WizardClient` until the draft read settles
   (`undefined` = loading, `null` = none, row = draft). Mounts once, with the real value.
2. **Key the remount.** Extend the existing `key={source}` to `key={`${source}:${draft?.id ?? "new"}`}`
   so a late-arriving draft forces a fresh mount. ⚠️ Verify this cannot double-remount and discard a
   half-typed key — CONTEXT.md's stated reason for keeping resume explicit.

Both are compatible with the documented hydration discipline (`WizardClient.tsx:180-196`): the
overlay is client-only, so `initialDraft` is *not* an SSR-vs-CSR divergence risk there — but the
**same component also serves the server-rendered `/strategies/new/wizard` page**, where every
`useState` initializer must remain SSR-deterministic. ⛔ **Do not "fix" this by moving the draft read
inside `WizardClient`** — that would put a browser-only read into an initializer on the SSR path and
re-open React #418, the failure that unmounted the CSV form.

### Pitfall W-2 — the CSV short-circuit is a two-line reorder with a real trap

Swapping `:199` and `:200` alone changes CSV behaviour for users who have **no** draft (unchanged —
still `csv_upload`) and for users **with an API draft who opened the CSV branch** (now would resume
into `sync_preview` on the CSV branch — wrong). The correct condition must consider the draft's own
source. The draft query does not currently select a source discriminator beyond `source='wizard'`;
`api_key_id` is selected and is the available discriminator (`api_key_id === null` ⇒ CSV/composite
draft). ⚠️ Note `api_key_id === null` is **also** true for a member-bearing composite
(`keys/sync/route.ts` composite branch: "`strategies.api_key_id === null` AND a `strategy_keys` count
> 0"), so `api_key_id` alone is ambiguous. Resolve this at planning; do not assume.

### Ripple

`ContributionWizardOverlay`'s props change ⇒ four consumers + their tests:
`allocations/AllocationsTabs.tsx`, `allocations/components/StrategyBrowseDrawer.tsx`,
`my-strategies/MyStrategiesSection.tsx`, `my-strategies/MyStrategiesEmptyState.tsx`, plus
`ContributionWizardOverlay.test.tsx`, `AllocationsTabs.addalloc.test.tsx`,
`AllocationsTabs.scenario-composer.test.tsx`, `StrategyBrowseDrawer.test.tsx`,
`ScenarioComposer.test.tsx`. If the overlay owns the fetch internally (no new required prop), the
ripple collapses to mock setup only — prefer that shape.

### RLS implications of the new read

None new. The route handler uses the user-scoped server client (`@/lib/supabase/server`), so
`strategies` RLS applies unchanged, and the predicate is already `user_id = <session user>`. The
route must **not** use `createAdminClient()`. No new policy, no migration.

---

## WIZCONT-02 — Token-less credential dedup (LOW priority)

### Which venues return a stable non-secret account id at validation — honest answer

| Venue | Non-secret account id available at validation? | Evidence |
|-------|-----------------------------------------------|----------|
| **mt5** | ✅ **Yes, and it is venue-*confirmed*.** `services/mt5_probe.py:118-129` (`assert_expected_login`, "STRICT equality on the parsed login; a missing `login` field FAILS LOUD") and `:231`/`:267`/`:270` bracket the probe with `client.account_info()["login"]` assertions | [VERIFIED: read this session] |
| binance / okx / bybit / deribit / sfox | ⚠️ **Not established.** I did not find a `ValidationResult` account-identity field in `analytics-service/services/adapter.py` in this session (the grep for the dataclass returned nothing at the path searched) | `[ASSUMED]` — see Assumptions Log A2 |

**The planner must not assume a ccxt venue has one.** The remaining work is one targeted read of the
adapter `ValidationResult` contract plus the per-venue `validate()` implementations. Whatever it
finds, CONTEXT.md's decision stands: venues without a stable id are left unchanged and the residual
is written down.

### Where the MT5 login lives today — and why a new column is unavoidable

`src/app/api/keys/validate-and-encrypt/route.ts:66` states the MT5 slot mapping verbatim:
**"login → api_key, investor password → api_secret, broker server → passphrase"**. So the MT5 login
is written into `api_key_encrypted` — **encrypted, per-row `dek_encrypted` + `nonce`**. It is
therefore:
- present in the `create-with-key` request body in plaintext (as `api_key`) — the wizard already
  carries it to the server; and
- **not queryable** once stored, which is exactly why CONTEXT.md forbids a UNIQUE on ciphertext.

⇒ **A migration is required**: a new non-secret column on `api_keys` (name/type is Claude's
Discretion) plus a partial `UNIQUE (user_id, exchange, <col>) WHERE <col> IS NOT NULL`, mirroring the
`strategies_user_wizard_session_source_uniq` precedent.

`create-with-key` already normalises MT5's shape (`route.ts:103-163`, `isMt5`, the short-login
carve-out), so the value is in scope at the right place.

### ⛔ The Phase-156 collision surface — flag this explicitly

The `api_keys` INSERT is **not** in the route. `create-with-key/route.ts:409-421` calls
`supabase.rpc("create_wizard_strategy", { p_user_id, p_exchange, p_label, p_api_key_encrypted,
p_api_secret_encrypted, p_passphrase_encrypted, p_dek_encrypted, p_nonce, p_kek_version,
p_placeholder_name, p_wizard_session_id })` — a SECURITY DEFINER RPC that writes the draft strategy
*and* the `api_keys` row, and whose `23505` is already mapped to `DRAFT_ALREADY_EXISTS` (`:428-440`).

Consequences the planner must carry:
1. Persisting a new identity value means **adding a parameter to `create_wizard_strategy`**, i.e. a
   `CREATE OR REPLACE FUNCTION` migration. ⭐ **Re-base on the LATEST deployed definition** — grep
   every migration mentioning `create_wizard_strategy` and build from the last `CREATE OR REPLACE`,
   never from the original. This project has been bitten by exactly this.
2. The RPC has other callers. Prefer an **optional/defaulted** parameter so existing call sites are
   byte-neutral.
3. **Phase 156 moves this same INSERT behind a service-role writer.** Adding a *parameter* to the
   existing RPC is additive and 156 can relocate the writer without unpicking it. ⛔ Do **not**
   restructure the RPC, do **not** move the INSERT out of it, and do **not** introduce a second
   writer path here.
4. The new server-side dedup check belongs beside the existing fence at
   `create-with-key/route.ts:263-267` (`.eq("wizard_session_id", wizard_session_id)`), per CONTEXT.md
   — one fence, two keys.
5. The 23505 handling must distinguish the **new** constraint from
   `strategies_user_wizard_session_source_uniq`; both surface as `23505` and today the single arm
   answers `DRAFT_ALREADY_EXISTS` for any of them. Branch on `error.details` / constraint name, or
   the token-less path will report the wrong fact.

### Migration ops (⚠️ binding)

Merging `supabase/migrations/**` to `main` **AUTO-APPLIES to PROD** (`khslejtfbuezsmvmtsdn`).
Apply to the TEST project (`qmnijlgmdhviwzwfyzlc`) via the Supabase MCP `apply_migration` **before**
merge, and run the migration reviewer. ⛔ **Never `supabase db push`.**
⚠️ Adding a partial UNIQUE to a table with existing PROD rows can fail on duplicates. Count first:
`SELECT user_id, exchange, <col>, count(*) FROM api_keys WHERE <col> IS NOT NULL GROUP BY 1,2,3 HAVING count(*) > 1;`
Since the column is new and backfilled to NULL, this is safe by construction on day one — but say so
in the migration header rather than relying on it silently. Use `CREATE UNIQUE INDEX CONCURRENTLY`
outside a transaction only if the table is large; otherwise the in-transaction form matches the
existing precedent.

---

## Standard Stack

**No new libraries.** This is a bugfix phase on shipped surfaces. The only dependency question the
phase raises is whether any *existing* dependency must be touched, and the answer is no.

### Core (already installed, unchanged)

| Library | Purpose in this phase | Why standard here |
|---------|-----------------------|-------------------|
| `@supabase/supabase-js` (browser + server clients via `@/lib/supabase/{client,server}`) | the draft read, the analytics poll, the heavy terminal fetch | the project's sole DB access layer; RLS is the authorization boundary |
| `vitest` + `@testing-library/react` + `@vitest/coverage-v8` | T1/T2/T3 and the WIZCONT component tests | the repo standard; colocated `*.test.tsx` beside every component |
| `@playwright/test` | e2e coverage of the resume path | `e2e/` |
| `pytest` (+ VCR cassettes) | only if the fix reaches `analytics-service/` | ⚠️ must be run **from `analytics-service/`** or cassettes miss and live broker calls fire |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Polling `strategy_analytics` | Supabase Realtime subscription on the row | Would make "the backend moved on" push-based and eliminate the coercion class entirely — but it is a **new architecture** for this surface, a new RLS/realtime-publication surface, and far beyond a bugfix phase. ⛔ Out of scope; note only. |
| Widening `/api/strategies/[id]/sync-progress` | A new single-key-specific route | A second route projecting the same RPC is a second place to drift — the exact failure `_wizard_duplicate_reply` and `buildEnvelope` exist to prevent. Prefer widening. |

**Installation:** none.

---

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** Every dependency named above is
already in `package.json` / `analytics-service/requirements`. No `npm install`, `pip install`, or
`cargo add` step is contemplated by any requirement in scope. Should the planner discover a genuine
need for a new package, the Package Legitimacy Gate must be run before it enters a plan.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram — the STALE-01 data flow

```
  BROWSER                                   VERCEL (Next.js)              RAILWAY (analytics-service)        POSTGRES
  ───────                                   ────────────────              ──────────────────────────        ────────
  SyncPreviewStep
    │
    ├─(1) POST /api/keys/sync ─────────────► keys/sync/route.ts
    │                                          │ ownership check (RLS)
    │                                          ├─ composite? ──► enqueue stitch_composite ─────────────────► compute_jobs
    │                                          └─ postProcessKey ──────────► routers/process_key.py
    │                                                                          │
    │                                                                          ├─ duplicate & not 'draft'
    │                                                                          │    └─► 200 {queued:FALSE}   ◀── H-b
    │                                                                          └─ enqueue process_key_long
    │                                                                               (p_strategy_id) ────────► compute_jobs
    │◄──(2) 202/200 {composite}                                                                                  │
    │        ⚠ `queued` IGNORED                                                                                  │
    │        setPhase("waiting_for_complete")                                    worker claims ◄─────────────────┘
    │                                                                               │
    ├─(3) useStrategySyncPoller ─── SELECT computation_status ─────────────────────────────────────────────► strategy_analytics
    │        every 3→10s, forever                                                   │                            ▲
    │        ┌──────────────────────────────────────────┐                           │                            │
    │        │ statusRow?.computation_status ?? "pending"│ ◀── M2 coercion           ├─ process_key_long DONE     │
    │        └──────────────────────────────────────────┘                           │   └─ best-effort tail      │
    │          │                                                                    │      enqueue (swallowed)   │
    │          ├─ failed / complete / complete_with_warnings ──► onTerminal          │      ◀── H-a               │
    │          │      ├─ composite: series.length===0 → "repoll"  (R2-5 guard ✅)    │                            │
    │          │      └─ single-key: checkStrategyGate → REFUSE   (no guard ⛔ (b))  ├─ derive_broker_dailies     │
    │          │                                                                    │   ├─ series heal-DELETE ───┼─► csv_daily_returns
    │          └─ pending / null ──► scheduleNext()  ── unbounded ──┐                │   └─ re-upsert  ───────────┘   (the (b) window)
    │                                                              │                │
    │  exit affordances:                                           │                └─ mark_compute_job_done
    │    · 3 consecutive ERRORS → SYNC_FAILED envelope             │                     └─ PERFORM sync_strategy_analytics_status
    │    · stallBackstop → amber banner … but `isComposite &&`     │                          (d) zero rows → NO-OP  ◀── M4
    │      gate at :2291 ⇒ INVISIBLE to single-key  ◀── M1 ─────────┘                          (a) non-terminal → computing ◀── M3
    │                                                                                         (c) all done → complete
    │
    └─(4) /api/strategies/[id]/sync-progress  ── get_user_compute_jobs (SECDEF) ────────────────────────────► compute_jobs
             ⚠ client-gated `if (isComposite)` at :902
             ⚠ server-filtered `kind === "stitch_composite"` at route :185
             ⇒ the in-flight datum EXISTS and is owner-readable, but never reaches the single-key screen
```

Trace the primary failure from (1) → (2) ignoring `queued` → (3) reading `pending`/null → the
unbounded `scheduleNext()` with its only exit invisible to this user class.

### Pattern 1 — Absence is not a value (the class this phase closes)

**What:** A read that can answer "no row" must not coerce that into a domain value that means
something else.
**When:** every `.maybeSingle()` / `head:true` count in this codebase.
**The repo already states this rule, twice, in the very file that violates it:**

```ts
// Source: src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:596-618
// ⚠️ 140.4-12 / SEAMRIM-11 (C-3) — `error` IS BOUND, AND A READ FAILURE
// IS NOT THE SAME FACT AS AN ABSENT ROW.
const { data: existing, error: existingErr } = await supabase
  .from("strategy_analytics")
  .select("computation_status, computed_at")
  .eq("strategy_id", strategyId)
  .maybeSingle();
if (existingErr) { console.error(/* … */ scrubSeamError(existingErr)); }
```

```ts
// Source: src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:1401-1412
// COUNTS ARE PART OF THE CLASS. … a null count with NO error is as unrepresentable
// as an error — and `?? 0` on it is the same fabrication by another route.
if (tradeCount === null) { throw new Error(/* … */); }
```

The poller's `?? "pending"` (`useStrategySyncPoller.ts:228-229`) is the same fabrication, on the one
read nobody swept. Closing the **class** means auditing every `?? <domain-default>` on a nullable
read in this loop's blast radius — not just the one line.

### Pattern 2 — A guard added for one arm belongs to the class, not the arm

R2-5 (`SyncPreviewStep.tsx:1092-1096`) guards the composite arm's delete→re-upsert window. The
single-key arm has the identical window (`job_worker.py:2539-2560`) and no guard. **When plan 154-01
closes (b), sweep for the class**: any consumer that reads `strategy_analytics` + a derived table in
the same tick and treats the pair as coherent.

### Anti-Patterns to Avoid

- ⛔ **Adding a client-side timeout to the poll.** Forbidden by CONTEXT.md and the UI-SPEC ("no
  polling mechanism, no timeout, and no new threshold number"). It would also be a bandaid over a
  possibly-backend cause (Rule 6).
- ⛔ **Scoping any fix to `exchange === 'mt5'`.** CONTEXT.md: "A fix scoped to `exchange === 'mt5'`
  is the wrong fix for all three."
- ⛔ **Reading `compute_jobs` directly from the client.** RLS deny-all + REVOKE FROM `authenticated`.
  Go through `get_user_compute_jobs` / the projection route.
- ⛔ **A second draft-query shape.** CONTEXT.md's stated criterion.
- ⛔ **A UNIQUE on `api_key_encrypted`.** Per-row DEK + nonce ⇒ dedups nothing.
- ⛔ **Moving the draft read into `WizardClient`'s `useState` initializer.** React #418.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Is a recompute in flight?" | A client-side heuristic on `computed_at` age, or a new `strategy_analytics` column | `get_user_compute_jobs` → `/api/strategies/[id]/sync-progress` (widen the `kind` filter at `route.ts:185`) | The datum exists, is owner-scoped, is redaction-audited (T-95-07), and is already consumed by this component. A new column would be a second source of truth for a question `compute_jobs` already answers. |
| Terminal-success detection | `status === "complete"` | `isComputedAnalytics()` (`closed-sets.ts:715`) | Missing `complete_with_warnings` dead-ends warned strategies — the exact bug B3/B9 closed across 8 consumers. |
| Wizard error copy | An inline envelope string | `buildEnvelope()` + `wizardErrors.ts` | Grep-enforced; the UI-SPEC restates it. If 154-01's root cause demands a new `WizardErrorCode`, it lands with `KNOWN_FINALIZE_CODES` + copy-table pins in the **same commit**. |
| Draft discovery | A second query in the overlay | One shared helper called by `wizard/page.tsx` and the new route | CONTEXT.md's single-source criterion; two shapes is how the paths drift. |
| Credential identity | Hashing/normalising the secret client-side | The venue-confirmed account id captured server-side + a partial UNIQUE | A client-derived identity is attacker-controlled and unverifiable. |
| Status derivation from jobs | Re-deriving `computing/complete/failed` anywhere else | `sync_strategy_analytics_status` (latest body: `20260710150000_*.sql`) | It is atomic by design (Finding 2-B): two workers finishing near-simultaneously would race a read-then-write. |

**Key insight:** every capability this phase needs already exists somewhere in the codebase. The
defects are all of the form "the existing correct thing is not reachable from this arm/user class" —
missing input (WIZCONT-01), a gate on the wrong predicate (`isComposite &&`), a filter that is too
narrow (`kind === 'stitch_composite'`), a guard applied to one of two twins (R2-5). Plans should
*connect*, not *build*.

---

## Common Pitfalls

### Pitfall 1 — Fixing the poll loop when the loop is correct
**What goes wrong:** A plan reads the docblock, concludes terminal detection is broken, and adds a
status to the terminal set or a timeout to the loop.
**Why:** The docblock's claim is *true*, which reads like a contradiction of the observed behaviour.
**Avoid:** Start from the render condition (`:2315-2323`), not the loop. The screen text is a
constraint on `computationStatus`, and it excludes every terminal value.
**Warning sign:** any diff touching `useStrategySyncPoller.ts:235` or `isComputedAnalytics`.

### Pitfall 2 — Threading `initialDraft` into the overlay and calling it done
**What goes wrong:** `WizardClient`'s `useState` initializers already ran with `null`; a later prop
change does nothing. Review passes, browser fails.
**Avoid:** Defer the mount or key the remount (§W-1). **The component test must assert the resumed
step renders, not merely that the prop was passed.**
**Warning sign:** a test asserting `expect(WizardClient).toHaveBeenCalledWith({initialDraft: draft})`.

### Pitfall 3 — Reading a stale SQL function definition
**What goes wrong:** `sync_strategy_analytics_status` is defined in migration 038 and redefined at
least three times since; `create_wizard_strategy` likewise has history. Editing from the wrong base
silently reverts later fixes (F-3 supersession, SI-02 warned-marker preservation).
**Avoid:** grep **all** migrations for the function name, build from the **last** `CREATE OR REPLACE`,
and say so in the migration header. This project's convention.

### Pitfall 4 — e2e specs asserting global empty-state on the shared TEST DB
**What goes wrong:** A resume-path e2e that asserts "no draft exists" fails when a concurrent CI run
seeded one.
**Avoid:** assert the spec's **own** seeded invariant (this draft id resumes), never a global count.

### Pitfall 5 — Running `pytest` from the repo root
**What goes wrong:** VCR `cassette_library_dir` misses ⇒ **live broker calls** ⇒ bogus failures.
**Avoid:** always `cd analytics-service && pytest`. Also run `mypy --strict` before shipping any
Python change — the milestone gate runs pytest only, so mypy errors stay latent until PR CI.

### Pitfall 6 — Assuming the two STALE instances share one patch
**What goes wrong:** (a) and (b) share a root *idea* but live at different code sites. A plan that
fixes the coercion and declares (b) closed will ship a live red envelope.
**Avoid:** T1/T2 and T3 are separate red tests. Both must go green.

### Pitfall 7 — Coverage ratchet
**What goes wrong:** New branches in a 2448-line component drop function/branch coverage below the
74/72 thresholds and the blocking `frontend-coverage` job fails.
**Avoid:** every new branch ships with its test in the same commit.

---

## Runtime State Inventory

*This is a bugfix phase, not a rename/refactor/migration. Included anyway because WIZCONT-02 adds a
DB column and because a stale-state investigation is precisely about runtime state.*

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **PROD `strategy_analytics` rows for the three MT5 strategies may hold a stale `computation_status` / unstamped `series_completeness`.** The bridge re-derives lazily on the next job hop, so no data migration is implied — but the *current* values are the investigation's key evidence (Q1). `csv_daily_returns` rows for those strategies were subject to the heal-delete window. | Read-only for the investigation. **No data migration.** If WIZCONT-02's column lands, existing `api_keys` rows backfill to NULL (the partial UNIQUE excludes NULL), so no rewrite — code edit only for *new* rows. Record the residual: pre-existing keys are undeduplicable. |
| Live service config | None found. `/api/strategies/[id]/sync-progress`'s `kind` filter and the poll constants are in git, not in a service UI. Railway env (`MT5_ENABLED`, `MT5_GATEWAY_HOST`) is unchanged by this phase. | None |
| OS-registered state | None — verified: no Task Scheduler / pm2 / launchd surface is touched. The one scheduled artifact in scope is the **pg_cron reaper** (`reap_strategy_analytics_stuck_computing`, migration `20260802120000`), which is DB-resident and in git. ⚠️ Note for the fix: it terminalizes **only** `computing` rows with no active job — it cannot rescue `pending`, and cannot rescue a `computing` row whose parent is parked at `done_pending_children`. | None to change; document the reaper's blind spot in the fix plan's rationale. |
| Secrets / env vars | None. No secret name changes. | None |
| Build artifacts | None — no package rename, no `pyproject.toml` change. | None |

---

## Code Examples

### The coercion at the heart of STALE-01a
```ts
// Source: src/hooks/useStrategySyncPoller.ts:226-249 (read this session)
consecutiveErrors = 0;                              // ← reset BEFORE inspecting the row

const nextStatus = (statusRow?.computation_status ??
  "pending") as ComputationStatus;                  // ← absent row becomes a domain value
const nextError = statusRow?.computation_error ?? null;
onStatusRef.current(nextStatus, nextError);

if (nextStatus === "failed" || isComputedAnalytics(nextStatus)) {
  const result = onTerminalRef.current ? await onTerminalRef.current(nextStatus, nextError) : "done";
  if (stopped) return;
  if (result === "repoll") { scheduleNext(); return; }
  stopped = true;
  return;
}

scheduleNext();                                     // ← pending / null: unbounded
```

### The guard that exists on one arm only (instance b)
```ts
// Source: src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:1092-1096
// R2-5 (stale-complete race): the stitch_composite worker does a wholesale
// delete→re-upsert of csv_daily_returns. A poll landing inside that window can
// read a 'complete' status with 0 series rows … Treat an empty series as
// NOT-yet-terminal.
if (series.length === 0) {
  return "repoll";
}
// ⛔ The single-key arm (~:1420) has no counterpart; it calls checkStrategyGate
//    with csvRowCount === 0 and refuses.
```

### The exit affordance a single-key user cannot see
```tsx
// Source: src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:2290-2291
const showInterruptedBanner =
  isComposite && (syncProgress?.stalled === true || stallBackstop);
//  ^^^^^^^^^^^ the SF-1 backstop is computed for ANY waiting phase (:830-838)
//              but rendered only for composites.
```

### The in-flight datum, and the one line that hides it
```ts
// Source: src/app/api/strategies/[id]/sync-progress/route.ts:185
if (row?.kind !== "stitch_composite") continue;   // ← single-key ⇒ IDLE body, always
// …:225
const jobStatus = (latest.status ?? null) as StitchJobStatus | null;
```

### The canonical draft query to single-source (WIZCONT-01)
```ts
// Source: src/app/(dashboard)/strategies/new/wizard/page.tsx:79-89
const { data: draft } = await supabase
  .from("strategies")
  .select(
    "id, name, description, category_id, strategy_types, subtypes, markets, " +
    "supported_exchanges, leverage_range, aum, max_capacity, api_key_id, asset_class, created_at",
  )
  .eq("user_id", user.id)
  .eq("source", "wizard")
  .eq("status", "draft")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact on this phase |
|--------------|------------------|--------------|----------------------|
| `computation_status === 'complete'` exact match | `isComputedAnalytics()` admitting `complete_with_warnings` | migration `20260707120000` made the value persist; `20260602120000` widened the CHECK | Terminal detection is already correct — do not "fix" it |
| Bridge branch (b): any `failed_final` → `failed` | per-`(strategy, kind)` `created_at` supersession | `20260710150000` | ⭐ **Read this body, not migration 038**, before touching status derivation |
| `after()` fire-and-forget ingestion | durable `compute_jobs` queue + the unified `/process-key` backbone | Phase 19 / BACKBONE-10 (`keys/sync/route.ts` docblock) | The wizard's status is now *derived* from a job aggregate; "no jobs" is a reachable, silent state (branch d) |
| Duplicated poll machinery in `SyncProgress` + the wizard | one parametrized `useStrategySyncPoller` | UX-03 / #46 | ⚠️ A fix in the hook affects **both** surfaces. Prefer a fix at the wizard's own callbacks unless the class genuinely spans both — and if it does, say so and test both. |
| `/strategies/new` as a real page | a pure `redirect()` | Task 1.2 (+ QA 2026-05-21 ISSUE-013 for `?source=csv`) | The ROADMAP/REQUIREMENTS diagnosis is stale — **correct it** |

**Deprecated/outdated in the ledger (not the code):**
- REQUIREMENTS WIZCONT-01's "`/strategies/new` is a branch chooser with no draft awareness" —
  **false at HEAD.** Correcting it is in-scope phase work per CONTEXT.md.

---

## Validation Architecture

Repo testing facts: **vitest** for TS (jsdom default project, `setupFiles: src/test-setup.ts`,
sharded in CI, **coverage is a blocking gate** at lines 82 / statements 80 / functions 74 /
branches 72); **pytest** for `analytics-service/` (⚠️ **must run from `analytics-service/`** or VCR
cassettes miss and live broker calls fire; `--cov-fail-under=80`); **Playwright** in `e2e/`
(⚠️ specs must assert their **own seed invariant**, never global empty-state — shared TEST DB);
**SQL gates** in `supabase/tests/test_*.sql` (⚠️ `*_live.py` and `skipIf` vitest never run in CI).
Local vitest flakes → `--no-file-parallelism`. CI is Node 22, local is Node 25 — a CI-only vitest
failure is **not** a flake; reproduce with `PATH=/opt/homebrew/opt/node@22/bin`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework (TS) | vitest (jsdom + node projects) + @testing-library/react + @vitest/coverage-v8 |
| Config file | `vitest.config.ts` (`environment: "jsdom"`, `setupFiles: ["src/test-setup.ts"]`, two projects split by environment) |
| Quick run command | `npx vitest run <path> --no-file-parallelism` |
| Full suite command | `npm test` (CI: sharded with `--coverage`, merged by the `frontend-coverage` job) |
| Framework (Python) | pytest + VCR |
| Python quick run | `cd analytics-service && pytest tests/<file>.py -x` |
| e2e | `npx playwright test e2e/<spec>.spec.ts` |
| SQL gates | `supabase/tests/test_*.sql` |

### Phase Requirements → Test Map

| Req ID | Behavior (observable signal) | Sampling point | Test level | Automated command | File exists? |
|--------|------------------------------|----------------|------------|-------------------|-------------|
| STALE-01a | **T1:** with a poll that reads `pending` forever, the screen stops claiming "Fetching trades..." after the existing patience window and surfaces an honest state | after `RETRY_THRESHOLD_MS` of fake time | component (jsdom, fake timers) | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale.runtime.test.tsx"` | ❌ Wave 0 |
| STALE-01a | **T1b:** with `isComposite === false` and the SF-1 backstop fired, `wizard-sync-interrupted` renders (the `:2291` gate) | same tick | component | same file | ❌ Wave 0 |
| STALE-01a | **T2:** a `{data: null, error: null}` read is not reported as `pending`; the absent row is observable | first poll tick | unit (hook) | `npx vitest run src/hooks/useStrategySyncPoller.test.ts` | ❌ Wave 0 — **no test file exists for this hook today** |
| STALE-01a | **T2b:** the kickoff arm does not enter `waiting_for_complete` on a 200 whose body says `queued: false` (M4) | kickoff response handling | component | `SyncPreviewStep.stale.runtime.test.tsx` | ❌ Wave 0 |
| STALE-01b | **T3:** single-key arm, terminal status + zero `csv_daily_returns` rows ⇒ **no** `gate_failed`, no `ErrorEnvelope`, no `wizard_error` event — it repolls | terminal-status tick inside the heal-delete window | component | `npx vitest run "…/SyncPreviewStep.stale-refusal.runtime.test.tsx"` | ❌ Wave 0 |
| STALE-01b | **T3b (symmetry):** the composite arm in the identical state repolls (passes today) — the pair makes the divergence the subject | same | component | same file | ❌ Wave 0 |
| STALE-01b | Amber in-flight state renders `role="status"`, warning tokens, **never** the red envelope, and any unknowable count renders `—` | render, in-flight | component | same file | ❌ Wave 0 |
| STALE-01 (backend arm, **only if** Q1/Q2 implicate M3/H-a) | `process_key_long` cannot report DONE while its declared child was never enqueued | dispatch result | unit (pytest) | `cd analytics-service && pytest tests/test_long_fetch_follow_on_guard.py -x` | ✅ exists — extend |
| STALE-01 (DB arm, **only if** implicated) | bridge branch (d) / `done_pending_children` behaviour is pinned | RPC | SQL gate | `supabase/tests/test_*.sql` | ⚠️ existing bridge tests — extend, do not fork |
| WIZCONT-01 | Overlay opened with an existing API draft renders the resume banner (`wizard-resume` + `wizard-start-fresh`) and **`sync_preview` actually renders** on Resume | overlay open → after the draft read settles | component | `npx vitest run "src/app/(dashboard)/allocations/components/ContributionWizardOverlay.test.tsx"` | ✅ exists — extend |
| WIZCONT-01 | "Start fresh" opens the confirm-delete dialog and **never** deletes directly (TRAP-4 standing invariant) | CTA click | component | same | ✅ exists |
| WIZCONT-01 | A **CSV** draft resumes: `WizardClient` with `source="csv"` + a CSV `initialDraft` does not short-circuit to `csv_upload` | mount | component | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx"` | ✅ exists — extend |
| WIZCONT-01 | The overlay's draft read and `wizard/page.tsx` issue the **same** query shape | build time | contract test (assert both import the one helper) | `npx vitest run src/__tests__/contracts/` | ❌ Wave 0 |
| WIZCONT-01 | End-to-end: open the overlay from My Strategies empty state with a seeded draft → banner → Resume → `sync_preview` | browser | e2e | `npx playwright test e2e/api-key-flow.spec.ts` | ✅ exists — extend. ⚠️ assert the **seeded** draft id, never global empty-state |
| WIZCONT-02 | Second `create-with-key` with the same MT5 login and a **different** `wizard_session_id` returns the **existing** row; no second `api_keys` row; `strategy_keys` membership untouched | route response + row count | integration (route test) | `npx vitest run "src/app/api/strategies/create-with-key/route.test.ts"` | ✅ exists — extend |
| WIZCONT-02 | The partial UNIQUE exists, is partial (`WHERE … IS NOT NULL`), and rejects the duplicate | DDL + insert | SQL gate | `supabase/tests/test_api_keys_venue_identity_uniq.sql` | ❌ Wave 0 |
| WIZCONT-02 | The 23505 handler distinguishes the new constraint from `strategies_user_wizard_session_source_uniq` | route error mapping | integration | `create-with-key/route.test.ts` | ❌ Wave 0 |
| WIZCONT-02 | Dedup notice renders as the neutral strip, **not** an `ErrorEnvelope`, and never echoes the account id | render | component | wizard component test | ❌ Wave 0 |
| All | REQUIREMENTS.md WIZCONT-01 entry-path claim is corrected | doc | manual review | — | n/a |

### Sampling Rate

- **Per task commit:** `npx vitest run <touched paths> --no-file-parallelism`
- **Per wave merge:** `npm test` + (if Python touched) `cd analytics-service && pytest && mypy --strict .`
- **Phase gate:** full vitest with `--coverage` green against the 82/80/74/72 thresholds; Playwright
  suite green; SQL gates green; **and T1/T2/T3 demonstrated RED at the pre-fix commit** (the CONTEXT.md
  gate — capture the failing output in the plan ledger, not just a claim that it failed).

### Wave 0 Gaps

- [ ] `src/hooks/useStrategySyncPoller.test.ts` — **no test file exists for this hook at all**; covers T2
- [ ] `…/steps/SyncPreviewStep.stale.runtime.test.tsx` — covers T1, T1b, T2b (STALE-01a)
- [ ] `…/steps/SyncPreviewStep.stale-refusal.runtime.test.tsx` — covers T3, T3b (STALE-01b)
- [ ] `supabase/tests/test_api_keys_venue_identity_uniq.sql` — covers WIZCONT-02's DB backstop
- [ ] a contract test pinning the single-sourced draft query — covers WIZCONT-01's stated criterion
- [ ] Framework install: **none needed** — vitest, Playwright, pytest all present and wired

---

## Security Domain

`security_enforcement` is not set to `false` in `.planning/config.json`, so this section applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `withAuth` on every new/changed route; the new draft-read route uses the **user-scoped** server client, never `createAdminClient()` |
| V3 Session Management | **yes — directly load-bearing** | M2(ii): a lost session makes an RLS read answer `[]` with no error. Whatever the fix, **an unauthenticated read must not be indistinguishable from "work in progress."** `WizardClient` already owns a `sessionExpired` strip (`:886-897`) — the honest state exists; the poller does not participate in it |
| V4 Access Control | yes | `strategies` and `strategy_analytics` RLS (`analytics_read`: published OR owned) enforce the draft read and the poll. `compute_jobs` is **RLS deny-all + REVOKE FROM `authenticated`** — reach it only via `get_user_compute_jobs`. Widening `sync-progress`'s `kind` filter must **not** widen its ownership scope |
| V5 Input Validation | yes | `isUuid(strategy_id)` before the limiter bucket (the existing pattern in `keys/sync` and `sync-progress`); any new route repeats it |
| V6 Cryptography | yes | ⛔ WIZCONT-02: **never** index or compare ciphertext. The identity value must be a genuinely non-secret venue account id, stored in the clear in its own column; the login must remain encrypted in `api_key_encrypted` |
| V7 Error Handling & Logging | yes | Seam errors go through `scrubSeamError` / `scrub_freeform_string`; `sync-progress` already redacts `last_error` and never spreads `metadata`. Any widened projection must keep field-by-field projection — ⛔ never spread an RPC row |
| V8 Data Protection | yes | UI-SPEC: the dedup notice must **never** echo the credential or account id; the venue identity stays server-side |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Zero-rows-under-RLS read mistaken for a domain value | Information Disclosure / **Denial of Service (self-inflicted: infinite spinner)** | Distinguish absent-row from domain value at every `.maybeSingle()`; surface an honest unauthenticated state |
| Enumeration via a new draft-read route | Information Disclosure | No id parameter (the route reads *the caller's own* latest draft); uniform behaviour when none exists; `withAuth` + limiter |
| Limiter-bucket exhaustion from arbitrary ids | DoS | Validate the uuid **before** the limiter key is built (existing pattern, `keys/sync/route.ts` F6) |
| Duplicate-row race on the new dedup fence | Tampering | App fence **and** DB partial UNIQUE; fail toward the existing row; branch 23505 by constraint name |
| Redaction bypass by widening a projection route | Information Disclosure | Keep field-by-field projection; extend the existing route test's "never spreads metadata" assertion to the widened arm |
| Cross-tenant read via a caller-supplied strategy id | Elevation of Privilege | Ownership assert before any read (the `_assert_owns_strategy` precedent in `process_key.py:424-457`) |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node + npm / vitest / Playwright | all TS work | ✅ | repo-pinned; ⚠️ CI is Node 22, local Node 25 | reproduce CI failures with `PATH=/opt/homebrew/opt/node@22/bin` |
| Python + pytest | only if the fix reaches `analytics-service/` | ✅ | repo-pinned | ⚠️ `pandera==0.32.1` may be missing locally (`pip install 'pandera==0.32.1' --break-system-packages`); run **from** `analytics-service/` |
| Supabase MCP (`apply_migration`, `execute_sql`) | WIZCONT-02 migration → TEST before merge; the STALE-01 settling queries | ❌ **not available in this research session** | — | ⛔ No fallback for the settling queries — plan 154-01 must run Q1/Q2 with an operator that has MCP or `psql` read access. The migration path has no fallback either: ⛔ never `supabase db push` |
| Railway logs (analytics-service) | corroborating M3/H-a (`process_key_long.enqueue_tail_failed`) | ❌ not accessed this session | — | Q2 alone discriminates M3 without logs (a parent at `done_pending_children` with no child row) |

**Missing dependencies with no fallback:**
- Read access to PROD `strategy_analytics` / `compute_jobs` for the three MT5 strategies. **This is a
  plan-154-01 task, not a blocker on planning** — M1 is established from code alone, and T1/T2/T3 are
  all runnable offline. The DB read decides *which supplier mechanism* the fix must also close.

**Missing dependencies with fallback:**
- Railway logs — Q2 substitutes.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The recommended Option A (route handler) is idiomatic for this Next version, and a `GET` route handler needs no special cache opt-out beyond the repo's existing `NO_STORE_HEADERS` convention | WIZCONT-01 | ⚠️ **AGENTS.md explicitly warns this is NOT the Next.js in training data.** A cached draft read would serve a stale/other-user draft — a correctness *and* tenancy risk. **Read `node_modules/next/dist/docs/` before the plan locks this.** |
| A2 | Only MT5 exposes a stable non-secret account id at validation today; the ccxt venues do not | WIZCONT-02 | If a ccxt venue does expose one, the phase under-delivers (a narrower dedup than achievable). **Settle by reading `analytics-service/services/adapter.py`'s `ValidationResult` and each venue's `validate()` before planning.** Low blast radius — WIZCONT-02 is LOW priority and the residual is explicitly recorded either way |
| A3 | The founder's "Fetching trades…" is the literal status line, not a paraphrase of the subheading | STALE-01 Step 0 | If a paraphrase, the candidate set widens to include `computing` and M3 rises in rank. **Q1 settles it.** Flagged in-line, not hidden |
| A4 | `api_key_id === null` on the draft row is a usable CSV-vs-API discriminator for the resume-step fix | WIZCONT-01 W-2 | It is **also** true of member-bearing composites, so using it naively would route a composite draft to the CSV step. Flagged in-line; resolve at planning |
| A5 | Widening `sync-progress`'s `kind` filter is additive and composite behaviour stays byte-identical | STALE-01 Step 7 | `stalled` derives from a stitch-specific heartbeat and `memberProgress` is composite-shaped; a naive widening could emit a misleading `stalled` for a single-key job. Pin composite neutrality with the existing route test before widening |
| A6 | `heavyFetchErrorsRef` never needing a reset is sound (its comment asserts every non-throwing heavy outcome stops the loop) | STALE-01 Step 1 | With T3's fix, the single-key arm gains a **non-throwing repoll** path — which is exactly the case the "never needs a reset" invariant did not contemplate. ⚠️ **The fix must re-examine that invariant**; a stale ref could escalate a healthy run to `SYNC_FAILED`. Flagged for the fix plan |
| A7 | Q1/Q2 as written return the needed columns (`computing_started_at`, `series_completeness`, `claimed_at`) on PROD | STALE-01 Step 6 | A missing column just errors the query; adjust and re-run. Negligible |

---

## Open Questions

1. **Which supplier mechanism (M2i / M2ii / M3 / M4) put the row in `pending`/absent on 2026-08-04?**
   - Known: M1 explains why the user had no exit, independent of the supplier.
   - Unclear: which upstream condition produced the state.
   - Recommendation: run Q1/Q2 (Step 6) as the first task of plan 154-01, **before** writing T1/T2.
     The tests are worth writing either way; the DB answer decides whether the fix must also reach
     Python or SQL (per CONTEXT.md, "fix at the root cause wherever it lives").

2. **Do (a) and (b) share one cause?** CONTEXT.md asks that this be tested, not assumed.
   - Known: they share a root *idea* (a possibly-not-current reading treated as current) but sit at
     **different code sites**.
   - Recommendation: state explicitly in the plan that a single-site fix does not discharge both, and
     keep T1/T2 and T3 as independent red gates.

3. **Does the fix belong in `useStrategySyncPoller` (shared with `SyncProgress`) or in the wizard's callbacks?**
   - Known: the hook is deliberately parametrized because the two surfaces poll differently, and the
     interval arm has a *pinned asymmetry* (no consecutive-error escalation).
   - Recommendation: default to the wizard's own callbacks; if the class genuinely spans both, say so
     and add a `SyncProgress` regression test in the same commit.

4. **`ValidationResult`'s account-identity contract across venues.** See A2. One read settles it.

5. **Does the wizard need to react to `queued: false` (M4)?** Even if Q1/Q2 exonerate it, the kickoff
   arm ignoring a field the server sends is a live hole. Recommendation: cover with T2b regardless —
   it is cheap and it is the same class ("the client infers state the server already told it").

---

## Sources

### Primary (HIGH confidence — read in this session, file:line cited throughout)
- `src/hooks/useStrategySyncPoller.ts` (full file, 284 lines)
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` (:1-140, :440-1620, :2270-2448)
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` (:180-270, :860-960)
- `src/app/(dashboard)/strategies/new/wizard/page.tsx` (:60-124)
- `src/app/(dashboard)/strategies/new/page.tsx` (full file)
- `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx` (:100-175)
- `src/lib/closed-sets.ts` (:690-740), `src/lib/types.ts` (:305-325), `src/lib/strategyGate.ts` (:36-71, :160-175, :243-345)
- `src/app/api/keys/sync/route.ts` (:1-200 incl. the direct-writes audit docblock)
- `src/app/api/strategies/create-with-key/route.ts` (:83-200, :400-440)
- `src/app/api/strategies/[id]/sync-progress/route.ts` (:1-60, and the `kind` filter at :185, `jobStatus` at :225)
- `src/app/api/keys/validate-and-encrypt/route.ts` (:60-125 — the MT5 slot mapping)
- `supabase/migrations/20260405061911_initial_schema.sql:74`, `20260405061912_rls_policies.sql:35-44`
- `supabase/migrations/20260412094454_sync_strategy_analytics_status.sql` (full)
- `supabase/migrations/20260602120000_strategy_analytics_computation_status_add_complete_with_warnings.sql` (full)
- `supabase/migrations/20260710150000_sync_status_supersede_failed_per_kind.sql` (:1-190 — **the latest deployed bridge body**)
- `analytics-service/services/job_worker.py` (:495-530 chain topology, :2353-2420 dual-mode derive, :2535-2575 heal-delete + P72 stamp, :8570-8680 dispatch)
- `analytics-service/services/ingestion/long_fetch.py` (:540-660 — the best-effort tail enqueue)
- `analytics-service/routers/process_key.py` (:640-760 duplicate-resume, :1600-1640 long-fetch enqueue)
- `analytics-service/services/mt5_probe.py` (:118-129, :231, :267-270 — login assertion)
- `.planning/phases/154-…/154-CONTEXT.md`, `154-UI-SPEC.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md:492`
- `CLAUDE.md`, `AGENTS.md`, `.planning/config.json`, `vitest.config.ts`

### Secondary (MEDIUM confidence)
- Directory inventories (`e2e/`, `src/app/api/strategies/`, wizard step test files) — establish which
  test files exist vs must be created

### Tertiary (LOW confidence — flagged, not relied upon)
- The specific PROD sequence of events on 2026-08-04. **No DB or log access this session.** Every
  claim about that run is presented as a ranked hypothesis with its discriminating query, never as
  established fact.

**No external web sources were consulted** — this phase is entirely in-repo defect investigation, and
no new library or package is contemplated.

---

## Metadata

**Confidence breakdown:**
- Code trace (poll loop, render conditions, gate ordering, bridge branches, job chain): **HIGH** — every
  claim read from disk this session with line numbers
- Ranking of STALE-01 mechanisms: **HIGH for M1** (pure code, no external evidence needed);
  **MEDIUM for M2/M3/M4** (each is a real, reachable code path, but which one fired is unconfirmed)
- STALE-01b diagnosis (missing single-key R2-5 twin): **HIGH** — both arms read, both windows confirmed
- In-flight signal availability: **HIGH** — route, RPC, and filter line all read
- WIZCONT-01 defect sites: **HIGH**; the read-mechanism recommendation: **MEDIUM** (A1 — Next version
  conventions must be checked against `node_modules/next/dist/docs/`)
- WIZCONT-02 MT5 identity: **HIGH**; other venues: **LOW** (A2 — one unread contract)
- Standard stack / pitfalls: **HIGH** — drawn from in-repo docblocks and project memory, not training data

**Research date:** 2026-08-12
**Valid until:** 2026-09-11 (30 days — in-repo findings on a stable surface; invalidated earlier by any
merge touching `SyncPreviewStep.tsx`, `useStrategySyncPoller.ts`, `sync-progress/route.ts`, the status
bridge migrations, or `long_fetch.py`)

---
phase: 161-wizerr-honest-error-surfaces
verified: 2026-08-24T23:24:35Z
head: 294ae79b
status: human_needed
score: 4/4 success criteria verified · 13/13 requirements satisfied
behavior_unverified: 0
overrides_applied: 0
deferred:
  - truth: "The MT5 generic fallback (arm 3) names a specific option it has not proven"
    addressed_in: "TODOS.md item 0.09 (🔴 FIX NOW)"
    evidence: "Structurally unreachable from BOTH raise sites — verified: each enters the operator arm only via terminal_trade_permission_off(), which requires terminal_info to be a Mapping with a falsy trade_allowed, forcing arm 1 or arm 2. Survives only as Mt5GatewayMisconfigured()'s default argument and curated_gateway_detail()'s degradation target."
  - truth: "A manager can release their own orphaned API key"
    addressed_in: "TODOS.md item 0.08 (🔴 FIX NOW)"
    evidence: "KEY_ORPHANED's shipped fix[] does NOT name a release surface — it names 'connect a different account' and a support address. The unwinnable UI-SPEC bullet was measured and rejected before shipping. Product gap accurately described."
  - truth: "The composite arm names the real provenance reason for a sampled_gapped series"
    addressed_in: "TODOS.md item 0.07 (🔴 FIX NOW)"
    evidence: "SyncPreviewStep.tsx:1308/:1311 hardcode GATE_SERIES_PROVENANCE_UNVERIFIED for every inadmissible composite verdict — confirmed at HEAD. Booked, not silently widened."
human_verification:
  - test: "Trigger one live MT5 validate that lands an `undetermined` capability verdict (or read the operator surface / sanitized_message for the next one that occurs), and read the sentence."
    expected: "The sentence names 'Allow algorithmic trading' (arm 1) if the gateway's Experts setting is off, or the external-Python-API option (arm 2) only if terminal_info actually reports tradeapi_disabled. It must NOT name the external-Python-API option while that flag is off — that is the exact defect WIZERR-01 exists to remove."
    why_human: "Which arm fires is a property of the LIVE gateway's terminal_info, not of the code. The flag->cause builder is provably correct given its input (verified in source + parametrized fence), but `tradeapi_disabled` has been founder-measured exactly ONCE (2026-08-13) and has zero production readers. Only a live undetermined verdict shows which sentence a founder actually reads."
    blocked: "FOUNDER-GATED, with the reason now MEASURED rather than assumed (2026-08-28). There is no instance to read. Two things were checked: (a) the verdict has NO durable sink — `_Mt5ValidateTrace.outcome` is carried to `emit_mt5_stage_event` (`analytics-service/services/mt5_client.py:205`), which writes a STRUCTURED LOG EVENT, not a row, so there is no table to query for a historical `undetermined`; (b) the live operator surface is empty — the current Railway log window for `quantalyze-analytics` (production) contains ZERO `mt5` lines of any kind, let alone an `undetermined` one. So the fallback the item itself offered (\"read the operator surface / sanitized_message for the next one that occurs\") has nothing to read, and short log retention means a past occurrence would be gone anyway. ⭐ WHAT WOULD ACTUALLY CLOSE IT, and why it is founder-only: the arm is selected by the LIVE terminal's `tradeapi_disabled` flag, so it needs one real MT5 validate against a terminal with \"Allow algorithmic trading\" OFF — i.e. broker credentials and a gateway I do not have. The code half is already pinned (flag->cause builder verified in source plus a parametrized fence), so a live run adds exactly one fact: which input actually arrives. ⚠️ Worth pairing with a durable sink when it is done — an outcome that exists only in a rotating log cannot be verified after the fact by anyone, which is what made this item unclosable for a week."
  - test: "On a strategy edit page whose stored key can no longer be decrypted, look at the KeyPermissionBadge error line."
    expected: "The founder can read and act on 'This stored key can no longer be decrypted. Reconnect the key — retrying will not help.'"
    why_human: "KeyPermissionBadge.tsx:118-122 renders `${err.code}: ${message}`, so the honest sentence reaches the user with the raw token `KEY_UNDECRYPTABLE: ` glued to its front. This is PRE-EXISTING (140.3-07) and untouched by Phase 161 — not a regression — but it is a founder-hit key surface and whether the copy still reads as truthful prose is a legibility judgment."
    result: "READY FOR A RULING 2026-08-26 — the FACT is now verified in source, so this no longer requires reproducing a broken key; only the judgment remains. Confirmed at HEAD: `permissions/route.ts:599,609` emit code `KEY_UNDECRYPTABLE` with the sentence 'This stored key can no longer be decrypted. Reconnect the key — retrying will not help.', and `KeyPermissionBadge.tsx:140` renders `err.code ? `${err.code}: ${message}` : message`. The exact string a founder reads is therefore: 'KEY_UNDECRYPTABLE: This stored key can no longer be decrypted. Reconnect the key — retrying will not help.' ⭐ The prefix is DELIBERATE, not an oversight: the comment at KeyPermissionBadge.tsx:137-138 states it exists 'so the displayed text is greppable in support tickets'. So the open question is not 'is this a bug' but a recorded trade-off — operator greppability vs user-facing prose. Founder call: keep the prefix, drop it for user-facing arms while keeping it in logs, or accept as-is. ⭐ RULED 2026-08-26: SPLIT — render the prose sentence alone to the user, keep the structured code in the console log and the Sentry breadcrumb. Support keeps a greppable handle; the founder reads a clean sentence. ⚠️ This is a CLASS change, not a one-string fix: the same render site serves other codes (e.g. PROBE_BACKEND_UNAVAILABLE), so the branch applies to every code it emits. Implementation routed to Phase 164.1, which already owns phase 161's deferred error-surface items."
  - test: "Walk the wizard to a gate refusal, click 'Try another key', then reload the page and open the wizard again."
    expected: "The draft and (on a composite) every stored member are still there; the user resumes rather than starting over."
    why_human: "The non-destructive transition is behaviourally pinned in jsdom (verified — see below), but end-to-end draft survival across a real reload against a real database is a user-flow property no unit test observes."
---

# Phase 161: WIZERR — Honest Error Surfaces — Verification Report

**Phase Goal:** Every founder-hit wizard, key, and CSV error surface names the actual blocker in
truthful copy — no `code: UNKNOWN`, no false sentence, no "try again" that can never succeed.

**Verified:** 2026-08-24T23:24:35Z at `294ae79b` (branch `feat/v1.20-phase-161-wizerr`)
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Success Criteria (the ROADMAP contract)

| # | Success criterion | Status | Evidence |
|---|---|---|---|
| 1 | MT5 "gateway misconfigured" copy names the actual blocker, derived from `terminal_info` flags, as a CLASS across all carrier sites, inside the curated-message fence | ✓ VERIFIED | `mt5_probe.mt5_gateway_misconfigured_detail()` is the one flag→cause seam; both raise sites (`services/ingestion/mt5.py:354`, `routers/exchange.py:886`) call it with the SAME terminal dict the verdict came from. `curated_gateway_detail()` is an allow-list read at the worker sink (`job_worker.py:684`). Fence `test_every_builder_emittable_constant_is_curated_and_credential_free` is parametrized over `MT5_GATEWAY_MISCONFIGURED_DETAILS`, whose size is separately pinned at 3 and whose members are pinned distinct. 52 Python tests green. |
| 2 | Key-lane remedies are safe and truthful (non-destructive "Try another key"; honest orphan refusal; `KEY_INVALID_FORMAT` split on 2 routes / 9 sites; venue-parameterized AUTH copy) | ✓ VERIFIED | All four halves verified in code + behavioural tests run green. See per-requirement table. |
| 3 | The coverage law reaches every surface the class regrew on (permissions `PROBE_*`; three dashboard dialogs; five 5xx terminal arms; `Retry-After` end-to-end) | ✓ VERIFIED | Four laws read populations from disk; two proven falsifiable by observed RED (below). All five terminal arms forward `seamCode` at HEAD. `Retry-After` traced end-to-end. |
| 4 | CSV verdicts tell the truth (7-row floor on the composite arm WITH its copy; truthful fourth verdict; A2 409 sentence; per-row breakdown clean) | ✓ VERIFIED | All four halves in code; `strategyGate.test.ts` + `SyncPreviewStep.composite.render.test.tsx` green (305 tests). See notes on the A2 wording below. |

**Score: 4/4 success criteria verified.**

---

### Requirements Coverage (13/13)

| Req | Claim | Status | Evidence at HEAD |
|---|---|---|---|
| WIZERR-01 | MT5 copy names the actual blocker from the flags | ✓ SATISFIED | `mt5_probe.py:190-226` — three arms, `tradeapi_disabled` → arm 2, `terminal_trade_permission_off` → arm 1, else generic. Every read is `.get()`; a non-Mapping or absent key falls to the generic rather than asserting an unmeasured cause (A1 quarantine). |
| WIZERR-02 | "Try another key" never destroys the draft or cascades members | ✓ SATISFIED | `WizardClient.tsx:1297-1301` — the callback is now `setStep` + `persistPointer` + telemetry. `handleDeleteDraft` has exactly ONE non-comment caller (`:1643`, the confirm-dialog danger button). Behavioural: `WizardClient.test.tsx:1318` (no DELETE, session id not re-minted, `strategyId` survives, no confirm interposed, pointer follows) WITH a negative control at `:1394` proving the deliberate delete still deletes. **Ran green.** |
| WIZERR-03 | Orphaned live key gets an honest remedy, not a false `DRAFT_ALREADY_EXISTS` 409 | ✓ SATISFIED | `create-with-key/route.ts:1004-1046` — a NEW branch ABOVE the pinned fence 409 (the fence is byte-untouched for its own case). `KEY_ORPHANED` copy names two remedies that can succeed. 5 named tests green. |
| WIZERR-04 | Permissions `PROBE_*` derived-population law; `KEY_UNDECRYPTABLE` says "reconnect", not "try again" | ✓ SATISFIED | `probe-vocabulary.invariant.test.ts` — two derived emitter shapes, hand-typed counts 6 / 3 / 3, blank-sentence floor is a LENGTH (`< 8`), discriminating negative controls on real sentinels (`ECONNREFUSED`, `INTERNAL_API_TOKEN`), an irrecoverable sub-population non-emptiness fence, and a positive half ("names the action that CAN succeed"). Route arm at `:604-612` is now `code:`-first (WR-03). |
| WIZERR-05 | `Retry-After` threads end-to-end as a 4th optional field | ✓ SATISFIED | `exchange.py:540/632` → `analytics-client.ts:611/634` (`parseRetryAfterSeconds` on BOTH `!ok` arms) → `seam-retry-after.keyRouteFailureHeaders()` (both callers) → `ConnectKeyStep.tsx:945` reads the response headers → `ErrorEnvelope.tsx:171` renders it. Named per-route FRACTIONAL tests green. |
| WIZERR-06 | Five 5xx→UNKNOWN terminal arms forward recognized `seamCode`s | ✓ SATISFIED | Measured at HEAD: eval `:344`, recompute `:273`, bridge `:250`, validate-and-encrypt `:827`, simulator `:253` all read `seamCode ?? "UNKNOWN"`. The one surviving bare `code: "UNKNOWN"` on those files (`validate-and-encrypt:692`) is the persist-INSERT arm the law's docblock explicitly excludes (PostgREST error, no seam code). |
| WIZERR-07 | Three dashboard dialogs stop minting `code: UNKNOWN` | ✓ SATISFIED | All three call `recogniseDashboardDialogCode` (grep count 2 each) and carry no local `Record<string,` translation table; the law asserts both over the derived population. Prose-keyed `ROUTE_FIELD_ERRORS` is gone. |
| WIZERR-08 | `KEY_INVALID_FORMAT` split on the remaining 2 routes / 9 sites | ✓ SATISFIED | `validate-and-encrypt` 4 arms (2×`KEY_VENUE_NOT_ENABLED`, 2×`KEY_MISSING_REQUIRED_FIELD`) + `verify-strategy` 5 arms = 9 sites / 2 routes. `KEY_INVALID_FORMAT` has ZERO emitters left on `validate-and-encrypt`, pinned by a comment-stripped scan **with a positive control ahead of the negative claim**. |
| WIZERR-09 | 7-row floor on the wizard composite arm AND its own copy, atomically | ✓ SATISFIED | `SyncPreviewStep.tsx:1349-1359` applies `STRATEGY_GATE_MIN_CSV_ROWS` (imported, never re-typed) INSIDE the admitted branch — the admin path's evaluation order — and emits `GATE_INSUFFICIENT_CSV_HISTORY`, whose copy exists at `wizardErrors.ts:1981`. Both landed in one commit (`3782bae6`). |
| WIZERR-10 | Truthful fourth verdict replaces "only 0 trade(s)" | ✓ SATISFIED | `strategyGate.ts:192-201` (the two-member map) + `:446-470` (the arm, evaluated before the trade floor, sentence READ from the map). Admin pin re-pointed at `admin/strategy-review/route.test.ts:1442`. |
| WIZERR-11 | Wizard `AUTH_FAILED` copy names the venue actually selected | ✓ SATISFIED | `REQUIRES_DERIBIT` = `{kind:"venueIs", venue:"deribit"}`, applied by the ONE `applyFixRequirements` filter; **strict equality with no default and no case-fold — an absent venue SUPPRESSES**. Both connect surfaces pass a real venue (`ConnectKeyStep.tsx:1107` `attemptExchange ?? exchange`; `MultiKeyConnectStep.tsx:1854` per-panel `attemptVenue`). The generic re-copy bullet stays `null` (unconditional), so suppression never leaves a venue-less caller with no instruction. |
| WIZERR-12 | csv-finalize A2 409 sentence describes the actual case | ✓ SATISFIED (with a deliberate, better-than-spec wording — see note) | `csv-finalize/route.ts:1349`. |
| WIZERR-13 | Per-row CSV breakdown renders its data half without `'nan'` or cell echo | ✓ SATISFIED | Producer: `csv_validator.py:770-825` — `pd.isna` guards on BOTH column and row (never a string match on `"nan"`), sentinel `0` stays on the wire but is never interpolated. Renderer: `CsvValidationEnvelope.tsx:232` prefixes only when `e.row >= 1` (`undefined >= 1` is false, so a malformed payload degrades to the bare sentence). The dead `formatColumnInDataframeMessage` is deleted from `wizardErrors.ts` (grep: 0 hits). |

**⚠️ Note on WIZERR-12.** The ROADMAP's parenthetical proposes "same track record, different flow".
The shipped sentence is *"This wizard session already committed a strategy that is not in the state
this submission asked for…"*. This is a **deliberate deviation recorded with its measurement**: the
A2 arm runs BEFORE the name check and BEFORE the series check, and `existingRow.status` is read
live (a published row of the SAME flow reaches this arm too), so **both halves of the spec's
proposed sentence are unestablished at that arm**. The shipped sentence claims only what the arm
established. This is a *stricter* reading of the phase goal than the criterion's own parenthetical
— verified as SATISFIED against the goal, not against the UI-SPEC. The remedy can succeed:
`handleCsvStartNewStrategy` mints a fresh `wizard_session_id`, so the resubmit no longer collides
on the partial index.

---

## Anti-Vacuity Audit — the phase's own standard, applied to the phase's own laws

I read all six named laws end to end and **proved two of them falsifiable by first-hand observed
RED**, then restored the tree.

| Law | Non-empty population fence? | Count oracle | Blank-needle safe? | Verdict |
|---|---|---|---|---|
| `probe-vocabulary.invariant` | ✓ `EMITTED_CODES.length > 0`, **plus** a second fence on the `retryClearsIt: false` SUB-population | 3 hand-typed literals (6 / 3 / 3), never `derived.length` | ✓ floor is a LENGTH (`sentence.trim().length < 8`), not truthiness — added by the author's own anti-vacuity mutation | ✓ SOUND |
| `dialog-envelope.invariant` | ✓ population `> 0` **and** a per-route `derived.length > 0` inside the ARRIVAL loop | `EXPECTED_DIALOG_COUNT=3`; per-route `expectedEmitterSites` 9 / 14 / 23; roster `checked=19`; dispositions 3 and 4 | ✓ disposition reasons floored at `> 40` chars | ✓ SOUND — **RED OBSERVED** |
| `seam-terminal-arm.invariant` | ✓ `DERIVED_ROUTES.length > 0` | `EXPECTED_ROUTE_COUNT=5` **and** an independent hand-typed path roster | n/a (path/expression assertions) | ✓ SOUND — **RED OBSERVED** |
| `analytics-upstream-error.parity` | ✓ `DOUBLE_FILES.length > 0` | `EXPECTED_DOUBLE_COUNT=5` + hand-typed path roster; `REAL_CTOR_PARAMS` hand-typed and asserted against the real class first | ✓ `REAL_CTOR_PARAMS.length >= 2` + every name matched against an identifier regex before being used as an oracle | ✓ SOUND |
| 4th `ROUTES` row (`wizardErrors.invariant`) | ✓ a **per-route** `> 0` case added by 161-09 precisely because the module-wide floor is a SUM that any one route can go dark under | `expectedSites: 11`, roster floor `> 5`, union `> 30`, alias `> 3` | ✓ | ✓ SOUND |
| 409-scoped population | ✓ `codes.length >= EXPECTED_409_CODES.length` (3) | hand-typed 3-member array, plus exact set equality | ✓ | ✓ SOUND (see minor note) |

**Observed RED #1 — `dialog-envelope.invariant`.** I added a 4th `.tsx` under `src/components/strategy`
calling `buildEnvelope` and mounting `<Modal>`:
```
× C. NON-VACUITY: the population is NON-EMPTY and matches the hand-typed count
AssertionError: The dashboard envelope-dialog population changed:
```

**Observed RED #2 — `seam-terminal-arm.invariant`.** I added a 6th `route.ts` under `src/app/api`
with the 4xx-split / terminal-`code:` shape:
```
× has exactly the hand-typed measured size
AssertionError: Expected 5 routes carrying the shape; found 6: …, src/app/api/zz-verifier-probe/route.ts.
  A SIXTH is not a literal to bump …
× is exactly the hand-typed roster, by path
```
Both probe files were removed; the working tree is clean at `294ae79b` (`git status --porcelain`
shows only the untracked `161.1-*` planning directory, which predates this verification).

**Searched for a fifth vacuity mechanism — none found.** Specifically checked:
- Every added `.not.toContain(<var>)` — all in the SAFE direction (a blanked needle **reds**, because
  `"x".includes("")` is true).
- Every added `.toContain(<var>)` in the POSITIVE direction — each is preceded by a substance floor
  (`expect(bullet.length).toBeGreaterThan(10)`, `expected.length >= 3`).
- The negative source-scan claim on `validate-and-encrypt` (`KEY_INVALID_FORMAT` has no emitter):
  it runs a **positive control on the scanner first** (`KEY_VENUE_NOT_ENABLED` count `toBe(2)`), so a
  blanking comment-stripper reds instead of certifying the class closed.
- The self-caught vacuous pin the fix round confessed (a "no Retry renders" assertion on
  `MarkOwnershipDialog`, which passes no `onRetry`) — confirmed MOVED to `AllocateDialog`, matched on
  the control's real accessible name `"Retry"`, and paired with a NEGATIVE CONTROL asserting the
  verified-zero arm still renders one. Neither half is satisfiable by deletion.
- `analytics-upstream-error.parity`'s `>= REAL_CTOR_PARAMS.length` — this compares a DOUBLE's
  derivation against the REAL CLASS's derivation. Two independent artefacts, and the reference is
  itself pinned against a hand-typed list first. Not self-reference.

**Minor (non-blocking) note.** The 409 population's floor is
`toBeGreaterThanOrEqual(EXPECTED_409_CODES.length)` rather than a hand-typed integer. It is
non-vacuous today (the array is a source literal with 3 members), but it is one deliberate edit away
from `>= 0`. A hand-typed `3` would match the discipline every sibling law uses.

---

### The remedy-can-succeed property, per arm

| Code / arm | Named remedy | Can it succeed? |
|---|---|---|
| `KEY_UNDECRYPTABLE` | "Reconnect the key — retrying will not help." | ✓ The badge renders on the strategy edit page, where `ApiKeyManager` mounts an "Add Key" form, and in `SyncPreviewStep`, where "Try another key" now survives the draft. |
| `KEY_ORPHANED` | Connect a different account **or** email support | ✓ The unwinnable UI-SPEC bullet ("Disconnect under Manage keys") was measured — `"Manage keys"` occurs nowhere in `src` — and REPLACED before shipping. The residual product gap is booked at TODOS 0.06. |
| `DASHBOARD_WRITE_INDETERMINATE` | Reload, then read current state | ✓ And critically it offers **no** `clear_and_retry` → `recoverable: false` → no Retry control, because a blind retry against a possibly-applied money write is the unwinnable remedy in a new hat. |
| `DASHBOARD_WRITE_FAILED` | "Nothing was saved" + `clear_and_retry` | ✓ Now restricted to the 5 arms where **no data-modifying statement had been sent**. The rule is mechanical and documented per arm; 10 arms moved to INDETERMINATE. |
| `GATE_SERIES_EXAMINED_REFUSED` | "Connect a Deribit key" / "create from CSV" | ✓ **Measured at the producer**: `combine_native_ledger` (Deribit) stamps `ledger_complete` on both return paths and Deribit is in `UI_EXCHANGE_CODES_BASE` (offered unconditionally, no flag). MT5 also stamps `ledger_complete` but is deliberately NOT named because its presence rides `MT5_UI_ENABLED`. |
| `GATE_INSUFFICIENT_CSV_HISTORY` | Come back once the series covers 7 days, retry the sync | ✓ Time-bounded but reachable; `clear_and_retry` is honest here. |
| MT5 arms 1 / 2 | "needs an operator, not a retry — see the go-live runbook" | ✓ Honest: it names the operator action and explicitly refuses the retry framing. |
| `CSV_SESSION_REUSED` (A2) | "Start a new strategy" | ✓ `handleCsvStartNewStrategy` mints a fresh `wizard_session_id`, so the resubmit no longer collides on the partial unique index. |
| `SERVICE_UNREACHABLE` / breaker | wait `Retry-After` seconds | ✓ End-to-end thread verified; TRAP-3 now enforced on **both** branches (integer, `> 0`), so `0` and `0.5` can no longer reach our wire. |

No arm was found naming a remedy that cannot succeed.

---

### Known-live residues — scoping confirmed accurate

All three are booked in `TODOS.md` under **🔴 FIX NOW**, not silently dropped, and none is silently
widened:

- **0.09 (MT5 generic fallback; renumbered from 0.05 on 2026-08-26).** Claim: "structurally unreachable from both raise sites". **I
  re-derived this and it holds.** Each raise site enters the operator arm only when
  `terminal_trade_permission_off(terminal)` is true, which requires `terminal_info` to be a Mapping
  containing `trade_allowed` with a falsy value — so `mt5_gateway_misconfigured_detail` cannot reach
  arm 3 on either path. It survives only as the exception's default argument and as
  `curated_gateway_detail`'s degradation target, exactly as TODOS states.
- **0.08 (no manager surface releases an orphaned key; renumbered from 0.06 on 2026-08-26).** Accurate. `"Manage keys"` occurs nowhere in
  `src`; `ApiKeyManager` mounts only on the per-strategy edit page (and an orphan has no strategy);
  the shipped `KEY_ORPHANED` copy routes to support rather than to a control that does not exist.
- **0.07 (composite arm hardcodes one provenance reason).** Accurate. `SyncPreviewStep.tsx:1308` sets
  `GATE_SERIES_PROVENANCE_UNVERIFIED` unconditionally for every inadmissible composite verdict, and
  `:1311` mirrors it into telemetry.

---

### Anti-Patterns Found

| Scope | Result |
|---|---|
| `TBD` / `FIXME` / `XXX` in added lines across 70 changed `.ts`/`.tsx`/`.py` files | **0** |
| `TODO` / `HACK` / `PLACEHOLDER` / `as any` / `@ts-ignore` / `console.log(` in added lines | **0** |
| Prod URLs, project refs, JWTs, API keys in added lines (repo is PUBLIC) | **0** |

---

### Warnings (non-blocking — route to TODOS, per the project stopping rule)

| # | File | Finding | Severity |
|---|---|---|---|
| W1 | `SyncPreviewStep.tsx:335` | *"the destructive `onTryAnotherKey` path is single-key only"* — **false at HEAD.** 161-04 made that handler a pure step transition. | ⚠️ WARNING (prose only) |
| W2 | `SyncPreviewStep.tsx:2012` | Condition 2 still reads *"the button falls back to `onTryAnotherKey`, i.e. it is destructive while wearing the non-destructive label"* — **false at HEAD.** 161-07 annotated the staleness 25 lines below (`:2037`) but did not correct the sentence itself. | ⚠️ WARNING (prose only) |
| W3 | `KeyPermissionBadge.tsx:118-122` | Renders `${err.code}: ${message}`, so `KEY_UNDECRYPTABLE`'s honest sentence reaches the founder with a raw machine token prefixed. **PRE-EXISTING (140.3-07), untouched by this phase** — not a regression. | ℹ️ INFO |

W1/W2 matter because this phase's own written standard — stated verbatim at `WizardClient.tsx:1240`
and `SyncPreviewStep.tsx:2037` — is that *"a comment describing behavior that no longer exists is a
false sentence in exactly the class this phase closes."* 161-04's commit message says stale comments
were *"corrected in both files"*; `git show --stat 188369db` shows it touched only
`WizardClient.tsx` and `WizardClient.test.tsx` — the third carrier was never opened. This is code
prose, not a user-facing surface or a data-integrity fault, so under the project stopping rule it is
**not blocking**; it belongs in `TODOS.md`.

---

### Behavioural Spot-Checks (run first-hand at `294ae79b`)

| Check | Command | Result |
|---|---|---|
| The five coverage/shape laws | `npx vitest run` (5 files) | ✓ 5 files / **116 tests passed** |
| The two proven-falsifiable laws under mutation | probe file added to each derived population | ✓ **RED, by name, in both** |
| WIZERR-02 draft survival + delete negative control | `WizardClient.test.tsx` | ✓ passed |
| CR-01 Retry split (indeterminate ⇒ none; verified-zero ⇒ present) | `AllocateDialog.test.tsx` | ✓ passed |
| Permissions route behaviour | `keys/[id]/permissions/route.test.ts` | ✓ 3 files / **128 tests passed** |
| Key-lane + CSV floor + gate | 4 files incl. `strategyGate.test.ts` | ✓ **305 tests passed** |
| `Retry-After` fractional guard, both routes, by name | `vitest -t "FRACTIONAL"` | ✓ 2 passed |
| `KEY_ORPHANED`, by name | `vitest -t "KEY_ORPHANED"` | ✓ 5 passed |
| MT5 curated fence + CSV validator | `python3 -m pytest` from `analytics-service/` | ✓ **52 passed** |

The full suite was **not** re-run — it was run immediately before this verification
(791 files / 12,378 tests passed, 281 pre-existing skips, 0 failed; Python 5,240 passed / 89 skipped;
`tsc --noEmit` clean). Every check above is an independent, first-hand measurement.

**⚖️ Gate posture.** Branch protection is deliberately OFF until there are paying clients, so every
CI gate is ADVISORY at merge. Each pin recorded here is one that **would have** caught the defect it
names; none of them *stopped* anything, because nothing has been merged.

---

## Gaps Summary

**No gaps.** Every observable truth behind the four Success Criteria is true of the code at
`294ae79b`, every one of the 13 requirements is delivered (checked against source, not against the
SUMMARYs that claim them), the two Criticals and all six Warnings from `161-REVIEW.md` are closed in
the tree, and the three known-live residues are accurately described and correctly scoped in
`TODOS.md`.

The status is **`human_needed`, not `passed`**, for one reason and it is a scope reason rather than a
defect: this phase's entire deliverable is **error-message truthfulness on live surfaces**, which is
in the always-needs-a-human class. Two of the three items are genuinely un-automatable — which arm
the MT5 builder selects is a fact about a live gateway's `terminal_info`, and legibility of a
sentence rendered behind a machine-token prefix is a judgment. The third is a real-reload user-flow
confirmation of a property that is otherwise pinned only in jsdom.

Two stale comment carriers (W1, W2) are the phase's own defect class surviving in code prose. They
are non-blocking under this project's stopping rule and should be filed in `TODOS.md`.

---

_Verified: 2026-08-24T23:24:35Z_
_Verifier: Claude (gsd-verifier)_

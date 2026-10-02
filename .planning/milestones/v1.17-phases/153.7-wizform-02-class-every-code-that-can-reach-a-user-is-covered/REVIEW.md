---
phase: 153.7-wizform-02-class-every-code-that-can-reach-a-user-is-covered
reviewed: 2026-08-14T00:00:00Z
depth: deep
files_reviewed: 12
files_reviewed_list:
  - src/lib/wizardErrors.ts
  - src/lib/wizardErrors.test.ts
  - src/lib/wizardErrors.invariant.test.ts
  - src/lib/seam-venue-vocabulary.invariant.test.ts
  - src/lib/resilient-fetch.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - src/app/api/strategies/finalize-wizard/route.test.ts
  - src/app/api/strategies/create-with-key/route.test.ts
  - src/app/api/strategies/composite/add-key/route.test.ts
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx
findings:
  critical: 0
  blocker: 0
  warning: 4
  info: 0
  total: 4
status: issues_found
---

# Phase 153.7: Code Review Report

**Reviewed:** 2026-08-14
**Depth:** deep (cross-file: TS ↔ Python emitters ↔ SQL RPC ↔ wizard steps)
**Files Reviewed:** 12 source files (`.planning/**` skimmed only for contradiction)
**Status:** issues_found — **0 blocking**

## Summary

I attacked the four things this phase could plausibly have gotten wrong: (1) the truth of every
new user-facing copy string at *every* emitter that routes to it, (2) the `recoverable`
derivation, (3) the possibility of a self-referential test oracle, and (4) a behaviour change
smuggled into a docs-only commit. Three of those four came back clean under measurement:

- **Copy truth, verified at the emitter, not the intent.** `DRAFT_LOOKUP_FAILED`'s "nothing was
  submitted and nothing was changed" holds: I grepped `finalize-wizard/route.ts` for
  `.insert(/.update(/.upsert(/.delete(/.rpc(` before the `.maybeSingle()` at line 1106 — there are
  none, and the only prior `await`s are `req.json()`, `checkLimit` and `createClient`.
  `DRAFT_FINALIZE_FAILED`'s refusal to claim "nothing was saved" is correct for a generic RPC tail
  that also catches a lost PostgREST answer, and its "the next one tells you the draft has already
  moved on" is backed by real SQL:
  `supabase/migrations/20260521185008_wizard_finalize_inserts_verification.sql:102-105` raises
  `invalid_parameter_value` (22023) when `v_current_status <> 'draft'`, which
  `route.ts:1875` maps to `DRAFT_STATE_INVALID`. `SEAM_RESPONSE_UNREADABLE`'s
  "your submission reached the service" rests on `postProcessKey`'s `result.ok` being a 2xx-with-
  usable-body verdict (`process-key-client.ts`), which it is; and its "open your strategies list"
  remedy is *not* ambiguous, because `/strategies` excludes wizard drafts
  (`page.tsx:28` — `.or("source.neq.wizard,status.neq.draft")`) and the unified arm is
  manager-only (contributions divert to `runLegacyFinalize` first).
- **`recoverable` derivation, checked as a mechanism.** `buildEnvelope` derives it from
  `RECOVERABLE_ACTIONS = {clear_and_retry, try_another_key}` (`envelope.ts:54`). Each new entry's
  `actions` produce the claimed value. `SEAM_INTERNAL_FAULT` and `SEAM_RESPONSE_UNREADABLE` are
  correctly non-recoverable; the two `DRAFT_*` members are correctly recoverable.
- **Oracle independence holds.** `EXPECTED_EMITTED_CODES` is a hand-typed 37-member roster,
  `DERIVED_FLOOR = 22` is a hand-typed literal (`0.6 × 37`, not `derived.size`), the blind-spot pin
  is a hand-typed file→count map, and the reach pin (`REACH_ROOT` / `REACH_SUBTREES` /
  `REACH_CALLEES`) is hand-typed. No `[...derived]`, `Array.from(derived)` or `derived.size`
  appears on the expected side of any assertion. The falsifier runs the **real**
  `deriveEmitterSites` over a synthetic tmpdir through the **live** disposition Maps.
- **No smuggled behaviour.** The one "docs" commit that touched `src/` (`5ecd7243`, which edits
  `wizardErrors.ts`, `wizardErrors.invariant.test.ts` and `resilient-fetch.ts`) is comment-only:
  filtering its diff for non-comment `+`/`-` lines returns zero hits.

**Nothing here blocks.** The four warnings below are real and provable but none is user-facing harm
or a data-integrity risk under this project's stopping rule. WR-01 is the one I'd fix in this phase;
WR-02 and WR-03 are worth a TODOS.md line; WR-04 is pre-existing and only newly visible.

## Warnings

### WR-01: `SEAM_INTERNAL_FAULT` asserts unconditional permanence at two emitters whose own comments name transient causes

**File:** `src/lib/wizardErrors.ts:2391` (and the restatement at `:2393`)

**Issue:** The entry's `cause` ends *"Retrying will not clear it: the same fault runs again until we
fix it."*, and `fix[0]` repeats it as *"running the same action again will not clear it."* That is a
prediction about behaviour, and this phase's own rule for picking a member is stated at
`wizardErrors.ts:481-486`: *"take the MOST SPECIFIC member every one of whose claims is true at EVERY
emitter."* Applying that rule to this clause across the three wire codes the member homes:

- `MT5_GATEWAY_UNCONFIGURED` — true at all four emitters (unset env, malformed port, IPC-ordering
  inversion, D-31 terminal-trade-permission-off). All are operator faults.
- `ADAPTER_INIT_FAILED` — the emitter's own comment
  (`analytics-service/routers/exchange.py:1084`) enumerates the causes as *"a ccxt signature change,
  an ImportError on a missing extra or an **OOM**"*. An OOM clears on retry. The clause is false in
  that third of the emitter's own declared cause set.
- `INTERNAL` — `exchange.py:1126-1142` is the *unclassified residue* of `validate_key_permissions`:
  `except Exception`, after the `ccxt.BaseError` arm. Its content is open by construction, so
  "the same fault runs again" is not knowable — it is exactly the shape `DRAFT_FINALIZE_FAILED`
  (three screens up in the same file) was careful **not** to assert about its own generic tail.

This is the same "true at three of four emitters" defect the member was minted to avoid, reappearing
one clause down. Note the `recoverable: false` **derivation itself is defensible** — all three wire
codes are `retryable=False` at the emitter and the seam honours the producer's flag everywhere. Only
the copy over-claims.

**Fix:** Soften the prediction to match what the flag actually says, e.g.:

```ts
    cause:
      "The check stopped on a fault in our own service — not in your key, your exchange or your data. We never store a key we could not check, so no key was stored. The service marked this fault as one a retry will not clear, so we are not offering one.",
    fix: [
      "Email security@quantalyze.com with the correlation id below. A fault in our own service is ours to fix.",
      "Nothing needs undoing on your side. Your key was not stored.",
    ],
```

The "no key was stored" half is measured and should stay verbatim — I confirmed `validateKey`
precedes `encryptKey` and the create RPC on both routes, and the new route tests pin it with
`expect(encryptKeyMock).not.toHaveBeenCalled()` / `expect(rpcMock).not.toHaveBeenCalled()`.

---

### WR-02: three OUR-OWN-DEFECT wire codes silently leave the Next-side Sentry population, against the routes' stated policy

**File:** `src/lib/wizardErrors.ts:3057,3063,3064` → consumed at
`src/app/api/strategies/create-with-key/route.ts:1169` and
`src/app/api/strategies/composite/add-key/route.ts:681`

**Issue:** Both key routes fire `captureToSentry(..., step: "unclassified-key-error")` **iff**
`code === "UNKNOWN"`. Before this phase, `MT5_GATEWAY_UNCONFIGURED`, `ADAPTER_INIT_FAILED` and
`INTERNAL` all resolved to `UNKNOWN` and therefore paged. The three new verdict rows move them out
of that arm, and the new route test asserts the silence (`await expectNoCapture()`).

That is *stated as intentional* for classified codes — but the route's justification
(`create-with-key/route.ts:1161`) reads: *"Everything the classifier DID recognise is excluded for
free and for the policy's own reasons: `SERVICE_UNAVAILABLE_RETRY` is the breaker short-circuit,
`KEY_NETWORK_TIMEOUT` the timeout, and every `KEY_INVALID_SIGNATURE` / `KEY_AUTH_FAILED` / `KEY_MT5_*`
verdict is a caller fault. **None is our defect and none should page anyone.**"* `INTERNAL` and
`ADAPTER_INIT_FAILED` are, by the Python emitter's own words, *ours* — `INTERNAL` is literally the
unclassified-exception escape. So the phase widened the recognised set past the boundary that
policy sentence draws, without amending the sentence.

Mitigating (measured, so this is a warning not a blocker): `analytics-service/sentry_init.py:356`
calls `sentry_sdk.init` without `default_integrations=False`, so `LoggingIntegration` still turns
the `logger.exception(...)` at both emitters into a Sentry event on the Python project. The loss is
the Next-side event with its `surface` / `exchange` tags, not all observability.

**Fix:** Either amend the policy comment at both routes to name the newly-excluded our-defect codes
and say why the Python-side capture suffices, or widen the capture predicate to an explicit
our-defect set rather than the `UNKNOWN` proxy:

```ts
const OUR_DEFECT_CODES = new Set<WizardErrorCode>(["UNKNOWN", "SEAM_INTERNAL_FAULT"]);
if (OUR_DEFECT_CODES.has(code)) {
  captureToSentry(err, { /* … unchanged … */ });
}
```

---

### WR-03: the widened scanner is blind to a module-qualified emitter call — the same fail-open class this phase closed for the root and the shape

**File:** `src/lib/seam-venue-vocabulary.invariant.test.ts:323-326`

**Issue:** `CALLEE_CALL_RE` opens with `(?<![A-Za-z0-9_.])`. The `.` in that lookbehind is there to
reject `def`/attribute noise, but it also rejects a legitimate qualified call —
`error_contract.service_error(500, "NEW_CODE", …)` or `errors.VenueTransientHTTPException(code=…)`.
Such a site yields **no site at all**, not a literal-less site, so it does not even land in
`dynamicishByFile`. Every disposition/fossil/exclusivity check in the file is an *absence*
assertion, so a code introduced only that way is invisible and nothing reds — which is precisely the
failure mode the docblock at `:640-654` names as the reason the reach pin exists.

Measured today: zero qualified calls in `analytics-service/**` outside `tests/`
(`grep -rnE "[A-Za-z0-9_]\.(service_error|service_error_body|service_error_response|VenueTransientHTTPException)\s*\("`
returns nothing), and the hand-typed roster still catches a *departing* code. So this is latent,
not live.

**Fix:** Admit the qualified form and keep the `def`/`class` guard doing the rejecting (it already
handles both keywords at `:459-465`):

```ts
const CALLEE_CALL_RE = new RegExp(
  `(?<![A-Za-z0-9_])(?:[A-Za-z_]\\w*\\s*\\.\\s*)?(${[...CALLEE_ARG_SLOT.keys()].join("|")})\\s*\\(`,
  "g",
);
```

…with a self-test fixture beside the existing ones asserting
`scanFixture('raise error_contract.service_error(500, "QUALIFIED_CODE")')` yields
`["QUALIFIED_CODE"]`. If it is instead judged out of scope, record it as a declared blind spot in
the same style as the `csv_adapter.py` dynamic emitter, so it is asserted rather than merely absent.

---

### WR-04: `MT5_GATEWAY_UNREACHABLE`'s server-advertised `Retry-After` is discarded, now that the code renders a recoverable envelope

**File:** `src/lib/wizardErrors.ts:3058`; drop sites
`src/lib/analytics-client.ts:150-174` and `src/app/api/strategies/create-with-key/route.ts` /
`composite/add-key/route.ts` (`headers` computation in the catch)

**Issue:** `analytics-service/routers/exchange.py:626-634` raises `MT5_GATEWAY_UNREACHABLE` with
`retry_after=RETRY_AFTER_SECONDS["mt5-gateway"]`. `AnalyticsUpstreamError` carries `status`,
`seamCode` and `dependency` but no retry-after field, and both key routes stamp `Retry-After` only
for `err instanceof CircuitOpenError`. So `parseRetryAfterSeconds(res.headers)` in
`ConnectKeyStep`/`MultiKeyConnectStep` resolves `null` and the envelope renders no wait — the user
gets a Retry control with no advertised interval and will hammer a gateway that told us how long to
wait.

This is **pre-existing** and is exactly the gap `src/__tests__/contracts/REGISTRY.md` already
records as *"coverage-law row 3 and nothing guards its completeness"*. It is listed here only
because 153.7 is what makes this code resolve to a recoverable envelope for the first time, so the
missing wait is now reachable rather than theoretical.

**Fix:** Out of scope for this phase — log to `TODOS.md` beside the two deferrals the phase already
recorded. The shaped fix is a fourth optional constructor arg on `AnalyticsUpstreamError` fed from
the nested envelope's `retry_after`, relayed by both key-route catches the same way
`CircuitOpenError.retryAfterS` already is.

---

## Checked and clean (recorded so the next reviewer does not re-derive it)

- `VENUE_WIRE_CODE_TO_VERDICT` is read from `err.seamCode` **after** the `CircuitOpenError` type
  check and **before** the substring cascade (`wizardErrors.ts:3352-3380`); no `??` fallback, so an
  unlisted code still falls through rather than short-circuiting to `UNKNOWN`. Ordering intact.
- The `SEAM_MISCONFIGURED` verdict rows (`EGRESS_PROXY_MISCONFIGURED`, `SERVICE_KEY_UNCONFIGURED`,
  `KEK_UNAVAILABLE`) genuinely need **no** roster edit: `ConnectKeyStep.tsx:896` runs
  `recogniseSeamErrorCode(seamErrorCode(data))` first and `SEAM_CODE_TO_WIZARD_CODE` carries
  `["SEAM_MISCONFIGURED", "SEAM_MISCONFIGURED"]` (`wizardErrors.ts:3594`). The docblock's claim is
  accurate, not assumed.
- All eight new wire codes reach the classifier as `seamCode`: `analytics-client.ts:557-561` reads
  both the nested `service_error` envelope and the flat shape through `seamErrorCode(error)`, and
  `main.py:779` emits `SERVICE_KEY_UNCONFIGURED` via `service_error_response`, which is the nested
  shape.
- No new `vi.stubGlobal`. The three new `finalize-wizard` cases use `vi.spyOn(console, "error")` with
  an explicit `mockRestore()`, and the file's `afterEach` runs `vi.restoreAllMocks()`. Node 22 safe.
- `STATE` is fully reset in `beforeEach` (`route.test.ts:546-585`) including `processKeyResult`,
  `rpcResult`, `strategyError` and `captureToSentryCalls`, so the three new cases cannot leak.
- No secrets, credentials or `venue_account_id` reach any new copy string, log line or response
  body. The new `finalize-wizard` cases assert the negative directly
  (`expect(JSON.stringify(body)).not.toContain("connection reset")` /
  `not.toContain("oops at line 42")`).
- `src/lib/resilient-fetch.ts` is comment-only in this range; the counting-`503` set is unchanged
  and the two arrivals are both `500`s, so no breaker key moved.
- DESIGN.md conformance: all four new titles are declarative, sentence-case, active-voice and
  carry no adjective where a fact belongs. No emoji reach a copy string (the `⭐ ⛔ ⚠️` glyphs are
  confined to comments, matching the file's existing convention). `docsHref` values reuse existing
  anchors.

## Already-accepted, not re-reported

W-153.7-1 (unguarded `KNOWN_CREATE_WITH_KEY_CODES` last hop), W-153.7-2 (stale roster docblock
pointer), W-153.7-3 (coverage-law row 1 enumerates three Next route files), W-153.7-4
(`REQUIREMENTS.md` vs measured `PROBE_FAILED`).

---

_Reviewed: 2026-08-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

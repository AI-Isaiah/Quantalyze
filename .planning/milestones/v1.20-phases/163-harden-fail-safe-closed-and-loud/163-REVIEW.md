---
phase: 163-harden-fail-safe-closed-and-loud
reviewed: 2026-08-26T00:00:00Z
depth: standard
files_reviewed: 63
files_reviewed_list:
  - analytics-service/main.py
  - analytics-service/main_worker.py
  - analytics-service/routers/process_key.py
  - analytics-service/routers/simulator.py
  - analytics-service/services/logging_config.py
  - analytics-service/services/mt5_client.py
  - analytics-service/tests/test_limiter_identity.py
  - analytics-service/tests/test_limiter_route_coverage.py
  - analytics-service/tests/test_process_key.py
  - analytics-service/tests/test_resync_draft_dedup.py
  - analytics-service/tests/test_resync_precheck_determinism.py
  - analytics-service/tests/test_simulator_router.py
  - analytics-service/tests/test_stdlib_redact_bridge.py
  - analytics-service/tests/test_structlog_frozen_proxy.py
  - scripts/check-planning-hygiene.ts
  - src/__tests__/audit-coverage.test.ts
  - src/__tests__/check-planning-hygiene.test.ts
  - src/__tests__/observ12-fixtures-presence.test.ts
  - src/app/(dashboard)/portfolios/[id]/page.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
  - src/app/api/account/deletion-request/route.test.ts
  - src/app/api/account/deletion-request/route.ts
  - src/app/api/bridge/route.test.ts
  - src/app/api/bridge/route.ts
  - src/app/api/cron/flag-monitor/route.test.ts
  - src/app/api/cron/flag-monitor/route.ts
  - src/app/api/portfolio-optimizer/route.test.ts
  - src/app/api/portfolio-optimizer/route.ts
  - src/app/api/preferences/route.test.ts
  - src/app/api/preferences/route.ts
  - src/app/api/strategies/csv-finalize/route.test.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/components/auth/ResetPasswordForm.tsx
  - src/components/auth/SignupForm.tsx
  - src/components/portfolio/CompositionDonut.test.tsx
  - src/components/portfolio/CompositionDonut.tsx
  - src/components/portfolio/StrategyBreakdownTable.test.tsx
  - src/components/portfolio/StrategyBreakdownTable.tsx
  - src/components/strategy/StrategyGrid.tsx
  - src/components/strategy/StrategyHeader.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/SyncBadge.staler-of-two.test.tsx
  - src/components/strategy/SyncBadge.tsx
  - src/lib/auth/password-policy.test.ts
  - src/lib/auth/password-policy.ts
  - src/lib/freshness.ts
  - src/lib/observability.test.ts
  - src/lib/observability.ts
  - src/lib/queries.test.ts
  - src/lib/queries.ts
  - src/lib/ratelimit.ts
  - src/lib/resilient-fetch.retry.test.ts
  - src/lib/resilient-fetch.ts
  - src/lib/seam-ratelimit-posture.invariant.test.ts
  - src/lib/types.ts
  - src/lib/utils.ts
  - supabase/migrations/20260517013000_revoke_probe_oracle_assert_strategy_visible_to_allocator.sql
  - supabase/migrations/20260517013100_sanitize_user_recipient_email_case_insensitive.sql
  - supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql
  - supabase/tests/test_enqueue_internal_destrict.sql
  - tests/integration/cron-flag-monitor.test.ts
findings:
  critical: 2
  warning: 11
  info: 6
  total: 19
status: issues_found
---

# Phase 163: Code Review Report

**Depth:** standard
**Files Reviewed:** 63 source/test files (the ~115 docs-only scrub files were excluded per the scope note)
**Status:** issues_found

## Summary

This is unusually careful work. The anti-vacuity discipline is real and mostly load-bearing:
the SQL gate's needle was correctly de-coupled from the `v_` naming habit, the comment-strip
closes a demonstrated green-wash hole in both plpgsql comment syntaxes, the seam limiter
identity pin was added after MEASURING that the existing roster could not see the swap, and
the `resilient-fetch` spy-suppresses-`unhandledRejection` catch is exactly the class this
project's rules exist for. Several SUMMARY-recorded plan deviations are corrections that made
the code better than the plan.

The defects below are concentrated in three places:

1. **OPS-05 is not closed at both failure modes.** The stdlib redaction bridge does not scrub
   non-string `%`-arguments at all, and there are live ccxt call sites that log a bare
   exception object as `%s` on the venue-credential path. That is precisely the HMAC leak the
   `_redact_log_record_factory` docstring names as its reason for existing. Separately, the
   new template-revert path restores an unredacted `key=%s` template whose argument the
   value-scrub cannot redact — and the phase's own regression test pins the plaintext value
   appearing in the output.
2. **SEC-02 did not reach zero.** The scrub took 95 files to zero occurrences, then two new
   tracked files were added carrying the local username base64-encoded. The gate's success
   message is literally false of the tree it just scanned.
3. **Several fixes are point-fixes of a class the phase claims to close.** The flag-monitor's
   numerator failure arms still return HTTP 200; the SQL recurring gate cannot distinguish
   "not yet applied" from "reverted after apply"; the Mode A AST gate only walks direct
   module-body assignments.

Everything else is either a claim-vs-code accuracy problem in the SUMMARY/comment prose or a
small edge-case defect.

### Coverage statement (be able to check my work)

**Read carefully, in full or near-full:**
`analytics-service/services/logging_config.py`, `analytics-service/main.py`,
`analytics-service/main_worker.py`, `analytics-service/routers/simulator.py`,
`analytics-service/routers/process_key.py`, `analytics-service/services/mt5_client.py`,
`analytics-service/services/redact.py` (context, unchanged),
`analytics-service/services/rate_limit.py` (context, unchanged),
`supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql`,
`supabase/tests/test_enqueue_internal_destrict.sql`, the prior 10-param body in
`supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql` (line-by-line
transcription check — the "verbatim except two changes" claim is TRUE),
both applied-migration comment edits, `scripts/check-planning-hygiene.ts`,
`src/__tests__/check-planning-hygiene.test.ts`, `src/lib/freshness.ts`, `src/lib/utils.ts`,
`src/lib/types.ts`, `src/lib/queries.ts`, `src/lib/ratelimit.ts`, `src/lib/observability.ts`,
`src/lib/resilient-fetch.ts`, `src/lib/auth/password-policy.ts`,
`src/lib/auth/password-policy.test.ts`, `src/components/strategy/SyncBadge.tsx` and all five
of its mounts, both portfolio components, all six changed `route.ts` files, the `doRemove`
region of `MultiKeyConnectStep.tsx`, `src/__tests__/observ12-fixtures-presence.test.ts`.

**Skimmed (diff hunks + structure, not every assertion):**
`src/components/strategy/SyncBadge.staler-of-two.test.tsx` (first ~120 lines read in full,
table/grid mount cases read as diff), `analytics-service/tests/test_structlog_frozen_proxy.py`
(the ordering gate and both Mode A helpers read in full; the Mode B subprocess harness
skimmed), `analytics-service/tests/test_stdlib_redact_bridge.py` (the two new cases read in
full), `analytics-service/tests/test_resync_precheck_determinism.py` (docstring + harness),
`analytics-service/tests/test_limiter_identity.py` (grep-level: quarantine, class size, gate
names), `src/lib/seam-ratelimit-posture.invariant.test.ts` (diff),
`tests/integration/cron-flag-monitor.test.ts` (diff),
`src/__tests__/audit-coverage.test.ts` (diff),
`src/app/factsheet/[id]/v2/FactsheetView.tsx` (only the `bucketByAge` hunk).

**Not opened at all — silently counted as clean, and that is the risk:**
`analytics-service/tests/test_limiter_route_coverage.py`,
`analytics-service/tests/test_process_key.py`,
`analytics-service/tests/test_resync_draft_dedup.py`,
`analytics-service/tests/test_simulator_router.py`, all six changed
`src/app/api/**/route.test.ts` files, `src/components/portfolio/CompositionDonut.test.tsx`,
`src/components/portfolio/StrategyBreakdownTable.test.tsx`,
`MultiKeyConnectStep.test.tsx`, `src/lib/queries.test.ts`, `src/lib/observability.test.ts`,
`src/lib/resilient-fetch.retry.test.ts`. Their vacuity was assessed only through the
SUMMARY-recorded mutation ledgers, which is second-hand evidence.

---

## Critical Issues

### CR-01: The stdlib redaction bridge never scrubs non-string `%`-args — live ccxt sites leak the signed request URL

**File:** `analytics-service/services/logging_config.py:167-198` (the `record.args` loop),
with live call sites at `analytics-service/services/key_permissions.py:133`, `:165`, `:213`
and `analytics-service/routers/exchange.py:1344`.

**Issue:** `_scrub_record_in_place` scrubs `record.args` only for members that satisfy
`isinstance(v, str)`. Every other value is left untouched and is rendered later by
`record.getMessage()` — i.e. `str(v)` runs at handler time, AFTER the redaction pass has
finished. The phase installs this factory on a second entrypoint and closes OPS-05 with
coverage claim D1: *"a denylisted value logged there renders as `[REDACTED]`, not plaintext."*
That claim is false for any argument that is not already a `str`.

`_redact_log_record_factory`'s own docstring names the leak it exists to stop:
`logger.warning("ccxt: %s", str(exc))`. Note the explicit `str()` — with it the argument is a
string and IS scrubbed. The repo has at least four non-test sites that omit it:

- `services/key_permissions.py:133` — `logger.warning("Binance permission probe failed: %s", exc)`
  where `exc` is whatever escapes `await exchange.sapi_get_account_apirestrictions()`, a
  **signed private ccxt call**.
- `services/key_permissions.py:165` (OKX), `:213` (Bybit) — identical shape.
- `routers/exchange.py:1344` — `logger.warning("fetch-trades clamp probe failed: %s", e)`.

**Failure scenario:** a user connects a Binance key with a clock skew or a restricted IP. ccxt
raises `AuthenticationError` whose message embeds the full signed request, including
`&timestamp=…&signature=<HMAC>` and, on some ccxt versions, the `X-MBX-APIKEY` header echo.
`_scrub_record_in_place` sees `record.args = (<AuthenticationError object>,)`, finds no `str`
member, and skips the whole comprehension. The handler then formats the record and the HMAC
signature — derived directly from the user's API secret — reaches the log sink verbatim, on
whichever process ran the probe. `exc_text`/`stack_info` scrubbing does not help: this is a
positional argument, not `exc_info`.

**Minimal fix:** scrub the RENDERED message rather than the pieces. Replace the msg/args
branch with:

```python
# One pass, after formatting: covers non-str args, bare values with no
# key= shape, and eliminates the %-template-eating problem entirely.
try:
    rendered = record.getMessage()
except Exception:  # noqa: BLE001 — a broken template is stdlib's problem, not ours
    rendered = None
if rendered is not None:
    scrubbed = scrub_freeform_string(rendered)
    if scrubbed != rendered:
        record.msg = scrubbed
        record.args = None      # already interpolated; do not re-format
```

This also subsumes CR-02 and the whole `scrubbed_msg % record.args` probe. If that is too
large a change for this phase, the narrow version is to coerce non-`str` args:
`scrub_freeform_string(v) if isinstance(v, str) else scrub_freeform_string(str(v))` — but only
for args whose format spec is `%s`/`%r`, otherwise `%d`/`%f` break. The rendered-message
approach avoids that trap.

---

### CR-02: The template-revert path emits an unredacted `key=value` line the arg-scrub cannot cover — pinned as expected behaviour by the phase's own test

**File:** `analytics-service/services/logging_config.py:135-166`; test at
`analytics-service/tests/test_stdlib_redact_bridge.py:333-374`.

**Issue:** The Rule-1 deviation fix is: if scrubbing a `%`-template breaks its conversion
specifiers, keep the ORIGINAL template. The comment asserts the safety property as an
invariant — *"Nothing leaks by doing so — `record.args` (the values, i.e. the only
attacker/venue-controlled part) is scrubbed independently just below."* That sentence is not
true of the scrubber this code calls.

`scrub_freeform_string` (`analytics-service/services/redact.py:239-276`) has a fast path that
returns unchanged for any string containing none of `:`, `=`, `.`, and past it, `Pass 1` only
matches `SENSITIVE_KEY_VALUE`, i.e. a denylisted key **adjacent to** its value. A bare secret
value passed as an argument matches nothing. So the composition is:

1. template `"… api_key=%s …"` → scrub rewrites `api_key=%s` to `api_key: [REDACTED]`, eating
   a placeholder;
2. `scrubbed_msg % record.args` raises → the ORIGINAL `api_key=%s` is restored;
3. the value arg is passed to `scrub_freeform_string` alone, where it matches nothing;
4. the emitted line is `api_key=<raw value>`.

The phase's own regression test asserts step 4 explicitly:
`for expected in ("job-1", "done", "tok-abc123", "worker-7"): assert expected in out`. The
`claim_token` value renders in plaintext, and the test's docstring justifies it with the same
false invariant.

**Failure scenario:** today's three templates carry row ids and a fencing nonce, so nothing
sensitive escapes. The defect is that the mechanism is now "any
`<denylisted-key>=%s` template emits its argument verbatim", it is documented as safe, and it
is pinned green by a test. The moment anyone writes
`logger.warning("venue rejected api_key=%s for %s", key, strategy_id)` — a shape the redactor
is specifically supposed to catch, and which reads as obviously safe next to that comment —
the credential is logged in full. Before this change the same record was dropped (fail-quiet,
no disclosure); after it, it is emitted (fail-loud, with disclosure). The direction of the
regression is toward exposure.

**Minimal fix:** the same rendered-message scrub as CR-01. Failing that, correct the comment
and the test docstring to state the actual property — *"a template's placeholders are
restored; the ARGUMENT is only redacted if it independently matches a key=value / URL /
JWT shape, which a bare credential does not"* — and add a `⛔` rule that no `%`-template may
spell a denylisted key adjacent to a placeholder. The three existing templates
(`main_worker.py:581`, `services/equity_reconstruction.py:1611`,
`services/job_worker.py:1389`) should then be rephrased, which the SUMMARY already lists as an
unfiled follow-up.

---

## Warnings

### WR-01: SEC-02 ends with the local username still published in two tracked files, base64-encoded

**File:** `scripts/check-planning-hygiene.ts:95` and
`src/__tests__/check-planning-hygiene.test.ts:33`.

**Issue:** Both files construct the needle as `Buffer.from("<base64>", "base64").toString()`,
which decodes to the 13-character macOS username. The encoding exists so the scanner passes
its own scan without a path allowlist — which it does — but it does not remove the
disclosure. The requirement's stated deliverable is *"a tracked tree with zero username /
absolute-home-path occurrences"* and the gate's own success line reads *"none carry the local
username or an absolute home path."* Both statements are false of the repository the gate just
walked.

**Failure scenario:** anyone with the public clone runs one command against
`scripts/check-planning-hygiene.ts`, decodes the literal, and recovers the founder's macOS
username — the exact metadata the 95-file, ~940-occurrence scrub was performed to remove. The
scrub reduced the count from ~940 to 2 and then declared 0.

**Why WARNING and not BLOCKER:** the CONTEXT explicitly prices this as metadata, not a
credential, and the redaction is forward-only by founder decision — the username is already in
published history. Per the standing stopping rule this is neither user-facing nor a
data-integrity risk. It is filed because the requirement's completion claim is not true as
written.

**Minimal fix:** derive the needle at runtime instead of committing it. Either

```ts
// The needle is the machine's own username — never committed.
const USERNAME = process.env.HYGIENE_LOCAL_USERNAME ?? os.userInfo().username;
```

(with an explicit `EMPTY-NEEDLE` failure if it resolves to something implausibly short), or
keep Rules 2/3 (which are already structural and username-agnostic) and DROP Rule 1 entirely —
Rules 2 and 3 already catch every home-path form, and Rule 1 is the only rule that requires
knowing the name. If neither is acceptable, amend the SEC-02 entry and the gate's success
message to say "2 encoded occurrences remain, by design" rather than "none".

### WR-02: OPS-07 fixed one of three blind-monitor arms — the Sentry read failures still log a GREEN cron run

**File:** `src/app/api/cron/flag-monitor/route.ts:148`, `:169-180`, `:481` (vs. the fixed
denominator arms at `:361` and `:379`).

**Issue:** `denominatorReadFailed()` was introduced because *"Vercel's cron history keys 'did
this run succeed?' off the status code, so a persistent Supabase read failure logged a green
run every 15 minutes forever."* The identical mechanism survives untouched on the NUMERATOR,
in the same file:

- `:148` — `sentry fetch threw` → `NextResponse.json({ ok: false, reason: "sentry_unreachable" })`, default **200**.
- `:169-180` — non-ok Sentry response (`sentry_rate_limited` / `sentry_unreachable`) → default **200**.
- `:481` — `SENTRY_ORG_SLUG` / `SENTRY_AUTH_TOKEN` missing → `{ ok: false, reason: "sentry_not_configured" }`, default **200**.

**Failure scenario:** the Sentry auth token is rotated or expires. Every 15 minutes the cron
fetches, gets 401, returns 200 with `reason: "sentry_unreachable"`, and Vercel's cron history
shows a green run. The `/process-key` error-rate monitor is dead and the dashboard says it is
healthy — the exact state OPS-07's success criterion ("monitors cannot report false health")
forbids. A token expiry is materially more likely than the Supabase read failure that WAS
fixed.

**Minimal fix:** route all three numerator terminal arms through the same helper. It already
takes an arbitrary detail string:

```ts
// :148
return await monitorReadFailed("sentry fetch threw", { error: String(err) });
```

rename `denominatorReadFailed` → `monitorReadFailed`, parameterise the `reason` and the Sentry
tag, and apply it at `:148`, `:180` and `:481`. `sentry_not_configured` arguably deserves a
different treatment (a missing env var is a deploy defect, not a transient), but 200 is wrong
for it too.

### WR-03: The portfolio-optimizer 5xx refund resets the WHOLE hourly bucket, defeating the compute cap it was just given

**File:** `src/app/api/portfolio-optimizer/route.ts:149-157`.

**Issue:** `Ratelimit.resetUsedTokens(identifier)` clears the identifier's entire window, not
one token. That was tolerable against `userActionLimiter` (5/60s — the window self-heals in a
minute anyway). Against `bridgeComputeLimiter` (10/3600s) a single refund returns up to ten
tokens and up to an hour of budget. The new limiter's own docblock states its purpose as
*"Without a compute-sized cap an authenticated caller can hold the single analytics replica
busy far past the backend's own budget, degrading every other tenant on it"* — and the refund
is the escape hatch from exactly that.

**Failure scenario:** the analytics service is degraded and returns 504s. An authenticated
caller loops `POST /api/portfolio-optimizer`. Every call consumes one token, fires the ~15s
Python round-trip, times out, and then resets the caller's whole bucket to zero used. The
front door never denies, and the caller sustains unbounded 15s round-trips against a single
replica that is already unhealthy. The refund's stated intent — "don't burn a legitimate
user's budget on a deterministic upstream failure" — is served by refunding ONE token, not by
zeroing the window.

**Minimal fix:** stop using `resetUsedTokens` for a single-token refund. Either cap the refund
(track a per-request `refunded` flag and refund at most once per request, which is already the
case, but bound the number of refunds per window), or accept the token spend on the 5xx path
and document it, or switch to a limiter primitive that supports a decrement. The cheapest
correct change is to gate the refund on a per-key counter:

```ts
// At most one bucket-reset per window per key, or an outage becomes a bypass.
if (await alreadyRefundedThisWindow(rateLimitKey)) return;
```

### WR-04: The recurring SQL gate cannot tell "not yet applied" from "reverted after apply"

**File:** `supabase/tests/test_enqueue_internal_destrict.sql:264-272` (the `ELSIF v_strict10 >
0` arm).

**Issue:** Part 1+3 treats `strict re-reads present AND no serialization_failure raise` as the
coherent pre-apply state and answers `RAISE NOTICE 'SKIP (Part 3)'` with exit 0. That shape is
byte-identical to a full regression: once `20260826150000` has been applied to a project, a
later `CREATE OR REPLACE` re-based on the stale `20260716090000` definition puts the body back
into exactly that state, and the gate reports SKIP and passes.

**Failure scenario:** six months from now someone extends `_enqueue_compute_job_internal`,
grabs `20260716090000` as the base (the newest file that *contains a full body*, which is what
the re-base rule tells them to do — and the new migration is a `CREATE OR REPLACE` of the same
signature, so it wins), and lands it. PROD returns to raising `P0002 NO_DATA_FOUND` on every
lost race and surfacing opaque 500s. `sql-tests` prints `SKIP (Part 3) … 4 strict lost-race
re-read(s)` and exits 0. CI is green. Part 4 (the 7-param parity pin) does not fire, because
the 7-param body was not touched. This is precisely the drift Part 4 exists to catch, applied
to the overload Part 4 does not cover.

**Minimal fix:** make the pre-apply arm one-way. Once the migration has landed, the database
carries the evidence — assert on the catalog, not on the body:

```sql
-- Post-apply is DETECTABLE: 20260826150000 rewrites the COMMENT.
IF v_strict10 > 0
   AND obj_description(v_oid10, 'pg_proc') LIKE '%Phase 163 OPS-08%' THEN
  RAISE EXCEPTION 'OPS-08 Part 1+3 FAILED: the 10-param body carries % strict lost-race re-read(s) but its catalog COMMENT records the OPS-08 fix — this is a REVERT, not a pre-apply database.', v_strict10;
END IF;
```

(the migration already refreshes that COMMENT, so the signal is free). Any equivalent
post-apply marker works; the property needed is that the SKIP arm can only be reached on a
database that has never received `20260826150000`.

### WR-05: The Mode A `.bind()` gate walks only direct module-body assignments — the shapes a real author writes are invisible to it

**File:** `analytics-service/tests/test_structlog_frozen_proxy.py:501-528` (`_module_scope_binds`).

**Issue:** the walk iterates `tree.body` and inspects only `ast.Assign` / `ast.AnnAssign`
nodes whose `value` is directly `<expr>.bind(...)`. The gate is documented as having "NO
allowlist" and as pinning a security property, but it pins a syntactic shape. Not detected:

- a bind inside a module-scope `try:` / `if` / `with` block (still module scope, still frozen
  at import time, but nested one level below `tree.body`);
- `_log = wrap(structlog.get_logger().bind(...))` — the `value` is a call to `wrap`;
- `_LOGGERS = [structlog.get_logger().bind(...)]` or a dict/tuple literal;
- a bind inside a module-scope `for` loop.

The same file's SQL sibling was criticised — correctly — for pinning "this codebase's NAMING
HABIT rather than the dangerous construct". This is the same failure in the Python gate.

**Failure scenario:** an author adds

```python
try:
    _stage = structlog.get_logger("mt5").bind(component="mt5")
except Exception:
    _stage = structlog.get_logger("mt5")
```

at module scope in `services/mt5_client.py` — a plausible defensive shape. The object is a
concrete `BoundLogger` built from the unconfigured default chain, permanently unredacted for
the life of the process, on the module the phase names as an MT5-password surface. The gate
reports `0` violations and passes.

**Minimal fix:** walk the whole tree and reject binds that are not inside a function body:

```python
for node in ast.walk(tree):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
       and node.func.attr == "bind" and not _inside_function(node, tree):
        violations.append(f"{rel}:{node.lineno}")
```

where `_inside_function` is computed once by tagging every `FunctionDef`/`AsyncFunctionDef`
subtree. That pins the property (a bind evaluated at import time) rather than the assignment
shape.

### WR-06: A future-dated series end renders a red dot beside "just now", and disagrees with the factsheet chip on the same input

**File:** `src/lib/freshness.ts:107-115` (`bucketSeriesAge`), rendered at
`src/components/strategy/SyncBadge.tsx:21-30` (`timeAgo`) and `:104-107`.

**Issue:** three pieces interact badly on a future `seriesEnd`:

- `bucketSeriesAge` maps `days < 0` to `"stale"`, so the series verdict is the worst possible
  and always binds.
- `timeAgo` computes `Math.floor((Date.now() - date.getTime()) / 1000)`; for a future date
  that is negative, `seconds < 60` is true, and it returns `"just now"`.
- `bucketByAge` in `src/app/factsheet/[id]/v2/FactsheetView.tsx:900` maps the same `days < 0`
  to `"future"` (neutral), NOT to a staleness tone.

**Failure scenario:** an MT5 broker on UTC+3 stamps a daily bar with tomorrow's calendar date
near 22:00 UTC. The strategy's discovery row renders a **negative (red) dot** with the copy
**"Track record ends just now"** — a self-contradicting badge — while the same strategy's
factsheet chip renders `Track record · future` in neutral tone. Two public surfaces
disagreeing about one strategy's freshness is the defect HONEST-08 was created to close, and
this is a new instance of it on the boundary the shared ladder does not actually share.

**Minimal fix:** give the resolver the chip's `future` semantics rather than inventing a
second rule, and make `timeAgo` refuse to describe a future date:

```ts
// freshness.ts — mirror bucketByAge: a future point is suspicious, not stale.
if (!Number.isFinite(days)) return "stale";
if (days < 0) return "warm";   // neutral/questionable, same rank as `unknown`
```

```ts
// SyncBadge.tsx
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 0) return "in the future";
  …
```

Add a case to `SyncBadge.staler-of-two.test.tsx` for `seriesEnd={agoIso(-2 * DAY)}`.

### WR-07: The OPS-08 raise message lands verbatim in a user-visible column, which the migration's own comment identifies and does not fix

**File:** `supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql:275-296`;
sink at `src/app/api/strategies/csv-finalize/route.ts:2033-2037` →
`writeFailedStrategyAnalyticsPlaceholder` → `strategy_analytics.computation_error` (written at
`:1928`).

**Issue:** the migration raises
`'enqueue race lost: the winning job already advanced past the in-flight statuses'`. The
comment above it correctly identifies that csv-finalize interpolates the raw PostgREST message
into a user-visible column, and concludes that the remedy is to make the message SHORT. Short
is not the property that matters — the property is *not operator jargon*. Phase 162 /
HONEST-01 shipped a curated-copy bridge one day earlier specifically so raw failure text stops
reaching this surface, and this path bypasses it.

**Failure scenario:** a CSV finalize loses an enqueue race. `enqueueErrMessage` becomes the
PostgREST rendering of the 40001, and `computation_error` is set to
`compute job enqueue failed: enqueue race lost: the winning job already advanced past the
in-flight statuses`. The strategy's own owner sees that string as the explanation for why
their upload did not compute. It names an internal queue concept, an internal race, and an
internal status vocabulary, and tells them nothing actionable.

**Why WARNING and not BLOCKER:** the pre-fix text was `query returned no rows` (P0002), which
is equally operator-facing and less informative. This is a missed opportunity on a
pre-existing surface, not a regression.

**Minimal fix:** either map SQLSTATE `40001` to curated copy at the csv-finalize sink before
it reaches `computation_error` —

```ts
const computationError = isSerializationFailure(err)
  ? "Your analytics run collided with another job and will retry automatically."
  : `compute job enqueue failed: ${enqueueErrMessage}`;
```

— or route that call through the HONEST-01 curated-copy bridge, which is the durable fix and
already exists.

### WR-08: `main_worker.py` now contains two contradictory claims about whether production runs it

**File:** `analytics-service/main_worker.py:63-89` (new OPS-05 block) vs. `:1225-1234`
(pre-existing, unchanged).

**Issue:** the new block states *"THIS process — the one that runs ccxt long-fetch and MT5
sync — emitted every line through structlog's DEFAULT chain … it is an unconditional leak of
every line the worker writes"*. Eleven hundred lines below, in the same file, the pre-existing
comment states, with a date and a verification note: *"⚠️ DO NOT read this as 'production was
unalerted before Phase 143' — it was NOT. Verified 2026-08-17: PRODUCTION DOES NOT RUN THIS
ENTRYPOINT. There is no separate worker service and has not been since April — the loops were
merged into the FastAPI process."* Plan 02's own PROD measurement independently confirms this
(`Worker starting as worker-<id> (merged into API)`).

`163-01-SUMMARY.md` headlines the change as *"Closed the live secret-exposure path on the
worker"* and *"the live worker leak first"*. On the production path there was no such leak:
the compute loops run inside `main.py`, which has called `configure_logging()` since Phase 16.
The change is correct and worth making — it closes the standalone and re-split paths — but it
is preventive, not corrective, and the record says otherwise.

**Failure scenario:** a future reader triaging a credential-disclosure incident reads the new
block, concludes production logs were unredacted before 2026-08-26, and scopes an incident
response (key rotation for every connected venue key, log-drain purge) that the facts do not
support. The same reader ten lines further down would have learned the opposite.

**Minimal fix:** add one sentence to the new block, quoting-and-refuting in this file's own
house style:

```
# ⚠️ SCOPE: production does NOT run this entrypoint — the loops are merged into
# the FastAPI process (see the JOB-04 note in main()). This closes the STANDALONE
# and re-split paths; it is preventive there, not corrective.
```

and soften the SUMMARY's "live worker leak" to "unconditional leak on the standalone worker
path".

### WR-09: `doRemove`'s new bounds guard turns a mis-index into a silent no-op

**File:** `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx:1099-1100`.

**Issue:** `const p = panelsRef.current[idx]; if (!p) return;` early-returns BEFORE
`setAnnouncement` and `setPanels`. Previously `doRemove` always removed. `panelsRef` is synced
in a post-commit effect, so it lags any state change that has not yet re-rendered.

**Failure scenario:** the user clicks Remove on a panel with entered credentials →
`requestRemove` sets `confirmingRemove: true`. Before confirming they remove a DIFFERENT panel
(the confirm UI does not block the other rows). `panelsRef.current` now has one fewer element;
the pending confirm still carries the stale `idx`. If that index is now out of range the
confirm click does nothing at all: no announcement, no removal, no error, and the confirm
dialog stays open. The user clicks again with the same result. This is a silent failure on a
credential-entry surface, which is the class this phase exists to close.

**Minimal fix:** keep the guard for the abort lookup only, and let the removal proceed (or
fail loudly):

```ts
const p = panelsRef.current[idx];
const controller = p ? abortControllersRef.current.get(p.id) : undefined;
if (p && controller) {
  abortReasonsRef.current.set(p.id, "user");
  controller.abort();
}
setAnnouncement(`Key ${idx + 1} removed`);
setPanels((prev) => prev.filter((_, i) => i !== idx));
```

Better still, key the removal by `p.id` rather than by index throughout — the docblock already
argues that identity is the correct key for the abort, and the same argument applies to the
`filter`.

### WR-10: SEC-01 closes with a 6-character floor and no character-class requirement

**File:** `src/lib/auth/password-policy.ts:43`.

**Issue:** SEC-01 was closed by MEASURING the hosted policy (6, no character classes) and
mirroring it in one constant. The measurement discipline is exemplary. But the outcome of a
requirement in a phase titled *"harden — fail safe, closed and loud"* is that the platform
that custodies users' exchange API keys accepts a six-character, all-lowercase password. The
requirement's own docblock states the client floor is UX only and the real gate is hosted
GoTrue, so nothing in this phase raises the actual floor.

**Failure scenario:** an attacker credential-stuffs or brute-forces a six-character lowercase
password (26^6 ≈ 3×10^8, trivially offline-searchable and well within online rates given the
observed rate limiting is per-route rather than per-account). The compromised account's
connected venue keys are decryptable server-side by the platform, so account takeover is
key-material exposure.

**Minimal fix:** this is a dashboard-owned setting, so the code change alone is insufficient —
raise the hosted minimum (10-12 is the common floor) AND enable GoTrue's leaked-password
protection, then move `MIN_PASSWORD_LENGTH` and its recorded reading in the same commit. The
docblock's "note for whoever raises the hosted minimum" already describes the procedure. If
the founder prefers to defer, record the deferral in the SEC-01 entry as an accepted risk
rather than leaving the requirement reading as if the floor were validated.

### WR-11: `checkStuckNotifications` was hardened but has no caller, and the byte gate that guards it cannot see behaviour

**File:** `src/lib/observability.ts:29-68`; gate at
`src/__tests__/observ12-fixtures-presence.test.ts:35`.

**Issue:** the SUMMARY states plainly that *"`checkStuckNotifications` still has no runtime
caller."* The OPS-06 work therefore converted a dead function's return type from
`{ stuck: number }` to a discriminated union and added seven unit tests for it. The tests are
good; the function is not wired to anything, so nothing in production benefits.

**Failure scenario:** the requirement OPS-06 is recorded as closing the "monitors cannot
report false health" class for stuck notifications. It does not — there is no monitor.
Notification dispatches can sit in `queued` indefinitely and nothing observes it, before or
after this phase. A future reader auditing OPS coverage will see a tested, typed, correct
checker and conclude the surface is monitored.

**Minimal fix:** either wire it (one call in an existing cron, branching on `kind`), or move
the OPS-06 entry's wording from "distinguishes zero from unknown" to "the CONTRACT is pinned;
no consumer exists — wiring one is booked as <item>". The scope note added to
`observ12-fixtures-presence.test.ts` is honest and should stay either way.

---

## Info

### IN-01: `StrategyHeader` is not a live mount — the "five real SyncBadge mounts" claim is four

**File:** `src/components/strategy/StrategyHeader.tsx:28-38`.

`grep -rn "StrategyHeader" src/` finds no importer; the only hits are two comments in
`Badge.tsx` and `TrustTierLabel.tsx`. The component is dead code. The `seriesEnd={null}`
decision there — and its permanent amber capping — has no user-visible effect. Worth noting
because `163-04-SUMMARY.md` counts it among "all five real SyncBadge mounts", and because the
same SUMMARY correctly caught the plan naming three non-mounts. Consider deleting the
component or recording it as unmounted.

### IN-02: `CompositionDonut` re-optionalises `seriesEnd`, defeating the required-prop forcing function one layer up

**File:** `src/components/portfolio/CompositionDonut.tsx:22-30`.

`SyncBadge.seriesEnd` is deliberately REQUIRED so no mount can reopen the class by omission.
`CompositionDonut`'s own prop is `seriesEnd?: string | null`, so a caller of the donut can omit
it and the badge silently receives `null`. The degradation is conservative (amber cap, never a
false freshness claim), so this is Info rather than Warning — but the stated forcing property
does not extend past the badge's own boundary.

### IN-03: `import.meta.url.endsWith(process.argv[1] ?? "")` degenerates to always-true

**File:** `scripts/check-planning-hygiene.ts:243-246`.

`"".endsWith("")` is `true` for every string, so if `process.argv[1]` is ever `undefined` the
CLI guard fires on plain import and `main()` runs — including its `process.exit(1)` path.
Under vitest `argv[1]` is the runner path so this does not trigger today. Fix:
`process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1])`.

### IN-04: `scrubbed_msg % record.args` formats the record twice

**File:** `analytics-service/services/logging_config.py:163-166`.

The probe interpolates the arguments once, and the handler does it again at emit time. Any
argument with a side-effecting `__str__` / `__format__` runs twice. The comment correctly notes
the probe is skipped unless the scrub changed something, so the hot path is unaffected. Folded
into CR-01's fix if the rendered-message approach is adopted.

### IN-05: SEC-05's tenant-isolation assertion exercises a header production never sends

**File:** `analytics-service/routers/simulator.py:34-45`;
`analytics-service/tests/test_limiter_identity.py` (the
`test_one_tenants_exhausted_bucket_does_not_throttle_another` case).

`tenant_or_platform_key` only produces a per-tenant bucket when `X-Tenant-Claim` is present,
and the file's own comment records that `src/lib/analytics-client.ts` does not mint it (the
open 140.2 obligation). So all real traffic lands on the single `platform:/api/simulator`
bucket, and the isolation the tests assert is not a property production exercises. This is the
established pattern for the other nine PYAPI-03 routes and is documented at every layer, so it
is not a defect of this plan — but the SEC-05 entry should not be read as "tenant leakage is
closed in production" until 140.2 lands.

### IN-06: Six single-line mutation sites remain unaudited; the census is now accurate but the `it.skip` still hides the class

**File:** `src/__tests__/audit-coverage.test.ts:977-1012`.

The re-measurement is exactly right (a listed site no longer exists, three unlisted ones do,
count 4 → 6) and the method is written down so it is auditable. The `it.skip` and the six
uncovered sites are explicitly out of scope. Recorded here only so it is visible in this
phase's review rather than only in the SUMMARY.

---

_Reviewer: gsd-code-reviewer_
_Depth: standard_

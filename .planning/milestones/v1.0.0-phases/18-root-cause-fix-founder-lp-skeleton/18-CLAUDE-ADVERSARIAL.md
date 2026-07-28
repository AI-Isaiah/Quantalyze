# Fresh-Context Adversarial Review — Phase 18

> Reviewer: Claude opus-4-7 (general-purpose subagent, fresh context, no prior planning conversation visible).
> Source: spawned by /gsd-autonomous --only 18 post-plan adversarial-review step on 2026-05-06.

## TL;DR Verdict

**REVISE.** The plan-package is well-thought-through and largely consistent with the codebase, but it ships at least three blocker-class issues that will either silently break the cron in production or leak signal that defeats the security claim. None are fatal — all are surgical fixes — but they cannot be hand-waved at execution time.

---

## Blocking Concerns (severity HIGH)

### B1. The factsheet PDF endpoint requires `strategy.status='published'` AND `analytics.computation_status='complete'`. Plan 3 never validates this, and there is a hard contradiction with FIX-02.

**What breaks.** `src/app/api/factsheet/[id]/pdf/route.ts:38-56` returns 404 if the strategy is not `published`, and 400 if analytics aren't `complete`. But REQUIREMENTS.md FIX-02 (and the founder-okx-smoke template at Plan 1 Task 2) requires `strategies.status='active'` — that is the explicit success state. A founder strategy at `status='active'` will never satisfy the factsheet endpoint's `.eq('status', 'published')` filter (route.ts:43). The cron's first invocation against the founder strategy will 404 every time, fire the dual-alert, and return a 5xx; it will never deliver the PDF.

**Evidence.**
- `src/app/api/factsheet/[id]/pdf/route.ts:38-48` filters `.eq("status", "published")` and returns 404 otherwise.
- REQUIREMENTS.md FIX-02 line 60 explicitly demands `status='active'`.
- 18-CONTEXT.md L13: "Founder OKX test key passes wizard end-to-end ... `strategies.status='active'`".
- 18-03-PLAN.md L36, L75-83: zero mention of the `published` gate or any plan to publish the founder strategy first.

**Proposed fix.** Either (a) add a Plan 1 sub-task requiring the founder to flip the strategy `status` to `published` BEFORE Plan 3's first cron tick (and document it as a /ship-time runbook step in `user_setup`), or (b) add a Plan 3 sub-task to relax the factsheet `.eq("status", "published")` for the cron caller via a `?internal=1` + service-token query that the cron supplies. Option (a) is simpler and consistent with REQUIREMENTS.md "Founder LP report cron emits monthly PDF". The plan should also assert `analytics.computation_status='complete'` before scheduling.

---

### B2. Plan 1's "founder OKX smoke" template enforces "no plaintext, no raw ciphertext" via a comment + a 32-char alphanumeric grep — both bypassable, and the SHA256-last-8 fingerprint scheme is collision-prone enough to be misleading evidence.

**What breaks.** Two coupled issues:

1. The grep gate `! grep -qE "[A-Za-z0-9]{32,}" .planning/phase-18/founder-okx-smoke.md` (18-01-PLAN.md Task 2 acceptance, line 256) fails open in two realistic ways: (i) Fernet ciphertext is base64url-shape (uses `_-` and `=`), which contains `_` and `=` — the regex `[A-Za-z0-9]{32,}` does not match `_-=`, so a literal Fernet ciphertext with one underscore in the first 32 chars (extremely common — Fernet payload often contains underscores in the first dozen chars) sails through. (ii) The founder can paste the ciphertext **with linebreaks** — the regex is line-oriented (no `s` flag, no DOTALL in grep `-E`). Either pattern defeats the gate.
2. The "SHA256 last 8 hex chars" scheme (18-01-PLAN.md Task 2, "encrypted_key SHA256 last 8") provides only 32 bits of fingerprint identity, which is fine for non-secret integrity, but the prose around it ("a fingerprint, not a key") understates that ANY 8-hex-char prefix or suffix of `sha256(ciphertext)` is **fully invertible** to "this exact ciphertext" given a second copy of that ciphertext. That's expected for a fingerprint; the issue is that the plan presents this as a security control, when its only legitimate purpose is "did the same bytes round-trip?". The plan should either (a) say so explicitly, or (b) use a keyed HMAC with a per-environment salt to prevent cross-env correlation.

**Proposed fix.** Tighten the grep to `grep -qE "[A-Za-z0-9_=+/-]{32,}"` (covers Fernet base64url AND base64) AND add a multiline check: `python -c "import re; assert not re.search(r'[A-Za-z0-9_=+/-]{32,}', open(...).read())"` so newlines don't bypass it. Add prose to the template clarifying the fingerprint is for round-trip evidence only, not a confidentiality control.

---

### B3. Plan 2 wires `scrub_pii` only into `audit.py` payload but NOT into `audit.py`'s stdlib `logger.error` calls, which write user_id + entity_id + raw exception strings to stderr. The "grep over Supabase log table shows zero PII" exit gate is not load-bearing for this surface.

**What breaks.** `analytics-service/services/audit.py:88-104, 121-129` writes:
```
logger.error("[audit] log_audit_event_service call threw (dropping): action=%s entity_type=%s entity_id=%s user_id=%s error=%s", ...)
```
This goes through stdlib `logging` (line 53: `logger = logging.getLogger("quantalyze.audit")`), NOT through structlog. Plan 2's wire-up boundary 2 (the structlog processor) does NOT see these records. So if the swallowed RPC exception body contains the original `metadata` dict (e.g., supabase-py error wraps the JSON body that contained `api_key=...`), the unscrubbed JSON lands in stderr → Railway logs → never grep'd by Supabase. Plan 2's exit criterion ("grep over Supabase log table shows zero PII") doesn't cover Railway stdout — that's a different log table.

**Proposed fix.** In Plan 2 Task 2 Step C, change the audit.py logger.error calls to also pass `metadata` through `scrub_pii` before formatting, and either route this logger to structlog (via `structlog.stdlib.add_logger_name` + a stdlib handler) OR explicitly call `scrub_pii` on the exception's `repr` before logging. Add a unit test that creates a `metadata={"api_key": "x"}`, raises during RPC, and asserts `caplog.records[0].getMessage()` contains `[REDACTED]`, not `x`.

---

### B4. The `0 9 1 * *` schedule collides with `alert-digest` (`0 9 * * *`) at the 09:00 UTC slot, and the `publicIpLimiter` on the factsheet endpoint (10/60s/IP) creates a real risk of monthly delivery failure.

**What breaks.** On the 1st of any month at 09:00 UTC, the founder-LP cron runs at the same minute that `/api/alert-digest` (`0 9 * * *`) fires. Concurrent cron starts at `09:00:00` will both invoke from the same outbound IP pool within a single second. This compounds Pitfall 3 (`publicIpLimiter`, 10 req/min/IP) — the LP cron's internal fetch to `/api/factsheet/[id]/pdf` may be rate-limited, defeating the dogfood-loop closure claim of Phase 18. Plan 3's mitigation ("we re-fire next month") is unacceptable for a once-per-month dogfood loop.

**Proposed fix.** Move the schedule to `15 9 1 * *` (or `0 10 1 * *`) to avoid the alert-digest co-tick. Independently, the cron should bypass `publicIpLimiter` by passing a service header (or use an internal admin-token route).

---

## Warnings (severity MEDIUM)

### W1. Plan 3 should specify retry policy for the factsheet endpoint's `503 + Retry-After: 10` queue-timeout response.
`src/app/api/factsheet/[id]/pdf/route.ts:96-101` returns 503 with `Retry-After: 10` when the Puppeteer slot semaphore is saturated. Plan 3 currently treats `503` as "throw, alert" rather than "retry once after 10s". Plan 3 should specify the retry policy explicitly.

### W2. The `getCorrelationId()` cron-context behavior is unstated in Plan 3.
Document explicitly: "Vercel cron does not pass `x-correlation-id`; cron always generates a fresh UUID v4 per tick — same as `sync-funding/route.ts:62`."

### W3. Plan 2's parity test is brittle to quote-style mutations.
The `expect(py).toContain('"apikey"')` literal won't catch a refactor to single quotes. Recommend `expect(py).toMatch(/["']apikey["']/)` per key.

### W4. Plan 2 Task 1 Test 13 uses naive `in` for `from services.` check — inconsistent with the Vitest version which uses regex. Use anchored regex `^\s*from services\.` in Python too.

### W5. Plan 3 Task 2 Step A calls `getCorrelationId()` BEFORE auth check; existing crons check auth FIRST. Match the established ordering.

### W6. Day-2 doc Section 5 still has the BACKBONE-06/07 "IN (Phase 18)" table row — Plan 4 only adds a header, leaving the row visible. Update the row text inline ("IN (Phase 18) — SUPERSEDED, see 18-CONTEXT.md L22-23") while preserving history.

### W7. The Pitfall 7 test ("Sentry throw doesn't suppress Resend") must use `vi.mocked(captureException).mockImplementation(() => { throw … })`, NOT just unset SENTRY_DSN. The DSN-unset path early-returns from captureSentry without exercising the try/catch.

---

## Nits (severity LOW)

- 18-CONTEXT.md L119 lists `src/app/api/cron/{warm-analytics,alert-digest,...}` but `alert-digest` is at `src/app/api/alert-digest/route.ts` (no `cron/` prefix). Cosmetic.
- Plan 1 Task 1 acceptance only checks 3 commit hashes; should also verify Bybit PR commit hashes via `git log --oneline -20`.
- Plan 4 Task 1 verify regex `! grep -qE "I (commit|will|promise|agree)"` is over-strict and may falsely block legitimate founder commitments at /ship time. Anchor on `^I` and only enforce while `status: PENDING`.
- Plan 1 Task 3 source distribution check requires 2 binance rows; conflicts with Day-2 Binance defer. Drop or relabel.

---

## Things the plan got right

- **Reuse-not-recreate of `pii-scrub.ts` denylist.** REQUIREMENTS.md FIX-04 bans `src/lib/redact.ts`; Plan 2 ships only the Python mirror. Discipline preserved.
- **TDD ordering for Plan 3** (Task 1 RED before Task 2 GREEN) is correct.
- **Lazy `await import("@sentry/nextjs")`** matches `src/app/error.tsx` precedent.
- **Vercel cron correlation_id handling** is inherited cleanly from `sync-funding/route.ts:58-62` — no re-implementation.
- **LP-03 stub is intentionally PENDING with `<TODO:` marker** — Pitfall 10 anti-auto-fill mitigation is sharp.

---

## Final Recommendation

In execution order:

1. **Add a Plan 3 pre-flight task (or runbook step in `user_setup`)**: confirm the founder strategy is `status='published'` AND has `analytics.computation_status='complete'` BEFORE the cron's first scheduled tick. Otherwise Plan 3 ships a guaranteed-failing first run. **(B1 — blocker)**
2. **Tighten `founder-okx-smoke.md`'s leak-prevention regex** to cover `_-=+/` (Fernet/base64 alphabets) and add a multiline check. Add prose that the SHA256-last-8 fingerprint is NOT a confidentiality control. **(B2 — blocker)**
3. **Extend Plan 2 Task 2 Step C** to scrub `metadata` in `audit.py`'s stdlib `logger.error` fallback path, with a `caplog`-based unit test. **(B3 — blocker)**
4. **Move the cron schedule** from `0 9 1 * *` to `15 9 1 * *` (or similar) to dodge the `alert-digest` co-tick. Add an internal-token bypass for `publicIpLimiter` on the cron's internal fetch. **(B4 — blocker)**
5. Address W1 (503 retry), W3 (parity-test robustness), W6 (Day-2 row inline supersession), W7 (test the actual Sentry-throw path) before merge.

Without B1 the cron will deliver 0 PDFs in production. The other blockers are silent-failure or signal-defeating; collectively they would make Phase 18 pass its acceptance criteria but not its requirement.

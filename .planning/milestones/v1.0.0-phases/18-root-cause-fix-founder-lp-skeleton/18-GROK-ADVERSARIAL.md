# Grok 4.3 Adversarial Review — Phase 18

## TL;DR Verdict
**REVISE** — redact.py (Plan 2) and cron dual-alert (Plan 3) contain brittle recursion + exception paths that will leak PII or silently drop alerts; BACKBONE-06/07 push (Plan 4) ships v1.0.0 with known correctness holes; founder-filled templates (Plan 1) create unverified artifacts.

## Blocking Concerns (HIGH)
- **PII leakage via incomplete scrub paths in redact.py**  
  What breaks: `scrub_pii` on nested objects containing broker-quirk keys (`x-bapi-*`, `ok-access-passphrase`) or embedded JWTs in freeform strings returns partial redaction because `_broker_quirk_sweep` only runs after canonical scrub and `scrub_freeform_string` does three passes without re-walking the result.  
  Evidence: Plan 2 Task 1 `redact.py:140-160` (the `_scrub_string` + `JWT_SHAPE` only path), Task 2 `sentry_init.py:104-117` shim + `_broker_quirk_sweep`, `test_redact.py:TestSharedCorpus` only asserts top-level `expectRedactedKeys` and never deep broker keys; corpus.json samples 11-20 lack `x-bapi-apikey` cases.  
  Proposed fix: Move broker keys into `DENYLIST_EXACT` in redact.py and add recursive re-scrub after every pass; add test case with `{"headers": {"x-bapi-apikey": "..."}}`.

- **Silent failure in cron dual-alert (Pitfall 7 not closed)**  
  What breaks: When `resend.emails.send` for the success path throws, the outer catch calls `sendFailureAlert` but the second `send` can also throw (network, rate limit) with no final escalation; `captureSentry` lazy import can fail after the first alert attempt.  
  Evidence: Plan 3 Task 2 `route.ts:92-110` (nested try inside outer catch), test 6 only mocks one rejection + one resolution but never double-failure; `sendFailureAlert` inner try/catch logs to console only.  
  Proposed fix: Add a final `console.error` + process-level unhandled rejection guard or a third-party pager (PagerDuty/Slack) fallback when both Sentry + Resend fail.

- **v1.0.0 ships with open-perp and TWR bugs**  
  What breaks: BACKBONE-06/07 moved to Phase 19 means `reconstruct_positions` and equity-curve paths are untested in production before the first real LP report cron runs.  
  Evidence: Plan 4 Task 2 `ROADMAP.md` Phase 19 bullet + Plan 1 Task 1 `in-flight-traceability.md` (no mention of backbone); CONTEXT.md L22-23 rationale cites "Phase 18 already heavy" but ignores that FIX-04 + LP cron are the only new code.  
  Proposed fix: Add explicit v1.0.0 exit gate in REQUIREMENTS.md: "BACKBONE-06/07 must be green in preview before cron first tick" or keep them in Phase 18 as non-blocking but required for dogfood.

- **Founder smoke and team tracker are unverifiable artifacts**  
  What breaks: `founder-okx-smoke.md` and `team-status.md` are templates with `<TODO:` markers; no CI gate or script enforces population before /ship.  
  Evidence: Plan 1 Task 2 `founder-okx-smoke.md:40-55` (SHA256 last-8 only), Task 3 `team-status.md` 10-row table, acceptance criteria only check file presence and column names.  
  Proposed fix: Add `scripts/verify-phase18-artifacts.ts` that fails if any `<TODO:` remains or if `team-status.md` has < 3 rows with `status=published`.

## Warnings (MEDIUM)
- Vitest parity test (Plan 2 Task 3) only greps source text; a renamed constant or reformatted Set in `pii-scrub.ts` will silently pass while runtime diverges.
- `vercel.json` edit (Plan 3 Task 2) appends without schema validation; if the file uses trailing commas or different formatting, the edit produces invalid JSON.
- `redact.py` recursion depth on deeply nested audit metadata (Plan 2) has no explicit `sys.setrecursionlimit` guard or iterative fallback.
- Cron handler (Plan 3) has no timeout on the internal factsheet fetch; a slow PDF render blocks the entire 60s Vercel limit.
- No test exercises the actual `FOUNDER_LP_STRATEGY_ID` lookup against Supabase; only env var presence.

## Nits (LOW)
- Plan 1 Task 1 `in-flight-traceability.md` hard-codes commit hashes that may be rebased; should use `git log --oneline --grep` at plan time.
- `scrub_freeform_string` docstring claims "three-pass" but implementation mutates via regex on the result of `scrub_pii` which already returns non-string in some branches.
- Day-2 decision REVISED header (Plan 4 Task 3) is correct but placed after the heading with no blank line, breaking markdown list parsing downstream.
- `tests/fixtures/redact-corpus.json` uses `null` but Python tests never assert on `None` round-trips.

## Things the plan got right
- Leaf-module invariant + zero new dependencies for redact.py.
- Separate try/catch per alert (even if incomplete).
- Preservation of historical record in Day-2 doc instead of rewrite.
- Shared corpus loaded by both Vitest and pytest.
- Native fetch + `@audit-skip:` pragma + bracketed log prefix.

## Final Recommendation
REVISE Plan 2 (add broker keys to canonical denylist + deeper recursion tests) and Plan 3 (add double-failure escalation) before merge; add artifact verification script from Plan 1. Do not ship until the three blocking PII/cron/backbone gaps have explicit tests that would have caught the failure modes above.

---

_Model: grok-4.3 | Usage: {"prompt_tokens": 38430, "completion_tokens": 1310, "total_tokens": 40851, "prompt_tokens_details": {"text_tokens": 38430, "audio_tokens": 0, "image_tokens": 0, "cached_tokens": 128}, "completion_tokens_details": {"reasoning_tokens": 1111, "audio_tokens": 0, "accepted_prediction_tokens": 0, "rejected_prediction_tokens": 0}, "num_sources_used": 0, "cost_in_usd_ticks": 539556000}_

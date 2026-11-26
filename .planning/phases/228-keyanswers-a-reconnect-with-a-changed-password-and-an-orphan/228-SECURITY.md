---
phase: 228-keyanswers-a-reconnect-with-a-changed-password-and-an-orphan
status: secured
threats_total: 22
threats_open: 0
asvs_level: L2 (no asvs_level in .planning/config.json; L2 depth used)
audited_at_sha: 8527f0457ed747b4daaeed6c81273534299a7686
audited: 2026-11-26
---

# Phase 228 KEYANSWERS — Security audit

**Verdict: SECURED.** 22 of 22 registered threats closed (19 mitigate, 3 accept; T-228-SC repeats across plans 01-04 and counts once). No unregistered threat flags.

Re-run at the audited SHA: vitest 7 files, 525 tests green (rotate-key-secret, create-with-key route, rotate-secret route, audit-coverage, key-secret-outcome, seam-budgets.invariant, wizardErrors.invariant); pytest `test_mt5_rotate_secret_internal.py` 30 passed.

| Threat | Sev | Disposition | Evidence | Pinning test |
|---|---|---|---|---|
| T-228-01 password in seam response/logs | high | mitigate | only a boolean added (`internal.py` rotate_key_secret); no new log line | true/false cases assert neither synthetic password in `res.text` |
| T-228-02 timing side channel | med | mitigate | `secrets.compare_digest` over UTF-8 bytes, after the probe | non-ASCII, whitespace and probe-refusal tests |
| T-228-03 seam as password oracle | high | mitigate | `rotateKeySecret` always sends caller's `user_id`; Python filters on it, 404 before decrypt | mismatched-user 404 (py); "sends the rotate seam exactly the session user's id" (neuters h3/h4) |
| T-228-04 rotate-secret behaviour change | high | mitigate | route only delegates; literals unchanged | rotate-secret `route.test.ts` unedited and green |
| T-228-05 UPDATE loses owner filter | high | mitigate | `rotate-key-secret.ts` `.eq(id).eq(user_id).eq(exchange,'mt5').select(id)`; zero rows fails closed | filter-triple test (PROOF-01 neuter e / 03 neuter g) |
| T-228-06 Vercel before Railway | med | mitigate | `secret_changed: z.boolean().optional()`; write skipped only on explicit false | schema tests; "ABSENT secret_changed still writes once and answers updated" |
| T-228-07 notice leaks identity | med | mitigate | body carries only `{outcome, name?}` from owner-scoped re-read | key-secret-outcome, ConnectKeyStep G1 sweep, NO_ECHO |
| T-228-08 XSS via nickname | med | mitigate | rendered as React text; `parseKeySecretOutcome` shape-checks | key-secret-outcome, ConnectKeyStep, wizardErrors tests |
| T-228-09 notice claims unreached state | med | mitigate | single builder; set from the same 409; cleared on submit/retry | no-notice-on-refusal; O3 asserts no `key_secret` |
| T-228-10 rotating another owner's key | crit | mitigate | owner-filtered resolver read; RLS re-read (id, user_id, mt5, live); seam user_id; owner-filtered UPDATE | re-read filter test, seam user_id test, no-row byte-identical refusal (neuters g, h1-h4) |
| T-228-11 write on seam refusal | high | mitigate | persist reachable only after seam returned | O3 it.each: no UPDATE, no audit; py `encrypt` not called |
| T-228-12 null-server wildcard | high | mitigate | `venue_server !== null && === typed server` | O1 null-server and different-server controls |
| T-228-13 rotating a failing/post-validation holder | high | mitigate | `rotate` only on working-holder pre-validation path | WR-06 and post-validation tests, zero seam calls |
| T-228-14 "updated" without a landed write | high | mitigate | `updated` only on `persisted.kind === "ok"`; faults answer UNKNOWN 500 | faults-never-success, O4 (neuters d, f) |
| T-228-15 secrets in logs/Sentry | high | mitigate | every new log/capture scrubs with the request's secrets; helper logs nothing | NO_ECHO (code-only for log lines; see residual 3) |
| T-228-16 password brute force | med | mitigate | per-user create-with-key limiter before the leg; seam per-key limiter | "the rotate leg adds no rate-limit token" |
| T-228-17 old-password sync marks key failed | low | accept | documented in `rotate-key-secret.ts` and route KNOWN LIMIT; MT5 `sign_in_failed` is re-enqueued by the daily poll | CHANGELOG Notes at ship |
| T-228-18 browser deadline vs rotate leg | high | mitigate | exclusive `mt5-rotate` budget branch, 120 s, 0 retries | seam-budgets "228 / O2" (0 ms slack, intended) |
| T-228-SC installs | low | accept | no manifest or lockfile touched | n/a |

## Accepted risks log
- T-228-17: a sync started with the old password can write `sign_in_failed` after the user was told `updated`; no compare-and-set. Recovers on the next scheduled poll. Review round 1 IN-02 refines this (status reset also clears healthy states on the wizard leg; LOW).
- T-228-SC: no installs.

## Residual observations (informational)
1. Python seam owner filter applies only when `user_id` is sent (pre-existing Finding 1 shape); both shipped callers always send it; the seam is token-gated.
2. The "14" pin is the create-with-key row in `wizardErrors.invariant.test.ts`; the new 503/500 emitters fall outside its `statusRe "400"` predicate (measured in 228-03-SUMMARY).
3. Rotate-leg log-line scrubbing is verified in code, not by a console spy.
4. `compare_digest` leaks length; inherent, and only after the broker accepted the password, for the key's own owner.

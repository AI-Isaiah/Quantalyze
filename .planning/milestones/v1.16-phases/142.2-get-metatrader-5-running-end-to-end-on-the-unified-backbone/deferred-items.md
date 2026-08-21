# Phase 142.2 — deferred items discovered during execution

Out-of-scope discoveries logged rather than fixed, per the executor scope
boundary (only issues directly caused by the current task's changes are
auto-fixed).

## From plan 07 (MT5-04, the KEY_INVALID_FORMAT split)

### DEF-142.2-07-A — Vercel tooling recommends Workflow DevKit on both wizard connect routes

**Discovered:** 2026-08-03, by the repo's Vercel plugin validation hook firing on
every edit to `src/app/api/strategies/create-with-key/route.ts` and its
`composite/add-key` mirror.

**What it says:** `create-with-key/route.ts:270` (the post-validation seam
region) is flagged as "manual retry logic … use Vercel Workflow DevKit for
automatic retries with durable execution". The same hook flags long-running /
polling shapes in both route specs.

**Why it was NOT actioned in plan 07:** the plan's locked acceptance criterion is
that guard expressions, error strings and HTTP statuses stay **byte-identical**
at every site and that **only the `code:` literal changes** (threat register
T-142.2-20 — changing validation or control flow under cover of a copy fix
changes the security posture, ASVS V5). Rewriting the seam's retry handling onto
a durable-execution primitive is an architectural change to the two routes that
handle raw user credentials, and it is squarely a Rule-4 "ask first" change, not
a Rule-3 blocking fix.

**What a future owner needs to know before picking this up:**
- Both routes spend two seam budgets back to back (`validate-key`, then
  `encrypt-key`) under `export const maxDuration = 300`, and the 140-series work
  built a deliberate circuit-breaker + classification posture around that seam
  (`SERVICE_UNAVAILABLE_RETRY`, `SERVICE_UNREACHABLE`, `SEAM_MISCONFIGURED`).
  Any move to Workflow DevKit has to preserve that classification contract,
  which is pinned by a large body of tests in both route specs.
- These are the two **secret-bearing** routes (raw `api_key` / `api_secret` /
  `passphrase` in the request body). Moving them onto a durable-execution
  substrate means credentials would transit a new persistence boundary — that is
  a threat-model question, not a refactor.

**Suggested disposition:** evaluate as its own phase, or reject explicitly and
silence the hook for these two paths so it stops recommending a change the
security posture does not want.

### DEF-142.2-07-B — `EquityChart.tsx:1119` react-hooks/exhaustive-deps warning

Pre-existing lint warning (`useMemo` missing dependency `period`), untouched by
this plan and unrelated to it. Also recorded by plan 02. `npm run lint` reports
0 errors, 1 warning; this is the warning.

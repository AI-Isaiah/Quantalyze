# Phase 163: HARDEN — Fail safe, closed, and loud - Context

**Gathered:** 2026-08-26
**Status:** Ready for planning

<domain>
## Phase Boundary

The backend fails safe, closed, and loud — secrets cannot reach logs, monitors cannot
report false health, committed work cannot 500, and every mutating or compute-heavy
surface is limited and audited.

In scope: OPS-05..OPS-10, SEC-01..SEC-06. Out of scope: anything user-visible on the
factsheet/wizard surfaces (that was Phase 162), and the curated-copy delivery problem
(Phase 164.2 owns it).

</domain>

<decisions>
## Implementation Decisions

### .planning username scrub (SC-4)
- **Scope corrected by measurement: 80 files, not the ~50 the ROADMAP estimated.** Measured
  2026-08-26 on main: 80 tracked `.planning/` files contain the macOS username, 57 contain
  `/Users/` absolute paths. Plan against 80.
- **Forward-only redaction, no history rewrite.** The username is already published on a
  public repo — pushed, cloneable, in GitHub's history. Scrubbing forward stops new leakage
  but does NOT unpublish. Founder accepted that limit explicitly rather than force-pushing
  ~700 commits, which would break every open PR ref, invalidate the
  `archive/v1.20-phase-162-planning-artifacts` tag, and still leave forks and caches holding
  the old objects.
- Replacement token `<user>` — greppable and obviously a placeholder.
- **Gate: a NEW no-allowlist CI scan job.** Do not extend gitleaks — its allowlist is
  path-based and therefore structurally blind to this class. The gate must fail the build on
  a new occurrence and must be demonstrated RED when neutered.
- ⚠️ Severity is metadata, not credentials. Say so in the requirement; do not inflate it.

### bridgeComputeLimiter (SC-5)
- **Size it from measured backend reality, not from the existing limiter family.** Derive
  from actual bridge + portfolio-optimizer job durations and worker concurrency on PROD
  before choosing a number. The "30× front/back mismatch" figure in the ROADMAP is inherited
  and must be re-derived — the same drift trap as the curated-copy migration header, whose
  PROD census moved 129 → 103 rows within a single day.
- ⛔ Do NOT resize the shared `userActionLimiter` (`src/lib/ratelimit.ts:97`, 5/60s).
- Existing family for shape reference only: `keysSyncUserLimiter` 30/60s,
  `syncProgressLimiter` 60/60s, `adminActionLimiter` 20/60s, `publicIpLimiter` 10/60s,
  `simulatorLimiter` 20/3600s.
- The `add_wizard_composite_key` audit-coverage decision (pragma vs real emission) must be
  RECORDED in the requirement, not just implemented.

### createAdminClient post-commit 500 class (SC-2)
- **Hoist the client construction ABOVE the irreversible commit** at each of the three known
  sites. The defect is sequencing, not error handling — a post-commit throw means the work
  landed and the user got a 500.
- ⛔ Do NOT add a non-throwing `createAdminClientOrNull()` variant. Converting a loud failure
  into a quiet one is the exact anti-pattern this phase exists to close, and it would need a
  second rule to stop it spreading across the other 179 call sites (182 total measured).
- A source-scan gate for the class was considered and deferred: static detection of
  "constructed after an await-commit in the same function" across 182 sites is likely to
  produce false positives. Fix the three sites; revisit the gate only if a fourth appears.

### Claude's Discretion
- SC-1 (structlog frozen-proxy) is fully prescribed by the success criterion — source-scan
  gate for Mode A, behavioral redaction test for Mode B, each demonstrated RED when neutered.
  No grey area. ⚠️ Note for the planner: a scan of `analytics-service/` on 2026-08-26 found
  NO module-scope `.bind()` in non-test code, so Mode A's gate is PREVENTIVE, not corrective.
  It must still be proven RED by introducing a violation, or it is a test that cannot fail.
- SC-2's `checkStuckNotifications` "nothing stuck" vs "could not tell" distinction, and the
  paging-on-failed-denominator behaviour, are at Claude's discretion within the constraint
  that both must be falsifiable by the integration test.
- SC-3 (INTO STRICT removal, deterministic resync pre-check, `body.cancel()`) is mechanical.
- SC-4's `simulator.py` tenth IP-keyed route repair and the panel-removal abort are
  mechanical; the concealing wrapper-check test must become an equality assertion with the
  quarantine list shrinking to 0.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/ratelimit.ts` — `makeLimiter(n, window)` factory; six existing named limiters to
  match in shape and naming.
- Existing source-scan gate precedent in the repo: `src/__tests__/contracts/` specs scan all
  of `src/` globally, and `scripts/check-route-contract.ts` / `check-admin-route-manifest.ts`
  run in `npm run lint`. Either is a viable home for the Mode A and username gates.

### Established Patterns
- Anti-vacuity discipline is a hard project rule: every new gate must be demonstrated RED by
  neutering the thing it guards, then restored. A gate that cannot fail is worse than none.
- Gate tokens must be counted PRE-EDIT; a token chosen by reading the finished file always
  passes.

### Integration Points
- CI: `.github/workflows/ci.yml` — the new no-allowlist username scan needs a job or a step
  in an existing one; note `secret-scan` is already red on `workflow_dispatch` runs (known,
  filed) so do not attach to it.
- `analytics-service/` structlog config for SC-1; `supabase/` for the enqueue overload.

</code_context>

<specifics>
## Specific Ideas

- The username-scrub gate must be no-allowlist by construction. The stated reason the
  existing tooling missed this class is that gitleaks' allowlist is path-based; a new gate
  that inherits any path allowlist reproduces the blindness it exists to fix.

</specifics>

<deferred>
## Deferred Ideas

- Rewriting git history to purge the username from published commits — explicitly declined
  by the founder 2026-08-26 as costing more than it buys.
- A source-scan gate for the `createAdminClient`-after-commit class — deferred as likely
  false-positive-prone across 182 call sites; revisit if a fourth site appears.
- `/gsd-pr-branch` adoption and its deletion guard — landed separately as v0.74.1.1, not
  part of this phase.

</deferred>

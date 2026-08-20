# 158-OPS-04 — TEST `compute_jobs` drain evidence

**Status:** ⛔ **NOT MEASURED — drain execution DEFERRED.** The tool and the
`claimed_at` stamps landed; the row-count measurement did not happen. See
"Why the measurement is missing" below. **This artifact does not close OPS-04.**

**Written:** 2026-08-20 · **Plan:** 158-03 · **Repo is PUBLIC** — this file
carries counts and project refs only. No key value, no user email, no DSN.

---

## What this plan actually closed

| Half | Status | Evidence |
|------|--------|----------|
| `claimed_at` stamps in the two direct running-flip UPDATEs | ✅ closed | commit `5ed93964`; region-scoped greps return 1 stamp inside each target function; the same greps return 0 against `HEAD` before the change (falsifiable, demonstrated) |
| Guarded TEST-only drain tool exists | ✅ closed | commit `2c747d62`; all five interlocks OBSERVED refusing (transcript below) |
| TEST backlog drained, closed on measured row counts | ⛔ **NOT closed** | no run was performed — tables below are empty by honesty, not by success |

---

## Why the measurement is missing

The plan was executed by a GSD worktree agent under two binding constraints:

1. **No TEST service-role credentials were present.** `NEXT_PUBLIC_SUPABASE_URL`
   and `SUPABASE_SERVICE_ROLE_KEY` are both unset in the worktree environment,
   and the only env file present is `.env.example`. Gitignored env files do not
   propagate into a `git worktree`.
2. **The executor was explicitly barred from running the drain against any live
   database from the worktree**, and equally barred from improvising access
   (reading another checkout's env file, minting credentials, etc.).

Fabricating the tables would defeat the entire point of an artifact whose
acceptance criterion is *measurement*. So the tables stay empty and the debt
stays open, tracked in `TODOS.md` under **Phase 158 — recorded deferrals**.

The same missing credentials also mean the two stamped tests **did not execute
locally**: `python3 -m pytest tests/test_compute_jobs_fencing.py -q` from
`analytics-service/` reports `16 passed, 28 skipped`, and both
`test_defer_compute_job_token_fence` (`:1127`) and
`test_defer_compute_job_null_token_backcompat` (`:1196`) are among the skips
(`test Supabase project not configured (local dev)`). The payload greps are the
floor that was actually met; CI — which carries the `TEST_SUPABASE_*` secrets
and hard-fails rather than skipping — is where those two arms run for real.

---

## Ledger correction — what this drain is NOT

The requirement OPS-04 was written from a ledger claim that the TEST backlog
caused an *exactly-10 deterministic red* in the fencing suite. **That claim moved
before this phase started.** PR **#674** (`c726a250`, v0.57.0.1, 2026-08-12)
added mandatory `p_kind_include` / `kind=` scoping to `_claim_one`, which makes
the foreign `derive_broker_dailies` backlog *structurally invisible* to the
suite's claims rather than merely unlikely to interfere.

Therefore: the ten reds were almost certainly already dead before any drain ran.
**Any future write-up that credits this drain with "fixing the 10 reds" would be
false.** The drain closes a **hygiene** debt — unbounded accumulation of
permanently-`running` rows plus a daily `pending` refill on a shared project —
and it closes **only** on measured before/after row counts, never on test colors.

---

## Recorded semantics decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Destroy vs. terminalize | **Terminalize. Zero row-destroying calls in the tool.** | WR-02's "never destroy, terminalize" doctrine is PROD-born; on TEST it costs nothing and preserves audit shape. Enforced by a negative source grep, not by discipline. |
| Terminal status | **`failed_final`** — *not* `failed` | The plan text said `'failed'`. The `compute_jobs.status` CHECK (migration `20260411144407:113-120`) admits only `pending / running / done / done_pending_children / failed_retry / failed_final` — there is no `failed`, and `failed_retry` is re-claimable, i.e. not terminal. `failed_final` is also what the 90-day retention sweep already purges, so terminalized rows self-clean. |
| Provenance | `last_error` = drain note, `error_kind` = `permanent` | Both are the columns the worker itself already writes; no column was invented. |
| Scheduler | **Untouched.** | The daily fan-out job (jobid 9) is read-only context. The tool contains no scheduler reference at all (negative grep). MODE 2 reduces the refill by narrowing the fan-out's *own* eligibility predicate on `api_keys`, never by disabling the schedule. |
| Migration | **None.** | Anything merged under `supabase/migrations/**` auto-applies to PRODUCTION. This intervention is a script by construction. |
| Staleness anchor | `created_at` **and** `updated_at` **and** `claimed_at` all older than 24h | `updated_at` is trigger-maintained (`compute_jobs_set_updated_at_trigger`, `20260411144407:265-269`), so it is the honest "last touched" time. A row a concurrent CI run is working on cannot satisfy the conjunction. |

---

## Interlock transcript (OBSERVED, this session)

Each invocation exited **3** *before any network call* — the guards run before
`@supabase/supabase-js` is even imported.

| Guard | Invocation | Observed |
|-------|-----------|----------|
| (1) env present | no env set | `REFUSED: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.` |
| (2) prod-word regex | `https://my-production-db.supabase.co` | `REFUSED: production-flavored target URL: …` |
| (3) PROD ref deny | URL carrying the PROD ref | `REFUSED: target URL carries the PRODUCTION project ref (khslejtfbuezsmvmtsdn).` |
| (4) TEST ref required | `https://some-other-ref.supabase.co` | `REFUSED: target URL is not the shared TEST project (expected ref qmnijlgmdhviwzwfyzlc)` |
| (5) confirm env | TEST ref, `DRAIN_CONFIRM_TEST` unset | `REFUSED: DRAIN_CONFIRM_TEST=true is required.` |
| — | unknown flag `--bogus-flag` | `REFUSED: unrecognized argument(s): --bogus-flag` |

**Non-vacuity control:** with a TEST-ref host that does not resolve
(`https://qmnijlgmdhviwzwfyzlc.invalid`) the guards *accept*, the client is
constructed, and execution reaches the first `SELECT` — failing only on DNS
(`reading compute_job_kinds: TypeError: fetch failed`). The guards therefore let
a legitimate TEST target through; they are not a blanket refusal. The real TEST
project was never contacted.

---

## The measurement protocol (run this to close OPS-04)

From repo root, with TEST credentials exported (never inlined into shell
history), in this exact order. Capture full output for each step.

```bash
# 1. BEFORE — measure only, mutates nothing.
DRAIN_CONFIRM_TEST=true npx tsx scripts/drain-test-compute-backlog.ts --dry-run

# 2. Terminalize the stale backlog.
DRAIN_CONFIRM_TEST=true npx tsx scripts/drain-test-compute-backlog.ts

# 3. IDEMPOTENCY — immediately re-run. Must report 0 rows terminalized.
DRAIN_CONFIRM_TEST=true npx tsx scripts/drain-test-compute-backlog.ts

# 4. MODE 2 measurement — prints the eligible population + proposed flip set,
#    mutates nothing without the second confirm env.
DRAIN_CONFIRM_TEST=true npx tsx scripts/drain-test-compute-backlog.ts --flip-eligibility

# 5. MODE 2 flip, ONLY if the allowlist reads unambiguous in step 4's output.
DRAIN_CONFIRM_TEST=true DRAIN_CONFIRM_ELIGIBILITY=true \
  npx tsx scripts/drain-test-compute-backlog.ts --flip-eligibility
```

Step 2 already prints its own AFTER table and a `residual stale rows (must be 0)`
line, so steps 1 and 2 between them produce both tables below.

---

## BEFORE — `compute_jobs` by (kind, status)

> ⛔ NOT MEASURED. Populate verbatim from step 1's output. Do not estimate,
> do not carry the 2026-08-11 figures forward — those are a dated ledger claim
> (2320 `pending` inserted in one instant, 2325 `running`, oldest 2026-08-03),
> not a measurement at drain time.

| kind | status | count |
|------|--------|-------|
| _(not measured)_ | | |

**TOTAL:** _(not measured)_

## AFTER — `compute_jobs` by (kind, status)

> ⛔ NOT MEASURED. Populate verbatim from step 2's output.

| kind | status | count |
|------|--------|-------|
| _(not measured)_ | | |

**TOTAL:** _(not measured)_

**Rows terminalized to `failed_final`:** _(not measured)_

**Acceptance:** the stale `derive_broker_dailies` set (>24h untouched, in
`pending`/`running`) must read **0** in the AFTER table, and step 2's
`residual stale rows (must be 0)` line must print `0`.

---

## Idempotency

> ⛔ NOT MEASURED. Record step 3's output here.

**Expected and required:** the second run reports `terminalized 0 rows`. The
mechanism is structural rather than a flag — a row terminalized by step 2 no
longer matches MODE 1's `status IN ('pending','running')` filter, so it cannot be
selected twice. A non-zero second-run delta means either the filter is wrong or
the fan-out ran between the two invocations; investigate before re-running.

---

## MODE 2 — eligibility flip outcome

**Outcome: DEFERRED (explicitly, not silently).** No measurement of the eligible
`api_keys` population was taken and no key was flipped, for the same
credentials/constraint reason as MODE 1. Tracked in `TODOS.md`.

The allowlist derivation is nonetheless settled in code, so whoever runs it is
not guessing:

- **Durable demo keys** are parsed out of `scripts/seed-full-app-demo.ts`'s
  `API_KEY_IDS` constant at runtime — one source of truth, no copied UUIDs. A
  parse failure **refuses** rather than silently allowlisting nothing.
- **Live durable fixtures**: any `api_key_id` referenced by a strategy that is
  `is_example = true` or `published` (i.e. visible on the public browse page).
- **Ephemeral e2e fixtures** (`seedWizardDraft`, `seedAllocatorBook`, the
  sfox/mt5 badge seeds in `e2e/helpers/seed-test-project.ts`) mint a **fresh key
  per run** with a `uniqueSuffix()` label and clean up by prefix — they have no
  stable identifier to enumerate and are covered by the 7-day age cutoff instead.

---

## Open items

- OPS-04 remains **open** until the tables above carry real numbers.
- `TODOS.md` → **Phase 158 — recorded deferrals**: `[158-OPS-04] drain execution
  deferred` and `[158-OPS-04] eligibility flip deferred`.

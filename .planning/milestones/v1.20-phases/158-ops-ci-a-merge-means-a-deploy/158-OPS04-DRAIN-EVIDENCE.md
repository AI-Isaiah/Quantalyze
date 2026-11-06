# 158-OPS-04 — TEST `compute_jobs` drain evidence

**Status:** ✅ **MEASURED — drain executed against TEST 2026-08-20, closed on row
counts.** The drain ran as a **measured no-op**: the stale target set was **0 at
BEFORE**, so 0 rows were terminalized and the AFTER table is identical — see
"Where the ledger backlog went" for the measured explanation. **This artifact
closes the MODE 1 half of OPS-04 on measurement.** The MODE 2 eligibility flip
remains explicitly deferred (measurement taken, mutation not executed — see
below and `TODOS.md`).

**Written:** 2026-08-20 (tooling + protocol by the plan executor; measurements
added same day from the credentialed main checkout) · **Plan:** 158-03 ·
**Repo is PUBLIC** — this file carries counts and project refs only. No key
value, no user email, no DSN.

---

## What this plan actually closed

| Half | Status | Evidence |
|------|--------|----------|
| `claimed_at` stamps in the two direct running-flip UPDATEs | ✅ closed | commit `5ed93964`; region-scoped greps return 1 stamp inside each target function; the same greps return 0 against `HEAD` before the change (falsifiable, demonstrated) |
| Guarded TEST-only drain tool exists | ✅ closed | commit `2c747d62`; all five interlocks OBSERVED refusing (transcript below); two of the guards re-observed refusing during the measurement session |
| TEST backlog drained, closed on measured row counts | ✅ **closed** | measured 2026-08-20 (tables below): stale set 0 at BEFORE, 0 terminalized, residual 0, second-run delta 0 |

---

## How the measurement was taken

The original plan execution (a GSD worktree agent) HALTED here: no TEST
service-role credentials existed in the worktree and live-DB execution was
barred from it, so the tables below were first landed empty and explicitly
marked NOT MEASURED rather than invented. The measurement was completed the
same day from the **main checkout**, where `.env.test.local` exists:

- Quiet window confirmed before measuring and re-confirmed before the live
  run: `gh run list --limit 5 --json status --jq '[.[] | select(.status=="in_progress" or .status=="queued")] | length'` → `0` both times (nothing racing the shared TEST DB).
- Credentials were loaded via `node --env-file=<repo>/.env.test.local` plus a
  second env file carrying only `DRAIN_CONFIRM_TEST=true`, so no secret value
  ever appeared in shell history, tool output, or this file.
- Safety comparison performed first: `.env.local`'s `NEXT_PUBLIC_SUPABASE_URL`
  carries the PROD ref (`khslejtfbuezsmvmtsdn`), `.env.test.local`'s is
  `https://qmnijlgmdhviwzwfyzlc.supabase.co` — different projects, and the test
  URL contains no PROD ref (matches `src/lib/test-safety.ts` PROD_PROJECT_REFS).
- Exact invocation shape (secrets external, never inlined):

```bash
node --env-file=<repo>/.env.test.local --env-file=<scratch>/drain-confirm.env \
  --import tsx scripts/drain-test-compute-backlog.ts [--dry-run] [--flip-eligibility]
```

The two stamped fencing tests still did not execute locally (`16 passed, 28
skipped` from `analytics-service/`); CI — which carries the `TEST_SUPABASE_*`
secrets and hard-fails rather than skipping — remains their first real run.
That residual is tracked separately in `TODOS.md` and is NOT closed by this
file.

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

## Interlock transcript (OBSERVED)

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

**Re-observed during the measurement session (2026-08-20):** guard (5)
(`DRAIN_CONFIRM_TEST` unset → exit 3) and guard (4)
(`https://example.supabase.co` → exit 3). A guard-(3) re-probe was not run from
the measurement session — the operator harness itself refused to execute a
command carrying the PROD ref, an outer layer of the same defense; guard (3)'s
own refusal stands observed from the build session above.

**Non-vacuity control:** with a TEST-ref host that does not resolve
(`https://qmnijlgmdhviwzwfyzlc.invalid`) the guards *accept*, the client is
constructed, and execution reaches the first `SELECT` — failing only on DNS
(`reading compute_job_kinds: TypeError: fetch failed`). The guards therefore let
a legitimate TEST target through; they are not a blanket refusal. (And the
measurement runs below are the ultimate accept-path proof.)

---

## The measurement protocol (as executed)

From repo root, with TEST credentials exported (never inlined into shell
history), in this exact order — all five steps were run on 2026-08-20:

```bash
# 1. BEFORE — measure only, mutates nothing.            [run 17:22:51Z]
DRAIN_CONFIRM_TEST=true npx tsx scripts/drain-test-compute-backlog.ts --dry-run

# 2. Terminalize the stale backlog.                     [run 17:29:36Z]
DRAIN_CONFIRM_TEST=true npx tsx scripts/drain-test-compute-backlog.ts

# 3. IDEMPOTENCY — immediately re-run. Must report 0.   [run 17:31:52Z]
DRAIN_CONFIRM_TEST=true npx tsx scripts/drain-test-compute-backlog.ts

# 4. MODE 2 measurement — mutates nothing without the   [run 17:33:55Z]
#    second confirm env.
DRAIN_CONFIRM_TEST=true npx tsx scripts/drain-test-compute-backlog.ts --dry-run --flip-eligibility

# 5. MODE 2 flip — NOT RUN. Deferred; see MODE 2 section.
```

(The actual invocations used the `node --env-file … --import tsx` shape shown
in "How the measurement was taken" so credentials never touched the shell;
semantically identical.)

---

## BEFORE — `compute_jobs` by (kind, status)

Measured 2026-08-20T17:22:51Z (step 1, `--dry-run`), verbatim:

| kind | status | count |
|------|--------|-------|
| compute_analytics_from_csv | pending | 2 |
| compute_analytics_from_csv | failed_final | 1 |
| derive_broker_dailies | pending | 2313 |
| derive_broker_dailies | running | 196 |
| derive_broker_dailies | failed_final | 2348 |
| poll_positions | failed_final | 7 |
| stitch_composite | pending | 1 |

**TOTAL:** 4868

**Stale target set** (kind=`derive_broker_dailies`, status IN
(pending, running), created_at AND updated_at AND claimed_at all older than
24h): **0 rows**. This is a true measurement, not a filter accident — see
"Where the ledger backlog went".

## AFTER — `compute_jobs` by (kind, status)

Measured 2026-08-20T17:29:36Z (step 2, live run), verbatim — identical to
BEFORE because the target set was already empty:

| kind | status | count |
|------|--------|-------|
| compute_analytics_from_csv | pending | 2 |
| compute_analytics_from_csv | failed_final | 1 |
| derive_broker_dailies | pending | 2313 |
| derive_broker_dailies | running | 196 |
| derive_broker_dailies | failed_final | 2348 |
| poll_positions | failed_final | 7 |
| stitch_composite | pending | 1 |

**TOTAL:** 4868

**Rows terminalized to `failed_final`:** **0** (`[drain] terminalized 0 rows to
'failed_final'.`)

**Acceptance:** the stale `derive_broker_dailies` set (>24h untouched, in
`pending`/`running`) reads **0** in the AFTER table, and step 2's
`residual stale rows (must be 0)` line printed **`0`**. ✅

Honesty note on "older than 24h": 1,805 of the 2,313 pending rows were
*created* more than 24h before the run (oldest 2026-08-11), but **every one of
them was touched on 2026-08-20** (see below), so 0 rows satisfy the tool's
recorded staleness definition — *untouched* for 24h across all three anchors.
Those rows are live retry-cycle work, exactly what the conjunction was designed
to protect (threat T-158-12).

---

## Where the ledger backlog went (why a no-op is the correct result)

The 2026-08-11 ledger state — 2,320 `pending` inserted in one instant, 2,325
permanently-`running` (oldest 2026-08-03), reapable by nothing — **no longer
exists**. Read-only checks against TEST during the measurement session showed
the queue is now actively serviced:

1. **The orphaned-running reaper is LIVE on TEST** (pg_cron jobid 19, hourly at
   :50, bounded batches). 1,983 of the 2,348 `failed_final` rows carry
   `orphaned_running_reaped: no worker completed this job within the 4h claim
   window`, with `updated_at` stamps at :50 marks from 2026-08-17 onward. The
   old permanently-`running` population has been terminalized by the reaper —
   the WR-02/P144 machinery working as designed.
2. **A worker processed the queue on 2026-08-20** (07:57–11:46 UTC): all 2,313
   `pending` rows have `attempts > 0` and `updated_at`/`next_attempt_at` from
   that window (claim → transient failure → defer-with-backoff cycle), and the
   196 `running` rows were all claimed 11:43–11:46 with `claimed_at` SET — i.e.
   reapable within ~4h by the hourly sweep. 365 further `failed_final` rows are
   real worker verdicts (`Credentials could not be decrypted — key may have
   rotated`) on stale e2e-artifact keys.
3. **PR #674** had already made whatever remained invisible to the fencing
   suite (see the ledger correction above).

So MODE 1's target class — rows nothing has touched for 24h — is genuinely
empty, and the "unreapable accumulation" premise of OPS-04 has dissolved: rows
now cycle through claim/defer/reap/terminalize, and terminal rows are purged by
the existing 30/90-day retention sweeps. The measured no-op **is** the closure
evidence.

---

## Idempotency

Step 3 (immediate second live run, 2026-08-20T17:31:52Z) reported:

```
[drain] terminalized 0 rows to 'failed_final'.
[drain] residual stale rows (must be 0): 0
```

**Zero additional rows** — the required zero-delta. The mechanism is structural
rather than a flag — a row terminalized by step 2 no longer matches MODE 1's
`status IN ('pending','running')` filter, so it cannot be selected twice. (With
a 0-row target set both runs are trivially 0; the structural argument, plus the
observed residual-0 line, is what carries the idempotency claim.)

---

## MODE 2 — eligibility flip outcome

**Outcome: MEASURED 2026-08-20T17:33:55Z; flip NOT executed (explicit deferral,
tracked in `TODOS.md`).** Step 4 output:

```
eligible keys              : 1000
distinct owners            : 474
oldest created_at          : 2026-06-28T14:15:48+00:00
newest created_at          : 2026-08-20T11:40:09+00:00
allowlisted (fixture+live) : 3
age cutoff (7d)            : 2026-08-13T17:34:50Z
PROPOSED to flip ineligible: 351
```

⚠️ **Measurement caveat:** `eligible keys: 1000` is exactly PostgREST's default
per-request row cap — the MODE 2 SELECT is unpaginated, so 1000 is a **floor**,
not the population. The honest population proxy is the fan-out's own output:
**2,313 pending jobs = ~2,313 eligible keys**. The `distinct owners`,
`allowlisted` and `PROPOSED` figures are therefore also floors computed over
the first 1000 rows. The flip was NOT run partly for this reason: executing a
"proposed 351" that is actually "proposed unknown-but-larger" would not be a
measure-print-confirm flow. Whoever runs step 5 should treat pagination of the
MODE 2 SELECT as a precondition (tool change — out of scope for this
measurement, which was barred from modifying the drain script).

Deferral rationale, in full: (a) the pagination caveat above; (b) today's
measurements show the refill is no longer accumulating unreapable state — rows
cycle to terminal and self-purge — so the flip is a cost optimization, not a
hygiene emergency; (c) the flip mutates ~2k live `api_keys` rows and was not in
the measurement session's authorized scope. The allowlist derivation itself is
settled in code and unchanged:

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

- MODE 1 (the drain) is **closed on the measurements above**.
- The MODE 2 flip stays **open** in `TODOS.md` (`[158-OPS-04] eligibility flip
  deferred`), now with a measured step-4 baseline and the pagination caveat.
- The stamped fencing tests' first real execution remains a CI event, tracked
  as its own `TODOS.md` entry.

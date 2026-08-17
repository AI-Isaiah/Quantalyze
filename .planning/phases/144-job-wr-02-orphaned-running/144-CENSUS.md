# Phase 144 — Live census and pre-apply evidence

**Session:** orchestrator (Supabase MCP is stripped from subagents)
**Branch:** `feat/v1.19-phase-144`
**Taken:** 2026-08-17, read-only, BEFORE the migration was applied to TEST

---

## §1 — SC#4 pre-merge RE-CENSUS on PROD (`khslejtfbuezsmvmtsdn`)

The JOB-08 WON'T-FIX rests on this number. A **non-zero** stale `pending` falsifies the structural
argument and REOPENS the requirement. This is the re-measurement that arms or kills it.

| status | n | oldest | newest |
|---|---|---|---|
| `done` | 1545 | 2026-07-18 | 2026-08-17 |
| `failed_final` | 121 | 2026-05-20 | 2026-08-17 |
| `pending` | **0** (status absent from the table entirely) | — | — |
| `running` | **0** (status absent entirely) | — | — |

⇒ **Kill criterion NOT triggered.** `pending` = 0 on PROD, re-measured at merge time rather than
inherited from the discuss census. The structural argument holds: nothing sweeps `pending`, so any
stale `pending` ever created would still be present; zero therefore means zero have **ever** stranded
on PROD. **JOB-08 stays a WON'T-FIX carrying its measurement.**

⇒ PROD `running` = 0 also confirms the phase ships to a production table with **no orphan backlog**.
The first PROD tick will terminalize nothing. That is the safe outcome and it produces **no positive
evidence** — exactly as with Phase 143. Proof of function is TEST's live fixture, the CI SQL gate, and
the offline harness. A quiet PROD is not proof.

---

## §2 — TEST (`qmnijlgmdhviwzwfyzlc`) `running` population

⚠️ **This corrects the discuss census, which reported `running = 6`.** That 6 was the NULL-claim
SUBSET mislabelled as the total.

| kind | claim | rows | created | retention key `COALESCE(next_attempt_at, created_at)` |
|---|---|---|---|---|
| `derive_broker_dailies` | claimed | **396** | 2026-08-11 | 2026-08-14 |
| `poll_positions` | **NULL** | **6** | 2026-08-03 → 08-12 | 2026-08-03 |
| | | **402 total** | | |

All 402 carry a non-NULL `claim_token` and a non-NULL `next_attempt_at`; all are >48 h old.

⛔ **THIS PARAGRAPH WAS WRONG — see §5. Left in place, struck, rather than rewritten, because the
error is instructive.** It originally read: *"Arm A has 396 live targets and the per-arm bound is 100,
so the population EXCEEDS the bound by design — successive real ticks can be observed holding and
progressing."*

The 396 rows do **not** qualify for arm A at apply time. I characterised them by `created_at`
(2026-08-11) and `next_attempt_at`, and never measured **`claimed_at`** — the only column arm A keys
on. Their claims are from **12:05 TODAY** (CI workers), so at the 15:50 tick they were 3 h 47 m old,
inside the 4 h protection. Arm A correctly moved zero. The bound observation is not lost — it moves to
the 16:50 tick, once those claims cross 4 h. Full measurement and mechanism in §5.

⇒ The `LIMIT 100` re-derivation still stands, but note its rationale was argued partly on this wrong
premise. It survives on the derivation that replaced it at plan-check (per-tick statement cost, with
the bound set deliberately below the live population) — not on this paragraph.

⇒ B3 is **not yet live-triggered**: the oldest retention key is 2026-08-03, ~14 days, well inside the
90-day window of `retention_compute_jobs_failed`. B3 remains correct and necessary — these rows age
indefinitely because nothing currently reaps them — but no row is at risk of the 90-day purge today.

---

## §3 — The NULL-claim origin question — **CONFIRMED as test residue**

⛔ Ordering hazard, honored: this evidence was captured **BEFORE** the first tick, because arm B
terminalizes these exact 6 rows and destroys the forensic signature.

Full row dump of all 6 (`status='running' AND claimed_at IS NULL`):

| created_at | updated_at − created_at | next_attempt_at | api_key_id | metadata / last_error / error_kind |
|---|---|---|---|---|
| 2026-08-03 11:15:54.625624 | **72 ms** | == created_at exactly | NULL | all NULL |
| 2026-08-03 11:19:14.065385 | **276 ms** | == created_at exactly | NULL | all NULL |
| 2026-08-04 12:14:32.146465 | **113 ms** | == created_at exactly | NULL | all NULL |
| 2026-08-04 14:44:59.980194 | **91 ms** | == created_at exactly | NULL | all NULL |
| 2026-08-04 14:48:48.087913 | **45 ms** | == created_at exactly | NULL | all NULL |
| 2026-08-12 13:55:08.505358 | **100 ms** | == created_at exactly | NULL | all NULL |

All six: `kind = poll_positions`, `attempts = 1`, `strategy_id` NOT NULL, `claim_token` present.

### The control — and an inference of mine that it DISPROVED

Real `poll_positions` rows on PROD (terminal history), n = 11:

| property | real PROD rows | the 6 suspects |
|---|---|---|
| `api_key_id IS NULL` | **11 of 11** | 6 of 6 |
| `claimed_at IS NULL` | **0 of 11** | 6 of 6 |
| fastest create→update | **4.576 s** | **0.045 – 0.276 s** |
| average create→update | 162.5 s | — |

⚠️ **`api_key_id IS NULL` is NORMAL for `poll_positions`, not anomalous.** An earlier reading of mine
treated it as a discriminator; the control disproves that, and it is recorded here rather than quietly
dropped. The claim survives on stronger evidence:

1. **`claimed_at IS NULL` is genuinely anomalous** — 0 of 11 real rows exhibit it.
2. **Lifetime is 17×–100× faster than the fastest real row.** 45–276 ms is a synchronous
   INSERT-then-UPDATE inside one test body; a worker claim cannot be that fast (real minimum 4.576 s).
3. **`next_attempt_at == created_at` to the microsecond** — never advanced by any scheduler.
4. **PROD holds ZERO rows of this shape**, across the whole table.
5. **No in-repo writer can produce it** (144-RESEARCH §3): every SQL writer of `status='running'`
   stamps `claimed_at` in the SAME statement, and there are zero Python/TS writers. The only in-repo
   producer is the live-DB fixture at `analytics-service/tests/test_compute_jobs_fencing.py:1138-1152`
   and `:1191-1205`, whose shape matches on every attribute including the date window.

### Verdict

**CONFIRMED: test-fixture residue, NOT a production invariant violation.** The hard-STOP kill criterion
("the phase must not merge over an undiagnosed invariant violation") is **NOT triggered**. Arm B is
still correct and still ships — it sweeps this class whatever its origin, and CONTEXT's Discretion
section explicitly permits filing the writer rather than fixing it in-phase. Fixture hygiene is filed
to TODOS; `test_compute_jobs_fencing.py` is deliberately NOT edited by this phase.

---

## §4 — Live cron slot verification (both projects)

Read from live `cron.job`, not derived from migrations — a hand-registered job would not appear in
the repo.

| project | occupied minutes | `:50` free? |
|---|---|---|
| PROD `khslejtfbuezsmvmtsdn` | `{0, 5, 10, 15, 20, 30, 35, 45}` | ✅ yes |
| TEST `qmnijlgmdhviwzwfyzlc` | `{0, 5, 10, 15, 20, 30, 35, 45}` | ✅ yes |

`:35` is Phase 143's sweep (TEST jobid 18 / PROD jobid 33). The `*/15` reaper covers `:00/:15/:30/:45`.
No fallback to `:25` was needed.

---

## §5 — TICK 1 observed, 2026-08-17 15:50:00 UTC (runid 2007, succeeded, 161 ms)

`return_message` = `"DO"` — the command tag again, on a third body. Counts read from rows, never the log.

### Arm B — POSITIVE, all assertions pass

| assertion | expected | observed |
|---|---|---|
| rows moved by arm B | 6 | **6** ✅ |
| arm attribution (`last_error` carries the arm-B literal) | 6 | **6** ✅ |
| B3 — `next_attempt_at` advanced into the tick window | 6 | **6** ✅ |
| `claim_token` PRESERVED (forensics) | 6 | **6** ✅ |
| `error_kind = 'permanent'` | 6 | **6** ✅ |
| CONSERVATION — every pre-tick id still exists | 402 | **402** (396 running + 6 failed_final) ✅ |

**Zero rows vanished.** The behaviour this phase exists to replace — removal — did not occur.

### Arm A — moved ZERO, and that is CORRECT. ⚠️ It also falsifies a claim of mine.

⛔ **My census §2 said "Arm A has 396 live targets and the population EXCEEDS the bound by design."
That was WRONG at apply time, and the error was mine: I characterised those 396 rows by `created_at`
and `next_attempt_at` and NEVER measured `claimed_at` — the one column arm A actually keys on.**

Measured after the tick:

| property | value |
|---|---|
| `created_at` (enqueued) | 2026-08-11 |
| `claimed_at` | **2026-08-17 12:05:24 → 12:05:49** (a 25-second window, TODAY) |
| claim age at tick time | **227 min = 3 h 47 m** |
| qualifying for arm A (`claimed_at < now() - 4h`) | **0** |
| distinct `claimed_by` | **9** workers, named `g21-001-worker`-style |
| days queued before claim | 6.3 |

**Mechanism:** these rows were enqueued by the `derive-allocator-key-dailies` fan-out on 08-11 and sat
undrained (TEST has no worker). At 12:05:24 today — minutes after PR #687 merged — main's `python` CI
job ran its live-DB tests against TEST, **claimed 396 backlogged rows in 25 seconds across 9 ephemeral
workers, then exited and abandoned them.** This is the known shared-TEST-DB flake mechanism, observed
directly rather than inferred.

⇒ **Arm A skipping them is the SC#2 guarantee firing on real data.** SC#2 requires that "a legitimate
batch-tail job under 4h is never touched — the threshold, not the frequency, is what protects live
jobs." A 3 h 47 m claim is inside that protection. Arm A declined to terminalize 396 rows it was not
yet entitled to touch. **This is an unplanned NEGATIVE CONTROL of exactly the property SC#2 names, and
it is stronger evidence than the seeded RT-01 negative in the SQL gate — it happened on real rows, at
real scale, with a real clock.** It could not have been staged.

⇒ The claims cross 4 h at ~16:05 UTC. Arm A's bound observation therefore moves to the **16:50 tick**,
one tick later than planned — not lost.

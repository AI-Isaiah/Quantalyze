---
phase: 162-honest-what-the-user-sees-is-true
plan: 01
subsystem: planning-artifact
tags: [census, prod-diagnostic, read-only, honest-01, honest-02]
status: complete
requires: []
provides:
  - "162-CENSUS.md HONEST-02 VERDICT (flat-account) — plan 162-07 branches on it"
  - "162-CENSUS.md HONEST-01 ROOT-CAUSE (inconclusive) — plan 162-08 branches on it"
  - "repair population (2 rows) — plan 162-08 Task 2 input"
  - "15-row example cohort with per-row mechanism columns — plan 162-08 Task 1 input"
  - "A2 answer: the HONEST-02 subject is NOT an example row"
affects: [162-07, 162-08]
tech-stack:
  added: []
  patterns: ["phase-159 C-M1 read-only PROD census pattern"]
key-files:
  created:
    - .planning/phases/162-honest-what-the-user-sees-is-true/162-CENSUS.md
  modified: []
decisions:
  - "HONEST-02 decided flat-account on the key-side sync witness, not on the empty trades count — an unrun poller and a flat venue produce the same zero"
  - "HONEST-01 decided inconclusive rather than asserting a site: the stage/window/population are pinned but the handler path at HEAD hosts no str/None compare and the search was not exhaustive"
  - "The subject strategy NAME was redacted to an id in the committed artifact (public repo)"
metrics:
  duration: ~35m
  completed: 2026-08-26
actuals:
  tokens: 21000
  tasks: 2
  commits: 2
---

# Phase 162 Plan 01: PROD census (HONEST-01 / HONEST-02) Summary

Both success-criterion-2 investigations completed read-only against PROD before any fix
exists in the phase; both verdicts decided on pasted evidence rows, and one of them
deliberately decided as `inconclusive` rather than guessed.

## The two verdict lines (verbatim, as committed)

```
HONEST-02 VERDICT: flat-account
HONEST-01 ROOT-CAUSE: inconclusive
```

## What decided HONEST-02

The naive read — `trades_after_end = 0` — proves nothing on its own, because a poller that
never ran produces exactly the same zero as a venue with no fills. The verdict therefore
rests on the key row: `last_sync_at = 2026-08-25T04:07Z`, `sync_status = complete`,
`is_active = true`, `sync_error`/`last_429_at`/`disconnected_at` all NULL — while
`last_fetched_trade_timestamp` has been frozen at **2026-05-06T19:49:35Z for 111 days**. The
zero was measured, not assumed.

The derive-gap arm's own trigger was also literally met (0 `compute_analytics` jobs since the
series end; in fact none anywhere in PROD since 2026-05-27) and was rejected with reasons: a
derive gap requires unconsumed data, and there is none. This is the wrinkle the plan recorded
in advance — the ccxt `stored > 0` filter (`routers/cron.py:471-472`) drops a zero-fill
strategy, so flat-account *causes* the missing recompute. Venue is **okx** (ccxt), so the
161.1 ledger fan-out gap does not apply at all.

**Consequence:** plan 162-07 takes the flat-account arm — the "Track record through {date}"
recency line ships, keyed on the series' last point (2026-05-06 here), never `computed_at`.

**A2:** the subject is **not** one of the 15 example rows (published, `is_example = false`,
wizard, okx-keyed; the example cohort is uniformly `legacy`/keyless seed ids). HONEST-02 does
**not** collapse into D-162-1's recompute — 162-07 and 162-08 act on disjoint populations.

## What decided HONEST-01

The job history localised the defect much more tightly than the research expected: one job
kind (`poll_positions`), five consecutive days (2026-06-10 … 2026-06-14), two strategies
sharing an identical 59-character unprefixed `TypeError`, and the leak route fully confirmed
(`classify_exception` unknown arm → `compute_jobs.last_error` → bridge branch (b)).

It still stops one step short of a line. `run_poll_positions_job` → `fetch_positions` →
`persist_position_snapshots` was read at HEAD and hosts no `str`/`None` compare (every
comparison in `positions.py` is numeric), so `site-identified` is unsupportable — but the
ccxt-facing normalisation and `_exchange_preflight` were not exhaustively traced and
`poll_positions` is alive at HEAD, so `site-gone` would assert something not measured. No
traceback survives (the catch-all truncates to `str(exc)[:500]` and keeps no frames) and
Sentry is orchestrator-only. `inconclusive` is the honest answer and the plan's own third arm;
162-08 closes HONEST-01 as documented-plus-repair.

## Downstream tables filled

- **Repair population: exactly 2 rows**, both strategy-side, both the same str/None defect
  (one `pending_review`, one `published`). 37 rows carry a non-NULL `computation_error`; the
  other 35 are curated copy. **Portfolio surface: 0 rows** — but its raw writer
  (`routers/portfolio.py:1191`) is still live at HEAD, so D-162-4's strict scope stands.
- **Example cohort: 15 rows, uniform** — all `legacy`, all keyless (no venue), all `failed`
  at 2026-05-27, all carrying both series columns, April-2026 series ends. Plan 162-08's
  mechanism is constrained: no venue-sync-then-recompute path exists for any of them.

## Findings raised that this phase does NOT close

1. `poll_positions` has not been enqueued anywhere in PROD since 2026-06-14, although the
   daily enqueue exists at HEAD (`main_worker.py:1026-1036`).
2. No `compute_analytics` job has run anywhere in PROD since 2026-05-27.

Both are wider than HONEST-01/02 and are filed for the phase close, not folded into a verdict.

## Deviations from Plan

**1. [Rule 1 — measurement bug] The `LIMIT 100` job-history query returned a misleading answer**
- **Found during:** Task 2, query 4
- **Issue:** newest-first with `LIMIT 100` only reached back to 2026-07-26 and hid an 81-day
  window with no jobs at all. Read literally it pointed at the wrong verdict.
- **Fix:** re-ran ascending, paged to exhaustion, and recorded the trap in the census next to
  the query so a future reader does not repeat it.

**2. [Rule 2 — missing critical evidence] Added query 3b (key sync-liveness witness)**
- **Found during:** Task 2, between queries 3 and 4
- **Issue:** the scaffolded queries could not distinguish "venue produced nothing" from
  "nothing ever asked the venue" — the exact confusion the criterion forbids pre-judging.
  Deciding on query 3 alone would have been a coin flip presented as a finding.
- **Fix:** added a read-only `api_keys` witness query (dates and null-ness only, no key
  material). It is what actually decided the verdict.

**3. [Rule 2 — disclosure] Redacted the subject strategy name from the committed artifact**
- **Issue:** the name reached the file from the pre-scope snapshot. It is user content in a
  public repo, and the census's own rule is ids only.
- **Fix:** replaced with the resolved id plus a snapshot pointer, preserving reproducibility.

## Threat Flags

None. This plan issued no writes and added no surface.

## Self-Check: PASSED

- `162-CENSUS.md` exists at the declared path; no file outside `.planning/` was modified
  (`git status --short` clean after commit).
- Commits `8ac61ac55` and `595233dec` verified present in `git log`.
- Both verify greps pass: `HONEST-02 VERDICT: flat-account`,
  `HONEST-01 ROOT-CAUSE: inconclusive`; zero `filled by Task 2` placeholders remain.
- No-PII sweep (emails, uids, project refs, hostnames, JWT-shaped tokens, key ids, subject
  names) returns no matches.

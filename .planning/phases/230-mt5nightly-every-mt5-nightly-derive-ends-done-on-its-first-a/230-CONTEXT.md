# Phase 230: MT5NIGHTLY — every MT5 nightly derive ends done on its first attempt, for a named reason - Context

**Gathered:** 2026-11-25
**Status:** Ready for planning (founder rulings recorded 2026-11-25)

<domain>
## Phase Boundary

**The cause, named from the records (SC-1, `230-DISCUSSION-LOG.md` R-1 to R-3).** MT5 `derive_broker_dailies` second attempts (2026-11-05, 11-15, 11-20, 11-21, 11-23) are cross-process contention for the ONE shared MT5 terminal. The backfill worker's nightly derive (00:40Z to about 01:40Z) and the API process's `poll_allocator_positions` (01:00Z to about 01:10Z) log the terminal into different accounts at the same time. The derive's MT5CONC-02 login bracket refuses the read (nothing persisted), the job is retried as transient, and the retry succeeds. `services/mt5_concurrency.py` `_MT5_TERMINAL_LOCKS` is an `asyncio.Lock` per process, so it serializes nothing across the two Railway services. The coordinator's HEAL-02 hypothesis is refuted: the 11-24 night ran pre-227 code (the #1325 backfill deploy was created 2026-11-24 21:11Z).

In scope:
- MT5D-02: a database-backed cross-process terminal lease, taken inside `mt5_terminal_lease`, so every MT5 terminal user serializes across processes. Then seven consecutive clean nights, counted from the lease fix's deploy.
- MT5D-03: the clock-switch replay of the `202-MT5-CLOCK-LEAD-01` moved values. The coordinator runs the read-only capture on the worker. This phase supplies the exact command and the replay steps, and records the attribution with counts only.

Out of scope: raising retries, the watchdog or any timeout (ROADMAP); moving or rescheduling crons (rejected as a bandaid, D-01 option C); the OKX `daily_pnl_non_usd_okx` permanent refusals seen on 11-25 (223/232 territory, not MT5).

</domain>

<decisions>
## Implementation Decisions

### D-01 — How the shared MT5 terminal is serialized across processes (MT5D-02)
- RULED (founder 2026-11-25 UTC, AskUserQuestion, relayed by the coordinator): **"Database lease (Recommended)"**. The option text read, verbatim: "One lease row per terminal in the database (with an expiry and an owner token), taken by every MT5 terminal user: derive, holdings poll, balance sync, key validation. A caller that finds it busy waits or gets the existing 'terminal busy' answer. The runbook already calls for this. It needs a small migration and changes no stored values."
- Rejected alternatives (put to the founder): (B) move MT5 holdings polls onto the backfill worker (claim scope is by kind, not venue, and `validate_key` stays uncovered); (C) move the holdings cron out of the derive window (a schedule bandaid).
- 155.2 freeze: the lease changes no stored values, so it is outside the freeze window.
- Migration lane: serial. migration-reviewer and rls-policy-auditor must be clean, and the migration's timestamp must be the newest at push. 225 PR-2b-2 has a migration in flight, so re-check `supabase/migrations/` on origin/main immediately before the push and re-stamp if needed.

### D-02 — Who runs the MT5D-03 clock replay
- RULED (founder 2026-11-25 UTC, AskUserQuestion, relayed by the coordinator): **"I run it (Recommended)"**. The coordinator runs the read-only ledger capture on the Railway worker outside 00:40 to 01:40 UTC, then replays it with the existing `analytics-service/scripts/mt5offset_dry_run.py`, putting counts only into records. This phase writes the exact one-shot capture command (read-only, with output kept off tracked files) and the replay steps for the coordinator. **The phase's agents never run the capture.**

### Decided autonomously (reversible technical choices, logged)
- [Choke point] Q: "Where is the cross-process lease taken?" → Selected: "Inside `services.mt5_concurrency.mt5_terminal_lease`, after the in-process lock is acquired and before the body runs, released in the same `finally`. Every existing site already goes through it (`job_worker`, `allocator_positions`, `mt5_terminal_scrub`, `mt5_relogin`, `mt5_validation_liveness`, `ingestion/mt5.py`, `routers/exchange.py`, `mt5_client`), so no site edits are needed and no second registry is created." Reason: D-01 says "taken by every MT5 terminal user", and the single lease is where it can be enforced once.
- [Busy behaviour] Q: "What does a caller do when another process holds the lease?" → Selected: "It keeps the lease's existing contract. `wait_s=None` (batch jobs) polls until it is acquired; `wait_s` a float (interactive validate) raises the existing `Mt5TerminalBusyError` at its bound. The poll interval is a stated constant." Reason: the founder's option text ("waits or gets the existing 'terminal busy' answer").
- [Expiry and renewal] Q: "How does a crashed holder not wedge the terminal?" → Selected: "The lease row carries an expiry and an owner token. Acquire succeeds when the row is free or expired. The holder renews while the body runs, so a long derive read never loses it. Release deletes or frees only the holder's own token. TTL and renew interval are stated constants, validated at import against each other, following the 227 claim-renewal pattern (`_CLAIM_RENEW_INTERVAL_S`)." Exact values are research's.
- [Missing RPC during deploy order] Q: "What if the worker runs before the migration applies, or the reverse?" → Selected: "Migrations apply on merge before Railway deploys, but a missing lease RPC (42883 / PGRST202) falls back to the in-process lock only, logs once per process, and stays loud. Any OTHER lease RPC error fails closed for that caller (a batch job retries as transient, interactive answers busy), never proceeds unserialized." This mirrors 227 DEC-08-A.
- [Security] Q: "Who may call the lease RPCs?" → Selected: "SECURITY DEFINER with a pinned search_path, EXECUTE for service_role only, no anon or authenticated grant, the table RLS-enabled with no browser policy. Holder fields carry an api_key_id or a closed literal only, never a login, server or host (the `mt5_handover` redaction rule)."
- [Proof] Q: "How is the fix proved?" → Selected: "PROOF-01 per ROADMAP SC-4. A test with two holders contending for one terminal key (two independent processes or two independent lease registries) goes RED on a neutered copy of the cross-process acquire, with its named arm first. It is restored by `cp` from a byte backup, checked with `cmp`, goes GREEN, and is recorded verbatim in the plan SUMMARY. The SQL side has a gate in `supabase/tests` with RED-UNDER annotations (acquire exclusivity, expiry takeover, foreign-token release refused, grants)."
- [Nights] Q: "How are the seven nights counted?" → Selected: "From the lease fix's backfill-worker deploy (the first 00:40Z derive after it is night 1). Each night reads the stored job rows (MT5 `derive_broker_dailies`, `attempts > 1` = 0) and the 227 ledger (MT5 rows in `compute_job_attempt_failures` = 0), marker query first, recorded with its date." The phase waits for the nights after ship and records the exact re-read query and dates. It never sleeps in a loop.
- [Replay] Q: "What does the MT5D-03 deliverable consist of?" → Selected: "A read-only capture script handed to the coordinator. It is kept OUT of the tracked tree and run by base64-exec through `railway ssh` into `quantalyze-analytics-backfill`, the 164.6.6.2.3-08 precedent. It writes its output to the coordinator's scratchpad only. The write review is recorded in the plan SUMMARY, and the replay steps run `mt5offset_dry_run` once per clock setting the 202 values were written under. Its output has the JSON shape `mt5offset_dry_run --captured` reads. Attribution compares the moved days per scope with 202's recorded moved sets (s6, s9, s10, b0→b1; s2, s5, s8, s13, c0→c1), including the 29 vanished winter rows and the TINYBASE / #1205 candidates. The result is recorded as counts per scope: attributed to the clock switch, or to another named cause." The legacy offset value comes from research (the repo's record of the pre-11-03 setting).

### Decided autonomously after research (2026-11-25, `230-RESEARCH.md`)
- [Site edits] CORRECTS "no site edits" above. Failing closed needs three small site edits and one `classify_exception` arm (transient):
  - the holdings fetcher must not stamp the lease error into a user-visible `sync_error`;
  - the two `process_key` validate arms must answer a retryable busy, never a bodyless 500.

  `Mt5TerminalLeaseUnavailableError` subclasses `Mt5TerminalBusyError`, so the wizard, heal and liveness arms need no edit.
- [Missing RPC] `is_missing_rpc` goes in `services/db.py`, because `mt5_concurrency` is a pinned leaf, with a parity test against `main_worker._is_missing_rpc`. It relogs every 900 s (the 227 cadence) and never latches. This replaces "logs once per process" above.
- [Night 1] CORRECTS the night count above. Night 1 is the first 00:40Z derive after BOTH the backfill worker and the API service deploys carry the lease, because the holdings poll runs in the API process.
  - Each night also records three checks: the cross-process wait log count (the positive signal), that `poll_allocator_positions` attempts did not rise, and that the lease table holds one row per terminal.
  - Base rate: 11-06 to 11-14 was nine clean nights with no fix. So seven clean nights corroborate the fix but do not prove it. The proof is PROOF-01 plus the wait log.
- [Replay] Run `--legacy-offset-s 7200 --rule us`: both older sides of 202's pairs were written under 7200.
  - `mt5offset_dry_run` gains a `--days-out` scratch flag so the moved day sets can be compared with 202's. The flag writes only to the named path, and the report stays counts-only.
  - The replay cannot attribute the 29 vanished winter rows, because 7200 and `us` agree in winter. Record them under the remaining named candidates (#1196 TINYBASE, #1205 gap closure) or as not attributable, never as the clock.
- [Capture] The capture runs in a quiet window and does not take the lease, so it writes no row. A quiet window means no MT5 job is running, outside 00:40 to 01:40Z and away from the 08:00Z poll.
  - The steps end with the 164.6.6.2.3 precedent's restart of both services as a coordinator-run step, because the per-process holder and settled registries go stale.
  - Whether `railway ssh` reaches the backfill service is unmeasured, so the steps give the precedent's command and a fallback.

### Claude's Discretion
- Plan split, file placement, RPC and table names, TTL, renew and poll constants, provided they are stated and pinned.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/mt5_concurrency.py` `mt5_terminal_lease`, `_mt5_terminal_lock_for`, `Mt5TerminalBusyError`: the one in-process lease and its busy contract.
- Phase 227 claim renewal: `renew_compute_job_claims` (migration `20261124120200_compute_job_claim_renewal.sql`), `main_worker._renew_claims` / `_is_missing_rpc`, and the import-time interval validation. These are the patterns for renew and missing-RPC handling.
- `services/mt5_handover.py`: the holder redaction rule (`normalize_mt5_holder`).
- `analytics-service/scripts/mt5offset_dry_run.py` (Phase 175 plan 04) and the 164.6.6.2.3-08 capture precedent (`railway ssh`, base64-exec, one `Mt5Client` per key, `settle_history=True`, write review table).

### Established Patterns
- Logs and records carry counts only, never logins, servers, hosts or amounts.
- Every analytics change passes CI mypy strict. pytest runs only from `analytics-service/`.
- Migrations: SECURITY DEFINER hardening, a self-verifying DO block, a rollback in `down/`, and a new `supabase/tests` gate that moves the mutation censuses (`scripts/mutation-floors.mjs`).

### Integration Points
- `mt5_terminal_lease` is called by every site listed in D-01. The lease row is keyed by `Mt5Client.terminal_key` (host:port), which must never be written raw to a row: hash it or use a closed label.

</code_context>

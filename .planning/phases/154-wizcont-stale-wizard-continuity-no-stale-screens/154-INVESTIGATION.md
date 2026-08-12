# Phase 154 — STALE-01 Investigation (Task 154-01-01)

**Run:** 2026-08-12, orchestrator session (Supabase MCP, PROD `khslejtfbuezsmvmtsdn`)
**Mode:** ⛔ READ-ONLY. `execute_sql` with SELECT statements only. No INSERT/UPDATE/DELETE/DDL was issued.

> This file discharges ROADMAP Phase 154 criterion 2 and the CONTEXT.md investigation gate:
> *"STALE-01's root cause is investigated and documented BEFORE any fix is planned."*
> Plans 154-04, 154-07 and 154-08 `depends_on` 154-01 and their fix design is contingent on the
> verdict below.

---

## Mechanism verdict: M2(ii)

**M2(ii) — the DB was terminal and the client was reading nothing.** The zero-rows/absent read was
coerced to the domain value `"pending"` by the ladder arm's `statusRow?.computation_status ?? "pending"`
(`src/hooks/useStrategySyncPoller.ts:228-229`), so the poll loop treated a *finished* job chain as
still running and polled forever.

Compounded by **M1** (the leading from-code hypothesis, now confirmed as the reason the state was
*unbounded* rather than merely wrong): a single-key user has **zero exits** from that state, because
the SF-1 stall backstop is gated behind `isComposite &&` at `SyncPreviewStep.tsx:2290-2291`.

**M3 — RULED OUT by evidence.** **M4 — RULED OUT by evidence.** **M2(i) — RULED OUT by evidence.**

**Founder-quote reading: STRICT.** The screen text was genuinely `"Fetching trades…"`, which is
reachable only when `phase === "waiting_for_complete"` && `isComposite === false` &&
`computationStatus ∈ {null, "pending"}` (`SyncPreviewStep.tsx:2315-2323`). The evidence below shows
the true status was terminal, so the client's `computationStatus` was the fabricated `"pending"` —
consistent with the strict reading, not RESEARCH A3's loose (`"computing"`) alternative.

---

## Q0 — the MT5 strategies

```sql
SELECT DISTINCT s.id, s.name, s.status, s.source, s.created_at, 'direct' AS link
  FROM strategies s JOIN api_keys k ON k.id = s.api_key_id
 WHERE k.exchange = 'mt5'
UNION
SELECT DISTINCT s.id, s.name, s.status, s.source, s.created_at, 'strategy_keys' AS link
  FROM strategies s
  JOIN strategy_keys sk ON sk.strategy_id = s.id
  JOIN api_keys k ON k.id = sk.api_key_id
 WHERE k.exchange = 'mt5'
 ORDER BY created_at;
```

| id | name | status | source | created_at | link |
|---|---|---|---|---|---|
| `8d382aaf-4e23-4fc1-85b9-78fafc5c8e54` | Alpha Centauri | private | wizard | 2026-08-04 11:37:40.641101+00 | direct |
| `4eab92b0-5326-45dd-9781-4df96373ee8a` | Black Swan | private | wizard | 2026-08-04 14:20:43.675863+00 | direct |

⚠️ **Census correction: there are TWO MT5 strategies on PROD, not three.** RESEARCH.md, the ROADMAP
Phase 155 precondition note, and REQUIREMENTS all say "all THREE PROD MT5 strategies". The `Q0` union
(which catches composite membership via `strategy_keys` as well as the direct `api_key_id` link)
returns two. The "three" figure most likely counts **`api_keys` rows** (three MT5 keys), not
strategies. This does not affect the verdict — Alpha Centauri is the founder's MT5-05 run and is the
subject — but Phase 155 should not go looking for a third strategy that does not exist.

**Alpha Centauri is the subject:** created 11:37:40, i.e. the run whose screen was observed stuck at
11:39:35.

---

## Q1 — what the wizard's poll would have read

Run verbatim from `154-RESEARCH.md` § STALE-01 Step 6.

| id | name | analytics_row_exists | computation_status | computed_at | computing_started_at | computation_error | series_completeness | series_rows |
|---|---|---|---|---|---|---|---|---|
| `8d382aaf…` | Alpha Centauri | **true** | `complete_with_warnings` | 2026-08-04 **14:20:51.394404**+00 | null | null | ledger_complete | 136 |
| `4eab92b0…` | Black Swan | true | `complete_with_warnings` | 2026-08-04 14:25:01.4626+00 | null | null | ledger_complete | 136 |

⚠️ **`computed_at` is NOT evidence of the state at 11:39:35 — it is a last-writer-wins column.**
Alpha Centauri's chain ran **four** times (11:37, 11:52, 12:24, 14:17), so `computed_at` carries the
*final* run's timestamp. The Step-6 discriminator table keys its M2(ii) row on
`computed_at ≈ 11:39:35`, which this row appears to fail — **that is an artifact of the overwrite,
not a refutation.** The authoritative timestamp for the state at the moment of observation is
`compute_jobs.updated_at` for the `compute_analytics_from_csv` job of the FIRST chain — see Q2.

---

## Q2 — the job aggregate the bridge derives from

Run verbatim from `154-RESEARCH.md` § STALE-01 Step 6. **22 rows, zero non-terminal.** Every row is
`status = 'done'`, `attempts = 1`, `last_error = null`. Alpha Centauri's chains, in order:

### Chain 1 — the observed run

| kind | status | created_at | claimed_at | updated_at |
|---|---|---|---|---|
| `process_key_long` | **done** | 11:37:43.465188 | 11:38:03.913695 | 11:38:05.929446 |
| `derive_broker_dailies` | **done** | 11:38:05.783174 | 11:38:36.128664 | 11:39:03.004925 |
| `compute_analytics_from_csv` | **done** | 11:39:02.878829 | 11:39:33.397507 | **11:39:35.342759** ⭐ |

⭐ **This is the 11:39:35 the requirement names.** The terminal write landed at
`11:39:35.342759`, and `compute_analytics_from_csv` is the job that writes the
`strategy_analytics` row. The chain was **complete and terminal**, and the analytics row **existed
with a terminal status**, while the wizard was rendering "Fetching trades…".

### Chains 2-4 — the founder retrying a stuck screen

| chain | process_key_long | derive_broker_dailies | compute_analytics_from_csv |
|---|---|---|---|
| 2 | 11:52:37 → done 11:52:41 | 11:52:41 → done 11:53:42 | 11:53:42 → done 11:54:15 |
| 3 | 12:24:30 → done 12:24:37 | 12:24:37 → done 12:25:40 | 12:25:40 → done 12:26:13 |
| 4 | 14:17:27 → done 14:17:47 | 14:17:47 → done 14:18:45 (+ 14:19:19 → done 14:20:17) | 14:18:45 → done 14:19:18 (+ 14:20:16 → done 14:20:51) |

Chain 4 also carries a `sync_trades` job (14:18:25 → done 14:19:19). **Three full re-runs of a chain
that had already succeeded** is the behavioural signature of a user staring at a screen that never
moved and pressing the button again — independent corroboration that the stall was client-side, not
a backend failure.

---

## Discriminator table — matched row

From `154-RESEARCH.md` § STALE-01 Step 6:

| Q1/Q2 result | Confirms | Matched? |
|---|---|---|
| Q2 returns **zero rows** for the strategy | branch (d) → **M4** | ✗ — 22 rows returned |
| Q2 has a row at `done_pending_children` with no child of the declared kind | **M3** (+H-a) | ✗ — zero rows in any non-`done` status; every declared child exists |
| Q1 `analytics_row_exists = false` while Q2 shows all-`done` | bridge never ran → **M2(i)** | ✗ — `analytics_row_exists = true`, and `compute_analytics_from_csv` (the writer) reached `done` at 11:39:35 |
| Q1 terminal status **with the terminal write at ≈11:39:35** and Q2 all-`done` | the DB was terminal and the **client** was reading nothing → **M2(ii)**, the session/RLS arm | ✅ **MATCHED** — terminal write at `11:39:35.342759` (via `compute_jobs.updated_at`, since `computed_at` was overwritten by three later chains) |

---

## Do (a) and (b) share one cause?

**One root idea, two distinct code sites. A single-site fix discharges neither alone.**

- **Shared root idea:** the client renders a verdict derived from a read it does not know is
  unauthoritative — an absent/zero-rows answer in (a), a mid-delete-window empty series in (b). In
  both, "I read nothing" is silently converted into a *positive claim about the world* ("still
  pending" / "no data, therefore failed") rather than "I do not know yet".
- **Site (a):** `useStrategySyncPoller.ts:228-229` — `?? "pending"` fabricates a domain value from a
  null read; and `SyncPreviewStep.tsx:2290-2291` / `:910` gate the only exits behind `isComposite`.
- **Site (b):** the single-key arm of `SyncPreviewStep.tsx` lacks the composite arm's R2-5
  `series.length === 0 → repoll` guard (`:1092-1096`), so it renders a terminal red refusal during
  `run_derive_broker_dailies_job`'s wholesale "series heal-delete"
  (`analytics-service/services/job_worker.py:2539-2560`).

Fixing (a) leaves the stale refusal live; fixing (b) leaves the unbounded stall live. **Both are in
scope for this phase**, per the CONTEXT.md decision that names both instances.

---

## Consequences for the dependent plans

| Plan | Contingency | Resolution |
|---|---|---|
| **154-04** | Fixes the `?? "pending"` coercion (TWIN-3) + widens the `sync-progress` route filter | ✅ **PROCEED — directly confirmed.** M2(ii) *is* the null-coercion arm. This is now an evidence-backed fix, not a speculative one. |
| **154-08** | Removes the three `isComposite` gates + adds the single-key R2-5 twin | ✅ **PROCEED — M1 confirmed** as the reason the state was unbounded. |
| **154-07** | Backend arm, gated on the verdict implicating **M3 / H-a** | ⛔ **NO-OP ARM.** M3 is ruled out: zero `done_pending_children` rows, every declared child job present and `done`, `last_error` null throughout. 154-07 must record `ARM C: NO-OP — verdict was M2(ii)` in its SUMMARY and make no `analytics-service/` or bridge change. |

**No fix mechanism, timeout, or threshold number is proposed in this document.** The existing ladder
(`SLOW_HINT_MS` 15 s / `WARN_THRESHOLD_MS` 60 s / `RETRY_THRESHOLD_MS` 900 s /
`MAX_CONSECUTIVE_POLL_ERRORS` 3) is referenced, never moved.

---

## Residual: what this evidence cannot settle

`compute_jobs` and `strategy_analytics` prove the **server** state at 11:39:35. They cannot prove
*why* the client's read came back empty — the two candidates inside M2(ii) are a PostgREST
zero-rows answer under an RLS/session boundary, and a genuine absent-row race. Both are discharged
by the same fix (stop fabricating a domain value from a null read; make the absent row observable),
and **T2 pins the fix at the seam regardless of which produced the null**. Distinguishing them would
need the founder's browser console from 2026-08-04, which no longer exists. Recorded rather than
guessed.

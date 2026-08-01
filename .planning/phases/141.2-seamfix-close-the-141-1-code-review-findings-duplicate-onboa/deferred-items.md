# Phase 141.2 — Deferred Items

Out-of-scope discoveries logged during execution. Per the scope boundary, these
are NOT fixed in the plan that found them.

---

## From plan 03 (flag-monitor denominator)

### DEF-141.2-03-A — stale route coordinates in a skipped test's comment

`src/__tests__/audit-coverage.test.ts:962-964` cites three
`src/app/api/cron/flag-monitor/route.ts:NN` coordinates, one of them a
"feature_flags upsert — kill-switch flip" site that **Phase 106 (Stage B)
retired**. The coordinates were already stale before plan 03 and are inside the
comment of an `it.skip(...)` block, not an assertion, so nothing reds. Plan 03's
edits shift the line numbers further.

- **Severity:** below the founder stopping rule (not user-facing, not
  data-integrity). Comment-only drift.
- **Why not fixed here:** pre-existing, and the surrounding `TODO(surfaced):
  H-0001` block is scheduled to be rewritten wholesale when `findMutations`
  single-line detection is fixed. Editing the coordinates now would be churn on
  text that is already slated for replacement.
- **Fix with:** the H-0001 work item.

### DEF-141.2-03-B — the unbounded-`.select()` class beyond the one finding

PATTERNS §1 censused **93** row-materialising chains with no
`.limit`/`.range`/`.single`/`head:true`. Plan 03 closes the single instance the
findings name (`flag-monitor`). The remaining members on **unbounded-growth
tables** are:

| Site | Table | Consequence of silent truncation at 1000 |
|------|-------|------------------------------------------|
| `src/app/api/benchmark/btc/route.ts:105-109` | `benchmark_prices` | ⚠️ **highest risk** — one row per day forever, ASC-ordered, so past 1000 daily closes the BTC benchmark chart silently drops the **newest** data and the series ends early with no marker |
| `src/app/api/cron/sync-funding/route.ts:59-63` | `strategies ⋈ api_keys` | cron enqueues only the first 1000 strategies; `total_candidates` reports the truncated number as truth |
| `src/app/api/cron/reconcile-strategies/route.ts:54-59` | same | same shape, nightly reconcile |
| `src/app/api/allocator/scenario/commit/route.ts:743-748` | `allocator_holdings` | under-counted `serverAumUsd` in the audit recompute; partly self-limiting (newest-first + first-seen-wins) but the tail is dropped |
| `src/lib/queries.ts:121-131`, `:217`, `:256` | `strategies` | discovery/browse counts and aggregates cap at 1000 |
| `src/app/(marketing)/page.tsx:14` | `strategies` | landing-page headline **AUM total** understates past 1000 published strategies |
| `src/app/api/cron/cleanup-ack-tokens/route.ts:41` | `used_ack_tokens` | distinct sub-shape — the DELETE executes fully; only the RETURNING body is capped, so the reported deletion COUNT is wrong, not the deletion |

- **Why not fixed here:** plan 03's scope is the denominator. PATTERNS'
  recommendation is explicit — log all of these as **one class entry** in
  `TODOS.md`, not eight point items.
- **Note:** the class is now proven against **deployed** PostgREST (7350 rows
  in `audit_log`, exactly 1000 returned, HTTP 200, `error: null`), not merely
  inferred from `supabase/config.toml`. It is a real cap in production.

### DEF-141.2-03-C — a true per-request error rate needs a server-minted request id

D-02 accepts a known **downward** bias: retries inflate the attempt-grained
denominator, so the monitor gets quieter exactly when the seam is retrying.
This is the safe direction (versus D-16's false pages and wire-controlled
silence) and is documented in the `getDenominator` docblock as a limitation.

Closing it properly requires a **server-minted request id that a retry reuses**
— a cross-seam contract change touching both the TypeScript client and the
Python handler. Out of scope for a defect-closure phase.

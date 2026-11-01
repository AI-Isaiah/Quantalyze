# MARKSOURCE read-only PROD census

> ⛔ **RETIRED 2026-10-31 (Phase 176 LEGACYRETIRE, D-02):** the snapshot census files in this directory read the legacy allocator equity table and stop working once the phase's last migration drops it. They are kept as the record of the MARKSOURCE census, not as live reads. Original text kept below.

Phase 167.2.1.1.1.1 (MARKSOURCE) measures PROD before it changes anything. Two founder decisions require it:

- **D-06** sets the dust floor (the share of an account below which a balance with no price is left out of the
  day with a named note) from a read-only count of unpriced balances by size.
- **D-05** rewrites past OKX rows, and the correction is measured read-only first: rows and accounts affected,
  and the size of the change.

Every file here is ONE read-only statement. Nothing in this directory writes. Phase 178 OKXREWRITE added `okx-nonworking-keys.sql`. `src/__tests__/marksource-okx-nonworking-keys-exec.test.ts` executes it, and the runbook's `crosswalk` and `enqueue` forms, on a throwaway local PostgreSQL cluster against hand-computed oracles; it runs in the ordinary vitest shards, so a change to the file's grouping, carry pad, window or outcome rule turns CI red.

| File | What it measures | Decision |
|------|------------------|----------|
| `marker.sql` | Which database the session is on. Run it first in every session. | P0 |
| `unpriced-balances-census.sql` | Unpriced balances by size bucket, for the latest day of each key and for all days, plus a `spot rows examined` row so an empty gap list is not read as a query that matched nothing. Counts only. | D-06 |
| `unpriced-balances-current.sql` | The current unpriced rows one by one: venue, symbol, quantity, last priced mark, share of the account level, plus a `spot rows examined` row (latest day of each key). Carries amounts. | D-06 |
| `okx-snapshot-census.sql` | How many OKX snapshot rows and accounts carry the double count, split by the 90-day window, and how many breach the phase tolerance. | D-05 |
| `okx-holdings-census.sql` | The same question for the allocator holdings USDT row, which has no recompute path. | D-05 |
| `okx-rebuild-feasibility.sql` | What a rebuild would face: key counts by venue and working state, the predicted 90-day window, days already bulk-written, whether a rebuild seam exists. | D-05 |
| `okx-snapshot-rows.sql` | The row set for a before and after diff around the rebuild. Carries amounts. | D-05 |
| `okx-nonworking-keys.sql` | Exchange accounts with no working key, grouped and decided as the rebuild does them (marker links followed transitively), the dead keys tested against the window, the predicted window, how many stored in-window days a dead key's holdings span plus the 7-day carry overlaps (and every stored day labelled 2026-09-29 to 2026-10-19, when the carry had no age cap), bulk-written in-window days, the hard-deleted keys the holdings polls' audit rows still name (`deleted_keys_seen_in_window`), the P7 outcome (`rebuild` or `not recomputed (D-06)`), and `key_digest`, an MD5 over the allocator's key ids and working flags that the forced job is bound to (scratch only: it hashes real ids, so it is never written in tracked text). Counts and day counts otherwise. | OKXREWRITE D-06 (P7) |

## How to run

1. From the main checkout (the only one linked to PROD), run `marker.sql` first with
   `supabase db query --linked -f docs/runbooks/marksource-okx-census/marker.sql`.
   Continue only if the answer names PRODUCTION. NULL or any other answer: stop.
2. Run each other file the same way, one call per file, output to a scratch directory outside the repo.
   The CLI returns only the last statement's rows, so each file is one statement. A leading comment line
   breaks the CLI's inline form, so the files carry no comments.

## What may be written down

Columns ending `_usd`, and the whole outputs of `unpriced-balances-current.sql` and `okx-snapshot-rows.sql`,
carry amounts. They stay in the operator's scratch directory and are deleted after use. Tracked text gets
counts, day counts, buckets, a-labels and ratios to 3 significant figures only. No id, amount or path.

The a-labels order accounts by their earliest OKX key, so they are stable between a before and an after run.
After the poll fix is deployed, refresh rows written from then on still read as `suspect`; subtract that tail
from `last_suspect_asof` when reading an after run.

The rebuild steps live in `docs/runbooks/marksource-okx-history-correction.md`.

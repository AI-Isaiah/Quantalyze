# MARKSOURCE read-only PROD census

Phase 167.2.1.1.1.1 (MARKSOURCE) measures PROD before it changes anything. Two founder decisions require it:

- **D-06** sets the dust floor (the share of an account below which a balance with no price is left out of the
  day with a named note) from a read-only count of unpriced balances by size.
- **D-05** rewrites past OKX rows, and the correction is measured read-only first: rows and accounts affected,
  and the size of the change.

Every file here is ONE read-only statement. Nothing in this directory writes.

| File | What it measures | Decision |
|------|------------------|----------|
| `marker.sql` | Which database the session is on. Run it first in every session. | P0 |
| `unpriced-balances-census.sql` | Unpriced balances by size bucket, for the latest day of each key and for all days, plus a `spot rows examined` row so an empty gap list is not read as a query that matched nothing. Counts only. | D-06 |
| `unpriced-balances-current.sql` | The current unpriced rows one by one: venue, symbol, quantity, last priced mark, share of the account level, plus a `spot rows examined` row (latest day of each key). Carries amounts. | D-06 |
| `okx-snapshot-census.sql` | How many OKX snapshot rows and accounts carry the double count, split by the 90-day window, and how many breach the phase tolerance. | D-05 |
| `okx-holdings-census.sql` | The same question for the allocator holdings USDT row, which has no recompute path. | D-05 |
| `okx-rebuild-feasibility.sql` | What a rebuild would face: key counts by venue and working state, the predicted 90-day window, days already bulk-written, whether a rebuild seam exists. | D-05 |
| `okx-snapshot-rows.sql` | The row set for a before and after diff around the rebuild. Carries amounts. | D-05 |

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

# ONEACCOUNTONCE one-time removal of same-owner duplicate keys (ONCE-03)

> ⛔ **DEVIATION FROM A STANDING RULE, recorded and cited.** This runbook DELETES rows. It overrides the
> standing rule "keep data; disconnect, never delete" and the never-deletes half of decision D-01, for
> **same-owner duplicates only**, on the founder's verbatim answer of 2026-11-23 recorded in the Phase 225
> context file (Q5: "Delete all duplicate keys. So same key in one accused twice. Delete also all associated
> factsheet, data etc.") and in the roadmap `### Phase 225` deviation line. The founder then confirmed the
> exact manifest ("Yes, delete all"): 13 same-owner duplicate keys (7 deribit, 1 mt5, 5 okx), all
> disconnected, 5 owners, plus the 2 strategies on them and their dependent rows. One account shared by
> several users is NOT touched: equal identity under two owners is the share link, and every user keeps
> their own factsheet.

The orchestrator runs this on PROD through the Supabase MCP. An executor has no MCP and no PROD access.
Every statement is read-only except `delete.sql`. `src/__tests__/oneaccountonce-delete-sql-exec.test.ts`
executes every file here on a throwaway local cluster (the real `delete_allocator_api_key` and the real
published-composite delete guard, tables cut from the baseline) and proves `delete.sql` removes exactly the
manifest and writes nothing on any difference.

## Run order (one statement per MCP call, never chained)

1. `marker.sql`. **STOP** if the answer is NULL or does not name PROD. Never proceed on a guess.
2. `census-keys.sql`, `census-strategies.sql`, `census-dependents.sql`, `census-triggers.sql`: four calls.
   Compare with the founder-confirmed manifest. **STOP and report on ANY difference** in the key or strategy
   set (count, exchange split, owners, a key live or a holder, the mt5 key's ordinal not `k2`, an ordinal
   `k1`, `k3` or `k10` inside the set), or ANY nonzero `rows_referencing` among foreign-key referencers with
   `in_confirmed_list = false`. Read `census-triggers.sql` before the run: a delete trigger that writes
   outside the confirmed tables makes `delete.sql` stop at its check H by design; name it to the founder, do
   not widen the list. The `non_fk_column` and `non_fk_derived` rows are report-only (see "Derived data").
3. Fill the four placeholder tokens in `delete.sql` and run it as **ONE call** (it carries its own
   `BEGIN` and `COMMIT`). Token format: each id token is a comma-separated list of uuids with no quotes
   (the file already holds the quotes), for example `id1,id2,id3`.

   | Token | Value |
   |-------|-------|
   | `{{MANIFEST_KEY_IDS}}` | every `id` row of `census-keys.sql` |
   | `{{MANIFEST_STRATEGY_IDS}}` | every `strategy` row `id` of `census-strategies.sql` |
   | `{{PROTECTED_KEY_IDS}}` | the 155.2 holder keys `k1`, `k3` and `k10` from the sealed keymap |
   | `{{EXPECTED_MARKER}}` | the exact text `marker.sql` returned in step 1 (never written in tracked text) |

   Any `RAISE` means **nothing was written** (one transaction): STOP and report which bracketed check fired.
   A `42501` has the same meaning: the claims setting did not survive in one transaction, so the delete
   function refused before writing. Do not retry by splitting the script.
4. Re-run the four census files for the after-counts. `census-keys.sql` must return zero rows.
5. Record before and after outputs, counts only (no id, no marker text), in the plan summary.

`delete.sql` stops, writing nothing, on: an empty, unfilled, NULL, repeated or malformed id list (check A);
a marker that is not the pasted one (A-marker); discovery that differs from the pasted keys in any way
(B-discovery); a manifest key that is live, a holder, in `strategy_keys` or protected (C-key-state); protected
keys missing (D-protected); a strategy set that differs or a strategy of another owner (E-strategies); any
row in a table that references `api_keys` or `strategies` and is outside the confirmed list, found from
`pg_constraint` and never from a hand list (F-off-manifest); a strategy delete that removes a different
count than expected (G-write); and, before COMMIT, a surviving manifest row, a changed protected key, or a
table outside the confirmed list written by the deletes (H-post-write, measured with
`pg_stat_xact_user_tables`, so a cascade into an unlisted table is caught however deep).

## Never set the GDPR sanitize bypass

⛔ The setting `quantalyze.sanitize_in_progress` must never be set by this run. It is the GDPR sanitize
path's bypass of `api_keys_published_composite_delete_guard`; setting it would disable the one guard that
protects a published composite during this deletion. The script runs the deletes under
`SET LOCAL ROLE authenticated` with the owner's claims, so that guard stays armed. A test pins that
`delete.sql` does not name the setting.

## Order of writes

Per owner: the owner's manifest strategies first (owner row-level policy decides), then each key through
`delete_allocator_api_key(key, true)`. Strategies go first because `strategies.api_key_id` is
`ON DELETE SET NULL`: deleting a key first would run the strategies update triggers against a published
row. `mt5_server_clock_readings` rows are never deleted directly (its write-once trigger refuses a direct
delete and admits the key cascade). After the checks pass, `derive_allocator_equity` is enqueued per owner so
each owner's equity curve recomposes without the deleted keys.

## 155.2 hazard: the MT5 keymap ordinals renumber

`docs/runbooks/mt5-parity/capture-keymap.sql` numbers every MT5 key, disconnected ones included, by
`created_at` then `id`. Deleting the one MT5 duplicate (155.2's `k2`) shifts every later ordinal down by
one: the sealed `k3` becomes `k2`, and `k10` becomes `k9`. The 155.2 plan 12 recapture must take a FRESH
keymap and `labels.json` from PROD after this run, and must never reuse a sealed ordinal list. The run also
has to land before 155.2 plan 12 starts or after plan 14 (roadmap 155.2 freeze).

## Derived data the manifest does not cover (OQ-4)

The founder's ruling was "delete also all associated factsheet, data", but the confirmed manifest is the scope
of this run. `delete_allocator_api_key` removes the `allocator_equity_derived` rows (`equity_curve` and
`key_inputs:<id>`) only for an owner's LAST key, and these owners keep their holder keys, so each deleted
key's `key_inputs:<id>` row survives. `census-dependents.sql` counts those rows and every other row keyed to
the manifest that no foreign key cascades (`non_fk_column`, `non_fk_derived`). `delete.sql` does NOT delete
them. The orchestrator reports the count to the founder and records the answer (delete in a follow-up run, or
leave) as an owned follow-up in the same records change, never silently.

## Files

| File | What it does |
|------|--------------|
| `marker.sql` | Which database the session is on. First, every session. |
| `census-keys.sql` | The same-owner duplicate keys, with per-key flags and the MT5 keymap ordinal. Read-only. |
| `census-strategies.sql` | The strategies on those keys, and any `strategy_keys` link to them. Read-only. |
| `census-dependents.sql` | Every foreign key into `api_keys` or `strategies` with its delete action, whether it is in the confirmed list and the rows referencing the census sets, plus the non-foreign-key derived rows. Read-only. |
| `census-triggers.sql` | The user triggers on `api_keys`, `strategies` and every confirmed table. Read-only. |
| `delete.sql` | The single-transaction, stop-on-difference delete. Writes. |

Tracked text carries counts only: no id, owner, key, marker text, PROD identifier or home path.

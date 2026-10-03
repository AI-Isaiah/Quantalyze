#!/usr/bin/env node
/**
 * Phase 167.1.2 plan 08 (success criterion 6): the read-only ACCOUNTTRUTH census.
 *
 * It measures PROD before anything is recomputed and prints aggregate counts
 * only. The repo is public, so no key id, user id, label, email or USD value is
 * ever printed (T-167.1.2-38). Every row the database returns is a
 * `bucket<TAB>count` pair; a bucket that is not a plain token, or that looks
 * like an id, aborts the run instead of being printed.
 *
 * The census sections, one SELECT each:
 *   (a) live keys by exchange, and those with venue_account_id NULL;
 *   (b) keys marked `duplicate` / `composite_member`, and the duplicates that
 *       still hold the book back (the reader's countsAsDuplicate rule);
 *   (c) owners whose eligible keys lack csv_daily_returns or a key_inputs row;
 *   (d) equity_curve rows by payload version and is_trustworthy, and the
 *       degrade_reasons token frequencies;
 *   (e) owners whose equityHistoryState would be "ready", else the reason;
 *   (f) departed keys by their D-09 default outcome, and departed keys whose
 *       key_inputs row is already gone.
 *
 * THREE WAYS TO RUN IT
 *
 *   node scripts/accounttruth-census.mjs
 *       Live. Connects like the prod prober (scripts/prod-prober/seams.mjs
 *       realSqlRunner): the DSN from PROBER_POOLER_URL (no password in it), the
 *       password from PGPASSWORD (or SUPABASE_DB_PASSWORD, as the prober reads
 *       it) handed to psql as PGPASSWORD in a child environment built from
 *       scratch, `-v ON_ERROR_STOP=1 -At -q -X`, and
 *       PGOPTIONS=-c default_transaction_read_only=on. The marker query runs
 *       FIRST and the run aborts unless its answer EQUALS `database_marker` in
 *       scripts/prod-prober/cron-manifest.json, read at run time and never
 *       restated here (I2: TEST carries a marker too, so non-NULL is not
 *       enough). Then the session's transaction_read_only is read back and must
 *       be `on`; a pooler that silently dropped PGOPTIONS fails loud here.
 *       PGOPTIONS also sets row_security=off, and the role must bypass RLS
 *       (RLS_PROBE_SQL), so RLS can never shrink a count without an error.
 *
 *   node scripts/accounttruth-census.mjs --print-sql[=<label>]
 *       Touches no database. Prints the marker query, the RLS probe and each
 *       census query as a standalone, single-statement SELECT, each under a
 *       `-- census (<label>)` line, for an operator who runs reads through
 *       `supabase db query --linked` and holds no password. Submit ONE label
 *       per call, in order: marker (must equal the manifest's PROD marker),
 *       rls (must answer bypasses_rls), then a to f. Batched together, the
 *       marker would gate nothing. Each printed statement is identical to what
 *       live mode sends, apart from the terminating `;` the print adds.
 *       --print-sql takes no other argument; any other argument is a usage error.
 *       The read-only transaction is NOT behind this path, so the static guard
 *       in src/__tests__/accounttruth-census.test.ts is the barrier there.
 *
 *   node scripts/accounttruth-census.mjs --fixture <answers.json>
 *       The test seam (like the prober's fixtureSql): canned answers per query,
 *       the same marker discipline, the same output.
 *
 * Exit codes: 0 census printed; 1 refused or could not measure; 2 usage.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { DB_MARKER_SQL, MANIFEST_PATH } from "./prod-prober/arms/cron-drift.mjs";

export { DB_MARKER_SQL };

/**
 * Read back after the marker, live mode only: it must answer `on<TAB>off`. A
 * pooler that silently dropped PGOPTIONS fails loud here.
 */
export const READ_ONLY_PROBE_SQL = `SELECT current_setting('transaction_read_only') AS transaction_read_only, current_setting('row_security') AS row_security`;

/**
 * Row-level security must not shrink the census. allocator_equity_derived is
 * FORCE ROW LEVEL SECURITY and api_keys / csv_daily_returns have RLS enabled,
 * so a role that neither is superuser nor has BYPASSRLS would see FEWER rows
 * with no error, and (c) to (f) would print plausible, wrong counts. Live mode
 * also sets row_security=off, which turns a filtered read into an error. On
 * the --print-sql path this probe is the only check: it must answer
 * `bypasses_rls` before (a) to (f) are trusted.
 */
export const RLS_PROBE_SQL = `SELECT CASE WHEN r.rolsuper OR r.rolbypassrls THEN 'bypasses_rls' ELSE 'subject_to_rls' END AS rls FROM pg_roles r WHERE r.rolname = current_user`;

export const SQL_TIMEOUT_MS = 120000;
export const PGOPTIONS_READ_ONLY = "-c default_transaction_read_only=on -c row_security=off -c statement_timeout=110000";

// JS String.prototype.trim() whitespace that matters for an account id, so
// btrim() agrees with knownVenueAccountId / accountIdentityTokens.
const WS = String.raw`' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)`;

// One row per api_keys row, with the three predicates every section shares:
//   eligible = isPerKeyDailiesEligibleKey (queries.ts) = isLiveKey
//              (departed-history.ts) = the derive's eligible_key_predicate;
//   working  = isWorkingHolder (account-share-note.ts, D-18), its
//              NOT_WORKING_SYNC_STATUSES tuple; a NULL sync_status is working;
//   venue_known = knownVenueAccountId (queries.ts).
const KEYS_CTE = String.raw`keys AS (
  SELECT ak.id,
         ak.user_id,
         lower(btrim(ak.exchange)) AS exchange,
         ak.sync_status,
         ak.disconnected_at,
         ak.venue_account_id,
         ak.account_shared_with_api_key_id AS holder_id,
         ak.account_share_kind AS share_kind,
         ak.history_inclusion,
         (ak.is_active AND ak.sync_status IS DISTINCT FROM 'revoked' AND ak.disconnected_at IS NULL) AS eligible,
         (ak.is_active AND ak.disconnected_at IS NULL
           AND (ak.sync_status IS NULL OR ak.sync_status NOT IN ('revoked', 'sign_in_failed', 'error'))) AS working,
         COALESCE(btrim(ak.venue_account_id, ${WS}) <> '', false) AS venue_known
    FROM public.api_keys ak
)`;

// (a) Every exchange the api_keys_exchange_check CHECK allows is listed, so a
// zero prints as 0 rather than as a missing line. Any other exchange a key
// carries is added to the list (SFH L-2), so a venue the CHECK admits later gets
// its own per-exchange lines and the per-exchange lines still add up to `all.*`.
//
// `live_keys_venue_account_id_null` counts every NULL, and a key the stamper
// MARKED as sharing an account keeps a NULL by design (the unique index refuses
// its id; services/account_identity.py _mark_shared), so that bucket cannot
// fall to 0 while a duplicate is live. `live_keys_unstamped_unmarked` is the
// subset the stamper has not resolved. That is the bucket the runbook's stamp
// gate reads (debug unstamped-venue-account-id, 2026-10-03: 12 of 14 NULL keys
// on PROD were marked duplicates).
//
// A marker counts as resolved only while its holder, in the same owner's keys
// and on the same exchange, still has disconnected_at NULL and a known
// venue_account_id: that is the condition of the partial unique index
// api_keys_user_exchange_venue_account_uniq (user_id, exchange,
// venue_account_id WHERE venue_account_id IS NOT NULL AND disconnected_at IS
// NULL), so only such a holder still holds the slot that blocks this key's
// stamp (IN-R2-03: a connected holder with no id, or on another exchange,
// holds no slot this key could collide with). The marker is never cleared when the holder departs
// (D-18), and a key marked against a departed holder is no longer refused by
// the index, is not stamped until its own next successful poll, and is outside
// the duplicate check until then. So it counts here as unresolved. `eligible`
// is deliberately NOT the holder test: a revoked holder that is still
// connected keeps its index slot, and its marked sibling is resolved.
export const FIXED_EXCHANGES = Object.freeze(["binance", "okx", "bybit", "deribit", "sfox", "mt5"]);
const SQL_A = String.raw`WITH ${KEYS_CTE},
exchanges AS (
  SELECT x.exchange FROM (VALUES ${FIXED_EXCHANGES.map((x) => `('${x}')`).join(", ")}) AS x (exchange)
  UNION
  SELECT k.exchange FROM keys k
),
unresolved AS (
  SELECT k.id, k.exchange
    FROM keys k
   WHERE k.eligible
     AND NOT k.venue_known
     AND NOT EXISTS (SELECT 1 FROM keys h
                      WHERE h.id = k.holder_id AND h.user_id = k.user_id
                        AND h.disconnected_at IS NULL
                        AND h.venue_known AND h.exchange = k.exchange)
)
SELECT e.exchange || '.live_keys' AS bucket, count(k.id) AS n
  FROM exchanges e LEFT JOIN keys k ON k.exchange = e.exchange AND k.eligible
 GROUP BY e.exchange
UNION ALL
SELECT e.exchange || '.live_keys_venue_account_id_null', count(k.id)
  FROM exchanges e LEFT JOIN keys k ON k.exchange = e.exchange AND k.eligible AND NOT k.venue_known
 GROUP BY e.exchange
UNION ALL
SELECT e.exchange || '.live_keys_unstamped_unmarked', count(u.id)
  FROM exchanges e LEFT JOIN unresolved u ON u.exchange = e.exchange
 GROUP BY e.exchange
UNION ALL
SELECT 'all.live_keys', count(*) FROM keys WHERE eligible
UNION ALL
SELECT 'all.live_keys_venue_account_id_null', count(*) FROM keys WHERE eligible AND NOT venue_known
UNION ALL
SELECT 'all.live_keys_unstamped_unmarked', count(*) FROM unresolved
ORDER BY 1`;

// (b) The marker is never cleared when a key departs (D-18), so the raw counts
// cannot reach 0 after a cleanup. `duplicate.blocking` mirrors queries.ts
// countsAsDuplicate: the marked key is eligible and its holder, in the same
// owner's keys, is working. That is the count the runbook's cleanup gate reads.
const SQL_B = String.raw`WITH ${KEYS_CTE},
blocking AS (
  SELECT k.user_id
    FROM keys k
    JOIN keys h ON h.id = k.holder_id AND h.user_id = k.user_id
   WHERE k.eligible AND k.share_kind = 'duplicate' AND h.working
)
SELECT 'duplicate.marked' AS bucket, count(*) FILTER (WHERE share_kind = 'duplicate') AS n FROM keys
UNION ALL
SELECT 'duplicate.marked_live', count(*) FILTER (WHERE share_kind = 'duplicate' AND eligible) FROM keys
UNION ALL
SELECT 'duplicate.blocking', count(*) FROM blocking
UNION ALL
SELECT 'duplicate.blocking_owners', count(DISTINCT user_id) FROM blocking
UNION ALL
SELECT 'composite_member.marked', count(*) FILTER (WHERE share_kind = 'composite_member') FROM keys
UNION ALL
SELECT 'composite_member.marked_live', count(*) FILTER (WHERE share_kind = 'composite_member' AND eligible) FROM keys
ORDER BY 1`;

// (c) Population: owners with at least one eligible key, role-agnostic, as
// enqueue_derive_broker_dailies_for_allocator_keys fans out. Per-key returns
// are read the way the derive reads them (_load_allocator_daily_returns:
// allocator_id = owner AND api_key_id = key); key_inputs is the
// `key_inputs:<api_key_id>` row of allocator_equity_derived.
const SQL_C = String.raw`WITH ${KEYS_CTE},
el AS (
  SELECT k.id,
         k.user_id,
         EXISTS (SELECT 1 FROM public.csv_daily_returns r
                  WHERE r.api_key_id = k.id AND r.allocator_id = k.user_id) AS has_returns,
         EXISTS (SELECT 1 FROM public.allocator_equity_derived d
                  WHERE d.allocator_id = k.user_id AND d.kind = 'key_inputs:' || k.id::text) AS has_key_inputs
    FROM keys k
   WHERE k.eligible
),
own AS (
  SELECT user_id, bool_and(has_returns) AS all_returns, bool_and(has_key_inputs) AS all_key_inputs
    FROM el
   GROUP BY user_id
)
SELECT 'owners_with_eligible_keys' AS bucket, count(*) AS n FROM own
UNION ALL
SELECT 'owners_missing_returns', count(*) FILTER (WHERE NOT all_returns) FROM own
UNION ALL
SELECT 'owners_missing_key_inputs', count(*) FILTER (WHERE NOT all_key_inputs) FROM own
UNION ALL
SELECT 'owners_missing_either', count(*) FILTER (WHERE NOT (all_returns AND all_key_inputs)) FROM own
UNION ALL
SELECT 'eligible_keys', count(*) FROM el
UNION ALL
SELECT 'eligible_keys_missing_returns', count(*) FILTER (WHERE NOT has_returns) FROM el
UNION ALL
SELECT 'eligible_keys_missing_key_inputs', count(*) FILTER (WHERE NOT has_key_inputs) FROM el
ORDER BY 1`;

// (d) Tokens are the writer's enum values (allocator_equity_compose.py,
// `degrade_reasons: sorted(r.value ...)`). Anything that is not a plain
// lower-case token is counted as `unrecognised`, never printed.
const SQL_D = String.raw`WITH curves AS (
  SELECT d.payload AS p FROM public.allocator_equity_derived d WHERE d.kind = 'equity_curve'
)
SELECT 'equity_curve_rows' AS bucket, count(*) AS n FROM curves
UNION ALL
SELECT 'version=' || CASE
           WHEN jsonb_typeof(p -> 'version') = 'number' AND (p ->> 'version') ~ '^[0-9]{1,3}$' THEN p ->> 'version'
           WHEN p -> 'version' IS NULL THEN 'absent'
           ELSE 'unrecognised'
         END
       || ',is_trustworthy=' || CASE
           WHEN jsonb_typeof(p -> 'is_trustworthy') = 'boolean' THEN p ->> 'is_trustworthy'
           WHEN p -> 'is_trustworthy' IS NULL THEN 'absent'
           ELSE 'unrecognised'
         END,
       count(*)
  FROM curves
 GROUP BY 1
UNION ALL
SELECT 'degrade_reason=' || CASE
           WHEN jsonb_typeof(t.token) = 'string' AND (t.token #>> '{}') ~ '^[a-z][a-z0-9_]{0,63}$' THEN t.token #>> '{}'
           ELSE 'unrecognised'
         END,
       count(*)
  FROM curves
 CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(p -> 'degrade_reasons') = 'array' THEN p -> 'degrade_reasons' ELSE '[]'::jsonb END
       ) AS t (token)
 GROUP BY 1
ORDER BY 1`;

// (e) Mirrors queries.ts equityHistoryReadiness, in its order:
//   duplicate_account        countsAsDuplicate (see (b));
//   key_not_syncing          an identityStillPending key that is failing to
//                            sync (NOT_WORKING_SYNC_STATUSES);
//   account_identity_pending identityStillPending: eligible, on
//                            ACCOUNT_IDENTITY_EXCHANGES, not composite_member,
//                            no known venue id, and not a duplicate whose
//                            holder carries a known id;
//   then the series: extractTrustworthyDerivedSeries accepts the row -> ready;
//   else derivedPayloadRejection + untrustworthyRebuildReason name the reason
//   (no row or a pre-v2 row -> awaiting_derivation; a JSON array is an
//   object to JS `typeof`, so it reads as pre-v2 too, while a scalar or JSON
//   null is `malformed`). `history_read_failed` is
//   a read failure on the page and has no SQL twin.
// Population: owners with at least one eligible key (hasConnectedKeys).
const SQL_E = String.raw`WITH ${KEYS_CTE},
owners AS (
  SELECT DISTINCT user_id FROM keys WHERE eligible
),
dup AS (
  SELECT DISTINCT k.user_id
    FROM keys k
    JOIN keys h ON h.id = k.holder_id AND h.user_id = k.user_id
   WHERE k.eligible AND k.share_kind = 'duplicate' AND h.working
),
pending AS (
  SELECT k.user_id,
         bool_or(COALESCE(k.sync_status IN ('revoked', 'sign_in_failed', 'error'), false)) AS any_failing
    FROM keys k
    LEFT JOIN keys h ON h.id = k.holder_id AND h.user_id = k.user_id
   WHERE k.eligible
     AND k.exchange IN ('binance', 'okx', 'bybit', 'deribit')
     AND k.share_kind IS DISTINCT FROM 'composite_member'
     AND NOT k.venue_known
     AND NOT COALESCE(k.share_kind = 'duplicate' AND h.id IS NOT NULL AND h.venue_known, false)
   GROUP BY k.user_id
),
curve AS (
  SELECT d.allocator_id,
         d.payload AS p,
         CASE WHEN jsonb_typeof(d.payload -> 'curve') = 'array' THEN d.payload -> 'curve' ELSE '[]'::jsonb END AS c,
         CASE WHEN jsonb_typeof(d.payload -> 'returns') = 'array' THEN d.payload -> 'returns' ELSE '[]'::jsonb END AS r
    FROM public.allocator_equity_derived d
   WHERE d.kind = 'equity_curve'
),
judged AS (
  SELECT cv.allocator_id,
         COALESCE(jsonb_typeof(cv.p) IN ('object', 'array'), false) AS is_object,
         COALESCE(jsonb_typeof(cv.p -> 'version') = 'number' AND cv.p -> 'version' = '2'::jsonb, false) AS is_v2,
         COALESCE(cv.p -> 'is_trustworthy' = 'true'::jsonb, false) AS is_trustworthy,
         (jsonb_array_length(cv.c) > 0
           AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(cv.c) AS pt (e)
              WHERE NOT COALESCE(
                      jsonb_typeof(pt.e) = 'object'
                  AND jsonb_typeof(pt.e -> 'date') = 'string'
                  AND (pt.e ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
                  AND jsonb_typeof(pt.e -> 'equity_usd') = 'number', false))
           AND jsonb_array_length(cv.r) > 0
           AND NOT EXISTS (
             SELECT 1
               FROM (SELECT rt.e, lag(rt.e ->> 'date') OVER (ORDER BY rt.o) AS prev
                       FROM jsonb_array_elements(cv.r) WITH ORDINALITY AS rt (e, o)) AS s
              WHERE NOT COALESCE(
                      jsonb_typeof(s.e) = 'object'
                  AND jsonb_typeof(s.e -> 'date') = 'string'
                  AND (s.e ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
                  AND jsonb_typeof(s.e -> 'r') = 'number'
                  AND (s.prev IS NULL OR (s.e ->> 'date') COLLATE "C" > s.prev COLLATE "C"), false))
         ) AS well_formed,
         CASE
           WHEN COALESCE(jsonb_typeof(cv.p -> 'degrade_reasons') = 'array', false) IS NOT TRUE THEN 'derivation_rejected'
           WHEN cv.p -> 'degrade_reasons' @> '["shared_account_no_working_key"]'::jsonb THEN 'shared_account_no_working_key'
           WHEN cv.p -> 'degrade_reasons' @> '["shared_account_history_truncated"]'::jsonb THEN 'shared_account_history_truncated'
           ELSE 'derivation_rejected'
         END AS untrustworthy_reason
    FROM curve cv
),
state AS (
  SELECT o.user_id,
         CASE
           WHEN dp.user_id IS NOT NULL THEN 'rebuilding:duplicate_account'
           WHEN pn.any_failing THEN 'rebuilding:key_not_syncing'
           WHEN pn.user_id IS NOT NULL THEN 'rebuilding:account_identity_pending'
           WHEN j.allocator_id IS NULL THEN 'rebuilding:awaiting_derivation'
           WHEN j.is_object AND j.is_v2 AND j.is_trustworthy AND j.well_formed THEN 'ready'
           WHEN NOT j.is_object THEN 'rebuilding:derivation_rejected'
           WHEN NOT j.is_v2 THEN 'rebuilding:awaiting_derivation'
           WHEN NOT j.is_trustworthy THEN 'rebuilding:' || j.untrustworthy_reason
           ELSE 'rebuilding:derivation_rejected'
         END AS s
    FROM owners o
    LEFT JOIN dup dp ON dp.user_id = o.user_id
    LEFT JOIN pending pn ON pn.user_id = o.user_id
    LEFT JOIN judged j ON j.allocator_id = o.user_id
)
SELECT 'owners_with_eligible_keys' AS bucket, count(*) AS n FROM state
UNION ALL
SELECT 'ready', count(*) FILTER (WHERE s = 'ready') FROM state
UNION ALL
SELECT s, count(*) FROM state WHERE s <> 'ready' GROUP BY s
ORDER BY 1`;

// (f) The D-09 decision, cases (1) to (3) with the 2026-09-29 amendments, for
// every departed key (not eligible). A SQL twin of departedHistoryInclusion
// (src/lib/departed-history.ts) and departed_history_inclusion
// (analytics-service/services/job_worker.py), pinned by the shared fixture
// analytics-service/tests/fixtures/departed_history_inclusion.json:
//   tok      accountIdentityTokens: one token per component of the graph
//            "same (exchange, trimmed venue id)" + "marked against a holder in
//            the owner's keys"; a key in no such edge and with no venue id has
//            no token (unknown).
//   win      ownWindow: [first returns day, min(UTC day of disconnected_at or
//            last day, last day)], or none.
//   cd       the departed keys that count on the account in D-09 order
//            (first day, last day, id), excluded and windowless keys left out,
//            and (WR-R2-02) an unanchored key only when it is the one decided.
//   covered  SFH-C4-07: its window ends before that of a key ordered ahead.
//   anchored departedAnchorOf: a key_inputs row whose anchor_usd is a number.
// Exposed as DEPARTED_DECISION_CTES so the per-key decision can be compared
// with that fixture: src/__tests__/accounttruth-census.test.ts section (6)
// replays every case a timestamptz column can hold on a throwaway local
// cluster, in CI. The census itself prints counts only.
export const DEPARTED_DECISION_CTES = String.raw`${KEYS_CTE},
days AS (
  SELECT r.api_key_id, min(r.date) AS first_day, max(r.date) AS last_day
    FROM public.csv_daily_returns r
    JOIN keys k ON k.id = r.api_key_id AND k.user_id = r.allocator_id
   GROUP BY r.api_key_id
),
kw AS (
  SELECT k.*,
         dy.first_day,
         dy.last_day,
         NOT k.eligible AS departed,
         (ki.kind IS NOT NULL) AS key_inputs_present,
         COALESCE(jsonb_typeof(ki.payload -> 'anchor_usd') = 'number', false) AS anchored,
         CASE
           WHEN dy.first_day IS NOT NULL
            AND least(COALESCE((k.disconnected_at AT TIME ZONE 'UTC')::date, dy.last_day), dy.last_day) >= dy.first_day
           THEN least(COALESCE((k.disconnected_at AT TIME ZONE 'UTC')::date, dy.last_day), dy.last_day)
         END AS win_until
    FROM keys k
    LEFT JOIN days dy ON dy.api_key_id = k.id
    LEFT JOIN public.allocator_equity_derived ki
           ON ki.allocator_id = k.user_id AND ki.kind = 'key_inputs:' || k.id::text
),
edges AS (
  SELECT a.id AS x, b.id AS y
    FROM kw a
    JOIN kw b ON b.user_id = a.user_id AND b.id <> a.id AND b.exchange = a.exchange
   WHERE a.venue_known AND b.venue_known
     AND btrim(a.venue_account_id, ${WS}) = btrim(b.venue_account_id, ${WS})
  UNION
  SELECT a.id, h.id
    FROM kw a
    JOIN kw h ON h.id = a.holder_id AND h.user_id = a.user_id AND h.id <> a.id
   WHERE a.share_kind IN ('duplicate', 'composite_member')
  UNION
  SELECT h.id, a.id
    FROM kw a
    JOIN kw h ON h.id = a.holder_id AND h.user_id = a.user_id AND h.id <> a.id
   WHERE a.share_kind IN ('duplicate', 'composite_member')
),
known AS (
  SELECT id FROM kw WHERE venue_known
  UNION
  SELECT x FROM edges
),
reach (src, dst) AS (
  SELECT id, id FROM known
  UNION
  SELECT rc.src, ed.y FROM reach rc JOIN edges ed ON ed.x = rc.dst
),
tok AS (
  SELECT src AS id, min(dst::text) AS token FROM reach GROUP BY src
),
decided AS (
  SELECT k.*, t.token
    FROM kw k
    LEFT JOIN tok t ON t.id = k.id
   WHERE k.departed
),
pairs AS (
  SELECT d.id AS did, o.id, o.departed, o.history_inclusion, o.first_day, o.last_day, o.win_until, o.anchored
    FROM decided d
    JOIN tok ot ON ot.token = d.token
    JOIN kw o ON o.id = ot.id
   WHERE d.token IS NOT NULL
     AND d.history_inclusion IS DISTINCT FROM 'exclude'
     AND d.win_until IS NOT NULL
),
live_on_account AS (
  SELECT did,
         count(*) AS live_n,
         bool_or(first_day IS NULL) AS live_pending,
         min(COALESCE(first_day, '-infinity'::date)) AS live_first
    FROM pairs
   WHERE id <> did AND NOT departed
   GROUP BY did
),
cd AS (
  SELECT did, id, first_day, win_until,
         row_number() OVER w AS pos,
         max(win_until) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max
    FROM pairs
   WHERE departed
     AND history_inclusion IS DISTINCT FROM 'exclude'
     AND win_until IS NOT NULL
     AND (id = did OR anchored)
  WINDOW w AS (PARTITION BY did ORDER BY first_day, last_day, id::text COLLATE "C")
),
cdc AS (
  SELECT cd.*, COALESCE(cd.win_until < cd.prev_max, false) AS covered FROM cd
),
me AS (
  SELECT m.did, m.pos, m.covered,
         CASE WHEN m.covered THEN NULL ELSE (
           SELECT c.first_day FROM cdc c
            WHERE c.did = m.did AND c.pos > m.pos AND NOT c.covered
            ORDER BY c.pos
            LIMIT 1) END AS successor_first
    FROM cdc m
   WHERE m.id = m.did
),
judged AS (
  SELECT d.id, d.first_day, d.win_until, d.history_inclusion, d.token,
         d.key_inputs_present, d.anchored,
         me.pos, me.covered, me.successor_first,
         COALESCE(lv.live_n, 0) AS live_n,
         COALESCE(lv.live_pending, false) AS live_pending,
         least(d.win_until,
               CASE WHEN lv.live_n > 0 THEN lv.live_first - 1 END,
               CASE WHEN me.covered THEN '-infinity'::date END,
               me.successor_first - 1) AS counted_until
    FROM decided d
    LEFT JOIN me ON me.did = d.id
    LEFT JOIN live_on_account lv ON lv.did = d.id
),
decision AS (
  SELECT j.id, j.key_inputs_present, j.anchored,
         CASE
           WHEN j.history_inclusion = 'exclude' THEN false
           WHEN j.win_until IS NULL THEN false
           WHEN j.token IS NULL THEN j.history_inclusion IS NOT DISTINCT FROM 'include'
           ELSE j.counted_until >= j.first_day
         END AS included,
         CASE
           WHEN j.history_inclusion = 'exclude' THEN NULL
           WHEN j.win_until IS NULL THEN NULL
           WHEN j.token IS NULL THEN CASE WHEN j.history_inclusion = 'include' THEN j.win_until END
           WHEN j.counted_until >= j.first_day THEN j.counted_until
         END AS until_day,
         CASE
           WHEN j.history_inclusion = 'exclude' THEN 'owner_excluded'
           WHEN j.win_until IS NULL THEN 'no_returns'
           WHEN j.token IS NULL THEN CASE WHEN j.history_inclusion = 'include' THEN 'owner_included' ELSE 'account_unknown' END
           WHEN j.live_pending THEN 'same_account_as_connected_key_pending'
           WHEN j.live_n > 0 THEN 'same_account_as_connected_key'
           WHEN j.covered THEN 'same_account_as_earlier_key'
           WHEN j.successor_first IS NOT NULL THEN 'same_account_as_later_key'
           WHEN j.pos > 1 THEN 'latest_key_on_account'
           ELSE 'distinct_account'
         END AS reason
    FROM judged j
)`;

const SQL_F = String.raw`WITH RECURSIVE ${DEPARTED_DECISION_CTES}
SELECT 'departed_keys' AS bucket, count(*) AS n FROM decision
UNION ALL
SELECT CASE WHEN included THEN 'included:' ELSE 'excluded:' END || reason, count(*) FROM decision GROUP BY 1
UNION ALL
SELECT 'departed_key_inputs_row_gone', count(*) FILTER (WHERE NOT key_inputs_present) FROM decision
UNION ALL
SELECT 'departed_key_inputs_anchor_unusable', count(*) FILTER (WHERE key_inputs_present AND NOT anchored) FROM decision
UNION ALL
SELECT 'included_but_history_unavailable', count(*) FILTER (WHERE included AND NOT anchored) FROM decision
ORDER BY 1`;

/**
 * The census, in the order it runs and prints. `sql` is sent verbatim.
 *
 * `required` (SFH M-4) lists the buckets a section returns by construction:
 * the arms that are an un-grouped aggregate, or a fixed VALUES list joined and
 * grouped. Every section has at least one, so an answer with no rows, or
 * without one of them, means the read did not run the statement this script
 * sent, and the run fails rather than printing a section an operator could read
 * as zeros. A GROUP BY bucket over data, such as (d)'s
 * `version=2,is_trustworthy=true` or (e)'s `rebuilding:*`, is absent exactly
 * when its count is 0, so it is never required.
 *
 * `gate` names the buckets the recompute runbook's section table gates on. Each
 * must be in `required`, so an absent gate line fails the run, except (d)'s,
 * which is a GROUP BY bucket whose absence is a 0 (`gateMayBeAbsent`). That 0
 * is printed explicitly, marked absent (SFH R2-L2), so every gate the runbook
 * reads appears on the printout.
 */
export const SECTIONS = Object.freeze([
  {
    letter: "a",
    title: "live keys by exchange, and those with venue_account_id NULL",
    sql: SQL_A,
    required: [
      ...FIXED_EXCHANGES.flatMap((x) => [
        `${x}.live_keys`,
        `${x}.live_keys_venue_account_id_null`,
        `${x}.live_keys_unstamped_unmarked`,
      ]),
      "all.live_keys",
      "all.live_keys_venue_account_id_null",
      "all.live_keys_unstamped_unmarked",
    ],
    gate: FIXED_EXCHANGES.map((x) => `${x}.live_keys_unstamped_unmarked`),
  },
  {
    letter: "b",
    title: "keys marked duplicate / composite_member, and duplicates that hold a book back",
    sql: SQL_B,
    required: [
      "duplicate.marked",
      "duplicate.marked_live",
      "duplicate.blocking",
      "duplicate.blocking_owners",
      "composite_member.marked",
      "composite_member.marked_live",
    ],
    gate: ["duplicate.blocking"],
  },
  {
    letter: "c",
    title: "owners whose eligible keys lack csv_daily_returns or a key_inputs row",
    sql: SQL_C,
    required: [
      "owners_with_eligible_keys",
      "owners_missing_returns",
      "owners_missing_key_inputs",
      "owners_missing_either",
      "eligible_keys",
      "eligible_keys_missing_returns",
      "eligible_keys_missing_key_inputs",
    ],
    gate: ["owners_missing_either"],
  },
  {
    letter: "d",
    title: "equity_curve rows by payload version and is_trustworthy, and degrade_reasons tokens",
    sql: SQL_D,
    required: ["equity_curve_rows"],
    gate: ["version=2,is_trustworthy=true"],
    gateMayBeAbsent: true,
  },
  {
    letter: "e",
    title: "owners whose equityHistoryState would be ready, else the reason",
    sql: SQL_E,
    required: ["owners_with_eligible_keys", "ready"],
    gate: ["ready"],
  },
  {
    letter: "f",
    title: "departed keys by D-09 default outcome, and departed keys whose key_inputs row is gone",
    sql: SQL_F,
    required: [
      "departed_keys",
      "departed_key_inputs_row_gone",
      "departed_key_inputs_anchor_unusable",
      "included_but_history_unavailable",
    ],
    gate: ["departed_key_inputs_row_gone"],
  },
].map((s) => Object.freeze({ gateMayBeAbsent: false, ...s, required: Object.freeze(s.required), gate: Object.freeze(s.gate) })));

/** Every statement the script can send, by label. */
export function allStatements() {
  return [
    { label: "marker", sql: DB_MARKER_SQL },
    { label: "rls", sql: RLS_PROBE_SQL },
    ...SECTIONS.map((s) => ({ label: s.letter, sql: s.sql })),
  ];
}

const UUID_RE = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i;
const BUCKET_RE = /^[a-z0-9_.:=,]{1,120}$/;

/** The PROD marker, from the manifest at run time (I2: one source). */
export function readManifestMarker(path = MANIFEST_PATH) {
  const marker = JSON.parse(readFileSync(path, "utf8")).database_marker;
  if (typeof marker !== "string" || marker === "") {
    throw new Error(`no database_marker in ${path}`);
  }
  return marker;
}

/**
 * The psql argv and child environment for one query. Pure, so the test can pin
 * the read-only option and the password channel without running psql.
 */
export function psqlInvocation(env, query) {
  return {
    argv: [env.PROBER_POOLER_URL, "-v", "ON_ERROR_STOP=1", "-At", "-q", "-F", "\t", "-X", "-c", query],
    env: {
      PATH: env.PATH,
      PGPASSWORD: env.PGPASSWORD || env.SUPABASE_DB_PASSWORD,
      PGCONNECT_TIMEOUT: "15",
      PGOPTIONS: PGOPTIONS_READ_ONLY,
    },
  };
}

/** The live runner: psql, one session per statement, stderr redacted. */
export function realSqlRunner(env, spawn = spawnSync) {
  const url = env.PROBER_POOLER_URL;
  const redact = (text) => {
    const first = String(text || "").split("\n")[0].trim();
    return url ? first.split(url).join("<pooler-url>") : first;
  };
  return (query) => {
    const inv = psqlInvocation(env, query);
    const child = spawn("psql", inv.argv, { timeout: SQL_TIMEOUT_MS, encoding: "utf8", env: inv.env });
    if (child.error && child.error.code === "ENOENT") return { stdout: "", measureFail: "psql not found on PATH" };
    if (child.signal || (child.error && child.error.code === "ETIMEDOUT")) {
      return { stdout: "", measureFail: `psql timed out after ${SQL_TIMEOUT_MS / 1000}s` };
    }
    if (child.error) return { stdout: "", measureFail: `psql could not be spawned: ${redact(child.error.message)}` };
    if (child.status !== 0) return { stdout: "", measureFail: `psql exited ${child.status}: ${redact(child.stderr)}` };
    return { stdout: child.stdout || "", measureFail: null };
  };
}

/**
 * The test seam. `fixture` = { marker: string|null, read_only?: string,
 * row_security?: string, rls?: string, sections: { a: [[bucket, n], ...], ... } }. A query it has no answer for is
 * a measure failure, never an empty answer.
 */
export function fixtureSqlRunner(fixture) {
  const byQuery = new Map(SECTIONS.map((s) => [s.sql, s.letter]));
  return (query) => {
    if (query === DB_MARKER_SQL) {
      return { stdout: fixture.marker == null ? "\n" : `${fixture.marker}\n`, measureFail: null };
    }
    if (query === READ_ONLY_PROBE_SQL) {
      return { stdout: `${fixture.read_only ?? "on"}\t${fixture.row_security ?? "off"}\n`, measureFail: null };
    }
    if (query === RLS_PROBE_SQL) {
      return { stdout: `${fixture.rls ?? "bypasses_rls"}\n`, measureFail: null };
    }
    const letter = byQuery.get(query);
    const rows = letter && fixture.sections ? fixture.sections[letter] : undefined;
    if (!Array.isArray(rows)) return { stdout: "", measureFail: "fixture has no answer for this query" };
    return { stdout: rows.map((r) => `${r[0]}\t${r[1]}\n`).join(""), measureFail: null };
  };
}

/** psql -At prints one trailing newline; a NULL prints as an empty line. */
function singleValue(stdout) {
  const text = String(stdout).replace(/\n$/, "");
  return text === "" ? null : text;
}

/** Parse `bucket<TAB>n` rows, refusing anything that is not a token and a count. */
export function parseCounts(stdout) {
  const rows = [];
  for (const line of String(stdout).split("\n")) {
    if (line === "") continue;
    const cells = line.split("\t");
    if (cells.length !== 2) return { rows: null, problem: "a row is not a bucket and a count" };
    const [bucket, n] = cells;
    if (UUID_RE.test(bucket)) return { rows: null, problem: "a bucket looks like an identifier" };
    if (!BUCKET_RE.test(bucket)) return { rows: null, problem: "a bucket is not a plain token" };
    if (!/^\d+$/.test(n)) return { rows: null, problem: "a count is not a non-negative integer" };
    rows.push([bucket, Number(n)]);
  }
  return { rows, problem: null };
}

/**
 * Marker first (equal to the manifest's PROD marker, or exit 1 having sent
 * nothing else), then the read-only read-back, then each section.
 */
export function runCensus({ sql, expectedMarker, out = console.log, err = console.error }) {
  const marker = sql(DB_MARKER_SQL);
  if (marker.measureFail) {
    err(`accounttruth-census: could not read the database marker: ${marker.measureFail}`);
    return 1;
  }
  const live = singleValue(marker.stdout);
  if (live !== expectedMarker) {
    err(
      `accounttruth-census: REFUSED. The database marker is ${live === null ? "NULL" : JSON.stringify(live)}, ` +
        `but the PROD marker (database_marker in scripts/prod-prober/cron-manifest.json) is ${JSON.stringify(expectedMarker)}. ` +
        "No census query was sent.",
    );
    return 1;
  }
  out("accounttruth-census: database marker equals the PROD marker in scripts/prod-prober/cron-manifest.json");

  const ro = sql(READ_ONLY_PROBE_SQL);
  const roValue = ro.measureFail ? null : singleValue(ro.stdout);
  const [readOnly, rowSecurity] = roValue === null ? [null, null] : roValue.split("\t");
  if (readOnly !== "on" || rowSecurity !== "off") {
    err(
      `accounttruth-census: REFUSED. The session is not read-only with row security off ` +
        `(transaction_read_only=${readOnly ?? "unreadable"}, row_security=${rowSecurity ?? "unreadable"}` +
        `${ro.measureFail ? `: ${ro.measureFail}` : ""}). ` +
        "No census query was sent. Use --print-sql to run the SELECTs through another read path.",
    );
    return 1;
  }
  out("accounttruth-census: session is read-only with row security off");

  const rls = sql(RLS_PROBE_SQL);
  const rlsValue = rls.measureFail ? null : singleValue(rls.stdout);
  if (rlsValue !== "bypasses_rls") {
    err(
      `accounttruth-census: REFUSED. The role does not bypass row-level security (${rlsValue ?? "unreadable"}), ` +
        "so the census would count only the rows RLS lets it see. No census query was sent.",
    );
    return 1;
  }
  out("accounttruth-census: role bypasses row-level security");

  for (const section of SECTIONS) {
    const res = sql(section.sql);
    if (res.measureFail) {
      err(`accounttruth-census: (${section.letter}) could not be measured: ${res.measureFail}`);
      return 1;
    }
    const parsed = parseCounts(res.stdout);
    if (parsed.problem) {
      err(`accounttruth-census: (${section.letter}) REFUSED to print: ${parsed.problem}`);
      return 1;
    }
    if (parsed.rows.length === 0) {
      err(
        `accounttruth-census: (${section.letter}) answered with no rows. This section returns rows by ` +
          "construction, so the read did not run the statement this script sent. Nothing was measured.",
      );
      return 1;
    }
    const answered = new Set(parsed.rows.map(([bucket]) => bucket));
    const missing = section.required.filter((bucket) => !answered.has(bucket));
    if (missing.length > 0) {
      err(
        `accounttruth-census: (${section.letter}) answered without bucket ${missing.join(", ")}. ` +
          "That bucket is returned by construction, so the read did not run the statement this script sent. " +
          "An absent line is not a 0.",
      );
      return 1;
    }
    out(`(${section.letter}) ${section.title}`);
    for (const [bucket, n] of parsed.rows) out(`  ${bucket}: ${n}`);
    // SFH R2-L2: a gate the runbook reads is never an absent line, because the
    // check above teaches that an absent line is not a 0. A `gateMayBeAbsent`
    // gate is a GROUP BY bucket with no row exactly when its count is 0, so
    // that 0 is printed, marked as absent.
    if (section.gateMayBeAbsent) {
      for (const bucket of section.gate) {
        if (!answered.has(bucket)) out(`  ${bucket}: 0 (absent: a GROUP BY bucket with no rows)`);
      }
    }
  }
  return 0;
}

/** `--print-sql` text: each statement under its label, `;`-terminated. */
export function printSqlText(labels) {
  const wanted = labels && labels.length > 0 ? labels : allStatements().map((s) => s.label);
  const byLabel = new Map(allStatements().map((s) => [s.label, s.sql]));
  const parts = [];
  for (const label of wanted) {
    const stmt = byLabel.get(label);
    if (stmt === undefined) throw new Error(`unknown statement label: ${label}`);
    const head =
      label === "marker"
        ? "-- census (marker): run first; it must equal database_marker in scripts/prod-prober/cron-manifest.json"
        : label === "rls"
          ? "-- census (rls): run second; it must answer bypasses_rls, or (a) to (f) undercount"
          : `-- census (${label}): ${SECTIONS.find((s) => s.letter === label).title}`;
    parts.push(`${head}\n${stmt};\n`);
  }
  return parts.join("\n");
}

const USAGE =
  "usage: node scripts/accounttruth-census.mjs [--print-sql[=marker,rls,a,b,c,d,e,f] | --fixture <answers.json>]";

export function main(argv, { env = process.env, out = console.log, err = console.error } = {}) {
  const args = argv.slice(2);
  const printArg = args.find((a) => a === "--print-sql" || a.startsWith("--print-sql="));
  if (printArg) {
    if (args.length !== 1) {
      err("accounttruth-census: --print-sql takes no other argument; it touches no database and reads no fixture.");
      err(USAGE);
      return 2;
    }
    const labels = printArg.includes("=") ? printArg.split("=")[1].split(",").filter(Boolean) : [];
    try {
      process.stdout.write(printSqlText(labels));
    } catch (e) {
      err(`accounttruth-census: ${e.message}`);
      err(USAGE);
      return 2;
    }
    return 0;
  }

  let expectedMarker;
  try {
    expectedMarker = readManifestMarker();
  } catch (e) {
    err(`accounttruth-census: could not read the PROD marker: ${e.message}`);
    return 1;
  }

  const fixtureIdx = args.indexOf("--fixture");
  if (fixtureIdx >= 0) {
    const path = args[fixtureIdx + 1];
    if (!path) {
      err(USAGE);
      return 2;
    }
    let fixture;
    try {
      fixture = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      err(`accounttruth-census: could not read the --fixture file as JSON: ${e.message}`);
      err(USAGE);
      return 2;
    }
    if (fixture === null || typeof fixture !== "object" || Array.isArray(fixture)) {
      err("accounttruth-census: the --fixture file must hold a JSON object.");
      err(USAGE);
      return 2;
    }
    return runCensus({ sql: fixtureSqlRunner(fixture), expectedMarker, out, err });
  }
  if (args.length > 0) {
    err(USAGE);
    return 2;
  }

  if (!env.PROBER_POOLER_URL || !(env.PGPASSWORD || env.SUPABASE_DB_PASSWORD)) {
    err("accounttruth-census: set PROBER_POOLER_URL (no password in it) and PGPASSWORD. Or use --print-sql.");
    return 2;
  }
  let hasUrlPassword = false;
  try {
    hasUrlPassword = new URL(env.PROBER_POOLER_URL).password !== "";
  } catch {
    err("accounttruth-census: PROBER_POOLER_URL is not a URL");
    return 2;
  }
  if (hasUrlPassword) {
    err("accounttruth-census: PROBER_POOLER_URL carries a password. Pass it as PGPASSWORD only.");
    return 2;
  }
  return runCensus({ sql: realSqlRunner(env), expectedMarker, out, err });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}

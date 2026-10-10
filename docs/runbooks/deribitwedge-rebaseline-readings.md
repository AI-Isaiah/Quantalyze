# Runbook — Deribit Re-baseline Readings (DERIBITWEDGE, Phase 167.1.2.2.1)

Read-only PROD readings for the Deribit cash-basis NAV fix: the identity verdict (SC-1), the
numbers that decide the dust cap (SC-2, OQ-3), the SC-5 cause, and the before/after
fingerprints Wave 5 compares (SC-4, SC-6).

**This runbook performs no PROD write.** There is no write form in it, and the renderer below
refuses to emit any text that contains one. Wave 5 enqueues the recompute through the product's
own path; that is not this file's business.

It is the read-only twin of `derivecron-go-live.md` and keeps its conventions: forms live in this
file, one renderer extracts them, every read carries the marker verdict as its first column.

## Environment and rendering the SQL

Run everything from the repo root of the checkout that holds this file.

```bash
export DW_SP="${DW_SP:-$HOME/.cache/quantalyze/deribitwedge-167.1.2.2.1}"; mkdir -p "$DW_SP"
set -o pipefail
QZ_MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
q() { supabase db query --linked --agent no --workdir "$QZ_MAIN" -o csv -f "$1"; }
```

- `QZ_MAIN` is the main checkout. The Supabase CLI link (`supabase/.temp/project-ref`) exists only
  there, and it targets PRODUCTION. `--agent no` pins plain CSV with no envelope. If `--workdir`
  is refused, run the same command with the main checkout as the current directory.
- `DW_SP` is the scratch directory: outside the repo, persistent, shared by every session of this
  phase. Every SQL file and CSV lives there, never in a tracked path. The value-bearing forms
  (`r4-day-returns`, `replay-inputs`) write only there.
- **The CLI returns only the LAST statement's rows.** A marker query that is merely the first
  statement is invisible. So every read carries the marker verdict as its first column
  (`marker_is_prod`: 1 only when the database's own comment equals the manifest's
  `database_marker`, else 0; a NULL comment reads 0) and every read returns at least one row.
  A `marker_is_prod` of 0 anywhere means STOP.
- **A file must not start with a `--` comment.** The CLI's inline form breaks on it. The forms
  below carry no SQL comments at all.
- **Never hand-type the marker string.** The renderer reads `database_marker` from
  `scripts/prod-prober/cron-manifest.json` and builds the read column from it.
- If `SUPABASE_DB_PASSWORD` is not exported and the CLI asks for it, read it from the macOS
  Keychain inline for that one command. Never echo it.
- Always `grep -a`. Pipelines run under `set -o pipefail`.
- Tracked text is counts, ratios and verdicts only: accounts and keys by rank, never ids, emails,
  account numbers, project refs, deployment ids or home paths.

The renderer extracts a named SQL form from this very file, so what is run is what is written
here. Install it once:

```bash
cat > "$DW_SP/form.mjs" <<'JS'
import fs from "node:fs";

const fail = (m) => { process.stderr.write("form: " + m + "\n"); process.exit(2); };
const [name, ...kv] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(name || "")) fail("usage: node form.mjs <name> [KEY=value ...]");
const md = fs.readFileSync("docs/runbooks/deribitwedge-rebaseline-readings.md", "utf8");
const body = (n) => {
  const m = md.match(new RegExp("<!-- form: " + n + " -->\\n```sql\\n([\\s\\S]*?)\\n```"));
  return m ? m[1] : null;
};
const marker = JSON.parse(fs.readFileSync("scripts/prod-prober/cron-manifest.json", "utf8")).database_marker;
if (typeof marker !== "string" || marker.length < 20 || marker.includes("$m$")) fail("database_marker unusable");
const params = { MARKER: "$m$" + marker + "$m$" };
for (const a of kv) {
  const i = a.indexOf("=");
  const k = a.slice(0, i);
  const v = a.slice(i + 1);
  if (!/^[A-Z_]+$/.test(k) || !/^[A-Za-z0-9:.+-]+$/.test(v)) fail("bad parameter " + a);
  params[k] = "'" + v + "'";
}
const expand = (sql, depth) => {
  if (depth > 4) fail("expansion too deep");
  return sql.replace(/__([A-Z0-9_]+)__/g, (tok, key) => {
    if (key in params) return params[key];
    const text = body(key.toLowerCase().replace(/_/g, "-"));
    if (text === null) fail("unresolved " + tok);
    return expand(text, depth + 1);
  });
};
const form = body(name);
if (form === null) fail("no form named " + name);
const sql = expand(form, 0);
const scan = sql.split(params.MARKER).join("''");
if (/cron\.(un)?schedule\s*\(|enqueue_\w+\s*\(|\b(insert|update|delete)\b/i.test(scan)) fail("render carries a write");
process.stdout.write(sql + "\n");
JS
```

Usage: `node "$DW_SP/form.mjs" <form-name> [KEY=value ...] > "$DW_SP/<file>.sql"`, then
`q "$DW_SP/<file>.sql" > "$DW_SP/<file>.csv"`. Parameters are timestamps such as
`RUN_AT=2026-10-10T05:30:00Z`, or a small integer such as `ACCOUNT_RANK=1`. The write scan runs
on EVERY render (there is no switch to turn it off) and refuses a form containing `INSERT`,
`UPDATE`, `DELETE`, `cron.schedule(`, `cron.unschedule(` or an `enqueue_...(` call. It first
removes the marker literal, because the marker's own sentence contains the word DELETE; do the
same before grepping a rendered file by hand for those words.

| Form | Parameters | What it reads |
|---|---|---|
| `marker` | none | the plain marker query, run ALONE |
| `marker-is-prod` | none | fragment: the read column other forms expand |
| `deribit-keys` | none | fragment: connected Deribit keys with `account_rank` and `key_rank` |
| `cron-run` | `SINCE` | the derive cron's run history since `SINCE` |
| `capture-read` | `RUN_AT` | the stored `account_summary` and `native_inception_diagnostics` per key and currency |
| `capture-refused` | none | the same captures a REFUSED derive stored on `key_capture:<api_key_id>`, per key and currency |
| `composite-cap` | none | per composite member key: would the 5 USD inception cap strand it (cash arm stored, MTM arm estimated) |
| `r1-fingerprint` | none | per key: return-day count, span, md5 fingerprint, inception verdict, flow counts |
| `r2-verdict` | `START` | per allocator: the equity-curve verdict and the compose job counts |
| `r3-sibling-diff` | none | per key pair of one account: how many return days differ |
| `r4-day-returns` | none | every `(date, daily_return)` per key. SCRATCH ONLY |
| `r5-candidates` | none | per key: days with an option-symbol holding, latest `asof` |
| `derive-quiet` | `SINCE` | the derive jobs per key since `SINCE`, by status |
| `replay-inputs` | `ACCOUNT_RANK` | one account's stored inputs and returns. SCRATCH ONLY |

"Connected Deribit key" means `exchange = 'deribit' AND is_active AND disconnected_at IS NULL`.
Output is keyed by `account_rank` (accounts ordered by their earliest key's `created_at`) and
`key_rank` (keys inside an account, ordered by `created_at`), never by an id. The ranks are
recomputed on every render, so they shift if a key is connected or disconnected between
sessions; re-read `r5-candidates` before relying on an earlier session's rank.

### The marker and the shared fragments

The plain marker read, run as its own call, FIRST, every session (`CLAUDE.md`, "Which database am
I on?"):

<!-- form: marker -->
```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

<!-- form: marker-is-prod -->
```sql
coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int
```

The key list every per-key read expands. Accounts are ranked by the earliest key's
`created_at` (the venue account id only breaks a tie and is never output):

<!-- form: deribit-keys -->
```sql
ak AS (
  SELECT id, user_id, venue_account_id, created_at,
         min(created_at) OVER (PARTITION BY venue_account_id) AS account_first_at
    FROM api_keys
   WHERE exchange = 'deribit' AND is_active AND disconnected_at IS NULL
),
k AS (
  SELECT ak.id, ak.user_id, ak.venue_account_id,
         dense_rank() OVER (ORDER BY ak.account_first_at, ak.venue_account_id) AS account_rank,
         row_number() OVER (PARTITION BY ak.venue_account_id ORDER BY ak.created_at, ak.id) AS key_rank
    FROM ak
)
```

## Order of readings

1. Run the `marker` form ALONE and record that it names PRODUCTION (write
   `which_database: PRODUCTION (marker names production)`; the text itself is already public in
   the manifest and is not repeated in tracked files). On NULL or anything else, STOP: re-set
   the marker before doing anything, never proceed on a guess.
2. Run reads. The first column of every row is `marker_is_prod`; it must be 1.
3. `cron-run` and `r5-candidates` first (did the slot run, which account holds options), then
   `capture-read`, then the lineage reads (`r3-sibling-diff`, `r1-fingerprint`, `r2-verdict`).
4. `derive-quiet` only to explain a key whose capture is older than `RUN_AT` or absent.

**Never enqueue a job by hand.** A key that did not derive at a slot waits for the next slot.

## The precondition for a reading

A reading of the post-fix capture is meaningful only when (a) the deployed analytics commit
descends from the DERIBITWEDGE PR-1 merge (`/health` `git_sha`, then
`git merge-base --is-ancestor <merge> <deployed>` exits 0) AND (b) a 05:30 UTC derive has run on
that code. A cron "success" only means the fan-out queued jobs. The proof of (b) is on the
worker side: the key's `key_inputs` row has `computed_at` at or after the slot AND carries
`account_summary`. `cron-run` shows the queueing; `capture-read` shows the work.

<!-- form: cron-run -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
r AS (
  SELECT d.status, d.start_time, d.end_time
    FROM cron.job_run_details d
    JOIN cron.job j ON j.jobid = d.jobid
   WHERE j.jobname = 'derive-allocator-key-dailies'
     AND d.start_time >= __SINCE__::timestamptz
)
SELECT m.marker_is_prod,
       r.status,
       r.start_time,
       r.end_time
  FROM m LEFT JOIN r ON true
 ORDER BY r.start_time;
```

## capture-read

One row per connected Deribit key and stored currency (a key with no stored summary gets one row
with an empty currency). Magnitudes never leave the database: the residual, prev0 and NAV are
turned into ratios and booleans in SQL and only those are selected.

- `writer_identity_ok` / `writer_identity_resid_ratio` are what the PR-1 writer stored. Its
  tolerance came from the shortest `repr` of the finest field, which PR-1 review MD-02 showed
  can both falsely break and falsely pass. They are selected for information only and never
  decide anything.
- `identity_resid_ratio_sql` is the independent judge, computed in SQL on the stored fields as
  exact `numeric`. The tolerance is the venue's documented precision, not the precision a value
  happens to show: Deribit reports each coin-denominated summary field rounded to 8 decimal
  places; the identity has five rounded terms (equity, balance, futures session UPL, futures
  session RPL, options value), each off by at most half a unit in the 8th place, so an exact
  identity can show at most 5 x 0.5 x 10^-8 = 2.5e-8 of residual from rounding alone. The
  relative term 1e-9 x |equity| covers binary-float error in the engine and the float-to-JSON
  chain for large balances; it overtakes the floor only above |equity| = 25 coins. So
  `tol = max(2.5e-8, 1e-9 x |equity|)` in native units, and the ratio is `|residual| / tol`.
- `identity_ratio_if_osu_added` is the same ratio with the options session UPL added to the sum.
  It is the measure of whether a read is EXERCISED: if the identity holds (ratio at most 1)
  and this ratio is far above 1, the identity genuinely excludes the options session UPL from
  `equity - balance`, so it discriminates between the wedge's two forms. Where the options
  session UPL is zero it equals the plain ratio and says nothing.
- `max_scale` is the largest `scale()` among the five stored fields, as evidence for the
  8-decimal assumption (a shortest-`repr` value drops trailing zeros, so a small `max_scale` on
  round values is normal; it matters only when the ratio is above 1).
- `breach_ratio_*` are the inception gate's ratios (1.0 is exactly the gate's limit):
  `current` is today's wedge, `balance_anchor` the balance-anchored wedge, `_with_cap` the same
  with `INCEPTION_DUST_CAP_USD` applied.
- `prev0_cur_over_first_nav` and `prev0_bal_over_first_nav` are the day-0 capital under each
  wedge divided by the first NAV; SC-5's prediction compares the latter with +0.0131.
- `dust_rel_*_le_1e4` say whether the relative dust allowance (1e-4 of throughput) absorbs the
  residual for that currency.

<!-- form: capture-read -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
__DERIBIT_KEYS__,
c AS (
  SELECT k.account_rank, k.key_rank,
         d.payload IS NOT NULL AS has_key_inputs_row,
         coalesce(d.computed_at >= __RUN_AT__::timestamptz, false) AS computed_at_ge_run_at,
         coalesce(jsonb_typeof(d.payload->'account_summary') = 'object', false) AS has_account_summary,
         d.payload->'account_summary_error' IS NOT NULL AS has_account_summary_error,
         d.payload->'native_inception_diagnostics_error' IS NOT NULL AS has_diagnostics_error,
         d.payload->'native_inception_diagnostics' AS dg,
         s.v AS sv,
         d.payload->'account_summary'->'identity'->(s.v->>'currency') AS idn
    FROM k
    LEFT JOIN allocator_equity_derived d ON d.kind = 'key_inputs:' || k.id::text
    LEFT JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(d.payload->'account_summary'->'summaries') = 'array'
                THEN d.payload->'account_summary'->'summaries' ELSE '[]'::jsonb END) AS s(v) ON true
),
p AS (
  SELECT c.*,
         c.sv->>'currency' AS ccy,
         (c.sv->>'equity')::numeric AS eq,
         (c.sv->>'balance')::numeric AS bal,
         coalesce((c.sv->>'futures_session_upl')::numeric, (c.sv->>'session_upl')::numeric) AS fupl,
         (c.sv->>'futures_session_rpl')::numeric AS frpl,
         (c.sv->>'options_value')::numeric AS ov,
         (c.sv->>'options_session_upl')::numeric AS osu,
         (SELECT e FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(c.dg->'currencies') = 'array' THEN c.dg->'currencies' ELSE '[]'::jsonb END) AS e
           WHERE e->>'currency' = c.sv->>'currency' LIMIT 1) AS dc
    FROM c
)
SELECT m.marker_is_prod,
       p.account_rank,
       p.key_rank,
       p.has_key_inputs_row,
       p.computed_at_ge_run_at,
       p.has_account_summary,
       p.has_account_summary_error,
       p.has_diagnostics_error,
       p.ccy AS currency,
       p.idn->>'identity_ok' AS writer_identity_ok,
       p.idn->>'identity_resid_ratio' AS writer_identity_resid_ratio,
       p.idn->>'options_session_upl_nonzero' AS options_session_upl_nonzero,
       p.idn->>'has_open_options' AS has_open_options,
       p.sv->>'margin_model' AS margin_model,
       p.sv->>'cross_collateral_enabled' AS cross_collateral_enabled,
       CASE WHEN p.eq IS NULL OR p.bal IS NULL THEN NULL
            ELSE abs(p.eq - (p.bal + coalesce(p.fupl, 0) + coalesce(p.frpl, 0) + coalesce(p.ov, 0)))
                 / greatest(0.000000025::numeric, 0.000000001 * abs(p.eq)) END AS identity_resid_ratio_sql,
       CASE WHEN p.eq IS NULL OR p.bal IS NULL THEN NULL
            ELSE abs(p.eq - (p.bal + coalesce(p.fupl, 0) + coalesce(p.frpl, 0) + coalesce(p.ov, 0)))
                 / greatest(0.000000025::numeric, 0.000000001 * abs(p.eq)) <= 1 END AS identity_ok_sql,
       CASE WHEN p.eq IS NULL OR p.bal IS NULL OR p.osu IS NULL THEN NULL
            ELSE abs(p.eq - (p.bal + coalesce(p.fupl, 0) + coalesce(p.frpl, 0) + coalesce(p.ov, 0) + p.osu))
                 / greatest(0.000000025::numeric, 0.000000001 * abs(p.eq)) END AS identity_ratio_if_osu_added,
       greatest(scale(p.eq), scale(p.bal), scale(p.fupl), scale(p.frpl), scale(p.ov)) AS max_scale,
       (p.dg->>'breach_ratio_current')::numeric AS breach_ratio_current,
       (p.dg->>'breach_ratio_current_with_cap')::numeric AS breach_ratio_current_with_cap,
       (p.dg->>'breach_ratio_balance_anchor')::numeric AS breach_ratio_balance_anchor,
       (p.dg->>'breach_ratio_balance_anchor_with_cap')::numeric AS breach_ratio_balance_anchor_with_cap,
       (p.dg->>'prev0_usd_current')::numeric / nullif((p.dg->>'first_nav_usd_current')::numeric, 0) AS prev0_cur_over_first_nav,
       (p.dg->>'prev0_usd_balance_anchor')::numeric / nullif((p.dg->>'first_nav_usd_current')::numeric, 0) AS prev0_bal_over_first_nav,
       p.dg->>'orphan_unvaluable' AS orphan_unvaluable,
       (p.dc->>'dust_rel_current')::numeric <= 0.0001 AS dust_rel_current_le_1e4,
       (p.dc->>'dust_rel_balance_anchor')::numeric <= 0.0001 AS dust_rel_balance_anchor_le_1e4
  FROM m LEFT JOIN p ON true
 ORDER BY p.account_rank, p.key_rank, p.ccy;
```

## capture-refused

A derive the section 5 gate (or any other structural refusal) turns away still made its one
`get_account_summaries` read and its full crawl. Since PR-1 review MD-01 (fixed in PR-2), that
read is stored on its own row, `key_capture:<api_key_id>`, with `outcome: refused` and the
refusal's class name. It is a separate row from `key_inputs`, because the compose reads
`key_inputs` and a refused derive's partial capture must not replace the last good derive's.

One row per connected Deribit key and stored currency, in the same shape as `capture-read` and
judged by the same rules (the independent SQL identity ratio on exact `numeric`, the four breach
ratios). A key with no refusal row gets one row with `has_capture_row` false and every other
column empty: that is the normal state, not a fault. `refusal_class` is a class name, never a
message. `captured_at` is the refusal's own timestamp.

<!-- form: capture-refused -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
__DERIBIT_KEYS__,
c AS (
  SELECT k.account_rank, k.key_rank,
         d.payload IS NOT NULL AS has_capture_row,
         d.payload->>'outcome' AS outcome,
         d.payload->>'refusal_class' AS refusal_class,
         d.payload->>'captured_at' AS captured_at,
         coalesce(jsonb_typeof(d.payload->'account_summary') = 'object', false) AS has_account_summary,
         coalesce(jsonb_typeof(d.payload->'ledger_digest') = 'object', false) AS has_ledger_digest,
         d.payload->'native_inception_diagnostics' IS NOT NULL AS has_diagnostics,
         d.payload->'native_inception_diagnostics' AS dg,
         s.v AS sv
    FROM k
    LEFT JOIN allocator_equity_derived d ON d.kind = 'key_capture:' || k.id::text
    LEFT JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(d.payload->'account_summary'->'summaries') = 'array'
                THEN d.payload->'account_summary'->'summaries' ELSE '[]'::jsonb END) AS s(v) ON true
),
p AS (
  SELECT c.*,
         c.sv->>'currency' AS ccy,
         (c.sv->>'equity')::numeric AS eq,
         (c.sv->>'balance')::numeric AS bal,
         coalesce((c.sv->>'futures_session_upl')::numeric, (c.sv->>'session_upl')::numeric) AS fupl,
         (c.sv->>'futures_session_rpl')::numeric AS frpl,
         (c.sv->>'options_value')::numeric AS ov
    FROM c
)
SELECT m.marker_is_prod,
       p.account_rank,
       p.key_rank,
       p.has_capture_row,
       p.outcome,
       p.refusal_class,
       p.captured_at,
       p.has_account_summary,
       p.has_ledger_digest,
       p.has_diagnostics,
       p.ccy AS currency,
       CASE WHEN p.eq IS NULL OR p.bal IS NULL THEN NULL
            ELSE abs(p.eq - (p.bal + coalesce(p.fupl, 0) + coalesce(p.frpl, 0) + coalesce(p.ov, 0)))
                 / greatest(0.000000025::numeric, 0.000000001 * abs(p.eq)) END AS identity_resid_ratio_sql,
       CASE WHEN p.eq IS NULL OR p.bal IS NULL THEN NULL
            ELSE abs(p.eq - (p.bal + coalesce(p.fupl, 0) + coalesce(p.frpl, 0) + coalesce(p.ov, 0)))
                 / greatest(0.000000025::numeric, 0.000000001 * abs(p.eq)) <= 1 END AS identity_ok_sql,
       (p.dg->>'breach_ratio_current')::numeric AS breach_ratio_current,
       (p.dg->>'breach_ratio_current_with_cap')::numeric AS breach_ratio_current_with_cap,
       (p.dg->>'breach_ratio_balance_anchor')::numeric AS breach_ratio_balance_anchor,
       (p.dg->>'breach_ratio_balance_anchor_with_cap')::numeric AS breach_ratio_balance_anchor_with_cap
  FROM m LEFT JOIN p ON true
 ORDER BY p.account_rank, p.key_rank, p.ccy;
```

## composite-cap

The composite path (`run_stitch_composite_job`, then `_reconstruct_deribit`) rebuilds each
member key's WHOLE ledger and runs the same section 5 gate as the key-mode derive, so the 5 USD
inception dust cap (`INCEPTION_DUST_CAP_USD`) faces it too. In a composite a member breach is a
permanent failure. This form answers, from the stored `key_inputs` diagnostics alone, whether the
cap would strand a composite member. It reads no live account and enqueues nothing.

It reads two arms for every member of every strategy with two or more members:

- **cash arm** (the deployed default basis): the stored `breach_ratio_balance_anchor_with_cap`
  and `breach_ratio_current_with_cap`, plus a recount of the currencies the cap leaves NON-dust
  (`n_nondust_cash`). A currency is non-dust when its rolled residual exceeds 1e-4 of its own
  throughput OR is worth more than the cap at the inception mark. Zero non-dust currencies make
  the breach sum zero, which is below any tolerance.
- **MTM arm** (an ESTIMATE, labelled as one): the stored diagnostics are built on the cash
  ledger, and the MTM ledger is not stored. From the code (`build_deribit_native_ledger`) the
  MTM wedge is the combined session UPL and the open book rides in the summary-channel P&L, so
  the MTM pre-history residual equals the cash one plus `futures_session_rpl` of that currency
  (given the documented identity, which `capture-read` confirms, and a terminal open book of
  `options_value - options_session_upl`). `n_nondust_mtm_est` applies the same dust test to that
  shifted residual. A currency with no stored summary row has no `futures_session_rpl` and the
  shift is taken as 0; `n_ccy_without_summary` counts them.

`max_resid_over_cap` is the largest cash-arm residual divided by the cap (1.0 is exactly at the
cap). `max_rpl_shift_over_cap` is the largest MTM shift over the cap. Members are listed by
composite rank (by creation) and `seq`; `account_rank` is the runbook's account rank of the
member's key, never an id. The verdict line is `composite-cap-verdict: passes` only when
`stored_breach_bal_cap` is at most 1 and both non-dust counts are 0 on every member row;
otherwise `strands (<n> member keys)`, and the cap is NOT loosened to make it pass.

<!-- form: composite-cap -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
multi AS (
  SELECT strategy_id FROM strategy_keys GROUP BY strategy_id HAVING count(*) >= 2
),
mem AS (
  SELECT dense_rank() OVER (ORDER BY s.created_at, s.id) AS comp_rank,
         sk.seq, sk.api_key_id, ak.venue_account_id
    FROM strategy_keys sk
    JOIN multi ON multi.strategy_id = sk.strategy_id
    JOIN strategies s ON s.id = sk.strategy_id
    JOIN api_keys ak ON ak.id = sk.api_key_id
),
acct AS (
  SELECT venue_account_id, dense_rank() OVER (ORDER BY min(created_at), venue_account_id) AS account_rank
    FROM api_keys WHERE exchange = 'deribit' AND is_active AND disconnected_at IS NULL
   GROUP BY venue_account_id
),
d AS (
  SELECT mem.comp_rank, mem.seq, acct.account_rank, x.payload, x.computed_at
    FROM mem
    LEFT JOIN acct ON acct.venue_account_id = mem.venue_account_id
    LEFT JOIN allocator_equity_derived x ON x.kind = 'key_inputs:' || mem.api_key_id::text
),
c AS (
  SELECT d.comp_rank, d.seq, d.account_rank, d.computed_at,
         d.payload IS NOT NULL AS has_row,
         d.payload->'native_inception_diagnostics' IS NOT NULL AS has_diag,
         (d.payload->'native_inception_diagnostics'->>'breach_ratio_balance_anchor_with_cap')::numeric AS br_bal_cap,
         (d.payload->'native_inception_diagnostics'->>'breach_ratio_current_with_cap')::numeric AS br_cur_cap,
         e AS dc,
         (SELECT v FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(d.payload->'account_summary'->'summaries') = 'array'
                   THEN d.payload->'account_summary'->'summaries' ELSE '[]'::jsonb END) AS v
           WHERE v->>'currency' = e->>'currency' LIMIT 1) AS sv
    FROM d
    LEFT JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(d.payload->'native_inception_diagnostics'->'currencies') = 'array'
              THEN d.payload->'native_inception_diagnostics'->'currencies' ELSE '[]'::jsonb END) AS e ON true
),
p AS (
  SELECT c.*,
         (dc->>'resid_native_balance_anchor')::numeric AS rb,
         (dc->>'mark0_usd')::numeric AS m0,
         (dc->>'throughput_native')::numeric AS thr,
         coalesce((sv->>'futures_session_rpl')::numeric, 0) AS frpl,
         (sv IS NULL) AS no_summary
    FROM c
),
q AS (
  SELECT p.*,
         (abs(rb) > 0.0001 * thr OR abs(rb) * m0 > 5.0) AS nd_cash,
         (abs(rb + frpl) > 0.0001 * thr OR abs(rb + frpl) * m0 > 5.0) AS nd_mtm
    FROM p WHERE dc IS NOT NULL
)
SELECT m.marker_is_prod,
       q.comp_rank, q.seq, q.account_rank,
       max(q.computed_at)::date AS derived_on,
       count(*) AS n_ccy,
       count(*) FILTER (WHERE q.no_summary) AS n_ccy_without_summary,
       max(q.br_bal_cap) AS stored_breach_bal_cap,
       max(q.br_cur_cap) AS stored_breach_cur_cap,
       count(*) FILTER (WHERE q.nd_cash) AS n_nondust_cash,
       count(*) FILTER (WHERE q.nd_mtm) AS n_nondust_mtm_est,
       round(max(abs(q.rb) * q.m0 / 5.0), 6) AS max_resid_over_cap,
       round(max(abs(q.frpl) * q.m0 / 5.0), 6) AS max_rpl_shift_over_cap
  FROM m CROSS JOIN q
 GROUP BY m.marker_is_prod, q.comp_rank, q.seq, q.account_rank
 ORDER BY q.comp_rank, q.seq;
```

## Lineage and fingerprint reads

`r1-fingerprint` is the BEFORE/AFTER fingerprint per connected key. `payload->>'native_inception'`
is the single-string verdict the derive wrote when the inception gate ran.

<!-- form: r1-fingerprint -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
__DERIBIT_KEYS__,
r AS (
  SELECT api_key_id,
         count(*) AS return_days,
         min(date) AS first_day,
         max(date) AS last_day,
         md5(string_agg(date::text || ':' || daily_return::text, ',' ORDER BY date)) AS fingerprint
    FROM csv_daily_returns
   WHERE api_key_id IN (SELECT id FROM k)
   GROUP BY api_key_id
)
SELECT m.marker_is_prod,
       k.account_rank,
       k.key_rank,
       coalesce(r.return_days, 0) AS return_days,
       r.first_day,
       r.last_day,
       r.fingerprint,
       d.payload->>'native_inception' AS native_inception,
       CASE jsonb_typeof(d.payload->'flows') WHEN 'array' THEN jsonb_array_length(d.payload->'flows') END AS flows,
       CASE jsonb_typeof(d.payload->'dropped_day_pnl')
            WHEN 'array' THEN jsonb_array_length(d.payload->'dropped_day_pnl')
            WHEN 'object' THEN (SELECT count(*) FROM jsonb_object_keys(d.payload->'dropped_day_pnl'))
            ELSE 0 END AS dropped_day_pnl_days,
       d.computed_at
  FROM m
  LEFT JOIN k ON true
  LEFT JOIN r ON r.api_key_id = k.id
  LEFT JOIN allocator_equity_derived d ON d.kind = 'key_inputs:' || k.id::text
 ORDER BY k.account_rank, k.key_rank;
```

`r2-verdict` reads the book surface per allocator that owns a connected Deribit key (allocators
ranked by their earliest connected Deribit key), plus the compose job counts since `START`:

<!-- form: r2-verdict -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
__DERIBIT_KEYS__,
al AS (
  SELECT k.user_id AS allocator_id, min(k.account_rank) AS first_account_rank
    FROM k GROUP BY k.user_id
),
alr AS (
  SELECT allocator_id, row_number() OVER (ORDER BY first_account_rank, allocator_id) AS allocator_rank
    FROM al
)
SELECT m.marker_is_prod,
       alr.allocator_rank,
       e.allocator_id IS NOT NULL AS has_equity_curve_row,
       e.payload->>'is_trustworthy' AS is_trustworthy,
       e.payload->'degrade_reasons' AS degrade_reasons,
       e.payload->>'version' AS version,
       CASE jsonb_typeof(e.payload->'curve') WHEN 'array' THEN jsonb_array_length(e.payload->'curve') END AS curve_points,
       CASE jsonb_typeof(e.payload->'returns') WHEN 'array' THEN jsonb_array_length(e.payload->'returns') END AS returns_points,
       e.computed_at,
       (SELECT count(*) FROM compute_jobs j WHERE j.kind = 'derive_allocator_equity'
           AND j.allocator_id = alr.allocator_id AND j.created_at >= __START__::timestamptz
           AND j.status = 'done') AS jobs_done,
       (SELECT count(*) FROM compute_jobs j WHERE j.kind = 'derive_allocator_equity'
           AND j.allocator_id = alr.allocator_id AND j.created_at >= __START__::timestamptz
           AND j.status = 'failed_final') AS jobs_failed_final,
       (SELECT count(*) FROM compute_jobs j WHERE j.kind = 'derive_allocator_equity'
           AND j.allocator_id = alr.allocator_id AND j.created_at >= __START__::timestamptz
           AND j.status IN ('pending', 'running', 'failed_retry', 'done_pending_children')) AS jobs_open
  FROM m
  LEFT JOIN alr ON true
  LEFT JOIN allocator_equity_derived e ON e.allocator_id = alr.allocator_id AND e.kind = 'equity_curve'
 ORDER BY alr.allocator_rank;
```

`r3-sibling-diff` is the determinism reading (SC-6 on PROD): across the keys that share a venue
account, the common days whose returns differ by more than 1e-12 and the days only one sibling
has. Before the fix the options-holding account differs on hundreds of days; the others on none.

<!-- form: r3-sibling-diff -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
__DERIBIT_KEYS__,
pairs AS (
  SELECT a.id AS a_id, b.id AS b_id, a.account_rank, a.key_rank AS key_rank_a, b.key_rank AS key_rank_b
    FROM k a JOIN k b ON a.venue_account_id = b.venue_account_id AND a.key_rank < b.key_rank
)
SELECT m.marker_is_prod,
       pairs.account_rank,
       pairs.key_rank_a,
       pairs.key_rank_b,
       count(*) FILTER (WHERE x.ra IS NOT NULL AND x.rb IS NOT NULL) AS common_days,
       count(*) FILTER (WHERE x.ra IS NOT NULL AND x.rb IS NOT NULL AND abs(x.ra - x.rb) > 1e-12) AS differing_days,
       max(abs(x.ra - x.rb)) FILTER (WHERE x.ra IS NOT NULL AND x.rb IS NOT NULL) AS max_abs_diff,
       count(*) FILTER (WHERE x.ra IS NOT NULL AND x.rb IS NULL) AS only_a_days,
       count(*) FILTER (WHERE x.ra IS NULL AND x.rb IS NOT NULL) AS only_b_days
  FROM m
  LEFT JOIN pairs ON true
  LEFT JOIN LATERAL (
    SELECT ra.daily_return AS ra, rb.daily_return AS rb
      FROM (SELECT date, daily_return FROM csv_daily_returns WHERE api_key_id = pairs.a_id) ra
      FULL JOIN (SELECT date, daily_return FROM csv_daily_returns WHERE api_key_id = pairs.b_id) rb
        ON ra.date = rb.date
  ) x ON true
 GROUP BY m.marker_is_prod, pairs.account_rank, pairs.key_rank_a, pairs.key_rank_b
 ORDER BY pairs.account_rank, pairs.key_rank_a, pairs.key_rank_b;
```

`r4-day-returns` is for a SCRATCH CSV only. Its values never go into tracked text. Save it to
`$DW_SP` immediately before a recompute: the cron rewrites the returns daily, so an earlier
snapshot goes stale.

<!-- form: r4-day-returns -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
__DERIBIT_KEYS__
SELECT m.marker_is_prod,
       k.account_rank,
       k.key_rank,
       r.date,
       r.daily_return
  FROM m
  LEFT JOIN k ON true
  LEFT JOIN csv_daily_returns r ON r.api_key_id = k.id
 ORDER BY k.account_rank, k.key_rank, r.date;
```

`r5-candidates` finds the options-holding account: per key, the number of distinct days with an
option-symbol holding (Deribit option symbols end in `-C` or `-P`) and the latest `asof`.

<!-- form: r5-candidates -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
__DERIBIT_KEYS__,
h AS (
  SELECT api_key_id, count(DISTINCT asof) AS option_days, max(asof) AS latest_asof
    FROM allocator_holdings
   WHERE symbol ~ '-[CP]$' AND api_key_id IN (SELECT id FROM k)
   GROUP BY api_key_id
)
SELECT m.marker_is_prod,
       k.account_rank,
       k.key_rank,
       coalesce(h.option_days, 0) AS option_days,
       h.latest_asof
  FROM m
  LEFT JOIN k ON true
  LEFT JOIN h ON h.api_key_id = k.id
 ORDER BY k.account_rank, k.key_rank;
```

## derive-quiet — why did a key not derive?

On PR-1 code a derive that REFUSES stores nothing (PR-1 review MD-01), so a key with no
`account_summary` may have refused rather than never derived. Never read an absent field as
"never derived". This read lists the key's `derive_broker_dailies` jobs created at or after
`SINCE`, by status, and its latest job. It selects the error KIND only, never the error text.

<!-- form: derive-quiet -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
__DERIBIT_KEYS__,
j AS (
  SELECT api_key_id, status, error_kind, attempts, created_at, updated_at,
         row_number() OVER (PARTITION BY api_key_id ORDER BY created_at DESC) AS recency
    FROM compute_jobs
   WHERE kind = 'derive_broker_dailies'
     AND created_at >= __SINCE__::timestamptz
     AND api_key_id IN (SELECT id FROM k)
)
SELECT m.marker_is_prod,
       k.account_rank,
       k.key_rank,
       count(j.api_key_id) AS jobs_since,
       count(*) FILTER (WHERE j.status = 'done') AS done,
       count(*) FILTER (WHERE j.status = 'failed_final') AS failed_final,
       count(*) FILTER (WHERE j.status = 'failed_retry') AS failed_retry,
       count(*) FILTER (WHERE j.status IN ('pending', 'running', 'done_pending_children')) AS open,
       max(j.status) FILTER (WHERE j.recency = 1) AS latest_status,
       max(j.error_kind) FILTER (WHERE j.recency = 1) AS latest_error_kind,
       max(j.attempts) FILTER (WHERE j.recency = 1) AS latest_attempts,
       max(j.updated_at) FILTER (WHERE j.recency = 1) AS latest_updated_at
  FROM m
  LEFT JOIN k ON true
  LEFT JOIN j ON j.api_key_id = k.id
 GROUP BY m.marker_is_prod, k.account_rank, k.key_rank
 ORDER BY k.account_rank, k.key_rank;
```

## replay-inputs — SCRATCH ONLY

For the compose replay (Plan 06). For every connected key of one account, by `key_rank`: its
stored `key_inputs` payload (one `payload` row) and its `(date, daily_return)` rows (one `return`
row each). The payload carries amounts, so this output goes to `$DW_SP` and nowhere else.

<!-- form: replay-inputs -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
__DERIBIT_KEYS__,
sel AS (SELECT * FROM k WHERE account_rank = __ACCOUNT_RANK__::int)
SELECT m.marker_is_prod, 0 AS key_rank, 'header' AS row_kind, NULL::date AS date, NULL::double precision AS daily_return, NULL::text AS payload
  FROM m
UNION ALL
SELECT m.marker_is_prod, sel.key_rank, 'payload', NULL::date, NULL::double precision, d.payload::text
  FROM m CROSS JOIN sel
  JOIN allocator_equity_derived d ON d.kind = 'key_inputs:' || sel.id::text
UNION ALL
SELECT m.marker_is_prod, sel.key_rank, 'return', r.date, r.daily_return, NULL::text
  FROM m CROSS JOIN sel
  JOIN csv_daily_returns r ON r.api_key_id = sel.id
ORDER BY key_rank, row_kind, date;
```

## Reading the verdicts

Written into the Plan 05 SUMMARY as one line each, counts and ratios only.

- **`identity-verdict: confirmed (exercised)`** only when, on every currency with a readable
  balance on every key of every account, `identity_resid_ratio_sql <= 1` AND
  `options_session_upl_nonzero` is true on every key of the options-holding account. An
  unexercised read (the identity holds but the options session UPL is zero) is NOT a pass: wait
  for the next 05:30 UTC slot. `writer_identity_ok` is recorded beside it for information only.
- **`identity-verdict: failed (precision unconfirmed, <ccy>)`** when `identity_resid_ratio_sql > 1`
  on a currency whose `max_scale` is below 8: the 8-decimal assumption is unconfirmed, not a
  broken identity.
- **`cap-verdict: passes`** only when `breach_ratio_balance_anchor_with_cap <= 1` on every key of
  every account that has diagnostics; otherwise `strands (<n> keys, max ratio <r>)`.
- **`sc5-prediction:`** H-I when `breach_ratio_balance_anchor <= 1` while
  `breach_ratio_current_with_cap > 1`; H-L when `prev0_bal_over_first_nav` is within 10% of
  +0.0131; otherwise `undecided-until-replay`. The compose replay decides SC-5, not this line.

## Known residue

Disconnected Deribit keys cannot be re-derived (no live credentials) and keep the old wedge.
They are outside every form above by design. The full list of recorded-not-fixed items, each
with an owner, is in `TODOS.md` under `## Phase 167.1.2.2.1 (DERIBITWEDGE) — routed items`.

## What this runbook does not cover

Any PROD write. The Wave 5 recompute runs through the product's own enqueue path and has its own
runbook step; this file only reads before and after it.

## Wave 5 hand-off

Written by plan 07 of Phase 167.1.2.2.1 for the Wave 5 consolidated recompute (D-18). Accounts
and keys are by rank (this runbook's ranks), never by id. Counts, ratios and verdicts only.

**The timing fact that shapes everything below.** The daily 05:30 UTC cron
(`derive-allocator-key-dailies`) re-derives EVERY connected Deribit key with whatever analytics
code is deployed. So the keys' returns move at the first 05:30 UTC derive after PR-2 deploys,
whoever schedules it. Merging and deploying PR-2 IS the keys' re-baseline (CONTEXT D-18 note of
2026-10-09, orchestrator), and plan 08 brackets that derive with BEFORE and AFTER readings. Wave
5's explicit recompute is therefore the two private composites only, through `stitch_composite`,
after Phase 166.3.1 NAVBREACH. No row is recomputed twice. Do not re-derive the keys a second
time, and do not take a BEFORE snapshot after the keys have already moved.

### (a) The list

1. The connected Deribit keys of the three venue accounts: 8 keys (plan 05's reading). Account
   rank 1 has 3 keys, rank 2 (the options-holding account) has 3, rank 3 has 2. They re-derive at
   the first 05:30 UTC derive after PR-2 deploys; plan 08 owns that bracket.
2. Then the two private composites (strategies with two or more `strategy_keys` members), through
   `stitch_composite`, which waits on NAVBREACH. Each has 3 members, all connected Deribit keys,
   on account ranks 3, 1 and 2; the two composites together use 6 distinct keys. Their stitch
   status on 2026-10-10: one `failed` (its stored error does not name the inception gate), one
   `complete_with_warnings`.

### (b) The order for anything Wave 5 recomputes explicitly

1. Deploy: main CI green, Railway deploy, `/health` `git_sha` contains the PR-2 merge.
2. `r1-fingerprint` and `r4-day-returns` BEFORE, immediately before the recompute. The cron
   rewrites returns daily, so an earlier snapshot is stale.
3. `composite-cap` BEFORE the composite recompute (see (f)).
4. Enqueue through the product's own path only. This runbook never enqueues.
5. `r1-fingerprint`, `r2-verdict` and `r3-sibling-diff` AFTER. A refused derive is read with
   `capture-refused`.

### (c) Acceptance

- `r3-sibling-diff` reads 0 differing days on every account, or each difference is attributed by
  unequal `ledger_digest` values (a ledger that genuinely differs between sibling keys).
- The options-holding allocator's `r2-verdict` is recorded as it is. Its expected shape is
  trustworthy when SC-5 was H-I. SC-5 was measured H-D (plan 06) and is fixed here by D-06 (plans
  10 and 11): the compose rolls on the writer's stored `composed_flows` and `composed_day_pnl`,
  so a book reads trustworthy only after a derive by the DEPLOYED code has written them for every
  member key, and `writer_basis` appears in the curve row's flags. A stitched account needs a
  basis on EVERY member (the kept key and each stitch source); a member that is not re-derived
  keeps the account on the legacy roll. Absence of `writer_basis` with `inception_unreconciled`
  present means the row has no fields yet, not that the fix failed.
- SC-3 under the final emptied rule (D-09: below the smaller of 1% of the prior peak and 100
  USD): the scratch replay of the options-holding account's stored inputs reads 755 emptied days in
  2 stretches (695 and 60) (fixer C's scratch replay). Plan 08's reading after deploy is the
  authoritative one; if it differs, STOP and put the new count to the founder, never widen a band.

### (d) Lineage, not baseline

The 2026-10-09 research snapshot and plan 05's readings (pre-fix code: the options-holding
account's sibling keys differing on 217 to 218 of 1189 days; the other accounts identical) are
lineage. The BEFORE readings of (b) are the baseline.

### (e) Known residue

Disconnected Deribit keys cannot be re-derived (no live credentials) and keep the old wedge.

### (f) The composite cap reading, and the ordering note

The $5 inception dust cap (`INCEPTION_DUST_CAP_USD`) gates every caller of the section 5 gate,
including the composite path (`_reconstruct_deribit`) under both the cash and the MTM basis. The
plan 05 clearance (8 of 8 keys) was read from the key-mode cash diagnostics only (PR-2 review WR-02,
security F2). Plan 07 took the composite reading, read-only, with the `composite-cap` form:

marker: `which_database: PRODUCTION (marker names production)`

```
composite-cap-verdict: passes (6 of 6 member keys across 2 composites; cash arm stored breach_ratio_balance_anchor_with_cap 0 and breach_ratio_current_with_cap 0 on 6 of 6; 0 of 18 currency rows non-dust under the cap; largest residual 0.67 of the cap; MTM arm estimated: 0 of 18 non-dust, largest futures_session_rpl shift under 1e-6 of the cap)
```

Limits of that reading, so a later reader weighs it correctly: (i) the MTM arm is an ESTIMATE from
the stored cash diagnostics plus `futures_session_rpl` (the derivation is in the `composite-cap`
section above); the MTM ledger itself is not stored. (ii) It is a stored reading as of the derive
of 2026-10-10; the wedge offset is time-varying, and the largest residual (account rank 2, the
options-holding account) uses two thirds of the cap, so the margin is real but not wide. (iii) The
composite recompute reads LIVE state, so re-run `composite-cap` immediately before it ((b) step
3). If it ever reads `strands`, STOP and take it to the founder; the cap is not loosened to make a
composite pass, and a `stitch_composite` flip from `complete_with_warnings` to `failed` after
NAVBREACH is recorded as the cap's effect.

### (g) The replay entry for D-03

`DeribitNativeAccountState.from_stored` is the replay entry: it rebuilds the account state from the
stored `account_summary`, so a re-derive over the same stored inputs can be checked to reproduce
(D-03, SC-6). It has no production caller by design.

### (h) Refused derives

A derive the section 5 gate (or another structural refusal) turns away stores its capture on a
`key_capture:<api_key_id>` row with `outcome: refused` (PR-1 review MD-01, fixed in PR-2). Read it
with `capture-refused`. On 2026-10-10 it read 0 refusal rows across the 8 keys (every key had
`has_capture_row` false), which is the normal state.

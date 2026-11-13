# Phase 202: RESIDCHURN - Pattern Map

**Mapped:** 2026-11-06
**Files analyzed:** 22 (15 untracked scratch, 5 tracked report/summary artifacts, 2 contingency code files)
**Analogs found:** 22 / 22 (the contingency pair has exact analogs in the same files)

Scratch lives under `~/.cache/quantalyze/` (untracked, never committed). Every tracked analog below was checked with `git ls-files` (tracked). The two scratch kits (`tinybase-gc/`, `residchurn/`) are untracked by design (D-03). No PROD id, balance or home path is written here; labels only (k15, s14, b3).

HARD RULES for every file below: no database access (no `q.sh`, no `psql`, no `supabase db query`, no Keychain). Never edit an existing `residchurn/sql/d_*.sql` (byte-identical, D-03). New SQL is NEW files, run by the executor through the Supabase MCP one statement per call, marker first (D-01).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `~/.cache/quantalyze/residchurn/sql/d_keys_prefix.sql` | query (digest) | batch / read-only | `residchurn/sql/d_keys.sql` | exact |
| `~/.cache/quantalyze/residchurn/sql/d_strats_prefix.sql` | query (digest) | batch / read-only | `residchurn/sql/d_strats.sql` | exact |
| `~/.cache/quantalyze/residchurn/sql/d_books_prefix.sql` | query (digest) | batch / read-only | `residchurn/sql/d_books.sql` | role-match |
| `~/.cache/quantalyze/residchurn/sql/d_anchor.sql` | query (extract) | batch / read-only | `residchurn/sql/d_ki.sql` + `tinybase-gc/sql/q_ki.sql` | role-match |
| `~/.cache/quantalyze/residchurn/sql/d_jobs_pre.sql` (pre-nightly per-subject jobs) | query | batch / read-only | `residchurn/sql/d_jobs.sql` | exact (re-run, new file name only if the SQL text changes) |
| `~/.cache/quantalyze/residchurn/sql/d_ledger.sql` (count / max(version) / md5 of versions) | query | batch / read-only | `residchurn/sql/d_checks.sql` (md5 over ordered string_agg) | role-match |
| `~/.cache/quantalyze/residchurn/sql/d_checks_prefix.sql` (PROD-side md5 for the new files, D-02) | query (checksum) | batch / read-only | `residchurn/sql/d_checks.sql` | exact |
| `~/.cache/quantalyze/residchurn/sql/d_months_<scope>.sql` (per-month md5 for a moved scope) | query (digest) | batch / read-only | `residchurn/sql/d_keys.sql` (group key changed to date_trunc) | role-match |
| `~/.cache/quantalyze/residchurn/sql/d_rows_<scope>.sql` (rows for a differing month) | query (extract) | batch / read-only | `tinybase-gc/sql/q_keys.sql` | role-match |
| `~/.cache/quantalyze/residchurn/bin/check_capture.py` | utility (gate script) | transform / file-I/O | `tinybase-gc/bin/fresh.py` + `summarize.py` `load()` | role-match |
| `~/.cache/quantalyze/residchurn/bin/recompute_digest.py` | utility | transform | `tinybase-gc/bin/summarize.py` (`rows_sha`, `load`) + research digest recipe | role-match |
| `~/.cache/quantalyze/residchurn/bin/attribute.py` | utility (diff + bucket) | transform / batch | `tinybase-gc/bin/diff.py` | exact |
| `~/.cache/quantalyze/residchurn/bin/b3_replay.py` | utility (repo-function replay) | transform | `tinybase-gc/bin/recheck.py` (`replay()`) | exact |
| `~/.cache/quantalyze/residchurn/c1/*.json`, `c1/MANIFEST.md`, `c0/MANIFEST.md` (deploy anchor appended) | capture data | file-I/O | `residchurn/c0/*.json`, `c0/MANIFEST.md` | exact |
| `~/.cache/quantalyze/residchurn/rows/<label>/*.json` | capture data | file-I/O | `tinybase-gc/b1/keys.json` row shape | exact |
| `.planning/phases/202-.../202-NN-SUMMARY.md` (marker answers, `gc-*` lines, b3 verdict) | tracked report | doc | `.planning/milestones/v1.20-phases/188-*/188-16-SUMMARY.md`, `188-12-SUMMARY.md` | exact |
| `.planning/phases/202-.../202-B3-EXPLANATION.md` (or a SUMMARY section) | tracked report | doc | `188-16-SUMMARY.md` "What failed, measured" prose | role-match |
| deploy proof lines (Railway lists + `git diff --stat`) in `c0/MANIFEST.md` and the SUMMARY | evidence | doc | `188-15-SUMMARY.md` `gc-rederive:` style (deploy time record) | role-match |
| `analytics-service/tests/test_allocator_equity_inception.py` (CONTINGENCY only) | test | request-response (pure function) | same file, `test_venue_without_full_history_is_unchanged` + `_exact_book` | exact |
| `analytics-service/services/allocator_equity_derive.py` (CONTINGENCY only) | service | transform | same file, `FULL_HISTORY_VENUES` + `replay_key_equity` | exact |
| `analytics-service/services/allocator_equity_compose.py` / `job_worker.py` (CONTINGENCY only, key_inputs carry) | service | transform | `allocator_equity_compose.py:832` wiring of `full_history_keys` | exact |
| `VERSION`, `package.json`, `CHANGELOG.md` (ONLY if the contingency ships code) | config | doc | CLAUDE.md "CHANGELOG discipline" | n/a |

## Pattern Assignments

### Shared conventions for every new `d_*` SQL file

**Source:** `~/.cache/quantalyze/residchurn/sql/d_keys.sql` (one line, no trailing statement, no `;` needed), `d_checks.sql`.

Rules extracted from the existing kit:
- one SELECT per file, one file per MCP call; scope id cast `::text AS scope`; timestamps via `to_char(x AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`; dates via `::text`.
- digest recipe (the exact float-text recipe validated 54/54 in research): `md5(string_agg(date::text || '|' || coalesce(daily_return::text,'null'), ',' ORDER BY date))`.
- every result set that is hand-saved gets a PROD-side md5 in the checks file (D-02): `md5(string_agg(<cols joined with '|'>, ',' ORDER BY scope))`.
- marker first, alone: `~/.cache/quantalyze/tinybase-gc/sql/marker.sql`:
```sql
SELECT shobj_description(oid, 'pg_database') AS which_database FROM pg_database WHERE datname = current_database();
```

---

### `d_keys_prefix.sql` / `d_strats_prefix.sql` (query, digest)

**Analog:** `residchurn/sql/d_keys.sql` and `d_strats.sql` (research Pattern 1: the same text plus one added predicate).

**Core pattern** (`d_keys.sql`, full text):
```sql
SELECT api_key_id::text AS scope, count(*) AS n, min(date)::text AS first, max(date)::text AS last, md5(string_agg(date::text || '|' || coalesce(daily_return::text,'null'), ',' ORDER BY date)) AS h, to_char(max(updated_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS max_updated FROM public.csv_daily_returns WHERE api_key_id IS NOT NULL GROUP BY api_key_id ORDER BY api_key_id
```
**Prefix variant:** copy the line, change only `WHERE api_key_id IS NOT NULL` to `WHERE api_key_id IS NOT NULL AND date <= DATE '2026-11-05'`. For `d_strats_prefix.sql` the predicate is added as `AND c.date <= DATE '2026-11-05'` after the `IN (SELECT s.id ...)` clause. c0's `h` already is the prefix digest (every c0 scope has `last <= 2026-11-05`), so compare c1-prefix `h` to c0 `h` directly.

---

### `d_books_prefix.sql` (query, digest)

**Analog:** `residchurn/sql/d_books.sql` for the column shape; the filtered hash needs `jsonb_array_elements`.

**Core pattern** (`d_books.sql`):
```sql
SELECT allocator_id::text AS scope, md5(coalesce((payload->'returns')::text,'')) AS h_returns, md5(coalesce((payload->'curve')::text,'')) AS h_curve, payload->'is_trustworthy' AS is_trustworthy, payload->'degrade_reasons' AS degrade_reasons, payload->'inputs'->'composed_at' AS composed_at, to_char(computed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS computed_at FROM public.allocator_equity_derived WHERE kind = 'equity_curve' ORDER BY allocator_id
```
Prefix hashes: add a lateral over `jsonb_array_elements(payload->'returns')` (elements are `{date, r}`) and `payload->'curve'` (`{date, equity_usd}`), `WHERE e->>'date' <= '2026-11-05'`, `md5(string_agg((e->>'date')||'|'||(e->>'r'), ',' ORDER BY e->>'date'))`. Note: c0's whole-payload `h_returns` cannot be compared to a prefix hash, so the same prefix query must also be run for c0 state only if c0 is still reproducible; otherwise book comparison to `b1` row-level (books.json carries the arrays) is the fallback. Planner: decide this explicitly, the prefix book hash has no c0 counterpart.

---

### `d_anchor.sql` (query, extract)

**Analog:** `residchurn/sql/d_ki.sql` (the `kind LIKE 'key_inputs:%'` selection) and `tinybase-gc/sql/q_ki.sql` (selects the raw `payload`).

**Core pattern** (`d_ki.sql` / `q_ki.sql` selection shape):
```sql
SELECT allocator_id::text AS scope, kind, md5(payload::text) AS h, to_char(computed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS computed_at FROM public.allocator_equity_derived WHERE kind LIKE 'key_inputs:%' ORDER BY allocator_id, kind
```
**Adapt:** replace `md5(payload::text)` with `payload->>'anchor_usd' AS anchor_usd, payload->'nav_mark' AS nav_mark, payload->>'realized_terminal_usd', payload->>'realized_terminal_day', payload->>'marks_since', payload->>'anchor_asof'`. Output stays in scratch (balances); only ratios and flags go to tracked text.

---

### `d_ledger.sql` (query, checksum)

**Analog:** `d_checks.sql` md5-over-ordered-string_agg shape.
```sql
SELECT count(*) AS n, max(version) AS max_version, md5(string_agg(version, ',' ORDER BY version)) AS h FROM supabase_migrations.schema_migrations
```
(Table has no applied-at column; compare count, max and md5 at c0-time vs c1 and pair with `git log` for `supabase/migrations/**`.)

---

### `d_checks_prefix.sql` (query, PROD-side md5 for D-02)

**Analog:** `residchurn/sql/d_checks.sql` (exact structure: one scalar subselect per capture file, md5 over `scope|n|first|last|h|max_updated` joined by `,` ordered by scope).

**Core pattern** (`d_checks.sql`, keys_check line):
```sql
(SELECT md5(string_agg(scope||'|'||n||'|'||first||'|'||last||'|'||h||'|'||max_updated, ',' ORDER BY scope)) FROM (SELECT api_key_id::text AS scope, count(*) AS n, min(date)::text AS first, max(date)::text AS last, md5(string_agg(date::text || '|' || coalesce(daily_return::text,'null'), ',' ORDER BY date)) AS h, to_char(max(updated_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS max_updated FROM public.csv_daily_returns WHERE api_key_id IS NOT NULL GROUP BY api_key_id) k) AS keys_check
```
The new checks must apply the SAME predicate as the prefix query it protects. Expected shape: `{"keys_check": "...", "strats_check": "...", ...}` saved as `c1/checks.json` (see `c0/checks.json`). The existing `d_checks.sql` still runs unchanged for the four byte-identical c1 files.

---

### `d_months_<scope>.sql` and `d_rows_<scope>.sql` (query)

**Analog:** `d_keys.sql` (digest, group by `date_trunc('month', date)` and filter one scope) and `tinybase-gc/sql/q_keys.sql` (row extract):
```sql
SELECT api_key_id::text AS api_key_id, date::text AS date, daily_return, to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at FROM public.csv_daily_returns WHERE api_key_id IS NOT NULL ORDER BY api_key_id, date
```
**Adapt:** add `AND api_key_id = '<id>'` (id taken at run time from scratch `map.json` + `ordmap`, never written to tracked text) and a month bound. Output row keys must stay `api_key_id|strategy_id, date, daily_return, updated_at`, because `attribute.py` (copy of `diff.py`) reads them through `series(rows, col)`. Prefer per-month md5 first, rows only for differing months (research Pitfall 6).

---

### `bin/check_capture.py` (utility, gate)

**Analog:** `~/.cache/quantalyze/tinybase-gc/bin/fresh.py` (the idle-queue gate: exits 1 on busy derive jobs) plus the `load()` shape guard from `summarize.py`.

**Imports + guard pattern** (`fresh.py`, whole file is the model):
```python
import json, sys
jobs_p, meta_p, taken, last = sys.argv[1:5]
rows = json.load(open(jobs_p))
if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
    sys.exit("FATAL: jobs.json is not a list of row objects")
rel = [r for r in rows if r["kind"] in ("derive_broker_dailies", "derive_allocator_equity")]
busy = [r for r in rel if r["status"] in ("pending", "running", "failed_retry")]
if busy:
    sys.exit(f"FATAL: {len(busy)} derive/compose job(s) still pending, running or awaiting retry")
fin = [r["updated_at"] for r in rel if r["status"] in ("done", "done_pending_children", "failed_final")]
lj = max(fin) if fin else ""
```
**Counts guard** (`diff.py` line 19 / `summarize.py` `full`): `assert int(cn["key_rows"]) == len(kn) and int(cn["strategy_rows"]) == len(sn)`, here applied to the c1 counts file.
**Add:** recompute each file's check md5 locally (`hashlib.md5` over the same joined string, using the `str(int)`/`repr(float)` text recipe) and compare to `c1/checks.json`; assert the marker answer string recorded in `c1/MANIFEST.md` equals the PRODUCTION marker; fail loud with a nonzero exit. Pitfall 2: `c0/jobs.json` is an aggregate shape, do not feed it to this gate; gate on the `d_jobs.sql` per-subject shape. Prove it RED on a deliberately edited input before trusting it.

---

### `bin/recompute_digest.py` (utility)

**Analog:** `tinybase-gc/bin/summarize.py` (`load`, `rows_sha`) for the float-text discipline, and the research "Don't Hand-Roll" row (`repr(float)`, `str(int)`).

**Core pattern** (`summarize.py` lines 1-14):
```python
def load(p):
    r = json.load(open(p))
    if not isinstance(r, list) or any(not isinstance(x, dict) for x in r):
        sys.exit(f"FATAL: {p} is not a list of row objects")
    return r

def rows_sha(rows):
    lines = sorted(f"{x['date']}|{repr(x['daily_return'])}" for x in rows)
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()[:12]
```
**Adapt:** swap sha256 for `hashlib.md5`, join `f"{date}|{repr(v)}"` with `,` in date order (SQL `string_agg(... ORDER BY date)`), `null` for a missing value. Compare to `c0/keys.json` / `strats.json` `h` for all 54 scopes built from `b1` rows (expected 38/38 and 16/16). `--self-test`: flip 1 ULP in one row (`math.nextafter`) and require exit 1.

---

### `bin/attribute.py` (utility, diff and cause bucketing)

**Analog:** `~/.cache/quantalyze/tinybase-gc/bin/diff.py` (exact; copy and extend, do not edit the original). D-09: keep its exact `!=` rule and add size bands beside it.

**Argv + loaders + label map** (`diff.py` lines 2-15):
```python
B, N, MAP = sys.argv[1:4]
L = lambda d, n: json.load(open(os.path.join(d, n + ".json")))
m = json.load(open(MAP))
def ordmap(keys_b, keys_n, ki_b, ki_n):
    ids = sorted({x["api_key_id"] for x in keys_b + keys_n} | {k["kind"].split(":", 1)[1] for k in ki_b + ki_n})
    nxt = 1 + max(int(v[1:]) for v in m.values() if v != "C")
    for k in ids:
        if k not in m: m[k] = f"k{nxt}"; nxt += 1
    return ids
```
Reuse `ordmap` verbatim so k9+ and s1+ labels match 188-16 (`sids = sorted(...)`, `sm = {s: f"s{i+1}" ...}` at line 21).

**Series builder** (line 23-25):
```python
def series(rows, col):
    out = {}
    for x in rows: out.setdefault(x[col], {})[x["date"]] = x["daily_return"]
    return out
```
**The "changed" rule to preserve** (inside `diff_scope`, lines 86-90): compare days strictly before the baseline's last day (`lastB = max(b)`; `comp = [d for d in b if d < lastB]`) and count `n[d] != b[d]` exactly. Extension (D-09): next to `c["changed"] += 1` compute `a = abs(n[d]-b[d])` and increment a band counter (`<=1e-9` low, `<=1e-6` mid, else high). Required invariant (research table): 1214 total, bands 62 / 966 / 186, 54 scopes, 14 changed scopes; `attribute.py b0 b1` must reproduce these and assert the sums (RESID-01).

**Cause bucketing (D-08):** new code, no analog; follow the research cluster table: assign each changed scope to (a) rounding with unchanged terminal, (b) input changed (compare `anchor_usd`/`nav_mark`/`realized_terminal` between `b0` and `b1` `ki.json` payloads, per `stated_keys`-style grouping of `ki` rows by `kind.split(":",1)[1]`), (c) named code path, (d) unexplained. Assert per-bucket counts sum to the total.

**Additive-offset oracle** (research Code Examples, restated; no repo analog):
```python
import statistics
def offset_cv(old, new, lo, hi):        # old/new: {iso_day: daily_return}
    days = sorted(d for d in old if lo <= d <= hi and d in new)
    prod, cum = 1.0, {}
    for d in reversed(days):
        prod *= 1 + old[d]; cum[d] = prod
    vals = [(1 - old[d] / new[d]) / cum[d] for d in days if abs(old[d]) > 1e-9 and new[d] != old[d]]
    return statistics.pstdev(vals) / abs(statistics.mean(vals))
```
`--neuter` self-test: alter one row on a stretch, require CV far from 0 (gate must be able to fail).

**Output line style** (copy `diff.py` `out.append(f"gc-r-diff: scope=...")` lines 91-95; same `scope=<label> compared= vanished= ... changed= ... unexplained=` keys, plus new keys `band_low= band_mid= band_high= bucket=`). The per-day line is `gc-r-diff-day: scope= day= kind= was= now= why=`, with `f = lambda r: "none" if r is None else f"{r:.4f}"` formatting.

---

### `bin/b3_replay.py` (utility, repo-function replay)

**Analog:** `~/.cache/quantalyze/tinybase-gc/bin/recheck.py` (imports the repo's own `replay_key_equity` and `ExternalFlow`, run from `analytics-service/` with the repo venv).

**Imports pattern** (`recheck.py` lines 1-7):
```python
import json, os, sys
from datetime import date, timedelta
import pandas as pd
import services.allocator_equity_derive as aed
from services.allocator_equity_derive import replay_key_equity, read_dropped_day_pnl, read_realized_terminal, read_writer_basis
from services.external_flows import ExternalFlow
D, MAP, BASE = sys.argv[1], sys.argv[2], sys.argv[3]
```
**Replay helper** (`recheck.py` lines 17-24, `replay(kd, p)`): builds `ret = pd.Series({d: v ...}, dtype=float)`, `flows = [ExternalFlow(utc_day_iso=str(f["utc_day_iso"]), usd_signed=float(f["usd_signed"])) for f in (p.get("flows") or [])]` and calls `replay_key_equity(ret, flows, anchor, dropped_day_pnl=..., realized_terminal=read_realized_terminal(p), ...)`. Reuse that helper unchanged. Rows come from `<capture>/keys.json` grouped as `rows.setdefault(r["api_key_id"], {})[r["date"]] = float(r["daily_return"])`; payloads from `ki.json` (`by_k = {r["kind"].split(":", 1)[1]: r for r in ki}`).
**Expected result to assert** (research): k15 with `history_reaches_inception=False` gives `ke.flags == {'out_of_window_flows': 1}`, `ke.degrade_reasons == {OUT_OF_WINDOW_FLOW}`, `ke.is_trustworthy is False`; the six deribit/mt5 keys of b3 each have one flow absorbed by the opening run (call with `history_reaches_inception=True` for those). Then re-run k15 with `True` and report `inception_unreconciled` plus the implied-start share against `aed._INCEPTION_ZERO_START_BAND` (1e-4). Print `gc-r-b3:`-style lines.
Add the `aed.FULL_HISTORY_VENUES == frozenset({"deribit","mt5"})` assertion as a drift guard.

---

### `c1/` capture directory and `c0/MANIFEST.md` addendum (file-I/O)

**Analog:** `~/.cache/quantalyze/residchurn/c0/MANIFEST.md` (and `tinybase-gc/b1/*.json`, `taken.txt`, `meta.json`).

**Manifest shape to copy** (`c0/MANIFEST.md`): header line, then bullets `Channel`, `Marker` (read alone at session start and again inside the last query, with times), `counts taken <ISO>: key_rows=.. strategy_rows=..`, `Files`, `SQL: ../sql/d_*.sql — reuse BYTE-IDENTICAL`, `Verification` (checks.json PROD-side md5, local recompute matched, any transcription error caught), `Jobs`. One JSON per query named exactly `keys.json strats.json books.json ki.json counts.json jobs.json checks.json` so `diff.py`-derived scripts can use `L(d, name)`. Record: c1 `taken` instant, the deploy anchor (Railway deployments per service with commit, plus `git diff --stat` result), the ledger triple at c0-time and c1.

---

### Tracked SUMMARY (`202-NN-SUMMARY.md`, doc)

**Analog:** `.planning/milestones/v1.20-phases/188-tinybase-a-day-measured-against-a-near-empty-account-does-no/188-16-SUMMARY.md` (and `188-12-SUMMARY.md`).

**Frontmatter** (188-16 lines 1-7):
```markdown
---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 16
subsystem: analytics
tags: [gap-closure, prod-reading, sc-4]
completed: 2026-11-06
---
```
(Phase 202 uses `phase: 202-residchurn-...`, `tags: [prod-reading, control-capture]`; use `verified_at_sha` and `drift_subjects`, never `covered_digest`/`covered_files` in any VERIFICATION file, per CLAUDE.md.)

**Opening and marker lines** (188-16 lines 9-14):
```markdown
Read on PROD on 2026-11-06 after the 00:40Z nightly (188-15 `gc-rederive:`). Capture `b1` was taken at 07:04:02Z, with the marker run alone before it and again after it. Both read PRODUCTION. Baseline: `b0`, taken 2026-11-05T08:32:31Z (188-12).

marker-gc: PRODUCTION
gc-r-tracer: key=C rows=1155 ...
```
Phase 202 equivalents: `marker-202: PRODUCTION` before and inside the last query of each capture.

**`gc-*` line family to copy and extend** (188-16, lines 20-52 equivalents):
```
gc-r-book: book=b3 was=false now=false reasons_now=out_of_window_flow,window_truncated baseline_mismatch=yes recovered=no residual=out_of_window_flow,window_truncated
gc-r-diff: scope=k15 compared=285 vanished=0 vanished_stated=0 vanished_hull=0 changed=277 appeared=0 unexplained=277
gc-r-diff-total: scopes=54 compared=15013 vanished_stated=50 vanished_hull=0 unexplained=1214
gc-r-curve: book=b1 compared=193 returns_changed=96 returns_vanished=0 returns_unexplained=96 curve_max_rel_diff=6.09e-05 latest_moved_day=2026-10-25 latest_vanished_stated_day=none curve_rule=broken
gc-verdict: NOT CONFIRMED (...)
```
Phase 202 should add new-prefix lines in the same `key=value` style, for example `gc-c-prefix: scopes=54 moved=<n> moved_scopes=<labels>`, `gc-c-deploy: service=<api|worker> deployments=<n> code_diff=empty|nonempty`, `gc-c-ledger: count_equal=yes max_equal=yes md5_equal=yes`, `gc-c-cause: bucket=<a|b|c|d> scopes=<labels> rows=<n> band=<low>/<mid>/<high>`, `gc-c-total: rows=1214 attributed=<n> unexplained=<n>`, `gc-c-b3: reason=out_of_window_flow verdict=correct|defect ...`. No ids, no amounts.

**Section scaffolding to copy:** `## What passed`, `## What failed, measured`, `## Founder decision` (188-16 lines 59-76), and a short closing verdict line. Tracked text uses labels only.

---

### `analytics-service/tests/test_allocator_equity_inception.py` (CONTINGENCY only)

**Analog:** the same file. Only fires if `c1` contradicts the "correct behaviour" verdict (D-12). RED-first, TDD.

**Imports pattern** (lines 22-39):
```python
from __future__ import annotations

from datetime import date, timedelta
from fractions import Fraction

import pandas as pd
import pytest

from services import allocator_equity_derive as derive
from services.allocator_equity_compose import compose_allocator_equity
from services.allocator_equity_derive import (
    FULL_HISTORY_VENUES,
    DegradeReason,
    replay_key_equity,
)
from services.external_flows import ExternalFlow
```
**Independent exact oracle** (lines 61-98): `_exact_book(start_capital, flows, window_flows)` builds the level FORWARD in `Fraction` and returns `(level_lo, float(anchor))`; `_start_for_share(target_share, guess)`; `_flows(spec)`; `_share(start, level_lo)`; `BAND = Fraction(1, 10_000)` restated on purpose (the test must not read the band from the module).
**Test shape to copy** (lines 100-117 inside-band case; fixture guard asserts the share lands on the intended side with margin: `assert Fraction(1, 3) * BAND < _share(start, level_lo) < Fraction(7, 10) * BAND`).
**Pinned behaviour that a fix must consciously change** (lines 233-250 `test_venue_without_full_history_is_unchanged`; lines 271-278 pin `FULL_HISTORY_VENUES == frozenset({"deribit", "mt5"})` and `_INCEPTION_ZERO_START_BAND == float(BAND)`). The founder pinned the venue list (167.1.2.2 D-13/D-14); a fix would be a plan-level founder decision, not an executor choice.
**Rules:** pytest only from `analytics-service/`; never `importlib.reload`; run `python3 -m pytest tests/test_allocator_equity_inception.py -x -q`; show RED on today's code before the fix; mypy strict (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`) in any brief.

### `analytics-service/services/allocator_equity_derive.py` (CONTINGENCY only)

**Analog:** the same file. Excerpts the planner needs for the verdict write-up (all read-only unless the contingency fires):

Closed reason sets (lines 180-197):
```python
_BLOCKING_REASONS: frozenset[DegradeReason] = frozenset(
    {
        DegradeReason.UNCLASSIFIED_ROTATION,
        DegradeReason.EXCLUSIVE_FILL,
        DegradeReason.OUT_OF_WINDOW_FLOW,
        DegradeReason.INCEPTION_UNRECONCILED,
        DegradeReason.DROPPED_KEY,
        ...
```
(`WINDOW_TRUNCATED` is under `# ── BENIGN ──` at `:109` and is NOT in this set; `OUT_OF_WINDOW_FLOW` `:121` is.)

Venue pin (line 1144):
```python
FULL_HISTORY_VENUES: frozenset[str] = frozenset({"deribit", "mt5"})
```
Zero-start band (line 1101): `_INCEPTION_ZERO_START_BAND = 1e-4`.

Per-key out-of-window count (lines 1492-1498):
```python
ret_days = sorted(r)
out_of_window_flows = 0
opening_run: list[str] = []
if ret_days:
    lo, hi = ret_days[0], ret_days[-1]
    if history_reaches_inception:
        opening_run = _opening_flow_run(fbd, lo)
    out_of_window_flows = sum(1 for fd in fbd if fd < lo or fd > hi) - len(opening_run)
```
Reason add (lines 1671-1673): `if out_of_window_flows: flags["out_of_window_flows"] = out_of_window_flows; reasons.add(DegradeReason.OUT_OF_WINDOW_FLOW)`.
Opening run (lines 2300-2311): `_opening_flow_run(fbd, first_return_day)` walks back by calendar day from `first_return_day - 1`.
Book-level truncation (lines 2476-2490): `window_truncated = any(key_first[k] != union_days[0] or key_last[k] != union_days[-1] for k in anchored)` then `reasons.add(DegradeReason.WINDOW_TRUNCATED)`.

If the contingency fires, the fix pattern (research) is a stored per-key inception verdict carried in `key_inputs` and read by the compose, mirroring how `full_history_keys` reaches the replay at `allocator_equity_compose.py:832`, not a wider venue list. Ship rules apply: CHANGELOG entry in the same commit as the VERSION bump, `VERSION` and `package.json` byte-equal 4-digit strings, never `npm version`, no skip-CI tokens in commit text, no AI attribution trailers, merge only after `c1` is taken (D-05).

---

## Shared Patterns

### Marker query first, alone, read-only
**Source:** `~/.cache/quantalyze/tinybase-gc/sql/marker.sql` and CLAUDE.md "Which database am I on?".
**Apply to:** every capture and every ad-hoc MCP read. Record the answer in MANIFEST and the SUMMARY as `marker-202: PRODUCTION`; a NULL answer stops the work.

### One query per MCP call, hand-saved result checked by a PROD-side md5 (D-01, D-02)
**Source:** `residchurn/sql/d_checks.sql` + `c0/checks.json` + `c0/MANIFEST.md` "Verification" bullet (a transcription error was caught this way).
**Apply to:** every new SQL file whose result is saved by hand. Local recompute must equal the PROD md5 before the file is used.

### Fail-loud gate scripts that are shown RED first
**Source:** `tinybase-gc/bin/fresh.py`, `summarize.py` (`sys.exit("FATAL: ...")`), `diff.py` line 19 (`assert ..., "FATAL: b1 counts disagree"`).
**Apply to:** `check_capture.py`, `recompute_digest.py`, `attribute.py`, `b3_replay.py`. Each gets a `--self-test` or `--neuter` mode proving it exits nonzero on a broken input (repo rule: a gate that cannot fail is wrong; restore from a byte backup, never `git checkout`/`stash` on uncommitted work).

### 188's exact "changed" rule, bands beside it (D-09)
**Source:** `tinybase-gc/bin/diff.py` lines 86-90 (`elif n[d] != b[d]: c["changed"] += 1`), comparing only days before the baseline's last day.
**Apply to:** `attribute.py` only. Do not introduce a tolerance.

### Scope labels from `map.json` + sorted-id order
**Source:** `tinybase-gc/map.json` (C, k1..k8) plus `diff.py` `ordmap` / `sm` (k9+, s1+ assigned by sorted id).
**Apply to:** every script and every tracked line. Tracked text uses labels, never ids.

### Public-repo hygiene
**Apply to:** SUMMARY and any tracked file. No PROD ids, balances (`anchor_usd`, terminals, flow amounts), passwords, home paths; ratios and flags only. `d_anchor` figures stay in scratch. Never quote a search pattern as proof of absence.

### Ship guard
**Apply to:** the phase branch. A measurement-only phase changes nothing outside `.planning/`; `git diff --name-only origin/main...HEAD -- analytics-service supabase/migrations` must be empty unless the contingency fired. Hold (D-05): no merge touching `analytics-service/` or `supabase/migrations/**` until `c1` is taken.

### Deploy proof by content (D-04 as amended)
**Source:** research "Proving no deploy"; CLI form `railway deployment list --json` (status, `commitHash`) per docs/runbooks/mt5-go-live.md Step 6; analog evidence style `188-15-SUMMARY.md` (deploy time recorded in the SUMMARY).
**Apply to:** both Railway services (API and worker). For every deployment in the c0 to c1 window: `git diff --stat <c0-live commit>..<its commit> -- analytics-service supabase/migrations` is empty; ledger triple (count, max version, md5) equal. Recovery of a skipped deploy is the founder's.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Cause-bucket assignment inside `attribute.py` (D-08 buckets) | utility | transform | `diff.py` has no cause classification; the research cluster table and additive-offset oracle are the only source. |
| Prefix-filtered book hash (`d_books_prefix.sql`) | query | batch | No existing query hashes a filtered `jsonb_array_elements` of `payload->'returns'`; and c0 holds no matching prefix hash for books (decide the comparison basis in the plan). |
| Railway/ledger deploy-proof capture | evidence | doc | No prior scratch tool lists Railway deployments; use the runbook CLI form or the Railway MCP. |

## Metadata

**Analog search scope:** `~/.cache/quantalyze/tinybase-gc/{bin,sql}`, `~/.cache/quantalyze/residchurn/{sql,c0}`, `.planning/milestones/v1.20-phases/188-*/` (12, 16 summaries), `analytics-service/tests/test_allocator_equity_inception.py`, `analytics-service/services/allocator_equity_derive.py`.
**Tracked-source gate (#3645):** `git ls-files` confirmed tracked for the 188 summaries, the inception test, `pytest.ini` and `allocator_equity_derive.py`. Scratch kits are untracked by decision, not mirrors.
**Files scanned:** 5 scratch scripts, 17 scratch SQL/JSON, 2 tracked summaries, 2 tracked code files.
**Pattern extraction date:** 2026-11-06

# Phase 217: SERVERRULE — the MT5 server time rule is chosen per broker server - Context

**Gathered:** 2026-11-18
**Status:** Ready for planning

<domain>
## Phase Boundary

The MT5 server time rule is chosen per broker server, not once per worker. Today
`derive_broker_dailies` (`analytics-service/services/job_worker.py`) resolves ONE clock from
`MT5_SERVER_TIME_RULE` (or `MT5_SERVER_UTC_OFFSET_S`) for every key. This phase adds a per-server
map, keyed by the server-label hash Phase 155.1 already writes on every reading (155.1 D-17), so a
server that keeps UTC gets a `utc` rule and its derive passes the 155.1 clock guard instead of
ending `failed_final`.

Trigger, measured 2026-11-18 on PROD (`public.mt5_server_clock_readings`, read through the Supabase
MCP, marker query first): four server hashes. Hash prefix `13a451cff998`: 1 key, 6 `mismatch` rows,
measured +0h against the `us` rule's +2h. Prefixes `a28e23d0dd65` (5 keys), `c419e24c0702` (4 keys)
and `36f000d8c51a` (1 key): all `match` at +2h.

Out of scope: writing any Railway variable (the coordinator sets the server entry after deploy);
any migration (see "utc is fixed 0" below); learning a rule from a reading (155.1 D-12); any
publishing or UI change; Phase 216's files (`routers/process_key.py`).

</domain>

<decisions>
## Implementation Decisions

### Founder decisions, 2026-11-18 (locked; asked through the coordinator)
- **Q1 "Railway map by hash (Recommended)".** A new Railway variable `MT5_SERVER_TIME_RULES` maps
  each FULL server-label hash (64 lowercase hex, the `server_label_hash` value) to a rule `eu`,
  `us` or `utc`. `MT5_SERVER_TIME_RULE` stays the default for every unmapped server, so the three
  servers that match today change nothing. A malformed map fails loud as a configuration fault,
  the 175 / D-04 shape (transient, closed-set value-free text). After deploy the coordinator sets
  the `13a451cff998…` entry in Railway; this phase writes no Railway variable. — **Reversibility:**
  costly — the variable name and value grammar become an operator contract in Railway.
  ⛔ **CORRECTED 2026-11-18 (coordinator, same day): ordering is BEFORE deploy, not after.** Under Q2 an
  unmapped mismatch writes, so a deploy before the entry exists would let the first derive of the
  `13a451cff998` key write days dated under `us`. The coordinator sets `MT5_SERVER_TIME_RULES` on both
  worker services once the 217 PR is green and before it merges; the pre-217 worker ignores the
  unknown variable and keeps refusing that key. The "after deploy" sentence above is kept as lineage.
- **Q2 "Write and alert" — ⛔ EXPLICIT FOUNDER OVERRIDE of 155.1 D-01, for UNMAPPED servers only.**
  The founder chose the non-recommended option. A server with NO map entry whose measured offset
  mismatches the default rule no longer refuses: the derive records the reading (verdict
  `mismatch`, as now), raises an ops_alert page, and continues to persist using the default rule.
  **Known cost the founder accepted:** mis-dated days can be written for such a server until it is
  mapped. The recommendation was to keep refusing (a refusal never writes a wrong day); it was
  declined. Recorded here and in the ROADMAP Phase 217 section per the CLAUDE.md deviation policy.
  — **Reversibility:** costly — days written under the wrong rule stay wrong until that key's
  next derive under a corrected rule re-derives them.
- **utc is fixed offset 0 (Claude's call, accepted by the founder via the coordinator).** A `utc`
  map value resolves to `fixed_server_clock(0)`. Its readings store `configured_rule='fixed'` with
  `expected_offset_s = 0`, which the existing `configured_rule` CHECK (`eu`, `us`, `fixed`)
  already admits, so there is NO migration. Map values are `eu`, `us`, `utc` only.

### What still refuses (precise; settled by 155.1 CONTEXT plus the Q2 scope)
- **Mapped server, mismatch → REFUSES**, exactly as today (155.1 D-01 / D-11 stand: named
  `Mt5ServerClockMismatchError`, nothing written but the reading, `clock_mismatch` page,
  transient). The founder override names unmapped servers only; a mapped server's rule is the
  operator's explicit claim, so disagreeing with it is the fail-loud case D-01 was written for.
- **Malformed `MT5_SERVER_TIME_RULES` → REFUSES** as a configuration fault before any terminal
  call (175 / D-04 pre-read placement, Pitfall 3): transient, value-free closed-set text, no
  stamp, nothing written. Malformed covers: an entry without `=`, a key that is not exactly 64
  lowercase hex, a value outside `eu`/`us`/`utc`, and the same hash listed twice (two answers,
  so neither wins — the 175 "both set" precedent). An empty or unset variable is an empty map,
  not a fault.
- **Default configuration faults → REFUSE** as today (neither default variable set, unknown rule
  id, both set, malformed offset), even when the map is valid.
- **Unmapped server, mismatch → DOES NOT REFUSE** (Q2 override): reading written, page raised,
  derive continues under the default rule.
- **`match` and `unmeasured` → unchanged** (155.1 D-10): never refuse.
- **Reading-insert failure → REFUSES** as today (155.1 plan 03 arm), for every verdict: the row
  is written for every verdict before any decision.

### Decided autonomously
- [Selection point] Q: "When is the per-server rule picked?" → Selected: "The map and the default are parsed once BEFORE the terminal read (so every config fault stays pre-read), and the clock is selected once AFTER the read from the hash of the PRE `account_info().server`, the same value `build_mt5_server_clock_reading_row` hashes; every offset site then uses that one clock" — internal control flow in one handler; all `_mt5_clock` uses already sit after the read.
- [Selection point] Q: "Which server value keys the lookup?" → Selected: "`server_label_hash(account_info().server)` from `services/mt5_server_clock_reading.py`, so the rule chosen and the hash on the reading row are equal by construction" — a one-line choice inside the worker.
- [Selection point] Q: "A blank or missing account server (hash None)?" → Selected: "Unmapped: the default rule applies" — local branch.
- [Map grammar] Q: "Value syntax of MT5_SERVER_TIME_RULES?" → Selected: "Comma-separated `<hash>=<rule>` entries; each part stripped, rule lower-cased, empty parts ignored; keys must be 64 lowercase hex" — parser in the stdlib leaf, pinned by tests.
- [Map grammar] Q: "Full hash or a prefix as key?" → Selected: "Full 64-hex hash" — exact equality, no prefix ambiguity; tracked text and logs still show prefixes or nothing.
- [Alert] Q: "How is an unmapped mismatch heard?" → Selected: "`ops_alert.page('mt5_server_clock', <new closed-set cause for the unmapped case>, ...)` with the same value-free detail as `clock_mismatch` (rule id and two offsets in hours) plus a WARNING/ERROR log naming the job and key id; never the server name or hash (D-17)" — alert cause naming is internal.
- [Readings] Q: "What does the reading row record for an unmapped mismatch?" → Selected: "Unchanged row shape: verdict `mismatch`, `configured_rule` of the default clock" — no schema change.
- [Tests] Q: "How is it proven?" → Selected: "Pure-leaf tests for the map parser and selection; job-level tests in `tests/test_mt5_derive_branch.py` style: mapped utc server matches and persists; mapped server mismatching refuses; unmapped mismatch persists and pages; malformed map faults pre-read; each must go RED when its branch is neutered" — test layout only.

### Claude's Discretion
- Exact function, constant and alert-cause names; whether the selection helper lives in
  `mt5_server_clock.py` (preferred: stdlib-only, network-free) or the reading leaf; how
  `test_one_clock_per_derive` is adapted so it still proves one clock per derive.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/mt5_server_clock.py`: `resolve_mt5_server_clock`, `server_clock_for_rule`,
  `fixed_server_clock`, `Mt5ServerClockConfigError`, `MT5_SERVER_CLOCK_CONFIG_MESSAGES` (closed
  set, value-free), `assess_server_clock_reading`, `Mt5ServerClockMismatchError`,
  `format_offset_hours`.
- `services/mt5_server_clock_reading.py`: `server_label_hash` (unsalted SHA-256 of
  `normalise_mt5_server`), `build_mt5_server_clock_reading_row`.
- `services/ops_alert.py`: `page(source, cause, *, event, detail, extra_tags)`.

### Established Patterns
- Config fault before any terminal call → `DispatchResult(FAILED, transient)` with resolver text
  (job_worker.py around the `arm=server_clock_config` log).
- Mismatch arm after the readings insert (job_worker.py `arm=server_clock_mismatch`): constructs
  the named error, logs, pages, returns transient.
- Contract tests: `tests/test_mt5_server_clock.py` (resolver, `test_one_clock_per_derive`),
  `tests/test_mt5_server_clock_readings_parity.py`, `tests/test_mt5_derive_branch.py` (job level),
  `tests/conftest.py` (clock env fixture around line 440).

### Integration Points
- `derive_broker_dailies` in `services/job_worker.py`: the resolve site, the assessment/mismatch
  block, and every `_mt5_clock` offset site after the read (combine, `mt5_day_pnl`, NAV levels,
  `deal_utc_day`, `deal_utc_instant_ms`, the later `mt5_day_pnl` call).
- Ops docs that name `MT5_SERVER_TIME_RULE` (runbooks / `.env.example` if present) gain the new
  variable.

</code_context>

<specifics>
## Specific Ideas

- Tracked text names servers by hash prefix only (`13a451cff998`); never a server name, login or
  account number.
- The success check after deploy and the coordinator's Railway entry: the next derive for the
  `13a451cff998` key writes a `match` reading under `configured_rule='fixed'`, expected 0.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

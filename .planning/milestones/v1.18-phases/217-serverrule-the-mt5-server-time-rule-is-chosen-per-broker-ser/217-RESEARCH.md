# Phase 217: SERVERRULE — the MT5 server time rule is chosen per broker server - Research

**Researched:** 2026-11-18
**Domain:** analytics-service MT5 derive (Python 3.12 worker, stdlib-only clock leaf, ops_alert, Railway env config)
**Confidence:** HIGH (every site, test and doc pointer below was opened this session at HEAD `5ad0847ba` in the phase-217 worktree; baseline suites were run green)

No packages are installed by this phase and no web research was needed: the work is stdlib Python inside two existing modules plus tests and two runbooks. There is no `## Package Legitimacy Audit` to run.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
Copied from `217-CONTEXT.md` `<decisions>` (founder decisions 2026-11-18, asked through the coordinator):

- **Q1 "Railway map by hash (Recommended)".** A new Railway variable `MT5_SERVER_TIME_RULES` maps each FULL server-label hash (64 lowercase hex, the `server_label_hash` value) to a rule `eu`, `us` or `utc`. `MT5_SERVER_TIME_RULE` stays the default for every unmapped server, so the three servers that match today change nothing. A malformed map fails loud as a configuration fault, the 175 / D-04 shape (transient, closed-set value-free text). After deploy the coordinator sets the `13a451cff998…` entry in Railway; this phase writes no Railway variable. Reversibility: costly — the variable name and value grammar become an operator contract in Railway.
- **Q2 "Write and alert" — EXPLICIT FOUNDER OVERRIDE of 155.1 D-01, for UNMAPPED servers only.** A server with NO map entry whose measured offset mismatches the default rule no longer refuses: the derive records the reading (verdict `mismatch`, as now), raises an ops_alert page, and continues to persist using the default rule. Known cost the founder accepted: mis-dated days can be written for such a server until it is mapped. Recorded here and in the ROADMAP Phase 217 section per the CLAUDE.md deviation policy. Reversibility: costly.
- **utc is fixed offset 0 (Claude's call, accepted by the founder).** A `utc` map value resolves to `fixed_server_clock(0)`. Its readings store `configured_rule='fixed'` with `expected_offset_s = 0`, which the existing `configured_rule` CHECK (`eu`, `us`, `fixed`) already admits, so there is NO migration. Map values are `eu`, `us`, `utc` only.
- **What still refuses:** Mapped server + mismatch refuses exactly as today (155.1 D-01 / D-11 stand: named `Mt5ServerClockMismatchError`, nothing written but the reading, `clock_mismatch` page, transient). Malformed `MT5_SERVER_TIME_RULES` refuses as a configuration fault before any terminal call (175 / D-04 pre-read placement, Pitfall 3): transient, value-free closed-set text, no stamp, nothing written; malformed = an entry without `=`, a key that is not exactly 64 lowercase hex, a value outside `eu`/`us`/`utc`, the same hash listed twice; an empty or unset variable is an empty map, not a fault. Default configuration faults still refuse even when the map is valid. `match` and `unmeasured` unchanged (155.1 D-10). Reading-insert failure still refuses, for every verdict.
- **Selection point:** the map and the default are parsed once BEFORE the terminal read; the clock is selected once AFTER the read from the hash of the PRE `account_info().server` (`server_label_hash` from `services/mt5_server_clock_reading.py`), and every offset site then uses that one clock.
- **Blank or missing account server (hash None):** unmapped, the default rule applies.
- **Map grammar:** comma-separated `<hash>=<rule>` entries; each part stripped, rule lower-cased, empty parts ignored; keys must be 64 lowercase hex; full hash, exact equality, no prefix.
- **Alert:** `ops_alert.page('mt5_server_clock', <new closed-set cause for the unmapped case>, ...)` with the same value-free detail as `clock_mismatch` (rule id and two offsets in hours) plus a WARNING/ERROR log naming the job and key id; never the server name or hash (D-17).
- **Readings:** unchanged row shape for an unmapped mismatch: verdict `mismatch`, `configured_rule` of the default clock.
- **Tests:** pure-leaf tests for the parser and selection; job-level tests in the `tests/test_mt5_derive_branch.py` style: mapped utc server matches and persists; mapped server mismatching refuses; unmapped mismatch persists and pages; malformed map faults pre-read; each must go RED when its branch is neutered.

### Claude's Discretion
Exact function, constant and alert-cause names; whether the selection helper lives in `mt5_server_clock.py` (preferred: stdlib-only, network-free) or the reading leaf; how `test_one_clock_per_derive` is adapted so it still proves one clock per derive.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. Out of scope per the phase boundary: writing any Railway variable, any migration, learning a rule from a reading (155.1 D-12), any publishing or UI change, Phase 216's files (`routers/process_key.py`).
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are assigned (ROADMAP: `**Requirements**: TBD`). The phase refines MT5-06 (155.1) and has no REQUIREMENTS.md row of its own. The planner should state the behaviours it plans against by the decision labels above (Q1, Q2, utc-fixed-0) rather than an invented ID.
</phase_requirements>

## Summary

The change is small and fully contained in `analytics-service`. Exactly ONE place resolves and uses the live MT5 server clock: `run_derive_broker_dailies_job` in `services/job_worker.py`. The resolver is called once before the terminal read; all six offset-carrying calls and the assessment, the reading-row builder and the mismatch arm sit after the read, where the PRE `account_info` (`_mt5_info = _mt5_read.info`) is in scope. No backfill, script, router or other worker path calls `resolve_mt5_server_clock` or reads the deal ledger with a live clock (`read_mt5_deal_ledger` has one caller, the derive). `services/mt5_parity.py` and the `scripts/` helpers take an explicit clock argument and are untouched.

Recommended shape: add to the stdlib leaf `services/mt5_server_clock.py` (a) the env constant and a closed-set malformed-map message, (b) `parse_mt5_server_time_rules(environ=None)` returning hash to `Mt5ServerClock` (`utc` becomes `fixed_server_clock(0)`), (c) a `select_mt5_server_clock(default, rules, server_hash)` that takes the ALREADY-computed hash and returns the clock plus an explicit `mapped` flag. In the derive: resolve default and parse the map in the existing pre-read `try`; after the read, compute the hash with `server_label_hash(_mt5_info.get("server"))`, select once, bind `_mt5_clock`, and branch the mismatch arm on `mapped`. `resolve_mt5_server_clock` itself stays byte-identical, so its large test table does not move.

The two risks that matter for the planner are test-shaped, not code-shaped. First, several existing tests pin the current structure (the AST one-clock test, the four-message closed-set test, the stdlib-leaf import allow-list, the single-reader constant scan, and the mismatch job test which uses an UNMAPPED server and so now describes the write-and-alert path). Second, the new tests are easy to write so that they pass with the feature deleted (the suite-wide default is fixed 0, which is the same clock a `utc` entry selects; "mapped" cannot be inferred from `clock != default`). Both are itemised below.

**Primary recommendation:** Keep `resolve_mt5_server_clock` untouched; add parse + select to the leaf (hash passed in, no `re`/`hashlib`); in the derive bind `_mt5_clock` exactly once after the read from the selection and give the mismatch arm two branches keyed on `selection.mapped`; adapt, never delete, the five pinned tests listed under Common Pitfalls.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Parse `MT5_SERVER_TIME_RULES`, select the clock per server | API / Backend (analytics worker, stdlib leaf) | — | Pure, network-free configuration logic; same tier as `resolve_mt5_server_clock` |
| Choose the clock inside the derive, branch mismatch on mapped-ness | API / Backend (`run_derive_broker_dailies_job`) | — | Only worker path that dates MT5 deals live |
| Hash of the account server | API / Backend (`server_label_hash`) | — | Already the row builder's hash; reused so rule chosen and row hash are equal by construction |
| Operator-owned map value | Deployment config (Railway variable on each worker service) | Docs/runbooks | Configuration, never learned from a reading (155.1 D-12) |
| Evidence of the reading | Database (`mt5_server_clock_readings`) | — | Unchanged; `fixed` and the 64-hex hash are already admitted by named CHECKs |
| Page for an unmapped mismatch | API / Backend (`ops_alert.page`) | Sentry/founder email via existing route | Cause is a free `[a-z0-9_:.-]{1,64}` string; no registry to extend |

No browser, SSR, CDN or UI tier is involved.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Python stdlib only (`os`, `dataclasses`, `typing`, `collections.abc`) | CI: Python 3.12 (`pyproject.toml` `python_version = "3.12"`) | Parser, selection, dataclass | The leaf is pinned stdlib-only by `test_the_clock_module_is_a_stdlib_leaf` |
| existing `services/mt5_server_clock.py`, `services/mt5_server_clock_reading.py`, `services/ops_alert.py` | in-repo | Reuse | CONTEXT "Reusable Assets" |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Selection in the leaf taking a hash argument | Selection in `mt5_server_clock_reading.py` (already imports `normalise_mt5_server`) | Leaf stays stdlib and network-free; the reading module could own hash+select in one call but would grow a second concern. Leaf preferred (CONTEXT). |
| One closed-set malformed-map message | One message per sub-fault (no `=`, bad key, bad value, duplicate) | One message is enough and keeps the tuple at 5; per-fault texts tell the operator which part is wrong but each needs its own reach in the test table. Planner's call (discretion). |

**Installation:** none.

## Architecture Patterns

### System Architecture Diagram

```
Railway env (per worker service)
  MT5_SERVER_TIME_RULE | MT5_SERVER_UTC_OFFSET_S   (default; unchanged grammar)
  MT5_SERVER_TIME_RULES = <64hex>=eu|us|utc,...     (new; per-server map)
        |
        v   [pre-read, one try block, Mt5ServerClockConfigError -> FAILED transient, no terminal call]
  resolve_mt5_server_clock()  --> default clock
  parse_mt5_server_time_rules() --> {hash: clock}        (utc -> fixed_server_clock(0))
        |
        v   terminal read (read_mt5_deal_ledger: PRE account_info, deals, tick)
  _mt5_info = _mt5_read.info
        |
        v   server_hash = server_label_hash(_mt5_info.get("server"))   (None for blank)
  select_mt5_server_clock(default, rules, server_hash) --> (clock, mapped)   [bind _mt5_clock ONCE]
        |
        +--> assess_server_clock_reading(_mt5_clock, ...) --> verdict
        +--> build_mt5_server_clock_reading_row(clock=_mt5_clock, server=...)  --> INSERT (every verdict)
        |       insert fails --> FAILED transient (unchanged arm)
        |
        +-- verdict == mismatch AND mapped      --> clock_mismatch page, FAILED transient (unchanged)
        +-- verdict == mismatch AND NOT mapped  --> new-cause page + log, CONTINUE under default clock (Q2)
        +-- match | unmeasured                  --> continue (unchanged)
        |
        v   six offset sites all read _mt5_clock:
  combine_mt5_deal_ledger, mt5_day_pnl (x2), reconstruct_mt5_nav_levels, deal_utc_day, deal_utc_instant_ms
```

### Recommended Project Structure
```
analytics-service/
├── services/mt5_server_clock.py          # + env const, malformed-map message, parse, select (stdlib leaf)
├── services/mt5_server_clock_reading.py  # unchanged logic; docstring "one consumer" claim goes stale
├── services/job_worker.py                # pre-read parse; post-read select; two-way mismatch arm
├── tests/test_mt5_server_clock.py        # parser/selection tests; adapted AST pins
├── tests/test_mt5_derive_branch.py       # job-level tests; adapt the mismatch test
└── tests/conftest.py                     # clock env fixture also clears the new variable
docs/runbooks/mt5-go-live.md, navmtm-chain-move-go-live.md   # document the variable
```

### Pattern 1: Pre-read config fault
**What:** Both config reads sit in the one existing `try` whose `except Mt5ServerClockConfigError` logs `arm=server_clock_config` and returns `FAILED` / `transient` with the resolver text.
**Example (current code, to extend; cite by symbol `run_derive_broker_dailies_job`):**
```python
# Source: analytics-service/services/job_worker.py (read this session)
try:
    _mt5_clock = resolve_mt5_server_clock()
except Mt5ServerClockConfigError as _clock_exc:
    logger.error(
        "derive_broker_dailies: mt5 server clock configuration fault "
        "(job=%s arm=server_clock_config) — %s",
        job.get("id"), _clock_exc,
    )
    return DispatchResult(
        outcome=DispatchOutcome.FAILED,
        error_message=f"derive_broker_dailies: {_clock_exc}",
        error_kind="transient",
    )
```
Becomes: `_mt5_default_clock = resolve_mt5_server_clock()` and `_mt5_server_rules = parse_mt5_server_time_rules()` inside that same `try`. The fault arm needs no change.

### Pattern 2: Two-way mismatch arm (illustrative shape, names are the planner's)
```python
_mt5_server_hash = server_label_hash(_mt5_info.get("server"))
_mt5_selection = select_mt5_server_clock(_mt5_default_clock, _mt5_server_rules, _mt5_server_hash)
_mt5_clock = _mt5_selection.clock          # the ONLY binding of _mt5_clock
...
if _mt5_clock_assessment.verdict == "mismatch":
    _mt5_clock_mismatch = Mt5ServerClockMismatchError(rule=_mt5_clock.rule, ...)
    if _mt5_selection.mapped:
        ...existing refusal block, byte-identical...
    else:
        # Q2 override: heard, not refused
        logger.error("... arm=server_clock_unmapped_drift ...")   # see Pitfall 9 for the name
        await ops_alert.page("mt5_server_clock", "<new cause>", event="outage", detail=<same hours-only detail>,
                             extra_tags={"first_api_key_id": str(ctx.key_row["id"])})
        # fall through: no return
```

### Anti-Patterns to Avoid
- **Inferring "mapped" from `clock != default`:** a server mapped to the same rule as the default (e.g. both `us`) is still mapped and must still refuse. Return the flag from the selection.
- **Resolving or selecting per offset site:** one `_mt5_clock` per derive (Pitfall 4 of 175).
- **Putting `utc` into `MT5_DST_RULE_IDS` or `server_clock_for_rule`:** that would make `MT5_SERVER_TIME_RULE=utc` valid for the DEFAULT variable and break the unknown-rule fault table. `utc` exists only as a map value, translated at parse time.
- **Writing the reading back into the map or into any log/alert (D-12, D-17).**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Server-name normalisation | a second normaliser for the map | `server_label_hash(account_info().server)` (trim then `casefold` via `normalise_mt5_server`) | Rule chosen and row hash are equal by construction (CONTEXT) |
| Fixed zero offset | a new clock class | `fixed_server_clock(0)` | `Mt5ServerClock(rule="fixed", fixed_offset_s=0)`; readings CHECK already admits `fixed` |
| Page throttling | custom dedupe | `ops_alert.page` window `(source, cause, event)` per hour | A new cause gets its own hourly window, so three unmapped keys page once and never starve `clock_mismatch` |
| Hex validation | `re` in the leaf | explicit char-set test (`len(k) == 64 and set(k) <= set("0123456789abcdef")`) | `re` is not in the leaf's import allow-list, and `str.isalnum`/`isdigit` accept non-ASCII |

**Key insight:** every piece already exists; the phase is selection plumbing plus a two-way branch. The cost of getting it wrong is silent mis-dated days, so the tests are the deliverable.

## Common Pitfalls

### Pitfall 1: The mismatch test now describes the wrong path
**What goes wrong:** `test_a_server_clock_mismatch_refuses_the_derive_pages_once_and_keeps_its_reading` (tests/test_mt5_derive_branch.py) uses `_clock_derive_env(rule="us")` and the server `_PLANTED_SERVER`, i.e. an UNMAPPED server. Under Q2 that derive no longer refuses, so the test goes red.
**How to avoid:** adapt it to the MAPPED refusal case by setting `MT5_SERVER_TIME_RULES` to the independent `hashlib` hash of the planted name mapped to `us` (default also `us`: this also covers "mapped to the same rule as the default still refuses"). Add a new test for the unmapped write-and-alert path. Do not delete the refusal test.

### Pitfall 2: Existing structure pins that a naive edit reddens
Each is a pin to ADAPT (read this session):
1. `test_each_configuration_fault_has_its_own_message` asserts `len(MT5_SERVER_CLOCK_CONFIG_MESSAGES) == 4`, distinct texts, each ends `— fail loud`, and that the resolver `_FAULTS` table reaches exactly the set. A fifth text in that tuple needs: length 5, and the new text reached by a separate parser-fault table (the resolver table cannot reach it). Alternative: a separate closed tuple for map faults; then the job-level config-fault test (`message[len(prefix):] in MT5_SERVER_CLOCK_CONFIG_MESSAGES`) needs a union. Recommendation: extend the one tuple (it also feeds `test_every_new_derive_message_is_blame_free_for_the_mt5_classifier`, which then covers the new text for free).
2. `test_the_clock_module_is_a_stdlib_leaf` allows only `__future__, calendar, collections.abc, dataclasses, datetime, functools, math, os, typing`. No `re`, `hashlib` or any `services` import. Selection takes the hash as an argument; hex check is by char set.
3. `test_single_reader` scans every string constant equal to a name in `_SETTING_NAMES = frozenset({_OFFSET, _RULE})`. Add the new variable name so it too is read only in the leaf. (`"MT5_SERVER_TIME_RULES"` is a different string from `"MT5_SERVER_TIME_RULE"` so the current test would not even notice a stray reader of it.)
4. `test_one_clock_per_derive` requires exactly one `resolve_mt5_server_clock` call and exactly one `_mt5_clock = resolve_mt5_server_clock(...)` assignment (`_resolve_bound_to`). With a default clock and a selected clock both in scope, the new risk is assessing against one and dating with the other. Adapt to: resolve bound once to the default name; parse called once; select called once and `_mt5_clock` assigned exactly once (from the selection); ALSO require `assess_server_clock_reading` and `build_mt5_server_clock_reading_row` to receive `_mt5_clock`; the six offset sites still 6 and all pass `_mt5_clock`; the default-clock name is loaded only as the select call's argument. Add an ordering pin by `ast` line number: parse/resolve line less than the `read_mt5_deal_ledger` name line less than the select line less than the first offset site (read the name as an `ast.Name` argument of `asyncio.to_thread`, not a `Call`).
5. `tests/conftest.py` autouse fixture `_mt5_server_clock_defaults_to_the_fixed_zero_form` sets `MT5_SERVER_UTC_OFFSET_S=0` and deletes `MT5_SERVER_TIME_RULE`. Add `monkeypatch.delenv("MT5_SERVER_TIME_RULES", raising=False)` so a developer shell or CI value cannot leak into 54-plus MT5 tests.

### Pitfall 3: The default fixture hides a deleted selection
**What goes wrong:** the suite default is fixed 0, the same clock a `utc` entry selects. A mapped-utc job test run under that default passes with the selection code deleted.
**How to avoid:** the mapped-utc tests set the default explicitly to `us` (`MT5_SERVER_TIME_RULE=us`, delete `MT5_SERVER_UTC_OFFSET_S`) and assert `configured_rule == 'fixed'` and a dating difference between mapped and unmapped (see Validation Architecture J2).

### Pitfall 4: Test map keys computed with the code under test
**What goes wrong:** keying the map with `server_label_hash(...)` in the test makes normalisation drift invisible.
**How to avoid:** hand-type a 64-hex literal or compute with `hashlib.sha256(b"planted-server-value").hexdigest()` over the trimmed, case-folded name. Add a case where the server arrives as `"  Planted-SERVER-Value "` (mapped) and one where a map keyed on the hash of the UN-normalised string stays unmapped, and one where an UPPERCASE-hex key is a fault, not normalised.

### Pitfall 5: Blank or missing server
`server_label_hash` returns `None` for a non-string or blank value, and the readings row stores NULL. `_mt5_info.get("server")` may be absent. `select_mt5_server_clock(..., None)` must return the default, `mapped=False`, never raise, and never look `None` up in the map.

### Pitfall 6: Value-free errors (T-134-01) and the blame-free classifier
The malformed-map text must name the variable and the allowed grammar and NEVER echo any part of the configured value, including a hash. It is stored in `compute_jobs.error_message` and re-classified by `classify_mt5_login_error`. The classifier's phrase sets are `_WRONG_SERVER_PHRASES = ("trade server not found",)` and `_AUTH_PHRASES` = `("invalid account or password", "account or password is invalid", "invalid password", "wrong password", "incorrect password", "password is invalid", "password is incorrect")` [VERIFIED: analytics-service/services/mt5_validation.py:114-138]. So the text must avoid those substrings (the word "server" alone is fine, the existing "MT5 server clock is not configured" text passes). The existing job-level test already runs every tuple member through the real classifier, so adding to the tuple is covered. Do not interpolate the offending entry, its index, or its length. The resolver's existing `test_the_resolver_fails_loud_with_a_closed_value_free_message` asserts `_RULE in message or _OFFSET in message`: `MT5_SERVER_TIME_RULE` is a substring of `MT5_SERVER_TIME_RULES`, so a message naming the new variable satisfies it.

### Pitfall 7: Blast radius of a typo
A malformed map faults EVERY MT5 derive before the terminal is touched (all keys, including unmapped ones), retries, then ends `failed_final` with the automatic-retries sentence. That is the founder's fail-loud choice (Q1), not a bug, but the runbook must say so and give a no-echo validation one-liner (see Runbooks).

### Pitfall 8: Log and page leakage (D-17) and digit masking
`scrub_alert_detail` replaces any run of 5+ digits and masks `MT5_SERVER`/`MT5_LOGIN` env values. The detail stays `rule=<id> expected=<+Nh> measured=<+Nh>` (`format_offset_hours`, hours, so `10800` never appears). Hash and server never go in `detail`, `extra_tags`, `error_message` or any log line; the key id (a uuid) is allowed in logs and as the `first_api_key_id` tag. Note a `utc`-mapped mismatch reports `rule=fixed expected=+0h measured=+2h` (the clock's own rule id); that is acceptable and value-free.

### Pitfall 9: Log-arm substring collision
The existing mismatch test filters ERROR records with the substring `arm=server_clock_mismatch`. Name the new arm so it does NOT contain that string (for example `arm=server_clock_unmapped_drift`), otherwise both tests' filters match both arms and an exact-count assertion becomes ambiguous.

### Pitfall 10: Neutered-branch vacuity in the new job tests
A test that asserts only `outcome == DONE` for the unmapped mismatch passes if the refusal is simply deleted from every path. Assert the verdict row, the page cause AND args, that `upserts` is non-empty (the derive really persisted), and that no `clock_mismatch` page fired.

### Pitfall 11: Deploy order and the interim
Between worker deploy and the Railway entry, the known UTC key (prefix `13a451cff998`) flips from refusing to WRITING under `us` (the accepted Q2 cost, mis-dated days possible). An old worker ignores an unknown variable, so the coordinator can set `MT5_SERVER_TIME_RULES` BEFORE the deploy and the first derive on the new worker already selects `utc`. Put this ordering in the runbook. Listed as an open question for the coordinator.

### Pitfall 12: Stale text after the change
`server_label_hash`'s docstring says the table's "one consumer is the per-key equality check of criterion 4" and that no keyed secret is needed; with the hash now also a lookup key in operator config, that claim needs a one-line addition (the hash is still unsalted by design; an operator needs it in the clear to configure the map). The derive comment `MT5_SERVER_TIME_RULE stays the only carrier` and the migration's `configured_rule` COMMENT ("MT5_SERVER_TIME_RULE stays the only carrier") and `mt5_deals.py` docstring ("resolve_mt5_server_clock") say less than the truth now. The migration is applied and must not be edited; fix only the Python comments and note the migration text as lineage in the CHANGELOG.

## Code Examples

### Parser and selection (illustrative, stdlib only; names are discretionary)
```python
# Source: designed against services/mt5_server_clock.py (read this session)
MT5_SERVER_TIME_RULES_ENV = "MT5_SERVER_TIME_RULES"
_HEX = frozenset("0123456789abcdef")
_MAP_VALUES = {"eu": ..., "us": ..., "utc": ...}   # resolve to clocks inside the function

@dataclass(frozen=True)
class Mt5ServerClockSelection:
    clock: Mt5ServerClock
    mapped: bool

def parse_mt5_server_time_rules(environ: Mapping[str, str] | None = None) -> dict[str, Mt5ServerClock]:
    source = os.environ if environ is None else environ
    raw = (source.get(MT5_SERVER_TIME_RULES_ENV) or "").strip()
    rules: dict[str, Mt5ServerClock] = {}
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        key, sep, value = part.partition("=")
        key, value = key.strip(), value.strip().lower()
        if not sep or len(key) != 64 or not set(key) <= _HEX or key in rules:
            raise Mt5ServerClockConfigError(_MALFORMED_RULES_MESSAGE)
        if value == "utc": rules[key] = fixed_server_clock(0)
        elif value in MT5_DST_RULE_IDS: rules[key] = server_clock_for_rule(value)
        else: raise Mt5ServerClockConfigError(_MALFORMED_RULES_MESSAGE)
    return rules

def select_mt5_server_clock(default, rules, server_hash):
    if server_hash is not None and server_hash in rules:
        return Mt5ServerClockSelection(rules[server_hash], True)
    return Mt5ServerClockSelection(default, False)
```
Note `value` containing `=` (e.g. `a=us=eu`) lands in the value branch and faults. Whether whitespace around `=` is tolerated (the sketch strips both sides) is a grammar point the tests must pin either way.

### Job-level fixtures (verified idioms in tests/test_mt5_derive_branch.py)
- `_FakeMt5Transport(account={..., "server": <name>}, deals=..., tick_answer=("answered", 1416, 14, 14, newest_tick_ms))`: `account_info().server` is faked by the `account` dict's `"server"` key; the tick is `tick_answer` (default is `("answered", 0, 0, 0, -1)` which yields `unmeasured`/`no_tick`).
- `monkeypatch.setattr("services.mt5_read._tick_read_now", lambda: _CLOCK_NOW)` fixes the worker's UTC now. A tick at `now_ms + 7_200_000 - 100` is a +2h server; `now_ms - 100` is a +0h (UTC-keeping) server.
- `_recording_page(monkeypatch)` replaces `jw.ops_alert` with an `AsyncMock` page (read `page.await_args.args` / `.kwargs`).
- `_clock_readings(capture)` returns the inserted reading rows; `capture["order"]`, `["upserts"]`, `["updates"]`, `["rpc_calls"]` show what else was written.
- Dating proof helper: `_derive_and_observe_apply_marks()` / `_winter_deposit_after_the_read_deals()` patch `read_key_marks` and spy `apply_marks`; it builds the account WITHOUT a `server` key, so a mapped-server variant needs its own account dict.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| One clock per worker (`MT5_SERVER_TIME_RULE`) | Default plus per-server hash map | this phase | A UTC-keeping broker passes the 155.1 guard |
| Mismatch always refuses (155.1 D-01) | Mapped refuses; unmapped writes and alerts (founder override) | this phase, 2026-11-18 | Known accepted cost; needs the dated CHANGELOG/ROADMAP record |

## Runtime State Inventory

Not a rename/refactor/migration phase. Stated explicitly for the one adjacent concern:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `mt5_server_clock_readings.configured_rule` already admits `fixed`; hash CHECK is `^[0-9a-f]{64}$` [VERIFIED: supabase/migrations/20261117120000_mt5_server_clock_readings.sql, `CONSTRAINT mt5_server_clock_readings_rule_chk CHECK (configured_rule IN ('eu', 'us', 'fixed'))`] | none (no migration) |
| Live service config | Railway variable `MT5_SERVER_TIME_RULES` on each worker service (`quantalyze-analytics`, `quantalyze-analytics-backfill` per the P6 runbook) | coordinator sets after (or before, see Pitfall 11) deploy; this phase writes none |
| OS-registered state | None — verified by grep: the variable is read only by the Python worker | none |
| Secrets/env vars | New variable holds server-label hashes (not secrets by 155.1 D-17 design, but never put full hashes in tracked text) | document with a `<64-hex>` placeholder only |
| Build artifacts | None | none |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| python3 | pytest / mypy locally | yes | 3.14.3 locally (CI uses 3.12) | — |
| pytest | tests | yes | `/opt/homebrew/bin/pytest` | — |
| mypy | type gate | yes | 2.0.0, `Success: no issues found in 142 source files` on the CI command in this worktree | — |
| Supabase/Railway/PROD | none | not needed | — | Phase uses fakes only; do not touch PROD or Railway |

Local baseline measured this session in `analytics-service/`: `python3 -m pytest tests/test_mt5_server_clock.py tests/test_mt5_server_clock_reading.py tests/test_mt5_server_clock_readings_parity.py -q` gave 95 passed; `tests/test_mt5_derive_branch.py` gave 64 passed. Python 3.14 locally versus 3.12 in CI: nothing here is version-sensitive.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service); vitest for repo-level census (unaffected) |
| Config file | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` (mypy) |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_mt5_server_clock.py tests/test_mt5_server_clock_reading.py tests/test_mt5_server_clock_readings_parity.py tests/test_mt5_derive_branch.py -q` |
| Full suite command | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (exactly CI's `python` job step) |
| Type gate | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (exactly CI's step; the Makefile `typecheck` is the same without the two flags the config already carries) [VERIFIED: .github/workflows/ci.yml `run: mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`; `run: pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`] |

Note: the CI `python` job runs with `defaults.run.working-directory: analytics-service` and uses a local-stack lane for live-DB modules; none of this phase's tests need it (all offline fakes). The planner's verify commands run from `analytics-service/`. Also run `npx vitest run src/__tests__/tiny-base-literal-pin.test.ts src/__tests__/options-cash-basis-literal-pin.test.ts src/__tests__/nav-marks-start-literal-pin.test.ts` after editing `job_worker.py`: these read `job_worker.py` by literal (they pin unrelated `tiny_base_days`/marks literals, none of the clock names), so they are a cheap smoke check, not an expected break. Coverage gate `--cov-fail-under=80` is global; new code is fully reached by the tests below.

### Phase Behaviours → Test Map
Each row must go RED when its branch is neutered (the neuter is the mutation the executor performs from a byte backup, never `git checkout`).

| ID | Behaviour | Test type | Where | Neuter that must turn it RED |
|----|-----------|-----------|-------|------------------------------|
| P1 | Parser: `<hash>=utc,<hash2>=EU` gives `{h: fixed(0), h2: eu}`; whitespace and empty parts ignored; unset, empty and blank give `{}` | unit | test_mt5_server_clock.py | map `utc` to a DST clock; drop the lower-casing; treat blank as a fault |
| P2 | Parser fault table: no `=`; key 63/65 chars; uppercase hex; non-hex char; empty key; value `fixed`, `summer`, empty; duplicate hash (same value AND different value); `a=us=eu`. Each raises `Mt5ServerClockConfigError` with a text in `MT5_SERVER_CLOCK_CONFIG_MESSAGES` and the planted value absent | unit, parametrized | same | remove any single check; the duplicate arm is the usual one forgotten |
| P3 | Closed set: tuple length 5, distinct, new text ends `— fail loud`, names `MT5_SERVER_TIME_RULES`, is reached by the P2 table | unit | same (adapt `test_each_configuration_fault_has_its_own_message`) | drop the new text or reuse an old one |
| P4 | Selection: mapped returns its clock with `mapped=True`; mapped to the SAME rule as the default is still `mapped=True`; unmapped returns the default with `mapped=False`; `None` hash returns default, `mapped=False` | unit | same | compute `mapped` as `clock != default`; look `None` up in the map |
| P5 | Default grammar unchanged: `MT5_SERVER_TIME_RULE=utc` is still the unknown-rule fault; `resolve_mt5_server_clock` unchanged | unit (existing `_FAULTS` plus one `utc` case) | same | add `utc` to `MT5_DST_RULE_IDS` |
| P6 | Structure: one resolve bound to the default name; one parse; one select; `_mt5_clock` assigned exactly once; assessment, row builder and all six offset sites receive `_mt5_clock`; default name loaded only as the select argument; ordering parse/resolve < read < select < first offset site | AST | same (adapt `test_one_clock_per_derive`, add ordering pin) | pass the default clock to one offset site; select before the read; assign `_mt5_clock` twice |
| P7 | Single reader: `"MT5_SERVER_TIME_RULES"` appears as a string constant only in the leaf | AST | same (extend `_SETTING_NAMES`) | read the variable inline in `job_worker.py` |
| P8 | Leaf stays stdlib: no `re`/`hashlib`/`services` import | AST (existing, unchanged) | same | add `import re` |
| J1 | Mapped-utc server (default `us`, tick at `now-100ms`) derives DONE, reading `verdict=match`, `configured_rule='fixed'`, `expected_offset_s=0`, `measured_offset_s=0`, `server_label_hash` equals an independent hashlib literal; no `mt5_server_clock` page | job | test_mt5_derive_branch.py | selection returns the default always (then verdict is `mismatch`, rule `us`) |
| J2 | Dating: a deposit at wall `01:30` on a day D lands on D-1 under the unmapped default `us` (23:30Z) and on D under the mapped `utc` clock; assert via the `apply_marks` spy flows and `FlowInstant` | job | same | thread the default clock to the offset sites instead of `_mt5_clock` |
| J3 | Mapped server mismatch REFUSES: FAILED transient, text `rule=<r> expected=<h> measured=<h>`, one `arm=server_clock_mismatch` ERROR naming the key id, page `("mt5_server_clock","clock_mismatch")`, reading kept, no upserts, updates or rpc calls. Parametrize: map equals default rule (both `us`); map differs from default (`eu` vs default `us`) | job (adapt the existing mismatch test) | same | refuse only when the clock differs from the default; remove the refusal |
| J4 | UNMAPPED mismatch (Q2): DONE; reading `verdict=mismatch`, `configured_rule` of the default; page awaited ONCE with args `("mt5_server_clock","<new cause>")`, `event="outage"`, detail `rule=us expected=+3h measured=+2h` (no 5+ digit run), `extra_tags == {"first_api_key_id": "key-mt5"}`; NO `clock_mismatch` page; log line names job and key id; `upserts` non-empty; reading inserted before any upsert | job | same | restore the unconditional refusal; drop the page; page the old cause |
| J5 | A map entry for a DIFFERENT hash does not rescue: a mismatching server stays on the unmapped path | job | same | match by prefix or by any-entry-present |
| J6 | Normalisation: server `"  Planted-SERVER-Value "` is mapped by the key `sha256(b"planted-server-value")`; a map keyed on the hash of the raw `"Planted-Server-Value"` leaves it unmapped | job | same | hash the raw string, or skip `casefold` |
| J7 | Missing or blank server with a map set: default applies, no crash, reading hash NULL | job | same | look up `None` or the empty hash |
| J8 | Malformed map faults PRE-read: parametrized over several malformed values, FAILED transient, text in the closed tuple, planted value absent from message and log, exactly one `arm=server_clock_config` line, `transport.calls == []`, no upserts or inserts. Plus: default fault with a VALID map still faults | job | same (clone of `test_a_clock_configuration_fault_fails_transient_and_makes_no_terminal_read`) | parse the map after the read; let a malformed map degrade to `{}` |
| J9 | Reading-insert failure still refuses for an unmapped MISMATCH (insert arm precedes the new branch): FAILED transient with `_MT5_CLOCK_READING_INSERT_MESSAGE`, nothing else written, no unmapped page | job (parametrize the existing insert-failure test over a mismatching tick) | same | move the new branch above the insert |
| J10 | No leakage: planted server name and the hash absent from `error_message`, page `detail`, `extra_tags` and every captured log record, in J3, J4 and J8 | job (assertion block as in the existing mismatch test) | same | add the hash to a log line or detail |
| J11 | `match` and `unmeasured` unchanged for mapped and unmapped servers (existing tests keep passing, plus one mapped-unmeasured case that continues without a page) | job | same | refuse on unmeasured for a mapped server |
| R1 | Row builder under `fixed_server_clock(0)`: keys still equal the table's non-defaulted columns; `configured_rule == 'fixed'`; `expected_offset_s == 0` | unit | test_mt5_server_clock_readings_parity.py | none needed beyond existing; it pins that no migration is required |
| C1 | conftest fixture clears `MT5_SERVER_TIME_RULES`; a test that sets it in the shell env stays isolated | fixture | tests/conftest.py | n/a (hygiene) |

### Sampling Rate
- **Per task commit:** the quick command above (about 25 seconds).
- **Per wave merge:** quick command plus the mypy command plus the three vitest literal-pin files.
- **Phase gate:** full pytest suite and mypy green before `/gsd-verify-work`, and the neuter-and-restore evidence for P2, P4, P6, J1 through J4 and J8 recorded in a SUMMARY (project rule: gates must be able to fail; restore from a byte backup).

### Wave 0 Gaps
None for infrastructure: pytest, fixtures (`_build_ctx`, `_patches`, `_recording_page`, `_FakeMt5Transport`) and the AST helpers (`_function`, `_calls_to`, `_passes_clock`) already exist. The work is adapting the pins listed in Pitfall 2 and adding the rows above.

## Security Domain

`security_enforcement` is absent in `.planning/config.json`, so treated as enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication / V3 Session | no | — |
| V4 Access Control | no | no new surface; readings table stays service-role only |
| V5 Input Validation | yes | strict parser for operator input: exact 64-lowercase-hex keys, closed value set, duplicate refusal, fail-closed |
| V6 Cryptography | no (hash reuse only) | reuse the existing unsalted SHA-256 label hash; do not add a hash or secret |
| V7 Error handling and logging | yes | closed-set value-free error text (T-134-01); no server name or hash in logs, alerts or tags (D-17); hours-only detail through `scrub_alert_detail` |
| V14 Configuration | yes | malformed config fails loud before any terminal call; no silent degrade to an empty map |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Operator typo silently selects a wrong clock | Tampering | strict grammar, malformed map is a pre-read fault, duplicate hash is a fault |
| Config value echoed into `compute_jobs.error_message` | Information disclosure | closed-set message, no interpolation, tested with planted values |
| Server identity leaked via alert or log | Information disclosure | page detail is rule id and hours only; arm names carry no value; asserted in J10 |
| Wrong-day data written for an unmapped drifting server (accepted) | Tampering (data integrity) | founder-accepted Q2; the mitigation is the page plus the mismatch reading row as evidence; record in CHANGELOG and ROADMAP |
| Alert flood | Denial of service | `ops_alert` hourly window per `(source, cause, event)`; the new cause is its own window |

## Open Questions (RESOLVED)

1. **May the coordinator set `MT5_SERVER_TIME_RULES` before the worker deploys?**
   - What we know: an old worker ignores an unknown variable; setting it first means the first new-worker derive already selects `utc` for the known key, and that key never writes under `us`.
   - What's unclear: whether the coordinator will sequence it that way.
   - Recommendation: write the runbook ordering as "set the variable on both worker services first, then deploy".
   - RESOLVED 2026-11-18: before deploy (coordinator agreed); recorded as a dated correction in 217-CONTEXT.md Q1 and the ROADMAP; plan 02 writes it into both runbooks.
2. **Does Phase 217 close `TODOS.md` `202-MT5-CLOCK-LEAD-01`?**
   - What we know: its trigger is "the next phase that touches MT5 strategy-mode day bucketing or the server-clock setting"; this phase touches the setting. Closing it needs a replay or a recorded setting history, which 217 does neither.
   - Recommendation: the plan states explicitly that 217 does NOT close it (no TODOS deletion in this phase's ship); a one-line pointer in the CHANGELOG is enough.
   - RESOLVED: not closed; plan 01 states it and makes no TODOS edit.
3. **One malformed-map message or one per sub-fault?** Discretion. Recommendation: one message (tuple becomes 5), grammar named in the text. RESOLVED: one message (plan 01 Task 1).
4. **Exact alert cause name.** Discretion. Recommendation: `unmapped_clock_mismatch` (23 chars, matches `[a-z0-9_:.-]{1,64}`). There is no cause registry to extend. RESOLVED: `unmapped_clock_mismatch` (plan 01 Task 2).

## Runbooks, docs and changelog (where `MT5_SERVER_TIME_RULE` is documented)

Measured by grep over `docs`, `.github`, `analytics-service`, repo root: only two runbooks name the variable, and there is no `.env.example`, `deploy/`, `railway` doc or `analytics-service/docs` mention.
- `docs/runbooks/mt5-go-live.md`, step 3 of the server-clock procedure: `Since Phase 175 the worker reads the broker offset as a rule, \`MT5_SERVER_TIME_RULE\` (\`eu\` or \`us\`, +2 h in winter and +3 h in summer) or, for a broker without daylight saving, \`MT5_SERVER_UTC_OFFSET_S\` alone (whole seconds); never both and never neither`. Add the per-server map here.
- `docs/runbooks/navmtm-chain-move-go-live.md`, pre-flight P6: names the two Railway services (`quantalyze-analytics` and `quantalyze-analytics-backfill`) and the abort condition `the setting disagrees with the reading`. Update P6 so an UNMAPPED mismatch is no longer an abort-by-refusal in the worker, and so the per-server entry is read on both services.
- Both docs gain: the variable name and grammar (`<64-hex hash>=eu|us|utc`, comma separated, lower-case hex, no duplicates), that `utc` is fixed offset 0 and shows as `configured_rule = fixed`, how to read the full hash (`SELECT DISTINCT server_label_hash FROM public.mt5_server_clock_readings WHERE api_key_id = '<key uuid>'`, marker query first, read-only), the failure behaviour (malformed map fails every MT5 derive pre-read, transient, retries then failed_final), the unmapped-mismatch behaviour (page plus continue under the default; mapped mismatch refuses), the set-before-deploy order, and a no-echo validation one-liner such as `cd analytics-service && MT5_SERVER_TIME_RULES="$VALUE" python3 -c "from services.mt5_server_clock import parse_mt5_server_time_rules as p; print(len(p()))"` that prints a count only. Tracked text uses `<64-hex>` placeholders and hash PREFIXES only (the repo is public).
- CHANGELOG (project rule, every ship): theme sections `Added` (variable, parser, selection, new alert cause), `Changed` (the dated founder override of 155.1 D-01 for unmapped servers, named explicitly with its accepted cost), `Tests`, `Notes` (no migration; the migration's `configured_rule` COMMENT is lineage; `202-MT5-CLOCK-LEAD-01` not closed). Written before the push in the same commit as the VERSION bump; never write a CI skip token anywhere.

## Anchors (cite by SYMBOL; line numbers drift on the first edit)

`plan-anchor-verify` re-resolves `file:line` anchors in pending PLAN.md files and fails on a miss, so plans should cite symbols. Positions at HEAD `5ad0847ba`, for orientation only:
- `run_derive_broker_dailies_job` (the CONTEXT calls it `derive_broker_dailies`; the function name is `run_derive_broker_dailies_job`), `services/job_worker.py` from about 4724.
- Pre-read resolve: the `try: _mt5_clock = resolve_mt5_server_clock()` block with `arm=server_clock_config`, about 7179, placed before `from services.broker_dailies import ...` and before any terminal call. [VERIFIED: job_worker.py:7179 `_mt5_clock = resolve_mt5_server_clock()`]
- Read: `_mt5_read = await asyncio.wait_for(asyncio.to_thread(read_mt5_deal_ledger, ...))` then `_mt5_info = _mt5_read.info` (about 7361). [VERIFIED: job_worker.py:7361 `_mt5_info = _mt5_read.info`]
- Assessment, row build, insert, mismatch arm: about 7653 to 7780; first non-clock use of `_mt5_info` after it is `classify_account_currency(_mt5_info.get("currency"))` (about 7784), so `_mt5_info` is in scope at the selection point (all six `except` arms before it return).
- All six offset sites, every one after the read: `combine_mt5_deal_ledger` (about 8001), `mt5_day_pnl` (about 8008), `reconstruct_mt5_nav_levels` (about 8027), `deal_utc_day` (about 8128), `deal_utc_instant_ms` (about 8142), second `mt5_day_pnl` (about 9198, inside `venue == "mt5"`). [VERIFIED: grep of `_mt5_clock` this session lists exactly these use lines: 7654, 7663, 7741, 7751, 7766, 8001, 8008, 8027, 8128, 8142, 9198]
- `Mt5DealLedgerRead.info` is the PRE `account_info`: `info = session.client.account_info()  # None→typed raise`, returned in `Mt5DealLedgerRead(info, deals, tick, tick_read_failed, tick_read_at)` [VERIFIED: services/mt5_read.py:126-139 and read body].
- The reading row already hashes `server=_mt5_info.get("server")` via `server_label_hash(server)` [VERIFIED: services/mt5_server_clock_reading.py:78 `"server_label_hash": server_label_hash(server),`]; leave the builder as is so the chosen rule and the row hash share one function.
- `ops_alert`: `OPS_ALERT_SOURCES` already contains `"mt5_server_clock"`; cause charset `OPS_ALERT_CAUSE_RE: Final = "[a-z0-9_:.-]{1,64}"`, any other cause is normalised to `unrecognised`; the TS contract `src/lib/ops-alert-contract.ts` mirrors the SOURCE set and the cause pattern only, with no per-cause list [VERIFIED: analytics-service/services/ops_alert.py:55-70, src/lib/ops-alert-contract.ts]. Existing causes in code: `clock_mismatch`, `reading_insert_failed`. A new cause needs no registry edit and no TS change; the window is `(source, cause, event)` per hour (`OPS_ALERT_WINDOW_S = 3600.0`).
- Other worker paths dating MT5 deals: none. `grep -rn "resolve_mt5_server_clock"` over services, routers, scripts and root modules finds only the leaf and `job_worker.py` (a docstring in `mt5_deals.py` names it). `read_mt5_deal_ledger` has one caller (`job_worker.py`). `services/mt5_parity.py`, `scripts/mt5offset_dry_run.py`, `scripts/mt5_spike.py` take a clock argument or build one with `server_clock_for_rule`/`fixed_server_clock`, so a per-server selection there is not needed and not in scope.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | CI executes this phase's tests under Python 3.12 and local 3.14 is equivalent for them | Environment Availability | A 3.12-only difference could surface only in CI; nothing in the planned code is version-sensitive |
| A2 | The three `src/__tests__/*-literal-pin.test.ts` files are unaffected (they pin `tiny_base_days` and marks literals, not clock names) | Validation Architecture | A vitest red in CI that the plan did not anticipate; mitigated by running them as a smoke step |
| A3 | Whitespace around `=` should be tolerated by the parser (CONTEXT says "each part stripped", not the key and value separately) | Code Examples | Operator-facing grammar; the tests must pin whichever rule the planner picks, and the runbook must state it |
| A4 | An old worker ignores an unset-to-it variable, so set-before-deploy is safe | Pitfall 11 | Standard process-env behaviour; low risk, the runbook should still say it |

## Sources

### Primary (HIGH confidence, opened this session)
- `analytics-service/services/mt5_server_clock.py`, `services/mt5_server_clock_reading.py`, `services/ops_alert.py`, `services/mt5_read.py`, `services/mt5_validation.py` (phrase sets), `services/job_worker.py` (resolve, read, assessment, mismatch arm, six offset sites)
- `analytics-service/tests/test_mt5_server_clock.py` (resolver, `_FAULTS`, `test_the_clock_module_is_a_stdlib_leaf`, `test_single_reader`, `test_one_clock_per_derive`), `tests/test_mt5_server_clock_readings_parity.py`, `tests/test_mt5_derive_branch.py` (clock/mismatch/insert-failure/config-fault tests and fixtures), `tests/conftest.py` (clock env fixture)
- `supabase/migrations/20261117120000_mt5_server_clock_readings.sql` (named CHECKs)
- `.github/workflows/ci.yml` (mypy and pytest steps), `analytics-service/Makefile`, `pyproject.toml`
- `docs/runbooks/mt5-go-live.md`, `docs/runbooks/navmtm-chain-move-go-live.md`, `TODOS.md` entry `202-MT5-CLOCK-LEAD-01`, `.planning/ROADMAP.md` Phase 217, `155.1-CONTEXT.md`
- Baselines run: 95 passed (clock, reading, parity), 64 passed (derive branch), mypy strict clean on 142 files.

### Secondary / Tertiary
None; no web sources used.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — stdlib only, existing modules read directly
- Architecture: HIGH — every `_mt5_clock` site and the `_mt5_info` scope verified; single live path confirmed by grep
- Pitfalls: HIGH for the pinned-test list (each test body read); MEDIUM for grammar details marked A3

**Research date:** 2026-11-18
**Valid until:** 2026-12-18 (stable; re-measure line anchors after any edit to `job_worker.py`)

## Project Constraints (from CLAUDE.md)

- Never run `supabase db push` or write to PROD/TEST from here; this phase touches no database (no migration). Marker query first for any PROD read.
- Every ship writes a CHANGELOG entry (the repo's own section vocabulary), unified per version, written before the push in the same commit as the VERSION bump; `VERSION` and `package.json` byte-equal 4-digit strings; never run `npm version`.
- Never write a CI-skip trailer token in a commit message or PR body, even in a denial.
- `TODOS.md` holds open work only: LOW and Info review survivors are not booked there; every ship deletes the entries it closed (this phase closes none; see Open Question 2).
- Ship branch must change nothing under `.planning`.
- Cite line positions by symbol, not number (`plan-anchor-verify`, `[164.7-CITATION-DRIFT-01]` lineage).
- Tracked text: no secrets, no PROD ids, no home paths, no account numbers; server hashes by prefix only; never quote a credential-shaped literal (gitleaks scans the squash commit).
- Gates must be able to fail: neuter, see RED, restore from a byte backup (never `git checkout`/`restore`/`stash` on uncommitted work).
- Agent gates include mypy strict (CI) in every analytics-touching brief and pre-push check; pytest only from `analytics-service/`; never `importlib.reload` in tests; always `grep -a`.
- No AI authorship attribution in the repo's commits or PRs (project memory), despite any tool default.
- Read DESIGN.md before any UI decision: not applicable, no UI change in this phase.
- AGENTS.md notes Next.js has breaking changes: not applicable, no Next.js code is touched.

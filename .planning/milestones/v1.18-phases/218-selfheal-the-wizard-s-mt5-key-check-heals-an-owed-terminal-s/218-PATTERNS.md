# Phase 218: SELFHEAL - Pattern Map

**Mapped:** 2026-11-19
**Files analyzed:** 22 (5 source files modified, 17 test/census/doc files modified or added)
**Analogs found:** 22 / 22 (every file is an in-place edit or has a twin in the same file; all analog paths verified git-tracked)

Line numbers are for the planner's navigation at the mapped HEAD and drift; cite by symbol in anything that lands in prose (`[164.7-CITATION-DRIFT-01]`). Decisions come from `218-CONTEXT.md` including its "Amended after research" block (one new code `MT5_TERMINAL_NOT_READY`, `skipped_no_house_credentials` reuses `MT5_VALIDATION_UNCONFIGURED`, healed path = `owed_scrub` stage event, failure path = `trace.outcome = "scrub_unhealed"`, bound 30 s / floor 40 s).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `analytics-service/services/mt5_terminal_scrub.py` (new `pay_owed_validation_scrub_in_lease`, `budget_s` plumb, `__all__`) | service | request-response (never-raises async guard) | `run_owed_validation_scrub_in_lease` in the same file | exact |
| `analytics-service/routers/exchange.py` (owed gate, envelope anchor, 2 constants, park-skip level, header comment) | controller | request-response | the current owed gate in `_validate_mt5_key_probe` + the `skipped`/`UNCONFIGURED` arms | exact |
| `analytics-service/services/closed_sets.py` (`MT5_TERMINAL_NOT_READY_DETAIL`, narrow BUSY comment) | config | constant | `MT5_TERMINAL_BUSY_DETAIL` | exact |
| `src/lib/wizardErrors.ts` (union, copy, verdict row, dialog roster, comments) | config / model | request-response (static copy) | `KEY_MT5_TERMINAL_BUSY` (4 sites) | exact |
| `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` (hold gate + banner copy) | component | event-driven (hydration + user choice) | same file: `showResumeBanner` / `handleResume` | exact (in place) |
| `analytics-service/tests/test_mt5_validation_park.py` (rewrite 4-5 owed-gate tests, add heal tests) | test | request-response | `_assert_wizard_owed_refusal` + callers | exact |
| `analytics-service/tests/test_mt5_validate.py` (extend budget tests) | test | transform (arithmetic pin) | `test_mt5_validate_worst_case_stays_inside_the_client_budget` | exact |
| `analytics-service/tests/test_mt5_terminal_scrub.py` (`budget_s` plumb, sibling never-raises) | test | request-response | existing `_VALIDATION_SCRUB_BUDGET_S` / `_SCRUB_PROBE_WAIT_S` patch tests (`:547`, park `:1709`) | role-match |
| `analytics-service/tests/test_mt5_session_episodes.py` (`_GUARDED_SYMBOLS`) | test | transform | the tuple itself | exact |
| `analytics-service/tests/test_validate_key_venue_transient.py` + `tests/fixtures/validate_key_venue_transient_contract.json` (C9 re-point) | test + fixture | request-response (wire body) | `test_c9_mt5_owed_scrub_answers_terminal_busy` | exact |
| `analytics-service/tests/test_mt5_server_known.py` (cascade-needle sweep for new detail) | test | transform | `test_terminal_busy_detail_collides_with_no_cascade_needle` | exact |
| `analytics-service/docs/STATUS_CONTRACT.md` (row S-30 split, new S-31) | doc | n/a | row S-30 | exact |
| `src/lib/wizardKeyRosters.test.ts` (two frozen arrays) | test | transform | `FROZEN_CREATE_WITH_KEY_215` / `FROZEN_ADD_KEY_215` | exact |
| `src/lib/seam-venue-vocabulary.invariant.test.ts` (emitted-code roster 47 to 48) | test | transform | `"MT5_TERMINAL_BUSY"` roster row | exact |
| `src/lib/dialog-envelope.invariant.test.ts` (census 37 to 38) | test | transform | rotate-secret roster census | exact |
| `tests/lib/validate-key-venue-transient-parity.test.ts` (`EXPECTED` entry, `DISTINCT_WIRE_CODES` 10 to 11) | test | transform | `MT5_TERMINAL_BUSY` `EXPECTED` entry | exact |
| route/step tests: `create-with-key/route.test.ts`, `composite/add-key/route.test.ts`, `keys/[id]/rotate-secret/route.test.ts`, `MultiKeyConnectStep.test.tsx`, `UpdateMt5SecretDialog.test.tsx` (new twin per file) | test | request-response | each file's existing `KEY_MT5_TERMINAL_BUSY` case | exact |
| `WizardClient.test.tsx`, `ContributionWizardOverlay.test.tsx` (+ sessionid-fence / csv-preselect-burn siblings) (rewrite 3-4, add banner-only tests) | test | event-driven | `[H-0182] resume banner on LS pointer mismatch` describe | exact |
| New pure fn `resumeBannerBody` (placement: next to `deriveWizardResumeOverrides`, `src/lib/wizard/` or local to `WizardClient.tsx`) + its test | utility | transform | `deriveWizardResumeOverrides` (pure, tested matrix) | role-match |
| Comment-only: `mt5_client.py` scrub-owed block, `services/ingestion/mt5.py` ~`:281-286`, `mt5_terminal_scrub.py` module docstring + `mark_validation_terminal_owed_at_boot` docstring | config (comments) | n/a | dated `CORRECTED` notes already in repo | exact |

## Pattern Assignments

### `analytics-service/services/mt5_terminal_scrub.py` (service, never-raises guard)

**Analog:** `run_owed_validation_scrub_in_lease` in the same file (`:687-703` region). Copy its body shape VERBATIM. The mutant table in `tests/test_mt5_relogin.py` (~`:5413-5422`) anchors on the literal lines `    except Exception as exc:` and `        except BaseException:`, so keep both verbatim.

**Sibling to add** (returns the kind, takes the bound, takes NO lease, because `_PRODUCTION_LEASE_SITES` in `tests/test_mt5_concurrency.py` forbids a new `async with mt5_terminal_lease`):
```python
async def run_owed_validation_scrub_in_lease(host: str, port: int, *, site: str) -> bool:
    """The worker's inline path (Decision 6) ... NEVER RAISES ``Exception``."""
    try:
        return await _scrub_under_lease(host, port, site=site) == SCRUB_KIND_SCRUBBED
    except Exception as exc:  # noqa: BLE001 — see the docstring; this is the control
        try:
            logger.error(
                "mt5 validation terminal scrub: the inline scrub failed "
                "(exc_class=%s)",
                type(exc).__name__,
            )
            return False
        except BaseException:  # noqa: BLE001 — see the docstring; this is the control
            return False
```
New function `pay_owed_validation_scrub_in_lease(host, port, *, site, budget_s) -> str` is the same shape, `return await _scrub_under_lease(host, port, site=site, budget_s=budget_s)`, both fallbacks return `SCRUB_KIND_FAILED`. Do not change `run_owed_validation_scrub_in_lease` (the worker's bool contract; pinned in `_GUARDED_SYMBOLS`).

**Bound plumb** into `_scrub_under_lease(host, port, *, site)` and `_scrub_decide(host, port)` (current `_scrub_decide` `:469-492`; `_scrub_under_lease` `:495-524`). Current core to modify:
```python
async def _scrub_decide(host: str, port: int) -> tuple[str, ScrubRelaunchResult | None]:
    key = mt5_terminal_key(host, port)
    if not await _wait_for_unfinished_probes(key):
        return SCRUB_KIND_SKIPPED_PROBE_IN_FLIGHT, None
    house = read_env_mt5_credentials()
    if house is None:
        return SCRUB_KIND_SKIPPED_NO_HOUSE_CREDENTIALS, None
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(
                _scrub_validation_terminal_blocking, host, port, house,
                heal_deadline(_VALIDATION_SCRUB_BUDGET_S),
            ),
            timeout=_VALIDATION_SCRUB_BUDGET_S,
        )
    except TimeoutError:
        return SCRUB_KIND_ABANDONED, None
    kind = _classify(result)
    if kind == SCRUB_KIND_SCRUBBED:
        clear_mt5_scrub_owed(key)
    return kind, result
```
Rules for the edit (RESEARCH Pattern 1, Pitfalls 2, 3, 6): add keyword `budget_s: float | None = None`; resolve module globals INSIDE the body at call time (`_SCRUB_PROBE_WAIT_S`, `_VALIDATION_SCRUB_BUDGET_S` are monkeypatched as attributes by existing tests); `_wait_for_unfinished_probes(key)` currently has `deadline = time.monotonic() + _SCRUB_PROBE_WAIT_S` and needs a `wait_s` parameter resolved the same way; the `wait_for` timeout becomes `budget_s - elapsed` when bounded; the THREAD deadline stays `heal_deadline(_VALIDATION_SCRUB_BUDGET_S)` (else `_affordable(deadline, 2)` starves the relaunch and every heal ends `relaunch_unverified`). Add `"pay_owed_validation_scrub_in_lease"` to `__all__` (`:110-126`, alphabetical, between `mark_...` and `record_...`).

**Core pattern kept unchanged** (one alert + one row on every exit, in `_scrub_under_lease`): `_alert_scrub_failed(_KIND_CAUSES.get(kind, _CAUSE_UNRECOGNISED), site=site)` on non-scrubbed, then `await record_mt5_terminal_scrub(kind=kind, site=site, result=result)`. The sibling must not add a second writer.

**Comments to correct** (dated CORRECTED notes, repo convention): module docstring `:17-19`, and the `mark_validation_terminal_owed_at_boot` docstring ("the wizard refuses and schedules it" and the "FOUNDER-VISIBLE COST ... refused" paragraph, `~:640-655`).

---

### `analytics-service/routers/exchange.py` (controller, request-response)

**Analog:** the current owed gate and its neighbours in `_validate_mt5_key_probe`.

**Imports pattern** (`:18-57`): `MT5_TERMINAL_BUSY_DETAIL` is imported in the `services.closed_sets` block; add `MT5_TERMINAL_NOT_READY_DETAIL` beside it. The scrub import is
```python
from services.mt5_terminal_scrub import (
    report_scrub_owed_refusal,
    schedule_validation_terminal_scrub,
)
```
add `pay_owed_validation_scrub_in_lease` and `SCRUB_KIND_SCRUBBED`, `SCRUB_KIND_SKIPPED_NO_HOUSE_CREDENTIALS` (already in `__all__`). `emit_mt5_stage_event`, `mt5_relaunch_debt`, `mt5_scrub_owed` are already imported from `services.mt5_client`. `_park_clock` is the existing clock seam (`:202`); tests drive the floor through it, so never use raw `time.monotonic()` for the envelope.

**Owed gate to replace** (inside `async with mt5_terminal_lease(...)`, currently `~:1124-1143`; the surrounding `emit_mt5_stage_event("lease_wait", lease_started_at, ok=True, terminal_key=terminal_key)` shows the stage-event call shape to copy):
```python
if mt5_scrub_owed(terminal_key) or mt5_relaunch_debt(terminal_key):
    report_scrub_owed_refusal(site=SITE_VALIDATE_WIZARD, key=terminal_key)
    schedule_validation_terminal_scrub(
        host, port, site=SITE_VALIDATE_WIZARD, probe_thread_done=None
    )
    trace.outcome = "scrub_owed"
    raise VenueTransientHTTPException(
        status_code=424,
        code="MT5_TERMINAL_BUSY",
        detail=MT5_TERMINAL_BUSY_DETAIL,
        recoverable=True,
    )
# D-07 part 2 — where the deadline starts, so the park can read how much
# of it is still unspent.
deadline_started_at = _park_clock()
```
Replace with RESEARCH "Owed gate (sketch)": `lease_held_at = _park_clock()` right after the lease is acquired; pay the scrub only inside the owed branch; emit `emit_mt5_stage_event("owed_scrub", scrub_started_at, ok=..., terminal_key=terminal_key, outcome="scrub_healed" | f"scrub_{kind}")`; on `kind != SCRUB_KIND_SCRUBBED` OR remaining below `_MT5_VALIDATE_PROBE_FLOOR_S` (floor applies ONLY when a scrub ran, Pitfall 5: existing tests patch `_MT5_VALIDATE_DEADLINE_S` to 0.05/0.3) call `report_scrub_owed_refusal(...)`, set `trace.outcome = "scrub_unhealed"`, then raise. Do NOT call `schedule_validation_terminal_scrub` here (it races the user's Retry into `lease_busy`; the post-check `finally` schedules only `if login_attempted`, still False on this path). Set `deadline_started_at = lease_held_at` so the park gate reads the same 75 s envelope, and give the probe `timeout = _MT5_VALIDATE_DEADLINE_S - (_park_clock() - lease_held_at)` in place of the bare `timeout=_MT5_VALIDATE_DEADLINE_S` at the `asyncio.wait_for(_connect_and_probe(), ...)` call.

**Two raises** (copy both existing shapes):
- Transient kinds: the flat 424 above with `code="MT5_TERMINAL_NOT_READY"`, `detail=MT5_TERMINAL_NOT_READY_DETAIL`, `recoverable=True`. Keep it an in-place replacement so `test_raw_5xx_census.py` `EXPECTED_SUBCLASS_CONSTRUCTION_SITES = 15` does not move.
- `kind == SCRUB_KIND_SKIPPED_NO_HOUSE_CREDENTIALS`: copy the existing arm (`~:540-550`), `service_error` is not counted by that census:
```python
raise service_error(
    500,
    "MT5_VALIDATION_UNCONFIGURED",
    dependency="mt5-gateway",
    retryable=False,
    detail="The MetaTrader gateway is not configured. This needs an operator, not a retry.",
)
```

**Constants** (copy the `MT5_VALIDATE_*` env convention at `:171` and `:178`):
```python
_MT5_VALIDATE_DEADLINE_S: Final[float] = float(os.getenv("MT5_VALIDATE_DEADLINE_S", "75.0"))
```
add `_MT5_INLINE_SCRUB_BUDGET_S` (env `MT5_VALIDATE_SCRUB_BUDGET_S`, default `"30.0"`) and `_MT5_VALIDATE_PROBE_FLOOR_S` (env, default `"40.0"`) beside it, with the header-block derivation `E - S - record(5 s) = 40` in the same comment style as the existing "Server worst case = 75 + 10 = 85s ... 105s" header.

**Park-skip noise** (`~:1380-1395`): the existing block
```python
elif (_MT5_VALIDATE_DEADLINE_S - (_park_clock() - deadline_started_at)) < _MT5_PARK_MIN_BUDGET_S:
    park_skip = "budget_exhausted"
if park_skip is not None:
    report_park_skipped(park_skip, site=SITE_VALIDATE_WIZARD)
```
Add a local `healed_inline` bool set after a healed scrub; when `park_skip == "budget_exhausted" and healed_inline` log at INFO instead of calling `report_park_skipped`. Every other skip keeps its level (CONTEXT amended bullet).

**Comments to correct (dated CORRECTED notes):** header sentence "an owed scrub REFUSES this request" (`~:127-130`), the DECISION 6 block and the D-02 paragraph above the owed gate, comments at `~:1096-1143` and `~:1457-1464`. The held-lease `except Mt5TerminalBusyError` arm stays byte-unchanged and keeps `MT5_TERMINAL_BUSY`.

---

### `analytics-service/services/closed_sets.py` (config, constant)

**Analog:** `MT5_TERMINAL_BUSY_DETAIL` (`:112-138`).
```python
MT5_TERMINAL_BUSY_DETAIL = (
    "Our MetaTrader connection was busy and could not take this check yet. "
    "Try again in a minute."
)
```
The new `MT5_TERMINAL_NOT_READY_DETAIL` is written the same way, with the same preceding warning comment style (forwarded VERBATIM by the dashboard key forms, so users' words; none of "terminal", "lease", "queue", "lock"; and none of the cascade needles `rate` (also inside "operate"/"separate"/"generate"), `timeout`, `probe`, `trading`, `withdraw`, `signature`, `broker server`, or `ip`+`allow`). Narrow the BUSY comment ("It must be TRUE at BOTH emitters ...") to the held-lease emitter only.

---

### `src/lib/wizardErrors.ts` (config, static copy + verdict map)

**Analog:** `KEY_MT5_TERMINAL_BUSY`, which appears at four sites. Add `KEY_MT5_TERMINAL_NOT_READY` at each.

1. Union (`:165-180`): add `| "KEY_MT5_TERMINAL_NOT_READY"` after `| "KEY_MT5_TERMINAL_BUSY"`; narrow the BUSY comment ("TWO emitters ... the owed-scrub gate" becomes one emitter, the held lease).
2. Copy entry (`:2058-2085`):
```ts
  KEY_MT5_TERMINAL_BUSY: {
    title: "Our MetaTrader terminal is briefly busy.",
    cause:
      "The terminal we check MT5 keys on was busy and could not take this check yet, so it did not run. Nothing was sent to your broker and nothing was stored.",
    fix: [
      "Try again in a minute.",
      "If it is still busy after several tries, send the correlation id below through the contact form.",
      "Your draft is saved.",
    ],
    fixRequires: [null, null, REQUIRES_CONNECT_SURFACE],
    docsHref: "/security",
    actions: ["clear_and_retry", "request_call"],
  },
```
Copy the shape (3 fix lines, `fixRequires: [null, null, REQUIRES_CONNECT_SURFACE]`, `actions: ["clear_and_retry", "request_call"]` so `buildEnvelope` derives `recoverable: true`). The copy names the real cause (the terminal could not be reset and prepared for this check), must not say "busy", and must not say "we have been alerted" unless the key is added to `OUR_DEFECT_KEY_ERROR_CODES` (the fragment is pinned forbidden at `create-with-key/route.test.ts:~3745`). Narrow the BUSY copy comment (`:2061-2070`).
3. Verdict map (`:5225`): `["MT5_TERMINAL_NOT_READY", { code: "KEY_MT5_TERMINAL_NOT_READY", status: 424 }],` after the BUSY row. `VENUE_WIRE_CODE_TO_VERDICT` is a `Map` resolved before the substring cascade (the only recognition path).
4. Dashboard rotate-secret roster (`:6376-6387`): add `"KEY_MT5_TERMINAL_NOT_READY",` after `"KEY_MT5_TERMINAL_BUSY",` with a dated comment in the same voice (omit it and the dialog renders `UNKNOWN`).

`wizardKeyRosters.ts` derives both known-code rosters from the map; no edit there.

---

### `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` (component, event-driven)

**Analog:** the file itself. Pieces to reuse in place:
```tsx
const draftResumeStep: WizardStepKey =
  draftKind === "csv" ? "csv_upload" : "sync_preview";          // ~:253
const [showResumeBanner, setShowResumeBanner] = useState<boolean>(false);   // ~:289
const [hydrated, setHydrated] = useState<boolean>(false);                    // ~:290
```
and `handleResume` (`~:1236-1270`: `setShowResumeBanner(false); setStep(draftResumeStep); persistPointer(...)`), which already mounts the right step; no change there. Start fresh and confirmed delete already set the first step and clear the banner.

**Hold gate (new)** before the `return`:
```tsx
const stepHeld = Boolean(initialDraft) && (!hydrated || showResumeBanner);
```
then wrap the existing `{source === "api" ? (<> ... </>) : (...csv branch...)}` block (begins right after the `source === "api"` strips block, `~:1437`) in `{!stepHeld && (...)}`. The `!hydrated` half is required: a pending choice is only knowable after the async `loadWizardState`; `loadWizardState` never throws so `hydrated` cannot stay false. No exemption for preselect mounts (Pitfall 10). Mounts with `initialDraft == null` are untouched.

**Banner copy (replace the inline ternary at `~:1399-1403`):**
```tsx
<p className="mt-1 text-caption text-text-muted">
  {source === "csv"
    ? "A CSV upload draft from an earlier session is ready. Re-select the file and continue."
    : "A draft from an earlier session is ready. Secrets are never stored in your browser, so you will need to paste your API secret again."}
</p>
```
Extract to a pure `resumeBannerBody({ source, keyType, resumeStep })` (matrix-tested, same style as `deriveWizardResumeOverrides`). Per CONTEXT (amended): CSV keeps its re-select sentence; API and MT5 banners resume onto `sync_preview`, which has no secret input, so they carry no re-entry sentence; a secret sentence appears only if `resumeStep === "connect_key"`, noun by key type (`investor password` for MT5, `API secret` otherwise). Key type from `initialDraft.supported_exchanges` through the capability predicate `venueSecretIsVerbatim` / `venueIsSerialized` (`src/lib/closed-sets.ts:~243-258`), never a hand-typed `"mt5"` name check. Banner JSX, classes and buttons (`wizard-resume`, `wizard-start-fresh`) are unchanged (no new visual treatment; DESIGN.md).

---

### `analytics-service/tests/test_mt5_validation_park.py` (test, request-response)

**Analog:** `_assert_wizard_owed_refusal` (`:1719-1738`) and its callers (`test_scrub_wizard_owed_gate_refuses_without_probing_and_schedules_the_scrub` `:1741`, the missed-scrub, relaunch-debt-alone, first-validation-after-boot, and already-queued tests `~:2022-2067`).
```python
async def _assert_wizard_owed_refusal(router, monkeypatch, scrub_sentry, caplog) -> _RecordingMt5:
    transport = _RecordingMt5(_scenario())
    factory = _install_real_mt5_client(router, transport)
    outcomes = _capture_outcomes(monkeypatch, router)
    with caplog.at_level(logging.DEBUG, logger=_SCRUB_LOGGER):
        with pytest.raises(HTTPException) as ei:
            await _call(router, _make_req())
    _assert_transient_424(ei.value, expected_code="MT5_TERMINAL_BUSY")
    assert factory.call_count == 0, "a client was built for an owed terminal"
    assert transport.logins() == [], "a login ran on a terminal that owes a scrub"
    assert outcomes == ["scrub_owed"], outcomes
```
Rework as a non-scrubbed-kind helper asserting code `MT5_TERMINAL_NOT_READY` (or the 500 `MT5_VALIDATION_UNCONFIGURED` for `skipped_no_house_credentials`), `outcomes == ["scrub_unhealed"]`, factory never called, no login, and NO scheduled task. Add a parametrised test over the six non-scrubbed kinds (Pitfall 1), a healed test (probe runs in the same request, rows and order via `_install_scrub_double` / `_install_scrub_sink`), a floor test and a bound-overrun test. `_capture_outcomes` (`:1609-1620`) records only `stage == "validate"`, so the new `owed_scrub` stage event does not disturb it; add a stage spy for the event. The already-queued test now expects B heals and probes, two scrub rows, no WARNING.

### `analytics-service/tests/test_mt5_validate.py` (test, arithmetic pin)

**Analog:** `test_mt5_validate_worst_case_stays_inside_the_client_budget` (`:1936-1962`). Keep the 105_000 assertions byte-unchanged and add: hand-typed `S == 30.0`, `FLOOR == 40.0`, strict `S + 5.0 + FLOOR <= router._MT5_VALIDATE_DEADLINE_S`; a behavioural test that the probe's `wait_for` timeout equals `E - N` after a stubbed scrub consumes N s through `_park_clock`; a pin that the thread deadline is NOT the wizard bound (drive the real `scrub_and_relaunch_as_house` with a fake clock and assert the relaunch ran). State the deliberate `stage < deadline` inversion (Pitfall 9, option B) in the assertion message. Do not edit `test_mt5_validate_timeout_chain_is_strictly_nested` (`:1908`).

### `analytics-service/tests/test_mt5_session_episodes.py` (test)

Append beside `mt5_terminal_scrub.run_owed_validation_scrub_in_lease,` in `_GUARDED_SYMBOLS` (`:1632-1654`):
```python
    mt5_terminal_scrub.run_owed_validation_scrub_in_lease,
    mt5_terminal_scrub.pay_owed_validation_scrub_in_lease,
```
with a dated comment line in the existing style.

### `analytics-service/tests/test_validate_key_venue_transient.py` and `validate_key_venue_transient_contract.json` (wire parity)

**Analog:** `test_c9_mt5_owed_scrub_answers_terminal_busy` (`:849-890`). It arms `Mt5Client` to fail if built, notes the REAL mark (`note_mt5_scrub_owed(key)`), stubs scheduler and reporter, then calls `_assert_flat_venue_body(r, trigger="mt5_scrub_owed", detail=..., code="MT5_TERMINAL_BUSY", recoverable=True)`. For 218 the scrub must be stubbed (`monkeypatch.setitem(g, "pay_owed_validation_scrub_in_lease", ...)` returning a non-scrubbed kind) and the expectation re-pointed to the new code and detail. Move the C9 fixture case and its `sites` prose (`"C9": "... the owed-scrub gate ..."`, which says "nothing else is using it") to the new code; keep C10 on `MT5_TERMINAL_BUSY` so BUSY stays represented. Update `EXPECTED_FIXTURE_TRIGGERS` (`:210`, `"mt5_scrub_owed"`) only if the trigger name changes, and fix the docstring of `test_terminal_busy_detail_claims_nothing_false_at_scrub_owed` (`:1657`).

### `analytics-service/tests/test_mt5_server_known.py` (cascade sweep)

**Analog:** `test_terminal_busy_detail_collides_with_no_cascade_needle` (`:297-309`):
```python
    from services.closed_sets import MT5_TERMINAL_BUSY_DETAIL
    lower = MT5_TERMINAL_BUSY_DETAIL.lower()
    hits = [n for n in _CASCADE_NEEDLES if n in lower]
    assert hits == [], f"MT5_TERMINAL_BUSY_DETAIL collides with cascade needle(s) {hits}"
    assert not ("ip" in lower and "allow" in lower), "collides with the ip+allow branch"
```
Twin it for `MT5_TERMINAL_NOT_READY_DETAIL`.

### TS census and parity tests (hand-typed, move together, Pitfall 8)

- `tests/lib/validate-key-venue-transient-parity.test.ts`: copy the `MT5_TERMINAL_BUSY: { wizardCode: "KEY_MT5_TERMINAL_BUSY", wireRecoverable: true, envelopeRecoverable: true }` entry (`:169-173`) for the new code; `DISTINCT_WIRE_CODES` 10 to 11; `TOTAL_CASES = 18` (stays 18 if C9 is re-pointed); extend the dated lineage comment (`:224-234`) in the same "read off its own guard's failure message" voice.
- `src/lib/seam-venue-vocabulary.invariant.test.ts`: add `"MT5_TERMINAL_NOT_READY"` beside `"MT5_TERMINAL_BUSY"` (`:834`) with a lineage comment; lineage block `:930-953` 47 to 48; `DERIVED_FLOOR = 28` stays.
- `src/lib/dialog-envelope.invariant.test.ts`: `expect(checked).toBe(37)` (`~:897`) to 38, with a dated row at the documented pattern (`~:879`).
- `src/lib/wizardKeyRosters.test.ts`: insert `"KEY_MT5_TERMINAL_NOT_READY"` in sorted position in `FROZEN_CREATE_WITH_KEY_215` (`:39` area) and `FROZEN_ADD_KEY_215` (`:80` area); floors (28, 23) unchanged.
- Component twin to copy from `MultiKeyConnectStep.test.tsx:410-417`:
```tsx
  it("[164.6.6.3.2 D-02] renders KEY_MT5_TERMINAL_BUSY, not UNKNOWN, WITH a Retry", async () => {
    const envelope = await failSecondKeyWith("KEY_MT5_TERMINAL_BUSY", 424);
    expect(envelope).toHaveAttribute("data-error-code", "KEY_MT5_TERMINAL_BUSY");
    expect(envelope).not.toHaveAttribute("data-error-code", "UNKNOWN");
    expect(envelope.textContent).toContain("Our MetaTrader terminal is briefly busy.");
    expect(within(envelope).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
```
Same twin per BUSY case in `create-with-key/route.test.ts` (`~:3784`), `composite/add-key/route.test.ts` (`~:1616`), `keys/[id]/rotate-secret/route.test.ts` (`~:869`), `UpdateMt5SecretDialog.test.tsx` (`~:332`). Do NOT add one to `StrategyForm`/`AllocatorExchangeManager` (a 424 stays unrecognised there by design). `contracts-registry.test.ts` needs no edit.

### `WizardClient.test.tsx` and overlay tests (banner hold)

**Analog:** `describe("[H-0182] WizardClient — resume banner on LS pointer mismatch")` (`:~427-432`):
```tsx
    resumeOverrides = { showResumeBanner: true };
    render(<WizardClient initialDraft={DRAFT} />);
    expect(await screen.findByTestId("wizard-resume")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-start-fresh")).toBeInTheDocument();
```
This file MOCKS `deriveWizardResumeOverrides` via the `resumeOverrides` variable, so the matching-pointer silent-resume test needs an unmocked derivation (separate file or `vi.importActual`). Tests that assert a step visible UNDER the banner must change: the CSV draft case (`wizard-csv-dropzone` beside the banner, `~:512-532`), the composite draft case (`mock-sync-preview`, `~:547`), the TRAP-4 case (clicks `sync-try-another` while the banner is up, `~:1308-1330`; click Resume first), `ContributionWizardOverlay.test.tsx:398-415` (asserts `sync-strategy-id` before Resume). New tests: banner-only (`queryByTestId` null for `mock-sync-preview`, `wizard-csv-dropzone`, `mock-connect-key`), Resume mounts `draftResumeStep`, confirmed Start fresh mounts the first step, no-draft mount unchanged. Neuter once (drop the hold) and see RED.

## Shared Patterns

### Never-raises guard (one `except Exception`, nested `BaseException` fallback)
**Source:** `analytics-service/services/mt5_terminal_scrub.py` `run_owed_validation_scrub_in_lease` and `mark_validation_terminal_owed_at_boot`
**Apply to:** the new `pay_owed_validation_scrub_in_lease` only. Registered in `_GUARDED_SYMBOLS` and kept literal for the mutant table in `tests/test_mt5_relogin.py`.

### One lease, never two
**Source:** `analytics-service/tests/test_mt5_concurrency.py` `_PRODUCTION_LEASE_SITES` (`("routers/exchange.py", "_validate_mt5_key_probe")`, `("services/mt5_terminal_scrub.py", "scrub_validation_terminal")`)
**Apply to:** the owed gate and the sibling. `asyncio.Lock` is not re-entrant; the sibling runs under the wizard's already-held lease and contains no `async with mt5_terminal_lease`.

### Flat venue-transient wire body
**Source:** `routers/exchange.py` header block at `~:320-353` and the existing raise
```python
raise VenueTransientHTTPException(
    status_code=424, code="MT5_TERMINAL_BUSY", detail=MT5_TERMINAL_BUSY_DETAIL, recoverable=True,
)
```
**Apply to:** the new `MT5_TERMINAL_NOT_READY` raise (no `dependency`, flat shape is load-bearing).

### Hand-typed censuses move in the same commit, with a dated lineage line
**Source:** `tests/lib/validate-key-venue-transient-parity.test.ts:224-234`, `src/lib/seam-venue-vocabulary.invariant.test.ts:930-953`
**Apply to:** every TS pin listed above. Never derive an expected count from the corpus it guards.

### Dated CORRECTED notes rather than silent edits
**Source:** the `⛔ CORRECTED <date>` convention throughout the repo
**Apply to:** the stale "the wizard refuses an owed scrub" comments in `exchange.py`, `mt5_terminal_scrub.py`, `mt5_client.py` (`~:965-983`), `services/ingestion/mt5.py` (`~:281-286`), `closed_sets.py`, `wizardErrors.ts`, plus `docs/STATUS_CONTRACT.md` (row S-30 split into S-30 held lease and new S-31; re-tally the prose counts at `~:445-449`; grep `'^| S-'` before shipping).

### Never log host, port, terminal key, login, password or server
**Source:** `mt5_terminal_scrub.py` header ("Never an account number, login, password, broker server, host, port or terminal key")
**Apply to:** the new INFO log and `owed_scrub` stage event (kind and the already-allowed terminal key on `mt5.stage` events only).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `resumeBannerBody` pure function | utility | transform | No existing banner-copy function; closest style analog is `deriveWizardResumeOverrides` (`src/lib/wizard/localStorage.ts`, pure, unit-tested matrix). Use RESEARCH Q6 for the matrix. |
| Envelope anchor + floor arithmetic in the owed gate | controller | request-response | No existing code subtracts elapsed lease time from the probe deadline; use RESEARCH Q1 and the "Owed gate (sketch)". The `_park_clock` seam and the park gate expression are the nearest code. |

## Open items the planner must carry (from RESEARCH, not resolved by patterns)

- Verify `ls node_modules` in the executing worktree (absent in this one); vitest needs `npm ci` or the main checkout path.
- The per-kind recoverable split (Open Question 5): `failed` (profile tripwire) and `relaunch_unverified` (`-6`) answer recoverable per CONTEXT even where Retry cannot succeed; the per-cause ERROR alert still pages. Booked residual, not fixed here.
- Locate the real pin for "no sentence may imply another check is using the terminal" (`wizardErrors.ts` cites `wizardErrors.test.ts`, which does not contain it); do not rely on it to catch a copy mistake.

## Metadata

**Analog search scope:** `analytics-service/{services,routers,tests,docs}`, `src/lib`, `src/lib/wizard`, `src/app/(dashboard)/strategies/new/wizard`, `tests/lib`
**Files scanned:** about 25 read in part (targeted ranges); all named analog paths confirmed git-tracked (`git ls-files` on the four core files returned 4/4; the rest are standard tracked test/source paths with no `.gsd/capabilities` mirror involvement)
**Pattern extraction date:** 2026-11-19

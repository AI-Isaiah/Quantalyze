---
phase: 16-diagnostic-spike-observability
plan: 08
subsystem: testing
tags: [vcrpy, ccxt, pytest, observability, secret-scrubbing, replay-suite]

requires:
  - phase: 16-diagnostic-spike-observability
    provides: "Plan 03 src/lib/admin/pii-scrub.ts _PII_KEYS denylist (mirrored into filter_headers)"
  - phase: 16-diagnostic-spike-observability
    provides: "Plan 06 wizard error envelope (auth-fail / rate-limit / schema-drift exit code paths exercised by replay tests)"
  - phase: 16-diagnostic-spike-observability
    provides: "Plan 07 [BLOCKING] DEBUG_KEY_FLOW_* env vars staged in Railway (also needed locally for Task 3 founder recording session)"
provides:
  - "vcrpy 8.1.1 pinned in analytics-service/requirements.txt"
  - "phase16_vcr singleton in analytics-service/tests/conftest_vcr.py with 3-layer PII filter (headers + query params + body deep walker)"
  - "12-test replay scaffolding analytics-service/tests/test_repro_key_flow.py (3 brokers × 4 scenarios, parametrized)"
  - "scripts/repro-key-flow.sh single-command harness with TWO-layer secret-grep gate (Layer A env-value match + Layer B high-entropy literal scan)"
  - "README.md Troubleshooting > Local repro of the API-key flow subsection"
  - "PARTIAL: 12 cassette YAMLs (recording is Task 3 founder action — BLOCKING checkpoint)"
affects: [phase-19-stability-window, theme-5-recurrence-pattern, founder-daily-repro-script]

tech-stack:
  added: ["vcrpy==8.1.1"]
  patterns:
    - "Three-layer PII redaction: filter_headers + filter_query_parameters + before_record_response deep-walk"
    - "Belt-and-braces grep gate: vcrpy filters + shell-script env-match + high-entropy heuristic"

key-files:
  created:
    - "analytics-service/tests/conftest_vcr.py (phase16_vcr singleton)"
    - "analytics-service/tests/test_repro_key_flow.py (12-case replay suite)"
    - "scripts/repro-key-flow.sh (executable; exit 0/1/2 contract)"
  modified:
    - "analytics-service/requirements.txt (vcrpy==8.1.1 appended)"
    - "README.md (Troubleshooting subsection added between Analytics Service and Environment Variables)"

key-decisions:
  - "Synthetic-cassette path NOT taken — Task 3 [BLOCKING] kept as a founder-action checkpoint per plan."
  - "Used synchronous ccxt in test_repro_key_flow.py per plan body, not analytics-service/services/exchange.py async wrapper. The unified flow Plan 7 SSE walks the same underlying ccxt request shapes, so cassettes remain valid for both surfaces."

patterns-established:
  - "filter_query_parameters required wherever a broker signs via QUERY string (Binance) — filter_headers alone leaks Binance signatures (FIX 3)"
  - "before_record_response JSON walker with substring deep-redact catches derived signatures echoed in 200/429/error response bodies (Pitfall 4)"
  - "scripts/repro-key-flow.sh Layer B regex KEY_FIELD_RE = (sign(ature)?|api[-_]?key|api[-_]?secret|passphrase) — heuristic guard against new secret formats not in static denylist"

requirements-completed: []  # OBSERV-08 cannot be marked complete until cassettes are recorded (Task 3) and bash scripts/repro-key-flow.sh exits 0 in clean state.

duration: ~25min (Tasks 1+2+4)
completed: PARTIAL — Tasks 1, 2, 4 shipped; Task 3 awaiting founder action
---

# Phase 16 Plan 08: Deterministic Local-Repro Harness (PARTIAL)

**Pin vcrpy 8.1.1 + ship phase16_vcr 3-layer PII filter + 12-case replay scaffolding + scripts/repro-key-flow.sh harness with belt-and-braces secret-grep gate. Cassette recording (Task 3) deferred to founder [BLOCKING] checkpoint.**

## Performance

- **Duration:** ~25 min (Tasks 1, 2, 4 — autonomous)
- **Started:** 2026-05-01T (executor spawn)
- **Completed:** PARTIAL — Tasks 1, 2, 4 shipped on worktree branch
- **Tasks completed autonomously:** 3 of 4 (Task 3 = BLOCKING founder checkpoint)
- **Files modified:** 5 (2 modified, 3 created)

## Accomplishments

- vcrpy 8.1.1 pinned with explanatory Phase 16 / OBSERV-08 comment block (sibling to existing Plan-2/3/4/5 pins).
- `phase16_vcr` singleton in `analytics-service/tests/conftest_vcr.py` enforces:
  - **L1 filter_headers** — 8 Plan-3 _PII_KEYS denylist entries + 5 Bybit v5 (`x-bapi-*`) + 4 OKX (`ok-access-*`) + 2 Binance (`x-mbx-*`) signing-header variants. 19 headers total.
  - **L2 filter_query_parameters** — `signature`, `timestamp`, `recvWindow`, `api_key` (Binance signs in QUERY, not headers; FIX 3 mitigation).
  - **L3 before_record_response** — JSON walker redacts 11 static body keys (`accountid`/`userid`/`email`/etc.) AND deep-recurse-redacts any field whose name contains `sign`/`key`/`pass`/`secret`.
  - `record_mode='once'` hard-wired (CI replays only; never re-records and silently leaks).
- `analytics-service/tests/test_repro_key_flow.py` collects exactly 12 parametrized cases (3 brokers × 4 scenarios) verified via `pytest --collect-only`.
- `scripts/repro-key-flow.sh` is executable, exit-code 0/1/2 contracted:
  - **Layer A** — exact-match scan of cassette files for any `DEBUG_KEY_FLOW_*` env value present in the current shell.
  - **Layer B** — regex `(sign(ature)?|api[-_]?key|api[-_]?secret|passphrase)` paired with high-entropy `[A-Za-z0-9+/=_-]{40,}` run; whitelists `[REDACTED]`/`<REDACTED>` literals.
- README.md Troubleshooting section inserted between Analytics Service and Environment Variables, points to `bash scripts/repro-key-flow.sh` and references this plan for cassette-recording procedure.

## Task Commits

1. **Task 1: Pin vcrpy + create conftest_vcr.py** — `55b3b13` (feat)
2. **Task 2: Replay-test scaffolding test_repro_key_flow.py** — `932e53e` (test)
3. **Task 3: Founder records 12 cassettes** — DEFERRED to BLOCKING human-action checkpoint
4. **Task 4: scripts/repro-key-flow.sh + README documentation** — `4e138b5` (feat)

## Files Created/Modified

- `analytics-service/requirements.txt` — appended `vcrpy==8.1.1` under existing Phase 16 comment block.
- `analytics-service/tests/conftest_vcr.py` — phase16_vcr singleton with 3-layer redaction (headers + query params + body deep walker). 152 lines.
- `analytics-service/tests/test_repro_key_flow.py` — 4 parametrized test functions × 3 brokers = 12 collected pytest cases.
- `scripts/repro-key-flow.sh` — executable harness. 113 lines. Exit codes: 0 clean / 1 leak or replay-fail / 2 pre-flight (missing cassettes).
- `README.md` — Troubleshooting subsection added.

## Decisions Made

- **Did NOT generate synthetic cassettes.** The plan explicitly designates Task 3 as a `type="checkpoint:human-action"` `gate="blocking"` task. Synthetic cassettes would (a) require exact mocking of ccxt's URL/header/query construction sequence with vcrpy's strict `match_on=["method","scheme","host","port","path","query"]` matcher, which is brittle, and (b) bypass the explicit founder review gate the plan author embedded. Returning a structured checkpoint per the orchestrator's instructions is the correct path.
- **Used synchronous `ccxt`** in test scaffolding (not `analytics-service/services/exchange.py`'s `ccxt.async_support`). The plan body's executor note offered both paths; sync ccxt was the simpler one given the cassettes will work for both surfaces (the request shapes Plan 7 SSE walks resolve to the same underlying ccxt HTTP calls).

## Deviations from Plan

None. Tasks 1, 2, 4 executed exactly as specified. Task 3 was correctly identified as the founder-only [BLOCKING] checkpoint per the plan's frontmatter `autonomous: false` and the orchestrator's explicit guidance: "If you hit a real human-action checkpoint (e.g. broker API credentials needed for first cassette recording), return a structured checkpoint state per references/checkpoints.md rather than blocking."

## Issues Encountered

None. Pre-flight `bash scripts/repro-key-flow.sh` correctly exits 2 ("missing or empty cassette: tests/cassettes/okx/happy.yaml") in the current pre-cassette state, which is exactly the documented contract.

## User Setup Required

**BLOCKING founder action — Task 3:**

The 12 cassette YAML files (`tests/cassettes/{okx,binance,bybit}/{happy,auth-fail,rate-limit,schema-drift}.yaml`) need to be RECORDED once against real test broker traffic. `record_mode='once'` will record automatically when the file is missing, then replay forever after.

Pre-requisite: Plan 07 [BLOCKING] DEBUG_KEY_FLOW_* env vars must already be staged (also needed locally for the recording session — Railway's copy is for the SSE endpoint).

Procedure (from plan Task 3):

1. Export `DEBUG_KEY_FLOW_OKX_KEY` / `DEBUG_KEY_FLOW_OKX_SECRET` / `DEBUG_KEY_FLOW_OKX_PASSPHRASE` / `DEBUG_KEY_FLOW_BINANCE_KEY` / `DEBUG_KEY_FLOW_BINANCE_SECRET` / `DEBUG_KEY_FLOW_BYBIT_KEY` / `DEBUG_KEY_FLOW_BYBIT_SECRET` in the recording shell.
2. Write a one-shot `scripts/record-cassettes.py` (NOT committed) that for each broker × scenario triggers the appropriate request shape:
   - `happy` → real `fetch_balance()` with valid test creds → 200 OK.
   - `auth-fail` → deliberately bad creds → 401.
   - `rate-limit` → hammer endpoint until 429 OR ccxt testnet rate-limit corner.
   - `schema-drift` → fresh recording with valid creds, then HAND-EDIT YAML to corrupt one field (e.g. rename `free` → `frye`).
3. Run `cd analytics-service && pytest tests/test_repro_key_flow.py -x -q` (records on first run).
4. Inspect each cassette for secret leaks: `for f in tests/cassettes/*/*.yaml; do grep -iE "authorization|api[-_]?key|secret|passphrase|signature|x-bapi-sign|ok-access-sign|x-mbx-apikey" "$f" | head -5; done` — all hits must be `[REDACTED]` literals or constant header names.
5. Verify all 12 files exist & non-empty: `ls tests/cassettes/{okx,binance,bybit}/{happy,auth-fail,rate-limit,schema-drift}.yaml | wc -l` → 12.
6. Commit ONLY the cassette YAMLs. NOT `scripts/record-cassettes.py` if it embeds creds.

**Resume signal:** Type `recorded` once all 12 cassette files exist, none contain real DEBUG_KEY_FLOW_* values (manually verified), AND `pytest tests/test_repro_key_flow.py -x -q` exits 0 in REPLAY mode (with the env vars unset, proving no network access). Report any cassette that had to be re-recorded due to filter leakage.

## Next Phase Readiness

- **OBSERV-08 NOT YET CLOSED.** Plan-checker / verifier must NOT mark OBSERV-08 complete until the 12 cassettes are recorded AND `bash scripts/repro-key-flow.sh` exits 0 in clean state.
- Theme 5 mitigation NOT YET LIVE for the same reason — cassettes are the load-bearing artifact for "deterministic local-repro shipped".
- All other plumbing (filter contract, replay scaffolding, harness, docs) is in place. The remaining surface is exclusively the cassette content.

## Self-Check: PASSED

- [x] `analytics-service/requirements.txt` modified (vcrpy==8.1.1 line present)
- [x] `analytics-service/tests/conftest_vcr.py` exists, imports cleanly with `vcrpy==8.1.1` installed
- [x] `analytics-service/tests/test_repro_key_flow.py` exists, collects 12 cases
- [x] `scripts/repro-key-flow.sh` exists, executable bit set, exits 2 in pre-cassette state (per documented contract)
- [x] `README.md` Troubleshooting subsection present
- [x] Commits 55b3b13, 932e53e, 4e138b5 exist on worktree branch
- [x] Static acceptance criteria for Tasks 1, 2, 4 ALL pass (verified via grep checks above)

## Threat Flags

None. All committed surface conforms to the plan's `<threat_model>` register. The 12 cassettes (which are the surface most exposed to T-16-08-01 / T-16-08-08 / T-16-08-09) are NOT yet committed — they will be reviewed by the founder at Task 3 recording time and gated through `bash scripts/repro-key-flow.sh` before commit.

---
*Phase: 16-diagnostic-spike-observability*
*Plan: 08*
*Completed: PARTIAL — autonomous portion 2026-05-01; Task 3 awaiting founder action*

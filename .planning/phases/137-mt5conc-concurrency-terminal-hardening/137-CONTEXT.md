# Phase 137: MT5CONC — Concurrency + terminal-lifecycle hardening - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (trust-critical hardening; decisions locked by roadmap + the WEDGE-01/PR#632 lesson; engineering-discretion only)

<domain>
## Phase Boundary

The trust-critical hardening layer over the Phase-136 MT5 derive branch: the worker can NEVER
wedge on a hanging terminal, and `api_verified` can NEVER be stamped on the wrong account's
numbers. Two guarantees:
1. **Never wedge** — every MT5 IPC call at the derive seam is `to_thread` + `wait_for` bounded;
   a hung terminal times out → classified transient → the event loop + healthz stay live; the
   timeout ACTIVELY RESTARTS the terminal (a blocked pipe won't self-unblock) and the job
   re-queues (never a permanent `failed_final` from a transient hang).
2. **Never cross-bleed** — a per-terminal serialization lock makes cross-account interleaving
   structurally impossible, and an `account_info().login == expected` bracket assertion pre+post
   every read block fails loud + persists NOTHING on mismatch.

All provable against the Phase-134 `Mt5Client` contract double (deliberately-hung terminal;
wrong-login) — NO live broker. Built on the Phase-136 derive branch (job_worker.py mt5 branch,
`Mt5Session`, `_make_mt5_session`) which deliberately reserved restart+lock for this phase
(job_worker.py:282). v1 posture: serialized login→read→logout loop on ONE terminal.

NOT in this phase: UI/badge (138); prod gateway + live soak + flag flip (139); multi-terminal
pooling (v1 is explicitly ONE terminal, serialized).
</domain>

<decisions>
## Implementation Decisions

### MT5CONC-01 — never wedge (restart-on-timeout + re-queue)
- Every MT5 IPC at the derive seam runs under `asyncio.to_thread` + `asyncio.wait_for` (the
  WEDGE-01/PR#632 lesson — heavy/blocking work OFF the shared event loop, bounded). The 136
  branch already bounds the read; 137 makes it COMPLETE + hardened.
- **Terminal-restart-on-timeout:** a `wait_for` TimeoutError does NOT just classify transient —
  it ACTIVELY tears down + reinitializes the terminal session (a blocked RPyC pipe won't
  self-unblock; the next job would inherit the wedge otherwise). The restart itself is bounded
  (never a nested wedge).
- The hung-then-timeout path classifies TRANSIENT and RE-QUEUES the job — NEVER a permanent
  `failed_final` from a transient hang (`asyncio.TimeoutError → transient` classification already
  exists; 137 ensures the restart + re-queue wiring is correct end-to-end).
- **Regression test:** a deliberately-hung terminal (contract double blocks past the ceiling) →
  `wait_for` fires → restart invoked + job classified transient/re-queued; the event loop and
  healthz stay live. Fails without the restart wiring.

### MT5CONC-02 — never cross-bleed (per-terminal lock + login bracket)
- **Per-terminal serialization lock** (`asyncio.Lock`, keyed to the single terminal): two
  concurrent MT5 syncs CANNOT share the terminal — structurally serialized. A regression test
  proves two concurrent syncs cannot interleave on one terminal.
- **Login-bracket assertion:** `account_info().login == expected_login` is asserted BOTH pre- and
  post- every read block. A mismatch FAILS LOUD (typed raise) and persists NOTHING — the
  guarantee that `api_verified` is never stamped on the wrong account's numbers. Secrets never in
  the mismatch message (only the expected/actual login integer, which is not a secret, but scrub
  any server/password context).
- **v1 = serialized login→read→logout loop on ONE terminal** (no pooling). The lock + the
  logout-between-accounts + the bracket assertion together make cross-account contamination
  structurally impossible.

### Claude's Discretion
The exact lock granularity (module-level singleton vs Session-attached), the restart bound value,
and the bracket-assertion error type are engineering-discretion, grounded in the existing
job_worker transient/failed_final machinery + the Mt5Session lifecycle.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets / Analogs
- `services/job_worker.py` — the mt5 derive branch (Phase 136, ~:3255), `Mt5Session` usage,
  `_make_mt5_session` (:807), the transient/permanent/`failed_final` classification machinery
  (`asyncio.TimeoutError → transient` at :23), and the explicit "restart-on-timeout + per-terminal
  lock is Phase 137" marker at :282.
- `services/mt5_client.py` — `Mt5Client.login` (:201), bounded idempotent `close`/`shutdown`
  (:263), `Mt5Session` (:276) — the session lifecycle to add restart + bracket to.
- The WEDGE-01/PR#632 precedent ([[project_stitch_composite_wedge01_fix_and_local_prod_worker.md]])
  — heavy work `to_thread` + derive `wait_for`; the reason healthz must stay live.

### Established Patterns
- `to_thread` + `wait_for` bounding of blocking work off the shared worker loop; transient →
  re-queue vs permanent → `failed_final` classification; fail-loud + no-invented-data.

### Integration Points
- The mt5 derive seam in job_worker.py; the `Mt5Session`/`Mt5Client` lifecycle (restart + bracket);
  the transient classification + re-queue path.
</code_context>

<specifics>
## Specific Ideas
- A blocked RPyC pipe will NOT self-unblock — restart must actively `shutdown()` + re-`initialize`
  the terminal, not just close the client handle.
- The login bracket compares `account_info().login` (an int) to the expected login parsed from the
  key; this is the direct structural guard against a stale/mis-routed terminal returning the wrong
  account's equity.
</specifics>

<deferred>
## Deferred Ideas
- Multi-terminal pooling / parallel MT5 syncs → post-v1 (v1 is ONE serialized terminal).
- Live-broker validation of the hang/restart behavior → Phase-134 human_needed spike / Phase 139.
- The master-rejection retcode (WR-03) + DEAL_TYPE middle (136-05) remain their own human gates.
</deferred>

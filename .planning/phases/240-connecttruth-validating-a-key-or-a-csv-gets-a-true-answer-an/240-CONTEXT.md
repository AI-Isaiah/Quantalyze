# Phase 240: CONNECTTRUTH — validating a key or a CSV gets a true answer, and anonymous limits are fair - Context

**Gathered:** 2026-11-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Four user-facing truths, no migration:
- CONN-05: every `POST /api/validate-key` 400 body carries the same machine-readable `code` field on every venue.
- CONN-06: a month-name date cell in a numeric-date CSV column is parsed.
- RLIM-01: anonymous visitors from different IPs cannot exhaust a shared anonymous `/process-key` bucket, and no analytics-service limit is keyed on the proxy's IP.
- RLIM-02: a signed-in user validating a CSV within the edge limit never gets an upstream 429; the limiter docblocks cite the current upstream caps.

Out of scope: the "contact support" string in `csv_validator.py` (`_maybe_auto_normalize_percent_form`), owned by Phase 222 ALERTTRUTH. Writes in `csv_validator.py` stay inside the date-detection/parse symbols.

</domain>

<decisions>
## Implementation Decisions

All four rulings are the founder's, 2026-11-24, relayed by the coordinator; each took the recommended option.

### RLIM-01 — anonymous bucket
- Per-IP anonymous tier. The TS teaser route (`src/app/api/verify-strategy/route.ts`) mints the anonymous tenant claim with a hash of the client IP, read at Vercel from `getClientIp`, never Railway's proxy IP. Python keys `process_key:anon:<iphash>` at 30/hour per IP. — **Reversibility:** costly — the claim payload grammar widens on both sides of the signed `X-Tenant-Claim` contract (`src/lib/tenant-claim.ts`, `services/rate_limit.py`).
- An aggregate anonymous ceiling sits on top, kept well below the shared 500/hour `/process-key` ceiling, so anonymous traffic as a whole cannot starve tenants.
- The simulator's IP-keyed limit was ruled to be re-keyed onto `tenant_or_platform_key`. ⚠️ MEASURED at HEAD 2026-11-24 (UI research, confirmed by the phase agent): this already shipped in Phase 163 SEC-05 — `routers/simulator.py` decorates with `partial(tenant_or_platform_key, scope="simulator")` and `_simulator_rate_limit_key` is deleted. The phase verifies it with a pin (no analytics-service limit keyed on `get_remote_address`) and corrects the stale FINDING-10 prose in the `services/rate_limit.py` docblock; it does not redo the re-key.

### RLIM-02 — CSV limits
- CSV-scoped upstream tier. csv-validate sends a signed scope signal (carried by the signed claim or an HMAC-covered header — never an unsigned header). Python gives CSV validation its own per-tenant bucket sized at or above the edge limit (20/minute), exempt from the shared 500/hour ceiling or given its own slice of it, so a CSV user inside the edge limit is never refused upstream. — **Reversibility:** costly — a signed contract between `process-key-client.ts` and `routers/process_key.py`.
- csv-validate and csv-finalize move onto separate edge limiters (csv-finalize spends no upstream token).
- The stale docblock citation ("the upstream 30/hour cap" in `routers/csv.py`) is replaced with the real upstream cap in the same change.

### CONN-06 — CSV month-name date cells
- Parse the month-name cell (e.g. `12 Mar 2024` in a `DD/MM/YYYY` column). A month name carries no day/month ambiguity, so the reading cannot land in the wrong calendar. Flag it through the existing date-normalization info flag. Closes TODOS `[170.1-CSV-ODD-SPELLING-REJECTED]` with a test.

### CONN-05 — validate-key 400 code
- Every validate-key 400 gets the flat `{detail, code, recoverable}` shape. Codes: `AUTH_FAILED` (bad credentials on any venue, incl. sFOX 401/empty token and MT5 bad password), `MT5_WRONG_SERVER`, `MT5_MASTER_PASSWORD`, plus new `VENUE_DISABLED` (sFOX/MT5 go-dark gates) and `INVALID_REQUEST` (`create_exchange` `ValueError`). Permanent arms are `recoverable:false`. Every `detail` string stays byte-identical (the TS classifier matches on detail text). One test per venue reads `code`. — **Reversibility:** costly — public body contract read by TS consumers.
- Light touch on the entry's other two findings: feed the MT5 permanent codes into `routers/process_key.py` `_envelope_error`'s `recoverable` derivation (plumbing exists); re-derive STATUS_CONTRACT.md prose coordinates by symbol; the historical §7 S-table stays as a census, recorded with that reason.

### Decided autonomously
- [Research] Q: "How many analytics replicas share the memory:// limiter?" → Selected: "1 Railway replica, 1 uvicorn worker (Dockerfile CMD has no --workers); the limiter is one global counter" — a measurement, re-read if the deploy config changes.
- [Proof] Q: "How is PROOF-01 shown?" → Selected: "each new gate neutered in a byte copy, RED with its named arm, restored with cp and cmp, GREEN, recorded verbatim in the plan SUMMARY" — test-process only.

### Claude's Discretion
- Resolved after research (2026-11-24, phase agent, within the founder rulings):
  - CSV tier and the ceiling: EXEMPT from the 500/hour ceiling (the only reading under which "never gets an upstream 429" holds); CSV per-tenant tier 60/minute (three times the edge bucket, covering bucket straddle and latency).
  - Anonymous aggregate ceiling: 200/hour, founder-retunable. Stack order on `/process-key` is fixed so the per-identity limit is evaluated first, then the anonymous aggregate, then the platform ceiling, so a refused request does not spend a ceiling token.
  - slowapi's own `ratelimit ... exceeded` log line may carry the keyed HMAC of an IP; that is not the IP and is not reversible without the secret. The UI-SPEC rule binds response BODIES: no IP, IP hash or bucket key in any 429 body. No logging filter.
  - IPv6 addresses are hashed as given (no /64 normalisation); the anonymous aggregate ceiling bounds address rotation.
  - Deploy order: Python side tolerates both old and new claims and must strictly validate the `public:` suffix; ship as one PR (Railway deploys after main CI; Vercel deploys on merge), with a transient skew that is not an outage.
  - Rotate-secret go-dark gap (Python `rotate_key_secret` calls `_validate_mt5_key` without the `mt5_enabled_server()` gate): take it in this phase, emitting the same flat `VENUE_DISABLED` 400, because it is a live probe against a dark venue and the code exists in this phase.
  - Replica count: measured by the phase agent from Railway service config (read-only, no variable values): 1 replica; with one uvicorn worker the memory:// limiter is one counter.
- Exact anonymous aggregate ceiling and CSV tier numbers, within the rulings above; the hash construction for the IP (keyed HMAC so the raw IP never reaches Python or logs); code placement and test layout.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/rate_limit.py`: `verify_tenant_claim`, `tenant_rate_limit_key`, `tenant_or_platform_key`, `anon_bucket_key`, `platform_ceiling_key`, `ANON_PAYLOAD`.
- `routers/process_key.py`: `_PROCESS_KEY_TENANT_LIMIT`/`_ANON_LIMIT`/`_CEILING_LIMIT`, callable limit providers `_process_key_limit_for` / `_process_key_ceiling_limit_for` (slowapi passes the key to a provider declaring `key`).
- `services/app_error_handlers.py`: anon-bucket saturation alert keyed on `anon_bucket_key("process_key")` — must follow the re-key.
- `src/lib/tenant-claim.ts` `mintTenantClaim`; `src/lib/process-key-client.ts` mints the `"public"` claim on the teaser path; `src/lib/ratelimit.ts` `getClientIp`, `publicIpLimiter`, `csvValidateLimiter`.
- `services/csv_validator.py`: `_parse_dates`, `_detect_and_normalize_date_column`, `date_format_normalized` info flag.
- `routers/exchange.py`: validate-key arms; ccxt arm already emits the flat shape; `_validate_sfox_key`, `_validate_mt5_key`.

### Established Patterns
- Key functions never raise (G-8). Literal limit pins in `tests/test_limiter_identity.py` move in the same commit as any limit.
- Gates must be shown RED on a neutered byte copy (PROOF-01).

### Integration Points
- `src/app/api/verify-strategy/route.ts`, `src/app/api/strategies/csv-validate/route.ts`, `src/app/api/strategies/csv-finalize/route.ts`.
- Note: the teaser UI is currently rendered by no page (`[192-ORPHANED-LANDING-VERIFY]`); the route stays public, so the fix still matters for direct calls.

</code_context>

<specifics>
## Specific Ideas

- No limit in analytics-service may be keyed on `get_remote_address` after this phase.
- `publicIpLimiter` also serves factsheet-share, scenario-share, BTC benchmark and tearsheet PDF routes; do not retune it.

</specifics>

<deferred>
## Deferred Ideas

- Retiring the orphaned teaser UI (`[192-ORPHANED-LANDING-VERIFY]`) — not chosen; stays with its own owner.

</deferred>

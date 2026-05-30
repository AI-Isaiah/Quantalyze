/**
 * `src/lib/retry/` — shared client retry/backoff primitives (B20).
 *
 * Three focused primitives that close the divergent-`Retry-After`-parser / hot-
 * retry class across the complete client surface by construction:
 *
 *   - `parseRetryAfterSeconds` — the ONE header parser. Never returns NaN/0/<0,
 *     handles both RFC 9110 forms. All three client parsers (useMandateAutoSave,
 *     StarToggle, PortfolioImpactPanel) route through it.
 *   - `abortableWait`          — abort-aware backoff/retry-after sleep.
 *   - `RateLimitGate`          — monotonic herd-desync gate for concurrent
 *                                requests against one rate-limited endpoint.
 *
 * DELIBERATELY NOT a `useResilientFetch` state-machine hook. The four client
 * retry sites have genuinely divergent state machines — optimistic-update +
 * rollback + useTransition (StarToggle); per-field Set + generation counter +
 * shared gate + non-idempotent-timeout-terminal (useMandateAutoSave); single-
 * field + generation (useNoteAutoSave); no-auto-retry + abort-on-refetch
 * (PortfolioImpactPanel). Folding them onto one hook would need an options
 * explosion larger than the duplication it removes and would re-inject
 * useMandateAutoSave's hard-won correctness (NEW-C05-01/03/05/06/07, H-0382)
 * through callbacks. The bug class is the PARSER, not the loops; the parser is
 * the shared surface. The C05-06 non-idempotent-no-retry-on-timeout invariant
 * stays in useMandateAutoSave — the only non-idempotent-write retry loop.
 * (B25 will add the lint ban on raw `Number(...Retry-After)` as the capstone.)
 */
export { parseRetryAfterSeconds, type RetryAfterHeaders } from "./retry-after";
export { abortableWait } from "./wait";
export { RateLimitGate } from "./rate-limit-gate";

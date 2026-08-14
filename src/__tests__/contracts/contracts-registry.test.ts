import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import quantalyzePlugin from "../../../tools/eslint-plugin-quantalyze/index.mjs";

/**
 * B25 — the contracts registry guard.
 *
 * The cross-cutting refactor program (B1–B24) closed many finding-CLASSES "by
 * construction" and left a guard behind for each: a grep sweep, a compile-time
 * `@ts-expect-error` pairing, a parity matrix, a registry-completeness check,
 * or — new in B25 — an eslint-plugin-quantalyze AST rule. Those guards already
 * run in the normal suite, but nothing pinned the *set* of them: a guard could
 * be deleted/renamed and CI would stay green (the silent-reintroduction gap the
 * capstone exists to close).
 *
 * This file is that pin. It is the discoverable registry + the fail-loud teeth:
 *   - every registered guard file must still exist (delete/rename → red CI);
 *   - the plugin must export exactly the expected rule set;
 *   - eslint.config.mjs must wire every rule at "error";
 *   - the contracts.yml CI surface must exist and run the contracts + lint.
 *
 * NOTE: this is a registry + wiring integrity check, NOT a re-run of each
 * guard (they execute in the normal vitest suite + contracts.yml). See
 * src/__tests__/contracts/REGISTRY.md for the human-readable table + the
 * honesty-gate inventory of classes that are already type-enforced and
 * deliberately have NO guard here.
 */

const ROOT = process.cwd();

// Rules wired repo-wide at "error" in the broad src/** block, so the "resolves
// every rule to error" probe below (which targets src/lib/visibility.ts)
// covers them with no rule→file split needed.
const REPO_WIDE_ERROR_RULES = [
  "no-raw-localstorage",
  "no-raw-published-predicate",
  // CONTRIB-04 (Phase 110) — bans a raw owner-OR predicate
  // (`.or('...user_id...')`) outside src/lib/visibility.ts's withPublishedOrOwner,
  // so a future admin-client swap can't silently drop the RLS backstop and leak
  // unpublished rows. Registered + wired to "error" repo-wide by plan 110-02
  // (eslint.config.mjs); visibility.ts is exempt inside the rule's AST logic (the
  // config level there is still "error", so the repo-wide probe below holds).
  "no-owner-or-on-admin-client",
  "no-raw-retry-after-parse",
  // B9 — bans Zod .passthrough()/.catchall() at boundary parsers.
  "no-passthrough-on-ipc",
  // B14 — bans raw `last_sync_at`-vs-cutoff staleness comparisons outside the
  // deriveSyncFreshness SoT. Its own module (src/lib/sync-freshness/**) and
  // test files are the only exemptions.
  "no-raw-staleness-derivation",
  // DS-04 (phase 49) — bans a `clamp()` whose preferred (middle) term is
  // viewport-only (no rem), the WCAG 1.4.4 / F94 zoom-unsafe shape. Wired
  // repo-wide at "error" (the dirty baseline has zero rem-less clamp strings).
  "no-rem-less-clamp",
  // DS-04 (phase 49) → BP-03 (phase 54): `no-raw-font-px` began as a SCOPED
  // strangler (error on the clean design-tokens surface, warn on the dirty
  // text-[NNpx] baseline) and ratcheted to error per-surface across phases
  // 52/53. Phase 54 BP-03 COMPLETED the migration and flipped it to error
  // REPO-WIDE — the only documented exemptions are the 4 frozen-chart islands
  // (EquityChart + the 3 factsheet SVGs), `src/components/charts/**`, and test
  // fixtures (editing a FROZEN_ISLANDS file reds the frozen-spine guard). Its
  // repo-wide teeth are asserted on visibility.ts below; the intentional
  // frozen-island exemption is asserted via FROZEN_EXEMPT, so neither the
  // repo-wide error nor the frozen off-glob can silently flip.
  "no-raw-font-px",
  // SEAM-01 (Phase 140) — bans a raw fetch() of the analytics service base URL
  // outside src/lib/resilient-fetch.ts, which owns the per-call-site timeout
  // budget and the shared breaker:railway circuit breaker. Wired to "error"
  // repo-wide on a PROVEN-clean baseline (waves 1-3 routed every live seam call
  // through the core). Its four documented exemptions are asserted below via
  // SEAM_ALLOWLIST_EXEMPT, so neither the repo-wide error nor the off-block can
  // silently flip.
  "no-raw-analytics-fetch",
] as const;

// Phase 140 / SEAM-01 — `no-raw-analytics-fetch` must RESOLVE to a NON-error
// level on exactly these four files: the core itself (the only legal home for
// the base URL) and the three documented `SEAM_EXCLUSIONS` rows in
// src/lib/resilient-fetch.ts (bespoke debug SSE route + the two /health warmers,
// which must not consume breaker failure budget nor be blocked by an open
// breaker). This list is FROZEN at four (threat T-140-26): a new lint failure
// means a new seam call site, and the fix is to route it through the core, never
// to add a fifth entry here. It doubles as a minimatch check — an off-glob that
// silently fails to match would resolve to error and fail loud, which is exactly
// how the `\[id\]` char-class trap was caught in phase 54-05.
const SEAM_ALLOWLIST_EXEMPT: Array<{ rule: string; file: string }> = [
  { rule: "no-raw-analytics-fetch", file: "src/lib/resilient-fetch.ts" },
  { rule: "no-raw-analytics-fetch", file: "src/app/api/debug-key-flow/route.ts" },
  { rule: "no-raw-analytics-fetch", file: "src/app/api/cron/warm-analytics/route.ts" },
  { rule: "no-raw-analytics-fetch", file: "src/lib/warmup-analytics.ts" },
];

// Phase 54 BP-03 — `no-raw-font-px` must RESOLVE to a NON-error level on the
// documented frozen-chart islands (the off-glob exemption), proving the carve-out
// is real + intentional. A flip to error here would red-CI an un-editable frozen
// file; an over-broad off-glob would silently neuter the repo-wide teeth.
const FROZEN_EXEMPT: Array<{ rule: string; file: string }> = [
  { rule: "no-raw-font-px", file: "src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx" },
  // A factsheet/[id]/v2 chart — guards the `\[id\]` minimatch escaping in the
  // off-glob. 54-05 caught a literal `[id]` being read as a char-class that
  // silently never matched (re-exposing 3 frozen files at the error flip). If
  // that escape regresses, this resolves to error and fails loud.
  { rule: "no-raw-font-px", file: "src/app/factsheet/[id]/v2/TimeSeriesChart.tsx" },
];

// HAND-TYPED, and it must stay that way. Replacing this with
// `Object.keys(quantalyzePlugin.rules)` would make the wiring assertion below
// compare the plugin to itself — an assertion that can never fail (Oracle
// Independence hazard #3, forbidden by 140.3-10 and 140.3-12). Note the
// asymmetry that makes the split necessary: EXPECTED_RULES is every rule the
// plugin EXPORTS, while REPO_WIDE_ERROR_RULES is the subset wired to "error"
// repo-wide. A SCOPED rule belongs in the first list and NOT the second.
const EXPECTED_RULES = [
  ...REPO_WIDE_ERROR_RULES,
  // SEAMRIM-11 (Phase 140.4) — bans an awaited PostgREST read destructured for
  // `data`/`count` without binding `error`, in BOTH the object form and the
  // `Promise.all` ARRAY form (an object-only predicate returns zero on the
  // array form, which is how C-3 survived every prior census). SCOPED, not
  // repo-wide: the baseline is dirty and definition-dependent, so it is wired
  // to "error" only on the surface a plan has PROVEN clean
  // (src/app/api/admin/strategy-review/route.ts) and ratchets outward. It is
  // therefore deliberately absent from REPO_WIDE_ERROR_RULES above — adding it
  // there would assert repo-wide teeth this rule does not yet have.
  "no-unchecked-supabase-read",
] as const;

interface Guard {
  path: string;
  batch: string;
  invariant: string;
}

// The canonical set of by-construction invariant guards. Keep in step with
// REGISTRY.md. A guard removed/renamed without updating this list fails the
// existence test below.
const CONTRACT_GUARDS: Guard[] = [
  { path: "src/lib/visibility.test.ts", batch: "B10", invariant: "no raw .eq('status','published') outside withPublishedOnly (grep sweep)" },
  { path: "src/lib/api/limiter-ordering.test.ts", batch: "B15", invariant: "rate-limit route ordering registry + completeness" },
  { path: "src/__tests__/audit-event-union-types.test.ts", batch: "B4c", invariant: "audit action↔entity_type pairing (compile-time @ts-expect-error)" },
  { path: "src/lib/closed-sets.test.ts", batch: "B8", invariant: "closed-set registry (exchanges/roles) pinned + satisfies guarantee" },
  { path: "src/__tests__/metrics-parity.test.ts", batch: "B9", invariant: "cross-runtime metrics schema parity (golden fixture)" },
  { path: "src/__tests__/metrics-parity-helper.test.ts", batch: "B9", invariant: "TS-side trade-mix bucket-mode parity" },
  { path: "src/app/api/allocator/scenario/commit/percent-allocated-parity.test.ts", batch: "B9", invariant: "percent_allocated parity: Zod ↔ DB CHECK ↔ RPC validator" },
  { path: "src/__tests__/strategy-sources-migration-parity.test.ts", batch: "B9", invariant: "STRATEGY_SOURCES TS registry ↔ SQL CHECK constraint parity" },
  { path: "src/__tests__/contracts/check-zod-db-check-parity.test.ts", batch: "B9", invariant: "14-column CHECK↔Zod parity matrix (incl. computation_status #399 'stale' rejection)" },
  { path: "src/__tests__/strategies-source-csv-constraint.test.ts", batch: "B9", invariant: "strategies.source CHECK admits 'csv'" },
  { path: "src/__tests__/critical-regressions.test.ts", batch: "B24", invariant: "VERSION/package.json sync + dynamic workflow-security policy + database.types.ts hand-patch integrity" },
  { path: "src/__tests__/contracts/env-manifest.test.ts", batch: "#15", invariant: ".env.example is the enforced env manifest (bidirectional: src reads ↔ documented keys)" },
  { path: "src/__tests__/audit-coverage.test.ts", batch: "Audit", invariant: "every Supabase mutation emits an audit event (grep)" },
  { path: "src/__tests__/admin-csrf-ratelimit-grep.test.ts", batch: "Audit", invariant: "CSRF + admin rate-limit coverage on mutating handlers (grep)" },
  { path: "src/__tests__/redteam-b02-regressions.test.ts", batch: "B02", invariant: "red-team b02 fix regressions (grep)" },
  { path: "src/__tests__/audit-log-cold-archive.fail-loud.test.ts", batch: "C-0004", invariant: "no silent-skip in audit cold-archive integration test (static guard)" },
  { path: "src/__tests__/gdpr-export.test.ts", batch: "GDPR", invariant: "GDPR export manifest shape invariants (no dupes/ordering)" },
  { path: "src/__tests__/gdpr-export-coverage-hook.test.ts", batch: "B10/GDPR", invariant: "GDPR coverage-hook exit-code contract (class-guard)" },
  { path: "src/__tests__/mandate-columns-schema-sync.test.ts", batch: "Mandate", invariant: "ALLOCATOR_PREFERENCES_COLUMNS ↔ live-DB projection sync" },
  { path: "src/__tests__/check-banned-packages.test.ts", batch: "Supply-chain", invariant: "banned packages absent from direct + transitive deps" },
  { path: "src/__tests__/gitleaks-allowlist.test.ts", batch: "Secrets", invariant: ".gitleaks.toml allowlist shape + fixture-to-pattern match" },
  { path: "src/__tests__/security-packet-date-drift.test.ts", batch: "M-0943", invariant: "security-packet HTML date ↔ security page date parity" },
  { path: "src/__tests__/vercel-cron-limits.test.ts", batch: "Cron", invariant: "vercel.json ≤10 crons with sub-daily allowlist" },
  { path: "src/__tests__/widget-state-no-duplicate-empty.test.ts", batch: "UI", invariant: "EmptyState reuse (no duplicate copy) grep sweep" },
  { path: "src/app/factsheet/[id]/v2/factsheet-context.codec.test.ts", batch: "B7c", invariant: "factsheet view-state codec byte-compat + poison-strip" },
  { path: "src/app/(dashboard)/allocations/context/TweaksContext.codec.test.ts", batch: "B7", invariant: "tweaks codec byte-compat + poison-strip" },
  { path: "src/lib/sample-floor.test.ts", batch: "Phase22", invariant: "SAMPLE_FLOOR_OVERLAPPING_DAYS=60 + gate branch behavior (HONEST-02 single source)" },
  { path: "src/lib/seam-constants.pin.test.ts", batch: "140.2", invariant: "seam core tuning values pinned to hand-typed literals: 13 SEAM_BUDGETS timeoutMs + the SeamBudgetKey SET (sorted equality, not length) + all 6 breaker constants + the A-14 cooldown>=window ordering + the two fake<->production literal pins (FAKE_THRESHOLD<->BREAKER_FAILURE_THRESHOLD, FAKE_WINDOW_MS<->BREAKER_WINDOW)" },
  { path: "src/lib/seam-budgets.invariant.test.ts", batch: "140.2", invariant: "SEAM_ROUTE_BUDGETS row CONTENTS deep-compared to a hand-typed 15-row map (catches a dropped leg from a multi-leg row, which SC-4a/SC-4b cannot see) + on-disk maxDuration parity + the 3-path SEAM_EXCLUSIONS set + the A-12 warmer-exclusion source scan (no excluded path may import or call the core) with both /health warmers pinned as MEMBERS. SC-4b sums within a `branch` and takes the MAXIMUM across branches, because finalize-wizard's composite and single-key paths are mutually exclusive and a sum describes a path no request takes; SC-4e then binds the declared composite `calls` to `MAX_COMPOSITE_MEMBERS` read from the ROUTE FILE on disk (a Next route cannot export it), so raising the fan-out cap without raising the declaration reddens instead of silently certifying headroom the route no longer has" },
  { path: "src/lib/seam-errors.purity.test.ts", batch: "140.2", invariant: "the seam error leaf stays dependency-free: no import / no `export ... from` / no require() / no process.env in src/lib/seam-errors.ts (comment-stripped + anchored source scan), its exported class set pinned as a hand-typed SET, and CircuitOpenError's message pinned as a static string across two retry hints (T-140-05: the public teaser reaches the seam)" },
  { path: "src/lib/seam-discriminator.purity.test.ts", batch: "140.2", invariant: "the seam DISCRIMINATOR leaf stays dependency-free: no import / no `export ... from` / no require() / no process.env in src/lib/seam-discriminator.ts (comment-stripped + anchored source scan), plus its exported surface pinned as a hand-typed SET equal to the guard's own `EXPECTED_EXPORTS` — the `seam*` reader functions `seamBreakerVerdict` / `seamCorrelationId` / `seamDependencyName` / `seamErrorCode` / `seamHumanMessage` (140.5-08 correction: this note read 'exactly three predicates' and the leaf exports five — `grep -c '^export function' src/lib/seam-discriminator.ts` = 5; the pinned SET is named rather than counted). The closed service-dependency vocabulary and the global-key literal are deliberately NOT exported, because the verdict function must stay the ONE key builder (T-140-01)" },
  { path: "src/lib/seam-discriminator.test.ts", batch: "140.2 / SEAMCORE-01", invariant: "the status->breaker-verdict table (ROADMAP SC2), every expectation hand-typed: CALLER (400/401/403/404/422) and CALLER-THROTTLED (429 in all three coexisting wire shapes) and CALLER'S EXCHANGE (424) each record ZERO; SERVICE-PERMANENT (500) records ZERO INCLUDING the bodyless text/plain shape Starlette's ServerErrorMiddleware emits (TRAP-2); SERVICE-TRANSIENT (503) records ONE keyed on its named dependency. Every row is driven TWICE — with its body and with NO body argument — which is what pins that counts/does-not-count is decidable from the status line alone. Plus the T-140-01 half: a 424's venue slug never becomes a key for any venue, an unrecognised or non-string dependency falls back to the global key with a loud diagnostic, and two different dependencies produce two DIFFERENT keys (the leaf-level precondition for OB-8). Code/human extraction branches on `typeof body.detail` per STATUS_CONTRACT 2.1 — reading `body.detail.code` unconditionally regresses both FLAT shapes to UNKNOWN, which is the dead end PYAPIFIX2-01 exists to kill, reintroduced at the consuming layer (ledger row M25)" },
  { path: "src/lib/tenant-claim.test.ts", batch: "140.2 / TS-04", invariant: "the ONE X-Tenant-Claim mint (ROADMAP SC7): wire format `<payload>.<exp>.<hex-hmac-sha256>` with every expected MAC recomputed IN-TEST via node:crypto and never imported from the module under test; the 300s TTL hand-typed and asserted against a STUBBED clock (clock stubbed, crypto real); an EXACT claim string under a fixed clock; two payloads on one clock+secret producing two different MACs; the same payload under two secrets producing two different MACs (the M44 shape - the wrong env secret still yields a syntactically perfect claim and fails compare_digest SILENTLY); and the four fail-loud refusals (empty payload, whitespace-only payload, dot-containing payload, absent/empty secret) each as a named TenantClaimError whose message never echoes the secret. Plus the committed cross-language case table `tests/fixtures/tenant-claim-parity.json` read BOTH ways - round-tripped through the shipped mint under a fixed clock, and self-checked against an independently computed HMAC so a hand-edited fixture cannot turn the round-trip into a pin on a typo - with a non-empty-cases guard, because a silently emptied fixture makes every it.each vacuously pass. Ledger rows M28/M44/M45/M46. The Python reader for the same fixture is OWED (140.1-TS-OBLIGATIONS TS-36, owner 146)." },
  // The plugin's RuleTester fixtures are guards in their own right, and this
  // one was silently deletable: with the file moved away, the whole contracts
  // suite and `npm run lint` stayed green (observed in 140.2-04). The rule
  // itself is pinned three ways below/above (rule-set equality, resolved
  // severity, frozen allowlist) — none of which notices that the ONLY artifact
  // asserting what the rule actually CATCHES has gone. Registered for SEAM-01
  // because this phase owns it; the other eight rules' fixture files are in the
  // same unregistered state and are not this phase's to claim.
  { path: "tools/eslint-plugin-quantalyze/tests/no-raw-analytics-fetch.test.ts", batch: "140.2 / SEAM-01", invariant: "RuleTester fixtures pinning WHAT no-raw-analytics-fetch catches: one invalid fixture per documented URL shape (inline template; one binding; an aliased template; an aliased `new URL(path, base)`), the inline-`new URL()` regression, a TWO-HOP declaration-order case pinning that the fixed point resolves at Program:exit, and the two /health warmers' exact `${url.replace(/\\/+$/, \"\")}/health` shape — pinned here because the four-path allowlist makes the rule's verdict on that shape invisible in the real files. Plus TWO discriminators, one per detection property: 'renamed binding' (the rule is init-tracking, not name-matching) and an untainted two-hop alias structurally identical to shape 3 (the fixed point's seed is still the analytics env member, not any binding called `url`). Ledger row M57's targets are the shape-3 and shape-4 fixtures." },
  { path: "src/lib/seam-redaction.test.ts", batch: "140.2 / SEAMCORE-06", invariant: "the redaction leaf, asserted in BOTH directions on ONE realistic undici message: every secret gone AND the ECONNREFUSED syscall token intact. Plus the short-secret REFUSAL (a candidate below MIN_REDACTABLE_SECRET_LENGTH is not substring-replaced, and the refusal is signalled in the line — ledger row M33 lowers that constant and only the preserve side sees it), the preserve-collision signal, the error-NAME shape undici produces, the cause chain SeamBodyReadError attaches since 140.2-05, and the non-Error / circular / hostile-toString inputs (a scrubber that throws runs inside a catch block and would replace the real error with a bookkeeping one). Plus the leaf-purity half: no import, no `export … from`, no require(), and process.env read at CALL time rather than captured at module scope. Every secret value, preserve token and list member hand-typed in the test" },
  { path: "src/lib/seam-log-coverage.test.ts", batch: "140.2 / SEAMCORE-06", invariant: "no console.error/warn in any seam file passes a bare caught identifier or a bare error-shaped binding (the Supabase `*Err` half). The roster is DERIVED from the import edge (`SEAM_FILES` = the hand-typed lib half + `deriveSeamRouteFiles`, mirrored by `EXPECTED_SEAM_FILES`) — 140.5-08 correction: this note read 'the six seam files' and the derivation made it nineteen (4 lib + 15 routes); the roster is named rather than counted, and NOT 'corrected' to another integer (CONTEXT §6b: eight was the pre-140.4-10 figure). Comment-stripped, string-literal-masked (a message containing the word `error` is prose, but `${err}` inside a template interpolation is a reference), quote-aware balanced-paren argument extraction. Allowlist is by REASON, not convenience: scrubSeamError/scrubSeamString wrapping, plus `.retryAfterS`, `.deadlineExceeded` and `.code` — non-string facts from types we define. Carries its own positive control, negative control and a fail-loud lower bound on sites scanned, because a guard asserting an ABSENCE reads as protection while doing nothing if its scanner breaks. Ledger row M42" },
  { path: "src/lib/resilient-fetch.wiring.test.ts", batch: "140.2", invariant: "the 13 budget-key BINDINGS (not the 5 lexical call sites) each pinned to a hand-typed key+path literal, plus the completeness MECHANISM: three families discovered from disk and compared as a SET against a hand-typed 13-member roster, so a 14th binding REUSING an existing key fails even though it breaks no individual pin" },
  // Phase 140.3's three source pins plus its runtime guard. Measured at gap
  // closure (plan 140.3-G1): all four were silently deletable — CI stayed green
  // with any of them moved away, which is the exact silent-reintroduction gap
  // this registry exists to close and which 140.2-04 had already observed once.
  { path: "src/lib/seam-copy.pin.test.ts", batch: "140.3-G1", invariant: "the seam's USER-FACING COPY pinned to hand-typed strings: what a person actually reads when the analytics service is down, degraded or throttled. A copy guard is the only kind of guard a passing route test cannot supply — a route can return the right code with the wrong sentence, and the wrong sentence is the whole product surface of an outage. Registered at 140.3 gap closure because it was deletable with green CI" },
  { path: "src/lib/seam-poll-disjointness.pin.test.ts", batch: "140.3-G1", invariant: "SOURCE BACKSTOP for the wizard sync-poll: an INVERTED allow-list of every /api/ URL the three poll modules may name, each entry's seam-ness hand-typed AND independently re-checked against the seam-route set derived from src/app/api by import edge — so the tick's target acquiring a seam import reddens even though no URL literal changed. Plus a fail-loud CALL_EDGE yield bound and a six-slot needle self-test. ⚠️ RE-TIERED at gap closure: this file previously asserted 'ZERO fetch calls exist on the poll path', which was FALSE at file granularity — SyncPreviewStep.tsx makes three real calls, two to the seam route /api/keys/sync, and the guard stayed green because its needle was /\\bfetch\\s*\\(/ while every call is spelled wizardFetch(. Broadening the needle cannot repair that (the file-scoped claim is simply untrue); the tick-scoped property moved to a runtime guard and this file was narrowed to a claim that is checkable. It is KEPT rather than deleted because it covers the two roster modules the runtime guard does not render" },
  { path: "src/lib/seam-ssr-exposure.pin.test.ts", batch: "140.3-G1", invariant: "ZERO server directives under src/ and no server-rendered module outside src/app/api/ imports a seam client — the single reason a breaker trip can never 500 a page: every seam call happens in a route handler or a browser component, so the shell still renders and the failure surfaces as a sentence with a retry. Needles are ASSEMBLED at runtime so the file never contains the directive it forbids (a guard that plants the string it bans makes the repo-wide acceptance grep return 1 forever). Registered at 140.3 gap closure because it was deletable with green CI" },
  { path: "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.poll-disjointness.runtime.test.tsx", batch: "140.3-G1", invariant: "RUNTIME, TICK-SCOPED retry-storm fence, and the load-bearing half of the re-tiering above. Spies on globalThis.fetch — which every wrapper ultimately reaches, since wizardFetch's body calls the UNQUALIFIED global — so it is indirection-proof by construction in a way no source needle can be. Splits the render at a runtime mark: the user-initiated kickoff MAY call the seam (and does, /api/keys/sync), the repeating tick MAY NOT, and tick-ness is a fact about when a callback fires rather than about which file a call site sits in. Seam-route set derived from disk and matched SEGMENT-WISE, so /api/keys/syncing is not /api/keys/sync and the live tick target /api/strategies/[id]/sync-progress stays a near-miss negative. Carries a POSITIVE control (a tick call must fire) because a dead poll and a safe poll both produce 'no seam call' — the M77c shape — falsified by ledger row M86b" },
  // ─────────────────────────────────────────────────────────────────────────
  // Phase 140.4 / SEAMRIM — the four guards the end-of-milestone review found
  // UNREGISTERED, plus every TS-side guard this phase created.
  //
  // ⚠️ THE FIRST FOUR ARE A FLOOR, NOT A POPULATION, and this comment is the
  // honest limit of the claim. The review reached "16 unregistered
  // guard-shaped files" from a filename census, and TWO of the four below —
  // `sentry-capture.test.ts` and `validate-key-venue-transient-parity.test.ts`
  // — match NO naming convention at all. They were found by knowing which file
  // was a property's sole asserter, which is not a search anyone can repeat
  // mechanically. So this block closes named instances; it does NOT close the
  // class, and nothing here should be read as claiming it does.
  //
  // ⚠️ AND `analytics-service/tests/test_raw_5xx_census.py` (plan 140.4-04) is
  // NOT here, deliberately. Every path in this array is TS-side and the runner
  // is vitest; forcing a Python path in would make `existsSync` pass while no
  // vitest run ever touches it. Same for plan 140.4-03's
  // `supabase/tests/test_csv_finalize_double_submit.sql`, which runs in the
  // psql lane. Both are recorded as residuals in 140.4-10-SUMMARY.md rather
  // than smuggled into a registry that cannot execute them.
  // ─────────────────────────────────────────────────────────────────────────
  { path: "src/lib/seam-copy.purity.test.ts", batch: "140.4-10 / SEAMUX-01", invariant: "src/lib/seam-copy.ts stays a dependency-free leaf AND stays a table of plain string CONSTANTS: comment-stripped, anchored source scan asserting no import, no `export … from` re-export, no require() and no process.env read, plus a hand-typed SET equality over its exported names and an assertion that every export is a string rather than a function. The purity is load-bearing because the copy is value-imported by client components, so a dependency edge here ships a server module to the browser bundle; the string-not-function half is what stops the outage sentence becoming computed at render time, where the seam-copy pin could no longer see it. Registered by 140.4-10 — it was silently deletable with green CI" },
  { path: "src/lib/sentry-capture.test.ts", batch: "140.4-10 / SEAMCORE-06 + SEAMRIM-04", invariant: "captureToSentry SCRUBS BEFORE IT DISPATCHES, asserted on every channel a secret can ride out of the process on: the error MESSAGE, the error NAME and STACK, an explicitly passed PER-REQUEST secret, a SHORT per-request secret (HI-03 — the redaction leaf REFUSES to substring-replace below MIN_REDACTABLE_SECRET_LENGTH, so the short case has to be pinned separately or a 4-character secret leaves for a third party), the CAUSE chain, string values inside `extra`, and a non-Error thrown value. Plus the 140.4-06 half: the function RETURNS its import chain, so `after(captureToSentry(...))` actually observes the capture instead of detaching it (NEW-C10-03), and it RESOLVES rather than rejects when the SDK throws, when the dynamic import rejects, and when a hostile getter in `extra` explodes — a capture helper that throws runs inside a catch block and would replace the caller's real error with a bookkeeping one. Registered by 140.4-10; it matches no naming convention and was found only by knowing it was the sole asserter" },
  { path: "tests/redis/seam-breaker.redis.test.ts", batch: "140.4-10 / SEAMCORE-09", invariant: "the breaker's behaviour against a REAL Upstash instance rather than a fake: the counter identity and namespace (`breaker:<key>:failures:<epoch window>`, ONE counter per breaker key), the trip at EXACTLY the threshold (a literal 4 failures leave no lock, the 5th creates it), trip idempotency (a later trip does not ratchet the first writer's expiry), the encoded cooldown being the lock's life with Retry-After agreeing, sliding-window decay with weighted carry-over, and no counter increment on a DENIED limit. ⚠️ REGISTERED WITH ITS LIMIT STATED: this file runs only under `npm run test:redis`, whose `include` is `tests/redis/**` and which needs a live store — it is NOT in the default vitest run, so registration pins its EXISTENCE, not its execution. D-01, the live-Redis lane, is a KNOWN BLIND SPOT carried by phase 140.4 and no plan may claim it closed" },
  { path: "tests/lib/validate-key-venue-transient-parity.test.ts", batch: "140.4-10 / TS-35", invariant: "the wizard's key-validation classifier agrees with the COMMITTED cross-language venue-transient contract fixture, which reserved this file as its consumer — the assertion that a Python-side classification and a TS-side one cannot drift apart silently. Carries the canonical case roster as a set (no silent shrink), keeps its NEGATIVES (`recoverable` is pinned false somewhere, so it is not a field that is always true — the polarity failure that makes a boolean contract vacuous), asserts every case answers exactly ONE status without asserting WHICH, pins the single permitted divergence as the one that is actually there rather than as a general tolerance, and re-checks that the surviving substring cascade classifies the same bytes when no code rides along. Registered by 140.4-10; it matches no naming convention" },
  { path: "src/components/ui/LiveRegion.test.tsx", batch: "140.4-05 / SEAMRIM-10", invariant: "the announcement primitive this phase created, pinned in BOTH polarities and for visual inertness. assertive ⇒ `role=alert` + `aria-live=assertive`; non-assertive ⇒ `role=status` + `aria-live=polite`; the message is carried in both; the region renders even when the message is null (a live region that is mounted only when it has something to say is announced by nothing, because the AT has no region to watch). The INERTNESS assertion is the load-bearing one: `className` is EXACTLY `sr-only` in both polarities, because the whole reason this primitive exists rather than a DESIGN.md change is that it closes the a11y class WITHOUT touching a founder-owned visual decision — ledger row M107 adds one utility class to it and the naive `grep -c 'className=\"sr-only\"' → 1` receipt passes under that mutation" },
  { path: "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.readfailure.runtime.test.tsx", batch: "140.4-02 / SEAMRIM-02", invariant: "RUNTIME proof that a read FAILURE is never rendered as a MEASUREMENT — the C-3 defect, which was re-graded UP because it was demonstrated by rendering: supabase-js RESOLVES rather than throws, so a read-failed account and a genuinely-empty one produced BYTE-IDENTICAL DOM (\"We found only 0 filled trade(s) on this key\"), and the under-pled half was worse — a 2-day strategy correctly blocked as INSUFFICIENT_DAYS became `passed: true` when the timestamp reads failed, publishing an under-history track record as verified. Drives each of the reads independently, INCLUDING the second member (`earliest`) so an instance-fix cannot masquerade as a class-fix, carries the POSITIVE COUNTERPART (a genuinely empty account must still render the measured-zero sentence — without it, deleting the sentence entirely would pass), asserts the PROPERTY rather than an instance (read-failed and empty render DIFFERENT DOM), pins the three-failure escalation to the recoverable SYNC_FAILED surface, pins that a keyless draft still reaches a verdict, and pins that the failed read is LOGGED so the escalation is diagnosable" },
  { path: "tools/eslint-plugin-quantalyze/tests/no-unchecked-supabase-read.test.ts", batch: "140.4-14 / SEAMRIM-11", invariant: "the RuleTester fixtures pinning WHAT `no-unchecked-supabase-read` catches, as opposed to that it exists and resolves to a level — the same silent-deletability that 140.2-04 found in the sibling fixture file, where moving it away left the whole contracts suite and `npm run lint` green. Covers BOTH destructure forms: the object form (`const { data } = await q()`) and the `Promise.all` ARRAY form. The array half is the load-bearing one — an object-only predicate returns ZERO on the array form, which is exactly how C-3 survived every prior census, and it is the shape ledger row M106 mutates" },
  { path: "src/lib/seam-ratelimit-posture.invariant.test.ts", batch: "140.4-13", invariant: "A limiter MISCONFIGURATION answers 503 on every seam route, never a 429 that reads as the caller being throttled. Two halves, with different reach and the file says so. STRUCTURAL (all 15 routes, population DERIVED from src/app/api by import edge on every run): partitions the seam into limiter/no-limiter, pins the limiter set against a hand-typed roster so a new seam route fails BY NAME, and asserts chokepoint-routed deny arms >= checkLimit sites PER ROUTE — per ARM, not per file, because keys/sync has TWO and a file-level 'does it mention rateLimitDenyJson' check stays green with the second reverted (this plan's ledger row M105 runs exactly that mutation). The no-limiter set is an EQUALITY against {admin/match/eval} so a future repair must shrink the quarantine in the same commit rather than leave a stale exemption. Comment-stripped before counting, which is load-bearing here and not cosmetic: admin/match/eval and admin/match/recompute BOTH mention rateLimitDenyJson in PROSE, so a line-based grep (DEF-16-2) reads the no-limiter route as adopting the chokepoint and reports the class closed while it is open — self-tested in both polarities including that exact comment shape and the two-arm/one-routed-arm shape. Carries a vacuity fence (>=15 routes, >=12 checkLimit sites) because a scanner that matches nothing reports agreement forever. BEHAVIOURAL (3 of 15, spanning the auth shapes — public verify-strategy, authenticated keys/sync at BOTH arms, admin match/recompute): drives real handlers with vi.spyOn on the REAL ratelimit module, so the deny builder under test is production's and cannot drift from a double, and proves the 503 actually reaches the wire rather than merely appearing in source. A full 15-route behavioural table is deliberately NOT attempted — each route needs its own auth/body/downstream fixture, so fifteen bespoke stacks would each be free to drift; the remaining twelve are covered structurally here and behaviourally in their own route.test.ts files" },
  // ─────────────────────────────────────────────────────────────────────────
  // Phase 140.5 / SEAMPROSE — the five guards this phase created, each named in
  // an earlier plan's `## OPEN` as owed-to-140.5-08. Registered here WITH the
  // floor bumped in the same commit (the self-comparing-floor hazard: the floor
  // must be a hand-typed literal, never CONTRACT_GUARDS.length).
  // ─────────────────────────────────────────────────────────────────────────
  { path: "src/lib/seam-venue-vocabulary.invariant.test.ts", batch: "140.5-02 / SEAMPROSE-05", invariant: "the Python EMITTER's venue error_code vocabulary agrees with the TS disposition table `VENUE_WIRE_CODE_TO_VERDICT` (`wizardErrors.ts`): the emitted codes are DERIVED from `analytics-service/**/*.py` (comment-stripped) minus three recorded `SCAN_EXCLUSIONS`, under TWO shapes — every assignment to `error_code`, AND every call to a `CALLEE_ARG_SLOT` member (`service_error`, `service_error_response`, `service_error_body`, and `VenueTransientHTTPException`'s `code=` keyword), each read at THAT callee's own argument slot — and compared as a SET against the hand-typed dispositions, so a new emitted code fails BY NAME and a departed one reds too. ⚠️ RE-CUT AT 153.7-01 / WIZFORM-02-CLASS: the root was `services/**` and the shape was assignments only, which made `routers/exchange.py` invisible on BOTH counts and let a server-classified failure reach a user as `code: UNKNOWN` while this guard stayed green. The population went 17 → 37 codes; the root move contributed ZERO of them, so the shape widening is the whole delta. ⚠️ DECLARED BLIND SPOT, asserted not narrated: `csv_adapter.py`'s dynamic `error_code = first_rule.upper()` family cannot be statically enumerated (pandera rule names read at runtime), so the literal-less emitter sites are pinned by FILE→COUNT — a SECOND dynamic emitter appearing anywhere reds instead of silently shrinking the population. Their disposition is by-family (CSV-surface codes render through `CsvValidationEnvelope`, never reaching the classifier). Registered by 140.5-08" },
  { path: "src/lib/seam-transport-attribution.invariant.test.ts", batch: "140.5-03 / SEAMPROSE-03", invariant: "every wizard TRANSPORT catch (a thrown fetch — our own hop failing, not a venue fault) attributes to `SERVICE_UNREACHABLE`, never a `KEY_*` venue-fault code; the population is DERIVED from the wizard step files so a new catch reds BY SITE (it names `MultiKeyConnectStep`'s 4th/5th catches, which no prior count reached). ⚠️ PARTIAL BY CONSTRUCTION: it covers the CATCH half only. The `Retry-After` wait-threading it accompanies is coverage-law ROW 3 and NOTHING guards its completeness — a sixth `buildEnvelope` surface that forgets to read the header gets no wait and no test fails; `composite/members`' `WIZARD_KEYS_LOAD_FAILED` site is structurally excluded because that route has no `Retry-After` producer. Registered by 140.5-08" },
  { path: "src/lib/seam-wire-vocabulary.invariant.test.ts", batch: "140.5-05 / SEAMPROSE-08", invariant: "TWO properties closing the §6 hand-off-hole class at row 1. (1) HAND-OFF: every wizard client that POSTs a `rateLimitDenyJson` route consults `recogniseSeamErrorCode` — `CsvUploadStep`/`CsvSubmitStep` were the 4-of-6 hole that rendered a forwarded 401 as 'Validation failed. See per-row breakdown below.' The route population is DERIVED from `src/app/api` by the `rateLimitDenyJson` call edge; the client side is an inverted allow-list; comment-stripped because four wizard files name the hop in PROSE (DEF-16-2). (2) AGREEMENT (never disjointness — §5's correction): where a `KNOWN_*` roster and `SEAM_CODE_TO_WIZARD_CODE` overlap they must answer the SAME code (the vocabularies overlap at `{RATE_LIMITED}` and `{SEAM_MISCONFIGURED}`). ⚠️ PARTIAL: routes throttling only through `checkLimit`/`withAuthLimited` (e.g. `finalize-wizard` / `SubmitStep`) are outside the `rateLimitDenyJson`-derived population — widening is a one-line change to the DENY_CALL needle plus a re-measured floor. Registered by 140.5-08" },
  { path: "src/__tests__/contracts/spec-disabling.invariant.test.ts", batch: "140.5-06 / SEAMPROSE-04 (WP-12)", invariant: "NO SPEC IS SILENTLY DISABLED — no test file in `e2e/`, `src/`, `tests/` disables a spec unconditionally (the literal-true and no-argument skip forms, the ONLY/FIXME/TODO forms, xit/xdescribe, and their prettier-wrapped multi-line variants — the needle table names each; this note deliberately avoids writing the exact tokens, since the guard scans string literals too). ROW 1: population WALKED FROM DISK every run, so a spec added tomorrow is covered without editing this file. WHOLE-FILE / comment-stripped via `stripCommentsPreserveLines` — the load-bearing half: `ci.yml`'s line-based grep reddens a CLEAN tree today on one hit that is a COMMENT (`ResponsiveChartFrame.test.tsx`), DEF-16-2 inside the very mechanism, and bash cannot comment-strip maintainably; that grep is deliberately left narrow and this guard subsumes its intent. Both-polarity self-tests incl. the specimen where a disabling token sits inside a COMMENT and must NOT trip. ⚠️ The one hand-typed list is the EXEMPT ledger, length pinned as a DECISION (row 2 for exemptions); `e2e/strategy-v2-keyboard.spec.ts`'s allow-listed skip is a PR #108 follow-up. Registered by 140.5-08" },
  { path: "src/lib/seam-citations.invariant.test.ts", batch: "140.5-08 / SEAMPROSE-01", invariant: "no bare `file:line` citation (census variants A/B/C: `path.ext:NN`, ranges, lists) in any comment across the 34-file ratified seam surface — the coordinate form goes stale the instant the target file grows a line, which bit this milestone eight times; the fix is a SYMBOL-anchored reference. ROW 1 ON THE SEAM SURFACE, explicitly NOT a repo-wide closure (founder §4b) — widening is appending to `SEAM_CITATION_SURFACE`. Mechanism is a FORM-BAN, not past-EOF: measured 0 of 51 past-EOF on this surface, so a past-EOF guard is VACUOUS here. Uses `extractComments` (the INVERSE of the log guard's strip — a citation lives INSIDE a comment) so offences carry the real line; allowlist frozen at ONE out-of-repo `@upstash/ratelimit` dist reference with a reason; both-polarity needle self-tests end-to-end; vacuity fences on file count (34) and comment-line floor. ⚠️ PARTIAL BY CONSTRUCTION for the self-relative forms (variants D/E/F — `line 55`, `(:1027)`, `at line 67`), which need a second predicate; `.planning/**` permanently excluded (a frozen record). Registered by 140.5-08" },
  // Check scripts (run as CI gates, not vitest):
  { path: "scripts/check-admin-route-manifest.ts", batch: "C-0153", invariant: "ADMIN_ROUTE_MANIFEST ↔ admin route files completeness (lint gate)" },
  { path: "scripts/check-route-contract.ts", batch: "NAV-03", invariant: "ROUTE_CONTRACT_MANIFEST ↔ PUBLIC_ROUTES + redirects() lockstep (the #512 class, lint gate)" },
  { path: "scripts/check-gdpr-export-coverage.ts", batch: "GDPR", invariant: "all user-owned tables declared in the export manifest (CI gate)" },
];

describe("[B25] contracts registry — by-construction invariant guards", () => {
  it("registers a non-trivial set (fail-loud on accidental truncation)", () => {
    // ⚠️ RAISED 20 → 52 BY PLAN 140.4-10, AND THE OLD NUMBER IS WHY. The floor
    // was 20 against 44 real rows, so TWENTY-FOUR ROWS WERE DELETABLE WITH
    // GREEN CI — in a file whose entire purpose is that a guard cannot be
    // deleted with green CI.
    //
    // THE COUNT, WITH THE PREDICATE THAT PRODUCED IT (140.4-16 / WR-01 — this
    // paragraph said "51 … (44 + 7)" while the assertion below said 52, in the
    // one artefact this phase raised specifically to close numeric slack):
    //
    //   $ grep -c '^  { path:' src/__tests__/contracts/contracts-registry.test.ts
    //   52                                   # at HEAD
    //   $ git show a77d607e:… | grep -c '^  { path:'
    //   44                                   # at the phase base
    //
    // 44 + 8 = 52. EIGHT rows were added, not seven. Quote the predicate beside
    // any number you write here — a bare integer is unowned by construction
    // (Oracle Independence hazard #9), which is exactly how this one drifted.
    //
    // ── 140.5-08 — RAISED 52 → 57. FIVE guards this phase created were named in
    // earlier plans' `## OPEN` as owed-to-08 and are registered above in the same
    // commit as this bump:
    //   $ grep -c '^  { path:' src/__tests__/contracts/contracts-registry.test.ts
    //   57                                   # at HEAD
    //   $ git show 453b4291:…/contracts-registry.test.ts | grep -c '^  { path:'
    //   52                                   # at the phase base
    // 52 + 5 = 57. The five: seam-venue-vocabulary (02), seam-transport-attribution
    // (03), seam-wire-vocabulary (05), spec-disabling (06), seam-citations (08).
    //
    // ⚠️ THIS CLOSES SLACK, NOT A CLASS. Raising the floor stops rows being
    // dropped silently; it does nothing about guards that were never
    // registered, and the registry is a HAND-TYPED ROSTER — coverage-law row 2,
    // PARTIAL BY CONSTRUCTION.
    //
    // ⚠️ AND IT MUST STAY A HAND-TYPED LITERAL. `toBeGreaterThanOrEqual(
    // CONTRACT_GUARDS.length)` is an assertion that can never fail — Oracle
    // Independence hazard #3, forbidden by 140.3-10 and 140.3-12. When a guard
    // is added, bump this number in the same commit; that bump IS the
    // registration being deliberate.
    expect(
      CONTRACT_GUARDS.length,
      "CONTRACT_GUARDS shrank unexpectedly — did a registry entry get dropped?",
    ).toBeGreaterThanOrEqual(57);
  });

  it.each(CONTRACT_GUARDS)("guard exists: $path [$batch]", ({ path }) => {
    expect(
      existsSync(join(ROOT, path)),
      `Registered contract guard missing: ${path}. If it was intentionally ` +
        `removed/renamed, update this registry + src/__tests__/contracts/REGISTRY.md ` +
        `(do NOT just delete the guard — that re-opens a closed finding-class silently).`,
    ).toBe(true);
  });
});

describe("[B25] eslint-plugin-quantalyze wiring integrity", () => {
  it("plugin exports exactly the expected rule set", () => {
    expect(Object.keys(quantalyzePlugin.rules ?? {}).sort()).toEqual(
      [...EXPECTED_RULES].sort(),
    );
  });

  it('resolves every quantalyze rule to "error" for a representative src file', async () => {
    // Assert the RESOLVED severity, not a config substring: a text match for
    // `"quantalyze/X": "error"` stays green even if a later over-broad
    // `{ files: ["src/**"], rules: { "quantalyze/X": "off" } }` override neuters
    // the rule (flat-config last-match-wins) — the exact silent-reintroduction
    // the capstone exists to close. calculateConfigForFile resolves the effective
    // level for a real, non-exempt src file (also robust to quote reformatting).
    const { ESLint } = await import("eslint");
    const eslint = new ESLint({ cwd: ROOT });
    const resolve = async (file: string, rule: string) => {
      const cfg = await eslint.calculateConfigForFile(file);
      const entry = (cfg.rules ?? {})[`quantalyze/${rule}`];
      return { entry, severity: Array.isArray(entry) ? entry[0] : entry };
    };
    // Repo-wide rules must resolve to "error" for a representative non-exempt src file.
    for (const rule of REPO_WIDE_ERROR_RULES) {
      const { entry, severity } = await resolve("src/lib/visibility.ts", rule);
      expect(
        severity === 2 || severity === "error",
        `quantalyze/${rule} must RESOLVE to "error" for src files (got ${JSON.stringify(entry)}). ` +
          `A missing wiring or an over-broad "off" override silently neuters the by-construction CI teeth.`,
      ).toBe(true);
    }
    // Phase 54 BP-03 — `no-raw-font-px` is now repo-wide error (asserted on
    // visibility.ts by the repo-wide loop above). Here we assert the inverse
    // teeth: it must RESOLVE to a NON-error level on the documented frozen-chart
    // islands (the off-glob exemption), so the carve-out stays real + intentional.
    // A flip to error on a frozen file would red-CI an un-editable FROZEN_ISLANDS
    // file; an over-broad off-glob would silently neuter the repo-wide teeth.
    for (const { rule, file: frozenFile } of FROZEN_EXEMPT) {
      const onFrozen = await resolve(frozenFile, rule);
      expect(
        !(onFrozen.severity === 2 || onFrozen.severity === "error"),
        `quantalyze/${rule} must NOT resolve to "error" on the documented frozen-chart ` +
          `island ${frozenFile} (got ${JSON.stringify(onFrozen.entry)}) — editing a FROZEN_ISLANDS ` +
          `file reds the frozen-spine guard, so it must stay off-globbed (BP-03 exemption).`,
      ).toBe(true);
    }
    // Phase 140 SEAM-01 — the seam allowlist is a CLOSED set of four. Assert
    // both halves: the exemption actually resolves (so the off-glob matches the
    // on-disk path), and the set has not grown (so a lint failure cannot be
    // silenced by widening it instead of routing the call through the core).
    expect(
      SEAM_ALLOWLIST_EXEMPT.length,
      "The no-raw-analytics-fetch allowlist is frozen at four paths (T-140-26). " +
        "A new raw seam fetch means a new call site that belongs in " +
        "resilientFetch() — widening the allowlist re-opens SEAM-01.",
    ).toBe(4);
    for (const { rule, file: allowlisted } of SEAM_ALLOWLIST_EXEMPT) {
      expect(
        existsSync(join(ROOT, allowlisted)),
        `Allowlisted seam file missing: ${allowlisted} — update the allowlist in ` +
          `eslint.config.mjs and SEAM_EXCLUSIONS in src/lib/resilient-fetch.ts together.`,
      ).toBe(true);
      const onAllowlisted = await resolve(allowlisted, rule);
      expect(
        !(onAllowlisted.severity === 2 || onAllowlisted.severity === "error"),
        `quantalyze/${rule} must NOT resolve to "error" on the documented seam ` +
          `exemption ${allowlisted} (got ${JSON.stringify(onAllowlisted.entry)}) — ` +
          `this file legitimately holds the analytics base URL, so an off-glob that ` +
          `stopped matching would red-CI the core itself.`,
      ).toBe(true);
    }
  });

  it("contracts.yml exists and runs the contracts + lint", () => {
    const wf = join(ROOT, ".github/workflows/contracts.yml");
    expect(existsSync(wf), ".github/workflows/contracts.yml missing").toBe(true);
    const src = readFileSync(wf, "utf8");
    expect(src.includes("src/__tests__/contracts/")).toBe(true);
    expect(src.includes("eslint")).toBe(true);
  });
});

# Phase 122: SFOX Add-key UI + e2e - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning
**Mode:** Autonomous (precedent-driven frontend — the deribit Phase-69 card/badge is the exact analog; design contract inline per DESIGN.md)

<domain>
## Phase Boundary

The add-key wizard exposes sFOX in the exchange picker with correct onboarding copy, and a
connected sFOX strategy renders the `api_verified` provenance badge; e2e across all roles.

In scope (SFOX-08, SFOX-09):
- Offer sFOX in the user-facing picker — flip `UI_EXCHANGE_CODES` (src/lib/closed-sets.ts:66) to
  include `sfox` (every chip surface auto-widens via `EXCHANGES`, OQ4) — BUT gated: see the flag decision.
- Onboarding / setup-guide copy: how to mint a READ-ONLY sFOX API token + the whitelist IP (the
  static egress from phase 121). Mirror the deribit `/security#deribit-readonly` scope-guide pattern
  → a `/security#sfox-readonly` section (or the wizard card inline copy).
- The badge: the 3-letter mono exchange tag `SFOX` (DESIGN.md 3-letter, no-emoji — like deribit `DRB`
  in ApiKeyManager.tsx:298) AND the `api_verified` provenance badge (VerifiedBadge / trust-tier pill,
  distinct from `csv`/`self_reported`) on a connected sFOX strategy.
- e2e across ALL roles (allocator / strategy-manager / admin / public-demo) asserting the sFOX
  badge renders on a sFOX strategy (seed fixture owned by the logged-in user).
- Fold in the phase-119 deferred: **F3** (read-only label HONESTY for sfox — the copy must say keys
  are used read-only by our adapter / we cannot PROBE scope, never a false "verified read-only scope"
  claim, since sFOX has no scope endpoint) and **F6** (the allocator client must send/insert the
  CANONICAL LOWERCASE `sfox` — AllocatorExchangeManager.tsx:575 inserts raw `data.exchange`; a
  mixed-case value → DB 23514 after burning a probe).

Out of scope: the sFOX reconstruction correctness (120); the founder egress deploy (121-03).
</domain>

<decisions>
## Implementation Decisions

### Flag-gate the OFFER (honest — the backend is founder-gated end-to-end)
- Unlike deribit (which worked on the existing egress the moment its card shipped), sFOX connects
  need the founder's ops FIRST: the egress deployed + whitelisted (121-03), a validated live flow
  (SFOX-06), and active-account crawl is phase-123-gated (small accounts only until then). So DO NOT
  unconditionally offer sFOX in the default `UI_EXCHANGE_CODES`. Gate it behind a flag (env/config —
  e.g. `NEXT_PUBLIC_SFOX_ENABLED` or a server flag) DEFAULT OFF, so the card/badge/e2e ship READY
  and the founder flips it live after their ops + validation clear. Build everything; expose nothing
  until the flag flips. (If the project has an existing feature-flag pattern, reuse it — don't invent one.)
- The badge + the 3-letter `SFOX` tag ship UNCONDITIONALLY (a connected sfox key must render correctly
  regardless of the offer flag — a founder-connected key exists before the public flag flips).

### Design contract (inline, per DESIGN.md — read it, do not deviate)
- Industrial/utilitarian; "would this survive being printed for an LP?"; minimal, typography+data.
- The exchange tag = Geist Mono, uppercase, 3-letter (`SFOX`), no emoji (like `DRB`).
- The provenance badge = the factsheet provenance-pill posture (a dated/sourced claim). `api_verified`
  is the STRONGEST tier — the pill copy must be honest (from a live API read, un-fabricatable) but NOT
  overclaim scope verification (F3).
- Onboarding copy: DM Sans (interactive voice); the setup steps state their own limits (mint READ-ONLY,
  whitelist the egress IP, note we cannot probe scope).

### Claude's Discretion
- The exact flag mechanism (reuse the project's existing flag pattern if one exists).
- Whether the setup guide is a `/security#sfox-readonly` page section (deribit precedent) or wizard-inline.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/closed-sets.ts` — `UI_EXCHANGE_CODES` (:66, flip w/ the flag), `EXCHANGE_DISPLAY` (:48, sfox
  already present), `EXCHANGES` (:101, auto-derives). `satisfies` makes a missing label a compile error.
- `src/components/strategy/ApiKeyManager.tsx` — `exchangeIcon` badge map (:290, add `sfox: "SFOX"`; deribit
  `DRB` precedent :298); the connected-key row render.
- `src/components/strategy/ApiKeyForm.tsx` — the wizard picker + per-exchange copy (deribit precedent).
- `src/components/ui/VerifiedBadge.tsx` — the trust-tier/provenance badge (api_verified vs self_reported).
- `src/components/exchanges/AllocatorExchangeManager.tsx:575` — the raw-exchange insert (F6 fix here).
- e2e precedents: `e2e/api-key-flow.spec.ts`, `e2e/composite-onboarding.spec.ts`, `e2e/wizard-axe.spec.ts`.

### Established Patterns
- `UI_EXCHANGE_CODES` decoupled from `SUPPORTED_EXCHANGES` (per-phase conscious widening — deribit Phase 69).
- 3-letter mono exchange tags, no emoji (DESIGN.md). e2e seed fixtures owned by the logged-in user; all roles.
- Local vitest flakes → `--no-file-parallelism`; react-hooks lint via `npm run lint` pre-push.

### Integration Points
- Flip `UI_EXCHANGE_CODES` behind the flag → every chip surface auto-widens (MandateForm/StrategyFilters/
  PreferencesPanel/ApiKeyForm/StrategyForm/MetadataStep) with zero edits (OQ4).
</code_context>

<specifics>
## Specific Ideas

- The whitelist-IP copy references the phase-121 STATIC EGRESS ip (the founder fills the actual value;
  the copy can point to the setup guide / a placeholder the founder sets, not a hardcoded IP).
- Honest read-only copy (F3): "sFOX keys are used read-only by our adapter (no order/withdraw path
  exists); sFOX does not expose a per-key scope endpoint, so mint a READ-ONLY token."
</specifics>

<deferred>
## Deferred Ideas

- The founder flips the offer flag live after 121-03 + SFOX-06 validate (+ 123 for active accounts).
- The sFOX reconstruction correctness + charge/credit evidence (120/founder).
</deferred>

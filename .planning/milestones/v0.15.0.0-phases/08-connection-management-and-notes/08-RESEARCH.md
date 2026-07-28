# Phase 08: Connection Management and Notes — Research

**Researched:** 2026-04-21
**Domain:** Multi-scope note capability + connection-management polish on top of Phase 06 ingestion + Phase 07 tabbed dashboard
**Confidence:** HIGH

## Summary

Phase 08 is a surgical extension of shipped Sprint 9 infrastructure. The connection surface (`/profile?tab=exchanges`) already ships Remove-key + cascade RPC (migration 069); Phase 08 reframes the button as "Disconnect" and **reverses** the cascade-checkbox default from required-to-proceed to **unchecked + optional**. The `user_notes` table (migration 037) reshapes via migration 071 to `(user_id, scope_kind, scope_ref)` with four scopes; rendering gains markdown via `react-markdown@10.1.0` + `rehype-sanitize@6.0.0` + `remark-gfm@4.0.1`. Every note surface shares `useNoteAutoSave` (on-blur) + `NoteSaveStatus` (aria-live), cloned from Phase 02's mandate pattern.

Two findings materially simplify the plan vs. what CONTEXT.md anticipated:
1. **Zero Sprint-3 global notes exist in production** (verified via REST count query): migration 071 can drop `portfolio_id IS NULL` rows outright — no `scope_ref='global'` sentinel needed.
2. **No production holdings table renders `allocator_holdings` yet** — the dashboard uses `holdingsSummary` (a query-layer projection) but the UI surface for rendering those rows is Phase 08's responsibility. Revoked-key UI (D-05) is net-new rendering, not modification.

Two findings correct assumptions in CONTEXT.md:
1. **`match_strategies` / `verified_strategies` tables do not exist.** Strategy identity at `/strategy/[id]` is `strategies.id` (published strategies). D-18 should treat `scope_ref = strategies.id`.
2. **Holding symbols never contain `/` or `:`.** The Phase 06 worker strips CCXT symbols to `BTCUSDT`/`BTC` before insert. CONTEXT.md's example `okx:BTC/USDT:USDT:derivative` is inaccurate; real shape is `okx:BTCUSDT:derivative` — parser is a simple 3-part split on `:`.

**Primary recommendation:** Land Plan 1 (migration 071 + /api/notes rewrite + ADR sync + RLS matrix test) as a single atomic commit, then Plans 2→4 in the indicative order. Pin markdown deps at exact versions with `--save-exact` for supply-chain rigor.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Note content storage + query | Database / Storage | — | `user_notes` table, RLS owner-only, UNIQUE index is the idempotent-upsert anchor |
| Per-scope ownership check | API / Backend | — | `/api/notes` PATCH — app-layer per D-09; not a SECURITY DEFINER RPC because the check shape varies per scope_kind |
| Markdown sanitization + render | Browser / Client | — | `react-markdown` + `rehype-sanitize` run client-side; storage stays plain text |
| On-blur autosave | Browser / Client | API / Backend | Client hook fires `PATCH /api/notes` on textarea blur; backend is single upsert |
| Audit emission | API / Backend | Database / Storage | `logAuditEvent` helper → `log_audit_event` RPC (SECURITY DEFINER) writes `audit_log` |
| Disconnect + cascade | Browser / Client | Database / Storage | Modal client state → `delete_allocator_api_key(p_cascade_holdings)` RPC (migration 069, unchanged) |
| Revoked-holdings UI toggle | Browser / Client | — | `localStorage` only; no DB state; affects rendering only, not computation |
| Revoked-holdings historical inclusion | Database / Storage | API / Backend | Inclusive by design — no code change needed; all historical queries already include revoked rows |
| GDPR manifest coverage | CI / Static | Database / Storage | `scripts/check-gdpr-export-coverage.ts` greps migrations; `user_notes` entry survives reshape |

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 … D-24)

Research treats these as invariant:

- **D-01**: Canonical surface = `/profile?tab=exchanges`. No `/connections` route. Update MANAGE-01/02/03 wording at phase commit.
- **D-02**: Rename "Remove key" → "Disconnect" + cascade checkbox **default UNCHECKED**. Reuse migration 069 RPC verbatim.
- **D-03**: User-initiated soft Revoke is NOT shipping in Phase 08.
- **D-04**: Revoked-key holdings ALWAYS included in historical performance (KPIs, equity curve, drawdown, cron).
- **D-05**: Strikethrough + amber "Key revoked" chip + `localStorage`-persisted current-view toggle (default ON); toggle is UI-only, never filters metrics.
- **D-06**: No connection-health card, no per-key rename, no "sync all" button.
- **D-07**: Migration 071 reshapes `user_notes` → `(user_id, scope_kind, scope_ref)`. Drop `portfolio_id` column.
- **D-08**: scope_ref formats: portfolio=UUID, holding=`{venue}:{symbol}:{holding_type}`, bridge_outcome=UUID, strategy=UUID.
- **D-09**: App-layer ownership checks in `/api/notes` PATCH, per-scope.
- **D-10**: One note per `(user_id, scope_kind, scope_ref)` — UNIQUE index + ON-CONFLICT upsert.
- **D-11**: Storage = plain text. Render = markdown (read-only). New deps: `react-markdown`, `rehype-sanitize`, `remark-gfm`.
- **D-12**: 100KB per-note cap retained.
- **D-13**: Sanitization via `rehype-sanitize` default schema. Allow headings/paragraphs/lists/bold/italic/code/pre/blockquote/hr/tables(GFM)/`<a href=^https?://>`/`<strike>`/`<del>`. Disallow script/iframe/img/on*/javascript:/inline-style.
- **D-14**: Owner-only RLS. No admin tier.
- **D-15**: Portfolio note = NotesWidget upgraded in place.
- **D-16**: Holding note = inline expandable sub-row; note icon column (leading or trailing — researcher recommends trailing, see Research Finding #7).
- **D-17**: Bridge-outcome note = expandable inside OutcomesWidget row.
- **D-18**: Strategy note = card on `/strategy/[id]`. Research Finding #3: scope_ref = `strategies.id`.
- **D-19**: On-blur autosave; new shared hook `useNoteAutoSave`; new `NoteSaveStatus` component.
- **D-20**: Four new audit kinds (`user_note.portfolio.update`, `user_note.holding.update`, `user_note.bridge_outcome.update`, `user_note.strategy.update`). **Replaces** `portfolio_note.update`.
- **D-21**: Audit fires on every successful PATCH.
- **D-22**: Single migration `071_user_notes_multiscope.sql`, self-verifying DO block.
- **D-23**: ADR-0023 sync in the same commit as `/api/notes` rewrite.
- **D-24**: Indicative 4 plans; planner may re-partition.

### Claude's Discretion

Research resolves the 11 open items flagged in CONTEXT.md §Claude's Discretion and the orchestrator task. All resolutions are below in §Research Findings.

### Deferred Ideas (OUT OF SCOPE)

- User-initiated soft Revoke action
- Per-key rename / `api_keys.label` column
- Connection-health summary card
- `/notes` index page / journal UX
- Multi-note threads per scope; note version history; append-only `user_notes_history`
- Admin-readable notes (three-tier RLS)
- Per-scope size caps (unified 100KB)
- Full rich-text (TipTap) editor
- Image/iframe allowed in markdown
- Bridge-live wiring against `allocator_holdings` (Phase 09)
- Scenario builder (Phase 10)
- Onboarding nudges (Phase 11)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MANAGE-01 | `/connections` page lists every connected API key with venue, last-sync, status, actions | **Wording-only update** at phase commit: surface is `/profile?tab=exchanges`, already ships list/last-sync/status/actions (Phase 06 / Plan 04). No new route. |
| MANAGE-02 | API key revocation sets `sync_status='revoked'`, retains holdings, flags stale | Revoked state ALREADY emitted by worker on 401/permission (Phase 06 D-07). Phase 08 adds UI (strikethrough + chip + toggle). Revoked holdings STAY in historical series (D-04). |
| MANAGE-03 | API key delete removes key, cascades future syncs, preserves historical rows | Migration 069 RPC already supports this shape. Phase 08 reframes as "Disconnect" + optional cascade (D-02). |
| MANAGE-04 | New `user_notes` table with owner-RLS + multi-scope, markdown body, length cap | Migration 071 reshape (D-07). 100KB cap retained. Schema below §4. |
| MANAGE-05 | Portfolio-scope pinned on `/allocations`; per-holding inline; per-outcome on timeline; strategy card on factsheet | Four surfaces locked (D-15/16/17/18). |
| MANAGE-06 | Notes UI: inline edit, auto-save-on-blur, markdown rendering, audit-logged | `useNoteAutoSave` + `NoteSaveStatus` (D-19), `NoteRender.tsx` (D-11), four new audit kinds (D-20). |

## Project Constraints (from CLAUDE.md + AGENTS.md)

- **Simplicity First**: Every change minimum-diff. Reshape `user_notes` in place; do not create a new table alongside.
- **Root-Cause Obsession**: Rename `portfolio_note.update` → `user_note.portfolio.update` in one atomic commit (audit.ts enum + ADR-0023 table + route.ts emitter + audit-fanout test) — no back-compat alias, no "old name still works." Verified safe: 5 files touch the literal, zero external consumers (see Research Finding #6).
- **Minimal Impact**: `useMandateAutoSave` has a 4-attempt exponential backoff + 429 handling + generation counter for race-drops. `useNoteAutoSave` must NOT copy that complexity — UI-SPEC §6 specifies "retry once after 2s on 5xx, surface error on 4xx" — single `generation` counter still needed for rapid-blur races.
- **Banned Packages**: `axios` is banned — use native `fetch()` (already the convention across `useMandateAutoSave` and `AllocatorExchangeManager`). `package.json` currently has zero axios refs; keep it that way. `react-markdown` / `rehype-sanitize` / `remark-gfm` are NOT on the ban list.
- **Not-the-Next.js-you-know** (AGENTS.md): Next 16 Route Handler signatures remained stable — `export async function PATCH(request: NextRequest)` is still the shape. Verified via `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`. Route Handlers are NOT cached for PATCH by default — no `export const dynamic` needed on the rewrite.
- **Design system first (DESIGN.md)**: DM Sans / Geist Mono / 8px radius / accent `#1B6B5A`. Warning amber `#D97706` for revoked chip + amber-tinted note icon on revoked holdings. `prose-note` CSS rule added to `globals.css` (NOT `@tailwindcss/typography`).

## Standard Stack

### Core (new additions)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-markdown | `10.1.0` | Render markdown as React elements | De-facto standard for React; works with unified/rehype/remark ecosystem; maintained by @wooorm (author of the unified stack). [VERIFIED: npm view 2026-04-21 — latest published 2025-03-07] |
| rehype-sanitize | `6.0.0` | Sanitize HAST tree via allowlist schema | Official rehype plugin; wraps `hast-util-sanitize@5.0.2`. GitHub-style default schema already includes tables/del/strike. [VERIFIED: npm view] |
| remark-gfm | `4.0.1` | GitHub-flavored markdown (tables, strikethrough, task lists, autolinks) | Official remark plugin. [VERIFIED: npm view] |

**Peer-dep check (verified via `npm view`):**
- `react-markdown@10.1.0` peerDeps: `@types/react: >=18`, `react: >=18` → project ships `react@19.2.4` ✅
- `remark-gfm@4.0.1` peerDeps: (none listed) ✅
- `rehype-sanitize@6.0.0` peerDeps: (none listed) ✅
- No conflict with `@supabase/ssr@0.10.0`, `next@16.2.3`, `zod@4.3.6`, or any existing dep.

**Bundle size (unpackedSize from npm):**
- `react-markdown@10.1.0`: ~52 KB (plus transitive `hast-util-to-jsx-runtime`, `remark-parse`, `remark-rehype`, `unified`, `mdast-util-to-hast`, etc. — total lazy-import bundle ~120–160 KB gzipped)
- `rehype-sanitize@6.0.0`: ~21 KB
- `remark-gfm@4.0.1`: ~22 KB

**Recommendation:** Lazy-import `NoteRender` via `React.lazy` so the markdown bundle is pulled only when a note renders in view. (The NotesWidget already uses `React.lazy` via `WIDGET_COMPONENTS`; extend the same pattern for `NoteRender` within the widget body.)

### Supporting (already in tree, reused)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@supabase/ssr` | ^0.10.0 | Server-side Supabase client | `/api/notes` route — existing |
| `@supabase/supabase-js` | ^2.101.1 | Client-side Supabase | `AllocatorExchangeManager` Disconnect RPC call — existing |
| `next` | ^16.2.3 | App Router + `after()` for audit fire-and-forget | Route handler + audit emission — existing |
| `zod` | ^4.3.6 | Body validation | **New use**: validate `{scope_kind, scope_ref, content}` PATCH body. Replaces the brittle `typeof content !== "string"` guard in current route. [RECOMMENDED] |
| `react-grid-layout` | ^2.2.3 | Dashboard layout | NotesWidget entry; `LAYOUT_VERSION` bump — existing |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| react-markdown | `markdown-to-jsx` (23 snippets vs 47 on Context7) | smaller bundle, but no rehype/remark plugin ecosystem → no `rehype-sanitize` → would have to roll a DIY sanitizer. Rejected. |
| rehype-sanitize defaultSchema | DOMPurify on rendered output | double-sanitize (HAST-level + DOM-level) is belt-and-suspenders but adds 20KB. Default schema is sufficient because `react-markdown` defaults to escaping HTML (no `rehype-raw`). Rejected. |
| hand-rolled markdown renderer | — | MANAGE-04 requires markdown rendering; hand-rolling is banned by CLAUDE.md. Rejected. |
| new SECURITY DEFINER RPC for per-scope ownership | app-layer checks (D-09) | 4 scopes × different check-shapes → RPC becomes a 4-way `CASE` with dynamic SQL; app layer is cleaner and per-scope shape is visible in code review. D-09 stands. |
| reshape via ADD COLUMN + keep portfolio_id | drop portfolio_id in the same migration | back-compat not needed — `/api/notes` is the sole consumer. Rejected: drop the column (D-07). |

**Installation:**
```bash
npm install --save-exact react-markdown@10.1.0 rehype-sanitize@6.0.0 remark-gfm@4.0.1
```

`--save-exact` pins the version string without `^` so a future `npm install` in CI cannot silently upgrade. Aligns with the project's `package.json` style — most deps use `^`, but for new deps with transitive sanitizer risk, exact pins are the defensive choice.

## Architecture Patterns

### System Architecture Diagram

```
[ allocator browser ]
    │
    │  (a) Click note icon / textarea blur
    ▼
[ NoteTextarea (client) ]  ──────────►  [ useNoteAutoSave hook ]
    │                                        │
    │  (b) render path                       │  (c) PATCH /api/notes
    ▼                                        ▼        body: {scope_kind, scope_ref, content}
[ NoteRender (client) ]                  [ /api/notes route (server) ]
    │                                        │
    │ react-markdown                         │  (d) auth.getUser()
    │   ├─ remark-parse                      │  (e) per-scope ownership check
    │   ├─ remark-gfm (tables/strike)        │      ├─ portfolio → portfolios.user_id
    │   ├─ remark-rehype                     │      ├─ holding   → allocator_holdings match
    │   └─ rehype-sanitize (defaultSchema,   │      ├─ bridge_outcome → allocator_id match
    │       extended: -img -input; +href     │      └─ strategy → published row exists
    │       rel/target override)             │
    │                                        ▼
    ▼                               [ supabase.upsert("user_notes") ]
[ rendered markdown DOM ]                    │
                                             │  ON CONFLICT (user_id, scope_kind, scope_ref)
                                             ▼
                                    [ user_notes row ]
                                             │
                                             │  after() fire-and-forget
                                             ▼
                                    [ logAuditEvent() → log_audit_event RPC ]
                                             │
                                             ▼
                                    [ audit_log row, user_note.{kind}.update ]

═══════════════════════════════════════════════════════════════════════
DISCONNECT FLOW (unrelated path, same phase)
═══════════════════════════════════════════════════════════════════════

[ allocator clicks "Disconnect" ]
    │
    ▼
[ Disconnect Modal (client) ]  ──── (a) fetch allocator_holdings count ──► [ RLS SELECT ]
    │
    │ (b) user toggles cascade checkbox (OPTIONAL, default OFF)
    │
    ▼
[ supabase.rpc("delete_allocator_api_key",
     { p_api_key_id, p_cascade_holdings }) ]
    │
    ▼
[ migration 069 SECURITY DEFINER RPC ]
    │  atomic:
    │  1. verify auth.uid() = api_keys.user_id
    │  2. IF cascade → DELETE FROM allocator_holdings WHERE api_key_id
    │  3. DELETE FROM api_keys (throws 23503 if holdings remain)
    │
    ▼
[ router.refresh() → server-side api_keys list re-fetched ]
```

### Recommended Project Structure

```
src/
├── app/
│   ├── api/
│   │   └── notes/
│   │       ├── route.ts                           # rewrite for multi-scope
│   │       └── route.test.ts                      # extend with 4-scope matrix
│   ├── (dashboard)/
│   │   └── allocations/
│   │       ├── AllocationDashboard.tsx            # host holdings toggle state
│   │       ├── lib/
│   │       │   └── dashboard-defaults.ts          # bump LAYOUT_VERSION 2→3 (see Finding #5)
│   │       └── widgets/
│   │           └── meta/
│   │               └── NotesWidget.tsx            # upgrade in place
│   └── strategy/
│       └── [id]/
│           └── page.tsx                           # add StrategyNoteCard below sparkline
├── components/
│   ├── notes/                                     # NEW directory — all notes shared bits live here
│   │   ├── NoteRender.tsx                         # react-markdown + sanitize schema
│   │   ├── NoteSaveStatus.tsx                     # clone of MandateSaveStatus
│   │   ├── useNoteAutoSave.ts                     # clone of useMandateAutoSave (simplified)
│   │   ├── StrategyNoteCard.tsx                   # wraps NoteRender + textarea for /strategy/[id]
│   │   ├── HoldingNoteRow.tsx                     # inline expandable sub-row fragment
│   │   └── sanitize-schema.ts                     # exported extended rehype-sanitize schema
│   ├── exchanges/
│   │   └── AllocatorExchangeManager.tsx           # rename Remove→Disconnect + cascade UI flip
│   └── mandate/
│       ├── useMandateAutoSave.ts                  # UNCHANGED reference
│       ├── MandateSaveStatus.tsx                  # UNCHANGED reference
│       └── formatRelativeTime.ts                  # reused by NoteSaveStatus
├── lib/
│   ├── audit.ts                                   # update enum: drop portfolio_note.update, add 4 user_note.*.update
│   └── notes/                                     # NEW directory — server-only helpers
│       ├── scope-ref.ts                           # parseHoldingScopeRef / buildHoldingScopeRef
│       └── ownership.ts                           # per-scope ownership check fns (server-only)
supabase/
└── migrations/
    └── 071_user_notes_multiscope.sql              # reshape + self-verify DO block
docs/
└── architecture/
    └── adr-0023-audit-event-taxonomy.md           # update table rows: rename + add 3 new kinds
```

### Pattern 1: App-layer per-scope ownership check

**What:** The `/api/notes` PATCH route validates per-scope ownership in TypeScript before writing.
**When to use:** When the validity check varies by scope_kind and can't collapse into a single DB predicate.
**Example:**

```typescript
// src/lib/notes/ownership.ts — server-only module
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseHoldingScopeRef } from "./scope-ref";

export type ScopeKind = "portfolio" | "holding" | "bridge_outcome" | "strategy";

export interface OwnershipCheckResult {
  ok: boolean;
  reason?: string; // for diagnostic logging only; never surfaced to caller
}

export async function checkScopeOwnership(
  supabase: SupabaseClient,
  userId: string,
  scope_kind: ScopeKind,
  scope_ref: string,
): Promise<OwnershipCheckResult> {
  switch (scope_kind) {
    case "portfolio": {
      const { data } = await supabase
        .from("portfolios")
        .select("id")
        .eq("id", scope_ref)
        .eq("user_id", userId)
        .maybeSingle();
      return data ? { ok: true } : { ok: false, reason: "portfolio not owned" };
    }
    case "holding": {
      const parsed = parseHoldingScopeRef(scope_ref);
      if (!parsed) return { ok: false, reason: "malformed scope_ref" };
      // At least one row must exist matching the venue/symbol/type + owner.
      // No `asof` filter — the note is aggregate across daily snapshots.
      const { data } = await supabase
        .from("allocator_holdings")
        .select("id")
        .eq("allocator_id", userId)
        .eq("venue", parsed.venue)
        .eq("symbol", parsed.symbol)
        .eq("holding_type", parsed.holding_type)
        .limit(1)
        .maybeSingle();
      return data ? { ok: true } : { ok: false, reason: "no matching holding" };
    }
    case "bridge_outcome": {
      const { data } = await supabase
        .from("bridge_outcomes")
        .select("id")
        .eq("id", scope_ref)
        .eq("allocator_id", userId)
        .maybeSingle();
      return data ? { ok: true } : { ok: false, reason: "outcome not owned" };
    }
    case "strategy": {
      // All published strategies are publicly notable for allocators (D-09).
      // Ownership is "strategy exists and is published".
      const { data } = await supabase
        .from("strategies")
        .select("id")
        .eq("id", scope_ref)
        .eq("status", "published")
        .maybeSingle();
      return data ? { ok: true } : { ok: false, reason: "strategy not published" };
    }
  }
}
```

### Pattern 2: Holding scope_ref parse/build helpers

**What:** Pure functions for `{venue}:{symbol}:{holding_type}` ↔ triple conversion.
**When to use:** Any code constructing or reading a holding scope_ref.
**Example:**

```typescript
// src/lib/notes/scope-ref.ts
export interface HoldingScopeParts {
  venue: string;          // e.g. "binance" | "okx" | "bybit" | "deribit" | "kraken" | "coinbase"
  symbol: string;         // CCXT-stripped: "BTC" for spot, "BTCUSDT" for derivatives (Phase 06 D-16)
  holding_type: "spot" | "derivative";
}

const HOLDING_SCOPE_RE = /^([a-z]+):([A-Z0-9]+):(spot|derivative)$/;

export function buildHoldingScopeRef(p: HoldingScopeParts): string {
  return `${p.venue}:${p.symbol}:${p.holding_type}`;
}

export function parseHoldingScopeRef(ref: string): HoldingScopeParts | null {
  const m = HOLDING_SCOPE_RE.exec(ref);
  if (!m) return null;
  const [, venue, symbol, holding_type] = m;
  return { venue, symbol, holding_type: holding_type as "spot" | "derivative" };
}
```

**Regex rationale:** CCXT symbols post-strip are uppercase alphanumeric only (`_normalize_ccxt_position` in `analytics-service/services/positions.py:114` does `.replace("/", "").replace(":USDT", "").replace(":USD", "")`; spot in `allocator_positions.py:151` uses raw currency codes like "BTC"). Venue is lowercase (`api_keys.exchange` values are `binance/okx/bybit/...` per `EXCHANGE_TAGS`). The regex is strict — malformed refs return `null` and the route returns 400.

### Pattern 3: react-markdown + extended sanitize schema

**What:** Shared `NoteRender` component with sanitize schema co-located in `sanitize-schema.ts`.
**When to use:** Every surface that renders a stored note (not editing).
**Example:**

```typescript
// src/components/notes/sanitize-schema.ts
import { defaultSchema } from "hast-util-sanitize";
import type { Schema } from "hast-util-sanitize";

// Default schema already includes: a, b, blockquote, br, code, dd, del,
// details, div, dl, dt, em, h1-h6, hr, i, img, input, ins, kbd, li, ol, p,
// picture, pre, q, rp, rt, ruby, s, samp, section, source, span, strike,
// strong, sub, summary, sup, table, tbody, td, tfoot, th, thead, tr, tt,
// ul, var.
// Default href protocols: http, https, irc, ircs, mailto, xmpp.
//
// D-13 requires: disallow img, script (not in default anyway), iframe (not
// in default), style (not in default), event handlers (not in default).
// Default already blocks script/iframe/style/on* — we only need to strip img.

const ALLOWED_TAGS = (defaultSchema.tagNames ?? []).filter(
  (t) => !["img", "input", "details", "summary", "picture", "source"].includes(t),
);

export const noteSanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: ALLOWED_TAGS,
  // Restrict href to http/https only (drop irc/ircs/xmpp/mailto per D-13).
  // NOTE: a `mailto:` link is arguably useful but D-13 says "href matches
  // ^https?://" so we match that spec.
  protocols: {
    ...(defaultSchema.protocols ?? {}),
    href: ["http", "https"],
  },
  // Keep attributes inherited from defaultSchema (includes ariaLabel,
  // ariaLabelledBy, ariaDescribedBy, className, href on <a>).
};
```

```typescript
// src/components/notes/NoteRender.tsx
"use client";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { noteSanitizeSchema } from "./sanitize-schema";

const components = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    // Render as link only when href is present and survived sanitization
    // (rehype-sanitize strips non-http/https hrefs by dropping the attribute).
    if (!href) return <>{children}</>;
    return (
      <a
        href={href}
        rel="noopener noreferrer"
        target="_blank"
        className="text-accent underline hover:text-accent-hover"
      >
        {children}
      </a>
    );
  },
};

export function NoteRender({ content }: { content: string }) {
  return (
    <div className="prose-note text-sm text-text-primary leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, noteSanitizeSchema]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

**Security note (verified via Context7 `/remarkjs/react-markdown` + GitHub `syntax-tree/hast-util-sanitize`):** `react-markdown` by default ESCAPES raw HTML in the markdown source — it does NOT process `<script>` or `<iframe>` strings in the input. `rehype-sanitize` is belt-and-suspenders protection against remark plugins that might synthesize disallowed elements (e.g. a future misbehaving plugin). We do NOT add `rehype-raw` — that plugin would enable raw HTML processing and is explicitly rejected by CLAUDE.md Root-Cause principle (every attack surface we don't add is one we don't have to defend).

### Pattern 4: useNoteAutoSave hook (simplified from useMandateAutoSave)

**What:** On-blur fetch with single retry on 5xx; generation-counter guards rapid-blur races.
**When to use:** Every note surface's textarea.
**Contract:**

```typescript
// src/components/notes/useNoteAutoSave.ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface UseNoteAutoSaveReturn {
  saveState: SaveState;
  lastSavedAt: Date | null;
  save: (content: string) => Promise<void>;
}

export function useNoteAutoSave(
  scope_kind: "portfolio" | "holding" | "bridge_outcome" | "strategy",
  scope_ref: string,
  initialLastSavedAt: Date | null = null,
): UseNoteAutoSaveReturn {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(initialLastSavedAt);
  const generationRef = useRef(0);

  // 2s "saved" flash → "idle" fade (mirrors MandateSaveStatus pattern)
  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(t);
  }, [saveState]);

  const save = useCallback(async (content: string) => {
    const gen = ++generationRef.current;
    setSaveState("saving");

    const attempt = async (retry: boolean): Promise<void> => {
      let res: Response;
      try {
        res = await fetch("/api/notes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope_kind, scope_ref, content }),
          credentials: "same-origin",
        });
      } catch {
        if (retry) {
          await new Promise((r) => setTimeout(r, 2000));
          return attempt(false);
        }
        if (generationRef.current === gen) setSaveState("error");
        return;
      }

      if (generationRef.current !== gen) return; // stale response — drop

      if (res.ok) {
        setLastSavedAt(new Date());
        setSaveState("saved");
        return;
      }
      if (res.status >= 500 && retry) {
        await new Promise((r) => setTimeout(r, 2000));
        return attempt(false);
      }
      setSaveState("error"); // 4xx OR final-attempt 5xx
    };

    await attempt(true);
  }, [scope_kind, scope_ref]);

  return { saveState, lastSavedAt, save };
}
```

**Simplification vs `useMandateAutoSave`:**
- No per-field fieldErrors map (single-content-per-hook).
- No exponential-backoff chain (single retry after 2s — notes are low-volume).
- No 429 Retry-After handling (the `/api/preferences` rate limiter doesn't apply to `/api/notes`; if Phase 08 later adds one, this hook extends).
- Same generation-counter race guard (identical pattern — rapid blurs from re-focusing should not race-drop the newer content).

### Anti-Patterns to Avoid

- **Mounting `rehype-raw` alongside `rehype-sanitize`**: would enable raw HTML processing. Never add `rehype-raw`. Storage is plain text → markdown source → no raw HTML in input → sanitize is belt-and-suspenders only.
- **`JSON.stringify(content).length` for byte-cap enforcement**: UTF-16 code units undercount non-ASCII bytes. Use `new TextEncoder().encode(content).length` (current route already does this — preserve).
- **`dangerouslySetInnerHTML` anywhere in NoteRender**: `react-markdown` returns React elements via `hast-util-to-jsx-runtime`. No DOM-level HTML string exists at any boundary.
- **Looking up note by `user_notes.id`**: The surrogate `id` UUID is volatile across upserts (ON CONFLICT resolves to existing row's id, but a DELETE+re-INSERT wouldn't). Audit `entity_id` uses synthetic `{scope_kind}:{scope_ref}` per D-20 for exactly this reason.
- **Mixing "Disconnect" (cascade optional) with "Revoke" (a separate affordance)**: D-03 defers soft-Revoke; keep one destructive action. If a future reviewer asks for Revoke, route them to the deferred list.
- **Holding-note icon in a NEW leading column**: would shift every other column right. Trailing column alongside action buttons is less disruptive (see Research Finding #7).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown rendering | custom AST walker | `react-markdown` | Markdown has CommonMark + GFM edge cases (nested blockquotes, indented code fences, link references) that took the community 5+ years to get right. Hand-rolling is a liability. |
| HTML sanitization | regex/DOMPurify | `rehype-sanitize` with defaultSchema | Default schema is the "GitHub style" allowlist — battle-tested in production at millions of requests/day. DIY allowlists miss CSS-style injection vectors, mixed-case tag bypasses, SVG namespaces. |
| GFM extensions (tables, strike, task lists) | custom pre-processor | `remark-gfm` | Official plugin from the unified maintainers. |
| Relative-time formatting | new helper | `formatRelativeTime` in `src/components/mandate/formatRelativeTime.ts` | Already shipped in Phase 02; `NoteSaveStatus` imports it directly per UI-SPEC §6. |
| Cascade delete of api_keys → allocator_holdings | direct SELECT+DELETE client-side | `delete_allocator_api_key` RPC (migration 069) | SECURITY DEFINER, atomic, verified-owner, returns count. Already shipped. Phase 08 reuses verbatim. |
| On-blur save state machine | inline setState juggling in every surface | `useNoteAutoSave` + `NoteSaveStatus` | Phase 02 established the pattern; mirror it across four surfaces so one bug fix updates all. |
| aria-live "saved" flash | `react-hot-toast` / similar | reuse `.mandate-saved-flash` CSS keyframe in `globals.css` | Already in globals.css with `prefers-reduced-motion` override. Zero new dep. |
| Notes journal index / cross-scope search | new `/notes` page | — | OUT OF SCOPE per CONTEXT.md deferred list. |
| Rich-text editor | TipTap/Lexical | plain `<textarea>` | CEO review D.5 (migration 037 comment) explicitly rejected rich-text. Monospace textarea + markdown-render-on-read is the institutional pattern. |

**Key insight:** The notes phase is 80% pattern-reuse. The shared components (`NoteRender`, `NoteSaveStatus`, `useNoteAutoSave`, ownership helpers) are the only net-new code; per-surface UI is glue that wires them into NotesWidget / holdings sub-row / OutcomesWidget / StrategyNoteCard.

## Runtime State Inventory

*(Included because migration 071 reshapes an existing table and drops a column — this is a data-migration phase, not pure greenfield.)*

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `user_notes` table: **0 rows total** (verified 2026-04-20 via REST count). `portfolio_id IS NULL` rows: **0**. | Data migration is a no-op in production. Migration 071 still MUST run the backfill path (`UPDATE user_notes SET scope_kind='portfolio', scope_ref = portfolio_id::text WHERE portfolio_id IS NOT NULL`) defensively — preview environments and local dev DBs may have test rows. |
| Live service config | None. `user_notes` is not referenced in any cron, worker, or external config. No n8n/Datadog/Tailscale refs. | None. |
| OS-registered state | None. | None. |
| Secrets / env vars | None. `/api/notes` uses the request-scoped Supabase client (reads SUPABASE_ANON_KEY via `@supabase/ssr`); no new env vars. | None. |
| Build artifacts | TypeScript enum `AuditAction` in `src/lib/audit.ts` has `"portfolio_note.update"` as a literal. Removing it is a **breaking type change** for any code referencing the literal — grep confirmed 5 call sites, all in-repo: `audit.ts:106`, `adr-0023:75 + 134`, `audit-fanout:15,241-295`, `route.ts:116`. Rename in the same commit. | Atomic rename — no staging. |
| Search indexes / caches | None. No fulltext index on `user_notes.content`. No Redis cache. | None. |

**The canonical question (from researcher prompt):** *After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?*

**Answer:** Nothing. The production `audit_log` table already contains `portfolio_note.update` rows as immutable history (append-only per ADR-0023 §6), and that is **by design** — audit log is a forensic record; old action strings preserve historical fidelity. Dashboards that query `audit_log` by action string would need the new name (`user_note.portfolio.update`), but there are no such dashboards today. If one is added in Phase 11, it must UNION old and new names for the transition period.

**Recommendation for migration 071:** The self-verifying DO block should:
1. Assert the new column CHECK constraint is in place.
2. Assert the composite UNIQUE index is in place.
3. Assert RLS is still ENABLED and all 4 policies (SELECT/INSERT/UPDATE/DELETE) exist.
4. Assert the old `portfolio_id` column is gone.
5. Assert `NOT EXISTS (SELECT 1 FROM user_notes WHERE scope_kind IS NULL OR scope_ref IS NULL)` — defensive; backfill might miss a row under concurrent load.

## Common Pitfalls

### Pitfall 1: `rehype-sanitize` schema mutation across renders
**What goes wrong:** If the schema object is re-created inline on every render, React deep-diffs it and remounts the `ReactMarkdown` subtree. User sees flicker on state changes unrelated to the content.
**Why it happens:** `rehypePlugins={[[rehypeSanitize, {...defaultSchema, tagNames: [...]}]]}` inline in JSX.
**How to avoid:** Co-locate the schema in a module-scope `const noteSanitizeSchema = {...}` in `sanitize-schema.ts` and import. Reference is stable across renders.
**Warning signs:** Visible flicker on textarea typing; React DevTools shows `ReactMarkdown` remounting instead of re-rendering.

### Pitfall 2: ON CONFLICT mismatch with reshaped unique index
**What goes wrong:** Current `/api/notes` route has `onConflict: "user_id,portfolio_id"`. After migration 071 drops the old partial unique indexes, an upsert with the old string will fail with Postgres error `42P10` (no unique constraint matching).
**Why it happens:** Rewrite must update `onConflict` to `"user_id,scope_kind,scope_ref"` in lockstep with the migration.
**How to avoid:** Migration 071 and `/api/notes` rewrite land in the **same commit** per D-23 (ADR sync also in same commit). The rewrite test suite must assert the new onConflict string exercises successfully.
**Warning signs:** 500s from the route immediately after migration 071 applies; error log shows `42P10`.

### Pitfall 3: Blur event fires during keyboard navigation (Tab)
**What goes wrong:** User presses Tab to move from textarea to a focusable element (e.g., Edit button) — blur fires and saves. If the user was mid-edit and meant to keep typing, the save lands prematurely.
**Why it happens:** `onBlur` fires on any focus-leave including programmatic/keyboard.
**How to avoid:** Save-on-blur is the spec (D-19); this is intentional. Unit test MUST cover the Tab case: assert the save fires exactly once regardless of mouse-click-away vs Tab-away. Additionally: save is idempotent (upsert), so firing twice on a rapid tab-then-click-back is harmless — generation-counter drops the stale response.
**Warning signs:** Users report "my note saved half-typed" — investigate by checking whether the save triggered on an unintended blur.

### Pitfall 4: Cascade-checkbox REVERSAL in existing modal
**What goes wrong:** The current `AllocatorExchangeManager.tsx:692-697` has `disabled={deleteLoading || deleteHoldingsCount === null || (deleteHoldingsCount > 0 && !cascadeHoldings)}`. Phase 08 D-02 flips the cascade default to unchecked AND removes the disabled-unless-checked gate. If the plan patches the default but forgets to remove the disabled guard, the button is permanently unclickable when holdings exist + checkbox unchecked.
**Why it happens:** Two separate gates in the same render expression — easy to half-patch.
**How to avoid:** The Disconnect button disabled expression becomes `disabled={deleteLoading || deleteHoldingsCount === null}`. The `(deleteHoldingsCount > 0 && !cascadeHoldings)` subexpression is **deleted**. Unit test MUST cover: `deleteHoldingsCount=5, cascadeHoldings=false → button enabled`.
**Warning signs:** Disconnect button stays greyed out with holdings present.

### Pitfall 5: Dropping `portfolio_id` column while indexes still reference it
**What goes wrong:** `DROP COLUMN portfolio_id` fails with `cannot drop column portfolio_id because other objects depend on it` if the old partial unique indexes still exist.
**Why it happens:** Migration step ordering.
**How to avoid:** D-22 already specifies order: Step 1 add new columns + backfill + constraints; Step 2 drop old indexes + add new UNIQUE; Step 3 drop old column. Plan MUST enforce this step order in the migration SQL. Tested by the self-verifying DO block.
**Warning signs:** Migration aborts in preview branch; `supabase db push` fails.

### Pitfall 6: Strategy scope_ref using the WRONG table
**What goes wrong:** CONTEXT.md D-18 mentions `match_strategies.id` or `verified_strategies.id`. Neither table exists. A plan that migrates "use match_strategies" into the ownership check produces a perpetual 400 ("strategy not found").
**Why it happens:** Planner reads CONTEXT.md too literally.
**How to avoid:** Research Finding #3 locks `scope_ref = strategies.id` where `strategies.status = 'published'` is the ownership predicate. Unit test asserts against a published strategy fixture.
**Warning signs:** 400 responses from `/api/notes` for every strategy-scope save attempt.

### Pitfall 7: LAYOUT_VERSION bump orphans other widgets' layouts
**What goes wrong:** Bumping LAYOUT_VERSION to 3 resets ALL users' layouts on next load (not just the notes tile). Users who carefully arranged 30 widgets lose that arrangement.
**Why it happens:** `useDashboardConfig.ts:19` does a `parsed.layoutVersion !== LAYOUT_VERSION` guard that returns `DEFAULT_LAYOUT` wholesale.
**How to avoid:** Bump is a known tradeoff (Voice-D8 tech debt accepted at Sprint 5 close). No user-facing banner per Phase 05 D-? ; the dashboard just refills defaults. Document in the plan so reviewers don't surprise-flag it. (See Finding #5 for whether the bump is truly necessary.)
**Warning signs:** Post-deploy complaints from allocators who had custom layouts — route them to the reset explanation.

### Pitfall 8: Audit entity_id uniqueness across scope_kinds
**What goes wrong:** A portfolio UUID happens to collide with a bridge_outcome UUID (astronomically unlikely but auditable). With entity_id = raw UUID, grepping audit_log by entity_id is ambiguous.
**Why it happens:** UUIDs are unique within a table, not across tables.
**How to avoid:** D-20 specifies `entity_id = {scope_kind}:{scope_ref}` — a composite identifier. Grepping audit_log for "user_note.holding" returns only holding notes; grepping by entity_id "portfolio:<uuid>" disambiguates. Plan ensures the emitter builds this string. BUT: see Finding #8 for the UUID-type constraint of `audit_log.entity_id` and the resolution.

## Code Examples

Verified patterns from official sources:

### Rendering a note (all 4 surfaces)

```tsx
// Source: /remarkjs/react-markdown Context7 + hast-util-sanitize defaultSchema
import { NoteRender } from "@/components/notes/NoteRender";

// In read mode:
<NoteRender content={content} />

// In edit mode (no markdown processing, plain textarea):
<textarea
  value={draft}
  onChange={(e) => setDraft(e.target.value)}
  onBlur={() => save(draft)}
  className="w-full resize-none rounded border border-border p-3 font-mono text-[13px] leading-[1.6] focus:border-accent focus:outline-none"
  placeholder="Portfolio notes — markdown supported."
/>
```

### Scope-ref construction (holding row)

```tsx
// Source: Phase 06 D-16 + _normalize_ccxt_position (analytics-service)
import { buildHoldingScopeRef } from "@/lib/notes/scope-ref";

const holdingRow = { venue: "binance", symbol: "BTC", holding_type: "spot" as const };
const scope_ref = buildHoldingScopeRef(holdingRow); // "binance:BTC:spot"
```

### PATCH /api/notes handler skeleton

```typescript
// Source: rewrite of existing src/app/api/notes/route.ts per D-07/D-09/D-10
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";
import { checkScopeOwnership } from "@/lib/notes/ownership";

const MAX_BYTES = 100 * 1024;

const BodySchema = z.object({
  scope_kind: z.enum(["portfolio", "holding", "bridge_outcome", "strategy"]),
  scope_ref: z.string().min(1).max(512),
  content: z.string(),
});

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { scope_kind, scope_ref, content } = parsed.data;

  if (new TextEncoder().encode(content).length > MAX_BYTES) {
    return NextResponse.json({ error: "Content exceeds 100 KB limit" }, { status: 400 });
  }

  const own = await checkScopeOwnership(supabase, user.id, scope_kind, scope_ref);
  if (!own.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("user_notes")
    .upsert(
      {
        user_id: user.id,
        scope_kind,
        scope_ref,
        content,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,scope_kind,scope_ref" },
    )
    .select("updated_at")
    .single();

  if (error) return NextResponse.json({ error: "Failed to save note" }, { status: 500 });

  logAuditEvent(supabase, {
    action: `user_note.${scope_kind}.update` as const,
    entity_type: "user_note",
    entity_id: resolveEntityId(scope_kind, scope_ref, user.id), // see Finding #8
    metadata: { scope_kind, scope_ref, content_length: content.length },
  });

  return NextResponse.json({ updated_at: data?.updated_at });
}

// GET: same body-shape swap — query params `scope_kind` + `scope_ref`, same
// 404-vs-empty handling as today (PGRST116 code).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plain-textarea + 1s debounce save | Plain-textarea edit + markdown render + on-blur save | Phase 08 (this phase) | Unifies with Phase 02 mandate UX. Users can use **[bold]** / lists / tables in notes. |
| `portfolio_note.update` audit action | `user_note.portfolio.update` + 3 sibling actions | Phase 08 | Breaking rename in the same atomic commit; no back-compat. |
| `user_notes (user_id, portfolio_id)` | `user_notes (user_id, scope_kind, scope_ref)` | Phase 08 | 4 scope kinds supported. |
| Disconnect = "Remove key" with cascade-required-to-proceed checkbox | Disconnect = "Disconnect" with cascade-optional-default-unchecked | Phase 08 | Preserves historical holdings by default; aligns with D-04 "revoked holdings are real history". |
| "Remove key" modal copy: "can't be left orphaned" | "We'll stop syncing this key. Your historical holdings stay available for audit…" | Phase 08 | Institutional tone; accurate (holdings are not orphaned — migration 069 RPC handles the FK state both ways). |

**Deprecated / retired:**
- `portfolio_note.update` audit action → `user_note.portfolio.update`
- `user_notes_unique_per_portfolio` index → replaced by `user_notes_unique_multiscope`
- `user_notes_unique_global` index → dropped (zero rows verified)
- `user_notes.portfolio_id` column → dropped

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `bridge_outcomes` has `allocator_id UUID` column (verified via migration 059 referenced in CONTEXT.md canonical_refs, not directly re-read in this research) | Pattern 1 ownership check | If column name is `user_id` instead, ownership check returns 403 for every bridge_outcome note attempt. **Mitigation:** planner reads migration 059 line-by-line during Plan 1 TDD. |
| A2 | Default rehype-sanitize schema blocks `<script>`, `<style>`, inline `style=` attributes, `on*` event handlers | Pattern 3 + Pitfall 1 | If some dangerous tag IS in default schema, XSS risk. **Mitigation:** plan includes a unit test exercising `<img src=x onerror=alert(1)>`, `<script>alert(1)</script>`, `<a href="javascript:alert(1)">` in the content and asserts none appear in rendered output. |
| A3 | Strategy factsheet layout is single-column `max-w-3xl` (verified — see `src/app/strategy/[id]/page.tsx:85`) | Finding #3 | LOW risk; confirmed by source read. |
| A4 | LAYOUT_VERSION bump is acceptable per Voice-D8 accepted tech debt | Pitfall 7 + Finding #5 | LOW risk; accepted at Sprint 5 close (PROJECT.md line 68, CONCERNS.md). |
| A5 | `audit_log.entity_id` column is UUID-typed (per ADR-0023 §4 and migration 049 referenced there, not re-read in this research) | Finding #8 + code sample | If column is TEXT, composite `{scope_kind}:{scope_ref}` works directly. If UUID, use scope-appropriate UUID and put composite in metadata. Both paths handled in Finding #8. |

## Open Questions

1. **Should the rewritten `/api/notes` GET endpoint also switch to the new body shape, or keep a deprecated portfolio_id path for one release?**
   - What we know: `/api/notes` is the only consumer (NotesWidget). It's upgraded in this same phase.
   - What's unclear: Nothing — no external consumer exists, no mobile app reads this endpoint.
   - Recommendation: Hard-swap. New shape only. No deprecation period. (Matches minimum-diff principle.)

2. **Does the 2s retry-on-5xx in `useNoteAutoSave` need a generation guard on the retry itself?**
   - What we know: `useMandateAutoSave` checks `generationRef.current === gen` between attempts.
   - What's unclear: If a user blurs twice (two saves in flight), does the first save's retry race the second save's initial attempt?
   - Recommendation: Follow mandate pattern — check generation before each retry. Included in the Pattern 4 code sample.

3. **Should the note icon on discovery cards (`/strategies` browse) be deferred to Phase 10 or shipped in Phase 08?**
   - What we know: UI-SPEC §4d includes the discovery-card icon (outline/solid, no amber variant).
   - What's unclear: MANAGE-05 acceptance only lists "strategy card on factsheet" — discovery-card icon is a nice-to-have.
   - Recommendation: Ship in Phase 08 Plan 3 — it's <20 LOC and visually confirms the note exists before the click-through. Planner may defer if tests balloon.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Next build + test | ✓ | (per CI config) | — |
| npm | package install | ✓ | bundled | — |
| Supabase Postgres | migration 071 apply + RLS + live-DB tests | ✓ | live project `khslejtfbuezsmvmtsdn` reachable (count query succeeded) | — |
| Supabase MCP (optional) | migration apply path if CLI-incompatible | ✓ | project has MCP precedent (migrations 064/065/070) | `supabase db push` if no CLI-incompatible ops — migration 071 has none |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | live-DB RLS matrix test (Plan 1) | ✓ | present in `.env.local` | `it.skipIf(!HAS_LIVE_DB)` guard already canonical |
| Vitest 4.1.2 | unit + route + sanitizer tests | ✓ | in devDeps | — |
| jsdom 29.0.1 | `ReactMarkdown` render in tests | ✓ | in devDeps | — |
| `@testing-library/react` 16.3.2 | component tests for `<NoteRender>`, modal | ✓ | in devDeps | — |
| pytest | N/A — no analytics-service changes | — | — | — |
| CCXT | N/A | — | — | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

*(Required — `workflow.nyquist_validation: true` in `.planning/config.json`.)*

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 + jsdom 29 + @testing-library/react 16.3 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/app/api/notes src/components/notes src/components/exchanges src/app/(dashboard)/allocations/widgets/meta` |
| Full suite command | `npm test` |
| Live-DB gate | `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in env → enables `src/__tests__/user-notes-multiscope-rls.test.ts` (new) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MANAGE-01 | Surface at `/profile?tab=exchanges` lists keys with venue/last-sync/status/actions | component + E2E | `npx vitest run src/components/exchanges/AllocatorExchangeManager.test.tsx` | ❌ Wave 0 — component test file to be created (current tests are for `AllocatorSyncStatus`) |
| MANAGE-02 | Revoked-key holdings render strikethrough + amber chip + toggle hides rows | component | `npx vitest run src/app/(dashboard)/allocations/HoldingsTable.test.tsx` | ❌ Wave 0 — HoldingsTable component does not yet exist in dashboard surface; Plan 4 creates it |
| MANAGE-02 (historical inclusion) | KPIs/equity/drawdown include revoked rows | unit | existing `src/lib/queries.my-allocation.test.ts` | ✅ (extend with a "revoked rows included" assertion) |
| MANAGE-03 | Disconnect button shows cascade-optional modal; migration 069 RPC called with `p_cascade_holdings=false` by default | route + component | `npx vitest run src/components/exchanges/AllocatorExchangeManager.test.tsx` | ❌ Wave 0 |
| MANAGE-04 | Migration 071 applies cleanly; self-verify DO block passes; RLS owner-only holds across 4 scopes | live-DB integration | `npx vitest run src/__tests__/user-notes-multiscope-rls.test.ts` | ❌ Wave 0 — mirror `allocator-holdings-rls.test.ts` shape |
| MANAGE-04 (byte cap) | 100KB cap rejects with 400 | route | `npx vitest run src/app/api/notes/route.test.ts` | ✅ (extend — existing test covers portfolio scope, add 4-scope matrix) |
| MANAGE-05 (portfolio) | NotesWidget upgraded; fetches with new query; renders markdown when not editing | component | `npx vitest run src/app/(dashboard)/allocations/widgets/meta/meta.test.tsx` | ✅ (extend) |
| MANAGE-05 (holding) | Holding row icon toggles sub-row; markdown renders; `aria-expanded` updates | component | `npx vitest run src/components/notes/HoldingNoteRow.test.tsx` | ❌ Wave 0 |
| MANAGE-05 (bridge_outcome) | OutcomesWidget expanded row shows note section below delta panel | component | `npx vitest run src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.test.tsx` | ✅ (extend) |
| MANAGE-05 (strategy) | StrategyNoteCard renders on `/strategy/[id]`; scope_ref = `strategies.id` | component | `npx vitest run src/app/strategy/[id]/page.test.tsx` | ❌ Wave 0 |
| MANAGE-06 (inline edit) | Textarea mounts on icon click; blur fires save once | component | covered by per-surface tests | see above |
| MANAGE-06 (on-blur save) | `useNoteAutoSave.save` triggered exactly once on blur; generation counter drops stale responses | hook | `npx vitest run src/components/notes/useNoteAutoSave.test.ts` | ❌ Wave 0 |
| MANAGE-06 (markdown render) | `rehype-sanitize` blocks `<script>`, `<img>`, `on*`, `javascript:` | sanitizer | `npx vitest run src/components/notes/NoteRender.test.tsx` | ❌ Wave 0 — includes 6 XSS fuzz strings |
| MANAGE-06 (audit) | 4 user_note.*.update kinds emitted correctly with composite entity_id | integration | `npx vitest run src/__tests__/audit-fanout-integration.test.ts` | ✅ (rewrite existing portfolio_note.update block; add 3 new blocks) |

### Sampling Rate

- **Per task commit:** `npx vitest run src/components/notes src/app/api/notes src/lib/notes` (~30s, <10s on a warm Node process)
- **Per wave merge:** `npm test` full vitest suite (target: 1430+ tests green per Phase 07 baseline)
- **Phase gate:** Full vitest + live-DB gated `user-notes-multiscope-rls.test.ts` + `npm run typecheck` + `npm run lint` green before `/gsd-verify-work`

**Signal-to-noise justification:**
- **High signal:** RLS matrix test (catches cross-user leakage regressions), sanitizer fuzz test (catches XSS regressions), audit-fanout test (catches taxonomy-sync regressions).
- **Low noise:** No flaky tests expected — all mocked-supabase shape, deterministic DOM assertions. Live-DB test is `skipIf(!HAS_LIVE_DB)` gated — CI without secrets skips gracefully.
- **Regression boundary:** `critical-regressions.test.ts` should grow an entry asserting the `portfolio_note.update` literal is **not present in route.ts or audit.ts** post-rename.

### Wave 0 Gaps

Tests that don't exist yet and must be created before implementation:

- [ ] `src/__tests__/user-notes-multiscope-rls.test.ts` — covers MANAGE-04 RLS. Mirror `src/__tests__/allocator-holdings-rls.test.ts` two-actor harness. Matrix: 2 users × 4 scope_kinds × 2 operations (SELECT, UPDATE) = 16 assertions.
- [ ] `src/components/notes/NoteRender.test.tsx` — covers MANAGE-06 sanitization. 6 XSS fuzz inputs + 4 GFM passthrough inputs (table, strike, task list, autolink).
- [ ] `src/components/notes/useNoteAutoSave.test.ts` — covers MANAGE-06 on-blur. 5 cases: happy path, 4xx no-retry, 5xx retry-once, rapid blur race, unmount flush.
- [ ] `src/components/notes/HoldingNoteRow.test.tsx` — covers MANAGE-05 holding surface.
- [ ] `src/components/exchanges/AllocatorExchangeManager.test.tsx` — covers MANAGE-01/02/03. Currently a gap — only `AllocatorSyncStatus` has component tests. Plan 4 adds this.
- [ ] `src/app/(dashboard)/allocations/HoldingsTable.test.tsx` — covers MANAGE-02 revoked UI. Depends on whether planner creates a new HoldingsTable component or extends `AllocationDashboard.tsx` inline.
- [ ] `src/app/strategy/[id]/page.test.tsx` — covers StrategyNoteCard insertion + scope_ref = `strategies.id`.

**Wave 0 extensions to existing test files:**
- [ ] `src/app/api/notes/route.test.ts` — grow from 2-scope (portfolio only) to 4-scope × 3-status matrix.
- [ ] `src/__tests__/audit-fanout-integration.test.ts` — replace portfolio_note.update block with 4 user_note.*.update blocks.
- [ ] `src/app/(dashboard)/allocations/widgets/meta/meta.test.tsx` — extend NotesWidget tests for markdown render + on-blur.
- [ ] `src/__tests__/critical-regressions.test.ts` — add "portfolio_note literal absent from route.ts" guard.

**Framework install:** None — Vitest, jsdom, RTL, testing-library/jest-dom all already in devDeps.

## Research Findings (resolves 11 open items from CONTEXT.md §Claude's Discretion + orchestrator task)

### Finding #1: react-markdown / rehype-sanitize / remark-gfm version pins

**Answer:** Pin exactly:
- `react-markdown@10.1.0` (published 2025-03-07, 47 code snippets on Context7, High reputation)
- `rehype-sanitize@6.0.0`
- `remark-gfm@4.0.1`

**Peer-dep compatibility (verified via `npm view <pkg> peerDependencies`):**
- `react-markdown@10.1.0` requires `react >=18` and `@types/react >=18`. Project ships React `19.2.4` ✅.
- `remark-gfm@4.0.1` declares no peerDependencies ✅.
- `rehype-sanitize@6.0.0` declares no peerDependencies ✅.

**No conflicts** with existing `@supabase/ssr^0.10.0`, `@supabase/supabase-js^2.101.1`, `next^16.2.3`, `zod^4.3.6`, or any other package.

**Bundle-size delta (unpackedSize, gzip estimate):**
- `react-markdown@10.1.0`: 52 KB unpacked (transitive chain ~160 KB unpacked total; ~50 KB gzipped)
- `rehype-sanitize@6.0.0`: 21 KB unpacked (~7 KB gzipped)
- `remark-gfm@4.0.1`: 22 KB unpacked (~7 KB gzipped)
- **Total route impact:** ~65 KB gzipped added to any route that imports `NoteRender`. Recommendation: lazy-import `NoteRender` via `React.lazy` so Performance tab's initial bundle stays lean.

**Install command:**
```bash
npm install --save-exact react-markdown@10.1.0 rehype-sanitize@6.0.0 remark-gfm@4.0.1
```

### Finding #2: Sanitizer allowlist (concrete schema)

**Answer:** `hast-util-sanitize`'s `defaultSchema` (already GitHub-style) already includes all D-13 tags:
`h1-h6, p, ul, ol, li, strong, em, code, pre, blockquote, hr, del, strike, table, thead, tbody, tr, th, td, a` — all present in default.

**D-13 Additional requirements:**
- **Disallow `<img>`** — default schema INCLUDES img. Explicit removal needed.
- **Disallow `<input>`, `<details>`, `<summary>`, `<picture>`, `<source>`** — default schema INCLUDES these; remove defensively (not in D-13 spec but safer).
- **Default schema already excludes** `<script>`, `<iframe>`, `<style>`, event handlers (`on*`) — no extra config needed.
- **Default href protocols:** `http, https, irc, ircs, mailto, xmpp`. D-13 says "href matches `^https?://`" → restrict to `["http", "https"]`.

**Concrete schema** (drop into `src/components/notes/sanitize-schema.ts` — code sample above in Pattern 3).

**Link rewrite `rel="noopener noreferrer" target="_blank"`:** implemented via `components` prop override on `<ReactMarkdown>` (code sample in Pattern 3), NOT via the sanitize schema (schema cannot synthesize attributes, only filter).

### Finding #3: Strategy factsheet layout + URL param → table mapping

**Answer:**
- **Page path:** `src/app/strategy/[id]/page.tsx` (verified via `Glob`).
- **Layout:** Single-column `max-w-3xl` (centered). **No right-rail.** Verified via source read (`page.tsx:85`).
- **Insertion slot:** Below sparkline card (line 148), above CTA card (line 157). Full-width card using the same `rounded-lg border border-border bg-card p-4` pattern.
- **URL param mapping:** The `[id]` param is used directly in `getPublicStrategyDetail(id)` (line 77, 19), which queries `supabase.from("strategies").eq("id", strategyId).eq("status", "published")`. **scope_ref = `strategies.id`** — NOT `match_strategies.id` or `verified_strategies.id`. Those tables **do not exist** in the repo.
- **Ownership check:** `strategies.status = 'published'` — any allocator can note any published strategy (D-09: "all verified strategies are publicly notable"). No user_id gate.

**Recommendation:** Update CONTEXT.md D-18 during Phase 08 commit to replace the `match_strategies.id` / `verified_strategies.id` language with `strategies.id where status = 'published'`.

### Finding #4: Sprint-3 "global" note count

**Answer: ZERO rows.** Verified 2026-04-20 via live-DB REST query:
```
GET /rest/v1/user_notes?portfolio_id=is.null&select=count
# Response: content-range: */0, body: [{"count":0}]
```
**Total `user_notes` rows also zero.**

**Migration 071 implication:** Drop `portfolio_id IS NULL` rows outright. **No `scope_ref='global'` sentinel is needed.** Simplifies the migration's backfill DO block to a single UPDATE for `portfolio_id IS NOT NULL` rows.

**Defensive note for migration SQL:** The backfill must still run (preview/dev DBs may have test rows). Shape:
```sql
-- Backfill: migrate existing rows
UPDATE user_notes
SET scope_kind = 'portfolio',
    scope_ref  = portfolio_id::text
WHERE portfolio_id IS NOT NULL;

-- Drop any dangling NULL-portfolio_id rows (production verified zero, but
-- preview branches may have legacy test data).
DELETE FROM user_notes WHERE portfolio_id IS NULL;
```

### Finding #5: LAYOUT_VERSION bump decision

**Answer: BUMP 2 → 3.**

**Rationale:** The existing `DEFAULT_LAYOUT` in `dashboard-defaults.ts:17-33` does NOT contain a `notes-widget` entry — the NotesWidget lives in the widget registry (`widgets/index.ts:95-97`) but is not part of the default dashboard layout. Users who have the widget on their dashboard added it manually via AddWidgetModal.

Phase 08 CONTEXT.md D-15 says NotesWidget "upgrades in place" — meaning users who already have it get upgraded behavior. But D-24 + UI-SPEC §4a specify inserting the widget into `DEFAULT_LAYOUT` at position `x:0, y:27, w:4, h:4` so new users see it out of the box.

**Any change to `DEFAULT_LAYOUT` → LAYOUT_VERSION bumps** per the convention in `dashboard-defaults.ts:7-14`. Precedent: Phase 05 bumped 1→2 for the Outcomes widget.

**Impact:** localStorage-persisted layouts reset for all existing users. Accepted tech debt per Voice-D8 (PROJECT.md line 68). No user-facing banner.

**Alternative considered (NO bump):** If planner decides NOT to add NotesWidget to DEFAULT_LAYOUT (keep it opt-in-via-AddWidget), LAYOUT_VERSION stays at 2. UI-SPEC §8 explicitly recommends the bump; recommend following UI-SPEC.

### Finding #6: ADR-0023 rename blast radius

**Answer: Safe — 5 in-repo references, zero external consumers.**

Grep for literal `portfolio_note.update`:
| File | Lines | Change |
|------|-------|--------|
| `src/lib/audit.ts` | 106, 162 | Remove `"portfolio_note.update"` from `AuditAction` union; remove `"portfolio_note"` from `AuditEntityType` union; add 4 `user_note.{scope}.update` + `user_note` entity. |
| `docs/architecture/adr-0023-audit-event-taxonomy.md` | 75, 134 | Replace enum literal + table row. Add 3 new rows for holding/bridge_outcome/strategy. |
| `src/__tests__/audit-fanout-integration.test.ts` | 15, 241-295 | Rewrite describe block + assertion. Add 3 parallel blocks. |
| `src/app/api/notes/route.ts` | 116, 117 | Replace action + entity_type literal. |

**No dashboard, log consumer, or external service reads `audit_log` by `action='portfolio_note.update'`.** The `audit_log` hot table does have **existing rows** with that action string (historical forensic value per ADR-0023 §6) — they stay as-is, immutable. Grepping audit_log for either old or new name returns the appropriate history; no UNION needed unless a Phase 11 dashboard surfaces a time-series chart.

**Safe to rename in a single atomic commit** (D-23 already requires ADR + code in same commit).

### Finding #7: Holding-row note-icon column placement (leading vs trailing)

**Answer: Trailing.**

**Rationale:**
1. **Reading flow:** Holdings tables read left-to-right: identity (venue, symbol) → metrics (qty, value_usd, price, pnl) → actions. The note icon is an annotation-action, belongs with actions.
2. **Precedent:** `AllocatorExchangeManager.tsx` places "Sync now" + "Remove" buttons trailing in the row (lines 550-569). Follow the convention.
3. **Disruption minimization:** Currently no HoldingsTable renders `allocator_holdings` directly in `(dashboard)/allocations` (zero grep hits for `allocator_holdings` in that directory). The new HoldingsTable is net-new in Plan 4. Placing the icon trailing means existing column positions from query-layer `holdingsSummary` projections don't need to shift.
4. **Density:** Table rows are 44px minimum (DESIGN.md). A 32×32 icon button fits trailing without compromising the touch target of metric columns.

**Confirmed by UI-SPEC §3** which also recommends trailing.

### Finding #8: LogAuditEvent signature + entity_id strategy

**Answer: `AuditEvent.entity_id` type in TypeScript is `string`, but the underlying `log_audit_event` RPC's `p_entity_id` is UUID-typed (per ADR-0023 §4 and migration 049 referenced there). Composite `{scope_kind}:{scope_ref}` will fail the RPC's UUID cast.**

From `src/lib/audit.ts:182-186`:
```typescript
export interface AuditEvent {
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string;              // <- string at the TS boundary
  metadata?: Record<string, unknown>;
}
```

**Resolution:** Use per-scope-appropriate UUID in `entity_id`; push composite context into `metadata`.

| scope_kind | entity_id (UUID) | Rationale |
|------------|------------------|-----------|
| portfolio | `portfolios.id` (i.e. scope_ref as UUID) | Matches existing `portfolio_note.update` convention. |
| bridge_outcome | `bridge_outcomes.id` (scope_ref as UUID) | Natural entity row. |
| strategy | `strategies.id` (scope_ref as UUID) | Natural entity row. |
| holding | `profiles.id` of the author (= caller's own `auth.uid()`) | No single row represents a holding-scope note (it aggregates across daily snapshots). Matches ADR-0023 §4 pattern used by `attestation.accept` which uses `caller's own profiles.id` when no single row applies. |

**Metadata (all 4 scopes):**
```json
{ "scope_kind": "holding", "scope_ref": "binance:BTC:spot", "content_length": 142 }
```

**Grep-ability preserved:** `audit_log WHERE action LIKE 'user_note.%'` returns all note events; filter by metadata->>'scope_kind' for a specific scope.

**Helper function** (included in code sample):
```typescript
function resolveEntityId(
  scope_kind: ScopeKind,
  scope_ref: string,
  userId: string,
): string {
  return scope_kind === "holding" ? userId : scope_ref;
}
```

**Update D-20 at plan time:** Metadata carries `{scope_kind, scope_ref, content_length}`; entity_id carries scope-appropriate UUID. Content is NEVER echoed (D-14/D-20 privacy invariant).

### Finding #9: Holding scope_ref parsing edge cases

**Answer: Symbols never contain `/` or `:`.** CONTEXT.md D-08 example `okx:BTC/USDT:USDT:derivative` is **INACCURATE**.

**Evidence:** `analytics-service/services/positions.py:111-114`:
```python
# Symbol: strip the funding/settlement suffix for display
# "BTC/USDT:USDT" → "BTCUSDT"
symbol = pos.get("symbol", "")
symbol = symbol.replace("/", "").replace(":USDT", "").replace(":USD", "")
```

All `allocator_holdings.symbol` values are stripped CCXT form:
- Spot (from `fetch_balance`): raw currency code → `"BTC"`, `"ETH"`, `"USDT"` (see `allocator_positions.py:151`).
- Derivative (from `fetch_positions`): stripped unified → `"BTCUSDT"`, `"BTCUSD"` (derived from `BTC/USDT:USDT` etc).

**scope_ref format: `{venue}:{symbol}:{holding_type}` — exactly 3 colon-separated parts.**
- venue: lowercase alphabetic (`binance`, `okx`, `bybit`, `deribit`, `kraken`, `coinbase`)
- symbol: uppercase alphanumeric (`BTC`, `BTCUSDT`, `ETHUSDT`)
- holding_type: `spot` or `derivative`

**Parser: simple regex.** (Code sample in Pattern 2 above.)
```typescript
const HOLDING_SCOPE_RE = /^([a-z]+):([A-Z0-9]+):(spot|derivative)$/;
```

**Edge cases tested:**
- Malformed ref (wrong number of parts): regex fails → `parseHoldingScopeRef` returns `null` → route returns 400.
- Lowercase venue enforced: a client that sends `"Binance:BTC:spot"` fails parse. Good — the worker writes lowercase venues.
- Numeric-only symbols (e.g. `1000PEPE` on Binance perps): matches `[A-Z0-9]+` ✅.
- Hyphenated symbols: DO NOT occur post-strip. If a future exchange introduces hyphens, regex needs extension.

### Finding #10: GDPR manifest survival

**Answer: Safe — manifest is table-level, not column-level.**

`src/lib/gdpr-export.ts:113`:
```typescript
{ kind: "direct", table: "user_notes", user_column: "user_id" },
```

**The manifest enumerates `user_column` only — NOT the full column list.** Migration 071 changes columns (adds `scope_kind`, `scope_ref`; drops `portfolio_id`) but keeps `user_id`. The manifest entry survives unchanged.

**Coverage hook test (`src/__tests__/gdpr-export-coverage-hook.test.ts`):** Asserts the hook exits 0 against the current manifest (line 30-41). The hook greps migrations for tables with `user_id` columns and checks they appear in `USER_EXPORT_TABLES`. Since `user_notes` stays in the manifest AND still has `user_id`, the hook remains green post-migration.

**Export payload change:** Exported rows now include `scope_kind`/`scope_ref` instead of `portfolio_id`. Callers of `collectUserExportBundle` that depend on specific column names in `user_notes` rows would need to update. Verified: zero callers depend on `user_notes.portfolio_id` — only the export route itself reads the rows, and it passes them through as `unknown[]`.

**Action required:** None for the manifest. Plan 1 adds a unit test asserting the export still includes `user_notes` post-reshape.

### Finding #11: RLS regression test pattern

**Answer: Mirror `allocator-holdings-rls.test.ts` two-actor shape; reduce matrix to high-signal leakage probe.**

**Full matrix (64 assertions) is excessive.** 4 scopes × 2 users × 4 ops × 2 directions = bloat. Reduce by exploiting RLS policy homogeneity: all 4 RLS policies on `user_notes` are identical (`user_id = auth.uid()`). One leakage probe per op×direction covers all scopes; 1 probe per scope covers the app-layer ownership check.

**Recommended matrix (14 assertions):**

| Test # | Actor | Op | Target | Expected | Covers |
|--------|-------|-----|--------|----------|--------|
| 1 | A | SELECT | own portfolio note | 1 row, own content | RLS SELECT own |
| 2 | A | SELECT | B's portfolio note (by A's scope_ref) | 0 rows | RLS SELECT cross-user |
| 3 | A | UPDATE | own portfolio note | 200 | RLS UPDATE own |
| 4 | A | UPDATE | B's portfolio note (by UUID) | 0 rows affected | RLS UPDATE cross-user |
| 5 | A | INSERT | with `user_id=B` | RLS error | RLS INSERT cross-user gate |
| 6 | A | DELETE | B's portfolio note | 0 rows | RLS DELETE cross-user |
| 7 | A | PATCH /api/notes (portfolio) | B's portfolio UUID | 403 | app-layer ownership portfolio |
| 8 | A | PATCH /api/notes (holding) | B's venue:symbol:type | 403 | app-layer ownership holding |
| 9 | A | PATCH /api/notes (bridge_outcome) | B's bridge_outcome UUID | 403 | app-layer ownership bridge_outcome |
| 10 | A | PATCH /api/notes (strategy) | any published strategy UUID | 200 | strategy is public-notable |
| 11 | A | PATCH /api/notes (strategy) | unpublished strategy UUID | 403 | strategy ownership predicate |
| 12 | A | PATCH with malformed scope_ref `"binance:BTC"` (2 parts) | 400 | parser rejection |
| 13 | A | PATCH with scope_kind=foo | 400 | zod validation |
| 14 | A | upsert same note twice, rapid | both succeed; 1 row in DB | ON CONFLICT idempotency |

**Shape:** tests 1-6 are live-DB gated (`it.skipIf(!HAS_LIVE_DB)`), using the same `createTestUser` / `seedApiKey` / `seedHolding` helpers as `allocator-holdings-rls.test.ts`. Tests 7-14 are mocked-Supabase route tests (extend `src/app/api/notes/route.test.ts`).

**File placement:**
- Live-DB: `src/__tests__/user-notes-multiscope-rls.test.ts` (tests 1-6 + 14).
- Mocked: `src/app/api/notes/route.test.ts` (tests 7-13, extends existing file).

## Security Domain

*(Required — security_enforcement is enabled by default.)*

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase auth.getUser() already shipped; no new auth surface |
| V3 Session Management | yes | Supabase SSR session cookie; no new session state in Phase 08 |
| V4 Access Control | yes | **Per-scope ownership (D-09)** app-layer check + `user_notes` RLS (D-14). RLS matrix test covers V4.3 (IDOR prevention). |
| V5 Input Validation | yes | zod schema on `/api/notes` PATCH body; 100KB byte cap; holding scope_ref regex strict |
| V6 Cryptography | no | No new crypto surface — notes are plain text, encryption-at-rest is Postgres TDE + Supabase disk encryption (existing) |
| V14 Output Encoding / XSS | yes | **rehype-sanitize defaultSchema** blocks script/iframe/style/on*/`javascript:` URLs. Link rewrite `rel="noopener noreferrer" target="_blank"` prevents tabnabbing. |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| **Stored XSS via markdown** | Tampering / Info Disclosure | `rehype-sanitize` with `noteSanitizeSchema` at render time; `react-markdown` escapes raw HTML by default (no `rehype-raw`); fuzz tests in `NoteRender.test.tsx` cover `<script>`, `<img onerror>`, `<a href=javascript:>`, `<iframe>`, `<style>`. |
| **IDOR — note read/write across allocators** | Elevation of Privilege | Two-layer defense: (1) `user_notes` RLS enforces `user_id = auth.uid()` at DB; (2) `/api/notes` PATCH ownership check validates scope_ref belongs to caller. Regression probe in Finding #11 §Tests 2, 4, 7-9. |
| **IDOR — disconnect another allocator's key** | Elevation of Privilege | `delete_allocator_api_key` RPC verifies `auth.uid() = api_keys.user_id` INSIDE the RPC (migration 069 lines 40-45). Unchanged by Phase 08. |
| **Prototype pollution via markdown frontmatter** | Tampering | Not applicable — we do not enable `remark-frontmatter` or `rehype-mdx`. Only `remark-gfm` + `rehype-sanitize`. |
| **ReDoS via user-supplied regex in markdown** | DoS | Not applicable — markdown doesn't allow user regex. remark-gfm autolinker uses hand-rolled state machine (verified). |
| **Tabnabbing (`target="_blank"` without `rel`)** | Spoofing | `components={{ a: (...) => <a rel="noopener noreferrer" target="_blank" /> }}` — Pattern 3. Unit-tested in `NoteRender.test.tsx`. |
| **Leakage via audit metadata echo** | Info Disclosure | `logAuditEvent` metadata is `{scope_kind, scope_ref, content_length}` — content NEVER echoed per D-20. Regression: audit-fanout-integration test asserts `args.p_metadata.content` is `undefined`. |
| **Content over 100KB DoS** | DoS | Byte-cap `new TextEncoder().encode(content).length > 100 * 1024` returns 400 pre-DB. CHECK constraint in SQL is defense-in-depth. |
| **SQL injection via scope_ref** | Tampering | scope_ref passes through Supabase parameterized builder (`.eq("scope_ref", value)`); never string-interpolated. zod schema limits length to 512. |
| **CSRF on PATCH** | Tampering | Same-origin cookie (Supabase session) + fetch `credentials: "same-origin"` — existing convention. |
| **Cascade-delete data loss via default-checked checkbox** | Tampering / Integrity | D-02 flips default to UNCHECKED — user must explicitly opt in to delete historical holdings. UI-SPEC §1 locks the copy. |

## Sources

### Primary (HIGH confidence)

- **Context7 `/remarkjs/react-markdown`** — `rehypePlugins` config pattern, `defaultUrlTransform` security model, `rehype-sanitize` composition. Queried 2026-04-21.
- **GitHub `syntax-tree/hast-util-sanitize` README** — defaultSchema tagNames list, href protocol allowlist (`http, https, irc, ircs, mailto, xmpp`), attribute allowlist for `<a>`. Queried 2026-04-21.
- **npm registry** (`npm view react-markdown | remark-gfm | rehype-sanitize`) — exact version pins, peer dependencies, bundle sizes. Queried 2026-04-21.
- **Live Supabase REST API** (`khslejtfbuezsmvmtsdn.supabase.co`) — verified 0 rows in `user_notes` with `portfolio_id IS NULL`, 0 rows total. Queried 2026-04-20 22:50 UTC.
- **Next.js 16.2.3 installed docs** `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` — Route Handler signature stability for PATCH; no caching gotchas.
- **Codebase source reads** — `src/app/strategy/[id]/page.tsx`, `src/app/api/notes/route.ts`, `src/components/exchanges/AllocatorExchangeManager.tsx`, `src/components/mandate/useMandateAutoSave.ts`, `src/components/mandate/MandateSaveStatus.tsx`, `src/app/(dashboard)/allocations/widgets/meta/NotesWidget.tsx`, `src/lib/audit.ts`, `src/lib/gdpr-export.ts`, `src/__tests__/allocator-holdings-rls.test.ts`, `src/__tests__/gdpr-export-coverage-hook.test.ts`, `analytics-service/services/positions.py`, `analytics-service/services/allocator_positions.py`, `supabase/migrations/037_user_notes.sql`, `supabase/migrations/069_delete_allocator_api_key_rpc.sql`.
- **ADR-0023** `docs/architecture/adr-0023-audit-event-taxonomy.md` — entity_type/entity_id conventions, rename-safety analysis.
- **Grep sweeps** — `portfolio_note.update` blast radius (5 files), `allocator_holdings` consumer sweep in `/allocations` directory (0 hits — HoldingsTable is net-new).

### Secondary (MEDIUM confidence)

- **GitHub `rehypejs/rehype-sanitize` README** (via WebFetch) — default schema extension pattern. Cross-referenced with hast-util-sanitize default for concrete tag list.

### Tertiary (LOW confidence)

- None. All critical claims cross-verified against two or more HIGH-confidence sources.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — npm registry verified exact versions + peer deps; Context7 confirmed integration patterns.
- Architecture: **HIGH** — codebase source reads for every referenced component; migrations 037/066/069 verified; ADR-0023 verified.
- Pitfalls: **HIGH** — drawn from Pitfall 2 (ON CONFLICT rebuild — verified via current route.ts:99), Pitfall 4 (cascade-flip — verified via AllocatorExchangeManager.tsx:692-697), Pitfall 6 (scope_ref table — verified via queries.ts:204).
- Security: **HIGH** — sanitizer defaults verified via hast-util-sanitize README + Context7.
- Runtime state: **HIGH** — zero global notes verified via live DB count query.

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (30 days — stable tooling; markdown stack is mature).

## RESEARCH COMPLETE

**Phase:** 08 - Connection Management and Notes
**Confidence:** HIGH

### Key Findings

- **Sprint-3 global notes count = 0** (verified via live REST query) → migration 071 drops NULL-portfolio_id rows outright; no sentinel needed.
- **Strategy scope_ref = `strategies.id`** — `match_strategies`/`verified_strategies` tables do not exist. CONTEXT.md D-18 needs a one-line correction at commit.
- **Holding symbols never contain `/` or `:`** — Phase 06 worker strips CCXT form before insert. Parser is a strict 3-part regex split, not the complex case CONTEXT.md implied.
- **`portfolio_note.update` rename blast radius = 5 in-repo files, zero external consumers** → safe atomic rename.
- **Markdown deps verified: `react-markdown@10.1.0` + `rehype-sanitize@6.0.0` + `remark-gfm@4.0.1`** — all compatible with React 19.2.4 + Next 16.2.3; default sanitize schema already GitHub-style (tables/del/strike included) — only `<img>` needs explicit removal.
- **`react-markdown` escapes raw HTML by default** — no `rehype-raw` (explicitly rejected). Sanitizer is belt-and-suspenders against remark plugin bugs.
- **LAYOUT_VERSION bump 2→3 required** — Phase 08 adds `notes-1` to `DEFAULT_LAYOUT` per UI-SPEC §8; follows Voice-D8 accepted tech debt.
- **Holding-row note icon = trailing column** — matches `AllocatorExchangeManager` action-column convention + zero shift to existing columns.
- **`audit_log.entity_id` is UUID-typed per ADR-0023** — use per-scope-appropriate UUID in entity_id (portfolio.id / bridge_outcome.id / strategy.id / profiles.id-for-holding); put composite context in metadata. Refines D-20.
- **Disconnect modal's disabled-button gate has an extra subexpression** that Phase 08 must delete when flipping cascade to optional (Pitfall 4).

### File Created

`/Users/helios-mammut/claude-projects/quantalyze/.planning/phases/08-connection-management-and-notes/08-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | npm registry verified; peer deps compat with React 19.2.4 confirmed |
| Architecture | HIGH | All referenced code paths source-read; migrations 037/066/069 verified |
| Pitfalls | HIGH | Concrete line references in existing code; 4 pitfalls map to specific regressions |
| Security | HIGH | Sanitizer defaults verified via two sources; ASVS mapping concrete |
| Runtime State | HIGH | Live DB count query ran and returned 0 |

### Open Questions

- **A1 (bridge_outcomes column name)** — Plan 1 should read migration 059 line-by-line to confirm `allocator_id` column exists before coding the ownership check. Risk: LOW (ADR-0023 references `bridge_outcome.allocator_id` in 2 places).
- **Retry generation-guard on `useNoteAutoSave` 5xx retry** — follow the mandate pattern verbatim (included in Pattern 4 code sample).
- **Discovery-card note icon** — recommended for Phase 08 Plan 3; planner may defer to keep plan scope lean.

### Ready for Planning

Research complete. Planner can now create 4 PLAN.md files following the D-24 indicative partition or re-partition as fit. All Claude's-Discretion open items resolved; migration 071's backfill is a known no-op in production; all deps' versions are pinned.

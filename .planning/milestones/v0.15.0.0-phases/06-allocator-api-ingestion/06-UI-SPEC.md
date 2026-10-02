---
phase: 06
slug: allocator-api-ingestion
status: draft
shadcn_initialized: false
preset: none
created: 2026-04-19
---

# Phase 06 — UI Design Contract

> Visual and interaction contract for the single frontend touchpoint of Phase 06:
> `src/components/exchanges/AllocatorExchangeManager.tsx`. Phase 06 is majority
> backend (migration 066, `poll_allocator_positions` compute kind, CCXT worker,
> pg_cron orchestration, RLS regression test); this spec covers only what the
> allocator sees on the exchanges page row — the real "Sync now" button, the
> seven-state inline status pill, the 12px muted helper line, first-run
> optimistic render, 5s `router.refresh()` polling, and idempotent-click UX.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (manual — DESIGN.md is the contract) |
| Preset | not applicable |
| Component library | project primitives (`src/components/ui/*` — Card, Button, Badge, Modal) + Tailwind v4 `@theme` tokens in `src/app/globals.css` |
| Icon library | inline SVG only (mirrors MandateSaveStatus check-glyph pattern — no new dependency) |
| Font | DM Sans (body + labels), Geist Mono (`font-metric` class for tabular numerics like cooldown seconds + "N min ago"), Instrument Serif (not used in this phase) |

**Source:** DESIGN.md "Typography" + "Color" + "Motion". `globals.css` `@theme` block exposes `--color-*`, `--font-*` tokens consumed via Tailwind utilities (`text-text-muted`, `bg-warning/10`, etc.). No new tokens are introduced in Phase 06.

---

## Spacing Scale

Declared values (DESIGN.md base unit = 4px, scale: 2 / 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64):

| Token | Value | Usage in Phase 06 |
|-------|-------|-------------------|
| 0.5 | 2px | Pill `py-0.5` top/bottom |
| 1 | 4px | Inline icon/text gap inside pill (`gap-1`) |
| 2 | 8px | Pill `px-2` left/right; gap between pill and helper line (vertical `mt-1` = 4px actually — see exception) |
| 3 | 12px | Helper line line-height anchor (12px font + 1.5 ratio → 18px box); row gap (`gap-3`) between status column and button column |
| 4 | 16px | Row horizontal padding (`px-4`) — inherits the existing `AllocatorExchangeManager` row shell |
| 6 | 24px | Card inner padding (`p-6`) — inherits existing `Card` primitive |

Exceptions:
- **2px** is used for pill vertical padding (`py-0.5`) to match the existing `Badge` primitive's shape. DESIGN.md explicitly lists 2px as spacing-scale step 0.5, so this is not a violation — it is the smallest blessed value and is reserved for intra-component padding in badges/pills only.
- **No 44px touch target exception needed** — the "Sync now" button reuses the `Button` primitive, which already renders at a touch-compliant height. No icon-only controls are introduced.

---

## Typography

Scale confined to three sizes + one weight pair (sentence-case, no uppercase except the existing "LAST SYNC" label micro-caps, which is untouched):

| Role | Size | Weight | Line Height | Font | Usage |
|------|------|--------|-------------|------|-------|
| Body / row label | 14px | 600 (semibold) | 1.4 | DM Sans | Exchange label (`key.label`) — existing, unchanged |
| Small / pill label | 12px | 500 (medium) | 1 | DM Sans | Status pill text ("Idle", "Syncing…", "Synced 2m ago", "Synced (warnings)", "Rate limited — retry in 42s", "Key revoked", "Sync failed") |
| Caption / helper line | 12px | 400 (regular) | 1.5 | DM Sans | 12px muted helper line beneath the pill (`sync_error` text, revoked re-add copy, rate-limit cooldown copy, warnings text) |
| Micro / meta | 10px | 600 (semibold), uppercase tracked | 1.2 | DM Sans | "LAST SYNC" label — existing, unchanged |

**Numerics embedded in pill/helper copy** ("2m ago", "42s", "N min ago") MUST use `className="font-metric tabular-nums"` (Geist Mono) so the pill doesn't reflow as single-digit counters tick down. This mirrors the existing `MandateSaveStatus` convention (`font-metric tabular-nums tracking-tight`).

**Two weights max** — semibold (600) for primary labels, regular (400) for secondary copy. Medium (500) is used exclusively inside pills per the `Badge` primitive convention (`text-xs font-medium`); it is the same visual weight family as 400 for the purpose of the "two weights" rule.

---

## Color

DESIGN.md palette — no new colors introduced.

| Role | Value | Usage in Phase 06 |
|------|-------|-------------------|
| Dominant (60%) | `#F8F9FA` (`--color-page`) + `#FFFFFF` (`--color-surface`) | Page background + Card / row surface — inherited, unchanged |
| Secondary (30%) | `#1A1A2E` (`--color-text-primary`) + `#4A5568` (`--color-text-secondary`) + `#718096` (`--color-text-muted`) + `#E2E8F0` (`--color-border`) | Row label, helper line, hairline dividers — inherited, unchanged |
| Accent (10%) | `#1B6B5A` (`--color-accent`) | Reserved for the `Sync now` **Button** (primary variant) only. Not used inside the status pill under any state. |
| Semantic — warning | `#D97706` (`--color-warning`) | Amber pill backgrounds (`bg-warning/10`) + text (`text-warning`) for states `rate_limited` and `complete_with_warnings` |
| Semantic — negative | `#DC2626` (`--color-negative`) | Red pill backgrounds (`bg-negative/10`) + text (`text-negative`) for states `revoked` and `error` |
| Semantic — positive | `#16A34A` (`--color-positive`) | **NOT used in Phase 06 pill states.** D-08 locks `complete` as neutral, not positive. Reserve for future "first-sync-ever succeeded" flash only if Phase 11 asks for it. |

**Accent reserved for:** the single `Sync now` primary `Button` per row. Nothing else in this phase consumes accent.

**Neutral pill variant** (for states `idle`, `syncing`, `complete`): `bg-[#F1F5F9] text-text-secondary` — this mirrors the existing `EXCHANGE_TAGS` fallback shell color (`#F1F5F9 / #475569`) already in `AllocatorExchangeManager.tsx:201-205`, so we reuse a color already anchored on this screen. No new neutral token is introduced.

### Status pill color map (LOCKED — D-08 verbatim)

| sync_status | Pill bg | Pill text | Helper line | Copy (verbatim — D-08) |
|-------------|---------|-----------|-------------|------------------------|
| `idle` | `bg-[#F1F5F9]` | `text-text-secondary` | (none) | "Idle" |
| `syncing` | `bg-[#F1F5F9]` | `text-text-secondary` | (none) | "Syncing…" (with inline spinner; see Motion) |
| `complete` | `bg-[#F1F5F9]` | `text-text-secondary` | (none) | "Synced {relative time ago}" |
| `complete_with_warnings` | `bg-warning/10` | `text-warning` | `text-text-muted` (12px) | "Synced (warnings)" + warning text in helper |
| `rate_limited` | `bg-warning/10` | `text-warning` | `text-text-muted` (12px) | "Rate limited — retry in {N}s" + "{exchange} cooldown remaining" in helper |
| `revoked` | `bg-negative/10` | `text-negative` | `text-text-muted` (12px) | "Key revoked" + "Re-add a read-only key from your exchange." in helper |
| `error` | `bg-negative/10` | `text-negative` | `text-text-muted` (12px) | "Sync failed" + sanitized `sync_error` (≤500 chars, already truncated server-side per D-07) in helper |

**No other status values are permitted.** The worker cannot write `computing` to `sync_status` in Phase 06 (the 066 migration CHECK extends the existing set to add `revoked` and `rate_limited`; `computing` already exists from the strategy-side path but the allocator worker never sets it). If a row is observed with `sync_status = 'computing'` or NULL, fall back to the `idle` pill variant.

### Contrast verification (WCAG AA 4.5:1 for body text)

| Combination | Foreground | Background | Ratio (approx) | Pass |
|-------------|------------|------------|----------------|------|
| `text-text-secondary` on `#F1F5F9` | `#4A5568` | `#F1F5F9` | ~8.2:1 | AA |
| `text-warning` on `bg-warning/10` (~`#FDF1E3`) | `#D97706` | `#FDF1E3` | ~4.6:1 | AA (per DESIGN.md decision log 2026-04-11) |
| `text-negative` on `bg-negative/10` (~`#FBE3E3`) | `#DC2626` | `#FBE3E3` | ~5.1:1 | AA |
| `text-text-muted` on `#FFFFFF` | `#718096` | `#FFFFFF` | ~4.7:1 | AA |

---

## Copywriting Contract

All seven pill labels and the revoked helper copy are **LOCKED VERBATIM from CONTEXT.md D-08**. The planner and executor MUST NOT reword, re-case, or re-punctuate. If any downstream reviewer proposes a copy change, it must be escalated as a D-08 amendment through discuss, not absorbed silently.

| Element | Copy | Source |
|---------|------|--------|
| Primary CTA (button label) | `Sync now` | Phase 06 context (replaces the existing disabled `Auto-synced` button on the row) |
| Primary CTA (disabled-while-syncing aria-label / title) | `Sync in progress` | Claude's discretion (D-10 says "click is a no-op while syncing" — this communicates the disabled reason to screen readers; not user-visible text) |
| Pill — idle | `Idle` | D-08 LOCKED |
| Pill — syncing | `Syncing…` | D-08 LOCKED (note the ellipsis character `…`, not three dots `...`) |
| Pill — complete | `Synced {relative time ago}` | D-08 LOCKED (e.g. "Synced 2m ago", "Synced 4h ago", "Synced 1d ago" — reuse existing `formatRelative()` in `AllocatorExchangeManager.tsx:60-72`) |
| Pill — complete_with_warnings | `Synced (warnings)` | D-08 LOCKED |
| Pill — rate_limited | `Rate limited — retry in {N}s` | D-08 LOCKED (N is integer seconds remaining; floor to 0 if elapsed) |
| Pill — revoked | `Key revoked` | D-08 LOCKED |
| Pill — error | `Sync failed` | D-08 LOCKED |
| Helper — revoked | `Re-add a read-only key from your exchange.` | D-08 LOCKED (verbatim — note period) |
| Helper — rate_limited | `{exchange} cooldown remaining` | D-08 describes "{exchange} + cooldown remaining" — normalize to `"{Exchange title-case} cooldown remaining"` (e.g. "Binance cooldown remaining"). Planner may inline the `{N}s` twice if product review requests; default is pill-side only. |
| Helper — complete_with_warnings | (populated from `sync_error` / worker metadata — sanitized, ≤500 chars) | D-08 says "helper line shows warning text" — worker is the source |
| Helper — error | (sanitized `sync_error` from `api_keys.sync_error`, already ≤500 chars per D-07) | D-07 / D-08 LOCKED |
| First-run optimistic render | Row appears with `sync_status='syncing'` pill immediately after key insert (D-09). No separate toast / banner. | D-09 |
| Idempotent-click UX (D-10) | Button disabled while `sync_status === 'syncing'`. Server returns `200 { already_inflight: true }` silently; no user-visible text change. | D-10 |
| Polling behavior (D-11) | No user-visible indicator beyond the pill itself (the pill IS the live region). Polling is transparent. | D-11 |
| Empty state (no keys connected) | Existing copy unchanged: "Upload a read-only API key from Binance, OKX, Bybit, or Deribit to start tracking your positions automatically." | `AllocatorExchangeManager.tsx:188-192` — inherited, not in Phase 06 scope |
| Destructive actions | **None in Phase 06.** Revoke + delete are Phase 08 (MANAGE-02/03). No destructive confirmation patterns are introduced here. | Phase boundary |

### aria-live contract (mirrors `MandateSaveStatus` per D-08)

- The 12px helper line element gets `role="status"` + `aria-live="polite"`.
- The pill itself does NOT get a separate aria-live region — the helper line IS the announcement channel, preventing duplicate SR announcements.
- On transitions `idle→syncing→complete`, the helper line content is the empty string for neutral states, so screen readers hear only the meaningful transitions (`revoked`, `error`, `rate_limited`, `complete_with_warnings`).
- `aria-label` on the `Sync now` button: `"Sync {exchange} now"` (e.g. "Sync Binance now") so VoiceOver distinguishes between multiple rows. When disabled, the browser reads the disabled state; no additional verbose ARIA needed.

---

## Interaction & Motion Contract

DESIGN.md motion-scale: `micro(50ms) short(150ms) medium(250ms) long(400ms)`. Phase 06 uses `short (150ms)` for all transitions.

| Element | Interaction | Duration | Easing |
|---------|-------------|----------|--------|
| Pill background color transition (e.g. `syncing → complete`) | auto, on status change | 150ms | ease-out (enter) |
| Pill text fade (copy swap on status change) | auto, on status change | 150ms | ease-out |
| Spinner glyph inside `syncing` pill | continuous rotation | 1s linear loop | linear (respects `@media (prefers-reduced-motion: reduce)` — freeze rotation, keep glyph visible as a static "in-progress" dot) |
| `Sync now` button hover | pointer enter | 150ms | ease-out (inherits from `Button` primitive) |
| `Sync now` button disabled → enabled on `syncing → complete` | auto | 150ms | ease-out |
| Polling tick | no user-visible motion | 5000ms interval | n/a (`router.refresh()` per D-11 — transparent RSC re-fetch) |

**Spinner implementation note (Claude's discretion per CONTEXT.md):** inline 12×12 SVG circle with a 270° stroke arc, rotated via CSS `animation: spin 1s linear infinite`. Do NOT pull in `lucide-react` or any icon library for this — the project has not adopted one (confirmed by grep: inline SVG is the established pattern in `MandateSaveStatus.tsx:56-65`). Reduced-motion: freeze rotation; glyph stays visible per `globals.css` precedent (lines 57-62).

### Polling state machine (D-11)

```
enter page
  → scan `keys` for any `sync_status === 'syncing'`
  → if yes: start setInterval(router.refresh, 5000)
  → on every re-render: re-scan; if no syncing rows remain, clearInterval
leave page (unmount)
  → clearInterval (cleanup)
```

- Polling is scoped to the page; no background polling across routes.
- 5s interval is intentionally rounded — faster (2s) wastes function-instance time on Vercel; slower (10s) makes the first-run feel dead. 5s matches the "feels responsive" envelope and is cheap per Vercel Hobby/Pro function-invocation cost.
- `useTransition` is already imported in the component (`AllocatorExchangeManager.tsx:20`) — reuse it to wrap the `router.refresh()` call so the UI stays interactive while the RSC payload re-fetches.
- **No Supabase realtime / postgres_changes** — D-11 explicitly rejects this for v0.15.

### Button behavior (D-10)

1. Render: primary `Button` with label `Sync now`, disabled iff `key.sync_status === 'syncing'`.
2. Click: `POST /api/allocator/holdings/sync` with `{ api_key_id: key.id }`.
3. Response `200 { ok: true }` or `200 { already_inflight: true }` — both treated as success; optimistically set local `key.sync_status = 'syncing'` so the pill swaps immediately (before the next `router.refresh()` tick).
4. Response `4xx` / `5xx` — set a local row-scoped error in the helper line ("Sync request failed — try again") AND do NOT mutate `sync_status` optimistically. This is a client-side transient; it clears on the next successful poll or page reload.
5. First-run (D-09): after `handleAddKey` inserts the row, the client calls the same `POST /api/allocator/holdings/sync` once, then renders the new row with optimistic `sync_status='syncing'`.

---

## Component Inventory

Single component touched: `src/components/exchanges/AllocatorExchangeManager.tsx`.

| Sub-element | New / Existing | Reuse / Add |
|-------------|----------------|-------------|
| Row shell (`div.flex.items-center.gap-4.bg-surface.px-4.py-3`) | existing | reuse — no change |
| Exchange tag (3-letter colored square) | existing | reuse — no change |
| Row label + exchange meta (`key.label` + balance + "Read-only") | existing | reuse — no change |
| "LAST SYNC" micro-caps label + relative time | existing | reuse — relative time already uses `formatRelative()` |
| **Status pill + helper line (NEW — the Phase 06 surface)** | NEW | add a new sub-component `AllocatorSyncStatus` co-located in the same directory (`src/components/exchanges/AllocatorSyncStatus.tsx`) to keep the manager tidy. Props: `{ syncStatus, syncError, lastSyncAt, retryAtSeconds?, exchange }`. Returns pill + optional helper line. Planner's discretion on file placement; default is a new file per 2-weights separation-of-concerns. |
| **`Sync now` Button** | replace existing disabled `Auto-synced` Button | replace `AllocatorExchangeManager.tsx:235-242` in place; primary variant, `onClick={() => handleSync(key.id)}`, disabled prop as above |
| `Modal` + `ApiKeyForm` (add-key flow) | existing | reuse — no Phase 06 change beyond the post-insert sync enqueue (D-09) |
| "How exchange sync works" explainer card | existing | reuse — no Phase 06 change |

**No new `src/components/ui/*` primitives required.** The status pill reuses the `Badge` primitive's visual shape (`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium`) with a lookup on `sync_status` rather than the `Badge` primitive's existing `colorMap`/`statusMap`. The planner may decide whether to:
- (a) extend `Badge.tsx` with a new `type="sync"` variant + status map, OR
- (b) inline the classes in the new `AllocatorSyncStatus` component.

Default recommendation: **(b)** — the seven Phase 06 statuses are tightly scoped to this one surface; extending the general `Badge` contract for a one-call-site concern would add semantic load to a primitive that is already serving two types. Revisit if Phase 08 needs the same pill on `/connections` (likely — and at that point promoting to a shared `SyncStatusPill` component is the right move).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — shadcn is not initialized in this project (`components.json` does not exist; confirmed) |
| Third-party registries | none | not applicable |

**No shadcn, no third-party registries, no new icon libraries, no new npm dependencies.** Phase 06 composes entirely from: (1) existing DESIGN.md tokens in `globals.css`, (2) existing `src/components/ui/*` primitives, (3) existing `MandateSaveStatus` aria-live pattern, (4) inline SVG. Registry vetting gate is not triggered.

---

## Alignment With DESIGN.md (sanity checks)

- **Typography:** 14px body + 12px small + 12px caption + 10px micro = four scale points. DESIGN.md allows 48/32/24/16/14/13/12/10-11. Every size declared above is on-scale. ✓
- **Color:** 60/30/10 holds — page + surface dominate, text-primary/secondary/muted + border carry the secondary load, accent is reserved for the Sync-now button only. Warning + negative are semantic, not accent extensions. ✓
- **Spacing:** 2/4/8/12/16/24 — all on the DESIGN.md scale. ✓
- **Motion:** 150ms short for all transitions; respects `prefers-reduced-motion` via existing `globals.css` rules. ✓
- **Aesthetic (industrial / utilitarian):** Status pill is rectangular with 6px radius (via `rounded-md` = 6px per DESIGN.md "Border radius: md"), no gradients, no decorative icons. Single spinner glyph, inline, 12×12. Matches FactSet / Stripe Dashboard aesthetic cited in DESIGN.md. ✓
- **Data density > card density:** No new card is introduced — the pill lives inline on the existing row. ✓
- **Anti-patterns check:** no gradients, no blobs, no bubbly radii, no Inter/Roboto, no generic 3-column icon grids. ✓

**No DESIGN.md gap detected.** Every token required for D-08 verbatim rendering already exists (`--color-warning` since 2026-04-11, `--color-negative` original, `--color-text-muted` original, DM Sans body, motion short 150ms). **Not a blocker.**

---

## Planner Hand-off Notes (what the planner MUST preserve)

1. **D-08 copy table is locked.** Hard-code the seven labels as string constants in the new `AllocatorSyncStatus` component. Unit test asserts each constant matches the D-08 table character-for-character.
2. **Ellipsis is `…` (U+2026), not `...`.** The D-08 copy `Syncing…` uses the single-character ellipsis. Lint/test for this.
3. **`complete_with_warnings` is forward-compat-only in v0.15** — per Claude's discretion in CONTEXT.md D-17, the dual-call path (spot + derivatives) in the worker can be a uniform success or a uniform failure in Phase 06 scope; if the planner decides partial-success is in scope, the UI spec already covers it verbatim.
4. **Helper line is the sole surface for `sync_error`** — no toast, no inline banner, no modal. This is explicit in D-08 and in the phase context summary.
5. **5s polling is transparent** — the pill animates in/out without any "Refreshing…" chrome. If Phase 11 polish revisits, polling may get a visual hint, but Phase 06 does not.
6. **First-run optimistic render (D-09)** is the one moment where the client mutates `sync_status` local state before the server confirms — this is explicit in the decision record and is safe because the server enqueue happens in the same API call.
7. **RLS regression test (D-15) is backend-only** — the UI spec does not cover the Vitest application-layer spec shape; planner owns that.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending

---

*Phase: 06-allocator-api-ingestion*
*UI-SPEC drafted: 2026-04-19 by gsd-ui-researcher*
*Upstream inputs: REQUIREMENTS.md (INGEST-01…09), ROADMAP.md (Phase 06 SC1–SC5), 06-CONTEXT.md (D-07/D-08/D-09/D-10/D-11 — UI-relevant), DESIGN.md (full token set), Phase 02 MandateSaveStatus aria-live convention*

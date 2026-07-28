# Phase 08: Connection Management and Notes — Pattern Map

**Mapped:** 2026-04-21
**Files analyzed:** 13 (11 code + 2 docs)
**Analogs found:** 13 / 13 (all strong or role-match)

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/071_user_notes_multiscope.sql` | migration (reshape + self-verify) | DDL + backfill | `supabase/migrations/037_user_notes.sql` + `supabase/migrations/066_allocator_holdings.sql` (DO-block probe shape) | exact (037 is the very table being reshaped) |
| `src/app/api/notes/route.ts` | route handler (REWRITE) | request-response, per-scope ownership + upsert | self + `src/app/api/bridge/outcome/[id]/curves/route.ts` (ownership-first pattern) | exact |
| `src/__tests__/user-notes-multiscope-rls.test.ts` | integration test (NEW) | two-actor RLS probe | `src/__tests__/allocator-holdings-rls.test.ts` | exact |
| `src/components/notes/NoteRender.tsx` | shared component (NEW) | pure client render | *(no existing react-markdown user — schema from RESEARCH.md §Pattern 3)* | no-analog (RESEARCH.md provides the blueprint) |
| `src/components/notes/useNoteAutoSave.ts` | shared hook (NEW) | on-blur PATCH + generation counter | `src/components/mandate/useMandateAutoSave.ts` | exact (clone + simplify) |
| `src/components/notes/NoteSaveStatus.tsx` | shared component (NEW) | aria-live status line | `src/components/mandate/MandateSaveStatus.tsx` | exact (clone verbatim, swap copy) |
| `src/app/(dashboard)/allocations/widgets/meta/NotesWidget.tsx` | widget (UPGRADE IN PLACE) | multi-scope fetch + markdown render + on-blur | self + mandate pair | exact (in-place edit) |
| Holding-scope inline expandable sub-row (new component + AllocationDashboard wiring) | UI expansion | expandable row under a table row | `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx` (`TimelineRow` + `ExpandedPanel`) | role-match (BridgeOutcomeBanner is a sibling strip, not a row-expansion; OutcomesWidget is the true analog) |
| Bridge-outcome expandable notes section (inside `OutcomesWidget.tsx`) | in-place UI edit | add section below existing delta panel | `OutcomesWidget.tsx` `ExpandedPanel` (self) | exact (self-extension) |
| `src/components/notes/StrategyNoteCard.tsx` + `src/app/strategy/[id]/page.tsx` | new card + page edit | full-width card in single-column layout | `src/app/strategy/[id]/page.tsx` `MetricCard` (sibling card in same file) | exact (same file sibling pattern) |
| `src/components/exchanges/AllocatorExchangeManager.tsx` (IN-PLACE EDIT) | existing modal rename + cascade flip | modal copy + RPC wiring (unchanged) | self (lines 629-705 Remove-key modal) | exact (surgical diff) |
| `src/app/(dashboard)/allocations/AllocationDashboard.tsx` (revoked toggle + localStorage) | page-level state | localStorage-backed UI toggle | `src/app/(dashboard)/allocations/hooks/useDashboardConfig.ts` (localStorage getter/setter shape) | role-match |
| `docs/architecture/adr-0023-audit-event-taxonomy.md` (UPDATE) | ADR table extension | doc sync | self — existing `portfolio_note.update` row + other `*.update` entries | exact (in-place table rows) |

## Pattern Assignments

### 1. `supabase/migrations/071_user_notes_multiscope.sql` (NEW migration — reshape + self-verify)

**Role:** migration (ALTER + backfill + constraint rewire + DO-block probe)
**Closest analog:** `supabase/migrations/037_user_notes.sql` (the table being reshaped) + `supabase/migrations/066_allocator_holdings.sql:1007-1067` (for the DO-block functional-probe shape)
**Why this analog:** 037 is literally the table migration 071 is reshaping — same RLS policies, same trigger, same content-cap CHECK carry forward. 066's self-verifying DO block is the template for a multi-assertion probe (schema + RLS + functional round-trip) that Phase 08 should mirror.

**Transaction + DDL frame (from 037, lines 26-38):**

```sql
BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: <reshape columns>
-- --------------------------------------------------------------------------
-- <migration comment block at top explaining WHY>

-- (for 071: ALTER TABLE user_notes ADD COLUMN scope_kind TEXT, scope_ref TEXT;
--          UPDATE user_notes SET scope_kind='portfolio', scope_ref=portfolio_id::text
--            WHERE portfolio_id IS NOT NULL;
--          DELETE FROM user_notes WHERE portfolio_id IS NULL;  -- 0 rows per RESEARCH.md §Runtime State
--          ALTER TABLE user_notes ALTER COLUMN scope_kind SET NOT NULL,
--                                 ALTER COLUMN scope_ref SET NOT NULL;
--          ALTER TABLE user_notes ADD CONSTRAINT user_notes_scope_kind_check
--            CHECK (scope_kind IN ('portfolio','holding','bridge_outcome','strategy'));
```

**RLS policies — CARRY FORWARD UNCHANGED from 037 lines 89-110:**

```sql
ALTER TABLE user_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notes_select_own ON user_notes;
CREATE POLICY user_notes_select_own ON user_notes FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_notes_insert_own ON user_notes;
CREATE POLICY user_notes_insert_own ON user_notes FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_notes_update_own ON user_notes;
CREATE POLICY user_notes_update_own ON user_notes FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_notes_delete_own ON user_notes;
CREATE POLICY user_notes_delete_own ON user_notes FOR DELETE
  USING (user_id = auth.uid());
```

**Self-verifying DO block (from 037 lines 115-165) — EXTEND with new assertions:**

```sql
DO $$
DECLARE
  v_rls_enabled BOOLEAN;
BEGIN
  -- existing 037 checks: table, indexes, trigger, RLS enabled, select policy
  -- (keep the raise-if-missing pattern — it's the project convention)
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_notes'
  ) THEN
    RAISE EXCEPTION 'Migration 071 failed: user_notes table missing';
  END IF;

  -- 071-specific: new composite UNIQUE index present
  IF NOT EXISTS(
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='user_notes'
      AND indexdef LIKE '%UNIQUE%(user_id, scope_kind, scope_ref)%'
  ) THEN
    RAISE EXCEPTION 'Migration 071 failed: composite unique index missing';
  END IF;

  -- 071-specific: old portfolio_id column dropped
  IF EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_notes' AND column_name='portfolio_id'
  ) THEN
    RAISE EXCEPTION 'Migration 071 failed: portfolio_id column not dropped';
  END IF;

  -- 071-specific: no row with NULL scope_kind/scope_ref (defensive)
  IF EXISTS(
    SELECT 1 FROM user_notes WHERE scope_kind IS NULL OR scope_ref IS NULL
  ) THEN
    RAISE EXCEPTION 'Migration 071 failed: backfill left NULL scope_kind/scope_ref rows';
  END IF;

  -- 037 carry-forward: RLS still ENABLED + owner-only select policy still present
  SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = 'user_notes'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'Migration 071 failed: RLS not enabled on user_notes';
  END IF;

  RAISE NOTICE 'Migration 071: user_notes multi-scope reshape verified.';
END
$$;

COMMIT;
```

**What changes vs. the analog:**
- Replaces the two partial unique indexes (`user_notes_unique_per_portfolio`, `user_notes_unique_global`) with a single `UNIQUE (user_id, scope_kind, scope_ref)`.
- Adds `scope_kind TEXT NOT NULL CHECK (...)`, `scope_ref TEXT NOT NULL`; drops `portfolio_id UUID` column.
- Backfill step is a no-op in prod (0 rows per RESEARCH.md §Runtime State) but MUST still run defensively for preview/dev DBs.
- DO block extends 037's shape with three new assertions (composite UNIQUE, portfolio_id absent, no-NULL-scope rows); trigger/RLS/policies assertions carry forward identically.
- Trigger `user_notes_set_updated_at_trigger` and `content` CHECK constraint (`char_length <= 100000`) survive the reshape untouched — migration 071 must NOT re-create them.

---

### 2. `src/app/api/notes/route.ts` (REWRITE — multi-scope GET + PATCH)

**Role:** route handler rewrite (request-response, per-scope ownership then upsert)
**Closest analog:** self (the existing file is the closest analog for its own auth + upsert + audit flow) + `src/app/api/bridge/outcome/[id]/curves/route.ts:37-46` (for the ownership-proof-FIRST idiom when per-scope checks diverge from RLS alone)
**Why this analog:** The existing route already does the correct shape (user-scoped Supabase client, ownership check, upsert, fire-and-forget audit). Phase 08 swaps the ownership check from a single portfolio lookup to a scope-kind switch (per RESEARCH.md §Pattern 1) and updates the upsert `onConflict` string. No new helpers other than the `scope-ref.ts` parser + `ownership.ts` switch.

**Imports + auth gate (from self, lines 1-14):**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";

const MAX_CONTENT_BYTES = 100 * 1024; // 100 KB

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ...
}
```

**Existing upsert + audit pattern (from self, lines 90-122) — KEEP SHAPE, CHANGE PAYLOAD:**

```typescript
const { data, error } = await supabase
  .from("user_notes")
  .upsert(
    {
      user_id: user.id,
      portfolio_id: portfolio_id,              // → { scope_kind, scope_ref }
      content,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,portfolio_id" },    // → "user_id,scope_kind,scope_ref"
  )
  .select("updated_at")
  .single();

if (error) {
  console.error("user_notes upsert failed:", error);
  return NextResponse.json({ error: "Failed to save note" }, { status: 500 });
}

logAuditEvent(supabase, {
  action: "portfolio_note.update",              // → `user_note.${scope_kind}.update`
  entity_type: "portfolio_note",                // → "user_note"
  entity_id: portfolio_id,                      // → `${scope_kind}:${scope_ref}` (synthetic, per D-20)
  metadata: { content_length: content.length }, // → { scope_kind, scope_ref, content_length }
});

return NextResponse.json({ updated_at: data?.updated_at });
```

**Ownership-first idiom (from `bridge/outcome/[id]/curves/route.ts:37-46`):**

```typescript
// T-05-01 mitigation: ownership proved FIRST via user-scoped SELECT.
// 404 if not owned. ONLY AFTER ownership proof do we hit admin client.
async function getAuthedUserIdOrError(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return { userId: user.id };
}
```

**What changes vs. the analog:**
- Body schema becomes zod-validated `{ scope_kind, scope_ref, content }` (RESEARCH.md §Pattern 4 recommends `zod` over `typeof content !== "string"`).
- Ownership check becomes `checkScopeOwnership(supabase, user.id, scope_kind, scope_ref)` — 4-way switch per scope_kind (portfolio/holding/bridge_outcome/strategy) in new `src/lib/notes/ownership.ts` (see RESEARCH.md Pattern 1 for the full switch body).
- `onConflict` string flips to `"user_id,scope_kind,scope_ref"` (Pitfall 2 in RESEARCH.md — MUST land in same commit as migration 071).
- Audit action becomes `"user_note.${scope_kind}.update"` (renames `portfolio_note.update` — 5 call sites, all in-repo, atomic rename per RESEARCH.md §Runtime State).
- `entity_id` becomes synthetic `"${scope_kind}:${scope_ref}"` (D-20, avoids UUID collisions across scopes; see Pitfall 8).
- GET handler swaps `portfolio_id` query param for `scope_kind` + `scope_ref`. Preserves `PGRST116`-means-404 handling (lines 30-39 of existing).

---

### 3. `src/__tests__/user-notes-multiscope-rls.test.ts` (NEW two-actor RLS probe)

**Role:** live-DB integration test (Vitest, `it.skipIf(!HAS_LIVE_DB)` gate)
**Closest analog:** `src/__tests__/allocator-holdings-rls.test.ts`
**Why this analog:** Same shape — two-user service-role-seeded rows, authenticated-user SELECT, assert zero leakage. The only difference is the seed target (`user_notes` instead of `allocator_holdings`) and the assertion matrix (four scope_kinds × two users). Mirrors the "tests skipIf no live DB, advertise skip reason otherwise" pattern verbatim.

**Imports + harness (from allocator-holdings-rls.test.ts, lines 24-34):**

```typescript
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  LIVE_DB_SERVICE_ROLE_KEY,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";
```

**Two-actor anti-leak probe shape (from allocator-holdings-rls.test.ts, lines 143-239):**

```typescript
describe("Migration 071 — user_notes multi-scope RLS", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "user_notes: owner reads own row; foreign user reads 0 rows (all 4 scopes)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      // ...
      try {
        const userAId = await createTestUser(admin, emailA, passwordA);
        const userBId = await createTestUser(admin, emailB, passwordB);

        // Seed one note per scope for each user (8 rows total)
        // scope_kinds: portfolio, holding, bridge_outcome, strategy

        const clientA = await createAuthedClient(emailA, passwordA);
        if (!clientA) return;
        const { data: aRows } = await clientA.from("user_notes").select("*");
        expect(aRows!.length).toBe(4); // only A's 4 notes

        // Explicit anti-leak: B targeting A's note id → 0 rows
        const { data: bCrossRead } = await clientB
          .from("user_notes")
          .select("id")
          .eq("id", aPortfolioNoteId);
        expect(bCrossRead).toEqual([]);
      } finally {
        // Dependency-order cleanup
      }
    },
    30_000,
  );

  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("user-notes-multiscope-rls");
    expect(true).toBe(true);
  });
});
```

**What changes vs. the analog:**
- Seed target is `user_notes` (not `allocator_holdings`); `api_keys` seed helper not needed — `user_notes` has no FK dependencies beyond `profiles.user_id`.
- Four scope_kinds × two users = 8 rows seeded per test (vs. 2 rows in the allocator analog).
- Cleanup is simpler — just `user_notes` rows + test users (no api_keys chain).
- ADD an additional probe for the PATCH route's per-scope ownership check: seed a holding for user A, call PATCH with `scope_kind=holding, scope_ref=<A's venue:symbol:type>` as user B, expect 403 (covers D-09).

---

### 4. `src/components/notes/NoteRender.tsx` (NEW — shared markdown render helper)

**Role:** new shared client component (react-markdown + rehype-sanitize)
**Closest analog:** none — no existing react-markdown consumer in the repo.
**Why no analog:** Phase 08 introduces markdown rendering as a new capability. RESEARCH.md §Pattern 3 supplies the complete blueprint (imports + sanitize-schema + `<a>` rewrite); the planner should treat those code excerpts as authoritative.

**Imports + sanitize schema (from RESEARCH.md §Pattern 3 / lines 376-449):**

```typescript
// src/components/notes/sanitize-schema.ts
import { defaultSchema } from "hast-util-sanitize";
import type { Schema } from "hast-util-sanitize";

const ALLOWED_TAGS = (defaultSchema.tagNames ?? []).filter(
  (t) => !["img", "input", "details", "summary", "picture", "source"].includes(t),
);

export const noteSanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: ALLOWED_TAGS,
  protocols: {
    ...(defaultSchema.protocols ?? {}),
    href: ["http", "https"],
  },
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
    if (!href) return <>{children}</>;
    return (
      <a href={href} rel="noopener noreferrer" target="_blank"
         className="text-accent underline hover:text-accent-hover">
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

**What changes vs. the analog:** No analog exists; this is the blueprint itself. Notes for the planner:
- `noteSanitizeSchema` MUST be module-scope (Pitfall 1) — inline schema re-creation causes ReactMarkdown remount flicker on every keystroke.
- Do NOT add `rehype-raw` (Anti-Pattern — would enable raw HTML and defeat sanitize).
- `.prose-note` CSS lives in `globals.css` per UI-SPEC §5; NOT `@tailwindcss/typography`.
- Lazy-import via `React.lazy` inside surfaces that render below the fold (RESEARCH.md Standard Stack §Bundle size — ~120-160 KB gzipped).

---

### 5. `src/components/notes/useNoteAutoSave.ts` (NEW — clone of useMandateAutoSave, simplified)

**Role:** new shared client hook (on-blur save + generation-counter race guard)
**Closest analog:** `src/components/mandate/useMandateAutoSave.ts`
**Why this analog:** The mandate hook is the shipped reference for on-blur autosave against a user-scoped PATCH route with aria-live status. Clone the contract verbatim, then delete the per-field/429/backoff complexity that notes do not need (RESEARCH.md §Pattern 4 — low-volume saves, single retry on 5xx).

**Imports + state (from useMandateAutoSave.ts, lines 1-14):**

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface UseNoteAutoSaveReturn {
  saveState: SaveState;
  lastSavedAt: Date | null;
  save: (content: string) => Promise<void>;
}
```

**Race-guard generation counter + 2s flash (from useMandateAutoSave.ts, lines 39-56):**

```typescript
// 2s fade-timer for "saved" -> "idle" transition
const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
useEffect(() => {
  if (saveState === "saved") {
    fadeTimerRef.current = setTimeout(() => setSaveState("idle"), 2000);
  }
  return () => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
  };
}, [saveState]);

// Generation counter — bumped on each save(); stale responses (whose
// generation is less than the current one) are dropped before touching
// state. Prevents rapid-blur races.
const generationRef = useRef(0);
```

**Save call shape (simplified from useMandateAutoSave.ts, lines 67-120):**

```typescript
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
      if (retry) { await wait(2000); return attempt(false); }
      if (generationRef.current === gen) setSaveState("error");
      return;
    }
    if (generationRef.current !== gen) return; // stale — drop
    if (res.ok) { setLastSavedAt(new Date()); setSaveState("saved"); return; }
    if (res.status >= 500 && retry) { await wait(2000); return attempt(false); }
    setSaveState("error");
  };
  await attempt(true);
}, [scope_kind, scope_ref]);
```

**What changes vs. the analog:**
- DROP `fieldErrors` map + `savingFields` Set (single-content-per-hook — no field concept).
- DROP 429 Retry-After handling (no rate limiter on `/api/notes` yet).
- DROP exponential-backoff chain (MAX_ATTEMPTS=4 → single retry after 2s on 5xx only).
- KEEP generation counter (Pitfall 3 — Tab-key blur followed by re-focus-then-blur MUST not race-drop the newer content).
- Signature: `useNoteAutoSave(scope_kind, scope_ref, initialLastSavedAt?)` vs. `useMandateAutoSave(initialLastSavedAt?)`.
- Unmount flush behavior (NotesWidget lines 82-95) — move the fire-and-forget-on-unmount pattern INTO the hook so every surface inherits it.

---

### 6. `src/components/notes/NoteSaveStatus.tsx` (NEW — clone of MandateSaveStatus)

**Role:** new shared client component (aria-live status with 2s "saved" flash + self-ticking relative-time)
**Closest analog:** `src/components/mandate/MandateSaveStatus.tsx`
**Why this analog:** UI-SPEC §6 explicitly requires this pair to mirror MandateSaveStatus exactly (same aria, same CSS animation, same `formatRelativeTime` helper, same 15s self-tick). Only copy strings differ.

**Full component (from MandateSaveStatus.tsx, lines 28-75) — clone verbatim with copy swap:**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { SaveState } from "./useNoteAutoSave";
import { formatRelativeTime } from "../mandate/formatRelativeTime"; // REUSE existing helper

interface Props {
  saveState: SaveState;
  lastSavedAt: Date | null;
  now?: number;               // test seam — inject fixed now
  tickIntervalMs?: number;    // test seam — default 15_000
}

export function NoteSaveStatus({
  saveState, lastSavedAt, now, tickIntervalMs = 15_000,
}: Props) {
  const [tickNow, setTickNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (now !== undefined) return;
    if (!lastSavedAt) return;
    const id = setInterval(() => setTickNow(Date.now()), tickIntervalMs);
    return () => clearInterval(id);
  }, [now, lastSavedAt, tickIntervalMs]);
  const effectiveNow = now ?? tickNow;
  const showSavedFlash = saveState === "saved";
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="note-save-status"
      className="text-xs text-text-muted font-metric tabular-nums tracking-tight"
    >
      {showSavedFlash && (
        <span className="mandate-saved-flash inline-flex items-center gap-1.5 text-text-primary">
          <span aria-hidden="true" className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-accent/10 text-accent">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M1.5 4l2 2 3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          Note saved  {/* was "Mandate saved" */}
        </span>
      )}
      {!showSavedFlash && lastSavedAt && (
        <span>Last saved: {formatRelativeTime(lastSavedAt.getTime(), effectiveNow)}</span>
      )}
      {!showSavedFlash && !lastSavedAt && saveState === "error" && (
        <span className="text-negative">Save failed — retry</span>
      )}
      {/* idle without lastSavedAt renders nothing per UI-SPEC §7 */}
    </div>
  );
}
```

**What changes vs. the analog:**
- Copy swap: `"Mandate saved"` → `"Note saved"`.
- Test id: `data-testid="mandate-save-status"` → `"note-save-status"`.
- New `error` state rendering (`"Save failed — retry"`) that MandateSaveStatus handles via per-field `fieldErrors` — not applicable here.
- Empty-idle state renders nothing (UI-SPEC §7 explicitly: "empty — no noise when note hasn't been touched") vs. MandateSaveStatus's "Not saved yet".
- Reuses `.mandate-saved-flash` CSS animation from `globals.css` verbatim (UI-SPEC §8 — no new keyframe).
- Imports `formatRelativeTime` from `../mandate/formatRelativeTime` (UI-SPEC §7 assumption — no duplication).

---

### 7. `src/app/(dashboard)/allocations/widgets/meta/NotesWidget.tsx` (UPGRADE IN PLACE — portfolio scope)

**Role:** widget upgrade in place (swap query shape, add markdown render, switch debounce → on-blur)
**Closest analog:** self (lines 1-137) + the new `useNoteAutoSave` + `NoteRender` + `NoteSaveStatus` shared bits above
**Why this analog:** The existing widget is a working portfolio-scope reference. Every change is surgical — swap fetch URL, wire hook, add render mode toggle. No widget-registry entry edits needed (`"notes-widget"` slug already exists — see `widget-registry.ts:396-405`).

**Existing fetch + upsert (from self, lines 18-46) — CHANGE URL SHAPE:**

```typescript
// BEFORE (current, line 26):
const res = await fetch(`/api/notes?portfolio_id=${portfolioId}`);

// AFTER:
const res = await fetch(
  `/api/notes?scope_kind=portfolio&scope_ref=${encodeURIComponent(portfolioId)}`
);
```

**Existing save (from self, lines 48-69) — REPLACE with hook:**

```typescript
// BEFORE: inline save() function + handleChange's setTimeout(save, 1000)

// AFTER:
const { saveState, lastSavedAt, save } = useNoteAutoSave(
  "portfolio",
  portfolioId,
  null,
);
// textarea onBlur={() => save(notes)}  (no setTimeout, no debounce)
```

**Existing render output (from self, lines 111-135) — ADD READ/EDIT TOGGLE:**

```tsx
// BEFORE: always textarea
<textarea value={notes} onChange={handleChange} ... />

// AFTER: read mode renders NoteRender, edit mode renders textarea
{editing ? (
  <textarea
    value={draft}
    onChange={(e) => setDraft(e.target.value)}
    onBlur={() => { save(draft); setEditing(false); }}
    className="flex-1 w-full resize-none rounded border border-border p-2 font-mono text-[13px] leading-[1.6]"
  />
) : (
  <div className="flex-1 overflow-auto">
    <NoteRender content={notes} />
    <button onClick={() => setEditing(true)} className="text-xs text-accent underline">Edit</button>
  </div>
)}
<NoteSaveStatus saveState={saveState} lastSavedAt={lastSavedAt} />
```

**What changes vs. the analog:**
- `useState<SaveState>` + inline `save` function + debounceRef → `useNoteAutoSave` hook.
- `setTimeout(save, 1000)` on every keystroke → `onBlur={save}` (D-19).
- Always-textarea UI → editing/reading mode toggle + `NoteRender` for read mode.
- Hand-rolled aria-live `<span>` (lines 127-133) → `NoteSaveStatus` component.
- Unmount flush (lines 82-95) moves INTO `useNoteAutoSave` so the widget body stops duplicating it.
- `data.portfolio.id` remains the scope_ref source; no widget-registry changes needed.

---

### 8. Holding-scope inline expandable sub-row (new `HoldingNoteRow` fragment + holdings table integration)

**Role:** new UI fragment — inline expandable sub-row under each holdings table row
**Closest analog:** `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx:386-546` (`TimelineRow` + `ExpandedPanel` + `aria-expanded`/`aria-controls` + conditional `<tr>` render)
**Why this analog:** OutcomesWidget is the ONLY existing row-expansion-under-a-table-row pattern in the repo. BridgeOutcomeBanner is a sibling strip appended to a row, NOT an expansion — it is not the right analog. `TimelineRow` + `ExpandedPanel` demonstrate every requirement: caret button with `aria-expanded`/`aria-controls`, `<tr><td colSpan={n}>...</td></tr>` mounted conditionally, `Fragment`-wrapped parent-child row pair, hover + focus-visible styling, 150ms rotate transition on the caret.

**Caret button + aria plumbing (from OutcomesWidget.tsx, lines 445-469):**

```tsx
<td className="px-2 py-2" style={{ width: 32 }}>
  <button
    type="button"
    onClick={() => onToggle(outcome.id)}
    aria-expanded={isExpanded}
    aria-label={isExpanded ? "Collapse outcome detail" : "Expand outcome detail"}
    aria-controls={`outcome-detail-${outcome.id}`}
    className="flex items-center justify-center w-7 h-7 rounded text-[#718096] hover:text-[#1A1A2E] hover:bg-[#F8F9FA] focus-visible:outline-2 focus-visible:outline focus-visible:outline-[#1B6B5A] transition-colors"
  >
    <span aria-hidden="true" className="text-sm inline-block"
      style={{
        transform: isExpanded ? "rotate(90deg)" : "none",
        transition: "transform 150ms ease-out",
      }}>
      {"\u203A"}
    </span>
  </button>
</td>
```

**Fragment-wrapped row + conditional sub-row (from OutcomesWidget.tsx, lines 439-545):**

```tsx
import { Fragment } from "react";

return (
  <Fragment>
    <tr className="border-b border-[#E2E8F0] last:border-b-0 hover:bg-[#F8F9FA] transition-colors" style={{ height: 44 }}>
      {/* ... table cells ... */}
    </tr>
    {isExpanded && (
      <tr id={`outcome-detail-${outcome.id}`}>
        <td colSpan={colSpan} className="p-0">
          <ExpandedPanel outcome={outcome} curvesCache={curvesCache} />
        </td>
      </tr>
    )}
  </Fragment>
);
```

**What changes vs. the analog:**
- Caret button becomes a **note icon** (square-with-lines SVG per UI-SPEC §3). Three visual states: empty (outlined muted), has-note (solid accent), revoked+has-note (solid amber). Same 32×32 hit area, same hover/focus affordance, same `aria-expanded`/`aria-controls` plumbing.
- Trailing column placement (UI-SPEC §3 — after all metric + action columns) vs. outcomes' leading caret column.
- Sub-row content = textarea (editing) OR `NoteRender` (read), plus `NoteSaveStatus` — NOT a 3-column delta panel.
- `onlyOneOpenAtATime` logic: `expandedId === id ? null : id` (same as outcomes — `setExpandedId(prev === id ? null : id)`).
- scope_ref = `buildHoldingScopeRef({venue, symbol, holding_type})` — RESEARCH.md §Pattern 2.
- No lazy fetch analog to `ExpandedPanel`'s `/api/bridge/outcome/[id]/curves` — notes fetch is a single GET on expand (RESEARCH.md state).

---

### 9. Bridge-outcome expandable notes section (in-place edit to `OutcomesWidget.tsx`)

**Role:** in-place UI edit — extend existing expanded region with a notes section below the delta panel
**Closest analog:** self — `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx:318-383` (`ExpandedPanel`)
**Why this analog:** UI-SPEC §4c explicitly says to add the notes section INSIDE the already-expanded row, below the delta-comparison grid. The existing `ExpandedPanel` is the container that needs one new section appended.

**Existing expanded-panel container (from self, lines 318-383):**

```tsx
<div
  className="grid grid-cols-3 gap-4 border-b border-[#E2E8F0] px-3 py-4"
  style={{ backgroundColor: "#F8F9FA" }}
>
  {columns.map((col) => { /* delta card */ })}
</div>
```

**Extension shape (UI-SPEC §4c):**

```tsx
<>
  <div className="grid grid-cols-3 gap-4 ..."> {/* existing delta grid */} </div>
  <hr className="my-3 border-border" />
  <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
    Your note
  </p>
  <NoteSurface
    scope_kind="bridge_outcome"
    scope_ref={outcome.id}
    placeholder="No note for this outcome. Start typing to add one."
  />
</>
```

**What changes vs. the analog:**
- Wrap the existing `<div className="grid grid-cols-3 ...">` in a `<>` fragment; append `<hr>` + section header + `NoteSurface` (a thin wrapper around textarea/`NoteRender`/`useNoteAutoSave`/`NoteSaveStatus` — the same four bits used in every other scope).
- Background color of the outer container already matches the recessed surface (`#F8F9FA`) — no new styling needed.
- scope_ref = `outcome.id` (UUID as text per D-08).
- No changes to `curvesCache` or the delta-fetch — notes are a separate GET.

---

### 10. `src/components/notes/StrategyNoteCard.tsx` + `src/app/strategy/[id]/page.tsx` edit

**Role:** new card component + in-place page edit (insert card below sparkline, above CTA)
**Closest analog:** `src/app/strategy/[id]/page.tsx:60-69` (`MetricCard` — sibling card component in the same file) + lines 138-148 (sparkline card as the insertion-point neighbor)
**Why this analog:** The strategy page is a single-column `max-w-3xl` layout. `MetricCard` is a small card with identical outer structure (`rounded-lg border border-border bg-card p-4`). The sparkline card (lines 138-148) is the immediate upstream neighbor and uses the same wrapper — the StrategyNoteCard is a literal sibling: same visual language, same max-width context. UI-SPEC §4d specifies exact DOM shape and copy.

**Sibling card pattern (from strategy/[id]/page.tsx, lines 138-148):**

```tsx
{analytics.sparkline_returns && analytics.sparkline_returns.length >= 2 && (
  <div className="rounded-lg border border-border bg-card p-4 mb-8">
    <p className="text-xs text-text-muted mb-3">Equity Curve</p>
    <Sparkline data={analytics.sparkline_returns} width={640} height={80} fill className="w-full" />
  </div>
)}
```

**StrategyNoteCard shape (UI-SPEC §4d):**

```tsx
// src/components/notes/StrategyNoteCard.tsx
"use client";
import { useNoteAutoSave } from "./useNoteAutoSave";
import { NoteRender } from "./NoteRender";
import { NoteSaveStatus } from "./NoteSaveStatus";

export function StrategyNoteCard({
  strategyId,
  initialContent,
  initialLastSavedAt,
}: { strategyId: string; initialContent: string; initialLastSavedAt: Date | null }) {
  const { saveState, lastSavedAt, save } = useNoteAutoSave("strategy", strategyId, initialLastSavedAt);
  // ... editing toggle + textarea/NoteRender (same pattern as NotesWidget) ...
  return (
    <div className="rounded-lg border border-border bg-surface p-4 mb-8">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
        Your note
      </p>
      {/* textarea OR NoteRender + NoteSaveStatus */}
    </div>
  );
}
```

**Insertion point in `page.tsx`:**

```tsx
{/* After sparkline card (lines 138-148), before CTA card (lines 157-164) */}
<StrategyNoteCard
  strategyId={strategy.id}
  initialContent={initialNoteContent}
  initialLastSavedAt={initialNoteSavedAt}
/>
```

**What changes vs. the analog:**
- `MetricCard` uses `bg-card`; UI-SPEC §4d uses `bg-surface` — planner confirms which token resolves correctly (both are whitelisted in the design system; the spec chose `bg-surface` for consistency with the sub-row treatment in §4b).
- The page component becomes async-server-fetches-note → passes initial props (avoids client-side `useEffect` fetch-on-mount round-trip for already-public data).
- scope_ref = `strategy.id` (the `strategies.id` from `getPublicStrategyDetail` — RESEARCH.md Research Finding #3 locked this; NOT `match_strategies.id` / `verified_strategies.id` which don't exist).
- Ownership check for `scope_kind=strategy` is "strategy exists and is published" (RESEARCH.md §Pattern 1 case).

---

### 11. `src/components/exchanges/AllocatorExchangeManager.tsx` (IN-PLACE EDIT — rename Remove → Disconnect + cascade flip)

**Role:** in-place component edit — rename button, flip cascade-checkbox default + semantics
**Closest analog:** self — lines 550-705 (Remove button + delete confirm modal). The existing modal is the analog; Phase 08 is a surgical diff, NOT a rewrite.
**Why this analog:** Every mechanical gear (ownership-count fetch, RPC call, optimistic list update, router.refresh()) already works. Phase 08 flips copy + the disabled-gate boolean expression. Preserve the 7-state pill, 5s polling, Sync-now button, and modal focus trap.

**Existing Remove button (from self, lines 563-569) — RENAME:**

```tsx
<Button
  variant="secondary"
  aria-label={`Remove ${key.exchange} key`}     // → "Disconnect ..."
  onClick={() => openDeleteConfirm(key.id)}
>
  Remove                                        // → "Disconnect"
</Button>
```

**Existing modal body + checkbox (from self, lines 629-705) — THREE EDITS:**

```tsx
{/* 1. Title + copy (locked per UI-SPEC §1): */}
<Modal title="Remove exchange key">            {/* → title={`Disconnect ${venue}?`} */}
  <p className="text-sm text-text-secondary">
    This will permanently remove the encrypted key from Quantalyze and
    stop future syncs.
    {/* → "We'll stop syncing this key. Your historical holdings stay
           available for audit and are reflected in past performance." */}
  </p>

  {/* 2. Cascade checkbox default + copy: */}
  <label className="mt-3 flex items-start gap-2 text-xs text-text-secondary">
    <input
      type="checkbox"
      checked={cascadeHoldings}                 // state already exists
      onChange={(e) => setCascadeHoldings(e.target.checked)}
      // default: useState(false) in Phase 08 too — but semantics flip
    />
    <span id="cascade-holdings-help">
      Also remove {deleteHoldingsCount} imported holdings row{...}. Required
      to proceed — holdings reference this key and can't be left orphaned.
      {/* → "Also delete {N} historical holding{s} from this key"
             + sub-copy per UI-SPEC §1 cascade sub-copy */}
    </span>
  </label>

  {/* 3. Button disabled expression (Pitfall 4 — DELETE the guard): */}
  <Button
    variant="danger"
    disabled={
      deleteLoading ||
      deleteHoldingsCount === null ||
      (deleteHoldingsCount > 0 && !cascadeHoldings)   // ← DELETE THIS SUBEXPR
    }
    onClick={() => confirmDeleteId && handleDeleteKey(confirmDeleteId)}
  >
    {deleteLoading ? "Removing…" : "Remove key"}      // → "Disconnecting…" / "Disconnect"
  </Button>
</Modal>
```

**What changes vs. the analog:**
- Button label: `"Remove"` → `"Disconnect"`; aria-label: same swap.
- Modal title: literal `"Remove exchange key"` → `` `Disconnect ${venue}?` `` (venue-capitalised).
- Modal body copy: replace with UI-SPEC §1 locked copy.
- Cascade checkbox sub-copy: two-line contextual explanation (checked vs unchecked — UI-SPEC §1 lines 127-135).
- Button disabled expression: **DELETE** the `(deleteHoldingsCount > 0 && !cascadeHoldings)` clause (Pitfall 4 — leaving this guard in place makes the button permanently unclickable with the new unchecked default).
- Button label: `"Remove key"`/`"Removing…"` → `"Disconnect"`/`"Disconnecting…"`.
- `handleDeleteKey` RPC call (lines 190-209) is **UNCHANGED** — migration 069 already accepts `p_cascade_holdings` as a boolean parameter.
- Zero new state variables; `cascadeHoldings` already exists and its initial value `false` is correct for the new semantic (unchecked default).

---

### 12. `src/app/(dashboard)/allocations/AllocationDashboard.tsx` (revoked-holdings toggle + localStorage)

**Role:** page-level state addition — new checkbox toggle + localStorage persistence key
**Closest analog:** `src/app/(dashboard)/allocations/hooks/useDashboardConfig.ts:10-38` (localStorage getter/setter with try/catch + SSR guard + fallback-on-corrupt)
**Why this analog:** Same pattern space (user-scoped UI preference persisted to localStorage with `allocations.*` prefix), same SSR-safe shape, same silent-fallback-on-corrupt approach. This is the shipped idiom in the allocations tree.

**localStorage load/persist pattern (from useDashboardConfig.ts, lines 10-38):**

```typescript
const STORAGE_KEY = "quantalyze-dashboard-config";

function loadConfig(): DashboardConfig {
  if (typeof window === "undefined") {
    return { tiles: DEFAULT_LAYOUT, timeframe: "YTD", layoutVersion: LAYOUT_VERSION };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DashboardConfig;
      if (parsed.layoutVersion !== LAYOUT_VERSION) {
        return { tiles: DEFAULT_LAYOUT, timeframe: "YTD", layoutVersion: LAYOUT_VERSION };
      }
      if (Array.isArray(parsed.tiles) && parsed.tiles.length > 0) return parsed;
    }
  } catch {
    // Corrupted data — fall back to defaults
  }
  return { tiles: DEFAULT_LAYOUT, timeframe: "YTD", layoutVersion: LAYOUT_VERSION };
}

function persist(config: DashboardConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}
```

**Revoked-holdings toggle shape (UI-SPEC §2):**

```typescript
const REVOKED_STORAGE_KEY = "allocations.showRevokedHoldings";

function loadShowRevoked(): boolean {
  if (typeof window === "undefined") return true;  // default ON per D-05
  try {
    const raw = localStorage.getItem(REVOKED_STORAGE_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch { return true; }
}

const [showRevoked, setShowRevoked] = useState<boolean>(loadShowRevoked);
useEffect(() => {
  try { localStorage.setItem(REVOKED_STORAGE_KEY, String(showRevoked)); }
  catch { /* silent */ }
}, [showRevoked]);
```

**What changes vs. the analog:**
- Scalar boolean, not an object — skip `JSON.parse` / `JSON.stringify`; use `"true"`/`"false"` string form (smaller, simpler).
- Default ON (D-05) — the `loadShowRevoked` returns `true` for missing key, not `false`.
- No layoutVersion-style reset trigger — the toggle has no schema to invalidate.
- Persistence runs on every state change via `useEffect`, mirroring `useDashboardConfig`'s pattern.
- Toggle is a page-level checkbox above the holdings table (UI-SPEC §2) + hidden-footer "Show all" button that sets state back to `true`.

---

### 13. `docs/architecture/adr-0023-audit-event-taxonomy.md` (UPDATE — 4 new `user_note.*.update` rows)

**Role:** ADR documentation sync (in-place table edit)
**Closest analog:** self — the existing `portfolio_note.update` row (line 134) + sibling `*.update` rows (lines 127, 128, 132, 135, 136)
**Why this analog:** Every mutation-site taxonomy change follows the same shape — one row per new action in the table at §4 + (for an enum-rename) a brief note explaining the rename in the narrative body.

**Existing `portfolio_note.update` row (from self, line 134) — DELETE:**

```markdown
| `portfolio_note.update` | `portfolio_note` | `portfolios.id` (user_notes composite PK on (user_id, portfolio_id)) | content_length |
```

**Replacement rows — ADD four:**

```markdown
| `user_note.portfolio.update` | `user_note` | synthetic `"portfolio:{portfolios.id}"` (user_notes composite PK on (user_id, scope_kind, scope_ref) — surrogate id is unstable across upserts per ADR-0023 §6 immutability) | scope_kind, scope_ref, content_length |
| `user_note.holding.update` | `user_note` | synthetic `"holding:{venue}:{symbol}:{holding_type}"` | scope_kind, scope_ref, content_length |
| `user_note.bridge_outcome.update` | `user_note` | synthetic `"bridge_outcome:{bridge_outcomes.id}"` | scope_kind, scope_ref, content_length |
| `user_note.strategy.update` | `user_note` | synthetic `"strategy:{strategies.id}"` | scope_kind, scope_ref, content_length |
```

**Existing `AuditEntityType` union (from ADR-0023 line 162 + audit.ts line 162) — RENAME:**

```typescript
| "portfolio_note"   // → "user_note"
```

**Narrative block to add (mirrors Phase 06 `allocator.holdings.*` block at ADR-0023 lines 185-212):**

```markdown
Phase 08 (connection management + multi-scope notes, migration 071) renamed
`portfolio_note.update` → `user_note.portfolio.update` and added three new
scope-specific variants. The rename is atomic — no back-compat alias — because
the only emitter (`/api/notes` PATCH) is rewritten in the same commit and no
external consumers reference the old string (verified 5 in-repo call sites,
all renamed atomically). The historical `audit_log` rows with
`action='portfolio_note.update'` are preserved unchanged per §6 append-only
immutability; any future Phase 11 dashboard querying the action must UNION
the old name with the new four.

`entity_id` is a synthetic `"{scope_kind}:{scope_ref}"` string rather than
the user_notes surrogate `id` UUID — upserts can resolve to a different
row id across scope_kind reshapes, so the composite is the only stable
identifier across the row's lifetime. This matches the `admin.partner_import`
precedent (line 143) of using a synthesized entity_id where no stable DB
row exists.
```

**What changes vs. the analog:**
- One rename (`portfolio_note.update` → `user_note.portfolio.update`) + three new rows, one entity_type rename (`portfolio_note` → `user_note`).
- New narrative block mirroring the Phase 06 `allocator.holdings.*` block (lines 185-212) to document the rename rationale + the synthetic entity_id choice.
- ADR-0023's existing §2 `AuditAction` union code listing (lines 53-94) must also be updated in lockstep — drop the `"portfolio_note.update"` literal, add the four `"user_note.*.update"` literals.
- `src/lib/audit.ts` union (lines 85-137) and type alias (lines 147-179) must be updated atomically in the same commit per D-23 — this is NOT a doc-only change, the TypeScript enum is the source of truth and ADR-0023 is its mirror.

---

## Shared Patterns

### Authentication / User-Scoped Supabase Client

**Source:** `src/app/api/notes/route.ts:7-14` (existing pattern in the file being rewritten)

**Apply to:** `/api/notes` rewrite (both GET and PATCH handlers) — the new `checkScopeOwnership` helper receives this same user-scoped client.

```typescript
const supabase = await createClient();               // @/lib/supabase/server
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
// All subsequent queries use `supabase` (user-scoped, RLS-enforced).
```

### Fire-and-Forget Audit Emission

**Source:** `src/lib/audit.ts:198-213` + existing `/api/notes` usage at line 115

**Apply to:** `/api/notes` PATCH handler (after successful upsert). NEVER await; never gate the response on audit round-trip.

```typescript
logAuditEvent(supabase, {
  action: `user_note.${scope_kind}.update`,
  entity_type: "user_note",
  entity_id: `${scope_kind}:${scope_ref}`,
  metadata: { scope_kind, scope_ref, content_length: content.length },
});
// no await, no try/catch — logAuditEvent is void return and catches internally
return NextResponse.json({ updated_at: data?.updated_at });
```

### Cascade RPC Call (Disconnect Flow)

**Source:** `src/components/exchanges/AllocatorExchangeManager.tsx:190-209`

**Apply to:** Disconnect modal's confirm handler — identical call, ONLY the user-facing copy changes.

```typescript
const { error } = await supabase.rpc("delete_allocator_api_key", {
  p_api_key_id: keyId,
  p_cascade_holdings: cascadeHoldings,   // Phase 08 default: false (was required-true)
});
```

### On-Blur Save Trigger (All Four Note Surfaces)

**Source:** `src/components/notes/useNoteAutoSave.ts` (new — clones useMandateAutoSave contract)

**Apply to:** NotesWidget textarea, HoldingNoteRow textarea, OutcomesWidget note textarea, StrategyNoteCard textarea — same hook invocation, differs only in scope_kind + scope_ref arguments.

```tsx
const { saveState, lastSavedAt, save } = useNoteAutoSave(scope_kind, scope_ref, initialLastSavedAt);
// ...
<textarea
  value={draft}
  onChange={(e) => setDraft(e.target.value)}
  onBlur={() => save(draft)}
  // no onChange debounce, no timer — onBlur is the ONLY save trigger per D-19
/>
<NoteSaveStatus saveState={saveState} lastSavedAt={lastSavedAt} />
```

### Markdown Render (All Four Note Surfaces)

**Source:** `src/components/notes/NoteRender.tsx` (new — RESEARCH.md §Pattern 3)

**Apply to:** Every read-mode rendering of a persisted note. Never render markdown while editing; edit surface is a plain `<textarea>` with Geist Mono font per UI-SPEC §4.

```tsx
{editing
  ? <textarea value={draft} onChange={...} onBlur={() => save(draft)} />
  : <NoteRender content={content} />}
```

### Three-Tier vs Owner-Only RLS Deviation

**Source:** migration 037 `user_notes` RLS (owner-only across 4 actions) — Phase 08 PRESERVES this

**Apply to:** migration 071 — DO NOT add admin-tier or service-role policies. RLS stays `user_id = auth.uid()` on SELECT/INSERT/UPDATE/DELETE per D-14 (institutional privacy — admin support tooling does NOT read notes). The code context in CONTEXT.md line 278 calls this out as a DELIBERATE deviation from the three-tier standard used by `allocator_holdings` / `bridge_outcomes`.

### Single-File Migration With Self-Verifying DO Block

**Source:** `supabase/migrations/037_user_notes.sql` (shape) + `supabase/migrations/066_allocator_holdings.sql:1007-1067` (functional-probe extension pattern)

**Apply to:** migration 071 — one SQL file, `BEGIN`/`COMMIT`-wrapped, `DO $$` block at bottom asserting: table exists, new columns present + NOT NULL + CHECK constraint present, old `portfolio_id` column ABSENT, composite UNIQUE index present, `RLS enabled`, all 4 policies present, trigger present, no NULL-scope rows.

---

## No Analog Found

| File | Role | Why |
|------|------|-----|
| `src/components/notes/NoteRender.tsx` | new markdown renderer | No existing `react-markdown` consumer in the repo. RESEARCH.md §Pattern 3 supplies the complete blueprint (imports + sanitize schema + `<a>` rewrite + module-scope schema to avoid Pitfall 1 flicker). Planner should copy directly from RESEARCH.md rather than from any analog. |
| `src/components/notes/sanitize-schema.ts` | new sanitizer config module | Same as above — no pre-existing HAST schema. Use `hast-util-sanitize`'s `defaultSchema` as the base (RESEARCH.md §Pattern 3) with the documented filtered-tagNames + protocols override. |
| `src/lib/notes/scope-ref.ts` | new parse/build helpers | Pure string utility; no analog needed. RESEARCH.md §Pattern 2 has the complete regex + parse/build pair. |
| `src/lib/notes/ownership.ts` | new per-scope ownership check | Pure function dispatch over `scope_kind`. RESEARCH.md §Pattern 1 has the complete 4-way switch with ownership queries already written against the correct tables (portfolios, allocator_holdings, bridge_outcomes, strategies). |

**All four "no-analog" files are fully blueprinted in RESEARCH.md** — the planner's action sections for these can reference RESEARCH.md section numbers directly rather than an analog file.

---

## Metadata

**Analog search scope:**
- `supabase/migrations/` (037, 059, 066, 069 scanned)
- `src/app/api/notes/`, `src/app/api/bridge/outcome/`, `src/app/api/allocator/`
- `src/app/(dashboard)/allocations/` (AllocationDashboard, widgets, hooks, lib)
- `src/components/mandate/`, `src/components/exchanges/`, `src/components/ui/`
- `src/__tests__/` (allocator-holdings-rls, bridge-outcomes-rls)
- `src/app/strategy/[id]/page.tsx`
- `src/lib/audit.ts`, `src/lib/supabase/`
- `docs/architecture/adr-0023-audit-event-taxonomy.md`

**Files scanned:** ~30 (targeted grep/read — no broad exploration)

**Pattern extraction date:** 2026-04-21

## PATTERN MAPPING COMPLETE

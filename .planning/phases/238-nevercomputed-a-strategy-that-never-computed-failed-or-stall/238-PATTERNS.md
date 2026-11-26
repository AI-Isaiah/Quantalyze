# Phase 238: NEVERCOMPUTED - Pattern Map

**Mapped:** 2026-11-24, at worktree HEAD `fd0e39977` (RESEARCH was measured at `4b89c54cb`; no cited anchor moved).
**Files analyzed:** 28 (PR-1: 13, PR-2: 15), counting rows of the two File Classification tables below.
**Analogs found:** 27 / 28. The one statement with no precedent is the PR-2 migration's `ALTER TABLE ... DISABLE TRIGGER` (searched: `grep -rln "DISABLE TRIGGER" supabase/migrations` returns only `20260719120000_retention_orphaned_running_compute_jobs.sql`, which names it in a comment as something it deliberately does not use).
**Anchor provenance.** Re-read or re-grepped by me at this HEAD: all `page.tsx`, `status-surface-copy.ts`, `DegradeLine.tsx`, `degrade-warnings.ts`, `FactsheetView.tsx`, `v2/page.tsx`, `MandatePanels.tsx`, `fetch-and-build-payload.ts`, `utils.ts` anchors; key-pill `:373`, `:778`, `:782`, `:807`, `:1289`, `:1336`, `:1361`, `:1432`, `:1498-1499`, `:1562`, `:1592`, `:1603`, `:1671-1760`, `:1777`, `:1856`; merged `:337`, `:1402-1403`, `:1413`, `:1437`, `:1468`, `:1484`, `:1517`, `:1547`; `types.ts:307`; `database.types.ts` `strategy_analytics` block starts `:2792`, `Row` `computed_at` `:2802` (the `:2840` and `:2878` Insert/Update hunks are carried from RESEARCH and unread: re-grep); `SyncBadge.tsx:254-258`; `queries.ts:1057`; `AdminTabs.tsx:78`; `baseline.sql` `CREATE TABLE ... "strategy_analytics"` at `:14027` (RESEARCH said `:14028`); page `rows` `:1007`, `healthByRow` `:1037`. CARRIED from RESEARCH and not re-read: `page.owner-compute-state.test.tsx` anchors beyond `:900-1005`, `status-surface-copy.test.ts` `:278-296`/`:423-427`/`:462-474` beyond the ranges I read, `degrade-warnings.test.tsx:223/:999`, `page.table.test.tsx:600-630`, `baseline.sql:10940-12304`, the per-file token counts in the census, and the PR-2 PROD counts. `plan-anchor-verify` re-resolves anchors that reach PLAN.md, so re-grep before copying a carried one.
**Tracked-source gate:** every analog path named in this file was checked with one `git ls-files` batch (25 paths) plus the earlier batches (12 + 5); all are git-tracked. No `.gsd/capabilities` mirror path appears.

## Split

| PR | Requirement | Migration | Ships |
|----|-------------|-----------|-------|
| PR-1 | FACT-05 | none | now |
| PR-2 | FACT-03 | yes (one serial lane) | after Phase 233 merges and the migration lane is free; re-pick the version and re-run the census then |

---

## File Classification

### PR-1 (FACT-05)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/status-surface-copy.ts` (modify: two leads, `KCS12-PUBLIC-UNKNOWN`, retire `MINT_TOKEN_NOTES.not_available`) | utility (copy constants) | transform | itself, the `MINT_UNBUILDABLE_NOTES` / `PUBLIC_UNBUILDABLE_NOTES` tables (170.1 D-08 `finished_not_built` is the same "remove `yet`, name the action" edit) | exact |
| `src/components/degrade/DegradeLine.tsx` (modify: export the file-local `Action` renderer) | component | request-response (render) | itself (`Segment` already calls `Action`) | exact |
| `src/app/(dashboard)/strategies/page.tsx` (modify: descriptor in `shareNotes`, resolve in `noteFor`) | controller (async server page) | request-response | itself: `healthDetailFor` `stale_no_data` arm (`:1159-1189`) for the action rule | exact |
| `src/app/factsheet/[id]/v2/page.tsx` (modify: owner pending panel note) | controller (async server page) | request-response | itself: `ownerRemedyLine` + remedy `<p>` (`:870-975`) | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` (modify: `OwnerUnpublishedPanel` `shareNote?: string` becomes `string \| ReactNode`) | component (`"use client"`) | request-response (render) | itself, `OwnerUnpublishedPanel` (`:1376-1442`) | exact |
| `src/lib/degrade-warnings.ts` (read only: `ACTION_SENTENCES`, `viewerRemedyAction`, `ownerRemedyAction`; `strategies.share-note` stays marker-only) | utility / registry | transform | n/a, unchanged | n/a |
| `src/app/(dashboard)/strategies/page.key-pill.test.tsx` (modify) | test | request-response | itself (`MINT_B`/`PUBLIC` constants `:778-783`, `it.each(variants)` `:1747`) | exact |
| `src/app/(dashboard)/strategies/page.merged.test.tsx` (modify: role matrix, parity, published cases) | test | request-response | itself (`noDataRow` `:1437`, `asRole` `:337`, stale-no-data role tests `:1488-1548`) | exact |
| `src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx` (modify: re-point `SHARE-NOTE-B`) | test | request-response | itself (`:956-964`) | exact |
| `src/lib/status-surface-copy.test.ts` (modify: pins, anti-vacuity floor) | test | transform | itself (`:270-296`, `:415-427`, `:462-474`, `:752-839`) | exact |
| `TODOS.md` (delete `[170.1-STRATEGIES-NOTE-WAIT-WORDING]`) | config (ledger) | CRUD | CLAUDE.md "TODOS.md holds open work only" rule (b) | rule |
| `CHANGELOG.md`, `VERSION`, `package.json` | config | CRUD | CLAUDE.md "CHANGELOG discipline"; `critical-regressions.test.ts` byte-equal pin | rule |
| `src/__tests__/degrade-warning-scan.test.ts` (re-measure, edit only if `tripHits` or id set moves) | test | transform | itself, `LIST_PAGE` row | exact |

### PR-2 (FACT-03)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/<ts>_strategy_analytics_computed_at_nullable.sql` (new) | migration | batch (one-time backfill + DDL) | `supabase/migrations/20261013120000_strategy_analytics_hold_computed_at_until_success.sql` (same table, same trigger, catalogue-only verify, `SET LOCAL lock_timeout`); header voice from `20261123180000_api_keys_venue_server.sql` | role-match (no precedent for `DISABLE TRIGGER`) |
| `supabase/migrations/down/<ts>-rollback.sql` (new) | migration (rollback) | batch | `supabase/migrations/down/20261013120000-rollback.sql` and `down/20261123180000-rollback.sql` | exact |
| `src/__tests__/nevercomputed-backfill-sql-exec.test.ts` (new) | test | batch (throwaway PG cluster) | `src/__tests__/oneaccountonce-delete-sql-exec.test.ts` | exact |
| `src/__tests__/computed-at-reader-census.test.ts` (new) | test | transform (source scan) | `src/__tests__/recompute-verdict-census.test.ts` | exact |
| `src/lib/factsheet/` shared never-computed constant + `isNeverComputedStamp` helper (new, location chosen by planner) | utility | transform | `src/lib/utils.ts` `formatDay` (`:158-163`, the null-to-`—` idiom); sentinel today duplicated at `fetch-and-build-payload.ts:977` and `FactsheetView.tsx:1713` | role-match |
| `src/app/factsheet/[id]/v2/MandatePanels.tsx` (modify `:93`) | component | request-response | itself | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` (modify footer stamp `:3439`, `FreshnessChip` `:1713`/`:1840`) | component | request-response | itself, `FreshnessChip` sentinel arm | exact |
| `src/lib/factsheet/fetch-and-build-payload.ts` (modify `:977` to import the shared constant) | service | request-response | itself | exact |
| `src/lib/types.ts` (`StrategyAnalytics.computed_at: string \| null`, `:307`) and `src/lib/database.types.ts` (three hunks) | model | n/a | generated; `tsc --noEmit` is the check | n/a |
| `src/components/admin/AdminTabs.tsx` (modify: local row type `computed_at: string` at `:78` becomes `string \| null`; its `computeRecency`/`everComputed` arm already answers `—`) | component | request-response | itself | exact |
| Comment-only refresh in the same PR (stale after the change, no behaviour): `src/lib/queries.ts` (`:704`, `:739-757`, `:976`), `src/lib/types.ts` (`:452`), `src/components/strategy/StrategyTable.tsx` (`:274-276`, `:1938-1975`), `src/components/admin/AdminTabs.tsx` (`:389`), `src/lib/stored-analytics-result.ts` (`:11`), `src/app/factsheet/[id]/v2/FactsheetView.tsx` (`:1710`) | n/a | n/a | n/a (RESEARCH "Comment-only mentions to refresh"; line numbers carried, re-grep) | n/a |
| Focused factsheet NULL-date test (new, e.g. `src/app/factsheet/[id]/v2/never-computed-date.test.tsx`) | test | request-response | `src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx` (render harness) and `src/components/strategy/SyncBadge.trade-fetch.test.tsx` | role-match |
| `src/components/strategy/SyncBadge.trade-fetch.test.tsx` (extend: NULL pin, every `title` branch) | test | request-response | itself | exact |
| Existing NULL pins: `AdminTabs.test.tsx`, wizard preview tests, `StrategyGrid.test.tsx`, `StrategyTable.stale-analytics.test.tsx` | test | request-response | themselves | exact |
| `TODOS.md` (delete `[166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT]`), `CHANGELOG.md`, `VERSION`, `package.json` | config | CRUD | as PR-1 | rule |

---

# PR-1 Pattern Assignments

## `src/lib/status-surface-copy.ts` (utility, transform)

**Analog:** the same file's unbuildable tables (170.1 D-08 / 164.6.6.3.3 D-08). Copy their shape: a `const` table, ASCII apostrophes, a `Record<..., string>` totality constraint, a docblock naming the KCS id.

**The text being retired and its neighbours** (lines 452-462):
```typescript
const MINT_TOKEN_NOTES = {
  in_progress:
    "Right now, a private link to this strategy shows that its factsheet is being prepared. The numbers appear there once a computation succeeds.",
  not_available:
    "Right now, a private link to this strategy shows that its factsheet is not available yet. The numbers appear there once a computation succeeds.",
  unreadable:
    "Right now, a private link to this strategy shows a placeholder page instead of the numbers. They appear there once a computation succeeds.",
} as const satisfies Record<RecipientArm, string>;

const PUBLIC_URL_NOTE =
  "Right now, this strategy's factsheet link shows that the factsheet is not available yet. The numbers appear there once a computation succeeds.";
```

**The precedent edit (170.1 D-08: drop `yet`, name the action)** (lines 567-587): `MINT_UNBUILDABLE_NOTES.finished_not_built` reads `"Right now, a private link to this strategy shows that its factsheet is not available. The last computation finished, but ... Use the contact form to have it checked."` The new leads are the same first sentence without `yet`:
```typescript
// UI-SPEC Copywriting Contract
KCS12-MINT-B-LEAD   = "Right now, a private link to this strategy shows that its factsheet is not available."
KCS12-PUBLIC-LEAD   = "Right now, this strategy's factsheet link shows that the factsheet is not available."
KCS12-PUBLIC-UNKNOWN = "Right now, this strategy's factsheet link shows that the factsheet is not available. If no computation is running, use the contact form to have it checked."
```

**The total string API** (lines 478-483, 647-657) is what keeps sweep tests meaningful. RESEARCH's recommendation: make `recipientShareNote("mint-token","not_available")` return `lead + " " + CONTACT_CHECK_REMEDY.before` (`CONTACT_CHECK_REMEDY` is at `:339-343`, already in this file), so the string API stays total and never renders a half sentence:
```typescript
export function recipientShareNote(mode: ShareAffordanceMode, arm: RecipientArm): string {
  return mode === "public-url" ? PUBLIC_URL_NOTE : MINT_TOKEN_NOTES[arm];
}
export function recipientShareNoteFor(mode, arm, kind): string {
  if (kind === null) return recipientShareNote(mode, arm);
  if (mode === "public-url") return PUBLIC_UNBUILDABLE_NOTES[kind];
  if (arm === "not_available") return MINT_UNBUILDABLE_NOTES[kind];
  if (arm === "unreadable") return MINT_UNBUILDABLE_UNREADABLE_NOTES[kind];
  return recipientShareNote(mode, arm);
}
```

**Do NOT value-import `ACTION_SENTENCES` here.** `src/lib/degrade-warnings.ts` already value-imports `./status-surface-copy` (`KCS10_PUBLIC_SENTENCE`, `ownerStateIsDated`, `ownerStateLine`, `untrustedKeyCaption`), so the import would be a cycle. The module owns the leads and `KCS12-PUBLIC-UNKNOWN`; the composition `lead + " " + ACTION_SENTENCES[id].sentence` happens in a file that already imports both (the page, `v2/page.tsx`).

**Remedy source reused as-is** (lines 365-386 `REMEDY_RULES`, 428-448 `ownerRemedy`): `stalled`, `failed_transient/_orphaned/_unknown/_other`, `never_started` map to `"shape"`; `failed_permanent` to `"contact_permanent"`. Do not edit.

## `src/components/degrade/DegradeLine.tsx` (component, render)

**Analog:** itself. The change is `export`ing the file-local `Action` (line 62) under a public name; `Segment` (lines 52-60) is the existing in-file caller, so `knip` has a user, and the strategies page plus `v2/page.tsx` are two more.

**Core pattern** (lines 62-110):
```typescript
function Action({ id, strategyId }: { id: ActionId; strategyId?: string }) {
  const action = ACTION_SENTENCES[id];
  const { sentence } = action;
  switch (action.link) {
    case "exchanges":
      return <LinkedPhrase sentence={sentence} phrase={action.phrase} link={<ExchangesPageLink />} />;
    case "contact":
      return (
        <ContactPointerText
          text={sentence}
          href={contactHref({ topic: "support", strategy: strategyId })}
        />
      );
    case "edit":
      if (!strategyId) return <>{sentence}</>;
      return ( <LinkedPhrase ... link={<Link href={`/strategies/${encodeURIComponent(strategyId)}/edit`} className="text-accent underline underline-offset-4">{action.phrase}</Link>} /> );
    case "csv": ...
    case "deselect":
    case "none":
      return <>{sentence}</>;
  }
}
```
Header comment (lines 13-31) says "No client directive and no data fetch: usable from server and client trees." Keep that true. Do not write a second copy of the renderer (UI-SPEC §1.4).

## `src/app/(dashboard)/strategies/page.tsx` (controller, request-response)

**Analog:** itself. Three anchors at current HEAD.

**1. Imports to extend** (lines 49-55, 70-75): add `Action` (the exported renderer) beside `DegradeLine`; `ownerRemedy` and `viewerRemedyAction` are already imported.
```typescript
import { ownerRemedy, probeUnreadableShareNote, recipientShareNoteFor, unbuildableNoteKindOf, untrustedKeyCaption } from "@/lib/status-surface-copy";
import { DegradeLine } from "@/components/degrade/DegradeLine";
import { degradeSegments, viewerRemedyAction, type StaleAction } from "@/lib/degrade-warnings";
```

**2. `armOf` and the published skip (IN-04)** (lines 754-783). The comment at `:758-766` ("so a published row can never take the finished-not-built kind") becomes untrue and must be rewritten. `armOf` keeps returning `state: null` for a published row; the state for a published row comes from `failedFacts`, resolved late.
```typescript
if (mode === "public-url") {
  return Promise.resolve({ arm: "not_available", state: null, jobDay: null, compositeHistory: "unreadable" });
}
const known = armReads.get(s.id);
if (known) return known;
const read = readRecipientArm(supabase, s.id, { memberCount: memberCountOf(s.id), apiKeyId: s.api_key_id ?? null });
armReads.set(s.id, read);
return read;
```

**3. Selection: `uncomputedNote` and the `shareNotes` Map** (lines 792-803, 814-939). `shareNotes` is `Map<string, string>`, built before `rows` (`:1007`), `healthByRow` (`:1037`), `failedFacts` (`:1107`) and `shapeOf` (`:1119`, a `const` arrow, so calling it inside the `shareNotes` build is a TDZ `ReferenceError`). The cut RESEARCH recommends: each map value becomes a descriptor (`{kind:"text", text}` for every unchanged note; `{kind:"remedy", state, compositeHistory}` for an unpublished kind-less `not_available` row; `{kind:"public-uncomputed"}` for a published kind-less row), resolved in `noteFor`, where `shapeOf`, `isManager` and `failedFacts` all exist. Keep the `entry[1] !== null` filter semantics (line 938).
```typescript
const uncomputedNote = async (s, mode, analyticsFailed = false): Promise<string> => {
  const { arm, state } = await armOf(s, mode);
  const kind = unbuildableNoteKindOf("not_computed", {
    ...(analyticsFailed ? { analyticsFailed: true as const } : {}),
    jobsFinished: state?.state === "finished",
  });
  return recipientShareNoteFor(mode, arm, kind);
};
```

**4. The action rule to copy verbatim** (the `stale_no_data` arm of `healthDetailFor`, lines 1159-1189). The note must run the SAME computation on the SAME inputs, so the parity invariant (UI-SPEC G3, Test Contract 4) holds by construction:
```typescript
if (health?.kind === "stale_no_data") {
  const facts = failedFacts.get(s.id);
  const state: ComputeState = facts?.state ?? { state: "unreadable" };
  ...
  const shape = shapeOf(s, facts.compositeHistory);
  const remedy = ownerRemedy(state, shape, s.id);   // no build facts, as strategies.stale-no-data
  ... action: viewerRemedyAction({ remedy, managerSurface: isManager, shape }),
```
Raw `ownerRemedy` is never used on `/strategies`: only `viewerRemedyAction` keeps an allocator-only viewer off the manager-guarded edit page and CSV wizard (199 CD-11).

**5. The published row's state source** (`failedFactsOf`, lines 1051-1106; map at `:1107-1116`). It reads jobs only for Health `analytics_failed` or `stale_no_data`, so a published `Updating`/`Key problem`/`Healthy` row has no state and takes `KCS12-PUBLIC-UNKNOWN`. Add no jobs read.
```typescript
const failedFacts = new Map(await Promise.all(rows
  .filter((s) => { const kind = healthByRow.get(s.id)?.kind; return kind === "analytics_failed" || kind === "stale_no_data"; })
  .map(async (s) => [s.id, await failedFactsOf(s)] as const)));
```
Resolution table for a published kind-less row (RESEARCH "PR-1 structure" fact 2): unknown or `unreadable` -> `KCS12-PUBLIC-UNKNOWN`; `queued`/`retrying`/`running` -> `KCS12-PUBLIC` (unchanged words); `finished` -> `PUBLIC_UNBUILDABLE_NOTES.finished_not_built` via `unbuildableNoteKindOf("not_computed", { jobsFinished: true })`; `failed`/`stalled`/`never_started` -> `KCS12-PUBLIC-LEAD` + action.

**6. The `<p>` that keeps its markers** (`noteFor`, lines 1251-1307, `<p>` at `:1291-1303`). Keep the element, both attributes and the class; only its content changes. Keep it in `page.tsx`: a new file under `strategies/` becomes a walked file for `degrade-warning-scan.test.ts` and moves the `strategies.share-note` ledger row.
```tsx
{shareNote && (
  <p
    data-testid="strategy-row-share-note"
    data-degrade-id="strategies.share-note"
    className="text-caption font-normal text-text-muted"
  >
    {/* AD-05: the note's "contact form" phrase links the support topic with this row's strategy id. */}
    <ContactPointerText text={shareNote} href={contactHref({ topic: "support", strategy: s.id })} />
  </p>
)}
```
String-only notes (every unchanged note and `KCS12-PUBLIC-UNKNOWN`) keep the `ContactPointerText` path. A descriptor note renders `{lead}{" "}<Action id={actionId} strategyId={s.id} />`.

**Auth/role pattern:** `isManager` at `:514` (`role === "manager" || role === "both"`). **Error handling:** a failed jobs read is already the `unreadable` state; `armOf`'s `readRecipientArm` and `failedFactsOf`'s `try/catch` + `captureToSentry` (`:1063-1087`) are the precedent. No new error path.

## `src/app/factsheet/[id]/v2/page.tsx` and `FactsheetView.tsx` (owner pending page, second caller)

**Analog:** the page's own KCS-09 remedy line. The panel note must map the SAME remedy object through `ownerRemedyAction` so the two cannot differ (UI-SPEC §1.7; this page does not apply the viewer mapping today and this phase does not add it).

**Today** (`v2/page.tsx` lines 870-872 and 929-939):
```typescript
const ownerRemedyLine = ownerStatus && ownerRemedy(ownerStatus.state, ownerStatus.shape, signature.id, ownerBuildFacts);
...
shareNote={
  ownerStatus
    ? ownerBuildability?.unreadable
      ? probeUnreadableShareNote("mint-token")
      : recipientShareNoteFor("mint-token", recipientArm(ownerStatus.state), ownerBuildability?.kind ?? null)
    : undefined
}
```
Change only the kind-less `not_available` case: `KCS12-MINT-B-LEAD` + `Action` of `ownerRemedyAction(ownerRemedyLine)`.

**Panel prop** (`FactsheetView.tsx` lines 1399 and 1432-1439): `shareNote?: string` becomes `string | ReactNode`; a string keeps the `ContactPointerText` path, a node renders as is.
```tsx
{shareNote && (
  <p className="mt-2 text-fixed-12 text-text-muted">
    <ContactPointerText text={shareNote} href={contactHref({ topic: "support", strategy: strategyId })} />
  </p>
)}
```
The file is `"use client"`; a server-built node passed as a prop has a precedent in the strategies page (it passes server-built `note` nodes into the client table). RESEARCH tags this exact prop `[ASSUMED]` until the executor's render test and `tsc` pass (Pitfall 7: test with a node and with a string).

## Test files (PR-1)

### `src/app/(dashboard)/strategies/page.key-pill.test.tsx`

**Constants to re-point** (lines 776-783): typed-out literals, never imported.
```typescript
const MINT_B = "Right now, a private link to this strategy shows that its factsheet is not available yet. The numbers appear there once a computation succeeds.";
const PUBLIC = "Right now, this strategy's factsheet link shows that the factsheet is not available yet. The numbers appear there once a computation succeeds.";
```
**Assertion helper** (line 807-809): `noteOf(container, name)` returns `shareNoteOf(...)?.textContent`, so a full-sentence `toBe` is the pattern. **The `it.each` to re-point, not delete** (lines 1671-1760): `stalled`, `failed`, `never_started` currently expect `MINT_B`.
```typescript
const variants: Array<{ variant: string; setup: () => void; expected: () => string }> = [
  { variant: "stalled", setup: () => { state.jobs = { "s-1": [{ kind: "stitch_composite", status: "running", created_at: isoMinutesAgo(60), claimed_at: isoMinutesAgo(60) }] }; }, expected: () => MINT_B },
  { variant: "failed",  setup: () => { state.jobs = { "s-1": [{ kind: "stitch_composite", status: "failed_final", error_kind: "permanent", created_at: "2026-02-01T00:00:00.000Z" }] }; }, expected: () => MINT_B },
  { variant: "never_started", setup: () => { state.jobs = { "s-1": [] }; }, expected: () => MINT_B },
  ...
];
it.each(variants)("D-08 R-1 VARIANT $variant: ...", async ({ setup, expected }) => {
  state.strategies = [row("s-1", { status: "draft", strategy_analytics: { computation_status: "pending" } })];
  setup();
  const container = await renderPage();
  const note = noteOf(container, "Strategy s-1");
  expect(note).toBe(expected());
  expect(note).not.toBe(FINISHED_NOT_BUILT);
  expect(note).not.toContain("The last computation finished");
});
```
Re-derived expectations (RESEARCH, assumption A7; re-derive by running): `stalled` (stitch job, no key, no members) -> `KCS12-MINT-B-RELOAD`; `failed` (permanent) -> `KCS12-MINT-B-CONTACT-RESOLVE`; `never_started` -> `KCS12-MINT-B-LINK-KEY-EDIT`. The other `MINT_B` sites: `:1289` race test, `:1432`, `:1498-1499`, `:1592` (`A-RELOAD`), `:1856` (`LINK-KEY-EDIT`). The `PUBLIC` sites: `:1361`, `:1562`, `:1603`, `:1777` all become `KCS12-PUBLIC-UNKNOWN` (no jobs read for an `Updating` row); `:1336` gets `KCS12-PUBLIC-UNKNOWN` added to its negative.

**D-08 PUBLISHED-FINISHED precedent for the zero-RPC pin** (lines 1771-1779): keep `expect(state.rpcCalls).toEqual([])`, change only the expected sentence.
```typescript
state.strategies = [row("s-pub", { status: "published", strategy_analytics: { computation_status: "pending" } })];
state.jobs = { "s-pub": [doneJob] };
const container = await renderPage();
expect(noteOf(container, "Strategy s-pub")).toBe(PUBLIC);   // re-point to KCS12-PUBLIC-UNKNOWN
expect(state.rpcCalls).toEqual([]);
```
This file's profile mock fixes the viewer role to `manager` (`:373`), so the allocator-only matrix does NOT belong here.

### `src/app/(dashboard)/strategies/page.merged.test.tsx`

**Analog for the role matrix, parity and published cases.** Helpers: `asRole(role)` (line 337-339), `noDataRow(id, extra)` (1437-1439, Health `Stale (no data yet)`), `failedRow(id, status, extra)` (1275), `detailOf(name, id)`, `state.jobs[...]`, `FAILED_JOB`. The idiom: loop `["manager","both"]` with `unmount()`, then `asRole("allocator")`, assert the exact `textContent`, assert the specific `a[href=...]`, and assert a container-wide negative.
```typescript
it("an allocator-only viewer: the Exchanges page for a key-fed strategy, the contact form for one with no key, never the edit page", async () => {
  asRole("allocator");
  state.strategies = [noDataRow("s-keyed", { api_key_id: "key-1" }), noDataRow("s-bare")];
  const { container } = render(await renderToElement());
  expect(detailOf("Strategy s-keyed", "strategies.stale-no-data")!.textContent).toBe(`${PREFIX}Check its key on the Exchanges page.`);
  expect(detailOf("Strategy s-bare", "strategies.stale-no-data")!.textContent).toBe(`${PREFIX}Use the contact form to have it checked.`);
  expect(container.querySelector('a[href*="/edit"]')).toBeNull();
});
```
Existing container-wide negatives that are the neuter sentinel for `managerSurface`: `a[href*="/edit"]` null at `:1402`, `:1468`, `:1517`, `:1547`; `a[href*="/strategies/new"]` null at `:1403`, `:1413`, `:1484`. A `Stale (no data yet)` row now carries a second link-bearing line, so re-run the whole file. The parity test asserts that the trailing action sentence of the `strategies.stale-no-data` detail equals the note's, for at least two shapes.

### `src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx`

**Re-point `SHARE-NOTE-B`** (lines 954-964), keep the className assertion, also assert the same action ends the page's remedy line:
```typescript
it("SHARE-NOTE-B: a failed job -> the panel's last child is KCS12-MINT-B", async () => {
  givenOwnerPendingDraft();
  givenJobs(TRIGGER_ROWS);
  const { container } = await renderOwnerPending();
  const last = panelOf(container).lastElementChild as HTMLElement;
  expect(last.textContent).toBe(MINT_B);
  expect(last.className).toBe(SHARE_NOTE_CLASS);
});
```
`TRIGGER_ROWS` is a permanent `stitch_composite` failure, so the new text is `Right now, a private link to this strategy shows that its factsheet is not available. Use the contact form to have it resolved.` The loop at `:1000-1002` (`for (const note of [MINT_A, MINT_B, MINT_UNREADABLE])`) stays valid. `FULL-RENDER-NO-NOTE` (`panel.querySelector("p.mt-2")` null) is the pin for the absent-prop path.

### `src/lib/status-surface-copy.test.ts`

Pins to move: `KCS12-MINT-B` (`:278-282`), `KCS12-PUBLIC: public URL, any arm` (`:290-296`, no longer true for every arm), `SELECTION` (`:423-427`), `H-2 NO FALSE TAIL` (`:462-474`, extend to the kind-less `not_available` arm). **Anti-vacuity walk** (`:752-839`): `DISTINCT_FLOOR = 50` is "17 state lines + 8 remedies + 4 arm notes + 12 unbuildable notes + 2 probe notes + 7 exported constant strings". Retiring `MINT-B` lowers it; adding the composed notes to `everyRenderedString()` raises it. Re-measure and raise; "Never lower it to fit."
```typescript
function everyRenderedString(): Set<string> {
  const out = new Set<string>();
  for (const state of VARIANTS) { for (const build of BUILDS) { out.add(ownerStateLine(state, build).text); for (const shape of SHAPES) out.add(rendered(ownerRemedy(state, shape, SID, build))); } }
  for (const mode of MODES) { for (const arm of ARMS) { out.add(recipientShareNote(mode, arm)); out.add(recipientShareNoteFor(mode, arm, null)); for (const kind of KINDS) out.add(recipientShareNoteFor(mode, arm, kind)); } out.add(probeUnreadableShareNote(mode)); }
  ...
}
```
The composed notes (lead + each reachable action sentence) are built in the page, so the walk must add `lead + " " + ACTION_SENTENCES[id].sentence` for the 8 actions, per mode, plus `KCS12-PUBLIC-UNKNOWN`.

### Unchanged pins that must stay green (run them)
`src/lib/degrade-warnings.test.tsx` (`strategies.share-note` marker-only pin at `:223`/`:999`, the `ownerRemedy` to `ACTION_SENTENCES` sweep), `src/__tests__/degrade-warning-scan.test.ts` (re-measure `LIST_PAGE` `tripHits: 3` and the id set; the action renderer adds no `role`, `aria-live` or warning class), `src/__tests__/no-email-in-copy.test.ts`, `src/__tests__/copy-census.test.ts`, `page.table.test.tsx` (`:600-630`, footer 3 children, note last), `page.share-affordance.test.tsx`.

---

# PR-2 Pattern Assignments

## `supabase/migrations/<ts>_strategy_analytics_computed_at_nullable.sql` (migration, batch)

**Analog:** `supabase/migrations/20261013120000_strategy_analytics_hold_computed_at_until_success.sql` (same table, same trigger, same house conventions). Header voice and "NO DATA CENSUS" paragraph from `supabase/migrations/20261123180000_api_keys_venue_server.sql` (most recent column migration; `git ls-files` confirms both tracked).

**House conventions to copy**
- Header block: WHAT / WHY / the reversal of 166.5 R-04 / caller impact / WHAT THIS DELIBERATELY DOES NOT FIX / rollback pointer (analog lines 1-98).
- No explicit `BEGIN`/`COMMIT` ("Supabase wraps each migration in one implicit transaction", analog lines 85-90; migration-reviewer invariant 14).
- Lock line (analog line 93-95): 
```sql
-- Fail loud rather than queue behind a long reader
SET LOCAL lock_timeout = '3s';
```
- Self-verify block reads the catalogue only ("the house rule after [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE], since shared TEST holds none of PROD's rows"), analog lines 156-195:
```sql
DO $$
DECLARE
  v_tgtype    INT2;
  v_tgenabled "char";
BEGIN
  SELECT tgtype, tgenabled INTO v_tgtype, v_tgenabled
    FROM pg_trigger
   WHERE tgname = 'strategy_analytics_hold_computed_at_until_success_trigger'
     AND tgrelid = 'public.strategy_analytics'::regclass
     AND NOT tgisinternal;
  IF v_tgtype IS NULL THEN RAISE EXCEPTION '... missing after migration'; END IF;
  IF v_tgenabled IS DISTINCT FROM 'O' THEN RAISE EXCEPTION '... the hold trigger is not enabled (tgenabled=%)', v_tgenabled; END IF;
  -- pg_trigger.tgtype bits: 1 = FOR EACH ROW, 2 = BEFORE, 4 = insert, 8 = delete, 16 = update.
  IF (v_tgtype & 1) = 0 OR (v_tgtype & 2) = 0 OR (v_tgtype & 16) = 0 THEN RAISE EXCEPTION '...'; END IF;
```
- Column-shape verify (the closest precedent for the `attnotnull`/`atthasdef` arm; `20261123180000_api_keys_venue_server.sql:249-258`), a catalogue-only block with a named dollar-quote tag and the `'Migration <version> failed: <what>'` message style:
```sql
DO $verify$
DECLARE
  v_fn_oid oid;
  v_count  int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'api_keys'
                    AND column_name = 'venue_server'
                    AND data_type = 'text' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'Migration 20261123180000 failed: public.api_keys.venue_server is missing, not text, or not nullable';
  END IF;
```
  For PR-2 assert `is_nullable = 'YES'` and `column_default IS NULL` for `public.strategy_analytics.computed_at` (or `pg_attribute.attnotnull = false` / `atthasdef = false`, which the existing `F1-EDGE` gate arm also derives from). This block's own header (lines 244-247) records why: a verify that checked what a gate mutates would abort the apply of a mutated copy, so keep the checks to shape and enablement, never to the thing a RED-UNDER arm mutates.
- Optional `prod-body-ack:` header is for function-body VAC-04 only; this migration changes no function body, so none is needed.

**The new shape (tested on PG 16.13 by the researcher; RESEARCH "PR-2 migration design")**
```sql
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.strategy_analytics
  ALTER COLUMN computed_at DROP DEFAULT,
  ALTER COLUMN computed_at DROP NOT NULL;

-- the hold trigger restores OLD.computed_at on failed/computing, so a plain UPDATE is a silent no-op
ALTER TABLE public.strategy_analytics DISABLE TRIGGER strategy_analytics_hold_computed_at_until_success_trigger;
UPDATE public.strategy_analytics SET computed_at = NULL
 WHERE computation_status IN ('pending','computing','failed')
   AND computed_at IS NOT NULL
   AND cumulative_return IS NULL
   AND COALESCE(daily_returns,  'null'::jsonb) IN ('null'::jsonb,'[]'::jsonb,'{}'::jsonb)
   AND COALESCE(returns_series, 'null'::jsonb) IN ('null'::jsonb,'[]'::jsonb,'{}'::jsonb);
ALTER TABLE public.strategy_analytics ENABLE TRIGGER strategy_analytics_hold_computed_at_until_success_trigger;

DO $$ BEGIN
  PERFORM 1 FROM public.strategy_analytics WHERE <same predicate>;
  IF FOUND THEN RAISE EXCEPTION 'NEVERCOMPUTED: ...'; END IF;
END $$;
```
**The one guard spelling the data-dependence linter accepts is `PERFORM 1 FROM ...; IF FOUND THEN RAISE`.** `IF EXISTS (SELECT ...)` is refused as R2 and `SELECT count(*) INTO v; IF v > 0` as R1 (`scripts/lint-migration-data-dependence.mjs`, tracked). It fires only when a bad row survives, so a data-empty TEST database cannot withhold a PROD apply. Never add a baseline-ledger line (it only shrinks, has no opt-out).

**Gaps vs the analog (call these out to migration-reviewer)**
- `ALTER TABLE ... DISABLE TRIGGER` has no precedent in `supabase/migrations/`; `20260719120000_retention_orphaned_running_compute_jobs.sql` says in a comment that it deliberately does not use it. It takes `SHARE ROW EXCLUSIVE` until commit, bounded by `lock_timeout = '3s'`, and an abort restores the trigger (one implicit transaction). The catalogue arm must assert `tgenabled = 'O'` for the hold trigger afterwards (copy the analog's check above), plus `pg_attribute` `attnotnull = false` and `atthasdef = false` for `computed_at`.
- The predicate is NOT status alone (founder ruling): raw figure presence (`cumulative_return`, `daily_returns`, `returns_series`), narrower than `hasStoredAnalyticsResult`, so when in doubt the date stays. PROD measured 2026-11-24 per RESEARCH Open Question 1: 11 `failed` never-computed rows selected, the 7 `failed`-with-figures rows not. Re-run the probe at PR-2 wave 0 (marker query first, counts only).
- The other two BEFORE UPDATE triggers still fire on the backfill (`strategy_analytics_stamp_computing_started` stamps `computing_started_at` on a `computing` row whose stamp is NULL); no-ops for rows with a stamp.
- No function body changes, so no `supabase/schema/functions/` regeneration. The bot re-dump PR (Phase 164.9.5) owns `baseline.sql`, `baseline-carried-migrations.txt` and `BASELINE.md`; the migration PR hand-edits none. `supabase/schema/BASELINE.md` "Regenerating" and CLAUDE.md Decision F cover the replay.
- Version: pick a timestamp above the PROD tip at execution time (backdate policy, `.github/workflows/migration-policy.yml`). Latest on disk now: `20261123180100_swap_account_slot.sql`.

## `supabase/migrations/down/<ts>-rollback.sql` (migration, batch)

**Analog:** `supabase/migrations/down/20261123180000-rollback.sql` (header voice: manual, off the auto-apply path, `psql --single-transaction -v ON_ERROR_STOP=1`, marker query first, "ledger row is left in place") and `down/20261013120000-rollback.sql` (the trigger's own rollback; marker-query warning; `SET LOCAL lock_timeout = '3s'`).

**Marker-query header to copy** (down/20261013120000-rollback.sql):
```sql
-- ⛔ THIS COMMAND TARGETS WHICHEVER DATABASE YOU POINT IT AT. This checkout's
-- Supabase CLI is linked to PRODUCTION. Run the marker query FIRST ...
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
SET LOCAL lock_timeout = '3s';
```
**Body (RESEARCH, measured D/D2):** `DISABLE` the hold trigger; `UPDATE ... SET computed_at = TIMESTAMPTZ 'epoch' WHERE computed_at IS NULL`; `ENABLE`; `SET DEFAULT now()`; `SET NOT NULL`. The epoch is the fill value, and the file must say why (one-way caveat 3 in CONTEXT): `now()` would reintroduce the false "computed just now" date; the epoch is the instant the factsheet already treats as never computed (`fetch-and-build-payload.ts:977`, `FactsheetView.tsx:1713`); the visible cost is `SyncBadge` printing an enormous age until the rollback is undone. Without disabling the trigger, the fill reports success, NULLs remain and `SET NOT NULL` fails (D2).

## `src/__tests__/nevercomputed-backfill-sql-exec.test.ts` (test, batch on a throwaway cluster)

**Analog:** `src/__tests__/oneaccountonce-delete-sql-exec.test.ts` (875 lines; sibling `src/__tests__/mt5-parity-capture-sql-exec.test.ts`). **This contradicts RESEARCH**, which says to register the new file in `vitest.node-env.ts` "as the sibling `*-sql-exec` files do": I measured `grep -n "sql-exec\|oneaccountonce\|mt5-parity-capture" vitest.node-env.ts vitest.config.ts` returns nothing, so NEITHER sibling is registered and both run under the default (jsdom) project. Do not follow the stale instruction: leave the new file unlisted like its siblings (listing it is optional and only safe if it touches no DOM global). No skip gate: with no binaries `beforeAll` THROWS.

**Cluster boot, verbatim pattern** (lines 402-431):
```typescript
beforeAll(() => {
  const sel = spawnSync("bash", [join(REPO, "scripts", "pg-lane", "run.sh"), "--print-pgbin"], { encoding: "utf8" });
  if (sel.status !== 0 || sel.stdout.trim() === "") { throw new Error("... no PostgreSQL server binaries. ..." + sel.stderr); }
  pgbin = sel.stdout.trim();
  // /tmp, not os.tmpdir(): the socket path must stay under the ~104-byte sun_path limit.
  root = mkdtempSync("/tmp/oaoc-");
  const data = join(root, "pgd");
  pg("initdb", ["-D", data, "-A", "trust", "-U", "postgres", "-E", "UTF8", "--locale=C"]);
  writeFileSync(join(data, "postgresql.conf"), `${readFileSync(...)}\nlisten_addresses = ''\nunix_socket_directories = '${root}'\nfsync = off\n`);
  started = true;   // Set BEFORE the start
  pg("pg_ctl", ["-D", data, "-l", join(root, "pg.log"), "-w", "-t", "30", "start"]);
  psql("postgres", "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;");
  psql("postgres", "CREATE DATABASE tmpl;");
  psql("tmpl", schemaSql(ddl));
  psql("tmpl", seedSql());
}, 120000);
afterAll(() => { if (started) spawnSync(join(pgbin, "pg_ctl"), ["-D", join(root, "pgd"), "-m", "immediate", "-w", "stop"], { env: HARNESS_ENV }); if (root) rmSync(root, { recursive: true, force: true }); });
```
**Real DDL cut from the baseline** (lines 203-212): use the same extractor for `strategy_analytics` (CREATE TABLE at `supabase/schema/baseline.sql` ~`:14028-14070`) and cut the three real trigger bodies from `supabase/schema/functions/` via the `fn(name)` reader (line 214). A miss throws naming the table.
```typescript
const m = new RegExp(`^CREATE TABLE IF NOT EXISTS "public"\\."${t}" \\(\\n[\\s\\S]*?^\\);\\n`, "m").exec(baseline);
if (!m) throw new Error(`... CREATE TABLE block for public.${t} not found in supabase/schema/baseline.sql`);
```
**Per-test clone with its own marker, fresh psql session per call, read-only row reader** (lines 294-330): `pg()`, `psqlRaw()`, `psql()`, `rows()` (`SET TRANSACTION READ ONLY` so a writing statement fails at the database), `clone()` (`CREATE DATABASE tN TEMPLATE tmpl; COMMENT ON DATABASE ... IS <LOCAL_MARKER>`).
**"Nothing written" is measured** (lines 333-343, 393-400): count + md5 of every fixture table before and after, `expect(state(db)).toEqual(before)`. For the decoys (the 7-style `failed`-with-figures row, `complete` rows) assert byte-identical via `tableRows(db, table, where)`.
**Static arms** (lines 433-471) to mirror: the migration carries no committed uuid; no psql meta-command (`expect(sql).not.toMatch(/^\\/m)`); no explicit `BEGIN`/`COMMIT`. A vacuity guard that the cluster is the throwaway one (`:473-477`).

**Arms required** (RESEARCH "Phase Requirements to Test Map" and PROOF-01 neuter table): backfill nulls exactly the never-computed rows; keeps the 7-style row; trigger re-enabled (`tgenabled='O'`); idempotent (second run updates 0); fails loud with the `NEVERCOMPUTED:` message when `DISABLE TRIGGER` is deleted from a byte-backed copy; post-migration INSERT with no date is NULL, a `failed`/`computing` write holds NULL, a `complete` write stamps; rollback restores NOT NULL and DEFAULT and writes the epoch, and fails when it skips the disable. Seed one row per status and figure combination (eight, as the researcher did).

## `src/__tests__/computed-at-reader-census.test.ts` (test, source scan)

**Analog:** `src/__tests__/recompute-verdict-census.test.ts` (707 lines). Same idiom end to end; replace the symbol scanners with the `computed_at` token scanners and the class set with the PR-2 classes.

**Imports and oracle independence** (lines 46-53): the only production import is `stripCommentsPreserveLines` (`@/lib/source-scan`, `:400`); symbol list, patterns, class set, census map and floors are typed in the test.
```typescript
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";
const REPO_ROOT = process.cwd();
const ROOTS = ["src"] as const;
```
**Key and entry shape** (lines 77-92, 116): `file::symbol` with an EXACT count and one class from a closed set; never a per-file allowance.
```typescript
const LEGAL_CLASSES = [ ... ] as const;           // PR-2: reader-render, reader-fresh, reader-key, reader-evidence, plumbing, sort-name, writer-stamp, synthetic, excluded-generated, other-table
interface Entry { count: number; class: Klass; reason: string; }
const CENSUS: Record<string, Entry> = {
  "src/lib/factsheet/fetch-and-build-payload.ts::isComputedAnalytics": { count: 2, class: "owner", reason: "..." },
  ...
};
```
Token regex per RESEARCH: `\b(computed_at|computedAt|analytics_computed_at|last_success_computed_at)\b`, plus a second pattern for the wildcard embed `strategy_analytics\s*\(\s*\*\s*\)` (the `getMyStrategies` embed at `src/lib/queries.ts:1057`, invisible to a token scan). Seed the CENSUS map from RESEARCH's per-file table (55 non-test `src/` files, 758 walked at `4b89c54cb`; re-measure at execution and after Phase 233 merges, whose FRESH-02 reader is a future entry).

**Scanner** (lines 395-452): `isTestPath`, `walk`, `readStripped`, `analyze(repoRoot, roots)` returning `{ walked, counts, text }`. **Verdict function** (lines 455-488) `judge(pop, census)` returns problem strings: `unclassified:` (names file, symbol, count, legal classes), `count:` (both counts), `stale:`, `class:`, `reason:`. **Anti-vacuity** (`WALKED_FLOOR = 700`, `PAIRS_FLOOR = 70` at `:391-392`; assertions at `:549-553`): record the measured floors for this census. **Planted self-tests over a temp directory** (lines 556-707): `withPlanted(files, run)` with `mkdtempSync`, one `it` each for unclassified reader, comment-only mention (no pair), stale entry, count change, illegal class + empty reason, test file not walked.
```typescript
it("an unclassified reader fails, naming the file and the symbol", () => {
  withPlanted({ "src/lib/planted-reader.ts": 'export const x = ...computed_at...;\n' }, (dir) => {
    const problems = judge(analyze(dir), {}).join("\n");
    expect(problems).toContain("unclassified: src/lib/planted-reader.ts");
    expect(problems).toContain(LEGAL_CLASSES.join(", "));
  });
});
```
**Python and SQL corpora.** The writer census, `analytics-service/tests/test_computed_at_stamp_census.py`, is pytest and pins the two stamp sites; the new census is the READER half and must not re-assert the writers. Build the Python and SQL corpora as separate maps in the same file with the same `judge`. Analogs found (my earlier "no precedent" claim was wrong):
- **Python:** `src/__tests__/holding-scope-key-census.test.ts` (902 lines, tracked) is a TS vitest census over BOTH `src` `.ts`/`.tsx` and `analytics-service/**/*.py`. `stripCommentsPreserveLines(source, lang)` takes `lang: SourceLang = "ts" | "py"` (`src/lib/source-scan.ts:117`, `:400-403`), so Python comments are stripped by the same function. Copy its walk and language switch (lines 437-475):
```typescript
import { stripCommentsPreserveLines, type SourceLang } from "@/lib/source-scan";
const SRC_EXTS = /\.tsx?$/;
const PY_EXT = /\.py$/;
const PY_SKIP_DIRS = new Set(["tests", ".venv", "__pycache__", "node_modules"]);
const TS_SKIP_DIRS = new Set(["__tests__", "fixtures"]);
function walk(root: string, accept: RegExp, skipDirs: ReadonlySet<string>, out: string[]): void { /* visit(), skip test paths */ }
function listPopulation(): string[] { const out: string[] = []; walk("src", SRC_EXTS, TS_SKIP_DIRS, out); walk("analytics-service", PY_EXT, PY_SKIP_DIRS, out); return [...new Set(out)].sort(); }
const langOf = (rel: string): SourceLang => (rel.endsWith(".py") ? "py" : "ts");
```
  It also carries a `POPULATION_FLOOR` (`:435`, measured count with the floor set a little under it) and per-matcher `langs: ["py"]` arms. Python target pattern: quoted `"computed_at"`/`'computed_at'` on non-comment lines (9 files, 38 hits at HEAD per RESEARCH, carried).
- **SQL:** `maskSql(src)` exported from `scripts/lint-sql-gates.mjs:334` masks SQL comments and string literals and is already imported from tests (`src/__tests__/extract-reference-inserts-selftest-floor.test.ts`, `src/__tests__/refdata-allowlist.test.ts`). Caution: it masks string-literal contents, so it can mask a quoted `'computed_at'` used as a column list in a string; for the strategy-column SQL readers (`sa.computed_at AS analytics_computed_at`, trigger bodies) the identifier is unquoted code and survives. SQL corpus = `supabase/schema/functions/*.sql` plus the views in `baseline.sql`, strategy column only (4 objects per RESEARCH, carried).

## Factsheet NULL arms, D3 and D4 (component, request-response)

**Analog for the null-to-dash rule:** `src/lib/utils.ts` `formatDay` (lines 158-163): `if (!iso) return "—"; ... if (Number.isNaN(d.getTime())) return "—";`. So passing a real null reaches `—` with no new code; the defect is that `fetch-and-build-payload.ts:977` substitutes the epoch sentinel first:
```typescript
const computedAt = analytics?.computed_at ?? "1970-01-01T00:00:00Z";    // fetch-and-build-payload.ts:977
const EPOCH_SENTINEL = "1970-01-01T00:00:00Z";                             // FactsheetView.tsx:1713 (duplicate literal)
if (computedAt === EPOCH_SENTINEL) { ... "Computed · not yet" ... "N/A" }  // FreshnessChip, FactsheetView.tsx:1840
const stamp = `QSF · ${payload.strategyId.slice(0, 8).toUpperCase()} · ${formatDay(payload.computedAt)}`;   // :3439, prints Jan 1, 1970
const computed = formatDay(payload.computedAt);                            // MandatePanels.tsx:93, same defect
```
RESEARCH's recommended route: export ONE constant plus one `isNeverComputedStamp(value)` helper (do not hand-type the sentinel a third time), use it at `MandatePanels.tsx:93` (Terms `Factsheet computed` -> `—`), `FactsheetView.tsx:3439` (footer `QSF · {ID8} · —`) and in `FreshnessChip` (replacing the local constant). No payload-shape change and no `factsheet-v2-payload-v27` bump. `FreshnessChip`'s `N/A` / `Computed · not yet` copy stays (Phase 237's seam, UI-SPEC FLAG 2).

## `src/lib/types.ts` and `src/lib/database.types.ts` (model)

`StrategyAnalytics.computed_at` (`src/lib/types.ts:307`) becomes `string | null`. `database.types.ts` is generated from the live schema, and PROD auto-applies on merge, so regenerate against the local-stack lane after the replay (`supabase gen types typescript --local`) and keep only the three `strategy_analytics` hunks (`Row` `:2802`, `Insert` `:2840`, `Update` `:2878`), or hand-patch those three lines to exactly the generator's output and say so in the SUMMARY. `npx tsc --noEmit` is the property-reader half of the census (no `node_modules` in the worktree at research time: `npm ci` first).

## NULL pins in existing tests (PR-2)

`src/components/strategy/SyncBadge.trade-fetch.test.tsx` (extend: `computedAt={null}` gives no `Analytics last computed` in any `title` branch; the arm already exists at `SyncBadge.tsx:254-258`), `AdminTabs.test.tsx` (`Computed —`), wizard preview tests (dateless caption), `StrategyGrid.test.tsx` (`HealthScore` 0), `StrategyTable.stale-analytics.test.tsx` (`?? ""` sort position). Pin, do not change, behaviour. Sibling SyncBadge tests: `SyncBadge.staler-of-two.test.tsx`, `SyncBadge.venue.test.tsx`.

---

## Shared Patterns

### Reuse the remedy, author no action words (PR-1, all files)
**Source:** `src/lib/degrade-warnings.ts` (`ACTION_SENTENCES` `:98-272`, `ownerRemedyAction` `:292-294`, `viewerRemedyAction` `:304-315`)
**Apply to:** the strategies page note and the owner pending-page note. Every action a new note names is an existing `ACTION_SENTENCES` entry.
```typescript
export function viewerRemedyAction(input: {
  remedy: { id: string };
  managerSurface: boolean;          // manager or `both`
  shape: StrategyShape | "unknown";
}): AnalyticsFailedAction {
  const owner = ownerRemedyAction(input.remedy);
  if (input.managerSurface || !input.remedy.id.startsWith("KCS21-")) return owner;
  return input.shape === "single" || input.shape === "composite" ? "A-EXCHANGES-KEY" : "A-CONTACT-CHECK";
}
```
Reachable action ids for failed/stalled/never_started: `A-RESYNC-EDIT`, `A-LINK-KEY-EDIT`, `A-COMPOSITE-CONTACT`, `A-CSV-FIXED`, `A-CONTACT-RESOLVE`, `A-CONTACT-CHECK`, `A-EXCHANGES-KEY`, `A-RELOAD` (`A-OWNER-RELOAD` is reachable only for queued/running states, never here).

### A registry marker, no new file under walked directories (PR-1)
**Source:** `src/lib/degrade-warnings.ts:1080-1090`: `strategies.share-note` is marker-only (`class: "share_status"`, `scope: "none"`, `action: null`). **Apply to:** the strategies page `<p>`. Never drop `data-degrade-id`. A new file under `src/app/(dashboard)/strategies/` or `src/components/degrade/` that names `strategies.share-note` or `data-degrade-id` is walked by `degrade-warning-scan.test.ts` and fails if unledgered.

### Typed-out literals in tests, never imported (PR-1)
**Source:** `page.key-pill.test.tsx:773-783`, `status-surface-copy.test.ts:270-296`. Assert whole sentences character for character; the production constant is the thing under test.

### PROOF-01 neuter-and-restore (PR-1 and PR-2, every new gate)
**Source:** CLAUDE.md "Testing"; RESEARCH "PROOF-01 neuter points" tables. Back up with `cp`, neuter, see RED naming the arm, `cp` back, `cmp`, see GREEN, paste verbatim in the SUMMARY. Never `git checkout`/`restore`/`stash` on uncommitted work.

### Migration safety (PR-2)
**Source:** `supabase/migrations/20261013120000_...sql` (header, `SET LOCAL lock_timeout = '3s'`, no explicit transaction, catalogue-only verify) and `scripts/lint-migration-data-dependence.mjs` (refuses data-reading guards except `PERFORM 1 FROM ...; IF FOUND THEN RAISE`). The marker query (CLAUDE.md "Which database am I on?") runs first before any PROD write or probe; probes print counts only, never ids or emails (public repo, `.planning/` tracked).

### Ship hygiene (both PRs)
CLAUDE.md: CHANGELOG entry written before the push in the same `chore(release)` commit as the `VERSION` bump (`VERSION` and `package.json` byte-equal 4-digit strings, never `npm version`); the entry names the deleted TODOS id; the ship branch changes nothing under `.planning/`; no skip-ci token in any commit message or PR body, not even to deny it.

---

## No Analog Found

| File / Mechanism | Role | Data Flow | Reason |
|------------------|------|-----------|--------|
| `ALTER TABLE ... DISABLE TRIGGER` / `ENABLE TRIGGER` around a backfill | migration statement | batch | No precedent in `supabase/migrations/`; one migration (`20260719120000_retention_orphaned_running_compute_jobs.sql`) states it deliberately avoids it. Use RESEARCH's tested shape; tell migration-reviewer plainly. |

## Metadata

**Analog search scope:** `src/lib/`, `src/components/degrade/`, `src/app/(dashboard)/strategies/`, `src/app/factsheet/[id]/v2/`, `src/__tests__/`, `supabase/migrations/` and `down/`, `vitest.node-env.ts`.
**Files scanned:** about 30 read (targeted ranges), plus greps over `src/` and `supabase/`.
**Pattern extraction date:** 2026-11-24
**HEAD drift note:** RESEARCH cites `4b89c54cb`; this worktree is at `fd0e39977`. Anchors re-measured here: `armOf` `:754`, `uncomputedNote` `:792`, `shareNotes` `:814`, `failedFactsOf` `:1051`, `failedFacts` `:1107`, `shapeOf` `:1119`, `healthDetailFor` `:1132`, `noteFor` `:1251`, share `<p>` `:1291-1303` (all `strategies/page.tsx`); `MINT_TOKEN_NOTES` `:452`, `recipientShareNote` `:478`, `recipientShareNoteFor` `:647` (`status-surface-copy.ts`). Re-grep before editing, as RESEARCH says.

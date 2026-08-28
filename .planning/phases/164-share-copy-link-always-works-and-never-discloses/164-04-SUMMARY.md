---
phase: 164-share-copy-link-always-works-and-never-discloses
plan: 04
subsystem: frontend
status: complete
tags: [share, honesty, owner-lane, affordance, clipboard]

requires:
  - "164-01: OwnerLaneProps / recipientShare, fetchAndBuildPayload seam (D-06)"
  - "164-02: strategy_shares table — revoked_at state machine"
  - "164-03: POST /api/strategies/{id}/share and .../share/revoke (contract only; tests mock fetch)"
provides:
  - "shareAffordanceMode / isPublishedStatus / mintShareUrl — the ONE share predicate"
  - "Status-aware ShareLinkButton on the factsheet (published ?share=1 | unpublished token mint)"
  - "ShareRevokeControl on the factsheet with inline confirm (D-03)"
  - "OwnerUnpublishedNotice with two mutually-exclusive TRUE variants"
  - "ownerShare owner-lane render prop (never a payload field)"
affects:
  - "src/app/(dashboard)/strategies — unpublished rows gain a working share control"
  - "src/app/factsheet-share/gone — dead-link copy no longer asserts an unknowable cause"

tech-stack:
  added: []
  patterns:
    - "Presence-as-predicate: `ownerShare !== undefined` IS 'unpublished and owned', reusing the free lane gate `renameTarget` already rides"
    - "Sync-published / async-mint split: the published clipboard path must not cross an await (Safari transient user activation)"
    - "Honest-failure parity: a mint failure is exactly as visible as a clipboard failure (audit-#43 discipline extended)"

key-files:
  created:
    - "src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx"
    - "src/app/(dashboard)/strategies/page.share-affordance.test.tsx"
  modified:
    - "src/app/factsheet/[id]/v2/page.tsx"
    - "src/app/factsheet/[id]/v2/FactsheetView.tsx"
    - "src/components/strategy/ShareableLink.tsx"
    - "src/components/strategy/ShareableLink.test.tsx"
    - "src/app/(dashboard)/strategies/page.tsx"
    - "src/app/(dashboard)/strategies/page.wizard-draft-banner.test.tsx"
    - "src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx"
    - "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx"
    - "src/app/factsheet/[id]/v2/FactsheetView.recipient-share.test.tsx"
    - "src/app/factsheet-share/gone/route.ts"
    - "src/app/factsheet-share/gone/route.test.ts"

key-decisions:
  - "The owner lane selects `revoked_at` ONLY — `generation` and `nonce` are MAC inputs to deriveShareToken and never touch a render path. Pinned by a dedicated assertion (arm 10, page.owner-lane.test.tsx)."
  - "No `resolveShareUrl(published, …)` wrapper: an async resolver puts an await between the click and clipboard.writeText, and Safari has historically dropped transient user activation across that boundary. Consumers branch on the predicate and share `mintShareUrl`."
  - "`OwnerUnpublishedNotice` branches its HEADING as well as its body — 'only you can see this' is a disclosure claim, and a live share link falsifies it exactly as it falsifies the 404 sentence."
  - "The share row's live-state is flipped on MINT success, before the clipboard write (SavedScenariosList audit-#43 precedent): the row exists whether or not the copy lands, so the notice stays honest even when the button reports failure."
  - "`/factsheet-share/gone` copy amended: it serves four miss classes and asserted a cause true in only one of them."

requirements-completed: [SHARE-01, SHARE-04]

coverage:
  - deliverable: "Published Copy Link yields /factsheet/<id>?share=1, byte-identical (D-09)"
    human_judgment: false
    verification:
      - kind: source-byte-equality
        ref: "shasum of the url-producing line, HEAD vs tree: e7ced002aff1ea9d8dbd5fb322dfe81cf032384e (identical)"
        status: pass
      - kind: test
        ref: "src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx#copies <origin><pathname>?share=1 and NEVER calls the mint route"
        status: pass
  - deliverable: "Unpublished Copy Link mints-or-reuses and copies the token url; failure never flashes success (SHARE-04)"
    human_judgment: false
    verification:
      - kind: test
        ref: "src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx#T-164-15 — NO success flash for a link that cannot work (4 arms)"
        status: pass
      - kind: mutation
        ref: "setPhase('failed') -> setPhase('copied') turned 4/18 arms RED; restored by byte backup (shasum eccfbd51)"
        status: pass
  - deliverable: "Revoke on the factsheet with inline confirm; 404 converges (D-03 / SHARE-03)"
    human_judgment: false
    verification:
      - kind: test
        ref: "src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx#D-03 / SHARE-03 — revoke lives on the factsheet, with an INLINE confirm (6 arms)"
        status: pass
      - kind: command
        ref: "git diff 0b32e00d4~1..HEAD -- src/components/strategy/StrategyActions.tsx (empty)"
        status: pass
  - deliverable: "ONE predicate at all three affordance sites (SHARE-04)"
    human_judgment: false
    verification:
      - kind: test
        ref: "src/app/(dashboard)/strategies/page.share-affordance.test.tsx#one predicate, three sites — the drift pin (4 arms incl. the single-declaration anti-vacuity arm)"
        status: pass
  - deliverable: "OwnerUnpublishedNotice never asserts a false 404 claim (SHARE-04)"
    human_judgment: false
    verification:
      - kind: test
        ref: "src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx#SHARE-04 — the owner notice states only TRUE sentences (2 arms)"
        status: pass
  - deliverable: "Recipient mode suppresses every owner share control (T-164-16)"
    human_judgment: false
    verification:
      - kind: test
        ref: "src/app/factsheet/[id]/v2/FactsheetView.recipient-share.test.tsx#suppresses BOTH Copy-Link branches and the REVOKE control even when owner share state is present"
        status: pass
      - kind: mutation
        ref: "dropping !recipientShare from the revoke guard turned that arm RED; restored by byte backup (shasum eccfbd51)"
        status: pass
  - deliverable: "Owner lane share state never reaches the cached payload (T-164-01)"
    human_judgment: false
    verification:
      - kind: test
        ref: "src/__tests__/phase-148-owner-lane-cache-isolation.test.ts (18 arms) + factsheet-share/[token]/page.cache-isolation.test.tsx + page.no-cache-reach.test.ts — 31 passed"
        status: pass
  - deliverable: "End-to-end owner UAT: mint, verify in a private window, revoke, confirm the 410"
    human_judgment: true
    rationale: "Requires a real browser, a real SHARE_TOKEN_SECRET and plan 164-03's routes deployed; no unit test can assert that a copied URL opens for a different session."

metrics:
  duration: "32 min"
  completed: "2026-08-28"
  tasks: 3
  files: 13
  commits: 3

actuals:
  tokens: 71000
  tasks: 3
  commits: 3
---

# Phase 164 Plan 04: Share affordance honesty Summary

Status-aware Copy Link on the factsheet (published keeps `?share=1` byte-for-byte, unpublished mints a revocable token link), a factsheet-resident revoke with an inline confirm, an owner notice whose two variants are each true in exactly the state that renders them, and one exported predicate that all three affordance sites now call.

## What the defect actually was

`ShareLinkButton` took only `strategyId`. It did not know publication status, and it built `<origin><pathname>?share=1` unconditionally. An owner viewing their own unpublished strategy therefore copied a URL that 404s for whoever they sent it to — and the button said "Link copied", so nothing about the interaction suggested a problem. The same class had a second, quieter half on `/strategies`, where the share control was rendered **only** for published rows: an owner with a private strategy had no affordance at all, so the product's answer to "show this to my LP" was silence. Closing one without the other leaves the class alive, which is why both are in this plan.

## Accomplishments

- **The ONE predicate.** `shareAffordanceMode(published)`, `isPublishedStatus(status)` and `mintShareUrl(strategyId)` are exported from `src/components/strategy/ShareableLink.tsx`. All three affordance sites call them: the factsheet's ControlBar pill imports the decision and the mint, `/strategies` and discovery detail mount the component itself. A drift pin asserts the imports **and** that no consumer re-declares the predicate — the anti-vacuity arm, without which three "consumer names the identifier" checks could all pass while two incompatible predicates shipped.
- **D-09 honored to the byte.** The published arm's URL expression is unchanged, proven by shasum rather than by eye (below). A test additionally pins that the published lane never calls the mint route at all — that is the assertion a "let's unify the lanes onto the token" refactor trips.
- **Owner lane threading.** `page.tsx` reads the share row on the request-scoped client after the owner probe and threads `ownerShare` as a **render prop**, never a payload field (T-164-01). It selects `revoked_at` and nothing else.
- **Revoke on the factsheet (D-03).** Inline confirm lifted from `SavedScenariosList`; never `window.confirm`. 200 and 404 both converge to revoked. `StrategyActions` diff is empty.
- **Two true sentences.** `OwnerUnpublishedNotice` branches heading and body. With a live link the "anyone else sees a 404" claim does not render at all — the absence is the load-bearing half, since rendering both would be the platform contradicting itself on one screen.
- **`/strategies` un-gated.** Every row gets the control; each is told the truth about its own status; an unrecognised status fails **closed** to the private lane.

## Why `revoked_at` only

`generation` and `nonce` are the two inputs `deriveShareToken` MACs. The owner UI needs to know **that** a link is live, never **which** link it is — the URL comes back from the idempotent mint route, called by the client. Selecting the counter "while we're here" would put key material on a server-rendered page's data path and nothing else in the suite would notice, so arm 10 of `page.owner-lane.test.tsx` exists as the sole control for that edit. The derivation `row exists AND revoked_at === null` matches the table's own documented state machine verbatim (migration `20260827120000`, `COMMENT ON TABLE`); there is no expiry column, so no third live-ness condition is being ignored.

The token module is deliberately **not** imported into `page.tsx`: deriving the url server-side would put its module-load secret assertion on the whole id route's import graph — the disclosure path this phase spent its budget closing.

## D-09 byte-identical proof

```
git show "HEAD:…/FactsheetView.tsx" | sed -n '1554p' | shasum
  e7ced002aff1ea9d8dbd5fb322dfe81cf032384e  -
sed -n '1720p' "…/FactsheetView.tsx" | shasum
  e7ced002aff1ea9d8dbd5fb322dfe81cf032384e  -

both:  const url = `${window.location.origin}${window.location.pathname}?share=1`;
```

The line moved (comments were added above it); its bytes did not. Its handler — fire-and-forget promise, 1500ms flash, log-only rejection arm (FINDING-9) — is unchanged, and `shareButtonLabel` returns a single literal on that mode so the rendering is reproduced exactly.

## Rule-9 non-vacuity — two mutation experiments

1. **Mint-failure honesty arm.** `setPhase("failed")` → `setPhase("copied")` in `mintAndCopy`'s catch. **4 of 18** arms in `FactsheetView.share-affordance.test.tsx` went RED — mint 500, url-less 200, clipboard denied, clipboard absent — each with `Expected: "Couldn't copy the link — try again" / Received: "Link copied"`. Restored from a byte backup verified by `shasum` (`eccfbd5112e61caa097b961a65f4125a436bef8b` before and after); never `git checkout --`.
2. **Recipient revoke guard.** Dropping `!recipientShare` from the revoke render guard turned the new composition arm RED (`expected 'Shared privately…' not to contain 'Revoke link'`), 1 failed / 10 passed. Same byte-backup restore, same shasum.

## Deviations from Plan

**1. [Rule 3 – Blocker] The shared helper was created in Task 1, not Task 2**
- **Found during:** Task 1
- **Issue:** Task 1's `<files>` list named only `page.tsx` and `FactsheetView.tsx`, but Task 1 requires ShareLinkButton to branch on the same predicate Task 2 extracts. Writing the branch twice would have churned FactsheetView across two commits.
- **Fix:** `shareAffordanceMode` / `isPublishedStatus` / `mintShareUrl` were added to `ShareableLink.tsx` in Task 1 (exports only — the component itself was untouched until Task 2). The plan's own frontmatter already lists the file.
- **Commit:** 0b32e00d4

**2. [Rule 1 – Bug] `resolveShareUrl` was written, then deliberately removed**
- **Found during:** Task 2
- **Issue:** The plan asked for one helper carrying the whole decision. Implemented as `resolveShareUrl(published, {strategyId, publicUrl})`, it forces an `await` onto the **published** path, inserting a microtask between the click and `navigator.clipboard.writeText`. Safari has historically dropped transient user activation across exactly that boundary — the tidier abstraction would have traded a working copy button for a symmetrical call site.
- **Fix:** Removed; both consumers branch on `shareAffordanceMode` themselves (two lines each) and share `mintShareUrl` for the half that genuinely is async. The reasoning is recorded as a ⛔ block in `ShareableLink.tsx` so nobody re-adds it.
- **Commit:** 2ae51d33c

**3. [Rule 1 – Bug] `page.wizard-draft-banner.test.tsx` mocked away the predicate**
- **Found during:** Task 2
- **Issue:** Its `vi.mock("@/components/strategy/ShareableLink", () => ({ ShareableLink: () => null }))` replaced the whole module, so `isPublishedStatus` was `undefined` and the row render threw (2 arms RED).
- **Fix:** Converted to `importActual` spread — the real predicate, a stubbed component. Stubbing the predicate would have let the file stay green while the page asked the wrong question.
- **Commit:** 2ae51d33c

**4. [Rule 2 – Missing critical] `page.owner-lane.test.tsx` select-count pin widened, and a new arm added**
- **Found during:** Task 1
- **Issue:** Arm 9 pinned `requestSelects` to exactly 2; the share-state read makes it 3.
- **Fix:** Widened to 3 (kept **exact**, not loosened to `>= 2` — an unbounded number of request-client reads on a page an owner loads is itself worth noticing), and added arm 10 pinning the share select to `revoked_at` with explicit `not.toContain("generation")` / `not.toContain("nonce")`.
- **Commit:** 0b32e00d4

**5. [Rule 1 – Bug, cross-plan] `/factsheet-share/gone` asserted a cause it cannot know**
- **Found during:** Task 3 (the class-honesty sweep explicitly scopes plan 164-01's gone-page copy)
- **Issue:** That handler's own SECURITY BOUNDARY docblock states it is the single destination for **four** miss classes — unknown token, malformed token, revoked token, and a share read that errored. Its body said *"The person who shared it turned it off."*, false in three of them. Same defect class as a Copy Link that says "Link copied" for a link that 404s, sitting in the one page whose entire job is to be trustworthy to a stranger.
- **Fix:** `"It may have been turned off by the person who shared it, or it may never have been valid. Ask them for a new link."` — true across every miss class, and it still refuses to distinguish them, so the response stays free of an existence oracle. The hand-typed pin in `route.test.ts` was updated with the reasoning.
- **Commit:** 255f74e36
- **Note:** `164-CONTEXT.md:177` and `164-RESEARCH.md:401` still quote the old sentence as the intended substance. Those are historical planning artifacts and were left unedited.

**Total deviations:** 5 auto-fixed (2× Rule 1 bug, 1× Rule 1 cross-plan, 1× Rule 2, 1× Rule 3). **Impact:** none negative. Deviation 2 avoided a probable Safari clipboard regression; deviation 5 closed a live user-facing false claim the plan asked me to look for.

## Sentence audit (Task 3, step 1)

Every string this phase can render, checked against "true in every reachable state":

| Sentence | Reachable when | Verdict |
|---|---|---|
| "Unpublished — only you can see this" + 404 clause | `hasActiveShare === false` | true — guarded |
| "…You can create a private share link to let someone view it without publishing." | `hasActiveShare === false` | true — and now true on the payload-pending fallback too, because Task 2 made `/strategies` render the control for every status |
| "Unpublished — shared through your private link" + live-link clause | `hasActiveShare === true` | true |
| "Create share link" / "Copy share link" / "Copying…" / "Creating link…" | mint lane | true |
| "Link copied" | after an **awaited** clipboard write of a route-returned url | true — set on exactly one path |
| "Couldn't copy the link — try again" | any of 4 mint/clipboard failures | true, deliberately generic: naming the wrong cause would be a guess presented as a fact |
| "Revoke this share link? Anyone with the link will lose access." | confirm open | true |
| "Couldn't revoke this link. Try again." | non-ok, non-404 | true — the link really does stay live |
| "Share Factsheet" (published) / "Get private link" (unpublished) | `ShareableLink` idle | true — "Get" covers mint **and** reuse |
| "Copy failed — copy the URL manually" | both clipboard paths failed, url exists | true |
| "Couldn't create the link — try again" | mint failed, no url exists | true — distinct state because "copy it manually" is useless advice with no url |
| `/factsheet-share/gone` body | all four miss classes | **was false**, fixed (deviation 5) |

One accepted imprecision, recorded rather than hidden: if the owner-lane share read **errors**, `hasActiveShare` degrades to `false` (logged, Sentry-captured) and the button reads "Create share link" while the click will in fact *reuse* an existing link. The user-visible outcome is identical — the same working url — so the label is imprecise, never false about what the user gets.

## Anchors: which resolved, which did not

| Plan anchor | Result |
|---|---|
| `v2/page.tsx` `lane === "owner"` guard ~:329 | **stale** — the `OwnerUnpublishedNotice` render site was at :318. Found by symbol. |
| `v2/page.tsx` `<FactsheetView` call ~:411 | **stale** — at :400. Found by symbol. |
| `FactsheetView.tsx` ShareLinkButton :1483-1515 | **stale** — at :1548-1578 (the url line at :1554). Found by symbol. |
| `FactsheetView.tsx` `OwnerUnpublishedNotice` :693-709 | **stale** — at :722-738. Found by symbol. |
| page's pending-fallback notice render :605 | **stale** — at :265 in the 423-line file. Found by symbol. |
| `SavedScenariosList` inline confirm :599-619 | **resolved** — the confirm block is at :597-619. |
| `SavedScenariosList` 404-convergence comment :333-341 | **resolved** — at :332-341. |

Every `:NNN` in the plan except the two `SavedScenariosList` citations was wrong. None was off by enough to land in unrelated code, but every one was found by grepping the named symbol, as instructed.

## What the plan specified wrongly

- **Task 1 step 4** says `OwnerUnpublishedNotice` is "rendered from FactsheetView and from the page's pending fallback at :605 — one component, one edit". Correct in substance; the line number was dead (see table).
- **Task 2 step 1** asks for the whole decision in "one small exported helper". Implemented and then removed — see deviation 2. The predicate is shared; the *resolver* could not be without risking the published clipboard path.
- **Task 2 step 3** says discovery detail should be passed "the now-required status prop". `getStrategyDetail`'s projection deliberately omits `status` (its own comment says reads of `.status` yield `undefined`), so `strategy.status` would have failed **closed** into the mint lane — a token link for a strategy that already has a public URL. Passed a literal `published` instead, justified in a comment by the `withPublishedOnly` gate that makes the claim true.
- **Task 1 step 2** requires the published branch's "success/failure states unchanged". Honored — which means the published lane keeps its silent clipboard-denial arm (label unchanged, `console.warn` only). That is weaker than SHARE-04's standard for the mint lane, but changing it is explicitly out of scope under D-09. Flagged for a future phase rather than changed here.

## Test suite state

| Suite | Result |
|---|---|
| `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` | 18 passed |
| `src/app/factsheet-share/[token]/page.cache-isolation.test.tsx` | passed |
| `src/app/factsheet-share/[token]/page.no-cache-reach.test.ts` | passed |
| *(the three cache suites together)* | **3 files / 31 tests passed**, identical to the pre-edit baseline |
| `src/app/factsheet/[id]/v2` | 39 files / 354 passed |
| `src/components/strategy` + `(dashboard)/strategies` + `(dashboard)/discovery` + `critical-regressions` | 80 files / 1333 passed |
| `src/__tests__/contracts` (scans all of `src/`) | 5 files / 109 passed |
| Combined final sweep (v2 + phase-148 + factsheet-share + strategy + strategies) | **122 files / 1597 passed** |
| `npx tsc --noEmit` | 0 errors |
| `npx eslint` on all 13 changed files | clean |

## Known Stubs

None. No placeholder values, no `TODO`/`FIXME`, no skipped tests, no unrun `<verify>` commands.

## Threat Flags

None. The plan's `<threat_model>` covers the three surfaces this plan touches (T-164-01 owner-lane props, T-164-15 false success, T-164-16 recipient re-share) and each has a mitigation with a test. No new network endpoint, auth path, file access pattern or schema change was introduced — the two routes this UI calls are plan 164-03's, and this plan added no server code.

## Human-check handoff (end-of-phase UAT)

Owner side, on a strategy the session owns:

1. **UNPUBLISHED** — Copy Link produces a link that opens in a private window; the notice reads "Unpublished — shared through your private link" and does **not** claim a 404; Revoke shows the inline confirm (no browser dialog); after revoking, the previously copied link lands on the 410 dead-link page.
2. **PUBLISHED** — Copy Link still copies the plain factsheet url with `?share=1`, exactly as before this phase.
3. **`/strategies`** — an unpublished row now shows "Get private link" and it works.

Blocked on plan 164-03's routes being deployed and `SHARE_TOKEN_SECRET` being set; every unit-level claim above is already proven by test.

## Self-Check: PASSED

- `src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx` — FOUND
- `src/app/(dashboard)/strategies/page.share-affordance.test.tsx` — FOUND
- commit `0b32e00d4` — FOUND
- commit `2ae51d33c` — FOUND
- commit `255f74e36` — FOUND
- `git diff` on `src/components/strategy/StrategyActions.tsx` across all three commits — EMPTY (D-03)

---
phase: 162-honest-what-the-user-sees-is-true
plan: 06
subsystem: wizard-connect-key
status: complete
tags: [wizard, preselect, orphaned-key, D-162-3, HONEST-06, ui-spec-c5, copy-honesty]
requires:
  - "162-05 (POST /api/strategies/create-with-key `reuse_api_key_id` + the draft-arm envelope)"
  - "162-03 (StrategyTable, modified in wave 1 — this plan works from the assembled phase branch)"
provides:
  - "StrategyTable `onFinishSetup?: (keyId: string) => void`"
  - "`PreselectedKey` type (ConnectKeyStep) — id + venue id + server-formatted label + nickname"
  - "ContributionWizardOverlay `preselectKey` prop + the dismissal/remount seam"
  - "ConnectKeyStep saved-key summary sub-state (162-UI-SPEC § C-5) + the reuse POST"
  - "src/app/(dashboard)/allocations/components/ContributionWizardOverlay.preselect.test.tsx"
affects:
  - "KEY_ORPHANED copy — fix[] moved in the same commit that made the old line false"
tech-stack:
  added: []
  patterns:
    - "preselect travels as a resolved triple + venue id; the client never re-derives an exchange display name"
    - "dismissal state owned by the component that owns the remount key, not by the component that renders the button"
    - "one server call serves both live populations — the reuse arm's own idempotency fence answers 'does a draft exist?'"
key-files:
  created:
    - "src/app/(dashboard)/allocations/components/ContributionWizardOverlay.preselect.test.tsx"
  modified:
    - "src/components/strategy/StrategyTable.tsx"
    - "src/app/(dashboard)/my-strategies/page.tsx"
    - "src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx"
    - "src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx"
    - "src/components/strategy/StrategyTable.pending-chip.test.tsx"
    - "src/lib/wizardErrors.ts"
    - "src/lib/wizardErrors.test.ts"
decisions:
  - "Continue with this key ALWAYS posts the reuse arm — no client-side 'does a draft exist?' branch. The server holds the advisory lock while it answers, so populations (a) and (b) reduce to one call"
  - "`deduped` is deliberately NOT forwarded from the reuse arm: its strip reads 'These credentials are already connected', and this arm receives none"
  - "The dismissal (`Use a different key`) lives in the OVERLAY, because the overlay owns the remount key; a local flag would leave every preselect-seeded initializer holding the rejected key"
  - "The overlay refuses to offer a draft belonging to a DIFFERENT key than the preselect — the wrong-key confusion in the threat register (T-162-06-B)"
  - "KEY_ORPHANED's new bullet names /my-strategies CONDITIONALLY: it is allocator-guarded and this refusal also renders in the manager wizard, so a flat assertion would re-open the D-17 class for the manager population"
  - "`exchange` (venue id) widened on the OWNER'S row type in MyStrategiesSection, not on the shared PlaceholderKeyRow — the public discovery contract stays byte-identical"
metrics:
  duration: "~2h"
  completed: 2026-08-25
  tasks: 3
  commits: 3
actuals:
  tokens: 17000
  tasks: 3
  commits: 3
---

# Phase 162 Plan 06: Preselect the Clicked Key Summary

"Finish setup →" now opens the wizard ON the key that was clicked — a saved-key
summary naming that key in the same server-formatted words the row showed, a
primary CTA that REUSES the stored `api_keys` row instead of asking for
credentials we already hold, and a text CTA that drops the choice through a real
remount. The `KEY_ORPHANED` sentence that told owners this remedy did not exist
moved in the same commit that made it false.

## What shipped

**The id thread** (commit `9c725aa97`). `StrategyTable`'s callback widened to
`onFinishSetup?: (keyId: string) => void` and is invoked with the id off the row
being rendered; the bare `onClick={onFinishSetup}` it replaces handed a click
event to a zero-arg callback, so every row said the same thing. `MyStrategiesSection`
resolves that id against the same array that rendered the row (a miss opens the
wizard with NO preselect — the fresh form is the honest fallback, never a guessed
key) and hands the overlay a resolved `PreselectedKey`. The overlay folds the id
into the `WizardClient` remount key and refuses to offer a draft belonging to a
different key. The superseded 2026-08-05 founder-ruling comments in
`StrategyTable` and `MyStrategiesSection` are replaced with the D-162-3 citation.

**The C-5 summary + the reuse path** (commit `211ba92c5`). `ConnectKeyStep`
renders, INSTEAD of the credential form: a square/flat/hairline data panel
(DESIGN.md § Cards-vs-Data-panels) carrying the eyebrow `SAVED KEY`
(`text-micro font-mono uppercase tracking-[0.18em] text-text-muted` — the
factsheet annotation voice, colorless), the identity line
`{exchangeLabel} — {keyLabel}` (`text-small`, `truncate`, `title=` carrying the
real value), the accent primary CTA `Continue with this key` (the one new accent
element the UI-SPEC reserves) and the text CTA `Use a different key`
(`text-small text-accent underline underline-offset-2`, matching the link the
owner just clicked). Focus lands on the primary CTA at mount (DESIGN-05).
No masked fields, no dots — the web tier has no decryption path, so any dots
would be a picture of a value nobody read. The trust atoms do not render either:
nothing is pasted, stored or scope-checked on this path.

`Continue with this key` POSTs `{ wizard_session_id, reuse_api_key_id }` and
resumes on the returned draft envelope. `WizardClient` consults the preselect
BEFORE the draft in its step initializer (a draft normally resumes onto
`sync_preview`, which would skip the one screen that says which key this is
about) and seeds `apiKeyId` from it.

**The spec** (commit `b841a9b1e`). `ContributionWizardOverlay.preselect.test.tsx`
renders the REAL wizard — only `SyncPreviewStep` is stubbed — because a mock can
only report which prop it was handed. `StrategyTable.pending-chip.test.tsx` gains
T-1 and O-7.

## The KEY_ORPHANED line moved in the same commit that made it false

CONFIRMED. `src/lib/wizardErrors.ts` and its fenced tests are in commit
`211ba92c5` — the commit that ships `handleContinueWithKey`, i.e. the first
commit at which an owner can reuse a stored key. Commit `9c725aa97` before it
threads the id but reuses nothing, so the old sentence was still true there.

The retired bullet: *"To reuse this exact account, email security@quantalyze.com
with the correlation id below: releasing the stored key is not something you can
do from this page."* Two claims — that emailing is how you reuse it, and that
releasing it is out of reach. The first became false; the second did not.

The replacement keeps the true half and names the now-real remedy CONDITIONALLY:

1. (unchanged) connect a different account;
2. "If your account includes the My Strategies page, look for this account there
   under “No strategy yet”: “Finish setup” on that row builds the strategy from
   the key already stored, with no credentials to enter again."
3. "If that page is not part of your account, or it does not list this key, email
   security@quantalyze.com with the correlation id below: releasing the stored
   key is not something you can do from this page."

**Why conditional, measured rather than preferred.** `/my-strategies` guards on
`requireRolePage(…, "allocator")`, and this refusal also renders in the
manager-guarded wizard route — a flat assertion would name an unreachable surface
for the `role: "manager"` population, which is exactly the D-17 class the entry's
own 161-05 docblock exists to keep closed. The row is also not guaranteed to be
listed: `getStrategylessActiveKeys` filters on `is_active` and
`sync_status !== "revoked"`, while the venue fence that emits `KEY_ORPHANED`
filters only on `disconnected_at`. Both gaps land in bullet 3.

The entry's docblock was corrected in the same edit: its measured bullet
("`my-strategies` … its only control is Finish setup →, which reopens this same
wizard and lands on this same refusal") is now false and says so, and the
"underlying gap" paragraph now separates REUSE (closed here) from RELEASE (still
shipped nowhere, for any role).

## RED-witness evidence (verbatim)

Every neuter was applied by script, run, then restored from a byte copy verified
with `shasum -a 256`. ⛔ `git checkout --` was never used.

### W1 — neuter the id thread (the host answers every click with the FIRST key)

`const clicked = placeholderKeys.find((k) => k.id === keyId);` → `placeholderKeys[0]`

```
     × clicking key A's row shows A; clicking key B's row shows B 177ms
     × the second row's click is not answered by the first row's key (first-key falsifier) 34ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected 'SAVED KEYBybit — Zavara main' to contain 'Deribit'
AssertionError: The summary answered with the FIRST bare key for a click on the second row. The id must be read off the row being rendered, not off the head of the placeholder array.: expected 'Bybit — Zavara main' to be 'Deribit — Helios options' // Object.is equality
 Test Files  1 failed (1)
      Tests  2 failed | 9 passed (11)
```

### W2 — restore the pre-162 bare handler (`onClick={onFinishSetup}`)

```
     × 162-06: each row fires onFinishSetup with ITS OWN key id (the wrong-key falsifier) 35ms
     × clicking key A's row shows A; clicking key B's row shows B 1135ms
     × the second row's click is not answered by the first row's key (first-key falsifier) 1030ms
AssertionError: Clicking the "Zavara main" row did not report that row's key id. A handler that reports the first key, the last key, or nothing at all passes the count assertion above and still reopens the wizard on the wrong key — or on none.: expected [ [ SyntheticBaseEvent{ …(32) } ] ] to deeply equal [ [ 'k1' ] ]
 Test Files  2 failed (2)
      Tests  3 failed | 28 passed (31)
```

### W3 — the summary sub-state never renders (`if (preselectKey)` → `if (false)`)

```
     × O-1: renders the saved-key summary — the clicked key's exchange and label, as TEXT
     × O-1b: renders NO masked credential field and no fabricated dots
     × O-3: focus lands on 'Continue with this key' when the step mounts preselected
     × O-2: 'Use a different key' reverts to the blank credential form via a real remount
     × O-5 (population b, orphaned key): POSTs reuse_api_key_id with NO credentials and lands on the draft
     × O-4 (population a, key with a live draft): shows the summary first, then resumes THAT draft
     × a draft on a DIFFERENT key is never resumed under a preselect
     × a server refusal renders through the existing envelope, and the summary survives it
     × clicking key A's row shows A; clicking key B's row shows B
     × the second row's click is not answered by the first row's key (first-key falsifier)
 Test Files  1 failed (1)
      Tests  10 failed | 1 passed (11)
```

### W4 — "Continue with this key" re-POSTs CREDENTIALS instead of the key id

(the prefilled-form "fix" that cannot work — it collides on the same index)

```
     × O-5 (population b, orphaned key): POSTs reuse_api_key_id with NO credentials and lands on the draft 38ms
AssertionError: expected undefined to be 'bbbbbbbb-0000-4000-8000-00000000000b' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
```

### W5 — ⚠️ THE NOMINATED NEUTER DID NOT REDDEN THE TEST, AND THE TEST WAS FIXED

Dropping the overlay's wrong-key draft guard
(`(!activePreselect || draft.api_key_id === activePreselect.id)` → `true`) left
the test that exists to guard it **GREEN**:

```
W5 neutered
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

The reason is worth recording: the step initializer starts on `connect_key`
whenever a preselect is present, so the summary renders the clicked key either
way. All three original assertions (right labels shown, no sync-preview, the
other key's nickname absent) were true under the neuter. What the guard actually
stops is the other key's DRAFT being mounted underneath — `initialDraft` wins
over the preselect for `strategyId`, `apiKeyId` and the whole metadata draft, so
key A's name, markets and category would carry into the strategy built from key B.

A first replacement assertion (no "We saved your progress." banner) was ALSO
measured non-failing: that banner lands after an async localStorage read, so the
negative assertion runs before it could appear — a false negative. The assertion
that ships observes the wizard telling on itself: `MultiKeyConnectStep` issues
`GET /api/strategies/composite/members` only when `WizardClient` handed it a
`draftStrategyId`, and the call is recorded at REQUEST time. Re-witnessed:

```
     × a draft on a DIFFERENT key is never resumed under a preselect 14ms
AssertionError: The wizard mounted HOLDING a draft while the summary claims this is about a different key. That draft's name, markets and category would carry into the strategy built here from key B.: expected [ Array(1) ] to deeply equal []
 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
```

### W6 — offer "Finish setup →" on RANKED rows too (population c regression)

```
     × fires onFinishSetup exactly once from a real <button>, not a link into /strategies 116ms
     × 162-06 O-7: a mid-sync row keeps its Syncing chip and offers no Finish setup 18ms
AssertionError: expected [ …(3) ] to have a length of 2 but got 3
AssertionError: expected <button type="button"></button> to be null
 Test Files  1 failed (1)
      Tests  2 failed | 18 passed (20)
```

### W7 — drop the DESIGN-05 focus move

```
     × O-3: focus lands on 'Continue with this key' when the step mounts preselected 1029ms
AssertionError: expected <div tabindex="-1" …(1)>…(2)</div> to be <button …(3)></button> // Object.is equality
```

(The `div tabindex="-1"` is the overlay panel — precisely the "focus never
reaches the one control this screen is asking about" state the rule prevents.)

### W8 — add a masked credential row to the summary (`••••••••`)

```
     × O-1b: renders NO masked credential field and no fabricated dots 28ms
AssertionError: expected <input readonly …(3)></input> to have a length of +0 but got 1
```

### W9 — the copy fence: restore the pre-162-06 KEY_ORPHANED bullet

```
 FAIL  src/lib/wizardErrors.test.ts > [161-05 / WIZERR-03] KEY_ORPHANED offers a remedy that can succeed > names the self-serve reuse route 162-06 made real, and names it conditionally
AssertionError: No bullet names the route an owner can actually take: My Strategies lists a stored key with no strategy as a 'No strategy yet' row, and 162-06 made its 'Finish setup' control REUSE that key instead of reopening this wizard's credential form. A refusal that withholds the one remedy that now works is the D-17 class in a new costume.: expected undefined to be defined

 FAIL  src/lib/wizardErrors.test.ts > … > no longer tells the owner that reusing this exact account means emailing us
AssertionError: KEY_ORPHANED tells the owner that reusing this exact account means emailing us. …: expected [ …(2) ] to deeply equal []
- []
+ [ "to reuse this exact account, email", "reuse this exact account, email" ]

 Test Files  1 failed (1)
      Tests  2 failed | 233 passed (235)
```

### Restores, all verified byte-identical

```
ad16edcd640844b5665bb5deb846cb822dc17fbd757fe374cc8ad61d7b157d76  MyStrategiesSection.tsx
e17363b39bdd36329d72852931c8980bc542657d87615a5f0d5acaaaf85bdf30  StrategyTable.tsx
d8f9d5e3fd0e0e153b2aade5446d96010024e40ee9801bcaa13795e5dbdc7271  ConnectKeyStep.tsx
73e388ad855a5f0341e1650b11a3e27c3d6ee32f8b874ae82b684b5dd8856c0a  ContributionWizardOverlay.tsx
fc82356c85a21c05c43ee56f6bf4409ce49d747a66c6af841f85574cb3f7cd54  wizardErrors.ts
```

⛔ `src/lib/wizardErrors.test.ts` carries a deliberate NUL byte, which makes
`grep` skip the file and exit 1 as though it were clean. Every read of it here
used `awk` or the `Edit` tool, never a bare `grep`.

## Populations — what is actually reachable, measured

| Population | Reachable from a placeholder click? | Covered by |
|---|---|---|
| (a) preselected key WITH a live draft | Yes, but only via a STALE page — a key with a live draft is COVERED by `deriveStrategyLinkedKeyIds`, so it is not a bare key. The reachable path is another tab starting a draft after this page rendered. | O-4 |
| (b) orphaned key (stored, live, nothing on it) | Yes — the ordinary case | O-5 |
| (c) mid-sync key | No, by construction: its strategy covers it, so no placeholder row and no "Finish setup →" exists to click | O-7 (in the file that renders the control) |

This is stated rather than glossed because the plan's O-4 text ("Continue proceeds
via the existing draft-resume plumbing") implies a client-side draft branch. There
is none, and there should not be: the reuse arm answers the draft envelope either
way (its `held.kind === "draft"` arm hands the existing draft back with
`deduped: true`), holding the advisory lock while it decides. One call, both
populations, no client-side race to get wrong.

## Deviations from Plan

### 1. [Rule 3 — blocking] `MultiKeyConnectStep.tsx` edited (not in `files_modified`)

`WizardClient` renders `MultiKeyConnectStep` at `connect_key`, and its State A
delegates to `ConnectKeyStep`. The plan's file list goes straight from
`WizardClient` to `ConnectKeyStep`, which is not a reachable path. Two optional
pass-through props were added (State B ignores them — a preselect is one stored
key, a composite panel list is not, and the two cannot co-occur on the path that
mints a preselect). Commit `211ba92c5`.

### 2. [Rule 2] `PreselectedKey` carries the venue ID as well as the label

The plan's example shape is `{ id, exchangeLabel, keyLabel }`. With only those,
`ConnectKeySuccess.exchange` (required, and the funnel's venue property) and the
error envelope's `venue` capability lookup would have to be either invented from
the display label — the client owning exchange naming, which the page's own
server-side formatting exists to prevent — or reported as a default `"binance"`
for a Bybit key. The venue id rides along from `getStrategylessActiveKeys`, which
already types it as `SupportedExchange`. Widened on the OWNER'S row type
(`OwnerPlaceholderKeyRow` in `MyStrategiesSection`), NOT on the shared
`PlaceholderKeyRow`, so the public discovery contract is untouched.

### 3. [Rule 7 — extract, don't copy] `recogniseCreateWithKeyCode` extracted

The credential arm's translate-then-membership-check expression now has two
callers. A second hand-written copy of a translation whose ORDER is the safety
property is the drift pair 162-05 refused to create server-side for the same
reason. Behaviour is byte-identical for the credential caller; its 49 lines of
recorded reasoning moved with it into the function's docblock, and the
`recogniseSeamErrorCode(seamErrorCode(…))` hop `seam-wire-vocabulary.invariant.test.ts`
requires is still present in the file.

### 4. `MyStrategiesEmptyState.tsx` NOT modified (listed in `files_modified`)

That panel renders only when the account has zero strategies AND zero bare keys,
so it can never carry a preselect, and it holds no comment that this plan makes
false. Nothing was changed there rather than adding a prop that is structurally
always null.

### 5. Task 1 stops at the overlay boundary, by design

The plan's Task-1 `<done>` is "the clicked key's identity reaches the overlay
mount as typed props", so commit `9c725aa97` includes the overlay's `preselectKey`
prop (used for the remount key and the wrong-key draft guard) and the
`PreselectedKey` type declaration in `ConnectKeyStep`. Splitting them differently
would have left a commit that does not compile, or a prop the code claims to use
and does not.

### 6. `deduped` not forwarded from the reuse arm

Recorded as a decision above rather than silently dropped: `WizardClient`'s strip
for it says "These credentials are already connected", and this arm receives no
credentials. It is also not a surprise needing explanation — the user asked for
this key and got this key's draft.

## Out of scope, logged not fixed

- `ContributionWizardOverlay.tsx` carries an **unused `eslint-disable`
  directive** (`react-hooks/set-state-in-effect`, on the close-reset
  `setSource("api")`). Confirmed PRE-EXISTING at the base commit by linting
  `git show HEAD:…` through `eslint --stdin`. Not touched (scope boundary); no
  `.planning/WINDOWS.md` entry was appended because a parallel executor is live
  and that ledger is assembled centrally — flagging it here instead.

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired components were
introduced. The summary renders only values that came from the owner's own page
payload.

## Threat Flags

None beyond the plan's register. No new endpoint, auth path, file access pattern
or trust-boundary schema change: the client threads an id the owner's own authed
page already contained, and the server re-proves ownership on the arm 162-05
shipped (T-162-06-A, disposition `transfer`). T-162-06-B (wrong-key confusion) is
mitigated and pinned by O-6 plus the overlay's wrong-key draft guard.

## Test results

| Gate | Result |
|------|--------|
| `npx vitest run …preselect.test.tsx …pending-chip.test.tsx` | 31 passed |
| `npx vitest run` (full suite — contract tests scan all of `src/`) | 804 files passed, 12548 passed, 281 skipped |
| `npx tsc --noEmit` | clean |
| `npx eslint` on every changed file | clean except the pre-existing warning above |
| `npx vitest run src/lib/wizardErrors*.test.ts` | 284 passed |
| wizard steps + 5 seam invariants (38 files) | 805 passed |

`npx vitest --version` → `vitest/4.1.10` (the repo's own, via the `node_modules`
symlink) — a worktree without it downloads a different vitest and the numbers
above would mean nothing.

## Could NOT be verified (stated, not glossed)

1. **Nothing was exercised against a real database or a real browser.** All
   evidence is jsdom + static gates. The reuse arm's SQL (162-05's migration and
   its 9-arm gate) has still never been executed anywhere — 162-05 records that,
   and this plan does not change it. Live acceptance of the whole loop
   (click → summary → Continue → sync_preview on a real orphaned key) is owed at
   the phase's UAT.
2. **The `role: "manager"` half of the new KEY_ORPHANED bullet is reasoned from
   `requireRolePage`, not observed.** I read the guard and the page; I did not
   sign in as a manager and confirm the redirect.
3. **Population (a) has not been observed in the wild.** It is reachable only
   through a stale page (another tab starting a draft on the same key), and the
   test constructs that state directly.
4. **State B + preselect is untested** because it is unreachable: a composite
   member key is linked, so it is never a bare key. If it ever arrived, the
   panels win and the preselect silently does not render — documented at the prop.

## Not updated (as instructed)

`STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` were left alone — another executor
is live and those are assembled centrally. What I would have ticked:

- `REQUIREMENTS.md`: **HONEST-06** complete (the plan's only requirement).
- `STATE.md`: plan counter → 162-06 done; decisions listed in this file's
  frontmatter; no new blockers.
- `ROADMAP.md`: phase 162 plan progress +1.

## Self-Check: PASSED

- `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.preselect.test.tsx` — FOUND
- commit `9c725aa97` — FOUND
- commit `211ba92c5` — FOUND
- commit `b841a9b1e` — FOUND
- working tree clean, no file deletions in any of the three commits

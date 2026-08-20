# Feature Research: Revocable Share Links for Private Factsheets (v1.20 / SHARE — SHARELINK-01)

**Domain:** Capability-URL ("secret link") sharing of a private, unpublished institutional
document, in a product where the document's own id is deliberately a NON-secret. Comparable
products: Google Docs/Drive link sharing, Notion "Share to web", Figma public links, Dropbox/Box
shared links, and the fund-document niche (DocSend, virtual data rooms).
**Researched:** 2026-08-20
**Confidence:** **HIGH** on everything grounded in this repo (every code claim below was read at
HEAD `ca3f0c5c` and is cited file:line); **MEDIUM** on the comparable-product conventions
(WebSearch-tier, cross-checked across ≥2 products before being called a convention); **MEDIUM** on
the W3C TAG capability-URL rules (fetched from the W3C source, but a 2014 Note, not a REC).

**Scope discipline:** the founder decision of 2026-08-13 (revocable per-strategy token, `?s=<token>`,
Copy Link mints-or-reuses, revoke regenerates, bare `/factsheet/<id>` stays owner-only, id stays a
non-secret) is **INPUT, not a question**. Nothing below re-litigates it. This file answers only
*"given that decision, what does the surrounding feature set have to contain to not be a second
founder-hit defect?"*

---

## Critical Finding — "mint-or-reuse" is NOT free, and the in-repo precedent CANNOT deliver it

The founder's shape says **"Copy Link mints-or-reuses"**. The obvious move is to copy the scenario
share lane (migration `20260622120000`) verbatim. **That copy would not satisfy the requirement**,
and the precedent's own code says so.

`src/lib/scenario-share-token.ts:14` stores **only** `sha256(raw)`; the raw token is externalised
exactly once, in the mint response. Consequence, documented in the precedent's own UI at
`src/app/(dashboard)/allocations/components/SavedScenariosList.tsx:191-197`:

> *"The generate route externalises the raw token EXACTLY ONCE (only its hash is persisted,
> T-25-12), so the URL can never be re-fetched. Caching it for the session lets 'Copy link' hand out
> the SAME link without re-minting … **Empty after a reload** / for a share generated in a prior
> session."*

So in the precedent, "reuse" works **only within one browser session**. After a reload,
`copyExistingShare` (line 299) hits a cache miss and can only offer an explicit **"replace link"**
confirm — i.e. rotate-and-kill. Additionally `create_scenario_share`
(`supabase/schema/functions/create_scenario_share.sql`) **unconditionally revokes the prior active
share** before inserting. A verbatim port therefore gives: *every* Copy Link click after a reload
either rotates the token (killing the link the founder already emailed) or dead-ends into a scary
confirm dialog. That is a **new** version of SHARELINK-01, not a fix for it.

**Three ways out — the phase must pick one deliberately:**

| Option | How reuse works | Cost | Notes |
|---|---|---|---|
| **A. Store the raw token** | `SELECT token FROM strategy_shares WHERE …` on every Copy Link | LOWEST | Breaks the precedent's hash-only discipline: a DB read-leak yields *live* links. Acceptable-ish here (the capability is read of one factsheet, not a book) but it must be a stated, reviewed deviation, not a silent one. |
| **B. HMAC-over-a-stored-generation-counter** | `token = HMAC(SECRET, strategy_id ‖ generation)`; store only `generation` (int) + optionally the digest | MEDIUM | Recomputable forever ⇒ true mint-or-reuse across sessions; **revoke = `generation += 1`**, which is *literally* the founder's "a revoke control regenerates the token". Nothing secret at rest. In-repo precedent exists: `src/lib/demo-pdf-token.ts` (HMAC-SHA256 + `timingSafeEqual`). ⚠ Needs a **new required env var on Vercel** — see the RESEND_API_KEY class of failure; an unset secret makes Copy Link 500 in prod only. |
| **C. Encrypt the token at rest** | decrypt on Copy Link | HIGHEST | Adds a KMS/crypto seam for no gain over B. Not recommended. |

The scenario lib's comment (`scenario-share-token.ts:9-12`) rejects "the keyed-MAC model of
`demo-pdf-token.ts`" because *"the revocation requirement is … impossible with a stateless HMAC
token."* That reasoning is correct **for a stateless MAC** and does not apply to option B, which is
a *stateful* MAC (the counter lives in the DB). This is a genuine distinction, not a loophole — but
the phase plan must say so explicitly, because a reviewer will otherwise read option B as
contradicting a documented decision.

---

## Feature Landscape

### Table Stakes (recipients and owners assume these exist)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Copy Link always produces a link that works for the recipient** | This IS the founder-hit defect. `FactsheetView.tsx:1565` gates the Share button on `!scenarioMode` only, then flashes "Link copied" for a URL that 404s. Every comparable product (Docs, Notion, Figma, Dropbox) treats "the copy button hands out a working URL" as the contract. | **MEDIUM** (mint route + token lane) | The fix is *mint-on-copy*, not *hide-the-button*. See "Honest affordances" below for why hiding (the `strategies/page.tsx:174` pattern) is the wrong half of the class fix. |
| **Immediate, unconditional revoke** | Universal: Docs ("Restricted"), Notion ("Remove"), Dropbox (disable), DocSend markets *"revoke access at any time, even after sharing"* as a headline. In the fund-document niche it is the single most-cited control. | **LOW** (mirror `share/revoke/route.ts`) | Precedent is complete and good: owner-scoped UPDATE setting `revoked_at`, **never a hard DELETE** (audit trail), 0 rows → 404 not 403 (no existence oracle), and 404-on-double-revoke is treated as *convergence to revoked*, not failure (`SavedScenariosList.tsx:333-341`). Copy that semantics verbatim. |
| **The revoked/invalid-token page is DISTINCT from the app 404** | Dropbox deliberately splits *"This link is expired"* (link dead) from the generic 404 (file gone). Google Docs shows a "You need access" interstitial, not a 404. A bare 404 reads as *"the product is broken"* — which is exactly the failure mode the founder hit. | **LOW-MEDIUM** | ⭐ **Explicit spec (quality gate):** on `?s=<unknown-or-revoked>` the recipient must land on a page that says, in substance, *"This link is no longer active. The person who shared it turned it off. Ask them for a new link."* — with **no strategy name, no metrics, no id, no owner identity** on it, and `no-store`. HTTP status **410 Gone** (W3C TAG: *"servers should respond … with either a 410 Gone or a 404 Not Found"*; 410 is the semantically correct one for deliberate revocation). |
| **⛔ The 410 applies to the TOKEN lane ONLY — the bare id lane keeps its uniform 404** | The repo's existing invariant: *"a non-owner authed viewer, an anonymous viewer and a genuinely missing id are indistinguishable from the outside (T-148-04)"* (`page.tsx:487`). | **LOW** (a branch) | Safe asymmetry: telling a holder of an unguessable 256-bit token that it *was* valid leaks nothing (they already had it); telling a holder of a **structurally leaky id** that the id exists is an existence oracle. Keep both behaviours, and pin both with tests. |
| **Owner can see whether a live link exists** | Every comparable product shows share state in the share affordance itself. Without it, "did I already send this?" is unanswerable and the owner rotates by accident. | **LOW** | Precedent: `has_active_share` on the row + a local override (`SavedScenariosList.tsx:45-51, 199-203`). State machine: *none → `Share`; active → `Copy link` + `Revoke`*. Reuse this shape. |
| **Revoke is confirmed before it fires** | Revoke is irreversible-in-effect (recipients lose access). Precedent already does this: inline confirm reading *"Revoke this share link? Anyone with the link will lose…"* (`SavedScenariosList.tsx:598-615`). | **LOW** | Do NOT use a `window.confirm`. Match the inline-confirm precedent. |
| **Unguessable token, HTTPS-only, `noindex`, rate-limited** | W3C TAG capability-URL rules: ≥120 bits entropy or UUIDv4; `https` only; robots exclusion; *"access to the URL space in which capability URLs reside should be rate limited"* (enumeration defence). | **LOW** (all four already precedented) | `mintShareToken()` = 256-bit `randomBytes(32)` base64url ✅. `generateMetadata` already returns `robots: "noindex"` (`page.tsx:362`) ✅. `publicIpLimiter` + `getClientIp` is the pattern used by `scenario-share/[token]/page.tsx` ✅. There is **no `robots.txt` in the repo** — the meta tag is the only exclusion; that is adequate but worth stating. |
| **⛔ The token render must never populate the id-keyed cache** | The founder-flagged landmine, and it is worse than it looks. | **MEDIUM** | See "Cache landmine" below — this is a *correctness* table stake, not a nicety. |
| **Recipient chrome is suppressed** | A recipient must not be handed controls that don't apply to them. | **LOW** | ⭐ **Found while researching, not in TODOS.md:** `?share=1` already suppresses the outbound "Compare strategies" link (`FactsheetView.tsx:1566`) but does **NOT** suppress the Share button (line 1565 is gated on `!scenarioMode` alone). So a *recipient* of a token link currently sees "Copy share link", clicks it, and gets `?share=1` — the token is **stripped** by `ShareLinkButton`'s URL rebuild (line 1312: `pathname}?share=1`) — and hands out a **dead link**. This is a second instance of the same false-affordance class, on the recipient side. It must be in the same phase. |
| **Rate-limited mint** | An unlimited mint route on an authed surface is a quota/DoS surface. | **LOW** | `userActionLimiter` + B15 ordering (validate → limit → write), misconfig → 503 not a misleading 429. Copy from `share/route.ts:110-125`. |

### Differentiators (worth building, not assumed)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Stable, re-copyable link across sessions (true mint-or-reuse)** | The founder's literal requirement, and the thing the precedent *cannot* do. An allocator who copies the same link twice in two sessions should get the same URL both times — anything else silently kills links they already sent. | **MEDIUM** | Requires option A or B from the Critical Finding. This is the highest-value item in the whole phase: without it the feature regenerates the original bug in slow motion. |
| **"Replace link" as a control SEPARATE from "Revoke"** | Two different intents: *"kill it"* vs *"the old one leaked, give me a new one"*. Conflating them (the precedent's mint-always-revokes) is what makes reuse impossible. | **LOW** once reuse exists | Owner-side triad: `Copy link` (idempotent) · `Replace link` (rotate, confirm) · `Revoke` (kill, confirm). This is also the founder's phrasing: *"a revoke control regenerates the token and kills old links."* |
| **A link-scoped disclosure banner on the recipient's page** | The recipient is looking at an **unpublished, unreviewed** track record. `OwnerUnpublishedNotice` (`FactsheetView.tsx:690`) currently says *"only you can see this … anyone else who opens this link sees a 404"* — which becomes **factually false** the moment tokens ship. | **LOW-MEDIUM** | ⚠ **Hard dependency:** that banner's copy MUST change in this phase, or the product ships a false statement. Recipient-side needs its own variant: *"Shared privately by its owner. Not published or reviewed by Quantalyze."* Owner-side needs: *"Unpublished — visible to you and anyone holding your share link."* Notion's precedent of surfacing link-state **to the recipient** (the expiry banner) supports this. |
| **Optional link expiry** | Notion (any plan), Dropbox (paid), Figma (**Enterprise only**), DocSend. The tier-gating across three products is the tell: **expiry is NOT table stakes for a first release.** | **MEDIUM** | W3C TAG says capability URLs *"should expire"*, but that is a security-purist position that three mass-market products treat as premium. **Recommendation: defer.** If built later, copy Notion's honesty move — show the expiry date **to the recipient**, in a banner, so nobody is surprised by a link dying mid-diligence. |
| **A single "last opened" timestamp on the owner's share control** | Answers the one question an allocator actually has (*"did they look at it?"*) with one column and no surveillance apparatus. | **LOW** | Deliberately NOT the DocSend model (see anti-features). One `last_viewed_at` write, no per-page dwell, no notifications, no recipient identification. |
| **Multiple named tokens per strategy** | W3C TAG's targeted-revocation recommendation: *"enabling users to generate multiple URLs for the same capability … allowing targeted revocation when a particular URL is compromised."* One link per LP ⇒ revoke one without breaking the rest. | **HIGH** | Genuinely the *right* end-state for fund-document sharing, and genuinely too much for this milestone. The schema should not **preclude** it: model the table as N rows with a partial-unique `WHERE revoked_at IS NULL` (exactly the precedent's index) and the door stays open. **Defer the UI.** |

### Anti-Features (requested or precedented, but wrong here)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Per-view analytics / notify-on-open (the DocSend model)** | It is *the* selling point in the fund-document niche: page-by-page dwell, completion %, a ping on every open. | Turns a share link into a surveillance beacon aimed at **named allocators** — reputational risk far exceeding the feature's value pre-revenue. Also drags in consent/GDPR surface the repo has no home for (the `sanitize_user` deletion path would need to reach it), and inflates a 1-column feature into a subsystem. | The single `last_viewed_at` differentiator above. Nothing more. |
| **Password-protecting the link** | Dropbox/Figma both offer it. | A password sent through the same channel as the link (email, Slack) adds ~zero real security and 100% of the support burden ("what was the password?"). The 256-bit token already IS the secret. | Revoke + (later) expiry. |
| **Appending the token to the existing cache key** | Looks like the one-line fix. | ⛔ **It silently does nothing.** `page.tsx:66-69`: *"The `cacheKey` string the page passes in is split at `::` and everything after the id is DISCARDED … the effective `unstable_cache` key is id-ONLY."* The file spells out the corollary at line 76: *"viewer/lane separation can NEVER be expressed through the cacheKey string. Appending a suffix yields the SAME entry."* A token render written through `buildFactsheetPayloadCached` publishes a private strategy to every anonymous visitor for the full 3600 s TTL — **strictly worse than the bug being fixed.** | Branch **before** the cached wrapper, exactly as the owner lane already does (`page.tsx:529-536`: the owner arm calls `fetchAndBuildPayload` directly — *"no cache read, no cache write"*). The token lane is a third arm of that same `if`. |
| **A separate `/share/[token]` route (the scenario-share pattern)** | It is the *cleaner* architecture and it is what `scenario-share/[token]/page.tsx` does. | Contradicts the settled `?s=<token>` URL shape, and forks the entire 664-line factsheet page for a second render path. | Keep `?s=` on the existing route and reuse the owner-lane bypass. Borrow only `scenario-share`'s **discipline** (`force-dynamic`, `no-store`, service-role transport, IP rate limit) — the factsheet page is already `force-dynamic` (`page.tsx:33`), so the residual hazard is the *data* cache only. |
| **Hiding the Share button on unpublished strategies** | It is the "correct rule … one screen over" (`strategies/page.tsx:174`) that TODOS.md names, and it is half the class fix. | Hiding it **also removes the capability the founder wants**. Hidden-vs-disabled UX research: *"hide if the value is currently irrelevant"* — but here it is highly relevant, the owner genuinely wants to share. Hiding trades a lying button for a missing feature. | Keep the button **always visible and always enabled**; make it mint. The strategies-page site converges *up* to the token lane, not the factsheet site converging *down* to hidden. That is the honest reading of "fix the CLASS". |
| **A greyed-out/disabled Share button** | The intuitive middle ground. | The repo's own UAT direction is explicit: **no disabled buttons — a blocked button becomes a clickable remedy.** A disabled control with no explanation is the same false affordance in a different colour. | Always-enabled mint. If a state genuinely cannot mint (see the open question below), the click opens a one-line explanation with the next step — never a dead grey rectangle. |
| **Auto-minting a token on factsheet page load** | Makes Copy Link instant. | Mints a live capability for every strategy the owner merely *looks at*, including ones they never intended to share. Silent capability creation is the opposite of revocable. | Mint on the copy click (first time), reuse thereafter. |
| **410 Gone on the bare `/factsheet/<id>` lane** | Symmetry with the token lane. | Converts the id into an existence oracle, defeating the founder's whole reason for the token model (*"the id must stay a NON-secret"*, and ids leak via history / `Referer` / `/compare?ids=`). | 410 for tokens, 404 for ids. Pin both. |

---

## Feature Dependencies

```
[Token model choice: raw-at-rest | HMAC+counter]
    └──enables──> [Mint-or-reuse (stable link)]
                      └──enables──> [Copy link is idempotent]
                                        └──enables──> ["Replace link" ≠ "Revoke"]

[strategy_shares table + partial-unique WHERE revoked_at IS NULL]
    └──requires──> [Phase 156 Migration B settled against `strategies`]   ⛔ HARD BLOCKER
    └──enables──> [Revoke]  ──enables──> [410 recipient page]
    └──enables──> [has_active_share → owner "link is live" state]
    └──leaves-door-open-for──> [Multiple named tokens]   (defer UI)

[Token read lane in factsheet/[id]/v2/page.tsx]
    └──requires──> [Bypass of buildFactsheetPayloadCached]   ⛔ the landmine
    └──requires──> [searchParams added to the page props]     (not currently declared)
    └──requires──> [Recipient chrome suppression]             (?s= must imply shareMode)
    └──conflicts──> [OwnerUnpublishedNotice's current copy]   ⛔ becomes FALSE on ship
    └──degrades-with──> [generateMetadata + /api/og/factsheet/[id]]  (both withPublishedOnly)

[FactsheetView.tsx:1565 Share button]  ──same class as──>  [strategies/page.tsx:174 ShareableLink]
[FactsheetView.tsx:1312 ShareLinkButton URL rebuild]  ──strips the token──>  [recipient re-share = dead link]
```

### Dependency Notes

- **⛔ Blocker, restated from TODOS.md:** do not start on `feat/phase-156-connect-refactor` —
  Phase 156's Migration B is still pending against `strategies`. Two concurrent migrations touching
  the same table is how you get an ordering surprise on the auto-apply-to-PROD path.
- **`OwnerUnpublishedNotice` becomes a false statement.** Its body currently reads *"Anyone else who
  opens this link sees a 404 until Quantalyze review publishes it."* Once tokens ship that is wrong.
  The component is deliberately single-sourced (`page.tsx` renders the same component on the
  payload-pending arm — see the WR-02 note at `FactsheetView.tsx:686`), so one edit fixes both
  sites. **A phase that ships the token lane without touching this component is incomplete.**
- **Link-unfurl degradation is real and measured.** `generateMetadata` reads through
  `withPublishedOnly` (`page.tsx:336`) and `/api/og/factsheet/[id]/route.tsx:40` does too. So a
  token link pasted into Slack/WhatsApp/email unfurls as *"Strategy — Quantalyze Factsheet"* with a
  **404 image**. Two honest options: (a) accept it and say so (a private link *should* be dull in a
  chat preview — an unfurl bot's cache is a leak amplifier), or (b) resolve metadata through the
  token. **Recommend (a), explicitly**, so it is a decision rather than a bug report later.
- **A new env secret is a prod-only failure mode.** If the phase picks the HMAC option, the secret
  must be set on Vercel **and redeployed** before the feature is reachable, or Copy Link 500s in
  production while working perfectly everywhere else. This repo has been bitten by exactly this
  (`RESEND_API_KEY`). Option A (raw token at rest) has no such dependency — that is its real
  advantage, not the code size.
- **`?s=` must imply the existing `shareMode`.** `useShareMode()` currently keys on `?share=1`
  (`FactsheetView.tsx:1300`). Recipient-mode chrome suppression should key on *either*, so the token
  lane inherits the suppression that already exists instead of growing a second flag.

---

## MVP Definition

### Launch With (the SHARE phase)

- [ ] **`strategy_shares` table** — `strategy_id`, `created_by`, token material, `created_at`,
      `revoked_at`; owner RLS with the **CR-01 owner-coherence `EXISTS` clause** (a plain
      `created_by = auth.uid()` lets an authed user mint a share for *another tenant's*
      strategy_id — the FK only proves existence); `REVOKE ALL … FROM anon`; partial-unique
      `(strategy_id) WHERE revoked_at IS NULL`; index the lookup column.
- [ ] **Token model decision (A or B) written down in the plan**, with the deviation from
      `scenario-share-token.ts`'s hash-only discipline argued, not assumed.
- [ ] **Mint-or-reuse route** (`POST`, owner-scoped, `userActionLimiter`, B15 ordering, redacted
      DB-error envelope, `NO_STORE_HEADERS` on every response, `logAuditEvent`).
- [ ] **Revoke route** — port `share/revoke/route.ts` semantics wholesale (soft revoke, 404-not-403,
      double-revoke = convergence).
- [ ] **Token read lane in `factsheet/[id]/v2/page.tsx`** — a third arm alongside public/owner that
      **bypasses `buildFactsheetPayloadCached` entirely**, plus `searchParams` on the page props and
      an IP rate limit on the token lookup.
- [ ] **410 recipient page** for unknown/revoked tokens — content-free, `no-store`, distinct from the
      app 404; the bare-id lane's 404 unchanged.
- [ ] **`FactsheetView.tsx:1565` Share button becomes mint-or-reuse**, never flashes success on
      failure (`ShareableLink.tsx` already models the honest copy-failure branch — reuse it).
- [ ] **Recipient chrome suppression** — `?s=` implies `shareMode`; the recipient does **not** get a
      Share button (today they'd copy a token-stripped, dead URL).
- [ ] **`OwnerUnpublishedNotice` copy corrected** for both owner and recipient variants.
- [ ] **`strategies/page.tsx:174` converged onto the same lane** — the class fix, both sites.
- [ ] **Tests that can fail:** (1) an anon request for the id right after a **token** render still
      404s — the phase-148 cache-poison pin, extended to the token arm; (2) revoke → next token load
      is 410 with no strategy content in the HTML; (3) two Copy Link clicks **across a simulated
      reload** return the *same* URL (the anti-regression pin for the precedent's session-only
      reuse); (4) a token minted for strategy X does not open strategy Y; (5) the id lane still
      returns a uniform 404 for anon / non-owner / missing.

### Add After Validation (v1.2x)

- [ ] **`last_viewed_at`** on the share row — trigger: the founder asks "did they open it?" once.
- [ ] **Optional expiry** with a recipient-visible banner — trigger: a real LP conversation needs a
      time-boxed link.

### Future Consideration

- [ ] **Multiple named tokens per strategy** (per-recipient revocation) — defer until there is a
      second recipient to revoke *from*. Keep the schema compatible.
- [ ] **Owner-facing share audit list** ("minted 3 Aug, revoked 12 Aug") — the `revoked_at`
      soft-delete already retains the data; this is presentation only.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Copy Link produces a working link (mint) | HIGH | MEDIUM | **P1** |
| Cache-poison bypass (token lane never writes the id key) | HIGH (correctness) | LOW | **P1** |
| Mint-or-**reuse** across sessions | HIGH | MEDIUM | **P1** |
| Revoke + confirm | HIGH | LOW | **P1** |
| Distinct 410 recipient page | HIGH | LOW | **P1** |
| Owner "link is live" state | MEDIUM | LOW | **P1** |
| `OwnerUnpublishedNotice` copy correction | MEDIUM (honesty) | LOW | **P1** |
| Recipient chrome suppression (`?s=` ⇒ shareMode) | MEDIUM | LOW | **P1** |
| Both share sites on one lane (class fix) | MEDIUM | LOW | **P1** |
| "Replace link" distinct from Revoke | MEDIUM | LOW | **P2** |
| `last_viewed_at` | MEDIUM | LOW | **P2** |
| Link expiry | LOW (for now) | MEDIUM | **P3** |
| Multiple named tokens | LOW (today) | HIGH | **P3** |
| View analytics / notify-on-open | LOW | HIGH | **anti-feature** |
| Link password | LOW | MEDIUM | **anti-feature** |

---

## Competitor Feature Analysis

| Behaviour | Google Docs | Notion | Figma | Dropbox | DocSend | **Quantalyze (recommended)** |
|---|---|---|---|---|---|---|
| Link is a rotatable token? | ✗ (permanent file id; access is a *mode*) | ✗ (page id) | ✗ (file id) | ✓ (link id) | ✓ | **✓ — rotatable token, id stays non-secret** |
| Copy is idempotent (same link twice) | ✓ | ✓ | ✓ | ✓ | ✓ | **✓ (needs option A or B — the precedent gives only session-scoped reuse)** |
| Revoke | ✓ (→ Restricted) | ✓ (Remove) | ✓ | ✓ (disable) | ✓ (headline feature) | **✓ (soft, `revoked_at`)** |
| Recipient sees a *specific* message | ✓ "You need access" | ✓ (expiry banner) | ✗ (link just stops) | ✓ "This link is expired" | ✓ | **✓ 410 "this link was turned off" — content-free** |
| Owner sees link-live state | ✓ | ✓ | ✓ | ✓ | ✓ | **✓ (`has_active_share` pattern)** |
| Expiry | ✗ | ✓ any plan | Enterprise only | Paid tiers | ✓ | **defer (P3)** |
| Password | ✗ | ✗ | ✓ | ✓ | ✓ | **anti-feature** |
| Per-view analytics | ✗ | ✗ | ✗ | ✗ | ✓ (core) | **anti-feature; `last_viewed_at` only** |
| Targeted (per-recipient) revocation | ✓ (email invites) | ✗ | ✗ | ✗ | ✓ | **schema-compatible, UI deferred** |

---

## ⚠️ Open Product Question — surface, do NOT decide in this phase

**`status='private'` strategies have zero UI actions.** `StrategyActions.tsx` branches
`draft` → `pending_review` (line 113: `return null`) → `published` → `archived`, then falls through
to `return null` (line 162). `private` matches nothing, so it renders **no actions at all**. The
contribution flow lands strategies exactly there:
`finalize-wizard/route.ts:1000` sets `terminalStatus = entryContext === "contribution" ? "private" : "pending_review"`.

Consequence: a contribution-flow strategy **can never leave `private` from the UI**.

This is adjacent to SHARELINK-01 (both are "an unpublished strategy has no honest path forward"),
and the share token *partially* relieves it — with a token, a `private` strategy at least becomes
shareable, which may be all a contribution record ever needed. But whether contribution records are
**meant** to be permanently private, or need a publish path, is a **product decision the founder
owns**. The phase should:

1. Ship the token lane so `private` is *shareable* (removes the acute pain), and
2. Surface the question in the phase's UAT/close notes with the two options stated —
   **(a)** permanently private by design, leave it; **(b)** `private` needs a publish/submit-for-review
   action, which is its own phase.

Do not let a planner quietly pick (b) and grow a publish flow inside a share-link phase.

---

## Sources

**Codebase (HIGH — read at HEAD `ca3f0c5c`, cited file:line inline)**
- `src/app/factsheet/[id]/v2/page.tsx` — the two lanes, the owner-lane cache bypass, the
  cacheKey-is-id-only correction (lines 33, 66-81, 362, 425-540)
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — the mis-gated Share button (1565), `ShareLinkButton`
  token-stripping URL rebuild (1308-1338), `useShareMode` (1293-1305), `OwnerUnpublishedNotice` (690)
- `src/app/(dashboard)/strategies/page.tsx:174` + `src/components/strategy/ShareableLink.tsx` — the
  correctly-gated sibling, and the honest copy-failure branch worth reusing
- `src/components/strategy/StrategyActions.tsx:113,162` — the `private` dead end
- `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql`,
  `supabase/schema/functions/{create_scenario_share,get_shared_scenario}.sql` — the revocable-share precedent
- `src/lib/scenario-share-token.ts` (hash-only) vs `src/lib/demo-pdf-token.ts` (keyed MAC) — the two token models in-repo
- `src/app/api/allocator/scenario/share/{route.ts,revoke/route.ts}`,
  `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` — mint/revoke route + UX state machine
- `src/app/scenario-share/[token]/page.tsx` — the public token-lane security boundary comment
- `src/app/api/og/factsheet/[id]/route.tsx:40` — published-only OG image (unfurl degradation)

**External (MEDIUM — WebSearch/WebFetch tier, cross-checked)**
- [Good Practices for Capability URLs — W3C TAG](https://www.w3.org/2001/tag/doc/capability-urls/) — entropy, https, referrer, expiry, revocation, robots, rate limiting, 410-or-404
- [Sharing & permissions settings in Notion](https://www.notion.com/help/sharing-and-permissions) and [Notion link expiration rules](https://www.metomic.io/resource-centre/how-to-use-notions-new-expiry-rules) — recipient-visible expiry banner
- [Set an expiration on public links in design files — Figma](https://help.figma.com/hc/en-us/articles/16142157359255-Set-an-expiration-on-public-links-in-design-files) — expiry is Enterprise-gated
- [Troubleshoot shared links — Dropbox](https://help.dropbox.com/share/shared-link-stopped-working) and [set link permissions](https://help.dropbox.com/share/set-link-permissions) — "This link is expired" vs generic 404
- [How to Unshare a Google Doc](https://www.howtogeek.com/760665/how-to-unshare-a-google-doc/) / [Remove "Anyone with the link" sharing](https://www.patronum.io/remove-anyone-link-sharing-google-drive) — mode toggle, all-or-nothing, "you need access"
- [DocSend document tracking and analytics](https://www.docsend.com/features/analytics/) / [Revoke Access — Peony](https://www.peony.ink/features/revoke-access) — the fund-document niche's revoke + analytics expectations
- [410 Gone — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/410) — deliberate-removal semantics
- [Hidden vs. Disabled In UX — Smashing Magazine](https://www.smashingmagazine.com/2024/05/hidden-vs-disabled-ux/) / [Disabled Buttons UX](https://uxdworld.com/disabled-buttons-ux/) — why hiding *and* disabling are both wrong here

---
*Feature research for: revocable share links on private factsheets (v1.20 SHARE / SHARELINK-01)*
*Researched: 2026-08-20*

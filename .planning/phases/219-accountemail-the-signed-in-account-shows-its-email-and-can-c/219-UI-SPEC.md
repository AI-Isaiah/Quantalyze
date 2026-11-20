---
phase: "219"
slug: accountemail-the-signed-in-account-shows-its-email-and-can-c
status: approved
reviewed_at: "2026-11-19"
shadcn_initialized: false
preset: none
created: "2026-11-19"
---

# Phase 219 — UI Design Contract

> Visual and interaction contract for the Account tab's sign-in email section.
>
> **Copy revised 2026-11-20** for GD-01 (current-password gate, one confirmation link), GD-04
> (the done note trusts only Auth) and GD-05a (password-less accounts are sent to set a password).
> The Copywriting Contract, Interaction contract and States below carry the revision; every other
> section is unchanged.
>
> **Copy revised 2026-11-20 (GD-07)**: adds the /reset-password reauthentication strings, used when Secure password change refuses an old session; scoped to ResetPasswordForm, not the Account tab.
>
> **Copy revised 2026-11-20 (gap review round 1, GR1-MD-02, SFH-M4)**: adds PASSWORD_SET (`/profile?tab=account&password_set=1`, shown after /reset-password sends a signed-in user back) and the 401 and 503 lines of the email-change form, which no longer fall to the generic fallback.
>
> **Provenance, stated plainly:** this contract was written inline by the discuss agent following
> the gsd-ui-researcher instructions, because that run had no subagent tool to spawn
> gsd-ui-researcher or gsd-ui-checker. It was self-checked against the checker's 7 dimensions
> (bottom), NOT independently verified. Run `/gsd-ui-phase 219` (it auto-skips to the checker on
> an existing UI-SPEC under `--auto`) before planning if an independent check is wanted.
>
> **Revision 1 (2026-11-19, gsd-ui-researcher):** an independent gsd-ui-checker run blocked on
> three dimensions. Fixed here: the dismiss button is now `Keep current email` (Copywriting);
> new markup sets only weights 400 and 600 (Typography); 12px is declared as a justified spacing
> exception (Spacing). Also added from the checker's recommendations: app-written error fallbacks,
> a named variant for `Use a different email`, the focal point in the contract body, line heights
> by token, and the inventory pinned to a commit.
>
> **Nature of this phase: ONE NEW SECTION, REUSE-ONLY.** No new token, no new primitive, no new
> colour. Every decision cites `219-CONTEXT.md` (D-xx) or DESIGN.md. The section mirrors its
> neighbour on the same tab, `DeleteAccountButton.tsx`, class for class, so the tab reads as one
> surface.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (hand-authored `src/components/ui/*`, no `components.json`, governed by DESIGN.md) |
| Preset | not applicable |
| Component library | none (bespoke primitives: `Button`, `Input`) |
| Icon library | none (no icon in this section) |
| Font | DM Sans for every element, including the email value. The email is an identity the user reads to act on, not a numeric data value, so the mono voice does not apply (DESIGN.md "interactive voice"). |

**shadcn gate outcome:** not initialised and not prompted. Registry safety gate: not applicable.

---

## Component Inventory

Enumerated by `ls src/components/ui/*.tsx | grep -v '\.test\.tsx$' | wc -l` — 25 components — src/components/ui@4a19964f2656bfdc929f354a6a284a24bf42239e (in-repo hand-authored primitives, not an installed package; pinned to the commit the count was taken at) — 2026-11-19.

Non-exhaustive list of what this phase reuses. It is not an allowlist.

| Component | Import path | Use in this phase |
|-----------|-------------|-------------------|
| `Button` | `@/components/ui/Button` | "Change email" (`variant="secondary"`), "Send confirmation link" (`variant="primary"`, `type="submit"`), "Keep current email" (`variant="secondary"`, `type="button"`), "Use a different email" (`variant="ghost"`, `size="md"`, `type="button"`, so it keeps the 44px touch height). |
| `Input` | `@/components/ui/Input` | The new-email field: `label="New email"`, `type="email"`, `name="email"`, `autoComplete="email"`, `required`. Already 44px tall. Beneath it (GD-01): `label="Current password"`, `type="password"`, `name="current_password"`, `autoComplete="current-password"`, `required`. |
| `Link` | `next/link` | The `Set a password` link to `/reset-password` (GD-05a), accent link classes as `ResetPasswordForm`, at weight 600. |

---

## Placement (D-01, D-03)

`ProfileTabs` → `TabsContent value="account"` → the existing `<div className="max-w-xl">`. The new
section renders FIRST, then `DeleteAccountButton`. The wrapper becomes
`<div className="max-w-xl space-y-8">` and the delete block is separated by
`border-t border-border pt-8`. No sidebar, top bar or `PageHeader` change (D-03).

Data in (D-02, D-05): `profile/page.tsx` passes `email={user.email ?? null}` and
`pendingEmail={user.new_email ?? null}` from the server `auth.getUser()` result it already holds.
Never `profile.email`.

---

## States and markup contract

Component: `AccountEmailSection` (name at Claude's discretion per CONTEXT), a client component.

| State | Renders |
|-------|---------|
| `idle` | Heading, helper line, the current email, and the **Change email** button. If `pendingEmail` is set, the pending panel renders under the email instead of the button (see `pending`). |
| `editing` | Heading, helper, current email, then the form: `Input` + **Send confirmation link** + **Keep current email**. Focus moves to the input on open. |
| `submitting` | As `editing`; submit shows `Sending link...` and both buttons and the input are `disabled`. |
| `error` | As `editing`; the error line under the form, `role="alert"`. The input keeps its value. |
| `wrong-password` | As `error`, with the server line `That password is not right. Nothing was sent.` The address keeps its value, the Current password field is emptied and takes focus (GD-01). |
| `password-not-set` | As `editing`, with a `role="alert"` line `This account has no password yet. Set a password first, then change your email.` followed by a `Set a password` link to `/reset-password`. The wrong-password line is NOT shown (GD-05a). |
| `confirmed` | Closed, no pending address, and the URL carries `email_change=confirmed`: a `role="status"` line `Your sign-in email is now {email}.` under the email value, `text-xs text-text-secondary`. `{email}` is the server-read `user.email`. A pending address always wins over the marker (GD-04). |
| `pending` | Heading, helper, current email, and the pending panel (`role="status"`). Shown right after a successful `updateUser`, and on every reload while `pendingEmail` is set. A **Use a different email** button (`Button variant="ghost"`, default `size="md"`) reopens `editing`. |
| `no-email` | `email` is null: the value line reads `No sign-in email is set.` and the Change button still shows. |

**Focal point:** the current email value. It is the only `text-text-primary` line between the
heading block and the controls, set at 600 on its own line, so the eye lands on it first after the
heading. Everything below it (button, form, pending panel) is an action on that value.

```tsx
<section aria-labelledby="account-email-heading" className="space-y-3">
  <div>
    <h3 id="account-email-heading" className="text-sm font-semibold text-text-primary">Sign-in email</h3>
    <p className="mt-1 text-xs text-text-secondary">{HELPER}</p>
  </div>
  <p className="text-sm font-semibold text-text-primary break-all" data-testid="account-email">{email}</p>
  {/* idle: <Button variant="secondary">Change email</Button> */}
  {/* editing/submitting/error: */}
  <form className="space-y-3" noValidate={false}>
    <Input label="New email" type="email" name="email" autoComplete="email" required />
    {error && <p className="text-xs text-negative" role="alert">{error}</p>}
    <div className="flex items-center gap-2">
      <Button type="submit" variant="primary">Send confirmation link</Button>
      <Button type="button" variant="secondary">Keep current email</Button>
    </div>
  </form>
  {/* pending: */}
  <div role="status" className="rounded-md border border-border bg-page px-4 py-3 text-sm text-text-secondary">{PENDING}</div>
  {/* after the panel, outside the live region: <Button type="button" variant="ghost">Use a different email</Button> */}
</section>
```

The pending panel copies `DeleteAccountButton`'s "sent" panel classes exactly. The pending panel's
email addresses render in `font-semibold text-text-primary` inside the sentence, `break-all`.

---

## Spacing Scale

DESIGN.md 4px ladder. Values this phase uses:

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Heading → helper (`mt-1`) |
| sm | 8px | Button row gap (`gap-2`) |
| — (exception) | 12px | Section stack (`space-y-3`); pending panel vertical padding (`py-3`) |
| md | 16px | Pending panel horizontal padding (`px-4`) |
| xl | 32px | Email section → delete block (`space-y-8`, `pt-8`) |

Exceptions: **12px**, for exactly the two uses above (`space-y-3`, `py-3`). Justification: 12px is
on DESIGN.md's own spacing scale (`12px(3)`, Spacing section), and the neighbouring
`DeleteAccountButton` on the same tab uses `space-y-3` for its stack and `px-4 py-3` for its sent
panel. This section mirrors that block class for class so the tab reads as one surface; snapping to
8 or 16 would make the two stacked blocks visibly disagree. No other off-8 value is permitted.

---

## Typography

New markup sets exactly **two weights: 400 (regular) and 600 (semibold)**, following DESIGN.md's
2026-04-29 "4-size / 2-weight" precedent. New markup never writes `font-medium` (500).

`Button` and the `Input` label render `font-medium` (500) inside the primitives themselves. That is
inherited from existing components this phase does not touch, is not a weight this contract sets,
and must not be overridden with a `className`.

Line heights are Tailwind's bundled tokens for each size class; new markup adds no `leading-*`
class: `text-sm` → `--text-sm--line-height` = 20px (1.43); `text-xs` → `--text-xs--line-height` =
16px (1.33).

| Role | Tier / Size | Weight | Line height | Where |
|------|-------------|--------|-------------|-------|
| Section heading | `text-sm` (14px) | 600 | 20px (`--text-sm--line-height`) | "Sign-in email" |
| Email value | `text-sm` (14px) | 600 | 20px (`--text-sm--line-height`) | The current email, and the addresses inside the pending sentence |
| Body / panel | `text-sm` (14px) | 400 | 20px (`--text-sm--line-height`) | Pending panel sentence |
| Helper / error | `text-xs` (12px) | 400 | 16px (`--text-xs--line-height`) | Helper line, error line |

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | #F8F9FA (`bg-page`) | Page background; pending panel fill |
| Secondary (30%) | #FFFFFF (`bg-surface`) | Tab content surface, input fill (unchanged) |
| Accent (10%) | #1B6B5A | Only the elements listed below |
| Destructive / negative | #DC2626 | Error line text only (`text-negative`) |

Accent reserved for exactly:
1. The **Send confirmation link** primary button.
2. Focus rings already owned by `Button` / `Input` (unchanged).

The pending state is neutral (`bg-page`, `text-text-secondary`), never green: nothing has changed
yet, so a success colour would claim more than is true. A failed `updateUser` is the only red.

---

## Copywriting Contract

The target flow is single-link (GD-01): one confirmation link, mailed to the new address. The
`email_change=partial` first-link note (FIRST_LINK_ACCEPTED) stays for the rollout window while
Secure email change is still ON; it is not part of the target flow.

| Element | Copy (exact) |
|---------|--------------|
| Section heading | `Sign-in email` |
| HELPER | `This is the email you use to sign in. Changing it takes effect after you confirm by email.` |
| No email | `No sign-in email is set.` |
| Open CTA | `Change email` |
| Field label | `New email` |
| Field placeholder | `you@example.com` (as `ForgotPasswordForm`) |
| Password field label | `Current password` (no placeholder; `autoComplete="current-password"`, `name="current_password"`, `required`) |
| Primary CTA | `Send confirmation link` |
| Primary CTA, busy | `Sending link...` |
| Dismiss form (secondary) | `Keep current email` |
| PENDING | `We sent a confirmation link to {pendingEmail}. You still sign in with {email} until you open it.` |
| FIRST_LINK_ACCEPTED (rollout window, `email_change=partial`) | `Your confirmation was accepted. To finish the change, confirm the link sent to your other address.` Shown beside the pending panel, outside the live region. |
| CONFIRMED (`email_change=confirmed`, nothing pending) | `Your sign-in email is now {email}.` |
| PASSWORD_SET (`password_set=1`) | `Your password is set.` A `role="status"` line, `text-xs text-text-secondary`, under the email value. Shown when /reset-password returns a signed-in user to the Account tab. |
| SET_PASSWORD_FIRST (409 `password_not_set`) | `This account has no password yet. Set a password first, then change your email.` followed by the link text `Set a password` (to `/reset-password`) |
| TOO_MANY (429) | `Too many attempts. Wait a minute and try again.` Shown for the app's own limiter. A 429 carrying `update_failed` is Auth's own refusal and shows Auth's message as-is. |
| SESSION_EXPIRED (401) | `Your session expired. Sign in again.` |
| UNAVAILABLE (503) | `Email change is unavailable right now. Please try again later.` |
| Server-supplied, shown as-is (`wrong_password`) | `That password is not right. Nothing was sent.` |
| Server-supplied, shown as-is (`verify_unavailable`) | `Could not check your password. Please try again.` |
| Server-supplied, shown as-is (`update_failed`) | Supabase's message, or the empty-message fallback below |
| Server-supplied, shown as-is (`same_address`) | `That is already your sign-in email.` |
| Reopen from pending | `Use a different email` |
| Same-as-current (client guard, no network call) | `That is already your sign-in email.` |
| Empty or invalid input | Native `type="email"` + `required` validation; no custom string. |
| Error state (the route or Auth refused the change) | The route's `error` text, shown as-is for the codes listed above. It names the problem; the user's path is to correct the address or password, or retry, and the form stays open with the address kept. |
| Error state, empty message fallback | `Could not send the confirmation link. Please try again.` (used for a blank `error`, and for any other answer: 403, a 400 without a code, a non-JSON body) |
| Error state, network failure | `Network error. Please try again.` (when the request throws, as `DeleteAccountButton` does) |
| Destructive confirmation | not applicable (a change is reversible by changing again, and Supabase's own email is the confirmation) |

When `{email}` is null in PENDING, the second sentence is omitted.

**Error pattern (stated, not implied):** this section follows the inline error-line pattern of its
auth-form neighbours `ResetPasswordForm` and `DeleteAccountButton` (`<p className="text-xs
text-negative" role="alert">`), NOT DESIGN.md's `ErrorEnvelope` / `buildEnvelope()` renderer. The
error is a recoverable field-level rejection of one address in a form that stays open, which is
what those neighbours render inline; the envelope's diagnostics accordion and correlation id have
nothing to carry here. This is a reading of DESIGN.md's "every error path" rule that the existing
auth forms already take, recorded so a reviewer sees it as a decision rather than an omission.

The comparison for the same-as-current guard trims and lower-cases both sides.

### /reset-password reauthentication (GD-07)

| Constant / control | String and attributes |
|---|---|
| CODE_SENT (`role="status"`, `text-sm text-text-secondary`, above the code input) | `For your security, we sent a code to your email. Enter it below to set your password.` |
| Code input label | `Code from your email` (`name="reauth_code"`, `autoComplete="one-time-code"`, `inputMode="numeric"`, `required`, no placeholder, no maxLength, no pattern) |
| Resend control (secondary `Button`, `type="button"`) | `Send a new code` |
| CODE_RESENT (replaces CODE_SENT after a successful resend) | `We sent a new code to your email.` |
| CODE_INVALID (`reauthentication_not_valid` on the nonce retry) | `That code is not right or has expired. Send a new code and try again.` |
| CODE_SEND_FAILED (reauthenticate() error with a blank message) | `Could not send a code. Please try again.` |

Other nonce-retry errors show Supabase's message as-is.

---

## Interaction contract

- `/reset-password` reauthentication (GD-07): on `reauthentication_needed` (matched by error code, never by message text) the form sends a code once and shows the code input; the retry passes `{ password, nonce }`; later sends happen only through `Send a new code`; the recovery-link path never sees the prompt.

- Submit (GD-01) sends `POST /api/account/email` with `Content-Type: application/json` and body
  `{ email: next.trim(), password }` (the password verbatim). The browser never calls
  `supabase.auth.updateUser`. The route sets `emailRedirectTo` to
  `<origin>/auth/callback?next=` + `encodeURIComponent("/profile?tab=account&email_change=confirmed")` (D-04).
  The same-address guard still refuses before any network call; empty and invalid input use native validation.
- The answer maps to the form as follows, and the password field is emptied after EVERY answer
  and on a thrown request (T-219-29):
  - 200 `{ ok: true, pending_email }`: pending panel for `pending_email` (null: nothing pending),
    address cleared, form closed, `router.refresh()` so the server re-reads `new_email`.
  - 400 `wrong_password`: the server line, address kept, password emptied, focus to the password field.
  - 409 `password_not_set`: SET_PASSWORD_FIRST plus the `Set a password` link (GD-05a), not the wrong-password line.
  - 502 `verify_unavailable`, 400 `update_failed`, 400 `same_address`: the server line as-is.
  - 429: TOO_MANY.
  - Anything else (401, 403, 503, a 400 without a code, a non-JSON body): the empty-message fallback.
  - The request throws: the network line.
- After the user opens the link, `/auth/callback` redirects to `/profile?tab=account` with
  `email_change=confirmed`, or `email_change=partial` for the first of two links while Secure email
  change is still ON (the rollout window).
- Confirmed-note rule (GD-04): `Your sign-in email is now {email}.` shows only when the URL carries
  `email_change=confirmed` AND no pending address is shown (neither the server `new_email` nor a
  just-sent one) AND the form is closed. `{email}` is the server-read `user.email`. The marker alone
  never asserts success: a pending address always wins over it (the marker is attacker-settable).
- Keyboard: the form submits on Enter; **Keep current email** closes the form, keeps the shown email unchanged, and returns focus to the **Change email** button; when the form was reopened from the pending state (`pendingEmail` set), it closes back to the pending panel, never clears it, and returns focus to **Use a different email**. **Use a different email** moves focus to the input.
- Screen readers: the pending panel is `role="status"` (polite), the error line is `role="alert"`.

---

## UI Considerations

Applicable state considerations resolved: 6 covered, 1 backstop, 0 unresolved. (The step-9.5
probe engine was not run; rows are authored from the States table above.)

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| populated | email value | ✅ covered | The Account tab shows the server-read `user.email` (D-02), never `profile.email` |
| empty | email value | ✅ covered | A null email renders the `No email` row from the Copywriting Contract |
| loading | change form | ✅ covered | While `updateUser` is in flight the CTA reads `Sending link...` and the controls are disabled |
| error | change form | ✅ covered | A failed `updateUser` shows the Supabase message in a `role="alert"` line and keeps the input value |
| partial | pending change | ✅ covered | While `user.new_email` is set, the pending panel shows on every load, with copy true under either double-confirm setting |
| validation | change form | ✅ covered | Same-as-current is refused client-side with no network call; empty/invalid uses native email validation |
| long-text | email value, pending panel | 🧪 backstop | A 254-character address wraps (`break-all`) inside `max-w-xl` with no horizontal scroll at 375px |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| none | none | not applicable |

---

## Checker Sign-Off

Self-check by the authoring agent, not an independent gsd-ui-checker run:

- [x] Dimension 1 Copywriting: every string exact; every interactive label is verb + noun (`Change email`, `Send confirmation link`, `Keep current email`, `Use a different email`); errors name a path, with app-written fallbacks
- [x] Dimension 2 Visuals: one section, mirrors the neighbour block; focal point is the email value
- [x] Dimension 3 Color: accent on one element plus inherited focus rings; red only for error
- [x] Dimension 4 Typography: 2 sizes set by new markup (14/12; primitives keep their own), exactly 2 weights set by new markup (400, 600); line heights by token
- [x] Dimension 5 Spacing: 4/8/16/32 plus one declared, justified 12px exception (DESIGN.md `12px(3)`, neighbour parity)
- [x] Dimension 6 Registry Safety: no registry
- [x] Dimension 7 Inventory Provenance: provenance line present

**Approval:** approved 2026-11-19 by gsd-ui-checker (re-check of revision 1: all 7 dimensions PASS). Inline `role="alert"` error line kept over `buildEnvelope()`: DESIGN.md's Error Envelope lists its surfaces (wizard, CSV upload, factsheet, admin status, error.tsx) and the existing auth forms use the inline line; recorded as a reading, reversible, not a new exception.

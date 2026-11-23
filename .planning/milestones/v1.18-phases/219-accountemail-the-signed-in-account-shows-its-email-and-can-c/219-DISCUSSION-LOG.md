# Phase 219: ACCOUNTEMAIL - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-19
**Phase:** 219-accountemail-the-signed-in-account-shows-its-email-and-can-c
**Areas discussed:** Account tab UI, Change flow, profiles.email sync, Grant revoke, Tests and review

Mode: smart discuss, non-interactive. The discuss agent could not ask the founder. The only founder
decision is the 2026-11-19 "Book a phase (Recommended)". The first discuss pass STOPPED before
writing CONTEXT.md because the scout found that a confirmed email change leaves `profiles.email`
stale and the only non-direct-write fix is a migration, which the original brief excluded. The
coordinating session (the "caller") then chose option (a) and put a migration in scope.

---

## profiles.email sync (the stop-and-report question)

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Migration: AFTER UPDATE OF email trigger on auth.users | Root-cause sync of the derived copy; catches dashboard edits too; must skip under the sanitize GUC | ✓ |
| (b) App-side write in /auth/callback | Excluded: an app write to profiles.email; misses non-app changes; may not see the final double-confirm click | |
| (c) UI only, book the staleness | Leaves transactional mail, invite matching and the sanitize purge on the old address | |

**Choice:** (a), by the caller, not the founder (D-06, reasoning D-11).
**Notes:** Evidence: PROD `pg_trigger` on `auth.users` holds only `on_auth_user_created`; PROD drift 0 of 38, 0 pending changes (count-only read).

## Grant revoke

| Option | Description | Selected |
|--------|-------------|----------|
| Revoke authenticated UPDATE(email) in the same migration, conditional on proof of no user-session writer | Closes the self-write of a column the invite policies match on | ✓ |
| Leave the grant, book it | Keeps a pre-existing finding open | |

**Choice:** conditional revoke, by the caller (D-07). Evidence at b4cb7c4de: no `src/` user-session writer of `profiles.email`.

## Tests and review

| Option | Description | Selected |
|--------|-------------|----------|
| SQL self-tests in the corpus idiom + censuses + neuter-RED proof; add migration-reviewer and rls-policy-auditor | Matches repo gate rules for migrations | ✓ |

**Choice:** by the caller (D-08, D-09, D-10).

## Account tab UI and change flow

| Option | Description | Selected |
|--------|-------------|----------|
| Profile page Account tab, email from auth.getUser(), updateUser with emailRedirectTo to /auth/callback?next=/profile?tab=account | Reuses shipped tab, callback and safeNextPath guard | ✓ |
| New /account route | Adds a URL contract for no gain | |
| Email also in sidebar/top bar | Beyond the goal; additive later | |

**Choice:** auto-decided (D-01 to D-05).

---

## Decided autonomously

[auto] [Account tab UI] — Q: "Where does the email live?" → Selected: "Profile page Account tab, above Delete account" (reversible technical — decided autonomously: moving a component between tabs is a local edit)
[auto] [Account tab UI] — Q: "Source of the displayed email?" → Selected: "auth.getUser() on the server" (reversible technical — decided autonomously: a prop source swap)
[auto] [Account tab UI] — Q: "Show the email in the sidebar or top bar too?" → Selected: "No" (reversible technical — decided autonomously: additive later)
[auto] [Change flow] — Q: "Which confirmation landing?" → Selected: "Existing /auth/callback with next=/profile?tab=account" (reversible technical — decided autonomously: the redirect path is one string)
[auto] [Change flow] — Q: "How is a pending change shown after reload?" → Selected: "Read user.new_email from getUser() server-side" (reversible technical — decided autonomously: display-only)
[auto] [Change flow] — Q: "Pending copy?" → Selected: "One wording true under either Secure email change setting" (product copy, auto-picked because the founder could not be asked — reversible by editing strings)
[auto] [Tests] — Q: "UI test approach?" → Selected: "vitest component tests plus a callback route test for the next path" (reversible technical — decided autonomously: tests are local files)

## Claude's Discretion

- Component name/file and inline-vs-button form layout, within UI-SPEC.md.
- Migration filename and function name.

## Deferred Ideas

- Send routes reading the auth email instead of profiles.email.
- Email in the sidebar or top bar.
- Whether the org_invites policies error for authenticated on the unselectable column.

# Phase 206: SESSIONLOOP — a revoked-but-unexpired session cookie no longer bounces between / and /home - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-10
**Phase:** 206-sessionloop-a-revoked-but-unexpired-session-cookie-no-longer
**Areas discussed:** Fix point, Behaviour when confirmation fails, Cost and scope, Test

This run was non-interactive. A background agent ran discuss-phase and could not ask the founder.
Every selection below is the orchestrator's default from the phase brief, which follows
WR-01-R3's recommendation. The founder may revisit any of them.

---

## Fix point

| Option | Description | Selected |
|--------|-------------|----------|
| Proxy bounce branch only | Confirm with `getUser` before the signed-in bounce; every loop shape passes through it | ✓ |
| `/home` page | Change `/home`'s `!user` redirect | |
| All page guards | Change every `!user` guard | |

**Choice:** Proxy bounce branch only (orchestrator default)
**Notes:** A fix in `/home` alone leaves the `/login?redirect=` loop (WR-01-R3).

---

## Behaviour when confirmation fails

| Option | Description | Selected |
|--------|-------------|----------|
| Fall through and render | Return `supabaseResponse`; the public page renders | ✓ |
| Clear cookies in the proxy | Delete the stale session cookies | |
| Sign out in the proxy | Call `auth.signOut()` | |

**Choice:** Fall through (orchestrator default)

---

## Cost and scope

| Option | Description | Selected |
|--------|-------------|----------|
| `getUser` only inside the bounce branch | Network cost only on the four bounced routes, for cookie holders | ✓ |
| `getUser` for every request | Replace `getSession` everywhere | |

**Logging:** no new Sentry or logging in the proxy (orchestrator default).

---

## Test

| Option | Description | Selected |
|--------|-------------|----------|
| Extend `src/proxy.test.ts` | null user, error and user cases; RED when the confirmation is removed | ✓ |
| New test file | Separate spec | |

---

## Claude's Discretion

- Shape of the `getUser` mock across the existing describe blocks
- Wording of the code comment

## Deferred Ideas

- Clearing the cookie or signing out on a refused session
- Proxy-level Sentry for refused sessions
- Reworking the duplicate `!user` page guards

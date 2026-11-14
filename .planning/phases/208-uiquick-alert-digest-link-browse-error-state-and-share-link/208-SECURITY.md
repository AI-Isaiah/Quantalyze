---
phase: 208
slug: uiquick
status: verified
threats_open: 0
asvs_level: 1
block_on: high
audited_at_sha: 46da755c0
created: 2026-11-14
---

# Phase 208 — Security

Register authored at plan time (T-208-01..16 plus five T-208-SC rows across plans 01-05).
gsd-security-auditor (Sonnet, high) verified every mitigation at grep/read level (ASVS L1).
Verdict: **SECURED**, 21/21 closed.

| Threat | Category | Disposition | Status | Evidence |
|---|---|---|---|---|
| T-208-01 | Tampering | mitigate | CLOSED | `src/app/browse/page.tsx` Try again is a literal `/browse` link; `onlySlug` only from `state === "ok"` and fixed `DISCOVERY_CATEGORIES` |
| T-208-02 | Info disclosure | mitigate | CLOSED | error block renders fixed strings; the error message never reaches the UI |
| T-208-03 | Repudiation | mitigate | CLOSED | `failAnonRead` logs and captures once at the source; no second capture |
| T-208-04 | Spoofing | accept | CLOSED | `src/lib/email.ts` one-literal change, href unchanged |
| T-208-05 | Info disclosure | mitigate | CLOSED | closed-port Supabase URL and placeholder keys for the local run; no stray files |
| T-208-06 | Info disclosure | mitigate | CLOSED | `ShareableLink.tsx` mint catch logs `{ strategyId, err }`; `ShareMintError` carries status only |
| T-208-07 | Info disclosure | mitigate | CLOSED | one shared label for 403 and 404 |
| T-208-08 | Spoofing | accept | CLOSED | redirect-to-login only changes the sentence shown |
| T-208-09 | Info disclosure | mitigate | CLOSED | `copyTextBounded` logs never carry the copied text; factsheet catch throws a generic Error |
| T-208-10 | Info disclosure | mitigate | CLOSED | fallback input removed in `finally` |
| T-208-11 | DoS | mitigate | CLOSED | copy is the first await in the click handlers and is bounded |
| T-208-12 | Elevation of privilege | mitigate | CLOSED | WebKit harness page absent from tree and history |
| T-208-13 | Info disclosure | mitigate | CLOSED | WebKit run used placeholders and a fake mint route |
| T-208-14 | Spoofing | mitigate | CLOSED | both `resolveAppUrl` read only `Origin ?? Referer` after `assertSameOrigin`; real-chain test `route.csrf-integration.test.ts` |
| T-208-15 | Info disclosure | mitigate | CLOSED (residual) | request origin first in both share routes; D-16 arms in both route tests |
| T-208-16 | Tampering | accept | CLOSED | non-browser scheme from the caller's own session is self-only (REVIEW IN-01) |
| T-208-SC x5 | Tampering | accept | CLOSED | no package added or upgraded |

## Open, non-blocking

- **WR-01 (MEDIUM, 208-REVIEW.md)** is the production-side residual of T-208-15: production's own
  per-deployment `NEXT_PUBLIC_VERCEL_URL` host (and any `NEXT_PUBLIC_ALLOWED_ORIGINS` host) is
  CSRF-allow-listed but not 308-redirected, so a mint there returns a link pinned to that host. Not
  cross-user. Below `block_on: high`, so it does not count toward `threats_open`. It awaits the
  founder's choice of option A, B or C in `208-REVIEW.md` and is marked merge-blocking there.

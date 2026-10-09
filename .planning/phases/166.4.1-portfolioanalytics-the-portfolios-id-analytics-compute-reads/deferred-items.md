# Deferred items: Phase 166.4.1

Out-of-scope discoveries logged, not fixed (plan 166.4.1-03).

## AlertsList timestamp has no fixed time zone (hydration mismatch)

- **Where:** `src/components/portfolio/AlertsList.tsx` (`formatTimestamp(alert.triggered_at)`, rendered inside a server-rendered client component on `/portfolios/[id]`).
- **Reading:** with the server in UTC+2 and the browser pinned to UTC, the server rendered `Oct 9, 11:22 AM` and the client `Oct 9, 9:22 AM`, tripping the hydration guard (React #418 text mismatch). Measured on the seeded local lane, 2026-10-09; cleared by running the dev server with `TZ=UTC`.
- **Why deferred:** pre-existing, not touched by Plans 01 to 03. CI and Railway/Vercel servers run UTC, so the shipped lanes do not see it. A user whose browser zone differs from the server's would, in principle, get the same mismatch on every alert timestamp; worth a design call (format on the client only, or pass an explicit `timeZone`).

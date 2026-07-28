# v1.0.0 "API-Key Rewrite" — Founder Actions to Close the Milestone

**Created:** 2026-06-20 (after resolving every agent-resolvable gap)

The milestone close was deferred ("resolve gaps first"). Everything code- or
verification-resolvable is now done (Phase 19 soak/PR-D/quantstats verified;
Phase 16 superseded). The items below are the ONLY remaining blockers — each
needs you (live secrets, a real terminal, or real onboarding teams). None are
code I can write.

## Blocked on real customers (cannot be resolved until clients exist)

- [ ] **Phase 18 FIX-03** — ≥3 onboarding teams reach `strategy_verifications.status='published'`.
      Tracker: `.planning/phase-18/team-status.md`. No teams onboarded yet.
- [ ] **Phase 19 #2 / customer-feedback** — ≥1 verbatim entry from a real team's
      submission in `.planning/phase-19/customer-feedback.md`. Currently a
      logged gap (`customer-signal-gap.md`, Theme 4 ship-anyway).

> These two can't be "resolved" by work — they need real clients. If you want to
> close v1.0.0 before onboarding teams, the clean path is the **"Acknowledge &
> close"** option (record these as deferred) rather than "resolve first".

## Founder actions (live secrets / hardware — ~1–2 hrs total)

- [ ] **Phase 20 T14/T15 — MT5 demo reconcile.** Run the read-only EA on an MT5
      demo terminal through the README "T14 worksheet" (Day1 deposit → Day2
      overnight → Day3 withdrawal → Day4 kill+relaunch+sleep); reconcile the
      EA's `daily_return` rows vs MT5 history within ±ε. Only real test of the
      MQL5 balance-deal classification + restart-state. Then mark
      `20-VERIFICATION.md` passed.
- [ ] **RESEND_API_KEY in Vercel prod** — set it before 2026-07-01 or the monthly
      founder-LP report cron (`15 9 1 * *`) can't send. `email.ts` soft-skips
      today. `vercel env add RESEND_API_KEY production`.
- [ ] **Phase 18 FIX-02 — founder OKX wizard smoke run** in a production-equivalent
      env; fill `.planning/phase-18/founder-okx-smoke.md` (correlation_id,
      strategies.id, ciphertext fingerprint, status-transition table).
- [ ] **Phase 18 LP-03 — dogfood commitment text.** Fill the verbatim commitment
      in `.planning/phase-18/dogfood-commitment.md` (currently `status: PENDING`).
- [ ] **Phase 19 #3 — Sentry events probe.** With a real `SENTRY_AUTH_TOKEN`:
      `bash scripts/probe-sentry-events-api.sh` — confirms the cron handler's
      assumed events shape (`hits[].tags.correlation_id`, level, environment).
- [ ] **Phase 19 #5 — Vercel INTERNAL_API_TOKEN parity.**
      `vercel env pull --environment=production` then grep the row for a stray
      `\n` literal in `INTERNAL_API_TOKEN`.

## Optional (non-blocking)

- [ ] **Phase 16** — re-record a live SSE smoke / retro-fill `day-2-decision.md`
      if you want a formal sign-off. Otherwise Phase 16 is complete-by-supersession
      (the diagnostic found the bug → Phase 18 fixed it → Phase 19 shipped).

## After you finish the above

Re-run `/gsd:complete-milestone` (or have me run it). With these done, flip the
relevant `*-VERIFICATION.md` `status:` to `passed` so the pre-close
`audit-open` shows clear, then it tags `v1.0.0`, archives, and prepares the next
milestone.

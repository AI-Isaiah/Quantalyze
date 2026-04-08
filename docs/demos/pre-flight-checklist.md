# Demo Pre-Flight Checklist

Run this 1 hour before any live demo — partner, allocator, or manager.
Screenshots the items you check so you have evidence if something goes
wrong mid-demo.

---

## 30 minutes before — infrastructure

- [ ] **Migrations applied.** Run the following on staging Supabase and
      confirm each returns a row:
      ```sql
      SELECT version FROM supabase_migrations ORDER BY version DESC LIMIT 5;
      SELECT COUNT(*) FROM investor_attestations;
      SELECT COUNT(*) FROM cron_runs;
      SELECT COUNT(*) FROM match_batches;
      ```
      Expected: migrations 010, 011, 012, 013 all applied. Counts ≥ 1
      (backfilled for 012, seeded for 011, scheduled for 013).

- [ ] **Cron freshness.** Check that match_engine_cron has run in the
      last 36 hours:
      ```sql
      SELECT latest_cron_success('match_engine_cron');
      ```
      Expected: a timestamp within the last 12 hours (ideally within
      the last 6). If NULL or > 36h, the demo will show stale data.

- [ ] **Analytics service reachable.** Curl from your machine:
      ```bash
      curl -i -H "X-Service-Key: $KEY" https://your-railway-host/health
      ```
      Expected: 200 OK. If 5xx, fix BEFORE the demo.

- [ ] **Puppeteer smoke test.** Open one factsheet PDF URL in the
      browser:
      ```
      https://quantalyze.com/api/factsheet/[seeded-strategy-id]/pdf
      ```
      Expected: PDF downloads within 15 seconds. If hangs, the Vercel
      function timed out — try once more, then fall back to HTML tear
      sheet only for the demo.

- [ ] **Resend test email.** Manually trigger a `/api/admin/match/send-intro`
      against a seeded test allocator + seeded test strategy in staging.
      Confirm:
      - Contact request row inserted
      - Match decision row inserted
      - Both emails received by the test allocator + test manager inboxes
      - Founder CC'd on both

- [ ] **Kill switch OFF.** Check `/admin/match` shows "Engine: ON." If
      it says "Engine: OFF," click "Re-enable engine" and verify.

---

## 15 minutes before — demo data

- [ ] **Match Queue seeded.** Open `/admin/match` on staging and confirm
      at least 3 allocators show up in the triage list:
      - 1 with mandate + full portfolio + historical decisions (for the
        "active allocator" demo flow)
      - 1 cold-start with mandate but no portfolio (for the "new signup"
        demo flow)
      - 1 stalled allocator (for the "needs attention" triage demo)

- [ ] **Candidates in the queue.** Click into one allocator. Confirm:
      - At least 5 candidates in the ranked list
      - Top candidate has a reasonable score (50+)
      - Freshness badge shows fresh (< 12h old)
      - Manager identity panel shows for at least one institutional
        candidate

- [ ] **Eval dashboard not empty.** Open `/admin/match/eval`. Confirm
      at least 1 historical intro is shown (so the dashboard doesn't
      render in its empty state during the demo).

- [ ] **Discovery institutional lane populated.** Open
      `/discovery/crypto-sma` as a logged-in allocator. Confirm:
      - Accredited gate clears (the test allocator should be backfilled)
      - At least 4 institutional-tier strategies visible
      - ManagerIdentityPanel renders with real names on each
      - FreshnessBadge + PercentileRankBadge visible

- [ ] **Tear sheet renders.** Click "Download Tear Sheet" on one
      strategy. Confirm:
      - HTML version loads within 2 seconds
      - `window.print()` produces a clean 8.5x11 preview
      - PDF version downloads within 25 seconds

- [ ] **Recommendations page loads.** As a seeded allocator with
      mandate set, open `/recommendations`. Confirm top 3 candidates
      render with reasoning text.

---

## 10 minutes before — demo materials

- [ ] **Testimonial video playable.** Open the video file locally.
      Play the first 5 seconds. Audio + video working. File is at
      `docs/demos/allocator-testimonial.mp4` (Sprint 6 T15.3).

- [ ] **Before/after screenshot pair open.** `docs/demos/before-after.md`
      loaded in a browser tab or printed.

- [ ] **Term sheet printed.** Physical copy of
      `docs/pitch/term-sheet-draft.md` on the table.

- [ ] **One-pager printed.** Physical copy of `docs/pitch/one-pager.md`
      on the table next to the term sheet.

- [ ] **Objection handling re-read.** Read the 10 objections in
      `docs/pitch/objection-handling.md` out loud ONE more time.
      Focus on dodge-to-watch-for lines.

---

## 5 minutes before — environment

- [ ] **Laptop on wired internet.** Not wifi. Ethernet adapter ready.

- [ ] **Phone in airplane mode.** No notifications.

- [ ] **Browser: one window, one tab.** Close every other tab. Log out
      of personal Gmail, Slack, Twitter, etc. The audience sees only
      the tab being shared.

- [ ] **Zoom/screen share test.** Share the single demo tab, NOT the
      full desktop. Verify the tab is visible in the share preview.

- [ ] **Water within reach.** Dry throat mid-demo kills pacing.

- [ ] **Backup mode ready.** Have a 2-minute pre-recorded screen
      capture of the Match Queue on your phone's photos app. If staging
      dies during the demo, show the phone.

---

## During the demo — the red-flag watchlist

Things that mean "stop, reset, apologize briefly, move on":

- Staging returns a 5xx on any route you click → switch to the
  pre-recorded backup video
- Freshness badge shows "stale" on any demo strategy → say "the cron
  missed its window last night, let me point at the data anyway" and
  keep going
- A PDF takes > 30 seconds to render → skip the PDF, show HTML only
- An email fails to send during the Send Intro demo → say "the email
  dispatch is fire-and-forget so it'll retry in the background, the
  DB commit already happened" and move on. Do NOT debug live.

---

## After the demo

- [ ] **Write post-meeting notes immediately** — `docs/pitch/post-meeting-notes.md`
      for the partner demo, or a session recording for the allocator/manager.
      Do this within 2 hours while the reactions are fresh.

- [ ] **Send a thank-you email** within 4 hours.

- [ ] **Log any bugs you saw** in TODOS.md or as GitHub issues.
      Prioritize P0 if they would recur on the next demo.

- [ ] **Update the objection handling doc** with any new objections
      that surprised you.

- [ ] **Slack your advisor / accountability partner** with the outcome
      and the next step.

---

## Weekly hygiene (once the demo cadence stabilizes)

- Run the full pre-flight checklist every Monday morning before the
  week's demos
- Verify the `match_engine_cron` heartbeat is healthy daily via the
  admin-only `latest_cron_success()` function
- Rotate a tear-sheet PDF screenshot weekly to a file somewhere as
  visual regression evidence
- Keep at least 1 Sentry-clean day per week (no unhandled exceptions
  in 24h)

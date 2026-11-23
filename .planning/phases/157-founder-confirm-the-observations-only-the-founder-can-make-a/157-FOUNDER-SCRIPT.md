# Phase 157 founder script

One step at a time. Every step gives a URL, what to click, and the exact text to expect. All expected text was read from the source at HEAD `0def03553`, never from earlier prose. Take each step only after I say the previous one is done.

SC-1 names the entry `+ Strategy`; at HEAD the control is called "Add a strategy", so use that label throughout.

## 0. Before you start (read once)

- What the marker is: while the staging kit is installed, a red bar across the top of the page reads `STAGED RESPONSES ACTIVE — FCONF-0x`, with the leg's number. It means the page is answering a few named requests from the browser instead of the server, so nothing staged reaches PROD.
- **No marker on screen: do not click anything. Tell me.** A reload removes the kit and the marker together. A marker reading `STAGING KIT NOT ACTIVE — wrong context` means the kit did not install in the page's own context: do not click, tell me.
- The marker alone does not prove the page's requests are staged, so in every leg I also read back `window.__fconf.mode` and the fetch identity check before your first click.
- While the kit is armed, the key-permission badge on the sync preview shows an error. That is expected and is not a finding: the kit refuses that read, because the real one writes an audit row and decrypts the stored credential on our side.
- Never click `Start fresh`, `Delete draft` or the delete confirm. The kit refuses the delete, but never test that.
- Anything unexpected (gate red, an error you were not told to expect, the marker gone, a screen not described here): stop, describe it, and I record it as a finding. A failed observation is a finding, not a new design.
- Injection order is always the same: you open the page, I inject the kit and arm the mode, you confirm the marker, and only then you click the entry. Arming comes BEFORE Resume, every time.
- Fallback injection if I cannot reach your tab: paste the kit file into the DevTools console. Chrome asks you to type "allow pasting" the first time.
- Refused reads from page chrome outside the wizard (sidebar counts, notification reads and similar) are expected noise from the fail-closed rule. They show in my read-back as `GET` lines and are not findings. A refused write (any other method) is always reported.
- Analytics will record the staged legs. The kit stops staged requests from reaching our database, but the wizard's own client telemetry goes to PostHog (`wizard_error` and similar events), and so does any browser error report, and both still leave the browser. The staged faults will therefore show up there as events from your account during the sitting. I record the sitting's time window so those events can be told apart. They are noise, not real faults.
- Fake text only. Where a field needs text, type obvious words such as "not a real key". Never type anything key-shaped and never a real credential.

## 1. Entry check (one step)

Open `/strategies`. Which "Add a strategy" do you see?

- (a) In the left sidebar or the mobile nav: an action that opens a panel over the page.
- (b) Only the button in the strategies list header: a link to the full wizard page.

- (c) The `+ Strategy` control you used on 2026-11-19, if it is somewhere else, for example on `/allocations`. There, the browse drawer's `Add your own track record` or `Can't find it? Add your own` also opens the overlay panel, so (c) counts as (a). Tell me exactly where you clicked.

Tell me (a), (b), (c) or a combination. It picks the connect route in section 4.

## 2. FCONF-01: resume banner and Resume (mode `resume`)

1. Open a NEW normal tab and go to `/strategies`. A new tab has a fresh per-tab nonce, so the banner shows.
2. I arm `resume`. Confirm the marker reads `STAGED RESPONSES ACTIVE — FCONF-01`. Before your first click I read back `window.__fconf.mode` and the fetch identity check (`window.fetch.name` is `fconfFetch`) in the page's own context, and I tell you when both read right. Do not click before that.
3. Click "Add a strategy". Expect `We saved your progress.` and `A draft from an earlier session is ready.`, with two buttons: `Resume draft` and `Start fresh`. Do not click Start fresh.
4. Click `Resume draft`. Expect the draft's step: the sync preview with the heading `Computing your verified factsheet`, or the factsheet preview with `Use this key and continue`.
5. I read back what the kit refused and passed. Nothing should be refused except page-chrome reads, the arm boundary entries and the key-permission read (`GET /api/keys/:id/permissions`, refused on purpose). On the preview that shows as an error under the key scopes badge. It is not a red gate.
6. Record both readings: your earlier same-browser ruling ("the silent return is fine") and this new-tab banner reading. SC-1 is not ticked on my word.
7. Optional stricter reading in a private window: run it ONLY with the kit pasted through DevTools and the `resume` marker visible. Without the marker, skip it, because an unstaged Resume can enqueue a real sync on the draft.

## 3. FCONF-02: the amber block (mode `amber`)

1. New tab, `/strategies`. I arm `amber`. Confirm the marker reads `STAGED RESPONSES ACTIVE — FCONF-02`. Before your first click I read back `window.__fconf.mode` and the fetch identity check (`window.fetch.name` is `fconfFetch`) in the page's own context, and I tell you when both read right. Do not click before that.
2. Click "Add a strategy", then `Resume draft`.
3. Within the first minute, expect an amber-bordered box headed `Recomputing this strategy's analytics` with the body `The previous result is out of date and is being recalculated. This screen updates when it finishes — your draft is saved.`
4. Expect no red error box and no metric numbers. The elapsed counter may tick, and that is expected.
5. If a red box, a "taking longer" banner or an interrupted banner shows instead: record and stop. That is the kit going quiet, not the amber state.

## 4. FCONF-03 connect: SEAM_INTERNAL_FAULT (mode `connect`)

Two variants, picked by section 1. Before the first click of either: I arm `connect`, you confirm the marker reads `STAGED RESPONSES ACTIVE — FCONF-03 (connect)`, and I read back `window.__fconf.mode` and the fetch identity check (`window.fetch.name` is `fconfFetch`) in the page's own context. Then I tell you when both read right. Do not click before that.

- (a) Overlay, if you saw the sidebar action: click the sidebar "Add a strategy". Expect `Connect your exchange` with no banner, because the draft read is staged as none and your live draft is untouched.
- (b) Page route, if you saw only the header button: click the header "Add a strategy", then `Resume draft` if the banner shows (a same-tab entry resumes silently). On the sync preview click `Try another key`; it only changes the step and deletes nothing. Expect `Connect your exchange`.
- Variant (b) branch: if the preview never shows `Try another key` (it renders only once the preview has passed or a gate failed), record and stop, and cite the kit's `submit-leg-derivation:` line.
- Both variants: type the words "not a real key" in the API key field and in the API secret field. Click `Validate key and continue`.
- Expect the title `Something failed on our side while we checked this key.`
- Expect the cause: `The check stopped on a fault in our own service — not in your key, your exchange or your data. We never store a key we could not check, so no key was stored. We cannot tell you whether a second attempt would get further, so we are not offering one here.`
- Expect two fix lines: `Send the correlation id below through the contact form. A fault in our own service is ours to fix, whether or not it repeats.` and `Nothing needs undoing on your side. Your key was not stored.` The words "contact form" are a link.
- Expect a collapsed `Diagnostics` disclosure and NO Retry button.
- The earlier spec spoke of `request_call` and `expand_log` controls. They are not separate buttons: they correspond to the contact-form link and the Diagnostics disclosure. A missing-button reading is a spec-wording finding, not a regression.
- The console line `[wizard] session_id_not_restored` may appear. It is expected.

## 5. FCONF-03 submit: the three finalize answers (mode `submit`, one per click)

1. Open a NEW normal tab and go to `/strategies`. Do not click anything yet. This is the leg where a miss publishes the draft, so you never walk in an unarmed tab.
2. I arm `submit` with `DRAFT_LOOKUP_FAILED` in that tab. Confirm the marker there reads `STAGED RESPONSES ACTIVE — FCONF-03 (submit: DRAFT_LOOKUP_FAILED)`. Before your first click I read back `window.__fconf.mode` and the fetch identity check (`window.fetch.name` is `fconfFetch`) in the page's own context, and I tell you when both read right. Do not click before that.
3. Only then click "Add a strategy", then `Resume draft` if the banner shows. On the preview click `Use this key and continue`, then continue through the Metadata step and the Review step. Click the submit button (`Add to Strategies` in the overlay, `Submit for review` on the page).
4. Expect the title `We could not read this draft.` and the cause `A read of your draft failed on our side before anything else ran. Nothing was submitted and nothing was changed — the fault is in our database, not in your key, your exchange or your data. Reads like this usually succeed on the next attempt.`
5. Expect the fix lines `Wait a moment and try again — the read usually succeeds on retry.` and `If it keeps failing, send the correlation id below through the contact form. Your draft is saved either way.` Expect a Retry button.
6. Retry only clears the card; it does not send anything again. I re-arm `DRAFT_FINALIZE_FAILED`. Confirm the marker names it, then click submit again.
7. Expect the title `We could not finish submitting this strategy.` and the cause `The last write failed, and the database's answer was not one we have a specific reply for. We cannot confirm from here whether anything was recorded, so we are not going to claim either way. The fault is on our side, not in your key or your exchange.`
8. Expect the fix lines `Try again. Submitting is state-guarded: if the first attempt did go through, the next one tells you the draft has already moved on rather than creating a second strategy.` and `If it keeps failing, send the correlation id below through the contact form.` Expect a Retry button.
9. I re-arm `SEAM_RESPONSE_UNREADABLE`. Confirm the marker names it, then click submit again.
10. Expect the title `We could not read the service's answer to your submission.` and the cause `Your submission reached the service that processes it and the service did answer — but in a shape we do not recognise, most often because a release of ours was mid-rollout. So we cannot tell you whether the strategy was accepted, and we would rather say that than guess.`
11. Expect three fix lines: `Open your strategies list first. If the submission went through, the strategy is there with its review status.` then `If it is not there after a minute, submit again.` then `If this keeps happening, send the correlation id below through the contact form.` Expect NO Retry button.
12. Branch, gate red on the sync preview: record and stop.
13. Branch, stuck on the sync preview, `Use this key and continue` never appears: record and stop, and cite the kit's `submit-leg-derivation:` line. It says the leg needs no real write, but only if the real trade or CSV counts are not both zero and the strategy gate passes on the real row. If it cannot reach Submit, there are two options:
    - `skip-submit`: FCONF-03 then reads `not observed (members: <those seen>)`.
    - `fresh-sync-then-submit`: the product enqueues one real sync of your own draft, which is a PROD write you choose. Offered only once you confirm the shared MT5 terminal is idle, with no 155.2 live read and no 155.1 spike run in progress. This is the one exception to the no-marker rule, for this option only. The order: (1) I arm `submit` in a NEW tab and you do not click the entry there yet; (2) in a second, unstaged tab, open the draft and click `Resume draft` only, then wait on the sync preview without clicking until the sync ends; (3) close that tab; (4) click the entry in the armed tab within 5 minutes of the sync ending, because a complete row fresher than the freshness window skips the kickoff. Off-limits in the unstaged tab: `Use this key and continue`, Metadata, Review, Submit, and anything else. Do not click Start fresh or Delete draft there either. The exception ends when the sync reaches a terminal state or the tab is closed, whichever comes first. FCONF-03 reads `observed` only when all four members were seen.

## 6. FCONF-04: rotate the spike investor password (LAST)

Run this section only after 155.2's last live read with that password, and after any further 155.1 spike run. Nothing here can happen earlier.

1. Two read-only pre-reads:
   - I report the count and labels of the PROD keys on that MT5 account (MM2's).
   - You open the Railway dashboard and tell me any variable NAMES that begin `MT5_SPIKE_`, never their values. I do not list Railway variables myself, because the listing returns values.
   - If a Railway-held copy exists, you decide whether to rotate it or delete it.
2. Change the investor password at the broker FIRST. The product validates the new password live against the broker, so the broker change must come before the next step.
3. Then, on `/profile`, for EVERY key the pre-read listed: click "Update password", type the new password in the field labelled `New password`, and save. Each key is checked live on its own.
4. Do this outside 00:30-07:30 UTC, and not while an MT5 compute job is running, because the shared terminal switches account.
5. After the last key, each key reads `idle`: the update enqueues no sync. Gate 1 counts only on the first scheduled derive after the rotation. A "Sync now" is an early look only and is not counted.
6. I then read gate 1 (MM2, MM3 and FX-AI_V, plus any other key on that account): `sync_status` must be `complete` with `last_sync_at` later than the rotation time. `complete_with_warnings` is not `complete`. It is recorded as a finding for you to rule on, never ticked.

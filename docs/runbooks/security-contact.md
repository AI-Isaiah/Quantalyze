# Security Contact Runbook

Operational guide for how security reports reach the founder. Quantalyze has
**no security mailbox and no contact email address**. The founder decided this
on 2026-10-07 (Phase 164.6.6.3.5, decisions D-01 and D-04): every report goes
through the contact form, and no mail domain or mailbox is provisioned or
booked. This runbook describes the path a report actually takes, so whoever is
on call checks the right inbox.

## The channel

- `https://quantalyze.xyz/contact?topic=security` is the contact form with the
  topic preselected to **Security report**.
- `public/.well-known/security.txt` lists that URL as its `Contact:` line
  (RFC 9116 requires one; an https URL is allowed).
- The `/security` page, `/for-quants`, the legal footer and the in-product
  error copy all point at the same form. Nothing in the product prints an
  address.
- The pages state a reply within one business day. That is the commitment this
  runbook exists to keep.

## Where a report lands

1. The form posts to `/api/for-quants-lead`. A security report writes one row
   to `for_quants_leads` with source `contact_form` and topic `security`.
2. The reference field carries any correlation id or draft id the reporter's
   link included (or that they pasted). It is stored as text and rendered as
   escaped text only.
3. A contact-form submission is never deduplicated: two reports from the same
   person on the same day write two rows.
4. The route is protected by a per-IP rate limit and a honeypot field. A bot
   that trips the honeypot receives the same success response as a human and
   no row is written, so an empty CRM after a burst of traffic is not by itself
   a fault.

## How the founder reads and closes a report

- Read it at `/admin/for-quants-leads` (admin sign-in required). Security
  reports are the rows whose topic is `security`.
- **No email notification is sent** while Resend is not configured (D-04): the
  route still writes the row and answers success, and skips the founder
  notification. The CRM is the inbox. Check it at least once per business day.
- Reply to the email address the reporter entered in the form, from whatever
  address the founder uses personally. There is no company mailbox to reply
  from, so say in the first reply who you are and that the report was received.
- After the reply, mark the row processed on the same page (this sets
  `processed_at`). An unprocessed row is the work queue.

## When something goes wrong

### Symptom: a reporter says they sent a report and got no reply

1. Open `/admin/for-quants-leads` and look for the row (topic `security`, the
   reporter's email, or the reference they quote). A row exists and is
   unprocessed: the gap is ours, reply now and acknowledge the delay.
2. No row exists: ask them to resend through the form. Check whether the
   submission was rate limited (the form tells the user so) or hit a 500/503;
   see the route logs for `/api/for-quants-lead`.
3. The form itself is unreachable: the page `/contact` must render for an
   unauthenticated visitor. Check `/contact` first, then `/api/health`.

### Symptom: the CRM is flooded with junk reports

- Do not remove the form: it is the only channel and `security.txt` points at
  it. Mark junk rows processed and let the rate limit and honeypot do their
  work. A genuine disclosure is usually long-form and includes reproduction
  steps.

### Symptom: someone asks for a security mailbox

- The decision is recorded: no mailbox, no mail domain, no booking (D-01, D-04).
  Revisiting it is a founder decision, and it would also reopen the sender
  defaults and the `security.txt` `Contact:` line.

## Acceptance: what "done" looks like

This runbook is satisfied when all of the following are true:

1. `https://quantalyze.xyz/contact?topic=security` loads for a signed-out
   visitor with the topic preselected.
2. A test submission with topic Security report appears in
   `/admin/for-quants-leads` with the topic and any reference you supplied.
3. The founder has marked that test row processed.
4. `public/.well-known/security.txt` still names the contact URL above and has
   an `Expires` date in the future (renewal is tracked in `TODOS.md` as
   `SECURITY-TXT-EXPIRES-01`).

## Audit: where the contact form is referenced in product copy

Regenerate with `grep -rn 'contact?topic=\|contactHref\|ContactPointerText' src`
whenever you touch auth, onboarding or error messaging. Every one of those is
a contract with the user: keep the form reachable, and keep the CRM read.

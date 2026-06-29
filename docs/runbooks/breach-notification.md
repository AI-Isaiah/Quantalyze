# Breach Notification Runbook

> Operational runbook backing the breach-notification commitment published on
> [`/security`](../../src/app/(marketing)/security/page.tsx) (§ Breach notification) and the
> "Incident response" row of [`soc2-readiness.md`](./soc2-readiness.md).
> Audit-2026-05-07 M-0984: `/security` publicly commits to a 72-hour
> notification window in line with GDPR Article 33; this runbook is the process
> that makes that commitment operable so the first real incident is not drafted
> live under stress.
>
> **Owners are role-based.** Quantalyze is founder-operated; every role below is
> currently the **Founder** (`[FOUNDER NAME]`, `security@quantalyze.com`).
> Replace the `[…]` placeholders as the team grows — do not leave a role
> unassigned at incident time.

## When this runbook fires

A **personal-data breach** — a breach of security leading to the accidental or
unlawful destruction, loss, alteration, unauthorised disclosure of, or access
to, personal data we process (account holders and, for institutional customers,
their named contacts). Examples: a leaked/abused credential exposing another
tenant's data, an exfiltration of `profiles`/`allocator_preferences`/lead rows,
a misconfigured RLS policy that served cross-tenant data.

Not every security event is a personal-data breach (e.g. a blocked attack with
no access). If unsure, treat it as in-scope until the assessment in Step 2
concludes otherwise, and **document the decision either way** (Step 6).

## The awareness clock (T0)

GDPR Article 33 counts the 72 hours from when we become **aware** — i.e. have a
reasonable degree of certainty that a security incident has occurred that
compromised personal data. A bare alert is not yet "awareness"; a short
confirmation investigation may precede it, but that investigation must be
prompt.

- **Who can declare awareness:** the **Incident Lead** (`[FOUNDER NAME]`). Any
  team member who suspects a breach escalates to the Incident Lead immediately
  via `security@quantalyze.com` + a direct message.
- **Record T0** (UTC timestamp) the moment awareness is declared. Every
  downstream deadline is relative to T0.

## Roles

| Role | Holder | Responsibility |
|------|--------|----------------|
| Incident Lead | `[FOUNDER NAME]` | Declares awareness (T0), owns the timeline, makes the final notify/no-notify call. |
| Drafter | `[FOUNDER NAME]` | Assembles the assessment + drafts the notice from the template below. |
| Approver | `[FOUNDER NAME]` | Signs off the notice content before dispatch. (Separate this from Drafter once a second person exists.) |
| Dispatcher | `[FOUNDER NAME]` | Sends the notices and records proof of send. |

## Timeline (relative to T0)

1. **T0 — Declare awareness.** Record the UTC timestamp. Open an incident note
   (private; see Step 6 for what it must capture).
2. **T0 → T0+24h — Assess.** Determine: what data/categories were affected,
   approximate number of data subjects and records, root cause, whether access
   actually occurred vs was merely possible, likely consequences, containment
   and remediation already taken. Identify the affected account holders and, for
   institutional customers, their onboarding security contacts (see "Contact
   registry" below).
3. **T0 → T0+48h — Draft + sign off.** Drafter completes the notice from the
   template; Approver signs off. Prepare the supervisory-authority notification
   in parallel (see "Two distinct obligations").
4. **By T0+72h — Dispatch.** Dispatcher sends the customer notice to the account
   email on file and, for institutional customers, to the named security
   contact; and notifies the lead supervisory authority if Article 33(1)
   applies. Record proof of send (message IDs / timestamps) in the incident
   note.
5. **If the 72-hour window cannot be met:** send the notice **without undue
   further delay** accompanied by the written justification (template below),
   per Article 33(1).

## Two distinct obligations (do not conflate)

- **Supervisory authority — Article 33(1):** notify the competent lead
  supervisory authority within 72 hours of awareness, unless the breach is
  unlikely to result in a risk to individuals' rights and freedoms. File the
  Article 33(3) content even if partial, then supplement.
- **Affected individuals — Article 34 + our `/security` commitment:** the
  public commitment is to notify the affected **account holder within 72 hours**
  (account email on file; institutional security contact where applicable).
  Article 34 independently requires notifying data subjects "without undue
  delay" when the breach is likely to result in a **high risk** to them. Our
  published window is the stricter, customer-facing promise — honour it.

## Customer notice template

> Maps to the four elements published on `/security` and the Article 33(3)
> structure. Keep it factual; do not speculate beyond the assessment.

```
Subject: Security incident affecting your Quantalyze account

[Account holder / institutional security contact],

We are writing to inform you of a personal-data incident affecting your
Quantalyze account, which we became aware of on [T0 DATE/TIME UTC].

What happened (nature of the incident): [concise description]
What data was affected (categories + approximate scope): [e.g. display name,
  email, mandate preferences; ~N records]
Likely consequences: [assessed risk to you]
What we have done (remediation taken): [containment + fixes]
What you can do: [actions for the recipient, if any]
Contact point for follow-up: security@quantalyze.com [+ DPO/contact name]

We will share further updates as our investigation progresses.

— [FOUNDER NAME], Quantalyze
```

## Article 33 delay-justification template

> Used only when the 72-hour window to the supervisory authority cannot be met;
> attached to the (late) notification per Article 33(1).

```
Notification submitted [HOURS] hours after awareness (T0 = [T0 DATE/TIME UTC]).

Reason for the delay beyond 72 hours: [factual reason — e.g. the scope could
not be reliably established within the window without risking an inaccurate
notification].

Steps taken during the delay: [investigation/containment milestones].

This notification is submitted without undue further delay upon [the trigger
that resolved the blocker].
```

## Contact registry

- **Account holder email:** `profiles`/auth email on file for the affected user.
- **Institutional security contact:** where one was provided, it lives in the
  free-text `notes` of the for-quants lead / onboarding record — there is **no
  dedicated structured security-contact field today** (a product follow-up if
  one is wanted). If no named contact was provided, fall back to the account
  holder email.
- **Our outbound contact point:** `security@quantalyze.com` (MX/SPF/DKIM/DMARC
  configured + smoke-tested; see [`security-contact.md`](./security-contact.md)).

## Step 6 — Record-keeping (Article 33(5))

Document **every** breach — including those you decide not to notify — with: the
facts, effects, and remediation. The incident note must capture: T0; what was
affected and approximate scope; the notify/no-notify decision and its rationale;
who was notified, when, and proof of send; and any Article 33 delay
justification. This internal register is itself a GDPR requirement and the
evidence an auditor or supervisory authority will ask for.

## Related

- [`security-contact.md`](./security-contact.md) — the `security@` alias setup.
- [`soc2-readiness.md`](./soc2-readiness.md) — the "Incident response" control row.
- [`/security`](../../src/app/(marketing)/security/page.tsx) — the public commitment this runbook backs.

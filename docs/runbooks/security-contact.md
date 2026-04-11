# Security Contact Runbook

Operational guide for the `security@quantalyze.com` contact address. The
product surfaces this alias in ~20 places (see grep audit at the bottom)
— every one of those is a trust claim that must route to a real human
within one business day or the marketing copy becomes a lie.

## What ships referring to this address

- `/security` page (Request a Call, Responsible Disclosure sections)
- `/for-quants` page (security commitments block)
- `/strategies/new/wizard` ConnectKeyStep + MetadataStep contact line
- `wizardErrors.ts` 16-code error matrix (falls back to security@ on
  unknown / unrecoverable codes)
- `/api/for-quants-lead` 429/500/503 copy
- `RequestCallModal` fallback CTA

If the address does not accept mail or is not monitored, every one of
those callouts loses its meaning. This runbook documents the set-up +
verification so the claim stays honest.

## DNS / provider checklist

Quantalyze is on a single custom domain (`quantalyze.com`) fronted by
Vercel. Email is NOT hosted on Vercel — Vercel only manages A/AAAA and
CNAME records for the app. Mail routing is out-of-band.

1. **MX records published for `quantalyze.com`.** Confirm with:

    ```
    dig +short MX quantalyze.com
    ```

    Expect at least one `NN mail.provider.tld.` entry. Empty = mail
    bounces at the edge. If empty, point MX at whatever provider holds
    the founder's mailbox (Google Workspace, Fastmail, Migadu, etc.).

2. **Alias `security@quantalyze.com` provisioned.** The alias must
    forward to a mailbox a human actually checks. For Google Workspace:
    Admin console → Groups (or Users) → create `security` → destination
    = founder's primary inbox.

3. **SPF / DKIM / DMARC set on the domain so outbound `security@`
    replies don't land in spam.** Verify:

    ```
    dig +short TXT quantalyze.com | grep 'v=spf1'
    dig +short TXT _dmarc.quantalyze.com
    dig +short TXT google._domainkey.quantalyze.com   # or provider key
    ```

    - SPF: must include the mail provider's sending host.
    - DMARC: start at `p=none` to collect reports, upgrade to
      `p=quarantine` after a week of clean data.
    - DKIM: provider-specific selector, typically `google` or `mail`.

4. **End-to-end test.** From an external address (personal Gmail,
    phone, anything not on the domain):

    ```
    Subject: security-contact runbook test YYYY-MM-DD
    Body: please ignore, verifying the alias is live
    ```

    Expect delivery within 60s and a reply from the founder within one
    business day. If it bounces, check MX + alias first, then SPF/DMARC
    for the outbound reply.

## When something goes wrong

### Symptom: external user reports "I emailed security@ and got no reply"

1. Check the founder's spam folder first — DMARC quarantine will
    silently bucket legitimate inbound while you're ramping the policy.
2. Confirm the alias still exists in the provider admin console. Group
    memberships can be dropped by accident on account churn.
3. Run the dig checks above. A nameserver change on Vercel's side
    should NOT touch MX, but verify.
4. Reply to the original reporter from a personal address acknowledging
    the gap before you fix routing — their trust decays fast.

### Symptom: "security@" replies landing in the recipient's spam

- Almost always SPF/DKIM/DMARC. Run the three TXT-record digs above.
- If SPF is missing the provider, add `include:_spf.google.com` (or
  provider equivalent) and re-test.
- DKIM signature failing = the provider-specific selector TXT record
  isn't published. Provider admin console → DKIM → copy the key and
  publish it.

### Symptom: flood of spam to `security@` after going live

- Do NOT disable the alias — it's wired into production error copy.
  Instead, add a provider-side spam filter rule. Genuine disclosure
  reports are usually long-form and include a PoC attachment, which is
  easy to pattern-match for whitelist.

## Acceptance: what "done" looks like

This runbook is satisfied when ALL of the following are true, verified
by a smoke test on the day of the Month 2 security conversation:

1. `dig +short MX quantalyze.com` returns at least one entry.
2. External email to `security@quantalyze.com` is delivered in <60s.
3. A reply from the address lands in a personal Gmail (DMARC-aligned).
4. The founder has a Gmail filter / label / priority rule routing any
    inbound `security@` mail so it can't be missed.

Record the smoke-test date inside the TODOS.md entry for Sprint 2 so
the next Sprint lead can see the last-verified timestamp.

## Audit: where the alias is referenced in product copy

Run `rg 'security@quantalyze\.com' src` to regenerate this list
whenever you touch auth, onboarding, or error messaging. As of
Sprint 1 ship (2026-04-11) the alias appears in:

- `src/app/security/page.tsx` (×3 — Request Call + Responsible
  Disclosure + generic contact)
- `src/app/for-quants/page.tsx` (security commitments block)
- `src/app/for-quants/RequestCallModal.tsx` (×3 — mailto, 429 fallback,
  500 fallback)
- `src/app/api/for-quants-lead/route.ts` (×3 — 429/500/503 copy)
- `src/app/api/for-quants-lead/route.test.ts` (×2 — regression)
- `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx`
- `src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx`
- `src/app/(dashboard)/strategies/new/wizard/DesktopGate.tsx`
- `src/lib/wizardErrors.ts` (UNKNOWN + SYNC_FAILED fallbacks)

Every one of those is a contract with the user. Keep the alias alive.

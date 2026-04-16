# Security Packet Update Runbook

The downloadable security packet at `public/security-packet.pdf` is a
one-page institutional summary of Quantalyze's encryption spec, data
retention, exchange scopes, compliance posture, and incident-response
contact. Allocators under diligence forward it to risk teams; the public
`/security` page links it as the primary CTA.

Because the PDF is a static asset committed to the repo (not generated
per-request), every policy change that touches the `/security` page copy
should also regenerate the PDF — otherwise the marketing surface and the
forwardable document drift apart.

## When to update

Trigger the regeneration if **any** of the following changes:

- Encryption spec (cipher, KEK location, decryption path, column-grant
  model).
- Retention windows (raw fills, aggregate analytics).
- Supported exchanges or scope enforcement (Read / Trade / Withdraw
  handling).
- Compliance posture — specifically any SOC 2 milestone (engagement,
  Type 1 attestation, Type 2 attestation), a new subprocessor, or a
  change in the incident-response contact alias.
- Tenant-isolation mechanism (RLS, triggers, role grants).
- The last-reviewed date on `/security` moves and the content above
  did change with it.

Minor editorial tweaks on `/security` that do not change any of the
facts above **do not** require a PDF regeneration. The last-reviewed
date on the PDF is the ground truth — if a reader asks why the PDF and
the page differ in wording, the PDF wins for the date stamped on it.

## How to regenerate

From the repo root:

```sh
node scripts/build-security-packet.mjs
```

The script:

1. Reads `scripts/build-security-packet.html` (the source of the
   packet — edit this file, not the PDF).
2. Launches the local Chrome via the repo's existing `puppeteer-core`
   pipeline (`PUPPETEER_EXECUTABLE_PATH` honoured; defaults to the
   platform Chrome path).
3. Writes `public/security-packet.pdf` at A4, 16/18mm margins, print
   media type. Target file size is under 200 KB; the current output
   is ~110 KB.

No new dependencies are required — `puppeteer-core` is already pinned
for the per-request PDF routes.

## Editing the source

`scripts/build-security-packet.html` is a self-contained document.
Typography and colors mirror `src/app/security/page.tsx` and
`DESIGN.md`: Instrument Serif display, DM Sans body, Geist Mono data,
`#1B6B5A` accent, `#E2E8F0` hairline dividers.

When you edit the HTML:

1. Bump the `Last reviewed` date near the top of the file to today.
2. Also update the `Last reviewed` line in
   `src/app/security/page.tsx` (search for `Last reviewed:`) so the
   two surfaces agree.
3. Regenerate the PDF with the command above.
4. Open `public/security-packet.pdf` and confirm it is still one page.
   If it overflows, trim copy — the packet is a one-pager by design.

## Commit convention

Single atomic commit, scope `docs`:

```
docs(security): refresh security packet — <what changed>
```

Include both the HTML diff and the regenerated PDF in the same commit
so reviewers can compare. Binary PDF diffs are noisy but the file size
is small; committing the rendered output means the running app always
serves the canonical packet without a build-time regeneration step.

If the trigger for the update is a SOC 2 milestone, also update
`TODOS.md` or the relevant sprint plan so the next reviewer can see
the attestation state without reading the PDF.

## Acceptance

You are done when:

1. `public/security-packet.pdf` rebuilds cleanly with no console
   warnings.
2. The PDF opens in a browser viewer and is exactly one page.
3. The `Last reviewed` date on `/security` and inside the PDF match.
4. `bun test:e2e e2e/security-page.spec.ts` passes (the PDF download
   assertion loads the binary and expects `application/pdf`).

## Related

- `src/app/security/page.tsx` — public `/security` page that hosts the
  download link.
- `scripts/build-security-packet.html` — source of the PDF.
- `scripts/build-security-packet.mjs` — build script.
- `docs/runbooks/security-contact.md` — keeps the
  `security@quantalyze.com` alias alive. That alias is restated on
  the PDF; if it changes, update both.

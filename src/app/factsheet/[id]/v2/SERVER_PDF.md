# Server-side PDF generation — deferral note

## Status

Browser `window.print()` is currently the only export-to-PDF path
(triggered by the "Download PDF" button in `ControlBar`). This works,
but produces a PDF that's:

- Slightly different on each OS / browser
- Not watermarkable / not stampable with strategy provenance
- Dependent on the user's print settings (paper size, margins)
- Not deterministic across users — a screenshot reproduction will vary

For institutional-credibility output (factsheets that get filed by IC
analysts) we want a server-rendered PDF that's identical across users
and includes a Quantalyze watermark + correlation ID.

## Why deferred

The full implementation needs:

1. **Puppeteer + chromium binary** packaged in a Vercel function (the
   `@sparticuz/chromium` package handles this — chromium-min is ~70MB).
2. **Fluid Compute** function with `maxDuration: 60-120s` since PDF
   render of a 30-section factsheet runs ~5-10s.
3. **Authenticated routing** — the PDF endpoint must respect the same
   `published` + RLS rules as `/factsheet/[id]/v2`. Currently the OG
   endpoint already deals with this.
4. **Render route** — a server-rendered HTML route at e.g.
   `/factsheet/[id]/v2/print-view` that Puppeteer navigates to. This
   route can reuse `FactsheetView` directly but disables interactivity.
5. **Cache layer** — PDFs should be cached by `(strategyId, computed_at)`
   exactly like the OG image and the payload itself.

## Integration shape (for a follow-up phase)

```ts
// src/app/api/pdf/factsheet/[id]/route.ts
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(_req, ctx) {
  const { id } = await ctx.params;
  const browser = await launchPuppeteer(); // @sparticuz/chromium
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/factsheet/${id}/v2/print-view`);
    await page.emulateMediaType("print");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
      displayHeaderFooter: true,
      footerTemplate: `<div style="font-size:8px; color:#64748B; width:100%; text-align:center">
        Quantalyze Institutional Factsheet · ${id} · page <span class="pageNumber"></span> of <span class="totalPages"></span>
      </div>`,
    });
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="quantalyze-${id}.pdf"`,
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  } finally {
    await browser.close();
  }
}
```

## Why this matters for institutional users

Allocator IC memos pin factsheet PDFs in their data room. A
deterministic, stamped PDF:

- Reproduces the exact view the analyst saw on date X
- Carries a correlation ID for audit chains
- Resists tampering (anyone receiving a watermarked Quantalyze PDF
  can verify provenance against the platform)
- Can include an off-screen QR code linking back to the live page

## When to build

After the next allocator-facing milestone. The current browser-print
path is acceptable for v1 — most pre-IC review still happens in the
live web view and shareable URLs.

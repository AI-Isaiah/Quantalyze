/**
 * M-0943 (audit-2026-05-07 / reverify-2026-05-25) — security packet date-drift
 * guard.
 *
 * `scripts/build-security-packet.html` is the source the PDF regeneration
 * script (`scripts/build-security-packet.mjs`) renders into the committed
 * `public/security-packet.pdf` — the allocator-diligence artifact linked from
 * the /security CTA. The runbook's step 2 is "bump the Last reviewed date in
 * BOTH the HTML source and src/app/security/page.tsx so the downloadable
 * packet and the live page never disagree". That coupling is enforced
 * by-process today (a human remembering to edit both); nothing fails CI when
 * they drift.
 *
 * This is a pure file-read drift detector: extract the "Last reviewed" ISO
 * date from both files and assert they are identical. It does NOT regenerate
 * the PDF (that needs Chrome/puppeteer and is acceptable to skip per the
 * finding) — it only catches the date-drift class the runbook warns about.
 *
 * If a contributor bumps the page date but forgets the packet HTML (or vice
 * versa), this fails LOUD with both dates in the message.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HTML_PATH = resolve(
  process.cwd(),
  "scripts",
  "build-security-packet.html",
);
const PAGE_PATH = resolve(process.cwd(), "src", "app", "security", "page.tsx");

/**
 * Extract the first ISO `YYYY-MM-DD` date that follows a "Last reviewed"
 * marker (case-insensitive). Both files phrase it slightly differently:
 *   - HTML: `Last reviewed <span class="mono">2026-04-12</span>`
 *   - page: `Last reviewed: 2026-04-12.`
 * so we anchor on the marker and grab the next ISO date in the same vicinity.
 * Throws if the marker or a date is absent — guards against a vacuous pass if
 * the surrounding markup is refactored such that the date disappears.
 */
function extractLastReviewedDate(source: string, label: string): string {
  const markerIdx = source.search(/Last reviewed/i);
  if (markerIdx === -1) {
    throw new Error(
      `${label}: "Last reviewed" marker not found (markup refactored?)`,
    );
  }
  // Look at the slice starting at the marker (cap the window so a later,
  // unrelated date elsewhere in the file can't be mistaken for this one).
  const window = source.slice(markerIdx, markerIdx + 120);
  const dateMatch = window.match(/(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) {
    throw new Error(
      `${label}: no ISO date found within the "Last reviewed" marker`,
    );
  }
  return dateMatch[1];
}

describe("security packet ↔ /security page date parity (M-0943)", () => {
  it("the 'Last reviewed' date in build-security-packet.html matches src/app/security/page.tsx", () => {
    const htmlDate = extractLastReviewedDate(
      readFileSync(HTML_PATH, "utf8"),
      "build-security-packet.html",
    );
    const pageDate = extractLastReviewedDate(
      readFileSync(PAGE_PATH, "utf8"),
      "src/app/security/page.tsx",
    );

    // Sanity: both are well-formed ISO dates (the extractor already enforces
    // shape, but pin it so a future loosening of the regex stays honest).
    expect(htmlDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(pageDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The contract: regenerating the PDF must keep its review date in lockstep
    // with the live page. A drift here means the downloadable allocator-
    // diligence packet and the page that links it disagree.
    expect(
      htmlDate,
      `security-packet HTML last-reviewed (${htmlDate}) drifted from ` +
        `/security page last-reviewed (${pageDate}) — bump BOTH per the ` +
        `build-security-packet runbook step 2`,
    ).toBe(pageDate);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * RT-W2 (Phase 54 Plan 03, under VERIFY-05): the four prose/form admin pages
 * (partner-import, users, users/[id], for-quants-leads) get an inner
 * `max-w-[1100px]` cap so their inputs/prose stop fluid-filling to ~1920px on
 * ultra-wide. The `DashboardChrome.isWide` regex still grants the wide measure
 * to the whole `/admin` tree (CONTEXT REJECTED narrowing it — admin mixes
 * prose + data under one prefix), so DATA pages (e.g. partner-roi) deliberately
 * KEEP the wide 1920px measure. 1100px = DESIGN.md "Max content width (main
 * content area)".
 *
 * WHY THIS IS A SOURCE SCAN, NOT A RENDER TEST (RESEARCH Pitfall 7):
 *   The cap is a Tailwind utility-class LITERAL on a container `<div>`. The
 *   actual pixel width comes from Tailwind's compiled CSS (`max-width: 1100px`),
 *   not from anything jsdom measures — jsdom has no layout engine, so a render
 *   test would read `getBoundingClientRect()` as all zeros and could never
 *   distinguish 1100 from 1920. The durable, falsifiable guard is therefore to
 *   read the source text and assert the exact literal on each page.
 *
 *   Two directions are pinned so the change stays SCOPED (T-54-03-01,
 *   Tampering / scope-creep mitigation):
 *     (a) the 4 IN-SCOPE prose/form pages contain `max-w-[1100px]`, and
 *     (b) the OUT-OF-SCOPE admin DATA page (partner-roi) does NOT — so an
 *         over-broad future edit that caps a data page (collapsing its wide
 *         table measure) fails CI here.
 *
 *   Mirrors the Phase-38 composer-width.test.tsx idiom verbatim
 *   (readFileSync + className-substring assertions).
 */

const REPO = process.cwd();

const PARTNER_IMPORT = join(
  REPO,
  "src/app/(dashboard)/admin/partner-import/page.tsx",
);
const USERS = join(REPO, "src/app/(dashboard)/admin/users/page.tsx");
const USER_DETAIL = join(
  REPO,
  "src/app/(dashboard)/admin/users/[id]/page.tsx",
);
const FOR_QUANTS_LEADS = join(
  REPO,
  "src/app/(dashboard)/admin/for-quants-leads/page.tsx",
);
// OUT-OF-SCOPE contrast: a DATA page that must STAY wide (no inner cap).
const PARTNER_ROI = join(
  REPO,
  "src/app/(dashboard)/admin/partner-roi/page.tsx",
);

const CAP = "max-w-[1100px]";

const IN_SCOPE: { label: string; path: string }[] = [
  { label: "partner-import", path: PARTNER_IMPORT },
  { label: "users", path: USERS },
  { label: "users/[id]", path: USER_DETAIL },
  { label: "for-quants-leads", path: FOR_QUANTS_LEADS },
];

describe("admin width — RT-W2 (4 prose/form pages capped; data pages stay wide)", () => {
  for (const { label, path } of IN_SCOPE) {
    it(`IN SCOPE: admin/${label} carries the inner ${CAP} prose/form cap`, () => {
      const src = readFileSync(path, "utf8");
      expect(src).toContain(CAP);
      // Exactly one cap per page — a second one would mean a stray nested
      // wrapper, not the single page-content cap this plan applies.
      expect(src.match(/max-w-\[1100px\]/g)?.length ?? 0).toBe(1);
    });
  }

  it("OUT OF SCOPE: admin DATA pages keep the wide 1920px measure (no inner cap)", () => {
    // partner-roi is a DATA page — DashboardChrome's `isWide` allow-list grants
    // it the wide measure and it must NOT gain the prose cap. Pinning it here
    // makes an accidental over-broad edit (capping a data page) fail CI
    // (T-54-03-01, scope-creep mitigation).
    const partnerRoiSrc = readFileSync(PARTNER_ROI, "utf8");
    expect(partnerRoiSrc).not.toContain(CAP);
  });
});

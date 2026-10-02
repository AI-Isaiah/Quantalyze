/**
 * Phase 164 / SHARE-01 — the share lane's Referrer-Policy, asserted on the
 * RESOLVED header table rather than on the config file's text.
 *
 * WHY THIS EXISTS. The recipient route carries a capability token in its PATH
 * (ruling D-01). The site-wide policy is
 * `Referrer-Policy: strict-origin-when-cross-origin`, and the gap it leaves is
 * SAME-ORIGIN navigation: on a same-origin request that policy sends the FULL
 * URL as `Referer` — path, token and all. So any same-origin link click or
 * subresource fetch from a recipient page would put a live capability in a
 * request header and in this app's own logs. `no-referrer` on this one route
 * closes it.
 *
 * ⛔ AN EARLIER RATIONALE FOR THIS HEADER WAS FACTUALLY WRONG AND IS RECORDED
 * HERE SO IT CANNOT COME BACK. It claimed
 * `strict-origin-when-cross-origin` "strips query strings cross-origin but
 * never the path". That is false: cross-origin, that policy sends ONLY the
 * origin — neither path nor query survives. The header below is still correct,
 * but for the same-origin reason above, not that one. Anyone re-deriving this
 * mitigation from the false premise would conclude a query-param token is safe
 * cross-origin and a path token is not; both are equally covered cross-origin,
 * and both are equally exposed same-origin.
 *
 * WHAT THIS TEST CAN AND CANNOT DO. It calls the real `headers()` from
 * `next.config.ts` and asserts on the entries Next will consume, so a deleted
 * block, a typo'd source, or a weakened global policy all redden it. It CANNOT
 * prove the deployed response actually carries the header — that is a
 * post-deploy UAT check (`curl -sI` on a live token URL), not a skipped step.
 */
import { describe, it, expect } from "vitest";

import nextConfig from "../../next.config";

/** Oracles typed by hand — never read back from the config under test. */
const SHARE_SOURCE = "/factsheet-share/:path*";
const GLOBAL_SOURCE = "/(.*)";
const KEY = "Referrer-Policy";

type HeaderEntry = { key: string; value: string };
type HeaderBlock = { source: string; headers: HeaderEntry[] };

async function resolvedHeaderBlocks(): Promise<HeaderBlock[]> {
  expect(
    typeof nextConfig.headers,
    "next.config.ts must still define headers()",
  ).toBe("function");
  return (await nextConfig.headers!()) as unknown as HeaderBlock[];
}

function referrerPolicyFor(blocks: HeaderBlock[], source: string) {
  const block = blocks.find((b) => b.source === source);
  expect(block, `no header block with source ${source}`).toBeDefined();
  return block!.headers.find((h) => h.key === KEY)?.value;
}

describe("[164 SHARE-01] per-route no-referrer on the share lane", () => {
  it("the share route resolves to Referrer-Policy: no-referrer", async () => {
    const blocks = await resolvedHeaderBlocks();
    expect(referrerPolicyFor(blocks, SHARE_SOURCE)).toBe("no-referrer");
  });

  it("the share source pattern covers the token path, not just the bare prefix", async () => {
    const blocks = await resolvedHeaderBlocks();
    const block = blocks.find((b) => b.source === SHARE_SOURCE)!;
    // `:path*` is Next's catch-all segment matcher. Pinned as a literal
    // because `/factsheet-share` alone (no `:path*`) would match the prefix
    // and MISS every real share URL — a header that looks present and covers
    // nothing.
    expect(block.source).toContain(":path*");
  });

  it("the GLOBAL policy is untouched — this is an addition, not a swap", async () => {
    const blocks = await resolvedHeaderBlocks();
    expect(referrerPolicyFor(blocks, GLOBAL_SOURCE)).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("exactly one block scopes the share route (one policy, one place)", async () => {
    const blocks = await resolvedHeaderBlocks();
    const matches = blocks.filter((b) => b.source.startsWith("/factsheet-share"));
    expect(matches).toHaveLength(1);
  });

  it("anti-vacuity: the resolved table is non-empty and every block is shaped", async () => {
    const blocks = await resolvedHeaderBlocks();
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      expect(typeof block.source).toBe("string");
      expect(Array.isArray(block.headers)).toBe(true);
      expect(block.headers.length).toBeGreaterThan(0);
    }
  });
});

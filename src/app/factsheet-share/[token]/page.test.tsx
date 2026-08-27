/**
 * Phase 164 / SHARE-01 + SHARE-02 — the recipient token lane, at the route
 * layer (no real DB, no real network).
 *
 * What each group is actually protecting:
 *
 *   RENDER — a valid token must render the factsheet for an ANONYMOUS session,
 *   in recipient mode. If `recipientShare` or the "shared privately" notice ever
 *   stopped being passed, the recipient would see a Copy-Link control that
 *   rebuilds the URL WITHOUT the token — handing out a link that 404s for the
 *   next person. That is the founder-hit defect, one lane over.
 *
 *   MISS → 410 — unknown, malformed and read-failed tokens must all converge on
 *   `/factsheet-share/gone`, never `notFound()`. 410 is honest on THIS lane
 *   (the holder already had the token); 404 stays the bare-id lane's answer,
 *   because telling an id holder that an id exists is an existence oracle.
 *
 *   ORDERING — the limiter runs BEFORE any DB or crypto work, and the format
 *   guard before any DB work. Both are asserted by proving the admin client was
 *   NEVER constructed, not by reading the source. An enumeration defence that
 *   runs after the scan defends nothing.
 *
 *   PENDING ≠ DEAD — a valid token whose payload is not built yet must NOT 410.
 *   Telling someone a live link is dead is a false statement, and "still
 *   computing" is exactly when an owner is most likely to have shared it.
 *
 *   METADATA — SL-1d. The token page must ship static metadata with
 *   `robots: noindex`, no `generateMetadata`, and no reference to the OG image
 *   route: that route is CDN-cached, URL-keyed and un-revocable, so an OG image
 *   of a private strategy could never be withdrawn.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";

import { deriveShareToken } from "@/lib/strategy-share-token";

vi.mock("server-only", () => ({}));

// redirect() throws to unwind the RSC render (mirrors next/navigation).
const redirectMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectMock(path);
    throw new Error("__REDIRECT__");
  },
  // Present so an accidental notFound() on this lane is COUNTED rather than
  // crashing with "not a function" — the assertion below reads better as
  // "never called" than as an import error.
  notFound: () => {
    notFoundMock();
    throw new Error("__NOT_FOUND__");
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));

const checkLimitMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: {},
  checkLimit: (...args: unknown[]) => checkLimitMock(...(args as [])),
  getClientIp: () => "203.0.113.7",
}));

// The admin client. `createAdminClient` itself is counted, so "no DB work" can
// be asserted as "the client was never even constructed" — a stronger and much
// less fakeable claim than counting queries.
const createAdminMock = vi.hoisted(() => vi.fn());
const adminFromMock = vi.hoisted(() => vi.fn());
const sharesReadMock = vi.hoisted(() =>
  vi.fn(async (_cols?: string, _isCol?: string, _isVal?: unknown) => ({
    // `data` is nullable because that is the shape PostgREST actually returns
    // on an error — {data: null, error} without throwing. Typing it non-null
    // here would make the "DB error" case below unwritable, which is exactly
    // the case most likely to regress.
    data: [] as Array<{ strategy_id: string; generation: number }> | null,
    error: null as { message?: string } | null,
  })),
);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    createAdminMock();
    return {
      from: (table: string) => {
        adminFromMock(table);
        if (table === "strategy_shares") {
          return {
            select: (cols: string) => ({
              is: (isCol: string, isVal: unknown) =>
                sharesReadMock(cols, isCol, isVal),
            }),
          };
        }
        // Any other table on this page is a disclosure bug by construction:
        // nothing here is bounded except the shares read and the matched id.
        throw new Error(`token page read an arbitrary table: ${table}`);
      },
    };
  },
}));

// The payload builder — the SAME one the owner lane calls. Mocked so this file
// stays a ROUTE test; what it pins is the call SHAPE (which id, which
// predicate), because the predicate is the only visibility gate the builder has.
const buildMock = vi.hoisted(() =>
  vi.fn(
    async (_id: string, _visibility: unknown) =>
      ({ strategyId: "stub" }) as unknown as Record<string, unknown> | null,
  ),
);
vi.mock("@/lib/factsheet/fetch-and-build-payload", () => ({
  fetchAndBuildPayload: (id: string, visibility: unknown) =>
    buildMock(id, visibility),
}));

// FactsheetView is a heavy client tree; stub it to a sentinel that ECHOES the
// two lane props so the recipient-mode assertions read what actually flowed in.
vi.mock("@/app/factsheet/[id]/v2/FactsheetView", () => ({
  FactsheetView: ({
    viewerNotice,
    recipientShare,
  }: {
    viewerNotice?: string;
    recipientShare?: boolean;
  }) => (
    <div
      data-testid="factsheet-view"
      data-viewer-notice={String(viewerNotice)}
      data-recipient-share={String(recipientShare)}
    />
  ),
}));

// --- Fixtures --------------------------------------------------------------

const STRATEGY_ID = "11111111-2222-3333-4444-555555555555";
const GENERATION = 3;
/** Derived under the test-setup fixture secret — a genuinely valid token. */
const VALID_TOKEN = deriveShareToken(STRATEGY_ID, GENERATION);

/** A well-formed token that matches no active row. */
const UNKNOWN_TOKEN = deriveShareToken(
  "99999999-8888-7777-6666-555555555555",
  1,
);

async function loadPage() {
  return (await import("./page")).default;
}

async function renderPage(token: string): Promise<string> {
  const Page = await loadPage();
  const el = (await Page({ params: Promise.resolve({ token }) })) as ReactElement;
  return renderToStaticMarkup(el);
}

/** Render and swallow the redirect throw, returning the paths redirected to. */
async function renderExpectingRedirect(token: string): Promise<string[]> {
  const Page = await loadPage();
  await expect(
    Page({ params: Promise.resolve({ token }) }),
  ).rejects.toThrow("__REDIRECT__");
  return redirectMock.mock.calls.map((c) => c[0] as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  checkLimitMock.mockResolvedValue({ success: true });
  sharesReadMock.mockResolvedValue({ data: [], error: null });
  buildMock.mockResolvedValue({ strategyId: "stub" } as never);
});

// ---------------------------------------------------------------------------

describe("recipient render — a valid token shows the factsheet in recipient mode", () => {
  beforeEach(() => {
    sharesReadMock.mockResolvedValue({
      data: [{ strategy_id: STRATEGY_ID, generation: GENERATION }],
      error: null,
    });
  });

  it("renders FactsheetView with the shared-privately notice and recipientShare", async () => {
    const html = await renderPage(VALID_TOKEN);
    expect(html).toContain('data-testid="factsheet-view"');
    expect(html).toContain('data-viewer-notice="shared_privately"');
    expect(html).toContain('data-recipient-share="true"');
  });

  it("calls the SHARED builder with the matched strategy id and an IDENTITY predicate", async () => {
    await renderPage(VALID_TOKEN);
    expect(buildMock).toHaveBeenCalledTimes(1);
    const [id, visibility] = buildMock.mock.calls[0];
    expect(id).toBe(STRATEGY_ID);
    // The predicate is the ONLY visibility gate the service-role builder has.
    // Identity is CORRECT here — the HMAC match already authorized — and the
    // feature only works because of it: a published-only predicate would make
    // every share link 410 for exactly the unpublished strategies this exists
    // for. Prove it is identity by applying it, not by reading its name.
    const probe = { sentinel: true };
    expect((visibility as <Q>(q: Q) => Q)(probe)).toBe(probe);
  });

  it("scans only NON-REVOKED rows — the revoke filter is in the query, not in JS", async () => {
    await renderPage(VALID_TOKEN);
    const [cols, isCol, isVal] = sharesReadMock.mock.calls[0];
    expect(cols).toBe("strategy_id, generation");
    expect(isCol).toBe("revoked_at");
    expect(isVal).toBeNull();
  });

  it("a token for a PREVIOUS generation of the same strategy no longer resolves (revocation works)", async () => {
    // The row says generation 3; the recipient holds a generation-2 link.
    const stale = deriveShareToken(STRATEGY_ID, GENERATION - 1);
    const paths = await renderExpectingRedirect(stale);
    expect(paths).toEqual(["/factsheet-share/gone"]);
    expect(buildMock).not.toHaveBeenCalled();
  });
});

describe("every miss class lands on a genuine 410, never notFound()", () => {
  it("an UNKNOWN but well-formed token redirects to /factsheet-share/gone", async () => {
    sharesReadMock.mockResolvedValue({
      data: [{ strategy_id: STRATEGY_ID, generation: GENERATION }],
      error: null,
    });
    const paths = await renderExpectingRedirect(UNKNOWN_TOKEN);
    expect(paths).toEqual(["/factsheet-share/gone"]);
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(buildMock).not.toHaveBeenCalled();
  });

  it("a REVOKED share (no active rows) redirects to /factsheet-share/gone", async () => {
    sharesReadMock.mockResolvedValue({ data: [], error: null });
    const paths = await renderExpectingRedirect(VALID_TOKEN);
    expect(paths).toEqual(["/factsheet-share/gone"]);
  });

  it("a DB error on the share read redirects to gone and NEVER echoes the error", async () => {
    // error-absent ≠ legit-absent: PostgREST returns {data:null,error} without
    // throwing. The recipient must get the uniform miss, and the schema detail
    // must not reach them.
    sharesReadMock.mockResolvedValue({
      data: null,
      error: { message: 'column "secret_column" does not exist' },
    });
    const paths = await renderExpectingRedirect(VALID_TOKEN);
    expect(paths).toEqual(["/factsheet-share/gone"]);
    expect(buildMock).not.toHaveBeenCalled();
  });

  it("a MALFORMED token redirects WITHOUT ever constructing the admin client", async () => {
    for (const bad of ["", "short", "a".repeat(44), `${"a".repeat(42)}%`]) {
      vi.clearAllMocks();
      const paths = await renderExpectingRedirect(bad);
      expect(paths).toEqual(["/factsheet-share/gone"]);
      // The format guard is the cheap gate: no DB round-trip, no HMAC work.
      expect(createAdminMock).not.toHaveBeenCalled();
      expect(adminFromMock).not.toHaveBeenCalled();
    }
  });
});

describe("rate limiting runs FIRST (the enumeration defence)", () => {
  it("a denied request renders a neutral card — no DB call, no redirect, no 410", async () => {
    checkLimitMock.mockResolvedValue({ success: false });
    const html = await renderPage(VALID_TOKEN);
    // Neutral by design: answering 410 while rate-limited would turn the
    // limiter into a token-existence oracle for anyone willing to be throttled.
    expect(html).toContain("Please try again shortly");
    expect(html).not.toContain("factsheet-view");
    expect(createAdminMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(buildMock).not.toHaveBeenCalled();
  });

  it("the limiter key is namespaced to this lane, so it cannot share a budget with another public route", async () => {
    await renderExpectingRedirect(UNKNOWN_TOKEN);
    expect(checkLimitMock).toHaveBeenCalledWith({}, "factsheet-share:203.0.113.7");
  });
});

describe("a valid token whose payload is not built yet is PENDING, not dead", () => {
  it("renders the pending card rather than redirecting to gone", async () => {
    sharesReadMock.mockResolvedValue({
      data: [{ strategy_id: STRATEGY_ID, generation: GENERATION }],
      error: null,
    });
    buildMock.mockResolvedValue(null);
    const html = await renderPage(VALID_TOKEN);
    expect(html).toContain("isn&#x27;t ready yet");
    expect(redirectMock).not.toHaveBeenCalled();
    // Content-free: the pending state must not name the strategy or leak a
    // metric while the recipient waits.
    expect(html).not.toContain(STRATEGY_ID);
  });
});

/**
 * Strip `//` line comments and `/* *\/` block comments before matching.
 *
 * LOAD-BEARING, not hygiene: `page.tsx`'s own prose is where the reasons live.
 * Its header explains that the module must not import `v2/page.tsx`, must not
 * reach `buildFactsheetPayloadCached`, and must not touch `unstable_cache` — so
 * a bare grep for those tokens would be red on a healthy tree and the only way
 * to green it would be to DELETE the explanations. Same discipline as
 * `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts`.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

describe("SL-1d — the token lane ships no OG image and stays noindex", () => {
  const RAW_SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");
  const SOURCE = stripComments(RAW_SOURCE);

  it("exports STATIC metadata with robots noindex", async () => {
    const mod = await import("./page");
    expect(mod.metadata).toBeDefined();
    expect(mod.metadata.robots).toBe("noindex");
  });

  it("the metadata names no strategy and carries no openGraph / twitter card", async () => {
    const mod = await import("./page");
    // A <title> is fetched by unauthenticated crawlers and cached by third
    // parties. It must be a constant, never the private strategy's name.
    expect(mod.metadata.title).toBe("Factsheet — Quantalyze");
    expect(mod.metadata.openGraph).toBeUndefined();
    expect(mod.metadata.twitter).toBeUndefined();
  });

  it("exports NO generateMetadata (a dynamic title is how the name would leak back in)", async () => {
    const mod = (await import("./page")) as Record<string, unknown>;
    expect(mod.generateMetadata).toBeUndefined();
  });

  it("the source never references the OG image route", () => {
    // Source-level, not module-level, because the hazard is a URL STRING: the
    // OG route is CDN-cached under a 7-day stale-while-revalidate and keyed by
    // URL, so an image of a private strategy could never be revoked. Reading
    // the source catches it wherever in the file it appears.
    expect(SOURCE).not.toContain("/api/og/");
    // Non-vacuity: the file really was read.
    expect(SOURCE).toContain("FactsheetSharePage");
  });

  it("the comment-stripping is load-bearing, so an empty match means CLEAN and not BLIND", () => {
    // Every forbidden token below appears in `page.tsx`'s prose, explaining why
    // it is forbidden. If `stripComments` were ever dropped from the scans, the
    // suite would go red on a healthy tree — which is what makes the green
    // assertions above meaningful rather than accidental.
    for (const token of [
      "v2/page",
      "buildFactsheetPayloadCached",
      "unstable_cache",
    ]) {
      expect(RAW_SOURCE).toContain(token);
      expect(SOURCE).not.toContain(token);
    }
    // …and the stripper did not simply return "" (which would green everything).
    expect(SOURCE.length).toBeGreaterThan(500);
  });

  it("the source imports the CANONICAL builder and never the factsheet page module (SL-1)", () => {
    expect(SOURCE).toContain("@/lib/factsheet/fetch-and-build-payload");
    // Importing the page would put `buildFactsheetPayloadCached` within reach,
    // and the id-keyed cache is exactly what this lane must never touch.
    expect(SOURCE).not.toContain("v2/page");
    expect(SOURCE).not.toContain("buildFactsheetPayloadCached");
    expect(SOURCE).not.toContain("unstable_cache");
  });

  it("the route is pinned force-dynamic on the nodejs runtime", () => {
    // A cached response would be keyed on the URL, not on revocation state —
    // a revoked link could then be replayed from the edge.
    expect(SOURCE).toContain('export const dynamic = "force-dynamic"');
    expect(SOURCE).toContain('export const runtime = "nodejs"');
  });
});

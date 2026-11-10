/**
 * Phase 196 / ROUTE-02 — the /browse header knows who is reading it.
 *
 * WHY. ROUTE-02's "a signed-in user never sees Sign up prompts on /browse" is
 * a promise to the signed-in reader, and these arms are the only thing that can
 * see it break: the layout is a server component and nothing else renders it
 * with a session. The visitor arms pin the other half: a page that is public
 * must not change for someone who is not signed in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthSessionMissingError } from "@supabase/supabase-js";
import { DISCOVERY_LANDING_ROUTE } from "@/lib/routing/default-route";

vi.mock("server-only", () => ({}));

const getUser = vi.hoisted(() => vi.fn());
const captureToSentry = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

const pathname = vi.hoisted(() => ({ value: "/browse" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
}));

import BrowseLayout from "./layout";

async function render(path: string): Promise<string> {
  pathname.value = path;
  return renderToStaticMarkup(
    await BrowseLayout({ children: <div id="page-body" /> }),
  );
}

const SESSION = { data: { user: { id: "u-1" } }, error: null };

beforeEach(() => {
  getUser.mockReset();
  captureToSentry.mockReset();
});

describe("/browse header with a session (ROUTE-02)", () => {
  it("shows Go to Discovery to the same category and no Log in or Sign up", async () => {
    getUser.mockResolvedValue(SESSION);
    const html = await render("/browse/crypto-sma");
    expect(html).toContain("Go to Discovery");
    expect(html).toContain('href="/discovery/crypto-sma"');
    expect(html).not.toContain("Log in");
    expect(html).not.toContain("Sign up");
    expect(html).toContain('id="page-body"');
  });

  it("falls back to the default authenticated route on /browse", async () => {
    getUser.mockResolvedValue(SESSION);
    const html = await render("/browse");
    expect(html).toContain(`href="${DISCOVERY_LANDING_ROUTE}"`);
    expect(html).toContain("Go to Discovery");
  });

  it("falls back to the default route for a slug that is not a category", async () => {
    getUser.mockResolvedValue(SESSION);
    const html = await render("/browse/not-a-category");
    expect(html).toContain(`href="${DISCOVERY_LANDING_ROUTE}"`);
    expect(html).not.toContain("/discovery/not-a-category");
  });
});

describe("/browse header without a session (unchanged for visitors)", () => {
  it("shows Log in and Sign up and no Go to Discovery", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const html = await render("/browse/crypto-sma");
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain("Go to Discovery");
  });

  it("treats a getUser error as no session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
    const html = await render("/browse/crypto-sma");
    expect(html).toContain("Log in");
    expect(html).not.toContain("Go to Discovery");
  });

  it("treats a getUser rejection as no session", async () => {
    getUser.mockRejectedValue(new Error("auth down"));
    const html = await render("/browse/crypto-sma");
    expect(html).toContain("Sign up");
    expect(html).not.toContain("Go to Discovery");
  });

  // SF-01: an auth blip shows an approved signed-in reader the visitor chrome.
  // The direction of the fallback is unchanged; the blip is reported, and the
  // normal anonymous answer is not.
  it("reports a getUser error that is not the anonymous answer, and still shows the visitor chrome", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
    await render("/browse/crypto-sma");
    expect(captureToSentry).toHaveBeenCalledTimes(1);
    expect(captureToSentry.mock.calls[0][1].tags.area).toBe("browse-session");
  });

  it("reports a getUser rejection", async () => {
    getUser.mockRejectedValue(new Error("auth down"));
    await render("/browse/crypto-sma");
    expect(captureToSentry).toHaveBeenCalledTimes(1);
  });

  it("does not report the normal anonymous result (AuthSessionMissingError or a null user)", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    await render("/browse/crypto-sma");
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await render("/browse/crypto-sma");
    expect(captureToSentry).not.toHaveBeenCalled();
  });
});

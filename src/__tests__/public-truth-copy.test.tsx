import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Phase 192 PUBLICTRUTH, plan 03 — render pins for the shared public
 * sentences on Terms, /for-quants and the home page.
 *
 * ORACLE INDEPENDENCE: every expected sentence is typed as a literal in THIS
 * file, never imported from status-surface-copy.ts, so a drift in the constant
 * fails here rather than passing against itself.
 */

// next/link renders a plain anchor so href and className are observable.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// /for-quants mounts <ForQuantsCtas>, a client component that probes the
// browser Supabase session and fires PostHog events; neither matters here.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}));
vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: vi.fn(),
}));

// The home page's anonymous reads: a thenable builder with no rows and no user,
// copied from page.stat-errors.test.tsx. `redirect` throws so a signed-in
// branch would fail loudly instead of rendering nothing.
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.not = () => chain;
      chain.then = (
        onFulfilled: (v: unknown) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve({ count: 0, data: [], error: null }).then(onFulfilled, onRejected);
      return chain;
    },
  }),
}));

import TermsOfServicePage from "@/app/(marketing)/legal/terms/page";
import ForQuantsPage from "@/app/(marketing)/for-quants/page";
import Home from "@/app/(marketing)/page";

const S_KEY =
  "We store your read-only API key encrypted, under a data key of its own, and only our analytics service can decrypt it.";
const S_COST =
  "Listing a strategy is free. A success fee may apply to matched allocations, as set out in the manager agreement.";
// sFOX is off in the suite (NEXT_PUBLIC_SFOX_ENABLED unset), so the venue list
// is the four-venue base list.
const S_EXCH = "Binance, OKX, Bybit, or Deribit";
const KEY_LINK_LABEL = "How we store keys";
const KEY_LINK_HREF = "/security#key-handling";

/** Document text with whitespace collapsed, so JSX line breaks do not matter. */
const pageText = (): string =>
  (document.body.textContent ?? "").replace(/\s+/g, " ");

describe("Terms (D-02, D-05)", () => {
  it("section 2 renders the shared key-storage sentence", () => {
    render(<TermsOfServicePage />);
    expect(pageText()).toContain(S_KEY);
  });

  it("the key sentence is followed by a 'How we store keys' link to /security#key-handling", () => {
    render(<TermsOfServicePage />);
    const link = screen.getByRole("link", { name: "How we store keys" });
    expect(link.getAttribute("href")).toBe("/security#key-handling");
    expect(link.className).toContain("underline");
    expect(pageText()).toContain(`${S_KEY} How we store keys.`);
  });

  it("section 7 renders the shared listing-cost sentence and drops the old fee-structure tail", () => {
    render(<TermsOfServicePage />);
    expect(pageText()).toContain(`The platform is currently free for allocators. ${S_COST}`);
    expect(pageText()).not.toContain(
      "the fee structure is disclosed in individual manager agreements",
    );
  });

  it("the Last updated line carries a date and is no longer the HEAD date", () => {
    render(<TermsOfServicePage />);
    const m = /Last updated: (\d{4}-\d{2}-\d{2})/.exec(pageText());
    expect(m).not.toBeNull();
    expect(m![1]).not.toBe("2026-04-07");
  });
});

describe("/for-quants (D-02, D-04, D-05, D-06)", () => {
  /** The <div> grouping one <dt>/<dd> row, found by its title text. */
  const rowOf = (title: string): HTMLElement => {
    const dt = screen.getByText(title);
    const row = dt.closest("div");
    expect(row, `row for "${title}"`).not.toBeNull();
    return row as HTMLElement;
  };

  it("the 'Envelope encryption at rest' row carries the shared key sentence and its link", () => {
    render(<ForQuantsPage />);
    const row = rowOf("Envelope encryption at rest");
    const text = (row.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain(`${S_KEY} ${KEY_LINK_LABEL}.`);
    const link = row.querySelector("a") as HTMLAnchorElement;
    expect(link.textContent).toBe(KEY_LINK_LABEL);
    expect(link.getAttribute("href")).toBe(KEY_LINK_HREF);
  });

  it("the hero sub-line ends with the shared listing-cost sentence", () => {
    render(<ForQuantsPage />);
    const sub = screen.getByText(/Read-only exchange API keys, codename anonymization/);
    expect((sub.textContent ?? "").replace(/\s+/g, " ")).toBe(
      `Read-only exchange API keys, codename anonymization, founder-routed allocator intros. ${S_COST}`,
    );
  });

  it("step 01 names the exchanges from the flag-aware list", () => {
    render(<ForQuantsPage />);
    expect(pageText()).toContain(
      `${S_EXCH}. We check that the key has no trading or withdrawal permissions before we encrypt and store it.`,
    );
  });

  it("says what a signed-out request returns: a factsheet listed on Browse, codename only (WR-01)", () => {
    // /browse is in PUBLIC_ROUTES and getStrategiesByCategory lists every
    // published strategy to a signed-out visitor, so "by link" understated it.
    render(<ForQuantsPage />);
    const row = rowOf("Public, under your codename");
    expect((row.textContent ?? "").replace(/\s+/g, " ")).toContain(
      "A published factsheet is listed on Browse and opens for anyone, without signing in. It shows your codename, never your firm name.",
    );
    expect(pageText()).not.toContain("Public by link");
    expect(pageText()).not.toContain("who has its link");
    expect(pageText()).toContain(
      "You pick a codename at listing time. A visitor who is not signed in sees the codename, never your firm name.",
    );
    expect(pageText()).toContain(
      "Allocators read the factsheet under your codename. Intro requests are routed through the founder.",
    );
    expect(pageText()).toContain("A visitor who is not signed in never sees your firm name.");
  });

  it("the key-delete row says the credential row goes and the listing stays until archived (CR-01)", () => {
    // strategies.api_key_id is ON DELETE SET NULL; a published strategy can only be archived.
    render(<ForQuantsPage />);
    const row = rowOf("Delete a key");
    expect((row.textContent ?? "").replace(/\s+/g, " ")).toContain(
      "Deleting a key removes its encrypted credential row at once, so the analytics service can no longer use it. Your listing stays until you archive it. A key used by a published composite cannot be deleted: use the contact form to change that composite's keys.",
    );
    const text = pageText();
    expect(text).not.toContain("removes the key and the listing");
    expect(text).not.toContain("same transaction");
    // The database refuses to delete a key a published composite uses
    // (api_keys_published_composite_delete_guard), so "anytime" is false.
    expect(text).not.toContain("Delete a key anytime");
  });

  it("no longer carries the sentences the code or the measurements do not back", () => {
    render(<ForQuantsPage />);
    const text = pageText();
    for (const gone of [
      "qualified allocators only",
      "Retail discovery never sees",
      "Binance, OKX, or Bybit",
      "Supabase Vault",
      "Free to list",
      "accept an intro",
    ]) {
      expect(text, `"${gone}" must be gone`).not.toContain(gone);
    }
  });
});

describe("Home (D-07, D-06, D-02)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  async function renderHome(): Promise<HTMLElement> {
    render(await Home());
    const verify = document.getElementById("verify");
    expect(verify, "section#verify").not.toBeNull();
    return verify as HTMLElement;
  }

  it("section #verify is a sign-up band: heading, venue list, key sentence and one /signup link", async () => {
    const verify = await renderHome();
    expect(verify.querySelector("h2")?.textContent).toBe("Verify your track record");
    const text = (verify.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain(`connect a read-only API key from ${S_EXCH}.`);
    expect(text).toContain(`${S_KEY} ${KEY_LINK_LABEL}.`);
    const keyLink = Array.from(verify.querySelectorAll("a")).find(
      (a) => a.textContent === KEY_LINK_LABEL,
    );
    expect(keyLink?.getAttribute("href")).toBe(KEY_LINK_HREF);
    const signups = Array.from(verify.querySelectorAll('a[href="/signup"]'));
    expect(signups).toHaveLength(1);
    expect(signups[0].textContent).toBe("Create an account");
  });

  it("the 'Create an account' link has the same class string as the 'Get Started' link", async () => {
    const verify = await renderHome();
    const create = verify.querySelector('a[href="/signup"]') as HTMLAnchorElement;
    const getStarted = screen.getByRole("link", { name: "Get Started" });
    expect(create.className).toBe(getStarted.className);
  });

  it("asks an anonymous visitor for no key: no input, textarea or form, and no 'never stored' claim", async () => {
    await renderHome();
    expect(document.querySelectorAll("input, textarea, form")).toHaveLength(0);
    expect(document.body.textContent ?? "").not.toMatch(/never stored/i);
  });

  it("the 'Exchanges supported' stat still reads the flag-aware count (4 with sFOX off)", async () => {
    await renderHome();
    const caption = screen.getByText("Exchanges supported");
    expect(caption.previousElementSibling?.textContent).toBe("4");
    expect(screen.getByText("4 exchanges supported")).toBeInTheDocument();
  });
});

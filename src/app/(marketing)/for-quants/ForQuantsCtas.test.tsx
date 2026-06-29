import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * Regression tests for `<ForQuantsCtas>`.
 *
 * T4 — sessionStorage view-event guard (G9.B.2):
 *   Pre-fix used a module-scope `viewEventFired` boolean that survived
 *   Next.js soft navigation (the module didn't reload), so a user
 *   re-entering /for-quants in the same tab fired ZERO additional view
 *   events for the rest of the session. Post-fix uses sessionStorage
 *   key `for_quants_view_fired_v1`. These tests pin the contract.
 *
 * T5 — auth-probe rejection path (G9.B.10):
 *   `supabase.auth.getSession().then(...).catch(...)` catch arm must
 *   keep the optimistic logged-out CTA. A regression that re-throws
 *   or sets `isLoggedIn=true` on rejection silently breaks the
 *   optimistic-render contract.
 */

// Hoisted mocks so we can swap createClient's implementation per test.
const supabaseState = vi.hoisted(() => ({
  getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: supabaseState.getSession,
    },
  }),
}));

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

// next/link renders a plain anchor in the test env so the href is
// observable via querySelector.
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

import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import { ForQuantsCtas } from "./ForQuantsCtas";

const trackMock = vi.mocked(trackForQuantsEventClient);

const VIEW_EVENT_KEY = "for_quants_view_fired_v1";
// LOGGED_OUT_CTA_HREF is private — pin via the literal so a regression
// that touches the constant (and only the constant) still fails this test.
const LOGGED_OUT_HREF = "/signup?role=manager";

beforeEach(() => {
  trackMock.mockClear();
  window.sessionStorage.clear();
  // Default: logged-out, succeeds. Individual tests override.
  supabaseState.getSession.mockReset();
  supabaseState.getSession.mockResolvedValue({ data: { session: null } });
});

describe("<ForQuantsCtas> view-event sessionStorage guard (G9.B.2)", () => {
  it("first mount fires for_quants_view AND sets the sessionStorage marker", () => {
    render(<ForQuantsCtas location="hero" />);
    const viewCalls = trackMock.mock.calls.filter(
      (c) => c[0] === "for_quants_view",
    );
    expect(viewCalls).toHaveLength(1);
    expect(window.sessionStorage.getItem(VIEW_EVENT_KEY)).not.toBeNull();
  });

  it("re-mount in the same tab (marker pre-set) does NOT re-fire the view event", () => {
    // Simulate a Next.js soft navigation: the user re-entered /for-quants
    // in the same browser tab. sessionStorage persists across the soft nav,
    // so the guard must short-circuit.
    window.sessionStorage.setItem(VIEW_EVENT_KEY, "1");

    render(<ForQuantsCtas location="hero" />);

    const viewCalls = trackMock.mock.calls.filter(
      (c) => c[0] === "for_quants_view",
    );
    expect(viewCalls).toHaveLength(0);
  });

  it("Safari-private-mode: setItem throws, render still succeeds AND the view event fires", () => {
    // In Safari private browsing, sessionStorage.setItem rejects with
    // QuotaExceededError. The fallback path inside
    // `markViewEventFiredThisTab` swallows the throw, so the next line
    // `trackForQuantsEventClient(...)` still runs. Pin both: no exception
    // bubbles AND the event still fires.
    const setItemSpy = vi
      .spyOn(window.sessionStorage.__proto__, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError: storage disabled");
      });

    expect(() => render(<ForQuantsCtas location="hero" />)).not.toThrow();

    const viewCalls = trackMock.mock.calls.filter(
      (c) => c[0] === "for_quants_view",
    );
    expect(viewCalls).toHaveLength(1);

    setItemSpy.mockRestore();
  });
});

describe("<ForQuantsCtas> auth-probe rejection path (G9.B.10)", () => {
  it("getSession() rejection keeps the optimistic logged-out CTA href", async () => {
    supabaseState.getSession.mockRejectedValueOnce(
      new Error("transient supabase outage"),
    );

    let container: HTMLElement;
    expect(() => {
      ({ container } = render(<ForQuantsCtas location="hero" />));
    }).not.toThrow();

    // Let the rejected microtask settle.
    await Promise.resolve();
    await Promise.resolve();

    const primaryCta = container!.querySelector("a[href]") as HTMLAnchorElement;
    expect(primaryCta).not.toBeNull();
    // Optimistic-render contract: href stays at the logged-out path.
    // A regression that re-throws or flips isLoggedIn=true would change
    // this to /strategies/new/wizard.
    expect(primaryCta.getAttribute("href")).toBe(LOGGED_OUT_HREF);
  });

  it("getSession() rejection does not throw out of render", () => {
    supabaseState.getSession.mockRejectedValueOnce(new Error("boom"));
    expect(() => render(<ForQuantsCtas location="hero" />)).not.toThrow();
  });
});

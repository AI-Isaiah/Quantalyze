/** @vitest-environment jsdom */
/**
 * Phase 196 / D-01, D-02, ROUTE-02, ROUTE-04 — the viewer chrome around the
 * public factsheet (`/factsheet/[id]/v2`).
 *
 * WHY this is a pinned contract and not a styling check: which bar a reader
 * gets decides what they can do next (an allocator can add or request an
 * intro, an owner can edit, a visitor is invited to sign up), and the decision
 * is made per request on a page whose PAYLOAD is served from a cache shared by
 * every reader. The cache-isolation arms are what keep one viewer's identity,
 * role or ownership out of a page served to everyone else; the viewer matrix
 * arms are what stop an affordance reaching a role that cannot use it, and a
 * signed-in reader being asked to sign up.
 *
 * Harness: the page runs for real; `./FactsheetView` is replaced by a stub that
 * renders the `beforeFooterSlot` it is handed (the document is not under test,
 * the chrome around it is), and the two client components that talk to the
 * browser (`RequestIntroButton`, `StrategyNoteCard`) are stubs. `BackLink` and
 * the chrome components are real. Every expected string is typed here as a
 * literal, never imported from the components.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AuthSessionMissingError } from "@supabase/supabase-js";
import type { ReactElement, ReactNode } from "react";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
}));
vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
}));
vi.mock("@/lib/visibility", async () => {
  const actual = await vi.importActual<typeof import("@/lib/visibility")>("@/lib/visibility");
  return { ...actual };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({ readPublicVerificationSignals: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUserRolesResult: vi.fn() }));
vi.mock("@/lib/factsheet/fetch-and-build-payload", async () => {
  const actual = await vi.importActual<typeof import("@/lib/factsheet/fetch-and-build-payload")>(
    "@/lib/factsheet/fetch-and-build-payload",
  );
  return { ...actual, fetchAndBuildPayloadWithReason: vi.fn() };
});
vi.mock("./FactsheetView", () => ({
  FactsheetView: (props: { beforeFooterSlot?: ReactNode }) => (
    <article data-testid="factsheet-body">
      {props.beforeFooterSlot}
      <footer data-testid="factsheet-footer" />
    </article>
  ),
  OwnerUnpublishedPanel: () => <div data-testid="owner-panel">Unpublished</div>,
}));
vi.mock("@/components/strategy/RequestIntroButton", () => ({
  RequestIntroButton: ({ strategyId }: { strategyId: string }) => (
    <button type="button" data-strategy={strategyId}>
      Request intro
    </button>
  ),
}));
vi.mock("@/components/notes/StrategyNoteCard", () => ({
  StrategyNoteCard: (props: { strategyId: string; initialContent: string }) => (
    <div data-testid="note-card" data-strategy={props.strategyId}>
      {props.initialContent}
    </div>
  ),
}));

import FactsheetV2Page from "./page";
import { unstable_cache } from "next/cache";
import { captureToSentry } from "@/lib/sentry-capture";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPublicVerificationSignals } from "@/lib/queries";
import { getUserRolesResult } from "@/lib/auth";
import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

// --- Fixtures (synthetic ids only) -------------------------------------------

const STRATEGY_ID = "51a10001-0000-4000-8000-0000000000c5";
const OWNER_UID = "aaaaaaaa-0000-4000-8000-0000000000a1";
const VIEWER_UID = "bbbbbbbb-0000-4000-8000-0000000000b2";

type Result = { data: Record<string, unknown> | null; error: { message: string } | null };

const S = {
  user: null as { id: string } | null,
  /** SF-01: what `getUser()` answers besides the user (error) or instead of it (throws). */
  getUserError: null as Error | null,
  getUserThrows: null as Error | null,
  publishedRow: null as Record<string, unknown> | null,
  ownerRow: null as Record<string, unknown> | null,
  profile: { data: null, error: null } as Result,
  /** CR-01: the accredited-investor attestation row. Default = attested. */
  attestation: { data: { attested_at: "2026-01-01T00:00:00Z" }, error: null } as Result,
  note: { data: null, error: null } as Result,
  buildPayload: true,
  /** Request-client reads and session reads, in INVOCATION order. */
  events: [] as string[],
};

function strategyRow(userId: string, status?: string) {
  return {
    id: STRATEGY_ID,
    user_id: userId,
    name: "Synthetic Strategy",
    codename: null,
    disclosure_tier: "exploratory",
    ...(status ? { status } : {}),
    strategy_analytics: { computed_at: "2026-09-01T00:00:00.000Z" },
  };
}

const allocatorProfile = (over: Record<string, unknown> = {}): Result => ({
  data: { role: "allocator", allocator_status: "verified", manager_status: "newbie", is_admin: false, ...over },
  error: null,
});

function requestClient() {
  return {
    auth: {
      getUser: async () => {
        S.events.push("getUser");
        if (S.getUserThrows) throw S.getUserThrows;
        return { data: { user: S.getUserError ? null : S.user }, error: S.getUserError };
      },
    },
    from: (table: string) => {
      let sawOr = false;
      const chain = {
        select: () => chain,
        eq: () => chain,
        or: () => {
          sawOr = true;
          return chain;
        },
        maybeSingle: () => {
          S.events.push(table);
          if (table === "profiles") return Promise.resolve(S.profile);
          if (table === "investor_attestations") return Promise.resolve(S.attestation);
          if (table === "user_notes") return Promise.resolve(S.note);
          if (table === "strategy_shares") return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: sawOr ? S.ownerRow : S.publishedRow, error: null });
        },
      };
      return chain;
    },
  };
}

const builtPayload = {
  strategyId: STRATEGY_ID,
  strategyName: "Synthetic Strategy",
  description: null,
  trustTier: null,
  ingestSource: "api",
  aum: null,
  maxCapacity: null,
  strategyMetrics: { cagr: 0.1 },
} as unknown as FactsheetPayload;

/** Published strategy owned by OWNER_UID, read by `S.user`. */
function givenPublished(user: { id: string } | null, profile?: Result) {
  S.user = user;
  S.publishedRow = strategyRow(OWNER_UID);
  if (profile) S.profile = profile;
}

/** Unpublished strategy owned by the session user (owner lane). */
function givenOwnerDraft(opts: { payload: boolean }) {
  S.user = { id: OWNER_UID };
  S.publishedRow = null;
  S.ownerRow = strategyRow(OWNER_UID, "draft");
  S.buildPayload = opts.payload;
}

async function renderPage(searchParams?: Record<string, string | string[] | undefined>) {
  const jsx = await FactsheetV2Page({
    params: Promise.resolve({ id: STRATEGY_ID }),
    searchParams: Promise.resolve(searchParams ?? {}),
  });
  return render(jsx as ReactElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  S.user = null;
  S.getUserError = null;
  S.getUserThrows = null;
  S.publishedRow = null;
  S.ownerRow = null;
  S.profile = { data: null, error: null };
  S.attestation = { data: { attested_at: "2026-01-01T00:00:00Z" }, error: null };
  S.note = { data: null, error: null };
  S.buildPayload = true;
  S.events = [];
  vi.mocked(createClient).mockImplementation(async () => requestClient() as never);
  vi.mocked(createAdminClient).mockReturnValue({} as never);
  vi.mocked(readPublicVerificationSignals).mockResolvedValue(new Map() as never);
  vi.mocked(getUserRolesResult).mockResolvedValue({ ok: true, roles: [] } as never);
  vi.mocked(fetchAndBuildPayloadWithReason).mockImplementation((async () =>
    S.buildPayload
      ? { payload: builtPayload, reason: null }
      : { payload: null, reason: "not_computed" }) as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("tracer: a signed-in allocator on a published factsheet", () => {
  it("gets the viewer bar with the back link and Request intro", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());

    await renderPage();

    const bar = screen.getByRole("banner");
    expect(within(bar).getByRole("navigation", { name: "Back" })).toBeTruthy();
    const group = within(bar).getByRole("group", { name: "Actions for this strategy" });
    expect(within(group).getByRole("button", { name: "Request intro" })).toBeTruthy();
  });

  it("names the origin the viewer came from, through the closed origin map", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());

    await renderPage({ from: "discovery", cat: "crypto-sma" });

    const link = within(screen.getByRole("navigation", { name: "Back" })).getByRole("link", {
      name: "Back to Discovery",
    });
    expect(link.getAttribute("href")).toBe("/discovery/crypto-sma");
  });
});

describe("lane order and cache isolation (T-196-10)", () => {
  it("the published probe runs before the session is read, which is read once", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());

    await renderPage();

    expect(S.events[0], "the published probe must come first").toBe("strategies");
    expect(S.events.filter((e) => e === "getUser")).toHaveLength(1);
    expect(S.events.indexOf("getUser")).toBeGreaterThan(0);
  });

  it("nothing about the viewer reaches the cache key, and the cache is invoked once", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());

    await renderPage();

    expect(vi.mocked(unstable_cache)).toHaveBeenCalledTimes(1);
    const keyAndOptions = JSON.stringify(vi.mocked(unstable_cache).mock.calls[0].slice(1));
    expect(keyAndOptions).not.toContain(VIEWER_UID);
    expect(keyAndOptions).not.toContain(OWNER_UID);
    expect(keyAndOptions).not.toMatch(/allocator|owner|viewer/i);
  });
});

// --- Viewer-State Matrix (UI-SPEC) ------------------------------------------

/** The header's actions in DOM order, as `[label, href-or-null]`. */
function actions(): Array<[string, string | null]> {
  const group = screen.queryByRole("group", { name: "Actions for this strategy" });
  if (!group) return [];
  return Array.from(group.querySelectorAll("a, button")).map((el) => [
    (el.textContent ?? "").trim(),
    el.getAttribute("href"),
  ]);
}

const ADD_LINK = ["Add to my allocation", `/allocations?add=${STRATEGY_ID}`] as const;
const INTRO = ["Request intro", null] as const;
const EDIT_LINK = ["Edit strategy", `/strategies/${STRATEGY_ID}/edit`] as const;

describe("signed-in viewer matrix: the back link always, the actions by role", () => {
  it("an approved allocator who is not the owner gets exactly Add to my allocation then Request intro, in that order", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    await renderPage();
    expect(actions()).toEqual([ADD_LINK, INTRO]);
  });

  it("an approved both-role viewer gets the same two", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile({ role: "both", manager_status: "verified" }));
    await renderPage();
    expect(actions()).toEqual([ADD_LINK, INTRO]);
  });

  it.each([
    ["an unapproved allocator", allocatorProfile({ allocator_status: "newbie" })],
    ["a manager-only viewer", allocatorProfile({ role: "manager", manager_status: "verified", allocator_status: "newbie" })],
    ["a viewer whose profile row is missing", { data: null, error: null } as Result],
    ["a viewer whose profile read failed", { data: null, error: { message: "blip" } } as Result],
  ])("%s gets the back link and no actions at all", async (_label, profile) => {
    givenPublished({ id: VIEWER_UID }, profile);
    await renderPage();
    expect(screen.getByRole("navigation", { name: "Back" })).toBeTruthy();
    expect(actions()).toEqual([]);
    expect(screen.queryByRole("group", { name: "Actions for this strategy" })).toBeNull();
  });

  // CR-01: an approved allocator who never signed the accredited-investor
  // attestation was refused by /discovery's layout, and the intro / allocate
  // actions lived only behind it.
  it("an approved allocator with a failed attestation read gets the back link and no actions (no prompt that could re-attest an attested user)", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    S.attestation = { data: null, error: { message: "blip" } };
    await renderPage();
    expect(screen.getByRole("navigation", { name: "Back" })).toBeTruthy();
    expect(actions()).toEqual([]);
    expect(screen.queryByRole("group", { name: "Actions for this strategy" })).toBeNull();
  });

  // 194.2 D-04 / D-07: the unattested allocator is no longer left with no actions and no hint.
  // Request intro shows (it opens the attest step); "Add to my allocation" stays hidden until
  // they attest.
  it.each([
    ["no attestation row", { data: null, error: null } as Result],
    ["a null attested_at", { data: { attested_at: null }, error: null } as Result],
  ])("an approved allocator with %s gets Request intro alone, never Add to my allocation", async (_label, attestation) => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    S.attestation = attestation;
    await renderPage();
    expect(screen.getByRole("navigation", { name: "Back" })).toBeTruthy();
    expect(actions()).toEqual([INTRO]);
    expect(screen.queryByRole("link", { name: "Add to my allocation" })).toBeNull();
  });

  it.each([
    ["an unapproved allocator", allocatorProfile({ allocator_status: "newbie" })],
    ["a manager-only viewer", allocatorProfile({ role: "manager", manager_status: "verified", allocator_status: "newbie" })],
  ])("%s with no attestation row is not offered the attest step", async (_label, profile) => {
    givenPublished({ id: VIEWER_UID }, profile);
    S.attestation = { data: null, error: null };
    await renderPage();
    expect(actions()).toEqual([]);
  });

  it("the owner of a published strategy gets Edit strategy only, never Request intro or Add", async () => {
    givenPublished({ id: OWNER_UID }, allocatorProfile());
    await renderPage();
    expect(actions()).toEqual([EDIT_LINK]);
  });

  it("the owner of an unpublished strategy gets Edit strategy only", async () => {
    givenOwnerDraft({ payload: true });
    await renderPage();
    expect(actions()).toEqual([EDIT_LINK]);
  });

  it("the owner's pending page keeps the bar (back link and Edit strategy) above the unpublished panel", async () => {
    givenOwnerDraft({ payload: false });
    await renderPage();
    expect(actions()).toEqual([EDIT_LINK]);
    expect(screen.getByRole("navigation", { name: "Back" })).toBeTruthy();
    const bar = screen.getByRole("banner");
    const panel = screen.getByTestId("owner-panel");
    expect(bar.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the navigating actions carry the Button class set (a link, never a router-push button)", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    await renderPage();
    const add = screen.getByRole("link", { name: "Add to my allocation" });
    expect(add.className).toMatch(/\bmin-h-\[44px\]/);
    expect(add.className).toMatch(/\bborder-border\b/);
  });
});

describe("a reader with no session (ROUTE-02)", () => {
  it("gets the visitor header: plain-text wordmark, What is Quantalyze? to /, Sign up to /signup, and no viewer bar", async () => {
    givenPublished(null);
    await renderPage();

    const header = screen.getByRole("banner");
    expect(within(header).getByText("Quantalyze").closest("a")).toBeNull();
    expect(within(header).getByRole("link", { name: "What is Quantalyze?" }).getAttribute("href")).toBe("/");
    expect(within(header).getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe("/signup");
    expect(screen.queryByRole("navigation", { name: "Back" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Actions for this strategy" })).toBeNull();
  });

  it("gets the sign-up line immediately before the footer", async () => {
    givenPublished(null);
    await renderPage();

    const line = screen.getByText(/Quantalyze lists quantitative strategies/);
    expect(line.textContent).toContain("to request an introduction to a strategy's manager.");
    const inline = within(line).getByRole("link", { name: "Sign up" });
    expect(inline.getAttribute("href")).toBe("/signup");
    const footer = screen.getByTestId("factsheet-footer");
    expect(line.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reads no note and no profile", async () => {
    givenPublished(null);
    await renderPage();
    expect(S.events).not.toContain("profiles");
    expect(S.events).not.toContain("user_notes");
    expect(screen.queryByTestId("note-card")).toBeNull();
  });
});

// WR-01: a PUBLISHED strategy whose payload is not built yet (or whose public
// read failed) still owes its reader a header: the named way back, the owner's
// Edit strategy, or the visitor header for a reader with no session.
describe("a published factsheet whose payload is pending keeps the chrome", () => {
  it("a signed-in reader who came from Discovery gets the named back link", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    S.buildPayload = false;
    await renderPage({ from: "discovery", cat: "crypto-sma" });

    const link = within(screen.getByRole("navigation", { name: "Back" })).getByRole("link", {
      name: "Back to Discovery",
    });
    expect(link.getAttribute("href")).toBe("/discovery/crypto-sma");
    expect(actions()).toEqual([ADD_LINK, INTRO]);
    expect(screen.queryByTestId("factsheet-body")).toBeNull();
  });

  it("the owner of a published strategy gets Edit strategy", async () => {
    givenPublished({ id: OWNER_UID }, allocatorProfile());
    S.buildPayload = false;
    await renderPage();
    expect(actions()).toEqual([EDIT_LINK]);
  });

  it("a reader with no session gets the visitor header, outside the single main", async () => {
    givenPublished(null);
    S.buildPayload = false;
    await renderPage();

    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe("/signup");
    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(mains[0].contains(header)).toBe(false);
  });

  // M5: the LP report PDF route answers a non-retryable 409 for a pending factsheet and a
  // retryable 503 for any other page without the factsheet article. It tells them apart by
  // this marker, so the pending render carries it and the full render does not.
  it("the pending render carries data-testid=factsheet-pending; the full render does not", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    S.buildPayload = false;
    const pending = await renderPage();
    expect(screen.getAllByTestId("factsheet-pending")).toHaveLength(1);
    pending.unmount();

    S.buildPayload = true;
    await renderPage();
    expect(screen.getByTestId("factsheet-body")).toBeTruthy();
    expect(screen.queryByTestId("factsheet-pending")).toBeNull();
  });

  // R3-01: a failed read renders the same placeholder, but retrying can clear it, so it must
  // not carry the not-built marker that the LP report PDF route turns into a non-retryable 409.
  it("a failed read renders the placeholder without the factsheet-pending marker", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    vi.mocked(fetchAndBuildPayloadWithReason).mockImplementation((async () =>
      ({ payload: null, reason: "read_error" })) as never);
    await renderPage();
    expect(screen.queryByTestId("factsheet-body")).toBeNull();
    expect(screen.queryByTestId("factsheet-pending")).toBeNull();
  });

  it("keeps the lane order: the published probe first, then one session read", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    S.buildPayload = false;
    await renderPage();

    expect(S.events[0], "the published probe must come first").toBe("strategies");
    expect(S.events.filter((e) => e === "getUser")).toHaveLength(1);
    expect(S.events.indexOf("getUser")).toBeGreaterThan(0);
  });
});

// SF-01: a failed session read gives an approved signed-in reader the visitor
// chrome. The direction of that fallback is unchanged (anonymous is the safe
// answer); what changes is that the blip is reported, and the normal anonymous
// answer is not.
describe("a failed session read is reported, and falls back to the visitor chrome", () => {
  /** The harness's unmocked peer-ranks read also captures; count only the session read's. */
  const sessionCaptures = () =>
    vi.mocked(captureToSentry).mock.calls.filter(
      (c) => (c[1] as { tags?: { area?: string } })?.tags?.area === "factsheet-viewer-session",
    );

  it("an auth error that is not the anonymous answer is captured, and the visitor header shows", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    S.getUserError = new Error("auth blip");
    await renderPage();

    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Sign up" })).toBeTruthy();
    expect(sessionCaptures()).toHaveLength(1);
  });

  it("a thrown session read is captured too", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    S.getUserThrows = new Error("auth down");
    await renderPage();

    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Sign up" })).toBeTruthy();
    expect(sessionCaptures()).toHaveLength(1);
  });

  it("the normal anonymous answer (AuthSessionMissingError) is not captured", async () => {
    givenPublished(null);
    S.getUserError = new AuthSessionMissingError();
    await renderPage();

    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Sign up" })).toBeTruthy();
    expect(sessionCaptures()).toHaveLength(0);
  });
});

// SF-01 (round 2): the Lane B owner probe has its own getUser(). A failed read there still
// answers 404 (anonymous is the safe direction) but is reported; the normal no-session answer
// is not. The published probe missing (an unpublished strategy) is what reaches it.
describe("the owner probe's failed session read is reported, and still answers 404", () => {
  const probeCaptures = () =>
    vi.mocked(captureToSentry).mock.calls.filter(
      (c) => (c[1] as { tags?: { stage?: string } })?.tags?.stage === "owner-probe-get-user",
    );

  it("an auth error that is not the anonymous answer is captured, and the page is a 404", async () => {
    S.publishedRow = null;
    S.getUserError = new Error("auth blip");
    await expect(renderPage()).rejects.toThrow(/notFound/);

    expect(probeCaptures()).toHaveLength(1);
    expect(probeCaptures()[0][0]).toBe(S.getUserError);
  });

  it("the normal anonymous answer (AuthSessionMissingError) is not captured", async () => {
    S.publishedRow = null;
    S.getUserError = new AuthSessionMissingError();
    await expect(renderPage()).rejects.toThrow(/notFound/);

    expect(probeCaptures()).toHaveLength(0);
  });

  it("a clean no-session read is not captured", async () => {
    S.publishedRow = null;
    await expect(renderPage()).rejects.toThrow(/notFound/);

    expect(probeCaptures()).toHaveLength(0);
  });
});

describe("a signed-in viewer never sees Sign up on a factsheet route (ROUTE-02)", () => {
  it.each([
    ["an allocator", { id: VIEWER_UID }, allocatorProfile()],
    ["a manager-only viewer", { id: VIEWER_UID }, allocatorProfile({ role: "manager" })],
    ["the owner", { id: OWNER_UID }, allocatorProfile()],
  ])("%s: no Sign up link, no sign-up line, anywhere in the render", async (_label, user, profile) => {
    givenPublished(user, profile);
    const { container } = await renderPage();
    expect(screen.queryByText(/sign up/i)).toBeNull();
    expect(container.querySelector('a[href="/signup"]')).toBeNull();
  });

  it("the owner's pending page shows no Sign up either", async () => {
    givenOwnerDraft({ payload: false });
    const { container } = await renderPage();
    expect(screen.queryByText(/sign up/i)).toBeNull();
    expect(container.querySelector('a[href="/signup"]')).toBeNull();
  });
});

describe("the strategy note card (OQ-6)", () => {
  it("a signed-in viewer on the published lane gets their own note, seeded from their row", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    S.note = { data: { content: "my private note", updated_at: "2026-09-01T00:00:00.000Z" }, error: null };
    await renderPage();
    const card = screen.getByTestId("note-card");
    expect(card.textContent).toBe("my private note");
    expect(card.getAttribute("data-strategy")).toBe(STRATEGY_ID);
    expect(screen.getByTestId("factsheet-footer")).toBeTruthy();
  });

  it("a viewer with no saved note still gets the card, empty, ready to write", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    await renderPage();
    expect(screen.getByTestId("note-card").textContent).toBe("");
  });

  it("a failed note read omits the card: an empty card could be saved over the note the viewer already wrote", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    S.note = { data: null, error: { message: "blip" } };
    await renderPage();
    expect(screen.queryByTestId("note-card")).toBeNull();
  });

  it("the note card is excluded from print", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    await renderPage();
    expect(screen.getByTestId("note-card").closest(".factsheet-v2-no-print")).not.toBeNull();
  });

  it("the owner's unpublished lane reads and shows no note", async () => {
    givenOwnerDraft({ payload: true });
    await renderPage();
    expect(S.events).not.toContain("user_notes");
    expect(screen.queryByTestId("note-card")).toBeNull();
  });
});

describe("an unpublished strategy stays hidden from everyone but its owner (ROUTE-02)", () => {
  it("after the owner has viewed it, an anonymous request still gets not-found", async () => {
    givenOwnerDraft({ payload: true });
    await renderPage();

    // Same strategy, now an anonymous request: no published row, no session.
    S.user = null;
    S.events = [];
    await expect(renderPage()).rejects.toThrow(/notFound/);
    expect(vi.mocked(unstable_cache)).not.toHaveBeenCalled();
    expect(S.events).not.toContain("profiles");
  });
});

// --- Landmarks (LEAN-02, ROUTE-04) ------------------------------------------
//
// WHY: `/factsheet/[id]` re-exports this page WITHOUT `v2/layout.tsx`, so a
// `<main>` that lives in the layout leaves the canonical route with none, and
// axe's `landmark-one-main` fails on the one page crawlers and every reader
// land on. The page renders its own single `<main>` around the document. The
// chrome is a `<header>` banner and must stay OUTSIDE it: inside `main` a
// header stops being a banner, and a screen-reader user loses the landmark to
// jump to the way back.
describe("one main landmark beside the chrome (LEAN-02, ROUTE-04)", () => {
  it("a signed-in allocator on a published factsheet: one main around the article, the bar outside it", async () => {
    givenPublished({ id: VIEWER_UID }, allocatorProfile());
    await renderPage();

    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(within(mains[0]).getByTestId("factsheet-body")).toBeTruthy();
    const bar = screen.getByRole("banner");
    expect(within(bar).getByRole("navigation", { name: "Back" })).toBeTruthy();
    expect(mains[0].contains(bar)).toBe(false);
  });

  it("a reader with no session: one main, the visitor header outside it", async () => {
    givenPublished(null);
    await renderPage();

    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(within(mains[0]).getByTestId("factsheet-body")).toBeTruthy();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Sign up" })).toBeTruthy();
    expect(mains[0].contains(header)).toBe(false);
  });

  it("the owner's pending page: one main around the unpublished panel, the viewer bar outside it", async () => {
    givenOwnerDraft({ payload: false });
    await renderPage();

    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(within(mains[0]).getByTestId("owner-panel")).toBeTruthy();
    const bar = screen.getByRole("banner");
    expect(mains[0].contains(bar)).toBe(false);
  });

  it("the not-found and error boundaries (at factsheet/[id]/, SF-05) and the /v2 loading skeleton keep exactly one main each", async () => {
    const { default: NotFound } = await import("../not-found");
    const { default: ErrorBoundary } = await import("../error");
    const { default: Loading } = await import("./loading");

    for (const ui of [
      <NotFound key="nf" />,
      <ErrorBoundary key="er" error={new Error("boom")} retry={() => {}} reset={() => {}} />,
      <Loading key="lo" />,
    ]) {
      const { unmount } = render(ui);
      expect(screen.getAllByRole("main"), "each state renders its own single main").toHaveLength(1);
      unmount();
    }
  });
});

/** @vitest-environment jsdom */
/**
 * ⭐ Phase 140.5-03 / SEAMPROSE-02 — THE SIXTH `Retry-After` THREAD, AND THE ONE
 * NOBODY HAD NAMED. **This is the exact path phase 141's retry-with-backoff
 * builds on**, which is why it gets its own file rather than a case appended to
 * a sibling suite.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT STOOD HERE BEFORE
 * ═══════════════════════════════════════════════════════════════════════════
 * `handleRetrySync` — the "Retry sync" button inside the interrupted banner —
 * was `if (res.ok && mountedRef.current) { … }` with **no else**. On a non-2xx
 * it therefore:
 *
 *   1. **discarded the `Retry-After`** the route had just stamped, and
 *   2. **rendered no envelope at all** — the amber banner stayed up, the button
 *      re-enabled, and nothing on screen changed.
 *
 * So the ONE surface that honours the advertised wait on its FIRST attempt
 * discarded it on EVERY retry, and a user throttled at 60 s could hammer the
 * button with no feedback and no way to learn why nothing was happening.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE DOES **NOT** PROVE
 * ═══════════════════════════════════════════════════════════════════════════
 *  1. **It adds no retry, and asserts none.** Phase 141 owns retry-with-backoff;
 *     this phase only makes the wait ARRIVE. Nothing below asserts a second
 *     request is issued automatically, because nothing should issue one.
 *  2. **The clear-on-fresh-attempt reset at the top of `handleRetrySync` is NOT
 *     covered here, and it is not reachable today.** The only writer of that
 *     state before this point is the KICKOFF arm, which routes straight to
 *     `gate_failed` and so never shows the banner this button lives in. The
 *     reset is defence for the path 141 adds, and saying it is guarded when it
 *     is not is the exact defect this milestone exists to remove.
 *  3. It is jsdom under fake timers, not a browser.
 */
import { render, screen, act, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncPreviewStep } from "./SyncPreviewStep";
import type { SyncProgressResponse } from "@/lib/sync-progress";

let currentClientFactory: () => unknown = () => ({});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => currentClientFactory(),
}));

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

vi.mock("@/components/connect/KeyPermissionBadge", () => ({
  KeyPermissionBadge: () => null,
}));

/**
 * Freshness probe resolves EMPTY so the mount effect runs the kickoff POST; the
 * status poll returns a non-terminal status so the component stays in
 * `waiting_for_complete`, which is the only phase the retry banner renders in.
 */
function installWaitingMock() {
  currentClientFactory = () => ({
    from: () => ({
      select: (cols: string) => {
        if (cols === "computation_status, computed_at") {
          return {
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          };
        }
        if (cols === "computation_status, computation_error") {
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    computation_status: "computing",
                    computation_error: null,
                  },
                  error: null,
                }),
            }),
          };
        }
        return {
          eq: () => ({
            order: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        };
      },
    }),
  });
}

/** `stalled: true` is what renders the interrupted banner + the Retry button. */
const STALLED_PROGRESS: SyncProgressResponse = {
  jobStatus: "running",
  stalled: true,
  memberProgress: [
    { seq: 1, exchange: "deribit", label: "Key A", status: "successful" },
    { seq: 2, exchange: "bybit", label: null, status: "in_process" },
  ],
};

/**
 * Responses the POST `/api/keys/sync` gives, in order. The FIRST is the kickoff
 * (a 202, so the component reaches the waiting state); each later one answers a
 * Retry-sync click.
 */
let syncPostQueue: Response[] = [];

function kickoffAccepted() {
  return new Response(
    JSON.stringify({
      ok: true,
      accepted: true,
      status: "syncing",
      composite: true,
    }),
    { status: 202 },
  );
}

function denied(
  status: number,
  code: string,
  retryAfter?: string,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (retryAfter !== undefined) headers["Retry-After"] = retryAfter;
  return new Response(JSON.stringify({ ok: false, code }), { status, headers });
}

function installFetchMock() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/keys/sync")) {
        const next = syncPostQueue.shift();
        if (!next) throw new Error("syncPostQueue exhausted — fixture bug");
        return next;
      }
      if (url.includes("/sync-progress")) {
        return new Response(JSON.stringify(STALLED_PROGRESS), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
}

const baseProps = {
  strategyId: "composite-strat-1",
  apiKeyId: "11111111-1111-4111-8111-111111111111",
  wizardSessionId: "session-1",
  onComplete: vi.fn(),
  onTryAnotherKey: vi.fn(),
};

/** Mount, run the kickoff, and let one poll tick surface the stalled banner. */
async function renderStalled() {
  render(<SyncPreviewStep {...baseProps} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function clickRetrySync() {
  const retry = screen.getByTestId("wizard-sync-retry");
  await act(async () => {
    fireEvent.click(retry);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("⭐ [140.5-03 / SEAMPROSE-02] SyncPreviewStep.handleRetrySync — the sixth thread", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    installWaitingMock();
    installFetchMock();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    currentClientFactory = () => ({});
    syncPostQueue = [];
  });

  it("PRECONDITION: the interrupted banner and its Retry control render", async () => {
    // Without this the three cases below would pass vacuously — a button that
    // never renders cannot be clicked into the wrong behaviour.
    syncPostQueue = [kickoffAccepted()];
    await renderStalled();
    expect(screen.getByTestId("wizard-sync-interrupted")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-sync-retry")).toBeInTheDocument();
  });

  it("a 429 retry carrying `Retry-After: 60` RENDERS AN ENVELOPE AND THE WAIT", async () => {
    // ⭐ The whole point. Before this, both halves were lost: the header was
    // discarded and nothing rendered.
    syncPostQueue = [
      kickoffAccepted(),
      denied(429, "RATE_LIMITED", "60"),
    ];
    await renderStalled();
    await clickRetrySync();

    const envelope = screen.getByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "RATE_LIMITED");
    // 60 is the hand-typed literal from the fixture header.
    expect(screen.getByTestId("error-envelope-wait")).toHaveTextContent("60s");
    // The banner it replaced is gone — the user is not left staring at a stale
    // "taking longer than expected" beside a terminal error.
    expect(screen.queryByTestId("wizard-sync-interrupted")).toBeNull();
  });

  it("a 429 retry with NO header renders the envelope and NO wait — absence is not zero", async () => {
    // TRAP-3. Naming a duration nobody advertised turns a vague error into a
    // specific lie, so the wait must be ABSENT rather than defaulted.
    syncPostQueue = [kickoffAccepted(), denied(429, "RATE_LIMITED")];
    await renderStalled();
    await clickRetrySync();

    expect(screen.getByTestId("error-envelope")).toHaveAttribute(
      "data-error-code",
      "RATE_LIMITED",
    );
    expect(screen.queryByTestId("error-envelope-wait")).toBeNull();
  });

  it("a 401 retry renders an envelope — today it silently left the banner up", async () => {
    // The non-throttle arm, and the one that made the old behaviour indefensible
    // rather than merely incomplete: an unrecognised code still has to reach a
    // terminal, ACTIONABLE state. `SYNC_FAILED` is the deliberate fallback — the
    // map does not pretend to be total, because a map that does turns an
    // unfamiliar code into a silent undefined state.
    syncPostQueue = [kickoffAccepted(), denied(401, "Unauthorized")];
    await renderStalled();
    await clickRetrySync();

    const envelope = screen.getByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "SYNC_FAILED");
    expect(screen.queryByTestId("wizard-sync-interrupted")).toBeNull();
  });

  it("classifies through the SAME wire→wizard hop as the first attempt", async () => {
    // One route, one classifier. A second classification path for the identical
    // request would be two answers to one question, and it is how the two
    // vocabularies drift apart. `CIRCUIT_OPEN` is a WIRE code that only the
    // shared table can translate — the roster carries no member for it — so this
    // case fails if the else-branch were given a roster-only lookup.
    syncPostQueue = [kickoffAccepted(), denied(503, "CIRCUIT_OPEN", "30")];
    await renderStalled();
    await clickRetrySync();

    expect(screen.getByTestId("error-envelope")).toHaveAttribute(
      "data-error-code",
      "SERVICE_UNAVAILABLE_RETRY",
    );
    expect(screen.getByTestId("error-envelope-wait")).toHaveTextContent("30s");
  });

  it("POSITIVE CONTROL: a 2xx retry still drops the banner and renders NO envelope", async () => {
    // The behaviour that already worked must survive the new else-branch. A
    // change that routed every retry into `gate_failed` would satisfy every
    // assertion above and destroy the happy path.
    syncPostQueue = [kickoffAccepted(), kickoffAccepted()];
    await renderStalled();
    await clickRetrySync();

    expect(screen.queryByTestId("error-envelope")).toBeNull();
    // The stalled flag is cleared, so the interrupted banner drops.
    expect(screen.queryByTestId("wizard-sync-interrupted")).toBeNull();
  });

  it("the retry POST is the SAME idempotent kickoff shape (no new protocol)", async () => {
    syncPostQueue = [kickoffAccepted(), denied(429, "RATE_LIMITED", "60")];
    await renderStalled();
    const spy = vi.mocked(globalThis.fetch);
    const before = spy.mock.calls.filter((c) =>
      String(c[0]).includes("/api/keys/sync"),
    ).length;
    await clickRetrySync();

    const posts = spy.mock.calls.filter((c) =>
      String(c[0]).includes("/api/keys/sync"),
    );
    // Exactly ONE new request — the else-branch must not add a retry of its own.
    expect(posts.length - before).toBe(1);
    const last = posts[posts.length - 1];
    expect((last[1] as RequestInit).method).toBe("POST");
    expect(String((last[1] as RequestInit).body)).toContain(
      "composite-strat-1",
    );
  });
});

describe("[140.5-03 / SEAMPROSE-03] SyncPreviewStep — the fifth transport catch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installWaitingMock();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    currentClientFactory = () => ({});
    syncPostQueue = [];
  });

  it("a retry that THROWS leaves the banner up and does not invent a terminal state", async () => {
    // The `catch (retryErr)` arm of `handleRetrySync` is deliberately unchanged
    // by 140.5-03: it warns and leaves the banner, which is honest for a request
    // whose outcome is unknown while a run may still be in flight. Recorded as a
    // case so the next reader does not "fix" it into a gate_failed by symmetry
    // with the else-branch above — the else-branch has a RESPONSE and this one
    // does not, which is the whole difference.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/keys/sync")) {
          calls += 1;
          if (calls === 1) return kickoffAccepted();
          throw new Error("offline");
        }
        if (url.includes("/sync-progress")) {
          return new Response(JSON.stringify(STALLED_PROGRESS), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      },
    );

    await renderStalled();
    await clickRetrySync();

    expect(screen.queryByTestId("error-envelope")).toBeNull();
    const banner = screen.getByTestId("wizard-sync-interrupted");
    expect(
      within(banner).getByText(/taking longer than expected/i),
    ).toBeInTheDocument();
    // The button re-enables so the user can try again.
    expect(screen.getByTestId("wizard-sync-retry")).not.toBeDisabled();
    warnSpy.mockRestore();
  });
});

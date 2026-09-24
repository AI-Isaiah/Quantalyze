/** @vitest-environment jsdom */
/**
 * Phase 167.2 / KCS-09 — the OWNER lane of the pending factsheet states what
 * is actually happening to the strategy's computation.
 *
 * The measured trigger: a three-member composite whose `stitch_composite` job
 * had failed permanently, while this page told its owner the factsheet was
 * "still computing". The founder's words are the acceptance test: "It should
 * clearly say what is happening." So TRIGGER-SHAPE below asserts the red
 * permanent-failure line AND the absence of every in-progress phrase.
 *
 * Harness: module mocks, STATE and the request-client pattern are COPIED from
 * page.owner-lane.test.tsx (that file stays unedited, D-04 / SL-1). The one
 * addition is an `rpc` member on THIS file's request mock, which records
 * `[name, args]` and answers from a queued `{ data, error }`. `unstable_cache`
 * stays a SPY so the owner pending render can be proven to reach the shared
 * cache zero times.
 *
 * Every expected string is typed HERE as a literal, never imported from the
 * copy module (oracle independence, the 167 D-11 house convention).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  const actual = await vi.importActual<typeof import("@/lib/visibility")>(
    "@/lib/visibility",
  );
  return { ...actual };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({
  readPublicVerificationSignals: vi.fn(),
}));

import FactsheetV2Page from "./page";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPublicVerificationSignals } from "@/lib/queries";
import { captureToSentry } from "@/lib/sentry-capture";

// --- Fixtures ---------------------------------------------------------------

/** Synthetic ids only (public repo). */
const STRATEGY_ID = "00000000-0000-4000-8000-0000000000a1";
const OWNER_UID = "00000000-0000-4000-8000-0000000000b1";
const STRATEGY_NAME = "Example Composite";

/** The server clock the fixtures are anchored to. */
const NOW_ISO = "2026-09-24T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const minutesAgo = (m: number) => new Date(NOW_MS - m * 60_000).toISOString();

// Locked copy, typed as literals (UI-SPEC § KCS-09).
const FAIL_PERMANENT =
  "The last computation stopped on a problem that retrying alone will not resolve.";
const CONTACT_PERMANENT = "Contact support@quantalyze.com to resolve it.";
const IN_PROGRESS_PHRASES = [
  "still computing",
  "being prepared",
  "being computed",
] as const;

type JobRow = {
  kind: string;
  status: string;
  error_kind?: string | null;
  claimed_at?: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

function job(row: JobRow): JobRow {
  return { error_kind: null, claimed_at: null, metadata: null, ...row };
}

/** The measured trigger shape: the stitch failed permanently, after two
 *  older chain rows that finished. */
const TRIGGER_ROWS: JobRow[] = [
  job({
    kind: "stitch_composite",
    status: "failed_final",
    error_kind: "permanent",
    created_at: minutesAgo(30),
  }),
  job({ kind: "derive_broker_dailies", status: "done", created_at: minutesAgo(90) }),
  job({ kind: "process_key_long", status: "done", created_at: minutesAgo(120) }),
];

// --- Switchable request/admin state -----------------------------------------

const STATE = {
  sessionUser: null as { id: string } | null,
  publishedRow: null as unknown,
  ownerRow: null as unknown,
  adminRow: null as unknown,
  /** The queued answer of the request client's `rpc`. */
  rpcResult: { data: [] as unknown, error: null as unknown },
  /** When true the request client carries NO `rpc` member (a throw). */
  rpcMissing: false,
  observed: {
    rpcCalls: [] as Array<[string, unknown]>,
  },
};

const getUserSpy = vi.fn();

function mockRequestClient() {
  const client: Record<string, unknown> = {
    auth: { getUser: getUserSpy },
    from: () => {
      let sawOr = false;
      const chain = {
        select: () => chain,
        eq: () => chain,
        or: () => {
          sawOr = true;
          return chain;
        },
        maybeSingle: () =>
          Promise.resolve(
            sawOr
              ? { data: STATE.ownerRow, error: null }
              : { data: STATE.publishedRow, error: null },
          ),
      };
      return chain;
    },
  };
  if (!STATE.rpcMissing) {
    client.rpc = (name: string, args: unknown) => {
      STATE.observed.rpcCalls.push([name, args]);
      return Promise.resolve(STATE.rpcResult);
    };
  }
  return client;
}

function mockAdmin(): SupabaseClient {
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      or: () => chain,
      maybeSingle: () =>
        Promise.resolve(
          table === "strategies"
            ? { data: STATE.adminRow, error: null }
            : { data: null, error: null },
        ),
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

/** Owner draft whose admin build yields NO payload → the pending branch. */
function givenOwnerPendingDraft(ownerRowExtra: Record<string, unknown> = {}) {
  STATE.sessionUser = { id: OWNER_UID };
  STATE.publishedRow = null;
  STATE.ownerRow = {
    id: STRATEGY_ID,
    name: STRATEGY_NAME,
    codename: null,
    disclosure_tier: "exploratory",
    status: "draft",
    strategy_analytics: { computed_at: "2026-09-01T00:00:00.000Z" },
    ...ownerRowExtra,
  };
  STATE.adminRow = null;
}

function givenJobs(rows: unknown[]) {
  STATE.rpcResult = { data: rows, error: null };
}

async function renderOwnerPending() {
  const jsx = await FactsheetV2Page({
    params: Promise.resolve({ id: STRATEGY_ID }),
  });
  const { container } = render(jsx as ReactElement);
  const section = container.querySelector(
    'section[aria-label="Computation status"]',
  );
  const paragraphs = section ? Array.from(section.querySelectorAll("p")) : [];
  return {
    container,
    section,
    stateLine: paragraphs[0] ?? null,
    remedyLine: paragraphs[1] ?? null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
  STATE.sessionUser = null;
  STATE.publishedRow = null;
  STATE.ownerRow = null;
  STATE.adminRow = null;
  STATE.rpcResult = { data: [], error: null };
  STATE.rpcMissing = false;
  STATE.observed.rpcCalls = [];

  getUserSpy.mockImplementation(async () => ({
    data: { user: STATE.sessionUser },
    error: null,
  }));
  vi.mocked(createClient).mockImplementation(
    async () => mockRequestClient() as never,
  );
  vi.mocked(createAdminClient).mockImplementation(() => mockAdmin() as never);
  vi.mocked(readPublicVerificationSignals).mockResolvedValue(
    new Map() as never,
  );
});

// ---------------------------------------------------------------------------

describe("KCS-09 — the owner pending page states the trigger shape's real state", () => {
  it("TRIGGER-SHAPE: a permanently failed stitch renders the red permanent line and the support remedy, never an in-progress claim", async () => {
    givenOwnerPendingDraft();
    givenJobs(TRIGGER_ROWS);

    const { container, section, stateLine, remedyLine } =
      await renderOwnerPending();

    expect(section, "the owner pending render must carry the status section").not.toBeNull();
    expect(stateLine!.textContent).toBe(FAIL_PERMANENT);
    expect(stateLine!.className).toContain("text-negative");
    expect(remedyLine!.textContent).toBe(CONTACT_PERMANENT);
    expect(remedyLine!.className).not.toContain("italic");

    const text = container.textContent ?? "";
    for (const phrase of IN_PROGRESS_PHRASES) {
      expect(
        text,
        `a permanently failed computation must never read as "${phrase}"`,
      ).not.toContain(phrase);
    }

    // The read is the owner-scoped RPC over the shared 100-row window.
    expect(STATE.observed.rpcCalls).toEqual([
      ["get_user_compute_jobs", { p_strategy_id: STRATEGY_ID, p_limit: 100 }],
    ]);
    // D-04: the owner pending render never reaches the shared, id-keyed cache.
    expect(vi.mocked(unstable_cache)).toHaveBeenCalledTimes(0);
    expect(vi.mocked(captureToSentry)).not.toHaveBeenCalled();
  });
});

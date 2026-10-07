import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ForQuantsLeadsTable } from "./ForQuantsLeadsTable";
import type { ForQuantsLeadRow } from "@/lib/for-quants-leads-admin";

/**
 * F1 loud-fail discipline — H-0355 / M-0380 (audit-2026-05-07).
 *
 * `toggleProcessed` used a BARE `catch {}` (no binding, no logging). Every
 * underlying failure — JSON-parse errors, aborts, timeouts, CSP violations,
 * genuine network errors — collapsed into one opaque "Network error. Try
 * again." message, and the discarded error never reached the console / logs.
 * The admin had zero diagnostic information and devops had no signal at all.
 *
 * These tests encode the loud-fail intent (CLAUDE.md Rule 9):
 *   (a) a thrown failure is LOGGED via console.error with a stable prefix so
 *       the failure stays observable; and
 *   (b) the surfaced inline error carries the REAL reason (err.message), not
 *       a generic catch-all string.
 * They fail against the pre-fix bare `catch {}` which neither logged nor
 * propagated the underlying message.
 */

const routerRefreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const TEST_LEAD: ForQuantsLeadRow = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Ada Quant",
  firm: "Quant Capital",
  email: "ada@quant.test",
  preferred_time: null,
  notes: null,
  wizard_context: null,
  created_at: "2026-06-01T00:00:00.000Z",
  processed_at: null,
  processed_by: null,
  notify_attempted_at: null,
  notify_succeeded_at: null,
  notify_error: null,
  source: "request_call",
  topic: null,
  reference: null,
};

beforeEach(() => {
  routerRefreshMock.mockClear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<ForQuantsLeadsTable> toggleProcessed — F1 loud-fail (H-0355 / M-0380)", () => {
  it("logs the swallowed error via console.error with a stable prefix when fetch throws", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockRejectedValue(
      new Error("Failed to fetch: ECONNRESET"),
    );

    render(
      <ForQuantsLeadsTable
        leads={[TEST_LEAD]}
        showAll={false}
        hitCap={false}
        fullViewCap={100}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mark processed/i }));

    await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());
    // Stable prefix so the failure is greppable in the console / log drain.
    expect(consoleErrorSpy.mock.calls[0][0]).toContain(
      "[ForQuantsLeadsTable] toggleProcessed failed",
    );
    // The original error must travel with the log, not be discarded.
    const logged = consoleErrorSpy.mock.calls[0][1] as { error?: unknown };
    expect((logged.error as Error)?.message).toBe(
      "Failed to fetch: ECONNRESET",
    );
    // A failed toggle must NOT refresh — the row state is unchanged.
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it("surfaces the real error reason inline instead of a generic 'Network error'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockRejectedValue(
      new Error("Unexpected token < in JSON at position 0"),
    );

    render(
      <ForQuantsLeadsTable
        leads={[TEST_LEAD]}
        showAll={false}
        hitCap={false}
        fullViewCap={100}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mark processed/i }));

    const alert = await screen.findByText(
      /Unexpected token < in JSON at position 0/,
    );
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/Could not save change/i);
  });

  it("still surfaces an inline error on a non-OK response (no false 'all clear')", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );

    render(
      <ForQuantsLeadsTable
        leads={[TEST_LEAD]}
        showAll={false}
        hitCap={false}
        fullViewCap={100}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mark processed/i }));

    expect(
      await screen.findByText(/Could not mark as processed/i),
    ).toBeInTheDocument();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });
});

/**
 * Phase 164.6.6.3.5 DOMAINONE plan 04 (UI-SPEC "Founder CRM visibility"): with
 * Resend unconfigured the CRM is the only place a contact message is read, so
 * each row must say which form wrote it, under which topic, and about what.
 */
describe("<ForQuantsLeadsTable> source, topic and reference (D-02)", () => {
  const CONTACT_LEAD: ForQuantsLeadRow = {
    ...TEST_LEAD,
    id: "33333333-3333-3333-3333-333333333333",
    firm: "",
    source: "contact_form",
    topic: "security",
    reference: "cid-abc-12345 draft 9a2e7c10",
    notes: "I found a way to read another account's keys.",
  };

  function renderRows(leads: ForQuantsLeadRow[]) {
    return render(
      <ForQuantsLeadsTable
        leads={leads}
        showAll={false}
        hitCap={false}
        fullViewCap={100}
      />,
    );
  }

  it("a contact_form row shows `Contact form`, its topic label, its reference in .font-metric, and the message where notes render", () => {
    const { container } = renderRows([CONTACT_LEAD]);
    expect(screen.getByText("Contact form")).toBeInTheDocument();
    // The label, not the stored key.
    const topic = container.querySelector("[data-lead-field='topic']");
    expect(topic).toHaveTextContent("Security report");
    expect(topic?.textContent).not.toMatch(/Topic:\s*security\b/);
    const ref = container.querySelector(".font-metric");
    expect(ref).not.toBeNull();
    expect(ref).toHaveTextContent("cid-abc-12345 draft 9a2e7c10");
    expect(
      screen.getByText("I found a way to read another account's keys."),
    ).toBeInTheDocument();
  });

  it("a request_call row shows `Request a call`; its topic and reference render the em dash", () => {
    const { container } = renderRows([TEST_LEAD]);
    expect(screen.getByText("Request a call")).toBeInTheDocument();
    expect(screen.queryByText("Contact form")).toBeNull();
    const topic = container.querySelector("[data-lead-field='topic']");
    const reference = container.querySelector("[data-lead-field='reference']");
    expect(topic).toHaveTextContent("—");
    expect(reference).toHaveTextContent("—");
  });

  it("an empty reference string on a contact row renders the em dash, not a blank cell", () => {
    const { container } = renderRows([{ ...CONTACT_LEAD, reference: "" }]);
    expect(
      container.querySelector("[data-lead-field='reference']"),
    ).toHaveTextContent("—");
  });

  it("an empty firm renders the em dash, not a blank cell", () => {
    const { container } = renderRows([CONTACT_LEAD]);
    expect(container.querySelector("[data-lead-field='firm']")).toHaveTextContent(
      "—",
    );
  });

  it("a reference containing markup renders as text, never as an element (T-164.6.6.3.5-11)", () => {
    const { container } = renderRows([
      { ...CONTACT_LEAD, reference: "<b>x</b><img src=x onerror=alert(1)>" },
    ]);
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector("[data-lead-field='reference']"),
    ).toHaveTextContent("<b>x</b><img src=x onerror=alert(1)>");
  });

  it("a markup-bearing message renders as text too", () => {
    const { container } = renderRows([
      { ...CONTACT_LEAD, notes: "<script>alert(1)</script>" },
    ]);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });

  it("LEAD_SELECT carries source, topic and reference (a row without them would render every contact message as a bare request-a-call)", () => {
    // LEAD_SELECT is module-private and the module is `server-only`, so pin it
    // from source. Neuter: drop a column from the string and this goes red.
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/for-quants-leads-admin.ts"),
      "utf8",
    );
    const select = /const LEAD_SELECT =\s*"([^"]+)"/.exec(src)?.[1] ?? "";
    for (const col of ["source", "topic", "reference"]) {
      expect(select.split(/,\s*/), `LEAD_SELECT is missing ${col}`).toContain(col);
    }
  });
});

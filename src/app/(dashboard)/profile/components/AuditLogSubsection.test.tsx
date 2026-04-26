/**
 * Phase 11 Plan 06 / S6 / D-05 — AuditLogSubsection component tests.
 *
 * Locked contract:
 *   - Heading: verbatim "Audit log"
 *   - Description: verbatim "Every read, write, and outcome on your account
 *     is logged. Download a CSV of the last 90 days for your records or
 *     compliance review."
 *   - Primary CTA: verbatim "Download CSV (last 90 days)" with aria-label
 *     "Download audit log CSV for the last 90 days"
 *   - Caption: verbatim "Includes: timestamp, action, entity type, entity
 *     reference. ~5–50 KB depending on activity."
 *   - Click → fetches GET /api/me/audit-log/export
 *   - 200 → triggers browser download (Blob URL + anchor.click + revokeObjectURL)
 *   - 401/500 → renders inline error with Retry button (S3 error shape)
 *   - During fetch: button shows loading copy + is disabled
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuditLogSubsection } from "./AuditLogSubsection";

const VERBATIM_HEADING = "Audit log";
const VERBATIM_DESCRIPTION =
  "Every read, write, and outcome on your account is logged. Download a CSV of the last 90 days for your records or compliance review.";
const VERBATIM_CTA = "Download CSV (last 90 days)";
const VERBATIM_CAPTION =
  "Includes: timestamp, action, entity type, entity reference. ~5–50 KB depending on activity.";
const VERBATIM_ARIA = "Download audit log CSV for the last 90 days";

describe("AuditLogSubsection (S6 / D-05)", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockCreateObjectURL: ReturnType<typeof vi.fn>;
  let mockRevokeObjectURL: ReturnType<typeof vi.fn>;
  let anchorClickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    mockFetch = vi.fn();
    mockCreateObjectURL = vi.fn(() => "blob:mock-url");
    mockRevokeObjectURL = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
    URL.createObjectURL = mockCreateObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = mockRevokeObjectURL as unknown as typeof URL.revokeObjectURL;
    anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    anchorClickSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("Test 1 — renders the verbatim 'Audit log' heading", () => {
    render(<AuditLogSubsection />);
    expect(
      screen.getByRole("heading", { name: VERBATIM_HEADING }),
    ).toBeInTheDocument();
  });

  it("Test 2 — renders the verbatim description", () => {
    render(<AuditLogSubsection />);
    expect(screen.getByText(VERBATIM_DESCRIPTION)).toBeInTheDocument();
  });

  it("Test 3 — renders the Download CTA with verbatim copy", () => {
    render(<AuditLogSubsection />);
    expect(
      screen.getByRole("button", { name: /Download audit log CSV/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(VERBATIM_CTA)).toBeInTheDocument();
  });

  it("Test 4 — renders the verbatim caption beneath the button", () => {
    render(<AuditLogSubsection />);
    expect(screen.getByText(VERBATIM_CAPTION)).toBeInTheDocument();
  });

  it("Test 5 — clicking Download fires fetch against /api/me/audit-log/export", async () => {
    mockFetch.mockResolvedValue(
      new Response("a,b,c\n1,2,3\n", {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="quantalyze-audit-log-2026-04-26.csv"',
        },
      }),
    );

    render(<AuditLogSubsection />);
    fireEvent.click(screen.getByRole("button", { name: /Download audit log CSV/ }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/me/audit-log/export",
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  it("Test 6 — while fetch is pending, button shows loading copy + is disabled", async () => {
    let resolveFetch!: (res: Response) => void;
    mockFetch.mockReturnValue(
      new Promise<Response>((res) => {
        resolveFetch = res;
      }),
    );

    render(<AuditLogSubsection />);
    const btn = screen.getByRole("button", { name: /Download audit log CSV/ });
    fireEvent.click(btn);

    // While the fetch is in flight, the button enters a disabled
    // loading-copy state.
    await waitFor(() => {
      expect(btn).toBeDisabled();
    });
    expect(btn.textContent).not.toBe(VERBATIM_CTA);
    // Resolve so afterEach can clean up.
    resolveFetch(new Response("a,b,c\n", { status: 200 }));
  });

  it("Test 7 — on 200 response, browser download trigger fires (Blob URL + anchor.click)", async () => {
    mockFetch.mockResolvedValue(
      new Response("a,b,c\n1,2,3\n", {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="quantalyze-audit-log-2026-04-26.csv"',
        },
      }),
    );

    render(<AuditLogSubsection />);
    fireEvent.click(screen.getByRole("button", { name: /Download audit log CSV/ }));

    await waitFor(() => {
      expect(mockCreateObjectURL).toHaveBeenCalled();
      expect(anchorClickSpy).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    });
  });

  it("Test 8 — on 401, inline error with Retry renders below the button", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<AuditLogSubsection />);
    fireEvent.click(screen.getByRole("button", { name: /Download audit log CSV/ }));

    const errorRegion = await screen.findByRole("alert");
    expect(errorRegion).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("Test 8b — on 500, inline error with Retry renders below the button", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<AuditLogSubsection />);
    fireEvent.click(screen.getByRole("button", { name: /Download audit log CSV/ }));

    const errorRegion = await screen.findByRole("alert");
    expect(errorRegion).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("Test 9 — Download button has the locked aria-label", () => {
    render(<AuditLogSubsection />);
    const btn = screen.getByRole("button", { name: VERBATIM_ARIA });
    expect(btn).toHaveAttribute("aria-label", VERBATIM_ARIA);
  });
});

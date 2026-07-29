/** @vitest-environment jsdom */
/**
 * 140.5-05 / SEAMPROSE-07 + SEAMPROSE-08 — the THREE-WAY `!res.ok` arm on the
 * first of the two CSV wizard clients.
 *
 * ── WHAT THIS FILE EXISTS TO STOP, IN BOTH DIRECTIONS ────────────────────────
 *
 * DIRECTION 1 (DEF-140.4-C, the live-QA symptom). A forwarded upstream failure
 * — `withAuth`'s 401 `{error:"Unauthorized"}`, FastAPI's 403
 * `{"detail":"Forbidden"}`, a nested `service_error` envelope whose code sits at
 * `detail.code` — carries NO top-level `code`, so the old arm defaulted it to
 * `CSV_VALIDATION_FAILED` and rendered *"Validation failed. See per-row
 * breakdown below."* with no breakdown and `correlation_id: —`. Reproduced in a
 * browser on a real founder CSV (qa-report-localhost-2026-07-29, ISSUE-003).
 *
 * DIRECTION 2 (plan-checker B-1, and it is the more dangerous one). The obvious
 * fix — `if (!res.ok) → §4a` — would have been WORSE than the defect. This
 * route emits its OWN caller-fault non-2xx with real top-level codes, so a
 * two-way arm would tell a user who uploaded an 11 MB file *"We couldn't check
 * your file just now. This is on our side, not your data."* — the user's fault
 * rendered as ours, inside the plan written to close that exact class. The
 * NEGATIVE CONTROLS below are the whole point of this file: without them, the
 * §4a branch swallowing the route-vocabulary branch is invisible to the suite
 * and reachable only by a person uploading a file, which is precisely how the
 * original defect survived.
 *
 * DIRECTION 3 (plan-checker B-7). `SEAM_MISCONFIGURED` is in BOTH vocabularies
 * — this route's own emitter AND `SEAM_CODE_TO_WIZARD_CODE`. A hop-FIRST order
 * would route it to the generic table entry, whose copy says *"Nothing was
 * submitted"* and *"The request never left our servers"*. Both are FALSE here:
 * `req.formData()` runs ~50 lines above the limiter deny, so the whole file has
 * already crossed the wire and been buffered. The route's own docblock records
 * this (the WR-07 correction) and authored a corrected sentence. Roster-FIRST
 * is what keeps that sentence on screen.
 *
 * ── THE ARM, IN ITS BINDING ORDER ────────────────────────────────────────────
 *   1. `data.code` ∈ `KNOWN_CSV_VALIDATE_CODES`  → today's `CsvValidationEnvelope`
 *   2. `recogniseSeamErrorCode(seamErrorCode(data)) !== "UNKNOWN"` → shared envelope
 *   3. otherwise (unrecognised OR codeless)      → §4a founder copy
 *
 * `vi.spyOn` + `mockRestore`, never `vi.stubGlobal` (DEF-16-1).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CsvUploadStep } from "./CsvUploadStep";
import { WIZARD_ERROR_COPY } from "@/lib/wizardErrors";
import { _resetWizardCorrelationIdForTests } from "@/lib/wizard/wizard-correlation";

// ---------------------------------------------------------------------------
// Hand-typed literals. These are the REAL sentences the two producers emit,
// transcribed from the route source rather than imported, so the assertion and
// the implementation are independent oracles (Oracle Independence).
// ---------------------------------------------------------------------------

/** `wizardErrors.ts`'s founder-authored §4a title, hand-typed. */
const FOUNDER_TITLE = "We couldn't check your file just now.";
/** …and its cause line, the sentence that must never appear over a caller fault. */
const FOUNDER_CAUSE = "This is on our side, not your data. Nothing was saved.";

/** `csv-validate/route.ts` — the file-size guard's real message. */
const ROUTE_TOO_LARGE = "Maximum file size is 10 MB. Your file is 11.3 MB.";
/** `csv-validate/route.ts` — one of the four `CSV_INVALID_FORMAT` messages. */
const ROUTE_BAD_FMT = "fmt must be one of daily_returns, daily_nav, trades.";
/** `csv-validate/route.ts` — the `rateLimitDenyJson` throttled body. */
const ROUTE_THROTTLED = "Too many requests. Wait a minute and try again.";
/** `csv-validate/route.ts` — the WR-07-CORRECTED misconfigured body. */
const ROUTE_MISCONFIGURED =
  "Our rate limiter is unavailable, so we stopped before checking your file. " +
  "This is a fault on our side, not your data. Nothing was saved and nothing " +
  "was validated — try again in a minute.";

/**
 * The two clauses of the GENERIC `WIZARD_ERROR_COPY.SEAM_MISCONFIGURED` entry
 * that are affirmatively FALSE at this route's emission site. Hand-typed as
 * SUBSTRINGS so the assertion survives a reword of the surrounding sentence but
 * still fires the moment the generic entry reaches this panel.
 */
const FALSE_HERE_NOTHING_SUBMITTED = "Nothing was submitted";
const FALSE_HERE_NEVER_LEFT = "never left our servers";

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** A body that is not JSON at all — `res.json()` throws, `.catch(() => ({}))` fires. */
function nonJsonResponse(status: number): Response {
  return new Response("<!DOCTYPE html><html><body>gateway</body></html>", {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

const CSV_BYTES = "date,daily_return\n2024-01-01,0.01\n";

function mountAndSubmit(): void {
  render(<CsvUploadStep wizardSessionId="s-1" onSuccess={() => {}} />);
  fireEvent.change(screen.getByTestId("csv-strategy-name"), {
    target: { value: "Aurora Capital" },
  });
  const file = new File([CSV_BYTES], "track-record.csv", { type: "text/csv" });
  fireEvent.change(screen.getByTestId("wizard-csv-file-input"), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByTestId("wizard-csv-validate-submit"));
}

/** The panel's full rendered text, whichever of the two panels rendered. */
function panelText(): string {
  const shared = screen.queryByTestId("error-envelope");
  const csv = screen.queryByTestId("wizard-csv-error");
  return `${shared?.textContent ?? ""}\n${csv?.textContent ?? ""}`;
}

describe("[140.5-05] CsvUploadStep — branch 3: the §4a founder copy", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetWizardCorrelationIdForTests();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("a forwarded withAuth 401 renders the §4a copy with a correlation id, ONCE", async () => {
    // The exact body `withAuth` answers with. No top-level `code`, no `detail`
    // — the population RESEARCH §12.1 measured, and the one that used to render
    // "Validation failed. See per-row breakdown below."
    fetchSpy.mockResolvedValue(jsonResponse({ error: "Unauthorized" }, 401));
    mountAndSubmit();

    const panel = await screen.findByTestId("error-envelope");
    expect(
      screen.queryAllByText(FOUNDER_TITLE),
      "the §4a heading must render EXACTLY once — the defect this replaces " +
        "printed its sentence in both the heading and the cause slot",
    ).toHaveLength(1);
    expect(panel.textContent).toContain(FOUNDER_CAUSE);

    // ⭐ The correlation id is HALF the defect: it rendered as `—`, so the one
    // support channel the copy points the user at was empty. Absence of a wire
    // id falls back to the wizard session id, which IS the id the server logged
    // (`wizardFetch` stamps it on the request header).
    expect(panel.textContent).toMatch(/wizard:[0-9a-f-]{36}/);
    expect(panel.textContent).not.toContain("correlation_id: —");

    // The copy must not promise a breakdown that will not render.
    expect(panel.textContent).not.toContain("per-row breakdown");
    expect(screen.queryByTestId("wizard-csv-error")).not.toBeInTheDocument();
  });

  it("a FastAPI 403 `{detail: 'Forbidden'}` reaches the SAME sentence (one message, every status)", async () => {
    // §4a's founder decision, in its own words: the user cannot act differently
    // on a 403 than on a 404. A per-status roster was explicitly rejected.
    fetchSpy.mockResolvedValue(jsonResponse({ detail: "Forbidden" }, 403));
    mountAndSubmit();

    const panel = await screen.findByTestId("error-envelope");
    expect(panel.textContent).toContain(FOUNDER_TITLE);
    expect(panel.textContent).toContain(FOUNDER_CAUSE);
  });

  it("a body that is not JSON at all reaches the §4a copy without crashing", async () => {
    // `res.json()` throws; the arm's `.catch(() => ({}))` yields `{}` — codeless
    // by construction, so branch 3.
    fetchSpy.mockResolvedValue(nonJsonResponse(502));
    mountAndSubmit();

    const panel = await screen.findByTestId("error-envelope");
    expect(panel.textContent).toContain(FOUNDER_TITLE);
  });

  it("a wire code with NO table entry still lands on §4a, not on a cast", async () => {
    // `SEAM_DEGRADED` is a real wire code with no `SEAM_CODE_TO_WIZARD_CODE`
    // row. It must not be cast into the union; it must fall to the fallback.
    fetchSpy.mockResolvedValue(
      jsonResponse({ detail: { code: "SEAM_DEGRADED", detail: "degraded" } }, 503),
    );
    mountAndSubmit();

    const panel = await screen.findByTestId("error-envelope");
    expect(panel.textContent).toContain(FOUNDER_TITLE);
  });
});

describe("[140.5-05] CsvUploadStep — branch 2: the shared wire→wizard hop", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetWizardCorrelationIdForTests();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("a NESTED service_error 429 renders RATE_LIMITED copy WITH the advertised wait", async () => {
    // ⭐ The nested shape is the one the old top-level `data.code` read could
    // never see: the code sits at `detail.code`. `seamErrorCode` reads both.
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          detail: {
            code: "RATE_LIMITED",
            detail: "Too many requests",
            correlation_id: "wizard:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          },
        },
        429,
        { "Retry-After": "30" },
      ),
    );
    mountAndSubmit();

    const panel = await screen.findByTestId("error-envelope");
    expect(panel.textContent).toContain(WIZARD_ERROR_COPY.RATE_LIMITED.title);
    expect(await screen.findByTestId("error-envelope-wait")).toHaveTextContent(
      "30s",
    );
    // The wire's own id wins over the client's session id when one arrives.
    expect(panel.textContent).toContain(
      "wizard:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    );
    expect(panel.textContent).not.toContain(FOUNDER_TITLE);
  });

  it("TRAP-3: a second failure carrying NO header does not inherit the first one's wait", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ detail: { code: "RATE_LIMITED", detail: "slow down" } }, 429, {
        "Retry-After": "30",
      }),
    );
    mountAndSubmit();
    expect(await screen.findByTestId("error-envelope-wait")).toHaveTextContent(
      "30s",
    );

    // Second attempt, same mounted component, no header this time.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ detail: { code: "RATE_LIMITED", detail: "slow down" } }, 429),
    );
    fireEvent.click(screen.getByTestId("wizard-csv-validate-submit"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByTestId("error-envelope-wait"),
        "a wait survived from the PREVIOUS response — the surface is now naming " +
          "a duration nobody advertised (TRAP-3)",
      ).not.toBeInTheDocument(),
    );
  });
});

describe("[140.5-05] ⛔ NEGATIVE CONTROLS — no caller fault is rendered as ours", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetWizardCorrelationIdForTests();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("CSV_FILE_TOO_LARGE (400) keeps the route's own sentence — the 11 MB regression B-1 caught", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "CSV_FILE_TOO_LARGE",
          human_message: ROUTE_TOO_LARGE,
          debug_context: {},
          correlation_id: null,
        },
        400,
      ),
    );
    mountAndSubmit();

    await screen.findByTestId("wizard-csv-error");
    expect(screen.getByText(ROUTE_TOO_LARGE)).toBeInTheDocument();
    expect(
      panelText(),
      "a caller fault rendered the §4a sentence: the user was told an 11 MB " +
        "upload is our fault and not their data. This is the exact regression " +
        "the plan-checker's B-1 caught before it shipped.",
    ).not.toContain(FOUNDER_TITLE);
    expect(panelText()).not.toContain(FOUNDER_CAUSE);
  });

  it("CSV_INVALID_FORMAT (400) keeps the route's own sentence", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "CSV_INVALID_FORMAT",
          human_message: ROUTE_BAD_FMT,
          debug_context: {},
          correlation_id: null,
        },
        400,
      ),
    );
    mountAndSubmit();

    await screen.findByTestId("wizard-csv-error");
    expect(screen.getByText(ROUTE_BAD_FMT)).toBeInTheDocument();
    expect(panelText()).not.toContain(FOUNDER_TITLE);
  });

  it("CSV_RATE_LIMIT (429) renders the ADVERTISED WAIT — the one wait this route stamps", async () => {
    // ⭐ THE EXCLUSION IS THE MECHANISM. `CSV_RATE_LIMIT` is deliberately NOT in
    // `KNOWN_CSV_VALIDATE_CODES`, so it falls past branch 1 and hops through
    // 140.5-02's `["CSV_RATE_LIMIT","RATE_LIMITED"]` row onto the shared
    // envelope — which is the only CSV panel that can render a wait at all
    // (`CsvValidationEnvelope` has no `retry_after_seconds` prop; PATTERNS §5).
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "CSV_RATE_LIMIT",
          human_message: ROUTE_THROTTLED,
          debug_context: {},
          correlation_id: null,
        },
        429,
        { "Retry-After": "30" },
      ),
    );
    mountAndSubmit();

    const panel = await screen.findByTestId("error-envelope");
    expect(panel.textContent).toContain(WIZARD_ERROR_COPY.RATE_LIMITED.title);
    expect(await screen.findByTestId("error-envelope-wait")).toHaveTextContent(
      "30s",
    );
    expect(panelText()).not.toContain(FOUNDER_TITLE);
  });

  it("⭐ SEAM_MISCONFIGURED keeps the route's WR-07-CORRECTED sentence, and the FALSE generic clauses stay out of the DOM", async () => {
    // The B-7 case. Both vocabularies contain this code; roster-first is what
    // decides which copy wins, and the route's is the true one HERE because the
    // file was already buffered by `req.formData()` before the deny.
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "SEAM_MISCONFIGURED",
          human_message: ROUTE_MISCONFIGURED,
          debug_context: {},
          correlation_id: null,
        },
        503,
      ),
    );
    mountAndSubmit();

    await screen.findByTestId("wizard-csv-error");
    expect(screen.getByText(ROUTE_MISCONFIGURED)).toBeInTheDocument();

    const text = panelText();
    expect(
      text,
      "the generic SEAM_MISCONFIGURED copy reached the CSV panel. Its " +
        '"Nothing was submitted" clause is FALSE here — `req.formData()` runs ' +
        "~50 lines above the deny, so the user's whole file crossed the wire " +
        "and was buffered. This is the sentence 140.4-16 / WR-07 removed.",
    ).not.toContain(FALSE_HERE_NOTHING_SUBMITTED);
    expect(text).not.toContain(FALSE_HERE_NEVER_LEFT);
    expect(text).not.toContain(FOUNDER_TITLE);
  });

  it("POSITIVE CONTROL: 200 + ok:false with row errors still renders the per-row path", async () => {
    // Without this, the whole arm is satisfiable by sending everything to §4a.
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          errors: [
            { rule: "not_nullable", row: 4, message: "daily_return is null" },
            { rule: "not_nullable", row: 9, message: "daily_return is null" },
          ],
          correlation_id: "wizard:11111111-2222-4333-8444-555555555555",
        },
        200,
      ),
    );
    mountAndSubmit();

    const panel = await screen.findByTestId("wizard-csv-error");
    expect(panel.textContent).toContain("2 rows failed validation");
    expect(panel.textContent).not.toContain(FOUNDER_TITLE);
    expect(screen.queryByTestId("error-envelope")).not.toBeInTheDocument();
  });
});

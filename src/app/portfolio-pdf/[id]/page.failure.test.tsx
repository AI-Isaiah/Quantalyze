/** @vitest-environment jsdom */
/**
 * 170.1.2 r3 — the PDF routes refuse a non-ok render response, but the render
 * page used to answer HTTP 200 on its own failures: a failed read was ignored
 * and the not-found / unauthorized branches returned a 200 div. The guard never
 * saw them and the user received a PDF reading "Portfolio not found." or an
 * empty report. Each failure must now surface as a thrown error (500) or the
 * Next not-found signal (404).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("@/components/ui/Disclaimer", () => ({
  Disclaimer: () => React.createElement("div"),
}));

const state = vi.hoisted(() => ({
  tokenOk: true,
  portfolio: null as unknown,
  portfolioError: null as { message: string } | null,
  analyticsError: null as { message: string } | null,
  strategiesError: null as { message: string } | null,
}));

vi.mock("@/lib/pdf-render-token", () => ({
  verifyPdfRenderToken: () => state.tokenOk,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.single = () =>
        Promise.resolve({ data: state.portfolio, error: state.portfolioError });
      chain.maybeSingle = () =>
        Promise.resolve({ data: null, error: state.analyticsError });
      chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve(
          table === "portfolio_strategies"
            ? { data: state.strategiesError ? null : [], error: state.strategiesError }
            : { data: null, error: null },
        ).then(onFulfilled);
      return chain;
    },
  }),
}));

import PortfolioPdfPage from "./page";

const ID = "51a10001-0000-4000-8000-0000000000f0";
const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";

function renderPdf() {
  return PortfolioPdfPage({
    params: Promise.resolve({ id: ID }),
    searchParams: Promise.resolve({ renderToken: "stub" }),
  });
}

beforeEach(() => {
  state.tokenOk = true;
  state.portfolio = { id: ID, name: "Alpha Book", description: "" };
  state.portfolioError = null;
  state.analyticsError = null;
  state.strategiesError = null;
});

describe("portfolio PDF render page failures are non-2xx", () => {
  it("throws, naming the read and the portfolio, when the portfolio read errors", async () => {
    state.portfolioError = { message: "boom" };
    await expect(renderPdf()).rejects.toThrow(
      `portfolio read failed for portfolio ${ID}: boom`,
    );
  });

  it("throws, naming the read and the portfolio, when the analytics read errors", async () => {
    state.analyticsError = { message: "boom" };
    await expect(renderPdf()).rejects.toThrow(
      `portfolio analytics read failed for portfolio ${ID}: boom`,
    );
  });

  it("throws, naming the read and the portfolio, when the strategies read errors", async () => {
    state.strategiesError = { message: "boom" };
    await expect(renderPdf()).rejects.toThrow(
      `portfolio strategies read failed for portfolio ${ID}: boom`,
    );
  });

  it("raises the Next not-found signal, not a 200 div, when the portfolio is missing", async () => {
    state.portfolio = null;
    await expect(renderPdf()).rejects.toMatchObject({ digest: NOT_FOUND_DIGEST });
  });

  it("raises the Next not-found signal, not a 200 div, when the render token is invalid", async () => {
    state.tokenOk = false;
    await expect(renderPdf()).rejects.toMatchObject({ digest: NOT_FOUND_DIGEST });
  });
});

/** @vitest-environment jsdom */
/**
 * Phase 164 / SHARE-01 — the Plausible tag must not load on the recipient
 * share lane.
 *
 * WHAT THIS PROTECTS. Plausible posts `location.href` with every event, and
 * under ruling D-01 the share token IS the pathname. If this gate regresses, a
 * recipient opening a private link ships a live capability to a third-party
 * analytics host on page load — silently, with a 200 response and a correctly
 * rendered factsheet. There is no error to notice.
 *
 * ⛔ THE ASSERTIONS ARE ON RENDERED MARKUP, never on the component's source or
 * on a comment. The negative case queries the DOM for ANY script element, not
 * just one with the expected src: a regression that loaded a different
 * Plausible build would otherwise pass.
 *
 * HARNESS NOTE — `next/script` is stubbed to a plain `<script>` so the tag
 * reaches jsdom (Next's real loader needs an App Router runtime). That is a
 * harness detail, not the oracle: the ORACLE is `PLAUSIBLE_SCRIPT_SRC` and the
 * `data-domain` value, both asserted against the DOM the stub produced. The
 * stub cannot manufacture a script element the component chose not to render,
 * which is the only direction that matters here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const pathnameMock = vi.hoisted(() => vi.fn<() => string>());
vi.mock("next/navigation", () => ({ usePathname: pathnameMock }));
vi.mock("next/script", () => ({
  default: (props: Record<string, unknown>) => (
    <script {...(props as Record<string, string>)} />
  ),
}));

import { PlausibleScript, PLAUSIBLE_SCRIPT_SRC } from "./PlausibleScript";

const DOMAIN = "quantalyze.xyz";
/** 43 base64url chars — the shape `deriveShareToken` emits. */
const TOKEN = "Xk3pQ9vLm2Rt7Wb1Yz4Nc6Hs8Jd0Fg5Aq3Ue7Ip9Ov";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("[164 SHARE-01] Plausible is withdrawn on the share lane", () => {
  it.each([
    `/factsheet-share/${TOKEN}`,
    "/factsheet-share/gone",
    "/factsheet-share",
  ])("renders NO script element at all on %j", (pathname) => {
    pathnameMock.mockReturnValue(pathname);

    const { container } = render(<PlausibleScript domain={DOMAIN} />);

    // Any script, not just the Plausible one.
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(container.innerHTML).toBe("");
  });

  it("renders NOTHING when the pathname is unavailable (fail-closed)", () => {
    pathnameMock.mockReturnValue(null as unknown as string);

    const { container } = render(<PlausibleScript domain={DOMAIN} />);

    expect(container.querySelectorAll("script")).toHaveLength(0);
  });
});

describe("[164 SHARE-01] Plausible still loads everywhere else", () => {
  it.each([
    "/",
    "/browse",
    "/factsheet/44444444-4444-4444-8444-444444444444/v2",
    "/scenario-share/abcdef",
    "/factsheet-shareholders",
  ])("emits the tracker script on %j", (pathname) => {
    pathnameMock.mockReturnValue(pathname);

    const { container } = render(<PlausibleScript domain={DOMAIN} />);

    const script = container.querySelector("script");
    expect(script, "the tracker must survive off the share lane").not.toBeNull();
    expect(script!.getAttribute("src")).toBe(PLAUSIBLE_SCRIPT_SRC);
    expect(script!.getAttribute("data-domain")).toBe(DOMAIN);
  });

  it("the tracker src is the tagged-events build on plausible.io", () => {
    // Pinned as a literal, typed here: a silent swap to another host is a new
    // third-party recipient of every pathname on the site.
    expect(PLAUSIBLE_SCRIPT_SRC).toBe(
      "https://plausible.io/js/script.tagged-events.js",
    );
  });
});

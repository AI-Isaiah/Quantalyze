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
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

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

describe("WR-02 — the withdrawal is load-time, so nothing may client-navigate INTO the lane", () => {
  /**
   * ⛔ THE GAP THIS CLOSES. `PlausibleScript` returns null on a share pathname,
   * which keeps the tag out of the SSR HTML and out of the hydrated tree. That
   * is a LOAD-TIME control. It cannot un-run a script that is already on the
   * page: if a user client-navigates from a normal page (tracker loaded) into
   * `/factsheet-share/<token>`, unmounting the `<Script>` does not remove the
   * injected element, and the tracker's own history hook fires a pageview
   * carrying `location.href` — the token.
   *
   * That path is unreachable today because nothing in `src/` links into the
   * lane: recipients arrive by pasting an external URL, which is a full load,
   * and the owner's Copy Link writes to the clipboard rather than navigating.
   * But the component's own docblock refuses to count "no tagged events exist
   * today" as a mitigation, and this is the same shape of argument. So the
   * accident becomes an enforced invariant here.
   *
   * ⚠️ THE REGEX MATCHES NAVIGATION CONSTRUCTS, NOT THE STRING. Six files under
   * `src/` name `/factsheet-share/...` in prose (this suite included). A bare
   * substring scan would be red on arrival and would be silenced by rewording
   * a comment — the failure mode this repo has measured before. `href=` and
   * `router.push(`/`replace(`/`prefetch(` are things a comment does not contain.
   */
  it("no client-side navigation in src/ targets /factsheet-share", () => {
    const CLIENT_NAV =
      /(?:href\s*=\s*|router\.(?:push|replace|prefetch)\s*\(\s*)[`"']\/factsheet-share/;

    const roots = execFileSync(
      "git",
      // --others/--exclude-standard so a NEW, not-yet-committed offender is
      // caught locally too, not only after it has been committed.
      ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
      { encoding: "utf8", cwd: join(__dirname, "..", "..") },
    )
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f));

    // The scan must actually have something to scan — a glob that silently
    // matched zero files is the classic vacuous green.
    expect(roots.length).toBeGreaterThan(100);

    const offenders = roots.filter((f) =>
      CLIENT_NAV.test(readFileSync(join(__dirname, "..", "..", f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("the guard would catch a real in-app link (the regex is not vacuous)", () => {
    const CLIENT_NAV =
      /(?:href\s*=\s*|router\.(?:push|replace|prefetch)\s*\(\s*)[`"']\/factsheet-share/;

    // ⛔ THE CONTROLS ARE ASSEMBLED, NEVER TYPED AS LITERALS. Writing
    // an `href=` attribute pointing at the lane here would make THIS file an
    // offender in
    // the scan above — measured, and it failed exactly that way on first run.
    // Concatenation keeps the matching sequence out of the file's own bytes
    // while still exercising the regex on the string a real caller produces.
    const LANE = "/factsheet" + "-share";

    // Positive controls — each is a way someone would actually write it.
    expect(CLIENT_NAV.test('<Link href="' + LANE + '/abc">open</Link>')).toBe(
      true,
    );
    expect(CLIENT_NAV.test('router.push("' + LANE + '/" + token)')).toBe(true);
    expect(CLIENT_NAV.test("router.replace(`" + LANE + "/${token}`)")).toBe(true);

    // Negative controls — prose must NOT trip it, or the guard becomes a
    // comment-formatting gate that gets silenced by rewording.
    expect(CLIENT_NAV.test(" * the recipient lane is " + LANE + "/[token]")).toBe(
      false,
    );
    expect(
      CLIENT_NAV.test('const SHARE_PATH_PREFIX = "' + LANE + '/";'),
    ).toBe(false);
  });
});

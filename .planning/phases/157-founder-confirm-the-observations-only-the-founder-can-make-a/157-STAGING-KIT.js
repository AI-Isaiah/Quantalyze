// Phase 157 FOUNDER-CONFIRM staging kit.
//
// One-shot observation aid, not product code. Paste it in the DevTools console of a signed-in tab
// (or run it through the browser tool), then call window.__fconf.arm("<mode>") BEFORE clicking the
// wizard entry. A reload removes the wrapper and the marker together.
//
// Literals were read at HEAD 0def03553 (the `version` constant below). Re-read the sources if any
// of them changed since:
//   - create-with-key route: the catch tail `NextResponse.json({ code }, { status, headers })` and
//     the classifier rows that resolve to SEAM_INTERNAL_FAULT (all status 500); headers come from
//     keyRouteFailureHeaders, which returns NO_STORE_HEADERS for a non-breaker error.
//   - NO_STORE_HEADERS is `Cache-Control: private, no-store` (api headers module).
//
// Router: method-aware and fail closed. Every same-origin /api/ call and every /rest/v1/ call is
// answered by a stub row, passed through (explicit GET/HEAD list only) or refused with status 599.
// Anything outside those two prefixes (auth, telemetry, RSC fetches, assets) reaches the original
// fetch untouched. The kit never reads request bodies, request headers or any browser storage.
//
// Modes and rows (this file is extended task by task; the list is the final contract):
//   connect  GET  /api/strategies/wizard-draft          stub 200 no draft
//            POST /api/strategies/create-with-key       stub 500 SEAM_INTERNAL_FAULT
//            GET  /api/strategies/composite/members     stub 200 empty members
//
// no pass-through write exists in any mode
(function () {
  "use strict";

  var VERSION = "head-0def03553";
  var JSON_CT = "application/json";
  var NO_STORE = "private, no-store";
  var MARKER_ID = "fconf-staging-marker";
  var MODES = ["connect"];

  // ---- stub descriptors (a fresh Response is built per call from these) -------------------------

  function noStoreJson(status, body) {
    return {
      status: status,
      body: body,
      headers: { "Content-Type": JSON_CT, "Cache-Control": NO_STORE },
    };
  }

  function plainJson(status, body) {
    return { status: status, body: body, headers: { "Content-Type": JSON_CT } };
  }

  // ---- url handling -----------------------------------------------------------------------------

  function hrefOf(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.href === "string") return input.href;
    if (input && typeof input.url === "string") return input.url;
    return String(input);
  }

  function methodOf(input, init) {
    var m = init && typeof init.method === "string" ? init.method : null;
    if (!m && input && typeof input === "object" && typeof input.method === "string") {
      m = input.method;
    }
    return (m || "GET").toUpperCase();
  }

  function cleanPath(u) {
    return u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
  }

  // ids out of anything that can be logged: uuid-shaped or all-digit path segments become :id, and
  // eq.<value> becomes eq.:id. The query is kept for /rest/v1/ entries only, as the select param.
  var UUID_SEG = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  var DIGIT_SEG = /^[0-9]+$/;

  function scrub(method, urlString) {
    var u = new URL(urlString, location.href);
    var path = cleanPath(u)
      .split("/")
      .map(function (seg) {
        return UUID_SEG.test(seg) || DIGIT_SEG.test(seg) ? ":id" : seg;
      })
      .join("/");
    var out = method.toUpperCase() + " " + path;
    if (path.indexOf("/rest/v1/") === 0) {
      var sel = u.searchParams.get("select");
      if (sel !== null) out += "?select=" + sel;
    }
    return out.replace(/eq\.[^&\s]*/g, "eq.:id");
  }

  // ---- the router ---------------------------------------------------------------------------------

  function refuse(reason) {
    return { kind: "refuse", status: 599, reason: reason };
  }

  function stubFor(method, path, mode) {
    var key = method + " " + path;
    if (mode === "connect") {
      if (key === "GET /api/strategies/wizard-draft") {
        return noStoreJson(200, '{"draft":null,"kind":null}');
      }
      if (key === "POST /api/strategies/create-with-key") {
        return noStoreJson(500, '{"code":"SEAM_INTERNAL_FAULT"}');
      }
      if (key === "GET /api/strategies/composite/members") {
        return plainJson(200, '{"members":[]}');
      }
    }
    return null;
  }

  function passes() {
    return false;
  }

  // decide(method, urlString, mode, envelope) -> { kind: "stub" | "pass" | "refuse" | "outside", ... }
  function decide(method, urlString, mode) {
    var u = new URL(urlString, location.href);
    var path = cleanPath(u);
    var isApi = u.origin === location.origin && path.indexOf("/api/") === 0;
    var isRest = path.indexOf("/rest/v1/") === 0;
    if (!isApi && !isRest) return { kind: "outside" };
    var m = method.toUpperCase();
    var isRead = m === "GET" || m === "HEAD";
    if (mode) {
      var stub = stubFor(m, path, mode);
      if (stub) return { kind: "stub", status: stub.status, stub: stub };
    }
    if (isRest && !isRead) return refuse("rest-non-read");
    if (isApi && !isRead) return refuse("api-non-read");
    if (mode && passes(m, path, isRest)) return { kind: "pass" };
    return refuse("unlisted-read");
  }

  // ---- marker text --------------------------------------------------------------------------------

  function markerText(mode) {
    if (mode === "connect") return "STAGED RESPONSES ACTIVE — FCONF-03 (connect)";
    return "STAGED RESPONSES ACTIVE — FCONF-0x (no mode armed)";
  }

  // ---- test hook (the smoke test sets the flag; the console never does) ---------------------------

  if (globalThis.__FCONF_TEST__ === true) {
    globalThis.__FCONF_ROUTER__ = {
      decide: decide,
      scrub: scrub,
      MODES: MODES,
      ENVELOPES: {},
      MARKER_TEXT: markerText,
    };
  }

  // ---- install ------------------------------------------------------------------------------------

  if (window.__fconf) {
    console.log("[fconf] kit already installed; not wrapping twice");
    return;
  }

  var orig = window.fetch.bind(window);
  var state = { mode: null };
  var hits = [];
  var passed = [];
  var refused = [];

  function marker() {
    var el = document.getElementById(MARKER_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = MARKER_ID;
      el.style.cssText =
        "position:fixed;top:0;left:0;right:0;z-index:99999;padding:6px 12px;" +
        "background:#b00020;color:#fff;font:700 13px/1.4 system-ui,sans-serif;" +
        "text-align:center;pointer-events:none;";
      (document.body || document.documentElement).appendChild(el);
    }
    return el;
  }

  function paint() {
    marker().textContent = markerText(state.mode);
  }

  function respond(d) {
    return new Response(d.body, { status: d.status, headers: d.headers });
  }

  window.fetch = function fconfFetch(input, init) {
    var href;
    var method;
    var verdict;
    try {
      href = new URL(hrefOf(input), location.href).href;
      method = methodOf(input, init);
      verdict = decide(method, href, state.mode);
    } catch (err) {
      // an unparsable url cannot reach the network; let the native fetch reject it itself
      return orig(input, init);
    }
    if (verdict.kind === "outside") return orig(input, init);
    if (verdict.kind === "stub") {
      hits.push(scrub(method, href));
      return Promise.resolve(respond(verdict.stub));
    }
    if (verdict.kind === "pass") {
      passed.push(scrub(method, href));
      return orig(input, init);
    }
    refused.push(scrub(method, href));
    return Promise.resolve(
      new Response('{"code":"FCONF_REFUSED"}', {
        status: 599,
        headers: { "Content-Type": JSON_CT },
      }),
    );
  };

  var ctl = {
    arm: function arm(mode) {
      if (MODES.indexOf(mode) === -1) {
        throw new Error("[fconf] unknown mode: " + String(mode));
      }
      state.mode = mode;
      paint();
    },
    hits: hits,
    passed: passed,
    refused: refused,
    version: VERSION,
  };
  Object.defineProperty(ctl, "mode", {
    get: function () {
      return state.mode;
    },
    enumerable: true,
  });
  window.__fconf = ctl;
  paint();
})();

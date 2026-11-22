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
//   - finalize-wizard route: the three { code, error } literals with their statuses 500, 500, 502,
//     each with NO_STORE_HEADERS.
//   - NO_STORE_HEADERS is `Cache-Control: private, no-store` (api headers module).
//   - SyncPreviewStep and useStrategySyncPoller: the two strategy_analytics select shapes, the
//     HEAD count reads, the sync-progress body (memberProgress must be an array, stalled false) and
//     the amber gate (seriesMayBeMidReDerive with an in-flight jobStatus). The stub rows mirror the
//     AMBER case of SyncPreviewStep.stale-refusal.runtime.test.tsx.
//   - Note: the four-column strategy_analytics select is the interval-mode `.single()` arm, which
//     the wizard ladder does not use. It is stubbed with the same array shape as the two-column one
//     because the plan says so; the wizard never sends it.
//
// Router: method-aware and fail closed. Every same-origin /api/ call and every /rest/v1/ call is
// answered by a stub row, passed through (explicit GET/HEAD list only) or refused with status 599.
// Anything outside those two prefixes (auth, telemetry, RSC fetches, assets) reaches the original
// fetch untouched. Before arm() the stub and pass tables are empty, so everything is refused.
// The kit never reads request bodies, request headers or any browser storage.
//
// Every mode stubs:   POST /api/keys/sync                       200 queued (a resume would otherwise
//                                                               enqueue a real sync on the draft)
// Every mode passes (GET/HEAD only, reads of the founder's own rows):
//   /rest/v1/ tables: strategy_analytics, strategies, api_keys, trades, csv_daily_returns,
//                     strategy_keys, discovery_categories
//   /api/ routes:     strategies/wizard-draft, strategies/<id>/sync-progress,
//                     keys/<id>/permissions (never faked: it is a security verdict),
//                     strategies/composite/members, keys/feeds (read by the preselect connect form)
// Modes:
//   resume   the kickoff stub and the pass list, nothing else (FCONF-01)
//   amber    resume plus: GET sync-progress running; HEAD trades and csv_daily_returns count 0;
//            GET strategy_analytics terminal row (complete_with_warnings) built from the requested
//            columns; GET trades and csv_daily_returns empty (FCONF-02)
//   connect  resume plus: GET wizard-draft no draft; POST create-with-key 500 SEAM_INTERNAL_FAULT;
//            GET composite/members empty (FCONF-03, connect step)
//   submit   resume plus: POST finalize-wizard answered from ONE armed envelope (DRAFT_LOOKUP_FAILED,
//            DRAFT_FINALIZE_FAILED or SEAM_RESPONSE_UNREADABLE), then the arm is consumed; with
//            nothing armed it is refused (FCONF-03, submit step)
// Never stubbed and never passed: DELETE /api/strategies/draft/<id>, every other non-GET/HEAD.
//
// submit-leg-derivation: YES, the submit leg needs no real write: a resumed draft whose analytics row is terminal but older than SYNC_FRESHNESS_WINDOW_MS takes SyncPreviewStep's stale branch, where probeExistingChain either skips the kickoff on the passed-through sync-progress read or the kickoff POST is stubbed, and both enter waiting_for_complete; the ladder poller treats isComputedAnalytics(status) as terminal with no computed_at-after-kickoff test, and onTerminal's single-key arm reaches setPhase passed only if the real trade and csv counts are not both zero and checkStrategyGate passes on the real row, otherwise the walk stops and the script says record and stop.
//
// no pass-through write exists in any mode
(function () {
  "use strict";

  var VERSION = "head-0def03553";
  var JSON_CT = "application/json";
  var NO_STORE = "private, no-store";
  var MARKER_ID = "fconf-staging-marker";
  var MODES = ["resume", "amber", "connect", "submit"];

  // The three finalize-wizard literals, copied from the route. Bodies are the exact JSON the route
  // serialises (no spaces), so a byte comparison against the source holds.
  var ENVELOPES = {
    DRAFT_LOOKUP_FAILED: {
      status: 500,
      body: '{"code":"DRAFT_LOOKUP_FAILED","error":"Could not load draft"}',
    },
    DRAFT_FINALIZE_FAILED: {
      status: 500,
      body: '{"code":"DRAFT_FINALIZE_FAILED","error":"Could not finalize wizard draft"}',
    },
    SEAM_RESPONSE_UNREADABLE: {
      status: 502,
      body: '{"code":"SEAM_RESPONSE_UNREADABLE","error":"Upstream service returned unexpected response"}',
    },
  };

  // ---- stub descriptors (a fresh Response is built per call from these) -------------------------

  function noStoreJson(status, body, consumes) {
    return {
      status: status,
      body: body,
      headers: { "Content-Type": JSON_CT, "Cache-Control": NO_STORE },
      consumes: consumes === true,
    };
  }

  function plainJson(status, body) {
    return { status: status, body: body, headers: { "Content-Type": JSON_CT }, consumes: false };
  }

  // a postgrest-js count read: status 200, no body, the count after the slash of Content-Range
  function emptyCount() {
    return {
      status: 200,
      body: null,
      headers: { "Content-Type": JSON_CT, "Content-Range": "*/0" },
      consumes: false,
    };
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

  // The select param, split on top-level commas (a column such as api_keys(a, b) holds commas of its
  // own) with whitespace removed. searchParams decodes the percent-encoded commas postgrest-js sends.
  function selectCols(u) {
    var raw = u.searchParams.get("select");
    if (raw === null) return [];
    var cols = [];
    var depth = 0;
    var cur = "";
    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        cols.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    return cols
      .map(function (c) {
        return c.replace(/\s+/g, "");
      })
      .filter(Boolean);
  }

  // the key PostgREST returns for a column: the alias before the colon when there is one
  function colKey(col) {
    var i = col.indexOf(":");
    return i > 0 ? col.slice(0, i) : col;
  }

  // ---- stub tables ---------------------------------------------------------------------------------

  var REST_RE = /^\/rest\/v1\/([A-Za-z0-9_]+)$/;
  var SYNC_PROGRESS_RE = /^\/api\/strategies\/[^/]+\/sync-progress$/;

  var PASS_REST = {
    strategy_analytics: true,
    strategies: true,
    api_keys: true,
    trades: true,
    csv_daily_returns: true,
    strategy_keys: true,
    discovery_categories: true,
  };

  var PASS_API = [
    /^\/api\/strategies\/wizard-draft$/,
    SYNC_PROGRESS_RE,
    /^\/api\/keys\/[^/]+\/permissions$/,
    /^\/api\/strategies\/composite\/members$/,
    /^\/api\/keys\/feeds$/,
  ];

  // a terminal analytics row built from the requested columns: only computation_status is set
  function analyticsRow(keys) {
    var row = {};
    keys.forEach(function (k) {
      row[k] = k === "computation_status" ? "complete_with_warnings" : null;
    });
    return row;
  }

  function analyticsStub(u) {
    var keys = selectCols(u).map(colKey);
    var has = function (k) {
      return keys.indexOf(k) !== -1;
    };
    if (keys.length === 2 && has("computation_status") && has("computed_at")) {
      return plainJson(200, "[]");
    }
    if (keys.length === 1 && keys[0] === "data_quality_flags") {
      return plainJson(200, '[{"data_quality_flags":null}]');
    }
    return plainJson(200, JSON.stringify([analyticsRow(keys)]));
  }

  function amberRest(method, table, u) {
    if (table === "strategy_analytics" && method === "GET") return analyticsStub(u);
    if (table === "trades" || table === "csv_daily_returns") {
      if (method === "HEAD") return emptyCount();
      if (method === "GET") return plainJson(200, "[]");
    }
    return null;
  }

  function stubFor(method, path, u, mode, envelope) {
    var key = method + " " + path;
    if (key === "POST /api/keys/sync") return plainJson(200, '{"ok":true,"queued":true}');
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
    if (mode === "submit" && envelope && key === "POST /api/strategies/finalize-wizard") {
      return noStoreJson(ENVELOPES[envelope].status, ENVELOPES[envelope].body, true);
    }
    if (mode === "amber") {
      if (method === "GET" && SYNC_PROGRESS_RE.test(path)) {
        return plainJson(
          200,
          '{"jobStatus":"running","stalled":false,"memberProgress":[],"degraded":false}',
        );
      }
      var restHit = REST_RE.exec(path);
      if (restHit) return amberRest(method, restHit[1], u);
    }
    return null;
  }

  // reads only: a write never reaches this function (decide refuses it first)
  function passes(path) {
    var restHit = REST_RE.exec(path);
    if (restHit) return PASS_REST[restHit[1]] === true;
    return PASS_API.some(function (re) {
      return re.test(path);
    });
  }

  // ---- the router ---------------------------------------------------------------------------------

  function refuse(reason) {
    return { kind: "refuse", status: 599, reason: reason };
  }

  // decide(method, urlString, mode, envelope) -> { kind: "stub" | "pass" | "refuse" | "outside", ... }
  function decide(method, urlString, mode, envelope) {
    var u = new URL(urlString, location.href);
    var path = cleanPath(u);
    var isApi = u.origin === location.origin && path.indexOf("/api/") === 0;
    var isRest = path.indexOf("/rest/v1/") === 0;
    if (!isApi && !isRest) return { kind: "outside" };
    var m = method.toUpperCase();
    var isRead = m === "GET" || m === "HEAD";
    if (mode) {
      var stub = stubFor(m, path, u, mode, envelope);
      if (stub) return { kind: "stub", status: stub.status, stub: stub };
    }
    if (isRest && !isRead) return refuse("rest-non-read");
    if (isApi && !isRead) return refuse("api-non-read");
    if (mode && passes(path)) return { kind: "pass" };
    return refuse("unlisted-read");
  }

  // ---- marker text --------------------------------------------------------------------------------

  function markerText(mode, envelope) {
    if (mode === "resume") return "STAGED RESPONSES ACTIVE — FCONF-01";
    if (mode === "amber") return "STAGED RESPONSES ACTIVE — FCONF-02";
    if (mode === "connect") return "STAGED RESPONSES ACTIVE — FCONF-03 (connect)";
    if (mode === "submit") {
      return "STAGED RESPONSES ACTIVE — FCONF-03 (submit: " + (envelope || "not armed") + ")";
    }
    return "STAGED RESPONSES ACTIVE — FCONF-0x (no mode armed)";
  }

  // ---- test hook (the smoke test sets the flag; the console never does) ---------------------------

  if (globalThis.__FCONF_TEST__ === true) {
    globalThis.__FCONF_ROUTER__ = {
      decide: decide,
      scrub: scrub,
      MODES: MODES,
      ENVELOPES: ENVELOPES,
      MARKER_TEXT: markerText,
    };
  }

  // ---- install ------------------------------------------------------------------------------------

  if (window.__fconf) {
    console.log("[fconf] kit already installed; not wrapping twice");
    return;
  }

  var orig = window.fetch.bind(window);
  var state = { mode: null, envelope: null };
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
    marker().textContent = markerText(state.mode, state.envelope);
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
      verdict = decide(method, href, state.mode, state.envelope);
    } catch (err) {
      // an unparsable url cannot reach the network; let the native fetch reject it itself
      return orig(input, init);
    }
    if (verdict.kind === "outside") return orig(input, init);
    if (verdict.kind === "stub") {
      hits.push(scrub(method, href));
      if (verdict.stub.consumes) {
        state.envelope = null;
        paint();
      }
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
    arm: function arm(mode, envelopeCode) {
      if (MODES.indexOf(mode) === -1) {
        throw new Error("[fconf] unknown mode: " + String(mode));
      }
      if (envelopeCode !== undefined && envelopeCode !== null) {
        if (!Object.prototype.hasOwnProperty.call(ENVELOPES, envelopeCode)) {
          throw new Error("[fconf] unknown envelope code: " + String(envelopeCode));
        }
        if (mode !== "submit") {
          throw new Error("[fconf] only the submit mode takes an envelope code");
        }
      }
      state.mode = mode;
      state.envelope = envelopeCode || null;
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

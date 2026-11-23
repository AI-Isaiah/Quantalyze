// Smoke test for 157-STAGING-KIT.js. It evaluates the REAL kit file (never a copy of the router)
// against a fake window, document and location, with a spy standing in for the native fetch.
// Run: node --test 157-STAGING-KIT.smoke.mjs   (Node built-ins only, no network)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const KIT_PATH = new URL("./157-STAGING-KIT.js", import.meta.url);
const KIT_SRC = readFileSync(KIT_PATH, "utf8");

const ORIGIN = "https://app.example.test";
const APP = (p) => `${ORIGIN}${p}`;
// A uuid-shaped id built at runtime from a repeated character, so no id literal sits in this file.
const ID = ["a".repeat(8), "b".repeat(4), "c".repeat(4), "d".repeat(4), "e".repeat(12)].join("-");

// Fresh context per test: its own fake window, spy, document and kit evaluation.
function makeEnv() {
  const spyCalls = [];
  const elements = new Map();
  const window = {
    fetch: async (input, init) => {
      spyCalls.push({ input, init });
      return new Response('{"spy":true}', { status: 200 });
    },
  };
  const document = {
    createElement: () => ({ id: "", textContent: "", style: {} }),
    body: { appendChild: (el) => elements.set(el.id, el) },
    getElementById: (id) => elements.get(id) ?? null,
  };
  const location = { origin: ORIGIN, href: `${ORIGIN}/strategies` };
  const context = vm.createContext({
    window,
    document,
    location,
    URL,
    Request,
    Response,
    Headers,
    console: { log() {}, warn() {}, error() {} },
    __FCONF_TEST__: true,
  });
  const load = () => vm.runInContext(KIT_SRC, context, { filename: "157-STAGING-KIT.js" });
  load();
  return {
    window,
    spyCalls,
    elements,
    load,
    router: context.__FCONF_ROUTER__,
    fconf: () => window.__fconf,
    marker: () => elements.get("fconf-staging-marker"),
    call: (input, init) => window.fetch(input, init),
  };
}

const post = (path) => new Request(APP(path), { method: "POST" });

// ---- tracer cases: connect mode, fail closed, passthrough boundaries ----------------------------

test("(a) connect: create-with-key POST is answered with the SEAM_INTERNAL_FAULT stub, never sent", async () => {
  const env = makeEnv();
  env.fconf().arm("connect");
  const res = await env.call(post("/api/strategies/create-with-key"));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { code: "SEAM_INTERNAL_FAULT" });
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("retry-after"), null);
  assert.equal(env.spyCalls.length, 0);
});

test("(b) connect: wizard-draft read is answered with no draft", async () => {
  const env = makeEnv();
  env.fconf().arm("connect");
  const res = await env.call(APP("/api/strategies/wizard-draft"), { headers: { Accept: "application/json" } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { draft: null, kind: null });
  assert.equal(env.spyCalls.length, 0);
});

test("(c) connect: a draft DELETE is refused with 599, logged with the id scrubbed, never sent", async () => {
  const env = makeEnv();
  env.fconf().arm("connect");
  const res = await env.call(new Request(APP(`/api/strategies/draft/${ID}`), { method: "DELETE" }));
  assert.equal(res.status, 599);
  assert.deepEqual([...env.fconf().refused], ["DELETE /api/strategies/draft/:id"]);
  assert.equal(env.spyCalls.length, 0);
});

test("(d) only the auth token refresh reaches the native fetch exactly once; every other /auth/v1/ write is refused", async () => {
  const env = makeEnv();
  env.fconf().arm("connect");
  const res = await env.call("https://proj.supabase.example/auth/v1/token?grant_type=refresh_token", { method: "POST" });
  assert.equal(res.status, 200);
  assert.equal(env.spyCalls.length, 1);
  assert.deepEqual([...env.fconf().passed], ["POST /auth/v1/token"]);
  for (const [method, path] of [["PUT", "/auth/v1/user"], ["POST", "/auth/v1/logout"], ["POST", "/auth/v1/signup"]]) {
    const refused = await env.call(`https://proj.supabase.example${path}`, { method });
    assert.equal(refused.status, 599, `${method} ${path}`);
  }
  assert.equal(env.spyCalls.length, 1);
});

test("(e) a cross-origin telemetry POST reaches the native fetch and is logged in outside", async () => {
  const env = makeEnv();
  env.fconf().arm("connect");
  const res = await env.call("https://telemetry.example.test/capture/", { method: "POST" });
  assert.equal(res.status, 200);
  assert.equal(env.spyCalls.length, 1);
  assert.deepEqual([...env.fconf().outside], ["POST /capture"]);
  assert.deepEqual([...env.fconf().refused], []);
});

test("an outside GET reaches the native fetch and is not logged in outside", async () => {
  const env = makeEnv();
  env.fconf().arm("connect");
  await env.call("https://telemetry.example.test/decide/", { method: "GET" });
  await env.call(APP("/strategies/new/wizard?_rsc=abc"));
  assert.equal(env.spyCalls.length, 2);
  assert.deepEqual([...env.fconf().outside], []);
});

test("every mode refuses a same-origin write outside /api/ and a backend write on functions, storage or graphql, never sent", async () => {
  const SUPA = "https://proj.supabase.example";
  const targets = [
    [APP("/strategies/new/wizard"), "POST"],
    [APP("/strategies"), "PUT"],
    [`${SUPA}/functions/v1/anything`, "POST"],
    [`${SUPA}/storage/v1/object/bucket/x`, "POST"],
    [`${SUPA}/graphql/v1`, "POST"],
    ["https://elsewhere.example.test/storage/v1/object/x", "DELETE"],
  ];
  for (const mode of ALL_MODES) {
    const env = makeEnv();
    env.fconf().arm(mode);
    for (const [url, method] of targets) {
      assert.equal((await env.call(url, { method })).status, 599, `${mode} ${method} ${url}`);
    }
    assert.equal(env.spyCalls.length, 0, mode);
    assert.equal(env.fconf().refused.length, targets.length, mode);
    assert.deepEqual([...env.fconf().outside], [], mode);
  }
});

test("(f) before any arm, a same-origin /api/ GET is refused (fail closed with no mode)", async () => {
  const env = makeEnv();
  const res = await env.call(APP("/api/anything/at/all"));
  assert.equal(res.status, 599);
  assert.equal(env.spyCalls.length, 0);
  assert.deepEqual([...env.fconf().refused], ["GET /api/anything/at/all"]);
});

test("(g) the marker text names connect mode after arm", () => {
  const env = makeEnv();
  assert.equal(env.marker().textContent, "STAGED RESPONSES ACTIVE — FCONF-0x (no mode armed)");
  env.fconf().arm("connect");
  assert.equal(env.marker().textContent, "STAGED RESPONSES ACTIVE — FCONF-03 (connect)");
});

test("(h) method normalisation: Request, (string, init) and (URL, init) all yield the stub", async () => {
  const env = makeEnv();
  env.fconf().arm("connect");
  const path = "/api/strategies/create-with-key";
  const forms = [
    [post(path), undefined],
    [APP(path), { method: "POST" }],
    [new URL(APP(path)), { method: "POST" }],
  ];
  for (const [input, init] of forms) {
    const res = await env.call(input, init);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { code: "SEAM_INTERNAL_FAULT" });
  }
  assert.equal(env.spyCalls.length, 0);
});

test("(i) a second evaluation leaves window.fetch the same function (no double wrap)", () => {
  const env = makeEnv();
  const wrapped = env.window.fetch;
  env.load();
  assert.equal(env.window.fetch, wrapped);
});

test("arm rejects an unknown mode by message and leaves the mode unchanged", () => {
  const env = makeEnv();
  assert.throws(() => env.fconf().arm("bogus"), /unknown mode/);
  assert.equal(env.fconf().mode, null);
});

// ---- Task 2: resume, amber and submit modes ----------------------------------------------------

const ALL_MODES = ["resume", "amber", "connect", "submit"];
const REST = "https://proj.supabase.example/rest/v1";
// postgrest-js percent-encodes the commas of a select; both forms must match.
const sel = (cols, encoded) => (encoded ? cols.replaceAll(",", "%2C") : cols);
const analytics = (cols, encoded = true, method = "GET") =>
  new Request(`${REST}/strategy_analytics?select=${sel(cols, encoded)}&strategy_id=eq.${ID}`, { method });
const head = (table, col) =>
  new Request(`${REST}/${table}?select=${col}&strategy_id=eq.${ID}`, { method: "HEAD" });
// postgrest-js's count rule for a head request: the number after the slash of Content-Range.
const countOf = (res) => parseInt(res.headers.get("content-range").split("/")[1], 10);

const ENVELOPE_CASES = [
  ["DRAFT_LOOKUP_FAILED", 500, { code: "DRAFT_LOOKUP_FAILED", error: "Could not load draft" }],
  ["DRAFT_FINALIZE_FAILED", 500, { code: "DRAFT_FINALIZE_FAILED", error: "Could not finalize wizard draft" }],
  [
    "SEAM_RESPONSE_UNREADABLE",
    502,
    { code: "SEAM_RESPONSE_UNREADABLE", error: "Upstream service returned unexpected response" },
  ],
];

for (const [code, status, body] of ENVELOPE_CASES) {
  test(`submit: ${code} envelope is ${status} and byte-equal to the route literal`, async () => {
    const env = makeEnv();
    env.fconf().arm("submit", code);
    const res = await env.call(post("/api/strategies/finalize-wizard"));
    assert.equal(res.status, status);
    assert.deepEqual(await res.json(), body);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(res.headers.get("retry-after"), null);
    assert.equal(env.spyCalls.length, 0);
  });
}

test("submit: the armed envelope is one-shot, a second finalize is refused and never sent", async () => {
  const env = makeEnv();
  env.fconf().arm("submit", "DRAFT_LOOKUP_FAILED");
  const first = await env.call(post("/api/strategies/finalize-wizard"));
  assert.equal(first.status, 500);
  const second = await env.call(post("/api/strategies/finalize-wizard"));
  assert.equal(second.status, 599);
  assert.deepEqual([...env.fconf().refused], ["POST /api/strategies/finalize-wizard"]);
  assert.equal(env.spyCalls.length, 0);
});

test("submit: finalize with no armed envelope is refused, never passed through", async () => {
  const env = makeEnv();
  env.fconf().arm("submit");
  const res = await env.call(post("/api/strategies/finalize-wizard"));
  assert.equal(res.status, 599);
  assert.equal(env.spyCalls.length, 0);
});

test("finalize is refused in every other mode and before any arm", async () => {
  for (const mode of [null, "resume", "amber", "connect"]) {
    const env = makeEnv();
    if (mode) env.fconf().arm(mode);
    const res = await env.call(post("/api/strategies/finalize-wizard"));
    assert.equal(res.status, 599, `mode ${mode}`);
    assert.equal(env.spyCalls.length, 0, `mode ${mode}`);
  }
});

test("arm with an unknown envelope code throws by message and leaves the armed state alone", async () => {
  const env = makeEnv();
  env.fconf().arm("submit", "DRAFT_FINALIZE_FAILED");
  assert.throws(() => env.fconf().arm("submit", "BOGUS"), /unknown envelope/);
  assert.equal(env.fconf().mode, "submit");
  const res = await env.call(post("/api/strategies/finalize-wizard"));
  assert.equal(res.status, 500);
  assert.equal((await res.json()).code, "DRAFT_FINALIZE_FAILED");
});

test("an unknown envelope on a mode that has none is rejected and the previous mode survives", () => {
  const env = makeEnv();
  env.fconf().arm("connect");
  assert.throws(() => env.fconf().arm("submit", "BOGUS"), /unknown envelope/);
  assert.throws(() => env.fconf().arm("amber", "DRAFT_LOOKUP_FAILED"), /only the submit mode/);
  assert.equal(env.fconf().mode, "connect");
});

test("the kickoff POST is answered with a queued stub in every mode, never sent", async () => {
  for (const mode of ALL_MODES) {
    const env = makeEnv();
    env.fconf().arm(mode);
    const res = await env.call(post("/api/keys/sync"));
    assert.equal(res.status, 200, mode);
    assert.deepEqual(await res.json(), { ok: true, queued: true }, mode);
    assert.equal(env.spyCalls.length, 0, mode);
  }
});

test("amber: sync-progress says running, not stalled, with an empty memberProgress array", async () => {
  const env = makeEnv();
  env.fconf().arm("amber");
  const res = await env.call(APP(`/api/strategies/${ID}/sync-progress`));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.jobStatus, "running");
  assert.equal(body.stalled, false);
  assert.equal(Array.isArray(body.memberProgress), true);
  assert.equal(body.memberProgress.length, 0);
  assert.equal(body.degraded, false);
  assert.equal(env.spyCalls.length, 0);
});

test("amber: HEAD counts on trades and csv_daily_returns parse to 0 by the postgrest-js rule", async () => {
  const env = makeEnv();
  env.fconf().arm("amber");
  for (const [table, col] of [["trades", "id"], ["csv_daily_returns", "strategy_id"]]) {
    const res = await env.call(head(table, col));
    assert.equal(res.status, 200, table);
    assert.equal(await res.text(), "", table);
    assert.equal(res.headers.get("content-range"), "*/0", table);
    assert.equal(countOf(res), 0, table);
  }
  assert.equal(env.spyCalls.length, 0);
});

for (const encoded of [true, false]) {
  test(`amber: strategy_analytics answers for both poller shapes and the mount reads (commas ${encoded ? "encoded" : "raw"})`, async () => {
    const env = makeEnv();
    env.fconf().arm("amber");
    const get = async (cols) => (await env.call(analytics(cols, encoded))).json();
    assert.deepEqual(await get("computation_status,computation_error"), [
      { computation_status: "complete_with_warnings", computation_error: null },
    ]);
    assert.deepEqual(await get("computation_status,computation_error,computed_at,computation_error_job_id"), [
      {
        computation_status: "complete_with_warnings",
        computation_error: null,
        computed_at: null,
        computation_error_job_id: null,
      },
    ]);
    assert.deepEqual(await get("computation_status,computed_at"), []);
    assert.deepEqual(await get("data_quality_flags"), [{ data_quality_flags: null }]);
    assert.equal(env.spyCalls.length, 0);
  });
}

test("amber: the heavy analytics select gets one all-null row keyed by alias, nothing passes", async () => {
  const env = makeEnv();
  env.fconf().arm("amber");
  const cols = "cagr,sharpe,computed_at,series_completeness,series_start:returns_series->0->>date,series_end:returns_series->-1->>date";
  const rows = await (await env.call(analytics(cols))).json();
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]), ["cagr", "sharpe", "computed_at", "series_completeness", "series_start", "series_end"]);
  assert.equal(Object.values(rows[0]).every((v) => v === null), true);
  assert.equal(env.spyCalls.length, 0);
});

test("amber: csv_daily_returns and trades list reads answer an empty array", async () => {
  const env = makeEnv();
  env.fconf().arm("amber");
  const csv = await env.call(`${REST}/csv_daily_returns?select=id%2Cdate%2Cdaily_return&strategy_id=eq.${ID}&order=id.asc&limit=1000`);
  assert.deepEqual(await csv.json(), []);
  const trades = await env.call(`${REST}/trades?select=timestamp&strategy_id=eq.${ID}&order=timestamp.asc&limit=1`);
  assert.deepEqual(await trades.json(), []);
  assert.equal(env.spyCalls.length, 0);
});

test("the key permission read is refused in every armed mode and never sent (it writes an audit row and decrypts a credential)", async () => {
  for (const mode of ALL_MODES) {
    const env = makeEnv();
    env.fconf().arm(mode);
    const res = await env.call(APP(`/api/keys/${ID}/permissions`), { method: "GET", cache: "no-store" });
    assert.equal(res.status, 599, mode);
    assert.equal(env.spyCalls.length, 0, mode);
    assert.deepEqual([...env.fconf().refused], ["GET /api/keys/:id/permissions"], mode);
  }
});

test("resume: the resume-path reads pass through and nothing is stubbed but the kickoff", async () => {
  const env = makeEnv();
  env.fconf().arm("resume");
  await env.call(APP("/api/strategies/wizard-draft"));
  await env.call(APP(`/api/strategies/${ID}/sync-progress`));
  await env.call(analytics("computation_status,computed_at"));
  await env.call(head("trades", "id"));
  await env.call(`${REST}/discovery_categories?select=id%2Cname&order=sort_order`);
  await env.call(APP("/api/keys/feeds"), { cache: "no-store" });
  assert.equal(env.spyCalls.length, 6);
  assert.deepEqual([...env.fconf().hits], []);
});

test("every mode refuses a write on /rest/v1/ and an unknown non-GET on /api/, never sent", async () => {
  for (const mode of ALL_MODES) {
    const env = makeEnv();
    env.fconf().arm(mode);
    for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
      assert.equal((await env.call(`${REST}/strategies?id=eq.${ID}`, { method })).status, 599, `${mode} rest ${method}`);
    }
    assert.equal((await env.call(APP("/api/some/unknown/route"), { method: "PATCH" })).status, 599, mode);
    assert.equal((await env.call(new Request(APP(`/api/strategies/draft/${ID}`), { method: "DELETE" }))).status, 599, mode);
    assert.equal(env.spyCalls.length, 0, mode);
  }
});

test("an unlisted GET on /api/ is refused in an armed mode, not passed", async () => {
  const env = makeEnv();
  env.fconf().arm("amber");
  assert.equal((await env.call(APP("/api/notifications/unread-count"))).status, 599);
  assert.equal(env.spyCalls.length, 0);
});

test("marker text per mode, and the submit marker drops to not armed once the envelope is consumed", async () => {
  const env = makeEnv();
  const text = () => env.marker().textContent;
  env.fconf().arm("resume");
  assert.equal(text(), "STAGED RESPONSES ACTIVE — FCONF-01");
  env.fconf().arm("amber");
  assert.equal(text(), "STAGED RESPONSES ACTIVE — FCONF-02");
  env.fconf().arm("submit");
  assert.equal(text(), "STAGED RESPONSES ACTIVE — FCONF-03 (submit: not armed)");
  env.fconf().arm("submit", "DRAFT_LOOKUP_FAILED");
  assert.equal(text(), "STAGED RESPONSES ACTIVE — FCONF-03 (submit: DRAFT_LOOKUP_FAILED)");
  await env.call(post("/api/strategies/finalize-wizard"));
  assert.equal(text(), "STAGED RESPONSES ACTIVE — FCONF-03 (submit: not armed)");
});

test("scrub keeps METHOD and path, replaces ids, and keeps only the select param on REST entries", () => {
  const { scrub } = makeEnv().router;
  assert.equal(scrub("delete", APP(`/api/strategies/draft/${ID}`)), "DELETE /api/strategies/draft/:id");
  assert.equal(scrub("GET", APP("/api/keys/12345/permissions?x=1")), "GET /api/keys/:id/permissions");
  assert.equal(
    scrub("HEAD", `${REST}/trades?select=id&strategy_id=eq.${ID}`),
    "HEAD /rest/v1/trades?select=id",
  );
  assert.equal(scrub("GET", `${REST}/trades?select=eq.${ID}&strategy_id=eq.${ID}`), "GET /rest/v1/trades?select=eq.:id");
});

test("a request the router cannot classify is refused with 599 and never sent (catch arm fails closed)", async () => {
  const env = makeEnv();
  env.fconf().arm("submit", "DRAFT_LOOKUP_FAILED");
  const unclassifiable = { toString() { throw new Error("cannot stringify"); } };
  const res = await env.call(unclassifiable, { method: "POST" });
  assert.equal(res.status, 599);
  assert.equal(env.spyCalls.length, 0);
  assert.ok(env.fconf().refused.some((line) => line.startsWith("UNCLASSIFIED")));
});

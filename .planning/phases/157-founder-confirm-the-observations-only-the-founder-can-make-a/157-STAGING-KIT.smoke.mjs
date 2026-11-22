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

test("(d) an auth token refresh reaches the native fetch exactly once", async () => {
  const env = makeEnv();
  env.fconf().arm("connect");
  await env.call("https://proj.supabase.example/auth/v1/token?grant_type=refresh_token", { method: "POST" });
  assert.equal(env.spyCalls.length, 1);
});

test("(e) a cross-origin telemetry POST reaches the native fetch", async () => {
  const env = makeEnv();
  env.fconf().arm("connect");
  await env.call("https://telemetry.example.test/capture/", { method: "POST" });
  assert.equal(env.spyCalls.length, 1);
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

/**
 * PYAPI-06 arm — "is the analytics service key seam actually guarding, and is
 * OUR copy of the key actually accepted?" (phase 164.1 plan 01).
 *
 * ============================================================================
 * THE MEASURED OUTAGE THIS ARM EXISTS FOR
 * ============================================================================
 * 2026-08-25: five consecutive 401s from the analytics service, with ZERO
 * mismatch lines anywhere anyone was looking. `/health` was green the whole
 * time — it is unauthenticated (`analytics-service/main.py:742-743`), so it
 * says nothing about the key. A 401 never trips the 140.2 breaker either, so
 * the entire Vercel→FastAPI seam could be down with every instrument reading
 * normal. Nothing measured the key end to end; this arm is that measurement.
 *
 * ============================================================================
 * THREE REQUESTS, BECAUSE ONE CANNOT TELL TWO FAULTS APART
 * ============================================================================
 * A single authenticated GET conflates "our key is wrong" with "the server
 * accepts anything". They have opposite remedies, so they are separate defect
 * kinds bought by separate requests (threat T-164.1-02):
 *
 *   keyed   GET /api/match/eval?lookback_days=1  with X-Service-Key: <ours>
 *           → expect 200. A 401 means OUR key is refused        (`pyapi06-keyed-refused`)
 *   absent  the same GET with NO X-Service-Key header
 *           → expect 401 AND detail.code === "SERVICE_KEY_ABSENT".
 *             A 2xx means the middleware is not guarding at all (`pyapi06-absent-accepted`)
 *             A 401 with no code means the deployed service predates
 *             PYAPI-06's Python half (plan 02)                  (`pyapi06-absent-uncoded`)
 *   wrong   the same GET with a deliberately wrong key
 *           → expect 401. A 2xx means the comparison is not
 *             happening                                         (`pyapi06-wrong-key-accepted`)
 *   health  GET /health (unauthenticated)
 *           → `config_degraded_secrets` naming SERVICE_KEY means
 *             the key is UNSET on Railway                       (`pyapi06-health-degraded`)
 *
 * ⚠️ READ-ONLY, and deliberately cheap: four GETs per run against a route
 * throttled at 30/min (`analytics-service/routers/match.py:1855-1861`), with
 * `lookback_days=1` and NO retry loop. No POST, ever (threat T-164.1-04).
 *
 * ⛔ NEVER PRINTS A VALUE. Status codes, the machine code string, and — only
 * beside a defect — the first 200 chars of the body. Never the key, never a
 * response header, never the URL's credentials. `runProber` additionally
 * scrubs every `requiredEnv` value out of every string before it is logged;
 * that scrubber is the belt, this discipline is the braces.
 *
 * ⛔ NOTHING IN THIS FILE READS `process`.env — the environment arrives as the
 * injected `env` object, which is what lets a self-test scenario hold the
 * whole environment in its hand.
 *
 * ── KNOWN LIMIT, stated rather than hidden ──────────────────────────────────
 * A 401 carrying `SERVICE_KEY_ABSENT` in response to a PRESENT-but-wrong key
 * would mean the service conflates absent with mismatched. This arm does not
 * classify it: it would need a twentieth-first defect kind, and `DEFECT_KINDS`
 * is pinned at 20 by the plan-05 wiring test. The `wrong` request therefore
 * asserts only the status. If plan 02's Python half ever grows that confusion,
 * it is caught by the Python-side test (D-12), not here.
 */

/** The key deliberately sent on the third request. Obviously not a credential. */
export const WRONG_KEY = "prod-prober-deliberately-wrong-key";

/** The machine code plan 02 (D-10) makes the analytics service return for an absent header. */
export const ABSENT_CODE = "SERVICE_KEY_ABSENT";

/**
 * One sentence of OPERATOR REMEDY per defect kind this arm can raise. Every
 * defect row carries its entry — a defect table that says what broke but not
 * what to do about it is an alert nobody acts on.
 *
 * ⛔ Names only. These strings are printed into a PUBLIC Actions log.
 */
export const REMEDIES = {
  "pyapi06-keyed-refused":
    "Our key is refused: re-copy Railway's SERVICE_KEY into the GitHub secret ANALYTICS_SERVICE_KEY and into Vercel, through a trimming pipe (a trailing newline alone has reproduced this outage). Railway is the source of truth — copy Railway → GitHub/Vercel, never the reverse.",
  "pyapi06-absent-accepted":
    "A request with NO X-Service-Key header was served: the middleware is not guarding. Check which SHA is deployed on Railway (GET /health → git_sha) and that SERVICE_KEY is set there; a service that answers unauthenticated callers is an open door, not a degraded one.",
  "pyapi06-absent-uncoded":
    "The absent-header request was refused but carried no machine code: the deployed analytics-service predates PYAPI-06's Python half. Deploy main to Railway and confirm GET /health git_sha matches; until then absent and mismatched keys are indistinguishable to every caller.",
  "pyapi06-wrong-key-accepted":
    "A deliberately WRONG key was served a 2xx: the key comparison is not happening. Check the deployed analytics-service SHA on Railway and that SERVICE_KEY is a real value there — this is the same open door as absent-accepted, reached through a different door.",
  "pyapi06-health-degraded":
    "GET /health reports SERVICE_KEY in config_degraded_secrets: the secret is UNSET on Railway, so every guarded route answers 500 SERVICE_KEY_UNCONFIGURED until a human sets it. Set SERVICE_KEY in the Railway analytics service's variables and redeploy.",
};

/** Strip a trailing slash so `${base}/health` never becomes `//health`. */
function normalizeBase(raw) {
  return String(raw).replace(/\/+$/, "");
}

/** First 200 chars of a body, for a defect row only. Newlines flattened. */
function bodyExcerpt(text) {
  if (typeof text !== "string" || text.length === 0) return "<empty body>";
  return text.slice(0, 200).replace(/\s+/g, " ");
}

/** The `detail.code` of the analytics error envelope, which nests under `detail`. */
function envelopeCode(json) {
  if (!json || typeof json !== "object") return null;
  const detail = json.detail;
  if (!detail || typeof detail !== "object") return null;
  return typeof detail.code === "string" ? detail.code : null;
}

/**
 * @param {{env: Record<string,string|undefined>, seams: object, log: (s:string)=>void,
 *          addDefect: (kind:string, arm:string|null, subject:string|null, detail:string, remedy?:string|null)=>void}} ctx
 */
async function run({ env, seams, log, addDefect }) {
  const base = normalizeBase(env.ANALYTICS_BASE_URL);
  const key = env.ANALYTICS_SERVICE_KEY;
  const evalUrl = `${base}/api/match/eval?lookback_days=1`;
  const healthUrl = `${base}/health`;

  // -------------------------------------------------------------------------
  // (a) keyed — our key must be accepted.
  // -------------------------------------------------------------------------
  const keyed = await seams.fetch("pyapi06", evalUrl, { headers: { "X-Service-Key": key } });
  log(`pyapi06: keyed → ${keyed.measureFail ? "MEASURE_FAIL" : keyed.status}`);
  if (keyed.measureFail) {
    addDefect(
      "measure-fail",
      "pyapi06",
      "keyed",
      `the authenticated GET could not be performed at all: ${keyed.measureFail}. A request that never completed is not evidence the key works.`,
    );
  } else if (keyed.status === 401) {
    addDefect(
      "pyapi06-keyed-refused",
      "pyapi06",
      "keyed",
      `the authenticated GET was refused with 401 — the key this run holds is not the key the service accepts. Body: ${bodyExcerpt(keyed.text)}`,
      REMEDIES["pyapi06-keyed-refused"],
    );
  } else if (keyed.status !== 200) {
    addDefect(
      "measure-fail",
      "pyapi06",
      "keyed",
      `the authenticated GET answered ${keyed.status}, which is neither the expected 200 nor the 401 this arm classifies — the key was not measured. Body: ${bodyExcerpt(keyed.text)}`,
    );
  }

  // -------------------------------------------------------------------------
  // (b) absent — no header at all must be refused, WITH a machine code.
  // -------------------------------------------------------------------------
  const absent = await seams.fetch("pyapi06", evalUrl, { headers: {} });
  const absentCode = envelopeCode(absent.json);
  log(
    `pyapi06: absent → ${absent.measureFail ? "MEASURE_FAIL" : absent.status}` +
      (absentCode ? ` (code ${absentCode})` : ""),
  );
  if (absent.measureFail) {
    addDefect(
      "measure-fail",
      "pyapi06",
      "absent",
      `the no-header GET could not be performed at all: ${absent.measureFail}.`,
    );
  } else if (typeof absent.status === "number" && absent.status >= 200 && absent.status < 300) {
    addDefect(
      "pyapi06-absent-accepted",
      "pyapi06",
      "absent",
      `a GET carrying NO X-Service-Key header was answered ${absent.status} — the guard is not running. Body: ${bodyExcerpt(absent.text)}`,
      REMEDIES["pyapi06-absent-accepted"],
    );
  } else if (absent.status === 401 && absentCode !== ABSENT_CODE) {
    addDefect(
      "pyapi06-absent-uncoded",
      "pyapi06",
      "absent",
      `the no-header GET was refused 401 but the body carries no ${ABSENT_CODE} code — absent and mismatched keys are indistinguishable to callers. Body: ${bodyExcerpt(absent.text)}`,
      REMEDIES["pyapi06-absent-uncoded"],
    );
  } else if (absent.status !== 401) {
    addDefect(
      "measure-fail",
      "pyapi06",
      "absent",
      `the no-header GET answered ${absent.status}, neither a 2xx nor the 401 this arm classifies — the guard was not measured. Body: ${bodyExcerpt(absent.text)}`,
    );
  }

  // -------------------------------------------------------------------------
  // (c) wrong — a present-but-wrong key must be refused.
  // -------------------------------------------------------------------------
  const wrong = await seams.fetch("pyapi06", evalUrl, { headers: { "X-Service-Key": WRONG_KEY } });
  log(`pyapi06: wrong → ${wrong.measureFail ? "MEASURE_FAIL" : wrong.status}`);
  if (wrong.measureFail) {
    addDefect(
      "measure-fail",
      "pyapi06",
      "wrong",
      `the wrong-key GET could not be performed at all: ${wrong.measureFail}.`,
    );
  } else if (typeof wrong.status === "number" && wrong.status >= 200 && wrong.status < 300) {
    addDefect(
      "pyapi06-wrong-key-accepted",
      "pyapi06",
      "wrong",
      `a GET carrying a deliberately WRONG X-Service-Key was answered ${wrong.status} — the comparison is not happening. Body: ${bodyExcerpt(wrong.text)}`,
      REMEDIES["pyapi06-wrong-key-accepted"],
    );
  } else if (wrong.status !== 401) {
    addDefect(
      "measure-fail",
      "pyapi06",
      "wrong",
      `the wrong-key GET answered ${wrong.status}, neither a 2xx nor the 401 this arm classifies — the comparison was not measured. Body: ${bodyExcerpt(wrong.text)}`,
    );
  }

  // -------------------------------------------------------------------------
  // (d) health — the unauthenticated secret verdict (names only, by design:
  //     `analytics-service/main.py:884-893`).
  // -------------------------------------------------------------------------
  const health = await seams.fetch("pyapi06", healthUrl, { headers: {} });
  const degraded =
    health.json && Array.isArray(health.json.config_degraded_secrets)
      ? health.json.config_degraded_secrets
      : null;
  log(
    `pyapi06: health → ${health.measureFail ? "MEASURE_FAIL" : health.status}` +
      (degraded ? ` (config_degraded_secrets: [${degraded.join(", ")}])` : ""),
  );
  if (health.measureFail) {
    addDefect(
      "measure-fail",
      "pyapi06",
      "health",
      `GET /health could not be performed at all: ${health.measureFail}.`,
    );
  } else if (degraded === null) {
    addDefect(
      "measure-fail",
      "pyapi06",
      "health",
      `GET /health answered ${health.status} without a config_degraded_secrets array — the secret verdict was not measured. Body: ${bodyExcerpt(health.text)}`,
    );
  } else if (degraded.includes("SERVICE_KEY")) {
    addDefect(
      "pyapi06-health-degraded",
      "pyapi06",
      "health",
      `GET /health names SERVICE_KEY in config_degraded_secrets — the secret is unset on Railway and every guarded route is answering 500 SERVICE_KEY_UNCONFIGURED.`,
      REMEDIES["pyapi06-health-degraded"],
    );
  }
}

/**
 * The ARM CONTRACT every arm module exports. Plans 03 and 04 add modules with
 * this exact shape and nothing structural changes:
 *
 *   name        — the string every defect row is attributed to
 *   requiredEnv — env NAMES (never values) whose absence BLOCKS this arm with
 *                 a `credential-absent` defect. Never a skip (D-06).
 *   run         — async ({env, seams, log, addDefect}) => void. Aggregates:
 *                 it never returns early on the first fault.
 *   REMEDIES    — kind → one sentence of operator remedy.
 */
export const ARM = {
  name: "pyapi06",
  requiredEnv: ["ANALYTICS_BASE_URL", "ANALYTICS_SERVICE_KEY"],
  run,
  REMEDIES,
};

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  seamBreakerVerdict,
  seamErrorCode,
  seamHumanMessage,
} from "./seam-discriminator";

/**
 * Phase 140.2 / SEAMCORE-01 (ROADMAP SC2) — the attributability discriminator.
 *
 * WHAT THIS FILE PINS, AND WHY EVERY EXPECTATION IS TYPED HERE
 * -----------------------------------------------------------
 * The emit side of this contract is `analytics-service/docs/STATUS_CONTRACT.md`
 * §1/§2.1/§4/§6 and its executable half `services/error_contract.py`. This file
 * is the CONSUMING half's oracle. Every expected verdict, every expected key
 * string and the whole closed service-dependency set are typed HERE, by hand.
 * Nothing on an expected side is read out of `seam-discriminator.ts`, and
 * nothing is imported from `resilient-fetch.ts` — an oracle that asks the module
 * under test what it thinks is the exact defect this phase exists to end (ten
 * simultaneous semantic mutations to the seam core once produced a byte-
 * identical `8859 passed`).
 *
 * ZERO `vi.mock` IN THIS FILE, BY RULE. The leaf is dependency-free precisely so
 * it can be driven with no doubles at all; mocking anything here would make the
 * test assert that a second pair of fakes agrees with itself.
 *
 * THE TWO PROPERTIES THAT ARE NOT NEGOTIABLE
 * ------------------------------------------
 *  1. **Counts / does-not-count is decided from the STATUS LINE ALONE.** An
 *     unhandled Python exception is a bodyless `500 text/plain` (Starlette
 *     `ServerErrorMiddleware` → `PlainTextResponse`, TRAP-2), so a classifier
 *     that needs a body is undefined on the single most common 5xx. Every row
 *     below is therefore driven TWICE: once with its body and once with no body
 *     argument at all, and the counts/key answer must be identical except on the
 *     one arm where the body legitimately refines the key.
 *  2. **A breaker key may only ever be built from the hand-typed closed service
 *     set.** A `424`'s `dependency` is the CALLER'S VENUE (STATUS_CONTRACT §4)
 *     and must never become a key; an unrecognised value on a `503` falls back
 *     to the residual global key. A caller-influenced breaker key is a trivial
 *     cross-tenant denial of service (threat T-140-01): mint one key and you
 *     trip the breaker for a cohort, mint many and you shard it so it never
 *     trips at all.
 */

// ---------------------------------------------------------------------------
// The oracle. Hand-typed literals, none of them derived from the module.
// ---------------------------------------------------------------------------

/** The residual global key — a connection that never completed names nothing. */
const GLOBAL_KEY = "breaker:railway";

/**
 * The four service dependencies, typed here INDEPENDENTLY of the module's own
 * frozen set (STATUS_CONTRACT §4). These are the only values that may become a
 * breaker key.
 */
const MT5_KEY = "breaker:mt5-gateway";
const KEK_KEY = "breaker:kek";
const SUPABASE_KEY = "breaker:supabase";
const EGRESS_KEY = "breaker:egress-proxy";

// ---------------------------------------------------------------------------
// Bodies, hand-typed in each of the shapes the analytics service actually emits.
// ---------------------------------------------------------------------------

/** §2 — the nested `service_error` envelope. The ONLY shape carrying `dependency`. */
function nested(
  code: string,
  dependency: string | null,
  retryable: boolean,
  human: string,
): unknown {
  return { detail: { code, dependency, retryable, detail: human } };
}

/** §2.1 shape (a) — the app-global handler body: scalar `detail`, top-level `code`. */
function flatAppGlobal(code: string, human: string): unknown {
  return {
    ok: false,
    code,
    human_message: human,
    detail: human,
    correlation_id: "corr-abc",
    recoverable: true,
  };
}

/** §2.1 shape (b) — `VenueTransientHTTPException`: exactly three keys. */
function flatVenueTransient(code: string, human: string): unknown {
  return { detail: human, code, recoverable: true };
}

/** §2.1 shape (c) — the bare scalar still at match.py / simulator.py / portfolio.py. */
function bareScalar(human: string): unknown {
  return { detail: human };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The verdict table. One row per status class, every expectation hand-typed.
// ---------------------------------------------------------------------------

interface VerdictCase {
  readonly label: string;
  readonly status: number | null;
  readonly body: unknown;
  readonly attributability: string;
  readonly counts: boolean;
  readonly breakerKey: string | null;
  readonly dependency: string | null;
}

const VERDICT_CASES: VerdictCase[] = [
  // ── CALLER — never counts, no key ────────────────────────────────────────
  {
    label: "400 malformed request (the MODAL venue-failure path, M-4)",
    status: 400,
    body: flatVenueTransient("EXCHANGE_PROBE_FAILED", "Binance rejected the key"),
    attributability: "caller",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  {
    label: "401 unauthenticated",
    status: 401,
    body: bareScalar("Not authenticated"),
    attributability: "caller",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  {
    label: "403 forbidden",
    status: 403,
    body: bareScalar("Forbidden"),
    attributability: "caller",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  {
    label: "404 not found",
    status: 404,
    body: bareScalar("Strategy not found"),
    attributability: "caller",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  {
    label: "422 request validation",
    status: 422,
    body: flatAppGlobal("VALIDATION_ERROR", "weights must sum to 1"),
    attributability: "caller",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  // ── CALLER, THROTTLED — never counts, in all three wire shapes (TS-23) ────
  {
    label: "429 shape (a) — the flat app-global RateLimitExceeded handler",
    status: 429,
    body: flatAppGlobal("RATE_LIMITED", "Too many requests. Try again in 60s."),
    attributability: "caller-throttled",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  {
    label: "429 shape (b) — the nested service_error envelope (internal.py:246)",
    status: 429,
    body: nested("RATE_LIMITED", null, true, "This key is being probed too often."),
    attributability: "caller-throttled",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  {
    label: "429 shape (c) — the bare scalar, carrying NO code at all",
    status: 429,
    body: bareScalar("Rate limit exceeded"),
    attributability: "caller-throttled",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  // ── CALLER'S EXCHANGE — never counts, venue slug NEVER becomes a key ──────
  {
    label: "424 with a VENUE dependency — binance",
    status: 424,
    body: nested(
      "EXCHANGE_PROBE_FAILED",
      "binance",
      true,
      "Binance is not responding right now.",
    ),
    attributability: "caller-exchange",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  {
    label: "424 with a VENUE dependency — deribit",
    status: 424,
    body: nested(
      "EXCHANGE_PROBE_FAILED",
      "deribit",
      true,
      "Deribit is not responding right now.",
    ),
    attributability: "caller-exchange",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  // ── SERVICE-PERMANENT — never counts, INCLUDING bodyless text/plain ───────
  {
    label: "500 with a named dependency and retryable:false",
    status: 500,
    body: nested("KEK_NOT_CONFIGURED", "kek", false, "Encryption is misconfigured."),
    attributability: "service-permanent",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  {
    label: "500 bodyless text/plain (TRAP-2 — Starlette's unhandled exception)",
    status: 500,
    body: undefined,
    attributability: "service-permanent",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  // ── SERVICE-TRANSIENT — counts, keyed on the NAMED dependency ─────────────
  {
    label: "503 dependency mt5-gateway",
    status: 503,
    body: nested("MT5_GATEWAY_UNREACHABLE", "mt5-gateway", true, "Gateway down."),
    attributability: "service-transient",
    counts: true,
    breakerKey: MT5_KEY,
    dependency: "mt5-gateway",
  },
  {
    label: "503 dependency kek",
    status: 503,
    body: nested("KEK_UNAVAILABLE", "kek", true, "Key service is unavailable."),
    attributability: "service-transient",
    counts: true,
    breakerKey: KEK_KEY,
    dependency: "kek",
  },
  {
    label: "503 dependency supabase",
    status: 503,
    body: nested("DB_UNAVAILABLE", "supabase", true, "The database blipped."),
    attributability: "service-transient",
    counts: true,
    breakerKey: SUPABASE_KEY,
    dependency: "supabase",
  },
  {
    label: "503 dependency egress-proxy",
    status: 503,
    body: nested("EGRESS_UNAVAILABLE", "egress-proxy", true, "Proxy is down."),
    attributability: "service-transient",
    counts: true,
    breakerKey: EGRESS_KEY,
    dependency: "egress-proxy",
  },
  {
    label: "503 with an UNRECOGNISED dependency falls back to the global key",
    status: 503,
    body: nested("WAT", "binance", true, "Something."),
    attributability: "service-transient",
    counts: true,
    breakerKey: GLOBAL_KEY,
    dependency: null,
  },
  {
    label: "503 with NO readable body still counts, on the global key",
    status: 503,
    body: undefined,
    attributability: "service-transient",
    counts: true,
    breakerKey: GLOBAL_KEY,
    dependency: null,
  },
  {
    label: "503 whose body is a bare scalar (no dependency anywhere)",
    status: 503,
    body: bareScalar("Service Unavailable"),
    attributability: "service-transient",
    counts: true,
    breakerKey: GLOBAL_KEY,
    dependency: null,
  },
  // ── Other 5xx — the Railway EDGE, which names no dependency of ours ───────
  {
    label: "502 from the platform edge",
    status: 502,
    body: undefined,
    attributability: "service-transient",
    counts: true,
    breakerKey: GLOBAL_KEY,
    dependency: null,
  },
  {
    label: "504 from the platform edge",
    status: 504,
    body: undefined,
    attributability: "service-transient",
    counts: true,
    breakerKey: GLOBAL_KEY,
    dependency: null,
  },
  // ── Success ──────────────────────────────────────────────────────────────
  {
    label: "200 OK",
    status: 200,
    body: { ok: true },
    attributability: "success",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  {
    label: "202 Accepted (the enqueue reply)",
    status: 202,
    body: { queued: true },
    attributability: "success",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  {
    label: "204 No Content",
    status: 204,
    body: undefined,
    attributability: "success",
    counts: false,
    breakerKey: null,
    dependency: null,
  },
  // ── Transport — no response at all ───────────────────────────────────────
  {
    label: "a transport throw / deadline / body-read rejection (no status line)",
    status: null,
    body: undefined,
    attributability: "transport",
    counts: true,
    breakerKey: GLOBAL_KEY,
    dependency: null,
  },
];

describe("[SEAMCORE-01 / SC2] the status → breaker-verdict table", () => {
  it.each(VERDICT_CASES.map((c) => [c.label, c] as const))(
    "%s",
    (_label, c) => {
      // A `console.warn` is legitimate on the unrecognised-dependency arm; it is
      // silenced here so the diagnostic does not pollute the run, and asserted
      // explicitly in its own case below.
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const verdict = seamBreakerVerdict(c.status, c.body);
      expect(
        verdict.counts,
        `"${c.label}" must ${c.counts ? "COUNT" : "NOT count"} toward the ` +
          `breaker. Counting a caller or exchange fault lets a handful of users ` +
          `fat-fingering credentials deny key-connect platform-wide (A-01/C-12); ` +
          `counting a 500 guarantees a self-sustaining outage, because a ` +
          `deterministic fault can only be cleared by an operator (R-1/A-02).`,
      ).toBe(c.counts);
      expect(verdict.breakerKey).toBe(c.breakerKey);
      expect(verdict.dependency).toBe(c.dependency);
      expect(verdict.attributability).toBe(c.attributability);
    },
  );

  it.each(VERDICT_CASES.map((c) => [c.label, c] as const))(
    "%s — decidable from the STATUS LINE ALONE (no body argument)",
    (_label, c) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      // TRAP-2. Whether it counts may NEVER depend on the body being readable;
      // the body only refines WHICH key on the 503 arm.
      const bodyless = seamBreakerVerdict(c.status);
      expect(bodyless.counts).toBe(c.counts);
      expect(bodyless.attributability).toBe(c.attributability);
      if (c.counts) {
        // Without a body there is no dependency to name, so a counting arm
        // degrades to the residual global key — never to "no key at all".
        expect(bodyless.breakerKey).not.toBeNull();
      } else {
        expect(bodyless.breakerKey).toBeNull();
      }
    },
  );
});

describe("[SEAMCORE-01 / T-140-01] a breaker key comes only from the closed set", () => {
  it("a 424's venue slug never becomes a breaker key, for any venue", () => {
    // STATUS_CONTRACT §4: on a 424 `dependency` names the CALLER'S VENUE. The
    // whole point of 424 is that it is breaker-inert BY CONSTRUCTION; keying on
    // it would make C-12 true — a Binance maintenance window trips a platform-
    // wide breaker.
    for (const venue of ["binance", "deribit", "bybit", "okx", "kraken"]) {
      const verdict = seamBreakerVerdict(
        424,
        nested("EXCHANGE_PROBE_FAILED", venue, true, "Venue down."),
      );
      expect(
        verdict.breakerKey,
        `A 424 naming "${venue}" produced a breaker key. A 424's dependency is ` +
          `the caller's VENUE, not one of ours — keying on it means one venue's ` +
          `outage denies every other venue's users.`,
      ).toBeNull();
      expect(verdict.counts).toBe(false);
      expect(verdict.dependency).toBeNull();
    }
  });

  it("a 503 naming an unrecognised dependency logs loudly and keys globally", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const verdict = seamBreakerVerdict(
      503,
      nested("WAT", "attacker-controlled-value", true, "nope"),
    );
    expect(verdict.breakerKey).toBe(GLOBAL_KEY);
    expect(verdict.dependency).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("a 503 whose dependency is a non-string keys globally and does not throw", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const junk of [42, true, null, {}, [], undefined]) {
      const verdict = seamBreakerVerdict(503, {
        detail: { code: "X", dependency: junk, retryable: true, detail: "x" },
      });
      expect(verdict.breakerKey).toBe(GLOBAL_KEY);
      expect(verdict.dependency).toBeNull();
      expect(verdict.counts).toBe(true);
    }
  });

  it("[OB-8] two different service dependencies produce two DIFFERENT keys", () => {
    // The leaf-level precondition for OB-8. If these collapsed to one key, the
    // per-dependency isolation the core builds on top would be decorative: one
    // MT5 gateway restart would still deny every Deribit user.
    const mt5 = seamBreakerVerdict(
      503,
      nested("MT5_GATEWAY_UNREACHABLE", "mt5-gateway", true, "down"),
    );
    const supabase = seamBreakerVerdict(
      503,
      nested("DB_UNAVAILABLE", "supabase", true, "blip"),
    );
    expect(mt5.breakerKey).toBe(MT5_KEY);
    expect(supabase.breakerKey).toBe(SUPABASE_KEY);
    expect(
      mt5.breakerKey,
      "Two different named dependencies produced the SAME breaker key. That is " +
        "the single global key wearing a new name, and OB-8 is not satisfied.",
    ).not.toBe(supabase.breakerKey);
    // …and neither of them is the residual global key.
    expect(mt5.breakerKey).not.toBe(GLOBAL_KEY);
    expect(supabase.breakerKey).not.toBe(GLOBAL_KEY);
  });
});

describe("[STATUS_CONTRACT §2.1] code extraction branches on typeof body.detail", () => {
  it("nested envelope → body.detail.code", () => {
    expect(
      seamErrorCode(nested("MT5_GATEWAY_UNREACHABLE", "mt5-gateway", true, "x")),
    ).toBe("MT5_GATEWAY_UNREACHABLE");
  });

  it("flat app-global handler → body.code", () => {
    // Reading body.detail.code here yields undefined and falls through to
    // UNKNOWN — the exact dead end PYAPIFIX2-01 exists to kill, reintroduced at
    // the consuming layer.
    expect(seamErrorCode(flatAppGlobal("RATE_LIMITED", "slow down"))).toBe(
      "RATE_LIMITED",
    );
    expect(seamErrorCode(flatAppGlobal("VALIDATION_ERROR", "bad"))).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("flat VenueTransientHTTPException → body.code", () => {
    expect(
      seamErrorCode(flatVenueTransient("EXCHANGE_PROBE_FAILED", "venue down")),
    ).toBe("EXCHANGE_PROBE_FAILED");
  });

  it("bare scalar 429 → no code at all, and that is the contract", () => {
    // Shape (c) carries no machine code in EITHER branch. Pinned so the
    // tolerance is asserted rather than assumed: the discriminator must return
    // null, not throw and not invent one.
    expect(seamErrorCode(bareScalar("Rate limit exceeded"))).toBeNull();
  });

  it("malformed and absent bodies yield null rather than throwing", () => {
    expect(seamErrorCode(undefined)).toBeNull();
    expect(seamErrorCode(null)).toBeNull();
    expect(seamErrorCode("Internal Server Error")).toBeNull();
    expect(seamErrorCode(42)).toBeNull();
    expect(seamErrorCode({})).toBeNull();
    expect(seamErrorCode({ detail: null })).toBeNull();
    expect(seamErrorCode({ detail: [] })).toBeNull();
    expect(seamErrorCode({ detail: { code: 7 } })).toBeNull();
    expect(seamErrorCode({ code: 7 })).toBeNull();
  });
});

describe("[STATUS_CONTRACT §2.1 / O-5] human-string extraction", () => {
  it("nested envelope → body.detail.detail, never the object itself", () => {
    // `err.detail ?? "…"` on the nested shape stringifies to "[object Object]"
    // in the wizard's substring cascade — the C-14 render.
    expect(
      seamHumanMessage(
        nested("MT5_GATEWAY_UNREACHABLE", "mt5-gateway", true, "Gateway down."),
      ),
    ).toBe("Gateway down.");
  });

  it("flat shapes → the scalar at body.detail", () => {
    expect(seamHumanMessage(flatAppGlobal("RATE_LIMITED", "slow down"))).toBe(
      "slow down",
    );
    expect(
      seamHumanMessage(flatVenueTransient("EXCHANGE_PROBE_FAILED", "venue down")),
    ).toBe("venue down");
    expect(seamHumanMessage(bareScalar("Rate limit exceeded"))).toBe(
      "Rate limit exceeded",
    );
  });

  it("never returns the string '[object Object]'", () => {
    const human = seamHumanMessage(nested("X", "supabase", true, "real copy"));
    expect(human).not.toBe("[object Object]");
    expect(human).toBe("real copy");
  });

  it("malformed and absent bodies yield null rather than throwing", () => {
    expect(seamHumanMessage(undefined)).toBeNull();
    expect(seamHumanMessage(null)).toBeNull();
    expect(seamHumanMessage(42)).toBeNull();
    expect(seamHumanMessage({})).toBeNull();
    expect(seamHumanMessage({ detail: null })).toBeNull();
    expect(seamHumanMessage({ detail: [] })).toBeNull();
    expect(seamHumanMessage({ detail: { detail: 7 } })).toBeNull();
  });
});

describe("[TRAP-2] the verdict never throws, whatever it is handed", () => {
  it("survives every junk status and every junk body", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const statuses: unknown[] = [
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      0,
      "503",
      {},
    ];
    const bodies: unknown[] = [
      undefined,
      null,
      "",
      "Internal Server Error",
      0,
      [],
      { detail: { dependency: { nested: true } } },
    ];
    for (const status of statuses) {
      for (const body of bodies) {
        expect(() =>
          seamBreakerVerdict(status as number | null, body),
        ).not.toThrow();
      }
    }
  });

  it("an unusable status line is treated as a transport failure, not a success", () => {
    // A status we cannot read means we never got a usable response, which is
    // genuine degradation. Classifying it as 2xx would silently disarm the
    // breaker; classifying it as a caller fault would do the same.
    for (const junk of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const verdict = seamBreakerVerdict(junk);
      expect(verdict.counts).toBe(true);
      expect(verdict.breakerKey).toBe(GLOBAL_KEY);
      expect(verdict.attributability).toBe("transport");
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MonteCarloSection } from "./MonteCarloSection";
import { SAMPLE_FLOOR_OVERLAPPING_DAYS } from "@/lib/sample-floor";
import type { MonteCarloResult } from "../lib/scenario-montecarlo";

/**
 * Plan 27-02 (SIM-01) — the state-matrix + honesty pins for MonteCarloSection.
 *
 * The off-thread runner is MOCKED so the worker / `new Worker(new URL(...))`
 * plumbing stays out of jsdom; the math is pinned in scenario-montecarlo.test.ts.
 * What this test owns is the contract a worker can't: the FIXED guard order
 * (#509), the never-spawn-before-gates rule, the never-bare-band disclosure, and
 * em-dash discipline.
 */

const { runnerMock } = vi.hoisted(() => ({ runnerMock: vi.fn() }));
vi.mock("../lib/montecarlo-runner", () => ({ runMonteCarloOffThread: runnerMock }));

type DP = { date: string; value: number };
function series(n: number): DP[] {
  return Array.from({ length: n }, (_, i) => ({ date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`, value: 0.01 }));
}

/** A controllable deferred so a test can resolve/reject the worker on demand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const MC_DEBOUNCE_MS = 250;

function okResult(over: Partial<MonteCarloResult> = {}): MonteCarloResult {
  return {
    ok: true,
    reason: "ok",
    n: 120,
    paths: 1000,
    blockLength: 8,
    horizonDays: 252,
    medianKey: "p50",
    bands: [
      { step: 1, q: { p5: -0.01, p25: -0.005, p50: 0.001, p75: 0.006, p95: 0.012 } },
      { step: 2, q: { p5: -0.02, p25: -0.01, p50: 0.002, p75: 0.012, p95: 0.024 } },
    ],
    terminal: { median: 0.08, lo: -0.2, hi: 0.4 },
    ...over,
  };
}

beforeEach(() => {
  runnerMock.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("MonteCarloSection — guard order runs BEFORE the worker (#509)", () => {
  it("scenario-side absence: no returns ⇒ scenario-side empty state, worker never spawned", () => {
    render(<MonteCarloSection portfolioDaily={[]} n={0} strategyCount={3} />);
    expect(screen.getByText("Forward uncertainty unavailable")).toBeInTheDocument();
    expect(screen.getByText(/nothing to simulate/)).toBeInTheDocument();
    expect(runnerMock).not.toHaveBeenCalled();
  });

  it("below the floor ⇒ sample-floor empty state, worker never spawned", () => {
    render(
      <MonteCarloSection
        portfolioDaily={series(40)}
        n={SAMPLE_FLOOR_OVERLAPPING_DAYS - 1}
        strategyCount={3}
      />,
    );
    expect(screen.getByText("Not enough history for this estimate")).toBeInTheDocument();
    expect(runnerMock).not.toHaveBeenCalled();
  });

  it("below the floor + a single strategy ⇒ the few-strategies body (not a fabricated N)", () => {
    render(<MonteCarloSection portfolioDaily={series(40)} n={40} strategyCount={1} />);
    expect(screen.getByText(/Add at least 2 active strategies/)).toBeInTheDocument();
    expect(runnerMock).not.toHaveBeenCalled();
  });
});

describe("MonteCarloSection — worker lifecycle + states", () => {
  it("eligible ⇒ shows the computing state and spawns the worker after the debounce", async () => {
    runnerMock.mockReturnValue({ promise: deferred<MonteCarloResult>().promise, cancel: vi.fn() });
    render(<MonteCarloSection portfolioDaily={series(120)} n={120} strategyCount={3} />);

    // Computing immediately (before the debounce fires) — no flash of empty.
    expect(screen.getByTestId("mc-computing")).toBeInTheDocument();
    expect(screen.getByText("Simulating forward paths…")).toBeInTheDocument();
    expect(runnerMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MC_DEBOUNCE_MS);
    });
    expect(runnerMock).toHaveBeenCalledTimes(1);
  });

  it("worker resolves ⇒ ok state: chart + terminal + the never-bare disclosure", async () => {
    const d = deferred<MonteCarloResult>();
    runnerMock.mockReturnValue({ promise: d.promise, cancel: vi.fn() });
    render(<MonteCarloSection portfolioDaily={series(120)} n={120} strategyCount={3} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MC_DEBOUNCE_MS);
    });
    await act(async () => {
      d.resolve(okResult());
    });

    expect(screen.getByTestId("montecarlo-band-chart")).toBeInTheDocument();
    expect(screen.getByTestId("mc-terminal")).toBeInTheDocument();
    // Disclosure is never a bare band: method + paths + block + N + no-Normal.
    const disclosure = screen.getByTestId("mc-disclosure").textContent ?? "";
    expect(disclosure).toContain("Block bootstrap of realized daily returns");
    expect(disclosure).toContain("1000 paths");
    expect(disclosure).toContain("block 8d");
    expect(disclosure).toContain("120 overlapping days"); // methodologyLine(120), the real N
    expect(disclosure).toContain("Not a Normal model");
  });

  it("a short history (N just above the floor) ⇒ the explicit honest-to-N note", async () => {
    const d = deferred<MonteCarloResult>();
    runnerMock.mockReturnValue({ promise: d.promise, cancel: vi.fn() });
    render(<MonteCarloSection portfolioDaily={series(70)} n={70} strategyCount={3} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MC_DEBOUNCE_MS);
    });
    await act(async () => {
      d.resolve(okResult({ n: 70 }));
    });
    expect(screen.getByTestId("mc-short-history")).toBeInTheDocument();
    expect(screen.getByText(/This interval is wide/)).toBeInTheDocument();
  });

  it("a long history ⇒ NO short-history note", async () => {
    const d = deferred<MonteCarloResult>();
    runnerMock.mockReturnValue({ promise: d.promise, cancel: vi.fn() });
    render(<MonteCarloSection portfolioDaily={series(600)} n={600} strategyCount={3} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MC_DEBOUNCE_MS);
    });
    await act(async () => {
      d.resolve(okResult({ n: 600 }));
    });
    expect(screen.queryByTestId("mc-short-history")).not.toBeInTheDocument();
  });

  it("worker rejects ⇒ honest worker-error state (never a fabricated band)", async () => {
    const d = deferred<MonteCarloResult>();
    runnerMock.mockReturnValue({ promise: d.promise, cancel: vi.fn() });
    render(<MonteCarloSection portfolioDaily={series(120)} n={120} strategyCount={3} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MC_DEBOUNCE_MS);
    });
    await act(async () => {
      d.reject(new Error("boom"));
    });
    expect(screen.getByText("Couldn't run the simulation")).toBeInTheDocument();
    expect(screen.queryByTestId("montecarlo-band-chart")).not.toBeInTheDocument();
  });

  it("a synchronous worker-construction failure ⇒ honest error state (never a permanent spinner)", async () => {
    // The runner is built to surface construction failures as a rejected promise,
    // but the section ALSO try/catches the call so even a synchronous throw (a
    // future regression) can never pin the UI on "computing" forever (H1).
    runnerMock.mockImplementation(() => {
      throw new Error("no module worker");
    });
    render(<MonteCarloSection portfolioDaily={series(120)} n={120} strategyCount={3} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MC_DEBOUNCE_MS);
    });
    expect(screen.getByText("Couldn't run the simulation")).toBeInTheDocument();
    expect(screen.queryByTestId("mc-computing")).not.toBeInTheDocument();
  });

  it("worker returns an un-usable ok:false envelope ⇒ worker-error state (defensive)", async () => {
    const d = deferred<MonteCarloResult>();
    runnerMock.mockReturnValue({ promise: d.promise, cancel: vi.fn() });
    render(<MonteCarloSection portfolioDaily={series(120)} n={120} strategyCount={3} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MC_DEBOUNCE_MS);
    });
    await act(async () => {
      d.resolve(
        okResult({ ok: false, reason: "no-usable-n", n: null, bands: null, terminal: null, medianKey: null }),
      );
    });
    expect(screen.getByText("Couldn't run the simulation")).toBeInTheDocument();
  });

  it("terminal renders em-dash, not 0, when a bound is null (engine never fabricates)", async () => {
    const d = deferred<MonteCarloResult>();
    runnerMock.mockReturnValue({ promise: d.promise, cancel: vi.fn() });
    render(<MonteCarloSection portfolioDaily={series(120)} n={120} strategyCount={3} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MC_DEBOUNCE_MS);
    });
    await act(async () => {
      // a malformed terminal with a null bound — formatPercent must render "—".
      d.resolve(okResult({ terminal: { median: 0.08, lo: null as unknown as number, hi: 0.4 } }));
    });
    const terminal = screen.getByTestId("mc-terminal").textContent ?? "";
    expect(terminal).toContain("—");
    expect(terminal).not.toContain("0.0%");
  });
});

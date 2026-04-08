import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the hardening guarantees on src/lib/puppeteer.ts:
 *
 *   1. `launchBrowser()` wraps `puppeteer.launch(...)` in a 10s race so a
 *      hanging Chromium cold-start can't take down the whole lambda.
 *   2. `acquirePdfSlot()` enforces a module-level semaphore (max 2 concurrent
 *      PDF generations) with a 15s queue timeout so a burst of requests
 *      can't OOM the lambda.
 *
 * The launch-timeout test mocks puppeteer-core to return a never-resolving
 * promise and uses fake timers to advance past the 10s threshold. The
 * semaphore test uses the exported `__resetPdfSemaphoreForTests` helper to
 * ensure clean state between cases.
 */

// We need the dynamic import of `puppeteer-core` to return our mock.
vi.mock("puppeteer-core", () => ({
  launch: vi.fn(),
}));

describe("launchBrowser() timeout guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("rejects with a clear error within ~10.5s if puppeteer.launch hangs", async () => {
    const puppeteer = await import("puppeteer-core");
    // Return a promise that never resolves — simulates a Chromium cold-start
    // hang on Vercel.
    const neverResolving = new Promise(() => {});
    vi.mocked(puppeteer.launch).mockReturnValue(
      neverResolving as unknown as ReturnType<typeof puppeteer.launch>,
    );

    const { launchBrowser } = await import("./puppeteer");

    const launchPromise = launchBrowser();
    // Attach a catch synchronously so the rejection isn't flagged as
    // unhandled while the fake timer is still counting.
    const resultPromise = launchPromise.catch((err: Error) => err);

    // Advance past the 10s timeout.
    await vi.advanceTimersByTimeAsync(10_500);

    const result = await resultPromise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/timed out after 10000ms/i);
  });
});

describe("acquirePdfSlot() concurrency semaphore", () => {
  beforeEach(async () => {
    const { __resetPdfSemaphoreForTests } = await import("./puppeteer");
    __resetPdfSemaphoreForTests();
  });

  it("lets the first two concurrent acquires through immediately", async () => {
    const { acquirePdfSlot } = await import("./puppeteer");
    const release1 = await acquirePdfSlot();
    const release2 = await acquirePdfSlot();
    expect(typeof release1).toBe("function");
    expect(typeof release2).toBe("function");
    // Clean up so we don't affect later tests.
    release1();
    release2();
  });

  it("queues the third acquire and releases it when slot 1 frees up", async () => {
    const { acquirePdfSlot } = await import("./puppeteer");
    const release1 = await acquirePdfSlot();
    const release2 = await acquirePdfSlot();

    let thirdResolved = false;
    const thirdPromise = acquirePdfSlot().then((release) => {
      thirdResolved = true;
      return release;
    });

    // Let microtasks run — the third should still be waiting.
    await Promise.resolve();
    expect(thirdResolved).toBe(false);

    release1();
    const release3 = await thirdPromise;
    expect(thirdResolved).toBe(true);

    release2();
    release3();
  });

  it("times out the queued caller with a clear error after 15s", async () => {
    vi.useFakeTimers();
    const { acquirePdfSlot, PDF_QUEUE_TIMEOUT_MESSAGE } = await import(
      "./puppeteer"
    );
    const release1 = await acquirePdfSlot();
    const release2 = await acquirePdfSlot();

    const thirdPromise = acquirePdfSlot().catch((err: Error) => err);

    // Advance past the 15s queue timeout without releasing either slot.
    await vi.advanceTimersByTimeAsync(15_500);

    const result = await thirdPromise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe(PDF_QUEUE_TIMEOUT_MESSAGE);

    release1();
    release2();
    vi.useRealTimers();
  });
});

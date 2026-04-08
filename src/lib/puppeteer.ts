import type { Browser, Page } from "puppeteer-core";

const DEFAULT_MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEFAULT_LINUX_CHROME = "/usr/bin/google-chrome";

/**
 * Hard cap on how long `puppeteer.launch(...)` is allowed to block before we
 * give up and return an error. Any Chromium cold-start that exceeds this is a
 * zombie — on Vercel's serverless runtime a hanging launch takes down the
 * whole lambda until the platform kills it, which back-pressures every other
 * PDF request queued behind it. 10 seconds is well above the observed p99
 * launch time (~1.5 s on Vercel) so legitimate boots are never interrupted.
 */
const LAUNCH_TIMEOUT_MS = 10_000;

/**
 * Default per-page timeouts applied to every page returned by `launchPage`.
 * These cap `page.goto`, `page.waitForSelector`, etc., so a page that never
 * reaches networkidle0 still fails fast instead of sitting for minutes.
 */
const PAGE_DEFAULT_TIMEOUT_MS = 15_000;

/**
 * PDF concurrency semaphore — caps the number of simultaneously-running
 * Chromium launches at 2. Each launch spawns ~150-200 MB of Chromium; without
 * a cap, the first newsletter with a tearsheet link can OOM the lambda. We
 * queue the 3rd+ caller for up to `QUEUE_TIMEOUT_MS` then reject so the route
 * can 503 instead of hanging indefinitely.
 *
 * The counter is module-level (per-lambda-instance) which is the right scope:
 * a single lambda should not saturate itself. Cross-lambda rate limiting is
 * PR 2's job (Upstash).
 */
const MAX_CONCURRENT_PDFS = 2;
const QUEUE_TIMEOUT_MS = 15_000;

/** Exported so tests can override (and reset via the helper below). */
export const PDF_QUEUE_TIMEOUT_MESSAGE = "PDF concurrency queue timeout";

let activeBrowsers = 0;
const waiters: Array<() => void> = [];

/**
 * Acquire a PDF generation slot. Resolves with a release function that MUST
 * be called in a `finally` block, even on the error path. If too many
 * concurrent requests are in flight, waits up to `QUEUE_TIMEOUT_MS` for a
 * slot to free up; on timeout, rejects with a known error message that
 * callers can catch and translate to a 503.
 */
export async function acquirePdfSlot(): Promise<() => void> {
  if (activeBrowsers < MAX_CONCURRENT_PDFS) {
    activeBrowsers++;
    return releasePdfSlot;
  }

  return new Promise<() => void>((resolve, reject) => {
    const onReady = () => {
      clearTimeout(timeout);
      activeBrowsers++;
      resolve(releasePdfSlot);
    };
    const timeout = setTimeout(() => {
      const idx = waiters.indexOf(onReady);
      if (idx >= 0) waiters.splice(idx, 1);
      reject(new Error(PDF_QUEUE_TIMEOUT_MESSAGE));
    }, QUEUE_TIMEOUT_MS);
    waiters.push(onReady);
  });
}

function releasePdfSlot() {
  activeBrowsers--;
  const next = waiters.shift();
  if (next) next();
}

/** Test helper — resets the semaphore state between tests. */
export function __resetPdfSemaphoreForTests() {
  activeBrowsers = 0;
  waiters.length = 0;
}

/**
 * Launch a headless Chromium browser that works on both Vercel's serverless
 * runtime and local dev. On serverless it uses @sparticuz/chromium (a
 * pre-compiled, size-optimized Chromium build for Lambda). Locally it uses
 * the system Chrome binary — override via `PUPPETEER_EXECUTABLE_PATH`.
 *
 * Wraps `puppeteer.launch(...)` in a `Promise.race` against a 10-second
 * timeout — see `LAUNCH_TIMEOUT_MS` above for the rationale.
 *
 * The caller is responsible for closing the browser in a finally block.
 */
export async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");

  const isServerless =
    !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  const launchPromise: Promise<Browser> = isServerless
    ? (async () => {
        const chromium = (await import("@sparticuz/chromium")).default;
        return puppeteer.launch({
          args: chromium.args,
          defaultViewport: chromium.defaultViewport,
          executablePath: await chromium.executablePath(),
          headless: true,
        });
      })()
    : (async () => {
        const localPath =
          process.env.PUPPETEER_EXECUTABLE_PATH ||
          (process.platform === "darwin"
            ? DEFAULT_MAC_CHROME
            : DEFAULT_LINUX_CHROME);
        return puppeteer.launch({
          headless: true,
          executablePath: localPath,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
      })();

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Chromium launch timed out after ${LAUNCH_TIMEOUT_MS}ms — aborting to protect the lambda`,
        ),
      );
    }, LAUNCH_TIMEOUT_MS);
  });

  try {
    return await Promise.race([launchPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

/**
 * Convenience helper: launch a browser, open a new page, and apply the
 * default navigation + action timeouts so a slow target never hangs past
 * PAGE_DEFAULT_TIMEOUT_MS. Returns both so the caller can still close the
 * browser in a finally block.
 */
export async function launchPage(): Promise<{ browser: Browser; page: Page }> {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(PAGE_DEFAULT_TIMEOUT_MS);
  page.setDefaultTimeout(PAGE_DEFAULT_TIMEOUT_MS);
  return { browser, page };
}

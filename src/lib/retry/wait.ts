/**
 * Abort-aware sleep (B20; extracted verbatim from `useMandateAutoSave`, H-0382).
 *
 * Sleep for `ms`, resolving early (and detaching its listener) if `signal`
 * aborts — so an unmount during a backoff / retry-after sleep does not pin the
 * awaiting coroutine (and its captured state setters) alive until the timer
 * fires. Resolves rather than rejects on abort so callers' existing post-wait
 * `signal.aborted` checks handle the cancellation uniformly.
 */
export function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => resolve();
    setTimeout(() => {
      // Normal timer-fire: detach the abort listener so it cannot accumulate on
      // a long-lived signal across repeated backoff sleeps ({ once: true } only
      // auto-removes it if `abort` actually fires).
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    // On abort, onAbort resolves immediately — freeing the awaiting caller so its
    // post-wait `signal.aborted` check returns — and { once: true } detaches the
    // listener. The pending timer then fires harmlessly into the settled promise.
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

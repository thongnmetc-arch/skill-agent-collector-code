export interface SchedulerOptions {
  /** job executed once per iteration (first run happens immediately) */
  runOnce: () => Promise<void> | void;
  /** pause between iterations in milliseconds */
  intervalMs: number;
  /** stop after this many runs (default: run forever) */
  maxRuns?: number;
  /** abort signal; a pending sleep resolves promptly when aborted */
  signal?: AbortSignal;
  /** injected sleep for deterministic tests */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface SchedulerResult {
  runs: number;
  aborted: boolean;
}

export async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run the collection job immediately, then every intervalMs until maxRuns
 * is reached or the signal aborts. Deterministic under injected sleep.
 */
export async function runScheduler(options: SchedulerOptions): Promise<SchedulerResult> {
  const {
    runOnce,
    intervalMs,
    maxRuns = Number.POSITIVE_INFINITY,
    signal,
    sleep = defaultSleep,
  } = options;
  let runs = 0;
  while (runs < maxRuns) {
    if (signal?.aborted) break;
    await runOnce();
    runs += 1;
    if (runs >= maxRuns) break;
    await sleep(intervalMs, signal);
  }
  return { runs, aborted: signal?.aborted ?? false };
}

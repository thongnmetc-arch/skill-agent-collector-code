import { test } from "node:test";
import assert from "node:assert/strict";
import { runScheduler, defaultSleep } from "../src/scheduler.ts";

test("scheduler: maxRuns terminates and sleeps maxRuns-1 times", async () => {
  let runs = 0;
  let sleepCalls = 0;
  const result = await runScheduler({
    runOnce: () => {
      runs += 1;
    },
    intervalMs: 1,
    maxRuns: 3,
    sleep: async () => {
      sleepCalls += 1;
    },
  });
  assert.equal(result.runs, 3);
  assert.equal(result.aborted, false);
  assert.equal(runs, 3);
  assert.equal(sleepCalls, 2);
});

test("scheduler: abort during sleep returns promptly", async () => {
  const controller = new AbortController();
  let runs = 0;
  const result = await runScheduler({
    runOnce: () => {
      runs += 1;
      if (runs === 1) controller.abort();
    },
    intervalMs: 60_000, // would hang if abort did not cut the sleep short
    signal: controller.signal,
    sleep: defaultSleep,
  });
  assert.equal(result.runs, 1);
  assert.equal(result.aborted, true);
  assert.equal(runs, 1);
});

test("scheduler: aborted before start performs no runs", async () => {
  const controller = new AbortController();
  controller.abort();
  let runs = 0;
  const result = await runScheduler({
    runOnce: () => {
      runs += 1;
    },
    intervalMs: 1,
    maxRuns: 5,
    signal: controller.signal,
    sleep: async () => {},
  });
  assert.equal(result.runs, 0);
  assert.equal(runs, 0);
});

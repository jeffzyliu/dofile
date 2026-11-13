// The goto retry (fixtures.ts, retryFirstGoto): a fresh page's first navigation that times out is tried once more;
// nothing else is. The page is a stand-in whose goto fails as scripted, because a real stalled navigation does not repeat
// the same way in each engine (Chromium aborts the retry while the stalled request is still pending); no browser is
// needed and each test takes a moment. The fixture itself is exercised by every other spec's page.goto.
import { errors, type Page } from "@playwright/test";
import { expect, retryFirstGoto, test } from "./fixtures";

/** A page at `url()` whose goto calls take the next of `outcomes` (an Error to throw, or "ok"); `calls` counts them. */
function fakePage(url: string, outcomes: (Error | "ok")[]) {
  const calls: unknown[][] = [];
  const page = {
    url: () => url,
    goto: async (...args: unknown[]) => {
      calls.push(args);
      const outcome = outcomes.shift() ?? "ok";
      if (outcome !== "ok") throw outcome;
      return null;
    },
  };
  retryFirstGoto(page as unknown as Page);
  return { page: page as unknown as Page, calls };
}

/** Collect what console.log prints while `run` runs. */
async function logged(run: () => Promise<unknown>) {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    await run();
  } finally {
    console.log = log;
  }
  return lines;
}

const timeout = () => new errors.TimeoutError("page.goto: Timeout 60000ms exceeded.");

test("goto: a timeout on about:blank is retried once, with the same arguments, and logs it", async () => {
  const { page, calls } = fakePage("about:blank", [timeout()]);
  const lines = await logged(() => page.goto("?test", { timeout: 5 }));
  expect(calls).toEqual([
    ["?test", { timeout: 5 }],
    ["?test", { timeout: 5 }],
  ]);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("?test");
  expect(lines[0]).toContain("retrying");
});

test("goto: a second timeout is thrown after one retry", async () => {
  const { page, calls } = fakePage("about:blank", [timeout(), timeout(), "ok"]);
  const lines = await logged(() => expect(page.goto("?test")).rejects.toThrow(/Timeout/));
  expect(calls).toHaveLength(2);
  expect(lines).toHaveLength(1);
});

test("goto: an error that is not a timeout is not retried", async () => {
  const { page, calls } = fakePage("about:blank", [new Error("net::ERR_FAILED")]);
  const lines = await logged(() => expect(page.goto("?test")).rejects.toThrow(/ERR_FAILED/));
  expect(calls).toHaveLength(1);
  expect(lines).toHaveLength(0);
});

test("goto: a timeout on a page that has left about:blank is not retried", async () => {
  const { page, calls } = fakePage("http://localhost/app/?test", [timeout()]);
  const lines = await logged(() => expect(page.goto("?test")).rejects.toThrow(/Timeout/));
  expect(calls).toHaveLength(1);
  expect(lines).toHaveLength(0);
});

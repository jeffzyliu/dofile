// What the status bar and the phone's strip say (editor/status.ts): each engine state's words in both forms, the last
// run's words, the memory, the graphics ring, and which parts only the desktop's bar has. No DOM.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type StatusForm, type StatusInput, type StatusPart, statusParts } from "../src/app/editor/status.ts";
import type { EngineState, LastRun, RunHead } from "../src/app/types.ts";

const NOW = 100_000;
const AGO = NOW - 3400;
const base: StatusInput = {
  st: { s: "ready" },
  lastRun: null,
  memory: null,
  graphics: null,
  persisted: null,
  snapshot: false,
  since: (t0) => (NOW - t0) / 1000,
  resetsIn: () => 4,
};
const run: RunHead = { kind: "selection", path: "a.do", lines: [14, 15], fresh_locals: false };

/** The parts in a form a test can read: the state as "<bold>rest", the other parts by their tag and fields. */
const show = (p: StatusPart): string => {
  switch (p.t) {
    case "state":
      return `state ${p.bold ? `<${p.bold}>` : ""}${p.rest ?? ""}`;
    case "timer":
      return `timer ${p.text}`;
    case "lastRun":
      return `lastRun ${JSON.stringify([p.lead, p.rc, p.tail])}`;
    case "graphs":
      return `graphs ${p.percent} ${p.label} | ${p.title}`;
    case "memory":
      return `memory ${p.text}`;
    case "spacer":
      return "spacer";
    case "jump":
      return `jump ${p.line} ${p.path}`;
    case "affiliation":
      return `affiliation ${p.short}`;
    case "note":
      return `note ${p.text}`;
  }
};
const say = (more: Partial<StatusInput>, form: StatusForm) => statusParts({ ...base, ...more }, form).map(show);
const ended = (more: Partial<LastRun> = {}): LastRun =>
  ({ kind: "file", path: "a.do", rc: 0, line: null, seconds: 0.38, ...more }) as LastRun;

/** Every engine state, with its words in the bar and in the strip (the type fails the check for a state left out). */
const states: { [S in EngineState["s"]]: [EngineState & { s: S }, string, string] } = {
  "checking-lock": [{ s: "checking-lock" }, "state <Loading>", "state <Loading>"],
  "checking-cache": [{ s: "checking-cache" }, "state <Loading>", "state <Loading>"],
  none: [{ s: "none" }, "state No engine yet", "state No engine yet"],
  asking: [{ s: "asking" }, "state No engine yet", "state No engine yet"],
  declined: [
    { s: "declined" },
    "state <No engine> · Start engine downloads it",
    "state <No engine> · Start engine downloads it",
  ],
  downloading: [
    { s: "downloading", received: 1, total: 2, t0: AGO },
    "state <Starting> · downloading",
    "state <Starting> · downloading",
  ],
  "starting-list": [
    { s: "starting-list", stage: "download", t0: AGO, done: {} },
    "state <Starting> · downloading the engine (step 1 of 5) · 3.4 s",
    "state <Starting> · downloading the engine (step 1 of 5) · 3.4 s",
  ],
  "starting-worker": [
    { s: "starting-worker", stage: "packages", t0: AGO, done: {} },
    "state <Starting> · loading packages (step 4 of 5) · 3.4 s",
    "state <Starting> · loading packages (step 4 of 5) · 3.4 s",
  ],
  ready: [{ s: "ready" }, "state <Ready>", "state <Ready>"],
  running: [{ s: "running", run, t0: AGO }, "state <Running> lines 14–15 · 3.4 s", "state <Running> lines 14–15"],
  breaking: [
    { s: "breaking", run, t0: AGO, resetAt: NOW + 4000 },
    "state <Stopping> · resets in 4 s",
    "state <Stopping> · resets in 4 s · 3.4 s",
  ],
  waiting: [
    { s: "waiting", run, t0: AGO },
    "state <Waiting> · Break after this command",
    "state <Waiting> · Break after this command · 3.4 s",
  ],
  failed: [
    { s: "failed", reason: "unknown", detail: "", message: "" },
    "state <Not started> · the engine didn't start",
    "state <Not started> · the engine didn't start",
  ],
  "failed-twice": [
    { s: "failed-twice", reason: "unknown", detail: "", message: "" },
    "state <Stopped> · failed twice",
    "state <Stopped> · failed twice",
  ],
  "other-tab-idle": [
    { s: "other-tab-idle" },
    "state <Paused> · another tab has the engine",
    "state <Paused> · another tab has the engine",
  ],
  "other-tab-taking": [
    { s: "other-tab-taking" },
    "state <Paused> · another tab has the engine",
    "state <Paused> · another tab has the engine",
  ],
};

test("each state's words: the bar says the run's timer, the strip leaves it out", () => {
  const noLines: EngineState = { s: "running", run: { kind: "file", fresh_locals: true }, t0: AGO };
  assert.equal(say({ st: noLines }, "full")[0], "state <Running> · 3.4 s");
  assert.equal(say({ st: noLines }, "short")[0], "state <Running>");
  for (const [st, full, short] of Object.values(states)) {
    assert.equal(say({ st }, "full")[0], full, st.s);
    assert.equal(say({ st }, "short")[0], short, st.s);
  }
});

test("a start's words count its step: the stages of the snapshot start and of the normal start", () => {
  const step = (stage: "unpack" | "packages", snapshot: boolean) =>
    say({ st: { s: "starting-worker", stage, t0: AGO, done: {} }, snapshot }, "full")[0];
  assert.equal(step("unpack", true), "state <Starting> · unpacking the engine (step 2 of 5) · 3.4 s");
  assert.equal(step("packages", false), "state <Starting> · loading packages (step 4 of 5) · 3.4 s");
  const list: EngineState = { s: "starting-list", stage: "download", t0: AGO, done: {} };
  assert.equal(say({ st: list }, "short")[0], "state <Starting> · downloading the engine (step 1 of 5) · 3.4 s");
});

test("Break: the bar has its timer beside the words, the strip after them", () => {
  const breaking: EngineState = { s: "breaking", run, t0: AGO, resetAt: NOW + 4000 };
  const waiting: EngineState = { s: "waiting", run, t0: AGO };
  assert.deepEqual(say({ st: breaking }, "full").slice(0, 2), ["state <Stopping> · resets in 4 s", "timer 3.4 s"]);
  assert.deepEqual(say({ st: waiting }, "full").slice(0, 2), [
    "state <Waiting> · Break after this command",
    "timer 3.4 s",
  ]);
  assert.deepEqual(say({ st: breaking }, "short"), ["state <Stopping> · resets in 4 s · 3.4 s"]);
  assert.deepEqual(say({ st: waiting }, "short"), ["state <Waiting> · Break after this command · 3.4 s"]);
  assert.equal(
    say({ st: { s: "running", run, t0: AGO } }, "full").some((s) => s.startsWith("timer")),
    false,
  );
});

test("the bar's whole line: state, last run, memory, spacer, affiliation, the files note", () => {
  const withAll = {
    lastRun: ended({ rc: 111, line: 17 }),
    memory: { heap_bytes: 612e6, data_bytes: 0 },
    persisted: true,
  };
  assert.deepEqual(say(withAll, "full"), [
    "state <Ready>",
    'lastRun ["Last run: whole file (started with no locals) · ","r(111)"," at line 17 · 0.38 s"]',
    "memory Engine memory 612 MB",
    "spacer",
    "affiliation Not affiliated with StataCorp",
    "note Files are kept in this browser",
  ]);
  assert.equal(say({ persisted: false }, "full").at(-1), "note Files may be cleared by this browser");
  assert.equal(say({ persisted: null }, "full").at(-1), "affiliation Not affiliated with StataCorp");
  const loading: EngineState = { s: "starting-worker", stage: "files", t0: AGO, done: {} };
  assert.equal(say({ st: loading, persisted: true }, "full").at(-1), "note You can edit and upload while it starts");
});

test("the last run in the bar: a file, a Break, a selection, a command, a run that went well", () => {
  const last = (r: LastRun) => say({ lastRun: r }, "full")[1];
  assert.equal(last(ended()), 'lastRun ["Last run: whole file (started with no locals) · ",null,"0.38 s"]');
  assert.equal(
    last(ended({ rc: 1, line: 3, seconds: 18.4 })),
    'lastRun ["Last run: stopped by Break · ","r(1)"," · 18.4 s"]',
  );
  assert.equal(last(ended({ kind: "selection", lines: [6, 7] })), 'lastRun ["Last run: lines 6–7 · ",null,"0.38 s"]');
  const command = ended({ kind: "command", path: undefined, rc: 111, line: 1 });
  assert.equal(last(command), 'lastRun ["Last run: a command · ","r(111)"," · 0.38 s"]');
  assert.equal(say({ lastRun: ended() }, "full").length, 4, "state, last run, spacer, affiliation");
});

test("the strip's last run, shorter: the rc, then the line and the time, and Go to line where the file has one", () => {
  const strip = (r: LastRun) => say({ lastRun: r, memory: { heap_bytes: 612e6, data_bytes: 0 } }, "short");
  assert.deepEqual(strip(ended({ rc: 111, line: 17 })), [
    'lastRun ["","r(111)","line 17 · 0.38 s"]',
    "memory Engine 612 MB",
    "spacer",
    "jump 17 a.do",
  ]);
  assert.deepEqual(strip(ended({ rc: 1, line: 3, seconds: 18.4 })), [
    'lastRun ["","r(1)","before line 3 · 18.4 s"]',
    "memory Engine 612 MB",
    "spacer",
    "jump 3 a.do",
  ]);
  assert.deepEqual(strip(ended()), ['lastRun ["Last run: ",null,"0.38 s"]', "memory Engine 612 MB", "spacer"]);
  const command = ended({ kind: "command", path: undefined, rc: 111, line: 1 });
  assert.deepEqual(strip(command), ['lastRun ["","r(111)","0.38 s"]', "memory Engine 612 MB", "spacer"]);
  assert.deepEqual(say({ lastRun: ended({ rc: 111, line: null }) }, "short"), [
    'lastRun ["","r(111)","0.38 s"]',
    "spacer",
  ]);
});

test("the strip says the state's words where it has no last run, and when a run is on", () => {
  const memory = { heap_bytes: 1612e6, data_bytes: 0 };
  assert.deepEqual(say({ memory }, "short"), ["state <Ready>", "memory Engine 1,612 MB"]);
  assert.deepEqual(say({ st: { s: "running", run, t0: AGO }, lastRun: ended(), memory }, "short"), [
    "state <Running> lines 14–15",
    "memory Engine 1,612 MB",
  ]);
});

test("the strip has no affiliation, no files note and no separate timer, in any state", () => {
  const withAll = { lastRun: ended(), persisted: true, memory: { heap_bytes: 1, data_bytes: 0 } };
  for (const [st] of Object.values(states)) {
    for (const t of ["timer", "affiliation", "note"]) {
      assert.equal(
        say({ st, ...withAll }, "short").some((s) => s.startsWith(t)),
        false,
        `${st.s} ${t}`,
      );
    }
  }
});

test("Graphs loading: its percent and words while the part downloads, only for an engine that is up", () => {
  const fetching = (received: number, total: number) => ({ state: "fetching" as const, received, total });
  const ring = (more: Partial<StatusInput>, form: StatusForm) => say(more, form).filter((s) => s.startsWith("graphs"));
  const words = "graphs 25 Graphs loading, 12.0 of 48.0 MB | 12.0 of 48.0 MB";
  assert.deepEqual(ring({ graphics: fetching(12e6, 48e6) }, "full"), [words]);
  assert.deepEqual(ring({ graphics: fetching(12e6, 48e6) }, "short"), [words]);
  assert.deepEqual(ring({ graphics: fetching(0, 0) }, "full"), [
    "graphs 0 Graphs loading, 0.0 of 0.0 MB | 0.0 of 0.0 MB",
  ]);
  assert.match(ring({ graphics: fetching(60e6, 48e6) }, "full")[0], /^graphs 100 /);
  for (const state of ["pending", "landed", "failed"] as const) {
    assert.deepEqual(ring({ graphics: { state, received: 1, total: 2 } }, "full"), [], state);
  }
  assert.deepEqual(ring({ st: { s: "declined" }, graphics: fetching(1, 2) }, "short"), [], "no engine yet");
  assert.deepEqual(ring({ st: { s: "running", run, t0: AGO }, graphics: fetching(1, 2) }, "short").length, 1);
});

test("where the parts go: the bar puts Graphs loading before the memory, the strip after it", () => {
  const more = {
    memory: { heap_bytes: 612e6, data_bytes: 0 },
    graphics: { state: "fetching" as const, received: 1, total: 2 },
  };
  const kinds = (form: StatusForm) => statusParts({ ...base, ...more, lastRun: ended() }, form).map((p) => p.t);
  assert.deepEqual(kinds("full"), ["state", "lastRun", "graphs", "memory", "spacer", "affiliation"]);
  assert.deepEqual(kinds("short"), ["lastRun", "memory", "spacer", "graphs"]);
});

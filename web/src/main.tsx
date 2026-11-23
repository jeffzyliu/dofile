// The editor page: builds the transport, the tab lock and the controllers, and renders the layout. It is the only
// module that constructs or connects anything (test/imports.test.ts checks it).
import "./styles/ui.css";
import "./styles/app.css";
import { effect } from "@preact/signals";
import { render } from "preact";
import { App } from "./app/App";
import { activeTab, selection, tabs } from "./app/editor/documents.ts";
import { documentSeeds } from "./app/editor/seeds.ts";
import { breakRun, connectEngine, connectRun, drops, lost, open, reset, start } from "./app/engine.ts";
import { brotli, kbLog, memcap, snapshotStart, testMode } from "./app/env";
import { focusWanted } from "./app/files/FilesPane.tsx";
import { connectFiles } from "./app/files.ts";
import { handlers, runCode } from "./app/run.ts";
import * as S from "./app/state.ts";
import { store } from "./app/store.ts";
import { applyTheme } from "./app/theme.ts";
import { watchViewport } from "./app/viewport.ts";
import { watchWakeLock } from "./app/wakelock.ts";
import { EngineClient } from "./engine/client.ts";
import { capLine } from "./engine/memcap.ts";
import { tabLock } from "./engine/tab.ts";

const here = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, location.href).href;

const client = new EngineClient({
  createWorker: () => new Worker(new URL("./engine/worker.ts", import.meta.url), { type: "module" }),
  wheel: here(__WHEEL__),
  extraWheels: __EXTRA_WHEELS__.map(here),
  buildId: __BUILD_ID__,
  // the snapshot start takes Pyodide's runtime from the page's own origin; ?snapshot=0 uses the CDN
  indexURL: snapshotStart ? here("pyodide/") : __PYODIDE__,
  store,
  startFiles: here("start-files.json"),
  // no fallback when the snapshot is missing or stale: the engine is `failed`, with the cause
  snapshot: snapshotStart ? here("snapshot/") : undefined,
  brotli,
  memcap: memcap.mb,
});
console.info(capLine(memcap));

applyTheme();
const narrow = matchMedia("(max-width: 699.98px)");
const fit = () => {
  S.layout.value = narrow.matches ? "phone" : "desktop";
};
fit();
narrow.addEventListener("change", fit);
// Without ?kblog the overlay's module is not loaded.
const viewport = watchViewport({ enabled: () => S.isPhone.value });
if (kbLog) void import("./app/kblog.ts").then((m) => m.showKbLog());
effect(() => {
  S.isPhone.value;
  viewport.update();
});
watchWakeLock();
// the engine's state on <html>, for the tests
effect(() => {
  document.documentElement.dataset.engine = S.engine.value.s;
});
addEventListener("beforeunload", (e) => {
  if (tabs.value.some((t) => t.dirty)) e.preventDefault();
});

connectFiles(store);
connectRun(handlers);
connectEngine({ client, lock: tabLock({ onLost: lost }), snapshot: snapshotStart, manual: testMode === "manual" });

// The test hook, only with ?test in the URL. With ?test=manual the page starts no engine until the test calls start().
// The store is blocked until the tab lock answers: wait for `!store.blocked` before writing.
const testHook = {
  engine: client,
  store,
  start,
  persisted: () => S.persisted.value,
  engineBytes: S.engineBytes,
  state: { ...S, tabs, activeTab }, // one object: the signals, and the tabs from their owner
  documents: documentSeeds,
  run: (code: string) => runCode(code, { kind: "file", path: "test.do", fresh_locals: true }),
  breakRun,
  reset,
  selection,
  drops,
  focusWanted,
};
/** The type of `window.__dofile`, for e2e/hook.ts. */
export type DofileHook = typeof testHook;
if (testMode !== null) Object.assign(window, { __dofile: testHook });

render(<App />, document.getElementById("app")!);
open();

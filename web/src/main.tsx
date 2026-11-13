// The editor page: the transport, the controllers, the layout. docs/design/SPEC.md is the build spec; app/App.tsx
// says which file holds each part.
//
// This is the only module that constructs or connects anything (test/imports.test.ts checks it): one transport
// (EngineClient) with its worker factory, one tab lock, and connectFiles, connectRun and connectEngine, each once. So
// each of those exists once for each page.
//
// The order at load: the tab lock, then keepFiles() and the store (files listed), then the cache check, and the download
// and the start (asking first unless this build's start files are all in the Cache). A tab without the lock starts no
// worker and writes nothing (`store.blocked`), and shows "dofile is open in another tab"; the tab that loses the lock
// ends its worker and shows the same. All of that is the engine's state machine (engine/machine.ts), which
// app/engine.ts's open() starts.
import "./styles/ui.css";
import "./styles/app.css";
import { effect } from "@preact/signals";
import { render } from "preact";
import { App } from "./app/App";
import { selection } from "./app/editor/commands.ts";
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
  // the snapshot start takes Pyodide's runtime from the page's own origin (public/pyodide/); ?snapshot=0 uses the CDN
  indexURL: snapshotStart ? here("pyodide/") : __PYODIDE__,
  store,
  startFiles: here("start-files.json"), // the build's list of start files, for cached(), download() and build(): the one statement of the build
  // the memory snapshot `npm run snapshot` builds; no fallback when it is missing or stale: the engine is `failed`, with the cause
  snapshot: snapshotStart ? here("snapshot/") : undefined,
  brotli,
  memcap: memcap.mb,
});
console.info(capLine(memcap));

applyTheme();
// the layout follows the width: the phone's under 700 px (SPEC section 2)
const narrow = matchMedia("(max-width: 699.98px)");
const fit = () => {
  S.layout.value = narrow.matches ? "phone" : "desktop";
};
fit();
narrow.addEventListener("change", fit);
// a phone's on-screen keyboard: .app sized to the area above it (app/viewport.ts). ?kblog shows an overlay of the
// viewport's events, to measure the keyboard on a real phone (docs/phone-keyboard-experiment.md); without it the
// overlay's module is not loaded.
const viewport = watchViewport({ enabled: () => S.isPhone.value });
if (kbLog) void import("./app/kblog.ts").then((m) => m.showKbLog());
effect(() => {
  S.isPhone.value;
  viewport.update();
});
// the screen stays awake while the engine works (app/wakelock.ts)
watchWakeLock();
// the engine's state on <html>, for the tests and for CSS that needs it
effect(() => {
  document.documentElement.dataset.engine = S.engine.value.s;
}); // one of the machine's sixteen names
// leaving with unsaved edits gets the browser's own warning (SPEC 3.2)
addEventListener("beforeunload", (e) => {
  if (S.tabs.value.some((t) => t.dirty)) e.preventDefault();
});

connectFiles(store);
connectRun(handlers);
connectEngine({ client, lock: tabLock({ onLost: lost }), snapshot: snapshotStart, manual: testMode === "manual" });

// The test hook, only with ?test in the URL (e2e/step2.spec.ts): the transport (for its facts `worker` and `startup`, and
// cached() and download()), the store, the controller's start (download, then the worker), persisted(), the download
// size; the state signals, a run through the controller, and the controller's Break and Reset (so `breaking` and the
// reset banner run as Break and Reset run them), the editor's `selection` signal (what Run selection and the phone's
// "Run 6–7" read), drops() (the events that changed nothing), and the Files pane's `focusWanted`. With ?test=manual the page starts no engine until the
// test calls start(). Without the flag the object does not exist. The store is blocked until the tab lock answers: wait
// for `!store.blocked` before writing.
if (testMode !== null) {
  Object.assign(window, {
    __dofile: {
      engine: client,
      store,
      start,
      persisted: () => S.persisted.value,
      engineBytes: S.engineBytes,
      state: S,
      run: (code: string) => runCode(code, { kind: "file", path: "test.do", fresh_locals: true }),
      breakRun,
      reset,
      selection,
      drops,
      focusWanted,
    },
  });
}

render(<App />, document.getElementById("app")!);
open();

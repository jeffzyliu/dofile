// The editor page: builds the transport, the tab lock and the controllers, and renders the layout. It is the only
// module that constructs or connects anything (test/imports.test.ts checks it).
import "./styles/ui.css";
import "./styles/app.css";

import { effect } from "@preact/signals";
import { render } from "preact";

import * as Layout from "./app/state/layout.ts";

import { connectEngine, connectRun, lost, open } from "./app/engine.ts";
import { connectFiles } from "./app/files.ts";
import { handlers } from "./app/run.ts";
import { store } from "./app/store.ts";
import { EngineClient } from "./engine/client.ts";
import { capLine } from "./engine/memcap.ts";
import { tabLock } from "./engine/tab.ts";

import { tabs } from "./app/editor/documents.ts";

import { App } from "./app/App";
import { brotli, kbLog, memcap, snapshotStart, testMode } from "./app/env";
import { applyTheme } from "./app/theme.ts";
import { watchViewport } from "./app/viewport.ts";
import { watchWakeLock } from "./app/wakelock.ts";

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
  Layout.setLayout(narrow.matches ? "phone" : "desktop");
};
fit();
narrow.addEventListener("change", fit);

const viewport = watchViewport({ enabled: () => Layout.isPhone.value });
effect(() => {
  Layout.isPhone.value;
  viewport.update();
});
// Without ?kblog the overlay's module is not loaded.
if (kbLog) void import("./app/kblog.ts").then((m) => m.showKbLog());

watchWakeLock();
addEventListener("beforeunload", (e) => {
  if (tabs.value.some((t) => t.dirty)) e.preventDefault();
});

connectFiles(store);
connectRun(handlers);
connectEngine({ client, lock: tabLock({ onLost: lost }), snapshot: snapshotStart, manual: testMode === "manual" });

// The test hook and what only it needs (the tab seeds, <html data-engine>): a module loaded only with ?test in the URL.
// With ?test=manual the page starts no engine until the test calls start().
if (testMode !== null) (await import("./app/test-hook.ts")).installTestHook(client);

render(<App />, document.getElementById("app")!);
open();

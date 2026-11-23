// Everything the page has only for the e2e tests, in one module that main.tsx loads only with ?test in the URL (as it
// loads kblog.ts only with ?kblog): the hook `window.__dofile`, the tab seeds behind it, and the engine's state on <html>.
// Without the flag none of it is loaded, so none of it runs (test/test-hook.test.ts).
import { effect } from "@preact/signals";

import * as Engine from "./state/engine.ts";
import * as Files from "./state/files.ts";

import type { EngineClient } from "../engine/client.ts";
import { breakRun, drops, reset, start } from "./engine.ts";
import { runCode } from "./run.ts";
import { store } from "./store.ts";

import { selection } from "./editor/documents.ts";
import { documentSeeds } from "./editor/seeds.ts";
import { focusWanted } from "./files/tree-state.ts";

import { hookState } from "./hook-state.ts";

/** Set `window.__dofile` and keep `<html data-engine>` at the engine's state name (no CSS reads it). With ?test=manual the
 *  page starts no engine until the test calls start(). The store is blocked until the tab lock answers: wait for
 *  `!store.blocked` before writing. */
export function installTestHook(client: EngineClient) {
  const hook = {
    engine: client,
    store,
    start,
    persisted: () => Files.persisted.value,
    engineBytes: Engine.engineBytes,
    state: hookState(),
    documents: documentSeeds,
    run: (code: string) => runCode(code, { kind: "file", path: "test.do", fresh_locals: true }),
    breakRun,
    reset,
    selection,
    drops,
    focusWanted,
  };
  effect(() => {
    document.documentElement.dataset.engine = Engine.engine.value.s;
  });
  Object.assign(window, { __dofile: hook });
  return hook;
}

/** The type of `window.__dofile`, for e2e/hook.ts. */
export type DofileHook = ReturnType<typeof installTestHook>;

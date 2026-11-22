// The worker's start (src/engine/worker-boot.ts) without Pyodide: the fetches and the Cache, how a failed start is
// named (the page's reason comes from the error's name: reasonOf in client.ts), the order of the stages, and `boot`'s
// steps on a stand-in Pyodide. engine.test.ts runs the real start.

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { pathToFileURL } from "node:url";
import type { SnapshotPy } from "../src/engine/snapshot.ts";
import { isStorageRefusal } from "../src/engine/snapshot.ts";
import type { MountArgs, Stage, Startup } from "../src/engine/types.ts";
import { ROOT } from "../src/engine/work-mirror.ts";
import type { Browser } from "../src/engine/worker-boot.ts";
import { fetchBytes, snapshotCache, startEngine, startPython, watchFetch } from "../src/engine/worker-boot.ts";

const realFetch = globalThis.fetch;
const realCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realCaches) Object.defineProperty(globalThis, "caches", realCaches);
  else delete (globalThis as { caches?: CacheStorage }).caches;
});

const named = (name: string, message = name) => Object.assign(new Error(message), { name });
const bytes = (text: string) => new TextEncoder().encode(text);
/** A Cache holding `entries` (URL to text); `match` alone is what the worker uses. */
const cacheOf = (entries: Record<string, string> = {}) =>
  ({
    match: async (url: string) => (url in entries ? new Response(entries[url]) : undefined),
    delete: async () => true,
  }) as unknown as Cache;
/** fetch answered by `answer`, the URLs it was asked for in `asked`. */
function stubFetch(answer: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String((input as Request)?.url ?? input);
    asked.push(url);
    return answer(url, init);
  }) as typeof fetch;
  return asked;
}
const setCaches = (caches: Partial<CacheStorage> | undefined) =>
  Object.defineProperty(globalThis, "caches", { value: caches, configurable: true, writable: true });

test("fetchBytes: a cached file is read from the Cache, not the network", async () => {
  const asked = stubFetch(() => new Response("network"));
  const out = await fetchBytes("https://x.test/a.bin", cacheOf({ "https://x.test/a.bin": "cached" }));
  assert.deepEqual(out, bytes("cached"));
  assert.deepEqual(asked, []);
});

test("fetchBytes: a file: URL is read from disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "worker-boot-"));
  await writeFile(join(dir, "f.bin"), "on disk");
  assert.deepEqual(await fetchBytes(pathToFileURL(join(dir, "f.bin")).href), bytes("on disk"));
});

test("fetchBytes: a missing file and a failed fetch are a DownloadError naming the URL", async () => {
  stubFetch(() => new Response("no", { status: 404 }));
  await assert.rejects(fetchBytes("https://x.test/gone.bin"), {
    name: "DownloadError",
    message: "https://x.test/gone.bin: 404",
  });
  stubFetch(() => {
    throw new TypeError("network down");
  });
  await assert.rejects(fetchBytes("https://x.test/a.bin"), {
    name: "DownloadError",
    message: "https://x.test/a.bin: network down",
  });
  const own = named("DownloadError", "said by watchFetch");
  stubFetch(() => {
    throw own;
  });
  await assert.rejects(fetchBytes("https://x.test/a.bin"), (e) => e === own);
});

test("watchFetch: GETs read the Cache first, a .wasm gets its Content-Type, restore() puts fetch back", async () => {
  const asked = stubFetch(() => new Response("net"));
  const replaced = globalThis.fetch;
  const fetches = watchFetch({ cache: cacheOf({ "https://x.test/p.wasm": "wasm bytes" }) });
  assert.notEqual(globalThis.fetch, replaced);
  const hit = await fetch("https://x.test/p.wasm");
  assert.equal(await hit.text(), "wasm bytes");
  assert.equal(hit.headers.get("Content-Type"), "application/wasm");
  assert.equal(await (await fetch("https://x.test/other.js")).text(), "net");
  await fetch("https://x.test/p.wasm", { method: "POST" }); // not a GET: never from the Cache
  assert.deepEqual(asked, ["https://x.test/other.js", "https://x.test/p.wasm"]);
  fetches.restore();
  assert.equal(globalThis.fetch, replaced);
});

test("watchFetch: a failed or missing fetch rejects `failed` with a DownloadError (Pyodide's loader would wait)", {
  timeout: 10_000,
}, async () => {
  stubFetch(() => new Response("no", { status: 404 }));
  let fetches = watchFetch();
  const res = await fetch("https://x.test/pyodide.asm.wasm");
  assert.equal(res.status, 404); // the loader still gets its answer
  await assert.rejects(fetches.failed, { name: "DownloadError", message: "https://x.test/pyodide.asm.wasm: 404" });
  fetches.restore();
  stubFetch(() => {
    throw new TypeError("offline");
  });
  fetches = watchFetch();
  await assert.rejects(fetch("https://x.test/a.js"), { name: "DownloadError" });
  await assert.rejects(fetches.failed, { name: "DownloadError", message: "https://x.test/a.js: offline" });
  fetches.restore();
});

test("snapshotCache: no Cache API, or a refusal, is reported and gives no Cache", async () => {
  const seen: Error[] = [];
  setCaches(undefined);
  assert.equal(await snapshotCache(1, (e) => seen.push(e)), undefined);
  setCaches({ keys: async () => [], open: async () => Promise.reject(named("SecurityError")) });
  assert.equal(await snapshotCache(1, (e) => seen.push(e)), undefined);
  assert.deepEqual(
    seen.map((e) => e.name),
    ["NoCacheAPI", "SecurityError"],
  );
  assert.ok(seen.every(isStorageRefusal));
});

const SNAP = "https://x.test/snapshot/";
const mountArgs: MountArgs = {
  snapshot: SNAP,
  built: 7,
  files: {
    snapshot: { name: "snapshot.bin.br", raw: 10, size: 5 },
    bundle: { name: "bundle.tar.br", raw: 10, size: 5 },
  },
};

test("startPython: a missing start file ends the snapshot start with a DownloadError after the download stage", async () => {
  setCaches({ keys: async () => [], open: async () => cacheOf() });
  const asked = stubFetch(() => new Response("no", { status: 404 }));
  const stages: Stage[] = [];
  const startup: Partial<Startup> = {};
  const before = globalThis.fetch;
  await assert.rejects(
    startPython(mountArgs, (s) => stages.push(s), startup),
    (e: Error) => e.name === "DownloadError" && e.message.endsWith(": 404"),
  );
  assert.deepEqual(stages, ["download"]);
  assert.ok(asked.includes(`${SNAP}snapshot.bin.br`));
  assert.equal(globalThis.fetch, before); // watchFetch restored
  assert.deepEqual(startup, {});
});

test("startPython: a refused Cache still fetches; a Cache that breaks otherwise ends the start with its own error", async () => {
  setCaches({ keys: async () => [], open: async () => Promise.reject(named("QuotaExceededError")) });
  const asked = stubFetch(() => new Response("no", { status: 404 }));
  await assert.rejects(
    startPython(mountArgs, () => {}, {}),
    { name: "DownloadError" },
  );
  assert.ok(asked.includes(`${SNAP}snapshot.bin.br`));

  setCaches({ keys: async () => Promise.reject(new TypeError("broken")), open: async () => cacheOf() });
  const asked2 = stubFetch(() => new Response("no", { status: 404 }));
  const stages: Stage[] = [];
  await assert.rejects(
    startPython(mountArgs, (s) => stages.push(s), {}),
    (e: Error) => e.name === "TypeError" && e.message === "broken", // the page's reason "unknown"
  );
  assert.deepEqual(stages, ["download"]);
  assert.deepEqual(asked2, []);
});

test("startPython: the normal boot names its stage first; a memory cap needs indexURL", async () => {
  const stages: Stage[] = [];
  const before = globalThis.fetch;
  await assert.rejects(
    startPython({ memcap: 512 }, (s) => stages.push(s), {}),
    /needs the URL of Pyodide's runtime/,
  );
  assert.deepEqual(stages, ["python"]);
  assert.equal(globalThis.fetch, before);
});

/** A stand-in Pyodide for `boot`: records what is called on it, in order. */
function fakePy() {
  const calls: string[] = [];
  const browser = {
    start: (root: string) => {
      calls.push(`start ${root}`);
      return JSON.stringify({ dofile: "test" });
    },
    keep_breaks: (putBack: () => void) => {
      calls.push("keep_breaks");
      putBack();
    },
  } as unknown as Browser;
  const py = {
    loadPackage: async (name: string) => void calls.push(`loadPackage ${name}`),
    FS: { writeFile: (path: string) => void calls.push(`write ${path}`) },
    globals: { set: (name: string) => void calls.push(`set ${name}`) },
    toPy: (x: unknown) => x,
    runPythonAsync: async (code: string) => void calls.push(`python ${code}`),
    pyimport: (name: string) => {
      calls.push(`import ${name}`);
      return browser;
    },
  } as unknown as SnapshotPy;
  return { py, browser, calls };
}

test("startEngine: the normal boot installs the wheels, then starts the engine in /work; the snapshot start skips the wheels", async () => {
  const { py, browser, calls } = fakePy();
  const stages: Stage[] = [];
  const startup: Partial<Startup> = {};
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  const part = { file: { name: "graphics.tar.br", raw: 1, size: 1 }, sab: null };
  const lazy: unknown[] = [];
  const out = await startEngine(
    py,
    {
      wheel: { name: "dofile.whl", bytes: bytes("w") },
      extraWheels: [{ name: "x.whl", bytes: bytes("x") }],
      interruptBuffer: buffer,
      graphics: part,
    },
    {
      fromSnapshot: false,
      stage: (s) => stages.push(s),
      startup,
      lazyGraphics: (b, g) => {
        calls.push("lazyGraphics");
        lazy.push(b, g);
      },
    },
  );
  assert.deepEqual(stages, ["packages", "engine"]);
  assert.deepEqual(calls, [
    "loadPackage micropip",
    "write /tmp/dofile.whl",
    "write /tmp/x.whl",
    "set wheel_urls",
    "python import micropip; await micropip.install(list(wheel_urls))",
    "import dofile.browser",
    `start ${ROOT}`,
    "keep_breaks",
    "lazyGraphics",
  ]);
  assert.equal(Atomics.load(buffer, 0), 2); // keep_breaks' callback puts a Break back
  assert.deepEqual(lazy, [browser, part]);
  assert.deepEqual(out, { browser, about: { dofile: "test" } });
  assert.deepEqual(Object.keys(startup).sort(), ["engineS", "packagesS"]);

  const snap = fakePy();
  const snapStages: Stage[] = [];
  const snapStartup: Partial<Startup> = {};
  await startEngine(
    snap.py,
    { wheel: "https://x.test/dofile.whl" },
    {
      fromSnapshot: true,
      stage: (s) => snapStages.push(s),
      startup: snapStartup,
      lazyGraphics: () => assert.fail("no part"),
    },
  );
  assert.deepEqual(snapStages, ["engine"]);
  assert.deepEqual(snap.calls, ["import dofile.browser", `start ${ROOT}`]); // no buffer: no keep_breaks
  assert.deepEqual(Object.keys(snapStartup), ["engineS"]);
});

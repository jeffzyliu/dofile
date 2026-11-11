// Shared by the tests: the built wheel, and worker.js in a Node worker thread standing in for a browser's Web Worker.
import assert from "node:assert/strict";
import { MessageChannel, Worker } from "node:worker_threads";
import type { Transferable as NodeTransferable } from "node:worker_threads";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import type { FileStore } from "../src/engine/store.ts";
import type { PendingRow } from "../src/engine/types.ts";

export const root = fileURLToPath(new URL("../..", import.meta.url));
// DOFILE_WHEEL_DIR: a folder with another build of the wheel, to run the tests against it
const dist = process.env.DOFILE_WHEEL_DIR ?? `${root}/dist`;
const wheels = readdirSync(dist).filter(f => f.endsWith(".whl")).sort();
assert.ok(wheels.length, `no wheel in ${dist}: run \`uv build --wheel\` first`);
export const wheel = { name: wheels.at(-1)!, bytes: readFileSync(`${dist}/${wheels.at(-1)}`) };
export const extraWheels = readdirSync(`${root}/web/wheels`).filter(f => f.endsWith(".whl")).map(f => ({ name: f, bytes: readFileSync(`${root}/web/wheels/${f}`) }));

// Every worker started here is ended when the file's tests are done, passed or failed (call endWorkers in `after`): a
// failing assertion skips the test's own terminate(), and a live worker keeps the process (and so `npm test`) from exiting.
const started = new Set<Worker>();
export const endWorkers = () => { for (const w of started) w.terminate(); };

// A Worker as client.js wants it. `store`: the page's FileStore, which the worker thread then uses (node-worker.mjs);
// without it the thread has its own database, and `oldDatabase` puts an IDBFS-style "/work" database there first;
// `noDatabase`: the thread has no IndexedDB at all. port.harness("databases") asks the thread what its IndexedDB holds.
export function nodeWorker({ store, oldDatabase = false, noDatabase = false }:
  { store?: FileStore, oldDatabase?: boolean, noDatabase?: boolean } = {}) {
  const channel = store && new MessageChannel();
  if (channel) {
    channel.port1.on("message", async ({ n, method, args }: { n: number, method: "takeAll" | "done" | "applyRun", args: any[] }) => {
      try {
        channel.port1.postMessage({ n, result: await (store![method] as (...a: any[]) => Promise<unknown>)(...args) });
      } catch (e: any) {
        channel.port1.postMessage({ n, error: { name: e?.name, message: String(e?.message ?? e) } });
      }
    });
    channel.port1.unref();
  }
  const w = new Worker(new URL("./node-worker.ts", import.meta.url), {
    workerData: { script: new URL("../src/engine/worker.ts", import.meta.url).href, storePort: channel?.port2, oldDatabase, noDatabase },
    transferList: channel ? [channel.port2] : [],
  });
  started.add(w);
  const asks: ((what: unknown) => void)[] = [];
  const port = {
    postMessage: (m: unknown, t?: readonly NodeTransferable[]) => w.postMessage(m, t),
    onmessage: null as null | ((e: { data: any }) => void), onerror: null as null | ((e: unknown) => void),
    terminate: () => { channel?.port1.close(); return w.terminate(); },
    harness: (what: string) => new Promise<any>(ok => { asks.push(ok); w.postMessage({ harness: what }); }),
  };
  w.on("message", data => (data?.harness ? asks.shift()!(data.harness) : port.onmessage?.({ data })));
  w.on("error", e => port.onerror?.(e));
  return port as typeof port & globalThis.Worker;   // what client.ts wants of a (Web) Worker
}

// the rows of a store's `pending` journal
export const pendingRows = (store: FileStore) => store.tx(["pending"], "readonly", t => new Promise<PendingRow[]>(ok => {
  const r = t.objectStore("pending").getAll();
  r.onsuccess = () => ok(r.result);
}));

// Make transactions fail as on a full disk: the browser refuses to write a file's bytes. For a thread that has
// fake-indexeddb's globals. Returns the function that ends it (also run when the test `t` ends).
export function refuseWrites(t: TestContext) {
  const proto = IDBObjectStore.prototype, put = proto.put;
  proto.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
    if (this.name === "data") throw new DOMException("the quota has been exceeded", "QuotaExceededError");
    return put.apply(this, args);
  };
  const undo = () => { proto.put = put; };
  t.after(undo);
  return undo;
}

// Make a transaction abort after its requests were taken, the way a real quota error arrives: a request fails later and
// the transaction aborts with that error (here a ConstraintError, from adding the file's key a second time).
export function abortWrites(t: TestContext) {
  const proto = IDBObjectStore.prototype, put = proto.put;
  proto.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
    const request = put.apply(this, args);
    if (this.name === "data") this.add(new ArrayBuffer(1), args[1]);
    return request;
  };
  const undo = () => { proto.put = put; };
  t.after(undo);
  return undo;
}

export const text = (bytes: AllowSharedBufferSource) => new TextDecoder().decode(bytes);
export const bytes = (string: string) => new TextEncoder().encode(string);
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

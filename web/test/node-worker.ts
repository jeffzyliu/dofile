// Runs worker.js in a Node worker thread with the Web Worker globals it uses (self, postMessage, onmessage).
// The file store, one of two ways (workerData):
//   storePort: the test's own store, reached through this port. The database then lives in the test's thread, as it is
//     shared between a page and its worker in a browser: the test can change files while this thread is busy in a run.
//   otherwise: an in-memory IndexedDB of this thread's own (fake-indexeddb), which worker.js opens itself. With
//     oldDatabase, a database as Emscripten's IDBFS left it ("/work") is made first; {harness: "databases"} reports
//     what is there afterwards.
import { parentPort, workerData } from "node:worker_threads";
import type { Transferable as NodeTransferable } from "node:worker_threads";

globalThis.self = globalThis as typeof globalThis.self;
globalThis.postMessage = ((message: unknown, transfer: NodeTransferable[]) => parentPort!.postMessage(message, transfer)) as
  typeof globalThis.postMessage;

const OLD = { name: "/work", version: 21, store: "FILE_DATA", key: "/work/old.do",
  record: { timestamp: new Date(1700000000000), mode: 33206, contents: new TextEncoder().encode("display 1\n") } };
const request = <T>(r: IDBRequest<T>) => new Promise<T>((ok, err) => { r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });

if (workerData.storePort) {
  const port = workerData.storePort, waiting = new Map<number, { ok: (result: unknown) => void, err: (error: Error) => void }>();
  let n = 0;
  port.on("message", ({ n, result, error }: { n: number, result: unknown, error?: { name: string, message: string } }) => {
    const { ok, err } = waiting.get(n)!;
    waiting.delete(n);
    error ? err(Object.assign(new Error(error.message), { name: error.name })) : ok(result);
  });
  const remote = (method: string) => (...args: unknown[]) => new Promise((ok, err) => { waiting.set(++n, { ok, err }); port.postMessage({ n, method, args }); });
  globalThis.dofileStore = Object.fromEntries(["takeAll", "done", "applyRun"].map(m => [m, remote(m)])) as unknown as typeof globalThis.dofileStore;
} else if (!workerData.noDatabase) {   // noDatabase: no IndexedDB at all, as in a browser that refuses storage
  await import("fake-indexeddb/auto");
  if (workerData.oldDatabase) {
    const open = indexedDB.open(OLD.name, OLD.version);
    open.onupgradeneeded = () => open.result.createObjectStore(OLD.store).createIndex("timestamp", "timestamp", { unique: false });
    const db = await request(open);
    await request(db.transaction(OLD.store, "readwrite").objectStore(OLD.store).put(OLD.record, OLD.key));
    db.close();
  }
}

async function databases() {
  const out: Record<string, { version: number | undefined, stores: Record<string, [IDBValidKey, unknown][]> }> = {};
  for (const { name, version } of await indexedDB.databases()) {
    const db = await request(indexedDB.open(name!)), stores: Record<string, [IDBValidKey, unknown][]> = {};
    for (const s of db.objectStoreNames) {
      const t = db.transaction(s, "readonly").objectStore(s);
      const [keys, values] = [await request(t.getAllKeys()), await request(t.getAll())];
      stores[s] = keys.map((k, i): [IDBValidKey, unknown] => [k, values[i]]);
    }
    db.close();
    out[name!] = { version, stores };
  }
  return out;
}

parentPort!.on("message", async data => {
  if (data?.harness === "databases") return parentPort!.postMessage({ harness: await databases() });
  (globalThis.onmessage as ((event: MessageEvent) => void) | null)?.({ data } as MessageEvent);
});
await import(workerData.script);

// The page's handle on the engine worker (worker.js): call(op, args) returns a Promise; run(code), breakRun(), restart().
// Break works like the MCP server's: the interrupt buffer asks the engine to stop at the next safe point (rc 1, data
// kept). If it hasn't stopped after graceMs, the worker is replaced (rc 9998: data in memory is gone, files stay).
// Without a SharedArrayBuffer (a page that isn't cross-origin isolated) Break can only restart.

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const RC_RESET = 9998;

export class EngineClient {
  // createWorker: () => a Worker (in the page: new Worker(new URL("./worker.js", import.meta.url), {type: "module"}))
  // snapshot: the URL (ending in "/") of a snapshot built by scripts/make-snapshot.mjs, to start from instead of
  // installing the packages; the worker refuses one that was built for another wheel.
  // brotli: "wasm" forces brotli-wasm for the snapshot instead of the browser's own decoder (worker.js), to compare them
  // wheelHash: SHA-256 of the wheel; a snapshot whose manifest has another one was built from other code and is refused
  constructor({ createWorker, wheel, wheelHash, indexURL, snapshot, brotli, graceMs = 5000, onStatus = (_status) => {} }) {
    Object.assign(this, { createWorker, wheel, wheelHash, indexURL, snapshot, brotli, graceMs, onStatus });
    this.nextId = 0;
    this.pending = new Map();
    this.running = null;
  }

  async start() {
    this.interrupt = typeof SharedArrayBuffer === "undefined" ? null : new Int32Array(new SharedArrayBuffer(4));
    this.worker = this.createWorker();
    this.worker.onmessage = ({ data }) => {
      if (data.status) return this.onStatus(data.status);
      const p = this.pending.get(data.id);
      if (!p) return;   // an answer from before a restart
      this.pending.delete(data.id);
      "error" in data ? p.reject(new Error(data.error)) : p.resolve(data.result);
    };
    this.worker.onerror = e => this.restart(`the engine crashed (${e?.message ?? e})`);
    // Two steps (see worker.js). Calls the page makes after start() begins, such as files and read, queue behind
    // "mount" in the worker, so they can be made at once: they are answered before the engine has loaded.
    // If a restart happens during a step, that step's answer is the new start()'s result and this one ends with it.
    const gen = this.gen = (this.gen ?? 0) + 1;
    const wheelName = typeof this.wheel === "string" ? this.wheel.split("/").at(-1) : this.wheel.name;
    const mounted = await this.call("mount", { indexURL: this.indexURL, snapshot: this.snapshot, wheelName, wheelHash: this.wheelHash, brotli: this.brotli });
    if (gen !== this.gen) return mounted;
    const about = await this.call("boot", { wheel: this.wheel, interruptBuffer: this.interrupt });
    if (gen !== this.gen) return about;
    this.about = about;
    this.startup = await this.call("startup");   // where the start's time went (worker.js); the page shows it in its status line
    return about;
  }

  call(op, args = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { op, resolve, reject });
      this.worker.postMessage({ id, op, args });
    });
  }

  run(code) {
    const p = this.call("run", { code });
    this.running = p;
    const done = () => { if (this.running === p) this.running = null; };
    p.then(done, done);
    return p;
  }

  // the Break button
  async breakRun() {
    const running = this.running;
    if (!running) return;
    if (this.interrupt) Atomics.store(this.interrupt, 0, 2);   // SIGINT
    const stopped = this.interrupt &&
      await Promise.race([running.then(() => true, () => true), sleep(this.graceMs).then(() => false)]);
    if (!stopped) await this.restart("the code did not stop at Break");
  }

  // a new worker; a run in progress ends with rc 9998, other calls fail. Files in IndexedDB come back.
  async restart(reason) {
    this.worker.terminate();
    const pending = [...this.pending.values()];
    this.pending.clear();
    this.running = null;
    const error = `session reset: ${reason}. Data in memory is gone; your files are kept.`;
    const started = this.start();
    for (const p of pending) {
      if (p.op === "run") p.resolve({ rc: RC_RESET, error, log: "", results: null, images: [] });
      else if (p.op === "mount" || p.op === "boot") p.resolve(started);   // a crash while starting: the first start() ends with the new one
      else p.reject(new Error(error));
    }
    return started;
  }
}

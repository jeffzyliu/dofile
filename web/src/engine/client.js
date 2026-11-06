// The page's handle on the engine worker (worker.js): call(op, args) returns a Promise; run(code), breakRun(), restart().
// Break works like the MCP server's: the interrupt buffer asks the engine to stop at the next safe point (rc 1, data
// kept). If it hasn't stopped after graceMs, the worker is replaced (rc 9998: data in memory is gone, files stay).
// Without a SharedArrayBuffer (a page that isn't cross-origin isolated) Break can only restart.

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const RC_RESET = 9998;

export class EngineClient {
  // createWorker: () => a Worker (in the page: new Worker(new URL("./worker.js", import.meta.url), {type: "module"}))
  constructor({ createWorker, wheel, indexURL, graceMs = 5000, onStatus = (_status) => {} }) {
    Object.assign(this, { createWorker, wheel, indexURL, graceMs, onStatus });
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
    this.about = await this.call("init", { wheel: this.wheel, indexURL: this.indexURL, interruptBuffer: this.interrupt });
    return this.about;
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
      else if (p.op === "init") p.resolve(started);   // a crash while starting: the first start() ends with the new one
      else p.reject(new Error(error));
    }
    return started;
  }
}

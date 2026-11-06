// Runs worker.js in a Node worker thread with the Web Worker globals it uses (self, postMessage, onmessage) and an
// in-memory IndexedDB. It doesn't outlive the thread, so files surviving a restart are tested only in a browser.
import { parentPort, workerData } from "node:worker_threads";
import "fake-indexeddb/auto";   // so the IndexedDB mount and saves run here too (in memory, per thread)

globalThis.self = globalThis;
globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
parentPort.on("message", data => globalThis.onmessage?.({ data }));
await import(workerData.script);

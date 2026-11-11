// The build's identity (scripts/build-id.ts): the check that fails a build on a stale snapshot (start-files.ts,
// writeStartFiles, and the deploy workflow), and the id both the page and the list are given. No Vite, no snapshot needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildId, staleness, type BuildInputs } from "../scripts/build-id.ts";
import { listStartFiles, writeStartFiles } from "../scripts/start-files.ts";

const CURRENT: BuildInputs = { wheel: "dofile-0.1.0-py3-none-any.whl", wheelHash: "a".repeat(64),
  extraWheels: { "pyreadstat-1.3.6.whl": "b".repeat(64) }, pyodide: "314.0.7" };
const manifest = (more: Partial<BuildInputs>) => ({ ...CURRENT, built: 1, optimize: 2 as const, ...more });

test("a build with a stale snapshot fails with the reason: another wheel, extra wheel, Pyodide, or no extra-wheel record", () => {
  assert.equal(staleness(manifest({}), CURRENT), null, "a snapshot of these inputs is current");
  const cases: [string, Partial<BuildInputs>, RegExp][] = [
    ["another dofile wheel", manifest({ wheelHash: "c".repeat(64) }), /the dofile wheel differs \(snapshot cccccccccccc, build aaaaaaaaaaaa\)/],
    ["another extra wheel", manifest({ extraWheels: { "pyreadstat-1.3.6.whl": "d".repeat(64) } }),
      /the extra wheel pyreadstat-1\.3\.6\.whl differs \(snapshot dddddddddddd, build bbbbbbbbbbbb\)/],
    ["an extra wheel the build does not have", manifest({ extraWheels: { ...CURRENT.extraWheels, "old.whl": "e".repeat(64) } }),
      /the extra wheel old\.whl differs \(snapshot eeeeeeeeeeee, build none\)/],
    ["another Pyodide version", manifest({ pyodide: "314.0.6" }), /the Pyodide version differs \(snapshot 314\.0\.6, build 314\.0\.7\)/],
  ];
  const { extraWheels: _, ...old } = manifest({});
  cases.push(["a manifest from before the extra wheels were recorded", old, /the snapshot has no record of the extra wheels/]);
  for (const [what, record, reason] of cases) {
    const why = staleness(record, CURRENT);
    assert.match(why ?? "", reason, what);
    assert.match(why!, /^the snapshot is stale: .*Run `npm run snapshot` in web\/$/, what);
  }
  // more than one difference: each is said
  assert.match(staleness(manifest({ wheelHash: "c".repeat(64), pyodide: "1" }), CURRENT)!, /dofile wheel differs.*; the Pyodide version differs/);
});

test("buildId: the same stamp and inputs give the same id, whatever the order of the extra wheels; any change gives another", () => {
  const two = { ...CURRENT, extraWheels: { "x.whl": "1", "y.whl": "2" } };
  const id = buildId("s", two);
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(buildId("s", { ...two, extraWheels: { "y.whl": "2", "x.whl": "1" } }), id);
  assert.equal(buildId("s", { ...two, wheel: "renamed.whl" } as BuildInputs), id, "the wheel's name is not part of it; its hash is");
  for (const other of [buildId("t", two), buildId("s", { ...two, wheelHash: "z" }), buildId("s", { ...two, pyodide: "0" }),
    buildId("s", { ...two, extraWheels: { "x.whl": "1" } }), buildId("s", { ...two, extraWheels: { "x.whl": "1", "y.whl": "3" } })]) {
    assert.notEqual(other, id);
  }
  // a record from before the extra wheels were recorded (every snapshot older than B2): an id, never a page's
  const { extraWheels: _, ...old } = two;
  assert.match(buildId("s", old), /^[0-9a-f]{64}$/);
  assert.notEqual(buildId("s", old), buildId("s", { ...two, extraWheels: {} }));
});

// writeStartFiles (the build's last step) on a folder like dist/: the page, and a snapshot with its record. Synthetic inputs:
// no real wheel or snapshot is needed.
test("writeStartFiles: a stale snapshot fails the build and writes nothing; a current one gives the list the build id and leaves no manifest.json; no snapshot is built: null", async t => {
  const dir = mkdtempSync(join(tmpdir(), "dofile-start-files-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const html = "<!doctype html><html><head><title>dofile</title></head><body></body></html>";
  writeFileSync(`${dir}/index.html`, html);
  mkdirSync(`${dir}/snapshot`);
  writeFileSync(`${dir}/snapshot/heap.bin`, new Uint8Array(1000).fill(7));
  writeFileSync(`${dir}/snapshot/bundle.bin`, new Uint8Array(500).fill(9));
  const record = { ...manifest({}), built: 1234,
    files: { snapshot: { name: "heap.bin", raw: 4000, size: 1000 }, bundle: { name: "bundle.bin", raw: 2000, size: 500 } } };
  writeFileSync(`${dir}/snapshot/manifest.json`, JSON.stringify(record));

  // (a) a snapshot of another Pyodide: the build fails, says why, and changes nothing
  const stale = { ...record, pyodide: "314.0.6" };
  assert.throws(() => writeStartFiles(dir, { stamp: "s", inputs: CURRENT, manifest: stale }), /^Error: start-files: the snapshot is stale: .*Pyodide version differs/);
  assert.equal(existsSync(`${dir}/start-files.json`), false, "no list");
  assert.equal(readFileSync(`${dir}/index.html`, "utf8"), html, "the page untouched");
  assert.equal(existsSync(`${dir}/snapshot/manifest.json`), true, "the manifest kept");

  // (b) a current snapshot: the list carries the id the page compiles in, and the manifest is not left to be deployed
  const list = writeStartFiles(dir, { stamp: "s", inputs: CURRENT, manifest: record });
  assert.equal(list.buildId, buildId("s", CURRENT));
  assert.equal(list.built, 1234);
  assert.deepEqual(JSON.parse(readFileSync(`${dir}/start-files.json`, "utf8")), list);
  assert.deepEqual(list.files.filter(f => f.download).map(f => f.path), ["snapshot/heap.bin", "snapshot/bundle.bin"]);
  assert.equal(existsSync(`${dir}/snapshot/manifest.json`), false, "manifest.json removed from the built folder");
  assert.match(readFileSync(`${dir}/index.html`, "utf8"), /<meta name="dofile-engine-bytes" content="\d+">/);

  // (c) no snapshot: the list says so, and so does the dev server's list
  assert.deepEqual([writeStartFiles(dir, { stamp: "s", inputs: CURRENT, manifest: null })].map(l => [l.built, l.buildId, l.snapshot]), [[null, null, null]]);

  // a snapshot from before B2 (no extraWheels): the dev server's list has an id, not the page's, rather than throwing
  const { extraWheels: _, ...old } = record;
  const dev = listStartFiles(dir, { stamp: "s", manifest: old as typeof record });
  assert.match(dev.buildId!, /^[0-9a-f]{64}$/);
  assert.notEqual(dev.buildId, buildId("s", CURRENT));
});

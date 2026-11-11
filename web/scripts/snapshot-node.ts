// Boot Pyodide from a built snapshot in Node, with the restore code the page uses (src/engine/snapshot.js). Shared by
// scripts/check-snapshot.mjs and the tests. `dir` is a snapshot folder (default public/snapshot).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadPyodide } from "pyodide";
import { restoreOptions, unpack } from "../src/engine/snapshot.ts";

export const defaultDir = fileURLToPath(new URL("../public/snapshot", import.meta.url));

export async function bootFromSnapshot(dir = defaultDir, io = { stdout: () => {}, stderr: () => {} }) {
  dir = resolve(dir);
  const read = (n: string) => readFileSync(`${dir}/${n}`);
  const manifest = JSON.parse(read("manifest.json").toString());
  const brotli = createRequire(import.meta.url)("brotli-wasm");
  const snapshot = unpack(brotli, new Uint8Array(read(manifest.files.snapshot.name)), manifest.files.snapshot);
  const blob = unpack(brotli, new Uint8Array(read(manifest.files.bundle.name)), manifest.files.bundle);
  const create = (await import(`${pathToFileURL(`${dir}/pyodide.asm.patched.mjs`).href}?v=${manifest.built}`)).default;
  const options = restoreOptions(create, { snapshot, dso: JSON.parse(read("dso.json").toString()), index: JSON.parse(read("files.json").toString()), blob });
  return { py: await loadPyodide({ ...options, ...io }), manifest };
}

// Calls into the native libraries (scipy's LAPACK and the rest, matplotlib's font code) that a restore can break by
// linking them wrong: a call can fail with "Dynamic linking error: cannot resolve symbol" or "table index is out of
// bounds" at the first use, or end the whole process. Each is [label, python expression, expected value or null].
export const NATIVE_CHECKS: [string, string, number | null][] = [
  ["scipy.linalg.solve", "float(__import__('scipy.linalg').linalg.solve([[3., 1], [1, 2]], [1., 2])[0])", 0],
  ["scipy.linalg.solve, symmetric (LAPACK dsytrf)", "float(__import__('scipy.linalg').linalg.solve([[2., 1], [1, 3]], [1., 2], assume_a='sym')[0])", 0.2],
  ["scipy.linalg.lapack.dsytrf", "float(__import__('scipy.linalg.lapack', fromlist=['x']).dsytrf([[2., 1], [1, 3]])[0][0, 0])", 5 / 3],
  ["scipy.linalg.eigh", "float(__import__('scipy.linalg').linalg.eigh([[2., 1], [1, 2]], eigvals_only=True)[0])", 1],
  ["scipy.stats.norm.cdf", "float(__import__('scipy.stats').stats.norm.cdf(1.96))", 0.9750021048517795],
  ["scipy.special.gammaln", "float(__import__('scipy.special').special.gammaln(10.5))", 13.940625219403763],
  ["scipy.optimize.minimize_scalar", "round(float(__import__('scipy.optimize').optimize.minimize_scalar(lambda t: (t - 3) ** 2).x), 4)", 3],
  ["scipy.sparse.linalg.spsolve", "float(__import__('scipy.sparse.linalg', fromlist=['x']).spsolve(__import__('scipy.sparse', fromlist=['x']).csc_matrix([[4., 1], [1, 3]]), [1., 2])[0])", 1 / 11],
  ["scipy.integrate.quad", "round(float(__import__('scipy.integrate').integrate.quad(lambda x: x * x, 0, 3)[0]), 6)", 9],
  ["scipy.interpolate.interp1d", "float(__import__('scipy.interpolate').interpolate.interp1d([0., 1, 2], [0., 10, 20])(1.5))", 15],
  ["scipy.fft.fft", "float(abs(__import__('scipy.fft').fft.fft([1., 0, 0, 0])[2]))", 1],
  ["numpy.linalg.inv", "float(__import__('numpy').linalg.inv([[2., 0], [0, 4.]])[1, 1])", 0.25],
  ["matplotlib: a plot with text (the font code)", "__import__('dofile.engine', fromlist=['x']).Engine('/tmp').run('clear\\nset obs 5\\ngen x = _n\\nscatter x x, title(t)', images=True).rc", 0],
];

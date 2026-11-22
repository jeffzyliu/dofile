import { readFileSync } from "node:fs";
import { type BuildInputs, inputs as readInputs, staleness } from "../build-id.ts";
import { listStartFiles } from "../start-files.ts";

/**
 * The dev server's start-files.json, made from public/ and made again whenever the snapshot was rebuilt: a stale snapshot is
 * then `updated` in the page, and one rebuilt to these inputs while the server runs is accepted without a restart (same
 * stamp, same inputs).
 * @param publicDir - the folder with the snapshot and the page's files
 * @param stamp - the dev server's, one per start
 * @param inputs - what this server was started with
 * @returns the list as JSON text
 */
export function startListDev(publicDir: string, stamp: string, inputs: BuildInputs): () => string {
  let list = { key: "", json: "" };
  return () => {
    let key = "";
    try {
      key = readFileSync(`${publicDir}/snapshot/manifest.json`, "utf8");
    } catch {
      /* no snapshot: the list says so */
    }
    if (key !== list.key || !list.json) {
      const manifest = key ? JSON.parse(key) : null;
      // the page says "updated" with the cause in the console; this says which side is old: the snapshot, or this server
      if (manifest && staleness(manifest, inputs)) {
        console.warn(
          `[dofile] ${staleness(manifest, readInputs()) ?? "the snapshot is newer than this dev server's page: restart the dev server"}`,
        );
      }
      list = { key, json: JSON.stringify(listStartFiles(publicDir, { stamp, manifest })) };
    }
    return list.json;
  };
}

// Before any test: the server the tests will talk to must serve this folder's build. `reuseExistingServer` takes whatever
// listens on the port, which can be the preview server of another checkout or worktree, with another build.
import { readFileSync } from "node:fs";
import type { FullConfig } from "@playwright/test";
import { EDITOR_BASE } from "../scripts/urls.ts";

export default async function globalSetup(config: FullConfig) {
  const base = config.projects[0]?.use.baseURL ?? `http://localhost:4173${EDITOR_BASE}`; // the editor's address
  const mine = readFileSync(new URL(`../dist${EDITOR_BASE}start-files.json`, import.meta.url), "utf8");
  const served = await fetch(new URL("start-files.json", base)).then(
    (r) => (r.ok ? r.text() : `status ${r.status}`),
    (e) => String(e),
  );
  if (served !== mine) {
    throw new Error(
      `${base} does not serve this folder's build (web/dist): another preview server is on that port, or it serves ` +
        "an older build. Stop the other server (or run `npm run build` here), or set E2E_PORT to a free port, then try again.",
    );
  }
}

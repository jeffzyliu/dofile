// Before the screenshots: the server must serve the build that SHOTS_APP names, made for the local origins (as
// e2e/global-setup.ts checks for the e2e run, for the editor only: the screenshots never visit the landing page).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EDITOR_OUT, LOCAL_EDITOR_URL, LOCAL_SITE_URL } from "../scripts/urls.ts";

export default async function globalSetup() {
  const out = resolve(process.env.SHOTS_APP ?? ".", EDITOR_OUT);
  const served = await fetch(new URL("start-files.json", LOCAL_EDITOR_URL)).then(
    (r) => (r.ok ? r.text() : `status ${r.status}`),
    (e) => String(e),
  );
  if (served !== readFileSync(resolve(out, "start-files.json"), "utf8"))
    throw new Error(
      `${LOCAL_EDITOR_URL} does not serve ${out}: another server is on that port, or the build is not there. Set E2E_PORT to a free port.`,
    );
  const assets = resolve(out, "assets");
  if (
    !readdirSync(assets).some(
      (f) => f.endsWith(".js") && readFileSync(resolve(assets, f), "utf8").includes(LOCAL_SITE_URL),
    )
  )
    throw new Error(
      `${out} was built for other addresses than the local ones: build it with DOFILE_URLS=local and E2E_PORT=${Number(new URL(LOCAL_EDITOR_URL).port) - 1}.`,
    );
}

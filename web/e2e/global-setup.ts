// Before any test: the servers must serve this folder's build, made for the local origins. `reuseExistingServer` takes
// whatever listens on the port, which can be another checkout's preview server with another build. And a build with the
// production addresses would link the pages to dofile.dev and app.dofile.dev, so every test that crosses between them
// would leave localhost: `npm run e2e` builds with DOFILE_URLS=local.
import { readdirSync, readFileSync } from "node:fs";

import { EDITOR_OUT, LOCAL_EDITOR_URL, LOCAL_SITE_URL, SITE_OUT } from "../scripts/urls.ts";

const get = (url: string) =>
  fetch(url).then(
    (r) => (r.ok ? r.text() : `status ${r.status}`),
    (e) => String(e),
  );
const folder = (name: string) => new URL(`../${name}/`, import.meta.url);

export default async function globalSetup() {
  const stale = (url: string, name: string) =>
    new Error(
      `${url} does not serve this folder's build (web/${name}): another preview server is on that port, or it serves an ` +
        "older build. Stop the other server (or run `npm run e2e`), or set E2E_PORT to a free port, then try again.",
    );
  const wrongAddresses = (what: string) =>
    new Error(
      `${what}: the build was made for other addresses than the local ones (${LOCAL_SITE_URL}, ${LOCAL_EDITOR_URL}). Run ` +
        "`npm run e2e`, which builds with DOFILE_URLS=local, or `DOFILE_URLS=local npm run build` first.",
    );
  // the editor: its start-files.json carries the build's stamp
  const startFiles = new URL("start-files.json", LOCAL_EDITOR_URL).href;
  if ((await get(startFiles)) !== readFileSync(new URL("start-files.json", folder(EDITOR_OUT)), "utf8"))
    throw stale(startFiles, EDITOR_OUT);
  // the pages: this folder's, with the editor's address the build was given
  const landing = await get(LOCAL_SITE_URL);
  if (landing !== readFileSync(new URL("index.html", folder(SITE_OUT)), "utf8")) throw stale(LOCAL_SITE_URL, SITE_OUT);
  if (!landing.includes(`href="${LOCAL_EDITOR_URL}"`)) throw wrongAddresses(`web/${SITE_OUT}/index.html`);
  // the editor's links to the landing page are in its script
  const assets = new URL("assets/", folder(EDITOR_OUT));
  const scripts = readdirSync(assets).filter((f) => f.endsWith(".js"));
  if (!scripts.some((f) => readFileSync(new URL(f, assets), "utf8").includes(LOCAL_SITE_URL)))
    throw wrongAddresses(`web/${EDITOR_OUT}/assets`);
}

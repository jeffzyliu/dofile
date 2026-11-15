// After a deploy (deploy.yml) or a preview upload (preview.yml): do the two addresses answer as the site should?
//   node scripts/smoke.ts [<site URL> <editor URL>] [--wait <seconds>]    no URLs: the production ones (scripts/urls.ts)
// The landing page answers 200 and its "Open the editor" links to the editor's URL; the editor answers 200 with the
// cross-origin isolation headers (its _headers). It tries again every 10 s until --wait (default 60) has passed: a new
// preview alias, or a new custom domain's certificate, can take a while. It checks; it undoes nothing.
import { PRODUCTION_EDITOR_URL, PRODUCTION_SITE_URL } from "./urls.ts";

/** What is wrong with the two addresses now (empty: nothing). `get` is fetch, or a test's stand-in. */
export async function problems(site: string, editor: string, get: typeof fetch = fetch): Promise<string[]> {
  const out: string[] = [];
  // a redirect is not followed: a login page or another site in its place must not count as the page
  const load = async (url: string) => {
    try {
      const res = await get(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) }); // a server that never answers must not hold the deploy group
      if (res.status === 200) return res;
      out.push(`${url} answered ${res.status}`);
    } catch (e) {
      out.push(`${url}: ${e}`);
    }
  };
  const landing = await load(site);
  if (landing)
    try {
      // the body can stall too: the same timeout ends it, and the run tries again
      if (!(await landing.text()).includes(`href="${editor}"`))
        out.push(`${site}: "Open the editor" does not link to ${editor}`);
    } catch (e) {
      out.push(`${site}: ${e}`);
    }
  const app = await load(editor);
  for (const [name, value] of [
    ["Cross-Origin-Opener-Policy", "same-origin"],
    ["Cross-Origin-Embedder-Policy", "require-corp"],
  ])
    if (app && app.headers.get(name) !== value)
      out.push(`${editor}: ${name} is ${app.headers.get(name) ?? "missing"}, not ${value} (the editor's _headers)`);
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--wait");
  const wait = at < 0 ? 60 : Number(args.splice(at, 2)[1]);
  const [site = PRODUCTION_SITE_URL, editor = PRODUCTION_EDITOR_URL] = args;
  if (args.length % 2 || !(wait >= 0))
    throw new Error("usage: node scripts/smoke.ts [<site URL> <editor URL>] [--wait <s>]");
  const until = Date.now() + wait * 1000;
  for (;;) {
    const found = await problems(site, editor);
    if (!found.length) {
      console.log(`ok: ${site} and ${editor}`);
      break;
    }
    if (Date.now() >= until) {
      const mark = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "error: ";
      for (const p of found) console.log(`${mark}${p}`);
      process.exit(1);
    }
    console.log(`not yet (${found.join("; ")}); again in 10 s`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

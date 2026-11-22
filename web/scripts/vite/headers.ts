import type { Connect } from "vite";

// SharedArrayBuffer (the Break button) needs cross-origin isolation. The headers go on every response, 304s included:
// WebKit refuses a worker script whose cached 304 reply lacks COEP. The static host must do the same (dist/app/_headers).
// The dev server sends them everywhere (the checker's panel, a frame, needs them too); the editor's preview too; the
// pages' preview, like their host, none.
export const isolate: Connect.NextHandleFunction = (_req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  next();
};

// A folder's other addresses go to the folder, the query kept, as the host does (Cloudflare's html_handling
// "auto-trailing-slash", seen in `wrangler dev`): /commands, /commands.html and /commands/index.html to /commands/;
// /index.html to /. `folders`: the origin's folders, each with a slash at each end ("/commands/"; "/" is the root).
export const slash =
  (...folders: string[]): Connect.NextHandleFunction =>
  (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    const to = p.endsWith("/index.html")
      ? p.slice(0, -"index.html".length)
      : folders
          .filter((f) => f !== "/")
          .map((f) => f.slice(0, -1))
          .find((f) => p === f || p === `${f}.html`)
          ?.concat("/");
    if (!to) return next();
    res.writeHead(307, { Location: `${to}${url.search}` }).end();
  };

/** In a preview server: `_headers` is the host's setting, not a file of the site (the host does not serve it either). */
export function hideHeadersFile(middlewares: Connect.Server): void {
  middlewares.use("/_headers", (_req, res) => {
    res.statusCode = 404;
    res.end();
  });
}

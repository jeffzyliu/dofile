// Cloudflare Workers static assets refuse a file over 25 MiB. The brotli-11 snapshot is built only for a deploy (the tests
// build it at quality 5), so this runs after that build, before wrangler: in .github/actions/build-web (deploy.yml,
// preview.yml) and in `npm run deploy`. `node scripts/check-sizes.ts`: an error for each file over the limit (exit 1), a
// warning for each within 2 MiB of it, over the two build folders.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EDITOR_OUT, SITE_OUT } from "./urls.ts";

export const LIMIT = 25 * 1024 * 1024; // 26214400 bytes
export const NEAR = 23 * 1024 * 1024;

/** Every file under `dirs` bigger than NEAR, with its size and whether it is over LIMIT. */
export function bigFiles(dirs: string[]): { file: string; bytes: number; over: boolean }[] {
  return dirs.flatMap((dir) =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name))
      .map((file) => ({ file, bytes: statSync(file).size }))
      .filter((f) => f.bytes > NEAR)
      .map((f) => ({ ...f, over: f.bytes > LIMIT })),
  );
}

if (import.meta.main) {
  const ci = process.env.GITHUB_ACTIONS === "true";
  const files = bigFiles([EDITOR_OUT, SITE_OUT]);
  for (const { file, bytes, over } of files)
    console.log(
      over
        ? `${ci ? "::error::" : "error: "}${file} is ${bytes} bytes; Cloudflare Workers static assets refuse files over 25 MiB (${LIMIT} bytes)`
        : `${ci ? "::warning::" : "warning: "}${file} is ${bytes} bytes, over 23 MiB (${NEAR} bytes); the limit is 25 MiB`,
    );
  if (files.some((f) => f.over)) process.exit(1);
}

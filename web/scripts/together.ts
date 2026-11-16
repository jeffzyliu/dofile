// Runs the two servers of `npm run dev` or `npm run preview` (the editor's and the pages') side by side, and stops both
// when one ends: a server that fails to start (its port is taken: strictPort) must not leave the other running, with
// links to a dead port. `node scripts/together.ts dev | preview`. Ports: urls.ts.
import { type ChildProcess, spawn } from "node:child_process";
import { DEV_EDITOR_PORT, DEV_SITE_PORT, LOCAL_EDITOR_URL, LOCAL_SITE_URL } from "./urls.ts";

const what = process.argv[2];
const port = (url: string) => new URL(url).port;
const servers: Record<string, string[][]> = {
  // every dev HTTP server listens on all interfaces, so a phone on the LAN can connect (web/CLAUDE.md)
  dev: [
    ["vite", "--host", "--port", String(DEV_EDITOR_PORT)],
    ["vite", "--mode", "site", "--host", "--port", String(DEV_SITE_PORT)],
  ],
  preview: [
    ["vite", "preview", "--mode", "site", "--host", "--port", port(LOCAL_SITE_URL), "--strictPort"],
    ["vite", "preview", "--host", "--port", port(LOCAL_EDITOR_URL), "--strictPort"],
  ],
};
if (!(what in servers)) throw new Error("usage: node scripts/together.ts dev | preview");

const children: ChildProcess[] = servers[what].map((args) =>
  spawn("npx", ["--no-install", ...args], { stdio: "inherit" }),
);
let ending = false;
const end = (code: number) => {
  if (ending) return;
  ending = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  process.exitCode = code;
};
for (const c of children) c.on("exit", (code, signal) => end(code ?? (signal ? 1 : 0)));
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => end(0));

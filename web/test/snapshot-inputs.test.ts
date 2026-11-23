// scripts/snapshot-inputs.txt is the one list of what the memory snapshot is made of and checked by; web.yml (the snapshot
// job's trigger) and .github/actions/build-web (the cache key) read it through snapshot-inputs.sh. Needs a git checkout.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { repo, web } from "../scripts/lib/paths.ts";

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean);
const text = (path: string) => readFileSync(`${repo}/${path}`, "utf8");

const sections: Record<string, string[]> = {};
let section = "";
for (const line of text("web/scripts/snapshot-inputs.txt").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  const head = /^\[(\w+)\]$/.exec(line);
  if (head) {
    section = head[1]!;
    sections[section] = [];
  } else sections[section]!.push(line);
}

test("the table has its two sections, and every pathspec in it names a tracked file", () => {
  assert.deepEqual(Object.keys(sections), ["build", "check"]);
  for (const spec of Object.values(sections).flat())
    assert.notEqual(
      git("ls-files", "--", spec).length,
      0,
      `${spec} matches no tracked file (a typo gives a weaker key, silently)`,
    );
});

test("the shell reader gives the table's pathspecs, and the workflows keep no list of their own", () => {
  const read = (what: string) =>
    execFileSync("sh", [`${web}/scripts/snapshot-inputs.sh`, what], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  assert.deepEqual(read("build"), sections.build);
  assert.deepEqual(read("all"), [...sections.build!, ...sections.check!]);
  assert.match(read("key").join(""), /^[0-9a-f]{64}$/);
  const workflow = text(".github/workflows/web.yml");
  assert.match(workflow, /snapshot-inputs\.sh all/);
  assert.doesNotMatch(workflow, /ENGINE/, "web.yml reads the table, not a regex of its own");
  const action = text(".github/actions/build-web/action.yml");
  assert.match(action, /snapshot-inputs\.sh key/);
  assert.doesNotMatch(action, /hashFiles\(/, "the cache key is the table's, not a list of its own");
});

test("every file make-snapshot.ts runs is in the build section: what it imports, and what those import", () => {
  const built = new Set(git("ls-files", "--", ...sections.build!));
  const seen = new Set<string>();
  const missing: string[] = [];
  const visit = (file: string) => {
    const path = relative(repo, file);
    if (seen.has(path)) return;
    seen.add(path);
    if (!built.has(path)) missing.push(path);
    // a relative import that is not type-only (a type is erased: it cannot change the snapshot)
    for (const m of text(path).matchAll(
      /^(?:import|export)\s+(?!type\b)[^;]*?from\s+"(\.[^"]+)"|\bimport\("(\.[^"]+)"\)/gm,
    ))
      visit(resolve(dirname(file), (m[1] ?? m[2])!));
  };
  visit(resolve(web, "scripts/make-snapshot.ts"));
  assert.deepEqual(missing, [], "add each to [build] in web/scripts/snapshot-inputs.txt (it changes the snapshot)");
});

test("the cache key fails, with a message, outside a git checkout: never a constant key", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dofile-key-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(`${dir}/web/scripts`, { recursive: true });
  for (const f of ["snapshot-inputs.sh", "snapshot-inputs.txt"])
    copyFileSync(`${web}/scripts/${f}`, `${dir}/web/scripts/${f}`);
  const r = spawnSync("sh", [`${dir}/web/scripts/snapshot-inputs.sh`, "key"], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, "", "no hash printed");
  assert.match(r.stderr, /not a git checkout/);
});

// readDta (src/app/output/dta.ts): one describe_file per file and version, however often the .dta tab is mounted.

import assert from "node:assert/strict";
import { test } from "node:test";

import { readDta } from "../src/app/output/dta.ts";
import { dtaInfo } from "../src/app/output/view.ts";

import { client, readyEngine, tick, useWiring } from "./wiring.ts";

useWiring();

const asked = () => client.calls.filter(([op]) => op === "describe_file").length;

test("a .dta tab mounted again while describe_file is pending asks no second time; a new version of the file does, and so does a call that failed", async () => {
  dtaInfo.value = {};
  await readyEngine();
  client.hold = true;
  readDta("d.dta", "10:1");
  readDta("d.dta", "10:1"); // the tab was unmounted and mounted again: its effect runs again
  assert.equal(asked(), 1);

  readDta("d.dta", "20:2"); // the file changed meanwhile
  assert.equal(asked(), 2);

  client.waiting[0].no(new Error("reset"));
  client.waiting[1].ok({ nobs: 3, nvars: 1, variables: [] });
  await tick();
  assert.equal(dtaInfo.value["d.dta"]?.key, "20:2");
  readDta("d.dta", "20:2");
  assert.equal(asked(), 2, "answered: no more asking");

  readDta("e.dta", "5:5");
  client.waiting[2].no(new Error("reset"));
  await tick();
  readDta("e.dta", "5:5");
  assert.equal(asked(), 4, "a call that failed is asked again");
});

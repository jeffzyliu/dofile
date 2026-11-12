// Prototype 1, step 4b, in real browsers: the editor, Run, Break, the log, the run-head, the command line, the status bar
// and the phone's strip (docs/design/SPEC.md, sections 3.3 to 3.6 and 4; src/app/editor/, src/app/log/).
//  - With no engine (?test=manual): editing, the unsaved dot, Save (Ctrl/Cmd+S) and a failed save's banner, the close-tab
//    dialog's Save, a .csv's columns and a .log's lines in the editor, a file dropped on the editor, the editor's text
//    size on a phone; and the log's formatting, measured as computed styles in both themes, from log items the test
//    writes through the hook (state.runWriter: the run controller's writer, which only a test may touch this way).
//  - With an engine (one start per test): Run and the run-head, the error mark and "Go to line", the graph link after
//    the echo of its line (inline on a phone), the status bar or the phone's strip, Run selection, Break's note, the
//    command line (Enter, ↑, a paste of several lines that stops at an error, an ordinary paste).
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, startEngine, test } from "./fixtures"; // storage kept by default (fixtures.ts)

type Hook = {
  store: {
    blocked: boolean;
    write(path: string, bytes: Uint8Array): Promise<unknown>;
    read(path: string): Promise<Uint8Array>;
  };
  state: any; // the signals of src/app/state.ts
  selection: { value: [number, number] | null };
  breakRun(): void;
  run(code: string): Promise<unknown>;
};
declare global {
  interface Window {
    __dofile: Hook;
  }
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 700;
const views = (page: Page) => page.getByRole("tablist", { name: "Views" });
const view = (page: Page, name: string) => views(page).getByRole("tab", { name }).click();

async function setUp(page: Page, files: Record<string, string>, url = "?test=manual") {
  await page.goto(url);
  await page.waitForFunction(() => window.__dofile?.store.blocked === false);
  await page.evaluate(async (files) => {
    for (const [path, text] of Object.entries(files))
      await window.__dofile.store.write(path, new TextEncoder().encode(text));
  }, files);
}
const stored = (page: Page, path: string) =>
  page.evaluate(async (p) => new TextDecoder().decode(await window.__dofile.store.read(p)), path);

/** Open `name` from the file tree (the Files view on a phone). */
async function open(page: Page, name: string) {
  if (isPhone(page)) await view(page, "Files");
  await page
    .getByRole("tree", { name: "Files" })
    .getByRole("treeitem", { name: new RegExp(`^${name.replace(".", "\\.")}`) })
    .click();
  await expect(page.locator(".cm-content")).toHaveAttribute("aria-label", `Editor: ${name}`);
}

async function ready(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.engine), { timeout: 300_000 })
    .toBe("ready");
}

// ---- no engine ----

test("the editor: typing marks the tab unsaved, Ctrl/Cmd+S saves it with a toast, a failed save shows a banner; its focus ring shows in forced colors", async ({
  page,
  browserName,
}) => {
  await setUp(page, { "a.do": "display 1\n" });
  await open(page, "a.do");
  const content = page.locator(".cm-content");
  await expect(content).toHaveText("display 1");
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  // one insertion, so one undo takes it back (keys typed slowly can fall into several undo steps)
  await page.keyboard.insertText("display 2");
  await expect.poll(() => page.evaluate(() => window.__dofile.state.tabs.value[0].dirty)).toBe(true);
  // undo back to the saved text: no longer unsaved
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => page.evaluate(() => window.__dofile.state.tabs.value[0].dirty)).toBe(false);
  await page.keyboard.type("display 2");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".toast")).toHaveText("Saved a.do");
  expect(await stored(page, "a.do")).toBe("display 1\ndisplay 2");
  await expect.poll(() => page.evaluate(() => window.__dofile.state.tabs.value[0].dirty)).toBe(false);
  // Ctrl+S and Cmd+S both save from the editor, on every platform (ControlOrMeta is the runner's OS's key, which an
  // emulated iPhone on Linux does not take for its own)
  for (const [key, text] of [
    ["Control+s", "display 1\ndisplay 2!"],
    ["Meta+s", "display 1\ndisplay 2!!"],
  ]) {
    await page.keyboard.insertText("!");
    await page.keyboard.press(key);
    await expect.poll(() => stored(page, "a.do")).toBe(text);
    await expect.poll(() => page.evaluate(() => window.__dofile.state.tabs.value[0].dirty)).toBe(false);
  }
  // a layout whose S types no Latin letter (Cyrillic: "ы", in S's place): Ctrl+S saves, and the browser's own Save page
  // is kept away (the default prevented); a held key (repeats) saves once. Events made in the page: Playwright's keyboard
  // has no such layout.
  await page.keyboard.insertText("?");
  const held = await page.evaluate(() => {
    const s = window.__dofile.store as any;
    const real = s.write;
    let writes = 0;
    s.write = (...a: unknown[]) => {
      writes++;
      return real.apply(s, a);
    };
    const el = document.querySelector(".cm-content")!;
    const fire = (repeat: boolean) => {
      const e = new KeyboardEvent("keydown", {
        key: "ы",
        code: "KeyS",
        ctrlKey: true,
        repeat,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const prevented = [fire(false), fire(true), fire(true)];
    s.write = real;
    return { writes, prevented };
  });
  expect(held).toEqual({ writes: 1, prevented: [true, true, true] });
  await expect.poll(() => stored(page, "a.do")).toBe("display 1\ndisplay 2!!?");
  await expect.poll(() => page.evaluate(() => window.__dofile.state.tabs.value[0].dirty)).toBe(false);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => stored(page, "a.do")).toBe("display 1\ndisplay 2");
  // the [data-editor] element is the editor's content, and focus() puts the focus there
  await expect(page.locator("[data-editor]")).toHaveCount(1);
  await expect(page.locator("[data-editor]")).toHaveClass(/cm-content/);
  // the focused editor's ring is a box-shadow and a transparent outline: forced colors drop the shadow and give the
  // outline a system color, so the ring still shows there (WebKit matches the media query but forces no colors)
  const ring = () =>
    page.locator(".cm-editor").evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        focused: el.classList.contains("cm-focused"),
        outline: `${s.outlineStyle} ${s.outlineWidth}`,
        color: s.outlineColor,
        shadow: s.boxShadow,
      };
    });
  expect(await ring()).toMatchObject({ focused: true, outline: "solid 2px", color: "rgba(0, 0, 0, 0)" });
  if (browserName !== "webkit") {
    await page.emulateMedia({ forcedColors: "active" });
    const forced = await ring();
    expect(forced).toMatchObject({ focused: true, outline: "solid 2px", shadow: "none" });
    expect(forced.color).not.toBe("rgba(0, 0, 0, 0)");
    await page.emulateMedia({ forcedColors: "none" });
  }

  // a store that refuses: the banner above the editor, with Download; the dot stays
  await page.evaluate(() => {
    const s = window.__dofile.store as any;
    s.realWrite = s.write;
    s.write = () => Promise.reject(new Error("the disk is full"));
  });
  await page.keyboard.type("\ndisplay 3");
  await page.keyboard.press("ControlOrMeta+s");
  const banner = page.locator(".banner.error", { hasText: "a.do couldn't be saved" });
  await expect(banner).toContainText("the disk is full.");
  await expect(banner.getByRole("button", { name: "Download" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__dofile.state.tabs.value[0].dirty)).toBe(true);
  const download = page.waitForEvent("download");
  await banner.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("a.do");
  // a save that works removes it
  await page.evaluate(() => {
    const s = window.__dofile.store as any;
    s.write = s.realWrite;
  });
  await content.click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(banner).toHaveCount(0);
  expect(await stored(page, "a.do")).toBe("display 1\ndisplay 2\ndisplay 3");

  // a rename of the open file (F2 in the tree) keeps its text, its edits and the unsaved dot
  await page.keyboard.type("\ndisplay 4");
  if (isPhone(page)) await view(page, "Files");
  await page
    .getByRole("tree", { name: "Files" })
    .getByRole("treeitem", { name: /^a\.do/ })
    .focus();
  await page.keyboard.press("F2");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("b.do");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.__dofile.state.tabs.value.map((t: any) => [t.path, t.dirty])))
    .toEqual([["b.do", true]]);
  if (isPhone(page)) await view(page, "Editor");
  await expect(content).toHaveAttribute("aria-label", "Editor: b.do");
  await expect(content).toHaveText("display 1display 2display 3display 4");
});

test("Save keeps a file's form: a \\r\\n file edited and saved has \\r\\n throughout and is clean, and so has the save-failed banner's Download and the file renamed; a \\n file stays \\n; a file's BOM is not in the editor and a .csv's is written back, a .do's dropped; a rename follows the new name", async ({
  page,
}) => {
  await setUp(page, {
    "c.do": "display 1\r\ndisplay 2\r\n",
    "n.csv": "a\nb\n",
    "b.csv": "\uFEFFa,b\r\n1,2\r\n",
    "e.do": "\uFEFFdisplay 1\r\n",
  });
  const dirty = (path: string) =>
    page.evaluate((p) => window.__dofile.state.tabs.value.find((t: { path: string }) => t.path === p)?.dirty, path);
  const content = page.locator(".cm-content");

  await open(page, "c.do");
  expect(await dirty("c.do")).toBe(false);
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("display 3");
  await page.keyboard.press("Enter");
  await page.keyboard.type("display 4");
  await expect.poll(() => dirty("c.do")).toBe(true);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".toast")).toHaveText("Saved c.do");
  expect(await stored(page, "c.do")).toBe("display 1\r\ndisplay 2\r\ndisplay 3\r\ndisplay 4");
  await expect.poll(() => dirty("c.do")).toBe(false);
  // the saved text is compared in the editor's form: an edit taken back is clean again
  await page.keyboard.insertText("x");
  await expect.poll(() => dirty("c.do")).toBe(true);
  await page.keyboard.press("Backspace");
  await expect.poll(() => dirty("c.do")).toBe(false);
  // a save that fails: the banner's Download is the editor's text in the file's form
  await page.keyboard.insertText("x");
  await page.evaluate(() => {
    const s = window.__dofile.store as any;
    s.realWrite = s.write;
    s.write = () => Promise.reject(new Error("the disk is full"));
  });
  await page.keyboard.press("ControlOrMeta+s");
  const failed = page.locator(".banner.error", { hasText: "c.do couldn't be saved" });
  const download = page.waitForEvent("download");
  await failed.getByRole("button", { name: "Download" }).click();
  const crlf = "display 1\r\ndisplay 2\r\ndisplay 3\r\ndisplay 4x";
  expect(readFileSync((await (await download).path())!, "utf8")).toBe(crlf);
  await page.evaluate(() => {
    const s = window.__dofile.store as any;
    s.write = s.realWrite;
  });
  // renamed (F2 in the tree), it keeps its form: saved under the new name, still \r\n
  if (isPhone(page)) await view(page, "Files");
  await page
    .getByRole("tree", { name: "Files" })
    .getByRole("treeitem", { name: /^c\.do/ })
    .focus();
  await page.keyboard.press("F2");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("d.do");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: /^d\.do/ })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+s"); // the active tab, wherever the focus is
  await expect.poll(() => stored(page, "d.do")).toBe(crlf);
  await expect.poll(() => dirty("d.do")).toBe(false);

  await open(page, "n.csv");
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("c");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".toast")).toHaveText("Saved n.csv");
  expect(await stored(page, "n.csv")).toBe("a\nb\nc\n");
  await expect.poll(() => dirty("n.csv")).toBe(false);

  // a BOM: not in the editor (CodeMirror would draw it), the tab clean; Save writes it back, with the file's breaks
  await open(page, "b.csv");
  expect(await dirty("b.csv")).toBe(false);
  expect(
    await page
      .locator(".cm-line")
      .first()
      .evaluate((el) => el.textContent),
  ).toBe("a,b");
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("3,4");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".toast")).toHaveText("Saved b.csv");
  // the bytes as stored, decoded with a BOM kept as "\uFEFF"
  const bytes = async (path: string) =>
    Buffer.from(await page.evaluate(async (p) => [...(await window.__dofile.store.read(p))], path)).toString("utf8");
  expect(await bytes("b.csv")).toBe("\uFEFFa,b\r\n1,2\r\n3,4");
  await expect.poll(() => dirty("b.csv")).toBe(false);

  // a do-file with a BOM: not in the editor either; Save drops it (the engine would read it as part of the first command,
  // ODT-34), the line break kept
  const rename = async (from: string, to: string) => {
    if (isPhone(page)) await view(page, "Files");
    await page
      .getByRole("tree", { name: "Files" })
      .getByRole("treeitem", { name: new RegExp(`^${from.replace(".", "\\.")}`) })
      .focus();
    await page.keyboard.press("F2");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(to);
    await page.keyboard.press("Enter");
    await expect(
      page
        .getByRole("tree", { name: "Files" })
        .getByRole("treeitem", { name: new RegExp(`^${to.replace(".", "\\.")}`) }),
    ).toBeFocused();
  };
  await open(page, "e.do");
  expect(await dirty("e.do")).toBe(false);
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("display 2");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".toast")).toHaveText("Saved e.do");
  expect(await bytes("e.do")).toBe("display 1\r\ndisplay 2");
  // renamed, a file follows its new name at the next Save: e.do, saved without its BOM, stays without as e.txt; b.csv,
  // saved with it, loses it as f.do
  await rename("e.do", "e.txt");
  await page.keyboard.press("ControlOrMeta+s"); // the active tab, wherever the focus is
  await expect(page.locator(".toast")).toHaveText("Saved e.txt");
  expect(await bytes("e.txt")).toBe("display 1\r\ndisplay 2");
  await open(page, "b.csv");
  await rename("b.csv", "f.do");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".toast")).toHaveText("Saved f.do");
  expect(await bytes("f.do")).toBe("a,b\r\n1,2\r\n3,4");
});

test("a failed save's banner goes when the editor's text is replaced: Reload from the run, Replace with uploaded", async ({
  page,
}) => {
  await setUp(page, { "a.do": "display 1\n" });
  await open(page, "a.do");
  const content = page.locator(".cm-content");
  const failed = page.locator(".banner", { hasText: "a.do couldn't be saved" });
  const failSave = async () => {
    await content.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText("display 2");
    await page.evaluate(() => {
      const s = window.__dofile.store as any;
      const real = s.write;
      s.write = () => {
        s.write = real; // this one write fails
        return Promise.reject(new Error("the disk is full"));
      };
    });
    await page.keyboard.press("ControlOrMeta+s");
    await expect(failed).toBeVisible();
  };
  // Reload from the run: a run's version in the store and its banner, as files.ts afterRun leaves them
  await failSave();
  await page.evaluate(async () => {
    await window.__dofile.store.write("a.do", new TextEncoder().encode("display 3\n"));
    window.__dofile.state.addBanner({ b: "run-changed", path: "a.do" });
  });
  await page
    .locator(".banner:visible", { hasText: "The run changed a.do." })
    .getByRole("button", { name: "Reload from the run" })
    .click();
  await expect(content).toHaveText("display 3");
  await expect(failed).toHaveCount(0);
  // Replace with uploaded
  await failSave();
  await page
    .locator('input[data-upload="files"]')
    .setInputFiles({ name: "a.do", mimeType: "text/plain", buffer: Buffer.from("display 4\n") });
  await page
    .getByRole("alertdialog", { name: "a.do is already here" })
    .getByRole("button", { name: "Replace with uploaded" })
    .click();
  await expect(content).toHaveText("display 4");
  await expect(failed).toHaveCount(0);
  expect(await page.evaluate(() => window.__dofile.state.tabs.value[0].dirty)).toBe(false);
});

test("a rename while Save writes: the save follows the tab to its new name (clean, its toast), and so does a failed save's banner", async ({
  page,
}) => {
  await setUp(page, { "a.do": "display 1\n" });
  await open(page, "a.do");
  const content = page.locator(".cm-content");
  const tabs = () => page.evaluate(() => window.__dofile.state.tabs.value.map((t: any) => [t.path, t.dirty]));
  /** The next store.write answers when the test calls window.__answer(): it writes at once (the rename's transaction
   *  then comes after it, as when the store is slow), or with `fail` it writes nothing and rejects. */
  const hold = (fail: boolean) =>
    page.evaluate((fail) => {
      const s = window.__dofile.store as any;
      const real = s.write;
      let answer!: () => void;
      const gate = new Promise<void>((ok) => (answer = ok));
      (window as any).__answer = answer;
      s.write = (...a: unknown[]) => {
        s.write = real;
        if (fail) return gate.then(() => Promise.reject(new Error("the disk is full")));
        return real.apply(s, a).then(async (x: unknown) => {
          await gate;
          return x;
        });
      };
    }, fail);
  const rename = async (from: string, to: string) => {
    if (isPhone(page)) await view(page, "Files");
    await page
      .getByRole("tree", { name: "Files" })
      .getByRole("treeitem", { name: new RegExp(`^${from.replace(".", "\\.")}`) })
      .focus();
    await page.keyboard.press("F2");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(to);
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => window.__dofile.state.tabs.value.map((t: any) => t.path)))
      .toEqual([to]);
    if (isPhone(page)) await view(page, "Editor");
  };
  // a save that works and answers after the rename: the renamed tab is clean, and the toast names it
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("display 2");
  await hold(false);
  await page.keyboard.press("ControlOrMeta+s");
  await rename("a.do", "b.do");
  await page.evaluate(() => (window as any).__answer());
  await expect(page.locator(".toast")).toHaveText("Saved b.do");
  await expect.poll(tabs).toEqual([["b.do", false]]);
  expect(await stored(page, "b.do")).toBe("display 1\ndisplay 2");
  // a save that fails and answers after the rename: the banner is the tab's, under its new name
  await content.click();
  await page.keyboard.insertText("!");
  await hold(true);
  await page.keyboard.press("ControlOrMeta+s");
  await rename("b.do", "c.do");
  await page.evaluate(() => (window as any).__answer());
  await expect(page.locator(".banner", { hasText: "c.do couldn't be saved" })).toBeVisible();
  await expect(page.locator(".banner", { hasText: "b.do couldn't be saved" })).toHaveCount(0);
  expect(await tabs()).toEqual([["c.do", true]]);
});

test("the editor: a .csv's columns have their colors, a .log's lines their kinds, .md and .json their tokens; a file dropped on it uploads and leaves its text", async ({
  page,
}) => {
  await setUp(page, {
    "t.csv": 'id,region,age\n1001,"North, coast",41\n',
    "out.log": ". summarize x\nvariable x not found\nr(111);\n",
    "a.do": "display 1\n",
    "notes.md": "# Wages\n\nSee `wages.do`.\n",
    "meta.json": '{"rows": 12, "name": "wages"}\n',
  });
  await open(page, "notes.md");
  await expect(page.locator(".cm-content .k", { hasText: "Wages" })).toHaveCount(1); // the heading
  await expect(page.locator(".cm-content .s", { hasText: "wages.do" })).toHaveCount(1); // inline code
  await open(page, "meta.json");
  await expect(page.locator(".cm-content .m", { hasText: '"rows"' })).toHaveCount(1); // a property name
  await expect(page.locator(".cm-content .num")).toHaveText("12");
  await open(page, "t.csv");
  const line2 = page.locator(".cm-line").nth(1);
  await expect(line2.locator(".csv-c1")).toHaveText('"North, coast"');
  await expect(line2.locator(".csv-c2")).toHaveText("41");
  await expect(line2.locator(".csv-d")).toHaveCount(2);
  await open(page, "out.log");
  await expect(page.locator(".cm-line.lg-echo")).toHaveText(". summarize x");
  await expect(page.locator(".cm-line.lg-err")).toHaveText(["variable x not found", "r(111);"]);
  await open(page, "a.do");
  await expect(page.locator(".cm-content .k").first()).toHaveText("display");
  // a drop of a file on the editor: the page uploads it, the editor's text is unchanged
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["display 9\n"], "dropped.do", { type: "text/plain" }));
    document
      .querySelector(".cm-content")!
      .dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator(".toast")).toHaveText("1 file uploaded");
  await expect(page.locator(".cm-content")).toHaveText("display 1");
  expect(await stored(page, "dropped.do")).toBe("display 9\n");
  if (isPhone(page)) {
    // a phone zooms in on a text field under 16 px: the editor's text and numbers are 16 px or more
    const size = await page.evaluate(() => [
      parseFloat(getComputedStyle(document.querySelector(".cm-content")!).fontSize),
      parseFloat(getComputedStyle(document.querySelector(".cm-gutters")!).fontSize),
    ]);
    expect(Math.min(...size)).toBeGreaterThanOrEqual(16);
  }
});

/** The computed style of a log line, and the tokens' values resolved on the same element. */
const styleOf = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(`.log ${sel}`) as HTMLElement;
    const probe = document.createElement("span");
    el.closest(".log")!.append(probe);
    const resolve = (v: string) => {
      probe.style.color = `var(${v})`;
      return getComputedStyle(probe).color;
    };
    const weight = (v: string) => {
      probe.style.fontWeight = `var(${v})`;
      return getComputedStyle(probe).fontWeight;
    };
    const s = getComputedStyle(el);
    const out = {
      color: s.color,
      weight: s.fontWeight,
      error: resolve("--error"),
      muted: resolve("--muted"),
      ink: resolve("--ink"),
      bold: weight("--w-bold-mono"),
    };
    probe.remove();
    return out;
  }, selector);

test("the log's formatting: echoes bold, output normal, errors red and bold, hints and notes muted, in both themes", async ({
  page,
}) => {
  await page.goto("?test=manual");
  await page.waitForFunction(() => "__dofile" in window);
  await page.evaluate(() => {
    const S = window.__dofile.state;
    S.runWriter.log.value = [
      { t: "head" },
      {
        t: "text",
        run: 1,
        text: '. summarize x if sex == 1\nnumber of obs 3\n(path C:\\a\\b.dta is b.dta in the working folder)\nsex not found\n  → "sex" is not a variable.\n    How to fix: write "sex" with the quotes.\n    Learn more: help summarize\nr(111);\n',
        end: { kind: "file", path: "a.do", fresh_locals: true, rc: 111, line: 17, seconds: 0.38 },
      },
    ];
  });
  if (isPhone(page)) await view(page, "Log");
  const log = page.getByRole("log", { name: "Log" });
  await expect(log.locator(".echo")).toHaveText(". summarize x if sex == 1");
  await expect(log.locator(".err")).toHaveText(["sex not found", "r(111);"]);
  await expect(log.locator(".note")).toHaveText("(path C:\\a\\b.dta is b.dta in the working folder)");
  await expect(log.getByRole("button", { name: "Go to line 17" })).toBeVisible();
  await expect(log.getByRole("button", { name: "help summarize" })).toBeVisible();
  await expect(log.locator(".head")).toContainText("Files stay in this browser. Try: help regress");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => {
      window.__dofile.state.theme.value = t;
      document.documentElement.dataset.theme = t;
    }, theme);
    const echo = await styleOf(page, ".echo");
    expect(echo.weight, `${theme}: the echo is bold`).toBe(echo.bold);
    expect(echo.color).toBe(echo.ink);
    const out = await styleOf(page, "span:not([class])");
    expect(out.weight, `${theme}: output is normal weight`).toBe("400");
    expect(out.color).toBe(out.ink);
    const err = await styleOf(page, ".err");
    expect(err.color, `${theme}: the error is red`).toBe(err.error);
    expect(err.weight, `${theme}: the error is bold`).toBe(err.bold);
    const note = await styleOf(page, ".note");
    expect(note.color).toBe(note.muted);
    expect(note.weight).toBe("400");
    if (!isPhone(page)) {
      // on a phone the hint is a block (.explain) in the ink color
      const hint = await styleOf(page, ".hint");
      expect(hint.color, `${theme}: the hint is muted`).toBe(hint.muted);
      expect(hint.weight).toBe("400");
    } else await expect(log.locator(".explain")).toContainText("How to fix:");
  }
  // Download log holds the run's text alone: not the head
  await page.evaluate(() => {
    window.__dofile.state.runWriter.log.value = [
      { t: "head" },
      { t: "runhead", run: { kind: "file", path: "a.do", fresh_locals: true }, first: true },
      { t: "text", run: 1, text: ". display 1\n1\n" },
      { t: "note", text: "a note of the page" },
    ];
  });
  await expect(log.locator(".runhead")).toHaveText("Run: a.do, whole file · starts with no locals");
  const download = page.waitForEvent("download");
  if (isPhone(page)) {
    await page.getByRole("button", { name: "Log actions" }).click(); // the strip's "Log ⋯"
    await page.getByRole("menuitem", { name: "Download log" }).click();
  } else await page.getByRole("button", { name: "Download log" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("dofile.log");
  const text = await new Response((await file.createReadStream()) as any).text();
  expect(text).toBe(". display 1\n1\n");
});

test("Find in the log: every match counted and numbered in the log's order, Enter and Shift+Enter, Esc gives the focus back", async ({
  page,
}) => {
  await page.goto("?test=manual");
  await page.waitForFunction(() => "__dofile" in window);
  await page.evaluate(() => {
    const S = window.__dofile.state;
    S.runWriter.log.value = [
      { t: "head" }, // "Try: help regress": 1
      { t: "runhead", run: { kind: "file", path: "regress.do", fresh_locals: true }, first: false }, // 1
      { t: "text", run: 1, text: ". regress y x\nREGRESS output\n" }, // 2
      { t: "note", text: "a regress note" }, // 1
    ];
  });
  const phone = isPhone(page);
  if (phone) await view(page, "Log");
  else {
    // unsplit, with the Graph tab showing: Find shows the Log tab first
    await page.evaluate(() => {
      window.__dofile.state.split.value = false;
      window.__dofile.state.outputTab.value = "graph";
    });
  }
  const opener = phone ? page.getByRole("button", { name: "Log actions" }) : page.getByRole("button", { name: "Find" });
  if (phone) {
    await opener.click();
    await page.getByRole("menuitem", { name: "Find" }).click();
  } else await opener.click();
  const field = page.getByRole("searchbox", { name: "Find in the log" });
  await expect(field).toBeFocused();
  if (!phone)
    await expect(page.getByRole("tablist", { name: "Output" }).getByRole("tab", { name: "Log" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  await field.fill("regress");
  const count = page.locator(".findbar .count");
  await expect(count).toHaveText("1 of 5");
  const log = page.getByRole("log", { name: "Log" });
  await expect(log.locator("mark")).toHaveCount(5);
  // the marks are numbered as the log shows them, and the current one is the first
  expect(await log.locator("mark").evaluateAll((ms) => ms.map((m) => m.getAttribute("data-find")))).toEqual([
    "0",
    "1",
    "2",
    "3",
    "4",
  ]);
  const current = () =>
    log.locator("mark.on").evaluate((m) => m.closest(".head, .runhead, .note, .echo")?.className ?? "out");
  await expect.poll(current).toBe("head");
  await field.press("Enter");
  await expect(count).toHaveText("2 of 5");
  await expect.poll(current).toBe("runhead");
  await field.press("Enter");
  await expect(count).toHaveText("3 of 5");
  await expect.poll(current).toBe("echo");
  await field.press("Shift+Enter");
  await field.press("Shift+Enter");
  await field.press("Shift+Enter");
  await expect(count).toHaveText("5 of 5");
  await expect.poll(current).toBe("note");
  await field.fill("nothing like it");
  await expect(count).toHaveText("no match");
  // Esc closes it, and the focus goes back to what opened it (the Find button; on a phone the strip's Log ⋯ button)
  await field.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("the error line keeps to its text when the tab is left and shown again", async ({ page }) => {
  await setUp(page, { "a.do": "line 1\nline 2\nline 3\nline 4\n", "b.do": "other\n" });
  await open(page, "a.do");
  await open(page, "b.do");
  await open(page, "a.do");
  await page.evaluate(() => {
    window.__dofile.state.runWriter.lastRun.value = {
      kind: "file",
      path: "a.do",
      fresh_locals: true,
      rc: 111,
      line: 3,
      seconds: 0.1,
    };
  });
  const err = page.locator(".cm-line.cm-err-line");
  await expect(err).toHaveText("line 3");
  // two lines added above it: the mark moves with its text
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+Home");
  for (const line of ["new 1", "new 2"]) {
    await page.keyboard.type(line);
    await page.keyboard.press("Enter");
  }
  await expect(page.locator(".cm-line").nth(2)).toHaveText("line 1");
  await expect(err).toHaveText("line 3");
  // another tab, then this one again: still on its text, not on the run's line number
  await open(page, "b.do");
  await expect(err).toHaveCount(0);
  await open(page, "a.do");
  await expect(err).toHaveText("line 3");

  // the mark is the file's last run's (editor/errormark.ts): a command and a run of another file leave it
  const lastRun = (v: object | null) =>
    page.evaluate((v) => {
      window.__dofile.state.runWriter.lastRun.value = v;
    }, v);
  await lastRun({ kind: "command", fresh_locals: false, rc: 111, line: 1, seconds: 0.1 });
  await lastRun({ kind: "file", path: "b.do", fresh_locals: true, rc: 0, line: null, seconds: 0.1 });
  await expect(err).toHaveText("line 3");
  // a run of a.do that starts clears it
  await page.evaluate(() => {
    window.__dofile.state.engine.value = {
      s: "running",
      run: { kind: "file", path: "a.do", fresh_locals: true },
      t0: Date.now(),
    };
  });
  await expect(err).toHaveCount(0);
  await page.evaluate(() => {
    window.__dofile.state.engine.value = { s: "none" };
  });
  // the engine gone (a reset: lastRun null) clears it
  await lastRun({ kind: "file", path: "a.do", fresh_locals: true, rc: 111, line: 5, seconds: 0.1 });
  await expect(err).toHaveText("line 3");
  await lastRun(null);
  await expect(err).toHaveCount(0);
  // the marked line deleted clears it
  await lastRun({ kind: "file", path: "a.do", fresh_locals: true, rc: 111, line: 5, seconds: 0.1 });
  await expect(err).toHaveText("line 3");
  await err.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Shift+ArrowRight"); // the line and its break
  await page.keyboard.press("Backspace");
  await expect(page.locator(".cm-line").nth(4)).toHaveText("line 4");
  await expect(err).toHaveCount(0);
});

test("the error line comes back when its file is closed and opened again with the same text", async ({ page }) => {
  await setUp(page, { "a.do": "line 1\nline 2\nline 3\n", "b.do": "other\n" });
  await open(page, "b.do");
  await open(page, "a.do");
  await page.evaluate(() => {
    window.__dofile.state.runWriter.lastRun.value = {
      kind: "file",
      path: "a.do",
      fresh_locals: true,
      rc: 111,
      line: 2,
      seconds: 0.1,
    };
  });
  const err = page.locator(".cm-line.cm-err-line");
  await expect(err).toHaveText("line 2");
  const close = async (name: string) => {
    if (isPhone(page)) {
      await view(page, "Editor");
      await page.getByRole("button", { name: new RegExp(`^${name.replace(".", "\\.")}.*Open files`) }).click();
      await page.getByRole("menuitem", { name: `Close ${name}` }).click();
    } else {
      await page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name }).focus();
      await page.keyboard.press("Delete");
    }
    await expect
      .poll(() => page.evaluate(() => window.__dofile.state.tabs.value.map((t: { path: string }) => t.path)))
      .not.toContain(name);
  };
  await close("a.do");
  await open(page, "a.do");
  await expect(err).toHaveText("line 2");
  // closed, then changed on disk: opened with other text, no mark
  await close("a.do");
  await page.evaluate(() => window.__dofile.store.write("a.do", new TextEncoder().encode("new 1\nline 1\nline 2\n")));
  await open(page, "a.do");
  await expect(page.locator(".cm-line").first()).toHaveText("new 1");
  await expect(err).toHaveCount(0);
});

test("the notes at a run's end wrap in the Log pane, so Go to line stays in view, at every width", async ({ page }) => {
  await page.goto("?test=manual");
  await page.waitForFunction(() => "__dofile" in window);
  await page.evaluate(() => {
    window.__dofile.state.runWriter.log.value = [
      { t: "runhead", run: { kind: "file", path: "a.do", fresh_locals: true }, first: false },
      {
        t: "text",
        run: 1,
        text: ". forvalues i = 1/100000 {\n  2.   sleep 10\n  3. }\n--Break--\nr(1);\n",
        end: { kind: "file", path: "a.do", fresh_locals: true, rc: 1, line: 17, seconds: 2 },
      },
      { t: "text", run: 2, text: ". display 1\n1\n" },
    ];
  });
  const widths = isPhone(page) ? [page.viewportSize()!.width] : [1440, 1200, 900, 700];
  for (const width of widths) {
    if (!isPhone(page)) await page.setViewportSize({ width, height: 800 });
    else await view(page, "Log");
    const log = page.getByRole("log", { name: "Log" });
    const go = log.getByRole("button", { name: "Go to line 17" });
    await expect(go).toBeVisible();
    const fits = await log.evaluate((pre) => {
      const box = pre.parentElement!.getBoundingClientRect();
      const note = [...pre.querySelectorAll(".note")]
        .find((n) => n.textContent!.startsWith("Stopped by Break"))!
        .getBoundingClientRect();
      const link = [...pre.querySelectorAll("button.jump")]
        .find((b) => b.textContent === "Go to line 17")!
        .getBoundingClientRect();
      const next = pre.querySelectorAll(".echo")[3].getBoundingClientRect(); // the next run's `. display 1`
      return {
        note: note.right <= box.right + 0.5,
        link: link.right <= box.right + 0.5 && link.left >= box.left,
        // from the last line of the note and its link (the link may wrap under the note) to the next run's first line
        noBlankLine: next.top - Math.max(note.bottom, link.bottom) < next.height / 2,
      };
    });
    expect(fits, `at ${width} px`).toEqual({ note: true, link: true, noBlankLine: true });
    // the next run's text starts on its own line, right under the note
    await expect(log).toContainText(
      "Stopped by Break before line 17. The data is as the last complete command left it.  Go to line 17\n. display 1",
    );
  }
});

test("the log: a command stopped by Break names no line; a phone's inline graph is on the card of its run's theme", async ({
  page,
}) => {
  await page.goto("?test=manual");
  await page.waitForFunction(() => "__dofile" in window);
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  await page.evaluate((png) => {
    const S = window.__dofile.state;
    S.runWriter.graphs.value = [
      { n: 1, png, theme: "dark", from: "run", run: 1, command: "scatter y x", line: 1 },
      { n: 2, png, theme: "light", from: "run", run: 1, command: "scatter x y", line: 2 },
    ];
    S.runWriter.log.value = [
      { t: "text", run: 1, text: ". scatter y x\n\n. scatter x y\n\n" },
      {
        t: "text",
        run: 2,
        text: ". sleep 5000\n--Break--\nr(1);\n",
        end: { kind: "command", fresh_locals: false, rc: 1, line: 1, seconds: 2 },
      },
    ];
  }, PNG);
  if (isPhone(page)) await view(page, "Log");
  const log = page.getByRole("log", { name: "Log" });
  await expect(log.locator(".note")).toHaveText("Stopped by Break. The data is as the last complete command left it.");
  await expect(log.getByRole("button", { name: /^Go to line/ })).toHaveCount(0);
  if (isPhone(page)) {
    const cards = await log.locator(".inline-graph").evaluateAll((els) =>
      els.map((el) => {
        const probe = document.createElement("span");
        el.append(probe);
        probe.style.color = "var(--graph-card-dark)";
        const dark = getComputedStyle(probe).color;
        probe.style.color = "var(--graph-card)";
        const light = getComputedStyle(probe).color;
        probe.remove();
        const bg = getComputedStyle(el).backgroundColor;
        return bg === dark ? "dark" : bg === light ? "light" : bg;
      }),
    );
    expect(cards).toEqual(["dark", "light"]);
  }
});

test("the log: under an error, the OQ-10 note where the engine's own words do not say it", async ({ page }) => {
  await page.goto("?test=manual");
  await page.waitForFunction(() => "__dofile" in window);
  // the engine's own text for these three errors (src/dofile/browser.py, as a run prints it)
  await page.evaluate(() => {
    const end = (rc: number) => ({ kind: "command", fresh_locals: false, rc, line: 1, seconds: 0.1 });
    window.__dofile.state.runWriter.log.value = [
      { t: "text", run: 1, text: ". restore\nnothing to restore\nr(622);\n", end: end(622) },
      {
        t: "text",
        run: 2,
        text: '. reghdfe y x\ncommand reghdfe is unrecognized\n  → "reghdfe" is not a command known to OpenDTA.\n    Learn more: help opendta\nr(199);\n',
        end: end(199),
      },
      {
        t: "text",
        run: 3,
        text: '. use "$T"\nfile /tmp/opendta-1/S__000000.dta not found\nr(601);\n(a tempfile lasts one run: save it under a name to use it in a later run)\n',
        end: end(601),
      },
      // the note is the error's the run ended with, not one capture noisily caught before it (the engine's own log)
      {
        t: "text",
        run: 4,
        text: '. capture noisily {\n. reghdfe y x\ncommand reghdfe is unrecognized\n  → "reghdfe" is not a command known to OpenDTA.\n    Learn more: help opendta\nr(199);\n. }\n\n. regresss y x\ncommand regresss is unrecognized\n  → "regresss" is not a command known to OpenDTA.\n    Learn more: help opendta\nr(199);\n',
        end: end(199),
      },
      {
        t: "text",
        run: 5,
        text: '. capture noisily {\n. regresss y x\ncommand regresss is unrecognized\n  → "regresss" is not a command known to OpenDTA.\n    Learn more: help opendta\nr(199);\n. }\n\n. ftools\ncommand ftools is unrecognized\n  → "ftools" is not a command known to OpenDTA.\n    Learn more: help opendta\nr(199);\n',
        end: end(199),
      },
    ];
  });
  if (isPhone(page)) await view(page, "Log");
  await expect(page.getByRole("log", { name: "Log" }).locator(".note")).toHaveText([
    "Nothing was preserved. A run restores its data when it ends, so put preserve and restore in the same run.",
    "reghdfe is a community command. OpenDTA, the engine behind dofile, doesn't include it.",
    "(a tempfile lasts one run: save it under a name to use it in a later run)", // the engine's note; no second one
    "ftools is a community command. OpenDTA, the engine behind dofile, doesn't include it.", // run 5's, none for 4
  ]);
});

test("the phone's ⋯: Save is on for a text tab and off for a .dta tab", async ({ page }) => {
  test.skip(!isPhone(page), "the phone's ⋯ menu (the toolbar's Save is tested below)");
  await setUp(page, { "d.dta": "not read here", "a.do": "display 1\n" });
  await open(page, "a.do");
  const save = async () => {
    await page.getByRole("button", { name: "More actions" }).click();
    const item = page.getByRole("menu", { name: "More actions" }).getByRole("menuitem", { name: "Save", exact: true });
    const off = await item.getAttribute("aria-disabled");
    await page.keyboard.press("Escape");
    return off === "true";
  };
  expect(await save()).toBe(false);
  await view(page, "Files");
  await page
    .getByRole("tree", { name: "Files" })
    .getByRole("treeitem", { name: /^d\.dta/ })
    .click();
  expect(await page.evaluate(() => window.__dofile.state.activeTab.value)).toBe("d.dta");
  expect(await save()).toBe(true);
});

test("the command line: no autocorrect, capitals or suggestions, one Run button on a phone and the text one elsewhere; typed curly quotes are straightened, pasted ones are not", async ({
  page,
}) => {
  await page.goto("?test=manual");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine)).toBe("none");
  if (isPhone(page)) await view(page, "Log");
  const field = page.getByRole("textbox", { name: "Command" });
  for (const [name, value] of Object.entries({
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    enterkeyhint: "go",
  }))
    await expect(field, name).toHaveAttribute(name, value);
  // the phone's Run button (an icon) or the desktop's text button, never both
  await expect(page.getByRole("button", { name: "Run command" })).toHaveCount(1);
  await expect(page.locator(".cmdline .send")).toHaveCount(isPhone(page) ? 1 : 0);
  await expect(page.locator(".cmdline .btn")).toHaveCount(isPhone(page) ? 0 : 1);

  // typing: Smart Punctuation's curly quotes and em dash become what was typed, and the caret stays after them
  await field.focus();
  await page.keyboard.insertText("display ");
  await page.keyboard.insertText("“");
  await page.keyboard.insertText("hi");
  await page.keyboard.insertText("”");
  await expect(field).toHaveValue('display "hi"');
  await field.fill("a b");
  await field.press("ArrowLeft");
  await field.press("ArrowLeft");
  await page.keyboard.insertText("’");
  await page.keyboard.insertText("c");
  await expect(field).toHaveValue("a'c b");
  await field.fill("");
  await page.keyboard.insertText("x—y");
  await expect(field).toHaveValue("x--y");
  // a paste, a drop and the en dash are left as they are, and so is the text already there
  await field.fill("");
  const fromInput = (inputType: string, text: string) =>
    field.evaluate(
      (el: HTMLInputElement, [inputType, text]) => {
        el.value += text;
        el.setSelectionRange(el.value.length, el.value.length);
        el.dispatchEvent(
          new InputEvent("input", { inputType, data: inputType === "insertText" ? text : null, bubbles: true }),
        );
      },
      [inputType, text],
    );
  await fromInput("insertFromPaste", "“pasted”");
  await fromInput("insertFromDrop", " ’");
  await expect(field).toHaveValue("“pasted” ’");
  await page.keyboard.insertText("–");
  await expect(field).toHaveValue("“pasted” ’–");
});

test("the editor: typed curly quotes become straight ones in a .do file only, and a paste keeps its quotes", async ({
  page,
}) => {
  await setUp(page, { "a.do": "display 1\n", "n.md": "note\n" });
  const paste = (text: string) =>
    page.locator(".cm-content").evaluate((el, text) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      let e: Event = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      if ((e as ClipboardEvent).clipboardData?.getData("text/plain") !== text) {
        e = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(e, "clipboardData", { value: dt });
      }
      el.dispatchEvent(e);
    }, text);
  await open(page, "a.do");
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("display “it’s”");
  await expect(content).toContainText('display "it\'s"');
  await paste("“pasted”");
  await expect(content).toContainText("“pasted”");
  await expect(content).toContainText('display "it\'s"');
  // another kind of file keeps what is typed
  await open(page, "n.md");
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("“q”");
  await expect(content).toContainText("“q”");
});

// ---- with an engine ----

test("a .dta tab: Save is off, and when the engine's dialog closes by itself the focus goes to that tab", async ({
  page,
}) => {
  test.skip(
    isPhone(page),
    "a phone types a command on the Log view, where nothing of the editor is shown to take the focus",
  );
  await setUp(page, { "d.dta": "not read here", "a.do": "display 1\n" });
  await open(page, "a.do");
  const save = page.locator(".toolbar .run-ctl").nth(3);
  await expect(save).toBeEnabled();
  await page
    .getByRole("tree", { name: "Files" })
    .getByRole("treeitem", { name: /^d\.dta/ })
    .click();
  const tab = page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name: /^d\.dta/ });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(save).toBeDisabled();
  // a command with no engine: the prompt opens; the engine starts, the prompt closes by itself and gives the focus to the
  // editor's place, here the .dta tab (no editor is shown)
  const field = page.getByRole("textbox", { name: "Command" });
  await field.fill("display 1");
  await field.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => (window as any).__dofile.start());
  await ready(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tab).toBeFocused();
});

const CODE = [
  "clear", // 1
  "set obs 5", // 2
  "generate x = _n", // 3
  "scatter x x", // 4
  "summarize x", // 5
  "summarize nosuch", // 6
  "display `k' + 1", // 7: a local an earlier run set (Run selection keeps the locals)
].join("\n");

test("Run: the run-head, the graph after its echo, the error line marked, Go to line, the last run; Run selection keeps locals", async ({
  page,
}) => {
  await setUp(page, { "a.do": CODE }, "?test");
  await startEngine(page);
  await ready(page);
  await open(page, "a.do");
  const phone = isPhone(page);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.__dofile.state.lastRun.value?.rc)).toBe(111);
  if (phone) await expect(views(page).getByRole("tab", { name: "Log" })).toHaveAttribute("aria-selected", "true");
  const log = page.getByRole("log", { name: "Log" });
  await expect(log.locator(".runhead")).toContainText("Run: a.do, whole file · starts with no locals");
  // the graph goes right after the echo of line 4
  const after = await log.evaluate((pre) => {
    const echo = [...pre.querySelectorAll(".echo")].find((e) => e.textContent === ". scatter x x")!;
    let n: Node | null = echo.nextSibling;
    while (n && n.nodeType === Node.TEXT_NODE) n = n.nextSibling;
    return (n as Element)?.className ?? null;
  });
  expect(after).toBe(phone ? "inline-graph" : "glink");
  await expect(log.locator(".err")).toHaveText(["variable nosuch not found", "r(111);"]);
  // the error line in the editor, and Go to line
  if (phone) {
    await expect(page.locator(".phone-strip")).toContainText("r(111)");
    await expect(page.locator(".phone-strip")).toContainText("line 6");
  } else
    await expect(page.locator(".statusbar")).toContainText(
      "Last run: whole file (started with no locals) · r(111) at line 6",
    );
  await log.getByRole("button", { name: "Go to line 6" }).click();
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect(page.locator(".cm-line.cm-err-line")).toHaveText("summarize nosuch");
  const caretLine = () =>
    page.evaluate(() => {
      const sel = getSelection()!;
      return (sel.anchorNode?.parentElement?.closest(".cm-line") as HTMLElement | null)?.textContent;
    });
  await expect.poll(caretLine).toBe("summarize nosuch");

  // Run selection keeps the locals (SPEC 4: fresh_locals false): a run sets `k`, then line 7 uses it
  await page.evaluate(() => window.__dofile.run("local k = 41"));
  await ready(page);
  if (phone) await view(page, "Editor");
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Shift+Home");
  await expect.poll(() => page.evaluate(() => window.__dofile.selection.value)).toEqual([7, 7]);
  if (phone) await page.getByRole("button", { name: "Run line 7" }).click();
  else await page.keyboard.press("ControlOrMeta+Enter");
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.__dofile.state.lastRun.value?.kind)).toBe("selection");
  expect(await page.evaluate(() => window.__dofile.state.lastRun.value?.rc)).toBe(0);
  await expect(log.locator(".runhead").last()).toContainText("Run selection: line 7");
  expect(await page.evaluate(() => window.__dofile.state.log.value.at(-1).text)).toContain("\n42\n");
  await expect(page.locator(".cm-err-line")).toHaveCount(0); // the new run cleared the old error
  if (!phone) await expect(page.locator(".statusbar")).toContainText("Last run: line 7 · ");
});

test("Break: the run stops before a line, with a note, Go to line and no error mark; the Break pill's time on a phone", async ({
  page,
}) => {
  // a loop with no end, so Break always lands inside it, however long the test's steps before Break take on a busy
  // machine (a forvalues of fixed length ran out first once); Break ends it between passes
  await setUp(page, { "loop.do": "clear\nwhile 1 {\n  quietly display 1\n}\ndisplay 1" }, "?test");
  await startEngine(page);
  await ready(page);
  await open(page, "loop.do");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine)).toBe("running");
  if (isPhone(page)) {
    const pill = page.locator(".btn.stop.pill .label:not([aria-hidden]) .pill-time");
    await expect(pill).toHaveText(/^\d+(\.\d)? s$/);
  } else await expect(page.locator(".statusbar")).toContainText(/Running · \d/);
  await page.waitForTimeout(800);
  if (isPhone(page)) {
    // Break from the Editor view: the Log view shows, where Break's countdown and its outcome are
    await view(page, "Editor");
    await page.locator(".btn.stop.pill").click();
    await expect(views(page).getByRole("tab", { name: "Log" })).toHaveAttribute("aria-selected", "true");
  } else await page.evaluate(() => window.__dofile.breakRun());
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.__dofile.state.lastRun.value?.rc)).toBe(1);
  const log = page.getByRole("log", { name: "Log" });
  const note = log.locator(".note").last();
  await expect(note).toHaveText(
    /^Stopped by Break before line \d+\. The data is as the last complete command left it\.$/,
  );
  // the line it stopped before: a line of the loop, and "Go to line" goes there; no error mark
  const line = Number(/before line (\d+)/.exec((await note.textContent()) ?? "")![1]);
  expect([2, 3, 4]).toContain(line);
  await log.getByRole("button", { name: `Go to line ${line}` }).click();
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const at = getSelection()!.anchorNode?.parentElement?.closest(".cm-line");
        return at ? [...document.querySelectorAll(".cm-line")].indexOf(at) + 1 : 0;
      }),
    )
    .toBe(line);
  await expect(page.locator(".cm-err-line")).toHaveCount(0);
  if (!isPhone(page)) await expect(page.locator(".statusbar")).toContainText("Last run: stopped by Break · r(1)");
});

test("the log follows the end through runs that print wide lines (the running banner shrinks it and takes it back each run), until the visitor scrolls up; scrolling back down, or sideways, resumes or keeps it", async ({
  page,
}) => {
  await setUp(page, {}, "?test");
  await startEngine(page);
  await ready(page);
  if (isPhone(page)) await view(page, "Log");
  const log = page.getByRole("log", { name: "Log" });
  const fromEnd = () =>
    log.evaluate(
      (pre) => pre.parentElement!.scrollHeight - pre.parentElement!.scrollTop - pre.parentElement!.clientHeight,
    );
  const run = (n: number) =>
    page.evaluate(
      (code) => window.__dofile.run(code),
      Array.from({ length: 14 }, (_, i) => `display "${`${n}.${i} `.padEnd(220 + 7 * i, "x")}"`).join("\n"),
    );
  // wide lines make the log scroll sideways; every run ends with the log at its end (the first runs fail on the
  // pane's height changing by the running banner, whatever the line widths)
  for (let n = 1; n <= 4; n++) {
    await run(n);
    await expect.poll(fromEnd, { message: `at the end after run ${n}` }).toBeLessThanOrEqual(1);
  }
  expect(await log.evaluate((pre) => pre.parentElement!.scrollWidth > pre.parentElement!.clientWidth)).toBe(true);
  // sideways scrolling never stops the following
  await log.evaluate((pre) => {
    pre.parentElement!.scrollLeft = 150;
  });
  await run(5);
  await expect.poll(fromEnd, { message: "at the end after run 5, scrolled sideways" }).toBeLessThanOrEqual(1);
  // the visitor scrolls up: the log keeps its place while a run adds lines
  await log.evaluate((pre) => {
    // the visitor's input (a wheel event stands in for it, as the log only clears its following after one), then the move
    pre.parentElement!.dispatchEvent(new WheelEvent("wheel", { deltaY: -500, bubbles: true }));
    pre.parentElement!.scrollTop = 0;
  });
  await page.waitForTimeout(300); // a scroll event is delivered with the next frame
  await run(6);
  expect(await log.evaluate((pre) => pre.parentElement!.scrollTop)).toBe(0);
  expect(await fromEnd()).toBeGreaterThan(100);
  // back at the end, it follows again
  await log.evaluate((pre) => {
    pre.parentElement!.scrollTop = pre.parentElement!.scrollHeight;
  });
  await page.waitForTimeout(300);
  await run(7);
  await expect.poll(fromEnd, { message: "at the end after run 7, scrolled back down" }).toBeLessThanOrEqual(1);
});

test("the log follows the end while pasted lines run one after another (the running banner goes and comes back for each), and a paste does not move a log the visitor scrolled up", async ({
  page,
}) => {
  await setUp(page, {}, "?test");
  await startEngine(page);
  await ready(page);
  if (isPhone(page)) await view(page, "Log");
  const log = page.getByRole("log", { name: "Log" });
  const field = page.getByRole("textbox", { name: "Command" });
  const fromEnd = () =>
    log.evaluate(
      (pre) => pre.parentElement!.scrollHeight - pre.parentElement!.scrollTop - pre.parentElement!.clientHeight,
    );
  const paste = (text: string) =>
    field.evaluate((el, text) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      let e: Event = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      if ((e as ClipboardEvent).clipboardData?.getData("text/plain") !== text) {
        e = new Event("paste", { bubbles: true, cancelable: true }); // Firefox: a plain event that carries the data
        Object.defineProperty(e, "clipboardData", { value: dt });
      }
      el.dispatchEvent(e);
    }, text);
  const block = (n: number) =>
    `${Array.from({ length: 12 }, (_, i) => `display "${`${n}.${i} `.padEnd(120 + 9 * i, "x")}"`).join("\n")}\nforeach v in a b {\n`;
  const stopped = () =>
    expect(page.locator(".toast")).toContainText("not run: line 13 can't be run from the command line");
  for (let n = 1; n <= 3; n++) {
    await paste(block(n));
    await stopped();
    await ready(page);
    await expect.poll(fromEnd, { message: `at the end after paste ${n}` }).toBeLessThanOrEqual(1);
    await expect(page.locator(".toast")).toHaveCount(0, { timeout: 15_000 });
  }
  // scrolled up (a wheel event stands in for the visitor's input), the next paste leaves the log where it is
  await log.evaluate((pre) => {
    pre.parentElement!.dispatchEvent(new WheelEvent("wheel", { deltaY: -500, bubbles: true }));
    pre.parentElement!.scrollTop = 0;
  });
  await page.waitForTimeout(300);
  await paste(block(4));
  await stopped();
  await ready(page);
  expect(await log.evaluate((pre) => pre.parentElement!.scrollTop)).toBe(0);
});

test("the command line: Enter runs and clears, ↑ recalls; a paste of lines runs each in turn and stops at an error; a paste of one line, with or without its line break, is ordinary", async ({
  page,
}) => {
  await setUp(page, {}, "?test");
  await startEngine(page);
  await ready(page);
  if (isPhone(page)) await view(page, "Log");
  const field = page.getByRole("textbox", { name: "Command" });
  await field.fill("display 6*7");
  await field.press("Enter");
  await expect(field).toHaveValue("");
  const log = page.getByRole("log", { name: "Log" });
  await expect(log).toContainText("42");
  await ready(page);
  await field.press("ArrowUp");
  await expect(field).toHaveValue("display 6*7");
  await field.fill("");

  // a paste with line breaks: each line runs in turn; the error stops the rest, and a toast says so
  const paste = (text: string) =>
    field.evaluate((el, text) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      let e: Event = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      if ((e as ClipboardEvent).clipboardData?.getData("text/plain") !== text) {
        // a browser whose made-up ClipboardEvent carries no data (Firefox): a plain event that carries it
        e = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(e, "clipboardData", { value: dt });
      }
      el.dispatchEvent(e);
      return e.defaultPrevented;
    }, text);
  expect(await paste("display 100+1\ndisplay 100+2\n\nnosuchcommand\ndisplay 100+3\n")).toBe(true);
  await expect(page.locator(".toast")).toHaveText("1 of 4 pasted lines not run: line 3 ended with r(199)");
  await expect(log).toContainText("101");
  await expect(log).toContainText("102");
  await expect(log).not.toContainText("103");
  expect(await page.evaluate(() => window.__dofile.state.history.value.slice(-3))).toEqual([
    "display 100+1",
    "display 100+2",
    "nosuchcommand",
  ]);
  await expect(field).toHaveValue("");
  // with no line break the browser pastes as usual; so too with line breaks only at the end (one copied line): nothing runs
  expect(await paste("display 5")).toBe(false);
  const runs = await page.evaluate(() => window.__dofile.state.history.value.length);
  expect(await paste("display 6\n")).toBe(false);
  expect(await page.evaluate(() => window.__dofile.state.history.value.length)).toBe(runs);
});

test("the phone's command line: the Run button runs the text as Enter does, an empty field runs nothing, and the field keeps the focus either way", async ({
  page,
}) => {
  test.skip(!isPhone(page), "the Run button is the phone's (the desktop's text button is tested with Enter above)");
  await setUp(page, {}, "?test");
  await startEngine(page);
  await ready(page);
  await view(page, "Log");
  const field = page.getByRole("textbox", { name: "Command" });
  const send = page.getByRole("button", { name: "Run command" });
  // empty: it looks off (aria-disabled, not disabled, so a tap still keeps the keyboard), and a tap runs nothing
  await field.focus();
  await expect(send).toHaveAttribute("aria-disabled", "true");
  await expect(send).not.toHaveAttribute("disabled"); // Playwright counts aria-disabled as disabled, so no toBeEnabled()
  await send.tap({ force: true }); // and it would wait for "enabled" before a tap
  await expect(field).toBeFocused();
  expect(await page.evaluate(() => window.__dofile.state.history.value.length)).toBe(0);
  // with text: a tap runs it, clears the field, and the field still has the focus
  await field.fill("display 6*7");
  await expect(send).not.toHaveAttribute("aria-disabled", "true");
  await send.tap();
  await expect(page.getByRole("log", { name: "Log" })).toContainText("42");
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  expect(await page.evaluate(() => window.__dofile.state.history.value)).toEqual(["display 6*7"]);
});

test("the command line with no engine: pasted lines wait for the engine; Not now drops them, and a toast says so", async ({
  page,
}) => {
  await page.goto("?test=manual");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine)).toBe("none");
  if (isPhone(page)) await view(page, "Log");
  const field = page.getByRole("textbox", { name: "Command" });
  await field.evaluate((el) => {
    const e = new Event("paste", { bubbles: true, cancelable: true });
    const dt = new DataTransfer();
    dt.setData("text/plain", "display 1\ndisplay 2");
    Object.defineProperty(e, "clipboardData", { value: dt });
    el.dispatchEvent(e);
  });
  // the first line is queued: the prompt opens for a run; the second waits for it
  const prompt = page.getByRole("dialog");
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Not now" }).click();
  await expect(page.locator(".toast")).toHaveText("2 of 2 pasted lines not run: line 1 didn't run");
  expect(await page.evaluate(() => window.__dofile.state.history.value)).toEqual(["display 1"]);
});

test("a run that rewrites open files: a clean tab shows the run's version, keeping its selection and undo; the same text changes nothing; one with edits keeps them, unsaved, with a banner to reload (on every phone view); a version that is not text keeps the tab's text with its banner, which a run that writes the editor's text takes away, which follows a rename and goes with the tab", async ({
  page,
}) => {
  await setUp(page, { "t.csv": "a\n9\n", "u.csv": "a\n9\n" }, "?test");
  await startEngine(page);
  await ready(page);
  await open(page, "u.csv");
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("mine");
  await open(page, "t.csv");
  const r = await page.evaluate(() =>
    (window as any).__dofile.run(
      "clear\nset obs 2\ngenerate a = _n\nexport delimited using t.csv, replace\nexport delimited using u.csv, replace",
    ),
  );
  expect(r?.rc, r?.log).toBe(0);
  await ready(page);
  const banner = page.locator(".banner", { hasText: "The run changed u.csv." });
  if (isPhone(page)) {
    // the run showed the Log view: the banner is there too, before anything else is tapped
    await expect(views(page).getByRole("tab", { name: "Log" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".banner:visible", { hasText: "The run changed u.csv." })).toHaveCount(1);
    await view(page, "Editor");
  }
  // the clean tab (shown): the run's version
  await expect(page.locator(".cm-content")).toHaveText(/^a\s*1\s*2\s*$/);
  // the tab with edits: they stay, the tab stays unsaved, and the banner says the run changed it
  await open(page, "u.csv");
  await expect(page.locator(".cm-content")).toContainText("mine");
  expect(await page.evaluate(() => window.__dofile.state.tabs.value.find((t: any) => t.path === "u.csv").dirty)).toBe(
    true,
  );
  await expect(banner.first()).toContainText(
    "Your unsaved edits are still in the editor; saving them overwrites the file the run wrote.",
  );
  await banner.filter({ visible: true }).getByRole("button", { name: "Reload from the run" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator(".cm-content")).toHaveText(/^a\s*1\s*2\s*$/);
  const dirty = () =>
    page.evaluate(() => window.__dofile.state.tabs.value.find((t: { path: string }) => t.path === "u.csv")?.dirty);
  expect(await dirty()).toBe(false);

  // line 2 selected: a run that writes the same text again changes nothing (the selection stays, no banner)
  const run = async (code: string) => {
    const r = await page.evaluate((c) => window.__dofile.run(c), code);
    expect(r?.rc, r?.log).toBe(0);
    await ready(page);
    if (isPhone(page)) await view(page, "Editor");
  };
  await page.locator(".cm-line").nth(1).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  const selected = () => page.evaluate(() => window.__dofile.selection.value);
  await expect.poll(selected).toEqual([2, 2]);
  await run("export delimited using u.csv, replace");
  expect(await selected()).toEqual([2, 2]);
  await expect(page.locator(".banner")).toHaveCount(0);
  expect(await dirty()).toBe(false);
  // a run that adds a row: shown in one change, so the selection stays on line 2 and one undo takes the change back
  await run("set obs 3\nreplace a = 3 in 3\nexport delimited using u.csv, replace");
  await expect(page.locator(".cm-content")).toHaveText(/^a\s*1\s*2\s*3\s*$/);
  expect(await selected()).toEqual([2, 2]);
  expect(await dirty()).toBe(false);
  await page.locator(".cm-content").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".cm-content")).toHaveText(/^a\s*1\s*2\s*$/);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(".cm-content")).toHaveText(/^a\s*1\s*2\s*3\s*$/);
  expect(await dirty()).toBe(false);

  // a version that is not text (a .dta saved under the name): the tab keeps its text, is unsaved, and the banner says so
  await run("save u.csv, replace");
  const binary = page.locator(".banner", { hasText: "The run changed u.csv, and it is no longer text." });
  await expect(binary.first()).toContainText(
    "The editor still shows your text; saving it overwrites the file the run wrote.",
  );
  await expect(binary.getByRole("button", { name: "Reload from the run" })).toHaveCount(0);
  await expect(page.locator(".cm-content")).toHaveText(/^a\s*1\s*2\s*3\s*$/);
  expect(await dirty()).toBe(true);
  // a run that writes the editor's own text over it: the tab is clean again and the banner goes
  await run("export delimited using u.csv, replace");
  await expect(page.locator(".banner", { hasText: "The run changed u.csv" })).toHaveCount(0);
  expect(await dirty()).toBe(false);
  await run("save u.csv, replace");
  await expect(binary.first()).toBeAttached();
  expect(await dirty()).toBe(true);
  // a rename takes the banner to the new name; closing the tab ("Don't save") takes it away
  if (isPhone(page)) await view(page, "Files");
  await page
    .getByRole("tree", { name: "Files" })
    .getByRole("treeitem", { name: /^u\.csv/ })
    .focus();
  await page.keyboard.press("F2");
  await expect(page.getByRole("textbox", { name: "New name for u.csv" })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("v.csv");
  await page.keyboard.press("Enter");
  // the rename is over when its row has the focus back
  await expect(page.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: /^v\.csv/ })).toBeFocused();
  await expect(
    page.locator(".banner", { hasText: "The run changed v.csv, and it is no longer text." }),
  ).not.toHaveCount(0);
  await expect(binary).toHaveCount(0);
  if (isPhone(page)) {
    await view(page, "Editor");
    await page.getByRole("button", { name: /^v\.csv.*Open files/ }).click();
    await page.getByRole("menuitem", { name: "Close v.csv" }).click();
  } else {
    const tab = page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { name: /^v\.csv/ });
    await tab.focus();
    await expect(tab).toBeFocused();
    await page.keyboard.press("Delete");
  }
  await page
    .getByRole("dialog", { name: "Save changes to v.csv?" })
    .getByRole("button", { name: "Don't save" })
    .click();
  await expect(page.locator(".banner", { hasText: "The run changed v.csv" })).toHaveCount(0);
});

test("a clean tab of a .csv with \\r\\n line breaks follows a run that rewrites it: the run's version shown, no unsaved dot, no banner", async ({
  page,
}) => {
  await setUp(page, { "w.csv": "a\r\n9\r\n" }, "?test");
  await startEngine(page);
  await ready(page);
  await open(page, "w.csv");
  const r = await page.evaluate(() =>
    (window as any).__dofile.run("clear\nset obs 2\ngenerate a = _n\nexport delimited using w.csv, replace"),
  );
  expect(r?.rc, r?.log).toBe(0);
  await ready(page);
  if (isPhone(page)) await view(page, "Editor");
  await expect(page.locator(".cm-content")).toHaveText(/^a\s*1\s*2\s*$/);
  expect(
    await page.evaluate(
      () => window.__dofile.state.tabs.value.find((t: { path: string }) => t.path === "w.csv")?.dirty,
    ),
  ).toBe(false);
  await expect(page.locator(".banner", { hasText: "The run changed w.csv" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "unsaved changes" })).toHaveCount(0);
});

test("a file's form follows the store's text the editor takes: a run's version (shown, or kept with edits) and Reload from the run; a do-file with a BOM fails in a nested do, runs from the editor, which sends no BOM, and runs in a nested do once saved", async ({
  page,
}) => {
  await setUp(page, { "w.csv": "a\n9\n", "x.csv": "a\n9\n", "b.do": "\uFEFFdisplay 40+2\r\n" }, "?test");
  await startEngine(page);
  await ready(page);
  const dirty = (path: string) =>
    page.evaluate((p) => window.__dofile.state.tabs.value.find((t: { path: string }) => t.path === p)?.dirty, path);
  const content = page.locator(".cm-content");
  const save = async (path: string, add: string) => {
    await content.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(add);
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(() => dirty(path)).toBe(false);
  };
  // x.csv with an unsaved edit, w.csv clean; a run writes both with "\r\n" (file write: the engine's own writes are "\n")
  await open(page, "x.csv");
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("mine");
  await open(page, "w.csv");
  const crlf = (f: string) =>
    `file open h using "${f}", write text replace\nfile write h "a\`cr'" _n "1\`cr'" _n\nfile close h`;
  const r = await page.evaluate(
    (code) => window.__dofile.run(code),
    `local cr = char(13)\n${crlf("w.csv")}\n${crlf("x.csv")}`,
  );
  expect(r?.rc, r?.log).toBe(0);
  await ready(page);
  if (isPhone(page)) await view(page, "Editor");
  // the clean tab shows the run's version; edited and saved, it has the run's "\r\n"
  await expect(content).toHaveText(/^a\s*1\s*$/);
  await save("w.csv", "2");
  expect(await stored(page, "w.csv")).toBe("a\r\n1\r\n2");
  // the tab with edits keeps them; saved, they have the run's "\r\n"
  await open(page, "x.csv");
  await expect(content).toContainText("mine");
  await save("x.csv", "!");
  expect(await stored(page, "x.csv")).toBe("a\r\n9\r\nmine!");
  await expect(page.locator(".banner", { hasText: "The run changed x.csv." })).toHaveCount(0);

  // Reload from the run takes the store's text in its form: a run gives x.csv the banner again with a "\n" version, then
  // the store's version changes once more behind the editor (written here as another writer would: a BOM and "\r\n");
  // Reload, edit and Save: the BOM and "\r\n"
  await page.keyboard.type("?");
  const r2 = await page.evaluate(
    (code) => window.__dofile.run(code),
    "clear\nset obs 1\ngenerate a = 7\nexport delimited using x.csv, replace",
  );
  expect(r2?.rc, r2?.log).toBe(0);
  await ready(page);
  await page.evaluate(() => window.__dofile.store.write("x.csv", new TextEncoder().encode("\uFEFFa\r\n5\r\n")));
  const banner = page.locator(".banner:visible", { hasText: "The run changed x.csv." });
  await banner.getByRole("button", { name: "Reload from the run" }).click();
  if (isPhone(page)) await view(page, "Editor");
  await expect(content).toHaveText(/^a\s*5\s*$/);
  await save("x.csv", "6");
  const raw = await page.evaluate(async () => [...(await window.__dofile.store.read("x.csv"))]);
  expect(raw.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
  expect(Buffer.from(raw.slice(3)).toString("utf8")).toBe("a\r\n5\r\n6");

  // a do-file with a BOM: the engine reads the BOM as part of the first command (ODT-34), so a nested `do` of it fails;
  // Run sends the editor's text, which has none; saved from the editor it has none, and the nested `do` runs
  const nested = async () => {
    const r = await page.evaluate(() => window.__dofile.run("do b.do"));
    await ready(page);
    return { rc: r?.rc, log: r?.log ?? "" };
  };
  const before = await nested();
  expect(before.rc, before.log).toBe(198);
  expect(before.log).toContain("invalid syntax");
  await open(page, "b.do");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.__dofile.state.lastRun.value?.rc)).toBe(0);
  await expect(page.getByRole("log", { name: "Log" })).toContainText("42");
  if (isPhone(page)) await view(page, "Editor");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => stored(page, "b.do")).toBe("display 40+2\r\n");
  expect((await page.evaluate(async () => [...(await window.__dofile.store.read("b.do"))]))[0]).toBe(0x64); // "d", no BOM
  const after = await nested();
  expect(after.rc, after.log).toBe(0);
  expect(after.log).toContain("42");
});

test("S 15's note under a nested do in a loop: one note, after the loop's echo of that line, however many passes run it", async ({
  page,
}) => {
  await setUp(
    page,
    { "sub.do": "display 1\n", "main.do": "forvalues i = 1/2 {\n    do sub.do\n}\ndisplay 2\n" },
    "?test",
  );
  await startEngine(page);
  await ready(page);
  await open(page, "sub.do");
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("display 3"); // unsaved: the nested do runs the saved file
  await open(page, "main.do");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.__dofile.state.lastRun.value?.rc)).toBe(0);
  const log = page.getByRole("log", { name: "Log" });
  const note = log.locator(".warn", {
    hasText: "Note: sub.do has unsaved edits in the editor; do runs the saved file.",
  });
  await expect(note).toHaveCount(1);
  // the loop's body is echoed once, before its passes run sub.do twice: the note follows that echo
  const echo = await note.evaluate((el) => {
    let n = el.previousSibling;
    while (n && n.nodeType === Node.TEXT_NODE) n = n.previousSibling;
    return (n as Element | null)?.textContent;
  });
  expect(echo).toBe("  2.     do sub.do");
});

test("Ctrl/Cmd+Enter that the engine does not take says why in a toast and starts nothing; pressed when ready it runs, with no toast, and a held key runs once", async ({
  page,
}) => {
  await setUp(page, { "a.do": "display 1\n" }, "?test");
  await startEngine(page);
  await ready(page);
  await open(page, "a.do");
  const content = page.locator(".cm-content");
  const toast = page.locator(".toast");
  const runs = () => page.evaluate(() => window.__dofile.state.log.value.filter((i: any) => i.t === "text").length);
  const toEditor = async () => {
    if (isPhone(page)) await view(page, "Editor"); // a run shows the phone's Log view
    await content.click();
  };
  // ready: it runs, and nothing is said
  await toEditor();
  await page.keyboard.press("ControlOrMeta+Enter");
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.__dofile.state.lastRun.value?.kind)).toBe("file");
  expect(await runs()).toBe(1);
  await expect(toast).toHaveCount(0);
  // a held key: its repeats run nothing more and say nothing
  await toEditor();
  await content.evaluate((el) => {
    for (const repeat of [true, true])
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          ctrlKey: true,
          repeat,
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  await page.waitForTimeout(200);
  expect(await runs()).toBe(1);
  await expect(toast).toHaveCount(0);
  // during a run (a loop with no end, through the hook): refused, with the toast, and no run started. The run's promise
  // is kept and awaited after Break (as engine.spec.ts does), so it settles before the test ends
  const loop = page.evaluate(() => window.__dofile.run("while 1 {\n  quietly display 1\n}"));
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.engine)).toBe("running");
  await toEditor();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(toast).toHaveText("Run is not available until the current run ends");
  expect(await runs()).toBe(2);
  expect(await page.evaluate(() => document.documentElement.dataset.engine)).toBe("running");
  await page.evaluate(() => window.__dofile.breakRun());
  // Break stops it (rc 1), or resets the engine when the loop has not stopped within the grace (rc 9998: seen once in 20
  // Firefox runs with six workers); either way the run has ended, and its promise has settled
  expect([1, 9998]).toContain((await loop)?.rc);
  await ready(page);
});

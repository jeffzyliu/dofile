// Prototype 1, step 4b, in real browsers: the editor, Run, Break, the log, the run-head, the command line, the status bar
// and the phone's strip (docs/design/SPEC.md, sections 3.3 to 3.6 and 4; src/app/editor/, src/app/log/).
//  - With no engine (?test=manual): editing, the unsaved dot, Save (Ctrl/Cmd+S) and a failed save's banner, the close-tab
//    dialog's Save, a .csv's columns and a .log's lines in the editor, a file dropped on the editor, the editor's text
//    size on a phone; and the log's formatting, measured as computed styles in both themes, from log items the test
//    writes through the hook (state.runWriter: the run controller's writer, which only a test may touch this way).
//  - With an engine (one start per test): Run and the run-head, the error mark and "Go to line", the graph link after
//    the echo of its line (inline on a phone), the status bar or the phone's strip, Run selection, Break's note, the
//    command line (Enter, ↑, a paste of several lines that stops at an error, an ordinary paste).
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
};
declare global {
  interface Window {
    __dofile: Hook;
  }
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 700;
const views = (page: Page) => page.getByRole("tablist", { name: "Views" });
const view = (page: Page, name: string) => views(page).getByRole("tab", { name }).click();

async function setUp(page: Page, files: Record<string, string>, url = "/?test=manual") {
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
  await page.goto("/?test=manual");
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
    await page.getByRole("button", { name: "More actions" }).click();
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
  await page.goto("/?test=manual");
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
  const opener = phone
    ? page.getByRole("button", { name: "More actions" })
    : page.getByRole("button", { name: "Find" });
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
  await expect(count).toHaveText("none");
  // Esc closes it, and the focus goes back to what opened it (the Find button; on a phone the ⋯ button)
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
  await page.goto("/?test=manual");
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
        noBlankLine: next.top - note.bottom < next.height / 2,
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
  await page.goto("/?test=manual");
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
  await page.goto("/?test=manual");
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
    ];
  });
  if (isPhone(page)) await view(page, "Log");
  await expect(page.getByRole("log", { name: "Log" }).locator(".note")).toHaveText([
    "Nothing was preserved in this run. A run restores the data it preserved when it ends, so put preserve and restore in the same run.",
    "reghdfe is a community command: it isn't part of Stata itself, and dofile doesn't have it.",
    "(a tempfile lasts one run: save it under a name to use it in a later run)", // the engine's note; no second one
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
  await setUp(page, { "a.do": CODE }, "/?test");
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
  await setUp(page, { "loop.do": "clear\nforvalues i = 1/100000 {\n  quietly display `i'\n}\ndisplay 1" }, "/?test");
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

test("the command line: Enter runs and clears, ↑ recalls; a paste of lines runs each in turn and stops at an error; a paste of one line, with or without its line break, is ordinary", async ({
  page,
}) => {
  await setUp(page, {}, "/?test");
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

test("the command line with no engine: pasted lines wait for the engine; Not now drops them, and a toast says so", async ({
  page,
}) => {
  await page.goto("/?test=manual");
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

test("a run that rewrites open files: a clean tab shows the run's version; one with edits keeps them, unsaved, with a banner to reload", async ({
  page,
}) => {
  await setUp(page, { "t.csv": "a\n9\n", "u.csv": "a\n9\n" }, "/?test");
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
  if (isPhone(page)) await view(page, "Editor");
  // the clean tab (shown): the run's version
  await expect(page.locator(".cm-content")).toHaveText(/^a\s*1\s*2\s*$/);
  // the tab with edits: they stay, the tab stays unsaved, and the banner says the run changed it
  await open(page, "u.csv");
  await expect(page.locator(".cm-content")).toContainText("mine");
  expect(await page.evaluate(() => window.__dofile.state.tabs.value.find((t: any) => t.path === "u.csv").dirty)).toBe(
    true,
  );
  const banner = page.locator(".banner", { hasText: "The run changed u.csv." });
  await expect(banner).toContainText(
    "Your unsaved edits are still in the editor; saving them replaces the run's version.",
  );
  await banner.getByRole("button", { name: "Reload from the run" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator(".cm-content")).toHaveText(/^a\s*1\s*2\s*$/);
  expect(await page.evaluate(() => window.__dofile.state.tabs.value.find((t: any) => t.path === "u.csv").dirty)).toBe(
    false,
  );
});

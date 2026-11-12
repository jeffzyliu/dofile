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

test("the editor: typing marks the tab unsaved, Ctrl/Cmd+S saves it with a toast, a failed save shows a banner", async ({
  page,
}) => {
  await setUp(page, { "a.do": "display 1\n" });
  await open(page, "a.do");
  const content = page.locator(".cm-content");
  await expect(content).toHaveText("display 1");
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("display 2");
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

test("the editor: a .csv's columns have their colors, a .log's lines their kinds; a file dropped on it uploads and leaves its text", async ({
  page,
}) => {
  await setUp(page, {
    "t.csv": 'id,region,age\n1001,"North, coast",41\n',
    "out.log": ". summarize x\nvariable x not found\nr(111);\n",
    "a.do": "display 1\n",
  });
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

// ---- with an engine ----

const CODE = [
  "clear", // 1
  "set obs 5", // 2
  "generate x = _n", // 3
  "scatter x x", // 4
  "summarize x", // 5
  "summarize nosuch", // 6
  "display 9", // 7
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

  // Run selection: lines 7 (keeps nothing, but runs with the locals kept)
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Shift+Home");
  await expect.poll(() => page.evaluate(() => window.__dofile.selection.value)).toEqual([7, 7]);
  if (phone) await page.getByRole("button", { name: "Run line 7" }).click();
  else await page.keyboard.press("ControlOrMeta+Enter");
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.__dofile.state.lastRun.value?.kind)).toBe("selection");
  await expect(log.locator(".runhead").last()).toContainText("Run selection: line 7");
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
  await page.evaluate(() => window.__dofile.breakRun());
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.__dofile.state.lastRun.value?.rc)).toBe(1);
  const log = page.getByRole("log", { name: "Log" });
  await expect(log.locator(".note").last()).toContainText("Stopped by Break");
  await expect(log.locator(".note").last()).toContainText("The data is as the last complete command left it.");
  await expect(page.locator(".cm-err-line")).toHaveCount(0);
  if (!isPhone(page)) await expect(page.locator(".statusbar")).toContainText("Last run: stopped by Break · r(1)");
});

test("the command line: Enter runs and clears, ↑ recalls; a paste of lines runs each in turn and stops at an error; a paste of one line is ordinary", async ({
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
  // with no line break the browser pastes as usual
  expect(await paste("display 5")).toBe(false);
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

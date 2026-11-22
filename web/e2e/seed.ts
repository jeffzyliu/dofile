// What a test sets up in the page's state through the hook: one helper for each thing, named for what it shows.
// The signals the views may only read are written here through a cast (a test is no view).
import type { Page } from "@playwright/test";
import type { Signal } from "@preact/signals";
import type { DofileHook } from "./hook";

type State = DofileHook["state"];
type Writable<K extends keyof State> = State[K] extends { value: infer T } ? Signal<T> : never;

export type EngineState = State["engine"]["value"];
/** A state's name with any fields: a test may show a state with some left out (a failure with no reason). */
export type EngineSeed = { s: EngineState["s"] } & Record<string, unknown>;
export type Banner = Parameters<State["addBanner"]>[0];
export type Dialog = NonNullable<State["dialog"]["value"]>;
export type LogItems = State["runWriter"]["log"]["value"];
export type Graphs = State["runWriter"]["graphs"]["value"];
export type LastRun = State["runWriter"]["lastRun"]["value"];
export type PhoneTab = State["phoneTab"]["value"];
export type Tabs = State["tabs"]["value"];
export type Selection = DofileHook["selection"]["value"];

/** Show an engine state (the machine stays where it is), and open `dialog` in the same step. */
export const showEngine = (page: Page, engine: EngineSeed, dialog?: Dialog) =>
  page.evaluate(
    (v) => {
      (window.__dofile.state.engine as Writable<"engine">).value = v.engine as EngineState;
      if (v.dialog) window.__dofile.state.dialog.value = v.dialog;
    },
    { engine, dialog },
  );

/** Show a view of the phone's bottom bar, and in the same step a toast and/or an engine state. */
export const showPhoneTab = (page: Page, tab: PhoneTab, also: { toast?: string; engine?: EngineSeed } = {}) =>
  page.evaluate(
    (v) => {
      const S = window.__dofile.state;
      S.phoneTab.value = v.tab;
      if (v.also.engine) (S.engine as Writable<"engine">).value = v.also.engine as EngineState;
      if (v.also.toast !== undefined) S.showToast(v.also.toast);
    },
    { tab, also },
  );

/** The theme, as the page sets it (signal and `data-theme`). */
export const showTheme = (page: Page, theme: "light" | "dark") =>
  page.evaluate((t) => {
    window.__dofile.state.theme.value = t;
    document.documentElement.dataset.theme = t;
  }, theme);

/** The Output pane unsplit (the log is a tab of it), showing `tab`. */
export const showUnsplitOutput = (page: Page, tab: "graph" | "log") =>
  page.evaluate((t) => {
    window.__dofile.state.split.value = false;
    window.__dofile.state.outputTab.value = t;
  }, tab);

export const openDialog = (page: Page, dialog: Dialog) =>
  page.evaluate((d) => {
    window.__dofile.state.dialog.value = d;
  }, dialog);

export const closeDialog = (page: Page) =>
  page.evaluate(() => {
    window.__dofile.state.dialog.value = null;
  });

export const showToast = (page: Page, text: string) => page.evaluate((t) => window.__dofile.state.showToast(t), text);

export const clearToast = (page: Page) =>
  page.evaluate(() => {
    (window.__dofile.state.toast as Writable<"toast">).value = null;
  });

export const addBanner = (page: Page, banner: Banner) =>
  page.evaluate((b) => window.__dofile.state.addBanner(b), banner);

/** Dismiss the banner of this kind (and path). */
export const dismissBanner = (page: Page, banner: { b: Banner["b"]; path?: string }) =>
  page.evaluate((b) => window.__dofile.state.dismiss(b as Banner), banner);

/** Put these items in the log, as a run would have written them. */
export const seedLog = (page: Page, items: LogItems) =>
  page.evaluate((v) => {
    window.__dofile.state.runWriter.log.value = v;
  }, items);

/** Put these graphs in the Output pane; `full` opens the full-size view in the same step. */
export const seedGraphs = (page: Page, graphs: Graphs, { full = false } = {}) =>
  page.evaluate(
    (v) => {
      window.__dofile.state.runWriter.graphs.value = v.graphs;
      if (v.full) window.__dofile.state.graphFull.value = true;
    },
    { graphs, full },
  );

/** Put these graphs and log items where a run would have, in one step. */
export const seedRunOutput = (page: Page, { graphs, log }: { graphs: Graphs; log: LogItems }) =>
  page.evaluate(
    (v) => {
      window.__dofile.state.runWriter.graphs.value = v.graphs;
      window.__dofile.state.runWriter.log.value = v.log;
    },
    { graphs, log },
  );

/** The last run, which marks the error line of its file (null: none). */
export const seedLastRun = (page: Page, run: LastRun) =>
  page.evaluate((v) => {
    window.__dofile.state.runWriter.lastRun.value = v;
  }, run);

/** Open the full-size graph view. */
export const showGraphFull = (page: Page) =>
  page.evaluate(() => {
    window.__dofile.state.graphFull.value = true;
  });

/** Give an open text tab an edit (a space at its end) without typing, so it is unsaved. */
export const markDirty = (page: Page, path: string) =>
  page.evaluate((p) => window.__dofile.documents.markDirty(p), path);

/** These tabs open, `active` the one shown (and `phoneTab` the phone's view, when given). A text tab is opened with an
 *  empty document, and an edit when it is `dirty`. */
export const showTabs = (page: Page, tabs: Tabs, active: string | null, phoneTab?: PhoneTab) =>
  page.evaluate(
    (v) => {
      window.__dofile.documents.showTabs(v.tabs, v.active);
      if (v.phoneTab) window.__dofile.state.phoneTab.value = v.phoneTab;
    },
    { tabs, active, phoneTab },
  );

/** The editor with these tabs open (`active` shown), no dialog, `engine` shown and `selection` made. A text tab has as
 *  many empty lines as the selection needs, and an edit when it is `dirty`. */
export const seedEditorBox = (
  page: Page,
  { engine, tabs, active, selection }: { engine: EngineSeed; tabs: Tabs; active: string | null; selection: Selection },
) =>
  page.evaluate(
    (v) => {
      const d = window.__dofile;
      d.state.dialog.value = null;
      (d.state.engine as Writable<"engine">).value = v.engine as EngineState;
      d.documents.showTabs(v.tabs, v.active, v.selection?.[1] ?? 1);
      d.documents.selectLines(v.selection);
    },
    { engine, tabs, active, selection },
  );

/** The status bar's inputs: whether the files are kept, the memory in use and the last run. */
export const seedStatusBar = (
  page: Page,
  { persisted, memory, lastRun }: { persisted: boolean; memory: State["memory"]["value"]; lastRun: LastRun },
) =>
  page.evaluate(
    (v) => {
      const S = window.__dofile.state;
      (S.persisted as Writable<"persisted">).value = v.persisted;
      (S.memory as Writable<"memory">).value = v.memory;
      S.runWriter.lastRun.value = v.lastRun;
    },
    { persisted, memory, lastRun },
  );

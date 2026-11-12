// The editor page's layout (docs/design/SPEC.md, section 2). One tree for every width, so the editor and the log are never
// mounted twice; app.css arranges it by `data-layout` and the width:
//  - desktop B, 1200 px and up: toolbar; Files | Editor | the right column; status bar. The right column is split (Log
//    above, the Output tabs Graph, Data, Results below) or unsplit (one pane: Log, Graph, Data, Results); `split` is kept.
//  - 700 to 1199 px: the same with the file list folded away; the Editor head's "Files" button (with the count of files)
//    unfolds it (OQ-14): the focus goes into the list, and Esc in it folds it and gives the focus back to the button,
//    unless a handler in the list used that Esc (4a's rename: call preventDefault()).
//  - phone, under 700 px: the top bar, one view at a time (`phoneTab`), the command line at the Log view's foot only (WP 1,
//    the Editor view, has none), and the bottom tablist "Views". Data and Results are views; graphs show in the log.
//    Each phone piece sits in this file next to its desktop counterpart: PhoneTopBar after Toolbar (and the phone's ⋯
//    items, phoneMoreItems, after the desktop's, moreItems), PhoneOutputViews after OutputPane, PhoneViews (the tab bar)
//    in place of the status bar. Each pane is a Pane: on a phone it is also one of the Views tablist's panels, hidden
//    while another view is selected. Components read `isPhone` (state.ts); no `phone` prop is passed down. Every phone
//    view has a BannerSlot, so a banner marked for every view (download-failed: banners.tsx) shows on the current one.
//    The phone ⋯'s Theme item cycles the theme and keeps the menu open (ui/Menu.tsx keepOpen).
//  The page itself never scrolls (app.css: .app is fixed to the window); on a phone with the keyboard open, .app is the
//  area above it, the tab bar is hidden, and the toast sits above the command line there (viewport.ts, app.css). Text
//  fields are 16 px or more on a phone (app.css), so iOS does not zoom in on focus: 4b's command line and editor too.
//
// Each step 4 part edits only its own files; this file only places them (two changes were made here when 4a was joined,
// on the maintainer's word: 4a's fileMenuItems are a "Files ⋯" button in the phone strip's right end on the Files view
// (the Files head is hidden on a phone), and the unfolded file list gives the focus to the tree's row; and one when 4b and 4d were joined: the phone ⋯'s
// Save is off unless the active tab is a text tab, as the toolbar's). Per part: the files,
// the signals it writes (state.ts), what it calls, and the slots here it fills. Every part reads any signal.
// Since step 3.5 C (the engine's state machine, engine/machine.ts; SPEC section 8):
//  - `engine` has the machine's sixteen state names (types.ts EngineState): the page load is `checking-lock`, then
//    `checking-cache` (`none` only with ?test=manual); `starting` is `starting-list` or `starting-worker`; `other-tab` is
//    `other-tab-idle` or `other-tab-taking`. A view that treats a pair alike writes two `case`s; CSS keyed on
//    <html data-engine> matches by prefix.
//  - A signal with one owner is a ReadonlySignal: assigning it in a view fails `npm run check`. Views write `graphIndex`,
//    `graphFull`, `dialog`, `tabs`, `activeTab`, `split`, `outputTab`, `phoneTab`, `pickedVar`, `theme` (and main.tsx
//    `layout`; `isolated` is set once at load); the rest through the controllers' actions and state.ts's helpers.
//  - There is no `about` signal: env.ts ABOUT (dofile, engine_commit, stata_version) is compiled in, there from the
//    first paint. engine.ts no longer maps the worker's status texts to stages (the worker sends typed stage ids): the
//    words of each Stage are stageStatus (the status bar) and stageWords (the live region).
//  - The engine's actions return nothing, and each acts only in the states the machine's table says (elsewhere it does
//    nothing): ask() in `none` and `declined`; decline in `asking` and `downloading`; start in `none`, `asking`,
//    `declined`, `failed`; reset in `ready`, `running`, `breaking`, `waiting`; takeOver in `other-tab-idle`.
//  - run.ts runCode and runCommand (through engine.ts run()) throw when called while a step of the state machine is in
//    progress: inside a handler given to connectRun, and also inside a signal effect on `engine` or `lastRun`, which are
//    written only during a step, or on a `log` write a step makes (a run's start and end; a streamed chunk and "Clear
//    log" write `log` outside a step, where the call does not throw: during a run it is refused). Start the next run
//    after the step: when the run's promise has resolved, say.
//   4a files/FilesPane.tsx (FilesHead, FilesBody), files/EditorTabs.tsx (EditorTabs, the phone's FileSwitcher),
//      files/FileBar.tsx (FileBar: the bars over a .csv, .tsv or .log), files/open.ts (openFile, decodeText),
//      log/ClearLogDialog.tsx (clear-log), files/dialogs.tsx (clash, delete, delete-all, close-tab; the words of delete-all and close-tab are decided: SPEC
//      3.10), files/banners.tsx (not-text).
//      Writes `tabs` (not `dirty`), `activeTab`, `dialog` (its four kinds), `banners` (not-text); openFile writes
//      `phoneTab` = "editor" on a phone when a text or .dta tab opens, and for a .png `outputTab` = "graph" (desktop) or
//      `graphFull` (phone); the phone's FileSwitcher writes `phoneTab` = "files" ("Show all files"). Calls store.*
//      (app/store.ts), files.ts downloadAll() and saveAs, editorCommands.open, reload, renamed, closed, save(path) and
//      focus (after a tab closes) (editor/commands.ts), run.ts addFileGraph(path, png) and runCommand(text) (Import),
//      state.ts addBanner, dismiss, showToast, say. The plain logic: files/tree.ts, files/actions.ts. downloadAll() makes no zip and resolves false when the store has no file
//      (folders do not count): disable your "Download all (.zip)" while state.ts `hasFiles` is false, as the ⋯ menu
//      does; a failure shows by itself (files.ts adds the banner download-failed). No tab can be dirty before 4b's
//      editor exists: 4a's tests of the close-tab and reload paths call state.ts setDirty(path, true) themselves.
//   4b editor/Editor.tsx, editor/commands.ts (fills editorCommands and `selection`), editor/RunControls.tsx,
//      editor/StatusBar.tsx, editor/banners.tsx (save-failed, run-changed), log/LogView.tsx, log/CommandLine.tsx
//      (CommandLine, LogActions, logMenuItems for the phone strip's "Log ⋯" button, PhoneStrip). The plain logic: editor/cm.ts, clock.ts,
//      csv.ts, errormark.ts, keys.ts, ranover.ts, words.ts; log/align.ts, classify.ts, find.ts, paste.ts, pasterun.ts.
//      Writes `tabs[].dirty` only through state.ts setDirty(path, on), `banners` (addBanner for save-failed; dismiss for
//      save-failed and run-changed), `graphIndex` and `outputTab` (a graph link; "log" when Find opens unsplit),
//      `graphFull` (a tap on an inline graph, phone), `phoneTab` = "log" (a tap on the phone's Break pill). Calls run.ts
//      runCode(code, head) and runCommand(text), engine.ts breakRun and reset ("Reset now"), files/open.ts openFile
//      (goToLine on a closed file), store.write (Save), files.ts saveAs (Download log, the save-failed banner's Download)
//      and textInStore with editorCommands.reload (the run-changed banner's "Reload from the run"), showToast, say. Reads the log's per-run data on each text item (`unsaved`, `end`: types.ts LogItem).
//      The command line: runCommand(text) returns { accepted, done } at once; clear the field only when `accepted` (it
//      ran, or was queued with no engine; then it is in `history`, an error too); refused (the page load, a start or a
//      run in progress): the text stays, and `history` is unchanged. A queued run goes from `starting-worker` straight to
//      `running`. The log's head ("dofile 0.1.0 · OpenDTA 0c3f3a2 · Stata 14 syntax") takes its values from env.ts ABOUT.
//   4c output/tabs.tsx (re-exports GraphTab, DataTab, ResultsTab from GraphTab.tsx, DataTab.tsx, ResultsTab.tsx),
//      output/FullSize.tsx (FullSize), output/DtaView.tsx (DtaView); the plain logic: output/format.ts, clip.ts, view.ts.
//      Writes `graphIndex`, `graphFull`, `pickedVar`. Not `rows`: "Show 50 more" calls run.ts moreRows(), which appends
//      (run.ts is the one writer of `rows`), and no view calls `browse`. Calls engine.ts call(op, args) (matrix,
//      describe_file: the read ops a view alone shows), run.ts moreRows() and runCommand(text) (Load), showToast ("Copied").
//   4d states/DownloadDialog.tsx (the other-tab dialog's "Close editor" goes to env.ts LANDING_URL, step 5's page),
//      states/ResetDialog.tsx (askReset), states/banners.tsx (the engine-state banners, reset, storage, memory, and
//      download-failed, built in step 3 and reworded by 4d). Writes `dialog` (reset; it closes download and
//      other-tab), `banners` (only dismiss()). Calls engine.ts start (also "Try again"), ask() (the declined banner's
//      "Download the engine"), decline, stopDownload, takeOver (the state is `other-tab-taking` while it is in progress,
//      and a second press does nothing), keepWaiting, reset; editorCommands.runFile ("Run the file
//      again") and editorCommands.focus (states/focus.ts focusStable); run.ts refreshData (Reset describes the memory
//      again after a run: states/words.ts resetDecision); files.ts downloadAll() (when the store cannot make the zip it resolves false and adds the banner
//      download-failed, which a later download that works removes; with no file to put in it, false and nothing shown).
//      A failed start's `message` is the visitor's words; its `detail` is the developer's cause (types.ts EngineState).
// editorCommands is filled field by field when 4b's editor mounts: every part calls through the object
// (editorCommands.save(path)) and never destructures it, or it keeps the no-op.
// Slots placed here: FilesHead, FilesBody, EditorTabs, FileBar, Editor (hidden, not unmounted, while a .dta tab shows
// DtaView in its place), StatusBar, LogView, LogActions, CommandLine, GraphTab, DataTab, ResultsTab, FullSize
// (once, over the page, every width); Toolbar places RunControls; PhoneTopBar places FileSwitcher and PhoneRun, and
// PhoneStrip goes under it, with "Files ⋯" or "Log ⋯" at its right end; PhoneOutputViews places the phone's DataTab and ResultsTab; the
// dialogs and banners are drawn through dialogs.tsx and banners.tsx. RunControls and PhoneRun keep one size in every
// state (ui/Icon.tsx Labels: every label in one cell); keep it so when adding to them, with short labels, since the
// widest sets the width. The toolbar's buttons share one height (tokens.css --control), a pane head's controls another
// (--control-sm); e2e/shell.spec.ts measures both.

import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { BannerSlot } from "./banners";
import { DialogHost } from "./dialogs";
import { editorCommands } from "./editor/commands.ts";
import { Editor } from "./editor/Editor";
import { PhoneRun, RunControls } from "./editor/RunControls";
import { StatusBar } from "./editor/StatusBar";
import { ABOUT, COMMANDS_URL, LANDING_URL } from "./env";
import { EditorTabs, FileSwitcher } from "./files/EditorTabs";
import { FileBar } from "./files/FileBar";
import { FilesBody, FilesHead, fileMenuItems } from "./files/FilesPane";
import { downloadAll } from "./files.ts";
import { CommandLine, LogActions, logMenuItems, PhoneStrip } from "./log/CommandLine";
import { LogView } from "./log/LogView";
import { DtaView } from "./output/DtaView";
import { FullSize } from "./output/FullSize";
import { DataTab, GraphTab, ResultsTab } from "./output/tabs";
import {
  activeTab,
  engine,
  files,
  hasFiles,
  isPhone,
  layout,
  outputTab,
  phoneTab,
  saved,
  split,
  tabs,
  theme,
  wrap,
} from "./state.ts";
import { askReset } from "./states/ResetDialog";
import { cycleTheme, THEME_ARIA, THEME_LABEL } from "./theme.ts";
import type { OutputTab, PhoneTab } from "./types.ts";
import { Icon } from "./ui/Icon";
import { LiveRegion, ToastHost } from "./ui/Live";
import { MenuButton, MenuHost, type MenuItem } from "./ui/Menu";
import { Tablist, tabpanelProps } from "./ui/Tablist";

// ---- the top bars and their ⋯ menus ----

const engineUp = () => ["ready", "running", "breaking", "waiting"].includes(engine.value.s);

/** The "Wrap lines" switch of both ⋯ menus; it leaves the menu open, so the visitor sees it flip. */
const wrapItem = (): MenuItem => ({ label: "Wrap lines", checked: wrap.value, onSelect: toggleWrap, keepOpen: true });

/** S 12: the desktop's ⋯ menu ("More actions"). */
const moreItems = (): MenuItem[] => [
  {
    label: "Download all (.zip)",
    disabled: !hasFiles.value,
    onSelect: () => {
      downloadAll();
    },
  },
  wrapItem(), // no "Clear log": the Log head has it (on a phone, the strip's "Log ⋯")
  { label: "Reset the engine…", danger: true, disabled: !engineUp(), onSelect: askReset },
  "rule",
  { label: "Commands", href: COMMANDS_URL },
  { label: "About dofile", hint: ABOUT.dofile, href: LANDING_URL },
];

/** The phone's ⋯ menu: Save and the theme (OQ-14), Wrap lines, Reset, Commands, About. The phone hides the Files and Log heads: their
 *  actions are a button at the right of the phone strip, "Files ⋯" on the Files view (4a's fileMenuItems) and "Log ⋯" on
 *  the Log view (4b's logMenuItems), the word hidden when the strip is narrow. Theme cycles and keeps the menu open. */
const phoneMoreItems = (): MenuItem[] => [
  {
    label: "Save",
    disabled: tabs.value.find((t) => t.path === activeTab.value)?.kind !== "text", // as the toolbar's Save (4b)
    onSelect: () => {
      editorCommands.save();
    },
  },
  {
    label: (
      <span>
        Theme: <Icon name="theme" /> {THEME_LABEL[theme.value]}
      </span>
    ),
    onSelect: cycleTheme,
    keepOpen: true,
  },
  wrapItem(),
  { label: "Reset the engine…", danger: true, disabled: !engineUp(), onSelect: askReset },
  "rule",
  { label: "Commands", href: COMMANDS_URL },
  { label: "About dofile", hint: ABOUT.dofile, href: LANDING_URL },
];

/** The desktop toolbar (E, section 3.4), from 700 px: the wordmark, Run and its neighbours, the theme button, ⋯. */
const Toolbar = () => (
  <header class="toolbar">
    <h1 class="visually-hidden">dofile editor</h1>
    <a class="wordmark" href={LANDING_URL}>
      do<span>file</span>
    </a>
    <RunControls />
    <span class="spacer" />
    <button type="button" class="theme" aria-label={THEME_ARIA[theme.value]} onClick={cycleTheme}>
      <Icon name="theme" />
      <span class="theme-word">{THEME_LABEL[theme.value]}</span>
    </button>
    <MenuButton label="More actions" items={moreItems}>
      <Icon name="more" />
    </MenuButton>
  </header>
);

const VIEW_TITLE = { files: "Files", log: "Log", data: "Data", results: "Results" } as const;

/** The phone's top bar (PH): the view's title (4a's FileSwitcher on the Editor view), ⋯, the one Run button. */
const PhoneTopBar = () => (
  <header class="toolbar topbar">
    <h1 class="title">{phoneTab.value === "editor" ? <FileSwitcher /> : VIEW_TITLE[phoneTab.value]}</h1>
    <MenuButton label="More actions" items={phoneMoreItems}>
      <Icon name="more" />
    </MenuButton>
    <PhoneRun />
  </header>
);

// ---- the panes ----

interface PaneProps {
  view: PhoneTab; // the phone view it is
  class: string;
  label: string; // its region's name
  children: ComponentChildren;
  id?: string;
  tabIndex?: number;
  onKeyDown?: (e: KeyboardEvent) => void;
}

/** A pane. On a phone it is also one of the Views tablist's panels, hidden while another view is selected. */
function Pane({ view, class: cls, label, children, ...rest }: PaneProps) {
  const phone = isPhone.value;
  const panel = phone ? tabpanelProps("views", view) : {};
  const hidden = phone && phoneTab.value !== view;
  return (
    <section class={`pane ${cls}`} aria-label={label} {...rest} {...panel} hidden={hidden}>
      {children}
    </section>
  );
}

/** At 700 to 1199 px: whether the folded file list is shown. */
const filesOpen = signal(false);
let filesToggle: HTMLButtonElement | null = null;

/** Unfold the file list and move the focus into it (4a's tree: its row in the tab order; else the pane itself), or fold
 *  it and give the focus back to the Files button. */
function foldFiles(open: boolean) {
  filesOpen.value = open;
  if (!open) filesToggle?.focus();
  else
    setTimeout(() => {
      // after the render that shows the pane
      const pane = document.getElementById("files-pane");
      (
        pane?.querySelector<HTMLElement>('[role="tree"] [tabindex="0"]') ??
        pane?.querySelector<HTMLElement>("button:not([disabled]), [href], input") ??
        pane
      )?.focus();
    });
}

/** Esc in the unfolded file list folds it, unless something in the list used that Esc (a rename, 4a: preventDefault). */
function onFilesKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented || !filesOpen.value || !filesToggle?.getClientRects().length) return;
  e.preventDefault();
  foldFiles(false);
}

/** The Editor head's "Files" button (and the count of files), which unfolds the file list at 700 to 1199 px (app.css
 *  hides it elsewhere); it looks pressed while the list is open. */
function FilesToggle() {
  const n = files.value.filter((f) => !f.dir).length;
  return (
    <button
      type="button"
      class="fold-toggle"
      ref={(el) => {
        filesToggle = el;
      }}
      aria-expanded={filesOpen.value}
      aria-controls="files-pane"
      onClick={() => foldFiles(!filesOpen.value)}
    >
      <Icon name="file" />
      Files{n > 0 && <span class="count">{n}</span>}
    </button>
  );
}

function toggleWrap() {
  wrap.value = !wrap.value;
  saved.set("dofile.wrap", wrap.value ? "1" : null);
}

function setSplit(on: boolean) {
  split.value = on;
  saved.set("dofile.split", on ? null : "0");
  if (on && outputTab.value === "log") outputTab.value = "graph";
}

const OUTPUT_TABS = [
  { id: "graph", label: "Graph" },
  { id: "data", label: "Data" },
  { id: "results", label: "Results" },
] as const;
const UNSPLIT_TABS = [{ id: "log", label: "Log" }, ...OUTPUT_TABS] as const;

const OutputPanel = ({ tab }: { tab: Exclude<OutputTab, "log"> }) =>
  tab === "graph" ? <GraphTab /> : tab === "data" ? <DataTab /> : <ResultsTab />;

/** The Log pane: the log and the command line. Desktop unsplit, it is the one Output pane with the tabs Log, Graph, Data,
 *  Results. On a phone it is the Log view; app.css hides its head there (the top bar names the view, and the ⋯ menu has
 *  its actions). */
function LogPane() {
  const unsplit = !isPhone.value && !split.value;
  const tab = outputTab.value;
  return (
    <Pane view="log" class="log-pane" label={unsplit ? "Output" : "Log"}>
      <div class={unsplit ? "pane-head tabbed" : "pane-head"}>
        {unsplit ? (
          <Tablist
            label="Output"
            idPrefix="out"
            tabs={[...UNSPLIT_TABS]}
            value={tab}
            onChange={(t) => {
              outputTab.value = t;
            }}
          />
        ) : (
          <span class="pane-title">Log</span>
        )}
        <span class="spacer" />
        <LogActions />
        <button
          type="button"
          class="head-link split-toggle"
          aria-label={split.value ? "Unsplit" : "Split"}
          title={split.value ? "Unsplit" : "Split"}
          onClick={() => setSplit(!split.value)}
        >
          <Icon name={split.value ? "unsplit" : "split"} />
          <span class="split-word">{split.value ? "Unsplit" : "Split"}</span>
        </button>
      </div>
      <BannerSlot place="log" />
      <div
        class="pane-body log-body"
        hidden={unsplit && tab !== "log"}
        {...(unsplit ? tabpanelProps("out", "log") : {})}
      >
        <LogView />
      </div>
      {unsplit && tab !== "log" && (
        <div class="pane-body" {...tabpanelProps("out", tab)}>
          <OutputPanel tab={tab} />
        </div>
      )}
      <CommandLine />
    </Pane>
  );
}

/** Desktop, split: the lower pane of the right column, the Output tabs Graph, Data, Results. Unsplit, they are in the
 *  Log pane. */
function OutputPane() {
  if (!split.value) return null;
  const tab = outputTab.value === "log" ? "graph" : outputTab.value;
  return (
    <section class="pane out-pane" aria-label="Graph, data and results">
      <div class="pane-head">
        <Tablist
          label="Output"
          idPrefix="out"
          tabs={[...OUTPUT_TABS]}
          value={tab}
          onChange={(t) => {
            outputTab.value = t;
          }}
        />
      </div>
      <div class="pane-body" {...tabpanelProps("out", tab)}>
        <OutputPanel tab={tab} />
      </div>
    </section>
  );
}

/** The phone's Data and Results views: the desktop's Output tabs without Graph (graphs show in the phone's log). Their
 *  banner slots hold only the banners shown on every phone view. */
const PhoneOutputViews = () => (
  <>
    <Pane view="data" class="out-pane" label="Data">
      <BannerSlot place="output" />
      <div class="pane-body">{phoneTab.value === "data" && <DataTab />}</div>
    </Pane>
    <Pane view="results" class="out-pane" label="Results">
      <BannerSlot place="output" />
      <div class="pane-body">{phoneTab.value === "results" && <ResultsTab />}</div>
    </Pane>
  </>
);

const VIEWS = (["files", "editor", "log", "data", "results"] as const).map((id) => ({
  id,
  label: id[0].toUpperCase() + id.slice(1),
  marker: <i aria-hidden="true" />,
}));

/** The phone's bottom tab bar, "Views". */
const PhoneViews = () => (
  <nav class="views" aria-label="Views">
    <Tablist
      label="Views"
      idPrefix="views"
      class="tabbar"
      tabClass="view"
      tabs={VIEWS}
      value={phoneTab.value}
      onChange={(t) => {
        phoneTab.value = t;
      }}
    />
  </nav>
);

export function App() {
  const phone = isPhone.value;
  const dta = tabs.value.find((t) => t.path === activeTab.value)?.kind === "dta" ? activeTab.value : null;
  return (
    <div class="app" data-layout={layout.value}>
      {phone ? <PhoneTopBar /> : <Toolbar />}
      {phone && (
        <PhoneStrip>
          {phoneTab.value === "files" && (
            <MenuButton label="File actions" class="head-link strip-actions" items={fileMenuItems}>
              <span class="strip-word">Files</span>
              <Icon name="more" />
            </MenuButton>
          )}
          {phoneTab.value === "log" && (
            <MenuButton label="Log actions" class="head-link strip-actions" items={logMenuItems}>
              <span class="strip-word">Log</span>
              <Icon name="more" />
            </MenuButton>
          )}
        </PhoneStrip>
      )}
      {/* no data-files on a phone: there the file list is a view, never folded */}
      <main
        class="main"
        data-files={phone ? undefined : filesOpen.value ? "open" : "folded"}
        data-split={split.value ? "split" : "unsplit"}
      >
        <Pane view="files" class="files-pane" label="Files" id="files-pane" tabIndex={-1} onKeyDown={onFilesKey}>
          <div class="pane-head">
            <span class="pane-title">Files</span>
            <span class="spacer" />
            <FilesHead />
          </div>
          <BannerSlot place="files" />
          <div class="pane-body">
            <FilesBody />
          </div>
        </Pane>
        <Pane view="editor" class="editor-pane" label="Editor">
          <div class="pane-head">
            <FilesToggle />
            <EditorTabs />
            <span class="spacer" />
          </div>
          <BannerSlot place="editor" />
          <div class="pane-body">
            <FileBar />
            <div class="editor-slot" hidden={dta !== null}>
              <Editor />
            </div>
            {dta !== null && <DtaView path={dta} />}
          </div>
        </Pane>
        <div class="out">
          <LogPane />
          {phone ? <PhoneOutputViews /> : <OutputPane />}
        </div>
      </main>
      {phone ? <PhoneViews /> : <StatusBar />}
      <FullSize />
      <LiveRegion />
      <ToastHost />
      <MenuHost />
      <DialogHost />
    </div>
  );
}

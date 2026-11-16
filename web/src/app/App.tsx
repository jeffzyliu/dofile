// The editor page's layout (SPEC section 2). One tree for every width, so the editor and the log are never mounted
// twice; app.css arranges it by `data-layout` and the width.

import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { BannerSlot } from "./banners";
import { DialogHost } from "./dialogs";
import { Editor } from "./editor/Editor";
import { PhoneRun, RunControls } from "./editor/RunControls";
import { StatusBar } from "./editor/StatusBar";
import { ABOUT, COMMANDS_URL, LANDING_URL } from "./env";
import { EditorTabs, FileSwitcher } from "./files/EditorTabs";
import { FileBar } from "./files/FileBar";
import { FilesBody, FilesHead, fileMenuItems, focusTree, NewFileButton } from "./files/FilesPane";
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

const engineUp = () => ["ready", "running", "breaking", "waiting"].includes(engine.value.s);

/** Wrap lines leaves the menu open, so the visitor sees it flip. */
const wrapItem = (): MenuItem => ({ label: "Wrap lines", checked: wrap.value, onSelect: toggleWrap, keepOpen: true });

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

/** The phone hides the Files and Log heads: their actions are the phone strip's "Files ⋯" and "Log ⋯" buttons. */
const phoneMoreItems = (): MenuItem[] => [
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

const PhoneTopBar = () => (
  <header class="toolbar topbar">
    <h1 class="title">{phoneTab.value === "editor" ? <FileSwitcher /> : VIEW_TITLE[phoneTab.value]}</h1>
    <MenuButton label="More actions" items={phoneMoreItems}>
      <Icon name="more" />
    </MenuButton>
    <PhoneRun />
  </header>
);

interface PaneProps {
  view: PhoneTab;
  class: string;
  label: string;
  children: ComponentChildren;
  id?: string;
  tabIndex?: number;
  onKeyDown?: (e: KeyboardEvent) => void;
}

/** On a phone a pane is also one of the Views tablist's panels, hidden while another view is selected. */
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

/** Whether the folded file list (700 to 1199 px) is shown. */
const filesOpen = signal(false);
let filesToggle: HTMLButtonElement | null = null;

function foldFiles(open: boolean) {
  filesOpen.value = open;
  if (!open) filesToggle?.focus();
  else focusTree(true);
}

/** Esc in the unfolded file list folds it, unless a handler in the list already used that Esc (preventDefault). */
function onFilesKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented || !filesOpen.value || !filesToggle?.getClientRects().length) return;
  e.preventDefault();
  foldFiles(false);
}

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
  if (!on) outputTab.value = "log"; // unsplit: the Log is what the visitor sees first
}

const OUTPUT_TABS = [
  { id: "graph", label: "Graph" },
  { id: "data", label: "Data" },
  { id: "results", label: "Results" },
] as const;
const UNSPLIT_TABS = [{ id: "log", label: "Log" }, ...OUTPUT_TABS] as const;

const OutputPanel = ({ tab }: { tab: Exclude<OutputTab, "log"> }) =>
  tab === "graph" ? <GraphTab /> : tab === "data" ? <DataTab /> : <ResultsTab />;

/** The log and the command line. Unsplit on a desktop, it is the one Output pane, with the tabs Log, Graph, Data and
 *  Results. On a phone app.css hides its head. */
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

/** No Graph view on a phone: graphs show in its log. These banner slots hold only the banners shown on every phone
 *  view. */
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
  // a .dta tab shows DtaView in the Editor's place; the Editor stays mounted, hidden
  const dta = tabs.value.find((t) => t.path === activeTab.value)?.kind === "dta" ? activeTab.value : null;
  return (
    <div class="app" data-layout={layout.value}>
      {phone ? <PhoneTopBar /> : <Toolbar />}
      {phone && (
        <PhoneStrip>
          {phoneTab.value === "files" && (
            <>
              <NewFileButton class="head-link icon strip-actions strip-new" />
              <MenuButton label="File actions" class="head-link strip-actions" items={fileMenuItems}>
                <span class="strip-word">Files</span>
                <Icon name="more" />
              </MenuButton>
            </>
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

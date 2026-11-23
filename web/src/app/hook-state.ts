// The e2e hook's `state` object, and the tests' `S`: the signals and owner functions of every state module, the theme, the
// Data tab's pick and the open tabs, as one object.
import { activeTab, tabs } from "./editor/documents.ts";
import { pickedVar, pickVar } from "./output/view.ts";
import * as Engine from "./state/engine.ts";
import * as Files from "./state/files.ts";
import * as Layout from "./state/layout.ts";
import * as Notices from "./state/notices.ts";
import * as Run from "./state/run.ts";
import * as Saved from "./state/saved.ts";
import { resolvedTheme, setTheme, theme } from "./theme.ts";

export const hookState = () => ({
  ...Engine,
  ...Files,
  ...Run,
  ...Layout,
  ...Notices,
  ...Saved,
  theme,
  resolvedTheme,
  setTheme,
  pickedVar,
  pickVar,
  tabs,
  activeTab,
});

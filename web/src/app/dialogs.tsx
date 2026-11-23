// Which view draws each kind of dialog. Add a kind here, in types.ts and in SPEC.md section 8 together.
// The host keys each view on the whole value, so a new value (clash 1 of 5, then clash 2) is a new <Dialog> and its
// focus starts again. A dialog that another replaces is unmounted with no answer: its view treats that as Cancel.
import type { ComponentType } from "preact";

import type { DialogName, DialogOf } from "./types.ts";

import { dialog } from "./state/notices.ts";

import { ClashDialog, CloseTabDialog, DeleteAllDialog, DeleteDialog } from "./files/dialogs";
import { ClearLogDialog } from "./log/ClearLogDialog";
import { DownloadDialog, OtherTabDialog } from "./states/DownloadDialog";
import { ResetDialog } from "./states/ResetDialog";

const VIEWS: { [K in DialogName]: ComponentType<{ dialog: DialogOf<K> }> } = {
  download: DownloadDialog,
  "other-tab": OtherTabDialog,
  reset: ResetDialog,
  clash: ClashDialog,
  delete: DeleteDialog,
  "delete-all": DeleteAllDialog,
  "clear-log": ClearLogDialog,
  "close-tab": CloseTabDialog,
};

export function DialogHost() {
  const d = dialog.value;
  if (!d) return null;
  const View = VIEWS[d.d] as ComponentType<{ dialog: typeof d }>;
  return <View key={JSON.stringify(d)} dialog={d} />;
}

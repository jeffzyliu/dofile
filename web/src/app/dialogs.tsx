// Which view draws each kind of dialog. The `dialog` signal (state.ts) holds the one open dialog, or null; whoever opens
// one sets it, and the dialog sets it back to null when it closes. Each view is in its owner's file:
//   download, other-tab: states/DownloadDialog.tsx (step 3 built them; step 4d finishes them)
//   reset:               states/ResetDialog.tsx (step 4d)
//   clash, delete, delete-all, close-tab: files/dialogs.tsx (step 4a)
// A view draws itself with ui/Dialog.tsx. Add a kind here, in types.ts and in SPEC.md section 8 together.
// The host keys each view on the whole value, so a new value (clash 1 of 5, then clash 2) is a new <Dialog>: its focus
// starts again on the data-autofocus button. A dialog that another replaces (other-tab over a clash) is unmounted with no
// answer: its view treats that as Cancel (an effect's cleanup that answers Cancel unless it has answered).
import type { ComponentType } from "preact";
import { ClashDialog, CloseTabDialog, DeleteAllDialog, DeleteDialog } from "./files/dialogs";
import { dialog } from "./state.ts";
import { DownloadDialog, OtherTabDialog } from "./states/DownloadDialog";
import { ResetDialog } from "./states/ResetDialog";
import type { Dialog, DialogName } from "./types.ts";

export type DialogOf<K extends DialogName> = Extract<NonNullable<Dialog>, { d: K }>;

const VIEWS: { [K in DialogName]: ComponentType<{ dialog: DialogOf<K> }> } = {
  download: DownloadDialog,
  "other-tab": OtherTabDialog,
  reset: ResetDialog,
  clash: ClashDialog,
  delete: DeleteDialog,
  "delete-all": DeleteAllDialog,
  "close-tab": CloseTabDialog,
};

export function DialogHost() {
  const d = dialog.value;
  if (!d) return null;
  const View = VIEWS[d.d] as ComponentType<{ dialog: typeof d }>;
  return <View key={JSON.stringify(d)} dialog={d} />;
}

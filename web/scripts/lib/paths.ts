// The checkout's folders, without a trailing slash: the repository root and web/.
import { fileURLToPath } from "node:url";

export const repo = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\/$/, "");
export const web = `${repo}/web`;

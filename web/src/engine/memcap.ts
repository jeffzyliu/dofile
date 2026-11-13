// Which devices get a cap on the engine's WebAssembly heap, and how much. By device, not by layout width: a narrow desktop
// window has the memory of its machine. The cap itself is snapshot.ts (HEAP_MAX); docs/browser-engine.md, "The memory cap".
//
// Why: iOS kills the tab when the heap grows past what it allows (about 1 GB seen on an iPhone) and never answers a failed
// grow, so the engine must refuse to ask. Under the cap, a big allocation raises MemoryError in Python, which the engine
// reports as r(909) "op. sys. refuses to provide memory", and the data and the session stay.

/** The cap on a phone, in MiB. The heap is 3.5 to 6 times the data (generate and replace copy a column), so this holds
 *  roughly 150 to 250 MB of data. Above the restored heap (130 MB) with room to work, under where an iPhone died (1.1 GB). */
export const PHONE_CAP_MB = 900;

/** What the rule reads of the browser. `mobile`: navigator.userAgentData?.mobile (Chromium); `deviceMemory`: navigator.deviceMemory
 *  (GB, rounded down to a power of two, at most 8; Chromium only, so Safari and Firefox have none). */
export interface DeviceFacts {
  userAgent: string;
  maxTouchPoints: number;
  mobile?: boolean;
  deviceMemory?: number;
}

/** `mb`: the cap in MiB, 0 for none (the browser's own limit); `why`: one phrase for the console. */
export interface Cap {
  mb: number;
  why: string;
}

type NavigatorFacts = Pick<Navigator, "userAgent" | "maxTouchPoints"> & {
  userAgentData?: { mobile?: boolean };
  deviceMemory?: number;
};
export const factsOf = (nav: NavigatorFacts): DeviceFacts => ({
  userAgent: nav.userAgent,
  maxTouchPoints: nav.maxTouchPoints,
  mobile: nav.userAgentData?.mobile,
  deviceMemory: nav.deviceMemory,
});

/** The cap for this device. `flag`: the URL's ?memcap value (null: absent): whole MiB, 0 for none; it wins over the device rule,
 *  for trying a cap on a real phone or a desktop. Anything else in it is ignored, and the console says so. */
export function chooseCap({ userAgent, maxTouchPoints, mobile, deviceMemory }: DeviceFacts, flag: string | null): Cap {
  let ignored = "";
  if (flag !== null) {
    if (/^\d+$/.test(flag)) return { mb: Number(flag), why: `?memcap=${flag}` };
    ignored = ` (?memcap=${flag} ignored: it must be a number of MB, 0 for none)`;
  }
  // every iOS browser is WebKit; an iPad asks for the desktop site and says Macintosh, but a Mac has no touch screen
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (ios) return { mb: PHONE_CAP_MB, why: `iOS or iPadOS${ignored}` };
  if (mobile === true) return { mb: PHONE_CAP_MB, why: `a mobile browser (userAgentData.mobile)${ignored}` };
  if (deviceMemory !== undefined && deviceMemory <= 4)
    return { mb: PHONE_CAP_MB, why: `deviceMemory ${deviceMemory} GB (4 or less)${ignored}` };
  return { mb: 0, why: `not iOS, not a mobile browser, deviceMemory ${deviceMemory ?? "n/a"}${ignored}` };
}

/** The one console line at start: the cap and why. */
export const capLine = ({ mb, why }: Cap): string =>
  `[dofile] engine memory cap: ${mb ? `${mb} MB` : "none (the browser's own limit)"}, ${why}`;

export const MIB = 1024 * 1024;

// STEP 4d: the download dialog's times re-render on this timer; the run's and the Break's times use editor/clock.ts's `now`.
// The machine has no clock (its events carry the time); a view may read Date.now().
import { useEffect, useState } from "preact/hooks";

/** The time now in ms, updated every `every` ms while the component is shown (`on` false: not updated). */
export function useNow(every = 250, on = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every, on]);
  return now;
}

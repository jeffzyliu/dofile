// STEP 4d: a view that shows a running time (the download's, a stage's, the run's, the Break countdown) re-renders on a timer.
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

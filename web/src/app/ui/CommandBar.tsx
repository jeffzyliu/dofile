// The bar over a file that has a command (Import, Load) and its Copy button; the off rule is start.ts barButton.
import type { fileCommand } from "../../stata/quote.ts";
import { copyText } from "../output/clip.ts";
import { barButton, startFirst, startOffer } from "../start.ts";
import { engine } from "../state/engine.ts";
import { showToast } from "../state/notices.ts";
import { takesRun } from "../states/predicates.ts";

type Props = {
  made: ReturnType<typeof fileCommand>;
  /** The classes of the row, the command and the primary button: the two bars look different. */
  row: string;
  code: string;
  button: string;
  verb: string;
  copyLabel: string;
  /** What a press with no engine wanted to do, for the toast: "import wages.csv". */
  what: string;
  run: (command: string) => unknown;
};

export function CommandBar({ made, row, code, button, verb, copyLabel, what, run }: Props) {
  const command = "command" in made ? made.command : null;
  const offer = startOffer(engine.value);
  const { off, disabled } = barButton(offer, command, takesRun(engine.value));
  return (
    <div class={row}>
      {command !== null ? (
        <code class={code}>{command}</code>
      ) : (
        <span class="why">{"problem" in made && made.problem}</span>
      )}
      <span class="spacer" />
      <button
        type="button"
        class={`${button}${off ? " off" : ""}`}
        disabled={disabled}
        aria-disabled={off ? "true" : undefined}
        onClick={() => {
          if (command === null) return;
          if (offer !== null) showToast(startFirst(offer, what), "error");
          else run(command);
        }}
      >
        {verb}
      </button>
      <button
        type="button"
        class="btn"
        aria-label={copyLabel}
        disabled={command === null}
        onClick={() => {
          if (command !== null) copyText(command);
        }}
      >
        Copy
      </button>
    </div>
  );
}

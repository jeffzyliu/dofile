// The commands page's entry (web/commands.html): the shared behavior, and the filter over the lists the build wrote into
// the page. Without this script the page is the full list.
import { filterNames } from "./filter.ts";
import "./site.ts";

const finder = document.getElementById("finder");
const field = document.getElementById("q") as HTMLInputElement | null;
const count = document.getElementById("count");
const none = document.getElementById("none");
const lists = [...document.querySelectorAll<HTMLElement>("ul.names")];

if (finder && field && count && none) {
  finder.hidden = false;
  const items = lists.map((ul) => [...ul.querySelectorAll<HTMLElement>("li")]);
  const total = items[0].length;
  const run = () => {
    const shown = filterNames(
      items.flat().map((li) => li.dataset.name ?? ""),
      field.value,
    );
    const on = new Set(shown);
    for (const li of items.flat()) li.hidden = !on.has(li.dataset.name ?? "");
    for (const [i, ul] of lists.entries()) {
      const heading = document.getElementById(ul.getAttribute("aria-labelledby") ?? "");
      const any = items[i].some((li) => !li.hidden);
      ul.hidden = !any;
      if (heading) heading.hidden = !any;
    }
    const n = items[0].filter((li) => !li.hidden).length;
    none.hidden = shown.length > 0;
    count.textContent = field.value.trim() ? `${n} of ${total} commands` : "";
  };
  field.addEventListener("input", run);
}

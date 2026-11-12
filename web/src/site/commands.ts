// The commands page's entry (web/commands.html): the shared behavior, and the filter over the lists the build wrote into
// the page. Without this script the page is the full list. Each list sits in its own <section> with its heading and note:
// a list with no name left hides its whole section.
import { countText, filterNames } from "./filter.ts";
import "./site.ts";

const finder = document.getElementById("finder");
const field = document.getElementById("q") as HTMLInputElement | null;
const count = document.getElementById("count");
const none = document.getElementById("none");
const commands = document.getElementById("names");
const prefixes = document.getElementById("prefixes");

if (finder && field && count && none && commands && prefixes) {
  finder.hidden = false;
  const lists = [commands, prefixes].map((ul) => ({ ul, items: [...ul.querySelectorAll<HTMLElement>("li")] }));
  const total = lists[0].items.length;
  const run = () => {
    const on = new Set(
      filterNames(
        lists.flatMap((l) => l.items.map((li) => li.dataset.name ?? "")),
        field.value,
      ),
    );
    const shown = lists.map(({ ul, items }) => {
      for (const li of items) li.hidden = !on.has(li.dataset.name ?? "");
      const n = items.filter((li) => !li.hidden).length;
      const section = ul.closest("section");
      if (section) section.hidden = n === 0;
      return n;
    });
    none.hidden = on.size > 0;
    count.textContent = countText(field.value, shown[0], total, shown[1]);
  };
  field.addEventListener("input", run);
}

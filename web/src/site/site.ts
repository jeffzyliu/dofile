// What the landing and commands pages share (docs/design/SPEC.md, section 3.12): the theme button and the Copy buttons.
// The pages are static HTML that shows at once; this only adds behavior. It imports nothing from src/app/ (no state, no
// store, no tab lock: a visitor reading the landing page must not touch the editor's files or its lock).
import "../styles/ui.css";
import "./site.css";

type Theme = "system" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const WORD: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };
// the same words as the editor's button (src/app/theme.ts)
const ARIA: Record<Theme, string> = {
  system: "Theme: follows the system. Press for light, then dark.",
  light: "Theme: light. Press for dark, then to follow the system.",
  dark: "Theme: dark. Press to follow the system, then light.",
};
const KEY = "dofile.theme"; // the editor's key: one choice for the whole site

function stored(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function themeButton() {
  const button = document.getElementById("theme") as HTMLButtonElement | null;
  if (!button) return;
  let theme = stored();
  const apply = () => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    button.setAttribute("aria-label", ARIA[theme]);
    const word = button.querySelector(".label-text");
    if (word) word.textContent = WORD[theme];
    try {
      if (theme === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      /* storage refused: the choice lasts until the page closes */
    }
  };
  button.hidden = false;
  button.addEventListener("click", () => {
    theme = NEXT[theme];
    apply();
  });
  apply();
}

/** Copy buttons: `data-copy` is the text; "Copied" shows beside the button for 2 s and the live region says it once. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // no clipboard permission (plain HTTP, or refused): select a hidden field's text
    const field = Object.assign(document.createElement("textarea"), { value: text });
    field.style.cssText = "position:fixed;opacity:0";
    document.body.append(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  }
}

function copyButtons() {
  const status = document.getElementById("copy-status");
  for (const b of document.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    b.addEventListener("click", async () => {
      const shown = b.parentElement?.querySelector<HTMLElement>(".copied");
      if (!(await copyText(b.dataset.copy ?? ""))) {
        if (status) status.textContent = "Couldn't copy: select the text and copy it by hand";
        return;
      }
      if (shown) shown.hidden = false;
      if (status) status.textContent = ""; // so the same words are read again on a second press
      setTimeout(() => {
        if (status) status.textContent = "Copied to the clipboard";
      }, 50);
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (shown) shown.hidden = true;
      }, 2000);
    });
  }
}

themeButton();
copyButtons();

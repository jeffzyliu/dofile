// The dofile banner candidates, shared by the mockups. An element with data-art="name" gets the banner;
// data-tail="text" adds muted text after the last line (the version). Two tones: solid strokes in the accent color,
// shading and box-drawing "shadow" in the muted color. Names in DROP get a one-pixel drop shadow from CSS instead.
window.ART = {
  // round 3: lowercase on square half-line pixels (▀ ▄ █), so horizontal strokes are half a line thick.
  // book: stems 2 chars wide, x-height 6 px (5 lines); thin: 1 char, x-height 5 px (4 lines). Sheared after D (Slant),
  // in steps on line boundaries (a step inside a character cell breaks the strokes): _slant one char per line,
  // _lean one char per two lines.
  book: ["     ██            ▄█▀▀  ▄▄  ██", "     ██            ██        ██", "▄█▀▀▀██  ▄█▀▀▀█▄  ▀██▀▀  ██  ██   ▄█▀▀▀█▄", "██   ██  ██   ██   ██    ██  ██   ██▀▀▀▀▀", "▀█▄▄▄██  ▀█▄▄▄█▀   ██    ██  ▀█▄  ▀█▄▄▄▄▄"],
  thin: ["    █          ▄▀▀  ▄  █", " ▄▄▄█   ▄▄▄   ▄█▄▄  ▄  █    ▄▄▄", "█   █  █   █   █    █  █   █▄▄▄█", "▀▄▄▄█  ▀▄▄▄▀   █    █  ▀▄  ▀▄▄▄▄"],
  book_slant: ["         ██            ▄█▀▀  ▄▄  ██", "        ██            ██        ██", "  ▄█▀▀▀██  ▄█▀▀▀█▄  ▀██▀▀  ██  ██   ▄█▀▀▀█▄", " ██   ██  ██   ██   ██    ██  ██   ██▀▀▀▀▀", "▀█▄▄▄██  ▀█▄▄▄█▀   ██    ██  ▀█▄  ▀█▄▄▄▄▄"],
  book_lean: ["       ██            ▄█▀▀  ▄▄  ██", "      ██            ██        ██", " ▄█▀▀▀██  ▄█▀▀▀█▄  ▀██▀▀  ██  ██   ▄█▀▀▀█▄", "██   ██  ██   ██   ██    ██  ██   ██▀▀▀▀▀", "▀█▄▄▄██  ▀█▄▄▄█▀   ██    ██  ▀█▄  ▀█▄▄▄▄▄"],
  thin_slant: ["       █          ▄▀▀  ▄  █", "   ▄▄▄█   ▄▄▄   ▄█▄▄  ▄  █    ▄▄▄", " █   █  █   █   █    █  █   █▄▄▄█", "▀▄▄▄█  ▀▄▄▄▀   █    █  ▀▄  ▀▄▄▄▄"],
  ansi_shadow: ["██████╗  ██████╗ ███████╗██╗██╗     ███████╗", "██╔══██╗██╔═══██╗██╔════╝██║██║     ██╔════╝", "██║  ██║██║   ██║█████╗  ██║██║     █████╗", "██║  ██║██║   ██║██╔══╝  ██║██║     ██╔══╝", "██████╔╝╚██████╔╝██║     ██║███████╗███████╗", "╚═════╝  ╚═════╝ ╚═╝     ╚═╝╚══════╝╚══════╝"],
  // lowercase, drawn by hand in ANSI Shadow's style (x-height 5, as its capitals; _flat: no shadow)
  lower: ["      ██╗             ████╗ ██╗ ██╗", "      ██║             ██╔═╝ ╚═╝ ██║", " ███████║  ██████╗  ██████╗ ██╗ ██║  ██████╗", "██╔═══██║ ██╔═══██╗ ╚═██╔═╝ ██║ ██║ ██╔═══██╗", "██║   ██║ ██║   ██║   ██║   ██║ ██║ ████████║", "██║   ██║ ██║   ██║   ██║   ██║ ██║ ██╔═════╝", "╚███████║ ╚██████╔╝   ██║   ██║ ██║ ╚██████╗", " ╚══════╝  ╚═════╝    ╚═╝   ╚═╝ ╚═╝  ╚═════╝"],
  lower_flat: ["      ██              ████  ██  ██", "      ██              ██        ██", " ███████   ██████   ██████  ██  ██   ██████", "██    ██  ██    ██    ██    ██  ██  ██    ██", "██    ██  ██    ██    ██    ██  ██  ████████", "██    ██  ██    ██    ██    ██  ██  ██", " ███████   ██████     ██    ██  ██   ██████"],
  mono9: ["     █           ▄▀▀    ▀    ▀▀█", "  ▄▄▄█   ▄▄▄   ▄▄█▄▄  ▄▄▄      █     ▄▄▄", " █▀ ▀█  █▀ ▀█    █      █      █    █▀  █", " █   █  █   █    █      █      █    █▀▀▀▀", " ▀█▄██  ▀█▄█▀    █    ▄▄█▄▄    ▀▄▄  ▀█▄▄▀"],
  pagga: ["░█▀▄░█▀█░█▀▀░▀█▀░█░░░█▀▀", "░█░█░█░█░█▀▀░░█░░█░░░█▀▀", "░▀▀░░▀▀▀░▀░░░▀▀▀░▀▀▀░▀▀▀"],
  future: ["╺┳┓┏━┓┏━╸╻╻  ┏━╸", " ┃┃┃ ┃┣╸ ┃┃  ┣╸", "╺┻┛┗━┛╹  ╹┗━╸┗━╸"],
  slant: ["       __      _____ __", "  ____/ /___  / __(_) /__", " / __  / __ \\/ /_/ / / _ \\", "/ /_/ / /_/ / __/ / /  __/", "\\__,_/\\____/_/ /_/_/\\___/"],
  standard: ["     _        __ _ _", "  __| | ___  / _(_) | ___", " / _` |/ _ \\| |_| | |/ _ \\", "| (_| | (_) |  _| | |  __/", " \\__,_|\\___/|_| |_|_|\\___|"],
};
const SHADE = { ansi_shadow: /[╗╔═║╚╝]/, lower: /[╗╔═║╚╝]/, pagga: /░/ };
// Flags after the name: "+drop" adds the CSS drop shadow (.art-drop), "+skew" slants the banner (.art-skew), as
// "book+drop+skew". The slant is CSS too: each line is skewed and moved right by its height above the last line, so
// the lines stay joined.
window.artName = spec => spec.split("+")[0];

function artLines(spec) {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const [name, ...flags] = spec.split("+");
  const drop = flags.includes("drop"), skew = flags.includes("skew");
  const shade = SHADE[name];
  const n = ART[name].length;
  return ART[name].map((line, i) => {
    const html = artRuns(line, shade, drop, esc);
    return skew ? `<span class="art-skew" style="--k:${n - 1 - i}">${html}</span>` : html;
  });
}

function artRuns(line, shade, drop, esc) {
  {
    if (drop) return `<span class="art-ink art-drop">${esc(line)}</span>`;
    // runs of shaded / solid characters, one span each
    let out = "", cls = null, run = "";
    for (const ch of line) {
      const k = shade && shade.test(ch) ? "art-shade" : "art-ink";
      if (k !== cls && run) { out += `<span class="${cls}">${esc(run)}</span>`; run = ""; }
      cls = k; run += ch;
    }
    return out + (run ? `<span class="${cls}">${esc(run)}</span>` : "");
  }
}

// Fill [data-art]: as plain lines, or, inside a .code block with data-ln, as numbered editor lines from data-ln.
// The banner is a drawing in block characters: hidden from screen readers (the page names dofile in text elsewhere).
window.fillArt = function () {
  for (const el of document.querySelectorAll("[data-art]")) {
    const lines = artLines(el.dataset.art);
    const tail = el.dataset.tail ? `   <span class="c">${el.dataset.tail}</span>` : "";
    if (el.dataset.ln) {
      const n0 = Number(el.dataset.ln);
      el.outerHTML = lines.map((l, i) =>
        `<span class="ln art-ln" aria-hidden="true"><span class="n">${n0 + i}</span>${l}${i === lines.length - 1 ? tail : ""}</span>`).join("");
    } else {
      el.innerHTML = lines.join("\n") + tail;
      el.setAttribute("aria-hidden", "true");
    }
  }
};

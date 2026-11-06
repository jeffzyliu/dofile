"""OpenDTA's visual schemes. They are its own: they do not reproduce StataCorp's
graph schemes (clean-room policy). `s2color`, `s1mono` etc. are
accepted as names and mapped to the OpenDTA equivalent closest
in spirit (color or monochrome)."""

from __future__ import annotations

import re

SCHEMES: dict[str, dict] = {
    "opendta": {
        "colors": ["#1f5f8b", "#c8553d", "#3c8d5a", "#8a5fa3", "#c9a227", "#4a9bb5", "#7a6a58", "#b8456b"],
        "background": "#ffffff",
        "plotregion": "#ffffff",
        "grid": "#e3e6ea",
        "axis": "#4a4f57",
        "text": "#1d2229",
        "font": "DejaVu Sans",
        "markers": ["o", "D", "s", "^", "v", "P", "X", "*"],
    },
    "opendta_mono": {
        "colors": ["#202020", "#606060", "#909090", "#404040", "#b0b0b0", "#707070", "#303030", "#a0a0a0"],
        "background": "#ffffff",
        "plotregion": "#ffffff",
        "grid": "#e6e6e6",
        "axis": "#303030",
        "text": "#101010",
        "font": "DejaVu Sans",
        "markers": ["o", "D", "s", "^", "v", "P", "X", "*"],
    },
    "opendta_dark": {
        "colors": ["#6fb3e0", "#f08a6b", "#7fcf95", "#c4a0e0", "#f0cf6b", "#7fd3e8", "#c8b8a0", "#f08ab0"],
        "background": "#1e2227",
        "plotregion": "#1e2227",
        "grid": "#353b43",
        "axis": "#aab1bb",
        "text": "#e8ebef",
        "font": "DejaVu Sans",
        "markers": ["o", "D", "s", "^", "v", "P", "X", "*"],
    },
}

# Stata names accepted for do-file compatibility
ALIASES = {"s2color": "opendta", "s2mono": "opendta_mono", "s1color": "opendta", "s1mono": "opendta_mono",
           "s1rcolor": "opendta_dark", "s1manual": "opendta_mono", "s2manual": "opendta_mono",
           "sj": "opendta_mono", "economist": "opendta", "default": "opendta"}

COLOR_NAMES = {
    "black": "#000000", "white": "#ffffff", "red": "#d62728", "blue": "#1f5f8b", "green": "#3c8d5a",
    "navy": "#1b2f5b", "maroon": "#7b1f2a", "orange": "#e07b39", "yellow": "#e8c547", "gray": "#808080",
    "grey": "#808080", "gs8": "#808080", "gs4": "#404040", "gs12": "#c0c0c0", "brown": "#7a5230",
    "purple": "#7a4fa0", "pink": "#e58fb0", "teal": "#2a8f8f", "cyan": "#33b5c8", "magenta": "#c040a0",
    "olive": "#6b7a2a", "eltblue": "#a8cbe8", "ltblue": "#9cc3e6", "dkgreen": "#1f6b3a", "dkorange": "#c45a1c",
    "cranberry": "#a01c44", "emerald": "#2aa36b", "forest_green": "#2a6b3a", "sienna": "#a0522d",
    "khaki": "#c3b091", "lavender": "#b4a7d6", "mint": "#a8e0c0", "sand": "#d8c8a0", "sandb": "#c8a870",
    "stone": "#b8b0a0", "ltkhaki": "#e0d8b0", "edkblue": "#2b4a6b", "eltgreen": "#b8e0b0",
}

SYMBOLS = {"o": "o", "circle": "o", "oh": "o", "circle_hollow": "o", "d": "D", "diamond": "D", "dh": "D",
           "s": "s", "square": "s", "sh": "s", "t": "^", "triangle": "^", "th": "^", "x": "x", "+": "+",
           "plus": "+", "p": ".", "point": ".", "none": "", "i": ""}

PATTERNS = {"solid": "-", "l": "-", "dash": "--", "-": "--", "dot": ":", ".": ":", "dash_dot": "-.",
            "-.": "-.", "shortdash": (0, (3, 2)), "longdash": (0, (8, 3)), "blank": ""}


def get(name: str | None) -> dict:
    n = (name or "opendta").lower()
    n = ALIASES.get(n, n)
    return SCHEMES.get(n, SCHEMES["opendta"])


_SUFFIXES = re.compile(r"^(?P<base>.*?)(?:\*(?P<k>\d*\.?\d+))?(?:%(?P<a>\d*\.?\d+))?$")


def _base_color(t: str) -> str | None:
    """A color name, `# # #` RGB, `#rrggbb` or `gs#`; None if it is none of these."""
    if t in COLOR_NAMES:
        return COLOR_NAMES[t]
    parts = t.split()
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        r, g, b = (min(255, int(p)) for p in parts)
        return f"#{r:02x}{g:02x}{b:02x}"
    if re.fullmatch(r"#[0-9a-f]{3}", t):   # #rgb, as in CSS: the opacity suffix needs the long form
        return "#" + "".join(ch * 2 for ch in t[1:])
    if t.startswith("#"):
        return t
    if t.startswith("gs") and t[2:].isdigit():
        v = round(255 * min(16, int(t[2:])) / 16)   # gs0 is black, gs16 white
        return f"#{v:02x}{v:02x}{v:02x}"
    return None


def color(text: str | None, default: str) -> str:
    """dofile patch (ODT-16): `none`, the `*#` intensity multiplier (Stata 14) and the `%#` opacity suffix
    (Stata 15+); `gs#` runs from black (gs0) to white (gs16). Anything else unknown still gives `default`
    (VERIFY: Stata refuses an invalid color; not done here because the name table is incomplete).
    `*#` below 1 mixes toward white, above 1 darkens: an approximation of Stata's intensity (VERIFY)."""
    if not text:
        return default
    t = text.replace('"', "").strip().lower()
    if t == "none":
        return "none"
    m = _SUFFIXES.match(t)
    c = _base_color(m.group("base").strip()) if m else None
    if c is None:
        return default
    if m.group("k") and len(c) == 7:
        k = float(m.group("k"))
        rgb = [int(c[i:i + 2], 16) for i in (1, 3, 5)]
        rgb = [255 - (255 - v) * k if k <= 1 else v / k for v in rgb]
        c = "#" + "".join(f"{max(0, min(255, round(v))):02x}" for v in rgb)
    if m.group("a") and len(c) == 7:
        c += f"{max(0, min(255, round(255 * float(m.group('a')) / 100))):02x}"
    return c

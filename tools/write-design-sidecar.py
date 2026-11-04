#!/usr/bin/env python3
"""Write the .impeccable/design.json sidecar for the gateway index page.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it. It reads the tokens out of DESIGN.md
and writes the sidecar the design panel renders.

    python3 tools/write-design-sidecar.py
"""

import colorsys
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".impeccable" / "design.json"

COLORS = {
    "ground": ("neutral", "Cool Ground"),
    "card": ("neutral", "Paper"),
    "ink": ("neutral", "Ink"),
    "muted-ink": ("neutral", "Muted Ink"),
    "subtle-ink": ("neutral", "Subtle Ink"),
    "hairline": ("neutral", "Hairline"),
    "wash": ("neutral", "Wash"),
    "primary": ("primary", "Indigo"),
    "up": ("secondary", "Answering"),
    "down": ("secondary", "Not Answering"),
    "danger": ("tertiary", "Correction"),
}

RAMP_LIGHTNESS = [0.14, 0.26, 0.38, 0.5, 0.62, 0.74, 0.86, 0.95]


def hex_to_rgb(value: str):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4))


def rgb_to_hex(rgb):
    return "#" + "".join(f"{round(max(0.0, min(1.0, c)) * 255):02x}" for c in rgb)


def ramp(hex_value: str):
    r, g, b = hex_to_rgb(hex_value)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return [rgb_to_hex(colorsys.hls_to_rgb(h, level, s)) for level in RAMP_LIGHTNESS]


def main() -> None:
    text = (ROOT / "DESIGN.md").read_text()
    front = text.split("---")[1]
    values = dict(re.findall(r"^\s{2}([a-z0-9-]+):\s*\"(#[0-9a-fA-F]{6})\"", front, re.M))

    color_meta = {}
    for key, (role, display) in COLORS.items():
        if key not in values:
            continue
        color_meta[key] = {
            "role": role,
            "displayName": display,
            "canonical": values[key],
            "tonalRamp": ramp(values[key]),
        }

    sidecar = {
        "schemaVersion": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "title": "Design System: Gatewarden",
        "extensions": {
            "colorMeta": color_meta,
            "typographyMeta": {
                "display": {
                    "displayName": "Display",
                    "purpose": "The page title, and nothing else. One per page.",
                },
                "title": {
                    "displayName": "Title",
                    "purpose": "Project names in the card heads.",
                },
                "body": {
                    "displayName": "Body",
                    "purpose": "Branch names, host names, the subject line.",
                },
                "label": {
                    "displayName": "Label",
                    "purpose": "Column heads, badges, ports, ages, the clock.",
                },
            },
            "shadows": [],
            "motion": [
                {
                    "name": "route-flash",
                    "value": "route-flash 900ms ease-out",
                    "purpose": "The one moment of motion: a route that changed state washes once and rests.",
                },
                {
                    "name": "control",
                    "value": "150ms",
                    "purpose": "Colour transitions on hover and focus. Nothing moves.",
                },
            ],
            "breakpoints": [
                {"name": "md", "value": "768px", "purpose": "Below this the table becomes a stacked block."},
            ],
        },
        "components": [
            {
                "name": "Primary Button",
                "kind": "button",
                "html": '<button class="btn btn-primary">Copy command</button>',
                "css": ".btn{height:36px;padding:8px 12px;border-radius:8px;font-size:14px;font-weight:500}"
                ".btn-primary{background:#2a49c9;color:#fff}.btn-primary:hover{background:#22409f}",
            },
            {
                "name": "Ghost Icon Button",
                "kind": "button",
                "html": '<button class="btn btn-ghost btn-icon" aria-label="Copy address">'
                '<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">'
                '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>',
                "css": ".btn-ghost{color:#57616d}.btn-ghost:hover{background:#eef1f6;color:#14181d}.btn-icon{width:32px;height:32px;padding:0}",
            },
            {
                "name": "Status Badge",
                "kind": "chip",
                "html": '<span class="route-state badge">Up</span>',
                "css": ".badge{border-radius:6px;border:1px solid;padding:2px 8px;font-size:12px;font-weight:500}"
                ".route-body[data-state=up] .route-state{background:#e7f4ee;border-color:#b6dfcd;color:#0f7a55}"
                ".route-body[data-state=down] .route-state{background:transparent;border-color:#e2e6ee;color:#64748b}",
            },
            {
                "name": "Project Card",
                "kind": "card",
                "html": '<section class="card overflow-hidden"><div class="border-b border-border px-6 py-4">'
                '<h2 class="text-lg font-semibold tracking-tight">traefik-api</h2></div></section>',
                "css": ".card{background:#fff;border:1px solid #e2e6ee;border-radius:12px}",
            },
            {
                "name": "Route Table",
                "kind": "custom",
                "html": '<table class="table"><thead class="table-head"><tr><th>Route</th><th>Endpoint</th>'
                '<th>Status</th></tr></thead><tbody class="table-body"><tr><td>main</td><td>main.traefik-api.example.com</td>'
                '<td><span class="route-state badge">Up</span></td></tr></tbody></table>',
                "css": ".table{width:100%;font-size:14px}.table-head th{font-size:12px;text-transform:uppercase;"
                "letter-spacing:.025em;color:#57616d;padding:12px 24px;border-bottom:1px solid #e2e6ee}"
                ".table-body td{padding:16px 24px;border-bottom:1px solid #e2e6ee}.table-body tr:hover{background:#eef1f6}",
            },
        ],
        "narrative": {
            "northStar": "The Daylight Register.",
            "overview": "The gateway index is a standing screen on the client's own desk, read at a glance while agents work. "
            "It is a well-lit page of type, held in one column, where the only thing that shouts is the state of a route.",
            "keyCharacteristics": [
                "A page, not a panel: one column, generous air, no boxes around groups.",
                "A table with printed column heads, not a list of cards.",
                "The state of a route is a badge and an edge: filled against outlined, solid against broken.",
                "Buttons are quiet: a ghost icon button for the two actions, one filled button in the empty state.",
                "The figures that change in place sit on tabular figures, so the page does not twitch while it is live.",
            ],
            "rules": [
                {
                    "section": "Components",
                    "rule": "The State Rule.",
                    "body": "Keep the state legible by more than colour: the badge says the word, the edge says the shape, and both change together.",
                },
                {
                    "section": "Elevation & Depth",
                    "rule": "The Flat Rule.",
                    "body": "The page is flat. There is not one shadow on it. Depth is declared once, by the hairline.",
                },
                {
                    "section": "Typography",
                    "rule": "The Stable Figures Rule.",
                    "body": "Keep the numbers that change in place on tabular figures.",
                },
            ],
            "dos": [
                "Keep the state legible by more than colour.",
                "Keep the numbers that change in place on tabular figures.",
                "Keep the page free of shadows; if something needs to float, it is missing a border.",
            ],
            "donts": [
                "Do not put a word where an icon belongs, or an icon where a word belongs.",
                "Do not add a second accent colour: indigo acts, emerald answers, slate does not, red destroys.",
                "Do not let a utility class reach the page without compiling the stylesheet.",
                "Do not ask a CDN for anything.",
            ],
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(sidecar, indent=2) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()

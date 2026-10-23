#!/usr/bin/env python3
"""Compare what the old and the new stylesheet actually render.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it.

    python3 tools/compare-css.py <url> <old-css-file>

It loads the page twice — once with the stylesheet the registry serves, once
with the old stylesheet intercepted — and compares the computed styles of the
elements that carry the design. A stylesheet rebuild that changes nothing
but the quoting of a font stack must change nothing here.
"""

import json
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1]
OLD_CSS = open(sys.argv[2], "rb").read()

SELECTORS = [
    "body",
    "h1",
    "h2",
    "header",
    ".card",
    ".card .badge",
    ".table",
    ".table-head th",
    ".table-body td",
    ".table-body tr:hover",
    ".route-address",
    ".route-state",
    ".route-inside",
    ".route-age",
    ".btn",
    ".btn-icon",
    "code",
    "footer",
]

PROPERTIES = [
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "color",
    "background-color",
    "border-color",
    "border-radius",
    "border-top-width",
    "border-top-style",
    "padding",
    "margin",
    "box-shadow",
    "font-variant-numeric",
    "text-decoration-line",
    "text-underline-offset",
    "gap",
    "display",
]


def snapshot(page):
    out = {}
    for selector in SELECTORS:
        node = page.query_selector(selector)
        if not node:
            continue
        style = page.evaluate(
            "(node) => { const s = getComputedStyle(node);"
            f" const o = {{}}; for (const p of {json.dumps(PROPERTIES)}) o[p] = s[p]; return o; }}",
            node,
        )
        out[selector] = style
    out["__fonts__"] = page.evaluate(
        "() => [...document.fonts].map(f => f.family + ' ' + f.weight + ' ' + f.status).sort()"
    )
    return out


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])

    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(URL, wait_until="networkidle")
    page.evaluate("document.fonts.ready")
    new = snapshot(page)
    page.close()

    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.route(
        "**/index.css",
        lambda route: route.fulfill(status=200, content_type="text/css; charset=utf-8", body=OLD_CSS),
    )
    page.goto(URL, wait_until="networkidle")
    page.evaluate("document.fonts.ready")
    old = snapshot(page)
    page.close()

    browser.close()

differences = []
for key in sorted(set(old) | set(new)):
    if key not in old:
        differences.append(f"{key}: only in the new stylesheet")
        continue
    if key not in new:
        differences.append(f"{key}: only in the old stylesheet")
        continue
    if isinstance(old[key], dict):
        for prop in PROPERTIES:
            if old[key].get(prop) != new[key].get(prop):
                differences.append(f"{key} {prop}: old={old[key].get(prop)!r} new={new[key].get(prop)!r}")
    elif old[key] != new[key]:
        differences.append(f"{key}: old={old[key]!r} new={new[key]!r}")

if differences:
    print("THE TWO STYLESHEETS RENDER DIFFERENTLY:")
    for difference in differences:
        print(" ", difference)
    sys.exit(1)

print("the two stylesheets render identically")
print(json.dumps({k: new[k] for k in list(new)[:2]}, indent=2)[:400])

#!/usr/bin/env python3
"""Pixel-compare the page under the old and the new stylesheet.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it.

    python3 tools/compare-css-pixels.py <url> <old-css-file>

The clock in the masthead is server rendered and changes every second, so it
is hidden in both captures; everything else must be pixel for pixel the same.
"""

import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1]
OLD_CSS = open(sys.argv[2], "rb").read()

HIDE_CLOCK = "#checked-at, #route-answering, #route-count { visibility: hidden !important; }"


def capture(browser, intercept_old):
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    if intercept_old:
        page.route(
            "**/index.css",
            lambda route: route.fulfill(status=200, content_type="text/css; charset=utf-8", body=OLD_CSS),
        )
    page.goto(URL, wait_until="networkidle")
    page.evaluate("document.fonts.ready")
    page.add_style_tag(content=HIDE_CLOCK)
    page.wait_for_timeout(200)
    image = page.screenshot(full_page=True)
    page.close()
    return image


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    new = capture(browser, intercept_old=False)
    old = capture(browser, intercept_old=True)
    browser.close()

if old == new:
    print(f"pixel identical ({len(new)} bytes)")
else:
    print(f"THE RENDER CHANGED: old {len(old)} bytes, new {len(new)} bytes")
    open("/tmp/old-css.png", "wb").write(old)
    open("/tmp/new-css.png", "wb").write(new)
    sys.exit(1)

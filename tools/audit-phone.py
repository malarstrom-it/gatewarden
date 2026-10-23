#!/usr/bin/env python3
"""Measure the page on a phone and where its feedback lands.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it.

    python3 tools/audit-phone.py <url>
"""

import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://index.home.malarstrom.com/"

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.goto(URL, wait_until="networkidle")
    page.evaluate("document.fonts.ready")

    print("--- page weight")
    weights = page.evaluate(
        "() => performance.getEntriesByType('resource')"
        ".map(e => [e.name.replace(location.origin, ''), e.transferSize, e.decodedBodySize])"
    )
    total = 0
    for name, transfer, decoded in weights:
        total += transfer or 0
        print(f"  {name}: {transfer} bytes over the wire ({decoded} decoded)")
    print(f"  total: {total} bytes, requests: {len(weights)}")

    print("--- paint")
    paint = page.evaluate(
        "() => performance.getEntriesByType('paint').map(p => p.name + ' ' + Math.round(p.startTime) + 'ms')"
    )
    print(" ", paint)

    print("--- is the feedback visible when the list is long?")
    scrollable = page.evaluate("() => document.documentElement.scrollHeight > window.innerHeight + 200")
    print("  the page scrolls:", scrollable)
    if scrollable:
        page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
        page.wait_for_timeout(200)
        message = page.query_selector("#message").bounding_box()
        print(f"  #message at y={round(message['y'])} in a 844px viewport →", "OFF SCREEN" if message["y"] < 0 else "visible")
        print("  the message is at the top of the document, far from the rows the user is working on")

    browser.close()

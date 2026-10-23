#!/usr/bin/env python3
"""Check the cursor and the touch targets of the index page.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it.

    python3 tools/cursor-and-targets.py <url>
"""

import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://index.home.malarstrom.com/"

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(URL, wait_until="networkidle")
    page.evaluate("document.fonts.ready")

    print("--- cursor on the controls")
    for selector in ["button.copy", "button.remove", ".route-address", "a"]:
        node = page.query_selector(selector)
        if node:
            print(f"  {selector}: cursor={page.evaluate('e => getComputedStyle(e).cursor', node)!r}")

    print("--- touch targets (WCAG 2.5.8 wants 24x24, Apple wants 44x44)")
    for selector in ["button.copy", "button.remove", ".route-address"]:
        node = page.query_selector(selector)
        if node:
            box = node.bounding_box()
            print(f"  {selector}: {round(box['width'])}x{round(box['height'])} px")

    print("--- tab order")
    page.keyboard.press("Tab")
    for index in range(5):
        active = page.evaluate(
            "() => { const a = document.activeElement;"
            " return a ? (a.tagName + ' ' + (a.getAttribute('aria-label') || a.className || '')) : 'none'; }"
        )
        print(f"  tab {index + 1}: {active}")
        page.keyboard.press("Tab")

    print("--- Escape while a removal is pending")
    page.locator("button.remove").first.click()
    page.wait_for_selector(".route-confirm", timeout=5000)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    print("  confirm row still there:", page.locator(".route-confirm").count())
    print("  focus after Escape:", page.evaluate("() => document.activeElement.tagName + ' ' + (document.activeElement.textContent || '')"))

    browser.close()

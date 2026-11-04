#!/usr/bin/env python3
"""Probe the index page for the questions a review asks.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it.

    python3 tools/audit-probes.py <url> [--long]
"""

import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://index.example.com/"
LONG = "--long" in sys.argv

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(URL, wait_until="networkidle")
    page.evaluate("document.fonts.ready")

    print("--- where the feedback goes when the list is long")
    scrollable = page.evaluate("() => document.documentElement.scrollHeight > window.innerHeight + 200")
    print("  the page is long enough to scroll:", scrollable)
    if scrollable:
        page.evaluate("() => window.scrollTo(0, 600)")
        page.wait_for_timeout(200)
        message = page.query_selector("#message").bounding_box()
        height = page.evaluate("() => window.innerHeight")
        print(f"  #message at y={round(message['y'])} in a viewport of {height} →", "OFF SCREEN" if message["y"] < 0 else "visible")
        page.evaluate("() => window.scrollTo(0, 0)")

    print("--- does a poll that re-renders the list destroy a pending confirmation?")
    page.locator("button.remove").first.click()
    page.wait_for_selector(".route-band", timeout=5000)
    print("  confirm rows before the poll:", page.locator(".route-band").count())
    # Exactly what the page's own poll does when the set of routes changes.
    page.evaluate(
        "async () => { const html = await fetch('/api/routes', {cache: 'no-store'}).then(r => r.text());"
        " document.getElementById('routes').innerHTML = html; }"
    )
    page.wait_for_timeout(300)
    print("  confirm rows after the poll:", page.locator(".route-band").count())
    print("  focus after the poll:", page.evaluate("() => document.activeElement.tagName + ' ' + (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || '')").strip())

    print("--- what a screen reader is told when a route changes state")
    print("  live regions:", page.evaluate("() => [...document.querySelectorAll('[aria-live], [role=status], [role=alert]')].map(n => n.getAttribute('aria-live') || n.getAttribute('role'))"))
    print("  the state badge is a live region:", page.locator(".route-state[aria-live]").count())

    print("--- title and label on the icon buttons")
    print("  copy title:", page.locator("button.copy").first.get_attribute("title"))
    print("  copy aria-label:", page.locator("button.copy").first.get_attribute("aria-label"))

    print("--- structure")
    print("  headings:", page.evaluate("() => [...document.querySelectorAll('h1,h2,h3')].map(h => h.tagName + ':' + h.textContent.trim().slice(0, 30))"))
    print("  landmarks:", page.evaluate("() => [...document.querySelectorAll('header,main,footer,nav')].map(n => n.tagName)"))
    print("  every table has a caption:", page.evaluate("() => [...document.querySelectorAll('table')].every(t => t.querySelector('caption'))"))

    browser.close()

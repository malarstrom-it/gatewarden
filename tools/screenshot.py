#!/usr/bin/env python3
"""Screenshot the gateway index page with Playwright.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it.
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://index.home.malarstrom.com/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "artifacts/screenshots")
OUT.mkdir(parents=True, exist_ok=True)

SIZES = [("desktop", 1440, 900), ("tablet", 834, 1112), ("phone", 390, 844)]

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    problems = []
    for name, width, height in SIZES:
        page = browser.new_page(viewport={"width": width, "height": height})
        page.on("console", lambda msg: problems.append(f"console {msg.type}: {msg.text}") if msg.type in ("error", "warning") else None)
        page.on("pageerror", lambda err: problems.append(f"pageerror: {err}"))
        response = page.goto(URL, wait_until="networkidle", timeout=30000)
        print(name, response.status if response else None, page.title())
        page.screenshot(path=str(OUT / f"index-{name}.png"), full_page=True)
        page.close()
    browser.close()

if problems:
    print("PROBLEMS:")
    for problem in problems:
        print(" ", problem)
else:
    print("no console errors")

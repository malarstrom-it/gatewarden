#!/usr/bin/env python3
"""Capture the new-route panel on the live page.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it.

    python3 tools/capture-new-route.py <url> <out-dir>
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://index.home.malarstrom.com/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "artifacts/screenshots/daylight")
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])

    desktop = browser.new_page(viewport={"width": 1440, "height": 900})
    desktop.goto(URL, wait_until="networkidle")
    desktop.evaluate("document.fonts.ready")
    desktop.click("#new-route-toggle")
    desktop.wait_for_timeout(200)
    desktop.screenshot(path=str(OUT / "new-route-panel.png"))
    desktop.close()

    phone = browser.new_page(viewport={"width": 390, "height": 844})
    phone.goto(URL, wait_until="networkidle")
    phone.evaluate("document.fonts.ready")
    phone.click("#new-route-toggle")
    phone.wait_for_timeout(200)
    phone.screenshot(path=str(OUT / "new-route-phone.png"), full_page=True)
    phone.close()

    browser.close()

print(f"captured the panel into {OUT}")

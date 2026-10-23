#!/usr/bin/env python3
"""Capture the states of the gateway index page for a design review.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it.

    python3 tools/review-states.py <url> <out-dir> [--empty-url <url>]
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://index.home.malarstrom.com/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "artifacts/screenshots")
EMPTY_URL = None
if "--empty-url" in sys.argv:
    EMPTY_URL = sys.argv[sys.argv.index("--empty-url") + 1]
OUT.mkdir(parents=True, exist_ok=True)

problems = []

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("console", lambda m: problems.append(f"console {m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
    page.goto(URL, wait_until="networkidle", timeout=30000)

    # --- hover on a button -------------------------------------------------
    page.hover("li.route >> nth=0 >> button.copy")
    page.screenshot(path=str(OUT / "state-hover.png"))

    # --- keyboard focus on the first link ----------------------------------
    page.keyboard.press("Tab")
    page.keyboard.press("Tab")
    page.keyboard.press("Tab")
    focused = page.evaluate("document.activeElement?.className")
    print("focus after three tabs:", repr(focused))
    page.screenshot(path=str(OUT / "state-focus.png"))

    # --- the confirmation --------------------------------------------------
    page.locator("li.route >> nth=0 >> button.remove").click()
    page.wait_for_selector(".route__confirm", timeout=5000)
    page.screenshot(path=str(OUT / "state-confirm.png"))
    page.locator(".route__confirm .confirm-no").click()

    # --- a failed removal --------------------------------------------------
    page.route("**/api/registrations/**", lambda route: route.fulfill(status=500, body="boom"))
    page.locator("li.route >> nth=0 >> button.remove").click()
    page.wait_for_selector(".route__confirm .confirm-yes", timeout=5000)
    page.locator(".route__confirm .confirm-yes").click()
    page.wait_for_timeout(800)
    print("row error:", repr(page.locator(".route__error").inner_text()))
    print("page message:", repr(page.locator("#message").inner_text()))
    page.screenshot(path=str(OUT / "state-error.png"))
    page.unroute("**/api/registrations/**")

    # --- the empty state ---------------------------------------------------
    if EMPTY_URL:
        empty = browser.new_page(viewport={"width": 1440, "height": 900})
        empty.goto(EMPTY_URL, wait_until="networkidle", timeout=30000)
        empty.screenshot(path=str(OUT / "state-empty.png"), full_page=True)
        empty.close()

    browser.close()

if problems:
    print("PROBLEMS:")
    for problem in problems:
        print(" ", problem)
else:
    print("no console errors")

#!/usr/bin/env python3
"""Drive the gateway index page and check that it behaves like an application.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it.
"""

import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://index.home.malarstrom.com/"
CLI = ["node", "bin/traefik-dev.js"]
# Extra flags for the CLI, e.g. --state-dir /tmp/preview --config /tmp/preview/config.json
CLI_EXTRA = sys.argv[3:]
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "artifacts/screenshots")
OUT.mkdir(parents=True, exist_ok=True)

problems = []
notes = []


def cli(*args):
    result = subprocess.run(CLI + list(args) + CLI_EXTRA, capture_output=True, text=True)
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def check(condition, message):
    if condition:
        notes.append("ok   " + message)
    else:
        problems.append("FAIL " + message)
        notes.append("FAIL " + message)


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    console_problems = []
    page.on("console", lambda m: console_problems.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: console_problems.append(f"pageerror: {e}"))

    page.goto(URL, wait_until="networkidle", timeout=30000)
    page.evaluate("window.__marker = 'still here'")

    # --- a new route appears without a reload ------------------------------
    code, out, err = cli("register", "--project", "demo", "--branch", "polltest", "--port", "5202")
    check(code == 0, f"registered the throwaway route ({err})")
    page.wait_for_selector('tr[data-registration-id="demo/polltest"]', timeout=15000)
    marker = page.evaluate("window.__marker")
    check(marker == "still here", "the page was not reloaded when the route appeared")
    check(page.locator('tr[data-registration-id="demo/polltest"]').count() == 1, "the new route is on the page")

    # --- the state follows the dev server ----------------------------------
    row = page.locator('tr[data-registration-id="demo/polltest"]')
    check(row.get_attribute("data-state") == "down", "a route without a dev server is not answering")
    subprocess.Popen(["node", "/tmp/demo-server-2.mjs"])
    time.sleep(1)
    page.wait_for_function(
        "() => document.querySelector('[data-registration-id=\\'demo/polltest\\']')?.getAttribute('data-state') === 'up'",
        timeout=15000,
    )
    check(True, "the route flips to answering when the dev server comes up")

    subprocess.run(["pkill", "-f", "demo-server-2.mjs"])
    time.sleep(1)
    page.wait_for_function(
        "() => document.querySelector('[data-registration-id=\\'demo/polltest\\']')?.getAttribute('data-state') === 'down'",
        timeout=15000,
    )
    check(True, "the route falls back to not answering when the dev server stops")

    # --- the removal asks first --------------------------------------------
    row.locator("button.remove").click()
    page.wait_for_selector(".route-band", timeout=5000)
    check(page.locator(".route-band").count() == 1, "the removal asks before it acts")
    page.screenshot(path=str(OUT / "index-confirm.png"))

    page.locator(".route-band .confirm-no").click()
    check(page.locator('tr[data-registration-id="demo/polltest"]').count() == 1, "keeping the route leaves it alone")

    page.locator('tr[data-registration-id="demo/polltest"] button.remove').click()
    page.wait_for_selector(".route-band .confirm-yes", timeout=5000)
    page.locator(".route-band .confirm-yes").click()
    # The removal is said in the route's own band, under the row.
    page.wait_for_function(
        "() => [...document.querySelectorAll('.route-band__text')].some(n => n.textContent.includes('Removed'))",
        timeout=15000,
    )
    check(True, "the removal says what happened, in the route's band")
    page.wait_for_function(
        "() => !document.querySelector('[data-registration-id=\\'demo/polltest\\']')", timeout=15000
    )
    check(True, "the row is gone after the removal")
    page.screenshot(path=str(OUT / "index-removed.png"))

    # --- the keyboard ------------------------------------------------------
    page.keyboard.press("Tab")
    page.keyboard.press("Tab")
    focused = page.evaluate("document.activeElement?.className")
    notes.append(f"info focus after two tabs: {focused!r}")
    page.screenshot(path=str(OUT / "index-focus.png"))

    # --- reduced motion ----------------------------------------------------
    reduced = browser.new_page(viewport={"width": 1440, "height": 900})
    reduced.emulate_media(reduced_motion="reduce")
    reduced.goto(URL, wait_until="networkidle", timeout=30000)
    duration = reduced.evaluate(
        "() => getComputedStyle(document.querySelector('.route-body td')).transitionDuration"
    )
    longest = max(float(part.replace("s", "").strip()) for part in duration.split(","))
    check(longest < 0.01, f"the route transition is off under reduced motion ({duration})")
    reduced.screenshot(path=str(OUT / "index-reduced-motion.png"), full_page=True)
    reduced.close()

    check(not console_problems, f"no console errors ({console_problems})")
    browser.close()

print("\n".join(notes))
if problems:
    print("\nPROBLEMS:")
    print("\n".join(problems))
    sys.exit(1)
print("\nall interaction checks passed")

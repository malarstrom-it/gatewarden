#!/usr/bin/env python3
"""Create a route through the live page and watch Traefik pick it up.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it.

    python3 tools/live-create-check.py [page-url] [traefik-api-url]

It creates one throwaway route through the page the client uses, waits for
the router to appear in the running Traefik, removes the route through the
page again, and waits for the router to go. The live system is left exactly
as it was found.
"""

import json
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

PAGE = sys.argv[1] if len(sys.argv) > 1 else "https://index.home.malarstrom.com/"
TRAEFIK = sys.argv[2] if len(sys.argv) > 2 else "https://traefik.home.malarstrom.com/api/http/routers"

PROJECT = "probe"
BRANCH = "live-check"
PORT = "4599"
FQDN = f"{BRANCH}.{PROJECT}.home.malarstrom.com"

problems = []
notes = []


def check(condition, message):
    if condition:
        notes.append("ok   " + message)
    else:
        problems.append("FAIL " + message)
        notes.append("FAIL " + message)


def routers():
    with urllib.request.urlopen(TRAEFIK, timeout=10) as response:
        return json.loads(response.read().decode())


def has_router():
    """Is there a router for the route? The API answers with a list."""
    try:
        return FQDN in json.dumps(routers())
    except Exception:
        return False


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    page.goto(PAGE, wait_until="networkidle")
    page.evaluate("document.fonts.ready")

    before = json.dumps(routers())
    check("orkr" in before, "the live Traefik is serving the existing routes")

    # --- create it through the page -----------------------------------------
    page.click("#new-route-toggle")
    page.fill("#new-route-project", PROJECT)
    page.fill("#new-route-branch", BRANCH)
    page.fill("#new-route-port", PORT)
    page.click("#new-route-form button[type=submit]")
    page.wait_for_selector(f'tr[data-registration-id="probe/live-check"]', timeout=20000)
    check(True, "the route was created through the page")

    # --- Traefik picks it up --------------------------------------------------
    deadline = time.time() + 30
    while time.time() < deadline and not has_router():
        time.sleep(1)
    check(has_router(), f"the router for {FQDN} is live in Traefik")

    # --- remove it through the page -----------------------------------------
    page.locator('tr[data-registration-id="probe/live-check"] button.remove').click()
    page.wait_for_selector(".route-band .confirm-yes", timeout=10000)
    page.locator(".route-band .confirm-yes").click()
    page.wait_for_selector('tr[data-registration-id="probe/live-check"]', state="detached", timeout=20000)
    check(True, "the route was removed through the page")

    deadline = time.time() + 30
    while time.time() < deadline and has_router():
        time.sleep(1)
    check(not has_router(), "the router is gone from Traefik")

    after = json.dumps(routers())
    check("orkr" in after, "the orkr route survived untouched")
    check("probe/live-check" not in after, "nothing of the throwaway route is left")
    browser.close()

print("\n".join(notes))
if problems:
    print("\nPROBLEMS:")
    print("\n".join(problems))
    sys.exit(1)
print("\nthe live check passed")

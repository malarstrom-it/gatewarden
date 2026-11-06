#!/usr/bin/env python3
"""Prove the behaviours the critique asked for, on a running page.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it.

    python3 tools/fixed-behaviour-check.py <url> <out-dir>

It drives the page the way a person would, and it fakes one thing only: the
gateway answers with one route more than it really has, so the page sees a
route appear while the user has a confirmation open. Nothing is registered,
nothing is removed, and the gateway's own state is never touched.

It checks the five things the critique found:

  1. a pending removal confirmation survives a background refresh, and the
     focus stays on the button the user was on;
  2. the message about a route is on screen, not above the fold, on a phone;
  3. Escape closes the confirmation, leaves the route alone and returns the
     focus to the Remove button;
  4. a state change is announced once, in a live region;
  5. the age of a route is visible on a phone.
"""

import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:45099/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "artifacts/screenshots/fixed")
OUT.mkdir(parents=True, exist_ok=True)

FAKE_ID = "probe/second"
FAKE_BRANCH = "second"

problems = []
notes = []


def check(condition, message):
    if condition:
        notes.append("ok   " + message)
    else:
        problems.append("FAIL " + message)
        notes.append("FAIL " + message)


def fake_registration(state="down"):
    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    return {
        "id": FAKE_ID,
        "project": "probe",
        "branch": FAKE_BRANCH,
        "projectSlug": "probe",
        "branchSlug": FAKE_BRANCH,
        "fqdn": f"{FAKE_BRANCH}.probe.example.com",
        "devPort": 5203,
        "createdAt": now,
        "updatedAt": now,
        "state": state,
    }


def with_fake_route(page, state="down"):
    """Answer the gateway's own endpoints with one route more than it has."""

    def registrations(route):
        response = route.fetch()
        body = response.json()
        body["registrations"].append(fake_registration(state))
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    def routes(route):
        response = route.fetch()
        html = response.text()
        row = re.search(r"<tr class=\"route-body.*?</tr>", html, re.S)
        if row:
            clone = re.sub(r'data-registration-id="[^"]*"', f'data-registration-id="{FAKE_ID}"', row.group(0), count=1)
            clone = re.sub(r'data-state="[^"]*"', f'data-state="{state}"', clone, count=1)
            html = html.replace(row.group(0), row.group(0) + "\n" + clone, 1)
        route.fulfill(status=200, content_type="text/html; charset=utf-8", body=html)

    page.route("**/api/registrations", registrations)
    page.route("**/api/routes", routes)


def focus_is(page, selector):
    return page.evaluate(
        "(selector) => { const a = document.activeElement;"
        " if (!a) return false;"
        " return a === document.querySelector(selector) || a.matches(selector); }",
        selector,
    )


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])

    context = browser.new_context(viewport={"width": 1440, "height": 900})
    context.grant_permissions(["clipboard-write", "clipboard-read"])
    page = context.new_page()
    page.goto(URL, wait_until="networkidle")
    page.evaluate("document.fonts.ready")
    with_fake_route(page)

    # --- 1. a confirmation survives a refresh ------------------------------
    row = "tr[data-registration-id]"
    page.locator(f"{row} button.remove").first.click()
    page.wait_for_selector(".route-band", timeout=5000)
    check(page.locator(".route-band").count() == 1, "the confirmation opened")

    time.sleep(6)  # more than one poll interval: the page has seen the new route

    check(page.locator(".route-band").count() == 1, "the confirmation survived the refresh")
    check(focus_is(page, ".route-band .confirm-yes"), "the focus is still on the button the user was on")
    check(
        page.locator(f'tr[data-registration-id="{FAKE_ID}"]').count() == 0,
        "the new route is held back until the band closes",
    )
    page.screenshot(path=str(OUT / "confirm-survives-refresh.png"))

    # --- 3. Escape closes it and gives the focus back ---------------------
    watched = page.locator(f"{row} button.remove").first.get_attribute("aria-label")
    before = page.locator(".route-body").count()
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check(page.locator(".route-band").count() == 0, "Escape closed the confirmation")
    check(
        page.locator(".route-body").count() >= before,
        "the routes are untouched after Escape",
    )
    check(focus_is(page, f"{row} button.remove"), "the focus went back to the Remove button")

    # The held list is applied once the band is closed.
    page.wait_for_selector(f'tr[data-registration-id="{FAKE_ID}"]', timeout=15000)
    check(True, "the held list was applied when the band closed")

    # --- 4. a state change is announced once ------------------------------
    with_fake_route(page, state="up")
    page.wait_for_function(
        "(id) => document.querySelector('[data-registration-id=\\'probe/second\\']')?.getAttribute('data-state') === 'up'",
        arg=FAKE_ID,
        timeout=20000,
    )
    page.wait_for_timeout(500)
    announced = page.locator("#announcer").inner_text()
    check("is now up" in announced, f"the live region says what changed ({announced!r})")
    check(page.locator("#announcer[aria-live='polite']").count() == 1, "the announcement lives in a polite live region")
    first = page.locator("#announcer").inner_text()
    time.sleep(5)
    check(first == page.locator("#announcer").inner_text(), "the announcement is not repeated on every poll")

    # --- 2. the message is on screen on a phone ----------------------------
    phone_context = browser.new_context(viewport={"width": 390, "height": 844})
    phone_context.grant_permissions(["clipboard-write", "clipboard-read"])
    phone = phone_context.new_page()
    phone.goto(URL, wait_until="networkidle")
    phone.evaluate("document.fonts.ready")
    phone.locator("tr[data-registration-id] button.copy").last.click()
    phone.wait_for_selector(".route-band", timeout=5000)
    band = phone.locator(".route-band").last.bounding_box()
    height = phone.evaluate("() => window.innerHeight")
    check(
        band["y"] >= 0 and band["y"] + band["height"] <= height,
        f"the band about the route is on screen on a phone (y={round(band['y'])}, viewport {height})",
    )
    message = phone.locator(".route-band__text").last.inner_text()
    check("Copied" in message, f"the band says what happened ({message!r})")
    check(phone.locator(".route-band__box[role='status']").count() >= 1, "the band is a live region of its own")
    phone.screenshot(path=str(OUT / "phone-band.png"))

    # --- 5. the age is visible on a phone ---------------------------------
    check(phone.locator(".route-age").first.is_visible(), "the age of a route is visible on a phone")
    phone.screenshot(path=str(OUT / "phone-age.png"), full_page=True)
    phone_context.close()
    context.close()
    browser.close()

print("\n".join(notes))
if problems:
    print("\nPROBLEMS:")
    print("\n".join(problems))
    sys.exit(1)
print("\nall behaviour checks passed")

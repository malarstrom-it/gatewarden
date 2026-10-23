#!/usr/bin/env python3
"""Drive the new-route panel in a real browser.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it.

    python3 tools/create-route-check.py <url> <out-dir>

It opens the panel, creates a route, and then tries to break it: a port that
is not a port, a route that already exists. It checks that Escape closes the
panel and gives the focus back, and that the panel fits a phone. The route it
creates is removed again at the end.
"""

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:45099/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "artifacts/screenshots/new-route")
OUT.mkdir(parents=True, exist_ok=True)

STAMP = str(int(time.time()))
PROJECT = "probe"
BRANCH = "made-by-hand"

problems = []
notes = []


def check(condition, message):
    if condition:
        notes.append("ok   " + message)
    else:
        problems.append("FAIL " + message)
        notes.append("FAIL " + message)


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    errors = []
    # The browser logs every response with an error status; the deliberate
    # 400 and 409 below are part of the test, not a fault of the page.
    page.on(
        "console",
        lambda m: errors.append(f"console {m.type}: {m.text}")
        if m.type == "error" and "Failed to load resource" not in m.text
        else None,
    )
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(URL, wait_until="networkidle")
    page.evaluate("document.fonts.ready")
    page.evaluate("window.__marker = 'still here'")

    toggle = page.locator("#new-route-toggle")
    panel = page.locator("#new-route")

    # --- the control reveals the panel -------------------------------------
    check(toggle.get_attribute("aria-expanded") == "false", "the control starts closed")
    check(panel.is_hidden(), "the panel starts hidden")
    toggle.click()
    page.wait_for_timeout(150)
    check(toggle.get_attribute("aria-expanded") == "true", "the control says the panel is open")
    check(panel.is_visible(), "the panel is visible")
    check(
        page.evaluate("() => document.activeElement && document.activeElement.id") == "new-route-project",
        "the focus went into the first field",
    )
    page.screenshot(path=str(OUT / "panel-open.png"))

    # --- a route is created -------------------------------------------------
    page.fill("#new-route-project", PROJECT)
    page.fill("#new-route-branch", BRANCH)
    page.fill("#new-route-port", "5173")
    page.click("#new-route-form button[type=submit]")
    page.wait_for_selector(f'tr[data-registration-id="probe/made-by-hand"]', timeout=15000)
    check(True, "the new route is in the list")
    check(
        page.evaluate("() => window.__marker") == "still here",
        "the page was not reloaded",
    )
    check(panel.is_hidden(), "the panel closed after the route was created")
    check(toggle.get_attribute("aria-expanded") == "false", "the control says the panel is closed")
    message = page.locator("#message").inner_text()
    check("Created" in message, f"the page-level line says what happened ({message!r})")
    check(
        "made-by-hand.probe.home.malarstrom.com" in message,
        f"the page-level line names the route ({message!r})",
    )
    page.screenshot(path=str(OUT / "created.png"))

    # --- the route is an ordinary route -------------------------------------
    row = 'tr[data-registration-id="probe/made-by-hand"]'
    check(page.locator(f"{row} .route-state").inner_text().strip() in ("Up", "Down"), "the new route has a state badge")
    check(page.locator(f"{row} button.remove").count() == 1, "the new route has its own remove button")

    # --- a port that is not a port -------------------------------------------
    toggle.click()
    page.wait_for_timeout(150)
    page.fill("#new-route-project", PROJECT)
    page.fill("#new-route-branch", "bad-port")
    page.fill("#new-route-port", "not-a-port")
    page.click("#new-route-form button[type=submit]")
    page.wait_for_selector("#new-route-port-error:not([hidden])", timeout=10000)
    port_error = page.locator("#new-route-port-error").inner_text()
    check("port" in port_error.lower(), f"the bad port is said in the form ({port_error!r})")
    check(panel.is_visible(), "the panel stays open when the route is refused")
    check(
        page.evaluate("() => document.activeElement && document.activeElement.id") == "new-route-port",
        "the focus went to the field that was wrong",
    )
    described = page.locator("#new-route-port").get_attribute("aria-describedby")
    check("new-route-port-error" in (described or ""), f"the field points at its error ({described!r})")
    page.screenshot(path=str(OUT / "bad-port.png"))

    # --- a route that already exists -----------------------------------------
    page.fill("#new-route-branch", BRANCH)
    page.fill("#new-route-port", "5173")
    page.click("#new-route-form button[type=submit]")
    page.wait_for_selector("#new-route-branch-error:not([hidden])", timeout=10000)
    conflict = page.locator("#new-route-branch-error").inner_text()
    check("already" in conflict.lower(), f"the conflict is said in the form ({conflict!r})")
    page.screenshot(path=str(OUT / "duplicate.png"))

    # --- Escape closes the panel ---------------------------------------------
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    check(panel.is_hidden(), "Escape closed the panel")
    check(
        page.evaluate("() => document.activeElement && document.activeElement.id") == "new-route-toggle",
        "Escape gave the focus back to the control",
    )

    # --- the route is removed again ------------------------------------------
    page.locator(f"{row} button.remove").click()
    page.wait_for_selector(".route-band .confirm-yes", timeout=5000)
    page.locator(".route-band .confirm-yes").click()
    page.wait_for_selector(f'{row}', state="detached", timeout=15000)
    check(True, "the route that was created can be removed again")

    # --- the panel on a phone --------------------------------------------------
    phone_context = browser.new_context(viewport={"width": 390, "height": 844})
    phone = phone_context.new_page()
    phone.goto(URL, wait_until="networkidle")
    phone.evaluate("document.fonts.ready")
    phone.click("#new-route-toggle")
    phone.wait_for_timeout(150)
    check(phone.locator("#new-route").is_visible(), "the panel opens on a phone")
    overflow = phone.evaluate(
        "() => ({scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth})"
    )
    check(overflow["scroll"] <= overflow["client"] + 1, f"the panel fits the phone ({overflow})")
    fields = phone.evaluate(
        "() => [...document.querySelectorAll('#new-route .field__label')].map(l => l.getBoundingClientRect().left)"
    )
    check(len(set(fields)) == 1, f"the fields stack on a phone ({fields})")
    phone.screenshot(path=str(OUT / "phone-panel.png"), full_page=True)
    phone_context.close()

    check(not errors, f"no console errors ({errors})")
    context.close()
    browser.close()

print("\n".join(notes))
if problems:
    print("\nPROBLEMS:")
    print("\n".join(problems))
    sys.exit(1)
print("\nall new-route checks passed")

#!/usr/bin/env python3
"""Check how the route band behaves: what fades and what does not.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it.

    python3 tools/fade-check.py <url> <out-dir>

It copies an address, watches the message come and go, opens a removal
confirmation and waits it out, forces a failure and waits that out too, and
then does the same copy with reduced motion emulated.
"""

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:45099/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "artifacts/screenshots/fade")
OUT.mkdir(parents=True, exist_ok=True)

DELAY_MS = 4000

problems = []
notes = []


def check(condition, message):
    if condition:
        notes.append("ok   " + message)
    else:
        problems.append("FAIL " + message)
        notes.append("FAIL " + message)


COUNT_ANNOUNCEMENTS = """
() => {
  window.__announcements = [];
  if (window.__observer) window.__observer.disconnect();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (node && node.classList && node.classList.contains('route-band__text')) {
        window.__announcements.push(node.textContent);
      }
    }
  });
  observer.observe(document.getElementById('routes'), {subtree: true, characterData: true, childList: true});
  window.__observer = observer;
}
"""

BAND_STATE = """
() => {
  const band = document.querySelector('.route-band');
  if (!band) return null;
  const box = band.querySelector('.route-band__box');
  const style = getComputedStyle(box);
  return {
    fading: band.classList.contains('route-band--fading'),
    animation: style.animationName,
    duration: style.animationDuration,
    text: band.querySelector('.route-band__text').textContent,
  };
}
"""


def watch(page, seconds=7.0, step=0.05):
    """Follow the band: when it starts fading, how, and when it is gone."""
    seen = {"fading": False, "animation": None, "duration": None, "gone": False, "text": None}
    started = time.time()
    while time.time() - started < seconds:
        state = page.evaluate(BAND_STATE)
        if state is None:
            seen["gone"] = True
            break
        if state["fading"] and not seen["fading"]:
            seen["fading"] = True
            seen["animation"] = state["animation"]
            seen["duration"] = state["duration"]
            seen["faded_after"] = round(time.time() - started, 2)
        if seen["text"] is None:
            seen["text"] = state["text"]
        time.sleep(step)
    return seen


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])

    # --- 1. an outcome message fades ---------------------------------------
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    context.grant_permissions(["clipboard-write", "clipboard-read"])
    page = context.new_page()
    page.goto(URL, wait_until="networkidle")
    page.evaluate("document.fonts.ready")
    page.evaluate(COUNT_ANNOUNCEMENTS)

    started = time.time()
    page.locator("tr[data-registration-id] button.copy").first.click()
    page.wait_for_selector(".route-band", timeout=5000)
    message = page.locator(".route-band__text").first.inner_text()
    check("Copied" in message, f"the message is in the route's band ({message!r})")

    announcements = page.evaluate("() => window.__announcements")
    check(len(announcements) == 1, f"the message is announced once ({announcements})")
    page.screenshot(path=str(OUT / "copy.png"))

    seen = watch(page)
    check(seen["fading"], "the band faded instead of vanishing")
    check(seen["animation"] == "band-fade", f"the fade is the authored moment ({seen['animation']})")
    check(seen["duration"] == "0.24s", f"the fade is 240 ms ({seen['duration']})")
    check(seen.get("faded_after", 99) >= 3.5, f"the message stayed before it faded ({seen.get('faded_after')} s)")
    check(seen["gone"], "the band is gone after the fade")

    after = page.evaluate("() => window.__announcements")
    check(len(after) == 1, f"emptying the band announces nothing again ({after})")
    check(page.locator("#message").inner_text() == "", "the page-level line stayed empty")
    page.screenshot(path=str(OUT / "after-fade.png"))

    # --- 2. the confirmation stays -----------------------------------------
    page.evaluate(COUNT_ANNOUNCEMENTS)
    page.locator("tr[data-registration-id] button.remove").first.click()
    page.wait_for_selector(".route-band", timeout=5000)
    question = page.locator(".route-band__text").first.inner_text()
    check(question.startswith("Remove"), f"the confirmation asks a question ({question!r})")
    page.wait_for_timeout(DELAY_MS + 1500)
    check(page.locator(".route-band").count() == 1, "the confirmation is still there after the fade delay")
    check(
        page.locator(".route-band__text").first.inner_text().startswith("Remove"),
        "the confirmation still asks its question",
    )
    page.screenshot(path=str(OUT / "confirm-stays.png"))
    page.keyboard.press("Escape")

    # --- 3. a failure stays -------------------------------------------------
    page.route("**/api/registrations/**", lambda route: route.fulfill(status=500, body="boom"))
    page.locator("tr[data-registration-id] button.remove").first.click()
    page.wait_for_selector(".route-band", timeout=5000)
    page.locator(".route-band .confirm-yes").click()
    page.wait_for_function(
        "() => [...document.querySelectorAll('.route-band__text')].some(n => n.textContent.includes('Could not remove'))",
        timeout=10000,
    )
    page.wait_for_timeout(DELAY_MS + 1500)
    check(page.locator(".route-band").count() == 1, "the failure message is still there after the fade delay")
    check(
        "Could not remove" in page.locator(".route-band__text").first.inner_text(),
        "the failure still says what went wrong",
    )
    page.screenshot(path=str(OUT / "failure-stays.png"))
    page.unroute("**/api/registrations/**")
    context.close()

    # --- 4. reduced motion: the message goes without a transition -----------
    reduced_context = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    reduced_context.grant_permissions(["clipboard-write", "clipboard-read"])
    reduced = reduced_context.new_page()
    reduced.goto(URL, wait_until="networkidle")
    reduced.evaluate("document.fonts.ready")

    reduced.locator("tr[data-registration-id] button.copy").first.click()
    reduced.wait_for_selector(".route-band", timeout=5000)
    reduced_seen = watch(reduced)
    check(not reduced_seen["fading"], "the message was removed without a transition")
    check(reduced_seen["gone"], "the band is gone under reduced motion")
    check(
        reduced.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--ease-curve')") != "",
        "the page keeps its easing curve",
    )
    reduced_context.close()
    browser.close()

print("\n".join(notes))
if problems:
    print("\nPROBLEMS:")
    print("\n".join(problems))
    sys.exit(1)
print("\nall fade checks passed")

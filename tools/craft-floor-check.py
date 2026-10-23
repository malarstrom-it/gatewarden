#!/usr/bin/env python3
"""Read the craft floor's mechanical checks off a rendered index page.

A review tool, not part of the gateway: it lives in tools/ and the runtime
path of the daemon never touches it. It answers the questions that need a
real render: are the figures tabular, does anything cast a shadow, do the
radii match the decision, do the text colours reach their contrast.

    python3 tools/craft-floor-check.py <url>
"""

import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://index.home.malarstrom.com/"

CONTRAST = """
({ fg, bg }) => {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (value) => value.match(/[\\d.]+/g).slice(0, 3).map(Number);
  const [l1, l2] = [lum(parse(fg)), lum(parse(bg))].sort((a, b) => b - a);
  return ((l1 + 0.05) / (l2 + 0.05)).toFixed(2);
}
"""

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(URL, wait_until="networkidle", timeout=30000)

    print("--- browser surfaces")
    print("selection:", page.evaluate("getComputedStyle(document.body, '::selection').backgroundColor"))
    print("caret:", page.evaluate("getComputedStyle(document.body).caretColor"))
    print("scrollbar:", page.evaluate("getComputedStyle(document.documentElement).scrollbarColor"))
    address = page.query_selector(".route-address")
    if address:
        print("underline offset:", page.evaluate("e => getComputedStyle(e).textUnderlineOffset", address))
    for selector in ["time", ".route-inside", ".route-age"]:
        node = page.query_selector(selector)
        if node:
            print(f"tabular figures {selector}:", page.evaluate("e => getComputedStyle(e).fontVariantNumeric", node))

    print("--- depth")
    for selector in [".route-edge", ".card", ".btn", ".badge"]:
        node = page.query_selector(selector)
        if node:
            style = page.evaluate("e => getComputedStyle(e)", node)
            print(f"{selector}: shadow={style['boxShadow']!r} radius={style['borderRadius']!r}")

    print("--- spacing (computed)")
    for selector in ["header", ".card", ".table-head th", ".table-body td", ".empty__title", ".empty__body"]:
        node = page.query_selector(selector)
        if node:
            style = page.evaluate("e => getComputedStyle(e)", node)
            print(
                f"{selector}: margin-top={style['marginTop']} margin-bottom={style['marginBottom']} "
                f"padding-top={style['paddingTop']} padding-bottom={style['paddingBottom']}"
            )

    print("--- type")
    for selector in ["h1", ".group__name", ".route-edge", ".route-address", ".route-state", ".empty__body"]:
        node = page.query_selector(selector)
        if node:
            style = page.evaluate("e => getComputedStyle(e)", node)
            print(
                f"{selector}: size={style['fontSize']} weight={style['fontWeight']} "
                f"tracking={style['letterSpacing']} measure={page.evaluate('e => e.getBoundingClientRect().width', node)}px"
            )

    print("--- contrast")

    EFFECTIVE_BG = """
    (element) => {
      let node = element;
      while (node) {
        const color = getComputedStyle(node).backgroundColor;
        if (color && !color.startsWith('rgba(0, 0, 0, 0)') && color !== 'transparent') return color;
        node = node.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    }
    """

    pairs = [
        (".head__subject", "body"),
        (".head__checked", "body"),
        (".head__count", "body"),
        (".route-age", ".card"),
        (".route-inside", ".card"),
        (".route-state", ".card"),
        (".route-address", ".card"),
        (".group__count", ".card"),
        (".group__cert", ".card"),
        ("footer", "body"),
    ]
    for fg_selector, bg_selector in pairs:
        fg = page.query_selector(fg_selector)
        bg = page.query_selector(bg_selector)
        if not fg or not bg:
            continue
        ratio = page.evaluate(
            CONTRAST,
            {
                "fg": page.evaluate("e => getComputedStyle(e).color", fg),
                "bg": page.evaluate(EFFECTIVE_BG, bg),
            },
        )
        size = page.evaluate("e => parseFloat(getComputedStyle(e).fontSize)", fg)
        weight = page.evaluate("e => getComputedStyle(e).fontWeight", fg)
        large = size >= 24 or (size >= 18.66 and int(weight) >= 700)
        need = 3.0 if large else 4.5
        print(f"{fg_selector}: {ratio}:1 (need {need})", "OK" if float(ratio) >= need else "FAIL")

    print("--- overflow")
    overflow = page.evaluate(
        """() => [...document.querySelectorAll('body *')]
              .filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible')
              .map(e => e.className + ' ' + e.scrollWidth + '>' + e.clientWidth)"""
    )
    print(overflow or "nothing overflows its box")

    print("--- third party requests")
    print(
        page.evaluate(
            "() => performance.getEntriesByType('resource').map(e => e.name)"
            ".filter(n => !n.startsWith(location.origin)).join(' | ') || 'none'"
        )
    )

    browser.close()

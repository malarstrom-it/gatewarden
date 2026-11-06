---
target: the gateway index page
total_score: 31
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
p2_count: 3
target_identity: "file:src/index-page.ts"
target_fingerprint: "sha256:325f8316499b0f431037589e9e72a2d3661c27d878da3a9f73540430c394d6af"
target_path: src/index-page.ts
timestamp: 2026-10-23T13-38-59Z
slug: src-index-page-ts
---
# Critique — the gateway index page

Target: `src/index-page.ts` (the live page at https://index.example.com/)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | The feedback line ("Copied …", "Removed …") sits at the top of the page and is off-screen when the list is long; state flips are silent for screen readers |
| 2 | Match System / Real World | 4 | Up/Down, route, endpoint, port, age, the wildcard certificate — the language of a dev tool |
| 3 | User Control and Freedom | 3 | The removal asks first and "Keep it" cancels; Escape does not |
| 4 | Consistency and Standards | 4 | One component grammar, one type scale, one spacing scale, one token set |
| 5 | Error Prevention | 3 | The removal is confirmed and the CSRF guard holds; a poll can destroy a pending confirmation |
| 6 | Recognition Rather Than Recall | 4 | Nothing is hidden: the register command is in the empty state, the icon buttons carry titles and labels |
| 7 | Flexibility and Efficiency | 2 | No shortcuts, no bulk actions, no way to see only the routes that are down |
| 8 | Aesthetic and Minimalist Design | 3 | Flat, one accent, no shadows; but the desktop table has wide empty gaps and the phone actions are stranded |
| 9 | Error Recovery | 3 | The removal failure is reported in the row it happened in, in plain language; the lost-contact message is off-screen |
| 10 | Help and Documentation | 2 | Tooltips only; the page carries no contextual help |
| **Total** | | **31/40** | **Good** |

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 3 | WCAG AA mostly met; no live region for state changes, no Escape on the confirmation, 32px touch targets |
| 2 | Performance | 4 | 79 KB, 4 requests, first paint 56 ms |
| 3 | Theming | 4 | Every colour comes from the @theme token set |
| 4 | Responsive Design | 3 | 390px works without overflow; the two actions sit alone on their own line |
| 5 | Implementation Integrity | 4 | The detector is clean; no drift |
| **Total** | | **18/20** | **Excellent** |

## Priority Issues

### [P1] A poll destroys a pending removal confirmation and drops the focus

- **Where**: `src/assets/index.js` — `refreshList()` replaces `#routes` wholesale.
- **Evidence**: with a confirmation open, one list re-render takes the confirm
  rows from 1 to 0 and the focus falls back to `BODY`. The poll re-renders
  exactly when the set of routes changes — when the user is most likely to
  be pressing "Remove".
- **Fix**: keep the pending confirmation across the re-render (remember the
  registration id and re-open the confirmation afterwards), or defer the
  re-render while a confirmation is open.

### [P1] The feedback lands off-screen

- **Where**: `src/index-page.ts` — the `#message` paragraph, above the list.
- **Evidence**: on a 390×844 viewport with a long list, the message sits at
  y = −669: the user who pressed "Copy address" sees nothing.
- **Fix**: a toast pinned to the viewport (bottom on a phone, top right on a
  wide screen), or the confirmation inline in the row.

### [P2] Escape does not dismiss the confirmation

- **Evidence**: after Escape the confirm row is still there and the focus
  stays on the destructive button.
- **Fix**: a `keydown` handler on the confirmation row that restores the
  row and returns the focus to the Remove button.

### [P2] State changes are silent for screen readers

- **Evidence**: the only live region on the page is the message line; the
  Up/Down badge and the masthead counts change without announcement.
- **Fix**: mark the counts as `aria-live="polite"` and announce the change
  ("my-app/main is no longer answering") through the message region.

### [P2] On a phone the two actions are stranded on a line of their own

- **Evidence**: the stacked route is three lines tall for two facts, and the
  age — often the reason to remove a route — is not shown at all below
  1024px.
- **Fix**: move the two icons up next to the badge, and show the age in the
  stacked layout.

### [P3] The desktop table leaves a wide gap between the branch and the endpoint

- **Fix**: cap the route column (about 18rem) so the endpoint starts closer
  to the branch name it belongs to.

### [P3] The "not answering" edge is very quiet

- **Fix**: a slightly stronger dash or a warmer grey so the dashed edge
  survives a glance.

### [P3] The icon buttons have very long accessible names

- **Evidence**: "Copy the address of feature/very-long-branch-name…" is
  verbose in a screen reader's list of buttons.
- **Fix**: "Copy address" / "Remove"; the row already carries the context.

## Positive Findings

- The detector is clean on the markup and on the rendered page (CDP scan of
  the live URL): no findings.
- Contrast is 5.01:1 or better everywhere, on a page with no shadows.
- 79 KB over four requests, first paint at 56 ms.
- Real semantics: a `<table>` with a caption and `scope`, `h1`/`h2`, a
  `header`/`main` landmark pair, `aria-live` on the message, `aria-label` on
  every icon button.
- The Up/Down badge carries the state in a shape *and* a colour, and the
  row's edge says it a second way.
- The stylesheet cannot go stale unnoticed: `test/build-css.test.ts` fails
  the suite when the committed artifact is out of date.

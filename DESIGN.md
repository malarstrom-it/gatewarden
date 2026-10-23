---
name: Traefik dev gateway
description: The index page of the dev gateway — a quiet, daylight table of what the agents are running.
colors:
  ground: "#f6f8fb"
  card: "#ffffff"
  ink: "#14181d"
  muted-ink: "#57616d"
  subtle-ink: "#636c77"
  hairline: "#e2e6ee"
  wash: "#eef1f6"
  primary: "#2a49c9"
  primary-ink: "#ffffff"
  up: "#0f7a55"
  up-wash: "#e7f4ee"
  up-edge: "#b6dfcd"
  down: "#64748b"
  danger: "#b03a2a"
  scrollbar: "#c7cfdb"
typography:
  display:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.025em"
rounded:
  sm: "6px"
  lg: "12px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  "2xl": "32px"
  "3xl": "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "#22409f"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "36px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.sm}"
    size: "32px"
  badge-up:
    backgroundColor: "{colors.up-wash}"
    textColor: "{colors.up}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  badge-down:
    backgroundColor: "transparent"
    textColor: "{colors.down}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  link:
    textColor: "{colors.primary}"
---

## Overview

**Creative North Star: "The Daylight Register".**

The gateway index is a standing screen on the client's own desk, read at a
glance while agents work. It is not a dashboard to admire and not a terminal
to type into: it is a well-lit page of type, held in one column, where the
only thing that shouts is the state of a route.

The world is the Daylight candidate of the visual round: a cool off-white
ground, one family (Hanken Grotesk) at four sizes, hairline rules, and a
single indigo accent for the things that act. Everything is composed with
Tailwind utilities over a shadcn/ui token set, and the shadcn components
(button, badge, card, table) are written out as plain classes because the
page is server rendered HTML: no framework, no runtime dependency, no
runtime build. The stylesheet is Tailwind, compiled ahead of time and
committed, and the daemon serves it as one static file.

**Key Characteristics:**

- A page, not a panel: one column, generous air, no boxes around groups.
- A table with printed column heads, not a list of cards.
- The state of a route is a badge **and** an edge: a filled badge against an
  outlined one, a solid edge against a broken one. Shape and colour both.
- Buttons are quiet: a ghost icon button for the two actions, one filled
  button in the empty state.
- The figures that change in place — the clock, the ages, the ports — sit on
  tabular figures, so the page does not twitch while it is live.

## Colors

| Role | Token | Value | Where it is used |
| --- | --- | --- | --- |
| Ground | `ground` | `#f6f8fb` | The page behind everything |
| Card | `card` | `#ffffff` | The project cards, the empty state |
| Ink | `ink` | `#14181d` | Titles, branch names, host names |
| Muted ink | `muted-ink` | `#57616d` | Subject line, meta text, ghost buttons |
| Subtle ink | `subtle-ink` | `#636c77` | The clock, the least important figures |
| Hairline | `hairline` | `#e2e6ee` | Every rule: table lines, card edges, the rule under the masthead |
| Wash | `wash` | `#eef1f6` | Hovered rows, the confirmation band, code blocks |
| Primary | `primary` | `#2a49c9` | Host names, the filled button, the focus ring |
| Answering | `up` / `up-wash` / `up-edge` | `#0f7a55` / `#e7f4ee` / `#b6dfcd` | The badge and the edge of a route that answers |
| Not answering | `down` | `#64748b` | The badge and the broken edge of a route that does not |
| Danger | `danger` | `#b03a2a` | The remove control, a failed removal |
| Scrollbar | `scrollbar` | `#c7cfdb` | The scrollbar thumb, and nothing else |

The ground is a cool off-white with a trace of blue in it, never a cream
and never a pure white; the cards are the only true white on the page. The
accent is indigo and is used for exactly two things: something that acts
(host names, the filled button) and the focus ring.

## Typography

One family: **Hanken Grotesk**, self hosted from `src/assets/fonts/` under
the SIL Open Font License. Four steps, no more:

| Role | Size | Weight | Tracking |
| --- | --- | --- | --- |
| Display (page title) | 30px | 600 | -0.025em |
| Title (project name) | 18px | 600 | -0.025em |
| Body | 16px | 400 | normal |
| Label (column heads, badges, meta) | 12px | 500 | 0.025em, uppercase in column heads |

The host name is body size and medium weight; the branch name is body size
and semibold; the port, the age and the clock are label size in muted ink
with tabular figures. The monospace face is used for the certificate badge
and the register command only — it marks data that is typed rather than
written.

## Layout

- One column, `max-width: 72rem`, centred, 24px of side padding (16px on a
  phone), 40px above and below.
- The masthead is a header row: title and subject on the left; on the
  right the counts and the clock, and under them the three facts about the
  gateway itself — the zone, the relay and the registry port. One hairline
  separates the masthead from the content. The page has no footer: the
  facts belong with the title, where the eye starts.
- The content is one card per project. The card's head carries the project
  name, the certificate badge and the route count; below it is the table.
- The table has six columns: Route, Endpoint, Port, Age, Status, Actions.
  The last column holds the two icon buttons.
- Below 768px the table stops being a table: each route becomes a stacked
  block — the branch name with its badge on the first line, the host name on
  the second, the age and the two actions on the third. The port is hidden,
  it is the one fact the client can live without on a phone.

## Elevation & Depth

**The page is flat.** There is not one shadow on it. Depth is declared once,
by the hairline: a card is a white surface with a 1px border, a row is
separated by a 1px rule, and a hovered row is the wash colour. The only
raised thing on the page is the confirmation band, and it is raised by
colour, not by a shadow.

## Shapes

- Card: 12px radius. Badge: 6px. Button: 6px. Icon button: 6px around a
  32px square.
- The rule is 1px everywhere. The state edge on a route is 2px: solid when
  the route answers, broken when it does not.
- Nothing is a pill. Nothing is a circle. The status is a rectangle. The one
  exception is the scrollbar thumb, which is the shape a scrollbar has
  everywhere on the web.

## Components

**Button** — `.btn` with the variants `.btn-primary`, `.btn-outline`,
`.btn-ghost` and `.btn-icon`. 36px tall, 8px radius, 14px text. Ghost
buttons have no background until they are hovered; the icon buttons carry a
drawn icon (copy, bin) and an `aria-label`, never a word.

**Badge** — `.badge` with `.badge-up` (filled, emerald) and `.badge-down`
(outlined, slate). The badge of a route follows the row's `data-state`, so a
route that changes state changes its badge with it.

**Card** — `.card`: white, 1px hairline, 12px radius, no shadow.

**Table** — `.table` with `.table-head` and `.table-body`. The head is
12px uppercase muted ink; rows are separated by hairlines and tint to the
wash on hover.

**Link** — `.link`: indigo, underlined on hover, with a 4px underline
offset. Host names are links; the host name of a route that does not answer
is muted, because it is not going to open.

**The route edge** — a 2px left border on the first cell of a route: solid
`up` when the route answers, dashed `down` when it does not.

**The band** — `.route-band`, a row under a route that carries everything
said about that route: the confirmation, a failed removal, "Copied …". It
continues the row's edge, so it reads as part of the row it belongs to, and
its box is a `role="status"` live region. While a band is open the page
does not rebuild itself under the user's hands: a background refresh is
held until the band closes.

## Do's and Don'ts

**Do** keep the state legible by more than colour: the badge says the word,
the edge says the shape, and both change together.

**Do** say things about a route in that route's own band. A message at the
top of the page is a message the user cannot see.

**Do** keep the numbers that change in place on tabular figures.

**Do** keep the page free of shadows. If something needs to float, it is
missing a border.

**Don't** put a word where an icon belongs, or an icon where a word
belongs. The two actions in a row are icons with names for the screen
reader; the empty state's one action is a word, because it is the only
thing to do there.

**Don't** add a second accent colour. Indigo acts, emerald answers, slate
does not, red destroys. Nothing else gets a colour.

**Don't** let a utility class reach the page without compiling the
stylesheet: `npm run build:css` after every change to the markup. The test
`test/build-css.test.ts` fails the suite when the committed stylesheet is
stale, so a forgotten build is caught before it reaches the page.

**Don't** ask a CDN for anything. The font is self hosted; a request to a
third party would leak every visit on this private network.

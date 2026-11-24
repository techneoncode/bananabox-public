---
name: Bananabox
description: Epitech projects, grader and coding style inside VS Code. The theme's ground, two tinted layers, one banana glint for "now", and a pocket phone app in the sidebar.
colors:
  banana-glint: "#ffd84d"
  banana-glint-deep: "#ffae2e"
  banana-glint-light: "#d9a300"
  banana-glint-light-deep: "#e08a00"
  banana-ink-light: "#7a5a00"
  banana-on: "#1e1e1e"
  hc-accent: "#f38518"
  hc-light-accent: "#b5200d"
  pass: "#73c991"
  fail: "#f48771"
  warn: "#e0a458"
  style-fatal: "#f28b82"
  style-major: "#e0a458"
  style-minor: "#80c7d9"
  style-info: "#b5a2e0"
  link: "#3794ff"
  focus: "#007fd4"
  button-primary: "#0e639c"
  button-primary-fg: "#ffffff"
  ink: "#cccccc"
  ground: "#1e1e1e"
typography:
  display:
    fontFamily: "Bananabox Display (Archivo variable), VS Code UI font, system-ui, sans-serif"
    fontSize: "1.9em"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 92"
    fontFeature: "'tnum'"
  numeral:
    fontFamily: "Bananabox Display (Archivo variable), VS Code UI font, system-ui, sans-serif"
    fontSize: "2em"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 75"
    fontFeature: "'tnum'"
  app-title:
    fontFamily: "Bananabox Display (Archivo variable), VS Code UI font, system-ui, sans-serif"
    fontSize: "1.6em"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Bananabox Display (Archivo variable), VS Code UI font, system-ui, sans-serif"
    fontSize: "1.385em"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Bananabox Display (Archivo variable), VS Code UI font, system-ui, sans-serif"
    fontSize: "1.12em"
    fontWeight: 650
    lineHeight: 1.2
  body:
    fontFamily: "var(--vscode-font-family), system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "var(--vscode-font-family), system-ui, sans-serif"
    fontSize: "0.885em"
    fontWeight: 400
  group-label:
    fontFamily: "var(--vscode-font-family), system-ui, sans-serif"
    fontSize: "0.885em"
    fontWeight: 600
  mono:
    fontFamily: "var(--vscode-editor-font-family), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.885em"
    fontFeature: "'tnum', 'liga' 0"
rounded:
  hairline: "1px"
  xs: "2px"
  sm: "3px"
  md: "4px"
  soft: "6px"
  lg: "8px"
  control: "10px"
  card: "12px"
  sheet: "16px"
  pill: "999px"
  full: "50%"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  row: "10px"
  lg: "12px"
  xl: "16px"
  group: "20px"
  section: "24px"
  gutter: "30px"
  panel-x: "32px"
components:
  button-primary:
    backgroundColor: "{colors.button-primary}"
    textColor: "{colors.button-primary-fg}"
    rounded: "{rounded.md}"
    padding: "2px 11px"
    height: "26px"
  button-secondary:
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "2px 11px"
    height: "26px"
  button-small:
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "22px"
  icon-button:
    rounded: "{rounded.md}"
    width: "26px"
    height: "26px"
  app-button-primary:
    backgroundColor: "{colors.button-primary}"
    textColor: "{colors.button-primary-fg}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
    width: "100%"
  app-button-secondary:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
    width: "100%"
  app-icon-action:
    rounded: "{rounded.full}"
    width: "44px"
    height: "44px"
  round-action:
    rounded: "{rounded.full}"
    width: "44px"
    height: "44px"
  chip:
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
    height: "18px"
  chip-accent:
    textColor: "{colors.banana-glint}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
    height: "18px"
  input:
    rounded: "{rounded.md}"
    padding: "2px 8px"
    height: "26px"
  app-search:
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  segmented-large:
    rounded: "{rounded.control}"
    padding: "3px"
  segmented-large-option:
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "34px"
  tab-bar:
    height: "56px"
  tab-rail:
    width: "84px"
  list-group:
    rounded: "{rounded.card}"
  list-row:
    padding: "8px 12px"
    height: "48px"
  list-row-icon:
    rounded: "{rounded.lg}"
    width: "30px"
    height: "30px"
  project-card:
    rounded: "{rounded.card}"
    padding: "14px"
  project-card-current:
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "18px"
  bottom-sheet:
    rounded: "{rounded.sheet}"
    padding: "6px 0 0"
  stat-tile:
    rounded: "{rounded.card}"
    padding: "12px"
  gutter-row:
    rounded: "{rounded.sm}"
    padding: "0 8px 0 0"
    height: "30px"
  panel:
    rounded: "{rounded.lg}"
    padding: "12px 14px"
  gauge-value:
    typography: "{typography.display}"
---

# Design System: Bananabox

## Overview

**Creative North Star: "The Lens Gutter"**

Bananabox lives inside someone else's room. The VS Code theme owns the ground, the text colour, the buttons, the inputs, the focus ring and the hover, and Bananabox never repaints them. Depth comes from two faint tinted layers of the theme's own foreground. One warm yellow, the Banana Glint, marks the one thing that is "now": the current project, the open tab, deadline progress, tokens left, the score line. Data is drawn, not described: deadlines are rails, tokens are pills, scores are rings and sparklines, coding-style findings are stacked bars in the severity colours. Numbers are set in the Archivo display face with tabular figures, so they read like an instrument.

The system has two scales on one set of tokens. Editor panels keep the editor's density: 13px body, 26px controls, 30px rows hung off a mono gutter like line numbers beside code. The sidebar is a pocket phone app: a bottom tab bar (a left rail when the sidebar is 600px or wider), a board of big project cards in swipeable status columns, a bottom sheet with the three actions that matter, pushed full screens built from grouped 48px rows, and 44px targets everywhere. Same ground, same layers, same glint, same numerals; only the touch scale changes.

The feel is friendly and tactile, not sterile. Buttons press down 1px, rows and segments answer the pointer within 140ms, raised tiles carry a top highlight edge and a soft drop, and sheets rise from the bottom on the shared ease. All of it stays inside native VS Code conventions. High-contrast themes drop every tint, shadow and gradient in favour of contrast borders, and reduced motion removes every animation.

**Key Characteristics:**
- Theme-native: every neutral, control and state colour resolves through `--vscode-*` variables, and the hex values here are only fallbacks.
- One accent, the Banana Glint, only for "current" and "progress".
- Data drawn as rails, pills, rings, sparklines and stacked bars, with condensed Archivo numerals.
- Two scales: editor density in panels (26px controls, 30px gutter rows), phone grammar in the sidebar (44px targets, 48px rows, 12px cards, 16px sheet).
- Tactile micro-motion with one shared ease, fully removed under reduced motion.
- Students can override the palette (`applyPalette`, `bb-palette`), so the system must hold with any accent.

## Colors

The theme provides the neutrals and the controls. Bananabox adds one warm accent and a fixed vocabulary of state colours.

### Primary
- **Banana Glint** (`banana-glint`, gradient to `banana-glint-deep`): the "now" marker. It fills deadline rails and remaining tokens, marks the open tab in the tab bar (a 3px indicator, never the label), outlines the current project card, tints the current card's wash, draws rings and sparklines, and colours running marks. In dark themes text uses the same yellow. Light themes deepen it to `banana-glint-light` / `banana-glint-light-deep` for fills and `banana-ink-light` for text and icons. Washes are the glint at 8% (11% on light) over the ground.
- **Banana On** (`banana-on`): text on a solid glint fill (`#ffffff` on light themes).

### Secondary
- **High-contrast accent** (`hc-accent`, `hc-light-accent`): replaces the glint in high-contrast themes, taken from `--vscode-contrastActiveBorder` when the theme defines one.

### Tertiary
- **State colours** (`pass`, `fail`, `warn`): grader and check outcomes, urgency on deadlines and rails. They map to `--vscode-testing-iconPassed`, `--vscode-errorForeground` and `--vscode-editorWarning-foreground`. Light themes darken them (pass `#388a34`, fail `#a1260d`, warn mixed 28% toward black). An urgent deadline turns its rail fill and its time fail-coloured.
- **Coding-style severities** (`style-fatal`, `style-major`, `style-minor`, `style-info`): epiclang findings in inline diagnostics, chips, marks and stacked bars, mapped to the `bananalens.inline.*` theme colours so they match the editor decorations. Light: `#b3261e`, `#805700`, `#006779`, `#6941a5`.

### Neutral
- **Ink** (`ink`): `--vscode-foreground`. Secondary text is `--vscode-descriptionForeground` (or ink at 72%), tertiary is ink at 58% (64% on light).
- **Ground** (`ground`): `--vscode-editor-background` in panels, `--vscode-sideBar-background` in the sidebar, the tab bar and the sheet.
- **Layers**: Layer 1 is ink at 3.5% (cards, list groups, stat tiles, raised panels). Layer 2 is ink at 6.5% (segmented tracks, search fields, rail tracks). Raise is 4% and Raise 2 is 7%, for chips, row icon tiles, round actions' fallback and the sheet's close button.
- **Lines**: Line is `--vscode-widget-border` or ink at 18%. Line Soft is ink at 9%, used for hairlines, card outlines, row dividers, the tab bar's top edge and the two-pane divider.
- **Link / Focus** (`link`, `focus`): `--vscode-textLink-foreground` and `--vscode-focusBorder`, never restyled. The app's back button is set in link colour.
- **Backdrop**: black at 45% behind the bottom sheet.

### Named Rules
**The Borrowed Ground Rule.** Every neutral and control colour is a `var(--vscode-*, fallback)` or a `color-mix` of the theme foreground. A raw hex outside the accent and state fallbacks is a bug.

**The One Glint Rule.** The Banana Glint marks current state and progress only: the open tab, the current card, rails, tokens, rings. It never decorates headings, labels or empty space, and a screen shows it in a handful of places at most.

**The Tint Not Paint Rule.** State surfaces are the state colour at 10-14% over the ground, with the solid colour reserved for text, icons and marks. Row icon tiles follow it: the state colour at 14% behind a solid icon.

## Typography

**Display Font:** Bananabox Display (Archivo variable, weight 100-900, width 62-125%, bundled with the webview), falling back to the VS Code UI font.
**Body Font:** the VS Code UI font (`--vscode-font-family`) at the user's `--vscode-font-size`.
**Label/Mono Font:** the editor font (`--vscode-editor-font-family`) for gutters, side values, SHAs, axes and function names.

**Character:** a firm grotesque for headings and numbers sits on the editor's own UI and code fonts. Squeezed to 75% width it becomes the app's signature numerals; at 92% it is the panel readout. Bananabox gets a voice of its own without looking foreign in the editor.

### Hierarchy
- **Display** (700, 1.9em, 1.15, -0.02em, width 92%): panel readout gauge values such as days left, tokens and score.
- **Numeral** (700, 2em, 1, -0.03em, width 75%, tabular): the sidebar app's numbers. Stat tiles use 2em; deadline times 1.3em; scores in rows 1.1em; board deadlines and counts at their surrounding size. A unit beside it drops to 0.45em at 600 in secondary ink.
- **App title** (700, 1.6em, 1.15, -0.02em): the large title at the top of each tab root (Projects, Home). A project screen's name is 1.7em; the current card's name 1.4em; the sheet's name 1.35em.
- **Headline** (650, 1.385em, 1.2, -0.015em): panel page titles (`h1`).
- **Title** (650, 1.12em, 1.2): card names and section titles; the pushed-screen app bar title is 1.05-1.15em.
- **Body** (400, 13px, 1.5): everything else. Sizes are in `em`, so the whole UI scales with the user's VS Code font size. List row labels are 500.
- **Label** (400, 0.885em): meta lines, units, details, chips, deadline captions, in secondary ink.
- **Group label** (600, 0.885em, UI font, secondary ink): the title above a grouped list or a Home section. Sentence case.
- **Mono** (0.885em in side columns, 0.8em in the gutter): tabular figures with ligatures off.

### Named Rules
**The Tabular Rule.** Every number that can change, such as counts, times, scores and SHAs, is set with `tabular-nums` so columns never jitter.

**The Condensed Numeral Rule.** In the sidebar app, a number that is the point of its element (score, deadline, tokens, count) is Archivo at 700 and 75% width. Words never take the 75% width.

**The Em Rule.** Type sizes are `em` multiples of the user's VS Code font size and are never fixed px. Chart and calendar axes at 10px are the only exception.

## Layout

**Panels** keep a single-column flow at editor density. Panels centre at a maximum of 1140px with 20px/32px padding and 64px at the bottom. Sections are separated by 24px of space, not boxes; inside sections the rhythm is 10px, and rows are 30px on a three-column grid: the 30px gutter, flexible content, and an auto-width mono side column. The grader tab is a two-column loop: pipeline on the left (280-340px), report on the right, a 28px gap and a hairline between.

**The sidebar app** is a column with a scroller over a fixed 56px bottom tab bar (Home, Projects, Agenda, Me; 20px icons over a label). Screens pad 16px at the sides. Tab roots open with a 44px action row and the large app title; pushed screens open with a back button, a title and 44px actions. Grouped lists stack with 6px between label and group and 20px between groups. The Projects board is a segmented switch over a horizontal strip of full-width status columns, scroll-snapped one column at a time; cards in a column sit 10px apart. A pushed project screen ends with a sticky action bar (two big buttons side by side, a status line above) pinned to the bottom of the scroller.

At 600px of sidebar width or more the tab bar becomes an 84px left rail (64px items, the glint indicator moves to the left edge), and Projects and Home split into two panes: the list at `minmax(260px, 2fr)` and the open project at `3fr`, divided by a soft hairline, each pane scrolling on its own. The sheet becomes a centred 480px card with all corners rounded. Below 240px tab labels hide and only icons remain.

Responsive behaviour uses container queries, not viewport media queries, because the same markup runs in a narrow sidebar and in a wide editor panel: `page` and `admin` containers in panels (900, 720, 640, 560, 420, 340px), and the `app` container in the sidebar (600px two panes, 240px icon-only tabs).

### Named Rules
**The Space Not Boxes Rule.** In panels a section is a title plus space. Raise a container only when it is a tile, panel or card with data inside, never to group prose.

**The Thumb Reach Rule.** In the sidebar app every pointer target is at least 44px tall, list rows are at least 48px, and long French strings wrap or ellipsize inside the row rather than shrinking the target.

## Elevation & Depth

The system is hybrid: flat at the edges, raised in the middle. Rows, tabs, sections and notices are flat, tinted at most. Panels, readout tiles and project cards are raised on Layer 1 with a soft inner hairline and the two-part drop; list groups and stat tiles sit on Layer 1 with only the hairline. Two things float: the bottom sheet, which casts upward over a 45% black backdrop, and the project screen's sticky action bar, which casts a short upward shadow onto the content scrolling under it. Menus and tooltips use a single stronger ambient shadow, as VS Code's own widgets do. In high-contrast themes every layer, edge and shadow resolves to transparent or none, and a contrast-border hairline is the only depth.

### Shadow Vocabulary
- **Raised** (`box-shadow: inset 0 0 0 1px <line-soft>, inset 0 1px 0 <edge>, 0 1px 2px rgba(0,0,0,0.18), 0 8px 24px -12px rgba(0,0,0,0.45)`): panels and gauge tiles. Project cards use the hairline plus the drop without the edge. In light themes the drop is `0 1px 2px rgba(0,0,0,0.06), 0 8px 24px -14px rgba(0,0,0,0.22)`.
- **Pressable** (`box-shadow: 0 1px 0 rgba(255,255,255,0.08) inset, 0 1px 2px rgba(0,0,0,0.25)`): primary buttons, at both scales.
- **Selected segment** (`box-shadow: 0 1px 2px rgba(0,0,0,0.18)`): the active option in a segmented control, lifted onto the ground colour.
- **Sheet** (`box-shadow: 0 -8px 30px rgba(0,0,0,0.35), inset 0 1px 0 <edge>`): the bottom sheet.
- **Sticky bar** (`box-shadow: 0 -1px 0 <line-soft>, 0 -10px 24px -14px rgba(0,0,0,0.55)`): the project screen's action bar.
- **Overlay** (`box-shadow: 0 6px 20px rgba(0,0,0,0.28)`): overflow menus. Chart tooltips use `0 4px 14px rgba(0,0,0,0.25)`.

### Named Rules
**The Contrast Collapse Rule.** In high-contrast themes depth turns into borders: cards, groups, stat tiles and rails become a 1px contrast outline, the current card a 2px accent outline, the sheet and sticky bar a top border. A shadow, gradient or tint that survives in high contrast is a bug.

## Shapes

Corners are gently rounded and grow with the element, in two families. Editor scale: panels and tiles 8px, buttons, inputs, menus and notices 4px, chips, gutter rows and function pills 3px, marks and small rails 2px, token pills and hairline ticks 1px. Phone scale: the bottom sheet 16px (top corners only when docked), cards, list groups and stat tiles 12px, big buttons, the search field and the segmented track 10px, segmented options and row icon tiles 8px, skeleton bars and scrollbar thumbs 6px. Thin meters, dots and swatches are full pills (999px); avatars, icon actions, round actions and the sheet's close button are circles (50%). Nested shapes subtract their padding: the segmented track is 10px around 8px options with 3px padding. Lines are inset 1px shadows rather than borders, so they never shift layout. Recurring silhouettes: the 3px status mark in the gutter, the 6px rail (8px on the current card and the project screen), the 36px x 4px sheet grabber, and the glint indicator, 3px thick with its outer corners rounded.

## Components

### Buttons
Friendly and tactile: they look native and press when clicked.
- **Shape:** editor buttons are gently rounded (4px), 26px tall, 2px 11px padding, with a 14px icon. App buttons ("big buttons") are 44px tall, full width, 10px radius, weight 600, 0 16px padding, with a 16px icon 8px from the label.
- **Primary:** the theme's button background and foreground with the pressable shadow. One per sheet or screen: "Run the grader".
- **Secondary:** the theme's secondary button colours, falling back to Raise 2 and ink.
- **Ghost / Danger:** ghost is transparent until hovered; danger is fail-coloured text with a 12% fail tint on hover.
- **Hover / Active:** background eases in 140ms on the shared ease; active translates 1px down; disabled sits at 50% opacity.
- **Icon actions:** 26px squares at 4px in panels; 44px circles with an 18px icon in the app, secondary ink until hovered, 40% opacity when disabled.
- **Round actions:** in the sheet, a row of three 44px circles on the secondary button colour with an 18px icon and a label-size caption below.

### Chips
- **Style:** 18px tall, 3px radius, label size, tabular figures, on Raise 2 in secondary ink. One shape serves status, labels and counts. In the app they wrap onto two lines rather than clip.
- **State:** state chips tint at 13% of their colour. The accent chip uses the banana wash with banana ink ("Open here"). A quiet chip drops the background.

### Cards / Containers
- **Project card:** the whole card is one button. 12px radius, Layer 1, the soft hairline and the drop, 14px padding, 10px internal gap: name (title, ellipsized) and unit, chips, deadline rail with its time, then a foot of numeral stats and avatars. Hover takes the theme hover colour.
- **Current card:** 18px padding, the banana wash over Layer 1, a 1.5px glint outline, a 48px score ring at the top right, the name at 1.4em and wrapping, an 8px rail.
- **Stat tile:** 12px radius, Layer 1, hairline, 12px padding, a label then a numeral, with a 36px sparkline or token row below.
- **Panel / readout tile:** 8px, Layer 1, the Raised recipe, 12px 14px padding.

### Inputs / Fields
- **Style:** editor fields use the theme's input background, foreground and border, 4px radius, 26px tall, 2px 8px padding; the panel search bar is 28px with a leading icon. The app search field is 44px, 10px radius, on Layer 2 with no border, revealed by the app bar's search action.
- **Focus:** a 1px `--vscode-focusBorder` outline inset by 1px (an inset 1px focus hairline on the app search). Cards and other focusables use the focus colour as an outline on `:focus-visible` only (2px at 2px offset in the app, 1px in panels).
- **Error:** fail-coloured helper text below the field.

### Navigation
- **Bottom tab bar:** 56px, on the sidebar ground, a soft hairline on top. Four equal items, each a 20px icon over an ellipsized label, secondary ink, ink when open. The open tab gets a 3px glint indicator across the middle 44% of its top edge. Wide sidebars turn it into the 84px left rail with the indicator on the left edge.
- **App bar:** a 44px row. Tab roots: actions at the right, the large app title below. Pushed screens: a link-coloured back button with an 18px chevron and the parent's name, the title, and 44px actions.
- **Large segmented switch:** a Layer 2 track, 10px radius, 3px padding; options 34px tall, 8px radius, weight 500, with a tabular count in secondary ink. The open option lifts onto the ground with the selected-segment shadow. On the board the three options share the width at label size.
- **Editor tabs and segmented filter:** 34px tabs 20px apart with a 2px glint underline when active; 22px segmented options on a Layer 2 track with 2px padding.
- **Motion:** pushed screens slide in from the right (340ms) and pop from the left, through the View Transitions API when present; a tab swap cross-fades. Two panes never animate between each other.

### Grouped List (signature, sidebar)
The spine of every app screen. A group label above a 12px-radius group on Layer 1 with a soft hairline, its rows divided by inset hairlines. Each row is at least 48px, 8px 12px padding, 12px gaps: a 30px icon tile (8px radius, Raise 2, or the state colour at 14% with a solid 16px icon), a label at 500 with an optional label-size detail, a right-aligned tabular meta (at most 45% of the row) and a 16px chevron in tertiary ink when it opens something.

### Board (signature, sidebar)
The Projects tab. The large segmented switch picks a status column (In progress, Upcoming, Done) and the strip below swipes sideways between them, one full-width column per status, snapping and stopping on each. Columns hold project cards, the current one first. While loading, cards hold 6px-radius skeleton bars shimmering at 1.4s.

### Bottom Sheet (signature, sidebar)
Opened by tapping a card. It rises 260ms on the shared ease over a backdrop fading in 220ms. 16px top corners, the sidebar ground, the Sheet shadow, a 36px x 4px grabber, a 32px round close button at top right. Inside, 16px apart: the project name and status line, three key numbers in a row above a hairline, the primary big button, the three round actions, a grouped list of section shortcuts, and a secondary big button to open the full project. It stops above the tab bar.

### Gutter Row (signature, panels)
The spine of every panel list. A 30px mono gutter holding the status mark (3px x 14-16px, 1-2px radius, coloured by state; a running mark pulses the glint at 1.4s) and small mono counts with a soft hairline on its right, then the content, then a mono side column. Rows are 30px tall (44px when reused inside the app's project pages) and turn hover-coloured when clickable. The focused row takes the banana wash and a 2px glint gutter line.

### Icons
Codicons only, sized by role: 12px inline with status and warning text, 14px in editor buttons and sheet status lines, 16px in big buttons, row icon tiles and chevrons, 18px in app bar actions, the back button and round actions, 20px in the tab bar, 22-28px only for empty and all-clear states.

## Do's and Don'ts

### Do:
- **Do** resolve every neutral and control colour through `var(--vscode-*, fallback)`, and tint with `color-mix(in srgb, var(--fg) N%, transparent)`.
- **Do** reserve the Banana Glint (#ffd84d to #ffae2e) for the current item and for progress: the open tab's indicator, the current card's outline and wash, rails, tokens, rings and chart lines.
- **Do** draw data (rails, pills, sparklines, rings, stacked bars) instead of writing it out as sentences, and set its numbers in condensed Archivo with tabular figures.
- **Do** give every sidebar target at least 44px and every app list row at least 48px; use 12px cards and groups, a 16px sheet, 10px big buttons and 16px screen gutters.
- **Do** build app screens from grouped lists and big buttons, and keep panel lists on the 30px gutter row.
- **Do** size type in `em` from the user's VS Code font size, and use the Archivo display face for titles and numbers only.
- **Do** give pointer feedback within 140ms using `cubic-bezier(0.16, 1, 0.3, 1)` with a 1px press on buttons, and remove all motion (sheet rise, push and pop, shimmer) under `prefers-reduced-motion`.
- **Do** check every surface in dark, light, high-contrast and high-contrast light themes, with a student palette override, and in the sidebar at 260px, 300px and 600px or wider.
- **Do** use container queries, not viewport media queries, because the same views run in the sidebar and in a full panel.
### Don't:
- **Don't** repaint the theme's ground, buttons, inputs, focus ring or links.
- **Don't** let a shadow, gradient or tint survive in high-contrast themes; use contrast borders instead.
- **Don't** use Epitech logos, colours or anything that makes Bananabox look official.
- **Don't** use the glint for decoration, headings, labels or any border other than the current card, or spread it across more than a handful of elements per screen.
- **Don't** wrap prose sections in boxes; separate them with space. Raise only cards, groups, tiles and panels that hold data.
- **Don't** set fixed px font sizes or fixed widths that clip longer French strings; let labels wrap or ellipsize.
- **Don't** animate on re-render. A route entrance or a sheet rise plays once.

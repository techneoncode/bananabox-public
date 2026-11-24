---
version: 1
slug: "src-webview-main-ts"
primary_target: "src/webview/main.ts"
related_targets: ["src/webview/styles.css"]
---

# Sidebar app (bananabox.sidebar webview)

Scope: the VS Code sidebar webview (`src/webview`, surface `sidebar`), rebuilt as a phone app. Mode: Operate.
Audience: early-year Epitech students, mid-project, often near a deadline. Job: see where every project stands, open one, act in one tap (run grader, check, subject, book slot).
Constraints: theme-native colours (`--vscode-*`), EN/FR parity, high-contrast collapse, keyboard + screen reader parity, privacy promise, no Epitech branding. Existing renderers (grader, subject, valgrind, history, activities, prepare, calendar, appearance) are reused as screen bodies.
Confirmed with user: Board of cards structure; bottom tab bar Home / Projects / Agenda / Me that absorbs the separate Calendar view; two panes when the sidebar is wide (left rail + list | screen).

## Direction contract

THESIS: The sidebar is a pocket app, not a compressed panel. Projects are big touchable cards on a swipeable board; one tap opens a sheet with the actions that matter, a second opens the full project. It refuses the dense dashboard-in-a-strip with features scattered everywhere.

OWN-WORLD: Lens Gutter world kept: theme ground, two tinted layers, one Banana Glint for "now" and progress, Archivo display numerals, drawn data (rails, pills, rings). Phone grammar on top: 44px rows, 12px-radius cards, bottom sheet with grabber, bottom tab bar with glint indicator, large tap targets, generous 16px gutters.

STORY: The student opens the sidebar, sees Home (what needs them now), switches to Projects to scan every project as a card, taps one to see status and act in one tap, opens it to drill into Grader, Subject, Activities, Agenda through big rows, and always gets back with one back arrow or a tab tap.

FIRST VIEWPORT: Projects tab at 300px: top bar with title and search icon; segmented column switcher (In progress 4 / Upcoming / Done) over a horizontally swipeable, scroll-snapped column; first card = current project, large (name, unit, score ring, deadline rail, glint border), then the next cards; bottom tab bar fixed, 56px, Home / Projects / Agenda / Me. Primary action: tapping a card opens its bottom sheet with "Run the grader" as the primary button.

FORM: Board of cards, position 4 on my list of six; seed:bbde41cb46644444 dealt 5, 4, 2; user chose dealt card 4 over the lead.
Signature interaction: card tap -> bottom sheet slides up (grabber, status, 3 one-tap actions, section shortcuts) -> "Open" expands to a full pushed screen. Motion grammar: sheet rise 260ms on the shared ease, push/pop slide, all removed under reduced motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

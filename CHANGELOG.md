# Changelog

All notable changes to Bananabox are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.1.0] - 2026-11-25

### Added
- CLion plugin: the shared extension code now runs as a CLion 2026.3 plugin. Download the plugin ZIP from the release page; the remote configuration exposes it as `clion_latest`.
- What's new: when an update is required, the update screen lists the changes between your version and the required one, so you see them before the update installs. GitHub release notes are taken from this file.

### Changed
- Packaged icons are smaller and the unused banner is dropped from the VSIX.

## [2.0.2] - 2026-11-24

### Changes
- Agenda: in narrow cards, labels such as "This session is full." wrap inside the card, titles break between words, and a row with many overlapping sessions scrolls sideways.

## [2.0.1] - 2026-11-24

### Changes
- Agenda: free time between sessions now shows as space proportional to its length, labelled with its duration (for example "4h" between a 9:30-12:00 session and a 16:00 session).
- Agenda: sessions that overlap are shown side by side, each card with its own times, instead of one under the other.
- Agenda: in narrow cards, labels such as "This session is full." wrap inside the card, titles break between words, and a row with many overlapping sessions scrolls sideways.

## [2.0.0] - 2026-11-24

### Highlights
- The sidebar is now an app. A tab bar at the bottom takes you to Home, Projects, Agenda and Me, and the sidebar switches to two panes (rail + list | project) when you make it wider than 600px.
- Projects: the project open in this window sits on top; the others are cards you swipe through by In progress, Upcoming and Done, each with a deadline rail and a bar coloured by your last grader score.
- Tap a card for a quick sheet: run the grader, check, subject, repo, open the folder in VS Code, or the arrow to open the project's screen.
- Agenda replaces the separate Calendar view: a week strip, the day's sessions as a list, and a sheet to register, pick a slot or unregister.

### Changes
- Project screen: big rows for Grader, Prepare, Valgrind, History, Subject, Activities and Details, with Check and Run kept above the tab bar. Details is now a set of clear lists.
- Before your first grader run, the Grader page shows the pushed commit that will be graded and warns when your local commit is not pushed.
- Home lists what needs you, the project open here, and the sessions you are registered to.
- Me: account, colours, language, settings, terms and sign out, plus a new "Banana theme" switch (setting `bananabox.bananaTheme`) that paints buttons in the Bananabox colours instead of your VS Code theme's.
- Valgrind only runs on the project open in this window.
- Faster: the last project list is shown at once after a window reload (Open folder), the sidebar no longer redraws when nothing changed, and clicks are no longer lost while data arrives. Lighter animations.
- French times read "2 j 13 h", and counts use singular and plural correctly.

## [1.8.0] - 2026-11-24

### Highlights
- Forbidden functions are now read from the subject too. A subject that allows the whole libC except a list (my_sudo: `getpw*`, `*fork`, `system`...) gives a forbidden list, with wildcards and lists that wrap across lines.
- Calls to a forbidden function are flagged in the "Allowed functions" check of Prepare and underlined in the editor. Your own functions (`my_fork`) are never flagged.
- The panel shows forbidden names apart, as red chips under "Forbidden by the subject". When the subject allows the whole libC, it says so instead of showing an empty list.

### Changes
- Wildcard exceptions such as my_radar's `sfShape_* (except _getLocalBounds and _getGlobalBounds)` join the forbidden list.
- A subject that gives both an allowed and a forbidden list applies both.
- Forbidden calls have no "Allow" button.
- Subjects read by an older version are read once more after the update to get their forbidden list.

## [1.7.1] - 2026-11-23

### Highlights
- Allowed functions are read from far more subjects. Checked against 43 real subjects (projects, bootstraps and C Pool days) read by hand, the extension now finds the same list for every one of them, where it used to find a list for only a few.
- New wordings understood: "Allowed system function(s):", "The only allowed system call for this project is write.", "The whole libC is forbidden, except ...", "You are only allowed to use the my_putchar function", "malloc, free, read and write are the only syscalls allowed.", and French "Fonctions autorisées".
- Long lists such as my_radar's CSFML list are read whole, across page breaks, with wildcards like `sfMusic_*`. Exceptions such as `sfShape_* (except _getLocalBounds and _getGlobalBounds)` stay forbidden.
- Admin dashboard: every chart now lives in a Graphs tab, which replaces the Simple/Advanced switch.

### Changes
- A subject that allows the whole libC except a forbidden list (my_sudo) gives no allowed list, and a "Forbidden functions:" line is never read as allowed.
- A subject that states several lists (my_putchar, then write) allows all of them.
- Every subject is read once more after the update, so projects read by an older version get the new list without any click.

## [1.7.0] - 2026-11-23

### Highlights
- Allowed functions are read from far more subjects. Checked against 43 real subjects (projects, bootstraps and C Pool days) read by hand, the extension now finds the same list for every one of them, where it used to find a list for only a few.
- New wordings understood: "Allowed system function(s):", "The only allowed system call for this project is write.", "The whole libC is forbidden, except ...", "You are only allowed to use the my_putchar function", "malloc, free, read and write are the only syscalls allowed.", and French "Fonctions autorisées".
- Long lists such as my_radar's CSFML list are read whole, across page breaks, with wildcards like `sfMusic_*`. Exceptions such as `sfShape_* (except _getLocalBounds and _getGlobalBounds)` stay forbidden.
- Admin dashboard: every chart now lives in a Graphs tab, which replaces the Simple/Advanced switch.

### Changes
- A subject that allows the whole libC except a forbidden list (my_sudo) gives no allowed list, and a "Forbidden functions:" line is never read as allowed.
- A subject that states several lists (my_putchar, then write) allows all of them.
- Subjects read before this version keep their old list until "Read the subject" is clicked; 1.7.1 reads them again by itself.

## [1.6.0] - 2026-11-23

### Highlights
- Admin dashboard, Promotions tab: people per promotion and per campus, a campus × promotion heatmap, version adoption per promotion, activity per cursus and launches per person.
- Admin dashboard, Admins tab: list, add, re-assign the whoami of and remove administrators with the Cloudflare root token, which is kept in memory only.
- Users list: each person is shown by first name and last-name initial, with promotion, campus and version.
- Bans target one person, a whole promotion or a whole campus. Each ban records the admin who decided, who can hide their name from the banned user.
- The restricted screen explains each ban: who it targets, the reason, who decided, since when, and which features still work.

### Changes
- A person is identified by a hash of the editor's machine id and the OS account UID instead of the OS account name. Bans made by name keep working.
- Once signed in, the extension reports the first name, last-name initial, promotion, cursus and campus. The full name never leaves the machine.

## [1.5.0] - 2026-11-20

### Highlights
- Prepare pages per event: under the deadline and score tiles (sidebar, Home and the project panel), a strip lists the coming events, nearest first: the next follow-up, the mid-term, then the delivery (which also prepares the defense). Each event opens its own Prepare page with its own checks:
  - Follow-up: committed and pushed, build, coding style, allowed functions, no binary.
  - Mid-term: the same, plus valgrind (up to 1 KB leaked) and unit tests that exist, passing or not.
  - Delivery: everything, with passing tests.
  - Style, allowed functions and binary checks only apply to C projects.
- Every check has a checkbox: turn any of them off per event (`bananabox.disabledChecks`).
- New check: no compiled binary (ELF, Mach-O, `.o`, `.a`, `.so`…) may be pushed. A binary listed in `.gitignore` passes.
- The Grader tab now only runs the grader and shows its results.

### For maintainers
- Admin dashboard, Policy tab: drop a `.vsix` (or pick one on disk) to publish it as a GitHub release with the GitHub account signed in to VS Code, which must be able to push to the repository. The API policy and `api.json` then point every install to it.
- Settings, commands, views and stored data now use the `bananabox` prefix instead of `epibox`. Settings, sign-in and saved state are migrated on the first start.

## [1.4.1] - 2026-11-18

### Highlights
- Terms of use: the sign-in page now asks to accept the terms before anything else, and nothing is sent to the API before you accept. The page only shows the link to the terms, a checkbox enabled once the link was opened, and the accept button. Fixes "Accept and continue" doing nothing when signed out.
- Statistics now include the computer account name (what `whoami` prints), so maintainers can ban an account by name. This is described in `docs/terms.md` (FR: `docs/terms.fr.md`) and only starts after you accept.
- Admin dashboard (maintainers only): a new sidebar icon, shown to the accounts listed as admins by the API and protected by an email and password sign-in. It shows animated statistics, the reported accounts, bans per feature, the authorized list, and switches Lens or the My interface off for everyone.

### For maintainers
- Admin accounts now have a `whoami`: required on `POST /v1/admins`, changeable with `PUT /v1/admins/:id`, listed as `admins` in `GET /v1/config`. `GET /v1/stats` returns a 30 day `timeline`. See `docs/remote-control.md`.

## [1.4.0] - 2026-11-18

### Highlights
- New Bananabox API on Cloudflare (Workers + D1). From this version the extension reads its remote policy (feature switches, required version, bans) from the API instead of the GitHub `api.json`. Releases are still published on GitHub.
- Bans are per account and per feature: an account can lose Lens, the MyEpitech integration, or both. The check still runs locally; your account name is never sent.
- Anonymous usage statistics (optional): a random installation ID, the extension version, the launch count and update events. No e-mail, no account name, no project data. A notice is shown once on the first launch after the update and nothing is sent before the next launch. Turn it off with the setting `epibox.anonymousStatistics`, which also deletes the data stored for your installation. Details in `docs/terms.md` (FR: `docs/terms.fr.md`).
- Each statistics write uses a single-use nonce, so a captured request cannot be replayed.

### For maintainers
- REST API v1 documented in `docs/remote-control.md`: `/v1/banned`, `/v1/authorized`, `/v1/policy`, `/v1/stats`, `/v1/versions`, `/v1/updates`.
- Admin accounts (`@epitech.eu` email, hashed password, 12 h session token) and an append-only audit log readable only with the Cloudflare admin token.
- Retention: installations 180 days after the last launch, update history 365 days, audit log 730 days.

### Fixes
- The package no longer ships the `worker/` folder or local `.vsix` files.

Versions up to 1.3.4 keep reading the GitHub `api.json`, which now points to this release, so they update automatically.

## [1.3.4] - 2026-11-18

- Valgrind step always visible in the delivery checklist (project page and sidebar)
- Coding style summary and hover translated ("Aucune violation"), plus the corrections UI, appearance page, dialogs, toasts, status bar and command titles
- Common clang compiler messages translated to French

## [1.3.3] - 2026-11-18

- Warn when a SRC entry of a Makefile is not a file (#7)
- SUSIE sessions now trigger the defense reminders (#4)
- New "Download subject binaries" button in the Subject section (#6)
- Valgrind step in the delivery checklist, using the saved command (#9)
- Coding style messages translated when the extension is in French (#5)

## [1.3.2] - 2026-11-16

Several coding style messages on the same line are now stacked in a bordered box on the cursor line (setting `bananalens.inline.box`), with a coloured hover card. The box is opaque and the inline text comes ahead of GitLens blame.

## [1.3.1] - 2026-11-16

Updates are now served from this repository. The remote configuration (api.json) lives here; older installs are moved over by the legacy endpoint.


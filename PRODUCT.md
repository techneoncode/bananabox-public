# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

VS Code extension (VS Code 1.95+). All custom UI is VS Code webviews (sidebar, home panel, project panel, admin view, defense reminder), plus native VS Code surfaces (diagnostics, code actions, commands, settings).

## Users

Primary: early-year Epitech students (mainly 1st and 2nd year) working on their projects in VS Code, often close to a deadline. They live by the grader and the coding style, and need to know what is due, what is booked, and whether their next grader run is worth a token.

Secondary: the maintainer, through the admin view (usage and telemetry). Maintainer-only; it does not set the bar for student-facing surfaces.

## Product Purpose

Bring a student's Epitech projects, grader, coding style, activities and calendar inside VS Code, so they never have to switch to the intranet or My to know where they stand. Success: a student checks deadlines, runs and reads the grader, books a slot and fixes style errors without leaving the editor.

## Positioning

Everything in the editor. Bananabox is one place inside VS Code for deadlines, subjects, repositories, grader attempts and scores, pre-run checks, activities and groups, required sessions, defense reminders, coding style and commit diffs. It detects the project that is open. The intranet, My and standalone tools each cover one piece, outside the editor.

## Operating Context

- Students sign in with their Epitech Microsoft account. Coding style works without signing in, in trusted workspaces only, and needs the epiclang executable.
- The grader evaluates the latest pushed commit and costs a token. Bananabox warns when it differs from local HEAD.
- Pre-run checks: coding style, build, local tests, required files, and allowed functions read from the subject PDF (forbidden functions are shown apart).
- Defense reminders: full-screen countdown 60, 30 and 15 minutes before a slot, acknowledged with Ctrl+Alt+Shift+Y (Cmd+Alt+Shift+Y on macOS). Only while VS Code is open and signed in.
- Backend: Bananabox API on Cloudflare Workers and D1 (`worker/`).

## Capabilities and Constraints

- Webviews must follow the active VS Code theme (light, dark, high contrast), stay legible in any of them, and feel native to the editor.
- Interface in English and French (`bananabox.language`, `package.nls*.json`). Every string ships in both; layouts must fit the longer French text.
- Coding style corrections are off by default and always reviewed by the student first.
- Legacy `bananalens.*` settings and `.bananalens.json` files remain supported.
- Terminology: grader, token, attempt, subject, activity, slot, group, defense, coding style, epiclang, promotion, cursus.

## Brand Commitments

- Name: Bananabox, by techneoncode. Unofficial, open-source (MIT), "made by students for students".
- Independent and not affiliated with Epitech: never use Epitech logos or branding, never look official.
- Privacy is part of the product (`docs/terms.md`): it does not read code, projects, files, grades or messages; credentials and tokens never leave the machine; nothing is sent before the terms are accepted. The UI must never undercut this promise.
- Existing assets: `images/icon_nobg.png`, `images/banner.png`, `media/*.svg` view icons.

## Evidence on Hand

- README screenshots: `images/readme/` (home, functions, activities, list, reminder).
- Docs: `docs/grader.fr.md`, `docs/coding-style.md`, `docs/terms.md`, `docs/remote-control.md`.
- No user counts, testimonials or endorsements are recorded. Do not invent them.

## Product Principles

1. Stay in the editor: a student should never need the intranet for what Bananabox covers.
2. Native first: respect VS Code theme, conventions and affordances over a custom look.
3. Spend tokens wisely: surface what would fail before a grader run, and say when local and pushed code differ.
4. Student-owned data: show only what is needed, ask before acting (corrections, auto-registration), keep the privacy promise visible.
5. Equal in both languages: French is never a second-class translation.

## Accessibility & Inclusion

Must stay legible in VS Code high-contrast themes. Defense reminders must be hard to miss and have a keyboard acknowledgement.

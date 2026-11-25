<p align="center">
  <img src="https://i.imgur.com/ufv9ji4.png" width="680" alt="Bananabox banner" />
</p>

<h1 align="center">Bananabox</h1>

<p align="center">Your Epitech projects, grader and coding style, inside VS Code.</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/app-wide.png" width="820" alt="Wide sidebar: tab rail and project board on the left, the grader page of the open project on the right" />
</p>

## What it does

| | |
|---|---|
| **Projects** | Deadlines, subjects, repositories. Bananabox detects the project you have open. |
| **Grader** | Tokens left, run the grader, read results, compare attempts, track your score. |
| **Before you run** | Checks coding style, build, local tests, required files and allowed functions before you spend a token. |
| **Activities** | Book, switch or cancel slots. See who is in which group. |
| **Agenda** | Your week at a glance, free time and overlapping sessions shown as they are. Register in one tap, optional automatic registration. |
| **Defense reminders** | A full-screen countdown 60, 30 and 15 minutes before your slot. |
| **Coding style** | epiclang findings as you type, with optional corrections you review first. |
| **Commit diffs** | Compare a graded commit with your current code. |

## Screenshots

The sidebar works like a phone app: Home, Projects, Agenda and Me in a tab bar, a sheet with one-tap actions for every project, and two panes when you make it wider than 600px.

<p align="center">
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/app-home.png" width="200" alt="Home tab: what needs you and the project open in this window" />
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/app-projects.png" width="200" alt="Projects tab: the open project on top, the others as cards by In progress, Upcoming and Done" />
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/app-sheet.png" width="200" alt="Project sheet: run the grader, check, subject and repository in one tap" />
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/app-agenda.png" width="200" alt="Agenda tab: week strip, sessions of the day with free time and overlapping sessions side by side" />
  <br /><em>Home, Projects, a project's quick sheet and the Agenda.</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/app-project.png" width="260" alt="Project screen: time left, best score, tokens and every page of the project" />
  &nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/app-grader.png" width="260" alt="Grader page in the sidebar: score, history chart, severity breakdown and tasks" />
  <br /><em>A project's screen and its grader results.</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/functions.png" width="820" alt="Grader page with the pre-run checklist and allowed functions read from the subject" />
  <br /><em>Grader results, with the pre-run checklist. Allowed functions are read from the subject PDF.</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/activities.png" width="820" alt="Activities tab with booked slot, available slots and groups" />
  <br /><em>Book or switch a slot without leaving the editor.</em>
</p>

<p align="center">
  <img src="https://i.imgur.com/x1qOwXP.png" width="680" alt="Inline epiclang diagnostics with severity colours" />
  <br /><em>Coding style errors inline, coloured by severity.</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/reminder.png" width="520" alt="Defense reminder countdown" />
  <br /><em>Defense reminder.</em>
</p>

## Get started

1. Install Bananabox (VS Code **1.95+**).
2. Open **Bananabox** in the activity bar and sign in with your Epitech Microsoft account.
3. For coding style, install **epiclang**. If it isn't found, run **Bananabox Coding Style: Locate the epiclang executable**.

Coding style works without signing in, in trusted workspaces only.

## Good to know

- The grader evaluates your latest **pushed** commit and costs a token. Bananabox warns you when it differs from your local HEAD.
- Acknowledge a defense reminder with **Ctrl+Alt+Shift+Y** (**Cmd+Alt+Shift+Y** on macOS). Reminders only run while VS Code is open and you are signed in.
- Corrections are off by default. Old `bananalens.*` settings and `.bananalens.json` files still work. Disable the standalone Banana Lens extension to avoid duplicate findings.
- Interface in English or French (`bananabox.language`). Search **Bananabox** in settings for everything else.

## CLion

The same engine and interface also run in **CLion 2026.3**. Download `bananabox-clion-<version>.zip` from the [releases page](https://github.com/techneoncode/bananabox-public/releases) and install it with **Settings → Plugins → ⚙ → Install Plugin from Disk**. It needs Node.js 20+ and epiclang. The setup steps, the differences from VS Code and the features that do not work in CLion are described in [clion/README.md](clion/README.md) (French).

## Links

[Submission guide (FR)](docs/grader.fr.md) · [Coding style](docs/coding-style.md) · [Development](docs/development.md) · [Remote API](docs/remote-control.md) · [Terms and data collected](docs/terms.md) · [MIT license](LICENSE)

Made by [techneoncode](https://github.com/techneoncode). Independent project, not affiliated with Epitech.

<p align="center">
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/icon_nobg.png" width="112" alt="Bananabox logo" />
</p>

<h1 align="center">Bananabox</h1>

<p align="center">
  <strong>Your Epitech projects, grader and coding style, right in your editor.</strong>
</p>

<p align="center">
  <a href="https://github.com/techneoncode/bananabox-public/releases/latest"><img src="https://img.shields.io/github/v/release/techneoncode/bananabox-public?label=release&color=f5c518" alt="Latest release" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=techneoncode.bananabox"><img src="https://img.shields.io/visual-studio-marketplace/v/techneoncode.bananabox?label=VS%20Code%20Marketplace&color=007ACC" alt="VS Code Marketplace" /></a>
  <a href="clion/README.md"><img src="https://img.shields.io/badge/CLion-2026.3-21D789" alt="CLion 2026.3" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/techneoncode/bananabox-public?color=blue" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=techneoncode.bananabox">Marketplace</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#features">Features</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/overview.png" width="860" alt="Bananabox in a wide sidebar: the project board on the left, a project's grader results on the right" />
</p>

## Features

- **Projects at a glance.** Deadlines, scores and tokens left for every project, with the one open in your window on top.
- **Grader without the browser.** Run the grader, read each failing task, compare attempts and follow your score over time.
- **Checks before you spend a token.** Coding style, build, local tests, required files and allowed functions read from the subject.
- **Agenda.** Your week of sessions, free time and overlaps shown as they are, registration in one tap or automatically.
- **Coding style as you type.** epiclang findings in the editor, with corrections you review before they apply.
- **Defense reminders.** An optional full-screen countdown 60, 30 and 15 minutes before your slot. Off by default: turn it on in **Me**.

<p align="center">
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/home.png" width="200" alt="Home: what needs you and the project open in this window" />
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/project.png" width="200" alt="Project screen: time left, best score, tokens and the project's pages" />
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/grader.png" width="200" alt="Grader results: score, history chart and failing tasks" />
  <img src="https://raw.githubusercontent.com/techneoncode/bananabox-public/main/images/readme/agenda.png" width="200" alt="Agenda: the week strip and the day's sessions, overlaps side by side" />
</p>

## Installation

**VS Code** (1.95 or later): install it from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=techneoncode.bananabox), search **Bananabox** in the Extensions view, or run

```sh
code --install-extension techneoncode.bananabox
```

**CLion** (2026.3, Node.js 20+): download `bananabox-clion-<version>.zip` from the [latest release](https://github.com/techneoncode/bananabox-public/releases/latest), then **Settings → Plugins → ⚙ → Install Plugin from Disk**. See the [CLion guide](clion/README.md) for what differs from VS Code.

## Quick start

1. Open **Bananabox** in the activity bar and sign in with your Epitech Microsoft account.
2. Open a project folder: Bananabox recognises it and puts it on top.
3. For coding style, install [epiclang](docs/coding-style.md). Coding style works without signing in, in trusted workspaces.

> **Note**
> The grader evaluates your latest **pushed** commit and costs a token. Bananabox warns you when it differs from your local `HEAD`.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Coding style](docs/coding-style.md) | epiclang setup, settings, corrections |
| [Submission guide (FR)](docs/grader.fr.md) | Preparing and pushing a delivery |
| [CLion](clion/README.md) | Installing and using the CLion plugin |
| [Development](docs/development.md) | Building, testing and packaging |
| [Remote API](docs/remote-control.md) | The configuration and admin API |
| [Terms and data](docs/terms.md) | What is collected and why |

The interface is available in English and French (`bananabox.language`).

## License

[MIT](LICENSE). Bananabox is an independent project by [techneoncode](https://github.com/techneoncode), not affiliated with Epitech.

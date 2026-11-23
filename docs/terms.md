# Terms of use and collected data

Bananabox is an unofficial, open-source extension (MIT licence), made by students for students and provided as is, without warranty. It is not affiliated with Epitech.

**The short version:** we keep the bare minimum to know who uses the extension and to keep it safe, we sell nothing, we share nothing, and you can have everything deleted whenever you like.

We do not read your code, projects, files, grades or messages. Your password, your email and your Microsoft or My tokens never leave your computer. All the code of the extension and of its API is public in this repository: you can check every line of what is written here.

You must accept these terms before you sign in with Bananabox. Reading this whole text is not required to accept, but we recommend it: it is short. **Nothing about you is sent before you accept** (only the public policy, described below, is downloaded).

## What is sent, and why

The Bananabox API runs on Cloudflare Workers and Cloudflare D1. This is everything it receives.

**At every launch**

| Data | What it is |
| --- | --- |
| Installation id | A random number drawn on your machine, unrelated to you. The server only keeps its SHA-256 fingerprint. |
| Anonymous user id | A fingerprint (SHA-256) computed on your machine from the VS Code id and the UID of your OS account. It contains neither your name nor your account name, and it cannot be turned back into them. It only recognises the same computer from one launch to the next. |
| Extension version | For example `1.6.0`. After an update, the previous and the new version are sent once. |

**Once you sign in to My**, Bananabox adds what your Epitech profile already says:

| Data | Example |
| --- | --- |
| First name | `Zoé` |
| Initial of the last name | `M` (never the full last name) |
| Promotion and cursus | `2027`, `pge` |
| Campus | `Paris` |

Your login, your email, your full last name, your grades, projects and credits are **never** sent.

**Why we need it**

- **Simple statistics.** Knowing how many people use Bananabox, in which promotions and on which campuses, and which versions are still in use so we know when to drop the old ones.
- **Everyone's safety.** If a faulty or malicious version were ever published (the GitHub repository is protected against it), we would know who is affected and could react fast. In case of serious abuse (for example a use that would put everyone's access to My at risk), the maintainers can restrict a person, a promotion or a campus. The first name and initial tell them whom they restrict, without ever needing your full name.

That is all. This data is used for nothing else: no advertising, no resale, no sharing with Epitech or anyone else, no profiling.

## What is stored

Exactly this, and nothing more:

| Stored | Content | Kept |
| --- | --- | --- |
| Installation | Fingerprint of the installation id, anonymous user id, first name, initial of the last name, promotion, cursus, campus, version, number of launches, first and last launch | 180 days after the last launch, then deleted automatically |
| Update history | Fingerprint of the installation id, previous and new version, date | 365 days |
| Nonces | A single-use random value that prevents replaying an intercepted request | 5 minutes |

Versions older than 1.6.0 sent the name of your OS account (`whoami`). This is no longer the case. What was received stays attached to that installation and disappears with it, at the latest 180 days after its last launch.

Only the Bananabox maintainers can see this data, from a dashboard protected by an account and a password. Each of their actions (ban, lifting a ban, policy change) is recorded in a log. A daily task deletes expired data.

**Neither stored nor sent:** your full last name, your login, your email, your password, your Microsoft or My tokens, your projects, files, grades, your code, or your IP address. As with any web request, the call goes through Cloudflare, which processes network metadata under its own policies; the Bananabox API does not keep your IP address.

## Public policy and restrictions

Every minute, the extension downloads the public policy (`GET /v1/config`): the feature switches, the required version and the current restrictions. This is what allows disabling a faulty version and delivering updates.

A restriction targets an anonymous user id, a promotion or a campus (or, for those made before version 1.6.0, an OS account name). The comparison with your situation happens **on your computer**. The policy is public: it contains these targets, the reason given and the name of the admin who decided, unless they chose to hide it. **Your first name never appears in it.**

If a restriction applies to you, Bananabox tells you plainly: whom it targets, why, who decided and since when, and what still works. You can appeal on Microsoft Teams.

## What you control

- **Check everything:** everything described here is in the code of this repository.
- **Stop everything and delete everything:** turn off the `bananabox.anonymousStatistics` setting. The extension then asks the API to delete everything stored for your installation, and forgets its id.
- **Any other request** (knowing what we have about you, having something deleted): open an issue on https://github.com/techneoncode/bananabox-public, we will answer.
- If you do not accept these terms, you can still uninstall Bananabox, but you cannot sign in with it.

## Changes

Changes to these terms are published in this repository with the version that introduces them. The French version is [terms.fr.md](terms.fr.md).

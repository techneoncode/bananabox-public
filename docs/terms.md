# Terms of use and data collected

Bananabox is an unofficial open-source extension (MIT license), provided as is, without warranty. It is not affiliated with Epitech.

The short version: Bananabox sends a very small amount of technical information to its own API, for **statistics** and **security**. No password, e-mail, project, file or My data ever leaves your machine because of it, and you can ask for what was stored to be deleted at any time.

You must accept these terms the first time you open the sign-in page, before you can sign in. **Nothing about you is sent to the API before you accept** (only the public policy, described below, is downloaded).

## What is sent, and why

The API runs on Cloudflare Workers and Cloudflare D1. When you use Bananabox, at each launch it sends:

| Data | What it is |
| --- | --- |
| Account name (`whoami`) | The name of your user account on your computer: what the `whoami` command prints in a terminal, for example `jdupont`. It is not your Epitech login, your e-mail or your real name, though it can look like one. |
| Installation ID | A random number generated on your machine, unrelated to you. The server keeps only its SHA-256. |
| Extension version | For example `1.4.0`. After an update, the previous and the new version are also sent once. |

From these the server derives the number of launches, the date of the first and last launch, and the date of each update.

**Why we need it**

- **Statistics.** Know how many people use the extension, in which Epitech promotions, and also how many people outside Epitech use it. This also tells us which versions are still in use and when old ones can be dropped.
- **Security.** If a malicious version were ever published (we hope not, and the GitHub project is protected against it), we could tell which computers are affected and act quickly. The account name also lets maintainers restrict a specific account if there is a serious abuse, which requires knowing its name.

It is first of all statistics and security. We do not use it for anything else, we do not sell it and we do not share it.

## What is stored

Exactly this, and nothing more:

| Stored | Content | Kept |
| --- | --- | --- |
| Installation | SHA-256 of the installation ID, account name, version, launch count, first and last launch | 180 days after the last launch |
| Update history | SHA-256 of the installation ID, previous and new version, date | 365 days |
| Nonces | A random single-use value that stops a captured request from being replayed | 5 minutes |

Only the maintainers can read the account names, through an authenticated admin endpoint. A daily job deletes expired data.

**Not stored and not sent:** your e-mail, name, password, Microsoft or My tokens, projects, files, grades, code, or your IP address (like any web request, the call reaches Cloudflare, which processes network metadata under its own policies; the Bananabox API does not store it).

## Remote policy

Every minute the extension downloads the policy (`GET /v1/config`): the two feature switches, the required version and the lists of authorized and banned account names. It is how a faulty version can be disabled and updates delivered. The comparison between your account name and these lists happens on your machine. The lists are publicly readable.

## Your control

- You can read the code: everything described here is in this repository.
- Turn it off with the setting `epibox.anonymousStatistics`. The extension then asks the API to delete everything stored for your installation and forgets the ID.
- To ask for anything else (access, deletion), open an issue on https://github.com/techneoncode/bananabox-public.
- If you do not accept these terms, you cannot sign in with Bananabox.

## Changes

Changes to these terms are published in this repository with the release that introduces them. The French version is [terms.fr.md](terms.fr.md).

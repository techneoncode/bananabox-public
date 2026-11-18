# Terms of use and data collected

Bananabox is an unofficial open-source extension (MIT license). It is provided as is, without warranty. It is not affiliated with Epitech.

## What the extension sends to the Bananabox API

The API runs on Cloudflare Workers and Cloudflare D1.

**Remote policy (always).** Every minute the extension downloads the policy (`GET /v1/config`): the two feature switches, the required version and the lists of banned and authorized account names. This is how a faulty version can be disabled and updates delivered. The extension compares your OS account name with these lists on your machine. **Your account name is never sent.**

**Anonymous usage statistics (optional, on by default).** At each launch the extension sends:

- a random installation ID, generated on your machine, unrelated to your account, e-mail or machine. The server stores only its SHA-256;
- the extension version;
- on the first launch after an update, the previous and the new version.

The server derives the number of launches, the first and last launch time of the installation, and the date of each update. **No name, e-mail, account name, project, file or MyEpitech data is sent**, and nothing is sent when the policy refuses your account.

Purpose: count active installations, know which versions are still in use, and decide when old versions can be dropped.

**Single-use nonces.** Each statistics write first asks the API for a random nonce (valid 5 minutes, usable once). It stops a captured request from being replayed and keeps one installation from changing another one's counters, which would also require its secret ID.

**Network metadata.** Like any web request, these calls expose your IP address to Cloudflare. The Bananabox API does not store it. Cloudflare's own processing is covered by its policies.

## Notice, consent and control

- After an update that adds statistics, the extension shows a notice once and **sends nothing until the next launch**.
- Turn it off with the setting `epibox.anonymousStatistics` (or the **Turn off** button of the notice). The extension then asks the API to delete everything stored for the installation and forgets the ID.
- Because the ID is random and secret, the data cannot be linked to a person by anyone, including the maintainers. Access and deletion therefore work through the setting above. To ask for something else, open an issue on https://github.com/techneoncode/bananabox-public.

## Retention

| Data | Kept |
| --- | --- |
| Installation (hashed ID, version, launch count, first and last seen) | 180 days after the last launch |
| Update history (hashed ID, versions, date) | 365 days |
| Nonces | 5 minutes |

A daily job deletes expired data.

## Bans

Maintainers can restrict features for account names listed in the policy. The list is publicly readable through `GET /v1/config`.

## Changes

Changes to these terms are published in this repository with the release that introduces them. The French version is [terms.fr.md](terms.fr.md).

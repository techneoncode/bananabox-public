# Remote control API

Bananabox reads its remote policy from a Cloudflare Worker (`worker/`), deployed at `https://bananabox-api.niels-christophe.workers.dev`. Data lives in a Cloudflare D1 database (schema in `worker/migrations/`).

Every response is JSON: `{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "code", "message" } }`. Bodies are limited to 2 KB. Protected endpoints need `Authorization: Bearer <token>`: either an admin session token (see below) or, for everything, the Cloudflare admin token (`ADMIN_TOKEN`, called *root* here).

## Public endpoints (used by the extension)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/config` | Policy read every minute: `lens_active`, `my_api_active`, `version`, `latest`, `authorized` (names), `banned` (`[{ user, features }]`) and `admins` (the `whoami` of each admin, which only decides who sees the dashboard in the extension). |
| `POST` | `/v1/nonce` | Returns a single-use nonce (valid 5 minutes). |
| `POST` | `/v1/installs` | `{ installId, version, account?, nonce }`: records a launch. `account` is the OS account name; it is stored if valid as a ban name, and listed in `users` by `GET /v1/stats`. Repeats within 60 s are not counted. |
| `DELETE` | `/v1/installs` | `{ installId, nonce }`: deletes everything stored for this installation. |
| `POST` | `/v1/updates` | `{ installId, from, to, nonce }`: records an installed update. Needs a registered installation; duplicates are ignored. |

`installId` is 32 hex characters generated locally and never shared. Only its SHA-256 is stored. See [the terms](terms.md) for what is collected and why.

## Admin accounts and audit log

Admins authenticate with an `@epitech.eu` email and a password they own (it does not have to be their Epitech password; 12 to 128 characters). Passwords are stored as salted PBKDF2-SHA256 hashes (100 000 iterations), never in clear.

```sh
API=https://bananabox-api.niels-christophe.workers.dev
read -rs -p "Password: " PW; echo
TOKEN=$(curl -s -X POST "$API/v1/admin/login" -d "{\"email\":\"me@epitech.eu\",\"password\":\"$PW\"}" | jq -r .data.token)
```

A session lasts 12 hours. Five failed logins lock the account for 15 minutes. Every administrative change (and every login, logout and password change) is written to an append-only audit log, in the same transaction as the change. Reads are not logged.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/admin/login` | public | `{ email, password }` returns `{ token, expires_at }`. |
| `POST` | `/v1/admin/logout` | admin | Ends the current session. |
| `GET` | `/v1/admin/me` | admin | Who am I. |
| `PUT` | `/v1/admin/password` | admin | `{ current_password, new_password }`; other sessions are revoked. |
| `GET` / `POST` | `/v1/admins` | root | List admin accounts / create `{ email, whoami, password }`. `whoami` is the OS account name (same alphabet as a ban name) of the person; the extension shows the admin dashboard only to it. |
| `PUT` | `/v1/admins/:id` | root | `{ whoami }`: set or change the OS account name of an admin (needed for accounts created before `whoami` existed). |
| `DELETE` | `/v1/admins/:id` | root | Delete an account and its sessions. |
| `PUT` | `/v1/admins/:id/password` | root | `{ password }`: reset, unlock and revoke sessions. |
| `GET` | `/v1/logs` | root | Audit log, newest first. Filters: `actor` (email), `action`, `limit` (1 to 500), `before` (id, use `next_before` to page). |

Logged actions: `login.success`, `login.failure`, `login.locked`, `logout`, `password.change`, `password.change_failed`, `admin.create`, `admin.update`, `admin.delete`, `admin.password_reset`, `banned.add|update|delete`, `authorized.add|delete`, `policy.update`. Each entry has the time, the actor (`admin` with email, `root`, or `anonymous` for failed logins) and the details (previous and new values for updates). Logs are kept for 730 days.

## Admin endpoints

Usable by any admin account and by root.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/v1/banned` | List / add `{ name, reason?, features? }`. `features` is the non-empty subset of `lens_active`, `my_api_active` the account loses (default both). 409 if present. |
| `PUT` | `/v1/banned/:id` | Change `features` and/or `reason`. |
| `DELETE` | `/v1/banned/:id` | Remove an entry. |
| `GET` / `POST` | `/v1/authorized` | List / add `{ name, reason? }`: accounts that bypass the activation switches. |
| `DELETE` | `/v1/authorized/:id` | Remove an entry. |
| `GET` / `PUT` | `/v1/policy` | `{ lens_active, my_api_active, version, latest }`. `latest` must be the `bananabox-<version>.vsix` asset of release `v<version>`. |
| `GET` | `/v1/stats` | Installations, active (seen in the last 30 days), inactive, obsolete (older than the policy version), launches, per-version counts, `users` (reported account names) and `timeline` (30 UTC days: `new` installations and `last_seen` counts). |
| `GET` | `/v1/versions` | Per-version counts with an `obsolete` flag. |
| `GET` | `/v1/updates?limit=` | Update history, newest first (1 to 500, default 100). |

```sh
curl -X POST "$API/v1/banned" -H "Authorization: Bearer $TOKEN" -d '{"name":"someone","features":["lens_active"],"reason":"why"}'
curl -X DELETE "$API/v1/banned/3" -H "Authorization: Bearer $TOKEN"
curl "$API/v1/stats" -H "Authorization: Bearer $TOKEN"
```

## Admin dashboard in the extension

An account whose `whoami` is in `admins` (exact, case-sensitive match with the OS account name) gets an extra activity-bar icon. The dashboard still needs an email and password: it signs in through `POST /v1/admin/login` and keeps the session token in the editor's secret storage (12 hours, never given to the webview). It shows the statistics, lists the reported accounts, bans and unbans them (per feature), manages the authorized list and switches Lens or the My interface off for everyone. Hiding the icon is only a convenience: every admin endpoint is protected by the session.

## Policy semantics

- `lens_active: false` stops coding style scans, diagnostics, lenses and corrections for everyone except authorized accounts. `my_api_active: false` blocks MyEpitech requests and authentication, cancelling in-flight calls.
- `authorized` and the `user` of each `banned` entry are case-sensitive substrings of OS account names, from Node's `os.userInfo().username` (same as `whoami` in the extension host). `"niels"` matches `niels`, `nielsLaptop` and `superniels`, but not `Niels`. Matching happens locally: the account name is never sent to the API. In SSH, containers or WSL, it is the account of the remote extension host.
- A matching `banned` entry denies its own `features`, even for an authorized account. When several entries match, their features add up. Names are validated: 1 to 64 characters among letters, digits, `_ . @ $ \ -`.
- A Lens-only restriction shows a notice and leaves the My interface usable. A My-only restriction shows a revoked-access page while Lens keeps working. With both restricted, the page explains that access was revoked: **Appeal** opens `https://teams.microsoft.com/`, **Uninstall** uninstalls Bananabox, and updates stop. A restricted account sends no statistics.
- An installed version older than `version` disables both features and triggers the automatic update to `latest`.

## Operating the Worker

```sh
cd worker && npm install
npm run migrate:remote   # apply new migrations to the production D1
npm run deploy
npx wrangler secret put ADMIN_TOKEN
npm test                 # local D1 through `wrangler dev`
```

A daily cron deletes expired nonces, installations not seen for 180 days and update history older than 365 days.

Versions up to 1.3.4 still read `api.json` from this repository. Keep it in sync with the Worker (`GET /v1/config`) while those versions are in use.

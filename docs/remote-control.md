# Remote control API

Bananabox reads its remote policy from a Cloudflare Worker (`worker/`), deployed at `https://bananabox-api.niels-christophe.workers.dev`. Data lives in a Cloudflare D1 database (schema in `worker/migrations/`).

Every response is JSON: `{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "code", "message" } }`. Bodies are limited to 2 KB. Admin endpoints need `Authorization: Bearer <ADMIN_TOKEN>`.

## Public endpoints (used by the extension)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/config` | Policy read every minute: `lens_active`, `my_api_active`, `version`, `latest`, `authorizedUsers`, `bannedUsers`, `bannedFeatures`. |
| `POST` | `/v1/nonce` | Returns a single-use nonce (valid 5 minutes). |
| `POST` | `/v1/installs` | `{ installId, version, nonce }`: records a launch. Repeats within 60 s are not counted. |
| `DELETE` | `/v1/installs` | `{ installId, nonce }`: deletes everything stored for this installation. |
| `POST` | `/v1/updates` | `{ installId, from, to, nonce }`: records an installed update. Needs a registered installation; duplicates are ignored. |

`installId` is 32 hex characters generated locally and never shared. Only its SHA-256 is stored. See [the terms](terms.md) for what is collected and why.

## Admin endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/v1/banned` | List / add `{ name, reason? }` (409 if already present). |
| `DELETE` | `/v1/banned/:id` | Remove an entry. |
| `GET` / `POST` | `/v1/authorized` | Same, for accounts that bypass the activation switches. |
| `DELETE` | `/v1/authorized/:id` | Remove an entry. |
| `GET` / `PUT` | `/v1/policy` | `{ lens_active, my_api_active, version, latest, banned_features? }`. `latest` must be the `bananabox-<version>.vsix` asset of release `v<version>`. |
| `GET` | `/v1/stats` | Installations, active (seen in the last 30 days), inactive, obsolete (older than the policy version), launches, per-version counts. |
| `GET` | `/v1/versions` | Per-version counts with an `obsolete` flag. |
| `GET` | `/v1/updates?limit=` | Update history, newest first (1 to 500, default 100). |

```sh
API=https://bananabox-api.niels-christophe.workers.dev
TOKEN=$(cat .admin_token)
curl -X POST "$API/v1/banned" -H "Authorization: Bearer $TOKEN" -d '{"name":"someone","reason":"why"}'
curl -X DELETE "$API/v1/banned/3" -H "Authorization: Bearer $TOKEN"
curl "$API/v1/stats" -H "Authorization: Bearer $TOKEN"
```

## Policy semantics

- `lens_active: false` stops coding style scans, diagnostics, lenses and corrections for everyone except authorized accounts. `my_api_active: false` blocks MyEpitech requests and authentication, cancelling in-flight calls.
- `authorizedUsers` and `bannedUsers` contain case-sensitive substrings of OS account names, from Node's `os.userInfo().username` (same as `whoami` in the extension host). `"niels"` matches `niels`, `nielsLaptop` and `superniels`, but not `Niels`. Matching happens locally: the account name is never sent to the API. In SSH, containers or WSL, it is the account of the remote extension host.
- A match in `bannedUsers` denies the features in `bannedFeatures`, even for an authorized account. `bannedFeatures` applies to every banned account and defaults to both features. Entries are validated: 1 to 64 characters among letters, digits, `_ . @ $ \ -`.
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

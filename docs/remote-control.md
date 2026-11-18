# Remote configuration and automatic updates

Bananabox for VS Code reads this endpoint at startup, every minute, and when **Refresh** is clicked:

`https://raw.githubusercontent.com/techneoncode/bananabox-public/refs/heads/main/api.json`

```json
{
  "lens_active": true,
  "my_api_active": true,
  "version": "1.3.4",
  "latest": "https://github.com/techneoncode/bananabox-public/releases/download/v1.3.4/bananabox-1.3.4.vsix",
  "authorizedUsers": ["niels"],
  "bannedUsers": [],
  "bannedFeatures": ["lens_active", "my_api_active"]
}
```

- `lens_active: false` stops coding style scans, diagnostics, lenses and corrections. Local settings cannot bypass the restriction.
- `my_api_active: false` blocks MyEpitech requests and authentication, cancels pending requests, suspends the session, and replaces the Bananabox view with an account protection message. Stored credentials remain available for reactivation. **Refresh** checks access again; **Fetch version** checks the remote configuration and displays the installed and required versions; **Uninstall** invokes VS Code's actual uninstaller for `techneoncode.bananabox`.
- `authorizedUsers` contains case-sensitive substrings of OS account names, obtained through Node's `os.userInfo().username` (the same account as `whoami` in the extension host). For example, `"niels"` matches `niels`, `nielsLaptop` and `superniels`, but not `Niels`. An authorized account bypasses the two remote activation switches. Local Lens preferences and workspace trust still apply. In SSH, containers or WSL, this is the account on the remote extension host.
- `bannedUsers` is an optional list of case-sensitive OS account name substrings, defaulting to `[]`. A match denies the features in `bannedFeatures`, even if the account also matches `authorizedUsers`. Empty strings in either list are ignored.
- `bannedFeatures` lists the features restricted for matching accounts: `["lens_active"]`, `["my_api_active"]`, both, or `[]` for neither. Missing `bannedFeatures` defaults to both for compatibility with older policies. Other accounts are unaffected by this list. A Lens-only restriction shows a notice while leaving the My interface usable. A My-only restriction shows a revoked-access page while Lens keeps working if otherwise enabled. When both are restricted, the page explains that Bananabox access has been revoked. **Appeal** opens `https://teams.microsoft.com/`; **Uninstall** actually uninstalls Bananabox. Updates are stopped only when both features are restricted for the account. These actions remain available while signed out or blocked.
- `version` is the minimum build allowed, written as `major.minor.patch` with an optional `-prerelease` (for example `1.3.0` or `1.4.0-beta.2`). Versions are compared by semver precedence: `1.10.0` is newer than `1.9.0`, and `1.4.0-beta.2` is older than `1.4.0`. Any other form, such as `1.3` or `1.3.0+build`, is rejected with an error naming the value. An installed build older than `version` disables both features for everyone, including authorized users, and triggers the update. An equal or newer build works normally and is never downgraded or reinstalled, so a development build ahead of the published one stays as it is. The view shows the installed and required versions, with update progress or failure details.
- `latest` must be the direct HTTPS VSIX asset of the public release tagged `v<version>`: `https://github.com/techneoncode/bananabox-public/releases/download/v<version>/bananabox-<version>.vsix`, as in the example above. The host must be `github.com`, the repository `techneoncode/bananabox-public`, and the tag and file name must match `version` exactly. Query strings and fragments are rejected. GitHub's HTTPS asset redirects are followed. A repository page, a release page, a URL of another repository, or a mismatched tag or file name is rejected with a message naming the problem.
- An invalid `version` or `latest` makes the whole configuration invalid. It is handled like any other invalid response: both features are blocked until a valid configuration is received.

When the installed build is older than `version`, Bananabox downloads the VSIX without credentials, checks that its manifest identifies `techneoncode.bananabox` at the required version, then invokes VS Code's extension installer. Nothing is downloaded when the installed build is equal to or newer than `version`. It offers a reload when installation finishes. Features remain blocked until the required version is actually loaded. A successful installation is remembered so polling and window restarts do not repeatedly install it while waiting for a reload. Failed updates can be retried with **Refresh**, and are retried on the next scheduled check. The administrator must upload the matching VSIX before publishing the JSON version change.

The update screen shows both versions, download progress in bytes and percent when the server reports a usable content length, and separate download, verification and installation steps. Without a known download size, and during verification and VS Code installation, it shows an indeterminate progress bar. **Reload VSCode** stays disabled until installation succeeds; the host also rejects premature reload requests.

Offline access is blocked: a timeout, network failure, HTTP error or invalid configuration disables both features, including for authorized users. Cached configuration never grants offline access. A valid response automatically restores the features allowed by the switches, version and account. Network loss is detected on the next configuration check (every minute, with a ten-second timeout); **Refresh** checks immediately. If the update download fails while the JSON remains accessible, the version restriction continues to block both features.

This is an availability mechanism, not an authentication system: account names and extension code are under the local user's control.

Every uninstall control includes **Refresh VSCode**, disabled until VS Code successfully completes the uninstall command. The host also rejects early refresh requests. Failed uninstalls show an error and can be retried. Update pages include these controls alongside their separate **Reload VSCode** action, which still requires a successful update installation.

The My-only and full revoked-access pages show local request counters from the extension's MyEpitech client: actual fetch attempts (including retries) grouped by HTTP method and route, and HTTP 429 responses actually received. Remotely blocked requests are not counted. Routes use placeholders for identifiers; query strings, tokens, bodies, account details and unknown path contents are not retained. Counters stay in memory, start empty, and reset on explicit sign-out, an account change or an extension restart. Remote suspension preserves them so the access screen can show recent observations from the current session. An empty session explicitly shows no observed API calls. These observations do not establish the cause of the remote restriction. No additional API requests are made to populate the table.


# Developing Bananabox

Use Node.js 22 and VS Code 1.95 or later.

```sh
npm ci
npm run typecheck
npm test
npm run package
```

Press F5 in VS Code to launch the Extension Development Host. Packaging creates one `bananabox-<version>.vsix` with the MyEpitech integration, commit explorer and coding-style engine.

The MyEpitech host lives in `src/controller.ts` and `src/services`. Commit browsing and diffs live in `src/git`. The coding-style engine lives in `src/codingStyle`; its original MIT notice is in `licenses/Banana-Lens.txt`.

Run `npm run test:coding-style` to check just the coding-style engine. Tests use synthetic responses and local compiler fixtures. The Firefox sign-in tests need permission to listen on localhost. A real account and an Extension Development Host are needed to check sign-in and the interface end to end.

The root README is also the extension overview in VS Code and on the Marketplace. Screenshots live in `images/readme/` (excluded from the VSIX) and are captured from `scripts/preview` fixtures with headless Firefox. vsce rewrites their relative paths to `raw.githubusercontent.com` URLs from the `repository` field in `package.json`, so they only display on the Marketplace while the repository is public. Shots in a row share one size (360x760); the overview is `images/readme/overview.png`. Badges come from `img.shields.io`, a badge provider vsce accepts.

Source assets remain in `images/`. The activity bar and Bananabox view use the monochrome box in `media/activity.svg`. The supplied transparent icons are `images/icon_nobg.png` for the extension logo and `images/gitdiff_nobg.png` for the commit explorer. VS Code uses the commit icon’s alpha channel for its navigation icon. The README header shows `images/icon_nobg.png`. The sign-in webview embeds the installed extension logo as a data URI allowed by its own image CSP, so it needs no network.


The Marketplace identity is `techneoncode.bananabox`. Command, view and setting IDs use the `bananabox.*` prefix. Settings, sign-in and stored data saved under the older `epibox.*` IDs are moved over on the first start.

import * as vscode from 'vscode';
import { BrowserAuthError, detectBrowsers, findBrowser, type DetectedBrowser } from '../auth/browser';
import { browserProfileDir, captureRedirect } from '../auth/capture';
import {
  buildAuthRequest,
  parseRedirect,
  redeemAuthCode,
  type MicrosoftTokens,
} from '../auth/microsoft';
import { remoteFeatures } from '../services/remoteFeatures';
import type { AuthVM } from '../shared/types';
import { config } from '../util/config';
import { log } from '../util/log';
import type { Controller } from '../controller';
import { tr } from '../util/text';

export function authChanged(c: Controller, a: AuthVM): void {
  const previousLogin = c.activityLogin;
  if (a.status === 'signedIn' && a.login) {
    if (c.activityLogin && c.activityLogin !== a.login) {
      c.client.activity.clear();
      c.client.guard.clear();
    }
    c.activityLogin = a.login;
  }

  if (a.status === 'signedIn' && c.sessionToken !== c.auth.accessToken) {
    // A silent renewal rotates the token of the same account: keep what is on screen (and the scroll) as it is.
    const renewed = c.sessionToken !== undefined && previousLogin !== undefined && previousLogin === a.login;
    c.sessionToken = c.auth.accessToken;
    if (renewed) return c.schedulePush();
    c.projects.reset();
    c.grader.clear();
    c.subject.clear();
    c.activities.clear();
    c.calendar.clear();
    c.activityRefreshes.clear();
    c.activityMutations.clear();
    c.defenseReminders.update(null, []);
    c.style.clear();
    c.style.api?.refreshProjectRules?.();
    c.clearDelivery();
    c.latestSeen.clear();
    void c.projects.refresh();
    c.calendar.start();
    if (c.openHomeAfterSignIn) {
      c.openHomeAfterSignIn = false;
      c.home?.show();
    }
  } else if (a.status !== 'signedIn') {
    c.sessionToken = undefined;
    c.commitStates = {};
    c.autoOpened.clear();
    c.subject.clear();
    c.projects.reset();
    c.grader.clear();
    c.activities.clear();
    c.calendar.clear();
    c.activityRefreshes.clear();
    c.activityMutations.clear();
    c.defenseReminders.update(null, []);
    c.style.clear();
    c.style.api?.refreshProjectRules?.();
    c.clearDelivery();
    c.latestSeen.clear();
    if (a.status === 'signedOut') {
      c.panels.closeAll();
      c.home?.dispose();
      void c.avatars.clear();
    }
  }
  c.schedulePush();
}

/**
 * Office 365 sign-in, same flow as my.epitech.eu (authorization code + PKCE).
 */
export async function signInMicrosoft(
  c: Controller,
  opts: { paste?: boolean } = {},
): Promise<void> {
  c.openHomeAfterSignIn = true;
  if (!remoteFeatures.status.myApiActive) return;
  if (c.auth.snapshot.busy) return;
  c.abortBrowser();

  const executable = opts.paste ? undefined : findBrowser(config.browserPath());
  if (!executable) return c.signInWithPaste(opts.paste ? undefined : tr('No Chrome, Edge, Brave, Chromium or Firefox found.'));
  const outcome = await c.signInWithBrowser(executable);
  if (typeof outcome === 'object') return c.signInWithPaste(outcome.unavailable);
}

export async function signIn(c: Controller): Promise<void> {
  c.openHomeAfterSignIn = true;
  if (!remoteFeatures.status.myApiActive) return;

  const token = await vscode.window.showInputBox({
    title: tr('Bananabox: Sign in'),
    prompt: tr('Paste your access token (my.epitech.eu → DevTools → Network → any /api request → Authorization header). A Microsoft token is also accepted.'),
    placeHolder: 'eyJhbGciOi…',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) =>
      v.trim().length > 0 && v.trim().length < 20
        ? tr('This does not look like a token.')
        : undefined,
  });
  if (!token) return;
  return signInWithToken(c, token);
}

/** Token pasted on the sign-in page or in the prompt; a failure shows on the page (and here, with a retry). */
export async function signInWithToken(c: Controller, token: string, fromPage = false): Promise<void> {
  c.openHomeAfterSignIn = true;
  if (!remoteFeatures.status.myApiActive || c.auth.snapshot.busy) return;
  // The header is often copied whole.
  token = token.trim().replace(/^Bearer\s+/i, '');
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: tr('Bananabox: signing in…'),
      },
      () => c.auth.signIn(token),
    );
    if (!c.auth.isSignedIn) return;
    void vscode.window.showInformationMessage(
      tr('Bananabox: signed in as {name}.', { name: c.auth.snapshot.firstname ?? c.auth.snapshot.login ?? '' }),
    );
  } catch (e) {
    if (fromPage) return;
    const choice = await vscode.window.showErrorMessage(
      tr('Bananabox: sign-in failed · {error}', { error: (e as Error).message }),
      tr('Try again'),
    );
    if (choice === tr('Try again')) return c.signIn();
  }
}

/** Browsers the sign-in page offers, the one that will open marked. */
export function browserChoices(): (DetectedBrowser & { selected: boolean })[] {
  const own = config.browserPath();
  const used = findBrowser(own);
  return detectBrowsers(own).map((b) => ({ ...b, selected: b.path === used }));
}

/** Only a detected browser can be picked from the page; any other path goes through the setting. */
export async function selectBrowser(path: string): Promise<void> {
  if (!browserChoices().some((b) => b.path === path)) return;
  await vscode.workspace
    .getConfiguration('bananabox')
    .update('browserPath', path, vscode.ConfigurationTarget.Global);
}

export function abortBrowser(c: Controller) {
  c.browserAbort?.abort();
  c.browserAbort = undefined;
}

export function cancelSignIn(c: Controller) {
  c.pendingAuth = undefined;
  c.abortBrowser();
  c.auth.setPending(null);
}

export async function signOut(c: Controller) {
  c.pendingAuth = undefined;
  c.abortBrowser();
  await c.auth.signOut();
  c.client.activity.clear();
  c.client.guard.clear();
  c.activityLogin = undefined;
  c.schedulePush();
}

/**
 * Completes the paste fallback from the pasted address (or `code=…` string).
 */
export async function submitRedirect(c: Controller, input: string) {
  c.openHomeAfterSignIn = true;
  const request = c.pendingAuth;
  if (!request || c.auth.snapshot.busy) return;

  let code: string;
  try {
    code = parseRedirect(input, request.state).code;
  } catch (e) {
    return c.auth.reportError((e as Error).message, true);
  }
  c.auth.setPending(null, true);

  try {
    const tokens = await redeemAuthCode(code, request.codeVerifier);
    c.pendingAuth = undefined;
    await c.auth.signIn(tokens.idToken, { msRefresh: tokens.refreshToken });
    if (c.auth.isSignedIn) {
      void vscode.window.showInformationMessage(
        tr('Bananabox: signed in as {name}.', { name: c.auth.snapshot.firstname ?? c.auth.snapshot.login ?? '' }),
      );
    }
  } catch (e) {
    c.pendingAuth = undefined;
    await c.failSignIn((e as Error).message);
  }
}

/**
 * Silent renewal (`prompt=none`) in a hidden browser that reuses Microsoft's
 * cookies. Resolves `null` if the user is needed.
 */
export async function silentBrowserLogin(
  c: Controller,
): Promise<MicrosoftTokens | null> {
  // A visible sign-in owns the profile: a hidden renewal would stop its window.
  if (!remoteFeatures.status.myApiActive || c.browserAbort) return null;
  const executable = findBrowser(config.browserPath());
  if (!executable) return null;

  try {
    const request = buildAuthRequest(undefined, {
      prompt: 'none',
      loginHint: c.auth.snapshot.login ?? undefined,
    });
    const redirect = await captureRedirect({
      executable,
      profileDir: c.browserProfile(executable),
      url: request.url,
      headless: true,
      timeoutMs: 15_000,
    });
    const { code } = parseRedirect(redirect, request.state);
    return await redeemAuthCode(code, request.codeVerifier);
  } catch (e) {
    log().info(`invisible renewal not possible: ${(e as Error).message}`);
    return null;
  }
}

export function browserProfile(c: Controller, executable: string): string {
  return browserProfileDir(c.context.globalStorageUri.fsPath, executable);
}

export async function signInWithBrowser(
  c: Controller,
  executable: string,
): Promise<'done' | 'cancelled' | { unavailable: string }> {
  const request = buildAuthRequest();
  const ctrl = new AbortController();
  c.browserAbort = ctrl;
  c.pendingAuth = undefined;
  c.auth.setPending({ url: request.url, mode: 'browser' });

  try {
    const redirect = await captureRedirect({
      executable,
      profileDir: c.browserProfile(executable),
      url: request.url,
      timeoutMs: 5 * 60_000,
      signal: ctrl.signal,
    });
    const { code } = parseRedirect(redirect, request.state);
    c.auth.setPending(null, true);
    const tokens = await redeemAuthCode(code, request.codeVerifier);
    await c.auth.signIn(tokens.idToken, {
      msRefresh: tokens.refreshToken,
      viaBrowser: true,
    });
    if (c.auth.isSignedIn) {
      void vscode.window.showInformationMessage(
        tr('Bananabox: signed in as {name}.', { name: c.auth.snapshot.firstname ?? c.auth.snapshot.login ?? '' }),
      );
    }
    return 'done';
  } catch (e) {
    if (e instanceof BrowserAuthError && e.code === 'unavailable') {
      log().error('browser sign-in unavailable, falling back to copy-paste', e);
      if (c.browserAbort === ctrl) c.auth.setPending(null);
      return { unavailable: e.message };
    }
    if (e instanceof BrowserAuthError && e.code === 'cancelled') {
      // Aborted by a newer attempt ("Retry"): its window is the one on screen now.
      if (c.browserAbort === ctrl) c.auth.setPending(null);
      return 'cancelled';
    }
    await c.failSignIn((e as Error).message);
    return 'done';
  } finally {
    if (c.browserAbort === ctrl) c.browserAbort = undefined;
  }
}

export async function signInWithPaste(c: Controller, reason?: string) {
  const request = c.pendingAuth ?? buildAuthRequest();
  c.pendingAuth = request;
  c.auth.setPending({ url: request.url, mode: 'paste', ...(reason && { reason }) });
  await vscode.env.openExternal(vscode.Uri.parse(request.url));
}

export async function failSignIn(
  c: Controller,
  message: string,
): Promise<void> {
  c.pendingAuth = undefined;
  c.auth.reportError(message);
  const choice = await vscode.window.showErrorMessage(
    `Bananabox: ${message}`,
    tr('Try again'),
    tr('Use an access token'),
  );
  if (choice === tr('Try again')) return c.signInMicrosoft();
  if (choice === tr('Use an access token')) return c.signIn();
}

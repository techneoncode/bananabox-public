import { resolve } from 'node:path';
import * as vscode from 'vscode';
import { configureChecks } from '../delivery/configure';
import { validCommit } from '../git/commitData';
import { validAvatarLogin } from '../services/avatarService';
import { describe } from '../services/graderService';
import { remoteFeatures } from '../services/remoteFeatures';
import { validateFunctionNames } from '../domain/functionRules';
import { createT } from '../shared/i18n';
import type { PanelTab, WebviewMessage } from '../shared/protocol';
import { config } from '../util/config';
import type { Controller, Surface } from '../controller';
import { cancelSignIn, signInMicrosoft, submitRedirect } from './auth';
import { loadResult, runGrader, refreshRemoteCommit } from './grader';

import {
  checkReadiness,
  compareCommits,
  guidedDelivery,
  loadComparisonFiles,
  reproduce,
} from './delivery';
import {
  cloneProject,
  loadSubject,
  openCurrentProject,
  openFolder,
  openProject,
  pickSubject,
} from './projects';

const PANEL_TABS: PanelTab[] = [
  'overview',
  'grader',
  'valgrind',
  'history',
  'subject',
  'activities',
];

export async function handleMessage(
  c: Controller,
  surface: Surface,
  m: WebviewMessage,
): Promise<void> {
  if (!m || typeof m.type !== 'string') return;
  if (
    m.type === 'appeal' ||
    m.type === 'uninstall' ||
    m.type === 'fetchVersion' ||
    m.type === 'reloadVSCode' ||
    m.type === 'refreshVSCode'
  ) {
    return void (await vscode.commands.executeCommand(`epibox.${m.type}`));
  }
  if (m.type === 'setPalette') return c.setPalette(m.palette);
  if (
    !remoteFeatures.status.myApiActive &&
    !['ready', 'refresh'].includes(m.type)
  ) {
    c.pushState(surface);
    return;
  }
  if (
    ![
      'ready',
      'refresh',
      'signIn',
      'signInMicrosoft',
      'signInPaste',
      'submitRedirect',
      'cancelSignIn',
      'signOut',
    ].includes(m.type) &&
    !c.auth.isSignedIn
  ) {
    return;
  }
  if (
    'projectId' in m &&
    m.projectId !== undefined &&
    m.projectId !== null &&
    (!Number.isSafeInteger(m.projectId) || !c.projects.get(m.projectId))
  ) {
    return;
  }

  switch (m.type) {
    case 'ready':
      c.pushState(surface);
      c.post({ type: 'calendar', calendar: c.calendar.snapshot() }, surface);
      if (surface.initialTab) {
        c.post({ type: 'selectTab', tab: surface.initialTab }, surface);
      }
      return;
    case 'signIn':
      return void (await vscode.commands.executeCommand('epibox.signIn'));
    case 'signInMicrosoft':
      return c.signInMicrosoft();
    case 'signInPaste':
      return c.signInMicrosoft({ paste: true });
    case 'submitRedirect':
      return typeof m.url === 'string' ? c.submitRedirect(m.url) : undefined;
    case 'cancelSignIn':
      return c.cancelSignIn();
    case 'signOut':
      return void (await vscode.commands.executeCommand('epibox.signOut'));
    case 'refresh':
      return void (await vscode.commands.executeCommand('epibox.refresh'));
    case 'loadAvatars':
      return c.loadAvatars(m.logins, surface);
    case 'openHome':
      return void c.home?.show();
    case 'openProject':
      return c.openProject(
        m.projectId,
        PANEL_TABS.includes(m.tab as PanelTab) ? m.tab : undefined,
      );
    case 'openCurrentProject':
      return c.openCurrentProject();
    case 'testDefensePopup': {
      const project = c.projects.get(m.projectId);
      if (project) {
        c.updateDefenseReminders();
        c.defenseReminders.testPopup(project.id, project.name);
      }
      return;
    }
    case 'loadActivities':
      await c.activities.load(m.projectId);
      c.pushActivities(m.projectId, surface);
      return;
    case 'switchActivitySlot':
    case 'changeActivitySlot': {
      if (
        c.activityMutations.has(m.projectId) ||
        !Number.isSafeInteger(m.activityId) ||
        !Number.isSafeInteger(m.slotId)
      ) {
        return;
      }
      if (
        m.type === 'changeActivitySlot'
          ? typeof m.cancel !== 'boolean'
          : !Number.isSafeInteger(m.fromSlotId)
      ) {
        return;
      }

      const token = c.auth.accessToken;
      c.activityMutations.add(m.projectId);
      c.pushActivities(m.projectId);
      try {
        await c.activities.changeSlot(
          m.projectId,
          m.activityId,
          m.slotId,
          m.type === 'changeActivitySlot' && m.cancel,
          m.type === 'switchActivitySlot' ? m.fromSlotId : undefined,
        );
      } catch (e) {
        if (token === c.auth.accessToken) c.toast('error', describe(e));
      } finally {
        if (token === c.auth.accessToken) {
          c.activityMutations.delete(m.projectId);
          c.pushActivities(m.projectId);
          c.updateDefenseReminders();
        }
      }
      return;
    }
    case 'loadProject': {
      const project = c.projects.get(m.projectId);
      if (!project) return;
      if (m.peek === true) {
        c.pushGrader(m.projectId, surface);
        void c.grader.peek(project);
        return;
      }

      c.commitProjects.add(project.id);
      void c.refreshCommitStates();
      c.pushGrader(m.projectId, surface);
      c.pushActivities(m.projectId, surface);
      c.pushStyle(m.projectId, surface);
      c.pushDelivery(m.projectId, surface);
      void c.pushValgrind(m.projectId, surface);
      void c.watchLocal(project);
      void c.activities.load(m.projectId);
      void c.projects.resolveResources(m.projectId).then(p => {
        if (p) void c.grader.ensure(p, 60_000);
      });
      return;
    }
    case 'focusProject':
      surface.focus =
        typeof m.projectId === 'number' && Number.isSafeInteger(m.projectId)
          ? m.projectId
          : null;
      return;
    case 'openCommit': {
      if (
        !validCommit(m.commit) ||
        !c.grader.get(m.projectId)?.history.some(
          r => r.commit?.toLowerCase() === m.commit.toLowerCase(),
        )
      ) {
        return;
      }
      const known = c.projects.get(m.projectId);
      const project = known?.repoLink
        ? known
        : await c.projects.resolveResources(m.projectId);
      if (project) {
        await c.commits.open(
          project,
          m.commit,
          c.projects.localPath(project.id),
        );
      }
      return;
    }
    case 'scanStyle': {
      const project = c.projects.get(m.projectId);
      return project
        ? void (await c.locateStyle(project, 'manual'))
        : undefined;
    }
    case 'openFile':
      return c.openProjectFile(m.projectId, m.file, m.line, m.column, m.task);
    case 'addDebugFlag': {
      const project = c.projects.get(m.projectId);
      const root = project && await c.localRoot(project);
      if (
        !project ||
        !root ||
        !c.style.api?.addDebugFlag ||
        c.debugBuilds.has(project.id)
      ) {
        return;
      }
      c.debugBuilds.add(project.id);
      await c.pushValgrind(project.id);
      try {
        const outcome = await c.style.api.addDebugFlag(root);
        const t = createT(config.language());
        if (outcome.ok) {
          c.toast('info', t('valgrind.debugDone'));
        } else if (outcome.detail) {
          c.toast(
            'error',
            t('valgrind.debugFailed', { detail: outcome.detail }),
          );
        }
      } finally {
        c.debugBuilds.delete(project.id);
        await c.pushValgrind(project.id);
      }
      return;
    }
    case 'cancelValgrind': {
      const project = c.projects.get(m.projectId);
      const root = project && await c.localRoot(project);
      if (root) c.style.api?.cancelValgrind?.(root);
      return;
    }
    case 'runValgrind':
    case 'setValgrindCommand': {
      const project = c.projects.get(m.projectId);
      const root = project && await c.localRoot(project);
      if (!project) return;
      if (!root || !c.style.api?.runValgrind) {
        c.toast('warn', createT(config.language())('valgrind.noLocalCopy'));
        return;
      }
      c.valgrindRoots.set(project.id, resolve(root));
      if (m.type === 'runValgrind') {
        await c.style.api.runValgrind(root);
      } else if (
        typeof m.command === 'string' &&
        m.command.length <= 1000
      ) {
        await c.style.api.setValgrindCommand?.(root, m.command);
      }
      return void (await c.pushValgrind(project.id));
    }
    case 'runGrader':
      return void (await c.runGrader(m.projectId));
    case 'checkReadiness':
      return void (await c.checkReadiness(m.projectId));
    case 'setFunctionRules': {
      const t = createT(config.language());
      const names = validateFunctionNames(m.names);
      try {
        if (!names) {
          c.toast('warn', t('functions.invalid'));
          return;
        }
        if (
          c.readiness.get(m.projectId)?.status === 'running' ||
          c.guided.get(m.projectId)?.status === 'running'
        ) {
          c.toast('warn', t('functions.busy'));
          return;
        }
        await c.functionRules.set(c.functionScope(), m.projectId, names);
        c.readiness.invalidateFunctions(m.projectId);
        c.style.api?.refreshProjectRules?.();
      } catch {
        c.toast('error', t('functions.saveError'));
      } finally {
        c.pushDelivery(m.projectId);
      }
      return;
    }
    case 'setFunctionCheck': {
      if (
        c.readiness.get(m.projectId)?.status === 'running' ||
        c.guided.get(m.projectId)?.status === 'running'
      ) {
        c.toast('warn', createT(config.language())('functions.busy'));
        c.pushDelivery(m.projectId);
        return;
      }
      await c.functionRules.setDisabled(
        c.functionScope(),
        m.projectId,
        !m.enabled,
      );
      c.readiness.invalidateFunctions(m.projectId);
      c.style.api?.refreshProjectRules?.();
      c.pushDelivery(m.projectId);
      return;
    }
    case 'loadCalendar':
      return c.calendar.load(m.from, m.to, m.force === true);
    case 'calendarSlots': {
      const event = c.calendar.snapshot().events?.find(e => e.id === m.eventId);
      if (!event?.slots) return;
      try {
        c.post(
          {
            type: 'calendarSlots',
            eventId: event.id,
            slots: await c.calendar.slots(event),
          },
          surface,
        );
      } catch (e) {
        c.post(
          {
            type: 'calendarSlots',
            eventId: event.id,
            slots: [],
            error: (e as Error).message,
          },
          surface,
        );
      }
      return;
    }
    case 'calendarPeople': {
      const event = c.calendar.snapshot().events?.find(e => e.id === m.eventId);
      if (!event || event.slots) return;
      try {
        c.post(
          {
            type: 'calendarPeople',
            eventId: event.id,
            ...await c.calendar.people(event),
          },
          surface,
        );
      } catch (e) {
        c.post(
          {
            type: 'calendarPeople',
            eventId: event.id,
            people: [],
            missing: null,
            error: (e as Error).message,
          },
          surface,
        );
      }
      return;
    }
    case 'calendarRegister':
      try {
        await c.calendar.register(m.eventId, m.slotId);
      } catch (e) {
        c.toast('error', (e as Error).message);
      }
      return;
    case 'calendarUnregister':
      try {
        await c.calendar.unregister(m.eventId);
      } catch (e) {
        c.toast('error', (e as Error).message);
      }
      return;
    case 'setCalendarPrefs':
      try {
        await c.calendar.setPrefs(m.prefs);
      } catch (e) {
        c.toast('error', (e as Error).message);
      }
      return;
    case 'readSubjectFunctions': {
      const project = c.projects.get(m.projectId);
      if (!project) return;
      const vm = await c.subjectFunctions.ensure(
        c.functionScope(),
        project,
        true,
      );
      c.readiness.invalidateFunctions(m.projectId);
      if (vm.status === 'error') {
        c.toast('warn', createT(config.language())('functions.readError'));
      }
      return;
    }
    case 'setGraderCommand': {
      const t = createT(config.language());
      let error: string | undefined;
      try {
        if (
          c.readiness.get(m.projectId)?.status === 'running' ||
          c.guided.get(m.projectId)?.status === 'running'
        ) {
          throw new Error('busy');
        }
        await c.graderCommand.set(c.functionScope(), m.projectId, m.command);
        c.readiness.invalidate(m.projectId);
      } catch {
        error = t('command.invalid');
      }
      c.post({
        type: 'graderCommand',
        projectId: m.projectId,
        command: c.graderCommand.get(c.functionScope(), m.projectId),
        error,
      });
      return;
    }
    case 'loadComparisonFiles':
      return c.loadComparisonFiles(surface, m.projectId, m.before, m.after);
    case 'refreshRemoteCommit':
      return c.refreshRemoteCommit(m.projectId, true);
    case 'configureChecks': {
      const p = c.projects.get(m.projectId);
      const root = p && await c.localRoot(p);
      if (root) {
        await configureChecks(
          root,
          createT(config.language()),
          m.advanced === true,
        );
        c.readiness.invalidate(m.projectId);
      }
      return;
    }
    case 'cancelLocal':
      c.readiness.cancel(m.projectId);
      c.reproduction.cancel(m.projectId);
      c.guided.pause(m.projectId);
      return;
    case 'guidedDelivery':
      return c.guidedDelivery(m.projectId);
    case 'reviewChanges': {
      const p = c.projects.get(m.projectId);
      const root = p && await c.localRoot(p);
      if (root) {
        await c.showChanges(
          root,
          undefined,
          undefined,
          c.readiness.get(m.projectId)?.generatedOutputs ?? [],
        );
      }
      return;
    }
    case 'compareCommits':
      return c.compareCommits(m.projectId, m.before, m.after);
    case 'reproduce':
      return c.reproduce(m.projectId, m.resultId, m.task, m.configure === true);
    case 'loadResult':
      return c.loadResult(surface, m.projectId, m.resultId);
    case 'cloneProject':
      return c.cloneProject(m.projectId);
    case 'openFolder':
      return c.openFolder(m.projectId);
    case 'loadSubject':
      return c.loadSubject(
        surface,
        m.projectId,
        typeof m.docId === 'string' ? m.docId : undefined,
      );
    case 'openSubject': {
      const project = c.projects.get(m.projectId);
      if (!project) return;
      if (m.target === 'editor') {
        c.panels.show(project.id, project.name, 'subject');
      } else if (m.target === 'browser') {
        await c.subject.openInBrowser(project);
      } else if (m.target === 'desktop') {
        await c.subject.openOnComputer(project);
      } else if (m.target === 'binaries') {
        await c.subject.downloadBinaries(project);
      }
      return;
    }
    case 'pickSubject':
      return c.pickSubject(surface, m.projectId);
    case 'openExternal':
      if (typeof m.url === 'string' && /^https?:\/\//i.test(m.url)) {
        await vscode.env.openExternal(vscode.Uri.parse(m.url));
      }
      return;
    case 'copy':
      if (typeof m.text !== 'string') return;
      await vscode.env.clipboard.writeText(m.text);
      c.toast('info', m.what ? `${m.what} copied` : 'Copied');
      return;
  }
}

export async function loadAvatars(
  c: Controller,
  logins: unknown,
  surface: Surface,
): Promise<void> {
  if (!Array.isArray(logins)) return;
  const wanted = [...new Set(logins.filter(validAvatarLogin))].slice(0, 50);
  if (!wanted.length) return;

  const cached = await c.avatars.cached(wanted);
  if (Object.keys(cached).length) {
    c.post({ type: 'avatars', avatars: cached }, surface);
  }

  const token = c.auth.accessToken;
  let batch: Record<string, string | null> = {};
  let timer: NodeJS.Timeout | undefined;
  const flush = () => {
    timer = undefined;
    if (token === c.auth.accessToken && Object.keys(batch).length) {
      c.post({ type: 'avatars', avatars: batch });
    }
    batch = {};
  };
  await Promise.all(
    (await c.avatars.due(wanted)).map(async login => {
      const value = await c.avatars.get(login);
      if (cached[login] === value) return;
      batch[login] = value;
      timer ??= setTimeout(flush, 120);
    }),
  );
}

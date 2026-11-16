import { enterPart } from '../motion';
import { h, icon } from '../dom';
import { separateGradesEligible } from '../../domain/projects';
import type { Ctx, Tab } from '../ctx';
import type { ProjectVM } from '../../shared/types';
import { dateTime } from '../format';
import { renderGrader } from './grader';
import { renderHistory } from './history';
import { renderMarkdown } from './markdown';
import { statusBadge } from './list';
import { renderSubject } from './subject';
import { renderValgrind } from './valgrind';
import { renderActivities } from './activities';
import { renderReadout } from './readout';
import { renderSummary, sidebarNav, pageHead } from './summary';
import { renderDock } from './dock';
import { projectMidpoint } from '../../domain/activities';
import { chip, menu, notice, tabs, type MenuItem } from '../ui';
import { personTag } from '../avatars';

export function renderProject(ctx: Ctx, p: ProjectVM): HTMLElement {
  if (ctx.surface === 'sidebar') return renderSidebarProject(ctx, p);
  const { t, ui } = ctx;
  const isCurrent = p.id === ctx.state.currentProjectId;
  const tab: Tab = ui.tab ?? (p.registered && p.repoEnabled ? 'grader' : 'details');
  const root = h('div.detail', { dataset: { project: String(p.id) } });

  root.append(header(ctx, p, isCurrent), renderReadout(ctx, p));
  const separate = separateNotice(ctx, p);
  if (separate) root.append(separate);

  const runs = ctx.graders.get(p.id)?.history.length ?? 0;
  root.append(tabs<Tab>([
    { id: 'grader', label: t('tab.grader') },
    { id: 'valgrind', label: t('tab.valgrind'), count: ctx.valgrind?.get(p.id)?.run?.leaks.length ?? 0 },
    { id: 'history', label: t('tab.history'), count: runs },
    { id: 'subject', label: t('tab.subject') },
    { id: 'activities', label: t('tab.activities'), count: ctx.activities.get(p.id)?.length ?? 0 },
    { id: 'details', label: t('tab.details') },
  ], tab, id => { ui.tab = id; ctx.rerender(); }, t('tab.label')));
  root.append(enterPart(h('div.tab-body', { role: 'tabpanel', 'aria-label': t(`tab.${tab}`) }, tabBody(ctx, p, tab)), `tab-${p.id}`, tab));
  return root;
}

/**
 * Sidebar: an app of its own. No page chosen is the summary; a chosen page is pushed over it with a way back.
 * The loop dock stays pinned under both.
 */
function renderSidebarProject(ctx: Ctx, p: ProjectVM): HTMLElement {
  const page = ctx.ui.tab;
  const root = h('div.detail.sb-app', { class: page ? 'sb-pushed' : 'sb-summary', dataset: { project: String(p.id) } });
  root.append(sidebarNav(ctx, p, page));
  if (!page) {
    root.append(...renderSummary(ctx, p));
    const separate = separateNotice(ctx, p);
    if (separate) root.append(separate);
  } else {
    root.append(pageHead(ctx, p, page), h('div.tab-body.sb-page.rise', { role: 'region', 'aria-label': ctx.t(`tab.${page}`), style: { '--i': '1' } }, tabBody(ctx, p, page)));
  }
  const dock = renderDock(ctx, p);
  if (dock) root.append(dock);
  return root;
}

function separateNotice(ctx: Ctx, p: ProjectVM): HTMLElement | null {
  if (!separateGradesEligible(p)) return null;
  return notice('accent', 'organization',
    h('span', ctx.t('group.separateEligible')),
    h('button.btn.small', { onclick: () => ctx.post({ type: 'openExternal', url: 'https://teams.microsoft.com/' }) }, icon('link-external'), ctx.t('group.requestSeparate')));
}

function tabBody(ctx: Ctx, p: ProjectVM, tab: Tab): HTMLElement {
  if (tab === 'subject' && !ctx.subjects.has(p.id)) {
    ctx.subjects.set(p.id, { status: 'loading' });
    ctx.post({ type: 'loadSubject', projectId: p.id });
  }
  return tab === 'grader' ? renderGrader(ctx, p) : tab === 'valgrind' ? renderValgrind(ctx, p) : tab === 'history' ? renderHistory(ctx, p) : tab === 'activities' ? renderActivities(ctx, p) : tab === 'subject' ? renderSubject(ctx, p) : overview(ctx, p);
}

/** Project panel header: breadcrumb, clone/intranet actions and the overflow menu. */
function header(ctx: Ctx, p: ProjectVM, isCurrent: boolean): HTMLElement {
  const { t } = ctx;
  const local = !isCurrent && (ctx.state.localProjects ?? []).includes(p.id);
  const canClone = p.repoEnabled && p.registered && !isCurrent;
  const primary = local ? h('button.btn.primary', { onclick: () => ctx.post({ type: 'openFolder', projectId: p.id }), title: t('action.openFolderHint') }, icon('folder-opened'), t('action.openFolder'))
    : canClone ? h('button.btn.primary', { onclick: () => ctx.post({ type: 'openFolder', projectId: p.id }), title: p.repoLink ?? t('action.cloneUnknown') }, icon('repo-clone'), t('action.cloneOpen')) : null;
  const items: MenuItem[] = [
    ...(p.hermesUrl ? [{ label: t('action.hermes'), icon: 'link-external', onSelect: () => ctx.post({ type: 'openExternal', url: p.hermesUrl! }) }] : []),
    ...(p.repoLink ? [{ label: t('action.copyRepo'), icon: 'copy', onSelect: () => ctx.post({ type: 'copy', text: p.repoLink!, what: t('detail.repoUrl') }) }] : []),
  ];
  return h('header.p-head',
    h('div.p-title',
      h('div.p-crumb', (p.unitCode || p.unitName) && h('span.unit', p.unitCode || p.unitName), (p.unitCode || p.unitName) && h('span.sep', '/'), h('h1', { title: p.name }, p.name)),
      h('div.p-actions', primary, h('button.btn.ghost', { onclick: () => ctx.post({ type: 'openExternal', url: p.intranetUrl }) }, icon('globe'), t('action.intranet')),
        menu(`project-${p.id}`, t('action.more'), items))),
    h('div.p-meta',
      statusBadge(ctx, p.status),
      p.registered ? chip('pass', icon('check'), t('badge.registered')) : chip('', t('badge.notRegistered')),
      isCurrent && h('span.chip.t-accent', { title: t('detail.currentRepo') }, icon('folder-opened'), t('badge.current')),
      p.groupName && h('span', icon('organization'), p.groupName),
      p.unitName && h('span.opt', icon('mortar-board'), p.unitName),
      h('span.opt', `${p.schoolYear} · ${p.instanceCode}`)));
}

function kv(label: string, value: Node | string | null | undefined): HTMLElement | null {
  return value === null || value === undefined || value === '' ? null : h('div.kv', h('span.k', label), h('span.v', value));
}

function group(title: string, ...rows: Array<Node | string | null | false | undefined>): HTMLElement {
  return h('section.section', h('div.section-head', h('h2', title)), h('div.kv-list', ...rows));
}

/** Details tab: schedule, group, unit; the reference data behind the readout. */
function overview(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t, lang } = ctx;
  const mid = projectMidpoint(p, ctx.activities.get(p.id));
  return h('div.details-tab',
    p.description && h('p.page-desc', { style: { marginBottom: '20px' } }, p.description),
    h('div.overview',
      group(t('overview.schedule'),
        kv(t('timeline.open'), dateTime(p.startDate, lang)),
        kv(t('timeline.mid'), mid.date ? `${dateTime(mid.date, lang)} · ${t(`activities.mid.${mid.source}`)}` : t('activities.mid.unknown')),
        p.endRegistrationDate && kv(t('overview.regEnd'), dateTime(p.endRegistrationDate, lang)),
        kv(t('timeline.close'), dateTime(p.endDate, lang))),
      group(t('overview.group'),
        kv(t('overview.registration'), p.registered ? t('badge.registered') : t('badge.notRegistered')),
        kv(t('overview.groupName'), p.groupName),
        p.groupMembers?.length > 0 && kv(t('people.members'), h('div.people', p.groupMembers.map(m => personTag(ctx, m)))),
        kv(t('overview.groupSize'), p.groupSizeMax > 1 ? `${p.groupSizeMin}–${p.groupSizeMax}` : t('overview.solo')),
        kv(t('overview.participants'), p.registrationsCount ? String(p.registrationsCount) : null),
        kv(t('overview.peerEval'), p.peerEvaluation ? t('common.yes') : null)),
      group(t('overview.unit'),
        kv(t('overview.unitName'), p.unitName),
        kv(t('overview.unitCode'), h('code', `${p.unitCode} · ${p.instanceCode}`)),
        p.responsibles?.length > 0 && kv(t('overview.responsibles'), h('div.people', p.responsibles.map(r => personTag(ctx, r))))),
      p.unitDescription && h('details.unit-desc', { dataset: { detailId: 'unit-description' } }, h('summary', icon('chevron-right', 'chev'), t('overview.unitDescription')), renderMarkdown(p.unitDescription, url => ctx.post({ type: 'openExternal', url })))));
}

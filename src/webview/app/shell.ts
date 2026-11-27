import { h, icon } from '../dom';
import type { AppTab, Ctx } from '../ctx';
import { closeSheet, sheet, switchTab } from './kit';
import { renderHomeTab } from './home';
import { renderProjectsTab } from './board';
import { renderProjectSheet } from './projectSheet';
import { renderProjectScreen } from './project';
import { agendaSheet, renderAgendaTab } from './agenda';
import { renderMeTab } from './me';
import { renderAppearance } from '../views/appearance';

/** What the sidebar app draws: the screen (inside the scroller) and the chrome pinned around it. */
export interface AppView {
  /** Route key: `app/<tab>` on a tab root, `p<id>` on a project screen, `split/<tab>/p<id>` for two panes. */
  key: string;
  node: HTMLElement;
  /** Appended to the shell after the scroller: the tab bar and, when open, the project sheet. */
  chrome: HTMLElement[];
}

/** The project whose sheet the last render showed: a sheet animates only when it opens. */
let shownSheet: number | null = null;

/** Two panes from this width (CSS: the tab bar becomes a rail at the same width, see shell.css). */
const WIDE_PX = 600;

const TABS: Array<{ id: AppTab; icon: string }> = [
  { id: 'home', icon: 'home' },
  { id: 'projects', icon: 'project' },
  { id: 'agenda', icon: 'calendar' },
  { id: 'me', icon: 'account' },
];

/** The sidebar as a phone app: four tabs, a project screen pushed over Projects or Home, a quick sheet over anything. */
export function renderApp(ctx: Ctx): AppView {
  const ui = ctx.ui;
  const tab = ui.appTab ?? 'projects';
  const project = ui.sidebarProject != null ? ctx.state.projects?.find(p => p.id === ui.sidebarProject) : undefined;
  if (ui.sidebarProject != null && ctx.state.projects && !project) ui.sidebarProject = null;

  const root = (): HTMLElement => tab === 'home' ? renderHomeTab(ctx)
    : tab === 'agenda' ? renderAgendaTab(ctx)
    : tab === 'me' ? renderMeTab(ctx)
    : renderProjectsTab(ctx);

  let node: HTMLElement, key: string, kind: string;
  if (ui.page === 'appearance') {
    node = renderAppearance(ctx); key = 'appearance'; kind = 'appearance';
  } else if (project && document.body.clientWidth >= WIDE_PX && (tab === 'projects' || tab === 'home')) {
    // Wide: the tab root stays on the left, the project opens on the right (no push animation between them).
    node = h('div.app-split', h('div.pane.pane-list', root()), h('div.pane.pane-detail.app-project', renderProjectScreen(ctx, project)));
    key = `split/${tab}/p${project.id}`; kind = 'wide';
  } else if (project && (tab === 'projects' || tab === 'home')) {
    // A pushed project belongs to the Projects and Home stacks: Agenda and Me show their own root over it.
    node = renderProjectScreen(ctx, project); key = `p${project.id}`; kind = 'project';
  } else {
    node = root(); key = `app/${tab}`; kind = tab;
  }

  const chrome: HTMLElement[] = [tabBar(ctx, tab)];
  const sheetProject = ui.sheetProject != null ? ctx.state.projects?.find(p => p.id === ui.sheetProject) : undefined;
  if (sheetProject) {
    chrome.push(sheet({ label: sheetProject.name, closeLabel: ctx.t('action.close'), onClose: () => closeSheet(ctx), enter: shownSheet !== sheetProject.id }, ...renderProjectSheet(ctx, sheetProject)));
  }
  if (tab === 'agenda') chrome.push(...agendaSheet(ctx));
  shownSheet = sheetProject?.id ?? null;
  return { key, node: h('div.app', { class: `app-${kind}` }, node), chrome };
}

function tabBar(ctx: Ctx, current: AppTab): HTMLElement {
  return h('nav.tabbar', { 'aria-label': ctx.t('app.tabs') },
    ...TABS.map(x => h('button.tb', {
      type: 'button', class: x.id === current ? 'on' : '', 'aria-current': x.id === current ? 'page' : undefined,
      'aria-label': ctx.t(`app.tab.${x.id}`), onclick: () => switchTab(ctx, x.id),
    }, icon(x.icon), h('span.tb-label', ctx.t(`app.tab.${x.id}`)))));
}

import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import type { ActivityVM, ActivitySlotVM, ProjectVM } from '../../shared/types';
import { dateTime, timeOnly } from '../format';
import { chip, gut, notice, waitBlock } from '../ui';
import { stackBar } from '../charts';
import { personTag } from '../avatars';

export function renderActivities(ctx: Ctx, project: ProjectVM): HTMLElement {
  const { t } = ctx, id = project.id;
  const activities = ctx.activities.get(id);
  const pending = ctx.activityPending?.has(id) ?? false;
  const limits = ctx.activityLimits?.get(id);
  const refreshDisabled = pending || !!limits?.rateLimited || Date.now() < (limits?.refreshAfter ?? 0);
  const root = h('div.activities-page',
    h('div.activities-heading', h('h2', t('activities.title')),
      h('div.activity-header-actions',
        h('button.btn.small', { disabled: refreshDisabled, title: t('activities.refreshCooldown'), onclick: () => {
          if (refreshDisabled || ctx.activityPending?.has(id)) return;
          (ctx.activityPending ??= new Set()).add(id); ctx.post({ type: 'loadActivities', projectId: id }); ctx.rerender();
        } }, icon('refresh'), t('action.refresh')),
        h('button.btn.small.activity-test-popup', { title: t('activities.testPopupHint'), onclick: () => ctx.post({ type: 'testDefensePopup', projectId: id }) }, icon('bell'), t('activities.testPopup')))));
  if (ctx.activityErrors.has(id)) root.append(h('div.notice.error', { role: 'alert' }, icon('error'), h('div', ctx.activityErrors.get(id))));
  if (!activities) { root.append(waitBlock(t('activities.loading'))); return root; }
  if (!activities.length) { root.append(h('div.empty', icon('calendar'), h('p', t('activities.empty')))); return root; }
  const booked = activities.flatMap(a => (a.slots ?? []).filter(s => s.mine && Date.parse(s.startDate) > Date.now()).map(s => ({ a, s })))
    .sort((a, b) => Date.parse(a.s.startDate) - Date.parse(b.s.startDate));
  if (booked[0]) {
    const { a, s } = booked[0];
    root.append(h('section.activity-next', { 'aria-label': t('activities.next') }, icon('bell'),
      h('div', h('strong', a.name), ' · ', h('span.when', dateTime(s.startDate, ctx.lang))),
      h('div.sub', [a.location, t('activities.reminders')].filter(Boolean).join(' · '))));
  }
  root.append(h('div.activity-cards', activities.map(a => activityCard(ctx, project, a, pending))));
  return root;
}

function activityCard(ctx: Ctx, project: ProjectVM, a: ActivityVM, pending: boolean): HTMLElement {
  const { t, lang } = ctx, now = Date.now(), slots = a.slots ?? [];
  const mine = slots.find(s => s.mine), ended = Date.parse(a.endDate) <= now;
  const registered = !!mine || a.status === 'registered';
  const card = h('section.activity-card', { class: ended ? 'activity-ended' : '', 'aria-label': a.name },
    h('div.activity-title', icon(a.kind === 'kickoff' ? 'rocket' : a.kind === 'bootstrap' ? 'tools' : 'calendar', 'ic-muted'), h('h3', a.name),
      chip(registered ? 'pass' : '', registered ? t('activities.registered') : t('activities.notRegistered')),
      a.mandatory && chip('warn', t('activities.mandatory')), ended && chip('', t('activities.ended'))),
    h('div.activity-summary',
      h('span.mono', `${dateTime(a.startDate, lang)} → ${dateTime(a.endDate, lang)}`),
      a.location && h('span', icon('location'), a.location),
      a.registrationDeadline && h('span', `${t('activities.registration')} · ${dateTime(a.registrationDeadline, lang)}`),
      a.hasDocuments && h('button.btn.ghost.small', { onclick: () => ctx.post({ type: 'openExternal', url: activityUrl(project, a) }) }, icon('file'), t('activities.documents'))),
    mine && h('div.activity-booking', icon('check'), h('strong', t('activities.yourSlot')), h('span.mono', `${dateTime(mine.startDate, lang)} → ${timeOnly(mine.endDate, lang)}`)));
  if (a.slotsError) card.append(notice('warn', 'warning', h('span', t('activities.slotsError')), h('span.small', a.slotsError),
    h('button.btn.small', { onclick: () => ctx.post({ type: 'loadActivities', projectId: project.id }), disabled: pending }, t('action.retry'))));
  if (slots.length) {
    const filter = ctx.ui.activityFilters?.[a.id] ?? 'all';
    const query = ctx.ui.activitySearch?.[a.id] ?? '';
    const shown = slots.filter(s => (filter === 'all' || filter === 'mine' && s.mine || filter === 'available' && s.available && Date.parse(s.startDate) > now)
      && (!query || `${s.groupName ?? ''} ${s.members.map(p => `${p.name} ${p.login}`).join(' ')}`.toLowerCase().includes(query.toLowerCase())));
    const free = slots.filter(s => s.available && Date.parse(s.startDate) > now).length;
    card.append(h('details.activity-slots', { open: !ended, dataset: { detailId: `activity-${a.id}` } },
      h('summary', icon('chevron-right', 'chev'), t('activities.slotsAndGroups'), h('span.counter', free), h('span', t('activities.available')),
        h('span.slot-load', stackBar([
          { value: slots.filter(s => s.mine).length, tone: 'pass', label: t('activities.mine') },
          { value: slots.filter(s => !s.mine && !s.available).length, tone: 'warn', label: t('activities.booked') },
          { value: free, tone: 'free', label: t('activities.available') },
        ], t('activities.occupancy', { booked: slots.filter(s => !s.available || s.mine).length, total: slots.length })))),
      h('div.slot-tools',
        h('div.seg', { role: 'group', 'aria-label': t('activities.slotsAndGroups') }, (['all', 'available', 'mine'] as const).map(f => h('button.filter', { class: f === filter ? 'active' : '', 'aria-pressed': String(f === filter), onclick: () => {
          (ctx.ui.activityFilters ??= {})[a.id] = f; ctx.rerender();
        } }, t(`activities.filter.${f}`)))),
        h('div.searchbar.small', icon('search'), h('input.search', { type: 'search', value: query, placeholder: t('activities.searchGroups'), 'aria-label': t('activities.searchGroups'), dataset: { keep: `activity-search-${a.id}` }, oninput: (e: Event) => {
          (ctx.ui.activitySearch ??= {})[a.id] = (e.target as HTMLInputElement).value; ctx.rerender();
        } }))),
      h('div.slot-list.g-list', shown.map(s => slotRow(ctx, project, a, s, mine, pending))),
      !shown.length && h('p.muted.small', t('list.noMatch'))));
  } else if (!a.slotsError) {
    card.append(h('div.activity-fallback', h('span', t('activities.noSlots')),
      h('button.btn.small', { onclick: () => ctx.post({ type: 'openExternal', url: activityUrl(project, a) }) }, icon('link-external'), t('activities.manageIntranet'))));
  }
  return card;
}

function activityUrl(project: ProjectVM, a: ActivityVM): string {
  return `${project.intranetUrl.replace(/\/projects\/\d+$/, '')}/activities/${a.id}`;
}

function slotRow(ctx: Ctx, project: ProjectVM, a: ActivityVM, s: ActivitySlotVM, mine: ActivitySlotVM | undefined, pending: boolean): HTMLElement {
  const { t, lang } = ctx, past = Date.parse(s.startDate) <= Date.now();
  const limits = ctx.activityLimits?.get(project.id);
  const locked = pending || !!limits?.rateLimited || Date.now() < (limits?.changeAfter ?? 0);
  const switching = !!mine && !s.mine;
  const row = h('div.g-row.slot-row', { class: s.mine ? 'is-mine' : '' },
    gut(null, s.mine ? 'pass' : ''),
    h('div',
      h('div.slot-time', h('strong', dateTime(s.startDate, lang)), h('span.muted', `→ ${timeOnly(s.endDate, lang)}`), s.room && h('span.muted', icon('location'), s.room)),
      h('div.slot-group', chip(s.mine ? 'pass' : '', t(s.mine ? 'activities.yourGroup' : s.available ? 'activities.available' : 'activities.booked')),
        s.groupName && h('strong.small', s.groupName),
        s.members.length > 0 && h('div.people.small', s.members.map(p => personTag(ctx, p, 18))))));
  if (!past && (s.mine || s.available) && (!switching || Date.parse(mine!.startDate) > Date.now())) {
    const action = h('div.slot-action');
    const button = () => h('button.btn.small', { class: s.mine ? '' : 'primary', disabled: locked, title: locked ? t('activities.changeCooldown') : undefined, onclick: () => {
      if (locked || ctx.activityPending?.has(project.id)) return;
      const confirmation = h('button.btn.small.primary', { onclick: () => {
        if (ctx.activityPending?.has(project.id)) return;
        confirmation.disabled = true;
        (ctx.activityPending ??= new Set()).add(project.id);
        if (switching) ctx.post({ type: 'switchActivitySlot', projectId: project.id, activityId: a.id, fromSlotId: mine!.id, slotId: s.id });
        else ctx.post({ type: 'changeActivitySlot', projectId: project.id, activityId: a.id, slotId: s.id, cancel: s.mine });
        ctx.rerender();
      } }, t('activities.confirm'));
      action.replaceChildren(h('div.slot-confirmation', h('span.small', switching
        ? t('activities.confirmSwitch', { from: dateTime(mine!.startDate, lang), to: dateTime(s.startDate, lang) })
        : t(s.mine ? 'activities.confirmCancel' : 'activities.confirmBook')),
        switching && h('span.muted.small', t('activities.switchRisk')),
        h('div.actions', h('button.btn.small.ghost', { onclick: () => action.replaceChildren(button()) }, t('activities.keep')), confirmation)));
    } }, pending ? t('activities.saving') : t(s.mine ? 'activities.cancel' : switching ? 'activities.switchTimeSlot' : 'activities.book'));
    action.append(button()); row.append(action);
  }
  return row;
}

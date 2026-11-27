import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import type { CalendarEventVM } from '../../shared/types';
import { canRegister, isoDay, overlapGroups, weekStart } from '../../domain/calendar';
import { chip, notice } from '../ui';
import { addDays, detail, ensureLoaded, parseDay, renderSettings, state, timeOnly, view } from '../views/calendar';
import { appBar, emptyState, iconAction, sheet } from './kit';

/** Horizontal distance that turns a swipe on the week strip into a week change. */
const SWIPE_PX = 48;
/** Free time between sessions shows as space: this many pixels per hour, up to the cap. */
const GAP_PX_PER_HOUR = 16, GAP_MAX_PX = 128;
let swipeX = 0;

/** Agenda tab: the week strip, the selected day as a list of sessions, and the registration sheets. Same data and messages as the calendar view. */
export function renderAgendaTab(ctx: Ctx): HTMLElement {
  const { t, lang } = ctx, v = view(ctx), cal = ctx.calendar;
  ensureLoaded(ctx, v);
  const anchor = parseDay(v.date), monday = weekStart(anchor), today = isoDay(new Date());
  const events = cal?.events ?? null;
  const go = (date: Date) => { v.date = isoDay(date); v.open = null; v.confirm = null; ctx.rerender(); };
  const refresh = () => {
    ctx.calendarRequested = undefined;
    ctx.post({ type: 'loadCalendar', from: isoDay(monday), to: isoDay(addDays(monday, 6)), force: true });
  };
  // The badge sits over the selected day's list: it counts that day, not the whole loaded week.
  const todo = events?.filter(e => e.required && canRegister(e) && isoDay(new Date(e.start)) === v.date).length ?? 0;
  const dayHas = (d: Date) => !!events?.some(e => isoDay(new Date(e.start)) === isoDay(d));
  const dayTodo = (d: Date) => !!events?.some(e => e.required && canRegister(e) && isoDay(new Date(e.start)) === isoDay(d));

  const bar = appBar({ title: t('app.tab.agenda'), large: true, actions: [
    iconAction(t('calendar.today'), 'target', () => go(new Date()), { disabled: v.date === today }),
    iconAction(t('action.refresh'), cal?.loading ? 'loading' : 'refresh', refresh, { disabled: !!cal?.loading }),
    iconAction(t('calendar.automation'), 'settings-gear', () => { v.settings = true; ctx.rerender(); }),
  ] });

  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const fmt = (d: Date) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(d);
  const strip = h('div.ag-week',
    { onpointerdown: (e: PointerEvent) => { swipeX = e.clientX; },
      onpointerup: (e: PointerEvent) => { const dx = e.clientX - swipeX; if (Math.abs(dx) > SWIPE_PX) go(addDays(anchor, dx < 0 ? 7 : -7)); } },
    h('div.ag-nav',
      iconAction(t('calendar.previous'), 'chevron-left', () => go(addDays(anchor, -7))),
      h('span.ag-range', `${fmt(monday)} – ${fmt(addDays(monday, 6))}`),
      iconAction(t('calendar.next'), 'chevron-right', () => go(addDays(anchor, 7)))),
    h('div.ag-days', { role: 'group', 'aria-label': t('calendar.view') }, days.map(d => {
      const iso = isoDay(d), on = iso === v.date, isToday = iso === today;
      return h('button.ag-day', {
        type: 'button', class: `${on ? 'on' : ''} ${isToday ? 'today' : ''}`, 'aria-pressed': String(on),
        'aria-label': new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(d),
        'aria-current': isToday ? 'date' : undefined, onclick: () => go(d),
      },
        h('span.ag-day-w', new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(d)),
        h('span.ag-day-w1', new Intl.DateTimeFormat(lang, { weekday: 'narrow' }).format(d)),
        h('span.ag-day-n', String(d.getDate())),
        h('span.ag-day-dot', { class: dayTodo(d) ? 'has todo' : dayHas(d) ? 'has' : '', 'aria-hidden': 'true' }));
    })));

  const body: Array<HTMLElement | null> = [];
  if (events) {
    body.push(h('div.ag-summary',
      todo ? chip('fail', icon('error'), t('calendar.todoCount', { n: todo })) : chip('pass', icon('pass-filled'), t('calendar.allSet')),
      cal!.prefs.autoRegister || cal!.prefs.preferences.length ? chip('accent', icon('zap'), t('calendar.autoOn')) : null));
    const list = events.filter(e => isoDay(new Date(e.start)) === v.date).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    body.push(list.length ? h('div.ag-list', overlapGroups(list).flatMap((g, i, all) => {
      const row = g.items.length > 1
        ? h('div.ag-row', h('span.ag-time.mono', timeOnly(g.items[0].start, lang), h('span', timeOnly(new Date(g.end).toISOString(), lang))),
          h('div.ag-lanes', g.items.map(e => eventCard(ctx, e, true))))
        : eventRow(ctx, g.items[0]);
      return i ? [freeGap(Date.parse(g.items[0].start) - all[i - 1].end), row] : [row];
    })) : emptyState('calendar', t('calendar.emptyDay')));
  } else if (cal?.error) {
    body.push(notice('error', 'error', h('span', t('calendar.loadError')), h('span.small', cal.error),
      h('button.btn.small', { type: 'button', onclick: refresh }, icon('refresh'), t('action.retry'))));
  } else {
    body.push(h('div.ag-skel', { role: 'status', 'aria-label': t('calendar.loading') },
      ...[0, 1, 2].map(() => h('div.ag-skel-row', h('span.sk.w60'), h('span.ag-skel-card', h('span.sk.w80'), h('span.sk.w60'))))));
  }

  return h('div.agenda-tab', bar, strip, ...body);
}

/** Space between two runs of sessions, proportional to the free time, labelled when it is half an hour or more. */
function freeGap(ms: number): HTMLElement {
  const min = Math.round(ms / 60_000);
  const label = min >= 30 ? `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`.replace(/^0h(\d+)$/, '$1 min') : null;
  return h('div.ag-gap', { style: `height:${Math.min(GAP_MAX_PX, (min / 60) * GAP_PX_PER_HOUR)}px`, 'aria-hidden': 'true' }, label && h('span.mono', label));
}

/** One session of the selected day: its time on the left, a card with the status, the place and the unit. */
function eventRow(ctx: Ctx, e: CalendarEventVM): HTMLElement {
  return h('div.ag-row', h('span.ag-time.mono', timeOnly(e.start, ctx.lang), h('span', timeOnly(e.end, ctx.lang))), eventCard(ctx, e, false));
}

/** A session's card; side by side with overlapping ones, it carries its own times. */
function eventCard(ctx: Ctx, e: CalendarEventVM, withTime: boolean): HTMLElement {
  const { t, lang } = ctx, v = view(ctx), s = state(e);
  const past = Date.parse(e.end) < Date.now();
  const place = [e.room, e.unitName || e.unitCode].filter(Boolean).join(' · ');
  return h('button.ag-card', {
      type: 'button', class: `is-${s.tone || 'plain'}${past ? ' past' : ''}${v.open === e.id ? ' open' : ''}`, 'aria-haspopup': 'dialog',
      'aria-label': `${e.title} · ${timeOnly(e.start, lang)}–${timeOnly(e.end, lang)} · ${t(s.key)}`,
      onclick: () => { v.open = e.id; v.confirm = null; ctx.rerender(); },
    },
      h('span.ag-card-head', icon(s.glyph), h('strong', e.title)),
      withTime ? h('span.ag-card-meta.mono', `${timeOnly(e.start, lang)}–${timeOnly(e.end, lang)}`) : null,
      place ? h('span.ag-card-meta', place) : null,
      h('span.ag-card-foot', chip(s.tone, t(s.key)), e.full ? chip('warn', t('calendar.full')) : null,
        e.mySlot ? h('span.ag-card-meta.mono', icon('clock'), timeOnly(e.mySlot.start, lang)) : null));
}

/** The sheets over the agenda: the automation settings, or the session the student tapped (its facts and actions). */
export function agendaSheet(ctx: Ctx): HTMLElement[] {
  const v = ctx.ui.calendar, cal = ctx.calendar;
  if (!v || !cal?.events) return [];
  if (v.settings) return [h('div.ag', renderSettings(ctx, cal.prefs, cal.events, cal.log))];
  const e = v.open != null ? cal.events.find(x => x.id === v.open) : undefined;
  if (!e) return [];
  const close = () => { v.open = null; v.confirm = null; ctx.rerender(); };
  return [sheet({ label: e.title, closeLabel: ctx.t('action.close'), onClose: close }, h('div.ag', detail(ctx, e)))];
}

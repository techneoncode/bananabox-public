import type { Ctx } from '../ctx';
import { h, icon } from '../dom';
import { personTag } from '../avatars';
import { chip, notice, waitBlock, waitLine, type Tone } from '../ui';
import { autoPlan, canRegister, isoDay, weekStart, type AutoPlanItem } from '../../domain/calendar';
import { enterPart } from '../motion';
import type { CalendarEventVM, CalendarPrefs, SlotPreference } from '../../shared/types';

const DAY = 86_400_000;
const HOUR_PX = 40;

type View = NonNullable<Ctx['ui']['calendar']>;
const view = (ctx: Ctx): View => ctx.ui.calendar ??= { mode: 'day', date: isoDay(new Date()), open: null, confirm: null };
const parseDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Slot times as the timetable shows them: 24h mono, the same in both languages. */
const timeOnly = (iso: string, lang: string) => new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/** What a session means for the student: drives colour, icon and label together (never colour alone). */
function state(e: CalendarEventVM): { tone: Tone; glyph: string; key: string } {
  if (e.registered) return { tone: 'pass', glyph: 'pass-filled', key: 'calendar.registered' };
  if (e.alternative) return { tone: 'muted', glyph: 'circle-slash', key: 'calendar.alternative' };
  if (e.required) return Date.parse(e.end) < Date.now() ? { tone: 'muted', glyph: 'history', key: 'calendar.missed' } : { tone: 'fail', glyph: 'error', key: 'calendar.toRegister' };
  return { tone: '', glyph: 'circle-large-outline', key: 'calendar.optional' };
}

/** Asks the host for the week holding the shown day, when it is not the loaded one. */
function ensureLoaded(ctx: Ctx, v: View): void {
  const from = isoDay(weekStart(parseDay(v.date))), to = isoDay(addDays(parseDay(from), 6));
  const cal = ctx.calendar;
  if (cal && cal.from === from && cal.to === to && (cal.events || cal.loading || cal.error)) return;
  if (ctx.calendarRequested === `${from}|${to}`) return;
  ctx.calendarRequested = `${from}|${to}`;
  ctx.post({ type: 'loadCalendar', from, to });
}

export function renderCalendar(ctx: Ctx): HTMLElement {
  const { t, lang } = ctx, v = view(ctx), cal = ctx.calendar;
  ensureLoaded(ctx, v);
  const anchor = parseDay(v.date), monday = weekStart(anchor);
  const go = (date: Date) => { v.date = isoDay(date); v.open = null; v.confirm = null; ctx.rerender(); };
  const step = v.mode === 'day' ? 1 : 7;
  const today = isoDay(new Date());
  const range = v.mode === 'day'
    ? new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(anchor)
    : `${new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(monday)} – ${new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(addDays(monday, 6))}`;

  const events = cal?.events ?? [];
  const todo = events.filter(e => e.required && canRegister(e)).length;
  const head = h('div.cal-head',
    h('div.cal-title', h('h2.cal-range', { 'aria-live': 'polite' }, range), h('span.spacer'),
      h('button.icon-btn', { type: 'button', title: t('action.refresh'), 'aria-label': t('action.refresh'), disabled: !!cal?.loading,
        onclick: () => { ctx.calendarRequested = undefined; ctx.post({ type: 'loadCalendar', from: isoDay(monday), to: isoDay(addDays(monday, 6)), force: true }); } },
        icon(cal?.loading ? 'loading' : 'refresh', cal?.loading ? 'spin' : '')),
      h('button.icon-btn', { type: 'button', title: t('calendar.automation'), 'aria-label': t('calendar.automation'), 'aria-pressed': String(!!v.settings),
        class: v.settings ? 'on' : '', onclick: () => { v.settings = !v.settings; ctx.rerender(); } }, icon('settings-gear'))),
    h('div.cal-nav',
      h('button.icon-btn', { type: 'button', title: t('calendar.previous'), 'aria-label': t('calendar.previous'), onclick: () => go(addDays(anchor, -step)) }, icon('chevron-left')),
      h('button.btn.small', { type: 'button', disabled: v.date === today, onclick: () => go(new Date()) }, t('calendar.today')),
      h('button.icon-btn', { type: 'button', title: t('calendar.next'), 'aria-label': t('calendar.next'), onclick: () => go(addDays(anchor, step)) }, icon('chevron-right')),
      h('span.spacer'),
      h('div.seg', { role: 'tablist', 'aria-label': t('calendar.view') }, (['day', 'week'] as const).map(mode =>
        h('button.filter', { type: 'button', role: 'tab', 'aria-selected': String(v.mode === mode), class: v.mode === mode ? 'active' : '',
          onclick: () => { v.mode = mode; ctx.rerender(); } }, t(`calendar.${mode}`))))),
    cal?.events && h('div.cal-summary',
      todo ? chip('fail', icon('error'), t('calendar.todoCount', { n: todo })) : chip('pass', icon('pass-filled'), t('calendar.allSet')),
      cal.prefs.autoRegister || cal.prefs.preferences.length ? chip('accent', icon('zap'), t('calendar.autoOn')) : null));

  const root = h('div.calendar-page', head);
  if (v.settings && cal) root.append(renderSettings(ctx, cal.prefs, events, cal.log));
  if (cal?.error) root.append(notice('error', 'error', h('span', t('calendar.loadError')), h('span.small', cal.error)));
  if (!cal?.events) { root.append(waitBlock(t('calendar.loading'))); return root; }

  // Week: Monday to Friday, plus the weekend days that hold a session.
  const days = v.mode === 'day' ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(monday, i))
    .filter((d, i) => i < 5 || events.some(e => isoDay(new Date(e.start)) === isoDay(d)));
  const shown = events.filter(e => days.some(d => isoDay(d) === isoDay(new Date(e.start))));
  root.append(shown.length ? enterPart(timetable(ctx, shown, days, d => { v.mode = 'day'; go(d); }), 'cal-grid', `${v.mode}|${isoDay(days[0])}`)
    : h('div.empty', icon('calendar'), h('p', t(v.mode === 'day' ? 'calendar.emptyDay' : 'calendar.emptyWeek'))));
  const open = shown.find(e => e.id === v.open);
  if (open) root.append(enterPart(detail(ctx, open), 'cal-detail', String(open.id)));
  return root;
}

/** Sessions placed by time in one column per day, hours down the side; overlaps share their day's width. */
function timetable(ctx: Ctx, events: CalendarEventVM[], days: Date[], openDay: (d: Date) => void): HTMLElement {
  const { t, lang } = ctx, v = view(ctx), n = days.length, gutter = 40;
  const dayIndex = (iso: string) => days.findIndex(d => isoDay(d) === isoDay(new Date(iso)));
  const hourOf = (iso: string) => (Date.parse(iso) - days[Math.max(0, dayIndex(iso))].getTime()) / 3_600_000;
  const first = Math.max(0, Math.min(8, ...events.map(e => Math.floor(hourOf(e.start)))));
  const last = Math.min(24, Math.max(19, ...events.map(e => Math.ceil(hourOf(e.end)))));
  // Per day, each session takes the first free lane of its cluster of overlapping sessions.
  const lane = new Map<number, { col: number; of: number }>();
  for (let d = 0; d < n; d++) {
    const sorted = events.filter(e => dayIndex(e.start) === d).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    let cluster: CalendarEventVM[] = [], ends: number[] = [], clusterEnd = -Infinity;
    const close = () => { const of = Math.max(1, ...cluster.map(e => lane.get(e.id)!.col + 1)); cluster.forEach(e => lane.get(e.id)!.of = of); cluster = []; ends = []; };
    for (const e of sorted) {
      if (Date.parse(e.start) >= clusterEnd) close();
      let col = ends.findIndex(end => end <= Date.parse(e.start));
      if (col < 0) col = ends.length;
      ends[col] = Date.parse(e.end); lane.set(e.id, { col, of: 1 }); cluster.push(e);
      clusterEnd = Math.max(clusterEnd, Date.parse(e.end));
    }
    close();
  }
  const x = (part: number) => `calc(${gutter}px + (100% - ${gutter}px) * ${part})`;
  const today = isoDay(new Date());
  const head = n > 1 && h('div.cal-days', { style: `padding-left:${gutter}px` }, days.map(d => h('button.cal-day-head', {
    type: 'button', class: isoDay(d) === today ? 'today' : '', title: t('calendar.openDay'), onclick: () => openDay(d) },
    h('span', new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(d)), h('strong', String(d.getDate())))));
  const grid = h('div.cal-grid', { class: n > 1 ? 'week' : '', style: `height:${(last - first) * HOUR_PX}px` });
  for (let hr = first; hr < last; hr++) grid.append(h('div.cal-hour', { style: `top:${(hr - first) * HOUR_PX}px` }, h('span', `${String(hr).padStart(2, '0')}:00`)));
  for (let d = 1; d < n; d++) grid.append(h('div.cal-col-line', { style: `left:${x(d / n)}`, 'aria-hidden': 'true' }));
  const todayAt = days.findIndex(d => isoDay(d) === today);
  if (todayAt >= 0) {
    const now = hourOf(new Date().toISOString());
    if (now >= first && now <= last) grid.append(h('div.cal-now', { style: `top:${(now - first) * HOUR_PX}px;left:${x(todayAt / n)};width:calc((100% - ${gutter}px) / ${n})`, 'aria-hidden': 'true' }));
  }
  const order = [...events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (const e of events) {
    const s = state(e), { col, of } = lane.get(e.id)!, d = dayIndex(e.start), i = Math.min(order.indexOf(e), 14);
    const top = (hourOf(e.start) - first) * HOUR_PX, height = Math.max(20, (hourOf(e.end) - hourOf(e.start)) * HOUR_PX - 2);
    grid.append(h('button.cal-ev', {
      type: 'button', class: `${s.tone ? `is-${s.tone}` : ''}${v.open === e.id ? ' open' : ''}`, 'aria-expanded': String(v.open === e.id),
      title: `${e.title} · ${timeOnly(e.start, lang)}–${timeOnly(e.end, lang)}${e.room ? ` · ${e.room}` : ''} · ${t(s.key)}`,
      style: `top:${top}px;height:${height}px;left:${x((d + col / of) / n)};width:calc((100% - ${gutter}px) / ${n * of} - 2px);--i:${i}`,
      onclick: () => { v.open = v.open === e.id ? null : e.id; v.confirm = null; ctx.rerender(); },
    }, h('span.cal-ev-title', icon(s.glyph), h('span.ellipsis', e.title)),
    height > 34 && h('span.cal-ev-meta.ellipsis', `${timeOnly(e.start, lang)}–${timeOnly(e.end, lang)}${e.room ? ` · ${e.room}` : ''}`),
    height > 52 && e.mySlot && h('span.cal-ev-slot', icon('clock'), timeOnly(e.mySlot.start, lang))));
  }
  return h('div.cal-timetable', head, grid);
}

/** A session's facts and its registration: one confirmed click, or a free slot to pick. */
function detail(ctx: Ctx, e: CalendarEventVM): HTMLElement {
  const { t, lang } = ctx, v = view(ctx), s = state(e), cal = ctx.calendar!;
  const busy = cal.pending !== null;
  const open = canRegister(e) && !e.full;
  const facts = h('dl.cal-facts',
    h('dt', t('calendar.when')), h('dd', `${new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(e.start))} · `, h('span.mono', `${timeOnly(e.start, lang)}–${timeOnly(e.end, lang)}`)),
    e.mySlot && [h('dt', t('calendar.yourSlot')), h('dd.mono', `${timeOnly(e.mySlot.start, lang)} – ${timeOnly(e.mySlot.end, lang)}`)],
    e.room && [h('dt', t('calendar.room')), h('dd', e.room)],
    h('dt', t('calendar.unit')), h('dd', h('span.mono', e.unitCode), e.unitName ? ` · ${e.unitName}` : ''),
    e.capacity !== null && [h('dt', t('calendar.seats')), h('dd.mono', `${e.count} / ${e.capacity}`)],
    e.deadline && [h('dt', t('calendar.deadline')), h('dd.mono', `${new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(new Date(e.deadline))} ${timeOnly(e.deadline, lang)}`)],
    e.sessions > 1 && [h('dt', t('calendar.sessions')), h('dd', t('calendar.oneOf', { n: e.sessions }))]);

  let action: HTMLElement | null = null;
  if (cal.pending === e.id) action = waitLine(t('calendar.registering'));
  else if (open && !e.slots) {
    action = v.confirm === `e${e.id}`
      ? h('div.cal-actions', h('button.btn.primary.small', { type: 'button', disabled: busy, onclick: () => { v.confirm = null; ctx.calendarPeople.delete(e.id); ctx.post({ type: 'calendarRegister', eventId: e.id }); } }, icon('check'), t('calendar.confirm')),
        h('button.btn.ghost.small', { type: 'button', onclick: () => { v.confirm = null; ctx.rerender(); } }, t('action.cancel')))
      : h('div.cal-actions', h('button.btn.small', { type: 'button', disabled: busy, onclick: () => { v.confirm = `e${e.id}`; ctx.rerender(); } }, icon('add'), t('calendar.register')));
  } else if (open && e.slots) action = slotPicker(ctx, e);
  else if (e.registered && Date.parse(e.start) > Date.now()) {
    // Leaving gives the place away, maybe for good: always confirmed.
    action = v.confirm === `u${e.id}`
      ? h('div.cal-actions', h('button.btn.danger.small', { type: 'button', disabled: busy, onclick: () => { v.confirm = null; ctx.calendarSlots.delete(e.id); ctx.calendarPeople.delete(e.id); ctx.post({ type: 'calendarUnregister', eventId: e.id }); } },
          icon('close'), t('calendar.confirmLeave')),
        h('button.btn.ghost.small', { type: 'button', onclick: () => { v.confirm = null; ctx.rerender(); } }, t('action.cancel')))
      : h('div.cal-actions', h('button.btn.ghost.small', { type: 'button', disabled: busy, onclick: () => { v.confirm = `u${e.id}`; ctx.rerender(); } }, icon('close'), t('calendar.leave')));
  } else if (!e.registered && !e.alternative && Date.parse(e.start) > Date.now()) action = h('p.muted.small', t(e.full ? 'calendar.full' : 'calendar.closed'));

  return h('div.cal-detail', { role: 'region', 'aria-label': e.title },
    h('div.cal-detail-head', h('strong', e.title), chip(s.tone, icon(s.glyph), t(s.key))), facts, action, e.slots ? slotRoster(ctx, e) : peopleList(ctx, e));
}

/** The session's slots, asked once per opening; null while they load. */
function slotsOf(ctx: Ctx, e: CalendarEventVM) {
  const entry = ctx.calendarSlots.get(e.id);
  if (!entry) {
    ctx.calendarSlots.set(e.id, { loading: true, slots: [] });
    ctx.post({ type: 'calendarSlots', eventId: e.id });
  }
  return entry && !entry.loading ? entry : null;
}

const retry = (ctx: Ctx, error: string, again: () => void) => notice('warn', 'warning', h('span', error),
  h('button.btn.small', { type: 'button', onclick: () => { again(); ctx.rerender(); } }, ctx.t('action.retry')));

/** Who holds each time of a slotted session (a Defense time seats several groups), free places included. */
function slotRoster(ctx: Ctx, e: CalendarEventVM): HTMLElement | null {
  const { t, lang } = ctx, entry = slotsOf(ctx, e);
  if (!entry || entry.error) return null; // the picker above already shows loading and errors
  const times = new Map<string, typeof entry.slots>();
  for (const s of entry.slots) times.set(s.startDate, [...(times.get(s.startDate) ?? []), s]);
  if (!times.size) return null;
  const taken = entry.slots.filter(s => !s.available).length;
  return h('details.cal-people', { open: true },
    h('summary', icon('chevron-right', 'chev'), t('calendar.whoSlots', { n: taken, total: entry.slots.length })),
    h('div.cal-roster', [...times].map(([at, places]) => h('div.cal-roster-row', { class: places.some(p => p.mine) ? 'mine' : '' },
      h('span.cal-roster-time.mono', timeOnly(at, lang)),
      h('div.cal-roster-places', places.map(p => p.available
        ? h('span.cal-place.free', t('calendar.free'))
        : h('span.cal-place', { title: p.groupName ?? '' }, p.members.length
          ? p.members.map(m => personTag(ctx, m, 18))
          : h('span.muted', p.groupName ?? t('calendar.taken')))))))));
}

/** Everyone registered to a session without slots. */
function peopleList(ctx: Ctx, e: CalendarEventVM): HTMLElement {
  const { t } = ctx, entry = ctx.calendarPeople.get(e.id);
  if (!entry) {
    ctx.calendarPeople.set(e.id, { loading: true, people: [] });
    ctx.post({ type: 'calendarPeople', eventId: e.id });
  }
  const missing = entry && !entry.loading && !entry.error ? entry.missing : null;
  const body = !entry || entry.loading ? waitLine(t('calendar.loadingPeople'))
    : entry.error ? retry(ctx, t('calendar.peopleError'), () => ctx.calendarPeople.delete(e.id))
    : !entry.people.length ? h('p.muted.small', t('calendar.nobody'))
    : h('div.people.small.cal-people-list', entry.people.map(p => personTag(ctx, p, 20)));
  return h('div.cal-people-group',
    h('details.cal-people', { open: true },
      h('summary', icon('chevron-right', 'chev'), missing
        ? t('calendar.whoExpected', { n: entry!.people.length, total: entry!.people.length + missing.length, from: t(e.projectId !== null ? 'calendar.fromProject' : 'calendar.fromUnit') })
        : t('calendar.whoList', { n: entry?.people.length ?? e.count })), body),
    missing && missing.length > 0 && h('details.cal-people.cal-missing', { open: true },
      h('summary', icon('chevron-right', 'chev'), icon('error'),
        t(Date.parse(e.start) > Date.now() ? 'calendar.missingSoon' : 'calendar.missingPast', { n: missing.length })),
      h('div.people.small.cal-people-list', missing.map(p => personTag(ctx, p, 20)))),
    missing && missing.length === 0 && h('p.cal-everyone.small', icon('pass-filled'), t('calendar.everyone')));
}

function slotPicker(ctx: Ctx, e: CalendarEventVM): HTMLElement {
  const { t, lang } = ctx, v = view(ctx), entry = slotsOf(ctx, e);
  if (!entry) return waitLine(t('calendar.loadingSlots'));
  if (entry.error) return retry(ctx, entry.error, () => ctx.calendarSlots.delete(e.id));
  // A time is offered once, however many places it has; booking it takes the first place still free.
  const times = new Map<string, number>();
  for (const s of entry.slots) if (s.available && Date.parse(s.startDate) > Date.now()) times.set(s.startDate, (times.get(s.startDate) ?? 0) + 1);
  if (!times.size) return h('p.muted.small', t('calendar.noFreeSlot'));
  const chosen = [...times.keys()].find(at => v.confirm === `s${at}`);
  const book = () => {
    const first = entry.slots.find(s => s.available && s.startDate === chosen);
    if (!first) return;
    v.confirm = null; ctx.calendarSlots.delete(e.id);
    ctx.post({ type: 'calendarRegister', eventId: e.id, slotId: first.id });
  };
  return h('div.cal-slots',
    h('div.cal-slot-grid', { role: 'group', 'aria-label': t('calendar.pickSlot') }, [...times].map(([at, places]) => h('button.cal-slot', {
      type: 'button', class: chosen === at ? 'on' : '', 'aria-pressed': String(chosen === at), title: t('calendar.places', { n: places }),
      onclick: () => { v.confirm = `s${at}`; ctx.rerender(); } }, timeOnly(at, lang), places > 1 && h('span.cal-slot-n', `×${places}`)))),
    chosen && h('div.cal-actions', h('button.btn.primary.small', { type: 'button', disabled: ctx.calendar!.pending !== null, onclick: book },
      icon('check'), t('calendar.bookAt', { time: timeOnly(chosen, lang) })),
    h('button.btn.ghost.small', { type: 'button', onclick: () => { v.confirm = null; ctx.rerender(); } }, t('action.cancel'))));
}

/** Escape closes the sheet whatever holds focus (re-renders may drop focus to the body). */
let sheetCtx: Ctx | null = null;
window.addEventListener('keydown', e => {
  const v = sheetCtx?.ui.calendar;
  if (e.key !== 'Escape' || !v?.settings) return;
  e.preventDefault(); e.stopPropagation();
  v.settings = false; sheetCtx!.rerender();
}, true);

/**
 * Automatic registration, as a sheet over the calendar: the switch, what it will do this week (a live preview from the
 * shown sessions), the preferred slots per kind of session, and what it did lately.
 */
function renderSettings(ctx: Ctx, prefs: CalendarPrefs, events: CalendarEventVM[], log: Array<{ at: number; text: string; ok: boolean }>): HTMLElement {
  const { t, lang } = ctx, v = view(ctx);
  sheetCtx = ctx;
  const close = () => { v.settings = false; ctx.rerender(); };
  const save = (next: CalendarPrefs) => ctx.post({ type: 'setCalendarPrefs', prefs: next });
  const dayName = (d: number, style: 'short' | 'long' = 'short') => new Intl.DateTimeFormat(lang, { weekday: style }).format(new Date(2024, 0, 7 + d));
  const label = (p: SlotPreference) => `${p.day === null ? t('calendar.anyDay') : dayName(p.day)} ${p.time}`;
  const types = [...new Set([...prefs.preferences.map(p => p.type), ...events.filter(e => e.slots).map(e => e.type), 'Defense', 'Midterm Defense', 'Follow-up', 'Review'])];
  const draft = v.prefDraft ??= { type: types[0] ?? 'Defense', day: null, time: '09:00' };
  const edit = (fn: (list: CalendarPrefs['preferences']) => void) => {
    const preferences = prefs.preferences.map(p => ({ ...p, slots: [...p.slots] }));
    fn(preferences);
    save({ ...prefs, preferences: preferences.filter(p => p.slots.length) });
  };
  const radio = <T,>(name: string, items: Array<[T, string]>, current: T, pick: (x: T) => void) =>
    h('div.cal-choices', { role: 'radiogroup', 'aria-label': name }, items.map(([value, text]) => h('button.cal-choice', {
      type: 'button', role: 'radio', 'aria-checked': String(value === current), class: value === current ? 'on' : '',
      onclick: () => { pick(value); ctx.rerender(); } }, text)));

  // What happens to this week's open required sessions.
  const plan = autoPlan(events, prefs);
  const outcome = (item: AutoPlanItem): [Tone, string, string] => item.action === 'register' ? ['pass', 'zap', t('calendar.plan.register')]
    : item.action === 'book' ? ['accent', 'target', t('calendar.plan.book', { slots: item.prefs.slice(0, 2).map(label).join(', ') + (item.prefs.length > 2 ? '…' : '') })]
    : item.action === 'off' ? ['', 'circle-slash', t('calendar.plan.off')] : ['warn', 'person', t('calendar.plan.manual')];
  const preview = h('section.cal-sheet-part',
    h('h3', t('calendar.previewTitle')),
    plan.length ? h('ol.cal-plan', plan.map((item, i) => {
      const [tone, glyph, text] = outcome(item);
      return h('li.cal-plan-row', { style: `--i:${i}` },
        h('span.cal-plan-when.mono', `${dayName(new Date(item.event.start).getDay())} ${timeOnly(item.event.start, lang)}`),
        h('span.cal-plan-what', h('span.ellipsis', item.event.title), h('span.cal-plan-out', { class: tone ? `out-${tone}` : '' }, icon(glyph), text)));
    })) : h('p.cal-sheet-empty', icon('pass-filled'), t('calendar.previewEmpty')));

  const auto = h('button.cal-switch', { type: 'button', role: 'switch', 'aria-checked': String(prefs.autoRegister), 'aria-labelledby': 'cal-auto-label', dataset: { keep: 'cal-auto' },
    onclick: () => save({ ...prefs, autoRegister: !prefs.autoRegister }) }, h('span.cal-switch-knob'));

  const slots = h('section.cal-sheet-part',
    h('h3', t('calendar.preferred')), h('p.cal-sheet-hint', t('calendar.preferredHint')),
    prefs.preferences.length > 0 && h('div.cal-pref-list', prefs.preferences.map((p, pi) => h('div.cal-pref-card',
      h('div.cal-pref-head', h('strong', p.type), h('span.cal-pref-count', String(p.slots.length))),
      h('ol.cal-pref-order', p.slots.map((slot, si) => h('li.cal-pref-chip',
        h('span.cal-pref-rank', String(si + 1)), h('span.mono', label(slot)),
        si > 0 && h('button.icon-btn.small', { type: 'button', title: t('calendar.moveUp'), 'aria-label': `${t('calendar.moveUp')} · ${label(slot)}`,
          onclick: () => edit(list => { const l = list[pi].slots; [l[si - 1], l[si]] = [l[si], l[si - 1]]; }) }, icon('arrow-up')),
        h('button.icon-btn.small', { type: 'button', title: t('calendar.removeSlot'), 'aria-label': `${t('calendar.removeSlot')} · ${label(slot)}`,
          onclick: () => edit(list => { list[pi].slots.splice(si, 1); }) }, icon('close')))))))),
    h('form.cal-composer', { onsubmit: (ev: Event) => {
      ev.preventDefault();
      if (!/^\d{2}:\d{2}$/.test(draft.time)) return;
      edit(list => {
        let entry = list.find(p => p.type.toLowerCase() === draft.type.toLowerCase());
        if (!entry) list.push(entry = { type: draft.type, slots: [] });
        if (!entry.slots.some(s => s.day === draft.day && s.time === draft.time)) entry.slots.push({ day: draft.day, time: draft.time });
      });
    } },
      h('span.cal-composer-label', t('calendar.sessionType')), radio(t('calendar.sessionType'), types.map(x => [x, x] as [string, string]), draft.type, x => { draft.type = x; }),
      h('span.cal-composer-label', t('calendar.day')), radio(t('calendar.day'), [[null, t('calendar.anyDay')], ...[1, 2, 3, 4, 5].map(d => [d, dayName(d)] as [number, string])], draft.day, x => { draft.day = x; }),
      h('div.cal-composer-row',
        h('input.cal-time', { type: 'time', value: draft.time, step: 300, 'aria-label': t('calendar.time'), dataset: { keep: 'cal-time' },
          oninput: (ev: Event) => { draft.time = (ev.target as HTMLInputElement).value; } }),
        h('button.btn.primary.small', { type: 'submit' }, icon('add'), t('calendar.addSlot')))));

  const recent = log.length > 0 && h('section.cal-sheet-part',
    h('h3', t('calendar.recent')),
    h('ul.cal-log', log.slice(0, 6).map(l => h('li', { class: l.ok ? '' : 'bad' }, icon(l.ok ? 'pass-filled' : 'error'), h('span', l.text), h('span.muted.mono', timeOnly(new Date(l.at).toISOString(), lang))))));

  const sheet = h('section.cal-sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cal-sheet-title' },
    h('div.cal-sheet-grab', { 'aria-hidden': 'true' }),
    h('header.cal-sheet-head', h('h2', { id: 'cal-sheet-title' }, icon('zap'), t('calendar.automation')), h('span.spacer'),
      h('button.icon-btn', { type: 'button', title: t('calendar.close'), 'aria-label': t('calendar.close'), dataset: { keep: 'cal-close' }, onclick: close }, icon('close'))),
    h('div.cal-sheet-body',
      h('div.cal-switch-row', { class: prefs.autoRegister ? 'on' : '' },
        h('div', h('strong', { id: 'cal-auto-label' }, t('calendar.autoRegister')), h('p.cal-sheet-hint', t('calendar.autoRegisterHint'))), auto),
      preview, slots, recent));
  return enterPart(h('div.cal-sheet-layer', h('div.cal-sheet-backdrop', { onclick: close }), sheet), 'cal-sheet', 'open');
}

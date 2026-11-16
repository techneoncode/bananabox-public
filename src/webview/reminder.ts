import { h, icon } from './dom';
import { createT, type Lang } from '../shared/i18n';
import { dateTime } from './format';
import type { DefenseAlert } from '../domain/defenseReminders';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const app = document.getElementById('app')!;
let current: { alert: DefenseAlert; nonce: string; lang: Lang } | undefined;
const mac = /Mac/i.test(navigator.platform);
const chord = mac ? '⌘ + ⌥ + ⇧ + Y' : 'Ctrl + Alt + Shift + Y';

function render(): void {
  if (!current) return;
  const { alert, lang } = current, t = createT(lang);
  document.documentElement.lang = lang;
  const urgent = alert.minutes === 15;
  const countdown = h('div.defense-countdown', { role: 'timer', 'aria-live': 'off', 'aria-label': t('defense.countdown') });
  const description = h('p.defense-description', { id: 'defense-description' });
  const update = () => {
    const seconds = Math.max(0, Math.ceil((Date.parse(alert.startDate) - Date.now()) / 1000));
    description.textContent = seconds > 0 ? t('defense.startsIn', { name: alert.activityName, minutes: Math.ceil(seconds / 60) }) : t('defense.startingNow');
    countdown.textContent = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  update();
  const title = h('h1', { id: 'defense-heading' }, t(urgent ? 'defense.goNow' : 'defense.title'));
  const dialog = h('section.defense-dialog', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'defense-heading', 'aria-describedby': 'defense-description', tabindex: -1 },
    h('div.defense-symbol', icon(urgent ? 'warning' : 'bell')),
    title,
    alert.test && h('span.chip.t-accent', t('defense.testReminder')),
    description,
    countdown,
    h('div.defense-event', h('strong', alert.projectName), h('div', alert.activityName), h('div.muted.mono', dateTime(alert.startDate, lang)), alert.location && h('div', icon('location'), alert.location)),
    h('div.defense-ack', h('p', t('defense.acknowledge')), h('kbd', chord), h('p.muted.small', t('defense.focusHint'))));
  app.replaceChildren(h('div.defense-screen', { class: urgent ? 'urgent' : '' }, dialog));
  dialog.focus();
  tick = update;
}
let tick = () => {};
setInterval(() => tick(), 1000);
window.addEventListener('message', e => {
  if (e.data?.type !== 'defenseAlert' || !e.data.alert) return;
  current = e.data; render();
});
window.addEventListener('keydown', e => {
  if (current && (mac ? e.metaKey : e.ctrlKey) && e.altKey && e.shiftKey && e.code === 'KeyY' && !e.repeat) {
    e.preventDefault(); vscode.postMessage({ type: 'acknowledge', nonce: current.nonce });
  }
  if (e.key === 'Tab' || e.key === 'Escape') { e.preventDefault(); app.querySelector<HTMLElement>('[role="alertdialog"]')?.focus(); }
});
vscode.postMessage({ type: 'ready' });

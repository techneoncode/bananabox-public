import type { Ctx } from '../ctx';
import { h, icon } from '../dom';

export function renderGraderCommand(ctx: Ctx, id: number, busy: boolean): HTMLElement {
  ctx.graderCommands ??= new Map();
  ctx.ui.commandDrafts ??= {};
  const saved = ctx.graderCommands.get(id), value = ctx.ui.commandDrafts[id] ?? saved?.command ?? '';
  const label = `grader-command-${id}`;
  const input = h('input', { id: label, type: 'text', value, disabled: busy || saved?.pending, placeholder: 'make re && make tests_run',
    dataset: { keep: label }, oninput: (e: Event) => { ctx.ui.commandDrafts![id] = (e.target as HTMLInputElement).value; } });
  return h('div.grader-command-input', h('label.small', { htmlFor: label }, ctx.t('command.title')),
    h('form.command-form', { onsubmit: (e: Event) => {
      e.preventDefault();
      ctx.graderCommands!.set(id, { command: saved?.command ?? '', pending: true });
      ctx.post({ type: 'setGraderCommand', projectId: id, command: input.value }); ctx.rerender();
    } }, input, h('button.btn.small', { type: 'submit', disabled: busy || saved?.pending }, icon('check'), ctx.t('command.save'))),
    saved?.error && h('p.ic-danger.small', saved.error),
    h('p.muted.tiny', ctx.t(ctx.graders.get(id)?.history.length ? 'command.after' : 'command.first')));
}

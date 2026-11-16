import type { Ctx } from '../ctx';
import { h, icon } from '../dom';
import { mergeFunctionNames, parseFunctionNames } from '../../domain/functionRules';
import { waitLine } from '../ui';

/**
 * Allowed functions: what the subject authorizes (read from its PDF), what the student adds, and what the
 * code calls outside both, each one a tap away from being allowed.
 */
export function renderFunctionRules(ctx: Ctx, id: number, busy: boolean): HTMLElement {
  const { t } = ctx, state = ctx.functionRules.get(id), names = state?.names ?? [];
  const subject = state?.subject ?? { status: 'idle', names: [] };
  const vm = ctx.readiness.get(id);
  const forbidden = vm?.inheritedForbiddenFunctions ?? [];
  const outside = (vm?.disallowed ?? []).filter(name => !names.includes(name) && !subject.names.includes(name));
  const drafts = ctx.ui.functionDrafts ??= {};
  const error = h('div.function-rule-error.small', { hidden: true, role: 'alert' });
  const locked = busy || !state || !!state.pending;
  const save = (next: string[]) => {
    if (locked) return;
    ctx.functionRules.set(id, { ...state!, names: next, pending: true });
    ctx.post({ type: 'setFunctionRules', projectId: id, names: next });
    ctx.rerender();
  };
  const input = h('input', { type: 'text', value: drafts[id] ?? '', placeholder: t('functions.placeholder'), 'aria-label': t('functions.input'),
    disabled: busy || !state, autocomplete: 'off', maxlength: 16_384, dataset: { keep: `functions-${id}` },
    oninput: (e: Event) => { drafts[id] = (e.target as HTMLInputElement).value; error.hidden = true; } });
  input.spellcheck = false;
  const reading = subject.status === 'reading';
  const read = h('button.btn.small', { type: 'button', disabled: reading || busy, title: t('functions.readHint'),
    onclick: () => ctx.post({ type: 'readSubjectFunctions', projectId: id }) },
    icon(reading ? 'loading' : subject.status === 'idle' ? 'file-pdf' : 'refresh', reading ? 'spin' : ''), t(subject.status === 'idle' ? 'functions.read' : 'functions.readAgain'));

  const off = !!state?.disabled;
  const toggle = h('button.btn.small', { type: 'button', disabled: locked, 'aria-pressed': String(!off), title: t('functions.toggleHint'),
    onclick: () => {
      ctx.functionRules.set(id, { ...state!, disabled: !off, pending: true });
      ctx.post({ type: 'setFunctionCheck', projectId: id, enabled: off });
      ctx.rerender();
    } }, icon(off ? 'circle-large-outline' : 'pass-filled'), t(off ? 'functions.turnOn' : 'functions.turnOff'));
  if (off) return h('div.function-rule-editor', h('div.fr-block', h('div.fr-head', icon('circle-slash'), h('span.fr-title', t('functions.checkOff')), h('span.spacer'), toggle)));
  // Whole libraries (math, ncurses) add hundreds of names: the chips show the first ones.
  const shown = subject.names.slice(0, 40), more = subject.names.length - shown.length;

  return h('div.function-rule-editor',
    h('div.fr-head', h('span.spacer'), toggle),
    // From the subject
    h('div.fr-block',
      h('div.fr-head', icon('file-pdf'), h('span.fr-title', t('functions.fromSubject')), subject.doc && h('span.fr-doc.ellipsis', { title: subject.doc }, subject.doc), h('span.spacer'), read),
      reading ? waitLine(t('functions.reading'))
        : subject.status === 'found' ? h('div.function-rule-chips', shown.map(name => h('span.function-rule.from-subject', h('span.mono', name))),
          more > 0 && h('span.function-rule.from-subject', { title: subject.names.slice(40).join(', ') }, t('functions.more', { n: more })))
        : subject.status === 'none' ? h('p.fr-note', t('functions.noneInSubject', { doc: subject.doc ?? '' }))
        : subject.status === 'error' ? h('p.fr-note.bad', t('functions.readError'))
        : h('p.fr-note', t('functions.notRead')),
      !reading && subject.makefile && (subject.makefile.rules.length > 0 || subject.makefile.binary) && h('p.fr-note.muted.tiny',
        [subject.makefile.rules.length ? t('functions.makefileRules', { rules: subject.makefile.rules.join(', ') }) : '',
          subject.makefile.binary ? t('functions.makefileBinary', { name: subject.makefile.binary }) : ''].filter(Boolean).join(' · '))),
    // Added by the student
    h('div.fr-block',
      h('div.fr-head', icon('person'), h('span.fr-title', t('functions.yours'))),
      names.length > 0 && h('div.function-rule-chips', names.map(name => h('span.function-rule', h('span.mono', name),
        h('button.icon-btn', { type: 'button', disabled: locked, title: t('functions.remove', { name }), 'aria-label': t('functions.remove', { name }),
          onclick: () => save(names.filter(n => n !== name)) }, icon('close'))))),
      h('form.function-rule-form', { onsubmit: (e: Event) => {
        e.preventDefault();
        if (locked) return;
        const parsed = parseFunctionNames(input.value);
        if (!parsed?.length) { error.textContent = t(parsed ? 'functions.empty' : 'functions.invalid'); error.hidden = false; return; }
        drafts[id] = '';
        save(mergeFunctionNames(names, parsed));
        input.value = ''; input.focus();
      } }, input, h('button.btn.small', { type: 'submit', disabled: locked }, icon(state?.pending ? 'loading' : 'add', state?.pending ? 'spin' : ''), t('functions.add'))),
      error),
    // Called but not allowed
    outside.length > 0 && h('div.fr-block.fr-outside',
      h('div.fr-head', icon('error'), h('span.fr-title', t('functions.outside', { n: outside.length }))),
      h('div.function-rule-chips', outside.map(name => h('span.function-rule.is-outside', h('span.mono', name),
        !forbidden.includes(name) && h('button.btn.ghost.small', { type: 'button', disabled: locked, title: t('functions.allowHint', { name }),
          onclick: () => save(mergeFunctionNames(names, [name])) }, icon('check'), t('functions.allow')))))),
    h('div.muted.tiny', t('functions.howItWorks')),
    forbidden.length > 0 && h('div.muted.tiny', t('functions.inherited', { names: forbidden.join(', ') })));
}

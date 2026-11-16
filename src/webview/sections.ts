import { h, icon } from './dom';

/** Native keyboard-accessible disclosure; its header stays visible when folded. */
export function collapsible(box: HTMLElement, id: string, open = true): HTMLDetailsElement {
  const children = [...box.childNodes];
  const header = children.shift() as HTMLElement;
  const summary = h('summary.box-header.section-header', icon('chevron-right', 'section-chevron'), ...Array.from(header.childNodes));
  // Header actions retain their own behaviour without toggling the section.
  summary.querySelectorAll('button').forEach(action => action.addEventListener('click', e => e.preventDefault()));
  return h('details', { class: `${box.className} collapsible-section`, open, dataset: { detailId: id } }, summary, ...children);
}

export function detailChoiceKey(route: string, id: string, scope: string, index: number, classes: string): string {
  return `${route}:${id || `${scope}:${index}:${classes}`}`;
}

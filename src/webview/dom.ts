type Child = Node | string | number | false | null | undefined | Child[];
type Attrs = Record<string, any>;

/** Minimal hyperscript helper: h('div.card', {onclick}, child, …). */
export function h<K extends keyof HTMLElementTagNameMap>(spec: K | `${K}.${string}`, attrs?: Attrs | Child, ...children: Child[]): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = (spec as string).split('.');
  const el = document.createElement(tag) as HTMLElementTagNameMap[K];
  if (classes.length) {
    el.className = classes.join(' ');
  }
  let kids = children;
  if (attrs !== undefined && attrs !== null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    kids = [attrs as Child, ...children];
  } else if (attrs) {
    for (const [k, v] of Object.entries(attrs as Attrs)) {
      if (v === undefined || v === null || v === false) {
        continue;
      }
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'class') {
        el.classList.add(...String(v).split(' ').filter(Boolean));
      } else if (k === 'style' && typeof v === 'object') {
        // Custom properties (--name) only take effect through setProperty.
        for (const [prop, value] of Object.entries(v as Record<string, unknown>)) {
          if (prop.startsWith('--')) el.style.setProperty?.(prop, String(value));
          else (el.style as unknown as Record<string, unknown>)[prop] = value;
        }
      } else if (k === 'dataset') {
        Object.assign(el.dataset, v);
      } else if (k in el && k !== 'list') {
        (el as any)[k] = v;
      } else {
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
  }
  append(el, kids);
  return el;
}

export function append(el: Element, kids: Child[]): void {
  for (const c of kids) {
    if (c === null || c === undefined || c === false) {
      continue;
    }
    if (Array.isArray(c)) {
      append(el, c);
    } else {
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }
}

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: Array<Node | string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  el.append(...children);
  return el;
}

export const icon = (name: string, cls = ''): HTMLElement => h('span', { class: `codicon codicon-${name} ${cls}`.trim(), 'aria-hidden': 'true' });

export function clear(el: Element): void {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

import { h } from '../dom';

/** Tiny, safe markdown subset (headings, lists, bold, code, links) · built with DOM nodes, never innerHTML. */
export function renderMarkdown(source: string, openLink: (url: string) => void): HTMLElement {
  const root = h('div.md');
  let list: HTMLUListElement | null = null;
  const inline = (text: string): Array<Node | string> => {
    const out: Array<Node | string> = [];
    const re = /(\*\*[^*]+\*\*)|(`[^`]+`)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m.index > last) {
        out.push(text.slice(last, m.index));
      }
      if (m[1]) {
        out.push(h('strong', m[1].slice(2, -2)));
      } else if (m[2]) {
        out.push(h('code', m[2].slice(1, -1)));
      } else {
        const label = /\[([^\]]+)\]/.exec(m[3])![1];
        out.push(h('a', { href: m[4], onclick: (e: Event) => (e.preventDefault(), openLink(m![4])) }, label));
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      out.push(text.slice(last));
    }
    return out;
  };
  for (const raw of source.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (!list) {
        list = h('ul');
        root.append(list);
      }
      list.append(h('li', ...inline(item[1])));
      continue;
    }
    list = null;
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      root.append(h(heading[1].length <= 2 ? 'h3' : 'h4', ...inline(heading[2])));
    } else if (line.trim()) {
      root.append(h('p', ...inline(line)));
    }
  }
  return root;
}

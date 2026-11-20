import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import type { ProjectVM } from '../../shared/types';

interface PdfApi {
  open(container: HTMLElement, base64: string, workerUrl: string): Promise<{ pages: number; destroy(): void }>;
}

interface Host {
  el: HTMLElement;
  key: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  pages?: number;
  zoom: number;
  destroy?: () => void;
}

/** Rendered PDFs are kept per project so UI re-renders never re-rasterise the pages. */
const hosts = new Map<number, Host>();
export function clearPdfHosts(): void {
  for (const host of hosts.values()) host.destroy?.();
  hosts.clear();
}
let loader: Promise<PdfApi> | null = null;

function loadViewer(): Promise<PdfApi> {
  loader ??= new Promise<PdfApi>((resolve, reject) => {
    const main = document.querySelector<HTMLScriptElement>('script[src$="main.js"]');
    const s = document.createElement('script');
    s.src = document.body.dataset.pdfViewer ?? '';
    s.nonce = main?.nonce ?? '';
    s.onload = () => ((window as any).__bananaboxPdf ? resolve((window as any).__bananaboxPdf) : reject(new Error('PDF viewer unavailable')));
    s.onerror = () => reject(new Error('Could not load the PDF viewer'));
    document.head.append(s);
  });
  return loader;
}

export function renderSubject(ctx: Ctx, p: ProjectVM): HTMLElement {
  const state = ctx.subjects.get(p.id);
  const binaries = state?.status === 'ready' ? state.binaries ?? 0 : 0;
  const action = (target: 'editor' | 'browser' | 'desktop' | 'binaries', symbol: string) => h('button.btn.ghost.small', {
    onclick: () => ctx.post({ type: 'openSubject', projectId: p.id, target }),
  }, icon(symbol), ctx.t(`subject.open.${target}`));
  return h('div.subject', { style: { display: 'grid', gap: '10px' } }, h('div.subject-actions',
    ctx.surface === 'sidebar' && action('editor', 'layout-panel-center'),
    action('browser', 'globe'),
    action('desktop', 'desktop-download'),
    binaries > 0 && action('binaries', 'package'),
  ), renderSubjectBody(ctx, p));
}

function renderSubjectBody(ctx: Ctx, p: ProjectVM): HTMLElement {
  const { t } = ctx;
  const subject = ctx.subjects.get(p.id);
  if (!subject || subject.status === 'idle' || subject.status === 'loading') {
    return h('div.empty', icon('loading', 'spin'), h('p', t('subject.loading')));
  }
  if (subject.status === 'error') {
    return h('div.empty', icon('error'), h('p', subject.message), h('div.actions', pickButton(ctx, p), h('button.btn', { onclick: () => ctx.post({ type: 'loadSubject', projectId: p.id }) }, icon('refresh'), t('action.retry'))));
  }
  if (subject.status === 'unavailable') {
    return h(
      'div.empty',
      icon('file-pdf'),
      h('p', h('strong', t('subject.unavailableTitle'))),
      h('p.small', t('subject.unavailableBody')),
      h('div.actions.center', pickButton(ctx, p), h('button.btn', { onclick: () => ctx.post({ type: 'openExternal', url: p.intranetUrl }) }, icon('globe'), t('action.intranet'))),
    );
  }

  const key = subject.base64;
  let host = hosts.get(p.id);
  if (!host || host.key !== key) {
    host?.destroy?.();
    host = { el: h('div.pdf-pages', { 'aria-label': subject.name }), key, status: 'loading', zoom: 1 };
    hosts.set(p.id, host);
    const current = host;
    loadViewer()
      .then((api) => api.open(current.el, subject.base64, document.body.dataset.pdfWorker ?? ''))
      .then((res) => {
        if (hosts.get(p.id) !== current) { res.destroy(); return; }
        current.destroy = res.destroy;
        current.status = 'ready';
        current.pages = res.pages;
        ctx.rerender();
      })
      .catch((e: Error) => {
        current.status = 'error';
        current.error = e.message;
        ctx.rerender();
      });
  }
  const current = host;
  const zoom = (delta: number) => {
    current.zoom = Math.min(2.5, Math.max(0.5, Math.round((current.zoom + delta) * 10) / 10));
    const render = (current.el as any).__render as ((s: number) => Promise<void>) | undefined;
    const fit = Math.max(0.25, Math.min(1.6, (current.el.clientWidth - 24) / 595));
    void render?.(fit * current.zoom).catch((e: Error) => {
      current.status = 'error'; current.error = e.message; ctx.rerender();
    });
    ctx.rerender();
  };
  const documents = subject.documents;
  const switcher = documents.length > 1 && h(
    'div.doc-tabs',
    { role: 'tablist', 'aria-label': t('subject.documents') },
    documents.map((d) => h(
      'button.doc-tab',
      {
        role: 'tab',
        'aria-selected': String(d.id === subject.docId),
        title: d.folder ? `${d.folder} / ${d.name}` : d.name,
        onclick: () => d.id !== subject.docId && ctx.post({ type: 'loadSubject', projectId: p.id, docId: d.id }),
      },
      icon('file-pdf'),
      h('span.doc-tab-label', h('span.ellipsis', d.name), d.folder && h('span.muted.small', d.folder)),
    )),
  );
  return h(
    'div.pdf',
    switcher,
    h(
      'div.pdf-bar',
      icon('file-pdf', 'ic-muted'),
      h('span.ellipsis', subject.name),
      current.pages && h('span.muted.small', t('subject.pages', { n: current.pages })),
      h('span.spacer'),
      h('button.icon-btn', { title: t('subject.zoomOut'), 'aria-label': t('subject.zoomOut'), onclick: () => zoom(-0.2) }, icon('zoom-out')),
      h('span.zoom', `${Math.round(current.zoom * 100)}%`),
      h('button.icon-btn', { title: t('subject.zoomIn'), 'aria-label': t('subject.zoomIn'), onclick: () => zoom(0.2) }, icon('zoom-in')),
      pickButton(ctx, p, true),
    ),
    current.status === 'error' && h('div.notice.error', icon('error'), h('div', current.error)),
    current.status === 'loading' && h('div.empty.small', icon('loading', 'spin'), h('p', t('subject.rendering'))),
    current.el,
  );
}

function pickButton(ctx: Ctx, p: ProjectVM, compact = false): HTMLElement {
  return h('button.btn', { class: compact ? 'ghost' : '', onclick: () => ctx.post({ type: 'pickSubject', projectId: p.id }), title: ctx.t('subject.pick') }, icon('folder-opened'), compact ? null : ctx.t('subject.pick'));
}

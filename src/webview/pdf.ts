// Loaded lazily: every document owns its worker and releases it when replaced.
import * as pdfjs from 'pdfjs-dist/build/pdf.min.mjs';

type Viewer = {
  open(container: HTMLElement, base64: string, workerUrl: string): Promise<{ pages: number; destroy(): void }>;
};

const viewer: Viewer = {
  async open(container, base64, workerUrl) {
    const response = await fetch(workerUrl);
    if (!response.ok) throw new Error('Could not load the PDF worker.');
    const workerBlob = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
    const port = new Worker(workerBlob, { type: 'module' });
    const worker = new (pdfjs as any).PDFWorker({ port });
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const loading = (pdfjs as any).getDocument({ data: bytes, worker, isEvalSupported: false });
    let destroyed = false;
    let version = 0;
    let active: { cancel(): void; promise: Promise<void> } | undefined;
    let queue = Promise.resolve();
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      version++;
      active?.cancel();
      void loading.destroy();
      worker.destroy();
      port.terminate();
      URL.revokeObjectURL(workerBlob);
      container.replaceChildren();
      delete (container as any).__render;
    };
    try {
      const doc = await loading.promise;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const render = (scale: number): Promise<void> => {
        const request = ++version;
        active?.cancel();
        queue = queue.catch(() => undefined).then(async () => {
          if (destroyed || request !== version) return;
          container.replaceChildren();
          for (let n = 1; n <= doc.numPages; n++) {
            const page = await doc.getPage(n);
            if (destroyed || request !== version) return;
            const vp = page.getViewport({ scale: scale * dpr });
            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-page';
            canvas.width = Math.floor(vp.width);
            canvas.height = Math.floor(vp.height);
            canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
            canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
            canvas.setAttribute('aria-label', `Page ${n}`);
            container.append(canvas);
            active = page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp });
            try { await active!.promise; }
            catch (e) { if (!destroyed && request === version) throw e; }
            if (destroyed || request !== version) return;
            page.cleanup();
          }
        });
        return queue;
      };
      (container as any).__render = render;
      // Allow the host to attach the container before measuring its width.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await render(Math.max(0.25, Math.min(1.6, (container.clientWidth - 24) / 595)));
      return { pages: doc.numPages, destroy };
    } catch (e) { destroy(); throw e; }
  },
};

(window as any).__bananaboxPdf = viewer;

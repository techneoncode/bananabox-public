import { paletteCss, PALETTE_KEYS, type Palette } from '../shared/palette';

let applied = '';

/** Puts the student's colours on this view (or takes them off for the theme's own). Cheap when nothing changed. */
export function applyPalette(palette: Palette | undefined): void {
  const css = paletteCss(palette ?? {});
  if (css === applied) return;
  applied = css;
  let style = document.getElementById('bb-palette') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'bb-palette';
    document.head.append(style);
  }
  style.textContent = css;
  document.body.classList.toggle('bb-palette', PALETTE_KEYS.some(k => palette?.[k]));
}

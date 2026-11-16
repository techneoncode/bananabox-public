import { h, icon } from '../dom';
import type { Ctx } from '../ctx';
import { ring, skyline } from '../charts';
import { chip } from '../ui';
import { applyPalette } from '../palette';
import { normalizeHex, PALETTE_DEFAULTS, PALETTE_GROUPS, PALETTE_KEYS, PALETTE_PRESETS, samePalette, type Palette, type PaletteKey } from '../../shared/palette';

/** CSS variable each key drives, to read the theme's own value when the key is left on "auto". */
const TOKEN: Record<PaletteKey, string> = {
  accent: '--banana', accent2: '--banana', pass: '--pass', warn: '--warn', fail: '--fail', fatal: '--fatal', major: '--major', minor: '--minor', info: '--info',
};

/** The palette being edited: the saved one until the student changes something on this page. */
function draft(ctx: Ctx): Palette {
  return ctx.ui.paletteDraft ?? { ...(ctx.state.palette ?? {}) };
}

function save(ctx: Ctx, palette: Palette): void {
  ctx.ui.paletteDraft = palette;
  applyPalette(palette);
  if (!samePalette(palette, ctx.state.palette ?? {})) ctx.post({ type: 'setPalette', palette });
}

/**
 * The colours page: a live preview, one-tap presets, then every colour with a picker and a hex field.
 * Changes show at once everywhere in this view, and are saved for every Bananabox view when the picker closes.
 */
export function renderAppearance(ctx: Ctx): HTMLElement {
  const { t } = ctx;
  const palette = draft(ctx);
  const back = () => { ctx.ui.page = null; ctx.ui.paletteDraft = undefined; applyPalette(ctx.state.palette); ctx.rerender(); };
  const custom = PALETTE_KEYS.some(k => palette[k]);
  return h('div.appearance',
    h('header.sb-nav', { style: { viewTransitionName: 'sb-nav' } },
      h('button.sb-back', { type: 'button', title: t('action.back'), onclick: back }, icon('chevron-left'), h('span', t(ctx.home ? 'appearance.backHome' : 'sb.projects'))),
      h('span.spacer'),
      h('button.btn.small', { type: 'button', disabled: !custom, title: t('appearance.resetAllHint'), onclick: () => { save(ctx, {}); ctx.rerender(); } }, icon('discard'), t('appearance.resetAll'))),
    h('div.sb-page-head.rise', { style: { '--i': '0' } }, h('h1', t('appearance.title')), h('span.sub', t('appearance.sub'))),
    preview(ctx),
    presets(ctx, palette),
    ...PALETTE_GROUPS.map((group, i) => h('section.panel.ap-group.rise', { style: { '--i': String(3 + i) }, 'aria-label': t(`appearance.group.${group.id}`) },
      h('h2', t(`appearance.group.${group.id}`)),
      ...group.keys.map(key => colorRow(ctx, palette, key)))),
    h('p.ap-foot', icon('info'), t('appearance.saved')));
}

/** Real components on sample data, so every colour is judged where it is used. */
function preview(ctx: Ctx): HTMLElement {
  const { t } = ctx;
  const bars = [32, 58, 74, 100].map((score, i) => ({ score, title: t('sb.attempt', { n: i + 1, score: `${score}%` }) }));
  return h('section.panel.ap-preview.rise', { style: { '--i': '1' }, 'aria-label': t('appearance.preview') },
    h('div.ap-preview-top',
      h('span.ap-now', t('season.now')),
      h('span.spacer'),
      ring(0.62, { size: 34, stroke: 4, tone: 'live', label: '2d', aria: t('appearance.preview') })),
    skyline(bars, 2, { width: 200, height: 40, aria: t('appearance.preview'), slotTitle: t('sb.tokenSlot'), ghostTitle: t('sb.inFlight'), maxBar: 18 }),
    h('div.ap-track', h('i')),
    h('div.ap-chips', chip('pass', icon('pass-filled'), t('sb.verdict.ready')), chip('warn', icon('warning'), t('sb.verdict.stale')), chip('fail', icon('error'), t('sb.verdict.blocked'))),
    h('div.sb-legend', ...(['fatal', 'major', 'minor', 'info'] as const).map(k => h('span', h('i', { class: `dot-${k}` }), t(`appearance.key.${k}`)))));
}

function presets(ctx: Ctx, palette: Palette): HTMLElement {
  const { t } = ctx;
  return h('section.ap-presets.rise', { style: { '--i': '2' }, role: 'radiogroup', 'aria-label': t('appearance.presets') },
    PALETTE_PRESETS.map(preset => {
      const a = preset.palette.accent ?? PALETTE_DEFAULTS.accent, b = preset.palette.accent2 ?? PALETTE_DEFAULTS.accent2;
      const on = palette.accent === preset.palette.accent && palette.accent2 === preset.palette.accent2;
      return h('button.ap-preset', { type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'on' : '',
        onclick: () => { save(ctx, { ...palette, accent: preset.palette.accent, accent2: preset.palette.accent2 }); ctx.rerender(); } },
        h('span.ap-swatch', { style: { background: `linear-gradient(135deg, ${a}, ${b})` } }),
        h('span.ap-preset-name', t(`appearance.preset.${preset.id}`)));
    }));
}

/** One colour: native picker, hex field, and a way back to the theme's value. */
function colorRow(ctx: Ctx, palette: Palette, key: PaletteKey): HTMLElement {
  const { t } = ctx;
  const chosen = palette[key];
  const shown = chosen ?? themeValue(key);
  const hex = h('input.ap-hex.mono', { type: 'text', value: chosen ?? '', placeholder: shown, autocomplete: 'off', maxlength: '7', 'aria-label': t('appearance.hex', { name: t(`appearance.key.${key}`) }), dataset: { keep: `hex-${key}` } }) as HTMLInputElement;
  hex.spellcheck = false;
  const picker = h('input.ap-picker', { type: 'color', value: shown, 'aria-label': t(`appearance.key.${key}`), title: t('appearance.pick') }) as HTMLInputElement;
  const error = h('span.ap-error', { role: 'alert' });
  // While the picker is open, only CSS changes: re-rendering would close it.
  picker.addEventListener('input', () => {
    hex.value = picker.value;
    applyPalette({ ...draft(ctx), [key]: picker.value });
  });
  picker.addEventListener('change', () => { save(ctx, { ...draft(ctx), [key]: picker.value }); ctx.rerender(); });
  const commit = () => {
    if (!hex.value.trim()) {
      if (chosen) { const next = { ...draft(ctx) }; delete next[key]; save(ctx, next); ctx.rerender(); }
      return;
    }
    const value = normalizeHex(hex.value);
    if (!value) { hex.setAttribute('aria-invalid', 'true'); error.textContent = t('appearance.invalid'); return; }
    hex.removeAttribute('aria-invalid');
    error.textContent = '';
    if (value !== chosen) { save(ctx, { ...draft(ctx), [key]: value }); ctx.rerender(); }
  };
  hex.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  hex.addEventListener('change', commit);
  return h('div.ap-row', { class: chosen ? 'custom' : '' },
    h('label.ap-pick', picker, h('span.ap-dot', { style: { background: shown } })),
    h('span.ap-name', h('span', t(`appearance.key.${key}`)), h('span.ap-state', chosen ? t('appearance.custom') : t('appearance.auto'))),
    hex,
    h('button.icon-btn', { type: 'button', disabled: !chosen, title: t('appearance.reset'), 'aria-label': t('appearance.reset'),
      onclick: () => { const next = { ...draft(ctx) }; delete next[key]; save(ctx, next); ctx.rerender(); } }, icon('discard')),
    error);
}

/** The colour the theme gives this key right now, as #rrggbb (what the picker starts from on "auto"). */
function themeValue(key: PaletteKey): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function' || !document.body) return PALETTE_DEFAULTS[key];
  const probe = document.createElement('span');
  probe.style.color = `var(${TOKEN[key]})`;
  probe.style.display = 'none';
  document.body.append(probe);
  const value = toHex(getComputedStyle(probe).color);
  probe.remove();
  return value ?? PALETTE_DEFAULTS[key];
}

/** `rgb(…)`, `rgba(…)` or `color(srgb …)` → #rrggbb. */
export function toHex(css: string): string | null {
  const rgb = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(css);
  const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(css);
  const parts = rgb ? rgb.slice(1, 4).map(Number) : srgb ? srgb.slice(1, 4).map(v => Number(v) * 255) : null;
  if (!parts || parts.some(v => !Number.isFinite(v))) return null;
  return `#${parts.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

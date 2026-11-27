/**
 * Colours the student can choose for Bananabox views. Every key is optional: a
 * missing key keeps the theme's value. Shared by the host (validation, storage)
 * and the webviews (CSS).
 */

export const PALETTE_KEY = 'bananabox.palette.v1';

export const PALETTE_KEYS = [
  'accent',
  'accent2',
  'pass',
  'warn',
  'fail',
  'fatal',
  'major',
  'minor',
  'info',
] as const;
export type PaletteKey = typeof PALETTE_KEYS[number];
export type Palette = Partial<Record<PaletteKey, string>>;

/** Groups shown on the colours page, in order. */
export const PALETTE_GROUPS: Array<{
  id: 'accent' | 'state' | 'lens';
  keys: PaletteKey[];
}> = [
  { id: 'accent', keys: ['accent', 'accent2'] },
  { id: 'state', keys: ['pass', 'warn', 'fail'] },
];

/**
 * Severity colours: not stored here but read from the Style Lens foreground
 * settings (`bananalens.inline.colors.<key>.foreground`), so the views and the
 * editor always show the same colour.
 */
export const LENS_KEYS = ['fatal', 'major', 'minor', 'info'] as const;

/**
 * The built-in values, for the dark family of themes (swatches and "default"
 * previews).
 */
export const PALETTE_DEFAULTS: Record<PaletteKey, string> = {
  accent: '#ffd84d',
  accent2: '#ffae2e',
  pass: '#73c991',
  warn: '#e0a458',
  fail: '#f48771',
  fatal: '#f28b82',
  major: '#e0a458',
  minor: '#80c7d9',
  info: '#b5a2e0',
};

/**
 * One-tap accents. Banana is the theme's own look, so it is the empty palette.
 */
export const PALETTE_PRESETS: Array<{ id: string; palette: Palette }> = [
  { id: 'banana', palette: {} },
  { id: 'mint', palette: { accent: '#5ee6a8', accent2: '#1fb879' } },
  { id: 'ocean', palette: { accent: '#5cc8ff', accent2: '#2f7bff' } },
  { id: 'grape', palette: { accent: '#c79bff', accent2: '#8a5cf6' } },
  { id: 'coral', palette: { accent: '#ff8a7a', accent2: '#ff5470' } },
  { id: 'sakura', palette: { accent: '#ffb3d1', accent2: '#ff7bac' } },
];

const HEX = /^#[0-9a-f]{6}$/;

/** `#abc`, `abc`, `#AABBCC` → `#aabbcc`; anything else → null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let v = value.trim().toLowerCase();
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  }

  return HEX.test(v) ? v : null;
}

/**
 * Keeps known keys with valid colours only; never trusts what comes from a
 * webview or storage.
 */
export function sanitizePalette(value: unknown): Palette {
  const out: Palette = {};
  if (!value || typeof value !== 'object') return out;
  for (const key of PALETTE_KEYS) {
    const hex = normalizeHex((value as Record<string, unknown>)[key]);
    if (hex) out[key] = hex;
  }

  return out;
}

export function samePalette(a: Palette, b: Palette): boolean {
  return PALETTE_KEYS.every(k => (a[k] ?? null) === (b[k] ?? null));
}

/** Relative luminance (WCAG) of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const c = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * Text drawn on the accent (the "Now" pill, primary chips): black or white,
 * whichever reads better.
 */
export function onColor(hex: string): string {
  const l = luminance(hex);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#1e1e1e' : '#ffffff';
}

/**
 * CSS custom properties for a palette. The accent also derives its wash, its
 * ink (darker on light themes so text stays readable) and the glint gradient;
 * status and Lens colours replace the theme's directly.
 */
export function paletteCss(p: Palette): string {
  const rules: string[] = [];
  const base: string[] = [];
  const light: string[] = [];
  const a = p.accent;
  const a2 = p.accent2
    ?? (a ? `color-mix(in oklab, ${a} 76%, #000)` : undefined);
  if (a) {
    base.push(
      `--banana:${a}`,
      `--banana-ink:${a}`,
      `--banana-on:${onColor(a)}`,
      `--banana-wash:color-mix(in srgb, ${a} 8%, transparent)`,
    );
    light.push(
      `--banana:color-mix(in oklab, ${a} 88%, #000)`,
      `--banana-ink:color-mix(in oklab, ${a} 55%, #000)`,
      `--banana-wash:color-mix(in srgb, ${a} 13%, transparent)`,
    );
  }

  if (a || p.accent2) {
    const from = a ?? 'var(--banana)';
    const to = a2 ?? 'var(--banana)';
    base.push(
      `--glint:linear-gradient(90deg, ${from}, ${to})`,
      `--glint-v:linear-gradient(180deg, ${from}, ${to})`,
    );
    if (a) {
      light.push(
        `--glint:linear-gradient(90deg, color-mix(in oklab, ${from} 88%, #000), ${to})`,
        `--glint-v:linear-gradient(180deg, color-mix(in oklab, ${from} 88%, #000), ${to})`,
      );
    }
  }

  for (const key of [
    'pass',
    'warn',
    'fail',
    'fatal',
    'major',
    'minor',
    'info',
  ] as const) {
    if (p[key]) base.push(`--${key}:${p[key]}`);
  }

  if (base.length) rules.push(`body.bb-palette{${base.join(';')}}`);
  if (light.length) {
    rules.push(`body.vscode-light.bb-palette{${light.join(';')}}`);
  }

  return rules.join('\n');
}

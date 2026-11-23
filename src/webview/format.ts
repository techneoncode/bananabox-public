export type Lang = 'en' | 'fr';

export function dateTime(iso: string | null | undefined, lang: Lang): string {
  if (!iso || Number.isNaN(Date.parse(iso))) {
    return '—';
  }
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function dateOnly(iso: string | null | undefined, lang: Lang): string {
  if (!iso || Number.isNaN(Date.parse(iso))) {
    return '—';
  }
  return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
}

export function timeOnly(iso: string | null | undefined, lang: Lang): string {
  if (!iso || Number.isNaN(Date.parse(iso))) {
    return '';
  }
  return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** "in 3 days" / "2 hours ago", picking the largest sensible unit. */
export function relative(iso: string | null | undefined, lang: Lang, now = Date.now()): string {
  if (!iso || Number.isNaN(Date.parse(iso))) {
    return '—';
  }
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) {
      return rtf.format(Math.round(diff / ms), unit);
    }
  }
  return rtf.format(Math.round(diff / 1000), 'second');
}

/** "2d 4h" style compact remaining time. */
export function compactDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const total = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(total / 1440);
  const hh = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) {
    return `${d}d ${hh}h`;
  }
  if (hh > 0) {
    return `${hh}h ${m.toString().padStart(2, '0')}m`;
  }
  return `${m}m`;
}

export function seconds(from: string | null, to: string | null): string | null {
  if (!from || !to) {
    return null;
  }
  const s = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  return s >= 0 ? (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`) : null;
}

/** 0‥1 position of `now` between two instants, clamped. */
export function progress(startIso: string, endIso: string, now = Date.now()): number {
  const s = Date.parse(startIso);
  const e = Date.parse(endIso);
  return e > s && Number.isFinite(now) ? Math.min(1, Math.max(0, (now - s) / (e - s))) : 0;
}

export const shortSha = (sha: string | null): string => (sha ? sha.slice(0, 7) : '—');

export type BanDuration = 'permanent' | '1h' | '24h' | '7d' | '30d' | 'custom';
const BAN_SPAN: Record<Exclude<BanDuration, 'permanent' | 'custom'>, number> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };
/** The Worker refuses a ban that ends further ahead than this. */
export const BAN_MAX_AHEAD = 366 * 86_400_000;

/** End of a ban picked in the dashboard, at submit time: null when permanent, undefined when the custom date is unusable. */
export function expiryOf(choice: BanDuration, custom: string, now = Date.now()): number | null | undefined {
  if (choice === 'permanent') return null;
  if (choice !== 'custom') return now + BAN_SPAN[choice];
  const at = Date.parse(custom);
  return Number.isFinite(at) && at > now && at <= now + BAN_MAX_AHEAD ? at : undefined;
}

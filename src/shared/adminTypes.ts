import type { Lang } from './i18n';
import type { RemoteFeature } from '../domain/remotePolicy';

/** Shapes returned by the admin endpoints of the Worker (see docs/remote-control.md). */

export interface AdminSession {
  email: string;
  whoami: string | null;
  expiresAt: number;
}

export interface TimelineDay {
  /** UTC day, `YYYY-MM-DD`. */
  day: string;
  /** Installations first seen that day. */
  new: number;
  /** Installations whose last launch was that day. */
  last_seen: number;
}

export interface VersionCount {
  version: string;
  installs: number;
  active: number;
  obsolete: boolean;
}

export interface AdminStats {
  current_version: string;
  active_window_days: number;
  installs: number;
  active: number;
  inactive: number;
  obsolete_active: number;
  launches: number;
  /** Account names reported by the installations. */
  users: string[];
  versions: VersionCount[];
  timeline: TimelineDay[];
}

export interface ListEntry {
  id: number;
  name: string;
  reason: string | null;
  features: RemoteFeature[];
  created_at: number;
}

export interface AdminPolicy {
  lens_active: boolean;
  my_api_active: boolean;
  version: string;
  latest: string;
}

export interface UpdateEntry {
  install: string;
  from_version: string;
  to_version: string;
  at: number;
}

export interface AdminSnapshot {
  stats: AdminStats;
  banned: ListEntry[];
  authorized: ListEntry[];
  policy: AdminPolicy;
  updates: UpdateEntry[];
  fetchedAt: number;
}

export interface AdminErrorInfo {
  /** Worker error code, or `network`, `session_expired`, `bad_response`. */
  code: string;
  message: string;
}

export type ReleaseStep = 'reading' | 'account' | 'creating' | 'uploading' | 'policy' | 'apiJson' | 'done' | 'error';

export interface ReleaseState {
  step: ReleaseStep;
  file: string;
  version?: string;
  /** The release page, once published. */
  url?: string;
  error?: string;
  /** The step that failed. */
  failed?: ReleaseStep;
}

export interface AdminViewState {
  lang: Lang;
  phase: 'loading' | 'login' | 'dashboard';
  session?: AdminSession;
  snapshot?: AdminSnapshot;
  error?: AdminErrorInfo;
  /** A request is in flight: the webview disables its controls. */
  busy?: boolean;
  /** The release being published from a dropped VSIX, or the last one. */
  release?: ReleaseState;
}

export type AdminHostMessage = { type: 'state'; state: AdminViewState };

export type AdminWebviewMessage =
  | { type: 'ready' }
  | { type: 'login'; email: string; password: string }
  | { type: 'logout' }
  | { type: 'refresh' }
  | { type: 'ban'; name: string; reason?: string; features: RemoteFeature[] }
  | { type: 'updateBan'; id: number; features?: RemoteFeature[]; reason?: string }
  | { type: 'unban'; id: number }
  | { type: 'authorize'; name: string; reason?: string }
  | { type: 'unauthorize'; id: number }
  | { type: 'setPolicy'; lens_active?: boolean; my_api_active?: boolean }
  | { type: 'publishRelease'; file: string; data: string; notes?: string };

import type { Palette } from '../shared/palette';
import type { HostMessage, PanelTab, StateSnapshot, WebviewMessage } from '../shared/protocol';
import type { Milestone } from '../domain/milestones';
import type { ActivityLimitsVM, ActivitySlotVM, ActivityVM, CalendarVM, Person, GraderVM, StyleScanVM, SubjectState, ValgrindVM, TestResultDetail } from '../shared/types';
import type { Lang } from './format';
import type { GuidedVM, ReadinessVM, ReproductionVM, SubjectFunctionsVM } from '../shared/deliveryTypes';

export type Tab = 'grader' | 'valgrind' | 'history' | 'subject' | 'activities' | 'details' | 'prepare';
/** Tabs the host may request (protocol names). */
export type HostTab = PanelTab;
export const hostTab = (tab: HostTab): Tab => (tab === 'overview' ? 'details' : tab.startsWith('prepare-') ? 'prepare' : tab as Tab);
export type Filter = 'all' | 'ongoing' | 'upcoming' | 'past';

export interface ResultEntry {
  loading: boolean;
  detail: TestResultDetail | null;
  error: string | null;
}

export interface UiState {
  /** A page shown instead of the surface's own content (sidebar overview, Home). */
  page?: 'appearance' | null;
  /** Colours being edited on the appearance page, before and while they are saved. */
  paletteDraft?: Palette;
  search: string;
  filter: Filter;
  /** Sidebar only: user asked for the full list even though a project repo is open. */
  showList: boolean;
  /** Sidebar only: the project pushed from the overview; null follows the repository open in this window. */
  sidebarProject?: number | null;
  tab: Tab | null;
  selectedResult: Record<number, number | null>;
  openTasks: Set<string>;
  traceQuery: string;
  showFullTrace: boolean;
  comparisons: Record<number, { before: number; after: number; filter: string; automatic?: boolean }>;
  functionDrafts?: Record<number, string>;
  activityFilters?: Record<number, 'all' | 'available' | 'mine'>;
  /** Calendar view: shown day (`YYYY-MM-DD`), mode, opened session and pending confirmation. */
  calendar?: { mode: 'day' | 'week'; date: string; open: number | null; confirm: string | null; settings?: boolean;
    prefDraft?: { type: string; day: number | null; time: string } };
  activitySearch?: Record<number, string>;
  commandDrafts?: Record<number, string>;
  valgrindDrafts?: Record<number, string>;
  /** Valgrind check shown, per project, by when it ran; unset follows the latest. */
  valgrindSelected?: Record<number, number>;
  /** Projects whose whole check list is unfolded, by their first check. */
  valgrindAllChecks?: Set<number>;
  /** Pipeline stage whose drawer is open, per project; undefined follows the first failing stage. */
  pipelineFocus?: Record<number, string | null>;
  /** The event the Prepare page checks; unset follows the nearest one. */
  milestone?: Milestone;
  /** Passed tasks the user unfolded, per result. */
  showPassed?: Set<number>;
  /** Home: timeline window and the project shown in the detail card. */
  homeRange?: '4w' | '8w' | 'all';
  homeSelected?: number | null;
}

export interface Ctx {
  surface: 'sidebar' | 'panel';
  /** Wide Home dashboard panel (no fixed project). */
  home?: boolean;
  fixedProjectId: number | null;
  lang: Lang;
  state: StateSnapshot;
  ui: UiState;
  graders: Map<number, GraderVM>;
  results: Map<number, ResultEntry>;
  subjects: Map<number, SubjectState>;
  activities: Map<number, ActivityVM[]>;
  activityErrors: Map<number, string>;
  activityPending?: Set<number>;
  activityLimits?: Map<number, ActivityLimitsVM>;
  styleScans: Map<number, StyleScanVM>;
  /** Command valgrind runs and its last run, per project. */
  valgrind?: Map<number, { command: string; run: ValgrindVM | null; history: ValgrindVM['history']; saving?: boolean; landedAt?: number;
    /** The Makefile builds with -g (null: no Makefile); `building` while -g is added and `make re` runs. */
    debug?: boolean | null; building?: boolean }>;
  readiness: Map<number, ReadinessVM>;
  functionRules: Map<number, { names: string[]; pending?: boolean; subject?: SubjectFunctionsVM; disabled?: boolean }>;
  reproductions: Map<number, ReproductionVM>;
  guided: Map<number, GuidedVM>;
  comparisonFiles?: Map<string, { loading: boolean; files: string[] | null }>;
  calendar?: CalendarVM | null;
  /** The range last asked of the host, so a render asks once. */
  calendarRequested?: string;
  calendarSlots: Map<number, { loading: boolean; slots: ActivitySlotVM[]; error?: string }>;
  calendarPeople: Map<number, { loading: boolean; people: Person[]; missing?: Person[] | null; error?: string }>;
  graderCommands?: Map<number, { command: string; error?: string; pending?: boolean }>;
  /** Profile pictures by login (data URI), `null` when the person has none. */
  avatars?: Map<string, string | null>;
  t: (key: string, params?: Record<string, string | number>) => string;
  post: (msg: WebviewMessage) => void;
  rerender: () => void;
  /** Ask the host for a project's grader, activities and local state (deduplicated by main.ts). */
  loadProject?: (projectId: number, peek?: boolean) => void;
  toast: (level: 'info' | 'warn' | 'error', text: string) => void;
}

export type { HostMessage };

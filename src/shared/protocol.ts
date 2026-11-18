import type {
  ActivityLimitsVM,
  ActivitySlotVM,
  ActivityVM,
  CalendarPrefs,
  CalendarVM,
  Person,
  AuthVM,
  GraderVM,
  ProjectVM,
  StyleScanVM,
  ValgrindVM,
  SubjectState,
  TestResultDetail,
} from './types';
import type {
  GuidedVM,
  ReadinessVM,
  ReproductionVM,
  SubjectFunctionsVM,
} from './deliveryTypes';
import type { RemoteStatus } from '../domain/remotePolicy';
import type { ApiActivitySnapshot } from '../domain/apiActivity';
import type { GuardSnapshot } from '../api/requestGuard';
import type { Palette } from './palette';

/**
 * Project panel tabs the host can open directly ('overview' is the details
 * tab).
 */
export type PanelTab =
  | 'overview'
  | 'grader'
  | 'valgrind'
  | 'history'
  | 'subject'
  | 'activities';

export interface StateSnapshot {
  apiActivity?: ApiActivitySnapshot;
  availability?: RemoteStatus;
  commitStates?: Record<
    number,
    {
      head: string;
      dirty: boolean;
      ahead?: number;
      hasUpstream?: boolean;
      dirtyCount?: number;
    } | null
  >;
  auth: AuthVM;
  /** The terms must be accepted before any sign-in. */
  termsAccepted: boolean;
  projects: ProjectVM[] | null;
  loading: boolean;
  error: string | null;
  /** Project that matches the folder currently opened in VS Code. */
  currentProjectId: number | null;
  lastUpdated: number | null;
  lang: 'en' | 'fr';
  /** Non-fatal problems (e.g. one status filter failed to load). */
  partialErrors: string[];
  /**
   * Requests to MyEpitech running or waiting, and whether they are paused after
   * a rate-limit answer.
   */
  network?: GuardSnapshot;
  /** Projects with a known local folder ("Open" reopens it). */
  localProjects?: number[];
  /** Colours chosen by the student; missing keys follow the theme. */
  palette?: Palette;
}

export type HostMessage =
  | {
      type: 'comparisonFiles';
      projectId: number;
      before: number;
      after: number;
      files: string[] | null;
    }
  | {
      type: 'graderCommand';
      projectId: number;
      command: string;
      error?: string;
    }
  | { type: 'selectTab'; tab: PanelTab }
  | { type: 'state'; state: StateSnapshot }
  | { type: 'grader'; projectId: number; grader: GraderVM }
  | {
      type: 'result';
      projectId: number;
      resultId: number;
      detail: TestResultDetail | null;
      error: string | null;
    }
  | { type: 'subject'; projectId: number; subject: SubjectState }
  | {
      type: 'activities';
      projectId: number;
      activities: ActivityVM[];
      error?: string;
      pending?: boolean;
      limits?: ActivityLimitsVM;
    }
  | { type: 'styleScan'; projectId: number; scan: StyleScanVM | null }
  | {
      type: 'valgrind';
      projectId: number;
      command: string;
      run: ValgrindVM | null;
      history: ValgrindVM['history'];
      debug?: boolean | null;
      building?: boolean;
    }
  | { type: 'readiness'; projectId: number; readiness: ReadinessVM | null }
  | { type: 'calendar'; calendar: CalendarVM }
  | {
      type: 'calendarSlots';
      eventId: number;
      slots: ActivitySlotVM[];
      error?: string;
    }
  | {
      type: 'calendarPeople';
      eventId: number;
      people: Person[];
      missing: Person[] | null;
      error?: string;
    }
  | {
      type: 'functionRules';
      projectId: number;
      names: string[];
      subject?: SubjectFunctionsVM;
      disabled?: boolean;
    }
  | {
      type: 'reproduction';
      projectId: number;
      reproduction: ReproductionVM | null;
    }
  | { type: 'guided'; projectId: number; guided: GuidedVM | null }
  | { type: 'avatars'; avatars: Record<string, string | null> }
  | { type: 'toast'; level: 'info' | 'warn' | 'error'; text: string };

export type WebviewMessage =
  | {
      type: 'loadComparisonFiles';
      projectId: number;
      before: number;
      after: number;
    }
  | { type: 'refreshRemoteCommit'; projectId: number }
  | { type: 'setGraderCommand'; projectId: number; command: string }
  | { type: 'ready'; surface: 'sidebar' | 'panel'; projectId?: number }
  | { type: 'openHome' }
  | { type: 'loadAvatars'; logins: string[] }
  | { type: 'signIn' }
  | { type: 'signInMicrosoft' }
  | { type: 'signInPaste' }
  | { type: 'submitRedirect'; url: string }
  | { type: 'cancelSignIn' }
  | { type: 'acceptTerms' }
  | { type: 'signOut' }
  | { type: 'refresh' }
  | { type: 'appeal' }
  | { type: 'uninstall' }
  | { type: 'fetchVersion' }
  | { type: 'reloadVSCode' }
  | { type: 'refreshVSCode' }
  | { type: 'openProject'; projectId: number; tab?: PanelTab }
  | { type: 'openCurrentProject' }
  | { type: 'loadProject'; projectId: number; peek?: boolean }
  | { type: 'focusProject'; projectId: number | null }
  | { type: 'setPalette'; palette: Palette }
  | { type: 'loadActivities'; projectId: number }
  | { type: 'testDefensePopup'; projectId: number }
  | {
      type: 'switchActivitySlot';
      projectId: number;
      activityId: number;
      fromSlotId: number;
      slotId: number;
    }
  | {
      type: 'changeActivitySlot';
      projectId: number;
      activityId: number;
      slotId: number;
      cancel: boolean;
    }
  | { type: 'runGrader'; projectId: number }
  | { type: 'runValgrind'; projectId: number }
  | { type: 'cancelValgrind'; projectId: number }
  | { type: 'addDebugFlag'; projectId: number }
  | { type: 'setValgrindCommand'; projectId: number; command: string }
  | { type: 'checkReadiness'; projectId: number }
  | { type: 'setFunctionRules'; projectId: number; names: string[] }
  | { type: 'setFunctionCheck'; projectId: number; enabled: boolean }
  | { type: 'loadCalendar'; from: string; to: string; force?: boolean }
  | { type: 'calendarSlots'; eventId: number }
  | { type: 'calendarPeople'; eventId: number }
  | { type: 'calendarRegister'; eventId: number; slotId?: number }
  | { type: 'calendarUnregister'; eventId: number }
  | { type: 'setCalendarPrefs'; prefs: CalendarPrefs }
  | { type: 'readSubjectFunctions'; projectId: number }
  | { type: 'cancelLocal'; projectId: number }
  | { type: 'configureChecks'; projectId: number; advanced?: boolean }
  | { type: 'guidedDelivery'; projectId: number }
  | { type: 'reviewChanges'; projectId: number }
  | {
      type: 'compareCommits';
      projectId: number;
      before: number;
      after: number;
    }
  | {
      type: 'reproduce';
      projectId: number;
      resultId: number;
      task: string;
      configure?: boolean;
    }
  | { type: 'scanStyle'; projectId: number }
  | {
      type: 'openFile';
      projectId: number;
      file: string;
      line: number;
      column: number;
      task?: string;
    }
  | { type: 'loadResult'; projectId: number; resultId: number }
  | { type: 'cloneProject'; projectId: number }
  | { type: 'openFolder'; projectId: number }
  | { type: 'loadSubject'; projectId: number; docId?: string }
  | { type: 'pickSubject'; projectId: number }
  | {
      type: 'openSubject';
      projectId: number;
      target: 'editor' | 'browser' | 'desktop' | 'binaries';
    }
  | { type: 'openExternal'; url: string }
  | { type: 'openCommit'; projectId: number; commit: string }
  | { type: 'copy'; text: string; what?: string };

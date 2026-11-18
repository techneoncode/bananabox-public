/**
 * Types shared between the extension host and the webview bundle.
 * Everything here must be JSON-serialisable (it crosses `postMessage`).
 */

export type ProjectStatus = 'ongoing' | 'upcoming' | 'past';

export interface Person {
  name: string;
  login: string;
}

export interface ProjectVM {
  id: number;
  name: string;
  /** Short description attached to the project itself. */
  description: string;
  unitName: string;
  unitCode: string;
  /** e.g. `STG-1` */
  instanceCode: string;
  schoolYear: number;
  startDate: string;
  endDate: string;
  endRegistrationDate: string | null;
  /** Mid-point of the project; estimated when the API does not provide one. */
  midDate: string;
  midEstimated: boolean;
  status: ProjectStatus;
  registered: boolean;
  registrationId: number | null;
  groupName: string | null;
  /**
   * Actual members of this registration; null until membership is available.
   */
  groupMemberCount: number | null;
  isGroupLeader: boolean | null;
  groupSizeMin: number;
  groupSizeMax: number;
  registrationsCount: number;
  repoEnabled: boolean;
  /**
   * Repository provided by project/registration metadata, or discovered from
   * results.
   */
  repoLink: string | null;
  subjectUrl: string | null;
  projectCode: string | null;
  hermesUrl: string | null;
  intranetUrl: string;
  responsibles: Person[];
  /**
   * Leader first, then the other members of my registration; empty when solo
   * or unknown.
   */
  groupMembers: Person[];
  peerEvaluation: boolean;
  unitDescription: string;
}

export type RunState =
  | 'submitted'
  | 'started'
  | 'completed'
  | 'failed'
  | string;

export interface GraderRun {
  id: number;
  state: RunState;
  /** Id of the matching test result once the run is completed. */
  resultId: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Quota {
  total: number;
  consumed: number;
  remaining: number;
  override: number | null;
}

export interface StyleCounts {
  fatal: number;
  major: number;
  minor: number;
  info: number;
}

export interface SkillBreakdown {
  name: string;
  count: number;
  passed: number;
  crashed: number;
  mandatoryFailed: number;
}

export interface TestResultSummary {
  id: number;
  date: string;
  commit: string | null;
  /** Percentage of passed tests, `null` when no test was executed. */
  score: number | null;
  passed: number;
  total: number;
  flags: string[];
  style: StyleCounts;
  prerequisitesMark: number | null;
  skills: SkillBreakdown[];
}

export interface TraceStep {
  label: string;
  ok: boolean | null;
  lines: string[];
}

export interface TestTask {
  name: string;
  status: 'passed' | 'failed' | 'unknown';
  count: number;
  passed: number;
  crashed: number;
  mandatoryFailed: number;
  steps: TraceStep[];
  trace: string;
}

export interface TestResultDetail extends TestResultSummary {
  tasks: TestTask[];
  rawTrace: string | null;
  staticTrace: string | null;
  coverage: {
    lines: [number, number] | null;
    branches: [number, number] | null;
    log: string | null;
  };
  makeError: string | null;
  deliveryError: string | null;
  bannedFunctions: string[] | null;
}

export interface GraderVM {
  /** Latest delivery reported by the Grader's /ta endpoint. */
  remoteCommit?: {
    status: 'loading' | 'ready' | 'unavailable' | 'error';
    sha: string | null;
    branch: string | null;
    commitUrl?: string | null;
    pushedAt?: string | null;
    checkedAt: number | null;
    error: string | null;
  };
  projectId: number;
  loading: boolean;
  error: string | null;
  quota: Quota | null;
  runs: GraderRun[];
  /** Oldest → newest. */
  history: TestResultSummary[];
  /** True while a run is queued or executing. */
  running: boolean;
  /** Whether the repo/registration needed to run the grader exists. */
  canRun: boolean;
  reason: string | null;
}

export interface AuthVM {
  status: 'signedOut' | 'signedIn' | 'expired';
  login: string | null;
  firstname: string | null;
  lastname: string | null;
  promotion: number | null;
  cursus: string | null;
  campus: string | null;
  expiresAt: number | null;
  busy: boolean;
  error: string | null;
  /**
   * Set while a Microsoft sign-in is in progress. `browser`: the user signs in
   * inside the window Bananabox opened (nothing to copy). `paste` (default):
   * the user must paste the address of the page they landed on.
   */
  pending: { url: string; mode?: 'browser' | 'paste' } | null;
}

/**
 * One PDF attached to a project, offered in the subject tab when there are
 * several.
 */
export interface SubjectDocVM {
  id: string;
  name: string;
  folder: string;
  size: number | null;
}

export type SubjectState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ready';
      name: string;
      base64: string;
      docId: string;
      documents: SubjectDocVM[];
      /** Attached files that are not PDFs (binaries, archives). */
      binaries?: number;
    }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; message: string };

/**
 * One entry of `my-activities`: kick-off, bootstrap and other sessions attached
 * to a project.
 */
export interface ActivityVM {
  id: number;
  name: string;
  kind: 'kickoff' | 'bootstrap' | 'midterm' | 'defense' | 'susie' | 'activity';
  startDate: string;
  endDate: string;
  mandatory: boolean;
  hasDocuments: boolean;
  /** Raw registration status reported by the API (e.g. `registered`). */
  status: string | null;
  eventId?: number | null;
  /**
   * Every event (window) of the activity: a defense may run 10:30–12:00 and
   * 14:00–18:00 as two events.
   */
  eventIds?: number[];
  windowRooms?: Record<number, string | null>;
  slots?: ActivitySlotVM[];
  slotsError?: string;
  location?: string | null;
  registrationDeadline?: string | null;
}

export interface ActivityLimitsVM {
  refreshAfter: number;
  changeAfter: number;
  rateLimited: boolean;
}

export interface ActivitySlotVM {
  id: number;
  startDate: string;
  endDate: string;
  available: boolean;
  mine: boolean;
  groupName: string | null;
  members: Person[];
  /** The event (window) the slot belongs to, and its room. */
  eventId?: number;
  room?: string | null;
}

/** A session of the student's calendar (`/api/events`). */
export interface CalendarEventVM {
  id: number;
  activityId: number;
  title: string;
  /**
   * "Defense", "Midterm Defense", "Kick-off"…: what slot preferences apply
   * to.
   */
  type: string;
  kind: ActivityVM['kind'];
  start: string;
  end: string;
  room: string | null;
  unitCode: string;
  /** Unit instance (`STG-1`) and school year: the unit's own routes. */
  unitInstance: string;
  schoolYear: number;
  unitName: string;
  projectId: number | null;
  /** Booked through time slots rather than a simple registration. */
  slots: boolean;
  registered: boolean;
  /**
   * Must be attended: a required session of a unit (and project) the student
   * is registered to.
   */
  required: boolean;
  /** The student already holds another session of the same activity. */
  alternative: boolean;
  /** Sessions of the same activity in the loaded range (one is enough). */
  sessions: number;
  mySlot: { start: string; end: string } | null;
  count: number;
  capacity: number | null;
  full: boolean;
  /** Registration closes at this time. */
  deadline: string | null;
  exam: boolean;
}

/**
 * A preferred slot: local time `HH:MM`, on a weekday (0 = Sunday) or any day
 * (`null`).
 */
export interface SlotPreference {
  day: number | null;
  time: string;
}

export interface CalendarPrefs {
  /** Register automatically to required sessions without slots. */
  autoRegister: boolean;
  /** Per event type, slots to book in this order as soon as one is free. */
  preferences: Array<{ type: string; slots: SlotPreference[] }>;
}

export interface CalendarVM {
  from: string;
  to: string;
  events: CalendarEventVM[] | null;
  loading: boolean;
  error: string | null;
  prefs: CalendarPrefs;
  /** Event being registered (manual or automatic). */
  pending: number | null;
  /** Latest automatic registrations and failures, newest first. */
  log: Array<{ at: number; text: string; ok: boolean }>;
}

export type StyleBucket = 'fatal' | 'major' | 'minor' | 'info';

export interface StyleIssueVM {
  /** Path relative to the project root, with `/` separators. */
  file: string;
  line: number;
  column: number;
  bucket: StyleBucket;
  rule: string | null;
  message: string;
}

/**
 * A block the program allocated and never freed, at the project line that
 * allocated it.
 */
export interface ValgrindLeakVM {
  /** Path relative to the project root, with `/` separators. */
  file: string;
  line: number;
  column: number;
  /**
   * Lost bytes, already in the unit the user picked (e.g. "1.2 kB"), and raw.
   */
  lost: string;
  bytes: number;
  /**
   * The allocating line as it reads now, and the allocator called on it
   * (`malloc`), for the source peek.
   */
  code?: string;
  allocator?: string;
}

/**
 * A memcheck error (invalid read, uninitialised value…), counted once per
 * kind and project line.
 */
export interface ValgrindErrorVM {
  kind: 'read' | 'write' | 'free' | 'uninit' | 'overlap' | 'other';
  /** Memcheck's own words: `Invalid read of size 4`. */
  what: string;
  /** Path relative to the project root, with `/` separators. */
  file: string;
  line: number;
  column: number;
  fn: string;
  /** Library function the project called when it happened (`strlen`). */
  via?: string;
  /**
   * `0 bytes after a block of size 40 alloc'd`, and the project line that
   * allocated or freed that block.
   */
  detail?: string;
  origin?: { fn: string; file: string; line: number };
  /** The project's frames, innermost first. */
  stack: Array<{ fn: string; file: string; line: number }>;
  /** Times it happened (a loop repeats it). */
  count: number;
  /** The line as it reads now, for the source peek. */
  code?: string;
}

/**
 * One finished check in a project's history; the last few carry their whole
 * report.
 */
export interface ValgrindCheck {
  at: number;
  bytes: number;
  lost: string;
  /**
   * Memcheck errors found (absent on checks recorded before errors were read).
   */
  errors?: number;
  run?: ValgrindVM;
}

/** Last valgrind check of a project's local copy. */
export interface ValgrindVM {
  status: 'running' | 'done' | 'error';
  /** Command run under valgrind (program and arguments). */
  command: string;
  leaks: ValgrindLeakVM[];
  /**
   * Memcheck errors at project lines (absent on checks recorded before errors
   * were read).
   */
  errors?: ValgrindErrorVM[];
  /** Errors entirely inside other libraries, left out. */
  errorsOmitted?: number;
  /** All the project's leaks added up, formatted, and in bytes. */
  lost: string;
  bytes: number;
  /**
   * Blocks allocated and freed over the run (memcheck's heap summary); null
   * when it printed none.
   */
  heap: {
    allocs: number;
    frees: number;
    bytes: number;
    allocated: string;
    /**
     * Bytes still allocated at exit (lost ones included), and the formatted
     * split: freed, and still reachable but never freed.
     */
    inUse?: number;
    freed?: string;
    reachable?: string;
  } | null;
  /** How long the program ran under valgrind. */
  durationMs: number;
  /**
   * Bytes lost by each finished check of this project, oldest first, this one
   * last.
   */
  history: ValgrindCheck[];
  /** Leaks from other libraries (SFML, X11…), left out. */
  omitted: number;
  /**
   * Leaks and errors without a source line: the program was built without
   * `-g`.
   */
  unlocated: number;
  /** Signal that killed the program (e.g. SIGSEGV). */
  signal: string | null;
  exitCode: number | null;
  error: 'not_installed' | 'no_command' | 'not_started' | 'cancelled' | null;
  /** Valgrind's last words when the program could not be started. */
  detail: string | null;
  /**
   * While running: the program's last output lines (valgrind's own `==pid==`
   * lines left out).
   */
  tail?: string[];
  /** When the check started (running) or ended. */
  at: number;
}

/**
 * Result of a local BananaLens run over a whole project (pre-flight check or
 * "locate" action).
 */
export interface StyleScanVM {
  projectId: number;
  status: 'running' | 'done' | 'error' | 'unavailable';
  source: 'manual' | 'preflight' | 'grader';
  summary: { fatal: number; major: number; minor: number; info: number };
  issues: StyleIssueVM[];
  truncated: boolean;
  files: number;
  scannedAt: number | null;
  durationMs: number;
  error: string | null;
}

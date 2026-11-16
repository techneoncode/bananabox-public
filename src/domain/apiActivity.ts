export interface EndpointActivity {
  method: 'GET' | 'POST' | 'DELETE';
  route: string;
  calls: number;
  rateLimitedResponses: number;
}

export interface ApiActivitySnapshot {
  startedAt: number;
  endpoints: EndpointActivity[];
}

const staticRoutes = new Set([
  '/api/auth/token', '/api/auth/refresh', '/api/auth/verify',
  '/api/students/profile', '/api/units/instances/projects',
]);

/**
 * Group known routes without retaining IDs, credentials, query parameters or
 * unknown path contents.
 */
export function activityRoute(path: string): string {
  const route = path.split(/[?#]/, 1)[0];
  if (staticRoutes.has(route)) return route;
  if (/^\/api\/students\/test-results\/[^/]+$/.test(route)) {
    return '/api/students/test-results/{resultId}';
  }
  if (/^\/api\/events\/[^/]+\/slots$/.test(route)) {
    return '/api/events/{eventId}/slots';
  }
  if (/^\/api\/events\/[^/]+\/slots\/[^/]+\/registrations$/.test(route)) {
    return '/api/events/{eventId}/slots/{slotId}/registrations';
  }
  const project =
    /^\/api\/units\/instances\/projects\/[^/]+(\/my-activities|\/test-results|\/related-resources\/files)?$/.exec(route);
  if (project) {
    return `/api/units/instances/projects/{projectId}${project[1] ?? ''}`;
  }
  if (/^\/api\/units\/[^/]+\/[^/]+\/[^/]+\/projects\/[^/]+\/registrations\/[^/]+\/ta$/.test(route)) {
    return '/api/units/{year}/{unitCode}/{instanceCode}/projects/{projectId}/registrations/{registrationId}/ta';
  }
  if (/^\/api\/units\/[^/]+\/[^/]+\/[^/]+\/projects\/[^/]+$/.test(route)) {
    return '/api/units/{year}/{unitCode}/{instanceCode}/projects/{projectId}';
  }

  return '/api/{other}';
}

/**
 * Local counters for one extension session. A server rate-limit response means
 * HTTP 429, never a guessed threshold.
 */
export class ApiActivity {
  private readonly entries = new Map<string, EndpointActivity>();
  private startedAt: number;
  private generation = 0;

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  begin(
    method: EndpointActivity['method'],
    path: string,
  ): (status: number) => void {
    const route = activityRoute(path);
    const key = `${method} ${route}`;
    const entry = this.entries.get(key)
      ?? { method, route, calls: 0, rateLimitedResponses: 0 };
    entry.calls++;
    this.entries.set(key, entry);
    const generation = this.generation;
    let completed = false;
    return status => {
      if (completed || generation !== this.generation) return;
      completed = true;
      if (status === 429) entry.rateLimitedResponses++;
    };
  }

  snapshot(): ApiActivitySnapshot {
    return {
      startedAt: this.startedAt,
      endpoints: [...this.entries.values()]
        .map(entry => ({ ...entry }))
        .sort((a, b) => b.calls - a.calls
          || a.route.localeCompare(b.route)
          || a.method.localeCompare(b.method)),
    };
  }

  clear(): void {
    this.generation++;
    this.entries.clear();
    this.startedAt = this.now();
  }
}

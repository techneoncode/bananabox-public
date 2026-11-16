import type { Ctx } from '../ctx';
import { h, icon } from '../dom';
import { chip } from '../ui';

/** Local, observed request counters; shown so a revoked user can see their own recent traffic. */
export function renderEndpointActivity(ctx: Ctx): HTMLElement {
  const endpoints = ctx.state.apiActivity?.endpoints ?? [];
  return h('details.endpoint-activity', { 'aria-label': ctx.t('availability.endpointActivity'), dataset: { detailId: 'endpoint-activity' } },
    h('summary', icon('chevron-right', 'chev'), ctx.t('availability.endpointActivity'), chip('', ctx.t('availability.localSession'))),
    h('p.muted.small', ctx.t('availability.activityScope')),
    endpoints.length === 0 ? h('p.muted.small', ctx.t('availability.activityEmpty'))
      : h('div.endpoint-table-scroll', h('table.endpoint-table',
        h('thead', h('tr',
          h('th', { scope: 'col' }, ctx.t('availability.endpoint')),
          h('th', { scope: 'col', style: { textAlign: 'right' } }, ctx.t('availability.observedCalls')),
          h('th', { scope: 'col', style: { textAlign: 'right' } }, 'HTTP 429'))),
        h('tbody', ...endpoints.map(endpoint => h('tr',
          h('td', chip('', endpoint.method), h('code', endpoint.route)),
          h('td.mono', String(endpoint.calls)),
          h('td.mono', { class: endpoint.rateLimitedResponses > 0 ? 'ic-danger' : 'muted' }, String(endpoint.rateLimitedResponses))))))));
}

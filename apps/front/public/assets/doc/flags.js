// Eligibility flags shown while a run is still going: what the company cannot meet, cited to the buyer's clause and page.
import { h, icon } from '../ui.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const cite = (r) => [r.clause, r.page ? `p. ${r.page}` : null].filter(Boolean).join(' · ');
const short = (s, n = 120) => (String(s).length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s));

/** rows: check_eligibility output [{ clause, page, text, status: met|to_confirm|gap, remark }]. Returns null until there are rows. */
export function eligibilityFlags(rows) {
  const all = arr(rows);
  if (!all.length) return null;
  const gaps = all.filter((r) => r.status === 'gap'), confirm = all.filter((r) => r.status === 'to_confirm'), met = all.filter((r) => r.status === 'met');
  const head = gaps.length ? `${gaps.length} eligibility gap${gaps.length > 1 ? 's' : ''}` : 'No eligibility gaps';
  return h('section.rq-flags', { 'aria-label': 'Eligibility check' },
    h('div.rq-flags-head', h('strong', head), h('span.xs.muted', `${all.length} conditions checked · ${met.length} met · ${confirm.length} to confirm`)),
    gaps.map((r) => h('div.rq-flag.gap',
      h('span.rq-flag-ico', icon('x', 11)),
      h('div', h('div.rq-flag-t', cite(r) ? h('b.rq-flag-c', cite(r)) : null, short(r.text)), h('div.rq-flag-r', r.remark)))),
    confirm.slice(0, gaps.length ? 1 : 2).map((r) => h('div.rq-flag.confirm',
      h('span.rq-flag-ico', '?'),
      h('div', h('div.rq-flag-t', cite(r) ? h('b.rq-flag-c', cite(r)) : null, short(r.text, 90)), h('div.rq-flag-r', r.remark)))));
}

/** Signature so callers re-render the panel only when the verdicts change. */
export const flagsSig = (rows) => arr(rows).map((r) => `${r.clause}|${r.status}`).join(',');

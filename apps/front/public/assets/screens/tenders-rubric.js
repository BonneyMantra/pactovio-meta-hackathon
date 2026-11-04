// The explainable fit rubric on a worldwide tender card: four weighted sub-scores with their evidence, the verdict and top risk,
// then (expandable) requirement → SKU coverage, the cited past proposals with outcome, and the eligibility checks.
import { h, icon } from '../ui.js';
import { modelChip } from '../doc/rail.js';

const VERDICT = { bid: ['Bid', 'ok'], bid_with_conditions: ['Bid with conditions', 'warn'], pass: ['Pass', 'bad'] };
const COVER = { full: ['check', 'ok', 'Covered'], partial: ['dot', 'warn', 'Partly covered'], none: ['x', 'bad', 'Not covered'] };
const CHECK = { ok: ['check', 'ok'], risk: ['x', 'bad'], unknown: ['dot', 'muted'] };
const tone = (s) => (s >= 70 ? 'ok' : s >= 45 ? 'warn' : 'bad');
const modelName = (m) => (/wonder/i.test(m || '') ? 'Muse Wonder' : 'Muse Spark');
const inr = (v) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)} Cr` : `₹${(v / 1e5).toFixed(1)} L`);

export const verdictChip = (rb) => { const [label, t] = VERDICT[rb.verdict] || [rb.verdict, '']; return h(`span.chip.${t}.tw-verdict`, h('span.dot'), label); };

function bars(rb) {
  const req = rb.requirements || [], covered = req.filter((r) => r.coverage === 'full').length, part = req.filter((r) => r.coverage === 'partial').length;
  const el = rb.eligibility || [], n = (s) => el.filter((e) => e.status === s).length;
  const rows = [
    ['Capability fit', 'capability', `${covered} of ${req.length} requirements covered${part ? `, ${part} partly` : ''} · ${rb.coverage_pct}%`],
    ['Track record', 'track_record', rb.track_note],
    ['Eligibility', 'eligibility', [`${n('ok')} ok`, n('risk') ? `${n('risk')} risk` : null, n('unknown') ? `${n('unknown')} not stated` : null].filter(Boolean).join(' · ')],
    ['Commercial fit', 'commercial', rb.commercial?.note],
  ];
  return h('div.tw-rubric', rows.map(([label, k, note]) => {
    const s = rb.scores?.[k] ?? 0;
    return h('div.tw-bar',
      h('div.tw-bar-top', h('span.tw-bar-l', label, h('span.tw-w', `${rb.weights?.[k] ?? 0}%`)), h('span.num.tw-bar-n', String(s))),
      h('div.tw-track', h('span', { class: tone(s), style: { width: `${Math.max(2, s)}%` } })),
      note ? h('div.xs.muted.tw-note', note) : null);
  }),
  h('div.xs.muted.tw-formula', `Fit ${rb.capped ? rb.weighted : rb.overall} = ${['capability', 'track_record', 'eligibility', 'commercial'].map((k) => `${rb.weights[k]}% × ${rb.scores[k]}`).join(' + ')}`,
    rb.capped ? h('span.tw-cap', ` · capped at ${rb.overall}: the catalogue covers under 30% of the requirements`) : null));
}

function details(rb) {
  const reqs = h('div.tw-sec', h('div.ps-k', `Requirements → your catalogue · ${rb.coverage_pct}% covered`),
    h('ul.tw-reqs', (rb.requirements || []).map((r) => {
      const [ic, t, label] = COVER[r.coverage] || COVER.none;
      return h('li', h(`span.tw-ico.${t}`, { title: label }, icon(ic, 12)), h('div', { style: { minWidth: 0 } }, h('div.small', r.text),
        r.products?.length ? h('div.tw-prods', r.products.map((p) => h('span.chip.outline', { title: p.sku }, p.name, h('b', p.sku)))) : h('div.xs.muted', label)));
    })));
  const past = h('div.tw-sec', h('div.ps-k', 'Most similar past proposals'),
    rb.past?.length ? h('ul.tw-reqs', rb.past.map((p) => h('li', h(`span.tw-ico.${p.outcome === 'won' ? 'ok' : p.outcome === 'lost' ? 'bad' : 'muted'}`, icon(p.outcome === 'won' ? 'check' : p.outcome === 'lost' ? 'x' : 'dot', 12)),
      h('div', { style: { minWidth: 0 } },
        h('div.small', h('b', p.client), ` · ${p.ref}`, h(p.outcome === 'won' ? 'span.tw-won' : 'span.tw-lost', p.outcome === 'won' ? 'Won' : p.outcome === 'lost' ? 'Lost' : 'Pending')),
        h('div.xs.muted', [p.sector, String(p.solution_type || '').replace(/_/g, ' '), p.total_inr ? inr(p.total_inr) : null, `${p.similarity} similarity`].filter(Boolean).join(' · ')),
        p.why ? h('div.xs', p.why) : null))))
      : h('div.xs.muted', 'No comparable proposal in the Company Brain.'));
  const elig = h('div.tw-sec', h('div.ps-k', 'Eligibility and delivery checks'),
    h('ul.tw-reqs', (rb.eligibility || []).map((e) => { const [ic, t] = CHECK[e.status] || CHECK.unknown;
      return h('li', h(`span.tw-ico.${t}`, icon(ic, 12)), h('div', { style: { minWidth: 0 } }, h('div.small', { style: { fontWeight: 520 } }, e.check), h('div.xs.muted', e.note))); })));
  return h('div.tw-detail', reqs, h('div.tw-col', past, elig));
}

/** Rubric block for one card; `open` expands the evidence (the top card starts open). */
export function rubricBlock(rb, { open = false } = {}) {
  const more = details(rb);
  more.hidden = !open;
  const toggle = h('button.btn.btn-ghost.btn-xs', { type: 'button', 'aria-expanded': String(open), onclick: () => {
    more.hidden = !more.hidden; toggle.setAttribute('aria-expanded', String(!more.hidden)); toggle.lastChild.textContent = more.hidden ? 'Show the evidence' : 'Hide the evidence'; } },
  icon('down', 14), h('span', open ? 'Hide the evidence' : 'Show the evidence'));
  const read = rb.read || {};
  return h('div.tw-rb',
    bars(rb),
    h('div.tw-verdict-row', verdictChip(rb), h('span.small', rb.verdict_note)),
    rb.top_risk ? h('div.small.tw-risk', h('b', 'Top risk: '), rb.top_risk) : null,
    h('div.tw-src', h('span.xs.muted', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, 'Assessed by', modelChip(modelName(rb.model))),
      h('span.xs.muted', `read ${Number(read.chars || 0).toLocaleString('en')} characters of notice text${read.documents_url ? '; tender documents are on the buyer portal' : ''}`), h('span.wk-grow'), toggle),
    more);
}

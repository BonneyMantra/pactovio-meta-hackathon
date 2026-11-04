// #/brain — the Company Brain: what Pactovio has learned about the supplier (GET /api/brain).
import { h, icon, fmt, empty, errorBox, skeleton } from '../ui.js';
import { getBrain, brainProposals, productIndex } from '../brain-api.js';
import { inrShort } from '../doc/kit.js';
import { SOLUTION, VALUE, frac, pctTxt, shareBar, legend, hbars, columns, countUp } from '../brain/charts.js';
import { styleSection, profileCard } from '../brain/style.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const card = (title, sub, ...kids) => h('section.card.bb-card', h('div.bb-head', h('h3', title), sub ? h('div.xs.muted', sub) : null), ...kids);

export async function render(root, _p, ctx) {
  ctx.setCrumbs('Company Brain');
  root.classList.add('bb-page');
  root.replaceChildren(skeleton(6));
  let brain, products, rows;
  try { [brain, products, rows] = await Promise.all([getBrain(), productIndex(), brainProposals().catch(() => [])]); }
  catch (e) { root.replaceChildren(errorBox(e)); return; }
  const name = brain.profile?.name || ctx.session?.workspace?.name || 'your company';
  const s = brain.stats;
  root.replaceChildren(h('div.page-head',
    h('div', h('div.access-step', 'COMPANY BRAIN'), h('h1.title', `What Pactovio knows about ${name}`),
      h('div.sub', brain.learned_at ? `Learned ${fmt.date(brain.learned_at)} from your website, ${brain.catalogue_count ?? products.size} catalogue products and ${brain.proposals_learned} past proposals.` : 'Connect Google Drive and point Pactovio at your past proposals to teach it how you bid.')),
    h('div.pd-actions', h('a.btn.btn-secondary', { href: '#/brain/learning' }, icon('refresh', 15), s ? 'Learn again' : 'Start learning'), h('a.btn.btn-primary', { href: '#/agent' }, icon('spark', 15), 'Write a proposal'))));
  if (!s) {
    root.append(h('div.grid.bb-top', profileCard(brain.profile, brain.catalogue_count, products),
      h('section.card', empty('No proposals learned yet', 'Pactovio reads every past proposal in a Drive folder, then writes new ones in your structure, voice and pricing.', h('a.btn.btn-primary', { href: '#/brain/learning' }, 'Teach it from Drive')))));
    return;
  }
  const kpis = [
    ['Proposals learned', brain.proposals_learned, (v) => String(Math.round(v)), `${s.won} won · ${s.lost} lost · ${s.pending} open`],
    ['Win rate', s.win_rate == null ? null : frac(s.win_rate) * 100, (v) => `${Math.round(v)}%`, 'of decided bids'],
    ['Median deal', s.median_value_inr, (v) => inrShort(v), 'including GST'],
    ['Turnaround', s.avg_turnaround_days, (v) => `${v.toFixed(1)} d`, 'average, RFQ to submission'],
    ['Engineering', s.engineering_days_total, (v) => Math.round(v).toLocaleString('en-IN'), 'person-days quoted'],
    ['Catalogue', brain.catalogue_count ?? products.size, (v) => String(Math.round(v)), 'products priced in INR'],
  ];
  const kpiEls = kpis.map(([k, v, f, sub]) => { const n = h('div.v.num', '—'); setTimeout(() => countUp(n, Number(v), f), 120); return h('div.card.stat.bb-kpi', h('div.k', k), n, h('div.xs.muted', sub)); });
  const bst = s.by_solution_type || {};
  const seg = (by) => SOLUTION.map(([k, label, color]) => ({ key: k, label, color, value: by(bst[k] || {}), display: by === cnt ? `${bst[k]?.count ?? 0} proposals` : inrShort(bst[k]?.value_inr) }));
  const cnt = (x) => x.count || 0, val = (x) => x.value_inr || (x.value_share ? frac(x.value_share) : 0);
  const vs = s.value_share || {};
  const sectors = arr(s.by_sector).slice(0, 8).map((x) => ({ label: x.sector, value: x.count, display: `${x.won}/${x.count} won`,
    parts: [{ value: x.won, color: '#2f7d4f' }, { value: x.lost, color: '#c9c7c0' }, { value: Math.max(0, x.count - x.won - x.lost), color: '#e8e7e2' }],
    tip: [['Proposals', String(x.count)], ['Won', String(x.won)], ['Lost', String(x.lost)], ['Value', inrShort(x.value_inr)]] }));
  const regions = arr(s.by_region).map((x) => ({ label: x.region, value: x.count, display: String(x.count), tip: [['Proposals', String(x.count)], ['Value', inrShort(x.value_inr)]] }));
  root.append(
    h('div.grid.bb-top', profileCard(brain.profile, brain.catalogue_count, products), h('div.grid.g3.bb-kpis', kpiEls)),
    card('What you sell, and how', 'Every proposal classified by how much of it is your own product',
      h('div.bb-mix',
        h('div', shareBar(seg(cnt), { label: 'By number of proposals', height: 22 }), shareBar(seg(val), { label: 'By value', height: 22 }),
          legend(SOLUTION.map(([k, l, c]) => [k, l, c, `${bst[k]?.count ?? 0} · ${pctTxt(bst[k]?.value_share)}`]))),
        h('div', shareBar(VALUE.map(([k, label, color]) => ({ label, color, value: frac(vs[k]) })), { label: 'Where the money goes, across all line items', height: 22 }),
          legend(VALUE.map(([k, l, c]) => [k, l, c, pctTxt(vs[k])])),
          s.typical_margin_note ? h('div.bb-note', icon('spark', 15), s.typical_margin_note) : null))),
    h('div.grid.g2',
      card('Deal size', `Median ${inrShort(s.median_value_inr)} · darker share is won`, columns(arr(s.value_bands).map((b) => ({ label: b.label, count: b.count, won: b.won })))),
      card('Sectors', 'Won · lost · open, by number of proposals', hbars(sectors), h('div.bc-legend', h('span', h('i', { style: { background: '#2f7d4f' } }), 'Won'), h('span', h('i', { style: { background: '#c9c7c0' } }), 'Lost'), h('span', h('i', { style: { background: '#e8e7e2' } }), 'Open')))),
    h('div.grid.g2',
      card('Regions', 'Where your proposals went', hbars(regions)),
      card('Products you quote most', 'By value across learned proposals', h('div.bb-prods', arr(s.top_products).slice(0, 6).map((p) => h('div.bb-prod',
        h('span.pd-thumb', products.get(p.sku)?.thumb ? h('img', { src: products.get(p.sku).thumb, alt: '' }) : p.sku.slice(3, 6)),
        h('div', h('div.small', products.get(p.sku)?.name || p.description), h('div.xs.muted.mono', p.sku)),
        h('div.r', h('div.small.num', inrShort(p.value_inr)), h('div.xs.muted', `${p.qty} units · ${p.proposals} bids`))))))),
    card('How you write', 'Learned from your proposals; every rule cites at least two of them', styleSection(brain.style)),
    rows.length ? learnedTable(rows) : null);
}

function learnedTable(rows) {
  let all = false;
  const body = h('tbody'), more = h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { all = !all; draw(); } });
  const tone = { won: 'ok', lost: '', pending: 'info' };
  function draw() {
    body.replaceChildren(...(all ? rows : rows.slice(0, 8)).map((r) => h('tr', h('td.mono.xs', r.ref), h('td.small', r.client, h('div.xs.muted', [r.sector, r.city].filter(Boolean).join(' · '))),
      h('td.small.ink2', SOLUTION.find(([k]) => k === r.solution_type)?.[1] || r.solution_type), h('td.r.small.num', inrShort(r.total_inr)), h('td', h(`span.chip.${tone[r.outcome] || ''}`, h('span.dot'), r.outcome)))));
    more.textContent = all ? 'Show fewer' : `Show all ${rows.length}`;
  }
  draw();
  return card('Learned from', `${rows.length} proposals read from Google Drive`, h('div.wk-scroll', h('table.table', h('thead', h('tr', h('th', 'Ref'), h('th', 'Client'), h('th', 'Solution'), h('th.r', 'Value'), h('th', 'Outcome'))), body)), rows.length > 8 ? more : null);
}

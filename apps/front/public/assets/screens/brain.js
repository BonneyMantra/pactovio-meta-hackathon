// #/brain — the Company Brain: what the company's agent has learned (GET /api/brain, GET /api/brain/proposals).
// Every figure is computed server-side from the extracted proposals; the screen only arranges it.
import { h, icon, fmt, empty, errorBox, skeleton } from '../ui.js';
import { brainProposals, productIndex } from '../brain-api.js';
import { inrShort } from '../doc/kit.js';
import { SOLUTION, VALUE, frac, pctTxt, shareBar, legend, hbars, columns, countUp } from '../brain/charts.js';
import { styleSection, profileCard } from '../brain/style.js';
import { agentAvatar, loadBrain, possessive, shortName } from '../agent-id.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const card = (title, sub, ...kids) => h('section.card.bb-card', h('div.bb-head', h('h3', title), sub ? h('div.xs.muted', sub) : null), ...kids);
const WON = '#2f7d4f', LOST = '#c9c7c0', OPEN = '#e8e7e2';
const OUTCOME = { won: ['ok', 'Won'], lost: ['', 'Lost'], pending: ['info', 'Open'] };

/** Won count per value band, from the learned proposal index (the stats API sends counts only). */
function bandsWithWins(bands, rows) {
  return arr(bands).map((b) => ({ label: b.label, count: b.count,
    won: rows.length ? rows.filter((r) => r.outcome === 'won' && r.total_inr >= b.min_inr && (b.max_inr == null || r.total_inr < b.max_inr)).length : undefined }));
}

/** Top regions; the long tail becomes one footnote so it never swamps the bars. */
function regionCard(list, top = 8) {
  const xs = arr(list), tail = xs.slice(top);
  const rows = xs.slice(0, top).map((x) => ({ label: x.region, value: x.count, display: String(x.count), tip: [['Proposals', String(x.count)], ['Value', inrShort(x.value_inr)]] }));
  const n = tail.reduce((a, x) => a + x.count, 0);
  return card('Regions', `${xs.length} places · where your proposals went`, hbars(rows),
    tail.length ? h('div.xs.muted', { style: { marginTop: '10px' } }, `+ ${n} more proposals across ${tail.length} other places: ${tail.slice(0, 6).map((x) => x.region).join(', ')}${tail.length > 6 ? '…' : ''}`) : null);
}

export async function render(root, _p, ctx) {
  ctx.setCrumbs('Company Brain');
  root.classList.add('bb-page');
  root.replaceChildren(skeleton(6));
  let brain, products, rows;
  try {
    [brain, products, rows] = await Promise.all([loadBrain(ctx, { fresh: true }), productIndex(), brainProposals().catch(() => [])]);
    if (!brain) throw new Error('The Company Brain could not be loaded. Try again in a moment.');
  } catch (e) { root.replaceChildren(errorBox(e)); return; }
  const company = shortName(brain.profile?.legal_name || brain.profile?.name || ctx.session?.workspace?.name);
  const s = brain.stats;
  const catalogue = brain.catalogue_count ?? products.size;
  root.replaceChildren(h('div.page-head',
    h('div.bb-title', agentAvatar(ctx.session?.workspace?.name, 44),
      h('div', h('div.access-step', 'COMPANY BRAIN'), h('h1.title', `What I know about ${company}`),
        h('div.sub', brain.learned_at ? `Learned ${fmt.date(brain.learned_at)} from your website, ${catalogue} HubSpot products and ${brain.proposals_learned} past proposals in Google Drive.` : 'Connect Google Drive and point me at your past proposals to learn how you bid.'))),
    h('div.pd-actions', h('a.btn.btn-secondary', { href: '#/brain/learning' }, icon('refresh', 15), s ? 'Learn again' : 'Start learning'), h('a.btn.btn-primary', { href: '#/today' }, icon('spark', 15), 'Write a proposal'))));
  if (!s) {
    root.append(h('div.grid.bb-top', profileCard(brain.profile, catalogue, products),
      h('section.card', empty('No proposals learned yet', `I read every past proposal in a Drive folder, then write new ones in ${possessive(company)} structure, voice and pricing.`, h('a.btn.btn-primary', { href: '#/brain/learning' }, 'Teach me from Drive')))));
    return;
  }
  const kpis = [
    ['Proposals learned', brain.proposals_learned, (v) => String(Math.round(v)), `${s.won} won · ${s.lost} lost · ${s.pending} open`],
    ['Win rate', s.win_rate == null ? null : frac(s.win_rate) * 100, (v) => `${Math.round(v)}%`, 'of decided bids'],
    ['Median deal', s.median_value_inr, (v) => inrShort(v), 'including GST'],
    ['Turnaround', s.avg_turnaround_days, (v) => `${v.toFixed(1)} d`, 'average, RFQ to submission'],
    ['Engineering', s.engineering_days_total, (v) => Math.round(v).toLocaleString('en-IN'), 'person-days quoted'],
    ['Catalogue', catalogue, (v) => String(Math.round(v)), 'products priced in INR'],
  ];
  const kpiEls = kpis.map(([k, v, f, sub]) => { const n = h('div.v.num', '—'); setTimeout(() => countUp(n, Number(v), f), 120); return h('div.card.stat.bb-kpi', h('div.k', k), n, h('div.xs.muted', sub)); });
  const bst = s.by_solution_type || {};
  const cnt = (x) => x.count || 0, val = (x) => x.value_inr || (x.value_share ? frac(x.value_share) : 0);
  const seg = (by) => SOLUTION.map(([k, label, color]) => ({ key: k, label, color, value: by(bst[k] || {}), display: by === cnt ? `${bst[k]?.count ?? 0} proposals` : inrShort(bst[k]?.value_inr) }));
  const vs = s.value_share || {};
  const sectors = arr(s.by_sector).slice(0, 8).map((x) => ({ label: x.sector, value: x.count, display: `${x.won}/${x.count} won`,
    parts: [{ value: x.won, color: WON }, { value: x.lost, color: LOST }, { value: Math.max(0, x.count - x.won - x.lost), color: OPEN }],
    tip: [['Proposals', String(x.count)], ['Won', String(x.won)], ['Lost', String(x.lost)], ['Value', inrShort(x.value_inr)]] }));
  const prods = arr(s.top_products).slice(0, 8);
  root.append(
    h('div.grid.bb-top', profileCard(brain.profile, catalogue, products),
      h('div.bb-right', h('div.grid.g3.bb-kpis', kpiEls),
        card('Deal size', `Median ${inrShort(s.median_value_inr)} · darker share is won`, columns(bandsWithWins(s.value_bands, rows))))),
    card('What you sell, and how', 'Every proposal classified by how much of it is your own product',
      h('div.bb-mix',
        h('div', shareBar(seg(cnt), { label: 'By number of proposals', height: 22 }), shareBar(seg(val), { label: 'By value', height: 22 }),
          legend(SOLUTION.map(([k, l, c]) => [k, l, c, `${bst[k]?.count ?? 0} · ${pctTxt(bst[k]?.value_share)}`]))),
        h('div', shareBar(VALUE.map(([k, label, color]) => ({ label, color, value: frac(vs[k]) })), { label: 'Where the money goes, across all line items', height: 22 }),
          legend(VALUE.map(([k, l, c]) => [k, l, c, pctTxt(vs[k])])),
          s.typical_margin_note ? h('div.bb-note', icon('spark', 15), s.typical_margin_note) : null))),
    h('div.grid.g2',
      card('Sectors', 'Won · lost · open, by number of proposals', hbars(sectors), h('div.bc-legend', h('span', h('i', { style: { background: WON } }), 'Won'), h('span', h('i', { style: { background: LOST } }), 'Lost'), h('span', h('i', { style: { background: OPEN } }), 'Open'))),
      regionCard(s.by_region)),
    card('Products you quote most', 'By value across learned proposals; I price new bids from the same catalogue', h('div.bb-prods.bb-prods-2', prods.map((p) => h('div.bb-prod',
      h('span.pd-thumb', products.get(p.sku)?.thumb ? h('img', { src: products.get(p.sku).thumb, alt: '' }) : icon('box', 18)),
      h('div', { style: { minWidth: 0 } }, h('div.small.wk-ellipsis', products.get(p.sku)?.name || p.description), h('div.xs.muted.mono', p.sku)),
      h('div.r', h('div.small.num', inrShort(p.value_inr)), h('div.xs.muted', `${p.qty} units · ${p.proposals} bids`)))))),
    card('How you write', 'Learned from your proposals; every rule cites at least two of them', styleSection(brain.style)),
    rows.length ? learnedTable(rows) : null);
}

function learnedTable(rows) {
  let all = false;
  const body = h('tbody'), more = h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { all = !all; draw(); } });
  function draw() {
    body.replaceChildren(...(all ? rows : rows.slice(0, 8)).map((r) => {
      const [tone, label] = OUTCOME[r.outcome] || ['', r.outcome];
      return h('tr', h('td.mono.xs', r.ref), h('td.small', r.client, h('div.xs.muted', [r.sector, r.city].filter(Boolean).join(' · '))),
        h('td.small.ink2', SOLUTION.find(([k]) => k === r.solution_type)?.[1] || r.solution_type), h('td.r.small.num', inrShort(r.total_inr)), h('td', h(`span.chip${tone ? `.${tone}` : ''}`, h('span.dot'), label)));
    }));
    more.textContent = all ? 'Show fewer' : `Show all ${rows.length}`;
  }
  draw();
  const won = rows.filter((r) => r.outcome === 'won').length;
  return card('Learned from', `${rows.length} proposals read from Google Drive · ${won} won${rows.some((r) => r.outcome_source === 'hubspot') ? ' · outcomes from HubSpot deals' : ''}`, h('div.wk-scroll', h('table.table.bb-learned', h('thead', h('tr', h('th', 'Ref'), h('th', 'Client'), h('th', 'Solution'), h('th.r', 'Value'), h('th', 'Outcome'))), body)), rows.length > 8 ? more : null);
}

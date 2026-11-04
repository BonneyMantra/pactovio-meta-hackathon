// /trace: draws one production run from /assets/trace/run.json (exported read-only from proposal_steps).
// All data text goes in through textContent; nothing from the JSON is parsed as HTML.
import { drawFloorplan } from './trace-floorplan.js';

const MODELS = {
  'meta:muse-wonder-1.0': { name: 'Muse Wonder 1.0', c: 'var(--m-wonder)' },
  'meta:muse-spark-1.3': { name: 'Muse Spark 1.3', c: 'var(--m-spark)' },
  'meta:sam-3.1': { name: 'SAM 3.1', c: 'var(--m-sam)' },
  'meta:muse-image-1.0': { name: 'Muse Image 1.0', c: 'var(--m-image)' },
  code: { name: 'Code, no model', c: 'var(--m-code)' },
};
const STAGES = {
  read_rfq: ['Read the RFQ pack', 'Native PDF + drawing, page-cited requirements'],
  check_eligibility: ['Check eligibility', 'Each condition: met, to confirm or gap'],
  select_solution: ['Select from the catalogue', 'Lexical shortlist, Spark picks SKUs'],
  compose_bom: ['Price the bill of materials', 'Narrative by Spark, totals in code'],
  design_architecture: ['Design the architecture', 'Nodes, links and alarm zones'],
  floor_plan: ['Place devices on the floor plan', 'SAM 3.1 boxes, Spark names them'],
  compliance_matrix: ['Build the compliance matrix', 'Every requirement answered'],
  concept_visual: ['Generate the concept visual', 'Muse Image, captioned as generated'],
  claim_check: ['Check every claim', 'Unsupported sentences struck'],
};

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('--')) el.style.setProperty(k, v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
};
const $ = (id) => document.getElementById(id);
const usd = (n) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
const secs = (s) => (s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)}s` : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`);
const int = (n) => n.toLocaleString('en-US');
const inr = (n) => `₹${n.toLocaleString('en-IN')}`;
const modelsOf = (s) => (s.models.length ? s.models : ['code']);
const meta = (id) => MODELS[id] ?? { name: id, c: 'var(--ink-3)' };

function facts(d) {
  const tokens = d.steps.reduce((a, s) => a + s.tokens_in + s.tokens_out, 0) + d.run.orchestrate.tokens_in + d.run.orchestrate.tokens_out;
  const rows = [
    ['Wall time', secs(d.run.wall_s), null], ['Model cost', usd(d.run.cost_usd), 'list price'],
    ['Meta models', '4', 'of 5'], ['Tokens', int(Math.round(tokens / 1000)), 'k'],
    ['Evidence items', String(d.result.evidence), null], ['Claims struck', String(d.result.struck), 'of 30'],
  ];
  $('tr-facts').replaceChildren(...rows.map(([k, v, u]) => h('div', {}, h('dt', {}, k), h('dd', {}, v, u ? h('small', {}, u) : null))));
}

function legend() {
  $('tr-legend').replaceChildren(...Object.values(MODELS).map((m) => h('span', { '--c': m.c }, h('i'), m.name)));
}

function detail(d, s) {
  const box = $('tr-detail');
  if (!s) {
    const o = d.run.orchestrate;
    box.replaceChildren(
      h('div', {}, h('h3', {}, 'Muse Wonder 1.0 orchestrated this run'), h('p', {}, `Wonder decided the order of the nine bid tools, one per turn, and replied DONE at the end. Its own turns cost ${usd(o.cost_usd)} of the run's ${usd(d.run.cost_usd)}. If Wonder errors, the same tools run on Muse Spark and the run is labelled as a fallback. Select a stage to see its call.`)),
      h('dl', { class: 'tr-kv' }, ...kv([['Orchestrator', 'meta:muse-wonder-1.0@medium'], ['Tool calls', '9'], ['Wonder tokens in / out', `${int(o.tokens_in)} / ${int(o.tokens_out)}`], ['Wonder cost', usd(o.cost_usd)]])),
    );
    return;
  }
  const [title, sub] = STAGES[s.name] ?? [s.name, ''];
  box.replaceChildren(
    h('div', {}, h('h3', {}, title), h('p', {}, s.summary || sub),
      h('div', { class: 'tr-chips' }, ...modelsOf(s).map((m) => h('span', { class: 'tr-chip', '--c': meta(m).c }, h('i'), meta(m).name)))),
    h('dl', { class: 'tr-kv' }, ...kv([
      ['Started', `+${secs(s.start_s)}`], ['Duration', secs(s.end_s - s.start_s)],
      ['Tokens in / out', s.models.length ? `${int(s.tokens_in)} / ${int(s.tokens_out)}` : '0 / 0'], ['Cost', s.cost_usd ? usd(s.cost_usd) : '$0'],
    ])),
  );
}
const kv = (pairs) => pairs.flatMap(([k, v]) => [h('div', {}, h('dt', {}, k), h('dd', {}, v))]);

function gantt(d) {
  const W = d.run.wall_s;
  const pct = (t) => `${((t / W) * 100).toFixed(3)}%`;
  const stepMin = 60;
  const ticks = [];
  for (let t = 0; t <= W; t += stepMin) ticks.push(h('span', { style: { left: pct(t) } }, `${t / 60}m`));
  const grid = () => ticks.slice(1).map((_, i) => h('i', { class: 'tr-gl', style: { left: pct((i + 1) * stepMin) } }));
  const rows = [h('div', { class: 'tr-axis', 'aria-hidden': 'true' }, h('span'), h('div', { class: 'tr-ticks' }, ...ticks))];
  const orch = h('div', { class: 'tr-row orch', role: 'listitem', tabindex: '0', 'aria-selected': 'true', 'aria-label': 'Muse Wonder 1.0, orchestrator, 9 tool calls' },
    h('div', { class: 'tr-lab' }, h('b', {}, 'Muse Wonder 1.0'), h('small', {}, 'Orchestrator · 9 tool calls')),
    h('div', { class: 'tr-track' }, ...grid(),
      h('div', { class: 'tr-bar orchbar', style: { left: '0', width: '100%' } }),
      ...d.steps.map((s, i) => h('span', { class: 'tr-dot', title: `Calls ${s.name}`, style: { left: pct(s.start_s) }, '--at': `${i * 160}ms` }))));
  rows.push(orch);
  d.steps.forEach((s, i) => {
    const ms = modelsOf(s);
    const [title, sub] = STAGES[s.name] ?? [s.name, ''];
    const bar = h('div', { class: `tr-bar${ms.length > 1 ? ' mixed' : ''}${s.end_s / W > 0.8 ? ' end' : ''}`, '--c': meta(ms[0]).c, '--c2': meta(ms[1] ?? ms[0]).c, '--at': `${i * 160}ms`, '--d': `${Math.max(240, ((s.end_s - s.start_s) / W) * 4000)}ms`, style: { left: pct(s.start_s), width: pct(s.end_s - s.start_s) } },
      h('span', { class: 't' }, `${secs(s.end_s - s.start_s)} · ${s.cost_usd ? usd(s.cost_usd) : '$0'}`));
    rows.push(h('div', { class: 'tr-row', role: 'listitem', tabindex: '0', 'aria-selected': 'false', 'data-i': String(i), 'aria-label': `${title}, ${secs(s.end_s - s.start_s)}, ${ms.map((m) => meta(m).name).join(' and ')}` },
      h('div', { class: 'tr-lab' }, h('b', {}, title), h('small', {}, ms.map((m) => meta(m).name).join(' + ') + ' · ' + sub)),
      h('div', { class: 'tr-track' }, ...grid(), bar)));
  });
  const g = $('tr-gantt');
  g.replaceChildren(...rows);
  const select = (row) => {
    for (const r of g.querySelectorAll('.tr-row')) r.setAttribute('aria-selected', String(r === row));
    detail(d, row.dataset.i ? d.steps[Number(row.dataset.i)] : null);
  };
  g.addEventListener('click', (e) => { const row = e.target.closest('.tr-row'); if (row) select(row); });
  g.addEventListener('keydown', (e) => {
    const row = e.target.closest('.tr-row');
    if (!row) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(row); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const sib = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling; if (sib?.classList.contains('tr-row')) { sib.focus(); select(sib); } }
  });
  const replay = () => { g.classList.remove('tr-anim'); void g.offsetWidth; g.classList.add('tr-anim'); };
  $('tr-replay').addEventListener('click', replay);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { replay(); io.disconnect(); } }, { threshold: 0.35 });
    io.observe(g);
  }
  detail(d, null);
}

function costs(d) {
  const rows = [...d.steps.filter((s) => s.cost_usd > 0), { name: 'orchestrate', models: d.run.orchestrate.models, cost_usd: d.run.orchestrate.cost_usd }]
    .sort((a, b) => b.cost_usd - a.cost_usd);
  const max = rows[0].cost_usd;
  const label = (s) => (s.name === 'orchestrate' ? 'Wonder’s own turns' : STAGES[s.name]?.[0] ?? s.name);
  const spark = d.steps.filter((s) => s.models.length === 1 && s.models[0] === 'meta:muse-spark-1.3').reduce((a, s) => a + s.cost_usd, 0);
  $('tr-cost').replaceChildren(
    ...rows.map((s) => h('div', { class: 'tr-crow' }, h('span', {}, label(s)), h('div', { class: 'bar', '--c': meta(s.models[0]).c, style: { width: `${(s.cost_usd / max) * 100}%` } }), h('span', { class: 'v' }, usd(s.cost_usd)))),
    h('div', { class: 'tr-ctot' }, h('span', {}, 'Spark-only stages ', h('b', {}, usd(spark)), ' · stages with SAM 3.1 or Muse Image are shown whole, not split by model'), h('span', {}, 'Total ', h('b', {}, usd(d.run.cost_usd)))),
  );
}

function cards(d) {
  const r = d.result, g = r.go_no_go, b = g.basis;
  const card = (k, big, chip, body, how) => h('div', { class: 'card tr-card' }, h('p', { class: 'k' }, k), h('p', { class: 'big' }, big, chip ? h('span', { class: 'chip accent' }, chip) : null), body, h('p', { class: 'how' }, how));
  const claim = d.steps.find((s) => s.name === 'claim_check');
  $('tr-cards').replaceChildren(
    card('Bid total', inr(r.total_inr), null, h('p', {}, `${(d.steps.find((s) => s.name === 'compose_bom')?.summary ?? '').split(', total')[0]}, priced from the company’s own HubSpot catalogue for ${d.rfq.sites.atm} ATMs and ${d.rfq.sites.branch} branches, less a ${r.discount_pct}% discount, plus ${r.gst_pct}% GST.`), 'packages/proposal/src/bom.ts · money.ts'),
    card('Go / no-go', 'Conditional', `confidence ${g.confidence.toFixed(2)}`, h('ul', {}, h('li', {}, `Coverage ${Math.round(b.coverage * 100)}% of technical requirements`), h('li', {}, `Won ${b.similar_won} of ${b.similar_decided} closest past bids`), h('li', {}, `${b.eligibility_gaps} eligibility gaps, ${b.eligibility_to_confirm} to confirm`), h('li', {}, `${b.days_left} days to the deadline`)), 'packages/proposal/src/gonogo.ts'),
    card('Claim check', claim?.summary.split(',')[0] ?? '', null, h('p', {}, `Every sentence with a figure, name, standard or date must match the RFQ, the catalogue, a past proposal or the company profile. ${r.struck} did not and were struck before anyone saw them.`), 'packages/proposal/src/claims.ts'),
    card('Learned from', `${r.learned_from.length} past bids`, null, h('p', {}, `${r.learned_from.join(', ')}: chosen by similarity from 45 past proposals that Muse Spark read in Google Drive, with win or loss from HubSpot.`), 'packages/proposal/src/brain-read.ts · select.ts'),
  );
}

async function main() {
  const res = await fetch('/assets/trace/run.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`run.json ${res.status}`);
  const d = await res.json();
  facts(d); legend(); gantt(d); costs(d); cards(d); drawFloorplan(d.floorplan, h);
}
main().catch(() => { $('tr-lead').append(h('span', { class: 'small ink2' }, ' (The run data could not be loaded; refresh to try again.)')); });

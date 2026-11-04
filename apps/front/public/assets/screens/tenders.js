// Tenders: worldwide open notices ranked against the Company Brain, plus the tenders you saved or the scan matched.
import { api, h, fmt, chip, empty, errorBox, skeleton } from '../ui.js';
import { dash, fitRing, tabs } from './work-kit.js';
import { worldwide } from './tenders-world.js';

function row({ tender: t, match: m }) {
  return h('tr.click', { onclick: () => { location.hash = `#/tenders/${encodeURIComponent(t.id)}`; } },
    h('td', h('div.wk-trow', fitRing(m?.fit_score, 34), h('div', { style: { minWidth: 0 } }, h('div.wk-ttl', t.title || 'Untitled tender'), h('div.xs.muted.wk-ellipsis', (t.cpv || []).slice(0, 3).join(' · ') || (t.source ? `via ${t.source}` : dash))))),
    h('td.small', t.buyer || dash, h('div.xs.muted', t.country || '')),
    h('td.r.num.small', t.value_eur ? fmt.moneyMajor(t.value_eur, 'EUR') : dash),
    h('td.small.num.wk-nowrap', t.deadline ? fmt.date(t.deadline) : dash, t.deadline ? h('div.xs.muted', fmt.until(t.deadline)) : null),
    h('td', chip(m?.status || 'new')));
}

export async function render(root, params, ctx) {
  ctx.setCrumbs('Tenders');
  let view = params?.view === 'saved' ? 'saved' : 'world';
  const bar = h('div'), body = h('div');
  root.append(h('div.page-head', h('div', h('h1.title', 'Tenders'), h('div.sub', 'Open public tenders worldwide, ranked against what your Company Brain knows you sell and win.'))), bar, body);
  const pick = (id) => { view = id; draw(); };
  const draw = () => {
    bar.replaceChildren(tabs([{ id: 'world', label: 'Worldwide · ranked for you' }, { id: 'saved', label: 'My tenders' }], view, pick));
    if (view === 'world') worldwide(body); else saved(body);
  };
  draw();
}

async function saved(root) {
  let showAll = false;
  const toggle = h('button.pv-switch', { type: 'button', role: 'switch', 'aria-checked': 'false', onclick: () => { showAll = !showAll; toggle.setAttribute('aria-checked', String(showAll)); draw(); } },
    h('span.pv-switch-track', h('span.pv-switch-thumb')), h('span.small', 'Show dismissed'));
  const box = h('div.card');
  root.replaceChildren(h('div', { style: { display: 'flex', justifyContent: 'flex-end', margin: '4px 0 10px' } }, toggle), box);
  box.append(h('div.wk-pad', skeleton(6)));
  let items = [];
  try { items = ((await api('/tenders')).items || []).filter((x) => x && x.tender); } catch (e) { box.replaceChildren(errorBox(e)); return; }
  const draw = () => {
    const shown = items.filter((x) => showAll || x.match?.status !== 'dismissed')
      .sort((a, b) => (b.match?.fit_score ?? -1) - (a.match?.fit_score ?? -1));
    box.replaceChildren(shown.length
      ? h('div.wk-scroll', h('table.table', h('thead', h('tr', h('th', 'Tender'), h('th', 'Buyer'), h('th.r', 'Value'), h('th', 'Deadline'), h('th', 'Status'))), h('tbody', shown.map(row))))
      : empty('No saved tenders yet', 'Save a worldwide notice and it lands here with its deadlines and a bid / no-bid read.'));
  };
  draw();
}

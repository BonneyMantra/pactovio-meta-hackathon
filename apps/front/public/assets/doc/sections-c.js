// Proposal sections: scope of supply (BoM), engineering, implementation Gantt, commercials, warranty, sources.
import { h } from '../ui.js';
import { inr, qty, list, sectionHead, sourceText } from './kit.js';

const GROUPS = [['rax_product', 'Rax products', 'designed and manufactured in-house, Chennai'], ['external', 'Third-party components', 'OEM warranty, back-to-back, Rax single point of contact'], ['custom', 'Custom-engineered items', ''], ['service', 'Services', '']];
const sum = (xs) => xs.reduce((a, b) => a + (Number(b) || 0), 0);

function thumbCell(c, line) {
  const url = c.thumb(line.sku);
  if (url) return h('span.pd-thumb', h('img', { src: url, alt: '', onerror: (e) => { e.target.parentElement.classList.add('none'); e.target.remove(); } }));
  return h('span.pd-thumb.none', String(line.sku || '').replace(/^(RT|EXT|SVC)-/, '').replace(/[^A-Z0-9]/gi, '').slice(0, 3));
}

export function bom(c, num) {
  const lines = list(c.p.scope_of_supply), total = sum(lines.map((l) => l.amount_inr)) || 1;
  const share = GROUPS.map(([t, label]) => [t, label, sum(lines.filter((l) => l.type === t).map((l) => l.amount_inr))]).filter((g) => g[2] > 0);
  let n = 0;
  const body = [];
  for (const [t, label, sub] of GROUPS) {
    const items = lines.filter((l) => l.type === t);
    if (!items.length) continue;
    body.push(h('tr.pd-grp', h('td', { colspan: 4 }, h('b', label), sub ? h('span.pd-muted', ` — ${sub}`) : null), h('td.r', { colspan: 2 }, inr(sum(items.map((l) => l.amount_inr))))));
    for (const l of items) {
      n += 1;
      const ev = list(c.p.evidence).find((e) => e.source?.product_sku === l.sku);
      body.push(h('tr', h('td.pd-mono.pd-muted', String(n)), h('td.pd-tcell', thumbCell(c, l)),
        h('td', h('div.pd-mono.pd-sku', l.sku, ev ? c.nt.sup(ev.source) : null, l.budgetary ? h('span.pd-budget', { title: 'Not in the price list: indicative price, subject to OEM quotation' }, 'budgetary') : null), h('div', l.description)),
        h('td.r.pd-num', qty(l.qty), h('div.pd-muted.pd-xs', l.unit)), h('td.r.pd-num', inr(l.unit_price_inr)), h('td.r.pd-num', inr(l.amount_inr))));
    }
  }
  return h('div',
    sectionHead(num, 'Scope of Supply'),
    h('div.pd-share', h('div.pd-share-bar', share.map(([t, , v]) => h(`span.pd-s-${t}`, { style: { flex: v } }))),
      h('div.pd-share-keys', share.map(([t, label, v]) => h('span', h(`i.pd-s-${t}`), `${label} `, h('b', `${Math.round((v / total) * 100)}%`))))),
    h('div.pd-scroll', h('table.pd-table.pd-bom', h('thead', h('tr', h('th', '#'), h('th', ''), h('th', 'Item'), h('th.r', 'Qty'), h('th.r', 'Unit price'), h('th.r', 'Amount'))),
      h('tbody', body), h('tfoot', h('tr', h('td', { colspan: 5 }, 'Supply subtotal, ex-GST'), h('td.r.pd-num', inr(c.p.commercials?.supply_subtotal_inr ?? total)))))));
}

export function engineering(c, num) {
  const wps = list(c.p.custom_engineering);
  if (!wps.length) return null;
  return h('div.pd-block',
    sectionHead(num, 'Engineering & Customisation'),
    h('p.pd-lead', 'The following work packages are executed by our in-house design team at Chennai and priced in person-days.'),
    h('div.pd-scroll', h('table.pd-table.pd-wp', h('thead', h('tr', h('th', 'Work package'), h('th.r', 'Person-days'), h('th.r', 'Rate / day'), h('th.r', 'Amount'))),
      h('tbody', wps.map((w) => h('tr', h('td', h('b', w.work_package), h('div.pd-muted', w.description)), h('td.r.pd-num', qty(w.person_days)), h('td.r.pd-num', inr(w.rate_inr)), h('td.r.pd-num', inr(w.person_days * w.rate_inr))))),
      h('tfoot', h('tr', h('td', 'Engineering subtotal, ex-GST'), h('td.r.pd-num', qty(sum(wps.map((w) => w.person_days)))), h('td'), h('td.r.pd-num', inr(c.p.commercials?.engineering_subtotal_inr ?? sum(wps.map((w) => w.person_days * w.rate_inr)))))))));
}

export function plan(c, num) {
  let cursor = 1;
  const phases = list(c.p.implementation_plan).map((p) => { const s = p.start_week || cursor; cursor = s + (p.weeks || 1); return { ...p, s, e: s + (p.weeks || 1) - 1 }; });
  if (!phases.length) return null;
  const N = Math.max(...phases.map((p) => p.e)), step = N > 24 ? 4 : N > 12 ? 2 : 1;
  const ticks = []; for (let w = 1; w <= N; w += step) ticks.push(h('span', { style: { left: `${((w - 1) / N) * 100}%` } }, `W${w}`));
  return h('div.pd-block',
    sectionHead(num, 'Implementation Plan'),
    h('p.pd-lead', `Indicative programme of ${N} weeks from receipt of purchase order and advance payment.`),
    h('div.pd-gantt', { style: { '--n': N } },
      h('div.pd-g-row.pd-g-head', h('div'), h('div.pd-g-track', ticks)),
      phases.map((p, i) => {
        const narrow = (p.weeks || 1) / N < 0.14, side = p.e > N * 0.8 ? 'l' : 'r';
        return h('div.pd-g-row',
          h('div.pd-g-name', h('b', p.name), h('div.pd-muted.pd-xs', p.deliverables)),
          h('div.pd-g-track', grid(N), h(`div.pd-g-bar${/pilot|trial|prototype/i.test(p.name) ? '.alt' : ''}${narrow ? `.out-${side}` : ''}`, { style: { left: `${((p.s - 1) / N) * 100}%`, width: `${((p.weeks || 1) / N) * 100}%`, '--d': `${i * 70}ms` } },
            h('span', `W${p.s}–${p.e}`))));
      })));
}

const grid = (N) => h('div.pd-g-grid', Array.from({ length: N - 1 }, (_, i) => h('i', { style: { left: `${((i + 1) / N) * 100}%` } })));

function milestones(terms) {
  const out = []; const re = /(\d{1,3})\s*%\s*([^,;.]+)/g; let m;
  while ((m = re.exec(String(terms || '')))) out.push([Number(m[1]), m[2].trim()]);
  return sum(out.map((x) => x[0])) === 100 ? out : [];
}

export function commercials(c, num) {
  const k = c.p.commercials || {};
  const rows = [['Supply subtotal', k.supply_subtotal_inr], k.engineering_subtotal_inr ? ['Engineering subtotal', k.engineering_subtotal_inr] : null, ['Subtotal', k.subtotal, 'sub'],
    k.discount_pct ? [`Special discount (${k.discount_pct}%)`, -k.discount_inr] : null, ['Taxable value', k.taxable_inr, 'sub'], [k.gst_pct ? `GST @ ${k.gst_pct}%` : 'GST (zero-rated export)', k.gst_inr]].filter(Boolean);
  const ms = milestones(k.payment_terms);
  return h('div.pd-block',
    sectionHead(num, 'Commercials'),
    h('table.pd-table.pd-tot', h('tbody', rows.map(([l, v, cls]) => h(`tr${cls ? '.' + cls : ''}`, h('td', l), h('td.r.pd-num', v < 0 ? `− ${inr(-v)}` : inr(v))))),
      h('tfoot', h('tr', h('td', 'Total project value', h('div.pd-muted.pd-xs', 'Indian rupees, all inclusive as above')), h('td.r.pd-num.pd-total', inr(k.total_inr))))),
    h('h3', 'Payment terms'),
    ms.length ? h('div.pd-ms', ms.map(([v, l]) => h('div', { style: { flex: `${v} 1 0` } }, h('b', `${v}%`), h('span', l)))) : h('p', k.payment_terms), k.note ? h('p.pd-muted', k.note) : null);
}

export function warranty(c, num) {
  const w = c.p.warranty_amc;
  if (!w) return null;
  return h('div.pd-block',
    sectionHead(num, 'Warranty & AMC'),
    h('div.pd-figures.three',
      h('div', h('div.pd-label', 'Warranty'), h('div.pd-fig', `${w.warranty_months_from_commissioning} months`), h('div.pd-muted.pd-xs', `from commissioning, or ${w.warranty_months_from_dispatch} from dispatch`)),
      h('div', h('div.pd-label', 'Optional AMC'), h('div.pd-fig', `${w.amc_pct_of_hardware}%`), h('div.pd-muted.pd-xs', 'of hardware value per year')),
      h('div', h('div.pd-label', 'AMC per year'), h('div.pd-fig', inr(w.amc_annual_inr)), h('div.pd-muted.pd-xs', `on a hardware base of ${inr(w.amc_hardware_base_inr)}`))),
    h('p', w.text));
}

export function sources(c) {
  const all = c.nt.all();
  if (!all.length) return null;
  const ev = list(c.p.evidence);
  return h('div.pd-block.pd-notes',
    h('header.pd-sec', h('span.pd-sec-n', '§'), h('div', h('h2', 'Notes & Sources'))),
    h('ol', all.map(({ n, source }) => {
      const claims = ev.filter((e) => JSON.stringify(e.source) === JSON.stringify(source)).map((e) => e.claim);
      return h('li', { id: `pd-note-${n}` }, h('span.pd-mono', String(n)), h('div', claims.length ? h('div', `“${claims.join('”, “')}”`) : null, h('div.pd-muted', sourceText(source, c.products))));
    })));
}

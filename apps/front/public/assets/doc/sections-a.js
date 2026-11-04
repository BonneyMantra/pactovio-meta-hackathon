// Proposal sections: cover, executive summary, requirement, compliance, assumptions, sign-off.
import { h, icon } from '../ui.js';
import { inrShort, qty, list, longDate, assetUrl, paras, sectionHead, editable } from './kit.js';

export function programmeWeeks(plan) {
  let cursor = 1, end = 0;
  for (const ph of list(plan)) { const s = ph.start_week || cursor; end = Math.max(end, s + (ph.weeks || 1) - 1); cursor = s + (ph.weeks || 1); }
  return end;
}

export function cover(c) {
  const { p } = c, cv = p.concept_visual, src = assetUrl(c.id, cv?.image_ref);
  const meta = [['Reference', p.ref], ['Revision', p.revision], ['Date', longDate(p.date)], ['Valid for', p.validity_days ? `${p.validity_days} days` : '—']];
  return h('div.pd-cover',
    h('div.pd-cover-top', h('div.pd-wordmark', c.supplier), h('div.pd-kicker', 'Technical & Commercial Proposal')),
    editable('title', h('h1.pd-title', p.title)),
    h('p.pd-cover-for', 'Prepared for ', h('strong', p.client?.name), p.client?.city ? `, ${p.client.city}` : '', p.client?.country && p.client.country !== 'India' ? `, ${p.client.country}` : ''),
    src ? h('figure.pd-visual', h('img', { src, alt: cv.label || 'Concept visual', loading: 'eager' }),
      h('figcaption', h('span.pd-visual-tag', cv.label || 'Concept visual — generated, not a product photo'))) : h('div.pd-visual.pd-visual-none'),
    h('dl.pd-meta', meta.map(([k, v]) => h('div', h('dt', k), h('dd', v || '—')))),
    p.rfq_ref ? h('p.pd-yourref', h('span', 'Your reference'), p.rfq_ref) : null,
    h('div.pd-cover-foot',
      h('div', h('div.pd-label', 'Prepared for'), h('div', p.client?.contact_name), h('div.pd-muted', p.client?.contact_title), h('div.pd-muted', p.client?.name)),
      h('div', h('div.pd-label', 'Prepared by'), h('div', p.prepared_by?.name), h('div.pd-muted', p.prepared_by?.title), h('div.pd-muted', c.supplier))));
}

export function executive(c, num) {
  const { p } = c, sites = p.site_kit?.sites, weeks = programmeWeeks(p.implementation_plan);
  const siteCount = sites ? Object.values(sites).reduce((a, b) => a + (Number(b) || 0), 0) : null;
  const figures = [
    ['Project value', inrShort(p.commercials?.total_inr), p.commercials?.gst_pct ? `incl. ${p.commercials.gst_pct}% GST` : 'GST zero-rated'],
    siteCount ? ['Sites', qty(siteCount), Object.entries(sites).map(([k, v]) => `${v} ${k === 'atm' ? 'ATM' : k}${v === 1 ? '' : 's'}`).join(' · ')] : ['Line items', String(list(p.scope_of_supply).length), 'in scope of supply'],
    ['Programme', weeks ? `${weeks} weeks` : '—', 'from purchase order'],
    ['Validity', p.validity_days ? `${p.validity_days} days` : '—', `from ${longDate(p.date)}`],
  ];
  return h('div',
    sectionHead(num, 'Executive Summary'),
    h('div.pd-figures', figures.map(([k, v, s]) => h('div', h('div.pd-label', k), h('div.pd-fig', v), h('div.pd-muted.pd-xs', s)))),
    h('div.pd-prose', paras(p.executive_summary, p.evidence, c.nt).map((el, i) => editable(`executive_summary.p${i}`, el))));
}

export function requirement(c, num) {
  return h('div.pd-block',
    sectionHead(num, 'Understanding of Requirement'),
    h('p.pd-lead', 'We understand the requirement as follows.'),
    h('ol.pd-req', list(c.p.requirement_understanding).map((r, i) => h('li', h('span.pd-req-n', String(i + 1).padStart(2, '0')), editable(`requirement_understanding.${i}`, h('span', r))))));
}

const STATUS = { complies: ['Complies', 'ok'], partial: ['Partial', 'warn'], deviation: ['Deviation', 'bad'] };

export function compliance(c, num) {
  const rows = list(c.p.compliance), count = (s) => rows.filter((r) => r.status === s).length;
  const ev = list(c.p.evidence);
  return h('div.pd-block',
    sectionHead(num, 'Compliance Statement'),
    h('div.pd-comp-sum',
      h('div.pd-comp-bar', ['complies', 'partial', 'deviation'].map((s) => count(s) ? h(`span.${STATUS[s][1]}`, { style: { flex: count(s) } }) : null)),
      h('div.pd-xs', `${count('complies')} of ${rows.length} comply · ${count('partial')} partial · ${count('deviation')} deviation${count('deviation') === 1 ? '' : 's'}`)),
    h('table.pd-table.pd-comp', h('thead', h('tr', h('th', '#'), h('th', 'Requirement'), h('th', 'Status'), h('th', 'Remark'), h('th.r', 'RFQ ref.'))),
      h('tbody', rows.map((r, i) => {
        const [label, tone] = STATUS[r.status] || [r.status, ''];
        const src = r.source || ev.find((e) => e.source?.doc && String(e.claim).toLowerCase() === String(r.requirement).toLowerCase())?.source;
        return h('tr', h('td.pd-mono', String(i + 1).padStart(2, '0')), h('td', r.requirement),
          h('td', h(`span.pd-status.${tone}`, tone === 'ok' ? icon('check', 11) : h('i'), label)),
          h('td.pd-muted', r.remark),
          h('td.r', src?.page ? h('a.pd-cite', { href: `#pd-note-${c.nt.ref(src)}` }, `p. ${src.page}`) : src ? c.nt.sup(src) : '—'));
      }))));
}

export function assumptions(c, num) {
  return h('div.pd-block',
    sectionHead(num, 'Assumptions & Exclusions'),
    h('div.pd-two',
      h('div', h('h3', 'Assumptions'), h('ul.pd-list', list(c.p.assumptions).map((a, i) => editable(`assumptions.${i}`, h('li', a))))),
      h('div', h('h3', 'Exclusions'), h('ul.pd-list', list(c.p.exclusions).map((a, i) => editable(`exclusions.${i}`, h('li', a)))))));
}

export function signoff(c) {
  const { p } = c;
  return h('div.pd-sign',
    h('p', `Thank you for the opportunity to serve ${p.client?.name || 'you'}. We look forward to your valued order.`),
    h('div.pd-sign-row',
      h('div', h('div.pd-label', `For ${c.supplier}`), h('div.pd-sign-line'), h('div', h('strong', p.prepared_by?.name)), h('div.pd-muted', p.prepared_by?.title)),
      h('div', h('div.pd-label', 'Accepted for the client'), h('div.pd-sign-line'), h('div.pd-muted', 'Name, designation, date and seal'))));
}


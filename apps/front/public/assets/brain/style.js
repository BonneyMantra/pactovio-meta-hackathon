// "How you write": the learned section order, voice rules, signature phrases and commercial conventions.
import { h, icon } from '../ui.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const refs = (r) => h('span.bs-refs', arr(r).slice(0, 3).map((x) => h('span.bs-ref', x)), arr(r).length > 3 ? h('span.bs-ref', `+${arr(r).length - 3}`) : null);

export function styleSection(style, { compact = false } = {}) {
  if (!style) return null;
  const terms = [['Payment terms', style.payment_terms], ['Warranty', style.warranty], ['AMC', style.amc_pct != null ? `${style.amc_pct}% of hardware value per year` : null],
    ['Validity', style.validity_days ? `${style.validity_days} days` : null], ['Discount pattern', style.discount_pattern]].filter(([, v]) => v);
  return h('div.bs',
    h('div.bs-order',
      h('div.bs-k', 'Section order'),
      h('ol', arr(style.section_order).map((s, i) => h('li', { style: { '--i': i } }, h('span.num', String(i + 1).padStart(2, '0')), s)))),
    h('div.bs-cols',
      h('div',
        h('div.bs-k', 'Voice rules'),
        h('div.bs-rules', arr(style.voice_rules).slice(0, compact ? 4 : 12).map((r) => h('div.bs-rule', h('b', r.id), h('div', h('div', r.text), refs(r.refs)))))),
      h('div',
        h('div.bs-k', 'Phrases it reuses'),
        h('div.bs-phr', arr(style.phrases).slice(0, compact ? 3 : 8).map((p) => h('blockquote', `“${p.text}”`, refs(p.refs)))),
        terms.length && !compact ? h('div', { style: { marginTop: '18px' } }, h('div.bs-k', 'Commercial conventions'),
          h('dl.bs-terms', terms.map(([k, v]) => h('div', h('dt', k), h('dd', v))))) : null)));
}

export function profileCard(profile, catalogueCount, products) {
  const p = profile || {};
  const name = p.name || p.legal_name || 'Your company';
  const domains = arr(p.domains || p.capabilities || p.offerings).slice(0, 8);
  const certs = arr(p.certifications);
  const thumbs = [...(products?.values?.() || [])].filter((x) => x.thumb).slice(0, 10);
  return h('section.card.bp',
    h('div.bp-head', h('span.avatar.bp-av', name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('')),
      h('div', h('div.h4', name), h('div.small.ink2', [p.city, p.country === 'IN' ? 'India' : p.country, p.founded ? `since ${p.founded}` : null, p.employees ? `${p.employees} people` : null].filter(Boolean).join(' · ')))),
    p.tagline || p.description ? h('p.small.ink2.bp-tag', p.tagline || p.description) : null,
    domains.length ? h('div.bp-chips', domains.map((d) => h('span.chip.outline', d))) : null,
    certs.length ? h('div.bp-certs', certs.map((c) => h('span', icon('shield', 13), c))) : null,
    h('a.bp-cat', { href: '#/catalogue' },
      h('div', h('div.bs-k', 'Catalogue'), h('div.bp-n.num', String(catalogueCount ?? products?.size ?? 0)), h('div.xs.muted', 'products with prices, imported from HubSpot')),
      h('div.bp-thumbs', thumbs.map((t) => h('span', h('img', { src: t.thumb, alt: t.name || '' }))))));
}

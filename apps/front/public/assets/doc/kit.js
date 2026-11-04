// Shared helpers for the proposal document: Indian rupee formatting, escaping, footnotes, sheets and assets.
import { h } from '../ui.js';

const IN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
/** ₹12,45,000 — Indian digit grouping, whole rupees. */
export const inr = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : `₹${IN.format(Math.round(Number(n)))}`);
/** ₹2.42 Cr / ₹65.1 L / ₹48,000 for headline figures. */
export function inrShort(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e8 ? 1 : 2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  return inr(v);
}
export const qty = (n) => (Number.isInteger(Number(n)) ? IN.format(Number(n)) : String(n));
export const pct = (v, digits = 0) => (v == null ? '—' : `${(Number(v) <= 1 ? Number(v) * 100 : Number(v)).toFixed(digits)}%`);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const list = (v) => (Array.isArray(v) ? v : []);

export function longDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Images may be absolute URLs, app paths or keys stored with the proposal. */
export function assetUrl(proposalId, ref) {
  if (!ref) return null;
  if (/^(https?:|data:|blob:|\/)/.test(ref)) return ref;
  return `/api/proposals/${encodeURIComponent(proposalId)}/assets/${encodeURIComponent(ref)}`;
}

/** Footnote registry: each distinct source gets one number, in order of first citation. */
export function notes() {
  const map = new Map();
  const key = (s) => JSON.stringify(s || {});
  return {
    ref(source) {
      if (!source) return null;
      const k = key(source);
      if (!map.has(k)) map.set(k, { n: map.size + 1, source });
      return map.get(k).n;
    },
    sup(source) { const n = this.ref(source); return n ? h('sup.pd-fn', { 'data-fn': n }, h('a', { href: `#pd-note-${n}` }, String(n))) : null; },
    all() { return [...map.values()]; },
  };
}

export function sourceText(s, products) {
  if (!s) return '';
  if (s.doc) return `${s.doc}${s.page ? `, page ${s.page}` : ''}`;
  if (s.product_sku) { const p = products?.get(s.product_sku); return `Catalogue: ${s.product_sku}${p?.name ? ` — ${p.name}` : ''} (datasheet)`; }
  if (s.past_proposal_ref) return `Past proposal ${s.past_proposal_ref}`;
  if (s.url) return s.url;
  return Object.values(s).join(', ');
}

/** Paragraphs with footnote markers after the first verbatim mention of each evidence claim. */
export function paras(text, evidence, nt) {
  return String(text || '').split(/\n{2,}/).filter(Boolean).map((p) => {
    const hits = [];
    for (const ev of list(evidence)) {
      const claim = String(ev.claim || '').trim();
      if (claim.length < 3) continue;
      const i = p.toLowerCase().indexOf(claim.toLowerCase());
      if (i >= 0 && !hits.some((x) => x.end > i && x.i < i + claim.length)) hits.push({ i, end: i + claim.length, ev });
    }
    hits.sort((a, b) => a.i - b.i);
    const kids = []; let at = 0;
    for (const x of hits) { kids.push(p.slice(at, x.end), nt.sup(x.ev.source)); at = x.end; x.ev._used = true; }
    kids.push(p.slice(at));
    return h('p', kids);
  });
}

/** One A4 sheet. `head` is the running header; page numbers are filled in after layout. */
export function sheet(cls, ...kids) {
  return h(`section.pd-sheet${cls ? '.' + cls : ''}`, kids);
}

export function sectionHead(num, title, kicker) {
  return h('header.pd-sec', h('span.pd-sec-n', String(num).padStart(2, '0')), h('div', kicker ? h('div.pd-kicker', kicker) : null, h('h2', title)));
}

export const KIND = {
  rax_product: { label: 'Rax product', tone: 'rax' }, external: { label: 'Third-party', tone: 'ext' },
  custom: { label: 'Custom-engineered', tone: 'cus' }, client_system: { label: 'Client system', tone: 'cli' },
  service: { label: 'Service', tone: 'svc' },
};

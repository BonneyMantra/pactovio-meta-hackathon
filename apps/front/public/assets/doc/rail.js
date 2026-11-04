// Bid-desk rail beside the proposal (screen only, never printed): go/no-go, run trace, learning provenance.
import { h, icon } from '../ui.js';
import { list } from './kit.js';
import { steps, modelChip, modelClass } from './steps.js';

export { steps, modelChip, modelClass };

const VERDICT = { go: 'Go — bid', conditional: 'Bid with conditions', no_go: 'No bid' };

function gauge(v) {
  const s = 64, r = 27, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, v));
  const tone = f >= 0.7 ? 'var(--ok)' : f >= 0.45 ? 'var(--warn)' : 'var(--bad)';
  const el = h('span');
  el.innerHTML = `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true"><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--line-soft)" stroke-width="5"/>`
    + `<circle cx="32" cy="32" r="${r}" fill="none" stroke="${tone}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}" transform="rotate(-90 32 32)"/>`
    + `<text x="32" y="36.5" text-anchor="middle" font-size="14" font-weight="600" fill="var(--ink)" font-family="var(--font)">${Math.round(f * 100)}%</text></svg>`;
  return el.firstChild;
}

const mins = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s` : `${Math.round(ms / 1000)} s`);
const LEARNED = { payment_terms: 'Payment terms', warranty_months_commissioning: 'Warranty', amc_pct: 'AMC rate', validity_days: 'Validity', section_order: 'Section order', phrases: 'House phrases' };

function runCost(p) {
  const ms = Date.parse(p.updated_at) - Date.parse(p.created_at);
  const bits = [Number.isFinite(ms) && ms > 0 ? mins(ms) : null, p.cost_usd ? `$${Number(p.cost_usd).toFixed(2)} in model calls` : null].filter(Boolean);
  return bits.length ? ` · ${bits.join(' · ')}` : '';
}

export function rail(p, brain) {
  const g = p.go_no_go || p.bid_decision;
  const rules = new Map(list(brain?.style?.voice_rules).map((r) => [r.id, r.text]));
  const all = list(p.style_applied);
  const learnedTerms = all.filter((x) => x.startsWith('brain:')).map((x) => LEARNED[x.slice(6)]).filter(Boolean);
  const applied = all.filter((x) => !x.includes(':'));
  const ev = list(p.evidence);
  return h('aside.pd-rail',
    g ? h('section.card',
      h('h4', 'Bid decision', h('span.chip.outline', 'Internal · not printed')),
      h('div.pd-gauge', gauge(Number(g.confidence) || 0), h('div', h(`div.pd-verdict.${g.decision}`, VERDICT[g.decision] || g.decision), h('div.xs.muted', 'Confidence from the Company Brain'))),
      list(g.reasons).length ? h('ul.pd-reasons', g.reasons.map((r) => h('li', r))) : null) : null,
    list(p.steps).length ? h('section.card', h('h4', 'How it was written'),
      p.orchestrator ? h('div.xs.muted', { style: { marginBottom: '8px' } }, `Orchestrated by ${p.orchestrator}`, runCost(p)) : null,
      steps(p.steps)) : null,
    list(p.learned_from).length || applied.length || learnedTerms.length ? h('section.card',
      h('h4', `Written the ${String(brain?.profile?.legal_name || brain?.profile?.name || 'house').split(/\s+/)[0]} way`),
      learnedTerms.length ? h('div.xs.muted', { style: { marginBottom: '10px' } }, `Learned from past proposals: ${learnedTerms.join(', ')}.`) : null,
      list(p.learned_from).length ? h('div', h('div.xs.muted', { style: { marginBottom: '8px' } }, 'Closest past proposals it learned from'),
        h('div.pd-refs', p.learned_from.map((r) => h('span.chip.outline', r)))) : null,
      applied.length ? h('div.pd-rules', { style: { marginTop: '14px' } }, applied.map((id) => h('div', h('b', id), rules.get(id) || 'Style rule from the Company Brain'))) : null) : null,
    ev.length ? h('section.card', h('h4', 'Evidence'),
      h('div.small.ink2', `${ev.length} claims linked to the RFQ, datasheets and past proposals.`),
      h('a.btn.btn-ghost.btn-sm', { href: '#', style: { marginTop: '8px', paddingLeft: 0 }, onclick: (e) => { e.preventDefault(); document.querySelector('.pd-notes')?.scrollIntoView({ behavior: 'smooth' }); } }, 'Jump to sources', icon('arrow', 14))) : null);
}

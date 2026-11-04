// Worldwide open tenders (TED, World Bank, UK and Irish portals) ranked on Muse Spark against the Company Brain:
// the real catalogue, the sectors Rax has won and the past proposals it can cite. POST /api/onboarding/opportunities/search.
import { api, h, icon, fmt, toast, empty, errorBox, skeleton } from '../ui.js';
import { dash, fitRing } from './work-kit.js';
import { modelChip } from '../doc/rail.js';

const money = (v) => {
  if (!v?.amount_minor || !v.currency || v.amount_minor < 100_00) return null; // portals publish 1 or 0 as "not stated"
  try { return new Intl.NumberFormat(v.currency === 'INR' ? 'en-IN' : 'en', { style: 'currency', currency: v.currency, notation: 'compact', maximumFractionDigits: 1 }).format(v.amount_minor / 100); }
  catch { return `${v.currency} ${Math.round(v.amount_minor / 100).toLocaleString('en-IN')}`; }
};
const AI_MSG = { budget: 'The daily AI limit was reached, so new notices are ranked by keyword overlap until tomorrow.', models_disabled: 'AI ranking is paused, so notices are ordered by keyword overlap.', unavailable: 'Muse Spark did not answer, so some notices are not scored yet.' };

/** Drops the [SKU] codes that already show as product chips; past-proposal refs stay as the evidence they are. */
const plain = (t, skus) => String(t).replace(/\s*\[([^\]]+)\]/g, (m, c) => (c.split(/[,;]\s*/).every((x) => skus.has(x.trim().toUpperCase())) ? '' : m))
  .replace(/\s+([.,;:])/g, '$1').trim().replace(/[.;\s]*$/, '.');

function card(n, i, onSave) {
  const f = n.fit || {}, scored = f.method === 'ai';
  const prods = scored && f.score >= 25 ? n.matched_products || [] : []; // below 25 a cited SKU is a weak link, not a match
  const skus = new Set(prods.map((p) => p.sku.toUpperCase()));
  const save = h('button.btn.btn-secondary.btn-sm', { type: 'button', onclick: () => onSave(n, save) }, icon('check', 14), 'Save to my tenders');
  const reasons = [...(f.reasons || []), ...(f.strengths || [])].slice(0, 2).map((r) => plain(r, skus));
  const fact = (k, v) => h(`div.tw-fact${v ? '' : '.na'}`, h('span.ps-k', { style: { marginBottom: 0 } }, k), h('span', v || 'Not stated'));
  const where = [n.country_name, n.region_label].filter(Boolean).join(' · ');
  const when = n.deadline ? `${fmt.date(n.deadline)}${n.days_left != null ? ` · ${n.days_left} days left` : ''}` : null;
  return h('article.card', { style: { padding: '18px 20px', display: 'grid', gap: '12px', animation: `rise 360ms var(--ease) ${i * 60}ms backwards` } },
    h('div', { style: { display: 'flex', gap: '14px', alignItems: 'flex-start' } },
      fitRing(scored ? f.score : null, 46),
      h('div', { style: { minWidth: 0, flex: 1 } },
        h('div', { style: { fontSize: '16px', fontWeight: 550, letterSpacing: '-0.015em', lineHeight: '22px' } }, n.title || 'Untitled notice'),
        h('div.small.ink2', [n.buyer, n.source ? String(n.source).toUpperCase() : null].filter(Boolean).join(' · ') || dash))),
    h('div.tw-facts', fact('Region', where), fact('Deadline', when), fact('Value', money(n.value))),
    h('div', h('div.ps-k', 'Matching products'),
      prods.length ? h('div.tw-prods', prods.map((p) => h('span.chip.outline', { title: p.sku }, p.name, h('b', p.sku))))
        : h('div.xs.muted', scored ? 'No strong match in your catalogue.' : 'Not scored yet.')),
    n.summary ? h('div.small', { style: { lineHeight: '20px' } }, n.summary) : null,
    reasons.length ? h('div.ps-why', icon('brain', 14), h('span', reasons.join(' '))) : null,
    f.risks?.length ? h('div.xs.muted', `Risk: ${plain(f.risks[0], skus)}`) : null,
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, save,
      n.url ? h('a.btn.btn-ghost.btn-sm', { href: n.url, target: '_blank', rel: 'noopener' }, icon('out', 14), 'Official notice') : null));
}

/** Renders into `box`; returns nothing. Each search costs model calls, so it runs once per visit and on explicit refresh. */
export async function worldwide(box, { q = '' } = {}) {
  const list = h('div', { style: { display: 'grid', gap: '12px' } }, skeleton(6));
  const meta = h('div.small.ink2', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, 'Ranking open notices against your Company Brain on ', modelChip('Muse Spark'), '…');
  const input = h('input.input', { type: 'search', placeholder: 'Narrow by keyword, e.g. CCTV, surveillance, access control', value: q, style: { flex: 1, minWidth: '200px' } });
  const go = h('button.btn.btn-primary.btn-sm', { type: 'submit' }, icon('search', 14), 'Search');
  const form = h('form', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }, onsubmit: (e) => { e.preventDefault(); worldwide(box, { q: input.value.trim() }); } }, input, go);
  box.replaceChildren(form, meta, list);
  const onSave = async (n, btn) => {
    btn.disabled = true;
    try { await api('/onboarding/opportunities/save', { method: 'POST', body: { source: n.source, id: n.id } }); btn.replaceChildren(icon('check', 14), 'Saved'); toast('Saved to your tenders with its deadlines'); }
    catch (e) { btn.disabled = false; toast(e.message); }
  };
  let r;
  try { r = await api('/onboarding/opportunities/search', { method: 'POST', body: { limit: 12, sort: 'relevance', ...(q ? { q } : {}) }, signal: AbortSignal.timeout(120000) }); }
  catch (e) {
    meta.replaceChildren();
    list.replaceChildren(e.code === 'company_incomplete' ? h('div.card', empty('Finish your company profile first', 'Tender ranking uses your segment, catalogue and Company Brain.', h('a.btn.btn-primary.btn-sm', { href: '#/company' }, 'Open company profile'))) : errorBox(e));
    return;
  }
  const notices = r.notices || [];
  const scored = notices.filter((n) => n.fit?.method === 'ai').length;
  meta.replaceChildren(...[
    h('span', `${(r.total ?? notices.length).toLocaleString('en-IN')} open notices worldwide · top ${notices.length} ranked against your catalogue and past proposals`),
    scored ? h('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, 'by', modelChip('Muse Spark')) : null,
    r.sources_failed?.length ? h('span.xs.muted', `${r.sources_failed.join(', ')} not answering`) : null].filter(Boolean));
  if (r.ai?.code && AI_MSG[r.ai.code]) meta.append(h('div.xs.muted', { style: { width: '100%' } }, AI_MSG[r.ai.code]));
  list.replaceChildren(...(notices.length ? notices.map((n, i) => card(n, i, onSave))
    : [h('div.card', empty('Nothing open matches right now', q ? 'Try a broader keyword.' : 'New notices are pulled from public portals every day.'))]));
}

// Onboarding step 1: website → company profile that fills itself (POST /api/onboarding/website/analyze).
import { api, h, icon } from '../ui.js';
import { friendlyError } from '../customer-api.js';
import { companyForm } from '../company-form.js';

const COUNTRY = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code); } catch { return code; } };
const SEG = { it: 'IT & services', industrial: 'Industrial — equipment, manufacturing and supply' };

export function websiteStep(root, { company, workspace, onNext }) {
  let disposed = false, form = null;
  const url = h('input.input.ob-url', { type: 'url', inputmode: 'url', autocomplete: 'url', placeholder: 'https://www.yourcompany.com', value: company.website || '', 'aria-label': 'Company website' });
  const go = h('button.btn.btn-primary', { type: 'submit' }, 'Build my profile', icon('arrow', 15));
  const status = h('div.small.ink2.ob-status', { role: 'status', 'aria-live': 'polite' });
  const out = h('div.ob-profile-wrap');
  const entry = h('form.ob-site', { novalidate: true, onsubmit: (e) => { e.preventDefault(); analyze(); } }, url, go);
  root.replaceChildren(h('div.ob-card',
    h('div.access-step', 'STEP 1 · YOUR COMPANY'), h('h2.ob-h', 'Start with your website'),
    h('p.ink2', 'Pactovio reads your public site and drafts the company profile it will bid with. You confirm it.'),
    entry, status, out,
    h('button.btn.btn-ghost.btn-sm.ob-manual', { type: 'button', onclick: () => manual(company) }, 'Enter details by hand instead')));
  url.focus();

  async function analyze() {
    let value = url.value.trim();
    if (value && !/^https?:\/\//i.test(value)) value = `https://${value}`;
    try { if (!['http:', 'https:'].includes(new URL(value).protocol)) throw new Error(); } catch { status.textContent = 'Enter your website address, such as https://www.yourcompany.com.'; url.focus(); return; }
    go.disabled = true; url.disabled = true; status.textContent = '';
    out.replaceChildren(h('div.ob-reading', h('div.ob-scan', h('span'), h('span'), h('span')), h('div', h('strong.small', `Reading ${new URL(value).hostname}`), h('div.xs.muted', 'Home, about, products and contact pages'))));
    try {
      const r = await api('/onboarding/website/analyze', { method: 'POST', body: { url: value }, signal: AbortSignal.timeout(60000) });
      if (!disposed) reveal(value, r);
    } catch (e) { if (!disposed) { out.replaceChildren(); status.textContent = friendlyError(e); } }
    finally { if (!disposed) { go.disabled = false; url.disabled = false; } }
  }

  function reveal(site, r) {
    const d = r.draft || {};
    const chips = (label, items) => (items?.length ? h('div.ob-row', h('div.ob-k', label), h('div.ob-chips', items.slice(0, 10).map((t, i) => h('span.chip.outline', { style: { animationDelay: `${600 + i * 60}ms` } }, t)))) : null);
    const profile = h('div.ob-profile',
      h('div.ob-row', h('div.ob-k', 'Company'), h('div.ob-name', d.name || '—')),
      d.description ? h('div.ob-row', h('div.ob-k', 'What you do'), h('p.ob-desc', d.description)) : null,
      chips('Offerings', d.offerings), chips('Who you serve', d.customers), chips('Markets', d.markets),
      h('div.ob-row.ob-two',
        h('div', h('div.ob-k', 'Country'), h('div', d.country ? COUNTRY(d.country) : h('span.muted', 'Not stated on the site'))),
        h('div', h('div.ob-k', 'Segment'), h('div', d.supplier_segment ? SEG[d.supplier_segment] : h('span.muted', 'Choose below')))),
      h('div.ob-src', icon('globe', 14), `${r.pages_read ?? r.sources?.length ?? 0} pages read`, r.ai?.ran ? ' · summarised by Muse Spark' : '',
        h('span.ob-src-list', (r.sources || []).slice(0, 5).map((s) => h('a', { href: s.url, target: '_blank', rel: 'noopener' }, new URL(s.url).pathname === '/' ? 'Home' : s.title || new URL(s.url).pathname)))));
    [...profile.children].forEach((c, i) => { c.style.animationDelay = `${i * 140}ms`; });
    const draft = { name: d.name, website: site, country: d.country, supplier_segment: d.supplier_segment, capabilities: [...new Set([...(d.capabilities || []), ...(d.offerings || [])])].slice(0, 50) };
    const complete = draft.name?.length >= 2 && /^[A-Z]{2}$/.test(draft.country || '') && draft.supplier_segment && draft.capabilities.length;
    const save = h('button.btn.btn-primary', { type: 'button', onclick: async () => {
      if (!complete) return manual({ ...company, ...draft });
      save.disabled = true; status.textContent = 'Saving your profile…';
      try {
        await api('/onboarding', { method: 'PATCH', body: { company: draft, profile: { description: d.description || '', offerings: (d.offerings || []).slice(0, 50), customers: (d.customers || []).slice(0, 50), markets: (d.markets || []).slice(0, 50), sources: (r.sources || []).slice(0, 10).map((s) => ({ url: s.url, title: String(s.title || '').slice(0, 200) })) } } });
        if (!disposed) onNext();
      } catch (e) { if (!disposed) { status.textContent = friendlyError(e); save.disabled = false; } }
    } }, complete ? 'Looks right — continue' : 'Complete the details', icon('arrow', 15));
    root.querySelector('.ob-manual')?.remove();
    out.replaceChildren(profile, h('div.ob-actions', h('button.btn.btn-ghost', { type: 'button', onclick: () => manual({ ...company, ...draft }) }, 'Edit details'), save));
  }

  function manual(prefill) {
    form?.dispose();
    form = companyForm(prefill, workspace, () => { if (!disposed) onNext(); });
    root.replaceChildren(h('div.ob-card', h('div.access-step', 'STEP 1 · YOUR COMPANY'), h('h2.ob-h', 'Check your company details'), form.element));
    root.querySelector('input')?.focus();
  }
  return () => { disposed = true; form?.dispose(); };
}

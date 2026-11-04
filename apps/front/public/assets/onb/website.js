// Onboarding step 1: website → company profile that fills itself (POST /api/onboarding/website/analyze).
// Left: the website question, then the confirm actions. Right panel: the site being read, then the profile it produced.
import { api, h, icon } from '../ui.js';
import { friendlyError } from '../customer-api.js';
import { companyForm } from '../company-form.js';

const COUNTRY = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code); } catch { return code; } };
const SEG = { it: 'IT & services', industrial: 'Industrial — equipment, manufacturing and supply' };
const spin = () => h('span.pv-spin', { 'aria-hidden': 'true' });

export function websiteStep(s, { nav, company, workspace, onNext }) {
  let disposed = false, form = null;

  function entry(lastError = '') {
    s.work(null);
    const url = h('input.pv-input', { id: 'onb-site', type: 'url', inputmode: 'url', autocomplete: 'url', placeholder: 'https://www.yourcompany.com', value: company.website || '', 'aria-describedby': 'onb-site-status' });
    const go = h('button.pv-btn', { type: 'submit' }, 'Build my profile', icon('arrow', 16));
    const status = h('p.pv-status', { id: 'onb-site-status', role: 'status' }, lastError);
    if (lastError) { status.className = 'pv-status pv-error'; url.setAttribute('aria-invalid', 'true'); }
    const f = h('form.pv-form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); analyze(url, go, status); } },
      h('div.pv-field', h('label.pv-label', { for: 'onb-site' }, 'Company website'), url), status, go,
      h('button.pv-link.pv-link-mute.pv-resend', { type: 'button', onclick: () => manual(company) }, 'Enter details by hand instead'));
    s.ask(nav, h('div.pv-heading', h('h1', { tabindex: '-1' }, 'Start with your website'),
      h('p.pv-lede', 'Pactovio reads your public site and drafts the company profile it will bid with. You confirm it.')), f);
    url.focus({ preventScroll: true });
  }

  async function analyze(url, go, status) {
    let value = url.value.trim();
    if (value && !/^https?:\/\//i.test(value)) value = `https://${value}`;
    let host;
    try { const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) throw new Error(); host = u.hostname.replace(/^www\./, ''); }
    catch { status.textContent = 'Enter your website address, such as https://www.yourcompany.com.'; status.className = 'pv-status pv-error'; url.setAttribute('aria-invalid', 'true'); url.focus(); return; }
    url.removeAttribute('aria-invalid'); status.className = 'pv-status'; status.textContent = '';
    go.disabled = true; url.disabled = true; go.replaceChildren(spin(), `Reading ${host}…`);
    s.work(h('div.pv-panel.ob-readpanel',
      h('div.pv-panel-head', h('div', h('div.pv-kicker', 'Reading your website'), h('h2', host)), h('span.pv-live', h('i'), 'Live')),
      h('div.ob-reading', h('div.ob-scan', h('span'), h('span'), h('span')), h('div', h('strong.small', `Reading ${host}`), h('div.xs.muted', 'Home, about, products and contact pages'))),
      h('div.ob-skel', [92, 64, 78, 40, 86, 58].map((w, i) => h('span', { style: { width: `${w}%`, animationDelay: `${i * 120}ms` } })))));
    try {
      const r = await api('/onboarding/website/analyze', { method: 'POST', body: { url: value }, signal: AbortSignal.timeout(60000) });
      if (!disposed) reveal(value, host, r);
    } catch (e) { if (!disposed) entry(friendlyError(e)); }
  }

  function reveal(site, host, r) {
    const d = r.draft || {};
    const chips = (label, items) => (items?.length ? h('div.ob-row', h('div.ob-k', label), h('div.ob-chips', items.slice(0, 10).map((t, i) => h('span.chip.outline', { style: { animationDelay: `${600 + i * 60}ms` } }, t)))) : null);
    const who = servedPicker(d.customers, d.markets);
    const pages = r.pages_read ?? r.sources?.length ?? 0;
    const profile = h('div.ob-profile',
      d.description ? h('div.ob-row', h('div.ob-k', 'What you do'), h('p.ob-desc', d.description)) : null,
      chips('Offerings', d.offerings), who.el, chips('Markets', d.markets),
      h('div.ob-row.ob-two',
        h('div', h('div.ob-k', 'Country'), h('div', d.country ? COUNTRY(d.country) : h('span.muted', 'Not stated on the site'))),
        h('div', h('div.ob-k', 'Segment'), h('div', d.supplier_segment ? SEG[d.supplier_segment] : h('span.muted', 'Choose in the details')))),
      h('div.ob-src', icon('globe', 14), `${pages} pages read`, r.ai?.ran ? ' · summarised by Muse Spark' : '',
        h('span.ob-src-list', (r.sources || []).slice(0, 5).map((x) => h('a', { href: x.url, target: '_blank', rel: 'noopener' }, new URL(x.url).pathname === '/' ? 'Home' : x.title || new URL(x.url).pathname)))));
    [...profile.children].forEach((c, i) => { c.style.animationDelay = `${i * 140}ms`; });
    s.work(h('div.pv-panel', h('div.pv-panel-head', h('div', h('div.pv-kicker', 'Company profile'), h('h2', d.name || host)), h('span.pv-tag-ok', icon('check', 13), 'Read from your site')), profile));

    const draft = { name: d.name, website: site, country: d.country, supplier_segment: d.supplier_segment, capabilities: [...new Set([...(d.capabilities || []), ...(d.offerings || [])])].slice(0, 50) };
    const complete = draft.name?.length >= 2 && /^[A-Z]{2}$/.test(draft.country || '') && draft.supplier_segment && draft.capabilities.length;
    const status = h('p.pv-status', { role: 'status' });
    const save = h('button.pv-btn', { type: 'button', onclick: async () => {
      if (!complete) return manual({ ...company, ...draft });
      const customers = who.values();
      if (!customers.length) { status.textContent = 'Choose at least one type of customer you serve.'; status.className = 'pv-status pv-error'; who.focus(); return; }
      save.disabled = true; save.replaceChildren(spin(), 'Saving your profile…'); status.textContent = ''; status.className = 'pv-status';
      try {
        await api('/onboarding', { method: 'PATCH', body: { company: draft, profile: { description: d.description || '', offerings: (d.offerings || []).slice(0, 50), customers: customers.slice(0, 50), markets: (d.markets || []).slice(0, 50), sources: (r.sources || []).slice(0, 10).map((x) => ({ url: x.url, title: String(x.title || '').slice(0, 200) })) } } });
        if (!disposed) onNext();
      } catch (e) { if (!disposed) { status.textContent = friendlyError(e); status.className = 'pv-status pv-error'; save.disabled = false; save.replaceChildren(label, icon('arrow', 16)); } }
    } });
    const label = complete ? 'Looks right — continue' : 'Complete the details';
    save.append(label, icon('arrow', 16));
    const served = who.picking ? ' Choose who you serve in the profile, then continue.' : '';
    s.ask(nav, h('div.pv-heading', h('h1', { tabindex: '-1' }, complete ? `Is this ${d.name}?` : 'Almost there'),
      h('p.pv-lede', `${complete ? 'Here is the profile Pactovio will bid with' : 'Some details were not on the site'}, read from ${pages} page${pages === 1 ? '' : 's'} of ${host}.${served}`)),
    h('div.pv-form.pv-after', status, save,
      h('div.pv-row', h('button.pv-btn.pv-btn-quiet', { type: 'button', onclick: () => manual({ ...company, ...draft }) }, 'Edit details'),
        h('button.pv-btn.pv-btn-text', { type: 'button', onclick: () => entry() }, 'Use another address'))));
    save.focus({ preventScroll: true });
  }

  function manual(prefill) {
    form?.dispose();
    form = companyForm(prefill, workspace, () => { if (!disposed) onNext(); });
    s.ask(nav, h('div.pv-heading', h('h1', { tabindex: '-1' }, 'Check your company details'),
      h('p.pv-lede', 'These are the facts every proposal is written from: who you are, where you are, what you offer.')),
    h('button.pv-btn.pv-btn-text.pv-back', { type: 'button', onclick: () => { form?.dispose(); form = null; entry(); } }, 'Back to the website'));
    s.work(h('div.pv-panel.pv-panel-form', form.element));
    s.el.querySelector('.pv-panel-form input')?.focus({ preventScroll: true });
  }

  entry();
  return () => { disposed = true; form?.dispose(); };
}

/** "Who you serve": the site's own statement when it has one; otherwise the person picks from the sectors read on the site or types one. */
function servedPicker(found = [], markets = []) {
  const picked = new Set(found);
  const label = h('div.ob-k', 'Who you serve');
  if (found.length) return { el: h('div.ob-row', label, h('div.ob-chips', found.slice(0, 10).map((t, i) => h('span.chip.outline', { style: { animationDelay: `${600 + i * 60}ms` } }, t)))), values: () => [...picked], focus() {}, picking: false };
  const list = h('div.ob-chips.ob-pick', { role: 'group', 'aria-label': 'Who you serve' });
  const toggle = (t) => h('button.chip.outline.ob-pickchip', { type: 'button', 'aria-pressed': 'false', onclick: (e) => {
    const on = !picked.has(t); on ? picked.add(t) : picked.delete(t); e.currentTarget.setAttribute('aria-pressed', String(on));
  } }, t);
  markets.slice(0, 10).forEach((t) => list.append(toggle(t)));
  const input = h('input.input.ob-addwho', { type: 'text', maxlength: 80, placeholder: 'Add a customer type, e.g. Banks', 'aria-label': 'Add a customer type', onkeydown: (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = input.value.trim();
    if (!t || picked.has(t)) return;
    const b = toggle(t); list.append(b); b.click(); input.value = '';
  } });
  return {
    el: h('div.ob-row.ob-row-ask', label, h('div', h('div.xs.muted.ob-pickhint', markets.length ? 'Not stated on the site. Tap the sectors you sell to, or add one.' : 'Not stated on the site. Add the customer types you sell to.'), list, input)),
    values: () => { const t = input.value.trim(); if (t) picked.add(t); return [...picked]; },
    focus: () => (list.querySelector('button') || input).focus(),
    picking: true,
  };
}

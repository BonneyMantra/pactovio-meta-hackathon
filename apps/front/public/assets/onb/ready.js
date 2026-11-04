// Onboarding step 4: "Your agent is ready". Left: what it is now and the way into the chat. Right: what it learned.
import { h, icon } from '../ui.js';
import { completeCompany, friendlyError } from '../customer-api.js';
import { getBrain } from '../brain-api.js';
import { inrShort } from '../doc/kit.js';
import { countUp, frac } from '../brain/charts.js';

export async function readyStep(s, { nav, onComplete, companyName }) {
  let disposed = false;
  s.ask(nav, h('div.pv-form.pv-notice-wrap', h('div.access-card', h('p', { role: 'status' }, 'Putting it together…'))));
  const b = await getBrain().catch(() => null);
  if (disposed) return () => {};
  const st = b?.stats;
  const name = companyName || b?.profile?.name || 'your company';
  const tiles = [
    ['Catalogue items', b?.catalogue_count, (v) => String(Math.round(v)), 'priced from HubSpot'],
    ['Proposals learned', b?.proposals_learned, (v) => String(Math.round(v)), 'from Google Drive'],
    ['Win rate', st?.win_rate != null ? frac(st.win_rate) * 100 : null, (v) => `${Math.round(v)}%`, st ? `${st.won} won · ${st.lost} lost` : 'on decided bids'],
    ['Median deal', st?.median_value_inr, inrShort, 'including GST'],
  ].filter(([, v]) => v != null);
  const nums = tiles.map(() => h('div.ob-tile-v.num', '—'));
  const phrase = b?.style?.phrases?.[0]?.text;
  const order = b?.style?.section_order || [];
  const voice = b?.style?.voice_rules?.[0]?.text, terms = b?.style?.payment_terms;
  const status = h('p.pv-status', { role: 'status' });
  const go = h('button.pv-btn', { type: 'button', onclick: async () => {
    go.disabled = true; go.replaceChildren(h('span.pv-spin', { 'aria-hidden': 'true' }), 'Opening your workspace…'); status.textContent = '';
    try { await completeCompany(); history.replaceState(null, '', '/app#/agent'); await onComplete(); }
    catch (e) { if (!disposed) { status.textContent = friendlyError(e); status.className = 'pv-status pv-error'; go.disabled = false; go.replaceChildren('Talk to your agent', icon('arrow', 16)); } }
  } }, 'Talk to your agent', icon('arrow', 16));

  s.ask(nav,
    h('div.pv-heading', h('div.ob-ready-mark', icon('check', 24)), h('h1', { tabindex: '-1' }, 'Your agent is ready'),
      h('p.pv-lede', `It knows ${name}: what you sell, what it costs, how you write and which bids you win. Send it an RFQ and it drafts the proposal.`)),
    h('div.pv-form', status, go));
  s.work(h('div.pv-panel',
    h('div.pv-panel-head', h('div', h('div.pv-kicker', 'Company Brain'), h('h2', `What it learned about ${name}`)), h('span.pv-tag-ok', icon('check', 13), 'Ready')),
    tiles.length ? h('div.ob-tiles', tiles.map(([k, , , sub], i) => h('div.ob-tile', { style: { animationDelay: `${i * 90}ms` } }, h('div.xs.muted', k), nums[i], h('div.xs.muted', sub)))) : null,
    voice || terms ? h('div.ob-learnt',
      voice ? h('div', { style: { animationDelay: '220ms' } }, h('div.pv-kicker', 'Your voice'), h('p', voice)) : null,
      terms ? h('div', { style: { animationDelay: '300ms' } }, h('div.pv-kicker', 'Your payment terms'), h('p', terms)) : null) : null,
    phrase ? h('blockquote.ob-quote', `“${phrase}”`, h('span', 'A phrase it learned from your proposals')) : null,
    order.length ? h('div.ob-structure', h('div.pv-kicker', `Your ${order.length}-section structure`),
      h('ol', order.map((sec, i) => h('li', { style: { animationDelay: `${300 + i * 60}ms` } }, sec)))) : null));
  tiles.forEach(([, v, f], i) => setTimeout(() => { if (!disposed) countUp(nums[i], Number(v), f); }, 200 + i * 90));
  go.focus({ preventScroll: true });
  return () => { disposed = true; };
}
